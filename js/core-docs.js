/* [js/core-docs.js] 核心：文档解析/渲染/编辑 + 功能说明面板 + 目录（TOC）（由 app.js 拆分，顺序勿乱调） */

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
/* 整篇文档文本：直接读取纯净 Markdown 原文 */
function fullDocMd(src){ return getDocMd(src||currentSource); }
function persistDocs(){ if(!currentSource)return; var k=sourceDocKey(currentSource); var md=currentSource.md; var prev=persistDocsTimer.get(k); if(prev)clearTimeout(prev); persistDocsTimer.set(k,setTimeout(function(){ persistDocsTimer.delete(k); safeStorage.set(k,md); },300)); }
/* 沙箱源：把纯净文档写回原型文件夹同名 md */
function sandboxMdFile(){ if(!currentSource)return null; return currentSource.mdFile||(String(currentSource.name||'原型').replace(/\.(html?)$/i,'')+'.md'); }
function persistSandboxDoc(){
 if(!(window.protoAPI&&window.protoAPI.sandbox)||!currentSource||!currentSource.sandboxDir)return;
 var f=sandboxMdFile(); if(!f)return;
 var txt=currentSource.md||'';
 window.protoAPI.sandbox.write({dir:currentSource.sandboxDir,file:f,content:txt}).then(function(r){
  if(r&&r.ok)libStatus('文档已保存到沙箱：'+f);
  else if(r&&r.error)libStatus('文档写入沙箱失败（已存本地缓存，请检查目录权限）');
 });
}
/* 编辑内容（整篇 md）直接持久化，不篡改、不强制添加路由与标题前缀 */
function applyEditText(md){
 if(!currentSource)return;
 currentSource.md=String(md||'');
 if(!currentSource.docs)currentSource.docs={};
 currentSource.docs['default']=currentSource.md;
 persistDocs();
 persistSandboxDoc();
}
function exitEdit(){editOn=false;editHash=null;docEditEl.style.display='none';docContentEl.style.display='';if(btnEditDoc)btnEditDoc.textContent=' 编辑';if(btnEditDoc)btnEditDoc.disabled=false;if(btnCancelDoc)btnCancelDoc.style.display='none';if(btnSaveDoc)btnSaveDoc.style.display='none';}
function enterEdit(){
 if(reqMode){ /* 移动端：编辑最新需求文档 */
  editOn=true; editHash='__req__';
  docContentEl.style.display='none';
  docEditEl.style.display='flex';
  docEditArea.value=reqText;
  if(btnEditDoc){btnEditDoc.textContent='编辑中…';btnEditDoc.disabled=true;}
  if(btnCancelDoc)btnCancelDoc.style.display='';
  if(btnSaveDoc)btnSaveDoc.style.display='';
  docEditArea.focus();
  return;
 }
 flushEdit();
 editOn=true; editHash='__doc__';
 docContentEl.style.display='none';
 docEditEl.style.display='flex';
 docEditArea.value=fullDocMd();
 if(btnEditDoc){btnEditDoc.textContent='编辑中…';btnEditDoc.disabled=true;}
 if(btnCancelDoc)btnCancelDoc.style.display='';
 if(btnSaveDoc)btnSaveDoc.style.display='';
 docEditArea.focus();
}
function saveEdit(){
 if(reqMode){ saveReqEditDocs(); return; }
 if(!editOn)return;
 applyEditText(docEditArea.value);
 exitEdit();
 loadDesc(); /* 保存后重新渲染说明 */
}
function cancelEdit(){
 if(!editOn)return;
 if(reqMode){ exitEdit(); setReqModeMobile(true); return; }
 exitEdit();
 loadDesc();
}
function flushEdit(){ /* 切换源时自动保存未提交修改 */
 if(reqMode){ exitEdit(); return; } /* 最新需求编辑：切走时不自动保存（保存靠按钮） */
 if(!editOn)return;
 applyEditText(docEditArea.value);
 exitEdit();
}
if(btnEditDoc)btnEditDoc.onclick=enterEdit;
if(btnSaveDoc)btnSaveDoc.onclick=saveEdit;
if(btnCancelDoc)btnCancelDoc.onclick=cancelEdit;

/* 轻量 Markdown 渲染：支持表格(H2/H3 标题)、加粗、无序/有序列表、代码块、<br> 等 */
function escHtml(s){return String(s).replace(/\&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function inline(s){
 s=escHtml(s);
 /* 保留 PRD 内有意使用的 HTML 换行与必填标记 */
 s=s.replace(/&lt;br&gt;/g,'<br>').replace(/&lt;i&gt;/g,'<i>').replace(/&lt;\/i&gt;/g,'</i>');
 s=s.replace(/&lt;font\b([^>]*?)&gt;/gi,'<font$1>').replace(/&lt;\/font&gt;/gi,'</font>');
 s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
 return s;
}
function renderMd(md){
 if(!md)return '<div class="doc-empty">本页面功能说明待提供，将在此补充。</div>';
 var lines=String(md).split('\n');
 var html=[],i=0;
 function flushTable(buf){
 if(!buf.length)return;
 var rows=buf.map(function(r){return r.replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();});});
 var head=rows[0], body=rows.slice(1);
 var th='<tr>'+head.map(function(c){return '<th>'+inline(c)+'</th>';}).join('')+'</tr>';
 var td=body.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+inline(c)+'</td>';}).join('')+'</tr>';}).join('');
 html.push('<table class="md-table"><thead>'+th+'</thead><tbody>'+td+'</tbody></table>');
 }
 var tbuf=[],inCode=false,codeBuf=[];
 while(i<lines.length){
  var l=lines[i];
  /* 跳过 HTML 注释行（含「原型绑定」注释，不渲染为正文） */
  if(/^\s*<!--/.test(l)){
   while(i<lines.length&&lines[i].indexOf('-->')<0)i++;
   i++; continue;
  }
  var tri=/^```/.test(l);
  if(tri){flushTable(tbuf);tbuf=[];if(inCode){html.push('<pre>'+escHtml(codeBuf.join('\n'))+'</pre>');codeBuf=[];}inCode=!inCode;i++;continue;}
  if(inCode){codeBuf.push(l);i++;continue;}
   var h=/^(#{1,6})\s+(.*)$/.exec(l.trim());
   if(h){flushTable(tbuf);tbuf=[];var lvl=h[1].length;html.push('<h'+(lvl)+' class="md-h">'+inline(h[2])+'</h'+(lvl)+'>');i++;continue;}
 var tblSep=/^\|[\s\-:|]+\|$/.test(l)&&/^\|/.test(l);
 if(/^\|/.test(l)){
 if(tblSep){i++;continue;} // 跳过表头分隔行
 tbuf.push(l);i++;continue;
 }
 if(tbuf.length){flushTable(tbuf);tbuf=[];}
 if(/^\s*[-*] /.test(l)){html.push('<li>'+inline(l.replace(/^\s*[-*] /,''))+'</li>');i++;continue;}
 if(/^\s*\d+\. /.test(l)){html.push('<li>'+inline(l.replace(/^\s*\d+\. /,''))+'</li>');i++;continue;}
 if(l.trim()===''){html.push('<div class="md-para"></div>');i++;continue;}
 html.push('<p>'+inline(l)+'</p>');
 i++;
 }
 flushTable(tbuf);
 if(inCode&&codeBuf.length)html.push('<pre>'+escHtml(codeBuf.join('\n'))+'</pre>');
 return html.join('\n');
}
function loadDesc(){
 reqMode=false; /* 换源：切回功能说明（移动端右侧面板显示模式） */
 flushEdit(); /* 切换源时自动保存编辑中的内容 */
 docTitleEl.textContent=protoTitle(); /* 功能说明标题：固定显示当前原型名称 */
 docContentEl.innerHTML=renderMd(fullDocMd()); /* 整篇渲染：一次展示全部章节，目录点击仅定位 */
 refreshToc();
}
/* ═══════ 文档目录：解析 Markdown 大小标题，展开/收起目录列表 ═══════ */
function extractHeadings(md){
  var hs=[];var lines=String(md||'').split('\n');
  var inCode=false;
  for(var i=0;i<lines.length;i++){
    var l=lines[i];
    if(/^\s*<!--/.test(l)){
      while(i<lines.length&&lines[i].indexOf('-->')<0)i++;
      continue;
    }
    if(/^```/.test(l)){ inCode=!inCode; continue; }
    if(inCode) continue;
    var m=/^(#{1,6})\s+(.*)$/.exec(l.trim());
    if(m){ hs.push({level:m[1].length, text:m[2].trim().replace(/\*\*/g,'').replace(/`/g,'')}); }
  }
  return hs;
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
}
/* ═══════ 目录浮窗：定位 + 展开/收起 + 点击外部自动收起 ═══════
  移动端：位于功能说明面板内顶部（原位置）；
  PC 端：位于功能说明弹窗左侧紧挨、高度与弹窗相同 */
var docTocEl=$('docToc'),btnTocEl=$('btnToc');
function tocOpen(){ return !!(docTocEl&&docTocEl.style.display!=='none'); }
function closeToc(){ if(docTocEl)docTocEl.style.display='none'; }
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
      try{ if(typeof scrollDocTo==='function') scrollDocTo(target); }catch(err){}
      flashTitle(target);  /* 该行蓝色背景闪烁两次 */
    }
    closeToc();          /* 无论是否找到元素均关闭目录弹窗 */
  });
}
function positionToc(){
 if(!docTocEl)return;
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
}
if(btnTocEl)btnTocEl.onclick=function(){
 if(tocOpen())closeToc(); else openToc();
};
/* 点击目录外部任意位置 → 自动收起（含移动端）；点击目录内部或按钮本身不触发 */
document.addEventListener('pointerdown',function(e){
 if(!tocOpen())return;
 if(docTocEl&&docTocEl.contains(e.target))return;
 if(btnTocEl&&btnTocEl.contains(e.target))return;
 closeToc();
},true);
/* 窗口尺寸变化时重算目录浮窗位置 */
window.addEventListener('resize',function(){ if(tocOpen())positionToc(); });
