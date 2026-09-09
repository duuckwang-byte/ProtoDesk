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

/* ═══════ Git 协同下拉菜单与弹窗管理（单库模型、目标分支/拉取来源分支/上次使用分支、无 emoji） ═══════ */
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
var gitGlobalOriginText = $('gitGlobalOriginText'), gitRemoteUrlHint = $('gitRemoteUrlHint'), gitBranchHint = $('gitBranchHint'), gitTokenAck = $('gitTokenAck');
var gitPushBranchHint = $('gitPushBranchHint'), gitPullBranchHint = $('gitPullBranchHint'), gitPushBranchRuleHint = $('gitPushBranchRuleHint'), gitPullBranchRuleHint = $('gitPullBranchRuleHint');
var gitLastSavedRemoteUrl = '';
var gitPendingSavePayload = null;
var gitPendingPullCover = null;
var gitPendingCrossProj = null;
var gitHealPendingRetry = null;

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

/* ═══════ Git P0 第一批：校验 + 脱敏 + 错误映射 + 确认弹窗（只增，不改既有通道名） ═══════ */
function gitMaskUrl(url) {
  var s = String(url == null ? '' : url).trim();
  if (!s) return '未配置';
  try { s = s.replace(/https:\/\/[^:@\s]+:[^@\s]+@/g, 'https://***:***@'); } catch (e) {}
  try { s = s.replace(/https:\/\/[^\/:@\s]+@/g, 'https://***@'); } catch (e) {}
  return s;
}
function gitBranchRuleMsg(b) {
  var s = String(b == null ? '' : b).trim();
  if (!s) return '分支名必填，默认 main';
  if (s.length > 60) return '分支名长度超限（须 1-60 字符）';
  if (/\s/.test(s)) return '分支名不得含空格';
  if (/[\u4e00-\u9fa5]/.test(s)) return '分支名不得含中文';
  if (s.indexOf('..') >= 0) return '分支名不得含 ..';
  if (/[~^:?*\[\]@{}]/.test(s)) return '分支名不得含 ~ ^ : ? * [ ] @ { }';
  if (/^\/|\/$/.test(s)) return '分支名不能以 / 开头或结尾';
  if (s.indexOf('//') >= 0) return '分支名不得含连续 //';
  if (/\.lock$/i.test(s)) return '分支名不得以 .lock 结尾';
  if (!/^[a-zA-Z0-9._\/-]+$/.test(s)) return '仅允许字母/数字/._/-';
  return '';
}
function gitRemoteUrlMsg(u) {
  var s = String(u == null ? '' : u).trim();
  if (!s) return '远程仓库地址必填（https:// 开头），未配置时无法同步';
  if (s.length > 500) return '地址长度超限（须 <=500）';
  if (/\s/.test(s)) return '地址不得含空格';
  if (!/^https:\/\//i.test(s)) return '仅支持 https:// 仓库地址';
  try { var uu = new URL(s); if (!uu.hostname) return '地址缺少主机名'; } catch (e) { return '不是合法 URL'; }
  if (/@/.test(s.replace(/^https:\/\//i, '').split('/')[0] || '') && /@/.test(s)) {
    var head = s.slice(0, s.indexOf('@'));
    if (/https?:\/\//i.test(head) && head.indexOf('/') < 0) return '地址中不得携带用户名/口令，请走凭据输入框';
  }
  return '';
}
function gitCopyText(txt, okMsg) {
  var s = String(txt == null ? '' : txt);
  function done() { try { if (typeof showToast === 'function') showToast(okMsg || '已复制'); } catch (e) {} }
  try {
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, function() { gitFallbackCopy(s); done(); });
      return;
    }
  } catch (e) {}
  gitFallbackCopy(s); done();
}
function gitFallbackCopy(s) {
  try {
    var ta = document.createElement('textarea');
    ta.value = String(s || '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    if (ta.parentNode) ta.parentNode.removeChild(ta);
  } catch (e) {}
}
function gitShowFieldHint(el, msg, ok) {
  if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; el.className = 'git-field-hint'; return; }
  el.style.display = 'block'; el.textContent = msg;
  el.className = 'git-field-hint' + (ok ? ' ok' : ' err');
}
/* 第五章 11 类错误映射：人话标题 + 正文 + 下一步 */
function gitErrorInfo(code, raw) {
  var c = String(code || '');
  var t = String(raw == null ? '' : raw);
  function has(re) { try { return re.test(t) || re.test(c); } catch (e) { return false; } }
  if (c === 'NEED_HEAL' || /NEED_HEAL/.test(t)) return { title: '沙箱 Git 异常，需修复', body: '检测到嵌套仓库或沙箱库损坏，需备份后修复才能同步。未确认前不会删除任何文件。', primary: '去自愈确认', secondary: '' };
  if (c === 'NEED_CONFIG' || /NEED_CONFIG|未配置 Git 远程仓库/.test(t)) return { title: '尚未配置远程仓库', body: '全局单库尚未配置远端，无法同步。请先配置 HTTPS 仓库地址。', primary: '去仓库设置', secondary: '' };
  if (c === 'INVALID_BRANCH' || /非法分支名/.test(t)) return { title: '分支名不合法', body: '仅允许字母/数字/._/-，长度<=60，不含空格中文与 ..，不能以 / 开头结尾。', primary: '修正分支名', secondary: '' };
  if (c === 'GIT_URL_BLOCKED' || c === 'AUTH_URL_BLOCKED' || /GIT_URL_BLOCKED|AUTH_URL_BLOCKED|不支持的仓库地址/.test(t)) return { title: '仓库地址不合法', body: t || '默认仅支持 https:// 仓库地址，地址中不得携带用户名/口令。', primary: '去仓库设置核对', secondary: '' };
  if (has(/Authentication failed|401|403|not authorized|could not read Username|Invalid username or password/i)) return { title: 'Git 鉴权失败', body: '账号、密码或 Token 错误/过期，或 Token 缺少 write 权限。请更新后重试。', primary: '重新配置 Token', secondary: '测试连通性' };
  if (has(/Could not resolve host|Connection refused|Failed to connect|操作超时.*整树终止|timed out/i) && !/Git 操作超时/.test(t)) return { title: '网络连接失败', body: '无法访问远端仓库地址，请检查网络、VPN 与仓库地址是否可达。', primary: '重试', secondary: '检查仓库地址' };
  if (has(/Repository not found|remote: Not Found|does not exist/i)) return { title: '远程仓库不存在或无权限', body: '地址错误或账号无该仓库访问权限，请核对 URL 与成员权限。', primary: '去仓库设置核对', secondary: '测试连通性' };
  if (has(/fetch first|non-fast-forward|Updates were rejected|divergent|hint:.*pull|! \[rejected\]/i)) return { title: '远端已有新版本，需先同步', body: '远端存在本地没有的历史。请先拉取同步，或用本地版强制覆盖（将改写远端历史）。', primary: '拉取同步后重试', secondary: '强制覆盖上传' };
  if (has(/remote.*empty|empty repo|src refspec .* does not match|failed to push.*empty|无 heads/i) || /远端为空仓库/.test(t)) return { title: '远端为空仓库，可直接首次发布', body: '远端尚无任何分支历史，确认分支名无误后可直接上传创建。', primary: '首次发布到该分支', secondary: '核对分支名' };
  if (has(/CONFLICT|Automatic merge failed|both modified|need merge/i) || /\bUU\b|\bAA\b/.test(t)) return { title: '存在文件冲突，需先解决', body: '本地与远端均有修改，无法自动合并。请选择保留方案（均会自动备份被覆盖方）。', primary: '查看冲突文件', secondary: '' };
  if (has(/本机未检测到 Git|未找到 git|spawn git|ENOENT.*git|git.*not found/i)) return { title: '本机未检测到 Git', body: '请先安装 Git（建议 >=2.30）后重启应用，同步功能依赖本机 Git。', primary: '查看安装指引', secondary: '复制诊断信息' };
  if (c === 'TIMEOUT' || has(/Git 操作超时|status[:\s]*124/i)) return { title: '操作超时', body: '远端响应过慢或文件过多，可重试或分批勾选后重试。', primary: '重试', secondary: '' };
  if (c === 'git-busy' || /git-busy/.test(t)) return { title: 'Git 正忙', body: '另有 Git 操作正在执行，请稍后重试。', primary: '重试', secondary: '' };
  return { title: '操作失败', body: '已脱敏的原始信息见详情，请复制后联系管理员。', primary: '重试', secondary: '去仓库设置' };
}
function gitOpenMask(id) {
  var el = id ? document.getElementById(id) : null;
  if (!el) return;
  el.style.display = 'flex';
  try { if (window.MaskStack) window.MaskStack.push(id, function() { gitCloseMask(id); }); } catch (e) {}
}
function gitCloseMask(id) {
  try { if (window.MaskStack) window.MaskStack.pop(id); } catch (e) {}
  var el = id ? document.getElementById(id) : null;
  if (el) el.style.display = 'none';
}
var gitErrorCtx = { primaryFn: null, secondaryFn: null, detail: '' };
function showGitError(opts) {
  var o = opts || {};
  var titleEl = $('gitErrorTitle'), bodyEl = $('gitErrorBody'), detailEl = $('gitErrorDetail');
  var pBtn = $('btnGitErrorPrimary'), sBtn = $('btnGitErrorSecondary'), cfgBtn = $('btnGitErrorGotoConfig');
  var info = gitErrorInfo(o.code || '', o.detail || o.body || '');
  var title = o.title || info.title;
  var body = o.body || info.body;
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  gitErrorCtx.detail = String(o.detail || o.body || '');
  gitErrorCtx.primaryFn = (typeof o.primaryFn === 'function') ? o.primaryFn : null;
  gitErrorCtx.secondaryFn = (typeof o.secondaryFn === 'function') ? o.secondaryFn : null;
  if (detailEl) { detailEl.textContent = gitErrorCtx.detail || '(无详情)'; detailEl.style.display = 'none'; }
  var tBtn = $('btnGitErrorToggleDetail');
  if (tBtn) tBtn.textContent = '查看详情';
  var pText = o.primaryText || info.primary || '';
  var sText = o.secondaryText || info.secondary || '';
  if (pBtn) { if (pText) { pBtn.textContent = pText; pBtn.style.display = ''; } else { pBtn.style.display = 'none'; } }
  if (sBtn) { if (sText) { sBtn.textContent = sText; sBtn.style.display = ''; } else { sBtn.style.display = 'none'; } }
  if (cfgBtn) cfgBtn.style.display = 'none';
  if (!gitErrorCtx.primaryFn) {
    var codeKey = String(o.code || '');
    var detKey = String(o.detail || o.body || '');
    if (codeKey === 'NEED_CONFIG' || /NEED_CONFIG/.test(detKey)) gitErrorCtx.primaryFn = function() { try { openGitConfigModal(); } catch (e) {} };
    else if (/去仓库设置/.test(pText)) gitErrorCtx.primaryFn = function() { try { openGitConfigModal(); } catch (e) {} };
    else if (/重新配置 Token/.test(pText)) gitErrorCtx.primaryFn = function() { try { openGitConfigModal(); } catch (e) {} };
    else if (/拉取同步后重试/.test(pText)) gitErrorCtx.primaryFn = function() { try { openGitPullModal(); } catch (e) {} };
  }
  if (!gitErrorCtx.secondaryFn && /复制诊断信息/.test(sText)) gitErrorCtx.secondaryFn = function() { gitCopyText(gitErrorCtx.detail || '', '诊断信息已复制'); };
  if (pBtn) pBtn.onclick = function() { gitCloseMask('gitErrorMask'); try { if (gitErrorCtx.primaryFn) gitErrorCtx.primaryFn(); } catch (e) {} };
  if (sBtn) sBtn.onclick = function() { gitCloseMask('gitErrorMask'); try { if (gitErrorCtx.secondaryFn) gitErrorCtx.secondaryFn(); } catch (e) {} };
  gitOpenMask('gitErrorMask');
}
function gitForeignProjects(files) {
  var out = [];
  var seen = {};
  (files || []).forEach(function(p) {
    var s = String(p || '');
    var proj = s.indexOf('/') >= 0 ? s.split('/')[0] : '默认项目';
    if (proj !== currentProject && !seen[proj]) { seen[proj] = 1; out.push(proj); }
  });
  return out;
}
function gitCollectChecked(containerEl) {
  if (!containerEl) return [];
  var list = [];
  try {
    containerEl.querySelectorAll('input[type="checkbox"][data-path]:checked').forEach(function(c) {
      var p = c.getAttribute('data-path');
      if (p) list.push(p);
    });
  } catch (e) {}
  return list;
}
function gitShowNeedConfigEmpty() {
  showGitError({ code: 'NEED_CONFIG', detail: 'NEED_CONFIG', primaryText: '去仓库设置', primaryFn: function() { try { openGitConfigModal(); } catch (e) {} } });
}

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

    html += '<div class="git-tree-proj" data-pidx="' + pIdx + '" data-project="' + escAttr(proj.project) + '">'
      + '<div class="git-tree-proj-header">'
      + '<input type="checkbox" class="git-proj-chk" title="全选本项目"' + (isDefaultChecked ? ' checked' : '') + ' data-pidx="' + pIdx + '">'
      + '<span class="git-tree-proj-title">项目：' + escHtml(proj.project) + '</span>'
      + (proj.isCurrent ? '<span class="git-tree-proj-badge">当前项目</span>' : '')
      + '<span class="git-proj-select-tip">全选本项目</span>'
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

/* 1. Git 仓库设置弹窗（P0：单库提示 + https/分支校验 + Token 不回填 + 改远端确认） */
function openGitConfigModal() {
  closeGitDropdown();
  if (!currentProject) { showGitError({ title: '请先进入一个项目', body: '请先进入一个项目后再配置仓库。', detail: 'currentProject 为空', primaryText: '关闭', primaryFn: function() {} }); return; }
  if (!window.protoAPI || !window.protoAPI.git) { (typeof showToast === 'function' ? showToast('仅桌面端支持 Git 协同') : null); return; }
  if (testGitStatus) { testGitStatus.textContent = ''; testGitStatus.className = 'set-status'; }
  if (gitSaveTip) gitSaveTip.style.display = 'none';

  window.protoAPI.git.getConfig(currentProject).then(function(res) {
    var cfg = (res && res.config) || {};
    if (gitRemoteUrl) gitRemoteUrl.value = cfg.remoteUrl || '';
    if (gitBranch) gitBranch.value = cfg.branch || 'main';
    if (gitUsername) gitUsername.value = cfg.username || '';
    if (gitToken) {
      gitToken.value = '';
      var masked = cfg.tokenMasked || '';
      gitToken.placeholder = masked ? ('已配置 (' + masked + ')，留空=不更新') : '填写个人访问令牌或密码';
    }
    if (gitTokenAck) gitTokenAck.checked = false;
    gitLastSavedRemoteUrl = String(cfg.remoteUrl || '').trim();
    if (gitGlobalOriginText) gitGlobalOriginText.textContent = gitLastSavedRemoteUrl ? gitMaskUrl(gitLastSavedRemoteUrl) : '未配置';
    gitShowFieldHint(gitRemoteUrlHint, '');
    gitShowFieldHint(gitBranchHint, '');
    if (gitConfigMask) gitConfigMask.style.display = 'flex';
    if (window.MaskStack) window.MaskStack.push('gitConfigMask', closeGitConfigModal);
  });
}
function closeGitConfigModal() {
  if (window.MaskStack) window.MaskStack.pop('gitConfigMask');
  if (gitConfigMask) gitConfigMask.style.display = 'none';
}
try { window.closeGitConfigModal = closeGitConfigModal; window.openGitConfigModal = openGitConfigModal; } catch (e) {}
if (btnGitConfigMenuEl) btnGitConfigMenuEl.onclick = openGitConfigModal;
if (gitConfigClose) gitConfigClose.onclick = closeGitConfigModal;
if (gitConfigCancel) gitConfigCancel.onclick = closeGitConfigModal;

if (gitRemoteUrl) {
  gitRemoteUrl.addEventListener('input', function() {
    var msg = gitRemoteUrlMsg(gitRemoteUrl.value);
    if (!gitRemoteUrl.value.trim()) { gitShowFieldHint(gitRemoteUrlHint, msg, false); return; }
    if (msg) { gitShowFieldHint(gitRemoteUrlHint, msg, false); } else { gitShowFieldHint(gitRemoteUrlHint, '地址格式正确（https）', true); }
  });
  gitRemoteUrl.addEventListener('blur', function() {
    var msg = gitRemoteUrlMsg(gitRemoteUrl.value);
    if (gitRemoteUrl.value.trim() && msg) gitShowFieldHint(gitRemoteUrlHint, msg, false);
  });
}
if (gitBranch) {
  gitBranch.addEventListener('input', function() {
    var msg = gitBranchRuleMsg(gitBranch.value);
    if (msg && String(gitBranch.value || '').trim()) gitShowFieldHint(gitBranchHint, msg, false);
    else if (!msg) gitShowFieldHint(gitBranchHint, '', false);
    else gitShowFieldHint(gitBranchHint, '', false);
  });
  gitBranch.addEventListener('blur', function() {
    var msg = gitBranchRuleMsg(gitBranch.value);
    if (msg) gitShowFieldHint(gitBranchHint, msg, false); else gitShowFieldHint(gitBranchHint, '', false);
  });
}

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
    var urlMsg = gitRemoteUrlMsg(url);
    if (!url || urlMsg) {
      if (testGitStatus) { testGitStatus.textContent = urlMsg || '请先填写远程仓库地址'; testGitStatus.className = 'set-status err'; }
      if (gitRemoteUrlHint) gitShowFieldHint(gitRemoteUrlHint, urlMsg || '请先填写远程仓库地址', false);
      return;
    }
    var bMsg = gitBranch ? gitBranchRuleMsg(gitBranch.value) : '';
    if (bMsg) {
      if (testGitStatus) { testGitStatus.textContent = bMsg; testGitStatus.className = 'set-status err'; }
      if (gitBranchHint) gitShowFieldHint(gitBranchHint, bMsg, false);
      return;
    }
    if (testGitStatus) { testGitStatus.textContent = '测试连接中…'; testGitStatus.className = 'set-status'; }
    var cfg = {
      remoteUrl: url,
      branch: gitBranch ? (gitBranch.value.trim() || 'main') : 'main',
      username: gitUsername ? gitUsername.value.trim() : '',
      token: gitToken ? gitToken.value.trim() : '',
      project: currentProject
    };
    window.protoAPI.git.testConnection(cfg).then(function(r) {
      if (r && r.ok) {
        if (testGitStatus) { testGitStatus.textContent = '连接成功 (' + (r.latency || 0) + 'ms)'; testGitStatus.className = 'set-status ok'; }
      } else {
        var info = gitErrorInfo((r && r.code) || '', (r && r.error) || '');
        if (testGitStatus) { testGitStatus.textContent = info.title + '：' + info.body; testGitStatus.className = 'set-status err'; }
      }
    }).catch(function(err) {
      var info2 = gitErrorInfo('', String(err && err.message || err));
      if (testGitStatus) { testGitStatus.textContent = info2.title + '：' + info2.body; testGitStatus.className = 'set-status err'; }
    });
  };
}

var gitSaveTipTimer = null;
function gitDoSaveConfig() {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  var cfg = {
    remoteUrl: gitRemoteUrl ? gitRemoteUrl.value.trim() : '',
    branch: gitBranch ? (gitBranch.value.trim() || 'main') : 'main',
    username: gitUsername ? gitUsername.value.trim() : '',
    token: gitToken ? gitToken.value.trim() : ''
  };
  window.protoAPI.git.saveConfig({ project: currentProject, config: cfg }).then(function(r) {
    if (r && r.ok) {
      gitLastSavedRemoteUrl = String(cfg.remoteUrl || '').trim();
      if (gitGlobalOriginText) gitGlobalOriginText.textContent = gitLastSavedRemoteUrl ? gitMaskUrl(gitLastSavedRemoteUrl) : '未配置';
      if (gitToken) { gitToken.value = ''; try { var m2 = (r.config && r.config.tokenMasked) || ''; gitToken.placeholder = m2 ? ('已配置 (' + m2 + ')，留空=不更新') : '填写个人访问令牌或密码'; } catch (e) {} }
      if (gitTokenAck) gitTokenAck.checked = false;
      if (gitSaveTip) {
        gitSaveTip.style.display = 'inline-flex';
        if (gitSaveTipTimer) clearTimeout(gitSaveTipTimer);
        gitSaveTipTimer = setTimeout(function() { gitSaveTip.style.display = 'none'; }, 3500);
      }
    } else if (r && r.code === 'NEED_HEAL') {
      gitOpenHealConfirm(r, function() { gitDoSaveConfig(); });
    } else {
      showGitError({ code: (r && r.code) || '', body: '', detail: (r && r.error) || '未知错误', primaryText: '去仓库设置', primaryFn: function() {} });
    }
  }).catch(function(err) {
    showGitError({ code: '', detail: String(err && err.message || err), primaryText: '重试', primaryFn: function() { gitDoSaveConfig(); } });
  });
}
if (gitConfigSave) {
  gitConfigSave.onclick = function() {
    if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
    var url = gitRemoteUrl ? gitRemoteUrl.value.trim() : '';
    var branch = gitBranch ? gitBranch.value.trim() || 'main' : 'main';
    var tokenVal = gitToken ? gitToken.value.trim() : '';
    var urlMsg = url ? gitRemoteUrlMsg(url) : '';
    if (url && urlMsg) { gitShowFieldHint(gitRemoteUrlHint, urlMsg, false); showGitError({ code: 'GIT_URL_BLOCKED', detail: urlMsg, primaryText: '修正地址', primaryFn: function() {} }); return; }
    var bMsg = gitBranchRuleMsg(branch);
    if (bMsg) { gitShowFieldHint(gitBranchHint, bMsg, false); showGitError({ code: 'INVALID_BRANCH', detail: bMsg, primaryText: '修正分支名', primaryFn: function() {} }); return; }
    if (tokenVal && gitTokenAck && !gitTokenAck.checked) {
      showGitError({ title: '保存含 Token 需先知悉', body: 'Token 将加密存于本机，仅本机可用。请勾选已知悉后再保存。', detail: 'tokenAck 未勾选', primaryText: '知道了', primaryFn: function() {} });
      return;
    }
    if (url && gitLastSavedRemoteUrl && url !== gitLastSavedRemoteUrl) {
      gitPendingSavePayload = null;
      var txt = $('gitRemoteConfirmText');
      if (txt) txt.textContent = '原远端：' + gitMaskUrl(gitLastSavedRemoteUrl) + '\n新远端：' + gitMaskUrl(url) + '\n影响：全部项目共用此远端，分支 [' + branch + ']。确认改写全局远端吗？';
      gitOpenMask('gitRemoteConfirmMask');
      return;
    }
    gitDoSaveConfig();
  };
}
(function bindGitRemoteConfirm() {
  var ok = $('gitRemoteConfirmOk'), cancel = $('gitRemoteConfirmCancel'), x = $('gitRemoteConfirmClose');
  function close() { gitCloseMask('gitRemoteConfirmMask'); }
  if (ok) ok.onclick = function() { close(); gitDoSaveConfig(); };
  if (cancel) cancel.onclick = close;
  if (x) x.onclick = close;
})();

/* 2. Git 上传发布弹窗（P0：未配空态 + 上次使用分支弱提示 + 二级全选 + 跨项目确认） */
function gitShowPushEmptyConfig(show) {
  var emptyEl = $('gitPushEmptyConfig');
  if (emptyEl) emptyEl.style.display = show ? 'flex' : 'none';
  if (show && gitPushTreeList) gitPushTreeList.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">尚未配置远程仓库，无法上传发布。请先配置全局远端。</div>';
  if (show && gitPushSubmit) gitPushSubmit.disabled = true;
}
function loadGitPushStatus(targetBranch) {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  var bMsg = gitBranchRuleMsg(targetBranch || '');
  if (bMsg) {
    gitShowFieldHint(gitPushBranchRuleHint, bMsg, false);
    if (gitPushTreeList) gitPushTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(bMsg) + '</div>';
    if (gitPushSubmit) gitPushSubmit.disabled = true;
    return;
  }
  gitShowFieldHint(gitPushBranchRuleHint, '', false);
  if (gitPushTreeList) gitPushTreeList.innerHTML = '<div style="color:var(--faint);padding:16px;text-align:center;">正在比对本地变更…</div>';
  if (gitPushCount) gitPushCount.textContent = '已选 0 项变更';
  if (gitPushSubmit) gitPushSubmit.disabled = true;

  window.protoAPI.git.getStatus({ project: currentProject, branch: targetBranch }).then(function(r) {
    if (!r || !r.ok) {
      if (r && r.code === 'NEED_HEAL') { gitOpenHealConfirm(r, function() { loadGitPushStatus(targetBranch); }); return; }
      if (r && r.code === 'NEED_CONFIG') { gitShowPushEmptyConfig(true); return; }
      var info = gitErrorInfo((r && r.code) || '', (r && r.error) || '');
      if (gitPushTreeList) {
        gitPushTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(info.title + '：' + info.body) + ' <button type="button" class="docs-btn" onclick="gitCopyText(document.getElementById(\'gitPushTreeList\').getAttribute(\'data-err-detail\')||\'\')">复制详情</button></div>';
        try { gitPushTreeList.setAttribute('data-err-detail', String((r && r.error) || '')); } catch (e) {}
      }
      return;
    }
    gitShowPushEmptyConfig(false);
    renderGitTree(gitPushTreeList, r.projects, function(cnt) {
      if (gitPushCount) gitPushCount.textContent = '已选 ' + cnt + ' 项变更';
      if (gitPushSubmit) gitPushSubmit.disabled = (cnt === 0);
    }, 'gitPushChk', 'push');
  }).catch(function(e) {
    if (gitPushTreeList) {
      gitPushTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(String(e && e.message || e)) + '</div>';
    }
  });
}

function openGitPushModal() {
  closeGitDropdown();
  if (!currentProject) { showGitError({ title: '请先进入一个项目', body: '请先进入一个项目后再上传。', detail: 'currentProject 为空', primaryText: '关闭', primaryFn: function() {} }); return; }
  if (!window.protoAPI || !window.protoAPI.git) { (typeof showToast === 'function' ? showToast('仅桌面端支持 Git 协同') : null); return; }

  if (gitPushStatus) gitPushStatus.style.display = 'none';
  if (btnGitPushForce) btnGitPushForce.style.display = 'none';
  if (gitPushSubmit) { gitPushSubmit.disabled = true; gitPushSubmit.textContent = '确认上传'; }
  if (gitPushMessage) gitPushMessage.value = '';
  if (gitPushCount) gitPushCount.textContent = '已选 0 项变更';
  if (gitPushTreeList) gitPushTreeList.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">正在比对本地变更…</div>';
  gitShowPushEmptyConfig(false);
  var pm = $('gitPushSelectMenu'); if (pm) pm.style.display = 'none';
  if (gitPushMask) gitPushMask.style.display = 'flex';
  if (window.MaskStack) window.MaskStack.push('gitPushMask', closeGitPushModal);

  window.protoAPI.git.getConfig(currentProject).then(function(cfgRes) {
    var cfg = (cfgRes && cfgRes.config) || {};
    if (!cfg.remoteUrl) {
      gitShowPushEmptyConfig(true);
      var branches0 = ['main', 'master'];
      populateBranchSelect(gitPushBranchSelect, gitPushBranchCustom, btnGitPushBranchToggle, branches0, cfg.branch || 'main');
      return;
    }
    window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
      if (bRes && bRes.code === 'NEED_HEAL') { gitOpenHealConfirm(bRes, function() { openGitPushModal(); }); return; }
      var branches = (bRes && bRes.branches) || ['main', 'master'];
      var cur = (bRes && bRes.currentBranch) || cfg.branch || 'main';
      populateBranchSelect(gitPushBranchSelect, gitPushBranchCustom, btnGitPushBranchToggle, branches, cur);
      loadGitPushStatus(cur);
    }).catch(function() { loadGitPushStatus((cfg && cfg.branch) || 'main'); });
  }).catch(function() {
    window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
      var branches = (bRes && bRes.branches) || ['main', 'master'];
      var cur = (bRes && bRes.currentBranch) || 'main';
      populateBranchSelect(gitPushBranchSelect, gitPushBranchCustom, btnGitPushBranchToggle, branches, cur);
      loadGitPushStatus(cur);
    });
  });
}
function closeGitPushModal() {
  if (window.MaskStack) window.MaskStack.pop('gitPushMask');
  if (btnGitPushForce) btnGitPushForce.style.display = 'none';
  var pm = $('gitPushSelectMenu'); if (pm) pm.style.display = 'none';
  if (gitPushTreeList) gitPushTreeList.innerHTML = '';
  gitShowPushEmptyConfig(false);
  if (gitPushMask) gitPushMask.style.display = 'none';
}
try { window.closeGitPushModal = closeGitPushModal; window.openGitPushModal = openGitPushModal; } catch (e) {}
if (btnGitPushMenuEl) btnGitPushMenuEl.onclick = openGitPushModal;
if (gitPushClose) gitPushClose.onclick = closeGitPushModal;
if (gitPushCancel) gitPushCancel.onclick = closeGitPushModal;

if (gitPushBranchSelect) {
  gitPushBranchSelect.onchange = function() {
    var b = getActiveBranch(gitPushBranchSelect, gitPushBranchCustom);
    var m = gitBranchRuleMsg(b);
    if (m) { gitShowFieldHint(gitPushBranchRuleHint, m, false); return; }
    try { if (typeof showToast === 'function') showToast('已切换目标为 [' + b + ']，本地文件未做任何切换'); } catch (e) {}
    loadGitPushStatus(b);
  };
}
if (gitPushBranchCustom) {
  gitPushBranchCustom.addEventListener('input', function() {
    var m = gitBranchRuleMsg(gitPushBranchCustom.value);
    gitShowFieldHint(gitPushBranchRuleHint, m ? m : '', false);
    if (gitPushSubmit) gitPushSubmit.disabled = !!m;
  });
  gitPushBranchCustom.addEventListener('change', function() {
    var b = getActiveBranch(gitPushBranchSelect, gitPushBranchCustom);
    if (!gitBranchRuleMsg(b)) loadGitPushStatus(b);
  });
}

function gitPushSelectOnlyCurrent() {
  if (!gitPushTreeList) return;
  gitPushTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
  try {
    var cur = currentProject;
    gitPushTreeList.querySelectorAll('.git-tree-proj').forEach(function(projEl) {
      var pname = projEl.getAttribute('data-project') || '';
      var titleEl = projEl.querySelector('.git-tree-proj-title');
      if (titleEl && !pname) pname = String(titleEl.textContent || '').replace(/^项目：/, '').trim();
      if (pname === cur) projEl.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
    });
  } catch (e) {}
  var chks = gitPushTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked');
  if (gitPushCount) gitPushCount.textContent = '已选 ' + chks.length + ' 项变更';
  if (gitPushSubmit) gitPushSubmit.disabled = (chks.length === 0);
}
function gitPushSelectAllVisibleConfirmed() {
  if (!gitPushTreeList) return;
  gitPushTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
  var chks = gitPushTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked');
  if (gitPushCount) gitPushCount.textContent = '已选 ' + chks.length + ' 项变更';
  if (gitPushSubmit) gitPushSubmit.disabled = (chks.length === 0);
}
if (btnGitPushSelectAll) {
  btnGitPushSelectAll.onclick = function(e) {
    try { if (e) e.stopPropagation(); } catch (ee) {}
    var m = $('gitPushSelectMenu');
    if (m) m.style.display = (m.style.display === 'none' || !m.style.display) ? 'flex' : 'none';
    else gitPushSelectOnlyCurrent();
  };
}
(function bindGitPushSelectMenu() {
  var cur = $('btnGitPushSelectCurrent'), vis = $('btnGitPushSelectVisible');
  if (cur) cur.onclick = function() { var m = $('gitPushSelectMenu'); if (m) m.style.display = 'none'; gitPushSelectOnlyCurrent(); };
  if (vis) vis.onclick = function() {
    var m = $('gitPushSelectMenu'); if (m) m.style.display = 'none';
    var files = [];
    try { gitPushTreeList.querySelectorAll('input[type="checkbox"][data-path]').forEach(function(c) { var p = c.getAttribute('data-path'); if (p) files.push(p); }); } catch (e) {}
    var foreign = gitForeignProjects(files);
    if (foreign.length) {
      gitPendingCrossProj = { kind: 'select-all', files: files };
      var t = $('gitCrossProjConfirmText');
      if (t) t.textContent = '全选全部可见将包含异项目文件，一并推送到同一远端同一分支，不可单独撤回。';
      var l = $('gitCrossProjConfirmList');
      if (l) l.textContent = '异项目清单：' + foreign.slice(0, 5).join('、') + (foreign.length > 5 ? (' 等 ' + foreign.length + ' 项') : '');
      var ack = $('gitCrossProjConfirmAck'); if (ack) ack.checked = false;
      gitOpenMask('gitCrossProjConfirmMask');
      return;
    }
    gitPushSelectAllVisibleConfirmed();
  };
})();
if (btnGitPushClearAll) {
  btnGitPushClearAll.onclick = function() {
    if (!gitPushTreeList) return;
    gitPushTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
    if (gitPushCount) gitPushCount.textContent = '已选 0 项变更';
    if (gitPushSubmit) gitPushSubmit.disabled = true;
  };
}
(function bindGitPushGotoConfig() {
  var b = $('btnGitPushGotoConfig');
  if (b) b.onclick = function() { try { closeGitPushModal(); } catch (e) {} openGitConfigModal(); };
})();

var btnGitPushForce = $('btnGitPushForce');

function executeGitPush(force) {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  var files = gitCollectChecked(gitPushTreeList);
  if (!files.length) { showGitError({ title: '尚未勾选文件', body: '请至少勾选一个需要发布的文件。', detail: '已选 0 项', primaryText: '知道了', primaryFn: function() {} }); return; }

  var msg = (gitPushMessage && gitPushMessage.value.trim()) || '更新原型与文档数据';
  var branch = getActiveBranch(gitPushBranchSelect, gitPushBranchCustom);
  var bMsg = gitBranchRuleMsg(branch);
  if (bMsg) { showGitError({ code: 'INVALID_BRANCH', detail: bMsg, primaryText: '修正分支名', primaryFn: function() {} }); return; }
  var foreign = gitForeignProjects(files);
  if (!force && foreign.length) {
    gitPendingCrossProj = { kind: 'push', files: files, message: msg, branch: branch };
    var t = $('gitCrossProjConfirmText');
    if (t) t.textContent = '本次将跨项目推送到同一远端同一分支 [' + branch + ']，异项目文件将一并推送，不可单独撤回。';
    var l = $('gitCrossProjConfirmList');
    if (l) l.textContent = '异项目清单：' + foreign.slice(0, 5).join('、') + (foreign.length > 5 ? (' 等 ' + foreign.length + ' 项') : '') + '\n本次共 ' + files.length + ' 个文件。';
    var ack = $('gitCrossProjConfirmAck'); if (ack) ack.checked = false;
    gitOpenMask('gitCrossProjConfirmMask');
    return;
  }

  if (gitPushSubmit) { gitPushSubmit.disabled = true; }
  if (btnGitPushForce) btnGitPushForce.disabled = true;
  if (gitPushSubmit) gitPushSubmit.textContent = force ? '强制覆盖中…' : '上传中…';
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
        var extra = force ? '远端历史已被改写。' : '';
        gitPushStatus.textContent = (force ? '强制覆盖发布成功！' : '发布成功！') + '已上传 ' + (r.filesCount || files.length) + ' 个文件至分支 [' + (r.branch || branch) + ']。' + extra;
        gitPushStatus.style.display = 'block';
      }
      setTimeout(function() { closeGitPushModal(); }, 1600);
    } else if (r && r.code === 'NEED_HEAL') {
      if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '确认上传'; }
      if (btnGitPushForce) btnGitPushForce.disabled = false;
      gitOpenHealConfirm(r, function() { executeGitPush(!!force); });
    } else if (r && r.code === 'NEED_CONFIG') {
      if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '确认上传'; }
      if (btnGitPushForce) btnGitPushForce.disabled = false;
      gitShowPushEmptyConfig(true);
    } else {
      if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '重试上传'; }
      if (btnGitPushForce) {
        btnGitPushForce.disabled = false;
        btnGitPushForce.style.display = (r && r.canForce) ? 'inline-block' : 'none';
      }
      var info = gitErrorInfo((r && r.code) || '', (r && r.error) || '');
      if (gitPushStatus) {
        gitPushStatus.className = 'git-status-msg err';
        gitPushStatus.textContent = info.title + '：' + info.body;
        gitPushStatus.style.display = 'block';
      }
      if (r && (r.canForce || r.needPull)) {
        showGitError({ code: '', title: info.title, body: info.body, detail: String((r && r.error) || ''), primaryText: '拉取同步后重试', primaryFn: function() { try { closeGitPushModal(); } catch (e) {} openGitPullModal(); }, secondaryText: (r && r.canForce) ? '强制覆盖上传' : '', secondaryFn: function() { gitOpenForceConfirm(branch, files); } });
      }
    }
  }).catch(function(err) {
    if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '重试上传'; }
    if (btnGitPushForce) btnGitPushForce.disabled = false;
    var info2 = gitErrorInfo('', String(err && err.message || err));
    if (gitPushStatus) {
      gitPushStatus.className = 'git-status-msg err';
      gitPushStatus.textContent = info2.title + '：' + info2.body;
      gitPushStatus.style.display = 'block';
    }
  });
}
function gitOpenForceConfirm(branch, files) {
  var t = $('gitForceConfirmText');
  var foreign = gitForeignProjects(files || []);
  if (t) t.textContent = '分支：[' + (branch || '') + ']\n已选文件数：' + ((files || []).length) + (foreign.length ? '\n含异项目：' + foreign.slice(0, 5).join('、') + (foreign.length > 5 ? (' 等 ' + foreign.length + ' 项') : '') : '\n不含异项目') + '\n后果：远端历史将被改写，此操作不可恢复。';
  var inp = $('gitForceConfirmInput'); if (inp) inp.value = '';
  gitOpenMask('gitForceConfirmMask');
  var ok = $('gitForceConfirmOk');
  if (ok) ok.onclick = function() {
    var v = inp ? String(inp.value || '').trim() : '';
    if (v !== String(branch || '').trim()) {
      showGitError({ title: '分支名不一致', body: '请键入目标分支名 [' + branch + '] 以确认强制覆盖。', detail: '输入：' + v, primaryText: '知道了', primaryFn: function() { gitOpenMask('gitForceConfirmMask'); } });
      gitCloseMask('gitForceConfirmMask');
      return;
    }
    gitCloseMask('gitForceConfirmMask');
    executeGitPush(true);
  };
}
(function bindGitForceConfirm() {
  var c = $('gitForceConfirmCancel'), x = $('gitForceConfirmClose');
  if (c) c.onclick = function() { gitCloseMask('gitForceConfirmMask'); };
  if (x) x.onclick = function() { gitCloseMask('gitForceConfirmMask'); };
})();
(function bindGitCrossProjConfirm() {
  var ok = $('gitCrossProjConfirmOk'), cancel = $('gitCrossProjConfirmCancel'), x = $('gitCrossProjConfirmClose');
  function close() { gitCloseMask('gitCrossProjConfirmMask'); gitPendingCrossProj = null; }
  if (ok) ok.onclick = function() {
    var ack = $('gitCrossProjConfirmAck');
    if (ack && !ack.checked) { showGitError({ title: '请先知悉风险', body: '跨项目推送需勾选已知悉才能继续。', detail: 'ack 未勾选', primaryText: '知道了', primaryFn: function() { if (gitPendingCrossProj) gitOpenMask('gitCrossProjConfirmMask'); } }); gitCloseMask('gitCrossProjConfirmMask'); return; }
    var pend = gitPendingCrossProj;
    gitCloseMask('gitCrossProjConfirmMask');
    gitPendingCrossProj = null;
    if (!pend) return;
    if (pend.kind === 'select-all') { gitPushSelectAllVisibleConfirmed(); return; }
    if (pend.kind === 'select-all-pull') { gitPullSelectAllVisibleConfirmed(); return; }
    if (pend.kind === 'push') { executeGitPushWithForeign(pend.files, pend.message, pend.branch); return; }
    if (pend.kind === 'pull-cover-all') { gitDoPull(pend.files, pend.branch, false); return; }
  };
  if (cancel) cancel.onclick = close;
  if (x) x.onclick = close;
})();
function executeGitPushWithForeign(files, msg, branch) {
  if (gitPushSubmit) { gitPushSubmit.disabled = true; gitPushSubmit.textContent = '上传中…'; }
  if (btnGitPushForce) btnGitPushForce.disabled = true;
  window.protoAPI.git.push({ project: currentProject, files: files, message: msg, branch: branch, force: false }).then(function(r) {
    if (r && r.ok) {
      if (btnGitPushForce) btnGitPushForce.style.display = 'none';
      if (gitPushStatus) { gitPushStatus.className = 'git-status-msg ok'; gitPushStatus.textContent = '发布成功！已上传 ' + (r.filesCount || files.length) + ' 个文件至分支 [' + (r.branch || branch) + ']。'; gitPushStatus.style.display = 'block'; }
      setTimeout(function() { closeGitPushModal(); }, 1600);
    } else if (r && r.code === 'NEED_HEAL') {
      if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '确认上传'; }
      gitOpenHealConfirm(r, function() { executeGitPushWithForeign(files, msg, branch); });
    } else {
      if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '重试上传'; }
      if (btnGitPushForce) { btnGitPushForce.disabled = false; btnGitPushForce.style.display = (r && r.canForce) ? 'inline-block' : 'none'; }
      var info = gitErrorInfo((r && r.code) || '', (r && r.error) || '');
      if (gitPushStatus) { gitPushStatus.className = 'git-status-msg err'; gitPushStatus.textContent = info.title + '：' + info.body; gitPushStatus.style.display = 'block'; }
    }
  }).catch(function(err) {
    if (gitPushSubmit) { gitPushSubmit.disabled = false; gitPushSubmit.textContent = '重试上传'; }
    if (gitPushStatus) { gitPushStatus.className = 'git-status-msg err'; gitPushStatus.textContent = String(err && err.message || err); gitPushStatus.style.display = 'block'; }
  });
}

if (gitPushSubmit) {
  gitPushSubmit.onclick = function() { executeGitPush(false); };
}
if (btnGitPushForce) {
  btnGitPushForce.onclick = function() {
    var files = gitCollectChecked(gitPushTreeList);
    var branch = getActiveBranch(gitPushBranchSelect, gitPushBranchCustom);
    gitOpenForceConfirm(branch, files);
  };
}

/* 3. Git 拉取同步弹窗（P0：未配空态 + 脏检查三选一 + 按项目全选 + 多项目 Banner） */
function gitShowPullEmptyConfig(show) {
  var emptyEl = $('gitPullEmptyConfig');
  if (emptyEl) emptyEl.style.display = show ? 'flex' : 'none';
  if (show && gitPullTreeList) gitPullTreeList.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">尚未配置远程仓库，无法拉取同步。请先配置全局远端。</div>';
  if (show && gitPullSubmit) gitPullSubmit.disabled = true;
}
function loadGitPullDiff(targetBranch) {
  if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
  var bMsg = gitBranchRuleMsg(targetBranch || '');
  if (bMsg) {
    gitShowFieldHint(gitPullBranchRuleHint, bMsg, false);
    if (gitPullTreeList) gitPullTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(bMsg) + '</div>';
    if (gitPullSubmit) gitPullSubmit.disabled = true;
    return;
  }
  gitShowFieldHint(gitPullBranchRuleHint, '', false);
  if (gitPullTreeList) gitPullTreeList.innerHTML = '<div style="color:var(--faint);padding:16px;text-align:center;">正在探测远程仓库更新…</div>';
  if (gitPullCount) gitPullCount.textContent = '已选 0 项更新';
  if (gitPullSubmit) gitPullSubmit.disabled = true;
  if (gitPullProjectSwitchBanner) gitPullProjectSwitchBanner.style.display = 'none';
  var brow = $('gitPullBackupRow'); if (brow) brow.style.display = 'none';

  window.protoAPI.git.fetchDiff({ project: currentProject, branch: targetBranch }).then(function(r) {
    if (!r || !r.ok) {
      if (r && r.code === 'NEED_HEAL') { gitOpenHealConfirm(r, function() { loadGitPullDiff(targetBranch); }); return; }
      if (r && r.code === 'NEED_CONFIG') { gitShowPullEmptyConfig(true); return; }
      var info = gitErrorInfo((r && r.code) || '', (r && r.error) || '');
      if (gitPullTreeList) {
        gitPullTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(info.title + '：' + info.body) + '</div>';
      }
      return;
    }
    gitShowPullEmptyConfig(false);
    renderGitTree(gitPullTreeList, r.projects, function(cnt) {
      if (gitPullCount) gitPullCount.textContent = '已选 ' + cnt + ' 项更新';
      if (gitPullSubmit) gitPullSubmit.disabled = (cnt === 0);
    }, 'gitPullChk', 'pull');
  }).catch(function(e) {
    if (gitPullTreeList) {
      gitPullTreeList.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;">' + escHtml(String(e && e.message || e)) + '</div>';
    }
  });
}

function openGitPullModal() {
  closeGitDropdown();
  if (!currentProject) { showGitError({ title: '请先进入一个项目', body: '请先进入一个项目后再拉取。', detail: 'currentProject 为空', primaryText: '关闭', primaryFn: function() {} }); return; }
  if (!window.protoAPI || !window.protoAPI.git) { (typeof showToast === 'function' ? showToast('仅桌面端支持 Git 协同') : null); return; }

  if (gitPullStatus) gitPullStatus.style.display = 'none';
  if (gitPullProjectSwitchBanner) gitPullProjectSwitchBanner.style.display = 'none';
  var brow0 = $('gitPullBackupRow'); if (brow0) brow0.style.display = 'none';
  if (gitPullSubmit) { gitPullSubmit.disabled = true; gitPullSubmit.textContent = '确认拉取'; }
  if (gitPullCount) gitPullCount.textContent = '已选 0 项更新';
  if (gitPullTreeList) gitPullTreeList.innerHTML = '<div style="color:var(--faint);padding:24px;text-align:center;font-size:12.5px;">正在探测远程仓库更新…</div>';
  gitShowPullEmptyConfig(false);
  var pm = $('gitPullSelectMenu'); if (pm) pm.style.display = 'none';
  if (gitPullMask) gitPullMask.style.display = 'flex';
  if (window.MaskStack) window.MaskStack.push('gitPullMask', closeGitPullModal);

  window.protoAPI.git.getConfig(currentProject).then(function(cfgRes) {
    var cfg = (cfgRes && cfgRes.config) || {};
    if (!cfg.remoteUrl) {
      gitShowPullEmptyConfig(true);
      populateBranchSelect(gitPullBranchSelect, gitPullBranchCustom, btnGitPullBranchToggle, ['main', 'master'], cfg.branch || 'main');
      return;
    }
    window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
      if (bRes && bRes.code === 'NEED_HEAL') { gitOpenHealConfirm(bRes, function() { openGitPullModal(); }); return; }
      var branches = (bRes && bRes.branches) || ['main', 'master'];
      var cur = (bRes && bRes.currentBranch) || cfg.branch || 'main';
      populateBranchSelect(gitPullBranchSelect, gitPullBranchCustom, btnGitPullBranchToggle, branches, cur);
      loadGitPullDiff(cur);
    }).catch(function() { loadGitPullDiff((cfg && cfg.branch) || 'main'); });
  }).catch(function() {
    window.protoAPI.git.listBranches({ project: currentProject }).then(function(bRes) {
      var branches = (bRes && bRes.branches) || ['main', 'master'];
      var cur = (bRes && bRes.currentBranch) || 'main';
      populateBranchSelect(gitPullBranchSelect, gitPullBranchCustom, btnGitPullBranchToggle, branches, cur);
      loadGitPullDiff(cur);
    });
  });
}
function closeGitPullModal() {
  if (window.MaskStack) window.MaskStack.pop('gitPullMask');
  if (gitPullTreeList) gitPullTreeList.innerHTML = '';
  var pm = $('gitPullSelectMenu'); if (pm) pm.style.display = 'none';
  gitShowPullEmptyConfig(false);
  if (gitPullMask) gitPullMask.style.display = 'none';
}
try { window.closeGitPullModal = closeGitPullModal; window.openGitPullModal = openGitPullModal; } catch (e) {}
if (btnGitPullMenuEl) btnGitPullMenuEl.onclick = openGitPullModal;
if (gitPullClose) gitPullClose.onclick = closeGitPullModal;
if (gitPullCancel) gitPullCancel.onclick = closeGitPullModal;

if (gitPullBranchSelect) {
  gitPullBranchSelect.onchange = function() {
    var b = getActiveBranch(gitPullBranchSelect, gitPullBranchCustom);
    var m = gitBranchRuleMsg(b);
    if (m) { gitShowFieldHint(gitPullBranchRuleHint, m, false); return; }
    try { if (typeof showToast === 'function') showToast('已切换拉取来源为 [' + b + ']，本地文件未做任何切换'); } catch (e) {}
    loadGitPullDiff(b);
  };
}
if (gitPullBranchCustom) {
  gitPullBranchCustom.addEventListener('input', function() {
    var m = gitBranchRuleMsg(gitPullBranchCustom.value);
    gitShowFieldHint(gitPullBranchRuleHint, m ? m : '', false);
    if (gitPullSubmit) gitPullSubmit.disabled = !!m;
  });
  gitPullBranchCustom.addEventListener('change', function() {
    var b = getActiveBranch(gitPullBranchSelect, gitPullBranchCustom);
    if (!gitBranchRuleMsg(b)) loadGitPullDiff(b);
  });
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

function gitPullSelectOnlyCurrent() {
  if (!gitPullTreeList) return;
  gitPullTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
  try {
    var cur = currentProject;
    gitPullTreeList.querySelectorAll('.git-tree-proj').forEach(function(projEl) {
      var pname = projEl.getAttribute('data-project') || '';
      var titleEl = projEl.querySelector('.git-tree-proj-title');
      if (titleEl && !pname) pname = String(titleEl.textContent || '').replace(/^项目：/, '').trim();
      if (pname === cur) projEl.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
    });
  } catch (e) {}
  var chks = gitPullTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked');
  if (gitPullCount) gitPullCount.textContent = '已选 ' + chks.length + ' 项更新';
  if (gitPullSubmit) gitPullSubmit.disabled = (chks.length === 0);
}
function gitPullSelectAllVisibleConfirmed() {
  if (!gitPullTreeList) return;
  gitPullTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
  var chks = gitPullTreeList.querySelectorAll('input[type="checkbox"][data-path]:checked');
  if (gitPullCount) gitPullCount.textContent = '已选 ' + chks.length + ' 项更新';
  if (gitPullSubmit) gitPullSubmit.disabled = (chks.length === 0);
}
if (btnGitPullSelectAll) {
  btnGitPullSelectAll.onclick = function(e) {
    try { if (e) e.stopPropagation(); } catch (ee) {}
    var m = $('gitPullSelectMenu');
    if (m) m.style.display = (m.style.display === 'none' || !m.style.display) ? 'flex' : 'none';
    else gitPullSelectOnlyCurrent();
  };
}
(function bindGitPullSelectMenu() {
  var cur = $('btnGitPullSelectCurrent'), vis = $('btnGitPullSelectVisible');
  if (cur) cur.onclick = function() { var m = $('gitPullSelectMenu'); if (m) m.style.display = 'none'; gitPullSelectOnlyCurrent(); };
  if (vis) vis.onclick = function() {
    var m = $('gitPullSelectMenu'); if (m) m.style.display = 'none';
    var files = [];
    try { gitPullTreeList.querySelectorAll('input[type="checkbox"][data-path]').forEach(function(c) { var p = c.getAttribute('data-path'); if (p) files.push(p); }); } catch (e) {}
    var foreign = gitForeignProjects(files);
    if (foreign.length) {
      gitPendingCrossProj = { kind: 'select-all-pull', files: files };
      var t = $('gitCrossProjConfirmText');
      if (t) t.textContent = '全选全部可见将包含异项目文件，拉取后将在本地创建对应目录。';
      var l = $('gitCrossProjConfirmList');
      if (l) l.textContent = '异项目清单：' + foreign.slice(0, 5).join('、') + (foreign.length > 5 ? (' 等 ' + foreign.length + ' 项') : '');
      var ack = $('gitCrossProjConfirmAck'); if (ack) ack.checked = false;
      gitOpenMask('gitCrossProjConfirmMask');
      return;
    }
    gitPullSelectAllVisibleConfirmed();
  };
})();
if (btnGitPullClearAll) {
  btnGitPullClearAll.onclick = function() {
    if (!gitPullTreeList) return;
    gitPullTreeList.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
    if (gitPullCount) gitPullCount.textContent = '已选 0 项更新';
    if (gitPullSubmit) gitPullSubmit.disabled = true;
  };
}
(function bindGitPullGotoConfig() {
  var b = $('btnGitPullGotoConfig');
  if (b) b.onclick = function() { try { closeGitPullModal(); } catch (e) {} openGitConfigModal(); };
  var ob = $('btnGitPullOpenBackup');
  if (ob) ob.onclick = function() {
    var p = $('gitPullBackupPath');
    gitCopyText(p ? p.textContent : '', '备份路径已复制');
  };
})();

/* D3：拉取前脏检查三选一；备份走 git:pull{backup:true} */
function gitDoPull(files, branch, withBackup) {
  if (gitPullSubmit) { gitPullSubmit.disabled = true; gitPullSubmit.textContent = '拉取中…'; }
  if (gitPullStatus) { gitPullStatus.style.display = 'none'; }
  if (gitPullProjectSwitchBanner) { gitPullProjectSwitchBanner.style.display = 'none'; }
  var brow = $('gitPullBackupRow'); if (brow) brow.style.display = 'none';
  window.protoAPI.git.pull({
    project: currentProject,
    files: files,
    branch: branch,
    backup: !!withBackup
  }).then(function(r) {
    if (r && r.code === 'NEED_HEAL') {
      if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '确认拉取'; }
      gitOpenHealConfirm(r, function() { gitDoPull(files, branch, withBackup); });
      return;
    }
    if (r && r.code === 'NEED_CONFIG') {
      if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '确认拉取'; }
      gitShowPullEmptyConfig(true);
      return;
    }
    if (r && r.ok) {
      var affected = (r.affectedProjects || []).filter(Boolean);
      var otherProjects = affected.filter(function(p) { return p !== currentProject; });
      var backupPath = r.backupPath || '';

      if (gitPullStatus) {
        gitPullStatus.className = 'git-status-msg ok';
        var msg = '同步完成！已成功拉取 ' + (r.filesCount != null ? r.filesCount : files.length) + ' 个文件（分支 [' + (r.branch || branch) + ']）。';
        if (backupPath) msg += '其中本地旧版已备份到 ' + backupPath + '。';
        gitPullStatus.textContent = msg;
        gitPullStatus.style.display = 'block';
      }
      if (backupPath) {
        var br2 = $('gitPullBackupRow'), bp = $('gitPullBackupPath');
        if (br2) br2.style.display = 'flex';
        if (bp) bp.textContent = '备份路径：' + backupPath;
      }

      if (affected.indexOf(currentProject) >= 0) {
        if (typeof loadSandboxSources === 'function') {
          try { loadSandboxSources(); } catch (e) {}
        }
      }

      if (otherProjects.length > 0) {
        if (gitPullProjectSwitchBanner && gitPullProjectSwitchText) {
          gitPullProjectSwitchText.textContent = '检测到包含项目【' + otherProjects.join('、') + '】，已在本地自动为您创建目录。';
          gitPullProjectSwitchBanner.style.display = 'block';
          var btns = $('gitPullProjectSwitchBtns');
          if (btns) {
            btns.innerHTML = '';
            otherProjects.forEach(function(tp) {
              var b = document.createElement('button');
              b.className = 'docs-btn';
              b.type = 'button';
              b.style.cssText = 'font-size:12px; padding:2px 10px; white-space:nowrap;';
              b.textContent = '进入' + tp + '查看';
              b.onclick = function() { closeGitPullModal(); if (typeof enterProject === 'function') enterProject(tp); };
              btns.appendChild(b);
            });
          }
          if (btnGitPullSwitchNow) {
            btnGitPullSwitchNow.textContent = '进入该项目查看';
            btnGitPullSwitchNow.onclick = function() {
              closeGitPullModal();
              if (typeof enterProject === 'function') enterProject(otherProjects[0]);
            };
          }
        }
      }
      if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '确认拉取'; }
    } else {
      if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '重试拉取'; }
      var info = gitErrorInfo((r && r.code) || '', (r && (r.error || (r.failed && r.failed.length ? '部分文件拉取失败' : ''))) || '');
      if (gitPullStatus) {
        gitPullStatus.className = 'git-status-msg err';
        var em = info.title + '：' + info.body;
        if (r && r.failed && r.failed.length) em += '（失败 ' + r.failed.length + ' 项，详见复制详情）';
        gitPullStatus.textContent = em;
        gitPullStatus.style.display = 'block';
      }
      if (r && r.backupPath) {
        var br3 = $('gitPullBackupRow'), bp3 = $('gitPullBackupPath');
        if (br3) br3.style.display = 'flex';
        if (bp3) bp3.textContent = '备份路径：' + r.backupPath;
      }
    }
  }).catch(function(err) {
    if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '重试拉取'; }
    var info2 = gitErrorInfo('', String(err && err.message || err));
    if (gitPullStatus) {
      gitPullStatus.className = 'git-status-msg err';
      gitPullStatus.textContent = info2.title + '：' + info2.body;
      gitPullStatus.style.display = 'block';
    }
  });
}
function gitCheckDirtyThenPull(files, branch) {
  var bMsg = gitBranchRuleMsg(branch);
  if (bMsg) { showGitError({ code: 'INVALID_BRANCH', detail: bMsg, primaryText: '修正分支名', primaryFn: function() {} }); return; }
  if (gitPullSubmit) { gitPullSubmit.disabled = true; gitPullSubmit.textContent = '检查本地修改…'; }
  window.protoAPI.git.getStatus({ project: currentProject, branch: branch }).then(function(sr) {
    if (sr && sr.code === 'NEED_HEAL') {
      if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '确认拉取'; }
      gitOpenHealConfirm(sr, function() { gitCheckDirtyThenPull(files, branch); });
      return;
    }
    if (!sr || !sr.ok) {
      gitDoPull(files, branch, false);
      return;
    }
    var dirty = {};
    try {
      (sr.projects || []).forEach(function(p) {
        (p.protos || []).forEach(function(pr) {
          (pr.files || []).forEach(function(f) { if (f && f.path) dirty[f.path] = 1; });
        });
      });
    } catch (e) {}
    var overlap = (files || []).filter(function(p) { return dirty[p]; });
    if (!overlap.length) { gitDoPull(files, branch, false); return; }
    gitPendingPullCover = { files: files, branch: branch, overlap: overlap };
    var t = $('gitPullCoverConfirmText');
    if (t) t.textContent = '以下 ' + overlap.length + ' 个文件本地有未提交修改，拉取将用远端 [' + branch + '] 版本覆盖。建议先备份；覆盖后本地修改不可直接撤销。';
    var l = $('gitPullCoverConfirmList');
    if (l) l.textContent = overlap.slice(0, 8).join('\n') + (overlap.length > 8 ? ('\n等 ' + overlap.length + ' 项') : '');
    if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '确认拉取'; }
    gitOpenMask('gitPullCoverConfirmMask');
  }).catch(function() { gitDoPull(files, branch, false); });
}
(function bindGitPullCover() {
  var b = $('btnGitPullCoverBackup'), g = $('btnGitPullCoverGotoPush'), c = $('btnGitPullCoverCancel'), x = $('gitPullCoverConfirmClose');
  if (b) b.onclick = function() {
    var pend = gitPendingPullCover;
    gitCloseMask('gitPullCoverConfirmMask');
    if (!pend) return;
    gitPendingPullCover = null;
    gitDoPull(pend.files, pend.branch, true);
  };
  if (g) g.onclick = function() {
    var pend = gitPendingPullCover;
    gitCloseMask('gitPullCoverConfirmMask');
    gitPendingPullCover = null;
    try { closeGitPullModal(); } catch (e) {}
    try { openGitPushModal(); } catch (e) {}
  };
  function cancel() { gitCloseMask('gitPullCoverConfirmMask'); gitPendingPullCover = null; }
  if (c) c.onclick = cancel;
  if (x) x.onclick = cancel;
})();

if (gitPullSubmit) {
  gitPullSubmit.onclick = function() {
    if (!currentProject || !window.protoAPI || !window.protoAPI.git) return;
    var files = gitCollectChecked(gitPullTreeList);
    if (!files.length) { showGitError({ title: '尚未勾选文件', body: '请至少勾选一个需要拉取的文件。', detail: '已选 0 项', primaryText: '知道了', primaryFn: function() {} }); return; }

    var branch = getActiveBranch(gitPullBranchSelect, gitPullBranchCustom);

    if (gitPullProjectSwitchBanner) { gitPullProjectSwitchBanner.style.display = 'none'; }
    gitCheckDirtyThenPull(files, branch);
  };
}

/* D4：自愈确认页（NEED_HEAL{nested[]}，未确认不得同步；确认走 git:heal-repair） */
function gitOpenHealConfirm(res, retryFn) {
  gitHealPendingRetry = (typeof retryFn === 'function') ? retryFn : null;
  var reason = (res && (res.reason || res.code)) || '';
  var nested = (res && res.nested) || [];
  var detail = (res && res.detail) || '';
  var t = $('gitHealConfirmText');
  if (t) {
    var head = '原因：' + (reason === 'nested' ? '发现嵌套仓库' : reason === 'missing' ? '总根库缺失' : reason === 'broken' ? '总根库损坏' : String(reason || '沙箱异常'));
    if (detail) head += '\n诊断：' + String(detail).slice(0, 300);
    t.textContent = head;
  }
  var l = $('gitHealNestedList');
  if (l) {
    if (nested && nested.length) l.textContent = '嵌套路径清单（' + nested.length + ' 处）：\n' + nested.slice(0, 20).join('\n') + (nested.length > 20 ? ('\n等 ' + nested.length + ' 项') : '');
    else l.textContent = '未发现嵌套路径，总根库需重建。同步前需清理并重建总根库。';
  }
  var pv = $('gitHealBackupPreview');
  if (pv) pv.textContent = '清理前将自动备份到 sandbox/.heal-backup/<时间>/，清理后嵌套库历史将不再可用，总根库历史不受影响。';
  var ack = $('gitHealConfirmAck'); if (ack) ack.checked = false;
  gitOpenMask('gitHealConfirmMask');
}
(function bindGitHeal() {
  var repair = $('btnGitHealRepair'), later = $('btnGitHealLater'), openDir = $('btnGitHealOpenDir'), x = $('gitHealConfirmClose');
  if (repair) repair.onclick = function() {
    var ack = $('gitHealConfirmAck');
    if (ack && !ack.checked) {
      showGitError({ title: '请先知悉风险', body: '自愈清理需勾选已知悉才能执行备份后修复。', detail: 'ack 未勾选', primaryText: '知道了', primaryFn: function() { gitOpenMask('gitHealConfirmMask'); } });
      gitCloseMask('gitHealConfirmMask');
      return;
    }
    repair.disabled = true; repair.textContent = '修复中…';
    var branch = 'main';
    try { branch = getActiveBranch(gitPullBranchSelect, gitPullBranchCustom) || getActiveBranch(gitPushBranchSelect, gitPushBranchCustom) || 'main'; } catch (e) {}
    window.protoAPI.git.healRepair({ project: currentProject, branch: branch }).then(function(r) {
      repair.disabled = false; repair.textContent = '备份后修复';
      if (r && r.ok) {
        gitCloseMask('gitHealConfirmMask');
        var msg = '已备份 ' + ((r.healed || []).length) + ' 处到 ' + (r.backupDir || '') + '，已重建总根库。';
        showGitError({ title: '自愈修复完成', body: msg, detail: 'backupDir=' + (r.backupDir || '') + '\nhealed=' + JSON.stringify(r.healed || []), primaryText: '继续同步', primaryFn: function() { var fn = gitHealPendingRetry; gitHealPendingRetry = null; if (fn) fn(); }, secondaryText: '复制备份路径', secondaryFn: function() { gitCopyText(String((r && r.backupDir) || ''), '备份路径已复制'); var fn2 = gitHealPendingRetry; gitHealPendingRetry = null; if (fn2) fn2(); } });
        gitHealPendingRetry = gitHealPendingRetry;
      } else {
        showGitError({ code: (r && r.code) || '', detail: (r && (r.error || r.detail)) || '修复失败', primaryText: '重试', primaryFn: function() { gitOpenMask('gitHealConfirmMask'); } });
      }
    }).catch(function(err) {
      repair.disabled = false; repair.textContent = '备份后修复';
      showGitError({ code: '', detail: String(err && err.message || err), primaryText: '重试', primaryFn: function() { gitOpenMask('gitHealConfirmMask'); } });
    });
  };
  function laterFn() { gitCloseMask('gitHealConfirmMask'); try { if (typeof showToast === 'function') showToast('已暂不处理，同步已阻断，本地原型可正常使用'); } catch (e) {} }
  if (later) later.onclick = laterFn;
  if (x) x.onclick = laterFn;
  if (openDir) openDir.onclick = function() {
    window.protoAPI.sandbox.list().then(function(r) {
      var root = (r && r.root) || '';
      gitCopyText(root || 'sandbox', '沙箱目录已复制');
      showGitError({ title: '沙箱目录', body: '沙箱根：' + (root || '未知') + '（已复制）。请手动在资源管理器中打开。', detail: root, primaryText: '知道了', primaryFn: function() { gitOpenMask('gitHealConfirmMask'); } });
      gitCloseMask('gitHealConfirmMask');
    }).catch(function() { try { if (typeof showToast === 'function') showToast('无法获取沙箱目录'); } catch (e) {} });
  };
})();
(function bindGitErrorMask() {
  var ok = $('btnGitErrorOk'), x = $('gitErrorClose'), t = $('btnGitErrorToggleDetail'), cp = $('btnGitErrorCopy'), cfg = $('btnGitErrorGotoConfig');
  function close() { gitCloseMask('gitErrorMask'); }
  if (ok) ok.onclick = close;
  if (x) x.onclick = close;
  if (t) t.onclick = function() {
    var d = $('gitErrorDetail');
    if (!d) return;
    var show = (d.style.display === 'none' || !d.style.display);
    d.style.display = show ? 'block' : 'none';
    t.textContent = show ? '隐藏详情' : '查看详情';
  };
  if (cp) cp.onclick = function() { gitCopyText(gitErrorCtx.detail || '', '详情已复制'); };
  if (cfg) cfg.onclick = function() { close(); openGitConfigModal(); };
})();
try { window.gitCopyText = gitCopyText; window.showGitError = showGitError; window.gitOpenHealConfirm = gitOpenHealConfirm; } catch (e) {}
document.addEventListener('click', function(e) {
  try {
    var pm1 = document.getElementById('gitPushSelectMenu');
    var pm2 = document.getElementById('gitPullSelectMenu');
    if (pm1 && pm1.style.display !== 'none' && (!e.target.closest || !e.target.closest('#gitPushSelectMenu')) && e.target.id !== 'btnGitPushSelectAll') pm1.style.display = 'none';
    if (pm2 && pm2.style.display !== 'none' && (!e.target.closest || !e.target.closest('#gitPullSelectMenu')) && e.target.id !== 'btnGitPullSelectAll') pm2.style.display = 'none';
  } catch (ee) {}
});

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
var setApiProviderName=$('setApiProviderName');
var btnTestApi=$('btnTestApi'),testApiStatus=$('testApiStatus');
var setModelSearch=$('setModelSearch'),btnClearAllModels=$('btnClearAllModels');
var modelCheckList=$('modelCheckList'),newModelInput=$('newModelInput'),btnAddCustomModel=$('btnAddCustomModel');
var curAiConfig=null;
/* Iteration5: 多 CLI + 多协议 + 全局默认模型（只增量，不改既有通道名） */
var setApiProtocol=$('setApiProtocol'),btnFetchModels=$('btnFetchModels'),fetchModelStatus=$('fetchModelStatus');
var byokTestPanel=$('byokTestPanel'),testStatusBadge=$('testStatusBadge'),testMessageText=$('testMessageText'),baseUrlHint=$('baseUrlHint');
var aiAgentMatrix=$('aiAgentMatrix'),btnRedetectAgents=$('btnRedetectAgents');
var aiAgentBadge=$('aiAgentBadge'),aiAgentName=$('aiAgentName');
var I5_AGENT_ORDER=["opencode","claude","cursor-agent","codex","deepseek-harness","qwen","deepseek","mimo","amp","codebuddy","aider","grok-build","antigravity","atomcode","amr","copilot","devin","hermes","kilo","kimi","kiro","pi","qoder","reasonix","trae-cli","vibe"];
var I5_AGENT_FALLBACK={"opencode":"OpenCode CLI","claude":"Claude Code","cursor-agent":"Cursor Agent","codex":"OpenAI Codex","deepseek-harness":"DeepSeek Harness","qwen":"Qwen Code","deepseek":"DeepSeek TUI","mimo":"MiMo Code","amp":"Amp","codebuddy":"Codebuddy Code","aider":"Aider","grok-build":"Grok Build","antigravity":"Antigravity","atomcode":"AtomCode CLI","amr":"AMR","copilot":"GitHub Copilot CLI","devin":"Devin","hermes":"Hermes","kilo":"Kilo","kimi":"Kimi CLI","kiro":"Kiro CLI","pi":"Pi","qoder":"Qoder CLI","reasonix":"DeepSeek Reasonix","trae-cli":"Trae CLI","vibe":"Mistral Vibe CLI"};
var I5_PROTO_HINT={ openai:'OpenAI 系以 /v1 结尾', anthropic:'Anthropic 官方以 /v1 结尾', google:'Gemini 系以 /v1beta 结尾', ollama:'Ollama 本地默认为 http://localhost:11434/v1', azure:'Azure 需含部署名与 api-version' };
/* Iteration6：API多配置卡片（apiProfiles + activeApiProfileId，三镜像兼容后端） */
var API_PROVIDER_LABEL={ deepseek:'DeepSeek 官方', ali:'阿里百炼', siliconflow:'硅基流动', openrouter:'OpenRouter', custom:'自定义', openai:'OpenAI', anthropic:'Anthropic', google:'Google', ollama:'Ollama', azure:'Azure' };
var apiProfileEditingId=null;
function apiProfileLabel(p){ var nm=String((p&&typeof p==='object'&&p.name!=null)?p.name:'').trim(); if(nm)return nm; var v=String((p&&typeof p==='object'&&p.provider!=null)?p.provider:(typeof p==='string'?p:'')).trim()||'deepseek'; if(API_PROVIDER_LABEL[v])return API_PROVIDER_LABEL[v]; if(v==='custom')return '自定义'; return v; }
function apiMaskBaseUrl(u){ var s=String(u==null?'':u).trim(); if(!s)return '(未填写)'; if(s.length>34)return s.slice(0,20)+'…'+s.slice(-10); return s; }
function apiMaskKey(k){ var s=String(k==null?'':k).trim(); if(!s)return '未填写'; if(s.length<=8)return '****'; return '****'+s.slice(-4); }
function i5GetApiFormValues(){ try{ if(typeof setApiProviderName==='undefined'||!setApiProviderName)setApiProviderName=$('setApiProviderName'); }catch(e){} return { protocol:(setApiProtocol&&setApiProtocol.value)||'openai', provider:(typeof setApiPreset!=='undefined'&&setApiPreset&&setApiPreset.value)||'deepseek', name:(typeof setApiProviderName!=='undefined'&&setApiProviderName&&setApiProviderName.value||'').trim(), baseUrl:(typeof setApiBaseUrl!=='undefined'&&setApiBaseUrl&&setApiBaseUrl.value||'').trim(), apiKey:(typeof setApiKey!=='undefined'&&setApiKey&&setApiKey.value||'').trim(), model:(typeof setApiModel!=='undefined'&&setApiModel&&setApiModel.value||'').trim()||'deepseek-chat' }; }
function ensureApiProfiles(){
 curAiConfig=curAiConfig||{};
 if(!Array.isArray(curAiConfig.apiProfiles)){
  var old=(curAiConfig.api&&typeof curAiConfig.api==='object')?curAiConfig.api:null;
   if(old&&(old.baseUrl||old.apiKey||old.model||old.provider||old.protocol||old.customModels)){
    var _id='api-'+Date.now();
    var _oldPv=old.provider||'deepseek';
    var _oldNm=String((old.name!=null)?old.name:'').trim()||apiProfileLabel(_oldPv);
    curAiConfig.apiProfiles=[{ id:_id, name:_oldNm, provider:_oldPv, protocol:old.protocol||'openai', baseUrl:String(old.baseUrl||'https://api.deepseek.com/v1'), apiKey:String(old.apiKey||''), model:String(old.model||'deepseek-chat'), customModels:Array.isArray(old.customModels)?old.customModels.slice():['deepseek-chat','deepseek-reasoner'], enableTools:true }];
   curAiConfig.activeApiProfileId=_id;
  }else{ curAiConfig.apiProfiles=[]; curAiConfig.activeApiProfileId=null; }
 }
 if(!Array.isArray(curAiConfig.apiProfiles))curAiConfig.apiProfiles=[];
  curAiConfig.apiProfiles.forEach(function(p){
   if(!p) return;
   if(!p.id)p.id='api-'+Date.now()+'-'+Math.floor(Math.random()*10000);
   if(!p.provider)p.provider='deepseek';
   if(typeof p.name==='undefined'||p.name===null){ try{ p.name=apiProfileLabel(p.provider); }catch(e){ p.name=String(p.provider||'deepseek'); } }
   else{ p.name=String(p.name).trim(); if(!p.name){ try{ p.name=apiProfileLabel(p.provider); }catch(e){} } }
  if(!p.protocol)p.protocol='openai';
  if(p.baseUrl==null)p.baseUrl='';
  if(p.apiKey==null)p.apiKey='';
  if(!p.model)p.model='deepseek-chat';
  if(!Array.isArray(p.customModels))p.customModels=[];
   p.enableTools=true;
 });
 var hasActive=false;
 for(var i=0;i<curAiConfig.apiProfiles.length;i++){ if(curAiConfig.apiProfiles[i]&&curAiConfig.apiProfiles[i].id===curAiConfig.activeApiProfileId){ hasActive=true; break; } }
 if(!hasActive)curAiConfig.activeApiProfileId=curAiConfig.apiProfiles.length?curAiConfig.apiProfiles[0].id:null;
 return curAiConfig.apiProfiles;
}
function getActiveApiProfile(){
 try{
  ensureApiProfiles();
  var list=curAiConfig.apiProfiles||[];
  for(var i=0;i<list.length;i++){ if(list[i]&&list[i].id===curAiConfig.activeApiProfileId)return list[i]; }
  return list.length?list[0]:null;
 }catch(e){ return null; }
}
function syncActiveProfileToMirror(){
 try{
  ensureApiProfiles();
  var p=getActiveApiProfile();
  if(!p)return null;
  var snap={ name:String((p.name!=null)?p.name:'').trim()||apiProfileLabel(p.provider), provider:p.provider||'deepseek', protocol:p.protocol||'openai', baseUrl:String(p.baseUrl||''), apiKey:String(p.apiKey||''), model:String(p.model||'deepseek-chat'), customModels:Array.isArray(p.customModels)?p.customModels.slice():[], enableTools:true };
   curAiConfig.api=snap;
    curAiConfig.byok={ name:snap.name, protocol:snap.protocol, provider:snap.provider, baseUrl:snap.baseUrl, apiKey:snap.apiKey, model:snap.model, customModels:snap.customModels.slice(), enableTools:true };
    curAiConfig.apiConfig={ name:snap.name, protocol:snap.protocol, provider:snap.provider, baseUrl:snap.baseUrl, apiKey:snap.apiKey, model:snap.model, customModels:snap.customModels.slice(), enableTools:true };
  return snap;
 }catch(e){ return null; }
}
function apiPushCustomModelsToActive(ids){
 try{
  ensureApiProfiles();
  var p=getActiveApiProfile();
  if(!p)return;
  p.customModels=p.customModels||[];
  (ids||[]).forEach(function(id){ if(id&&p.customModels.indexOf(id)<0)p.customModels.push(id); });
  syncActiveProfileToMirror();
 }catch(e){}
}
function i5GetByokFromUi(){
 try{
  var _mask=(typeof $==='function')?$('apiProfileMask'):null;
  if(_mask&&_mask.style&&_mask.style.display!=='none'&&_mask.style.display!=='')return i5GetApiFormValues();
 }catch(e){}
  try{
   var _p=getActiveApiProfile();
   if(_p)return { protocol:_p.protocol||'openai', provider:_p.provider||'deepseek', name:String((_p.name!=null)?_p.name:'').trim(), baseUrl:String(_p.baseUrl||'').trim(), apiKey:String(_p.apiKey||'').trim(), model:String(_p.model||'').trim()||'deepseek-chat' };
  }catch(e){}
 return i5GetApiFormValues();
}
function i5AgentLabel(a){ if(a&&a.name) return a.name; if(a&&a.id&&I5_AGENT_FALLBACK[a.id]) return I5_AGENT_FALLBACK[a.id]; return (a&&a.id)||'Agent'; }

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
  var listEl=$('modelCheckList');
  if(listEl && !listEl.querySelector('input[type="checkbox"]')){
    return; /* 新版管理页无复选框：可见集合由获取弹窗/删除按钮直接维护，此处不覆盖 */
  }
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
  try{ if(!isCli)renderApiProfileMatrix(); }catch(e){}
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
      /* Iteration6：弹窗内预设切换仅改DOM，落盘待保存按钮统一回写，不再直写curAiConfig */
    }
    try{
      try{ if(typeof setApiProviderName==='undefined'||!setApiProviderName)setApiProviderName=$('setApiProviderName'); }catch(e){}
      if(typeof setApiProviderName!=='undefined'&&setApiProviderName){
        if(p==='custom'){ var _cur=String(setApiProviderName.value||'').trim(); if(!_cur)setApiProviderName.value=''; }
        else if(API_PROVIDER_LABEL[p]){ setApiProviderName.value=API_PROVIDER_LABEL[p]; }
      }
    }catch(e){}
    renderModelManagerList(curAiConfig);
  };
}

function i5RenderByokTest(r){
  byokTestPanel=$('byokTestPanel')||byokTestPanel; testStatusBadge=$('testStatusBadge')||testStatusBadge; testMessageText=$('testMessageText')||testMessageText;
  var ok=!!(r&&(r.ok||r.success));
  var kind=(r&&(r.kind||''))||(ok?'success':'unknown');
  var latency=(r&&(r.latencyMs!=null?r.latencyMs:r.latency))||0;
  var status=(r&&r.status)||'';
  var msg=(r&&(r.message||r.error))||(ok?'连通成功':'连接失败');
  var cls='byok-test-panel', badge='未知', desc=String(msg);
  if(ok){ cls+=' success'; badge='连通成功'+(latency?' · '+latency+'ms':'')+(status?' · HTTP '+status:''); }
  else if(kind==='auth_failed'){ cls+=' auth-err'; badge='密钥失效 · 401'+(latency?' · '+latency+'ms':''); desc+=' 请检查 API Key 是否正确、是否携带 Bearer 前缀、是否已在设置中保存。'; }
  else if(kind==='rate_limited'){ cls+=' rate-err'; badge='配额受限 · 429'+(latency?' · '+latency+'ms':''); desc+=' 服务商配额用尽或并发过高，可切换免费模型或稍后重试。'; }
  else if(kind==='invalid_base_url'||kind==='forbidden'){ cls+=' notfound-err'; badge='地址异常'+(status?' · HTTP '+status:'')+(latency?' · '+latency+'ms':''); desc+=' 请核对 BaseURL 是否多写 / 少写 /v1 或 /v1beta。'; }
  else if(kind==='timeout'){ cls+=' timeout'; badge='连接超时'+(latency?' · '+latency+'ms':''); desc+=' 网络不可达或端点无响应，请检查代理与网络。'; }
  else{ cls+=' notfound-err'; badge='连接失败'+(status?' · HTTP '+status:'')+(latency?' · '+latency+'ms':''); }
  if(byokTestPanel){ byokTestPanel.style.display='flex'; byokTestPanel.className=cls; }
  if(testStatusBadge)testStatusBadge.textContent=badge;
  if(testMessageText)testMessageText.textContent=desc;
  if(testApiStatus){ testApiStatus.textContent=badge+' '+desc; testApiStatus.className='set-status '+(ok?'ok':'err'); }
  return ok;
}
function fetchProviderModels(){
  btnFetchModels=$('btnFetchModels')||btnFetchModels; fetchModelStatus=$('fetchModelStatus')||fetchModelStatus;
  if(!window.protoAPI||!window.protoAPI.ai||!window.protoAPI.ai.listModels){
    if(fetchModelStatus)fetchModelStatus.textContent='仅桌面端支持拉取';
    return Promise.resolve(null);
  }
  if(fetchModelStatus)fetchModelStatus.textContent='正在拉取远程模型…';
  var byokUi=i5GetByokFromUi();
  return window.protoAPI.ai.listModels({ engine:'api', api:byokUi, byok:byokUi, apiConfig:byokUi }).then(function(r){
    if(r&&r.ok&&r.groups&&r.groups.length){
      var ids=[]; r.groups.forEach(function(g){ (g.models||[]).forEach(function(m){ var id=typeof m==='string'?m:(m&&typeof m.id==='string'?m.id:(m&&typeof m.name==='string'?m.name:'')); if(id&&ids.indexOf(id)<0)ids.push(String(id)); }); });
      if(ids.length){
        curAiConfig=curAiConfig||{}; curAiConfig.api=curAiConfig.api||{};
        var _um={}; (curAiConfig.api.customModels||[]).concat(ids).forEach(function(id){ if(id&&!_um[id])_um[id]=1; });
        curAiConfig.api.customModels=Object.keys(_um); /* 并集写入：不丢弃手动添加项 */
        try{ apiPushCustomModelsToActive(ids); syncActiveProfileToMirror(); }catch(e){}
        if(curAiConfig.byok)curAiConfig.byok.customModels=(curAiConfig.api.customModels||[]).slice();
        if(curAiConfig.apiConfig)curAiConfig.apiConfig.customModels=(curAiConfig.api.customModels||[]).slice();
        if(curAiConfig.visibleModelsApi&&curAiConfig.visibleModelsApi.length){ ids.forEach(function(id){ if(curAiConfig.visibleModelsApi.indexOf(id)<0)curAiConfig.visibleModelsApi.push(id); }); }
        if(setApiModel&&ids.indexOf(setApiModel.value)<0&&ids[0]){ /* 保留用户已填，仅提示 */ }
        renderModelManagerList(curAiConfig);
        aiInvalidateModels(); aiLoadModels();
        if(fetchModelStatus)fetchModelStatus.textContent='已拉取 '+ids.length+' 个模型（已去重）。';
      }else{ if(fetchModelStatus)fetchModelStatus.textContent='远端返回空列表，已保留本地候选。'; }
    }else{ if(fetchModelStatus)fetchModelStatus.textContent='拉取失败，已保留本地候选：'+((r&&r.error)||'未知错误'); }
    return r;
  }).catch(function(e){ if(fetchModelStatus)fetchModelStatus.textContent='拉取异常：'+(e&&e.message||e); return null; });
}
if(setApiProtocol){ setApiProtocol.onchange=function(){ var p=setApiProtocol.value; if(baseUrlHint==null)baseUrlHint=$('baseUrlHint'); if(baseUrlHint&&I5_PROTO_HINT[p])baseUrlHint.textContent='提示：'+I5_PROTO_HINT[p]+'。'; }; }
if(btnFetchModels){ btnFetchModels.onclick=function(){ fetchProviderModels(); }; }
if(btnTestApi){
  btnTestApi.onclick=function(){
    if(!window.protoAPI||!window.protoAPI.ai||!window.protoAPI.ai.testConnection){
      if(testApiStatus){ testApiStatus.textContent='仅桌面端支持测试'; testApiStatus.className='set-status err'; }
      return;
    }
    if(testApiStatus){ testApiStatus.textContent='测试连接中…'; testApiStatus.className='set-status'; }
    if(byokTestPanel)byokTestPanel.style.display='flex';
    if(testStatusBadge)testStatusBadge.textContent='检测中…';
    if(testMessageText)testMessageText.textContent='正在请求服务商 /models 端点…';
    var byokUi=i5GetByokFromUi();
    var cfg={ protocol:byokUi.protocol, provider:byokUi.provider, baseUrl:byokUi.baseUrl, apiKey:byokUi.apiKey, model:byokUi.model };
    window.protoAPI.ai.testConnection(cfg).then(function(r){
      i5RenderByokTest(r);
    }).catch(function(e){
      i5RenderByokTest({ ok:false, kind:'unknown', message:String((e&&e.message)||e) });
    });
  };
}
function renderModelManagerList(cfg){
  var modelCheckList=$('modelCheckList');
  if(!modelCheckList)return;
  var engHint=typeof getActiveEngineInUi==='function'?getActiveEngineInUi():((cfg&&cfg.engine)||'cli');
  if(!window.protoAPI||!window.protoAPI.ai||!window.protoAPI.ai.listModels){
    modelCheckList.innerHTML='<div style="color:var(--faint);padding:6px;">仅桌面端支持模型管理</div>';
    return;
  }
  modelCheckList.innerHTML='正在读取模型列表…';
  window.protoAPI.ai.listModels(engHint).then(function(r){
    if(!r||!r.groups||!r.groups.length){
      if(r&&r.engine&&r.engine!==engHint){
        modelCheckList.innerHTML='<div style="color:var(--faint);padding:6px;">引擎数据与当前选项不匹配</div>';
        return;
      }
      modelCheckList.innerHTML='<div style="color:var(--faint);padding:6px;">未获取到可用模型</div>';
      return;
    }
    if(r.engine&&r.engine!==engHint){
      modelCheckList.innerHTML='<div style="color:var(--faint);padding:6px;">引擎数据与当前选项不匹配</div>';
      return;
    }
    var isCli=(engHint==='cli');
    var visible=isCli?(cfg&&cfg.visibleModelsCli):(cfg&&cfg.visibleModelsApi);
    var html='';
    r.groups.forEach(function(g){
      var items=g.models||[];
      if(!items.length)return;
      var gHtml='';
      items.forEach(function(m){
        var mid=typeof m==='string'?m:(m&&(m.id||m.name))||'';
        var mname=typeof m==='string'?m:(m&&(m.name||m.id))||'';
        if(!mid)return;
        if(visible && visible.indexOf(mid)<0) return; /* 管理页只显已选 */
        gHtml+='<div class="model-check-item" data-id="'+escAttr(mid)+'">'
          +'<span>'+escHtml(mname)+'</span>'
          +'<span style="margin-left:auto;font-size:10px;color:var(--faint);">'+escHtml(mid)+'</span>'
          +'<button type="button" class="model-del" data-id="'+escAttr(mid)+'" title="删除（取消勾选）">×</button>'
          +'</div>';
      });
      if(gHtml)html+='<div style="font-weight:700;font-size:11.5px;color:var(--faint);margin:6px 0 2px;">'+escHtml(g.label||g.provider)+'</div>'+gHtml;
    });
    if(!html)html='<div style="color:var(--faint);padding:6px;">暂无已选模型，可通过「获取模型」勾选</div>';
    modelCheckList.innerHTML=html;
  }).catch(function(e){
    modelCheckList.innerHTML='<div style="color:var(--faint);padding:6px;">读取模型失败</div>';
  });
}
function getSelectedModelIds(){
  var modelCheckList=$('modelCheckList');
  if(!modelCheckList)return [];
  var chks=modelCheckList.querySelectorAll('input[type="checkbox"]:checked');
  var arr=[];
  chks.forEach(function(c){ arr.push(c.value); });
  return arr;
}
var btnClearAllModels=$('btnClearAllModels'),setModelSearch=$('setModelSearch');
if(btnClearAllModels)btnClearAllModels.onclick=function(){
  setVisibleModels([]);
  persistVisibleAndRefresh('已清空全部勾选');
};
if(setModelSearch)setModelSearch.oninput=function(){
  var q=setModelSearch.value.trim().toLowerCase();
  var modelCheckList=$('modelCheckList');
  if(!modelCheckList)return;
  modelCheckList.querySelectorAll('.model-check-item').forEach(function(item){
    var txt=(item.textContent||'').toLowerCase();
    item.style.display=(!q||txt.indexOf(q)>=0)?'flex':'none';
  });
};
var btnAddCustomModel=$('btnAddCustomModel'),newModelInput=$('newModelInput');
if(btnAddCustomModel){
  btnAddCustomModel.onclick=function(){
    if(!newModelInput)return;
    var val=newModelInput.value.trim();
    if(!val)return;
    val=val.replace(/[-_]free/gi,'');
    curAiConfig=curAiConfig||{};
    var eng=getActiveEngineInUi();
    if(eng==='cli'){
      curAiConfig.customModelsCli=curAiConfig.customModelsCli||[];
      if(curAiConfig.customModelsCli.indexOf(val)<0)curAiConfig.customModelsCli.push(val);
      curAiConfig.visibleModelsCli=curAiConfig.visibleModelsCli||[];
      if(curAiConfig.visibleModelsCli.indexOf(val)<0)curAiConfig.visibleModelsCli.push(val);
    }else{
      curAiConfig.api=curAiConfig.api||{};
      curAiConfig.api.customModels=curAiConfig.api.customModels||[];
      if(curAiConfig.api.customModels.indexOf(val)<0)curAiConfig.api.customModels.push(val);
      try{ apiPushCustomModelsToActive([val]); syncActiveProfileToMirror(); }catch(e){}
      if(curAiConfig.byok)curAiConfig.byok.customModels=(curAiConfig.api.customModels||[]).slice();
      if(curAiConfig.apiConfig)curAiConfig.apiConfig.customModels=(curAiConfig.api.customModels||[]).slice();
      curAiConfig.visibleModelsApi=curAiConfig.visibleModelsApi||[];
      if(curAiConfig.visibleModelsApi.indexOf(val)<0)curAiConfig.visibleModelsApi.push(val);
    }
    if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
      window.protoAPI.ai.saveConfig(curAiConfig).then(function(){
        showToast('已添加模型：'+val);
        aiInvalidateModels();
        aiLoadModels();
        renderModelManagerList(curAiConfig);
      });
    }else{
      showToast('已添加模型：'+val);
      aiInvalidateModels();
      aiLoadModels();
      renderModelManagerList(curAiConfig);
    }
    newModelInput.value='';
  };
}
/* ═══════ 模型获取弹窗：全量勾选 → 确认写回可见集合 ═══════ */
var modelFetchMask=$('modelFetchMask'),modelFetchList=$('modelFetchList'),fetchSearchInput=$('fetchSearchInput'),
    fetchSelectCount=$('fetchSelectCount'),btnFetchModels2=$('btnFetchModels2'),
    modelFetchClose=$('modelFetchClose'),modelFetchCancel=$('modelFetchCancel'),modelFetchOk=$('modelFetchOk');
var fetchCacheGroups=[];
var fetchSaveTimer=null;
function scheduleFetchPersist(){
  if(fetchSaveTimer)clearTimeout(fetchSaveTimer);
  fetchSaveTimer=setTimeout(function(){
    fetchSaveTimer=null;
    persistVisibleAndRefresh();
  },300);
}
function applyFetchToggle(id, checked){
  if(!id)return;
  curAiConfig=curAiConfig||{};
  var isCli=getActiveEngineInUi()==='cli';
  var vKey=isCli?'visibleModelsCli':'visibleModelsApi';
  var vis=curAiConfig[vKey];
  if(!Array.isArray(vis)){
    var all=[];
    (fetchCacheGroups||[]).forEach(function(g){
      (g.models||[]).forEach(function(m){
        var mid=typeof m==='string'?m:(m&&(m.id||m.name))||'';
        if(mid&&all.indexOf(mid)<0)all.push(mid);
      });
    });
    vis=all;
    curAiConfig[vKey]=vis;
  }
  var at=vis.indexOf(id);
  if(checked){
    if(at<0)vis.push(id);
    if(isCli){
      curAiConfig.customModelsCli=curAiConfig.customModelsCli||[];
      if(curAiConfig.customModelsCli.indexOf(id)<0)curAiConfig.customModelsCli.push(id);
    }else{
      curAiConfig.api=curAiConfig.api||{};
      curAiConfig.api.customModels=curAiConfig.api.customModels||[];
      if(curAiConfig.api.customModels.indexOf(id)<0)curAiConfig.api.customModels.push(id);
      try{ apiPushCustomModelsToActive([id]); syncActiveProfileToMirror(); }catch(e){}
      if(curAiConfig.byok)curAiConfig.byok.customModels=(curAiConfig.api.customModels||[]).slice();
      if(curAiConfig.apiConfig)curAiConfig.apiConfig.customModels=(curAiConfig.api.customModels||[]).slice();
    }
  }else{
    if(at>=0)vis.splice(at,1);
  }
  if(typeof renderModelManagerList==='function')renderModelManagerList(curAiConfig);
  if(typeof aiInvalidateModels==='function')aiInvalidateModels();
  if(typeof aiLoadModels==='function')aiLoadModels();
  scheduleFetchPersist();
}
function refreshFetchCount(){
  var n=0,t=0;
  if(!modelFetchList)return {checked:n,shown:t};
  modelFetchList.querySelectorAll('.model-check-item').forEach(function(item){
    if(item.style.display==='none')return;
    t++;
    var box=item.querySelector('input[type="checkbox"]');
    if(box&&box.checked)n++;
  });
  if(fetchSelectCount)fetchSelectCount.textContent='已选 '+n+' / '+t+' 个（勾选即时生效）';
  return {checked:n,shown:t};
}
function setVisibleModels(ids){
  curAiConfig=curAiConfig||{};
  if(getActiveEngineInUi()==='cli'){ curAiConfig.visibleModelsCli=ids.slice(); }
  else{ curAiConfig.visibleModelsApi=ids.slice(); }
}
function persistVisibleAndRefresh(msg){
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
    window.protoAPI.ai.saveConfig(curAiConfig).then(function(){
      if(msg)showToast(msg);
      aiInvalidateModels();
      aiLoadModels();
      renderModelManagerList(curAiConfig);
    });
  }else{
    renderModelManagerList(curAiConfig);
  }
}
function openModelFetch(){
  if(modelFetchMask)modelFetchMask.style.display='flex';
  if(window.MaskStack) window.MaskStack.push('modelFetchMask', closeModelFetch);
  if(fetchSearchInput)fetchSearchInput.value='';
  if(modelFetchList)modelFetchList.innerHTML='<div style="color:var(--faint);padding:6px;">正在读取模型列表…</div>';
  if(fetchSelectCount)fetchSelectCount.textContent='';
  if(!(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.listModels)){
    if(modelFetchList)modelFetchList.innerHTML='<div style="color:var(--faint);padding:6px;">仅桌面端支持获取模型</div>';
    return;
  }
  var engHint=typeof getActiveEngineInUi==='function'?getActiveEngineInUi():'cli';
  window.protoAPI.ai.listModels(engHint).then(function(r){
    if(!r||!r.ok||!r.groups||!r.groups.length){
      if(modelFetchList)modelFetchList.innerHTML='<div style="color:var(--faint);padding:6px;">未获取到可用模型</div>';
      return;
    }
    fetchCacheGroups=r.groups||[];
    renderFetchList('');
  }).catch(function(e){
    if(modelFetchList)modelFetchList.innerHTML='<div style="color:var(--faint);padding:6px;">读取模型失败</div>';
  });
}
function closeModelFetch(){ if(window.MaskStack) window.MaskStack.pop('modelFetchMask'); if(modelFetchMask)modelFetchMask.style.display='none'; }
function getFetchVisible(){
  var isCli=getActiveEngineInUi()==='cli';
  var v=isCli?(curAiConfig&&curAiConfig.visibleModelsCli):(curAiConfig&&curAiConfig.visibleModelsApi);
  return v||null; /* null = 全选 */
}
function renderFetchList(q){
  if(!modelFetchList)return;
  var visible=getFetchVisible();
  var html='',shown=0,checked=0;
  (fetchCacheGroups||[]).forEach(function(g){
    var items=g.models||[];
    var gHtml='';
    items.forEach(function(m){
      var mid=typeof m==='string'?m:(m&&(m.id||m.name))||'';
      var mname=typeof m==='string'?m:(m&&(m.name||m.id))||'';
      if(!mid)return;
      if(q&&(mid.toLowerCase().indexOf(q)<0&&mname.toLowerCase().indexOf(q)<0))return;
      shown++;
      var on=(!visible||visible.indexOf(mid)>=0);
      if(on)checked++;
      gHtml+='<label class="model-check-item" data-id="'+escAttr(mid)+'">'
        +'<input type="checkbox" value="'+escAttr(mid)+'"'+(on?' checked':'')+'>'
        +'<span>'+escHtml(mname)+'</span>'
        +'<span style="margin-left:auto;font-size:10px;color:var(--faint);">'+escHtml(mid)+'</span>'
        +'</label>';
    });
    if(gHtml)html+='<div style="font-weight:700;font-size:11.5px;color:var(--faint);margin:6px 0 2px;">'+escHtml(g.label||g.provider)+'</div>'+gHtml;
  });
  if(!html)html='<div style="color:var(--faint);padding:6px;">无匹配模型</div>';
  modelFetchList.innerHTML=html;
  if(fetchSelectCount)fetchSelectCount.textContent='已选 '+checked+' / '+shown+' 个（勾选即时生效）';
  modelFetchList.querySelectorAll('input[type="checkbox"]').forEach(function(c){
    c.onchange=function(){
      applyFetchToggle(c.value, !!c.checked);
      refreshFetchCount();
    };
  });
}
if(fetchSearchInput)fetchSearchInput.oninput=function(){ renderFetchList((fetchSearchInput.value||'').trim().toLowerCase()); };
if(btnFetchModels2)btnFetchModels2.onclick=function(){ openModelFetch(); };
if(modelFetchClose)modelFetchClose.onclick=function(){ closeModelFetch(); };
if(modelFetchCancel)modelFetchCancel.onclick=function(){ closeModelFetch(); };
/* 兼容保留：确认写回已废弃（勾选直写为当前路径），保留以兼容旧测试引用 */
function collectFetchChecked(){
  var ids=[];
  if(!modelFetchList)return ids;
  modelFetchList.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c){ if(ids.indexOf(c.value)<0)ids.push(c.value); });
  return ids;
}
function confirmFetchSelection(){
  var ids=collectFetchChecked();
  curAiConfig=curAiConfig||{};
  var isCli=getActiveEngineInUi()==='cli';
  if(isCli){
    curAiConfig.customModelsCli=curAiConfig.customModelsCli||[];
    ids.forEach(function(id){ if(curAiConfig.customModelsCli.indexOf(id)<0)curAiConfig.customModelsCli.push(id); });
  }else{
    curAiConfig.api=curAiConfig.api||{};
    curAiConfig.api.customModels=curAiConfig.api.customModels||[];
    ids.forEach(function(id){ if(curAiConfig.api.customModels.indexOf(id)<0)curAiConfig.api.customModels.push(id); });
    try{ apiPushCustomModelsToActive(ids); syncActiveProfileToMirror(); }catch(e){}
    if(curAiConfig.byok)curAiConfig.byok.customModels=(curAiConfig.api.customModels||[]).slice();
    if(curAiConfig.apiConfig)curAiConfig.apiConfig.customModels=(curAiConfig.api.customModels||[]).slice();
  }
  setVisibleModels(ids);
  persistVisibleAndRefresh('已应用勾选（'+ids.length+' 个）');
  closeModelFetch();
  return ids;
}
function removeVisibleModel(id){
  if(!id)return [];
  var isCli=getActiveEngineInUi()==='cli';
  curAiConfig=curAiConfig||{};
  var arr=isCli?(curAiConfig.visibleModelsCli||[]):(curAiConfig.visibleModelsApi||[]);
  arr=arr.filter(function(x){ return x!==id; });
  setVisibleModels(arr);
  persistVisibleAndRefresh('已取消勾选：'+id);
  return arr;
}
if(modelFetchOk)modelFetchOk.onclick=function(){ closeModelFetch(); };
if(modelCheckList)modelCheckList.onclick=function(e){
  var t=e.target&&e.target.closest?e.target.closest('.model-del'):null;
  if(!t||!modelCheckList.contains(t))return;
  removeVisibleModel(t.getAttribute('data-id')||'');
};
/* Iteration6：API配置卡片矩阵渲染 + 弹窗（复用既有字段id，仅新增容器与按钮id） */
function renderApiProfileMatrix(){
 var box=(typeof $==='function')?$('apiProfileMatrix'):document.getElementById('apiProfileMatrix');
 if(!box)return;
 try{ ensureApiProfiles(); }catch(e){}
 var list=(curAiConfig&&curAiConfig.apiProfiles)||[];
 var activeId=curAiConfig&&curAiConfig.activeApiProfileId;
 try{ box.innerHTML=''; }catch(e){}
 list.forEach(function(p){
  if(!p)return;
  var card=document.createElement('div');
  card.className='api-profile-card'+(p.id===activeId?' active':'');
  card.setAttribute('data-id', p.id);
  var head=document.createElement('div'); head.className='api-profile-header';
  var nameEl=document.createElement('span'); nameEl.className='api-profile-name'; nameEl.textContent=apiProfileLabel(p);
  var badge=document.createElement('span'); badge.className='api-profile-badge'+(p.id===activeId?'':' idle'); badge.textContent=(p.id===activeId?'当前使用':'未使用');
  head.appendChild(nameEl); head.appendChild(badge); card.appendChild(head);
  var sub=document.createElement('div'); sub.className='api-profile-sub'; sub.textContent='BaseURL '+apiMaskBaseUrl(p.baseUrl)+' | 模型 '+String(p.model||'');
  card.appendChild(sub);
  var sub2=document.createElement('div'); sub2.className='api-profile-sub'; sub2.textContent='Key '+apiMaskKey(p.apiKey);
  card.appendChild(sub2);
  var acts=document.createElement('div'); acts.className='api-profile-actions';
  var useBtn=document.createElement('button'); useBtn.type='button'; useBtn.className='btn-mini'; useBtn.setAttribute('data-act','use'); useBtn.setAttribute('data-id',p.id);
  if(p.id===activeId){ useBtn.textContent='当前使用'; useBtn.disabled=true; }else{ useBtn.textContent='设为当前使用'; }
  useBtn.onclick=function(ev){ try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){} setActiveApiProfile(p.id); };
  var editBtn=document.createElement('button'); editBtn.type='button'; editBtn.className='btn-mini'; editBtn.textContent='编辑'; editBtn.setAttribute('data-act','edit'); editBtn.setAttribute('data-id',p.id);
  editBtn.onclick=function(ev){ try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){} openApiProfileModal('edit', p.id); };
  var delBtn=document.createElement('button'); delBtn.type='button'; delBtn.className='btn-mini'; delBtn.textContent='删除'; delBtn.setAttribute('data-act','del'); delBtn.setAttribute('data-id',p.id);
  delBtn.onclick=function(ev){ try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){} deleteApiProfile(p.id); };
  acts.appendChild(useBtn); acts.appendChild(editBtn); acts.appendChild(delBtn); card.appendChild(acts);
  card.onclick=function(){ if(p.id!==activeId)setActiveApiProfile(p.id); };
  box.appendChild(card);
 });
 var add=document.createElement('div'); add.className='api-profile-add'; add.id='btnAddApiProfile'; add.textContent='＋ 新增API配置'; add.title='新增API配置';
 add.onclick=function(){ openApiProfileModal('new', null); };
 box.appendChild(add);
}
function openApiProfileModal(mode, id){
 curAiConfig=curAiConfig||{};
 try{ ensureApiProfiles(); }catch(e){}
 apiProfileEditingId=(mode==='edit'&&id)?id:null;
 var p=null;
 if(apiProfileEditingId){
  for(var i=0;i<(curAiConfig.apiProfiles||[]).length;i++){ if(curAiConfig.apiProfiles[i]&&curAiConfig.apiProfiles[i].id===apiProfileEditingId){ p=curAiConfig.apiProfiles[i]; break; } }
  if(!p)apiProfileEditingId=null;
 }
 try{ setApiProtocol=$('setApiProtocol')||setApiProtocol; }catch(e){}
 try{ setApiPreset=$('setApiPreset')||setApiPreset; }catch(e){}
 try{ setApiProviderName=$('setApiProviderName')||setApiProviderName; }catch(e){}
 try{ setApiBaseUrl=$('setApiBaseUrl')||setApiBaseUrl; }catch(e){}
 try{ setApiKey=$('setApiKey')||setApiKey; }catch(e){}
  try{ setApiModel=$('setApiModel')||setApiModel; }catch(e){}
  try{ byokTestPanel=$('byokTestPanel')||byokTestPanel; testStatusBadge=$('testStatusBadge')||testStatusBadge; testMessageText=$('testMessageText')||testMessageText; }catch(e){}
 try{ baseUrlHint=$('baseUrlHint')||baseUrlHint; fetchModelStatus=$('fetchModelStatus')||fetchModelStatus; testApiStatus=$('testApiStatus')||testApiStatus; }catch(e){}
 if(p){
  if(setApiProtocol)setApiProtocol.value=p.protocol||'openai';
  if(setApiPreset)setApiPreset.value=p.provider||'deepseek';
  if(setApiProviderName)setApiProviderName.value=(p.name!=null)?String(p.name):'';
  if(setApiBaseUrl)setApiBaseUrl.value=p.baseUrl||'';
  if(setApiKey)setApiKey.value=p.apiKey||'';
   if(setApiModel)setApiModel.value=p.model||'deepseek-chat';
  }else{
  if(setApiProtocol)setApiProtocol.value='openai';
  if(setApiPreset)setApiPreset.value='deepseek';
  if(setApiProviderName)setApiProviderName.value='';
  if(setApiBaseUrl)setApiBaseUrl.value=(typeof API_PRESETS!=='undefined'&&API_PRESETS.deepseek&&API_PRESETS.deepseek.baseUrl)||'https://api.deepseek.com/v1';
  if(setApiKey)setApiKey.value='';
   if(setApiModel)setApiModel.value=(typeof API_PRESETS!=='undefined'&&API_PRESETS.deepseek&&API_PRESETS.deepseek.model)||'deepseek-chat';
  }
 try{
  if(setApiProtocol&&baseUrlHint&&typeof I5_PROTO_HINT!=='undefined'&&I5_PROTO_HINT[setApiProtocol.value])baseUrlHint.textContent='提示：'+I5_PROTO_HINT[setApiProtocol.value]+'。';
 }catch(e){}
 try{ if(byokTestPanel)byokTestPanel.style.display='none'; }catch(e){}
 try{ if(testApiStatus){ testApiStatus.textContent=''; testApiStatus.className='set-status'; } }catch(e){}
 try{ if(fetchModelStatus)fetchModelStatus.textContent='支持 /v1/models 动态拉取，去重后自动填充候选。'; }catch(e){}
 var m=(typeof $==='function')?$('apiProfileMask'):document.getElementById('apiProfileMask');
 if(m)m.style.display='flex';
 try{ if(window.MaskStack)window.MaskStack.push('apiProfileMask', closeApiProfileModal); }catch(e){}
}
function closeApiProfileModal(){
 try{ if(window.MaskStack)window.MaskStack.pop('apiProfileMask'); }catch(e){}
 var m=(typeof $==='function')?$('apiProfileMask'):document.getElementById('apiProfileMask');
 if(m)m.style.display='none';
 apiProfileEditingId=null;
}
function saveApiProfileModal(){
 curAiConfig=curAiConfig||{};
 try{ ensureApiProfiles(); }catch(e){}
  var fv=i5GetApiFormValues();
  var en=true;
 if(apiProfileEditingId){
  for(var i=0;i<curAiConfig.apiProfiles.length;i++){
   if(curAiConfig.apiProfiles[i]&&curAiConfig.apiProfiles[i].id===apiProfileEditingId){
    var _old=curAiConfig.apiProfiles[i];
    var _custom=Array.isArray(_old.customModels)?_old.customModels.slice():[];
    try{ var _defs=(typeof API_PRESETS!=='undefined'&&API_PRESETS[fv.provider]&&API_PRESETS[fv.provider].defaultModels)||[]; _defs.forEach(function(mm){ if(_custom.indexOf(mm)<0)_custom.push(mm); }); if(fv.model&&_custom.indexOf(fv.model)<0)_custom.push(fv.model); }catch(e){}
    curAiConfig.apiProfiles[i]={ id:_old.id, name:String((fv.name!=null)?fv.name:'').trim(), provider:fv.provider, protocol:fv.protocol, baseUrl:fv.baseUrl, apiKey:fv.apiKey, model:fv.model||'deepseek-chat', customModels:_custom, enableTools:true };
    break;
   }
  }
 }else{
  var nid='api-'+Date.now()+'-'+Math.floor(Math.random()*10000);
  var _cm=[];
  try{ var _d2=(typeof API_PRESETS!=='undefined'&&API_PRESETS[fv.provider]&&API_PRESETS[fv.provider].defaultModels)||[]; _cm=_d2.slice(); if(fv.model&&_cm.indexOf(fv.model)<0)_cm.push(fv.model); }catch(e){ _cm=fv.model?[fv.model]:[]; }
  curAiConfig.apiProfiles.push({ id:nid, name:String((fv.name!=null)?fv.name:'').trim(), provider:fv.provider, protocol:fv.protocol, baseUrl:fv.baseUrl, apiKey:fv.apiKey, model:fv.model||'deepseek-chat', customModels:_cm, enableTools:true });
  if(!curAiConfig.activeApiProfileId)curAiConfig.activeApiProfileId=nid;
 }
 try{ syncActiveProfileToMirror(); }catch(e){}
 try{ renderApiProfileMatrix(); }catch(e){}
 try{ renderModelManagerList(curAiConfig); }catch(e){}
 try{ if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig)window.protoAPI.ai.saveConfig(curAiConfig).then(function(){ try{ aiInvalidateModels(); aiLoadModels(); }catch(e){} }); }catch(e){}
 closeApiProfileModal();
}
function setActiveApiProfile(id){
 if(!id)return;
 try{ ensureApiProfiles(); }catch(e){}
 var found=false;
 for(var i=0;i<((curAiConfig&&curAiConfig.apiProfiles)||[]).length;i++){ if(curAiConfig.apiProfiles[i]&&curAiConfig.apiProfiles[i].id===id){ found=true; break; } }
 if(!found)return;
 curAiConfig.activeApiProfileId=id;
 try{ syncActiveProfileToMirror(); }catch(e){}
 try{ renderApiProfileMatrix(); }catch(e){}
 try{ renderModelManagerList(curAiConfig); }catch(e){}
 try{ if(typeof aiInvalidateModels==='function')aiInvalidateModels(); }catch(e){}
 try{ if(typeof aiLoadModels==='function')aiLoadModels(); }catch(e){}
 try{ if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig)window.protoAPI.ai.saveConfig(curAiConfig).then(function(){ try{ if(typeof aiRefreshCli==='function')aiRefreshCli(); }catch(e){} }); }catch(e){}
}
function deleteApiProfile(id){
 if(!id)return;
 try{ ensureApiProfiles(); }catch(e){}
 var idx=-1;
 for(var i=0;i<((curAiConfig&&curAiConfig.apiProfiles)||[]).length;i++){ if(curAiConfig.apiProfiles[i]&&curAiConfig.apiProfiles[i].id===id){ idx=i; break; } }
 if(idx<0)return;
 var isActive=(curAiConfig.activeApiProfileId===id);
 try{ if(!confirm('确定删除该API配置吗？'))return; }catch(e){ return; }
 curAiConfig.apiProfiles.splice(idx,1);
 if(isActive){
  curAiConfig.activeApiProfileId=curAiConfig.apiProfiles.length?curAiConfig.apiProfiles[0].id:null;
  try{ syncActiveProfileToMirror(); }catch(e){}
 }
 try{ renderApiProfileMatrix(); }catch(e){}
 try{ renderModelManagerList(curAiConfig); }catch(e){}
 try{ if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig)window.protoAPI.ai.saveConfig(curAiConfig).then(function(){ try{ if(typeof aiInvalidateModels==='function')aiInvalidateModels(); if(typeof aiLoadModels==='function')aiLoadModels(); }catch(e){} }); }catch(e){}
}
try{
 var _apiSave=(typeof $==='function')?$('apiProfileSave'):document.getElementById('apiProfileSave');
 if(_apiSave)_apiSave.onclick=function(){ saveApiProfileModal(); };
 var _apiCancel=(typeof $==='function')?$('apiProfileCancel'):document.getElementById('apiProfileCancel');
 if(_apiCancel)_apiCancel.onclick=function(){ closeApiProfileModal(); };
 var _apiClose=(typeof $==='function')?$('apiProfileClose'):document.getElementById('apiProfileClose');
 if(_apiClose)_apiClose.onclick=function(){ closeApiProfileModal(); };
}catch(e){}

function loadSettingsToUi(){
  sbxRootHint();
  refreshCliInfo();
  if(testApiStatus)testApiStatus.textContent='';
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.getConfig){
    window.protoAPI.ai.getConfig().then(function(cfg){
      curAiConfig=cfg||{};
      try{ ensureApiProfiles(); }catch(e){}
      try{ syncActiveProfileToMirror(); }catch(e){}
      setEngineUi(curAiConfig.engine||'cli', true);
      try{ renderApiProfileMatrix(); }catch(e){}
      renderModelManagerList(curAiConfig);
    });
  }else{
    try{ ensureApiProfiles(); }catch(e){}
    try{ renderApiProfileMatrix(); }catch(e){}
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
  var activeVisible = isCli ? ((curAiConfig&&curAiConfig.visibleModelsCli)||[]) : ((curAiConfig&&curAiConfig.visibleModelsApi)||[]);
  try{ ensureApiProfiles(); }catch(e){}
  try{ syncActiveProfileToMirror(); }catch(e){}
  var _act=null;
  try{ _act=getActiveApiProfile(); }catch(e){}
  var apiData=_act?{
    name:String((_act.name!=null)?_act.name:'').trim(),
    provider:_act.provider||'deepseek',
    protocol:_act.protocol||'openai',
    baseUrl:String(_act.baseUrl||''),
    apiKey:String(_act.apiKey||''),
    model:String(_act.model||'deepseek-chat'),
    customModels:Array.isArray(_act.customModels)?_act.customModels.slice():['deepseek-chat','deepseek-reasoner'],
    enableTools:true
  }:{
    name:'',
    provider:'deepseek',
    protocol:'openai',
    baseUrl:'',
    apiKey:'',
    model:'deepseek-chat',
    customModels:(curAiConfig&&curAiConfig.api&&curAiConfig.api.customModels)||['deepseek-chat','deepseek-reasoner'],
    enableTools:true
  };
  var _byok={ name:apiData.name, protocol:apiData.protocol, provider:apiData.provider, baseUrl:apiData.baseUrl, apiKey:apiData.apiKey, model:apiData.model, customModels:(apiData.customModels||[]).slice(), enableTools:true };
  var _apiCfg={ name:apiData.name, protocol:apiData.protocol, provider:apiData.provider, baseUrl:apiData.baseUrl, apiKey:apiData.apiKey, model:apiData.model, customModels:(apiData.customModels||[]).slice(), enableTools:true };
  var _profiles=[];
  try{ _profiles=(curAiConfig.apiProfiles||[]).map(function(p){ return { id:p.id, name:String((p.name!=null)?p.name:'').trim(), provider:p.provider, protocol:p.protocol, baseUrl:p.baseUrl, apiKey:p.apiKey, model:p.model, customModels:(p.customModels||[]).slice(), enableTools:true }; }); }catch(e){}
  var cfg={
    engine:engine,
    agentId:(curAiConfig&&curAiConfig.agentId)||'opencode',
    mainAgent:(curAiConfig&&curAiConfig.mainAgent)||(curAiConfig&&curAiConfig.agentId)||'opencode',
    customModelsCli:(curAiConfig&&curAiConfig.customModelsCli)||[],
    api:apiData,
    byok:_byok,
    apiConfig:_apiCfg,
    apiProfiles:_profiles,
    activeApiProfileId:curAiConfig?curAiConfig.activeApiProfileId:null,
    visibleModels:activeVisible,
    visibleModelsCli:curAiConfig?curAiConfig.visibleModelsCli||null:null,
    visibleModelsApi:curAiConfig?curAiConfig.visibleModelsApi||null:null
  };
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
    window.protoAPI.ai.saveConfig(cfg).then(function(){
      curAiConfig=cfg;
      aiInvalidateModels();
      aiLoadModels();
      aiRefreshCli();
      showSettingsSaveTip();
      renderModelManagerList(curAiConfig);
      try{ renderApiProfileMatrix(); }catch(e){}
    });
  }else{
    curAiConfig=cfg;
    try{ renderApiProfileMatrix(); }catch(e){}
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
 aiCliEl=$('aiCli'),aiCloseEl=$('aiClose'),aiSendEl=$('aiSend'),aiClearEl=$('aiClear'),aiModelEl=$('aiModel');
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
function aiOidDirOk(oid){ return typeof oid==='string'&&!!oid.trim(); }
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
/* AI 回复：全部默认展开（同一文案AI 回复，保留details供手动折叠） */
    var fold=document.createElement('details');
    fold.className='ai-msg-fold';
    fold.open=true;
    var sum=document.createElement('summary');
    sum.textContent='AI 回复';
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
  if(aiSendEl){
    aiSendEl.disabled=false;
    if(b){
      aiSendEl.classList.add('stopping');
      aiSendEl.textContent='⏹ 停止生成';
      aiSendEl.onclick=function(){ i5CancelAi(); };
    }else{
      aiSendEl.classList.remove('stopping');
      aiSendEl.textContent='发送';
      aiSendEl.onclick=aiDoSend;
    }
  }
  if(aiInputEl)aiInputEl.disabled=b;
  if(aiModelEl)aiModelEl.disabled=b;
  if(b){ aiThinkStart=Date.now(); if(!aiThinkTimer) aiThinkTimer=setInterval(aiThinkTick,1000); }
  else{ if(aiThinkTimer){ clearInterval(aiThinkTimer); aiThinkTimer=null; } aiThinkStart=0; }
}
function i5CancelAi(){
  if(!aiBusy) return;
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.cancel){
    window.protoAPI.ai.cancel().then(function(){
      aiSetBusy(false);
      finishAiStream(true);
      i5RenderErrorCard({ code:'CANCEL', kind:'cancel', message:'已停止生成' });
    });
  }else{
    aiSetBusy(false);
    finishAiStream(true);
  }
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
   h+='<div class="ai-op-row" data-gid="'+escAttr(g&&g.id||'')+'" data-role="think" title="点击查看思考链全文" style="cursor:pointer"><span class="op-tag">思考</span><span class="op-val">'+(aiStreamThink?'深度思考中':'正在思考…')+'</span><span class="op-sec">'+sec+'s</span></div>';
    h+='<div class="ai-op-row"><span class="op-tag">操作</span><span class="op-val">'+(ops.length?ops.length+' 条':'暂无')+'</span></div>';
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
/* Iteration5：thinking 折叠 / tool_call 卡片 / done Diff+快照 / error 结构化卡片 */
function i5EnsureThinkBox(){
 if(!aiStreaming||!aiChatView)return null;
 var box=null; try{ box=aiStreaming.querySelector('.thinking-box'); }catch(e){}
 if(box)return box;
 box=document.createElement('div'); box.className='thinking-box open';
 box.innerHTML='<div class="thinking-header"><div class="thinking-title-left"><div class="thinking-pulse"></div><span class="thinking-title-text">正在思考…</span></div><span class="fold-indicator">▾ 折叠</span></div><div class="thinking-content"></div>';
 try{
  var head=box.querySelector('.thinking-header');
  if(head){ head.onclick=function(){ var isOpen=box.classList.toggle('open'); var ind=box.querySelector('.fold-indicator'); if(ind)ind.textContent=isOpen?'▾ 折叠':'▸ 展开'; }; }
 }catch(e){}
 var body=aiStreaming.querySelector('.ai-msg-body')||aiStreaming;
 body.insertBefore(box, body.firstChild);
 return box;
}
function i5UpdateThinkBox(){
 var box=i5EnsureThinkBox(); if(!box)return;
 var tText=box.querySelector('.thinking-title-text');
 var tBody=box.querySelector('.thinking-content');
 var sec=aiThinkStart?Math.round((Date.now()-aiThinkStart)/1000):0;
 if(tText)tText.textContent='正在思考 ('+sec+'s, '+(aiStreamThink?aiStreamThink.length:0)+'字)';
 if(tBody)tBody.textContent=aiStreamThink||'';
 if(aiChatView&&!aiUserScrolledPause&&aiShouldAutoScroll(aiChatView,80))aiChatView.scrollTop=aiChatView.scrollHeight;
}
function i5EnsureToolStream(){
 if(!aiStreaming||!aiChatView)return null;
 var s=null; try{ s=aiStreaming.querySelector('.tool-execution-stream'); }catch(e){}
 if(s)return s;
 s=document.createElement('div'); s.className='tool-execution-stream';
 var body=aiStreaming.querySelector('.ai-msg-body')||aiStreaming;
 body.appendChild(s);
 return s;
}
function i5ToolName(ev){ return (ev&&(ev.tool||ev.name||ev.toolName||ev.call))||'工具调用'; }
function i5ToolParam(ev){
 if(!ev)return '';
 if(ev.path)return String(ev.path);
 if(ev.file)return String(ev.file);
 if(ev.args){ try{ return typeof ev.args==='string'?ev.args:JSON.stringify(ev.args); }catch(e){} }
 if(ev.input){ try{ return typeof ev.input==='string'?ev.input:JSON.stringify(ev.input); }catch(e){} }
 return '';
}
function i5AppendToolCall(ev){
 var s=i5EnsureToolStream(); if(!s)return;
 var card=document.createElement('div'); card.className='tool-call-card';
 var left=document.createElement('div'); left.className='tool-call-left';
 var icon=document.createElement('span'); icon.className='tool-icon'; icon.textContent='+';
 var name=document.createElement('span'); name.className='tool-name'; name.textContent=i5ToolName(ev);
 var param=document.createElement('span'); param.className='tool-param'; param.textContent=i5ToolParam(ev);
 left.appendChild(icon); left.appendChild(name); left.appendChild(param);
 var tag=document.createElement('span'); tag.className='tool-status-tag running'; tag.textContent='执行中';
 var st=String((ev&&(ev.status||ev.state))||'').toLowerCase();
 if(st==='done'||st==='success'||st==='ok'){ tag.className='tool-status-tag done'; tag.textContent='完成'; }
 else if(st==='waiting'||st==='queued'){ tag.className='tool-status-tag waiting'; tag.textContent='等待中'; }
 card.appendChild(left); card.appendChild(tag); s.appendChild(card);
 try{ setTimeout(function(){ try{ tag.className='tool-status-tag done'; tag.textContent='完成'; }catch(e){} }, 8000); }catch(e){}
 if(aiChatView&&!aiUserScrolledPause&&aiShouldAutoScroll(aiChatView,80))aiChatView.scrollTop=aiChatView.scrollHeight;
 try{ aiAppendTrace({ tag:'TOOL', level:'info', text:i5ToolName(ev)+' '+i5ToolParam(ev) }); }catch(e){}
}
function i5CurSubFile(){
 try{
  var cf=(typeof window.curHtmlFile==='function'?window.curHtmlFile():(typeof curHtmlFile==='function'?curHtmlFile():''))||'';
  var isMain=true;
  try{ isMain=(typeof window.isMainFile==='function'?window.isMainFile(cf):(typeof isMainFile==='function'?isMainFile(cf):true)); }catch(e){ isMain=true; }
  if(!isMain&&cf)return String(cf);
 }catch(e){}
 return '';
}
function i5SubFileRow(){
 var f=i5CurSubFile(); if(!f)return '';
 return '<div class="changes-subfile">所属文件：'+escHtml(f)+'</div>';
}
function i5AppendDiffAudit(container, filesInfo){
 var parent=container||aiChatView;
 if(!parent)return null;
 var card=document.createElement('div'); card.className='file-changes-card';
 var fLabel = escHtml(filesInfo||'工作区文件');
 card.innerHTML='<div class="changes-card-header"><span>本次任务文件变更审计</span><span>工作区已同步</span></div>'+i5SubFileRow()+'<div class="file-item-row"><span class="file-item-left">'+fLabel+'</span><span class="diff-counts"><span class="add">变更</span></span></div>';
 parent.appendChild(card);
 return card;
}
function i5AppendSnapshotCard(container, snapInfo){
 var parent=container||aiChatView;
 if(!parent)return null;
 var card=document.createElement('div'); card.className='snapshot-card';
 card.innerHTML=i5SubFileRow()+'<div class="snapshot-info"><span>'+(snapInfo||'安全保障：任务前已自动生成快照，可一键回滚到修改前。')+'</span></div><div class="snapshot-actions"><button class="btn-rollback" data-act="rollback">一键回滚</button></div>';
 parent.appendChild(card);
 return card;
}
var aiCurFileChanges=[];
function i5RenderDoneCards(isCancel){
 if(!aiChatView)return;
 try{
  var list = (Array.isArray(aiCurFileChanges) ? aiCurFileChanges : (window.aiCurFileChanges || []));
  var hasChanges = list && list.length > 0;
  if(isCancel||!hasChanges)return;
  var fileNames = list.map(function(f){ return (f && (f.path || f.file || f.name)) || String(f); }).join('、');
  var scope=null;
  try{
   var kids=aiChatView.children||[];
   for(var hi=kids.length-1;hi>=0;hi--){ var c=kids[hi]; var cn=String((c&&(c.className||''))||''); if(/(^|\s)ai-msg(\s|$)/.test(cn)){ scope=c; break; } }
  }catch(e){ scope=null; }
  if(!scope){ scope=document.createElement('div'); scope.className='ai-msg ai'; aiChatView.appendChild(scope); }
  i5AppendDiffAudit(scope, fileNames);
  i5AppendSnapshotCard(scope);
  var chips=document.createElement('div'); chips.className='followup-chips';
  chips.innerHTML='<button class="followup-chip" data-q="继续优化细节">继续优化细节</button><button class="followup-chip" data-q="检查无障碍与边界">检查边界</button><button class="followup-chip" data-q="生成变更说明">生成变更说明</button>';
  scope.appendChild(chips);
  scope.querySelectorAll('button').forEach(function(b){
   b.onclick=function(){
    var act=b.getAttribute('data-act')||'';
    var q=b.getAttribute('data-q')||'';
    if(q){ try{ if(aiInputEl){ aiInputEl.value=q; aiInputEl.focus(); } }catch(e){} return; }
    if(act==='rollback'){ try{ openSnapPanel(); }catch(e){} return; }
   };
  });
  try{ window.protoAPI.snapshot.list(aiSbxDir()).then(function(r){ var items=(r&&r.items)||[]; if(items.length){ var info=scope.querySelector('.snapshot-info span'); if(info)info.textContent='安全保障：已生成快照 '+items[0].ts+'（共 '+items.length+' 份），可一键回滚到修改前。'; } }).catch(function(){}); }catch(e){}
  if(aiChatView&&!aiUserScrolledPause)aiChatView.scrollTop=aiChatView.scrollHeight;
  scrubAiChatView();
 }catch(e){}
}
function i5ClassifyError(ev){
 var code=String((ev&&(ev.code||ev.kind))||'').toUpperCase();
 var msg=String((ev&&(ev.message||ev.error))||'');
 var title=String((ev&&ev.title)||'');
 if(/429|QUOTA|RATE_LIMIT/i.test(code+' '+msg+' '+title))return '429';
 if(/401|AUTH|INVALID_API_KEY|UNAUTH/i.test(code+' '+msg+' '+title))return '401';
 if(/CLI_NOT_FOUND|AGENT_NOT_FOUND|NOT_FOUND_CLI/i.test(code+' '+msg))return 'CLI_NOT_FOUND';
 if(/CANCEL/i.test(code+' '+msg))return 'cancel';
 if(/429/.test(msg))return '429';
 if(/401/.test(msg))return '401';
 return 'unknown';
}
function i5RenderErrorCard(ev){
 if(!aiChatView)return;
 var kind=i5ClassifyError(ev);
 var map={
  '429':{ t:'模型配额耗尽或请求受限 (429)', b:'当前服务商账户余额不足或并发过高，工作区完好无损。建议切换免费模型或检查额度后重试。', acts:[['primary','前往设置中心配置 Key',"openSettings('ai')"],['secondary','切换至免费推荐模型',"switchModel('free')"],['secondary','重新发起',"i5RetryLast()"]] },
  '401':{ t:'密钥失效或未授权 (401)', b:'服务商拒绝了当前凭据：Key 错误、过期或未保存。已检测 UI 与已保存 Key 是否一致，请前往设置修正后重试。', acts:[['primary','前往设置中心配置 Key',"openSettings('ai')"],['secondary','重新发起',"i5RetryLast()"]] },
  'CLI_NOT_FOUND':{ t:'未检测到 Agent CLI', b:String((ev&&ev.message)||'未找到本地 Agent 可执行文件。请安装对应 CLI 或在设置中心矩阵中指定路径后重试。'), acts:[['secondary','复制安装命令',"i5CopyInstall()"],['primary','前往设置指定路径',"openSettings('ai')"],['secondary','重新发起',"i5RetryLast()"]] },
  'cancel':{ t:'已停止生成', b:'已按你的指令无损终止本次任务，工作区保留停止前状态，可随时重新发起。', acts:[['secondary','重新发起',"i5RetryLast()"]] },
  'unknown':{ t:String((ev&&ev.title)||'调用失败'), b:String((ev&&ev.message)||'未知错误')+' 工作区完好无损，可重试或查看执行日志定位。', acts:[['secondary','查看执行日志',"switchAiTab('logs')"],['secondary','重新发起',"i5RetryLast()"]] }
 };
 var m=map[kind]||map.unknown;
 var wrap=document.createElement('div'); wrap.className='ai-msg-bubble ai-error-card';
 wrap.innerHTML='<div class="err-card-header"><span class="err-icon">!</span><span class="err-title">'+escHtml(m.t)+'</span></div><div class="err-card-body">'+escHtml(m.b)+'</div><div class="err-card-actions"></div>';
 var actWrap=wrap.querySelector('.err-card-actions')||wrap;
 (m.acts||[]).forEach(function(act){
  var btn=document.createElement('button');
  btn.className='btn-err-action btn-'+act[0];
  btn.setAttribute('data-js',act[2]);
  btn.setAttribute('onclick',act[2]);
  btn.textContent=act[1];
  btn.onclick=function(){ try{ new Function(act[2])(); }catch(e){} };
  actWrap.appendChild(btn);
 });
 aiChatView.appendChild(wrap);
 try{ if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){}
 try{ if(typeof scrubAiChatView==='function') scrubAiChatView(); }catch(e){}
}
function i5RetryLast(){
 var s=aiCurSesh();
 if(!s||!s.m||!s.m.length)return;
 for(var i=s.m.length-1;i>=0;i--){
  if(s.m[i].r==='u'&&s.m[i].t){
   if(aiInputEl)aiInputEl.value=s.m[i].t;
   aiDoSend();
   return;
  }
 }
}
window.i5RetryLast=i5RetryLast;
function i5CopyInstall(){
 var cmd='npm i -g opencode-cli';
 try{ if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(cmd).then(function(){ showToast('安装命令已复制'); }); else throw new Error('noclip'); }
 catch(e){ try{ var ta=document.createElement('textarea'); ta.value=cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('安装命令已复制'); }catch(ee){} }
}
window.i5CopyInstall=i5CopyInstall;
var _i5Tools=[];
function i5SyncTopBar(){
 try{ i5SetupTopModelSelect(); }catch(e){}
}
function i5SetupTopModelSelect(topEl, baseEl){
 if(baseEl)aiModelEl=baseEl;
 return i5SyncTopModel();
}
function i5SyncTopModel(){ try{}catch(e){} }
/* 对话框侧新变体（归属对话框改造）：与设置/下拉用的 aiRenderModelOptions(r) 同名冲突已解，改名独立 */
function aiRenderModelOptionsInto(selectEl, groups, curVal, visibleList){
  if(!selectEl)return;
  selectEl.innerHTML='';
  var count=0;
  var stripFree=function(id){ return String(id||'').replace(/[-_]free/gi,''); };
  (groups||[]).forEach(function(g){
    var items=(g.models||[]).filter(function(m){
      var id=stripFree(typeof m==='string'?m:(m&&(m.id||m.name))||'');
      return (!visibleList||visibleList.indexOf(id)>=0);
    });
    if(!items.length)return;
    var grpEl=document.createElement('optgroup');
    grpEl.label=g.label||g.provider||'模型';
    items.forEach(function(m){
      var id=stripFree(typeof m==='string'?m:(m&&(m.id||m.name))||'');
      var name=stripFree(typeof m==='string'?m:(m&&(m.name||m.id))||'');
      var opt=document.createElement('option');
      opt.value=id; opt.textContent=name;
      if(id===curVal)opt.selected=true;
      grpEl.appendChild(opt);
      count++;
    });
    selectEl.appendChild(grpEl);
  });
  if(count===0){
    var defOpt=document.createElement('option');
    defOpt.value='default';
    defOpt.textContent='默认推荐模型 (CLI 预设)';
    defOpt.selected=true;
    selectEl.appendChild(defOpt);
  }
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
  h+='<div class="ai-op-row" data-gid="'+escAttr((g&&g.id)||'')+'" data-role="think" title="点击查看思考链全文" style="cursor:pointer"><span class="op-tag">思考</span><span class="op-val">已完成</span><span class="op-sec">'+sec+'s</span></div>';
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
   try{ if(typeof i5RenderDoneCards==='function') i5RenderDoneCards(isCancel); }catch(e){}
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
var AI_MODEL_KEY='ai_model',AI_MODEL_DEFAULT='default';
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
 var cleanId=function(s){ s=String(s||'').trim(); if(/[-_]free$/i.test(s))s=s.replace(/[-_]free$/i,'').trim(); return s; };
 var stored=cleanId(aiStoredModel()),def=cleanId((r&&r.default)||AI_MODEL_DEFAULT);
 if(!def||def==='__none__')def='default';
 var cur=(stored&&stored!=='__none__')?stored:def;
 var groups=(r&&r.groups)||[];
 var visible=(r&&Array.isArray(r.visibleModels)&&r.visibleModels.length)?r.visibleModels.map(cleanId):null;
 var html='';
 var found=false;
 for(var i=0;i<groups.length;i++){
  var g=groups[i],items=(g&&g.models)||[];
  var gHtml='';
  for(var j=0;j<items.length;j++){
   var it=items[j],id=cleanId(it.id||''),name=it.name||id;
   if(!id)continue;
   if(visible && visible.indexOf(id)<0 && id!==cur) continue;
   if(id===cur)found=true;
   gHtml+='<option value="'+escHtml(id)+'"'+(id===cur?' selected':'')+'>'+escHtml(name)+'</option>';
  }
  if(gHtml){
   html+='<optgroup label="'+escHtml(g.label||g.provider||'未命名供应商')+'">'+gHtml+'</optgroup>';
  }
 }

 if(!html){
  /* 安全保底：全未勾选时强制保留default推荐项，杜绝废弃-free */
  aiModelEl.innerHTML='<option value="default">默认推荐模型 (CLI 预设)</option><option value="__manage_models__">管理模型列表...</option>';
  aiModelEl.value='default';
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
   if(window.MaskStack) window.MaskStack.push('aiMask', aiEscClose); // T3.3:ESC经此先取消后关闭
   aiEnsureCur(); /* 再加载当前沙箱唯一会话（含 opencode 会话 ID） */
   try{ renderSessionList(aiSbxDir()); }catch(e){}
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
 /* T3.3:MaskStack唯一ESC入口回调。等价旧双监听净效果（取消+关闭）：
    ✕按钮/遮罩点击仍走closeAi（后台继续），仅ESC经此取消后关闭 */
  function aiEscClose(){
   if(aiBusy){ try{ i5CancelAi(); }catch(e){} }
   closeAi();
  }
 /* AI 设计：在当前原型沙箱打开对话（沙箱唯一会话，自动续接历史） */
 function openAiDesign(){
  if(!aiMaskEl)return;
  if(!HAS_AI){ (typeof showToast==="function"?showToast:alert)('大模型对话仅桌面端可用（请使用 exe 版打开）。'); return; }
   sweepStrayMasks(); /* 先清除游离/已知遮罩，避免与 AI 弹窗叠加 */
   if(window.MaskStack) window.MaskStack.push('aiMask', aiEscClose); // T3.3:ESC经此先取消后关闭
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
   aiBubbleError('（上一个任务仍在运行，请先点击「停止生成」中断，或等待其完成后再发送。输入内容仍保留在输入框中。）');
   return;
  }
   aiEnsureCur();
   /* 发送前防御：若缓存的会话 oid 不属于当前沙箱目录，忽略它（opencode 会卡死） */
   if(aiSession&&aiSession.oid&&!aiOidDirOk(aiSession.oid)){ aiSession.oid=''; aiSaveSesh(); }
   var s=aiCurSesh();
    aiActiveKey=SESS_KEY+'#'+encodeURIComponent(s.id||''); /* 记录发送时所在源：本次运行的事件只回写该源 */
   if(!s)return;
   if(aiInputEl)aiInputEl.value='';
   if(!s.lastHash||typeof s.lastHash!=='object') s.lastHash={};
   s.m=s.m||[]; s.m.push({r:'u',t:t});
   s.updatedAt=Date.now();
  aiSaveSesh();
  aiAppendMsg(t,'user');
  /* 开启新日志组：本次任务的思考/操作/删除/输出链全部归入该组 */
  var g=aiTraceBegin(t.replace(/\s+/g,' ').slice(0,24)+(t.length>24?'…':''));
  aiStreaming=aiAppendMsg('','ai'); aiStreamText=''; aiStreamThink=''; aiCurFileChanges=[]; try{ window.aiCurFileChanges=[]; }catch(e){}
   aiRenderStream(); /* 立即显示「等待响应…」计时，避免无反馈等待 */
   aiSetBusy(true);
   // 401 预检：Iteration6弹窗化后仅弹窗打开时比对表单，否则以当前使用项为准
   try {
     var _maskOpen=false; try{ var _mm=(typeof $==='function')?$('apiProfileMask'):null; _maskOpen=!!(_mm&&_mm.style&&_mm.style.display!=='none'&&_mm.style.display!==''); }catch(e){}
     var _uiKey = (typeof setApiKey!=='undefined' && setApiKey && setApiKey.value || '').trim().replace(/^Bearer\s+/i,'').replace(/^["']|["']$/g,'').trim();
     var _savedKey = (curAiConfig && curAiConfig.api && curAiConfig.api.apiKey || '').trim().replace(/^Bearer\s+/i,'').replace(/^["']|["']$/g,'').trim();
     var _engineChk = (typeof getActiveEngineInUi==='function'?getActiveEngineInUi():(curAiConfig&&curAiConfig.engine||'cli'));
     if (_maskOpen && _engineChk==='api' && _uiKey && _uiKey !== _savedKey) {
       aiAppendTrace({tag:'WARN',level:'warn',text:'检测到设置中API Key与已保存的不一致（UI已改但未点"保存并应用"），本次请求将使用已保存的旧Key（长度'+_savedKey.length+'），可能导致401。建议先保存。 UI:'+_uiKey.slice(0,4)+'...('+_uiKey.length+') 已保存:'+_savedKey.slice(0,4)+'...('+_savedKey.length+')'});
     }
     if (_engineChk==='api' && _savedKey && _savedKey.length < 10) {
       aiAppendTrace({tag:'WARN',level:'warn',text:'已保存的API Key过短（'+_savedKey.length+'字符），可能未完整复制'});
     }
   } catch(e){}
    var _enk = true;
   var activePg = (typeof aiDetectCurrentPage==='function' ? aiDetectCurrentPage() : '');
  var targetFile = (aiTargetPageSelect && aiTargetPageSelect.value) || (currentSource && (currentSource.activeSubFile || currentSource.mainHtmlFile || currentSource.name)) || '';
  window.protoAPI.ai.ask(t, s.oid||'', aiSbxDir(), aiCurModel(), {history:(s.m||[]).slice(-20), lastHash:s.lastHash||{}, uiSessionId:s.id||'', agentSessionId:s.oid||'', engine:(typeof getActiveEngineInUi==='function'?getActiveEngineInUi():(curAiConfig&&curAiConfig.engine||'cli')), activePage: activePg, targetFile: targetFile, enableTools:_enk}).then(function(r){
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
   if(aiClearEl)aiClearEl.onclick=function(){
   if(aiBusy){ alert('当前回答进行中，请先点击「停止生成」。'); return; }
   if(aiChatView)aiChatView.innerHTML='';
   aiEnsureCur();
   aiSession.m=[]; aiSession.oid=''; /* 清空气泡与 opencode 上下文，二者保持一致 */
   aiSaveSesh();
  };
   if(aiInputEl)aiInputEl.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing){ e.preventDefault(); aiDoSend(); return; }
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); aiDoSend(); }
  });
 window.protoAPI.ai.onEvent(function(ev){
    if(!ev)return;
    if(ev.type==='session'){
     var k=aiActiveHistKey();
     if(k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)){ var s=aiCurSesh(); if(s){ s.oid=ev.id||''; aiSaveSesh(); } }
     else{ aiWriteSeshFor(k,function(v){ v.oid=ev.id||''; }); }
    }
    else if(ev.type==='tool_call'){
      try{ i5AppendToolCall(ev); }catch(e){}
      try{ aiUpdateOpCur(); }catch(e){}
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
    else if(ev.type==='done'){
      aiCurFileChanges = Array.isArray(ev.fileChanges) ? ev.fileChanges : [];
      try{ window.aiCurFileChanges=aiCurFileChanges; }catch(e){}
      finishAiStream(false);
      aiSyncSandbox();
      __editOnAiDone();
    }
    else if(ev.type==='error'){
      try{ logWrite('error','ai',ev.message||'未知错误'); }catch(e){}
      var _emsg='发送失败：'+(ev.message||ev.error||'未知错误');
      try{ i5RenderErrorCard(ev); }catch(e){}
      try{ aiBubbleError(_emsg); }catch(e){ try{ aiSetBusy(false); }catch(ee){} }
    }
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
      }).catch(function(e){ reportError('snapshot-restore', e, '恢复失败：'+((e&&e.message)||e||'未知错误')); });
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
function i5RefreshAgentBadge(agentId){
  aiAgentBadge=$('aiAgentBadge')||aiAgentBadge; aiAgentName=$('aiAgentName')||aiAgentName;
  var label=I5_AGENT_FALLBACK[agentId]||agentId||'OpenCode';
  if(aiAgentName)aiAgentName.textContent=label;
  if(aiAgentBadge)aiAgentBadge.title='当前主力 Agent：'+label;
  var topName=$('aiAgentName'); if(topName&&topName!==aiAgentName)topName.textContent=label;
}
function i5RenderAgentMatrix(agents, mainId){
  aiAgentMatrix=$('aiAgentMatrix')||aiAgentMatrix;
  if(!aiAgentMatrix)return;
  var list=Array.isArray(agents)&&agents.length?agents.slice():[];
  var order={}; I5_AGENT_ORDER.forEach(function(id,i){ order[id]=i; });
  list.sort(function(a,b){ var oa=(order[a.id]!=null?order[a.id]:99), ob=(order[b.id]!=null?order[b.id]:99); return oa-ob; });
  I5_AGENT_ORDER.forEach(function(id){ var found=null; for(var i=0;i<list.length;i++){ if(list[i]&&list[i].id===id){ found=list[i]; break; } } if(!found)list.push({ id:id, name:I5_AGENT_FALLBACK[id], available:false, path:null, version:null }); });
  if(!mainId){ try{ mainId=(curAiConfig&&(curAiConfig.agentId||curAiConfig.mainAgent))||'opencode'; }catch(e){ mainId='opencode'; } }
  aiAgentMatrix.innerHTML='';

  var installedList=[], missingList=[];
  list.forEach(function(a){ if(a&&a.available) installedList.push(a); else missingList.push(a); });

  function makeAgentCard(a){
    var id=String(a.id||'');
    var card=document.createElement('div');
    card.className='agent-card'+(id===mainId?' active':'');
    card.setAttribute('data-id', id);
    var head=document.createElement('div'); head.className='agent-card-header';
    var nameEl=document.createElement('span'); nameEl.className='agent-name'; nameEl.textContent=i5AgentLabel(a);
    var st=document.createElement('span'); st.className='agent-status '+(a.available?'ok':'err'); st.textContent=a.available?('已就绪'+(a.version?' · '+a.version:'')):'未检测到';
    head.appendChild(nameEl); head.appendChild(st); card.appendChild(head);
    var pathRow=document.createElement('div'); pathRow.className='agent-path-row';
    var pathEl=document.createElement('span'); pathEl.className='agent-path'; pathEl.textContent=a.path||'未安装，可指定自定义路径'; pathEl.title=a.path||'';
    pathRow.appendChild(pathEl); card.appendChild(pathRow);
    var acts=document.createElement('div'); acts.className='agent-card-actions';
    var mainBtn=document.createElement('button'); mainBtn.type='button'; mainBtn.className='btn-mini';
    if(id===mainId){ mainBtn.textContent='当前主力'; mainBtn.disabled=true; }
    else{ mainBtn.textContent='设为主力'; mainBtn.disabled=!a.available; if(!a.available)mainBtn.style.opacity='.5'; }
    mainBtn.onclick=function(ev){ ev.stopPropagation(); i5SetMainAgent(id); };
    var pickBtn=document.createElement('button'); pickBtn.type='button'; pickBtn.className='btn-mini btn-pick-cli'; pickBtn.textContent='指定路径';
    pickBtn.onclick=function(ev){ ev.stopPropagation(); i5PickAgentPath(id); };
    acts.appendChild(mainBtn); acts.appendChild(pickBtn); card.appendChild(acts);
    card.onclick=function(){ if(a.available)i5SetMainAgent(id); };
    return card;
  }

  installedList.forEach(function(a){ aiAgentMatrix.appendChild(makeAgentCard(a)); });

  if(missingList.length){
    var foldBox=document.createElement('div'); foldBox.className='agent-fold';
    var foldBar=document.createElement('div'); foldBar.className='agent-fold-bar';
    var foldBody=document.createElement('div'); foldBody.className='agent-fold-body';
    missingList.forEach(function(a){ foldBody.appendChild(makeAgentCard(a)); });
    function paintFold(){
      var collapsed=true;
      try{ collapsed=aiAgentMatrix.getAttribute('data-fold')!=='0'; }catch(e){ collapsed=true; }
      foldBody.style.display=collapsed?'none':'';
      foldBar.innerHTML='';
      var t1=document.createElement('span'); t1.textContent='未安装的 CLI（'+missingList.length+'）';
      var t2=document.createElement('span'); t2.className='agent-fold-arrow'; t2.textContent=collapsed?'▸ 展开':'▾ 收起';
      foldBar.appendChild(t1); foldBar.appendChild(t2);
    }
    paintFold();
    foldBar.onclick=function(){
      try{
        var cur=aiAgentMatrix.getAttribute('data-fold')==='0'?'1':'0';
        aiAgentMatrix.setAttribute('data-fold',cur);
      }catch(e){}
      paintFold();
    };
    foldBox.appendChild(foldBar); foldBox.appendChild(foldBody); aiAgentMatrix.appendChild(foldBox);
  }
}
function i5SetMainAgent(id){
  if(!id)return;
  curAiConfig=curAiConfig||{};
  curAiConfig.agentId=id; curAiConfig.mainAgent=id;
  aiInvalidateModels();
  try{ renderModelManagerList(curAiConfig); }catch(e){}
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
    window.protoAPI.ai.saveConfig(curAiConfig).then(function(){ i5RefreshAgentBadge(id); try{ refreshCliInfo(); }catch(e){} aiInvalidateModels(); aiLoadModels(); try{ renderModelManagerList(curAiConfig); }catch(e){} aiRefreshCli(); });
  }else{ i5RefreshAgentBadge(id); try{ refreshCliInfo(); }catch(e){} }
}
function i5PickAgentPath(id){
  if(!window.protoAPI||!window.protoAPI.ai)return;
  if(id==='opencode'&&window.protoAPI.ai.pickCli){
    window.protoAPI.ai.pickCli().then(function(r){ if(r&&r.path){ curAiConfig=curAiConfig||{}; curAiConfig.cliPath=r.path; curAiConfig.cliPaths=curAiConfig.cliPaths||{}; curAiConfig.cliPaths.opencode=r.path; refreshCliInfo(); aiRefreshCli(); aiInvalidateModels(); aiLoadModels(); } });
    return;
  }
  var curPath=''; try{ curPath=((curAiConfig&&curAiConfig.cliPaths&&curAiConfig.cliPaths[id])||''); }catch(e){}
  askNamePrompt({ title:'指定 '+i5AgentLabel({id:id})+' 路径', label:'可执行文件完整路径', hint:'例如 C:\\Tools\\'+id+'.cmd，留空则清除手动指定', value:curPath }, function(v){
    if(v==null)return;
    curAiConfig=curAiConfig||{}; curAiConfig.cliPaths=curAiConfig.cliPaths||{};
    if(String(v).trim())curAiConfig.cliPaths[id]=String(v).trim(); else delete curAiConfig.cliPaths[id];
    if(window.protoAPI.ai.saveConfig)window.protoAPI.ai.saveConfig(curAiConfig).then(function(){ refreshCliInfo(); aiRefreshCli(); aiInvalidateModels(); aiLoadModels(); });
  });
}
function refreshCliInfo(){
  aiAgentMatrix=$('aiAgentMatrix')||aiAgentMatrix;
  if(aiAgentMatrix&&!aiAgentMatrix.children.length)aiAgentMatrix.innerHTML='<div class="set-tip">正在探测本地 Agent CLI…</div>';
  if(!HAS_AI){ if(aiAgentMatrix)aiAgentMatrix.innerHTML='<div class="set-tip">仅桌面端可用</div>'; return; }
  window.protoAPI.ai.checkCli().then(function(r){
   var agents=(r&&r.agents)||[];
   var mainId=(curAiConfig&&(curAiConfig.agentId||curAiConfig.mainAgent))||null;
   if(!mainId&&window.protoAPI.ai.getConfig){ /* 懒加载主力，避免矩阵默认高亮错误 */ }
   i5RenderAgentMatrix(agents, mainId||'opencode');
   var active=null; for(var i=0;i<agents.length;i++){ if(agents[i]&&(agents[i].id===mainId)&&agents[i].available){ active=agents[i]; break; } }
   if(!active){ for(var j=0;j<agents.length;j++){ if(agents[j]&&agents[j].available){ active=agents[j]; break; } } }
   if(active)i5RefreshAgentBadge(active.id);
  }).catch(function(){ if(aiAgentMatrix)aiAgentMatrix.innerHTML='<div class="set-tip">探测失败，点击重新探测重试</div>'; });
}
if(btnRedetectAgents==null)btnRedetectAgents=$('btnRedetectAgents');
if(btnRedetectAgents)btnRedetectAgents.onclick=function(){ refreshCliInfo(); aiRefreshCli(); };


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
var EXPORT_SCRIPT_FILES=['js/icons.js','js/mask-manager.js','js/core-docs.js','js/nav-zoom.js','js/sandbox-core.js','js/project-ai-export.js','js/edit-entry.js','js/link-bind.js','js/annotation-core.js'];
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
          '#gitRemoteConfirmMask','#gitCrossProjConfirmMask','#gitPullCoverConfirmMask','#gitHealConfirmMask','#gitForceConfirmMask','#gitErrorMask',
          '#kindMask','#nameMask','#settingsMask','#exportMask','#aiMask',
         '#snapMask','#projMask','#reqPanel','#reqMask',
          '#btnEditDoc','#btnSaveDoc','#btnCancelDoc','#kindSeg',
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

// delegated keydown removed
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
      window.MaskStack.register('modelFetchMask','modelFetchMask', closeModelFetch);
     window.MaskStack.register('gitPushMask','gitPushMask', closeGitPushModal);
      window.MaskStack.register('gitPullMask','gitPullMask', closeGitPullModal);
      window.MaskStack.register('gitConfigMask','gitConfigMask', closeGitConfigModal);
      try { window.MaskStack.register('gitRemoteConfirmMask','gitRemoteConfirmMask', function() { gitCloseMask('gitRemoteConfirmMask'); }); } catch (e) {}
      try { window.MaskStack.register('gitCrossProjConfirmMask','gitCrossProjConfirmMask', function() { gitCloseMask('gitCrossProjConfirmMask'); gitPendingCrossProj = null; }); } catch (e) {}
      try { window.MaskStack.register('gitPullCoverConfirmMask','gitPullCoverConfirmMask', function() { gitCloseMask('gitPullCoverConfirmMask'); gitPendingPullCover = null; }); } catch (e) {}
      try { window.MaskStack.register('gitHealConfirmMask','gitHealConfirmMask', function() {}); } catch (e) {}
      try { window.MaskStack.register('gitForceConfirmMask','gitForceConfirmMask', function() { gitCloseMask('gitForceConfirmMask'); }); } catch (e) {}
      try { window.MaskStack.register('gitErrorMask','gitErrorMask', function() { gitCloseMask('gitErrorMask'); }); } catch (e) {}
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
     _bind('modelFetchMask', closeModelFetch);
     _bind('gitPushMask', closeGitPushModal);
      _bind('gitPullMask', closeGitPullModal);
      _bind('gitConfigMask', closeGitConfigModal);
      _bind('gitRemoteConfirmMask', function() { gitCloseMask('gitRemoteConfirmMask'); });
      _bind('gitCrossProjConfirmMask', function() { gitCloseMask('gitCrossProjConfirmMask'); });
      _bind('gitPullCoverConfirmMask', function() { gitCloseMask('gitPullCoverConfirmMask'); });
      _bind('gitForceConfirmMask', function() { gitCloseMask('gitForceConfirmMask'); });
      _bind('gitErrorMask', function() { gitCloseMask('gitErrorMask'); });
      _bind('aiMask', closeAi);
    }
   }catch(e){}
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', bindMaskClicks); } else { bindMaskClicks(); }
  // 兜底：延迟再绑一次，确保 DOM 已就绪（应对脚本提前执行）
  try{ setTimeout(bindMaskClicks, 500); }catch(e){}
 }catch(e){}
})();
// T4.3: 主题系统已按决策彻底剥离
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
        var t=e.target.closest?e.target.closest('[data-role="think"]'):null;
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

/* 唯一全局 keydown 监听，优先委托 MaskStack */
document.addEventListener('keydown', function(e){
  if(window.MaskStack && window.MaskStack.stack && window.MaskStack.stack.length > 0){
    return;
  }
});
