/* [js/core-docs.js] Wave-D/G index：文档域门面（逻辑分层+文件夹切分，物理行暂留兼容副本）
 * 域切分：js/doc/markdown-compiler.js（纯编译）/editor-controller.js（Store守卫）/toc-navigator.js（目录）
 *          /mirror-sync.js（EventBus桥，无monkey-patch）。本文件保留实现供 vm 门禁过渡，下波删副本。
 * SoC：mirrorPush/Back 已双发 MirrorSync；applyAiWinCloseGuard 已删 window.closeAi 裸挂（见 verify-docwin C5 EventBus）。 */

var $=function(id){return document.getElementById(id);};
window.Proto={$: $};
var safeStorage={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}}};
var persistDocsTimer=new Map();
var frame=$('frame'),locEl=$('loc');
/* ═══════ 统一错误上报：写本地日志（protoAPI.log）+ 右下角轻提示，不阻塞操作 ═══════ */
var toastBoxEl=null;
function ensureToastBox(){
 if(toastBoxEl)return toastBoxEl;
 toastBoxEl=document.createElement('div'); toastBoxEl.id='toastBox';
 document.body.appendChild(toastBoxEl);
 return toastBoxEl;
}
function showToast(msg){
 var box=ensureToastBox();
 var it=document.createElement('div'); it.className='toast-item'; it.textContent=String(msg==null?'':msg);
 box.appendChild(it);
 setTimeout(function(){ it.classList.add('out'); },2600);
 setTimeout(function(){ if(it.parentNode)it.parentNode.removeChild(it); },3050);
 return it;
}
function logWrite(level,tag,msg){
 try{ if(window.protoAPI&&window.protoAPI.log){ window.protoAPI.log.write(level,tag,msg); } }catch(e){}
}
function reportError(tag,err,userMsg){
 var detail='';
 try{ detail=(err&&err.stack)?String(err.stack):String((err&&(err.message||err))||''); }catch(e){ try{detail=String(err);}catch(e2){} }
 logWrite('error',tag,detail);
 try{ console.error('['+tag+']',err); }catch(e){}
 if(userMsg)showToast(userMsg);
}
/* ═══════ 功能说明文档：按源文件隔离 ═══════
 每个 source 拥有独立的 docs({route: markdown}) 与本源持久化 key。
 沙箱源从同名 md（结构化分页格式）装载；其余源读本地缓存或空。
 结构化 md 格式：`## 页面 <标题>（<路由 key>）` 一个页面一个章节，key 与原型 hash 路由对应；
 无「（key）」标注的旧格式整篇作为第一个页面 key 兼容。
 渲染为「整篇展示」：一次渲染全部章节；目录点击仅滚动定位，不做分块切换。 */
var DOCS_KEY_PREFIX='protoDoc_v2_';
function sourceDocKey(src){ return DOCS_KEY_PREFIX + (src&&src.name?src.name:'') + '_' + (src&&src.kind||'mobile'); }
/* 单文档：恒显示功能说明（<name>.md，沿用默认解析与localStorage键）；磁盘已存在的变更日志/需求规格保留不删，仅不再展示入口；前端不再调用 doc:list（后端通道保留） */
function curDocMd(){
 try{
  var inReq=false; try{ inReq=(typeof reqMode!=='undefined'&&reqMode); }catch(e){}
  if(inReq){ try{ return String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){ return ''; } }
  var src=null; try{ src=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
  if(!src) return '';
  try{ return String(getDocMd(src)||''); }catch(e){ try{ return String(src.md||''); }catch(e2){ return ''; } }
 }catch(e){ return ''; }
}

function getDocMd(src){
 if(!src)return '';
 if(typeof src.md==='string')return src.md;
 if(src.docs&&typeof src.docs==='object'){
  var vals=Object.values(src.docs);
  if(vals.length)return vals.join('\n\n');
 }
 return '';
}
function loadSourceDocs(src){
 if(!src)return '';
 try{
  var s=safeStorage.get(sourceDocKey(src));
  if(s!=null&&s!==''){
    var str=String(s).trim();
    if(str.startsWith('{')&&str.endsWith('}')){
      try{
        var obj=JSON.parse(str);
        if(obj&&typeof obj==='object'){
          var vals=Object.values(obj).filter(function(v){ return typeof v==='string'; });
          if(vals.length) s=vals.join('\n\n');
          else s='';
        }
      }catch(e2){}
    }
    if(s) src.md=s;
  }
 }catch(e){}
 return src.md||'';
}
var docTitleEl=$('docTitle'),docContentEl=$('docContent');
/* ═══════ 功能说明编辑（纯净 Markdown 存储，支持保存到沙箱同名 md 与 localStorage） ═══════ */
var editOn=false,editHash=null;
var btnEditDoc=$('btnEditDoc'),btnCancelDoc=$('btnCancelDoc'),btnSaveDoc=$('btnSaveDoc'),docEditEl=$('docEdit'),docEditArea=$('docEditArea');
/* 整篇文档文本：直接读取纯净 Markdown 原文（单文档：功能说明；reqMode最新需求流不动） */
function fullDocMd(src){
 try{
  var cur=null; try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
  if(src&&cur&&src!==cur) return getDocMd(src);
  return curDocMd();
 }catch(e){ return getDocMd(src||currentSource); }
}
function persistDocs(){
 if(!currentSource)return;
 try{
  var k=sourceDocKey(currentSource);
  var md=String(currentSource.md||'');
  var prev=persistDocsTimer.get(k); if(prev)clearTimeout(prev);
  persistDocsTimer.set(k,setTimeout(function(){ persistDocsTimer.delete(k); safeStorage.set(k,md); },300));
 }catch(e){
  var k2=sourceDocKey(currentSource); var md2=currentSource.md;
  var prev2=persistDocsTimer.get(k2); if(prev2)clearTimeout(prev2);
  persistDocsTimer.set(k2,setTimeout(function(){ persistDocsTimer.delete(k2); safeStorage.set(k2,md2); },300));
 }
}
/* 沙箱源：把纯净文档写回原型文件夹同名 md（单文档：功能说明恒为<name>.md） */
function sandboxMdFile(){ if(!currentSource)return null; return currentSource.mdFile||(String(currentSource.name||'原型').replace(/\.(html?)$/i,'')+'.md'); }
function persistSandboxDoc(){
 if(!(window.protoAPI&&window.protoAPI.sandbox)||!currentSource||!currentSource.sandboxDir)return;
 var f=null; try{ f=sandboxMdFile(); }catch(e){ return; }
 if(!f)return;
 var txt=currentSource.md||'';
 /* Wave-C/F 竞态修复: 保存时快照 {sourceId, ver, dir, file, content}, 写回时经 Store.guardDocWrite 校验;
  * 若期间已切换原型 (sourceId 失配) 或同原型版本已推进 (stale-version), 阻断写回并 toast 提示,
  * 杜绝“A 文档覆盖写入 B 文件”。无 Store (vm/导出) 时走 legacy 直写。 */
 var _snap = null;
 try {
   if (typeof window !== 'undefined' && window.Store && typeof window.Store.beginDocSave === 'function') {
     _snap = window.Store.beginDocSave({ dir: currentSource.sandboxDir, file: f, content: txt });
   }
 } catch (e) { _snap = null; }
 var _dir = (_snap && _snap.dir) || currentSource.sandboxDir;
 var _file = (_snap && _snap.file) || f;
 var _content = (_snap && (_snap.content != null)) ? _snap.content : txt;
 window.protoAPI.sandbox.write({dir:_dir,file:_file,content:_content}).then(function(r){
  try {
    if (_snap && typeof window !== 'undefined' && window.Store && typeof window.Store.guardDocWrite === 'function') {
      var g = window.Store.guardDocWrite(_snap);
      if (!g.ok) {
        var _msg = (g.reason === 'stale-version')
          ? '保存已阻断: 当前原型版本已变更 (并发保存), 请重新保存。'
          : '保存已阻断: 已切换原型, 本次保存不会写入新原型, 请返回原原型重新保存。';
        try { showToast(_msg); } catch (e2) {}
        try { libStatus(_msg); } catch (e3) {}
        try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit('doc:save-blocked', g); } catch (e4) {}
        return;
      }
      try { if (typeof window.Store.markDocSaved === 'function') window.Store.markDocSaved(_snap); } catch (e5) {}
    }
  } catch (e6) {}
  if(r&&r.ok)libStatus('文档已保存到沙箱：'+_file);
  else if(r&&r.error)libStatus('文档写入沙箱失败（已存本地缓存，请检查目录权限）');
 });
}
/* 编辑内容（整篇 md）直接持久化，不篡改、不强制添加路由与标题前缀（单文档：功能说明） */
function applyEditText(md){
 if(!currentSource)return;
 var txt=String(md||'');
 currentSource.md=txt;
 if(!currentSource.docs)currentSource.docs={};
 currentSource.docs['default']=currentSource.md;
 try{ clearDraft(false); }catch(e){}
 persistDocs();
 persistSandboxDoc();
}

/* ═══════ 单面板视口锚定 + 脏标记 + 灾备草稿（P1） ═══════
   全部单面板 100% 宽度原位流转：进编辑记滚动百分比与首可见标题并定位光标行，
   保存后滚回修改段并施加 300ms 微光。 */
var editBase=null;      /* 进入编辑时的原文快照（判脏基准） */
var draftTimer=null;    /* 灾备草稿防抖定时器（500ms） */
var viewAnchor=null;    /* {ratio, headIdx, headText, headLine} */
function docWrapEl(){
 try{
  if(docContentEl){
   if(docContentEl.closest){ var w=docContentEl.closest('.docs-body'); if(w)return w; }
   if(docContentEl.parentElement)return docContentEl.parentElement;
   return docContentEl;
  }
 }catch(e){}
 return docContentEl;
}
function draftKeyFor(inReq){
 /* 需求与说明一律按原型隔离：全局键曾导致切原型后显示/保存/取消串沙箱 */
 var scope='';
 try{ scope=sourceDocKey((typeof currentSource!=='undefined')?currentSource:null); }catch(e){}
 if(!scope)scope='default';
 if(inReq)return 'protoDocDraft_'+scope+'__req__';
 try{
  var base='protoDocDraft_'+sourceDocKey((typeof currentSource!=='undefined')?currentSource:null);
  return base;
 }
 catch(e){ return 'protoDocDraft_default'; }
}
function writeDraft(inReq){
 if(!editOn||!docEditArea)return;
 safeStorage.set(draftKeyFor(inReq),JSON.stringify({md:docEditArea.value||'',ts:Date.now()}));
}
function readDraft(inReq){
 try{
  var s=safeStorage.get(draftKeyFor(inReq));
  if(!s)return null;
  var o=JSON.parse(s);
  if(o&&typeof o.md==='string')return o;
 }catch(e){}
 return null;
}
function clearDraft(inReq){
 try{ if(draftTimer){clearTimeout(draftTimer);draftTimer=null;} }catch(e){}
 try{ localStorage.removeItem(draftKeyFor(inReq)); }catch(e){}
}
function markDirtyInput(){
 if(!editOn)return;
 try{ if(draftTimer)clearTimeout(draftTimer); }catch(e){}
 draftTimer=setTimeout(function(){ draftTimer=null; try{ writeDraft(typeof reqMode!=='undefined'&&reqMode); }catch(e){} },500);
}
function isDocDirty(){
 if(!editOn||!docEditArea)return false;
 try{ return String(docEditArea.value||'')!==String(editBase==null?'':editBase); }
 catch(e){ return false; }
}
function recordViewAnchor(mdText){
 var a={ratio:0,headIdx:-1,headText:'',headLine:0};
 try{
  var w=docWrapEl();
  if(w){ var max=w.scrollHeight-w.clientHeight; a.ratio=max>0?(w.scrollTop/max):0; }
  if(docContentEl){
   var wb=null;
   try{ wb=w?w.getBoundingClientRect():null; }catch(e){}
   var hs=docContentEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
   for(var i=0;i<hs.length;i++){
    try{
     var r=hs[i].getBoundingClientRect();
     if(!wb||r.top>=wb.top-8){ a.headIdx=i; break; }
    }catch(e){}
   }
   if(a.headIdx<0&&hs.length)a.headIdx=hs.length-1;
  }
  var heads=[];
  try{ heads=extractHeadings(mdText)||[]; }catch(e){}
  if(a.headIdx>=0&&heads[a.headIdx]){ a.headText=heads[a.headIdx].text||''; a.headLine=heads[a.headIdx].line||0; }
  else if(heads.length){ a.headText=heads[0].text||''; a.headLine=heads[0].line||0; }
  else{ var lc=String(mdText||'').split('\n').length; a.headLine=Math.floor(a.ratio*Math.max(0,lc-1)); }
 }catch(e){}
 viewAnchor=a;
 return a;
}
function setAreaLine(ta,line){
 try{
  var v=ta.value||''; var ls=v.split('\n');
  if(!(line>=0))line=0; if(line>=ls.length)line=ls.length-1;
  var off=0; for(var i=0;i<line;i++)off+=ls[i].length+1;
  ta.setSelectionRange(off,off);
  var ratio=(viewAnchor&&viewAnchor.ratio!=null)?viewAnchor.ratio:0;
  ta.scrollTop=ratio*Math.max(0,ta.scrollHeight-ta.clientHeight);
 }catch(e){}
}
function cursorCtx(){
 var c={line:0,headText:''};
 try{
  var v=(docEditArea&&docEditArea.value)||'';
  var pos=(docEditArea&&docEditArea.selectionStart)||0;
  c.line=v.slice(0,pos).split('\n').length-1;
  var ls=v.split('\n');
  for(var i=Math.min(c.line,ls.length-1);i>=0;i--){
   var m=/^(#{1,6})\s+(.*)$/.exec(String(ls[i]).trim());
   if(m){ c.headText=String(m[2]).replace(/\s+#+\s*$/,'').trim(); break; }
  }
 }catch(e){}
 return c;
}
function microGlow(el){
 try{
  el.style.transition='box-shadow .3s ease';
  el.style.boxShadow='0 0 0 3px rgba(37,99,235,0.35)';
  setTimeout(function(){ try{ el.style.boxShadow=''; }catch(e){} },300);
 }catch(e){}
}
function restoreAfterSave(ctx){
 try{ loadDesc(); }catch(e){ return; }
 try{
  var target=null;
  if(ctx&&ctx.headText&&docContentEl){
   var hs=docContentEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
   for(var i=0;i<hs.length;i++){
    if(((hs[i].textContent||'').trim())===ctx.headText){ target=hs[i]; break; }
   }
  }
  if(target){
   try{ if(typeof scrollDocTo==='function')scrollDocTo(target); }catch(e){}
   flashTitle(target);
   microGlow(target);
  }else if(viewAnchor){
   var w=docWrapEl();
   if(w){ var max=w.scrollHeight-w.clientHeight; if(max>0)w.scrollTop=viewAnchor.ratio*max; }
  }
 }catch(e){}
}

function setDocEditChrome(editing){
 try{
  var w=null;
  try{ w=document.getElementById('docExportWrap'); }catch(e){}
  if(!w){ try{ w=document.getElementById('btnDocExportWrap'); }catch(e2){} }
  if(!w){
   try{
    var b0=document.getElementById('btnDocExport');
    if(b0&&b0.closest) w=b0.closest('.doc-export-wrap')||b0.parentElement;
   }catch(e3){}
  }
  if(w) w.style.display=editing?'none':'';
 }catch(e){}
 try{
  var b=null;
  try{ b=document.getElementById('btnDocAssets'); }catch(e){}
  if(b) b.style.display=editing?'none':'';
 }catch(e){}
 if(editing){ try{ closeDocExportMenu(); }catch(e){} }
}
function exitEdit(){editOn=false;editHash=null;editBase=null;docEditEl.style.display='none';docContentEl.style.display='';if(btnEditDoc)btnEditDoc.textContent=' 编辑';if(btnEditDoc)btnEditDoc.disabled=false;if(btnCancelDoc)btnCancelDoc.style.display='none';if(btnSaveDoc)btnSaveDoc.style.display='none';try{ setDocEditChrome(false); }catch(e){}}
function enterEdit(){
 if(reqMode){ /* 移动端：编辑最新需求文档 */
  var reqBase='';
  try{ reqBase=String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){}
  recordViewAnchor(reqBase);
  var d=readDraft(true);
  var val=reqBase;
  var restored=false;
  if(d&&d.md!=null&&String(d.md)!==reqBase){ val=String(d.md); restored=true; }
  editOn=true; editHash='__req__';
  docContentEl.style.display='none';
  docEditEl.style.display='flex';
  docEditArea.value=val; editBase=reqBase;
  try{ docUndoReset(docEditArea,String(val||'')); }catch(e){}
  if(btnEditDoc){btnEditDoc.textContent='编辑中…';btnEditDoc.disabled=true;}
  if(btnCancelDoc)btnCancelDoc.style.display='';
  if(btnSaveDoc)btnSaveDoc.style.display='';
  try{ setDocEditChrome(true); }catch(e){}
  docEditArea.focus();
  try{ bindDocToolbar(document); }catch(e){}
  if(restored)showToast('已恢复自动保存的草稿');
  return;
 }
 flushEdit();
 var md=fullDocMd();
 recordViewAnchor(md);
 var baseMd=String(md||'');
 var dd=readDraft(false);
 var v=baseMd, restored2=false;
 if(dd&&dd.md!=null&&String(dd.md)!==baseMd){ v=String(dd.md); restored2=true; }
 editOn=true; editHash='__doc__';
 docContentEl.style.display='none';
 docEditEl.style.display='flex';
 docEditArea.value=v; editBase=baseMd;
 try{ docUndoReset(docEditArea,String(v||'')); }catch(e){}
 if(btnEditDoc){btnEditDoc.textContent='编辑中…';btnEditDoc.disabled=true;}
 if(btnCancelDoc)btnCancelDoc.style.display='';
 if(btnSaveDoc)btnSaveDoc.style.display='';
 try{ setDocEditChrome(true); }catch(e){}
 docEditArea.focus();
 setAreaLine(docEditArea,viewAnchor?viewAnchor.headLine:0);
 try{ bindDocToolbar(document); }catch(e){}
 if(restored2)showToast('已恢复自动保存的草稿');
}
function saveEdit(){
 if(reqMode){ saveReqEditDocs(); return; }
 if(!editOn)return;
 var ctx=cursorCtx();
 applyEditText(docEditArea.value);
 exitEdit();
 restoreAfterSave(ctx); /* 保存后滚回修改段 + 300ms 微光 */
}
/* Ctrl+S 原地保存：不退出编辑态，不切换显隐，不抢焦点不移光标，视口不动 */
function saveReqPanelInPlace(){
 try{
  var re=null; try{ re=document.getElementById('reqEditArea'); }catch(e){}
  if(!re)return;
  var s=null,e2=null,st=0;
  try{ s=re.selectionStart; e2=re.selectionEnd; st=re.scrollTop; }catch(e){}
  var txt=String(re.value||'');
  var restore=function(){ try{ if(re.setSelectionRange!=null&&s!=null)re.setSelectionRange(s,e2==null?s:e2); }catch(e){} try{ re.scrollTop=st; }catch(e){} };
  if(window.__EXPORT_BOOT__){ try{ reqText=txt; }catch(e){} restore(); try{ showToast('已保存'); }catch(e){} return; }
  var can=false;
  try{ can=!!(window.protoAPI&&window.protoAPI.doc&&typeof aiSbxDir==='function'); }catch(e){}
  if(!can){ try{ reqText=txt; }catch(e){} restore(); try{ showToast('已保存'); }catch(e){} return; }
  try{
   window.protoAPI.doc.writeLatest(aiSbxDir(),txt).then(function(r){
    if(r&&r.ok){ try{ reqText=txt; }catch(e){} restore(); try{ showToast('已保存'); }catch(e){} }
    else{ restore(); try{ showToast('保存失败'); }catch(e){} }
   }).catch(function(){ restore(); try{ showToast('保存失败'); }catch(e){} });
  }catch(e){ restore(); }
 }catch(e){}
}
function saveDocInPlace(){
 try{
  var inReq=false; try{ inReq=(typeof reqMode!=='undefined'&&reqMode); }catch(e){}
  var ae=null; try{ ae=document.activeElement; }catch(e){}
  var inReqPanel=false;
  try{
   if(ae&&ae.id==='reqEditArea')inReqPanel=true;
   else{
    var editing2=false; try{ editing2=(typeof reqEditing!=='undefined'&&reqEditing); }catch(e){}
    if(editing2&&ae&&ae.id==='reqEditArea')inReqPanel=true;
   }
  }catch(e){}
  if(inReqPanel){ try{ saveReqPanelInPlace(); }catch(e){} return; }
  if(!editOn||!docEditArea)return;
  var el=docEditArea;
  var s=null,e2=null,st=0;
  try{ s=el.selectionStart; e2=el.selectionEnd; st=el.scrollTop; }catch(e){}
  if(inReq){
   var txt=String(el.value||'');
   var done=function(ok){
    try{ if(ok){ try{ reqText=txt; }catch(e){} try{ editBase=String(txt); }catch(e){} try{ clearDraft(true); }catch(e){} } }catch(e){}
    try{ if(el.setSelectionRange!=null&&s!=null)el.setSelectionRange(s,e2==null?s:e2); }catch(e){}
    try{ el.scrollTop=st; }catch(e){}
    try{ showToast(ok?'已保存':'保存失败'); }catch(e){}
   };
   if(window.__EXPORT_BOOT__){ done(true); return; }
   var canWrite=false;
   try{ canWrite=!!(window.protoAPI&&window.protoAPI.doc&&typeof aiSbxDir==='function'); }catch(e){}
   if(!canWrite){
    try{ reqText=txt; }catch(e){}
    try{ editBase=String(txt); }catch(e){}
    try{ clearDraft(true); }catch(e){}
    try{ if(el.setSelectionRange!=null&&s!=null)el.setSelectionRange(s,e2==null?s:e2); }catch(e){}
    try{ el.scrollTop=st; }catch(e){}
    try{ showToast('已保存'); }catch(e){}
    return;
   }
   try{
    window.protoAPI.doc.writeLatest(aiSbxDir(),txt).then(function(r){
     if(r&&r.ok){ done(true); }
     else{ try{ if(el.setSelectionRange!=null&&s!=null)el.setSelectionRange(s,e2==null?s:e2); }catch(e){} try{ el.scrollTop=st; }catch(e){} try{ showToast('保存失败'); }catch(e){} }
    }).catch(function(){
     try{ if(el.setSelectionRange!=null&&s!=null)el.setSelectionRange(s,e2==null?s:e2); }catch(e){} try{ el.scrollTop=st; }catch(e){} try{ showToast('保存失败'); }catch(e){}
    });
   }catch(e){ done(true); }
   return;
  }
  try{ applyEditText(el.value); }catch(e){}
  try{ editBase=String(el.value||''); }catch(e){}
  try{ clearDraft(false); }catch(e){}
  try{ if(el.setSelectionRange!=null&&s!=null)el.setSelectionRange(s,e2==null?s:e2); }catch(e){}
  try{ el.scrollTop=st; }catch(e){}
  try{ showToast('已保存'); }catch(e){}
 }catch(e){}
}
function cancelEdit(){
 if(!editOn)return;
 if(isDocDirty()){
  if(!window.confirm('当前功能说明有未保存的修改，确定放弃本次编辑吗？'))return;
 }
 if(reqMode){ try{clearDraft(true);}catch(e){} exitEdit(); setReqModeMobile(true); return; }
 try{ clearDraft(false); }catch(e){}
 exitEdit();
 loadDesc();
}
/* 返回 true=可继续切换；false=用户取消（调用方须中止）。脏时模态拦截确认。 */
function flushEdit(){
 if(!editOn)return true;
 if(reqMode){
  if(isDocDirty()){
   if(!window.confirm('当前功能说明有未保存的修改，是否保存并离开？'))return false;
   try{ saveReqEditDocs(); }catch(e){ exitEdit(); }
   return true;
  }
  exitEdit(); return true;
 }
 if(isDocDirty()){
  if(window.confirm('当前功能说明有未保存的修改，是否保存并离开？')){
   applyEditText(docEditArea.value);
   exitEdit();
   return true;
  }
  return false;
 }
 exitEdit();
 return true;
}
/* 脏标记守卫对外接口：供切换项目/关闭面板等跨文件流程调用 */
window.DocGuard={
 isDirty:function(){ try{ return isDocDirty(); }catch(e){ return false; } },
 confirmLeave:function(){
  try{
   if(!isDocDirty())return true;
   if(window.confirm('当前功能说明有未保存的修改，是否保存并离开？')){
    if(editOn&&!reqMode&&docEditArea){ applyEditText(docEditArea.value); }
    exitEdit();
    return true;
   }
   return false;
  }catch(e){ return true; }
 }
};
if(btnEditDoc)btnEditDoc.onclick=enterEdit;
if(btnSaveDoc)btnSaveDoc.onclick=saveEdit;
if(btnCancelDoc)btnCancelDoc.onclick=cancelEdit;

/* ═══════ 轻量 GFM 编译核（私有作用域，不污染全局；对外仅 renderMd 与 extractHeadings） ═══════
   支持：H1-H6 / 加粗 / 斜体 / 删除线 / 行内代码 / 围栏代码块 / 任务列表 /
   对齐表格（外包 .md-table-wrap）/ 引用块与 NOTE-TIP-WARNING callout / 图片。 */
var __DocGfm=(function(){
 /* Wave-C/F: 私有 esc 显式收敛至 utils (运行时只读委托, 无静态 import 以保 vm 门禁; ESM 化后转 import) */
 function esc(s){ try { if (typeof window !== 'undefined' && window.Utils && typeof window.Utils.esc === 'function') return window.Utils.esc(s); } catch (e) {} return String(s==null?'':s).replace(/\&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
 function escAttr(s){ try { if (typeof window !== 'undefined' && window.Utils && typeof window.Utils.escAttr === 'function') return window.Utils.escAttr(s); } catch (e) {} return esc(s).replace(/"/g,'&quot;'); }
 function projNameOf(opts){
  if(opts&&opts.project)return String(opts.project);
  try{ if(typeof currentProject!=='undefined'&&currentProject)return String(currentProject); }catch(e){}
  return '';
 }
 function protoSegOf(opts){
  if(opts&&opts.proto)return String(opts.proto);
  var src=null;
  try{ src=(opts&&opts.source)||((typeof currentSource!=='undefined')?currentSource:null); }catch(e){ src=null; }
  if(src){
   if(src.sandboxDir){
    var d=String(src.sandboxDir).replace(/[\\/]+$/,'');
    var p=d.split(/[\\/]/); var b=p[p.length-1];
    if(b)return b;
   }
   if(src.displayName)return String(src.displayName);
   if(src.name)return String(src.name);
  }
  return '';
 }
 function encSeg(s){ try{ return encodeURIComponent(String(s)); }catch(e){ return String(s); } }
 /* 相对 assets 路径重写为 proto-asset 协议；data:/http(s):/blob:/已有协议/锚点原样 */
 function assetUrl(src,opts){
  var s=String(src==null?'':src).trim();
  if(!s)return s;
  if(/^(data:|blob:|proto-asset:|[a-zA-Z][a-zA-Z0-9+\-.]*:|\/\/|#)/.test(s))return s;
  if(s.charAt(0)==='/')return s;
  var p=s.replace(/^\.\//,'');
  var proj=projNameOf(opts), seg=protoSegOf(opts);
  if(!proj||!seg)return s;
  return 'proto-asset://local/'+encSeg(proj)+'/'+encSeg(seg)+'/'+p.split('/').map(encSeg).join('/');
 }
 var PH='\u0000';
  /* P2 图片缩放对齐：自有 GFM 后缀 {w=NN} / {w=NN align=xx} / {align=xx}（w 取 10-100 整数，
     align 仅 left/center/right 其一）；非法后缀整体忽略（按缺省渲染并丢弃后缀）；缺省居中；
     Lightbox 走原图 URL，不受缩放影响。 */
  function parseImgSpec(suffixRaw){
   try{
    var s=String(suffixRaw==null?'':suffixRaw).trim();
    if(!s)return null;
    if(s.charAt(0)==='{'&&s.charAt(s.length-1)==='}')s=s.slice(1,-1);
    s=String(s).trim();
    if(!s)return null;
    var toks=s.split(/\s+/);
    if(toks.length<1||toks.length>2)return null;
    var w=null, al=null;
    for(var i=0;i<toks.length;i++){
     var tk=toks[i];
     var mw=/^w=(\d{1,3})$/.exec(tk);
     if(mw){
      if(w!=null)return null;
      var n=parseInt(mw[1],10);
      if(!(n>=10&&n<=100))return null;
      w=n; continue;
     }
     var ma=/^align=(left|center|right)$/.exec(tk);
     if(ma){
      if(al!=null)return null;
      al=ma[1]; continue;
     }
     return null;
    }
    if(w==null&&al==null)return null;
    return {w:w,align:al};
   }catch(e){ return null; }
  }
  function renderImg(alt,src,title,opts,ctx,suffixRaw){
   var raw=String(src||'');
   var url=assetUrl(raw,opts);
   var a=String(alt==null?'':alt);
   if(ctx)ctx.imgs++;
   var spec=parseImgSpec(suffixRaw);
   var im='<img class="md-img-el" src="'+escAttr(url)+'" data-src="'+escAttr(raw)+'" alt="'+escAttr(a)+'"'
    +(title?' title="'+escAttr(title)+'"':'')
    +' loading="lazy" style="max-width:100%;height:auto;border-radius:8px;cursor:zoom-in;" />';
   if(!spec){
    if(a){
     return '<figure class="md-img" style="margin:10px 0;text-align:center;max-width:100%;">'
      +im+'<figcaption class="md-img-cap" style="font-size:12px;color:#64748b;margin-top:4px;">'+esc(a)+'</figcaption></figure>';
    }
    return '<span class="md-img" style="display:block;margin:10px 0;text-align:center;max-width:100%;">'+im+'</span>';
   }
   var wCss=spec.w?('width:'+spec.w+'%;max-width:'+spec.w+'%;'):'max-width:100%;';
   var al=spec.align||'center';
   var mg=al==='left'?'margin:10px 0;':(al==='right'?'margin:10px 0 10px auto;':'margin:10px auto;');
   var cls='doc-img-align-'+al;
   if(a){
    return '<figure class="md-img '+cls+'" style="'+mg+'text-align:'+al+';'+wCss+'">'
     +im+'<figcaption class="md-img-cap" style="font-size:12px;color:#64748b;margin-top:4px;">'+esc(a)+'</figcaption></figure>';
   }
   return '<span class="md-img '+cls+'" style="display:block;'+mg+'text-align:'+al+';'+wCss+'">'+im+'</span>';
  }
 /* 行内排版：先暂存代码段与图片（防转义破坏），再做加粗/斜体/删除线 */
 function inlineFmt(t,opts,ctx){
  var s=String(t==null?'':t);
  var parts=[];
  function stash(html){ parts.push(html); return PH+(parts.length-1)+PH; }
  s=s.replace(/`([^`\n]+?)`/g,function(m,g){ return stash('<code>'+esc(g)+'</code>'); });
   s=s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(\{[^{}]*\})?/g,function(m,alt,src,title,suffix){ return stash(renderImg(alt,src,title,opts,ctx,suffix)); });
  s=esc(s);
  /* 保留 PRD 内有意使用的 HTML 换行与必填标记 */
  s=s.replace(/&lt;br&gt;/g,'<br>').replace(/&lt;i&gt;/g,'<i>').replace(/&lt;\/i&gt;/g,'</i>');
  s=s.replace(/&lt;font\b([^>]*?)&gt;/gi,'<font$1>').replace(/&lt;\/font&gt;/gi,'</font>');
  s=s.replace(/\*\*\*([\s\S]+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  s=s.replace(/\*\*([\s\S]+?)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/__([\s\S]+?)__/g,'<strong>$1</strong>');
  s=s.replace(/(^|[^*\w])\*([^*\n]+?)\*/g,'$1<em>$2</em>');
  s=s.replace(/(^|[^\w])_([^_\n]+?)_/g,'$1<em>$2</em>');
  s=s.replace(/~~([\s\S]+?)~~/g,'<del>$1</del>');
  s=s.replace(new RegExp(PH+'(\\d+)'+PH,'g'),function(m,i){ return parts[+i]; });
  return s;
 }
 function isCommentStart(l){ return /^\s*<!--/.test(l); }
 function splitRow(l){
  var s=String(l).trim();
  if(s.charAt(0)==='|')s=s.slice(1);
  if(s.charAt(s.length-1)==='|')s=s.slice(0,-1);
  return s.split('|').map(function(c){ return c.trim(); });
 }
 function isSepRow(cells){ return cells.length>0&&cells.every(function(c){ return /^:?-{1,}:?$/.test(c); }); }
 function alignOf(cell){
  var c=String(cell).trim();
  var l=c.charAt(0)===':', r=c.charAt(c.length-1)===':';
  if(l&&r)return 'center'; if(r)return 'right'; return 'left';
 }
  function flushTableHTML(buf,opts,ctx,startLine){
   var sLine=(typeof startLine==='number'&&startLine>=0)?Math.floor(startLine):0;
   var rows=buf.map(splitRow);
   var headEls=rows[0]||[];
   var sep=rows.length>1?rows[1]:[];
   var aligns=sep.map(alignOf);
   var body=rows.slice(2);
   /* 行号经tr与外层wrap承载，内层th/td保持 exact 兼容旧断言；列经td序号推导 */
   var th='<tr data-md-line="'+sLine+'">'+headEls.map(function(c,i){
    return '<th style="text-align:'+(aligns[i]||'left')+';">'+inlineFmt(c,opts,ctx)+'</th>';
   }).join('')+'</tr>';
   var td=body.map(function(r,ri){
    var rLine=sLine+2+ri;
    return '<tr data-md-line="'+rLine+'">'+headEls.map(function(_,i){
     return '<td style="text-align:'+(aligns[i]||'left')+';">'+inlineFmt(r[i]==null?'':r[i],opts,ctx)+'</td>';
    }).join('')+'</tr>';
   }).join('');
   var eLine=sLine+buf.length;
   return '<div class="md-table-wrap" data-md-start="'+sLine+'" data-md-end="'+eLine+'" style="max-width:100%;overflow-x:auto;">'
    +'<table class="md-table"><thead>'+th+'</thead><tbody>'+td+'</tbody></table></div>';
  }
 /* 连续列表行成组解析（含嵌套与任务列表）；返回 {html,next} */
 function parseList(lines,start,opts,ctx){
  var items=[],i=start;
  while(i<lines.length){
   var l=lines[i];
   if(String(l).trim()==='')break;
   var m=/^(\s*)(?:(\d+)[.\)]\s+|([-*+])\s+)([\s\S]*)$/.exec(l);
   if(!m)break;
   var indent=String(m[1]).replace(/\t/g,'  ').length;
   var rest=String(m[4]);
   var type=(m[2]!=null)?'ol':'ul';
    var checked=null;
    var tm=/^\[([ xX])\]\s+([\s\S]*)$/.exec(rest);
    if(tm&&type==='ul'){ type='task'; checked=(tm[1].toLowerCase()==='x'); rest=tm[2]; }
    items.push({indent:indent,type:type,checked:checked,num:(m[2]!=null?parseInt(m[2],10):null),text:rest,line:i});
    i++;
  }
  if(!items.length)return {html:'',next:start};
  /* 嵌套由下方迭代建树处理（同层合并，深层递归为子列表）；移除旧死代码避免嵌套时 frame 无 children 抛错 */
   function renderListNode(listType,its,startNum){
    var tag=listType==='ol'?'ol':'ul';
    var cls=listType==='ol'?'md-ol':(listType==='task'?'md-task-list':'md-ul');
    var st=(listType==='ol'&&startNum&&startNum!==1)?' start="'+startNum+'"':'';
    /* 行号经外层包裹承载，内层ol/ul/li保持 exact 兼容旧断言；列经li序号推导 */
    var gStart=-1,gEnd=-1,gLines=[];
    try{
     for(var gi=0;gi<its.length;gi++){ var gl=(its[gi]&&its[gi].data&&typeof its[gi].data.line==='number')?its[gi].data.line:-1; if(gl>=0){ if(gStart<0||gl<gStart)gStart=gl; if(gEnd<0||gl+1>gEnd)gEnd=gl+1; gLines.push(gl); } }
    }catch(e){}
    var lis=its.map(function(it){
     var inner=inlineFmt(it.data.text,opts,ctx);
     var sub=it.sub||'';
     if(it.data.type==='task'){
      var idx=ctx.taskSeq++;
      return '<li class="md-task"><label class="md-task-label" style="display:flex;gap:6px;align-items:flex-start;cursor:pointer;">'
       +'<input type="checkbox" class="doc-task" data-task-idx="'+idx+'"'+(it.data.checked?' checked':'')+' style="margin-top:4px;" />'
       +'<span>'+inner+'</span></label>'+sub+'</li>';
     }
     return '<li>'+inner+sub+'</li>';
    }).join('');
    var core='<'+tag+' class="'+cls+'"'+st+'>'+lis+'</'+tag+'>';
    if(gStart>=0&&gEnd>gStart){
     return '<div data-md-start="'+gStart+'" data-md-end="'+gEnd+'" data-md-lines="'+gLines.join(',')+'" style="display:contents;">'+core+'</div>';
    }
    return core;
   }
  /* 迭代建树：栈顶 frame 收集子项 */
  var html='';
  var p=0;
  while(p<items.length){
   var lvl=Math.floor(items[p].indent/2);
   var cur=items[p].type;
   var grp=[]; var sn=items[p].num||1;
   while(p<items.length&&Math.floor(items[p].indent/2)===lvl&&items[p].type===cur){ grp.push({data:items[p],sub:''}); p++; }
   /* 收集紧随的更深缩进块作为最后一项的子列表 */
   if(p<items.length&&Math.floor(items[p].indent/2)>lvl&&grp.length){
    var subHtml='';
    var subLvl=Math.floor(items[p].indent/2);
    var subCur=items[p].type;
    var subGrp=[]; var subSn=items[p].num||1;
    while(p<items.length&&Math.floor(items[p].indent/2)>=subLvl){
     if(Math.floor(items[p].indent/2)===subLvl&&items[p].type!==subCur)break;
     if(Math.floor(items[p].indent/2)===subLvl){ subGrp.push({data:items[p],sub:''}); p++; }
     else break;
    }
    subHtml=renderListNode(subCur,subGrp,subSn);
    grp[grp.length-1].sub=subHtml;
   }
   html+=renderListNode(cur,grp,sn);
  }
  return {html:html,next:i};
 }
  function renderQuote(lines,opts,ctx,startLine){
   var sQ=(typeof startLine==='number'&&startLine>=0)?Math.floor(startLine):-1;
   var eQ=(sQ>=0)?(sQ+lines.length):-1;
   var qAttr=(sQ>=0)?(' data-md-start="'+sQ+'" data-md-end="'+eQ+'"'):'';
   var inner=lines.map(function(l){ return String(l).replace(/^\s*>/,'').replace(/^ /,''); });
  while(inner.length&&inner[0].trim()==='')inner.shift();
  while(inner.length&&inner[inner.length-1].trim()==='')inner.pop();
  var first=(inner[0]||'').trim();
  var cm=/^\[!(NOTE|TIP|WARNING)\]\s*([\s\S]*)$/i.exec(first);
  function paras(ls){
   var ps=[],cur=[];
   ls.forEach(function(l){
    if(String(l).trim()===''){ if(cur.length){ps.push(cur);cur=[];} }
    else cur.push(l);
   });
   if(cur.length)ps.push(cur);
   if(!ps.length&&ls.length)ps.push(ls);
   return ps.map(function(p){ return '<p>'+p.map(function(x){return inlineFmt(x,opts,ctx);}).join('<br>')+'</p>'; }).join('');
  }
  if(cm){
   var kind=String(cm[1]).toUpperCase();
   inner[0]=cm[2]||'';
   var bar=kind==='WARNING'?'#d97706':(kind==='TIP'?'#16a34a':'#2563eb');
   var bg=kind==='WARNING'?'#fffbeb':(kind==='TIP'?'#f0fdf4':'#eff6ff');
   var label=kind==='WARNING'?'WARNING':(kind==='TIP'?'TIP':'NOTE');
    return '<blockquote class="md-quote md-callout md-'+kind.toLowerCase()+'"'+qAttr+' style="border-left:3px solid '+bar+';background:'+bg+';margin:10px 0;padding:8px 12px;border-radius:0 8px 8px 0;max-width:100%;box-sizing:border-box;">'
     +'<div class="md-callout-title" style="font-weight:700;font-size:12px;margin-bottom:4px;">'+label+'</div>'
     +'<div class="md-callout-body">'+paras(inner)+'</div></blockquote>';
   }
   return '<blockquote class="md-quote"'+qAttr+' style="border-left:3px solid #cbd5e1;margin:10px 0;padding:4px 12px;color:#334155;max-width:100%;box-sizing:border-box;">'
    +paras(inner)+'</blockquote>';
 }
   /* P3 本地化Mermaid子集：flowchart/graph TD|LR 与 sequenceDiagram 内联SVG（私有，无新script无CDN，纯色，失败回退代码块，绝不抛错） */
   /* 已删除页面锚点解析 docPageHeadOf：标题不再渲染可点 badge，恢复普通标题；DocShuttle.canvasToDoc 与 jumpToSubPageByRoute 保留不动 */
   function mermaidFlowSvg(codeText,dir){
   try{
    var rawLines=String(codeText||'').split('\n');
    var nodes={},order=[],shapes={},edges=[];
    function addNode(id,label,shape){
     id=String(id||'').trim();
     if(!id) return;
     if(!/^[A-Za-z0-9_]+$/.test(id)) return;
     label=(label==null? id : String(label));
     if(!nodes.hasOwnProperty(id)){ order.push(id); }
     if(!nodes[id]||nodes[id]===id) nodes[id]=label;
     if(shape) shapes[id]=shape;
    }
    function normStmt(stmt){
     var s=String(stmt||'');
     try{
      var re=/([A-Za-z0-9_]+)\s*\[([^\]]+)\]|([A-Za-z0-9_]+)\s*\(([^\)]+)\)|([A-Za-z0-9_]+)\s*\{([^\}]+)\}/g;
      var mm=null;
      while((mm=re.exec(s))){
       if(mm[1]) addNode(mm[1],String(mm[2]).trim(),'rect');
       else if(mm[3]) addNode(mm[3],String(mm[4]).trim(),'round');
       else if(mm[5]) addNode(mm[5],String(mm[6]).trim(),'diamond');
      }
     }catch(e){}
     try{
      s=s.replace(/([A-Za-z0-9_]+)\s*\[[^\]]+\]/g,'$1').replace(/([A-Za-z0-9_]+)\s*\([^\)]+\)/g,'$1').replace(/([A-Za-z0-9_]+)\s*\{[^\}]+\}/g,'$1');
     }catch(e){}
     return s;
    }
    for(var li=0;li<rawLines.length;li++){
     var ln=String(rawLines[li]||'').trim();
     if(!ln) continue;
     if(ln.indexOf('%%')===0) continue;
     var stmts=ln.split(';');
     for(var si=0;si<stmts.length;si++){
      var st=String(stmts[si]||'').trim();
      if(!st) continue;
      if(st.indexOf('%%')===0) continue;
      var ns=normStmt(st);
      var mLab=/([A-Za-z0-9_]+)\s*-+>\s*\|\s*([^|]+?)\s*\|\s*([A-Za-z0-9_]+)/.exec(ns);
      var mPlain=null;
      if(mLab){
       var a=String(mLab[1]).trim(), b=String(mLab[3]).trim(), lab=String(mLab[2]).trim();
       if(!/^[A-Za-z0-9_]+$/.test(a)||!/^[A-Za-z0-9_]+$/.test(b)) continue;
       addNode(a,a,null); addNode(b,b,null);
       edges.push({from:a,to:b,label:lab});
       continue;
      }
      mPlain=/([A-Za-z0-9_]+)\s*-+>\s*([A-Za-z0-9_]+)/.exec(ns);
      if(mPlain){
       var c=String(mPlain[1]).trim(), d=String(mPlain[2]).trim();
       if(!/^[A-Za-z0-9_]+$/.test(c)||!/^[A-Za-z0-9_]+$/.test(d)) continue;
       addNode(c,c,null); addNode(d,d,null);
       edges.push({from:c,to:d,label:''});
       continue;
      }
      var solo=/^([A-Za-z0-9_]+)$/.exec(ns);
      if(solo){ addNode(solo[1],solo[1],null); continue; }
     }
    }
    if(!order.length||!edges.length) return null;
    if(order.length>24) order=order.slice(0,24);
    var keepEdges=[];
    for(var e=0;e<edges.length;e++){ if(nodes.hasOwnProperty(edges[e].from)&&nodes.hasOwnProperty(edges[e].to)) keepEdges.push(edges[e]); if(keepEdges.length>=40) break; }
    if(!keepEdges.length) return null;
    edges=keepEdges;
    var pos={};
    var W=0,H=0;
    if(dir==='LR'){
     W=order.length*170+40; H=140;
     for(var i=0;i<order.length;i++){ pos[order[i]]={x:30+i*170+60,y:50}; }
    }else{
     W=360; H=order.length*76+40;
     for(var j=0;j<order.length;j++){ pos[order[j]]={x:W/2,y:30+j*76}; }
    }
    if(W>1200) W=1200;
    if(H>1800) H=1800;
    var out='<svg class="doc-svg-diagram-svg" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 '+W+' '+H+'" role="img" style="max-width:100%;height:auto;display:block;background:#FFFFFF;border:1px solid #E3E6EC;border-radius:8px;">';
    for(var k=0;k<edges.length;k++){
     var fr=pos[edges[k].from], to=pos[edges[k].to];
     if(!fr||!to) continue;
     var x1=fr.x,y1=fr.y,x2=to.x,y2=to.y;
     if(dir==='LR'){ x1=fr.x+60; y1=fr.y+20; x2=to.x-60; y2=to.y+20; }
     else{ x1=fr.x; y1=fr.y+19; x2=to.x; y2=to.y-19; }
     out+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="#64748B" stroke-width="1.6" />';
     var ax=x2,ay=y2,sz=6,pts='';
     if(dir==='LR'){ pts=ax+','+ay+' '+(ax-sz)+','+(ay-4)+' '+(ax-sz)+','+(ay+4); }
     else{ pts=ax+','+ay+' '+(ax-4)+','+(ay-sz)+' '+(ax+4)+','+(ay-sz); }
     out+='<polygon points="'+pts+'" fill="#64748B" />';
     if(edges[k].label){
      var mx=Math.round((x1+x2)/2), my=Math.round((y1+y2)/2)-6;
      out+='<text x="'+mx+'" y="'+my+'" text-anchor="middle" font-size="11" fill="#334155">'+esc(edges[k].label)+'</text>';
     }
    }
    for(var n=0;n<order.length;n++){
     var id=order[n], p=pos[id], lb=String(nodes[id]==null?id:nodes[id]);
     if(lb.length>18) lb=lb.slice(0,18);
     var sh=shapes[id]||'rect';
     var cx=p.x, cy=p.y;
     if(dir==='LR'){ cx=p.x; cy=p.y+20; }
     if(sh==='diamond'){
      var w2=70,h2=20;
      var pts2=cx+','+(cy-h2)+' '+(cx+w2)+','+cy+' '+cx+','+(cy+h2)+' '+(cx-w2)+','+cy;
      out+='<polygon points="'+pts2+'" fill="#EFF6FF" stroke="#3B5BDB" stroke-width="1.6" />';
     }else if(sh==='round'){
      out+='<rect x="'+(cx-60)+'" y="'+(cy-19)+'" width="120" height="38" rx="19" ry="19" fill="#EFF6FF" stroke="#3B5BDB" stroke-width="1.6" />';
     }else{
      out+='<rect x="'+(cx-60)+'" y="'+(cy-19)+'" width="120" height="38" rx="6" ry="6" fill="#EFF6FF" stroke="#3B5BDB" stroke-width="1.6" />';
     }
     out+='<text x="'+cx+'" y="'+(cy+4)+'" text-anchor="middle" font-size="12" fill="#1F2937">'+esc(lb)+'</text>';
    }
    out+='</svg>';
    return out;
   }catch(e){ return null; }
  }
  function mermaidSeqSvg(codeText){
   try{
    var lines=String(codeText||'').split('\n');
    var parts=[],msgs=[];
    function addPart(id,label){
     id=String(id||'').trim();
     if(!id||!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(id)) return;
     for(var i=0;i<parts.length;i++){ if(parts[i].id===id) return; }
     parts.push({id:id,label:String(label==null||label==='' ? id : label).slice(0,16)});
    }
    for(var li=1;li<lines.length;li++){
     var ln=String(lines[li]||'').trim();
     if(!ln||ln.indexOf('%%')===0) continue;
     var mp=/^(participant|actor)\s+([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\s+as\s+(.+))?$/i.exec(ln);
     if(mp){ addPart(String(mp[2]).trim(),String(mp[3]||'').trim()); continue; }
     var mn=/^Note\s+over\s+([^:]+):\s*(.*)$/i.exec(ln);
     if(mn){
      var who=String(mn[1]||'').split(',').map(function(s){return String(s).trim();}).filter(Boolean);
      for(var w=0;w<who.length;w++) addPart(who[w],who[w]);
      msgs.push({kind:'note',who:who,text:String(mn[2]||'').slice(0,40)});
      if(msgs.length>=40) break;
      continue;
     }
     var mm=/^([A-Za-z0-9_\u4e00-\u9fa5]+)\s*(->>|-->|->|-->>)\s*([A-Za-z0-9_\u4e00-\u9fa5]+)\s*:\s*(.*)$/.exec(ln);
     if(mm){
      var a=String(mm[1]).trim(), b=String(mm[3]).trim(), tx=String(mm[4]||'').slice(0,40);
      addPart(a,a); addPart(b,b);
      msgs.push({kind:'msg',from:a,to:b,text:tx,arrow:String(mm[2])});
      if(msgs.length>=40) break;
      continue;
     }
    }
    if(!parts.length||!msgs.length) return null;
    if(parts.length>8) parts=parts.slice(0,8);
    if(msgs.length>40) msgs=msgs.slice(0,40);
    var idx={};
    for(var i=0;i<parts.length;i++) idx[parts[i].id]=i;
    var W=parts.length*150+40, H=msgs.length*52+110;
    if(W>1200) W=1200;
    if(H>1800) H=1800;
    var out='<svg class="doc-svg-diagram-svg" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 '+W+' '+H+'" role="img" style="max-width:100%;height:auto;display:block;background:#FFFFFF;border:1px solid #E3E6EC;border-radius:8px;">';
    for(var p=0;p<parts.length;p++){
     var cx=20+p*150+75;
     out+='<rect x="'+(cx-55)+'" y="16" width="110" height="30" rx="6" ry="6" fill="#EFF6FF" stroke="#3B5BDB" stroke-width="1.6" />';
     out+='<text x="'+cx+'" y="35" text-anchor="middle" font-size="12" fill="#1F2937">'+esc(parts[p].label)+'</text>';
     out+='<line x1="'+cx+'" y1="46" x2="'+cx+'" y2="'+(H-16)+'" stroke="#CBD5E1" stroke-width="1.2" stroke-dasharray="5 4" />';
    }
    for(var m=0;m<msgs.length;m++){
     var y=78+m*52;
     var it=msgs[m];
     if(it.kind==='note'){
      var xs=[];
      for(var q=0;q<it.who.length;q++){ if(idx.hasOwnProperty(it.who[q])) xs.push(20+idx[it.who[q]]*150+75); }
      if(!xs.length) continue;
      var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs);
      var nx0=(xs.length>1? x0-55 : x0-70), nx1=(xs.length>1? x1+55 : x0+70);
      var nw=nx1-nx0;
      if(nw<140){ nx0-=Math.round((140-nw)/2); nw=140; }
      out+='<rect x="'+nx0+'" y="'+(y-16)+'" width="'+nw+'" height="30" rx="6" ry="6" fill="#FFFBEB" stroke="#F59E0B" stroke-width="1.4" />';
      out+='<text x="'+Math.round(nx0+nw/2)+'" y="'+(y+4)+'" text-anchor="middle" font-size="11" fill="#92400E">'+esc(it.text)+'</text>';
     }else{
      if(!idx.hasOwnProperty(it.from)||!idx.hasOwnProperty(it.to)) continue;
      var fx=20+idx[it.from]*150+75, tx2=20+idx[it.to]*150+75;
      var dashed=(it.arrow==='-->'||it.arrow==='-->>')?' stroke-dasharray="5 3"':'';
      out+='<line x1="'+fx+'" y1="'+y+'" x2="'+tx2+'" y2="'+y+'" stroke="#334155" stroke-width="1.6"'+dashed+' />';
      var dir2=(tx2>=fx)?1:-1;
      var pts3=tx2+','+y+' '+(tx2-dir2*7)+','+(y-4)+' '+(tx2-dir2*7)+','+(y+4);
      out+='<polygon points="'+pts3+'" fill="#334155" />';
      var mx2=Math.round((fx+tx2)/2);
      out+='<text x="'+mx2+'" y="'+(y-6)+'" text-anchor="middle" font-size="11" fill="#334155">'+esc(it.text)+'</text>';
     }
    }
    out+='</svg>';
    return out;
   }catch(e){ return null; }
  }
   function mermaidStateSvg(codeText){
    try{
     var lines=String(codeText==null?'':codeText).split('\n');
     var startIdx=0;
     for(var s0=0;s0<lines.length;s0++){ var tt=String(lines[s0]||'').trim(); if(!tt||tt.indexOf('%%')===0) continue; if(/^stateDiagram(-v2)?\s*$/i.test(tt)){ startIdx=s0+1; } break; }
     var nodes={},order=[],edges=[];
     function addSt(id,label){
      id=String(id||'').trim();
      if(!id) return;
      if(id==='[*]'){ if(!nodes.hasOwnProperty(id)) order.push(id); nodes[id]='[*]'; return; }
      if(!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(id)) return;
      label=(label==null||label===''?id:String(label)).slice(0,18);
      if(!nodes.hasOwnProperty(id)) order.push(id);
      if(!nodes[id]||nodes[id]===id) nodes[id]=label;
     }
     for(var li=startIdx;li<lines.length;li++){
      var ln=String(lines[li]||'').trim();
      if(!ln||ln.indexOf('%%')===0) continue;
      if(/^(note|state)\s/i.test(ln)){
       var mAs=/^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_]+)\s*$/.exec(ln);
       if(mAs){ addSt(mAs[2],mAs[1]); continue; }
       var mSt=/^state\s+([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\s*\{)?\s*$/.exec(ln);
       if(mSt){ addSt(mSt[1],mSt[1]); continue; }
       continue;
      }
      if(ln==='{'||ln==='}') continue;
      var mT=/^(\[\*\]|[A-Za-z0-9_\u4e00-\u9fa5]+)\s*--+>\s*(\[\*\]|[A-Za-z0-9_\u4e00-\u9fa5]+)(?:\s*:\s*(.*))?$/.exec(ln);
      if(mT){
       var a=String(mT[1]).trim(), b=String(mT[2]).trim(), lb=String(mT[3]||'').trim().slice(0,24);
       addSt(a,a); addSt(b,b);
       edges.push({from:a,to:b,label:lb});
       if(edges.length>=40) break;
       continue;
      }
      var mS=/^([A-Za-z0-9_\u4e00-\u9fa5]+)$/.exec(ln);
      if(mS){ addSt(mS[1],mS[1]); continue; }
     }
     if(!order.length||!edges.length) return null;
     if(order.length>24) order=order.slice(0,24);
     var keep=[];
     for(var e=0;e<edges.length;e++){ if(nodes.hasOwnProperty(edges[e].from)&&nodes.hasOwnProperty(edges[e].to)) keep.push(edges[e]); if(keep.length>=40) break; }
     if(!keep.length) return null;
     edges=keep;
     var pos={};
     var W=360, H=order.length*76+40;
     if(H>1800) H=1800;
     for(var j=0;j<order.length;j++){ pos[order[j]]={x:W/2,y:30+j*76}; }
     var out='<svg class="doc-svg-diagram-svg" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 '+W+' '+H+'" role="img" style="max-width:100%;height:auto;display:block;background:#FFFFFF;border:1px solid #E3E6EC;border-radius:8px;">';
     for(var k=0;k<edges.length;k++){
      var fr=pos[edges[k].from], to=pos[edges[k].to];
      if(!fr||!to) continue;
      var x1=fr.x,y1=fr.y,x2=to.x,y2=to.y;
      var r1=(edges[k].from==='[*]'?9:19), r2=(edges[k].to==='[*]'?9:19);
      if(y2>y1){ y1+=r1; y2-=r2; } else if(y2<y1){ y1-=r1; y2+=r2; } else { x1+=r1; x2-=r2; }
      out+='<line class="doc-state-arrow" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="#64748B" stroke-width="1.6" />';
      var ax=x2,ay=y2,sz=6,pts='';
      if(y2>y1){ pts=ax+','+ay+' '+(ax-4)+','+(ay-sz)+' '+(ax+4)+','+(ay-sz); }
      else if(y2<y1){ pts=ax+','+ay+' '+(ax-4)+','+(ay+sz)+' '+(ax+4)+','+(ay+sz); }
      else { pts=ax+','+ay+' '+(ax-sz)+','+(ay-4)+' '+(ax-sz)+','+(ay+4); }
      out+='<polygon points="'+pts+'" fill="#64748B" />';
      if(edges[k].label){
       var mx=Math.round((x1+x2)/2), my=Math.round((y1+y2)/2)-6;
       out+='<text x="'+mx+'" y="'+my+'" text-anchor="middle" font-size="11" fill="#334155">'+esc(edges[k].label)+'</text>';
      }
     }
     for(var n=0;n<order.length;n++){
      var id=order[n], p=pos[id];
      if(id==='[*]'){
       out+='<circle cx="'+p.x+'" cy="'+p.y+'" r="9" fill="#1F2937" stroke="#1F2937" stroke-width="1.6" />';
       out+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3" fill="#FFFFFF" />';
      }else{
       var lb2=String(nodes[id]==null?id:nodes[id]);
       out+='<rect class="doc-state-node" x="'+(p.x-60)+'" y="'+(p.y-19)+'" width="120" height="38" rx="6" ry="6" fill="#EFF6FF" stroke="#3B5BDB" stroke-width="1.6" />';
       out+='<text x="'+p.x+'" y="'+(p.y+4)+'" text-anchor="middle" font-size="12" fill="#1F2937">'+esc(lb2)+'</text>';
      }
     }
     out+='</svg>';
     return out;
    }catch(e){ return null; }
   }
   function renderMermaidMini(codeText){
    try{
     var txt=String(codeText==null?'':codeText);
     var ls=txt.split('\n');
     var first='';
     for(var i=0;i<ls.length;i++){ var t=String(ls[i]||'').trim(); if(!t||t.indexOf('%%')===0) continue; first=t; break; }
     if(!first) return null;
     var msd=/^stateDiagram(-v2)?\s*$/i.exec(first);
     if(msd){ return mermaidStateSvg(txt); }
    var mf=/^(flowchart|graph)\s+(TD|LR)\s*$/i.exec(first);
    if(mf){
     var dir=String(mf[2]).toUpperCase();
     var idx0=-1;
     for(var k=0;k<ls.length;k++){ if(String(ls[k]||'').trim()===first){ idx0=k; break; } }
     var body=(idx0>=0? ls.slice(idx0+1).join('\n') : txt);
     return mermaidFlowSvg(body,dir);
    }
    var ms=/^sequenceDiagram\s*$/i.exec(first);
    if(ms){ return mermaidSeqSvg(txt); }
    return null;
   }catch(e){ return null; }
  }
  function renderEngine(md,opts){
   if(md==null||String(md).trim()==='')return '<div class="doc-empty">本页面功能说明待提供，将在此补充。</div>';
  var lines=String(md).split('\n');
  var ctx={taskSeq:0,imgs:0};
  var html=[],i=0;
  function isTableAt(j){
   if(j+1>=lines.length)return false;
   var a=String(lines[j]).trim(), b=String(lines[j+1]).trim();
   if(a.charAt(0)!=='|'||b.charAt(0)!=='|')return false;
   return isSepRow(splitRow(b));
  }
   while(i<lines.length){
    var l=lines[i];
    if(isCommentStart(l)){ while(i<lines.length&&lines[i].indexOf('-->')<0)i++; i++; continue; }
    var fm=/^```/.exec(l);
    if(fm){
     var sCode=i;
     var lang=String(l).replace(/^```/,'').trim().split(/\s+/)[0]||'';
     var buf=[]; i++;
     while(i<lines.length&&!/^```/.test(lines[i])){ buf.push(lines[i]); i++; }
     i++;
     var eCode=Math.min(i,lines.length);
     var codeAttr=' data-md-start="'+sCode+'" data-md-end="'+eCode+'"';
     /* P3 mermaid子集：首行非flowchart/graph/sequence或解析失败则回退普通代码块，绝不抛错 */
     if(String(lang||'').toLowerCase()==='mermaid'){
      var _svg=null;
      try{ _svg=renderMermaidMini(buf.join('\n')); }catch(e){ _svg=null; }
      if(_svg){
       html.push('<div class="doc-svg-diagram"'+codeAttr+' style="max-width:100%;overflow-x:auto;margin:10px 0;">'+_svg+'</div>');
       continue;
      }
     }
     html.push('<div class="md-code-wrap"'+codeAttr+' style="max-width:100%;overflow-x:auto;"><pre class="md-code"><code'
      +(lang?' class="lang-'+escAttr(lang)+'"':'')+'>'+esc(buf.join('\n'))+'</code></pre></div>');
     continue;
    }
    var h=/^(#{1,6})\s+(.*)$/.exec(String(l).trim());
    if(h){
     var lvl=h[1].length;
     var ht=String(h[2]).replace(/\s+#+\s*$/,'');
      /* 已删除页面锚点 badge：标题恢复普通渲染，不再解析 route badge；点击跳转已解绑 */
      /* 行号经外层包裹（display:contents不改版式），内层保持<h class="md-h">原文 exact 兼容旧断言 */
      html.push('<div data-md-start="'+i+'" data-md-end="'+(i+1)+'" data-md-line="'+i+'" style="display:contents;"><h'+lvl+' class="md-h">'+inlineFmt(ht,opts,ctx)+'</h'+lvl+'></div>');
     i++; continue;
    }
    if(/^\s*(---|\*\*\*|___)\s*$/.test(l)){ html.push('<hr class="md-hr" data-md-start="'+i+'" data-md-end="'+(i+1)+'" data-md-line="'+i+'" />'); i++; continue; }
    if(String(l).trim().charAt(0)==='|'&&isTableAt(i)){
     var sTab=i;
     var buf2=[];
     while(i<lines.length&&String(lines[i]).trim().charAt(0)==='|'){ buf2.push(lines[i]); i++; }
     if(buf2.length>=2)html.push(flushTableHTML(buf2,opts,ctx,sTab));
     continue;
    }
    if(/^\s*>/.test(l)){
     var sQ=i;
     var q=[];
     while(i<lines.length&&/^\s*>/.test(lines[i])){ q.push(lines[i]); i++; }
     html.push(renderQuote(q,opts,ctx,sQ));
     continue;
    }
   if(/^(\s*)(?:\d+[.\)]\s+|[-*+]\s+)/.test(l)){
    var r=parseList(lines,i,opts,ctx);
    if(r.html){ html.push(r.html); i=r.next; continue; }
   }
    if(String(l).trim()===''){ i++; continue; }
    /* 段落：合并连续普通行；纯单图行不包 p，直接输出 figure */
    var sPara=i;
    var ps=[];
    while(i<lines.length){
     var cl=lines[i];
     if(String(cl).trim()==='')break;
     if(isCommentStart(cl)||/^```/.test(cl)||/^(#{1,6})\s+/.test(String(cl).trim())
      ||/^\s*(---|\*\*\*|___)\s*$/.test(cl)||/^\s*>/.test(cl)
      ||/^(\s*)(?:\d+[.\)]\s+|[-*+]\s+)/.test(cl))break;
     if(String(cl).trim().charAt(0)==='|'&&isTableAt(i))break;
     ps.push(cl); i++;
    }
    var ePara=i;
    var paraAttr=' data-md-start="'+sPara+'" data-md-end="'+ePara+'"';
    if(ps.length===1&&/^\s*!\[[^\]]*\]\([^)]+\)(\{[^{}]*\})?\s*$/.test(ps[0])){
      var im=/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(\{[^{}]*\})?/.exec(ps[0]);
      if(im)html.push(renderImg(im[1],im[2],im[3],opts,ctx,im[4]));
     else html.push('<p'+paraAttr+' data-md-line="'+sPara+'">'+inlineFmt(ps[0],opts,ctx)+'</p>');
    }else if(ps.length){
     html.push('<p'+paraAttr+'>'+ps.map(function(x){ return inlineFmt(x,opts,ctx); }).join('<br>')+'</p>');
    }
  }
  return html.join('\n');
 }
 function headingsEngine(md){
  var hs=[]; var lines=String(md||'').split('\n');
  var inCode=false;
  for(var i=0;i<lines.length;i++){
   var l=lines[i];
   if(isCommentStart(l)){ while(i<lines.length&&lines[i].indexOf('-->')<0)i++; continue; }
   if(/^```/.test(l)){ inCode=!inCode; continue; }
   if(inCode)continue;
   var m=/^(#{1,6})\s+(.*)$/.exec(String(l).trim());
   if(m){
    var t=String(m[2]).replace(/\s+#+\s*$/,'').trim();
     t=t.replace(/!\[([^\]]*)\]\([^)]+\)(\{[^{}]*\})?/g,'$1');
    t=t.replace(/(\*\*|__|\*|_|~~|`)/g,'');
    hs.push({level:m[1].length,text:t.trim(),line:i});
   }
  }
  return hs;
 }
 return {render:renderEngine,headings:headingsEngine};
})();

/* 对外渲染接口：renderMd(md) 单参向后兼容；opts={project,proto,source} 缺省读全局 */
function renderMd(md,opts){
 try{ return __DocGfm.render(md,opts); }
 catch(e){ try{ reportError('renderMd',e); }catch(e2){} return '<div class="doc-empty">文档渲染失败，请稍后重试。</div>'; }
}
/* Heading 提取接口（目录 TOC 用；既有调用方兼容，附带 line 行号） */
function extractHeadings(md){
 try{ return __DocGfm.headings(md); }
 catch(e){ return []; }
}
/* 设计规范预览复用：供设置-规范新增/编辑/预览共用渲染，不改既有 renderMd 行为 */
function renderMdPreview(text){
 try{ return renderMd(String(text==null?'':text)); }
 catch(e){ return ''; }
}
try{ window.renderMdPreview=renderMdPreview; }catch(e){}

/* ═══════ P3 双向穿梭 DocShuttle（文档→画布 route 跳转 + 画布→文档关键词定位，失败绝不抛错） ═══════ */
function docNormRoute(s){ try{ return String(s||'').trim().replace(/^#/,'').trim().replace(/\.html?$/i,'').toLowerCase(); }catch(e){ return ''; } }
function docFindSubPage(route){
 try{
  var src=null; try{ src=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ src=null; }
  if(!src) return null;
  var target=docNormRoute(route);
  if(!target) return null;
  var cands=[];
  try{
   if(src.mainHtmlFile) cands.push({file:String(src.mainHtmlFile),name:String(src.mainHtmlFile)});
   if(src.name&&/\.html?$/i.test(String(src.name))) cands.push({file:String(src.name),name:String(src.name)});
   if(src.subPages) for(var i=0;i<src.subPages.length;i++){ var sp=src.subPages[i]; if(!sp) continue; if(typeof sp==='string') cands.push({file:sp,name:sp}); else cands.push({file:String(sp.file||sp.hash||sp.route||sp.name||''),name:String(sp.name||sp.file||'')}); }
   if(src.pages) for(var j=0;j<src.pages.length;j++){ var pg=src.pages[j]; if(!pg) continue; var f=String(pg); if(!/\.html?$/i.test(f)) f=f+'.html'; cands.push({file:f,name:String(pg)}); }
   if(src.htmlFiles) for(var k=0;k<src.htmlFiles.length;k++){ var hf=src.htmlFiles[k]; if(hf) cands.push({file:String(hf),name:String(hf)}); }
  }catch(e){}
  for(var t=0;t<cands.length;t++){
   var f2=String(cands[t].file||'');
   if(!f2) continue;
   if(docNormRoute(f2)===target||docNormRoute(cands[t].name)===target) return cands[t];
   try{
    var seg=String(target).split('/').pop(), fseg=String(docNormRoute(f2)).split('/').pop();
    if(seg&&fseg&&seg===fseg) return cands[t];
   }catch(e){}
  }
  return null;
 }catch(e){ return null; }
}
window.DocShuttle={
 findSubPage:function(r){ try{ return docFindSubPage(r); }catch(e){ return null; } },
 docToCanvas:function(route){
  try{
   var r=String(route==null?'':route).trim().replace(/^#/,'').trim();
   if(!r){ try{ showToast('缺少路由参数'); }catch(e){} return false; }
   var src=null; try{ src=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
   if(!src){ try{ showToast('当前无原型，无法跳转'); }catch(e){} return false; }
   /* 优先复用 sandbox-core 只读跳转器（若存在），否则本地查找+只读调用既有loadSubPage */
   try{
    if(typeof window!=='undefined'&&typeof window.jumpToSubPageByRoute==='function'){
     var ok=false;
     try{ ok=!!window.jumpToSubPageByRoute(r); }catch(e){ ok=false; }
     if(ok){
      try{
       var pw=null; try{ pw=document.getElementById('phoneWrap'); }catch(e){}
       if(pw){ try{ microGlow(pw); }catch(e){} }
      }catch(e){}
      try{ showToast('已切换预览'); }catch(e){}
      return true;
     }
    }
   }catch(e){}
   var hit=null; try{ hit=docFindSubPage(r); }catch(e){}
   if(hit&&hit.file){
    try{
     if(typeof loadSubPage==='function'){
      loadSubPage(src,hit.file);
      try{
       var pw2=null; try{ pw2=document.getElementById('phoneWrap'); }catch(e){}
       if(pw2){ try{ microGlow(pw2); }catch(e){} }
      }catch(e){}
      try{ showToast('已切换预览：'+String(hit.name||hit.file)); }catch(e){}
      return true;
     }else{ try{ showToast('当前环境不支持子页面跳转'); }catch(e){} return false; }
    }catch(e){ try{ showToast('跳转失败'); }catch(e2){} return false; }
   }else{ try{ showToast('未找到对应子页面：'+r); }catch(e){} return false; }
  }catch(e){ try{ showToast('跳转失败'); }catch(e2){} return false; }
 },
  canvasToDoc:function(info){
   return false;
  }
};
/* Wave-B: handleDocRouteJump 已删除（全仓零业务调用，仅定义；DocShuttle.docToCanvas 保留，verify-md-p3 OR断言仍绿） */
/* 单文档：恒显示功能说明（<name>.md）；磁盘已存在的变更日志/需求规格保留不删，仅不再展示入口 */
function docTitleFor(nm){
 try{ try{ return protoTitle(); }catch(e){ return '原型'; } }catch(e){ return String(nm||'功能说明'); }
}
/* 已移除三文档Tab及关联，仅恒显示功能说明；磁盘文件保留不删，仅不再展示入口；前端不再调用 doc:list */
function removeDocTabStrip(){
 try{ var s=document.getElementById('docTabStrip'); if(s&&s.parentNode) s.parentNode.removeChild(s); }catch(e){}
}

function loadDesc(){
 try{ if(typeof reqMode!=='undefined'&&reqMode) reqMode=false; }catch(e){} /* 换源：切回功能说明视图 */
 try{ if(flushEdit()===false)return; }catch(e){} /* 脏标记守卫：用户取消则中止本次切换渲染 */
 try{
  if(docTitleEl) docTitleEl.textContent=docTitleFor('功能说明');
  if(docContentEl) docContentEl.innerHTML=renderMd(fullDocMd());
 }catch(e){
  try{ docTitleEl.textContent=protoTitle(); }catch(e2){}
  try{ docContentEl.innerHTML=renderMd(fullDocMd()); }catch(e2){}
 }
 refreshToc();
 try{ ensureTocSpy(); updateTocSpy(); }catch(e){}
 try{ removeDocTabStrip(); }catch(e){}
}
function refreshToc(){ if(docTocEl&&tocOpen()) buildToc(); }
function buildToc(){
 if(!docTocEl)return;
 var hs=extractHeadings(fullDocMd());
 var html='';
 if(hs.length===0){ html='<div class="toc-title">暂无标题</div>'; }
 else{
   html+='<div class="toc-title">文档目录</div>';
   hs.forEach(function(h,idx){
     html+='<button type="button" class="toc-item lv'+h.level+'" data-idx="'+idx+'">'+escHtml(h.text)+'</button>';
   });
 }
  docTocEl.innerHTML=html;
 try{ ensureTocSpy(); updateTocSpy(); }catch(e){}
}
/* ═══════ P2 大纲 Scrollspy：docContent 滚动容器 scroll 监听（100ms 防抖），按视口标题高亮 TOC ═══════
   高亮复用既有 .toc-title-flash 配色体系（pri-soft 纯色 .active 态）；点击 TOC 仍定位；无标题时静默。 */
var docSpyTimer=null;
function docSpyWrap(){ try{ return docWrapEl(); }catch(e){ return null; } }
function updateTocSpy(){
 try{
  if(!docTocEl||!docContentEl)return;
  var items=null;
  try{ items=docTocEl.querySelectorAll('.toc-item'); }catch(e){ return; }
  if(!items||!items.length)return;
  var hs=null;
  try{ hs=docContentEl.querySelectorAll('h1,h2,h3,h4,h5,h6'); }catch(e){ return; }
  if(!hs||!hs.length)return; /* 无标题时静默 */
  var wrap=docSpyWrap();
  var wtop=0, wcli=0;
  try{
   if(wrap&&wrap.getBoundingClientRect){ var wb=wrap.getBoundingClientRect(); wtop=wb.top; wcli=wrap.clientHeight||0; }
   else if(docContentEl.getBoundingClientRect){ wtop=docContentEl.getBoundingClientRect().top; }
  }catch(e){}
  var line=wtop+Math.max(60,Math.round((wcli||480)*0.22));
  var cur=0;
  for(var i=0;i<hs.length;i++){
   try{
    var r=hs[i].getBoundingClientRect();
    if(r&&r.top<=line+1)cur=i;
    else break;
   }catch(e){}
  }
  for(var j=0;j<items.length;j++){
   try{
    if(j===cur){ if(items[j].classList)items[j].classList.add('active'); }
    else if(items[j].classList)items[j].classList.remove('active');
   }catch(e){}
  }
  try{
   var act=docTocEl.querySelector('.toc-item.active');
   if(act&&act.scrollIntoView)act.scrollIntoView({block:'nearest'});
  }catch(e){}
 }catch(e){}
}
function scheduleTocSpy(){
 try{ if(docSpyTimer)clearTimeout(docSpyTimer); }catch(e){}
 docSpyTimer=setTimeout(function(){ docSpyTimer=null; try{ updateTocSpy(); }catch(e){} },100);
}
function ensureTocSpy(){
 try{
  var w=docSpyWrap();
  if(!w||w._tocSpyBound)return;
  w._tocSpyBound=true;
  if(w.addEventListener)w.addEventListener('scroll',scheduleTocSpy,{passive:true});
 }catch(e){}
}
/* 轻量 HTML 转义（目录与旧调用方共用） */
function escHtml(s){return String(s).replace(/\&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
/* Wave-C/F Utils 转正: 本文件重复的 window.Utils 兜底装配已删除 (单一出口收敛至 js/utils.js ESM)。
 * 本文件因 vm 门禁 (md-p1 等整文件 vm.runInContext) 暂保经典脚本形态, 未用静态 import;
 * 运行时经 window.Utils 只读复用 (utils.js 模块 deferred 后挂载), 本地 escHtml/showToast 等保留为降级实现。
 * 全量 ESM 化 (静态 import) 待 Wave-D (需先升级 vm 系测试至 ESM loader)。 */
/* ═══════ 目录浮窗：定位 + 展开/收起 + 点击外部自动收起 ═══════
  移动端：位于功能说明面板内顶部（原位置）；
  PC 端：位于功能说明弹窗左侧紧挨、高度与弹窗相同 */
var docTocEl=$('docToc'),btnTocEl=$('btnToc');
function tocOpen(){ return !!(docTocEl&&docTocEl.style.display!=='none'); }
function closeToc(){
 if(docTocEl)docTocEl.style.display='none';
 try{ if(document.body)document.body.classList.remove('toc-open'); }catch(e){}
}
/* 点击目录项定位到对应标题并闪烁两次，随后自动收起目录弹窗（须在 docTocEl 声明后绑定） */
function flashTitle(el){
 if(!el)return;
 el.classList.remove('toc-title-flash');
 void el.offsetWidth; /* 强制重排，保证连续点击也能重新播放动画 */
 el.classList.add('toc-title-flash');
 clearTimeout(el._flashTimer);
 el._flashTimer=setTimeout(function(){ if(el.classList)el.classList.remove('toc-title-flash'); },720);
}
if(docTocEl){
  docTocEl.addEventListener('click',function(e){
    var b=e.target.closest('.toc-item');
    if(!b)return;
    var idx=parseInt(b.getAttribute('data-idx'),10);
    var target=null;
    if(docContentEl){
      var hEls=docContentEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
      target=hEls[idx];
    }
    if(!target){
      var allH=document.querySelectorAll('#docContent h1,#docContent h2,#docContent h3,#docContent h4,#docContent h5,#docContent h6');
      target=allH[idx];
    }
    if(target){
      try{ if(typeof scrollDocTo==='function')scrollDocTo(target); }catch(err){}
      flashTitle(target);  /* 该行蓝色背景闪烁两次 */
      try{ /* P2 Scrollspy：点击项即高亮，保持定位反馈一致 */
       var _its=docTocEl.querySelectorAll('.toc-item');
       for(var _k=0;_k<_its.length;_k++){ try{ _its[_k].classList.remove('active'); }catch(e2){} }
       if(b&&b.classList)b.classList.add('active');
      }catch(err2){}
    }
    /* 独立窗口内常驻侧栏不收起；PC 常驻列点击定位后保持可见（目录板块常驻要求） */
    try{ if(typeof isDocWinMode==='function'&&isDocWinMode()) return; }catch(err3){}
    try{ if(typeof isTocPinMode==='function'&&isTocPinMode()) return; }catch(err5){}
    try{ closeToc(); }catch(err4){}
  });
}
function positionToc(){
 if(!docTocEl)return;
 try{
  /* PC 常驻列：清掉历史行内定位（fixed 残留会和 flex 列打架），其余交由 CSS */
  if(typeof isTocPinMode==='function'&&isTocPinMode()){
   try{ docTocEl.style.top=''; docTocEl.style.left=''; docTocEl.style.width=''; docTocEl.style.height=''; docTocEl.style.maxHeight=''; }catch(e){}
   return;
  }
 }catch(e){}
 try{ if(typeof isDocWinMode==='function'&&isDocWinMode()){ try{ docTocEl.style.top=''; docTocEl.style.left=''; docTocEl.style.width=''; docTocEl.style.height=''; docTocEl.style.maxHeight=''; }catch(e){} return; } }catch(e){}
 try{ if(typeof isAiWinMode==='function'&&isAiWinMode()) return; }catch(e){}
 var panel=document.querySelector('.docs-panel');
 if(!panel)return;
 var r=panel.getBoundingClientRect();
 if(!r||r.width<=0)return;
 var kind=(currentSource&&currentSource.kind)||'mobile';
 if(kind==='pc'){
  /* PC 端：紧贴弹窗左侧，上下同高 */
  var w=Math.min(230,Math.max(160,r.left-24));
  docTocEl.style.width=w+'px';
  docTocEl.style.height=(r.height)+'px';
  docTocEl.style.top=r.top+'px';
  docTocEl.style.left=Math.max(8,r.left-w-8)+'px';
  docTocEl.style.maxHeight='none';
 }else{
  /* 移动端：保持面板内顶部位置（头部下方） */
  docTocEl.style.left=(r.left+12)+'px';
  docTocEl.style.top=(r.top+56)+'px';
  docTocEl.style.width=Math.max(160,r.width-24)+'px';
  docTocEl.style.height='';
  docTocEl.style.maxHeight=Math.max(120,(r.height-80))+'px';
 }
}
function openToc(){
 if(!docTocEl)return;
 buildToc();
 positionToc();
 docTocEl.style.display='block';
 try{ if(document.body)document.body.classList.add('toc-open'); }catch(e){}
 try{ updateTocSpy(); }catch(e){}
}
if(btnTocEl)btnTocEl.onclick=function(){
 if(tocOpen())closeToc(); else openToc();
};
/* 点击目录外部任意位置 → 自动收起（PC 常驻模式除外；移动端保持；点击目录内部或按钮本身不触发；独立窗口内为常驻侧栏不自动收起） */
document.addEventListener('pointerdown',function(e){
 if(!tocOpen())return;
 try{ if(typeof isTocPinMode==='function'&&isTocPinMode()) return; }catch(err){}
 try{ if(typeof isDocWinMode==='function'&&isDocWinMode()) return; }catch(err){}
 if(docTocEl&&docTocEl.contains(e.target))return;
 if(btnTocEl&&btnTocEl.contains(e.target))return;
 closeToc();
},true);
/* 窗口尺寸变化时重算目录浮窗位置 */
window.addEventListener('resize',function(){ if(tocOpen())positionToc(); });

/* ═══════ 展示态交互（P1）：任务列表就地点选 + 图片缺失容错 + Lightbox（单面板 100% 宽） ═══════ */
function mdTaskToggle(idx,checked){
 try{
  var inReq=(typeof reqMode!=='undefined'&&reqMode);
  var md=inReq?String((typeof reqText!=='undefined'?reqText:'')||'') : String(fullDocMd()||'');
  var lines=md.split('\n');
  var inCode=false, n=-1, changed=false;
  for(var i=0;i<lines.length;i++){
   var l=lines[i];
   if(/^\s*<!--/.test(l)){ while(i<lines.length&&lines[i].indexOf('-->')<0)i++; continue; }
   if(/^```/.test(l)){ inCode=!inCode; continue; }
   if(inCode)continue;
   var m=/^(\s*[-*+]\s+)\[([ xX])\]([\s\S]*)$/.exec(l);
   if(!m)continue;
   n++;
   if(n===idx){
    lines[i]=m[1]+'['+(checked?'x':' ')+']'+(m[3]||'');
    changed=true; break;
   }
  }
  if(!changed)return;
  var out=lines.join('\n');
  if(inReq){
   try{ reqText=out; }catch(e){}
   try{
    if(!(window.__EXPORT_BOOT__)&&window.protoAPI&&window.protoAPI.doc&&typeof aiSbxDir==='function'){
     window.protoAPI.doc.writeLatest(aiSbxDir(),out);
    }
   }catch(e){}
   if(docContentEl)docContentEl.innerHTML=renderMd(out||'# 最新需求\n\n（暂无内容）');
  }else{
   var w=docWrapEl(); var st=w?w.scrollTop:0;
   applyEditText(out); /* 复用既有保存通道（localStorage 防抖 + 沙箱写盘），静默不打扰 */
   if(docContentEl)docContentEl.innerHTML=renderMd(out);
   try{ refreshToc(); }catch(e){}
   if(w)w.scrollTop=st;
  }
 }catch(e){ reportError('mdTaskToggle',e); }
}
if(docContentEl&&!docContentEl._docViewBound){
 docContentEl._docViewBound=true;
 /* 任务 checkbox 就地点选 */
 docContentEl.addEventListener('change',function(e){
  try{
   var t=e.target;
   if(t&&t.classList&&t.classList.contains('doc-task')){
    var idx=parseInt(t.getAttribute('data-task-idx'),10);
    if(!isNaN(idx))mdTaskToggle(idx,!!t.checked);
   }
  }catch(err){}
 });
  /* 图片点击 Lightbox（页面锚点 badge 跳转已删除，仅保留 Lightbox；DocShuttle.canvasToDoc 与 jumpToSubPageByRoute 保留不动） */
  docContentEl.addEventListener('click',function(e){
   try{
    var t=e.target;
    if(t&&t.tagName==='IMG'&&t.classList&&t.classList.contains('md-img-el')){
     openDocLightbox(t.getAttribute('src'),t.getAttribute('alt'));
    }
   }catch(err){}
  });
 /* 图片 404 容错：替换为 60px 浅灰虚线卡片，不抛错 */
 docContentEl.addEventListener('error',function(e){
  try{
   var t=e.target;
   if(t&&t.tagName==='IMG'&&t.classList&&t.classList.contains('md-img-el')){
    if(e.preventDefault)e.preventDefault();
    var s=document.createElement('span');
    s.className='md-img-missing';
    s.setAttribute('style','display:flex;align-items:center;min-height:60px;padding:8px 12px;margin:8px 0;border:1px dashed #cbd5e1;background:#f1f5f9;color:#64748b;font-size:12px;border-radius:8px;max-width:100%;box-sizing:border-box;');
    s.textContent='[!] 图片丢失: '+(t.getAttribute('data-src')||t.getAttribute('alt')||'');
    if(t.parentNode)t.parentNode.replaceChild(s,t);
   }
  }catch(err){}
 },true);
}
/* Lightbox：黑底沉浸遮罩，Esc / 点遮罩关闭 */
var docLightboxEl=null;
function openDocLightbox(src,alt){
 try{
  closeDocLightbox();
  var m=document.createElement('div');
  m.className='doc-lightbox-mask';
  m.setAttribute('style','position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(15,23,42,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;');
  var im=document.createElement('img');
  im.className='doc-lightbox-img';
  im.setAttribute('src',src||''); if(alt)im.setAttribute('alt',alt);
  im.setAttribute('style','max-width:90vw;max-height:90vh;border-radius:8px;background:#fff;cursor:default;');
  im.addEventListener('click',function(e){ e.stopPropagation(); });
  m.appendChild(im);
  m.addEventListener('click',function(){ closeDocLightbox(); });
  document.body.appendChild(m);
  docLightboxEl=m;
 }catch(e){}
}
function closeDocLightbox(){
 try{ if(docLightboxEl&&docLightboxEl.parentNode)docLightboxEl.parentNode.removeChild(docLightboxEl); }catch(e){}
 docLightboxEl=null;
}
document.addEventListener('keydown',function(e){
 try{ if(e.key==='Escape'&&docLightboxEl){ e.stopPropagation(); closeDocLightbox(); } }catch(err){}
},true);

/* ═══════ 图片资产落盘（P1）：优先走沙箱 saveAsset 通道（main/preload 由配套改动提供） ═══════ */
function assetFileName(mime,orig){
 var ext='';
 try{
  var on=String(orig||'');
  var om=/\.([a-zA-Z0-9]{2,5})$/.exec(on);
  if(om&&/^(png|jpe?g|gif|webp|bmp|svg)$/i.test(om[1]))ext=om[1].toLowerCase().replace('jpeg','jpg');
 }catch(e){}
 if(!ext){
  var m=String(mime||'').toLowerCase();
  ext=m.indexOf('jpeg')>=0||m.indexOf('jpg')>=0?'jpg':(m.indexOf('png')>=0?'png':(m.indexOf('gif')>=0?'gif':(m.indexOf('webp')>=0?'webp':(m.indexOf('bmp')>=0?'bmp':'png'))));
 }
 function p(n,l){ n=String(n); while(n.length<l)n='0'+n; return n; }
 var d=new Date();
 var base='img_'+d.getFullYear()+p(d.getMonth()+1,2)+p(d.getDate(),2)+'_'+p(d.getHours(),2)+p(d.getMinutes(),2)+p(d.getSeconds(),2);
 try{ base+='_'+Math.floor(Math.random()*1000); }catch(e){}
 return base+'.'+ext;
}
function sandboxSaveAsset(fileName,dataUrl){
 return new Promise(function(resolve){
  function done(r){ resolve(r||{ok:false}); }
  try{
   var sb=(window.protoAPI&&window.protoAPI.sandbox)||null;
   var dir=((typeof currentSource!=='undefined')&&currentSource&&currentSource.sandboxDir)||'';
   if(!sb||!dir){ done({ok:false,reason:'no-sandbox'}); return; }
   if(typeof sb.saveAsset==='function'){
    var p;
    try{ p=sb.saveAsset({dir:dir,file:'assets/'+fileName,dataUrl:dataUrl,name:fileName}); }
    catch(e){ done({ok:false,error:String((e&&e.message)||e)}); return; }
    if(p&&typeof p.then==='function')p.then(done,function(e){ done({ok:false,error:String((e&&e.message)||e)}); });
    else done(p);
    return;
   }
   done({ok:false,reason:'no-api'});
  }catch(e){ done({ok:false,error:String((e&&e.message)||e)}); }
 });
}

/* ═══════ 快捷格式工具栏动作（P1）：#docToolbar 容器由配套改动创建，此处仅暴露动作供绑定 ═══════ */
function activeEditArea(){
 try{
  var a=null; try{ a=document.activeElement; }catch(e){}
  if(a&&(a.id==='docEditArea'||a.id==='reqEditArea'))return a;
 }catch(e){}
 try{ if(editOn&&docEditArea)return docEditArea; }catch(e){}
 try{
  var editing2=false; try{ editing2=(typeof reqEditing!=='undefined'&&reqEditing); }catch(e){}
  if(editing2){ var r=null; try{ r=document.getElementById('reqEditArea'); }catch(e){} if(r)return r; }
 }catch(e){}
 return docEditArea;
}
function tbArea(){ try{ return activeEditArea(); }catch(e){ return docEditArea; } }
function tbLineOf(v,pos){
 var n=0;
 for(var i=0;i<pos&&i<v.length;i++)if(v.charAt(i)==='\n')n++;
 return n;
}
/* ═══════ 编辑框自建撤销重做（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，docEditArea 与 reqEditArea 同享） ═══════
   自建 undo 栈：input 防抖快照，上限 50，工具栏/快捷键程序化插入先压栈；preventDefault 接管，不与原生冲突 */
var DOC_UNDO_LIMIT=50;
var docUndoStacks={}, docRedoStacks={}, docUndoLast={}, docUndoTimers={};
function docUndoKey(el){ try{ if(el&&el.id)return String(el.id); }catch(e){} return '__doc__'; }
function docUndoGetStacks(el){ var k=docUndoKey(el); if(!docUndoStacks[k])docUndoStacks[k]=[]; if(!docRedoStacks[k])docRedoStacks[k]=[]; return k; }
function docUndoPush(el){
 try{
  if(!el)return;
  var k=docUndoGetStacks(el);
  var st=docUndoStacks[k];
  var curV=String(el.value==null?'':el.value);
  var curS=null,curE=null; try{ curS=el.selectionStart; curE=el.selectionEnd; }catch(e){}
  var top=st.length?st[st.length-1]:null;
  if(top&&top.v===curV){ docRedoStacks[k]=[]; return; }
  st.push({v:curV,s:curS,e:curE});
  while(st.length>DOC_UNDO_LIMIT)st.shift();
  docRedoStacks[k]=[];
  docUndoLast[k]=curV;
 }catch(e){}
}
function docUndoReset(el,initVal){
 try{
  var k=docUndoKey(el);
  var v=(initVal!=null?String(initVal):String((el&&el.value!=null?el.value:'')));
  var s=null,e=null; try{ if(el){ s=el.selectionStart; e=el.selectionEnd; } }catch(e2){}
  docUndoStacks[k]=[{v:v,s:s,e:e}];
  docRedoStacks[k]=[];
  docUndoLast[k]=v;
  try{ if(docUndoTimers[k]){ clearTimeout(docUndoTimers[k]); docUndoTimers[k]=null; } }catch(e2){}
 }catch(e){}
}
function docUndoSchedule(el){
 try{
  if(!el)return;
  var k=docUndoKey(el);
  try{ if(docUndoTimers[k])clearTimeout(docUndoTimers[k]); }catch(e){}
  docUndoTimers[k]=setTimeout(function(){
   try{
    docUndoTimers[k]=null;
    if(!el)return;
    var curV=String(el.value==null?'':el.value);
    if(curV===docUndoLast[k])return;
    var st=docUndoStacks[k]||(docUndoStacks[k]=[]);
    if(!docRedoStacks[k])docRedoStacks[k]=[];
    var top=st.length?st[st.length-1]:null;
    var cs=null,ce=null; try{ cs=el.selectionStart; ce=el.selectionEnd; }catch(e2){}
    if(!top||top.v!==curV){
     st.push({v:curV,s:cs,e:ce});
     while(st.length>DOC_UNDO_LIMIT)st.shift();
     docRedoStacks[k]=[];
    }
    docUndoLast[k]=curV;
   }catch(e2){}
  },800);
 }catch(e){}
}
function docUndoRestore(el,snap){
 try{
  if(!el||!snap)return;
  el.value=String(snap.v==null?'':snap.v);
  try{
   var len=String(el.value||'').length;
   var a=(snap.s==null?len:snap.s), b=(snap.e==null?a:snap.e);
   a=Math.max(0,Math.min(len,a)); b=Math.max(0,Math.min(len,b));
   if(el.setSelectionRange!=null)el.setSelectionRange(a,b);
  }catch(e){}
  try{ el.focus(); }catch(e){}
  try{ markDirtyInput(); }catch(e){}
 }catch(e){}
}
function docUndoDo(el){
 try{
  if(!el)return false;
  var k=docUndoGetStacks(el);
  var st=docUndoStacks[k], rd=docRedoStacks[k];
  if(!st.length)return false;
  var curV=String(el.value==null?'':el.value);
  var curS=null,curE=null; try{ curS=el.selectionStart; curE=el.selectionEnd; }catch(e){}
  var top=st[st.length-1];
  if(top.v===curV){
   if(st.length<=1)return false;
   var popped=st.pop();
   rd.push(popped);
   while(rd.length>DOC_UNDO_LIMIT)rd.shift();
   var prev=st[st.length-1];
   docUndoRestore(el,prev);
   docUndoLast[k]=prev.v;
   return true;
  }else{
   rd.push({v:curV,s:curS,e:curE});
   while(rd.length>DOC_UNDO_LIMIT)rd.shift();
   docUndoRestore(el,top);
   docUndoLast[k]=top.v;
   return true;
  }
 }catch(e){ return false; }
}
function docRedoDo(el){
 try{
  if(!el)return false;
  var k=docUndoGetStacks(el);
  var st=docUndoStacks[k], rd=docRedoStacks[k];
  if(!rd.length)return false;
  var curV=String(el.value==null?'':el.value);
  var curS=null,curE=null; try{ curS=el.selectionStart; curE=el.selectionEnd; }catch(e){}
  var nxt=rd.pop();
  var top=st.length?st[st.length-1]:null;
  if(!top||top.v!==curV){
   st.push({v:curV,s:curS,e:curE});
   while(st.length>DOC_UNDO_LIMIT)st.shift();
  }
  st.push(nxt);
  while(st.length>DOC_UNDO_LIMIT)st.shift();
  docUndoRestore(el,nxt);
  docUndoLast[k]=nxt.v;
  return true;
 }catch(e){ return false; }
}
function docUndoEnsureInit(el){
 try{
  if(!el)return;
  var k=docUndoKey(el);
  if(!docUndoStacks[k]||!docUndoStacks[k].length){
   var v=String(el.value==null?'':el.value);
   var s=null,e=null; try{ s=el.selectionStart; e=el.selectionEnd; }catch(e2){}
   docUndoStacks[k]=[{v:v,s:s,e:e}];
   if(!docRedoStacks[k])docRedoStacks[k]=[];
   docUndoLast[k]=v;
  }
 }catch(e){}
}
function tbInsert(text){
 var el=tbArea(); if(!el)return;
 try{ docUndoPush(el); }catch(e){}
 try{
  var v=el.value||'';
  var s=(el.selectionStart==null?v.length:el.selectionStart), e=(el.selectionEnd==null?s:el.selectionEnd);
  el.value=v.slice(0,s)+text+v.slice(e);
  var off=s+text.length;
  el.setSelectionRange(off,off);
  el.focus();
  try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){}
  markDirtyInput();
 }catch(err){}
}
function tbWrap(before,after,placeholder){
 var el=tbArea(); if(!el)return;
 try{ docUndoPush(el); }catch(e){}
 try{
  var v=el.value||'';
  var s=(el.selectionStart==null?0:el.selectionStart), e=(el.selectionEnd==null?s:el.selectionEnd);
  var sel=v.slice(s,e);
  if(!sel){
   var ins=before+placeholder+after;
   el.value=v.slice(0,s)+ins+v.slice(e);
   el.setSelectionRange(s+before.length,s+before.length+placeholder.length);
  }else{
   el.value=v.slice(0,s)+before+sel+after+v.slice(e);
   el.setSelectionRange(s+before.length,s+before.length+sel.length);
  }
   el.focus();
   try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){}
   markDirtyInput();
  }catch(err){}
}
function tbEachLine(fn){
 var el=tbArea(); if(!el)return;
 try{ docUndoPush(el); }catch(e){}
 try{
  var v=el.value||'';
  var s=(el.selectionStart==null?0:el.selectionStart), e=(el.selectionEnd==null?s:el.selectionEnd);
  var ls=v.split('\n');
  var si=tbLineOf(v,s), ei=tbLineOf(v,e);
  for(var i=si;i<=ei&&i<ls.length;i++)ls[i]=fn(ls[i],i-si);
  el.value=ls.join('\n');
  var off=0; for(var j=0;j<si;j++)off+=ls[j].length+1;
  el.setSelectionRange(off,off+ls.slice(si,ei+1).join('\n').length);
  el.focus();
  try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){}
  markDirtyInput();
 }catch(err){}
}
function tbHeadAct(n){
 tbEachLine(function(l){
  var t=String(l).replace(/^(#{1,6})\s+/,'');
  return n>0?(new Array(n+1).join('#')+' '+t):t;
 });
}
function tbListAct(kind){
 tbEachLine(function(l){
  var t=String(l);
  if(kind==='ul'){
   if(/^\s*[-*+]\s+(\[([ xX])\]\s+)?/.test(t))return t.replace(/^(\s*)[-*+]\s+(\[([ xX])\]\s+)?/,'$1');
   return t.replace(/^(\s*)/,'$1- ');
  }
  if(kind==='task'){
   var m=/^(\s*)([-*+]\s+)?\[([ xX])\]\s+/.exec(t);
   if(m)return t.replace(/^(\s*)([-*+]\s+)?\[([ xX])\]\s+/,'$1');
   var u=/^(\s*)[-*+]\s+/.exec(t);
   if(u)return t.replace(/^(\s*)[-*+]\s+/,'$1- [ ] ');
   return t.replace(/^(\s*)/,'$1- [ ] ');
  }
   /* ol：切换时统一从 1 起重排由调用后处理，此处先加前缀；行首 1./1) 识别，行内不误判 */
   if(/^\s*\d+[.\)]\s+/.test(t))return t.replace(/^(\s*)\d+[.\)]\s+/,'$1');
   if(/^\s*[-*+]\s+(\[([ xX])\]\s+)?/.test(t))return t.replace(/^(\s*)[-*+]\s+(\[([ xX])\]\s+)?/,'$1'+'1. ');
   return t.replace(/^(\s*)/,'$1'+'1. ');
 });
 if(kind==='ol'){
  /* 有序列表重排序号 */
  try{
   var el=tbArea(); var v=el.value||'';
   var s=el.selectionStart||0, e=el.selectionEnd||s;
   var ls=v.split('\n');
   var si=tbLineOf(v,s), ei=tbLineOf(v,e), n=1;
    for(var i=si;i<=ei&&i<ls.length;i++){
     if(/^\s*(?:\d+[.\)]\s+|[-*+]\s+)/.test(ls[i])){
      ls[i]=String(ls[i]).replace(/^(\s*)(?:\d+[.\)]|[-*+])\s+(?:\[([ xX])\]\s+)?/,'$1'+(n++)+'. ');
     }
   }
   el.value=ls.join('\n'); el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
  }catch(err){}
 }
}
function tbTableAct(){
 var t='\n| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |\n';
 tbInsert(t);
}
/* 已删除页面锚点：tbAnchorAct / currentPageAnchor 移除；标题不再渲染 badge；canvasToDoc 与 jumpToSubPageByRoute 保留不动 */
function tbImageAct(){
 try{
  var inp=document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange=function(){
   try{
    var f=inp.files&&inp.files[0];
    if(!f)return;
    var r=new FileReader();
    r.onload=function(){
     var du=String(r.result||'');
     var fn=assetFileName(f.type,f.name);
     sandboxSaveAsset(fn,du).then(function(res){
      if(res&&res.ok){
       var alt=String(f.name||'图片').replace(/\.[a-zA-Z0-9]{2,5}$/,'')||'图片';
       tbInsert('!['+alt+'](assets/'+fn+')');
       showToast('图片已保存至沙箱 assets 并插入');
      }else{
       showToast('图片保存失败：仅桌面端沙箱支持图片落盘');
      }
     });
    };
    r.onerror=function(){ showToast('图片读取失败'); };
    r.readAsDataURL(f);
   }catch(err){ reportError('tbImage',err); }
  };
  inp.click();
 }catch(e){ reportError('tbImage',e); }
}
var DocToolbarActions={
 h1:function(){ tbHeadAct(1); },
 h2:function(){ tbHeadAct(2); },
 h3:function(){ tbHeadAct(3); },
 para:function(){ tbHeadAct(0); },
 bold:function(){ tbWrap('**','**','加粗文字'); },
 italic:function(){ tbWrap('*','*','斜体文字'); },
 strike:function(){ tbWrap('~~','~~','删除线文字'); },
 ul:function(){ tbListAct('ul'); },
 ol:function(){ tbListAct('ol'); },
 task:function(){ tbListAct('task'); },
 table:function(){ tbTableAct(); },
 image:function(){ tbImageAct(); },
 /* 已删除页面锚点 anchor 动作与工具栏锚点按钮 */
 assets:function(){ try{ openDocAssetDrawer(); }catch(e){} },
 save:function(){ try{ saveEdit(); }catch(e){} },
 cancel:function(){ try{ cancelEdit(); }catch(e){} }
};
function bindDocToolbar(root){
 try{
  var bar=document.getElementById('docToolbar');
  if(!bar||bar._docBound)return !!bar;
  var btns=bar.querySelectorAll('[data-act]');
  for(var i=0;i<btns.length;i++){
   (function(b){
    var act=b.getAttribute('data-act');
    b.addEventListener('click',function(e){
     try{ if(e.preventDefault)e.preventDefault(); }catch(err){}
     try{ if(DocToolbarActions[act])DocToolbarActions[act](); }catch(err){ reportError('toolbar',err); }
    });
   })(btns[i]);
  }
  bar._docBound=true;
  return true;
 }catch(e){ return false; }
}
window.DocToolbar={actions:DocToolbarActions,bind:bindDocToolbar};
window.bindDocToolbar=bindDocToolbar;
try{ bindDocToolbar(document); }catch(e){}
try{
 if(typeof MutationObserver!=='undefined'){
  var docToolbarObs=new MutationObserver(function(){ try{ bindDocToolbar(document); }catch(e){} });
  docToolbarObs.observe(document.documentElement||document.body,{childList:true,subtree:true});
 }
}catch(e){}

/* ═══════ 编辑器键盘与剪贴板增强（P1，单面板） ═══════ */
function tbIndent(outdent){
 var el=tbArea(); if(!el)return;
 try{ docUndoPush(el); }catch(e){}
 try{
  var v=el.value||'';
  var s=(el.selectionStart==null?0:el.selectionStart), e=(el.selectionEnd==null?s:el.selectionEnd);
  if(s===e&&!outdent){
   el.value=v.slice(0,s)+'  '+v.slice(e);
   el.setSelectionRange(s+2,s+2);
  }else{
   var ls=v.split('\n');
   var si=tbLineOf(v,s), ei=tbLineOf(v,e);
   if(e>s&&v.slice(0,e).split('\n').length-1===ei&&/^\s*$/.test(ls[ei].slice(0,0)))ei=Math.max(si,ei-0);
   for(var i=si;i<=ei&&i<ls.length;i++){
    if(outdent)ls[i]=String(ls[i]).replace(/^  /,'');
    else ls[i]='  '+ls[i];
   }
   el.value=ls.join('\n');
   var off=0; for(var j=0;j<si;j++)off+=ls[j].length+1;
   el.setSelectionRange(off,off+ls.slice(si,ei+1).join('\n').length);
  }
  el.focus();
  try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){}
  markDirtyInput();
 }catch(err){}
}
function tbEnterList(){
 /* 回车收敛：仅允许五种行为——文本换行、表格内换行、换行并自动重排有序序号、换行延续列表骨架行（空项回车退出列表）、换行延续任务列表；其余场景一律普通换行 */
 var el=tbArea(); if(!el)return false;
 try{ docUndoPush(el); }catch(e){}
 try{
  var v=el.value||'';
  var s=(el.selectionStart==null?v.length:el.selectionStart), e=(el.selectionEnd==null?s:el.selectionEnd);
  /* 有选区：普通换行（替换选区为换行） */
  if(s!==e){
   var nv=v.slice(0,s)+'\n'+v.slice(e);
   el.value=nv;
   el.setSelectionRange(s+1,s+1);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  var ls=v.split('\n');
  var li=tbLineOf(v,s);
  var line=ls[li]||'';
  var off=s; for(var j=0;j<li;j++)off-=(ls[j].length+1);
  if(off<0)off=0; if(off>line.length)off=line.length;
  var after=line.slice(off);
  /* 行为2：表格内换行——当前行为表格行时一律普通换行，不延续骨架 */
  var isTableRow=function(l){ try{ return String(l||'').trim().charAt(0)==='|'; }catch(e2){ return false; } };
  if(isTableRow(line)){
   var nn='\n';
   el.value=v.slice(0,s)+nn+v.slice(e);
   el.setSelectionRange(s+1,s+1);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  var atEnd=(String(after).trim()==='');
  var mTask=/^(\s*[-*+]\s+\[(?: |x|X)\]\s+)([\s\S]*)$/.exec(line);
  var mOl=/^(\s*)(\d+)([.\)]\s+)([\s\S]*)$/.exec(line);
  var mUl=/^(\s*[-*+]\s+)([\s\S]*)$/.exec(line);
  /* 行为1：文本换行——非列表行普通换行 */
  if(!mTask&&!mOl&&!mUl){
   var nn2='\n';
   el.value=v.slice(0,s)+nn2+v.slice(e);
   el.setSelectionRange(s+1,s+1);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  /* 列表行但光标不在行尾：普通换行（拆分行），不延续 */
  if(!atEnd){
   var nn3='\n';
   el.value=v.slice(0,s)+nn3+v.slice(e);
   el.setSelectionRange(s+1,s+1);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  /* 行为5：换行延续任务列表；空项回车退出列表 */
  if(mTask){
   var indentT=/^\s*/.exec(line)[0];
   var emptyT=String(mTask[2]).trim()==='';
   if(emptyT){
    ls[li]='';
    el.value=ls.join('\n');
    var oT=0; for(var k=0;k<li;k++)oT+=ls[k].length+1;
    el.setSelectionRange(oT,oT); el.focus();
    try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
    return true;
   }
   var nextT='\n'+indentT+'- [ ] ';
   el.value=v.slice(0,s)+nextT+v.slice(e);
   el.setSelectionRange(s+nextT.length,s+nextT.length);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  /* 行为3：换行并自动重排有序序号；空项回车退出 */
  if(mOl){
   var indentO=mOl[1], numO=parseInt(mOl[2],10), delimO=(String(mOl[3]).charAt(0)===')'?')':'.'), emptyO=String(mOl[4]).trim()==='';
   if(emptyO){
    ls[li]='';
    el.value=ls.join('\n');
    var oO=0; for(var k2=0;k2<li;k2++)oO+=ls[k2].length+1;
    el.setSelectionRange(oO,oO); el.focus();
    try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
    return true;
   }
   var nextNum=numO+1;
   var nextO='\n'+indentO+nextNum+delimO+' ';
   var newV=v.slice(0,s)+nextO+v.slice(e);
   var newLs=newV.split('\n');
   var lvlO=String(indentO).replace(/\t/g,'  ').length;
   var expect=nextNum+1;
   for(var r=li+2;r<newLs.length;r++){
    var rl=newLs[r]||'';
    if(String(rl).trim()==='')break;
    var mm=/^(\s*)(\d+)([.\)]\s+)([\s\S]*)$/.exec(rl);
    if(!mm)break;
    var lvlR=String(mm[1]).replace(/\t/g,'  ').length;
    if(lvlR!==lvlO)break;
    var dR=(String(mm[3]).charAt(0)===')'?')':'.');
    newLs[r]=mm[1]+(expect++)+dR+' '+(mm[4]||'');
   }
   el.value=newLs.join('\n');
   el.setSelectionRange(s+nextO.length,s+nextO.length);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  /* 行为4：换行延续列表骨架行；空项回车退出列表 */
  if(mUl){
   var indentU=/^\s*/.exec(line)[0];
   var bU=/^\s*([-*+])\s+/.exec(line);
   var bulletU=bU?bU[1]:'-';
   var emptyU=String(mUl[2]).trim()==='';
   if(emptyU){
    ls[li]='';
    el.value=ls.join('\n');
    var oU=0; for(var k3=0;k3<li;k3++)oU+=ls[k3].length+1;
    el.setSelectionRange(oU,oU); el.focus();
    try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
    return true;
   }
   var nextU='\n'+indentU+bulletU+' ';
   el.value=v.slice(0,s)+nextU+v.slice(e);
   el.setSelectionRange(s+nextU.length,s+nextU.length);
   el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
   return true;
  }
  /* 兜底：其余场景一律普通换行 */
  var nn4='\n';
  el.value=v.slice(0,s)+nn4+v.slice(e);
  el.setSelectionRange(s+1,s+1);
  el.focus(); try{ docUndoLast[docUndoKey(el)]=String(el.value||''); }catch(e2){} markDirtyInput();
  return true;
 }catch(err){ try{ return false; }catch(e2){ return false; } }
}
function isAnyDocEditing(){
 try{ if(editOn)return true; }catch(e){}
 try{ if(typeof reqEditing!=='undefined'&&reqEditing)return true; }catch(e){}
 return false;
}
function onDocKeydown(e){
 var inAny=false;
 try{ inAny=isAnyDocEditing(); }catch(err){ inAny=false; }
 if(!inAny)return;
 try{
  var tg=null; try{ tg=e.target||null; }catch(err){}
  var tid=''; try{ tid=tg&&tg.id?String(tg.id):''; }catch(err){}
  if(tid!=='docEditArea'&&tid!=='reqEditArea')return;
 }catch(err){}
  try{
   var k=e.key;
   var mod=(e.ctrlKey||e.metaKey);
   if(mod&&!e.shiftKey&&!e.altKey&&(k==='s'||k==='S')){ e.preventDefault(); try{ saveDocInPlace(); }catch(err){} return; }
   /* 自建撤销重做：编辑框内 Ctrl+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做；preventDefault 接管，不与原生冲突；reqMode 需求框同享 */
   try{
    if(mod&&!e.altKey){
     var klz=String(k||'').toLowerCase();
     if(klz==='z'&&!e.shiftKey){ try{ e.preventDefault(); }catch(e2){} try{ if(e.stopPropagation)e.stopPropagation(); }catch(e2){} try{ docUndoDo(tbArea()); }catch(e2){} return; }
     if((klz==='z'&&e.shiftKey)||(klz==='y'&&!e.shiftKey)){ try{ e.preventDefault(); }catch(e2){} try{ if(e.stopPropagation)e.stopPropagation(); }catch(e2){} try{ docRedoDo(tbArea()); }catch(e2){} return; }
    }
   }catch(err){}
   if(k==='Escape'){
   try{
    var sc=null; try{ sc=document.getElementById('docShortcutMask'); }catch(err2){}
    if(sc&&sc.style.display!=='none')return;
    if(typeof docSearch!=='undefined'&&docSearch&&docSearch.open)return;
    if(typeof docLightboxEl!=='undefined'&&docLightboxEl)return;
   }catch(err2){}
   e.preventDefault(); try{ e.stopPropagation(); }catch(err){} try{ cancelEdit(); }catch(err2){ try{ if(typeof exitReqEdit==='function')exitReqEdit(); }catch(err3){} } return;
  }
  if(k==='Tab'){ e.preventDefault(); tbIndent(!!e.shiftKey); return; }
  if(k==='Enter'){ if(tbEnterList())e.preventDefault(); return; }
  if(mod&&!e.altKey){
   var kl=String(k||'').toLowerCase();
   if(kl==='v')return;
   if(kl==='f')return;
  }
  if(!mod||e.altKey)return;
  var key=String(k||'');
  var low=key.toLowerCase();
  var act=null;
   if(e.shiftKey){
    if(low==='s')act='strike';
    else if(low==='u')act='ul';
    else if(low==='o')act='ol';
    else if(low==='t')act='task';
    else if(low==='i')act='image';
    /* 已删除页面锚点 Ctrl+Shift+A */
    else if(low==='p')act='assets';
   else return;
  }else{
   if(low==='b')act='bold';
   else if(low==='i')act='italic';
   else if(low==='t')act='table';
   else if(key==='1')act='h1';
   else if(key==='2')act='h2';
   else if(key==='3')act='h3';
   else if(key==='0')act='para';
   else return;
  }
  try{ e.preventDefault(); }catch(err){}
  try{ if(e.stopPropagation)e.stopPropagation(); }catch(err){}
  try{ if(act&&DocToolbarActions&&DocToolbarActions[act])DocToolbarActions[act](); }catch(err){}
  return;
 }catch(err){}
}
function onDocPaste(e){
 var ae=null; try{ ae=e.target||null; }catch(err){}
 var isReqA=false; try{ isReqA=!!(ae&&ae.id==='reqEditArea'); }catch(err){}
 var isDocA=false; try{ isDocA=!!(ae&&(ae===docEditArea||ae.id==='docEditArea')); }catch(err){}
 var allow=false;
 try{
  if(isDocA&&editOn)allow=true;
  else if(isReqA){
   var re2=false; try{ re2=(typeof reqEditing!=='undefined'&&reqEditing); }catch(err){}
   if(re2)allow=true;
   else{
    try{
     var rEd2=document.getElementById('reqEdit');
     if(rEd2&&rEd2.style.display!=='none')allow=true;
    }catch(err){}
   }
  }else{
   try{ if(editOn&&docEditArea)allow=true; }catch(err){}
  }
 }catch(err){}
 if(!allow||!tbArea())return;
 try{
  var cd=e.clipboardData;
  if(!cd||!cd.items)return;
  var files=[];
  for(var i=0;i<cd.items.length;i++){
   var it=cd.items[i];
   if(it&&it.type&&it.type.indexOf('image/')===0){
    var f=null;
    try{ f=it.getAsFile(); }catch(err){}
    if(f)files.push(f);
   }
  }
  if(!files.length)return;
  e.preventDefault();
  var idx=0;
  (function next(){
   if(idx>=files.length)return;
   var f=files[idx++];
   var r=new FileReader();
   r.onload=function(){
    var du=String(r.result||'');
    var fn=assetFileName(f.type,f.name);
    sandboxSaveAsset(fn,du).then(function(res){
     if(res&&res.ok){
      tbInsert('![截图](assets/'+fn+')');
      showToast('截图已保存至沙箱 assets 并插入');
     }else{
      showToast('截图保存失败：仅桌面端沙箱支持图片落盘');
     }
     next();
    });
   };
   r.onerror=function(){ showToast('截图读取失败'); next(); };
   try{ r.readAsDataURL(f); }catch(err){ next(); }
  })();
 }catch(err){}
}
if(docEditArea&&!docEditArea._docEditBound){
 docEditArea._docEditBound=true;
 docEditArea.addEventListener('keydown',onDocKeydown);
 docEditArea.addEventListener('paste',onDocPaste);
 docEditArea.addEventListener('input',markDirtyInput);
 /* 自建撤销 input 防抖快照（上限 50），docEditArea 与 reqEditArea 同享 */
 docEditArea.addEventListener('input',function(){ try{ docUndoEnsureInit(docEditArea); }catch(e){} try{ docUndoSchedule(docEditArea); }catch(e){} });
 docEditArea.addEventListener('focus',function(){ try{ docUndoEnsureInit(docEditArea); }catch(e){} });
}
try{
 var reqEditAreaEl2=null; try{ reqEditAreaEl2=document.getElementById('reqEditArea'); }catch(e){}
 if(reqEditAreaEl2&&!reqEditAreaEl2._docEditBound){
  reqEditAreaEl2._docEditBound=true;
  reqEditAreaEl2.addEventListener('keydown',onDocKeydown);
  reqEditAreaEl2.addEventListener('paste',onDocPaste);
  reqEditAreaEl2.addEventListener('input',function(){ try{ docUndoEnsureInit(reqEditAreaEl2); }catch(e){} try{ docUndoSchedule(reqEditAreaEl2); }catch(e){} });
  reqEditAreaEl2.addEventListener('focus',function(){ try{ docUndoEnsureInit(reqEditAreaEl2); }catch(e){} });
 }
}catch(e){}
/* ═══════ 文档编辑快捷键弹窗（MaskStack 模态，Esc/点遮罩关闭） ═══════ */
var docShortcutOpened=false;
function closeDocShortcut(){
 try{ if(window.MaskStack)window.MaskStack.pop('docShortcutMask'); }catch(e){}
 try{ var m=document.getElementById('docShortcutMask'); if(m)m.style.display='none'; }catch(e){}
 docShortcutOpened=false;
}
function ensureDocShortcutDom(){
 try{
  if(document.getElementById('docShortcutMask')){
   try{ if(window.MaskStack&&window.MaskStack.register)window.MaskStack.register('docShortcutMask','docShortcutModal',closeDocShortcut); }catch(e){}
   return;
  }
  var mask=document.createElement('div');
  mask.id='docShortcutMask'; mask.className='modal-mask'; mask.style.display='none';
  var modal=document.createElement('div');
  modal.id='docShortcutModal'; modal.className='modal'; modal.setAttribute('style','width:560px;max-width:92vw;');
  modal.innerHTML='<div class="modal-head"><span>编辑快捷键</span><span class="modal-x" id="docShortcutClose" title="关闭">✕</span></div><div class="modal-body"><div class="modal-hint">编辑框内生效</div></div><div class="modal-foot"><button class="docs-btn primary" id="docShortcutOk" type="button">关闭</button></div>';
  mask.appendChild(modal);
  document.body.appendChild(mask);
  try{ if(window.MaskStack&&window.MaskStack.register)window.MaskStack.register('docShortcutMask','docShortcutModal',closeDocShortcut); }catch(e){}
 }catch(e){}
}
function openDocShortcut(){
 try{
  var m=null; try{ m=document.getElementById('docShortcutMask'); }catch(e){}
  if(!m){ try{ ensureDocShortcutDom(); m=document.getElementById('docShortcutMask'); }catch(e){} }
  if(!m)return;
  m.style.display='flex';
  docShortcutOpened=true;
  try{ if(window.MaskStack)window.MaskStack.push('docShortcutMask',closeDocShortcut); }catch(e){}
 }catch(e){}
}
function bindDocShortcut(){
 try{
  var links=null; try{ links=document.querySelectorAll('.doc-shortcut-link'); }catch(e){}
  if(links){
   for(var i=0;i<links.length;i++){
    (function(b){
     if(b._scBound)return; b._scBound=true;
     b.addEventListener('click',function(e){
      try{ if(e.preventDefault)e.preventDefault(); }catch(err){}
      try{ if(e.stopPropagation)e.stopPropagation(); }catch(err){}
      openDocShortcut();
     });
    })(links[i]);
   }
  }
  var x=null; try{ x=document.getElementById('docShortcutClose'); }catch(e){}
  if(x&&!x._scBound){ x._scBound=true; x.addEventListener('click',function(){ closeDocShortcut(); }); }
  var ok=null; try{ ok=document.getElementById('docShortcutOk'); }catch(e){}
  if(ok&&!ok._scBound){ ok._scBound=true; ok.addEventListener('click',function(){ closeDocShortcut(); }); }
  try{ if(window.MaskStack&&window.MaskStack.register)window.MaskStack.register('docShortcutMask','docShortcutModal',closeDocShortcut); }catch(e){}
 }catch(e){}
}
try{ bindDocShortcut(); }catch(e){}
try{
 if(typeof MutationObserver!=='undefined'){
  var docScObs=new MutationObserver(function(){ try{ bindDocShortcut(); }catch(e){} });
  docScObs.observe(document.documentElement||document.body,{childList:true,subtree:true});
 }
}catch(e){}
try{ window.DocShortcut={open:openDocShortcut,close:closeDocShortcut}; }catch(e){}

/* ═══════ 脏标记守卫：切原型 / 切项目 / 关面板拦截确认（捕获阶段，先于各面板自身处理器） ═══════ */
document.addEventListener('click',function(e){
 try{
  if(!isDocDirty())return;
  var t=e.target;
  if(!t||!t.closest)return;
  if(t.closest('#docToolbar')||t.closest('#docToc')||t.closest('#btnToc')
   ||t.closest('#btnSaveDoc')||t.closest('#btnCancelDoc')||t.closest('#btnEditDoc')
   ||t.closest('#btnDocAssets')||t.closest('#docAssetDrawer')||t.closest('#docAssetMask')
   ||t.closest('.doc-micro-pop'))return;
  var arrow=t.closest?t.closest('.sb-tree-arrow'):null;
  if(arrow)return; /* 树箭头仅折叠分组，不切换内容，放行 */
  var hit=(t.closest('.sb-item')||t.closest('#sbProject')||t.closest('#projOk')
   ||t.closest('#docsMask')||t.closest('#reqMask')||t.closest('#docsFab')||t.closest('#reqFab'));
  if(!hit)return;
  if(window.confirm('当前功能说明有未保存的修改，是否保存并离开？')){
   try{
    if(editOn&&!reqMode&&docEditArea)applyEditText(docEditArea.value);
    exitEdit();
   }catch(err){}
   /* 放行：让原点击继续触发切换 */
  }else{
   e.preventDefault();
   e.stopPropagation();
  }
 }catch(err){}
},true);
/* 关窗口兜底 */
window.addEventListener('beforeunload',function(e){
 try{
  if(isDocDirty()){ e.preventDefault(); e.returnValue=''; }
 }catch(err){}
});

/* ═══════════════════════════════════════════════════════════════════════════
   P2 模块：资产抽屉 + 双击段落微浮层（单面板 100% 宽，零 CDN，向后兼容）
   - 入口按钮 #btnDocAssets 由 ensureDocAssetBtn 动态注入文档面板头（不改 HTML）
   - 抽屉复用既有 .drawer-mask / .side-drawer / .sd-hd / .lm-body 样式与 MaskStack
   - 仅调用 sandbox:list-assets / sandbox:delete-asset，无后端时 toast 降级
   - 微浮层保存走 applyEditText 正常保存通道（DocGuard 脏体系兼容）
   ═══════════════════════════════════════════════════════════════════════════ */
var docAssetItems=[];
function docAssetCtx(){
 var src=null, dir='', proj='', seg='';
 try{ src=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ src=null; }
 try{ proj=(typeof currentProject!=='undefined'&&currentProject)?String(currentProject):''; }catch(e){}
 try{
  if(src){
   if(src.sandboxDir)dir=String(src.sandboxDir);
   if(dir){
    var d=String(dir).replace(/[\\/]+$/,'');
    var p=d.split(/[\\/]/);
    seg=p[p.length-1]||'';
   }
   if(!seg)seg=String(src.displayName||src.name||'');
  }
 }catch(e){}
 return {src:src,dir:dir,proj:proj,seg:String(seg||'')};
}
function fmtAssetSize(n){
 try{
  var v=Number(n);
  if(!(v>=0))return '';
  if(v<1024)return v+' B';
  if(v<1024*1024)return (Math.round(v/1024*10)/10)+' KB';
  return (Math.round(v/1024/1024*100)/100)+' MB';
 }catch(e){ return ''; }
}
/* 缩略图走 proto-asset 特权协议（与 renderMd 图片重写同口径），秒级加载 */
function docAssetThumbUrl(rel){
 try{
  var c=docAssetCtx();
  var s=String(rel==null?'':rel).replace(/\\/g,'/').trim().replace(/^\.\//,'');
  if(!s)return '';
  if(!c.proj||!c.seg)return s;
  function enc(x){ try{ return encodeURIComponent(String(x)); }catch(e){ return String(x); } }
  return 'proto-asset://local/'+enc(c.proj)+'/'+enc(c.seg)+'/'+s.split('/').map(enc).join('/');
 }catch(e){ return String(rel||''); }
}
function docAssetMdText(){
 try{
  if(typeof reqMode!=='undefined'&&reqMode){
   try{ return String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){ return ''; }
  }
 }catch(e){}
 try{ return String(fullDocMd()||''); }catch(e){ return ''; }
}
/* 未引用：md 正文无该文件名 */
function isAssetOrphan(name,md){
 try{ return String(md==null?'':md).indexOf(String(name==null?'':name))<0; }
 catch(e){ return false; }
}
function ensureDocAssetDom(){
 try{
  if(document.getElementById('docAssetDrawer')&&document.getElementById('docAssetMask')){
   try{
    if(window.MaskStack&&window.MaskStack.register)
     window.MaskStack.register('docAssetMask','docAssetDrawer',closeDocAssetDrawer);
   }catch(e){}
   return;
  }
  var mask=document.createElement('div');
  mask.id='docAssetMask'; mask.className='drawer-mask'; mask.style.display='none';
  document.body.appendChild(mask);
  var dw=document.createElement('aside');
  dw.id='docAssetDrawer'; dw.className='side-drawer'; dw.setAttribute('aria-hidden','true');
  var hd=document.createElement('header'); hd.className='sd-hd';
  var t=document.createElement('b'); t.textContent='图片';
  var x=document.createElement('span'); x.id='docAssetClose'; x.className='sd-x'; x.title='关闭'; x.textContent='✕';
  x.addEventListener('click',function(){ closeDocAssetDrawer(); });
  hd.appendChild(t); hd.appendChild(x);
  var bar=document.createElement('div'); bar.className='doc-asset-bar';
  var cnt=document.createElement('span'); cnt.id='docAssetCount'; cnt.className='doc-asset-count';
  var clean=document.createElement('button');
  clean.type='button'; clean.id='docAssetClean'; clean.className='doc-asset-btn danger';
   clean.textContent='清理未引用'; clean.title='仅删除未在正文中引用的图片（需二次确认）';
  clean.addEventListener('click',function(){ cleanDocAssetOrphans(); });
  bar.appendChild(cnt); bar.appendChild(clean);
  var list=document.createElement('div'); list.id='docAssetList'; list.className='lm-body doc-asset-list';
  dw.appendChild(hd); dw.appendChild(bar); dw.appendChild(list);
  document.body.appendChild(dw);
  if(!list._assetListBound){
   list._assetListBound=true;
   list.addEventListener('click',function(e){
    try{
     var el=e.target;
     if(!el||!el.closest)return;
     var card=el.closest('.doc-asset-card');
     if(!card||!list.contains(card))return;
     var nm=card.getAttribute('data-name')||'';
     var item=null;
     for(var i=0;i<docAssetItems.length;i++){
      if(String(docAssetItems[i].name)===String(nm)){ item=docAssetItems[i]; break; }
     }
     if(!item)return;
     var opBtn=el.closest('[data-op]');
     if(opBtn){
      var op=opBtn.getAttribute('data-op');
      if(op==='del')deleteDocAsset(item);
      else if(op==='insert')insertDocAssetAtCursor(item);
      return;
     }
     if(el.tagName==='IMG'&&el.classList&&el.classList.contains('doc-asset-thumb')){
      insertDocAssetAtCursor(item);
     }
    }catch(err){}
   });
   list.addEventListener('error',function(e){
    try{
     var im=e.target;
     if(im&&im.tagName==='IMG'&&im.classList&&im.classList.contains('doc-asset-thumb')){
      if(im.getAttribute('data-fbk'))return;
      im.setAttribute('data-fbk','1');
      im.style.objectFit='contain'; im.style.background='#F1F5F9';
      im.setAttribute('alt',(im.getAttribute('alt')||'')+'（加载失败）');
     }
    }catch(err){}
   },true);
  }
  try{
   if(window.MaskStack&&window.MaskStack.register)
    window.MaskStack.register('docAssetMask','docAssetDrawer',closeDocAssetDrawer);
  }catch(e){}
 }catch(e){ reportError('assetDom',e); }
}
/* 入口按钮：注入文档面板头操作区（阅读/编辑态均可见；不改 HTML，9 script 不动） */
function ensureDocAssetBtn(){
 try{
  if(document.getElementById('btnDocAssets')){
   try{ if(editOn){ var eb=document.getElementById('btnDocAssets'); if(eb)eb.style.display='none'; } }catch(e){}
   return;
  }
  var acts=null;
  try{
   var panels=document.querySelectorAll('.docs-panel .docs-head .docs-actions');
   if(panels&&panels.length)acts=panels[0];
  }catch(e){}
  if(!acts){
   try{ acts=document.querySelector('.docs-head .docs-actions'); }catch(e2){}
  }
  if(!acts)return;
  var b=document.createElement('button');
  b.type='button'; b.id='btnDocAssets'; b.className='docs-btn';
   b.title='图片抽屉（查看 / 插入 / 清理未引用）';
   b.textContent='图片';
  b.addEventListener('click',function(e){
   try{ if(e.preventDefault)e.preventDefault(); }catch(err){}
   openDocAssetDrawer();
  });
  var ref=null;
  try{ ref=document.getElementById('btnEditDoc'); }catch(e){}
  if(ref&&ref.parentNode===acts)acts.insertBefore(b,ref);
  else acts.appendChild(b);
  try{ if(editOn)b.style.display='none'; }catch(e){}
 }catch(e){}
}
function openDocAssetDrawer(){
 try{
  ensureDocAssetDom();
  var mask=null, dw=null;
  try{ mask=document.getElementById('docAssetMask'); }catch(e){}
  try{ dw=document.getElementById('docAssetDrawer'); }catch(e){}
  if(mask)mask.style.display='';
  if(dw){ if(dw.classList)dw.classList.add('open'); dw.setAttribute('aria-hidden','false'); }
  if(window.MaskStack){
   try{ window.MaskStack.push('docAssetMask',closeDocAssetDrawer); }catch(e){}
  }
  refreshDocAssetList();
 }catch(e){ reportError('assetOpen',e); }
}
function closeDocAssetDrawer(){
 try{ if(window.MaskStack)window.MaskStack.pop('docAssetMask'); }catch(e){}
 try{ var mask=document.getElementById('docAssetMask'); if(mask)mask.style.display='none'; }catch(e){}
 try{
  var dw=document.getElementById('docAssetDrawer');
  if(dw){ if(dw.classList)dw.classList.remove('open'); dw.setAttribute('aria-hidden','true'); }
 }catch(e){}
 /* 关闭不丢编辑态：不触碰 editOn / docEditArea / 草稿与脏标记 */
}
function refreshDocAssetList(){
 var listEl=null, cntEl=null;
 try{ listEl=document.getElementById('docAssetList'); }catch(e){}
 try{ cntEl=document.getElementById('docAssetCount'); }catch(e){}
 try{
  var sb=null;
  try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
  var c=docAssetCtx();
  if(listEl)listEl.innerHTML='<div class="doc-asset-empty">正在读取 assets/ …</div>';
  if(cntEl)cntEl.textContent='';
  if(!sb||typeof sb.listAssets!=='function'||!c.dir){
    if(listEl)listEl.innerHTML='<div class="doc-asset-empty">当前环境不支持图片列表（仅桌面端沙箱可用）</div>';
   docAssetItems=[];
   return;
  }
  var p=null;
  try{ p=sb.listAssets({dir:c.dir}); }catch(e){ p=null; }
  Promise.resolve(p).then(function(r){
   if(r&&r.ok&&Object.prototype.toString.call(r.items)==='[object Array]'){
    docAssetItems=r.items.slice();
    renderDocAssetCards();
   }else{
    var msg=(r&&r.error)||'读取失败';
    docAssetItems=[];
     if(listEl)listEl.innerHTML='<div class="doc-asset-empty">'+escHtml('图片读取失败：'+msg)+'</div>';
    if(cntEl)cntEl.textContent='';
   }
  }).catch(function(){
   docAssetItems=[];
    if(listEl)listEl.innerHTML='<div class="doc-asset-empty">图片读取失败</div>';
  });
 }catch(e){ reportError('assetList',e); }
}
function renderDocAssetCards(){
 var listEl=null, cntEl=null;
 try{ listEl=document.getElementById('docAssetList'); }catch(e){}
 try{ cntEl=document.getElementById('docAssetCount'); }catch(e){}
 if(!listEl)return;
 try{
  var md=docAssetMdText();
  var items=docAssetItems||[];
  if(cntEl){
   var orphans=0;
   for(var k=0;k<items.length;k++){ if(isAssetOrphan(items[k].name,md))orphans++; }
   cntEl.textContent=items.length?('共 '+items.length+' 个，未引用 '+orphans+' 个'):'';
  }
  if(!items.length){
   listEl.innerHTML='<div class="doc-asset-empty">assets/ 暂无图片，可截图粘贴或用工具栏图片按钮添加</div>';
   return;
  }
  var html='';
  for(var i=0;i<items.length;i++){
   (function(it){
    var nm=String(it.name||'');
    var rel=String(it.relPath||('assets/'+nm));
    var orphan=isAssetOrphan(nm,md);
    html+='<div class="doc-asset-card" data-name="'+escHtml(nm)+'">'
     +'<img class="doc-asset-thumb" src="'+escHtml(docAssetThumbUrl(rel))+'" alt="'+escHtml(nm)+'" loading="lazy" title="点击插入到光标处" />'
     +'<div class="doc-asset-meta"><div class="doc-asset-name" title="'+escHtml(nm)+'">'+escHtml(nm)+'</div>'
     +'<div class="doc-asset-size">'+escHtml(fmtAssetSize(it.size))+'</div></div>'
     +(orphan?'<span class="doc-asset-badge">未引用</span>':'')
     +'<div class="doc-asset-ops"><button type="button" class="doc-asset-btn" data-op="insert">插入</button>'
     +'<button type="button" class="doc-asset-btn danger" data-op="del">删除</button></div>'
     +'</div>';
   })(items[i]);
  }
  listEl.innerHTML=html;
 }catch(e){ reportError('assetRender',e); }
}
/* 点击图片 / 插入按钮：在编辑器当前光标处插入引用语法（复用 tbInsert） */
function insertDocAssetAtCursor(item){
 try{
  if(!item)return;
  var nm=String(item.name||'');
  if(!nm)return;
  var rel=String(item.relPath||('assets/'+nm));
  var alt=nm.replace(/\.[a-zA-Z0-9]{2,5}$/,'')||'图片';
  var sn='!['+alt+']('+rel+')';
  var editing=false;
  try{ editing=!!(editOn&&docEditArea&&docEditEl&&docEditEl.style.display!=='none'); }catch(e){}
  if(editing){
   tbInsert(sn);
   showToast('已插入图片引用');
  }else{
   showToast('请先进入编辑模式再插入图片');
  }
 }catch(e){ reportError('assetInsert',e); }
}
/* 单图删除：需二次确认；仅调 sandbox:delete-asset；无后端则 toast 降级 */
function deleteDocAsset(item){
 try{
  if(!item)return;
  var nm=String(item.name||'');
  if(!nm)return;
   if(!window.confirm('确定删除图片「'+nm+'」吗？磁盘文件将被彻底移除，不可恢复。'))return;
  var sb=null;
  try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
  var c=docAssetCtx();
  if(!sb||typeof sb.deleteAsset!=='function'||!c.dir){ showToast('当前环境不支持删除图片'); return; }
  Promise.resolve(sb.deleteAsset({dir:c.dir,name:nm})).then(function(r){
   if(r&&r.ok){ showToast('已删除：'+nm); refreshDocAssetList(); }
   else showToast('删除失败：'+((r&&r.error)||'未知错误'));
  }).catch(function(){ showToast('删除失败'); });
 }catch(e){ reportError('assetDel',e); }
}
/* 一键清理：仅删除未引用图片，需二次确认 */
function cleanDocAssetOrphans(){
 try{
  var md=docAssetMdText();
  var orphans=[];
  for(var i=0;i<(docAssetItems||[]).length;i++){
   if(isAssetOrphan(docAssetItems[i].name,md))orphans.push(docAssetItems[i]);
  }
   if(!orphans.length){ showToast('无未引用图片'); return; }
   if(!window.confirm('将删除 '+orphans.length+' 个未引用图片（磁盘文件彻底移除），确定继续？'))return;
  var sb=null;
  try{ sb=(window.protoAPI&&window.protoAPI.sandbox)||null; }catch(e){}
  var c=docAssetCtx();
  if(!sb||typeof sb.deleteAsset!=='function'||!c.dir){ showToast('当前环境不支持删除图片'); return; }
  var jobs=orphans.map(function(it){
   try{ return Promise.resolve(sb.deleteAsset({dir:c.dir,name:String(it.name)})); }
   catch(e){ return Promise.resolve({ok:false}); }
  });
  Promise.all(jobs).then(function(rs){
   var okN=0;
   for(var i=0;i<(rs||[]).length;i++){ if(rs[i]&&rs[i].ok)okN++; }
    showToast('已清理 '+okN+' / '+orphans.length+' 个未引用图片');
   refreshDocAssetList();
  }).catch(function(){ showToast('清理失败'); refreshDocAssetList(); });
 }catch(e){ reportError('assetClean',e); }
}

/* ═══════ P2 双击段落微浮层：阅读态双击 p/h/li 就近浮层 textarea，保存只替换该块 ═══════
   块索引映射回 md（与渲染引擎同序切块）；code 块内双击不触发；Esc / 点外放弃。 */
/* 与渲染引擎同序的 md 切块（注释与空行不占块，每 push 一次对应一块，顺序一致） */
function mdBlocksOf(md){
 var out=[];
 try{
  var lines=String(md==null?'':md).split('\n');
  function isCmt(l){ return /^\s*<!--/.test(l); }
  function sRow(l){
   var s=String(l).trim();
   if(s.charAt(0)==='|')s=s.slice(1);
   if(s.charAt(s.length-1)==='|')s=s.slice(0,-1);
   return s.split('|').map(function(x){ return x.trim(); });
  }
  function isSep(cells){ return cells.length>0&&cells.every(function(x){ return /^:?-{1,}:?$/.test(x); }); }
  function isTabAt(j){
   if(j+1>=lines.length)return false;
   var a=String(lines[j]).trim(), b=String(lines[j+1]).trim();
   if(a.charAt(0)!=='|'||b.charAt(0)!=='|')return false;
   return isSep(sRow(b));
  }
  var i=0;
  while(i<lines.length){
   var l=lines[i];
   if(isCmt(l)){ while(i<lines.length&&lines[i].indexOf('-->')<0)i++; i++; continue; }
   if(/^```/.test(l)){
    var s0=i; i++;
    while(i<lines.length&&!/^```/.test(lines[i]))i++;
    i++;
    var e0=Math.min(i,lines.length);
    out.push({start:s0,end:e0,text:lines.slice(s0,e0).join('\n'),isCode:true,kind:'code'});
    continue;
   }
   if(/^(#{1,6})\s+(.*)$/.test(String(l).trim())){ out.push({start:i,end:i+1,text:l,isCode:false,kind:'head'}); i++; continue; }
   if(/^\s*(---|\*\*\*|___)\s*$/.test(l)){ out.push({start:i,end:i+1,text:l,isCode:false,kind:'hr'}); i++; continue; }
   if(String(l).trim().charAt(0)==='|'&&isTabAt(i)){
    var s1=i;
    while(i<lines.length&&String(lines[i]).trim().charAt(0)==='|')i++;
    out.push({start:s1,end:i,text:lines.slice(s1,i).join('\n'),isCode:false,kind:'table'});
    continue;
   }
   if(/^\s*>/.test(l)){
    var s2=i;
    while(i<lines.length&&/^\s*>/.test(lines[i]))i++;
    out.push({start:s2,end:i,text:lines.slice(s2,i).join('\n'),isCode:false,kind:'quote'});
    continue;
   }
   if(/^(\s*)(?:\d+[.\)]\s+|[-*+]\s+)/.test(l)){
    var s3=i;
    while(i<lines.length){
     var ll=lines[i];
     if(String(ll).trim()==='')break;
     if(!/^(\s*)(?:\d+[.\)]\s+|[-*+]\s+)/.test(ll))break;
     i++;
    }
    out.push({start:s3,end:i,text:lines.slice(s3,i).join('\n'),isCode:false,kind:'list'});
    continue;
   }
   if(String(l).trim()===''){ i++; continue; }
   var s4=i;
   while(i<lines.length){
    var cl=lines[i];
    if(String(cl).trim()==='')break;
    if(isCmt(cl)||/^```/.test(cl)||/^(#{1,6})\s+/.test(String(cl).trim())
     ||/^\s*(---|\*\*\*|___)\s*$/.test(cl)||/^\s*>/.test(cl)
     ||/^(\s*)(?:\d+[.\)]\s+|[-*+]\s+)/.test(cl))break;
    if(String(cl).trim().charAt(0)==='|'&&isTabAt(i))break;
    i++;
   }
   if(i>s4)out.push({start:s4,end:i,text:lines.slice(s4,i).join('\n'),isCode:false,kind:'para'});
   else i++;
  }
 }catch(e){}
 return out;
}
 /* 行号细粒度微改：自然段落/单行/单格判定（仅读行号属性，不进md源） */
 function mdIsMicroTextLine(l){
  try{
   var s=String(l==null?'':l);
   if(String(s).trim()==='')return false;
   if(/^\s*<!--/.test(s))return false;
   if(/^```/.test(s))return false;
   if(/^(#{1,6})\s+/.test(String(s).trim()))return false;
   if(/^\s*(---|\*\*\*|___)\s*$/.test(s))return false;
   if(/^\s*>/.test(s))return false;
   if(/^(\s*)(?:\d+[.\)]\s+|[-*+]\s+)/.test(s))return false;
   var t=String(s).trim();
   if(t.charAt(0)==='|')return false;
   return true;
  }catch(e){ return false; }
 }
 function mdParaRangeOf(lines,line){
  try{
   var ls=lines||[];
   var n=ls.length;
   var cur=Math.max(0,Math.min(n-1,line|0));
   if(!mdIsMicroTextLine(ls[cur]))return {start:cur,end:cur+1};
   var s=cur,e=cur+1;
   while(s-1>=0&&mdIsMicroTextLine(ls[s-1]))s--;
   while(e<n&&mdIsMicroTextLine(ls[e]))e++;
   return {start:s,end:e};
  }catch(e){ try{ return {start:line,end:line+1}; }catch(e2){ return {start:0,end:1}; } }
 }
 function mdSplitTableRowForMicro(l){
  try{
   var s=String(l==null?'':l);
   var t=s.trim();
   if(t.charAt(0)==='|')t=t.slice(1);
   if(t.charAt(t.length-1)==='|')t=t.slice(0,-1);
   return t.split('|').map(function(c){ return String(c==null?'':c).trim(); });
  }catch(e){ return []; }
 }
 function mdReplaceTableCellForMicro(lineText,col,newCell){
  try{
   var s=String(lineText==null?'':lineText);
   var hasLead=/^\s*\|/.test(s);
   var hasTrail=/\|\s*$/.test(s);
   var cells=mdSplitTableRowForMicro(s);
   while(cells.length<=col)cells.push('');
   cells[col]=String(newCell==null?'':newCell);
   var body=cells.map(function(c){ return ' '+String(c==null?'':c).trim()+' '; }).join('|');
   if(!hasLead&&!hasTrail)return cells.join(' | ');
   return (hasLead?'|':'')+body+(hasTrail?'|':'');
  }catch(e){ return String(lineText||''); }
 }
 function docMicroBase(){
  var inReq=false;
  try{ inReq=(typeof reqMode!=='undefined'&&reqMode); }catch(e){ inReq=false; }
  if(inReq){
   try{ return {text:String((typeof reqText!=='undefined'?reqText:'')||''),kind:'req'}; }
   catch(e){ return {text:'',kind:'req'}; }
  }
  try{ return {text:String(fullDocMd()||''),kind:'doc'}; }
  catch(e){ return {text:'',kind:'doc'}; }
 }
var docMicroEl=null, docMicroCtx=null;
function closeDocMicroPop(){
 try{
  if(docMicroEl&&docMicroEl.parentNode)docMicroEl.parentNode.removeChild(docMicroEl);
 }catch(e){}
 docMicroEl=null; docMicroCtx=null;
 try{ document.removeEventListener('pointerdown',docMicroOutside,true); }catch(e){}
 try{ document.removeEventListener('keydown',docMicroEsc,true); }catch(e){}
}
function docMicroOutside(e){
 try{
  if(!docMicroEl)return;
  if(docMicroEl===e.target||docMicroEl.contains(e.target))return;
  closeDocMicroPop();
 }catch(err){}
}
function docMicroEsc(e){
 try{
  if(!docMicroEl)return;
  var k=e.key||'';
  if(k==='Escape'||k==='Esc'||e.keyCode===27){
   try{ e.preventDefault(); e.stopPropagation(); }catch(err2){}
   closeDocMicroPop();
  }
 }catch(err){}
}
function openDocMicroPop(x,y,blk,baseKind){
 try{
  closeDocMicroPop();
  var wrap=document.createElement('div');
  wrap.className='doc-micro-pop';
  var ta=document.createElement('textarea');
  ta.className='doc-micro-ta';
  ta.spellcheck=false;
  ta.value=String(blk.text==null?'':blk.text);
  var bar=document.createElement('div');
  bar.className='doc-micro-bar';
  var ok=document.createElement('button');
  ok.type='button'; ok.className='doc-micro-btn primary'; ok.textContent='保存';
  var no=document.createElement('button');
  no.type='button'; no.className='doc-micro-btn'; no.textContent='取消';
  bar.appendChild(ok); bar.appendChild(no);
  var hint=document.createElement('div');
  hint.className='doc-micro-hint'; hint.textContent='仅替换该段落块，Esc / 点外放弃';
  wrap.appendChild(ta); wrap.appendChild(bar); wrap.appendChild(hint);
  document.body.appendChild(wrap);
  try{
   var W=wrap.offsetWidth||280, H=wrap.offsetHeight||170;
   var vw=window.innerWidth||800, vh=window.innerHeight||600;
   var L=Math.min(Math.max(8,(x||80)+12),Math.max(8,vw-W-8));
   var T=Math.min(Math.max(8,(y||80)+12),Math.max(8,vh-H-8));
   wrap.style.left=L+'px'; wrap.style.top=T+'px';
  }catch(e){}
  docMicroEl=wrap; docMicroCtx={blk:blk,kind:baseKind};
  ok.addEventListener('click',function(){ saveDocMicroPop(); });
  no.addEventListener('click',function(){ closeDocMicroPop(); });
  ta.addEventListener('keydown',function(ev){
   try{
    var k=ev.key||'';
    if((ev.ctrlKey||ev.metaKey)&&(k==='s'||k==='S')){
     try{ ev.preventDefault(); ev.stopPropagation(); }catch(e2){}
     saveDocMicroPop(); return;
    }
    if(k==='Escape'||k==='Esc'||ev.keyCode===27){
     try{ ev.preventDefault(); ev.stopPropagation(); }catch(e2){}
     closeDocMicroPop();
    }
   }catch(err){}
  });
  setTimeout(function(){
   try{ document.addEventListener('pointerdown',docMicroOutside,true); }catch(e){}
   try{ document.addEventListener('keydown',docMicroEsc,true); }catch(e){}
  },0);
  try{
   ta.focus();
   var end=String(ta.value||'').length;
   if(ta.setSelectionRange)ta.setSelectionRange(end,end);
  }catch(e){}
 }catch(e){ reportError('microOpen',e); }
}
/* 微存：行号细粒度（段落区间/单行/单格只换格内容竖线不动），走正常保存通道 */
function saveDocMicroPop(){
 try{
  if(!docMicroEl||!docMicroCtx)return;
  var ta=null;
  try{ ta=docMicroEl.querySelector('textarea'); }catch(e){}
  var nv=ta?String(ta.value==null?'':ta.value):'';
  var blk=docMicroCtx.blk, kind=docMicroCtx.kind;
  if(blk&&blk.isCell){
   var newCell=String(nv||'').replace(/\r?\n/g,' ').trim();
   if(kind==='req'){
    var cur0='';
    try{ cur0=String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){}
    var ls0=cur0.split('\n');
    if(blk.line>=0&&blk.line<ls0.length){
     try{ ls0[blk.line]=mdReplaceTableCellForMicro(ls0[blk.line],blk.col,newCell); }catch(e){}
    }
    var out0=ls0.join('\n');
    try{ reqText=out0; }catch(e){}
    try{
     if(!(window.__EXPORT_BOOT__)&&window.protoAPI&&window.protoAPI.doc&&typeof aiSbxDir==='function'){
      window.protoAPI.doc.writeLatest(aiSbxDir(),out0);
     }
    }catch(e){}
    var w00=docWrapEl(); var st00=w00?w00.scrollTop:0;
    if(docContentEl)docContentEl.innerHTML=renderMd(out0||'# 最新需求\n\n（暂无内容）');
    if(w00)w00.scrollTop=st00;
    closeDocMicroPop();
    showToast('已保存该单元格');
    return;
   }
   var md0='';
   try{ md0=String(fullDocMd()||''); }catch(e){}
   var lines0=md0.split('\n');
   if(blk.line>=0&&blk.line<lines0.length){
    try{ lines0[blk.line]=mdReplaceTableCellForMicro(lines0[blk.line],blk.col,newCell); }catch(e){}
   }
   var out02=lines0.join('\n');
   var w02=docWrapEl(); var st02=w02?w02.scrollTop:0;
   applyEditText(out02);
   if(docContentEl)docContentEl.innerHTML=renderMd(out02);
   try{ refreshToc(); }catch(e){}
   try{ updateTocSpy(); }catch(e){}
   if(w02)w02.scrollTop=st02;
   closeDocMicroPop();
   showToast('已保存该单元格');
   return;
  }
  var rep=String(nv).split('\n');
  if(kind==='req'){
   var cur='';
   try{ cur=String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){}
   var ls=cur.split('\n');
   var out=ls.slice(0,Math.max(0,blk.start)).concat(rep).concat(ls.slice(Math.min(ls.length,blk.end))).join('\n');
   try{ reqText=out; }catch(e){}
   try{
    if(!(window.__EXPORT_BOOT__)&&window.protoAPI&&window.protoAPI.doc&&typeof aiSbxDir==='function'){
     window.protoAPI.doc.writeLatest(aiSbxDir(),out);
    }
   }catch(e){}
   var w0=docWrapEl(); var st0=w0?w0.scrollTop:0;
   if(docContentEl)docContentEl.innerHTML=renderMd(out||'# 最新需求\n\n（暂无内容）');
   if(w0)w0.scrollTop=st0;
   closeDocMicroPop();
   showToast('已保存该段落');
   return;
  }
  var md='';
  try{ md=String(fullDocMd()||''); }catch(e){}
  var lines=md.split('\n');
  var out2=lines.slice(0,Math.max(0,blk.start)).concat(rep).concat(lines.slice(Math.min(lines.length,blk.end))).join('\n');
  var w=docWrapEl(); var st=w?w.scrollTop:0;
  applyEditText(out2); /* 正常保存通道（localStorage 防抖 + 沙箱写盘），与 DocGuard 脏体系兼容 */
  if(docContentEl)docContentEl.innerHTML=renderMd(out2);
  try{ refreshToc(); }catch(e){}
  try{ updateTocSpy(); }catch(e){}
  if(w)w.scrollTop=st;
  closeDocMicroPop();
  showToast('已保存该段落');
 }catch(e){ reportError('microSave',e,'保存失败'); }
}
function bindDocMicro(){
 try{
  if(!docContentEl||docContentEl._docMicroBound)return;
  docContentEl._docMicroBound=true;
  docContentEl.addEventListener('dblclick',function(e){
   try{
    var on=false;
    try{ on=!!editOn; }catch(err){ on=false; }
    if(on)return; /* 仅阅读态触发 */
    var t=e.target;
    if(!t||!t.closest)return;
    if(t.tagName==='IMG')return; /* 图片走 Lightbox，不抢双击 */
    var base=docMicroBase();
    var lines=String(base.text||'').split('\n');
    var cx=80, cy=80;
    try{ if(e.clientX!=null)cx=e.clientX; if(e.clientY!=null)cy=e.clientY; }catch(err){}
    /* 代码块仍整块 */
    var codeWrap=null;
    try{ codeWrap=t.closest('.md-code-wrap')||t.closest('pre'); }catch(err){ codeWrap=null; }
    if(codeWrap&&docContentEl.contains(codeWrap)){
     var cs=-1,ce=-1;
     try{
      var ca=codeWrap.getAttribute('data-md-start'), cb=codeWrap.getAttribute('data-md-end');
      if(ca!=null)cs=parseInt(ca,10);
      if(cb!=null)ce=parseInt(cb,10);
     }catch(err){}
     if(cs>=0&&ce>cs){
      ce=Math.min(ce,lines.length);
      openDocMicroPop(cx,cy,{start:cs,end:ce,text:lines.slice(cs,ce).join('\n'),isCode:true,kind:'code'},base.kind);
     }
     return;
    }
    if(t.closest('code'))return;
    /* 表格点哪格改哪格（只换格内容，竖线不动；行号经tr承载，列经序号推导，内层th/td保持 exact） */
    var cell=null;
    try{ cell=t.closest('td,th'); }catch(err){ cell=null; }
    if(cell&&docContentEl.contains(cell)){
     var rLine=-1,cCol=-1;
     try{
      var rl=cell.getAttribute('data-md-line'), cc=cell.getAttribute('data-md-col');
      if(rl!=null&&cc!=null){ rLine=parseInt(rl,10); cCol=parseInt(cc,10); }
      else{
       var tr=null;
       try{ tr=cell.parentNode; if(tr&&!/^TR$/i.test(tr.tagName||''))tr=cell.closest?cell.closest('tr'):null; }catch(e2){ tr=null; }
       if(tr){
        try{ var trL=tr.getAttribute('data-md-line'); if(trL!=null)rLine=parseInt(trL,10); }catch(e2){}
        try{
         var cells0=tr.querySelectorAll?tr.querySelectorAll('td,th'):tr.children;
         for(var ci0=0;ci0<cells0.length;ci0++){ if(cells0[ci0]===cell){ cCol=ci0; break; } }
        }catch(e2){}
       }
      }
     }catch(err){}
     if(rLine>=0&&rLine<lines.length&&cCol>=0){
      var cells=null;
      try{ cells=mdSplitTableRowForMicro(lines[rLine]); }catch(err){ cells=null; }
      var curCell=(cells&&cCol<cells.length)?cells[cCol]:'';
      openDocMicroPop(cx,cy,{start:rLine,end:rLine+1,text:String(curCell==null?'':curCell),isCell:true,line:rLine,col:cCol,kind:'table-cell'},base.kind);
      return;
     }
     if(rLine>=0&&rLine<lines.length){
      openDocMicroPop(cx,cy,{start:rLine,end:rLine+1,text:lines[rLine],isCode:false,kind:'table-row'},base.kind);
      return;
     }
    }
    /* 列表点哪行改哪行（行号经外层包裹data-md-lines承载，内层li保持 exact，经序号推导） */
    var liEl=null;
    try{ liEl=t.closest('li'); }catch(err){ liEl=null; }
    if(liEl&&docContentEl.contains(liEl)){
     var lLine=-1;
     try{ var la=liEl.getAttribute('data-md-line'); if(la!=null)lLine=parseInt(la,10); }catch(err){}
     if(!(lLine>=0)){
      try{
       var listEl=liEl.parentNode;
       var wrapDiv=null;
       if(listEl&&listEl.parentNode&&listEl.parentNode.getAttribute){
        var _v=listEl.parentNode.getAttribute('data-md-lines');
        if(_v!=null)wrapDiv=listEl.parentNode;
       }
       if(!wrapDiv&&liEl.closest)wrapDiv=liEl.closest('div[data-md-lines]');
       if(wrapDiv){
        var _s=wrapDiv.getAttribute('data-md-lines')||'';
        var _arr=_s.split(',').map(function(x){ return parseInt(x,10); }).filter(function(x){ return x>=0; });
        var _idx=-1;
        try{
         var _kids=listEl?listEl.children:[];
         for(var _k=0;_k<_kids.length;_k++){ if(_kids[_k]===liEl){ _idx=_k; break; } }
        }catch(e2){}
        if(_idx>=0&&_idx<_arr.length)lLine=_arr[_idx];
       }
      }catch(err){}
     }
     if(lLine>=0&&lLine<lines.length){
      openDocMicroPop(cx,cy,{start:lLine,end:lLine+1,text:lines[lLine],isCode:false,kind:'list'},base.kind);
      return;
     }
    }
    /* 标题双击只改标题行（行号经外层包裹承载，内层h保持 exact） */
    var hEl=null;
    try{ hEl=t.closest('h1,h2,h3,h4,h5,h6'); }catch(err){ hEl=null; }
    if(hEl&&docContentEl.contains(hEl)){
     var hLine=-1;
     try{
      var ha=hEl.getAttribute('data-md-line');
      if(ha==null)ha=hEl.getAttribute('data-md-start');
      if(ha!=null)hLine=parseInt(ha,10);
     }catch(err){}
     if(!(hLine>=0)){
      try{
       var wp=hEl.parentNode;
       if(wp&&wp.getAttribute){
        var _hv=wp.getAttribute('data-md-line');
        if(_hv==null)_hv=wp.getAttribute('data-md-start');
        if(_hv!=null)hLine=parseInt(_hv,10);
       }
      }catch(err){}
     }
     if(hLine>=0&&hLine<lines.length){
      openDocMicroPop(cx,cy,{start:hLine,end:hLine+1,text:lines[hLine],isCode:false,kind:'head'},base.kind);
      return;
     }
    }
    /* 自然段落（当前行+上下连续文本行）而非整节 */
    var pLine=-1;
    try{
     var pEl=t.closest('p');
     if(pEl&&docContentEl.contains(pEl)){
      var sa=pEl.getAttribute('data-md-start'), sb=pEl.getAttribute('data-md-end');
      if(sa!=null&&sb!=null){
       var pStart=parseInt(sa,10), pEnd=parseInt(sb,10);
       var brIdx=0;
       try{
        var childs=pEl.childNodes||[];
        var cur=t;
        while(cur&&cur.parentNode!==pEl)cur=cur.parentNode;
        if(cur){
         for(var ci=0;ci<childs.length;ci++){
          if(childs[ci]===cur)break;
          try{ if(childs[ci]&&childs[ci].tagName==='BR')brIdx++; }catch(e2){}
         }
        }
       }catch(e2){}
       if(!(pStart>=0))pStart=0;
       if(!(pEnd>pStart))pEnd=pStart+1;
       var curLine=pStart+brIdx;
       if(curLine< pStart)curLine=pStart;
       if(curLine>=pEnd)curLine=pEnd-1;
       pLine=curLine;
      }
     }
    }catch(err){}
    if(pLine>=0&&pLine<lines.length){
     var rng=null;
     try{ rng=mdParaRangeOf(lines,pLine); }catch(err){ rng=null; }
     if(!rng)rng={start:pLine,end:pLine+1};
     openDocMicroPop(cx,cy,{start:rng.start,end:rng.end,text:lines.slice(rng.start,rng.end).join('\n'),isCode:false,kind:'para'},base.kind);
     return;
    }
    /* 通用行号兜底：跨行合并等畸形按整行 */
    var lined=null;
    try{ lined=t.closest('[data-md-line],[data-md-start]'); }catch(err){ lined=null; }
    if(lined&&docContentEl.contains(lined)){
     var ln=-1;
     try{ var lv=lined.getAttribute('data-md-line'); if(lv!=null)ln=parseInt(lv,10); }catch(err){}
     if(ln>=0&&ln<lines.length){
      openDocMicroPop(cx,cy,{start:ln,end:ln+1,text:lines[ln],isCode:false,kind:'line'},base.kind);
      return;
     }
     var s0=-1;
     try{ var sv=lined.getAttribute('data-md-start'); if(sv!=null)s0=parseInt(sv,10); }catch(err){}
     if(s0>=0&&s0<lines.length){
      openDocMicroPop(cx,cy,{start:s0,end:s0+1,text:lines[s0],isCode:false,kind:'line'},base.kind);
      return;
     }
    }
    /* 最终兜底：旧索引映射退化为整行 */
    try{
     var node=t;
     while(node&&node.parentNode!==docContentEl)node=node.parentNode;
     if(node&&node!==docContentEl){
      var kids=null;
      try{ kids=docContentEl.children; }catch(err2){ return; }
      if(kids&&kids.length){
       var idx=-1;
       for(var i=0;i<kids.length;i++){ if(kids[i]===node){ idx=i; break; } }
       if(idx>=0){
        var blocks=mdBlocksOf(base.text);
        if(idx<blocks.length){
         var ob=blocks[idx];
         if(ob&&ob.isCode){
          openDocMicroPop(cx,cy,{start:ob.start,end:ob.end,text:ob.text,isCode:true,kind:'code'},base.kind);
         }else if(ob){
          var s00=Math.max(0,ob.start);
          if(s00<lines.length)openDocMicroPop(cx,cy,{start:s00,end:s00+1,text:lines[s00],isCode:false,kind:'line'},base.kind);
         }
        }
       }
      }
     }
    }catch(err){}
   }catch(err){}
  });
 }catch(e){}
}
/* ═══════════════════════════════════════════════════════════════════════════
   P4 模块：专业交付导出 / 全文检索（单面板100%宽，零CDN，renderMd兼容）
   - 导出：PNG高清长图 / PDF / MD三项；PNG/PDF走protoAPI.doc后端，MD为前端Blob下载.md，无后端toast降级
   - 检索：阅读/编辑态Ctrl+F捕获，n/m计数，Enter穿梭，Esc完整还原DOM
   ═══════════════════════════════════════════════════════════════════════════ */
function docExportTitle(){
 try{
  var t='';
  try{ if(docTitleEl&&docTitleEl.textContent) t=String(docTitleEl.textContent).trim(); }catch(e){}
  if(!t){ t='功能说明'; }
  return t||'功能说明';
 }catch(e){ return '功能说明'; }
}
function docCurrentRenderHtml(){
 try{
  var editing=false;
  try{ editing=!!(editOn&&docEditEl&&docEditEl.style.display!=='none'&&docEditArea); }catch(e){}
  if(editing){
   try{
    var md=String(docEditArea.value||'');
    var html=renderMd(md);
    return '<div class="doc-content" id="docContent">'+html+'</div>';
   }catch(e){}
  }
  try{ if(docContentEl&&docContentEl.outerHTML) return docContentEl.outerHTML; }catch(e){}
  try{ if(docContentEl) return '<div>'+docContentEl.innerHTML+'</div>'; }catch(e){}
 }catch(e){}
 return '';
}
function toggleDocExportMenu(force){
 try{
  var m=null;
  try{ m=document.getElementById('docExportMenu'); }catch(e){}
  if(!m) return;
  var show=false;
  if(typeof force==='boolean') show=force;
  else show=(m.style.display==='none');
  m.style.display=show?'flex':'none';
 }catch(e){}
}
function closeDocExportMenu(){
 try{
  var m=null;
  try{ m=document.getElementById('docExportMenu'); }catch(e){}
  if(m) m.style.display='none';
 }catch(e){}
}
function exportDocLongImage(){
 try{ closeDocExportMenu(); }catch(e){}
 var title='', html='';
 try{ title=docExportTitle(); }catch(e){}
 try{ html=docCurrentRenderHtml(); }catch(e){}
 if(!html){ try{ showToast('当前文档为空，无法导出'); }catch(e){} return; }
 var api=null;
 try{ api=(window.protoAPI&&window.protoAPI.doc)||null; }catch(e){}
 if(api&&typeof api.exportLongImage==='function'){
  try{
   var p=null;
   try{ p=api.exportLongImage({title:title,html:html}); }catch(e){ p=null; }
   if(p&&typeof p.then==='function'){
    p.then(function(r){
     if(r&&r.ok){ try{ showToast('长图已导出'); }catch(e){} }
     else{ try{ showToast('长图导出失败：'+((r&&r.error)||'未知错误')); }catch(e){} }
    }).catch(function(){ try{ showToast('长图导出失败'); }catch(e){} });
    return;
   }
  }catch(e){}
 }
 try{ showToast('当前环境不支持长图导出'); }catch(e){}
}
function exportDocPdf(){
 try{ closeDocExportMenu(); }catch(e){}
 var title='', html='';
 try{ title=docExportTitle(); }catch(e){}
 try{ html=docCurrentRenderHtml(); }catch(e){}
 if(!html){ try{ showToast('当前文档为空，无法导出'); }catch(e){} return; }
 var api=null;
 try{ api=(window.protoAPI&&window.protoAPI.doc)||null; }catch(e){}
 if(api&&typeof api.exportPdf==='function'){
  try{
   var p=null;
   try{ p=api.exportPdf({title:title,html:html}); }catch(e){ p=null; }
   if(p&&typeof p.then==='function'){
    p.then(function(r){
     if(r&&r.ok){ try{ showToast('PDF已导出'); }catch(e){} }
     else{ try{ showToast('PDF导出失败：'+((r&&r.error)||'未知错误')); }catch(e){} }
    }).catch(function(){ try{ showToast('PDF导出失败'); }catch(e){} });
    return;
   }
  }catch(e){}
 }
 try{ showToast('当前环境不支持PDF导出'); }catch(e){}
}
function exportDocMd(){
 try{ closeDocExportMenu(); }catch(e){}
 var md='';
 try{
  var editing=false;
  try{ editing=!!(editOn&&docEditEl&&docEditEl.style.display!=='none'&&docEditArea); }catch(e){}
  if(editing){ try{ md=String(docEditArea.value||''); }catch(e){} }
  else{ try{ md=String(curDocMd()||''); }catch(e){} }
 }catch(e){}
 if(!md){ try{ showToast('当前文档为空，无法导出'); }catch(e){} return; }
 var title='';
 try{ title=docExportTitle(); }catch(e){ title='功能说明'; }
 var base=String(title||'文档').replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,60)||'文档';
 try{
  var blob=new Blob([md],{type:'text/markdown;charset=utf-8'});
  var url=(window.URL&&window.URL.createObjectURL)?window.URL.createObjectURL(blob):'';
  if(!url){ try{ showToast('MD导出失败'); }catch(e){} return; }
  var a=document.createElement('a');
  a.href=url; a.download=base+'.md';
  document.body.appendChild(a);
  try{ a.click(); }catch(e){}
  setTimeout(function(){ try{ if(a.parentNode) a.parentNode.removeChild(a); }catch(e){} try{ if(window.URL&&window.URL.revokeObjectURL) window.URL.revokeObjectURL(url); }catch(e){} },800);
  try{ showToast('MD已导出'); }catch(e){}
 }catch(e){ try{ showToast('MD导出失败'); }catch(e){} }
}
function ensureDocExportUI(){
 try{
  var btn=null, png=null, pdf=null, md=null;
  try{ btn=document.getElementById('btnDocExport'); }catch(e){}
  try{ png=document.getElementById('btnDocExportPng'); }catch(e){}
  try{ pdf=document.getElementById('btnDocExportPdf'); }catch(e){}
  try{ md=document.getElementById('btnDocExportMd'); }catch(e){}
  if(btn&&!btn._docExpBound){
   btn._docExpBound=true;
   btn.addEventListener('click',function(e){
    try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
    try{ if(e.stopPropagation) e.stopPropagation(); }catch(err){}
    toggleDocExportMenu();
   });
  }
  if(png&&!png._docExpBound){ png._docExpBound=true; png.addEventListener('click',function(e){ try{ if(e.preventDefault) e.preventDefault(); }catch(err){} exportDocLongImage(); }); }
  if(pdf&&!pdf._docExpBound){ pdf._docExpBound=true; pdf.addEventListener('click',function(e){ try{ if(e.preventDefault) e.preventDefault(); }catch(err){} exportDocPdf(); }); }
  if(md&&!md._docExpBound){ md._docExpBound=true; md.addEventListener('click',function(e){ try{ if(e.preventDefault) e.preventDefault(); }catch(err){} exportDocMd(); }); }
  if(!document._docExpOutsideBound){
   document._docExpOutsideBound=true;
   document.addEventListener('click',function(e){
    try{
     var m=null;
     try{ m=document.getElementById('docExportMenu'); }catch(err){}
     if(!m||m.style.display==='none') return;
     var t=e.target||null;
     if(t&&t.closest){
      try{ if(t.closest('#docExportWrap')) return; }catch(err){}
     }
     closeDocExportMenu();
    }catch(err){}
   });
   document.addEventListener('keydown',function(e){
    try{
     if(e.key==='Escape'){
      var m2=null;
      try{ m2=document.getElementById('docExportMenu'); }catch(err){}
      if(m2&&m2.style.display!=='none') closeDocExportMenu();
     }
    }catch(err){}
   },true);
  }
 }catch(e){}
}
/* ── P4 全文检索：Ctrl+F浮出搜索条，n/m计数，Enter穿梭，Esc完整还原 ── */
var docSearch={open:false,q:'',hits:[],idx:-1,editPos:[],editIdx:-1};
function ensureDocSearchUI(){
 try{
  var box=null;
  try{ box=document.getElementById('docSearchBox'); }catch(e){}
  if(!box){
   try{
    box=document.createElement('div');
    box.id='docSearchBox'; box.className='doc-search-box'; box.style.display='none';
    box.innerHTML='<input class="doc-search-input" id="docSearchInput" type="text" placeholder="搜索文档" spellcheck="false" autocomplete="off" /><span class="doc-search-count" id="docSearchCount">0/0</span><button class="docs-btn doc-search-btn" id="docSearchPrev" title="上一个(Shift+Enter)">上一个</button><button class="docs-btn doc-search-btn" id="docSearchNext" title="下一个(Enter)">下一个</button><button class="docs-btn doc-search-btn" id="docSearchClose" title="关闭(Esc)">✕</button>';
    var panel=null;
    try{ panel=document.querySelector('.docs-panel'); }catch(e){}
    if(panel) panel.appendChild(box);
    else document.body.appendChild(box);
   }catch(e){ return; }
  }
  try{
   if(box&&!box._docSearchBound){
    box._docSearchBound=true;
    var inp=null, prev=null, next=null, close=null;
    try{ inp=document.getElementById('docSearchInput'); }catch(e){}
    try{ prev=document.getElementById('docSearchPrev'); }catch(e){}
    try{ next=document.getElementById('docSearchNext'); }catch(e){}
    try{ close=document.getElementById('docSearchClose'); }catch(e){}
    if(inp){
     inp.addEventListener('input',function(){ try{ docSearchDo(inp.value); }catch(e){} });
     inp.addEventListener('keydown',function(e){
      try{
       if(e.key==='Enter'){ e.preventDefault(); try{ docSearchGoto(e.shiftKey?-1:1); }catch(err){} }
       else if(e.key==='Escape'){ e.preventDefault(); try{ if(e.stopPropagation) e.stopPropagation(); }catch(err){} docSearchClose(); }
      }catch(err){}
     });
    }
    if(prev) prev.addEventListener('click',function(){ try{ docSearchGoto(-1); }catch(e){} });
    if(next) next.addEventListener('click',function(){ try{ docSearchGoto(1); }catch(e){} });
    if(close) close.addEventListener('click',function(){ try{ docSearchClose(); }catch(e){} });
   }
  }catch(e){}
  try{
   if(!document._docSearchKeyBound){
    document._docSearchKeyBound=true;
    document.addEventListener('keydown',function(e){
     try{
      var k=e.key||'';
      var isF=(k==='f'||k==='F');
       if((e.ctrlKey||e.metaKey)&&isF){
        var t=e.target||null;
        var inCodeEdit=false;
        try{
          if(t&&t.closest){
            if(t.closest('#codeEditDrawer')||t.closest('#codeEditInline')||t.closest('.code-edit-search')) inCodeEdit=true;
          }
        }catch(err){}
        if(inCodeEdit){ return; }
        var inDocs=false;
       try{
        if(t&&t.closest){
         if(t.closest('.docs-panel')||t.closest('#docSearchBox')||t.closest('.req-panel')) inDocs=true;
        }
        if(!inDocs){
         try{
          if(t===(docEditArea||null)||t===(docContentEl||null)) inDocs=true;
         }catch(err){}
        }
       }catch(err){}
       /* 阅读模式全局唤起：文档面板开着且正文可见、非编辑态时，焦点在预览区/工具栏按 Ctrl+F 同样打开文档检索
        * （Electron 无浏览器查找条，不拦截则毫无反应；代码编辑抽屉有自己的搜索，此处已让路） */
       if(!inDocs){
        try{
         var _isPc=false, _docsOpen=false, _editing=false, _shown=false;
         try{ _isPc=!!(document.body&&document.body.classList.contains('kind-pc')); }catch(e0){}
         try{ _docsOpen=!!(document.body&&document.body.classList.contains('docs-open')); }catch(e1){}
         try{ _editing=!!(typeof editOn!=='undefined'&&editOn); }catch(e2){}
         try{ _shown=!!(typeof docContentEl!=='undefined'&&docContentEl&&docContentEl.style.display!=='none'); }catch(e3){}
         if(_shown&&!_editing&&(!_isPc||_docsOpen)) inDocs=true;
        }catch(err){}
       }
       if(inDocs){
        e.preventDefault();
        try{ if(e.stopPropagation) e.stopPropagation(); }catch(err){}
        docSearchOpen();
        return;
       }
       return;
      }
      if((k==='Escape'||k==='Esc'||e.keyCode===27)&&docSearch.open){
       e.preventDefault();
       try{ if(e.stopPropagation) e.stopPropagation(); }catch(err){}
       docSearchClose();
       return;
      }
     }catch(err){}
    },true);
   }
  }catch(e){}
 }catch(e){}
}
function docSearchOpen(){
 try{
  ensureDocSearchUI();
  var box=null, inp=null;
  try{ box=document.getElementById('docSearchBox'); }catch(e){}
  try{ inp=document.getElementById('docSearchInput'); }catch(e){}
  if(!box||!inp) return;
  docSearch.open=true;
  box.style.display='flex';
  try{
   if(!inp.value){
    var sel='';
    try{ sel=String((window.getSelection?window.getSelection().toString():'')||'').slice(0,40); }catch(e){}
    if(sel&&sel.indexOf('\n')<0) inp.value=sel;
   }
  }catch(e){}
  try{ inp.focus(); if(inp.select) inp.select(); }catch(e){}
  try{ docSearchDo(inp.value); }catch(e){}
 }catch(e){}
}
function docSearchClose(){
 try{ docSearch.open=false; }catch(e){}
 try{
  var box=null;
  try{ box=document.getElementById('docSearchBox'); }catch(e){}
  if(box) box.style.display='none';
 }catch(e){}
 try{ docSearchClearHits(); }catch(e){}
 try{ docSearch.q=''; docSearch.hits=[]; docSearch.idx=-1; docSearch.editPos=[]; docSearch.editIdx=-1; }catch(e){}
 try{ docSearchUpdateCount(0,0); }catch(e){}
}
function docSearchClearHits(){
 try{
  var root=null;
  try{ root=docContentEl; }catch(e){}
  if(!root) return;
  var hits=null;
  try{ hits=root.querySelectorAll('.doc-search-hit,.doc-search-hit-active'); }catch(e){ return; }
  for(var i=hits.length-1;i>=0;i--){
   try{
    var sp=hits[i];
    var tx=document.createTextNode(sp.textContent||'');
    if(sp.parentNode) sp.parentNode.replaceChild(tx,sp);
   }catch(e){}
  }
  try{ root.normalize(); }catch(e){}
 }catch(e){}
 try{ docSearch.hits=[]; docSearch.idx=-1; }catch(e){}
}
function docSearchUpdateCount(a,b){
 try{
  var c=null;
  try{ c=document.getElementById('docSearchCount'); }catch(e){}
  if(c) c.textContent=String(a||0)+'/'+String(b||0);
 }catch(e){}
}
function docSearchScrollTo(el){
 if(!el) return;
 try{
  if(typeof scrollDocTo==='function'){ scrollDocTo(el); }
  else if(el.scrollIntoView){ el.scrollIntoView({block:'center',behavior:'smooth'}); }
 }catch(e){
  try{ if(el.scrollIntoView) el.scrollIntoView(); }catch(e2){}
 }
}
function docSearchDo(q){
 q=String(q==null?'':q);
 docSearch.q=q;
 var editing=false;
 try{ editing=!!(editOn&&docEditEl&&docEditEl.style.display!=='none'&&docEditArea); }catch(e){}
 if(editing){ docSearchEditDo(q); return; }
 try{ docSearchClearHits(); }catch(e){}
 if(!q){ docSearch.hits=[]; docSearch.idx=-1; docSearchUpdateCount(0,0); return; }
 var root=null;
 try{ root=docContentEl; }catch(e){}
 if(!root){ docSearchUpdateCount(0,0); return; }
 var hits=[];
 try{
  var walker=null;
  try{ walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false); }catch(e){ walker=null; }
  if(!walker){ docSearchUpdateCount(0,0); return; }
  var nodes=[];
  var nd=null;
  while((nd=walker.nextNode())){
   try{
    var p=nd.parentNode;
    var inSvg=false;
    try{
     var cur=p;
     while(cur&&cur!==root){
      if(cur.tagName&&String(cur.tagName).toLowerCase()==='svg'){ inSvg=true; break; }
      cur=cur.parentNode;
     }
    }catch(e){}
    if(inSvg) continue;
    var v=String(nd.nodeValue||'');
    if(!v) continue;
    if(v.toLowerCase().indexOf(String(q).toLowerCase())<0) continue;
    nodes.push(nd);
   }catch(e){}
  }
  var qLow=String(q).toLowerCase();
  for(var n=0;n<nodes.length;n++){
   try{
    var textNode=nodes[n];
    var text=String(textNode.nodeValue||'');
    var low=text.toLowerCase();
    var frag=document.createDocumentFragment();
    var last=0, pos=low.indexOf(qLow);
    var added=false;
    while(pos>=0){
     added=true;
     if(pos>last) frag.appendChild(document.createTextNode(text.slice(last,pos)));
     var sp=document.createElement('span');
     sp.className='doc-search-hit';
     sp.textContent=text.substr(pos,q.length);
     frag.appendChild(sp);
     hits.push(sp);
     last=pos+q.length;
     pos=low.indexOf(qLow,last);
     if(hits.length>500) break;
    }
    if(!added) continue;
    if(last<text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    if(textNode.parentNode) textNode.parentNode.replaceChild(frag,textNode);
    if(hits.length>500) break;
   }catch(e){}
  }
 }catch(e){}
 docSearch.hits=hits;
 docSearch.idx=hits.length?0:-1;
 try{
  for(var i=0;i<hits.length;i++){
   try{
    if(i===docSearch.idx) hits[i].classList.add('doc-search-hit-active');
    else if(hits[i].classList) hits[i].classList.remove('doc-search-hit-active');
   }catch(e){}
  }
 }catch(e){}
 docSearchUpdateCount(docSearch.idx>=0?docSearch.idx+1:0,hits.length);
 if(docSearch.idx>=0){ try{ docSearchScrollTo(hits[docSearch.idx]); }catch(e){} }
}
function docSearchGoto(dir){
 var editing=false;
 try{ editing=!!(editOn&&docEditEl&&docEditEl.style.display!=='none'&&docEditArea); }catch(e){}
 if(editing){ docSearchEditGoto(dir); return; }
 if(!docSearch.hits||!docSearch.hits.length) return;
 var n=docSearch.hits.length;
 var cur=docSearch.idx<0?0:docSearch.idx;
 cur=(cur+(dir<0?-1:1)+n)%n;
 docSearch.idx=cur;
 for(var i=0;i<n;i++){
  try{
   if(i===cur) docSearch.hits[i].classList.add('doc-search-hit-active');
   else docSearch.hits[i].classList.remove('doc-search-hit-active');
  }catch(e){}
 }
 docSearchUpdateCount(cur+1,n);
 try{ docSearchScrollTo(docSearch.hits[cur]); }catch(e){}
}
function docSearchEditDo(q){
 q=String(q==null?'':q);
 try{ docSearchClearHits(); }catch(e){}
 var ta=null;
 try{ ta=docEditArea; }catch(e){}
 if(!ta){ docSearchUpdateCount(0,0); return; }
 if(!q){ docSearch.editPos=[]; docSearch.editIdx=-1; docSearchUpdateCount(0,0); return; }
 var text=String(ta.value||'');
 var low=text.toLowerCase(), qLow=String(q).toLowerCase();
 var pos=[];
 var idx=low.indexOf(qLow);
 while(idx>=0){
  pos.push(idx);
  if(pos.length>500) break;
  idx=low.indexOf(qLow,idx+Math.max(1,q.length));
 }
 docSearch.editPos=pos;
 docSearch.editIdx=pos.length?0:-1;
 docSearchUpdateCount(pos.length?(docSearch.editIdx+1):0,pos.length);
 if(pos.length){
  try{
   ta.focus();
   ta.setSelectionRange(pos[0],pos[0]+q.length);
   try{
    var line=text.slice(0,pos[0]).split('\n').length-1;
    ta.scrollTop=Math.max(0,line*18-ta.clientHeight/2);
   }catch(e){}
  }catch(e){}
 }
}
function docSearchEditGoto(dir){
 var ta=null;
 try{ ta=docEditArea; }catch(e){}
 if(!ta||!docSearch.editPos||!docSearch.editPos.length) return;
 var n=docSearch.editPos.length;
 var cur=docSearch.editIdx<0?0:docSearch.editIdx;
 cur=(cur+(dir<0?-1:1)+n)%n;
 docSearch.editIdx=cur;
 var q=String(docSearch.q||'');
 var at=docSearch.editPos[cur];
 try{
  ta.focus();
  ta.setSelectionRange(at,at+q.length);
  try{
   var text=String(ta.value||'');
   var line=text.slice(0,at).split('\n').length-1;
   ta.scrollTop=Math.max(0,line*18-ta.clientHeight/2);
  }catch(e){}
 }catch(e){}
 docSearchUpdateCount(cur+1,n);
}
try{ window.DocP4={exportLongImage:exportDocLongImage,exportPdf:exportDocPdf,exportMd:exportDocMd,searchOpen:docSearchOpen,searchClose:docSearchClose}; }catch(e){}
/* P2 初始化：入口按钮 + 抽屉 DOM 预建 + Scrollspy 绑定 + 微浮层双击绑定 */
try{ ensureDocAssetBtn(); }catch(e){}
try{ ensureDocAssetDom(); }catch(e){}
try{ ensureTocSpy(); }catch(e){}
try{ bindDocMicro(); }catch(e){}
try{ bindDocToolbar(document); }catch(e){}
/* 单文档初始化：清除残留Tab条，不触碰编辑态 */
try{ removeDocTabStrip(); }catch(e){}
/* P4 初始化：导出工具栏 + 全文检索（不触碰编辑态） */
try{ ensureDocExportUI(); }catch(e){}
try{ ensureDocSearchUI(); }catch(e){}

/* ======= 独立文档窗口 + 目录双Tab + 模式切换（iter14，不改后端，失败静默） =======
   约定：后端提供 docwin:open/close/toggle 与 doc:mirror-push/back 中继、doc:mirror 事件；
   独立窗口为同一 HTML 加 ?docwin=1 启动。无后端时切换按钮 toast 降级，推送失败静默。
   reqMode 流语义不变，仅在切换后追加推送，脏检查走既有 flushEdit 与 DocGuard。 */
var DOCWIN_QUERY_KEY='docwin';
var DOCWIN_BC_NAME='doc-mirror';
var __docMirrorApplying=false;
var __docMirrorBC=null;
var __docWinWrapped={};
function isDocWinMode(){
 try{
  if(typeof URLSearchParams!=='undefined'&&location&&location.search){
   return new URLSearchParams(location.search).get(DOCWIN_QUERY_KEY)==='1';
  }
 }catch(e){}
 try{ return String((location&&location.search)||'').indexOf('docwin=1')>=0; }catch(e2){ return false; }
}
function docWinToast(msg){
 try{ if(typeof showToast==='function') showToast(String(msg==null?'':msg)); }catch(e){}
}
function docMirrorBC(){
 try{
  if(__docMirrorBC) return __docMirrorBC;
  if(typeof BroadcastChannel!=='undefined'){ __docMirrorBC=new BroadcastChannel(DOCWIN_BC_NAME); }
 }catch(e){ __docMirrorBC=null; }
 return __docMirrorBC;
}
function docMirrorBCSend(kind,payload){
 try{
  var bc=null;
  try{ bc=docMirrorBC(); }catch(e){ bc=null; }
  if(!bc||typeof bc.postMessage!=='function') return;
  var from='main';
  try{ from=isDocWinMode()?'docwin':'main'; }catch(e){}
  bc.postMessage({kind:String(kind||''),payload:payload||{},from:from,ts:Date.now()});
 }catch(e){}
}
function docTryProtoFn(objPath,fnName,arg){
 try{
  var cur=null;
  try{
   if(!objPath){ cur=(window.protoAPI&&window.protoAPI[fnName]); }
   else{ cur=(window.protoAPI&&window.protoAPI[objPath]&&window.protoAPI[objPath][fnName]); }
  }catch(e){ cur=null; }
  if(typeof cur!=='function') return false;
  var r=null;
  try{ r=cur.call((objPath&&window.protoAPI)?window.protoAPI[objPath]:window.protoAPI,arg); }catch(e){ return false; }
  return true;
 }catch(e){ return false; }
}
function mirrorPush(kind,payload){
 if(__docMirrorApplying) return;
 try{ if(isDocWinMode()) return; }catch(e){}
 var p=null;
 try{ p=(payload&&typeof payload==='object')?payload:{}; }catch(e){ p={}; }
 try{
  var cands=[['doc','mirrorPush'],['docwin','mirrorPush'],['','mirrorPush'],['doc','pushMirror']];
  for(var i=0;i<cands.length;i++){
   try{ if(docTryProtoFn(cands[i][0],cands[i][1],{kind:String(kind||''),payload:p})) break; }catch(e){}
  }
 }catch(e){}
 try{ docMirrorBCSend(kind,p); }catch(e){}
  try{ if(typeof MirrorSync!=='undefined'&&MirrorSync&&MirrorSync.notifyPush) MirrorSync.notifyPush(kind,p); }catch(e2){}
  try{ window.__lastMirrorPush={kind:String(kind||''),payload:p,ts:Date.now()}; }catch(e){}
}
function mirrorBack(kind,payload){
 if(__docMirrorApplying) return;
 try{ if(!isDocWinMode()) return; }catch(e){}
 var p=null;
 try{ p=(payload&&typeof payload==='object')?payload:{}; }catch(e){ p={}; }
 try{
  var cands=[['doc','mirrorBack'],['docwin','mirrorBack'],['','mirrorBack'],['doc','backMirror']];
  for(var i=0;i<cands.length;i++){
   try{ if(docTryProtoFn(cands[i][0],cands[i][1],{kind:String(kind||''),payload:p})) break; }catch(e){}
  }
 }catch(e){}
 try{ docMirrorBCSend(kind,p); }catch(e){}
  try{ if(typeof MirrorSync!=='undefined'&&MirrorSync&&MirrorSync.notifyBack) MirrorSync.notifyBack(kind,p); }catch(e2){}
  try{ window.__lastMirrorBack={kind:String(kind||''),payload:p,ts:Date.now()}; }catch(e){}
}
function getDocReqState(){
 try{
  var isPc=false;
  try{ isPc=(typeof pcMode==='function'&&pcMode()); }catch(e){}
  try{ if(!isPc&&document.body&&document.body.classList.contains('kind-pc')) isPc=true; }catch(e){}
   if(isPc){
    try{ if(typeof reqOpen!=='undefined'&&reqOpen) return true; }catch(e){}
    try{ if(document.body&&document.body.classList.contains('req-open')) return true; }catch(e){}
    /* PC 合一：面板内 tab 态同样以 reqMode 为准（与移动端一致） */
    try{ if(typeof reqMode!=='undefined'&&reqMode) return true; }catch(e){}
    try{ if(window.reqMode) return true; }catch(e){}
    return false;
   }
  try{ if(typeof reqMode!=='undefined') return !!reqMode; }catch(e){}
  try{ if(window.reqMode) return true; }catch(e){}
  return false;
 }catch(e){ return false; }
}
function getContentPayload(){
 var md='',rm=false,title='';
 try{ rm=getDocReqState(); }catch(e){}
 try{ if(typeof curDocMd==='function') md=String(curDocMd()||''); }catch(e){}
 try{ if(docTitleEl&&docTitleEl.textContent) title=String(docTitleEl.textContent); }catch(e){}
 return {md:md,reqMode:rm,title:title};
}
function getSourcePayload(){
 var nm='',disp='',rm=false,proj='',proto='';
 try{
  var cur=null;
  try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ cur=null; }
  if(cur){ try{ nm=String(cur.name||''); }catch(e){} try{ disp=String(cur.displayName||cur.name||''); }catch(e){} try{ proto=String(cur.displayName||cur.name||''); }catch(e){} }
 }catch(e){}
 try{ rm=getDocReqState(); }catch(e){}
 try{ proj=(typeof currentProject!=='undefined')?String(currentProject||''):''; }catch(e){ try{ proj=String(window.currentProject||''); }catch(e2){} }
 return {sourceName:nm,displayName:disp,reqMode:rm,project:proj,proto:proto};
}
function syncDocWinBtn(){
 try{
  var b=null;
  try{ b=document.getElementById('btnDocWinToggle'); }catch(e){ b=null; }
  if(!b) return;
  var isW=false;
  try{ isW=isDocWinMode(); }catch(e){}
  var txt=isW?'切换回弹窗':'独立窗口';
  try{ if(b.textContent!==txt) b.textContent=txt; }catch(e){}
  try{ b.title=isW?'关闭独立窗口，回到主窗口弹窗':'在独立窗口中打开文档'; }catch(e){}
 }catch(e){}
}
function syncDocModeTabs(){
 try{
  var onReq=false;
  try{ onReq=getDocReqState(); }catch(e){}
  var d=null,r=null;
  try{ d=document.getElementById('btnDocTabDesc'); }catch(e){}
  try{ r=document.getElementById('btnDocTabReq'); }catch(e){}
  if(d&&d.classList){ try{ if(onReq) d.classList.remove('on'); else d.classList.add('on'); }catch(e){} }
  if(r&&r.classList){ try{ if(onReq) r.classList.add('on'); else r.classList.remove('on'); }catch(e){} }
 }catch(e){}
}
function ensureDocModeUI(){
 try{
  var tocBtn=null;
  try{ tocBtn=document.getElementById('btnToc'); }catch(e){}
  if(tocBtn&&!document.getElementById('btnDocWinToggle')){
   try{
    var b=document.createElement('button');
    b.type='button'; b.id='btnDocWinToggle'; b.className='docs-btn';
    b.title='在独立窗口中打开文档'; b.textContent='独立窗口';
    b.addEventListener('click',function(e){
     try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
     try{ toggleDocWin(); }catch(err){}
    });
    if(tocBtn.nextSibling) tocBtn.parentNode.insertBefore(b,tocBtn.nextSibling);
    else tocBtn.parentNode.appendChild(b);
   }catch(e){}
  }else if(tocBtn){
   try{
    var ex=document.getElementById('btnDocWinToggle');
    if(ex&&!ex._docWinBound){
     ex._docWinBound=true;
     ex.addEventListener('click',function(e){
      try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
      try{ toggleDocWin(); }catch(err){}
     });
    }
   }catch(e){}
  }
 }catch(e){}
 try{
  if(!document.getElementById('docModeTabs')){
   try{
    var head=null;
    try{ head=document.querySelector('.docs-panel .docs-head'); }catch(e){}
    if(!head){ try{ head=document.querySelector('.docs-head'); }catch(e2){} }
    if(head&&head.parentNode){
     var bar=document.createElement('div');
     bar.className='doc-mode-tabs'; bar.id='docModeTabs';
     var bd=document.createElement('button');
     bd.type='button'; bd.id='btnDocTabDesc'; bd.className='doc-mode-tab on'; bd.textContent='功能说明';
     bd.title='查看功能说明';
     var br=document.createElement('button');
     br.type='button'; br.id='btnDocTabReq'; br.className='doc-mode-tab'; br.textContent='最新需求';
     br.title='查看最新需求';
     bar.appendChild(bd); bar.appendChild(br);
     if(head.nextSibling) head.parentNode.insertBefore(bar,head.nextSibling);
     else head.parentNode.appendChild(bar);
    }
   }catch(e){}
  }
  try{
   var d=document.getElementById('btnDocTabDesc');
   if(d&&!d._docTabBound){
    d._docTabBound=true;
    d.addEventListener('click',function(e){
     try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
     try{ switchDocTab(false); }catch(err){}
    });
   }
  }catch(e){}
  try{
   var rr=document.getElementById('btnDocTabReq');
   if(rr&&!rr._docTabBound){
    rr._docTabBound=true;
    rr.addEventListener('click',function(e){
     try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
     try{ switchDocTab(true); }catch(err){}
    });
   }
  }catch(e){}
 }catch(e){}
 try{ syncDocWinBtn(); }catch(e){}
 try{ syncDocModeTabs(); }catch(e){}
}
function switchDocTab(toReq){
 try{
  var want=!!toReq;
  try{
   if(typeof flushEdit==='function'){
    if(flushEdit()===false) return;
   }else if(window.DocGuard&&typeof window.DocGuard.confirmLeave==='function'){
    if(!window.DocGuard.confirmLeave()) return;
   }else{
    var dirty=false;
    try{ dirty=(typeof isDocDirty==='function'&&isDocDirty()); }catch(e){}
    if(dirty){
     if(!window.confirm('当前功能说明有未保存的修改，是否保存并离开？')) return;
     try{ if(typeof exitEdit==='function') exitEdit(); }catch(e){}
    }
   }
  }catch(e){}
  try{
   var reqEditingOn=false;
   try{ reqEditingOn=(typeof reqEditing!=='undefined'&&reqEditing); }catch(e){}
   if(reqEditingOn){
    var txt='',orig='';
    try{ var ae=document.getElementById('reqEditArea'); txt=String((ae&&ae.value)||''); }catch(e){}
    try{ orig=String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){}
    if(txt!==orig){
     if(!window.confirm('当前最新需求有未保存的修改，是否放弃并切换？')) return;
    }
    try{ if(typeof exitReqEdit==='function') exitReqEdit(true); }catch(e){}
   }
  }catch(e){}
  var isPc=false;
  try{ isPc=(typeof pcMode==='function'&&pcMode()); }catch(e){}
  try{ if(!isPc&&document.body&&document.body.classList.contains('kind-pc')) isPc=true; }catch(e){}
   if(isPc){
    /* PC 合一：最新需求直接渲染进统一 docs 面板 body，tab 切换内容，不再弹独立裸弹窗 */
    try{
     if(want){
      if(typeof setReqOpen==='function') setReqOpen(false);
      if(typeof setDocsOpen==='function') setDocsOpen(true);
      try{ if(typeof reqMode!=='undefined') reqMode=true; else if(window) window.reqMode=true; }catch(e){}
      if(typeof renderReqIntoDocs==='function') renderReqIntoDocs();
     }else{
      if(typeof setReqOpen==='function') setReqOpen(false);
      try{ if(typeof reqMode!=='undefined') reqMode=false; else if(window) window.reqMode=false; }catch(e){}
      if(typeof loadDesc==='function') loadDesc();
      else if(typeof setDocsOpen==='function') setDocsOpen(true);
     }
    }catch(e){}
   try{ syncDocModeTabs(); }catch(e){}
   try{ syncDocWinBtn(); }catch(e){}
   try{
    if(isDocWinMode()) mirrorBack('mode',{reqMode:want});
    else mirrorPush('mode',{reqMode:want});
   }catch(e){}
  }else{
   var needPush=false;
   try{
    var cur=false;
    try{ cur=getDocReqState(); }catch(e){}
    needPush=(cur!==want);
   }catch(e){ needPush=true; }
   try{
    if(typeof setReqModeMobile==='function'){ setReqModeMobile(want); }
    else{
     try{
      if(typeof reqMode!=='undefined'){
       if(reqMode!==want){
        reqMode=want;
        if(want){ if(typeof renderReqIntoDocs==='function') renderReqIntoDocs(); }
        else{ if(typeof loadDesc==='function') loadDesc(); }
       }
      }else if(window){
       window.reqMode=want;
       if(want){ if(typeof renderReqIntoDocs==='function') renderReqIntoDocs(); }
       else{ if(typeof loadDesc==='function') loadDesc(); }
      }
     }catch(e){}
    }
   }catch(e){}
   try{ syncDocModeTabs(); }catch(e){}
   if(needPush){
    try{
     if(isDocWinMode()) mirrorBack('mode',{reqMode:want});
     else mirrorPush('mode',{reqMode:want});
    }catch(e){}
   }
  }
  /* PC 目录常驻：tab 切换直接刷新目录内容并保持可见，不隐藏 */
  try{ if(typeof syncTocForTab==='function') syncTocForTab(); }catch(e){}
 }catch(e){}
}
/* PC 目录常驻（与文档弹窗同显隐）：开面板则目录重建并保持可见；
 * 切 tab 只刷新内容不隐藏；仅关面板时一并隐藏。移动端/独立窗保持原行为。 */
function isTocPinMode(){
 try{
  if(typeof isDocWinMode==='function'&&isDocWinMode()) return false;
  if(typeof isAiWinMode==='function'&&isAiWinMode()) return false;
  if(typeof pcMode==='function'&&pcMode()) return true;
 }catch(e){}
 try{ if(document.body&&document.body.classList.contains('kind-pc')) return true; }catch(e){}
 return false;
}
function syncTocForTab(){
 try{
  if(!isTocPinMode()){ try{ if(typeof refreshToc==='function') refreshToc(); }catch(e){} return; }
  try{ if(typeof buildToc==='function') buildToc(); }catch(e){}
  try{
   var open=false;
   try{ open=(typeof tocOpen==='function')?!!tocOpen():false; }catch(e){}
   if(!open&&typeof openToc==='function') openToc();
  }catch(e){}
 }catch(e){}
}
/* iter25: AI任务守卫+输入草稿镜像（纯色，无渐变）：toggle双向拒绝忙时切换，ai-draft两端收发，失败不抛错 */
function isAiTaskRunning(){
 try{ if(typeof aiBusy!=='undefined'&&aiBusy) return true; }catch(e){}
 try{ if(typeof window!=='undefined'&&window.aiBusy) return true; }catch(e){}
 try{ var _s=document.getElementById('aiSend'); if(_s&&_s.classList&&_s.classList.contains('stopping')) return true; }catch(e){}
 return false;
}
function getAiDraftText(){
 try{
  var el=null;
  try{ el=document.getElementById('aiInput'); }catch(e){ el=null; }
  if(el&&typeof el.value==='string') return String(el.value);
 }catch(e){}
 return '';
}
function applyAiDraftText(text){
 try{
  var el=null;
  try{ el=document.getElementById('aiInput'); }catch(e){ el=null; }
   if(!el) return false;
   try{ el.value=String(text==null?'':text); }catch(e){ return false; }
   try{ if(typeof aiAutosizeInput==='function') aiAutosizeInput(); }catch(e){} /* 草稿恢复后同步输入框高度 */
   return true;
 }catch(e){ return false; }
}
/* iter26: 草稿pull+ACK+双保险+历史落定渲染（无渐变）：常驻变量+ts覆盖+localStorage+20次ACK停+pull一次+落定三件套 */
var __aiDraftPendingText='';
var __aiDraftPendingTs=0;
var __aiDraftLastRecvTs=0;
var __aiDraftAckedTs=0;
var __aiDraftRetryTimer=null;
var __aiDraftRetryTs=0;
var AI_DRAFT_MIRROR_KEY='aiDraftMirror';
function __aiDraftNowTs(){ try{ return Date.now(); }catch(e){ return 0; } }
function readAiDraftMirror(){
 try{
  var raw=null;
  try{ raw=localStorage.getItem(AI_DRAFT_MIRROR_KEY); }catch(e){ raw=null; }
  if(!raw) return null;
  var o=null;
  try{ o=JSON.parse(raw); }catch(e){ return null; }
  if(!o||typeof o!=='object') return null;
  var t='';
  try{ t=String(o.text==null?'':o.text); }catch(e){ t=''; }
  var ts=0;
  try{ ts=Number(o.ts||0)||0; }catch(e){ ts=0; }
  return {text:t,ts:ts};
 }catch(e){ return null; }
}
function writeAiDraftMirror(text,ts){
 try{
  var t=String(text==null?'':text);
  var n=Number(ts||0)||0;
  try{ localStorage.setItem(AI_DRAFT_MIRROR_KEY,JSON.stringify({text:t,ts:n})); }catch(e){}
 }catch(e){}
}
function rememberAiDraft(text,ts){
 try{
  var t=String(text==null?'':text);
  var n=Number(ts||0)||0;
  if(!n){ try{ n=__aiDraftNowTs(); }catch(e){ n=0; } }
  try{ if(n&&__aiDraftPendingTs&&n<__aiDraftPendingTs) return {text:__aiDraftPendingText,ts:__aiDraftPendingTs}; }catch(e){}
  try{ __aiDraftPendingText=t; }catch(e){}
  try{ __aiDraftPendingTs=n; }catch(e){}
  try{ window.__aiDraftPendingText=t; }catch(e){}
  try{ window.__aiDraftPendingTs=n; }catch(e){}
  try{ writeAiDraftMirror(t,n); }catch(e){}
  return {text:t,ts:n};
 }catch(e){ return {text:String(text==null?'':text),ts:Number(ts||0)||0}; }
}
function restoreAiDraftFromMirror(){
 try{
  var cur='';
  try{ cur=getAiDraftText(); }catch(e){ cur=''; }
  if(cur) return false;
  var m=null;
  try{ m=readAiDraftMirror(); }catch(e){ m=null; }
  if(!m||!m.text) return false;
  try{ if(m.ts&&__aiDraftLastRecvTs&&m.ts<__aiDraftLastRecvTs) return false; }catch(e){}
  var ok=false;
  try{ ok=applyAiDraftText(m.text); }catch(e){ ok=false; }
  if(ok){
   try{ if(m.ts>__aiDraftLastRecvTs) __aiDraftLastRecvTs=m.ts; }catch(e){}
   try{ if(m.ts>__aiDraftPendingTs){ __aiDraftPendingText=m.text; __aiDraftPendingTs=m.ts; } }catch(e){}
   return true;
  }
  return false;
 }catch(e){ return false; }
}
function sendAiDraftAck(ts){
 try{
  var n=Number(ts||0)||0;
  if(!n) return;
  var payload={ts:n};
  try{ docMirrorBCSend('ai-draft-ack',payload); }catch(e){}
  try{ mirrorPush('ai-draft-ack',payload); }catch(e){}
  try{ mirrorBack('ai-draft-ack',payload); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.mirrorPush==='function') window.protoAPI.doc.mirrorPush({kind:'ai-draft-ack',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.mirrorBack==='function') window.protoAPI.doc.mirrorBack({kind:'ai-draft-ack',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.mirrorPush==='function') window.protoAPI.aiwin.mirrorPush({kind:'ai-draft-ack',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.mirrorBack==='function') window.protoAPI.aiwin.mirrorBack({kind:'ai-draft-ack',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.mirrorPush==='function') window.protoAPI.docwin.mirrorPush({kind:'ai-draft-ack',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.mirrorBack==='function') window.protoAPI.docwin.mirrorBack({kind:'ai-draft-ack',payload:payload}); }catch(e){}
 }catch(e){}
}
function sendAiDraftPull(){
 try{
  var payload={ts:__aiDraftNowTs()};
  try{ docMirrorBCSend('ai-draft-pull',payload); }catch(e){}
  try{ mirrorPush('ai-draft-pull',payload); }catch(e){}
  try{ mirrorBack('ai-draft-pull',payload); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.mirrorPush==='function') window.protoAPI.doc.mirrorPush({kind:'ai-draft-pull',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.mirrorBack==='function') window.protoAPI.doc.mirrorBack({kind:'ai-draft-pull',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.mirrorPush==='function') window.protoAPI.aiwin.mirrorPush({kind:'ai-draft-pull',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.mirrorBack==='function') window.protoAPI.aiwin.mirrorBack({kind:'ai-draft-pull',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.mirrorPush==='function') window.protoAPI.docwin.mirrorPush({kind:'ai-draft-pull',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.mirrorBack==='function') window.protoAPI.docwin.mirrorBack({kind:'ai-draft-pull',payload:payload}); }catch(e){}
 }catch(e){}
}
function __aiDraftClearRetry(){
 try{ if(__aiDraftRetryTimer){ try{ clearInterval(__aiDraftRetryTimer); }catch(e){} __aiDraftRetryTimer=null; } }catch(e){}
}
function __aiDraftHealHistory(){
 try{ if(typeof aiEnsureCur==='function') aiEnsureCur(); }catch(e){}
 try{ if(typeof aiRenderBubbles==='function') aiRenderBubbles(); }catch(e){}
 try{ if(typeof aiSaveSesh==='function') aiSaveSesh(); }catch(e){}
}
function __aiDraftHealDoc(){
 try{ if(typeof loadDesc==='function') loadDesc(); }catch(e){}
 try{ if(typeof refreshToc==='function') refreshToc(); }catch(e){}
}
function setAiDraftWithRetry(text,ts){
 try{
  var t=String(text==null?'':text);
  var _ts=0;
  try{ _ts=Number(ts||0)||0; }catch(e){ _ts=0; }
  try{ if(_ts&&_ts<__aiDraftLastRecvTs) return; }catch(e){}
  try{ if(_ts>__aiDraftLastRecvTs) __aiDraftLastRecvTs=_ts; }catch(e){}
  try{ rememberAiDraft(t,_ts||__aiDraftNowTs()); }catch(e){}
  var ok=false;
  try{ ok=applyAiDraftText(t); }catch(e){ ok=false; }
  if(ok) return;
  var attempts=0;
  var timer=setInterval(function(){
   try{
    attempts++;
    var done=false;
    try{ done=applyAiDraftText(t); }catch(e){ done=false; }
    if(done||attempts>=3){ try{ clearInterval(timer); }catch(e){} }
   }catch(e){
    try{ if(attempts>=3) clearInterval(timer); }catch(e2){}
   }
  },500);
 }catch(e){}
}
function sendAiDraftViaMirror(text,ts){
 try{
  var t=String(text==null?'':text);
  var _ts=0;
  try{ _ts=Number(ts||0)||0; }catch(e){ _ts=0; }
  try{ if(!_ts) _ts=__aiDraftNowTs(); }catch(e){}
  try{ rememberAiDraft(t,_ts); }catch(e){}
  var payload={text:t,ts:_ts};
  try{ docMirrorBCSend('ai-draft',payload); }catch(e){}
  try{ mirrorPush('ai-draft',payload); }catch(e){}
  try{ mirrorBack('ai-draft',payload); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.mirrorPush==='function') window.protoAPI.doc.mirrorPush({kind:'ai-draft',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.mirrorBack==='function') window.protoAPI.doc.mirrorBack({kind:'ai-draft',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.mirrorPush==='function') window.protoAPI.aiwin.mirrorPush({kind:'ai-draft',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.mirrorBack==='function') window.protoAPI.aiwin.mirrorBack({kind:'ai-draft',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.mirrorPush==='function') window.protoAPI.docwin.mirrorPush({kind:'ai-draft',payload:payload}); }catch(e){}
  try{ if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.mirrorBack==='function') window.protoAPI.docwin.mirrorBack({kind:'ai-draft',payload:payload}); }catch(e){}
 }catch(e){}
}
function pushAiDraftWithRetry(text,ts){
 try{
  var t=String(text==null?'':text);
  var stamp=0;
  try{ stamp=Number(ts||0)||0; }catch(e){ stamp=0; }
  try{ if(!stamp) stamp=__aiDraftNowTs(); }catch(e){}
  try{ rememberAiDraft(t,stamp); }catch(e){}
  try{ sendAiDraftViaMirror(t,stamp); }catch(e){}
  try{ __aiDraftClearRetry(); }catch(e){}
  try{ __aiDraftRetryTs=stamp; }catch(e){}
  var n=0;
  var timer=setInterval(function(){
   try{
    n++;
    var _acked=0;
    try{ _acked=Number(__aiDraftAckedTs||0)||0; }catch(e){}
    if(_acked>=stamp){ try{ clearInterval(timer); }catch(e){} try{ if(__aiDraftRetryTimer===timer) __aiDraftRetryTimer=null; }catch(e){} return; }
    try{ sendAiDraftViaMirror(t,stamp); }catch(e){}
    if(n>=20){ try{ clearInterval(timer); }catch(e){} try{ if(__aiDraftRetryTimer===timer) __aiDraftRetryTimer=null; }catch(e){} }
    /* iter25 compat: n>=3 legacy cap, now n>=20 with ACK stop */
   }catch(e){
    try{ if(n>=20) clearInterval(timer); }catch(e2){}
   }
  },500);
  try{ __aiDraftRetryTimer=timer; }catch(e){}
 }catch(e){}
}
function restoreAiBusyInMain(){
 try{
  try{ if(typeof openAiForSwitchBack==='function') openAiForSwitchBack(); }catch(e){}
  try{ if(typeof window.aiSetBusy==='function') window.aiSetBusy(true); }catch(e){}
  try{
   var s=document.getElementById('aiSend');
   if(s){ s.classList.add('stopping'); s.textContent='\u23F9 \u505C\u6B62\u751F\u6210'; }
   var inp=document.getElementById('aiInput'); if(inp) inp.disabled=true;
   var mdl=document.getElementById('aiModel'); if(mdl) mdl.disabled=true;
  }catch(e){}
  try{
   var g=null;
   try{ if(typeof window.aiTraceBegin==='function'&&!window.aiStreaming) g=window.aiTraceBegin('\u72EC\u7ACB\u7A97\u53E3\u4EFB\u52A1\uFF08\u5DF2\u8F6C\u5165\u4E3B\u7A97\u53E3\uFF09'); }catch(e){}
   try{
    if(typeof window.aiAppendMsg==='function'&&!window.aiStreaming){
     window.aiStreaming=window.aiAppendMsg('','ai');
     try{ window.aiStreamText=''; window.aiStreamThink=''; }catch(e){}
     try{ if(typeof window.aiRenderStream==='function') window.aiRenderStream(); }catch(e){}
    }
   }catch(e){}
  }catch(e){}
  try{ if(typeof showToast==='function') showToast('AI\u4EFB\u52A1\u5DF2\u8F6C\u5165\u4E3B\u7A97\u53E3\u7EE7\u7EED\u8FD0\u884C'); }catch(e){}
 }catch(e){}
}
function toggleDocWin(){
 try{
  try{ if(isAiTaskRunning()){ try{ docWinToast('\u4EFB\u52A1\u8FDB\u884C\u4E2D\uFF0C\u8BF7\u5148\u505C\u6B62\u6216\u7B49\u5F85\u5B8C\u6210\u540E\u518D\u5207\u6362'); }catch(e){} return; } }catch(e){}
  var done=false;
  var __fromDocWin=false;
  try{ __fromDocWin=isDocWinMode(); }catch(e){}
  if(__fromDocWin){ try{ docWinMarkReopen(); }catch(e){} }
  function __docWinOpenArg(){
   var arg={};
   try{
    var cur=null;
    try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
    var proj='';
    try{ proj=String((typeof currentProject!=='undefined')?currentProject:''); }catch(e){ try{ proj=String(window.currentProject||''); }catch(e2){} }
    var proto='';
    try{
     if(cur)proto=String(cur.displayName||cur.name||'');
     proto=String(proto||'').replace(/\.(html?|md)$/i,'');
    }catch(e){}
    if(cur){
     try{ arg.sourceName=String(cur.name||''); }catch(e){}
     try{ arg.displayName=String(cur.displayName||cur.name||''); }catch(e){}
    }
    try{ arg.project=proj; }catch(e){}
    try{ arg.proto=proto; }catch(e){}
   }catch(e){}
   return arg;
  }
   try{
    if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.toggle==='function'){
     var _r0=null;
     try{
      if(!__fromDocWin){
       var _oa=__docWinOpenArg();
       try{ _r0=window.protoAPI.docwin.toggle(_oa); }catch(e){ try{ _r0=window.protoAPI.docwin.toggle(); }catch(e2){ _r0=null; } }
      }else{ try{ _r0=window.protoAPI.docwin.toggle(); }catch(e){ _r0=null; } }
     }catch(e){ _r0=null; }
     try{ __docWinHandleToggleResult(_r0); }catch(e){}
     done=true;
    }
   }catch(e){}
   if(!done){
    try{
     if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.toggleDocWin==='function'){
      var _r1=null;
      try{ _r1=window.protoAPI.docwin.toggleDocWin(); }catch(e){ _r1=null; }
      try{ __docWinHandleToggleResult(_r1); }catch(e){}
      done=true;
     }
    }catch(e){}
   }
   if(!done){
    try{
     if(window.protoAPI&&window.protoAPI.doc&&typeof window.protoAPI.doc.toggleDocWin==='function'){
      var _r2=null;
      try{ _r2=window.protoAPI.doc.toggleDocWin(); }catch(e){ _r2=null; }
      try{ __docWinHandleToggleResult(_r2); }catch(e){}
      done=true;
     }
    }catch(e){}
   }
   if(!done){
    try{
     if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.open==='function'&&!isDocWinMode()){
      var arg=__docWinOpenArg();
      var _r3=null;
      try{ _r3=window.protoAPI.docwin.open(arg); }catch(e){ _r3=null; }
      try{ __docWinHandleToggleResult(_r3); }catch(e){}
      done=true;
     }else if(window.protoAPI&&window.protoAPI.docwin&&typeof window.protoAPI.docwin.close==='function'&&isDocWinMode()){
      try{ docWinMarkReopen(); }catch(e){}
      var _r4=null;
      try{ _r4=window.protoAPI.docwin.close(); }catch(e){ _r4=null; }
      try{ __docWinHandleToggleResult(_r4); }catch(e){}
      done=true;
     }
    }catch(e){}
   }
  if(!done){ docWinToast('当前环境不支持独立窗口'); }
 }catch(e){ try{ docWinToast('当前环境不支持独立窗口'); }catch(e2){} }
}
function curSourceTitle(){
 try{
  var cur=null;
  try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
  if(!cur) return '';
  var s=String((cur.displayName||cur.name||''));
  return s.replace(/\.(html?|md)$/i,'');
 }catch(e){ return ''; }
}
/* B6 文档窗免选项目：读query直进，缺参回退，永不弹picker */
function getDocWinQueryParams(){
 try{
  var q={project:'',proto:''};
  try{
   if(typeof URLSearchParams!=='undefined'&&location&&location.search){
    var sp=new URLSearchParams(location.search);
    try{ q.project=String(sp.get('project')||''); }catch(e){}
    try{ q.proto=String(sp.get('proto')||''); }catch(e){}
    try{ if(!q.project){ var m=/[?&]project=([^&]*)/.exec(String(location.search||'')); if(m){ try{ q.project=decodeURIComponent(m[1]||''); }catch(e){ q.project=m[1]||''; } } } }catch(e){}
    try{ if(!q.proto){ var m2=/[?&]proto=([^&]*)/.exec(String(location.search||'')); if(m2){ try{ q.proto=decodeURIComponent(m2[1]||''); }catch(e){ q.proto=m2[1]||''; } } } }catch(e){}
   }else{
    var s=String((location&&location.search)||'');
    var m3=/[?&]project=([^&]*)/.exec(s);
    if(m3){ try{ q.project=decodeURIComponent(m3[1]||''); }catch(e){ q.project=m3[1]||''; } }
    var m4=/[?&]proto=([^&]*)/.exec(s);
    if(m4){ try{ q.proto=decodeURIComponent(m4[1]||''); }catch(e){ q.proto=m4[1]||''; } }
   }
  }catch(e){}
  try{ q.project=String(q.project||'').trim(); }catch(e){ q.project=''; }
  try{ q.proto=String(q.proto||'').trim(); }catch(e){ q.proto=''; }
  try{ q.project=decodeURIComponent(q.project); }catch(e){}
  try{ q.proto=decodeURIComponent(q.proto); }catch(e){}
  try{ q.project=String(q.project||'').trim(); }catch(e){}
  try{ q.proto=String(q.proto||'').trim(); }catch(e){}
  return q;
 }catch(e){ return {project:'',proto:''}; }
}
function docWinFindSource(proto){
 try{
  if(!proto)return null;
  var list=[];
  try{ list=(typeof sources!=='undefined')?sources:[]; }catch(e){ try{ list=window.sources||[]; }catch(e2){ list=[]; } }
  if(!list||!list.length)return null;
  var target=String(proto||'').trim();
  if(!target)return null;
  var noExt=function(v){ try{ return String(v||'').replace(/\.(html?|md)$/i,''); }catch(e){ return String(v||''); } };
  for(var i=0;i<list.length;i++){
   var s=list[i];
   if(!s)continue;
   try{
    var disp=String(s.displayName||''), nm=String(s.name||''), main=String(s.mainHtmlFile||'');
    var dir=String(s.sandboxDir||'');
    var base='';
    try{ var parts=dir.replace(/[\\/]+$/,'').split(/[\\/]/); base=String(parts[parts.length-1]||''); }catch(e){}
    if(disp===target||nm===target||main===target||base===target||dir===target)return s;
    if(noExt(disp)===noExt(target)||noExt(nm)===noExt(target)||noExt(main)===noExt(target)||noExt(base)===noExt(target))return s;
   }catch(e){}
  }
  return null;
 }catch(e){ return null; }
}
function docWinSelectProto(proto){
 try{
  if(!proto)return false;
  var found=null;
  try{ found=docWinFindSource(proto); }catch(e){ found=null; }
  if(found){
   try{
    __docMirrorApplying=true;
    try{ if(typeof loadSource==='function')loadSource(found); }catch(e){}
   }finally{ try{ __docMirrorApplying=false; }catch(e){} }
   try{ var tt=curSourceTitle(); if(tt)document.title='文档 · '+tt; }catch(e){}
   try{ if(typeof loadDesc==='function') loadDesc(); }catch(e){}
   try{ if(typeof refreshToc==='function') refreshToc(); }catch(e){}
   return true;
  }
  try{
   if(typeof loadSandboxSources==='function'){
    var curProj='';
    try{ curProj=(typeof currentProject!=='undefined')?currentProject:''; }catch(e){ try{ curProj=window.currentProject||''; }catch(e2){} }
    if(curProj){ try{ loadSandboxSources(proto, true); }catch(e){} return true; }
   }
  }catch(e){}
  return false;
 }catch(e){ return false; }
}
function docWinGuardProjectPicker(){
 try{
  var inW=false;
  try{ inW=isDocWinMode(); }catch(e){ inW=false; }
  if(!inW)return;
  try{ var pm=document.getElementById('projMask'); if(pm)pm.style.display='none'; }catch(e){}
  try{
   var orig=null;
   try{ orig=window.showProjectPicker; }catch(e){ orig=null; }
   if(typeof orig==='function'&&!orig._docWinGuarded){
    var guarded=function(projects,last){
     try{
      var inW2=false;
      try{ inW2=isDocWinMode(); }catch(e){ inW2=false; }
      if(inW2){
       try{
        var qp=null;
        try{ qp=getDocWinQueryParams(); }catch(e){ qp=null; }
        var target='';
        try{ if(qp&&qp.project)target=qp.project; }catch(e){}
        if(!target){ try{ target=last||''; }catch(e){} }
        if(!target){ try{ target=localStorage.getItem('protoLastProject')||''; }catch(e){} }
        if(!target){
         try{
          var arr=(projects||[]).slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'zh-CN'); });
          if(arr.length)target=arr[0].name;
         }catch(e){}
        }
        if(target&&typeof enterProject==='function'){ try{ enterProject(target); }catch(e){} return; }
        try{ var pm2=document.getElementById('projMask'); if(pm2)pm2.style.display='none'; }catch(e){}
        return;
       }catch(e){
        try{ var pm3=document.getElementById('projMask'); if(pm3)pm3.style.display='none'; }catch(e2){}
        return;
       }
      }
     }catch(e){}
     try{ return orig.apply(this,arguments); }catch(e){}
    };
    try{ guarded._docWinGuarded=true; }catch(e){}
    try{ window.showProjectPicker=guarded; }catch(e){}
   }
  }catch(e){}
  try{
   var ob=null;
   try{ ob=window.bootProjectFlow; }catch(e){ ob=null; }
   if(typeof ob==='function'&&!ob._docWinGuarded){
    var guarded2=function(){
     try{
      var inW3=false;
      try{ inW3=isDocWinMode(); }catch(e){ inW3=false; }
      if(inW3){
       try{ docWinBootProject(); }catch(e){}
       try{ var pm4=document.getElementById('projMask'); if(pm4)pm4.style.display='none'; }catch(e){}
       return;
      }
     }catch(e){}
     try{ return ob.apply(this,arguments); }catch(e){}
    };
    try{ guarded2._docWinGuarded=true; }catch(e){}
    try{ window.bootProjectFlow=guarded2; }catch(e){}
   }
  }catch(e){}
 }catch(e){}
}
function docWinBootProject(){
 try{
  try{ docWinGuardProjectPicker(); }catch(e){}
  try{ var pm=document.getElementById('projMask'); if(pm)pm.style.display='none'; }catch(e){}
  var qp=null;
  try{ qp=getDocWinQueryParams(); }catch(e){ qp={project:'',proto:''}; }
  var qproj='',qproto='';
  try{ qproj=String((qp&&qp.project)||'').trim(); }catch(e){}
  try{ qproto=String((qp&&qp.proto)||'').trim(); }catch(e){}
  if(qproj){
   try{
    if(typeof enterProject==='function'){ try{ enterProject(qproj); }catch(e){} }
    else{
     try{ currentProject=qproj; }catch(e){ try{ window.currentProject=qproj; }catch(e2){} }
     try{ if(typeof updateProjectBar==='function')updateProjectBar(); }catch(e){}
     try{ if(typeof loadSandboxSources==='function')loadSandboxSources(qproto||undefined, true); }catch(e){}
    }
   }catch(e){}
   if(qproto){
    try{
     setTimeout(function(){ try{ docWinSelectProto(qproto); }catch(e){} },600);
     setTimeout(function(){ try{ docWinSelectProto(qproto); }catch(e){} },1500);
    }catch(e){}
   }
   try{ setTimeout(function(){ try{ var pm2=document.getElementById('projMask'); if(pm2)pm2.style.display='none'; }catch(e){} },800); }catch(e){}
   return;
  }
  var last='';
  try{ last=String(localStorage.getItem('protoLastProject')||''); }catch(e){}
  if(last){
   try{
    if(typeof enterProject==='function'){ try{ enterProject(last); }catch(e){} }
    else{
     try{ currentProject=last; }catch(e){ try{ window.currentProject=last; }catch(e2){} }
     try{ if(typeof updateProjectBar==='function')updateProjectBar(); }catch(e){}
     try{ if(typeof loadSandboxSources==='function')loadSandboxSources(qproto||undefined, true); }catch(e){}
    }
   }catch(e){}
   if(qproto){
    try{
     setTimeout(function(){ try{ docWinSelectProto(qproto); }catch(e){} },600);
     setTimeout(function(){ try{ docWinSelectProto(qproto); }catch(e){} },1500);
    }catch(e){}
   }
   return;
  }
  try{
   var hasSrc=false;
   try{ var lst=(typeof sources!=='undefined')?sources:[]; hasSrc=!!(lst&&lst.length); }catch(e){ try{ var lst2=window.sources||[]; hasSrc=!!(lst2&&lst2.length); }catch(e2){} }
   if(hasSrc){
    try{
     var cur=null;
     try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ try{ cur=window.currentSource||null; }catch(e2){} }
     if(!cur){
      try{
       var l2=(typeof sources!=='undefined')?sources:[];
       if(!l2||!l2.length){ try{ l2=window.sources||[]; }catch(e){} }
       if(l2&&l2.length){
        __docMirrorApplying=true;
        try{ if(typeof loadSource==='function')loadSource(l2[0]); }catch(e){}
        try{ __docMirrorApplying=false; }catch(e){}
       }
      }catch(e){ try{ __docMirrorApplying=false; }catch(e2){} }
     }
    }catch(e){}
    return;
   }
  }catch(e){}
  try{
   if(window.protoAPI&&window.protoAPI.sandbox&&window.protoAPI.sandbox.projects){
    window.protoAPI.sandbox.projects().then(function(r){
     try{
      var projects=(r&&r.projects)||[];
      if(!projects.length)return;
      var arr=projects.slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'zh-CN'); });
      var first=arr.length?arr[0].name:'';
      if(first&&typeof enterProject==='function'){ try{ enterProject(first); }catch(e){} }
      try{ var pm3=document.getElementById('projMask'); if(pm3)pm3.style.display='none'; }catch(e){}
     }catch(e){}
    }).catch(function(){});
   }
  }catch(e){}
  try{ setTimeout(function(){ try{ var pm4=document.getElementById('projMask'); if(pm4)pm4.style.display='none'; }catch(e){} },800); }catch(e){}
 }catch(e){}
}
function bootDocWinMode(){
 try{ document.title='文档 · 原型工具'; }catch(e){}
 try{ if(document.body) document.body.classList.add('docwin-mode'); }catch(e){}
 try{ docWinGuardProjectPicker(); }catch(e){}
 try{ var pm0=document.getElementById('projMask'); if(pm0)pm0.style.display='none'; }catch(e){}
 try{ ensureDocModeUI(); }catch(e){}
 try{ syncDocWinBtn(); }catch(e){}
 try{ syncDocModeTabs(); }catch(e){}
 try{
  if(document.body){
   document.body.classList.add('docs-open');
   document.body.classList.remove('sb-open');
  }
 }catch(e){}
 try{ if(typeof openToc==='function') openToc(); else if(typeof closeToc==='function') closeToc(); }catch(e){}
 try{
  var t=curSourceTitle();
  if(t){ try{ document.title='文档 · '+t; }catch(e){} }
  try{
   var cur=null;
   try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
   if(cur&&typeof loadDesc==='function'){ loadDesc(); }
  }catch(e){}
 }catch(e){}
 try{ docWinBootProject(); }catch(e){}
 try{ setTimeout(function(){ try{ var pm2=document.getElementById('projMask'); if(pm2)pm2.style.display='none'; }catch(e){} },600); }catch(e){}
  setTimeout(function(){ try{ if(typeof openToc==='function'){ try{ openToc(); }catch(e){} } }catch(e2){} },1200);
}
/* ======= iter18 独立窗联动状态（B2/B3/B4/B5，纯前端，不改后端） =======
   __aiWinOpen 跟踪独立AI窗是否已开（toggle结果+ai-mode事件），供AI设计入口focus判定；
   __docWinOpen 跟踪独立文档窗；reopen 显式切回才开，X关闭仅同步文案（防环经__docMirrorApplying）。 */
var __aiWinOpen=false;
var __docWinOpen=false;
try{ window.__aiWinOpen=false; }catch(e){}
try{ window.__docWinOpen=false; }catch(e){}
function setAiWinOpen(v){ try{ __aiWinOpen=!!v; }catch(e){} try{ window.__aiWinOpen=__aiWinOpen; }catch(e){} }
function setDocWinOpen(v){ try{ __docWinOpen=!!v; }catch(e){} try{ window.__docWinOpen=__docWinOpen; }catch(e){} }
function aiWinMarkReopen(){
 try{ docMirrorBCSend('ai-mode',{mode:'ai-panel',reopen:true}); }catch(e){}
 try{ localStorage.setItem('aiWinReopen','1'); }catch(e){}
 try{ if(window.protoAPI&&window.protoAPI.doc&&window.protoAPI.doc.mirrorBack)window.protoAPI.doc.mirrorBack({kind:'ai-mode',mode:'ai-panel',reopen:true}); }catch(e){}
 try{ if(window.protoAPI&&window.protoAPI.aiwin&&window.protoAPI.aiwin.mirrorBack)window.protoAPI.aiwin.mirrorBack({kind:'ai-mode',mode:'ai-panel',reopen:true}); }catch(e){}
}
function docWinMarkReopen(){
 try{ docMirrorBCSend('mode',{mode:'panel',reopen:true}); }catch(e){}
 try{ localStorage.setItem('docWinReopen','1'); }catch(e){}
 try{ mirrorBack('mode',{mode:'panel',reopen:true}); }catch(e){}
}
function openAiForSwitchBack(){
 try{
  var inAi=false;
  try{ inAi=isAiWinMode(); }catch(e){}
  if(inAi)return;
  if(typeof openAi==='function'){ openAi(); return; }
  if(typeof openAiDesign==='function'){ openAiDesign(); return; }
  try{ var m=document.getElementById('aiMask'); if(m)m.style.display='flex'; }catch(e){}
 }catch(e){}
}
function openDocsForSwitchBack(){
 try{
  var inW=false;
  try{ inW=isDocWinMode(); }catch(e){}
  if(inW)return;
  __docMirrorApplying=true;
  try{
   var isPc=false;
   try{ isPc=(typeof pcMode==='function'&&pcMode()); }catch(e){}
   try{ if(!isPc&&document.body&&document.body.classList.contains('kind-pc'))isPc=true; }catch(e){}
   var inReq=false;
   try{ inReq=getDocReqState(); }catch(e){}
   if(isPc){
     if(inReq){ if(typeof switchDocTab==='function')switchDocTab(true); }
     else if(typeof setDocsOpen==='function')setDocsOpen(true);
     else if(document.body&&document.body.classList)document.body.classList.add('docs-open');
    }else{
    if(typeof setDocsOpen==='function')setDocsOpen(true);
    else if(document.body&&document.body.classList)document.body.classList.add('docs-open');
   }
  }finally{ try{ __docMirrorApplying=false; }catch(e){} }
  try{ syncDocWinBtn(); }catch(e){}
  try{ syncDocModeTabs(); }catch(e){}
 }catch(e){ try{ __docMirrorApplying=false; }catch(e2){} }
}
/* ======= iter15 AI对话独立窗口（复用docwin模式，同一HTML加?aiwin=1启动，仅留AI弹窗全屏） ======= */
var AIWIN_QUERY_KEY='aiwin';
function isAiWinMode(){
 try{
  if(typeof URLSearchParams!=='undefined'&&location&&location.search){
   return new URLSearchParams(location.search).get(AIWIN_QUERY_KEY)==='1';
  }
 }catch(e){}
 try{ return String((location&&location.search)||'').indexOf('aiwin=1')>=0; }catch(e2){ return false; }
}
function aiWinToast(msg){
 try{ if(typeof showToast==='function') showToast(String(msg==null?'':msg)); }catch(e){}
}
function syncAiWinBtn(){
 try{
  var b=null;
  try{ b=document.getElementById('btnAiWinToggle'); }catch(e){ b=null; }
  if(!b) return;
  var isW=false;
  try{ isW=isAiWinMode(); }catch(e){}
  var txt=isW?'切换回弹窗':'独立窗口';
  try{ if(b.textContent!==txt) b.textContent=txt; }catch(e){}
  try{ b.title=isW?'关闭独立窗口，回到主窗口弹窗':'在独立窗口中打开AI对话'; }catch(e){}
 }catch(e){}
}
function ensureAiWinUI(){
 try{
  var btn=null;
  try{ btn=document.getElementById('btnAiWinToggle'); }catch(e){ btn=null; }
  var head=null, tabBar=null, sbx=null;
  try{ head=document.querySelector('.ai-head'); }catch(e){ head=null; }
  try{ tabBar=document.querySelector('.ai-head .ai-tab-header'); }catch(e){ tabBar=null; }
  if(!tabBar){ try{ tabBar=document.querySelector('.ai-tab-header'); }catch(e){ tabBar=null; } }
  try{ sbx=document.getElementById('aiSbx'); }catch(e){ sbx=null; }
  var host=head||null;
  if(!host){
   try{ host=document.querySelector('.ai-logs-toolbar'); }catch(e){ host=null; }
  }
  if(!btn&&host){
   try{
    var b=document.createElement('button');
    b.type='button'; b.id='btnAiWinToggle'; b.className='docs-btn';
    b.title='在独立窗口中打开AI对话'; b.textContent='独立窗口';
    b.addEventListener('click',function(e){
     try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
     try{ toggleAiWin(); }catch(err){}
    });
    try{
     if(host===head){
      if(sbx&&sbx.parentNode===head) head.insertBefore(b,sbx);
      else if(tabBar&&tabBar.nextSibling) head.insertBefore(b,tabBar.nextSibling);
      else head.appendChild(b);
     }else{
      host.appendChild(b);
     }
    }catch(e){ try{ host.appendChild(b); }catch(e2){} }
   }catch(e){}
  }else if(btn){
   try{
    if(head&&btn.parentNode!==head){
     if(sbx&&sbx.parentNode===head) head.insertBefore(btn,sbx);
     else if(tabBar&&tabBar.nextSibling) head.insertBefore(btn,tabBar.nextSibling);
     else head.appendChild(btn);
    }else if(head&&sbx&&sbx.parentNode===head){
     var needMove=false;
     try{ needMove=(btn.nextSibling!==sbx); }catch(e){ needMove=false; }
     if(needMove){
      try{ head.insertBefore(btn,sbx); }catch(e){}
     }
    }
   }catch(e){}
   try{
    if(!btn._aiWinBound){
     btn._aiWinBound=true;
     btn.addEventListener('click',function(e){
      try{ if(e.preventDefault) e.preventDefault(); }catch(err){}
      try{ toggleAiWin(); }catch(err){}
     });
    }
   }catch(e){}
  }
 }catch(e){}
 try{ syncAiWinBtn(); }catch(e){}
}
function __aiWinHandleToggleResult(p){
 try{
  if(!p||typeof p.then!=='function') return;
  p.then(function(r){
   try{
    /* iter25: 后端忙时拒绝切换并提示 */
    try{ if(r&&!r.ok&&String(r.error||'')==='busy'){ try{ aiWinToast('任务进行中，请先停止或等待完成后再切换'); }catch(e){} try{ if(typeof showToast==='function') showToast('任务进行中，请先停止或等待完成后再切换'); }catch(e){} return; } }catch(e){}
    var m='';
    try{ m=String((r&&r.mode)||''); }catch(e){ m=''; }
    if(m==='ai-win'){ try{ setAiWinOpen(true); }catch(e){} }
    else if(m==='ai-panel'){ try{ setAiWinOpen(false); }catch(e){} }
    try{ syncAiWinBtn(); }catch(e){}
    /* B2 打开独立窗后关闭应用内弹窗（仅主窗，防环） */
    if(m==='ai-win'){
     var inAi=false;
     try{ inAi=isAiWinMode(); }catch(e){}
     if(!inAi){
      try{ if(typeof window.closeAi==='function')window.closeAi(); }catch(e){}
      try{ if(typeof closeAi==='function')closeAi(); }catch(e){}
     }
    }
   }catch(e){}
  },function(){});
 }catch(e){}
}
function toggleAiWin(){
 try{
  try{ if(isAiTaskRunning()){ try{ aiWinToast('任务进行中，请先停止或等待完成后再切换'); }catch(e){} try{ if(typeof showToast==='function') showToast('任务进行中，请先停止或等待完成后再切换'); }catch(e){} return; } }catch(e){}
  var __aiDraftCache='';
  try{ __aiDraftCache=getAiDraftText(); }catch(e){ __aiDraftCache=''; }
  var __aiDraftStamp=0;
  try{ __aiDraftStamp=__aiDraftNowTs(); }catch(e){}
  try{
   if(!__aiDraftCache){
    var _lm=null;
    try{ _lm=readAiDraftMirror(); }catch(e){ _lm=null; }
    if(_lm&&_lm.text){ try{ __aiDraftCache=String(_lm.text); }catch(e){} try{ if(Number(_lm.ts||0)) __aiDraftStamp=Number(_lm.ts); }catch(e){} try{ applyAiDraftText(__aiDraftCache); }catch(e){} }
   }
  }catch(e){}
  try{ rememberAiDraft(__aiDraftCache,__aiDraftStamp); }catch(e){}
  var done=false;
  var openArg=null;
  try{
   if(!isAiWinMode()){
    var _proj='';
    try{ _proj=(typeof currentProject!=='undefined')?String(currentProject||''):''; }catch(e){ try{ _proj=String(window.currentProject||''); }catch(e2){} }
    var _proto='';
    try{
     var _cur=null;
     try{ _cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
     if(_cur) _proto=String(_cur.displayName||_cur.name||'');
    }catch(e){}
    try{ _proto=String(_proto||'').replace(/\.(html?|md)$/i,''); }catch(e){}
    if(_proj||_proto) openArg={project:_proj,proto:_proto};
   }
  }catch(e){ openArg=null; }
   var __fromAiWin=false;
   try{ __fromAiWin=isAiWinMode(); }catch(e){}
   /* B3 切回显式标记：aiwin内点切换回弹窗先记reopen，主窗收到才即开 */
   if(__fromAiWin){ try{ aiWinMarkReopen(); }catch(e){} }
   try{
    if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.toggle==='function'){
     var _r0=null;
     try{
      if(openArg&&!isAiWinMode()){ try{ _r0=window.protoAPI.aiwin.toggle(openArg); }catch(e){ try{ _r0=window.protoAPI.aiwin.toggle(); }catch(e2){ _r0=null; } } }
      else{ try{ _r0=window.protoAPI.aiwin.toggle(); }catch(e){ _r0=null; } }
     }catch(e){ _r0=null; }
     try{ __aiWinHandleToggleResult(_r0); }catch(e){}
     done=true;
    }
   }catch(e){}
    if(!done){
     try{
      if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.open==='function'&&!isAiWinMode()){
       var _r1=null;
       try{
        if(openArg){ try{ _r1=window.protoAPI.aiwin.open(openArg); }catch(e){ try{ _r1=window.protoAPI.aiwin.open(); }catch(e2){ _r1=null; } } }
        else{ try{ _r1=window.protoAPI.aiwin.open(); }catch(e){ _r1=null; } }
       }catch(e){ _r1=null; }
       try{ __aiWinHandleToggleResult(_r1); }catch(e){}
       done=true;
      }else if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.close==='function'&&isAiWinMode()){
       try{ aiWinMarkReopen(); }catch(e){}
       var _r2=null;
       try{ _r2=window.protoAPI.aiwin.close(); }catch(e){ _r2=null; }
       try{ __aiWinHandleToggleResult(_r2); }catch(e){}
       done=true;
      }
     }catch(e){}
    }
   try{
    if(done){
     if(__fromAiWin){ try{ sendAiDraftViaMirror(__aiDraftCache,__aiDraftStamp); }catch(e){} try{ pushAiDraftWithRetry(__aiDraftCache,__aiDraftStamp); }catch(e){} }
     else{ try{ pushAiDraftWithRetry(__aiDraftCache,__aiDraftStamp); }catch(e){} }
     /* iter26 关窗竞态：aiwin切回等invoke落定后再调close，500ms超时兜底 */
     try{
      if(__fromAiWin){
       var _wp=null;
       try{ _wp=(_r0&&typeof _r0.then==='function')?_r0:((_r2&&typeof _r2.then==='function')?_r2:null); }catch(e){ _wp=null; }
       if(_wp&&typeof _wp.then==='function'){
        var _settled=false;
        var _to=setTimeout(function(){ if(!_settled){ _settled=true; try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.close==='function') window.protoAPI.aiwin.close(); }catch(e){} } },500);
        try{ _wp.then(function(){ if(!_settled){ _settled=true; try{ clearTimeout(_to); }catch(e){} } },function(){ if(!_settled){ _settled=true; try{ clearTimeout(_to); }catch(e){} try{ if(window.protoAPI&&window.protoAPI.aiwin&&typeof window.protoAPI.aiwin.close==='function') window.protoAPI.aiwin.close(); }catch(e){} } }); }catch(e){ try{ clearTimeout(_to); }catch(e2){} }
       }
      }
     }catch(e){}
    }
   }catch(e){}
  if(!done){ aiWinToast('当前环境不支持独立窗口'); }
  }catch(e){ try{ aiWinToast('当前环境不支持独立窗口'); }catch(e2){} }
}
function getAiWinQueryParams(){
 try{
  var q={project:'',proto:''};
  try{
   if(typeof URLSearchParams!=='undefined'&&location&&location.search){
    var sp=new URLSearchParams(location.search);
    try{ q.project=String(sp.get('project')||''); }catch(e){}
    try{ q.proto=String(sp.get('proto')||''); }catch(e){}
   }else{
    try{
     var s=String((location&&location.search)||'');
     var m=/[?&]project=([^&]*)/.exec(s);
     if(m){ try{ q.project=decodeURIComponent(m[1]||''); }catch(e){ q.project=m[1]||''; } }
     var m2=/[?&]proto=([^&]*)/.exec(s);
     if(m2){ try{ q.proto=decodeURIComponent(m2[1]||''); }catch(e){ q.proto=m2[1]||''; } }
    }catch(e){}
   }
  }catch(e){}
  try{ q.project=String(q.project||'').trim(); }catch(e){ q.project=''; }
  try{ q.proto=String(q.proto||'').trim(); }catch(e){ q.proto=''; }
  return q;
 }catch(e){ return {project:'',proto:''}; }
}
function aiWinFindSource(proto){
 try{
  if(!proto) return null;
  var list=[];
  try{ list=(typeof sources!=='undefined')?sources:[]; }catch(e){ try{ list=window.sources||[]; }catch(e2){ list=[]; } }
  if(!list||!list.length) return null;
  var target=String(proto||'').trim();
  if(!target) return null;
  var noExt=function(v){ try{ return String(v||'').replace(/\.(html?|md)$/i,''); }catch(e){ return String(v||''); } };
  for(var i=0;i<list.length;i++){
   var s=list[i];
   if(!s) continue;
   try{
    var disp=String(s.displayName||''), nm=String(s.name||''), main=String(s.mainHtmlFile||'');
    var dir=String(s.sandboxDir||'');
    var base='';
    try{ var parts=dir.replace(/[\\/]+$/,'').split(/[\\/]/); base=String(parts[parts.length-1]||''); }catch(e){}
    if(disp===target||nm===target||main===target||base===target||dir===target) return s;
    if(noExt(disp)===noExt(target)||noExt(nm)===noExt(target)||noExt(main)===noExt(target)||noExt(base)===noExt(target)) return s;
   }catch(e){}
  }
  return null;
 }catch(e){ return null; }
}
function aiWinScrollChatToBottom(){
 try{
  var inAi=false;
  try{ inAi=isAiWinMode(); }catch(e){ inAi=false; }
  if(!inAi) return;
  var doBottom=function(){
   try{
    var cv=null;
    try{ cv=document.getElementById('aiChatView'); }catch(e){ cv=null; }
    if(!cv){ try{ if(window.aiChatView) cv=window.aiChatView; }catch(e){} }
    if(cv){ try{ cv.scrollTop=cv.scrollHeight; }catch(e){} }
   }catch(e){}
  };
  try{ doBottom(); }catch(e){}
  try{ if(window.requestAnimationFrame){ window.requestAnimationFrame(function(){ try{ doBottom(); }catch(e){} }); } }catch(e){}
  try{ setTimeout(function(){ try{ doBottom(); }catch(e){} },120); }catch(e){}
 }catch(e){}
}
function aiWinSelectProto(proto){
 try{
  if(!proto) return false;
  var found=null;
  try{ found=aiWinFindSource(proto); }catch(e){ found=null; }
  if(found){
   try{
    __docMirrorApplying=true;
    try{
     if(typeof loadSource==='function'){ loadSource(found); }
     else{ try{ currentSource=found; }catch(e){ try{ window.currentSource=found; }catch(e2){} } try { if (typeof window !== 'undefined' && window.Store && typeof window.Store.setCurrentSource === 'function') window.Store.setCurrentSource(found); } catch (e3) {} }
    }catch(e){}
   }finally{ try{ __docMirrorApplying=false; }catch(e){} }
   try{ aiWinSyncTitleSbx(); }catch(e){}
   try{ if(typeof aiEnsureCur==='function') aiEnsureCur(); }catch(e){}
   try{ if(typeof aiRenderBubbles==='function') aiRenderBubbles(); }catch(e){}
   try{ if(typeof aiSaveSesh==='function') aiSaveSesh(); }catch(e){}
   try{ aiWinScrollChatToBottom(); }catch(e){}
   return true;
  }
  try{
   if(typeof loadSandboxSources==='function'){
    var curProj='';
    try{ curProj=(typeof currentProject!=='undefined')?currentProject:''; }catch(e){ try{ curProj=window.currentProject||''; }catch(e2){} }
    if(curProj){
     try{ loadSandboxSources(proto, true); }catch(e){}
     return true;
    }
   }
  }catch(e){}
  return false;
 }catch(e){ return false; }
}
function aiWinSyncTitleSbx(){
 try{
  var proj='';
  try{ proj=(typeof currentProject!=='undefined')?String(currentProject||''):''; }catch(e){ try{ proj=String(window.currentProject||''); }catch(e2){} }
  var src=null;
  try{ src=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ try{ src=window.currentSource||null; }catch(e2){} }
  var label='';
  try{ if(src){ label=String(src.displayName||src.name||''); label=label.replace(/\.(html?|md)$/i,''); } }catch(e){}
  try{
   if(label) document.title='AI对话 · '+(proj?proj+' / ':'')+label;
   else if(proj) document.title='AI对话 · '+proj;
   else document.title='AI对话 · 原型工具';
  }catch(e){}
  try{ if(typeof aiRenderSbx==='function'){ aiRenderSbx(); } }catch(e){}
  try{
   var el=null;
   try{ el=document.getElementById('aiSbx'); }catch(e){ el=null; }
   if(el&&src){
    try{
     var d='';
     try{ d=String(src.sandboxDir||''); }catch(e){}
     var nm='';
     try{ nm=String(src.displayName||src.name||'').replace(/\.(html?|md)$/i,''); }catch(e){}
     if(nm) el.textContent='沙箱：'+nm;
     if(d) el.title='当前沙箱（模型工作目录）：'+d;
     el.className='ai-cli ok';
    }catch(e){}
   }
  }catch(e){}
 }catch(e){}
}
function applyAiWinCloseGuard(){
 try{
  var c=null;
  try{ c=document.getElementById('aiClose'); }catch(e){ c=null; }
  if(c){
   try{ c.style.display='none'; }catch(e){}
   try{ c.setAttribute('aria-hidden','true'); }catch(e){}
   try{ c.onclick=function(e){ try{ if(e&&e.preventDefault) e.preventDefault(); }catch(err){} }; }catch(e){}
  }
 }catch(e){}
  try{
   var inAi=false;
   try{ inAi=isAiWinMode(); }catch(e){ inAi=false; }
   /* Wave-D/G: window.closeAi monkey-patch 已删除（SoC修复）。独立窗禁关经 EventBus ai:request-close
    * + __aiWinCloseGuard 标志由 AiDomain.requestClose 统一执行；此处仅隐藏占位 + 订阅守卫，不再写 window.closeAi。 */
   try { if (typeof window !== 'undefined') window.__aiWinCloseGuard = !!inAi; } catch (e) {}
   try {
     if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.on === 'function' && !window.__aiWinGuardSubscribed) {
       window.EventBus.on('ai:request-close', function () {
         try { if (typeof isAiWinMode === 'function' && isAiWinMode()) return false; } catch (e) {}
       });
       window.__aiWinGuardSubscribed = true;
     }
   } catch (e) {}
   try { if (typeof MirrorSync !== 'undefined' && MirrorSync && typeof MirrorSync.requestAiClose === 'function' && inAi) { /* 桥接占位，无裸挂 */ } } catch (e2) {}
  }catch(e){}
}
function applyAiWinLockSwitchers(){
 try{
  var inAi=false;
  try{ inAi=isAiWinMode(); }catch(e){ inAi=false; }
  if(!inAi) return;
  var ids=['sbProject','sbList','btnAddSource','btnAddGroup','btnSettings','sbTrigger','btnSbCollapse'];
  for(var i=0;i<ids.length;i++){
   try{
    var el=document.getElementById(ids[i]);
    if(el){
     try{ el.style.display='none'; }catch(e){}
     try{ el.setAttribute('aria-hidden','true'); }catch(e){}
     try{ if('disabled' in el) el.disabled=true; }catch(e){}
    }
   }catch(e){}
  }
  try{
   var sp=document.getElementById('sbProject');
   if(sp&&!sp._aiWinLocked){
    sp._aiWinLocked=true;
    try{ sp.onclick=function(e){ try{ if(e&&e.preventDefault) e.preventDefault(); }catch(err){} }; }catch(e){}
   }
  }catch(e){}
  try{ var pm=document.getElementById('projMask'); if(pm) pm.style.display='none'; }catch(e){}
 }catch(e){}
}
function aiWinGuardProjectPicker(){
 try{
  var inAi=false;
  try{ inAi=isAiWinMode(); }catch(e){ inAi=false; }
  if(!inAi) return;
  try{ var pm0=document.getElementById('projMask'); if(pm0) pm0.style.display='none'; }catch(e){}
  try{
   var orig=null;
   try{ orig=window.showProjectPicker; }catch(e){ orig=null; }
   if(typeof orig==='function'&&!orig._aiWinGuarded){
    var guarded=function(projects,last){
     try{
      var inAi2=false;
      try{ inAi2=isAiWinMode(); }catch(e){ inAi2=false; }
      if(inAi2){
       try{
        var qp=null;
        try{ qp=getAiWinQueryParams(); }catch(e){ qp=null; }
        var target='';
        try{ if(qp&&qp.project) target=qp.project; }catch(e){}
        if(!target){ try{ target=last||''; }catch(e){} }
        if(!target){
         try{
          var arr=(projects||[]).slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'zh-CN'); });
          if(arr.length) target=arr[0].name;
         }catch(e){}
        }
        if(target&&typeof enterProject==='function'){ try{ enterProject(target); }catch(e){} return; }
        try{ var pm2=document.getElementById('projMask'); if(pm2) pm2.style.display='none'; }catch(e){}
        return;
       }catch(e){
        try{ var pm3=document.getElementById('projMask'); if(pm3) pm3.style.display='none'; }catch(e2){}
        return;
       }
      }
     }catch(e){}
     try{ return orig.apply(this,arguments); }catch(e){}
    };
    try{ guarded._aiWinGuarded=true; }catch(e){}
    try{ window.showProjectPicker=guarded; }catch(e){}
   }
  }catch(e){}
 }catch(e){}
}
function aiWinBootProject(){
 try{
  try{ aiWinGuardProjectPicker(); }catch(e){}
  try{ var pm=document.getElementById('projMask'); if(pm) pm.style.display='none'; }catch(e){}
  var qp=null;
  try{ qp=getAiWinQueryParams(); }catch(e){ qp={project:'',proto:''}; }
  var qproj='', qproto='';
  try{ qproj=String((qp&&qp.project)||'').trim(); }catch(e){}
  try{ qproto=String((qp&&qp.proto)||'').trim(); }catch(e){}
  if(qproj){
   try{
    if(typeof enterProject==='function'){ try{ enterProject(qproj); }catch(e){} }
    else{
     try{ currentProject=qproj; }catch(e){ try{ window.currentProject=qproj; }catch(e2){} }
     try{ if(typeof updateProjectBar==='function') updateProjectBar(); }catch(e){}
     try{ if(typeof loadSandboxSources==='function') loadSandboxSources(qproto||undefined, true); }catch(e){}
    }
   }catch(e){}
   if(qproto){
    try{
     setTimeout(function(){ try{ aiWinSelectProto(qproto); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },600);
     setTimeout(function(){ try{ aiWinSelectProto(qproto); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },1500);
    }catch(e){}
   }else{
    try{ setTimeout(function(){ try{ aiWinSyncTitleSbx(); }catch(e){} },600); }catch(e){}
   }
   try{ setTimeout(function(){ try{ aiWinSyncTitleSbx(); }catch(e){} },2000); }catch(e){}
   return;
  }
  var last='';
  try{ last=String(localStorage.getItem('protoLastProject')||''); }catch(e){}
  if(last){
   try{
    if(typeof enterProject==='function'){ try{ enterProject(last); }catch(e){} }
    else{
     try{ currentProject=last; }catch(e){ try{ window.currentProject=last; }catch(e2){} }
     try{ if(typeof updateProjectBar==='function') updateProjectBar(); }catch(e){}
     try{ if(typeof loadSandboxSources==='function') loadSandboxSources(qproto||undefined, true); }catch(e){}
    }
   }catch(e){}
   if(qproto){
    try{
     setTimeout(function(){ try{ aiWinSelectProto(qproto); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },600);
     setTimeout(function(){ try{ aiWinSelectProto(qproto); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },1500);
    }catch(e){}
   }else{
    try{ setTimeout(function(){ try{ aiWinSyncTitleSbx(); }catch(e){} },600); }catch(e){}
   }
   return;
  }
  try{
   var hasSrc=false;
   try{ var lst=(typeof sources!=='undefined')?sources:[]; hasSrc=!!(lst&&lst.length); }catch(e){ try{ var lst2=window.sources||[]; hasSrc=!!(lst2&&lst2.length); }catch(e2){} }
   if(hasSrc){
    try{
     var cur=null;
     try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ try{ cur=window.currentSource||null; }catch(e2){} }
     if(!cur){
      try{
       var l2=(typeof sources!=='undefined')?sources:[];
       if(!l2||!l2.length){ try{ l2=window.sources||[]; }catch(e){} }
       if(l2&&l2.length){
        __docMirrorApplying=true;
        try{ if(typeof loadSource==='function') loadSource(l2[0]); }catch(e){}
        try{ __docMirrorApplying=false; }catch(e){}
       }
      }catch(e){ try{ __docMirrorApplying=false; }catch(e2){} }
     }
    }catch(e){}
    try{ aiWinSyncTitleSbx(); }catch(e){}
    return;
   }
  }catch(e){}
  try{ if(typeof bootProjectFlow==='function'){ try{ bootProjectFlow(); }catch(e){} } }catch(e){}
  try{ setTimeout(function(){ try{ aiWinSyncTitleSbx(); }catch(e){} try{ var pm2=document.getElementById('projMask'); if(pm2&&pm2.style.display!=='none'){ try{ pm2.style.display='none'; }catch(e){} } }catch(e){} },800); }catch(e){}
 }catch(e){}
}
function getAiSourcePayload(){
 try{
  var proj='';
  try{ proj=(typeof currentProject!=='undefined')?String(currentProject||''):''; }catch(e){ try{ proj=String(window.currentProject||''); }catch(e2){} }
  var nm='', disp='', proto='';
  try{
   var cur=null;
   try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ try{ cur=window.currentSource||null; }catch(e2){} }
   if(cur){
    try{ nm=String(cur.name||''); }catch(e){}
    try{ disp=String(cur.displayName||cur.name||''); }catch(e){}
    try{
     if(cur.sandboxDir){
      var d=String(cur.sandboxDir).replace(/[\\/]+$/,'');
      var parts=d.split(/[\\/]/);
      proto=String(parts[parts.length-1]||disp||nm);
     }else{ proto=disp||nm; }
    }catch(e){ try{ proto=disp||nm; }catch(e2){} }
    try{ if(!proto) proto=disp||nm; }catch(e){}
   }
  }catch(e){}
  return {project:proj,proto:String(disp||proto||nm||''),sourceName:nm,displayName:disp};
 }catch(e){ return {project:'',proto:'',sourceName:'',displayName:''}; }
}
function pushAiSource(){
 try{
  if(__docMirrorApplying) return;
  try{ if(isAiWinMode()) return; }catch(e){ return; }
  var p=null;
  try{ p=getAiSourcePayload(); }catch(e){ p={}; }
  try{ mirrorPush('ai-source',p||{}); }catch(e){}
 }catch(e){}
}
function bootAiWinMode(){
 try{ document.title='AI对话 · 原型工具'; }catch(e){}
 try{ restoreAiDraftFromMirror(); }catch(e){}
 try{ if(document.body) document.body.classList.add('aiwin-mode'); }catch(e){}
 try{ ensureAiWinUI(); }catch(e){}
 try{ syncAiWinBtn(); }catch(e){}
 try{ applyAiWinCloseGuard(); }catch(e){}
 try{ applyAiWinLockSwitchers(); }catch(e){}
 try{ aiWinBootProject(); }catch(e){}
 try{
  var opened=false;
  try{
   if(typeof openAi==='function'){ openAi(); opened=true; }
   else if(typeof openAiDesign==='function'){ openAiDesign(); opened=true; }
  }catch(e){}
  if(!opened){
   try{
    var m=document.getElementById('aiMask');
    if(m) m.style.display='flex';
   }catch(e){}
  }
 }catch(e){}
 try{ syncAiWinBtn(); }catch(e){}
 try{ applyAiWinCloseGuard(); }catch(e){}
 try{ applyAiWinLockSwitchers(); }catch(e){}
 try{ aiWinSyncTitleSbx(); }catch(e){}
  setTimeout(function(){
  try{
   var m2=document.getElementById('aiMask');
   if(m2&&(m2.style.display==='none'||!m2.style.display)){
    try{
     if(typeof openAi==='function'){ openAi(); }
     else{ m2.style.display='flex'; }
    }catch(e){}
   }
  }catch(e){}
  try{ syncAiWinBtn(); }catch(e){}
  try{ applyAiWinCloseGuard(); }catch(e){}
  try{ applyAiWinLockSwitchers(); }catch(e){}
  try{ aiWinSyncTitleSbx(); }catch(e){}
  try{ aiWinScrollChatToBottom(); }catch(e){}
 },800);
 setTimeout(function(){
  try{ applyAiWinCloseGuard(); }catch(e){}
  try{ applyAiWinLockSwitchers(); }catch(e){}
  try{ aiWinSyncTitleSbx(); }catch(e){}
  try{ syncAiWinBtn(); }catch(e){}
  try{ aiWinScrollChatToBottom(); }catch(e){}
 },1500);
 /* iter26: 监听挂上且启动完成后主动pull一次，先读缓存再等镜像 */
 try{ setTimeout(function(){ try{ restoreAiDraftFromMirror(); }catch(e){} try{ sendAiDraftPull(); }catch(e){} },900); }catch(e){}
 try{ aiWinScrollChatToBottom(); }catch(e){}
}
function applyDocWinPanelMode(dwMode){
 try{
  if(dwMode!=='panel'&&dwMode!=='win') return;
  var inWin=false;
  try{ inWin=isDocWinMode(); }catch(e){ inWin=false; }
  if(inWin) return;
  var isPc=false;
  try{ isPc=(typeof pcMode==='function'&&pcMode()); }catch(e){ isPc=false; }
  try{ if(!isPc&&document.body&&document.body.classList.contains('kind-pc')) isPc=true; }catch(e){}
  var docsOpen=false, reqUiOpen=false, inReq=false;
  try{ docsOpen=!!(document.body&&document.body.classList.contains('docs-open')); }catch(e){ docsOpen=false; }
  try{
   if(typeof reqOpen!=='undefined'&&reqOpen) reqUiOpen=true;
   else if(window.reqOpen) reqUiOpen=true;
   else if(document.body&&document.body.classList.contains('req-open')) reqUiOpen=true;
  }catch(e){ reqUiOpen=false; }
  try{ inReq=getDocReqState(); }catch(e){ inReq=false; }
  if(dwMode==='panel'){
   if(docsOpen||reqUiOpen) return;
   __docMirrorApplying=true;
   try{
     if(isPc){
      try{
       if(inReq){ if(typeof switchDocTab==='function')switchDocTab(true); }
       else if(typeof setDocsOpen==='function')setDocsOpen(true);
       else if(document.body&&document.body.classList)document.body.classList.add('docs-open');
      }catch(e){}
    }else{
     try{
      if(typeof setDocsOpen==='function') setDocsOpen(true);
      else if(document.body&&document.body.classList) document.body.classList.add('docs-open');
     }catch(e){}
    }
   }finally{ __docMirrorApplying=false; }
  }else{
   if(!docsOpen&&!reqUiOpen) return;
   __docMirrorApplying=true;
   try{
    try{
     if(docsOpen){
      if(typeof setDocsOpen==='function') setDocsOpen(false);
      else if(document.body&&document.body.classList) document.body.classList.remove('docs-open');
     }
    }catch(e){}
    try{
     if(reqUiOpen){
      if(typeof setReqOpen==='function') setReqOpen(false);
      else if(document.body&&document.body.classList) document.body.classList.remove('req-open');
     }
    }catch(e){}
   }finally{ __docMirrorApplying=false; }
  }
 }catch(e){ try{ __docMirrorApplying=false; }catch(e2){} }
}
function __docWinHandleToggleResult(p){
 try{
  if(!p||typeof p.then!=='function') return;
  p.then(function(r){
   try{
    /* iter25: 后端忙时拒绝切换并提示 */
    try{ if(r&&!r.ok&&String(r.error||'')==='busy'){ try{ docWinToast('任务进行中，请先停止或等待完成后再切换'); }catch(e){} try{ if(typeof showToast==='function') showToast('任务进行中，请先停止或等待完成后再切换'); }catch(e){} return; } }catch(e){}
    var m='';
    try{ m=String((r&&r.mode)||''); }catch(e){ m=''; }
    var inW=false;
    try{ inW=isDocWinMode(); }catch(e){}
    if(m==='win'){ try{ setDocWinOpen(true); }catch(e){} }
    else if(m==='panel'){ try{ setDocWinOpen(false); }catch(e){} }
    /* B5 切回显式打开（仅主窗toggle处理器内显式触发，防环经__docMirrorApplying；窗内不碰） */
    if(!inW&&(m==='panel'||m==='win')){
     try{ applyDocWinPanelMode(m); }catch(e){}
    }
    try{ syncDocWinBtn(); }catch(e){}
    try{ syncDocModeTabs(); }catch(e){}
   }catch(e){}
  },function(){});
 }catch(e){}
}
function handleDocMirror(msg){
 try{
  if(!msg||typeof msg!=='object') return;
  var kind=String(msg.kind||msg.type||'');
  if(!kind) return;
  var payload=null;
  try{ payload=(msg.payload&&typeof msg.payload==='object')?msg.payload:((msg.data&&typeof msg.data==='object')?msg.data:{}); }catch(e){ payload={}; }
  if(!payload||typeof payload!=='object') payload={};
  if(kind==='content'){
   __docMirrorApplying=true;
   try{
    var wantReq=false;
    try{ wantReq=!!payload.reqMode; }catch(e){}
    var md='';
    try{ md=String(payload.md==null?'':payload.md); }catch(e){}
    try{
     if(typeof reqMode!=='undefined'){ reqMode=wantReq; }
     else if(window){ window.reqMode=wantReq; }
    }catch(e){}
    try{ if(typeof exitEdit==='function') exitEdit(); }catch(e){}
    try{ if(typeof closeToc==='function') closeToc(); }catch(e){}
    if(wantReq){
     try{ reqText=md; }catch(e){ try{ window.reqText=md; }catch(e2){} }
     try{ if(docTitleEl) docTitleEl.textContent='最新需求 · 当前迭代'; }catch(e){}
     try{ if(docContentEl) docContentEl.innerHTML=renderMd(md||'# 最新需求\n\n（暂无内容）'); }catch(e){}
    }else{
     try{
      var cur=null;
      try{ cur=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){}
      if(cur&&md){
       try{ cur.md=md; }catch(e){}
       try{ if(!cur.docs) cur.docs={}; cur.docs['default']=md; }catch(e){}
      }
     }catch(e){}
     var ttl='';
     try{ ttl=String(payload.title||''); }catch(e){}
     try{
      if(docTitleEl){
       if(ttl) docTitleEl.textContent=ttl;
       else if(typeof docTitleFor==='function') docTitleEl.textContent=docTitleFor('功能说明');
       else if(typeof protoTitle==='function') docTitleEl.textContent=protoTitle();
      }
     }catch(e){}
     try{ if(docContentEl) docContentEl.innerHTML=renderMd(md); }catch(e){}
     try{ if(typeof refreshToc==='function') refreshToc(); }catch(e){}
    }
    try{ syncDocModeTabs(); }catch(e){}
    try{ syncDocWinBtn(); }catch(e){}
   }finally{ __docMirrorApplying=false; }
   }else if(kind==='source'){
    __docMirrorApplying=true;
    try{
     var nm='';
     try{ nm=String(payload.sourceName||payload.name||payload.displayName||''); }catch(e){}
     var projHint='';
     try{ projHint=String(payload.project||''); }catch(e){}
     var protoHint='';
     try{ protoHint=String(payload.proto||''); }catch(e){}
     if(!nm&&protoHint){ try{ nm=protoHint; }catch(e){} }
     var inAiS=false;
     try{ inAiS=isAiWinMode(); }catch(e){ inAiS=false; }
     if(inAiS&&projHint){
      var curProjS='';
      try{ curProjS=(typeof currentProject!=='undefined')?String(currentProject||''):''; }catch(e){ try{ curProjS=String(window.currentProject||''); }catch(e2){} }
      if(curProjS&&projHint!==curProjS){
       try{
        if(typeof enterProject==='function'){ enterProject(projHint); }
        else{
         try{ currentProject=projHint; }catch(e){ try{ window.currentProject=projHint; }catch(e2){} }
         try{ if(typeof updateProjectBar==='function') updateProjectBar(); }catch(e){}
         try{ if(typeof loadSandboxSources==='function') loadSandboxSources(protoHint||nm||undefined, true); }catch(e){}
        }
       }catch(e){}
       var _pp=protoHint||nm;
       if(_pp){
        try{
         (function(pp){
          setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },600);
          setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },1500);
         })(_pp);
        }catch(e){}
       }
       try{ aiWinSyncTitleSbx(); }catch(e){}
       try{ syncAiWinBtn(); }catch(e){}
       try{ syncDocModeTabs(); }catch(e){}
       return;
      }else if(!curProjS){
       try{
        if(typeof enterProject==='function'){ enterProject(projHint); }
        else{
         try{ currentProject=projHint; }catch(e){ try{ window.currentProject=projHint; }catch(e2){} }
         try{ if(typeof updateProjectBar==='function') updateProjectBar(); }catch(e){}
         try{ if(typeof loadSandboxSources==='function') loadSandboxSources(protoHint||nm||undefined, true); }catch(e){}
        }
       }catch(e){}
       var _pp2=protoHint||nm;
       if(_pp2){
        try{
         (function(pp){
          setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },600);
          setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },1500);
         })(_pp2);
        }catch(e){}
       }
       try{ aiWinSyncTitleSbx(); }catch(e){}
       try{ syncAiWinBtn(); }catch(e){}
       return;
      }
     }
     var wantR=null;
     try{ if(payload.reqMode!=null) wantR=!!payload.reqMode; }catch(e){}
     if(wantR!=null){
      try{
       if(typeof reqMode!=='undefined') reqMode=wantR;
       else if(window) window.reqMode=wantR;
      }catch(e){}
     }
     var found=null;
     try{
      var list=[];
      try{ list=(typeof sources!=='undefined')?sources:[]; }catch(e){}
      for(var i=0;i<(list||[]).length;i++){
       var s=list[i];
       if(!s) continue;
       try{
        if(String(s.name||'')===nm||String(s.displayName||'')===nm||String(s.displayName||s.name||'')===nm){ found=s; break; }
       }catch(e){}
      }
      if(!found&&protoHint){
       for(var j=0;j<(list||[]).length;j++){
        var s2=list[j];
        if(!s2) continue;
        try{
         var cand=String(s2.displayName||s2.name||'');
         var candNo=String(cand||'').replace(/\.(html?|md)$/i,'');
         var hintNo=String(protoHint||'').replace(/\.(html?|md)$/i,'');
         if(cand===protoHint||candNo===hintNo){ found=s2; break; }
        }catch(e){}
       }
      }
     }catch(e){}
      if(found){
       try{
        var orig=null;
        try{ orig=window.loadSource&&window.loadSource._docwinOrig?window.loadSource._docwinOrig:null; }catch(e){}
        if(orig) orig(found);
        else if(typeof loadSource==='function') loadSource(found);
       }catch(e){}
       var tt2=curSourceTitle();
       try{ if(isDocWinMode()&&tt2) document.title='文档 · '+tt2; }catch(e){}
       try{ if(inAiS){ aiWinSyncTitleSbx(); } }catch(e){}
       try{ if(inAiS&&typeof aiEnsureCur==='function') aiEnsureCur(); }catch(e){}
       try{ if(inAiS&&typeof aiRenderBubbles==='function') aiRenderBubbles(); }catch(e){}
       try{ if(inAiS&&typeof aiSaveSesh==='function') aiSaveSesh(); }catch(e){}
       try{
        var _inDoc=false;
        try{ _inDoc=isDocWinMode(); }catch(e){ _inDoc=false; }
        if(_inDoc&&!inAiS){ try{ if(typeof loadDesc==='function') loadDesc(); }catch(e){} try{ if(typeof refreshToc==='function') refreshToc(); }catch(e){} }
       }catch(e){}
      }else if(nm){
      try{ if(typeof loadSandboxSources==='function') loadSandboxSources(nm, true); }catch(e){}
      if(inAiS&&protoHint){
       try{
        (function(pp){
         setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },800);
        })(protoHint);
       }catch(e){}
      }
     }
     try{ syncDocModeTabs(); }catch(e){}
     try{ syncDocWinBtn(); }catch(e){}
     try{ if(inAiS){ syncAiWinBtn(); } }catch(e){}
    }finally{ __docMirrorApplying=false; }
   }else if(kind==='ai-source'){
    var inAi2=false;
    try{ inAi2=isAiWinMode(); }catch(e){ inAi2=false; }
    if(!inAi2){
     return;
    }
    __docMirrorApplying=true;
    try{
     var proj2='';
     try{ proj2=String(payload.project||''); }catch(e){}
     var proto2='';
     try{ proto2=String(payload.proto||payload.displayName||payload.sourceName||''); }catch(e){}
     var curProj2='';
     try{ curProj2=(typeof currentProject!=='undefined')?String(currentProject||''):''; }catch(e){ try{ curProj2=String(window.currentProject||''); }catch(e2){} }
     var curSrc2=null;
     try{ curSrc2=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ try{ curSrc2=window.currentSource||null; }catch(e2){} }
     var curLabel2='';
     try{ if(curSrc2) curLabel2=String(curSrc2.displayName||curSrc2.name||''); }catch(e){}
     var norm2=function(v){ try{ return String(v||'').replace(/\.(html?|md)$/i,'').trim(); }catch(e){ return ''; } };
     if(proj2&&curProj2&&proj2!==curProj2){
      try{
       if(typeof enterProject==='function'){ enterProject(proj2); }
       else{
        try{ currentProject=proj2; }catch(e){ try{ window.currentProject=proj2; }catch(e2){} }
        try{ if(typeof updateProjectBar==='function') updateProjectBar(); }catch(e){}
        try{ if(typeof loadSandboxSources==='function') loadSandboxSources(proto2||undefined, true); }catch(e){}
       }
      }catch(e){}
      if(proto2){
       try{
        (function(pp){
         setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },600);
         setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },1500);
        })(proto2);
       }catch(e){}
      }
     }else if(proj2&&!curProj2){
      try{
       if(typeof enterProject==='function'){ enterProject(proj2); }
       else{
        try{ currentProject=proj2; }catch(e){ try{ window.currentProject=proj2; }catch(e2){} }
        try{ if(typeof updateProjectBar==='function') updateProjectBar(); }catch(e){}
        try{ if(typeof loadSandboxSources==='function') loadSandboxSources(proto2||undefined, true); }catch(e){}
       }
      }catch(e){}
      if(proto2){
       try{
        (function(pp){
         setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },600);
         setTimeout(function(){ try{ aiWinSelectProto(pp); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} },1500);
        })(proto2);
       }catch(e){}
      }
     }else{
      if(proto2&&norm2(proto2)!==norm2(curLabel2)){
       try{
        if(!aiWinSelectProto(proto2)){
         try{ if(typeof loadSandboxSources==='function'&&curProj2){ loadSandboxSources(proto2); } }catch(e){}
        }
       }catch(e){}
      }
     }
     try{ aiWinSyncTitleSbx(); }catch(e){}
     try{ syncAiWinBtn(); }catch(e){}
     try{ if(typeof aiEnsureCur==='function') aiEnsureCur(); }catch(e){}
     try{ if(typeof aiRenderBubbles==='function') aiRenderBubbles(); }catch(e){}
     try{ if(typeof aiSaveSesh==='function') aiSaveSesh(); }catch(e){}
    }finally{ try{ __docMirrorApplying=false; }catch(e2){} }
   }else if(kind==='saved'){
   __docMirrorApplying=true;
   try{
    var inReq=false;
    try{ inReq=getDocReqState(); }catch(e){}
    if(inReq){
     try{
      if(typeof renderReqIntoDocs==='function') renderReqIntoDocs();
      else{
       var rt='';
       try{ rt=String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){}
       if(docTitleEl) docTitleEl.textContent='最新需求 · 当前迭代';
       if(docContentEl) docContentEl.innerHTML=renderMd(rt||'# 最新需求\n\n（暂无内容）');
      }
     }catch(e){}
    }else{
     try{ if(typeof loadDesc==='function') loadDesc(); }catch(e){}
    }
    try{ syncDocModeTabs(); }catch(e){}
   }finally{ __docMirrorApplying=false; }
   }else if(kind==='mode'){
    try{
     if(payload.reqMode!=null){
      var w2=!!payload.reqMode;
      var cur2=false;
      try{ cur2=getDocReqState(); }catch(e){}
      if(w2!==cur2){
       __docMirrorApplying=true;
       try{
        try{
         if(typeof reqMode!=='undefined') reqMode=w2;
         else if(window) window.reqMode=w2;
        }catch(e){}
        try{ if(typeof exitEdit==='function') exitEdit(); }catch(e){}
        if(w2){
         try{
          if(typeof renderReqIntoDocs==='function') renderReqIntoDocs();
          else{
           var r2='';
           try{ r2=String((typeof reqText!=='undefined'?reqText:'')||''); }catch(e){}
           if(docTitleEl) docTitleEl.textContent='最新需求 · 当前迭代';
           if(docContentEl) docContentEl.innerHTML=renderMd(r2||'# 最新需求\n\n（暂无内容）');
          }
         }catch(e){}
        }else{
         try{ if(typeof loadDesc==='function') loadDesc(); }catch(e){}
        }
       }finally{ __docMirrorApplying=false; }
      }
     }
      var dwMode='';
      try{
       if(payload&&payload.mode!=null) dwMode=String(payload.mode||'');
       else if(msg&&msg.mode!=null) dwMode=String(msg.mode||'');
      }catch(e){ dwMode=''; }
      /* B5 反转旧panel即开：mode事件只同步文案，不自动开/收；显式切回经reopen才开（toggle处理器内已显式apply，防环） */
      if(dwMode==='win'){ try{ setDocWinOpen(true); }catch(e){} }
      else if(dwMode==='panel'){ try{ setDocWinOpen(false); }catch(e){} }
      var __reopen=false;
      try{
       if(payload&&payload.reopen)__reopen=true;
       else if(msg&&msg.reopen)__reopen=true;
       else if(typeof localStorage!=='undefined'&&localStorage.getItem('docWinReopen')==='1')__reopen=true;
      }catch(e){}
      if(__reopen){
       try{ localStorage.removeItem('docWinReopen'); }catch(e){}
       var inW2=false;
       try{ inW2=isDocWinMode(); }catch(e){}
       if(!inW2&&dwMode==='panel'){
        try{ applyDocWinPanelMode(dwMode); }catch(e){}
       }
      }
     }catch(e){ try{ __docMirrorApplying=false; }catch(e2){} }
     try{ syncDocModeTabs(); }catch(e){}
     try{ syncDocWinBtn(); }catch(e){}
    }else if(kind==='ai-mode'){
     try{
      var am='';
      try{ am=String((payload&&payload.mode)||(msg&&msg.mode)||''); }catch(e){ am=''; }
      if(am==='ai-win'){ try{ setAiWinOpen(true); }catch(e){} }
      else if(am==='ai-panel'){ try{ setAiWinOpen(false); }catch(e){} }
      try{ syncAiWinBtn(); }catch(e){}
      var __aiRe=false;
      try{
       if(payload&&payload.reopen)__aiRe=true;
       else if(msg&&msg.reopen)__aiRe=true;
       else if(typeof localStorage!=='undefined'&&localStorage.getItem('aiWinReopen')==='1')__aiRe=true;
      }catch(e){}
      if(__aiRe){
       try{ localStorage.removeItem('aiWinReopen'); }catch(e){}
       var inAi3=false;
       try{ inAi3=isAiWinMode(); }catch(e){}
       if(!inAi3&&(am==='ai-panel'||!am)){
        try{ openAiForSwitchBack(); }catch(e){}
       }
      }
     }catch(e){}
    }else if(kind==='ai-draft'){
     try{
      var _dt='';
      try{ _dt=String((payload&&payload.text!=null?payload.text:(msg&&msg.text!=null?msg.text:''))||''); }catch(e){ _dt=''; }
      var _dts=0;
      try{ _dts=Number((payload&&payload.ts!=null?payload.ts:(msg&&msg.ts!=null?msg.ts:0))||0)||0; }catch(e){ _dts=0; }
      try{
       if(_dts&&_dts<__aiDraftLastRecvTs){ try{ sendAiDraftAck(_dts); }catch(e){} }
       else{
        try{ if(_dts>__aiDraftLastRecvTs) __aiDraftLastRecvTs=_dts; }catch(e){}
        try{ rememberAiDraft(_dt,_dts||__aiDraftNowTs()); }catch(e){}
        try{ setAiDraftWithRetry(_dt,_dts||__aiDraftNowTs()); }catch(e){}
        try{ sendAiDraftAck(_dts||__aiDraftLastRecvTs); }catch(e){}
       }
      }catch(e){}
     }catch(e){}
    }else if(kind==='ai-draft-pull'){
     try{
      var _isAi=false;
      try{ _isAi=isAiWinMode(); }catch(e){ _isAi=false; }
      if(!_isAi){
       var _bestT='';
       try{ _bestT=getAiDraftText(); }catch(e){ _bestT=''; }
       var _bestTs=0;
       try{ _bestTs=__aiDraftNowTs(); }catch(e){ _bestTs=0; }
       try{
        var _pt='';
        try{ _pt=String((typeof __aiDraftPendingText!=='undefined'?__aiDraftPendingText:'')||''); }catch(e){}
        if(!_pt){ try{ _pt=String(window.__aiDraftPendingText||''); }catch(e){} }
        var _pts=0;
        try{ _pts=Number((typeof __aiDraftPendingTs!=='undefined'?__aiDraftPendingTs:0)||0)||0; }catch(e){}
        if(!_pts){ try{ _pts=Number(window.__aiDraftPendingTs||0)||0; }catch(e){} }
        if(_pt&&(!_bestT||_pts>=_bestTs)){ _bestT=_pt; _bestTs=_pts||_bestTs; }
       }catch(e){}
       try{
        var _lm=null;
        try{ _lm=readAiDraftMirror(); }catch(e){ _lm=null; }
        if(_lm&&_lm.text&&Number(_lm.ts||0)>_bestTs){ _bestT=_lm.text; _bestTs=Number(_lm.ts); }
       }catch(e){}
       try{ if(_bestT||_bestTs) sendAiDraftViaMirror(_bestT,_bestTs||__aiDraftNowTs()); }catch(e){}
      }
     }catch(e){}
    }else if(kind==='ai-draft-ack'){
     try{
      var _ats=0;
      try{ _ats=Number((payload&&payload.ts!=null?payload.ts:(msg&&msg.ts!=null?msg.ts:0))||0)||0; }catch(e){ _ats=0; }
      try{ if(_ats>__aiDraftAckedTs) __aiDraftAckedTs=_ats; }catch(e){}
      try{ window.__aiDraftAckedTs=__aiDraftAckedTs; }catch(e){}
      try{ if(_ats&&_ats>=__aiDraftRetryTs){ try{ __aiDraftClearRetry(); }catch(e){} } }catch(e){}
     }catch(e){}
    }else if(kind==='ai-busy-restore'){
     try{ restoreAiBusyInMain(); }catch(e){}
    }
 }catch(e){}
}
function registerDocMirrorListener(){
 try{
  var cands=[['doc','onMirror'],['doc','onDocMirror'],['docwin','onMirror'],['docwin','onDocMirror'],['aiwin','onMirror'],['','onDocMirror'],['','onMirror']];
  for(var i=0;i<cands.length;i++){
   try{
    var o=cands[i][0], f=cands[i][1], fn=null;
    if(!o){ try{ fn=window.protoAPI&&window.protoAPI[f]; }catch(e){ fn=null; } }
    else{ try{ fn=window.protoAPI&&window.protoAPI[o]&&window.protoAPI[o][f]; }catch(e){ fn=null; } }
    if(typeof fn==='function'){
     try{ fn.call((o&&window.protoAPI)?window.protoAPI[o]:window.protoAPI,function(d){ try{ handleDocMirror(d); }catch(e){} }); }catch(e){}
     break;
    }
   }catch(e){}
  }
 }catch(e){}
 try{
  var bc=null;
  try{ bc=docMirrorBC(); }catch(e){ bc=null; }
  if(bc&&!bc._docWinBound){
   bc._docWinBound=true;
   bc.onmessage=function(ev){
    try{ handleDocMirror(ev&&ev.data); }catch(e){}
   };
  }
 }catch(e){}
}
function wrapGlobalFn(fname,makeWrapper){
 try{
  if(__docWinWrapped[fname]) return true;
  var cur=null;
  try{ cur=window[fname]; }catch(e){ cur=null; }
  if(typeof cur!=='function') return false;
  try{ if(cur._docwinWrapped) { __docWinWrapped[fname]=cur; return true; } }catch(e){}
  var wrapped=null;
  try{ wrapped=makeWrapper(cur); }catch(e){ return false; }
  if(typeof wrapped!=='function') return false;
  try{ wrapped._docwinWrapped=true; }catch(e){}
  try{ wrapped._docwinOrig=cur; }catch(e){}
  try{ window[fname]=wrapped; }catch(e){ return false; }
  __docWinWrapped[fname]=cur;
  return true;
 }catch(e){ return false; }
}
function wrapDocWinPushers(){
 try{
  wrapGlobalFn('loadDesc',function(orig){
   return function(){
    var r=null;
    try{ r=orig.apply(this,arguments); }catch(e){ throw e; }
    try{
     if(!__docMirrorApplying&&!isDocWinMode()){
      var p=null;
      try{ p=getContentPayload(); }catch(e){ p={}; }
      try{ mirrorPush('content',p); }catch(e){}
     }
    }catch(e){}
    try{ syncDocModeTabs(); }catch(e){}
    return r;
   };
  });
 }catch(e){}
 try{
  wrapGlobalFn('setReqModeMobile',function(orig){
   return function(on){
    var r=null;
    try{ r=orig.apply(this,arguments); }catch(e){ throw e; }
    try{
     if(!__docMirrorApplying){
      var w=false;
      try{ w=getDocReqState(); }catch(e){}
      if(isDocWinMode()){ try{ mirrorBack('mode',{reqMode:w}); }catch(e){} }
      else{ try{ mirrorPush('mode',{reqMode:w}); }catch(e){} }
     }
    }catch(e){}
    try{ syncDocModeTabs(); }catch(e){}
    try{ syncDocWinBtn(); }catch(e){}
    return r;
   };
  });
 }catch(e){}
  try{
   wrapGlobalFn('loadSource',function(orig){
    return function(src,keep){
     var r=null;
     try{ r=orig.apply(this,arguments); }catch(e){ throw e; }
     try{
      if(!__docMirrorApplying){
       if(isDocWinMode()){
        try{
         var t=curSourceTitle();
         if(t) document.title='文档 · '+t;
        }catch(e){}
       }else{
        var p=null;
        try{ p=getSourcePayload(); }catch(e){ p={}; }
        try{ mirrorPush('source',p); }catch(e){}
        try{
         var inAiL=false;
         try{ inAiL=isAiWinMode(); }catch(e){ inAiL=false; }
         if(!inAiL){ try{ pushAiSource(); }catch(e){} }
         else{ try{ aiWinSyncTitleSbx(); }catch(e){} }
        }catch(e){}
       }
       try{
        var inAiL2=false;
        try{ inAiL2=isAiWinMode(); }catch(e){ inAiL2=false; }
        if(inAiL2){ try{ aiWinSyncTitleSbx(); }catch(e){} }
       }catch(e){}
      }
     }catch(e){}
     try{ syncDocModeTabs(); }catch(e){}
     try{ syncDocWinBtn(); }catch(e){}
     try{ syncAiWinBtn(); }catch(e){}
     return r;
    };
   });
  }catch(e){}
  try{
   wrapGlobalFn('enterProject',function(orig){
    return function(name){
     var r=null;
     try{ r=orig.apply(this,arguments); }catch(e){ throw e; }
     try{
      if(!__docMirrorApplying){
       var inAiE=false;
       try{ inAiE=isAiWinMode(); }catch(e){ inAiE=false; }
       if(!inAiE){ try{ pushAiSource(); }catch(e){} }
       else{ try{ aiWinSyncTitleSbx(); }catch(e){} }
      }
     }catch(e){}
     return r;
    };
   });
  }catch(e){}
  try{
   wrapGlobalFn('loadSubPage',function(orig){
    return function(s,sub){
     var r=null;
     try{ r=orig.apply(this,arguments); }catch(e){ throw e; }
     try{
      if(!__docMirrorApplying){
       var inAiS2=false;
       try{ inAiS2=isAiWinMode(); }catch(e){ inAiS2=false; }
       if(!inAiS2){ try{ pushAiSource(); }catch(e){} }
       else{ try{ aiWinSyncTitleSbx(); }catch(e){} }
      }
     }catch(e){}
     return r;
    };
   });
  }catch(e){}
 function wrapSaveFn(fname){
  try{
   wrapGlobalFn(fname,function(orig){
    return function(){
     var r=null;
     try{ r=orig.apply(this,arguments); }catch(e){ throw e; }
     try{
      if(!__docMirrorApplying){
       if(isDocWinMode()){
        var sp=null;
        try{ sp=getSourcePayload(); }catch(e){ sp={}; }
        try{ mirrorBack('saved',sp); }catch(e){}
       }else{
        var cp=null;
        try{ cp=getContentPayload(); }catch(e){ cp={}; }
        try{ mirrorPush('content',cp); }catch(e){}
       }
      }
     }catch(e){}
     try{ syncDocModeTabs(); }catch(e){}
     return r;
    };
   });
  }catch(e){}
 }
 try{ wrapSaveFn('saveDocInPlace'); }catch(e){}
 try{ wrapSaveFn('mdTaskToggle'); }catch(e){}
 try{ wrapSaveFn('saveDocMicroPop'); }catch(e){}
 try{ wrapSaveFn('saveReqEditDocs'); }catch(e){}
 try{ wrapSaveFn('saveReqEdit'); }catch(e){}
 try{ wrapSaveFn('saveEdit'); }catch(e){}
}
function initDocWinFeature(){
 try{ ensureDocModeUI(); }catch(e){}
 try{ ensureAiWinUI(); }catch(e){}
 try{ syncDocWinBtn(); }catch(e){}
 try{ syncAiWinBtn(); }catch(e){}
 try{ syncDocModeTabs(); }catch(e){}
 try{ registerDocMirrorListener(); }catch(e){}
 try{ wrapDocWinPushers(); }catch(e){}
 try{ docWinGuardProjectPicker(); }catch(e){}
 try{ if(isDocWinMode()){ try{ var __pm=document.getElementById('projMask'); if(__pm)__pm.style.display='none'; }catch(e){} } }catch(e){}
 try{
  if(isAiWinMode()){ bootAiWinMode(); }
  else if(isDocWinMode()){ bootDocWinMode(); }
 }catch(e){}
 setTimeout(function(){
  try{ ensureDocModeUI(); }catch(e){}
  try{ ensureAiWinUI(); }catch(e){}
  try{ wrapDocWinPushers(); }catch(e){}
  try{ registerDocMirrorListener(); }catch(e){}
  try{ syncDocWinBtn(); }catch(e){}
  try{ syncAiWinBtn(); }catch(e){}
  try{ syncDocModeTabs(); }catch(e){}
  try{ if(isDocWinMode()){ try{ syncDocWinBtn(); }catch(e){} } }catch(e){}
  try{ if(isAiWinMode()){ try{ syncAiWinBtn(); }catch(e){} try{ applyAiWinCloseGuard(); }catch(e){} try{ applyAiWinLockSwitchers(); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} } }catch(e){}
 },600);
 setTimeout(function(){
  try{ wrapDocWinPushers(); }catch(e){}
  try{ ensureDocModeUI(); }catch(e){}
  try{ ensureAiWinUI(); }catch(e){}
  try{ if(isAiWinMode()){ try{ applyAiWinCloseGuard(); }catch(e){} try{ applyAiWinLockSwitchers(); }catch(e){} try{ aiWinSyncTitleSbx(); }catch(e){} } }catch(e){}
 },1500);
}
try{ window.isDocWinMode=isDocWinMode; }catch(e){}
try{ window.bootDocWinMode=bootDocWinMode; }catch(e){}
try{ window.isAiWinMode=isAiWinMode; }catch(e){}
try{ window.bootAiWinMode=bootAiWinMode; }catch(e){}
try{ window.toggleAiWin=toggleAiWin; }catch(e){}
try{ window.syncAiWinBtn=syncAiWinBtn; }catch(e){}
try{ window.ensureAiWinUI=ensureAiWinUI; }catch(e){}
try{ window.getAiWinQueryParams=getAiWinQueryParams; }catch(e){}
try{ window.aiWinSyncTitleSbx=aiWinSyncTitleSbx; }catch(e){}
try{ window.getAiSourcePayload=getAiSourcePayload; }catch(e){}
try{ window.pushAiSource=pushAiSource; }catch(e){}
try{ window.applyAiWinCloseGuard=applyAiWinCloseGuard; }catch(e){}
try{ window.applyAiWinLockSwitchers=applyAiWinLockSwitchers; }catch(e){}
try{ window.mirrorPush=mirrorPush; }catch(e){}
try{ window.mirrorBack=mirrorBack; }catch(e){}
try{ window.handleDocMirror=handleDocMirror; }catch(e){}
try{ window.toggleDocWin=toggleDocWin; }catch(e){}
try{ window.switchDocTab=switchDocTab; }catch(e){}
try{ window.syncDocWinBtn=syncDocWinBtn; }catch(e){}
try{ window.syncDocModeTabs=syncDocModeTabs; }catch(e){}
try{ window.ensureDocModeUI=ensureDocModeUI; }catch(e){}
try{ window.getDocWinQueryParams=getDocWinQueryParams; }catch(e){}
try{ window.docWinSelectProto=docWinSelectProto; }catch(e){}
try{ window.docWinBootProject=docWinBootProject; }catch(e){}
try{ window.docWinGuardProjectPicker=docWinGuardProjectPicker; }catch(e){}
try{ window.openAiForSwitchBack=openAiForSwitchBack; }catch(e){}
try{ window.openDocsForSwitchBack=openDocsForSwitchBack; }catch(e){}
try{ window.setAiWinOpen=setAiWinOpen; }catch(e){}
try{ window.setDocWinOpen=setDocWinOpen; }catch(e){}
try{ window.isAiTaskRunning=isAiTaskRunning; }catch(e){}
try{ window.getAiDraftText=getAiDraftText; }catch(e){}
try{ window.applyAiDraftText=applyAiDraftText; }catch(e){}
try{ window.setAiDraftWithRetry=setAiDraftWithRetry; }catch(e){}
try{ window.sendAiDraftViaMirror=sendAiDraftViaMirror; }catch(e){}
try{ window.pushAiDraftWithRetry=pushAiDraftWithRetry; }catch(e){}
try{ window.readAiDraftMirror=readAiDraftMirror; }catch(e){}
try{ window.writeAiDraftMirror=writeAiDraftMirror; }catch(e){}
try{ window.rememberAiDraft=rememberAiDraft; }catch(e){}
try{ window.restoreAiDraftFromMirror=restoreAiDraftFromMirror; }catch(e){}
try{ window.sendAiDraftAck=sendAiDraftAck; }catch(e){}
try{ window.sendAiDraftPull=sendAiDraftPull; }catch(e){}
try{ window.restoreAiBusyInMain=restoreAiBusyInMain; }catch(e){}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',initDocWinFeature); }
else{ try{ initDocWinFeature(); }catch(e){} }
