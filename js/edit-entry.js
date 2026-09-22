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
        ancestors: (res && Array.isArray(res.ancestors)) ? res.ancestors.slice(0, 8) : [],
        parentHtml: String((res && res.parentHtml) || '').slice(0, 2000),
        el: null
      });
    }
    CTRL_PICK.renderOverlay();
  },
  clear: function () {
    CTRL_PICK.selected = [];
    if (CTRL_PICK.overlay) CTRL_PICK.overlay.innerHTML = '';
    editHideHover();
    CTRL_PICK.hovering = null;
  },

  /* —— 覆盖层 —— */
  renderOverlay: function () {
    ensurePickOverlay();
    if (CTRL_PICK.overlay) CTRL_PICK.overlay.style.display = '';
    CTRL_PICK.overlay.innerHTML = '';
    if (!CTRL_PICK.selected.length) return;
    CTRL_PICK.selected.forEach(function (it, i) {
      var r = null;
      if (it.el && it.el.ownerDocument) {
        try { r = it.el.getBoundingClientRect(); } catch (e) { r = null; }   /* 实时读取，防滚动/缩放漂移 */
      }
      if (!r) r = it.rect;                                                    /* 远端拾取用帧回传 rect */
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
    if (CTRL_PICK.selected.length === 1) {
      /* 单选：远端拾取（沙箱跨域无 live el）直接移交检查器远端入口；nonce 匹配即帧来源可信 */
      var only = CTRL_PICK.selected[0];
      if (only && only.remote) {
        var rpg = String(only.page || '');
        try { if (!rpg && typeof editFrameHash === 'function') rpg = editFrameHash() || ''; } catch (e) {}
        CTRL_PICK.clear();
        if (window.LinkBind && typeof LinkBind.openInspectorRemote === 'function') {
          LinkBind.openInspectorRemote({ selector: only.selector, page: rpg, label: only.text || only.tagName || only.selector, text: only.text || '', tagName: only.tagName || '' });
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
  },
  submitBatch: function (mode) {
    if (!CTRL_PICK.selected.length) return;
    var isBatch = (mode !== 'individual');
    var reqInput = null;
    var added = 0;
    if (isBatch) {
      reqInput = document.getElementById('batchReqInput');
      var userReq = reqInput ? reqInput.value.trim() : '';
      if (!userReq) { alert('请输入统一修改诉求。'); return; }
      CTRL_PICK.selected.forEach(function (it) { if (it.remote) editQueueAddRemote(it, userReq); else editQueueAdd(it.el, userReq); added++; });
    } else {
      /* 分别独立：读取每张卡片输入，非空才入队；全空提交拦截 */
      CTRL_PICK.selected.forEach(function (it) {
        var input = document.getElementById('indiv_input_' + it.id);
        var req = input ? input.value.trim() : '';
        if (req) { if (it.remote) editQueueAddRemote(it, req); else editQueueAdd(it.el, req); added++; }
      });
      if (added === 0) { alert('请至少为一个元素填写修改诉求。'); return; }
    }
    if (isBatch && reqInput) reqInput.value = '';  /* 批量模式提交后清空输入框，防止历史内容残留 */
    /* 仅加入待提交列表，不直接提交大模型：由用户从顶部「待提交列表」核对后统一提交 */
    if (typeof libStatus === 'function') libStatus('已将 ' + added + ' 条修改需求加入待提交列表（可点顶部「待提交列表」查看并提交）。');
    CTRL_PICK.clear();
    CTRL_PICK.closePanel();
  }
};

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
/* 生成元素唯一路径：优先稳定 data-testid；否则短 id；否则逐级 tag:nth-of-type 全路径（保证唯一可定位） */
function generateSelector(el){
  if(!el)return '';
  var d=el.ownerDocument;
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
function editRectToPage(rect){ var fr=frame.getBoundingClientRect(),s=editFrameScale(); return { left:fr.left+rect.left*s, top:fr.top+rect.top*s, width:rect.width*s, height:rect.height*s }; }
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
  /* Ctrl+Shift+单击进INLINE_EDIT浮层：复用editDblClick同一入口（定位/保存/转队列一致），不进CTRL_PICK拾取 */
  if(ev&&(ev.ctrlKey||ev.metaKey)&&ev.shiftKey){
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    try{ if(CTRL_PICK&&CTRL_PICK.holding){ CTRL_PICK.holding=false; try{ CTRL_PICK.exit(); }catch(e){} } }catch(e2){}
    try{
      var _csT=(ev&&ev.target)||null;
      if(_csT&&_csT.nodeType===1&&typeof editDblClick==='function'){
        var _proxy={target:_csT,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,clientX:(ev&&ev.clientX)||0,clientY:(ev&&ev.clientY)||0,detail:(ev&&ev.detail)||0,preventDefault:function(){},stopPropagation:function(){}};
        editDblClick(_proxy);
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
        if(CTRL_PICK.remoteMode==='inline'){ CTRL_PICK.remoteLoop=false; try{ inlineEditOpenRemote(res); }catch(e){} return; }
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
    var tok=++CTRL_PICK.remoteSeq;
    sandboxRequestPick(20000).then(function(res){
      if(tok!==CTRL_PICK.remoteSeq)return;
      if(!res||!res.selector)return;
      try{ inlineEditOpenRemote(res); }catch(e2){}
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
    h+='<div class="ed-item'+(_sel?' sel':'')+'" data-id="'+escAttr(it.id)+'"><div class="ei-top"><span class="ei-no">'+(i+1)+'</span><span class="ei-proto" title="'+escAttr(protoName)+'">'+escHtml(protoName)+'</span><span class="ei-file" title="'+escAttr(effFile)+'">'+escHtml(effFile)+'</span><span class="ei-page">'+escHtml(it.page?it.page:'（首页）')+'</span>'
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
  var srcName=(currentSource&&currentSource.displayName)||(currentSource&&currentSource.name)||'当前原型';
  var mainFile=(currentSource&&(currentSource.mainHtmlFile||currentSource.name))||'';
  var curActive=(typeof editQueueCurHtmlFile==='function'?editQueueCurHtmlFile():(currentSource&&(currentSource.activeSubFile||mainFile)||''));
  var isMulti=!!(currentSource&&((currentSource.subPages&&currentSource.subPages.length)||(currentSource.htmlFiles&&currentSource.htmlFiles.length>1)));
  var srcFull=srcName+((isMulti&&curActive&&mainFile&&curActive!==mainFile)?' / '+curActive:'');
  function effOf(it){ return it.htmlFile||mainFile||'当前文件'; }
  var seen={}, htmlFiles=[];
  _selList.forEach(function(it){ var f=effOf(it); if(!seen[f]){ seen[f]=1; htmlFiles.push(f); } });
  if(!htmlFiles.length&&mainFile)htmlFiles=[mainFile];
  /* 精简拼装：按文件+需求文本合并同类项（同一种改法只写一遍，选择器并列）；单文件单页省略页面行；
   * 每条附层级链 + 父级代码片段（定位参考，截断，以磁盘文件为准） */
  var groups=[];
  _selList.forEach(function(it){
    var t=String(it.text||'').trim(), f=effOf(it);
    var g=null;
    for(var i=0;i<groups.length;i++){ if(groups[i].file===f&&groups[i].text===t){ g=groups[i]; break; } }
    if(!g){ g={file:f, text:t, sels:[]}; groups.push(g); }
    var sel=String(it.selector||''), dup=false;
    for(var j=0;j<g.sels.length;j++){ if(g.sels[j].sel===sel){ dup=true; break; } }
    if(!dup) g.sels.push({sel:sel, page:String(it.page||''), anc:it.ancestors, ph:it.parentHtml});
  });
  var showPage=isMulti;
  if(!showPage){ for(var k=0;k<_selList.length;k++){ if(String(_selList[k].page||'')){ showPage=true; break; } } }
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
  var parts=['改「'+srcFull+'」（共'+_selList.length+'条，涉及文件'+htmlFiles.length+'个：'+htmlFiles.join('、')+'）：',''];
  var dparts=['改「'+srcFull+'」（共'+_selList.length+'条，涉及文件'+htmlFiles.length+'个：'+htmlFiles.join('、')+'）：',''];
  groups.forEach(function(g,i){
    var chips=g.sels.map(function(s){ return '`'+s.sel+'`'+((showPage&&s.page)?'（页面：'+s.page+'）':''); });
    var head='['+(i+1)+'] 所属文件：'+g.file+' ｜ '+chips.join('、')+'：'+g.text;
    parts.push(head);
    dparts.push(head); /* 对话框只展示条目头，不展示层级与代码 */
    g.sels.forEach(function(s){
      var al=ancLine(s.anc);
      if(al) parts.push('    - `'+s.sel+'` '+al);
      var sn=snippetOf(s.ph);
      if(sn) parts.push('      上级代码（定位参考，以磁盘文件为准）：\n      ```html\n      '+sn.split('\n').join('\n      ')+'\n      ```');
    });
  });
  parts.push('','涉及文件清单（共'+htmlFiles.length+'个）：');
  htmlFiles.forEach(function(f){ parts.push(' - '+f); });
  parts.push('','要求：只在所属文件中找，只改清单中的元素；定位不到就直说并跳过，别编、别碰别的文件。');
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
        if (had && CTRL_PICK.selected.length > 0) CTRL_PICK.openPanel();
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
/* 未武装命中补偿：仅拾取态收编（原型自身交互不受影响）；Ctrl+Shift 进就地改，否则多选；
 * 收编后补启动循环，保障后续点击。 */
function remotePickMiss(res){
  try{
    if(!res||!res.selector) return;
    if(window.__EXPORT_BOOT__===true) return;
    if(!(CTRL_PICK&&CTRL_PICK.holding)) return;
    try{ if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open) return; }catch(e){}
    var wantInline = !!res.shift || CTRL_PICK.remoteMode==='inline';
    if(wantInline){
      try{ inlineEditOpenRemote(res); }catch(e2){}
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
      CTRL_PICK.holding=true; CTRL_PICK.remoteMode='pick';
      try{ CTRL_PICK.enter(); }catch(e2){}
      try{ ctrlStartRemotePickLoop(); }catch(e3){}
    }else if(wantHold&&wantShift&&CTRL_PICK.holding&&CTRL_PICK.remoteMode!=='inline'){
      CTRL_PICK.remoteMode='inline';
      try{ ctrlStopRemotePickLoop(); }catch(e4){}
      try{ ctrlArmInlineOnce(); }catch(e5){}
    }else if(!wantHold&&CTRL_PICK.holding){
      CTRL_PICK.holding=false;
      try{ CTRL_PICK.exit(); }catch(e6){}
      try{ ctrlStopRemotePickLoop(); }catch(e7){}
      try{ if(CTRL_PICK.selected.length>0)CTRL_PICK.openPanel(); }catch(e8){}
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
        }
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