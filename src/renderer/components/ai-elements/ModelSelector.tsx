import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * ModelSelector：模型 + 思考强度两级级联（J 独占，K 做弹窗，互不越界）。
 *
 * 边界（与 K 约定）：
 * - 本组件只做级联选择器：一个触发器 + 一个 Popover 双列（模型列 / 思考列），
 *   无搜索框、无复选框、无“管理模型/获取模型”入口、无全量弹窗；弹窗由 K 负责。
 * - thinking 选项全部来自 ACP 动态下发（props.thinkingOptions），绝不写死档位；
 *   idle 且为空时只显示中性“默认”占位（协议级默认，非档位枚举）。
 * - 模型切换重置 thinking 为 default 的语义由 stores/ai-store 保证，
 *   本组件只透传 onModelChange，不在本地缓存旧档位；切换瞬间旧档位已被清空，
 *   此时按 thinkingStatus 显示「探测中…」或「该模型不支持思考」。
 * - 不支持思考（ACP_MODEL_UNSUPPORTED / 无 options）时禁用档位列，不回落旧模型档位。
 * - 保留 ai-model-select / ai-thinking-select 锚点：两个段共用同一个级联浮层，
 *   不再并排渲染两个原生/自研 Select。
 *
 * B-AI-P2-1：浮层改为 portal 到 document.body + fixed 定位：
 * - 默认右对齐触发器（思考列靠近窗口右侧，不再被窗口裁切）；
 * - 左右碰撞钳制 + 空间不足时上下翻转（上方不够 220px 且下方更宽裕 → 向下展开）；
 * - 宽度 = min(28rem, 视口 - 左右各 8px)，高度 = min(内容高度, 可用空间)，两列内部滚动；
 * - 选择语义不变：选模型保持打开，选思考关闭。
 *
 * 固定尺寸（禁止被选项文案撑开/缩窄）：
 * - 模型触发器 200px、思考触发器 150px，均 shrink-0，文案 truncate + title；
 * - 浮层 448px，两列 246px / 200px，窄屏按浮层宽度等比收缩，不随最长选项变化。
 */

/** 浮层首选宽度（与旧 w-[28rem] 一致）。 */
export const PANEL_WIDTH = 448;
/** 浮层左侧（模型）列固定宽度（446 = 448 面板 - 左右各 1px 边框）。 */
export const MODEL_COLUMN_WIDTH = 246;
/** 浮层右侧（思考）列固定宽度。 */
export const THINKING_COLUMN_WIDTH = 200;
/** 模型触发器固定宽度。 */
export const MODEL_TRIGGER_WIDTH_CLASS = 'w-[200px]';
/** 思考触发器固定宽度。 */
export const THINKING_TRIGGER_WIDTH_CLASS = 'w-[150px]';
/** 视口碰撞内边距。 */
const VIEWPORT_PADDING = 8;
/** 触发器与浮层间距。 */
const ANCHOR_GAP = 6;

export interface CascadeAnchor {
  top: number;
  bottom: number;
  right: number;
}

export interface CascadeViewport {
  width: number;
  height: number;
}

export interface CascadePosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
}

/**
 * 纯函数定位：给定触发器矩形与视口尺寸，算出 fixed 浮层的位置。
 * 右对齐 → 左侧钳制 → 上下翻转 → 高度钳制；保证 right ≤ viewport - padding。
 */
export function computeCascadePosition(
  anchor: CascadeAnchor,
  viewport: CascadeViewport,
  panelHeight = 0,
  preferredWidth = PANEL_WIDTH,
): CascadePosition {
  const pad = VIEWPORT_PADDING;
  const gap = ANCHOR_GAP;
  const vw = Math.max(1, Math.round(viewport.width || 1024));
  const vh = Math.max(1, Math.round(viewport.height || 768));
  const width = Math.max(1, Math.min(preferredWidth, vw - pad * 2));

  // 右对齐触发器；左侧不足时贴左边距，右侧仍超出时再整体左移。
  const left = Math.min(Math.max(pad, anchor.right - width), Math.max(pad, vw - pad - width));

  const spaceAbove = Math.max(0, anchor.top - gap - pad);
  const spaceBelow = Math.max(0, vh - anchor.bottom - gap - pad);
  const measured = panelHeight > 0 ? panelHeight : 288;
  // 上方能放下“不高于 220px 的浮层”就优先向上；否则哪边空间大放哪边。
  const placeAbove =
    spaceAbove >= Math.min(measured, 220) || spaceAbove >= spaceBelow;

  let maxHeight = Math.max(0, placeAbove ? spaceAbove : spaceBelow);
  maxHeight = Math.min(maxHeight, vh - pad * 2);
  let top = placeAbove
    ? anchor.top - gap - Math.min(measured, maxHeight)
    : anchor.bottom + gap;
  if (top < pad) {
    maxHeight = Math.max(0, maxHeight - (pad - top));
    top = pad;
  }
  // 最终钳制：无论翻转与否都不越过视口底部。
  if (top + maxHeight > vh - pad) {
    maxHeight = Math.max(0, vh - pad - top);
  }
  if (maxHeight < 64) {
    // 极端窄高视口：保底给一个可滚动高度，同时把 top 拉回视口内。
    maxHeight = Math.max(64, Math.min(vh - pad * 2, 64));
    top = Math.max(pad, Math.min(top, vh - pad - maxHeight));
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    maxHeight: Math.round(maxHeight),
    placement: placeAbove ? 'top' : 'bottom',
  };
}

export type ThinkingStatus = 'idle' | 'probing' | 'ready' | 'unsupported' | 'error';

export function ModelSelector({
  models,
  thinkingOptions,
  thinkingStatus = 'idle',
  thinkingError = '',
  modelId,
  thinkingLevel,
  disabled,
  onModelChange,
  onThinkingChange,
}: {
  models: Array<{ value: string; label: string }>;
  thinkingOptions: Array<{ value: string; label: string; title?: string }>;
  thinkingStatus?: ThinkingStatus;
  thinkingError?: string;
  modelId: string;
  thinkingLevel: string;
  disabled?: boolean;
  onModelChange: (modelId: string) => void;
  onThinkingChange: (level: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<CascadePosition | null>(null);
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const probing = thinkingStatus === 'probing';
  // ready 但没有 options 等同于不支持：绝不回落到“默认=可发送档位”的旧模型状态。
  const unsupported =
    thinkingStatus === 'unsupported' ||
    (thinkingStatus === 'ready' && thinkingOptions.length === 0);
  const errored = thinkingStatus === 'error';
  const thinkOpts =
    thinkingOptions.length > 0
      ? thinkingOptions
      : probing || unsupported
        ? []
        : [{ value: 'default', label: '默认', title: '使用 Agent 默认' }];
  const thinkValue = thinkingOptions.some((o) => o.value === thinkingLevel) ? thinkingLevel : 'default';
  const modelLabel = models.find((m) => m.value === modelId)?.label || modelId || '';
  const thinkLabel = probing
    ? '探测中…'
    : unsupported
      ? '不支持'
      : thinkOpts.find((o) => o.value === thinkValue)?.label || thinkValue;
  const thinkTitle = probing
    ? '正在探测该模型支持的思考档位'
    : unsupported
      ? '该模型不支持思考'
      : errored
        ? thinkingError || '思考档位读取失败，使用默认'
        : thinkLabel;

  const pickModel = (value: string): void => {
    if (value !== modelId) onModelChange(value);
    // 模型列保持打开：右侧 thinking 会随模型重置，用户可在同一浮层内继续选档。
  };

  const pickThinking = (value: string): void => {
    onThinkingChange(value);
    setOpen(false);
  };

  // 定位：打开时测量触发器 + 浮层高度，之后跟随窗口 resize / 任一容器滚动 / 浮层尺寸变化。
  React.useLayoutEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;
    const update = (): void => {
      const anchorEl = anchorRef.current;
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const panelHeight = panelRef.current ? panelRef.current.getBoundingClientRect().height : 0;
      const next = computeCascadePosition(
        { top: rect.top, bottom: rect.bottom, right: rect.right },
        {
          width: document.documentElement.clientWidth || window.innerWidth || 1024,
          height: document.documentElement.clientHeight || window.innerHeight || 768,
        },
        panelHeight,
      );
      setPosition((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight &&
        prev.placement === next.placement
          ? prev
          : next,
      );
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer =
      typeof ResizeObserver !== 'undefined' && panelRef.current
        ? new ResizeObserver(update)
        : null;
    if (observer && panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
    };
  }, [open, models.length, thinkingOptions.length, thinkingStatus]);

  // Esc / 点击外部关闭；Esc 在本层消化，避免同一次按键继续关闭 AI Dialog。
  // 全局 Esc 栈挂在 window 上；这里在 document 冒泡阶段停止传播（并阻止同节点
  // 的其他监听器），保证只收起 Popover，不触发 closeTopmost() 关掉 AI Dialog。
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, setOpen]);

  return (
    <div
      data-testid="ai-model-selector"
      data-slot="ai-model-selector"
      data-thinking-status={thinkingStatus}
      className="flex min-w-0 shrink-0 items-center"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <span
          ref={anchorRef}
          className={cn(
            'flex h-8 shrink-0 items-stretch overflow-hidden rounded-md border border-input bg-background shadow-sm',
            disabled && 'opacity-50',
          )}
        >
          <PopoverTrigger
            data-testid="ai-model-select"
            disabled={disabled}
            aria-label="选择模型"
            aria-haspopup="listbox"
            title={modelLabel || '选择模型'}
            className={cn(
              MODEL_TRIGGER_WIDTH_CLASS,
              'flex shrink-0 items-center gap-1.5 px-2.5 text-[12.5px] outline-none hover:bg-accent disabled:cursor-not-allowed',
            )}
          >
            <span className="min-w-0 flex-1 truncate" title={modelLabel || '选择模型'}>
              {modelLabel || '选择模型'}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <span className="my-1.5 w-px shrink-0 bg-border" aria-hidden="true" />
          <PopoverTrigger
            data-testid="ai-thinking-select"
            disabled={disabled || probing || unsupported}
            aria-label="选择思考强度"
            aria-haspopup="listbox"
            title={thinkTitle}
            className={cn(
              THINKING_TRIGGER_WIDTH_CLASS,
              'flex shrink-0 items-center gap-1.5 px-2.5 text-[12.5px] outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span className="shrink-0 text-[11px] text-muted-foreground">思考</span>
            <span className="min-w-0 flex-1 truncate" title={thinkTitle}>
              {thinkLabel}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
        </span>

        {open && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={panelRef}
                data-slot="popover-content"
                data-testid="ai-model-popover"
                role="dialog"
                aria-label="模型与思考强度"
                data-placement={position?.placement || 'top'}
                className="fixed z-[80] overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-lg"
                style={{
                  position: 'fixed',
                  zIndex: 80,
                  left: position ? position.left : 0,
                  top: position ? position.top : -9999,
                  width: position ? position.width : PANEL_WIDTH,
                  maxWidth: 'calc(100vw - 16px)',
                  maxHeight: position ? position.maxHeight : undefined,
                  visibility: position ? 'visible' : 'hidden',
                }}
              >
                {/* 兼容旧 Select 的 E2E/样式锚点：内容仍是同一个双列级联浮层。 */}
                <div
                  data-slot="select-content"
                  data-testid="ai-model-grid"
                  className="grid min-h-0 w-full"
                  style={{
                    maxHeight: position ? position.maxHeight : undefined,
                    gridTemplateColumns: `minmax(0, ${MODEL_COLUMN_WIDTH}px) minmax(0, ${THINKING_COLUMN_WIDTH}px)`,
                  }}
                >
                  <div
                    data-testid="ai-model-column"
                    className="flex min-h-0 min-w-0 flex-col border-r border-border"
                    style={{ maxHeight: position ? position.maxHeight : undefined }}
                  >
                    <div className="shrink-0 px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">模型</div>
                    <div
                      role="listbox"
                      aria-label="模型"
                      className="min-h-0 flex-1 overflow-y-auto p-1"
                      style={{ maxHeight: position ? Math.max(64, position.maxHeight - 32) : undefined }}
                    >
                      {models.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无模型</div>
                      ) : (
                        models.map((m) => {
                          const active = m.value === modelId;
                          return (
                            <button
                              key={m.value}
                              type="button"
                              role="option"
                              aria-selected={active}
                              title={m.label}
                              data-testid="ai-model-option"
                              onClick={() => pickModel(m.value)}
                              className={cn(
                                'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
                                active && 'font-medium',
                              )}
                            >
                              <span className="w-3.5 shrink-0">
                                {active ? <Check className="size-3.5" /> : null}
                              </span>
                              <span className="truncate">{m.label}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div
                    data-testid="ai-thinking-column"
                    className="flex min-h-0 min-w-0 flex-col"
                    style={{ maxHeight: position ? position.maxHeight : undefined }}
                  >
                    <div className="shrink-0 px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
                      思考强度
                    </div>
                    <div
                      role="listbox"
                      aria-label="思考强度"
                      className="min-h-0 flex-1 overflow-y-auto p-1"
                      style={{ maxHeight: position ? Math.max(64, position.maxHeight - 32) : undefined }}
                    >
                      {probing ? (
                        <div
                          data-testid="ai-thinking-probing"
                          className="px-2 py-1.5 text-xs text-muted-foreground"
                        >
                          探测中…
                        </div>
                      ) : unsupported ? (
                        <div
                          data-testid="ai-thinking-empty"
                          className="px-2 py-1.5 text-xs text-muted-foreground"
                        >
                          该模型不支持思考
                        </div>
                      ) : (
                        <>
                          {thinkOpts.map((o) => {
                            const active = o.value === thinkValue;
                            return (
                              <button
                                key={o.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                title={o.title || o.label}
                                data-testid="ai-thinking-option"
                                onClick={() => pickThinking(o.value)}
                                className={cn(
                                  'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
                                  active && 'font-medium',
                                )}
                              >
                                <span className="w-3.5 shrink-0">
                                  {active ? <Check className="size-3.5" /> : null}
                                </span>
                                <span className="truncate">{o.label}</span>
                              </button>
                            );
                          })}
                          {errored ? (
                            <div
                              data-testid="ai-thinking-error"
                              title={thinkingError || undefined}
                              className="px-2 py-1 text-[11px] text-muted-foreground"
                            >
                              档位读取失败，使用默认
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </Popover>
    </div>
  );
}

export default ModelSelector;
