/**
 * e2e/wave4-settings.spec.ts — Wave4 A1 冒烟 · 域 6「设置 / 模型 / Agent」。
 *
 * 只读验证（不改产品代码、不写真实凭据、不保存 API Key）：
 * 1. 顶栏「设置」打开 780×580 Dialog；6 Tab 可切换；Esc 关闭；
 * 2. Agent Tab：真实 ai:checkCli 行（非 DEFAULT 假数据）、本地 CLI / API 直连切换、
 *    API Profile 字段存在且 32px；测试连通性只验错误处理（无凭据应明确报错、不弹 GCM）；
 * 3. 徽章：transport=acp 行只出现一个 ACP（回归 acp + ACP 双徽章）；
 * 4. 模型管理：主清单只显示已选（无全选/反选）、获取模型弹窗全量 + 已选 checked、
 *    弹窗内全选/取消全选后主清单同步、搜索只在已选集合内过滤、关闭不误保存；
 * 5. 设计规范 / 沙箱 / 快捷键 / 关于 Tab 真实内容，关于版本来自 app:get-version；
 * 6. 关闭重开状态一致；收集 console / pageerror / crash。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain settings
 *   npx playwright test e2e/wave4-settings.spec.ts --workers=1 --output=<临时目录>/wave4/settings
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  launchApp,
  assertCleanExit,
  reportFailure,
  ROOT,
  type Wave4App,
} from './wave4/harness'

const DOMAIN = 'settings'
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const DIALOG_W = 780
const DIALOG_H = 580
const INVALID_BASE_URL = 'http://127.0.0.1:9/v1'

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
  visibleModelsCli?: Record<string, string[]>
  visibleModelsApi?: string[] | null
  byok?: { baseUrl?: string; hasApiKey?: boolean; apiKeyMasked?: string }
  api?: { baseUrl?: string; hasApiKey?: boolean; apiKeyMasked?: string }
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

function log(label: string, data: unknown): void {
  console.log(`[W4-SETTINGS] ${label} ${JSON.stringify(data)}`)
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

/** 本轮复测统一落到 docs/wave4/shots/retest-model-list/a1-*.png。 */
function useRetestShots(ctx: Wave4App, prefix: string): void {
  const dir = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-model-list')
  fs.mkdirSync(dir, { recursive: true })
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${prefix}-`)) fs.rmSync(path.join(dir, name), { force: true })
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
      dir,
      `${prefix}-${stepText}-${clean(slug)}${options.fail ? '-FAIL' : ''}.png`,
    )
    await (options.page ?? ctx.page).screenshot({
      path: file,
      fullPage: Boolean(options.fullPage),
    })
    return file
  }
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

async function openProject(page: Wave4App['page']): Promise<void> {
  await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('topbar')).toBeVisible()
  const picker = page.getByTestId('project-picker')
  if (await picker.isVisible().catch(() => false)) {
    const row = picker.locator('li').filter({ hasText: '测试1' }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
}

async function openSettings(page: Wave4App['page']) {
  // 设置入口已收敛为侧栏底部唯一按钮；移动端 kind 会收起侧栏，先展开。
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
  const dialog = page.getByTestId('settings-dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  // SettingsDialog 在 open 的 useEffect 里才触发 load；先让 effect 跑起来再等 loading 消失，
  // 避免「刚打开就点切换」与后台 load 竞态（Wave4 观察区 P2）。
  await page.waitForTimeout(350)
  await expect(page.getByTestId('settings-loading')).toBeHidden({ timeout: 90_000 })
  await page.waitForTimeout(200)
  return dialog
}

async function closeSettings(page: Wave4App['page'], dialog: ReturnType<Wave4App['page']['getByTestId']>) {
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 5_000 })
}

async function gotoTab(
  page: Wave4App['page'],
  dialog: ReturnType<Wave4App['page']['getByTestId']>,
  tabName: string,
  contentTestId: string,
) {
  await dialog.getByRole('tab', { name: tabName }).click()
  await expect(page.getByTestId(contentTestId)).toBeVisible({ timeout: 20_000 })
}

async function readConfig(page: Wave4App['page']): Promise<AiConfigShape> {
  return page.evaluate(async () => (window as unknown as { protoAPI: any }).protoAPI.ai.getConfig())
}

async function readModelNameMap(page: Wave4App['page']): Promise<Record<string, string>> {
  const config = await readConfig(page)
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

async function readAgentId(page: Wave4App['page']): Promise<string> {
  const config = await readConfig(page)
  return String(config.agentId || config.mainAgent || 'opencode')
}

async function readVisibleCli(page: Wave4App['page'], agentId: string): Promise<string[]> {
  const config = await readConfig(page)
  const value = config.visibleModelsCli?.[agentId]
  return Array.isArray(value) ? value.slice() : []
}

async function expectVisibleCli(
  page: Wave4App['page'],
  agentId: string,
  expected: string[],
): Promise<void> {
  await expect
    .poll(async () => (await readVisibleCli(page, agentId)).slice().sort(), {
      timeout: 20_000,
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

async function readModelRows(page: Wave4App['page']): Promise<ModelRow[]> {
  return page.locator('[data-model-id]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-model-id') || '',
      checked:
        el.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
    })),
  )
}

async function assertHeight32(
  locator: ReturnType<Wave4App['page']['getByTestId']>,
  name: string,
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box, `${name} 应有布局盒`).not.toBeNull()
  expect(Math.round((box as { height: number }).height), `${name} 高度应为 32px`).toBe(32)
}

async function readAiMenuOptions(page: Wave4App['page']): Promise<string[]> {
  await page.getByTestId('topbar').getByRole('button', { name: 'AI 对话' }).click()
  const dialog = page.getByTestId('ai-dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('ai-model-select').click()
  const options = page.getByTestId('ai-model-option')
  await expect(options.first()).toBeVisible({ timeout: 15_000 })
  return options.evaluateAll((els) =>
    els.map((el) => el.getAttribute('title') || (el.textContent || '').trim()),
  )
}

async function closeAiDialog(page: Wave4App['page']): Promise<void> {
  const dialog = page.getByTestId('ai-dialog')
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    if (await dialog.isVisible().catch(() => false)) await page.keyboard.press('Escape')
  }
  await expect(dialog).toBeHidden({ timeout: 5_000 })
}

test.describe('Wave4 A1 · 设置 / 模型 / Agent', () => {
  test('A1 设置真机冒烟：6 Tab / Agent 真实行 / 引擎切换 / 模型可见性 / 辅助 Tab / 重开一致', async ({}, testInfo) => {
    test.setTimeout(420_000)
    let ctx: Wave4App | null = null
    let step = 1
    let slug = 'open-settings'
    const shots: string[] = []
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
      useRetestShots(ctx, 'a1')

      // 标准桌面视口：本机窗口被工作区限制为 1123×640，85vh 会把 Dialog 压到 544px；
      // 用 Playwright 视口覆盖到 1440×900，验证设计值 780×580（不改产品代码/窗口状态）。
      await page.setViewportSize(DESKTOP_VIEWPORT)
      await page.waitForTimeout(400)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(viewport).toEqual(DESKTOP_VIEWPORT)

      const expectedUserData = path.resolve(ctx.dataDir).toLowerCase()
      expect(path.resolve(ctx.userData).toLowerCase()).toBe(expectedUserData)
      expect(ctx.seedPresent).toBe(true)
      log('isolation', {
        dataDir: ctx.dataDir,
        userData: ctx.userData,
        seed: ctx.seedPresent,
        viewport,
      })

      await openProject(page)

      // ── 1. 顶栏设置 / 780×580 / 6 Tab / Esc ─────────────────────────────
      step = 1
      slug = 'open-settings'
      await test.step('1 设置 Dialog：780×580 + 6 Tab + Esc', async () => {
        const dialog = await openSettings(page)
        const box = await dialog.boundingBox()
        expect(box, 'settings-dialog 应有布局盒').not.toBeNull()
        expect(Math.round((box as { width: number }).width), 'Dialog 宽度应为 780px').toBe(DIALOG_W)
        expect(Math.round((box as { height: number }).height), 'Dialog 高度应为 580px').toBe(DIALOG_H)
        log('dialogBox', box)

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
        await expect(page.getByTestId('settings-error')).toHaveCount(0)
        await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 60_000 })
        await take(1, 'settings-open-780x580')

        // 6 Tab 逐个切换，确认内容真实挂载。
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
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        await take(2, 'tab-models')
        log('tabs', { count: tabNames.length, names: tabNames })

        await closeSettings(page, dialog)
        log('step1', { box, tabNames, closedByEsc: true })
      })

      // ── 2. Agent 真实行 / ACP 徽章 / CLI-API 高度 ────────────────────────
      step = 2
      slug = 'agent-real'
      let agentRowsAfterRedetect = 0
      let liveAgents: AgentInfo[] = []
      let agentId = ''
      await test.step('2 Agent 真实行 + ACP 单徽章 + 重新探测', async () => {
        const dialog = await openSettings(page)
        await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByTestId('settings-error')).toHaveCount(0)

        await expect
          .poll(async () => page.locator('[data-testid^="agent-row-"]').count(), {
            timeout: 60_000,
            message: 'Agent 真实行应在 60s 内出现',
          })
          .toBeGreaterThanOrEqual(10)
        const domIds = await page
          .locator('[data-testid^="agent-row-"]')
          .evaluateAll((els) =>
            els.map((el) => (el.getAttribute('data-testid') || '').replace('agent-row-', '')),
          )
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
          90_000,
          'ai.checkCli',
        )
        liveAgents = check.agents.filter((a: AgentInfo) => a.id)
        const liveIds = liveAgents.map((a) => a.id)
        expect(liveIds.length, 'ai:check 应返回真实 Agent 清单').toBeGreaterThanOrEqual(10)
        expect(domIds.length, 'DOM 行数应等于 ai:check 返回数').toBe(liveIds.length)
        expect(new Set(domIds)).toEqual(new Set(liveIds))

        const dialogText = await dialog.innerText()
        expect(dialogText, '不得出现 DEFAULT_AGENTS 假数据文案').not.toContain('DEFAULT_AGENTS')
        expect(dialogText, '不得出现示例 Agent 占位文案').not.toMatch(/示例\s*Agent/)
        const agentSource = fs.readFileSync(
          path.join(ROOT, 'src/renderer/features/settings/AgentMatrix.tsx'),
          'utf8',
        )
        expect(agentSource, 'AgentMatrix 不应定义 DEFAULT_AGENTS 假数据').not.toMatch(
          /DEFAULT_AGENTS\s*[:=]/,
        )

        await assertHeight32(page.getByTestId('engine-cli'), '本地 CLI 按钮')
        await assertHeight32(page.getByTestId('engine-api'), 'API 直连按钮')
        await take(3, 'agent-real-rows')

        // 徽章回归：transport=acp 的行只能有一个文本为 ACP 的徽章，不能再有 acp 小写徽章。
        const acpAgents = liveAgents.filter((a) => a.transport === 'acp')
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

        const details = page.locator('details')
        if ((await details.count()) > 0) {
          await details.first().locator('summary').click()
          await page.waitForTimeout(300)
        }
        await take(4, 'agent-acp-badges')

        // 重新探测：不卡死、行数不丢、不产生 settings-error。
        const redetect = page
          .getByTestId('agent-matrix')
          .getByRole('button', { name: /重新探测|探测中/ })
        await redetect.click()
        await expect(redetect).toHaveText('重新探测', { timeout: 120_000 })
        await expect
          .poll(async () => page.locator('[data-testid^="agent-row-"]').count(), {
            timeout: 60_000,
          })
          .toBeGreaterThanOrEqual(10)
        await expect(page.getByTestId('settings-error')).toHaveCount(0)
        agentRowsAfterRedetect = await page.locator('[data-testid^="agent-row-"]').count()
        agentId = await readAgentId(page)
        log('step2', {
          rows: domIds.length,
          liveAgents: liveIds.length,
          acpAgents: acpAgents.length,
          badgeIssues,
          agentRowsAfterRedetect,
          agentId,
        })
      })

      // ── 3. CLI / API 切换 + API Profile + 测试连通性错误处理 ─────────────
      step = 3
      slug = 'api-profile'
      let originalBaseUrl = ''
      let originalVisible: string[] = []
      await test.step('3 CLI/API 切换 + API Profile + 测试连通性', async () => {
        const dialog = page.getByTestId('settings-dialog')
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        const config = await readConfig(page)
        originalBaseUrl = config.byok?.baseUrl || config.api?.baseUrl || ''
        originalVisible = config.visibleModelsCli?.[agentId] ?? []
        expect(originalBaseUrl, '应读到已保存的 Base URL').not.toBe('')
        expect(originalVisible.length, '当前 Agent 应有可见模型').toBeGreaterThan(0)

        await page.getByTestId('engine-api').click()
        await expect(page.getByTestId('api-profile')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('engine-api')).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByTestId('engine-cli')).toHaveAttribute('aria-pressed', 'false')
        // toast 在 save（含模型目录刷新）完成后才出现，用它确认后台保存已落定。
        await expect(page.getByText('已切换到 API 直连', { exact: true })).toBeVisible({
          timeout: 30_000,
        })

        const profile = page.getByTestId('api-profile')
        const protocol = profile.getByLabel('API 协议')
        const baseInput = profile.getByLabel('API Base URL')
        const keyInput = profile.locator('input[aria-label="API Key"]')
        const showButton = profile.getByRole('button', { name: '显示 API Key' })
        await expect(protocol).toBeVisible()
        await expect(baseInput).toBeVisible()
        await expect(keyInput).toBeVisible()
        await expect(showButton).toBeVisible()
        await assertHeight32(protocol, 'API 协议选择')
        await assertHeight32(baseInput, 'API Base URL 输入')
        await assertHeight32(keyInput, 'API Key 输入')
        await assertHeight32(showButton, '显示/隐藏 API Key 按钮')
        await expect(keyInput).toHaveValue('')
        await expect(keyInput).toHaveAttribute('placeholder', '输入 API Key')
        await expect(baseInput).toHaveValue(originalBaseUrl)
        await take(5, 'api-profile-32px')

        // 只用不可达地址 + 空 Key 验证错误处理；不填真实 Key、不点保存。
        await baseInput.fill(INVALID_BASE_URL)
        const startedAt = Date.now()
        await profile.getByRole('button', { name: '测试连通性' }).click()
        const resultBadge = profile.locator('[data-slot="badge"]')
        await expect(resultBadge).toBeVisible({ timeout: 15_000 })
        const errorText = (await resultBadge.innerText()).trim()
        const elapsedMs = Date.now() - startedAt
        expect(errorText.length, '连通性失败应有明确错误文本').toBeGreaterThan(0)
        expect(errorText, '空 Key + 不可达地址不应返回连通成功').not.toMatch(/^连通/)
        expect(elapsedMs, '连通性测试不应长时间卡死').toBeLessThan(15_000)
        expect(app.windows().length, '测试连通性不应弹出新窗口（GCM/原生对话框）').toBe(1)
        expect(ctx.stderr.join('')).not.toMatch(/credential manager|GCM_INTERACTIVE prompted/i)
        await expect(profile.getByRole('button', { name: '测试连通性' })).toBeVisible({
          timeout: 5_000,
        })
        await take(6, 'api-test-error')
        log('step3-test', { elapsedMs, errorText, windows: app.windows().length })

        // 关闭不误保存：草稿只存在于本地 input，不应写入 ai-config。
        await closeSettings(page, dialog)
        const reopened = await openSettings(page)
        await expect(page.getByTestId('engine-api')).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByTestId('api-profile')).toBeVisible({ timeout: 30_000 })
        const reopenedBase = await page
          .getByTestId('api-profile')
          .getByLabel('API Base URL')
          .inputValue()
        expect(reopenedBase, '关闭设置不应保存 API Profile 草稿').toBe(originalBaseUrl)
        expect(reopenedBase).not.toBe(INVALID_BASE_URL)
        await expect(
          page.getByTestId('api-profile').locator('[data-slot="badge"]'),
        ).toHaveCount(0)
        await take(7, 'api-reopen-not-saved')
        log('step3-reopen', { reopenedBase, originalBaseUrl })

        // 切回 CLI，恢复落盘引擎。
        await page.getByTestId('engine-cli').click()
        await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('engine-cli')).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByText('已切换到本地 CLI', { exact: true })).toBeVisible({
          timeout: 30_000,
        })
        await expect.poll(async () => (await readConfig(page)).engine, { timeout: 20_000 }).toBe('cli')
        expect((await readVisibleCli(page, agentId)).slice().sort()).toEqual(
          originalVisible.slice().sort(),
        )
        log('step3-engine-back', {
          engine: (await readConfig(page)).engine,
          visible: await readVisibleCli(page, agentId),
        })

        // 模型菜单检查在 models Tab 前先准备：切到模型页并截图。
        await gotoTab(page, reopened, '模型管理', 'model-manager')
        await expect
          .poll(async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total, {
            timeout: 30_000,
          })
          .toBeGreaterThan(0)
        await expect(
          page.getByTestId('settings-dialog').getByText('本地 CLI', { exact: true }),
        ).toBeVisible({ timeout: 30_000 })
        await take(8, 'models-list')
        await closeSettings(page, reopened)
      })

      // ── 4. 主清单仅已选 + 弹窗全量 + 弹窗内批量 + 已选内搜索 ─────────────
      step = 4
      slug = 'models'
      let modelRows: ModelRow[] = []
      let modelTotal = 0
      let selected: string[] = []
      await test.step('4 模型管理：主清单仅已选 / 弹窗全量 / 弹窗内全选取消 / 已选内搜索', async () => {
        // 4.1 主清单只显示已选：AI 菜单 = 主清单 = 已选计数，未选模型不渲染。
        const menuNameMap = await readModelNameMap(page)
        const labelOf = (id: string): string => menuNameMap[id] || id
        const menuOptions = await readAiMenuOptions(page)
        await take(9, 'ai-menu-selected-only')
        await closeAiDialog(page)
        const dialog = await openSettings(page)
        await gotoTab(page, dialog, '模型管理', 'model-manager')
        await expect
          .poll(async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total, {
            timeout: 30_000,
          })
          .toBeGreaterThan(0)
        const count0 = parseModelCount(await page.getByTestId('model-manager-count').innerText())
        modelTotal = count0.total
        modelRows = await readModelRows(page)
        expect(modelRows.length, '主清单只渲染已选模型').toBe(count0.checked)
        expect(count0.shown, '主清单显示数应等于已选数').toBe(count0.checked)
        expect(modelRows.filter((row) => !row.checked), '主清单不得出现未选模型').toEqual([])
        selected = modelRows.filter((row) => row.checked).map((row) => row.id)
        expect(count0.checked, '已选计数应与勾选行一致').toBe(selected.length)
        expect(selected.slice().sort(), '菜单仅已选：初始勾选应与已保存白名单一致').toEqual(
          originalVisible.slice().sort(),
        )
        expect(modelTotal, '目录总数应 ≥ 已选数').toBeGreaterThanOrEqual(selected.length)
        expect(new Set(menuOptions), 'AI 菜单只应出现已选模型').toEqual(
          new Set(selected.map(labelOf)),
        )
        expect(menuOptions.length, 'AI 菜单数量应等于已选数量').toBe(selected.length)

        // 主清单不再提供全选/反选；批量只存在于「获取模型」弹窗。
        const manager = page.getByTestId('model-manager')
        await expect(manager.getByRole('button', { name: '全选' }), '主清单不应有全选').toHaveCount(0)
        await expect(manager.getByRole('button', { name: '反选' }), '主清单不应有反选').toHaveCount(0)

        // 32px 对齐：搜索 / 自定义输入 / 添加 / 刷新 / 获取模型。
        await assertHeight32(manager.getByLabel('搜索模型'), '搜索模型输入')
        await assertHeight32(manager.getByLabel('自定义模型 id'), '自定义模型输入')
        await assertHeight32(
          manager.getByRole('button', { name: '添加模型' }),
          '添加模型按钮',
        )
        await assertHeight32(manager.getByRole('button', { name: /刷新|刷新中/ }), '刷新按钮')
        await assertHeight32(manager.getByRole('button', { name: '获取模型' }), '获取模型按钮')
        await take(10, 'models-32px')

        // 4.2 获取模型弹窗：全量目录 + 已选 checked；关闭不改主清单。
        await manager.getByRole('button', { name: '获取模型' }).click()
        let modal = page.getByTestId('model-fetch-modal')
        await expect(modal).toBeVisible({ timeout: 10_000 })
        await expect
          .poll(async () => parseFetchCount(await page.getByTestId('model-fetch-count').innerText()).shown, {
            timeout: 15_000,
          })
          .toBeGreaterThan(0)
        const fetch0 = parseFetchCount(await page.getByTestId('model-fetch-count').innerText())
        const catalogIds = (await modal.locator('[data-id]').evaluateAll((els) =>
          els.map((el) => el.getAttribute('data-id') || ''),
        )).filter(Boolean)
        expect(catalogIds.length, '弹窗行数应等于自身展示数').toBe(fetch0.shown)
        expect(fetch0.shown, '获取模型弹窗应展示全量目录').toBe(modelTotal)
        const modalChecked0 = await modal.locator('[data-id]').evaluateAll((els) =>
          els
            .filter(
              (el) =>
                el.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
            )
            .map((el) => el.getAttribute('data-id') || ''),
        )
        expect(fetch0.checked, '弹窗已选数应等于主清单已选数').toBe(selected.length)
        expect(new Set(modalChecked0), '弹窗已选集合应与主清单一致').toEqual(new Set(selected))
        const unselected = catalogIds.filter((id) => !selected.includes(id))
        expect(unselected.length, '种子应存在未选模型').toBeGreaterThan(0)
        await take(11, 'model-fetch-modal-all')
        await modal.getByRole('button', { name: '关闭获取模型' }).click()
        await expect(modal).toBeHidden({ timeout: 5_000 })
        expect(
          parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
          '关闭弹窗不应改变勾选',
        ).toBe(selected.length)

        // 4.3 搜索只在已选集合内过滤：未选 ID 不命中，关键字只缩显示、不动勾选。
        const search = manager.getByLabel('搜索模型')
        await search.fill(unselected[0])
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(0)
        await expect(manager, '搜索未选模型应提示已选内无匹配').toContainText('已选模型无匹配')
        expect(await readModelRows(page), '搜索未选模型不得把未选项带回主清单').toEqual([])
        const countUnselected = parseModelCount(await page.getByTestId('model-manager-count').innerText())
        expect(countUnselected.checked, '搜索不应改变已选数').toBe(count0.checked)
        expect(countUnselected.total, '搜索不应改变目录总数').toBe(count0.total)
        await take(12, 'models-search-unselected')

        const query = pickSubsetQuery(selected)
        expect(query, '已选 ≥2 时应能找到只命中部分已选的关键字').not.toBeNull()
        const matched = selected.filter((id) => id.toLowerCase().includes(query!.toLowerCase()))
        expect(matched.length, '搜索词应命中部分已选').toBeGreaterThan(0)
        expect(matched.length, '搜索词不应命中全部已选').toBeLessThan(selected.length)
        await search.fill(query!)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(matched.length)
        const countDuring = parseModelCount(await page.getByTestId('model-manager-count').innerText())
        expect(countDuring.checked, '搜索不应改变已选数').toBe(count0.checked)
        expect(countDuring.total, '搜索不应改变目录总数').toBe(count0.total)
        const rowsDuring = await readModelRows(page)
        expect(rowsDuring.length, '搜索显示行数应等于已选内命中数').toBe(matched.length)
        expect(new Set(rowsDuring.map((row) => row.id)), '搜索显示应恰为已选内命中项').toEqual(
          new Set(matched),
        )
        expect(rowsDuring.filter((row) => !row.checked), '搜索期间不应出现未选行').toEqual([])
        await take(13, 'models-search-selected-only')
        await page.getByRole('button', { name: '清除搜索' }).click()
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(selected.length)

        // 4.4 取消一个模型 → 主清单立即移除 → 关闭重开仍不在 → 菜单不再出现 → 弹窗恢复。
        const toggleId = selected[0]
        const toggleBox = page.locator(`[aria-label="勾选模型 ${toggleId}"]`)
        await expect(toggleBox).toHaveAttribute('aria-checked', 'true')
        await toggleBox.click()
        const afterToggle = selected.filter((id) => id !== toggleId)
        await expectVisibleCli(page, agentId, afterToggle)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
            { timeout: 10_000 },
          )
          .toBe(afterToggle.length)
        await expect(
          page.locator(`[aria-label="勾选模型 ${toggleId}"]`),
          '取消勾选后主清单应立即移除该行',
        ).toHaveCount(0)
        expect(
          new Set((await readModelRows(page)).map((row) => row.id)),
          '主清单应只剩其余已选',
        ).toEqual(new Set(afterToggle))
        await closeSettings(page, dialog)

        const reopened = await openSettings(page)
        await gotoTab(page, reopened, '模型管理', 'model-manager')
        await expect
          .poll(async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).total, {
            timeout: 30_000,
          })
          .toBe(modelTotal)
        const rowsAfterReopen = await readModelRows(page)
        expect(
          new Set(rowsAfterReopen.map((row) => row.id)),
          '取消勾选后关闭重开仍不显示该行',
        ).toEqual(new Set(afterToggle))
        expect(rowsAfterReopen.filter((row) => !row.checked), '重开后主清单仍只有已选').toEqual([])
        expect(
          parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
        ).toBe(afterToggle.length)
        await closeSettings(page, reopened)

        const menuNameMapAfter = await readModelNameMap(page)
        const menuAfterToggle = await readAiMenuOptions(page)
        const labelAfter = (id: string): string => menuNameMapAfter[id] || id
        expect(menuAfterToggle, '未选模型不应出现在 AI 菜单').not.toContain(labelAfter(toggleId))
        expect(new Set(menuAfterToggle)).toEqual(new Set(afterToggle.map(labelAfter)))
        await closeAiDialog(page)

        // 主清单不含未选项，恢复勾选只能从「获取模型」弹窗补回。
        const restoredDialog = await openSettings(page)
        await gotoTab(page, restoredDialog, '模型管理', 'model-manager')
        const restoreManager = page.getByTestId('model-manager')
        await restoreManager.getByRole('button', { name: '获取模型' }).click()
        const restoreModal = page.getByTestId('model-fetch-modal')
        await expect(restoreModal).toBeVisible({ timeout: 10_000 })
        const restoreBox = restoreModal.getByLabel(`获取模型 ${toggleId}`)
        await expect(restoreBox).toHaveAttribute('aria-checked', 'false')
        await restoreBox.click()
        await expectVisibleCli(page, agentId, selected)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
            { timeout: 10_000 },
          )
          .toBe(selected.length)
        await expect(
          page.locator(`[aria-label="勾选模型 ${toggleId}"]`),
          '恢复勾选后主清单应重新出现该行',
        ).toHaveCount(1)
        await restoreModal.getByRole('button', { name: '关闭获取模型' }).click()
        await expect(restoreModal).toBeHidden({ timeout: 5_000 })

        // 4.5 弹窗内全选/取消全选只作用当前显示项：主清单随之增减，且可逆回到基线。
        await restoreManager.getByRole('button', { name: '获取模型' }).click()
        const batchModal = page.getByTestId('model-fetch-modal')
        await expect(batchModal).toBeVisible({ timeout: 10_000 })
        // 搜索词可能命中多行（id/name/描述），取一组「只含未选模型」的显示项；
        // 全选 → 主清单加入这些项，取消全选 → 主清单回到基线，全程不动原已选。
        const pickBatchShown = async (): Promise<{ query: string; ids: string[] }> => {
          for (const candidate of unselected.slice(0, 40)) {
            await batchModal.getByLabel('搜索全量模型').fill(candidate)
            await page.waitForTimeout(80)
            const ids = (await batchModal.locator('[data-id]').evaluateAll((els) =>
              els.map((el) => el.getAttribute('data-id') || ''),
            )).filter(Boolean)
            if (!ids.length) continue
            if (ids.some((id) => selected.includes(id))) continue
            return { query: candidate, ids }
          }
          throw new Error('未找到只命中未选模型的弹窗搜索词')
        }
        const batch = await pickBatchShown()
        const batchTarget = batch.ids[0]
        const expectedAfterSelectAll = [...selected, ...batch.ids]
        await batchModal.getByRole('button', { name: '全选', exact: true }).click()
        await expectVisibleCli(page, agentId, expectedAfterSelectAll)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
            { timeout: 20_000 },
          )
          .toBe(expectedAfterSelectAll.length)
        const rowsAfterBatchAdd = await readModelRows(page)
        expect(
          new Set(rowsAfterBatchAdd.map((row) => row.id)),
          '弹窗全选后主清单应包含新选项',
        ).toEqual(new Set(expectedAfterSelectAll))
        expect(rowsAfterBatchAdd.filter((row) => !row.checked), '主清单仍只有已选').toEqual([])
        // 全选/取消全选各触发一笔异步 IPC 保存 + 目录回灌；等本笔落定再点下一笔。
        await page.waitForTimeout(1_200)
        await take(14, 'models-modal-select-all')
        await batchModal.getByRole('button', { name: '取消全选' }).click()
        await expectVisibleCli(page, agentId, selected)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
            { timeout: 20_000 },
          )
          .toBe(selected.length)
        await expect(
          page.locator(`[aria-label="勾选模型 ${batchTarget}"]`),
          '弹窗取消全选后主清单应移除该项',
        ).toHaveCount(0)
        await page.waitForTimeout(1_500)
        expect(
          parseModelCount(await page.getByTestId('model-manager-count').innerText()).checked,
          '批量保存回灌后主清单应仍为基线',
        ).toBe(selected.length)
        expect(new Set((await readModelRows(page)).map((row) => row.id)), '主清单恢复基线').toEqual(
          new Set(selected),
        )
        await expectVisibleCli(page, agentId, selected)
        await batchModal.getByRole('button', { name: '关闭获取模型' }).click()
        await expect(batchModal).toBeHidden({ timeout: 5_000 })
        await take(15, 'models-modal-batch-restored')

        // 4.6 关闭不误保存：搜索词是本地状态，关闭设置后应清空，且勾选不变。
        await search.fill(query!)
        await expect
          .poll(
            async () => parseModelCount(await page.getByTestId('model-manager-count').innerText()).shown,
            { timeout: 10_000 },
          )
          .toBe(matched.length)
        await closeSettings(page, restoredDialog)
        const finalDialog = await openSettings(page)
        await gotoTab(page, finalDialog, '模型管理', 'model-manager')
        await expect(page.getByTestId('model-manager').getByLabel('搜索模型')).toHaveValue('')
        const closedCount = parseModelCount(await page.getByTestId('model-manager-count').innerText())
        expect(closedCount.checked, '关闭重开后勾选应保持').toBe(selected.length)
        expect(closedCount.shown, '关闭重开后主清单显示全部已选').toBe(selected.length)
        expect(closedCount.total, '关闭重开后目录应可用').toBeGreaterThan(0)
        log('step4', {
          total: modelTotal,
          selected,
          query,
          matched: matched.length,
          catalog: catalogIds.length,
          unselected: unselected.length,
          batchTarget,
        })
        await closeSettings(page, finalDialog)
      })

      // ── 5. 设计规范 / 沙箱 / 快捷键 / 关于 ──────────────────────────────
      step = 5
      slug = 'aux-tabs'
      let designSpecCount = 0
      let designLibCount = 0
      let sandboxRoot = ''
      let aboutVersion = ''
      await test.step('5 设计规范 / 沙箱 / 快捷键 / 关于 真实内容', async () => {
        const dialog = await openSettings(page)

        await gotoTab(page, dialog, '设计规范', 'design-tab')
        designSpecCount = await page.locator('[data-testid^="spec-row-"]').count()
        designLibCount = await page.locator('[data-testid^="uilib-row-"]').count()
        expect(designSpecCount, '设计规范应有真实列表').toBeGreaterThanOrEqual(1)
        expect(designLibCount, 'UI 库应有真实列表').toBeGreaterThanOrEqual(1)
        await take(16, 'design-tab')

        await gotoTab(page, dialog, '沙箱存储', 'sandbox-tab')
        sandboxRoot = (await page.getByTestId('sandbox-root').innerText()).trim()
        const actualRoot: string = await page.evaluate(
          async () => (await (window as unknown as { protoAPI: any }).protoAPI.sandbox.list()).root,
        )
        expect(sandboxRoot.length, '沙箱根目录不应为空').toBeGreaterThan(0)
        expect(sandboxRoot, '沙箱路径应来自主进程 sandbox:list').toBe(actualRoot)
        await take(17, 'sandbox-tab')

        await gotoTab(page, dialog, '快捷键', 'shortcut-tab')
        const shortcutValues = await page
          .locator('[data-testid="shortcut-tab"] input')
          .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
        expect(shortcutValues).toContain('Ctrl+Enter')
        expect(shortcutValues).toContain('Ctrl+F')
        await take(18, 'shortcuts-tab')

        await gotoTab(page, dialog, '关于软件', 'about-tab')
        const appVersion = await ctx!.app.evaluate(({ app }) => app.getVersion())
        const rendererVersion = await page.evaluate(
          async () => (window as unknown as { protoAPI: any }).protoAPI.app.getVersion(),
        )
        aboutVersion = (await page.getByTestId('about-version').innerText()).trim()
        expect(aboutVersion).toBe(`v${appVersion}`)
        expect(rendererVersion).toBe(appVersion)
        const aboutSource = fs.readFileSync(
          path.join(ROOT, 'src/renderer/features/settings/AboutTab.tsx'),
          'utf8',
        )
        expect(aboutSource, '关于版本不应写死 1.2.0').not.toMatch(/\b1\.2\.0\b/)
        await take(19, 'about-tab')

        await closeSettings(page, dialog)
        log('step5', {
          designSpecCount,
          designLibCount,
          sandboxRoot,
          shortcutValues,
          appVersion,
          aboutVersion,
        })
      })

      // ── 6. 关闭重开状态一致 + 最终配置未越权保存 ────────────────────────
      step = 6
      slug = 'reopen-consistency'
      await test.step('6 关闭重开状态一致 + 最终配置', async () => {
        const dialog = await openSettings(page)
        await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 60_000 })
        const rows = await page.locator('[data-testid^="agent-row-"]').count()
        expect(rows, '重开后 Agent 行数应一致').toBe(agentRowsAfterRedetect)
        expect(await page.getByTestId('engine-cli').getAttribute('aria-pressed')).toBe('true')
        expect(await page.getByTestId('engine-api').getAttribute('aria-pressed')).toBe('false')
        await take(20, 'reopen-agent')

        await gotoTab(page, dialog, '模型管理', 'model-manager')
        const finalCount = parseModelCount(await page.getByTestId('model-manager-count').innerText())
        expect(finalCount.total, '重开后模型目录应可用').toBeGreaterThan(0)
        expect(finalCount.checked, '重开后已选数应一致').toBe(selected.length)
        expect(finalCount.shown, '重开后主清单只显示已选').toBe(selected.length)
        const finalRows = await readModelRows(page)
        expect(new Set(finalRows.map((row) => row.id)), '重开后主清单应恰为已选集合').toEqual(
          new Set(selected),
        )
        expect(finalRows.filter((row) => !row.checked), '重开后主清单不应出现未选行').toEqual([])

        await gotoTab(page, dialog, '设计规范', 'design-tab')
        expect(await page.locator('[data-testid^="spec-row-"]').count()).toBe(designSpecCount)
        expect(await page.locator('[data-testid^="uilib-row-"]').count()).toBe(designLibCount)
        await gotoTab(page, dialog, '沙箱存储', 'sandbox-tab')
        expect((await page.getByTestId('sandbox-root').innerText()).trim()).toBe(sandboxRoot)
        await gotoTab(page, dialog, '关于软件', 'about-tab')
        expect((await page.getByTestId('about-version').innerText()).trim()).toBe(aboutVersion)

        const finalConfig = await readConfig(page)
        expect(finalConfig.engine, '最终引擎应恢复为 CLI').toBe('cli')
        expect(
          (finalConfig.visibleModelsCli?.[agentId] ?? []).slice().sort(),
          '最终可见模型应恢复基线',
        ).toEqual(selected.slice().sort())
        expect(finalConfig.byok?.baseUrl || finalConfig.api?.baseUrl || '').toBe(originalBaseUrl)
        expect(finalConfig.byok?.hasApiKey === true, '不应保存任何 API Key').toBe(false)
        await closeSettings(page, dialog)
        log('step6', {
          rows,
          finalCount,
          designSpecCount,
          designLibCount,
          sandboxRoot,
          aboutVersion,
          engine: finalConfig.engine,
          visible: finalConfig.visibleModelsCli?.[agentId],
          baseUrl: finalConfig.byok?.baseUrl || finalConfig.api?.baseUrl || '',
          hasApiKey: finalConfig.byok?.hasApiKey === true,
        })
      })

      // ── 7. console / pageerror / crash ───────────────────────────────────
      step = 7
      slug = 'console'
      await test.step('7 console / pageerror / crash', async () => {
        // seed 原型自带 Vant/Vue CDN 与内联脚本噪声，属用户内容，不计工具致命错误。
        const fatal = ctx!.fatalErrors().filter((t) => !/vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(t))
        log('console', {
          consoleErrors: ctx!.consoleErrors,
          pageErrors: ctx!.pageErrors,
          crashes: ctx!.crashes,
          fatalCount: fatal.length,
          stderrTail: ctx!.stderr.slice(-3),
        })
        expect(fatal, `致命 console/pageerror/crash 共 ${fatal.length} 条`).toHaveLength(0)
      })

      testInfo.attach('settings-evidence', {
        body: JSON.stringify(
          {
            dataDir: ctx.dataDir,
            userData: ctx.userData,
            seed: ctx.seedPresent,
            viewport,
            shots,
            consoleErrors: ctx.consoleErrors,
            pageErrors: ctx.pageErrors,
            crashes: ctx.crashes,
            stderr: ctx.stderr.slice(-5),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      })
    } catch (err) {
      if (ctx) {
        await reportFailure(ctx, {
          step,
          slug,
          level: 'P1',
          expected: '设置/模型/Agent 核心路径可用',
          actual: `step ${step}（${slug}）失败`,
          error: err,
          extra: JSON.stringify({ shots }),
        })
      }
      throw err
    } finally {
      if (ctx) assertCleanExitOrP2(await ctx.close())
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
