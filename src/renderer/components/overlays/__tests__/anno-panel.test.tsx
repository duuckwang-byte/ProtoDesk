/**
 * overlays/__tests__/anno-panel.test.tsx — 标注面板收敛回归。
 *
 * 覆盖：
 * - 空态提示「当前面板直接输入」，不再指向检查器；
 * - 点击条目/「定位」只回调 onLocate（宿主只高亮元素），不涉及任何 Sheet 切换；
 * - 条目内容在面板内直接编辑：失焦 / Ctrl+Enter / 保存按钮走 onSave(id, content)；
 * - 空内容不保存并还原；
 * - 显隐开关与删除 Confirm 保留。
 */

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnoPanel } from '../AnnoPanel'
import type { AnnoItem } from '@/features/annotations/AnnoStore'
import { useUiStore } from '@/stores/ui-store'

const ANNO: AnnoItem = {
  id: 'anno_1',
  htmlFile: '首页.html',
  selector: '[data-pr-id="pr-1"]',
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

afterEach(() => {
  cleanup()
  useUiStore.setState({ toasts: [] })
})

describe('AnnoPanel 标注面板', () => {
  it('空态提示在当前面板直接输入', () => {
    render(<AnnoPanel items={[]} />)
    expect(screen.getByTestId('anno-panel-count').textContent).toBe('0')
    expect(screen.getByTestId('anno-panel').textContent).toContain('当前面板直接输入')
    expect(screen.getByTestId('anno-panel').textContent).not.toContain('检查器里填写')
  })

  it('点击条目 / 定位按钮只回调 onLocate，并标记当前定位项', () => {
    const onLocate = vi.fn()
    const { rerender } = render(<AnnoPanel items={[ANNO]} onLocate={onLocate} />)

    fireEvent.click(screen.getByTestId('anno-panel-item'))
    expect(onLocate).toHaveBeenCalledTimes(1)
    expect(onLocate).toHaveBeenCalledWith(ANNO)

    fireEvent.click(screen.getByTestId('anno-panel-locate'))
    expect(onLocate).toHaveBeenCalledTimes(2)

    rerender(<AnnoPanel items={[ANNO]} onLocate={onLocate} locatedId={ANNO.id} />)
    expect(screen.getByTestId('anno-panel-item').getAttribute('data-located')).toBe('1')
  })

  it('直接在面板内编辑：失焦保存 onSave(id, content)', async () => {
    const onSave = vi.fn(async () => true)
    render(<AnnoPanel items={[ANNO]} onSave={onSave} />)

    const input = screen.getByTestId('anno-panel-input') as HTMLTextAreaElement
    expect(input.value).toBe('按钮改成蓝色')
    expect((screen.getByTestId('anno-panel-save') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: ' 改成红色圆角 ' } })
    fireEvent.blur(input)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(ANNO.id, '改成红色圆角')
    expect(screen.queryByTestId('anno-panel-error')).toBeNull()
  })

  it('Ctrl+Enter 与保存按钮同样走 onSave', async () => {
    const onSave = vi.fn(async () => true)
    const { unmount } = render(<AnnoPanel items={[ANNO]} onSave={onSave} />)

    const input = screen.getByTestId('anno-panel-input')
    fireEvent.change(input, { target: { value: '快捷键保存' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(ANNO.id, '快捷键保存'))

    unmount()
    const onSave2 = vi.fn(async () => true)
    render(<AnnoPanel items={[ANNO]} onSave={onSave2} />)
    fireEvent.change(screen.getByTestId('anno-panel-input'), { target: { value: '按钮保存' } })
    fireEvent.click(screen.getByTestId('anno-panel-save'))
    await waitFor(() => expect(onSave2).toHaveBeenCalledWith(ANNO.id, '按钮保存'))
  })

  it('空内容不保存并还原原值', async () => {
    const onSave = vi.fn(async () => true)
    render(<AnnoPanel items={[ANNO]} onSave={onSave} />)

    const input = screen.getByTestId('anno-panel-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    await waitFor(() => expect(screen.getByTestId('anno-panel-error').textContent).toContain('不能为空'))
    expect(onSave).not.toHaveBeenCalled()
    expect(input.value).toBe('按钮改成蓝色')
  })

  it('Esc 只还原本条内容，不触发保存', () => {
    const onSave = vi.fn(async () => true)
    render(<AnnoPanel items={[ANNO]} onSave={onSave} />)

    const input = screen.getByTestId('anno-panel-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '不应保存' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(input.value).toBe('按钮改成蓝色')
  })

  it('保留角标显隐开关与删除 Confirm', async () => {
    const onVisibleChange = vi.fn()
    const onDelete = vi.fn(async () => true)
    render(
      <AnnoPanel items={[ANNO]} visible={true} onVisibleChange={onVisibleChange} onDelete={onDelete} />,
    )

    fireEvent.click(screen.getByTestId('anno-visible-switch'))
    expect(onVisibleChange).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByTestId('anno-panel-delete'))
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByTestId('confirm-dialog')).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('anno-panel-delete'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-dialog-ok'))
      await Promise.resolve()
    })
    expect(onDelete).toHaveBeenCalledWith(ANNO.id)
  })
})
