/**
 * src/renderer/features/preview/MultiSelect.tsx — 多选批量面板壳。
 *
 * 旧语义对齐（js/edit-entry.js renderMultiEditPanel/switchMultiEditTab/CTRL_PICK.submitBatch 只读参考）：
 * - DOM id 与旧实现逐字一致（E2E 按 id 断言，便于 React 壳复用旧用例）：
 *   multiEditDrawer / multiEditMask / multiEditTitle / selChipsList(.sel-chip) /
 *   tabBatchMode / tabIndividualMode / viewBatchMode / viewIndividualMode /
 *   batchReqInput / individualItemsList(.indiv-item + .indiv-input, id="indiv_input_<item.id>") /
 *   btnCancelMultiEdit / btnSubmitMultiEdit / multiEditClose；
 * - 标题「已选中 N 个元素」；chips 与独立卡片逐项渲染；
 * - Tab 切换：batch 态 tabBatchMode.on + viewBatchMode 显示，individual 反之；
 * - submitBatch(mode) 校验语义：batch 要求统一诉求非空；individual 要求至少一项非空，
 *   否则 status 提示并聚焦（旧 libStatus 口径），绝不直接触发大模型提交（只入待提交列表由父组件承接）。
 */
import React, { useEffect, useState } from 'react';

export interface MultiSelectItem {
  id: string;
  selector: string;
  label: string;
  text?: string;
}

export type MultiSelectMode = 'batch' | 'individual';

export interface MultiSelectSubmitPayload {
  mode: MultiSelectMode;
  batchReq: string;
  individualReqs: Record<string, string>;
}

export interface MultiSelectProps {
  open: boolean;
  items: MultiSelectItem[];
  onClose: () => void;
  onClear: () => void;
  onSubmit: (payload: MultiSelectSubmitPayload) => void;
  /** 状态提示（旧 libStatus 口径；缺省走 console）。 */
  status?: (msg: string) => void;
}

/**
 * 批量校验（沿用 submitBatch batch 分支：统一诉求为空则拦截）。
 * @param batchReq 统一修改诉求
 * @returns null=通过；否则为提示文案
 */
export function validateBatchReq(batchReq: string): string | null {
  if (!batchReq.trim()) return '请输入统一修改诉求。';
  return null;
}

/**
 * 独立模式收集（沿用 submitBatch individual 分支：至少一项非空，否则拦截）。
 * @param items 选中项
 * @param values id → 诉求文本
 * @returns { reqs } 通过；{ error } 拦截（error 为提示文案）
 */
export function collectIndividualReqs(
  items: MultiSelectItem[],
  values: Record<string, string>,
): { reqs: Record<string, string> } | { error: string } {
  var reqs: Record<string, string> = {};
  (items || []).forEach(function (it) {
    var v = values[it.id];
    if (typeof v === 'string' && v.trim() !== '') reqs[it.id] = v.trim();
  });
  if (Object.keys(reqs).length === 0) return { error: '请至少为一个元素填写修改诉求。' };
  return { reqs: reqs };
}

var MultiSelect: React.FC<MultiSelectProps> = function MultiSelect(props: MultiSelectProps) {
  var [mode, setMode] = useState<MultiSelectMode>('batch');
  var [batchReq, setBatchReq] = useState('');
  var [indivValues, setIndivValues] = useState<Record<string, string>>({});
  var [statusMsg, setStatusMsg] = useState('');
  var batchInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  useEffect(function () {
    if (props.open) {
      setMode('batch'); // 沿用旧默认：批量 tab 先 on
      setBatchReq('');
      setIndivValues({});
      setStatusMsg('');
    }
  }, [props.open, props.items.length]);

  if (!props.open) return null;

  function say(msg: string): void {
    setStatusMsg(msg);
    try {
      if (props.status) props.status(msg);
      else console.log(msg);
    } catch { /* ignore */ }
  }

  // 沿用 CTRL_PICK.submitBatch(mode)：模式参数以当前选中 Tab 为准。
  function submitBatch(m: MultiSelectMode): void {
    if (m !== 'individual') {
      var err = validateBatchReq(batchReq);
      if (err) {
        say(err);
        try { if (batchInputRef.current) batchInputRef.current.focus(); } catch { /* ignore */ }
        return;
      }
      props.onSubmit({ mode: 'batch', batchReq: batchReq.trim(), individualReqs: {} });
      return;
    }
    var collected = collectIndividualReqs(props.items, indivValues);
    if ('error' in collected) {
      say(collected.error);
      try {
        var first = props.items.length ? document.getElementById('indiv_input_' + props.items[0].id) : null;
        if (first && typeof (first as HTMLElement).focus === 'function') (first as HTMLElement).focus();
      } catch { /* ignore */ }
      return;
    }
    props.onSubmit({ mode: 'individual', batchReq: '', individualReqs: collected.reqs });
  }

  function closeAndClear(): void {
    props.onClose();
    props.onClear();
  }

  var isBatch = mode === 'batch';

  return (
    <React.Fragment>
      <div
        id="multiEditMask"
        data-testid="multi-edit-mask"
        onClick={closeAndClear}
        className="pointer-events-auto fixed inset-0 z-[60] bg-black/20"
      />
      <div
        id="multiEditDrawer"
        data-testid="multi-edit-drawer"
        className="open pointer-events-auto fixed bottom-0 right-0 z-[61] flex max-h-[72vh] w-[min(760px,94vw)] flex-col gap-3 overflow-y-auto rounded-t-xl border border-border bg-background p-4 shadow-2xl"
        aria-hidden="false"
      >
        <div className="flex items-center gap-2">
          <div id="multiEditTitle" className="text-sm font-semibold">
            {'已选中 ' + props.items.length + ' 个元素'}
          </div>
          <span className="ml-auto" />
          <button
            id="multiEditClose"
            type="button"
            onClick={closeAndClear}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="关闭多选"
          >
            ✕
          </button>
        </div>
        <div id="selChipsList" className="flex flex-wrap gap-1.5">
          {props.items.map(function (it, i) {
            return (
              <span
                key={it.id}
                className="sel-chip max-w-48 truncate rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px]"
                title={it.selector}
              >
                {(i + 1) + '. ' + (it.text || it.label || '元素')}
              </span>
            );
          })}
        </div>
        <div role="tablist" className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            id="tabBatchMode"
            type="button"
            role="tab"
            aria-selected={isBatch}
            className={'h-7 flex-1 rounded-md px-2 text-xs ' + (isBatch ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
            onClick={function () { setMode('batch'); }}
          >
            统一修改
          </button>
          <button
            id="tabIndividualMode"
            type="button"
            role="tab"
            aria-selected={!isBatch}
            className={'h-7 flex-1 rounded-md px-2 text-xs ' + (!isBatch ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
            onClick={function () { setMode('individual'); }}
          >
            逐个修改
          </button>
        </div>
        <div id="viewBatchMode" style={{ display: isBatch ? '' : 'none' }}>
          <textarea
            id="batchReqInput"
            ref={batchInputRef}
            value={batchReq}
            placeholder="统一修改诉求…"
            className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cobalt)]"
            onChange={function (ev) { setBatchReq(ev.target.value); }}
          />
        </div>
        <div id="viewIndividualMode" style={{ display: isBatch ? 'none' : '' }}>
          <div id="individualItemsList" className="flex flex-col gap-2">
            {props.items.map(function (it, i) {
              return (
                <div key={it.id} className="indiv-item flex flex-col gap-1 rounded-lg border border-border p-2">
                  <div className="indiv-item-head truncate text-[11px] text-muted-foreground" title={it.selector}>
                    {(i + 1) + '. ' + (it.text || it.label || '元素')}
                  </div>
                  <textarea
                    className="indiv-input min-h-14 w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-xs outline-none"
                    id={'indiv_input_' + it.id}
                    placeholder="该元素的独立修改诉求…"
                    value={indivValues[it.id] || ''}
                    onChange={function (ev) {
                      var v = ev.target.value;
                      setIndivValues(function (prev) {
                        var next: Record<string, string> = {};
                        Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
                        next[it.id] = v;
                        return next;
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {statusMsg ? (
          <div data-testid="multi-edit-status" className="rounded-md bg-[var(--amber-soft)] px-2 py-1.5 text-[11px] text-[var(--amber)]">
            {statusMsg}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <button
            id="btnCancelMultiEdit"
            type="button"
            onClick={closeAndClear}
            className="h-7 rounded-md border border-input bg-background px-2.5 text-xs hover:bg-accent"
          >
            取消
          </button>
          <button
            id="btnSubmitMultiEdit"
            type="button"
            onClick={function () { submitBatch(isBatch ? 'batch' : 'individual'); }}
            className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-[#27272a]"
          >
            加入待提交
          </button>
        </div>
      </div>
    </React.Fragment>
  );
};

export default MultiSelect;
