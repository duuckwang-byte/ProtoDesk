/**
 * src/renderer/features/preview/__tests__/pick-dialogs.test.tsx — 拾取出口回归（收敛后）。
 *
 * 覆盖：
 * - 底部 PickComposer：单元素露出标注/交互轻量面板入口，不打开 Inspector Sheet；
 * - 需求草稿由宿主保存：仅选择变化 / 输入条短暂卸载不丢，提交后清空；
 * - 多选提交只有 1 条批量待提交（batchParts 保留）；
 * - 单元素提交入 1 条普通待提交；
 * - 修改只保留一个 PickModifyDialog：「保存到代码」直接读源 HTML → 替换文本 → 写盘并刷新，
 *   不入待提交队列；pickIndex 多命中精确定位；失败保留弹窗；内容未变化不读盘不写盘；
 * - 需求侧不再渲染 PickRequirementDialog；
 * - 待提交 Sheet：条目可直接编辑（失焦 / Ctrl+Enter 保存、Esc 取消、空文本不保存），
 *   底部操作栏固定不在滚动区；底部不再常驻 MultiEditBar；
 * - 标注：定位只高亮元素、不打开检查器；面板内直接编辑并走 saveAnnos 更新列表。
 */

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewOverlaysHost, { type PickModifyRequest } from '../PreviewOverlaysHost'
import type { PreviewPickedElement } from '../PreviewFrame'
import type { EditQueueItem } from '@/components/overlays/MultiEditBar'
import type { AnnoItem } from '@/features/annotations/AnnoStore'
import { EDIT_QUEUE_KEY } from '@/lib/storage-keys'
import { useAppStore } from '@/stores/app-store'
import { useSourcesStore, type SourceRef } from '@/stores/sources-store'
import { useUiStore } from '@/stores/ui-store'

const SELECTOR_A = '[data-pr-id="pr-1"]'
const SELECTOR_B = '[data-pr-id="pr-2"]'

const A: PreviewPickedElement = {
  selector: SELECTOR_A,
  tagName: 'button',
  text: '提交',
  rect: { left: 20, top: 30, width: 120, height: 32 },
}
const B: PreviewPickedElement = {
  selector: SELECTOR_B,
  tagName: 'a',
  text: '了解更多',
  rect: { left: 20, top: 80, width: 90, height: 20 },
}

const SOURCE: SourceRef = {
  name: '首页.html',
  displayName: '首页',
  kind: 'pc',
  sandboxDir: 'D:/sandbox/测试1/首页',
  mainHtmlFile: '首页.html',
  mdFile: '首页.md',
  subPages: [{ file: '我的.html', name: '我的' }],
  htmlFiles: ['首页.html', '我的.html'],
  content: '<html><body>首页</body></html>',
  md: '',
  pages: ['首页'],
  __ver: 1,
  activeSubFile: '首页.html',
  activeContent: '',
}

/** 修改文字写盘用源 HTML（含 doctype 与待改元素属性）。 */
const PAGE_HTML = [
  '<!DOCTYPE html>',
  '<html><head><title>测试页</title></head><body>',
  '<a data-pr-id="pr-2" class="cta" href="#more">了解更多</a>',
  '<p class="note">其它内容</p>',
  '</body></html>',
].join('\n')

/** 同 selector 多命中场景。 */
const DUP_HTML = [
  '<!DOCTYPE html>',
  '<html><body>',
  '<span data-pr-id="dup">一</span>',
  '<span data-pr-id="dup">二</span>',
  '</body></html>',
].join('\n')

const ANNO_A: AnnoItem = {
  id: 'anno_a1',
  htmlFile: '首页.html',
  selector: SELECTOR_A,
  textSnippet: '提交',
  tagName: 'BUTTON',
  elementName: '提交',
  page: '首页',
  title: '',
  content: '按钮改成蓝色',
  author: 'PM',
  createdAt: '2026-01-01 10:00',
  updatedAt: '2026-01-01 10:00',
}

const refreshSpy = vi.fn(async () => {})
let sandboxRead: ReturnType<typeof vi.fn>
let sandboxWrite: ReturnType<typeof vi.fn>
let annoSave: ReturnType<typeof vi.fn>
let seedAnnos: AnnoItem[] = []

function installProtoApi(): void {
  sandboxRead = vi.fn(async () => ({ ok: true, content: PAGE_HTML }))
  sandboxWrite = vi.fn(async () => ({ ok: true }))
  annoSave = vi.fn(async () => ({ ok: true }))
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
    annotations: { read: async () => ({ ok: true, data: seedAnnos }), save: annoSave },
    links: { read: async () => ({ ok: true, data: { links: [] } }) },
    sandbox: { readFile: sandboxRead, write: sandboxWrite },
  }
}

function removeProtoApi(): void {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
}

function readQueue(): EditQueueItem[] {
  try {
    const raw = localStorage.getItem(EDIT_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as EditQueueItem[]) : []
  } catch {
    return []
  }
}

interface HostOptions {
  selected?: PreviewPickedElement[]
  composerOpen?: boolean
  modifyRequest?: PickModifyRequest | null
  toolbarSlot?: HTMLElement | null
  onClear?: () => void
  onComposerClose?: () => void
  onModifyClose?: () => void
}

async function renderHost(options: HostOptions = {}): Promise<void> {
  await act(async () => {
    render(
      <PreviewOverlaysHost
        hover={null}
        selected={options.selected ?? []}
        pickComposerOpen={options.composerOpen}
        pickModifyRequest={options.modifyRequest ?? null}
        toolbarSlot={options.toolbarSlot}
        onClearSelection={options.onClear}
        onPickComposerClose={options.onComposerClose}
        onPickModifyClose={options.onModifyClose}
      />,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function makeSlot(): HTMLDivElement {
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  return slot
}

beforeEach(() => {
  localStorage.clear()
  seedAnnos = []
  installProtoApi()
  refreshSpy.mockClear()
  useAppStore.setState({ page: '首页' })
  useUiStore.setState({
    docsOpen: false,
    aiOpen: false,
    settingsTab: null,
    gitOpen: false,
    exportOpen: false,
    toasts: [],
  })
  useSourcesStore.setState({
    project: '测试1',
    sources: [SOURCE],
    currentSource: SOURCE,
    activeSubFile: SOURCE.mainHtmlFile,
    activeContent: '',
    refresh: refreshSpy,
  })
})

afterEach(() => {
  cleanup()
  removeProtoApi()
  document.body.innerHTML = ''
  localStorage.clear()
  useUiStore.setState({ aiOpen: false, settingsTab: null, gitOpen: false, toasts: [] })
  useSourcesStore.setState({
    project: '',
    sources: [],
    currentSource: null,
    activeSubFile: '',
    activeContent: '',
  })
})

describe('底部需求输入条', () => {
  it('单元素：显示 chips 与标注/交互入口，点标注开小面板而不是 Inspector Sheet', async () => {
    const onClear = vi.fn()
    const onComposerClose = vi.fn()
    await renderHost({ selected: [A], composerOpen: true, onClear, onComposerClose })

    expect(screen.getByTestId('pick-composer')).toBeTruthy()
    expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(1)
    expect(screen.getByTestId('pick-composer-annotation')).toBeTruthy()
    expect(screen.getByTestId('pick-composer-link')).toBeTruthy()

    fireEvent.click(screen.getByTestId('pick-composer-annotation'))
    expect(screen.getByTestId('pick-composer-annotation-panel')).toBeTruthy()
    expect(screen.queryByTestId('overlays-sheet-inspector')).toBeNull()

    fireEvent.click(screen.getByTestId('pick-composer-link'))
    expect(screen.getByTestId('pick-composer-link-panel')).toBeTruthy()
    expect(screen.queryByTestId('overlays-sheet-inspector')).toBeNull()
  })

  it('单元素提交：入 1 条普通待提交并关闭会话', async () => {
    const onClear = vi.fn()
    const onComposerClose = vi.fn()
    await renderHost({ selected: [A], composerOpen: true, onClear, onComposerClose })

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '按钮改成蓝色' } })
    fireEvent.click(screen.getByTestId('pick-composer-submit'))

    await waitFor(() => expect(onComposerClose).toHaveBeenCalled())
    expect(onClear).toHaveBeenCalled()
    const queue = readQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      selector: SELECTOR_A,
      page: '首页',
      htmlFile: '首页.html',
      text: '按钮改成蓝色',
      tagName: 'button',
    })
  })

  it('多选提交：统一需求只入 1 条批量，batchParts 为 2', async () => {
    const onComposerClose = vi.fn()
    await renderHost({ selected: [A, B], composerOpen: true, onComposerClose })

    expect(screen.queryByTestId('pick-composer-annotation')).toBeNull()
    expect(screen.queryByTestId('pick-composer-link')).toBeNull()

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '统一加大字号' } })
    fireEvent.click(screen.getByTestId('pick-composer-submit'))

    await waitFor(() => expect(onComposerClose).toHaveBeenCalled())
    const queue = readQueue() as Array<EditQueueItem & { batchParts?: unknown[] }>
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      text: '统一加大字号',
      tagName: '批量修改（2 个元素）',
    })
    expect(queue[0].batchParts).toHaveLength(2)
  })

  it('Esc 只触发 onCancel，不写队列，也不冒泡给全局 Esc 层', async () => {
    const onComposerClose = vi.fn()
    const onClear = vi.fn()
    let globalEsc = 0
    const onGlobalEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') globalEsc += 1
    }
    window.addEventListener('keydown', onGlobalEsc)
    try {
      await renderHost({ selected: [A], composerOpen: true, onClear, onComposerClose })

      fireEvent.keyDown(screen.getByTestId('pick-composer-input'), { key: 'Escape' })
      await waitFor(() => expect(onComposerClose).toHaveBeenCalled())
      expect(onClear).toHaveBeenCalled()
      expect(globalEsc).toBe(0)
      expect(readQueue()).toEqual([])
    } finally {
      window.removeEventListener('keydown', onGlobalEsc)
    }
  })

  it('不再渲染需求弹窗', async () => {
    await renderHost({ selected: [A], composerOpen: true })
    expect(screen.queryByTestId('pick-requirement-dialog')).toBeNull()
  })

  it('草稿提升到宿主：选择变化 / 输入条短暂卸载都不清空，提交后清空', async () => {
    const onComposerClose = vi.fn()
    const ui = (open: boolean, selected: PreviewPickedElement[]) => (
      <PreviewOverlaysHost
        hover={null}
        selected={selected}
        pickComposerOpen={open}
        onPickComposerClose={onComposerClose}
      />
    )

    const view = render(ui(true, [A]))
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '保留我' } })
    const input = screen.getByTestId('pick-composer-input') as HTMLTextAreaElement
    await waitFor(() => expect(document.activeElement).toBe(input))
    input.blur()
    expect(document.activeElement).not.toBe(input)

    // 仅选择变化（Ctrl 多选新增元素）：chips 更新，草稿保留，焦点回到需求框。
    await act(async () => {
      view.rerender(ui(true, [A, B]))
      await Promise.resolve()
    })
    expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(2)
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('保留我')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('pick-composer-input')))

    // 输入条短暂卸载（如应用级弹层打开）：重新挂载仍从宿主取回草稿。
    await act(async () => {
      view.rerender(ui(false, [A, B]))
      await Promise.resolve()
    })
    expect(screen.queryByTestId('pick-composer')).toBeNull()
    await act(async () => {
      view.rerender(ui(true, [A, B]))
      await Promise.resolve()
    })
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('保留我')

    // 提交成功：宿主清空草稿，下次打开为空白。
    fireEvent.click(screen.getByTestId('pick-composer-submit'))
    await waitFor(() => expect(onComposerClose).toHaveBeenCalled())
    await act(async () => {
      view.rerender(ui(true, [A]))
      await Promise.resolve()
    })
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('')
  })
})

describe('修改弹窗（唯一）：直接保存到代码', () => {
  it('预填当前文本；保存走 readFile → 替换 textContent → write，且不入待提交队列', async () => {
    const onModifyClose = vi.fn()
    await renderHost({
      selected: [B],
      modifyRequest: { element: B, seq: 1 },
      onModifyClose,
    })

    expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy()
    expect(screen.getByTestId('pick-modify-selector').textContent).toBe(SELECTOR_B)
    const input = screen.getByTestId('pick-modify-input') as HTMLTextAreaElement
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.value).toBe('了解更多')
    // 按钮文案改为「保存到代码」。
    expect(screen.getByTestId('pick-modify-save').textContent).toContain('保存到代码')

    fireEvent.change(input, { target: { value: '立即了解' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))

    await waitFor(() => expect(onModifyClose).toHaveBeenCalled())
    expect(sandboxRead).toHaveBeenCalledWith({ dir: SOURCE.sandboxDir, file: '首页.html' })
    expect(sandboxWrite).toHaveBeenCalledTimes(1)
    const written = sandboxWrite.mock.calls[0][0] as { dir: string; file: string; content: string }
    expect(written.dir).toBe(SOURCE.sandboxDir)
    expect(written.file).toBe('首页.html')
    // doctype 保留 + 元素/属性保留，只换文本。
    expect(written.content.startsWith('<!DOCTYPE html>')).toBe(true)
    const doc = new DOMParser().parseFromString(written.content, 'text/html')
    const link = doc.querySelector('[data-pr-id="pr-2"]')
    expect(link?.textContent).toBe('立即了解')
    expect(link?.getAttribute('class')).toBe('cta')
    expect(link?.getAttribute('href')).toBe('#more')
    expect(doc.querySelector('p.note')?.textContent).toBe('其它内容')
    // 成功后刷新当前源/预览，且绝不入队。
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(readQueue()).toEqual([])
    expect(useUiStore.getState().toasts.some((toast) => toast.title === '已保存到代码')).toBe(true)
  })

  it('pickIndex 多命中：只改对应序号的元素', async () => {
    sandboxRead.mockResolvedValueOnce({ ok: true, content: DUP_HTML })
    const onModifyClose = vi.fn()
    const dup: PreviewPickedElement = {
      selector: '[data-pr-id="dup"]',
      pickIndex: 1,
      tagName: 'span',
      text: '二',
      rect: { left: 10, top: 10, width: 40, height: 20 },
    }
    await renderHost({ selected: [dup], modifyRequest: { element: dup, seq: 1 }, onModifyClose })

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '第二项' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))
    await waitFor(() => expect(onModifyClose).toHaveBeenCalled())

    expect(sandboxWrite).toHaveBeenCalledTimes(1)
    const written = sandboxWrite.mock.calls[0][0] as { content: string }
    const doc = new DOMParser().parseFromString(written.content, 'text/html')
    const spans = Array.from(doc.querySelectorAll('[data-pr-id="dup"]')).map((el) => el.textContent)
    expect(spans).toEqual(['一', '第二项'])
    expect(readQueue()).toEqual([])
  })

  it('多命中但缺少 pickIndex：保留弹窗并提示重新拾取，不写盘不入队', async () => {
    sandboxRead.mockResolvedValueOnce({ ok: true, content: DUP_HTML })
    const onModifyClose = vi.fn()
    const dup: PreviewPickedElement = {
      selector: '[data-pr-id="dup"]',
      tagName: 'span',
      text: '二',
      rect: { left: 10, top: 10, width: 40, height: 20 },
    }
    await renderHost({ selected: [dup], modifyRequest: { element: dup, seq: 1 }, onModifyClose })

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '第二项' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))

    await waitFor(() =>
      expect(screen.getByTestId('pick-modify-error').textContent).toContain('原序号不可用'),
    )
    expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy()
    expect(onModifyClose).not.toHaveBeenCalled()
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('内容未变化：直接关闭，不读盘、不写盘', async () => {
    const onModifyClose = vi.fn()
    await renderHost({ selected: [B], modifyRequest: { element: B, seq: 1 }, onModifyClose })

    fireEvent.click(screen.getByTestId('pick-modify-save'))
    await waitFor(() => expect(onModifyClose).toHaveBeenCalled())

    expect(sandboxRead).not.toHaveBeenCalled()
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('空文本：保留弹窗并显示错误，不读盘不写盘', async () => {
    const onModifyClose = vi.fn()
    await renderHost({ selected: [B], modifyRequest: { element: B, seq: 1 }, onModifyClose })

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))

    await waitFor(() =>
      expect(screen.getByTestId('pick-modify-error').textContent).toContain('请输入修改后的文本'),
    )
    expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy()
    expect(onModifyClose).not.toHaveBeenCalled()
    expect(sandboxRead).not.toHaveBeenCalled()
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('文件读取失败：保留弹窗、显示具体错误、不写盘、不入队', async () => {
    sandboxRead.mockResolvedValueOnce({ ok: false, error: 'EACCES' })
    const onModifyClose = vi.fn()
    await renderHost({ selected: [B], modifyRequest: { element: B, seq: 1 }, onModifyClose })

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '立即了解' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))

    await waitFor(() =>
      expect(screen.getByTestId('pick-modify-error').textContent).toContain('源文件读取失败'),
    )
    expect(screen.getByTestId('pick-modify-error').textContent).toContain('EACCES')
    expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy()
    expect(onModifyClose).not.toHaveBeenCalled()
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('selector 在源文件无效：保留弹窗、不写盘、不入队', async () => {
    const onModifyClose = vi.fn()
    const broken: PreviewPickedElement = {
      ...B,
      selector: '##',
    }
    await renderHost({ selected: [broken], modifyRequest: { element: broken, seq: 1 }, onModifyClose })

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '立即了解' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))

    await waitFor(() =>
      expect(screen.getByTestId('pick-modify-error').textContent).toContain('选择器在源文件无效'),
    )
    expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy()
    expect(onModifyClose).not.toHaveBeenCalled()
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('写盘失败：保留弹窗、显示具体错误、不入队', async () => {
    sandboxWrite.mockResolvedValueOnce({ ok: false, error: 'EROFS' })
    const onModifyClose = vi.fn()
    await renderHost({ selected: [B], modifyRequest: { element: B, seq: 1 }, onModifyClose })

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '立即了解' } })
    fireEvent.click(screen.getByTestId('pick-modify-save'))

    await waitFor(() => expect(screen.getByTestId('pick-modify-error').textContent).toContain('写盘失败'))
    expect(screen.getByTestId('pick-modify-error').textContent).toContain('EROFS')
    expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy()
    expect(onModifyClose).not.toHaveBeenCalled()
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('取消不写盘、不入队', async () => {
    const onModifyClose = vi.fn()
    await renderHost({ selected: [B], modifyRequest: { element: B, seq: 1 }, onModifyClose })

    fireEvent.click(screen.getByTestId('pick-modify-cancel'))
    await waitFor(() => expect(onModifyClose).toHaveBeenCalled())
    expect(sandboxRead).not.toHaveBeenCalled()
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })
})

describe('待提交 Sheet：条目编辑与固定底栏', () => {
  const QUEUE = [
    { id: 'q1', selector: SELECTOR_A, page: '首页', htmlFile: '首页.html', text: '旧需求', selected: true },
    { id: 'q2', selector: SELECTOR_B, page: '首页', htmlFile: '首页.html', text: '第二条需求', selected: false },
  ]

  async function openQueue(): Promise<void> {
    fireEvent.click(screen.getByTestId('overlays-open-queue'))
    await waitFor(() => expect(screen.getByTestId('overlays-sheet-queue')).toBeTruthy())
  }

  it('底部不再常驻 MultiEditBar；需求条固定 bottom:1rem', async () => {
    localStorage.setItem(EDIT_QUEUE_KEY, JSON.stringify(QUEUE))
    await renderHost({ selected: [A], composerOpen: true })

    expect(screen.queryByTestId('multi-edit-bar')).toBeNull()
    expect(screen.getByTestId('pick-composer').style.bottom).toBe('1rem')
  })

  it('失焦保存 / Ctrl+Enter 保存 / Esc 取消 / 空文本还原', async () => {
    localStorage.setItem(EDIT_QUEUE_KEY, JSON.stringify(QUEUE))
    await renderHost({ toolbarSlot: makeSlot() })
    await openQueue()

    const items = screen.getAllByTestId('overlays-queue-text') as HTMLTextAreaElement[]
    expect(items).toHaveLength(2)
    expect(items[0].value).toBe('旧需求')

    fireEvent.change(items[0], { target: { value: '  新需求  ' } })
    fireEvent.blur(items[0])
    await waitFor(() => expect(readQueue()[0].text).toBe('新需求'))
    // 勾选 / 第二条 / 队列长度均不受编辑影响。
    expect(readQueue()).toHaveLength(2)
    expect(readQueue()[0].selected).toBe(true)
    expect(readQueue()[1].text).toBe('第二条需求')
    expect(readQueue()[1].selected).toBe(false)

    const second = screen.getAllByTestId('overlays-queue-text')[1] as HTMLTextAreaElement
    fireEvent.change(second, { target: { value: 'Ctrl 保存' } })
    fireEvent.keyDown(second, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(readQueue()[1].text).toBe('Ctrl 保存'))

    const first = screen.getAllByTestId('overlays-queue-text')[0] as HTMLTextAreaElement
    fireEvent.change(first, { target: { value: 'Esc 不应保存' } })
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(readQueue()[0].text).toBe('新需求')
    expect(first.value).toBe('新需求')

    fireEvent.change(first, { target: { value: '   ' } })
    fireEvent.blur(first)
    await waitFor(() => expect(screen.getByTestId('overlays-queue-text-error').textContent).toContain('不能为空'))
    expect(readQueue()[0].text).toBe('新需求')
    expect(first.value).toBe('新需求')
  })

  it('底栏固定在滚动区外，提交/清空按钮始终存在', async () => {
    localStorage.setItem(EDIT_QUEUE_KEY, JSON.stringify(QUEUE))
    await renderHost({ toolbarSlot: makeSlot() })
    await openQueue()

    const scroll = screen.getByTestId('overlays-queue-scroll')
    const footer = screen.getByTestId('overlays-queue-footer')
    expect(scroll.contains(footer)).toBe(false)
    expect(footer.className).toContain('shrink-0')
    expect(scroll.className).toContain('overflow-y-auto')
    expect(screen.getByTestId('overlays-queue-submit').textContent).toContain('提交已选（1）')
    expect(screen.getByTestId('overlays-queue-clear')).toBeTruthy()
  })
})

describe('标注：定位高亮 + 面板内直接编辑', () => {
  it('标注入口打开面板，空态提示当前面板直接输入', async () => {
    await renderHost({ toolbarSlot: makeSlot() })
    fireEvent.click(screen.getByTestId('overlays-open-anno'))
    await waitFor(() => expect(screen.getByTestId('anno-panel')).toBeTruthy())
    expect(screen.getByTestId('anno-panel').textContent).toContain('当前面板直接输入')
  })

  it('点击条目只定位高亮，不打开检查器；内容在面板内保存并更新列表', async () => {
    seedAnnos = [ANNO_A]
    await renderHost({ selected: [], toolbarSlot: makeSlot() })
    fireEvent.click(screen.getByTestId('overlays-open-anno'))
    await waitFor(() => expect(screen.getByTestId('anno-panel-input')).toBeTruthy())

    const input = screen.getByTestId('anno-panel-input') as HTMLTextAreaElement
    expect(input.value).toBe('按钮改成蓝色')

    fireEvent.click(screen.getByTestId('anno-panel-item'))
    expect(screen.queryByTestId('overlays-sheet-inspector')).toBeNull()
    expect(screen.getByTestId('overlays-sheet-anno')).toBeTruthy()
    expect(screen.getByTestId('anno-panel-item').getAttribute('data-located')).toBe('1')

    fireEvent.change(input, { target: { value: ' 改成红色圆角 ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(annoSave).toHaveBeenCalledTimes(1))
    const saved = annoSave.mock.calls[0][1] as AnnoItem[]
    expect(saved).toHaveLength(1)
    expect(saved[0].content).toBe('改成红色圆角')
    await waitFor(() =>
      expect((screen.getByTestId('anno-panel-input') as HTMLTextAreaElement).value).toBe('改成红色圆角'),
    )
  })

  it('空标注不保存并还原；删除仍走 Confirm', async () => {
    seedAnnos = [ANNO_A]
    await renderHost({ toolbarSlot: makeSlot() })
    fireEvent.click(screen.getByTestId('overlays-open-anno'))
    await waitFor(() => expect(screen.getByTestId('anno-panel-input')).toBeTruthy())

    const input = screen.getByTestId('anno-panel-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByTestId('anno-panel-error').textContent).toContain('不能为空'))
    expect(annoSave).not.toHaveBeenCalled()
    expect(input.value).toBe('按钮改成蓝色')

    fireEvent.click(screen.getByTestId('anno-panel-delete'))
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByTestId('confirm-dialog')).toBeNull()
    expect(annoSave).not.toHaveBeenCalled()
  })
})
