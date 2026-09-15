/* [js/nav-zoom.js] 导航联动 + 标题推断 + 舞台缩放（由 app.js 拆分，顺序勿乱调） */
/* Wave-C/F: ESM 显式依赖收敛 (utils.showToast 显式 import, 消灭隐式全局);
 * 其余跨文件符号 ($/docContentEl/AnnotationEngine/fitPhone 被调) 过渡期经 window 只读,
 * 待 core-docs 等巨石 ESM 化后 (Wave-D) 转为 import。 */
/* FIX: 经典<script>加载，禁用ESM import(整文件罢工)。utils为type=module延迟执行，
 * 经典脚本先行，用内联回退+window.Utils双保险。 */
function showToast(msg) { try { if (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) return window.Utils.showToast(msg); } catch (e) {} try { if (typeof libStatus === 'function') { libStatus(msg); return; } } catch (e2) {} try { alert(msg); } catch (e3) {} return null; }
/* 由路由推断可读标题（通用）：取路由末段；页面章节标题一律优先 md 的 pageTitles，
    缺失时回退路由 key 本身（不再维护内置原型的硬编码映射表） */
/* ═══════ 静态解析源文件页面：提取原型页面路由清单（仅供导航联动与按页占位，不在左栏展示） ═══════
 规则：页面容器 id(page-*) 与 hash 路由串，排除弹窗/侧栏/嵌入（sheet/picker/delete） */
function extractPages(content){
 var s=String(content||'');var pages=[];var seen={};
 function add(p){ if(!p||seen[p])return; seen[p]=1; pages.push(p); }
 var m;
 /* A) #-锚定的 hash 路由 token（如 #page-chat、#detail/LV、href="#form/.."） */
 var reA=/#([A-Za-z][A-Za-z0-9_\-\/]*)/gi;
 while((m=reA.exec(s))){
  var r=m[1].replace(/\?.*$/,'');
  if(/^(page-|detail|form|doc|list|chat|proj|fund|report)/i.test(r)) add(r);
 }
 /* B) 页面根容器：switchRoot/push/showPage 的参数（page-xxx） */
 var reB=/(?:switchRoot|push|showPage)\(\s*['"](page-[a-z]+)['"]\s*\)/gi;
 while((m=reB.exec(s))) add(m[1]);
 return pages;
}

/* 文档定位：滚动到指定标题（目录点击定位用） */
function docScrollWrap(){ return docContentEl.closest('.docs-body')||docContentEl.parentElement||docContentEl; }
function scrollDocTo(el){
 var wrap=docScrollWrap();
 try{
  var wb=wrap.getBoundingClientRect(),tb=el.getBoundingClientRect();
  wrap.scrollTop=wrap.scrollTop+(tb.top-wb.top)-Math.round(wrap.clientHeight*0.18);
 }catch(e){}
}
/* ═══════ 舞台展示：原型壳按窗口适配（宽、高双向），内容缩放只作用于内容 ═══════ */
var BW=620,BH=1000;
var CONTENT_SCALE=(function(){try{var v=parseFloat(localStorage.getItem('contentZoom'));if(!isNaN(v)&&v>0&&v<=3)return v;}catch(e){}return 0.85;})();
function clampZoom(v){ return Math.max(0.2,Math.min(3,parseFloat(v)||1)); }
var zoomInputEl=$('zoomInput');
var zoomSelectEl=$('zoomSelect');
var ZOOM_PRESETS=[50,75,85,90,100,125,150];
function syncZoomUI(){
 if(zoomInputEl)zoomInputEl.value=Math.round(CONTENT_SCALE*100);
 if(zoomSelectEl){
  var cur=Math.round(CONTENT_SCALE*100);
  zoomSelectEl.value=ZOOM_PRESETS.indexOf(cur)>=0?String(cur):'';
 }
}
function setContentZoom(v,persist){
 CONTENT_SCALE=clampZoom(v);
 if(persist!==false){ try{localStorage.setItem('contentZoom',String(CONTENT_SCALE));}catch(e){} }
 syncZoomUI();
 fitPhone();
}
function setIframeScaled(ifr,vw,vh,Z){ if(!ifr)return; ifr.style.position='absolute'; ifr.style.left='0'; ifr.style.top='0'; ifr.style.width=(vw/Z)+'px'; ifr.style.height=(vh/Z)+'px'; ifr.style.transform='scale('+Z+')'; ifr.style.transformOrigin='left top'; }
function fitPhone(){
 var sf=$('stageFrame'),h=$('phoneHolder'),w=$('phoneWrap');
 if(!sf||!h||!w)return;
 var ifr=w?w.querySelector('iframe'):null;
 var Z=CONTENT_SCALE;
 if(document.body.classList.contains('kind-pc')){ /* PC 端：壳=舞台全幅，内容按 Z 缩放 */
  var vw=Math.max(sf.clientWidth-40,100), vh=Math.max(sf.clientHeight-40,100);
  h.style.width=''; h.style.height='';
  w.style.width=vw+'px'; w.style.height=vh+'px';
  w.style.borderRadius='14px';
  w.style.transform='';
  setIframeScaled(ifr,vw,vh,Z);
  sf.style.overflow='auto';
  if(window.AnnotationEngine && typeof AnnotationEngine.renderAnnotationBadges==='function') AnnotationEngine.renderAnnotationBadges();
  return;
 }
 var pad=36;
 /* 壳宽、高双向适配窗口，保证完整可见（用户缩放不改变壳尺寸） */
 var s=Math.min((sf.clientHeight-pad)/BH,(sf.clientWidth-2*pad)/BW,1);
 s=Math.max(s,0.3);
 var vw=BW*s, vh=BH*s;
 h.style.width=vw+'px';
 h.style.height=vh+'px';
 w.style.width=vw+'px';
 w.style.height=vh+'px';
 w.style.borderRadius=Math.max(10,Math.round(40*s))+'px';
 w.style.transform=''; /* 壳本身无缩放 */
 setIframeScaled(ifr,vw,vh,Z);
 /* 超出舞台时允许滚动 */
 var needScroll=(vw>sf.clientWidth-2*pad+1)||(vh>sf.clientHeight-pad+1);
 sf.style.overflow=needScroll?'auto':'hidden';
 if(window.AnnotationEngine && typeof AnnotationEngine.renderAnnotationBadges==='function') AnnotationEngine.renderAnnotationBadges();
}
window.addEventListener('resize',fitPhone);
/* Ctrl+滚轮：微调内容缩放；双击舞台：复位 100% */
window.addEventListener('wheel',function(e){
 if(document.body.classList.contains('ctrl-inspecting'))return;
 if(!e.ctrlKey)return;
 if(!e.target||!$('stageFrame').contains(e.target))return;
 e.preventDefault();
 var dy=Math.sign(e.deltaY);
 var steps=Math.abs(e.deltaY)>40?2:1;
 setContentZoom(CONTENT_SCALE-Math.sign(dy)*0.05*steps);
},{passive:false});
$('stageFrame').addEventListener('dblclick',function(){setContentZoom(1);});
/* 缩放输入框：Enter 或失焦(点击其他区域)生效；仅数字，视为百分比 */
function applyZoomFromInput(){
 var raw=String(zoomInputEl?zoomInputEl.value:'').replace(/[^0-9.]/g,'');
 var n=parseFloat(raw);
 if(isNaN(n)||n<=0){ try{ showToast('缩放值需大于0'); }catch(e){} if(zoomInputEl)zoomInputEl.value=Math.round(CONTENT_SCALE*100); return; }
 setContentZoom(n/100);
}
if(zoomInputEl){
 zoomInputEl.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); applyZoomFromInput(); zoomInputEl.blur(); } });
 zoomInputEl.addEventListener('blur',applyZoomFromInput);
}
if(zoomSelectEl){
 zoomSelectEl.addEventListener('change',function(){
  var v=parseFloat(zoomSelectEl.value);
  if(!isNaN(v)&&v>0) setContentZoom(v/100);
 });
}
syncZoomUI();

/* FIX: 经典<script>加载，移除ESM export(以window挂载为准) */
/* ---- 经典兼容垫片 (Wave-D 移除) ---- */
try {
 if (typeof window !== 'undefined') {
  if (!window.extractPages) window.extractPages = extractPages;
  if (!window.fitPhone) window.fitPhone = fitPhone;
  if (!window.setContentZoom) window.setContentZoom = setContentZoom;
  if (!window.syncZoomUI) window.syncZoomUI = syncZoomUI;
 }
} catch (e) {}
