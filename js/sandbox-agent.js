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
export const SANDBOX_ALLOWED_FROM_FRAME = { PICK_RESULT: 1, PICK_MISS: 1, NAV_JUMP: 1, STAMP_SET: 1, CTRL_STATE: 1, HOVER: 1, ESCAPE: 1, 'proto-link': 1, 'proto-link-stale': 1 };
export const SANDBOX_ALLOWED_TO_FRAME = { PICK_REQUEST: 1, NAV_JUMP: 1, STAMP_SET: 1, DISARM: 1, 'proto-mode': 1, 'proto-goto': 1 };

/* 帧侧注入脚本源码 (与 sandbox-core 内嵌副本同构; 修改时两处同步, Wave-D 删除内嵌副本) */
export function sandboxAgentSource() {
  return [
    '(function(){',
    '  var ALLOW={PICK_REQUEST:1,NAV_JUMP:1,STAMP_SET:1,DISARM:1,"proto-mode":1,"proto-goto":1};',
    '  var MAXB=1048576;',
    '  function bytes(o){ try{ return String(JSON.stringify(o)).length; }catch(e){ return 99999999; } }',
    '  function okNonce(n){ return typeof n==="string" && /^[A-Za-z0-9_-]{8,64}$/.test(n); }',
    '  var armedPick=null;',
    '  var lastHoverKey="@@";',
    '  function inFormFocus(){ try{ var ae=document.activeElement; if(!ae) return false; var tg=""; try{ tg=String(ae.tagName||"").toUpperCase(); }catch(e){} if(tg==="INPUT"||tg==="TEXTAREA"||tg==="SELECT") return true; try{ if(ae.isContentEditable) return true; }catch(e2){} }catch(e3){} return false; }',
    '  function sendCtrlState(ev){ try{ if(inFormFocus()) return; var k=""; try{ k=String(ev.key||""); }catch(e){} if(k!=="Control"&&k!=="Meta"&&k!=="Shift") return; var mm={type:"CTRL_STATE", source:"frame", payload:{key:k, ctrlKey:!!ev.ctrlKey, metaKey:!!ev.metaKey, shiftKey:!!ev.shiftKey, altKey:!!ev.altKey}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e2){} }catch(e3){} }',
    '  function sendEscape(ev){ try{ var k=""; try{ k=String(ev.key||""); }catch(e){} if(k!=="Escape"&&k!=="Esc"&&ev.keyCode!==27) return; var mm={type:"ESCAPE", source:"frame", payload:{}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e2){} }catch(e3){} }',
    '  function hoverKey(tt){ try{ var s=String(tt.tagName||""); var c=""; try{ c=String(tt.className||"").split(/\\s+/)[0]||""; }catch(e){} return s+"|"+c+"|"+(tt.id||""); }catch(e){} return ""; }',
    '  function sendHover(rect){ try{ var mm={type:"HOVER", source:"frame", payload:{rect:rect}}; if(bytes(mm) > MAXB) return; try{ window.parent.postMessage(mm, "*"); }catch(e){} }catch(e2){} }',
    '  function escCss(s, dv){ try{ if(dv && dv.CSS && dv.CSS.escape) return dv.CSS.escape(s); }catch(e){} return String(s).replace(/[^a-zA-Z0-9_-]/g, function(c){ return "\\\\"+c; }); }',
    '  function makeSel(el){',
    '    try{',
    '      var d=el.ownerDocument;',
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
    '      if((dd.type==="PICK_REQUEST"||dd.type==="NAV_JUMP"||dd.type==="STAMP_SET") && !okNonce(dd.nonce)) return;',
    '      if(dd.type==="PICK_REQUEST"){ armedPick=dd.nonce; try{ lastHoverKey="@@"; }catch(ex){} try{ if(document.documentElement) document.documentElement.style.cursor="crosshair"; }catch(e){} }',
    '      else if(dd.type==="DISARM"){ armedPick=null; try{ if(document.documentElement) document.documentElement.style.cursor=""; }catch(e){} }',
    '      else if(dd.type==="NAV_JUMP"){ var pp=(dd.payload&&typeof dd.payload==="object")?dd.payload:dd; if(typeof pp.page==="string" && !pp.targetProto && !pp.proto){ var h=String(pp.page||"").slice(0,256); try{ location.hash=h; }catch(e2){} } }',
    '      else if(dd.type==="STAMP_SET"){ var qp=(dd.payload&&typeof dd.payload==="object")?dd.payload:dd; if(qp && typeof qp.plid==="string" && typeof qp.selector==="string"){ var pid=String(qp.plid).slice(0,128).split(String.fromCharCode(34)).join(""); var ss=String(qp.selector).slice(0,2000); if(pid && ss){ try{ var all=document.querySelectorAll(ss); if(all && all.length===1){ try{ all[0].setAttribute("data-plink", pid); }catch(e3){} } }catch(e4){} try{ window.parent.postMessage({type:"STAMP_SET", nonce:dd.nonce, plid:pid, ok:true, source:"frame"}, "*"); }catch(e5){} } } }',
    '    }catch(e){}',
    '  });',
    '  document.addEventListener("keydown", function(ev){ try{ sendCtrlState(ev); }catch(e){} try{ sendEscape(ev); }catch(e2){} }, true);',
    '  document.addEventListener("keyup", function(ev){ try{ sendCtrlState(ev); }catch(e){} }, true);',
    '  document.addEventListener("mousemove", function(ev){ try{ if(!armedPick) return; var tt=ev.target; if(!tt||tt.nodeType!==1) return; var tg=""; try{ tg=String(tt.tagName||"").toLowerCase(); }catch(e){} if(tg==="html"||tg==="body"||tg==="script"||tg==="style") return; var hk=hoverKey(tt); if(hk===lastHoverKey) return; lastHoverKey=hk; var rr=null; try{ var b=tt.getBoundingClientRect(); rr={left:b.left,top:b.top,width:b.width,height:b.height}; }catch(e2){} sendHover(rr); }catch(e3){} }, true);',
    '  document.addEventListener("mouseleave", function(ev){ try{ lastHoverKey="@@"; if(!armedPick) return; sendHover(null); }catch(e){} }, true);',
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
    '    var tx=""; try{ tx=String(tt.textContent||"").trim().replace(/\\s+/g," ").slice(0,120); }catch(e5){}',
    '    var rr=null; try{ var b=tt.getBoundingClientRect(); rr={left:b.left,top:b.top,width:b.width,height:b.height}; }catch(e6){}',
    '    var hh=""; try{ hh=String((location.hash||"").replace(/^#/,"")).slice(0,256); }catch(e7){}',
    '    var mm={type:(missMode?"PICK_MISS":"PICK_RESULT"), nonce:nn, source:"frame", payload:{selector:String(s2||"").slice(0,2000), tagName:String(tg2||"").slice(0,32), text:String(tx||"").slice(0,500), rect:rr, page:hh, shiftKey:!!missShift}};',
    '    if(bytes(mm) > MAXB) return;',
    '    try{ window.parent.postMessage(mm, "*"); }catch(e8){}',
    '  }, true);',
    '})();'
  ].join('\n');
}

export default sandboxAgentSource;
