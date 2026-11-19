/**
 * src/renderer/features/preview/__tests__/pick-composer-layer.test.tsx
 *
 * W6 修复回归：需求输入条（PickComposer）层级。
 * - 移动端默认打开的文档面板是 z-40；此前输入条渲染在预览浮层容器（z-30）内，
 *   自身 z-40 被层叠上下文封顶 → 被文档面板盖住；
 * - 修复后输入条 portal 到 body 且 z-50：不再属于 preview-overlays 容器，
 *   始终压过文档面板（z-40），与 Dialog/Sheet 同级（DOM 在前，Sheet 遮罩仍可盖住）。
 */

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewOverlaysHost from '../PreviewOverlaysHost'
import type { PreviewPickedElement } from '../PreviewFrame'
import { useAppStore } from '@/stores/app-store'
import { useSourcesStore, type SourceRef } from '@/stores/sources-store'
import { useUiStore } from '@/stores/ui-store'

const A: PreviewPickedElement = {
  selector: '[data-pr-id="pr-1"]',
  tagName: 'button',
  text: '提交',
  rect: { left: 20, top: 30, width: 120, height: 32 },
}

const SOURCE: SourceRef = {
  name: '首页.html',
  displayName: '首页',
  kind: 'mobile',
  sandboxDir: 'D:/sandbox/测试1/首页',
  mainHtmlFile: '首页.html',
  mdFile: null,
  subPages: [],
  htmlFiles: ['首页.html'],
  content: '<html><body>首页</body></html>',
  md: '',
  pages: [],
  __ver: 1,
}

beforeEach(() => {
  localStorage.clear()
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
    annotations: { read: async () => ({ ok: true, data: [] }), save: async () => ({ ok: true }) },
    links: { read: async () => ({ ok: true, data: { links: [] } }) },
    sandbox: { readFile: async () => ({ ok: true, content: '' }), write: async () => ({ ok: true }) },
  }
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
    refresh: vi.fn(async () => {}),
  })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  localStorage.clear()
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
  useUiStore.setState({ aiOpen: false, settingsTab: null, gitOpen: false, toasts: [] })
  useSourcesStore.setState({
    project: '',
    sources: [],
    currentSource: null,
    activeSubFile: '',
    activeContent: '',
  })
})

describe('需求输入条层级（W6 portal + z-50）', () => {
  it('输入条挂到 body（不在 preview-overlays 容器内）且 z-50 压过文档面板（z-40）', async () => {
    await act(async () => {
      render(
        <PreviewOverlaysHost
          hover={null}
          selected={[A]}
          pickComposerOpen
          pickModifyRequest={null}
          toolbarSlot={null}
          onClearSelection={vi.fn()}
          onPickComposerClose={vi.fn()}
          onPickModifyClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const composer = screen.getByTestId('pick-composer')
    // 1) 逃出 z-30 容器：portal 后 composer 是 body 的后代，但不属于 preview-overlays。
    expect(document.body.contains(composer)).toBe(true)
    expect(composer.closest('[data-testid="preview-overlays"]')).toBeNull()
    // 2) 层级 z-50：高于移动端文档面板（z-40），与 Dialog/Sheet 同级。
    expect(composer.className).toContain('z-50')
    expect(composer.className).not.toContain('z-40')
  })
})
