/**
 * src/renderer/features/preview/PickComposer.tsx — Ctrl/Cmd 拾取后的底部需求输入条。
 *
 * 交互口径（对齐旧版 js/edit-entry.js 的 pickBar）：
 * - 只在「松开 Ctrl/Cmd」后出现，点击元素期间绝不弹输入框；
 * - 上方 chips：编号 + 元素标签，可点 ✕ 删除，也可聚焦 chip 后按 Backspace/Delete 删除；
 * - 下方一个输入框 + 提交：多选共享一条统一需求，提交后由宿主按批量入待提交队列；
 * - 单元素时输入框旁额外露出「标注 / 交互」入口，点开是输入条上方的小面板，不打开 Inspector Sheet；
 * - 待提交改为只从工具栏入口打开，底部不再常驻待提交条，输入条位置固定 bottom:1rem；
 * - Esc / 取消只结束本次拾取，stopPropagation 防止同时关闭 AI/文档/设置等其它弹层。
 * - 需求草稿受控：文本由宿主（PreviewOverlaysHost）提升保存，输入条因选择清空 /
 *   应用弹层短暂卸载后重新挂载仍保留已输入内容；本组件不再持有草稿副本。
 */
import * as React from 'react'
import { Link2, MessageSquarePlus, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PreviewPickedElement } from './PreviewFrame'

/** 交互目标原型（与 Inspector 的目标下拉同口径）。 */
export interface PickTargetOption {
  name: string
  pages: Array<{ value: string; label: string }>
}

export interface PickComposerProps {
  /** 当前选择（顺序即 chips 编号）。 */
  elements: PreviewPickedElement[]
  /** 单元素已存在的标注内容（无标注为空串）。 */
  annotationContent?: string
  /** 单元素当前跳转绑定（无绑定为空串）。 */
  linkTarget?: string
  linkTargetPage?: string
  linkBound?: boolean
  /** 交互目标原型清单。 */
  targetOptions: PickTargetOption[]
  /** 需求草稿（受控，由宿主保存；输入条卸载不丢）。 */
  draft: string
  /** 草稿变化回调（每次键入写回宿主）。 */
  onDraftChange: (next: string) => void
  /** 删除一个 chip（selector 为空时不允许删除）。 */
  onRemove: (selector: string) => void
  /** 提交统一需求（单元素即普通需求，多元素即一条批量需求）。 */
  onSubmit: (text: string) => void
  /** Esc / 关闭按钮：只取消本次拾取。 */
  onCancel: () => void
  /** 保存标注；true=成功，宿主据此决定是否关闭输入条。 */
  onSaveAnnotation: (text: string) => Promise<boolean>
  /** 保存交互绑定；true=成功。 */
  onSaveLink: (target: string, targetPage: string) => Promise<boolean>
  /** 解除交互绑定；true=成功。 */
  onRemoveLink: () => Promise<boolean>
}

/** 元素 chips 文案：优先文本，其次标签名，兜底 selector。 */
function elementLabel(element: PreviewPickedElement, index: number): string {
  const text = String(element.text || '').trim()
  if (text) return text
  const tag = String(element.tagName || '').trim()
  if (tag) return tag
  return element.selector || '元素 ' + (index + 1)
}

export function PickComposer(props: PickComposerProps): React.ReactElement | null {
  const { elements } = props
  const [error, setError] = React.useState('')
  const [panel, setPanel] = React.useState<'annotation' | 'link' | null>(null)
  const [annoText, setAnnoText] = React.useState('')
  const [target, setTarget] = React.useState('')
  const [targetPage, setTargetPage] = React.useState('')
  const [panelError, setPanelError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

  const single = elements.length === 1 ? elements[0] : null

  // 输入条出现 / Ctrl 多选增删后都把焦点送回需求框，松开修饰键可直接继续打字。
  // 面板打开时不抢焦点，避免打断标注 / 交互输入。
  const panelOpenRef = React.useRef(false)
  React.useEffect(() => {
    panelOpenRef.current = panel != null
  }, [panel])
  React.useEffect(() => {
    if (panelOpenRef.current) return
    const timer = window.setTimeout(() => {
      try {
        inputRef.current?.focus()
      } catch {
        // 节点已卸载时忽略。
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [elements.length])

  // 打开小面板时才回填当前标注/绑定，避免在 effect 里同步 setState 造成级联渲染。
  const togglePanel = (next: 'annotation' | 'link'): void => {
    if (panel === next) {
      setPanel(null)
      return
    }
    setPanelError('')
    if (next === 'annotation') {
      setAnnoText(props.annotationContent || '')
    } else {
      setTarget(props.linkTarget || '')
      setTargetPage(props.linkTargetPage || '')
    }
    setPanel(next)
  }

  if (!elements.length) return null

  const submitRequirement = (): void => {
    const value = props.draft.trim()
    if (!value) {
      setError('请输入需求内容。')
      try {
        inputRef.current?.focus()
      } catch {
        // 忽略。
      }
      return
    }
    setError('')
    props.onSubmit(value)
  }

  const onRootKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>): void => {
    if (ev.key !== 'Escape') return
    // 输入条独占本次 Esc：阻止冒泡，避免同一次按键又关 AI/文档/设置。
    ev.preventDefault()
    ev.stopPropagation()
    props.onCancel()
  }

  const saveAnnotation = async (): Promise<void> => {
    const value = annoText.trim()
    if (!value) {
      setPanelError('请输入标注内容。')
      return
    }
    setBusy(true)
    try {
      const ok = await props.onSaveAnnotation(value)
      if (!ok) return
      setPanel(null)
    } finally {
      setBusy(false)
    }
  }

  const selectedTarget = props.targetOptions.find((item) => item.name === target) || null

  const saveLink = async (): Promise<void> => {
    if (!target) {
      setPanelError('请选择跳转目标原型。')
      return
    }
    setBusy(true)
    try {
      const ok = await props.onSaveLink(target, targetPage)
      if (!ok) return
      setPanel(null)
    } finally {
      setBusy(false)
    }
  }

  const removeLink = async (): Promise<void> => {
    setBusy(true)
    try {
      const ok = await props.onRemoveLink()
      if (!ok) return
      setPanel(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="pick-composer"
      role="dialog"
      aria-label="拾取修改需求"
      onKeyDown={onRootKeyDown}
      style={{ bottom: '1rem' }}
      className="pointer-events-auto fixed left-1/2 z-40 flex w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 rounded-xl border border-border bg-background p-3 shadow-xl"
    >
      {panel ? (
        <div
          data-testid={panel === 'annotation' ? 'pick-composer-annotation-panel' : 'pick-composer-link-panel'}
          className="absolute bottom-full left-0 mb-2 flex w-full flex-col gap-2 rounded-lg border border-border bg-background p-2.5 shadow-lg"
        >
          <div className="flex items-center gap-2 text-[11px] font-medium">
            <span>{panel === 'annotation' ? '标注' : '交互绑定'}</span>
            <span className="truncate font-mono text-[10px] font-normal text-muted-foreground">
              {single?.selector || ''}
            </span>
            <button
              type="button"
              aria-label="关闭小面板"
              className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setPanel(null)}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>

          {panel === 'annotation' ? (
            <>
              <textarea
                data-testid="pick-composer-annotation-input"
                className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cobalt)]"
                rows={3}
                value={annoText}
                placeholder="写一条需求标注…"
                onChange={(ev) => {
                  setAnnoText(ev.target.value)
                  if (panelError) setPanelError('')
                }}
              />
              {panelError ? (
                <div data-testid="pick-composer-panel-error" className="text-[11px] text-destructive">
                  {panelError}
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  data-testid="pick-composer-annotation-save"
                  disabled={busy}
                  onClick={() => void saveAnnotation()}
                >
                  保存标注
                </Button>
              </div>
            </>
          ) : (
            <>
              {props.linkBound ? (
                <div data-testid="pick-composer-link-bound" className="text-[11px] text-muted-foreground">
                  已绑定 → {props.linkTarget || '未命名目标'}
                  {props.linkTargetPage ? ' · ' + props.linkTargetPage : ''}
                </div>
              ) : null}
              {props.targetOptions.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">项目内暂无可选原型。</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select
                    data-testid="pick-composer-link-target"
                    aria-label="跳转目标原型"
                    className="h-7 min-w-40 flex-1 rounded-md border border-input bg-background px-1.5 text-xs"
                    value={target}
                    onChange={(ev) => {
                      const next = ev.target.value
                      setTarget(next)
                      setTargetPage('')
                      if (panelError) setPanelError('')
                    }}
                  >
                    <option value="">选择目标原型</option>
                    {props.targetOptions.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    data-testid="pick-composer-link-page"
                    aria-label="跳转目标页面"
                    className="h-7 min-w-32 flex-1 rounded-md border border-input bg-background px-1.5 text-xs"
                    value={targetPage}
                    onChange={(ev) => setTargetPage(ev.target.value)}
                  >
                    <option value="">打开主页</option>
                    {(selectedTarget?.pages || []).map((page) => (
                      <option key={page.value} value={page.value}>
                        {page.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {panelError ? (
                <div data-testid="pick-composer-panel-error" className="text-[11px] text-destructive">
                  {panelError}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                {props.linkBound ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    data-testid="pick-composer-link-remove"
                    disabled={busy}
                    onClick={() => void removeLink()}
                  >
                    解除
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  data-testid="pick-composer-link-save"
                  disabled={busy || !target}
                  onClick={() => void saveLink()}
                >
                  保存绑定
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="list" aria-label="已选元素">
          {elements.map((element, index) => (
            <span
              key={(element.selector || 'el') + ':' + index}
              role="listitem"
              tabIndex={0}
              data-testid="pick-composer-chip"
              data-selector={element.selector}
              title={element.selector}
              onKeyDown={(ev) => {
                if (ev.key !== 'Backspace' && ev.key !== 'Delete') return
                ev.preventDefault()
                ev.stopPropagation()
                props.onRemove(element.selector)
              }}
              className="flex max-w-56 items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--cobalt)]"
            >
              <b className="shrink-0 rounded-full bg-[var(--cobalt)] px-1 text-[10px] text-white">
                {index + 1}
              </b>
              <span className="truncate">{elementLabel(element, index)}</span>
              <button
                type="button"
                data-testid="pick-composer-chip-remove"
                aria-label={'移除第 ' + (index + 1) + ' 个元素'}
                title="移除该元素"
                className="shrink-0 rounded-full px-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => props.onRemove(element.selector)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          data-testid="pick-composer-cancel"
          aria-label="取消本次拾取"
          title="取消本次拾取（Esc）"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={props.onCancel}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          data-testid="pick-composer-input"
          aria-label="修改需求"
          rows={1}
          value={props.draft}
          placeholder={
            single ? '描述这个元素的修改需求…' : '描述这些元素的统一修改需求…（Ctrl+Enter 提交）'
          }
          className="min-h-8 flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cobalt)]"
          onChange={(ev) => {
            props.onDraftChange(ev.target.value)
            if (error) setError('')
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
              ev.preventDefault()
              submitRequirement()
            }
          }}
        />
        {single ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={panel === 'annotation' ? 'secondary' : 'outline'}
              data-testid="pick-composer-annotation"
              className="h-8 shrink-0 gap-1 px-2 text-[11px]"
              aria-pressed={panel === 'annotation'}
              onClick={() => togglePanel('annotation')}
            >
              <MessageSquarePlus aria-hidden="true" className="size-3.5" />
              标注
            </Button>
            <Button
              type="button"
              size="sm"
              variant={panel === 'link' ? 'secondary' : 'outline'}
              data-testid="pick-composer-link"
              className="h-8 shrink-0 gap-1 px-2 text-[11px]"
              aria-pressed={panel === 'link'}
              onClick={() => togglePanel('link')}
            >
              <Link2 aria-hidden="true" className="size-3.5" />
              交互
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          data-testid="pick-composer-submit"
          className="h-8 shrink-0 gap-1 px-2.5 text-[11px]"
          onClick={submitRequirement}
        >
          <Send aria-hidden="true" className="size-3.5" />
          加入待提交
        </Button>
      </div>

      {error ? (
        <div data-testid="pick-composer-error" className="text-[11px] text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}

export default PickComposer
