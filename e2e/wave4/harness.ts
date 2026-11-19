/**
 * e2e/wave4/harness.ts — Wave4 真机冒烟共享测试基座（Phase 0 冻结）。
 *
 * 只做四件事：
 * 1. `launchApp({ domain, env })`：拉起真实 Electron，强制 `PLAND_DEV_DATA_DIR` 指向
 *    仓库内 `.devdata-wave4-<domain>`，启动后回读 `app.getPath('userData')` 并断言隔离生效。
 * 2. 收集 console error / pageerror / crash / 主进程 stderr，供域报告取证。
 * 3. 截图 helper：统一落到 `docs/wave4/shots/<domain>/<NN>-<slug>.png`，失败加 `-FAIL`。
 * 4. 失败报告 helper：截图 + Markdown 片段落到 `%TEMP%/pland-wave4/failures/<domain>/`。
 *
 * 域 spec 用法：
 * ```ts
 * import { launchApp, assertCleanExit, reportFailure } from './wave4/harness'
 *
 * const ctx = await launchApp({ domain: 'shell' })
 * try {
 *   await ctx.shot(1, 'cold-start')
 *   // ... 业务断言 ...
 *   ctx.assertNoFatalConsole()
 * } catch (err) {
 *   await reportFailure(ctx, {
 *     step: 1, slug: 'cold-start', level: 'P1',
 *     expected: 'main-window 可见', actual: '白屏', error: err,
 *   })
 *   throw err
 * } finally {
 *   assertCleanExit(await ctx.close())
 * }
 * ```
 *
 * 硬约束：
 * - 不启动真实 AI 发送、不跑 Git 网络；这些是域 spec 的独占项。
 * - 每个 spec 自己 launch/close，不共享 Electron 实例；同一 domain 目录同一时刻只允许一个实例。
 * - `env` 不能覆盖数据目录；harness 最后写入 `PLAND_DEV_DATA_DIR`。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { _electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'

/**
 * 仓库根：正常运行由 `e2e/wave4/harness.ts` 的位置推导。
 * `PLAND_WAVE4_ROOT` 仅用于把 harness 单独编译到临时目录做 Phase 0 自检；
 * 域 spec 不需要设置。
 */
const rootOverride = String(process.env.PLAND_WAVE4_ROOT || '').trim()
export const ROOT = rootOverride ? path.resolve(rootOverride) : path.resolve(__dirname, '..', '..')
export const WAVE4_DOCS = path.join(ROOT, 'docs', 'wave4')
export const SHOTS_ROOT = path.join(WAVE4_DOCS, 'shots')
export const TEMP_ROOT = path.join(os.tmpdir(), 'pland-wave4')
export const DOMAIN_PREFIX = '.devdata-wave4-'

export type DefectLevel = 'P0' | 'P1' | 'P2' | 'P3' | 'ENV'

const DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,31}$/i

/** 真机环境：禁止 Git 走交互式凭据弹窗（与 e2e/electron-live.spec.ts 保持一致）。 */
const GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
}

/** 已知无害噪声（favicon / 第三方 / devtools / 布局抖动），不计为致命。 */
const IGNORED_CONSOLE = [
  'favicon',
  'third-party',
  'thirdparty',
  'react devtools',
  'devtools',
  'resizeobserver loop',
  'autofill',
]

export interface LaunchAppOptions {
  /** 域名；决定数据目录 `<repo>/.devdata-wave4-<domain>` 与截图子目录。 */
  domain: string
  /** 额外环境变量；不能覆盖 PLAND_DEV_DATA_DIR。 */
  env?: Record<string, string | undefined>
  /** 渲染器，默认 react；legacy 只做回退 sanity。 */
  renderer?: 'react' | 'legacy'
  /** 等待 main-window 的时间，默认 30s。 */
  timeoutMs?: number
  /** 是否等待 main-window 可见，默认 true；legacy 会自动跳过。 */
  waitForMainWindow?: boolean
  /** 是否要求域目录内已有 `_wave4-seed.json`，默认 true。 */
  requireSeed?: boolean
}

export interface ShotOptions {
  /** 截整页，默认 false（只截视口，便于定位真实可见状态）。 */
  fullPage?: boolean
  /** 失败截图后缀 `-FAIL`。 */
  fail?: boolean
  /** 截另一个窗口（如 docwin）；默认主窗。 */
  page?: Page
}

export type CloseMethod = 'already-exited' | 'window-close' | 'app-close' | 'kill'

export interface CloseOptions {
  /** `window.close()` 后等待进程退出的时间，默认 10s。 */
  graceMs?: number
  /** `app.close()` 的等待时间，默认 5s。 */
  appCloseMs?: number
  /** 跳过优雅关闭，直接杀进程树（仅异常兜底使用）。 */
  force?: boolean
}

export interface CloseResult {
  ok: boolean
  exitCode: number | null
  method: CloseMethod
  elapsedMs: number
  /** 进程是否在超时前真正退出。 */
  exited: boolean
}

export interface FailureInput {
  step: number | string
  slug: string
  level?: DefectLevel
  expected: string
  actual: string
  error?: unknown
  extra?: string
  /** 默认 true：自动截 `-FAIL.png`。 */
  screenshot?: boolean
  page?: Page
}

export interface FailureReport {
  timestamp: string
  level: DefectLevel
  file: string
  markdown: string
  screenshot: string | null
  shotRelative: string | null
}

export interface Wave4App {
  app: ElectronApplication
  page: Page
  domain: string
  dataDir: string
  userData: string
  seedPresent: boolean
  consoleErrors: string[]
  pageErrors: string[]
  crashes: string[]
  stderr: string[]
  failures: FailureReport[]
  shot(step: number | string, slug: string, options?: ShotOptions): Promise<string>
  close(options?: CloseOptions): Promise<CloseResult>
  fatalErrors(): string[]
  assertNoFatalConsole(): void
  reportFailure(input: FailureInput): Promise<FailureReport>
}

interface CollectorState {
  consoleErrors: string[]
  pageErrors: string[]
  crashes: string[]
  attached: WeakSet<Page>
}

function normalizeDomain(domain: string): string {
  const value = String(domain || '').trim()
  if (!DOMAIN_RE.test(value)) {
    throw new Error(
      `[wave4] 非法 domain "${domain}"：只允许字母/数字/连字符，首字符不能是连字符，最长 32 字符。`,
    )
  }
  return value.toLowerCase()
}

/** 域数据目录：仓库根下 `.devdata-wave4-<domain>`（与 seed.mjs 的分发目标一致）。 */
export function dataDirFor(domain: string): string {
  return path.join(ROOT, DOMAIN_PREFIX + normalizeDomain(domain))
}

export function shotsDirFor(domain: string): string {
  return path.join(SHOTS_ROOT, normalizeDomain(domain))
}

function slugify(value: string): string {
  const slug = String(value)
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return slug || 'shot'
}

function formatStep(step: number | string): string {
  if (typeof step === 'number') {
    if (!Number.isFinite(step) || step < 0) throw new Error(`[wave4] 非法步骤号：${step}`)
    return String(Math.floor(step)).padStart(2, '0')
  }
  return slugify(step).toUpperCase()
}

/** 截图绝对路径：`docs/wave4/shots/<domain>/<NN>-<slug>[-FAIL].png`。 */
export function shotPath(domain: string, step: number | string, slug: string, fail = false): string {
  return path.join(shotsDirFor(domain), `${formatStep(step)}-${slugify(slug)}${fail ? '-FAIL' : ''}.png`)
}

function safeProcess(app: ElectronApplication): ChildProcess | null {
  try {
    return app.process()
  } catch {
    return null
  }
}

function destroyLaunchStdio(proc: ChildProcess): void {
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

function killTree(proc: ChildProcess): void {
  if (proc.exitCode !== null) return
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
    /* 进程可能已经退出 */
  }
  if (proc.exitCode === null) {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* 同上 */
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForExit(proc: ChildProcess, ms: number): Promise<boolean> {
  if (proc.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(proc.exitCode !== null), ms)
    proc.once('exit', onExit)
    if (proc.exitCode !== null) finish(true)
  })
}

function pushCapped(target: string[], text: string, maxChars = 20_000): void {
  target.push(text.slice(0, 4_000))
  let total = target.reduce((sum, item) => sum + item.length, 0)
  while (total > maxChars && target.length > 1) {
    total -= target.shift()!.length
  }
}

function attachCollectors(page: Page, state: CollectorState): void {
  if (state.attached.has(page)) return
  state.attached.add(page)
  page.on('console', (msg) => {
    if (msg.type() === 'error') state.consoleErrors.push(msg.text().slice(0, 2_000))
  })
  page.on('pageerror', (err) => {
    state.pageErrors.push('pageerror: ' + String(err?.message ?? err).slice(0, 2_000))
  })
  page.on('crash', () => {
    state.crashes.push('page crash: ' + page.url())
  })
}

export function isFatalConsole(text: string): boolean {
  const lower = text.toLowerCase()
  return !IGNORED_CONSOLE.some((noise) => lower.includes(noise))
}

function assertIsolatedUserData(actualUserData: string, expectedDataDir: string, domain: string): void {
  const actual = path.resolve(actualUserData)
  const expected = path.resolve(expectedDataDir)
  const norm = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value)
  if (!norm(actual).endsWith(norm(expected))) {
    throw new Error(
      [
        `[wave4/${domain}] 数据隔离失败：app.getPath('userData') 未指向期望目录。`,
        `  期望（结尾匹配）：${expected}`,
        `  实际：${actual}`,
        '  常见原因：PLAND_DEV_DATA_DIR 为空/被覆盖、app.isPackaged 为 true、或目录不可用触发 .devdata 回退。',
      ].join('\n'),
    )
  }
  if (norm(actual) !== norm(expected)) {
    throw new Error(
      [
        `[wave4/${domain}] 数据隔离失败：userData 不是精确匹配。`,
        `  期望：${expected}`,
        `  实际：${actual}`,
        '  禁止在非隔离目录继续执行，避免污染共享 .devdata。',
      ].join('\n'),
    )
  }
}

function buildLaunchEnv(options: LaunchAppOptions, dataDir: string): Record<string, string> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...GIT_NONINTERACTIVE_ENV,
    ...(options.env ?? {}),
  }
  // 强制覆盖，不允许 options.env/父进程环境把数据目录指回 .devdata。
  env.PLAND_DEV_DATA_DIR = dataDir
  env.PLAND_RENDERER = options.renderer ?? options.env?.PLAND_RENDERER ?? 'react'
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  return env as Record<string, string>
}

/** 拉起真实 Electron 并断言隔离 userData；失败时自动收尸。 */
export async function launchApp(options: LaunchAppOptions): Promise<Wave4App> {
  const domain = normalizeDomain(options.domain)
  const expectedDataDir = dataDirFor(domain)
  const renderer = options.renderer ?? options.env?.PLAND_RENDERER ?? 'react'
  const state: CollectorState = {
    consoleErrors: [],
    pageErrors: [],
    crashes: [],
    attached: new WeakSet<Page>(),
  }
  const stderr: string[] = []
  const env = buildLaunchEnv(options, expectedDataDir)

  let app: ElectronApplication | null = null
  let page: Page | null = null
  try {
    app = await _electron.launch({
      args: ['.'],
      cwd: ROOT,
      env,
    })
    const proc = safeProcess(app)
    if (proc?.stderr) {
      proc.stderr.on('data', (chunk: Buffer | string) => pushCapped(stderr, String(chunk)))
    }

    page = await app.firstWindow()
    attachCollectors(page, state)
    app.on('window', (nextPage) => attachCollectors(nextPage, state))

    // 先断言隔离，再等 UI：数据目录指错时给出明确错误，而不是被 main-window 超时掩盖。
    const [actualUserData, isPackaged] = await Promise.all([
      app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')),
      app.evaluate(({ app: electronApp }) => electronApp.isPackaged),
    ])

    if (isPackaged) {
      throw new Error(
        `[wave4/${domain}] 当前是打包态，PLAND_DEV_DATA_DIR 按设计被忽略；Wave4 冒烟必须在开发态执行。`,
      )
    }
    assertIsolatedUserData(actualUserData, expectedDataDir, domain)

    const seedPresent = fs.existsSync(path.join(actualUserData, '_wave4-seed.json'))
    if (!seedPresent && options.requireSeed !== false) {
      throw new Error(
        [
          `[wave4/${domain}] 域数据目录缺少 seed：${actualUserData}`,
          `  先执行：node e2e/wave4/seed.mjs --domain ${domain}`,
          '  如确实需要空 profile，请显式传入 requireSeed: false。',
        ].join('\n'),
      )
    }
    if (!seedPresent) {
      console.warn(`[wave4/${domain}] 未发现 _wave4-seed.json，按空 profile 继续（requireSeed=false）。`)
    }

    if (options.waitForMainWindow !== false && renderer !== 'legacy') {
      await page.getByTestId('main-window').waitFor({
        state: 'visible',
        timeout: options.timeoutMs ?? 30_000,
      })
    } else {
      await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    }

    const ctx: Wave4App = {
      app,
      page,
      domain,
      dataDir: expectedDataDir,
      userData: actualUserData,
      seedPresent,
      consoleErrors: state.consoleErrors,
      pageErrors: state.pageErrors,
      crashes: state.crashes,
      stderr,
      failures: [],
      async shot(step, slug, shotOptions = {}) {
        const target = shotOptions.page ?? page!
        fs.mkdirSync(shotsDirFor(domain), { recursive: true })
        const file = shotPath(domain, step, slug, Boolean(shotOptions.fail))
        await target.screenshot({ path: file, fullPage: Boolean(shotOptions.fullPage) })
        return file
      },
      close(closeOptions = {}) {
        return closeApp(app!, page ?? undefined, closeOptions)
      },
      fatalErrors() {
        return [...state.consoleErrors, ...state.pageErrors, ...state.crashes].filter(isFatalConsole)
      },
      assertNoFatalConsole() {
        const fatal = [...state.consoleErrors, ...state.pageErrors, ...state.crashes].filter(isFatalConsole)
        if (fatal.length) {
          throw new Error(`[wave4/${domain}] 致命 console/page error ${fatal.length} 条：\n` + fatal.join('\n'))
        }
      },
      async reportFailure(input) {
        return reportFailure(ctx, input)
      },
    }
    return ctx
  } catch (err) {
    if (app) await closeApp(app, page ?? undefined, { graceMs: 2_000, appCloseMs: 2_000, force: true })
    throw err
  }
}

/**
 * 关闭 Electron：
 * 1) 优先 `window.close()` → window-all-closed → app.quit()；
 * 2) 超时后 `app.close()`；
 * 3) 仍未退出则 taskkill / SIGKILL 整棵进程树，并销毁启动管道读端。
 * 不抛异常，返回可断言的结果；异常路径调用方可用 `assertCleanExit`。
 */
export async function closeApp(
  app: ElectronApplication,
  page?: Page,
  options: CloseOptions = {},
): Promise<CloseResult> {
  const started = Date.now()
  const proc = safeProcess(app)
  if (!proc) {
    return { ok: true, exitCode: null, method: 'already-exited', elapsedMs: Date.now() - started, exited: true }
  }
  if (proc.exitCode !== null) {
    destroyLaunchStdio(proc)
    return {
      ok: proc.exitCode === 0,
      exitCode: proc.exitCode,
      method: 'already-exited',
      elapsedMs: Date.now() - started,
      exited: true,
    }
  }

  let method: CloseMethod = 'window-close'
  const graceMs = options.graceMs ?? 10_000
  const appCloseMs = options.appCloseMs ?? 5_000

  if (options.force) {
    method = 'kill'
    killTree(proc)
    await waitForExit(proc, 3_000)
  } else {
    if (page) {
      await page.evaluate(() => window.close()).catch(() => undefined)
      if (await waitForExit(proc, graceMs)) {
        destroyLaunchStdio(proc)
        return {
          ok: proc.exitCode === 0,
          exitCode: proc.exitCode,
          method,
          elapsedMs: Date.now() - started,
          exited: true,
        }
      }
    }

    if (proc.exitCode === null) {
      method = 'app-close'
      await Promise.race([app.close().catch(() => undefined), delay(appCloseMs)])
      if (await waitForExit(proc, appCloseMs)) {
        destroyLaunchStdio(proc)
        return {
          ok: proc.exitCode === 0,
          exitCode: proc.exitCode,
          method,
          elapsedMs: Date.now() - started,
          exited: true,
        }
      }
    }

    if (proc.exitCode === null) {
      method = 'kill'
      killTree(proc)
      await waitForExit(proc, 3_000)
    }
  }

  destroyLaunchStdio(proc)
  return {
    ok: proc.exitCode === 0 && method !== 'kill',
    exitCode: proc.exitCode,
    method,
    elapsedMs: Date.now() - started,
    exited: proc.exitCode !== null,
  }
}

/** 显式断言主进程正常退出；建议在 finally 中调用。 */
export function assertCleanExit(result: CloseResult): void {
  if (!result.exited || result.exitCode !== 0 || result.method === 'kill') {
    throw new Error(
      `[wave4] Electron 未正常退出：method=${result.method} exitCode=${result.exitCode} ` +
        `elapsed=${result.elapsedMs}ms exited=${result.exited}`,
    )
  }
}

function textOfError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

function fenced(text: string, lang = 'text'): string {
  const safe = String(text ?? '').replace(/~~~/g, '~ ~ ~')
  return `~~~${lang}\n${safe}\n~~~`
}

/**
 * 失败报告：截图（`-FAIL.png`）+ Markdown 片段落到
 * `%TEMP%/pland-wave4/failures/<domain>/<NN>-<slug>-<timestamp>.md`。
 * 不直接写 docs/wave4/reports/<domain>.md，避免多个域/重跑互相覆盖。
 */
export async function reportFailure(ctx: Wave4App, input: FailureInput): Promise<FailureReport> {
  const timestamp = new Date().toISOString()
  const level = input.level ?? 'P1'
  let screenshot: string | null = null
  let screenshotNote = ''
  if (input.screenshot !== false) {
    try {
      screenshot = await ctx.shot(input.step, input.slug, { fail: true, page: input.page })
    } catch (err) {
      screenshotNote = `失败截图未能生成：${textOfError(err)}`
    }
  }

  const shotRelative = screenshot ? path.relative(ROOT, screenshot).split(path.sep).join('/') : null
  const consoleErrors = ctx.consoleErrors.slice(-20)
  const pageErrors = ctx.pageErrors.slice(-20)
  const crashes = ctx.crashes.slice(-10)
  const stderrTail = ctx.stderr.slice(-10).join('')
  const markdown = [
    `## FAIL · ${ctx.domain} · step ${formatStep(input.step)} ${input.slug}`,
    '',
    `- 时间：${timestamp}`,
    `- 级别：${level}`,
    `- 数据目录：\`${ctx.dataDir}\``,
    `- 实际 userData：\`${ctx.userData}\``,
    `- seed：${ctx.seedPresent ? 'present' : 'missing'}`,
    `- 预期：${input.expected}`,
    `- 实际：${input.actual}`,
    ...(input.error ? [`- 错误：${textOfError(input.error).split('\n')[0]}`] : []),
    ...(shotRelative ? [`- 截图：\`${shotRelative}\``] : []),
    ...(screenshotNote ? [`- 截图异常：${screenshotNote}`] : []),
    '',
    '### 错误栈 / 附加信息',
    '',
    fenced(textOfError(input.error ?? '(未提供)')),
    ...(input.extra ? ['', '### 现场附加', '', fenced(input.extra, 'json')] : []),
    '',
    `### Console errors（last ${consoleErrors.length}）`,
    '',
    fenced(consoleErrors.length ? consoleErrors.join('\n') : '(none)'),
    '',
    `### Page errors（last ${pageErrors.length}）`,
    '',
    fenced(pageErrors.length ? pageErrors.join('\n') : '(none)'),
    '',
    `### Crashes（${crashes.length}）`,
    '',
    fenced(crashes.length ? crashes.join('\n') : '(none)'),
    '',
    '### Main process stderr（tail）',
    '',
    fenced(stderrTail || '(empty)'),
    '',
  ].join('\n')

  const dir = path.join(TEMP_ROOT, 'failures', ctx.domain)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = timestamp.replace(/[:.]/g, '-')
  const file = path.join(dir, `${formatStep(input.step)}-${slugify(input.slug)}-${stamp}.md`)
  fs.writeFileSync(file, markdown, 'utf8')

  const report: FailureReport = { timestamp, level, file, markdown, screenshot, shotRelative }
  ctx.failures.push(report)
  console.error(`[wave4/${ctx.domain}] FAIL step ${formatStep(input.step)} ${input.slug} (${level}) -> ${file}`)
  return report
}
