/** [js/sandbox-agent.js] Wave-C/F: 帧侧 Agent 独立模板 (ESM)
 * 来源: js/sandbox-core.js sandboxAgentSource() 内嵌字符串数组 (Wave-A ProtoSandboxBridge 受限协议)。
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} SandboxMsg {type:string, nonce:string, source:'host'|'frame', payload?:Object}
 * @typedef {string} FrameMsgType PICK_RESULT|NAV_JUMP|STAMP_SET|proto-link|proto-link-stale (帧->宿主白名单)
 * @typedef {string} HostMsgType PICK_REQUEST|NAV_JUMP|STAMP_SET|proto-mode|proto-goto (宿主->帧白名单)
 * @param {SandboxMsg} msg 受限协议消息 (白名单+nonce 8-64位+1MB上限, 否则丢弃)
 * @returns {string} sandboxAgentSource() 返回帧侧注入源码 (与 sandbox-core 内嵌副本同构)
 * 目标: 宿主侧 (sandbox-core) 与帧侧模板解耦, 帧侧仅经 postMessage 受限交互, 1MB 上限 + nonce 白名单。
 * 兼容:
 *  - 宿主经典文件经动态 import('./sandbox-agent.js') 最佳努力加载, file:// + 导出单文件失败时
 *    回退 sandbox-core 内嵌副本 (零 breaking, 见 sandbox-core 桥接段)。
 *  - 导出单文件内联时经 stripEsmForExport 剥离 export 转经典 (file:// module CORS 降级)。
 */
export const SANDBOX_MAX_BYTES = 1048576;
export const SANDBOX_ALLOWED_FROM_FRAME = { PICK_RESULT: 1, PICK_MISS: 1, ANNO_RECTS_RESULT: 1, ANNO_VIEW: 1, NAV_JUMP: 1, STAMP_SET: 1, CTRL_STATE: 1, HOVER: 1, ESCAPE: 1, 'proto-link': 1, 'proto-link-stale': 1 };
export const SANDBOX_ALLOWED_TO_FRAME = { PICK_REQUEST: 1, ANNO_RECTS: 1, NAV_JUMP: 1, STAMP_SET: 1, DISARM: 1, 'proto-mode': 1, 'proto-goto': 1 };

/* 帧侧注入脚本源码 (与 sandbox-core 内嵌副本同构; 修改时两处同步, Wave-D 删除内嵌副本) */
export function sandboxAgentSource() {
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

export default sandboxAgentSource;
