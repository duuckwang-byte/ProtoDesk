/* [js/sandbox-core.js] 状态声明 + 端别 + 原型加载 + 源列表与虚拟分组（由 app.js 拆分，顺序勿乱调） */
/* ═══════ 左侧源文件列表栏 ═══════
 列表项 = 沙箱原型文件夹（html + md）。全部以 srcdoc 注入 iframe；
 「新增原型」导入的文件先进沙箱再打开。 */
/* Wave-C/F: ESM 显式依赖 (escHtml/showToast 经 utils 显式 import; Store/EventBus 显式 import;
 * 帧侧 Agent 模板以 sandbox-agent.js 为准, 本地内嵌副本仅作 file:// 降级回退)。
 * stripped-classic 降级: import 行剥离后裸调用回退 window 全局。 */
/* FIX: 经典<script>加载，禁用ESM import(整文件罢工)。utils/store为type=module延迟执行，
 * 经典脚本先行：escHtml/showToast用内联回退+window.Utils双保险；Store经window.Store只读
 * (模块就绪后回写window，见store.js垫片)。_SbStore/_sbBus保留typeof守卫兼容(未定义时安全跳过)。 */
var escHtml = (typeof window !== 'undefined' && window.escHtml) || (typeof window !== 'undefined' && window.Utils && window.Utils.escHtml) || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var showToast = (typeof window !== 'undefined' && window.showToast) || (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) || function (msg) { try { if (typeof libStatus === 'function') { libStatus(msg); return; } } catch (e) {} try { alert(msg); } catch (e2) {} return null; };
var sources = [];
var currentSource = null;
var currentProject = ''; /* 当前窗口进入的项目（一个窗口只展示一个项目） */
var sbListEl = $('sbList');
/* 基础示意图标助手：PlanBIcon 不可用时回退基础字符，避免报错 */
function sIco(name, fallback) {
  try { if (window.PlanBIcon) { var svg = window.PlanBIcon(name, 13); if (svg) return svg; } } catch (e) {}
  return fallback || '';
}
var btnAddSourceEl = $('btnAddSource');
var kindSegEl=$('kindSeg');
var btnKindMobileEl=$('btnKindMobile'), btnKindPcEl=$('btnKindPc');
var btnSbCollapseEl=$('btnSbCollapse'), sbTriggerEl=$('sbTrigger'), docsFabEl=$('docsFab');

/* ═══════ 端别推断：根据 HTML 内容启发式判定移动端/PC 端 ═══════ */
function detectKind(html){
 var s=String(html||'');
 var vp=/<meta[^>]*name=["']?viewport["']?[^>]*>/i.exec(s);
 var vpMobile=!!(vp&&/width\s*=\s*device-width/i.test(vp[0]));
 var score=0;
 if(vpMobile) score+=2; /* 移动视口 */
 if(/@media\s*\(\s*max-width/i.test(s)) score+=1; /* 移动优先自适应 */
 if(/(iphone|ipad|android|touch-action|-webkit-tap-highlight|device-width|user-scalable)/i.test(s)) score+=1;
 if(/@media\s*\(\s*min-width:\s*(6[4-9]\d|7\d\d|8\d\d|9\d\d|1[0-2]\d\d)/i.test(s)) score-=2; /* 明显桌面断点 */
 return score>0 ? 'mobile' : 'pc';
}

/* ═══════ 端别判定（供新增原型时记录）：文件名优先，其次按内容启发式 ═══════
  文件名含「移动」→ 移动端；含「PC/pc」→ PC 端；两者均无 → 回退 detectKind 内容推断 */
function detectKindByName(name, content){
 var n=String(name||'');
 if(/移动/.test(n)) return 'mobile';
 if(/\bpc\b/i.test(n.replace(/[-_]/g,' '))) return 'pc';
 return detectKind(content);
}

/* ═══════ 应用当前源的展示模式（端别） ═══════ */
var bodyB=document.body;
function pcMode(){ return bodyB.classList.contains('kind-pc'); }
function applyKind(openPanels){
 var kind=(currentSource&&currentSource.kind)||'mobile';
 reqMode=false; /* 端别切换：右侧文档面板回到功能说明（移动端显示模式） */
 var body=bodyB;
 body.classList.toggle('kind-pc', kind==='pc');
 body.classList.toggle('kind-mobile', kind==='mobile');
  if(openPanels===false){
   /* 仅切换展示方式（不换数据源）：不改变当前开合状态 */
  }else{
   /* 切换/首次加载数据源：保持菜单栏当前开合状态（用户展开后不自动关闭，直到手动收起） */
   if(docsMaskEl) docsMaskEl.style.display='none';
   if(kind==='mobile'){
     body.classList.add('docs-open'); /* 移动端右侧文档面板常显 */
   }else{
     body.classList.remove('docs-open'); /* PC 端文档面板默认收起（按需以弹窗打开） */
   }
  }
  if(sbMaskEl) sbMaskEl.style.display='none'; /* 菜单栏为内嵌 Docked 布局，无需遮罩 */
 closeToc(); /* 端别/源切换时同步收起目录浮窗 */
 if(kind==='mobile') body.classList.remove('sb-collapsed');
  /* 顶部端别分段控件 */
  if(btnKindMobileEl)btnKindMobileEl.classList.toggle('on', kind!=='pc');
 if(btnKindPcEl)btnKindPcEl.classList.toggle('on', kind==='pc');
 fitPhone();
}

/* 手动切换端别（修正自动识别）：不自动弹出面板 */
function setKind(k){
 if(!currentSource)return;
 currentSource.kind=k;
 applyKind(false);
 renderSourceList();
 persistLibrary();
}

function loadSource(src, keepPanels){
  /* 切源前先把待写草稿按旧作用域落盘（防500ms定时器把旧文本写到新原型键下串沙箱） */
  try{
    if(typeof draftTimer!=='undefined'&&draftTimer){
      try{ clearTimeout(draftTimer); }catch(e){}
      try{ if(typeof writeDraft==='function')writeDraft((typeof reqMode!=='undefined')?reqMode:false); }catch(e2){}
    }
  }catch(e){}
  try{ draftTimer=null; }catch(e3){}
  /* 显式切换原型时收掉需求输入条（拾取属于旧原型；静默刷新不收） */
  try{
    if(keepPanels!=='preserve'&&keepPanels!==true&&!(typeof window!=='undefined'&&window.__aiQuietRefresh===true)){
      if(typeof CTRL_PICK!=='undefined'&&CTRL_PICK&&typeof CTRL_PICK.clear==='function')CTRL_PICK.clear();
      if(typeof CTRL_PICK!=='undefined'&&CTRL_PICK&&typeof CTRL_PICK.hideFab==='function')CTRL_PICK.hideFab();
    }
  }catch(e4){}
  currentSource = src;
  /* Wave-C/F: 切换经 Store 版本化 (快照守卫的 ver 基准; Store 回写 window 保持经典互操作) */
  try { if (typeof window !== 'undefined' && window.Store && window.Store.setCurrentSource) window.Store.setCurrentSource(src); } catch (e) {}
  try { if (typeof _SbStore !== 'undefined' && _SbStore && _SbStore.setCurrentSource && (typeof window === 'undefined' || !window.Store)) _SbStore.setCurrentSource(src); } catch (e2) {}
  // fix refresh preserve: preserve activeSubFile on preserve/quiet refresh
  if(src && keepPanels!=='preserve' && keepPanels!==true && window.__aiQuietRefresh!==true){ src.activeSubFile = src.mainHtmlFile || src.name; }
  if(window.LinkBind)LinkBind.closeInspector(); /* 切换原型：收起编辑浮窗与高亮 */
  if(window.AnnotationEngine && typeof AnnotationEngine.closeAll === 'function') AnnotationEngine.closeAll();
  editHideHover();
  loadSourceDocs(src); /* 装载本源文档（沙箱源 md 已解析，此处补本地编辑覆盖） */
  if(window.AnnotationEngine && typeof AnnotationEngine.loadAnnotations === 'function') AnnotationEngine.loadAnnotations(src.sandboxDir);
  if(!src.pages){ src.pages = extractPages(src.content||''); }
  src.curPage = src.curPage || ((src.pages&&src.pages[0])||'page-chat');
  if(src.method==='srcdoc'){
    /* P0-A: 经受限协议封装后再注入，附加 iframe 侧桥接 Agent，不再允许同源直访 */
    frame.setAttribute('srcdoc', sandboxSecureSrcdoc(src.content, { links: src._links||[], mode: false, from: src.displayName||src.name }));
  }else{
    /* 旧版恢复的 method:'src' 源：有内容时回退 srcdoc 注入，避免空白 */
    if(src.content){ frame.setAttribute('srcdoc', sandboxSecureSrcdoc(src.content, { links: src._links||[], mode: false, from: src.displayName||src.name })); }
    else{ if(frame.hasAttribute('srcdoc')) frame.removeAttribute('srcdoc'); frame.setAttribute('src','about:blank'); }
  }
  document.title = '原型预览 · ' + src.displayName;
  applyKind(keepPanels===true?false:undefined); /* AI 刷新等后台更新：不自动弹开面板 */
  if(locEl) locEl.textContent = protoTitle();
  loadDesc();
  var bExp = $('btnExportPureHtml');
  if(bExp) bExp.disabled = !(src && src.content);
  renderSourceList();
}

/* ═══════ 虚拟分组（文件夹）：对原型分类整理，不创建真实目录 ═══════
   数据存 localStorage（protoGroups_v1），沙箱磁盘结构不变；
   分组依据 = 源稳定标识（沙箱源用 sandboxDir，其余源用 name） */
var GROUPS_KEY='protoGroups_v1',GROUPS_FOLD_KEY='protoGroupsFold_v1';
var groupsData={list:[],map:{}},groupsFold={};
function loadGroups(){
 try{ var v=JSON.parse(localStorage.getItem(GROUPS_KEY)||'null');
  if(v&&Array.isArray(v.list)){
   groupsData={ list:v.list.map(function(g){ return {id:String(g.id),name:String(g.name||'未命名')}; }),
                map:(v.map&&typeof v.map==='object')?v.map:{} };
  }
 }catch(e){}
 try{ var f=JSON.parse(localStorage.getItem(GROUPS_FOLD_KEY)||'null'); if(f&&typeof f==='object')groupsFold=f; }catch(e){}
}
function saveGroups(){
 try{ localStorage.setItem(GROUPS_KEY,JSON.stringify(groupsData)); }catch(e){}
 try{ localStorage.setItem(GROUPS_FOLD_KEY,JSON.stringify(groupsFold)); }catch(e){}
}
// drag fix
var ORDER_KEY='protoOrder_v1',SUB_ORDER_KEY='subPageOrder_v1'; // drag fix
var protoOrder={},subPageOrder={}; // drag fix
function loadProtoOrder(){ try{ var v=JSON.parse(localStorage.getItem(ORDER_KEY)||'null'); if(v&&typeof v==='object'&&v!==null) protoOrder=v; }catch(e){} } // drag fix
function saveProtoOrder(){ try{ localStorage.setItem(ORDER_KEY,JSON.stringify(protoOrder)); }catch(e){} } // drag fix
function loadSubPageOrder(){ try{ var v=JSON.parse(localStorage.getItem(SUB_ORDER_KEY)||'null'); if(v&&typeof v==='object'&&v!==null) subPageOrder=v; }catch(e){} } // drag fix
function saveSubPageOrder(){ try{ localStorage.setItem(SUB_ORDER_KEY,JSON.stringify(subPageOrder)); }catch(e){} } // drag fix
function getOrderedProtos(list,gid){ // drag fix
 try{
  var proj=currentProject||'';
  var key=gid?String(gid):'ungrouped';
  var stored=protoOrder[proj]&&protoOrder[proj][key];
  if(!Array.isArray(stored)||!stored.length){
   return list.slice().sort(function(a,b){ return String(a.displayName||a.name||'').localeCompare(String(b.displayName||b.name||''),'zh-CN'); });
  }
  var map={}; list.forEach(function(s){ map[groupKeyOf(s)]=s; });
  var res=[]; stored.forEach(function(k){ if(map[k]){ res.push(map[k]); delete map[k]; }});
  var remain=[]; for(var k in map) remain.push(map[k]);
  remain.sort(function(a,b){ return String(a.displayName||a.name||'').localeCompare(String(b.displayName||b.name||''),'zh-CN'); });
  return res.concat(remain);
 }catch(e){ return list; }
} // drag fix
function getOrderedSubPages(s){ // drag fix
 try{
  var dir=s.sandboxDir||'';
  var stored=subPageOrder[dir];
  var list=(s.subPages||[]).slice();
  if(!Array.isArray(stored)||!stored.length){
   return list.sort(function(a,b){ return String(a.file||a.name||'').localeCompare(String(b.file||b.name||''),'zh-CN'); });
  }
  var map={}; list.forEach(function(sp){ map[sp.file]=sp; });
  var res=[]; stored.forEach(function(f){ if(map[f]){ res.push(map[f]); delete map[f]; }});
  var remain=[]; for(var k in map) remain.push(map[k]);
  remain.sort(function(a,b){ return String(a.file||a.name||'').localeCompare(String(b.file||b.name||''),'zh-CN'); });
  return res.concat(remain);
 }catch(e){ return s.subPages||[]; }
} // drag fix
function getOrdered(list,gid){ return getOrderedProtos(list,gid); } // drag fix
try{ loadProtoOrder(); }catch(e){} // drag fix
try{ loadSubPageOrder(); }catch(e){} // drag fix
// drag fix global drag state
var __dragSrc=null; // drag fix
function getDragPlaceholder(){ var ph=document.querySelector('.drag-placeholder'); if(ph) return ph; ph=document.createElement('div'); ph.className='drag-placeholder'; return ph; } // drag fix
function handleProtoDragOver(e){ // drag fix
 var src=window.__dragSrc||__dragSrc; if(!src||src.type!=='proto') return;
 var gid=String(this.dataset.gid||''); if(String(src.gid||'')!==gid) return;
 e.preventDefault(); e.dataTransfer.dropEffect='move'; // drag fix only same container
 var ph=getDragPlaceholder(); if(ph.parentNode) ph.remove();
 var items=Array.from(this.children).filter(function(c){ return c.classList.contains('sb-proto-block') && !c.classList.contains('drag-placeholder') && c!==src.el; }); // drag fix
 var after=null; for(var i=0;i<items.length;i++){ var r=items[i].getBoundingClientRect(); if(e.clientY < r.top + r.height/2){ after=items[i]; break; } }
 if(after) this.insertBefore(ph, after); else this.appendChild(ph);
} // drag fix
function handleProtoDrop(e){ // drag fix
 var src=window.__dragSrc||__dragSrc; if(!src||src.type!=='proto') return;
 var gid=String(this.dataset.gid||''); if(String(src.gid||'')!==gid) return;
 e.preventDefault(); // drag fix only same container
 var ph=this.querySelector('.drag-placeholder'); if(!ph) return;
 var newOrder=[]; Array.from(this.children).forEach(function(c){
  if(c===ph){ newOrder.push(src.key); }
  else if(c===src.el){ }
  else if(c.classList.contains('sb-proto-block')){ var btn=c.querySelector('[data-key]'); if(btn&&btn.dataset.key) newOrder.push(btn.dataset.key); else if(c.dataset&&c.dataset.key) newOrder.push(c.dataset.key); }
 });
 var proj=currentProject||''; if(!protoOrder[proj]) protoOrder[proj]={};
 var keyName=gid?gid:'ungrouped'; protoOrder[proj][keyName]=newOrder; saveProtoOrder(); // drag fix
 if(ph&&ph.parentNode) ph.remove(); window.__dragSrc=null; __dragSrc=null;
 renderSourceList(); // drag fix not via loadSandboxSources
} // drag fix
function groupKeyOf(s){ return String((s&&(s.displayName||s.name||s.sandboxDir))||''); }
function groupNameOf(gid){ for(var i=0;i<groupsData.list.length;i++){ if(groupsData.list[i].id===gid)return groupsData.list[i].name; } return ''; }
function groupOf(s){ var gid=groupsData.map[groupKeyOf(s)]; return (gid&&groupNameOf(gid))?gid:''; }
function groupChildren(gid){ var p=String(gid||''); return groupsData.list.filter(function(g){ return String(g.parent||'')===p; }); }
function setGroupOf(s,gid){
 if(!s)return;
 var k=groupKeyOf(s);
 if(gid&&!groupNameOf(gid))gid='';
 if(gid)groupsData.map[k]=gid; else delete groupsData.map[k];
 saveGroups(); renderSourceList();
}
function newGroupId(){ return 'g'+Date.now().toString(36)+Math.floor(Math.random()*46656).toString(36); }
function addGroup(parent){
 if(parent&&!groupNameOf(parent))parent=null; /* 防非法父级（如事件对象误传） */
 askNamePrompt({title:parent?'新建二级文件夹':'新建文件夹',label:'文件夹名称',
   hint:parent?('在「'+groupNameOf(parent)+'」内新建二级文件夹（最多两级）。'):'',
   value:''},function(nm){
  if(nm==null||nm==='')return;
  nm=String(nm).trim();
  if(!nm||nm.length>30){ alert('名称不能为空且不超过 30 字。'); return; }
  groupsData.list.push({id:newGroupId(),name:nm,parent:parent||null}); saveGroups(); renderSourceList();
 });
}
function renameGroup(gid){
 var nm0=groupNameOf(gid); if(!nm0)return;
 askNamePrompt({title:'重命名文件夹',label:'文件夹名称',value:nm0},function(nm){
  if(nm==null)return; nm=String(nm).trim();
  if(!nm||nm.length>30){ alert('名称不能为空且不超过 30 字。'); return; }
  for(var i=0;i<groupsData.list.length;i++){ if(groupsData.list[i].id===gid){ groupsData.list[i].name=nm; break; } }
  saveGroups(); renderSourceList();
 });
}
function delGroup(gid){
 var nm=groupNameOf(gid); if(!nm)return;
 function collect(id){ var out=[id]; groupChildren(id).forEach(function(c){ out=out.concat(collect(c.id)); }); return out; }
 var ids=collect(gid);
 var sub=ids.length-1;
 if(!window.confirm('删除文件夹「'+nm+'」'+(sub>0?'及其下 '+sub+' 个二级文件夹':'')+'？\n\n其中的原型不会被删除，仅移回未分组列表。'))return;
 groupsData.list=groupsData.list.filter(function(g){ return ids.indexOf(g.id)<0; });
 for(var k in groupsData.map){ if(ids.indexOf(groupsData.map[k])>=0)delete groupsData.map[k]; }
 ids.forEach(function(id){ delete groupsFold[id]; });
 saveGroups(); renderSourceList();
}
function toggleGroupFold(gid){ groupsFold[gid]=!groupsFold[gid]; saveGroups(); renderSourceList(); }
/* 移入文件夹选择浮层 */
var groupPopEl=null;
function closeGroupPop(){ if(groupPopEl){ groupPopEl.remove(); groupPopEl=null; document.removeEventListener('mousedown',groupPopDown); } }
function groupPopDown(e){ if(groupPopEl&&!groupPopEl.contains(e.target))closeGroupPop(); }
function showGroupPop(btn,s,pos){
 closeGroupPop();
 var pop=document.createElement('div'); pop.className='sb-group-pop';
 pop.innerHTML='<div class="gp-t">移入文件夹</div>';
 var cur=groupOf(s);
 function addOpt(gid,label,onClick,extraCls){
  var it=document.createElement('button'); it.type='button';
  it.className='gp-i'+(extraCls?' '+extraCls:'')+(gid===cur?' cur':'');
  it.textContent=label;
  it.onclick=function(ev){ ev.stopPropagation(); closeGroupPop(); onClick(); };
  pop.appendChild(it);
 }
 addOpt('','（未分组）',function(){ setGroupOf(s,''); });
 groupsData.list.forEach(function(g){ if(g.parent)return; addOpt(g.id,'▸ '+g.name,function(){ setGroupOf(s,g.id); }); });
 groupsData.list.forEach(function(g){ if(!g.parent)return; addOpt(g.id,'　└ '+g.name,function(){ setGroupOf(s,g.id); },'l2'); });
 if(!groupsData.list.length){ var e=document.createElement('div'); e.className='gp-empty'; e.textContent='暂无文件夹'; pop.appendChild(e); }
 addOpt('new','＋ 新建文件夹',function(){ addGroup(); },'gp-new');
 document.body.appendChild(pop);
 /* pos={x,y}：由右键菜单触发时按鼠标坐标展开；否则锚定按钮 */
 var r=(pos&&typeof pos.x==='number')?{right:pos.x-8,top:pos.y,left:pos.x+8}:btn.getBoundingClientRect();
 var pw=pop.offsetWidth,ph=pop.offsetHeight;
 var left=r.right+6, top=Math.min(r.top,Math.max(8,window.innerHeight-ph-8));
 if(left+pw>window.innerWidth-8)left=Math.max(8,r.left-pw-6);
 pop.style.left=left+'px'; pop.style.top=top+'px';
 groupPopEl=pop;
 setTimeout(function(){ document.addEventListener('mousedown',groupPopDown); },0);
}

/* ═══════ 通用右键菜单：源列表项 / 分组标题的操作入口（替代悬浮小图标按钮） ═══════ */
var ctxMenuEl=null;
function closeCtxMenu(){ if(ctxMenuEl){ ctxMenuEl.remove(); ctxMenuEl=null; document.removeEventListener('mousedown',ctxMenuDown,true); } }
function ctxMenuDown(e){ if(ctxMenuEl&&!ctxMenuEl.contains(e.target))closeCtxMenu(); }
/* items: [{ico,label,danger,onClick(ev)}...]，字符串 'sep' 为分隔线 */
function openCtxMenu(items,x,y){
 closeCtxMenu();
 var m=document.createElement('div'); m.className='ctx-menu';
 items.forEach(function(it){
  if(it==='sep'){ var sp=document.createElement('div'); sp.className='ctx-sep'; m.appendChild(sp); return; }
  var b=document.createElement('button'); b.type='button';
  b.className='ctx-item'+(it.danger?' danger':'');
   /* it.ico：允许直接传 PlanBIcon 生成的 SVG HTML（以 < 开头放行，其余按文本转义） */
   // icon align fix: ci-ico 已在 app.css 统一为 inline-flex 居中
   var icoHtml = (typeof it.ico==='string' && it.ico.charAt(0)==='<') ? it.ico : escHtml(it.ico||'');
   b.innerHTML='<span class="ci-ico">'+icoHtml+'</span><span>'+escHtml(it.label)+'</span>';
  b.onclick=function(ev){ ev.stopPropagation(); closeCtxMenu(); it.onClick(ev); };
  m.appendChild(b);
 });
 document.body.appendChild(m);
 var pw=m.offsetWidth,ph=m.offsetHeight;
 var left=Math.max(8,Math.min(x,window.innerWidth-pw-8));
 var top=Math.max(8,Math.min(y,window.innerHeight-ph-8));
 m.style.left=left+'px'; m.style.top=top+'px';
 ctxMenuEl=m;
 setTimeout(function(){ document.addEventListener('mousedown',ctxMenuDown,true); },0);
}

var protoTreeFold = {};
function toggleProtoTree(k){
  protoTreeFold[k] = !protoTreeFold[k];
  renderSourceList();
}

function createSubPagePrompt(s){
  if(!s||!s.sandboxDir){ showToast('仅沙箱原型可新建子页面'); return; }
  askNamePrompt({
    title: '新建子页面',
    label: '子页面名称',
    hint: '在「' + escHtml(s.displayName) + '」沙箱目录下创建新的独立 HTML 页面。',
    value: ''
  }, function(nm){
    if(!nm) return;
    if(window.protoAPI&&window.protoAPI.sandbox&&window.protoAPI.sandbox.createSubPage){
      window.protoAPI.sandbox.createSubPage({ dir: s.sandboxDir, name: nm, kind: s.kind }).then(function(r){
        if(r&&r.ok){
          showToast('已创建子页面：' + r.file);
          if(typeof loadSandboxSources==='function') loadSandboxSources(s.displayName, true);
        } else {
          showToast('创建失败：' + ((r&&r.error)||'未知错误'));
        }
      }).catch(function(e){ showToast('创建失败：' + (e&&e.message||e)); });
    }
  });
}

/* 批量导入子页面：多选 HTML，经去重改名写入当前原型沙箱（子页面由目录 listing 自动识别） */
function importSubPages(s){
  if(!s||!s.sandboxDir){ showToast('仅沙箱中的原型可导入子页面。'); return; }
  if(!(window.protoAPI&&window.protoAPI.pickTextFile&&window.protoAPI.sandbox&&window.protoAPI.sandbox.write&&window.protoAPI.sandbox.readFile)){ showToast('当前环境不支持导入本地文件。'); return; }
  var dir=String(s.sandboxDir);
  var title='导入子页面到「'+(s.displayName||s.name||'')+'」（可多选）';
  window.protoAPI.pickTextFile({title:title, multi:true, filters:[{name:'HTML 页面',extensions:['html','htm']}]}).then(function(r){
    var files=[];
    try{
      if(r&&Array.isArray(r.files)) files=r.files;
      else if(r&&(r.path||r.name)) files=[r];
    }catch(e){ files=[]; }
    files=(files||[]).filter(function(f){ return f&&(f.path||f.name||f.content!=null); });
    if(!files.length) return; /* 取消或空选静默返回 */
    var okNames=[], skipped=[];
    function resolveFreeName(name, n, cb){
      if(n>99){ cb(null); return; }
      var cand=(n===0)?name:String(name).replace(/\.html?$/i,'')+'('+(n+1)+').html';
      window.protoAPI.sandbox.readFile({dir:dir, file:cand}).then(function(rr){
        if(rr&&rr.ok){ resolveFreeName(name, n+1, cb); }
        else{ cb(cand); }
      }).catch(function(){ cb(cand); });
    }
    function handleOne(f, done){
      var raw=String(f.name||'').split(/[\\/]/).pop();
      var content=(typeof f.content==='string')?f.content:null;
      if(!/\.html?$/i.test(raw)){ skipped.push((raw||'未命名')+'（非 HTML，已跳过）'); done(); return; }
      if(content==null){ skipped.push(raw+'（读取失败'+(f.error?':'+f.error:'')+'，已跳过）'); done(); return; }
      if(content.length>5*1024*1024){ skipped.push(raw+'（超过 5MB，已跳过）'); done(); return; }
      resolveFreeName(raw, 0, function(finalName){
        if(!finalName){ skipped.push(raw+'（重名过多，已跳过）'); done(); return; }
        window.protoAPI.sandbox.write({dir:dir, file:finalName, content:content}).then(function(wr){
          if(wr&&wr.ok){ okNames.push(finalName+(finalName!==raw?('（由'+raw+'改名）'):'')); }
          else{ skipped.push(raw+'（写入失败：'+((wr&&wr.error)||'未知错误')+'）'); }
          done();
        }).catch(function(e){ skipped.push(raw+'（写入失败：'+((e&&e.message)||e)+'）'); done(); });
      });
    }
    function next(i){
      if(i>=files.length){ finish(); return; }
      try{ handleOne(files[i], function(){ next(i+1); }); }catch(e){ next(i+1); }
    }
    function finish(){
      try{ delete protoTreeFold[dir]; }catch(e){}
      if(typeof loadSandboxSources==='function'){ try{ loadSandboxSources(s.displayName, true); }catch(e){} }
      var msg='已导入 '+okNames.length+' 个子页面到「'+(s.displayName||s.name||'')+'」';
      if(skipped.length) msg+='；跳过 '+skipped.length+' 个（'+skipped.slice(0,3).join('；')+(skipped.length>3?'…':'')+'）';
      showToast(msg);
    }
    next(0);
  }).catch(function(e){ showToast('导入失败：'+((e&&e.message)||e)); });
}

function renameSubPagePrompt(s, oldFile){
  if(!s||!s.sandboxDir){ return; }
  var oldName = String(oldFile||'').replace(/\.html$/i, '');
  askNamePrompt({
    title: '重命名子页面',
    label: '新子页面名称',
    hint: '将重命名该子页面 HTML 文件。',
    value: oldName
  }, function(nm){
    if(!nm || nm === oldName) return;
    if(window.protoAPI && window.protoAPI.sandbox && window.protoAPI.sandbox.renameSubPage){
      window.protoAPI.sandbox.renameSubPage({ dir: s.sandboxDir, oldFile: oldFile, newName: nm }).then(function(r){
        if(r && r.ok){
          showToast('已重命名：' + oldName + ' → ' + nm);
          if(s.activeSubFile === oldFile) s.activeSubFile = r.newFile;
          if(typeof loadSandboxSources === 'function') loadSandboxSources(s.displayName, true);
          setTimeout(function(){ loadSubPage(s, r.newFile); }, 200);
        } else {
          showToast('重命名失败：' + ((r && r.error) || '未知错误'));
        }
      }).catch(function(e){ showToast('重命名失败：' + (e && e.message || e)); });
    }
  });
}

function deleteSubPageConfirm(s, subFile){
  if(!s||!s.sandboxDir){ return; }
  if(!confirm('确定要删除子页面「' + subFile + '」吗？此操作不可恢复。')) return;
  if(window.protoAPI&&window.protoAPI.sandbox&&window.protoAPI.sandbox.deleteSubPage){
    window.protoAPI.sandbox.deleteSubPage({ dir: s.sandboxDir, file: subFile }).then(function(r){
      if(r&&r.ok){
        showToast('已删除子页面：' + subFile);
        if(s.activeSubFile === subFile) s.activeSubFile = '';
        if(typeof loadSandboxSources==='function') loadSandboxSources(s.displayName, true);
      } else {
        showToast('删除失败：' + ((r&&r.error)||'未知错误'));
      }
    }).catch(function(e){ showToast('删除失败：' + (e&&e.message||e)); });
  }
}

function loadSubPage(s, subFile){
  if(!s) return;
  s.activeSubFile = subFile || s.mainHtmlFile || s.name;
  var isMain = (!subFile || subFile === s.mainHtmlFile || subFile === s.name);
  if(isMain){
    loadSource(s);
    return;
  }
  currentSource = s;
  try { if (typeof window !== 'undefined' && window.Store && typeof window.Store.setCurrentSource === 'function') window.Store.setCurrentSource(s); } catch (e) {}
  if(window.LinkBind) LinkBind.closeInspector();
  if(window.AnnotationEngine && typeof AnnotationEngine.closeAll === 'function') AnnotationEngine.closeAll();
  editHideHover();
  /* 显式切子页面时收掉需求输入条（静默刷新不收） */
  try{
    if(!(typeof window!=='undefined'&&window.__aiQuietRefresh===true)){
      if(typeof CTRL_PICK!=='undefined'&&CTRL_PICK&&typeof CTRL_PICK.clear==='function')CTRL_PICK.clear();
      if(typeof CTRL_PICK!=='undefined'&&CTRL_PICK&&typeof CTRL_PICK.hideFab==='function')CTRL_PICK.hideFab();
    }
  }catch(e9){}
  loadSourceDocs(s);
  /* 子页面切换同样刷新文档面板（与 loadSource 主页面一致，否则面板滞留旧原型文档） */
  try{ if(typeof loadDesc==='function')loadDesc(); }catch(e){}

  if(s.sandboxDir && window.protoAPI && window.protoAPI.sandbox && window.protoAPI.sandbox.readFile){
    window.protoAPI.sandbox.readFile({ dir: s.sandboxDir, file: subFile }).then(function(r){
      var content = (r && r.ok) ? r.content : '';
      if(!content) content = '<!DOCTYPE html><html><body><h1>' + escHtml(subFile) + '</h1></body></html>';
      /* P0-A: 同 loadSource，经受限协议封装后再注入 */
      frame.setAttribute('srcdoc', sandboxSecureSrcdoc(content, { links: s._links||[], mode: false, from: subFile, dir: s.sandboxDir }));
      document.title = '原型预览 · ' + s.displayName + ' / ' + subFile;
      if(locEl) locEl.textContent = s.displayName + ' / ' + subFile.replace(/\.html$/i, '');
      // fix refresh preserve: quiet refresh keeps panels
      applyKind(window.__aiQuietRefresh===true ? false : true);
      renderSourceList();
    }).catch(function(){
      loadSource(s);
    });
  } else {
    loadSource(s);
  }
}
window.loadSubPage = loadSubPage;
/* P3 文档→画布复用器：按route只读匹配子页面并只读调用既有loadSubPage，不改其实现，失败返回false绝不抛错 */
function jumpToSubPageByRoute(route){
 try{
  if(typeof loadSubPage!=='function') return false;
  var src=null; try{ src=(typeof currentSource!=='undefined')?currentSource:null; }catch(e){ src=null; }
  if(!src) return false;
  var norm=function(s){ try{ return String(s||'').trim().replace(/^#/,'').trim().replace(/\.html?$/i,'').toLowerCase(); }catch(e){ return ''; } };
  var target=norm(route);
  if(!target) return false;
  var cands=[];
  try{
   if(src.mainHtmlFile) cands.push(String(src.mainHtmlFile));
   if(src.name&&/\.html?$/i.test(String(src.name))) cands.push(String(src.name));
   if(src.subPages) for(var i=0;i<src.subPages.length;i++){ var sp=src.subPages[i]; if(!sp) continue; if(typeof sp==='string') cands.push(sp); else if(sp.file) cands.push(String(sp.file)); }
   if(src.pages) for(var j=0;j<src.pages.length;j++){ var pg=src.pages[j]; if(!pg) continue; var f=String(pg); if(!/\.html?$/i.test(f)) f=f+'.html'; cands.push(f); }
   if(src.htmlFiles) for(var k=0;k<src.htmlFiles.length;k++){ if(src.htmlFiles[k]) cands.push(String(src.htmlFiles[k])); }
  }catch(e){}
  for(var t=0;t<cands.length;t++){
   if(norm(cands[t])===target){ loadSubPage(src,cands[t]); return true; }
  }
  return false;
 }catch(e){ return false; }
}
try{ window.jumpToSubPageByRoute=jumpToSubPageByRoute; }catch(e){}

function makeSourceItem(s){
  var hasSub = (s.subPages && s.subPages.length > 0);
  var sKey = s.sandboxDir || s.name;
  var isFolded = !!protoTreeFold[sKey];

  var wrap = document.createElement('div');
  wrap.className = 'sb-proto-block' + (hasSub ? ' has-sub' : '');

  var it = document.createElement('button');
  it.type = 'button';
  var isCurrentProto = (s === currentSource);
  var mainBase = (s.mainHtmlFile || s.name || '').replace(/\.html$/i, '');
  var activeBase = (s.activeSubFile || '').replace(/\.html$/i, '');
  var isMainActive = isCurrentProto && (!s.activeSubFile || s.activeSubFile === s.mainHtmlFile || s.activeSubFile === s.name || activeBase === mainBase || !activeBase);
  var isSubActiveAny = isCurrentProto && !isMainActive;
  it.className = 'sb-item' + (isMainActive ? ' active' : (isSubActiveAny ? ' active-parent' : '')) + (hasSub ? ' is-parent' : '');

  var arrowHtml = hasSub ? '<span class="sb-tree-arrow' + (isFolded ? ' folded' : '') + '">▾</span>' : '';

  it.innerHTML = '<span class="nm">' + escHtml(s.displayName) + '</span>' + arrowHtml;
  it.title = '查看该原型主页（' + (s.kind==='pc'?'PC 端':'移动端') + '）；双击重命名，右键更多操作';
  it.draggable = !(window.__EXPORT_BOOT__===true); // drag fix
  it.dataset.key = groupKeyOf(s); // drag fix
  if(s.sandboxDir) it.dataset.sandboxDir = s.sandboxDir; // drag fix
  it.dataset.gid = groupOf(s)||''; // drag fix
  // drag fix long press 300ms desktop 350ms mobile to activate draggable, arrow excluded
  (function(btn, wrapEl){
    var pressTimer=null, longActive=false;
    function isArrow(t){ return t && t.classList && t.classList.contains('sb-tree-arrow'); }
    btn.addEventListener('mousedown', function(e){
      if(isArrow(e.target)) return;
      if(e.button!==0) return;
      longActive=false;
      clearTimeout(pressTimer);
      pressTimer=setTimeout(function(){ longActive=true; btn.draggable=true; btn.classList.add('dragging'); wrapEl.classList.add('dragging'); },300); // drag fix
    });
    btn.addEventListener('mouseup', function(e){
      clearTimeout(pressTimer);
      if(!longActive){ btn.draggable = !(window.__EXPORT_BOOT__===true); } // drag fix
      setTimeout(function(){ longActive=false; },0);
    });
    btn.addEventListener('mouseleave', function(){ clearTimeout(pressTimer); });
    btn.addEventListener('touchstart', function(e){
      if(isArrow(e.target)) return;
      longActive=false;
      clearTimeout(pressTimer);
      pressTimer=setTimeout(function(){ longActive=true; btn.draggable=true; btn.classList.add('dragging'); wrapEl.classList.add('dragging'); },350); // drag fix
    }, {passive:true});
    btn.addEventListener('touchend', function(){ clearTimeout(pressTimer); setTimeout(function(){ if(!longActive) btn.draggable = !(window.__EXPORT_BOOT__===true); longActive=false; },0); });
    btn.addEventListener('touchcancel', function(){ clearTimeout(pressTimer); });
    btn.addEventListener('dragstart', function(e){
      if(window.__EXPORT_BOOT__===true){ e.preventDefault(); return; }
      if(isArrow(e.target)){ e.preventDefault(); return; }
      e.dataTransfer.effectAllowed='move';
      try{ e.dataTransfer.setData('text/plain', btn.dataset.key); }catch(err){}
      window.__dragSrc = { key: btn.dataset.key, gid: btn.dataset.gid, el: wrapEl, type:'proto', dir: btn.dataset.sandboxDir||'' }; __dragSrc=window.__dragSrc; // drag fix
      wrapEl.classList.add('dragging'); btn.classList.add('dragging'); // drag fix
    });
    btn.addEventListener('dragend', function(e){
      clearTimeout(pressTimer);
      wrapEl.classList.remove('dragging'); btn.classList.remove('dragging'); // drag fix
      var ph=document.querySelector('.drag-placeholder'); if(ph&&ph.parentNode) ph.remove(); // drag fix
      window.__dragSrc=null; __dragSrc=null; // drag fix
      btn.draggable = !(window.__EXPORT_BOOT__===true); // drag fix
    });
  })(it, wrap);

  it.onclick = function(ev){
    if(ev && ev.detail > 1) return;
    if(ev && ev.target && ev.target.classList.contains('sb-tree-arrow')){
      ev.stopPropagation();
      toggleProtoTree(sKey);
      return;
    }
    // 点击一级列表直接进入主页
    s.activeSubFile = s.mainHtmlFile || s.name;
    loadSource(s);
  };

  if(window.__EXPORT_BOOT__ === true){
    wrap.appendChild(it);
    return wrap;
  }

  var canManage = !!(s.sandboxDir && window.protoAPI && window.protoAPI.sandbox);
  it.ondblclick = function(){
    if(canManage){ renameSource(s); }
    else{ showToast('仅沙箱中的原型可重命名（桌面端）。'); }
  };
  it.oncontextmenu = function(ev){
    ev.preventDefault();
    var items = [
      { ico: sIco('plus'), label: '新建子页面…', onClick: function(){ createSubPagePrompt(s); } },
      { ico: sIco('plus'), label: '导入子页面…', onClick: function(){ importSubPages(s); } },
      { ico: sIco('plus'), label: '新建同级原型…', onClick: function(){ if(typeof newPrototype==='function') newPrototype(s.kind||'pc'); else if(typeof openKindModal==='function') openKindModal(); } },
      'sep',
      { ico: sIco('folder'), label: '移入文件夹…', onClick: function(ev2){ showGroupPop(null, s, { x: ev2.clientX, y: ev2.clientY }); } },
      'sep'
    ];
    if(canManage){
      items.push({ ico: '✎', label: '重命名', onClick: function(){ renameSource(s); } });
      items.push({ ico: sIco('trash'), label: '删除原型…', danger: true, onClick: function(){ deleteSource(s); } });
    }
    items.push({ ico: '✕', label: '从列表移除', onClick: function(){ removeSource(s); } });
    openCtxMenu(items, ev.clientX, ev.clientY);
  };

  wrap.appendChild(it);

  // 渲染子页面列表（仅渲染真正的子页面，不重复放置主页）
  if(hasSub && !isFolded){
    var subList = document.createElement('div');
    subList.className = 'sb-sub-list';
    subList.dataset.dir = s.sandboxDir||''; // drag fix
    // drag fix subList as dropZone for subPage ordering within same sandboxDir
    subList.addEventListener('dragover', function(e){ // drag fix
      var src=window.__dragSrc||__dragSrc; if(!src||src.type!=='sub') return;
      if(String(src.dir||'')!==String(this.dataset.dir||'')) return; // drag fix only same container
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      var ph=getDragPlaceholder();
      var items=Array.from(this.children).filter(function(c){ return !c.classList.contains('drag-placeholder') && c!==src.el; });
      var after=null; for(var i=0;i<items.length;i++){ var r=items[i].getBoundingClientRect(); if(e.clientY < r.top + r.height/2){ after=items[i]; break; } }
      if(after) this.insertBefore(ph, after); else this.appendChild(ph);
    }); // drag fix
    subList.addEventListener('drop', function(e){ // drag fix
      var src=window.__dragSrc||__dragSrc; if(!src||src.type!=='sub') return;
      if(String(src.dir||'')!==String(this.dataset.dir||'')) return;
      e.preventDefault(); // drag fix only same container
      var ph=this.querySelector('.drag-placeholder'); if(!ph) return;
      var newOrder=[]; Array.from(this.children).forEach(function(c){
        if(c===ph){ newOrder.push(src.file); }
        else if(c===src.el){ }
        else if(c.dataset&&c.dataset.file){ newOrder.push(c.dataset.file); }
      });
      subPageOrder[src.dir]=newOrder; saveSubPageOrder(); // drag fix
      if(ph&&ph.parentNode) ph.remove(); window.__dragSrc=null; __dragSrc=null;
      renderSourceList(); // drag fix not via loadSandboxSources
    }); // drag fix
    subList.addEventListener('dragleave', function(e){ // drag fix placeholder cleanup
      if(!e.relatedTarget || !this.contains(e.relatedTarget)){
        // keep placeholder until drop or dragend
      }
    });

    var orderedSubs = getOrderedSubPages(s); // drag fix
    orderedSubs.forEach(function(sp){
      var subIt = document.createElement('button');
      subIt.type = 'button';
      var spBase = (sp.file || sp.name || '').replace(/\.html$/i, '');
      var isSubActive = (s === currentSource && !isMainActive && (s.activeSubFile === sp.file || (activeBase && activeBase === spBase)));
      subIt.className = 'sb-sub-item' + (isSubActive ? ' active' : '');
      subIt.innerHTML = '<span class="sb-sub-dot"></span><span class="sb-sub-nm">' + escHtml(sp.name || sp.file) + '</span>';
      subIt.title = '子页面：' + sp.file + '（双击重命名，右键更多操作）';
      subIt.dataset.file = sp.file; // drag fix
      subIt.dataset.dir = s.sandboxDir||''; // drag fix
      subIt.draggable = !(window.__EXPORT_BOOT__===true); // drag fix
      subIt.addEventListener('dragstart', function(e){ // drag fix
        if(window.__EXPORT_BOOT__===true){ e.preventDefault(); return; }
        e.dataTransfer.effectAllowed='move';
        try{ e.dataTransfer.setData('text/plain', sp.file); }catch(err){}
        window.__dragSrc={ file: sp.file, dir: s.sandboxDir||'', el: subIt, type:'sub' }; __dragSrc=window.__dragSrc; // drag fix
        subIt.classList.add('dragging'); // drag fix
      });
      subIt.addEventListener('dragend', function(){ // drag fix
        subIt.classList.remove('dragging');
        var ph=document.querySelector('.drag-placeholder'); if(ph&&ph.parentNode) ph.remove(); // drag fix
        window.__dragSrc=null; __dragSrc=null; // drag fix
      });
      // drag fix long press for sub (300/350)
      (function(btn){
        var tm=null, active=false;
        btn.addEventListener('mousedown', function(e){ clearTimeout(tm); active=false; tm=setTimeout(function(){ active=true; btn.draggable=true; },300); }); // drag fix
        btn.addEventListener('mouseup', function(){ clearTimeout(tm); if(!active) btn.draggable= !(window.__EXPORT_BOOT__===true); }); // drag fix
        btn.addEventListener('touchstart', function(){ clearTimeout(tm); active=false; tm=setTimeout(function(){ active=true; btn.draggable=true; },350); }, {passive:true}); // drag fix
        btn.addEventListener('touchend', function(){ clearTimeout(tm); }); // drag fix
      })(subIt);
      subIt.onclick = function(ev){
        ev.stopPropagation();
        loadSubPage(s, sp.file);
      };
      subIt.ondblclick = function(ev){
        ev.stopPropagation();
        renameSubPagePrompt(s, sp.file);
      };
      subIt.oncontextmenu = function(ev){
        ev.preventDefault();
        var subMenu = [
          { ico: '✎', label: '重命名子页面', onClick: function(){ renameSubPagePrompt(s, sp.file); } },
          { ico: sIco('trash'), label: '删除子页面「' + (sp.name || sp.file) + '」…', danger: true, onClick: function(){ deleteSubPageConfirm(s, sp.file); } }
        ];
        openCtxMenu(subMenu, ev.clientX, ev.clientY);
      };
      subList.appendChild(subIt);
    });

    wrap.appendChild(subList);
  }

  return wrap;
}
/* 递归渲染分组块：一级分组内可再含二级分组（最多两级），组内直接原型项在前、子分组在后 */
function makeGroupBlock(g,byGroup){
  var grp=document.createElement('div'); grp.className='sb-grp'+(g.parent?' sub':'');
  var h=document.createElement('button'); h.type='button';
  h.className='sb-grp-h'+(groupsFold[g.id]?' folded':'');
   // icon align fix: g-arrow/g-ico 已在 app.css 统一为 inline-flex 对齐
   h.innerHTML='<span class="g-arrow">▾</span><span class="g-ico">'+sIco('folder','▸')+'</span><span class="g-name">'+escHtml(g.name)+'</span><span class="g-cnt">'+((byGroup[g.id]||[]).length)+'</span>';
   h.title='点击展开/收起；右键更多操作';
  h.onclick=function(){ toggleGroupFold(g.id); };
  h.oncontextmenu=function(ev){
   ev.preventDefault();
   var items=[];
   if(!g.parent){ items.push({ico:'＋',label:'新建二级文件夹',onClick:function(){ addGroup(g.id); }}); } /* 一级组最多两级 */
   items.push({ico:'✎',label:'重命名文件夹',onClick:function(){ renameGroup(g.id); }});
   items.push({ico:sIco('trash'),label:'删除文件夹…',danger:true,onClick:function(){ delGroup(g.id); }});
   openCtxMenu(items,ev.clientX,ev.clientY);
  };
  var b=document.createElement('div'); b.className='sb-grp-b';
  b.dataset.gid = g.id; // drag fix
  b.addEventListener('dragover', handleProtoDragOver); // drag fix b as dropZone
  b.addEventListener('drop', handleProtoDrop); // drag fix only same container
  b.addEventListener('dragleave', function(e){ if(!e.relatedTarget || !this.contains(e.relatedTarget)){ /* keep placeholder */ } }); // drag fix
  (byGroup[g.id]||[]).forEach(function(s){ b.appendChild(makeSourceItem(s)); });
  groupChildren(g.id).forEach(function(c){ b.appendChild(makeGroupBlock(c,byGroup)); });
  grp.appendChild(h); grp.appendChild(b);
  return grp;
}

function renderSourceList(){
 sbListEl.innerHTML='';
 if(!sources.length){ sbListEl.innerHTML='<div class="sb-empty">暂无源文件<br>点击下方「＋ 新增原型」添加</div>'; return; }
 var ungrouped=[],byGroup={};
 sources.forEach(function(s){ var gid=groupOf(s); if(gid){ (byGroup[gid]=byGroup[gid]||[]).push(s); }else{ ungrouped.push(s); } });
 // drag fix use getOrdered with pinyin fallback for missing keys
 ungrouped = getOrderedProtos(ungrouped, ''); // drag fix
 for(var kk in byGroup){ byGroup[kk]=getOrderedProtos(byGroup[kk], kk); } // drag fix
 // drag fix sbList as dropZone for ungrouped protos
 if(!sbListEl._dragBound){ // drag fix
  sbListEl.dataset.gid=''; // drag fix
  sbListEl.addEventListener('dragover', handleProtoDragOver); // drag fix
  sbListEl.addEventListener('drop', handleProtoDrop); // drag fix
  sbListEl._dragBound=true; // drag fix
 }
 ungrouped.forEach(function(s){ sbListEl.appendChild(makeSourceItem(s)); });
 groupsData.list.forEach(function(g){ if(g.parent)return; sbListEl.appendChild(makeGroupBlock(g,byGroup)); });
}

function removeSource(s){
 var idx=sources.indexOf(s);
 if(idx<0)return;
 sources.splice(idx,1);
 delete groupsData.map[groupKeyOf(s)]; saveGroups(); /* 虚拟分组同步清理（不落盘沙箱） */
 if(s===currentSource){
 var next=sources[idx]||sources[idx-1]||null;
 if(next){ loadSource(next); }
 else{
  currentSource=null; frame.removeAttribute('srcdoc');
  try { if (typeof window !== 'undefined' && window.Store && typeof window.Store.setCurrentSource === 'function') window.Store.setCurrentSource(null); } catch (e) {}
 document.title='原型预览 · 投融资录入工作流';
 applyKind(); renderSourceList();
 }
 }else{ renderSourceList(); }
  persistLibrary();
}

/* 删除沙箱原型：确认后整文件夹删除（含 html/md），并清理该原型的本地文档缓存与 AI 会话，
   防止同名重建时回显旧文档/旧会话 */
function deleteSource(s){
 if(!s||!s.sandboxDir)return;
 if(!(window.protoAPI&&window.protoAPI.sandbox&&window.protoAPI.sandbox.remove)){ if(typeof showToast==="function") showToast('仅桌面端可删除沙箱原型。'); else alert('仅桌面端可删除沙箱原型。'); return; }
 var nm=friendlyName(s);
 if(!window.confirm('删除原型「'+nm+'」将删除其沙箱文件夹及其中 html/md 文件，不可恢复。\n\n确定删除？'))return;
  window.protoAPI.sandbox.remove({dir:s.sandboxDir}).then(function(r){
    if(!r||!r.ok){ reportError('proto-delete', new Error(r&&r.error||'未知错误'), '删除失败：'+(r&&r.error||'未知错误')); return; }
   try{ localStorage.removeItem(sourceDocKey(s)); }catch(e){}
   try{ localStorage.removeItem('ai_hist_'+encodeURIComponent(s.sandboxDir)); }catch(e){}
   delete groupsData.map[groupKeyOf(s)]; saveGroups(); /* 虚拟分组同步清理 */
   libStatus('已删除原型：'+nm+'（文件夹与文件已删除）。');
   loadSandboxSources(undefined, true);
  });
}

/* ═══════ 重命名沙箱原型：改名文件夹与其中同名 html/md，并在列表中就地更新 ═══════ */
function renameSource(s){
 if(!s)return;
 if(!(window.protoAPI&&window.protoAPI.sandbox)||!s.sandboxDir){ if(typeof showToast==="function") showToast('仅沙箱中的原型可重命名（桌面端）。'); else alert('仅沙箱中的原型可重命名（桌面端）。'); return; }
 var old=friendlyName(s);
 askNamePrompt({ title:'重命名原型', label:'新名称',
   hint:'将同步重命名该原型文件夹及其中同名 html、md 文件。',
   value:old }, function(nm){
  if(nm==null||nm===''||nm===old)return;
  if(/[\\\/:*?"<>|]|\.\./.test(nm)){ alert('名称含非法字符（不能含 \\ / : * ? \" < > |）。'); return; }
  if(nm.length>60){ alert('名称过长（≤60字）。'); return; }
  window.protoAPI.sandbox.rename({dir:s.sandboxDir,name:nm}).then(function(r){
  if(r&&r.ok){
   var wasCur=(s===currentSource);
   /* 虚拟分组：沙箱文件夹改名后同步迁移分组关联 */
   var oldKey=groupKeyOf(s);
   s.sandboxDir=r.dir;
   if(groupsData.map[oldKey]!==undefined){ groupsData.map[groupKeyOf(s)]=groupsData.map[oldKey]; delete groupsData.map[oldKey]; saveGroups(); }
   /* 就地更新源对象（文件已改名：主 html 必为 <新名>.html） */
   s.name=(/\.md$/i.test(s.name)?nm+'.md':nm+'.html');
   s.displayName=nm;
   if(s.mdFile)s.mdFile=nm+'.md';
   if(s.mdName&&/\.md$/i.test(s.mdName))s.mdName=nm+'.md';
   if(s.isPreset&&s.docs){ try{ localStorage.setItem(sourceDocKey(s), JSON.stringify(s.docs||{})); }catch(e){} } /* 文档缓存迁移到新 key */
   if(wasCur){ loadSource(s); } /* 重载标题/端别/文档 */
   else renderSourceList();
   persistLibrary();
   libStatus('已重命名：'+old+' → '+nm+'（文件夹与 html 文件已同步改名）。');
 }else{
    reportError('proto-rename', new Error(r&&r.error||'未知错误'), '重命名失败：'+(r&&r.error||'未知错误'));
   }
  });
 });
}
function friendlyName(s){ return String(s&&(s.displayName||s.name)||'').replace(/\.(html?|md)$/i,''); }
/* 当前原型名称：工具左上角与功能说明标题统一展示（不再随页面路由变化） */
function protoTitle(){ return currentSource ? String(currentSource.displayName||friendlyName(currentSource)||'原型') : '原型'; }
/* 方案二统一Helper：当前HTML文件/原型展示名/是否主页（单真相源，供edit-entry/annotation/project-ai-export共用） */
function curHtmlFile(s){ s=(typeof s!=='undefined'&&s!==null)?s:currentSource; return String((s&&(s.activeSubFile||s.mainHtmlFile||s.name))||''); }
function isMainFile(file,s){ s=(typeof s!=='undefined'&&s!==null)?s:currentSource; if(!s)return true; var f=String((typeof file!=='undefined'&&file!==null)?file:curHtmlFile(s)).trim().toLowerCase(); if(!f)return true; var main=String((s.mainHtmlFile||s.name)||'').trim().toLowerCase(); if(!main)return true; if(f===main)return true; var fb=f.replace(/\.(html?|md)$/i,''),mb=main.replace(/\.(html?|md)$/i,''); return fb===mb; }
function protoLabel(s,includeSub){ s=(typeof s!=='undefined'&&s!==null)?s:currentSource; if(includeSub===undefined)includeSub=true; if(!s)return '原型'; var base=friendlyName(s)||'原型'; if(!includeSub||isMainFile(curHtmlFile(s),s))return base; var sub=String(curHtmlFile(s)||'').replace(/\.(html?|md)$/i,''); return sub&&sub!==base?base+' / '+sub:base; }
try{ window.curHtmlFile=curHtmlFile; window.protoLabel=protoLabel; window.isMainFile=isMainFile; }catch(e){}

/* ═══════ Iframe 路由与子页面/跨目录跳转双向同步 ═══════
   P0-A: 沙箱化后宿主不可再同步读取 frame.location（不透明源会抛错）。
   此函数仅作旧路径兼容保留；规范路由以受限协议 NAV_JUMP 消息为准（见下方桥接）。 */
function onIframeNavigated(){
  try {
    /* 沙箱不透明源下直接读 location 无意义，交由 NAV_JUMP 消息驱动 */
    try { if(frame && frame.hasAttribute && frame.hasAttribute('sandbox')){ return; } }catch(_e){}
    if(!frame || !frame.contentWindow || !frame.contentWindow.location) return;
    var loc = frame.contentWindow.location;
    var pathname = decodeURIComponent(loc.pathname || '');
    if(!pathname || pathname === 'blank' || pathname === 'about:blank' || pathname === 'srcdoc' || pathname.endsWith('/srcdoc')) return;
    var fileName = pathname.split(/[\\/]/).pop();
    if(!fileName || !fileName.toLowerCase().endsWith('.html')) return;

    // 检查是否跳转到当前源的某个主页/子页面
    if(currentSource && currentSource.sandboxDir){
      var curDirNorm = currentSource.sandboxDir.replace(/\\/g, '/').toLowerCase();
      var pathNorm = pathname.replace(/\\/g, '/').toLowerCase();
      if(pathNorm.indexOf(curDirNorm) >= 0){
        var mainFile = (currentSource.mainHtmlFile || currentSource.name || '');
        if(fileName.toLowerCase() === mainFile.toLowerCase()){
          currentSource.activeSubFile = mainFile;
          if(locEl) locEl.textContent = currentSource.displayName;
          document.title = '原型预览 · ' + currentSource.displayName;
          renderSourceList();
          return;
        }
        currentSource.activeSubFile = fileName;
        if(locEl) locEl.textContent = currentSource.displayName + ' / ' + fileName.replace(/\.html$/i, '');
        document.title = '原型预览 · ' + currentSource.displayName + ' / ' + fileName;
        renderSourceList();
        return;
      }
    }

    // 检查是否跨目录跳转到了其他沙箱源
    for(var i=0; i<sources.length; i++){
      var s = sources[i];
      if(s && s.sandboxDir){
        var sDirNorm = s.sandboxDir.replace(/\\/g, '/').toLowerCase();
        var pNorm = pathname.replace(/\\/g, '/').toLowerCase();
        if(pNorm.indexOf(sDirNorm) >= 0){
          var targetFile = pathname.split(/[\\/]/).pop();
          if(targetFile && targetFile.toLowerCase().endsWith('.html')){
            var isMain = (targetFile.toLowerCase() === (s.mainHtmlFile||s.name||'').toLowerCase());
            if(s !== currentSource){
              currentSource = s;
              try { if (typeof window !== 'undefined' && window.Store && typeof window.Store.setCurrentSource === 'function') window.Store.setCurrentSource(s); } catch (e) {}
              s.activeSubFile = targetFile;
              loadSourceDocs(s);
              applyKind(false);
              try{ if(typeof loadDesc==='function')loadDesc(); }catch(e){}
              if(locEl) locEl.textContent = s.displayName + (!isMain ? (' / ' + targetFile.replace(/\.html$/i, '')) : '');
              renderSourceList();
            } else if(s.activeSubFile !== targetFile){
              s.activeSubFile = targetFile;
              if(locEl) locEl.textContent = s.displayName + (!isMain ? (' / ' + targetFile.replace(/\.html$/i, '')) : '');
              renderSourceList();
            }
            break;
          }
        }
      }
    }
  } catch(e) {}
}
window.onIframeNavigated = onIframeNavigated;

if(frame){
  frame.addEventListener('load', function(){
    setTimeout(onIframeNavigated, 60);
  });
}

/** ═══════ P0-A 安全沙箱桥接（宿主侧） ═══════
   目标：iframe 已配 sandbox="allow-scripts allow-forms"（无 allow-same-origin），
   原型脚本与宿主不同源，window.parent.protoAPI 不可达，全部拾取/跳转/打戳走受限协议。
   协议白名单 + nonce 回放绑定 + 1MB 载荷上限 + 来源与 origin 双校验。
   旧 LinkBind 的 proto-link / proto-link-stale / proto-mode / proto-goto 仍由 LinkBind
   自身监听处理，本桥仅处理新规范类型，避免双重消费。
   Wave-E 契约补记 (只加注释, 实现不变):
   @typedef {Object} SandboxBridgeMsg {type:string, nonce:string, source:string, payload?:Object}
   @typedef {string} BridgeDirection 'to-frame' (白名单 PICK_REQUEST/NAV_JUMP/STAMP_SET/proto-mode/proto-goto) | 'from-frame' (白名单 PICK_RESULT/NAV_JUMP/STAMP_SET/proto-link/proto-link-stale)
   @param {SandboxBridgeMsg} msg postMessage 受限消息 (白名单+nonce+1MB, 否则丢弃)
   @returns {string|null|Promise} sandboxSend* 返 nonce 或 null (超限/未白名单); sandboxRequestPick 返 Promise (15s 超时); 处理函数返布尔/空
 */
var SANDBOX_MAX_BYTES = 1048576;
var SANDBOX_ALLOWED_FROM_FRAME = { PICK_RESULT: 1, PICK_MISS: 1, ANNO_RECTS_RESULT: 1, ANNO_VIEW: 1, NAV_JUMP: 1, STAMP_SET: 1, CTRL_STATE: 1, HOVER: 1, ESCAPE: 1, 'proto-link': 1, 'proto-link-stale': 1 };
var SANDBOX_ALLOWED_TO_FRAME = { PICK_REQUEST: 1, ANNO_RECTS: 1, NAV_JUMP: 1, STAMP_SET: 1, DISARM: 1, 'proto-mode': 1, 'proto-goto': 1 };
var __sandboxPending = {};
function sandboxSafeScript(t){
  try { if(typeof safeScript === 'function') return safeScript(t); }catch(e){}
  return String(t || '').split('</scr' + 'ipt').join('<\\/scr' + 'ipt');
}
function sandboxMakeNonce(){
  try { return Date.now().toString(36) + '_' + Math.floor(Math.random() * 2176782336).toString(36); }
  catch(e){ return 'n_' + Date.now(); }
}
function sandboxPayloadBytes(o){
  try { return String(JSON.stringify(o)).length; }catch(e){ return 99999999; }
}
function sandboxValidNonce(n){
  return typeof n === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(n);
}
function sandboxIsTrustedFrameEvent(ev){
  try {
    if(!ev || !ev.source) return false;
    var fw = null;
    try { fw = (typeof frame !== 'undefined' && frame && frame.contentWindow) ? frame.contentWindow : null; }catch(e){}
    if(!fw || ev.source !== fw) return false;
    var org = ev.origin || '';
    if(org === 'null' || org === '') return true;
    try { if(typeof location !== 'undefined' && org === location.origin) return true; }catch(e2){}
    return false;
  }catch(e){ return false; }
}
function sandboxSendToFrame(type, payload){
  try {
    if(!SANDBOX_ALLOWED_TO_FRAME[type]) return null;
    if(!frame || !frame.contentWindow) return null;
    var nonce = sandboxMakeNonce();
    var msg = { type: type, nonce: nonce, source: 'host', payload: (payload && typeof payload === 'object') ? payload : {} };
    /* 兼容旧接收端：proto-mode / proto-goto 保持扁平字段 */
    if(type === 'proto-mode'){ msg = { type: type, edit: !!(payload && payload.edit) }; }
    if(type === 'proto-goto'){ msg = { type: type, page: String((payload && payload.page) || '').slice(0, 256) }; }
    if(type === 'PICK_REQUEST' || type === 'NAV_JUMP' || type === 'STAMP_SET' || type === 'DISARM'){
      msg.nonce = nonce;
      msg.source = 'host';
    }
    if(sandboxPayloadBytes(msg) > SANDBOX_MAX_BYTES) return null;
    try { frame.contentWindow.postMessage(msg, '*'); }catch(e){ return null; }
    return nonce;
  }catch(e){ return null; }
}
/* 标注包围盒批量查询：宿主给选择器，帧回包围盒（与 HOVER 同坐标系）；跨域预览下徽标定位唯一通道 */
function sandboxRequestAnnoRects(items, timeoutMs){
  try {
    var list = [];
    try {
      if (Array.isArray(items)) {
        for (var i = 0; i < items.length && i < 100; i++) {
          var it = items[i] || {};
          var key = String(it.key || '').slice(0, 128);
          var sel = String(it.selector || '').slice(0, 2000);
          if (key && sel) list.push({ key: key, selector: sel });
        }
      }
    } catch (e) {}
    if (!list.length) return Promise.resolve({ items: [], page: '' });
    var nonce = sandboxMakeNonce();
    var msg = { type: 'ANNO_RECTS', nonce: nonce, source: 'host', payload: { items: list } };
    if (sandboxPayloadBytes(msg) > SANDBOX_MAX_BYTES) return Promise.resolve({ items: [], page: '' });
    var to = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 5000;
    return new Promise(function(resolve){
      var done = false;
      var finish = function(v){ if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} try { delete __sandboxPending[nonce]; } catch (e2) {} resolve(v); };
      var timer = setTimeout(function(){ finish({ items: [], page: '', timeout: true }); }, to);
      __sandboxPending[nonce] = { kind: 'ANNO', resolve: function(v){ finish(v || { items: [], page: '' }); }, reject: function(){ finish({ items: [], page: '' }); }, timer: timer };
      try { frame.contentWindow.postMessage(msg, '*'); }
      catch(e){ finish({ items: [], page: '' }); }
    });
  }catch(e){ try { return Promise.resolve({ items: [], page: '' }); } catch (e2) { return null; } }
}
function sandboxRequestPick(timeoutMs){
  try {
    var nonce = sandboxMakeNonce();
    var msg = { type: 'PICK_REQUEST', nonce: nonce, source: 'host', payload: {} };
    if(sandboxPayloadBytes(msg) > SANDBOX_MAX_BYTES) return Promise.reject(new Error('payload too large'));
    var to = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 15000;
    return new Promise(function(resolve, reject){
      var timer = setTimeout(function(){
        try { delete __sandboxPending[nonce]; }catch(e){}
        reject(new Error('pick timeout'));
      }, to);
      __sandboxPending[nonce] = { kind: 'PICK', resolve: resolve, reject: reject, timer: timer };
      try { frame.contentWindow.postMessage(msg, '*'); }
      catch(e){ try{ clearTimeout(timer); }catch(e2){} try{ delete __sandboxPending[nonce]; }catch(e3){} reject(e); }
    });
  }catch(e){ return Promise.reject(e); }
}
/* 解除帧侧拾取武装（松开 Ctrl / 切换就地改单发后调用，清除准星与残留 armedPick） */
function sandboxSendDisarm(){
  return sandboxSendToFrame('DISARM', {});
}
function sandboxSendNavJump(page){
  var pg = String(page || '').slice(0, 256);
  return sandboxSendToFrame('NAV_JUMP', { page: pg });
}
function sandboxSendStamp(plid, selector, page){
  var id = String(plid || '').slice(0, 128).replace(/"/g, '');
  var sel = String(selector || '').slice(0, 2000);
  var pg = String(page || '').slice(0, 256);
  if(!id || !sel) return null;
  return sandboxSendToFrame('STAMP_SET', { plid: id, selector: sel, page: pg });
}
function sandboxHandleNavJumpMsg(d){
  try {
    var p = (d && d.payload && typeof d.payload === 'object') ? d.payload : d;
    var targetProto = String((p && (p.targetProto || p.proto)) || '').slice(0, 120);
    var targetPage = String((p && (p.targetPage || p.page)) || '').slice(0, 256);
    if(!targetProto) return false;
    var dest = null;
    try {
      for(var i = 0; i < sources.length; i++){
        if(sources[i] && sources[i].displayName === targetProto){ dest = sources[i]; break; }
      }
    }catch(e){}
    if(!dest){
      try { if(typeof libStatus === 'function') libStatus('跳转失败：目标原型「' + targetProto + '」不存在，可能已被删除或重命名。'); }catch(e){}
      return false;
    }
    try {
      if(window.LinkBind && typeof LinkBind.performLink === 'function'){
        LinkBind.performLink({ target: targetProto, targetPage: targetPage });
        return true;
      }
    }catch(e){}
    try {
      if(typeof closeAllDrawers === 'function') closeAllDrawers();
      else if(window.LinkBind && LinkBind.closeAllDrawers) LinkBind.closeAllDrawers();
    }catch(e){}
    try { loadSource(dest); }catch(e){ return false; }
    if(targetPage){
      setTimeout(function(){
        try { sandboxSendNavJump(targetPage); }catch(e){}
        try {
          if(window.LinkBind && LinkBind.onFrameLoad) return;
          if(frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'proto-goto', page: targetPage }, '*');
        }catch(e2){}
      }, 350);
    }
    return true;
  }catch(e){ return false; }
}
function onSandboxFrameMessage(ev){
  try {
    if(!sandboxIsTrustedFrameEvent(ev)) return;
    var d = ev.data;
    if(!d || typeof d !== 'object') return;
    var t = d.type;
    if(!t || !SANDBOX_ALLOWED_FROM_FRAME[t]) return;
    if(sandboxPayloadBytes(d) > SANDBOX_MAX_BYTES) return;
    /* 旧类型交由 LinkBind 自身监听消费，本桥不重复处理 */
    if(t === 'proto-link' || t === 'proto-link-stale') return;
    /* 修饰键状态广播（帧内焦点时宿主收不到键盘事件）：只含 Control/Meta/Shift 布尔态，
     * 绝不含内容按键；来源已校验（ev.source），免 nonce（广播非回执），载荷 1MB 上限内 */
    if(t === 'CTRL_STATE'){
      try{
        var cpl = (d.payload && typeof d.payload === 'object') ? d.payload : {};
        var cst = { key: String(cpl.key || ''), ctrlKey: !!cpl.ctrlKey, metaKey: !!cpl.metaKey, shiftKey: !!cpl.shiftKey, altKey: !!cpl.altKey };
        if(typeof window !== 'undefined' && typeof window.__onRemoteCtrlState === 'function') window.__onRemoteCtrlState(cst);
      }catch(e){}
      return;
    }
    /* 未武装命中补偿：帧未武装但用户按住 Ctrl 点击（武装在途/帧重载等竞态），
     * 宿主处于拾取态即收编，避免首次点击丢失；免 nonce（来源已校验） */
    if(t === 'PICK_MISS'){
      try{
        var mpl = (d.payload && typeof d.payload === 'object') ? d.payload : {};
        var mres = {
          selector: String(mpl.selector || '').slice(0, 2000),
          tagName: String(mpl.tagName || '').slice(0, 32),
          text: String(mpl.text || '').slice(0, 500),
          rect: (mpl.rect && typeof mpl.rect === 'object') ? mpl.rect : null,
          page: String(mpl.page || '').slice(0, 256),
          shift: !!mpl.shiftKey,
          dname: String(mpl.dname || '').slice(0, 64),
          ancestors: (function(){ var o=[]; try{ var a=mpl.ancestors; if(Array.isArray(a)){ for(var i=0;i<a.length&&i<8;i++) o.push(String(a[i]||'').slice(0,128)); } }catch(e){} return o; })(),
          parentHtml: String(mpl.parentHtml || '').slice(0, 2000),
          pickIndex: (typeof mpl.pickIndex === 'number') ? mpl.pickIndex : -1
        };
        if(mres.selector && typeof window !== 'undefined' && typeof window.__onRemotePickMiss === 'function') window.__onRemotePickMiss(mres);
      }catch(e){}
      return;
    }
    /* 帧视图变化（滚动/换页）：节流重排画布徽标 */
    if(t === 'ANNO_VIEW'){
      try{ if(typeof window !== 'undefined' && typeof window.__onAnnoViewChanged === 'function') window.__onAnnoViewChanged(); }catch(e){}
      return;
    }
    /* 帧内 Esc 转发：焦点在帧内时宿主收不到 Esc，统一经注册表处理（拾取取消/就地改关闭/栈顶弹窗） */
    if(t === 'ESCAPE'){
      try{
        if(typeof window !== 'undefined' && typeof window.__onRemoteEscape === 'function') window.__onRemoteEscape();
      }catch(e){}
      return;
    }
    /* 帧内悬停：武装拾取期间元素变化时上报包围盒，宿主绘高亮框（节流：仅变化时发送） */
    if(t === 'HOVER'){
      try{
        var hpl = (d.payload && typeof d.payload === 'object') ? d.payload : {};
        var hrect = (hpl.rect && typeof hpl.rect === 'object') ? hpl.rect : null;
        if(typeof window !== 'undefined' && typeof window.__onRemoteHover === 'function') window.__onRemoteHover(hrect);
      }catch(e){}
      return;
    }
    if(!sandboxValidNonce(d.nonce)) return;
    /* 标注包围盒回包：按 nonce 结算 ANNO 等待（无匹配/超时一律空列表，不抛错） */
    if(t === 'ANNO_RECTS_RESULT'){
      var apend = null;
      try { apend = __sandboxPending[d.nonce]; } catch(e) {}
      if(apend && apend.kind === 'ANNO'){
        try { clearTimeout(apend.timer); }catch(e){}
        try { delete __sandboxPending[d.nonce]; }catch(e2){}
        var aitems = [];
        try {
          var apl = (d.payload && typeof d.payload === 'object') ? d.payload : {};
          var rawItems = Array.isArray(apl.items) ? apl.items : [];
          for(var ai = 0; ai < rawItems.length && ai < 100; ai++){
            var rit = rawItems[ai] || {};
            var rrect = (rit.rect && typeof rit.rect === 'object') ? rit.rect : null;
            if(rrect){
              var rn = function(v){ var n = Number(v); return (isFinite(n) ? n : 0); };
              rrect = { left: rn(rrect.left), top: rn(rrect.top), width: Math.max(0, rn(rrect.width)), height: Math.max(0, rn(rrect.height)) };
            }
            aitems.push({ key: String(rit.key || '').slice(0, 128), rect: rrect });
          }
          var apage = String(apl.page || '').slice(0, 256);
          try { apend.resolve({ items: aitems, page: apage }); } catch(e3) {}
        }catch(e4){ try { apend.resolve({ items: [], page: '' }); } catch(e5) {} }
      }
      return;
    }
    if(t === 'PICK_RESULT'){
      var pend = __sandboxPending[d.nonce];
      if(!pend || pend.kind !== 'PICK') return;
      try { clearTimeout(pend.timer); }catch(e){}
      try { delete __sandboxPending[d.nonce]; }catch(e2){}
        try {
          var pl = (d.payload && typeof d.payload === 'object') ? d.payload : {};
          var sel = String(pl.selector || '').slice(0, 2000);
          var tag = String(pl.tagName || '').slice(0, 32);
          var txt = String(pl.text || '').slice(0, 500);
          var pg = String(pl.page || '').slice(0, 256);
          var anc = []; try{ var pa=pl.ancestors; if(Array.isArray(pa)){ for(var ai=0;ai<pa.length&&ai<8;ai++) anc.push(String(pa[ai]||'').slice(0,128)); } }catch(e0){}
          var ph = ''; try{ ph=String(pl.parentHtml||'').slice(0,2000); }catch(e1){}
          var dnw = ''; try{ dnw=String(pl.dname||'').slice(0,64); }catch(e2){}
          var shf = false; try{ shf=!!(pl.shiftKey||pl.shift); }catch(e3){}
          var pidxr = -1; try{ pidxr=(typeof pl.pickIndex==='number')?pl.pickIndex:-1; }catch(e4){}
          pend.resolve({ selector: sel, tagName: tag, text: txt, dname: dnw, rect: (pl.rect && typeof pl.rect === 'object') ? pl.rect : null, page: pg, nonce: d.nonce, ancestors: anc, parentHtml: ph, shift: shf, shiftKey: shf, pickIndex: pidxr });
      }catch(e){ try{ pend.reject(e); }catch(e2){} }
      return;
    }
    if(t === 'NAV_JUMP'){
      sandboxHandleNavJumpMsg(d);
      return;
    }
    if(t === 'STAMP_SET'){
      /* 帧侧回执：若宿主曾登记同 nonce 等待则结算，否则忽略 */
      var sp = __sandboxPending[d.nonce];
      if(sp){
        try { clearTimeout(sp.timer); }catch(e){}
        try { delete __sandboxPending[d.nonce]; }catch(e2){}
        try { sp.resolve({ ok: true, plid: String(d.plid || '').slice(0, 128) }); }catch(e3){}
      }
      return;
    }
  }catch(e){}
}
try {
  if(!window.__sandboxBridgeBound){
    window.addEventListener('message', onSandboxFrameMessage);
    window.__sandboxBridgeBound = true;
  }
}catch(e){}
function sandboxAgentSource(){
  return [
    '(function(){',
    '  var ALLOW={PICK_REQUEST:1,ANNO_RECTS:1,NAV_JUMP:1,STAMP_SET:1,DISARM:1,"proto-mode":1,"proto-goto":1};',
    '  var MAXB=1048576;',
    '  function bytes(o){ try{ return String(JSON.stringify(o)).length; }catch(e){ return 99999999; } }',
    '  function okNonce(n){ return typeof n==="string" && /^[A-Za-z0-9_-]{8,64}$/.test(n); }',
    '  var armedPick=null;',
    '  var lastHoverKey="@@";',
    '  function inFormFocus(){ try{ var ae=document.activeElement; if(!ae) return false; var tg=""; try{ tg=String(ae.tagName||"").toUpperCase(); }catch(e){} if(tg==="INPUT"||tg==="TEXTAREA"||tg==="SELECT") return true; try{ if(ae.isContentEditable) return true; }catch(e2){} }catch(e3){} return false; }',
    '  function sendCtrlState(ev,force){ try{ if(!force&&inFormFocus()) return; var k=""; try{ k=String(ev.key||""); }catch(e){} if(k!=="Control"&&k!=="Meta"&&k!=="Shift") return; var mm={type:"CTRL_STATE", source:"frame", payload:{key:k, ctrlKey:!!ev.ctrlKey, metaKey:!!ev.metaKey, shiftKey:!!ev.shiftKey, altKey:!!ev.altKey}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e2){} }catch(e3){} }',
    '  function sendEscape(ev){ try{ var k=""; try{ k=String(ev.key||""); }catch(e){} if(k!=="Escape"&&k!=="Esc"&&ev.keyCode!==27) return; var mm={type:"ESCAPE", source:"frame", payload:{}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e2){} }catch(e3){} }',
    '  function hoverKey(tt){ try{ var s=String(tt.tagName||""); var c=""; try{ c=String(tt.className||"").split(/\\s+/)[0]||""; }catch(e){} return s+"|"+c+"|"+(tt.id||""); }catch(e){} return ""; }',
    '  function sendHover(rect){ try{ var mm={type:"HOVER", source:"frame", payload:{rect:rect}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e){} }catch(e2){} }',
    '  function escCss(s, dv){ try{ if(dv && dv.CSS && dv.CSS.escape) return dv.CSS.escape(s); }catch(e){} return String(s).replace(/[^a-zA-Z0-9_-]/g, function(c){ return "\\\\"+c; }); }',
    '  function makeSel(el){',
    '    try{',
    '      var d=el.ownerDocument;',
    '      try{ var prid=el.getAttribute && el.getAttribute("data-pr-id"); if(prid && prid.length<64 && prid.indexOf(String.fromCharCode(34))<0){ var e0=escCss(prid, d.defaultView); try{ if(d.querySelectorAll("[data-pr-id=\\""+e0+"\\"]").length===1) return "[data-pr-id=\\""+e0+"\\"]"; }catch(e){} } }catch(e1){}',
    '      try{ var tid=el.getAttribute && el.getAttribute("data-testid"); if(tid && tid.length<64 && tid.indexOf(String.fromCharCode(34))<0){ var e1=escCss(tid, d.defaultView); try{ if(d.querySelectorAll("[data-testid=\\""+e1+"\\"]").length===1) return "[data-testid=\\""+e1+"\\"]"; }catch(e){} } }catch(e2){}',
    '      if(el.id && d.getElementById(el.id)===el && !/^[0-9]/.test(el.id) && el.id.length<64){ return "#"+escCss(el.id, d.defaultView); }',
    '      var chain=[], n=el;',
    '      while(n && n.nodeType===1 && n!==d.body && n!==d.documentElement){ var tg=String(n.tagName||"").toLowerCase(); if(!tg) break; var seg=tg; try{ var c0=String(n.className||"").split(/\\s+/)[0]; if(c0) seg=tg+"."+escCss(c0, d.defaultView); }catch(e3){} chain.unshift(seg); n=n.parentElement; }',
    '      for(var i=chain.length-1;i>=0;i--){ var cand=chain.slice(i).join(" > "); try{ if(d.querySelectorAll(cand).length===1) return cand; }catch(e4){} }',
    '      var parts=[], m=el;',
    '      while(m && m.nodeType===1 && m!==d.body && m!==d.documentElement){ var t2=String(m.tagName||"").toLowerCase(); if(!t2) break; var th=1, sib=m.previousElementSibling; while(sib){ try{ if(String(sib.tagName).toLowerCase()===t2) th++; }catch(e5){} sib=sib.previousElementSibling; } parts.unshift(t2+":nth-of-type("+th+")"); m=m.parentElement; }',
    '      return parts.join(" > ");',
    '    }catch(e){ return ""; }',
    '  }',
    '  window.addEventListener("message", function(ev){',
    '    try{',
    '      var dd=ev.data; if(!dd || typeof dd!=="object") return;',
    '      if(ev.source !== window.parent) return;',
    '      if(!ALLOW[dd.type]) return;',
    '      if(bytes(dd) > MAXB) return;',
    '      if((dd.type==="PICK_REQUEST"||dd.type==="ANNO_RECTS"||dd.type==="NAV_JUMP"||dd.type==="STAMP_SET") && !okNonce(dd.nonce)) return;',
    '      if(dd.type==="PICK_REQUEST"){ armedPick=dd.nonce; try{ lastHoverKey="@@"; }catch(ex){} try{ if(document.documentElement) document.documentElement.style.cursor="crosshair"; }catch(e){} }',
    '      else if(dd.type==="DISARM"){ armedPick=null; try{ if(document.documentElement) document.documentElement.style.cursor=""; }catch(e){} }',
    '      else if(dd.type==="ANNO_RECTS"){ try{',
    '        var _items=[]; try{ var _pl=(dd.payload&&typeof dd.payload==="object")?dd.payload:{}; if(Array.isArray(_pl.items)) _items=_pl.items.slice(0,100); }catch(e){}',
    '        var _out=[];',
    '        for(var _ai=0;_ai<_items.length;_ai++){',
    '          try{',
    '            var _it=_items[_ai]||{}; var _key=String(_it.key||"").slice(0,128); var _sel=String(_it.selector||"").slice(0,2000);',
    '            var _rr=null;',
    '            if(_key&&_sel){ try{ var _all=document.querySelectorAll(_sel); for(var _aj=0;_aj<(_all?_all.length:0);_aj++){ var _el=_all[_aj]; if(!_el||_el.nodeType!==1) continue; try{ var _b=_el.getBoundingClientRect(); if(_b&&(Number(_b.width)>0||Number(_b.height)>0)){ _rr={left:_b.left,top:_b.top,width:_b.width,height:_b.height}; break; } }catch(e){} } if(!_rr){ try{ var _f0=document.querySelector(_sel); if(_f0){ var _b0=_f0.getBoundingClientRect(); _rr={left:_b0.left,top:_b0.top,width:_b0.width,height:_b0.height}; } }catch(e){} } }catch(e){}}',
    '            _out.push({key:_key, rect:_rr});',
    '          }catch(e){}',
    '        }',
    '        var _pg=""; try{ _pg=String((location.hash||"").replace(/^#/,"")).slice(0,256); }catch(e){}',
    '        var _rm={type:"ANNO_RECTS_RESULT", nonce:dd.nonce, source:"frame", payload:{items:_out, page:_pg}};',
    '        if(bytes(_rm) > MAXB) return;',
    '        try{ window.parent.postMessage(_rm, "*"); }catch(e){}',
    '      }catch(e){} }',
    '      else if(dd.type==="NAV_JUMP"){ var pp=(dd.payload&&typeof dd.payload==="object")?dd.payload:dd; if(typeof pp.page==="string" && !pp.targetProto && !pp.proto){ var h=String(pp.page||"").slice(0,256); try{ location.hash=h; }catch(e2){} } }',
    '      else if(dd.type==="STAMP_SET"){ var qp=(dd.payload&&typeof dd.payload==="object")?dd.payload:dd; if(qp && typeof qp.plid==="string" && typeof qp.selector==="string"){ var pid=String(qp.plid).slice(0,128).split(String.fromCharCode(34)).join(""); var ss=String(qp.selector).slice(0,2000); if(pid && ss){ try{ var all=document.querySelectorAll(ss); if(all && all.length===1){ try{ all[0].setAttribute("data-plink", pid); }catch(e3){} } }catch(e4){} try{ window.parent.postMessage({type:"STAMP_SET", nonce:dd.nonce, plid:pid, ok:true, source:"frame"}, "*"); }catch(e5){} } } }',
    '    }catch(e){}',
    '  });',
    '  document.addEventListener("keydown", function(ev){ try{ sendCtrlState(ev,true); }catch(e){} try{ sendEscape(ev); }catch(e2){} }, true);',
    '  document.addEventListener("keyup", function(ev){ try{ sendCtrlState(ev,true); }catch(e){} }, true);',
    '  document.addEventListener("mousemove", function(ev){ try{ if(!armedPick) return; var tt=ev.target; if(!tt||tt.nodeType!==1) return; var tg=""; try{ tg=String(tt.tagName||"").toLowerCase(); }catch(e){} if(tg==="html"||tg==="body"||tg==="script"||tg==="style") return; var hk=hoverKey(tt); if(hk===lastHoverKey) return; lastHoverKey=hk; var rr=null; try{ var b=tt.getBoundingClientRect(); rr={left:b.left,top:b.top,width:b.width,height:b.height}; }catch(e2){} sendHover(rr); }catch(e3){} }, true);',
    '  document.addEventListener("mouseleave", function(ev){ try{ lastHoverKey="@@"; if(!armedPick) return; sendHover(null); }catch(e){} }, true);',
    '  var annoViewT=null;',
    '  function sendAnnoView(){ try{ var mm={type:"ANNO_VIEW", source:"frame", payload:{}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e){} }catch(e2){} }',
    '  function queueAnnoView(){ try{ if(annoViewT) return; annoViewT=setTimeout(function(){ try{ annoViewT=null; }catch(e){} try{ sendAnnoView(); }catch(e2){} },200); }catch(e){} }',
    '  document.addEventListener("scroll", function(ev){ try{ queueAnnoView(); }catch(e){} }, true);',
    '  window.addEventListener("hashchange", function(ev){ try{ sendAnnoView(); }catch(e){} }, true);',
    '  function pickDname(tt){',
    '    try{',
    '      var grab=function(s){ s=String(s||"").replace(/\\s+/g," ").trim(); var m=s.match(/[\\u4e00-\\u9fff][\\u4e00-\\u9fff\\w\\d\\s，。、；：？！·—…]{0,20}/); return m?String(m[0]).trim().slice(0,24):""; };',
    '      var d=grab(tt.textContent); if(d) return d;',
    '      try{ var ar=tt.getAttribute&&(tt.getAttribute("aria-label")||tt.getAttribute("title")); d=grab(ar); if(d) return d; }catch(e){}',
    '      try{ var p=tt.parentElement; if(p){ var ch=p.children||[]; for(var i=0;i<ch.length&&i<20;i++){ if(ch[i]===tt) continue; d=grab(ch[i].textContent); if(d) return d; } } }catch(e){}',
    '      try{ if(tt.parentElement){ d=grab(tt.parentElement.textContent); if(d&&d.length<=24) return d; } }catch(e){}',
    '    }catch(e){}',
    '    return "";',
    '  }',
    '  document.addEventListener("click", function(ev){',
    '    var missMode=false, missShift=false;',
    '    if(!armedPick){ try{ var ck=false; try{ ck=!!(ev.ctrlKey||ev.metaKey); missShift=!!ev.shiftKey; }catch(e){} if(!ck) return; missMode=true; }catch(ex){ return; } }',
    '    var tt=ev.target; if(!tt || tt.nodeType!==1) return;',
    '    var tg2=""; try{ tg2=String(tt.tagName||"").toLowerCase(); }catch(e){}',
    '    if(tg2==="html"||tg2==="body") return;',
    '    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e2){}',
    '    var nn="";',
    '    if(missMode){ nn=""; } else { nn=armedPick; armedPick=null; try{ if(document.documentElement) document.documentElement.style.cursor=""; }catch(e3){} }',
    '    var s2=""; try{ s2=makeSel(tt); }catch(e4){}',
    '    var pidx=-1; try{ if(s2){ var _al=document.querySelectorAll(s2); for(var _ai=0;_ai<_al.length;_ai++){ if(_al[_ai]===tt){ pidx=_ai; break; } } } }catch(e4b){}',
    '    var tx=""; try{ tx=String(tt.textContent||"").trim().replace(/\\s+/g," ").slice(0,120); }catch(e5){}',
    '    var dn=""; try{ dn=pickDname(tt); }catch(e9){}',
    '    var rr=null; try{ var b=tt.getBoundingClientRect(); rr={left:b.left,top:b.top,width:b.width,height:b.height}; }catch(e6){}',
    '    var hh=""; try{ hh=String((location.hash||"").replace(/^#/,"")).slice(0,256); }catch(e7){}',
    '    var anc=[]; try{ var _an=tt.parentElement, _ad=0; while(_an && _an.nodeType===1 && _ad<8){ var _at=""; try{ _at=String(_an.tagName||"").toLowerCase(); }catch(ex){} if(!_at||_at==="html") break; var _as=_at; try{ var _ac=""; try{ _ac=String((_an.getAttribute&&_an.getAttribute("class"))||"").split(/\\s+/)[0]||""; }catch(ex2){} if(_ac) _as+="."+_ac; }catch(ex3){} try{ if(_an.id) _as+="#"+String(_an.id).slice(0,64); }catch(ex4){} anc.unshift(_as); _an=_an.parentElement; _ad++; } }catch(e9){}',
    '    var ph=""; try{ var _pe=tt.parentElement; if(_pe&&_pe.outerHTML) ph=String(_pe.outerHTML).slice(0,2000); }catch(e10){}',
    '    var mm={type:(missMode?"PICK_MISS":"PICK_RESULT"), nonce:nn, source:"frame", payload:{selector:String(s2||"").slice(0,2000), tagName:String(tg2||"").slice(0,32), text:String(tx||"").slice(0,500), dname:String(dn||"").slice(0,64), rect:rr, page:hh, shiftKey:(!!missShift||!!ev.shiftKey), ancestors:anc, parentHtml:ph, pickIndex:(typeof pidx==="number"?pidx:-1)}};',
    '    if(bytes(mm) > MAXB) return;',
    '    try{ window.parent.postMessage(mm, "*"); }catch(e8){}',
    '  }, true);',
    '})();'
  ].join('\n');
}
function sandboxInjectBridge(wrappedHtml){
  try {
    var html = String(wrappedHtml || '');
    var tag = '<script data-sandbox-bridge>' + sandboxSafeScript(sandboxAgentSource()) + '</scr' + 'ipt>';
    if(/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function(m){ return m + tag; });
    if(/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, function(m){ return m + '<head>' + tag + '</head>'; });
    if(/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, tag + '</body>');
    return tag + html;
  }catch(e){
    try { return String(wrappedHtml || ''); }catch(e2){ return ''; }
  }
}
function sandboxSecureSrcdoc(rawHtml, opts){
  try {
    var base = rawHtml;
    try { base = (window.LinkBind && typeof LinkBind.wrapProtoHtml === 'function') ? LinkBind.wrapProtoHtml(rawHtml, opts) : rawHtml; }catch(e){ base = rawHtml; }
    return sandboxInjectBridge(base);
  }catch(e){ return String(rawHtml || ''); }
}
function sandboxEnforceAttr(){
  try {
    if(typeof frame !== 'undefined' && frame && frame.setAttribute){
      var cur = '';
      try { cur = String(frame.getAttribute('sandbox') || ''); }catch(e){}
      if(cur.indexOf('allow-scripts') < 0 || cur.indexOf('allow-same-origin') >= 0){
        frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      }
    }
  }catch(e){}
}
try { sandboxEnforceAttr(); }catch(e){}
 /* Wave-C/F: ProtoSandboxBridge 转 ESM 显式导出 (经典 window 挂载保留为兼容别名; 1MB 上限+nonce 白名单不变) */
const ProtoSandboxBridge = {
  MAX_BYTES: (typeof SANDBOX_MAX_BYTES !== 'undefined' ? SANDBOX_MAX_BYTES : 1048576),
  ALLOWED_FROM_FRAME: (typeof SANDBOX_ALLOWED_FROM_FRAME !== 'undefined' ? SANDBOX_ALLOWED_FROM_FRAME : null),
  ALLOWED_TO_FRAME: (typeof SANDBOX_ALLOWED_TO_FRAME !== 'undefined' ? SANDBOX_ALLOWED_TO_FRAME : null),
  makeNonce: sandboxMakeNonce,
  sendToFrame: sandboxSendToFrame,
  requestPick: sandboxRequestPick,
  sendNavJump: sandboxSendNavJump,
  sendStamp: sandboxSendStamp,
  sendDisarm: sandboxSendDisarm,
  isTrusted: sandboxIsTrustedFrameEvent,
  handleNavJump: sandboxHandleNavJumpMsg,
  secureSrcdoc: sandboxSecureSrcdoc,
  injectBridge: sandboxInjectBridge,
  enforceAttr: sandboxEnforceAttr
};
try {
  window.ProtoSandboxBridge = ProtoSandboxBridge;
  window.__sandboxBridge = window.ProtoSandboxBridge;
}catch(e){}
/* 帧侧 Agent 模板: 以 js/sandbox-agent.js 为准, 本地 sandboxAgentSource() 仅作 file:// 降级回退;
 * ESM 下最佳努力同步 (失败静默, 不影响经典路径)。 */
try {
  if (typeof window !== 'undefined' && !window.__EXPORT_BOOT__) {
    try {
      const _ap = import('./sandbox-agent.js');
      if (_ap && typeof _ap.then === 'function') {
        _ap.then(function (m) {
          try {
            if (m && typeof m.sandboxAgentSource === 'function') {
              const a = String(m.sandboxAgentSource() || '');
              const b = String((typeof sandboxAgentSource === 'function' ? sandboxAgentSource() : '') || '');
              if (a && a.length > 100 && Math.abs(a.length - b.length) > 0 && console && console.warn) {
                try { console.warn('[sandbox] agent template drift: module=' + a.length + ' embedded=' + b.length); } catch (e) {}
              }
            }
          } catch (e) {}
        }).catch(function(){});
      }
    } catch (e) {}
  }
} catch (e2) {}
/* FIX: 经典<script>加载，移除ESM export(以window.ProtoSandboxBridge为准，见上) */
