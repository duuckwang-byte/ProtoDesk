/**
 * src/renderer/features/preview/lib/iframe-pick.ts — 拾取纯函数（无 DOM 操作，可单元测试）。
 *
 * 旧语义来源（只读参考 js/edit-entry.js）：
 * - generateSelector：data-pr-id 唯一命中优先，其次 data-testid、#id，再逐级可读路径，兜底 nth-of-type 全路径；
 * - editRectToPage：page = frame.left + rect.left * s（s = getBoundingClientRect().width / clientWidth）；
 * - CTRL_PICK.toggle/toggleRemote：html/body 不可选；
 * - CTRL_PICK.enter：在帧文档注入 #ctrlPickCrosshairStyle（*{cursor:crosshair!important}）；
 * - 拾取看门狗：document.activeElement === frame 时焦点在帧内，保持会话不退出；
 * - 移动端：375 逻辑宽 + 动态视口高（W5）+ 外层 CSS zoom 缩放，拾取坐标经缩放换算
 *   （zoom 与 transform 的几何 API 口径一致：getBoundingClientRect=视觉值、clientWidth=逻辑值）。
 *
 * 本模块只做纯计算/纯字符串，绝不触碰 document/window/iframe，
 * 因此同源/跨域都安全（跨域 SecurityError 只可能发生在调用方 contentDocument 处）。
 */

/** 准星样式节点 id（沿用旧值 ctrlPickCrosshairStyle，E2E/static-verify 断言沿用）。 */
export const CROSSHAIR_STYLE_ID = 'ctrlPickCrosshairStyle';

/** 准星样式正文（沿用旧值 *{cursor:crosshair!important}）。 */
export const CROSSHAIR_CSS = '*{cursor:crosshair!important}';

/** 移动端逻辑视窗宽（沿用方案 §8.1：固定 375，外层 CSS zoom 缩放）。 */
export const MOBILE_VIEWPORT_W = 375;
/** 移动端参考机视口高（overview 整机可见口径；非 overview 视口高动态适配，W5）。 */
export const MOBILE_VIEWPORT_H = 780;

/**
 * 准星 <style> 注入字符串（调用方在同源 contentDocument 内创建节点时使用本字符串设 textContent）。
 * @returns style 节点 outerHTML 等价字符串
 */
export function buildCrosshairStyleTag(): string {
  return '<style id="' + CROSSHAIR_STYLE_ID + '">' + CROSSHAIR_CSS + '</style>';
}

/**
 * 是否为可拾取标签（沿用 CTRL_PICK.toggle/toggleRemote 的 html/body 过滤）。
 * @param tagName 标签名（大小写不敏感，非字符串回 false）
 * @returns true=可拾取；html/body/head/script/style 等 chrome 标签回 false
 */
export function isPickableTag(tagName: unknown): boolean {
  if (typeof tagName !== 'string') return false;
  var t = tagName.trim().toLowerCase();
  if (!t) return false;
  if (t === 'html' || t === 'body') return false;
  return true;
}

/** 矩形口径（CSS 像素，均为 getBoundingClientRect 语义）。 */
export interface PickRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 帧缩放比（沿用 editFrameScale：getBoundingClientRect().width / clientWidth）。
 * @param boundingWidth 帧 getBoundingClientRect().width
 * @param clientWidth 帧 clientWidth（<=0 时回 1，不抛错）
 * @returns 缩放比（非有限/<=0 回 1）
 */
export function frameScaleFromWidths(boundingWidth: number, clientWidth: number): number {
  try {
    var b = Number(boundingWidth);
    var c = Number(clientWidth);
    if (!isFinite(b) || !isFinite(c) || c <= 0) return 1;
    var s = b / c;
    if (!isFinite(s) || s <= 0) return 1;
    return s;
  } catch {
    return 1;
  }
}

/**
 * 帧内 rect → 页面坐标（沿用 editRectToPage：page = frame.left + rect.left * s）。
 * @param rect 帧视口 CSS 像素 rect
 * @param frameRect 帧元素自身 getBoundingClientRect
 * @param scale 帧缩放比（editFrameScale 口径）
 * @returns 页面坐标系矩形
 */
export function scaleRectToPage(rect: PickRect, frameRect: PickRect, scale: number): PickRect {
  var s = Number(scale);
  if (!isFinite(s) || s <= 0) s = 1;
  return {
    left: frameRect.left + rect.left * s,
    top: frameRect.top + rect.top * s,
    width: rect.width * s,
    height: rect.height * s,
  };
}

/**
 * 页面点 → 帧内点（scaleRectToPage 的逆运算；移动端缩放盒下拾取坐标换算用此函数）。
 * @param pageX 页面 clientX
 * @param pageY 页面 clientY
 * @param frameRect 帧元素自身 getBoundingClientRect
 * @param scale 帧缩放比
 * @returns 帧视口 CSS 像素坐标
 */
export function pagePointToFrame(pageX: number, pageY: number, frameRect: PickRect, scale: number): { x: number; y: number } {
  var s = Number(scale);
  if (!isFinite(s) || s <= 0) s = 1;
  return { x: (pageX - frameRect.left) / s, y: (pageY - frameRect.top) / s };
}

/**
 * 外层等比缩放盒 scale（移动端 375 逻辑宽在可用宽下的缩放）。
 * @param containerWidth 容器可用宽
 * @param viewportWidth 逻辑视窗宽（默认 375）
 * @returns 缩放比（非有限/<=0 回 1）
 */
export function scaleBoxScale(containerWidth: number, viewportWidth: number = MOBILE_VIEWPORT_W): number {
  try {
    var c = Number(containerWidth);
    var v = Number(viewportWidth);
    if (!isFinite(c) || !isFinite(v) || c <= 0 || v <= 0) return 1;
    return c / v;
  } catch {
    return 1;
  }
}

/**
 * 路径段拼选择器（generateSelector 的纯拼接部分：非空段以 ' > ' 连接）。
 * @param segments 路径段（如 ['div.main', 'button#ok']）
 * @returns 选择器字符串（全空回 ''）
 */
export function buildSelectorFromSegments(segments: Array<string | null | undefined>): string {
  return (segments || []).filter(function (s) { return typeof s === 'string' && s.trim() !== ''; }).join(' > ');
}

/**
 * 元素 → 稳定选择器（逐字移植 `js/edit-entry.js:612 generateSelector` 语义）。
 *
 * 优先级与旧实现一致：
 * 1. 唯一 `data-pr-id`（<64 字符、不含引号/换行；沙箱写入时会补此属性）；
 * 2. 唯一 `data-testid`；
 * 3. 唯一 `#id`（非数字开头、<64 字符）；
 * 4. 逐级可读路径 `tag / tag#id / tag.class`，从最短后缀开始试到根，取首个唯一匹配；
 * 5. 兜底 `tag:nth-of-type(n)` 全路径。
 *
 * 注意：本函数会被 `secure-srcdoc.sandboxAgentSource()` 经 Function.toString 注入 iframe，
 * 因此函数体必须**完全自包含**（不引用模块级常量/helper），否则帧内运行时会 ReferenceError。
 *
 * @param el 目标元素；null/非元素回 ''
 * @returns CSS 选择器（无法定位时可能回 ''）
 */
export function generateSelector(el: Element | null): string {
  if (!el) return '';
  var doc: Document | null = el.ownerDocument || null;
  if (!doc) return '';

  var cssEscape = function (value: string): string {
    try {
      var view: Window | null = doc ? doc.defaultView : null;
      var css = view ? (view as unknown as { CSS?: { escape?: (v: string) => string } }).CSS : null;
      if (css && typeof css.escape === 'function') return css.escape(value);
    } catch { /* ignore */ }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };

  var matchCount = function (selector: string): number {
    try {
      return doc ? doc.querySelectorAll(selector).length : 0;
    } catch {
      return -1;
    }
  };

  // 1) data-pr-id 唯一命中（旧实现返回未转义原值；查询时使用转义值）。
  try {
    var prid = el.getAttribute && el.getAttribute('data-pr-id');
    if (prid && prid.length < 64 && !/["'\n]/.test(prid)) {
      var escPrid = cssEscape(prid);
      if (matchCount('[data-pr-id="' + escPrid + '"]') === 1) return '[data-pr-id="' + prid + '"]';
    }
  } catch { /* ignore */ }

  // 2) data-testid 唯一命中。
  try {
    var tid = el.getAttribute && el.getAttribute('data-testid');
    if (tid && tid.length < 64 && !/["'\n]/.test(tid)) {
      var escTid = cssEscape(tid);
      if (matchCount('[data-testid="' + escTid + '"]') === 1) return '[data-testid="' + tid + '"]';
    }
  } catch { /* ignore */ }

  // 3) 唯一 id。
  try {
    var id = el.id;
    if (id && doc.getElementById(id) === el && !/^[0-9]/.test(id) && id.length < 64) {
      return '#' + cssEscape(id);
    }
  } catch { /* ignore */ }

  // 4) 逐级可读路径：tag / tag#id / tag.class，从最短后缀开始试唯一。
  var chain: string[] = [];
  var n: Element | null = el;
  while (n && n.nodeType === 1 && n !== doc.body && n !== doc.documentElement) {
    var tag = String(n.tagName || '').toLowerCase();
    if (!tag) break;
    var seg = tag;
    var nodeId = n.id;
    if (nodeId && !/^[0-9]/.test(String(nodeId)) && String(nodeId).length < 64) {
      seg = tag + '#' + cssEscape(String(nodeId));
    } else if (String(n.className || '').trim()) {
      var c0 = String(n.className).trim().split(/\s+/)[0];
      try {
        seg = tag + '.' + cssEscape(c0);
      } catch { /* ignore */ }
    }
    chain.unshift(seg);
    n = n.parentElement;
  }
  for (var i = chain.length - 1; i >= 0; i--) {
    var cand = chain.slice(i).join(' > ');
    if (matchCount(cand) === 1) return cand;
  }

  // 5) 兜底：tag:nth-of-type 全路径。
  var parts: string[] = [];
  var m: Element | null = el;
  while (m && m.nodeType === 1 && m !== doc.body && m !== doc.documentElement) {
    var tag2 = String(m.tagName || '').toLowerCase();
    if (!tag2) break;
    var nth = 1;
    var sib = m.previousElementSibling;
    while (sib) {
      if (String(sib.tagName).toLowerCase() === tag2) nth++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(tag2 + ':nth-of-type(' + nth + ')');
    m = m.parentElement;
  }
  return parts.join(' > ');
}

/**
 * 拾取总开关（沿用 bindCtrlInspectListeners 首行守卫 + INLINE_EDIT 互斥）。
 * @param flags exportBoot 是否处于 __EXPORT_BOOT__ 单文件模式；inlineOpen 就地改是否打开
 * @returns true=禁止拾取
 */
export function isPickDisabled(flags: { exportBoot: boolean; inlineOpen: boolean }): boolean {
  return !!(flags && (flags.exportBoot || flags.inlineOpen));
}

/**
 * 焦点是否在帧内（沿用拾取看门狗：document.activeElement === frame 时保持会话）。
 * 纯比较，不访问 DOM（调用方传入 activeElement 与 frame 引用）。
 * @param activeElement document.activeElement
 * @param frame iframe 元素
 * @returns true=焦点在帧内，不退出拾取
 */
export function isFocusInFrame(activeElement: unknown, frame: unknown): boolean {
  return !!frame && activeElement === frame;
}
