/**
 * src/renderer/features/preview/PreviewFrame.tsx — srcdoc 安全沙箱 iframe 宿主（W3-02，方案 B）。
 *
 * 旧语义对齐（js/sandbox-core.js / js/sandbox-agent.js 只读参考）：
 * - iframe 只走 srcDoc，绝不设跨域 URL；sandbox 属性固定 `allow-scripts allow-forms`
 *   （SANDBOX_ATTR，与旧 `sandboxEnforceAttr` 一致，**不含 allow-same-origin**）；
 * - 帧内 Agent 由 secure-srcdoc 注入；父窗经 postMessage 收 HOVER / PICK_RESULT / CTRL_STATE /
 *   SCROLL，不读 contentDocument、不读 contentWindow.location；
 * - 拾取看门狗：document.activeElement === frame 即焦点在帧内，保持会话不退出；
 * - 悬停/选中 rect 在帧视口坐标系上报，本组件经 frameScaleFromWidths + scaleRectToPage
 *   换算为页面（client）坐标后再交给父组件；
 * - __EXPORT_BOOT__ 下禁用拾取与注入（bindCtrlInspectListeners 首行 return 口径）；
 * - 就地改互斥：inlineOpen 为 true 时发 DISARM，不武装拾取；
 * - 选择器由帧内 generateSelector 生成（data-pr-id > data-testid > #id > 路径 > nth-of-type），
 *   供标注/链接/就地改作为稳定键（C6）。
 *
 * data-testid="stage-frame" 沿用 Stage 的外框，本组件只负责框内 iframe（testid="preview-frame"）。
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { frameScaleFromWidths, isFocusInFrame, scaleRectToPage, type PickRect } from './lib/iframe-pick';
import {
  SANDBOX_ATTR,
  buildDisarmMessage,
  buildPickRequestMessage,
  isAllowedFromFrame,
  isTrustedFrameEvent,
  postToFrame,
  sandboxSafeScript,
  secureSrcdoc,
  type FrameBridgeMessage,
} from './lib/secure-srcdoc';
import type { SourceKind, SourceSubPage } from '@/stores/sources-store';

/** 拾取到的元素（rect 已换算为页面/client 坐标）。 */
export interface PreviewPickedElement {
  /** 稳定选择器（generateSelector 生成；标注/链接/就地改的键）。 */
  selector: string;
  /**
   * 同 selector 命中列表中的 0 基序号（帧内 snapshot 计算）。
   * 多元素共用同一 selector 时，代码编辑按该序号精确定位目标元素。
   */
  pickIndex?: number;
  tagName: string;
  text: string;
  rect: PickRect;
}

/** 点击瞬间的修饰键快照（帧桥 PICK_RESULT 原样回传，父窗据此判定拾取意图）。 */
export interface PickModifierState {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface PreviewFrameProps {
  /** 预览 HTML（只走 srcDoc，绝不拼成跨域 URL）。 */
  html: string;
  /** 端别（仅透传到 DOM data 属性，布局由 Stage 决定）。 */
  kind?: SourceKind;
  /** 当前源沙箱目录（仅透传 data 属性，便于 E2E/调试定位）。 */
  sandboxDir?: string;
  /** 子页面清单（仅透传数量；实际切换由 Stage 工具栏驱动）。 */
  subPages?: SourceSubPage[];
  /** 拾取是否武装（Ctrl/Meta 按住态由 Stage 持有）。 */
  pickEnabled?: boolean;
  /** 缩放盒 scale（帧尺寸不可测时的兜底；正常路径用 frameScaleFromWidths）。 */
  scale?: number;
  /** iframe title（无障碍）。 */
  title?: string;
  /** 悬停元素（已换算为页面坐标；null=移出/隐藏）。 */
  onHoverElement?: (el: PreviewPickedElement | null) => void;
  /** 点选元素（父组件按 ev 的 ctrl/meta/shift 做 toggle / 单选替换）。 */
  onPickElement?: (el: PreviewPickedElement, ev: PickModifierState) => void;
  /** 帧文档滚动（父组件隐藏悬停框/重绘选中框）。 */
  onFrameScroll?: () => void;
  /** 看门狗判定应退出拾取（焦点既不在帧内也不在文档内）。 */
  onWatchdogExit?: () => void;
  /** 帧内 Ctrl/Meta/Shift 状态（Stage 用它同步武装态并识别「松开修饰键」）。 */
  onPickModifierChange?: (state: PickModifierState) => void;
  /**
   * 就地改是否打开（受控开关）。
   * true 时本帧发 DISARM 禁拾取（悬停/点选/准星/看门狗补拾取一律让路）。缺省 false。
   */
  inlineOpen?: boolean;
}

function isExportBoot(): boolean {
  try {
    return (window as unknown as { __EXPORT_BOOT__?: unknown }).__EXPORT_BOOT__ === true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rectOf(value: unknown): PickRect | null {
  const rec = asRecord(value);
  const left = Number(rec.left);
  const top = Number(rec.top);
  const width = Number(rec.width);
  const height = Number(rec.height);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { left, top, width, height };
}

/** 帧桥载荷 → 修饰键快照（缺省一律 false，避免把 undefined 当按住）。 */
function modifiersOf(payload: Record<string, unknown>): PickModifierState {
  return {
    ctrlKey: payload.ctrlKey === true,
    metaKey: payload.metaKey === true,
    shiftKey: payload.shiftKey === true,
  };
}

/** 帧桥载荷 → pickIndex（非负整数才算有效，其余归一为 undefined）。 */
function pickIndexOf(payload: Record<string, unknown>): number | undefined {
  const value = Number(payload.pickIndex);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 帧内 rect 响应器（选中框跟随滚动/缩放用）。
 *
 * 只复用已冻结的帧桥协议：父窗经 LinkBind.requestAnnoRectsInFrame 发 `ANNO_RECTS`，
 * 本响应器按 selector 现取 getBoundingClientRect 后回 `ANNO_RECTS_RESULT`。
 * 不新增协议名、不读 contentDocument，选中框无需在拾取时固化 rect。
 */
const PICK_RECT_RESPONDER_ATTR = 'data-pick-rect-responder';

function pickRectResponderSource(): string {
  return [
    '(function(){',
    '  if (window.__protoPickRectResponder) return;',
    '  window.__protoPickRectResponder = true;',
    '  function rectOf(el){',
    '    try{ var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }catch(e){ return null; }',
    '  }',
    '  function send(payload){',
    '    try{',
    '      var msg = { type: "ANNO_RECTS_RESULT", nonce: Date.now().toString(36) + "_" + Math.floor(Math.random() * 2176782336).toString(36), source: "frame", payload: payload };',
    '      if(window.parent && window.parent !== window) window.parent.postMessage(msg, "*");',
    '    }catch(e){}',
    '  }',
    '  window.addEventListener("message", function(ev){',
    '    try{',
    '      if(ev.source !== window.parent) return;',
    '      var d = ev.data;',
    '      if(!d || typeof d !== "object" || d.type !== "ANNO_RECTS") return;',
    '      var p = (d.payload && typeof d.payload === "object") ? d.payload : {};',
    '      var list = Array.isArray(p.items) ? p.items : [];',
    '      var out = [];',
    '      for(var i = 0; i < list.length; i++){',
    '        var it = list[i] || {};',
    '        var key = String(it.key || "");',
    '        var selector = String(it.selector || "");',
    '        var el = null;',
    '        if(selector){ try{ el = document.querySelector(selector); }catch(e1){ el = null; } }',
    '        out.push({ key: key, selector: selector, rect: el ? rectOf(el) : null });',
    '      }',
    '      send({ items: out });',
    '    }catch(e){}',
    '  });',
    '})();',
  ].join('\n');
}

/**
 * 把选中框 rect 响应器追加进 srcdoc（幂等；不改动 secure-srcdoc 的既有注入）。
 * @param html secureSrcdoc 产物
 * @returns 含响应器的 HTML
 */
export function injectPickRectResponder(html: string): string {
  const source = String(html ?? '');
  if (new RegExp('<script[^>]*' + PICK_RECT_RESPONDER_ATTR, 'i').test(source)) return source;
  const tag =
    '<script ' + PICK_RECT_RESPONDER_ATTR + '>' + sandboxSafeScript(pickRectResponderSource()) + '</scr' + 'ipt>';
  if (/<\/body\s*>/i.test(source)) return source.replace(/<\/body\s*>/i, function (m) { return tag + m; });
  if (/<\/html\s*>/i.test(source)) return source.replace(/<\/html\s*>/i, function (m) { return tag + m; });
  return tag + source;
}

/** 帧内 rect → 页面坐标（移动端外层 scale 由 frameScaleFromWidths 实测）。 */
function toPageRect(rect: PickRect, frame: HTMLIFrameElement | null, fallbackScale: number): PickRect {
  if (!frame) return rect;
  const frameRect = frame.getBoundingClientRect();
  let scale = frameScaleFromWidths(frameRect.width, frame.clientWidth || frameRect.width);
  if ((!frameRect.width || !frame.clientWidth) && Number.isFinite(fallbackScale) && fallbackScale > 0) {
    scale = fallbackScale;
  }
  return scaleRectToPage(rect, { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height }, scale);
}

const PreviewFrame: React.FC<PreviewFrameProps> = function PreviewFrame(props: PreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pickRef = useRef(!!props.pickEnabled);
  const inlineRef = useRef(!!props.inlineOpen);
  const hoverRef = useRef(props.onHoverElement);
  const pickCbRef = useRef(props.onPickElement);
  const scrollRef = useRef(props.onFrameScroll);
  const watchdogRef = useRef(props.onWatchdogExit);
  const modifierRef = useRef(props.onPickModifierChange);

  // 回调/开关同步到 ref：事件监听只注册一次，始终读最新值（不在 render 期写 ref）。
  useEffect(function () {
    pickRef.current = !!props.pickEnabled;
    inlineRef.current = !!props.inlineOpen;
    hoverRef.current = props.onHoverElement;
    pickCbRef.current = props.onPickElement;
    scrollRef.current = props.onFrameScroll;
    watchdogRef.current = props.onWatchdogExit;
    modifierRef.current = props.onPickModifierChange;
  }, [
    props.pickEnabled,
    props.inlineOpen,
    props.onHoverElement,
    props.onPickElement,
    props.onFrameScroll,
    props.onWatchdogExit,
    props.onPickModifierChange,
  ]);

  // 安全 srcdoc：注入帧内 Agent + 选中框 rect 响应器（__EXPORT_BOOT__ 下原样返回，不注入）。
  const srcdoc = useMemo(function () {
    if (isExportBoot()) return props.html;
    return injectPickRectResponder(secureSrcdoc(props.html, { from: props.title || '' }));
  }, [props.html, props.title]);

  // 父 → 帧：按武装态发 PICK_REQUEST / DISARM（inlineOpen/exportBoot 一律 DISARM）。
  useEffect(function () {
    if (isExportBoot()) return;
    const frame = frameRef.current;
    if (!frame) return;
    const armed = !!props.pickEnabled && !props.inlineOpen;
    postToFrame(frame, armed ? buildPickRequestMessage() : buildDisarmMessage());
    if (!armed && hoverRef.current) hoverRef.current(null);
  }, [props.pickEnabled, props.inlineOpen, srcdoc]);

  // 帧 → 父：只接受当前帧 source 的消息（opaque origin 允许 origin='null'）。
  useEffect(function () {
    if (isExportBoot()) return;
    const onMessage = function (ev: MessageEvent): void {
      const frame = frameRef.current;
      if (!frame) return;
      let frameWindow: Window | null = null;
      try {
        frameWindow = frame.contentWindow;
      } catch {
        frameWindow = null;
      }
      if (!isTrustedFrameEvent(ev, frameWindow)) return;
      const data = ev.data as FrameBridgeMessage | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (!isAllowedFromFrame(data.type)) return;
      const payload = asRecord(data.payload);

      if (data.type === 'HOVER') {
        const rect = rectOf(payload.rect);
        if (!rect) {
          if (hoverRef.current) hoverRef.current(null);
          return;
        }
        if (hoverRef.current) {
          hoverRef.current({
            selector: textOf(payload.selector),
            pickIndex: pickIndexOf(payload),
            tagName: textOf(payload.tagName),
            text: textOf(payload.text),
            rect: toPageRect(rect, frame, props.scale && props.scale > 0 ? props.scale : 1),
          });
        }
        return;
      }

      if (data.type === 'PICK_RESULT' || data.type === 'PICK_MISS') {
        const rect = rectOf(payload.rect);
        if (!rect) return;
        if (hoverRef.current) hoverRef.current(null);
        if (pickCbRef.current) {
          pickCbRef.current(
            {
              selector: textOf(payload.selector),
              pickIndex: pickIndexOf(payload),
              tagName: textOf(payload.tagName),
              text: textOf(payload.text),
              rect: toPageRect(rect, frame, props.scale && props.scale > 0 ? props.scale : 1),
            },
            modifiersOf(payload),
          );
        }
        return;
      }

      if (data.type === 'CTRL_STATE') {
        if (modifierRef.current) modifierRef.current(modifiersOf(payload));
        return;
      }

      if (data.type === 'SCROLL') {
        if (scrollRef.current) scrollRef.current();
      }
    };
    window.addEventListener('message', onMessage);
    return function () {
      window.removeEventListener('message', onMessage);
    };
  }, [props.scale]);

  // 拾取看门狗（沿用旧语义 E-p0c：焦点在帧内不退出；失去焦点才请求退出）。
  useEffect(function () {
    if (isExportBoot()) return;
    const onBlur = function (): void {
      try {
        const frame = frameRef.current;
        if (isFocusInFrame(document.activeElement, frame)) return;
        if (pickRef.current && watchdogRef.current) watchdogRef.current();
      } catch { /* ignore */ }
    };
    const timer = window.setInterval(function () {
      try {
        if (!pickRef.current) return;
        const frame = frameRef.current;
        if (isFocusInFrame(document.activeElement, frame)) return;
        if (!document.hasFocus() && watchdogRef.current) watchdogRef.current();
      } catch { /* ignore */ }
    }, 300);
    window.addEventListener('blur', onBlur);
    return function () {
      window.removeEventListener('blur', onBlur);
      window.clearInterval(timer);
    };
  }, []);

  const onLoad = function (): void {
    if (isExportBoot()) return;
    const frame = frameRef.current;
    if (!frame) return;
    // load 后帧内 Agent 刚初始化：按当前武装态补发一次（就绪早于 effect 的情况）。
    const armed = pickRef.current && !inlineRef.current;
    postToFrame(frame, armed ? buildPickRequestMessage() : buildDisarmMessage());
  };

  return (
    <iframe
      ref={frameRef}
      data-testid="preview-frame"
      data-kind={props.kind || 'pc'}
      data-sandbox-dir={props.sandboxDir || ''}
      data-subpages={props.subPages ? props.subPages.length : 0}
      title={props.title || '原型预览'}
      sandbox={SANDBOX_ATTR}
      srcDoc={srcdoc}
      onLoad={onLoad}
      style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
    />
  );
};

export default PreviewFrame;
