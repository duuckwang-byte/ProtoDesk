/**
 * src/renderer/features/preview/PickOverlay.tsx — 悬停框/选中框/角标定位（纯 props 渲染）。
 *
 * 旧语义对齐（js/edit-entry.js 只读参考）：
 * - 容器 id="selectionOverlay"（ensurePickOverlay 双保险创建口径；static-verify 断言此 id）；
 * - 选中框 class="selection-box-overlay"，序号角标 class="selection-badge"（E2E 按此计数）；
 * - 悬停框沿用 #editHover 口径：本组件以 props.hover 渲染，不直接读帧 DOM；
 * - renderOverlay 实时 getBoundingClientRect：由父组件在 scroll/hover/pick 时重读后传入 rect，本组件不缓存。
 *
 * 视觉口径（Wave4 pick-OBS-1）：
 * - 悬停框 = 2px 蓝色虚线 + 10% 半透明填充；选中框 = 2px 蓝色实线 + 14% 填充 + 序号角标；
 * - 所有框与角标 pointer-events:none，浮层不抢 iframe / Stage 工具栏的鼠标事件；
 * - box-sizing:border-box，边框计入 rect 尺寸，移动端 scale 后的 bbox 与帧内元素严格对齐；
 * - 坐标保留 3 位小数（移动端 scale=0.6008 时 rect 带小数，提前取整会让框漂移）。
 *
 * 同源安全：本文件只做绝对定位渲染，绝不访问 frame.contentWindow / contentDocument /
 * location（node -e 自检：无 contentWindow.location、无 contentDocument 跨域写法）。
 */
import React from 'react';

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PickOverlayProps {
  /** 悬停框（页面坐标系，null=隐藏）。 */
  hover: OverlayRect | null;
  /** 选中框列表（页面坐标系，顺序即角标 1..n）。 */
  selected: OverlayRect[];
}

/** 拾取高亮色（与 globals.css --cobalt 同源；写死十六进制，避免浮层在 token 缺失时不可见）。 */
const PICK_COLOR = '#2563eb';
const HOVER_FILL = 'rgba(37, 99, 235, 0.10)';
const SELECTED_FILL = 'rgba(37, 99, 235, 0.14)';

/** 数字 → CSS px（保留 3 位小数，NaN/Infinity 回 0）。 */
function toPx(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0px';
  return Math.round(n * 1000) / 1000 + 'px';
}

/**
 * rect → 绝对定位样式。
 * box-sizing:border-box 保证 2px 边框画在 rect 内侧，不把外接框撑大 4px。
 */
function overlayRectStyle(r: OverlayRect): React.CSSProperties {
  return {
    position: 'absolute',
    left: toPx(r.left),
    top: toPx(r.top),
    width: toPx(Math.max(0, r.width)),
    height: toPx(Math.max(0, r.height)),
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

/** 悬停框：虚线 + 浅填充，与选中框的实线/角标区分。 */
const HOVER_STYLE: React.CSSProperties = {
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: PICK_COLOR,
  backgroundColor: HOVER_FILL,
  borderRadius: 4,
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.65)',
};

/** 选中框：实线 + 稍深填充 + 白色内描边，保证深浅底图上都可见。 */
const SELECTED_STYLE: React.CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: PICK_COLOR,
  backgroundColor: SELECTED_FILL,
  borderRadius: 4,
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 1px 4px rgba(37, 99, 235, 0.22)',
};

/** 序号角标：压在选中框右上角，白描边 + 蓝底白字。 */
const BADGE_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: -10,
  right: -10,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 4px',
  borderWidth: 1.5,
  borderStyle: 'solid',
  borderColor: '#ffffff',
  borderRadius: 999,
  backgroundColor: PICK_COLOR,
  color: '#ffffff',
  fontSize: 10.5,
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  boxShadow: '0 1px 3px rgba(9, 9, 11, 0.3)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};

export function PickOverlay(props: PickOverlayProps) {
  return (
    <div
      id="selectionOverlay"
      data-testid="pick-overlay"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {props.hover ? (
        <div
          id="editHover"
          data-testid="pick-hover"
          style={Object.assign({}, overlayRectStyle(props.hover), HOVER_STYLE)}
        />
      ) : null}
      {props.selected.map(function (r, i) {
        if (!r || (!r.width && !r.height)) return null; // 零尺寸不画框（沿用 renderOverlay 跳过口径）
        return (
          <div
            key={i}
            className="selection-box-overlay"
            style={Object.assign({}, overlayRectStyle(r), SELECTED_STYLE)}
          >
            <span className="selection-badge" style={BADGE_STYLE}>
              {i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default PickOverlay;
