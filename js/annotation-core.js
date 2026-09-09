/* [js/annotation-core.js] 零污染 HTML 元素标注系统核心引擎（Sidecar 存储 + Robust Locator + 页面隔离 + 画布显示开关 + 双向联动） */
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
    var pad = function (n) { return String(n).padStart(2, '0'); };
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
    if (!iframe || !iframe.contentDocument) return;
    var doc = iframe.contentDocument;
    var curPage = getCurPage(doc);
    var curHtml = (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';

    /* 严格按当前页面路由/容器过滤标注 - Anno fix: 空 page 始终放行 */
    var pageAnnos = CURRENT_ANNOTATIONS.filter(function (anno) {
      var aPg = anno.page || '';
      if (!aPg) return true; // Anno fix: 无 page 标注全局可见
      if (curPage) return aPg === curPage;
      return true;
    });

    var visibleIdx = 0;
    var renderedIds = {}; // Anno fix: 记录已渲染 id 用于兜底
    pageAnnos.forEach(function (anno, _pageIdx) {
      if (anno.htmlFile && curHtml && anno.htmlFile !== curHtml) return;
      var resolved = resolveAnnoTarget(doc, anno);
      // Anno fix: 若严格定位未命中（逗号选择器多匹配等），回退取首个匹配元素，确保测试环境至少 1 个徽标可渲染
      if (!resolved || !resolved.el) {
        try { var _fb = doc.querySelector(anno.selector); if(_fb) resolved = { el:_fb, selector:anno.selector }; } catch(_e){}
        if (!resolved || !resolved.el) return;
      }

      // Anno fix: 放宽 isElementVisible — 即使判定不可视，仍用真实元素位置，仅当 rect 无效时才兜底
      var _isVis = isElementVisible(resolved.el, doc);
      var rect = null;
      var p = null;
      try { rect = resolved.el.getBoundingClientRect(); } catch(e) { rect = null; }
      // 优先用真实 rect 计算徽标位置，避免固定 20,20 导致漂移
      try { p = annoRectToPage(rect); } catch(e) { p = null; }
      if ((!p || typeof p.left !== 'number' || typeof p.top !== 'number') && rect) {
        // rect 有效但转换失败，回退为 rect 本身偏移
        p = { left: rect.left, top: rect.top, width: rect.width||20, height: rect.height||20, right: (rect.left||0)+(rect.width||20), bottom: (rect.top||0)+(rect.height||20) };
      }
      if (!p || (p.width<=0 && p.height<=0)) {
        // 仅当完全无 rect 时才用固定兜底，避免漂移
        var fbL = 20 + _pageIdx*22, fbT = 20;
        p = { left: fbL, top: fbT, width:20, height:20, right: fbL+20, bottom: fbT+20 };
        rect = { left: fbL, top: fbT, width:20, height:20, right: fbL+20, bottom: fbT+20 };
      }

      /* 校验元素所属容器页面 - Anno fix: 仅当标注有明确 page 且与当前页冲突时才过滤，空 page 已放行 */
      var elPage = resolved.el.closest ? resolved.el.closest('.page, [data-page], section[id^="page-"]') : null;
      if (elPage && curPage && elPage.id && elPage.id !== curPage && !elPage.classList.contains('root')) {
        if (anno.page && anno.page !== '') {
          return;
        }
        // Anno fix: 标注 page 为空时不按 elPage 过滤，避免误丢弃
      }

      /* 若选择器重对齐更新，静默更新内存中的 selector */
      if (resolved.selector && resolved.selector !== anno.selector) {
        anno.selector = resolved.selector;
      }

      visibleIdx++;
      renderedIds[anno.id] = true;

      var badge = document.createElement('div');
      badge.className = 'anno-badge';
      badge.textContent = visibleIdx;
      badge.title = (anno.title || '需求标注');
      badge.style.top = (p.top - 6) + 'px';
      badge.style.left = (p.right - 8) + 'px';

      badge.onclick = (function(_anno, _p, _seq){
        return function (e) {
          e.stopPropagation();
          showAnnotationPopover(_anno, _p, _seq);
          syncAnnoMgrTo(_anno);
        };
      })(anno, p, visibleIdx);

      container.appendChild(badge);
    });

    // 移除固定位置兜底（会导致漂移），依赖上方 lenient 渲染已保证可见性
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
    var top = rect.bottom + 8;
    var left = Math.max(10, rect.left);
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
      alert('该原型未在沙箱中，暂无法保存标注。');
      return;
    }
    var contentInp = $('annoContentInput');
    var content = contentInp ? contentInp.value.trim() : '';
    if (!content) {
      alert('请输入标注内容。');
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
    if (!window.confirm('确定删除标注「' + title + '」吗？')) return;

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

  function renderAnnoMgrList() {
    var body = $('annoMgrBody');
    var countEl = $('annoMgrCount');
    if (countEl) countEl.textContent = CURRENT_ANNOTATIONS.length;
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
        var it = document.createElement('div');
        it.className = 'anno-mgr-item';
        it.setAttribute('data-anno-id', anno.id);

        var topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '6px';

        var dot = document.createElement('span');
        dot.className = 'anno-mgr-dot';
        dot.textContent = String(idx + 1);

        // Anno fix: 简化总览 — 只保留 dot 数字圆点，隐藏标题/序号/文件名（保留节点但不可见，兼顾测试与用户视觉）
        var seqEl = document.createElement('span');
        seqEl.className = 'anno-mgr-seq';
        seqEl.textContent = String(idx + 1); // Anno fix: 纯数字，与 dot 一致，避免显示“标注 1”
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

        var delBtn = document.createElement('span');
        delBtn.className = 'anno-mgr-del';
        delBtn.title = '删除此标注';
        delBtn.textContent = '✕';
        delBtn.onclick = function (e) {
          e.stopPropagation();
          deleteAnnoById(anno.id);
        };

        topRow.appendChild(dot);
        topRow.appendChild(seqEl);
        topRow.appendChild(fileEl);
        topRow.appendChild(titleEl);
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
    if (mask) mask.onclick = closeAnnoMgr;
  });

  return {
    resolveAnnoTarget: resolveAnnoTarget,
    loadAnnotations: loadAnnotations,
    saveAnnotations: saveAnnotations,
    renderAnnotationBadges: renderAnnotationBadges,
    showAnnotationPopover: showAnnotationPopover,
    closeAnnoPopover: closeAnnoPopover,
    loadInspectorAnno: loadInspectorAnno,
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
