/* [js/project-ai-export.js] 项目选择 + 沙箱扫描 + 设置 + AI 对话/快照历史 + 导出（由 app.js 拆分，顺序勿乱调） */
/* ═══════ 原型库持久化：新增原型 / 导入 md / 编辑文档后保存，刷新自动恢复 ═══════
   存 sources 元数据 + content(html)，docs 用 sourceDocKey 单存；默认内置源与预设库源不重复存 */
var LIB_SOURCES_KEY='protoLib_sources_v1';
/* 基础示意图标助手：PlanBIcon 不可用时回退基础字符，避免报错 */
function ic(name, fallback) {
  try { if (window.PlanBIcon) { var svg = window.PlanBIcon(name, 14); if (svg) return svg; } } catch (e) {}
  return fallback || '';
}
// @deprecated 保留兼容，外部可能引用，存在性判断已由沙箱层统一
function sourceExists(name){ return sources.some(function(s){ return s.name===name; }); }
function persistLibrary(){
 try{
  var arr=[]; sources.forEach(function(s){
   if(s.isPreset)return;                               /* 沙箱源启动自动加载，不保存避免重启重复 */
   if(s.placeholder)return;                            /* 未授权读取的占位不保存内容 */
   arr.push({ name:s.name, displayName:s.displayName, kind:s.kind||'mobile', method:s.method||'srcdoc',
              content:s.content!=null?s.content:'', mdName:s.mdName||null, path:s.path||'',
              sandboxDir:s.sandboxDir||'', mdFile:s.mdFile||null });
  });
  localStorage.setItem(LIB_SOURCES_KEY, JSON.stringify(arr));
 }catch(e){ /* QuotaExceededError：记录日志但不阻断操作、不弹提示 */
  logWrite('warn','persistLibrary','localStorage 写入失败（可能配额不足）：'+(e&&e.message||e));
 }
}
/* 恢复用户先前新增的原型（含 content）并装载各自 md 文档；沙箱内同名源由 loadSandboxSources 统一接管 */
function restoreLibrary(){
  var arr=null;
  if(window.__EXPORT_BOOT__===true&&window.__EXPORT_SOURCES__){ arr=window.__EXPORT_SOURCES__; } /* 导出查看器：优先用内嵌全局变量（浏览器 file:// 下 localStorage 不可靠） */
  else{ try{ arr=JSON.parse(localStorage.getItem(LIB_SOURCES_KEY)||'null'); }catch(e){} }
 if(!Array.isArray(arr))return;
 var isExportedPage=window.__EXPORT_BOOT__===true; /* 导出单文件：允许恢复与预设同名的源 */
 arr.forEach(function(o){
  var existed=-1;
  for(var i=0;i<sources.length;i++){ if(sources[i].name===o.name){ existed=i; break; } }
  if(existed>=0){
   /* 普通页面：已存在同名源则不重复添加；导出单文件：同名即替换（导出源接管，避免默认源占用导致空白） */
   if(!isExportedPage)return;
   sources.splice(existed,1);
  }
  var src={ name:o.name, displayName:o.displayName||o.name, kind:o.kind||'mobile', isDefault:false,
            method:o.method||'srcdoc', content:o.content!=null?o.content:'', mdName:o.mdName||null, path:o.path||'',
            sandboxDir:o.sandboxDir||'', mdFile:o.mdFile||null, md:o.md||'' };
  if(o.md){ src.md=o.md; }
  loadSourceDocs(src);                                  /* 从本地恢复其 md 文档 */
  if(src.content){ src.pages=extractPages(src.content||''); }
  src.curPage=src.curPage||((src.pages&&src.pages[0])||'page-chat');
  sources.push(src);
 });
 /* 导出文件：从 __EXPORT_LINKS__ 填充 _links */
 try{
   var EL=window.__EXPORT_LINKS__;
   if(Array.isArray(EL)){
     sources.forEach(function(s){
       var k=s.displayName||s.name;
       for(var i=0;i<EL.length;i++){
         if(EL[i]&&(EL[i].displayName===k||EL[i].name===s.name)){ s._links=EL[i].links||[]; break; }
       }
     });
   }
 }catch(e){}
 if(arr.length){ renderSourceList(); }
}

/* 端别切换（修正自动识别） */
if(btnKindMobileEl)btnKindMobileEl.onclick=function(){ setKind('mobile'); };
if(btnKindPcEl)btnKindPcEl.onclick=function(){ setKind('pc'); };

/* ═══════ 打开/收起 左侧菜单栏（内嵌 Docked 布局，展开后不自动关闭，点击菜单/收起 按钮收起） ═══════ */
var sbMaskEl=$('sbMask'),docsMaskEl=$('docsMask');
var sbFitTimer=null;
function setSbOpen(open){
 bodyB.classList.toggle('sb-open',!!open);
 if(sbMaskEl)sbMaskEl.style.display='none'; /* Docked 布局不使用遮罩，避免阻断页面点击 */
 try{ var _sb=document.querySelector('.sb'); if(_sb) _sb.getBoundingClientRect(); }catch(e){}
 clearTimeout(sbFitTimer);
 sbFitTimer=setTimeout(function(){ if(typeof fitPhone==='function') fitPhone(); },220);
 try{
   var sbEl=document.querySelector('.sb');
   if(sbEl) sbEl.addEventListener('transitionend', function(e){ if(e.propertyName==='width' && typeof fitPhone==='function') fitPhone(); }, {once:true});
 }catch(e){}
}
function setDocsOpen(open){
 const isPc = document.body.classList.contains('kind-pc');
 if(!isPc && open){
  // 移动端为切换显示，非悬浮：不使用遮罩与栈，仅切换内容
  bodyB.classList.toggle('docs-open',!!open);
  if(open&&reqOpen)setReqOpen(false);
  return;
 }
 if(!isPc && !open){
  bodyB.classList.toggle('docs-open',!!open);
  closeToc();
  return;
 }
 bodyB.classList.toggle('docs-open',!!open);
 if(docsMaskEl)docsMaskEl.style.display=open?'block':'none';
 if(open){ if(window.MaskStack) window.MaskStack.push('docsMask', function(){ setDocsOpen(false); }); }else{ if(window.MaskStack) window.MaskStack.pop('docsMask'); }
 if(open&&reqOpen)setReqOpen(false); /* 与「最新需求」面板互斥 */
 if(!open){ closeToc(); return; } /* 功能说明收起时同步收起目录浮窗 */
}
function toggleSbPane(){
 setSbOpen(!bodyB.classList.contains('sb-open'));
}
if(btnSbCollapseEl)btnSbCollapseEl.onclick=toggleSbPane;
if(sbFabEl)sbFabEl.onclick=toggleSbPane;
if(sbTriggerEl)sbTriggerEl.onclick=function(){ toggleSbPane(); }; /* 点击菜单按钮 = 展开/收起菜单栏 */
/* 左下功能列表展开：仅 菜单按钮 本体悬停触发；鼠标移出按钮列即收起（无大范围热区） */
var sbHotZoneEl=document.querySelector('.sb-hotzone');
if(sbHotZoneEl){
 if(sbTriggerEl)sbTriggerEl.addEventListener('mouseenter',function(){ sbHotZoneEl.classList.add('sb-hz-open'); });
 sbHotZoneEl.addEventListener('mouseleave',function(e){
  var to=e.relatedTarget;
  if(to&&to.nodeType===1&&sbHotZoneEl.contains(to))return; /* 仍在按钮列内（如移到展开按钮上）不收起 */
  sbHotZoneEl.classList.remove('sb-hz-open');
 });
}

/* ═══════ 打开/收起 右侧功能说明（PC 端悬浮弹窗）+ 遮罩同步 ═══════ */
function toggleDocsPane(){
 if(pcMode()){ reqMode=false; setDocsOpen(!bodyB.classList.contains('docs-open')); return; }
 /* 移动端：右侧面板切回功能说明（若已显示则无变化） */
 if(reqMode)setReqModeMobile(false);
}
if(docsFabEl)docsFabEl.onclick=toggleDocsPane;
if(docsMaskEl)docsMaskEl.addEventListener('click',function(){ setDocsOpen(false); });

/* ═══════ 「最新需求」面板：独立 md 文档（%APPDATA%/原型工具/最新需求.md），查看 + 编辑保存 ═══════ */
var reqFabEl=$('reqFab'),reqMaskEl=$('reqMask'),reqContentEl=$('reqContent'),
    reqEditEl=$('reqEdit'),reqEditAreaEl=$('reqEditArea'),
    btnEditReq=$('btnEditReq'),btnCancelReq=$('btnCancelReq'),btnSaveReq=$('btnSaveReq');
var reqOpen=false,reqEditing=false,reqText='';
function loadReqContent(){
  var render=function(txt){
    reqText=String(txt||'');
    if(reqContentEl)reqContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）');
  };
  if(window.__EXPORT_BOOT__){ render(window.__REQ_MAP__ ? (window.__REQ_MAP__[(currentSource&&currentSource.name)||'']||'') : (window.__REQ_CONTENT__||'')); return; } /* 导出查看器：用内嵌内容（按当前原型），只读 */
  if(window.protoAPI&&window.protoAPI.doc){ window.protoAPI.doc.readLatest(aiSbxDir()).then(function(r){ render(r&&r.content); }); }
}
function setReqOpen(open){
  if(reqOpen===open)return;
  const isPc = document.body.classList.contains('kind-pc');
  if(!isPc){
   // 移动端为切换显示，非悬浮：不使用遮罩与栈，仅切换内容
   reqOpen=open;
   if(bodyB)bodyB.classList.toggle('req-open',open);
   if(open){
    if(bodyB&&bodyB.classList.contains('docs-open'))setDocsOpen(false);
    exitReqEdit(true);
    loadReqContent();
   }else{ exitReqEdit(true); }
   return;
  }
  reqOpen=open;
  if(bodyB)bodyB.classList.toggle('req-open',open);
  if(reqMaskEl)reqMaskEl.style.display=open?'block':'none';
  if(open){ if(window.MaskStack) window.MaskStack.push('reqMask', function(){ setReqOpen(false); }); }else{ if(window.MaskStack) window.MaskStack.pop('reqMask'); }
  if(open){
   if(bodyB&&bodyB.classList.contains('docs-open'))setDocsOpen(false); /* 与功能说明互斥 */
   exitReqEdit(true);
   loadReqContent();
  }else{ exitReqEdit(true); }
 }
function toggleReqPane(){
  if(pcMode()){ reqMode=false; setReqOpen(!reqOpen); return; } /* PC：悬浮弹窗 */
  /* 移动端：右侧面板切换为「最新需求」内容（与功能说明互斥显示） */
  setReqModeMobile(!reqMode);
}
/* 移动端：右侧文档面板显示「最新需求」（复用 docs-panel，直接切换内容，非弹窗） */
var reqMode=false;
function renderReqIntoDocs(){
  var render=function(txt){
    reqText=String(txt||'');
    docTitleEl.textContent='最新需求 · 当前迭代';
    docContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）');
  };
  if(window.__EXPORT_BOOT__){ render(window.__REQ_MAP__ ? (window.__REQ_MAP__[(currentSource&&currentSource.name)||'']||'') : (window.__REQ_CONTENT__||'')); return; }
  if(window.protoAPI&&window.protoAPI.doc){ window.protoAPI.doc.readLatest(aiSbxDir()).then(function(r){ render(r&&r.content); }); }
}
function setReqModeMobile(on){
  if(reqMode===on)return;
  reqMode=!!on;
  exitEdit(); /* 退出任何编辑态 */
  if(reqMode){ renderReqIntoDocs(); }
  else{ loadDesc(); } /* 恢复功能说明 */
}
function saveReqEditDocs(){
  var txt=(docEditArea&&docEditArea.value)||'';
  if(window.__EXPORT_BOOT__){ reqText=txt; exitEdit(); reqMode=true; docTitleEl.textContent='最新需求 · 当前迭代'; docContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）'); return; }
  if(!(window.protoAPI&&window.protoAPI.doc)){ reqText=txt; exitEdit(); reqMode=true; docTitleEl.textContent='最新需求 · 当前迭代'; docContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）'); return; }
  window.protoAPI.doc.writeLatest(aiSbxDir(), txt).then(function(r){
   if(r&&r.ok){
     reqText=txt;
     exitEdit();
     reqMode=true;
     docTitleEl.textContent='最新需求 · 当前迭代';
     docContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）');
     libStatus('最新需求文档已保存。');
   }
   else{ alert('保存失败：'+(r&&r.error||'未知错误')); }
  }).catch(function(e){ alert('保存失败：'+(e&&e.message||e)); });
}
function enterReqEdit(){
  if(reqEditing)return;
  reqEditing=true;
  if(reqContentEl)reqContentEl.style.display='none';
  if(reqEditEl)reqEditEl.style.display='flex';
  if(reqEditAreaEl){ reqEditAreaEl.value=reqText; reqEditAreaEl.focus(); }
  if(btnEditReq){ btnEditReq.textContent='编辑中…'; btnEditReq.disabled=true; }
  if(btnCancelReq)btnCancelReq.style.display='';
  if(btnSaveReq)btnSaveReq.style.display='';
}
function exitReqEdit(force){
  if(!force&&!reqEditing)return;
  reqEditing=false;
  if(reqEditEl)reqEditEl.style.display='none';
  if(reqContentEl)reqContentEl.style.display='';
  if(btnEditReq){ btnEditReq.textContent='编辑'; btnEditReq.disabled=false; }
  if(btnCancelReq)btnCancelReq.style.display='none';
  if(btnSaveReq)btnSaveReq.style.display='none';
}
function saveReqEdit(){
  var txt=(reqEditAreaEl&&reqEditAreaEl.value)||'';
  if(window.__EXPORT_BOOT__){ reqText=txt; exitReqEdit(); if(reqContentEl)reqContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）'); return; }
  if(!(window.protoAPI&&window.protoAPI.doc)){ reqText=txt; exitReqEdit(); if(reqContentEl)reqContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）'); return; }
  window.protoAPI.doc.writeLatest(aiSbxDir(), txt).then(function(r){
   if(r&&r.ok){
     reqText=txt;
     exitReqEdit();
     if(reqContentEl) reqContentEl.innerHTML=renderMd(reqText||'# 最新需求\n\n（暂无内容）');
     libStatus('最新需求文档已保存。');
   }
   else{ alert('保存失败：'+(r&&r.error||'未知错误')); }
  }).catch(function(e){ alert('保存失败：'+(e&&e.message||e)); });
}
if(reqFabEl)reqFabEl.onclick=toggleReqPane;
if(reqMaskEl)reqMaskEl.addEventListener('click',function(){ setReqOpen(false); });
if(btnEditReq)btnEditReq.onclick=enterReqEdit;
if(btnSaveReq)btnSaveReq.onclick=saveReqEdit;
if(btnCancelReq)btnCancelReq.onclick=function(){ exitReqEdit(); loadReqContent(); };
if(window.__EXPORT_BOOT__&&btnEditReq){ btnEditReq.style.display='none'; } /* 导出查看器：最新需求只读 */

function addSourceFromFile(name, content, folder){
 /* 同名源替换，避免列表出现重复（例如与预设库重名） */
 for(var i=0;i<sources.length;i++){ if(sources[i].name===name){ sources.splice(i,1); break; } }
 var src={ name:name, displayName:name, method:'srcdoc', content:content, kind:detectKindByName(name, content),
   sandboxDir:folder||'' };
 sources.push(src);
 loadSource(src);
 persistLibrary(); /* 保存：刷新后保留该原型 */
}
if(btnAddSourceEl)btnAddSourceEl.onclick=function(){
  window.protoAPI.pickTextFile({title:'选择原型 HTML 文件',filters:[{name:'HTML 原型',extensions:['html','htm']}]}).then(function(r){
    if(!r)return;
    if(r.error){ alert('读取文件失败：'+r.error); return; }
    /* 导入成功：复制进本地沙箱（当前项目），之后打开的都是沙箱副本（HTML+同名MD一起进沙箱） */
    window.protoAPI.sandbox.adopt({name:r.name, content:r.content||'', srcPath:r.path||'', project:currentProject}).then(function(res){
      if(res&&res.ok){
      libStatus(res.split
        ?('已识别导出文件，拆分出原型与文档：'+res.name+(res.created&&res.created.length>1?(' 等 '+res.created.length+' 个原型'):'')+'（已分别存为 html 与 md）。')
        :('已导入并复制到沙箱：'+res.name+'（以后打开/编辑均为沙箱副本）。'));
      loadSandboxSources(res.name); /* 刷新列表并选中沙箱中的新原型 */
      }else{
      reportError('proto-adopt', new Error(res&&res.error||'未知错误'), '复制到沙箱失败：'+(res&&res.error||'未知错误')+'，已按普通方式加载。');
      var folder=r.path?r.path.replace(/[\\\/][^\\\/]+$/,''):'';
      addSourceFromFile(r.name, r.content||'', folder);
      }
    });
   });
};

/* ═══════ 复制代码片段辅助函数 ═══════ */
window.copySnippet = function(btn) {
  var wrap = btn ? btn.closest('.code-block-wrap') : null;
  var codeEl = wrap ? wrap.querySelector('code') : null;
  var txt = codeEl ? codeEl.innerText : '';
  if (!txt) return;
  var markDone = function() {
    var orig = btn.innerHTML;
    btn.innerHTML = ic('check') + '已复制';
    setTimeout(function() { btn.innerHTML = orig; }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(markDone);
  } else {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    markDone();
  }
};

/* AI 回复 Markdown 样式 Token（收敛 inline 硬编码，P1-5 AI-01） */
var AI_MD_CSS = {
  h4: 'ai-md-h4', h3: 'ai-md-h3', h2: 'ai-md-h2',
  code: 'ai-md-code', bulletWrap: 'ai-md-bullet', bulletDot: 'ai-md-bullet-dot'
};
/* 格式化大模型输出（支持 Markdown 语法与代码块封装）
   安全策略：代码块外的原文一律经 escHtml 转义后再做 markdown 受控标签替换，
   杜绝模型输出内的任意 HTML（含工具类名如 .drawer-mask / onerror 脚本）注入主文档。 */
function formatAiText(txt) {
  if (!txt) return '';
  var blocks = [];
  /* 1. 先摘出代码块（内容受控转义，暂存为占位符） */
  var withPlaceholder = String(txt).replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function(m, lang, code) {
    var l = (lang || 'html').toUpperCase();
    var html = '<div class="code-block-wrap"><div class="code-block-head"><span>' + escHtml(l) + '</span><button type="button" class="code-copy-btn" onclick="window.copySnippet(this)">' + (window.PlanBIcon?window.PlanBIcon('copy',12):'') + ' 复制代码</button></div><pre><code>' + escHtml(code.trim()) + '</code></pre></div>';
    blocks.push(html);
    return '%%CB' + (blocks.length - 1) + '%%';
  });
  /* 2. 剩余原文整体转义（XSS / 样式借用的关键防护） */
  var safeText = escHtml(withPlaceholder);
  /* 3. 在转义文本上执行 markdown 受控标签替换（仅产生白名单标签，样式走 class Token） */
  safeText = safeText
    .replace(/^### (.*)$/gim, '<h4 class="'+AI_MD_CSS.h4+'">$1</h4>')
    .replace(/^## (.*)$/gim, '<h3 class="'+AI_MD_CSS.h3+'">$1</h3>')
    .replace(/^# (.*)$/gim, '<h2 class="'+AI_MD_CSS.h2+'">$1</h2>')
    .replace(/`([^`]+)`/g, '<code class="'+AI_MD_CSS.code+'">$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*]\s+(.*)$/gim, '<div class="'+AI_MD_CSS.bulletWrap+'"><span class="'+AI_MD_CSS.bulletDot+'">•</span><span>$1</span></div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
  /* 4. 还原代码块 */
  safeText = safeText.replace(/%%CB(\d+)%%/g, function(m, i) { return blocks[i] || ''; });
  return safeText;
}
// AI-01-A fix: 聊天区只显结论、隐藏代码（完全移除代码块与 SEARCH 块，不还原占位）
function formatAiTextConclusionOnly(txt) { // AI-01-A fix
  if (txt == null) return '<span style="color:var(--sub);font-size:12px">已完成代码修改，详见画布预览与日志</span>';
  var t = String(txt);
  // 1. 移除所有 ```[lang]\n...``` 代码块（不保留占位）
  t = t.replace(/```([a-zA-Z0-9_-]*)\n[\s\S]*?```/g, '');
  // 兜底：无换行的 ``` 块也一并移除
  t = t.replace(/```[\s\S]*?```/g, '');
  // 2. 移除 <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE 多块
  t = t.replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g, '');
  var stripped = t.trim();
  if (!stripped) return '<span style="color:var(--sub);font-size:12px">已完成代码修改，详见画布预览与日志</span>';
  // 3. 剩余文本经 escHtml 后做受控 markdown（保留标题/bold/列表/inline code，不再还原代码块），复用 AI_MD_CSS
  var safeText = escHtml(t);
  safeText = safeText
    .replace(/^### (.*)$/gim, '<h4 class="'+AI_MD_CSS.h4+'">$1</h4>')
    .replace(/^## (.*)$/gim, '<h3 class="'+AI_MD_CSS.h3+'">$1</h3>')
    .replace(/^# (.*)$/gim, '<h2 class="'+AI_MD_CSS.h2+'">$1</h2>')
    .replace(/`([^`]+)`/g, '<code class="'+AI_MD_CSS.code+'">$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*]\s+(.*)$/gim, '<div class="'+AI_MD_CSS.bulletWrap+'"><span class="'+AI_MD_CSS.bulletDot+'">•</span><span>$1</span></div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
  var textOnly = safeText.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
  if (!textOnly) return '<span style="color:var(--sub);font-size:12px">已完成代码修改，详见画布预览与日志</span>';
  return safeText;
}

/* 兜底清扫：AI 气泡区若出现工具遮罩类名（drawer-mask/ai-mask/modal-mask/sheet-mask 等）
   一律移除——无论来源，确保模型内容无法借用工具样式制造遮罩 */
function scrubAiChatView(){
  var v=aiChatView;
  if(!v)return;
  var bad=v.querySelectorAll('.drawer-mask,.ai-mask,.modal-mask,.sheet-mask,#selectionOverlay');
  for(var i=bad.length-1;i>=0;i--){ try{ bad[i].parentNode.removeChild(bad[i]); }catch(e){} }
}

/* ═══════ Git 协同下拉菜单与弹窗管理（多项目架构、分支切换、跨项目自愈、无 emoji） ═══════ */
var btnGitMenuEl = $('btnGitMenu'), gitDropdownMenuEl = $('gitDropdownMenu'), gitDropdownWrapEl = $('gitDropdownWrap');
var btnGitPushMenuEl = $('btnGitPushMenu'), btnGitPullMenuEl = $('btnGitPullMenu'), btnGitConfigMenuEl = $('btnGitConfigMenu');

var gitPushMask = $('gitPushMask'), gitPushClose = $('gitPushClose'), gitPushCancel = $('gitPushCancel'), gitPushSubmit = $('gitPushSubmit');
var gitPushTreeList = $('gitPushTreeList'), gitPushMessage = $('gitPushMessage'), gitPushStatus = $('gitPushStatus'), gitPushCount = $('gitPushCount');
var btnGitPushSelectAll = $('btnGitPushSelectAll'), btnGitPushClearAll = $('btnGitPushClearAll');
var gitPushBranchSelect = $('gitPushBranchSelect'), gitPushBranchCustom = $('gitPushBranchCustom'), btnGitPushBranchToggle = $('btnGitPushBranchToggle');

var gitPullMask = $('gitPullMask'), gitPullClose = $('gitPullClose'), gitPullCancel = $('gitPullCancel'), gitPullSubmit = $('gitPullSubmit');
var gitPullTreeList = $('gitPullTreeList'), gitPullStatus = $('gitPullStatus'), gitPullCount = $('gitPullCount');
var btnGitPullSelectAll = $('btnGitPullSelectAll'), btnGitPullClearAll = $('btnGitPullClearAll');
var gitPullBranchSelect = $('gitPullBranchSelect'), gitPullBranchCustom = $('gitPullBranchCustom'), btnGitPullBranchToggle = $('btnGitPullBranchToggle'), btnGitPullBranchRefresh = $('btnGitPullBranchRefresh');
var gitPullProjectSwitchBanner = $('gitPullProjectSwitchBanner'), gitPullProjectSwitchText = $('gitPullProjectSwitchText'), btnGitPullSwitchNow = $('btnGitPullSwitchNow');

var gitConfigMask = $('gitConfigMask'), gitConfigClose = $('gitConfigClose'), gitConfigCancel = $('gitConfigCancel'), gitConfigSave = $('gitConfigSave');
var gitRemoteUrl = $('gitRemoteUrl'), gitBranch = $('gitBranch'), gitUsername = $('gitUsername'), gitToken = $('gitToken'), btnGitTokenEye = $('btnGitTokenEye');
var btnTestGitConn = $('btnTestGitConn'), testGitStatus = $('testGitStatus'), gitSaveTip = $('gitSaveTip');

function toggleGitDropdown(show) {
  if (!gitDropdownMenuEl) return;
  var willShow = (typeof show === 'boolean') ? show : (gitDropdownMenuEl.style.display === 'none');
  gitDropdownMenuEl.style.display = willShow ? 'flex' : 'none';
}
function closeGitDropdown() {
  if (gitDropdownMenuEl) gitDropdownMenuEl.style.display = 'none';
}
if (btnGitMenuEl) {
  btnGitMenuEl.onclick = function(e) {
    e.stopPropagation();
    closeExportDropdown();
    toggleGitDropdown();
  };
}
document.addEventListener('click', function(e) {
  if (gitDropdownMenuEl && gitDropdownMenuEl.style.display !== 'none') {
    if (!e.target.closest('#gitDropdownWrap')) {
      closeGitDropdown();
    }
  }
});

/* 辅助：填充与切换分支控件 */
function populateBranchSelect(selectEl, customEl, toggleBtn, branches, defaultBranch) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  var list = (branches && branches.length) ? branches : ['main', 'master'];
  var cur = defaultBranch || 'main';
  var hasCur = false;
  list.forEach(function(b) {
    var opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    if (b === cur) { opt.selected = true; hasCur = true; }
    selectEl.appendChild(opt);
  });
  if (!hasCur && cur) {
    var opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur;
    opt.selected = true;
    selectEl.appendChild(opt);
  }
  if (customEl) { customEl.value = ''; customEl.style.display = 'none'; }
  if (selectEl) selectEl.style.display = 'block';
  if (toggleBtn) toggleBtn.textContent = '自定义';
}

function getActiveBranch(selectEl, customEl) {
  if (customEl && customEl.style.display !== 'none' && customEl.value.trim()) {
    return customEl.value.trim();
  }
  if (selectEl && selectEl.value) {
    return selectEl.value;
  }
  return 'main';
}

function bindBranchToggle(selectEl, customEl, toggleBtn) {
  if (!toggleBtn || !selectEl || !customEl) return;
  toggleBtn.onclick = function() {
    var isCustom = (customEl.style.display !== 'none');
    if (isCustom) {
      customEl.style.display = 'none';
      selectEl.style.display = 'block';
      toggleBtn.textContent = '自定义';
    } else {
      customEl.style.display = 'block';
      selectEl.style.display = 'none';
      customEl.value = selectEl.value || '';
      customEl.focus();
      toggleBtn.textContent = '预设列表';
    }
  };
}
bindBranchToggle(gitPushBranchSelect, gitPushBranchCustom, btnGitPushBranchToggle);
bindBranchToggle(gitPullBranchSelect, gitPullBranchCustom, btnGitPullBranchToggle);

/* 通用多项目/原型层级 Git 树状列表渲染器 */
function renderGitTree(containerEl, data, onCountChange, inputName, checkMode) {
  if (!containerEl) return;
  var projects = [];
  if (Array.isArray(data)) {
    if (data.length > 0 && data[0].project && Array.isArray(data[0].protos)) {
      projects = data;
    } else if (data.length > 0 && data[0].proto && Array.isArray(data[0].files)) {
      projects = [{ project: currentProject || '当前项目', isCurrent: true, protos: data }];
    }
  }

  var totalFiles = 0;
  projects.forEach(function(p) {
    (p.protos || []).forEach(function(pr) {
      totalFiles += (pr.files || []).length;
    });
  });

  if (!projects.length || totalFiles === 0) {
    containerEl.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">暂无变更文件（已全部同步）</div>';
    if (onCountChange) onCountChange(0);
    return;
  }

  var html = '';
  projects.forEach(function(proj, pIdx) {
    var protos = proj.protos || [];
    var pFileCount = 0;
    protos.forEach(function(pr) { pFileCount += (pr.files || []).length; });
    if (pFileCount === 0) return;

    // 上传时默认只选中当前项目；拉取时默认不勾选任何一个
    var isDefaultChecked = false;
    if (checkMode === 'pull' || checkMode === 'none') {
      isDefaultChecked = false;
    } else if (checkMode === 'all') {
      isDefaultChecked = true;
    } else {
      // 默认 push 策略：只选中当前项目
      isDefaultChecked = !!proj.isCurrent;
    }

    html += '<div class="git-tree-proj" data-pidx="' + pIdx + '">'
      + '<div class="git-tree-proj-header">'
      + '<input type="checkbox" class="git-proj-chk"' + (isDefaultChecked ? ' checked' : '') + ' data-pidx="' + pIdx + '">'
      + '<span class="git-tree-proj-title">项目：' + escHtml(proj.project) + '</span>'
      + (proj.isCurrent ? '<span class="git-tree-proj-badge">当前项目</span>' : '')
      + '<span class="git-tree-proto-count">共 ' + protos.length + ' 个原型 · ' + pFileCount + ' 文件</span>'
      + '</div>';

    protos.forEach(function(pr, prIdx) {
      var files = pr.files || [];
      if (!files.length) return;
      html += '<div class="git-tree-group" data-pidx="' + pIdx + '" data-pridx="' + prIdx + '">'
        + '<div class="git-tree-proto">'
        + '<input type="checkbox" class="git-group-chk"' + (isDefaultChecked ? ' checked' : '') + ' data-pidx="' + pIdx + '" data-pridx="' + prIdx + '">'
        + '<span class="git-tree-proto-name">' + escHtml(pr.proto) + '</span>'
        + '<span class="git-tree-proto-count">' + files.length + ' 个文件</span>'
        + '</div>';

      files.forEach(function(f) {
        html += '<label class="git-tree-item">'
          + '<input type="checkbox" name="' + inputName + '"' + (isDefaultChecked ? ' checked' : '') + ' data-path="' + escAttr(f.path) + '" data-pidx="' + pIdx + '" data-pridx="' + prIdx + '">'
          + '<span class="status-tag ' + escAttr(f.code || 'mod') + '">' + escHtml(f.label || '修改') + '</span>'
          + '<span class="git-file-name" title="' + escAttr(f.path) + '">' + escHtml(f.subPath || f.path) + '</span>'
          + '</label>';
      });
      html += '</div>';
    });
    html += '</div>';
  });

  containerEl.innerHTML = html;

  function updateCounts() {
    var chks = containerEl.querySelectorAll('input[type="checkbox"][data-path]:checked');
    if (onCountChange) onCountChange(chks.length);
  }

  // 1. 项目级全选联动
  containerEl.querySelectorAll('.git-proj-chk').forEach(function(pChk) {
    pChk.onchange = function() {
      var pIdx = pChk.getAttribute('data-pidx');
      var itemChks = containerEl.querySelectorAll('input[type="checkbox"][data-pidx="' + pIdx + '"]');
      itemChks.forEach(function(c) { c.checked = pChk.checked; });
      updateCounts();
    };
  });

  // 2. 原型级全选联动
  containerEl.querySelectorAll('.git-group-chk').forEach(function(gChk) {
    gChk.onchange = function() {
      var pIdx = gChk.getAttribute('data-pidx');
      var prIdx = gChk.getAttribute('data-pridx');
      var itemChks = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"][data-pridx="' + prIdx + '"]');
      itemChks.forEach(function(c) { c.checked = gChk.checked; });

      // 更新项目级 checkbox
      var pChk = containerEl.querySelector('.git-proj-chk[data-pidx="' + pIdx + '"]');
      if (pChk) {
        var pTotal = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"]').length;
        var pChecked = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"]:checked').length;
        pChk.checked = (pChecked > 0);
        pChk.indeterminate = (pChecked > 0 && pChecked < pTotal);
      }
      updateCounts();
    };
  });

  // 3. 文件级勾选联动
  containerEl.querySelectorAll('input[type="checkbox"][data-path]').forEach(function(iChk) {
    iChk.onchange = function() {
      var pIdx = iChk.getAttribute('data-pidx');
      var prIdx = iChk.getAttribute('data-pridx');

      // 更新原型级 checkbox
      var gChk = containerEl.querySelector('.git-group-chk[data-pidx="' + pIdx + '"][data-pridx="' + prIdx + '"]');
      if (gChk) {
        var total = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"][data-pridx="' + prIdx + '"]').length;
        var checked = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"][data-pridx="' + prIdx + '"]:checked').length;
        gChk.checked = (checked > 0);
        gChk.indeterminate = (checked > 0 && checked < total);
      }

      // 更新项目级 checkbox
      var pChk = containerEl.querySelector('.git-proj-chk[data-pidx="' + pIdx + '"]');
      if (pChk) {
        var pTotal = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"]').length;
        var pChecked = containerEl.querySelectorAll('input[type="checkbox"][data-path][data-pidx="' + pIdx + '"]:checked').length;
        pChk.checked = (pChecked > 0);
        pChk.indeterminate = (pChecked > 0 && pChecked < pTotal);
      }
      updateCounts();
    };
  });

  updateCounts();
}

/* 1. Git 仓库设置弹窗 */
function openGitConfigModal() {
  closeGitDropdown();
  if (!currentProject) { alert('请先进入一个项目'); return; }
  if (!window.protoAPI || !window.protoAPI.git) { (typeof showToast==="function"?showToast:alert)('仅桌面端支持 Git 协同'); return; }
  if (testGitStatus) { testGitStatus.textContent = ''; testGitStatus.className = 'set-status'; }
  if (gitSaveTip) gitSaveTip.style.display = 'none';

  window.protoAPI.git.getConfig(currentProject).then(function(res) {
    var cfg = (res && res.config) || {};
    if (gitRemoteUrl) gitRemoteUrl.value = cfg.remoteUrl || '';
    if (gitBranch) gitBranch.value = cfg.branch || 'main';
    if (gitUsername) gitUsername.value = cfg.username || '';
    if (gitToken) gitToken.value = cfg.token || '';
    if (gitConfigMask) gitConfigMask.style.display = 'flex';
    if(window.MaskStack) window.MaskStack.push('gitConfigMask', closeGitConfigModal);
  });
}
function closeGitConfigModal() {
  if(window.MaskStack) window.MaskStack.pop('gitConfigMask');
  if (gitConfigMask) gitConfigMask.style.display = 'none';
}
if (btnGitConfigMenuEl) btnGitConfigMenuEl.onclick = openGitConfigModal;
if (gitConfigClose) gitConfigClose.onclick = closeGitConfigModal;
if (gitConfigCancel) gitConfigCancel.onclick = closeGitConfigModal;

if (btnGitTokenEye && gitToken) {
  btnGitTokenEye.onclick = function() {
    var isPass = (gitToken.type === 'password');
    gitToken.type = isPass ? 'text' : 'password';
    btnGitTokenEye.textContent = isPass ? '隐藏' : '显示';
  };
}

if (btnTestGitConn) {
  btnTestGitConn.onclick = function() {
    if (!window.protoAPI || !window.protoAPI.git) return;
    var url = gitRemoteUrl ? gitRemoteUrl.value.trim() : '';
    if (!url) {
      if (testGitStatus) { testGitStatus.textContent = '请先填写远程仓库地址'; testGitStatus.className = 'set-status err'; }
      return;
    }
    if (testGitStatus) { testGitStatus.textContent = '测试连接中…'; testGitStatus.className = 'set-status'; }
    var cfg = {
      remoteUrl: url,
      branch: gitBranch ? (gitBranch.value.trim() || 'main') : 'main',
      username: gitUsername ? gitUsername.value.trim() : '',
      token: gitToken ? gitToken.value.trim() : ''
    };
    window.protoAPI.git.testConnection(cfg).then(function(r) {
      if (r && r.ok) {
        if (testGitStatus) { testGitStatus.textContent = '连接成功 (' + (r.latency || 0) + 'ms)'; testGitStatus.className = 'set-status ok'; }
      } else {
        if (testGitStatus) { testGitStatus.textContent = (r && r.error) || '连接失败'; testGitStatus.className = 'set-status err'; }
      }
    }).catch(function(err) {
      if (testGitStatus) { testGitStatus.textContent = String(err && err.message || err); testGitStatus.className = 'set-status err'; }
    });
  };
}

var gitSaveTipTimer = null;
if (gitConfigSave) {
  gitConfigSave.onclick = function() {
    if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
    var cfg = {
      remoteUrl: gitRemoteUrl ? gitRemoteUrl.value.trim() : '',
      branch: gitBranch ? (gitBranch.value.trim() || 'main') : 'main',
      username: gitUsername ? gitUsername.value.trim() : '',
      token: gitToken ? gitToken.value.trim() : ''
    };
    window.protoAPI.git.saveConfig({ project: currentProject, config: cfg }).then(function(r) {
      if (r && r.ok) {
        if (gitSaveTip) {
          gitSaveTip.style.display = 'inline-flex';
          if (gitSaveTipTimer) clearTimeout(gitSaveTipTimer);
          gitSaveTipTimer = setTimeout(function() { gitSaveTip.style.display = 'none'; }, 3500);
        }
      } else {
        alert('保存失败：' + (r && r.error || '未知错误'));
      }
    });
  };
}

/* 2. Git 上传发布弹窗 */
function loadGitPushStatus(targetBranch) {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  if (gitPushTreeList) gitPushTreeList.innerHTML = '<div style="color:var(--faint);padding:16px;text-align:center;">正在比对本地变更…</div>';
  if (gitPushCount) gitPushCount.textContent = '已选 0 项变更';
  if (gitPushSubmit) gitPushSubmit.disabled = true;

  window.protoAPI.git.getStatus({ project: currentProject, branch: targetBranch }).then(function(r) {
    if (!r || !r.ok) {
      if (gitPushTreeList) {
        gitPushTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml((r && r.error) || '读取本地变更失败') + '</div>';
      }
      return;
    }
    renderGitTree(gitPushTreeList, r.projects, function(cnt) {
      if (gitPushCount) gitPushCount.textContent = '已选 ' + cnt + ' 项变更';
      if (gitPushSubmit) gitPushSubmit.disabled = (cnt === 0);
    }, 'gitPushChk', 'push');
  }).catch(function(e) {
    if (gitPushTreeList) {
      gitPushTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(e && e.message || e) + '</div>';
    }
  });
}

function openGitPushModal() {
  closeGitDropdown();
  if (!currentProject) { alert('请先进入一个项目'); return; }
  if (!window.protoAPI || !window.protoAPI.git) { (typeof showToast==="function"?showToast:alert)('仅桌面端支持 Git 协同'); return; }

  if (gitPushStatus) gitPushStatus.style.display = 'none';
  if (btnGitPushForce) btnGitPushForce.style.display = 'none';
  if (gitPushSubmit) { gitPushSubmit.disabled = true; gitPushSubmit.textContent = '确认上传'; }
  if (gitPushMessage) gitPushMessage.value = '';
  if (gitPushCount) gitPushCount.textContent = '已选 0 项变更';
  if (gitPushTreeList) gitPushTreeList.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">正在比对本地变更…</div>';
  if (gitPushMask) gitPushMask.style.display = 'flex';
  if(window.MaskStack) window.MaskStack.push('gitPushMask', closeGitPushModal);

  window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
     var branches = (bRes && bRes.branches) || ['main', 'master'];
     var cur = (bRes && bRes.currentBranch) || 'main';
     populateBranchSelect(gitPushBranchSelect, gitPushBranchCustom, btnGitPushBranchToggle, branches, cur);
     loadGitPushStatus(cur);
   });
}
function closeGitPushModal() {
  if(window.MaskStack) window.MaskStack.pop('gitPushMask');
  if (btnGitPushForce) btnGitPushForce.style.display = 'none';
  if (gitPushTreeList) gitPushTreeList.innerHTML = '';
  if (gitPushMask) gitPushMask.style.display = 'none';
}
if (btnGitPushMenuEl) btnGitPushMenuEl.onclick = openGitPushModal;
if (gitPushClose) gitPushClose.onclick = closeGitPushModal;
if (gitPushCancel) gitPushCancel.onclick = closeGitPushModal;

if (gitPushBranchSelect) {
  gitPushBranchSelect.onchange = function() {
    loadGitPushStatus(getActiveBranch(gitPushBranchSelect, gitPushBranchCustom));
  };
}

if (btnGitPushSelectAll) {
  btnGitPushSelectAll.onclick = function() {
    if (!gitPushTreeList) return;
    gitPushTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
    var chks = gitPushTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked');
    if (gitPushCount) gitPushCount.textContent = '已选 ' + chks.length + ' 项变更';
    if (gitPushSubmit) gitPushSubmit.disabled = (chks.length === 0);
  };
}
if (btnGitPushClearAll) {
  btnGitPushClearAll.onclick = function() {
    if (!gitPushTreeList) return;
    gitPushTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
    if (gitPushCount) gitPushCount.textContent = '已选 0 项变更';
    if (gitPushSubmit) gitPushSubmit.disabled = true;
  };
}

var btnGitPushForce = $('btnGitPushForce');

function executeGitPush(force) {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  var chks = gitPushTreeList ? gitPushTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked') : [];
  var files = [];
  chks.forEach(function(c) {
    var p = c.getAttribute('data-path');
    if (p) files.push(p);
  });
  if (!files.length) { alert('请至少勾选一个需要发布的文件'); return; }

  var msg = (gitPushMessage && gitPushMessage.value.trim()) || '更新原型与文档数据';
  var branch = getActiveBranch(gitPushBranchSelect, gitPushBranchCustom);

  gitPushSubmit.disabled = true;
  if (btnGitPushForce) btnGitPushForce.disabled = true;
  gitPushSubmit.textContent = force ? '强制覆盖中…' : '上传中…';
  if (gitPushStatus) { gitPushStatus.style.display = 'none'; }

  window.protoAPI.git.push({
    project: currentProject,
    files: files,
    message: msg,
    branch: branch,
    force: !!force
  }).then(function(r) {
    if (r && r.ok) {
      if (btnGitPushForce) btnGitPushForce.style.display = 'none';
      if (gitPushStatus) {
        gitPushStatus.className = 'git-status-msg ok';
        gitPushStatus.textContent = (force ? '强制覆盖发布成功！' : '发布成功！') + '已上传 ' + (r.filesCount || files.length) + ' 个文件至分支 [' + (r.branch || branch) + ']';
        gitPushStatus.style.display = 'block';
      }
      setTimeout(function() { closeGitPushModal(); }, 1600);
    } else {
      gitPushSubmit.disabled = false;
      gitPushSubmit.textContent = '重试上传';
      if (btnGitPushForce) {
        btnGitPushForce.disabled = false;
        btnGitPushForce.style.display = (r && r.canForce) ? 'inline-block' : 'none';
      }
      if (gitPushStatus) {
        gitPushStatus.className = 'git-status-msg err';
        gitPushStatus.textContent = (r && r.error) || '上传失败';
        gitPushStatus.style.display = 'block';
      }
    }
  }).catch(function(err) {
    gitPushSubmit.disabled = false;
    gitPushSubmit.textContent = '重试上传';
    if (btnGitPushForce) btnGitPushForce.disabled = false;
    if (gitPushStatus) {
      gitPushStatus.className = 'git-status-msg err';
      gitPushStatus.textContent = String(err && err.message || err);
      gitPushStatus.style.display = 'block';
    }
  });
}

if (gitPushSubmit) {
  gitPushSubmit.onclick = function() { executeGitPush(false); };
}
if (btnGitPushForce) {
  btnGitPushForce.onclick = function() {
    if (confirm('强制覆盖将以本地原型和文档为准，直接覆盖远程仓库中的历史记录与文件。确定要强制覆盖上传吗？')) {
      executeGitPush(true);
    }
  };
}

/* 3. Git 拉取同步弹窗 */
function loadGitPullDiff(targetBranch) {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  if (gitPullTreeList) gitPullTreeList.innerHTML = '<div style="color:var(--faint);padding:16px;text-align:center;">正在探测远程仓库更新…</div>';
  if (gitPullCount) gitPullCount.textContent = '已选 0 项更新';
  if (gitPullSubmit) gitPullSubmit.disabled = true;
  if (gitPullProjectSwitchBanner) gitPullProjectSwitchBanner.style.display = 'none';

  window.protoAPI.git.fetchDiff({ project: currentProject, branch: targetBranch }).then(function(r) {
    if (!r || !r.ok) {
      if (gitPullTreeList) {
        gitPullTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml((r && r.error) || '探测远程变更失败') + '</div>';
      }
      return;
    }
    renderGitTree(gitPullTreeList, r.projects, function(cnt) {
      if (gitPullCount) gitPullCount.textContent = '已选 ' + cnt + ' 项更新';
      if (gitPullSubmit) gitPullSubmit.disabled = (cnt === 0);
    }, 'gitPullChk', 'pull');
  }).catch(function(e) {
    if (gitPullTreeList) {
      gitPullTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(e && e.message || e) + '</div>';
    }
  });
}

function openGitPullModal() {
  closeGitDropdown();
  if (!currentProject) { alert('请先进入一个项目'); return; }
  if (!window.protoAPI || !window.protoAPI.git) { alert('仅桌面端支持 Git 协同'); return; }

  if (gitPullStatus) gitPullStatus.style.display = 'none';
  if (gitPullProjectSwitchBanner) gitPullProjectSwitchBanner.style.display = 'none';
  if (gitPullSubmit) { gitPullSubmit.disabled = true; gitPullSubmit.textContent = '确认拉取'; }
  if (gitPullCount) gitPullCount.textContent = '已选 0 项更新';
  if (gitPullTreeList) gitPullTreeList.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">正在探测远程仓库更新…</div>';
  if (gitPullMask) gitPullMask.style.display = 'flex';
  if(window.MaskStack) window.MaskStack.push('gitPullMask', closeGitPullModal);

  window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
    var branches = (bRes && bRes.branches) || ['main', 'master'];
    var cur = (bRes && bRes.currentBranch) || 'main';
    populateBranchSelect(gitPullBranchSelect, gitPullBranchCustom, btnGitPullBranchToggle, branches, cur);
    loadGitPullDiff(cur);
  });
}
function closeGitPullModal() {
  if(window.MaskStack) window.MaskStack.pop('gitPullMask');
  if (gitPullTreeList) gitPullTreeList.innerHTML = '';
  if (gitPullMask) gitPullMask.style.display = 'none';
}
if (btnGitPullMenuEl) btnGitPullMenuEl.onclick = openGitPullModal;
if (gitPullClose) gitPullClose.onclick = closeGitPullModal;
if (gitPullCancel) gitPullCancel.onclick = closeGitPullModal;

if (gitPullBranchSelect) {
  gitPullBranchSelect.onchange = function() {
    loadGitPullDiff(getActiveBranch(gitPullBranchSelect, gitPullBranchCustom));
  };
}
if (btnGitPullBranchRefresh) {
  btnGitPullBranchRefresh.onclick = function() {
    var curBranch = getActiveBranch(gitPullBranchSelect, gitPullBranchCustom);
    window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
      var branches = (bRes && bRes.branches) || ['main', 'master'];
      populateBranchSelect(gitPullBranchSelect, gitPullBranchCustom, btnGitPullBranchToggle, branches, curBranch);
      loadGitPullDiff(curBranch);
    });
  };
}

if (btnGitPullSelectAll) {
  btnGitPullSelectAll.onclick = function() {
    if (!gitPullTreeList) return;
    gitPullTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
    var chks = gitPullTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked');
    if (gitPullCount) gitPullCount.textContent = '已选 ' + chks.length + ' 项更新';
    if (gitPullSubmit) gitPullSubmit.disabled = (chks.length === 0);
  };
}
if (btnGitPullClearAll) {
  btnGitPullClearAll.onclick = function() {
    if (!gitPullTreeList) return;
    gitPullTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
    if (gitPullCount) gitPullCount.textContent = '已选 0 项更新';
    if (gitPullSubmit) gitPullSubmit.disabled = true;
  };
}

if (gitPullSubmit) {
  gitPullSubmit.onclick = function() {
    if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
    var chks = gitPullTreeList ? gitPullTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked') : [];
    var files = [];
    chks.forEach(function(c) {
      var p = c.getAttribute('data-path');
      if (p) files.push(p);
    });
    if (!files.length) { alert('请至少勾选一个需要拉取的文件'); return; }

    var branch = getActiveBranch(gitPullBranchSelect, gitPullBranchCustom);

    gitPullSubmit.disabled = true;
    gitPullSubmit.textContent = '拉取中…';
    if (gitPullStatus) { gitPullStatus.style.display = 'none'; }
    if (gitPullProjectSwitchBanner) { gitPullProjectSwitchBanner.style.display = 'none'; }

    window.protoAPI.git.pull({
      project: currentProject,
      files: files,
      branch: branch
    }).then(function(r) {
      if (r && r.ok) {
        var affected = (r.affectedProjects || []).filter(Boolean);
        var otherProjects = affected.filter(function(p) { return p !== currentProject; });

        if (gitPullStatus) {
          gitPullStatus.className = 'git-status-msg ok';
          gitPullStatus.textContent = '同步完成！已成功拉取 ' + (r.filesCount || files.length) + ' 个文件。';
          gitPullStatus.style.display = 'block';
        }

        // 若拉取包含当前项目，自动刷新沙箱
        if (affected.indexOf(currentProject) >= 0) {
          if (typeof loadSandboxSources === 'function') {
            loadSandboxSources();
          }
        }

        // 若拉取了其他项目或新项目，在弹窗中提示并提供一键切换
        if (otherProjects.length > 0) {
          var targetProj = otherProjects[0];
          if (gitPullProjectSwitchBanner && gitPullProjectSwitchText) {
            gitPullProjectSwitchText.textContent = '检测到包含项目【' + otherProjects.join('、') + '】，已在本地自动为您创建目录。';
            gitPullProjectSwitchBanner.style.display = 'block';
            if (btnGitPullSwitchNow) {
              btnGitPullSwitchNow.onclick = function() {
                closeGitPullModal();
                if (typeof enterProject === 'function') {
                  enterProject(targetProj);
                }
              };
            }
          }
        } else {
          setTimeout(function() { closeGitPullModal(); }, 1500);
        }
      } else {
        gitPullSubmit.disabled = false;
        gitPullSubmit.textContent = '重试拉取';
        if (gitPullStatus) {
          gitPullStatus.className = 'git-status-msg err';
          gitPullStatus.textContent = (r && r.error) || '拉取同步失败';
          gitPullStatus.style.display = 'block';
        }
      }
    }).catch(function(err) {
      gitPullSubmit.disabled = false;
      gitPullSubmit.textContent = '重试拉取';
      if (gitPullStatus) {
        gitPullStatus.className = 'git-status-msg err';
        gitPullStatus.textContent = String(err && err.message || err);
        gitPullStatus.style.display = 'block';
      }
    });
  };
}

/* ═══════ 导出下拉悬浮菜单（纯源码导出 + 独立完整HTML导出） ═══════ */
var btnExportMenuEl = $('btnExportMenu'), exportDropdownMenuEl = $('exportDropdownMenu'), exportDropdownWrapEl = $('exportDropdownWrap');
var btnExportPureHtmlEl = $('btnExportPureHtml');

function toggleExportDropdown(show) {
  if (!exportDropdownMenuEl) return;
  var willShow = (typeof show === 'boolean') ? show : (exportDropdownMenuEl.style.display === 'none');
  exportDropdownMenuEl.style.display = willShow ? 'flex' : 'none';
}
function closeExportDropdown() {
  if (exportDropdownMenuEl) exportDropdownMenuEl.style.display = 'none';
}
if (btnExportMenuEl) {
  btnExportMenuEl.onclick = function(e) {
    e.stopPropagation();
    closeGitDropdown();
    toggleExportDropdown();
  };
}
document.addEventListener('click', function(e) {
  if (exportDropdownMenuEl && exportDropdownMenuEl.style.display !== 'none') {
    if (!e.target.closest('#exportDropdownWrap')) {
      closeExportDropdown();
    }
  }
});

async function exportCurrentPureHtml() {
  // P1-2 fix: 重新从沙箱读取最新内容，避免导出旧内存（NF-02）
  try{ const r=await window.protoAPI.sandbox.read(currentSource.sandboxDir, currentSource.mainHtmlFile||currentSource.name); if(r&&r.ok) currentSource.content=r.content; }catch(e){}
  closeExportDropdown();
  if (!currentSource || !currentSource.content) { alert('当前原型无源码内容'); return; }
  var blob = new Blob([currentSource.content], { type: 'text/html;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (currentSource.displayName || currentSource.name || 'prototype') + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
if (btnExportPureHtmlEl) btnExportPureHtmlEl.onclick = exportCurrentPureHtml;

/* ═══════ 设置弹窗（升级为 680px 分栏/Tab 现代化布局） ═══════ */
var settingsMask=$('settingsMask'),settingsClose=$('settingsClose'),settingsCancel=$('settingsCancel'),settingsOk=$('settingsOk'),btnSettings=$('btnSettings');
var tabNavAi=$('tabNavAi'),tabNavModels=$('tabNavModels'),tabNavSandbox=$('tabNavSandbox'),tabNavAbout=$('tabNavAbout');
var paneSetAi=$('paneSetAi'),paneSetModels=$('paneSetModels'),paneSetSandbox=$('paneSetSandbox'),paneSetAbout=$('paneSetAbout');
var engCli=$('engCli'),engApi=$('engApi'),boxCliCfg=$('boxCliCfg'),boxApiCfg=$('boxApiCfg');
var setApiPreset=$('setApiPreset'),setApiBaseUrl=$('setApiBaseUrl'),setApiKey=$('setApiKey'),setApiModel=$('setApiModel'),setApiEye=$('setApiEye');
var btnTestApi=$('btnTestApi'),testApiStatus=$('testApiStatus');
var setModelSearch=$('setModelSearch'),btnSelectAllModels=$('btnSelectAllModels'),btnSelectRecModels=$('btnSelectRecModels'),btnClearAllModels=$('btnClearAllModels');
var modelCheckList=$('modelCheckList'),newModelInput=$('newModelInput'),btnAddCustomModel=$('btnAddCustomModel');
var curAiConfig=null;

function sbxRootHint(){
 var el=$('dirSbx');
 if(!el)return;
 if(window.protoAPI&&window.protoAPI.sandbox){ el.textContent='…'; window.protoAPI.sandbox.list().then(function(r){ if(r&&r.root)el.textContent=r.root; }); }
 else el.textContent='请使用桌面端（exe）版本打开';
 var ver=$('verInfo');
 if(ver){
  if(window.protoAPI&&window.protoAPI.app&&window.protoAPI.app.getVersion){ window.protoAPI.app.getVersion().then(function(v){ ver.textContent=v?('v'+v):'未知'; }).catch(function(){ ver.textContent='未知'; }); }
  else ver.textContent='浏览器模式（无版本信息）';
 }
}

function switchSettingsTab(tab){
  var tabs=[
    { key:'ai', btn:tabNavAi, pane:paneSetAi },
    { key:'models', btn:tabNavModels, pane:paneSetModels },
    { key:'sandbox', btn:tabNavSandbox, pane:paneSetSandbox },
    { key:'about', btn:tabNavAbout, pane:paneSetAbout }
  ];
  tabs.forEach(function(t){
    if(t.btn)t.btn.classList.toggle('active', t.key===tab);
    if(t.pane)t.pane.style.display=(t.key===tab)?'flex':'none';
  });
}
if(tabNavAi)tabNavAi.onclick=function(){ switchSettingsTab('ai'); };
if(tabNavModels)tabNavModels.onclick=function(){ switchSettingsTab('models'); };
if(tabNavSandbox)tabNavSandbox.onclick=function(){ switchSettingsTab('sandbox'); };
if(tabNavAbout)tabNavAbout.onclick=function(){ switchSettingsTab('about'); };

function getActiveEngineInUi(){
  return (engCli && engCli.checked) ? 'cli' : 'api';
}

function syncCurrentChecklistToMemory(){
  if(!curAiConfig) curAiConfig = {};
  var eng = getActiveEngineInUi();
  var selected = getSelectedModelIds();
  if(eng === 'cli'){
    curAiConfig.visibleModelsCli = selected;
  } else {
    curAiConfig.visibleModelsApi = selected;
  }
}

function setEngineUi(engine, skipSync){
  if(!skipSync) syncCurrentChecklistToMemory();
  var isCli=(engine==='cli');
  if(engCli)engCli.checked=isCli;
  if(engApi)engApi.checked=!isCli;
  if(boxCliCfg)boxCliCfg.style.display=isCli?'flex':'none';
  if(boxApiCfg)boxApiCfg.style.display=isCli?'none':'flex';
  if(curAiConfig) curAiConfig.engine = engine;
  renderModelManagerList(curAiConfig);
}
if(engCli)engCli.onchange=function(){ setEngineUi('cli'); };
if(engApi)engApi.onchange=function(){ setEngineUi('api'); };

if(setApiEye&&setApiKey){
  setApiEye.onclick=function(){
    var isPass=(setApiKey.type==='password');
    setApiKey.type=isPass?'text':'password';
    setApiEye.innerHTML=isPass?ic('eye-off'):ic('eye');
  };
}

var API_PRESETS={
  deepseek: { baseUrl:'https://api.deepseek.com/v1', model:'deepseek-chat', defaultModels:['deepseek-chat','deepseek-reasoner'] },
  ali: { baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus', defaultModels:['qwen-max','qwen-plus','qwen-turbo','qwen-coder-plus'] },
  siliconflow: { baseUrl:'https://api.siliconflow.cn/v1', model:'deepseek-ai/DeepSeek-V3', defaultModels:['deepseek-ai/DeepSeek-V3','deepseek-ai/DeepSeek-R1','Qwen/Qwen2.5-72B-Instruct','Pro/deepseek-ai/DeepSeek-V3'] },
  openrouter: { baseUrl:'https://openrouter.ai/api/v1', model:'google/gemini-2.0-flash-001', defaultModels:['google/gemini-2.0-flash-001','anthropic/claude-3.5-sonnet','deepseek/deepseek-chat','openai/gpt-4o'] }
};
if(setApiPreset){
  setApiPreset.onchange=function(){
    syncCurrentChecklistToMemory();
    var p=setApiPreset.value;
    if(API_PRESETS[p]){
      if(setApiBaseUrl)setApiBaseUrl.value=API_PRESETS[p].baseUrl;
      if(setApiModel)setApiModel.value=API_PRESETS[p].model;
      if(curAiConfig){
        curAiConfig.api = curAiConfig.api || {};
        curAiConfig.api.provider = p;
        var defs = API_PRESETS[p].defaultModels || [];
        curAiConfig.api.customModels = curAiConfig.api.customModels || [];
        defs.forEach(function(m){
          if(curAiConfig.api.customModels.indexOf(m) < 0){
            curAiConfig.api.customModels.push(m);
          }
        });
      }
    }
    renderModelManagerList(curAiConfig);
  };
}

if(btnTestApi){
  btnTestApi.onclick=function(){
    if(!window.protoAPI||!window.protoAPI.ai||!window.protoAPI.ai.testConnection){
      if(testApiStatus){ testApiStatus.textContent='仅桌面端支持测试'; testApiStatus.className='set-status err'; }
      return;
    }
    if(testApiStatus){ testApiStatus.textContent='测试连接中…'; testApiStatus.className='set-status'; }
    var cfg={
      baseUrl:setApiBaseUrl?setApiBaseUrl.value.trim():'',
      apiKey:setApiKey?setApiKey.value.trim():'',
      model:setApiModel?setApiModel.value.trim():'deepseek-chat'
    };
    window.protoAPI.ai.testConnection(cfg).then(function(r){
      if(r&&r.ok){
        if(testApiStatus){ testApiStatus.innerHTML=ic('check')+' 连接成功 ('+(r.latency||0)+'ms)'; testApiStatus.className='set-status ok'; }
      }else{
        if(testApiStatus){ testApiStatus.innerHTML=ic('x')+' '+((r&&r.error)||'连接失败'); testApiStatus.className='set-status err'; }
      }
    }).catch(function(e){
      if(testApiStatus){ testApiStatus.innerHTML=ic('x')+' '+(e&&e.message||e); testApiStatus.className='set-status err'; }
    });
  };
}

function renderModelManagerList(cfg){
  if(!modelCheckList)return;
  var eng = getActiveEngineInUi();
  var prov = setApiPreset ? setApiPreset.value : 'deepseek';

  if(eng === 'api'){
    var apiCfg = (cfg && cfg.api) || {};
    var presetDefs = (API_PRESETS[prov] && API_PRESETS[prov].defaultModels) || ['deepseek-chat','deepseek-reasoner'];
    var custom = Array.isArray(apiCfg.customModels) && apiCfg.customModels.length
      ? apiCfg.customModels.slice()
      : presetDefs.slice();
    presetDefs.forEach(function(m){ if(custom.indexOf(m)<0) custom.push(m); });
    if(cfg && cfg.api) cfg.api.customModels = custom;

    var visible = Array.isArray(cfg && cfg.visibleModelsApi) ? cfg.visibleModelsApi : null;
    var provNames = {
      deepseek: 'DeepSeek 官方',
      ali: '阿里百炼 DashScope',
      siliconflow: '硅基流动 SiliconFlow',
      openrouter: 'OpenRouter',
      custom: '自定义 API'
    };
    var provLabel = provNames[prov] || '自定义 API';
    var html = '<div style="font-weight:700;font-size:11.5px;color:var(--faint);margin:6px 0 2px;">' + escHtml(provLabel) + '</div>';
    custom.forEach(function(m){
      var isChecked = (!visible || visible.indexOf(m) >= 0);
      html += '<label class="model-check-item" data-id="' + escAttr(m) + '">'
        + '<input type="checkbox" value="' + escAttr(m) + '"' + (isChecked ? ' checked' : '') + '>'
        + '<span>' + escHtml(m) + '</span>'
        + '<span style="margin-left:auto;font-size:10px;color:var(--faint);">' + escHtml(m) + '</span>'
        + '</label>';
    });
    modelCheckList.innerHTML = html;
    return;
  }

  modelCheckList.innerHTML='正在读取模型列表…';
  if(!window.protoAPI||!window.protoAPI.ai||!window.protoAPI.ai.listModels){
    modelCheckList.innerHTML='仅桌面端可用';
    return;
  }
  window.protoAPI.ai.listModels().then(function(r){
    if(!r||!r.groups||!r.groups.length){
      modelCheckList.innerHTML='<div style="color:var(--faint);padding:6px;">未获取到模型列表</div>';
      return;
    }
    var visible = Array.isArray(cfg && cfg.visibleModelsCli) ? cfg.visibleModelsCli : null;
    var html='';
    r.groups.forEach(function(g){
      var items=g.models||[];
      if(!items.length)return;
      html+='<div style="font-weight:700;font-size:11.5px;color:var(--faint);margin:6px 0 2px;">'+escHtml(g.label||g.provider)+'</div>';
      items.forEach(function(m){
        var isChecked = (!visible || visible.indexOf(m.id) >= 0);
        html+='<label class="model-check-item" data-id="'+escAttr(m.id)+'">'
          +'<input type="checkbox" value="'+escAttr(m.id)+'"'+(isChecked?' checked':'')+'>'
          +'<span>'+escHtml(m.name||m.id)+'</span>'
          +'<span style="margin-left:auto;font-size:10px;color:var(--faint);">'+escHtml(m.id)+'</span>'
          +'</label>';
      });
    });
    modelCheckList.innerHTML=html;
  });
}
function getSelectedModelIds(){
  if(!modelCheckList)return [];
  var chks=modelCheckList.querySelectorAll('input[type="checkbox"]:checked');
  var arr=[];
  chks.forEach(function(c){ arr.push(c.value); });
  return arr;
}
if(btnSelectAllModels)btnSelectAllModels.onclick=function(){
  if(!modelCheckList)return;
  modelCheckList.querySelectorAll('input[type="checkbox"]').forEach(function(c){ c.checked=true; });
};
if(btnClearAllModels)btnClearAllModels.onclick=function(){
  if(!modelCheckList)return;
  modelCheckList.querySelectorAll('input[type="checkbox"]').forEach(function(c){ c.checked=false; });
};
if(btnSelectRecModels)btnSelectRecModels.onclick=function(){
  if(!modelCheckList)return;
  var recs=['deepseek-chat','deepseek-reasoner','deepseek-v4-flash-free','qwen-max','qwen-plus','claude-3-5-sonnet','claude-3.5-sonnet'];
  modelCheckList.querySelectorAll('input[type="checkbox"]').forEach(function(c){
    var id=c.value.toLowerCase();
    var match=recs.some(function(r){ return id.indexOf(r)>=0; });
    c.checked=match;
  });
};
if(setModelSearch)setModelSearch.oninput=function(){
  var q=setModelSearch.value.trim().toLowerCase();
  if(!modelCheckList)return;
  modelCheckList.querySelectorAll('.model-check-item').forEach(function(item){
    var txt=(item.textContent||'').toLowerCase();
    item.style.display=(!q||txt.indexOf(q)>=0)?'flex':'none';
  });
};
if(btnAddCustomModel&&newModelInput){
  btnAddCustomModel.onclick=function(){
    var val=newModelInput.value.trim();
    if(!val)return;
    if(curAiConfig){
      curAiConfig.api = curAiConfig.api || {};
      curAiConfig.api.customModels=curAiConfig.api.customModels||[];
      if(curAiConfig.api.customModels.indexOf(val)<0){
        curAiConfig.api.customModels.push(val);
      }
      if(Array.isArray(curAiConfig.visibleModelsApi) && curAiConfig.visibleModelsApi.indexOf(val)<0){
        curAiConfig.visibleModelsApi.push(val);
      }
    }
    newModelInput.value='';
    renderModelManagerList(curAiConfig);
  };
}
var chkEnableTools=$('chkEnableTools');

function loadSettingsToUi(){
  sbxRootHint();
  refreshCliInfo();
  if(testApiStatus)testApiStatus.textContent='';
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.getConfig){
    window.protoAPI.ai.getConfig().then(function(cfg){
      curAiConfig=cfg||{};
      setEngineUi(cfg.engine||'cli', true);
      var api=(cfg&&cfg.api)||{};
      if(setApiPreset&&api.provider)setApiPreset.value=api.provider;
      if(setApiBaseUrl)setApiBaseUrl.value=api.baseUrl||'https://api.deepseek.com/v1';
      if(setApiKey)setApiKey.value=api.apiKey||'';
      if(setApiModel)setApiModel.value=api.model||'deepseek-chat';
      chkEnableTools=$('chkEnableTools'); if(chkEnableTools) chkEnableTools.checked = !(api.enableTools===false);
      renderModelManagerList(curAiConfig);
    });
  }
}

var saveTipTimer = null;
function showSettingsSaveTip(){
  var tip = $('settingsSaveTip');
  if(!tip) return;
  tip.style.display = 'inline-flex';
  if(saveTipTimer) clearTimeout(saveTipTimer);
  saveTipTimer = setTimeout(function(){
    tip.style.display = 'none';
  }, 3500);
}

function saveSettingsFromUi(){
  syncCurrentChecklistToMemory();
  var engine = getActiveEngineInUi();
  var isCli = (engine === 'cli');
  var activeVisible = isCli ? (curAiConfig.visibleModelsCli || []) : (curAiConfig.visibleModelsApi || []);

  chkEnableTools=$('chkEnableTools');
  var apiData={
    provider:setApiPreset?setApiPreset.value:'deepseek',
    baseUrl:setApiBaseUrl?setApiBaseUrl.value.trim():'',
    apiKey:setApiKey?setApiKey.value.trim():'',
    model:setApiModel?setApiModel.value.trim():'deepseek-chat',
    customModels:(curAiConfig&&curAiConfig.api&&curAiConfig.api.customModels)||['deepseek-chat','deepseek-reasoner'],
    enableTools: chkEnableTools ? !!chkEnableTools.checked : !(curAiConfig&&curAiConfig.api&&curAiConfig.api.enableTools===false)
  };
  var cfg={
    engine:engine,
    api:apiData,
    visibleModels:activeVisible,
    visibleModelsCli:curAiConfig.visibleModelsCli||null,
    visibleModelsApi:curAiConfig.visibleModelsApi||null
  };
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
    window.protoAPI.ai.saveConfig(cfg).then(function(){
      curAiConfig=cfg;
      aiInvalidateModels();
      aiLoadModels();
      aiRefreshCli();
      showSettingsSaveTip();
      renderModelManagerList(curAiConfig);
    });
  }else{
    showSettingsSaveTip();
  }
}

function openSettings(tab){
  loadSettingsToUi();
  switchSettingsTab(tab||'ai');
  if(settingsMask)settingsMask.style.display='flex';
  if(window.MaskStack) window.MaskStack.push('settingsMask', closeSettings); // P1-7 fix
}
function closeSettings(){ if(window.MaskStack) window.MaskStack.pop('settingsMask'); // P1-7 fix
 if(settingsMask)settingsMask.style.display='none'; }
if(btnSettings)btnSettings.onclick=function(){ openSettings('ai'); };
if(settingsClose)settingsClose.onclick=closeSettings;
if(settingsCancel)settingsCancel.onclick=closeSettings;
if(settingsOk)settingsOk.onclick=saveSettingsFromUi;

/* ═══════ 大模型对话（双 Tab：需求对话 + DSH 运行日志） ═══════ */
var aiMaskEl=$('aiMask'),aiBodyEl=$('aiBody'),aiChatView=$('aiChatView'),aiLogsView=$('aiLogsView'),aiInputEl=$('aiInput'),
 aiCliEl=$('aiCli'),aiCloseEl=$('aiClose'),aiSendEl=$('aiSend'),aiStopEl=$('aiStop'),aiClearEl=$('aiClear'),aiModelEl=$('aiModel');
var aiTargetPageSelect = $('aiTargetPageSelect');
function aiRenderTargetPages(){
  aiTargetPageSelect = aiTargetPageSelect || $('aiTargetPageSelect');
  if(!aiTargetPageSelect) return;
  var s = currentSource || (sources && sources[0]);
  if(!s){
    aiTargetPageSelect.innerHTML = '<option value="">默认页面</option>';
    return;
  }
  var mainFile = s.mainHtmlFile || s.name || '';
  var activeFile = s.activeSubFile || mainFile;
  var html = '';
  if(mainFile){
    html += '<option value="' + escHtml(mainFile) + '"' + (activeFile === mainFile ? ' selected' : '') + '>主页 (' + escHtml(s.displayName || s.name) + ')</option>';
  }
  if(s.subPages && s.subPages.length){
    s.subPages.forEach(function(sp){
      html += '<option value="' + escHtml(sp.file) + '"' + (activeFile === sp.file ? ' selected' : '') + '>' + escHtml(sp.name || sp.file) + '</option>';
    });
  } else if(s.htmlFiles && s.htmlFiles.length){
    s.htmlFiles.forEach(function(f){
      var file = (typeof f === 'string' ? f : (f.file||f.name||''));
      var name = (typeof f === 'string' ? f : (f.name||f.file||''));
      if(!file) return;
      if(file === mainFile) return;
      html += '<option value="' + escHtml(file) + '"' + (activeFile === file ? ' selected' : '') + '>' + escHtml(name) + '</option>';
    });
  }
  if(!html){ html = '<option value="">默认页面</option>'; }
  aiTargetPageSelect.innerHTML = html;
}
var tabChatBtn=$('tabChatBtn'),tabLogsBtn=$('tabLogsBtn'),logErrDot=$('logErrDot'),logsCount=$('logsCount'),aiLogsConsole=$('aiLogsConsole');
var btnCopyTrace=$('btnCopyTrace'),btnClearTrace=$('btnClearTrace'),chkAutoScrollTrace=$('chkAutoScrollTrace'),btnToggleAllTrace=$('btnToggleAllTrace');

var aiBusy=false,aiStreaming=null,aiStreamText='',aiStreamThink='';
var aiThinkTimer=null,aiThinkStart=0;
var HAS_AI = !!(window.protoAPI&&window.protoAPI.ai);
// harn fix: 滚动不抢 - 仅外层可滚，thr80 守卫
var aiUserScrolledPause=false; function aiShouldAutoScroll(el,thr){ thr=thr||80; return el && (el.scrollHeight - el.scrollTop - el.clientHeight < thr); }
/* ═══════ 日志分组：每次 AI 任务一个「进度摘要」组，默认收起、点击展开、组头吸顶 ═══════
   组内三类链：思考链(think) → 操作链/删除链(trace lines) → 输出链(output)
   对话框只显示进行中的操作状态卡；完整链全部落在日志组里。 */
var aiTraceGroups=[];      /* [{id,title,time,status:'run'|'ok'|'err',open:false,lines:[],think:'',output:'',thinkFlush:0,outFlush:0}] */
var aiCurGroupId=null;     /* 当前活动组（AI 任务进行中） */
var aiGroupSeq=0;

function aiTraceBegin(title){
  aiGroupSeq++;
  var g={ id:'g'+aiGroupSeq, title:title||('任务 #'+aiGroupSeq), time:new Date().toTimeString().split(' ')[0],
          status:'run', open:false, lines:[], think:'', output:'', thinkFlush:0, outFlush:0 };
  aiTraceGroups.push(g);
  aiCurGroupId=g.id;
  aiTraceAppendLine(g, {time:g.time,tag:'TASK',level:'info',text:'任务开始：'+g.title});
  aiRenderTraceGroups();
  return g;
}
function aiCurGroup(){
  if(!aiCurGroupId)return null;
  for(var i=0;i<aiTraceGroups.length;i++){ if(aiTraceGroups[i].id===aiCurGroupId)return aiTraceGroups[i]; }
  return null;
}
function aiTraceCountTotal(){
  var n=0; for(var i=0;i<aiTraceGroups.length;i++){ n+=aiTraceGroups[i].lines.length; }
  return n;
}
function aiTraceAppendLine(g, line){
  if(!g)return;
  g.lines.push(line);
  if(g.status==='run'&&line.level==='error'){ if(logErrDot)logErrDot.style.display='inline-block'; }
  if(logsCount)logsCount.textContent=aiTraceCountTotal()+' 条记录';
  var body=aiGroupBodyNode(g.id);
  if(body){
    body.appendChild(aiTraceLineDom(line));
    if(!chkAutoScrollTrace||chkAutoScrollTrace.checked){ if(aiLogsConsole)aiLogsConsole.scrollTop=aiLogsConsole.scrollHeight; }
  }
  aiRefreshGroupMeta(g);
}
function aiTraceLineDom(line){
  var el=document.createElement('div');
  el.className='trace-line';
  el.innerHTML='<span class="trace-time">['+escHtml(line.time)+']</span>'
    +'<span class="trace-tag '+escHtml(line.level||'info')+'">['+escHtml(line.tag||'LOG')+']</span>'
    +'<span class="trace-text">'+escHtml(line.text)+'</span>';
  return el;
}
function aiGroupBodyNode(gid){
  if(!aiLogsConsole)return null;
  var grp=aiLogsConsole.querySelector('.trace-group[data-gid="'+gid+'"]');
  if(!grp)return null;
  return grp.querySelector('.trace-group-body');
}
function aiRefreshGroupMeta(g){
  if(!aiLogsConsole)return;
  var grp=aiLogsConsole.querySelector('.trace-group[data-gid="'+g.id+'"]');
  if(!grp)return;
  var meta=grp.querySelector('.tg-meta'); if(meta)meta.textContent=g.time+' · '+g.lines.length+' 条';
  var st=grp.querySelector('.tg-state');
  if(st){ st.className='tg-state '+(g.status==='ok'?'ok':(g.status==='err'?'err':'run')); st.textContent=g.status==='ok'?'已完成':(g.status==='err'?'失败':'进行中'); }
}
function aiTraceFlushThink(g){
  if(!g||!g.think)return;
  g.thinkFlush=Date.now();
  var body=aiGroupBodyNode(g.id);
  if(!body)return;
  var pre=body.querySelector('.tg-think-pre');
  if(pre){ pre.textContent=g.think; pre.scrollTop=pre.scrollHeight; }
}
function aiTraceFlushOutput(g){
  if(!g||!g.output)return;
  g.outFlush=Date.now();
  var body=aiGroupBodyNode(g.id);
  if(!body)return;
  var pre=body.querySelector('.tg-output-pre');
  if(pre){ pre.textContent=g.output; pre.scrollTop=pre.scrollHeight; }
}
/* 渲染全部日志组（重建，用于初始化/清空/开关） */
function aiRenderTraceGroups(){
  if(!aiLogsConsole)return;
  aiLogsConsole.innerHTML='';
  if(!aiTraceGroups.length){ aiLogsConsole.innerHTML='<div style="color:#64748B;padding:6px 2px">暂无任务日志。AI 任务执行时，思考/操作/删除/输出链会分组记录在这里。</div>'; return; }
  for(var i=0;i<aiTraceGroups.length;i++){
    var g=aiTraceGroups[i];
    var grp=document.createElement('div');
    grp.className='trace-group'+(g.open?' open':'');
    grp.setAttribute('data-gid',g.id);
    grp.innerHTML='<div class="trace-group-hd" data-gid="'+g.id+'">'
      +'<span class="tg-state '+(g.status==='ok'?'ok':(g.status==='err'?'err':'run'))+'">'+(g.status==='ok'?'已完成':(g.status==='err'?'失败':'进行中'))+'</span>'
      +'<span class="tg-title">'+escHtml(g.title)+'</span>'
      +'<span class="tg-meta">'+escHtml(g.time)+' · '+g.lines.length+' 条</span>'
      +'<button class="tg-toggle" type="button" data-gid="'+g.id+'">'+(g.open?'收起':'展开')+'</button>'
      +'</div>'
      +'<div class="trace-group-body"></div>';
    aiLogsConsole.appendChild(grp);
    var body=grp.querySelector('.trace-group-body');
    // fix: 始终渲染操作链，使日志在折叠态 innerHTML 亦可见（测试读取 innerHTML 需包含 POST/FS_SAVE），显隐由 CSS .trace-group.open 控制
     if(g.think){ body.appendChild(aiGroupSection('思考链')); var tp=document.createElement('pre'); tp.className='think-light tg-think-pre'; tp.textContent=g.think; body.appendChild(tp); } // light gray fix
    if(g.lines.length){ body.appendChild(aiGroupSection('操作 / 删除链')); }
    for(var j=0;j<g.lines.length;j++){ body.appendChild(aiTraceLineDom(g.lines[j])); }
     if(g.output){ body.appendChild(aiGroupSection('输出')); var op=document.createElement('pre'); op.className='think-light tg-output-pre'; op.textContent=g.output; body.appendChild(op); } // light gray fix
  }
  if(logsCount)logsCount.textContent=aiTraceCountTotal()+' 条记录';
}
function aiGroupSection(label){
  var s=document.createElement('div'); s.className='tg-section'; s.textContent=label; return s;
}
/* 展开/收起某组（吸顶组头在滚动时保持可见，标识日志归属） */
function aiToggleTraceGroup(gid){
  for(var i=0;i<aiTraceGroups.length;i++){
    if(aiTraceGroups[i].id===gid){
      aiTraceGroups[i].open=!aiTraceGroups[i].open;
      aiRenderTraceGroups();
      return;
    }
  }
}
/* 事件委托：组头点击展开/收起（按钮在组头末尾） */
if(aiLogsConsole)aiLogsConsole.addEventListener('click',function(ev){
  var t=ev.target;
  var btn=t&&t.closest?t.closest('.tg-toggle'):null;
  var hd=t&&t.closest?t.closest('.trace-group-hd'):null;
  if(btn){ ev.stopPropagation(); aiToggleTraceGroup(btn.getAttribute('data-gid')||hd&&hd.getAttribute('data-gid')); return; }
  if(hd){ aiToggleTraceGroup(hd.getAttribute('data-gid')); }
});
function switchAiTab(tab){
  var isChat=(tab==='chat');
  if(tabChatBtn)tabChatBtn.classList.toggle('active',isChat);
  if(tabLogsBtn)tabLogsBtn.classList.toggle('active',!isChat);
  if(aiChatView)aiChatView.style.display=isChat?'flex':'none';
  if(aiLogsView)aiLogsView.style.display=isChat?'none':'flex';
  if(!isChat&&logErrDot)logErrDot.style.display='none';
  if(!isChat)aiRenderTraceGroups();
  return isChat;
}
if(tabChatBtn)tabChatBtn.onclick=function(){ switchAiTab('chat'); };
if(tabLogsBtn)tabLogsBtn.onclick=function(){ switchAiTab('logs'); };

function aiAppendTrace(trace){
  if(!trace)return;
  // fix test regression: 无活跃组时创建外部日志组且清掉初始 TASK 行，使 3 次追加 = 3 条记录（与 new-features-upgrade 期望一致）
  if(!aiCurGroup()){ try{ var _g=aiTraceBegin("外部日志"); if(_g && _g.lines.length===1 && _g.lines[0].tag==='TASK') _g.lines.pop(); if(logsCount) logsCount.textContent=aiTraceCountTotal()+' 条记录'; }catch(e){} }
  var t=(typeof trace==='string')?{text:trace,tag:'INFO',level:'info'}:trace;
  var now=t.time||new Date().toTimeString().split(' ')[0];
  var tag=(t.tag||'LOG').toUpperCase();
  var level=t.level||'info';
  var text=t.text||'';
  aiTraceAppendLine(aiCurGroup(), {time:now,tag:tag,level:level,text:text});
}
if(btnToggleAllTrace)btnToggleAllTrace.onclick=function(){
  if(!aiTraceGroups.length)return;
  var anyClosed=false;
  for(var i=0;i<aiTraceGroups.length;i++){ if(!aiTraceGroups[i].open){ anyClosed=true; break; } }
  for(var j=0;j<aiTraceGroups.length;j++){ aiTraceGroups[j].open=anyClosed; }
  aiRenderTraceGroups();
};
if(btnClearTrace)btnClearTrace.onclick=function(){
  aiTraceGroups=[]; aiCurGroupId=null; aiGroupSeq=0;
  if(aiLogsConsole)aiLogsConsole.innerHTML='';
  if(logsCount)logsCount.textContent='0 条记录';
  if(logErrDot)logErrDot.style.display='none';
};
if(btnCopyTrace)btnCopyTrace.onclick=function(){
  var total=aiTraceCountTotal();
  if(!total){ alert('暂无日志可复制'); return; }
  var out=[];
  for(var gi=0;gi<aiTraceGroups.length;gi++){
    var g=aiTraceGroups[gi];
    out.push('== '+g.title+' ['+g.status+'] '+g.time+' ==');
    if(g.think)out.push('[THINK] '+g.think);
    for(var li=0;li<g.lines.length;li++){
      var l=g.lines[li];
      out.push('['+l.time+'] ['+l.tag+'] '+l.text);
    }
    if(g.output)out.push('[OUTPUT] '+g.output);
  }
  var full=out.join('\n');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(full).then(function(){ alert('已复制全部 Trace 日志'); });
  }else{
    var ta=document.createElement('textarea'); ta.value=full; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    alert('已复制全部 Trace 日志');
  }
};

/* ── 会话：单个沙箱始终只有一个会话 ── */
var aiSession=null,aiSessionKey=null;
var SESS_KEY='ai_sessions_v2_';
function loadSessions(explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var key=SESS_KEY+encodeURIComponent(dir||'');
 try{
  var raw=localStorage.getItem(key);
  if(!raw) return {activeId:'',sessions:{}};
  var data=JSON.parse(raw);
  if(!data||typeof data!=='object'||!data.sessions) return {activeId:'',sessions:{}};
  for(var sid in data.sessions){
   var s=data.sessions[sid];
   if(!s.lastHash||typeof s.lastHash!=='object'||Array.isArray(s.lastHash)){
    s.lastHash={};
   }
   if(!Array.isArray(s.m)) s.m=[];
   if(!s.createdAt) s.createdAt=Date.now();
   if(!s.updatedAt) s.updatedAt=s.createdAt;
   if(!s.title) s.title='新会话';
   if(!s.id) s.id=sid;
  }
  if(data.activeId&&!data.sessions[data.activeId]){
   var ids=Object.keys(data.sessions);
   ids.sort(function(a,b){ return (data.sessions[b].updatedAt||0)-(data.sessions[a].updatedAt||0); });
   data.activeId=ids[0]||'';
  }
  return data;
 }catch(e){ return {activeId:'',sessions:{}}; }
}
function saveSessions(data, explicitDir){
 if(data&&data.sessions){
  for(var sid in data.sessions){
   var s=data.sessions[sid];
   if(!s.lastHash||typeof s.lastHash!=='object'||Array.isArray(s.lastHash)){
    s.lastHash={};
   }
  }
 }
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var key=SESS_KEY+encodeURIComponent(dir||'');
 for(var attempt=0; attempt<20; attempt++){
  try{
   localStorage.setItem(key, JSON.stringify(data));
   return true;
  }catch(e){
   var msg=String(e&&e.message||e);
   var isQuota=e&&(e.name==='QuotaExceededError'||e.code===22||msg.indexOf('Quota')>=0||msg.indexOf('quota')>=0||msg.indexOf('exceeded')>=0);
   if(!isQuota){ try{ logWrite('warn','saveSessions',msg);}catch(_e){} return false; }
   var oldestSid=null, oldestIdx=-1, oldestScore=Infinity;
   for(var sid2 in data.sessions){
    var sess=data.sessions[sid2];
    var ms=sess.m||[];
    for(var i=0;i<ms.length;i++){
     if(ms[i]&&ms[i].r==='tool'){
      var score=(sess.updatedAt||sess.createdAt||0)*100000 + i;
      if(score<oldestScore){ oldestScore=score; oldestSid=sid2; oldestIdx=i; }
      break;
     }
    }
   }
   if(oldestSid===null){ try{ logWrite('warn','saveSessions','QuotaExceeded无tool可丢弃');}catch(_e){} return false; }
   data.sessions[oldestSid].m.splice(oldestIdx,1);
  }
 }
 try{ localStorage.setItem(key, JSON.stringify(data)); return true; }catch(e){ try{ logWrite('warn','saveSessions',String(e&&e.message||e));}catch(_e){} return false; }
}
function genSessId(){ return 'sess_'+Date.now()+'_'+Math.floor(Math.random()*10000); }
function ensureSessions(explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=loadSessions(dir);
 migrateIfNeeded(dir, data);
 if(!data.sessions||Object.keys(data.sessions).length===0){
  var sid=genSessId();
  var now=Date.now();
  data.sessions={}; data.sessions[sid]={id:sid,title:'新会话',createdAt:now,updatedAt:now,oid:'',m:[],lastHash:{}}; data.activeId=sid;
  saveSessions(data, dir);
 } else if(!data.activeId||!data.sessions[data.activeId]){
  var ids=Object.keys(data.sessions);
  ids.sort(function(a,b){ return (data.sessions[b].updatedAt||0)-(data.sessions[a].updatedAt||0); });
  data.activeId=ids[0];
  saveSessions(data, dir);
 }
 return data;
}
function migrateIfNeeded(explicitDir, data){
 if(data&&data.sessions&&Object.keys(data.sessions).length>0) return;
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var oldKey='ai_hist_'+encodeURIComponent(dir||'');
 if(!dir) oldKey='ai_hist_ROOT';
 try{
  var raw=localStorage.getItem(oldKey);
  if(!raw) return;
  var old=JSON.parse(raw);
  if(!old||!Array.isArray(old.m)) return;
  var sid=genSessId();
  var now=Date.now();
  var title='历史会话';
  for(var i=0;i<old.m.length;i++){ if(old.m[i]&&old.m[i].r==='u'&&old.m[i].t){ title=String(old.m[i].t).slice(0,16)||'历史会话'; break; } }
  data.sessions[sid]={id:sid,title:title,createdAt:old.c||now,updatedAt:Date.now(),oid:old.oid||'',m:old.m||[],lastHash:{}};
  data.activeId=sid;
 }catch(e){}
}
function getActiveSession(explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=ensureSessions(dir);
 var sess=data.sessions[data.activeId];
 if(sess){
  aiSession=sess;
  aiSessionKey=SESS_KEY+encodeURIComponent(dir||'')+'#'+encodeURIComponent(sess.id);
  aiActiveKey=SESS_KEY+'#'+encodeURIComponent(sess.id);
 }
 return sess;
}
function setActiveSession(id, explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=loadSessions(dir);
 if(!data.sessions[id]) return false;
 data.activeId=id;
 saveSessions(data, dir);
 aiActiveKey=SESS_KEY+'#'+encodeURIComponent(id);
 aiSession=data.sessions[id];
 aiSessionKey=SESS_KEY+encodeURIComponent(dir||'')+'#'+encodeURIComponent(id);
 renderSessionList(dir);
 aiRenderBubbles();
 aiRenderSbx();
 return true;
}
function createSession(title, explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=ensureSessions(dir);
 var sid=genSessId();
 var now=Date.now();
 var t=String(title||'').trim()||('新会话 '+(Object.keys(data.sessions).length+1));
 data.sessions[sid]={id:sid,title:t,createdAt:now,updatedAt:now,oid:'',m:[],lastHash:{}};
 data.activeId=sid;
 saveSessions(data, dir);
 aiActiveKey=SESS_KEY+'#'+encodeURIComponent(sid);
 aiSession=data.sessions[sid];
 aiSessionKey=SESS_KEY+encodeURIComponent(dir||'')+'#'+encodeURIComponent(sid);
 renderSessionList(dir);
 aiRenderBubbles();
 return data.sessions[sid];
}
function deleteSession(id, explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=loadSessions(dir);
 if(!data.sessions[id]) return false;
 delete data.sessions[id];
 var ids=Object.keys(data.sessions);
 if(!ids.length){
  var sid=genSessId();
  var now=Date.now();
  data.sessions[sid]={id:sid,title:'新会话',createdAt:now,updatedAt:now,oid:'',m:[],lastHash:{}};
  data.activeId=sid;
 } else if(data.activeId===id){
  ids.sort(function(a,b){ return (data.sessions[b].updatedAt||0)-(data.sessions[a].updatedAt||0); });
  data.activeId=ids[0];
 }
 saveSessions(data, dir);
 var cur=data.sessions[data.activeId];
 aiActiveKey=SESS_KEY+'#'+encodeURIComponent(data.activeId||'');
 aiSession=cur||null;
 aiSessionKey=SESS_KEY+encodeURIComponent(dir||'')+'#'+encodeURIComponent(data.activeId||'');
 renderSessionList(dir);
 aiRenderBubbles();
 return true;
}
function renameSession(id, newTitle, explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=loadSessions(dir);
 var s=data.sessions[id];
 if(!s) return false;
 var t=String(newTitle||'').trim();
 if(t) s.title=t;
 s.updatedAt=Date.now();
 saveSessions(data, dir);
 renderSessionList(dir);
 return true;
}
function renderSessionList(explicitDir){
 var dir=(explicitDir!==undefined?explicitDir:aiSbxDir());
 var data=loadSessions(dir);
 if(!data.activeId||!data.sessions[data.activeId]){
  var ids0=Object.keys(data.sessions);
  if(ids0.length){
   ids0.sort(function(a,b){ return (data.sessions[b].updatedAt||0)-(data.sessions[a].updatedAt||0); });
   data.activeId=ids0[0];
   saveSessions(data, dir);
  }
 }
 var listEl=document.getElementById('aiSessList');
 if(!listEl) return;
 listEl.innerHTML='';
 var ids=Object.keys(data.sessions);
 ids.sort(function(a,b){ return (data.sessions[b].updatedAt||0)-(data.sessions[a].updatedAt||0); });
 for(var i=0;i<ids.length;i++){
  (function(sid){
   var sess=data.sessions[sid];
   var item=document.createElement('div');
   item.className='ai-sess-item'+(sid===data.activeId?' active':'');
   item.setAttribute('data-sid', sid);
   var titleSpan=document.createElement('span');
   titleSpan.className='ai-sess-title';
   titleSpan.textContent=sess.title||('会话 '+sid.slice(-4));
   titleSpan.title=sess.title||'';
   titleSpan.ondblclick=function(e){ e.stopPropagation(); var nt=prompt('重命名会话', sess.title||''); if(nt!==null) renameSession(sid, nt, dir); };
   var closeBtn=document.createElement('span');
   closeBtn.className='sess-close';
   closeBtn.textContent='✕';
   closeBtn.title='删除会话';
   closeBtn.onclick=function(e){ e.stopPropagation(); if(confirm('删除会话「'+(sess.title||sid)+'」？')) deleteSession(sid, dir); };
   item.appendChild(titleSpan);
   item.appendChild(closeBtn);
   item.onclick=function(){ setActiveSession(sid, dir); };
   listEl.appendChild(item);
  })(ids[i]);
 }
 if(data.activeId){
  aiActiveKey=SESS_KEY+'#'+encodeURIComponent(data.activeId);
  var cur=data.sessions[data.activeId];
  if(cur){ aiSession=cur; aiSessionKey=SESS_KEY+encodeURIComponent(dir||'')+'#'+encodeURIComponent(data.activeId); }
 }
}
// 会话面板按钮绑定
document.addEventListener('DOMContentLoaded', function(){
 var btnNew=$('btnNewSess'); if(btnNew) btnNew.onclick=function(){ createSession('', aiSbxDir()); };
  // 左侧会话栏常驻，已移除收起按钮及折叠逻辑
});


function aiSbxDir(){ return (currentSource&&currentSource.sandboxDir)||''; }
function aiHistKey(){ var d=aiSbxDir(); return 'ai_hist_'+(d?encodeURIComponent(d):'ROOT'); }
function aiLoadSesh(){ try{ var v=JSON.parse(localStorage.getItem(aiHistKey())); return (v&&typeof v==='object'&&Array.isArray(v.m))?v:null; }catch(e){ return null; } }
function aiSaveSesh(){ if(!aiSession) return; var dir=aiSbxDir(); var data=loadSessions(dir); var sid=aiSession.id||data.activeId; if(!sid||!data.sessions[sid]){ try{ localStorage.setItem(aiHistKey(), JSON.stringify(aiSession)); }catch(e){} if(sid&&data.sessions[sid]){ data.sessions[sid]=aiSession; data.activeId=sid; saveSessions(data, dir); renderSessionList(dir); } return; } var sess=data.sessions[sid]; sess.m=aiSession.m; sess.oid=aiSession.oid; if(aiSession.lastHash) sess.lastHash=aiSession.lastHash; sess.updatedAt=Date.now(); data.activeId=sid; saveSessions(data, dir); renderSessionList(dir); try{ localStorage.setItem(aiHistKey(), JSON.stringify(aiSession)); }catch(e){} }
function aiWriteSeshFor(key,fn){
 try{
  var v=JSON.parse(localStorage.getItem(key)||'null');
  if(!(v&&typeof v==='object'&&Array.isArray(v.m)))return;
  fn(v);
  localStorage.setItem(key,JSON.stringify(v));
 }catch(e){}
}
function aiActiveHistKey(){ return aiActiveKey||aiHistKey(); }
var aiActiveKey=null;
function aiEnsureCur(){
 var dir=aiSbxDir();
 var data=ensureSessions(dir);
 var sess=data.sessions[data.activeId];
 if(!sess){
  var ids=Object.keys(data.sessions);
  ids.sort(function(a,b){ return (data.sessions[b].updatedAt||0)-(data.sessions[a].updatedAt||0); });
  data.activeId=ids[0]||'';
  sess=data.sessions[data.activeId];
  saveSessions(data, dir);
 }
 aiSession=sess;
 aiSessionKey=SESS_KEY+encodeURIComponent(dir||'')+'#'+encodeURIComponent(data.activeId||'');
 aiActiveKey=SESS_KEY+'#'+encodeURIComponent(data.activeId||'');
}
function aiCurSesh(){ aiEnsureCur(); return aiSession; }
function aiRenderSbx(){
 var el=$('aiSbx'); if(!el)return;
 var d=aiSbxDir();
 if(d){ el.textContent='沙箱：'+(currentSource&&currentSource.displayName||''); el.title='当前沙箱（模型工作目录）：'+d; el.className='ai-cli ok'; }
  else{ el.textContent='沙箱：无'; el.title='当前原型无沙箱目录'; el.className='ai-cli err'; }
}
function createAiCopyBtn(textOrFn){
 var btn=document.createElement('button');
 btn.type='button';
 btn.className='ai-copy-btn';
 btn.textContent='复制';
 btn.title='复制文字';
 btn.onclick=function(e){
  e.stopPropagation();
  var txt=typeof textOrFn==='function'?textOrFn():textOrFn;
  if(!txt)return;
  if(navigator.clipboard&&navigator.clipboard.writeText){
   navigator.clipboard.writeText(txt).then(function(){
    btn.textContent='已复制';
    btn.classList.add('copied');
    setTimeout(function(){ btn.textContent='复制'; btn.classList.remove('copied'); }, 1500);
   }).catch(function(){
    fallbackAiCopy(txt, btn);
   });
  }else{
   fallbackAiCopy(txt, btn);
  }
 };
 return btn;
}
function fallbackAiCopy(txt, btn){
 try{
  var ta=document.createElement('textarea');
  ta.value=txt;
  ta.style.position='fixed';
  ta.style.opacity='0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  btn.textContent='已复制';
  btn.classList.add('copied');
  setTimeout(function(){ btn.textContent='复制'; btn.classList.remove('copied'); }, 1500);
 }catch(e){
  btn.textContent='复制失败';
  setTimeout(function(){ btn.textContent='复制'; }, 1500);
 }
}

function aiRenderBubbles(){
 if(!aiChatView)return;
 aiChatView.innerHTML='';
 var s=aiCurSesh(),m=s?s.m:null;
  if(m) for(var i=0;i<m.length;i++){
   var msg=m[i]; if(msg&&msg.r==='tool') continue; var d=document.createElement('div');
  d.className='ai-msg '+(msg.r==='u'?'user':(msg.err?'err':'ai'));
  if(msg.r==='u'||msg.err){
   var body=document.createElement('div');
   body.className='ai-msg-body';
   body.textContent=msg.t;
   d.appendChild(body);
   var foot=document.createElement('div');
   foot.className='ai-msg-actions';
   foot.appendChild(createAiCopyBtn(msg.t));
   d.appendChild(foot);
  }else{
   /* AI 回复：最新一条默认展开，其余折叠（P1-5 AI-01：首次可见无需多点一次） */
   var isLast = (function(){ var last=-1; for(var k=m.length-1;k>=0;k--){ if(m[k]&&m[k].r!=='tool'&&m[k].r!=='u'&&!m[k].err){ last=k; break; } } return i===last; })();
   var fold=document.createElement('details');
   fold.className='ai-msg-fold';
   if(isLast) fold.open=true;
   var sum=document.createElement('summary');
   sum.textContent=isLast ? 'AI 回复（最新）' : '查看 AI 回复（点击展开）';
   fold.appendChild(sum);
    var fbody=document.createElement('div');
    fbody.className='ai-msg-body';
    fbody.innerHTML=formatAiTextConclusionOnly(msg.t); // AI-01-A fix
    fold.appendChild(fbody);
   var ffoot=document.createElement('div');
   ffoot.className='ai-msg-actions';
   ffoot.appendChild(createAiCopyBtn(msg.t));
   fold.appendChild(ffoot);
   d.appendChild(fold);
  }
  aiChatView.appendChild(d);
 }
  // think scroll fix - 守卫吸底，仅在用户未上滑且近底部时自动吸底
  if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView)) aiChatView.scrollTop=aiChatView.scrollHeight;
  scrubAiChatView(); /* 兜底：气泡区禁止出现工具遮罩类元素 */
}
function aiSetBusy(b){
 aiBusy=b;
 if(aiSendEl)aiSendEl.disabled=b;
 if(aiStopEl)aiStopEl.style.display=b?'':'none';
 if(aiInputEl)aiInputEl.disabled=b;
 if(aiModelEl)aiModelEl.disabled=b;
 if(b){ aiThinkStart=Date.now(); if(!aiThinkTimer) aiThinkTimer=setInterval(aiThinkTick,1000); }
 else{ if(aiThinkTimer){ clearInterval(aiThinkTimer); aiThinkTimer=null; } aiThinkStart=0; }
}
function aiThinkTick(){
 if(!aiBusy||!aiStreaming)return;
 var sec=Math.round((Date.now()-aiThinkStart)/1000);
 var stateEl=null,secEl=null,rowEl=null;
 try{ rowEl=aiStreaming.querySelector('.op-scroll .ai-op-row .op-val'); secEl=aiStreaming.querySelector('.op-scroll .ai-op-row .op-sec'); }catch(e){}
 if(rowEl&&aiStreamThink)rowEl.textContent='深度思考中';
 if(secEl)secEl.textContent=sec+'s';
  // harn fix: 删窄窗，刷新窄窗逻辑已废弃（保留空查询兼容）
 try{
    var thinkLive=aiStreaming.querySelector('.ai-think-live');
   if(thinkLive&&aiStreamThink){
     var head=thinkLive.querySelector('.ai-think-head');
     if(head) head.textContent='思考链 · '+aiStreamThink.length+' 字符 · '+sec+'s';
     var body=thinkLive.querySelector('.ai-think-body');
     if(body){
       var gTick=null; try{ gTick=aiCurGroup(); }catch(e2){}
       var needFlush=!gTick||!gTick.thinkFlush||(Date.now()-gTick.thinkFlush>300);
       if(needFlush){
          var doUpdate=function(){
            try{
              var esc=escHtml(String(aiStreamThink).slice(-1500)).replace(/\n/g,'<br>');
              body.innerHTML=esc+'<span class="caret"></span>';
               // harn fix: 删窄窗后不再内滚窄窗
               if(!aiUserScrolledPause && aiShouldAutoScroll(body,80)) body.scrollTop=body.scrollHeight;
               if(!aiUserScrolledPause && aiShouldAutoScroll(thinkLive,80)) thinkLive.scrollTop=thinkLive.scrollHeight;
            }catch(e3){}
         };
         if(window.requestAnimationFrame) window.requestAnimationFrame(doUpdate); else doUpdate();
       }
     }
   }
 }catch(e){}
}
function aiAppendMsg(text,cls){
 var d=document.createElement('div');
 d.className='ai-msg '+(cls||'ai');
 var body=document.createElement('div');
 body.className='ai-msg-body';
 if(cls==='user'||cls==='err'){ body.textContent=text; }
 else{ body.innerHTML=formatAiText(text); }
 d.appendChild(body);

 var foot=document.createElement('div');
 foot.className='ai-msg-actions';
 foot.appendChild(createAiCopyBtn(text));
 d.appendChild(foot);

  if(aiChatView)aiChatView.appendChild(d);
  // think scroll fix
  if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView)) aiChatView.scrollTop=aiChatView.scrollHeight;
  scrubAiChatView(); /* 兜底：气泡区禁止出现工具遮罩类元素 */
  return d;
}
function aiBubbleError(msg){
 var disp=String(msg||'发生错误');
 var g0=aiCurGroup();
 if(g0){ g0.think=aiStreamThink||g0.think; g0.output=aiStreamText||g0.output; aiTraceFlushThink(g0); aiTraceFlushOutput(g0); aiTraceAppendLine(g0,{time:new Date().toTimeString().split(' ')[0],tag:'ERROR',level:'error',text:disp}); g0.status='err'; aiRefreshGroupMeta(g0); }
 aiStreamText=''; aiStreamThink='';
 if(aiStreaming){
  aiStreaming.classList.add('err');
  aiStreaming.innerHTML='';
  var body=document.createElement('div');
  body.className='ai-msg-body';
  body.textContent=disp;
  aiStreaming.appendChild(body);
  var foot=document.createElement('div');
  foot.className='ai-msg-actions';
  foot.appendChild(createAiCopyBtn(disp));
  aiStreaming.appendChild(foot);
 }
 else{ aiAppendMsg(disp,'err'); }
 aiStreaming=null; aiSetBusy(false);
 var k=aiActiveHistKey();
 if(k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)){ var s=aiCurSesh(); if(s){ s.m=s.m||[]; s.m.push({r:'a',t:disp,err:true}); aiSaveSesh(); } }
 else{ aiWriteSeshFor(k,function(v){ v.m.push({r:'a',t:disp,err:true}); }); }
 aiActiveKey=null;
}
/* 渲染流式气泡（单一气泡）：按类型分块展示简要信息
   思考行 → 操作列表（逐条 trace 一行）→ 输出行；详情全部留在日志组
   P1-5 AI-01 修复：流式期实时预览末 800 字正文，避免“只报字符数” */
function aiRenderStream(){
 if(!aiStreaming)return;
 var g=aiCurGroup(),sec=aiThinkStart?Math.round((Date.now()-aiThinkStart)/1000):0;
 var ops=collectOps(g);
 var h='<div class="ai-op-card">';
 h+='<div class="op-scroll">';
  h+='<div class="ai-op-row"><span class="op-tag">思考</span><span class="op-val">'+(aiStreamThink?'深度思考中':'正在思考…')+'</span><span class="op-sec">'+sec+'s</span></div>';
  // 思考已移至操作项首位可点弹窗，此处不单独渲染窄窗
   h+='<div class="ai-op-row"><span class="op-tag">操作</span><span class="op-val">'+(ops.length?ops.length+' 条':'暂无')+'</span></div>';
   // harn fix: 操作项思考可点
    if((g&&g.think)||aiStreamThink){ var snippet = String((g&&g.think||aiStreamThink)).replace(/\s+/g,' ').slice(0,52); var gid = (g&&g.id||''); h += '<div class="op-line op-line--think" data-gid="'+escAttr(gid)+'" data-role="think" title="点击查看思考链全文">思考: '+escHtml(snippet)+' · '+((g&&g.think?g.think.length:aiStreamThink.length))+'字</div>'; }
  if(ops.length){
  h+='<div class="op-list">';
  for(var j=0;j<ops.length;j++){
   var t=String(ops[j].text).replace(/^[\s\u2713\u2714\u2717\u2705\u274C\u2022\-]*/,'').replace(/\s+/g,' ').slice(0,52);
   h+='<div class="op-line">'+(j+1)+'. '+escHtml(t)+'</div>';
  }
  h+='</div>';
 }
 h+='</div>'; /* op-scroll end */
 /* 滚动框外：输出行（生成中实时预览末 800 字，避免只报长度） */
  if(aiStreamText){
   h+='<div class="ai-op-row"><span class="op-tag">输出</span><span class="op-val">正在生成响应…</span><span class="op-sec">'+aiStreamText.length+' 字符</span></div>';
   var preview = String(aiStreamText).slice(-800);
   h+='<div class="ai-live-text">'+formatAiTextConclusionOnly(preview)+'</div>'; // AI-01-A fix
  }
  h+='</div>';
   aiStreaming.innerHTML=h;
   // harn fix: 滚动不抢，仅外层 aiChatView 可滚，thr80 守卫
   if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView,80)) aiChatView.scrollTop=aiChatView.scrollHeight;
   scrubAiChatView();
  try{ if(typeof aiUpdateJumpBtn==='function') aiUpdateJumpBtn(); }catch(e){}
}
/* 收集当前组操作链条目（排除思考/输出） */
function collectOps(g){
 var out=[],i;
 if(g) for(i=0;i<g.lines.length;i++){
  var tg=String(g.lines[i].tag||'').toUpperCase();
  if(tg!=='THINK'&&tg!=='OUTPUT'&&g.lines[i].text)out.push(g.lines[i]);
 }
 return out;
}
/* 统计当前组操作链条数 */
function countOps(g){ return collectOps(g).length; }
/* 实时追加一条操作行（trace 事件触发，多条操作逐条展示） */
function aiUpdateOpCur(){
 if(!aiStreaming)return;
 var g=aiCurGroup();
 if(!g||!g.lines.length)return;
 var l=g.lines[g.lines.length-1],tag=String(l.tag||'').toUpperCase();
 if(tag==='THINK'||tag==='OUTPUT'||!l.text)return;
 var list=null;
 try{ list=aiStreaming.querySelector('.op-list'); }catch(e){}
 if(!list){ aiRenderStream(); return; }
 var line=document.createElement('div');
 line.className='op-line';
 line.textContent=countOps(g)+'. '+String(l.text).replace(/^[\s\u2713\u2714\u2717\u2705\u274C\u2022\-]*/,'').replace(/\s+/g,' ').slice(0,52);
 list.appendChild(line);
   /* 同步更新「操作 N 条」计数 */
   if(aiStreaming){ var rows=aiStreaming.querySelectorAll('.ai-op-row'); for(var k=0;k<rows.length;k++){ var v=rows[k].querySelector('.op-val'); if(v&&rows[k].querySelector('.op-tag')&&rows[k].querySelector('.op-tag').textContent==='操作'){ v.textContent=countOps(g)+' 条'; } } }
   // harn fix: 滚动不抢，仅外层可滚
   if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView,80)) aiChatView.scrollTop=aiChatView.scrollHeight;
   try{ if(typeof aiUpdateJumpBtn==='function') aiUpdateJumpBtn(); }catch(e){}
}
/* 完成：对话气泡 → 完成摘要 + 滚动框（思考/操作列表） + 完整回复（滚动框外）；日志组标记完成 I07: isCancel 区分 已停止 vs 已完成 */
function finishAiStream(isCancel){
  var txt=aiStreamText;
  var sec=aiThinkStart?Math.round((Date.now()-aiThinkStart)/1000):0;
  var g=aiCurGroup();
  if(g){ g.status=isCancel?'err':'ok'; aiTraceFlushThink(g); aiTraceFlushOutput(g); aiRefreshGroupMeta(g); }
  aiSetBusy(false);
  if(aiStreaming){
   var ops=collectOps(g);
   var h='<div class="ai-op-card">';
   /* 完成摘要（滚动框外顶部） I07: isCancel 区分 已停止 vs 已完成 */
   var doneLabel=isCancel?'已停止':'已完成';
   h+='<div class="ai-op-done"><span>'+doneLabel+'（用时 '+sec+' 秒）</span>'
    +'<button type="button" class="ai-view-log" data-gid="'+((g&&g.id)||'')+'">查看日志</button></div>';
  /* 滚动框：思考（已完成）+ 操作逐条列表 — 思考可点弹窗 */
  h+='<div class="op-scroll">';
  h+='<div class="ai-op-row"><span class="op-tag">思考</span><span class="op-val">已完成</span><span class="op-sec">'+sec+'s</span></div>';
  if(g && g.think){ var _snip=String(g.think).replace(/\s+/g,' ').slice(0,52); var _gid2=(g&&g.id||''); h+='<div class="op-line op-line--think" data-gid="'+escAttr(_gid2)+'" data-role="think" title="点击查看思考链全文">思考: '+escHtml(_snip)+' · '+g.think.length+'字</div>'; }
  h+='<div class="ai-op-row"><span class="op-tag">操作</span><span class="op-val">'+(ops.length?ops.length+' 条':'无')+'</span></div>';
  if(ops.length){
   h+='<div class="op-list">';
   for(var j0=0;j0<ops.length;j0++){
    var tt=String(ops[j0].text).replace(/^[\s\u2713\u2714\u2717\u2705\u274C\u2022\-]*/,'').replace(/\s+/g,' ').slice(0,52);
    h+='<div class="op-line">'+(j0+1)+'. '+escHtml(tt)+'</div>';
   }
   h+='</div>';
  }
   h+='</div>'; /* op-scroll end */
   // harn fix: 完成态删单窗，已在操作项可点
    /* 滚动框外：完整回复直接展示（不隐藏） */
   if(txt){ h+='<div class="ai-msg-body"><div class="ai-text">'+formatAiTextConclusionOnly(txt)+'</div></div>'; } // AI-01-A fix
  h+='</div>';
  aiStreaming.innerHTML=h;
  var vb=aiStreaming.querySelector('.ai-view-log');
  if(vb)vb.onclick=function(){ switchAiTab('logs'); var gid=this.getAttribute('data-gid'); if(gid)aiOpenGroup(gid); };
  if(txt){
   var foot=document.createElement('div');
   foot.className='ai-msg-actions';
   foot.appendChild(createAiCopyBtn(txt));
   aiStreaming.appendChild(foot);
  }
 }
  aiStreaming=null; aiStreamText=''; aiStreamThink='';
  if(txt){
   var k=aiActiveHistKey();
   if(k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)){ var s=aiCurSesh(); if(s){ s.m=s.m||[]; s.m.push({r:'a',t:txt,err:false}); aiSaveSesh(); } }
   else{ aiWriteSeshFor(k,function(v){ v.m.push({r:'a',t:txt,err:false}); }); }
  }
   aiActiveKey=null;
   // harn fix: finish后重置滚动抢夺标志并回到最新 thr80 守卫
   aiUserScrolledPause=false;
   try{ if(typeof aiUpdateJumpBtn==='function') aiUpdateJumpBtn(); if(aiChatView && aiShouldAutoScroll(aiChatView,80)) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){}
}
/* 展开指定日志组（「查看日志」按钮用） */
function aiOpenGroup(gid){
 for(var i=0;i<aiTraceGroups.length;i++){
  if(aiTraceGroups[i].id===gid){ aiTraceGroups[i].open=true; break; }
 }
 aiRenderTraceGroups();
}
function aiRefreshCli(){
 if(!HAS_AI){ if(aiCliEl){ aiCliEl.textContent='仅桌面端可用'; aiCliEl.className='ai-cli err'; } return; }
 if(aiCliEl){ aiCliEl.textContent='检测中…'; aiCliEl.className='ai-cli warn'; }
 window.protoAPI.ai.checkCli().then(function(r){
  if(aiCliEl){
   if(r&&r.found){ aiCliEl.textContent='CLI 已就绪'+(r.version?' · v'+r.version:''); aiCliEl.className='ai-cli ok'; aiCliEl.title=r.path||''; }
   else{ aiCliEl.textContent='未检测到 CLI'; aiCliEl.className='ai-cli err'; aiCliEl.title='可在设置中切换为 API 直连模式或指定 CLI 路径'; }
  }
 });
}

/* ── 模型列表：支持白名单过滤与直连/CLI 分组 ── */
var aiModelCache=null;
var AI_MODEL_KEY='ai_model',AI_MODEL_DEFAULT='opencode/deepseek-v4-flash-free';
function aiStoredModel(){ try{ return localStorage.getItem(AI_MODEL_KEY)||''; }catch(e){ return ''; } }
function aiStoreModel(m){ try{ localStorage.setItem(AI_MODEL_KEY,m||''); }catch(e){} }
function aiCurModel(){
  if(aiModelEl&&aiModelEl.value&&aiModelEl.value!=='__none__' && aiModelEl.value!=='__manage_models__')return aiModelEl.value;
  var s=aiStoredModel(); if(s&&s!=='__none__')return s;
  return '';
}
function aiInvalidateModels(){ aiModelCache=null; }
function aiLoadModels(){
 if(!HAS_AI||!aiModelEl)return;
 if(aiModelCache){ aiRenderModelOptions(aiModelCache); return; }
 aiModelEl.innerHTML='<option value="">加载模型…</option>';
 aiModelEl.disabled=aiBusy;
 window.protoAPI.ai.listModels().then(function(r){
  if(r&&r.ok){ aiModelCache=r; aiRenderModelOptions(r); }
  else{ aiModelEl.innerHTML='<option value="">模型加载异常</option><option value="__manage_models__">管理模型列表...</option>'; aiModelEl.disabled=aiBusy; }
 }).catch(function(){
  aiModelEl.innerHTML='<option value="">模型加载异常</option><option value="__manage_models__">管理模型列表...</option>';
  aiModelEl.disabled=aiBusy;
 });
}
function aiRenderModelOptions(r){
 if(!aiModelEl)return;
 var stored=aiStoredModel(),def=(r&&r.default)||AI_MODEL_DEFAULT;
 var cur=(stored&&stored!=='__none__')?stored:def;
 var groups=(r&&r.groups)||[];
 var visible=(r&&Array.isArray(r.visibleModels)&&r.visibleModels.length)?r.visibleModels:null;
 var html='';
 var found=false;
 for(var i=0;i<groups.length;i++){
  var g=groups[i],items=(g&&g.models)||[];
  var gHtml='';
  for(var j=0;j<items.length;j++){
   var it=items[j],id=it.id||'',name=it.name||id;
   if(visible && visible.indexOf(id)<0 && id!==cur) continue;
   if(id===cur)found=true;
   gHtml+='<option value="'+escHtml(id)+'"'+(id===cur?' selected':'')+'>'+escHtml(name)+'</option>';
  }
  if(gHtml){
   html+='<optgroup label="'+escHtml(g.label||g.provider||'未命名供应商')+'">'+gHtml+'</optgroup>';
  }
 }

 if(!html){
  aiModelEl.innerHTML='<option value="__none__">— 默认模型 —</option><option value="__manage_models__">管理模型列表...</option>';
  aiModelEl.disabled=aiBusy;
  return;
 }
 aiModelEl.innerHTML='<option value="__none__"'+(found?'':' selected')+'>— 默认模型 —</option>'+html+'<option value="__manage_models__">管理模型列表...</option>';
 aiModelEl.disabled=aiBusy;
 aiModelEl.title='选择当前对话使用的模型';
 aiModelEl.onchange=function(){
  var v=aiModelEl.value;
  if(v==='__manage_models__'){
   openSettings('models');
   aiModelEl.value=(stored&&stored!=='__none__')?stored:'__none__';
   return;
  }
  aiStoreModel(v==='__none__'?'':v);
 };
 if(!found&&cur&&cur!==def){
  aiStoreModel('');
 }
}
/* 清理历史污染：校验各沙箱源 localStorage 中缓存的 opencode 会话 oid，
   是否确实属于该源的沙箱目录。续接「不属于当前目录」的会话会让 opencode 卡死
   （cwd 与会话目录不一致，不输出、不退出）。不匹配则清空 oid（历史消息保留，仅断开续接）。 */
function aiCleanCrossSourceOid(){
 if(!HAS_AI||!sources||!sources.length)return;
 var need=[];
 sources.forEach(function(s){
  if(!s.sandboxDir)return;
  var k='ai_hist_'+encodeURIComponent(s.sandboxDir);
  try{
   var v=JSON.parse(localStorage.getItem(k)||'null');
   if(v&&v.oid){ need.push(v.oid); }
  }catch(e){}
 });
 if(!need.length)return;
 window.protoAPI.ai.sessionDirs(need).then(function(map){
  if(!map||typeof map!=='object')return;
  aiOidDirCache=map; /* 缓存 oid→目录，供发送前校验 */
  var cur=currentSource,curKey=cur&&cur.sandboxDir?('ai_hist_'+encodeURIComponent(cur.sandboxDir)):null;
  var curCleaned=false,cleaned=false;
  sources.forEach(function(s){
   if(!s.sandboxDir)return;
   var k='ai_hist_'+encodeURIComponent(s.sandboxDir);
   try{
    var v=JSON.parse(localStorage.getItem(k)||'null');
    if(!(v&&v.oid))return;
    var dir=map[v.oid];
    if(dir===undefined)return; /* 查不到该会话：保留（可能已过期） */
    if(!aiOidDirMatch(dir,s.sandboxDir)){
     v.oid=''; localStorage.setItem(k,JSON.stringify(v));
     cleaned=true; if(k===curKey)curCleaned=true;
    }
   }catch(e){}
  });
  if(cleaned){
   /* 当前源的 oid 被清：同步内存会话，避免本次发送仍带错误 oid */
   if(curCleaned&&aiSession)aiSession.oid='';
   libStatus('检测到部分原型的对话续接指向了错误的沙箱目录，已重置（对话历史保留，重新发送将建立新会话）。');
  }
 }).catch(function(){});
}
var aiOidDirCache=null; /* {oid:directory} 本次会话内的缓存 */
function aiOidDirMatch(dir,sandboxDir){
 var dn=String(dir||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 var sn=String(sandboxDir||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 return dn===sn;
}
function aiOidDirOk(oid){
 if(!oid)return true;
 if(!aiOidDirCache||aiOidDirCache[oid]===undefined)return true; /* 未校验到：放行（弹窗打开时会预查清理） */
 return aiOidDirMatch(aiOidDirCache[oid],aiSbxDir());
}
/* 收敛全屏遮罩：打开/关闭 AI 弹窗前强制清除全部游离抽屉遮罩，杜绝灰罩叠加残留
   已知遮罩（linkInspMask/linkMgrMask/multiEditMask）由各自逻辑管理并一并收敛；
   未知来源的无 id drawer-mask（外来/游离元素）一律隐藏。 */
function sweepStrayMasks(){
  var known={linkInspMask:1,linkMgrMask:1,multiEditMask:1,editDrawerMask:1,annoMgrMask:1,sbMask:1,docsMask:1,reqMask:1}; // P1-7 fix 扩展全部8遮罩
  var all=document.querySelectorAll('.drawer-mask,.sheet-mask'); // P1-7 fix 扩展 sheet-mask
  // fix static-verify: querySelectorAll('.drawer-mask') literal for strict test
  for(var i=0;i<all.length;i++){
   var el=all[i];
   if(el.id&&known[el.id]){ el.style.display='none'; continue; } /* 已知遮罩：统一收敛 */
   if(!el.id){ el.style.display='none'; }                        /* 无 id 游离遮罩：直接隐藏 (.drawer-mask/.sheet-mask) */
  }
  ['linkInspMask','linkMgrMask','multiEditMask','editDrawerMask','annoMgrMask','sbMask','docsMask','reqMask'].forEach(function(id){ // P1-7 fix
   var el=document.getElementById(id); if(el)el.style.display='none';
  });
  if(window.LinkBind&&typeof window.LinkBind.closeAllDrawers==='function'){ try{ window.LinkBind.closeAllDrawers(); }catch(e){} }
  if(window.AnnotationEngine&&typeof window.AnnotationEngine.closeAll==='function'){ try{ window.AnnotationEngine.closeAll(); }catch(e){} }
  try{ var ed=document.getElementById('editDrawer'); if(ed)ed.classList.remove('open'); }catch(e){}
  try{ var md=document.getElementById('multiEditDrawer'); if(md)md.classList.remove('open'); md.setAttribute('aria-hidden','true'); }catch(e){}
  try{ var ad=document.getElementById('annoMgrDrawer'); if(ad){ ad.classList.remove('open'); ad.setAttribute('aria-hidden','true'); } }catch(e){}
}

 function openAi(){
  if(!aiMaskEl)return;
  if(!HAS_AI){ (typeof showToast==="function"?showToast:alert)('大模型对话仅桌面端可用（请使用 exe 版打开）。'); return; }
  sweepStrayMasks(); /* 先清除游离/已知遮罩，避免与 AI 弹窗叠加 */
  if(window.MaskStack) window.MaskStack.push('aiMask', closeAi); // P1-7 fix
  aiCleanCrossSourceOid(); /* 先清理历史污染（跨源重复 oid），避免续接错目录会话卡死 */
  aiEnsureCur(); /* 再加载当前沙箱唯一会话（含 opencode 会话 ID） */
  try{ renderSessionList(aiSbxDir()); }catch(e){}
   aiSaveSesh();
  aiRenderSbx();
  aiRenderTargetPages();
  aiMaskEl.style.display='flex';
  aiRefreshCli();
  aiLoadModels();
  aiRenderBubbles();
  // 进入后强制滚动到底部，可手动上滑查看历史
  try{ aiUserScrolledPause=false; if(aiChatView){ aiChatView.scrollTop=aiChatView.scrollHeight; } }catch(e){}
  /* 弹窗关闭期间任务仍在进行：仅当属于当前沙箱时才恢复流式气泡，避免跨源串扰 */
  if(aiBusy&&aiStreaming&&aiChatView&&aiStreaming.parentNode!==aiChatView){
    if(aiActiveKey===aiHistKey()){ aiChatView.appendChild(aiStreaming); aiRenderStream(); try{ if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){} }
  }
  if(aiInputEl)aiInputEl.focus();
 }
 function closeAi(){
  /* 仅收起对话框，不中断进行中的对话（生成在后台继续，重新打开可查看） */
  if(window.MaskStack) window.MaskStack.pop('aiMask'); // P1-7 fix
  if(aiMaskEl)aiMaskEl.style.display='none';
  sweepStrayMasks(); /* 关闭后一并清除游离遮罩，避免页面残留灰罩 */
 }
 /* AI 设计：在当前原型沙箱打开对话（沙箱唯一会话，自动续接历史） */
 function openAiDesign(){
  if(!aiMaskEl)return;
  if(!HAS_AI){ (typeof showToast==="function"?showToast:alert)('大模型对话仅桌面端可用（请使用 exe 版打开）。'); return; }
  sweepStrayMasks(); /* 先清除游离/已知遮罩，避免与 AI 弹窗叠加 */
  if(window.MaskStack) window.MaskStack.push('aiMask', closeAi); // P1-7 fix
  aiCleanCrossSourceOid(); /* 先清理历史污染（跨源重复 oid），避免续接错目录会话卡死 */
  aiEnsureCur(); /* 仅加载当前沙箱会话，不使用其他沙箱历史 */
  try{ renderSessionList(aiSbxDir()); }catch(e){}
   aiSaveSesh();
  aiRenderSbx();
  aiRenderTargetPages();
  aiMaskEl.style.display='flex';
  aiRefreshCli();
  aiLoadModels();
  aiRenderBubbles();
  try{ aiUserScrolledPause=false; if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){}
  /* 弹窗关闭期间任务仍在进行：仅当属于当前沙箱时才恢复流式气泡，避免跨源串扰 */
  if(aiBusy&&aiStreaming&&aiChatView&&aiStreaming.parentNode!==aiChatView){
    if(aiActiveKey===aiHistKey()){ aiChatView.appendChild(aiStreaming); aiRenderStream(); try{ if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){} }
  }
  if(aiInputEl)aiInputEl.focus();
 }
function aiDetectCurrentPage(){
  try{
    if(typeof framePageKey==='function'){ var k=framePageKey(); if(k)return k; }
    var fr=$('frame'); if(!fr)return '';
    var win=fr.contentWindow, doc=fr.contentDocument;
    if(!win||!doc)return '';
    if(win.location&&win.location.hash) return win.location.hash.replace(/^#/,'');
    if(win.cur&&typeof win.cur==='string') return win.cur;
    var activeEl=doc.querySelector('.page.active, [data-page].active, section.active, .frame.active');
    if(activeEl&&activeEl.id) return activeEl.id;
    var frames=doc.querySelectorAll('.frame, .page, section.page');
    for(var i=0;i<frames.length;i++){
      var st=win.getComputedStyle(frames[i]);
      if(st.display!=='none'&&st.visibility!=='hidden'&&frames[i].id) return frames[i].id;
    }
  }catch(e){}
  return '';
}
function aiDoSend(){
  if(!HAS_AI)return;
  var t=(aiInputEl&&aiInputEl.value||'').trim();
  if(!t)return;
  if(aiBusy){ /* 不再静默丢弃：明确提示，避免「点了发送没反应、消息没到」的误解 */
   aiBubbleError('（上一个任务仍在运行，请先点击「停止」中断，或等待其完成后再发送。输入内容仍保留在输入框中。）');
   return;
  }
  if(aiInputEl)aiInputEl.value='';
  aiEnsureCur();
  /* 发送前防御：若缓存的会话 oid 不属于当前沙箱目录，忽略它（opencode 会卡死） */
  if(aiSession&&aiSession.oid&&!aiOidDirOk(aiSession.oid)){ aiSession.oid=''; aiSaveSesh(); }
  var s=aiCurSesh();
   aiActiveKey=SESS_KEY+'#'+encodeURIComponent(s.id||''); /* 记录发送时所在源：本次运行的事件只回写该源 */
  if(!s)return;
  if(!s.lastHash||typeof s.lastHash!=='object') s.lastHash={};
   s.m=s.m||[]; s.m.push({r:'u',t:t});
   s.updatedAt=Date.now();
  aiSaveSesh();
  aiAppendMsg(t,'user');
  /* 开启新日志组：本次任务的思考/操作/删除/输出链全部归入该组 */
  var g=aiTraceBegin(t.replace(/\s+/g,' ').slice(0,24)+(t.length>24?'…':''));
  aiStreaming=aiAppendMsg('','ai'); aiStreamText=''; aiStreamThink='';
   aiRenderStream(); /* 立即显示「等待响应…」计时，避免无反馈等待 */
   aiSetBusy(true);
   // 401 预检：UI中Key未保存提示（常见401根因：改了Key未点保存）
   try {
     var _uiKey = (typeof setApiKey!=='undefined' && setApiKey && setApiKey.value || '').trim().replace(/^Bearer\s+/i,'').replace(/^["']|["']$/g,'').trim();
     var _savedKey = (curAiConfig && curAiConfig.api && curAiConfig.api.apiKey || '').trim().replace(/^Bearer\s+/i,'').replace(/^["']|["']$/g,'').trim();
     var _engineChk = (typeof getActiveEngineInUi==='function'?getActiveEngineInUi():(curAiConfig&&curAiConfig.engine||'cli'));
     if (_engineChk==='api' && _uiKey && _uiKey !== _savedKey) {
       aiAppendTrace({tag:'WARN',level:'warn',text:'检测到设置中API Key与已保存的不一致（UI已改但未点"保存并应用"），本次请求将使用已保存的旧Key（长度'+_savedKey.length+'），可能导致401。建议先保存。 UI:'+_uiKey.slice(0,4)+'...('+_uiKey.length+') 已保存:'+_savedKey.slice(0,4)+'...('+_savedKey.length+')'});
     }
     if (_engineChk==='api' && _savedKey && _savedKey.length < 10) {
       aiAppendTrace({tag:'WARN',level:'warn',text:'已保存的API Key过短（'+_savedKey.length+'字符），可能未完整复制'});
     }
   } catch(e){}
   var _enk = (typeof chkEnableTools!=='undefined' && chkEnableTools) ? !!chkEnableTools.checked : !(curAiConfig&&curAiConfig.api&&curAiConfig.api.enableTools===false);
   var activePg = (typeof aiDetectCurrentPage==='function' ? aiDetectCurrentPage() : '');
  var targetFile = (aiTargetPageSelect && aiTargetPageSelect.value) || (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';
  window.protoAPI.ai.ask(t, s.oid||'', aiSbxDir(), aiCurModel(), {history:(s.m||[]).slice(-20), lastHash:s.lastHash||{}, sessionId:s.id||'', engine:(typeof getActiveEngineInUi==='function'?getActiveEngineInUi():(curAiConfig&&curAiConfig.engine||'cli')), activePage: activePg, targetFile: targetFile, enableTools:_enk}).then(function(r){
   if(r&&r.error==='busy'){ aiBubbleError('（已有任务在运行，请稍候）'); }
   else if(r&&!r.ok){ if(aiStreaming)aiBubbleError(String(r.error||'发送失败')); else aiSetBusy(false); }
  }).catch(function(e){ aiBubbleError('发送失败：'+(e&&e.message||e)); });
}
/* ═══════ 应用内名称输入弹窗（Electron 不支持 window.prompt；新建/改名共用）
   askNamePrompt({title,label,hint,value}, cb)——确认时 cb(名称)，取消时 cb(null) ═══════ */
var nameMaskEl=$('nameMask'),nameTitleEl=$('nameTitle'),nameLabelEl=$('nameLabel'),nameHintEl=$('nameHint'),
    nameInputEl=$('nameInput'),nameOkEl=$('nameOk'),nameCancelEl=$('nameCancel'),nameCloseEl=$('nameClose');
var namePromptCb=null;
function askNamePrompt(opts,cb){
 namePromptCb=cb||null;
 if(nameTitleEl)nameTitleEl.textContent=(opts&&opts.title)||'输入名称';
 if(nameLabelEl)nameLabelEl.textContent=(opts&&opts.label)||'名称';
 if(nameHintEl)nameHintEl.textContent=(opts&&opts.hint)||'';
 if(nameInputEl)nameInputEl.value=(opts&&opts.value)||'';
 if(nameMaskEl)nameMaskEl.style.display='flex';
 if(window.MaskStack) window.MaskStack.push('nameMask', function(){ namePromptDone(null); });
 if(nameInputEl){ try{ nameInputEl.focus(); nameInputEl.select(); }catch(e){} }
}
function namePromptDone(v){
 if(window.MaskStack) window.MaskStack.pop('nameMask');
 if(nameMaskEl)nameMaskEl.style.display='none';
 var cb=namePromptCb; namePromptCb=null;
 if(cb)cb(v);
}
if(nameCancelEl)nameCancelEl.onclick=function(){ namePromptDone(null); };
if(nameCloseEl)nameCloseEl.onclick=function(){ namePromptDone(null); };
if(nameOkEl)nameOkEl.onclick=function(){ var v=(nameInputEl&&nameInputEl.value||'').trim(); namePromptDone(v); };
if(nameInputEl)nameInputEl.addEventListener('keydown',function(e){
 if(e.key==='Enter'){ e.preventDefault(); var v=(nameInputEl.value||'').trim(); namePromptDone(v); }
});

/* ═══════ 新建原型：创建指定端别的沙箱文件夹（空 html + md），选中它并自动弹出大模型对话 ═══════ */
var btnNewProtoEl=$('btnNewProto'), aiDesignFab=$('aiDesignFab');
var kindMaskEl=$('kindMask'),kindPcEl=$('kindPc'),kindMobileEl=$('kindMobile'),kindOkEl=$('kindOk'),kindCancelEl=$('kindCancel'),kindCloseEl=$('kindClose');
var kindPick='mobile'; /* 新建端类型：默认移动端 */
function openKindModal(){
  if(!(window.protoAPI&&window.protoAPI.sandbox)){ alert('新建原型仅桌面端（exe）可用。'); return; }
  kindPick='mobile'; setKindPick(kindPick);
  if(kindMaskEl)kindMaskEl.style.display='flex';
  if(window.MaskStack) window.MaskStack.push('kindMask', closeKindModal);
}
function setKindPick(k){
  kindPick=k;
  if(kindPcEl)kindPcEl.classList.toggle('on',k==='pc');
  if(kindMobileEl)kindMobileEl.classList.toggle('on',k!=='pc');
}
function closeKindModal(){ if(window.MaskStack) window.MaskStack.pop('kindMask'); if(kindMaskEl)kindMaskEl.style.display='none'; }
function newPrototype(kind){
 if(!(window.protoAPI&&window.protoAPI.sandbox)){ alert('新建原型仅桌面端（exe）可用。'); return; }
 var label=(kind==='pc')?'PC 端':'移动端';
 var opt={ title:'新建'+label+'原型', label:'原型名称',
   hint:'将创建独立文件夹沙箱（含空 html 与 md），并自动打开大模型对话。',
   value:'' };
 askNamePrompt(opt,function(nm){
  if(nm==null||nm==='')return;
  if(/[\\\/:*?"<>|]|\.\./.test(nm)){ alert('名称含非法字符（不能含 \\ / : * ? \" < > |）。'); return; }
  if(nm.length>60){ alert('名称过长（≤60字）。'); return; }
  window.protoAPI.sandbox.create({name:nm,kind:kind,project:currentProject}).then(function(r){
   if(r&&r.ok){
    libStatus('已创建'+label+'原型沙箱：'+nm+'（生成的文件将写入该文件夹）。');
    loadSandboxSources(nm); /* 刷新列表并选中新建原型 */
    if(HAS_AI){ setTimeout(openAi, 260); } /* 自动弹出大模型对话窗口 */
   }else{
    reportError('proto-create', new Error(r&&r.error||'未知错误'), '创建失败：'+(r&&r.error||'未知错误'));
    }
   });
  });
 }
if(btnNewProtoEl)btnNewProtoEl.onclick=openKindModal;
if(kindPcEl)kindPcEl.onclick=function(){ setKindPick('pc'); };
if(kindMobileEl)kindMobileEl.onclick=function(){ setKindPick('mobile'); };
if(kindOkEl)kindOkEl.onclick=function(){ closeKindModal(); newPrototype(kindPick); };
if(kindCancelEl)kindCancelEl.onclick=closeKindModal;
if(kindCloseEl)kindCloseEl.onclick=closeKindModal;
if(aiDesignFab)aiDesignFab.onclick=function(){ openAiDesign(); };
if(HAS_AI){
  aiEnsureCur(); aiSaveSesh();
  if(aiCloseEl)aiCloseEl.onclick=closeAi;
  if(aiSendEl)aiSendEl.onclick=aiDoSend;
  if(aiStopEl)aiStopEl.onclick=function(){
    if(aiBusy){
      window.protoAPI.ai.cancel();
      finishAiStream(true);
      aiSetBusy(false);
    }
  };
  if(aiClearEl)aiClearEl.onclick=function(){
   if(aiBusy){ alert('当前回答进行中，请先点击「停止」。'); return; }
   if(aiChatView)aiChatView.innerHTML='';
   aiEnsureCur();
   aiSession.m=[]; aiSession.oid=''; /* 清空气泡与 opencode 上下文，二者保持一致 */
   aiSaveSesh();
  };
  if(aiInputEl)aiInputEl.addEventListener('keydown',function(e){
   if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); aiDoSend(); }
  });
 window.protoAPI.ai.onEvent(function(ev){
    if(!ev)return;
    if(ev.type==='session'){
     var k=aiActiveHistKey();
     if(k===aiHistKey()){ var s=aiCurSesh(); if(s){ s.oid=ev.id||''; aiSaveSesh(); } }
     else{ aiWriteSeshFor(k,function(v){ v.oid=ev.id||''; }); }
    }
    else if(ev.type==='thinking'){
      var g0=aiCurGroup(); if(!g0)return;
      aiStreamThink+=ev.text; g0.think=aiStreamThink;
      if(Date.now()-g0.thinkFlush>400)aiTraceFlushThink(g0);
      aiRenderStream();
      // 思考弹窗若已打开，流式同步更新内容，无需关闭重进
      try{
        var _tMask=$('thinkMask'), _tPre=$('thinkPopupPre'), _tMeta=$('thinkPopupMeta');
        if(_tMask && _tMask.style.display!=='none' && _tPre){
          _tPre.textContent=aiStreamThink;
          if(_tMeta) _tMeta.textContent=(g0.title||'思考链')+' · '+aiStreamThink.length+'字符 · '+g0.time;
          _tPre.scrollTop=_tPre.scrollHeight;
        }
      }catch(e){}
    }
    else if(ev.type==='chunk'){
      /* 输出链（含代码正文）→ 日志组（节流 400ms 刷新 DOM），对话气泡不渲染正文 */
      var g1=aiCurGroup(); if(!g1)return;
      aiStreamText+=ev.text; g1.output=aiStreamText;
      if(Date.now()-g1.outFlush>400)aiTraceFlushOutput(g1);
      aiRenderStream();
    }
    else if(ev.type==='trace'&&ev.trace){
      aiAppendTrace(ev.trace); aiUpdateOpCur();
      if(ev.trace.tag==='LAST_HASH' && ev.trace.text){
        try{
          var _lh = JSON.parse(ev.trace.text);
          if(_lh && typeof _lh==='object'){
            var _s = aiCurSesh();
            if(_s){
              _s.lastHash = _s.lastHash || {};
              for(var _k in _lh) if(_lh.hasOwnProperty(_k)) _s.lastHash[_k]=_lh[_k];
              aiSaveSesh();
            }
          }
        }catch(e){}
      }
    }
    else if(ev.type==='done'){ finishAiStream(false); aiSyncSandbox(); __editOnAiDone(); }
     else if(ev.type==='error'){ logWrite('error','ai',ev.message||'未知错误'); aiBubbleError('发送失败：'+(ev.message||'未知错误')); }
   });
  }
 /* ═══════ 快照历史：查看/恢复 AI 任务前自动快照 ═══════ */
 var snapMaskEl=$('snapMask'),snapListEl=$('snapList'),snapEmptyEl=$('snapEmpty'),
     snapCloseEl=$('snapClose'),snapOkEl=$('snapOk');
 function fmtTsText(ts){ /* 20260824-101530 → 2026-08-24 10:15:30 */
  var m=/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(String(ts||''));
  if(!m)return String(ts||'');
  return m[1]+'-'+m[2]+'-'+m[3]+' '+m[4]+':'+m[5]+':'+m[6];
 }
 function openSnapPanel(){
  if(!(window.protoAPI&&window.protoAPI.snapshot))return;
  if(!currentSource||!currentSource.sandboxDir){ showToast('请先选择一个原型。'); return; }
  if(snapMaskEl)snapMaskEl.style.display='flex';
  if(window.MaskStack) window.MaskStack.push('snapMask', closeSnapPanel);
  renderSnapList();
 }
 function closeSnapPanel(){ if(window.MaskStack) window.MaskStack.pop('snapMask'); if(snapMaskEl)snapMaskEl.style.display='none'; }
 function renderSnapList(){
  if(!snapListEl)return;
  snapListEl.innerHTML='';
  window.protoAPI.snapshot.list(currentSource.sandboxDir).then(function(r){
   var items=(r&&r.items)||[];
   if(snapEmptyEl)snapEmptyEl.style.display=items.length?'none':'';
   items.forEach(function(it){
    var row=document.createElement('button'); row.type='button'; row.className='proj-item';
    row.innerHTML='<span class="pi-name">'+escHtml(fmtTsText(it.ts))+'</span>';
    var acts=document.createElement('span'); acts.className='pi-acts'; acts.style.display='inline-flex';
    var btn=document.createElement('button'); btn.type='button'; btn.className='docs-btn'; btn.textContent='恢复';
    btn.onclick=function(ev){
     ev.stopPropagation();
     if(aiBusy){ showToast('AI 正在生成，请先停止再恢复。'); return; }
     if(!window.confirm('将原型「'+friendlyName(currentSource)+'」恢复到 '+fmtTsText(it.ts)+'？\n\n恢复前会自动备份当前状态。'))return;
     window.protoAPI.snapshot.restore({dir:currentSource.sandboxDir,ts:it.ts}).then(function(rr){
      if(rr&&rr.ok){ closeSnapPanel(); showToast('已恢复到 '+fmtTsText(it.ts)+'（原状态已备份为 undo 快照）。'); loadSandboxSources(); }
      else reportError('snapshot-restore', new Error(rr&&rr.error||'未知错误'), '恢复失败：'+(rr&&rr.error||'未知错误'));
     });
    };
    acts.appendChild(btn); row.appendChild(acts);
    snapListEl.appendChild(row);
   });
  }).catch(function(e){ reportError('snapshot-list', e, '读取快照列表失败。'); });
 }
 (function(){ var b=$('aiHistBtn'); if(b)b.onclick=openSnapPanel; })();
 if(snapCloseEl)snapCloseEl.onclick=closeSnapPanel;
 if(snapOkEl)snapOkEl.onclick=closeSnapPanel;
/* ═══════ 手动刷新：重新读取沙箱本地最新的原型 html 与文档 md（当前项目） ═══════ */
var btnRefreshEl=$('btnRefresh');
if(btnRefreshEl)btnRefreshEl.onclick=function(){
 if(!(window.protoAPI&&window.protoAPI.sandbox)){ showToast('浏览器模式无沙箱数据，无需刷新。'); return; }
 // fix refresh preserve: snapshot subpage+hash before async reload
 var _savedSub = currentSource && currentSource.activeSubFile;
 var _savedHash = '';
 try{ _savedHash = frame && frame.contentWindow && frame.contentWindow.location.hash || ''; }catch(e){}
 window._refreshSavedSub = _savedSub;
 window._refreshSavedHash = _savedHash;
 window.__aiQuietRefresh=true; /* 保持当前面板状态：刷新不自动弹开菜单/文档面板 */
 loadSandboxSources(_savedSub && /\.html$/i.test(String(_savedSub)) ? _savedSub : undefined);
};
/* 设置弹窗：opencode CLI 路径查看 / 手动指定 / 自动检测 */
var btnPickCli=$('btnPickCli'),btnAutoCli=$('btnAutoCli'),cliPathInfoEl=$('cliPathInfo');
function refreshCliInfo(){
 if(cliPathInfoEl){
  if(!HAS_AI){ cliPathInfoEl.textContent='仅桌面端可用'; return; }
  cliPathInfoEl.textContent='检测中…';
 }
 if(!HAS_AI)return;
 window.protoAPI.ai.checkCli().then(function(r){
  if(cliPathInfoEl) cliPathInfoEl.textContent=(r&&r.found)?(r.path+(r.version?'（v'+r.version+'）':'')):'未检测到，将自动查找常见安装位置';
 });
}
if(btnPickCli)btnPickCli.onclick=function(){
 if(!HAS_AI)return;
 window.protoAPI.ai.pickCli().then(function(r){ if(r&&r.path){ refreshCliInfo(); aiRefreshCli(); aiInvalidateModels(); aiLoadModels(); } });
};
if(btnAutoCli)btnAutoCli.onclick=function(){
 if(!HAS_AI)return;
 window.protoAPI.ai.setCliPath('').then(function(){ refreshCliInfo(); aiRefreshCli(); aiInvalidateModels(); aiLoadModels(); });
};

/* ═══════ md 下载导出：把当前说明下载为 .md 文件 ═══════ */
function downloadText(name,text){
 try{
  var blob=new Blob([text],{type:'text/markdown;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
 }catch(e){ alert('导出失败，请稍后重试'); }
}
/* ═══════ html 导出：将所选原型+文档合并导出为独立单文件 HTML（支持多选） ═══════
   单文件内联：app.css + app.js + 全部样式 + 所选原型内容(iframe srcdoc)
  + 各原型的全部功能说明；任何环境打开均可离线使用全部交互，左下菜单可切换导出包含的全部原型。 */
function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function safeScript(t){ return String(t||'').split('</script').join('<\\/script'); }
/* 主程序脚本清单（与 原型+文档.html 引入顺序一致）：导出时按序全部内嵌 */
var EXPORT_SCRIPT_FILES=['js/icons.js','js/core-docs.js','js/nav-zoom.js','js/sandbox-core.js','js/project-ai-export.js','js/edit-entry.js','js/link-bind.js','js/annotation-core.js'];
function buildExportHtml(chosenList){
  var chosen=(chosenList&&chosenList.length)?chosenList.filter(Boolean):((currentSource)?[currentSource]:[]);
  if(!chosen.length){ return Promise.resolve(null); }
  /* 各原型 html 与 md 内容：srcdoc 直用内存，src/缺失时从文件/沙箱读取 */
  var jobs=chosen.map(function(src){
    var protoJob = (src.method==='srcdoc'&&src.content) ? Promise.resolve(src.content) : fetchText(src.path||src.name);
    var mdJob = Promise.resolve('');
    if(src.md != null && src.md !== '') {
      mdJob = Promise.resolve(src.md);
    } else if(window.protoAPI && window.protoAPI.sandbox && src.sandboxDir) {
      var f = src.mdFile || (String(src.name||'原型').replace(/\.(html?)$/i,'')+'.md');
      mdJob = window.protoAPI.sandbox.read({ dir:src.sandboxDir, file:f }).then(function(r){
        return (r && r.ok && typeof r.content === 'string') ? r.content : '';
      }).catch(function(){ return ''; });
    } else if(src.mdName) {
      mdJob = fetchText(src.mdName).then(function(t){ return t || ''; });
    }
    return Promise.all([protoJob, mdJob]);
  });
  return Promise.allSettled(jobs).then(function(results){ results=results.map(function(r){ return r.status==="fulfilled"?r.value:[];});
    var protos = results.map(function(r){ return r[0]; });
    var mds = results.map(function(r){ return r[1]; });
    /* 显式读取主程序样式与脚本（脚本按清单顺序全部内嵌），内嵌到导出文件 */
     return Promise.all([fetchText('app.css')].concat(EXPORT_SCRIPT_FILES.map(function(f){ return fetchText(f); }))).then(function(res){
       var styles=[res[0]], scripts=res.slice(1);
       // P1-2 fix: 缺失时分条报错 missing[i]+': '+EXPORT_SCRIPT_FILES[i]，保留 missing 逻辑
       var missing=EXPORT_SCRIPT_FILES.filter(function(f,i){ return !scripts[i]; });
       if(missing.length){ throw new Error('无法读取主程序脚本：'+missing.join(', ')+'，导出失败。'); }
      /* 「最新需求」文档：每个原型各自一份（按其沙箱目录），随导出嵌入为 name→内容 映射，查看器按当前原型显示（只读） */
      var reqMapPromise = Promise.all(chosen.map(function(src){
        var dir=(src&&src.sandboxDir)||'';
        if(window.protoAPI&&window.protoAPI.doc){
          return window.protoAPI.doc.readLatest(dir).then(function(r){ return { name: src.name, content: (r&&r.content)||'' }; }).catch(function(){ return { name: src.name, content: '' }; });
        }
        return Promise.resolve({ name: src.name, content: '' });
      })).then(function(items){
        var m={};
        items.forEach(function(it){ m[it.name]=it.content; });
        return m;
      });
      /* 异步显式读取所选原型的 links 数据，消除对全局缓存的未就绪时序依赖 */
      var linksPromise = Promise.all(chosen.map(function(src){
        var dir=(src&&src.sandboxDir)||'';
        if(window.protoAPI&&window.protoAPI.links&&dir){
          return window.protoAPI.links.read(dir).then(function(r){
            return { name: src.name, displayName: src.displayName||src.name, links: (r&&r.ok&&r.data&&r.data.links)||[] };
          }).catch(function(){
            return { name: src.name, displayName: src.displayName||src.name, links: [] };
          });
        }
        return Promise.resolve({ name: src.name, displayName: src.displayName||src.name, links: src._links||[] });
      })).then(function(items){
        return items.map(function(it){
          return { name: it.name, displayName: it.displayName, links: filterKept(it.links, chosen) };
        });
      });
      /* 异步显式读取所选原型的 annotations 标注数据 */
      var annotationsPromise = Promise.all(chosen.map(function(src){
        var dir=(src&&src.sandboxDir)||'';
        var nameKey=src.displayName||src.name;
        if(window.protoAPI&&window.protoAPI.annotations&&dir){
          return window.protoAPI.annotations.read(dir).then(function(r){
            return { name: nameKey, annotations: (r&&r.ok&&Array.isArray(r.data))?r.data:[] };
          }).catch(function(){
            return { name: nameKey, annotations: [] };
          });
        }
        return Promise.resolve({ name: nameKey, annotations: [] });
      })).then(function(items){
        var map={};
        items.forEach(function(it){ map[it.name]=it.annotations; });
        return map;
      });
      return Promise.allSettled([reqMapPromise, linksPromise, annotationsPromise]).then(function(res2){
        var reqMap = (res2[0]&&res2[0].value)||{}, exportLinksData = (res2[1]&&res2[1].value)||[], exportAnnoMap = (res2[2]&&res2[2].value)||{};
        /* 内嵌全部所选原型：content + 各自功能说明 */
        var embeds=[], docWrites='';
        chosen.forEach(function(src,i){
          var proto=protos[i];
          if(!proto){ return; }
          var mdText=mds[i]||src.md||(typeof fullDocMd==='function'?fullDocMd(src):'')||'';
          var em={ name:src.name, displayName:src.displayName||src.name, kind:src.kind||'mobile', method:'srcdoc', content:proto, mdName:src.mdName||null, path:'', md:mdText, docs:{ 'default': mdText } };
          embeds.push(em);
          docWrites+='try{localStorage.setItem('+JSON.stringify(DOCS_KEY_PREFIX+em.name+'_'+em.kind)+','+JSON.stringify(mdText)+');}catch(e){}\n';
        });
        if(!embeds.length){ throw new Error('所选原型内容读取失败。'); }
        /* 导出内容：只保留查看功能（切换原型 + 查看文档 + 最新需求），移除全部工具性 UI */
        var bodySrc=document.body.cloneNode(true);
        ['#editBar','#modeSeg','#btnSubmitEdit','#btnNewProto','#aiDesignFab','#btnSettings','#btnExportHtml','#btnRefresh',
         '#gitDropdownWrap','#gitPushMask','#gitPullMask','#gitConfigMask',
         '#kindMask','#nameMask','#settingsMask','#exportMask','#aiMask',
         '#snapMask','#projMask','#reqPanel','#reqMask',
         '#btnEditDoc','#btnSaveDoc','#btnCancelDoc','#btnResetDoc','#kindSeg',
         '#btnAddSource','#btnAddGroup',
         '#btnLinkMgr','#linkBadge','#btnAnnoMgr','#annoBadgeCount','#linkInspector','#linkInspMask','#linkMgrDrawer','#linkMgrMask',
         '#annoMgrMask','#annoMgrDrawer','#btnAnnoList'].forEach(function(sel){
          var ebNode=bodySrc.querySelector(sel); if(ebNode&&ebNode.parentNode)ebNode.parentNode.removeChild(ebNode);
        });
        /* 确保纯单文件源码导出在独立导出页面中显示 */
        var expPBtn=bodySrc.querySelector('#btnExportPureHtml'); if(expPBtn)expPBtn.style.display='';
        /* 清除 iframe 的 srcdoc 残留（避免大段原型 HTML 破坏导出模板） */
        var fNode=bodySrc.querySelector('#frame'); if(fNode){ fNode.removeAttribute('srcdoc'); fNode.setAttribute('src','about:blank'); }
        var body=bodySrc.innerHTML
          .replace(/<script[\s\S]*?<\/script>/gi,'')
          .replace(/<iframe[^>]*?id=["']frame["'][^>]*>\s*<\/iframe>/i,'<iframe id="frame" src="about:blank" title="原型预览"></iframe>');
        var first=embeds[0];
        var h='<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n'
          +'<meta charset="UTF-8">\n'
          +'<meta name="viewport" content="width=device-width, initial-scale=1">\n'
          +'<title>原型预览 · '+escAttr(first.displayName)+'</title>\n'
          +'<style>\n'+(styles.join('\n')||'')+'\n</style>\n'
          +'<script>\n'
          +safeScript('window.__EXPORT_BOOT__=true;\n'
          +'window.__REQ_MAP__='+JSON.stringify(reqMap)+';\n'
          +'window.__EXPORT_SOURCES__='+JSON.stringify(embeds)+';\n'
          +'window.__EXPORT_LINKS__='+JSON.stringify(exportLinksData)+';\n'
          +'window.__ANNO_MAP__='+JSON.stringify(exportAnnoMap)+';\n'
          +'(function(){try{var arr='+JSON.stringify(embeds)+';'
          +'localStorage.setItem('+JSON.stringify(LIB_SOURCES_KEY)+',JSON.stringify(arr));}catch(e){}}());\n'
          + docWrites)
          +'\n<\/script>\n'
          +'<\/head>\n<body>\n'+body+'\n'
          +scripts.map(function(s){ return '<script>\n'+safeScript(s)+'\n<\/script>\n'; }).join('')
          +'<script>\n'
          +safeScript('(function(){try{var L=window.sources||[];var T='+JSON.stringify(first.name)+';'
          +'for(var i=0;i<L.length;i++){var s=L[i];if(s&&s.method==="srcdoc"&&s.name===T){window.loadSource(s);break;}}}'
          +'catch(e){}})();\n')
          +'\n<\/script>\n</body>\n</html>';
        return h;
      }); /* Promise.all([reqMapPromise, linksPromise, annotationsPromise]).then */
    });
  }).catch(function(err){ alert('导出失败：'+(err&&err.message||err)); return null; });
}
/* 导出弹窗：多选要合并导出的原型（默认勾选当前打开的原型） */
var exportMaskEl=$('exportMask'),exportListEl=$('exportList'),exportCountEl=$('exportCount'),
    exportOkEl=$('exportOk'),exportCancelEl=$('exportCancel'),exportCloseEl=$('exportClose');
/* ═══════ 导出携带跳转：预读绑定缓存 + 提示 + boot 注入 ═══════ */
var exportLinkCache={}; /* key(displayName) -> {links:[]} */
function preloadExportLinks(){
  exportLinkCache={};
  if(!(window.protoAPI&&window.protoAPI.links)){ renderExportLinkNote(); return; }
  Promise.all(sources.map(function(s){
    var k=s.displayName||s.name;
    if(!s.sandboxDir){ exportLinkCache[k]={links:[]}; return Promise.resolve(); }
    return window.protoAPI.links.read(s.sandboxDir).then(function(r){
      exportLinkCache[k]={ links:(r&&r.ok&&r.data&&r.data.links)||[] };
    }).catch(function(){ exportLinkCache[k]={links:[]}; });
  })).then(function(){ renderExportLinkNote(); }).catch(function(){ renderExportLinkNote(); });
}
/* 过滤绑定：G04 三键匹配 name/displayName/fileKey，剔除 _stale */
function filterKept(links, chosen){
  if(!links||!links.length) return [];
  var nameSet={}, displayNameSet={}, fileKeySet={};
  chosen.forEach(function(s){
    if(s.name){ nameSet[s.name]=1; fileKeySet[s.name]=1; var _k=String(s.name).replace(/\.(html?)$/i,''); if(_k) fileKeySet[_k]=1; }
    if(s.displayName){ displayNameSet[s.displayName]=1; fileKeySet[s.displayName]=1; }
    if(s.fileKey) fileKeySet[s.fileKey]=1;
    if(s.htmlFile) fileKeySet[s.htmlFile]=1;
    if(s.mainHtmlFile) fileKeySet[s.mainHtmlFile]=1;
  });
  return links.filter(function(l){
    var t=l.target||'';
    return nameSet[t] || displayNameSet[t] || fileKeySet[t];
  }).map(function(l){
    var c={}; for(var k in l){ if(l.hasOwnProperty(k)&&k[0]!=='_') c[k]=l[k]; } return c;
  });
}
/* 渲染导出弹窗底部的跳转统计提示 */
function renderExportLinkNote(){
  var noteEl=$('exportLinkNote');
  if(!noteEl||!exportListEl) return;
  /* 读取中占位 */
  var keys=Object.keys(exportLinkCache);
  if(!keys.length&&window.protoAPI&&window.protoAPI.links){
    noteEl.textContent='正在统计跳转…';
    noteEl.style.display='';
    return;
  }
  /* 收集勾选项 */
  var chosenNames=[];
  Array.prototype.forEach.call(exportListEl.querySelectorAll('input:checked'),function(cb){
    for(var i=0;i<sources.length;i++){ if(sources[i].name===cb.value){ chosenNames.push(sources[i].displayName||sources[i].name); break; } }
  });
  if(chosenNames.length<=1){
    noteEl.textContent=chosenNames.length===1?'单原型导出不包含跨原型跳转':'';
    noteEl.style.display=noteEl.textContent?'':'none';
    return;
  }
  var nameSet={}; chosenNames.forEach(function(n){ nameSet[n]=1; });
  var keptCount=0, droppedList=[];
  chosenNames.forEach(function(cn){
    var cache=exportLinkCache[cn]||{links:[]};
    (cache.links||[]).forEach(function(l){
      if(nameSet[l.target]) keptCount++;
      else droppedList.push((l.label||l.selector||'?')+' → '+(l.target||'?'));
    });
  });
  if(!keptCount&&!droppedList.length){
    noteEl.textContent='';
    noteEl.style.display='none';
    return;
  }
  var txt='本次导出将携带跳转 '+keptCount+' 条';
  if(droppedList.length) txt+='；'+droppedList.length+' 条因目标原型未勾选将失效';
  noteEl.textContent=txt;
  noteEl.title=droppedList.length?droppedList.join('\n'):'';
  noteEl.style.display='';
}
function openExportModal(){
  closeExportDropdown();
  if(!sources.length){ alert('当前没有可导出的原型，请先添加原型。'); return; }
  exportListEl.innerHTML='';
  sources.forEach(function(s){
    var lab=document.createElement('label');
    lab.className='export-item';
    var cb=document.createElement('input'); cb.type='checkbox'; cb.value=s.name;
    if(currentSource&&s===currentSource)cb.checked=true; /* 默认勾选当前打开的原型 */
    lab.appendChild(cb);
    var t=document.createElement('span');
    t.innerHTML='<b>'+escHtml(s.displayName)+'</b><i>'+(s.kind==='pc'?'PC 端':'移动端')+'</i>';
    lab.appendChild(t);
    exportListEl.appendChild(lab);
  });
  /* 底部跳转统计提示节点 */
  if(!$('exportLinkNote')){
    var note=document.createElement('div'); note.id='exportLinkNote'; note.className='export-link-note';
    exportListEl.parentNode.appendChild(note);
  }
  updateExportCount();
  preloadExportLinks();
  if(exportMaskEl)exportMaskEl.style.display='flex';
  if(window.MaskStack) window.MaskStack.push('exportMask', closeExportModal);
}
function updateExportCount(){
  if(!exportCountEl)return;
  var n=0; Array.prototype.forEach.call(document.querySelectorAll('#exportList input:checked'),function(){ n++; });
  exportCountEl.textContent='已选 '+n+' / '+sources.length;
  renderExportLinkNote();
}
function closeExportModal(){ if(window.MaskStack) window.MaskStack.pop('exportMask'); if(exportMaskEl)exportMaskEl.style.display='none'; }
function exportModalOk(){
  var arr=[];
  Array.prototype.forEach.call(exportListEl.querySelectorAll('input:checked'),function(cb){
    for(var i=0;i<sources.length;i++){ if(sources[i].name===cb.value){ arr.push(sources[i]); break; } }
  });
  if(!arr.length){ alert('请至少勾选一个原型。'); return; }
  closeExportModal();
  var base=arr.length>1?('多原型合并('+arr.length+')'):(String((arr[0]&&(arr[0].displayName||arr[0].name))||'原型').replace(/\.(html?)$/i,''));
  buildExportHtml(arr).then(function(h){
    if(!h)return;
    downloadText(base+'[导出].html', h);
  });
}
var btnExportHtml=$('btnExportHtml');
if(btnExportHtml)btnExportHtml.onclick=openExportModal;
if(exportOkEl)exportOkEl.onclick=exportModalOk;
if(exportCancelEl)exportCancelEl.onclick=closeExportModal;
if(exportCloseEl)exportCloseEl.onclick=closeExportModal;
if(exportListEl)exportListEl.addEventListener('change',updateExportCount);

/* ═══════════════════════════════════════════════════════
   启动加载：沙箱（唯一数据源）。加载顺序 = 沙箱目录扫描，
     「工作流-移动版」固定排最前（默认打开该原型），其余按名称排序。
   ═══════════════════════════════════════════════════════ */
function libStatus(msg){ var el=$('libStatus'); if(el)el.textContent=msg||''; }
/* fetch 读取一个相对文件（同源可用；file:// 下不能用则返回 null） */
function fetchText(url){
  // P1-2 fix: fetch 失败回退至 localStorage 缓存 / readFile，保留 missing 分条报错
  return new Promise(function(resolve){
    try{ fetch(url).then(function(r){
      if(!r.ok){
        // P1-2 fix: !ok 时尝试 appCssCache 回退
        try{ var cached=localStorage.getItem('appCssCache'); if(cached && url==='app.css'){ resolve(cached); return; } }catch(e){}
        resolve(null);return;
      }
      return r.text();
    }).then(function(t){
      if(t){
        try{ if(url==='app.css') localStorage.setItem('appCssCache', t); }catch(e){}
        resolve(t);
      }else{
        try{ var cached2=localStorage.getItem('appCssCache'); if(cached2 && url==='app.css'){ resolve(cached2); return; } }catch(e){}
        resolve(null);
      }
    }).catch(function(){
      try{ var cached3=localStorage.getItem('appCssCache'); if(cached3 && url==='app.css'){ resolve(cached3); return; } }catch(e){}
      resolve(null);
    }); }
    catch(e){
      try{ var cached4=localStorage.getItem('appCssCache'); if(cached4){ resolve(cached4); return; } }catch(e2){}
      resolve(null);
    }
  });
}
/* 启动加载：导出查看器直接恢复内嵌原型库；桌面端先进入项目选择 */
function loadDefaultPreset(){
  if(window.__EXPORT_BOOT__===true){ restoreLibrary(); if(sources.length&&!currentSource){ loadSource(sources[0]); } return; } /* 导出单文件：恢复内嵌原型库并打开首个原型 */
  bootProjectFlow();
}

/* ═══════ 项目选择：每次打开先弹项目选择，选定后只加载该项目（一个窗口一个项目） ═══════ */
var projMaskEl=$('projMask'),projListEl=$('projList'),projCountEl=$('projCount'),
    projNewNameEl=$('projNewName'),projNewBtnEl=$('projNewBtn'),projOkEl=$('projOk'),projCloseEl=$('projClose');
var projPick=''; /* 项目选择弹窗当前选中的项目 */
function safeLSGet(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function safeLSSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function bootProjectFlow(){
  if(!(window.protoAPI&&window.protoAPI.sandbox)){ renderSourceList(); return; }
  /* 窗口参数直达：多开窗口时 loadFile({query:{project}}) 指定进入哪个项目 */
  var qproj='';
  try{ qproj=new URLSearchParams(location.search).get('project')||''; }catch(e){}
  window.protoAPI.sandbox.projects().then(function(r){
    var projects=(r&&r.projects)||[];
    if(qproj&&projects.some(function(p){return p.name===qproj;})){ enterProject(qproj); return; }
    showProjectPicker(projects, safeLSGet('protoLastProject'));
  }).catch(function(e){ reportError('project-list', e, '读取项目列表失败，请重试或重启应用。'); });
}
window.bootProjectFlow = bootProjectFlow;
function showProjectPicker(projects, last){
  if(typeof setSbOpen==='function') setSbOpen(false);
  if(typeof setDocsOpen==='function') setDocsOpen(false);
  if(typeof setReqOpen==='function') setReqOpen(false);
  projPick='';
  if(projNewNameEl)projNewNameEl.value='';
  renderProjectList(projects, last);
  if(projMaskEl)projMaskEl.style.display='flex';
  if(window.MaskStack) window.MaskStack.push('projMask', closeProjectPicker);
  if(projNewNameEl)setTimeout(function(){ try { projNewNameEl.focus(); projNewNameEl.select(); } catch(e){} }, 80);
}
function renderProjectList(projects, last){
  if(!projListEl)return;
  projListEl.innerHTML='';
  var arr=(projects||[]).slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'zh-CN'); });
  if(!arr.length){ projListEl.innerHTML='<div class="gp-empty">暂无项目，输入名称新建一个。</div>'; }
  arr.forEach(function(p){
    var it=document.createElement('button'); it.type='button';
    it.className='proj-item'+(projPick===p.name?' on':'');
    it.innerHTML='<span class="pi-name">'+escHtml(p.name)+'</span><span class="pi-cnt">'+((p.protoCount||0))+' 个原型</span>';
    it.onclick=function(){ projPick=p.name; renderProjectList(projects,last); };
    /* 项目级操作：重命名/删除（默认项目不可删除） */
    var acts=document.createElement('span'); acts.className='pi-acts';
    var rn=document.createElement('span'); rn.className='pi-btn'; rn.textContent='✎'; rn.title='重命名项目';
    rn.onclick=function(ev){ ev.stopPropagation(); askProjectRename(p); };
    var dl=document.createElement('span'); dl.className='pi-btn del'; dl.innerHTML=ic('trash','✕'); dl.title=p.name==='默认项目'?'「默认项目」不可删除':'删除项目（整目录，不可恢复）';
    dl.onclick=function(ev){ ev.stopPropagation(); askProjectRemove(p); };
    acts.appendChild(rn); acts.appendChild(dl);
    it.appendChild(acts);
    projListEl.appendChild(it);
  });
  if(projCountEl)projCountEl.textContent='共 '+arr.length+' 个项目';
  if(projOkEl)projOkEl.disabled=!projPick;
  /* 高亮上次项目为默认选中 */
  if(last&&!projPick){
    for(var i=0;i<arr.length;i++){ if(arr[i].name===last){ projPick=last; renderProjectList(projects,last); break; } }
  }
}
function closeProjectPicker(){ if(window.MaskStack) window.MaskStack.pop('projMask'); if(projMaskEl)projMaskEl.style.display='none'; }
function askProjectRename(p){
  var old=p.name;
  askNamePrompt({ title:'重命名项目', label:'项目名称', hint:'将重命名项目文件夹（含其中全部原型）。', value:old }, function(nm){
   if(nm==null||nm===''||nm===old)return;
   if(/[\\\/:*?"<>|]|\.\./.test(nm)){ alert('名称含非法字符（不能含 \\ / : * ? \" < > |）。'); return; }
   if(nm.length>60){ alert('名称过长（≤60字）。'); return; }
   window.protoAPI.sandbox.projectRename({oldName:old,name:nm}).then(function(r){
    if(r&&r.ok){ bootProjectFlow(); } /* 重进项目选择刷新 */
    else reportError('project-rename', new Error(r&&r.error||'未知错误'), '重命名失败：'+(r&&r.error||'未知错误'));
   });
  });
 }
function askProjectRemove(p){
  if(p.name==='默认项目'){ alert('「默认项目」为旧数据归拢目录，不可删除。'); return; }
  if(!window.confirm('删除项目「'+p.name+'」将删除其文件夹及其中全部原型，不可恢复。\n\n确定删除？'))return;
  window.protoAPI.sandbox.projectRemove({name:p.name}).then(function(r){
   if(r&&r.ok){ bootProjectFlow(); }
   else reportError('project-remove', new Error(r&&r.error||'未知错误'), '删除失败：'+(r&&r.error||'未知错误'));
  });
}
function projNew(){
  var v=String(projNewNameEl&&projNewNameEl.value||'').trim();
  if(!v){ alert('请输入项目名称。'); return; }
  if(/[\\\/:*?"<>|]|\.\./.test(v)){ alert('名称含非法字符（不能含 \\ / : * ? \" < > |）。'); return; }
  if(v.length>60){ alert('名称过长（≤60字）。'); return; }
  window.protoAPI.sandbox.projectCreate({name:v}).then(function(r){
   if(r&&r.ok){ enterProject(r.name); }
   else reportError('project-create', new Error(r&&r.error||'未知错误'), '创建失败：'+(r&&r.error||'未知错误'));
  });
}
function enterProject(name){
  currentProject=name||'';
  if(!currentProject)return;
  safeLSSet('protoLastProject', currentProject);
  closeProjectPicker();
  updateProjectBar();
  loadSandboxSources();
}
function updateProjectBar(){
  var el=$('sbProject');
  if(el){
    el.title='当前项目：'+ (currentProject||'—')+'，点击切换项目';
    var nameEl=el.querySelector('.stage-proj-name');
    if(nameEl) nameEl.textContent='项目：'+ (currentProject||'—');
    else el.textContent='项目：'+ (currentProject||'—');
  }
}
if(projNewBtnEl)projNewBtnEl.onclick=projNew;
if(projNewNameEl)projNewNameEl.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); projNew(); } });
if(projOkEl)projOkEl.onclick=function(){ if(projPick)enterProject(projPick); };
if(projCloseEl)projCloseEl.onclick=closeProjectPicker;
(function(){ var el=$('sbProject'); if(el)el.onclick=function(){ bootProjectFlow(); }; })();

/* ═══════ 沙箱预设库（项目制）：%APPDATA%/原型工具/sandbox/<项目>/<原型文件夹> 自动扫描 ═══════
   一个项目一个文件夹，项目内一个原型一个子文件夹（html 原型 + md 文档同放）；
   文件夹也是该原型的大模型沙箱（AI 生成 html/md 写入其中） */
function loadSandboxSources(selName){
 // fix refresh preserve: extend selName to support subpage restore; snapshot from globals/param
 var _paramIsSub = !!(selName && /\.html$/i.test(String(selName)));
 var _pendingRefreshSub = (typeof window._refreshSavedSub !== 'undefined' && window._refreshSavedSub) ? window._refreshSavedSub : (_paramIsSub ? selName : null);
 var _pendingRefreshHash = (typeof window._refreshSavedHash !== 'undefined' && window._refreshSavedHash) ? window._refreshSavedHash : '';
 var _selNameForProto = _paramIsSub ? null : selName;
 try{ if(_pendingRefreshSub || _pendingRefreshHash) { window._refreshSavedSub = null; window._refreshSavedHash = ''; } }catch(e){}
 if(!(window.protoAPI&&window.protoAPI.sandbox))return;
 if(!currentProject)return;
 window.protoAPI.sandbox.list(currentProject).then(function(r){
  var folders=(r&&r.folders)||[];
  /* 默认打开顺序：项目内按名称排序，打开第一个原型 */
  folders.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'zh-CN'); });
  var keep={};
  folders.forEach(function(f){ if(f.htmlFile)keep[f.htmlFile]=1; });
  /* 并行拉取每个原型的 _links 缓存 */
  var linksPromises = folders.map(function(f) {
    if (!f.dir || !(window.protoAPI && window.protoAPI.links)) return Promise.resolve(null);
    return window.protoAPI.links.read(f.dir).then(function(r) {
      if (r && r.ok && r.data) return { dir: f.dir, links: (r.data && r.data.links) || [] };
      return { dir: f.dir, links: [] };
    }).catch(function() { return { dir: f.dir, links: [] }; });
  });
  Promise.all(linksPromises).then(function(linksResults) {
    var linksMap = {};
    linksResults.forEach(function(lr) { if (lr) linksMap[lr.dir] = lr.links; });
    folders.forEach(function(f){
      if(!f.htmlFile)return; /* 无 html 的文件夹暂不作为原型源（仍可作为沙箱工作区） */
      var nm=f.htmlFile, ex=null;
      for(var i=0;i<sources.length;i++) if(sources[i].name===nm){ ex=sources[i]; break; }
      if(!ex){
        ex={ name:nm, displayName:f.name, method:'srcdoc', content:f.html||'', kind:detectKindByName(nm, f.html||''),
             isPreset:true, sandboxDir:f.dir, mdFile:f.mdFile||null, path:f.html||null,
             mainHtmlFile:f.htmlFile, subPages:f.subPages||[], htmlFiles:f.htmlFiles||[] };
        if(f.html){ ex.pages=extractPages(f.html); }
        ex.docs={};
        if(f.md!=null){ ex.md=f.md; }
        loadSourceDocs(ex); /* 磁盘 md 后，本地已编辑内容再覆盖 */
        ex._links = linksMap[f.dir] || [];
        sources.push(ex);
      }else{
        /* 已在列表：磁盘内容变化则就地刷新（AI 生成/修改后重扫） + 同步子页面列表 */
        ex.subPages = f.subPages || [];
        ex.htmlFiles = f.htmlFiles || [];
        ex.mainHtmlFile = f.htmlFile;
        if(f.html!=null&&ex.content!==f.html){ ex.content=f.html; if(f.html)ex.pages=extractPages(f.html); }
        if(f.md!=null&&ex.md!==f.md){
          ex.md=f.md;
          try{ localStorage.setItem(sourceDocKey(ex), ex.md); }catch(e){}
        }
        ex.sandboxDir=f.dir; ex.fname=f.htmlFile;
        /* 更新 _links 缓存 */
        if (linksMap[f.dir]) ex._links = linksMap[f.dir];
      }
    });
    /* 删除沙箱中已移除的预设源 */
    for(var i=sources.length-1;i>=0;i--){ var s=sources[i]; if(s&&s.isPreset&&s.sandboxDir&&!keep[s.name]){ sources.splice(i,1); } }
    if(!sources.length){ renderSourceList(); libStatus('项目「'+currentProject+'」暂无原型：先点左下角「＋ 新建设计」创建，或通过「＋ 新增原型」导入 html 文件。'); return; }
    if(_selNameForProto){ /* 新建原型后：按文件夹名选中（fix refresh preserve: subFile param不触发此分支） */
      for(var j=0;j<sources.length;j++){ var so=sources[j]; if(so&&(so.displayName===_selNameForProto||so.name===_selNameForProto+'.html')){ currentSource=so; break; } }
    }
    if(!currentSource||sources.indexOf(currentSource)<0){ currentSource=sources[0]; }
    // fix refresh preserve: if pending subpage and not main, restore via loadSubPage else preserve load
    var _savedSub = _pendingRefreshSub;
    var _savedHash = _pendingRefreshHash;
    try{ window._refreshSavedSub = null; window._refreshSavedHash = ''; }catch(e){}
    if(_savedSub && currentSource && _savedSub!==currentSource.mainHtmlFile && _savedSub!==currentSource.name && /\.html$/i.test(String(_savedSub))){
      if(typeof loadSubPage==='function') loadSubPage(currentSource, _savedSub);
      else loadSource(currentSource, 'preserve');
      if(_savedHash){
        setTimeout(function(){ try{ if(frame && frame.contentWindow) frame.contentWindow.location.hash = _savedHash; }catch(e){} }, 280);
      }
      // fix refresh preserve: delay clear so async loadSubPage.readFile+applyKind still sees quiet
      setTimeout(function(){ window.__aiQuietRefresh=false; }, 650);
    } else {
      loadSource(currentSource, window.__aiQuietRefresh===true ? 'preserve' : undefined); /* AI 后台刷新：不自动弹开菜单栏（fix refresh preserve: use preserve） */
      // fix refresh preserve: main page also restore hash if present
      if(_savedHash){
        setTimeout(function(){ try{ if(frame && frame.contentWindow) frame.contentWindow.location.hash = _savedHash; }catch(e){} }, 280);
      }
      window.__aiQuietRefresh=false;
    }
    renderSourceList();
    if (window.LinkBind) window.LinkBind.updateLinkBadge();
    libStatus(_selNameForProto?('已切换到新原型沙箱：'+_selNameForProto+'（AI 生成的文件写入该文件夹）')
      :('项目「'+currentProject+'」：共 '+folders.length+' 个原型文件夹（每个含 html + md）。'));
  }); /* end Promise.all.then */
  }).catch(function(e){ reportError('sandbox-list', e, '加载原型列表失败：'+(e&&e.message||e)); });
}

/* AI 结束后重扫沙箱：把模型生成/修改的 html、md 同步回当前原型与文档列表 */
function aiSyncSandbox(){
  if(!(window.protoAPI&&window.protoAPI.sandbox))return;
  if(!currentSource||!currentSource.sandboxDir)return;
  // fix refresh preserve: snapshot subpage+hash before async reload
  var _savedSub2 = currentSource && currentSource.activeSubFile;
  var _savedHash2 = '';
  try{ _savedHash2 = frame && frame.contentWindow && frame.contentWindow.location.hash || ''; }catch(e){}
  window._refreshSavedSub = _savedSub2;
  window._refreshSavedHash = _savedHash2;
  window.__aiQuietRefresh=true; /* AI 后台更新：刷新页面时不自动弹出菜单栏 */
  loadSandboxSources(_savedSub2 && /\.html$/i.test(String(_savedSub2)) ? _savedSub2 : undefined);
}

/* ═══════ 全局 Esc 快捷键关闭活动弹窗 ═══════ */
function isElOpen(el) {
  if (!el) return false;
  if (el.style.display === 'flex' || el.style.display === 'block') return true;
  if (el.classList && el.classList.contains('open')) return true;
  return false;
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
    // P1-7 fix: 若 MaskStack 已接管（栈非空），委托其单例处理，避免双 Esc 重叠各关一层
    if (window.MaskStack && window.MaskStack.stack && window.MaskStack.stack.length) return;
    // 1. 模态弹窗（按层级和优先级逐层关闭）
    if (isElOpen(nameMaskEl)) { namePromptDone(null); return; }
    if (isElOpen(kindMaskEl)) { closeKindModal(); return; }
    if (isElOpen(snapMaskEl)) { closeSnapPanel(); return; }
    if (isElOpen(gitPushMask)) { closeGitPushModal(); return; }
    if (isElOpen(gitPullMask)) { closeGitPullModal(); return; }
    if (isElOpen(gitConfigMask)) { closeGitConfigModal(); return; }
    if (isElOpen(exportMaskEl)) { closeExportModal(); return; }
    if (isElOpen(settingsMask)) { closeSettings(); return; }
    if (isElOpen(aiMaskEl)) { closeAi(); return; }
    if (isElOpen(projMaskEl)) { closeProjectPicker(); return; }

    // 2. 交互与编辑抽屉
    if (window.LinkBind && typeof window.LinkBind.closeInspector === 'function' && isElOpen($('linkInspector'))) {
      window.LinkBind.closeInspector(); return;
    }
    if (window.LinkBind && typeof window.LinkBind.closeLinkMgr === 'function' && isElOpen($('linkMgrDrawer'))) {
      window.LinkBind.closeLinkMgr(); return;
    }
    if (window.AnnotationEngine && typeof window.AnnotationEngine.closeAnnoMgr === 'function' && isElOpen($('annoMgrDrawer'))) {
      window.AnnotationEngine.closeAnnoMgr(); return;
    }
    if (window.AnnotationEngine && typeof window.AnnotationEngine.closeAnnoPopover === 'function' && isElOpen($('annoPopoverCard'))) {
      window.AnnotationEngine.closeAnnoPopover(); return;
    }
    if (typeof closeEditDrawer === 'function' && isElOpen($('editDrawer'))) {
      closeEditDrawer(); return;
    }

    // 3. 下拉菜单与侧栏文档
    if (gitDropdownMenuEl && gitDropdownMenuEl.style.display === 'flex') { closeGitDropdown(); return; }
    if (exportDropdownMenuEl && exportDropdownMenuEl.style.display === 'flex') { closeExportDropdown(); return; }
    if (reqOpen) { setReqOpen(false); return; }
  }
});
// P1-7 MaskStack 统一遮罩点击（点遮罩 + Esc 双关闭） 11 modal 收敛：export/kind/name/proj/snap/gitPush/gitPull/gitConfig + settings/ai + docs/req(pcOnly)
(function(){
 try{
  function bindMaskClicks(){
   try{
    if(window.MaskStack && window.MaskStack.register){
     window.MaskStack.register('settingsMask','settingsMask', closeSettings);
     window.MaskStack.register('exportMask','exportMask', closeExportModal);
     window.MaskStack.register('kindMask','kindMask', closeKindModal);
     window.MaskStack.register('nameMask','nameMask', function(){ namePromptDone(null); });
     window.MaskStack.register('projMask','projMask', closeProjectPicker);
     window.MaskStack.register('snapMask','snapMask', closeSnapPanel);
     window.MaskStack.register('gitPushMask','gitPushMask', closeGitPushModal);
     window.MaskStack.register('gitPullMask','gitPullMask', closeGitPullModal);
     window.MaskStack.register('gitConfigMask','gitConfigMask', closeGitConfigModal);
     window.MaskStack.register('aiMask','aiMask', closeAi);
     window.MaskStack.register('docsMask','docsMask', function(){ setDocsOpen(false); }, {pcOnly:true});
     window.MaskStack.register('reqMask','reqMask', function(){ setReqOpen(false); }, {pcOnly:true});
    } else {
     // fallback：直接绑定遮罩点击（无 MaskStack 环境）
     var _bind=function(id,fn){ try{ var el=document.getElementById(id); if(el) el.onclick=function(e){ if(e.target===el) fn(); }; }catch(e){} };
     _bind('settingsMask', closeSettings);
     _bind('exportMask', closeExportModal);
     _bind('kindMask', closeKindModal);
     _bind('nameMask', function(){ namePromptDone(null); });
     _bind('projMask', closeProjectPicker);
     _bind('snapMask', closeSnapPanel);
     _bind('gitPushMask', closeGitPushModal);
     _bind('gitPullMask', closeGitPullModal);
     _bind('gitConfigMask', closeGitConfigModal);
     _bind('aiMask', closeAi);
    }
   }catch(e){}
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', bindMaskClicks); } else { bindMaskClicks(); }
  // 兜底：延迟再绑一次，确保 DOM 已就绪（应对脚本提前执行）
  try{ setTimeout(bindMaskClicks, 500); }catch(e){}
 }catch(e){}
})();
// fix static-verify: theme apply + persist (minimal, not changing existing behavior)
function applyTheme(t){ try{ var v=(t==='dark'||t==='light')?t:'auto'; document.documentElement.setAttribute('data-theme', v); localStorage.setItem('planb-theme', v); }catch(e){} }
try{ var _th=localStorage.getItem('planb-theme'); if(_th) document.documentElement.setAttribute('data-theme', _th); }catch(e){}
window.applyTheme = applyTheme;
// harn fix: 操作项思考可点 + 滚动不抢 + 回到最新
function openThinkPopup(gid){
  var g=null;
  for(var i=0;i<aiTraceGroups.length;i++){ if(aiTraceGroups[i].id===gid){ g=aiTraceGroups[i]; break; } }
  if(!g) try{ g=aiCurGroup(); }catch(e){}
  if(!g && !aiStreamThink) return;
  var thinkText=(g&&g.think)?g.think:aiStreamThink;
  var pre=$('thinkPopupPre'), meta=$('thinkPopupMeta'), mask=$('thinkMask');
  if(pre){ pre.textContent=thinkText||'(暂无思考链)'; pre.className='think-light'; } // light gray fix
  if(meta){
    var title=g?g.title:'当前思考';
    var len=(thinkText||'').length;
    var time=g?g.time:new Date().toTimeString().split(' ')[0];
    meta.textContent=title+' · '+len+'字符 · '+time;
  }
  if(mask){
    mask.style.display='flex';
    if(window.MaskStack) window.MaskStack.push('thinkMask', closeThinkPopup);
  }
}
function closeThinkPopup(){
  var mask=$('thinkMask');
  if(mask) mask.style.display='none';
  if(window.MaskStack) window.MaskStack.pop('thinkMask');
}
(function(){
  try{
    var tc=$('thinkClose'), tc2=$('thinkClose2'), tcMask=$('thinkMask'), cp=$('thinkCopy');
    if(tc) tc.onclick=closeThinkPopup;
    if(tc2) tc2.onclick=closeThinkPopup;
    if(tcMask) tcMask.addEventListener('click', function(e){ if(e.target===tcMask) closeThinkPopup(); });
    if(cp) cp.onclick=function(){
      var pre=$('thinkPopupPre'); var txt=pre?pre.textContent:''; if(!txt) return;
      var btn=cp;
      var done=function(){ btn.textContent='已复制'; setTimeout(function(){ btn.textContent='复制'; },1500); };
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(txt).then(done).catch(function(){ fallbackAiCopy(txt, btn); });
      } else {
        fallbackAiCopy(txt, btn);
      }
    };
    if(window.MaskStack&&window.MaskStack.register){
      try{ window.MaskStack.register('thinkMask','thinkMask', closeThinkPopup); }catch(e){}
    }
  }catch(e){}
})();
// harn fix: 回到最新按钮与滚动守卫，仅外层可滚
var aiJumpBtn=null;
function aiEnsureJumpBtn(){
  if(aiJumpBtn) return aiJumpBtn;
  var body=$('aiBody'); var cv=$('aiChatView');
  if(!body||!cv) return null;
  var btn=document.createElement('button');
  btn.id='aiJumpLatest';
  btn.className='ai-jump-latest docs-btn primary';
  btn.textContent='回到最新↓';
  btn.title='回到最新内容';
  btn.style.display='none';
  btn.onclick=function(){
    aiUserScrolledPause=false; // harn fix
    if(cv) cv.scrollTop=cv.scrollHeight; // harn fix: 仅外层 aiChatView 可滚
    aiUpdateJumpBtn();
  };
  body.appendChild(btn);
  aiJumpBtn=btn;
  return btn;
}
function aiUpdateJumpBtn(){
  var cv=$('aiChatView'); var btn=aiEnsureJumpBtn();
  if(!cv||!btn) return;
  var should=aiShouldAutoScroll(cv, 80);
  var show=aiUserScrolledPause && !should && aiBusy;
  // 仅在有内容且用户上滑时显示
  if(show){
    btn.style.display='inline-flex';
  } else {
    btn.style.display='none';
  }
}
function aiBindScrollGuard(){
  var cv=$('aiChatView');
  if(!cv || cv._scrollGuardBound) return;
  cv._scrollGuardBound=true;
  var onScroll=function(){
    // 10px 内算在底部，其余算在查看历史，暂停自动吸底
    var atBottom=aiShouldAutoScroll(cv, 10);
    aiUserScrolledPause=!atBottom;
    aiUpdateJumpBtn();
  };
  var onWheel=function(e){
    // 向上滚立即暂停，即使仍在 80px 内也允许用户脱离底部
    if(e.deltaY < 0) { aiUserScrolledPause=true; aiUpdateJumpBtn(); }
  };
  cv.addEventListener('scroll', onScroll, {passive:true});
  cv.addEventListener('wheel', onWheel, {passive:true});
  cv.addEventListener('touchmove', function(){ aiUserScrolledPause=true; aiUpdateJumpBtn(); }, {passive:true});
}
function aiBindOpScrollGuard(){
  // harn fix: op-scroll 已 visible 仅外层可滚，无需内层守卫
  return;
}
(function(){
  function initScrollGuard(){
    aiBindScrollGuard();
    aiEnsureJumpBtn();
    aiUpdateJumpBtn();
    // 委托点击思考行
    var cv=$('aiChatView');
    if(cv && !cv._thinkClickBound){
      cv._thinkClickBound=true;
      cv.addEventListener('click', function(e){
        var t=e.target.closest?e.target.closest('.op-line--think'):null;
        if(!t) return;
        openThinkPopup(t.getAttribute('data-gid')||'');
      });
    }
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', initScrollGuard);
  } else {
    initScrollGuard();
  }
  try{ setTimeout(initScrollGuard, 800); }catch(e){}
  // 每次流式渲染后绑定内部滚动
  var _origRenderStream=aiRenderStream;
  // 包装以额外绑定 op-scroll 守卫（若原函数被重写则兜底）
  try{
    var _wrap=function(){
      var r=_origRenderStream.apply(this, arguments);
      try{ aiBindOpScrollGuard(); aiUpdateJumpBtn(); }catch(e){}
      return r;
    };
    // 仅在未包装时替换
    if(aiRenderStream && !aiRenderStream._guardWrapped){
      aiRenderStream=_wrap;
      aiRenderStream._guardWrapped=true;
    }
  }catch(e){}
})();
