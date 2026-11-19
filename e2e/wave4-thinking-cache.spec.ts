/**
 * e2e/wave4-thinking-cache.spec.ts — 思考强度本地缓存 / 后台探测 / 启动预热（真机）
 *
 * 覆盖（对应 docs/ai-thinking-cache.md）：
 *  1. 设置 → 模型：选择一个未缓存模型并保存，保存落盘 < 3s（不等 ACP 5–30s）；
 *     后台探测随后完成，userData/ai-thinking-cache.json 出现 `<agentId>|<model>` 条目且 configOptions 非空。
 *  2. 同一 key 再次 probe 命中缓存：毫秒级、cached:true、不重新拉起 ACP；
 *     换模型 / 换 Agent 生成不同 key；unsupported 结果也落缓存且二次命中秒回。
 *  3. 重启 Electron（同一隔离数据目录）：启动预热读取当前 config 选中模型并写缓存；
 *     缓存 JSON 损坏时容错不崩；error 记录不参与命中，预热会覆盖更新 ts/configOptions；
 *     主窗可见耗时不受后台探测阻塞。
 *  4. 已有 ready 缓存时启动预热直接命中，不重写缓存文件（不重复 ACP）。
 *
 * 隔离：PLAND_DEV_DATA_DIR=.devdata-wave4-thinkcache，独立 seed，不触碰 .devdata。
 * 前置：Electron 开发态加载 dist/renderer，源码改动后先执行 `npm run build:renderer`。
 * 运行：npx playwright test e2e/wave4-thinking-cache.spec.ts --workers=1
 *
 * 依赖本机 opencode CLI（ACP）可用；模型 id 取自 `opencode models` 真实目录。
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR_NAME = '.devdata-wave4-thinkcache'
const DATA_DIR = path.join(ROOT, DATA_DIR_NAME)
const CONFIG_FILE = path.join(DATA_DIR, 'ai-config.json')
const CACHE_FILE = path.join(DATA_DIR, 'ai-thinking-cache.json')
const SHOTS_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'thinking-cache')

/** 首次 seed：model 空 + 可见模型空 → 启动预热跳过，保存预热的目标完全由 UI 选择决定。 */
const MODEL_SAVED = 'opencode-go/kimi-k3'
/** 换模型 key 隔离用的第二个真实模型。 */
const MODEL_SWITCHED = 'opencode-go/qwen4-max'
/** 不在 opencode 目录里的模型：ACP 必须回 ACP_MODEL_UNSUPPORTED，且该结果也要落缓存。 */
const MODEL_UNSUPPORTED = 'pland/definitely-not-a-model'
/** 未知 Agent：只验证 `<agentId>|<model>` key 隔离，不额外拉起第二个真实 CLI。 */
const AGENT_ISOLATED = 'pland-probe-agent'

const SENSITIVE_KEY_RE = /(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|credential|authorization)/i

interface CacheEntry {
  agentId: string
  model: string
  configOptions: Array<Record<string, unknown>>
  modelConfigId?: string
  status: 'ready' | 'unsupported' | 'error'
  ts: number
  error?: string
}

interface CacheDoc {
  version: number
  entries: Record<string, CacheEntry>
}

interface AppCtx {
  app: ElectronApplication
  page: Page
  launchedAt: number
}

interface ProbeResult {
  ms: number
  ok?: boolean
  cached?: boolean
  status?: string
  scheduled?: boolean
  error?: string
  configOptions?: Array<Record<string, unknown>>
}

function log(label: string, data: unknown): void {
  console.log(`[W4-THINK] ${label} ${JSON.stringify(data)}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function readCache(): CacheDoc | null {
  const doc = readJson<CacheDoc>(CACHE_FILE)
  if (!doc || doc.version !== 1 || !doc.entries || typeof doc.entries !== 'object') return null
  return doc
}

function cacheKey(agentId: string, model: string): string {
  return `${agentId}|${model}`
}

function cacheEntry(doc: CacheDoc | null, model: string, agentId = 'opencode'): CacheEntry | null {
  if (!doc) return null
  return doc.entries[cacheKey(agentId, model)] || null
}

function sha1(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
}

/** 递归收集敏感字段名（只看 key，不看值，避免模型描述误报）。 */
function sensitiveKeys(value: unknown, prefix = ''): string[] {
  const out: string[] = []
  if (!value || typeof value !== 'object') return out
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${key}` : key
    if (SENSITIVE_KEY_RE.test(key)) out.push(p)
    out.push(...sensitiveKeys((value as Record<string, unknown>)[key], p))
  }
  return out
}

function writeConfig(patch: { model: string; visible: string[] }): void {
  const cfg = readJson<Record<string, unknown>>(CONFIG_FILE) || {}
  cfg.agentId = 'opencode'
  cfg.mainAgent = 'opencode'
  cfg.engine = 'cli'
  cfg.model = patch.model
  cfg.visibleModels = patch.visible
  cfg.visibleModelsCli = { opencode: patch.visible }
  cfg.visibleModelsApi = null
  cfg.customModelsCli = { opencode: [MODEL_SAVED, MODEL_SWITCHED] }
  cfg.acp = { enabled: true, defaultPermissionMode: 'approve-reads', agents: {} }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

function seedFirstRun(): void {
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  writeConfig({ model: '', visible: [] })
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const file = path.join(SHOTS_DIR, name)
  await page.screenshot({ path: file })
  return path.relative(ROOT, file).split(path.sep).join('/')
}

/** 关闭 Playwright 为 Electron 创建的启动管道读端，避免残留 Agent 子进程拖住 worker 收尾。 */
function destroyLaunchStdio(app: ElectronApplication): void {
  let proc: ReturnType<ElectronApplication['process']>
  try {
    proc = app.process()
  } catch {
    return
  }
  const seen = new Set<unknown>()
  const streams: unknown[] = [...(proc.stdio ?? []), proc.stdin, proc.stdout, proc.stderr]
  for (const stream of streams) {
    if (!stream || seen.has(stream)) continue
    seen.add(stream)
    try {
      ;(stream as { destroy?: () => void }).destroy?.()
    } catch {
      /* 管道可能已随进程退出关闭 */
    }
  }
}

async function launchApp(): Promise<AppCtx> {
  const launchedAt = Date.now()
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      PLAND_DEV_DATA_DIR: DATA_DIR_NAME,
      PLAND_RENDERER: 'react',
    } as Record<string, string>,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="main-window"]', { state: 'visible', timeout: 20_000 })
  const picker = page.locator('[data-testid="project-picker"]')
  if (await picker.count()) {
    await page.keyboard.press('Escape')
    await picker.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
  }
  return { app, page, launchedAt }
}

async function closeApp(ctx: AppCtx, label: string): Promise<void> {
  const proc = ctx.app.process()
  let exited = false
  const waitExit = new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(true)
      return
    }
    const timer = setTimeout(() => resolve(false), 15_000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
  await ctx.page.evaluate(() => window.close()).catch(() => undefined)
  exited = await waitExit
  if (!exited) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 5_000,
        })
      } else {
        proc.kill('SIGKILL')
      }
    } catch {
      /* 进程可能已退出 */
    }
  }
  destroyLaunchStdio(ctx.app)
  log('close', { label, exited, code: proc.exitCode })
}

async function openSettingsModels(page: Page): Promise<void> {
  await page.getByLabel('打开设置').click()
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: '模型管理' }).click()
  await expect(page.locator('[data-testid="model-manager"]')).toBeVisible({ timeout: 10_000 })
}

async function probe(
  page: Page,
  args: { model: string; agentId?: string; background?: boolean },
): Promise<ProbeResult> {
  return page.evaluate(async (input) => {
    const api = (window as unknown as { protoAPI: { ai: Record<string, unknown> } }).protoAPI
    const listModels = api.ai.listModels as (hint: Record<string, unknown>) => Promise<ProbeResult>
    const hint: Record<string, unknown> = {
      engine: 'cli',
      probeModel: input.model,
      agentId: input.agentId || 'opencode',
    }
    if (input.background) hint.background = true
    const t0 = performance.now()
    const result = await listModels(hint)
    return { ...result, ms: performance.now() - t0 }
  }, args)
}

/** 轮询等待缓存条目满足条件；返回条目与从 since 起的耗时。 */
async function waitCacheEntry(
  key: string,
  accept: (entry: CacheEntry) => boolean,
  since: number,
  timeoutMs: number,
): Promise<{ entry: CacheEntry; elapsedMs: number }> {
  const deadline = Date.now() + timeoutMs
  let last: CacheEntry | null = null
  while (Date.now() < deadline) {
    const doc = readCache()
    const entry = doc?.entries[key] || null
    if (entry) last = entry
    if (entry && accept(entry)) return { entry, elapsedMs: Date.now() - since }
    await delay(200)
  }
  const doc = readCache()
  throw new Error(
    `等待缓存条目超时：${key}（${timeoutMs}ms）；最后记录=${JSON.stringify(last)}；` +
      `现有条目=${JSON.stringify(doc ? Object.keys(doc.entries) : null)}；文件存在=${fs.existsSync(CACHE_FILE)}`,
  )
}

/** 轮询等待任意条件；返回从 since 起的耗时。 */
async function waitUntil(accept: () => boolean, since: number, timeoutMs: number, label: string): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (accept()) return Date.now() - since
    await delay(20)
  }
  throw new Error(`等待超时：${label}（${timeoutMs}ms）`)
}

test.describe.serial('Wave4 思考强度缓存（真机）', () => {
  test.beforeAll(() => {
    fs.rmSync(SHOTS_DIR, { recursive: true, force: true })
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
  })

  test.afterAll(() => {
    // 隔离目录由验证脚本统一清理；此处只兜底杀掉可能残留的 Electron 进程树。
    try {
      for (const name of fs.readdirSync(SHOTS_DIR)) {
        if (!name.endsWith('.png')) fs.rmSync(path.join(SHOTS_DIR, name), { force: true })
      }
    } catch {
      /* 截图目录不可读时忽略 */
    }
  })

  test('1. 保存不等待 ACP：配置先落盘，后台探测随后写缓存', async () => {
    test.setTimeout(180_000)
    seedFirstRun()
    expect(fs.existsSync(CACHE_FILE)).toBe(false)
    const ctx = await launchApp()
    try {
      const { page } = ctx
      await openSettingsModels(page)
      const count = page.locator('[data-testid="model-manager-count"]')
      await expect(count).toHaveText(/已选 0 \/ 共 [1-9]\d* 个/, { timeout: 30_000 })

      await page.getByRole('button', { name: '获取模型' }).click()
      await expect(page.locator('[data-testid="model-fetch-modal"]')).toBeVisible({ timeout: 10_000 })
      const checkbox = page.getByLabel(`获取模型 ${MODEL_SAVED}`)
      await checkbox.waitFor({ state: 'visible', timeout: 30_000 })
      await shot(page, '01-model-fetch-modal.png')

      const tClick = Date.now()
      await checkbox.click()

      // saveConfig 落盘即视为保存返回（settings-store.save 之后的 fetchModels 只是目录刷新）。
      const saveMs = await waitUntil(
        () => {
          const cfg = readJson<{ visibleModelsCli?: Record<string, string[]> }>(CONFIG_FILE)
          return !!cfg?.visibleModelsCli?.opencode?.includes(MODEL_SAVED)
        },
        tClick,
        5_000,
        'ai-config.json 写入选中模型',
      )
      const cacheAtSave = cacheEntry(readCache(), MODEL_SAVED)

      // 保存刚返回时 UI 必须仍可交互：关掉获取模型弹窗，来回切 Tab。
      const modal = page.locator('[data-testid="model-fetch-modal"]')
      await modal.getByRole('button', { name: '完成', exact: true }).click()
      const tUi = Date.now()
      await page.getByRole('tab', { name: '设计规范' }).click()
      await page.getByRole('tab', { name: '模型管理' }).click()
      await expect(page.locator('[data-testid="model-manager"]')).toBeVisible({ timeout: 5_000 })
      const uiSwitchMs = Date.now() - tUi
      await shot(page, '02-settings-after-save.png')

      const { entry, elapsedMs: probeDoneMs } = await waitCacheEntry(
        cacheKey('opencode', MODEL_SAVED),
        (item) => item.status === 'ready' && Array.isArray(item.configOptions) && item.configOptions.length > 0,
        tClick,
        60_000,
      )

      expect(saveMs).toBeLessThan(3_000)
      expect(cacheAtSave).toBeNull()
      expect(probeDoneMs).toBeGreaterThan(saveMs + 500)
      expect(uiSwitchMs).toBeLessThan(3_000)
      expect(entry.status).toBe('ready')
      expect(entry.model).toBe(MODEL_SAVED)
      expect(entry.configOptions.length).toBeGreaterThan(0)
      expect(entry.ts).toBeGreaterThan(0)

      log('save-then-probe', {
        model: MODEL_SAVED,
        saveMs,
        uiSwitchMs,
        probeDoneMs,
        cacheAbsentAtSave: cacheAtSave === null,
        entry: {
          key: cacheKey('opencode', MODEL_SAVED),
          status: entry.status,
          options: entry.configOptions.map((o) => String(o.id || '')),
          optionCount: entry.configOptions.length,
          ts: entry.ts,
        },
      })
    } finally {
      await closeApp(ctx, '1')
    }
  })

  test('2. 缓存命中毫秒级 + 模型/Agent key 隔离 + unsupported 落缓存 + 无敏感字段', async () => {
    test.setTimeout(240_000)
    const ctx = await launchApp()
    try {
      const { page } = ctx
      const hashBefore = sha1(CACHE_FILE)

      const hits: ProbeResult[] = []
      for (let i = 0; i < 3; i += 1) hits.push(await probe(page, { model: MODEL_SAVED }))
      const hashAfterHits = sha1(CACHE_FILE)
      expect(hits.every((r) => r.ok === true && r.cached === true)).toBe(true)
      expect(hits.every((r) => Array.isArray(r.configOptions) && r.configOptions.length > 0)).toBe(true)
      expect(Math.max(...hits.map((r) => r.ms))).toBeLessThan(200)
      expect(hashAfterHits).toBe(hashBefore)

      await openSettingsModels(page)
      await expect(page.locator('[data-testid="model-manager"]')).toBeVisible()
      await shot(page, '03-cache-hit.png')

      // 换模型：background 探测立即返回 probing，完成后写不同的 key。
      const switched = await probe(page, { model: MODEL_SWITCHED, background: true })
      expect(switched.status).toBe('probing')
      expect(switched.scheduled).toBe(true)
      expect(switched.ms).toBeLessThan(200)
      const switchedDone = await waitCacheEntry(
        cacheKey('opencode', MODEL_SWITCHED),
        (item) => item.status === 'ready' && item.configOptions.length > 0,
        Date.now(),
        60_000,
      )

      // 换 Agent：未知 Agent 直接落 error 记录，证明 key 含 agentId，不会串到 opencode|model。
      const otherAgent = await probe(page, {
        model: MODEL_SAVED,
        agentId: AGENT_ISOLATED,
        background: true,
      })
      expect(otherAgent.status).toBe('probing')
      expect(otherAgent.ms).toBeLessThan(200)
      const agentEntry = await waitCacheEntry(
        cacheKey(AGENT_ISOLATED, MODEL_SAVED),
        (item) => item.status === 'error',
        Date.now(),
        10_000,
      )
      expect(agentEntry.entry.error || '').toContain('ACP_AGENT_NOT_FOUND')

      // unsupported：真实 ACP 判定一次后落缓存，二次命中不再探测。
      const unsupportedFirst = await probe(page, { model: MODEL_UNSUPPORTED })
      expect(unsupportedFirst.ok).toBe(false)
      expect(unsupportedFirst.error).toBe('ACP_MODEL_UNSUPPORTED')
      const unsupportedEntry = await waitCacheEntry(
        cacheKey('opencode', MODEL_UNSUPPORTED),
        (item) => item.status === 'unsupported',
        Date.now(),
        10_000,
      )
      expect(unsupportedEntry.entry.configOptions).toEqual([])
      const unsupportedSecond = await probe(page, { model: MODEL_UNSUPPORTED })
      expect(unsupportedSecond.ok).toBe(false)
      expect(unsupportedSecond.cached).toBe(true)
      expect(unsupportedSecond.error).toBe('ACP_MODEL_UNSUPPORTED')
      expect(unsupportedSecond.ms).toBeLessThan(200)

      // 敏感字段：缓存文件不允许出现 token/apiKey/secret 等键。
      const doc = readCache()
      expect(doc).not.toBeNull()
      const badKeys = sensitiveKeys(doc)
      expect(badKeys).toEqual([])
      const text = fs.readFileSync(CACHE_FILE, 'utf8')
      for (const key of ['"apiKey"', '"access_token"', '"refresh_token"', '"password"', '"secret"']) {
        expect(text).not.toContain(key)
      }

      log('cache-hit-isolation', {
        hitMs: hits.map((r) => Number(r.ms.toFixed(2))),
        hitCached: hits.map((r) => r.cached === true),
        options: hits[0].configOptions?.length,
        switchedKey: cacheKey('opencode', MODEL_SWITCHED),
        switchedProbeMs: switchedDone.elapsedMs,
        switchedOptions: switchedDone.entry.configOptions.length,
        agentKey: cacheKey(AGENT_ISOLATED, MODEL_SAVED),
        agentStatus: agentEntry.entry.status,
        unsupported: {
          firstMs: Number(unsupportedFirst.ms.toFixed(2)),
          secondMs: Number(unsupportedSecond.ms.toFixed(2)),
          secondCached: unsupportedSecond.cached === true,
          status: unsupportedEntry.entry.status,
        },
        sensitiveKeys: badKeys,
        cacheBytes: Buffer.byteLength(text, 'utf8'),
        entries: Object.keys(doc?.entries || {}),
      })
    } finally {
      await closeApp(ctx, '2')
    }
  })

  test('3. 重启预热：坏 JSON 容错、按当前模型写缓存、不阻塞主窗；error 记录会被更新', async () => {
    test.setTimeout(300_000)
    // 3a：缓存文件损坏 + 当前模型切到未缓存的 MODEL_SWITCHED。
    fs.writeFileSync(CACHE_FILE, '{ this is definitely not valid json', 'utf8')
    writeConfig({ model: MODEL_SWITCHED, visible: [MODEL_SAVED] })

    let ctx = await launchApp()
    let visibleMs = 0
    let cacheAtVisible: CacheDoc | null = null
    try {
      const { page } = ctx
      visibleMs = Date.now() - ctx.launchedAt
      cacheAtVisible = readCache()
      expect(visibleMs).toBeLessThan(20_000)
      // 主窗已可见时后台预热尚未写回（坏 JSON 仍未被替换或至少没有目标条目）。
      expect(cacheAtVisible === null || !cacheAtVisible.entries[cacheKey('opencode', MODEL_SWITCHED)]).toBe(true)
      await shot(page, '04-startup-visible.png')

      const warm = await waitCacheEntry(
        cacheKey('opencode', MODEL_SWITCHED),
        (item) => item.status === 'ready' && item.configOptions.length > 0,
        ctx.launchedAt,
        60_000,
      )
      expect(warm.entry.ts).toBeGreaterThan(ctx.launchedAt - 5_000)
      expect(warm.entry.configOptions.length).toBeGreaterThan(0)
      expect(warm.elapsedMs).toBeGreaterThan(visibleMs + 500)
      expect(readCache()?.version).toBe(1)
      await shot(page, '05-startup-warm-done.png')
      log('restart-warm-corrupt-cache', {
        visibleMs,
        warmDoneMs: warm.elapsedMs,
        cacheInvalidAtVisible: cacheAtVisible === null,
        model: MODEL_SWITCHED,
        ts: warm.entry.ts,
        optionCount: warm.entry.configOptions.length,
        options: warm.entry.configOptions.map((o) => String(o.id || '')),
      })
    } finally {
      await closeApp(ctx, '3a')
    }

    // 3b：已有 error 记录（不算命中）→ 预热应重探并覆盖 ts/configOptions。
    const stale = readCache()
    expect(stale).not.toBeNull()
    const staleEntry: CacheEntry = {
      agentId: 'opencode',
      model: MODEL_SWITCHED,
      configOptions: [],
      modelConfigId: '',
      status: 'error',
      error: 'ACP_PROBE_FAILED:stale',
      ts: 1,
    }
    if (stale) {
      stale.entries[cacheKey('opencode', MODEL_SWITCHED)] = staleEntry
      fs.writeFileSync(CACHE_FILE, JSON.stringify(stale), 'utf8')
    }

    ctx = await launchApp()
    try {
      const { page } = ctx
      const visible2 = Date.now() - ctx.launchedAt
      const updated = await waitCacheEntry(
        cacheKey('opencode', MODEL_SWITCHED),
        (item) => item.status === 'ready' && item.configOptions.length > 0 && item.ts > 1,
        ctx.launchedAt,
        60_000,
      )
      expect(updated.entry.ts).toBeGreaterThan(1)
      expect(updated.entry.ts).toBeGreaterThan(ctx.launchedAt - 5_000)
      expect(updated.entry.configOptions.length).toBeGreaterThan(0)
      expect(updated.entry.error).toBeUndefined()
      await shot(page, '06-warm-update.png')
      log('restart-warm-error-refresh', {
        visibleMs: visible2,
        warmDoneMs: updated.elapsedMs,
        staleTs: 1,
        newTs: updated.entry.ts,
        optionCount: updated.entry.configOptions.length,
      })
    } finally {
      await closeApp(ctx, '3b')
    }
  })

  test('4. 预热命中不重写缓存：不重复 ACP，命中探测仍毫秒级', async () => {
    test.setTimeout(120_000)
    const hashBefore = sha1(CACHE_FILE)
    const mtimeBefore = fs.statSync(CACHE_FILE).mtimeMs
    const ctx = await launchApp()
    try {
      const visibleMs = Date.now() - ctx.launchedAt
      await delay(4_000)
      const hashAfter = sha1(CACHE_FILE)
      const mtimeAfter = fs.statSync(CACHE_FILE).mtimeMs
      expect(hashAfter).toBe(hashBefore)
      expect(mtimeAfter).toBe(mtimeBefore)

      const hit = await probe(ctx.page, { model: MODEL_SWITCHED })
      expect(hit.ok).toBe(true)
      expect(hit.cached).toBe(true)
      expect(Array.isArray(hit.configOptions) && hit.configOptions.length > 0).toBe(true)
      expect(hit.ms).toBeLessThan(200)
      await shot(ctx.page, '07-warm-hit.png')
      log('warm-hit-no-rewrite', {
        visibleMs,
        hashSame: hashAfter === hashBefore,
        mtimeSame: mtimeAfter === mtimeBefore,
        hitMs: Number(hit.ms.toFixed(2)),
        cached: hit.cached === true,
        optionCount: hit.configOptions?.length,
      })
    } finally {
      await closeApp(ctx, '4')
    }
  })
})
