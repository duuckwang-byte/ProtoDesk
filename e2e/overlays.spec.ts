/**
 * e2e/overlays.spec.ts — W3-08 浮层装配 / 标注 / 快照 / 就地改 / 多选 / 待提交 / 链接。
 *
 * 本仓 e2e 以“静态契约”为主（无需 Electron）：断言装配关系、数据口径与 destructive 确认，
 * 防止后续包把孤儿零件重新拆散或绕开 IPC/Confirm。
 *
 * 真机步骤（手动，不自动执行）：
 * 1. 进入项目并选中原型，舞台右侧出现“预览浮层”工具条；
 * 2. Ctrl+点击元素 → 工具条计数 +1；需求条可提交需求/保存标注/绑定跳转；
 * 3. 标注面板可定位高亮/面板内直编/删除（Confirm）；角标显隐刷新后保持；
 * 4. 快照面板列出 ts，恢复前 Confirm；
 * 5. 多选/就地改提交后只入待提交 Sheet（工具栏入口）；条目可编辑，清空/移除均 Confirm；
 * 6. 链接面板“预览跳转”走 NAV_JUMP；保存绑定时帧内打 STAMP_SET。
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 去注释后断言：注释里的旧方案/说明不算实现代码。 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const HOST = 'src/renderer/features/preview/PreviewOverlaysHost.tsx'
const INLINE = 'src/renderer/features/preview/InlineEdit.tsx'
const MULTI_SELECT = 'src/renderer/features/preview/MultiSelect.tsx'
const ANNO_STORE = 'src/renderer/features/annotations/AnnoStore.ts'
const ANNO_PANEL = 'src/renderer/components/overlays/AnnoPanel.tsx'
const SNAPSHOT_STORE = 'src/renderer/features/snapshot/SnapshotStore.ts'
const SNAPSHOT_PANEL = 'src/renderer/components/overlays/SnapshotPanel.tsx'
const MULTI_BAR = 'src/renderer/components/overlays/MultiEditBar.tsx'
const LINK_BIND = 'src/renderer/features/links/LinkBind.ts'

test.describe('浮层装配（PreviewOverlaysHost）', () => {
  test('装配 PickOverlay + PickComposer + PickModifyDialog + 待提交/标注/快照 Sheet（不渲染 MultiEditBar/检查器）', () => {
    const src = read(HOST)
    expect(src).toContain("from './PickOverlay'")
    expect(src).toContain("from './PickComposer'")
    expect(src).toContain("from './PickModifyDialog'")
    expect(src).toContain('components/overlays/AnnoPanel')
    expect(src).toContain('components/overlays/SnapshotPanel')
    expect(src).toContain('<PickOverlay')
    expect(src).toContain('<PickComposer')
    expect(src).toContain('<PickModifyDialog')
    expect(src).toContain('<AnnoPanel')
    expect(src).toContain('<SnapshotPanel')
    // 待提交只从工具栏入口打开 Sheet，底部不再挂 MultiEditBar。
    expect(src).toContain('data-testid="overlays-open-queue"')
    expect(src).toContain('data-testid="overlays-sheet-queue"')
    expect(src).not.toContain('<MultiEditBar')
    expect(src).not.toContain('data-testid="multi-edit-bar"')
    // W6：检查器已删除，浮层不得再装配 Inspector。
    expect(src).not.toContain('components/overlays/Inspector')
    expect(src).not.toContain('<Inspector')
    expect(src).not.toContain("sheet === 'inspector'")
    expect(src).not.toContain('data-testid="overlays-open-inspector"')
  })

  test('遵循 Stage 契约：hover/selected/需求条/修改框/清理回调，不改 Stage', () => {
    const src = read(HOST)
    for (const key of [
      'hover: PreviewPickedElement | null',
      'selected: PreviewPickedElement[]',
      'pickComposerOpen?: boolean',
      'pickModifyRequest?: PickModifyRequest | null',
      'onPickComposerClose?:',
      'onPickModifyClose?:',
      'onClearSelection?:',
      'onRemoveSelection?:',
      'data-testid="preview-overlays"',
    ]) {
      expect(src).toContain(key)
    }
    expect(src).toContain('pointerEvents')
    expect(src).toContain('TODO(W3-08)')
  })

  test('标注/链接读写落 currentSource.sandboxDir，保存三键 selector+page+htmlFile', () => {
    const src = read(HOST)
    expect(src).toContain('currentSource?.sandboxDir')
    expect(src).toContain('loadAnnos(sandboxDir)')
    expect(src).toContain('saveAnnos(sandboxDir')
    expect(src).toContain('loadLinks(sandboxDir)')
    expect(src).toContain('saveLinks(sandboxDir')
    for (const key of ['selector', 'page', 'htmlFile']) {
      expect(src).toContain(key)
    }
    expect(src).toContain('findAnno(')
    expect(src).toContain('findLink(')
  })

  test('zustand v5：只选原始值/稳定引用，派生数组对象走 useMemo', () => {
    const src = read(HOST)
    expect(src).toContain('useSourcesStore((s) => s.currentSource?.sandboxDir)')
    expect(src).toContain('useSourcesStore((s) => s.sources)')
    expect(src).toContain('useAppStore((s) => s.page)')
    expect(src).toContain('useMemo')
    // 不允许在 selector 中现场构造对象/数组
    expect(src).not.toMatch(/use(?:Sources|App|Ui)Store\(\s*\(s\)\s*=>\s*\(\s*\{/)
    expect(src).not.toMatch(/use(?:Sources|App|Ui)Store\(\s*\(s\)\s*=>\s*\[/)
  })

  test('就地改/多选只入待提交队列，不直调大模型', () => {
    const src = codeOnly(read(HOST))
    expect(src).toContain('enqueue(')
    expect(src).toContain('已加入待提交队列')
    expect(src).not.toContain('ai.ask')
    expect(src).not.toContain('protoAPI.ai')
    expect(src).not.toContain('invokeProtoMethod("ai"')
    expect(src).not.toContain("invokeProtoMethod('ai'")
  })

  test('不改 main/preload：无 ipcRenderer、无新增通道名', () => {
    const files = [HOST, INLINE, MULTI_SELECT, ANNO_STORE, ANNO_PANEL, SNAPSHOT_STORE, SNAPSHOT_PANEL, MULTI_BAR, LINK_BIND]
    for (const f of files) {
      const src = read(f)
      expect(src, f).not.toContain('ipcRenderer')
      expect(src, f).not.toContain('contextBridge')
    }
    const host = codeOnly(read(HOST))
    expect(host).toContain('loadAnnos')
    expect(host).toContain('saveAnnos')
    expect(host).not.toContain('sandbox:')
    expect(host).not.toContain('proto:')
  })

  test('禁止原生 alert/confirm/prompt（统一 Confirm 组件）', () => {
    const files = [HOST, INLINE, MULTI_SELECT, ANNO_PANEL, SNAPSHOT_PANEL, MULTI_BAR]
    for (const f of files) {
      const src = codeOnly(read(f))
      expect(src, f).not.toContain('window.confirm(')
      expect(src, f).not.toContain('window.alert(')
      expect(src, f).not.toContain('window.prompt(')
      expect(src, f).not.toMatch(/(^|[^.\w])alert\(/)
    }
  })
})

test.describe('快照 C4/C5', () => {
  test('snapshot.list 读 items 且条目用 ts', () => {
    const src = read(SNAPSHOT_STORE)
    expect(src).toContain('items')
    expect(src).toContain('items:[{ts')
    expect(src).toContain('ts: string')
    expect(src).toContain('const raw = r.items')
    expect(src).toContain('normalizeSnapshots')
    expect(src).toContain('const raw = r.items ??')
    // 不再以 id/name 作为主键读取
    expect(src).not.toContain('{ dir, id }')
  })

  test('snapshot.restore 发 {dir, ts}（不是 id）', () => {
    const src = read(SNAPSHOT_STORE)
    expect(src).toContain('SNAPSHOT_TS_RE')
    expect(src).toContain('{ dir, ts: String(ts) }')
    expect(src).not.toContain('{ dir, id }')
  })

  test('快照面板：ts 列表 + Confirm + 列表/恢复/失败 toast', () => {
    const src = read(SNAPSHOT_PANEL)
    expect(src).toContain('pendingTs')
    expect(src).toContain('s.ts')
    expect(src).toContain('data-snapshot-ts')
    expect(src).toContain('<Confirm')
    expect(src).toContain('快照列表读取失败')
    expect(src).toContain('快照恢复失败')
    expect(src).toContain('已恢复快照')
    expect(src).toContain('restoreSnapshot(dir, pendingTs)')
  })
})

test.describe('标注 / 链接 / 检查器', () => {
  test('标注三键 + 显隐键 proto_anno_visible（storage-keys 常量只读）', () => {
    const store = read(ANNO_STORE)
    expect(store).toContain('PROTO_ANNO_VISIBLE')
    expect(store).toContain('readAnnoVisible')
    expect(store).toContain('writeAnnoVisible')
    expect(store).toContain('annoMatchKey')
    expect(store).toContain('selector')
    expect(store).toContain('page')
    expect(store).toContain('htmlFile')
    expect(store).not.toContain("localStorage.setItem('proto_anno_visible'")
  })

  test('标注面板：显隐开关 + 面板内直编 + 删除 Confirm + 定位回调', () => {
    const src = read(ANNO_PANEL)
    expect(src).toContain('data-testid="anno-visible-switch"')
    expect(src).toContain('onVisibleChange')
    expect(src).toContain('<Confirm')
    expect(src).toContain('onLocate')
    expect(src).toContain('onDelete')
    expect(src).toContain('annoColorOf')
    // 本轮收敛：标注内容在当前面板内直接编辑/保存，不再打开 Inspector。
    expect(src).toContain('data-testid="anno-panel-input"')
    expect(src).toContain('data-testid="anno-panel-save"')
    expect(src).toContain('onSave')
  })

  test('标注定位只高亮元素，不打开检查器 Sheet', () => {
    const host = codeOnly(read(HOST))
    expect(host).toContain('data-testid="anno-locate-highlight"')
    const locateBlock = host.slice(host.indexOf('const handleLocateAnno'), host.indexOf('const handleSaveJump'))
    expect(locateBlock).toContain('setLocatedAnno')
    expect(locateBlock).not.toContain("setSheet('inspector')")
  })

  test('链接三键 + 只消费既有帧桥协议（W6：折叠键已随检查器删除）', () => {
    const store = read(LINK_BIND)
    expect(store).toContain('findLink(')
    expect(store).toContain('htmlFile')
    expect(store).toContain('buildStampMessage')
    expect(store).toContain('buildNavJumpMessage')
    expect(store).toContain('buildAnnoRectsMessage')
    expect(store).toContain('postToFrame')
    // 不新增协议名：不出现自定义 type 字符串
    expect(store).not.toMatch(/type:\s*['"](?:proto-anno|anno-|link-|STAMP_|NAV_)/)
    expect(store).not.toMatch(/type:\s*['"]?ANNO_RECTS_RESULT/)
    // W6：检查器折叠键随功能删除，不得回流。
    expect(store).not.toContain('LINK_INSP_FOLD')
    expect(store).not.toContain('readLinkFold')
    expect(store).not.toContain('writeLinkFold')
  })

  test('检查器已删除（W6）：组件文件移除，浮层无残留装配', () => {
    expect(fs.existsSync(path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'overlays', 'Inspector.tsx'))).toBe(false)
    const host = codeOnly(read(HOST))
    expect(host).not.toContain('Inspector')
    expect(host).not.toContain("sheet === 'inspector'")
  })
})

test.describe('就地改 / 多选 / 待提交', () => {
  test('InlineEdit：Ctrl+Enter 保存、Esc 放弃、二次确认条', () => {
    const src = read(INLINE)
    expect(src).toContain("ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)")
    expect(src).toContain("ev.key === 'Escape'")
    expect(src).toContain('inline-edit-discard')
    expect(src).toContain('onSubmit')
    expect(src).not.toContain('ai.ask')
  })

  test('MultiSelect：批量/逐个校验 + 加入待提交', () => {
    const src = read(MULTI_SELECT)
    expect(src).toContain('validateBatchReq')
    expect(src).toContain('collectIndividualReqs')
    expect(src).toContain('btnSubmitMultiEdit')
    expect(src).toContain('加入待提交')
    expect(src).toContain('multi-edit-status')
  })

  test('待提交只从工具栏 Sheet 打开：条目可编辑，底栏提交/清空在滚动区外', () => {
    const src = read(HOST)
    expect(src).toContain('data-testid="overlays-open-queue"')
    expect(src).toContain('data-testid="overlays-sheet-queue"')
    expect(src).toContain('data-testid="overlays-queue-scroll"')
    expect(src).toContain('data-testid="overlays-queue-footer"')
    expect(src).toContain('data-testid="overlays-queue-text"')
    expect(src).toContain('data-testid="overlays-queue-submit"')
    expect(src).toContain('data-testid="overlays-queue-clear"')
    // 列表滚动区自身可滚，底部操作栏独立于滚动区（shrink-0）固定显示。
    expect(src).toMatch(/data-testid="overlays-queue-scroll"[^>]*overflow-y-auto/)
    expect(src).toMatch(/data-testid="overlays-queue-footer"[^>]*shrink-0/)
    expect(src).not.toContain('data-testid="multi-edit-bar"')
    expect(src).not.toContain('<MultiEditBar')
  })

  test('待提交队列持久化键 edit_queue_v1（storage-keys 常量只读）', () => {
    const src = read(HOST)
    expect(src).toContain('EDIT_QUEUE_KEY')
    expect(src).toContain('readJson(EDIT_QUEUE_KEY')
    expect(src).toContain('writeJson(EDIT_QUEUE_KEY')
    expect(src).not.toContain("'edit_queue_v1'")
  })
})
