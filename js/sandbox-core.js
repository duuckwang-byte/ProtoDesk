/* [js/sandbox-core.js] 状态声明 + 端别 + 原型加载 + 源列表与虚拟分组（由 app.js 拆分，顺序勿乱调） */
/* ═══════ 左侧源文件列表栏 ═══════
 列表项 = 沙箱原型文件夹（html + md）。全部以 srcdoc 注入 iframe；
 「新增原型」导入的文件先进沙箱再打开。 */
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
var kindTagEl=$('kindTag'), kindSegEl=$('kindSeg'); // @deprecated kindTagEl 保留兼容，避免外部引用断裂，当前端别切换由 kindSeg 统一
var btnKindMobileEl=$('btnKindMobile'), btnKindPcEl=$('btnKindPc');
var btnSbCollapseEl=$('btnSbCollapse'), sbFabEl=$('sbFab'), sbTriggerEl=$('sbTrigger'), docsFabEl=$('docsFab');

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
 /* 顶部标签/分段控件 */
 if(kindTagEl)kindTagEl.textContent=kind==='pc'?'PC 端':'移动端';
 if(kindTagEl)kindTagEl.className='kind-tag '+(kind==='pc'?'pc':'mobile');
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
  currentSource = src;
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
    frame.setAttribute('srcdoc', window.LinkBind ? LinkBind.wrapProtoHtml(src.content, { links: src._links||[], mode: (typeof EDIT_MODE!=='undefined'&&EDIT_MODE), from: src.displayName||src.name }) : src.content);
  }else{
    /* 旧版恢复的 method:'src' 源：有内容时回退 srcdoc 注入，避免空白 */
    if(src.content){ frame.setAttribute('srcdoc', window.LinkBind ? LinkBind.wrapProtoHtml(src.content, { links: src._links||[], mode: (typeof EDIT_MODE!=='undefined'&&EDIT_MODE), from: src.displayName||src.name }) : src.content); }
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
   hint:parent?('在「'+groupNameOf(parent)+'」内新建二级文件夹（最多两级）。'):'虚拟分组：仅用于原型分类整理，不创建真实目录。',
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
          if(typeof loadSandboxSources==='function') loadSandboxSources(s.displayName);
        } else {
          showToast('创建失败：' + ((r&&r.error)||'未知错误'));
        }
      }).catch(function(e){ showToast('创建失败：' + (e&&e.message||e)); });
    }
  });
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
          if(typeof loadSandboxSources === 'function') loadSandboxSources(s.displayName);
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
        if(typeof loadSandboxSources==='function') loadSandboxSources(s.displayName);
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
  if(window.LinkBind) LinkBind.closeInspector();
  if(window.AnnotationEngine && typeof AnnotationEngine.closeAll === 'function') AnnotationEngine.closeAll();
  editHideHover();
  loadSourceDocs(s);

  if(s.sandboxDir && window.protoAPI && window.protoAPI.sandbox && window.protoAPI.sandbox.readFile){
    window.protoAPI.sandbox.readFile({ dir: s.sandboxDir, file: subFile }).then(function(r){
      var content = (r && r.ok) ? r.content : '';
      if(!content) content = '<!DOCTYPE html><html><body><h1>' + escHtml(subFile) + '</h1></body></html>';
      frame.setAttribute('srcdoc', window.LinkBind ? LinkBind.wrapProtoHtml(content, { links: s._links||[], mode: (typeof EDIT_MODE!=='undefined'&&EDIT_MODE), from: subFile, dir: s.sandboxDir }) : content);
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
  var countBadge = hasSub ? '<span class="sb-sub-count" title="包含 ' + (s.subPages.length + 1) + ' 个页面">' + (s.subPages.length + 1) + 'P</span>' : '';

  it.innerHTML = arrowHtml + '<span class="nm">' + escHtml(s.displayName) + '</span>' + countBadge;
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
   loadSandboxSources();
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

/* ═══════ Iframe 路由与子页面/跨目录跳转双向同步 ═══════ */
function onIframeNavigated(){
  try {
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
              s.activeSubFile = targetFile;
              loadSourceDocs(s);
              applyKind(false);
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
