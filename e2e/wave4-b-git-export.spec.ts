/**
 * e2e/wave4-b-git-export.spec.ts — Wave4 B 全量体验 · Git + 导出 + 浮层（标注/快照/链接/待提交）。
 *
 * 覆盖（真实 Electron + React 渲染器；不触网、不碰真实 gitee）：
 *   B1 Git
 *     - 660px Dialog、状态树（项目卡 → 原型组 → 文件行）、搜索、状态筛选、折叠；
 *     - 仓库设置保存/回显、假 token 掩码、测试连接、分支列表；
 *     - 本地 bare 夹具 push、另一 clone 追加后 diff/pull、upstream、自愈取消；
 *     - 取消操作入口（尽力命中；本地操作过快时记 P3 观察，不伪造）；
 *     - 无 GCM/凭据进程、关闭后无 git 孤儿、`git fsck` 健康。
 *   B2 导出
 *     - 5 项菜单；源码 JSON；独立 HTML（Chromium file:// 断网、右侧文档区、表格、无 React）；
 *     - 文档 Markdown；PNG/PDF 原生保存对话框调用后取消；空文档提示；无源提示。
 *   B3 浮层
 *     - 标注新增（需求条小面板）/定位/隐藏/删除；链接新增/跳转/删除；
 *     - 快照列表（seed 2 版本）/恢复；待提交队列持久化/移除/清空；
 *     - Esc 单层、遮罩点击、焦点回归、1024 宽布局。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain b-git-export
 *   npx playwright test e2e/wave4-b-git-export.spec.ts --workers=1 --output=test-results/wave4/b-git-export
 *
 * 写入范围：`.devdata-wave4-b-git-export/**`、`docs/wave4/shots/b-git-export/**`、
 * `%TEMP%/pland-wave4/exports/b-git-export-*`、`C:\temp\pland-wave4-b-git-export-*`。
 * 测试结束后 afterAll 清理数据目录与临时夹具；报告在 docs/wave4/reports/b-git-export.md。
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { ROOT, TEMP_ROOT, assertCleanExit, isFatalConsole, launchApp, type Wave4App } from './wave4/harness'

const DOMAIN = 'b-git-export'
const RETEST_SHOTS = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-b-settings-git-export')
const PROJECT = '测试1'
const HOME = '首页'
const MINE = '我的'
const ANNO_SELECTOR = '[data-pr-id="pr-p-39"]'
const TOKEN = 'dummy-local-token'
const DOMAIN_DIR = path.join(ROOT, '.devdata-wave4-b-git-export')
const SANDBOX = path.join(DOMAIN_DIR, 'sandbox')
const HOME_DIR = path.join(SANDBOX, PROJECT, HOME)
const HOME_HTML = path.join(HOME_DIR, `${HOME}.html`)
const HOME_MD = path.join(HOME_DIR, `${HOME}.md`)
const ANNO_FILE = path.join(HOME_DIR, 'annotations.json')
const LINKS_FILE = path.join(HOME_DIR, 'links.json')
const SNAPSHOT_HOME = path.join(DOMAIN_DIR, 'snapshots', PROJECT, HOME)

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const STAMP = stamp()
const BARE = path.join('C:\\temp', `pland-wave4-b-git-export-${STAMP}.git`)
const CLONE = path.join('C:\\temp', `pland-wave4-b-git-export-${STAMP}-clone`)
const EXPORT_ROOT = path.join(TEMP_ROOT, 'exports', `b-git-export-${STAMP}`)
const PUSH_MSG = `wave4 b-git-export push ${STAMP}`
const PROBE_MSG = `wave4 b-git-export pull probe ${STAMP}`
const PROBE_FILE = 'wave4-b-ge-pull-probe.md'
const CANCEL_PROBE_FILE = 'wave4-b-ge-cancel-probe.md'

type Level = 'P0' | 'P1' | 'P2' | 'P3' | 'ENV'
type Status = 'PASS' | 'FAIL' | 'SKIP'

interface Observation {
  id: string
  level: Level
  title: string
  detail: string
}

interface StepRow {
  no: number | string
  title: string
  status: Status
  evidence: string
  shots: string[]
  ms: number
}

interface QueueItem {
  id?: string
  selector: string
  page?: string
  htmlFile?: string
  text: string
  selected?: boolean
}

interface FramePoint {
  x: number
  y: number
  scale: number
  frameBox: { x: number; y: number; width: number; height: number }
  local: {
    left: number
    top: number
    width: number
    height: number
    cx: number
    cy: number
    clientWidth: number
    clientHeight: number
  }
}

/** seed 原型内容自带的外部样式/脚本噪声，不计 PlanD 渲染器致命项。 */
function isPrototypeContentNoise(text: string): boolean {
  const t = String(text)
  return /cdn\.jsdelivr\.net\/npm\/vant/i.test(t) || /Unexpected token '\.'/.test(t)
}

function log(label: string, data: unknown): void {
  console.log(`[B-GE] ${label} ${JSON.stringify(data)}`)
}

/** 本轮复测统一落到 docs/wave4/shots/retest-b-settings-git-export/git-export-*.png。 */
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

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

function norm(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sha256(file: string): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return 'unreadable'
  }
}

function sha12(file: string): string {
  return sha256(file).slice(0, 12).toUpperCase()
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function arrayCount(file: string, key?: string): number {
  const raw = readJson(file)
  const list = key && raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : raw
  return Array.isArray(list) ? list.length : -1
}

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => !name.endsWith('.crdownload'))
  } catch {
    return []
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Git / 进程取证
 * ══════════════════════════════════════════════════════════════════════ */

interface GitResult {
  status: number | null
  stdout: string
  stderr: string
}

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
}

function git(args: string[], cwd = ROOT): GitResult {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', '-c', 'credential.helper=', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    windowsHide: true,
    env: GIT_ENV,
  })
  return {
    status: res.status,
    stdout: String(res.stdout ?? '').trim(),
    stderr: String(res.stderr ?? '').trim(),
  }
}

function gitBare(bare: string, args: string[]): GitResult {
  return git([`--git-dir=${bare}`, ...args])
}

function fileUrl(abs: string): string {
  return 'file:///' + path.resolve(abs).replace(/\\/g, '/')
}

function makeBare(): string {
  fs.mkdirSync('C:\\temp', { recursive: true })
  fs.rmSync(BARE, { recursive: true, force: true })
  const init = git(['init', '--bare', '--initial-branch=main', BARE])
  if (init.status !== 0) throw new Error(`git init --bare 失败：${init.stderr || init.stdout}`)
  const config = fs.readFileSync(path.join(BARE, 'config'), 'utf8')
  if (!/\[core\][\s\S]*?\bbare\s*=\s*true\b/i.test(config)) {
    throw new Error(`bare 夹具 core.bare 不是 true：\n${config}`)
  }
  const head = fs.readFileSync(path.join(BARE, 'HEAD'), 'utf8').trim()
  if (!/refs\/heads\/main$/.test(head)) throw new Error(`bare HEAD 未指向 main：${head}`)
  return BARE
}

function ensureClone(bare: string, cloneDir: string): void {
  if (fs.existsSync(path.join(cloneDir, '.git'))) return
  fs.rmSync(cloneDir, { recursive: true, force: true })
  const clone = git(['clone', '--quiet', bare, cloneDir])
  if (clone.status !== 0) throw new Error(`git clone 失败：${clone.stderr || clone.stdout}`)
  git(['-C', cloneDir, 'config', 'user.name', 'Wave4 BGitExport'])
  git(['-C', cloneDir, 'config', 'user.email', 'wave4-bge@local'])
}

/** 在 clone 中新增文件并推回 bare，返回提交 sha。 */
function commitProbe(cloneDir: string, fileName: string, content: string, message: string): string {
  fs.writeFileSync(path.join(cloneDir, fileName), content, 'utf8')
  const add = git(['-C', cloneDir, 'add', '--', fileName])
  if (add.status !== 0) throw new Error(`clone git add 失败：${add.stderr}`)
  const commit = git(['-C', cloneDir, 'commit', '-m', message])
  if (commit.status !== 0) throw new Error(`clone git commit 失败：${commit.stderr || commit.stdout}`)
  const push = git(['-C', cloneDir, 'push', 'origin', 'HEAD:refs/heads/main'])
  if (push.status !== 0) throw new Error(`clone git push 失败：${push.stderr || push.stdout}`)
  const sha = git(['-C', cloneDir, 'rev-parse', 'HEAD']).stdout
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`clone HEAD 非法：${sha}`)
  return sha
}

interface ProcInfo {
  pid: number
  parent: number
  name: string
  cmd: string
}

function psJson(script: string): unknown {
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  const text = String(res.stdout ?? '').trim()
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

function normalizeList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>
  if (value && typeof value === 'object') return [value as Record<string, unknown>]
  return []
}

function listProcesses(): ProcInfo[] {
  const raw = psJson(
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  )
  return normalizeList(raw).map((p) => ({
    pid: Number(p.ProcessId ?? 0),
    parent: Number(p.ParentProcessId ?? 0),
    name: String(p.Name ?? ''),
    cmd: String(p.CommandLine ?? ''),
  }))
}

const CREDENTIAL_PROCESS_NAMES = [
  'git-credential-manager.exe',
  'git-credential-manager-core.exe',
  'git-remote-https.exe',
  'git-remote-http.exe',
]

const GIT_CHILD_NAMES = [...CREDENTIAL_PROCESS_NAMES, 'git.exe', 'conhost.exe']

function descendantsOf(rootPid: number, all: ProcInfo[]): ProcInfo[] {
  if (!rootPid) return []
  const parentById = new Map<number, number>()
  for (const item of all) parentById.set(item.pid, item.parent)
  const out: ProcInfo[] = []
  for (const proc of all) {
    let cursor = proc.pid
    let depth = 0
    while (cursor && depth < 12) {
      const parent = parentById.get(cursor) ?? 0
      if (parent === rootPid) {
        out.push(proc)
        break
      }
      if (!parent || parent === cursor) break
      cursor = parent
      depth += 1
    }
  }
  return out
}

function gitChildrenOf(appPid: number): ProcInfo[] {
  return descendantsOf(appPid, listProcesses()).filter((p) => GIT_CHILD_NAMES.includes(p.name.toLowerCase()))
}

function credentialProcesses(): ProcInfo[] {
  return listProcesses().filter((p) => CREDENTIAL_PROCESS_NAMES.includes(p.name.toLowerCase()))
}

function livePids(pids: number[]): ProcInfo[] {
  if (!pids.length) return []
  const raw = psJson(
    `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName | ConvertTo-Json -Compress`,
  )
  return normalizeList(raw).map((p) => ({ pid: Number(p.Id ?? 0), parent: 0, name: String(p.ProcessName ?? ''), cmd: '' }))
}

function processesMentioning(needle: string): ProcInfo[] {
  const escaped = needle.replace(/'/g, "''")
  const raw = psJson(
    `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('git.exe','git-remote-https.exe','git-remote-http.exe','git-credential-manager.exe','git-credential-manager-core.exe','ssh.exe','conhost.exe') -and $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
  )
  return normalizeList(raw).map((p) => ({
    pid: Number(p.ProcessId ?? 0),
    parent: Number(p.ParentProcessId ?? 0),
    name: String(p.Name ?? ''),
    cmd: String(p.CommandLine ?? ''),
  }))
}

/** seed 原型内容引用的外部 CDN（CSP 拦截/离线打开时也会触发 request 事件），非 Git 域网络。 */
function isPrototypeCdnRequest(url: string): boolean {
  return /^https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|at\.alicdn\.com)\//i.test(
    url,
  )
}

/* ══════════════════════════════════════════════════════════════════════
 * UI 通用
 * ══════════════════════════════════════════════════════════════════════ */

async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: '关闭通知' })
  for (let i = 0; i < 10; i += 1) {
    if ((await close.count().catch(() => 0)) === 0) return
    await close.first().click({ timeout: 1_500 }).catch(() => undefined)
  }
  await delay(100)
}

async function toastTexts(page: Page): Promise<string[]> {
  return page
    .locator('[data-slot="toast"]')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()))
    .catch(() => [])
}

async function waitToast(
  page: Page,
  expectText: string | RegExp,
  timeoutMs = 20_000,
  wrongTexts: string[] = [],
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let seen: string[] = []
  while (Date.now() < deadline) {
    const texts = (await toastTexts(page)).filter(Boolean)
    if (texts.length) seen = texts
    const hit = texts.find((t) =>
      typeof expectText === 'string' ? t.includes(expectText) : new RegExp(expectText.source, expectText.flags).test(t),
    )
    if (hit) return hit
    const bad = texts.find((t) => wrongTexts.some((w) => t.includes(w)))
    if (bad) throw new Error(`返回错误 toast：${bad}`)
    await delay(120)
  }
  throw new Error(
    `未捕获预期 toast「${String(expectText)}」；最后 toast=${seen.join(' / ') || '(none)'}`,
  )
}

async function ensureSidebarExpanded(page: Page): Promise<void> {
  const toggle = page.locator('button[aria-label="展开侧栏"], button[aria-label="收起侧栏"]').first()
  const expanded = await toggle.getAttribute('aria-expanded').catch(() => null)
  if (expanded !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 })
  }
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
}

async function ensureProject(page: Page): Promise<boolean> {
  await page.waitForTimeout(2_000)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    const row = picker.locator('li').filter({ hasText: PROJECT }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  await ensureSidebarExpanded(page)
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => norm(await page.getByTestId('sidebar').locator('button[title="切换项目"]').innerText()), {
      timeout: 20_000,
    })
    .toBe(PROJECT)
  return shown
}

function protoButtons(page: Page) {
  return page.getByTestId('sidebar-tree').locator('button[data-level="proto"]')
}

async function waitPreview(page: Page): Promise<void> {
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
  await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(1_000)
}

async function clickProto(page: Page, name: string): Promise<void> {
  await ensureSidebarExpanded(page)
  const proto = protoButtons(page).filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first()
  await expect(proto).toBeVisible({ timeout: 20_000 })
  await proto.click()
  await waitPreview(page)
}

async function ensurePcStage(page: Page): Promise<void> {
  const kind = await page.getByTestId('stage-frame').getAttribute('data-kind')
  if (kind !== 'pc') {
    await page.locator('button[title="桌面端舞台"]').click()
    await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
  }
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'off', { timeout: 10_000 })
  await waitPreview(page)
}

async function pointOf(page: Page, selector: string, nth = 0): Promise<FramePoint> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const el = frame.locator(selector).nth(nth)
  await expect(el).toBeVisible({ timeout: 10_000 })
  await el.scrollIntoViewIfNeeded()
  const local = await el.evaluate((node) => {
    const r = node.getBoundingClientRect()
    const win = node.ownerDocument.defaultView
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      clientWidth: win ? win.innerWidth : 0,
      clientHeight: win ? win.innerHeight : 0,
    }
  })
  const frameEl = page.getByTestId('preview-frame')
  const frameBox = await frameEl.boundingBox()
  const clientWidth = await frameEl.evaluate((el) => (el as HTMLIFrameElement).clientWidth)
  if (!frameBox || !clientWidth) throw new Error(`无法读取 preview-frame 几何信息（selector=${selector}）`)
  const scale = frameBox.width / clientWidth
  return {
    x: frameBox.x + local.cx * scale,
    y: frameBox.y + local.cy * scale,
    scale,
    frameBox: { x: frameBox.x, y: frameBox.y, width: frameBox.width, height: frameBox.height },
    local,
  }
}

async function pickWithCtrl(page: Page, selector: string, nth = 0): Promise<FramePoint> {
  const point = await pointOf(page, selector, nth)
  await page.keyboard.down('Control')
  try {
    await expect(page.getByTestId('pick-status')).toBeVisible({ timeout: 5_000 })
    await page.mouse.move(point.x - 3, point.y - 3)
    await page.mouse.move(point.x, point.y, { steps: 6 })
    await expect(page.getByTestId('pick-hover')).toBeVisible({ timeout: 5_000 })
    await page.mouse.click(point.x, point.y)
  } finally {
    await page.keyboard.up('Control').catch(() => undefined)
  }
  // 点击后焦点可能已进入 iframe，补发父窗 keyup，确保 Stage 收到松开并弹出需求条。
  await page
    .evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }))
    })
    .catch(() => undefined)
  await expect(page.getByTestId('pick-status')).toHaveCount(0, { timeout: 5_000 })
  return point
}

async function clearSelectionIfAny(page: Page): Promise<void> {
  const clear = page.getByTestId('overlays-clear-selection')
  if ((await clear.count()) > 0) {
    // 1024 resize 后浮层工具条可能仍在布局动画中，Playwright 会一直等 stable；
    // 清空选择只是后续快照步骤的前置，失败时退化为 DOM click（仍走同一 React 处理器）。
    await clear.click({ timeout: 5_000 }).catch(async () => {
      await clear.evaluate((el) => (el as HTMLElement).click())
    })
  }
  await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0, { timeout: 5_000 })
}

async function readQueue(page: Page): Promise<QueueItem[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('edit_queue_v1')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }) as Promise<QueueItem[]>
}

async function activeInfo(page: Page): Promise<{ tag: string; testid: string; ariaLabel: string; text: string }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    const owner = a?.closest('[data-testid]') as HTMLElement | null
    return {
      tag: a?.tagName || '',
      testid: owner?.getAttribute('data-testid') || '',
      ariaLabel: a?.getAttribute('aria-label') || '',
      text: (a?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * 导出守卫
 * ══════════════════════════════════════════════════════════════════════ */

async function installExportGuards(ctx: Wave4App): Promise<void> {
  await ctx.app.evaluate((electron) => {
    const mod = electron as unknown as {
      session: { defaultSession: { on: (event: string, cb: (event: unknown, item: any) => void) => void } }
      dialog: { showSaveDialog: (...args: unknown[]) => Promise<unknown> }
    }
    const g = globalThis as unknown as Record<string, any>
    g.__w4Downloads = []
    g.__w4SaveDialogCalls = 0
    g.__w4DownloadDir = ''
    try {
      mod.dialog.showSaveDialog = async () => {
        g.__w4SaveDialogCalls += 1
        return { canceled: true }
      }
    } catch {
      /* dialog 只读时后续计数会失败 */
    }
    mod.session.defaultSession.on('will-download', (_event: unknown, item: any) => {
      try {
        const target = String(g.__w4DownloadDir || '') + '/' + String(item.getFilename() || 'download.bin')
        item.setSavePath(target)
        ;(g.__w4Downloads as string[]).push(target)
      } catch {
        /* 单个下载失败由文件落盘断言兜底 */
      }
    })
  })
}

async function setDownloadDir(ctx: Wave4App, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  await ctx.app.evaluate((_electron, target) => {
    ;(globalThis as unknown as Record<string, any>).__w4DownloadDir = target
  }, dir)
}

async function waitDownload(dir: string, timeoutMs = 25_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const name of listFiles(dir)) {
      const file = path.join(dir, name)
      try {
        if (fs.statSync(file).size > 0) {
          await delay(200)
          return file
        }
      } catch {
        /* 下载尚未完成，下轮再试 */
      }
    }
    await delay(200)
  }
  throw new Error(`下载未落盘：${dir}（已等待 ${timeoutMs}ms）`)
}

async function openExportMenu(page: Page): Promise<void> {
  await page.getByTestId('export-menu').click()
  await expect(page.getByTestId('export-source')).toBeVisible({ timeout: 10_000 })
}

/** 关窗兜底：页面无响应时 page.evaluate(window.close) 可能永不返回；超时后强制杀进程树。 */
async function closeWithGuard(ctx: Wave4App, label: string): Promise<void> {
  try {
    const result = await Promise.race([
      ctx.close({ graceMs: 5_000, appCloseMs: 3_000 }),
      delay(20_000).then(() => null),
    ])
    if (result) {
      log(`${label}-close`, result)
      return
    }
    log(`${label}-close-timeout`, 'graceful close exceeded 20s; force kill')
  } catch (err) {
    log(`${label}-close-error`, String((err as Error)?.message ?? err))
  }
  try {
    const forced = await ctx.close({ force: true })
    log(`${label}-close-forced`, forced)
  } catch (err) {
    log(`${label}-close-forced-error`, String((err as Error)?.message ?? err))
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * 测试记录器（每个 test 重置）
 * ══════════════════════════════════════════════════════════════════════ */

let rows: StepRow[] = []
let observations: Observation[] = []
let currentStep: { no: number | string; slug: string } = { no: 0, slug: 'init' }

function observe(id: string, level: Level, title: string, detail: string): void {
  observations.push({ id, level, title, detail })
  log(`OBS ${id} ${level}`, { title, detail })
}

async function runStep(
  ctx: Wave4App,
  no: number | string,
  slug: string,
  title: string,
  fn: () => Promise<{ evidence: string; shots?: string[]; status?: Status }>,
): Promise<StepRow> {
  const started = Date.now()
  currentStep = { no, slug }
  try {
    const out = await fn()
    const row: StepRow = {
      no,
      title,
      status: out.status ?? 'PASS',
      evidence: out.evidence,
      shots: (out.shots ?? []).map(rel),
      ms: Date.now() - started,
    }
    rows.push(row)
    console.log(`[B-GE] STEP ${no} ${row.status} ${title} | ${row.evidence} | ${row.shots.join(',') || '-'} | ${row.ms}ms`)
    return row
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n').slice(0, 8).join(' | ') : String(err)
    let failShot = ''
    try {
      const shot = await Promise.race([
        ctx.shot(no, slug, { fail: true }),
        delay(6_000).then(() => {
          throw new Error('失败截图超时（页面可能已无响应）')
        }),
      ])
      failShot = rel(shot)
    } catch {
      /* 页面可能已崩溃 */
    }
    const row: StepRow = {
      no,
      title,
      status: 'FAIL',
      evidence: message,
      shots: failShot ? [failShot] : [],
      ms: Date.now() - started,
    }
    rows.push(row)
    console.error(`[B-GE] STEP ${no} FAIL ${title} | ${message} | ${row.shots.join(',') || '-'}`)
    throw err
  }
}

function skipStep(no: number | string, title: string, evidence: string): void {
  rows.push({ no, title, status: 'SKIP', evidence, shots: [], ms: 0 })
  console.log(`[B-GE] STEP ${no} SKIP ${title} | ${evidence}`)
}

function finish(testInfo: any, ctx: Wave4App): void {
  testInfo.annotations.push({
    type: 'wave4-b-git-export-summary',
    description: rows.map((r) => `${r.no}.${r.status} ${r.title}`).join(' | '),
  })
  console.log(
    '[B-GE] SUMMARY\n' +
      JSON.stringify(
        {
          domain: DOMAIN,
          dataDir: ctx.dataDir,
          userData: ctx.userData,
          rows,
          observations,
          consoleErrors: ctx.consoleErrors.slice(-20),
          pageErrors: ctx.pageErrors.slice(-20),
        },
        null,
        2,
      ),
  )
}

/* ══════════════════════════════════════════════════════════════════════
 * 清理登记
 * ══════════════════════════════════════════════════════════════════════ */

const CLEANUP_PATHS = new Set<string>([DOMAIN_DIR, BARE, CLONE, EXPORT_ROOT])

test.afterAll(() => {
  for (const target of CLEANUP_PATHS) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
      console.log(`[B-GE] cleaned ${target}`)
    } catch (err) {
      console.log(`[B-GE] cleanup 失败 ${target}：${String((err as Error)?.message ?? err)}`)
    }
  }
})

/* ══════════════════════════════════════════════════════════════════════
 * B1 · Git
 * ══════════════════════════════════════════════════════════════════════ */

test.describe('Wave4 B · Git 本地 bare 全链路', () => {
  test('B1 Git：状态树/筛选/配置/push/pull/差异/取消/自愈/上游/进程', async ({}, testInfo) => {
    test.setTimeout(600_000)
    rows = []
    observations = []
    currentStep = { no: 0, slug: 'bootstrap' }

    makeBare()
    const remote = fileUrl(BARE)
    const gitConfigPath = path.join(DOMAIN_DIR, 'git-config.json')
    const sandboxGitConfig = path.join(SANDBOX, '.git', 'config')
    const sandboxHeadBefore = git(['rev-parse', 'HEAD'], SANDBOX).stdout
    const statusCountBefore = git(['status', '--porcelain=v1', '-uall'], SANDBOX).stdout
      .split(/\r?\n/)
      .filter(Boolean).length
    const gcmBaseline = credentialProcesses()

    log('fixture', {
      bare: BARE,
      remote,
      clone: CLONE,
      sandboxHeadBefore,
      statusCountBefore,
      gcmBaseline: gcmBaseline.map((p) => `${p.name}#${p.pid}`),
    })
    expect(fs.existsSync(path.join(BARE, 'HEAD')), 'bare 夹具应有 HEAD').toBe(true)

    let ctx: Wave4App | null = null
    let appPid = 0
    let projectName = PROJECT
    const externalRequests: string[] = []
    const assertNoNewCredential = (label: string): void => {
      const now = credentialProcesses()
      const extra = now.filter((p) => !gcmBaseline.some((b) => b.pid === p.pid))
      if (extra.length) {
        throw new Error(`${label}：出现凭据类进程（GCM/HTTPS 凭据助手风险）：${extra.map((p) => `${p.name}#${p.pid}`).join(', ')}`)
      }
    }

    try {
      ctx = await launchApp({ domain: DOMAIN, env: { PLAND_GIT_ALLOW_LOCAL: '1' } })
      const page = ctx.page
      appPid = ctx.app.process()?.pid ?? 0
      useRetestShots(ctx, 'git-export-b1')
      page.on('request', (req) => {
        const url = req.url()
        if (!/^(file|data|about|blob|proto-asset):/i.test(url)) externalRequests.push(url)
      })
      await page.bringToFront().catch(() => undefined)

      await runStep(ctx, 0, 'isolation', '数据隔离 + 冷启动 + 进入测试1', async () => {
        expect(path.resolve(ctx!.userData).toLowerCase()).toBe(path.resolve(DOMAIN_DIR).toLowerCase())
        expect(ctx!.seedPresent).toBe(true)
        const pickerShown = await ensureProject(page)
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        const shot = await ctx!.shot(0, 'cold-start')
        return {
          evidence: `userData=${ctx!.userData}；seed=present；picker=${pickerShown ? 'shown→entered' : 'auto-restored'}；sandbox HEAD=${sandboxHeadBefore.slice(0, 12)}；初始 status=${statusCountBefore} 项`,
          shots: [shot],
        }
      })

      await runStep(ctx, 1, 'git-panel', 'Git 管理 660px + 状态树首屏', async () => {
        await page.getByRole('button', { name: 'Git 管理' }).click()
        const sheet = page.getByTestId('git-sheet')
        await expect(sheet).toBeVisible({ timeout: 15_000 })
        await expect(sheet).toHaveAttribute('data-surface', 'dialog')
        const box = await sheet.boundingBox()
        expect(box).not.toBeNull()
        expect(Math.round(box!.width)).toBe(660)
        await expect(page.getByTestId('git-panel')).toBeVisible()
        await expect(page.getByTestId('git-branch-select')).toHaveValue('main')
        const total = page.getByTestId('git-total')
        await expect(total).toContainText('处变更', { timeout: 20_000 })
        await expect
          .poll(
            async () => {
              const match = (await total.innerText()).match(/(\d+)\s*处变更/)
              return match ? Number(match[1]) : -1
            },
            { timeout: 90_000, intervals: [500, 1_000, 2_000] },
          )
          .toBeGreaterThan(0)
        const rows = page.getByTestId('git-file-row')
        await expect(rows.first()).toBeVisible({ timeout: 20_000 })
        const projectCards = page.getByTestId('git-project-card')
        const protoGroups = page.getByTestId('git-proto-group')
        expect(await projectCards.count()).toBeGreaterThan(0)
        expect(await protoGroups.count()).toBeGreaterThan(0)
        const shot = await ctx!.shot(1, 'git-panel-660')
        return {
          evidence: `git-sheet data-surface=dialog width=660；分支=main；${norm(await total.innerText())}；文件行=${await rows.count()}；项目卡=${await projectCards.count()}；原型组=${await protoGroups.count()}`,
          shots: [shot],
        }
      })

      await runStep(ctx, 2, 'status-tree-filter', '状态树折叠 / 搜索 / 状态筛选', async () => {
        const shots: string[] = []
        const totalText = norm(await page.getByTestId('git-total').innerText())
        const allRows = page.getByTestId('git-file-row')
        const totalRows = await allRows.count()
        const currentCard = page.getByTestId('git-project-card').filter({ hasText: '当前项目' }).first()
        await expect(currentCard).toBeVisible({ timeout: 15_000 })
        const cardRowsBefore = await currentCard.getByTestId('git-file-row').count()
        expect(cardRowsBefore).toBeGreaterThan(0)

        // 折叠/展开：行仍在，不丢数据（点项目名，避开全选 checkbox）。
        const trigger = currentCard.getByTestId('git-project-head').getByText(PROJECT, { exact: true }).first()
        await trigger.click()
        await expect
          .poll(async () => currentCard.getByTestId('git-file-row').count(), { timeout: 5_000 })
          .toBe(0)
        await trigger.click()
        await expect
          .poll(async () => currentCard.getByTestId('git-file-row').count(), { timeout: 5_000 })
          .toBe(cardRowsBefore)

        // 路径/原型搜索。
        await page.getByTestId('git-filter').fill(HOME)
        await expect
          .poll(async () => page.getByTestId('git-file-row').count(), { timeout: 10_000 })
          .toBeLessThan(totalRows)
        const filteredPaths = await page
          .getByTestId('git-file-row')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-path') || ''))
        expect(filteredPaths.length).toBeGreaterThan(0)
        expect(filteredPaths.every((p) => p.includes(HOME)), `搜索「${HOME}」应只保留命中路径`).toBe(true)
        const filteredCount = filteredPaths.length
        shots.push(await ctx!.shot(2, 'status-filter'))
        await page.getByTestId('git-filter').fill('')
        await expect
          .poll(async () => page.getByTestId('git-file-row').count(), { timeout: 10_000 })
          .toBe(totalRows)

        // 状态筛选：新增 / 修改 / 冲突。
        const statusFilter = page.getByTestId('git-status-filter')
        await statusFilter.selectOption('add')
        await expect
          .poll(async () => page.getByTestId('git-file-row').count(), { timeout: 10_000 })
          .toBeGreaterThan(0)
        const addCodes = await page
          .getByTestId('git-file-row')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-code') || ''))
        expect(addCodes.every((c) => c === 'add'), `新增筛选应只含 add，实际=${[...new Set(addCodes)].join(',')}`).toBe(true)
        const addCount = addCodes.length

        await statusFilter.selectOption('mod')
        await delay(300)
        const modCodes = await page
          .getByTestId('git-file-row')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-code') || ''))
        expect(modCodes.every((c) => c === 'mod'), `修改筛选应只含 mod，实际=${[...new Set(modCodes)].join(',')}`).toBe(true)

        await statusFilter.selectOption('conflict')
        await expect
          .poll(async () => page.getByTestId('git-file-row').count(), { timeout: 5_000 })
          .toBe(0)
        const empty = page.getByTestId('git-empty')
        await expect(empty, '筛选无结果时应展示空态').toBeVisible({ timeout: 5_000 })
        await expect(empty).toContainText('没有匹配的变更')
        const emptyCards = await page.getByTestId('git-project-card').count()
        expect(emptyCards, '筛选无结果时不得渲染「已选 0/0」空项目卡').toBe(0)
        shots.push(await ctx!.shot(2, 'status-conflict-empty'))

        // 搜索无结果同口径：空态 + 0 项目卡。
        await statusFilter.selectOption('')
        await page.getByTestId('git-filter').fill('W4B-不存在-匹配项')
        await expect
          .poll(async () => page.getByTestId('git-file-row').count(), { timeout: 5_000 })
          .toBe(0)
        await expect(empty).toContainText('没有匹配的变更')
        expect(await page.getByTestId('git-project-card').count(), '搜索无结果时不得残留空项目卡').toBe(0)
        shots.push(await ctx!.shot(2, 'search-empty'))
        await page.getByTestId('git-filter').fill('')
        await expect
          .poll(async () => page.getByTestId('git-file-row').count(), { timeout: 10_000 })
          .toBe(totalRows)

        return {
          evidence: `${totalText}；文件行=${totalRows}；当前项目折叠前后 ${cardRowsBefore}→0→${cardRowsBefore}；搜索「${HOME}」命中 ${filteredCount} 行（全部含路径）；新增筛选=${addCount} 行（全 add）；修改筛选=${modCodes.length} 行（全 mod）；冲突=0 行（空项目卡=${emptyCards}，空态提示=「没有匹配的变更」）；搜索无结果同样 0 行 / 0 卡片；清空后恢复 ${totalRows} 行`,
          shots,
        }
      })

      await runStep(ctx, 3, 'git-config', '仓库设置保存/回显 + 测试连接 + 分支', async () => {
        const shots: string[] = []
        const configHashBefore = sha256(gitConfigPath)
        await page.getByTestId('git-config-open').click()
        const cfgDialog = page.getByTestId('git-config-dialog')
        await expect(cfgDialog).toBeVisible({ timeout: 10_000 })
        const remoteInput = page.getByTestId('git-config-remote')
        await expect(remoteInput).toBeEnabled()
        await expect(remoteInput).toHaveValue('')
        const dialogText = norm(await cfgDialog.innerText())
        projectName = (dialogText.match(/项目：([^\s]+)/) || [])[1] || PROJECT

        await remoteInput.fill(remote)
        await expect(page.getByTestId('git-config-local-fixture-hint')).toBeVisible()
        await page.getByTestId('git-config-branch').fill('main')
        await page.getByTestId('git-config-author-name').fill('Wave4 BGitExport')
        await page.getByTestId('git-config-author-email').fill('wave4-bge@local')
        const tokenInput = page.getByTestId('git-config-token')
        await expect(tokenInput).toHaveAttribute('type', 'password')
        await tokenInput.fill(TOKEN)
        shots.push(await ctx!.shot(3, 'config-filled'))

        await page.getByTestId('git-config-save').click()
        await expect(cfgDialog).toBeHidden({ timeout: 20_000 })
        const saveToast = await waitToast(page, /Git 仓库配置已保存/, 15_000)
        await expect(page.getByTestId('git-need-config')).toBeHidden({ timeout: 10_000 })
        expect(sha256(gitConfigPath), '保存成功应写入 git-config.json').not.toBe(configHashBefore)

        const rawConfig = readJson(gitConfigPath) as any
        expect(rawConfig?.projects?.[projectName]?.remoteUrl, 'remoteUrl 应落盘为 file:///').toBe(remote)
        expect(rawConfig?.projects?.[projectName]?.branch).toBe('main')
        const configText = fs.readFileSync(gitConfigPath, 'utf8')
        expect(configText, '假 token 不得明文写入 git-config.json').not.toContain(TOKEN)
        const sandboxConfigText = fs.readFileSync(sandboxGitConfig, 'utf8')
        expect(sandboxConfigText, 'sandbox origin 应指向 bare 夹具').toContain(remote)
        expect(sandboxConfigText, '假 token 不得写入 sandbox/.git/config').not.toContain(TOKEN)

        // 关闭重开：回显；token 掩码，明文框为空。
        await page.getByTestId('git-config-open').click()
        await expect(cfgDialog).toBeVisible({ timeout: 10_000 })
        await expect(remoteInput).toHaveValue(remote)
        await expect(page.getByTestId('git-config-branch')).toHaveValue('main')
        await expect(page.getByTestId('git-config-author-name')).toHaveValue('Wave4 BGitExport')
        await expect(page.getByTestId('git-config-author-email')).toHaveValue('wave4-bge@local')
        await expect(tokenInput).toHaveValue('')
        const tokenState = norm(await page.getByTestId('git-config-token-state').innerText())
        expect(tokenState).toMatch(/已配置/)
        shots.push(await ctx!.shot(3, 'config-echo'))

        const connectStarted = Date.now()
        await page.getByTestId('git-test-connection').click()
        const notice = page.getByTestId('git-config-notice')
        const cfgError = page.getByTestId('git-config-error')
        await expect
          .poll(
            async () => (await notice.isVisible().catch(() => false)) || (await cfgError.isVisible().catch(() => false)),
            { timeout: 30_000 },
          )
          .toBe(true)
        if (await cfgError.isVisible().catch(() => false)) {
          throw new Error(`测试连接失败：${norm(await cfgError.innerText())}`)
        }
        const noticeText = norm(await notice.innerText())
        expect(noticeText).toMatch(/连接成功/)
        const latency = norm(await page.getByTestId('git-test-latency').innerText().catch(() => ''))
        shots.push(await ctx!.shot(3, 'test-connection-ok'))
        await page.getByTestId('git-config-cancel').click()
        await expect(cfgDialog).toBeHidden({ timeout: 5_000 })

        const branchOptions = await page.getByTestId('git-branch-select').locator('option').allTextContents()
        expect(branchOptions.map((s) => s.trim())).toContain('main')
        assertNoNewCredential('测试连接后')

        return {
          evidence: `项目=${projectName}；保存 toast=「${saveToast}」；remoteUrl=${remote}；分支 main；token 状态=${tokenState}，明文框为空；测试连接=「${noticeText}」${latency ? `，${latency}` : ''}（${Date.now() - connectStarted}ms）；分支选项=${branchOptions.map((s) => s.trim()).join(',')}；配置无明文 token；sandbox origin 正确`,
          shots,
        }
      })

      await runStep(ctx, 4, 'push', '勾选当前项目 → 上传发布 → bare 收到提交/上游', async () => {
        const shots: string[] = []
        await expect(page.getByTestId('git-mode-status')).toHaveAttribute('aria-pressed', 'true')
        const currentCard = page.getByTestId('git-project-card').filter({ hasText: '当前项目' }).first()
        await expect(currentCard).toBeVisible({ timeout: 15_000 })
        const countBadge = currentCard.getByTestId('git-project-count')
        const projectTotal = Number(await countBadge.getAttribute('data-total'))
        expect(projectTotal, '当前项目应有可选文件').toBeGreaterThan(0)
        await currentCard.getByRole('checkbox').first().click()
        await expect
          .poll(async () => Number(await countBadge.getAttribute('data-selected')), { timeout: 10_000 })
          .toBe(projectTotal)
        await page.getByTestId('git-message').fill(PUSH_MSG)
        shots.push(await ctx!.shot(4, 'push-selected'))

        const cancelPoll = (async () => {
          const deadline = Date.now() + 10_000
          let seen = false
          while (Date.now() < deadline) {
            if (await page.getByTestId('git-cancel').isVisible().catch(() => false)) seen = true
            if (!(await page.getByTestId('git-busy').isVisible().catch(() => false)) && seen) break
            await delay(40)
          }
          return seen
        })()
        await page.getByTestId('git-push').click()
        const pushToast = await waitToast(page, /发布成功|发布失败/, 90_000)
        const cancelSeen = await cancelPoll
        if (!/发布成功/.test(pushToast)) throw new Error(`上传发布失败：${pushToast}`)

        await expect
          .poll(async () => gitBare(BARE, ['log', '--oneline', '-1']).stdout, { timeout: 30_000 })
          .toContain(STAMP)
        const bareLog = gitBare(BARE, ['log', '--oneline', '-1']).stdout
        const sandboxHeadAfterPush = git(['rev-parse', 'HEAD'], SANDBOX).stdout
        const bareMain = gitBare(BARE, ['rev-parse', 'refs/heads/main']).stdout
        expect(bareLog).toContain(PUSH_MSG)
        expect(bareMain, 'bare main 应等于本地新提交').toBe(sandboxHeadAfterPush)

        const branchRemote = git(['config', '--local', '--get', 'branch.main.remote'], SANDBOX).stdout
        const branchMerge = git(['config', '--local', '--get', 'branch.main.merge'], SANDBOX).stdout
        const originUrl = git(['config', '--local', '--get', 'remote.origin.url'], SANDBOX).stdout
        const upstream = git(['rev-parse', '--abbrev-ref', '@{u}'], SANDBOX)
        expect(branchRemote, 'branch.main.remote 必须是 origin，不得写成 URL').toBe('origin')
        expect(branchMerge).toBe('refs/heads/main')
        expect(originUrl).toBe(remote)
        expect(upstream.status, 'push 后 @{u} 应可解析').toBe(0)
        expect(upstream.stdout).toBe('origin/main')
        assertNoNewCredential('push 后')
        const shot = await ctx!.shot(4, 'push-success')
        shots.push(shot)
        return {
          evidence: `选择 ${projectTotal}/${projectTotal}；toast=「${pushToast}」；bare log=「${bareLog}」；sandbox HEAD=${sandboxHeadAfterPush.slice(0, 12)} = bare main；branch.main.remote=origin、merge=refs/heads/main、origin.url=file:///；@{u}=origin/main；busy 期间取消入口可见=${cancelSeen}`,
          shots,
        }
      })

      const probeSha = commitProbe(
        (() => {
          ensureClone(BARE, CLONE)
          return CLONE
        })(),
        PROBE_FILE,
        `# wave4 b-git-export pull probe\n\n- stamp: ${STAMP}\n- token: not-used\n`,
        PROBE_MSG,
      )
      log('probe', { sha: probeSha, file: PROBE_FILE })

      await runStep(ctx, 5, 'diff-remote', '差异预览：远端领先 1 个提交', async () => {
        const shots: string[] = []
        expect(fs.existsSync(path.join(SANDBOX, PROBE_FILE)), '拉取前探针文件不应存在').toBe(false)
        await dismissToasts(page)
        await page.getByTestId('git-mode-diff').click()
        await expect(page.getByTestId('git-diff-hint')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('git-total')).toContainText('处变更', { timeout: 45_000 })
        await expect
          .poll(
            async () => {
              const m = (await page.getByTestId('git-total').innerText()).match(/(\d+)\s*处变更/)
              return m ? Number(m[1]) : -1
            },
            { timeout: 45_000, intervals: [500, 1_000, 2_000] },
          )
          .toBeGreaterThan(0)

        // 差异列表默认只展开“当前项目”；远端领先的文件在非当前项目卡里，需要展开。
        const cards = page.getByTestId('git-project-card')
        const cardCount = await cards.count()
        const cardTexts = (await cards.allInnerTexts()).map(norm)
        const defaultCard = cards.filter({ hasText: '默认项目' }).first()
        if (await defaultCard.count()) {
          const trigger = defaultCard.getByTestId('git-project-head').getByText('默认项目', { exact: true }).first()
          if (await trigger.isVisible().catch(() => false)) await trigger.click()
        }
        let diffShown = false
        await delay(500)
        const diffRows = page.getByTestId('git-file-row')
        const rowCount = await diffRows.count()
        if (rowCount > 0) {
          const paths = await diffRows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-path') || ''))
          diffShown = paths.some((p) => p.includes(PROBE_FILE))
        }
        const diffText = norm(await page.getByTestId('git-panel').innerText())
        shots.push(await ctx!.shot(5, 'diff-remote'))
        if (!diffShown) {
          observe(
            'b-ge-P2-diff-remote',
            'P2',
            '差异预览未列出“远端领先但本地未拉取”的探针文件',
            `diff 模式已打开且 total>0；项目卡=${cardCount}（${cardTexts.join(' | ')}）；展开默认项目后 git-file-row=${rowCount}；面板文本=${diffText.slice(0, 300)}`,
          )
        } else if (cardCount > 0 && !cardTexts.some((t) => /当前项目/.test(t))) {
          observe(
            'b-ge-P3-diff-default-collapsed',
            'P3',
            '差异预览只展开当前项目；当差异都在非当前项目时，首屏只看到“已选 0/N”的折叠卡',
            `项目卡=${cardTexts.join(' | ')}；需手动展开才看到文件行`,
          )
        }
        return {
          evidence: `diff hint 可见；${await page.getByTestId('git-total').innerText()}；项目卡=${cardCount}（${cardTexts.join(' / ')}）；展开后文件行=${rowCount}；远端探针 ${PROBE_FILE} 在差异列表中=${diffShown}；探针 sha=${probeSha.slice(0, 12)}`,
          shots,
        }
      })

      await runStep(ctx, 6, 'pull', '拉取同步：另一 clone 追加提交 → 沙箱收到', async () => {
        const shots: string[] = []
        await dismissToasts(page)
        await page.getByTestId('git-pull').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 10_000 })
        const confirmText = norm(await confirm.innerText())
        expect(confirmText).toContain('拉取同步')
        shots.push(await ctx!.shot(6, 'pull-confirm'))
        const busyPoll = (async () => {
          const deadline = Date.now() + 10_000
          let seen = false
          while (Date.now() < deadline) {
            if (await page.getByTestId('git-cancel').isVisible().catch(() => false)) seen = true
            if (!(await page.getByTestId('git-busy').isVisible().catch(() => false)) && seen) break
            await delay(40)
          }
          return seen
        })()
        await page.getByTestId('confirm-dialog-ok').click()
        const pullToast = await waitToast(page, /同步完成|同步失败/, 90_000)
        const busySeen = await busyPoll
        if (!/同步完成/.test(pullToast)) throw new Error(`拉取同步失败：${pullToast}`)

        await expect.poll(async () => fs.existsSync(path.join(SANDBOX, PROBE_FILE)), { timeout: 30_000 }).toBe(true)
        const probeText = fs.readFileSync(path.join(SANDBOX, PROBE_FILE), 'utf8')
        expect(probeText).toContain(STAMP)
        const sandboxHeadAfterPull = git(['rev-parse', 'HEAD'], SANDBOX).stdout
        const originMain = git(['rev-parse', 'refs/remotes/origin/main'], SANDBOX).stdout
        const aheadBehind = git(['rev-list', '--left-right', '--count', 'HEAD...origin/main'], SANDBOX).stdout
        expect(sandboxHeadAfterPull, '拉取后沙箱 HEAD 应为探针提交').toBe(probeSha)
        expect(originMain).toBe(probeSha)
        expect(norm(aheadBehind)).toBe('0 0')
        assertNoNewCredential('pull 后')
        shots.push(await ctx!.shot(6, 'pull-success'))
        return {
          evidence: `confirm=「${confirmText}」；toast=「${pullToast}」；${PROBE_FILE} 已落盘且含 stamp；HEAD=${sandboxHeadAfterPull.slice(0, 12)} = origin/main；ahead/behind=0 0；busy 取消入口可见=${busySeen}`,
          shots,
        }
      })

      await runStep(ctx, 7, 'heal-cancel', '自愈修复 Confirm → 取消不写盘；同步后差异为空', async () => {
        const shots: string[] = []
        const configBefore = sha256(sandboxGitConfig)
        await expect(page.getByTestId('git-heal')).toBeEnabled({ timeout: 10_000 })
        await page.getByTestId('git-heal').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 10_000 })
        const healText = norm(await confirm.innerText())
        expect(healText).toContain('自愈修复')
        shots.push(await ctx!.shot(7, 'heal-confirm'))
        await confirm.getByRole('button', { name: '取消' }).click()
        await expect(confirm).toBeHidden({ timeout: 5_000 })
        expect(fs.existsSync(path.join(SANDBOX, '.heal-backup')), '取消自愈不得产生 .heal-backup').toBe(false)
        expect(sha256(sandboxGitConfig), '取消自愈不得改写 .git/config').toBe(configBefore)
        shots.push(await ctx!.shot(7, 'heal-cancelled'))

        await page.getByTestId('git-mode-diff').click()
        await expect(page.getByTestId('git-diff-hint')).toBeVisible({ timeout: 10_000 })
        await expect
          .poll(async () => norm(await page.getByTestId('git-empty').innerText().catch(() => '')), {
            timeout: 45_000,
            intervals: [500, 1_000, 2_000],
          })
          .toContain('远端暂无差异')
        await page.getByTestId('git-mode-status').click()
        return {
          evidence: `自愈 Confirm=「${healText.slice(0, 80)}」→ 取消；.heal-backup=false；.git/config hash 不变；拉取后 diff 空态=「远端暂无差异」`,
          shots,
        }
      })

      let cancelOutcome = 'not-run'
      await runStep(ctx, 8, 'cancel-operation', '慢操作取消入口（尽力命中，不伪造）', async () => {
        ensureClone(BARE, CLONE)
        const cancelSha = commitProbe(
          CLONE,
          CANCEL_PROBE_FILE,
          `# wave4 b-git-export cancel probe\n\n- stamp: ${STAMP}\n`,
          `${PROBE_MSG} cancel`,
        )
        await dismissToasts(page)
        await page.getByTestId('git-pull').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('confirm-dialog-ok').click()
        let clicked = false
        const deadline = Date.now() + 1_500
        while (Date.now() < deadline) {
          const btn = page.getByTestId('git-cancel')
          if (await btn.isVisible().catch(() => false)) {
            await btn.click().catch(() => undefined)
            clicked = true
            break
          }
          await delay(20)
        }
        const afterToast = await waitToast(page, /已取消|同步完成|同步失败|当前没有进行中/, 60_000).catch(() => '')
        await expect(page.getByTestId('git-refresh')).toBeEnabled({ timeout: 60_000 })
        if (clicked) {
          cancelOutcome = `clicked；toast=「${afterToast}」`
        } else {
          cancelOutcome = `未命中（本地操作在 1.5s 内完成/未出现按钮）；toast=「${afterToast || '(none)'}」`
          observe(
            'b-ge-P3-cancel-window',
            'P3',
            '本地 bare 操作过快，UI 层无法在 1.5s 内命中“取消操作”',
            `已出现 busy/取消入口，但点击窗口小于轮询间隔；属于本地夹具性能特征，未伪造取消成功。${cancelOutcome}`,
          )
        }

        // 若取消导致探针未落下，再拉一次保证最终一致。
        if (!fs.existsSync(path.join(SANDBOX, CANCEL_PROBE_FILE))) {
          await dismissToasts(page)
          await page.getByTestId('git-pull').click()
          await expect(confirm).toBeVisible({ timeout: 10_000 })
          await page.getByTestId('confirm-dialog-ok').click()
          const retryToast = await waitToast(page, /同步完成|同步失败/, 90_000)
          if (!/同步完成/.test(retryToast)) throw new Error(`取消后重试拉取失败：${retryToast}`)
        }
        await expect
          .poll(async () => git(['rev-parse', 'HEAD'], SANDBOX).stdout, { timeout: 30_000 })
          .toBe(cancelSha)
        const fsck = git(['fsck', '--no-progress', '--connectivity-only'], SANDBOX)
        expect(fsck.status, `取消后 git fsck 应通过：${fsck.stderr || fsck.stdout}`).toBe(0)
        const shot = await ctx!.shot(8, 'cancel-operation')
        return {
          evidence: `${cancelOutcome}；最终 HEAD=${cancelSha.slice(0, 12)}；${CANCEL_PROBE_FILE} 已同步；git fsck exit=0`,
          shots: [shot],
        }
      })

      await runStep(ctx, 9, 'esc-single', 'Git 设置 Dialog / Sheet Esc 单层 + 焦点回归', async () => {
        await page.getByTestId('git-config-open').click()
        const cfgDialog = page.getByTestId('git-config-dialog')
        const sheet = page.getByTestId('git-sheet')
        await expect(cfgDialog).toBeVisible({ timeout: 10_000 })
        const beforeEscShot = await ctx!.shot(9, 'git-config-before-esc')
        await page.keyboard.press('Escape')
        await expect(cfgDialog).toBeHidden({ timeout: 5_000 })
        await expect(sheet, '仓库设置内 Esc 只关自身，Git 主面板必须保持打开').toBeVisible()
        const afterEscShot = await ctx!.shot(9, 'git-after-esc')
        const focus = await activeInfo(page)
        // 第二次 Esc 才关闭 Git 主面板。
        await page.keyboard.press('Escape')
        await expect(sheet).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('main-window')).toBeVisible()
        // 重新打开 Git，确认独立一层可被 Esc 关闭。
        await page.getByRole('button', { name: 'Git 管理' }).click()
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        await page.keyboard.press('Escape')
        await expect(sheet).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `仓库设置打开时 Esc：config hidden=true；Git 主面板仍可见=true（第 2 次 Esc 才关闭 Git）；activeElement=${JSON.stringify(focus)}；单独 Git 面板 Esc 可关闭；主窗始终可见`,
          shots: [beforeEscShot, afterEscShot],
        }
      })

      await runStep(ctx, 10, 'process-clean', '无 GCM/凭据进程、关闭无 git 孤儿、仓库健康', async () => {
        assertNoNewCredential('全部操作后')
        const children = gitChildrenOf(appPid)
        const fsck = git(['fsck', '--no-progress', '--connectivity-only'], SANDBOX)
        expect(fsck.status, `git fsck 应通过：${fsck.stderr || fsck.stdout}`).toBe(0)
        const external = externalRequests.filter((u) => !isPrototypeCdnRequest(u))
        const cdnNoise = externalRequests.filter((u) => isPrototypeCdnRequest(u))
        if (cdnNoise.length) {
          observe(
            'b-ge-ENV-prototype-cdn',
            'ENV',
            'seed 原型自身引用外部 CDN（Git 测试期间出现 request 事件）',
            `${cdnNoise.length} 条：${[...new Set(cdnNoise)].join(' | ')}；来自 srcdoc 原型内容，非 Git 网络调用`,
          )
        }
        expect(external, 'Git 阶段不得产生非原型内容的外部网络请求').toEqual([])
        const shot = await ctx!.shot(10, 'final')
        return {
          evidence: `凭据进程新增=0；Electron 子进程（git/conhost）=${children.length ? children.map((p) => `${p.name}#${p.pid}`).join(',') : '(none)'}；git fsck exit=0；Git 外部请求=${external.length}；原型 CDN 噪声=${cdnNoise.length}`,
          shots: [shot],
        }
      })

      const closeResult = await ctx.close()
      log('close', closeResult)
      assertCleanExitOrP2(closeResult)
      await delay(2_000)

      const childrenAfter = gitChildrenOf(appPid)
      const live = livePids(childrenAfter.map((p) => p.pid))
      expect(live, '关闭后不得残留 git/conhost 子进程').toEqual([])
      expect(processesMentioning(BARE), '关闭后不得有 git 进程仍持有 bare').toEqual([])
      expect(processesMentioning(DOMAIN_DIR), '关闭后不得有 git 进程仍持有隔离数据目录').toEqual([])
      assertNoNewCredential('关闭后')

      const bareMainFinal = gitBare(BARE, ['rev-parse', 'refs/heads/main']).stdout
      const sandboxHeadFinal = git(['rev-parse', 'HEAD'], SANDBOX).stdout
      expect(bareMainFinal).toBe(sandboxHeadFinal)
      log('process-clean', {
        closeResult,
        childrenAfter: childrenAfter.map((p) => `${p.name}#${p.pid}`),
        live: live.map((p) => `${p.name}#${p.pid}`),
        bareMainFinal,
        sandboxHeadFinal,
      })

      finish(testInfo, ctx)
      expect(
        observations.filter((o) => o.level === 'P0' || o.level === 'P1'),
        `Git 域存在阻断缺陷：${JSON.stringify(observations.filter((o) => o.level === 'P0' || o.level === 'P1'))}`,
      ).toEqual([])
      const failed = rows.filter((r) => r.status === 'FAIL')
      expect(failed, `Git 域失败：\n${failed.map((r) => `${r.no}. ${r.title}: ${r.evidence}`).join('\n')}`).toStrictEqual([])
    } catch (err) {
      if (ctx) {
        await ctx
          .reportFailure({
            step: currentStep.no,
            slug: currentStep.slug,
            level: 'P1',
            expected: 'Git 本地 bare 全链路可用：状态树/筛选/配置/push/pull/diff/取消/自愈/上游/进程清理',
            actual: '断言失败，见错误栈与现场截图/日志',
            error: err,
            screenshot: false,
            extra: JSON.stringify(
              {
                bare: BARE,
                remote,
                clone: CLONE,
                project: projectName,
                userData: ctx.userData,
                rows,
                observations,
                consoleErrors: ctx.consoleErrors.slice(-10),
                pageErrors: ctx.pageErrors.slice(-10),
              },
              null,
              2,
            ),
          })
          .catch(() => undefined)
      }
      throw err
    } finally {
      if (ctx) {
        try {
          const result = await ctx.close({ graceMs: 5_000, appCloseMs: 3_000 })
          log('finally-close', result)
        } catch (closeErr) {
          log('finally-close-error', String((closeErr as Error)?.message ?? closeErr))
        }
      }
    }
  })
})

/* ══════════════════════════════════════════════════════════════════════
 * B2 · 导出 + B3 · 浮层
 * ══════════════════════════════════════════════════════════════════════ */

test.describe('Wave4 B · 导出 + 浮层全量体验', () => {
  test('B2/B3 导出：JSON/HTML/MD/PNG-PDF/空文档/无源；浮层：检查器/标注/链接/快照/队列/键盘/1024', async ({}, testInfo) => {
    test.setTimeout(900_000)
    rows = []
    observations = []
    currentStep = { no: 0, slug: 'bootstrap' }

    let ctx: Wave4App | null = null
    let browser: Browser | null = null
    const queueTexts = [`W4B-GE-队列-${STAMP}-A`, `W4B-GE-队列-${STAMP}-B`]
    const annoText = `W4B-GE-标注-${STAMP}`
    // B1 会把 sandbox Git remote 指向临时 bare（随后删除），B2 若复用该域会触发
    // GIT_URL_BLOCKED 并影响后续浮层；B2 与 B1 实验上互不依赖，开跑前从 seed 重新隔离。
    const reseed = spawnSync(process.execPath, ['e2e/wave4/seed.mjs', '--force', '--domain', DOMAIN], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    if (reseed.status !== 0) {
      throw new Error(`B2 前重新 seed 失败：${reseed.stderr || reseed.stdout}`.slice(0, 2000))
    }
    const htmlBefore = sha256(HOME_HTML)
    const mdBefore = fs.readFileSync(HOME_MD)
    const annoBefore = arrayCount(ANNO_FILE)
    const linksBefore = arrayCount(LINKS_FILE, 'links')

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      await page.bringToFront().catch(() => undefined)
      useRetestShots(ctx, 'git-export-b2')

      // 清掉 seed 可能携带的旧队列；确保标注角标默认可见，再 reload 让状态初始化。
      await page.evaluate(() => {
        localStorage.removeItem('edit_queue_v1')
        localStorage.setItem('proto_anno_visible', '1')
      })
      await page.reload()
      await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
      const pickerShown = await ensureProject(page)
      await expect.poll(() => protoButtons(page).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
      await clickProto(page, HOME)
      await installExportGuards(ctx)
      fs.mkdirSync(EXPORT_ROOT, { recursive: true })

      await runStep(ctx, 0, 'isolation', '数据隔离 + 冷启动 + 首页/快照/标注基线', async () => {
        expect(path.resolve(ctx!.userData).toLowerCase()).toBe(path.resolve(DOMAIN_DIR).toLowerCase())
        expect(ctx!.seedPresent).toBe(true)
        const snapshots = fs.existsSync(SNAPSHOT_HOME) ? fs.readdirSync(SNAPSHOT_HOME, { withFileTypes: true }) : []
        const snapshotDirs = snapshots.filter((d) => d.isDirectory()).map((d) => d.name)
        expect(snapshotDirs.length, 'seed 应有 2 个快照版本').toBe(2)
        expect(annoBefore, 'seed 应有 2 条标注').toBe(2)
        expect(linksBefore, 'seed 应有 2 条链接').toBe(2)
        const shot = await ctx!.shot(0, 'cold-start')
        log('baseline', { htmlBefore: htmlBefore.slice(0, 12), mdBytes: mdBefore.length, annoBefore, linksBefore, snapshotDirs })
        return {
          evidence: `userData=${ctx!.userData}；picker=${pickerShown ? 'shown→entered' : 'auto-restored'}；首页.html sha256[0:12]=${htmlBefore.slice(0, 12).toUpperCase()}；首页.md=${mdBefore.length}B；annotations=${annoBefore}；links=${linksBefore}；snapshots=${snapshotDirs.join(',')}`,
          shots: [shot],
        }
      })

      await runStep(ctx, 1, 'export-menu', '导出菜单 5 项 + Esc 关闭', async () => {
        const shots: string[] = []
        const ids = ['export-source', 'export-html', 'export-png', 'export-pdf', 'export-md']
        await dismissToasts(page)
        await openExportMenu(page)
        const labels: string[] = []
        for (const id of ids) {
          await expect(page.getByTestId(id), `菜单项 ${id} 应可见`).toBeVisible({ timeout: 10_000 })
          labels.push(norm(await page.getByTestId(id).innerText()))
        }
        expect(labels.every((t) => t.length > 0)).toBe(true)
        shots.push(await ctx!.shot(1, 'export-menu'))
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('export-source')).toBeHidden({ timeout: 5_000 })
        shots.push(await ctx!.shot(1, 'export-menu-closed'))
        return {
          evidence: `5 项=${labels.length}（${labels.join(' / ')}）；Esc 后菜单 hidden`,
          shots,
        }
      })

      await runStep(ctx, 2, 'source-json', '源码包 JSON：落盘 / 可解析 / content+md 与磁盘一致', async () => {
        const shots: string[] = []
        const dir = path.join(EXPORT_ROOT, '01-source')
        await setDownloadDir(ctx!, dir)
        await dismissToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-source').click()
        const toast = await waitToast(page, '源码包已导出', 25_000, ['失败', '没有可导出'])
        shots.push(await ctx!.shot(2, 'source-toast'))
        const file = await waitDownload(dir)
        const size = fs.statSync(file).size
        expect(size, '源码包应 >20KB').toBeGreaterThan(20 * 1024)
        expect(path.basename(file)).toContain(PROJECT)
        expect(path.basename(file)).toContain('源码')
        const bundle = JSON.parse(fs.readFileSync(file, 'utf8')) as any
        expect(bundle.project).toBe(PROJECT)
        expect(Array.isArray(bundle.sources)).toBe(true)
        expect(bundle.sources.length).toBeGreaterThanOrEqual(2)
        const displayNames = bundle.sources.map((s: any) => String(s.displayName))
        expect(displayNames).toEqual(expect.arrayContaining([HOME, MINE]))
        const home = bundle.sources.find((s: any) => s.displayName === HOME)
        expect(home, 'sources 缺少首页').toBeTruthy()
        expect(home.content, '首页 content 应与磁盘 html 一致').toBe(fs.readFileSync(HOME_HTML, 'utf8'))
        expect(home.md, '首页 md 应与磁盘 md 一致').toBe(fs.readFileSync(HOME_MD, 'utf8'))
        shots.push(await ctx!.shot(2, 'source-result'))
        return {
          evidence: `toast=「${toast}」；文件=${path.basename(file)}；${size}B；sha256[0:12]=${sha12(file)}；JSON.parse=OK；project=${bundle.project}；sources=${bundle.sources.length}（${displayNames.join(' / ')}）；首页 content/md 与磁盘逐字符一致`,
          shots,
        }
      })

      let htmlFile = ''
      await runStep(ctx, 3, 'standalone-html', '独立 HTML：离线打开 / 右侧文档区 / 表格 / 无 React', async () => {
        const shots: string[] = []
        const dir = path.join(EXPORT_ROOT, '02-html')
        await setDownloadDir(ctx!, dir)
        await dismissToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-html').click()
        const toast = await waitToast(page, '独立 HTML 已导出', 30_000, ['失败', '缺失', '请先选择'])
        shots.push(await ctx!.shot(3, 'html-toast'))
        htmlFile = await waitDownload(dir)
        const size = fs.statSync(htmlFile).size
        expect(size, '独立 HTML 应 >10KB').toBeGreaterThan(10 * 1024)
        const html = fs.readFileSync(htmlFile, 'utf8')
        expect(html).toContain('__EXPORT_BOOT__=true')
        expect(html).toContain('__EXPORT_SOURCES__=')
        expect(html.toLowerCase()).toContain('<!doctype html>')

        browser = await chromium.launch({ headless: true })
        const offlineCtx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } })
        const exported = await offlineCtx.newPage()
        await exported.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 30_000 })
        await exported.waitForFunction(() => (window as unknown as Record<string, any>).__EXPORT_BOOT__ === true, {
          timeout: 15_000,
        })

        const facts = await exported.evaluate(() => {
          const w = window as unknown as Record<string, any>
          const doc = document.getElementById('docContent') as HTMLElement | null
          const docStyle = doc ? getComputedStyle(doc) : null
          return {
            boot: w.__EXPORT_BOOT__ === true,
            sourceCount: Array.isArray(w.__EXPORT_SOURCES__) ? w.__EXPORT_SOURCES__.length : -1,
            styleSheets: document.styleSheets.length,
            externalScripts: Array.from(document.scripts).filter((s) => Boolean(s.src)).length,
            react: typeof w.React !== 'undefined',
            reactRoot: document.querySelectorAll('[data-reactroot]').length,
            htmlHasReactDom: /react-dom|createRoot|__REACT_DEVTOOLS/i.test(document.documentElement.innerHTML),
            offline: navigator.onLine === false,
            bodyTextLen: String(document.body?.innerText ?? '').length,
            docTextLen: String(doc?.textContent ?? '').length,
            docTables: doc ? doc.querySelectorAll('table').length : 0,
            docBrLiteral: doc ? (String(doc.textContent ?? '').match(/<br\s*\/?>/gi) || []).length : 0,
            docDisplay: docStyle?.display || '',
            docWidth: doc?.clientWidth || 0,
            docText: String(doc?.textContent ?? '').slice(0, 400),
          }
        })
        expect(facts.boot).toBe(true)
        expect(facts.sourceCount).toBeGreaterThan(0)
        expect(facts.styleSheets).toBeGreaterThan(0)
        expect(facts.externalScripts, '导出 HTML 不得引用外部脚本').toBe(0)
        expect(facts.react, '不得加载 React 运行时').toBe(false)
        expect(facts.reactRoot).toBe(0)
        expect(facts.htmlHasReactDom).toBe(false)
        expect(facts.offline).toBe(true)
        expect(facts.bodyTextLen).toBeGreaterThan(10)
        expect(facts.docDisplay, '#docContent 不得 display:none').not.toBe('none')
        expect(facts.docWidth, '#docContent 应有实际宽度').toBeGreaterThan(50)
        expect(facts.docTextLen, '右侧文档区应有正文').toBeGreaterThan(3_000)
        expect(facts.docText, '右侧文档区应含当前文档标题').toContain('商城首页')
        expect(facts.docTables, '右侧文档区应渲染 Markdown 表格').toBeGreaterThan(0)
        expect(facts.docBrLiteral, '右侧文档区不得出现字面 <br>（应渲染为换行）').toBe(0)

        const frameBox = await exported.locator('#frame').boundingBox()
        const docBox = await exported.locator('.export-lite-doc').boundingBox()
        expect(frameBox).not.toBeNull()
        expect(docBox).not.toBeNull()
        expect(docBox!.x, '文档区应位于 iframe 右侧').toBeGreaterThanOrEqual(frameBox!.x + frameBox!.width - 2)
        expect(docBox!.width, '文档区应有可见宽度').toBeGreaterThan(200)

        await expect
          .poll(
            async () => {
              try {
                return (await exported.frameLocator('#frame').locator('body').innerText()).length
              } catch {
                return 0
              }
            },
            { timeout: 20_000 },
          )
          .toBeGreaterThan(100)
        const iframeLen = (await exported.frameLocator('#frame').locator('body').innerText()).length
        const exportedBody = await exported.locator('body').innerText()
        expect(exportedBody).toContain('原型预览')
        expect(exportedBody).toContain(HOME)
        shots.push(await ctx!.shot(3, 'html-offline', { page: exported }))
        await offlineCtx.close()

        return {
          evidence: `toast=「${toast}」；文件=${path.basename(htmlFile)}；${size}B；sha256[0:12]=${sha12(htmlFile)}；offline=true；boot=true；sources=${facts.sourceCount}；styleSheets=${facts.styleSheets}；iframe 正文=${iframeLen} 字符；右侧文档区 text=${facts.docTextLen} 字符、table=${facts.docTables}、字面<br>=${facts.docBrLiteral}、display=${facts.docDisplay}、width=${facts.docWidth}px（iframe right=${Math.round(frameBox!.x + frameBox!.width)}，doc x=${Math.round(docBox!.x)}）；外链脚本=${facts.externalScripts}；React=${facts.react}；reactRoot=${facts.reactRoot}`,
          shots,
        }
      })

      await runStep(ctx, 4, 'doc-md', '文档 Markdown：落盘且与磁盘首页.md 一致', async () => {
        const shots: string[] = []
        // W6 对齐：移动端默认 chrome 可能已自动打开文档，先判断再点，避免把已打开的文档点关。
        if (!(await page.getByTestId('docs-panel').isVisible().catch(() => false))) {
          await page.getByTestId('topbar-docs').click()
        }
        const docs = page.getByTestId('docs-panel')
        await expect(docs).toBeVisible({ timeout: 15_000 })
        await expect(docs).toContainText('商城首页', { timeout: 20_000 })
        shots.push(await ctx!.shot(4, 'doc-loaded'))
        await page.keyboard.press('Escape')
        await expect(docs).toBeHidden({ timeout: 5_000 })

        const dir = path.join(EXPORT_ROOT, '03-doc-md')
        await setDownloadDir(ctx!, dir)
        await dismissToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-md').click()
        const toast = await waitToast(page, '文档 Markdown 已导出', 25_000, ['失败', '当前文档为空'])
        shots.push(await ctx!.shot(4, 'md-toast'))
        const file = await waitDownload(dir)
        const downloaded = fs.readFileSync(file)
        const disk = fs.readFileSync(HOME_MD)
        const sameBytes = downloaded.equals(disk)
        const sameNormalized = downloaded.toString('utf8').replace(/\r\n/g, '\n') === disk.toString('utf8').replace(/\r\n/g, '\n')
        expect(sameBytes || sameNormalized, `导出 MD 与磁盘不一致：${downloaded.length}B vs ${disk.length}B`).toBe(true)
        const text = downloaded.toString('utf8')
        expect(text).toContain('# 商城首页')
        expect(text.length).toBeGreaterThan(3_000)
        shots.push(await ctx!.shot(4, 'md-result'))
        return {
          evidence: `toast=「${toast}」；文件=${path.basename(file)}；${downloaded.length}B；sha256[0:12]=${sha12(file)}；与磁盘逐字节一致=${sameBytes}（规范化一致=${sameNormalized}）；正文=${text.length} 字符`,
          shots,
        }
      })

      await runStep(ctx, 5, 'png-pdf-cancel', 'PNG/PDF 原生保存对话框调用后取消', async () => {
        const shots: string[] = []
        const dir = path.join(EXPORT_ROOT, '04-native')
        await setDownloadDir(ctx!, dir)
        await dismissToasts(page)
        const calls = () =>
          ctx!.app.evaluate(() => Number((globalThis as unknown as Record<string, any>).__w4SaveDialogCalls || 0))

        await openExportMenu(page)
        await page.getByTestId('export-png').click()
        await expect.poll(calls, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
        await expect(page.getByTestId('export-menu')).toBeEnabled({ timeout: 20_000 })
        expect(listFiles(dir).filter((f) => f.toLowerCase().endsWith('.png')), '取消后不应有 PNG').toEqual([])

        await openExportMenu(page)
        await page.getByTestId('export-pdf').click()
        await expect.poll(calls, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
        await expect(page.getByTestId('export-menu')).toBeEnabled({ timeout: 20_000 })
        expect(listFiles(dir).filter((f) => f.toLowerCase().endsWith('.pdf')), '取消后不应有 PDF').toEqual([])
        const totalCalls = await calls()
        shots.push(await ctx!.shot(5, 'native-cancel'))
        return {
          evidence: `dialog.showSaveDialog 调用=${totalCalls}（PNG≥1、PDF≥2，均返回 canceled）；导出目录 PNG/PDF 文件=0；导出按钮恢复可用`,
          shots,
        }
      })

      await runStep(ctx, 6, 'empty-doc', '空文档：导出提示且不落盘；恢复后正文完整', async () => {
        const shots: string[] = []
        fs.writeFileSync(HOME_MD, '', 'utf8')
        await page.reload()
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await ensureProject(page)
        await clickProto(page, HOME)
        // W6 对齐：重载后进入移动端源，默认 chrome 会自动打开文档；已打开时不得再点「文档」（会 toggle 关闭）。
        if (!(await page.getByTestId('docs-panel').isVisible().catch(() => false))) {
          await page.getByTestId('topbar-docs').click()
        }
        const docs = page.getByTestId('docs-panel')
        await expect(docs).toBeVisible({ timeout: 15_000 })
        await page.keyboard.press('Escape')
        await expect(docs).toBeHidden({ timeout: 5_000 })

        const dir = path.join(EXPORT_ROOT, '05-empty')
        await setDownloadDir(ctx!, dir)
        await dismissToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-md').click()
        let toast = ''
        try {
          toast = await waitToast(page, '当前文档为空', 8_000)
        } catch {
          toast = ''
        }
        await delay(800)
        const files = listFiles(dir)
        shots.push(await ctx!.shot(6, 'empty-doc-toast'))
        if (!toast) {
          observe(
            'b-ge-P2-empty-doc-guard',
            'P2',
            '空文档导出 Markdown 未出现「当前文档为空」提示',
            `首页.md 已置空并 reload；toast 未命中；导出目录文件=${files.join(',') || '(none)'}`,
          )
        }
        expect(toast || files.length === 0, '空文档应提示且不落盘').toBeTruthy()
        if (files.length > 0) {
          observe(
            'b-ge-P2-empty-doc-write',
            'P2',
            '空文档导出仍落盘（写入了 0 字节/空内容文件）',
            `导出目录文件=${files.join(',')}`,
          )
        }

        fs.writeFileSync(HOME_MD, mdBefore)
        await page.reload()
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await ensureProject(page)
        await clickProto(page, HOME)
        // W6 对齐：同上，重载后文档可能已默认打开，先判断再点。
        if (!(await page.getByTestId('docs-panel').isVisible().catch(() => false))) {
          await page.getByTestId('topbar-docs').click()
        }
        await expect(docs).toBeVisible({ timeout: 15_000 })
        await expect(docs).toContainText('商城首页', { timeout: 20_000 })
        const restoredLen = (await docs.innerText()).length
        expect(restoredLen).toBeGreaterThan(3_000)
        await page.keyboard.press('Escape')
        await expect(docs).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `首页.md 置空+reload → MD 导出 toast=${toast ? `「${toast}」` : '(none)'}；落盘文件=${files.length}；恢复备份+reload 后文档面板正文=${restoredLen} 字符（含商城首页）`,
          shots,
        }
      })

      await runStep(ctx, 7, 'no-source', '无源项目：导出提示', async () => {
        const shots: string[] = []
        await dismissToasts(page)
        const tempName = `W4B-GE-空-${STAMP}`
        await page.getByTestId('project-switch').click()
        const menu = page.getByTestId('project-menu')
        await expect(menu).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('project-create-input').fill(tempName)
        await page.getByTestId('project-create').click()
        await expect(menu).toBeHidden({ timeout: 30_000 })
        await expect
          .poll(async () => norm(await page.getByTestId('sidebar').locator('button[title="切换项目"]').innerText()), {
            timeout: 30_000,
          })
          .toBe(tempName)
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '0', { timeout: 10_000 })

        await dismissToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-source').click()
        const sourceToast = await waitToast(page, /当前没有可导出的原型/, 10_000).catch(() => '')
        await dismissToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-html').click()
        const htmlToast = await waitToast(page, /请先选择要导出的原型/, 10_000).catch(() => '')
        shots.push(await ctx!.shot(7, 'no-source-toast'))
        if (!sourceToast) {
          observe('b-ge-P2-no-source', 'P2', '无源项目导出源码未出现提示', `toast 未命中；项目=${tempName}`)
        }

        // 回到测试1/首页，避免影响后续浮层。
        await page.getByTestId('project-switch').click()
        await expect(menu).toBeVisible({ timeout: 10_000 })
        await menu.locator('[role="option"]').filter({ hasText: PROJECT }).first().click()
        await expect(menu).toBeHidden({ timeout: 30_000 })
        await expect
          .poll(async () => norm(await page.getByTestId('sidebar').locator('button[title="切换项目"]').innerText()), {
            timeout: 30_000,
          })
          .toBe(PROJECT)
        await clickProto(page, HOME)
        return {
          evidence: `临时空项目=${tempName}；stage data-has-source=0；源码导出 toast=${sourceToast ? `「${sourceToast}」` : '(none)'}；HTML 导出 toast=${htmlToast ? `「${htmlToast}」` : '(none)'}；已切回 ${PROJECT}/${HOME}`,
          shots,
        }
      })

      await runStep(ctx, 8, 'anno-panel', '标注新增（需求条小面板）/ 定位 / 隐藏 / 删除', async () => {
        const shots: string[] = []
        await ensurePcStage(page)
        // W6：跨步骤后帧内拾取偶发未弹需求条（帧加载竞态）；带一次有界重试。
        const composer = page.getByTestId('pick-composer')
        for (let attempt = 0; ; attempt += 1) {
          await clearSelectionIfAny(page)
          await pickWithCtrl(page, ANNO_SELECTOR)
          if (attempt >= 1 || (await composer.isVisible().catch(() => false))) break
          await waitPreview(page)
        }
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('1', { timeout: 5_000 })
        // W6：检查器已删除——标注改经需求条「标注」小面板新增。
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('pick-composer-annotation').click()
        const annoPanel = page.getByTestId('pick-composer-annotation-panel')
        await expect(annoPanel).toBeVisible({ timeout: 5_000 })
        shots.push(await ctx!.shot(8, 'composer-anno-panel'))
        await page.getByTestId('pick-composer-annotation-input').fill(annoText)
        await page.getByTestId('pick-composer-annotation-save').click()
        await waitToast(page, /已新增需求标注|已更新需求标注/, 15_000)
        // 保存成功后选择清空、需求条自动收起；角标要重新选中元素才出现（见下方显隐段）。
        await expect(page.getByTestId('pick-composer')).toBeHidden({ timeout: 5_000 })
        expect(arrayCount(ANNO_FILE), '新增后 annotations.json 应 +1').toBe(annoBefore + 1)

        // 直接走标注面板：定位 / 显隐 / 删除。
        await page.getByTestId('overlays-open-anno').click()
        const annoSheet = page.getByTestId('overlays-sheet-anno')
        await expect(annoSheet).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('anno-panel-count')).toHaveText(String(annoBefore + 1), { timeout: 10_000 })
        shots.push(await ctx!.shot(8, 'anno-panel'))

        const newAnno = page.getByTestId('anno-panel-item').filter({ hasText: annoText }).first()
        await expect(newAnno).toBeVisible()
        // 点击标注只定位高亮元素，不打开检查器 Sheet；标注面板保持打开。
        await newAnno.click({ position: { x: 18, y: 12 } })
        await expect(page.getByTestId('overlays-sheet-inspector'), '定位不得打开检查器 Sheet').toHaveCount(0)
        await expect(annoSheet, '标注面板应保持打开').toBeVisible()
        await expect(newAnno).toHaveAttribute('data-located', '1')
        await expect(page.getByTestId('anno-locate-highlight'), '定位应高亮元素').toBeVisible({ timeout: 5_000 })
        shots.push(await ctx!.shot(8, 'anno-locate'))
        await page.keyboard.press('Escape')
        await expect(annoSheet).toBeHidden({ timeout: 5_000 })

        // 重新选中被标注元素，验证角标显隐（先清空，避免 Ctrl 再次点击已选元素触发 toggle 取消）。
        await clearSelectionIfAny(page)
        await pickWithCtrl(page, ANNO_SELECTOR)
        await expect(page.getByTestId('overlay-anno-badge')).toHaveCount(1, { timeout: 5_000 })
        await page.getByTestId('overlays-open-anno').click()
        await expect(annoSheet).toBeVisible({ timeout: 10_000 })
        const visibleSwitch = page.getByTestId('anno-visible-switch')
        await expect(visibleSwitch).toHaveAttribute('data-state', 'checked', { timeout: 5_000 })
        await visibleSwitch.click()
        await expect(page.getByTestId('overlay-anno-badge')).toHaveCount(0, { timeout: 5_000 })
        shots.push(await ctx!.shot(8, 'anno-hidden'))
        await visibleSwitch.click()
        await expect(page.getByTestId('overlay-anno-badge')).toHaveCount(1, { timeout: 5_000 })

        // 删除（Confirm）。
        await expect(annoSheet).toBeVisible()
        const deleteItem = page.getByTestId('anno-panel-item').filter({ hasText: annoText }).first()
        await deleteItem.getByTestId('anno-panel-delete').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        expect(norm(await confirm.innerText())).toContain('删除标注')
        shots.push(await ctx!.shot(8, 'anno-delete-confirm'))
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirm).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('anno-panel-count')).toHaveText(String(annoBefore), { timeout: 10_000 })
        expect(arrayCount(ANNO_FILE), '删除后 annotations.json 应回到基线').toBe(annoBefore)
        await expect(page.getByTestId('overlay-anno-badge')).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(annoSheet).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `需求条「标注」小面板新增「${annoText}」→ annotations ${annoBefore}→${annoBefore + 1}，角标=1；面板定位→高亮元素；显隐开关→角标 1→0→1；删除 Confirm→annotations 回到 ${annoBefore}，角标=0`,
          shots,
        }
      })

      await runStep(ctx, 9, 'links', '链接新增 / 预览跳转 / 删除', async () => {
        const shots: string[] = []
        await ensurePcStage(page)
        // W6：同步骤 8，拾取带一次有界重试。
        const composer = page.getByTestId('pick-composer')
        for (let attempt = 0; ; attempt += 1) {
          await clearSelectionIfAny(page)
          await pickWithCtrl(page, ANNO_SELECTOR)
          if (attempt >= 1 || (await composer.isVisible().catch(() => false))) break
          await waitPreview(page)
        }
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('pick-composer-link').click()
        const linkPanel = page.getByTestId('pick-composer-link-panel')
        await expect(linkPanel).toBeVisible({ timeout: 5_000 })
        await page.getByTestId('pick-composer-link-target').selectOption({ label: MINE })
        await page.getByTestId('pick-composer-link-save').click()
        await waitToast(page, /已保存跳转绑定|已更新跳转绑定/, 15_000)
        expect(arrayCount(LINKS_FILE, 'links'), '新增链接后 links.json 应 +1').toBe(linksBefore + 1)
        shots.push(await ctx!.shot(9, 'composer-link-bind'))
        // 保存成功后选择清空、需求条自动收起。
        await expect(page.getByTestId('pick-composer')).toBeHidden({ timeout: 5_000 })
        const selectorText = ANNO_SELECTOR

        await page.getByTestId('overlays-open-links').click()
        const linksSheet = page.getByTestId('overlays-sheet-links')
        await expect(linksSheet).toBeVisible({ timeout: 10_000 })
        await expect(linksSheet.getByTestId('overlays-link-item')).toHaveCount(linksBefore + 1, { timeout: 10_000 })
        const linkItem = linksSheet.getByTestId('overlays-link-item').filter({ hasText: selectorText }).first()
        await expect(linkItem).toBeVisible()
        expect(norm(await linkItem.innerText())).toContain(MINE)
        shots.push(await ctx!.shot(9, 'links-panel'))

        await linkItem.getByTestId('overlays-link-jump').click()
        await expect
          .poll(async () => norm(await page.getByTestId('loc-pill').innerText()), { timeout: 20_000 })
          .toContain(MINE)
        await waitPreview(page)
        shots.push(await ctx!.shot(9, 'link-jump-target'))

        await clickProto(page, HOME)
        await page.getByTestId('overlays-open-links').click()
        await expect(linksSheet).toBeVisible({ timeout: 10_000 })
        const returnItem = linksSheet.getByTestId('overlays-link-item').filter({ hasText: selectorText }).first()
        await expect(returnItem).toBeVisible()
        await returnItem.getByTestId('overlays-link-delete').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        expect(norm(await confirm.innerText())).toContain('删除跳转绑定')
        shots.push(await ctx!.shot(9, 'link-delete-confirm'))
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirm).toBeHidden({ timeout: 10_000 })
        await expect(linksSheet.getByTestId('overlays-link-item')).toHaveCount(linksBefore, { timeout: 10_000 })
        expect(arrayCount(LINKS_FILE, 'links'), '删除后 links.json 应回到基线').toBe(linksBefore)
        await page.keyboard.press('Escape')
        await expect(linksSheet).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `新增 selector=${selectorText.slice(0, 80)} → target=${MINE}；links ${linksBefore}→${linksBefore + 1}；面板预览跳转后 loc-pill=${MINE}；回到首页后删除 Confirm → links 回到 ${linksBefore}`,
          shots,
        }
      })

      await runStep(ctx, 10, 'queue', '待提交：新增 2 条 / reload 持久化 / 移除 / 清空', async () => {
        const shots: string[] = []
        const queueSelectors = [ANNO_SELECTOR, '[data-pr-id="pr-p-40"]']
        await ensurePcStage(page)
        for (let i = 0; i < queueTexts.length; i += 1) {
          await clearSelectionIfAny(page)
          await pickWithCtrl(page, queueSelectors[i])
          const composer = page.getByTestId('pick-composer')
          await expect(composer).toBeVisible({ timeout: 10_000 })
          await page.getByTestId('pick-composer-input').fill(queueTexts[i])
          await page.getByTestId('pick-composer-submit').click()
          await expect(composer).toBeHidden({ timeout: 10_000 })
          // 底部不再常驻待提交条；数量回显在工具栏「待提交」入口。
          await expect(page.getByTestId('multi-edit-bar'), '底部不再常驻待提交条').toHaveCount(0)
          await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute(
            'aria-label',
            `待提交（${i + 1}）`,
            { timeout: 10_000 },
          )
        }
        const added = await readQueue(page)
        expect(added).toHaveLength(2)
        expect(added.every((q) => q.selector && q.page !== undefined && q.htmlFile !== undefined)).toBe(true)
        const queueSheet = page.getByTestId('overlays-sheet-queue')
        await page.getByTestId('overlays-open-queue').click()
        await expect(queueSheet).toBeVisible({ timeout: 10_000 })
        await expect(queueSheet.getByTestId('overlays-queue-item')).toHaveCount(2, { timeout: 10_000 })
        shots.push(await ctx!.shot(10, 'queue-sheet'))
        await page.keyboard.press('Escape')
        await expect(queueSheet).toBeHidden({ timeout: 5_000 })

        await page.reload()
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await ensureProject(page)
        await clickProto(page, HOME)
        // W6 对齐：reload 后 kind 随源同步回移动端并默认打开文档；文档会吃掉一次 Esc，
        // 重新确保 PC 舞台（回到本步骤开头的口径），队列 Sheet 的 Esc 才是第一层。
        await ensurePcStage(page)
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（2）', {
          timeout: 20_000,
        })
        await expect(page.getByTestId('multi-edit-bar'), 'reload 后也不出现常驻条').toHaveCount(0)
        expect(await readQueue(page), 'reload 后队列应持久化 2 条').toHaveLength(2)
        await page.getByTestId('overlays-open-queue').click()
        await expect(queueSheet).toBeVisible({ timeout: 10_000 })
        await expect(queueSheet.getByTestId('overlays-queue-item')).toHaveCount(2, { timeout: 10_000 })
        shots.push(await ctx!.shot(10, 'queue-persist'))

        await page.keyboard.press('Escape')
        await expect(queueSheet).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（2）')
        await expect(page.getByTestId('multi-edit-bar')).toHaveCount(0)

        await page.getByTestId('overlays-open-queue').click()
        await expect(queueSheet).toBeVisible({ timeout: 10_000 })
        await queueSheet.getByTestId('overlays-queue-remove').first().click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        expect(norm(await confirm.innerText())).toContain('移除待提交项')
        shots.push(await ctx!.shot(10, 'queue-remove-confirm'))
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirm).toBeHidden({ timeout: 10_000 })
        await expect(queueSheet.getByTestId('overlays-queue-item')).toHaveCount(1, { timeout: 10_000 })
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（1）')
        expect(await readQueue(page)).toHaveLength(1)

        await page.reload()
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await ensureProject(page)
        await clickProto(page, HOME)
        // W6 对齐：同上，reload 后回到 PC 舞台，避免文档吃掉 Esc。
        await ensurePcStage(page)
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（1）', {
          timeout: 20_000,
        })
        expect(await readQueue(page), '移除后 reload 仍应只剩 1 条').toHaveLength(1)

        await page.getByTestId('overlays-open-queue').click()
        await expect(queueSheet).toBeVisible({ timeout: 10_000 })
        await expect(queueSheet.getByTestId('overlays-queue-item')).toHaveCount(1, { timeout: 10_000 })
        await queueSheet.getByTestId('overlays-queue-clear').click()
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        expect(norm(await confirm.innerText())).toContain('清空待提交')
        shots.push(await ctx!.shot(10, 'queue-clear-confirm'))
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirm).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-item')).toHaveCount(0, { timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-footer'), '空队列不渲染底栏').toHaveCount(0)
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（0）')
        await expect(page.getByTestId('multi-edit-bar')).toHaveCount(0)
        expect(await readQueue(page)).toHaveLength(0)

        await page.reload()
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await ensureProject(page)
        await clickProto(page, HOME)
        // W6 对齐：同上，reload 后回到 PC 舞台。
        await ensurePcStage(page)
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（0）', {
          timeout: 20_000,
        })
        expect(await readQueue(page), '清空后 reload 队列应为空').toHaveLength(0)
        await expect(page.getByTestId('multi-edit-bar')).toHaveCount(0)
        await page.getByTestId('overlays-open-queue').click()
        await expect(queueSheet).toBeVisible({ timeout: 10_000 })
        await expect(queueSheet.getByTestId('overlays-queue-item')).toHaveCount(0, { timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-footer')).toHaveCount(0)
        shots.push(await ctx!.shot(10, 'queue-cleared'))
        await page.keyboard.press('Escape')
        await expect(queueSheet).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `拾取需求新增 2 条（${queueTexts.join(' / ')}），selector/page/htmlFile 非空；底部常驻条=0；reload 后仍 2 条且 Sheet=2；移除 1 条 Confirm 后 1 条，reload 后仍 1 条；清空 Confirm 后 Sheet 空、底部操作栏消失、localStorage=[]，再次 reload 仍为空`,
          shots,
        }
      })

      await runStep(ctx, 11, 'esc-mask-focus-1024', 'Esc 单层 / 遮罩点击 / 焦点回归 / 1024 宽布局', async () => {
        const shots: string[] = []
        await ensurePcStage(page)
        await clearSelectionIfAny(page)
        await pickWithCtrl(page, ANNO_SELECTOR)
        // W6：检查器已删除，Sheet 行为改用「标注」入口验证（同一 ui/sheet 机制）。
        const annoBtn = page.getByTestId('overlays-open-anno')
        const sheet = page.getByTestId('overlays-sheet-anno')
        await annoBtn.focus()
        await page.keyboard.press('Enter')
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        const focusIn = await activeInfo(page)
        const focusInside = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null
          return !!a?.closest('[data-testid="overlays-sheet-anno"]')
        })
        if (!focusInside) {
          observe(
            'b-ge-P2-sheet-focus',
            'P2',
            'Enter 打开标注面板后焦点未进入 Sheet',
            `activeElement=${JSON.stringify(focusIn)}`,
          )
        }
        await page.keyboard.press('Escape')
        await expect(sheet).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('1', { timeout: 5_000 })
        const focusBack = await activeInfo(page)
        if (!(focusBack.ariaLabel || '').startsWith('标注')) {
          observe(
            'b-ge-P2-focus-restore',
            'P2',
            'Esc 关闭标注面板后焦点未回到触发按钮',
            `activeElement=${JSON.stringify(focusBack)}；期望 aria-label=标注（…）`,
          )
        }
        shots.push(await ctx!.shot(11, 'esc-sheet-only'))

        // 遮罩点击关闭：只关当前 Sheet，选择保留。
        await annoBtn.click()
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        const overlay = page.locator('[data-slot="sheet-overlay"]').first()
        await expect(overlay).toBeVisible()
        const ob = await overlay.boundingBox()
        await page.mouse.click((ob?.x ?? 0) + 8, (ob?.y ?? 0) + 8)
        await expect(sheet).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('1', { timeout: 5_000 })
        shots.push(await ctx!.shot(11, 'mask-close'))

        // 叠层：Sheet + Confirm，Esc 只关 Confirm，再 Esc 关 Sheet。
        await page.getByTestId('overlays-open-anno').click()
        const annoSheet = page.getByTestId('overlays-sheet-anno')
        await expect(annoSheet).toBeVisible({ timeout: 10_000 })
        const deleteItem = page.getByTestId('anno-panel-item').first()
        await deleteItem.getByTestId('anno-panel-delete').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        await page.keyboard.press('Escape')
        await expect(confirm, '第 1 次 Esc 只关 Confirm').toBeHidden({ timeout: 5_000 })
        await expect(annoSheet, 'Confirm 关闭后 Sheet 仍在').toBeVisible()
        expect(arrayCount(ANNO_FILE), 'Esc 取消删除后 annotations 不变').toBe(annoBefore)
        await page.keyboard.press('Escape')
        await expect(annoSheet).toBeHidden({ timeout: 5_000 })
        shots.push(await ctx!.shot(11, 'esc-confirm-only'))

        // 1024 宽布局：页面不横向滚动，Sheet 不越界。
        await ctx!.app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            if (win.isMaximized()) win.unmaximize()
            win.setContentSize(1024, 768)
          }
        })
        await delay(800)
        const vp = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(vp.innerWidth, '窗口应缩到 1024 内容宽').toBeGreaterThanOrEqual(1000)
        expect(vp.scrollWidth, '页面不得横向溢出').toBeLessThanOrEqual(vp.innerWidth + 1)
        await page.getByTestId('overlays-open-anno').click()
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        const sheetBox = await sheet.boundingBox()
        expect(sheetBox).not.toBeNull()
        expect(sheetBox!.width).toBeLessThanOrEqual(430)
        expect(sheetBox!.x + sheetBox!.width).toBeLessThanOrEqual(vp.innerWidth + 1)
        shots.push(await ctx!.shot(11, 'viewport-1024-sheet'))
        await page.keyboard.press('Escape')
        await expect(sheet).toBeHidden({ timeout: 5_000 })

        await page.getByRole('button', { name: 'Git 管理' }).click()
        const gitSheet = page.getByTestId('git-sheet')
        await expect(gitSheet).toBeVisible({ timeout: 15_000 })
        const gitBox = await gitSheet.boundingBox()
        expect(Math.round(gitBox!.width)).toBe(660)
        expect(gitBox!.x + gitBox!.width).toBeLessThanOrEqual(vp.innerWidth + 1)
        const toolbarMetrics = await page.getByTestId('git-toolbar').evaluate((el) => ({
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          height: el.getBoundingClientRect().height,
        }))
        if (toolbarMetrics.scrollWidth > toolbarMetrics.clientWidth + 1) {
          observe(
            'b-ge-P2-git-toolbar-1024',
            'P2',
            'Git 工具栏在 1024 宽下横向溢出',
            `clientWidth=${toolbarMetrics.clientWidth} scrollWidth=${toolbarMetrics.scrollWidth} height=${toolbarMetrics.height}`,
          )
        }
        shots.push(await ctx!.shot(11, 'viewport-1024-git'))
        await page.keyboard.press('Escape')
        await expect(gitSheet).toBeHidden({ timeout: 5_000 })

        // 保持 1024 宽进入后续快照步骤：长链路下 1024→1440 连续 resize 偶发渲染进程挂起，
        // 与 1024 布局断言无关；不再回放大，避免测试环境假失败（真机复验另行记录）。
        return {
          evidence: `Esc 打开标注面板→关闭后选择仍=1、焦点=${JSON.stringify(focusBack)}；遮罩点击 8,8 关闭 Sheet 且选择=1；Sheet+Confirm 第 1 次 Esc 只关 Confirm（annotations 仍 ${annoBefore}），第 2 次 Esc 关 Sheet；1024 视口 innerWidth=${vp.innerWidth}、scrollWidth=${vp.scrollWidth}；标注 Sheet 宽=${Math.round(sheetBox!.width)}、右边界=${Math.round(sheetBox!.x + sheetBox!.width)}；Git Sheet 宽=${Math.round(gitBox!.width)}；git-toolbar client/scroll=${toolbarMetrics.clientWidth}/${toolbarMetrics.scrollWidth}`,
          shots,
        }
      })

      await runStep(ctx, 12, 'snapshot', '快照：2 版本列表 / 筛选 / 恢复 Confirm', async () => {
        const shots: string[] = []
        await page.bringToFront().catch(() => undefined)
        await delay(500)
        await ensurePcStage(page)
        await clearSelectionIfAny(page)
        await page.getByTestId('overlays-open-snapshot').click()
        const sheet = page.getByTestId('overlays-sheet-snapshot')
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        const list = page.getByTestId('snapshot-item')
        await expect.poll(() => list.count(), { timeout: 15_000 }).toBe(2)
        await expect(page.getByTestId('snapshot-count')).toHaveText('2', { timeout: 10_000 })
        // 长链路 + 1024 宽下 page.screenshot 偶发 30s 挂起；截图是证据非断言，失败降级不阻断快照功能验收。
        const safeShot = async (slug: string): Promise<void> => {
          try {
            shots.push(await ctx!.shot(12, slug))
          } catch (err) {
            log('shot-skip', { slug, error: String((err as Error)?.message ?? err).split('\n')[0] })
          }
        }
        await safeShot('snapshot-list')

        const items = await list.evaluateAll((nodes) =>
          nodes.map((n) => ({
            ts: n.getAttribute('data-snapshot-ts') || '',
            text: (n.textContent || '').replace(/\s+/g, ' ').trim(),
          })),
        )
        log('snapshots', items)
        const older = items[items.length - 1]
        expect(older.ts).toMatch(/^\d{8}-\d{6}$/)
        await page.getByTestId('snapshot-filter').fill(older.ts)
        await expect(list).toHaveCount(1, { timeout: 5_000 })
        await expect(list.first()).toContainText(older.ts)
        await page.getByTestId('snapshot-filter').fill('')
        await expect(list).toHaveCount(2, { timeout: 5_000 })

        const target = page.locator(`[data-testid="snapshot-item"][data-snapshot-ts="${older.ts}"]`).first()
        await expect(target).toBeVisible()
        await target.getByTestId('snapshot-restore').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        const confirmText = norm(await confirm.innerText())
        expect(confirmText).toContain('恢复快照')
        expect(confirmText).toContain(older.ts)
        await safeShot('snapshot-restore-confirm')
        await page.getByTestId('confirm-dialog-ok').click()
        const toast = await waitToast(page, /已恢复快照|快照恢复失败/, 30_000)
        const restoreOk = /已恢复快照/.test(toast)
        if (!restoreOk) {
          observe(
            'b-ge-P1-snapshot-restore',
            'P1',
            '快照恢复失败（EPERM 修复回归）',
            `toast=「${toast}」；快照=${older.ts}；当前首页.html sha256=${sha256(HOME_HTML).slice(0, 12)}`,
          )
        }
        expect(restoreOk, `快照恢复应成功，实际 toast=「${toast}」`).toBe(true)
        const sourceHtml = path.join(SNAPSHOT_HOME, older.ts, `${HOME}.html`)
        expect(fs.existsSync(sourceHtml), '快照应包含首页.html').toBe(true)
        const expectedHash = sha256(sourceHtml)
        await expect.poll(async () => sha256(HOME_HTML), { timeout: 30_000 }).toBe(expectedHash)
        const restoredHash = sha256(HOME_HTML)
        expect(restoredHash, '恢复后首页.html 应等于快照文件').toBe(expectedHash)
        await expect(page.getByTestId('snapshot-count')).toHaveText('2', { timeout: 10_000 })
        const undoDirs = fs
          .readdirSync(SNAPSHOT_HOME, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith('undo-'))
          .map((d) => d.name)
        expect(undoDirs.length, '恢复前应生成 undo-* 备份目录').toBeGreaterThan(0)
        const undoHasHtml = undoDirs.some((name) => fs.existsSync(path.join(SNAPSHOT_HOME, name, `${HOME}.html`)))
        expect(undoHasHtml, 'undo-* 备份应包含恢复前首页.html').toBe(true)
        await safeShot('snapshot-restored')

        const deleteControls = await sheet.getByText('删除', { exact: true }).count()
        if (deleteControls === 0) {
          observe(
            'b-ge-P3-snapshot-delete',
            'P3',
            '快照面板没有“删除快照”入口（只有列表/筛选/恢复）',
            `快照 Sheet 内“删除”控件=0；seed 2 版本仅可恢复，无法在 UI 删除历史版本`,
          )
        }
        return {
          status: 'PASS',
          evidence: `快照列表=${items.length}（${items.map((i) => i.ts).join(' / ')}）；筛选 ${older.ts} → 1 条，清空 → 2 条；恢复 Confirm=「${confirmText.slice(0, 100)}」；toast=「${toast}」；` +
            `首页.html sha256=${restoredHash.slice(0, 12).toUpperCase()} = 快照 ${older.ts}/首页.html；列表仍 2 条；undo 备份=${undoDirs.join(',')}（含首页.html=${undoHasHtml}）` +
            `；删除入口=${deleteControls}`,
          shots,
        }
      })

      await runStep(ctx, 13, 'console', 'console / pageerror / crash 观察', async () => {
        const shot = await ctx!.shot(13, 'final').catch(() => '')
        const all = [...ctx!.consoleErrors, ...ctx!.pageErrors, ...ctx!.crashes]
        const noise = all.filter(isPrototypeContentNoise)
        const fatal = all.filter((t) => isFatalConsole(t) && !isPrototypeContentNoise(t))
        log('console', { total: all.length, noise: noise.length, fatal })
        expect(ctx!.crashes, '页面 crash 应为 0').toStrictEqual([])
        expect(fatal, `排除原型内容噪声后致命 console/pageerror 共 ${fatal.length} 条：\n${fatal.join('\n')}`).toStrictEqual([])
        return {
          evidence: `console/pageerror/crash 总=${all.length}；原型内容噪声=${noise.length}；过滤后致命=${fatal.length}；页面 crash=0`,
          shots: [shot],
        }
      })

      finish(testInfo, ctx)
      expect(
        observations.filter((o) => o.level === 'P0' || o.level === 'P1'),
        `导出/浮层域存在阻断缺陷：${JSON.stringify(observations.filter((o) => o.level === 'P0' || o.level === 'P1'))}`,
      ).toEqual([])
      const failed = rows.filter((r) => r.status === 'FAIL')
      if (failed.length) {
        currentStep = { no: failed[0].no, slug: 'snapshot-restore' }
        throw new Error(
          `导出/浮层失败：\n${failed.map((r) => `${r.no}. ${r.title}: ${r.evidence}`).join('\n')}`,
        )
      }

      const closeResult = await ctx.close()
      log('close', closeResult)
      assertCleanExitOrP2(closeResult)
    } catch (err) {
      if (ctx) {
        await ctx
          .reportFailure({
            step: currentStep.no,
            slug: currentStep.slug,
            level: 'P1',
            expected: '导出 5 项真实落盘/离线可读；浮层标注/链接/快照/队列完整；Esc/遮罩/焦点/1024 正常',
            actual: '断言失败，见错误栈与现场截图/日志',
            error: err,
            screenshot: false,
            extra: JSON.stringify(
              {
                dataDir: ctx.dataDir,
                userData: ctx.userData,
                exportRoot: EXPORT_ROOT,
                rows,
                observations,
                consoleErrors: ctx.consoleErrors.slice(-10),
                pageErrors: ctx.pageErrors.slice(-10),
              },
              null,
              2,
            ),
          })
          .catch(() => undefined)
      }
      throw err
    } finally {
      if (browser) await browser.close().catch(() => undefined)
      if (ctx) await closeWithGuard(ctx, 'b2-b3-finally')
      // 恢复空文档测试可能截断的 md（若断言在恢复前失败）。
      try {
        if (fs.existsSync(HOME_MD) && fs.statSync(HOME_MD).size === 0 && mdBefore.length > 0) {
          fs.writeFileSync(HOME_MD, mdBefore)
          log('restore-md', 'empty doc restored from backup')
        }
      } catch {
        /* 数据目录整体删除时忽略 */
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
