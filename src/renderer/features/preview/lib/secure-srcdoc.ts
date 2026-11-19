/**
 * src/renderer/features/preview/lib/secure-srcdoc.ts — 沙箱 srcdoc 注入与帧桥协议（W3-02，方案 B）。
 *
 * 对齐旧渲染器（只读参考）：
 * - `js/sandbox-core.js:1373-1381 sandboxSecureSrcdoc`：先用 LinkBind.wrapProtoHtml 包一层，再注入帧内 Agent；
 * - `js/sandbox-core.js:1386 sandboxEnforceAttr`：sandbox 属性强制 `allow-scripts allow-forms`
 *   （**不含 allow-same-origin**，与旧渲染器一致）；
 * - `js/sandbox-core.js:947-1100`：帧桥白名单、nonce、1MB 载荷上限、origin/source 双向校验；
 * - `js/sandbox-agent.js`：帧内 Agent（拾取上报、HOVER、CTRL_STATE、NAV_JUMP、STAMP_SET、ANNO_RECTS…）。
 *
 * 本轮最小实现：
 * - 注入 Agent 负责“拾取/悬停/修饰键/滚动”上报，父窗只经 postMessage 消费，**不再读 contentDocument**；
 *   拾取快照带 `pickIndex`（同 selector 命中列表序号），供 Ctrl+Shift「修改文字」直接写盘精确定位；
 * - 协议白名单保留链接/标注/AI 帧桥所需类型（`proto-link` / `STAMP_SET` / `ANNO_RECTS` / `proto-mode`…），
 *   具体业务（链接点击、标注角标、AI 编辑态）由 W3-08/W3-07 在 protocol 之上填充；
 * - `wrapProtoLinks` 为最小桩：本轮原样返回，W3-08 移植 `LinkBind.wrapProtoHtml` 后替换。
 *
 * 安全基线：
 * - 帧文档处于 opaque origin，**不能**读取父窗 DOM/Storage；
 * - 父窗只从 `frame.contentWindow` 接收消息，`origin` 允许 `'null'`（沙箱 srcdoc）或同源；
 * - 所有消息经类型白名单 + 1MB 上限校验；host → frame 的指令带随机 nonce。
 */

import { CROSSHAIR_CSS, CROSSHAIR_STYLE_ID, generateSelector } from './iframe-pick';

/** 预览 iframe 的 sandbox 属性（旧渲染器逐字口径：allow-scripts allow-forms）。 */
export const SANDBOX_ATTR = 'allow-scripts allow-forms';

/** 帧内 Agent 脚本标记（幂等注入 + E2E 静态断言）。 */
export const SANDBOX_BRIDGE_ATTR = 'data-sandbox-bridge';

/** 帧桥单条消息上限（逐字沿用旧实现 1MB）。 */
export const SANDBOX_MAX_BYTES = 1048576;

/** 帧 → 父窗允许的消息类型（逐字对齐 `sandbox-core.js:947` + SCROLL 扩展）。 */
export const SANDBOX_ALLOWED_FROM_FRAME = {
  PICK_RESULT: true,
  PICK_MISS: true,
  ANNO_RECTS_RESULT: true,
  ANNO_VIEW: true,
  NAV_JUMP: true,
  STAMP_SET: true,
  CTRL_STATE: true,
  HOVER: true,
  SCROLL: true,
  ESCAPE: true,
  'proto-link': true,
  'proto-link-stale': true,
} as const;

/** 父窗 → 帧允许的消息类型（逐字对齐 `sandbox-core.js:948`）。 */
export const SANDBOX_ALLOWED_TO_FRAME = {
  PICK_REQUEST: true,
  ANNO_RECTS: true,
  NAV_JUMP: true,
  STAMP_SET: true,
  DISARM: true,
  'proto-mode': true,
  'proto-goto': true,
} as const;

export type FromFrameType = keyof typeof SANDBOX_ALLOWED_FROM_FRAME;
export type ToFrameType = keyof typeof SANDBOX_ALLOWED_TO_FRAME;

/** 帧桥消息（与 `js/sandbox-agent.js` 的 SandboxMsg typedef 同名同形）。 */
export interface FrameBridgeMessage {
  type: string;
  nonce: string;
  source: 'host' | 'frame' | string;
  payload: Record<string, unknown>;
}

/** secureSrcdoc 选项（links/mode/from 对应旧 sandboxSecureSrcdoc 的 opts）。 */
export interface SecureSrcdocOptions {
  /** 链接绑定清单（最小桩阶段保留字段，W3-08 消费）。 */
  links?: unknown[];
  /** 编辑态（false = 预览拾取态）。 */
  mode?: boolean;
  /** 来源原型显示名（旧实现用于链接包装）。 */
  from?: string;
  /** 是否注入帧内 Agent（默认 true；导出/静态渲染可关）。 */
  injectBridge?: boolean;
}

/* ═══════════ 基础工具 ═══════════ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 脚本正文转义：把 `</script`（大小写不敏感）转成 `<\/script`，避免内联脚本提前闭合。
 * @param source 脚本正文
 * @returns 可安全放进 <script> 的正文
 */
export function sandboxSafeScript(source: string): string {
  return String(source ?? '').replace(/<\/script/gi, '<\\/script');
}

/**
 * 生成帧桥 nonce（旧 sandboxMakeNonce 口径：时间戳 36 进制 + 随机数）。
 * @returns 8..64 位 [A-Za-z0-9_-] 字符串
 */
export function makeBridgeNonce(): string {
  try {
    return Date.now().toString(36) + '_' + Math.floor(Math.random() * 2176782336).toString(36);
  } catch {
    return 'n_' + Date.now().toString(36);
  }
}

/** nonce 是否合法（旧 sandboxValidNonce 口径）。 */
export function isValidBridgeNonce(nonce: unknown): boolean {
  return typeof nonce === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(nonce);
}

/** 载荷字节数（JSON 长度近似；序列化失败回一个超大值）。 */
export function bridgePayloadBytes(value: unknown): number {
  try {
    return String(JSON.stringify(value)).length;
  } catch {
    return 99999999;
  }
}

/** 是否为允许的帧 → 父窗消息类型。 */
export function isAllowedFromFrame(type: unknown): type is FromFrameType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(SANDBOX_ALLOWED_FROM_FRAME, type);
}

/** 是否为允许的父窗 → 帧消息类型。 */
export function isAllowedToFrame(type: unknown): type is ToFrameType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(SANDBOX_ALLOWED_TO_FRAME, type);
}

/** 是否为帧桥消息（宽校验；业务字段由消费方再校验）。 */
export function isBridgeMessage(value: unknown): value is FrameBridgeMessage {
  const rec = asRecord(value);
  return !!rec && typeof rec.type === 'string' && typeof rec.source === 'string';
}

/**
 * 构造 host → frame 指令（白名单 + 1MB 上限 + nonce）。
 * @param type 指令类型（必须命中 SANDBOX_ALLOWED_TO_FRAME）
 * @param payload 业务载荷（非对象归一为 {}）
 * @param nonce 可选固定 nonce（默认随机）
 * @returns 消息对象；类型非法/超限回 null
 */
export function buildFrameMessage(
  type: ToFrameType | string,
  payload?: unknown,
  nonce?: string,
): FrameBridgeMessage | null {
  if (!isAllowedToFrame(type)) return null;
  const safePayload = asRecord(payload) ?? {};
  const msg: FrameBridgeMessage = {
    type,
    nonce: isValidBridgeNonce(nonce) ? String(nonce) : makeBridgeNonce(),
    source: 'host',
    payload: safePayload,
  };
  if (bridgePayloadBytes(msg) > SANDBOX_MAX_BYTES) return null;
  return msg;
}

/** PICK_REQUEST（武装拾取）。 */
export function buildPickRequestMessage(): FrameBridgeMessage | null {
  return buildFrameMessage('PICK_REQUEST', {});
}

/** DISARM（解除拾取）。 */
export function buildDisarmMessage(): FrameBridgeMessage | null {
  return buildFrameMessage('DISARM', {});
}

/** 链接跳转帧桥最小桩（W3-08/W3-07 消费同一协议）。 */
export function buildNavJumpMessage(page: string): FrameBridgeMessage | null {
  return buildFrameMessage('NAV_JUMP', { page: String(page || '').slice(0, 256) });
}

/** 标注角标写入帧桥最小桩（STAMP_SET）。 */
export function buildStampMessage(plid: string, selector: string, page: string): FrameBridgeMessage | null {
  const id = String(plid || '').slice(0, 128).replace(/"/g, '');
  const sel = String(selector || '').slice(0, 2000);
  if (!id || !sel) return null;
  return buildFrameMessage('STAMP_SET', { plid: id, selector: sel, page: String(page || '').slice(0, 256) });
}

/** 标注矩形查询最小桩（ANNO_RECTS）。 */
export function buildAnnoRectsMessage(
  items: Array<{ key?: unknown; selector?: unknown }>,
): FrameBridgeMessage | null {
  const list: Array<{ key: string; selector: string }> = [];
  if (Array.isArray(items)) {
    for (const item of items.slice(0, 100)) {
      const key = String(item?.key ?? '').slice(0, 128);
      const selector = String(item?.selector ?? '').slice(0, 2000);
      if (key && selector) list.push({ key, selector });
    }
  }
  if (!list.length) return null;
  return buildFrameMessage('ANNO_RECTS', { items: list });
}

/** AI/就地改编辑态切换最小桩（proto-mode）。 */
export function buildProtoModeMessage(edit: boolean): FrameBridgeMessage | null {
  return buildFrameMessage('proto-mode', { edit: !!edit });
}

/**
 * 父窗 → 帧投递（唯一允许的 contentWindow 用法：postMessage，不读 location/document）。
 * @param frame 预览 iframe
 * @param msg 已构造的消息
 * @returns 是否投递成功
 */
export function postToFrame(frame: HTMLIFrameElement | null, msg: FrameBridgeMessage | null): boolean {
  if (!frame || !msg) return false;
  try {
    const win = frame.contentWindow;
    if (!win) return false;
    win.postMessage(msg, '*');
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验消息来源是否为当前预览帧（旧 sandboxIsTrustedFrameEvent 口径）。
 * sandbox 后的 srcdoc 为 opaque origin，`ev.origin` 可能是 `'null'`/`''`，此时只信 source。
 * @param ev message 事件
 * @param frameWindow 预览帧 contentWindow
 * @returns true=可信
 */
export function isTrustedFrameEvent(
  ev: MessageEvent | null | undefined,
  frameWindow: Window | null | undefined,
): boolean {
  try {
    if (!ev || !frameWindow || ev.source !== frameWindow) return false;
    const origin = typeof ev.origin === 'string' ? ev.origin : '';
    if (origin === '' || origin === 'null') return true;
    if (typeof window === 'undefined') return false;
    return origin === window.location.origin;
  } catch {
    return false;
  }
}

/* ═══════════ 注入 ═══════════ */

/**
 * 链接包装最小桩：旧实现为 `LinkBind.wrapProtoHtml(rawHtml, opts)`。
 * 本轮不做链接改写（W3-08 装配链接时替换本函数），必须原样返回以避免破坏原型 HTML。
 */
export function wrapProtoLinks(rawHtml: string, _opts?: SecureSrcdocOptions): string {
  void _opts;
  return String(rawHtml ?? '');
}

/**
 * 帧内 Agent 源码：拾取/悬停/修饰键/滚动 + 链接/标注帧桥最小桩。
 * 选择器实现由 `generateSelector.toString()` 注入，保证与父窗/单测同一套语义。
 */
export function sandboxAgentSource(): string {
  var selectorSource = generateSelector.toString();
  return [
    '(function(){',
    '  if (window.__protoSandboxAgent) return;',
    '  window.__protoSandboxAgent = true;',
    '  var MAXB = ' + SANDBOX_MAX_BYTES + ';',
    '  var STYLE_ID = ' + JSON.stringify(CROSSHAIR_STYLE_ID) + ';',
    '  var CSS_TEXT = ' + JSON.stringify(CROSSHAIR_CSS) + ';',
    '  var generateSelector = ' + selectorSource + ';',
    '  var armed = false;',
    '  var lastHoverKey = "";',
    '  function makeNonce(){ try{ return Date.now().toString(36) + "_" + Math.floor(Math.random() * 2176782336).toString(36); }catch(e){ return "n_" + Date.now().toString(36); } }',
    '  function bytes(o){ try{ return String(JSON.stringify(o)).length; }catch(e){ return 99999999; } }',
    '  function send(type, payload){',
    '    try{',
    '      var msg = { type: type, nonce: makeNonce(), source: "frame", payload: (payload && typeof payload === "object") ? payload : {} };',
    '      if(bytes(msg) > MAXB) return;',
    '      if(window.parent && window.parent !== window) window.parent.postMessage(msg, "*");',
    '    }catch(e){}',
    '  }',
    '  function pickable(el){',
    '    if(!el || el.nodeType !== 1) return false;',
    '    var tag = ""; try{ tag = String(el.tagName || "").toLowerCase(); }catch(e){}',
    '    if(!tag || tag === "html" || tag === "body" || tag === "head" || tag === "script" || tag === "style") return false;',
    '    return true;',
    '  }',
    '  function label(el){',
    '    try{',
    '      var tag = String(el.tagName || "").toLowerCase();',
    '      if(tag === "input" || tag === "textarea" || tag === "select"){',
    '        var v = String(el.value == null ? "" : el.value).replace(/\\s+/g, " ").trim();',
    '        if(v) return v.slice(0, 120);',
    '      }',
    '    }catch(e){ }',
    '    try{ var t = String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120); if(t) return t; }catch(e){}',
    '    try{ return String(el.tagName || "元素").toLowerCase(); }catch(e2){ return "元素"; }',
    '  }',
    '  function rectOf(el){',
    '    try{ var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }catch(e){ return null; }',
    '  }',
    '  function pickIndexOf(el, selector){',
    '    try{',
    '      if(!selector) return -1;',
    '      var all = document.querySelectorAll(selector);',
    '      for(var i = 0; i < all.length; i++){ if(all[i] === el) return i; }',
    '    }catch(e){}',
    '    return -1;',
    '  }',
    '  function snapshot(el){',
    '    var selector = "";',
    '    try{ selector = generateSelector(el); }catch(e){ selector = ""; }',
    '    /* pickIndex：当前元素在同 selector 命中列表中的 0 基序号，多命中时供代码编辑精确定位。 */',
    '    return { selector: selector, pickIndex: pickIndexOf(el, selector), tagName: String(el.tagName || "").toLowerCase(), text: label(el), rect: rectOf(el) };',
    '  }',
    '  function setCrosshair(on){',
    '    try{',
    '      var st = document.getElementById(STYLE_ID);',
    '      if(on){',
    '        if(!st){ st = document.createElement("style"); st.id = STYLE_ID; st.textContent = CSS_TEXT; (document.head || document.documentElement).appendChild(st); }',
    '      }else if(st && st.parentNode){ st.parentNode.removeChild(st); }',
    '    }catch(e){}',
    '  }',
    '  function hoverKey(el){',
    '    try{ return String(el.tagName || "") + "|" + String(el.id || "") + "|" + String(el.className || ""); }catch(e){ return ""; }',
    '  }',
    '  function onMove(ev){',
    '    if(!armed) return;',
    '    var el = ev.target;',
    '    if(!pickable(el)){ if(lastHoverKey !== ""){ lastHoverKey = ""; send("HOVER", { rect: null }); } return; }',
    '    var key = hoverKey(el);',
    '    if(key === lastHoverKey) return;',
    '    lastHoverKey = key;',
    '    send("HOVER", snapshot(el));',
    '  }',
    '  function onLeave(){',
    '    if(lastHoverKey === "") return;',
    '    lastHoverKey = "";',
    '    send("HOVER", { rect: null });',
    '  }',
    '  function onScroll(){ lastHoverKey = ""; send("SCROLL", {}); }',
    '  function onKey(ev){',
    '    try{ if(ev.key !== "Control" && ev.key !== "Meta" && ev.key !== "Shift") return; }catch(e){ return; }',
    '    send("CTRL_STATE", { key: String(ev.key || ""), ctrlKey: !!ev.ctrlKey, metaKey: !!ev.metaKey, shiftKey: !!ev.shiftKey, altKey: !!ev.altKey });',
    '  }',
    '  function onClick(ev){',
    '    var ctrl = false, meta = false, shift = false, alt = false;',
    '    try{ ctrl = !!ev.ctrlKey; meta = !!ev.metaKey; shift = !!ev.shiftKey; alt = !!ev.altKey; }catch(e){}',
    '    if(!armed && !(ctrl || meta)) return;',
    '    var el = ev.target;',
    '    if(!pickable(el)) return;',
    '    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}',
    '    var snap = snapshot(el);',
    '    snap.ctrlKey = ctrl;',
    '    snap.metaKey = meta;',
    '    snap.shiftKey = shift;',
    '    snap.altKey = alt;',
    '    /* Ctrl/Cmd 按住时保持武装：不松开可继续点选其他元素（多选/单选替换由父窗判定）。 */',
    '    if(ctrl || meta){ armed = true; setCrosshair(true); }',
    '    else { armed = false; setCrosshair(false); }',
    '    send("PICK_RESULT", snap);',
    '  }',
    '  function onMessage(ev){',
    '    try{',
    '      if(ev.source !== window.parent) return;',
    '      var d = ev.data; if(!d || typeof d !== "object") return;',
    '      if(d.type === "PICK_REQUEST"){ armed = true; lastHoverKey = ""; setCrosshair(true); }',
    '      else if(d.type === "DISARM"){ armed = false; setCrosshair(false); }',
    '      /* 链接/标注/AI 帧桥最小桩：协议类型已在父窗白名单冻结，业务实现在 W3-08/W3-07。 */',
    '      else if(d.type === "NAV_JUMP"){ var p = (d.payload && typeof d.payload === "object") ? d.payload : {}; if(typeof p.page === "string" && !p.targetProto && !p.proto){ try{ location.hash = String(p.page || "").slice(0, 256); }catch(e2){} } }',
    '      else if(d.type === "proto-goto"){ try{ location.hash = String((d.page || (d.payload && d.payload.page) || "")).slice(0, 256); }catch(e3){} }',
    '      else if(d.type === "STAMP_SET"){ var q = (d.payload && typeof d.payload === "object") ? d.payload : {}; if(typeof q.plid === "string" && typeof q.selector === "string"){ try{ var all = document.querySelectorAll(q.selector); if(all && all.length === 1){ all[0].setAttribute("data-plink", String(q.plid).slice(0, 128)); } }catch(e4){} } }',
    '    }catch(e){}',
    '  }',
    '  document.addEventListener("mousemove", onMove, true);',
    '  document.addEventListener("mouseleave", onLeave, true);',
    '  document.addEventListener("scroll", onScroll, true);',
    '  document.addEventListener("click", onClick, true);',
    '  document.addEventListener("keydown", onKey, true);',
    '  document.addEventListener("keyup", onKey, true);',
    '  window.addEventListener("message", onMessage);',
    '})();',
  ].join('\n');
}

/**
 * 把帧内 Agent 注入 HTML（旧 sandboxInjectBridge 口径：head → html → </body> → 前置）。
 * 幂等：已含 `data-sandbox-bridge` 的 HTML 不再重复注入。
 * @param html 原始 HTML
 * @returns 注入后的 HTML
 */
export function injectSandboxBridge(html: string): string {
  try {
    var source = String(html ?? '');
    if (/<script[^>]*data-sandbox-bridge/i.test(source)) return source;
    var tag = '<script ' + SANDBOX_BRIDGE_ATTR + '>' + sandboxSafeScript(sandboxAgentSource()) + '</scr' + 'ipt>';
    if (/<head[^>]*>/i.test(source)) {
      return source.replace(/<head[^>]*>/i, function (m) { return m + tag; });
    }
    if (/<html[^>]*>/i.test(source)) {
      return source.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + tag + '</head>'; });
    }
    if (/<\/body\s*>/i.test(source)) {
      return source.replace(/<\/body\s*>/i, function (m) { return tag + m; });
    }
    return tag + source;
  } catch {
    return String(html ?? '');
  }
}

/**
 * 安全 srcdoc 组装（旧 sandboxSecureSrcdoc 等价物）：
 * `wrapProtoLinks` → `injectSandboxBridge`。
 * @param rawHtml 原型 HTML
 * @param opts 选项（links/mode/from/injectBridge）
 * @returns 可赋给 iframe.srcdoc 的 HTML
 */
export function secureSrcdoc(rawHtml: string, opts?: SecureSrcdocOptions): string {
  const options = opts ?? {};
  const base = wrapProtoLinks(String(rawHtml ?? ''), options);
  if (options.injectBridge === false) return base;
  return injectSandboxBridge(base);
}
