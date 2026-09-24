/* [js/link-bind.js] 跳转绑定运行时 + 外层消息处理 + 检查器/管理抽屉（T1+T2） */
/* 暴露全局 window.LinkBind：原型 html 注入体 + 外层消息监听 + 跳转执行器 + 抽屉 UI */
/* Wave-C/F: ESM 显式依赖 (escHtml/escAttr/showToast 经 utils 显式 import, 消灭隐式全局);
 * Store 显式 import (队列/源切换协同, 本波声明+轻量订阅, 全量真相源切换 Wave-D)。
 * stripped-classic 降级 (导出单文件): import 行被剥离后裸调用回退 window 全局 (经典脚本先行已挂载)。 */
/* FIX: 经典<script>加载，禁用ESM import(整文件罢工)。内联回退+window.Utils双保险；
 * Store经window.Store只读。_LbStore保留typeof守卫兼容。 */
var escHtml = (typeof window !== 'undefined' && window.escHtml) || (typeof window !== 'undefined' && window.Utils && window.Utils.escHtml) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var escAttr = (typeof window !== 'undefined' && window.escAttr) || (typeof window !== 'undefined' && window.Utils && window.Utils.escAttr) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var showToast = (typeof window !== 'undefined' && window.showToast) || (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) || function (msg) { try { if (typeof libStatus === 'function') { libStatus(msg); return; } } catch (e) {} try { alert(msg); } catch (e2) {} return null; };
var LinkBind = (function () {
  'use strict';

  /* 基础示意图标助手：PlanBIcon 不可用时回退基础字符 */
  function lbIco(name, fallback) {
    try { if (window.PlanBIcon) { var svg = window.PlanBIcon(name, 13); if (svg) return svg; } } catch (e) {}
    return fallback || '';
  }

  /* data-plink 打戳 helpers：toast + 作用域断言 + 文件定位 + plid 生成 */
  function lbToast(msg) {
    try { if (typeof showToast === 'function') { showToast(msg); return; } } catch (e) {}
    try { if (typeof libStatus === 'function') { libStatus(msg); } } catch (e2) {}
  }
  function lbIsPreviewEl(el) {
    try {
      if (!el || !el.ownerDocument) return false;
      var fd = null;
      try { fd = (typeof frame !== 'undefined' && frame && frame.contentDocument) ? frame.contentDocument : null; } catch (e) {}
      if (!fd) return false;
      return el.ownerDocument === fd;
    } catch (e) { return false; }
  }
  function lbCurHtmlFile() {
    try { if (typeof curHtmlFile === 'function') return curHtmlFile(); } catch (e) {}
    try { if (typeof editQueueCurHtmlFile === 'function') return editQueueCurHtmlFile(); } catch (e2) {}
    try { if (typeof currentSource !== 'undefined' && currentSource) return (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name) || ''; } catch (e3) {}
    return '';
  }
  function lbMakePlid() {
    try { return 'lk_' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); } catch (e) { return 'lk_' + Date.now(); }
  }
  function restampLive(restampId) {
    try {
      if (!restampId) return;
      var sid = String(restampId).replace(/"/g, '');
      if (!sid) return;
      var doc = null;
      try { doc = (typeof frame !== 'undefined' && frame && frame.contentDocument) ? frame.contentDocument : null; } catch (e) {}
      if (!doc) return;
      try { if (doc.querySelector('[data-plink="' + sid + '"]')) return; } catch (e) {}
      var links = (typeof currentSource !== 'undefined' && currentSource && currentSource._links) || [];
      var sel = '';
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        if (String(l.plid || '') === sid || String(l.id || '') === sid) { sel = l.selector || ''; break; }
      }
      if (!sel) return;
      var all = null;
      try { all = doc.querySelectorAll(sel); } catch (e) { return; }
      if (all && all.length === 1) { try { all[0].setAttribute('data-plink', sid); } catch (e2) {} }
    } catch (e) {}
  }

  /* ═══════ 悬停提示气泡样式（仅 iframe 内使用） ═══════ */
  var TIP_STYLE = 'position:absolute;pointer-events:none;z-index:99999;padding:4px 10px;border-radius:6px;'
    + 'background:#333;color:#fff;font:12px/1.4 system-ui,-apple-system,sans-serif;white-space:nowrap;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.25);transform:translateX(-50%);';

  /* ═══════ RUNTIME_BODY：注入到 iframe 内执行的字符串脚本 ═══════ */
  /* 全部包 try/catch 静默失败，绝不影响原型自身 */
  var RUNTIME_BODY = [
    '(function(){',
    '  var TIP_STYLE="' + TIP_STYLE.replace(/"/g, '\\"') + '";',
    '  var P=window.__plrt||{links:[],mode:false,from:""};',
    '  function findLink(el){',
    '    if(P.mode)return null;',
    '    var cur="";try{cur=location.hash.replace(/^#/,"");}catch(e){};',
    '    var holder=null;try{holder=(el&&el.closest)?el.closest("[data-plink]"):null;}catch(e){holder=null;}',
    '    if(holder){',
    '      var pid="";try{pid=String(holder.getAttribute("data-plink")||"");}catch(e){pid="";}',
    '      if(pid){',
    '        for(var i=0;i<P.links.length;i++){',
    '          var l=P.links[i];var lid="";try{lid=String(l.plid||"");}catch(e){};var oid="";try{oid=String(l.id||"");}catch(e){};',
    '          if((lid&&lid===pid)||(!lid&&oid&&oid===pid)){return{kind:"plink",link:l,el:holder,plid:pid};}',
    '        }',
    '        return{kind:"stale",plid:pid,el:holder,link:null};',
    '      }',
    '    }',
    '    for(var j=0;j<P.links.length;j++){',
    '      var m=P.links[j];',
    '      if(m.page!==cur) continue;',
    '      try{ if(el.closest(m.selector)){ var all=document.querySelectorAll(m.selector); if(all.length===1){ var rs=null; try{rs=String(m.plid||m.id||"")||null;}catch(e){rs=null;} return{kind:"legacy",link:m,el:el,restamp:rs}; } } }catch(e){}',
    '    }',
    '    return null;',
    '  }',
    '  /* 捕获阶段 click 监听：仅 plink/legacy 拦截，stale 静默自清后放行原生，null 放行原生 */',
    '  document.addEventListener("click",function(ev){',
    '    if(P.mode)return; /* 编辑模式：外层检查器接管 */',
    '    if(ev.ctrlKey||ev.metaKey)return; /* Ctrl/Cmd 穿透 */',
    '    var t=ev.target;if(!t||t.nodeType!==1)return;',
    '    var tag="";try{tag=String(t.tagName||"").toLowerCase();}catch(e){};if(tag==="html"||tag==="body")return;',
    '    var res=findLink(t);',
    '    if(!res)return;',
    '    if(res.kind==="stale"){ try{ if(res.el&&res.el.removeAttribute)res.el.removeAttribute("data-plink"); }catch(e){} try{ parent.postMessage({type:"proto-link-stale",from:P.from,plid:res.plid||""},"*"); }catch(e2){} return; }',
    '    ev.preventDefault();ev.stopPropagation();',
    '    var link=res.link;if(!link)return;',
    '    try{ var msg={type:"proto-link",from:P.from,target:{proto:link.target,page:link.targetPage||""}}; if(res.kind==="legacy"&&res.restamp){msg.restamp=res.restamp;} parent.postMessage(msg,"*"); }catch(e){}',
    '  },true);',
    '  /* 预览态悬停提示 */',
    '  var tipEl=null,origShadow=null,origEl=null;',
    '  function removeTip(){',
    '    if(tipEl){try{tipEl.remove();}catch(e){}tipEl=null;}',
    '    if(origEl&&origShadow!==null){try{origEl.style.boxShadow=origShadow;}catch(e){}origEl=null;origShadow=null;}',
    '  }',
    '  function addTip(el,link){',
    '    removeTip();',
    '    if(!el||!link)return;',
    '    /* 高亮描边 */',
    '    try{ origShadow=el.style.boxShadow; origEl=el; el.style.boxShadow="inset 0 0 0 2px rgba(64,150,255,.55)"; }catch(e){}',
    '    /* 气泡定位 */',
    '    var r=el.getBoundingClientRect();',
    '    var x=r.left+r.width/2;',
    '    var y=r.top;',
    '    /* 创建气泡 */',
    '    var tip=document.createElement("div");',
    '    tip.style.cssText=TIP_STYLE;',
    '    tip.textContent="跳转至 "+link.target;',
    '    document.body.appendChild(tip);',
    '    var tw=tip.offsetWidth,th=tip.offsetHeight;',
    '    var tx=x-tw/2;',
    '    var ty=y-th-8;',
    '    if(ty<4)ty=r.bottom+8; /* 下方空间不足，翻到下方 */',
    '    if(tx<4)tx=4;',
    '    if(tx+tw>window.innerWidth-4)tx=window.innerWidth-tw-4;',
    '    tip.style.left=tx+"px";',
    '    tip.style.top=ty+"px";',
    '    tipEl=tip;',
    '  }',
    '  document.addEventListener("mouseover",function(ev){',
    '    if(P.mode)return;',
    '    if(!P.links.length)return;',
    '    var t=ev.target;if(!t||t.nodeType!==1)return;',
    '    var res=findLink(t);',
    '    var link=(res&&res.link)?res.link:null;',
    '    if(link) addTip(t,link);',
    '  },true);',
    '  document.addEventListener("mouseout",function(ev){',
    '    if(P.mode)return;',
    '    var t=ev.target;if(!t||t.nodeType!==1)return;',
    '    var res2=findLink(t);',
    '    var link2=(res2&&res2.link)?res2.link:null;',
    '    if(link2) removeTip();',
    '  },true);',
    '  document.addEventListener("click",function(){ removeTip(); },true);',
    '  /* 外层消息监听 */',
  '  window.addEventListener("message",function(ev){',
  '    var d=ev.data;if(!d||typeof d!=="object")return;',
  '    if(d&&d.type==="proto-mode" && ev.source !== parent) return;', // P0-1 fix reverse check
  '    if(d.type==="proto-mode"){ P.mode=!!d.edit; removeTip(); }',
    '    else if(d.type==="proto-goto"){ var pg=String(d.page||""); if(pg)location.hash=pg; }',
    '  });',
    '})();'
  ].join('\n');

  /* ═══════ wrapProtoHtml：在原型 html 装入 iframe 前调用 ═══════ */
  function wrapProtoHtml(html, opts) {
    var payload = JSON.stringify({
      links: (opts && opts.links) || [],
      mode: !!(opts && opts.mode),
      from: String((opts && opts.from) || '')
    });
    var tag = '<script data-plrt>' + safeScript('(function(){window.__plrt=' + payload + ';try{' + RUNTIME_BODY + '}catch(e){}})();') + '<\/script>';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function(m){ return m + tag; });
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, function(m){ return m + '<head>' + tag + '</head>'; });
    if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, tag + '</body>');
    return tag + html;
  }

  /* ═══════ 外层消息处理 ═══════ */
  var pendingGoto = null;
  function isTrustedProtoMessage(ev){ // P0-1 fix
    if(!ev.source || ev.source !== frame?.contentWindow) return false;
    if(ev.origin !== 'null' && ev.origin !== location.origin) return false; // file:// origin 为 null，放行
    return true;
  }
  /* stale 静默自清：按 plid 精确清 live + 源文件同 id 戳，不 toast 不提示，best-effort */
  function silentCleanStalePlid(plid) {
    var sid = '';
    try { sid = String(plid || '').replace(/"/g, ''); } catch (e) { sid = ''; }
    if (!sid) return;
    try {
      var doc = null;
      try { doc = (typeof frame !== 'undefined' && frame && frame.contentDocument) ? frame.contentDocument : null; } catch (e2) {}
      if (doc) {
        try {
          var olds = doc.querySelectorAll('[data-plink="' + sid + '"]');
          for (var k = 0; k < (olds ? olds.length : 0); k++) {
            try { olds[k].removeAttribute('data-plink'); } catch (e3) {}
          }
        } catch (e4) {}
      }
    } catch (e5) {}
    try {
      var dir = (typeof currentSource !== 'undefined' && currentSource) ? currentSource.sandboxDir : null;
      var file = lbCurHtmlFile();
      var sb = null;
      try { sb = (window.protoAPI && window.protoAPI.sandbox) || null; } catch (e6) {}
      if (!sb || !sb.readFile || !sb.write || !dir || !file) return;
      (function (rmId, d, f, api) {
        try {
          api.readFile({ dir: d, file: f }).then(function (r) {
            if (!r || !r.ok) return;
            var srcHtml = String(r.content || '');
            var pdoc = null;
            try { pdoc = new DOMParser().parseFromString(srcHtml, 'text/html'); } catch (e7) { return; }
            if (!pdoc) return;
            var changed = false;
            try {
              var srcOlds = pdoc.querySelectorAll('[data-plink="' + String(rmId).replace(/"/g, '') + '"]');
              for (var j = 0; j < (srcOlds ? srcOlds.length : 0); j++) {
                try { srcOlds[j].removeAttribute('data-plink'); changed = true; } catch (e8) {}
              }
            } catch (e9) { return; }
            if (!changed) return;
            var out = '';
            try {
              var hasDoctype = /^\s*<!doctype/i.test(srcHtml);
              out = (hasDoctype ? '<!DOCTYPE html>\n' : '') + pdoc.documentElement.outerHTML;
            } catch (e10) { return; }
            api.write({ dir: d, file: f, content: out }).catch(function () {});
          }).catch(function () {});
        } catch (e11) {}
      })(sid, dir, file, sb);
    } catch (e12) {}
  }
  function initMessageListener() {
    window.addEventListener('message', function (ev) {
      if(!isTrustedProtoMessage(ev)) return; // P0-1 fix
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'proto-link') {
        handleProtoLink(d);
      } else if (d.type === 'proto-link-stale') {
        try { silentCleanStalePlid(d && d.plid); } catch (e) {}
      }
    });
  }
  /* 子页面直达判定：targetPage 为 .html 子页面文件时直接打开该子页，否则走锚点透传 */
  function isSubPageTarget(dest, targetPage) {
    try {
      var tp = String(targetPage || '');
      if (!/\.html?$/i.test(tp)) return false;
      if (!dest) return false;
      if (String(dest.mainHtmlFile || '') === tp) return true;
      var subs = dest.subPages || [];
      for (var i = 0; i < subs.length; i++) {
        var f = subs[i] && (subs[i].file || subs[i].name || subs[i]);
        if (String(f || '') === tp) return true;
      }
      return false;
    } catch (e) { return false; }
  }
  function handleProtoLink(d) {
    try { if (d && d.restamp) restampLive(d.restamp); } catch (e) {}
    var target = (d && d.target) || {};
    var protoName = target.proto || '';
    var targetPage = target.page || '';
    var dest = null;
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].displayName === protoName) { dest = sources[i]; break; }
    }
    if (!dest) {
      libStatus('跳转失败：目标原型「' + protoName + '」不存在，可能已被删除或重命名。');
      return;
    }
    if (isSubPageTarget(dest, targetPage)) { closeAllDrawers(); loadSubPage(dest, targetPage); return; }
    pendingGoto = targetPage;
    closeAllDrawers();
    loadSource(dest);
  }

  /* ═══════ performLink(link)：跳转执行器 ═══════ */
  function performLink(link) {
    if (!link) return;
    var protoName = link.target || '';
    var targetPage = link.targetPage || '';
    var dest = null;
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].displayName === protoName) { dest = sources[i]; break; }
    }
    if (!dest) {
      libStatus('跳转失败：目标原型「' + protoName + '」不存在，可能已被删除或重命名。');
      return;
    }
    if (isSubPageTarget(dest, targetPage)) { closeAllDrawers(); loadSubPage(dest, targetPage); return; }
    pendingGoto = targetPage;
    closeAllDrawers();
    loadSource(dest);
  }

  /* ═══════ broadcastMode(edit)：模式广播 ═══════ */
  function broadcastMode(edit) {
    try {
      var f = frame;
      if (f && f.contentWindow) {
        f.contentWindow.postMessage({ type: 'proto-mode', edit: !!edit }, '*');
      }
    } catch (e) {}
  }

  /* ═══════ closeAllDrawers：依次收起所有抽屉与遮罩 ═══════ */
  function closeAllDrawers() {
    closeInspector();
    closeLinkMgr();
    if (typeof closeEditDrawer === 'function') closeEditDrawer();
    if (window.AnnotationEngine && typeof window.AnnotationEngine.closeAll === 'function') {
      window.AnnotationEngine.closeAll();
    }
  }

  /* ═══════ 页面键取值：返回原始 hash（首页返回 ''），与 links.json 存储约定一致 ═══════ */
  function framePageKey() {
    try {
      var h = (frame.contentWindow && frame.contentWindow.location && frame.contentWindow.location.hash) || '';
      return h.replace(/^#/, '');
    } catch (e) { return ''; }
  }

  /* ═══════ 元素检查器抽屉 ═══════ */
  var inspectorEl = null;    /* 当前锁定的元素 */
  var inspectorRemote = null; /* 沙箱跨域远端锁定 {selector,page,label,text,tagName}，有值时不依赖 live el */
  var inspectorLink = null;  /* 当前元素的绑定 */
  var inspectorMode = '';    /* 'view' | 'select' | 'bound' */
  var inspectorSelectTarget = null; /* 选择态预选的目标源 */
  var inspectorSelectSubPage = ''; /* 选择态预选的目标子页面（空=打开主页） */

  function openInspector(el) {
    if (!el) return;
    if (!lbIsPreviewEl(el)) { lbToast('仅支持绑定原型内的元素，请点击预览区元素。'); return; }
    /* 关闭其他抽屉（必须在状态赋值之前，否则 closeInspector 会清空状态） */
    closeAllDrawers();
    inspectorEl = el;
    /* 计算元素信息 */
    var sel = generateSelector(el);
    var pg = framePageKey();
    var label = editElementLabel(el);
    var txt = '';
    try { txt = String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30); } catch (e) {}
    /* 查找现有绑定 */
    var links = (currentSource && currentSource._links) || [];
    inspectorLink = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].selector === sel && links[i].page === pg) {
        inspectorLink = links[i];
        break;
      }
    }
    inspectorMode = inspectorLink ? 'bound' : 'view';
    inspectorSelectTarget = null;
    /* 渲染 */
    renderInspector(sel, pg, label, txt);
    /* 显示遮罩和抽屉 */
    var mask = $('linkInspMask');
    if(mask) mask.onclick=function(){closeInspector();};
    var drawer = $('linkInspector');
    if (mask) mask.style.display = 'block';
    if (drawer) drawer.classList.add('open');
    /* 加载修改需求草稿 */
    loadReqDraft(sel, pg);
    /* 加载需求标注 */
    if (window.AnnotationEngine && typeof window.AnnotationEngine.loadInspectorAnno === 'function') {
      window.AnnotationEngine.loadInspectorAnno(el, sel, pg);
    }
    if(window.MaskStack) window.MaskStack.push('linkInspMask', closeInspector); // P1-7 fix mask统一
  }

  /* 沙箱跨域远端检查器：选择器/文本来自帧回传（nonce 匹配即来源可信），
   * 后续跳转保存/标注/需求草稿均走选择器+文件读写链，不依赖 live el。 */
  function openInspectorRemote(info) {
    if (!info || !info.selector) { lbToast('未能定位目标元素，请重试。'); return; }
    closeAllDrawers();
    inspectorEl = null;
    var sel = String(info.selector || '');
    var pg = String((info && info.page !== undefined) ? info.page : framePageKey());
    var label = String((info && (info.label || info.text)) || info.tagName || sel).slice(0, 30);
    var txt = String((info && info.text) || '').slice(0, 30);
    inspectorRemote = { selector: sel, page: pg, label: label, text: txt, tagName: String((info && info.tagName) || ''), dname: String((info && info.dname) || ''), pickIndex: (info && typeof info.pickIndex === 'number') ? info.pickIndex : -1 };
    var links = (currentSource && currentSource._links) || [];
    inspectorLink = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].selector === sel && links[i].page === pg) {
        inspectorLink = links[i];
        break;
      }
    }
    inspectorMode = inspectorLink ? 'bound' : 'view';
    inspectorSelectTarget = null;
    renderInspector(sel, pg, label, txt);
    var mask = $('linkInspMask');
    if(mask) mask.onclick=function(){closeInspector();};
    var drawer = $('linkInspector');
    if (mask) mask.style.display = 'block';
    if (drawer) drawer.classList.add('open');
    loadReqDraft(sel, pg);
    if (window.AnnotationEngine && typeof window.AnnotationEngine.loadInspectorAnno === 'function') {
      window.AnnotationEngine.loadInspectorAnno(null, sel, pg);
    }
    if (window.AnnotationEngine && typeof window.AnnotationEngine.setInspectorRemoteInfo === 'function') {
      try { window.AnnotationEngine.setInspectorRemoteInfo({ label: label, text: txt, tagName: String((info && info.tagName) || '') }); } catch (e) {}
    }
    if(window.MaskStack) window.MaskStack.push('linkInspMask', closeInspector); // P1-7 fix mask统一
  }

  function closeInspector() {
    if(window.MaskStack) window.MaskStack.pop('linkInspMask'); // P1-7 fix
    var mask = $('linkInspMask');
    var drawer = $('linkInspector');
    if (mask) mask.style.display = 'none';
    if (drawer) drawer.classList.remove('open');
    inspectorEl = null;
    inspectorRemote = null;
    inspectorLink = null;
    inspectorMode = '';
    inspectorSelectTarget = null;
  }

  function renderInspector(sel, pg, label, txt) {
    var titleEl = $('liTitle');
    var selTip = $('liSelTip');
    var jumpChip = $('liJumpChip');
    var jumpBody = $('liJumpBody');
    if (titleEl) {
      var rawName = (typeof extractElementText === 'function') ? extractElementText(inspectorEl) : '';
      if (rawName) {
        titleEl.innerHTML = '<span class="li-title-btn-badge">当前按钮/元素</span><span class="li-title-btn-name">【' + escHtml(rawName) + '】</span>';
      } else {
        titleEl.textContent = label || '元素';
      }
    }
    if (selTip) {
      selTip.innerHTML = '<span class="li-pos-tag">定位</span> <span class="li-pos-sel">' + escHtml(sel) + '</span><span class="li-pos-page">页面: ' + escHtml(pg || '首页') + '</span>';
      selTip.title = sel;
    }
    /* 渲染跳转交互板块 */
    renderJumpSection(sel, pg, jumpChip, jumpBody);
  }

  function renderJumpSection(sel, pg, chipEl, bodyEl) {
    if (!bodyEl) return;
    /* 检查是否有 sandboxDir */
    if (!currentSource || !currentSource.sandboxDir) {
      bodyEl.innerHTML = '<div class="li-hint">该原型未入沙箱，暂不支持保存跳转。</div>';
      if (chipEl) { chipEl.className = 'state-dot off'; chipEl.textContent = ''; chipEl.title = ''; }
      return;
    }
    if (inspectorMode === 'select') {
      renderSelectTarget(sel, pg, chipEl, bodyEl);
      return;
    }
    if (inspectorMode === 'bound' && inspectorLink) {
      renderBoundTarget(sel, pg, chipEl, bodyEl);
      return;
    }
    /* 未绑定 */
    if (chipEl) { chipEl.className = 'state-dot off'; chipEl.textContent = ''; chipEl.title = ''; }
    bodyEl.innerHTML = '<div class="li-hint">该元素尚未设置跳转。</div>'
      + '<div class="li-actions"><button class="docs-btn primary" id="liSetJump">＋ 设置跳转目标</button></div>';
    var btn = $('liSetJump');
    if (btn) btn.onclick = function () { inspectorMode = 'select'; inspectorSelectTarget = null; inspectorSelectSubPage = ''; renderJumpSection(sel, pg, chipEl, bodyEl); };
  }

  function renderSelectTarget(sel, pg, chipEl, bodyEl) {
    if (chipEl) { chipEl.className = 'state-dot active'; chipEl.textContent = ''; chipEl.title = '选择中'; }
    /* 目标列表：当前原型主页排首位（可展开子页面），其后为其他原型 */
    var entries = [];
    if (currentSource) entries.push(currentSource);
    for (var i = 0; i < sources.length; i++) {
      if (sources[i] !== currentSource) entries.push(sources[i]);
    }
    if (!entries.length) {
      bodyEl.innerHTML = '<div class="li-hint">项目内暂无可选原型。</div>'
        + '<div class="li-actions"><button class="docs-btn" id="liSelBack">返回</button></div>';
      var backBtn = $('liSelBack');
      if (backBtn) backBtn.onclick = function () { inspectorMode = 'view'; inspectorSelectTarget = null; inspectorSelectSubPage = ''; renderJumpSection(sel, pg, chipEl, bodyEl); };
      return;
    }
    var expandedKey = (inspectorSelectTarget && (inspectorSelectTarget.sandboxDir || inspectorSelectTarget.name)) || null;
    var html = '<div class="li-targets">';
    for (var j = 0; j < entries.length; j++) {
      var s = entries[j];
      var kindCls = s.kind === 'pc' ? 'pc' : 'mobile';
      var kindLabel = s.kind === 'pc' ? 'PC' : '移动';
      var isCur = (s === currentSource);
      var selCls = (inspectorSelectTarget === s) ? ' selected' : '';
      html += '<div class="li-target-item' + selCls + '" data-idx="' + j + '">'
        + '<span class="li-target-name">' + escHtml(s.displayName) + '</span>'
        + (isCur ? '<span class="li-target-kind cur">本原型</span>' : '')
        + '<span class="li-target-kind ' + kindCls + '">' + kindLabel + '</span>'
        + '</div>';
      /* 选中项下方直接展开子页面（替换原来的目标页面下拉框） */
      if (inspectorSelectTarget === s) {
        var subs = (s.subPages && s.subPages.slice()) || [];
        var mainF = s.mainHtmlFile || s.name || '';
        html += '<div class="li-sub-list" data-for="' + j + '">'
          + '<div class="li-sub-item' + (inspectorSelectSubPage ? '' : ' selected') + '" data-sub="">打开主页' + (mainF ? '（' + escHtml(mainF) + '）' : '') + '</div>';
        for (var q = 0; q < subs.length; q++) {
          var sf = subs[q] && (subs[q].file || subs[q].name || subs[q]);
          var sn = (subs[q] && (subs[q].name || subs[q].file)) || sf;
          if (!sf) continue;
          html += '<div class="li-sub-item' + ((inspectorSelectSubPage || '') === String(sf) ? ' selected' : '') + '" data-sub="' + escAttr(String(sf)) + '">' + escHtml(String(sn)) + '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
    html += '<div class="li-actions" id="liSelectActions" style="display:none"><button class="docs-btn" id="liSelBack">返回</button><button class="docs-btn primary" id="liSaveJump">保存绑定</button></div>';
    bodyEl.innerHTML = html;
    /* 绑定事件：点原型行选中并在其下方展开子页面；点子页面行定目标 */
    var items = bodyEl.querySelectorAll('.li-target-item');
    for (var k = 0; k < items.length; k++) {
      (function (item) {
        item.onclick = function () {
          var idx = parseInt(item.getAttribute('data-idx'), 10);
          inspectorSelectTarget = entries[idx];
          inspectorSelectSubPage = '';
          renderJumpSection(sel, pg, chipEl, bodyEl);
          try{
            var acts = $('liSelectActions');
            if (acts) acts.style.display = '';
          }catch(e){}
        };
      })(items[k]);
    }
    var subs = bodyEl.querySelectorAll('.li-sub-item');
    for (var w = 0; w < subs.length; w++) {
      (function (sub) {
        sub.onclick = function (ev) {
          try{ if (ev && ev.stopPropagation) ev.stopPropagation(); }catch(e){}
          inspectorSelectSubPage = String(sub.getAttribute('data-sub') || '');
          var allSubs = bodyEl.querySelectorAll('.li-sub-item');
          for (var m = 0; m < allSubs.length; m++) allSubs[m].classList.remove('selected');
          sub.classList.add('selected');
          try{
            var acts2 = $('liSelectActions');
            if (acts2) acts2.style.display = '';
          }catch(e2){}
        };
      })(subs[w]);
    }
    /* 已有选中目标（返场/预选）直接露出操作区 */
    try{
      if (inspectorSelectTarget) {
        var acts0 = $('liSelectActions');
        if (acts0) acts0.style.display = '';
      }
    }catch(e3){}
    var backBtn2 = $('liSelBack');
    if (backBtn2) backBtn2.onclick = function () { inspectorMode = 'view'; inspectorSelectTarget = null; inspectorSelectSubPage = ''; renderJumpSection(sel, pg, chipEl, bodyEl); };
    var saveBtn = $('liSaveJump');
    if (saveBtn) saveBtn.onclick = function () {
      if (!inspectorSelectTarget) { lbToast('请先选择跳转目标原型。'); return; }
      saveJumpBinding(sel, pg, inspectorSelectTarget.displayName, inspectorSelectSubPage || '');
    };
  }

  function renderBoundTarget(sel, pg, chipEl, bodyEl) {
    var link = inspectorLink;
    var stale = !!link._stale;
    /* 状态点：绿=已生效，橘黄=未生效（原文案进 title 悬停） */
    if (chipEl) {
      if (stale) {
        chipEl.className = 'state-dot stale';
        chipEl.title = '未生效：原型已被修改';
      } else {
        chipEl.className = 'state-dot live';
        chipEl.title = '已生效';
      }
      chipEl.textContent = '';
    }
    var targetInfo = '→ ' + escHtml(link.target);
    if (link.targetPage) targetInfo += ' · ' + escHtml(link.targetPage);
    var html = '<div class="li-hint" style="font-size:12.5px;color:var(--ink)">' + targetInfo + '</div>';
    if (stale) html += '<div class="li-hint" style="color:#DC2626">请解除后重新绑定该元素</div>';
    html += '<div class="li-actions"><button class="docs-btn" id="liChangeJump">更换目标</button><button class="docs-btn" id="liRemoveJump" style="color:#DC2626">解除绑定</button></div>';
    bodyEl.innerHTML = html;
    var changeBtn = $('liChangeJump');
    if (changeBtn) changeBtn.onclick = function () {
      inspectorMode = 'select';
      inspectorSelectTarget = null;
      inspectorSelectSubPage = '';
      /* 预选现目标（含子页面） */
      for (var i = 0; i < sources.length; i++) {
        if (sources[i].displayName === link.target) { inspectorSelectTarget = sources[i]; break; }
      }
      if (inspectorSelectTarget && link.targetPage) inspectorSelectSubPage = String(link.targetPage);
      renderJumpSection(sel, pg, chipEl, bodyEl);
    };
    var removeBtn = $('liRemoveJump');
    if (removeBtn) removeBtn.onclick = function () {
      removeJumpBinding(sel, pg);
    };
  }

  /* 输入条悬浮窗快绑：不经检查器抽屉，直接以给定元素（live el 或远端信息）建绑定 */
  function quickBind(selInfo, targetName, targetPage) {
    try {
      if (!selInfo || !selInfo.selector) { lbToast('选择器生成失败，无法绑定。'); return; }
      if (!targetName) { lbToast('请先选择跳转目标原型。'); return; }
      closeAllDrawers();
      if (selInfo.el) { inspectorEl = selInfo.el; inspectorRemote = null; }
      else {
        inspectorEl = null;
        inspectorRemote = {
          selector: String(selInfo.selector || ''), page: String(selInfo.page || ''),
          label: String(selInfo.label || selInfo.text || ''), text: String(selInfo.text || ''),
          tagName: String(selInfo.tagName || ''), dname: '',
          pickIndex: (typeof selInfo.pickIndex === 'number') ? selInfo.pickIndex : -1
        };
      }
      inspectorLink = null;
      inspectorMode = 'view';
      inspectorSelectTarget = null;
      inspectorSelectSubPage = '';
      saveJumpBinding(String(selInfo.selector || ''), String(selInfo.page || ''), targetName, targetPage || '');
    } catch (e) { lbToast('绑定失败。'); }
  }
  /* 打戳绑定：selector 在源文件恰好命中1个才建绑定；live+源文件双写 data-plink；links.json 加 plid */
  /* 多命中时（重复组件）：内存补ID→按活元素序号/帧序号+文本校验定唯一→升级为 pr-id 后继续，不让用户重绑 */
  function lbUpgradeToPrId(sel, pdoc, srcHtml, liveEl, remote) {
    try {
      if (typeof prIdPickUpgrade !== 'function') return null;
      var liveIndex = -1;
      try {
        if (liveEl && liveEl.ownerDocument) {
          var all = liveEl.ownerDocument.querySelectorAll(sel);
          for (var i = 0; i < all.length; i++) { if (all[i] === liveEl) { liveIndex = i; break; } }
        }
      } catch (e) {}
      if (!(liveIndex >= 0) && remote && typeof remote.pickIndex === 'number') liveIndex = remote.pickIndex;
      var text = '';
      try { text = String((remote && remote.text) || (liveEl && liveEl.textContent) || ''); } catch (e) {}
      return prIdPickUpgrade(srcHtml, sel, liveIndex, text);
    } catch (e) { return null; }
  }
  function saveJumpBinding(sel, pg, targetName, targetPage) {    if (!currentSource || !currentSource.sandboxDir) return;
    if (!lbIsPreviewEl(inspectorEl)) {
      /* 沙箱跨域远端锁定（inspectorRemote）无 live el：转为选择器非空校验后放行 */
      if (typeof inspectorRemote !== 'undefined' && inspectorRemote) {
        if (!sel) { lbToast('选择器生成失败，无法绑定。'); return; }
      } else { lbToast('仅支持绑定原型内的元素，请点击预览区元素。'); return; }
    }
    if (!sel) { lbToast('选择器生成失败，无法绑定。'); return; }
    if (!targetName) { lbToast('请先选择跳转目标原型。'); return; }
    var dir = currentSource.sandboxDir;
    var file = lbCurHtmlFile();
    if (!file) { lbToast('无法确定当前原型文件，绑定已取消。'); return; }
    var sb = null;
    try { sb = (window.protoAPI && window.protoAPI.sandbox) || null; } catch (e) {}
    if (!sb || typeof sb.readFile !== 'function' || typeof sb.write !== 'function') { lbToast('当前原型不支持直接写盘，无法打戳绑定。'); return; }
    var liveEl = inspectorEl;
    sb.readFile({ dir: dir, file: file }).then(function (r) {
      if (!r || !r.ok) { lbToast('源文件读取失败，绑定已取消：' + ((r && r.error) || '未知错误')); return; }
      var srcHtml = String(r.content || '');
      var pdoc = null;
      try { pdoc = new DOMParser().parseFromString(srcHtml, 'text/html'); } catch (e) {}
      if (!pdoc) { lbToast('源文件解析失败，绑定已取消。'); return; }
      var hits = null;
      try { hits = pdoc.querySelectorAll(sel); } catch (e) { lbToast('选择器在源文件无效，绑定已取消。'); return; }
      var n = hits ? hits.length : 0;
      var origSel = sel;
      var up = null;
      if (n === 1 && !/data-pr-id\s*=/.test(sel)) {
        /* 单命中非稳定选择器：同样先补ID，能升级则入库即 pr-id（长久精准） */
        try{
          var inj0 = (typeof prIdEnsureInjected === 'function') ? prIdEnsureInjected(srcHtml) : '';
          if (inj0 && inj0 !== srcHtml) {
            var pd0 = null;
            try { pd0 = new DOMParser().parseFromString(inj0, 'text/html'); } catch (e0) {}
            var h0 = null;
            try { h0 = pd0 ? pd0.querySelectorAll(sel) : null; } catch (e1) {}
            if (h0 && h0.length === 1) {
              var pid0 = '';
              try { pid0 = String(h0[0].getAttribute('data-pr-id') || ''); } catch (e2) {}
              if (pid0) {
                var ns0 = '[data-pr-id="' + pid0.replace(/"/g, '') + '"]';
                var c0 = null;
                try { c0 = pd0.querySelectorAll(ns0); } catch (e3) {}
                if (c0 && c0.length === 1) { sel = ns0; pdoc = pd0; srcHtml = inj0; hits = h0; n = 1; }
              }
            }
          }
        }catch(e){}
      }
      if (n !== 1) {
        if (/data-pr-id\s*=/.test(sel)) { lbToast('稳定ID在源文件中定位命中' + n + '个（文件内重复，应唯一），已拒绝绑定，请重新拾取。'); return; }
        try { up = lbUpgradeToPrId(sel, pdoc, srcHtml, liveEl, (typeof inspectorRemote !== 'undefined' ? inspectorRemote : null)); } catch (e) { up = null; }
        if (!up || !up.sel) {
          try { if (typeof prIdBackfillFileInBackground === 'function' && dir && file) prIdBackfillFileInBackground(dir, file); } catch (e2) {}
          lbToast('该元素在源文件中定位命中' + n + '个，已后台补齐稳定ID并刷新，请重新打开检查器再绑定。');
          return;
        }
        sel = up.sel; pdoc = up.pdoc; srcHtml = up.srcHtml;
        try { if (typeof libStatus === 'function') libStatus('已按所点元素自动定位（' + n + '选1），继续绑定。'); } catch (e3) {}
      }
      var links0 = currentSource._links || [];
      var existPlid = '';
      for (var k = 0; k < links0.length; k++) {
        if (links0[k].selector === sel && links0[k].page === pg) { existPlid = String(links0[k].plid || ''); break; }
        if (origSel && origSel !== sel && links0[k].selector === origSel && links0[k].page === pg && !existPlid) { existPlid = String(links0[k].plid || ''); }
      }
      var plid = existPlid || lbMakePlid();
      try { if (liveEl && liveEl.setAttribute) liveEl.setAttribute('data-plink', plid); } catch (e) {}
      var stampEl = (up && up.el) ? up.el : hits[0];
      try { stampEl.setAttribute('data-plink', plid); } catch (e) { lbToast('源文件打戳失败，绑定已取消。'); return; }
      var out = '';
      try {
        var hasDoctype = /^\s*<!doctype/i.test(srcHtml);
        out = (hasDoctype ? '<!DOCTYPE html>\n' : '') + pdoc.documentElement.outerHTML;
      } catch (e) { lbToast('源文件序列化失败，绑定已取消。'); return; }
      sb.write({ dir: dir, file: file, content: out }).then(function (w) {
        if (!w || !w.ok) { lbToast('源文件写盘失败，绑定已取消：' + ((w && w.error) || '未知错误')); return; }
        var links = currentSource._links || [];
        /* pr-id 升级后清掉同页旧选择器残留条目（防一元素两条绑定） */
        try{
          if (typeof origSel === 'string' && origSel && origSel !== sel) {
            for (var _oi = links.length - 1; _oi >= 0; _oi--) {
              if (links[_oi].selector === origSel && String(links[_oi].page || '') === String(pg || '')) links.splice(_oi, 1);
            }
          }
        }catch(e0){}
        var remoteLbl = (typeof inspectorRemote !== 'undefined' && inspectorRemote && (inspectorRemote.label || inspectorRemote.text)) || '';
        var remoteTxt = (typeof inspectorRemote !== 'undefined' && inspectorRemote && inspectorRemote.text) || '';
        /* 中文名优先链：帧侧中文显示名 > 原label/文本 > live元素文本 */
        var remoteName = (typeof inspectorRemote !== 'undefined' && inspectorRemote && inspectorRemote.dname) || '';
        var btnName = remoteName || remoteLbl || ((typeof extractElementText === 'function') ? extractElementText(liveEl) : '');
        var foundIdx = -1;
        for (var i = 0; i < links.length; i++) {
          if (links[i].selector === sel && links[i].page === pg) {
            links[i].btnName = btnName;
            links[i].target = targetName;
            links[i].targetPage = targetPage || '';
            links[i].label = remoteName || remoteLbl || editElementLabel(liveEl);
            links[i].text = '';
            try { links[i].text = remoteTxt || String(liveEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); } catch (e) { if (!links[i].text) links[i].text = remoteTxt; }
            links[i].ts = Date.now();
            if (!links[i].plid) links[i].plid = plid;
            if (!links[i].id) links[i].id = links[i].plid || plid;
            foundIdx = i;
            break;
          }
        }
        if (foundIdx < 0) {
          var newLink = {
            id: plid, plid: plid, page: pg, selector: sel,
            btnName: btnName,
            label: remoteName || remoteLbl || editElementLabel(liveEl),
            text: remoteTxt || (function () { try { return String(liveEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); } catch (e) { return ''; } })(),
            target: targetName, targetPage: targetPage || '',
            ts: Date.now()
          };
          links.push(newLink);
          foundIdx = links.length - 1;
        }
        currentSource._links = links;
        window.protoAPI.links.write(currentSource.sandboxDir, { links: links });
        /* 跨域 live 帧即时打戳（同源直写已在 liveEl/setAttribute 完成；沙箱下经桥补戳） */
        try { if (typeof sandboxSendStamp === 'function' && plid && sel) sandboxSendStamp(plid, sel, pg); } catch (eSt) {}
        updateLinkBadge();
        libStatus('已保存跳转：' + (btnName ? '【' + btnName + '】' : (remoteLbl || editElementLabel(liveEl))) + ' → ' + targetName + (targetPage ? ' · ' + targetPage : ''));
        inspectorLink = links[foundIdx];
        inspectorMode = 'bound';
        var jumpChip = $('liJumpChip');
        var jumpBody = $('liJumpBody');
        var sel2 = sel;
        try { if (!sel2) sel2 = inspectorRemote ? sel : generateSelector(liveEl); } catch (e2) { sel2 = sel; }
        var pg2 = pg;
        try { if (!inspectorRemote) pg2 = framePageKey(); } catch (e3) {}
        renderJumpSection(sel2, pg2, jumpChip, jumpBody);
        /* 默认刷新原型：保存成功后走手动刷新同一链路（磁盘重读→内存同步→帧重载），
         * 子页面与面板状态保持（复用 _refreshSavedSub 机制），所见即所得 */
        try{
          var _rbf = '';
          try{ _rbf = (typeof lbCurHtmlFile === 'function') ? lbCurHtmlFile() : ''; }catch(e4){}
          try{ window._refreshSavedSub = _rbf; }catch(e5){}
          try{ window._refreshSavedHash = ''; }catch(e6){}
          try{ window.__aiQuietRefresh = true; }catch(e7){}
          if(typeof loadSandboxSources === 'function'){
            loadSandboxSources(_rbf && /\.html$/i.test(String(_rbf)) ? _rbf : undefined, true);
          }
        }catch(e8){}
        try{ lbToast('已保存跳转，正在刷新原型…'); }catch(e9){}
      }).catch(function () { lbToast('源文件写盘异常，绑定已取消。'); });
    }).catch(function () { lbToast('源文件读取异常，绑定已取消。'); });
  }

  function removeJumpBinding(sel, pg) {
    if (!currentSource || !currentSource.sandboxDir) return;
    var links = currentSource._links || [];
    var rmPlid = '';
    for (var i = links.length - 1; i >= 0; i--) {
      if (links[i].selector === sel && links[i].page === pg) {
        rmPlid = String(links[i].plid || links[i].id || '');
        links.splice(i, 1);
        break;
      }
    }
    try {
      var doc = null;
      try { doc = (typeof frame !== 'undefined' && frame && frame.contentDocument) ? frame.contentDocument : null; } catch (e) {}
      if (doc && rmPlid) {
        try {
          var stampedAll = doc.querySelectorAll('[data-plink="' + rmPlid.replace(/"/g, '') + '"]');
          for (var si = 0; si < (stampedAll ? stampedAll.length : 0); si++) {
            try { stampedAll[si].removeAttribute('data-plink'); } catch (e2a) {}
          }
        } catch (e2) {}
      }
      try { if (inspectorEl && inspectorEl.removeAttribute) inspectorEl.removeAttribute('data-plink'); } catch (e3) {}
    } catch (e) {}
    currentSource._links = links;
    window.protoAPI.links.write(currentSource.sandboxDir, { links: links });
    try {
      var dir = currentSource.sandboxDir;
      var file = lbCurHtmlFile();
      var sb = null;
      try { sb = (window.protoAPI && window.protoAPI.sandbox) || null; } catch (e) {}
      if (sb && sb.readFile && sb.write && file && rmPlid) {
        (function (rmId, d, f, api) {
          api.readFile({ dir: d, file: f }).then(function (r) {
            if (!r || !r.ok) return;
            var srcHtml = String(r.content || '');
            var pdoc = null;
            try { pdoc = new DOMParser().parseFromString(srcHtml, 'text/html'); } catch (e) { return; }
            if (!pdoc) return;
            var changed = false;
            try {
              var olds = pdoc.querySelectorAll('[data-plink="' + String(rmId).replace(/"/g, '') + '"]');
              for (var k = 0; k < (olds ? olds.length : 0); k++) {
                try { olds[k].removeAttribute('data-plink'); changed = true; } catch (e2) {}
              }
            } catch (e3) { return; }
            if (!changed) return;
            var out = '';
            try {
              var hasDoctype = /^\s*<!doctype/i.test(srcHtml);
              out = (hasDoctype ? '<!DOCTYPE html>\n' : '') + pdoc.documentElement.outerHTML;
            } catch (e4) { return; }
            api.write({ dir: d, file: f, content: out }).catch(function () {});
          }).catch(function () {});
        })(rmPlid, dir, file, sb);
      }
    } catch (e) {}
    updateLinkBadge();
    libStatus('已解除跳转绑定。');
    inspectorLink = null;
    inspectorMode = 'view';
    var jumpChip = $('liJumpChip');
    var jumpBody = $('liJumpBody');
    renderJumpSection(sel, pg, jumpChip, jumpBody);
  }

  /* ═══════ 修改需求板块 ═══════ */
  function loadReqDraft(sel, pg) {
    var textarea = $('liReqText');
    if (!textarea) return;
    /* 从 EDIT_QUEUE 中查找草稿 */
    var draft = '';
    for (var i = 0; i < EDIT_QUEUE.length; i++) {
      if (EDIT_QUEUE[i].selector === sel && EDIT_QUEUE[i].page === pg) {
        draft = EDIT_QUEUE[i].text || '';
        break;
      }
    }
    textarea.value = draft;
  }
  function initReqSection() {
    var addBtn = $('liReqAdd');
    if (addBtn) {
      addBtn.onclick = function () {
        var textarea = $('liReqText');
        if (!textarea) return;
        var text = (textarea.value || '').trim();
        if (!text) { alert('请先输入要调整的内容。'); return; }
        /* 同源 live 元素优先；沙箱跨域远端拾取（inspectorEl恒为null）走 editQueueAddRemote，不依赖 live el */
        if (inspectorEl && typeof editQueueAdd === 'function') {
          editQueueAdd(inspectorEl, text);
        } else if (inspectorRemote && typeof editQueueAddRemote === 'function') {
          editQueueAddRemote(inspectorRemote, text);
        } else {
          if (typeof lbToast === 'function') lbToast('未能定位目标元素，请重新拾取后再试。');
          else alert('未能定位目标元素，请重新拾取后再试。');
          return;
        }
        textarea.value = '';
      };
    }
  }

  /* ═══════ 折叠板块 ═══════ */
  var FOLD_KEY = 'linkInspFold_v1';
  function initFoldSections() {
    var secs = [$('liSecJump'), $('liSecReq'), $('liSecAnno')];
    for (var i = 0; i < secs.length; i++) {
      (function (sec) {
        if (!sec) return;
        var hd = sec.querySelector('.li-card-hd') || sec.querySelector('.li-sec-hd');
        if (!hd) return;
        hd.onclick = function (e) {
          sec.classList.toggle('open');
          saveFoldState();
        };
      })(secs[i]);
    }
    restoreFoldState();
  }
  function saveFoldState() {
    var jumpOpen = $('liSecJump') && $('liSecJump').classList.contains('open');
    var reqOpen = $('liSecReq') && $('liSecReq').classList.contains('open');
    var annoOpen = $('liSecAnno') && $('liSecAnno').classList.contains('open');
    try { localStorage.setItem(FOLD_KEY, JSON.stringify({ jump: jumpOpen, req: reqOpen, anno: annoOpen })); } catch (e) {}
  }
  function restoreFoldState() {
    try {
      var v = JSON.parse(localStorage.getItem(FOLD_KEY) || 'null');
      if (v) {
        if ($('liSecJump')) { if (v.jump === false) $('liSecJump').classList.remove('open'); else $('liSecJump').classList.add('open'); }
        if ($('liSecReq')) { if (v.req === false) $('liSecReq').classList.remove('open'); else $('liSecReq').classList.add('open'); }
        if ($('liSecAnno')) { if (v.anno === false) $('liSecAnno').classList.remove('open'); else $('liSecAnno').classList.add('open'); }
      }
    } catch (e) {}
  }

  /* ═══════ 跳转管理抽屉 ═══════ */
  function openLinkMgr() {
    closeAllDrawers();
    /* 打开前先校验（仅沙箱源） */
    if (currentSource && currentSource.sandboxDir) {
      validateLinks();
    }
    renderLinkMgr();
    try { updateLinkBadge(); } catch (e) {}
    var mask = $('linkMgrMask');
    var drawer = $('linkMgrDrawer');
    if (mask) mask.style.display = 'block';
    if (drawer) drawer.classList.add('open');
    if(window.MaskStack) window.MaskStack.push('linkMgrMask', closeLinkMgr); // P1-7 fix mask统一
  }

  function closeLinkMgr() {
    if(window.MaskStack) window.MaskStack.pop('linkMgrMask'); // P1-7 fix
    var mask = $('linkMgrMask');
    var drawer = $('linkMgrDrawer');
    if (mask) mask.style.display = 'none';
    if (drawer) drawer.classList.remove('open');
  }

  function renderLinkMgr() {
    var body = $('lmBody');
    var countEl = $('lmCount');
    var links = (currentSource && currentSource._links) || [];
    if (countEl) countEl.textContent = links.length;
    if (!body) return;
    if (!links.length) {
      body.innerHTML = '<div class="lm-empty">本原型还没有跳转交互。<br>按住 Ctrl 点击原型元素即可拾取设置。</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var stale = !!l._stale;
      var staleCls = stale ? ' stale' : '';
      var targetInfo = escHtml(l.target);
      if (l.targetPage) targetInfo += ' · ' + escHtml(l.targetPage);
      
      // 优先显示按钮对应的中文名称
      var btnName = l.btnName || '';
      if (!btnName && l.label) {
        var m = l.label.match(/「([^」]+)」/);
        if (m) btnName = m[1];
      }
      if (!btnName && l.text) {
        btnName = l.text.slice(0, 20);
      }

      var chipHtml = '';
      if (stale) {
        chipHtml = '<span class="state-dot stale" title="未生效：原型已被修改"></span>';
      } else {
        chipHtml = '<span class="state-dot live" title="已生效"></span>';
      }

      html += '<div class="lm-item' + staleCls + '" data-idx="' + i + '">'
        + '<div class="lm-item-top">'
        +   '<div class="lm-btn-info">'
        +     '<span class="lm-btn-icon">' + lbIco('check-circle', '●') + '</span>'
        +     (btnName ? '<span class="lm-btn-name" title="' + escAttr(btnName) + '">按钮：<b>【' + escHtml(btnName) + '】</b></span>' : '<span class="lm-btn-name">未命名的按钮/元素</span>')
        +   '</div>'
        +   chipHtml
        + '</div>'
        + '<div class="lm-item-target-wrap">'
        +   '<span class="lm-target-label">跳转至：</span>'
        +   '<span class="lm-target-val">' + targetInfo + '</span>'
        + '</div>'
        + '<div class="lm-item-acts">'
        +   '<button data-act="jump">试跳</button>'
        +   '<button data-act="change">更换目标</button>'
        +   '<button data-act="delete" class="danger">删除</button>'
        + '</div>'
        + '<div class="lm-replace" id="lmReplace_' + i + '" style="display:none"></div>'
        + '</div>';
    }
    body.innerHTML = html;
    /* 绑定事件 */
    var acts = body.querySelectorAll('.lm-item-acts button');
    for (var j = 0; j < acts.length; j++) {
      (function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var act = btn.getAttribute('data-act');
          var item = btn.closest ? btn.closest('.lm-item') : null;
          var idx = parseInt(item ? item.getAttribute('data-idx') : btn.getAttribute('data-idx'), 10);
          if (act === 'jump') {
            closeAllDrawers();
            performLink(links[idx]);
          } else if (act === 'change') {
            renderLinkMgrReplace(idx, links[idx]);
          } else if (act === 'delete') {
            removeLinkMgrItem(idx);
          }
        };
      })(acts[j]);
    }
  }

  function renderLinkMgrReplace(idx, link) {
    var replaceDiv = $('lmReplace_' + idx);
    if (!replaceDiv) return;
    if (replaceDiv.style.display !== 'none') {
      replaceDiv.style.display = 'none';
      replaceDiv.innerHTML = '';
      return;
    }
    /* 目标列表：当前原型主页排首位（可展开子页面），其后为其他原型 */
    var entries = [];
    if (currentSource) entries.push(currentSource);
    for (var i = 0; i < sources.length; i++) {
      if (sources[i] !== currentSource) entries.push(sources[i]);
    }
    if (!entries.length) {
      replaceDiv.innerHTML = '<div class="li-hint">项目内暂无可选原型。</div>';
      replaceDiv.style.display = '';
      return;
    }
    var selSub = (link.targetPage && /\.html?$/i.test(String(link.targetPage))) ? String(link.targetPage) : '';
    var html = '<div class="li-targets">';
    for (var j = 0; j < entries.length; j++) {
      var s = entries[j];
      var kindCls = s.kind === 'pc' ? 'pc' : 'mobile';
      var kindLabel = s.kind === 'pc' ? 'PC' : '移动';
      var isCur = (s === currentSource);
      var selCls = (s.displayName === link.target) ? ' selected' : '';
      html += '<div class="li-target-item' + selCls + '" data-tidx="' + j + '">'
        + '<span class="li-target-name">' + escHtml(s.displayName) + '</span>'
        + (isCur ? '<span class="li-target-kind cur">本原型</span>' : '')
        + '<span class="li-target-kind ' + kindCls + '">' + kindLabel + '</span>'
        + '</div>';
      if (s.displayName === link.target) {
        var subs = (s.subPages && s.subPages.slice()) || [];
        var mainF = s.mainHtmlFile || s.name || '';
        html += '<div class="li-sub-list" data-for="' + j + '">'
          + '<div class="li-sub-item' + (selSub ? '' : ' selected') + '" data-sub="">打开主页' + (mainF ? '（' + escHtml(mainF) + '）' : '') + '</div>';
        for (var q = 0; q < subs.length; q++) {
          var sf = subs[q] && (subs[q].file || subs[q].name || subs[q]);
          var sn = (subs[q] && (subs[q].name || subs[q].file)) || sf;
          if (!sf) continue;
          html += '<div class="li-sub-item' + (selSub === String(sf) ? ' selected' : '') + '" data-sub="' + escAttr(String(sf)) + '">' + escHtml(String(sn)) + '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
    html += '<div class="li-actions"><button class="docs-btn primary" id="lmSaveReplace_' + idx + '">保存</button></div>';
    replaceDiv.innerHTML = html;
    replaceDiv.style.display = '';
    /* 页面选择：行内子页面直选（替换原来的目标页面下拉框） */
    var selTarget = null;
    for (var t = 0; t < entries.length; t++) { if (entries[t].displayName === link.target) { selTarget = entries[t]; break; } }
    var items = replaceDiv.querySelectorAll('.li-target-item');
    for (var k = 0; k < items.length; k++) {
      (function (item) {
        item.onclick = function () {
          var ti = parseInt(item.getAttribute('data-tidx'), 10);
          selTarget = entries[ti];
          selSub = '';
          link.target = selTarget.displayName;
          renderLinkMgrReplace(idx, link);
        };
      })(items[k]);
    }
    var subRows = replaceDiv.querySelectorAll('.li-sub-item');
    for (var w = 0; w < subRows.length; w++) {
      (function (sub) {
        sub.onclick = function (ev) {
          try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (e) {}
          selSub = String(sub.getAttribute('data-sub') || '');
          var allSubs = replaceDiv.querySelectorAll('.li-sub-item');
          for (var m = 0; m < allSubs.length; m++) allSubs[m].classList.remove('selected');
          sub.classList.add('selected');
        };
      })(subRows[w]);
    }
    var saveBtn = $('lmSaveReplace_' + idx);
    if (saveBtn) {
      saveBtn.onclick = function () {
        if (!selTarget) { alert('请先选择一个目标原型。'); return; }
        var tp = selSub;
        link.target = selTarget.displayName;
        link.targetPage = tp;
        link.ts = Date.now();
        currentSource._links = currentSource._links || [];
        window.protoAPI.links.write(currentSource.sandboxDir, { links: currentSource._links });
        updateLinkBadge();
        libStatus('已更换跳转目标。');
        renderLinkMgr();
      };
    }
  }

  function removeLinkMgrItem(idx) {
    var links = currentSource._links || [];
    if (idx < 0 || idx >= links.length) return;
    var rmPlid = '';
    try { rmPlid = String((links[idx] && (links[idx].plid || links[idx].id)) || ''); } catch (e) { rmPlid = ''; }
    links.splice(idx, 1);
    currentSource._links = links;
    window.protoAPI.links.write(currentSource.sandboxDir, { links: links });
    try { if (rmPlid) silentCleanStalePlid(rmPlid); } catch (e2) {}
    updateLinkBadge();
    libStatus('已删除跳转绑定。');
    renderLinkMgr();
  }

  /* ═══════ 徽标：只计当前页跳出的交互（跨页/跨原型的不计入） ═══════ */
  function linkOnCurPage(l) {
    try {
      var cur = '';
      try { cur = framePageKey(); } catch (e) {}
      return String((l && l.page) || '') === String(cur || '');
    } catch (e2) { return true; }
  }
  function updateLinkBadge() {
    var links = (currentSource && currentSource._links) || [];
    var curLinks = [];
    for (var ci = 0; ci < links.length; ci++) { if (linkOnCurPage(links[ci])) curLinks.push(links[ci]); }
    var n = curLinks.length;
    var badge = $('linkBadge');
    if (badge) {
      badge.textContent = n;
      badge.style.display = n ? '' : 'none';
      /* 有失效项时追加警示（只看当前页） */
      var hasStale = curLinks.some(function (l) { return l._stale; });
      badge.classList.toggle('warn', hasStale);
    }
  }

  /* ═══════ 失效校验（查戳优先，备用 selector 补戳，不写盘） ═══════ */
  function validateLinks() {
    if (!currentSource) return;
    var links = currentSource._links || [];
    /* 空列表/跨域读不到文档时只刷新徽标计数，不做戳校验（切原型后清零即走这里） */
    if (!links.length || !frame || !frame.contentDocument) { try { updateLinkBadge(); } catch (e) {} return; }
    var doc = frame.contentDocument;
    var changed = false;
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var plid = String(l.plid || '');
      if (plid) {
        try {
          var sid = plid.replace(/"/g, '');
          var stamped = null;
          try { stamped = doc.querySelectorAll('[data-plink="' + sid + '"]'); } catch (e) { stamped = null; }
          if (stamped && stamped.length === 1) {
            l._stale = false;
          } else {
            var back = null;
            try { back = doc.querySelectorAll(l.selector); } catch (e2) { back = null; }
            if (back && back.length === 1) {
              try { back[0].setAttribute('data-plink', sid); } catch (e3) {}
              l._stale = false;
            } else {
              l._stale = true;
            }
          }
        } catch (e) {
          l._stale = true;
        }
      } else {
        try {
          var all = doc.querySelectorAll(l.selector);
          l._stale = (all.length !== 1);
        } catch (e4) {
          l._stale = true;
        }
      }
      changed = true;
    }
    /* 孤儿戳静默清理：有戳无表项则去戳，不标 stale 不提示，不写盘 */
    try {
      var known = {};
      for (var ki = 0; ki < links.length; ki++) {
        try {
          var k1 = String(links[ki].plid || '');
          if (k1) known[k1] = true;
          var k2 = String(links[ki].id || '');
          if (k2) known[k2] = true;
        } catch (e5) {}
      }
      try {
        var allStamped = doc.querySelectorAll('[data-plink]');
        for (var oi = 0; oi < (allStamped ? allStamped.length : 0); oi++) {
          try {
            var opid = String(allStamped[oi].getAttribute('data-plink') || '');
            if (!opid || !known[opid]) {
              try { allStamped[oi].removeAttribute('data-plink'); } catch (e6) {}
            }
          } catch (e7) {}
        }
      } catch (e8) {}
    } catch (e9) {}
    if (changed) {
      updateLinkBadge();
      /* 如果检查器或管理抽屉打开则刷新 */
      if ($('linkInspector') && $('linkInspector').classList.contains('open')) {
        var sel = inspectorEl ? generateSelector(inspectorEl) : '';
        var pg = framePageKey();
        var jumpChip = $('liJumpChip');
        var jumpBody = $('liJumpBody');
        renderJumpSection(sel, pg, jumpChip, jumpBody);
      }
      if ($('linkMgrDrawer') && $('linkMgrDrawer').classList.contains('open')) {
        renderLinkMgr();
      }
    }
  }

  /* ═══════ AI 刷新后挂钩 ═══════ */
  function onAfterAiRefresh() {
    if (!currentSource || !currentSource.sandboxDir) return;
    /* 重新拉取 _links 缓存 */
    window.protoAPI.links.read(currentSource.sandboxDir).then(function (r) {
      if (r && r.ok && r.data) {
        currentSource._links = (r.data && r.data.links) || [];
      } else {
        currentSource._links = currentSource._links || [];
      }
      validateLinks();
      var links = currentSource._links || [];
      var staleCount = links.filter(function (l) { return l._stale; }).length;
      if (staleCount > 0) {
        libStatus('检测到 ' + staleCount + ' 条跳转因原型修改可能失效，请点「交互」查看。');
      }
      updateLinkBadge();
    }).catch(function () {});
  }

  /* ═══════ Esc 键关闭抽屉 ═══════ */
  function initEscListener() {
    // P1-7 fix: Esc 统一由 MaskStack 单一监听接管，此处不再重复注册
    // 保留空实现以兼容旧调用，实际关闭逻辑由 push/pop 驱动
  }

  /* ═══════ 遮罩点击关闭（I02 统一：点击遮罩关闭对应抽屉） ═══════ */
  function initMaskListeners() {
    var inspMask=$('linkInspMask');
    if(inspMask) inspMask.onclick=function(){ closeInspector(); };
    var mgrMask=$('linkMgrMask');
    if(mgrMask) mgrMask.onclick=function(){ closeLinkMgr(); };
    var editMask=$('editDrawerMask');
    if(editMask) editMask.onclick=function(){ if(typeof closeEditDrawer==='function') closeEditDrawer(); };
    var multiMask=$('multiEditMask');
    if(multiMask) multiMask.onclick=function(){ if(window.CTRL_PICK&&typeof CTRL_PICK.closePanel==='function'){ CTRL_PICK.closePanel(); CTRL_PICK.clear(); } };
  }
  function initMaskStackRegister(){
    if(window.MaskStack && window.MaskStack.register){
      try{ window.MaskStack.register('linkInspMask','linkInspector', closeInspector); }catch(e){}
      try{ window.MaskStack.register('linkMgrMask','linkMgrDrawer', closeLinkMgr); }catch(e){}
    }
  }

  /* ═══════ 抽屉关闭按钮 ═══════ */
  function initCloseButtons() {
    var inspClose = $('liClose');
    var mgrClose = $('lmClose');
    if (inspClose) inspClose.onclick = function () { closeInspector(); };
    if (mgrClose) mgrClose.onclick = function () { closeLinkMgr(); };
  }

  /* ═══════ onFrameLoad：由 edit-entry.js 的 frame load 事件调用 ═══════ */
  function onFrameLoad() {
    if (pendingGoto !== null) {
      var page = pendingGoto;
      pendingGoto = null;
      try {
        var f = document.getElementById('frame') || document.querySelector('iframe');
        if (f && f.contentWindow) {
          f.contentWindow.postMessage({ type: 'proto-goto', page: page }, '*');
        }
      } catch (e) {}
    }
    /* 延迟 300ms 校验失效 */
    setTimeout(function () { validateLinks(); }, 300);
  }

  /* ═══════ 管理抽屉按钮绑定 ═══════ */
  function initLinkMgrButton() {
    var btn = $('btnLinkMgr');
    if (btn) btn.onclick = function () { openLinkMgr(); };
  }

  /* ═══════ 初始化 ═══════ */
  function init() {
    initMessageListener();
    initEscListener();
    initMaskListeners();
    initMaskStackRegister();
    initCloseButtons();
    initReqSection();
    initFoldSections();
    initLinkMgrButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 公开 API */
  return {
    wrapProtoHtml: wrapProtoHtml,
    performLink: performLink,
    broadcastMode: broadcastMode,
    closeAllDrawers: closeAllDrawers,
    openInspector: openInspector,
    openInspectorRemote: openInspectorRemote,
    closeInspector: closeInspector,
    openLinkMgr: openLinkMgr,
    closeLinkMgr: closeLinkMgr,
    quickBind: quickBind,
    removeJumpBinding: removeJumpBinding,
    updateLinkBadge: updateLinkBadge,
    validateLinks: validateLinks,
    onAfterAiRefresh: onAfterAiRefresh,
    onFrameLoad: onFrameLoad
  };
})();
/* FIX: 经典<script>加载，移除ESM export(以window.LinkBind为准，见下) */
try { if (typeof window !== 'undefined') window.LinkBind = window.LinkBind || LinkBind; } catch (e) {}
/* 注: _LbStore 为显式依赖声明 (Wave-D 全量切换队列/源真相源; 本波保持经典互操作)。 */