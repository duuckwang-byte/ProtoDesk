/* [js/annotation-core.js] 零污染 HTML 元素标注系统核心引擎（Sidecar 存储 + Robust Locator + 页面隔离 + 画布显示开关 + 双向联动） */
/* FIX: 经典<script>加载，禁用ESM import(整文件罢工)。内联回退+window.Utils双保险。 */
var escHtml = (typeof window !== 'undefined' && window.escHtml) || (typeof window !== 'undefined' && window.Utils && window.Utils.escHtml) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var AnnotationEngine = (function () {
  'use strict';

  var CURRENT_ANNOTATIONS = [];
  var currentAnnoEl = null;
  var currentAnnoSel = '';
  var currentAnnoPg = '';
  var currentAnnoId = null;
  var mutationObserver = null;
  var annoBadgesVisible = true;
  var loadSeq=0; // P2-1 fix: 标注串台 NF-05 序号防旧回包覆盖
  var currentAnnoRemoteInfo=null; /* 沙箱跨域远端元素信息 {label,text,tagName}，loadInspectorAnno(el=null) 时由检查器远端入口设置 */
  function setInspectorRemoteInfo(info){
    try{ currentAnnoRemoteInfo=(info&&typeof info==='object')?{ label:String(info.label||''), text:String(info.text||''), tagName:String(info.tagName||'') }:null; }catch(e){ currentAnnoRemoteInfo=null; }
  }

  try {
    var storedVis = localStorage.getItem('proto_anno_visible');
    if (storedVis === 'false') annoBadgesVisible = false;
  } catch (e) {}

  /* ═══════ 辅助函数 ═══════ */
  function $(id) { return document.getElementById(id); }

  function getCurPage(doc) {
    try {
      var d = doc || (frame && frame.contentDocument);
      var h = '';
      if (typeof framePageKey === 'function') h = framePageKey();
      if (!h && frame && frame.contentWindow && frame.contentWindow.location) {
        h = (frame.contentWindow.location.hash || '').replace(/^#/, '');
      }
      if (h) return h;
      if (d) {
        var activeSec = d.querySelector('.page.active, [data-page].active, section[id^="page-"].active');
        if (activeSec && activeSec.id) return activeSec.id;
      }
      return '';
    } catch (e) { return ''; }
  }

  function isElementVisible(el, doc) {
    if (!el || !el.ownerDocument) return false;
    var d = doc || el.ownerDocument;
    var win = d.defaultView || window;

    // 1. 检查元素自身 computedStyle
    try {
      var st = win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') <= 0.05) {
        return false;
      }
    } catch (e) { return false; }

    // 2. 检查父级 .page 页面容器状态
    try {
      var pageParent = el.closest ? el.closest('.page, [data-page], section[id^="page-"]') : null;
      if (pageParent) {
        var pst = win.getComputedStyle(pageParent);
        if (pst.display === 'none' || pst.visibility === 'hidden' || parseFloat(pst.opacity || '1') <= 0.05) {
          return false;
        }
        if (pageParent.classList.contains('page') && !pageParent.classList.contains('active') && !pageParent.classList.contains('root')) {
          return false;
        }
      }
    } catch (e) {}

    // 3. 检查视口坐标与尺寸（排除 0 宽高或超出 iframe 画布视口的元素）
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= win.innerWidth || rect.top >= win.innerHeight) {
        return false;
      }
    } catch (e) { return false; }

    return true;
  }

  function annoRectToPage(rect) {
    if (typeof editRectToPage === 'function') {
      var p = editRectToPage(rect);
      return {
        left: p.left,
        top: p.top,
        width: p.width,
        height: p.height,
        right: p.left + p.width,
        bottom: p.top + p.height
      };
    }
    var fr = $('frame');
    var r = fr ? fr.getBoundingClientRect() : { left: 0, top: 0 };
    var s = (typeof editFrameScale === 'function') ? editFrameScale() : 1;
    var w = (rect.width || 0) * s;
    var h = (rect.height || 0) * s;
    var l = r.left + (rect.left || 0) * s;
    var t = r.top + (rect.top || 0) * s;
    return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h };
  }

  function formatTime(d) {
    var date = d || new Date();
    /* Wave-C/F: pad2 显式 import (_utilsPad2) 为准, window.Utils 仅作 stripped-classic 降级只读 */
    var pad = (function(){ try { if (typeof _utilsPad2 === 'function') return _utilsPad2; } catch (e) {} try { if (typeof window!=='undefined'&&window.Utils&&window.Utils.pad2) return window.Utils.pad2; } catch (e2) {} return function (n) { return String(n).padStart(2, '0'); }; })();
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function updateTopBarBadge() {
    var b = $('annoBadgeCount');
    if (!b) return;
    var count = CURRENT_ANNOTATIONS.length;
    if (count > 0) {
      b.textContent = count;
      b.style.display = '';
    } else {
      b.style.display = 'none';
    }
  }

  /* ═══════ 多重特征智能定位器 (Robust Locator) ═══════ */
  function resolveAnnoTarget(doc, anno) {
    if (!doc || !anno) return null;
    var hits = null;

    /* 1. 主定位：CSS 选择器直接匹配 */
    if (anno.selector) {
      try {
        hits = doc.querySelectorAll(anno.selector);
        if (hits && hits.length === 1) {
          return { el: hits[0], selector: anno.selector, matched: 'direct' };
        }
      } catch (e) { hits = null; }
    }

    /* 2. 文本+标签唯一匹配（全文档扫描） */
    if (anno.textSnippet && anno.tagName) {
      var textHit = findExactTextEl(doc, anno.textSnippet, anno.tagName);
      if (textHit) {
        var newSel = (typeof generateSelector === 'function') ? generateSelector(textHit) : anno.selector;
        return { el: textHit, selector: newSel, matched: 'text' };
      }
    }

    /* 3. 降级重对齐：截断父级路径模糊匹配 */
    var fallback = tryLevelFallback(doc, anno);
    if (fallback) {
      return { el: fallback.el, selector: fallback.selector, matched: 'fallback' };
    }

    /* 4. 无法定位返回 null */
    return null;
  }

  function findExactTextEl(doc, snippet, tagName) {
    var norm = String(snippet || '').replace(/\s+/g, ' ').trim();
    if (!norm) return null;
    var tag = tagName ? String(tagName).toLowerCase() : '*';
    var nodes = doc.querySelectorAll(tag);
    var found = null, count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var t = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t === norm || (t.length > 2 && t.indexOf(norm) === 0)) {
        found = node;
        count++;
      }
    }
    return count === 1 ? found : null;
  }

  function tryLevelFallback(doc, anno) {
    if (!anno.selector) return null;
    var parts = String(anno.selector).split('>');
    var norm = String(anno.textSnippet || '').replace(/\s+/g, ' ').trim();
    for (var i = parts.length - 1; i >= 0; i--) {
      var seg = parts.slice(i).join(' > ').trim();
      if (!seg) continue;
      try {
        var els = doc.querySelectorAll(seg);
        if (els.length === 1) {
          var sel1 = (typeof generateSelector === 'function') ? generateSelector(els[0]) : seg;
          return { el: els[0], selector: sel1 };
        }
        if (els.length > 1 && norm) {
          var matchEl = null, matchCount = 0;
          for (var j = 0; j < els.length; j++) {
            var elText = String(els[j].textContent || '').replace(/\s+/g, ' ').trim();
            if (elText.indexOf(norm) >= 0 || norm.indexOf(elText) >= 0) {
              matchEl = els[j];
              matchCount++;
            }
          }
          if (matchCount === 1 && matchEl) {
            var sel2 = (typeof generateSelector === 'function') ? generateSelector(matchEl) : seg;
            return { el: matchEl, selector: sel2 };
          }
        }
      } catch (e) {}
    }
    return null;
  }

  /* ═══════ 数据读取与持久化 ═══════ */
  function loadAnnotations(dir) {
    const seq=++loadSeq; // P2-1 fix: 递增序号，丢弃过期回包
    /* 立即清空旧标注数据，杜绝原型切换时的残留闪烁 */
    CURRENT_ANNOTATIONS = [];
    renderAnnotationBadges();

    /* 导出查看器环境 */
    if (window.__EXPORT_BOOT__ === true) {
      var curName = (currentSource && (currentSource.displayName || currentSource.name)) || '';
      var map = window.__ANNO_MAP__ || {};
      CURRENT_ANNOTATIONS = Array.isArray(map[curName]) ? map[curName] : [];
      renderAnnotationBadges();
      return Promise.resolve(CURRENT_ANNOTATIONS);
    }

    if (!dir) {
      CURRENT_ANNOTATIONS = [];
      renderAnnotationBadges();
      return Promise.resolve([]);
    }

    if (window.protoAPI && window.protoAPI.annotations && typeof window.protoAPI.annotations.read === 'function') {
      return window.protoAPI.annotations.read(dir).then(function (r) {
        if(seq!==loadSeq) return; // P2-1 fix: 丢弃过期回包防串台
        var list = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
        CURRENT_ANNOTATIONS = list;
        renderAnnotationBadges();
        return list;
      }).catch(function () {
        if(seq!==loadSeq) return; // P2-1 fix
        CURRENT_ANNOTATIONS = [];
        renderAnnotationBadges();
        return [];
      });
    }
    CURRENT_ANNOTATIONS = [];
    renderAnnotationBadges();
    return Promise.resolve([]);
  }

  function saveAnnotations(dir, list) {
    CURRENT_ANNOTATIONS = Array.isArray(list) ? list : [];
    if (!window.__EXPORT_BOOT__ && window.protoAPI && window.protoAPI.annotations && dir) {
      window.protoAPI.annotations.save(dir, CURRENT_ANNOTATIONS);
    }
    renderAnnotationBadges();
    var mgrDrawer = $('annoMgrDrawer');
    if (mgrDrawer && mgrDrawer.classList.contains('open')) {
      renderAnnoMgrList();
    }
  }

  /* ═══════ 画布徽标与 Popover 渲染 ═══════ */
  var annoRectSeq = 0; /* 回包过期令牌：快速连续渲染只认最新一次 */
  /* 帧视图变化（滚动/换页）与宿主滚动/缩放：节流重排徽标（同源直绑跨域失效，此为唯一通道） */
  var annoViewTimer = null;
  function onAnnoViewChanged(){
    try{
      if(annoViewTimer) return;
      annoViewTimer=setTimeout(function(){ try{ annoViewTimer=null; }catch(e){} try{ renderAnnotationBadges(); }catch(e2){} try{ if(window.LinkBind&&typeof window.LinkBind.updateLinkBadge==='function') window.LinkBind.updateLinkBadge(); }catch(e3){} },200);
    }catch(e){}
  }
  try{ window.__onAnnoViewChanged=function(){ onAnnoViewChanged(); }; }catch(e){}
  try{
    var _annoStage=null;
    try{ _annoStage=document.querySelector('.stage-frame'); }catch(e){}
    if(_annoStage&&!_annoStage.__annoScrollBound){ _annoStage.__annoScrollBound=true; try{ _annoStage.addEventListener('scroll',function(){ try{ onAnnoViewChanged(); }catch(e){} },{capture:true,passive:true}); }catch(e2){} }
    if(!window.__annoResizeBound){ window.__annoResizeBound=true; window.addEventListener('resize',function(){ try{ onAnnoViewChanged(); }catch(e){} }); }
    /* 动画跟随轮询：轮播/走马灯等会持续改变元素位置，帧内无事件可推，宿主每 2.5s 轻量重查一次；
     * 有标注+开显示+页面可见时才跑，空载零开销 */
    if(!window.__annoPollBound){ window.__annoPollBound=true; try{ setInterval(function(){
      try{
        if(!annoBadgesVisible) return;
        if(!CURRENT_ANNOTATIONS || !CURRENT_ANNOTATIONS.length) return;
        if(typeof document!=='undefined'&&document.hidden) return;
        renderAnnotationBadges();
      }catch(e){}
    },2500); }catch(e){} }
  }catch(e){}
  function renderAnnotationBadges() {
    updateTopBarBadge();

    var container = $('annoBadgeLayer');
    if (!container) return;
    // Anno fix: 确保徽标层不被裁切，且不阻断底层交互（徽标自身 pointer-events:auto 可点击）
    try { container.style.overflow = 'visible'; container.style.pointerEvents = 'none'; } catch(e) {}
    container.innerHTML = '';

    /* 若用户关闭画布显示开关，直接返回 */
    if (!annoBadgesVisible) {
      closeAnnoPopover();
      return;
    }

    var iframe = $('frame');
    if (!iframe || !iframe.contentWindow) return;
    var curHtml = (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';

    /* 宿主侧文件过滤；跨域读不到帧 DOM，包围盒走帧桥批量查询（与 HOVER 同坐标系） */
    var jobs = [];
    var wantIds = {};
    for (var gi = 0; gi < CURRENT_ANNOTATIONS.length; gi++) {
      try {
        var anno = CURRENT_ANNOTATIONS[gi];
        if (!anno || !anno.id) continue;
        if (anno.htmlFile && curHtml && anno.htmlFile !== curHtml) continue;
        if (!anno.selector) continue;
        wantIds[anno.id] = anno;
        jobs.push({ key: String(anno.id), selector: String(anno.selector) });
      } catch (e) {}
    }
    if (!jobs.length) return;
    if (typeof sandboxRequestAnnoRects !== 'function') return;

    var seq = ++annoRectSeq;
    var req = null;
    try { req = sandboxRequestAnnoRects(jobs, 4000); } catch (e) { req = null; }
    if (!req || !req.then) return;
    req.then(function (res) {
      if (seq !== annoRectSeq) return;
      try {
        var items = (res && Array.isArray(res.items)) ? res.items : [];
        var framePage = String((res && res.page) || '');
        var byKey = {};
        for (var bi = 0; bi < items.length; bi++) {
          var bit = items[bi];
          if (bit && bit.key) byKey[String(bit.key)] = bit;
        }
        var visibleIdx = 0;
        for (var oi = 0; oi < CURRENT_ANNOTATIONS.length; oi++) {
          (function (oAnno) {
            try {
              if (!oAnno || !oAnno.id || !wantIds[oAnno.id]) return;
              var hit = byKey[String(oAnno.id)];
              if (!hit || !hit.rect) return;
              /* 页面过滤：帧回传 hash 为准，空值放行（与旧宽松口径一致） */
              var aPg = String(oAnno.page || '');
              if (aPg && framePage && aPg !== framePage) return;
              var p = null;
              try { p = annoRectToPage(hit.rect); } catch (e) { p = null; }
              if (!p) return;
              /* 视口外裁剪：轮播/动画把元素移出可视区时不画点（如下次回来轮询会重画），防徽标飞到侧栏 */
              try {
                var _fr = (typeof frame !== 'undefined' && frame && frame.getBoundingClientRect) ? frame.getBoundingClientRect() : null;
                if (_fr) {
                  if (p.right < _fr.left || p.left > _fr.right || p.bottom < _fr.top || p.top > _fr.bottom) {
                    try { window.__annoLastCull = (window.__annoLastCull || 0) + 1; } catch (e9) {}
                    return;
                  }
                }
              } catch (e8) {}
              visibleIdx++;
              /* 固定编号：用标注在全量列表中的创建顺序（oi+1），不随裁剪/过滤重排；1号被裁时2号仍显示2 */
              var badgeNo = oi + 1;
              var badge = document.createElement('div');
              badge.className = 'anno-badge';
              badge.textContent = String(badgeNo);
              badge.title = (oAnno.title || '需求标注');
              badge.style.top = (p.top - 6) + 'px';
              badge.style.left = (p.right - 8) + 'px';

              badge.onclick = (function (_anno, _p, _seq) {
                return function (e) {
                  try { e.stopPropagation(); } catch (ee) {}
                  try { showAnnotationPopover(_anno, _p, _seq); } catch (ee2) {}
                  try { syncAnnoMgrTo(_anno); } catch (ee3) {}
                };
              })(oAnno, p, badgeNo);

              container.appendChild(badge);
            } catch (e) {}
          })(CURRENT_ANNOTATIONS[oi]);
        }
        try { var _culled = 0; try { _culled = window.__annoLastCull || 0; window.__annoLastCull = 0; } catch (e9) {} window.__annoLastDiag = { total: jobs.length, shown: visibleIdx, culled: _culled, page: framePage, at: Date.now() }; } catch (e2) {}
      } catch (e) {}
    }, function () { /* 超时/失败：静默无徽标 */ try { window.__annoLastDiag = { total: jobs.length, shown: 0, page: '', timeout: true, at: Date.now() }; } catch (e2) {} });
  }

  function showAnnotationPopover(anno, rect, seqNum) {
    var popover = $('annoPopoverCard');
    if (!popover) return;

    var titleEl = $('popoverAnnoTitle');
    var contentEl = $('popoverAnnoContent');
    var seq = seqNum || (CURRENT_ANNOTATIONS.indexOf(anno) + 1);
    if (titleEl) {
      var htmlTag = (anno.htmlFile ? ' <span style="font-size:11px;color:var(--faint);font-weight:400">(' + (typeof escHtml === 'function' ? escHtml(anno.htmlFile) : anno.htmlFile) + ')</span>' : '');
      var titleText = (anno.title || '需求标注').trim();
      var escTitle = (typeof escHtml === 'function') ? escHtml(titleText) : titleText;
      titleEl.innerHTML = '<span style="color:#E11D48;font-weight:700;margin-right:6px">#' + seq + '</span>' + escTitle + htmlTag;
    }
    if (contentEl) {
      var raw = String(anno.content || '').trim();
      var html = (typeof formatAiText === 'function') ? formatAiText(raw) : (typeof escHtml === 'function' ? escHtml(raw) : raw);
      contentEl.innerHTML = html || '<span style="color:var(--faint)">暂无详细说明</span>';
    }

    popover.style.display = 'block';
    var ph = 0;
    try { ph = popover.offsetHeight || 0; } catch (e) {}
    var rct = rect || {};
    var top = (typeof rct.top === 'number' ? rct.top : 0) - ph - 8;
    if (top < 8) top = (typeof rct.bottom === 'number' ? rct.bottom : 0) + 8;
    var left = Math.max(10, (typeof rct.left === 'number' ? rct.left : 10));
    if (left + 290 > window.innerWidth) {
      left = Math.max(10, window.innerWidth - 300);
    }
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
  }

  function closeAnnoPopover() {
    var popover = $('annoPopoverCard');
    if (popover) popover.style.display = 'none';
  }

  /* ═══════ 检查器联动（第三板块：需求标注） ═══════ */
  function loadInspectorAnno(el, sel, pg) {
    currentAnnoEl = el;
    currentAnnoSel = sel || (typeof generateSelector === 'function' ? generateSelector(el) : '');
    var pageParent = el ? (el.closest ? el.closest('.page, [data-page], section[id^="page-"]') : null) : null;
    currentAnnoPg = (pageParent && pageParent.id) ? pageParent.id : (pg !== undefined ? pg : getCurPage());
    currentAnnoId = null;

    var contentInp = $('annoContentInput');
    var delBtn = $('btnDeleteAnno');
    var chipEl = $('liAnnoChip');

    var curHtml = (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';

    /* 查找当前元素是否已存在标注（兼容 page + htmlFile 双重隔离，旧数据无 htmlFile 视为匹配） */
    var found = null;
    for (var i = 0; i < CURRENT_ANNOTATIONS.length; i++) {
      var a = CURRENT_ANNOTATIONS[i];
      if (a.selector === currentAnnoSel && (a.page || '') === currentAnnoPg && (!a.htmlFile || !curHtml || a.htmlFile === curHtml)) {
        found = a;
        break;
      }
    }

    if (found) {
      currentAnnoId = found.id;
      if (contentInp) contentInp.value = found.content || '';
      if (delBtn) delBtn.style.display = '';
      if (chipEl) {
        chipEl.className = 'state-chip live';
        chipEl.textContent = '已标注';
      }
    } else {
      if (contentInp) contentInp.value = '';
      if (delBtn) delBtn.style.display = 'none';
      if (chipEl) {
        chipEl.className = 'state-chip draft';
        chipEl.textContent = '未标注';
      }
    }
  }

  function saveCurrentAnno() {
    if (!currentSource || !currentSource.sandboxDir) {
      try{ if(typeof libStatus==='function')libStatus('该原型未在沙箱中，暂无法保存标注。'); }catch(e){}
      return;
    }
    var contentInp = $('annoContentInput');
    var content = contentInp ? contentInp.value.trim() : '';
    if (!content) {
      try{ if(typeof libStatus==='function')libStatus('请输入标注内容。'); }catch(e){}
      try{ if(contentInp)contentInp.focus(); }catch(e){}
      return;
    }
    var title = '';

    var snippet = '';
    var tagName = '';
    var elName = '';
    if (currentAnnoEl) {
      try {
        snippet = String(currentAnnoEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        tagName = String(currentAnnoEl.tagName || '').toUpperCase();
        if (typeof extractElementText === 'function') {
          elName = extractElementText(currentAnnoEl);
        }
      } catch (e) {}
    }
    /* 远端补位：跨域无 live el 时用帧回传信息 */
    try{
      if(currentAnnoRemoteInfo){
        if(!snippet)snippet=String(currentAnnoRemoteInfo.text||'').slice(0,40);
        if(!tagName)tagName=String(currentAnnoRemoteInfo.tagName||'').toUpperCase();
        if(!elName)elName=String(currentAnnoRemoteInfo.label||currentAnnoRemoteInfo.text||'');
      }
    }catch(e){}

    var curHtml = (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || 'index.html';
    var pageParent = currentAnnoEl ? (currentAnnoEl.closest ? currentAnnoEl.closest('.page, [data-page], section[id^="page-"]') : null) : null;
    var targetPg = (pageParent && pageParent.id) ? pageParent.id : (currentAnnoPg || getCurPage());

    var nowStr = formatTime();
    var list = CURRENT_ANNOTATIONS.slice();
    var foundIdx = -1;

    for (var i = 0; i < list.length; i++) {
      if (currentAnnoId && list[i].id === currentAnnoId) {
        foundIdx = i;
        break;
      }
      if (list[i].selector === currentAnnoSel && (list[i].page || '') === targetPg && (!list[i].htmlFile || !curHtml || list[i].htmlFile === curHtml)) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx >= 0) {
      list[foundIdx].title = title;
      list[foundIdx].content = content;
      list[foundIdx].htmlFile = list[foundIdx].htmlFile || curHtml;
      list[foundIdx].page = targetPg;
      list[foundIdx].textSnippet = snippet || list[foundIdx].textSnippet;
      list[foundIdx].tagName = tagName || list[foundIdx].tagName;
      list[foundIdx].elementName = elName || list[foundIdx].elementName || snippet;
      list[foundIdx].updatedAt = nowStr;
      currentAnnoId = list[foundIdx].id;
    } else {
      var newId = 'anno_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      var item = {
        id: newId,
        htmlFile: curHtml,
        selector: currentAnnoSel,
        textSnippet: snippet,
        tagName: tagName,
        elementName: elName || snippet,
        page: targetPg,
        title: title,
        content: content,
        author: 'PM',
        createdAt: nowStr,
        updatedAt: nowStr
      };
      list.push(item);
      currentAnnoId = newId;
    }

    saveAnnotations(currentSource.sandboxDir, list);
    /* 收敛：非稳定ID选择器的文件后台补ID（静默刷新），后续拾取/定位自动走 pr-id */
    try{
      if(currentAnnoSel && !/data-pr-id\s*=/.test(String(currentAnnoSel)) && typeof prIdBackfillFileInBackground === 'function'){
        var _ad=currentSource.sandboxDir, _af=curHtml;
        if(_ad&&_af) prIdBackfillFileInBackground(_ad,_af);
      }
    }catch(e){}
    loadInspectorAnno(currentAnnoEl, currentAnnoSel, targetPg);
    if (typeof libStatus === 'function') {
      libStatus('已保存需求标注：' + (title || '未命名标注'));
    }
  }

  function deleteCurrentAnno() {
    if (!currentSource || !currentSource.sandboxDir) return;
    if (!currentAnnoId && !currentAnnoSel) return;

    var curHtml = (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';
    var list = CURRENT_ANNOTATIONS.filter(function (a) {
      if (currentAnnoId && a.id === currentAnnoId) return false;
      if (a.selector === currentAnnoSel && (a.page || '') === currentAnnoPg && (!a.htmlFile || !curHtml || a.htmlFile === curHtml)) return false;
      return true;
    });

    saveAnnotations(currentSource.sandboxDir, list);
    loadInspectorAnno(currentAnnoEl, currentAnnoSel, currentAnnoPg);
    if (typeof libStatus === 'function') {
      libStatus('已删除需求标注。');
    }
  }

  function deleteAnnoById(id) {
    if (!id || !currentSource || !currentSource.sandboxDir) return;
    var target = null;
    for (var i = 0; i < CURRENT_ANNOTATIONS.length; i++) {
      if (CURRENT_ANNOTATIONS[i].id === id) { target = CURRENT_ANNOTATIONS[i]; break; }
    }
    var title = target ? (target.title || (target.elementName ? '【' + target.elementName + '】' : '') || '需求标注') : '需求标注';
    var _doDelAnno=function(){
     var list = CURRENT_ANNOTATIONS.filter(function (a) { return a.id !== id; });
     saveAnnotations(currentSource.sandboxDir, list);

    if (currentAnnoId === id) {
      currentAnnoId = null;
      var contentInp = $('annoContentInput');
      var delBtn = $('btnDeleteAnno');
      var chipEl = $('liAnnoChip');
      if (contentInp) contentInp.value = '';
      if (delBtn) delBtn.style.display = 'none';
      if (chipEl) {
        chipEl.className = 'state-chip draft';
        chipEl.textContent = '未标注';
      }
    }
    if (typeof libStatus === 'function') {
      libStatus('已删除标注：' + title);
    }
    };
    try{ if(typeof askConfirm==='function'){ askConfirm({title:'删除标注',message:'确定删除标注「' + title + '」吗？',okText:'删除',danger:true},function(ok){ if(ok)_doDelAnno(); }); return; } }catch(e){}
    _doDelAnno();
  }

  /* ═══════ 标注管理抽屉与双向联动 ═══════ */
  function openAnnoMgr() {
    if (window.LinkBind && typeof LinkBind.closeAllDrawers === 'function') {
      LinkBind.closeAllDrawers();
    }
    renderAnnoMgrList();
    var mask = $('annoMgrMask');
    var drawer = $('annoMgrDrawer');
    if (mask) mask.style.display = 'block';
    if (drawer) {
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    }
    if(window.MaskStack) window.MaskStack.push('annoMgrMask', closeAnnoMgr);
  }

  function closeAnnoMgr() {
    if(window.MaskStack) window.MaskStack.pop('annoMgrMask');
    var mask = $('annoMgrMask');
    var drawer = $('annoMgrDrawer');
    if (mask) mask.style.display = 'none';
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  }

  /* ═══════ 标注颜色体系（深绿/蓝/橙/浅灰）：卡片与画布徽标同色，文字自适应 ═══════ */
  var ANNO_COLORS = [
    { id: 'green', bg: '#047857', fg: '#ffffff' },
    { id: 'blue', bg: '#2563EB', fg: '#ffffff' },
    { id: 'orange', bg: '#EA580C', fg: '#ffffff' },
    { id: 'gray', bg: '#F1F5F9', fg: '#1F2937' }
  ];
  function annoColorOf(anno) {
    var c = '';
    try { c = String((anno && anno.color) || 'green'); } catch (e) {}
    for (var i = 0; i < ANNO_COLORS.length; i++) { if (ANNO_COLORS[i].id === c) return ANNO_COLORS[i]; }
    return ANNO_COLORS[0];
  }
  function annoCycleColor(id) {
    try {
      if (!id || !currentSource || !currentSource.sandboxDir) return;
      var list = CURRENT_ANNOTATIONS.slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) {
          var cur = annoColorOf(list[i]).id, ni = 0;
          for (var j = 0; j < ANNO_COLORS.length; j++) { if (ANNO_COLORS[j].id === cur) { ni = (j + 1) % ANNO_COLORS.length; break; } }
          list[i].color = ANNO_COLORS[ni].id;
          break;
        }
      }
      saveAnnotations(currentSource.sandboxDir, list);
    } catch (e) {}
  }
  function annoSetColor(id, colorId) {
    try {
      if (!id || !currentSource || !currentSource.sandboxDir) return;
      var ok = false;
      for (var k = 0; k < ANNO_COLORS.length; k++) { if (ANNO_COLORS[k].id === colorId) { ok = true; break; } }
      if (!ok) return;
      var list = CURRENT_ANNOTATIONS.slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) {
          if (annoColorOf(list[i]).id === colorId) return;
          list[i].color = colorId;
          break;
        }
      }
      saveAnnotations(currentSource.sandboxDir, list);
    } catch (e) {}
  }
  function renderAnnoMgrList() {
    var body = $('annoMgrBody');
    var countEl = $('annoMgrCount');
    if (countEl) countEl.textContent = CURRENT_ANNOTATIONS.length;
    /* 诊断：悬停计数可看到上轮画布命中 shown/total，便于定位“有数无标”（选择器/页面失配） */
    try {
      var _dg = (typeof window !== 'undefined') ? window.__annoLastDiag : null;
      if (countEl) countEl.title = _dg ? ('画布命中 ' + _dg.shown + '/' + _dg.total + (_dg.culled ? (' · 移出视口' + _dg.culled) : '') + ' · 帧页' + (_dg.page || '空')) : '';
    } catch (e) {}
    if (!body) return;
    body.innerHTML = '';

    if (!CURRENT_ANNOTATIONS.length) {
      body.innerHTML = '<div class="lm-empty">当前原型暂无需求标注。<br>按住 Ctrl 点击原型元素即可拾取添加标注说明。</div>';
      return;
    }

    var groups = {};
    CURRENT_ANNOTATIONS.forEach(function (anno) {
      var pgKey = anno.page || '（首页）';
      if (!groups[pgKey]) groups[pgKey] = [];
      groups[pgKey].push(anno);
    });

    Object.keys(groups).sort().forEach(function (pg) {
      var sec = document.createElement('div');
      sec.className = 'anno-mgr-sec';

      var hd = document.createElement('div');
      hd.className = 'anno-mgr-sec-hd';
      hd.textContent = pg + ' (' + groups[pg].length + ')';
      sec.appendChild(hd);

      groups[pg].forEach(function (anno, idx) {
        /* 固定编号：全量列表中的创建顺序，与画布徽标/浮窗一致，不随分组重排 */
        var globalNo = CURRENT_ANNOTATIONS.indexOf(anno) + 1;
        if (!(globalNo >= 1)) globalNo = idx + 1;
        var it = document.createElement('div');
        it.className = 'anno-mgr-item anno-c-' + annoColorOf(anno).id;
        it.setAttribute('data-anno-id', anno.id);

        var topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '6px';

        var dot = document.createElement('span');
        dot.className = 'anno-mgr-dot';
        dot.textContent = String(globalNo);

        // Anno fix: 简化总览 — 只保留 dot 数字圆点，隐藏标题/序号/文件名（保留节点但不可见，兼顾测试与用户视觉）
        var seqEl = document.createElement('span');
        seqEl.className = 'anno-mgr-seq';
        seqEl.textContent = String(globalNo); // Anno fix: 纯数字，与 dot 一致，避免显示“标注 1”
        seqEl.style.cssText = 'font-size:11px;color:var(--sub);margin-left:4px';
        seqEl.style.display = 'none'; // Anno fix: 隐藏，不再显示“标注 1”
        var fileEl = document.createElement('span');
        fileEl.className = 'anno-mgr-file';
        fileEl.textContent = String(anno.htmlFile || (anno.page || '首页'));
        fileEl.style.cssText = 'font-size:11px;color:var(--faint);margin-left:6px';
        fileEl.style.display = 'none'; // Anno fix: 隐藏文件名
        var titleEl = document.createElement('span');
        titleEl.className = 'anno-mgr-title';
        titleEl.textContent = String(anno.title || '未命名标注');
        titleEl.style.cssText = 'font-size:11px;color:var(--ink);margin-left:6px;flex:1';
        titleEl.style.display = 'none'; // Anno fix: 隐藏标题

        /* 颜色直选：一色一小点，当前色高亮描边（替代旧单钮循环） */
        var colorWrap = document.createElement('span');
        colorWrap.className = 'anno-color-wrap';
        ANNO_COLORS.forEach(function (cc) {
          var d = document.createElement('span');
          d.className = 'anno-color-dot';
          d.title = '设为此颜色';
          d.style.background = cc.bg;
          d.onclick = (function (cid) {
            return function (e) {
              e.stopPropagation();
              annoSetColor(anno.id, cid);
            };
          })(cc.id);
          colorWrap.appendChild(d);
        });

        var delBtn = document.createElement('span');
        delBtn.className = 'anno-mgr-del';
        delBtn.title = '删除此标注';
        try {
          if (typeof window !== 'undefined' && window.PlanBIcon) delBtn.innerHTML = window.PlanBIcon('trash', 13);
          else delBtn.textContent = '✕';
        } catch (e) { try { delBtn.textContent = '✕'; } catch (e2) {} }
        delBtn.onclick = function (e) {
          e.stopPropagation();
          deleteAnnoById(anno.id);
        };

        topRow.appendChild(dot);
        topRow.appendChild(seqEl);
        topRow.appendChild(fileEl);
        topRow.appendChild(titleEl);
        topRow.appendChild(colorWrap);
        topRow.appendChild(delBtn);

        var sn = document.createElement('span');
        sn.className = 'anno-mgr-snippet';
        sn.textContent = String(anno.content || '').trim() || '无详细内容';

        it.appendChild(topRow);
        it.appendChild(sn);

        it.onclick = function () {
          locateAnno(anno);
        };

        sec.appendChild(it);
      });

      body.appendChild(sec);
    });
  }

  function locateAnno(anno) {
    if (!anno) return;
    var targetHtml = anno.htmlFile || (currentSource && (currentSource.mainHtmlFile || currentSource.name)) || '';
    var curHtml = (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';

    /* 跨 HTML 文件定位 */
    if (targetHtml && curHtml && targetHtml !== curHtml && currentSource) {
      if (typeof window.loadSubPage === 'function') {
        window.loadSubPage(currentSource, targetHtml);
      }
    }

    var targetPg = anno.page || '';
    var curPg = getCurPage();

    /* 跨页定位 */
    if (targetPg && targetPg !== curPg && targetPg !== '（首页）') {
      try {
        if (frame && frame.contentWindow) {
          frame.contentWindow.location.hash = targetPg;
        }
        var doc = frame.contentDocument;
        if (doc) {
          var targetSec = doc.getElementById(targetPg) || doc.querySelector('[data-page="' + targetPg + '"]');
          if (targetSec && !targetSec.classList.contains('active')) {
            var allPages = doc.querySelectorAll('.page');
            for (var p = 0; p < allPages.length; p++) allPages[p].classList.remove('active');
            targetSec.classList.add('active');
          }
        }
      } catch (e) {}
    }

    setTimeout(function () {
      var d = null;
      try { d = frame.contentDocument; } catch (e) {}
      if (d) {
        var resolved = resolveAnnoTarget(d, anno);
        if (resolved && resolved.el) {
          try { resolved.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
          flashAnnoTarget(resolved.el);
        }
      }
      highlightAnnoMgrItem(anno.id);
      closeAnnoPopover();
    }, (targetHtml && curHtml && targetHtml !== curHtml) ? 220 : (targetPg && targetPg !== curPg) ? 80 : 0);
  }

  function syncAnnoMgrTo(anno) {
    var drawer = $('annoMgrDrawer');
    if (!drawer || !drawer.classList.contains('open') || !anno) return;
    highlightAnnoMgrItem(anno.id);
    var item = drawer.querySelector('[data-anno-id="' + anno.id + '"]');
    if (item) {
      try { item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }
  }

  function highlightAnnoMgrItem(id) {
    var drawer = $('annoMgrDrawer');
    if (!drawer) return;
    var all = drawer.querySelectorAll('.anno-mgr-item');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    var hit = drawer.querySelector('[data-anno-id="' + id + '"]');
    if (hit) hit.classList.add('active');
  }

  function flashAnnoTarget(el) {
    var d = null;
    try { d = frame.contentDocument; } catch (e) {}
    if (!d || !el) return;
    var old = d.getElementById('annoFlashStyle');
    if (old) old.remove();
    var st = d.createElement('style');
    st.id = 'annoFlashStyle';
    st.textContent = '.anno-flash{outline:2px dashed #E11D48!important;outline-offset:2px;animation:annoFlash .5s ease-in-out 2}@keyframes annoFlash{0%,100%{opacity:1}50%{opacity:.25}}';
    (d.head || d.documentElement).appendChild(st);
    el.classList.add('anno-flash');
    setTimeout(function () {
      el.classList.remove('anno-flash');
      try { st.remove(); } catch (e) {}
    }, 1100);
  }

  /* ═══════ 全局生命周期与事件挂载 ═══════ */
  function onFrameLoad() {
    closeAnnoPopover();
    var doc = null;
    try { doc = frame.contentDocument; } catch (e) {}
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.removeEventListener('hashchange', renderAnnotationBadges);
        frame.contentWindow.addEventListener('hashchange', renderAnnotationBadges);
      } catch (e) {}
    }
    if (doc) {
      if (!doc.__annoScrollBound) {
        doc.__annoScrollBound = true;
        doc.addEventListener('scroll', function () {
          renderAnnotationBadges();
        }, { capture: true, passive: true });
        doc.addEventListener('click', function () {
          setTimeout(renderAnnotationBadges, 50);
          setTimeout(renderAnnotationBadges, 320);
        }, { capture: true, passive: true });
      }
      try {
        if (mutationObserver) mutationObserver.disconnect();
        var debTimer = null;
        mutationObserver = new MutationObserver(function () {
          if (debTimer) clearTimeout(debTimer);
          debTimer = setTimeout(renderAnnotationBadges, 40);
        });
        if (doc.body) {
          mutationObserver.observe(doc.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'hidden'] });
        }
      } catch (e) {}
    }
    renderAnnotationBadges();
  }

  function onAfterAiRefresh() {
    if (currentSource && currentSource.sandboxDir) {
      loadAnnotations(currentSource.sandboxDir);
    }
  }

  function closeAll() {
    closeAnnoPopover();
    closeAnnoMgr();
  }

  /* 点击页面空白处关闭 Popover */
  document.addEventListener('click', function (e) {
    var popover = $('annoPopoverCard');
    if (popover && popover.style.display !== 'none') {
      if (!e.target.closest('#annoPopoverCard') && !e.target.closest('.anno-badge')) {
        closeAnnoPopover();
      }
    }
  });

  /* 绑定按钮与开关事件 */
  document.addEventListener('DOMContentLoaded', function () {
    var btnSave = $('btnSaveAnno');
    if (btnSave) btnSave.onclick = saveCurrentAnno;

    var btnDel = $('btnDeleteAnno');
    if (btnDel) btnDel.onclick = deleteCurrentAnno;

    var btnList = $('btnAnnoList');
    if (btnList) btnList.onclick = openAnnoMgr;

    var btnAnnoMgr = $('btnAnnoMgr');
    if (btnAnnoMgr) btnAnnoMgr.onclick = openAnnoMgr;

    var chkVis = $('chkAnnoVisible');
    if (chkVis) {
      chkVis.checked = annoBadgesVisible;
      chkVis.onchange = function () {
        annoBadgesVisible = chkVis.checked;
        try { localStorage.setItem('proto_anno_visible', String(annoBadgesVisible)); } catch (e) {}
        renderAnnotationBadges();
        if (typeof libStatus === 'function') {
          libStatus(annoBadgesVisible ? '已开启原型标注角标显示。' : '已隐藏原型标注角标。');
        }
      };
    }

    var btnClose = $('annoMgrClose');
    if (btnClose) btnClose.onclick = closeAnnoMgr;

    var mask = $('annoMgrMask');
    /* 走 MaskStack 注册（点遮罩+Esc 双关闭；pop 会恢复注册态，多次开关不失效） */
    if (mask && window.MaskStack && window.MaskStack.register) window.MaskStack.register('annoMgrMask','annoMgrDrawer', closeAnnoMgr);
    else if (mask) mask.onclick = closeAnnoMgr;
  });

  return {
    resolveAnnoTarget: resolveAnnoTarget,
    loadAnnotations: loadAnnotations,
    saveAnnotations: saveAnnotations,
    renderAnnotationBadges: renderAnnotationBadges,
    showAnnotationPopover: showAnnotationPopover,
    closeAnnoPopover: closeAnnoPopover,
    loadInspectorAnno: loadInspectorAnno,
    setInspectorRemoteInfo: setInspectorRemoteInfo,
    saveCurrentAnno: saveCurrentAnno,
    deleteCurrentAnno: deleteCurrentAnno,
    deleteAnnoById: deleteAnnoById,
    openAnnoMgr: openAnnoMgr,
    closeAnnoMgr: closeAnnoMgr,
    locateAnno: locateAnno,
    syncAnnoMgrTo: syncAnnoMgrTo,
    flashAnnoTarget: flashAnnoTarget,
    onFrameLoad: onFrameLoad,
    onAfterAiRefresh: onAfterAiRefresh,
    closeAll: closeAll,
    getAnnotations: function () { return CURRENT_ANNOTATIONS; },
    // fix test regression
    setAnnoVisible: function(v){ annoBadgesVisible=!!v; try{ renderAnnotationBadges(); }catch(e){} try{ localStorage.setItem('proto_anno_visible', annoBadgesVisible?'1':'0'); }catch(e){} },
    isAnnoVisible: function(){ return !!annoBadgesVisible; }
  };
})();
/* FIX: 经典<script>加载，移除ESM export(以window.AnnotationEngine为准，见下) */
try { if (typeof window !== 'undefined') window.AnnotationEngine = window.AnnotationEngine || AnnotationEngine; } catch (e) {}
/* 注: _AnnoStore 为显式依赖声明 (状态真相源迁移 Wave-D 全量切换; 本波保持经典 window 互操作, 避免门禁破裂)。 */
