/* [js/edit-entry.js] 编辑模式 + 新建原型 + 启动入口（由 app.js 拆分，顺序勿乱调） */
/* ═══════ 预览/编辑模式：编辑模式点击元素 → 检查器抽屉（跳转交互 + 修改需求） → 待提交列表 → 统一提交大模型 ═══════
   编辑定位基于 iframe 内 DOM（webSecurity:false 可跨源读写），不改动原型文件本身；
   每条记录含 内容 + 元素 + 元素唯一路径(CSS Selector) + 所在页面路由，提交时随清单交给大模型定位修改。 */
var EDIT_QUEUE=[],EDIT_HOVER_EL=null,EDIT_LOCKED_EL=null,EDIT_PENDING_SUBMIT=false,EDIT_EDITING_ID=null; /* T3.2:僵尸编辑模式已下线，拾取统一由CTRL_PICK接管 */
var EDIT_LAST_QUEUE=null; /* G01: 清空前的快照，用于撤销/审计 */
var _editQueuePersistTimer=null;
function persistEditQueue(){ try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(e){} }
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
  selected: [],        /* 选中集合：[{id, selector, tagName, text, rect, el}] */
  overlay: null,       /* 覆盖层容器（选择框 + 序号角标） */
  panel: null,         /* 批量面板引用 */

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
    if (CTRL_PICK.hovering) { CTRL_PICK.hovering = null; editHideHover(); }
    try {
      var d = frame.contentDocument;
      if (d) {
        var st = d.getElementById('ctrlPickCrosshairStyle');
        if (st) st.remove();
      }
    } catch (e) {}
  },

  /* —— 拾取 —— */
  toggle: function (targetEl, ev) {
    if (!targetEl) return;
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
        el: targetEl
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
      if (!it.el || !it.el.ownerDocument) return;
      var freshRect = it.el.getBoundingClientRect();          /* 实时读取，防滚动/缩放漂移 */
      var p = editRectToPage(freshRect);
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
      /* 单选：先清空拾取集合与覆盖框，再移交检查器，防止残留污染下一次拾取 */
      var targetEl = CTRL_PICK.selected[0].el;
      CTRL_PICK.clear();
      if (window.LinkBind) LinkBind.openInspector(targetEl);
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
      CTRL_PICK.selected.forEach(function (it) { editQueueAdd(it.el, userReq); added++; });
    } else {
      /* 分别独立：读取每张卡片输入，非空才入队；全空提交拦截 */
      CTRL_PICK.selected.forEach(function (it) {
        var input = document.getElementById('indiv_input_' + it.id);
        var req = input ? input.value.trim() : '';
        if (req) { editQueueAdd(it.el, req); added++; }
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
    editQueueClearEl=$('editQueueClear'),editQueueSubmitEl=$('editQueueSubmit');
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
function editClick(ev){
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
  if(window.LinkBind) LinkBind.openInspector(t);
}
function editAttach(){
  var d=editFrameDoc(); if(!d)return;
  if(d.__editAttached)return; d.__editAttached=true;
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
/* 注：原此处对 frame.load 的 editAttach 重复注册已删除，职责由下方 Ctrl 拾取初始化代码（bindCtrlInspectListeners + 滚动重绘）统一接管 */
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
    EDIT_QUEUE.push({ id:(Date.now()+Math.random().toString(36).slice(2,8)), ts:Date.now(),
      page:pg, selector:sel, label:editElementLabel(el), text:t, htmlFile:curHtml });
    libStatus('已加入待提交列表：'+EDIT_QUEUE.length+' 条（可点顶部「待提交列表」查看或提交）。');
  }
  updateEditBadge();
  renderEditDrawer();
  schedulePersistEditQueue();
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
    var lab=it.label||it.selector;
    var selTip=it.selector+(it.label?'（'+it.label+'）':'');
    var protoName=(typeof currentSource!=='undefined'&&currentSource&&(currentSource.displayName||currentSource.name))||'当前原型';
    var mainF=((typeof currentSource!=='undefined'&&currentSource&&(currentSource.mainHtmlFile||currentSource.name))||'');
    var effFile=it.htmlFile||mainF||'当前文件';
    h+='<div class="ed-item"><div class="ei-top"><span class="ei-no">'+(i+1)+'</span><span class="ei-proto" title="'+escAttr(protoName)+'">'+escHtml(protoName)+'</span><span class="ei-file" title="'+escAttr(effFile)+'">'+escHtml(effFile)+'</span><span class="ei-page">'+escHtml(it.page?it.page:'（首页）')+'</span>'
      +'<span class="ei-edit" data-id="'+escAttr(it.id)+'" title="修改该条需求">✎</span>'
      +'<span class="ei-x" data-id="'+escAttr(it.id)+'" title="删除该条">✕</span></div>'
      +'<div class="ei-sel" title="'+escAttr(selTip)+'">'+escHtml(lab)+'</div>'
      +(it.id===EDIT_EDITING_ID
        ?'<div class="ei-editbox"><textarea class="ei-editta" spellcheck="false">'+escHtml(it.text)+'</textarea>'
        +'<div class="ei-edit-ops"><span class="ei-edit-cancel" data-id="'+escAttr(it.id)+'">取消</span><span class="ei-edit-save" data-id="'+escAttr(it.id)+'">保存</span></div></div>'
        :'<div class="ei-text">'+escHtml(it.text)+'</div>')
      +'</div>';
  });
  editDrawerBodyEl.innerHTML=h;
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
/* 编辑清单提交完成（AI done）：清空待提交列表并提示 */
function __editOnAiDone(){
  if(EDIT_PENDING_SUBMIT){ EDIT_PENDING_SUBMIT=false; EDIT_QUEUE=[]; updateEditBadge(); renderEditDrawer(); libStatus('大模型已按清单完成修改并刷新原型。'); }
  if(window.LinkBind)LinkBind.onAfterAiRefresh();
  if(window.AnnotationEngine && typeof AnnotationEngine.onAfterAiRefresh === 'function') AnnotationEngine.onAfterAiRefresh();
}
function editQueueSubmit(){
  if(!EDIT_QUEUE.length)return;
  if(!HAS_AI){ alert('大模型修改仅桌面端可用（请使用 exe 版打开）。'); return; }
  var srcName=(currentSource&&currentSource.displayName)||(currentSource&&currentSource.name)||'当前原型';
  var mainFile=(currentSource&&(currentSource.mainHtmlFile||currentSource.name))||'';
  var curActive=(typeof editQueueCurHtmlFile==='function'?editQueueCurHtmlFile():(currentSource&&(currentSource.activeSubFile||mainFile)||''));
  var isMulti=!!(currentSource&&((currentSource.subPages&&currentSource.subPages.length)||(currentSource.htmlFiles&&currentSource.htmlFiles.length>1)));
  var srcFull=srcName+((isMulti&&curActive&&mainFile&&curActive!==mainFile)?' / '+curActive:'');
  function effOf(it){ return it.htmlFile||mainFile||'当前文件'; }
  var seen={}, htmlFiles=[];
  EDIT_QUEUE.forEach(function(it){ var f=effOf(it); if(!seen[f]){ seen[f]=1; htmlFiles.push(f); } });
  if(!htmlFiles.length&&mainFile)htmlFiles=[mainFile];
  var parts=['以下是对原型「'+srcFull+'」的需求清单，共'+EDIT_QUEUE.length+'条，涉及文件'+htmlFiles.length+'个（'+htmlFiles.join('、')+'），请按清单逐项修改对应的 HTML 文件：',''];
  EDIT_QUEUE.forEach(function(it,i){
    parts.push('['+(i+1)+'] 所属文件：'+effOf(it)+' ｜ 页面：'+(it.page||'（首页）'));
    parts.push('    元素选择器（CSS Selector，基于该文件该页面当前 DOM 结构生成）：'+it.selector);
    parts.push('    元素：'+it.label);
    parts.push('    修改需求：'+it.text);
  });
  parts.push('','涉及文件清单（共'+htmlFiles.length+'个）：');
  htmlFiles.forEach(function(f){ parts.push(' - '+f); });
  parts.push('','要求：在上述每个所属文件内的对应页面片段中定位这些元素（页面为单文件内路由切换时，选择器适用于对应 hash 页面的 DOM；跨文件时只在所属文件中找）；按「修改需求」直接修改元素的样式/结构/文案/交互；只改清单中的元素，其余保持原样；某元素在所属文件定位不到则在回复中说明并跳过，不要臆造修改、不要改其他文件。');
  var t=parts.join('\n');
  var count=EDIT_QUEUE.length;
  closeEditDrawer();
  /* G01: 提交前备份队列并持久化；失败不清空 - 仅成功提交后才清空 */
  var _editQueueBackup=EDIT_QUEUE.slice();
  // P1-3 fix: 备份至 edit_queue_backup 供失败回滚
  try{ localStorage.setItem('edit_queue_backup', JSON.stringify(EDIT_QUEUE)); }catch(e){} // P1-3 fix
  try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(e){}
  EDIT_QUEUE=[];
  persistEditQueue();
  updateEditBadge(); renderEditDrawer();
  EDIT_PENDING_SUBMIT=true;
  try{
    openAiDesign();
    if(aiInputEl){ aiInputEl.value=t; }
    aiDoSend();
    libStatus('已将 '+count+' 条修改需求提交给大模型，生成完成后自动刷新原型。');
  }catch(e){
    // P1-3 fix: catch(busy) 失败回滚备份
    var backup=null; try{ backup=localStorage.getItem('edit_queue_backup'); }catch(_e){} // P1-3 fix
    if(backup){ try{ EDIT_QUEUE=JSON.parse(backup); }catch(_e){ EDIT_QUEUE=_editQueueBackup; } } else { EDIT_QUEUE=_editQueueBackup; } // P1-3 fix
    EDIT_PENDING_SUBMIT=false;
    updateEditBadge(); renderEditDrawer();
    try{ localStorage.setItem('edit_queue_v1', JSON.stringify(EDIT_QUEUE)); }catch(_e){}
    persistEditQueue(); // P1-3 fix
    alert('提交失败，已恢复待提交列表：'+(e&&e.message||e));
  }
}
function setEditMode(on){
  /* T3.2兼容存根：旧模式开关已下线，统一Ctrl拾取；保留broadcast以防iframe残留 */
  try{ if(typeof console!=='undefined'&&console.warn)console.warn('[deprecated] setEditMode已下线，请按住Ctrl拾取元素。'); }catch(e){}
  try{ editHideHover(); }catch(e){}
  try{ libStatus('按住 Ctrl 点击原型元素即可拾取，松开 Ctrl 批量提交修改需求。'); }catch(e){}
  try{ if(window.LinkBind)LinkBind.broadcastMode(false); }catch(e){}
}
if(btnSubmitEditEl)btnSubmitEditEl.onclick=function(){ openEditDrawer(); };
if(editDrawerCloseEl)editDrawerCloseEl.onclick=closeEditDrawer;
if(editQueueClearEl)editQueueClearEl.onclick=editQueueClear;
if(editQueueSubmitEl)editQueueSubmitEl.onclick=editQueueSubmit;
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
  if (targetWindow.__ctrlPickBound) return;
  targetWindow.__ctrlPickBound = true;

  targetWindow.addEventListener('keydown', function(e) {
    if ((e.key === 'Control' || e.key === 'Meta') && !e.altKey && !e.shiftKey) {
      /* 从目标窗口自身文档读取焦点元素（iframe 内部输入框同样生效） */
      var targetDoc = targetWindow.document;
      var ae = targetDoc ? targetDoc.activeElement : null;
      var inForm = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                          ae.tagName === 'SELECT' || ae.isContentEditable);
      if (inForm) return;
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
}

/* 初始化：主窗口绑定 + iframe load 常驻绑定 + 滚动重绘 + 焦点丢失兜底 */
bindCtrlInspectListeners(window);
if (frame) {
  frame.addEventListener('load', function() {
    if (window.LinkBind && typeof LinkBind.onFrameLoad === 'function') LinkBind.onFrameLoad();
    if (window.AnnotationEngine && typeof AnnotationEngine.onFrameLoad === 'function') AnnotationEngine.onFrameLoad();
    editAttach();
    var doc = null;
    try { doc = frame.contentDocument; } catch(e) {}
    if (frame.contentWindow) bindCtrlInspectListeners(frame.contentWindow);
    if (doc && !doc.__ctrlScrollBound) {
      doc.__ctrlScrollBound = true;
      doc.addEventListener('scroll', function() {
        if (CTRL_PICK.selected.length > 0) CTRL_PICK.renderOverlay();
      }, { capture: true, passive: true });
    }
  });
}
window.addEventListener('blur', function(){ if(CTRL_PICK.holding){ CTRL_PICK.holding = false; CTRL_PICK.exit(); } });
setInterval(function(){ if(CTRL_PICK.holding && !(document.hasFocus())) { CTRL_PICK.holding = false; CTRL_PICK.exit(); } }, 300);

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
window.setEditMode = setEditMode;

/* —— 打开页面自动加载默认预设目录 —— */
loadGroups(); /* 虚拟分组数据（本地分类整理，不落盘沙箱） */
var btnAddGroupEl=$('btnAddGroup');
if(btnAddGroupEl)btnAddGroupEl.onclick=function(){ addGroup(null); }; /* 菜单栏按钮：始终创建一级文件夹 */
setTimeout(function(){ loadDefaultPreset(); },120);