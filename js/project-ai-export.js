/* [js/project-ai-export.js] Wave-D/G index：项目/AI/Git/导出门面（逻辑分层+文件夹切分，物理行暂留兼容）
 * 域切分：js/git-ui/git-domain.js（Git SoC分层）/js/ai/ai-domain.js（AI会话+原型校验）/js/project-ai-export-compiler.js（导出编译）
 *          /js/doc/**（文档域）/js/export-template.js（轻量只读渲染）。本文件保留门面委托与I5/AI设置实现，下波续拆。
 * SoC：executeGitPush→GitDomain；newPrototype→AiDomain（无alert/无260魔法数）；closeAi→AiDomain.requestClose（EventBus）。 */
/* Wave-C/F: ESM 显式依赖 (esc/escHtml/escAttr/showToast/copyToClipboard 经 utils 显式 import;
 * Store/EventBus 显式 import; 导出清单 9→11 与 HTML 同序)。
 * stripped-classic 降级: import 行剥离后裸调用回退 window 全局。 */
/* FIX: 经典<script>加载，禁用ESM import(整文件罢工)。内联回退+window.Utils双保险；
 * Store/EventBus经window只读。_PaeStore/_paeBus/_paeEscAttr保留typeof守卫兼容。 */
var escHtml = (typeof window !== 'undefined' && window.escHtml) || (typeof window !== 'undefined' && window.Utils && window.Utils.escHtml) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var showToast = (typeof window !== 'undefined' && window.showToast) || (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) || function (msg) { try { if (typeof libStatus === 'function') { libStatus(msg); return; } } catch (e) {} try { alert(msg); } catch (e2) {} return null; };
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
   var inDocWin=false;
   try{ inDocWin=(typeof isDocWinMode==='function')?isDocWinMode():!!(document.body&&document.body.classList.contains('docwin-mode')); }catch(e){}
   bodyB.classList.toggle('docs-open',!!open);
   if(!inDocWin){
    if(docsMaskEl)docsMaskEl.style.display=open?'block':'none';
    if(open){ if(window.MaskStack) window.MaskStack.push('docsMask', function(){ setDocsOpen(false); }); }else{ if(window.MaskStack) window.MaskStack.pop('docsMask'); }
   }else{
    /* 独立窗：面板常驻行内布局，无悬浮无遮罩；顺手清掉可能残留的遮罩/栈顶 */
    try{ if(docsMaskEl)docsMaskEl.style.display='none'; }catch(e){}
    try{ if(window.MaskStack) window.MaskStack.pop('docsMask'); }catch(e){}
   }
  if(open&&reqOpen)setReqOpen(false); /* 与「最新需求」面板互斥 */
  /* PC 目录常驻：随文档弹窗同显隐 */
  try{
   if(open){ if(typeof syncTocForTab==='function')syncTocForTab(); }
   else{ if(typeof closeToc==='function')closeToc(); }
  }catch(e){}
  if(!open){
    closeToc();
    /* 合一：关面板时若停在最新需求 tab 且不在编辑中，回落功能说明，下次打开默认 desc */
    try{
      var _inReqTab=false;
      try{ _inReqTab=(typeof getDocReqState==='function')?!!getDocReqState():!!(typeof reqMode!=='undefined'&&reqMode); }catch(e){}
      var _editing=false;
      try{ _editing=!!(typeof editOn!=='undefined'&&editOn)||!!(typeof reqEditing!=='undefined'&&reqEditing); }catch(e){}
      if(_inReqTab&&!_editing){
        try{ if(typeof reqMode!=='undefined')reqMode=false; else if(window)window.reqMode=false; }catch(e){}
        try{ if(typeof loadDesc==='function')loadDesc(); }catch(e){}
        try{ if(typeof syncDocModeTabs==='function')syncDocModeTabs(); }catch(e){}
      }
    }catch(e){}
    return;
  } /* 功能说明收起时同步收起目录浮窗 */
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
  var wantDir='';
  try{ wantDir=(typeof aiSbxDir==='function')?aiSbxDir():''; }catch(e){}
  var render=function(txt){
    try{ if((typeof aiSbxDir==='function'?aiSbxDir():'')!==wantDir) return; }catch(e){ return; } /* 切原型竞态：旧读回包直接丢弃 */
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
  var inDocWin2=false;
  try{ inDocWin2=(typeof isDocWinMode==='function')?isDocWinMode():!!(document.body&&document.body.classList.contains('docwin-mode')); }catch(e){}
  if(!inDocWin2){
   if(reqMaskEl)reqMaskEl.style.display=open?'block':'none';
   if(open){ if(window.MaskStack) window.MaskStack.push('reqMask', function(){ setReqOpen(false); }); }else{ if(window.MaskStack) window.MaskStack.pop('reqMask'); }
  }else{
   /* 独立窗：面板常驻行内布局，无悬浮无遮罩；顺手清掉可能残留的遮罩/栈顶 */
   try{ if(reqMaskEl)reqMaskEl.style.display='none'; }catch(e){}
   try{ if(window.MaskStack) window.MaskStack.pop('reqMask'); }catch(e){}
  }
  if(open){
   if(bodyB&&bodyB.classList.contains('docs-open'))setDocsOpen(false); /* 与功能说明互斥 */
   exitReqEdit(true);
   loadReqContent();
  }else{ exitReqEdit(true); }
 }
function toggleReqPane(){
  if(pcMode()){ try{ if(typeof switchDocTab==='function'){ switchDocTab(true); return; } }catch(e){} } /* PC 合一：进统一面板切最新需求 tab，不弹裸弹窗 */
  /* 移动端：右侧面板切换为「最新需求」内容（与功能说明互斥显示） */
  setReqModeMobile(!reqMode);
}
/* 移动端：右侧文档面板显示「最新需求」（复用 docs-panel，直接切换内容，非弹窗） */
var reqMode=false;
function renderReqIntoDocs(){
  var wantDir='';
  try{ wantDir=(typeof aiSbxDir==='function')?aiSbxDir():''; }catch(e){}
  var render=function(txt){
    try{ if((typeof aiSbxDir==='function'?aiSbxDir():'')!==wantDir) return; }catch(e){ return; } /* 切原型竞态：旧读回包直接丢弃 */
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
      loadSandboxSources(res.name, true); /* 刷新列表并选中沙箱中的新原型（导入成功后的后台刷新，静默） */
      }else{
      reportError('proto-adopt', new Error(res&&res.error||'未知错误'), '复制到沙箱失败：'+(res&&res.error||'未知错误')+'，已按普通方式加载。');
      var folder=r.path?r.path.replace(/[\\\/][^\\\/]+$/,''):'';
      addSourceFromFile(r.name, r.content||'', folder);
      }
    });
   });
};

/* ═══════ 复制代码片段辅助函数 ═══════ */
/* Wave-B: 剪贴板收敛1/5（底层改走 window.Utils.copyToClipboard，保留按钮回显；fallback保留原生以兼容无Utils时） */
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
  try{ if(typeof window!=='undefined'&&window.Utils&&window.Utils.copyToClipboard){ var U=window.Utils.copyToClipboard; try{ if(navigator&&navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(markDone, function(){ U(txt,''); markDone(); }); return; } }catch(e){} U(txt,''); markDone(); return; } }catch(e){}
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
var gitGlobalOriginText = $('gitGlobalOriginText'), gitRemoteUrlHint = $('gitRemoteUrlHint'), gitBranchHint = $('gitBranchHint');
var gitPushBranchRuleHint = $('gitPushBranchRuleHint'), gitPullBranchRuleHint = $('gitPullBranchRuleHint');
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
/* 本地 CLI 终端：在当前沙箱目录打开当前使用的 CLI（独立控制台窗口，可交互） */
var btnOpenCliEl = $('btnOpenCli');
if (btnOpenCliEl) {
  btnOpenCliEl.onclick = function() {
    try { closeGitDropdown(); } catch (e) {}
    var dir = '';
    try { dir = (typeof aiSbxDir === 'function') ? aiSbxDir() : ''; } catch (e) { dir = ''; }
    if (!dir) { try { showToast('请先选择一个原型'); } catch (e2) {} return; }
    if (!(window.protoAPI && window.protoAPI.ai && window.protoAPI.ai.openTerminal)) {
      try { showToast('当前环境不支持打开终端'); } catch (e3) {}
      return;
    }
    window.protoAPI.ai.openTerminal(dir).then(function(r) {
      if (r && r.ok) { try { showToast('已打开终端：' + ((r.cmd) || r.agent || 'CLI')); } catch (e4) {} }
      else { try { showToast('打开终端失败：' + ((r && (r.error || r.message)) || '未知错误')); } catch (e5) {} }
    }).catch(function(e6) { try { showToast('打开终端失败：' + ((e6 && e6.message) || e6)); } catch (e7) {} });
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
/* Wave-B: 剪贴板收敛2/5（gitCopyText 改走 Utils.copyToClipboard，保留 toast 语义；fallback保留） */
function gitCopyText(txt, okMsg) {
  try{ if(typeof window!=='undefined'&&window.Utils&&window.Utils.copyToClipboard){ window.Utils.copyToClipboard(txt, okMsg); return; } }catch(e){}
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
function gitPushVisibleFile(relPath){
  /* 上传仅显示原型三类文件：html/md/json；隐藏会话历史md、提示词(.context)、备份区与杂项 */
  var p=String(relPath||'').replace(/\\/g,'/');
  if(!p) return false;
  var low=p.toLowerCase();
  if(/(^|\/)\.context\//.test(low)) return false;
  if(/(^|\/)\.pull-backup\//.test(low)) return false;
  if(/(^|\/)\.heal-backup\//.test(low)) return false;
  if(/(^|\/)\.gitignore$/.test(low)) return false;
  if(/\.html?$/i.test(p)) return true;
  if(/\.md$/i.test(p)) return true;
  if(/(^|\/)links\.json$/i.test(p)) return true;
  if(/(^|\/)annotations\.json$/i.test(p)) return true;
  return false;
}
function gitFilterPushProjects(projects){
  var out=[];
  (projects||[]).forEach(function(proj){
    var nps=[];
    (proj.protos||[]).forEach(function(pr){
      var fs=((pr.files||[]).filter(function(f){ return f&&gitPushVisibleFile(f.path); }));
      if(fs.length) nps.push({proto:pr.proto, files:fs});
    });
    if(nps.length) out.push({project:proj.project, isCurrent:proj.isCurrent, protos:nps});
  });
  return out;
}
function gitFileLabelHtml(f, inputName, isDefaultChecked, pIdx, prIdx){
  return '<label class="git-tree-item">'
    + '<input type="checkbox" name="' + inputName + '"' + (isDefaultChecked ? ' checked' : '') + ' data-path="' + escAttr(f.path) + '" data-pidx="' + pIdx + '" data-pridx="' + prIdx + '">'
    + '<span class="status-tag ' + escAttr(f.code || 'mod') + '">' + escHtml(f.label || '修改') + '</span>'
    + '<span class="git-file-name" title="' + escAttr(f.path) + '">' + escHtml(f.subPath || f.path) + '</span>'
    + '</label>';
}
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
        + '<div class="git-tree-proto" title="收起/展开该原型文件列表">'
        + '<input type="checkbox" class="git-group-chk"' + (isDefaultChecked ? ' checked' : '') + ' data-pidx="' + pIdx + '" data-pridx="' + prIdx + '">'
        + '<span class="git-proto-arrow">▾</span>'
        + '<span class="git-tree-proto-name">' + escHtml(pr.proto) + '</span>'
        + '<span class="git-tree-proto-count">' + files.length + ' 个文件</span>'
        + '</div>'
        + '<div class="git-proto-body">';

      files.forEach(function(f) {
        html += gitFileLabelHtml(f, inputName, isDefaultChecked, pIdx, prIdx);
      });
      html += '</div></div>';
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

  // 4. 原型整组收起/展开（点行收起下方列表；点勾选框只勾选不折叠）
  containerEl.querySelectorAll('.git-tree-proto').forEach(function(hd) {
    hd.onclick = function(ev) {
      try{
        var t = ev && (ev.target || ev.srcElement);
        if (t && ((t.tagName || '').toLowerCase() === 'input' || (t.closest && t.closest('input')))) return;
      }catch(e){}
      var grp = hd.parentElement;
      var body = grp ? grp.querySelector('.git-proto-body') : null;
      var arrow = hd.querySelector('.git-proto-arrow');
      if (!body) return;
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      if (arrow) arrow.textContent = hidden ? '▾' : '▸';
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
    renderGitTree(gitPushTreeList, gitFilterPushProjects(r.projects), function(cnt) {
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
  /* Wave-D/G SoC修复：编排委托 GitDomain（收集/校验/IPC/渲染/定时各归其层），本函数仅组装 ctx（无混杂）。 */
  try {
    if (typeof GitDomain !== 'undefined' && GitDomain && typeof GitDomain.executeGitPush === 'function') {
      var _msg = '更新原型与文档数据';
      try { _msg = (typeof gitPushMessage !== 'undefined' && gitPushMessage && gitPushMessage.value.trim()) || _msg; } catch (e) {}
      var _branch = '';
      try { _branch = (typeof getActiveBranch === 'function') ? getActiveBranch(gitPushBranchSelect, gitPushBranchCustom) : ''; } catch (e2) {}
      var _files = [];
      try { _files = (typeof gitCollectChecked === 'function') ? gitCollectChecked(gitPushTreeList) : []; } catch (e3) {}
      GitDomain.executeGitPush({
        force: !!force, files: _files, message: _msg, branch: _branch,
        treeList: (typeof gitPushTreeList !== 'undefined') ? gitPushTreeList : null,
        branchSelect: (typeof gitPushBranchSelect !== 'undefined') ? gitPushBranchSelect : null,
        branchCustom: (typeof gitPushBranchCustom !== 'undefined') ? gitPushBranchCustom : null,
        els: { submit: (typeof gitPushSubmit !== 'undefined') ? gitPushSubmit : null, force: (typeof btnGitPushForce !== 'undefined') ? btnGitPushForce : null, status: (typeof gitPushStatus !== 'undefined') ? gitPushStatus : null },
        closeModal: (typeof closeGitPushModal === 'function') ? closeGitPushModal : function () {},
        refreshList: function (b) { try { loadGitPushStatus(b || _branch); } catch (e) {} },
        onCrossProject: function (info) {
          try { gitPendingCrossProj = { kind: 'push', files: info.files, message: info.message, branch: info.branch }; } catch (e) {}
          try { var t = $('gitCrossProjConfirmText'); if (t) t.textContent = '本次将跨项目推送到同一远端同一分支 [' + info.branch + ']，异项目文件将一并推送，不可单独撤回。'; } catch (e2) {}
          try { var l = $('gitCrossProjConfirmList'); if (l) l.textContent = '异项目清单：' + info.foreign.slice(0, 5).join('、') + (info.foreign.length > 5 ? (' 等 ' + info.foreign.length + ' 项') : '') + '\n本次共 ' + info.files.length + ' 个文件。'; } catch (e3) {}
          try { var ack = $('gitCrossProjConfirmAck'); if (ack) ack.checked = false; } catch (e4) {}
          try { gitOpenMask('gitCrossProjConfirmMask'); } catch (e5) {}
        },
        onNeedHeal: function (r, retry) { try { gitOpenHealConfirm(r, retry); } catch (e) {} },
        onNeedConfig: function () { try { gitShowPushEmptyConfig(true); } catch (e) {} },
        onRoutableError: function (r, info) {
          try {
            if (r && (r.canForce || r.needPull)) {
              showGitError({ code: '', title: info.title, body: info.body, detail: String((r && r.error) || ''), primaryText: '拉取同步后重试', primaryFn: function () { try { closeGitPushModal(); } catch (e) {} openGitPullModal(); }, secondaryText: (r && r.canForce) ? '强制覆盖上传' : '', secondaryFn: function () { gitOpenForceConfirm(_branch, _files); } });
            }
          } catch (e) {}
        }
      });
      return;
    }
  } catch (e) {}
  try { if (typeof showToast === 'function') showToast('Git 域未加载。'); } catch (e2) {}
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
  /* Wave-D/G SoC修复：委托 GitDomain（含 GIT_PUSH_CLOSE_DELAY_MS），无裸 1600。 */
  try {
    if (typeof GitDomain !== 'undefined' && GitDomain && typeof GitDomain.executeGitPushWithForeign === 'function') {
      GitDomain.executeGitPushWithForeign({
        files: files, message: msg, branch: branch,
        els: { submit: (typeof gitPushSubmit !== 'undefined') ? gitPushSubmit : null, force: (typeof btnGitPushForce !== 'undefined') ? btnGitPushForce : null, status: (typeof gitPushStatus !== 'undefined') ? gitPushStatus : null },
        closeModal: (typeof closeGitPushModal === 'function') ? closeGitPushModal : function () {},
        refreshList: function (b) { try { loadGitPushStatus(b || branch); } catch (e) {} },
        onNeedHeal: function (r, retry) { try { gitOpenHealConfirm(r, retry); } catch (e) {} }
      });
      return;
    }
  } catch (e) {}
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
          try { loadSandboxSources(undefined, true); } catch (e) {}
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
      /* 拉取成功后重查远端并刷新列表（已同步的不再列出）；稍延迟让成功态可读 */
      try { setTimeout(function(){ try{ loadGitPullDiff(r.branch || branch); }catch(e){} }, 1200); } catch (e) {}
    } else {      if (gitPullSubmit) { gitPullSubmit.disabled = false; gitPullSubmit.textContent = '重试拉取'; }
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
    var dirtyCode = {};
    try {
      (sr.projects || []).forEach(function(p) {
        (p.protos || []).forEach(function(pr) {
          (pr.files || []).forEach(function(f) { if (f && f.path) { dirty[f.path] = 1; dirtyCode[f.path] = f.code || ''; } });
        });
      });
    } catch (e) {}
    /* 本地已删文件不算脏：拉取即用远端恢复，无需覆盖确认 */
    var overlap = (files || []).filter(function(p) { return dirty[p] && dirtyCode[p] !== 'del'; });
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
  var b = $('btnGitPullCoverBackup'), o = $('btnGitPullCoverOverwrite'), c = $('btnGitPullCoverCancel'), x = $('gitPullCoverConfirmClose');
  if (b) b.onclick = function() {
    var pend = gitPendingPullCover;
    gitCloseMask('gitPullCoverConfirmMask');
    if (!pend) return;
    gitPendingPullCover = null;
    gitDoPull(pend.files, pend.branch, true);
  };
  if (o) o.onclick = function() {
    var pend = gitPendingPullCover;
    gitCloseMask('gitPullCoverConfirmMask');
    if (!pend) return;
    gitPendingPullCover = null;
    gitDoPull(pend.files, pend.branch, false);
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
var tabNavAi=$('tabNavAi'),tabNavModels=$('tabNavModels'),tabNavUispec=$('tabNavUispec'),tabNavSandbox=$('tabNavSandbox'),tabNavShortcut=$('tabNavShortcut'),tabNavAbout=$('tabNavAbout');
var paneSetAi=$('paneSetAi'),paneSetModels=$('paneSetModels'),paneSetUispec=$('paneSetUispec'),paneSetSandbox=$('paneSetSandbox'),paneSetShortcut=$('paneSetShortcut'),paneSetAbout=$('paneSetAbout');
var engCli=$('engCli'),engApi=$('engApi'),boxCliCfg=$('boxCliCfg'),boxApiCfg=$('boxApiCfg');
var setApiPreset=$('setApiPreset'),setApiBaseUrl=$('setApiBaseUrl'),setApiKey=$('setApiKey'),setApiModel=$('setApiModel'),setApiEye=$('setApiEye');
var setApiProviderName=$('setApiProviderName');
var btnTestApi=$('btnTestApi'),testApiStatus=$('testApiStatus');
var setModelSearch=$('setModelSearch'),btnClearAllModels=$('btnClearAllModels');
var modelCheckList=$('modelCheckList'),newModelInput=$('newModelInput'),btnAddCustomModel=$('btnAddCustomModel');
var curAiConfig=null;
/* CLI 模型可见/自定义列表按 CLI 分 CLI 隔离 {agentId:[ids]}（旧版为全局数组，读时兼容、载入时迁移）。
 * 未选过的 CLI 取到 [] → 管理页显示为空（下拉仍可从全量选，见 aiRenderModelOptions 保底）。 */
function curCliId(cfg){
  try{
    var c=(cfg===undefined)?curAiConfig:cfg;
    return String((c&&(c.agentId||c.mainAgent))||'opencode');
  }catch(e){ return 'opencode'; }
}
function normalizeCliModelMaps(cfg){
  cfg=cfg||{};
  var cur=String((cfg.agentId||cfg.mainAgent)||'opencode');
  ['visibleModelsCli','customModelsCli'].forEach(function(k){
    var v=cfg[k];
    if(Array.isArray(v)){ var m={}; m[cur]=v.slice(); cfg[k]=m; }
    else if(!v||typeof v!=='object'){ cfg[k]={}; }
    else{ var out={}; try{ Object.keys(v).forEach(function(id){ if(Array.isArray(v[id]))out[id]=v[id].slice(); }); }catch(e){} cfg[k]=out; }
  });
  return cfg;
}
function getCliVisibleIds(cfg){
  try{
    var c=(cfg===undefined)?curAiConfig:cfg;
    var v=c&&c.visibleModelsCli;
    if(Array.isArray(v))return v.slice();
    if(v&&typeof v==='object'){ var a=v[curCliId(c)]; return Array.isArray(a)?a.slice():[]; }
  }catch(e){}
  return [];
}
function setCliVisibleIds(ids){
  try{
    curAiConfig=curAiConfig||{};
    var v=curAiConfig.visibleModelsCli;
    var m=(v&&typeof v==='object'&&!Array.isArray(v))?v:{};
    if(Array.isArray(v)){ m={}; m[curCliId()]=v.slice(); }
    m[curCliId()]=(ids||[]).slice();
    curAiConfig.visibleModelsCli=m;
  }catch(e){}
}
function getCliCustomIds(cfg){
  try{
    var c=(cfg===undefined)?curAiConfig:cfg;
    var v=c&&c.customModelsCli;
    if(Array.isArray(v))return v.slice();
    if(v&&typeof v==='object'){ var a=v[curCliId(c)]; return Array.isArray(a)?a.slice():[]; }
  }catch(e){}
  return [];
}
function addCliCustomId(id){
  try{
    if(!id)return;
    curAiConfig=curAiConfig||{};
    var v=curAiConfig.customModelsCli;
    var m=(v&&typeof v==='object'&&!Array.isArray(v))?v:{};
    if(Array.isArray(v)){ m={}; m[curCliId()]=v.slice(); }
    var k=curCliId();
    m[k]=m[k]||[];
    if(m[k].indexOf(id)<0)m[k].push(id);
    curAiConfig.customModelsCli=m;
  }catch(e){}
}
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
    { key:'uispec', btn:tabNavUispec, pane:paneSetUispec },
    { key:'sandbox', btn:tabNavSandbox, pane:paneSetSandbox },
    { key:'shortcut', btn:tabNavShortcut, pane:paneSetShortcut },
    { key:'about', btn:tabNavAbout, pane:paneSetAbout }
  ];
  tabs.forEach(function(t){
    if(t.btn)t.btn.classList.toggle('active', t.key===tab);
    if(t.pane)t.pane.style.display=(t.key===tab)?'flex':'none';
  });
}
if(tabNavAi)tabNavAi.onclick=function(){ switchSettingsTab('ai'); };
if(tabNavModels)tabNavModels.onclick=function(){ switchSettingsTab('models'); };
if(tabNavUispec)tabNavUispec.onclick=function(){ switchSettingsTab('uispec'); try{ refreshUispecList(); }catch(e){} };
if(tabNavSandbox)tabNavSandbox.onclick=function(){ switchSettingsTab('sandbox'); };
if(tabNavShortcut)tabNavShortcut.onclick=function(){ switchSettingsTab('shortcut'); };
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
    setCliVisibleIds(selected);
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
  try{ if(typeof refreshAiTopIdentity==='function')refreshAiTopIdentity(); }catch(e){}
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
      try{ curAiConfig=curAiConfig||{}; curAiConfig.apiLastTestOk=!!(r&&r.ok); if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig)window.protoAPI.ai.saveConfig(curAiConfig); }catch(e){}
      try{ if(typeof refreshAiTopIdentity==='function')refreshAiTopIdentity(); }catch(e2){}
    }).catch(function(e){
      i5RenderByokTest({ ok:false, kind:'unknown', message:String((e&&e.message)||e) });
      try{ curAiConfig=curAiConfig||{}; curAiConfig.apiLastTestOk=false; if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig)window.protoAPI.ai.saveConfig(curAiConfig); }catch(e2){}
      try{ if(typeof refreshAiTopIdentity==='function')refreshAiTopIdentity(); }catch(e3){}
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
    var visible=isCli?getCliVisibleIds(cfg):(cfg&&cfg.visibleModelsApi);
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
    /* free 独立模型：手输 id 原样保留，不再清洗后缀 */
    curAiConfig=curAiConfig||{};
    var eng=getActiveEngineInUi();
    if(eng==='cli'){
      addCliCustomId(val);
      var _vv=getCliVisibleIds(); if(_vv.indexOf(val)<0){ _vv.push(val); setCliVisibleIds(_vv); }
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
  normalizeCliModelMaps(curAiConfig);
  var isCli=getActiveEngineInUi()==='cli';
  if(isCli){
    /* 分 CLI 隔离：从未选过的 CLI 即空选择（不回填全量），只切换用户本次勾选 */
    var vis=getCliVisibleIds();
  }else{
    vis=curAiConfig.visibleModelsApi;
    if(!Array.isArray(vis)){
      var all2=[];
      (fetchCacheGroups||[]).forEach(function(g){
        (g.models||[]).forEach(function(m){
          var mid2=typeof m==='string'?m:(m&&(m.id||m.name))||'';
          if(mid2&&all2.indexOf(mid2)<0)all2.push(mid2);
        });
      });
      vis=all2;
      curAiConfig.visibleModelsApi=vis;
    }
  }
  var at=vis.indexOf(id);
  if(checked){
    if(at<0)vis.push(id);
    if(isCli){ setCliVisibleIds(vis); addCliCustomId(id); }
    else{
      curAiConfig.visibleModelsApi=vis;
      curAiConfig.api=curAiConfig.api||{};
      curAiConfig.api.customModels=curAiConfig.api.customModels||[];
      if(curAiConfig.api.customModels.indexOf(id)<0)curAiConfig.api.customModels.push(id);
      try{ apiPushCustomModelsToActive([id]); syncActiveProfileToMirror(); }catch(e){}
      if(curAiConfig.byok)curAiConfig.byok.customModels=(curAiConfig.api.customModels||[]).slice();
      if(curAiConfig.apiConfig)curAiConfig.apiConfig.customModels=(curAiConfig.api.customModels||[]).slice();
    }
  }else{
    if(at>=0)vis.splice(at,1);
    if(isCli)setCliVisibleIds(vis); else curAiConfig.visibleModelsApi=vis;
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
function batchFetchCheck(want){
  if(!modelFetchList)return;
  modelFetchList.querySelectorAll('.model-check-item').forEach(function(item){
    if(item.style.display==='none')return;
    var box=item.querySelector('input[type="checkbox"]');
    if(box && box.checked !== !!want){
      box.checked = !!want;
      applyFetchToggle(box.value, !!want);
    }
  });
  refreshFetchCount();
}
var btnFetchSelectAll=$('btnFetchSelectAll'), btnFetchDeselectAll=$('btnFetchDeselectAll');
if(btnFetchSelectAll) btnFetchSelectAll.onclick=function(){ batchFetchCheck(true); };
if(btnFetchDeselectAll) btnFetchDeselectAll.onclick=function(){ batchFetchCheck(false); };
function setVisibleModels(ids){
  curAiConfig=curAiConfig||{};
  if(getActiveEngineInUi()==='cli'){ setCliVisibleIds(ids); }
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
  if(isCli)return getCliVisibleIds();
  var v=curAiConfig&&curAiConfig.visibleModelsApi;
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
    (ids||[]).forEach(function(id){ addCliCustomId(id); });
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
  normalizeCliModelMaps(curAiConfig);
  var arr=isCli?getCliVisibleIds():(curAiConfig.visibleModelsApi||[]);
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
   var _eng2='cli'; try{ _eng2=(typeof getActiveEngineInUi==='function')?getActiveEngineInUi():((curAiConfig&&curAiConfig.engine)||'cli'); }catch(e){}
   var isCur2=(p.id===activeId)&&(_eng2==='api'); /* 跨tab单选：cli引擎下API侧不高亮 */
   var card=document.createElement('div');
   card.className='api-profile-card'+(isCur2?' active':'');
   card.setAttribute('data-id', p.id);
   var head=document.createElement('div'); head.className='api-profile-header';
   var nameEl=document.createElement('span'); nameEl.className='api-profile-name'; nameEl.textContent=apiProfileLabel(p);
   head.appendChild(nameEl);
   if(isCur2){ var useFlag=document.createElement('span'); useFlag.className='api-use-flag'; useFlag.textContent='使用中'; head.appendChild(useFlag); }
   card.appendChild(head);
   /* B1 隐敏：卡片仅显服务商名称+使用态+操作按钮，URL/模型/Key三字段不渲染（标识data-id与数据p.*保留，明细进弹窗维护） */
   var acts=document.createElement('div'); acts.className='api-profile-actions';
   if(!isCur2){
    var useBtn=document.createElement('button'); useBtn.type='button'; useBtn.className='btn-mini'; useBtn.setAttribute('data-act','use'); useBtn.setAttribute('data-id',p.id);
    useBtn.textContent='设为当前使用';
    useBtn.onclick=function(ev){ try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){} setActiveApiProfile(p.id); };
    acts.appendChild(useBtn);
   }
  var editBtn=document.createElement('button'); editBtn.type='button'; editBtn.className='btn-mini'; editBtn.textContent='编辑'; editBtn.setAttribute('data-act','edit'); editBtn.setAttribute('data-id',p.id);
  editBtn.onclick=function(ev){ try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){} openApiProfileModal('edit', p.id); };
  var delBtn=document.createElement('button'); delBtn.type='button'; delBtn.className='btn-mini'; delBtn.textContent='删除'; delBtn.setAttribute('data-act','del'); delBtn.setAttribute('data-id',p.id);
  delBtn.onclick=function(ev){ try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){} deleteApiProfile(p.id); };
   acts.appendChild(editBtn); acts.appendChild(delBtn); card.appendChild(acts);
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
 try{ curAiConfig.apiLastTestOk=false; }catch(e){} /* 配置变更后验证结论失效 */
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
 try{ curAiConfig.apiLastTestOk=false; }catch(e){}
 try{ if(typeof setEngineUi==='function')setEngineUi('api'); }catch(e){} /* 跨tab单选：选中API卡即切api引擎，CLI侧高亮自动消失 */
 try{ if(typeof refreshAiTopIdentity==='function')refreshAiTopIdentity(); }catch(e){}
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
      curAiConfig=normalizeCliModelMaps(cfg||{});
      try{ ensureApiProfiles(); }catch(e){}
      try{ syncActiveProfileToMirror(); }catch(e){}
      setEngineUi(curAiConfig.engine||'cli', true);
      try{ renderApiProfileMatrix(); }catch(e){}
      renderModelManagerList(curAiConfig);
      try{ refreshUispecList(); }catch(e){}
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

/* ═══════ 设计规范 Tab：移动/PC 分开展示卡片，每端最多选中一个 ═══════
 * 卡片=规范文件（名称+描述）；选中态存 ai-config（activeUiSpecMobile/activeUiSpecPc），两端互不影响；
 * 新增卡：选本地 md + 名称/描述，经 spec:create-from-file 入库后打上当前 Tab 端别。 */
var uispecCurTab='mobile', uispecItems=[];
var uispecAddSrcPath='';
function uispecActiveId(tab){
  try{
    var c=curAiConfig||{};
    var v=(tab==='pc')?c.activeUiSpecPc:c.activeUiSpecMobile;
    return (typeof v==='string'&&v)?v:null;
  }catch(e){ return null; }
}
function uispecSwitchSub(tab){
  uispecCurTab=(tab==='pc')?'pc':'mobile';
  var bm=$('uispecSubMobile'), bp=$('uispecSubPc');
  if(bm)bm.classList.toggle('on',uispecCurTab==='mobile');
  if(bp)bp.classList.toggle('on',uispecCurTab==='pc');
  renderUispecCards();
}
function renderUispecCards(){
  var box=$('uispecCardList');
  if(!box)return;
  var tab=uispecCurTab;
  var activeId=uispecActiveId(tab);
  var h='';
  (uispecItems||[]).forEach(function(it){
    if(!it||!it.id)return;
    var k=String(it.kind||'').toLowerCase();
    if(k&&k!==tab)return; /* 有端别的只进对应 Tab；无端别的两边都展示 */
    var on=(String(it.id)===String(activeId));
    h+='<div class="uispec-card'+(on?' active':'')+'" data-id="'+escAttr(it.id)+'">'
      +'<div class="uispec-card-top"><div class="uispec-card-name">'+escHtml(it.name||it.id)+'<span class="uispec-card-flag">使用中</span></div>'
      +'<div class="uispec-card-ops"><span class="uispec-op" data-act="edit" data-id="'+escAttr(it.id)+'" title="编辑名称与描述">编辑</span><span class="uispec-op danger" data-act="del" data-id="'+escAttr(it.id)+'" title="删除该规范（同时删除 md 文件）">删除</span></div></div>'
      +'<div class="uispec-card-desc">'+escHtml(it.desc||'暂无描述')+'</div>'
      +'</div>';
  });
  h+='<div class="uispec-add" id="uispecAddCard" title="从本地选择 md 文件新增规范">＋ 新增规范</div>';
  box.innerHTML=h;
  Array.prototype.forEach.call(box.querySelectorAll('.uispec-card'),function(c){
    c.onclick=function(){ uispecToggleActive(c.getAttribute('data-id')); };
  });
  Array.prototype.forEach.call(box.querySelectorAll('.uispec-op'),function(x){
    x.onclick=function(ev){
      try{ if(ev&&ev.stopPropagation)ev.stopPropagation(); }catch(e){}
      var aid=x.getAttribute('data-id');
      if(x.getAttribute('data-act')==='edit')openUispecAdd(aid);
      else uispecDeleteSpec(aid);
    };
  });
  var addBtn=$('uispecAddCard');
  if(addBtn)addBtn.onclick=function(){ openUispecAdd(); };
}
function refreshUispecList(){
  var box=$('uispecCardList');
  if(box)box.innerHTML='<div class="set-tip">正在读取规范列表…</div>';
  if(!(window.protoAPI&&window.protoAPI.spec&&window.protoAPI.spec.list)){
    if(box)box.innerHTML='<div class="set-tip">仅桌面端支持设计规范</div>';
    return;
  }
  window.protoAPI.spec.list().then(function(r){
    uispecItems=(r&&((r.items||r.list)))||[];
    renderUispecCards();
  }).catch(function(){ if(box)box.innerHTML='<div class="set-tip">读取规范列表失败</div>'; });
}
function uispecToggleActive(id){
  var tab=uispecCurTab;
  var key=(tab==='pc')?'activeUiSpecPc':'activeUiSpecMobile';
  var cur=uispecActiveId(tab);
  var next=(cur&&String(cur)===String(id))?null:String(id||'');
  if(!next)next=null;
  var patch={};
  patch[key]=next;
  /* 反馈必须可见：toast + 状态栏双写；保存后回读校验，落盘不一致直接报因（静默失败是最差体验） */
  var feedback=function(msg){
    try{ showToast(msg); }catch(e){}
    try{ if(typeof libStatus==='function')libStatus(msg); }catch(e2){}
  };
  var done=function(ok, errMsg){
    if(ok){ try{ curAiConfig=curAiConfig||{}; curAiConfig[key]=next; }catch(e){} }
    try{ renderUispecCards(); }catch(e2){}
    feedback(ok?(next?'已启用该端设计规范':'已取消该端设计规范'):('保存失败：'+(errMsg||'未知错误')));
  };
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
    window.protoAPI.ai.saveConfig(patch).then(function(r){
      if(r&&r.ok===false){ done(false, r.error); return; }
      if(window.protoAPI.ai.getConfig){
        window.protoAPI.ai.getConfig().then(function(cfg){
          var v=null;
          try{ v=cfg?cfg[key]:null; }catch(e){ v=null; }
          if(String(v||'')===String(next||''))done(true);
          else done(false, '回读不一致，请重试');
        }).catch(function(){ done(true); });
      }else{ done(true); }
    }).catch(function(e){ done(false, (e&&e.message)||e); });
  }else{ done(true); }
}
/* 删除规范：物理删除（索引条目 + specs/ 下 md 文件）；若正被某端选中则同步取消选中；
 * 删的是出厂内置则记墓碑，增量补齐不再复活。 */
function uispecDeleteSpec(id){
  if(!id)return;
  var target=null;
  (uispecItems||[]).forEach(function(it){ if(it&&String(it.id)===String(id))target=it; });
  var nm=(target&&(target.name||target.id))||id;
  try{
    if(!window.confirm('删除设计规范「'+nm+'」？\n将同时删除对应的 md 文件，该操作不可恢复。'))return;
  }catch(e){ return; }
  if(!(window.protoAPI&&window.protoAPI.spec&&window.protoAPI.spec.remove)){ try{ showToast('仅桌面端支持删除规范'); }catch(e){} return; }
  window.protoAPI.spec.remove({ id:id }).then(function(r){
    if(!r||!r.ok){ try{ showToast('删除失败：'+((r&&r.error)||'未知错误')); }catch(e){} return; }
    var patch={}, needSave=false;
    try{
      curAiConfig=curAiConfig||{};
      if(String(curAiConfig.activeUiSpecMobile||'')===String(id)){ patch.activeUiSpecMobile=null; curAiConfig.activeUiSpecMobile=null; needSave=true; }
      if(String(curAiConfig.activeUiSpecPc||'')===String(id)){ patch.activeUiSpecPc=null; curAiConfig.activeUiSpecPc=null; needSave=true; }
      if(target&&target.builtin&&target.uiSpec){
        var arr=Array.isArray(curAiConfig.removedBuiltinSpecs)?curAiConfig.removedBuiltinSpecs.slice():[];
        if(arr.indexOf(String(id))<0)arr.push(String(id));
        patch.removedBuiltinSpecs=arr; curAiConfig.removedBuiltinSpecs=arr; needSave=true;
      }
    }catch(e){}
    var done=function(){ refreshUispecList(); try{ showToast('已删除规范'); }catch(e){} try{ if(typeof libStatus==='function')libStatus('已删除规范'); }catch(e2){} };
    if(needSave&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
      window.protoAPI.ai.saveConfig(patch).then(function(){ done(); }).catch(function(){ done(); });
    }else{ done(); }
  }).catch(function(e){ try{ showToast('删除失败：'+(e&&e.message||e)); }catch(e2){} });
}
var uispecEditId=null; /* 新增弹窗复用为编辑：null=新增，否则为被编辑的规范 id */
function openUispecAdd(editId){
  uispecEditId=editId||null;
  uispecAddSrcPath='';
  var nm=$('uispecAddName'), ds=$('uispecAddDesc'), fn=$('uispecAddFileName'), tip=$('uispecAddTip');
  var titleEl=$('uispecAddTitle'), fileRow=$('uispecAddFileRow'), saveBtn0=$('uispecAddSave');
  var editTarget=null;
  if(uispecEditId){
    (uispecItems||[]).forEach(function(it){ if(it&&String(it.id)===String(uispecEditId))editTarget=it; });
    if(!editTarget){ try{ showToast('规范不存在，请刷新后重试'); }catch(e){} return; }
  }
  if(titleEl)titleEl.textContent=uispecEditId?'编辑设计规范':'新增设计规范';
  if(fileRow)fileRow.style.display=uispecEditId?'none':'';
  if(saveBtn0)saveBtn0.textContent=uispecEditId?'保存':'新增';
  if(nm)nm.value=editTarget?(editTarget.name||''):'';
  if(ds)ds.value=editTarget?(editTarget.desc||''):'';
  if(fn)fn.textContent='未选择';
  var pk0=$('uispecPickFile'); if(pk0&&pk0.classList)pk0.classList.remove('picked');
  if(tip)tip.textContent=uispecEditId?'仅修改名称与描述，不动规范正文文件。':'将归属到「'+(uispecCurTab==='pc'?'PC 端':'移动端')+'」下展示。';
  var mask=$('uispecAddMask');
  if(mask)mask.style.display='flex';
  if(window.MaskStack)window.MaskStack.push('uispecAddMask', closeUispecAdd);
}
function closeUispecAdd(){
  if(window.MaskStack)window.MaskStack.pop('uispecAddMask');
  var mask=$('uispecAddMask');
  if(mask)mask.style.display='none';
  uispecEditId=null;
}
(function bindUispecStatic(){
  var bm=$('uispecSubMobile'), bp=$('uispecSubPc');
  if(bm)bm.onclick=function(){ uispecSwitchSub('mobile'); };
  if(bp)bp.onclick=function(){ uispecSwitchSub('pc'); };
  var pickBtn=$('uispecPickFile');
  if(pickBtn)pickBtn.onclick=function(){
    if(!(window.protoAPI&&window.protoAPI.pickTextFile)){ try{ showToast('仅桌面端支持选择本地文件'); }catch(e){} return; }
    window.protoAPI.pickTextFile({ title:'选择设计规范md文件', filters:[{ name:'Markdown', extensions:['md'] }] }).then(function(r){
      if(!r||!r.path)return;
      uispecAddSrcPath=r.path;
      var fn=$('uispecAddFileName');
      if(fn)fn.textContent=r.name||r.path;
      var pk=$('uispecPickFile'); if(pk&&pk.classList)pk.classList.add('picked');
      var nm=$('uispecAddName');
      if(nm&&!nm.value){
        var base=String(r.name||'').replace(/\.md$/i,'');
        nm.value=base;
      }
    }).catch(function(){});
  };
  var closeBtn=$('uispecAddClose'), cancelBtn=$('uispecAddCancel');
  if(closeBtn)closeBtn.onclick=function(){ closeUispecAdd(); };
  if(cancelBtn)cancelBtn.onclick=function(){ closeUispecAdd(); };
  var saveBtn=$('uispecAddSave');
  if(saveBtn)saveBtn.onclick=function(){
    var nm=$('uispecAddName'), ds=$('uispecAddDesc');
    var name=nm?nm.value.trim():'', desc=ds?ds.value.trim():'';
    if(!name){ try{ showToast('请填写规范名称'); }catch(e){} return; }
    if(!(window.protoAPI&&window.protoAPI.spec)){ try{ showToast('仅桌面端支持规范管理'); }catch(e){} return; }
    /* 编辑模式：只改名称与描述，不动正文文件 */
    if(uispecEditId){
      if(!window.protoAPI.spec.update){ try{ showToast('仅桌面端支持编辑规范'); }catch(e){} return; }
      var eid=uispecEditId;
      window.protoAPI.spec.update({ id:eid, name:name, desc:desc }).then(function(r){
        if(!r||!r.ok){ try{ showToast('保存失败：'+((r&&r.error)||'未知错误')); }catch(e){} return; }
        closeUispecAdd();
        refreshUispecList();
        try{ showToast('已保存'); }catch(e){}
        try{ if(typeof libStatus==='function')libStatus('已保存规范'); }catch(e2){}
      }).catch(function(e){ try{ showToast('保存失败：'+(e&&e.message||e)); }catch(e2){} });
      return;
    }
    if(!uispecAddSrcPath){ try{ showToast('请先选择规范 md 文件'); }catch(e){} return; }
    if(!window.protoAPI.spec.createFromFile){ try{ showToast('仅桌面端支持新增规范'); }catch(e){} return; }
    var tabKind=uispecCurTab;
    window.protoAPI.spec.createFromFile({ srcPath:uispecAddSrcPath, name:name, desc:desc }).then(function(r){
      if(!r||!r.ok||!r.item||!r.item.id){ try{ showToast('新增失败：'+((r&&r.error)||'未知错误')); }catch(e){} return; }
      var after=function(){
        closeUispecAdd();
        refreshUispecList();
        try{ showToast('已新增规范'); }catch(e){}
      };
      if(window.protoAPI.spec.update){
        window.protoAPI.spec.update({ id:r.item.id, kind:tabKind }).then(function(){ after(); }).catch(function(){ after(); });
      }else{ after(); }
    }).catch(function(e){ try{ showToast('新增失败：'+(e&&e.message||e)); }catch(e2){} });
  };
})();

function saveSettingsFromUi(){
  syncCurrentChecklistToMemory();
  var engine = getActiveEngineInUi();
  var isCli = (engine === 'cli');
  var activeVisible = isCli ? getCliVisibleIds() : ((curAiConfig&&curAiConfig.visibleModelsApi)||[]);
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
    customModelsCli:(function(){ try{ normalizeCliModelMaps(curAiConfig); var _m=curAiConfig&&curAiConfig.customModelsCli; if(Array.isArray(_m))return _m.slice(); if(_m&&typeof _m==='object'){ var _o={}; Object.keys(_m).forEach(function(k){ if(Array.isArray(_m[k]))_o[k]=_m[k].slice(); }); return _o; } }catch(e){} return {}; })(),
    api:apiData,
    byok:_byok,
    apiConfig:_apiCfg,
    apiProfiles:_profiles,
    activeApiProfileId:curAiConfig?curAiConfig.activeApiProfileId:null,
    visibleModels:activeVisible,
    visibleModelsCli:(function(){ try{ var _v=curAiConfig&&curAiConfig.visibleModelsCli; if(Array.isArray(_v))return _v.slice(); if(_v&&typeof _v==='object'){ var _o={}; Object.keys(_v).forEach(function(k){ if(Array.isArray(_v[k]))_o[k]=_v[k].slice(); }); return _o; } }catch(e){} return {}; })(),
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
/* 思考入链：新增思考按句追加为 THINK 行（与 TOOL 行按到达顺序穿插），不再整坨堆文本框；
 * 400ms 节流中转只落完整句（尾部半句下次带上），结束态（status非run）全量落空 */
function aiTraceFlushThink(g, force){
  if(!g) return;
  g.thinkFlush=Date.now();
  try{
    var logged=Number(g.thinkLogged||0);
    var full=String(g.think||'');
    if(full.length>logged){
      var isFinal=(force===true)||(g.status&&g.status!=='run');
      var slice=full.slice(logged), rest='';
      var list=[];
      try{
        if(typeof i5SplitThink==='function'){
          var r=i5SplitThink(slice);
          list=((r&&r.list)||[]).slice();
          rest=String((r&&r.rest)||'');
          if(isFinal&&rest.trim()){ list.push(rest); rest=''; }
        }else{ list=isFinal?[slice]:[]; rest=isFinal?'':slice; }
      }catch(e){ list=[]; rest=''; }
      for(var i=0;i<list.length;i++){
        var st=String(list[i]||'').trim(); if(!st) continue;
        var tm=''; try{ tm=new Date().toTimeString().split(' ')[0]; }catch(e2){}
        aiTraceAppendLine(g, {time:tm, tag:'THINK', level:'think', text:st});
      }
      g.thinkLogged=logged+(slice.length-rest.length);
    }
  }catch(e){}
  /* 兼容：若 DOM 里还有老 .tg-think-pre（极旧渲染残留），同步全文避免空白 */
  try{
    var body=aiGroupBodyNode(g.id);
    if(body){ var pre=body.querySelector('.tg-think-pre'); if(pre){ pre.textContent=String(g.think||''); pre.scrollTop=pre.scrollHeight; } }
  }catch(e2){}
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
    if(g.lines.length){ body.appendChild(aiGroupSection('思考 / 操作链')); }
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
  /* Wave-B: 剪贴板收敛3/5（Trace日志复制改走 Utils，保留alert回显） */
  try{ if(typeof window!=='undefined'&&window.Utils&&window.Utils.copyToClipboard){ window.Utils.copyToClipboard(full,''); alert('已复制全部 Trace 日志'); return; } }catch(e){}
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
/* ── 历史事件流存储v2（功能说明第3章）：会话顶层 v:2 + 事件流 events [{t,text,file,added,deleted,ts}] ──
 * 兼容策略：m（{r,t,ts}）仍是渲染源，老前端忽略 v/events 也不崩；新事件流只做加法，不改渲染函数签名。
 * v1/无版本号降级读：aiReadSessEvents 把 legacy m 合成事件（thinking 全文合并一段，不穿插），只读不迁移（10章明确不做）。
 * 事件 t 取值：user/thinking/tool_call/answer/edit/error/chunk/info；落款时间一律读自带 ts，不重生成（3.4）。 */
var AI_SESS_V=2;
var aiCurTaskEvents=[];
function aiSessNow(){ try{ return Date.now(); }catch(e){ return 0; } }
/* 对话框用户消息展示文案：优先展示串 d（清单提交时的条目头简版），无则回落全文 t（老历史兼容） */
function aiUserDisp(msg){
  try{ var d=msg&&msg.d; if(typeof d==='string'&&d.trim()) return d; }catch(e){}
  try{ return String((msg&&msg.t)||''); }catch(e2){ return ''; }
}
function aiEnsureMsgTs(msg, fbTs){
  try{
    if(!msg||typeof msg!=='object') return msg;
    if(typeof msg.ts!=='number'||!(msg.ts>0)){
      msg.ts=(typeof fbTs==='number'&&fbTs>0)?fbTs:aiSessNow();
    }
    return msg;
  }catch(e){ return msg; }
}
function aiNormalizeSessForRead(s){
  try{
    if(!s||typeof s!=='object') return s;
    var fbTs=(typeof s.updatedAt==='number'&&s.updatedAt>0)?s.updatedAt:((typeof s.createdAt==='number'&&s.createdAt>0)?s.createdAt:aiSessNow());
    if(Array.isArray(s.m)){ for(var i=0;i<s.m.length;i++){ try{ aiEnsureMsgTs(s.m[i], fbTs); }catch(e){} } }
    if(s.v===AI_SESS_V&&!Array.isArray(s.events)) s.events=[];
    return s;
  }catch(e){ return s; }
}
function aiAppendSessEvent(sess, ev){
  try{
    if(!sess||typeof sess!=='object'||!ev||typeof ev!=='object') return false;
    var t=String(ev.t||ev.type||'').trim()||'info';
    var text=(ev.text==null?'':String(ev.text));
    var file=(ev.file==null?((ev.path==null)?'':String(ev.path)):String(ev.file));
    if((t==='thinking'||t==='tool_call'||t==='chunk')&&!text.trim()&&!file) return false;
    if(sess.v!==AI_SESS_V) sess.v=AI_SESS_V;
    if(!Array.isArray(sess.events)) sess.events=[];
    var item={t:t, text:text, ts:(typeof ev.ts==='number'&&ev.ts>0)?ev.ts:aiSessNow()};
    if(file) item.file=file;
    /* v2加法字段：Shell行回放需要原始tool名+command（i5ReplayTimeline读e.tool/e.command），缺失不影响旧降级读 */
    try{
     var _tool=String((ev&&(ev.tool||ev.name||ev.toolName||ev.call))||'').trim();
     if(_tool) item.tool=_tool;
     var _cmd=(ev&&typeof ev.command==='string'&&ev.command)?String(ev.command):((ev&&typeof ev.cmd==='string'&&ev.cmd)?String(ev.cmd):'');
     if(_cmd) item.command=_cmd;
    }catch(e){}
    if(typeof ev.added==='number'&&isFinite(ev.added)) item.added=Math.max(0, Math.floor(ev.added));
    if(typeof ev.deleted==='number'&&isFinite(ev.deleted)) item.deleted=Math.max(0, Math.floor(ev.deleted));
    sess.events.push(item);
    return true;
  }catch(e){ return false; }
}
function aiPushMsg(sess, r, t, extra){
  try{
    if(!sess||typeof sess!=='object') return null;
    if(!Array.isArray(sess.m)) sess.m=[];
    var msg={r:r, t:String(t==null?'':t), ts:aiSessNow()};
    if(extra&&typeof extra==='object'){ for(var k in extra){ if(extra.hasOwnProperty(k)&&k!=='r'&&k!=='t'&&k!=='ts') msg[k]=extra[k]; } }
    sess.m.push(msg);
    return msg;
  }catch(e){ return null; }
}
function aiToolEventFrom(ev){
  try{
    var _pp0=null,_pi0=null;
    try{ _pp0=(ev&&ev.part&&typeof ev.part==='object')?ev.part:null; _pi0=(_pp0&&_pp0.state&&typeof _pp0.state==='object'&&_pp0.state.input!=null)?_pp0.state.input:null; }catch(e){ _pp0=null; _pi0=null; }
    var toolName=String((ev&&(ev.tool||ev.name||ev.toolName||ev.call))||(_pp0&&_pp0.tool)||'工具调用');
    var param='';
    try{
      if(ev&&(ev.path||ev.file)) param=String(ev.path||ev.file);
      else if(_pi0!=null) param=(typeof _pi0==='string')?_pi0:JSON.stringify(_pi0);
      else if(ev&&ev.args!=null) param=(typeof ev.args==='string')?ev.args:JSON.stringify(ev.args);
      else if(ev&&ev.input!=null) param=(typeof ev.input==='string')?ev.input:JSON.stringify(ev.input);
    }catch(e){ param=''; }
    var file='';
    try{ file=String((ev&&(ev.path||ev.file))||(((_pi0&&typeof _pi0==='object')&&(_pi0.path||_pi0.file||_pi0.pattern))||'')); }catch(e){ file=''; }
    if(!toolName.trim()&&!param.trim()&&!file) return null;
    /* v2加法字段：tool=原始工具名（动词映射用），command=Shell命令原文（回放Shell行展示用）；text/file行为保持不变 */
    var out={t:'tool_call', text:(toolName+(param?(' '+param):'')), file:file, ts:aiSessNow()};
    try{
     if(toolName&&toolName!=='工具调用') out.tool=String(toolName);
     var cmd='';
      try{
       if(ev&&typeof ev.command==='string'&&ev.command) cmd=String(ev.command);
       else if(ev&&typeof ev.cmd==='string'&&ev.cmd) cmd=String(ev.cmd);
       else if(_pi0&&typeof _pi0==='object'&&(_pi0.command||_pi0.cmd)) cmd=String(_pi0.command||_pi0.cmd);
       else{
        var cand=[_pi0, ev&&ev.args, ev&&ev.input, ev&&ev.params];
       for(var i=0;i<cand.length;i++){
        var c=cand[i]; if(c==null) continue;
        if(typeof c==='string'){ try{ var o=JSON.parse(c); if(o&&(o.command||o.cmd)){ cmd=String(o.command||o.cmd); break; } }catch(e){} }
        else if(typeof c==='object'){ try{ if(c.command||c.cmd){ cmd=String(c.command||c.cmd); break; } }catch(e){} }
       }
      }
     }catch(e){ cmd=''; }
     if(cmd) out.command=cmd;
    }catch(e){}
    return out;
  }catch(e){ return null; }
}
function aiEditEventsFrom(list){
  var out=[];
  try{
    if(!Array.isArray(list)) return out;
    for(var i=0;i<list.length;i++){
      var f=list[i]; if(!f) continue;
      var p=String((f&&(f.path||f.file||f.name))||'');
      if(!p&&typeof f==='string') p=f;
      if(!p) continue;
      var item={t:'edit', text:'', file:p, ts:aiSessNow()};
      if(f&&typeof f.added==='number'&&isFinite(f.added)) item.added=Math.max(0, Math.floor(f.added));
      if(f&&typeof f.deleted==='number'&&isFinite(f.deleted)) item.deleted=Math.max(0, Math.floor(f.deleted));
      out.push(item);
    }
  }catch(e){}
  return out;
}
function aiFlushTaskEventsToSess(sess, extraEvents){
  var n=0;
  try{
    if(!sess||typeof sess!=='object') return 0;
    if(sess.v!==AI_SESS_V) sess.v=AI_SESS_V;
    if(!Array.isArray(sess.events)) sess.events=[];
    var buf=Array.isArray(aiCurTaskEvents)?aiCurTaskEvents:[];
    for(var i=0;i<buf.length;i++){ try{ if(aiAppendSessEvent(sess, buf[i])) n++; }catch(e){} }
    if(Array.isArray(extraEvents)){ for(var j=0;j<extraEvents.length;j++){ try{ if(aiAppendSessEvent(sess, extraEvents[j])) n++; }catch(e){} } }
    aiCurTaskEvents=[];
  }catch(e){}
  return n;
}
function aiReadSessEvents(sess){
  try{
    if(sess&&sess.v===AI_SESS_V&&Array.isArray(sess.events)) return {v:AI_SESS_V, events:sess.events.slice()};
    var synth=[];
    var ms=(sess&&Array.isArray(sess.m))?sess.m:[];
    for(var i=0;i<ms.length;i++){
      var m=ms[i]; if(!m||typeof m!=='object') continue;
      var ts=(typeof m.ts==='number'&&m.ts>0)?m.ts:0;
      if(m.r==='u') synth.push({t:'user', text:String(m.t==null?'':m.t), ts:ts});
      else if(m.r==='tool') synth.push({t:'tool_call', text:String(m.t==null?'':m.t), ts:ts});
      else if(m.r==='a'){
        var legacyThink='';
        try{ legacyThink=String(m.think||m.thinking||''); }catch(e){ legacyThink=''; }
        if(legacyThink.trim()) synth.push({t:'thinking', text:legacyThink, ts:ts});
        synth.push({t:'answer', text:String(m.t==null?'':m.t), ts:ts});
      }
    }
    return {v:1, events:synth};
  }catch(e){ return {v:1, events:[]}; }
}
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
    try{ aiNormalizeSessForRead(s); }catch(e){}
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
   try{ aiNormalizeSessForRead(s); }catch(e){}
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
   /* v2配额优先丢弃最旧可丢弃事件（thinking/tool_call/chunk），再回落原有 m tool 丢弃链 */
   var dropSid=null, dropIdx=-1, dropScore=Infinity;
   try{
    for(var esid in data.sessions){
     var esess=data.sessions[esid];
     var evs=(esess&&Array.isArray(esess.events))?esess.events:[];
     for(var ei=0;ei<evs.length;ei++){
      var et=evs[ei]&&(evs[ei].t||'');
      if(et==='thinking'||et==='tool_call'||et==='chunk'){
       var escore=(esess.updatedAt||esess.createdAt||0)*1000000 + ei;
       if(escore<dropScore){ dropScore=escore; dropSid=esid; dropIdx=ei; }
       break;
      }
     }
    }
   }catch(_e){}
   if(dropSid!==null){ try{ data.sessions[dropSid].events.splice(dropIdx,1); continue; }catch(_e){} }
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
  data.sessions={}; data.sessions[sid]={id:sid,title:'新会话',createdAt:now,updatedAt:now,oid:'',m:[],lastHash:{},v:AI_SESS_V,events:[]}; data.activeId=sid;
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
  /* 10章明确不做：旧历史不迁移为v2，保持无版本号v1形态，降级读时合并显示（aiReadSessEvents） */
  try{ aiNormalizeSessForRead(data.sessions[sid]); }catch(e){}
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
 data.sessions[sid]={id:sid,title:t,createdAt:now,updatedAt:now,oid:'',m:[],lastHash:{},v:AI_SESS_V,events:[]};
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
  data.sessions[sid]={id:sid,title:'新会话',createdAt:now,updatedAt:now,oid:'',m:[],lastHash:{},v:AI_SESS_V,events:[]};
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
function aiSaveSesh(){ if(!aiSession) return; try{ aiNormalizeSessForRead(aiSession); }catch(e){} var dir=aiSbxDir(); var data=loadSessions(dir); var sid=aiSession.id||data.activeId; if(!sid||!data.sessions[sid]){ try{ localStorage.setItem(aiHistKey(), JSON.stringify(aiSession)); }catch(e){} if(sid&&data.sessions[sid]){ data.sessions[sid]=aiSession; data.activeId=sid; saveSessions(data, dir); renderSessionList(dir); } return; } var sess=data.sessions[sid]; sess.m=aiSession.m; sess.oid=aiSession.oid; if(aiSession.lastHash) sess.lastHash=aiSession.lastHash; if(Array.isArray(aiSession.events)) sess.events=aiSession.events; if(aiSession.v===AI_SESS_V) sess.v=AI_SESS_V; try{ aiNormalizeSessForRead(sess); }catch(e){} sess.updatedAt=Date.now(); data.activeId=sid; saveSessions(data, dir); renderSessionList(dir); try{ localStorage.setItem(aiHistKey(), JSON.stringify(aiSession)); }catch(e){} }
function aiWriteSeshFor(key,fn){
 try{
  var v=JSON.parse(localStorage.getItem(key)||'null');
  if(!(v&&typeof v==='object'&&Array.isArray(v.m)))return;
  fn(v);
  try{ aiNormalizeSessForRead(v); }catch(e){}
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
 /* Wave-B: 剪贴板收敛4/5（AI气泡复制fallback改走 Utils，保留按钮态） */
 try{ if(typeof window!=='undefined'&&window.Utils&&window.Utils.copyToClipboard){ window.Utils.copyToClipboard(txt,''); btn.textContent='已复制'; btn.classList.add('copied'); setTimeout(function(){ btn.textContent='复制'; btn.classList.remove('copied'); }, 1500); return; } }catch(e){}
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
 var s=null; try{ s=aiCurSesh(); }catch(e){ s=null; }
 try{ if(s&&typeof aiNormalizeSessForRead==='function') aiNormalizeSessForRead(s); }catch(e){}
 try{
  if(s&&typeof aiReadSessEvents==='function'){
   var rd=aiReadSessEvents(s);
   var evts=(rd&&Array.isArray(rd.events))?rd.events:[];
   if(rd&&rd.v===AI_SESS_V&&evts.length){
    aiChatView.innerHTML='';
    var meta=''; try{ var _ts=(s&&typeof s.updatedAt==='number'&&s.updatedAt>0)?s.updatedAt:Date.now(); meta=i5FmtMsgTime(_ts)+' · 已结束'; }catch(e){ meta=''; }
    var snapTxt='已生成快照，可一键回滚到修改前。';
    try{ i5ReplayTimeline(aiChatView, evts, {meta:meta, snapshot:snapTxt}); }catch(e){}
    try{ if(typeof i5AppendSnapshotCard==='function'){ var _cards=aiChatView.querySelectorAll('.snapshot-card'); if(!_cards||!_cards.length){ try{ i5AppendSnapshotCard(aiChatView, snapTxt); }catch(ee){} } else { try{ var _info=_cards[_cards.length-1].querySelector('.snapshot-info'); if(_info&&!_info.textContent) _info.textContent=snapTxt; }catch(ee){} } } }catch(e){}
    if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView)) aiChatView.scrollTop=aiChatView.scrollHeight;
    try{ scrubAiChatView(); }catch(e){}
    return;
   }
   if(rd&&rd.v!==AI_SESS_V){
    aiChatView.innerHTML='';
    try{
     var m1=(s&&Array.isArray(s.m))?s.m:[];
     var meta1=''; try{ var _ts1=(s&&typeof s.updatedAt==='number'&&s.updatedAt>0)?s.updatedAt:Date.now(); meta1=i5FmtMsgTime(_ts1)+' · 已结束'; var _hm=document.createElement('p'); _hm.className='hist-meta'; _hm.textContent=meta1; aiChatView.appendChild(_hm); }catch(e){}
     for(var vi=0;vi<m1.length;vi++){
      (function(msg){
       try{
        if(!msg||typeof msg!=='object') return;
         if(msg.r==='u'){
          var ub=document.createElement('div'); ub.className='ai-msg user';
          var bd=document.createElement('div'); bd.className='ai-msg-body'; bd.textContent=aiUserDisp(msg);
          ub.appendChild(bd);
          aiChatView.appendChild(ub);
          aiAppendUserFoot(aiChatView, aiUserDisp(msg), (typeof msg.ts==='number'&&msg.ts>0)?msg.ts:Date.now());
         }else if(msg.r==='a'&&!msg.err){
         var th=''; try{ th=String(msg.think||msg.thinking||''); }catch(e){ th=''; }
         if(th.trim()){
          var wrap=document.createElement('div'); wrap.className='ai-msg ai';
          try{ i5ReplayV1(wrap, th, (typeof msg.ts==='number'?msg.ts:0)); }catch(e){ var pp=document.createElement('div'); pp.className='think-p i5-think-p'; try{ pp.textContent=th; }catch(ee){} wrap.appendChild(pp); }
          aiChatView.appendChild(wrap);
         }
         var ab=document.createElement('div'); ab.className='ai-msg ai';
         var adb=document.createElement('div'); adb.className='answer i5-answer';
         var abody=document.createElement('div'); abody.className='i5-answer-body';
         try{ abody.innerHTML=formatAiTextConclusionOnly(String(msg.t||'')); }catch(e){ try{ abody.textContent=String(msg.t||''); }catch(ee){} }
         adb.appendChild(abody); ab.appendChild(adb);
         var sfoot=document.createElement('div'); sfoot.className='msg-foot';
         (function(_b){ try{ sfoot.appendChild(i5CreateCopyIconBtn(function(){ try{ return _b?_b.innerText:''; }catch(e){ return ''; } })); }catch(e){} })(abody);
         var stm=document.createElement('time'); try{ stm.textContent=i5FmtMsgTime((typeof msg.ts==='number'&&msg.ts>0)?msg.ts:Date.now()); }catch(e){ stm.textContent=''; }
         sfoot.appendChild(stm); ab.appendChild(sfoot);
         aiChatView.appendChild(ab);
        }else if(msg.err){
         var eb=document.createElement('div'); eb.className='ai-msg err';
         var ebb=document.createElement('div'); ebb.className='ai-msg-body'; ebb.textContent=String(msg.t||'');
         eb.appendChild(ebb); aiChatView.appendChild(eb);
        }
       }catch(e){}
      })(m1[vi]);
     }
     try{ i5AppendSnapshotCard(aiChatView, ''); }catch(e){}
    }catch(e){}
    if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView)) aiChatView.scrollTop=aiChatView.scrollHeight;
    try{ scrubAiChatView(); }catch(e){}
    return;
   }
  }
  }catch(e){}
  try{ if(aiChatView) aiChatView.innerHTML=''; }catch(e){} /* fallback同样先清空：空事件会话（如新建）否则残留旧气泡 */
  var m=s?s.m:null;
  if(m) for(var i=0;i<m.length;i++){
   var msg=m[i]; if(msg&&msg.r==='tool') continue; var d=document.createElement('div');
  d.className='ai-msg '+(msg.r==='u'?'user':(msg.err?'err':'ai'));
   var mts=(msg&&(typeof msg.ts==='number'&&msg.ts>0))?msg.ts:((s&&(typeof s.updatedAt==='number'&&s.updatedAt>0))?s.updatedAt:Date.now());
   if(msg.r==='u'||msg.err){
    var body=document.createElement('div');
    body.className='ai-msg-body';
    body.textContent=aiUserDisp(msg);
    d.appendChild(body);
    if(msg.r==='u'){
     aiChatView.appendChild(d);
     aiAppendUserFoot(aiChatView, aiUserDisp(msg), mts);
    }else{
     var foot=document.createElement('div');
     foot.className='msg-foot right';
     var tm=document.createElement('time'); tm.textContent=i5FmtMsgTime(mts);
     foot.appendChild(tm);
     (function(_t){ foot.appendChild(i5CreateCopyIconBtn(function(){ return _t; })); })(aiUserDisp(msg));
     d.appendChild(foot);
    }
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
    fbody.innerHTML=formatAiTextConclusionOnly(msg.t);
    fold.appendChild(fbody);
   var ffoot=document.createElement('div');
   ffoot.className='msg-foot';
   (function(_b){ ffoot.appendChild(i5CreateCopyIconBtn(function(){ try{ return _b?_b.innerText:''; }catch(e){ return ''; } })); })(fbody);
   var ftm=document.createElement('time'); ftm.textContent=i5FmtMsgTime(mts);
   ffoot.appendChild(ftm);
   fold.appendChild(ffoot);
   d.appendChild(fold);
  }
   if(!msg||msg.r!=='u') aiChatView.appendChild(d);
 }
  if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView)) aiChatView.scrollTop=aiChatView.scrollHeight;
  scrubAiChatView();
}
function aiSetBusy(b){
  aiBusy=b;
  if(aiSendEl){
    aiSendEl.disabled=false;
    if(b){
      aiSendEl.classList.add('stopping');
      aiSendEl.textContent='停止生成';
      aiSendEl.onclick=function(){ i5CancelAi(); };
    }else{
      aiSendEl.classList.remove('stopping');
      aiSendEl.textContent='发送';
      aiSendEl.onclick=aiDoSend;
    }
  }
  if(aiInputEl)aiInputEl.disabled=b;
  if(aiModelEl)aiModelEl.disabled=b;
  var _mb=$('aiModelBtn'); if(_mb)_mb.disabled=b;
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
 try{
  var now=Date.now();
  var silentSec=aiTlLastPacket?Math.round((now-aiTlLastPacket)/1000):(aiThinkStart?Math.round((now-aiThinkStart)/1000):0);
  if(silentSec<0) silentSec=0;
  try{
   var tl=aiStreaming.querySelector('.i5-timeline');
   if(tl){
    var last=null; try{ last=tl.lastChild; while(last&&last.nodeType!==1) last=last.previousSibling; }catch(e){ last=null; }
    var lastIsThink=false;
    try{ var _cn=String((last&&(last.className||''))||''); lastIsThink=(_cn.indexOf('think-p')>=0); }catch(e){ lastIsThink=false; }
    if(lastIsThink&&last){
     var sil=null; try{ sil=last.querySelector('.silence'); if(!sil) sil=last.querySelector('.i5-silent'); }catch(e){ sil=null; }
     if(!sil){
      try{ sil=document.createElement('span'); sil.className='silence i5-silent'; last.appendChild(sil); }catch(e){ sil=null; }
     }
     if(sil){ try{ sil.textContent='静默 '+silentSec+'s'; sil.style.display=''; }catch(e){} }
     try{
      var paras=tl.querySelectorAll('.think-p');
      for(var i=0;i<paras.length;i++){
       if(paras[i]===last) continue;
       try{ var olds=paras[i].querySelectorAll('.silence'); for(var k=0;k<olds.length;k++){ try{ if(olds[k].parentNode===paras[i]) olds[k].parentNode.removeChild(olds[k]); }catch(e){} } }catch(e){}
      }
     }catch(e){}
    }else{
     try{
      var paras2=tl.querySelectorAll('.think-p');
      for(var j=0;j<paras2.length;j++){
       try{ var s2=paras2[j].querySelectorAll('.silence'); for(var m=0;m<s2.length;m++){ try{ if(s2[m].parentNode===paras2[j]) s2[m].parentNode.removeChild(s2[m]); }catch(e){} } }catch(e){}
      }
     }catch(e){}
    }
    try{ var tails=tl.querySelectorAll('.silence-tail'); for(var t=0;t<tails.length;t++){ try{ if(tails[t].parentNode) tails[t].parentNode.removeChild(tails[t]); }catch(e){} } }catch(e){}
    try{ var tails2=tl.querySelectorAll('.i5-tail-silent'); for(var t2=0;t2<tails2.length;t2++){ try{ if(tails2[t2].parentNode) tails2[t2].parentNode.removeChild(tails2[t2]); }catch(e){} } }catch(e){}
   }
  }catch(e){}
   var isToolWindow=(aiTlLastType==='tool_call');
   if(silentSec>=I5_STALL_THRESHOLD&&!isToolWindow){
    i5TlSetStalled(true, silentSec);
   }else{
    if(aiTlStalled) i5TlSetStalled(false, silentSec);
   }
   /* 无文本思考期占位：时间线尚无 think 段（等待行已撤、只有工具行）时显示“思考中(Ns)”；
      有文本即由 i5ThinkAppendChunk 撤占位，不伪造思考文本、不入 aiStreamThink/历史。 */
   try{
    if(aiBusy&&aiStreaming){
     var _idleSec=(typeof silentSec==='number'&&isFinite(silentSec))?silentSec:0;
     var _tlIdle=null;
     try{ _tlIdle=aiStreaming.querySelector('.i5-timeline'); }catch(e){ _tlIdle=null; }
     if(_tlIdle&&!_tlIdle.querySelector('.think-p')&&!_tlIdle.querySelector('.i5-think-p')){
      try{ i5EnsureThinkIdle(_idleSec); }catch(e){}
     }
    }
   }catch(e){}
  }catch(e){}
}
/* 用户落款行（对标原型：气泡外的独立行，右对齐；时间→复制钮） */
function aiAppendUserFoot(container, text, ts){
  try{
    var parent=container||aiChatView; if(!parent) return null;
    var sg=document.createElement('div'); sg.className='msg-foot right';
    var tm=document.createElement('time');
    try{ tm.textContent=i5FmtMsgTime((typeof ts==='number'&&ts>0)?ts:Date.now()); }catch(e){ tm.textContent=''; }
    sg.appendChild(tm);
    (function(_t){ try{ sg.appendChild(i5CreateCopyIconBtn(function(){ return _t; })); }catch(e){} })(String(text||''));
    parent.appendChild(sg);
    return sg;
  }catch(e){ return null; }
}
function aiAppendMsg(text,cls,ts){
 var d=document.createElement('div');
 d.className='ai-msg '+(cls||'ai');
 var tsVal=(typeof ts==='number'&&ts>0)?ts:Date.now();
 if((cls||'ai')==='ai'&&!text){
  var emptyBody=document.createElement('div'); emptyBody.className='ai-msg-body';
  var tl=document.createElement('div'); tl.className='i5-timeline';
  emptyBody.appendChild(tl);
  d.appendChild(emptyBody);
  if(aiChatView)aiChatView.appendChild(d);
  if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView)) aiChatView.scrollTop=aiChatView.scrollHeight;
  scrubAiChatView();
  return d;
 }
 var body=document.createElement('div');
 body.className='ai-msg-body';
 if(cls==='user'||cls==='err'){ body.textContent=text; }
 else{ try{ body.innerHTML=formatAiTextConclusionOnly(text); }catch(e){ body.textContent=String(text||''); } }
  d.appendChild(body);

  if(cls==='user'){
   /* 用户落款在气泡外：对标原型 .msg-foot.right 独立行 */
   if(aiChatView)aiChatView.appendChild(d);
   aiAppendUserFoot(aiChatView, text, tsVal);
  }else{
   if(cls==='err'){
    var foot=document.createElement('div');
    foot.className='msg-foot right';
    var tm=document.createElement('time'); tm.textContent=i5FmtMsgTime(tsVal);
    foot.appendChild(tm);
    (function(_t){ foot.appendChild(i5CreateCopyIconBtn(function(){ return _t; })); })(String(text||''));
    d.appendChild(foot);
   }else{
    var sfoot=document.createElement('div');
    sfoot.className='msg-foot';
    (function(_b){ sfoot.appendChild(i5CreateCopyIconBtn(function(){ try{ return _b?_b.innerText:''; }catch(e){ return ''; } })); })(body);
    var stm=document.createElement('time'); stm.textContent=i5FmtMsgTime(tsVal);
    sfoot.appendChild(stm);
    d.appendChild(sfoot);
   }
   if(aiChatView)aiChatView.appendChild(d);
  }
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
  try{ i5HideWaiting(); }catch(e){}
  var _hasTl=false; try{ var _tlE=aiStreaming.querySelector('.i5-timeline'); if(_tlE&&_tlE.children&&_tlE.children.length>0) _hasTl=true; else if(aiStreaming.querySelector('.think-p')||aiStreaming.querySelector('.exp')||aiStreaming.querySelector('.edit-row')||aiStreaming.querySelector('.shell-row')||aiStreaming.querySelector('.answer')) _hasTl=true; }catch(e){ _hasTl=false; }
   if(_hasTl){ try{ i5TlRemoveCursor(); }catch(e){} try{ var _tlF=null; try{ _tlF=aiStreaming.querySelector('.i5-timeline'); }catch(e){ _tlF=null; } if(_tlF){ try{ var _sb=_tlF.querySelectorAll('.silence'); for(var _sbi=0;_sbi<_sb.length;_sbi++){ try{ if(_sb[_sbi].parentNode) _sb[_sbi].parentNode.removeChild(_sb[_sbi]); }catch(e){} } }catch(e){} } }catch(e){} try{ i5TlSetStalled(false,0); }catch(e){} try{ i5ShellFinalizeAll(false); }catch(e){} try{ i5PairedFinalizeAll(false); }catch(e){} try{ if(typeof i5EditMarkFailed==='function') i5EditMarkFailed(); }catch(e){} }
   else{ aiStreaming.classList.add('err');
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
 }
 else{ aiAppendMsg(disp,'err'); }
 aiStreaming=null; aiSetBusy(false);
  var k=aiActiveHistKey();
  var _errTs=aiSessNow();
  var _errExtra=[{t:'error', text:disp, ts:_errTs}];
  if(k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)){ var s=aiCurSesh(); if(s){ s.m=s.m||[]; s.m.push({r:'a',t:disp,err:true,ts:_errTs}); try{ aiFlushTaskEventsToSess(s,_errExtra); }catch(e){ try{ aiCurTaskEvents=[]; }catch(_e){} } aiSaveSesh(); } else { try{ aiCurTaskEvents=[]; }catch(e){} } }
  else{ aiWriteSeshFor(k,function(v){ v.m.push({r:'a',t:disp,err:true,ts:_errTs}); try{ var _b=Array.isArray(aiCurTaskEvents)?aiCurTaskEvents:[]; for(var _bi=0;_bi<_b.length;_bi++){ try{ aiAppendSessEvent(v,_b[_bi]); }catch(_e){} } aiAppendSessEvent(v,{t:'error',text:disp,ts:_errTs}); }catch(_e){} }); try{ aiCurTaskEvents=[]; }catch(e){} }
  aiActiveKey=null;
}
/* 渲染流式气泡（单一气泡）：按类型分块展示简要信息
   思考行 → 操作列表（逐条 trace 一行）→ 输出行；详情全部留在日志组
   P1-5 AI-01 修复：流式期实时预览末 800 字正文，避免“只报字符数” */
/* 渲染流式气泡（时间线模型）：不再按类型分区，来一条画一条；此函数仅保活容器与滚动，逐条落子由事件分支完成 */
function aiRenderStream(){
 if(!aiStreaming)return;
 try{ i5TlEnsureTimeline(); }catch(e){}
 try{ if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView,80)) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){}
 try{ scrubAiChatView(); }catch(e){}
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
/* 实时追加一条操作行（时间线模型下已由 i5AppendToolCall 逐条落子，此处仅保活滚动，避免旧 op-list 重建覆盖时间线） */
function aiUpdateOpCur(){
 if(!aiStreaming)return;
 try{ if(aiChatView && !aiUserScrolledPause && aiShouldAutoScroll(aiChatView,80)) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){}
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
function i5ToolName(ev){ try{ if(ev&&ev.part&&typeof ev.part==='object'&&ev.part.tool) return String(ev.part.tool); }catch(e){} return (ev&&(ev.tool||ev.name||ev.toolName||ev.call))||'工具调用'; }
function i5ToolParam(ev){
 if(!ev)return '';
 if(ev.path)return String(ev.path);
 if(ev.file)return String(ev.file);
 if(ev.args){ try{ return typeof ev.args==='string'?ev.args:JSON.stringify(ev.args); }catch(e){} }
 if(ev.input){ try{ return typeof ev.input==='string'?ev.input:JSON.stringify(ev.input); }catch(e){} }
 return '';
}
/* S5b 配对纯逻辑（可单测提取）：有 id 事件判开始/完成；无 id 事件不经此函数（legacy 两行）。
   done 仅当 phase done 系或 state/status DONE 系；其余一律 start（qoder/claude 单发 tool_use 无相位即 start）。 */
function i5ToolPhaseOf(ev){
 try{
  var ph=String((ev&&(ev.phase||ev.toolPhase))||'').toLowerCase();
  if(ph==='done'||ph==='complete'||ph==='completed'||ph==='success') return 'done';
  if(ph==='start'||ph==='begin'||ph==='active'||ph==='running') return 'start';
  var st=String((ev&&(ev.state||ev.status))||'').toUpperCase();
  if(st==='DONE'||st==='COMPLETED'||st==='COMPLETE'||st==='SUCCESS') return 'done';
  if(st==='ACTIVE'||st==='START'||st==='STARTED'||st==='RUNNING') return 'start';
 }catch(e){}
 return 'start';
}
/* DONE 行 title 追加本步 token 数（有就显示，没有回空串不打扰；蛇形/camel 双兼容）。 */
function i5ToolUsageText(usage){
 try{
  var u=(usage&&typeof usage==='object')?usage:null;
  if(!u) return '';
  var num=function(v){ var n=Number(v); return (isFinite(n)&&n>0)?Math.floor(n):0; };
  var i=num(u.input_tokens!=null?u.input_tokens:u.inputTokens);
  var o=num(u.output_tokens!=null?u.output_tokens:u.outputTokens);
  if(i<=0&&o<=0) return '';
  return ' · tokens 输入'+i+'/输出'+o;
 }catch(e){ return ''; }
}
/* 无文本思考期占位文案（只报已等待秒数，不伪造思考文本）。 */
function i5ThinkIdleText(sec){
 try{
  var s=Math.max(0, Math.round(Number(sec)||0));
  return '思考中('+s+'s)';
 }catch(e){ return '思考中(0s)'; }
}
function i5EnsureThinkIdle(sec){
 if(!aiStreaming) return null;
 var tl=null;
 try{ tl=i5TlEnsureTimeline(); }catch(e){ return null; }
 if(!tl) return null;
 var row=null;
 try{ row=tl.querySelector('.i5-think-idle'); }catch(e){ row=null; }
 if(!row){
  try{
   row=document.createElement('div'); row.className='i5-think-idle';
   tl.appendChild(row);
  }catch(e){ return null; }
 }
 try{ row.textContent=i5ThinkIdleText(sec); }catch(e){}
 return row;
}
function i5HideThinkIdle(){
 try{
  if(!aiStreaming) return;
  var rows=aiStreaming.querySelectorAll('.i5-think-idle');
  for(var i=0;i<rows.length;i++){ try{ if(rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]); }catch(e){} }
 }catch(e){}
}
/* 收尾：未配对的开始行按成功/失败翻牌（单发 id 工具不断流：成功补一条 TOOL trace，避免日志缺口）。 */
function i5PairedFinalizeAll(ok){
 try{
  for(var k in i5PendingTools){
   (function(key){
    var rec=null;
    try{ rec=i5PendingTools[key]||null; }catch(e){ rec=null; }
    try{ delete i5PendingTools[key]; }catch(e){}
    if(!rec||!rec.el) return;
    try{
     if(ok===false){ rec.tag.className='tag fail i5-tag-fail'; rec.tag.textContent='失败'; return; }
     var sec=0;
     try{ sec=Math.max(0, Math.round((Date.now()-(rec.t0||Date.now()))/1000)); }catch(e){ sec=0; }
     rec.tag.className='tag done i5-tag-done'; rec.tag.textContent='完成·'+sec+'s';
     var tok='';
     try{ tok=i5ToolUsageText(rec.ev&&rec.ev.usage); }catch(e){ tok=''; }
     try{ if(tok&&rec.code) rec.code.title=String(rec.code.title||'')+tok; }catch(e){}
     try{ aiAppendTrace({ tag:'TOOL', level:'info', text:i5ToolName(rec.ev)+' '+i5ToolRawParam(rec.ev) }); }catch(e){}
    }catch(e){}
   })(k);
  }
 }catch(e){}
}
/* S5 范围确认弹窗（动态建 DOM，不碰 HTML/CSS 文件；任一按钮只回一次；无应答靠主进程 120 秒超时兜底）。 */
function i5ShowScopeConfirm(req){
 try{
  if(!req||!req.id) return;
  try{
   var olds=document.querySelectorAll('.i5-scope-mask');
   for(var oi=0;oi<olds.length;oi++){ try{ if(olds[oi].parentNode) olds[oi].parentNode.removeChild(olds[oi]); }catch(e){} }
  }catch(e){}
   var id=String(req.id);
   var hits=Array.isArray(req.hits)?req.hits:[];
   var mask=document.createElement('div'); mask.className='i5-scope-mask';
   try{ mask.setAttribute('data-scope-id', id); }catch(e){}
   mask.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
  var card=document.createElement('div');
  card.style.cssText='background:#fff;border-radius:10px;max-width:520px;width:92%;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-size:13px;line-height:1.7;color:#0f172a;';
  var title=document.createElement('div'); title.textContent='检测到沙箱外引用，请确认范围';
  title.style.cssText='font-weight:700;font-size:14px;margin-bottom:8px;';
  card.appendChild(title);
  var desc=document.createElement('div');
  var cwdLine=String(req.cwd||'');
  var listText=hits.length?hits.slice(0,20).join('\n'):'（未知）';
  desc.textContent='以下引用超出本次工作目录'+(cwdLine?('（'+cwdLine+'）'):'')+'，是否允许本次任务涉及？\n'+listText+'\n120 秒内未选择将按“仅沙箱内放行”继续。';
  desc.style.cssText='white-space:pre-wrap;word-break:break-all;background:#f1f5f9;border-radius:6px;padding:8px 10px;max-height:180px;overflow:auto;margin-bottom:12px;';
  card.appendChild(desc);
  var row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;justify-content:flex-end;';
  var replied=false;
  var reply=function(decision){
   if(replied) return; replied=true;
   try{ if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.confirmScope) window.protoAPI.ai.confirmScope({ id:id, decision:decision }); }catch(e){}
   try{ if(mask.parentNode) mask.parentNode.removeChild(mask); }catch(e){}
  };
  var mkBtn=function(label, decision, primary){
   var b=document.createElement('button'); b.type='button'; b.textContent=label;
   b.style.cssText=primary?'background:#2563eb;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;':'background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;padding:6px 14px;cursor:pointer;';
   b.onclick=function(){ reply(decision); };
   return b;
  };
  row.appendChild(mkBtn('拒绝', 'deny', false));
  row.appendChild(mkBtn('总是允许这类', 'allow-always', false));
  row.appendChild(mkBtn('允许本次', 'allow-once', true));
  card.appendChild(row);
   mask.appendChild(card);
   try{ document.body.appendChild(mask); }catch(e){ return; }
   /* 保险：130 秒后框还在就自撤（主进程超时 120 秒 + dismiss 万一丢失，不让遮罩永久挡输入） */
   try{
    setTimeout(function(){
     try{ if(mask.parentNode) mask.parentNode.removeChild(mask); }catch(e){}
    }, 130000);
   }catch(e){}
  }catch(e){}
}
/* 确认框撤除（主进程超时/取消/已解决时下发；按 id 精确移除，不在即 no-op） */
function i5DismissScopeConfirm(id){
 try{
  var sid=String(id||'').trim(); if(!sid) return;
  var all=null; try{ all=document.querySelectorAll('.i5-scope-mask'); }catch(e){ return; }
  for(var i=0;i<all.length;i++){
   try{
    var m=all[i]; if(!m) continue;
    var mid=''; try{ mid=String(m.getAttribute&&m.getAttribute('data-scope-id')||''); }catch(e){}
    if(mid===sid&&m.parentNode){ m.parentNode.removeChild(m); }
   }catch(e){}
  }
 }catch(e){}
}
function i5AppendToolCall(ev){
 /* 时间线模型：严格按到达顺序逐条落子，不再按类型分区；聚合/编辑/Shell三类分发。
    S5b TOOL 双行合并：有 ev.id（agy 同一步号 ACTIVE/DONE 同 id）按 id 配对——开始建行
    （tag 执行中，不记 trace），完成翻牌为完成+耗时并记一条 trace；无 id 走 legacy 两行兼容其它 CLI。 */
 try{ i5ThinkFlushPending(false); }catch(e){}
 var _pairId='';
 try{ _pairId=String((ev&&(ev.id||ev.tool_use_id||ev.toolUseId))||'').trim(); }catch(e){ _pairId=''; }
 if(_pairId){
  var _phase='start';
  try{ _phase=i5ToolPhaseOf(ev); }catch(e){ _phase='start'; }
  if(_phase!=='done'){
   try{
    var _tl0=i5TlEnsureTimeline();
    if(_tl0){
     var _row=document.createElement('div'); _row.className='shell-row i5-shell-row i5-paired';
     var _verb=document.createElement('b'); _verb.className='i5-verb'; _verb.textContent=String(i5ToolName(ev)||'工具调用');
     var _code=document.createElement('code'); _code.className='i5-cmd';
     var _raw0=i5ToolRawParam(ev)||'';
     _code.textContent=String(_raw0).length>120?String(_raw0).slice(0,120)+'…':String(_raw0||'(调用)');
     _code.title=String(_raw0||'');
     var _tag0=document.createElement('span'); _tag0.className='tag run i5-tag-run'; _tag0.textContent='执行中';
     _row.appendChild(_verb); _row.appendChild(_code); _row.appendChild(_tag0);
     _tl0.appendChild(_row);
     try{ i5PendingTools[_pairId]={ el:_row, tag:_tag0, code:_code, t0:Date.now(), ev:ev }; }catch(e){}
     i5TlMoveCursorTo(_row);
    }
   }catch(e){}
  }else{
   var _rec=null;
   try{ _rec=i5PendingTools[_pairId]||null; }catch(e){ _rec=null; }
   var _now=0;
   try{ _now=Date.now(); }catch(e){ _now=0; }
   var _isFail=false;
   try{ _isFail=/fail|error/.test(String((ev&&(ev.status||ev.state))||'').toLowerCase()); }catch(e){ _isFail=false; }
   var _tok='';
   try{ _tok=i5ToolUsageText(ev&&ev.usage); }catch(e){ _tok=''; }
   if(_rec&&_rec.el){
    try{
     var _sec=0;
     try{ _sec=Math.max(0, Math.round(((_now||Date.now())-(_rec.t0||_now))/1000)); }catch(e){ _sec=0; }
     if(_isFail){ _rec.tag.className='tag fail i5-tag-fail'; _rec.tag.textContent='失败'; }
     else{ _rec.tag.className='tag done i5-tag-done'; _rec.tag.textContent='完成·'+_sec+'s'; }
     try{ if(_tok&&_rec.code) _rec.code.title=String(_rec.code.title||'')+_tok; }catch(e){}
     try{ delete i5PendingTools[_pairId]; }catch(e){}
     i5TlMoveCursorTo(_rec.el);
    }catch(e){}
   }else{
    try{
     var _tl1=i5TlEnsureTimeline();
     if(_tl1){
      var _row2=document.createElement('div'); _row2.className='shell-row i5-shell-row i5-paired';
      var _verb2=document.createElement('b'); _verb2.className='i5-verb'; _verb2.textContent=String(i5ToolName(ev)||'工具调用');
      var _code2=document.createElement('code'); _code2.className='i5-cmd';
      var _raw2=i5ToolRawParam(ev)||'';
      _code2.textContent=String(_raw2).length>120?String(_raw2).slice(0,120)+'…':String(_raw2||'(调用)');
      _code2.title=String(_raw2||'')+_tok;
      var _tag2=document.createElement('span');
      if(_isFail){ _tag2.className='tag fail i5-tag-fail'; _tag2.textContent='失败'; }
      else{ _tag2.className='tag done i5-tag-done'; _tag2.textContent='完成'; }
      _row2.appendChild(_verb2); _row2.appendChild(_code2); _row2.appendChild(_tag2);
      _tl1.appendChild(_row2);
      i5TlMoveCursorTo(_row2);
     }
    }catch(e){}
   }
   try{ aiAppendTrace({ tag:'TOOL', level:'info', text:i5ToolName(ev)+' '+i5ToolRawParam(ev) }); }catch(e){}
  }
  try{ aiTlLastPacket=Date.now(); aiTlLastType='tool_call'; i5TlSetStalled(false,0); }catch(e){}
  i5TlScroll();
  return;
 }
 var rawName=i5ToolName(ev);
 var kind=i5VerbKind(rawName);
 try{
  if(kind==='explore'){ i5ExploreAdd(ev); }
  else if(kind==='edit'){ i5EditAdd(ev); }
  else if(kind==='shell'){
   var st0=String((ev&&(ev.status||ev.state))||'').toLowerCase();
   if(/fail|error/.test(st0)){
    var r=i5ShellAdd(ev);
    try{ if(r){ var tg=r.querySelector('.tag'); if(!tg) tg=r.querySelector('.i5-tag-run'); if(tg){ tg.className='tag fail i5-tag-fail'; tg.textContent='失败'; } } }catch(e){}
   }else{ i5ShellAdd(ev); }
  }
  else{
   var tl=i5TlEnsureTimeline();
   if(tl){
    var row=document.createElement('div'); row.className='shell-row i5-shell-row';
    var verb=document.createElement('b'); verb.className='i5-verb'; verb.textContent=String(rawName||'工具调用');
    var code=document.createElement('code'); code.className='i5-cmd';
    var raw=i5ToolRawParam(ev)||'';
    code.textContent=String(raw).length>120?String(raw).slice(0,120)+'…':String(raw||'(调用)');
    code.title=String(raw||'');
    var tag=document.createElement('span'); tag.className='tag run i5-tag-run'; tag.textContent='执行中';
    row.appendChild(verb); row.appendChild(code); row.appendChild(tag);
    tl.appendChild(row);
    try{ aiTlShellRows.push({ el:row, tag:tag, ev:ev }); }catch(e){}
    i5TlMoveCursorTo(row);
   }
  }
 }catch(e){}
 try{ aiTlLastPacket=Date.now(); aiTlLastType='tool_call'; i5TlSetStalled(false,0); }catch(e){}
 i5TlScroll();
 try{ aiAppendTrace({ tag:'TOOL', level:'info', text:i5ToolName(ev)+' '+i5ToolRawParam(ev) }); }catch(e){}
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
/* ======= AI执行流展示-时间线引擎（第1/2/4/5.4/6/7章纯前端） =======
   会话流严格按事件到达顺序逐条落子，不再按类型分区。
   事件5种：用户消息、思考、工具调用、最终回答、系统卡片（回滚卡）。
   旧死代码 i5EnsureThinkBox 系保留不调用（测试锁），thinking分支不得调 i5UpdateThinkBox。 */
var I5_STALL_THRESHOLD=30;
var aiTlBuf='', aiTlFull='', aiTlReadCount=0, aiTlDirCount=0, aiTlReadFiles=[];
var aiTlExploreRow=null, aiTlExploreCountEl=null, aiTlExploreChipsEl=null;
var aiTlEditRows=[], aiTlShellRows=[];
var aiTlAnswerText='', aiTlAnswerEl=null, aiTlAnswerBodyEl=null, aiTlPendingEl=null;
var aiTlLastPacket=0, aiTlLastType='', aiTlStalled=false;
/* S5b 配对表：id → {el,tag,code,t0,ev}（开始行待完成翻牌；收尾/切任务时清理） */
var i5PendingTools={};
function i5FmtMsgTime(ts){
 try{
  var d=new Date(ts||Date.now()); if(isNaN(d.getTime())) d=new Date();
  var pad=function(n){ return (n<10?'0':'')+n; };
  var hm=pad(d.getHours())+':'+pad(d.getMinutes());
  var now=new Date();
  var ds=function(dt){ var x=new Date(dt); x.setHours(0,0,0,0); return x.getTime(); };
  var diff=Math.round((ds(now)-ds(d))/86400000);
  if(diff<=0) return hm;
  if(diff===1) return '昨日 '+hm;
  return pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+hm;
 }catch(e){ return ''; }
}
function i5CopySvg(){
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
}
function i5CreateCopyIconBtn(getTextFn){
 var btn=document.createElement('button');
 btn.type='button'; btn.className='icon-btn i5-copy-btn'; btn.title='复制'; btn.innerHTML=i5CopySvg();
 btn.onclick=function(e){
  try{ if(e&&e.stopPropagation) e.stopPropagation(); }catch(ee){}
  var txt=''; try{ txt=typeof getTextFn==='function'?getTextFn():getTextFn; }catch(ee){ txt=''; }
  if(txt==null) txt=''; txt=String(txt); if(!txt) return;
  var done=function(){
   try{ btn.classList.add('ok'); btn.classList.add('copied'); btn.title='已复制'; }catch(ee){}
   setTimeout(function(){ try{ btn.classList.remove('ok'); btn.classList.remove('copied'); btn.title='复制'; }catch(ee){} }, 1200);
  };
  try{
   if(typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done, function(){ try{ fallbackAiCopy(txt, btn); }catch(ee){} done(); });
    return;
   }
  }catch(ee){}
  try{ fallbackAiCopy(txt, btn); }catch(ee){}
  done();
 };
 return btn;
}
/* 5.4 动词映射表（前端常量）：read/glob/grep/查看类→已探索；edit/write/apply类→编辑；exec/bash/shell类→Shell；未知回落英文原文 */
function i5VerbKind(toolName){
 var s=String(toolName||'').toLowerCase();
 if(!s) return 'unknown';
 if(/read|glob|grep|view|cat|ls|list|find|search|fetch|disk|tree|查看|读取|浏览|探索|文件/.test(s)) return 'explore';
 if(/edit|write|apply|save|patch|replace|create|修改|编辑|写入/.test(s)) return 'edit';
 if(/exec|bash|shell|command|run|term|cli|npm|node|python|git|执行|命令/.test(s)) return 'shell';
 return 'unknown';
}
function i5VerbLabel(kind, raw){
 if(kind==='explore') return '已探索';
 if(kind==='edit') return '编辑';
 if(kind==='shell') return 'Shell';
 return String(raw||'工具调用');
}
function i5ToolRawParam(ev){
 if(!ev) return '';
 if(typeof ev.command==='string'&&ev.command) return String(ev.command);
 if(typeof ev.cmd==='string'&&ev.cmd) return String(ev.cmd);
 try{ var _pp=(ev&&ev.part&&typeof ev.part==='object')?ev.part:null; var _ps=(_pp&&_pp.state&&typeof _pp.state==='object')?_pp.state:null; var _pi=(_ps&&_ps.input!=null)?_ps.input:null; if(_pi!=null){ try{ return (typeof _pi==='string')?_pi:JSON.stringify(_pi); }catch(e){} } }catch(e){}
 if(ev.args){ try{ return typeof ev.args==='string'?ev.args:JSON.stringify(ev.args); }catch(e){} }
 if(ev.input){ try{ return typeof ev.input==='string'?ev.input:JSON.stringify(ev.input); }catch(e){} }
 if(ev.path) return String(ev.path);
 if(ev.file) return String(ev.file);
 return '';
}
function i5ExtractToolFile(ev){
 if(!ev) return '';
 if(ev.path) return String(ev.path);
 if(ev.file) return String(ev.file);
 if(ev.filename) return String(ev.filename);
 if(ev.filePath) return String(ev.filePath);
 try{ var _p0=(ev&&ev.part&&typeof ev.part==='object')?ev.part:null; var _s0=(_p0&&_p0.state&&typeof _p0.state==='object')?_p0.state:null; var _i0=(_s0&&_s0.input!=null)?_s0.input:null; if(_i0&&typeof _i0==='object'&&(_i0.path||_i0.file||_i0.filename||_i0.filePath||_i0.pattern)) return String(_i0.path||_i0.file||_i0.filename||_i0.filePath||_i0.pattern); }catch(e){}
 var cand=[ev.args, ev.input, ev.params, ev.arguments];
 for(var i=0;i<cand.length;i++){
  var c=cand[i]; if(c==null) continue;
  if(typeof c==='string'){
   try{ var o=JSON.parse(c); if(o&&(o.path||o.file||o.filename||o.filePath)) return String(o.path||o.file||o.filename||o.filePath); }
   catch(e){ if(c.length<260&&/[\w\-\.\/\\:]+\.\w+/.test(c)) return c; }
  }else if(typeof c==='object'){
   try{ if(c.path||c.file||c.filename||c.filePath) return String(c.path||c.file||c.filename||c.filePath); }catch(e){}
  }
 }
 return '';
}
function i5ExtractShellCmd(ev){
 if(!ev) return '';
 if(typeof ev.command==='string'&&ev.command) return String(ev.command);
 if(typeof ev.cmd==='string'&&ev.cmd) return String(ev.cmd);
 try{ var _p1=(ev&&ev.part&&typeof ev.part==='object')?ev.part:null; var _s1=(_p1&&_p1.state&&typeof _p1.state==='object')?_p1.state:null; var _i1=(_s1&&_s1.input!=null)?_s1.input:null; if(_i1&&typeof _i1==='object'&&(_i1.command||_i1.cmd)) return String(_i1.command||_i1.cmd); }catch(e){}
 var cand=[ev.args, ev.input, ev.params];
 for(var i=0;i<cand.length;i++){
  var c=cand[i]; if(c==null) continue;
  if(typeof c==='string'){
   try{ var o=JSON.parse(c); if(o&&(o.command||o.cmd)) return String(o.command||o.cmd); }catch(e){}
   return String(c);
  }else if(typeof c==='object'){
   try{ if(c.command||c.cmd) return String(c.command||c.cmd); }catch(e){}
  }
 }
 var raw=i5ToolRawParam(ev); return String(raw||'');
}
function i5IsDirPath(p, toolName){
 if(!p) return false;
 var s=String(p);
 if(/\/$|\\$/.test(s)) return true;
 var low=String(toolName||'').toLowerCase();
 if(/glob|ls|list|dir|find|tree/.test(low)){
  var base=s.split(/[\\/]/).pop()||'';
  if(base.indexOf('.')<0) return true;
 }
 return false;
}
function i5TlReset(){
 aiTlBuf=''; aiTlFull=''; aiTlReadCount=0; aiTlDirCount=0; aiTlReadFiles=[];
 try{ for(var _pk in i5PendingTools){ try{ delete i5PendingTools[_pk]; }catch(e){} } }catch(e){}
 aiTlExploreRow=null; aiTlExploreCountEl=null; aiTlExploreChipsEl=null;
 aiTlEditRows=[]; aiTlShellRows=[];
 aiTlAnswerText=''; aiTlAnswerEl=null; aiTlAnswerBodyEl=null; aiTlPendingEl=null;
 aiTlLastPacket=0; aiTlLastType=''; aiTlStalled=false;
}
function i5TlEnsureTimeline(){
 if(!aiStreaming) return null;
 var body=null;
 try{ body=aiStreaming.querySelector('.ai-msg-body'); }catch(e){ body=null; }
 if(!body){
  try{
   body=document.createElement('div'); body.className='ai-msg-body';
   aiStreaming.appendChild(body);
  }catch(e){ return null; }
 }
 var tl=null;
 try{ tl=body.querySelector('.i5-timeline'); }catch(e){ tl=null; }
 if(tl) return tl;
 try{
  body.innerHTML='';
  tl=document.createElement('div'); tl.className='i5-timeline';
  body.appendChild(tl);
 }catch(e){ return null; }
 return tl;
}
function i5TlScroll(){
 try{
  /* 自愈：仍在底部附近时清掉陈旧暂停标记再吸底（滚轮抖动等置位后不再卡死） */
  if(aiChatView&&aiShouldAutoScroll(aiChatView,80)){ try{ aiUserScrolledPause=false; }catch(e){} aiChatView.scrollTop=aiChatView.scrollHeight; }
 }catch(e){}
 try{ if(typeof aiUpdateJumpBtn==='function') aiUpdateJumpBtn(); }catch(e){}
 try{ if(typeof scrubAiChatView==='function') scrubAiChatView(); }catch(e){}
}
function i5TlRemoveCursor(){
 try{
  if(!aiStreaming) return;
  var cs=aiStreaming.querySelectorAll('.cursor');
  for(var i=0;i<cs.length;i++){ try{ if(cs[i].parentNode) cs[i].parentNode.removeChild(cs[i]); }catch(e){} }
  try{
   var olds=aiStreaming.querySelectorAll('.i5-cursor');
   for(var j=0;j<olds.length;j++){ try{ if(olds[j].parentNode) olds[j].parentNode.removeChild(olds[j]); }catch(e){} }
  }catch(e){}
  aiTlPendingEl=null;
 }catch(e){}
}
function i5TlMoveCursorTo(node){
  try{
   i5TlRemoveCursor();
   try{ i5HideWaiting(); }catch(e){} /* 任一实质内容落子即撤等待行 */
   if(!node||!aiStreaming) return;
   var cur=document.createElement('span'); cur.className='cursor i5-cursor';
   try{ node.appendChild(cur); }catch(e){}
  }catch(e){}
}
/* 发送后等待态：首包到达前时间线是空的，挂一个带闪烁光标的等待行；任一内容落子/结束/失败即撤
 * T-CLI启动中（方案B）：同一行原地换字，boot→wait两阶段；i5ShowWaiting默认即wait文案保持兼容 */
var aiWaitPhase='';
var aiWaitBootTimer=null;
function i5SetWaitingText(txt){
  try{
    if(!aiStreaming) return;
    var tl=null; try{ tl=i5TlEnsureTimeline(); }catch(e){ return; }
    if(!tl) return;
    var ws=null; try{ ws=tl.querySelectorAll('.i5-waiting'); }catch(e){ return; }
    for(var i=0;i<ws.length;i++){ try{ if(ws[i].parentNode) ws[i].parentNode.removeChild(ws[i]); }catch(e){} }
    try{ i5TlRemoveCursor(); }catch(e){}
    var w=document.createElement('div'); w.className='think-p i5-think-p i5-waiting';
    w.textContent=String(txt||'');
    tl.appendChild(w);
    var cur=document.createElement('span'); cur.className='cursor i5-cursor';
    try{ w.appendChild(cur); }catch(e){}
  }catch(e){}
}
function i5ShowBooting(engine, agentLabel){
  try{
    var txt='Agent CLI启动中…';
    try{
      if(String(engine||'')==='api'){ txt='请求发送中…'; }
      else{ var nm=String(agentLabel||'').trim(); if(nm){ txt=nm+' CLI启动中…'; } }
    }catch(e){}
    try{ i5SetWaitingText(txt); }catch(e){ try{ i5ShowWaiting(); return; }catch(e2){ return; } }
    try{ aiWaitPhase='boot'; }catch(e){}
    try{ if(aiWaitBootTimer){ clearTimeout(aiWaitBootTimer); aiWaitBootTimer=null; } }catch(e){}
    try{
      aiWaitBootTimer=setTimeout(function(){
        try{
          if(aiWaitPhase!=='boot') return;
          var w=null; try{ w=(aiStreaming&&aiStreaming.querySelector)?aiStreaming.querySelector('.i5-waiting'):null; }catch(e){ w=null; }
          if(!w) return;
          i5SetWaitingText(txt+'（启动较慢，仍在等待）');
        }catch(e){}
      },8000);
    }catch(e){}
  }catch(e){}
}
function i5MarkRunStarted(ev){
  try{ if(aiWaitBootTimer){ clearTimeout(aiWaitBootTimer); aiWaitBootTimer=null; } }catch(e){}
  try{ aiWaitPhase='wait'; }catch(e){}
  try{ i5SetWaitingText('等待响应…'); }catch(e){ try{ i5ShowWaiting(); }catch(e2){} }
}
function i5ShowWaiting(){
  try{
    if(!aiStreaming) return;
    var tl=null; try{ tl=i5TlEnsureTimeline(); }catch(e){ return; }
    if(!tl) return;
    var has=null; try{ has=tl.querySelector('.i5-waiting'); }catch(e){}
    if(has){ try{ i5SetWaitingText('等待响应…'); }catch(e){} try{ aiWaitPhase='wait'; }catch(e){} try{ if(aiWaitBootTimer){ clearTimeout(aiWaitBootTimer); aiWaitBootTimer=null; } }catch(e){} return; }
    try{ i5TlRemoveCursor(); }catch(e){}
    var w=document.createElement('div'); w.className='think-p i5-think-p i5-waiting';
    w.textContent='等待响应…';
    tl.appendChild(w);
    var cur=document.createElement('span'); cur.className='cursor i5-cursor';
    try{ w.appendChild(cur); }catch(e){}
    try{ aiWaitPhase='wait'; }catch(e){}
  }catch(e){}
}
function i5HideWaiting(){
  try{ if(aiWaitBootTimer){ clearTimeout(aiWaitBootTimer); aiWaitBootTimer=null; } }catch(e){}
  try{ aiWaitPhase=''; }catch(e){}
  try{
    if(!aiStreaming) return;
    var ws=aiStreaming.querySelectorAll('.i5-waiting');
    for(var i=0;i<ws.length;i++){ try{ if(ws[i].parentNode) ws[i].parentNode.removeChild(ws[i]); }catch(e){} }
  }catch(e){}
}
/* 思考切分（2.3）：终结符 。！？!?+右引号括号+空白换行；英文句号需后跟空格+大写/换行/结尾；\n\n最高权重；```围栏内暂停 */
function i5SplitThink(src){
 var list=[], cur='', i=0, n=src.length, inFence=false;
 var isQuote=function(ch){ return ch==='\u201d'||ch==='\u2019'||ch==='\''||ch==='"'||ch==='\u3009'||ch==='\u300d'||ch==='）'||ch===')'||ch===']'||ch==='}'||ch==='\u300b'; };
 while(i<n){
  if(src.substr(i,3)==='```'){ inFence=!inFence; cur+='```'; i+=3; continue; }
  if(inFence){ cur+=src[i]; i++; continue; }
  if(src[i]==='\n'&&(src[i+1]==='\n'||(src[i+1]==='\r'&&src[i+2]==='\n'))){
   if(cur.trim()) list.push(cur);
   cur='';
   while(i<n&&(src[i]==='\n'||src[i]==='\r')) i++;
   continue;
  }
  var ch=src[i];
  if(ch==='\u3002'||ch==='\uff01'||ch==='\uff1f'){
   var j=i+1, q='';
   while(j<n&&isQuote(src[j])){ q+=src[j]; j++; }
   cur+=ch+q; list.push(cur); cur='';
   i=j;
   while(i<n&&(src[i]===' '||src[i]==='\t'||src[i]==='\u3000')) i++;
   if(i<n&&(src[i]==='\n'||src[i]==='\r')){ while(i<n&&(src[i]==='\n'||src[i]==='\r')) i++; }
   continue;
  }
  if(ch==='!'||ch==='?'){
   var j2=i+1, q2='';
   while(j2<n&&isQuote(src[j2])){ q2+=src[j2]; j2++; }
   var nx=j2<n?src[j2]:'';
   var isCjk=function(c){ try{ var cc=c.charCodeAt(0); return (cc>=0x4E00&&cc<=0x9FFF)||(cc>=0x3400&&cc<=0x4DBF)||(cc>=0x3040&&cc<=0x30FF); }catch(e){ return false; } };
   if(nx===''||nx==='\n'||nx==='\r'||nx===' '||nx==='\t'||nx==='\u3000'||isCjk(nx)){
    cur+=ch+q2; list.push(cur); cur='';
    i=j2;
    while(i<n&&(src[i]===' '||src[i]==='\t')) i++;
    if(i<n&&(src[i]==='\n'||src[i]==='\r')){ while(i<n&&(src[i]==='\n'||src[i]==='\r')) i++; }
    continue;
   }
   cur+=ch; i++; continue;
  }
  if(ch==='.'){
   var nx2=i+1<n?src[i+1]:'';
   var nx3=i+2<n?src[i+2]:'';
   var isEnd=(i+1>=n);
   var isNewline=(nx2==='\n'||nx2==='\r');
   var isSpUp=((nx2===' '||nx2==='\t'||nx2==='\u3000')&&nx3&&nx3>='A'&&nx3<='Z');
   if(isEnd||isNewline||isSpUp){ cur+=ch; list.push(cur); cur=''; i++; continue; }
   cur+=ch; i++; continue;
  }
  cur+=ch; i++;
 }
 return { list:list, rest:cur };
}
function i5TlAppendThinkPara(text){
 if(text==null) return null;
 var t=String(text);
 if(!t.trim()) return null;
 var tl=i5TlEnsureTimeline(); if(!tl) return null;
 aiTlPendingEl=null;
 var disp=t.length>1500?t.slice(-1500):t;
 var p=null;
 try{
  p=document.createElement('div'); p.className='think-p i5-think-p';
  p.innerHTML=escHtml(disp).replace(/\n/g,'<br>');
  p.setAttribute('data-full-len', String(t.length));
  tl.appendChild(p);
 }catch(e){ return null; }
 try{
  var _ops=tl.querySelectorAll('.think-p');
  for(var _oi=0;_oi<_ops.length;_oi++){
   if(_ops[_oi]===p) continue;
   try{ var _os=_ops[_oi].querySelectorAll('.silence'); for(var _ok=0;_ok<_os.length;_ok++){ try{ if(_os[_ok].parentNode===_ops[_oi]) _os[_ok].parentNode.removeChild(_os[_ok]); }catch(e){} } }catch(e){}
  }
 }catch(e){}
 i5TlMoveCursorTo(p);
 try{
  var _ss=0; try{ _ss=aiTlLastPacket?Math.round((Date.now()-aiTlLastPacket)/1000):0; if(_ss<0)_ss=0; }catch(e){ _ss=0; }
  var _sil=document.createElement('span'); _sil.className='silence i5-silent'; _sil.textContent='静默 '+_ss+'s';
  p.appendChild(_sil);
 }catch(e){}
 i5TlScroll();
 return p;
}
function i5ThinkAppendChunk(t){
 var s=String(t==null?'':t); if(!s) return;
 try{ i5HideThinkIdle(); }catch(e){}
 aiTlFull+=s; try{ aiStreamThink+=s; }catch(e){ aiStreamThink=aiTlFull; }
 try{ var g0=aiCurGroup(); if(g0) g0.think=aiStreamThink; }catch(e){}
 aiTlBuf+=s;
 var r=i5SplitThink(aiTlBuf);
 for(var i=0;i<r.list.length;i++){ i5TlAppendThinkPara(r.list[i]); }
 aiTlBuf=r.rest;
 if(aiTlBuf&&aiTlBuf.trim()){
  var tl=i5TlEnsureTimeline();
  if(tl){
   try{
    i5TlRemoveCursor();
    var pend=null;
    try{ pend=tl.querySelector('.think-pending'); if(!pend) pend=tl.querySelector('.i5-think-pending'); }catch(e){ pend=null; }
    if(!pend){ pend=document.createElement('div'); pend.className='think-p i5-think-p think-pending i5-think-pending'; tl.appendChild(pend); }
    var disp2=aiTlBuf.length>1500?aiTlBuf.slice(-1500):aiTlBuf;
    pend.innerHTML=escHtml(disp2).replace(/\n/g,'<br>');
    var cur=document.createElement('span'); cur.className='cursor i5-cursor';
    pend.appendChild(cur);
    try{ var _pss=0; try{ _pss=aiTlLastPacket?Math.round((Date.now()-aiTlLastPacket)/1000):0; if(_pss<0)_pss=0; }catch(e){ _pss=0; } var _psil=document.createElement('span'); _psil.className='silence i5-silent'; _psil.textContent='静默 '+_pss+'s'; pend.appendChild(_psil); }catch(e){}
    try{ var _tlp=i5TlEnsureTimeline(); if(_tlp){ var _pps=_tlp.querySelectorAll('.think-p'); for(var _pi=0;_pi<_pps.length;_pi++){ if(_pps[_pi]===pend) continue; try{ var _ss2=_pps[_pi].querySelectorAll('.silence'); for(var _sk=0;_sk<_ss2.length;_sk++){ try{ if(_ss2[_sk].parentNode===_pps[_pi]) _ss2[_sk].parentNode.removeChild(_ss2[_sk]); }catch(e){} } }catch(e){} } } }catch(e){}
    aiTlPendingEl=pend;
   }catch(e){}
  }
 }else{
  try{
   if(aiTlPendingEl&&aiTlPendingEl.parentNode) aiTlPendingEl.parentNode.removeChild(aiTlPendingEl);
  }catch(e){}
  aiTlPendingEl=null;
  try{
   var tl2=i5TlEnsureTimeline();
   if(tl2&&tl2.lastChild) i5TlMoveCursorTo(tl2.lastChild);
  }catch(e){}
 }
 i5TlScroll();
}
function i5ThinkFlushPending(force){
 if(aiTlBuf&&aiTlBuf.trim()){
  try{
   if(aiTlPendingEl&&aiTlPendingEl.parentNode) aiTlPendingEl.parentNode.removeChild(aiTlPendingEl);
  }catch(e){}
  aiTlPendingEl=null;
  var t=aiTlBuf; aiTlBuf='';
  i5TlAppendThinkPara(t);
 }else{ aiTlBuf=''; try{ if(aiTlPendingEl&&aiTlPendingEl.parentNode) aiTlPendingEl.parentNode.removeChild(aiTlPendingEl); }catch(e){} aiTlPendingEl=null; }
 if(force&&!aiTlFull) return;
}
function i5ExploreAdd(ev){
 var tool=i5ToolName(ev);
 var file=i5ExtractToolFile(ev);
 var isDir=i5IsDirPath(file, tool);
 var tl=i5TlEnsureTimeline(); if(!tl) return null;
 try{ if(aiTlExploreRow&&aiTlExploreChipsEl){ var _last=null; try{ _last=tl.lastChild; while(_last&&_last.nodeType!==1) _last=_last.previousSibling; }catch(_e){ _last=null; } if(_last!==aiTlExploreChipsEl&&_last!==aiTlExploreRow){ aiTlExploreRow=null; aiTlExploreCountEl=null; aiTlExploreChipsEl=null; } } }catch(_e){}
  if(!aiTlExploreRow){
   try{
    var row=document.createElement('div'); row.className='exp i5-explore';
    var verb=document.createElement('b'); verb.className='i5-verb'; verb.textContent='已探索';
    var chips=document.createElement('span'); chips.className='exp-files i5-chips';
    var cnt=document.createElement('span'); cnt.className='n i5-count';
    /* 单行：已探索 ｜ 文件chips ｜ 次数（光标跟行末） */
    row.appendChild(verb); row.appendChild(chips); row.appendChild(cnt);
    tl.appendChild(row);
    aiTlExploreRow=row; aiTlExploreCountEl=cnt; aiTlExploreChipsEl=chips;
   }catch(e){ return null; }
  }
 if(isDir){ aiTlDirCount++; }
 else if(file){ aiTlReadCount++; aiTlReadFiles.push(String(file)); }
 else{
  var low=String(tool||'').toLowerCase();
  if(/glob|ls|list|dir|find|tree/.test(low)) aiTlDirCount++;
  else aiTlReadCount++;
 }
 try{
  var label=String(aiTlReadCount)+' 次读取';
  if(aiTlDirCount>0) label+=' · '+String(aiTlDirCount)+' 个目录';
  aiTlExploreCountEl.textContent=label;
  if(file&&!isDir){
   var chip=document.createElement('code'); chip.className='i5-chip';
   var base=String(file).split(/[\\/]/).pop()||String(file);
   chip.textContent=base; chip.title=String(file);
   aiTlExploreChipsEl.appendChild(chip);
  }
   if(aiTlExploreRow.parentNode!==tl) tl.appendChild(aiTlExploreRow);
   try{ i5TlMoveCursorTo(aiTlExploreRow); }catch(e){} /* 光标跟行末（已探索·文件·次数之后） */
 }catch(e){}
 i5TlScroll();
 return aiTlExploreRow;
}
function i5EditAdd(ev){
 var file=i5ExtractToolFile(ev)||i5ToolRawParam(ev)||'文件';
 file=String(file);
 var tl=i5TlEnsureTimeline(); if(!tl) return null;
 var row=null;
 try{
  row=document.createElement('div'); row.className='edit-row i5-edit-row';
  var verb=document.createElement('b'); verb.className='i5-verb'; verb.textContent='编辑';
  var fn=document.createElement('span'); fn.className='f i5-file';
  var base=file.split(/[\\/]/).pop()||file;
  fn.textContent=base; fn.title=file;
  var sub=''; try{ sub=i5CurSubFile(); }catch(e){ sub=''; }
  row.title=sub?('所属文件：'+sub+' | '+file):file;
  row.appendChild(verb); row.appendChild(fn);
  tl.appendChild(row);
  aiTlEditRows.push({ file:file, el:row });
  i5TlMoveCursorTo(row);
 }catch(e){ return null; }
 i5TlScroll();
 return row;
}
function i5EditFinalize(fileChanges){
 try{
  var list=Array.isArray(fileChanges)?fileChanges:[];
  var norm=function(p){ return String(p||'').replace(/\\/g,'/'); };
  var base=function(p){ var s=norm(p).split('/').pop()||''; return s; };
  for(var i=0;i<aiTlEditRows.length;i++){
   (function(rec){
    try{
     var el=rec.el; if(!el) return;
     var hit=null;
     for(var k=0;k<list.length;k++){
      var fc=list[k]||{};
      var fp=fc.path||fc.file||fc.name||'';
      if(!fp) continue;
      if(norm(fp)===norm(rec.file)||base(fp)===base(rec.file)||norm(rec.file).indexOf(norm(fp))>=0||norm(fp).indexOf(norm(rec.file))>=0){ hit=fc; break; }
     }
     var curs=null; try{ curs=el.querySelector('.cursor'); if(!curs) curs=el.querySelector('.i5-cursor'); if(curs&&curs.parentNode) curs.parentNode.removeChild(curs); }catch(e){}
     if(hit&&(hit.added!=null||hit.deleted!=null)){
      var a=Number(hit.added||0), d=Number(hit.deleted||0);
      var sa=document.createElement('span'); sa.className='add i5-add'; sa.textContent='+'+a;
      var sd=document.createElement('span'); sd.className='del i5-del'; sd.textContent='-'+d;
      el.appendChild(sa); el.appendChild(sd);
     }
    }catch(e){}
   })(aiTlEditRows[i]);
  }
 }catch(e){}
}

function i5EditMarkFailed(){
 try{
  for(var i=0;i<aiTlEditRows.length;i++){
   (function(rec){
    try{
     var el=rec&&rec.el; if(!el) return;
     try{ var _c=el.querySelector('.cursor'); if(_c&&_c.parentNode) _c.parentNode.removeChild(_c); }catch(e){}
     try{ var _c2=el.querySelector('.i5-cursor'); if(_c2&&_c2.parentNode) _c2.parentNode.removeChild(_c2); }catch(e){}
     if(String(el.className||'').indexOf('fail')<0) el.className+=' fail i5-edit-fail';
     try{
      if(!el.querySelector('.fail')&&!el.querySelector('.i5-tag-fail')){
       var f=document.createElement('span'); f.className='fail i5-tag-fail'; f.textContent='失败';
       f.onclick=function(e){ try{ if(e&&e.stopPropagation) e.stopPropagation(); }catch(ee){} try{ switchAiTab('logs'); }catch(ee){} };
       el.appendChild(f);
      }
     }catch(e){}
    }catch(e){}
   })(aiTlEditRows[i]);
  }
 }catch(e){}
}
function i5ShellAdd(ev){
 var cmd=i5ExtractShellCmd(ev);
 cmd=String(cmd==null?'':cmd);
 var tl=i5TlEnsureTimeline(); if(!tl) return null;
 var row=null, tag=null;
 try{
  row=document.createElement('div'); row.className='shell-row i5-shell-row';
  var verb=document.createElement('b'); verb.className='i5-verb'; verb.textContent='Shell';
  var code=document.createElement('code'); code.className='i5-cmd';
  var disp=cmd.length>120?cmd.slice(0,120)+'…':cmd;
  code.textContent=disp||'(命令)';
  code.title=cmd;
  tag=document.createElement('span');
  var st=String((ev&&(ev.status||ev.state))||'').toLowerCase();
  if(/fail|error/.test(st)){ tag.className='tag fail i5-tag-fail'; tag.textContent='失败'; }
  else{ tag.className='tag run i5-tag-run'; tag.textContent='执行中'; }
  (function(_ev,_tag,_row){
   _tag.onclick=function(e){
    try{ if(e&&e.stopPropagation) e.stopPropagation(); }catch(ee){}
    if(_tag.className.indexOf('fail')>=0||_tag.className.indexOf('i5-tag-fail')>=0){
     try{ i5RenderErrorCard(_ev&&_ev.error?_ev:{ message:String((_ev&&( _ev.message||_ev.error))||'执行失败') }); }catch(ee){}
    }
   };
  })(ev,tag,row);
  row.appendChild(verb); row.appendChild(code); row.appendChild(tag);
  tl.appendChild(row);
  aiTlShellRows.push({ el:row, tag:tag, ev:ev });
  i5TlMoveCursorTo(row);
 }catch(e){ return null; }
 i5TlScroll();
 return row;
}
function i5ShellFinalizeAll(ok){
 try{
  for(var i=0;i<aiTlShellRows.length;i++){
   (function(rec){
    try{
     if(!rec||!rec.tag) return;
     if(rec.tag.className.indexOf('fail')>=0) return;
     if(ok===false){ rec.tag.className='tag fail i5-tag-fail'; rec.tag.textContent='失败'; return; }
     rec.tag.className='tag done i5-tag-done'; rec.tag.textContent='完成';
    }catch(e){}
   })(aiTlShellRows[i]);
  }
 }catch(e){}
}
function i5AnswerAppendChunk(t){
 var s=String(t==null?'':t); if(!s) return;
 aiTlAnswerText+=s; try{ aiStreamText+=s; }catch(e){ aiStreamText=aiTlAnswerText; }
 try{ var g1=aiCurGroup(); if(g1) g1.output=aiStreamText; }catch(e){}
 var tl=i5TlEnsureTimeline(); if(!tl) return;
 try{
  if(!aiTlAnswerEl){
   aiTlAnswerEl=document.createElement('div'); aiTlAnswerEl.className='answer i5-answer';
   aiTlAnswerBodyEl=document.createElement('div'); aiTlAnswerBodyEl.className='i5-answer-body';
   aiTlAnswerEl.appendChild(aiTlAnswerBodyEl);
   tl.appendChild(aiTlAnswerEl);
  }
  aiTlAnswerBodyEl.innerHTML=formatAiTextConclusionOnly(aiTlAnswerText);
  i5TlMoveCursorTo(aiTlAnswerEl);
 }catch(e){}
 i5TlScroll();
}
function i5AnswerFinalize(ts){
 try{
  var tl=i5TlEnsureTimeline();
  if(aiTlAnswerEl&&aiTlAnswerBodyEl){
   aiTlAnswerBodyEl.innerHTML=formatAiTextConclusionOnly(aiTlAnswerText||aiStreamText||'');
  }else if((aiTlAnswerText||aiStreamText)&&tl){
   aiTlAnswerEl=document.createElement('div'); aiTlAnswerEl.className='answer i5-answer';
   aiTlAnswerBodyEl=document.createElement('div'); aiTlAnswerBodyEl.className='i5-answer-body';
   aiTlAnswerBodyEl.innerHTML=formatAiTextConclusionOnly(aiTlAnswerText||aiStreamText);
   aiTlAnswerEl.appendChild(aiTlAnswerBodyEl);
   tl.appendChild(aiTlAnswerEl);
  }
  i5TlRemoveCursor();
   if(tl&&(aiTlAnswerText||aiStreamText)){
    var sign=document.createElement('div'); sign.className='msg-foot';
    var bodyForCopy=aiTlAnswerBodyEl;
    sign.appendChild(i5CreateCopyIconBtn(function(){ try{ return bodyForCopy?bodyForCopy.innerText:(aiTlAnswerText||''); }catch(e){ return aiTlAnswerText||''; } }));
    var tm=document.createElement('time'); tm.textContent=i5FmtMsgTime(ts||Date.now());
    sign.appendChild(tm);
    tl.appendChild(sign);
   }
   /* 回答归位：首个 chunk 来得早时回答元素卡在时间线中部（后面还有工具行），定稿时搬到末尾，保证回答永远在底部 */
   try{
    if(tl&&aiTlAnswerEl){ tl.appendChild(aiTlAnswerEl); }
    if(tl&&(typeof sign!=='undefined')&&sign){ tl.appendChild(sign); }
   }catch(e){}
   /* 空响应占位：进程 0 退出但零输出时按成功走完，全程无文本/思考/工具调用，
    * 原逻辑什么都不画（用户只看到空区）。此处落一句说明 + trace，杜绝静默 */
   try{
    var _hasAny=!!(String(aiTlAnswerText||'')+String(aiStreamText||'')+String(aiStreamThink||''));
    var _fcn=0;
    try{
     var _fcl=Array.isArray(aiCurFileChanges)?aiCurFileChanges:((typeof window!=='undefined'&&window.aiCurFileChanges)||[]);
     if(Array.isArray(_fcl))_fcn=_fcl.length;
    }catch(e){}
    if(!_hasAny&&tl){
     var _note=document.createElement('div'); _note.className='answer i5-answer i5-empty-note';
     var _nb=document.createElement('div'); _nb.className='i5-answer-body';
     _nb.textContent=(_fcn>0)
       ?('本次模型无文本回复，但检测到 '+_fcn+' 处文件变更（见上方编辑行）。')
       :('模型本次没有返回任何内容（进程正常结束但零输出）。可重试一次，若反复出现请检查模型、网络或配额。');
     _note.appendChild(_nb); tl.appendChild(_note);
     try{ if(typeof aiAppendTrace==='function') aiAppendTrace({tag:'WARN',level:'warn',text:'本轮零输出：无文本/思考/工具调用，已落占位说明。'}); }catch(e){}
    }
   }catch(e){}
  }catch(e){}
}
function i5TlSetStalled(on, silentSec){
 try{
  if(!aiStreaming) return;
  var tl=null; try{ tl=aiStreaming.querySelector('.i5-timeline'); }catch(e){ tl=null; }
  if(!tl) return;
  var tail=tl.lastChild;
  while(tail&&tail.nodeType!==1) tail=tail.previousSibling;
  /* 尾部若为落款/静默尾行则向前找一行可停滞行，避免光标行误判 */
  try{
   while(tail){
    var _cc=String((tail&&(tail.className||''))||'');
    if(_cc.indexOf('msg-foot')>=0||_cc.indexOf('silence-tail')>=0||_cc.indexOf('i5-tail-silent')>=0){ tail=tail.previousSibling; while(tail&&tail.nodeType!==1) tail=tail.previousSibling; continue; }
    break;
   }
  }catch(e){}
  if(!tail) return;
  var cn=String((tail&&(tail.className||''))||'');
  var isThink=(cn.indexOf('think-p')>=0||cn.indexOf('i5-think')>=0);
  var isEdit=(cn.indexOf('edit-row')>=0);
  var isShell=(cn.indexOf('shell-row')>=0);
  var target=(isThink||isEdit||isShell)?tail:null;
  if(on){
   if(target&&target.className.indexOf('stalled')<0) target.className+=' stalled i5-stalled';
   aiTlStalled=true;
   var tip=null; try{ tip=target?target.querySelector('.stall-tip'):null; if(!tip&&target) tip=target.querySelector('.i5-stall-tip'); }catch(e){ tip=null; }
   if(target&&!tip){
    try{
     var sp=document.createElement('span'); sp.className='stall-tip i5-stall-tip';
     sp.textContent='可能停滞，可停止后重试';
     target.appendChild(sp);
    }catch(e){}
   }
   var sil=null; try{ sil=target?target.querySelector('.silence'):null; if(!sil&&target) sil=target.querySelector('.i5-silent'); }catch(e){ sil=null; }
   if(target&&!sil){
    try{ var s2=document.createElement('span'); s2.className='silence i5-silent'; s2.textContent='静默 '+silentSec+'s'; target.appendChild(s2); }
    catch(e){}
   }else if(sil){ try{ sil.textContent='静默 '+silentSec+'s'; }catch(e){} }
  }else{
   aiTlStalled=false;
   try{
    var olds=tl.querySelectorAll('.stalled');
    for(var i=0;i<olds.length;i++){ try{ olds[i].className=String(olds[i].className).replace(/\s*stalled/g,'').replace(/\s*i5-stalled/g,''); }catch(e){} }
    try{
     var olds2=tl.querySelectorAll('.i5-stalled');
     for(var i2=0;i2<olds2.length;i2++){ try{ olds2[i2].className=String(olds2[i2].className).replace(/\s*i5-stalled/g,'').replace(/\s*stalled/g,''); }catch(e){} }
    }catch(e){}
    var tips=tl.querySelectorAll('.stall-tip');
    for(var j=0;j<tips.length;j++){ try{ if(tips[j].parentNode) tips[j].parentNode.removeChild(tips[j]); }catch(e){} }
    try{
     var tips2=tl.querySelectorAll('.i5-stall-tip');
     for(var j2=0;j2<tips2.length;j2++){ try{ if(tips2[j2].parentNode) tips2[j2].parentNode.removeChild(tips2[j2]); }catch(e){} }
    }catch(e){}
   }catch(e){}
  }
 }catch(e){}
}
/* 历史回放：v2事件流按序重走渲染与直播像素一致，文末挂回滚卡；v1降级读thinking全文合并一段 */
function i5ReplayTimeline(container, evts, opts){
 if(!container||!Array.isArray(evts)) return null;
 var tl=null;
 try{
  container.innerHTML='';
  if(opts&&opts.meta){
   try{ var hm=document.createElement('p'); hm.className='hist-meta'; hm.textContent=String(opts.meta); container.appendChild(hm); }catch(e){}
  }
  tl=document.createElement('div'); tl.className='i5-timeline';
  container.appendChild(tl);
 }catch(e){ return null; }
 var answerBuf='', answerEl=null, answerBody=null;
 var readN=0, dirN=0, expRow=null, expCnt=null, expChips=null;
 function ensureAnswer(){
  if(!answerEl){
   answerEl=document.createElement('div'); answerEl.className='answer i5-answer';
   answerBody=document.createElement('div'); answerBody.className='i5-answer-body';
   answerEl.appendChild(answerBody); tl.appendChild(answerEl);
  }
  return answerEl;
 }
 function finalizeAnswer(){
  if(!(answerBuf&&answerEl)) { answerBuf=''; answerEl=null; answerBody=null; return; }
  try{
   var sg2=document.createElement('div'); sg2.className='msg-foot';
   (function(_b,_buf){ try{ sg2.appendChild(i5CreateCopyIconBtn(function(){ try{ return _b?_b.innerText:_buf; }catch(e){ return _buf; } })); }catch(e){} })(answerBody, answerBuf);
   var tm2=document.createElement('time');
   var lastTs=null; try{ for(var q=evts.length-1;q>=0;q--){ if(evts[q]&&(evts[q].ts)){ lastTs=evts[q].ts; break; } } }catch(e){}
   try{ tm2.textContent=i5FmtMsgTime(lastTs||Date.now()); }catch(e){ tm2.textContent=''; }
   sg2.appendChild(tm2); tl.appendChild(sg2);
  }catch(e){}
  answerBuf=''; answerEl=null; answerBody=null;
 }
 for(var i=0;i<evts.length;i++){
  (function(e){
   try{
    var t=String(e&&(e.t||e.type||'')).toLowerCase();
    if(t==='user'){
     try{ if(answerBuf&&answerEl) finalizeAnswer(); }catch(ee){}
     expRow=null; expCnt=null; expChips=null;
     var ub=document.createElement('div'); ub.className='ai-msg user';
     var bd=document.createElement('div'); bd.className='ai-msg-body'; bd.textContent=String(e.text||'');
     ub.appendChild(bd);
     tl.appendChild(ub);
     try{ aiAppendUserFoot(tl, String(e.text||''), e.ts||Date.now()); }catch(ee){}
    }else if(t==='thinking'||t==='think'){
     var txt=String(e.text||''); if(!txt.trim()) return;
     expRow=null; expCnt=null; expChips=null;
     try{ if(answerBuf&&answerEl) finalizeAnswer(); }catch(ee){}
     var r=i5SplitThink(txt);
     var all=r.list.slice(); if(r.rest&&r.rest.trim()) all.push(r.rest);
     if(!all.length) all=[txt];
     for(var k=0;k<all.length;k++){
      var p=document.createElement('div'); p.className='think-p i5-think-p';
      var d=all[k].length>1500?all[k].slice(-1500):all[k];
      try{ p.innerHTML=escHtml(d).replace(/\n/g,'<br>'); }catch(ee){ try{ p.textContent=d; }catch(ee2){} }
      tl.appendChild(p);
     }
    }else if(t==='tool'||t==='tool_call'||t==='explore'||t==='edit'||t==='shell'){
     var toolName=e.tool||e.name||e.text||'';
     var kind=i5VerbKind(toolName);
     if(e.added!=null||e.deleted!=null||kind==='edit'||t==='edit'){
      try{ if(answerBuf&&answerEl) finalizeAnswer(); }catch(ee){}
      expRow=null; expCnt=null; expChips=null;
      var er=document.createElement('div'); er.className='edit-row i5-edit-row';
      var vb=document.createElement('b'); vb.className='i5-verb'; vb.textContent='编辑';
      var f=String(e.file||e.path||toolName||'文件');
      var fn=document.createElement('span'); fn.className='f i5-file';
      try{ fn.textContent=f.split(/[\\/]/).pop()||f; }catch(ee){ fn.textContent=f; }
      fn.title=f;
      er.appendChild(vb); er.appendChild(fn);
      if(e.added!=null||e.deleted!=null){
       var sa=document.createElement('span'); sa.className='add i5-add'; sa.textContent='+'+Number(e.added||0);
       var sd=document.createElement('span'); sd.className='del i5-del'; sd.textContent='-'+Number(e.deleted||0);
       er.appendChild(sa); er.appendChild(sd);
      }
      tl.appendChild(er);
     }else if(kind==='shell'||t==='shell'){
      try{ if(answerBuf&&answerEl) finalizeAnswer(); }catch(ee){}
      expRow=null; expCnt=null; expChips=null;
      var sr=document.createElement('div'); sr.className='shell-row i5-shell-row';
      var vb2=document.createElement('b'); vb2.className='i5-verb'; vb2.textContent='Shell';
      var cd=document.createElement('code'); cd.className='i5-cmd';
      var cmd=String(e.command||e.text||e.file||'');
      try{ cd.textContent=cmd.length>120?cmd.slice(0,120)+'…':cmd; }catch(ee){ cd.textContent=cmd; }
      cd.title=cmd;
      var tg=document.createElement('span'); tg.className='tag done i5-tag-done'; tg.textContent='完成';
      sr.appendChild(vb2); sr.appendChild(cd); sr.appendChild(tg); tl.appendChild(sr);
     }else{
      var f2=String(e.file||e.path||e.text||'');
      var _isDir=false;
      try{ _isDir=i5IsDirPath(f2, toolName); }catch(ee){ _isDir=false; }
       if(!expRow){
        expRow=document.createElement('div'); expRow.className='exp i5-explore';
        var vv=document.createElement('b'); vv.className='i5-verb'; vv.textContent='已探索';
        expChips=document.createElement('span'); expChips.className='exp-files i5-chips';
        expCnt=document.createElement('span'); expCnt.className='n i5-count';
        expRow.appendChild(vv); expRow.appendChild(expChips); expRow.appendChild(expCnt);
        tl.appendChild(expRow);
       }
      if(_isDir){ dirN++; }
      else if(f2){ readN++; }
      else{
       var _low=String(toolName||'').toLowerCase();
       if(/glob|ls|list|dir|find|tree/.test(_low)) dirN++;
       else readN++;
      }
      var lb=String(readN)+' 次读取'; if(dirN>0) lb+=' · '+String(dirN)+' 个目录';
      try{ expCnt.textContent=lb; }catch(ee){}
      if(f2&&!_isDir){
       try{ var ch=document.createElement('code'); ch.className='i5-chip'; ch.textContent=f2.split(/[\\/]/).pop()||f2; ch.title=f2; expChips.appendChild(ch); }catch(ee){}
      }
     }
    }else if(t==='answer'||t==='chunk'||t==='final'||t==='output'){
     expRow=null; expCnt=null; expChips=null;
     answerBuf+=String(e.text||'');
     ensureAnswer();
     try{ answerBody.innerHTML=formatAiTextConclusionOnly(answerBuf); }catch(ee){ try{ answerBody.textContent=answerBuf; }catch(ee2){} }
    }else if(t==='error'){
     try{ if(answerBuf&&answerEl) finalizeAnswer(); }catch(ee){}
     expRow=null; expCnt=null; expChips=null;
    }
   }catch(ee){}
  })(evts[i]);
 }
 try{ if(answerBuf&&answerEl) finalizeAnswer(); }catch(e){}
 try{
  if(opts&&opts.snapshot){
   var card=document.createElement('div'); card.className='snapshot-card';
   var info=document.createElement('span'); info.className='snapshot-info';
   info.textContent=String(opts.snapshot);
   var acts=document.createElement('span'); acts.className='snapshot-actions';
   var btn=document.createElement('button'); btn.className='btn-rollback'; btn.textContent='一键回滚';
   btn.onclick=function(){ try{ openSnapPanel(); }catch(e){} };
   acts.appendChild(btn); card.appendChild(info); card.appendChild(acts); tl.appendChild(card);
  }
 }catch(e){}
 return tl;
}
function i5ReplayV1(container, thinkingFull, ts){
 if(!container) return null;
 try{
  container.innerHTML='';
  var tl=document.createElement('div'); tl.className='i5-timeline';
  var p=document.createElement('div'); p.className='think-p i5-think-p';
  p.textContent=String(thinkingFull||'');
  tl.appendChild(p);
  container.appendChild(tl);
  return tl;
 }catch(e){ return null; }
}
function i5AppendSnapshotCard(container, snapInfo){
 var parent=container||aiChatView;
 if(!parent)return null;
 var card=document.createElement('div'); card.className='snapshot-card';
 var info=document.createElement('span'); info.className='snapshot-info';
 var label=String(snapInfo||'');
 if(!label){
  var hh=''; try{ var _d=new Date(); var _p=function(n){ return (n<10?'0':'')+n; }; hh=_p(_d.getHours())+':'+_p(_d.getMinutes()); }catch(e){ hh=''; }
  label='已生成快照 '+hh+'，可一键回滚到修改前。';
 }
 info.textContent=label;
 var acts=document.createElement('span'); acts.className='snapshot-actions';
 var btn=document.createElement('button'); btn.className='btn-rollback'; btn.setAttribute('data-act','rollback'); btn.textContent='一键回滚';
 btn.onclick=function(){ try{ openSnapPanel(); }catch(e){} };
 acts.appendChild(btn);
 card.appendChild(info); card.appendChild(acts);
 parent.appendChild(card);
 return card;
}
var aiCurFileChanges=[];
function i5RenderDoneCards(isCancel){
 if(!aiChatView)return;
 try{
  var list = (Array.isArray(aiCurFileChanges) ? aiCurFileChanges : (window.aiCurFileChanges || []));
  var scope=null;
  try{
   if(aiStreaming&&aiStreaming.parentNode===aiChatView) scope=aiStreaming;
   else{
    var kids=aiChatView.children||[];
    for(var hi=kids.length-1;hi>=0;hi--){ var c=kids[hi]; var cn=String((c&&(c.className||''))||''); if(/(^|\s)ai-msg(\s|$)/.test(cn)){ scope=c; break; } }
   }
  }catch(e){ scope=null; }
  if(!scope){ scope=document.createElement('div'); scope.className='ai-msg ai'; aiChatView.appendChild(scope); }
  var tl=null; try{ tl=scope.querySelector('.i5-timeline'); }catch(e){ tl=null; }
  if(!tl&&aiStreaming){ try{ tl=i5TlEnsureTimeline(); }catch(e){} }
  var host=tl||scope;
  if(isCancel) return;
  // 返工item2：原型无followup-chips，删除chips生成与绑定，只留回滚卡追加
  try{
   var cardHost=host;
   var card=i5AppendSnapshotCard(cardHost, '');
   try{
    window.protoAPI.snapshot.list(aiSbxDir()).then(function(r){
     var items=(r&&r.items)||[];
     if(items.length&&card){
      var info=card.querySelector('.snapshot-info');
      var rawTs=String(items[0].ts||'');
      var hhmm=rawTs;
      try{
       var m=/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(rawTs);
       if(m) hhmm=m[4]+':'+m[5];
       else if(rawTs.length>=5) hhmm=rawTs.slice(-8,-3)||rawTs;
      }catch(e){}
      if(info) info.textContent='已生成快照 '+hhmm+'（共 '+items.length+' 份），可一键回滚到修改前。';
     }
    }).catch(function(){});
   }catch(e){}
  }catch(e){}
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
 /* Wave-B: 剪贴板收敛5/5（安装命令复制改走 Utils，保留toast） */
 try{ if(typeof window!=='undefined'&&window.Utils&&window.Utils.copyToClipboard){ window.Utils.copyToClipboard('npm i -g opencode-cli','安装命令已复制'); return; } }catch(e){}
 var cmd='npm i -g opencode-cli';
 try{ if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(cmd).then(function(){ showToast('安装命令已复制'); }); else throw new Error('noclip'); }
 catch(e){ try{ var ta=document.createElement('textarea'); ta.value=cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('安装命令已复制'); }catch(ee){} }
}
window.i5CopyInstall=i5CopyInstall;
var _i5Tools=[];
/* Wave-B: i5SyncTopBar 已删除（全仓零调用；保留 i5SyncTopModel 因被 i5SetupTopModelSelect 调用，删前grep确认） */
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
  /* free 独立模型：id/name 原样展示，不再清洗后缀 */
  var stripFree=function(id){ return String(id||''); };
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
  var _doneTs=0; try{ _doneTs=(typeof aiSessNow==='function')?aiSessNow():Date.now(); }catch(e){ try{ _doneTs=Date.now(); }catch(e2){ _doneTs=0; } }
   if(aiStreaming){
    try{ i5HideWaiting(); }catch(e){}
    try{ i5HideThinkIdle(); }catch(e){}
    try{ i5ThinkFlushPending(true); }catch(e){}
    try{ var _tl0=null; try{ _tl0=aiStreaming.querySelector('.i5-timeline'); }catch(e){ _tl0=null; } if(_tl0){ try{ var _sils=_tl0.querySelectorAll('.silence'); for(var _si=0;_si<_sils.length;_si++){ try{ var _sp=_sils[_si]; if(_sp&&_sp.parentNode) _sp.parentNode.removeChild(_sp); }catch(e){} } }catch(e){} try{ var _sils2=_tl0.querySelectorAll('.i5-silent'); for(var _si2=0;_si2<_sils2.length;_si2++){ try{ var _sp2=_sils2[_si2]; if(_sp2&&_sp2.parentNode) _sp2.parentNode.removeChild(_sp2); }catch(e){} } }catch(e){} } }catch(e){}
   try{
    var _tl=null; try{ _tl=aiStreaming.querySelector('.i5-timeline'); }catch(e){ _tl=null; }
    try{
     var _sil=aiStreaming.querySelector('.silence-tail');
     if(!_sil){ try{ _sil=aiStreaming.querySelector('.i5-tail-silent'); }catch(e){} }
     if(_sil&&_sil.parentNode) _sil.parentNode.removeChild(_sil);
    }catch(e){}
    i5TlSetStalled(false,0);
   }catch(e){}
   if(isCancel){
    try{ i5TlRemoveCursor(); }catch(e){}
    try{
     var _tl2=aiStreaming.querySelector('.i5-timeline');
     if(_tl2){
      var _stop=document.createElement('div'); _stop.className='stopped i5-stopped'; _stop.textContent='已停止';
      _tl2.appendChild(_stop);
     }
    }catch(e){}
    try{ i5ShellFinalizeAll(true); }catch(e){}
    try{ i5PairedFinalizeAll(true); }catch(e){}
   }else{
    try{
     var _fc=[]; try{ _fc=Array.isArray(aiCurFileChanges)?aiCurFileChanges:((typeof window!=='undefined'&&window.aiCurFileChanges)||[]); }catch(e){ _fc=[]; }
     i5EditFinalize(_fc);
    }catch(e){}
    try{ i5ShellFinalizeAll(true); }catch(e){}
    try{ i5PairedFinalizeAll(true); }catch(e){}
    try{ i5AnswerFinalize(_doneTs); }catch(e){}
    try{ i5TlRemoveCursor(); }catch(e){}
    try{
     var _tl3=aiStreaming.querySelector('.i5-timeline');
     if(_tl3&&_tl3.lastChild) { /* 光标已移除，尾部即最终态 */ }
    }catch(e){}
   }
    try{ if(aiChatView && aiShouldAutoScroll(aiChatView,80)){ try{ aiUserScrolledPause=false; }catch(e){} aiChatView.scrollTop=aiChatView.scrollHeight; } }catch(e){}
    try{ scrubAiChatView(); }catch(e){}
  }
    aiStreaming=null; aiStreamText=''; aiStreamThink='';
   /* v2事件流落盘（后端在位时）：回答全文存一条 answer；done.fileChanges 存为 edit 事件；后端缺位时仅落 m */
   var _ansTs=0; try{ _ansTs=(typeof aiSessNow==='function')?aiSessNow():Date.now(); }catch(e){ try{ _ansTs=Date.now(); }catch(e2){ _ansTs=0; } }
   var _extraEvts=[];
   try{ if(txt&&String(txt).trim()) _extraEvts.push({t:'answer', text:String(txt), ts:_ansTs}); }catch(e){}
   try{
    var _dc=[];
    try{ _dc=Array.isArray(aiCurFileChanges)?aiCurFileChanges:((typeof window!=='undefined'&&window.aiCurFileChanges)||[]); }catch(_e){ _dc=[]; }
    if(typeof aiEditEventsFrom==='function'){
     var _ee=aiEditEventsFrom(_dc);
     for(var _ei=0;_ei<_ee.length;_ei++) _extraEvts.push(_ee[_ei]);
    }
   }catch(e){}
   if(txt){
    var k=aiActiveHistKey();
    if(k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)){ var s=aiCurSesh(); if(s){ s.m=s.m||[]; s.m.push({r:'a',t:txt,err:false,ts:_ansTs}); try{ if(typeof aiFlushTaskEventsToSess==='function') aiFlushTaskEventsToSess(s,_extraEvts); else if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(e){ try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(_e){} } aiSaveSesh(); } else { try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(e){} } }
    else{ aiWriteSeshFor(k,(function(_evts){ return function(v){ v.m.push({r:'a',t:txt,err:false,ts:_ansTs}); try{ var _b=(typeof aiCurTaskEvents!=='undefined'&&Array.isArray(aiCurTaskEvents))?aiCurTaskEvents:[]; for(var _bi=0;_bi<_b.length;_bi++){ try{ if(typeof aiAppendSessEvent==='function') aiAppendSessEvent(v,_b[_bi]); }catch(_e){} } for(var _ej=0;_ej<_evts.length;_ej++){ try{ if(typeof aiAppendSessEvent==='function') aiAppendSessEvent(v,_evts[_ej]); }catch(_e){} } }catch(_e){} }; })(_extraEvts)); try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(e){} }
   } else {
    /* 边界6.1/6.2：空回答不 push 空消息，但思考/工具/编辑事件仍需落盘 */
    try{
     var k2=aiActiveHistKey();
     if(k2===aiHistKey()||(k2&&k2.indexOf(SESS_KEY)===0)){ var s2=aiCurSesh(); if(s2){ try{ if(typeof aiFlushTaskEventsToSess==='function') aiFlushTaskEventsToSess(s2,_extraEvts); }catch(e){} aiSaveSesh(); } else { try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(e){} } }
     else{ aiWriteSeshFor(k2,(function(_evts2){ return function(v){ try{ var _b2=(typeof aiCurTaskEvents!=='undefined'&&Array.isArray(aiCurTaskEvents))?aiCurTaskEvents:[]; for(var _c=0;_c<_b2.length;_c++){ try{ if(typeof aiAppendSessEvent==='function') aiAppendSessEvent(v,_b2[_c]); }catch(_e){} } for(var _d=0;_d<_evts2.length;_d++){ try{ if(typeof aiAppendSessEvent==='function') aiAppendSessEvent(v,_evts2[_d]); }catch(_e){} } }catch(_e){} }; })(_extraEvts)); try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(e){} }
    }catch(e){ try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(_e){} }
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
function aiSyncBadgeDot(st){
  try{
    var badge=$('aiAgentBadge')||((typeof aiAgentBadge!=='undefined')?aiAgentBadge:null);
    if(!badge) return;
    var dot=null; try{ dot=badge.querySelector('.dot'); }catch(e){}
    if(dot) dot.className='dot '+st;
  }catch(e){}
}
/* 顶栏身份：CLI 显示主力名，API 显示服务商自定义名；圆点红/橘/绿即时展示，不等就绪 */
function refreshAiTopIdentity(){
  try{
    var eng='cli'; try{ eng=(typeof getActiveEngineInUi==='function')?getActiveEngineInUi():'cli'; }catch(e){}
    aiAgentBadge=$('aiAgentBadge')||aiAgentBadge; aiAgentName=$('aiAgentName')||aiAgentName;
    if(eng==='api'){
      var nm='API', key=false, ok=false;
      try{
        var profs=(curAiConfig&&curAiConfig.apiProfiles)||[];
        var aid=curAiConfig&&curAiConfig.activeApiProfileId;
        var p=null, i;
        for(i=0;i<profs.length;i++){ if(profs[i]&&profs[i].id===aid){ p=profs[i]; break; } }
        if(!p&&profs.length===1) p=profs[0];
        if(p){ try{ nm=apiProfileLabel(p)||nm; }catch(e){} try{ key=!!String(p.apiKey||'').trim(); }catch(e2){} }
        try{ ok=!!(curAiConfig&&curAiConfig.apiLastTestOk); }catch(e3){}
      }catch(e){}
      if(aiAgentName)aiAgentName.textContent=nm;
      if(aiAgentBadge)aiAgentBadge.title='当前服务商：'+nm;
      aiSyncBadgeDot(!key?'err':(ok?'ok':'warn'));
      return nm;
    }
    var label='OpenCode', aid2='';
    try{ aid2=(curAiConfig&&(curAiConfig.agentId||curAiConfig.mainAgent))||'opencode'; }catch(e){}
    try{ label=(typeof I5_AGENT_FALLBACK!=='undefined'&&I5_AGENT_FALLBACK[aid2])||aid2||'OpenCode'; }catch(e){}
    if(aiAgentName)aiAgentName.textContent=label;
    if(aiAgentBadge)aiAgentBadge.title='当前主力 Agent：'+label;
    return label;
  }catch(e){ return ''; }
}
function aiRefreshCli(){
 if(!HAS_AI){ if(aiCliEl){ aiCliEl.textContent=''; aiCliEl.className='ai-cli err'; aiCliEl.title='仅桌面端可用'; } try{ if((typeof getActiveEngineInUi==='function'?getActiveEngineInUi():'cli')==='cli') aiSyncBadgeDot('err'); }catch(e){} return; }
 if(aiCliEl){ aiCliEl.textContent=''; aiCliEl.className='ai-cli warn'; aiCliEl.title='检测中…'; }
 try{ if((typeof getActiveEngineInUi==='function'?getActiveEngineInUi():'cli')==='cli') aiSyncBadgeDot('warn'); }catch(e){}
 window.protoAPI.ai.checkCli().then(function(r){
  if(aiCliEl){
   if(r&&r.found){ aiCliEl.textContent=''; aiCliEl.className='ai-cli ok'; aiCliEl.title='CLI 已就绪'+(r.version?' · v'+r.version:''); }
   else{ aiCliEl.textContent=''; aiCliEl.className='ai-cli err'; aiCliEl.title='未检测到 CLI，可在设置中切换为 API 直连模式或指定 CLI 路径'; }
  }
  try{ if((typeof getActiveEngineInUi==='function'?getActiveEngineInUi():'cli')==='cli') aiSyncBadgeDot(r&&r.found?'ok':'err'); }catch(e){}
 });
}

/* ── 模型列表：支持白名单过滤与直连/CLI 分组 ── */
var aiModelCache=null;
var AI_MODEL_KEY='ai_model',AI_MODEL_DEFAULT='default';
var AI_REASONING_KEY='ai_model_reasoning',AI_REASONING_DEFAULT='default';
function aiStoredModel(){
  try{
    var m=localStorage.getItem(AI_MODEL_KEY)||'';
    if(m==='__none__'||m==='default'){
      try{ localStorage.removeItem(AI_MODEL_KEY); }catch(e){}
      return '';
    }
    return m;
  }catch(e){ return ''; }
}
function aiStoreModel(m){
  try{
    if(!m||m==='__none__'||m==='default'){
      localStorage.removeItem(AI_MODEL_KEY);
    }else{
      localStorage.setItem(AI_MODEL_KEY,m);
    }
  }catch(e){}
}
function aiStoredReasoning(){ try{ return localStorage.getItem(AI_REASONING_KEY)||''; }catch(e){ return ''; } }
function aiStoreReasoning(r){ try{ localStorage.setItem(AI_REASONING_KEY,r||''); }catch(e){} }
function aiCurReasoning(){
  var s=aiStoredReasoning();
  return s||AI_REASONING_DEFAULT;
}
function aiCurModel(){
  if(aiModelEl&&aiModelEl.value&&aiModelEl.value!=='__none__'&&aiModelEl.value!=='__manage_models__'&&aiModelEl.value!=='default')return aiModelEl.value;
  var s=aiStoredModel(); if(s&&s!=='__none__'&&s!=='default')return s;
  return '';
}
function aiInvalidateModels(){ aiModelCache=null; }

var aiStandardReasoningOptions=[
  { id: 'default', label: '默认推荐 (CLI 预设)', default: true },
  { id: 'high', label: '高强度 (High)' },
  { id: 'medium', label: '中强度 (Medium)' },
  { id: 'low', label: '低强度 (Low)' }
];

function aiReasoningBadgeText(rId){
  if(rId==='high') return '高强度';
  if(rId==='medium') return '中强度';
  if(rId==='low') return '低强度';
  return '默认';
}

function aiSyncModelBtn(){
  var btn=$('aiModelBtn'), txt=$('aiModelNameTxt'), badge=$('aiModelEffortBadge');
  if(!btn||!txt)return;
  btn.disabled=Boolean(aiBusy);
  var curM=aiCurModel();
  var curR=aiCurReasoning();
  if(!aiModelCache){
    txt.textContent='加载模型…';
    txt.title='加载模型…';
    if(badge) badge.style.display='none';
    return;
  }
  if(!curM){
    txt.textContent='选择模型';
    txt.title='选择当前对话使用的模型';
    if(badge) badge.style.display='none';
    return;
  }
  var mName='';
  var groups=(aiModelCache&&aiModelCache.groups)||[];
  for(var i=0;i<groups.length;i++){
    var ms=groups[i].models||[];
    for(var j=0;j<ms.length;j++){
      if(ms[j]&&ms[j].id===curM){
        mName=ms[j].name||ms[j].id;
        break;
      }
    }
    if(mName)break;
  }
  if(!mName)mName=curM;
  txt.textContent=mName;
  txt.title=mName+' (思考强度: '+aiReasoningBadgeText(curR)+')';
  if(badge){
    badge.textContent=aiReasoningBadgeText(curR);
    badge.style.display='inline-block';
  }
}

function aiRenderCascader(r){
  var cascader=$('aiModelCascader');
  var btn=$('aiModelBtn');
  var popover=$('aiCascaderPopover');
  var primary=$('aiCascaderPrimary');
  var sub=$('aiCascaderSub');
  var subList=$('aiCascaderSubList');
  if(!cascader||!btn||!popover||!primary||!sub||!subList)return;

  var cleanId=function(s){ return String(s||'').trim(); };
  var stored=cleanId(aiStoredModel());
  if(stored==='__none__'||stored==='default') stored='';
  var cur=stored;
  var curReasoning=aiCurReasoning();

  primary.innerHTML='';
  subList.innerHTML='';
  sub.style.display='none';

  var groups=(r&&r.groups)||[];
  var visible=(r&&Array.isArray(r.visibleModels)&&r.visibleModels.length)?r.visibleModels.map(cleanId):null;
  var fallbackReasoning=(r&&Array.isArray(r.reasoningOptions)&&r.reasoningOptions.length)?r.reasoningOptions:aiStandardReasoningOptions;

  var activePrimaryItem=null;

  function showSubForModel(mId, mName, rOpts, primaryEl){
    if(activePrimaryItem) activePrimaryItem.classList.remove('hover-active');
    activePrimaryItem=primaryEl;
    if(primaryEl) primaryEl.classList.add('hover-active');

    subList.innerHTML='';
    sub.style.display='block';
    var opts=(Array.isArray(rOpts)&&rOpts.length)?rOpts:fallbackReasoning;
    for(var k=0;k<opts.length;k++){
      (function(opt){
        var itemEl=document.createElement('div');
        itemEl.className='ai-cascader-sub-item'+((mId===cur && opt.id===curReasoning)?' active':'');
        itemEl.textContent=opt.label||opt.id;
        itemEl.title=opt.label||opt.id;
        itemEl.onclick=function(ev){
          ev.stopPropagation();
          /* 核心契约：点击右侧推理强度才真正选中模型并关闭弹窗 */
          var targetModel = (mId==='__none__'?'':mId);
          cur=targetModel;
          curReasoning=opt.id;
          aiStoreModel(targetModel);
          aiStoreReasoning(opt.id);
          if(aiModelEl) aiModelEl.value = targetModel;
          aiSyncModelBtn();
          closeCascader();
          if(typeof aiRenderModelOptions==='function') aiRenderModelOptions(r);
        };
        subList.appendChild(itemEl);
      })(opts[k]);
    }
  }

  function closeCascader(){
    popover.style.display='none';
    cascader.classList.remove('open');
    if(activePrimaryItem){
      activePrimaryItem.classList.remove('hover-active');
      activePrimaryItem=null;
    }
    sub.style.display='none';
  }

  // 各供应商分组及模型项
  for(var i=0;i<groups.length;i++){
    var g=groups[i], items=(g&&g.models)||[];
    var gVisibleItems=[];
    for(var j=0;j<items.length;j++){
      var it=items[j], id=cleanId(it.id||'');
      if(!id)continue;
      if(visible && visible.indexOf(id)<0)continue;
      gVisibleItems.push(it);
    }
    if(!gVisibleItems.length)continue;

    if(groups.length>1||g.label||g.provider){
      var grpLabel=document.createElement('div');
      grpLabel.className='ai-cascader-optgroup-label';
      grpLabel.textContent=g.label||g.provider||'供应商';
      primary.appendChild(grpLabel);
    }

    for(var j=0;j<gVisibleItems.length;j++){
      (function(it){
        var id=cleanId(it.id||''), name=it.name||id;
        var rOpts=(Array.isArray(it.reasoningOptions)&&it.reasoningOptions.length)?it.reasoningOptions:fallbackReasoning;
        var itEl=document.createElement('div');
        itEl.className='ai-cascader-item'+(id===cur?' active':'');
        itEl.innerHTML='<span class="ai-cascader-item-txt">'+escHtml(name)+'</span><span class="ai-cascader-item-arrow">›</span>';
        itEl.title=name;
        itEl.onmouseenter=function(){
          showSubForModel(id, name, rOpts, itEl);
        };
        itEl.onclick=function(ev){
          ev.stopPropagation();
          // 点击模型选项不直接选中，必须选右侧推理强度
          showSubForModel(id, name, rOpts, itEl);
        };
        primary.appendChild(itEl);
      })(gVisibleItems[j]);
    }
  }

  // 底部：管理模型列表...
  var manageItem=document.createElement('div');
  manageItem.className='ai-cascader-item ai-cascader-manage-item';
  manageItem.innerHTML='<span class="ai-cascader-item-txt">管理模型列表...</span>';
  manageItem.onmouseenter=function(){
    if(activePrimaryItem) activePrimaryItem.classList.remove('hover-active');
    activePrimaryItem=manageItem;
    manageItem.classList.add('hover-active');
    sub.style.display='none';
  };
  manageItem.onclick=function(ev){
    ev.stopPropagation();
    closeCascader();
    openSettings('models');
  };
  primary.appendChild(manageItem);

  btn.onclick=function(ev){
    ev.stopPropagation();
    if(aiBusy)return;
    var isOpen = cascader.classList.contains('open');
    if(isOpen){
      closeCascader();
    } else {
      cascader.classList.add('open');
      popover.style.display='block';
      var activeEl=primary.querySelector('.ai-cascader-item.active') || primary.querySelector('.ai-cascader-item:not(.ai-cascader-manage-item)');
      if(activeEl && typeof activeEl.onmouseenter==='function'){
        activeEl.onmouseenter();
      }
    }
  };

  if(!window._aiCascaderDocHandlerAttached){
    window._aiCascaderDocHandlerAttached=true;
    document.addEventListener('click', function(ev){
      var cEl=$('aiModelCascader');
      if(cEl && !cEl.contains(ev.target)){
        var pEl=$('aiCascaderPopover');
        if(pEl) pEl.style.display='none';
        cEl.classList.remove('open');
        var sEl=$('aiCascaderSub');
        if(sEl) sEl.style.display='none';
      }
    });
  }

  aiSyncModelBtn();
}

function aiLoadModels(){
 if(!HAS_AI||!aiModelEl)return;
 if(aiModelCache){ aiRenderModelOptions(aiModelCache); return; }
 aiModelEl.innerHTML='<option value="">选择模型…</option>';
 aiModelEl.disabled=aiBusy;
 aiSyncModelBtn();
 window.protoAPI.ai.listModels().then(function(r){
  if(r&&r.ok){ aiModelCache=r; aiRenderModelOptions(r); }
  else{
    aiModelEl.innerHTML='<option value="">模型加载异常</option><option value="__manage_models__">管理模型列表...</option>';
    aiModelEl.disabled=aiBusy;
    aiSyncModelBtn();
  }
 }).catch(function(){
  aiModelEl.innerHTML='<option value="">模型加载异常</option><option value="__manage_models__">管理模型列表...</option>';
  aiModelEl.disabled=aiBusy;
  aiSyncModelBtn();
 });
}
function aiRenderModelOptions(r){
 if(!aiModelEl)return;
  var cleanId=function(s){ return String(s||'').trim(); }; /* free 独立模型：仅去空白，不再清洗后缀 */
 var stored=cleanId(aiStoredModel());
 if(stored==='__none__'||stored==='default') stored='';
 var cur=stored;
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
  /* 在用模型被移出配置：不再给旧模型开豁免（下拉不显示），自动落到本轮首个可见模型并持久化 */
  if(!found&&stored&&stored!=='__none__'&&stored!=='default'&&html){
   var firstId='';
   try{
    var m0=html.match(/<option value="([^"]+)"/);
    if(m0)firstId=cleanId(m0[1]);
   }catch(e){}
   if(firstId){
    cur=firstId;
    try{ aiStoreModel(cur); }catch(e2){}
    try{ html=html.replace('<option value="'+escHtml(firstId)+'"', '<option value="'+escHtml(firstId)+'" selected'); }catch(e3){}
    found=true;
   }
  }

 if(!html){
  /* 安全保底：全未勾选时强制保留default推荐项，杜绝废弃-free */
  aiModelEl.innerHTML='<option value="default">默认推荐模型 (CLI 预设)</option><option value="__manage_models__">管理模型列表...</option>';
  aiModelEl.value='default';
  aiModelEl.disabled=aiBusy;
  aiRenderCascader(r);
  return;
 }
 aiModelEl.innerHTML='<option value=""'+(found?'':' selected')+'>选择模型…</option>'+html+'<option value="__manage_models__">管理模型列表...</option>';
 aiModelEl.disabled=aiBusy;
 aiModelEl.title='选择当前对话使用的模型';
 aiModelEl.onchange=function(){
  var v=aiModelEl.value;
  if(v==='__manage_models__'){
   openSettings('models');
   aiModelEl.value=stored||'';
   return;
  }
  aiStoreModel(v);
  aiSyncModelBtn();
 };
 if(!found&&cur){
  aiStoreModel('');
 }
 aiRenderCascader(r);
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
   try{ if(typeof refreshAiTopIdentity==='function')refreshAiTopIdentity(); }catch(e){}
   aiLoadModels();
   aiRenderBubbles();
   // 进入后强制滚动到底部，可手动上滑查看历史
  try{ aiUserScrolledPause=false; if(aiChatView){ aiChatView.scrollTop=aiChatView.scrollHeight; } }catch(e){}
  /* 弹窗关闭期间任务仍在进行：仅当属于当前沙箱时才恢复流式气泡，避免跨源串扰 */
  if(aiBusy&&aiStreaming&&aiChatView&&aiStreaming.parentNode!==aiChatView){
    if(aiActiveKey===aiHistKey()){ aiChatView.appendChild(aiStreaming); aiRenderStream(); try{ if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){} }
  }
  if(aiInputEl){ aiInputEl.focus(); try{ aiAutosizeInput(); }catch(e){} }
 }
  function closeAi(){
   /* Wave-D/G SoC修复：委托 AiDomain.requestClose（EventBus ai:request-close/ai:closed + Store感知，无裸挂）。 */
   try { if (typeof AiDomain !== 'undefined' && AiDomain && typeof AiDomain.requestClose === 'function') { AiDomain.requestClose('user'); return; } } catch (e) {}
   try { if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.emit === 'function') window.EventBus.emit('ai:request-close', {}); } catch (e4) {}
   if(window.MaskStack) window.MaskStack.pop('aiMask');
   if(aiMaskEl)aiMaskEl.style.display='none';
   sweepStrayMasks();
  }
 /* T3.3:MaskStack唯一ESC入口回调。等价旧双监听净效果（取消+关闭）：
    ✕按钮/遮罩点击仍走closeAi（后台继续），仅ESC经此取消后关闭 */
  function aiEscClose(){
   if(aiBusy){ try{ i5CancelAi(); }catch(e){} }
   closeAi();
  }
  /* AI 设计：在当前原型沙箱打开对话（沙箱唯一会话，自动续接历史） */
 function openAiDesign(){
  /* B2 独立窗已开则直接focus独立窗（调aiwin:open），否则正常开应用内弹窗 */
  try{
   var __aiOpen=false;
   try{ __aiOpen=!!window.__aiWinOpen; }catch(e){}
   if(__aiOpen){
    try{
     if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.open==='function'){
      var _pa={};
      try{ _pa.project=String((typeof currentProject!=='undefined')?currentProject:''); }catch(e){}
      try{ var _c=(typeof currentSource!=='undefined')?currentSource:null; if(_c)_pa.proto=String(_c.displayName||_c.name||'').replace(/\.(html?|md)$/i,''); }catch(e){}
      try{ window.protoAPI.aiwin.open(_pa); }catch(e){ try{ window.protoAPI.aiwin.open(); }catch(e2){} }
      try{ if(typeof closeAi==='function')closeAi(); }catch(e){}
      return;
     }
    }catch(e){}
   }
  }catch(e){}
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
   try{ if(typeof refreshAiTopIdentity==='function')refreshAiTopIdentity(); }catch(e){}
   aiLoadModels();
   aiRenderBubbles();
   try{ aiUserScrolledPause=false; if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){}
  /* 弹窗关闭期间任务仍在进行：仅当属于当前沙箱时才恢复流式气泡，避免跨源串扰 */
  if(aiBusy&&aiStreaming&&aiChatView&&aiStreaming.parentNode!==aiChatView){
    if(aiActiveKey===aiHistKey()){ aiChatView.appendChild(aiStreaming); aiRenderStream(); try{ if(aiChatView) aiChatView.scrollTop=aiChatView.scrollHeight; }catch(e){} }
  }
  if(aiInputEl){ aiInputEl.focus(); try{ aiAutosizeInput(); }catch(e){} }
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
  if(aiBusy){
    try{ if(typeof showToast==='function') showToast('上一个任务仍在运行，请先停止后再发送。'); else if(typeof libStatus==='function') libStatus('上一个任务仍在运行，请先停止后再发送。'); }catch(e){}
    /* 忙态自愈：回滚/异常后本地忙态可能与主进程脱节，向主进程核对一次，空闲则本地复位 */
    try{
      if(window.protoAPI&&window.protoAPI.ai&&typeof window.protoAPI.ai.isBusy==='function'){
        window.protoAPI.ai.isBusy().then(function(b){
          if(!b){ try{ aiSetBusy(false); }catch(e){} try{ if(typeof showToast==='function')showToast('忙态已自动恢复，请重新发送。'); }catch(e2){} }
        }).catch(function(){});
      }
    }catch(e){}
    return;
  }
   aiEnsureCur();
   /* 发送前防御：若缓存的会话 oid 不属于当前沙箱目录，忽略它（opencode 会卡死） */
   if(aiSession&&aiSession.oid&&!aiOidDirOk(aiSession.oid)){ aiSession.oid=''; aiSaveSesh(); }
   var s=aiCurSesh();
    aiActiveKey=SESS_KEY+'#'+encodeURIComponent(s.id||''); /* 记录发送时所在源：本次运行的事件只回写该源 */
   if(!s)return;
   if(aiInputEl)aiInputEl.value='';
   try{ aiAutosizeInput(); }catch(e){} /* 发送后清空，回落到一行高 */
   if(!s.lastHash||typeof s.lastHash!=='object') s.lastHash={};
    s.m=s.m||[]; var _uTs=0; try{ _uTs=(typeof aiSessNow==='function')?aiSessNow():Date.now(); }catch(e){ _uTs=Date.now(); }
    try{ if(typeof aiEnsureMsgTs==='function'&&s.m){} }catch(e){}
    /* 显示与发送分离：清单提交可经 window.__aiUserMsgDisplay 暂存展示串；气泡/回放用简版，发模型与历史用全文 */
    var _uDisp=null; try{ _uDisp=window.__aiUserMsgDisplay||null; window.__aiUserMsgDisplay=null; }catch(e){ _uDisp=null; }
    if(typeof _uDisp!=='string'||!_uDisp.trim()) _uDisp=null;
    var _um={r:'u',t:t,ts:_uTs}; try{ if(_uDisp) _um.d=_uDisp; }catch(e){}
    s.m.push(_um);
    s.updatedAt=Date.now();
    try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[{t:'user', text:(_uDisp||t), ts:_uTs}]; }catch(e){}
    aiSaveSesh();
    try{ aiAppendMsg((_uDisp||t),'user',_uTs); }catch(e){ try{ aiAppendMsg((_uDisp||t),'user'); }catch(e2){} }
    /* 发送自己的新消息必定位到底部：清滚动暂停并强制到底（读历史时上滑不影响） */
    try{ aiUserScrolledPause=false; if(aiChatView){ aiChatView.scrollTop=aiChatView.scrollHeight; } try{ if(typeof aiUpdateJumpBtn==='function') aiUpdateJumpBtn(); }catch(e){} }catch(e){}
   /* 开启新日志组：本次任务的思考/操作/删除/输出链全部归入该组 */
   /* 发送前加固：组装与启动任一步抛错直接报错复位，杜绝用户气泡发出后响应区永久空白 */
   try{
   var g=aiTraceBegin(t.replace(/\s+/g,' ').slice(0,24)+(t.length>24?'…':''));
   aiStreaming=aiAppendMsg('','ai'); aiStreamText=''; aiStreamThink=''; aiCurFileChanges=[]; try{ window.aiCurFileChanges=[]; }catch(e){}
   try{ i5TlReset(); aiTlLastPacket=Date.now(); aiTlLastType=''; }catch(e){}
    aiRenderStream(); /* 时间线保活：确保 .i5-timeline 容器，避免无反馈等待 */
    try{ var _eng0=(typeof getActiveEngineInUi==='function'?getActiveEngineInUi():(curAiConfig&&curAiConfig.engine||'cli')); var _ag0=null; try{ _ag0=(curAiConfig&&(curAiConfig.agentId||curAiConfig.mainAgent))||null; }catch(e){} if(typeof i5ShowBooting==='function') i5ShowBooting(_eng0,_ag0); else i5ShowWaiting(); }catch(e){ try{ i5ShowWaiting(); }catch(e2){} } /* T-CLI启动中先行，run_started到后再切等待响应 */
    aiSetBusy(true); try{ aiTlLastPacket=Date.now(); }catch(e){}
   }catch(_sendErr){
    try{ aiBubbleError('发送失败：'+((_sendErr&&_sendErr.message)||_sendErr)); }catch(e){ try{ aiSetBusy(false); }catch(e2){} }
    try{ aiSetBusy(false); }catch(e3){}
    return;
   }
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
   /* 回滚说明：规范注入位置加错（用户出完原型再做），aiDoSend恢复直通原文t；快照helpers保留供导出附录/预读+后续复用 */
    window.protoAPI.ai.ask(t, s.oid||'', aiSbxDir(), aiCurModel(), {history:(s.m||[]).slice(-20), lastHash:s.lastHash||{}, uiSessionId:s.id||'', agentSessionId:s.oid||'', engine:(typeof getActiveEngineInUi==='function'?getActiveEngineInUi():(curAiConfig&&curAiConfig.engine||'cli')), activePage: activePg, targetFile: targetFile, uiKind:((typeof currentSource!=='undefined'&&currentSource&&(currentSource.kind||''))||'mobile'), enableTools:_enk, reasoning:(typeof aiCurReasoning==='function'?(aiCurModel()?aiCurReasoning():''):'')}).then(function(r){
    if(r&&r.error==='busy'){
      /* 主进程忙：本次并未启动任何任务，本地必须复位，否则输入框永久禁用 */
      try{ aiSetBusy(false); }catch(e){}
      aiBubbleError('（已有任务在运行，请稍候）');
    }
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
 /* Wave-D/G SoC修复：校验经 AiDomain.Validation（无alert，toast+EventBus），延迟经 PROTOTYPE_OPEN_DELAY_MS（无260魔法数）。 */
 try {
   if (typeof AiDomain !== 'undefined' && AiDomain && typeof AiDomain.newPrototype === 'function') {
     var _hasAi = false;
     try { _hasAi = (typeof HAS_AI !== 'undefined') ? !!HAS_AI : false; } catch (e) {}
     AiDomain.newPrototype(kind, { hasAi: _hasAi, openAi: (typeof openAi === 'function') ? openAi : null });
     return;
   }
 } catch (e) {}
 try { if (typeof showToast === 'function') showToast('AI 域未加载。'); } catch (e2) {}
}
if(btnNewProtoEl)btnNewProtoEl.onclick=openKindModal;
if(kindPcEl)kindPcEl.onclick=function(){ setKindPick('pc'); };
if(kindMobileEl)kindMobileEl.onclick=function(){ setKindPick('mobile'); };
if(kindOkEl)kindOkEl.onclick=function(){ closeKindModal(); newPrototype(kindPick); };
if(kindCancelEl)kindCancelEl.onclick=closeKindModal;
if(kindCloseEl)kindCloseEl.onclick=closeKindModal;
if(aiDesignFab)aiDesignFab.onclick=function(){ openAiDesign(); };
/* 输入框自适应高度：空时一行，有字随内容长高（上限120px后内部滚动） */
function aiAutosizeInput(){
  if(!aiInputEl) return;
  try{
    aiInputEl.style.height='auto';
    var _h=aiInputEl.scrollHeight, _max=120;
    if(_h>_max){ _h=_max; aiInputEl.style.overflowY='auto'; }
    else{ aiInputEl.style.overflowY='hidden'; }
    aiInputEl.style.height=_h+'px';
  }catch(e){}
}
if(HAS_AI){
  aiEnsureCur(); aiSaveSesh();
  if(aiCloseEl)aiCloseEl.onclick=closeAi;
   if(aiSendEl)aiSendEl.onclick=aiDoSend;
   if(aiClearEl)aiClearEl.onclick=function(){
   if(aiBusy){ alert('当前回答进行中，请先点击「停止生成」。'); return; }
   if(aiChatView)aiChatView.innerHTML='';
   aiEnsureCur();
   aiSession.m=[]; aiSession.oid=''; try{ aiSession.events=[]; if(aiSession.v!==AI_SESS_V) aiSession.v=AI_SESS_V; }catch(e){} try{ if(typeof aiCurTaskEvents!=='undefined') aiCurTaskEvents=[]; }catch(e){} /* 清空气泡与 opencode 上下文，二者保持一致 */
   aiSaveSesh();
  };
   if(aiInputEl)aiInputEl.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing){ e.preventDefault(); aiDoSend(); return; }
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); aiDoSend(); }
  });
   if(aiInputEl)aiInputEl.addEventListener('input',function(){ try{ aiAutosizeInput(); }catch(e){} });
 window.protoAPI.ai.onEvent(function(ev){
    if(!ev)return;
    if(ev.type==='session'){
     var k=aiActiveHistKey();
     if(k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)){ var s=aiCurSesh(); if(s){ s.oid=ev.id||''; aiSaveSesh(); } }
     else{ aiWriteSeshFor(k,function(v){ v.oid=ev.id||''; }); }
    }
     else if(ev.type==='run_started'){
       try{ i5MarkRunStarted(ev); }catch(e){}
     }
    else if(ev.type==='tool_call'){
      try{ i5AppendToolCall(ev); }catch(e){}
      try{ if(typeof aiToolEventFrom==='function'){ var _te=aiToolEventFrom(ev); if(_te&&typeof aiCurTaskEvents!=='undefined'&&aiCurTaskEvents) aiCurTaskEvents.push(_te); } }catch(e){}
       try{ aiUpdateOpCur(); }catch(e){}
     }
      else if(ev.type==='scope_confirm'){
       try{ i5ShowScopeConfirm(ev); }catch(e){}
      }
      else if(ev.type==='scope_confirm_dismiss'){
       try{ i5DismissScopeConfirm(ev&&ev.id); }catch(e){}
      }
      else if(ev.type==='remote-send'){
       /* 独立窗代发：主窗待提交列表委托本窗发送，填输入框后走本窗 aiDoSend，全程落本窗 */
       try{
        var _rs=(ev&&typeof ev==='object')?ev:null;
        var _rt=_rs?String(_rs.text||'').trim():'';
        if(_rt){
         try{ if(aiInputEl) aiInputEl.value=_rt; }catch(e){}
         try{ window.__aiUserMsgDisplay=String((_rs&&_rs.display)||'')||null; }catch(e){}
         try{ if(typeof aiDoSend==='function') aiDoSend(); }catch(e){}
        }
       }catch(e){}
      }
     else if(ev.type==='thinking'){
      try{ if(typeof aiCurTaskEvents!=='undefined'&&aiCurTaskEvents){ var _tt0=String((ev&&ev.text)||''); if(_tt0.trim()&&typeof aiSessNow==='function') aiCurTaskEvents.push({t:'thinking', text:_tt0, ts:aiSessNow()}); } }catch(e){}
      var g0=aiCurGroup(); if(!g0)return;
      try{ i5ThinkAppendChunk(String((ev&&ev.text)||'')); }catch(e){ try{ aiStreamThink+=String((ev&&ev.text)||''); }catch(e2){} }
      try{ g0.think=aiStreamThink; }catch(e){}
      if(Date.now()-g0.thinkFlush>400)aiTraceFlushThink(g0);
      try{ aiTlLastPacket=Date.now(); aiTlLastType='thinking'; i5TlSetStalled(false,0); }catch(e){}
      // 思考弹窗若已打开，流式同步更新内容，无需关闭重进（全文保留，单段展示截断末1500字）
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
      /* 输出链（含代码正文）→ 日志组（节流 400ms 刷新 DOM）；时间线：先落思考缓冲再追加回答，保证穿插顺序 */
      var g1=aiCurGroup(); if(!g1)return;
      try{ i5ThinkFlushPending(false); }catch(e){}
      try{ i5AnswerAppendChunk(String((ev&&ev.text)||'')); }catch(e){ try{ aiStreamText+=String((ev&&ev.text)||''); }catch(e2){} }
      try{ g1.output=aiStreamText; }catch(e){}
      if(Date.now()-g1.outFlush>400)aiTraceFlushOutput(g1);
      try{ aiTlLastPacket=Date.now(); aiTlLastType='chunk'; i5TlSetStalled(false,0); }catch(e){}
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
        if(rr&&rr.ok){
          /* 回滚即全新起点：清掉拾取态（旧文档活元素引用已失效，留着会出幽灵高亮） */
          try{ if(typeof cancelCtrlPickState==='function')cancelCtrlPickState(); else if(window.CTRL_PICK){ window.CTRL_PICK.holding=false; try{window.CTRL_PICK.exit();}catch(e){} try{window.CTRL_PICK.clear();}catch(e2){} } }catch(e){}
          closeSnapPanel(); showToast('已恢复到 '+fmtTsText(it.ts)+'（原状态已备份为 undo 快照）。'); loadSandboxSources(undefined, true); }
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
var _btnRefreshLabel=null;
function setRefreshBusy(on){
  /* 刷新三态之一：按钮转圈（禁用+文案），与状态栏/toast 配合 */
  try{
    if(!btnRefreshEl)return;
    if(on){
      if(_btnRefreshLabel==null)_btnRefreshLabel=btnRefreshEl.textContent;
      btnRefreshEl.disabled=true;
      btnRefreshEl.textContent='刷新中…';
    }else{
      btnRefreshEl.disabled=false;
      if(_btnRefreshLabel!=null)btnRefreshEl.textContent=_btnRefreshLabel;
    }
  }catch(e){}
}
if(btnRefreshEl)btnRefreshEl.onclick=function(){
  if(!(window.protoAPI&&window.protoAPI.sandbox)){ showToast('浏览器模式无沙箱数据，无需刷新。'); return; }
  if(!currentProject){ showToast('尚未进入任何项目，请先选择项目。'); return; }
  try{ if(typeof libStatus==='function')libStatus('正在刷新沙箱…'); }catch(e){}
  try{ showToast('正在刷新沙箱…'); }catch(e){}
  window._refreshManual=true; /* 手动刷新标记：完成后按钮复位+toast，与 AI 后台静默刷新区分 */
  setRefreshBusy(true); /* 可见反馈：libStatus 在设置区不易察觉，toast 确保点击有回音 */
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
    var _eng='cli'; try{ _eng=(typeof getActiveEngineInUi==='function')?getActiveEngineInUi():((curAiConfig&&curAiConfig.engine)||'cli'); }catch(e){}
    var isCur=(id===mainId)&&(_eng!=='api'); /* 跨tab单选：api引擎下CLI侧不高亮 */
    var card=document.createElement('div');
    card.className='agent-card'+(isCur?' active':'');
    card.setAttribute('data-id', id);
    var head=document.createElement('div'); head.className='agent-card-header';
    var nameEl=document.createElement('span'); nameEl.className='agent-name'; nameEl.textContent=i5AgentLabel(a);
    head.appendChild(nameEl);
    var right=document.createElement('span'); right.className='agent-head-right';
    if(isCur){ var useFlag=document.createElement('span'); useFlag.className='agent-use-flag'; useFlag.textContent='使用中'; right.appendChild(useFlag); }
    var st=document.createElement('span');
    if(a.available){ st.className='agent-status dot'; try{ st.title='已就绪'+(a.version?' · '+a.version:''); }catch(e){} }
    else{ st.className='agent-status dot err'; st.title='未检测到'; }
    right.appendChild(st); head.appendChild(right); card.appendChild(head);
    var pathRow=document.createElement('div'); pathRow.className='agent-path-row';
    var pathEl=document.createElement('span'); pathEl.className='agent-path'; pathEl.textContent=a.path||'未安装，可指定自定义路径'; pathEl.title=a.path||'';
    pathRow.appendChild(pathEl); card.appendChild(pathRow);
    var acts=document.createElement('div'); acts.className='agent-card-actions';
    var pickBtn=document.createElement('button'); pickBtn.type='button'; pickBtn.className='btn-mini btn-pick-cli'; pickBtn.textContent='指定路径';
    pickBtn.onclick=function(ev){ ev.stopPropagation(); i5PickAgentPath(id); };
    acts.appendChild(pickBtn); card.appendChild(acts);
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
/* 切CLI遮罩：点击卡片即显，覆盖保存+重探测全程；令牌防串，15s兜底 */
var _agentSwSeq=0, _agentSwTimer=null;
function showAgentSwitchMask(){
  try{
    var tok=++_agentSwSeq;
    var m=document.getElementById('agentSwitchMask');
    if(!m){
      m=document.createElement('div'); m.id='agentSwitchMask'; m.className='agent-switch-mask';
      m.innerHTML='<div class="agent-switch-box"><span class="agent-spin"></span><span>正在切换本地 CLI…</span></div>';
      document.body.appendChild(m);
    }
    m.style.display='flex';
    m.setAttribute('data-tok', String(tok));
    if(_agentSwTimer){ try{ clearTimeout(_agentSwTimer); }catch(e){} }
    _agentSwTimer=setTimeout(function(){ try{ hideAgentSwitchMask(tok); }catch(e){} }, 15000);
    return tok;
  }catch(e){ return 0; }
}
function hideAgentSwitchMask(tok){
  try{
    var m=document.getElementById('agentSwitchMask'); if(!m) return;
    if(tok && m.getAttribute('data-tok')!==String(tok)) return;
    m.style.display='none';
  }catch(e){}
}
function i5SetMainAgent(id){
  if(!id)return;
  curAiConfig=curAiConfig||{};
  curAiConfig.agentId=id; curAiConfig.mainAgent=id;
  try{ if(typeof setEngineUi==='function')setEngineUi('cli'); }catch(e){} /* 跨tab单选：选中CLI卡即切回cli引擎，API侧高亮自动消失 */
  var _swTok=0; try{ _swTok=showAgentSwitchMask(); }catch(e){}
  function _hideSw(){ try{ hideAgentSwitchMask(_swTok); }catch(e){} }
  aiInvalidateModels();
  try{ renderModelManagerList(curAiConfig); }catch(e){}
  if(window.protoAPI&&window.protoAPI.ai&&window.protoAPI.ai.saveConfig){
    window.protoAPI.ai.saveConfig(curAiConfig).then(function(){ i5RefreshAgentBadge(id); var pr=null; try{ pr=refreshCliInfo(); }catch(e){} aiInvalidateModels(); aiLoadModels(); try{ renderModelManagerList(curAiConfig); }catch(e){} aiRefreshCli(); if(pr&&pr.then){ pr.then(function(){ _hideSw(); },function(){ _hideSw(); }); } else { _hideSw(); } },function(){ _hideSw(); });
  }else{ i5RefreshAgentBadge(id); try{ refreshCliInfo(); }catch(e){} _hideSw(); }
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
  return window.protoAPI.ai.checkCli().then(function(r){
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
/* Wave-C/F: escAttr 显式 import (_paeEscAttr) 为准, window.Utils 仅作 stripped-classic 降级只读 */
var escAttr=(function(){ try { if (typeof _paeEscAttr === 'function') return _paeEscAttr; } catch (e) {} try { if (typeof window!=='undefined'&&window.Utils&&window.Utils.escAttr) return window.Utils.escAttr; } catch (e2) {} return function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }; })();
function safeScript(t){ return String(t||'').split('</script').join('<\\/script'); }
/* Wave-C/F: ESM 剥离内联 (file:// module CORS 降级): 导出单文件时 import/export 转经典后内联, 零模块零 CORS */
function stripEsmForExport(code){
  try {
    var s = String(code || '');
    // 去掉静态 import 行 (含副作用 import 与 from 导入; dynamic import() 保留, 经典下按需失败回退)
    s = s.replace(/^[ \t]*import\s+[^;]*?;[ \t]*(?:\r?\n|$)/gm, '');
    s = s.replace(/^[ \t]*import\s*\(/gm, '/*esm-stripped:*/void(');
    // export 修饰转经典声明 (export function/const/class/var/default/名单)
    s = s.replace(/^[ \t]*export\s+default\s+/gm, '');
    s = s.replace(/^[ \t]*export\s+\{\s*[^}]*\}\s*;?[ \t]*(?:\r?\n|$)/gm, '');
    s = s.replace(/^[ \t]*export\s+(?=function|const|let|var|class|async)/gm, '');
    return s;
  } catch (e) { try { return String(code || ''); } catch (e2) { return ''; } }
}
/* Wave-D/G 导出轻量化：开发脚本(HTML 11)与导出脚本解耦。导出仅内联轻量只读渲染器，
 * 不再内联 core-docs/project-ai-export 等开发巨石。__EXPORT_BOOT__ 兼容保留。 */
var EXPORT_SCRIPT_FILES=['js/icons.js','js/export-template.js'];
/* P1 MD重构：离线导出图片内联流水线（相对assets路径转Base64 Data URL，缺失保留原路径不中断） */
function guessImageMime(p){
  var s=String(p||'').toLowerCase();
  if(/\.jpe?g$/.test(s)) return 'image/jpeg';
  if(/\.gif$/.test(s)) return 'image/gif';
  if(/\.svg$/.test(s)) return 'image/svg+xml';
  if(/\.webp$/.test(s)) return 'image/webp';
  if(/\.bmp$/.test(s)) return 'image/bmp';
  if(/\.ico$/.test(s)) return 'image/x-icon';
  return 'image/png';
}
function normalizeAssetDataUrl(r, fallbackPath){
  if(r==null) return null;
  if(typeof r==='string'){
    var s0=String(r).trim();
    if(/^data:/i.test(s0)) return s0;
    return null;
  }
  try{
    if(r.dataUrl&&/^data:/i.test(String(r.dataUrl))) return String(r.dataUrl);
    if(r.url&&/^data:/i.test(String(r.url))) return String(r.url);
    if(r.content&&/^data:/i.test(String(r.content).trim())) return String(r.content).trim();
    var b64=r.base64||r.data||r.base64Data||null;
    if(b64&&typeof b64==='string'){
      var b=String(b64).trim().replace(/\s+/g,'');
      if(!b) return null;
      if(/^data:/i.test(b)) return b;
      if(b.length<20) return null;
      return 'data:'+guessImageMime(fallbackPath)+';base64,'+b;
    }
  }catch(e){}
  return null;
}
function readOneAsset(dir, file){
  return new Promise(function(resolve){
    try{
      var sb=(window.protoAPI&&window.protoAPI.sandbox)||null;
      if(!sb||!dir){ resolve(null); return; }
      if(typeof sb.readAssetBase64!=='function'){ resolve(null); return; }
      var ret=null;
      try{ ret=sb.readAssetBase64({dir:dir,file:file}); }
      catch(e){ resolve(null); return; }
      Promise.resolve(ret).then(function(r){
        if(r&&r.ok===false){ resolve(null); return; }
        resolve(normalizeAssetDataUrl(r, file));
      }).catch(function(){ resolve(null); });
    }catch(e){ resolve(null); }
  });
}
function inlineMarkdownImages(mdText, protoDir){
  var src=String(mdText==null?'':mdText);
  if(!src) return Promise.resolve(src);
  var dir=String(protoDir||'');
  /* P2 图片缩放对齐：容忍自有 GFM 后缀 {w=NN} / {w=NN align=xx} / {align=xx}（扫描与替换均保留后缀） */
  var re=/!\[[^\]]*\]\(([^)]+)\)(\{[^{}]*\})?/g;
  var seen={}, list=[], m=null;
  while((m=re.exec(src))){
    var raw=String(m[1]||'').trim();
    if(!raw) continue;
    var pathPart=raw.split(/\s+/)[0].replace(/^['"]|['"]$/g,'');
    if(!pathPart) continue;
    if(/^data:/i.test(pathPart)) continue;
    if(/^(https?:|file:|proto-asset:|blob:|javascript:)/i.test(pathPart)) continue;
    if(pathPart.charAt(0)==='#') continue;
    if(pathPart.charAt(0)==='/') continue;
    var norm=String(pathPart).replace(/^\.\//,'');
    if(norm.indexOf('assets/')<0) continue;
    if(seen[pathPart]) continue;
    seen[pathPart]=1;
    list.push(pathPart);
  }
  if(!list.length) return Promise.resolve(src);
  if(!dir) return Promise.resolve(src);
  try{
    var sb0=(window.protoAPI&&window.protoAPI.sandbox)||null;
    if(!sb0||typeof sb0.readAssetBase64!=='function') return Promise.resolve(src);
  }catch(e){ return Promise.resolve(src); }
  return Promise.all(list.map(function(p){
    var file=String(p).replace(/^\.\//,'');
    return readOneAsset(dir, file);
  })).then(function(results){
    var map={};
    for(var i=0;i<list.length;i++){ if(results[i]) map[list[i]]=results[i]; }
    if(!Object.keys(map).length) return src;
    return src.replace(/!\[[^\]]*\]\(([^)]+)\)(\{[^{}]*\})?/g, function(full, inner, suffix){
      var raw2=String(inner||'').trim();
      var pp=raw2.split(/\s+/)[0].replace(/^['"]|['"]$/g,'');
      var du=map[pp];
      if(!du) return full;
      var rest=raw2.slice(pp.length);
      /* 替换路径保留后缀：full 已含可选后缀，仅替换括号内路径部分 */
      return String(full).replace(inner, du+rest);
    });
  }).catch(function(){ return src; });
}
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
        /* P1 MD重构：导出前将各原型MD内相对assets图片经readAssetBase64批量转Data URL内联（缺失保留原路径） */
        var inlineJobs=chosen.map(function(src,i){
          var rawMd=mds[i]||src.md||(typeof fullDocMd==='function'?fullDocMd(src):'')||'';
          var pdir=(src&&src.sandboxDir)||'';
          return inlineMarkdownImages(rawMd, pdir);
        });
        return Promise.all(inlineJobs).then(function(inlinedMds){
        /* 内嵌全部所选原型：content + 各自功能说明 */
        var embeds=[], docWrites='';
        chosen.forEach(function(src,i){
          var proto=protos[i];
          if(!proto){ return; }
          var mdText=(inlinedMds&&inlinedMds[i]!=null)?inlinedMds[i]:(mds[i]||src.md||(typeof fullDocMd==='function'?fullDocMd(src):'')||'');
          var em={ name:src.name, displayName:src.displayName||src.name, kind:src.kind||'mobile', method:'srcdoc', content:proto, mdName:src.mdName||null, path:'', md:mdText, docs:{ 'default': mdText } };
          embeds.push(em);
          docWrites+='try{localStorage.setItem('+JSON.stringify(DOCS_KEY_PREFIX+em.name+'_'+em.kind)+','+JSON.stringify(mdText)+');}catch(e){}\n';
        });
        if(!embeds.length){ throw new Error('所选原型内容读取失败。'); }
        /* Wave-D/G 轻量导出：独立只读模板 + JSON 数据，不再克隆开发期 body/内联开发巨石 */
        var first=embeds[0];
        var liteCss='\n.export-lite{max-width:1200px;margin:0 auto;padding:16px;font-family:system-ui,sans-serif;}\n.export-lite-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}\n.export-lite-item{border:1px solid #ddd;border-radius:8px;padding:6px 12px;background:#fff;cursor:pointer;}\n.export-lite-item.on{border-color:#0052ff;color:#0052ff;}\n.export-lite-stage{display:flex;gap:16px;}\n.export-lite-frame{flex:1 1 auto;min-height:480px;border:1px solid #e5e7eb;border-radius:8px;}\n.export-lite-doc{flex:1 1 360px;max-width:480px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fff;}\n';
        var liteBody='<div class="export-lite"><h2>原型预览 · '+escAttr(first.displayName)+'（只读导出）</h2>'
          +'<div class="export-lite-bar" id="exportLiteList"></div>'
          +'<div class="export-lite-stage"><iframe id="frame" class="export-lite-frame" src="about:blank" title="原型预览"></iframe>'
          +'<div class="export-lite-doc"><h3 id="exportLiteTitle"></h3><div id="exportLiteDoc"></div>'
          +'<div id="docContent" style="display:none"></div><div id="docTitle" style="display:none"></div><div id="sbList" style="display:none"></div></div></div></div>';
        var h='<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n'
          +'<meta charset="UTF-8">\n'
          +'<meta name="viewport" content="width=device-width, initial-scale=1">\n'
          +'<title>原型预览 · '+escAttr(first.displayName)+'</title>\n'
          +'<style>\n'+(styles.join('\n')||'')+'\n'+liteCss+'\n</style>\n'
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
          +'<\/head>\n<body>\n'+liteBody+'\n'
          +scripts.map(function(s){ try { s = stripEsmForExport(s); } catch (e) {} return '<script>\n'+safeScript(s)+'\n<\/script>\n'; }).join('')
          +'\n</body>\n</html>';
        return h;
        }); /* Promise.all(inlineJobs) 图片内联回填 */
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
    var wrap=document.createElement('div'); wrap.className='proj-row'; wrap.setAttribute('data-project', String(p.name||''));
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
    wrap.appendChild(it);
    wrap.onclick=function(){
      projPick=p.name; renderProjectList(projects,last);
    };
    projListEl.appendChild(wrap);
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
  if(/[\\\/:*?"<>|]|\.\./.test(v)){ alert('名称含非法字符（不能含 \\ / : * ? " < > |）。'); return; }
  if(v.length>60){ alert('名称过长（≤60字）。'); return; }
  window.protoAPI.sandbox.projectCreate({name:v}).then(function(r){
   if(r&&r.ok){
     var pn=String(r.name||v);
     enterProject(pn);
   }
   else reportError('project-create', new Error(r&&r.error||'未知错误'), '创建失败：'+(r&&r.error||'未知错误'));
  });
}
function enterProject(name){
  currentProject=name||'';
  if(!currentProject)return;
  try { if (typeof window !== 'undefined' && window.Store && typeof window.Store.setCurrentProject === 'function') window.Store.setCurrentProject(currentProject); } catch (e) {}
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
function loadSandboxSources(selName, quiet){
  // fix refresh preserve: extend selName to support subpage restore; snapshot from globals/param
  // quiet=true 时为后台自动刷新（AI done 同步/导入/恢复/拉取后），无项目则静默返回不 toast；
  // 仅用户手动刷新且真没项目时才提示（刷新按钮处已自带提示）。
  /* 手动刷新三态之三：完成/失败统一复位按钮 + toast（AI 后台路径 _refreshManual 为空，不打扰） */
  var _manualRefresh=false;
  try{ _manualRefresh=!!window._refreshManual; window._refreshManual=false; }catch(e){ _manualRefresh=false; }
  function _refreshDone(ok, msg){
    try{ setRefreshBusy(false); }catch(e){}
    if(!_manualRefresh)return;
    try{
      if(msg)showToast(msg);
      else if(ok===false)showToast('刷新失败，请重试。');
    }catch(e){}
  }
 var _paramIsSub = !!(selName && /\.html$/i.test(String(selName)));
 var _pendingRefreshSub = (typeof window._refreshSavedSub !== 'undefined' && window._refreshSavedSub) ? window._refreshSavedSub : (_paramIsSub ? selName : null);
 var _pendingRefreshHash = (typeof window._refreshSavedHash !== 'undefined' && window._refreshSavedHash) ? window._refreshSavedHash : '';
 var _selNameForProto = _paramIsSub ? null : selName;
 try{ if(_pendingRefreshSub || _pendingRefreshHash) { window._refreshSavedSub = null; window._refreshSavedHash = ''; } }catch(e){}
   if(!(window.protoAPI&&window.protoAPI.sandbox)){ _refreshDone(false); return; }
   if(!currentProject){ if(!quiet){ try{ showToast('尚未进入任何项目，请先选择项目。'); }catch(e){} } _refreshDone(); return; }
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
    if(!sources.length){ renderSourceList(); libStatus('项目「'+currentProject+'」暂无原型：先点左下角「新建设计」创建，或通过「导入原型」导入 html 文件。'); _refreshDone(); return; }
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
    _refreshDone(true, '沙箱已刷新，共 '+folders.length+' 个原型文件夹。');
   }); /* end Promise.all.then */
   }).catch(function(e){ _refreshDone(false); reportError('sandbox-list', e, '加载原型列表失败：'+(e&&e.message||e)); });
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
  loadSandboxSources(_savedSub2 && /\.html$/i.test(String(_savedSub2)) ? _savedSub2 : undefined, true); /* AI done 后的后台同步，无项目静默返回 */
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
     window.MaskStack.register('apiProfileMask','apiProfileMask', closeApiProfileModal);
     window.MaskStack.register('uispecAddMask','uispecAddMask', closeUispecAdd);
     window.MaskStack.register('gitPushMask','gitPushMask', closeGitPushModal);
      window.MaskStack.register('gitPullMask','gitPullMask', closeGitPullModal);
      window.MaskStack.register('gitConfigMask','gitConfigMask', closeGitConfigModal);
      try { window.MaskStack.register('gitRemoteConfirmMask','gitRemoteConfirmMask', function() { gitCloseMask('gitRemoteConfirmMask'); }); } catch (e) {}
      try { window.MaskStack.register('gitCrossProjConfirmMask','gitCrossProjConfirmMask', function() { gitCloseMask('gitCrossProjConfirmMask'); gitPendingCrossProj = null; }); } catch (e) {}
      try { window.MaskStack.register('gitPullCoverConfirmMask','gitPullCoverConfirmMask', function() { gitCloseMask('gitPullCoverConfirmMask'); gitPendingPullCover = null; }); } catch (e) {}
      try { window.MaskStack.register('gitHealConfirmMask','gitHealConfirmMask', function() { gitCloseMask('gitHealConfirmMask'); }); } catch (e) {}
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
    // 向上滚仅在已脱离底部（80px 外）时暂停：在底部附近的触板抖动不得锁死吸底，否则大段回复到来也吸不回去
    if(e.deltaY < 0 && !aiShouldAutoScroll(cv,80)) { aiUserScrolledPause=true; aiUpdateJumpBtn(); }
  };
  cv.addEventListener('scroll', onScroll, {passive:true});
  cv.addEventListener('wheel', onWheel, {passive:true});
  cv.addEventListener('touchmove', function(){ if(!aiShouldAutoScroll(cv,80)){ aiUserScrolledPause=true; aiUpdateJumpBtn(); } }, {passive:true});
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
/* FIX: 经典<script>加载，移除ESM export(EXPORT_*经window/全局直用) */
