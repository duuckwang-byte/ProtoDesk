/* [js/edit-entry.js] 编辑模式 + 新建原型 + 启动入口（由 app.js 拆分，顺序勿乱调） */
/* ═══════ 预览/编辑模式：编辑模式点击元素 → 检查器抽屉（跳转交互 + 修改需求） → 待提交列表 → 统一提交大模型 ═══════
   编辑定位基于 iframe 内 DOM（webSecurity:false 可跨源读写），不改动原型文件本身；
   每条记录含 内容 + 元素 + 元素唯一路径(CSS Selector) + 所在页面路由，提交时随清单交给大模型定位修改。 */
/* Wave-C/F: ESM 显式依赖 (escHtml/escAttr/showToast 经 utils 显式 import, 消灭隐式全局);
 * Store/EventBus 显式 import (EDIT_QUEUE 真相源收编, 切换/保存经 Store 版本守卫协同)。
 * stripped-classic 降级: import 行剥离后裸调用回退 window 全局。 */
/* FIX: 经典<script>加载，禁用ESM import(整文件罢工)。内联回退+window.Utils双保险；
 * Store/EventBus经window只读。_EditStore/_editBus保留typeof守卫兼容。 */
var escHtml = (typeof window !== 'undefined' && window.escHtml) || (typeof window !== 'undefined' && window.Utils && window.Utils.escHtml) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var escAttr = (typeof window !== 'undefined' && window.escAttr) || (typeof window !== 'undefined' && window.Utils && window.Utils.escAttr) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var showToast = (typeof window !== 'undefined' && window.showToast) || (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) || function (msg) { try { if (typeof libStatus === 'function') { libStatus(msg); return; } } catch (e) {} try { alert(msg); } catch (e2) {} return null; };
var EDIT_QUEUE=[],EDIT_HOVER_EL=null,EDIT_LOCKED_EL=null,EDIT_PENDING_SUBMIT=false,EDIT_EDITING_ID=null; /* T3.2:僵尸编辑模式已下线，拾取统一由CTRL_PICK接管 */
var EDIT_SUBMITTED_IDS=[]; /* 本轮已提交的条目 id：done 时只清这些，未选中的继续留列 */
var EDIT_LAST_QUEUE=null; /* G01: 清空前的快照，用于撤销/审计 */
var _editQueuePersistTimer=null;
function persistEditQueue(){ try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(e){} try { if (typeof window !== 'undefined' && window.Store && window.Store.replaceQueue) { /* Store 镜像 (过渡期双写, Wave-D 以 Store 为准): 避免递归, 仅当长度/首末 id 不一致时同步 */ try { var _sq = window.Store.getQueue(); var _same = _sq && _sq.length === EDIT_QUEUE.length; if (!_same) window.Store.replaceQueue(EDIT_QUEUE.slice()); } catch (e2) {} } } catch (e3) {} }
function schedulePersistEditQueue(){ if(_editQueuePersistTimer) clearTimeout(_editQueuePersistTimer); _editQueuePersistTimer=setTimeout(persistEditQueue,300); }
// P1-3 fix: 同步刷盘，避免关闭前丢失 G-01-残
function flushEditQueueSync(){ try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(e){} } // P1-3 fix
window.addEventListener('beforeunload', flushEditQueueSync); // P1-3 fix
/* G01: 初始化时从 localStorage 恢复待提交队列 */
try{ var _savedQueue=JSON.parse(localStorage.getItem('edit_queue_v1')||'null'); if(Array.isArray(_savedQueue)) EDIT_QUEUE=_savedQueue; }catch(e){}

/* 弹窗互斥：任一弹窗/抽屉打开时，Ctrl 拾取不生效（弹窗内 Ctrl+C/V 复制粘贴不受干扰）。
 * 覆盖模态遮罩（MaskStack 深度）、各遮罩显隐与抽屉 open 类；sbMask 为 Docked 占位恒为 none，不计入。 */
function isAnyPopupOpen(){
  try{
    if(window.MaskStack&&window.MaskStack.stack&&window.MaskStack.stack.length) return true;
  }catch(e){}
  try{
    var ids=['aiMask','editDrawerMask','linkInspMask','linkMgrMask','docShortcutMask','nameMask','kindMask','apiProfileMask','gitPushMask','gitPullMask','gitConfigMask','uispecAddMask','projMask','reqMask','docsMask','codeEditMask','multiEditMask'];
    for(var i=0;i<ids.length;i++){
      var el=null;
      try{ el=document.getElementById(ids[i]); }catch(e){ el=null; }
      if(el&&el.style&&(el.style.display==='block'||el.style.display==='flex')) return true;
    }
  }catch(e){}
  try{
    var drawers=['editDrawer','linkInspector','linkMgrDrawer'];
    for(var j=0;j<drawers.length;j++){
      var d=null;
      try{ d=document.getElementById(drawers[j]); }catch(e){ d=null; }
      if(d&&d.classList&&d.classList.contains('open')) return true;
    }
  }catch(e){}
  return false;
}
/* ═══════ Ctrl 即时拾取通道（与编辑模式并存，共用待提交队列） ═══════ */
var CTRL_PICK = {
  holding: false,      /* 是否按住 Ctrl/Cmd（纯键无其他修饰；主窗口或 iframe 内输入框焦点不置位） */
  hovering: null,      /* 当前探测悬停元素（不污染 EDIT_HOVER_EL） */
  selected: [],        /* 选中集合：[{id, selector, tagName, text, rect, el}]，沙箱跨域时 el 为空、remote 为 true */
  overlay: null,       /* 覆盖层容器（选择框 + 序号角标） */
  panel: null,         /* 批量面板引用 */
  remoteLoop: false,   /* 远端拾取循环是否运行中（沙箱跨域经 ProtoSandboxBridge 逐次武装） */
  remoteSeq: 0,        /* 远端循环令牌（停止/切换模式时递增作废旧等待） */
  remoteMode: 'pick',  /* 'pick' 多选拾取 | 'inline' 就地改单发 */

  /* —— 进入/退出拾取态 —— */
  enter: function () {
    if (window.LinkBind && typeof LinkBind.closeAllDrawers === 'function') LinkBind.closeAllDrawers();
    document.body.classList.add('ctrl-inspecting');
    var eh = document.getElementById('editHover');
    if (eh) eh.classList.add('ctrl-hover');
    try {
      var d = frame.contentDocument;
      if (d && !d.getElementById('ctrlPickCrosshairStyle')) {
        var st = d.createElement('style');
        st.id = 'ctrlPickCrosshairStyle';
        st.textContent = '*{cursor:crosshair!important}';
        (d.head || d.documentElement).appendChild(st);
      }
    } catch (e) {}
  },
  exit: function () {
    document.body.classList.remove('ctrl-inspecting');
    var eh = document.getElementById('editHover');
    if (eh) eh.classList.remove('ctrl-hover');
    if (CTRL_PICK.hovering) { CTRL_PICK.hovering = null; }
    try{ editHideHover(); }catch(e){} /* 远端悬停框同收（hovering 为空时旧逻辑跳过隐藏） */
    try {
      var d = frame.contentDocument;
      if (d) {
        var st = d.getElementById('ctrlPickCrosshairStyle');
        if (st) st.remove();
      }
    } catch (e) {}
  },

  /* —— 拾取 —— */
  toggle: function (targetEl, ev) {    if (!targetEl) return;
    var tag = String(targetEl.tagName || '').toLowerCase();
    if (tag === 'html' || tag === 'body') return;
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }

    var idx = -1;
    CTRL_PICK.selected.forEach(function (it, i) { if (it.el === targetEl) idx = i; });
    if (idx >= 0) {
      CTRL_PICK.selected.splice(idx, 1);                      /* 反选移除 */
    } else {
      var selector = generateSelector(targetEl);
      var rect = targetEl.getBoundingClientRect();
      CTRL_PICK.selected.push({
        id: 'sel_' + Date.now() + '_' + (CTRL_PICK.selected.length + 1),
        selector: selector,
        tagName: targetEl.tagName,
        text: extractElementText(targetEl) || (targetEl.innerText || targetEl.value || '').trim().slice(0, 30),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        ancestors: (typeof editAncestorChain==='function'?editAncestorChain(targetEl):[]),
        parentHtml: (typeof editParentSnippet==='function'?editParentSnippet(targetEl):''),
        el: targetEl
      });
    }
    CTRL_PICK.renderOverlay();
    try{ if (CTRL_PICK.selected.length) CTRL_PICK.renderPickBar(); }catch(e){}
  },
  /* 沙箱跨域远端拾取：帧侧经 postMessage 回传 {selector,tagName,text,rect,page}（无 live el，
   * 以 selector+page 去重；rect 为帧视口 CSS 像素，覆盖层经 editRectToPage 换算）。 */
  toggleRemote: function (res, ev) {
    if (!res) return;
    var sel = String((res && res.selector) || '');
    if (!sel) return;
    var tag = String((res && res.tagName) || '').toLowerCase();
    if (tag === 'html' || tag === 'body') return;
    if (ev) { try { ev.preventDefault(); } catch (e) {} }
    var pg = String((res && res.page) || '');
    try { if (!pg && typeof editFrameHash === 'function') pg = editFrameHash() || ''; } catch (e2) {}
    var idx = -1;
    CTRL_PICK.selected.forEach(function (it, i) { if (it.selector === sel && String(it.page || '') === pg) idx = i; });
    if (idx >= 0) {
      CTRL_PICK.selected.splice(idx, 1);                      /* 反选移除 */
    } else {
      CTRL_PICK.selected.push({
        id: 'sel_' + Date.now() + '_' + (CTRL_PICK.selected.length + 1),
        selector: sel,
        tagName: (res && res.tagName) || '',
        text: String((res && res.text) || '').slice(0, 30),
        rect: (res && res.rect && typeof res.rect === 'object') ? { left: res.rect.left || 0, top: res.rect.top || 0, width: res.rect.width || 0, height: res.rect.height || 0 } : null,
        page: pg,
        remote: true,
        pickIndex: (res && typeof res.pickIndex === 'number') ? res.pickIndex : -1,
        ancestors: (res && Array.isArray(res.ancestors)) ? res.ancestors.slice(0, 8) : [],
        parentHtml: String((res && res.parentHtml) || '').slice(0, 2000),
        el: null
      });
    }
    CTRL_PICK.renderOverlay();
    try{ if (CTRL_PICK.selected.length) CTRL_PICK.renderPickBar(); }catch(e){}
  },
  clear: function () {
    CTRL_PICK.selected = [];
    if (CTRL_PICK.overlay) CTRL_PICK.overlay.innerHTML = '';
    editHideHover();
    CTRL_PICK.hovering = null;
    try{ CTRL_PICK.hideFab(); }catch(e){}
    try{ var _pi = document.getElementById('pickBarInput'); if (_pi) { _pi.value = ''; try{ pickBarInputAuto(); }catch(e){} } }catch(e2){}
  },

  /* —— 覆盖层 —— */
  renderOverlay: function () {
    ensurePickOverlay();
    if (CTRL_PICK.overlay) CTRL_PICK.overlay.style.display = '';
    CTRL_PICK.overlay.innerHTML = '';
    if (!CTRL_PICK.selected.length) return;
    CTRL_PICK.selected.forEach(function (it, i) {
      var r = null;
      var hasLiveEl = !!(it.el && it.el.ownerDocument);
      if (hasLiveEl) {
        try { r = it.el.getBoundingClientRect(); } catch (e) { r = null; }   /* 实时读取，防滚动/缩放漂移 */
      }
      /* 有活元素只用实时框（ detached 旧文档读出 0 尺寸即跳过，禁用旧 rect 兜底防幽灵框）；
       * 纯远端拾取（无 live el）才用帧回传 rect */
      if (!r && !hasLiveEl) r = it.rect;
      if (!r || (!r.width && !r.height)) return;
      var p = editRectToPage(r);
      var box = document.createElement('div');
      box.className = 'selection-box-overlay';
      box.style.left = p.left + 'px'; box.style.top = p.top + 'px';
      box.style.width = p.width + 'px'; box.style.height = p.height + 'px';
      var badge = document.createElement('span');
      badge.className = 'selection-badge';
      badge.textContent = i + 1;
      box.appendChild(badge);
      CTRL_PICK.overlay.appendChild(box);
    });
  },

  /* —— 出口 —— */
  openPanel: function () {
    try{ CTRL_PICK.hideFab(); }catch(e){}
    if (CTRL_PICK.selected.length === 1) {
      /* 单选：远端拾取（沙箱跨域无 live el）直接移交检查器远端入口；nonce 匹配即帧来源可信 */
      var only = CTRL_PICK.selected[0];
      if (only && only.remote) {
        var rpg = String(only.page || '');
        try { if (!rpg && typeof editFrameHash === 'function') rpg = editFrameHash() || ''; } catch (e) {}
        CTRL_PICK.clear();
        if (window.LinkBind && typeof LinkBind.openInspectorRemote === 'function') {
          LinkBind.openInspectorRemote({ selector: only.selector, page: rpg, label: only.text || only.tagName || only.selector, text: only.text || '', tagName: only.tagName || '', pickIndex: (typeof only.pickIndex === 'number') ? only.pickIndex : -1 });
        } else if (window.LinkBind) { LinkBind.openInspector(null); }
        return;
      }
      /* 单选：清空后移交检查器（同源/本地 DOM el，检查器自做作用域守卫） */
      var targetEl = CTRL_PICK.selected[0].el;
      CTRL_PICK.clear();
      if (window.LinkBind && typeof LinkBind.openInspector === 'function') {
        LinkBind.openInspector(targetEl);
      }
      return;
    }
    if (CTRL_PICK.selected.length > 1) {
      ensurePickOverlay();
      if (CTRL_PICK.overlay) CTRL_PICK.overlay.style.display = 'none';
      renderMultiEditPanel();
      CTRL_PICK.panel = document.getElementById('multiEditDrawer');
      if (CTRL_PICK.panel) {
        CTRL_PICK.panel.classList.add('open');
        CTRL_PICK.panel.setAttribute('aria-hidden', 'false');
      }
      var mask = document.getElementById('multiEditMask');
      if (mask) mask.style.display = 'block';
      if(window.MaskStack) window.MaskStack.push('multiEditMask', function(){ CTRL_PICK.closePanel(); CTRL_PICK.clear(); });
    }
  },
  closePanel: function () {
    if(window.MaskStack) window.MaskStack.pop('multiEditMask');
    if (CTRL_PICK.panel) {
      CTRL_PICK.panel.classList.remove('open');
      CTRL_PICK.panel.setAttribute('aria-hidden', 'true');
    }
    var mask = document.getElementById('multiEditMask');
    if (mask) mask.style.display = 'none';
    if (CTRL_PICK.overlay) CTRL_PICK.overlay.style.display = '';
    try{ CTRL_PICK.hideFab(); }catch(e){}
  },
  /* 拾取标签输入条（底部）：所选元素按标签展示可删，右侧发送等同旧悬浮球（藏条后开面板） */
  showFab: function () {
    try{
      if (!CTRL_PICK.selected.length) { CTRL_PICK.hideFab(); return; }
      try{ CTRL_PICK.renderPickBar(); }catch(e){}
      var b = document.getElementById('pickBar');
      if (!b) return;
      b.style.display = 'flex';
    }catch(e){}
  },
  hideFab: function () {
    try{ var b = document.getElementById('pickBar'); if (b) b.style.display = 'none'; }catch(e){}
    try{ pickBarClosePop(); }catch(e2){}
    try{ pickBarEscArmed=false; }catch(e3){}
    try{ pickBarEscTip(false); }catch(e4){}
  },
  removeById: function (id) {
    if (!id) return;
    try{
      var n0 = CTRL_PICK.selected.length;
      CTRL_PICK.selected = CTRL_PICK.selected.filter(function (it) { return !it || it.id !== id; });
      if (CTRL_PICK.selected.length === n0) return;
      try{ CTRL_PICK.renderOverlay(); }catch(e){}
      if (!CTRL_PICK.selected.length) { CTRL_PICK.hideFab(); return; }
      try{ CTRL_PICK.renderPickBar(); }catch(e2){}
    }catch(e){}
  },
  renderPickBar: function () {
    try{
      var box = document.getElementById('pickBarTags');
      if (!box) return;
      box.innerHTML = '';
      CTRL_PICK.selected.forEach(function (it, i) {
        var tag = document.createElement('span');
        tag.className = 'pick-bar-tag';
        var label = String((it && (it.text || it.tagName)) || '元素').slice(0, 18);
        tag.title = String((it && it.selector) || label);
        var tx = document.createElement('span');
        tx.textContent = label;
        var no = document.createElement('b');
        no.className = 'pick-bar-tag-no'; no.textContent = String(i + 1);
        var x = document.createElement('span');
        x.className = 'pick-bar-tag-x'; x.textContent = '✕'; x.title = '移除该元素';
        (function (id) { x.onclick = function (ev) { try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (e) {} try { CTRL_PICK.removeById(id); } catch (e2) {} }; })(it && it.id);
        tag.appendChild(no); tag.appendChild(document.createTextNode(' ')); tag.appendChild(tx); tag.appendChild(x);
        box.appendChild(tag);
      });
      /* 单元素才露出标注/交互；多选或清空时收起悬浮窗 */
      var single = CTRL_PICK.selected.length === 1;
      try{
        var ba = document.getElementById('pickBarAnno'), bl = document.getElementById('pickBarLink');
        if (ba) ba.style.display = single ? '' : 'none';
        if (bl) bl.style.display = single ? '' : 'none';
      }catch(e){}
      if (!single) { try{ pickBarClosePop(); }catch(e2){} }
    }catch(e){}
  },
  submitBatch: function (mode) {
    if (!CTRL_PICK.selected.length) return;
    var isBatch = (mode !== 'individual');
    var reqInput = null;
    var added = 0;
    var afterSubmit=function(ri, bm, ad){
      if (bm && ri) ri.value = '';  /* 批量模式提交后清空输入框，防止历史内容残留 */
      /* 仅加入待提交列表，不直接提交大模型：由用户从顶部「待提交列表」核对后统一提交 */
      if (typeof libStatus === 'function') libStatus('已将 ' + ad + ' 条修改需求加入待提交列表（可点顶部「待提交列表」查看并提交）。');
      CTRL_PICK.clear();
      CTRL_PICK.closePanel();
    };
    if (isBatch) {
      reqInput = document.getElementById('batchReqInput');
      var userReq = reqInput ? reqInput.value.trim() : '';
      if (!userReq) { alert('请输入统一修改诉求。'); return; }
      /* 批量集中一条：先升级选择器（补ID落盘），再随单条入列 */
      var built = null;
      try{ built=ctrlPickBuildParts(CTRL_PICK.selected); }catch(e){ built=null; }
      var rawParts = (built && built.parts) || [];
      var curHtmlNow = (built && built.file) || '';
      if (!rawParts.length) { alert('所选元素无法定位，请重新拾取。'); return; }
      var _sdir='';
      try{ _sdir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){}
      var doPushBatch=function(upParts){
        var cleanParts=(upParts||[]).map(function(p){
          return { sel:p.sel, page:p.page, label:p.label, anc:p.anc, ph:p.ph, file:p.file, pickIndex:(typeof p.pickIndex==='number')?p.pickIndex:-1 };
        });
        EDIT_QUEUE.push({ id: (Date.now()+Math.random().toString(36).slice(2,8)), ts: Date.now(), sel: true,
          page: '', selector: '', label: '批量修改（' + cleanParts.length + '个元素）', text: userReq, htmlFile: '',
          batchParts: cleanParts });
        added = 1;
        afterSubmit(reqInput, isBatch, added);
      };
      try{
        if(typeof prIdUpgradeParts==='function'&&_sdir) prIdUpgradeParts(rawParts, _sdir, doPushBatch);
        else doPushBatch(rawParts);
      }catch(e){ try{ doPushBatch(rawParts); }catch(e2){} }
      return;
    } else {
      /* 分别独立：先读需求文本，升级选择器后逐条入列（含去重更新） */
      var pend=[];
      CTRL_PICK.selected.forEach(function (it) {
        var input = document.getElementById('indiv_input_' + it.id);
        var req = input ? input.value.trim() : '';
        if(req) pend.push({it:it, req:req});
      });
      if(!pend.length){ alert('请至少为一个元素填写修改诉求。'); return; }
      var curH='';
      try{ curH=(typeof editQueueCurHtmlFile==='function'?editQueueCurHtmlFile():''); }catch(e){}
      var rawInd=pend.map(function(o){
        var it=o.it, sel='', pg='', label='', anc=[], ph='', el=null, pidx=-1;
        if(it.remote){
          sel=String(it.selector||''); if(!sel) return null;
          pg=String(it.page||'');
          label=String(it.text||it.tagName||sel).slice(0,30);
          anc=(it.ancestors&&it.ancestors.slice)?it.ancestors.slice(0,8):[];
          ph=String(it.parentHtml||'').slice(0,2000);
          pidx=(typeof it.pickIndex==='number')?it.pickIndex:-1;
        }else{
          if(!it.el) return null;
          try{ sel=generateSelector(it.el); }catch(e){ sel=''; }
          if(!sel) return null;
          try{ pg=editFrameHash(); }catch(e){ pg=''; }
          label=String(it.text||it.tagName||sel).slice(0,30);
          try{ anc=(typeof editAncestorChain==='function'?editAncestorChain(it.el):[]); }catch(e){ anc=[]; }
          try{ ph=String((typeof editParentSnippet==='function'?editParentSnippet(it.el):'')||'').slice(0,2000); }catch(e){ ph=''; }
          el=it.el;
        }
        return {sel:sel,page:pg,label:label,anc:anc,ph:ph,file:curH,req:o.req,el:el,pickIndex:pidx};
      }).filter(Boolean);
      if(!rawInd.length){ alert('所选元素无法定位，请重新拾取。'); return; }
      var _sdir2='';
      try{ _sdir2=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){}
      var doPushInd=function(upParts){
        var added2=0;
        upParts.forEach(function(p){
          var dup=null;
          EDIT_QUEUE.forEach(function(it){ if(it.selector===p.sel&&it.page===p.page&&(!it.htmlFile||!p.file||it.htmlFile===p.file))dup=it; });
          if(dup){ dup.text=p.req; dup.ts=Date.now(); if(!dup.htmlFile)dup.htmlFile=p.file; }
          else EDIT_QUEUE.push({ id:(Date.now()+Math.random().toString(36).slice(2,8)), ts:Date.now(), sel:true,
            page:p.page, selector:p.sel, label:String(p.label||p.sel).slice(0,30), text:p.req, htmlFile:p.file,
            ancestors:p.anc||[], parentHtml:String(p.ph||'').slice(0,2000) });
          added2++;
        });
        added=added2;
        afterSubmit(reqInput, isBatch, added);
      };
      try{
        if(typeof prIdUpgradeParts==='function'&&_sdir2) prIdUpgradeParts(rawInd, _sdir2, doPushInd);
        else doPushInd(rawInd);
      }catch(e){ try{ doPushInd(rawInd); }catch(e2){} }
      return;
    }
  }
};

/* 拾取部件拼装（多选提交与输入条直达共用）：把选中项展开为 {sel,page,label,anc,ph,file} */
function ctrlPickBuildParts(list){
  var parts=[], curHtmlNow='';
  try{ curHtmlNow=(typeof editQueueCurHtmlFile==='function'?editQueueCurHtmlFile():''); }catch(e){}
  (list||[]).forEach(function (it) {
    var sel='', pg='', label='', anc=[], ph='';
    if (it.remote) {
      sel = String(it.selector || ''); if (!sel) return;
      pg = String(it.page || '');
      label = String(it.text || it.tagName || sel).slice(0, 30);
      anc = (it.ancestors && it.ancestors.slice) ? it.ancestors.slice(0, 8) : [];
      ph = String(it.parentHtml || '').slice(0, 2000);
    } else {
      if (!it.el) return;
      try{ sel = generateSelector(it.el); }catch(e){ sel=''; }
      if (!sel) return;
      try{ pg = editFrameHash(); }catch(e){ pg=''; }
      label = String(it.text || it.tagName || sel).slice(0, 30);
      try{ anc = (typeof editAncestorChain==='function' ? editAncestorChain(it.el) : []); }catch(e){ anc=[]; }
      try{ ph = String((typeof editParentSnippet==='function' ? editParentSnippet(it.el) : '') || '').slice(0, 2000); }catch(e){ ph=''; }
    }
    parts.push({ sel: sel, page: pg, label: label, anc: anc, ph: ph, file: curHtmlNow, el: (!it.remote ? it.el : null), pickIndex: (it.remote && typeof it.pickIndex === 'number') ? it.pickIndex : -1 });
  });
  return { parts: parts, file: curHtmlNow };
}
/* 入列前升级：所涉文件补ID落盘，各部件选择器能换 pr-id 就换（按活元素序号/帧序号+短文案定位），最后静默刷新一次 */
/* 发送补ID后就地同步活文档：只补 data-pr-id 属性（无视觉变化），免整页重载，原型内弹窗/滚动/输入态不受影响 */
function prIdPatchLiveDom(parts){
  var n=0;
  try{
    (parts||[]).forEach(function(p){
      try{
        if(!p||!p.el||!p.el.ownerDocument) return;
        var m=String(p.sel||'').match(/\[data-pr-id="([^"]+)"\]/);
        if(!m) return;
        if(typeof p.el.setAttribute!=='function') return;
        try{ if(p.el.getAttribute&&p.el.getAttribute('data-pr-id')===m[1]) return; }catch(e){}
        p.el.setAttribute('data-pr-id', m[1]);
        n++;
      }catch(e){}
    });
  }catch(e){}
  return n;
}
function prIdUpgradeParts(parts, dir, cb){
  var done=function(ps){ try{ cb(ps||parts); }catch(e){} };
  try{
    if(!parts||!parts.length){ done(parts); return; }
    var need=false, i;
    for(i=0;i<parts.length;i++){ if(!/data-pr-id\s*=/.test(String(parts[i].sel||''))){ need=true; break; } }
    if(!need){ done(parts); return; }
    var sb=null;
    try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
    if(!sb||!dir){ done(parts); return; }
    var seen={}, flist=[];
    parts.forEach(function(p){ var f=p.file||''; if(f&&!seen[f]){ seen[f]=1; flist.push(f); } });
    if(!flist.length){ done(parts); return; }
    try{ codeEditLoading(true,'正在补齐稳定ID…'); }catch(e){}
    var docs={};
    var pending=flist.length;
    flist.forEach(function(f){
      sb.readFile({dir:dir,file:f}).then(function(r){
        docs[f]=String((r&&r.content)||'');
        if(--pending===0) finish();
      }).catch(function(){ docs[f]=null; if(--pending===0) finish(); });
    });
    function finish(){
      try{
        var injDocs={};
        Object.keys(docs).forEach(function(f){
          var src=docs[f]; if(src==null) return;
          var inj=src;
          try{ inj=(typeof prIdEnsureInjected==='function')?prIdEnsureInjected(src):src; }catch(e){}
          injDocs[f]={src:src, injected:inj};
        });
        parts.forEach(function(p){
          if(/data-pr-id\s*=/.test(String(p.sel||''))) return;
          var d=injDocs[p.file||'']; if(!d) return;
          var up=null;
          try{
            var k=-1;
            if(p.el&&p.el.ownerDocument){
              try{ var al=p.el.ownerDocument.querySelectorAll(p.sel); for(var ai=0;ai<al.length;ai++){ if(al[ai]===p.el){ k=ai; break; } } }catch(e){}
            }
            if(!(k>=0)&&(typeof p.pickIndex==='number')) k=p.pickIndex;
            up=(typeof prIdPickUpgrade==='function')?prIdPickUpgrade(d.injected, p.sel, k, String(p.label||'')):null;
          }catch(e){ up=null; }
          if(up&&up.sel) p.sel=up.sel;
        });
        var writes=[];
        Object.keys(injDocs).forEach(function(f){ if(injDocs[f].injected!==injDocs[f].src) writes.push(f); });
        var after=function(){
          try{ codeEditLoading(false); }catch(e){}
          if(writes.length){
            /* 写盘仅补 data-pr-id 属性：就地同步活文档，不重载预览（原型弹窗/页面态保持） */
            try{ if(typeof prIdPatchLiveDom==='function') prIdPatchLiveDom(parts); }catch(e){}
          }
          /* 零写入则什么都不做：此前即使无变化也会刷整页，白白关闭原型内弹窗 */
          done(parts);
        };
        if(!writes.length){ after(); return; }
        var wp=writes.length;
        writes.forEach(function(f){
          sb.write({dir:dir,file:f,content:injDocs[f].injected}).then(function(){ if(--wp===0) after(); }).catch(function(){ if(--wp===0) after(); });
        });
      }catch(e){ try{ codeEditLoading(false); }catch(e2){} done(parts); }
    }
  }catch(e){ done(parts); }
}
/* 覆盖层双保险创建 */
function ensurePickOverlay() {
  var o = document.getElementById('selectionOverlay');
  if (!o) {
    o = document.createElement('div');
    o.id = 'selectionOverlay';
    document.body.appendChild(o);
  }
  CTRL_PICK.overlay = o;
  return o;
}

window.CTRL_PICK = CTRL_PICK;
var btnSubmitEditEl=$('btnSubmitEdit'),
    submitBadgeEl=$('submitBadge'),editHoverEl=$('editHover'),
    editDrawerEl=$('editDrawer'),editDrawerBodyEl=$('editDrawerBody'),editDrawerCloseEl=$('editDrawerClose'),
    editDrawerMaskEl=$('editDrawerMask'),drawerBadgeEl=$('drawerBadge'),
    editQueueClearEl=$('editQueueClear'),editQueueSubmitEl=$('editQueueSubmit'),
    editQueueSelAllEl=$('editQueueSelAll');
function editFrameDoc(){ try{ return frame.contentDocument; }catch(e){ return null; } }
function editFrameHash(){ try{ var h=(frame.contentWindow&&frame.contentWindow.location&&frame.contentWindow.location.hash)||''; return h.replace(/^#/,''); }catch(e){ return ''; } }
function editFrameScale(){ try{ var fr=frame.getBoundingClientRect(); return fr.width/Math.max(1,frame.clientWidth); }catch(e){ return 1; } }
function editEscape(d,s){ try{ return d.defaultView.CSS.escape(s); }catch(e){ return String(s).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }
/* 提取元素最贴近的中文名称/按钮文字（支持自身文字、子元素、下方标签/同级兄弟、父级卡片文本） */
function extractElementText(el){
  if(!el)return '';
  function clean(s){ return String(s||'').trim().replace(/\s+/g,' '); }
  function findCn(s){
    var m=String(s||'').match(/[\u4e00-\u9fa5][\u4e00-\u9fa5\w\s-]{0,24}/);
    return m?m[0].trim():'';
  }
  // 1. 自身直接 textContent
  var direct=clean(el.textContent);
  var directCn=findCn(direct);
  if(directCn&&directCn.length>=2)return directCn;
  if(direct&&direct.length<=20&&!/<[a-z]/i.test(direct)){
    if(/[\u4e00-\u9fa5]/.test(direct))return direct;
  }

  // 2. 常用属性：title / aria-label / placeholder / alt / value
  var attrs=['title','aria-label','placeholder','alt','value'];
  for(var i=0;i<attrs.length;i++){
    var av=clean(el.getAttribute?el.getAttribute(attrs[i]):'');
    if(av){
      var acn=findCn(av);
      if(acn)return acn;
      if(av.length<=20)return av;
    }
  }

  // 3. 子元素中的文字或标签
  try{
    var subs=el.querySelectorAll('span, p, div, b, strong, label, i, .text, .label, .name, .title');
    for(var j=0;j<subs.length;j++){
      var st=clean(subs[j].textContent);
      var scn=findCn(st);
      if(scn&&scn.length>=2)return scn;
    }
  }catch(e){}

  // 4. 下方相邻元素（常见于移动端底部导航栏、宫格按钮：上方图标 + 下方中文标签）
  try{
    var nxt=el.nextElementSibling;
    if(nxt){
      var nt=clean(nxt.textContent);
      var ncn=findCn(nt);
      if(ncn)return ncn;
    }
  }catch(e){}

  // 5. 父级容器或就近条目（如 .nav-item, .tab-item, .grid-item, .menu-item 等）
  try{
    var parent=el.closest?el.closest('.nav-item, .tab-item, .tab-bar-item, .grid-item, .menu-item, .btn-wrap, .action-item, .van-tabbar-item, .el-menu-item, button, li, a'):el.parentElement;
    if(parent&&parent!==el){
      var pt=clean(parent.textContent);
      var pcn=findCn(pt);
      if(pcn)return pcn;
    }
  }catch(e){}

  // 6. 前后兄弟查找
  try{
    if(el.parentElement){
      var sibs=el.parentElement.children;
      for(var k=0;k<sibs.length;k++){
        if(sibs[k]!==el){
          var sibTxt=clean(sibs[k].textContent);
          var sibCn=findCn(sibTxt);
          if(sibCn)return sibCn;
        }
      }
    }
  }catch(e){}

  return direct?direct.slice(0,16):'';
}

function editElementLabel(el){
  var tag=''; try{ tag=el.tagName.toLowerCase(); }catch(e){}
  var txt=extractElementText(el);
  var id=''; try{ if(el.id)id=el.id; }catch(e){}
  var cls=''; try{ cls=(''+el.className).split(/\s+/).filter(Boolean).slice(0,2).join('.'); }catch(e){}
  
  var name=txt?'「'+txt+'」':'';
  var desc=tag||'元素';
  if(id)desc+='#'+id;
  else if(cls)desc+='.'+cls;
  
  if(name)return name+' ('+desc+')';
  return desc;
}
/* 生成元素唯一路径：优先稳态 data-pr-id（写盘自动注入，跨活文档/磁盘文件稳定）→ data-testid → #id → 类链 → tag:nth-of-type 全路径 */
function generateSelector(el){
  if(!el)return '';
  var d=el.ownerDocument;
  try{
    var prid=el.getAttribute && el.getAttribute('data-pr-id');
    if(prid && prid.length<64 && !/["'\n]/.test(prid)){
      var escPrid = (typeof CSS!=='undefined' && CSS.escape) ? CSS.escape(prid) : prid.replace(/["\\]/g,'\\$&');
      try{ if(d.querySelectorAll('[data-pr-id="'+escPrid+'"]').length===1) return '[data-pr-id="'+prid+'"]'; }catch(e2){ return '[data-pr-id="'+prid+'"]'; }
    }
  }catch(e){}
  try{
    var tid=el.getAttribute && el.getAttribute('data-testid');
    if(tid && tid.length<64 && !/["'\n]/.test(tid)){
      var escTid = (typeof CSS!=='undefined' && CSS.escape) ? CSS.escape(tid) : tid.replace(/["\\]/g,'\\$&');
      if(d.querySelectorAll('[data-testid="'+escTid+'"]').length===1){
        return '[data-testid="'+escTid+'"]';
      }
    }
  }catch(e){}
  if(el.id&&d.getElementById(el.id)===el&&!/^[0-9]/.test(el.id)&&el.id.length<64){ return '#'+editEscape(d,el.id); }
  /* 逐级构造可读路径（tag / tag#id / tag.class），从深层子集开始尝试，取首个唯一匹配 */
  var chain=[],n=el,ok=false;
  while(n&&n.nodeType===1&&n!==d.body&&n!==d.documentElement){
    var tag=String(n.tagName||'').toLowerCase(); if(!tag)break;
    var seg=tag;
    if(n.id&&!/^[0-9]/.test(String(n.id))&&String(n.id).length<64){
      seg=tag+'#'+editEscape(d,n.id);
    }else if((''+n.className).trim()){
      var c0=String(n.className).trim().split(/\s+/)[0];
      try{ seg=tag+'.'+editEscape(d,c0); }catch(e){}
    }
    chain.unshift(seg);
    n=n.parentElement;
  }
  for(var i=chain.length-1;i>=0;i--){
    var cand=chain.slice(i).join(' > ');
    try{ if(d.querySelectorAll(cand).length===1){ ok=true; break; } }catch(e){}
  }
  if(ok)return cand;
  /* 兜底：逐级 tag:nth-of-type 全路径（保证唯一可定位） */
  var parts=[],m=el;
  while(m&&m.nodeType===1&&m!==d.body&&m!==d.documentElement){
    var tag2=String(m.tagName||'').toLowerCase(); if(!tag2)break;
    var nth2=1,sib=m.previousElementSibling;
    while(sib){ if(String(sib.tagName).toLowerCase()===tag2)nth2++; sib=sib.previousElementSibling; }
    parts.unshift(tag2+':nth-of-type('+nth2+')');
    m=m.parentElement;
  }
  return parts.join(' > ');
}
/* 稳定ID补齐（与主进程 ensurePrIdInjected 同规则：交互标签+带 class 元素+[data-page]/[onclick]，跳过已有与脚本样式注释）；
 * 用于老文件首次命中多条时的一键迁移：补ID→写盘→静默刷新→提示重点。 */
function prIdEnsureInjected(html){
  try{
    var s=String(html==null?'':html);
    var seen={}, maxN=0, m;
    var reExist=/data-pr-id\s*=\s*"([^"]*)"/gi;
    while((m=reExist.exec(s))){ seen[m[1]]=1; var k=/^pr-[a-z0-9]+-(\d+)$/.exec(m[1]); if(k){ var n=parseInt(k[1],10); if(n>maxN)maxN=n; } }
    var cnt=maxN;
    var nid=function(tag){ cnt++; var tg=String(tag||'div').toLowerCase().replace(/[^a-z0-9]/g,''); var id='pr-'+tg+'-'+cnt; while(seen[id]){ cnt++; id='pr-'+tg+'-'+cnt; } seen[id]=1; return id; };
    var parts=s.split(/(<!--[\s\S]*?-->|<script[\s>][\s\S]*?<\/script\s*>|<style[\s>][\s\S]*?<\/style\s*>)/gi);
    for(var i=0;i<parts.length;i+=2){
      var chunk=parts[i];
      chunk=chunk.replace(/<(button|a|input|select|textarea|option|label)([^>]*?)>/gi,function(m0,tag,attrs){
        if(/data-pr-id\s*=/.test(attrs)||/data-testid\s*=/.test(attrs)) return m0;
        return '<'+tag+attrs+' data-pr-id="'+nid(tag)+'">';
      });
      chunk=chunk.replace(/<([a-z][a-z0-9]*)([^>]*\bclass\s*=\s*["'][^"']*["'][^>]*?)>/gi,function(m0,tag,attrs){
        var tl=String(tag).toLowerCase();
        if(/^(html|head|body|script|style|link|meta|title|base|template)$/.test(tl)) return m0;
        if(/data-pr-id\s*=/.test(attrs)||/data-testid\s*=/.test(attrs)) return m0;
        return '<'+tag+attrs+' data-pr-id="'+nid(tag)+'">';
      });
      chunk=chunk.replace(/<([a-z][a-z0-9]*)([^>]*\b(?:data-page|onclick)\s*=[^>]*?)>/gi,function(m0,tag,attrs){
        if(/data-pr-id\s*=/.test(attrs)) return m0;
        return '<'+tag+attrs+' data-pr-id="'+nid(tag)+'">';
      });
      parts[i]=chunk;
    }
    return parts.join('');
  }catch(e){ return String(html==null?'':html); }
}
/* 升级内核（纯函数，无IO）：在内存注入ID后的文档中按序号/文本定位所点元素，返回其 pr-id 选择器。
 * 注入只加属性不改变顺序与数量，故序号可跨文档对应；文件已有ID（活文档滞后）时直接在原文档中取号。 */
function prIdPickUpgrade(srcHtml, selector, liveIndex, text){
  try{
    if(/data-pr-id\s*=/.test(String(selector||''))) return null;
    if(typeof prIdEnsureInjected!=='function') return null;
    var src=String(srcHtml||'');
    var injected='';
    try{ injected=prIdEnsureInjected(src); }catch(e){ return null; }
    var changed=!!(injected&&injected!==src);
    var baseDoc=null;
    try{ baseDoc=new DOMParser().parseFromString(changed?injected:src,'text/html'); }catch(e){ return null; }
    if(!baseDoc) return null;
    var hits=null;
    try{ hits=baseDoc.querySelectorAll(selector); }catch(e){ return null; }
    if(!hits||!hits.length) return null;
    var k=(typeof liveIndex==='number')?liveIndex:-1;
    var tkey=String(text||'').replace(/\s+/g,' ').trim().slice(0,16).toLowerCase();
    if(!(k>=0&&k<hits.length)&&tkey){
      var fm=-1;
      for(var i=0;i<hits.length;i++){
        try{
          var ct=String(hits[i].textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
          if(ct.indexOf(tkey)>=0){ if(fm>=0){ fm=-2; break; } fm=i; }
        }catch(e){}
      }
      if(fm>=0) k=fm;
    }
    if(k>=0&&k<hits.length&&tkey){
      try{
        var kc=String(hits[k].textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
        if(kc.indexOf(tkey)<0){
          var fm2=-1;
          for(var j=0;j<hits.length;j++){
            try{
              var c2=String(hits[j].textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
              if(c2.indexOf(tkey)>=0){ if(fm2>=0){ fm2=-2; break; } fm2=j; }
            }catch(e){}
          }
          if(fm2>=0) k=fm2;
        }
      }catch(e){}
    }
    if(!(k>=0&&k<hits.length)) return null;
    var pid='';
    try{ pid=String(hits[k].getAttribute('data-pr-id')||''); }catch(e){}
    if(!pid) return null;
    var ns='[data-pr-id="'+pid.replace(/"/g,'')+'"]';
    var chk=null;
    try{ chk=baseDoc.querySelectorAll(ns); }catch(e){}
    if(!chk||chk.length!==1) return null;
    return { sel:ns, pdoc:baseDoc, srcHtml:changed?injected:src, el:hits[k], noop:!changed };
  }catch(e){ return null; }
}
function codeEditLoading(on, text){
  try{
    var old=null;
    try{ old=document.getElementById('codeEditLoading'); }catch(e){}
    if(!on){ try{ if(old&&old.parentNode)old.parentNode.removeChild(old); }catch(e){} return; }
    if(old){ try{ var tx=old.querySelector('.code-edit-loading-text'); if(tx)tx.textContent=String(text||'正在补齐稳定ID…'); }catch(e){} return; }
    var ov=document.createElement('div'); ov.id='codeEditLoading';
    var box=document.createElement('div'); box.className='code-edit-loading-box';
    var sp=document.createElement('span'); sp.className='code-edit-spinner';
    var tx2=document.createElement('span'); tx2.className='code-edit-loading-text'; tx2.textContent=String(text||'正在补齐稳定ID…');
    box.appendChild(sp); box.appendChild(tx2); ov.appendChild(box);
    document.body.appendChild(ov);
  }catch(e){}
}
/* 老文件首次命中多条：补ID→写盘→静默刷新→按序号自动打开编辑器（免二次点击；定不到序号才回退为提示重点） */
function codeEditBackfillPrIds(dir, file, srcHtml, selector, hint, label){
  try{
    if(CODE_EDIT.backfilling){ codeEditToast('正在补齐稳定ID，请稍候…'); return; }
    var sb=null;
    try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
    if(!sb||typeof sb.write!=='function'){ codeEditToast('补齐稳定ID需要写盘权限。'); return; }
    CODE_EDIT.backfilling=true;
    codeEditLoading(true, '正在补齐稳定ID…');
    var done=function(){ try{ CODE_EDIT.backfilling=false; }catch(e){} try{ codeEditLoading(false); }catch(e){} };
    var liveIndex=(hint&&typeof hint.liveIndex==='number')?hint.liveIndex:-1;
    var textKey=String((hint&&(hint.text||hint.label))||'');
    var up=null;
    try{ up=(typeof prIdPickUpgrade==='function')?prIdPickUpgrade(srcHtml, selector, liveIndex, textKey):null; }catch(e){ up=null; }
    if(!up||!up.sel){
      /* 定不到具体项：仍把新增ID落盘（下次点击即有ID），再提示重点 */
      var stillWrite='';
      try{ stillWrite=(typeof prIdEnsureInjected==='function')?prIdEnsureInjected(srcHtml):''; }catch(e){}
      if(stillWrite&&stillWrite!==String(srcHtml||'')){
        sb.write({dir:dir,file:file,content:stillWrite}).then(function(w){
          done();
          var saved3=null;
          try{ if(typeof inlineEditCaptureScroll==='function')saved3=inlineEditCaptureScroll(); }catch(e){}
          try{ if(typeof inlineEditSilentRefresh==='function')inlineEditSilentRefresh(saved3,file); }catch(e){}
          codeEditToast('已补齐稳定ID并刷新，请再点一次该元素。');
        }).catch(function(){ done(); codeEditToast('补齐稳定ID写盘异常。'); });
        return;
      }
      var hasIds=false;
      try{ hasIds=/data-pr-id\s*=/.test(String(srcHtml||'')); }catch(e){}
      done();
      if(hasIds) codeEditToast('该文件元素均已有稳定ID，仍有多条命中，请点击其父级容器后编辑。');
      else codeEditToast('未能确定所点是多条中的哪一个，请再点一次该元素。');
      return;
    }
    var finishOpen=function(){
      /* 写盘（无新增时跳过）→ 刷新预览 → 用新 pr-id 直接打开（复用 codeEditOpen，不再走补ID分支） */
      var doOpen=function(){
        var saved=null;
        try{ if(typeof inlineEditCaptureScroll==='function')saved=inlineEditCaptureScroll(); }catch(e){}
        try{ if(typeof inlineEditSilentRefresh==='function')inlineEditSilentRefresh(saved,file); }catch(e){}
        try{ if(typeof libStatus==='function')libStatus('已补齐稳定ID并自动打开：'+label); }catch(e){}
        done();
        try{ codeEditOpen({selector:up.sel, file:file, dir:dir, label:label}); }catch(e){ codeEditToast('自动打开失败，请再点一次该元素。'); }
      };
      if(up.noop){ doOpen(); return; }
      sb.write({dir:dir,file:file,content:up.srcHtml}).then(function(w){
        if(!w||!w.ok){ done(); codeEditToast('补齐稳定ID写盘失败：'+((w&&w.error)||'未知错误')); return; }
        doOpen();
      }).catch(function(){ done(); codeEditToast('补齐稳定ID写盘异常。'); });
    };
    finishOpen();
    return;
  }catch(e){ try{ CODE_EDIT.backfilling=false; }catch(e2){} try{ codeEditLoading(false); }catch(e3){} try{ codeEditToast('补齐稳定ID失败。'); }catch(e4){} }
}
function editRectToPage(rect){ var fr=frame.getBoundingClientRect(),s=editFrameScale(); return { left:fr.left+rect.left*s, top:fr.top+rect.top*s, width:rect.width*s, height:rect.height*s }; }
var __prBgAt={};
function prIdBackfillFileInBackground(dir, file){
  try{
    if(!dir||!file) return false;
    if(typeof CODE_EDIT!=='undefined'&&CODE_EDIT&&CODE_EDIT.backfilling) return false;
    var now=Date.now(), key=String(dir)+'::'+String(file);
    try{ if(__prBgAt[key]&&now-__prBgAt[key]<60000) return false; }catch(e){}
    var sb=null; try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
    if(!sb||typeof sb.readFile!=='function'||typeof sb.write!=='function') return false;
    __prBgAt[key]=now;
    sb.readFile({dir:dir,file:file}).then(function(r){
      if(!r||!r.ok) return;
      var src=String(r.content||''), inj='';
      try{ inj=(typeof prIdEnsureInjected==='function')?prIdEnsureInjected(src):''; }catch(e){}
      if(!inj||inj===src) return;
      sb.write({dir:dir,file:file,content:inj}).then(function(w){
        if(!w||!w.ok) return;
        var saved=null; try{ saved=(typeof inlineEditCaptureScroll==='function')?inlineEditCaptureScroll():null; }catch(e){}
        try{ if(typeof inlineEditSilentRefresh==='function')inlineEditSilentRefresh(saved,file); }catch(e){}
        try{ if(typeof libStatus==='function')libStatus('已为 '+file+' 补齐稳定ID，后续拾取更精准。'); }catch(e){}
      }).catch(function(){});
    }).catch(function(){});
    return true;
  }catch(e){ return false; }
}
function editShowHover(el){
  if(!el||!editHoverEl)return;
  var r=el.getBoundingClientRect();
  if(!r.width||!r.height)return;
  var p=editRectToPage(r);
  editHoverEl.style.display='block';
  editHoverEl.style.left=p.left+'px'; editHoverEl.style.top=p.top+'px';
  editHoverEl.style.width=p.width+'px'; editHoverEl.style.height=p.height+'px';
}
function editHideHover(){ if(editHoverEl)editHoverEl.style.display='none'; }
function editHover(ev){
  try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(_e){}
  /* Ctrl+Shift按住时不启动拾取高亮（与Ctrl+单击拾取互斥，留给就地改单击） */
  if(ev&&ev.shiftKey&&(ev.ctrlKey||ev.metaKey)){ try{ if(CTRL_PICK)CTRL_PICK.hovering=null; }catch(e){} try{ editHideHover(); }catch(e2){} return; }
  if(CTRL_PICK && CTRL_PICK.holding){
    var t = ev.target;
    if(!t || t.nodeType !== 1) return;
    var tag = String(t.tagName||'').toLowerCase();
    if(tag==='html'||tag==='body'){ editHideHover(); return; }
    CTRL_PICK.hovering = t;
    editShowHover(t);
    return;
  }
  if(!(CTRL_PICK && CTRL_PICK.holding)) return; /* T3.2:此处原为已下线模式守卫，下方为僵尸单选链，非holding一律回 */
  var t = ev.target;
  if(!t || t.nodeType !== 1) return;
  var tag = String(t.tagName||'').toLowerCase();
  if(tag==='html'||tag==='body'){ editHideHover(); return; }
  EDIT_HOVER_EL = t;
  editShowHover(t);
}
var _editEvtSeen={type:'',stamp:-1,target:null};
function editEvtDedup(ev){
  try{
    if(!ev)return false;
    var _ts=(typeof ev.timeStamp!=='undefined')?ev.timeStamp:0;
    if(!_ts)return false;
    var _ty=ev.type||'';
    if(!_ty)return false;
    var _tg=ev.target||null;
    if(_editEvtSeen.type===_ty&&_editEvtSeen.stamp===_ts&&_editEvtSeen.target===_tg)return true;
    _editEvtSeen.type=_ty; _editEvtSeen.stamp=_ts; _editEvtSeen.target=_tg;
    return false;
  }catch(e){ return false; }
}
function editClick(ev){
  try{ if(editEvtDedup(ev))return; }catch(_dedupE){}
  try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(_e){}
  /* Ctrl+Shift+单击进代码编辑抽屉（单元素 HTML+CSS）：复用定位，不进CTRL_PICK拾取 */
  if(ev&&(ev.ctrlKey||ev.metaKey)&&ev.shiftKey){
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    try{ if(CTRL_PICK&&CTRL_PICK.holding){ CTRL_PICK.holding=false; try{ CTRL_PICK.exit(); }catch(e){} } }catch(e2){}
    try{
      var _csT=(ev&&ev.target)||null;
      if(_csT&&_csT.nodeType===1&&typeof codeEditOpenFromLive==='function'){
        codeEditOpenFromLive(_csT);
      }
    }catch(e3){}
    return;
  }
  if(ev.ctrlKey || ev.metaKey){
    if(CTRL_PICK && !CTRL_PICK.holding){
      CTRL_PICK.holding = true;
      CTRL_PICK.enter();
    }
    var t = ev.target;
    if(t && t.nodeType === 1) CTRL_PICK.toggle(t, ev);
    return;
  }
  if(!(CTRL_PICK && CTRL_PICK.holding)) return; /* T3.2:非holding点击不进openInspector，由顶部Ctrl分支接管 */
  var t = ev.target;
  if(!t || t.nodeType !== 1) return;
  ev.preventDefault(); ev.stopPropagation();
  var tag = String(t.tagName||'').toLowerCase();
  if(tag==='html'||tag==='body') return;
  EDIT_HOVER_EL = t;
  EDIT_LOCKED_EL = t;
  try {
    var _fd2 = null;
    try { _fd2 = (typeof frame !== 'undefined' && frame && frame.contentDocument) ? frame.contentDocument : null; } catch (e) {}
    if (!t.ownerDocument || !_fd2 || t.ownerDocument !== _fd2) {
      try {
        if (typeof showToast === 'function') showToast('仅支持绑定原型内的元素，请点击预览区元素。');
        else if (typeof libStatus === 'function') libStatus('仅支持绑定原型内的元素，请点击预览区元素。');
      } catch (e2) {}
      return;
    }
  } catch (e) {}
  if(window.LinkBind) LinkBind.openInspector(t);
}
function editAttach(){
  var d=editFrameDoc(); if(!d)return;
  var _fw=null; try{ _fw=(typeof frame!=='undefined'&&frame&&frame.contentWindow)?frame.contentWindow:null; }catch(_fe){}
  if(!d.__editAttached){
  d.__editAttached=true;
  try{
    d.addEventListener('mousedown', function(ev){
      if(CTRL_PICK && CTRL_PICK.holding){
        if(!ev.altKey && !ev.shiftKey) ev.preventDefault();
      }
    }, true);
    d.addEventListener('mousemove', editHover, true);
    d.addEventListener('click', editClick, true);
    d.addEventListener('mouseleave', function(){ editHideHover(); }, true);
  }catch(e){}
  }
  if(!d.__inlineAttached){
    d.__inlineAttached=true;
    try{ d.addEventListener('mousedown', inlineEditFrameMouseDown, true); }catch(e3){}
    try{ d.addEventListener('scroll', function(){ try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)inlineEditPosition(); }catch(e){} },{capture:true,passive:true}); }catch(e4){}
  }
  /* 抢占式：window capture先于document，与原型库注册顺序无关；document保留兼容，靠editEvtDedup防重入 */
  try{ if(_fw&&_fw.addEventListener){ _fw.addEventListener('click', editClick, true); } }catch(_we){}
}
/* 注：原此处对 frame.load 的 editAttach 重复注册已删除，职责由下方 Ctrl 拾取初始化代码（bindCtrlInspectListeners + 滚动重绘）统一接管 */
/* ======= iter22 预览区就地改（Ctrl+Shift+单击）：纯文本模式，不限标签，仅直接文本叶可进 =======
   初值按子节点顺序取直接文本节点内容与<br>转成的换行拼成纯文本（子元素内部不展平）；保存按\n拆分回填直接文本节点，<br>占一个换行位，多余并入末段，缺行保留原文，子元素不动；
   选择器恰1定位+沙箱写盘+失败转AI队列链路不变；LinkBind 覆盖层与徽标排除；与 CTRL_PICK 互斥；AI 生成中禁用。 */
var INLINE_EDIT={open:false,target:null,selector:'',file:'',dir:'',initHtml:'',initText:'',pop:null,ta:null,saveBtn:null,outsideHandler:null,savedRect:null,openAt:0};
function inlineEditIsAiBusy(){ try{ if(typeof aiBusy!=='undefined'&&aiBusy)return true; }catch(e){} try{ if(window.aiBusy)return true; }catch(e2){} return false; }
function inlineEditToast(msg){ try{ if(typeof showToast==='function'){ showToast(msg); return; } }catch(e){} try{ if(typeof libStatus==='function'){ libStatus(msg); return; } }catch(e2){} try{ alert(msg); }catch(e3){} }
function inlineEditIsTextTag(tag){ return true; /* iter22 纯文本模式：不限标签（P/LI/TD/TH/H1-H6/div/span/a一视同仁），准入改由 inlineEditHasDirectText 判定；保留函数名防外部引用报错 */ }
function inlineEditHasDirectText(el){ try{ if(!el||el.nodeType!==1||!el.childNodes)return false; var cn=el.childNodes; for(var i=0;i<cn.length;i++){ var n=cn[i]; if(n&&n.nodeType===3){ var v=String(n.nodeValue!=null?n.nodeValue:''); try{ if(v.trim()!=='')return true; }catch(e){ if(v.replace(/^\s+|\s+$/g,'')!=='')return true; } } } }catch(e){ return false; } return false; }
function inlineEditGetDirectText(el){ try{ if(!el||!el.childNodes)return ''; var out='',cn=el.childNodes; for(var i=0;i<cn.length;i++){ var n=cn[i]; if(!n)continue; if(n.nodeType===3){ out+=String(n.nodeValue!=null?n.nodeValue:(n.textContent||'')); }else if(n.nodeType===1&&String(n.tagName||'').toLowerCase()==='br'){ out+='\n'; } } return out; }catch(e){ return ''; } }
function inlineEditApplyDirectText(hitEl,newText){ try{ if(!hitEl||!hitEl.childNodes)return {ok:false,overflow:false,applied:0,total:0}; var norm=String(newText!=null?newText:'').replace(/\r\n/g,'\n').replace(/\r/g,'\n'); var lines=norm.split('\n'); var texts=[],cn=hitEl.childNodes; for(var i=0;i<cn.length;i++){ if(cn[i]&&cn[i].nodeType===3)texts.push(cn[i]); } if(!texts.length)return {ok:false,overflow:false,applied:0,total:0}; var overflow=false; for(var j=0;j<texts.length;j++){ if(j<lines.length){ if(j===texts.length-1&&lines.length>texts.length){ try{ texts[j].nodeValue=lines.slice(j).join('\n'); }catch(e2){ try{ texts[j].textContent=lines.slice(j).join('\n'); }catch(e3){} } overflow=true; }else{ try{ texts[j].nodeValue=lines[j]; }catch(e4){ try{ texts[j].textContent=lines[j]; }catch(e5){} } } } } return {ok:true,overflow:overflow,applied:Math.min(texts.length,lines.length),total:texts.length}; }catch(e){ return {ok:false,overflow:false,applied:0,total:0}; } }
function inlineEditIsChrome(el){
  try{
    if(!el||!el.tagName)return true;
    var tag=String(el.tagName).toLowerCase();
    if(tag==='html'||tag==='body'||tag==='script'||tag==='style'||tag==='link'||tag==='meta'||tag==='iframe')return true;
    if(el.hasAttribute&&el.hasAttribute('data-plrt'))return true;
    if(el.closest){
      try{ if(el.closest('[data-plrt]'))return true; }catch(e){}
      try{ if(el.closest('.selection-box-overlay,.selection-badge,.anno-badge,#selectionOverlay,#editHover,#ctrlPickTip'))return true; }catch(e2){}
    }
    var cls=''; try{ cls=String(el.className||''); }catch(e){}
    if(/selection-box-overlay|selection-badge|anno-badge/.test(cls))return true;
    try{ if(el.id==='selectionOverlay'||el.id==='editHover'||el.id==='ctrlPickTip')return true; }catch(e){}
    try{
      if(el.parentElement&&String(el.parentElement.tagName||'').toLowerCase()==='body'){
        var tx=String(el.textContent||'').trim();
        if(tx.indexOf('跳转至 ')===0&&el.style&&String(el.style.zIndex)==='99999')return true;
      }
    }catch(e){}
  }catch(e){ return false; }
  return false;
}
function inlineEditCaptureScroll(){
  var s={x:0,y:0,hash:'',sub:''};
  try{ if(typeof editQueueCurHtmlFile==='function')s.sub=editQueueCurHtmlFile()||''; }catch(e){}
  try{ if(frame&&frame.contentWindow){ s.x=frame.contentWindow.scrollX||0; s.y=frame.contentWindow.scrollY||0; try{ s.hash=frame.contentWindow.location.hash||''; }catch(e){} } }catch(e2){}
  try{ var d=editFrameDoc(); if(d){ if(d.documentElement){ s.x=s.x||d.documentElement.scrollLeft||0; s.y=s.y||d.documentElement.scrollTop||0; } if(d.body){ s.x=s.x||d.body.scrollLeft||0; s.y=s.y||d.body.scrollTop||0; } } }catch(e3){}
  return s;
}
function inlineEditSilentRefresh(saved,file){
  try{
    try{ window.__aiQuietRefresh=true; }catch(e){}
    try{ if(saved){ window._refreshSavedSub=saved.sub||file||''; window._refreshSavedHash=saved.hash||''; } }catch(e2){}
    var needSub=saved&&saved.sub&&/\.html$/i.test(String(saved.sub));
    if(typeof loadSandboxSources==='function'){ loadSandboxSources(needSub?saved.sub:undefined, true); }
    else if(typeof loadSubPage==='function'&&needSub&&typeof currentSource!=='undefined'&&currentSource){ try{ loadSubPage(currentSource,saved.sub); }catch(e){} try{ window.__aiQuietRefresh=false; }catch(e2){} }
    else if(typeof loadSource==='function'&&typeof currentSource!=='undefined'&&currentSource){ try{ loadSource(currentSource,'preserve'); }catch(e){} try{ window.__aiQuietRefresh=false; }catch(e2){} }
    else{ try{ window.__aiQuietRefresh=false; }catch(e){} }
    var tries=0;
    var timer=setInterval(function(){
      tries++;
      try{
        var fw=frame&&frame.contentWindow?frame.contentWindow:null;
        if(fw){
          try{ if(saved.hash&&fw.location.hash!==saved.hash)fw.location.hash=saved.hash; }catch(e){}
          try{ fw.scrollTo(saved.x||0,saved.y||0); }catch(e2){}
          try{ var dd=fw.document; if(dd){ if(dd.documentElement){ dd.documentElement.scrollLeft=saved.x||0; dd.documentElement.scrollTop=saved.y||0; } if(dd.body){ dd.body.scrollLeft=saved.x||0; dd.body.scrollTop=saved.y||0; } } }catch(e3){}
        }
      }catch(e){}
      if(tries>=8){ try{ clearInterval(timer); }catch(e){} }
    },180);
    try{
      var onL=function(){ try{ var fw2=frame&&frame.contentWindow?frame.contentWindow:null; if(fw2){ try{ fw2.scrollTo(saved.x||0,saved.y||0); }catch(e){} } }catch(e){} try{ frame.removeEventListener('load',onL); }catch(e2){} };
      if(frame)frame.addEventListener('load',onL);
      setTimeout(function(){ try{ frame.removeEventListener('load',onL); }catch(e){} },2500);
    }catch(e){}
  }catch(e){ try{ window.__aiQuietRefresh=false; }catch(e2){} }
}
function inlineEditPosition(){
  try{
    var pop=INLINE_EDIT.pop,p=INLINE_EDIT.savedRect;
    if(!pop||!p)return;
    var w=440,h=220;
    try{ w=pop.offsetWidth||440; h=pop.offsetHeight||220; }catch(e){}
    var vw=window.innerWidth||1024,vh=window.innerHeight||768;
    try{ if(!(vw>80))vw=1024; if(!(vh>80))vh=768; }catch(e2){}
    var left=p.left;
    try{
      if(typeof left!=='number'||isNaN(left))left=8;
      left=Math.max(8,Math.min(left,Math.max(8,vw-w-8)));
    }catch(e3){ try{ left=8; }catch(e4){} }
    var top=p.top+p.height+8;
    try{
      if(typeof top!=='number'||isNaN(top))top=8;
      if(top+h>vh-8){ top=p.top-h-8; }
      top=Math.max(8,Math.min(top,Math.max(8,vh-h-8)));
    }catch(e5){ try{ top=8; }catch(e6){} }
    try{ pop.style.left=left+'px'; pop.style.top=top+'px'; }catch(e7){}
  }catch(e){}
}
function inlineEditCloseDom(){ try{ if(INLINE_EDIT.pop&&INLINE_EDIT.pop.parentNode)INLINE_EDIT.pop.parentNode.removeChild(INLINE_EDIT.pop); }catch(e){} INLINE_EDIT.pop=null; INLINE_EDIT.ta=null; INLINE_EDIT.saveBtn=null; }
function inlineEditCloseNow(){
  try{ if(window.MaskStack&&window.MaskStack.pop)window.MaskStack.pop('inlineEditPop'); }catch(e){}
  inlineEditCloseDom();
  INLINE_EDIT.open=false; INLINE_EDIT.target=null; INLINE_EDIT.selector=''; INLINE_EDIT.initHtml=''; INLINE_EDIT.initText=''; INLINE_EDIT.file=''; INLINE_EDIT.dir=''; INLINE_EDIT.savedRect=null;
}
function inlineEditTryClose(){
  if(!INLINE_EDIT.open)return;
  var cur='';
  try{ cur=INLINE_EDIT.ta?INLINE_EDIT.ta.value:''; }catch(e){}
  if(cur!==INLINE_EDIT.initText){
    var ok=false;
    try{ ok=window.confirm('内容已修改，确定放弃本次就地改吗？'); }catch(e){ ok=false; }
    if(!ok)return;
  }
  inlineEditCloseNow();
}
function inlineEditOutsideDown(ev){
  try{
    if(!INLINE_EDIT.open||!INLINE_EDIT.pop)return;
    if(INLINE_EDIT.openAt&&(Date.now()-INLINE_EDIT.openAt)<350)return;
    if(INLINE_EDIT.pop.contains(ev.target))return;
  }catch(e){ return; }
  inlineEditTryClose();
}
function inlineEditFrameMouseDown(){
  try{ if(!INLINE_EDIT.open)return; }catch(e){ return; }
  try{ if(INLINE_EDIT.openAt&&(Date.now()-INLINE_EDIT.openAt)<350)return; }catch(e){}
  inlineEditTryClose();
}
function inlineEditQueueFallback(newText,note){
  try{
    if(typeof editQueueAdd==='function'&&INLINE_EDIT.target)editQueueAdd(INLINE_EDIT.target,'将该元素内容改为：\n'+String(newText||''));
  }catch(e){}
  inlineEditToast(note||'已转AI队列，请用Ctrl+拾取提交。');
}
/* ═══════ 代码编辑抽屉（Ctrl+Shift 新版，单元素）：元素 HTML（上 2/3）+ 关联 CSS（下 1/3）
 * PC：右侧抽屉 + 遮罩；移动端：嵌文档面板区、无遮罩。保存写盘后静默刷新原型。 */
var CODE_EDIT={open:false,mode:'drawer',dir:'',file:'',selector:'',label:'',html:'',css:'',root:null,mask:null,taHtml:null,taCss:null,hiddenDocs:null,matchIndex:-1,backfilling:false,searchBar:null,searchInput:null,searchCount:null,search:{q:'',pos:[],idx:-1}};
function codeEditIsDirty(){
  try{
    if(!CODE_EDIT.open||!CODE_EDIT.taHtml) return false;
    var curH=String(CODE_EDIT.taHtml.value||''), curC=String((CODE_EDIT.taCss&&CODE_EDIT.taCss.value)||'');
    return curH!==String(CODE_EDIT.html||'')||curC!==String(CODE_EDIT.css||'');
  }catch(e){ return false; }
}
function codeEditOnlyPopup(){
  /* 仅代码编辑独占时允许 Ctrl+Shift 切换选中（其它弹窗仍互斥，避免复制粘贴干扰） */
  try{
    var st=null; try{ st=window.MaskStack&&window.MaskStack.stack?window.MaskStack.stack:null; }catch(e){}
    if(st&&st.length){
      for(var i=0;i<st.length;i++){ var id=String(st[i]&&(st[i].id||'')); if(id&&id!=='codeEditMask') return false; }
    }
    var ids=['aiMask','editDrawerMask','linkInspMask','linkMgrMask','docShortcutMask','nameMask','kindMask','apiProfileMask','gitPushMask','gitPullMask','gitConfigMask','uispecAddMask','projMask','reqMask','docsMask','multiEditMask'];
    for(var j=0;j<ids.length;j++){
      var el=null; try{ el=document.getElementById(ids[j]); }catch(e){ el=null; }
      if(el&&el.style&&(el.style.display==='block'||el.style.display==='flex')) return false;
    }
    var drawers=['editDrawer','linkInspector','linkMgrDrawer'];
    for(var k=0;k<drawers.length;k++){
      var d=null; try{ d=document.getElementById(drawers[k]); }catch(e){ d=null; }
      if(d&&d.classList&&d.classList.contains('open')) return false;
    }
    return true;
  }catch(e){ return false; }
}
function codeEditIsPc(){
  var isPc=false;
  try{ isPc=(typeof pcMode==='function'&&pcMode()); }catch(e){}
  try{ if(!isPc&&document.body&&document.body.classList.contains('kind-pc'))isPc=true; }catch(e){}
  return !!isPc;
}
function codeEditToast(msg){ try{ if(typeof showToast==='function'){ showToast(msg); return; } }catch(e){} try{ if(typeof libStatus==='function'){ libStatus(msg); return; } }catch(e){} try{ alert(msg); }catch(e2){} }
/* 收集命中元素的关联 CSS（文本级解析，不依赖 CSSOM sheet， detached 文档也稳定；
 * 含行内 style 提示、祖先命中规则（标注）、外部表提示；存回覆盖块的都是原文真实规则） */
/* 按逗号切分选择器组（括号/引号感知，避免 :not(.a,.b) 被误切） */
function codeEditSplitSels(sel){
  var out=[], cur='', depth=0, q=null;
  try{
    var s=String(sel||'');
    for(var i=0;i<s.length;i++){
      var c=s[i];
      if(q){ cur+=c; if(c==='\\'&&i+1<s.length){ cur+=s[++i]; } else if(c===q) q=null; continue; }
      if(c==='"'||c==="'"){ q=c; cur+=c; continue; }
      if(c==='('||c==='[') depth++;
      else if(c===')'||c===']'){ if(depth>0)depth--; }
      if(c===','&&depth===0){ if(cur.trim())out.push(cur.trim()); cur=''; continue; }
      cur+=c;
    }
    if(cur.trim())out.push(cur.trim());
  }catch(e){}
  return out;
}
/* 文本级 CSS 切块：顶层 选择器{...} 逐条返回，分组 @media/@supports 等递归展开并透传 header */
function codeEditParseCssBlocks(cssText, headers, out){
  try{
    var t=String(cssText||'');
    headers=headers||[]; out=out||[];
    var n=t.length, i=0;
    var readBlock=function(){
      var depth=0, j=i, instr=null;
      for(;j<n;j++){
        var c=t[j];
        if(instr){ if(c==='\\'){ j++; continue; } if(c===instr)instr=null; continue; }
        if(c==='"'||c==="'"){ instr=c; continue; }
        if(c==='{')depth++;
        else if(c==='}'){ depth--; if(depth===0)return {body:t.slice(i+1,j), end:j+1}; }
      }
      return {body:t.slice(i+1), end:n};
    };
    while(true){
      while(i<n&&/\s/.test(t[i]))i++;
      if(i>=n)break;
      if(t[i]==='@'){
        var hs=t.indexOf('{',i), sc=t.indexOf(';',i);
        if(hs<0||(sc>=0&&sc<hs)){ i=(sc>=0?sc+1:n); continue; }
        var header=t.slice(i,hs).trim().replace(/\s+/g,' ');
        i=hs;
        var blk=readBlock(); i=blk.end;
        codeEditParseCssBlocks(blk.body, headers.concat([header]), out);
        continue;
      }
      if(t[i]==='}'){ i++; continue; }
      var he=t.indexOf('{',i);
      if(he<0)break;
      var sel=t.slice(i,he).trim();
      i=he;
      var b2=readBlock(); i=b2.end;
      if(sel) out.push({headers:headers.slice(), sel:sel, body:b2.body.trim()});
    }
  }catch(e){}
  return out;
}
function codeEditCollectCss(pdoc, el){
  var out=[], total=0, seen={};
  var push=function(txt){
    if(!txt) return true;
    total+=txt.length;
    if(total>100*1024){ out.push('/* …关联 CSS 过长，已截断… */'); return false; }
    out.push(txt);
    return true;
  };
  try{
    if(!pdoc||!el||el.nodeType!==1) return '';
    /* 1. 行内 style 属性（注释形式，只读不入覆盖，避免误写入生效） */
    try{
      var inlineDecl=String((el.getAttribute&&el.getAttribute('style'))||'').trim();
      if(inlineDecl){
        var tg=''; try{ tg=String(el.tagName||'').toLowerCase(); }catch(e){}
        if(!push('/* ◈ 当前元素行内 style（只读，改 HTML 区对应标签）：'+tg+' { '+inlineDecl+' } */')) return out.join('\n\n');
      }
    }catch(e){}
    /* 2. 同文件 <style> 文本解析（自身命中 + 祖先命中标注，去重） */
    var ancCap=80, ancCount=0, ancSkipped=0;
    try{
      var styles=pdoc.querySelectorAll('style');
      for(var si=0; si<styles.length; si++){
        var cssText='';
        try{ cssText=String(styles[si].textContent||''); }catch(e){ continue; }
        if(!cssText.trim()) continue;
        var rules=[];
        try{ rules=codeEditParseCssBlocks(cssText.replace(/\/\*[\s\S]*?\*\//g,''),[],[]); }catch(e){ continue; }
        for(var ri=0; ri<rules.length; ri++){
          var r=rules[ri], matched='', ancTag='';
          try{
            var sels=codeEditSplitSels(r.sel);
            for(var pi=0; pi<sels.length; pi++){
              var one=sels[pi]; if(!one) continue;
              var selfHit=false;
              try{ selfHit=!!el.matches(one); }catch(e){ continue; }
              if(selfHit){ matched='self'; break; }
              try{
                var an=el.parentElement, ad=0;
                while(an&&an.nodeType===1&&ad<6){
                  var ok=false;
                  try{ ok=!!an.matches(one); }catch(e2){}
                  if(ok){
                    matched='anc';
                    try{
                      var at=String(an.tagName||'').toLowerCase();
                      var ac=String((an.getAttribute&&an.getAttribute('class'))||'').split(/\s+/)[0]||'';
                      ancTag=at+(ac?('.'+ac):'');
                    }catch(e3){}
                    break;
                  }
                  try{ if(String(an.tagName||'').toLowerCase()==='body') break; }catch(e4){}
                  an=an.parentElement; ad++;
                }
              }catch(e5){}
              if(matched) break;
            }
          }catch(e){ continue; }
          if(!matched) continue;
          var txt='';
          try{
            var head='';
            if(r.headers&&r.headers.length) head=r.headers.join(' / ');
            var core=r.sel+'{\n'+r.body+'\n}';
            if(head) core=head+'{\n'+core+'\n}';
            txt=(matched==='anc'?('/* 祖先 '+ancTag+' 命中 */\n'):'')+core;
          }catch(e){ continue; }
          if(seen[txt]) continue;
          seen[txt]=1;
          if(matched==='anc'){
            if(ancCount>=ancCap){ ancSkipped++; continue; }
            ancCount++;
          }
          if(!push(txt)) return out.join('\n\n');
        }
      }
      if(ancSkipped>0){ push('/* …还有 '+ancSkipped+' 条祖先规则未展开… */'); }
    }catch(e){}
    /* 3. 外部样式表提示（只读不展开，避免保存污染） */
    try{
      var links=pdoc.querySelectorAll('link[rel]');
      var exts=[];
      for(var li=0; li<links.length; li++){
        try{
          var rel=String(links[li].getAttribute('rel')||'').toLowerCase();
          if((' '+rel.replace(/\s+/g,' ').trim()+' ').indexOf(' stylesheet ') < 0) continue;
          var href=String(links[li].getAttribute('href')||'').trim();
          if(href) exts.push(href.slice(0,120));
        }catch(e){}
      }
      if(exts.length) push('/* 提示：本文件还引用了外部样式表（本次未展开）：'+exts.join('、')+' */');
    }catch(e){}
  }catch(e){}
  return out.join('\n\n');
}
function codeEditClose(silent){
  try{
    if(CODE_EDIT.mask&&CODE_EDIT.mask.parentNode) CODE_EDIT.mask.parentNode.removeChild(CODE_EDIT.mask);
  }catch(e){}
  try{
    if(CODE_EDIT.root&&CODE_EDIT.root.parentNode) CODE_EDIT.root.parentNode.removeChild(CODE_EDIT.root);
  }catch(e){}
  try{
    if(window.MaskStack&&window.MaskStack.pop) window.MaskStack.pop('codeEditMask');
  }catch(e){}
  try{
    var hd=CODE_EDIT.hiddenDocs;
    if(hd&&hd.title&&hd.title.parentNode){ hd.title.style.display=hd.titleDisp||''; }
    if(hd&&hd.content&&hd.content.parentNode){ hd.content.style.display=hd.contentDisp||''; }
    if(hd&&hd.head&&hd.head.parentNode){ hd.head.style.display=hd.headDisp||''; }
    if(hd&&hd.tabs&&hd.tabs.parentNode){ hd.tabs.style.display=hd.tabsDisp||''; }
    if(hd&&hd.search&&hd.search.parentNode){ hd.search.style.display=hd.searchDisp||''; }
    if(hd&&hd.hotzone&&hd.hotzone.parentNode){ hd.hotzone.style.display=hd.hotzoneDisp||''; }
  }catch(e){}
  CODE_EDIT.open=false; CODE_EDIT.mode='drawer';
  CODE_EDIT.root=null; CODE_EDIT.mask=null; CODE_EDIT.taHtml=null; CODE_EDIT.taCss=null; CODE_EDIT.hiddenDocs=null;
  CODE_EDIT.matchIndex=-1;
  CODE_EDIT.searchBar=null; CODE_EDIT.searchInput=null; CODE_EDIT.searchCount=null;
  try{ CODE_EDIT.search={q:'',pos:[],idx:-1}; }catch(e){}
  CODE_EDIT.dir=''; CODE_EDIT.file=''; CODE_EDIT.selector=''; CODE_EDIT.label=''; CODE_EDIT.html=''; CODE_EDIT.css='';
  if(!silent){ try{ libStatus('已关闭代码编辑。'); }catch(e){} }
}
function codeEditBuildShell(titleText){
  var root=document.createElement('aside');
  root.id='codeEditDrawer'; root.className='side-drawer code-edit-drawer';
  var hd=document.createElement('header'); hd.className='sd-hd';
  var b=document.createElement('b'); b.textContent='代码编辑'; hd.appendChild(b);
  var sub=document.createElement('span'); sub.className='code-edit-sub'; sub.textContent=String(titleText||'');
  hd.appendChild(sub);
  var x=document.createElement('span'); x.className='sd-x'; x.title='关闭'; x.textContent='✕';
  x.onclick=function(){ codeEditClose(); };
  hd.appendChild(x);
  root.appendChild(hd);
  var searchBar=document.createElement('div'); searchBar.className='code-edit-search';
  var searchInput=document.createElement('input'); searchInput.className='code-edit-search-input'; searchInput.type='text'; searchInput.placeholder='搜索当前代码（Ctrl+F）'; searchInput.spellcheck=false; searchInput.setAttribute('autocomplete','off');
  var searchCount=document.createElement('span'); searchCount.className='code-edit-search-count'; searchCount.textContent='0/0';
  var searchPrev=document.createElement('button'); searchPrev.type='button'; searchPrev.className='docs-btn'; searchPrev.textContent='上一个'; searchPrev.title='上一个(Shift+Enter)';
  var searchNext=document.createElement('button'); searchNext.type='button'; searchNext.className='docs-btn'; searchNext.textContent='下一个'; searchNext.title='下一个(Enter)';
  var searchClose=document.createElement('button'); searchClose.type='button'; searchClose.className='docs-btn'; searchClose.textContent='✕'; searchClose.title='关闭(Esc)';
  searchBar.appendChild(searchInput); searchBar.appendChild(searchCount); searchBar.appendChild(searchPrev); searchBar.appendChild(searchNext); searchBar.appendChild(searchClose);
  root.appendChild(searchBar);
  searchInput.addEventListener('input',function(){ try{ codeEditSearchDo(searchInput.value); }catch(e){} });
  searchInput.addEventListener('keydown',function(ev){
    try{
      if(ev.key==='Enter'){ ev.preventDefault(); try{ codeEditSearchGoto(ev.shiftKey?-1:1); }catch(err){} }
      else if(ev.key==='Escape'){ ev.preventDefault(); try{ if(ev.stopPropagation)ev.stopPropagation(); }catch(err){} try{ codeEditSearchClose(); }catch(err2){} try{ if(CODE_EDIT.taHtml)CODE_EDIT.taHtml.focus(); }catch(err3){} }
    }catch(err){}
  });
  searchPrev.onclick=function(){ try{ codeEditSearchGoto(-1); }catch(e){} };
  searchNext.onclick=function(){ try{ codeEditSearchGoto(1); }catch(e){} };
  searchClose.onclick=function(){ try{ codeEditSearchClose(); }catch(e){} };
  var body=document.createElement('div'); body.className='code-edit-body';
  var secH=document.createElement('div'); secH.className='code-edit-sec code-edit-sec-html';
  var labH=document.createElement('div'); labH.className='code-edit-label'; labH.textContent='元素代码';
  var taH=document.createElement('textarea'); taH.className='code-edit-ta'; taH.spellcheck=false;
  taH.placeholder='选中元素的 HTML（含内部全部子元素）';
  secH.appendChild(labH); secH.appendChild(taH); body.appendChild(secH);
  var secC=document.createElement('div'); secC.className='code-edit-sec code-edit-sec-css';
  var labC=document.createElement('div'); labC.className='code-edit-label'; labC.textContent='关联 CSS（保存时写入文件末尾覆盖块）';
  var taC=document.createElement('textarea'); taC.className='code-edit-ta'; taC.spellcheck=false;
  taC.placeholder='命中该元素的 CSS 规则';
  secC.appendChild(labC); secC.appendChild(taC); body.appendChild(secC);
  root.appendChild(body);
  var foot=document.createElement('div'); foot.className='ed-foot';
  var cancelBtn=document.createElement('button'); cancelBtn.type='button'; cancelBtn.className='docs-btn'; cancelBtn.textContent='取消';
  cancelBtn.onclick=function(){ codeEditClose(); };
  var saveBtn=document.createElement('button'); saveBtn.type='button'; saveBtn.className='docs-btn primary'; saveBtn.textContent='保存';
  saveBtn.onclick=function(){ codeEditSave(); };
  foot.appendChild(cancelBtn); foot.appendChild(saveBtn); root.appendChild(foot);
  return { root: root, taHtml: taH, taCss: taC, searchBar: searchBar, searchInput: searchInput, searchCount: searchCount };
}
function codeEditSearchUpdateCount(a,b){ try{ if(CODE_EDIT.searchCount)CODE_EDIT.searchCount.textContent=String(a||0)+'/'+String(b||0); }catch(e){} }
function codeEditSearchFocusPos(){
  try{
    var st=CODE_EDIT.search; if(!st||!st.pos.length||st.idx<0) return;
    var at=st.pos[st.idx], q=String(st.q||'');
    var ta=at.ta==='css'?CODE_EDIT.taCss:CODE_EDIT.taHtml;
    if(!ta) return;
    try{ ta.focus(); }catch(e){}
    try{ ta.setSelectionRange(at.idx,at.idx+q.length); }catch(e){}
    try{
      var text=String(ta.value||'');
      var line=text.slice(0,at.idx).split('\n').length-1;
      ta.scrollTop=Math.max(0,line*18-ta.clientHeight/2);
    }catch(e){}
  }catch(e){}
}
function codeEditSearchDo(q){
  q=String(q==null?'':q);
  try{ CODE_EDIT.search.q=q; }catch(e){}
  if(!q){ try{ CODE_EDIT.search.pos=[]; CODE_EDIT.search.idx=-1; }catch(e){} codeEditSearchUpdateCount(0,0); return; }
  var pos=[];
  try{
    var html=String(CODE_EDIT.taHtml?CODE_EDIT.taHtml.value:''), css=String(CODE_EDIT.taCss?CODE_EDIT.taCss.value:'');
    var qLow=q.toLowerCase(), hLow=html.toLowerCase(), cLow=css.toLowerCase();
    var i=hLow.indexOf(qLow);
    while(i>=0){ pos.push({ta:'html',idx:i}); if(pos.length>500)break; i=hLow.indexOf(qLow,i+Math.max(1,q.length)); }
    var j=cLow.indexOf(qLow);
    while(j>=0){ pos.push({ta:'css',idx:j}); if(pos.length>1000)break; j=cLow.indexOf(qLow,j+Math.max(1,q.length)); }
  }catch(e){}
  try{ CODE_EDIT.search.pos=pos; CODE_EDIT.search.idx=-1; }catch(e){}
  codeEditSearchUpdateCount(0,pos.length);
  /* 输入只计数不定 cursor，定位统一走回车/上下个（codeEditSearchGoto），避免抢焦点误改代码 */
}
function codeEditSearchGoto(dir){
  try{
    var st=CODE_EDIT.search; if(!st||!st.pos||!st.pos.length) return;
    var n=st.pos.length, cur=st.idx;
    if(!(cur>=0&&cur<n)) cur=(dir<0?n-1:0);
    else cur=(cur+(dir<0?-1:1)+n)%n;
    st.idx=cur;
    codeEditSearchUpdateCount(cur+1,n);
    codeEditSearchFocusPos();
  }catch(e){}
}
function codeEditSearchOpen(){
  try{
    if(!CODE_EDIT.open||!CODE_EDIT.searchBar||!CODE_EDIT.searchInput) return;
    CODE_EDIT.searchBar.classList.add('open');
    try{
      if(!CODE_EDIT.searchInput.value){
        var sel='';
        try{ sel=String((window.getSelection?window.getSelection().toString():'')||'').slice(0,40); }catch(e){}
        if(sel&&sel.indexOf('\n')<0) CODE_EDIT.searchInput.value=sel;
      }
    }catch(e){}
    try{ CODE_EDIT.searchInput.focus(); if(CODE_EDIT.searchInput.select)CODE_EDIT.searchInput.select(); }catch(e){}
    try{ codeEditSearchDo(CODE_EDIT.searchInput.value); }catch(e){}
  }catch(e){}
}
function codeEditSearchClose(){
  try{
    if(CODE_EDIT.searchBar)CODE_EDIT.searchBar.classList.remove('open');
  }catch(e){}
  try{ CODE_EDIT.search={q:'',pos:[],idx:-1}; }catch(e){}
  codeEditSearchUpdateCount(0,0);
}
try{
  if(typeof document!=='undefined'&&!document.__codeEditSearchKeyBound){
    document.__codeEditSearchKeyBound=true;
    document.addEventListener('keydown',function(e){
      try{
        var k=e.key||'';
        var isF=(k==='f'||k==='F');
        if((e.ctrlKey||e.metaKey)&&isF){
          var t=e.target||null, inCode=false;
          try{
            if(t&&t.closest){
              if(t.closest('#codeEditDrawer')||t.closest('#codeEditInline')||t.closest('.code-edit-search')) inCode=true;
            }
          }catch(err){}
          if(inCode){
            e.preventDefault();
            try{ if(e.stopPropagation)e.stopPropagation(); }catch(err){}
            try{ codeEditSearchOpen(); }catch(err2){}
            return;
          }
        }
        if((k==='Escape'||k==='Esc'||e.keyCode===27)){
          try{
            if(CODE_EDIT&&CODE_EDIT.open&&CODE_EDIT.searchBar&&CODE_EDIT.searchBar.classList.contains('open')){
              e.preventDefault();
              try{ if(e.stopPropagation)e.stopPropagation(); }catch(err){}
              codeEditSearchClose();
              return;
            }
          }catch(err){}
        }
      }catch(err){}
    },true);
  }
}catch(e){}
/* 选择器在源文件命中多条时，按文本/层级/序号自动消歧（重复组件如列表卡片常见）；返回唯一元素或 null */
function codeEditDisambiguate(pdoc, hits, hint){
  try{
    var list=[]; try{ for(var i=0;i<hits.length;i++) list.push(hits[i]); }catch(e){ return null; }
    if(!list.length) return null;
    hint=(hint&&typeof hint==='object')?hint:{};
    var norm=function(s){ try{ return String(s==null?'':s).replace(/\s+/g,' ').trim().slice(0,48).toLowerCase(); }catch(e){ return ''; } };
    var ht=norm(hint.text||hint.label||'');
    if(ht&&ht.length>=2){
      var key=ht.slice(0,16), matched=[];
      for(var a=0;a<list.length;a++){
        try{
          var ct=norm(list[a].textContent||'');
          if(!ct) continue;
          if(ct.indexOf(key)>=0||key.indexOf(ct.slice(0,16))>=0) matched.push(list[a]);
        }catch(e){}
      }
      if(matched.length===1) return matched[0];
      if(matched.length>1) list=matched;
    }
    var anc=(hint.ancestors&&hint.ancestors.length)?hint.ancestors:[];
    if(anc&&anc.length){
      var chainOk=[];
      for(var b=0;b<list.length;b++){
        try{
          var chain=[], n=list[b]?list[b].parentElement:null, d=0;
          while(n&&n.nodeType===1&&d<8){
            var tg=''; try{ tg=String(n.tagName||'').toLowerCase(); }catch(e){}
            if(!tg||tg==='html') break;
            var s=tg;
            try{ var c0=String((n.getAttribute&&n.getAttribute('class'))||'').split(/\s+/)[0]||''; if(c0) s+='.'+c0; }catch(e2){}
            try{ if(n.id) s+='#'+String(n.id).slice(0,64); }catch(e3){}
            chain.unshift(s); n=n.parentElement; d++;
          }
          var tail=chain.slice(-anc.length).join('>');
          var want=anc.slice(0,8).join('>');
          if(tail===want) chainOk.push(list[b]);
        }catch(e){}
      }
      if(chainOk.length===1) return chainOk[0];
      if(chainOk.length>1) list=chainOk;
    }
    if(typeof hint.liveIndex==='number'&&hint.liveIndex>=0&&hint.liveIndex<list.length) return list[hint.liveIndex];
    return null;
  }catch(e){ return null; }
}
function codeEditOpen(opts){
  var o=(opts&&typeof opts==='object')?opts:{};
  var selector=String(o.selector||'').trim();
  var file=String(o.file||'').trim();
  var dir=String(o.dir||'').trim();
  if(!selector||!file||!dir){ codeEditToast('未能定位目标元素，请重试。'); return; }
  try{ if(inlineEditIsAiBusy()){ codeEditToast('AI 正在生成，请先停止再编辑。'); return; } }catch(e){}
  var sb=null;
  try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
  if(!sb||typeof sb.readFile!=='function'||typeof sb.write!=='function'){ codeEditToast('当前原型不支持直接写盘。'); return; }
  /* 切换选中：已有且脏则确认放弃，否则静默替换 */
  try{
    if(typeof CODE_EDIT!=='undefined'&&CODE_EDIT&&CODE_EDIT.open&&typeof codeEditIsDirty==='function'&&codeEditIsDirty()){
      var ok=false;
      try{ ok=window.confirm('当前代码已修改，切换元素将放弃本次修改，继续吗？'); }catch(e){ ok=false; }
      if(!ok) return;
    }
  }catch(e){}
  /* 单选：已有先关 */
  try{ codeEditClose(true); }catch(e){}
  var label=String(o.label||selector).slice(0,60);
  var hint={ text:String(o.text||o.label||''), label:label, ancestors:(o.ancestors&&o.ancestors.slice)?o.ancestors.slice(0,8):[], parentHtml:String(o.parentHtml||''), liveIndex:(typeof o.liveIndex==='number'?o.liveIndex:-1) };
  sb.readFile({dir:dir,file:file}).then(function(r){
    if(!r||!r.ok){ codeEditToast('源文件读取失败：'+((r&&r.error)||'未知错误')); return; }
    var srcHtml=String(r.content||'');
    var pdoc=null;
    try{ pdoc=new DOMParser().parseFromString(srcHtml,'text/html'); }catch(e){}
    if(!pdoc){ codeEditToast('源文件解析失败。'); return; }
    var hits=null;
    try{ hits=pdoc.querySelectorAll(selector); }catch(e){ codeEditToast('选择器在源文件无效：'+selector); return; }
    var el=null;
    if(hits&&hits.length===1){ el=hits[0]; }
    else if(hits&&hits.length>1){
      try{ el=codeEditDisambiguate(pdoc, hits, hint); }catch(e){ el=null; }
      if(el){ try{ if(typeof libStatus==='function')libStatus('已按内容自动定位唯一元素（'+hits.length+'选1）：'+label); }catch(e){} }
      else if(/data-pr-id\s*=/.test(selector)){ codeEditToast('稳定ID定位命中'+hits.length+'个（文件内重复，应唯一）。文件：'+file+'；选择器：'+selector+'。请点击其父级容器后编辑，或用Ctrl+拾取走AI队列。'); return; }
      else{ try{ codeEditBackfillPrIds(dir, file, srcHtml, selector, hint, label); }catch(e){ codeEditToast('源文件定位命中'+hits.length+'个（需恰好1个）。文件：'+file+'；选择器：'+selector+'。'); } return; }
    }
    else{ codeEditToast('源文件定位命中0个。文件：'+file+'；选择器：'+selector+'。可能已改名或跨子页面，请重新拾取。'); return; }
    var html='';
    try{ html=String(el.outerHTML||''); }catch(e){ html=''; }
    if(!html){ codeEditToast('元素内容为空，无法编辑。'); return; }
    if(html.length>512*1024){ codeEditToast('元素过大（超 512KB），请用 AI 队列处理。'); return; }
    var css='';
    try{ css=codeEditCollectCss(pdoc, el); }catch(e){ css=''; }
    var isPc=false;
    try{ isPc=codeEditIsPc(); }catch(e){}
    CODE_EDIT.open=true; CODE_EDIT.mode=isPc?'drawer':'inline';
    CODE_EDIT.dir=dir; CODE_EDIT.file=file; CODE_EDIT.selector=selector; CODE_EDIT.label=label;
    CODE_EDIT.html=html; CODE_EDIT.css=css;
    try{
      CODE_EDIT.matchIndex=-1;
      for(var _mi=0;_mi<hits.length;_mi++){ if(hits[_mi]===el){ CODE_EDIT.matchIndex=_mi; break; } }
    }catch(e){}
    if(isPc){
      var built=codeEditBuildShell(label);
      CODE_EDIT.root=built.root; CODE_EDIT.taHtml=built.taHtml; CODE_EDIT.taCss=built.taCss;
      CODE_EDIT.searchBar=built.searchBar; CODE_EDIT.searchInput=built.searchInput; CODE_EDIT.searchCount=built.searchCount;
      try{ CODE_EDIT.search={q:'',pos:[],idx:-1}; }catch(e){}
      CODE_EDIT.taHtml.value=html; CODE_EDIT.taCss.value=css;
      var mask=document.createElement('div');
      mask.id='codeEditMask'; mask.className='drawer-mask'; mask.style.display='block';
      try{ mask.style.pointerEvents='none'; }catch(e){}
      document.body.appendChild(mask);
      document.body.appendChild(built.root);
      CODE_EDIT.mask=mask;
      requestAnimationFrame(function(){ try{ built.root.classList.add('open'); }catch(e){} });
      try{ if(window.MaskStack&&window.MaskStack.push)window.MaskStack.push('codeEditMask',function(){ codeEditClose(); }); }catch(e){}
    }else{
      /* 移动端：嵌文档面板区展示，无遮罩 */
      try{
        if(typeof setDocsOpen==='function')setDocsOpen(true);
      }catch(e){}
      var bodyEl=null;
      try{ bodyEl=document.querySelector('.docs-panel .docs-body'); }catch(e){}
      if(!bodyEl){ codeEditToast('文档面板不可用。'); CODE_EDIT.open=false; return; }
      var titleEl=document.getElementById('docTitle'), contentEl=document.getElementById('docContent');
      var headEl=null, tabsEl=null, searchEl=null, hotEl=null;
      try{ headEl=document.querySelector('.docs-panel .docs-head'); }catch(e){}
      try{ tabsEl=document.getElementById('docModeTabs'); }catch(e){}
      try{ searchEl=document.getElementById('docSearchBox'); }catch(e){}
      try{ hotEl=document.querySelector('.doc-hotzone'); }catch(e){}
      CODE_EDIT.hiddenDocs={
        title:titleEl||null, content:contentEl||null,
        titleDisp:titleEl?titleEl.style.display:'', contentDisp:contentEl?contentEl.style.display:'',
        head:headEl||null, tabs:tabsEl||null, search:searchEl||null, hotzone:hotEl||null,
        headDisp:headEl?headEl.style.display:'', tabsDisp:tabsEl?tabsEl.style.display:'', searchDisp:searchEl?searchEl.style.display:'', hotzoneDisp:hotEl?hotEl.style.display:''
      };
      try{ if(titleEl)titleEl.style.display='none'; }catch(e){}
      try{ if(contentEl)contentEl.style.display='none'; }catch(e){}
      try{ if(headEl)headEl.style.display='none'; }catch(e){}
      try{ if(tabsEl)tabsEl.style.display='none'; }catch(e){}
      try{ if(searchEl)searchEl.style.display='none'; }catch(e){}
      try{ if(hotEl)hotEl.style.display='none'; }catch(e){}
      var built2=codeEditBuildShell(label);
      built2.root.id='codeEditInline';
      built2.root.className='code-edit-inline';
      CODE_EDIT.root=built2.root; CODE_EDIT.taHtml=built2.taHtml; CODE_EDIT.taCss=built2.taCss;
      CODE_EDIT.searchBar=built2.searchBar; CODE_EDIT.searchInput=built2.searchInput; CODE_EDIT.searchCount=built2.searchCount;
      try{ CODE_EDIT.search={q:'',pos:[],idx:-1}; }catch(e){}
      CODE_EDIT.taHtml.value=html; CODE_EDIT.taCss.value=css;
      bodyEl.insertBefore(built2.root, bodyEl.firstChild);
      try{ bodyEl.scrollTop=0; }catch(e){}
    }
    try{ if(typeof libStatus==='function')libStatus('代码编辑已打开：'+label); }catch(e){}
  }).catch(function(){ codeEditToast('源文件读取异常。'); });
}
function codeEditOpenRemote(res){
  if(!res||!res.selector){ codeEditToast('未能定位目标元素，请重试或用Ctrl+拾取走AI队列。'); return; }
  var file='', dir='';
  try{ file=(typeof editQueueCurHtmlFile==='function')?editQueueCurHtmlFile():''; }catch(e){}
  try{ dir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){}
  var label=String(res.text||res.tagName||res.selector).slice(0,30);
  var liveIdx=-1;
  try{ liveIdx=(typeof res.pickIndex==='number')?res.pickIndex:((typeof res.liveIndex==='number')?res.liveIndex:-1); }catch(e){}
  codeEditOpen({selector:String(res.selector), file:file, dir:dir, label:label, text:String(res.text||''), ancestors:(res.ancestors&&res.ancestors.slice)?res.ancestors.slice(0,8):[], parentHtml:String(res.parentHtml||''), liveIndex:liveIdx});
}
/* 同源 live 元素入口：定位信息直接取，单选替换 */
function codeEditOpenFromLive(t){
  try{
    if(!t||t.nodeType!==1){ codeEditToast('未能定位目标元素，请重试或用Ctrl+拾取走AI队列。'); return; }
    var tag=String(t.tagName||'').toLowerCase();
    if(tag==='html'||tag==='body'){ codeEditToast('根元素不支持代码编辑，请选择正文内容。'); return; }
    var sel='';
    try{ sel=(typeof generateSelector==='function')?generateSelector(t):''; }catch(e){}
    if(!sel){ codeEditToast('选择器生成失败，请重试。'); return; }
    var file='', dir='';
    try{ file=(typeof editQueueCurHtmlFile==='function')?editQueueCurHtmlFile():''; }catch(e){}
    try{ dir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){}
    var label='';
    try{ label=String((typeof extractElementText==='function'?extractElementText(t):(t.textContent||t.tagName||''))||'').slice(0,30); }catch(e){ label=String(t.tagName||''); }
    var liveIdx=-1, anc=[], ph='';
    try{
      var _ld=t.ownerDocument||document;
      var _all=_ld.querySelectorAll(sel);
      for(var _ii=0;_ii<_all.length;_ii++){ if(_all[_ii]===t){ liveIdx=_ii; break; } }
    }catch(e){}
    try{ anc=(typeof editAncestorChain==='function'?editAncestorChain(t):[]); }catch(e){}
    try{ ph=(typeof editParentSnippet==='function'?editParentSnippet(t):''); }catch(e){}
    codeEditOpen({selector:sel, file:file, dir:dir, label:label, text:String(t.textContent||'').slice(0,120), ancestors:anc, parentHtml:ph, liveIndex:liveIdx});
  }catch(e){ try{ codeEditToast('代码编辑打开失败。'); }catch(e2){} }
}
function codeEditSave(){
  if(!CODE_EDIT.open)return;
  try{ if(inlineEditIsAiBusy()){ codeEditToast('AI 正在生成，请先停止再保存。'); return; } }catch(e){}
  var dir=CODE_EDIT.dir, file=CODE_EDIT.file, selector=CODE_EDIT.selector;
  var newHtml=CODE_EDIT.taHtml?String(CODE_EDIT.taHtml.value||''):'';
  var newCss=CODE_EDIT.taCss?String(CODE_EDIT.taCss.value||''):'';
  if(!newHtml.trim()){ codeEditToast('HTML 内容不能为空（如需删除请用 AI 队列）。'); return; }
  var sb=null;
  try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
  if(!sb||typeof sb.readFile!=='function'||typeof sb.write!=='function'){ codeEditToast('当前原型不支持直接写盘。'); return; }
  /* HTML 片段校验：必须解析出至少一个节点 */
  var fragOk=false;
  try{
    var holder=document.createElement('div');
    holder.innerHTML=newHtml;
    var hasNode=false;
    for(var i=0;i<holder.childNodes.length;i++){ var n=holder.childNodes[i]; if(n&&(n.nodeType===1||(n.nodeType===3&&String(n.nodeValue||'').trim()!==''))){ hasNode=true; break; } }
    fragOk=hasNode;
  }catch(e){ fragOk=false; }
  if(!fragOk){ codeEditToast('HTML 解析失败或为空，请检查标签是否闭合。'); return; }
  sb.readFile({dir:dir,file:file}).then(function(r){
    if(!r||!r.ok){ codeEditToast('源文件读取失败：'+((r&&r.error)||'未知错误')); return; }
    var srcHtml=String(r.content||'');
    var pdoc=null;
    try{ pdoc=new DOMParser().parseFromString(srcHtml,'text/html'); }catch(e){}
    if(!pdoc){ codeEditToast('源文件解析失败。'); return; }
    var hits=null;
    try{ hits=pdoc.querySelectorAll(selector); }catch(e){ codeEditToast('选择器在源文件无效：'+selector); return; }
    var target=null;
    if(hits&&hits.length===1){ target=hits[0]; }
    else if(hits&&hits.length>1){
      var mi=-1; try{ mi=(typeof CODE_EDIT.matchIndex==='number')?CODE_EDIT.matchIndex:-1; }catch(e){}
      if(mi>=0&&mi<hits.length){ target=hits[mi]; }
      else{ codeEditToast('元素已变化（命中'+hits.length+'个，原序号越界），请重新拾取。文件：'+file); return; }
    }
    else{ codeEditToast('元素已变化（命中0个），请重新拾取。文件：'+file); return; }
    try{
      var holder2=pdoc.createElement('div');
      holder2.innerHTML=newHtml;
      var parent=target.parentNode;
      var ref=target.nextSibling;
      parent.removeChild(target);
      while(holder2.firstChild){ parent.insertBefore(holder2.firstChild, ref); }
    }catch(e){ codeEditToast('HTML 替换失败。'); return; }
    /* CSS 写入文件末尾覆盖块（单块替换，无映射歧义） */
    try{
      var head=pdoc.head||pdoc.documentElement;
      var old=null;
      var styles=pdoc.querySelectorAll('style[data-codeedit]');
      for(var s=0;s<styles.length;s++){ old=styles[s]; }
      if(old&&old.parentNode) old.parentNode.removeChild(old);
      if(String(newCss||'').trim()!==''){
        var nb=pdoc.createElement('style');
        try{ nb.setAttribute('data-codeedit','1'); }catch(e){}
        nb.textContent='\n'+String(newCss).trim()+'\n';
        head.appendChild(nb);
      }
    }catch(e){}
    var out='';
    try{
      var hasDoctype=/^\s*<!doctype/i.test(srcHtml);
      out=(hasDoctype?'<!DOCTYPE html>\n':'')+pdoc.documentElement.outerHTML;
    }catch(e){ codeEditToast('序列化失败。'); return; }
    var saved=null;
    try{ if(typeof inlineEditCaptureScroll==='function')saved=inlineEditCaptureScroll(); }catch(e){}
    sb.write({dir:dir,file:file,content:out}).then(function(w){
      if(!w||!w.ok){ codeEditToast('写盘失败：'+((w&&w.error)||'未知错误')); return; }
      try{ if(typeof libStatus==='function')libStatus('已保存：'+file); }catch(e){}
      var keepFile=file;
      codeEditClose(true);
      try{ if(typeof inlineEditSilentRefresh==='function')inlineEditSilentRefresh(saved,keepFile); }catch(e){}
    }).catch(function(){ codeEditToast('写盘异常。'); });
  }).catch(function(){ codeEditToast('源文件读取异常。'); });
}
function inlineEditSave(){
  if(!INLINE_EDIT.open||!INLINE_EDIT.target)return;
  try{ if(inlineEditIsAiBusy()){ inlineEditToast('AI 正在生成，请先停止再就地改。'); return; } }catch(e){}
  var ta=INLINE_EDIT.ta;
  var newText=ta?ta.value:'';
  if(newText===INLINE_EDIT.initText){ inlineEditToast('内容无变化，已关闭。'); inlineEditCloseNow(); return; }
  var selector=INLINE_EDIT.selector,file=INLINE_EDIT.file,dir=INLINE_EDIT.dir,targetEl=INLINE_EDIT.target;
  var sb=null;
  try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
  if(!sb||typeof sb.readFile!=='function'||typeof sb.write!=='function'||!dir||!file){
    inlineEditQueueFallback(newText,'当前原型不支持直接写盘，已转AI队列（见待提交列表）。');
    inlineEditCloseNow();
    return;
  }
  if(!selector){ inlineEditQueueFallback(newText,'选择器生成失败，已转AI队列，请用Ctrl+拾取提交。'); return; }
  sb.readFile({dir:dir,file:file}).then(function(r){
    if(!r||!r.ok){ inlineEditQueueFallback(newText,'源文件读取失败，已转AI队列：'+((r&&r.error)||'未知错误')); return; }
    var srcHtml=String(r.content||'');
    var pdoc=null;
    try{ pdoc=new DOMParser().parseFromString(srcHtml,'text/html'); }catch(e){}
    if(!pdoc){ inlineEditQueueFallback(newText,'源文件解析失败，已转AI队列。'); return; }
    var hits=null;
    try{ hits=pdoc.querySelectorAll(selector); }catch(e){ inlineEditQueueFallback(newText,'选择器在源文件无效，已转AI队列，请用Ctrl+拾取提交。'); return; }
    if(!hits||hits.length!==1){ inlineEditQueueFallback(newText,'源文件定位命中'+(hits?hits.length:0)+'个（需恰好1个），已转AI队列，请用Ctrl+拾取提交。'); return; }
    var _apply=null;
    try{ _apply=inlineEditApplyDirectText(hits[0],newText); }catch(e){ inlineEditToast('写入内存DOM失败，请用Ctrl+拾取走AI队列。'); return; }
    if(!_apply||!_apply.ok){ inlineEditQueueFallback(newText,'源文件无可编辑直接文字，已转AI队列，请用Ctrl+拾取提交。'); return; }
    var _overflow=false;
    try{ _overflow=!!_apply.overflow; }catch(e){}
    var out='';
    try{
      var hasDoctype=/^\s*<!doctype/i.test(srcHtml);
      out=(hasDoctype?'<!DOCTYPE html>\n':'')+pdoc.documentElement.outerHTML;
    }catch(e){ inlineEditToast('序列化失败，请用Ctrl+拾取走AI队列。'); return; }
    var saved=inlineEditCaptureScroll();
    sb.write({dir:dir,file:file,content:out}).then(function(w){
      if(!w||!w.ok){ inlineEditQueueFallback(newText,'写盘失败，已转AI队列：'+((w&&w.error)||'未知错误')); return; }
      try{ if(typeof libStatus==='function')libStatus('已就地保存：'+file); }catch(e){}
      inlineEditCloseNow();
      try{ if(_overflow)inlineEditToast('换行多于原文文本段，多余已并入末段（<br>数量不变）。'); }catch(e){}
      inlineEditSilentRefresh(saved,file);
    }).catch(function(){ inlineEditQueueFallback(newText,'写盘异常，已转AI队列。'); });
  }).catch(function(){ inlineEditQueueFallback(newText,'源文件读取异常，已转AI队列。'); });
}
function inlineEditBuildPop(p){
  inlineEditCloseDom();
  var pop=document.createElement('div');
  pop.id='inlineEditPop'; pop.className='inline-edit-pop';
  var hd=document.createElement('div'); hd.className='inline-edit-hd';
  hd.textContent='修改'; pop.appendChild(hd);
  var wrap=document.createElement('div'); wrap.className='inline-edit-wrap';
  var ta=document.createElement('textarea'); ta.className='inline-edit-ta'; ta.spellcheck=false; ta.rows=4; ta.value=INLINE_EDIT.initText;
  wrap.appendChild(ta);
  var cancelBtn=document.createElement('button'); cancelBtn.type='button'; cancelBtn.className='inline-edit-btn inline-edit-inbtn inline-edit-incancel'; cancelBtn.textContent='放弃';
  var saveBtn=document.createElement('button'); saveBtn.type='button'; saveBtn.className='inline-edit-btn primary inline-edit-inbtn inline-edit-insave'; saveBtn.textContent='保存';
  wrap.appendChild(cancelBtn); wrap.appendChild(saveBtn); pop.appendChild(wrap);
  document.body.appendChild(pop);
  INLINE_EDIT.pop=pop; INLINE_EDIT.ta=ta; INLINE_EDIT.saveBtn=saveBtn;
  ta.addEventListener('keydown',function(ev){
    try{
      if((ev.ctrlKey||ev.metaKey)&&(ev.key==='Enter'||ev.keyCode===13)){ ev.preventDefault(); ev.stopPropagation(); inlineEditSave(); return; }
      if(ev.key==='Escape'||ev.keyCode===27){ ev.stopPropagation(); inlineEditTryClose(); return; }
    }catch(e){}
  },true);
  pop.addEventListener('mousedown',function(ev){ try{ ev.stopPropagation(); }catch(e){} },true);
  saveBtn.onclick=function(){ inlineEditSave(); };
  cancelBtn.onclick=function(){ inlineEditTryClose(); };
  try{ inlineEditPosition(); }catch(e){}
  try{
    var _doFocus=function(){ try{ ta.focus(); ta.select(); }catch(e2){ try{ ta.focus(); }catch(e3){} } };
    if(window.requestAnimationFrame){ window.requestAnimationFrame(_doFocus); }else{ _doFocus(); }
  }catch(e){ try{ ta.focus(); }catch(e2){} }
  try{
    if(!INLINE_EDIT.outsideHandler){
      INLINE_EDIT.outsideHandler=function(ev){
        if(!INLINE_EDIT.open||!INLINE_EDIT.pop)return;
        try{ if(INLINE_EDIT.openAt&&(Date.now()-INLINE_EDIT.openAt)<350)return; }catch(e){}
        try{ if(INLINE_EDIT.pop.contains(ev.target))return; }catch(e){ return; }
        inlineEditTryClose();
      };
      document.addEventListener('mousedown',INLINE_EDIT.outsideHandler,true);
    }
  }catch(e){}
  try{
    if(!window.__inlineEditResizeBound){
      window.__inlineEditResizeBound=true;
      window.addEventListener('resize',function(){ try{ if(INLINE_EDIT.open)inlineEditPosition(); }catch(e){} });
      window.addEventListener('scroll',function(){ try{ if(INLINE_EDIT.open)inlineEditPosition(); }catch(e){} },true);
    }
  }catch(e){}
}
function inlineEditOpen(targetEl){
  try{ if(!targetEl||targetEl.nodeType!==1){ inlineEditToast('未能定位目标元素，请重试或用Ctrl+拾取走AI队列。'); return; } }catch(e){ try{ inlineEditToast('未能定位目标元素，请重试或用Ctrl+拾取走AI队列。'); }catch(e2){} return; }
  var rect=null;
  try{ rect=targetEl.getBoundingClientRect(); }catch(e){ try{ inlineEditToast('读取元素位置失败，请用Ctrl+拾取走AI队列。'); }catch(e2){} return; }
  if(!rect){ try{ inlineEditToast('读取元素位置失败，请用Ctrl+拾取走AI队列。'); }catch(e){} return; }
  var p=null;
  try{ p=editRectToPage(rect); }catch(e){ p={left:100,top:100,width:200,height:24}; }
  try{ INLINE_EDIT.selector=(typeof generateSelector==='function')?generateSelector(targetEl):''; }catch(e){ INLINE_EDIT.selector=''; }
  try{ INLINE_EDIT.file=(typeof editQueueCurHtmlFile==='function')?editQueueCurHtmlFile():''; }catch(e){ INLINE_EDIT.file=''; }
  try{ INLINE_EDIT.dir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){ INLINE_EDIT.dir=''; }
  try{ INLINE_EDIT.initText=inlineEditGetDirectText(targetEl); }catch(e){ INLINE_EDIT.initText=''; }
  try{ INLINE_EDIT.initHtml=INLINE_EDIT.initText; }catch(e){}
  INLINE_EDIT.target=targetEl;
  try{ if(CTRL_PICK){ CTRL_PICK.holding=false; try{ CTRL_PICK.exit(); }catch(e){} } }catch(e2){}
  try{ editHideHover(); }catch(e){}
  try{ if(window.LinkBind&&typeof LinkBind.closeAllDrawers==='function')LinkBind.closeAllDrawers(); }catch(e){}
  INLINE_EDIT.open=true; INLINE_EDIT.savedRect=p;
  try{ INLINE_EDIT.openAt=Date.now(); }catch(e){ INLINE_EDIT.openAt=0; }
  try{ inlineEditBuildPop(p); }catch(e){ try{ inlineEditToast('就地改浮层打开失败，请用Ctrl+拾取走AI队列。'); }catch(e2){} try{ inlineEditCloseNow(); }catch(e3){} return; }
  try{ if(window.MaskStack&&window.MaskStack.push)window.MaskStack.push('inlineEditPop',function(){ inlineEditTryClose(); }); }catch(e){}
}
function editDblClick(ev){
  try{ if(editEvtDedup(ev))return; }catch(_dedupE){}
  try{
    if(ev&&(ev.ctrlKey||ev.metaKey))return;
    if(typeof CTRL_PICK!=='undefined'&&CTRL_PICK&&CTRL_PICK.holding)return;
    if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open){ inlineEditToast('请先保存或放弃当前就地改。'); return; }
    if(inlineEditIsAiBusy()){ inlineEditToast('AI 正在生成，请先停止再就地改。'); if(ev){ try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){} } return; }
    var t=ev?ev.target:null;
    if(!t||t.nodeType!==1){ inlineEditToast('未能识别目标元素，请重试或用Ctrl+拾取走AI队列。'); return; }
    if(inlineEditIsChrome(t)){ inlineEditToast('该元素为功能层不可编辑，请选择正文内容或用Ctrl+拾取走AI队列。'); return; }
    var tag=String(t.tagName||'').toLowerCase();
    if(tag==='html'||tag==='body'){ inlineEditToast('根元素不支持就地改，请选择正文内容。'); return; }
    if(!inlineEditHasDirectText(t)){ inlineEditToast('该元素无可编辑文字'); if(ev){ try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){} } return; }
    if(ev){ try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){} }
    try{ inlineEditOpen(t); }catch(e){ try{ inlineEditToast('就地改打开失败，请用Ctrl+拾取走AI队列。'); }catch(e2){} }
  }catch(e){ try{ inlineEditToast('就地改打开异常，请用Ctrl+拾取走AI队列。'); }catch(e2){} }
}
/* 层级链 + 父级代码片段（供提交大模型定位参考；SVG className 用 getAttribute 取，避免 [object]） */
function editAncestorChain(el){
  var out=[];
  try{
    var n=el?el.parentElement:null, d=0;
    while(n&&n.nodeType===1&&d<8){
      var tg=''; try{ tg=String(n.tagName||'').toLowerCase(); }catch(e){}
      if(!tg||tg==='html') break;
      var s=tg;
      try{ var c0=String((n.getAttribute&&n.getAttribute('class'))||'').split(/\s+/)[0]||''; if(c0) s+='.'+c0; }catch(e2){}
      try{ if(n.id) s+='#'+String(n.id).slice(0,64); }catch(e3){}
      out.unshift(s); n=n.parentElement; d++;
    }
  }catch(e){}
  return out;
}
function editParentSnippet(el){
  try{ var p=el?el.parentElement:null; if(p&&p.outerHTML) return String(p.outerHTML).slice(0,2000); }catch(e){}
  return '';
}
function editQueueCurHtmlFile(){ try{ if(typeof curHtmlFile==='function')return curHtmlFile(); }catch(e){} return (typeof currentSource!=='undefined'&&currentSource&&(currentSource.activeSubFile||currentSource.mainHtmlFile||currentSource.name))||''; }
function editQueueAdd(el, text){
  el = el || EDIT_LOCKED_EL || EDIT_HOVER_EL;
  if(!el)return;
  var t = (typeof text === 'string') ? text.trim() : '';
  if(!t){ alert('请先输入要调整的内容。'); return; }
  var sel=generateSelector(el), pg=editFrameHash(), curHtml=editQueueCurHtmlFile(), dup=null;
  EDIT_QUEUE.forEach(function(it){ if(it.selector===sel&&it.page===pg&&(!it.htmlFile||!curHtml||it.htmlFile===curHtml))dup=it; });
  if(dup){
    dup.text=t; dup.ts=Date.now();
    if(!dup.htmlFile)dup.htmlFile=curHtml;
    libStatus('已更新该元素原有的修改需求。');
  }else{
    EDIT_QUEUE.push({ id:(Date.now()+Math.random().toString(36).slice(2,8)), ts:Date.now(), sel:true,
      page:pg, selector:sel, label:editElementLabel(el), text:t, htmlFile:curHtml,
      ancestors:(typeof editAncestorChain==='function'?editAncestorChain(el):[]), parentHtml:(typeof editParentSnippet==='function'?editParentSnippet(el):'') });
    libStatus('已加入待提交列表：'+EDIT_QUEUE.length+' 条（可点顶部「待提交列表」查看或提交）。');
  }
  updateEditBadge();
  renderEditDrawer();
  schedulePersistEditQueue();
}
/* 沙箱跨域远端入队：选择器/文本均来自帧回传，不依赖 live el，其余与 editQueueAdd 一致 */
function editQueueAddRemote(info, text){
  if(!info)return;
  var t = (typeof text === 'string') ? text.trim() : '';
  if(!t){ alert('请先输入要调整的内容。'); return; }
  var sel=String(info.selector||'');
  if(!sel){ alert('选择器生成失败，请重试。'); return; }
  var pg=String(info.page||'');
  try{ if(!pg&&typeof editFrameHash==='function')pg=editFrameHash()||''; }catch(e){}
  var curHtml=editQueueCurHtmlFile(), dup=null;
  EDIT_QUEUE.forEach(function(it){ if(it.selector===sel&&it.page===pg&&(!it.htmlFile||!curHtml||it.htmlFile===curHtml))dup=it; });
  var label=String(info.text||info.tagName||sel).slice(0,30);
  if(dup){
    dup.text=t; dup.ts=Date.now();
    if(!dup.htmlFile)dup.htmlFile=curHtml;
    libStatus('已更新该元素原有的修改需求。');
  }else{
    EDIT_QUEUE.push({ id:(Date.now()+Math.random().toString(36).slice(2,8)), ts:Date.now(), sel:true,
      page:pg, selector:sel, label:label, text:t, htmlFile:curHtml,
      ancestors:(info&&Array.isArray(info.ancestors))?info.ancestors.slice(0,8):[], parentHtml:String((info&&info.parentHtml)||'').slice(0,2000) });
    libStatus('已加入待提交列表：'+EDIT_QUEUE.length+' 条（可点顶部「待提交列表」查看或提交）。');
  }
  updateEditBadge();
  renderEditDrawer();
  schedulePersistEditQueue();
}
/* ═══════ 沙箱跨域远端拾取（postMessage 桥） ═══════
 * 同源穿透被 sandbox 阻断后，帧内点击宿主不可见；改为宿主按住 Ctrl 即经
 * ProtoSandboxBridge.requestPick 逐次武装帧侧，帧回传 PICK_RESULT 后入远端选中并立即重武装
 * （松开 Ctrl 即停；Ctrl+Shift 切单发就地改）。旧同源直连路径原样保留。 */
function ctrlRemotePickSupported(){
  try{
    if(window.__EXPORT_BOOT__===true)return false;
    if(typeof sandboxRequestPick!=='function')return false;
    if(typeof frame==='undefined'||!frame||!frame.contentWindow)return false;
    return true;
  }catch(e){ return false; }
}
function ctrlStopRemotePickLoop(){
  try{ CTRL_PICK.remoteLoop=false; CTRL_PICK.remoteSeq++; }catch(e){}
  try{ if(typeof sandboxSendDisarm==='function')sandboxSendDisarm(); }catch(e2){}
}
function ctrlStartRemotePickLoop(){
  try{
    if(CTRL_PICK.remoteLoop)return;
    if(!ctrlRemotePickSupported())return;
    CTRL_PICK.remoteLoop=true;
    var tok=++CTRL_PICK.remoteSeq;
    (function next(){
      if(!CTRL_PICK.remoteLoop||tok!==CTRL_PICK.remoteSeq)return;
      if(!(CTRL_PICK&&CTRL_PICK.holding)){ CTRL_PICK.remoteLoop=false; return; }
      if(!ctrlRemotePickSupported()){ CTRL_PICK.remoteLoop=false; return; }
      var p=null;
      try{ p=sandboxRequestPick(15000); }catch(e){ CTRL_PICK.remoteLoop=false; return; }
      if(!p||typeof p.then!=='function'){ CTRL_PICK.remoteLoop=false; return; }
      p.then(function(res){
        if(!CTRL_PICK.remoteLoop||tok!==CTRL_PICK.remoteSeq)return;
        if(!(CTRL_PICK&&CTRL_PICK.holding)){ CTRL_PICK.remoteLoop=false; return; }
        if(!res||!res.selector){ next(); return; }
        var _wantCode=false; try{ _wantCode=!!(res&&(res.shift||res.shiftKey))||CTRL_PICK.remoteMode==='inline'; }catch(_ce){}
        if(_wantCode){ CTRL_PICK.remoteLoop=false; try{ if(typeof codeEditOpenRemote==='function')codeEditOpenRemote(res); }catch(e){} return; }
        try{ CTRL_PICK.toggleRemote(res); }catch(e2){}
        next();
      }).catch(function(){
        if(CTRL_PICK.remoteLoop&&tok===CTRL_PICK.remoteSeq&&(CTRL_PICK&&CTRL_PICK.holding))next();
        else CTRL_PICK.remoteLoop=false;
      });
    })();
  }catch(e){ try{ CTRL_PICK.remoteLoop=false; }catch(e2){} }
}
function ctrlArmInlineOnce(){
  try{
    if(!ctrlRemotePickSupported())return;
    try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(e){}
    /* CODE_EDIT 打开时允许继续武装，用于切换选中元素（脏确认由 codeEditOpen 统一处理） */
    var tok=++CTRL_PICK.remoteSeq;
    sandboxRequestPick(20000).then(function(res){
      if(tok!==CTRL_PICK.remoteSeq)return;
      if(!res||!res.selector)return;
      try{ if(typeof codeEditOpenRemote==='function')codeEditOpenRemote(res); }catch(e2){}
    }).catch(function(){});
  }catch(e){}
}
/* 沙箱跨域就地改：定位/初值/弹窗位置来自帧回传，保存走既有文件读写链
 * （readFile→DOMParser→选择器恰1命中→回填直接文本→write），与 live 路径同一落盘语义。 */
function inlineEditOpenRemote(res){
  if(!res||!res.selector){ inlineEditToast('未能定位目标元素，请重试或用Ctrl+拾取走AI队列。'); return; }
  try{ if(inlineEditIsAiBusy()){ inlineEditToast('AI 正在生成，请先停止再就地改。'); return; } }catch(e){}
  var p=null;
  try{ p=(res.rect&&typeof editRectToPage==='function')?editRectToPage(res.rect):{left:100,top:100,width:200,height:24}; }catch(e){ p={left:100,top:100,width:200,height:24}; }
  INLINE_EDIT.selector=String(res.selector||'');
  try{ INLINE_EDIT.file=(typeof editQueueCurHtmlFile==='function')?editQueueCurHtmlFile():''; }catch(e){ INLINE_EDIT.file=''; }
  try{ INLINE_EDIT.dir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){ INLINE_EDIT.dir=''; }
  INLINE_EDIT.initText=String(res.text||'');
  try{ INLINE_EDIT.initHtml=INLINE_EDIT.initText; }catch(e){}
  /* 远端代理 target：保存链仅校验存在性，真实读写发生在解析后的源文件副本上 */
  INLINE_EDIT.target={ __remotePick:true, nodeType:1, tagName:String(res.tagName||'div').toUpperCase() };
  try{ if(CTRL_PICK){ CTRL_PICK.holding=false; try{ CTRL_PICK.exit(); }catch(e){} } }catch(e2){}
  try{ editHideHover(); }catch(e){}
  try{ if(window.LinkBind&&typeof LinkBind.closeAllDrawers==='function')LinkBind.closeAllDrawers(); }catch(e){}
  INLINE_EDIT.open=true; INLINE_EDIT.savedRect=p;
  try{ INLINE_EDIT.openAt=Date.now(); }catch(e){ INLINE_EDIT.openAt=0; }
  try{ inlineEditBuildPop(p); }catch(e){ try{ inlineEditToast('就地改浮层打开失败，请用Ctrl+拾取走AI队列。'); }catch(e2){} try{ inlineEditCloseNow(); }catch(e3){} return; }
  try{ if(window.MaskStack&&window.MaskStack.push)window.MaskStack.push('inlineEditPop',function(){ inlineEditTryClose(); }); }catch(e){}
}
/* 待提交选中态：sel!==false 即选中（默认全选；存量无字段按选中计） */
function editQueueSelected(){ try{ return EDIT_QUEUE.filter(function(it){ return it&&(it.sel!==false); }); }catch(e){ return EDIT_QUEUE.slice(); } }
function editQueueIsAllSel(){ try{ return EDIT_QUEUE.length>0&&EDIT_QUEUE.every(function(it){ return it&&(it.sel!==false); }); }catch(e){ return false; } }
function editQueueSetAll(on){
  try{
    EDIT_QUEUE.forEach(function(it){ if(it)it.sel=!!on; });
    updateEditBadge(); renderEditDrawer(); schedulePersistEditQueue();
  }catch(e){}
}
function editQueueToggleSel(id){
  if(!id)return;
  try{
    for(var i=0;i<EDIT_QUEUE.length;i++){
      if(EDIT_QUEUE[i]&&EDIT_QUEUE[i].id===id){
        EDIT_QUEUE[i].sel=(EDIT_QUEUE[i].sel===false);
        break;
      }
    }
    updateEditBadge(); renderEditDrawer(); schedulePersistEditQueue();
  }catch(e){}
}
function updateEditBadge(){
  var n=EDIT_QUEUE.length;
  if(btnSubmitEditEl)btnSubmitEditEl.style.display=n?'':'none';
  if(submitBadgeEl){ submitBadgeEl.textContent=n; submitBadgeEl.style.display=n?'':'none'; }
  if(drawerBadgeEl)drawerBadgeEl.textContent=n;
}
function openEditDrawer(){ if(!editDrawerEl)return; if(window.LinkBind)LinkBind.closeAllDrawers(); renderEditDrawer(); editDrawerEl.classList.add('open'); if(editDrawerMaskEl)editDrawerMaskEl.style.display=''; if(window.MaskStack) window.MaskStack.push('editDrawerMask', closeEditDrawer); }
function closeEditDrawer(){ if(window.MaskStack) window.MaskStack.pop('editDrawerMask'); if(!editDrawerEl)return; editDrawerEl.classList.remove('open'); if(editDrawerMaskEl)editDrawerMaskEl.style.display='none'; }
function renderEditDrawer(){
  if(!editDrawerBodyEl)return;
  if(!EDIT_QUEUE.length){ editDrawerBodyEl.innerHTML='<div class="ed-empty">暂无待提交的修改需求<br>按住 Ctrl 点击原型元素即可拾取，松开 Ctrl 后批量提交</div>'; return; }
  var h='';
  EDIT_QUEUE.forEach(function(it,i){
    var _sel=!(it&&(it.sel===false));
    var protoName=(typeof currentSource!=='undefined'&&currentSource&&(currentSource.displayName||currentSource.name))||'当前原型';
    var mainF=((typeof currentSource!=='undefined'&&currentSource&&(currentSource.mainHtmlFile||currentSource.name))||'');
    var effFile=it.htmlFile||mainF||'当前文件';
    h+='<div class="ed-item'+(_sel?' sel':'')+'" data-id="'+escAttr(it.id)+'"><div class="ei-top"><span class="ei-no">'+(i+1)+'</span>'+((it&&it.batchParts&&it.batchParts.length)?'<span class="ei-batch" title="批量修改共'+it.batchParts.length+'个元素">批量'+it.batchParts.length+'个</span>':'')+'<span class="ei-proto" title="'+escAttr(protoName)+'">'+escHtml(protoName)+'</span><span class="ei-file" title="'+escAttr(effFile)+'">'+escHtml(effFile)+'</span><span class="ei-page">'+escHtml(it.page?it.page:'（首页）')+'</span>'
      +'<span class="ei-edit" data-id="'+escAttr(it.id)+'" title="修改该条需求">✎</span>'
      +'<span class="ei-x" data-id="'+escAttr(it.id)+'" title="删除该条">✕</span></div>'
      +(it.id===EDIT_EDITING_ID
        ?'<div class="ei-editbox"><textarea class="ei-editta" spellcheck="false">'+escHtml(it.text)+'</textarea>'
        +'<div class="ei-edit-ops"><span class="ei-edit-cancel" data-id="'+escAttr(it.id)+'">取消</span><span class="ei-edit-save" data-id="'+escAttr(it.id)+'">保存</span></div></div>'
        :'<div class="ei-text">'+escHtml(it.text)+'</div>')
      +'</div>';
  });
  editDrawerBodyEl.innerHTML=h;
  /* 点击条目切换选中（边框高亮）；✎/✕/编辑框内操作不触发 */
  Array.prototype.forEach.call(editDrawerBodyEl.querySelectorAll('.ed-item'),function(row){
    row.onclick=function(ev){
      try{
        var t=ev&&(ev.target||ev.srcElement);
        if(t&&t.closest){
          var hit=t.closest('.ei-x,.ei-edit,.ei-editbox,.ei-edit-ops,textarea,.ei-edit-save,.ei-edit-cancel');
          if(hit&&row.contains(hit))return;
        }
      }catch(e){}
      editQueueToggleSel(row.getAttribute('data-id'));
    };
  });
  /* 左下角同一位置：全选/取消全选互斥显示 */
  try{
    var _selAllBtn=document.getElementById('editQueueSelAll');
    if(_selAllBtn){
      if(!EDIT_QUEUE.length){ _selAllBtn.style.display='none'; }
      else{
        _selAllBtn.style.display='';
        _selAllBtn.textContent=editQueueIsAllSel()?'取消全选':'全选';
      }
    }
  }catch(e){}
  Array.prototype.forEach.call(editDrawerBodyEl.querySelectorAll('.ei-x'),function(x){
    x.onclick=function(){ editQueueRemove(x.getAttribute('data-id')); };
  });
  Array.prototype.forEach.call(editDrawerBodyEl.querySelectorAll('.ei-edit'),function(x){
    x.onclick=function(){ EDIT_EDITING_ID=x.getAttribute('data-id'); renderEditDrawer(); var ta=editDrawerBodyEl.querySelector('.ei-editta'); if(ta)ta.focus(); };
  });
  Array.prototype.forEach.call(editDrawerBodyEl.querySelectorAll('.ei-edit-save'),function(x){
    x.onclick=function(){
      var ta=x.parentElement.parentElement.querySelector('.ei-editta');
      var t=(ta&&ta.value||'').trim();
      if(!t){ alert('需求内容不能为空。'); return; }
      editQueueUpdate(x.getAttribute('data-id'),t);
    };
  });
  Array.prototype.forEach.call(editDrawerBodyEl.querySelectorAll('.ei-edit-cancel'),function(x){
    x.onclick=function(){ EDIT_EDITING_ID=null; renderEditDrawer(); };
  });
  var ta=editDrawerBodyEl.querySelector('.ei-editta');
  if(ta){
    ta.addEventListener('keydown',function(ev){
      if(ev.ctrlKey&&(ev.key==='Enter'||ev.key==='enter')){ ev.preventDefault();
        var t=(ta.value||'').trim(); if(!t){ alert('需求内容不能为空。'); return; }
        editQueueUpdate(EDIT_EDITING_ID,t);
      }
    });
  }
  /* 编辑态输入框按内容全量展开（无高度上限），随打字增高 */
  try{
    Array.prototype.forEach.call(editDrawerBodyEl.querySelectorAll('.ei-editta'),function(eta){
      try{ autoEditTa(eta); }catch(e){}
      eta.addEventListener('input',function(){ try{ autoEditTa(eta); }catch(e){} });
    });
  }catch(e){}
}
function autoEditTa(ta){
  try{
    if(!ta) return;
    ta.style.height='auto';
    ta.style.height=Math.max(64,ta.scrollHeight)+'px';
  }catch(e){}
}
function editQueueRemove(id){
  if(id)EDIT_QUEUE=EDIT_QUEUE.filter(function(it){ return it.id!==id; });
  if(EDIT_EDITING_ID===id)EDIT_EDITING_ID=null;
  updateEditBadge(); renderEditDrawer();
  schedulePersistEditQueue();
}
function editQueueUpdate(id,text){
  if(!id)return;
  EDIT_QUEUE.forEach(function(it){ if(it.id===id){ it.text=text; it.ts=Date.now(); } });
  EDIT_EDITING_ID=null;
  updateEditBadge(); renderEditDrawer();
  libStatus('已更新该条修改需求。');
  schedulePersistEditQueue();
}
function editQueueClear(){
  if(!EDIT_QUEUE.length)return;
  if(window.confirm('清空全部 '+EDIT_QUEUE.length+' 条待提交修改？')){
    // P1-3 fix: 清空前备份至 edit_queue_backup
    try{ localStorage.setItem('edit_queue_backup', JSON.stringify(EDIT_QUEUE)); }catch(e){} // P1-3 fix
    EDIT_LAST_QUEUE=EDIT_QUEUE.slice();
    try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(e){}
    EDIT_QUEUE=[];
    persistEditQueue();
    updateEditBadge(); renderEditDrawer();
  }
}
/* 编辑清单提交完成（AI done）：只移除本轮已提交项，未选中的继续留列并提示 */
function __editOnAiDone(){
  if(EDIT_PENDING_SUBMIT){
    EDIT_PENDING_SUBMIT=false;
    try{
      var _doneIds=(typeof EDIT_SUBMITTED_IDS!=='undefined'&&Array.isArray(EDIT_SUBMITTED_IDS))?EDIT_SUBMITTED_IDS:[];
      var _mark={}; _doneIds.forEach(function(id){ if(id)_mark[id]=1; });
      var _hasMark=Object.keys(_mark).length>0;
      if(_hasMark){ EDIT_QUEUE=EDIT_QUEUE.filter(function(it){ return !(it&&it.id&&_mark[it.id]); }); }
      else{ EDIT_QUEUE=[]; }
      EDIT_SUBMITTED_IDS=[];
    }catch(e){ try{ EDIT_QUEUE=[]; EDIT_SUBMITTED_IDS=[]; }catch(e2){} }
    updateEditBadge(); renderEditDrawer(); libStatus('大模型已按清单完成修改并刷新原型。');
  }
  if(window.LinkBind)LinkBind.onAfterAiRefresh();
  if(window.AnnotationEngine && typeof AnnotationEngine.onAfterAiRefresh === 'function') AnnotationEngine.onAfterAiRefresh();
}
function editQueueSubmit(){
  if(!EDIT_QUEUE.length)return;
  if(!HAS_AI){ alert('大模型修改仅桌面端可用（请使用 exe 版打开）。'); return; }
  /* 只提交选中的条目：没选中的继续留在列表 */
  var _selList=editQueueSelected();
  if(!_selList.length){ alert('请先选中至少一条需求再提交（点击条目切换选中）。'); return; }
  var mainFile=(currentSource&&(currentSource.mainHtmlFile||currentSource.name))||'';
  var curActive=(typeof editQueueCurHtmlFile==='function'?editQueueCurHtmlFile():(currentSource&&(currentSource.activeSubFile||mainFile)||''));
  var isMulti=!!(currentSource&&((currentSource.subPages&&currentSource.subPages.length)||(currentSource.htmlFiles&&currentSource.htmlFiles.length>1)));
  function effOf(it){ return it.htmlFile||mainFile||'当前文件'; }
  /* 批量条目展开：batchParts 有值时按部件展开参与拼装（列表仍显示单条） */
  var _workList=[];
  _selList.forEach(function(it){
    if(it&&Array.isArray(it.batchParts)&&it.batchParts.length){
      it.batchParts.forEach(function(p){
        _workList.push({selector:(p&&p.sel)||'',page:(p&&p.page)||'',text:it.text,htmlFile:((p&&p.file)||it.htmlFile),label:(p&&p.label)||'',ancestors:(p&&p.anc)||[],parentHtml:(p&&p.ph)||''});
      });
    }else{ _workList.push(it); }
  });
  var seen={}, htmlFiles=[];
  _workList.forEach(function(it){ var f=effOf(it); if(!seen[f]){ seen[f]=1; htmlFiles.push(f); } });
  if(!htmlFiles.length&&mainFile)htmlFiles=[mainFile];
  /* 精简拼装：按文件+需求文本合并同类项（同一种改法只写一遍，选择器并列）；单文件单页省略页面行；
   * 有稳定ID的条目只发 ID+短文案（定位精准，无需层级/父级代码）；无ID条目保留层级链 + 父级代码片段回退 */
  function prIdOfSel(sel){
    try{ var m=String(sel||'').match(/\[data-pr-id="([^"]+)"\]/); if(m) return m[1]; }catch(e){}
    return '';
  }
  var groups=[];
  _workList.forEach(function(it){
    var t=String(it.text||'').trim(), f=effOf(it);
    var g=null;
    for(var i=0;i<groups.length;i++){ if(groups[i].file===f&&groups[i].text===t){ g=groups[i]; break; } }
    if(!g){ g={file:f, text:t, sels:[]}; groups.push(g); }
    var sel=String(it.selector||''), dup=false;
    for(var j=0;j<g.sels.length;j++){ if(g.sels[j].sel===sel){ dup=true; break; } }
    if(!dup) g.sels.push({sel:sel, page:String(it.page||''), label:String(it.label||'').slice(0,30), anc:it.ancestors, ph:it.parentHtml});
  });
  var showPage=isMulti;
  if(!showPage){ for(var k=0;k<_workList.length;k++){ if(String(_workList[k].page||'')){ showPage=true; break; } } }
  function ancLine(a){
    if(!a||!a.length) return '';
    var arr=[]; for(var i=0;i<a.length&&i<8;i++){ var s=String(a[i]||'').slice(0,128); if(s) arr.push(s); }
    return arr.length?('层级：'+arr.join(' > ')):'';
  }
  function snippetOf(ph){
    var s=String(ph||''); if(!s) return '';
    if(s.length>1200) s=s.slice(0,1200)+'\n…（已截断，仅供定位参考）';
    return s;
  }
  var parts=['修改（共'+_selList.length+'条，涉及文件'+htmlFiles.length+'个：'+htmlFiles.join('、')+'）：',''];
  var dparts=['修改（共'+_selList.length+'条，涉及文件'+htmlFiles.length+'个：'+htmlFiles.join('、')+'）：',''];
  groups.forEach(function(g,i){
    var chips=g.sels.map(function(s){ return '`'+s.sel+'`'+((showPage&&s.page)?'（页面：'+s.page+'）':''); });
    var head='['+(i+1)+'] 所属文件：'+g.file+' ｜ '+chips.join('、')+'：'+g.text;
    parts.push(head);
    dparts.push(head); /* 对话框只展示条目头，不展示层级与代码 */
    g.sels.forEach(function(s){
      var _prid='';
      try{ _prid=prIdOfSel(s.sel); }catch(e){}
      if(_prid){
        /* 稳定ID条目：一行写全（元素标识+短文案+页面），不附层级/父级代码 */
        var _nm=String(s.label||'').slice(0,30);
        parts.push('    - `[data-pr-id="'+_prid+'"]'+(_nm?'（'+_nm+'）':'')+((showPage&&s.page)?'（页面：'+s.page+'）':''));
        return;
      }
      var al=ancLine(s.anc);
      if(al) parts.push('    - `'+s.sel+'` '+al);
      var sn=snippetOf(s.ph);
      if(sn) parts.push('      上级代码（定位参考，以磁盘文件为准）：\n      ```html\n      '+sn.split('\n').join('\n      ')+'\n      ```');
    });
  });
  parts.push('','涉及文件清单（共'+htmlFiles.length+'个）：');
  htmlFiles.forEach(function(f){ parts.push(' - '+f); });
  parts.push('','要求：只在所属文件中找，只改清单中的元素；定位不到就直说并跳过，别编、别碰别的文件。保留元素现有的 data-pr-id 属性（不得删除或修改）；新增的可交互元素请补上 data-pr-id。');
  var t=parts.join('\n');
  var td=dparts.join('\n'); /* 对话框展示用简版（无层级/代码），发模型仍用完整 t */
  var count=_selList.length;
  closeEditDrawer();
  /* G01: 提交前备份选中条目并持久化；失败不清空 - 仅成功提交后才移除已提交项，未选中的始终保留 */
  var _editQueueBackup=_selList.slice();
  // P1-3 fix: 备份至 edit_queue_backup 供失败回滚
  try{ localStorage.setItem('edit_queue_backup', JSON.stringify(_selList)); }catch(e){} // P1-3 fix
  try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(e){}
  EDIT_SUBMITTED_IDS=_selList.map(function(it){ return it&&it.id; }).filter(Boolean);
  persistEditQueue();
  updateEditBadge(); renderEditDrawer();
  EDIT_PENDING_SUBMIT=true;
  /* 独立窗委托：对话框在独立窗口时，发送必须由独立窗执行自己的 aiDoSend，
   * 否则气泡与流式事件全进本窗隐藏面板，独立窗什么也看不到。 */
  var _detachedRemote=false;
  try{ _detachedRemote = !!window.__aiWinOpen && !!(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.remoteSend&&window.protoAPI.ai.isBusy); }catch(e){ _detachedRemote=false; }
  if(_detachedRemote){
    (function(){
      var _go=function(){
        try{ editQueueDropSubmitted(); }catch(e){}
        persistEditQueue();
        updateEditBadge(); renderEditDrawer();
        EDIT_PENDING_SUBMIT=true;
        window.protoAPI.ai.remoteSend({text:t, display:td}).then(function(r){
          if(r&&r.ok){ libStatus('已将 '+count+' 条修改需求提交给大模型，生成完成后自动刷新原型。'); }
          else { editQueueRollback('独立窗提交失败：'+((r&&(r.error||r.message))||'未知错误')); }
        }).catch(function(e2){ editQueueRollback('发送失败：'+(e2&&e2.message||e2)); });
      };
      try{
        window.protoAPI.ai.isBusy().then(function(b){
          if(b){ try{ libStatus('上一个任务仍在运行，请先停止后再发送。'); }catch(e3){} return; }
          _go();
        }).catch(function(){ _go(); });
      }catch(e4){ _go(); }
    })();
    return;
  }
  if(typeof aiBusy!=='undefined'&&aiBusy){ try{ libStatus('上一个任务仍在运行，请先停止后再发送。'); }catch(e5){} return; }
  try{ editQueueDropSubmitted(); }catch(e6){}
  try{
    openAiDesign();
    if(aiInputEl){ aiInputEl.value=t; }
    try{ window.__aiUserMsgDisplay=td; }catch(e2){}
    aiDoSend();
    libStatus('已将 '+count+' 条修改需求提交给大模型，生成完成后自动刷新原型。');
  }catch(e){
    editQueueRollback((e&&e.message||e));
  }
}
/* 提交即移除已选项（不等模型完成）：失败回滚按 id 补回，未动过的始终保留 */
function editQueueDropSubmitted(){
  try{
    var _mark={};
    try{ EDIT_SUBMITTED_IDS.forEach(function(id){ if(id)_mark[id]=1; }); }catch(e){}
    if(!Object.keys(_mark).length) return 0;
    var n0=EDIT_QUEUE.length;
    EDIT_QUEUE=EDIT_QUEUE.filter(function(it){ return !(it&&it.id&&_mark[it.id]); });
    persistEditQueue();
    updateEditBadge(); renderEditDrawer();
    return n0-EDIT_QUEUE.length;
  }catch(e){ return 0; }
}
/* 提交失败回滚（抽取共用：独立窗远端失败与本地异常走同一恢复；只补回已提交项，未动过的保留） */
function editQueueRollback(msg){
  var backup=null; try{ backup=JSON.parse(localStorage.getItem('edit_queue_backup')||'null'); }catch(_e){ backup=null; }
  var list=(Array.isArray(backup)&&backup.length)?backup:((typeof _editQueueBackup!=='undefined'&&Array.isArray(_editQueueBackup))?_editQueueBackup:[]);
  var have={}; try{ EDIT_QUEUE.forEach(function(it){ if(it&&it.id)have[it.id]=1; }); }catch(e){}
  list.forEach(function(it){ if(it&&it.id&&!have[it.id]){ EDIT_QUEUE.push(it); have[it.id]=1; } });
  EDIT_SUBMITTED_IDS=[];
  EDIT_PENDING_SUBMIT=false;
  updateEditBadge(); renderEditDrawer();
  try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(_e){}
  persistEditQueue();
  try{ alert('提交失败，已恢复待提交列表：'+msg); }catch(e){}
}
/* Wave-B: setEditMode 已删除（旧编辑模式存根零调用，统一走 CTRL_PICK；删除前全仓grep仅定义+导出零调用） */
if(btnSubmitEditEl)btnSubmitEditEl.onclick=function(){ openEditDrawer(); };
if(editDrawerCloseEl)editDrawerCloseEl.onclick=closeEditDrawer;
if(editQueueClearEl)editQueueClearEl.onclick=editQueueClear;
if(editQueueSubmitEl)editQueueSubmitEl.onclick=editQueueSubmit;
if(editQueueSelAllEl)editQueueSelAllEl.onclick=function(){ try{ editQueueSetAll(!editQueueIsAllSel()); }catch(e){} };
/* 输入条发送：直达待提交列表（单元素为独立条目，多元素为批量合单），不再进中间面板 */
function pickBarSendGo(){
  try{
    if(!CTRL_PICK.selected.length) return;
    var req='';
    try{ req=String(document.getElementById('pickBarInput').value||'').trim(); }catch(e){}
    if(!req){ alert('请输入统一修改诉求。'); try{ document.getElementById('pickBarInput').focus(); }catch(e){} return; }
    var built=null;
    try{ built=ctrlPickBuildParts(CTRL_PICK.selected); }catch(e){}
    var parts=(built&&built.parts)||[], curHtmlNow=(built&&built.file)||'';
    if(!parts.length){ alert('所选元素无法定位，请重新拾取。'); return; }
    var _sdir='';
    try{ _sdir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){}
    var pushUpgraded=function(upParts){
      var added=0;
      /* 活元素引用不出持久化：剥 el（pickIndex 数字保留无害） */
      var cleanParts=(upParts||[]).map(function(p){
        return { sel:p.sel, page:p.page, label:p.label, anc:p.anc, ph:p.ph, file:p.file, pickIndex:(typeof p.pickIndex==='number')?p.pickIndex:-1 };
      });
      if(cleanParts.length===1){
        var p=cleanParts[0], dup=null;
        EDIT_QUEUE.forEach(function(it){ if(it.selector===p.sel&&it.page===p.page&&(!it.htmlFile||!curHtmlNow||it.htmlFile===curHtmlNow))dup=it; });
        if(dup){
          dup.text=req; dup.ts=Date.now();
          if(!dup.htmlFile)dup.htmlFile=curHtmlNow;
          try{ if(typeof libStatus==='function')libStatus('已更新该元素原有的修改需求。'); }catch(e){}
        }else{
          EDIT_QUEUE.push({ id:(Date.now()+Math.random().toString(36).slice(2,8)), ts:Date.now(), sel:true,
            page:p.page, selector:p.sel, label:String(p.label||p.sel).slice(0,30), text:req, htmlFile:curHtmlNow,
            ancestors:p.anc||[], parentHtml:String(p.ph||'').slice(0,2000) });
          try{ if(typeof libStatus==='function')libStatus('已加入待提交列表：'+EDIT_QUEUE.length+' 条（可点顶部「待提交列表」查看或提交）。'); }catch(e){}
        }
        added=1;
      }else{
        EDIT_QUEUE.push({ id:(Date.now()+Math.random().toString(36).slice(2,8)), ts:Date.now(), sel:true,
          page:'', selector:'', label:'批量修改（'+cleanParts.length+'个元素）', text:req, htmlFile:'',
          batchParts:cleanParts });
        try{ if(typeof libStatus==='function')libStatus('已将 1 条修改需求加入待提交列表（可点顶部「待提交列表」查看并提交）。'); }catch(e){}
        added=1;
      }
      if(!added) return;
      try{ updateEditBadge(); renderEditDrawer(); schedulePersistEditQueue(); }catch(e){}
      try{ CTRL_PICK.clear(); }catch(e2){}
      try{ CTRL_PICK.hideFab(); }catch(e3){}
    };
    /* 入列前先升级选择器（补ID落盘），队列里即稳定ID */
    try{
      if(typeof prIdUpgradeParts==='function'&&_sdir) prIdUpgradeParts(parts, _sdir, pushUpgraded);
      else pushUpgraded(parts);
    }catch(e){ try{ pushUpgraded(parts); }catch(e2){} }
  }catch(e){}
}
var pickBarSendEl=document.getElementById('pickBarSend');
if(pickBarSendEl)pickBarSendEl.onclick=function(){ pickBarSendGo(); };
function pickBarInputAuto(){
  try{
    var bi=document.getElementById('pickBarInput');
    if(!bi) return;
    bi.style.height='auto';
    bi.style.height=Math.min(120,Math.max(32,bi.scrollHeight))+'px';
  }catch(e){}
}
var pickBarInputEl=document.getElementById('pickBarInput');
if(pickBarInputEl){
  try{ pickBarInputAuto(); }catch(e){}
  pickBarInputEl.addEventListener('input',function(){ try{ pickBarInputAuto(); }catch(e){} });
  pickBarInputEl.addEventListener('keydown',function(ev){
    try{
      if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); pickBarSendGo(); }
    }catch(e){}
  });
}
/* ═══════ 输入条 Esc 两段退出：第一次下方小吐司确认，第二次正式退出 ═══════ */
var pickBarEscArmed=false, pickBarEscTipTimer=null;
function pickBarEscTip(show){
  try{
    var old=null;
    try{ old=document.getElementById('pickBarEscTip'); }catch(e){}
    if(!show){
      try{ if(old&&old.parentNode)old.parentNode.removeChild(old); }catch(e){}
      try{ if(pickBarEscTipTimer){ clearTimeout(pickBarEscTipTimer); pickBarEscTipTimer=null; } }catch(e){}
      return;
    }
    if(!old){
      old=document.createElement('div'); old.id='pickBarEscTip'; old.className='pick-bar-esc-tip';
      old.textContent='再次按 Esc 退出输入条？';
      document.body.appendChild(old);
    }else{ old.textContent='再次按 Esc 退出输入条？'; old.style.display='flex'; }
    try{ if(pickBarEscTipTimer)clearTimeout(pickBarEscTipTimer); }catch(e){}
    pickBarEscTipTimer=setTimeout(function(){ pickBarEscArmed=false; pickBarEscTip(false); },2500);
  }catch(e){}
}
try{
  if(typeof document!=='undefined'&&!document.__pickBarEscBound){
    document.__pickBarEscBound=true;
    document.addEventListener('keydown',function(e){
      try{
        var k=e.key||'';
        if(k!=='Escape'&&k!=='Esc'&&e.keyCode!==27) return;
        var bar=null;
        try{ bar=document.getElementById('pickBar'); }catch(err){}
        if(!bar||bar.style.display==='none') return;
        if(window.MaskStack&&window.MaskStack.stack&&window.MaskStack.stack.length) return;
        try{ if(typeof CODE_EDIT!=='undefined'&&CODE_EDIT&&CODE_EDIT.open&&CODE_EDIT.searchBar&&CODE_EDIT.searchBar.classList.contains('open')) return; }catch(err){}
        e.preventDefault();
        try{ if(e.stopPropagation)e.stopPropagation(); }catch(err){}
        if(!pickBarEscArmed){ pickBarEscArmed=true; pickBarEscTip(true); return; }
        pickBarEscArmed=false; pickBarEscTip(false);
        try{ CTRL_PICK.clear(); }catch(err2){}
        try{ CTRL_PICK.hideFab(); }catch(err3){}
      }catch(err){}
    },true);
  }
}catch(e){}
/* ═══════ 输入条悬浮操作窗（交互，单元素）：按钮上方弹出，不进抽屉 ═══════ */
var pickBarPopKind=null;
function pickBarSelOne(){
  try{ if(CTRL_PICK&&CTRL_PICK.selected&&CTRL_PICK.selected.length===1) return CTRL_PICK.selected[0]; }catch(e){}
  return null;
}
function pickBarSelPage(it){
  var pg='';
  try{ pg=String(it.page||''); }catch(e){}
  if(!pg){ try{ pg=(typeof editFrameHash==='function')?editFrameHash():''; }catch(e){} }
  return pg||'';
}
function pickBarClosePop(){
  try{ var p=document.getElementById('pickBarPop'); if(p){ p.style.display='none'; p.innerHTML=''; } }catch(e){}
  pickBarPopKind=null;
  try{
    var ba=document.getElementById('pickBarAnno'), bl=document.getElementById('pickBarLink');
    if(ba)ba.classList.remove('on');
    if(bl)bl.classList.remove('on');
  }catch(e){}
}
function pickBarPopShell(title, elLabel){
  var pop=document.getElementById('pickBarPop');
  if(!pop) return null;
  pop.innerHTML='';
  var hd=document.createElement('div'); hd.className='pick-bar-pop-hd'; hd.textContent=title;
  var x=document.createElement('span'); x.className='pick-bar-pop-x'; x.textContent='✕'; x.title='关闭';
  x.onclick=function(){ pickBarClosePop(); };
  hd.appendChild(x); pop.appendChild(hd);
  var el=document.createElement('div'); el.className='pick-bar-pop-el'; el.textContent=String(elLabel||'');
  pop.appendChild(el);
  pop.style.display='flex';
  return pop;
}
function pickBarMarkOn(kind){
  try{
    var bl=document.getElementById('pickBarLink');
    if(bl)bl.classList.toggle('on',kind==='link');
  }catch(e){}
}
function pickBarTogglePop(kind){
  try{
    if(kind!=='link') return;
    if(pickBarPopKind===kind){ pickBarClosePop(); return; }
    pickBarOpenLink();
  }catch(e){}
}
/* 标注直存：取输入框文字设为该元素标注，无弹窗；存前先补ID升级选择器，存完收条清选中 */
function pickBarAnnoGo(){
  try{
    var it=pickBarSelOne(); if(!it) return;
    var req='';
    try{ req=String(document.getElementById('pickBarInput').value||'').trim(); }catch(e){}
    if(!req){ try{ alert('请先在输入框输入标注内容。'); }catch(e){} try{ document.getElementById('pickBarInput').focus(); }catch(e){} return; }
    var AE=null;
    try{ AE=window.AnnotationEngine; }catch(e){}
    if(!AE||typeof AE.loadInspectorAnno!=='function'||typeof AE.saveCurrentAnno!=='function'){ try{ alert('标注模块不可用。'); }catch(e){} return; }
    var pg=pickBarSelPage(it);
    var sel=String(it.selector||'');
    var finish=function(finalSel){
      try{ AE.loadInspectorAnno(it.el||null, finalSel, pg); }catch(e){}
      if(it.remote){ try{ if(typeof AE.setInspectorRemoteInfo==='function')AE.setInspectorRemoteInfo({label:it.text||'',text:it.text||'',tagName:it.tagName||''}); }catch(e){} }
      try{
        var hid=null;
        try{ hid=document.getElementById('annoContentInput'); }catch(e){}
        if(hid) hid.value=req;
        AE.saveCurrentAnno();
      }catch(e){}
      try{ CTRL_PICK.clear(); }catch(e2){}
      try{ CTRL_PICK.hideFab(); }catch(e3){}
    };
    if(/data-pr-id\s*=/.test(sel)){ finish(sel); return; }
    /* 先补ID：读文件→内存升级→写盘+后台刷新→用新选择器存 */
    var dir='', file='';
    try{ dir=(typeof currentSource!=='undefined'&&currentSource&&currentSource.sandboxDir)?currentSource.sandboxDir:''; }catch(e){}
    try{ file=(typeof editQueueCurHtmlFile==='function')?editQueueCurHtmlFile():''; }catch(e){}
    var sb=null;
    try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
    var liveIndex=-1;
    try{
      if(it.el&&it.el.ownerDocument){
        var all=it.el.ownerDocument.querySelectorAll(sel);
        for(var ai=0;ai<all.length;ai++){ if(all[ai]===it.el){ liveIndex=ai; break; } }
      }
    }catch(e){}
    if(!(liveIndex>=0)&&it.remote&&typeof it.pickIndex==='number') liveIndex=it.pickIndex;
    if(!sb||!dir||!file){ finish(sel); return; }
    codeEditLoading(true, '正在补齐稳定ID…');
    sb.readFile({dir:dir,file:file}).then(function(r){
      var src=String((r&&r.content)||'');
      var up=null;
      try{ up=(typeof prIdPickUpgrade==='function')?prIdPickUpgrade(src, sel, liveIndex, String(it.text||'')):null; }catch(e){}
      var go=function(finalSel2, injected){
        var after=function(){
          try{ codeEditLoading(false); }catch(e){}
          /* 写盘与否都静默刷新，保证活文档同步 ID */
          try{
            var saved=null;
            try{ saved=(typeof inlineEditCaptureScroll==='function')?inlineEditCaptureScroll():null; }catch(e){}
            if(typeof inlineEditSilentRefresh==='function')inlineEditSilentRefresh(saved,file);
          }catch(e){}
          finish(finalSel2);
        };
        if(injected&&injected!==src){
          sb.write({dir:dir,file:file,content:injected}).then(function(){ after(); }).catch(function(){ after(); });
        }else after();
      };
      if(up&&up.sel) go(up.sel, up.noop?null:up.srcHtml);
      else go(sel, null);
    }).catch(function(){ try{ codeEditLoading(false); }catch(e){} finish(sel); });
  }catch(e){}
}
function pickBarOpenLink(){
  var it=pickBarSelOne(); if(!it) return;
  if(!window.LinkBind||typeof window.LinkBind.quickBind!=='function'){ try{ alert('交互模块不可用。'); }catch(e){} return; }
  var sel=String(it.selector||''); if(!sel) return;
  var pg=pickBarSelPage(it);
  var links=[];
  try{ links=(typeof currentSource!=='undefined'&&currentSource&&currentSource._links)||[]; }catch(e){}
  var bound=null;
  for(var i=0;i<links.length;i++){ if(links[i].selector===sel&&String(links[i].page||'')===String(pg||'')){ bound=links[i]; break; } }
  var pop=pickBarPopShell('交互绑定', String(it.text||it.tagName||sel).slice(0,30));
  if(!pop) return;
  pickBarPopKind='link'; pickBarMarkOn('link');
  if(bound){
    var bi=document.createElement('div'); bi.className='pick-bar-pop-bound';
    bi.textContent='已绑定 → '+String(bound.target||'')+((bound.targetPage)?(' · '+bound.targetPage):'');
    pop.appendChild(bi);
  }
  var entries=[];
  try{
    if(typeof currentSource!=='undefined'&&currentSource) entries.push(currentSource);
    if(typeof sources!=='undefined'&&sources&&sources.length){
      for(var s=0;s<sources.length;s++){ if(sources[s]!==currentSource) entries.push(sources[s]); }
    }
  }catch(e){}
  if(!entries.length){
    var hint=document.createElement('div'); hint.className='pick-bar-pop-el'; hint.textContent='项目内暂无可选原型。';
    pop.appendChild(hint);
    return;
  }
  var targetSel=document.createElement('select'); targetSel.title='跳转目标原型';
  entries.forEach(function(s,idx){
    var op=document.createElement('option'); op.value=String(idx);
    op.textContent=String(s.displayName||s.name||('原型'+(idx+1)))+(s===currentSource?'（本原型）':'');
    targetSel.appendChild(op);
  });
  var subSel=document.createElement('select'); subSel.title='目标页面';
  var fillSubs=function(){
    subSel.innerHTML='';
    var s=entries[parseInt(targetSel.value,10)]||entries[0];
    var mainF='', subs=[];
    try{ mainF=s.mainHtmlFile||s.name||''; }catch(e){}
    try{ subs=(s.subPages&&s.subPages.slice())||[]; }catch(e){}
    var op0=document.createElement('option'); op0.value=''; op0.textContent='打开主页'+(mainF?('（'+mainF+'）'):'');
    subSel.appendChild(op0);
    subs.forEach(function(sp){
      var f=sp&&(sp.file||sp.name||sp), nm=(sp&&(sp.name||sp.file))||f;
      if(!f) return;
      var op=document.createElement('option'); op.value=String(f); op.textContent=String(nm);
      subSel.appendChild(op);
    });
  };
  targetSel.onchange=fillSubs; fillSubs();
  pop.appendChild(targetSel); pop.appendChild(subSel);
  var row=document.createElement('div'); row.className='pick-bar-pop-row';
  if(bound){
    var unbind=document.createElement('button'); unbind.type='button'; unbind.className='pick-bar-btn'; unbind.style.color='#DC2626'; unbind.textContent='解除';
    unbind.onclick=function(){ try{ window.LinkBind.removeJumpBinding(sel,pg); }catch(e){} pickBarClosePop(); try{ CTRL_PICK.clear(); }catch(e2){} try{ CTRL_PICK.hideFab(); }catch(e3){} };
    row.appendChild(unbind);
  }
  var save=document.createElement('button'); save.type='button'; save.className='docs-btn primary'; save.textContent='保存绑定';
  save.onclick=function(){
    var s=entries[parseInt(targetSel.value,10)]||entries[0];
    var tn=''; try{ tn=s.displayName||s.name||''; }catch(e){}
    if(!tn){ try{ alert('请先选择跳转目标原型。'); }catch(e){} return; }
    try{
      window.LinkBind.quickBind(
        { el:(it.el||null), selector:sel, page:pg, label:it.text||'', text:it.text||'', tagName:it.tagName||'', pickIndex:(typeof it.pickIndex==='number')?it.pickIndex:-1 },
        tn, String(subSel.value||'')
      );
    }catch(e){}
    pickBarClosePop();
    try{ CTRL_PICK.clear(); }catch(e2){}
    try{ CTRL_PICK.hideFab(); }catch(e3){}
  };
  row.appendChild(save); pop.appendChild(row);
}
var pickBarAnnoEl=document.getElementById('pickBarAnno');
if(pickBarAnnoEl)pickBarAnnoEl.onclick=function(){ pickBarAnnoGo(); };
var pickBarLinkEl=document.getElementById('pickBarLink');
if(pickBarLinkEl)pickBarLinkEl.onclick=function(){ pickBarTogglePop('link'); };
updateEditBadge();

/* 渲染批量面板：标题 / 批量统一视图 chips / 分别独立视图卡片 */
function renderMultiEditPanel() {
  var title = document.getElementById('multiEditTitle');
  if (title) title.textContent = '已选中 ' + CTRL_PICK.selected.length + ' 个元素';

  var chips = document.getElementById('selChipsList');
  if (chips) {
    chips.innerHTML = '';
    CTRL_PICK.selected.forEach(function (it, i) {
      var c = document.createElement('span');
      c.className = 'sel-chip';
      c.textContent = (i + 1) + '. ' + (it.text || it.tagName || '元素');
      c.title = it.selector;
      chips.appendChild(c);
    });
  }

  var list = document.getElementById('individualItemsList');
  if (list) {
    list.innerHTML = '';
    CTRL_PICK.selected.forEach(function (it, i) {
      var itm = document.createElement('div');
      itm.className = 'indiv-item';
      var head = document.createElement('div');
      head.className = 'indiv-item-head';
      head.textContent = (i + 1) + '. ' + (it.text || it.tagName || '元素');
      head.title = it.selector;
      var ta = document.createElement('textarea');
      ta.className = 'indiv-input';
      ta.id = 'indiv_input_' + it.id;
      ta.placeholder = '该元素的独立修改诉求…';
      itm.appendChild(head); itm.appendChild(ta);
      list.appendChild(itm);
    });
  }
}

/* 双 Tab 切换 */
var tabBatchEl = document.getElementById('tabBatchMode');
var tabIndivEl = document.getElementById('tabIndividualMode');
function switchMultiEditTab(mode) {
  var isBatch = (mode === 'batch');
  if (tabBatchEl) tabBatchEl.classList.toggle('on', isBatch);
  if (tabIndivEl) tabIndivEl.classList.toggle('on', !isBatch);
  var vb = document.getElementById('viewBatchMode');
  var vi = document.getElementById('viewIndividualMode');
  if (vb) vb.style.display = isBatch ? '' : 'none';
  if (vi) vi.style.display = isBatch ? 'none' : '';
}
if (tabBatchEl) tabBatchEl.onclick = function(){ switchMultiEditTab('batch'); };
if (tabIndivEl) tabIndivEl.onclick = function(){ switchMultiEditTab('individual'); };

/* 主窗口 + iframe 双挂键盘监听（防重绑定；目标窗口自身表单焦点下不拾取） */
function bindCtrlInspectListeners(targetWindow) {
  if (!targetWindow) return;
  if (window.__EXPORT_BOOT__===true)return;
  try {
    if (targetWindow.__ctrlPickBound) return;
    targetWindow.__ctrlPickBound = true;
  } catch (e) {
    return;
  }

  try {
    targetWindow.addEventListener('keydown', function(e) {
      try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(_e2){}
      if ((e.key === 'Control' || e.key === 'Meta') && !e.altKey && !e.shiftKey) {
        try{ if(typeof isAnyPopupOpen==='function'&&isAnyPopupOpen()) return; }catch(_e){}
        /* 表单焦点不再豁免：只上报修饰键、不拦截按键，打字组合键不受影响；
         * 输入框/下拉框同样可按住 Ctrl 点选拾取（松开即退出，无点击则无面板）。
         * 焦点检测保留（门禁要求可观测）：仅记录，不再拦截进入。 */
        try{
          var targetDoc=null;
          try{ targetDoc=targetWindow.document; }catch(_d){}
          var ae=targetDoc?targetDoc.activeElement:null;
          window.__ctrlPickFormFocus=!!(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT'||ae.isContentEditable));
        }catch(_e){}
        if (!CTRL_PICK.holding) { CTRL_PICK.holding = true; CTRL_PICK.enter(); }
      }
      // Esc 统一由 MaskStack 单一监听接管，此处不再重复注册，仅保留 Ctrl 抬起逻辑，避免双 Esc
    }, true);

    targetWindow.addEventListener('keyup', function(e) {
      if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
        var had = CTRL_PICK.holding;
        CTRL_PICK.holding = false;
        CTRL_PICK.exit();
        if (had && CTRL_PICK.selected.length > 0) CTRL_PICK.showFab();
      }
    }, true);
  } catch (e) {
    return;
  }
}

/* 沙箱跨域远端悬停：帧侧武装期间元素变化上报包围盒，宿主用既有 #editHover 绘制；
 * 非拾取态/就地改打开中不显示；退出拾取态即隐藏（exit 统一回收）。 */
function editShowHoverRect(r){
  if(!r||!editHoverEl)return;
  try{
    var p=editRectToPage(r);
    editHoverEl.style.display='block';
    editHoverEl.style.left=p.left+'px'; editHoverEl.style.top=p.top+'px';
    editHoverEl.style.width=p.width+'px'; editHoverEl.style.height=p.height+'px';
  }catch(e){}
}
function remoteHoverRect(r){
  try{
    if(!r){ editHideHover(); return; }
    if(!(CTRL_PICK&&CTRL_PICK.holding)){ return; }
    try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open){ editHideHover(); return; } }catch(e){}
    editShowHoverRect(r);
  }catch(e){}
}
try{ window.__onRemoteHover=function(r){ remoteHoverRect(r); }; }catch(e){}
/* 未武装命中补偿：Ctrl+Shift 进代码编辑（允许编辑器打开时切换选中，脏确认由 codeEditOpen 处理），否则多选；
 * 收编后补启动循环，保障后续点击。 */
function remotePickMiss(res){
  try{
    if(!res||!res.selector) return;
    if(window.__EXPORT_BOOT__===true) return;
    try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open) return; }catch(e){}
    var wantInline = false; try{ wantInline=!!res.shift||!!res.shiftKey||(CTRL_PICK&&CTRL_PICK.remoteMode==='inline'); }catch(_we){}
    if(!(CTRL_PICK&&CTRL_PICK.holding)&&!wantInline) return;
    if(wantInline){
      try{ if(typeof codeEditOpenRemote==='function')codeEditOpenRemote(res); }catch(e2){}
      return;
    }
    try{ CTRL_PICK.toggleRemote(res); }catch(e3){}
    try{ ctrlStartRemotePickLoop(); }catch(e4){}
  }catch(e){}
}
try{ window.__onRemotePickMiss=function(r){ remotePickMiss(r); }; }catch(e){}
/* 拾取态统一取消（宿主 Esc / 帧 Esc 共用）：退出+清选+解武装 */
function cancelCtrlPickState(){
  try{
    if(CTRL_PICK){ CTRL_PICK.holding=false; try{ CTRL_PICK.exit(); }catch(e){} try{ CTRL_PICK.clear(); }catch(e2){} }
    try{ ctrlStopRemotePickLoop(); }catch(e3){}
    try{ CTRL_PICK.remoteMode='pick'; }catch(e4){}
  }catch(e){}
}
try{ window.__cancelCtrlPick=function(){ cancelCtrlPickState(); }; }catch(e){}
/* 帧内 Esc：焦点在帧内时宿主收不到 Esc，按优先级处理（取消拾取 > 关闭就地改 > 关栈顶弹窗） */
function remoteEscape(){
  try{
    if(CTRL_PICK&&CTRL_PICK.holding){ cancelCtrlPickState(); return; }
    try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open){ inlineEditTryClose(); return; } }catch(e){}
    if(window.MaskStack) window.MaskStack.esc();
  }catch(e){}
}
try{ window.__onRemoteEscape=function(){ remoteEscape(); }; }catch(e){}
/* 初始化：主窗口绑定 + iframe load 常驻绑定 + 滚动重绘 + 焦点丢失兜底 */
bindCtrlInspectListeners(window);
/* 沙箱跨域远端拾取调度（独立监听，bindCtrlInspectListeners 原样保留供门禁与同源兼容）：
 * Ctrl 按下（无 Shift）→ 多选循环武装；Ctrl+Shift → 停循环、单发就地改武装；
 * Ctrl 抬起 → 停循环并解除帧武装。循环内部以 holding 自检，表单焦点等情况自动空转退出。 */
/* 沙箱跨域修饰键同步：焦点在帧内时宿主收不到键盘事件，帧侧 Agent 只上报
 * Control/Meta/Shift 布尔态（绝不含内容按键）。输入框聚焦时同样上报，
 * 以便输入框/下拉框可按住 Ctrl 点选拾取；仅上报不拦截，打字组合键不受影响。
 * 与宿主本地监听互斥无关：状态赋值幂等，循环/单发均有 remoteLoop/remoteMode 守卫防重入。 */
function remoteCtrlStateChanged(st){
  try{
    if(window.__EXPORT_BOOT__===true)return;
    if(!st||st.alt)return;
    try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(e){}
    var wantHold=!!(st.ctrlKey||st.metaKey), wantShift=!!st.shiftKey;
    if(wantHold&&!CTRL_PICK.holding&&!wantShift){
      try{ if(typeof isAnyPopupOpen==='function'&&isAnyPopupOpen()) return; }catch(e0){}
      CTRL_PICK.holding=true; CTRL_PICK.remoteMode='pick';
      try{ CTRL_PICK.enter(); }catch(e2){}
      try{ ctrlStartRemotePickLoop(); }catch(e3){}
    }else if(wantHold&&wantShift&&!CTRL_PICK.holding){
      /* 空闲态直接按住 Ctrl+Shift（Shift 先按/同时按）：直接进代码编辑单发武装，不丢首次点击；
       * 编辑器已打开时同样允许，用于切换选中元素（其它弹窗仍互斥） */
      try{
        if(typeof isAnyPopupOpen==='function'&&isAnyPopupOpen()){
          var _only=false;
          try{ _only=(typeof codeEditOnlyPopup==='function'&&codeEditOnlyPopup()); }catch(_e01){}
          if(!_only) return;
        }
      }catch(e01){}
      CTRL_PICK.holding=true; CTRL_PICK.remoteMode='inline';
      try{ if(typeof CTRL_PICK.enter==='function')CTRL_PICK.enter(); }catch(e2){}
      try{ ctrlArmInlineOnce(); }catch(e5){}
    }else if(wantHold&&wantShift&&CTRL_PICK.holding&&CTRL_PICK.remoteMode!=='inline'){
      CTRL_PICK.remoteMode='inline';
      try{ ctrlStopRemotePickLoop(); }catch(e4){}
      try{ ctrlArmInlineOnce(); }catch(e5){}
    }else if(!wantHold&&CTRL_PICK.holding){
      CTRL_PICK.holding=false;
      try{ CTRL_PICK.exit(); }catch(e6){}
      try{ ctrlStopRemotePickLoop(); }catch(e7){}
      try{ if(CTRL_PICK.selected.length>0)CTRL_PICK.showFab(); }catch(e8){}
    }else if(wantHold&&!wantShift&&CTRL_PICK.holding&&CTRL_PICK.remoteMode!=='pick'){
      CTRL_PICK.remoteMode='pick';
      try{ ctrlStartRemotePickLoop(); }catch(e9){}
    }
  }catch(e){}
}
try{ window.__onRemoteCtrlState=function(st){ remoteCtrlStateChanged(st); }; }catch(e){}
try{
if(!window.__ctrlRemoteDispatchBound){
  window.__ctrlRemoteDispatchBound=true;
  window.addEventListener('keydown', function(e){
    try{
      if(window.__EXPORT_BOOT__===true)return;
      if(e.altKey)return;
      var isCtrl=(e.key==='Control'||e.key==='Meta');
      var withCtrl=(e.ctrlKey||e.metaKey);
      if(isCtrl&&!e.shiftKey&&withCtrl){
        try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(_e){}
        CTRL_PICK.remoteMode='pick';
        try{ ctrlStartRemotePickLoop(); }catch(_e2){}
      }else if(e.key==='Shift'&&withCtrl){
        try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(_e3){}
        if(CTRL_PICK&&CTRL_PICK.holding){
          CTRL_PICK.remoteMode='inline';
          try{ ctrlStopRemotePickLoop(); }catch(_e4){}
          try{ ctrlArmInlineOnce(); }catch(_e5){}
        }else if(CTRL_PICK&&!CTRL_PICK.holding){
          /* 焦点在宿主、空闲态直接 Ctrl+Shift：直接进代码编辑单发武装（与远端 CTRL_STATE 空闲分支对称）；
           * 编辑器已打开时同样允许切换（其它弹窗仍互斥） */
          try{
            if(typeof isAnyPopupOpen==='function'&&isAnyPopupOpen()){
              var _only2=false;
              try{ _only2=(typeof codeEditOnlyPopup==='function'&&codeEditOnlyPopup()); }catch(_e62){}
              if(!_only2) return;
            }
          }catch(_e6){}
          CTRL_PICK.holding=true; CTRL_PICK.remoteMode='inline';
          try{ if(typeof CTRL_PICK.enter==='function')CTRL_PICK.enter(); }catch(_e7){}
          try{ ctrlArmInlineOnce(); }catch(_e8){}
        }
      }else if(isCtrl&&e.shiftKey&&withCtrl&&CTRL_PICK&&!CTRL_PICK.holding){
        /* Ctrl 键按下时 Shift 已按住（Shift 先按序）：同样直接进代码编辑单发，避免首次点击丢失 */
        try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return; }catch(_e9){}
        try{
          if(typeof isAnyPopupOpen==='function'&&isAnyPopupOpen()){
            var _only3=false;
            try{ _only3=(typeof codeEditOnlyPopup==='function'&&codeEditOnlyPopup()); }catch(_e112){}
            if(!_only3) return;
          }
        }catch(_e11){}
        CTRL_PICK.holding=true; CTRL_PICK.remoteMode='inline';
        try{ if(typeof CTRL_PICK.enter==='function')CTRL_PICK.enter(); }catch(_e12){}
        try{ ctrlArmInlineOnce(); }catch(_e13){}
      }
    }catch(_e){}
  }, true);
  window.addEventListener('keyup', function(e){
    try{
      if(e.key==='Control'||e.key==='Meta'){
        try{ CTRL_PICK.remoteMode='pick'; }catch(_e){}
        try{ ctrlStopRemotePickLoop(); }catch(_e2){}
      }else if(e.key==='Shift'&&(e.ctrlKey||e.metaKey)){
        /* Shift 抬起但 Ctrl 仍按住：回到多选循环 */
        try{
          if(CTRL_PICK&&CTRL_PICK.holding&&!(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)){
            CTRL_PICK.remoteMode='pick';
            ctrlStartRemotePickLoop();
          }
        }catch(_e3){}
      }
    }catch(_e){}
  }, true);
}
}catch(e){}
if (frame) {
  frame.addEventListener('load', function() {
    if (window.LinkBind && typeof LinkBind.onFrameLoad === 'function') LinkBind.onFrameLoad();
    if (window.AnnotationEngine && typeof AnnotationEngine.onFrameLoad === 'function') AnnotationEngine.onFrameLoad();
    editAttach();
    var doc = null;
    try { doc = frame.contentDocument; } catch(e) {}
    try {
      if (frame.contentWindow) bindCtrlInspectListeners(frame.contentWindow);
    } catch (e) {}
    if (doc && !doc.__ctrlScrollBound) {
      doc.__ctrlScrollBound = true;
      doc.addEventListener('scroll', function() {
        if (CTRL_PICK.selected.length > 0) CTRL_PICK.renderOverlay();
      }, { capture: true, passive: true });
    }
  });
}
window.addEventListener('blur', function(){
  var intoFrame=false;
  try{ intoFrame=(typeof frame!=='undefined'&&frame&&document.activeElement===frame); }catch(e){}
  if(intoFrame) return; /* 焦点进了原型帧：拾取会话保持（帧侧按键/点击接管），否则首次点入即被掐断 */
  if(CTRL_PICK.holding){ CTRL_PICK.holding = false; CTRL_PICK.exit(); }
  try{ ctrlStopRemotePickLoop(); }catch(e){}
});
setInterval(function(){
  if(!CTRL_PICK.holding) return;
  var intoFrame=false;
  try{ intoFrame=(typeof frame!=='undefined'&&frame&&document.activeElement===frame); }catch(e){}
  if(intoFrame) return; /* 焦点在原型帧内：保持拾取（沙箱跨进程帧下 document.hasFocus 不可靠，误杀悬停框） */
  if(!(document.hasFocus())) { CTRL_PICK.holding = false; CTRL_PICK.exit(); }
}, 300);

/* 批量面板按钮与遮罩事件绑定 */
var multiEditCloseEl = document.getElementById('multiEditClose');
var btnCancelMultiEditEl = document.getElementById('btnCancelMultiEdit');
var btnSubmitMultiEditEl = document.getElementById('btnSubmitMultiEdit');
var multiEditMaskEl = document.getElementById('multiEditMask');
if (multiEditCloseEl) multiEditCloseEl.onclick = function(){ CTRL_PICK.closePanel(); CTRL_PICK.clear(); };
if (btnCancelMultiEditEl) btnCancelMultiEditEl.onclick = function(){ CTRL_PICK.closePanel(); CTRL_PICK.clear(); };
if (btnSubmitMultiEditEl) btnSubmitMultiEditEl.onclick = function(){
  /* 模式参数以当前选中 Tab 为准（动态判断，避免硬编码 'batch'） */
  var isIndiv = tabIndivEl && tabIndivEl.classList.contains('on');
  CTRL_PICK.submitBatch(isIndiv?'individual':'batch');
};
if (multiEditMaskEl) multiEditMaskEl.onclick = function(){ CTRL_PICK.closePanel(); CTRL_PICK.clear(); };
if (editDrawerMaskEl) editDrawerMaskEl.onclick = function(){ closeEditDrawer(); };
/* MaskStack 统一遮罩点击注册（点遮罩 + Esc 双关闭） */
if(window.MaskStack && window.MaskStack.register){
  try{ window.MaskStack.register('editDrawerMask','editDrawer', closeEditDrawer); }catch(e){}
  try{ window.MaskStack.register('multiEditMask','multiEditDrawer', function(){ CTRL_PICK.closePanel(); CTRL_PICK.clear(); }); }catch(e){}
}

/* 导出全局队列访问接口 */
window.editQueueGet = function(){ return EDIT_QUEUE; };
window.editQueueAdd = editQueueAdd;
/* Wave-B: window.setEditMode 导出已删除（零调用存根） */
/* FIX: 经典<script>加载，移除ESM export(以window.CTRL_PICK/editQueue*为准) */
function editQueueGetFn(){ return EDIT_QUEUE; }

/* —— 打开页面自动加载默认预设目录 —— */
loadGroups(); /* 虚拟分组数据（本地分类整理，不落盘沙箱） */
var btnAddGroupEl=$('btnAddGroup');
if(btnAddGroupEl)btnAddGroupEl.onclick=function(){ addGroup(null); }; /* 菜单栏按钮：始终创建一级文件夹 */
setTimeout(function(){ loadDefaultPreset(); },120);