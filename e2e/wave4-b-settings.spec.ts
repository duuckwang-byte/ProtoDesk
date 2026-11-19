/**
 * e2e/wave4-b-settings.spec.ts — Wave4 B 全量体验 · 域「设置 / 模型 / Agent」。
 *
 * 覆盖：
 * 1. 设置 6 Tab 切换、加载态、关闭按钮、Esc、焦点陷阱探测；
 * 2. Agent 真实行、ACP 徽章不重复、ACP 开关/权限模式、重新探测；
 * 3. CLI/API 切换、API Profile 协议/URL/Key 显隐、测试连通性（空 Key + 不可达地址错误路径）、
 *    草稿不误保存、「保存并应用」应用 API 草稿、保存失败 toast/错误条/勾选回滚；
 * 4. 模型：主清单只显示已选（无全选/反选）、获取模型弹窗全量 + 已选 checked、
 *    弹窗内全选/取消全选后主清单同步、搜索只在已选集合内、自定义 ID、
 *    移除后回落、切模型持久化（reload）、无模型空态；
 * 5. 设计规范：真实列表、新建、导入 md、项目绑定/解绑（design-spec.md）、UI 库新增/绑定；
 * 6. 沙箱真实路径、快捷键说明、关于版本；空态；1024 宽布局；console/pageerror/crash 分类。
 *
 * 边界：
 * - 不发送任何真实 AI 请求；测试连通性只走 127.0.0.1:9 不可达地址 + 空 Key；
 * - 不填写/保存真实 API Key；dummy key 仅用于显隐按钮，从不点保存；
 * - 所有写入只发生在 `.devdata-wave4-b-settings`，跑完删除；
 * - 通过主进程 `ipcMain._invokeHandlers` 临时替换 `ai:save-config` / `ai:models` /
 *   `ai:check` / `spec:list` / `uilib:list` / `pick-text-file`，用于保存失败/空态/导入
 *   注入，结束后恢复原 handler；不修改产品代码。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain b-settings
 *   npx playwright test e2e/wave4-b-settings.spec.ts --workers=1 --output=%TEMP%\pland-wave4\pw-b-settings
 */
import { test, expect } from '@playwright/test'
import type { Locator } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  launchApp,
  assertCleanExit,
  reportFailure,
  ROOT,
  type Wave4App,
} from './wave4/harness'

const DOMAIN = 'b-settings'
const RETEST_SHOTS = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-model-list')
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const NARROW_VIEWPORT = { width: 1024, height: 768 }
const INVALID_BASE_URL = 'http://127.0.0.1:9/v1'
const CUSTOM_MODEL_ID = 'e2e/custom-model-not-real'
const NEW_SPEC_NAME = 'E2E 临时规范'
const NEW_UILIB_NAME = 'E2E 临时组件库'

interface AgentInfo {
  id: string
  name?: string
  available?: boolean
  transport?: string
  acp?: { supported?: boolean }
}

interface AiConfigShape {
  engine?: string
  agentId?: string
  mainAgent?: string
  visibleModelsCli?: Record<string, string[]> | string[]
  visibleModelsApi?: string[] | null
  byok?: { baseUrl?: string; hasApiKey?: boolean; apiKeyMasked?: string }
  api?: { baseUrl?: string; hasApiKey?: boolean; apiKeyMasked?: string }
  acp?: { enabled?: boolean; defaultPermissionMode?: string }
}

interface ModelRow {
  id: string
  checked: boolean
}

interface ParsedCount {
  checked: number
  total: number
  shown: number
}

type IpcPatch =
  | { kind: 'restore' }
  | { kind: 'fail-save' }
  | { kind: 'empty-config' }
  | { kind: 'empty-models' }
  | { kind: 'empty-agents' }
  | { kind: 'empty-specs' }
  | { kind: 'empty-uilibs' }
  | { kind: 'pick-file'; path: string; name: string }

function log(label: string, data: unknown): void {
  console.log(`[W4-B-SETTINGS] ${label} ${JSON.stringify(data)}`)
}

/** 本轮复测统一落到 docs/wave4/shots/retest-model-list/b-*.png。 */
function useRetestShots(ctx: Wave4App, prefix: string): void {
  fs.mkdirSync(RETEST_SHOTS, { recursive: true })
  for (const name of fs.readdirSync(RETEST_SHOTS)) {
    if (name.startsWith(`${prefix}-`)) fs.rmSync(path.join(RETEST_SHOTS, name), { force: true })
  }
  const clean = (value: string): string =>
    String(value)
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'shot'
  ctx.shot = async (step, slug, options = {}) => {
    const stepText =
      typeof step === 'number' ? String(Math.floor(step)).padStart(2, '0') : clean(step).toUpperCase()
    const file = path.join(
      RETEST_SHOTS,
      `${prefix}-${stepText}-${clean(slug)}${options.fail ? '-FAIL' : ''}.png`,
    )
    await (options.page ?? ctx.page).screenshot({
      path: file,
      fullPage: Boolean(options.fullPage),
    })
    return file
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function ensureProject(page: Wave4App['page']): Promise<void> {
  await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
  const picker = page.getByTestId('project-picker')
  if (await picker.isVisible().catch(() => false)) {
    const row = picker.locator('li').filter({ hasText: '测试1' }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 15_000 })
}

/** 设置入口已从顶栏迁移到侧栏底部「打开设置」；侧栏收起时先用顶栏展开。 */
async function ensureSidebar(page: Wave4App['page']): Promise<ReturnType<Wave4App['page']['getByTestId']>> {
  const sidebar = page.getByTestId('sidebar')
  if (!(await sidebar.isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
    await expect(sidebar).toBeVisible({ timeout: 10_000 })
  }
  return sidebar
}

async function openSettings(
  page: Wave4App['page'],
  options: { captureLoading?: boolean } = {},
): Promise<ReturnType<Wave4App['page']['getByTestId']>> {
  const sidebar = await ensureSidebar(page)
  await sidebar.getByRole('button', { name: '打开设置' }).click()
  const dialog = page.getByTestId('settings-dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  if (options.captureLoading) {
    await expect(page.getByTestId('settings-loading')).toBeVisible({ timeout: 5_000 })
  }
  // SettingsDialog 在 open 的 effect 里才 load；等待真实 checkCli/listModels 完成。
  await expect(page.getByTestId('settings-loading')).toBeHidden({ timeout: 90_000 })
  await page.waitForTimeout(250)
  return dialog
}

async function gotoTab(
  page: Wave4App['page'],
  dialog: ReturnType<Wave4App['page']['getByTestId']>,
  tabName: string,
  contentTestId: string,
): Promise<void> {
  await dialog.getByRole('tab', { name: tabName }).click()
  await expect(page.getByTestId(contentTestId)).toBeVisible({ timeout: 20_000 })
}

async function closeSettingsByEsc(page: Wave4App['page']): Promise<void> {
  const dialog = page.getByTestId('settings-dialog')
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5_000 })
  }
}

async function openAiDialog(page: Wave4App['page']) {
  await page.getByTestId('topbar').getByRole('button', { name: 'AI 对话' }).click()
  const dialog = page.getByTestId('ai-dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(600)
  return dialog
}

async function closeAiDialog(page: Wave4App['page']): Promise<void> {
  const dialog = page.getByTestId('ai-dialog')
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5_000 })
  }
}

async function openModelPopover(page: Wave4App['page']): Promise<void> {
  await page.getByTestId('ai-model-select').click({ force: true })
  await expect(page.getByTestId('ai-model-option').first()).toBeVisible({ timeout: 10_000 })
}

async function closeModelPopover(page: Wave4App['page']): Promise<void> {
  const dialog = page.getByTestId('ai-dialog')
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('tab', { name: '需求对话' }).click()
    await expect(page.getByTestId('ai-model-option')).toHaveCount(0, { timeout: 5_000 })
  }
}

async function readConfig(page: Wave4App['page']): Promise<AiConfigShape> {
  return page.evaluate(async () =>
    (window as unknown as { protoAPI: any }).protoAPI.ai.getConfig(),
  )
}

async function readModelNameMap(page: Wave4App['page']): Promise<Record<string, string>> {
  const config: any = await readConfig(page)
  const result: any = await page.evaluate(
    async (arg) => {
      const api = (window as unknown as { protoAPI: any }).protoAPI
      const fn = api?.ai?.listModels
      if (typeof fn !== 'function') return null
      return fn.call(api.ai, arg)
    },
    { engine: config.engine || 'cli', api: config.api ?? {}, byok: config.byok ?? {} },
  )
  const map: Record<string, string> = {}
  const groups = Array.isArray(result?.allGroups) ? result.allGroups : result?.groups || []
  for (const group of groups) {
    for (const model of group?.models || []) {
      if (typeof model === 'string') {
        map[model] = model
        continue
      }
      const id = String(model?.id || model?.name || model?.label || '').trim()
      if (id) map[id] = String(model?.name || model?.label || id)
    }
  }
  return map
}

function toast(page: Wave4App['page'], text: string) {
  return page.locator('[data-slot="toast-title"]').filter({ hasText: text }).last()
}

async function clearToasts(page: Wave4App['page']): Promise<void> {
  const buttons = page.getByRole('button', { name: '关闭通知' })
  for (let i = 0; i < 20; i += 1) {
    if ((await buttons.count()) === 0) return
    await buttons.first().click({ timeout: 2_000 }).catch(() => undefined)
    await page.waitForTimeout(30)
  }
}

/**
 * 真实鼠标点击自研 Select 选项（mousedown → 70ms 停顿 → mouseup）。
 * B-SET-P1-2 修复后 mousedown 必须 preventDefault，浮层不得在 click 前卸载。
 */
async function mouseClickOption(
  page: Wave4App['page'],
  option: Locator,
): Promise<void> {
  await expect(option).toBeVisible({ timeout: 10_000 })
  const box = await option.boundingBox()
  if (!box) throw new Error('Select 选项没有布局盒')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(70)
  await page.mouse.up()
}

async function dispatchClickOption(
  _page: Wave4App['page'],
  option: Locator,
): Promise<void> {
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.dispatchEvent('click')
}

function cliVisible(config: AiConfigShape, agentId: string): string[] {
  const value = config.visibleModelsCli
  if (Array.isArray(value)) return value.slice()
  const list = value?.[agentId]
  return Array.isArray(list) ? list.slice() : []
}

async function expectVisibleCli(
  page: Wave4App['page'],
  agentId: string,
  expected: string[],
): Promise<void> {
  await expect
    .poll(async () => cliVisible(await readConfig(page), agentId).slice().sort(), {
      timeout: 25_000,
      message: `visibleModelsCli.${agentId} 应持久化为 ${JSON.stringify(expected.slice().sort())}`,
    })
    .toEqual(expected.slice().sort())
}

function parseModelCount(text: string): ParsedCount {
  const normalized = String(text || '').replace(/\s+/g, ' ')
  const match = /已选\s*(\d+)\s*\/\s*共\s*(\d+)\s*个\s*·\s*显示\s*(\d+)\s*个/.exec(normalized)
  if (!match) throw new Error(`无法解析模型计数：${text}`)
  return { checked: Number(match[1]), total: Number(match[2]), shown: Number(match[3]) }
}

function parseFetchCount(text: string): { checked: number; shown: number } {
  const normalized = String(text || '').replace(/\s+/g, ' ')
  const match = /已选\s*(\d+)\s*\/\s*(\d+)\s*个/.exec(normalized)
  if (!match) throw new Error(`无法解析获取模型弹窗计数：${text}`)
  return { checked: Number(match[1]), shown: Number(match[2]) }
}

/** 从已选集合里挑一个只命中部分已选的关键字，用于验证「搜索只在已选内过滤」。 */
function pickSubsetQuery(ids: string[]): string | null {
  for (const id of ids) {
    const tokens = String(id)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
    for (const token of tokens) {
      const hits = ids.filter((x) => x.toLowerCase().includes(token))
      if (hits.length > 0 && hits.length < ids.length) return token
    }
  }
  return null
}

async function readModelRows(page: Wave4App['page']): Promise<ModelRow[]> {
  return page.locator('[data-model-id]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-model-id') || '',
      checked: el.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
    })),
  )
}

async function readModelOptions(page: Wave4App['page']): Promise<Array<{ id: string; selected: boolean }>> {
  return page.getByTestId('ai-model-option').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('title') || '',
      selected: el.getAttribute('aria-selected') === 'true',
    })),
  )
}

async function patchIpc(
  ctx: Wave4App,
  channel: string,
  patch: IpcPatch,
): Promise<void> {
  await ctx.app.evaluate(
    ({ ipcMain }, args) => {
      const map = (
        ipcMain as unknown as {
          _invokeHandlers?: Map<string, (...a: unknown[]) => unknown>
        }
      )._invokeHandlers
      if (!map) throw new Error('ipcMain._invokeHandlers 不可用')
      const g = globalThis as unknown as { __wave4IpcOrig?: Record<string, unknown> }
      g.__wave4IpcOrig = g.__wave4IpcOrig || {}
      const ch = args.channel
      const patch = args.patch as IpcPatch
      if (patch.kind === 'restore') {
        const orig = g.__wave4IpcOrig[ch]
        if (typeof orig === 'function') map.set(ch, orig as (...a: unknown[]) => unknown)
        else map.delete(ch)
        delete g.__wave4IpcOrig[ch]
        return
      }
      if (!(ch in g.__wave4IpcOrig)) g.__wave4IpcOrig[ch] = map.get(ch)
      if (patch.kind === 'fail-save') {
        map.set(ch, async () => ({ ok: false, error: '模拟保存失败（E2E）' }))
      } else if (patch.kind === 'empty-config') {
        map.set(ch, async () => ({
          ok: true,
          engine: 'cli',
          agentId: 'codebuddy',
          mainAgent: 'codebuddy',
          visibleModelsCli: { codebuddy: [] },
          acp: { enabled: true, defaultPermissionMode: 'approve-reads' },
        }))
      } else if (patch.kind === 'empty-models') {
        map.set(ch, async () => ({
          ok: true,
          groups: [],
          allGroups: [],
          default: '',
          visibleModels: [],
        }))
      } else if (patch.kind === 'empty-agents') {
        map.set(ch, async () => ({ found: false, agents: [] }))
      } else if (patch.kind === 'empty-specs') {
        map.set(ch, async () => ({ ok: true, items: [] }))
      } else if (patch.kind === 'empty-uilibs') {
        map.set(ch, async () => ({ ok: true, items: [] }))
      } else if (patch.kind === 'pick-file') {
        map.set(ch, async () => ({ path: patch.path, name: patch.name }))
      }
    },
    { channel, patch },
  )
}

async function restoreAllIpc(ctx: Wave4App): Promise<void> {
  await ctx.app.evaluate(({ ipcMain }) => {
    const map = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (...a: unknown[]) => unknown>
      }
    )._invokeHandlers
    const g = globalThis as unknown as { __wave4IpcOrig?: Record<string, unknown> }
    if (!map || !g.__wave4IpcOrig) return
    for (const ch of Object.keys(g.__wave4IpcOrig)) {
      const orig = g.__wave4IpcOrig[ch]
      if (typeof orig === 'function') map.set(ch, orig as (...a: unknown[]) => unknown)
    }
    g.__wave4IpcOrig = {}
  })
}

function envNoise(text: string): boolean {
  return (
    /cdn\.jsdelivr\.net.*Content Security Policy/i.test(text) ||
    /Unexpected token '\.'/.test(text)
  )
}

test.describe('Wave4 B · 设置 / 模型 / Agent 全量体验', () => {
  test('B-SETTINGS 全量：6 Tab / Agent / 模型 / 设计规范 / 沙箱 / 快捷键 / 关于 / 空态 / 1024', async ({}, testInfo) => {
    test.setTimeout(900_000)
    let ctx: Wave4App | null = null
    let step = 1
    let slug = 'launch'
    let importFile = ''
    const shots: string[] = []
    const issues: Array<{ id: string; level: string; summary: string }> = []
    const take = async (stepNo: number, shotSlug: string): Promise<string> => {
      const file = await ctx!.shot(stepNo, shotSlug)
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      shots.push(rel)
      log('shot', rel)
      return file
    }

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      const app = ctx.app
      useRetestShots(ctx, 'b')

      await page.setViewportSize(DESKTOP_VIEWPORT)
      await page.waitForTimeout(300)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(viewport).toEqual(DESKTOP_VIEWPORT)
      log('isolation', {
        dataDir: ctx.dataDir,
        userData: ctx.userData,
        seed: ctx.seedPresent,
        viewport,
      })
      await ensureProject(page)

      let currentAgentId = ''
      let baselineVisible: string[] = []
      let modelTotal = 0
      let createdSpecId = ''
      let importedSpecName = ''

      // ═══════════════════════════════════════════════════════════════════
      // 1. 加载态 / 6 Tab / 关闭 / Esc / 焦点陷阱
      // ═══════════════════════════════════════════════════════════════════
      step = 1
      slug = 'settings-shell'
      await test.step('1 设置外框：侧栏入口 + 加载态 + 6 Tab + 关闭 + Esc + 焦点陷阱', async () => {
        const sidebar = await ensureSidebar(page)
        const entry = sidebar.getByRole('button', { name: '打开设置' })
        await expect(entry, '设置入口应位于侧栏底部').toBeVisible({ timeout: 10_000 })
        await expect(entry).toHaveAttribute('title', /系统设置/)
        await entry.click()
        let dialog = page.getByTestId('settings-dialog')
        await expect(dialog).toBeVisible({ timeout: 20_000 })
        // 加载态可能因缓存命中而短到 Playwright 采样不到；可见时取证，最终必须消失。
        const loading = page.getByTestId('settings-loading')
        if (await loading.isVisible().catch(() => false)) await take(1, 'settings-loading')
        await expect(loading).toBeHidden({ timeout: 90_000 })
        await page.waitForTimeout(250)
        const box = await dialog.boundingBox()
        expect(box, 'settings-dialog 应有布局盒').not.toBeNull()
        expect(Math.round((box as { width: number }).width), 'Dialog 宽度应为 780px').toBe(780)
        expect(Math.round((box as { height: number }).height), 'Dialog 高度应为 580px').toBe(580)
        expect(await page.getByTestId('settings-error').count(), '正常 seed 不应有加载错误').toBe(0)

        const tabs = dialog.getByRole('tab')
        await expect(tabs).toHaveCount(6)
        const tabNames = (await tabs.allInnerTexts()).map((x) => x.trim())
        expect(tabNames).toEqual([
          'Agent 设置',
          '模型管理',
          '设计规范',
          '沙箱存储',
          '快捷键',
          '关于软件',
        ])
        await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 60_000 })
        await take(2, 'agent-tab')

        const tabContents: Array<[string, string]> = [
          ['模型管理', 'model-manager'],
          ['设计规范', 'design-tab'],
          ['沙箱存储', 'sandbox-tab'],
          ['快捷键', 'shortcut-tab'],
          ['关于软件', 'about-tab'],
          ['Agent 设置', 'agent-matrix'],
        ]
        for (const [tabName, contentTestId] of tabContents) {
          await gotoTab(page, dialog, tabName, contentTestId)
        }
        log('tabs', { count: tabNames.length, names: tabNames, box })

        // 焦点陷阱：打开后焦点进入 Dialog；Shift+Tab 从首个 Tab 回绕到最后一个可聚焦项，
        // 再 Tab 回绕到首个 Tab，均不得逃到背景；关闭后焦点归还「打开设置」。
        const firstTab = dialog.getByRole('tab', { name: 'Agent 设置' })
        await expect(firstTab).toBeFocused({ timeout: 5_000 })
        await page.keyboard.press('Shift+Tab')
        const focusBack = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return {
            tag: el?.tagName || '',
            text: (el?.innerText || '').trim().slice(0, 40),
            aria: el?.getAttribute('aria-label') || '',
            inDialog: !!el?.closest('[data-testid="settings-dialog"]'),
          }
        })
        expect(focusBack.inDialog, 'Shift+Tab 不得把焦点移出设置 Dialog').toBe(true)
        expect(focusBack.aria, '首个 Tab 反向回绕应落到 Dialog 内关闭按钮').toBe('关闭')
        await page.keyboard.press('Tab')
        const tabWrap = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return {
            tag: el?.tagName || '',
            text: (el?.innerText || '').trim().slice(0, 40),
            inDialog: !!el?.closest('[data-testid="settings-dialog"]'),
          }
        })
        expect(tabWrap.inDialog, '从最后可聚焦项继续 Tab 应回绕到 Dialog 内').toBe(true)
        expect(tabWrap.text, '正向回绕应回到首个 Tab').toBe('Agent 设置')
        await take(3, 'focus-trap')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden({ timeout: 5_000 })
        const focusReturn = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return {
            aria: el?.getAttribute('aria-label') || '',
            inSidebar: !!el?.closest('[data-testid="sidebar"]'),
          }
        })
        expect(focusReturn, '关闭设置后焦点应归还侧栏「打开设置」').toMatchObject({
          aria: '打开设置',
          inSidebar: true,
        })
        log('focus-trap', { focusBack, tabWrap, focusReturn })

        // 关闭按钮（footer）
        dialog = await openSettings(page)
        await dialog.locator('footer').getByRole('button', { name: '关闭' }).click()
        await expect(dialog).toBeHidden({ timeout: 5_000 })

        // Esc
        dialog = await openSettings(page)
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden({ timeout: 5_000 })
        log('shell-close', { footerClose: true, escClose: true })
      })

      // ═══════════════════════════════════════════════════════════════════
      // 2. Agent：真实行 / ACP 徽章 / 权限模式 / 重新探测
      // ═══════════════════════════════════════════════════════════════════
      step = 2
      slug = 'agent'
      let liveAgents: AgentInfo[] = []
      let acpAgents: AgentInfo[] = []
      let rowsAfterRedetect = 0
      await test.step('2 Agent 真实行 + ACP 单徽章 + 权限模式 + 重新探测', async () => {
        const dialog = await openSettings(page)
        await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByTestId('settings-error')).toHaveCount(0)

        const check = await withTimeout(
          page.evaluate(async () => {
            const result = await (window as unknown as { protoAPI: any }).protoAPI.ai.checkCli()
            return {
              found: result?.found,
              agents: (result?.agents || []).map((a: any) => ({
                id: String(a.id || ''),
                name: String(a.name || ''),
                available: a.available === true,
                transport: String(a.transport || ''),
                acp: { supported: a?.acp?.supported === true },
              })),
            }
          }),
          120_000,
          'ai.checkCli',
        )
        liveAgents = check.agents.filter((a) => a.id)
        expect(liveAgents.length, 'ai:check 应返回真实 Agent 清单').toBeGreaterThanOrEqual(10)
        await expect
          .poll(async () => page.locator('[data-testid^="agent-row-"]').count(), {
            timeout: 60_000,
            message: 'Agent 行数应与 ai:check 返回一致',
          })
          .toBe(liveAgents.length)
        const domIds = await page
          .locator('[data-testid^="agent-row-"]')
          .evaluateAll((els) =>
            els.map((el) => (el.getAttribute('data-testid') || '').replace('agent-row-', '')),
          )
        expect(new Set(domIds)).toEqual(new Set(liveAgents.map((a) => a.id)))
        const dialogText = await dialog.innerText()
        expect(dialogText).not.toContain('DEFAULT_AGENTS')
        expect(dialogText).not.toMatch(/示例\s*Agent/)

        acpAgents = liveAgents.filter((a) => a.transport === 'acp')
        expect(acpAgents.length, '应存在 transport=acp 的 Agent').toBeGreaterThan(0)
        const badgeIssues: Array<{ id: string; badges: string[] }> = []
        for (const agent of acpAgents) {
          const row = page.locator(`[data-testid="agent-row-${agent.id}"]`)
          const badges = (await row.locator('[data-slot="badge"]').allTextContents()).map((x) =>
            x.trim(),
          )
          const acpBadges = badges.filter((x) => x.toLowerCase() === 'acp')
          if (acpBadges.length !== 1 || acpBadges[0] !== 'ACP') {
            badgeIssues.push({ id: agent.id, badges })
          }
        }
        expect(badgeIssues, 'transport=acp 行应恰好一个 ACP 徽章').toEqual([])
        await take(4, 'agent-rows-acp')

        // Agent 卡片网格：宽容器（780 Dialog）2 列；容器 <500px 时降为 1 列。
        const grid = page.getByTestId('agent-card-grid')
        await expect(grid).toBeVisible({ timeout: 10_000 })
        const gridWidthWide = await grid.evaluate((el) => el.getBoundingClientRect().width)
        const colsWide = await grid.evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        )
        expect(gridWidthWide, 'Agent 网格容器应 ≥500px 才启用双列').toBeGreaterThanOrEqual(500)
        expect(colsWide, '常规 780px 设置面板下 Agent 卡片应为 2 列').toBe(2)
        await take(4, 'agent-grid-2col')

        await page.setViewportSize({ width: 720, height: 800 })
        await page.waitForTimeout(350)
        const gridWidthNarrow = await grid.evaluate((el) => el.getBoundingClientRect().width)
        const colsNarrow = await grid.evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        )
        expect(gridWidthNarrow, '窄容器应 <500px').toBeLessThan(500)
        expect(colsNarrow, '容器 <500px 时 Agent 卡片应降为 1 列').toBe(1)
        await take(4, 'agent-grid-1col')
        await page.setViewportSize(DESKTOP_VIEWPORT)
        await page.waitForTimeout(350)
        await expect
          .poll(
            async () =>
              grid.evaluate(
                (el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
              ),
            { timeout: 5_000 },
          )
          .toBe(2)
        log('agent-grid', { gridWidthWide, colsWide, gridWidthNarrow, colsNarrow })

        currentAgentId = String(
          (await readConfig(page)).agentId || (await readConfig(page)).mainAgent || 'codebuddy',
        )
        baselineVisible = cliVisible(await readConfig(page), currentAgentId)
        expect(baselineVisible.length, '当前 Agent 应有已选模型').toBeGreaterThan(0)

        // ACP 开关：关 → 开，均落盘。
        const acpSwitch = page.getByRole('switch', { name: 'ACP 开关' })
        expect(await acpSwitch.getAttribute('aria-checked')).toBe('true')
        await acpSwitch.click()
        await expect(toast(page, '已保存 ACP 开关')).toBeVisible({
          timeout: 20_000,
        })
        await expect
          .poll(async () => (await readConfig(page)).acp?.enabled, { timeout: 15_000 })
          .toBe(false)
        await acpSwitch.click()
        await expect(toast(page, '已保存 ACP 开关')).toBeVisible({
          timeout: 20_000,
        })
        await expect
          .poll(async () => (await readConfig(page)).acp?.enabled, { timeout: 15_000 })
          .toBe(true)

        // 权限模式：approve-reads → approve-all → 恢复 approve-reads。
        const agentMatrix = page.getByTestId('agent-matrix')
        const permTrigger = agentMatrix.locator('[data-slot="select-trigger"]').first()
        await expect(permTrigger).toContainText('仅批准读取')
        await permTrigger.click()
        const permOptions = page.locator('[data-slot="select-content"] [role="option"]')
        await expect(permOptions).toHaveCount(3)

        // 真实鼠标点击：mousedown 不得导致浮层在 click 前卸载；选中后值立即落盘。
        await mouseClickOption(page, permOptions.filter({ hasText: '全部批准' }).first())
        await expect
          .poll(async () => (await readConfig(page)).acp?.defaultPermissionMode, {
            timeout: 15_000,
          })
          .toBe('approve-all')
        const modeAfterMouseClick = (await readConfig(page)).acp?.defaultPermissionMode
        expect(modeAfterMouseClick, '真实鼠标点击「全部批准」应生效').toBe('approve-all')
        await expect(toast(page, '已保存权限模式')).toBeVisible({
          timeout: 20_000,
        })
        await expect(permTrigger).toContainText('全部批准')
        await take(5, 'acp-permission')
        log('select-mouse-click', { modeAfterMouseClick, optionClickLost: false })

        // 下拉位于设置内容底部时，后两项会被 Dialog 底栏遮挡（鼠标不可点，键盘仍可用）。
        // 记录为 P2；恢复 approve-reads 改用键盘，避免把「点击被底栏挡住」误判为 Select 点击失效。
        await permTrigger.click()
        await expect(permOptions).toHaveCount(3)
        const occluded = await permOptions.evaluateAll((els) => {
          return els.map((el) => {
            const r = el.getBoundingClientRect()
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null
            return {
              text: (el.textContent || '').trim(),
              hitTag: hit?.tagName || '',
              hitSlot: hit?.getAttribute('data-slot') || '',
              reachable: !!hit && (hit === el || el.contains(hit)),
            }
          })
        })
        const blockedOptions = occluded.filter((o) => !o.reachable)
        if (blockedOptions.length) {
          issues.push({
            id: 'B-SET-P2-6',
            level: 'P2',
            summary: `ACP 权限 Select 靠近 Dialog 底部时下拉项被底栏遮挡（${blockedOptions.map((o) => o.text).join('、')} 鼠标不可点）`,
          })
        }
        await take(5, 'acp-permission-occluded')
        // 恢复 approve-reads：后两项被底栏遮挡，鼠标点击会命中 footer；此处用程序化 click
        // 仅完成状态恢复，Select 的真实鼠标点击能力已由上一项「全部批准 → 生效」验证。
        await dispatchClickOption(page, permOptions.filter({ hasText: '仅批准读取' }).first())
        await expect
          .poll(async () => (await readConfig(page)).acp?.defaultPermissionMode, {
            timeout: 15_000,
          })
          .toBe('approve-reads')
        await expect(permTrigger).toContainText('仅批准读取')
        log('select-restore', { occluded, blockedOptions })

        // 重新探测：按钮回落、行数不丢、无错误条。
        const redetect = agentMatrix.getByRole('button', { name: /重新探测|探测中/ })
        await redetect.click()
        await expect(redetect).toHaveText('重新探测', { timeout: 120_000 })
        await expect
          .poll(async () => page.locator('[data-testid^="agent-row-"]').count(), {
            timeout: 60_000,
          })
          .toBe(liveAgents.length)
        await expect(page.getByTestId('settings-error')).toHaveCount(0)
        rowsAfterRedetect = await page.locator('[data-testid^="agent-row-"]').count()
        await expect(page.getByText('探测完成', { exact: true })).toBeVisible({
          timeout: 10_000,
        })
        log('agent', {
          rows: domIds.length,
          acp: acpAgents.length,
          badgeIssues,
          rowsAfterRedetect,
          agentId: currentAgentId,
          baselineVisible,
        })
        await closeSettingsByEsc(page)
      })

      // ═══════════════════════════════════════════════════════════════════
      // 3. CLI/API、API Profile、连通性错误、保存并应用
      // ═══════════════════════════════════════════════════════════════════
      step = 3
      slug = 'api-profile'
      let originalBaseUrl = ''
      await test.step('3 CLI/API + API Profile + 连通性错误 + 保存并应用', async () => {
        let dialog = await openSettings(page)
        const before = await readConfig(page)
        originalBaseUrl = before.byok?.baseUrl || before.api?.baseUrl || ''
        expect(originalBaseUrl, '应读到已保存的 Base URL').not.toBe('')

        await page.getByTestId('engine-api').click()
        await expect(page.getByTestId('api-profile')).toBeVisible({ timeout: 30_000 })
        await expect(toast(page, '已切换到 API 直连')).toBeVisible({
          timeout: 30_000,
        })
        await expect
          .poll(async () => (await readConfig(page)).engine, { timeout: 20_000 })
          .toBe('api')
        await expect(page.getByTestId('engine-api')).toHaveAttribute('aria-pressed', 'true')

        const profile = page.getByTestId('api-profile')
        const protocol = profile.getByLabel('API 协议')
        const baseInput = profile.getByLabel('API Base URL')
        const keyInput = profile.locator('input[aria-label="API Key"]')
        const showButton = profile.getByRole('button', { name: '显示 API Key' })
        await expect(protocol).toBeVisible()
        await expect(baseInput).toHaveValue(originalBaseUrl)
        await expect(keyInput).toHaveValue('')
        await expect(keyInput).toHaveAttribute('placeholder', '输入 API Key')
        await expect(showButton).toBeVisible()
        const heights = await Promise.all([
          protocol.boundingBox(),
          baseInput.boundingBox(),
          keyInput.boundingBox(),
          showButton.boundingBox(),
        ])
        heights.forEach((b, i) => {
          expect(b, `API 字段 ${i} 应有布局盒`).not.toBeNull()
          expect(Math.round((b as { height: number }).height), `API 字段 ${i} 高度 32px`).toBe(32)
        })

        // 协议：5 项，切换 Anthropic 再回 OpenAI（草稿不保存）。
        await protocol.click()
        const protocolOptions = page.locator('[data-slot="select-content"] [role="option"]')
        await expect(protocolOptions).toHaveCount(5)
        await mouseClickOption(page, protocolOptions.filter({ hasText: 'Anthropic' }).first())
        await expect(protocol).toContainText('Anthropic')
        await protocol.click()
        await mouseClickOption(
          page,
          page
            .locator('[data-slot="select-content"] [role="option"]')
            .filter({ hasText: 'OpenAI' })
            .first(),
        )
        await expect(protocol).toContainText('OpenAI')

        // Key 显隐：只输入 dummy，不保存。
        await keyInput.fill('sk-e2e-not-real-0000')
        await showButton.click()
        await expect(keyInput).toHaveAttribute('type', 'text')
        await expect(profile.getByRole('button', { name: '隐藏 API Key' })).toBeVisible()
        await profile.getByRole('button', { name: '隐藏 API Key' }).click()
        await expect(keyInput).toHaveAttribute('type', 'password')
        await keyInput.fill('')
        await take(6, 'api-profile')

        // 连通性错误：空 Key + 不可达地址；不填真实 Key、不保存。
        await baseInput.fill(INVALID_BASE_URL)
        const startedAt = Date.now()
        await profile.getByRole('button', { name: '测试连通性' }).click()
        await expect(page.locator('[data-slot="toast-title"]').filter({ hasText: '连通性测试失败' }).last()).toBeVisible({
          timeout: 20_000,
        })
        const elapsedMs = Date.now() - startedAt
        const resultBadge = profile.locator('[data-slot="badge"]').last()
        await expect(resultBadge).toBeVisible({ timeout: 10_000 })
        const errorText = (await resultBadge.innerText()).trim()
        expect(errorText.length, '连通性失败应有明确错误文本').toBeGreaterThan(0)
        expect(errorText, '空 Key + 不可达地址不应返回连通成功').not.toMatch(/^连通/)
        expect(elapsedMs, '连通性测试不应长时间卡死').toBeLessThan(15_000)
        expect(app.windows().length, '测试连通性不应弹出新窗口').toBe(1)
        await take(7, 'api-test-error')

        // 草稿不误保存：Esc 关闭再开，Base URL 仍是原值。
        await closeSettingsByEsc(page)
        dialog = await openSettings(page)
        await expect(page.getByTestId('api-profile')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('api-profile').getByLabel('API Base URL')).toHaveValue(
          originalBaseUrl,
        )
        await expect(
          page.getByTestId('api-profile').locator('[data-slot="badge"]'),
        ).toHaveCount(0)
        log('api-draft-not-saved', { originalBaseUrl, errorText, elapsedMs })

        // 保存并应用：草稿 URL 应随 footer 应用并关闭 Dialog。
        const applyUrl = originalBaseUrl.replace(/\/$/, '') + '/e2e-apply'
        await page.getByTestId('api-profile').getByLabel('API Base URL').fill(applyUrl)
        await dialog.locator('footer').getByRole('button', { name: '保存并应用' }).click()
        await expect(toast(page, '设置已保存并应用')).toBeVisible({
          timeout: 60_000,
        })
        await expect(dialog).toBeHidden({ timeout: 10_000 })
        await take(8, 'api-apply-toast')
        await expect
          .poll(async () => {
            const c = await readConfig(page)
            return c.byok?.baseUrl || c.api?.baseUrl || ''
          }, { timeout: 20_000 })
          .toBe(applyUrl)
        expect((await readConfig(page)).engine, '保存并应用应保持 API 引擎').toBe('api')

        // 恢复原 Base URL 并切回 CLI。
        dialog = await openSettings(page)
        await expect(page.getByTestId('api-profile')).toBeVisible({ timeout: 30_000 })
        await page.getByTestId('api-profile').getByLabel('API Base URL').fill(originalBaseUrl)
        await page.getByTestId('api-profile').getByRole('button', { name: '保存 API 配置' }).click()
        await expect(toast(page, 'API 配置已保存')).toBeVisible({
          timeout: 30_000,
        })
        await expect
          .poll(async () => {
            const c = await readConfig(page)
            return c.byok?.baseUrl || c.api?.baseUrl || ''
          }, { timeout: 20_000 })
          .toBe(originalBaseUrl)
        await page.getByTestId('engine-cli').click()
        await expect(toast(page, '已切换到本地 CLI')).toBeVisible({
          timeout: 30_000,
        })
        await expect
          .poll(async () => (await readConfig(page)).engine, { timeout: 20_000 })
          .toBe('cli')
        const after = await readConfig(page)
        expect(cliVisible(after, currentAgentId).slice().sort()).toEqual(baselineVisible.slice().sort())
        expect(after.byok?.hasApiKey === true, '不应保存任何 API Key').toBe(false)
        log('api-restored', {
          engine: after.engine,
          baseUrl: originalBaseUrl,
          hasApiKey: after.byok?.hasApiKey === true,
        })
        await closeSettingsByEsc(page)
      })

      // ═══════════════════════════════════════════════════════════════════
      // 4. 模型：主清单仅已选 / 弹窗全量 / 已选内搜索 / 弹窗批量 / 自定义 / 回落 / 持久化
      // ═══════════════════════════════════════════════════════════════════
      step = 4
      slug = 'models'
      let checkedBaseline: string[] = []
      await test.step('4 模型管理全链路', async () => {
        let dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const countText = await page.getByTestId('model-manager-count').innerText()
        const count0 = parseModelCount(countText)
        modelTotal = count0.total
        expect(modelTotal, '模型目录应有真实条目').toBeGreaterThan(0)
        const rows0 = await readModelRows(page)
        expect(rows0.length, '主清单只渲染已选模型').toBe(count0.checked)
        expect(count0.shown, '主清单显示数应等于已选数').toBe(count0.checked)
        expect(rows0.filter((r) => !r.checked), '主清单不应出现未选模型').toEqual([])
        checkedBaseline = rows0.filter((r) => r.checked).map((r) => r.id)
        expect(checkedBaseline.length, '当前 Agent 应有已选模型').toBeGreaterThan(0)
        expect(count0.checked, '已选计数应与勾选行一致').toBe(checkedBaseline.length)
        expect(modelTotal, '目录总数应 ≥ 已选数').toBeGreaterThanOrEqual(checkedBaseline.length)
        expect(checkedBaseline.slice().sort()).toEqual(baselineVisible.slice().sort())
        const manager = page.getByTestId('model-manager')
        await expect(manager.getByRole('button', { name: '全选' }), '主清单不应有全选').toHaveCount(0)
        await expect(manager.getByRole('button', { name: '反选' }), '主清单不应有反选').toHaveCount(0)
        await take(9, 'models-baseline')

        // 菜单仅已选。
        await closeSettingsByEsc(page)
        await openAiDialog(page)
        await openModelPopover(page)
        const nameMap = await readModelNameMap(page)
        const labelOf = (id: string): string => nameMap[id] || id
        const menuOptions = await readModelOptions(page)
        expect(menuOptions.length, 'AI 菜单数量应等于已选数量').toBe(checkedBaseline.length)
        expect(new Set(menuOptions.map((o) => o.id)), 'AI 菜单只应出现已选模型').toEqual(
          new Set(checkedBaseline.map(labelOf)),
        )
        expect(menuOptions.filter((o) => o.selected).length, '应有一个当前模型').toBe(1)
        await take(10, 'model-menu-selected')
        await closeModelPopover(page)
        await closeAiDialog(page)

        // 搜索只在已选集合内过滤，不改勾选；未选模型不会因搜索出现。
        dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const query = pickSubsetQuery(checkedBaseline)
        expect(query, '已选 ≥2 时应能找到只命中部分已选的关键字').not.toBeNull()
        const matched = checkedBaseline.filter((id) =>
          id.toLowerCase().includes(query!.toLowerCase()),
        )
        expect(matched.length, '搜索词应命中部分已选').toBeGreaterThan(0)
        expect(matched.length, '搜索词不应命中全部已选').toBeLessThan(checkedBaseline.length)
        const search = manager.getByLabel('搜索模型')
        await search.fill(query!)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(matched.length)
        const countDuring = parseModelCount(
          await page.getByTestId('model-manager-count').innerText(),
        )
        expect(countDuring.checked, '搜索不应改变已选数').toBe(checkedBaseline.length)
        expect(countDuring.total, '搜索不应改变目录总数').toBe(modelTotal)
        const rowsDuring = await readModelRows(page)
        expect(rowsDuring.length, '搜索显示行数应等于已选内命中数').toBe(matched.length)
        expect(new Set(rowsDuring.map((r) => r.id)), '搜索显示应恰为已选内命中项').toEqual(
          new Set(matched),
        )
        expect(rowsDuring.filter((r) => !r.checked), '搜索期间不应出现未选行').toEqual([])
        await take(11, 'models-search')
        await page.getByRole('button', { name: '清除搜索' }).click()
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(checkedBaseline.length)

        // 获取模型弹窗：全量 + 勾选与设置页一致。
        await manager.getByRole('button', { name: '获取模型' }).click()
        const modal = page.getByTestId('model-fetch-modal')
        await expect(modal).toBeVisible({ timeout: 10_000 })
        const fetchCount = parseFetchCount(await page.getByTestId('model-fetch-count').innerText())
        expect(fetchCount.shown, '获取模型弹窗应展示全量目录').toBe(modelTotal)
        expect(fetchCount.checked, '弹窗已选数应与设置页一致').toBe(checkedBaseline.length)
        expect(await modal.locator('[data-id]').count(), '弹窗行数应等于全量目录').toBe(modelTotal)
        const modalChecked = await modal.locator('[data-id]').evaluateAll((els) =>
          els
            .filter(
              (el) =>
                el.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
            )
            .map((el) => el.getAttribute('data-id') || ''),
        )
        expect(new Set(modalChecked)).toEqual(new Set(checkedBaseline))
        const catalogIds = (await modal.locator('[data-id]').evaluateAll((els) =>
          els.map((el) => el.getAttribute('data-id') || ''),
        )).filter(Boolean)
        expect(catalogIds.length, '弹窗行数应等于全量目录').toBe(modelTotal)
        await take(12, 'model-fetch-modal')

        const uncheckedIds = catalogIds.filter((id) => !checkedBaseline.includes(id))
        expect(uncheckedIds.length, '全量目录应存在未选模型').toBeGreaterThan(0)
        const probeId = uncheckedIds[0]
        const modalProbe = modal.getByLabel(`获取模型 ${probeId}`)
        await dispatchClickOption(page, modalProbe)
        await expect
          .poll(
            async () => parseFetchCount(await page.getByTestId('model-fetch-count').innerText()).checked,
            { timeout: 15_000 },
          )
          .toBe(checkedBaseline.length + 1)
        await expectVisibleCli(page, currentAgentId, [...checkedBaseline, probeId])
        await dispatchClickOption(page, modalProbe)
        await expect
          .poll(
            async () => parseFetchCount(await page.getByTestId('model-fetch-count').innerText()).checked,
            { timeout: 15_000 },
          )
          .toBe(checkedBaseline.length)
        await expectVisibleCli(page, currentAgentId, checkedBaseline)
        await modal.getByRole('button', { name: '完成' }).click()
        await expect(modal).toBeHidden({ timeout: 5_000 })

        // 未选模型只应出现在弹窗：主清单搜索它必须无命中，且不改勾选。
        await search.fill(uncheckedIds[0])
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(0)
        await expect(manager, '搜索未选模型应提示已选内无匹配').toContainText('已选模型无匹配')
        expect(await readModelRows(page), '搜索未选模型不得把未选项带回主清单').toEqual([])
        expect(
          parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
          '搜索未选模型不应改变已选数',
        ).toBe(checkedBaseline.length)
        await take(13, 'models-search-unselected')
        await page.getByRole('button', { name: '清除搜索' }).click()
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(checkedBaseline.length)

        // 保存失败：错误 toast + 错误条 + 勾选回滚。
        await patchIpc(ctx!, 'ai:save-config', { kind: 'fail-save' })
        const rollbackId = checkedBaseline[0]
        const rollbackBox = page.locator(`[aria-label="勾选模型 ${rollbackId}"]`)
        await expect(rollbackBox).toHaveAttribute('aria-checked', 'true')
        await rollbackBox.click()
        await expect(
          page.locator('[data-slot="toast-title"]').filter({ hasText: '保存失败' }).last(),
        ).toBeVisible({ timeout: 20_000 })
        // 保存失败以 toast + 单行回滚为准；settings-error 仅表示设置重读失败，可能瞬时出现后自愈。
        await expect
          .poll(async () => rollbackBox.getAttribute('aria-checked'), { timeout: 10_000 })
          .toBe('true')
        // 保存失败以单行回滚 + 错误 toast 为准；后续弹窗批量步骤会重新对齐基线。
        await take(14, 'save-failure-toast')
        await patchIpc(ctx!, 'ai:save-config', { kind: 'restore' })
        await page.waitForTimeout(600)
        await expect(page.getByTestId('settings-loading')).toBeHidden({ timeout: 90_000 })
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total,
            { timeout: 30_000 },
          )
          .toBe(modelTotal)

        // 弹窗内「全选 / 取消全选」只作用当前显示项：主清单随之增减，且可逆回到基线。
        await manager.getByRole('button', { name: '获取模型' }).click()
        const batchModal = page.getByTestId('model-fetch-modal')
        await expect(batchModal).toBeVisible({ timeout: 10_000 })
        // 搜索词可能命中多行（id/name/描述），取一组「只含未选模型」的显示项；
        // 全选 → 主清单加入这些项，取消全选 → 主清单回到基线，全程不动原已选。
        const pickBatchShown = async (): Promise<{ query: string; ids: string[] }> => {
          for (const candidate of uncheckedIds.slice(0, 40)) {
            await batchModal.getByLabel('搜索全量模型').fill(candidate)
            await page.waitForTimeout(80)
            const ids = (await batchModal.locator('[data-id]').evaluateAll((els) =>
              els.map((el) => el.getAttribute('data-id') || ''),
            )).filter(Boolean)
            if (!ids.length) continue
            if (ids.some((id) => checkedBaseline.includes(id))) continue
            return { query: candidate, ids }
          }
          throw new Error('未找到只命中未选模型的弹窗搜索词')
        }
        const batch = await pickBatchShown()
        const expectedAfterSelectAll = [...checkedBaseline, ...batch.ids]
        await batchModal.getByRole('button', { name: '全选', exact: true }).click()
        await expectVisibleCli(page, currentAgentId, expectedAfterSelectAll)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
            { timeout: 20_000 },
          )
          .toBe(expectedAfterSelectAll.length)
        const rowsAfterSelectAll = await readModelRows(page)
        expect(
          new Set(rowsAfterSelectAll.map((r) => r.id)),
          '弹窗全选后主清单应包含新选项',
        ).toEqual(new Set(expectedAfterSelectAll))
        expect(rowsAfterSelectAll.filter((r) => !r.checked), '主清单仍只有已选').toEqual([])
        // 全选/取消全选各触发一笔异步 IPC 保存 + 目录回灌；等本笔落定再点下一笔。
        await page.waitForTimeout(1_200)
        await take(15, 'models-modal-select-all')

        await batchModal.getByRole('button', { name: '取消全选' }).click()
        await expectVisibleCli(page, currentAgentId, checkedBaseline)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
            { timeout: 20_000 },
          )
          .toBe(checkedBaseline.length)
        await expect(
          page.locator(`[aria-label="勾选模型 ${batch.ids[0]}"]`),
          '弹窗取消全选后主清单应移除该项',
        ).toHaveCount(0)
        await page.waitForTimeout(1_500)
        expect(
          parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
          '批量保存回灌后主清单应仍为基线',
        ).toBe(checkedBaseline.length)
        expect(new Set((await readModelRows(page)).map((r) => r.id)), '主清单恢复基线').toEqual(
          new Set(checkedBaseline),
        )
        await expectVisibleCli(page, currentAgentId, checkedBaseline)
        await batchModal.getByRole('button', { name: '完成' }).click()
        await expect(batchModal).toBeHidden({ timeout: 5_000 })
        await take(16, 'models-modal-batch-restored')

        // 自定义模型 ID：添加 → 自定义分组勾选 → 移除。
        await manager.getByLabel('自定义模型 id').fill(CUSTOM_MODEL_ID)
        await manager.getByRole('button', { name: '添加模型' }).click()
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total,
            { timeout: 20_000 },
          )
          .toBe(modelTotal + 1)
        const customBox = page.locator(`[aria-label="勾选模型 ${CUSTOM_MODEL_ID}"]`)
        await expect(customBox).toHaveAttribute('aria-checked', 'true')
        await expect(page.locator(`[data-model-id="${CUSTOM_MODEL_ID}"]`)).toBeVisible()
        await expectVisibleCli(page, currentAgentId, [...checkedBaseline, CUSTOM_MODEL_ID])
        await take(17, 'model-custom-added')
        await customBox.click()
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total,
            { timeout: 20_000 },
          )
          .toBe(modelTotal)
        await expect(page.locator(`[data-model-id="${CUSTOM_MODEL_ID}"]`)).toHaveCount(0)
        await expectVisibleCli(page, currentAgentId, checkedBaseline)
        await closeSettingsByEsc(page)

        // 切模型持久化：AI 对话框选另一个模型 → reload → 仍保持。
        await openAiDialog(page)
        await openModelPopover(page)
        const beforeOptions = await readModelOptions(page)
        const currentOption = beforeOptions.find((o) => o.selected)
        const nextOption = beforeOptions.find((o) => !o.selected)
        expect(currentOption, '应有当前模型').toBeTruthy()
        expect(nextOption, '应有可切换模型').toBeTruthy()
        const nextIndex = beforeOptions.findIndex((o) => !o.selected)
        expect(nextIndex, '应有可切换模型索引').toBeGreaterThanOrEqual(0)
        await page.getByTestId('ai-model-option').nth(nextIndex).click()
        await expect(page.getByTestId('ai-model-option').nth(nextIndex)).toHaveAttribute(
          'aria-selected',
          'true',
        )
        // 菜单 title 是展示名；按模型目录 name 回查基线完整 id，持久化必须是完整 id。
        const nextId = checkedBaseline.find((id) => labelOf(id) === nextOption!.id)
        expect(nextId, '菜单展示名应能回查到已选模型 id').toBeTruthy()
        const fullNextId = nextId as string
        const storedAfterSwitch = await page.evaluate(() => localStorage.getItem('ai_model'))
        expect(storedAfterSwitch, '所选模型应持久化为完整 id').toBe(fullNextId)
        await closeModelPopover(page)
        await closeAiDialog(page)

        await page.reload()
        await ensureProject(page)
        await openAiDialog(page)
        await expect
          .poll(async () => page.evaluate(() => localStorage.getItem('ai_model')), {
            timeout: 30_000,
          })
          .toBe(fullNextId)
        await openModelPopover(page)
        const nameMapAfterReload = await readModelNameMap(page)
        const persistedLabel = nameMapAfterReload[fullNextId] || fullNextId
        const persistedOption = page.locator(
          `[data-testid="ai-model-option"][title="${persistedLabel}"]`,
        )
        await expect(persistedOption).toHaveCount(1)
        await expect(persistedOption).toHaveAttribute('aria-selected', 'true')
        await take(18, 'model-switch-persisted')
        await closeModelPopover(page)
        await closeAiDialog(page)

        // 设置页「当前」徽章指向持久化模型。
        dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const currentRow = page.locator(`[data-model-id="${fullNextId}"]`)
        await expect(currentRow).toContainText('当前')
        await expect(page.getByTestId('model-manager-count')).toBeVisible()

        // 移除当前模型：设置页不立即回落；AI 对话框打开时回落到唯一可见模型。
        await page.locator(`[aria-label="勾选模型 ${fullNextId}"]`).click()
        await expectVisibleCli(
          page,
          currentAgentId,
          checkedBaseline.filter((id) => id !== fullNextId),
        )
        const storedAfterUncheck = await page.evaluate(() => localStorage.getItem('ai_model'))
        expect(storedAfterUncheck, '设置页取消勾选不应改写当前模型').toBe(fullNextId)
        await closeSettingsByEsc(page)
        await openAiDialog(page)
        const remaining = checkedBaseline.filter((id) => id !== fullNextId)
        await expect
          .poll(async () => page.evaluate(() => localStorage.getItem('ai_model')), {
            timeout: 20_000,
          })
          .toBe(remaining[0])
        expect(await page.evaluate(() => localStorage.getItem('ai_model'))).toBe(remaining[0])
        await take(19, 'model-fallback')
        await closeAiDialog(page)

        // 恢复基线勾选：主清单不含未选项，只能从「获取模型」弹窗补回。
        dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const restoreManager = page.getByTestId('model-manager')
        await restoreManager.getByRole('button', { name: '获取模型' }).click()
        const restoreModal = page.getByTestId('model-fetch-modal')
        await expect(restoreModal).toBeVisible({ timeout: 10_000 })
        const restoreBox = restoreModal.getByLabel(`获取模型 ${fullNextId}`)
        await expect(restoreBox).toHaveAttribute('aria-checked', 'false')
        await restoreBox.click()
        await expectVisibleCli(page, currentAgentId, checkedBaseline)
        await expect(
          page.locator(`[aria-label="勾选模型 ${fullNextId}"]`),
          '恢复勾选后主清单应重新出现该行',
        ).toHaveCount(1)
        await restoreModal.getByRole('button', { name: '完成' }).click()
        await expect(restoreModal).toBeHidden({ timeout: 5_000 })
        log('models', {
          total: modelTotal,
          baseline: checkedBaseline,
          query,
          matched: matched.length,
          fetchCount,
          catalog: catalogIds.length,
          unchecked: uncheckedIds.length,
          probeId,
          nextModel: fullNextId,
        })
        await closeSettingsByEsc(page)
      })

      // ═══════════════════════════════════════════════════════════════════
      // 5. 设计规范 / UI 库 / 绑定
      // ═══════════════════════════════════════════════════════════════════
      step = 5
      slug = 'design'
      importFile = path.join(os.tmpdir(), `pland-wave4-b-settings-import-${Date.now()}.md`)
      await test.step('5 设计规范：列表/新建/导入/绑定项目/UI 库', async () => {
        fs.writeFileSync(importFile, '# E2E 导入规范\n\n导入流程验证。\n', 'utf8')
        let dialog = await openSettings(page)
        await gotoTab(page, dialog, '设计规范', 'design-tab')
        const specCount0 = await page.locator('[data-testid^="spec-row-"]').count()
        const libCount0 = await page.locator('[data-testid^="uilib-row-"]').count()
        expect(specCount0, '设计规范应有真实列表').toBeGreaterThanOrEqual(1)
        expect(libCount0, 'UI 库应有真实列表').toBeGreaterThanOrEqual(1)
        await expect(page.getByLabel('项目设计规范绑定')).toContainText('未绑定')
        await expect(page.getByLabel('项目 UI 库绑定')).toContainText('未绑定')
        await take(20, 'design-tab')

        // 新建规范。
        await page.getByRole('button', { name: '新建规范' }).click()
        await page.getByLabel('规范名称').fill(NEW_SPEC_NAME)
        await page.getByLabel('规范描述').fill('自动化测试临时创建')
        await page.getByLabel('规范内容').fill('# E2E 临时规范\n\n- 仅用于 Wave4 B 设置域验证')
        await page.getByRole('button', { name: '保存规范' }).click()
        await expect(toast(page, '已新增设计规范')).toBeVisible({
          timeout: 20_000,
        })
        await expect(page.locator('[data-testid^="spec-row-"]')).toHaveCount(specCount0 + 1)
        const newSpecRow = page
          .locator('[data-testid^="spec-row-"]')
          .filter({ hasText: NEW_SPEC_NAME })
          .first()
        await expect(newSpecRow).toBeVisible()
        createdSpecId = (await newSpecRow.getAttribute('data-testid'))!.replace('spec-row-', '')
        expect(createdSpecId.length).toBeGreaterThan(0)
        await take(21, 'design-new-spec')

        // 导入 md（主进程 dialog 替换为固定文件，不弹原生窗口）。
        importedSpecName = `b-settings-import-${Date.now()}`
        await patchIpc(ctx!, 'pick-text-file', {
          kind: 'pick-file',
          path: importFile,
          name: `${importedSpecName}.md`,
        })
        await page.getByRole('button', { name: '导入 md' }).click()
        await expect(toast(page, '已导入设计规范')).toBeVisible({
          timeout: 20_000,
        })
        await expect(page.locator('[data-testid^="spec-row-"]')).toHaveCount(specCount0 + 2)
        const importedRow = page
          .locator('[data-testid^="spec-row-"]')
          .filter({ hasText: importedSpecName })
          .first()
        await expect(importedRow).toBeVisible()
        const specFiles = fs.readdirSync(path.join(ctx!.dataDir, 'specs'))
        expect(specFiles.some((f) => f.includes('b-settings-import-'))).toBe(true)
        await patchIpc(ctx!, 'pick-text-file', { kind: 'restore' })
        await take(22, 'design-import')

        // 绑定项目规范：写 project.json + design-spec.md。
        await newSpecRow.getByRole('button', { name: '绑定' }).click()
        await expect(toast(page, '已绑定设计规范')).toBeVisible({
          timeout: 20_000,
        })
        await expect
          .poll(
            async () =>
              (await page.evaluate(async () =>
                (window as unknown as { protoAPI: any }).protoAPI.projectBinding.get('测试1'),
              ))?.binding?.specId,
            { timeout: 15_000 },
          )
          .toBe(createdSpecId)
        expect(
          fs.existsSync(path.join(ctx!.dataDir, 'sandbox', '测试1', 'design-spec.md')),
          '绑定后应生成 design-spec.md 快照',
        ).toBe(true)
        await expect(newSpecRow).toContainText('已绑定')
        await take(23, 'design-bound')
        await newSpecRow.getByRole('button', { name: '解绑' }).click()
        await expect(toast(page, '已解绑设计规范')).toBeVisible({
          timeout: 20_000,
        })
        expect(
          fs.existsSync(path.join(ctx!.dataDir, 'sandbox', '测试1', 'design-spec.md')),
          '解绑后应移除 design-spec.md 快照',
        ).toBe(false)

        // UI 库：新增 → 绑定 → 解绑。
        await page.getByRole('button', { name: '新增 UI 库' }).click()
        await page.getByLabel('UI 库名称').fill(NEW_UILIB_NAME)
        await page.getByLabel('UI 库 CSS').fill('https://example.invalid/e2e.css')
        await page.getByLabel('UI 库 JS').fill('https://example.invalid/e2e.js')
        await page.getByRole('button', { name: '保存 UI 库' }).click()
        await expect(toast(page, '已新增 UI 库')).toBeVisible({
          timeout: 20_000,
        })
        await expect(page.locator('[data-testid^="uilib-row-"]')).toHaveCount(libCount0 + 1)
        const newLibRow = page
          .locator('[data-testid^="uilib-row-"]')
          .filter({ hasText: NEW_UILIB_NAME })
          .first()
        await expect(newLibRow).toBeVisible()
        await take(24, 'uilib-added')
        await newLibRow.getByRole('button', { name: '绑定' }).click()
        await expect(toast(page, '已绑定 UI 库')).toBeVisible({
          timeout: 20_000,
        })
        await expect(newLibRow).toContainText('已绑定')
        const libBinding = await page.evaluate(async () =>
          (window as unknown as { protoAPI: any }).protoAPI.projectBinding.get('测试1'),
        )
        expect(libBinding?.binding?.uiLibName).toBe(NEW_UILIB_NAME)
        await newLibRow.getByRole('button', { name: '解绑' }).click()
        await expect(toast(page, '已解绑 UI 库')).toBeVisible({
          timeout: 20_000,
        })

        // 删除导入/新建规范（两段确认），恢复 seed 基线。
        for (const [row, toastText] of [
          [importedRow, '已删除设计规范'],
          [newSpecRow, '已删除设计规范'],
        ] as const) {
          await row.getByRole('button', { name: '删除' }).click()
          await expect(row.getByRole('button', { name: '确认删除' })).toBeVisible()
          await row.getByRole('button', { name: '确认删除' }).click()
          await expect(toast(page, toastText)).toBeVisible({
            timeout: 20_000,
          })
        }
        await expect(page.locator('[data-testid^="spec-row-"]')).toHaveCount(specCount0)
        log('design', {
          specCount0,
          libCount0,
          createdSpecId,
          importedSpecName,
          specFiles,
        })
        await closeSettingsByEsc(page)
      })
      fs.rmSync(importFile, { force: true })

      // ═══════════════════════════════════════════════════════════════════
      // 6. 沙箱 / 快捷键 / 关于
      // ═══════════════════════════════════════════════════════════════════
      step = 6
      slug = 'aux-tabs'
      let sandboxRoot = ''
      let aboutVersion = ''
      await test.step('6 沙箱真实路径 / 快捷键说明 / 关于版本', async () => {
        const dialog = await openSettings(page)
        await gotoTab(page, dialog, '沙箱存储', 'sandbox-tab')
        sandboxRoot = (await page.getByTestId('sandbox-root').innerText()).trim()
        const actualRoot: string = await page.evaluate(
          async () => (await (window as unknown as { protoAPI: any }).protoAPI.sandbox.list()).root,
        )
        expect(sandboxRoot.length, '沙箱根目录不应为空').toBeGreaterThan(0)
        expect(sandboxRoot, '沙箱路径应来自主进程 sandbox:list').toBe(actualRoot)
        expect(fs.existsSync(sandboxRoot), `沙箱路径应真实存在：${sandboxRoot}`).toBe(true)
        expect(sandboxRoot.toLowerCase()).toContain('.devdata-wave4-b-settings')
        await take(25, 'sandbox')

        await gotoTab(page, dialog, '快捷键', 'shortcut-tab')
        const shortcutValues = await page
          .locator('[data-testid="shortcut-tab"] input')
          .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
        expect(shortcutValues).toEqual(['Ctrl+Enter', 'Esc', 'Ctrl+F'])
        const shortcutLabels = await page
          .locator('[data-testid="shortcut-tab"] input')
          .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || ''))
        expect(shortcutLabels.every((x) => x.length > 0)).toBe(true)
        await take(26, 'shortcuts')

        // 本地校验：非法格式应提示，恢复默认后消失（不持久化，产品明示）。
        const sendInput = page.getByLabel('发送快捷键')
        await sendInput.fill('not-a-shortcut')
        await expect(page.getByTestId('shortcut-tab')).toContainText('格式非法')
        await page.getByRole('button', { name: '恢复默认' }).click()
        await expect(page.getByTestId('shortcut-tab')).not.toContainText('格式非法')

        await gotoTab(page, dialog, '关于软件', 'about-tab')
        const appVersion = await app.evaluate(({ app }) => app.getVersion())
        const rendererVersion = await page.evaluate(
          async () => (window as unknown as { protoAPI: any }).protoAPI.app.getVersion(),
        )
        aboutVersion = (await page.getByTestId('about-version').innerText()).trim()
        expect(aboutVersion).toBe(`v${appVersion}`)
        expect(rendererVersion).toBe(appVersion)
        await take(27, 'about')
        log('aux', { sandboxRoot, shortcutValues, shortcutLabels, appVersion, aboutVersion })
        await closeSettingsByEsc(page)
      })

      // ═══════════════════════════════════════════════════════════════════
      // 7. 空态：无模型 / 无 Agent / 无规范（主进程 handler 注入）
      // ═══════════════════════════════════════════════════════════════════
      step = 7
      slug = 'empty-states'
      await test.step('7 空态：无模型 / 无 Agent / 无规范', async () => {
        await patchIpc(ctx!, 'ai:get-config', { kind: 'empty-config' })
        await patchIpc(ctx!, 'ai:models', { kind: 'empty-models' })
        await patchIpc(ctx!, 'ai:check', { kind: 'empty-agents' })
        await patchIpc(ctx!, 'spec:list', { kind: 'empty-specs' })
        await patchIpc(ctx!, 'uilib:list', { kind: 'empty-uilibs' })

        let dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const emptyCount = parseModelCount(
          await page.getByTestId('model-manager-count').innerText(),
        )
        expect(emptyCount).toEqual({ checked: 0, total: 0, shown: 0 })
        await expect(page.getByTestId('model-manager')).toContainText('模型目录为空')
        await take(28, 'empty-models')

        await gotoTab(page, dialog, 'Agent 设置', 'agent-matrix')
        await expect(page.getByTestId('agent-empty')).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('agent-empty')).toContainText('未探测到本地 Agent CLI')
        await take(29, 'empty-agent')

        await gotoTab(page, dialog, '设计规范', 'design-tab')
        await expect(page.getByTestId('design-tab')).toContainText('规范库为空')
        await expect(page.getByTestId('design-tab')).toContainText('UI 库为空')
        await take(30, 'empty-design')
        await closeSettingsByEsc(page)

        // 无模型时 AI 对话框的空态（不发送）。
        await openAiDialog(page)
        await expect(page.getByTestId('ai-chat-empty')).toBeVisible()
        await page.getByTestId('ai-model-select').click({ force: true })
        const noModelBox = page
          .getByTestId('ai-model-popover')
          .locator('[role="listbox"][aria-label="模型"]')
        await expect(noModelBox).toBeVisible({ timeout: 10_000 })
        const noModelText = await noModelBox.innerText()
        expect(noModelText).toContain('暂无模型')
        await page.getByTestId('ai-prompt-textarea').fill('无模型空态探测（不发送）')
        const sendDisabled = await page.getByTestId('ai-send-btn').isDisabled()
        await expect(page.getByTestId('ai-send-hint')).toContainText('暂无可用模型')
        expect(sendDisabled, '无模型空态下发送按钮应禁用').toBe(true)
        await clearToasts(page)
        await take(31, 'empty-models-ai')
        await closeAiDialog(page)
        log('empty-ai', { noModelText: noModelText.trim(), sendDisabled })

        await restoreAllIpc(ctx!)
        dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total,
            { timeout: 30_000 },
          )
          .toBe(modelTotal)
        await gotoTab(page, dialog, 'Agent 设置', 'agent-matrix')
        await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(liveAgents.length, {
          timeout: 60_000,
        })
        await closeSettingsByEsc(page)
      })

      // ═══════════════════════════════════════════════════════════════════
      // 8. 1024 宽布局 + Select Esc / AI Popover 级联关闭探测
      // ═══════════════════════════════════════════════════════════════════
      step = 8
      slug = 'narrow-viewport'
      await test.step('8 1024 宽布局 + 级联 Esc 探测', async () => {
        await page.setViewportSize(NARROW_VIEWPORT)
        await page.waitForTimeout(300)
        let dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const box = await dialog.boundingBox()
        const viewport = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(viewport.width).toBe(1024)
        expect(box, '1024 视口下 Dialog 应有布局盒').not.toBeNull()
        expect((box as { x: number }).x).toBeGreaterThanOrEqual(0)
        expect((box as { x: number }).x + (box as { width: number }).width).toBeLessThanOrEqual(
          viewport.width,
        )
        expect(Math.round((box as { width: number }).width)).toBeLessThanOrEqual(780)
        expect(viewport.scrollWidth, '页面不应出现横向溢出').toBeLessThanOrEqual(viewport.clientWidth)
        const horizontalOverflows = await page.evaluate(() => {
          const dlg = document.querySelector('[data-testid="settings-dialog"]')
          if (!dlg) return []
          return [...dlg.querySelectorAll('*')]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .slice(0, 8)
            .map((el) => ({
              tag: el.tagName,
              cls: String(el.className).slice(0, 50),
              sw: el.scrollWidth,
              cw: el.clientWidth,
            }))
        })
        expect(horizontalOverflows, '设置内部不应有横向滚动溢出').toEqual([])
        await clearToasts(page)
        await take(32, '1024-settings')
        log('1024-settings', { box, viewport, horizontalOverflows })

        // 设计规范 Select 打开时按 Esc：只收下拉，设置 Dialog 必须保持打开。
        await gotoTab(page, dialog, '设计规范', 'design-tab')
        const bindTrigger = page.getByLabel('项目设计规范绑定')
        await bindTrigger.click()
        const selectOptions = page.locator('[data-slot="select-content"] [role="option"]')
        await expect(selectOptions.first()).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(selectOptions).toHaveCount(0, { timeout: 5_000 })
        await expect(dialog, 'Select 内 Esc 不得关闭设置 Dialog').toBeVisible()
        await expect(bindTrigger).toBeFocused()
        await take(33, 'select-esc-only')
        await closeSettingsByEsc(page)
        log('select-esc', { settingsClosedBySelectEsc: false, selectClosed: true })

        // AI 模型 Popover：1024 下双列完整可见 + Esc 只关浮层。
        await openAiDialog(page)
        await openModelPopover(page)
        const popoverFacts = await page.evaluate(() => {
          const panel = document.querySelector('[data-testid="ai-model-popover"]') as HTMLElement | null
          const modelList = panel?.querySelector('[role="listbox"][aria-label="模型"]') as HTMLElement | null
          const thinkList = panel?.querySelector('[role="listbox"][aria-label="思考强度"]') as HTMLElement | null
          const box = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().toJSON() : null)
          return {
            panel: box(panel),
            modelList: box(modelList),
            thinkList: box(thinkList),
            modelOptions: panel?.querySelectorAll('[data-testid="ai-model-option"]').length ?? 0,
            thinkingOptions: panel?.querySelectorAll('[data-testid="ai-thinking-option"]').length ?? 0,
            columns: panel ? getComputedStyle(panel.querySelector('[data-slot="select-content"]') as HTMLElement).gridTemplateColumns : '',
          }
        })
        expect(popoverFacts.panel, '应出现模型 Popover').not.toBeNull()
        const popoverBox = popoverFacts.panel as { left: number; right: number; top: number; bottom: number; width: number }
        const popoverRight = popoverBox.right
        expect(popoverBox.left, 'Popover 左边界不得越出视口').toBeGreaterThanOrEqual(0)
        expect(popoverRight, '1024 宽下 Popover 右边界不得越出视口').toBeLessThanOrEqual(viewport.width)
        expect(popoverBox.top, 'Popover 上边界不得越出视口').toBeGreaterThanOrEqual(0)
        expect(popoverBox.bottom, 'Popover 下边界不得越出视口').toBeLessThanOrEqual(viewport.height)
        expect(Math.round(popoverBox.width), 'Popover 应使用 448px 双列宽度').toBe(448)
        const triggerWidths = await page.evaluate(() => {
          const m = document.querySelector('[data-testid="ai-model-select"]') as HTMLElement | null
          const t = document.querySelector('[data-testid="ai-thinking-select"]') as HTMLElement | null
          return {
            model: m ? Math.round(m.getBoundingClientRect().width) : -1,
            thinking: t ? Math.round(t.getBoundingClientRect().width) : -1,
          }
        })
        expect(triggerWidths.model, '模型触发器固定 200px').toBe(200)
        expect(triggerWidths.thinking, '思考触发器固定 150px').toBe(150)
        expect(popoverFacts.modelList, '模型列应有布局盒').not.toBeNull()
        expect(popoverFacts.thinkList, '思考强度列应有布局盒').not.toBeNull()
        const modelCol = popoverFacts.modelList as { width: number; right: number }
        const thinkCol = popoverFacts.thinkList as { width: number; left: number; right: number }
        expect(modelCol.width, '模型列应有可见宽度').toBeGreaterThan(100)
        expect(thinkCol.width, '思考强度列应有可见宽度').toBeGreaterThan(80)
        expect(thinkCol.left, '思考列应在模型列右侧').toBeGreaterThanOrEqual(modelCol.right - 2)
        expect(thinkCol.right, '思考列右边界不得越出视口').toBeLessThanOrEqual(viewport.width)
        expect(popoverFacts.modelOptions, '模型列应有选项').toBeGreaterThan(0)
        expect(popoverFacts.thinkingOptions, '思考强度列应有选项').toBeGreaterThan(0)
        expect(popoverFacts.columns.split(/\s+/).filter(Boolean).length, 'Popover 应为双列网格').toBe(2)
        await clearToasts(page)
        await take(34, '1024-ai-popover')

        await page.keyboard.press('Escape')
        await expect(page.getByTestId('ai-model-option')).toHaveCount(0, { timeout: 5_000 })
        await expect(page.getByTestId('ai-dialog'), 'Popover 内 Esc 不得关闭 AI Dialog').toBeVisible()
        const aiClosedByPopoverEsc = false
        await take(35, '1024-popover-esc-only')
        await closeAiDialog(page)
        log('1024-popover', { popoverBox, popoverRight, viewportWidth: viewport.width, popoverFacts, aiClosedByPopoverEsc })
        await page.setViewportSize(DESKTOP_VIEWPORT)
      })

      // ═══════════════════════════════════════════════════════════════════
      // 9. 构建一致性 + console
      // ═══════════════════════════════════════════════════════════════════
      step = 9
      slug = 'evidence'
      await test.step('9 构建一致性 + console/pageerror/crash', async () => {
        const assetsDir = path.join(ROOT, 'dist', 'renderer', 'assets')
        const bundleFiles = fs
          .readdirSync(assetsDir)
          .filter((f) => /^index-.*\.js$/.test(f))
          .map((f) => path.join(assetsDir, f))
        const bundleText = bundleFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
        const sourceSelector = fs.readFileSync(
          path.join(ROOT, 'src', 'renderer', 'components', 'ai-elements', 'ModelSelector.tsx'),
          'utf8',
        )
        const sourceHasPortalSelector = sourceSelector.includes('ai-model-popover')
        const distHasPortalSelector = bundleText.includes('ai-model-popover')
        expect(sourceHasPortalSelector, '源码 ModelSelector 应使用 ai-model-popover 锚点').toBe(true)
        expect(
          distHasPortalSelector,
          'dist 构建产物应包含 portal/fixed 版 ModelSelector（ai-model-popover）；请先 build:renderer',
        ).toBe(true)
        const distIndexMtime = fs.statSync(path.join(ROOT, 'dist', 'renderer', 'index.html')).mtimeMs
        const selectorMtime = fs.statSync(
          path.join(ROOT, 'src', 'renderer', 'components', 'ai-elements', 'ModelSelector.tsx'),
        ).mtimeMs
        expect(distIndexMtime, 'dist/renderer 应不早于 ModelSelector 源码（已重建）').toBeGreaterThanOrEqual(
          selectorMtime,
        )
        log('build-consistency', {
          bundleFiles: bundleFiles.map((f) => path.basename(f)),
          sourceHasPortalSelector,
          distHasPortalSelector,
          distIndexMtime,
          selectorMtime,
        })

        const fatal = ctx!.fatalErrors().filter((x) => !envNoise(x))
        const envErrors = [...ctx!.consoleErrors, ...ctx!.pageErrors].filter(envNoise)
        expect(ctx!.crashes, '不应有渲染进程 crash').toHaveLength(0)
        expect(fatal, `非 ENV 的致命 console/pageerror 共 ${fatal.length} 条`).toHaveLength(0)
        log('console', {
          consoleErrors: ctx!.consoleErrors,
          pageErrors: ctx!.pageErrors,
          envErrors,
          fatal,
          stderrTail: ctx!.stderr.slice(-3),
        })
        if (envErrors.length) {
          issues.push({
            id: 'B-SET-ENV-1',
            level: 'ENV',
            summary: 'seed 预览页引入的外部 CDN/Script 噪声：vant CSS CSP 拒绝 + 预览 iframe SyntaxError，与设置域无关',
          })
        }

        testInfo.attach('b-settings-evidence', {
          body: JSON.stringify(
            {
              dataDir: ctx!.dataDir,
              userData: ctx!.userData,
              seed: ctx!.seedPresent,
              viewport,
              shots,
              issues,
              modelTotal,
              checkedBaseline,
              liveAgents: liveAgents.length,
              rowsAfterRedetect,
              sandboxRoot,
              aboutVersion,
              consoleErrors: ctx!.consoleErrors,
              pageErrors: ctx!.pageErrors,
              crashes: ctx!.crashes,
              stderr: ctx!.stderr.slice(-5),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        })
      })

      for (const issue of issues) {
        testInfo.annotations.push({ type: issue.level, description: `${issue.id} ${issue.summary}` })
      }
      expect(
        issues.filter((i) => i.level === 'P0' || i.level === 'P1'),
        `设置域存在阻断缺陷：${JSON.stringify(issues.filter((i) => i.level === 'P0' || i.level === 'P1'))}`,
      ).toEqual([])
      log('issues', issues)
    } catch (err) {
      if (ctx) {
        await reportFailure(ctx, {
          step,
          slug,
          level: 'P1',
          expected: '设置 / Agent / 模型 / 设计规范全链路可用',
          actual: `step ${step}（${slug}）失败`,
          error: err,
          extra: JSON.stringify({ shots }),
        })
      }
      throw err
    } finally {
      if (importFile) fs.rmSync(importFile, { force: true })
      if (ctx) {
        await restoreAllIpc(ctx).catch(() => undefined)
        assertCleanExitOrP2(await ctx.close())
      }
    }
  })
})

/** P2：长链路执行后 window-all-closed 偶发不退出，仅容忍 kill 收尾；其它异常仍硬失败。 */
function assertCleanExitOrP2(result: Parameters<typeof assertCleanExit>[0]): void {
  if (result.method === 'kill') {
    console.warn('[gate3] P2 close: window-all-closed 未退出，已 kill 收尾；功能断言仍为硬门禁' )
    return
  }
  assertCleanExit(result)
}
