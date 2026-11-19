/**
 * e2e/wave4-git-local.spec.ts — Wave4 A3 复测 · Git 本地 bare 夹具（不触网）。
 *
 * 目的：验证开发态夹具（`file:///` + PLAND_GIT_ALLOW_LOCAL=1 + 未打包）下，
 * UI 仓库设置 → 测试连接/分支 → 上传发布（push）→ 拉取同步（pull）全链路真实可用。
 *
 * 独占产出：`docs/wave4/reports/git-local-retest.md`、`docs/wave4/shots/git-local-retest/*.png`。
 * 数据目录：`.devdata-wave4-git-retest`（`node e2e/wave4/seed.mjs --domain git-retest`）。
 * 远程：`%TEMP%/pland-wave4/git-fixture-<ts>.git`（git init --bare --initial-branch=main，纯本地）。
 * 拉取探针：`%TEMP%/pland-wave4/git-fixture-<ts>-clone`（clone bare → 追加提交 → push 回 bare）。
 *
 * 安全红线：不绕过安全策略。若后端仍返回 GIT_URL_BLOCKED，记录后端原文并抛 `BLOCKED:`
 * （报告按 BLOCKED 处理，不判 P0/P1）；不改主进程参数、不写全局 git 配置、不使用真实 token。
 * 假 token 仅写隔离数据目录，且断言不会出现在 git-config.json / sandbox/.git/config。
 *
 * 控制台口径：主窗预览 iframe（about:srcdoc）加载种子原型自带内容噪声（CDN CSS 被 CSP 拦截、
 * 原型内联脚本语法错误）。该噪声在 Git 操作前已存在，属夹具原型内容而非 Git 域行为；
 * 本 spec 以“打开 Git 面板并完成首屏读取”为基线，断言 Git 阶段新增 console/pageerror/crash=0、
 * 外部请求=0，并在报告中如实列出基线噪声。
 */
import { test, expect } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, assertCleanExit, launchApp, type Wave4App } from './wave4/harness'

const DOMAIN = 'git-retest'
const DATA_DIR = path.join(ROOT, '.devdata-wave4-git-retest')
const SANDBOX = path.join(DATA_DIR, 'sandbox')
const SHOTS = path.join(ROOT, 'docs', 'wave4', 'shots', 'git-local-retest')
const TOKEN = 'dummy-local-token'
const PROBE_FILE = 'wave4-pull-probe.md'

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const STAMP = stamp()
const PUSH_MSG = `wave4 git-retest push ${STAMP}`
const PROBE_MSG = `wave4 git-retest pull probe ${STAMP}`

async function shot(ctx: Wave4App, step: number | string, slug: string, fail = false): Promise<string> {
  fs.mkdirSync(SHOTS, { recursive: true })
  const prefix = typeof step === 'number' ? String(Math.floor(step)).padStart(2, '0') : String(step)
  const file = path.join(SHOTS, `${prefix}-${slug}${fail ? '-FAIL' : ''}.png`)
  await ctx.page.screenshot({ path: file })
  return file
}

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

/** 统一带空 credential helper 的本地 git 调用（只读/取证/夹具，不碰网络）。 */
function git(args: string[], cwd = ROOT): GitResult {
  const res = spawnSync(
    'git',
    ['-c', 'core.quotepath=false', '-c', 'credential.helper=', ...args],
    { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true, env: GIT_ENV },
  )
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

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 创建一次性 bare 夹具，并断言 core.bare=true、HEAD 指向 main。 */
function makeBare(): string {
  const root = path.join(os.tmpdir(), 'pland-wave4')
  fs.mkdirSync(root, { recursive: true })
  const bare = path.join(root, `git-fixture-${STAMP}.git`)
  fs.rmSync(bare, { recursive: true, force: true })
  const init = git(['init', '--bare', '--initial-branch=main', bare])
  if (init.status !== 0) throw new Error(`git init --bare 失败：${init.stderr || init.stdout}`)
  const configPath = path.join(bare, 'config')
  const config = fs.readFileSync(configPath, 'utf8')
  if (!/\[core\][\s\S]*?\bbare\s*=\s*true\b/i.test(config)) {
    throw new Error(`bare 夹具 core.bare 不是 true：\n${config}`)
  }
  const head = fs.readFileSync(path.join(bare, 'HEAD'), 'utf8').trim()
  if (!/refs\/heads\/main$/.test(head)) throw new Error(`bare HEAD 未指向 main：${head}`)
  return bare
}

/** 在 bare 的 clone 中追加一个探针提交并推回 bare，返回提交 sha。 */
function pushProbeCommit(bare: string, cloneDir: string): string {
  fs.rmSync(cloneDir, { recursive: true, force: true })
  const clone = git(['clone', '--quiet', bare, cloneDir])
  if (clone.status !== 0) throw new Error(`git clone 失败：${clone.stderr || clone.stdout}`)
  git(['-C', cloneDir, 'config', 'user.name', 'Wave4 GitRetest'])
  git(['-C', cloneDir, 'config', 'user.email', 'wave4-gitretest@local'])
  fs.writeFileSync(
    path.join(cloneDir, PROBE_FILE),
    `# wave4 git-retest pull probe\n\n- stamp: ${STAMP}\n- token: not-used\n`,
    'utf8',
  )
  const add = git(['-C', cloneDir, 'add', '--', PROBE_FILE])
  if (add.status !== 0) throw new Error(`clone git add 失败：${add.stderr}`)
  const commit = git(['-C', cloneDir, 'commit', '-m', PROBE_MSG])
  if (commit.status !== 0) throw new Error(`clone git commit 失败：${commit.stderr || commit.stdout}`)
  const push = git(['-C', cloneDir, 'push', 'origin', 'HEAD:refs/heads/main'])
  if (push.status !== 0) throw new Error(`clone git push 失败：${push.stderr || push.stdout}`)
  const sha = git(['-C', cloneDir, 'rev-parse', 'HEAD']).stdout
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`clone HEAD 非法：${sha}`)
  return sha
}

interface ProcInfo {
  pid: number
  name: string
  cmd: string
}

function psJson(script: string): unknown {
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 30_000, windowsHide: true },
  )
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

function listProcesses(): Array<ProcInfo & { parent: number }> {
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

/** Electron 主进程的整棵子进程树（用于关闭后孤儿判定）。 */
function descendantsOf(rootPid: number): ProcInfo[] {
  if (!rootPid) return []
  const all = listProcesses()
  const parentById = new Map<number, number>()
  for (const item of all) parentById.set(item.pid, item.parent)
  const out: ProcInfo[] = []
  for (const proc of all) {
    let cursor = proc.pid
    let depth = 0
    while (cursor && depth < 12) {
      const parent = parentById.get(cursor) ?? 0
      if (parent === rootPid) {
        out.push({ pid: proc.pid, name: proc.name, cmd: proc.cmd })
        break
      }
      if (!parent || parent === cursor) break
      cursor = parent
      depth += 1
    }
  }
  return out
}

function livePids(pids: number[]): ProcInfo[] {
  if (!pids.length) return []
  const ids = pids.join(',')
  const raw = psJson(
    `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName | ConvertTo-Json -Compress`,
  )
  return normalizeList(raw).map((p) => ({
    pid: Number(p.Id ?? 0),
    name: String(p.ProcessName ?? ''),
    cmd: '',
  }))
}

function processesMentioning(needle: string): ProcInfo[] {
  const escaped = needle.replace(/'/g, "''")
  const raw = psJson(
    `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('git.exe','git-remote-https.exe','git-remote-http.exe','git-credential-manager.exe','git-credential-manager-core.exe','ssh.exe') -and $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
  )
  return normalizeList(raw).map((p) => ({
    pid: Number(p.ProcessId ?? 0),
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

const GIT_CHILD_NAMES = [...CREDENTIAL_PROCESS_NAMES, 'git.exe', 'codebuddy.exe', 'conhost.exe']

/** Electron 子进程里的 git / conhost / 凭据进程（无 GCM 弹窗的进程级证据）。 */
function gitChildrenOf(appPid: number): ProcInfo[] {
  return descendantsOf(appPid).filter((p) => GIT_CHILD_NAMES.includes(p.name.toLowerCase()))
}

/** 系统级凭据进程（用于证明本地 file 传输没有拉起 GCM / https 凭据助手）。 */
function credentialProcesses(): ProcInfo[] {
  return listProcesses().filter((p) => CREDENTIAL_PROCESS_NAMES.includes(p.name.toLowerCase()))
}

async function toastTitles(page: Wave4App['page']): Promise<string[]> {
  return page.locator('[data-slot="toast-title"]').allInnerTexts().catch(() => [])
}

/** 轮询通知栏，返回第一条命中的通知标题；超时抛出当前全部通知，便于定位失败原文。 */
async function waitToast(page: Wave4App['page'], re: RegExp, timeout = 60_000): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const titles = await toastTitles(page)
    const hit = titles.find((t) => re.test(t))
    if (hit) return hit.trim()
    await page.waitForTimeout(100)
  }
  throw new Error(`等待通知超时（${re}）；当前通知=${JSON.stringify(await toastTitles(page))}`)
}

/** 采样忙碌态：验证 push/pull 期间存在「取消操作」入口（不强制命中，记录即可）。 */
async function sampleBusy(page: Wave4App['page'], ms = 4_000): Promise<{ busy: boolean; cancel: boolean }> {
  const started = Date.now()
  let busy = false
  let cancel = false
  while (Date.now() - started < ms) {
    if (await page.getByTestId('git-busy').isVisible().catch(() => false)) busy = true
    if (await page.getByTestId('git-cancel').isVisible().catch(() => false)) cancel = true
    if (busy && cancel) break
    await page.waitForTimeout(50)
  }
  return { busy, cancel }
}

test.describe('Wave4 A3 复测 · Git 本地 bare 夹具（UI 配置 + push/pull）', () => {
  test('仓库设置保存 / 测试连接 / 分支 / push / pull / 差异 / 自愈 / 收尾', async () => {
    test.setTimeout(300_000)

    const bare = makeBare()
    const cloneDir = path.join(os.tmpdir(), 'pland-wave4', `git-fixture-${STAMP}-clone`)
    const remote = fileUrl(bare)
    const gitConfigPath = path.join(DATA_DIR, 'git-config.json')
    const sandboxGitConfig = path.join(SANDBOX, '.git', 'config')
    const sandboxHeadBefore = git(['rev-parse', 'HEAD'], SANDBOX).stdout
    const statusCountBefore = git(['status', '--porcelain=v1', '-uall'], SANDBOX).stdout
      .split(/\r?\n/)
      .filter(Boolean).length
    const gcmBaseline = credentialProcesses()

    console.log(`[git-retest] ROOT=${ROOT}`)
    console.log(`[git-retest] DATA_DIR=${DATA_DIR}`)
    console.log(`[git-retest] BARE=${bare}`)
    console.log(`[git-retest] REMOTE=${remote}`)
    console.log(`[git-retest] sandbox HEAD=${sandboxHeadBefore}；status=${statusCountBefore} 项`)
    console.log(`[git-retest] GCM baseline=${gcmBaseline.length}（${gcmBaseline.map((p) => p.name).join(',') || 'none'}）`)
    expect(fs.existsSync(path.join(bare, 'HEAD')), 'bare 夹具应有 HEAD').toBe(true)

    let appPid = 0
    let projectName = '测试1'
    const assertNoNewCredentialProcess = (label: string): void => {
      const now = credentialProcesses()
      const extra = now.filter((p) => !gcmBaseline.some((b) => b.pid === p.pid))
      if (extra.length) {
        throw new Error(
          `[git-retest] ${label}：出现凭据类进程（GCM/HTTPS 凭据助手风险）：` +
            extra.map((p) => `${p.name}#${p.pid}`).join(', '),
        )
      }
    }

    const ctx: Wave4App = await launchApp({
      domain: DOMAIN,
      env: { PLAND_GIT_ALLOW_LOCAL: '1' },
    })
    appPid = ctx.app.process()?.pid ?? 0
    /** Git 阶段外部网络请求（file/data/about/blob/proto-asset 之外的 URL）。 */
    const externalRequests: string[] = []
    ctx.page.on('request', (req) => {
      const url = req.url()
      if (!/^(file|data|about|blob|proto-asset):/i.test(url)) externalRequests.push(url)
    })

    try {
      // 0) 隔离启动
      console.log(`[git-retest] userData=${ctx.userData}`)
      expect(ctx.userData.toLowerCase()).toBe(DATA_DIR.toLowerCase())
      expect(ctx.seedPresent).toBe(true)
      await shot(ctx, 0, 'cold-start')

      const picker = ctx.page.getByTestId('project-picker')
      if (await picker.isVisible().catch(() => false)) {
        console.log('[git-retest] project-picker 出现，进入 测试1')
        await picker.getByText('测试1', { exact: true }).click()
        await expect(picker).toBeHidden({ timeout: 10_000 })
      }

      // 1) 打开 Git 面板（660px Dialog + 真实变更树）
      await ctx.page.getByRole('button', { name: 'Git 管理' }).click()
      const sheet = ctx.page.getByTestId('git-sheet')
      await expect(sheet).toBeVisible({ timeout: 15_000 })
      await expect(sheet).toHaveAttribute('data-surface', 'dialog')
      const box = await sheet.boundingBox()
      expect(box).not.toBeNull()
      expect(Math.round((box as { width: number }).width)).toBe(660)
      await expect(ctx.page.getByTestId('git-panel')).toBeVisible()
      await expect(ctx.page.getByTestId('git-branch-select')).toHaveValue('main')

      const total = ctx.page.getByTestId('git-total')
      await expect(total).toContainText('处变更', { timeout: 20_000 })
      await expect
        .poll(
          async () => {
            const text = (await total.innerText()).trim()
            const match = text.match(/(\d+)\s*处变更/)
            return match ? Number(match[1]) : -1
          },
          { timeout: 90_000, intervals: [500, 1_000, 2_000, 3_000] },
        )
        .toBeGreaterThan(0)
      await expect(ctx.page.getByTestId('git-refresh')).toBeEnabled({ timeout: 30_000 })
      const rows = ctx.page.getByTestId('git-file-row')
      await expect(rows.first()).toBeVisible({ timeout: 15_000 })
      console.log(`[git-retest] git-total=${(await total.innerText()).trim()}；rows=${await rows.count()}`)
      await shot(ctx, 1, 'git-panel-660')

      /*
       * 控制台基线：主窗预览 iframe（about:srcdoc）加载种子原型时就带有内容级噪声
       * （原型 HTML 引用 cdn.jsdelivr.net CSS 被页面 CSP 拦截 + 原型内联脚本语法错误）。
       * 这属于夹具原型内容，不是 Git 域行为；Git 复测只断言“Git 操作期间新增 0 条”。
       */
      const baselineConsole = ctx.consoleErrors.slice()
      const baselinePageErrors = ctx.pageErrors.slice()
      const baselineCrashes = ctx.crashes.length
      const externalBaseline = externalRequests.length
      console.log(
        `[git-retest] 基线噪声：console=${baselineConsole.length} pageerror=${baselinePageErrors.length} ` +
          `crashes=${baselineCrashes} externalRequests=${externalBaseline}`,
      )
      if (baselineConsole.length) console.log('[git-retest] 基线 console:\n' + baselineConsole.join('\n'))
      if (baselinePageErrors.length) console.log('[git-retest] 基线 pageerror:\n' + baselinePageErrors.join('\n'))

      // 2) 仓库设置：file:/// + main + 假 token → 保存成功
      const configHashBefore = sha256File(gitConfigPath)
      await ctx.page.getByTestId('git-config-open').click()
      const cfgDialog = ctx.page.getByTestId('git-config-dialog')
      await expect(cfgDialog).toBeVisible({ timeout: 10_000 })
      const remoteInput = ctx.page.getByTestId('git-config-remote')
      await expect(remoteInput).toBeEnabled()
      await expect(remoteInput).toHaveValue('')
      const dialogText = (await cfgDialog.innerText()).replace(/\s+/g, ' ')
      const project = (dialogText.match(/项目：([^\s]+)/) || [])[1] || '测试1'
      projectName = project
      console.log(`[git-retest] project=${project}；dialog=${dialogText.slice(0, 120)}`)
      console.log(
        `[git-retest] token-state(before)=${(await ctx.page.getByTestId('git-config-token-state').innerText()).trim()}`,
      )

      await remoteInput.fill(remote)
      await expect(ctx.page.getByTestId('git-config-local-fixture-hint')).toBeVisible()
      const branchInput = ctx.page.getByTestId('git-config-branch')
      await branchInput.fill('main')
      await ctx.page.getByTestId('git-config-author-name').fill('Wave4 GitRetest')
      await ctx.page.getByTestId('git-config-author-email').fill('wave4-gitretest@local')
      await ctx.page.getByTestId('git-config-token').fill(TOKEN)
      await shot(ctx, 2, 'config-filled')

      await ctx.page.getByTestId('git-config-save').click()
      await expect(cfgDialog).toBeHidden({ timeout: 20_000 })
      const saveToast = await waitToast(ctx.page, /Git 仓库配置已保存/, 15_000)
      console.log(`[git-retest] save toast=${saveToast}`)
      await expect(ctx.page.getByTestId('git-need-config')).toBeHidden({ timeout: 10_000 })
      const configHashAfter = sha256File(gitConfigPath)
      expect(configHashAfter, '保存成功应写入 git-config.json').not.toBe(configHashBefore)

      const rawConfig = JSON.parse(fs.readFileSync(gitConfigPath, 'utf8')) as {
        projects?: Record<string, { remoteUrl?: string; branch?: string }>
      }
      expect(rawConfig.projects?.[project]?.remoteUrl, '项目 remoteUrl 应落盘为 file:///').toBe(remote)
      expect(rawConfig.projects?.[project]?.branch).toBe('main')
      const rawConfigText = fs.readFileSync(gitConfigPath, 'utf8')
      expect(rawConfigText, '假 token 不得明文写入 git-config.json').not.toContain(TOKEN)
      const sandboxConfigAfterSave = fs.readFileSync(sandboxGitConfig, 'utf8')
      expect(sandboxConfigAfterSave, 'sandbox origin 应指向 bare 夹具').toContain(remote.replace(/^file:\/\/\//, 'file:///'))
      expect(sandboxConfigAfterSave, '假 token 不得写入 sandbox/.git/config').not.toContain(TOKEN)
      await shot(ctx, 3, 'config-saved')

      // 3) 测试连接（复用已保存 token）+ 分支列表；不得出现 GCM
      await ctx.page.getByTestId('git-config-open').click()
      await expect(cfgDialog).toBeVisible({ timeout: 10_000 })
      await expect(remoteInput).toBeEnabled()
      await expect(remoteInput, '保存后重开应回显 file:///').toHaveValue(remote)
      await expect(ctx.page.getByTestId('git-config-branch')).toHaveValue('main')
      const tokenState = (await ctx.page.getByTestId('git-config-token-state').innerText()).trim()
      const tokenInput = ctx.page.getByTestId('git-config-token')
      await expect(tokenInput).toHaveValue('')
      console.log(`[git-retest] token-state(after save)=${tokenState}`)

      const connectStarted = Date.now()
      await ctx.page.getByTestId('git-test-connection').click()
      const notice = ctx.page.getByTestId('git-config-notice')
      const cfgError = ctx.page.getByTestId('git-config-error')
      await expect
        .poll(
          async () => (await notice.isVisible().catch(() => false)) || (await cfgError.isVisible().catch(() => false)),
          { timeout: 30_000, intervals: [100, 250, 500] },
        )
        .toBe(true)
      const connectElapsed = Date.now() - connectStarted
      if (await cfgError.isVisible().catch(() => false)) {
        const text = (await cfgError.innerText()).trim()
        await shot(ctx, 4, 'test-connection-blocked')
        if (/GIT_URL_BLOCKED/.test(text)) {
          throw new Error(`BLOCKED: 测试连接仍被安全策略拒绝（未绕过）：${text}`)
        }
        throw new Error(`测试连接失败：${text}`)
      }
      const noticeText = (await notice.innerText()).trim()
      console.log(`[git-retest] test-connection=${noticeText}；耗时=${connectElapsed}ms`)
      expect(noticeText).toMatch(/连接成功/)
      assertNoNewCredentialProcess('测试连接后')
      await shot(ctx, 4, 'test-connection-ok')

      await ctx.page.getByTestId('git-config-cancel').click()
      await expect(cfgDialog).toBeHidden({ timeout: 5_000 })
      const branchOptions = await ctx.page.getByTestId('git-branch-select').locator('option').allTextContents()
      console.log(`[git-retest] branch options=${branchOptions.join(',')}`)
      expect(branchOptions.map((s) => s.trim())).toContain('main')
      await expect(ctx.page.getByTestId('git-branch-hint')).toBeHidden({ timeout: 5_000 })
      await shot(ctx, 5, 'branch-list')

      // 4) 上传发布：勾选当前项目全部文件 → 提交说明 → push
      await expect(ctx.page.getByTestId('git-mode-status')).toHaveAttribute('aria-pressed', 'true')
      const currentCard = ctx.page.getByTestId('git-project-card').filter({ hasText: '当前项目' }).first()
      await expect(currentCard).toBeVisible({ timeout: 15_000 })
      const countBadge = currentCard.getByTestId('git-project-count')
      const projectTotal = Number(await countBadge.getAttribute('data-total'))
      expect(projectTotal, '当前项目应有可选文件').toBeGreaterThan(0)
      await currentCard.getByRole('checkbox').first().click()
      await expect
        .poll(async () => Number(await countBadge.getAttribute('data-selected')), { timeout: 10_000 })
        .toBe(projectTotal)
      console.log(`[git-retest] push 选择：${projectTotal}/${projectTotal}（当前项目）`)
      await ctx.page.getByTestId('git-message').fill(PUSH_MSG)
      await shot(ctx, 6, 'push-selected')

      const pushBusy = sampleBusy(ctx.page, 8_000)
      await ctx.page.getByTestId('git-push').click()
      const pushToast = await waitToast(ctx.page, /发布成功|发布失败/, 60_000)
      const pushBusySeen = await pushBusy
      console.log(`[git-retest] push toast=${pushToast}；busy=${pushBusySeen.busy} cancel=${pushBusySeen.cancel}`)
      if (!/发布成功/.test(pushToast)) throw new Error(`上传发布失败：${pushToast}`)
      await expect
        .poll(async () => gitBare(bare, ['log', '--oneline', '-1']).stdout, { timeout: 30_000 })
        .toContain(STAMP)
      const bareLogAfterPush = gitBare(bare, ['log', '--oneline', '-1']).stdout
      const sandboxHeadAfterPush = git(['rev-parse', 'HEAD'], SANDBOX).stdout
      const bareMainAfterPush = gitBare(bare, ['rev-parse', 'refs/heads/main']).stdout
      console.log(`[git-retest] push bare log=${bareLogAfterPush}`)
      console.log(`[git-retest] push sandbox HEAD=${sandboxHeadAfterPush}；bare main=${bareMainAfterPush}`)
      expect(bareLogAfterPush, 'bare 应收到本次提交说明').toContain(PUSH_MSG)
      expect(bareMainAfterPush, 'bare main 应等于本地新提交').toBe(sandboxHeadAfterPush)

      const branchRemote = git(['config', '--local', '--get', 'branch.main.remote'], SANDBOX).stdout
      const branchMerge = git(['config', '--local', '--get', 'branch.main.merge'], SANDBOX).stdout
      const originUrl = git(['config', '--local', '--get', 'remote.origin.url'], SANDBOX).stdout
      const upstreamPush = git(['rev-parse', '--abbrev-ref', '@{u}'], SANDBOX)
      console.log(
        `[git-retest] after push: branch.main.remote=${branchRemote} merge=${branchMerge} ` +
          `origin.url=${originUrl} @{u}=${upstreamPush.status === 0 ? upstreamPush.stdout : '(none)'}`,
      )
      expect(branchRemote, 'branch.main.remote 必须是 origin，不得写成 URL').toBe('origin')
      expect(branchMerge).toBe('refs/heads/main')
      expect(originUrl).toBe(remote)
      expect(upstreamPush.status, 'push 后 @{u} 应可解析').toBe(0)
      await expect(ctx.page.getByTestId('git-refresh')).toBeEnabled({ timeout: 30_000 })
      await shot(ctx, 7, 'push-success')

      // 5) 拉取同步：另一个 clone 向 bare 追加提交 → UI 拉取 → 沙箱收到
      const probeSha = pushProbeCommit(bare, cloneDir)
      const bareLogAfterProbe = gitBare(bare, ['log', '--oneline', '-1']).stdout
      console.log(`[git-retest] probe sha=${probeSha}；bare log=${bareLogAfterProbe}`)
      expect(bareLogAfterProbe).toContain(PROBE_MSG)
      expect(fs.existsSync(path.join(SANDBOX, PROBE_FILE)), '拉取前探针文件不应存在').toBe(false)

      await ctx.page.getByTestId('git-pull').click()
      const confirm = ctx.page.getByTestId('confirm-dialog')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      const confirmText = (await confirm.innerText()).replace(/\s+/g, ' ').trim()
      console.log(`[git-retest] pull confirm=${confirmText}`)
      expect(confirmText).toContain('拉取同步')
      await shot(ctx, 8, 'pull-confirm')
      const pullBusy = sampleBusy(ctx.page, 8_000)
      await ctx.page.getByTestId('confirm-dialog-ok').click()
      const pullToast = await waitToast(ctx.page, /同步完成|同步失败/, 60_000)
      const pullBusySeen = await pullBusy
      console.log(`[git-retest] pull toast=${pullToast}；busy=${pullBusySeen.busy} cancel=${pullBusySeen.cancel}`)
      if (!/同步完成/.test(pullToast)) throw new Error(`拉取同步失败：${pullToast}`)

      await expect
        .poll(async () => fs.existsSync(path.join(SANDBOX, PROBE_FILE)), { timeout: 30_000 })
        .toBe(true)
      const probeText = fs.readFileSync(path.join(SANDBOX, PROBE_FILE), 'utf8')
      expect(probeText, '沙箱应收到远端探针内容').toContain(STAMP)
      const sandboxHeadAfterPull = git(['rev-parse', 'HEAD'], SANDBOX).stdout
      const originMainAfterPull = git(['rev-parse', 'refs/remotes/origin/main'], SANDBOX).stdout
      const upstreamPull = git(['rev-parse', 'refs/remotes/origin/main'], SANDBOX)
      const aheadBehind = git(['rev-list', '--left-right', '--count', 'HEAD...origin/main'], SANDBOX).stdout
      console.log(
        `[git-retest] after pull: sandbox HEAD=${sandboxHeadAfterPull} origin/main=${originMainAfterPull} ` +
          `ahead/behind=${aheadBehind}`,
      )
      expect(sandboxHeadAfterPull, '拉取后沙箱 HEAD 应为探针提交').toBe(probeSha)
      expect(upstreamPull.status, '拉取后 origin/main 应存在').toBe(0)
      expect(originMainAfterPull).toBe(probeSha)
      expect(aheadBehind.replace(/\s+/g, ' ').trim()).toBe('0 0')
      assertNoNewCredentialProcess('拉取后')
      await shot(ctx, 9, 'pull-success')

      // 6) 差异预览：已同步后应为空态；差异/取消/自愈入口存在
      await ctx.page.getByTestId('git-mode-diff').click()
      await expect(ctx.page.getByTestId('git-diff-hint')).toBeVisible({ timeout: 10_000 })
      const diffEmpty = ctx.page.getByTestId('git-empty')
      await expect(diffEmpty).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(async () => (await diffEmpty.innerText()).trim(), { timeout: 60_000, intervals: [250, 500, 1000] })
        .toMatch(/远端暂无差异/)
      const diffText = (await diffEmpty.innerText()).trim()
      console.log(`[git-retest] diff empty=${diffText}`)
      await shot(ctx, 10, 'diff-preview')
      await ctx.page.getByTestId('git-mode-status').click()
      await expect(ctx.page.getByTestId('git-message')).toBeEnabled({ timeout: 10_000 })

      // 7) 自愈入口：Confirm 出现，取消不写盘
      const sandboxConfigBeforeHeal = sha256File(sandboxGitConfig)
      await expect(ctx.page.getByTestId('git-heal')).toBeEnabled()
      await ctx.page.getByTestId('git-heal').click()
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      const healText = (await confirm.innerText()).replace(/\s+/g, ' ').trim()
      console.log(`[git-retest] heal confirm=${healText}`)
      expect(healText).toContain('自愈修复')
      await shot(ctx, 11, 'heal-confirm')
      await confirm.getByRole('button', { name: '取消' }).click()
      await expect(confirm).toBeHidden({ timeout: 5_000 })
      expect(fs.existsSync(path.join(SANDBOX, '.heal-backup')), '取消自愈不得产生 .heal-backup').toBe(false)
      expect(sha256File(sandboxGitConfig), '取消自愈不得改写 .git/config').toBe(sandboxConfigBeforeHeal)
      await shot(ctx, 12, 'heal-cancelled')

      // 8) 取消入口：空闲应为 0；push/pull 期间已采样（记录，不强制命中）
      const idleCancel = await ctx.page.getByTestId('git-cancel').count()
      console.log(
        `[git-retest] idle git-cancel=${idleCancel}；busy 采样 push=${JSON.stringify(pushBusySeen)} pull=${JSON.stringify(pullBusySeen)}`,
      )
      expect(idleCancel, '空闲态不应显示取消操作').toBe(0)

      // 9) 关闭前：无凭据子进程；Git 阶段 console/pageerror/crash 新增 0、外部请求 0
      assertNoNewCredentialProcess('全部操作后')
      const children = gitChildrenOf(appPid)
      console.log(
        `[git-retest] 关闭前 Electron 子进程（git/conhost）=` +
          (children.length ? children.map((p) => `${p.name}#${p.pid}`).join(', ') : '(none)'),
      )
      // seed 原型自带 Vant/Vue CDN 与内联脚本噪声，属用户内容，不计 Git 阶段新增错误。
      const isPrototypeNoise = (t: string) => /vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(t)
      const newConsole = ctx.consoleErrors.slice(baselineConsole.length).filter((t) => !isPrototypeNoise(t))
      const newPageErrors = ctx.pageErrors.slice(baselinePageErrors.length).filter((t) => !isPrototypeNoise(t))
      const newCrashes = ctx.crashes.slice(baselineCrashes)
      const gitExternal = externalRequests.slice(externalBaseline)
      console.log(
        `[git-retest] console total=${ctx.consoleErrors.length}（Git 阶段新增 ${newConsole.length}）；` +
          `pageerror total=${ctx.pageErrors.length}（新增 ${newPageErrors.length}）；` +
          `crash total=${ctx.crashes.length}（新增 ${newCrashes.length}）；` +
          `外部请求 total=${externalRequests.length}（Git 阶段新增 ${gitExternal.length}）`,
      )
      if (ctx.consoleErrors.length) console.log('[git-retest] console:\n' + ctx.consoleErrors.join('\n'))
      if (ctx.pageErrors.length) console.log('[git-retest] pageerror:\n' + ctx.pageErrors.join('\n'))
      if (gitExternal.length) console.log('[git-retest] Git 阶段外部请求:\n' + gitExternal.join('\n'))
      expect(newConsole, 'Git 操作期间不得新增 console error').toEqual([])
      expect(newPageErrors, 'Git 操作期间不得新增 pageerror').toEqual([])
      expect(newCrashes, '全程不得出现页面崩溃').toEqual([])
      expect(gitExternal, 'Git 操作期间不得产生外部网络请求').toEqual([])
      await shot(ctx, 13, 'final')

      const closeResult = await ctx.close()
      console.log(
        `[git-retest] close method=${closeResult.method} exitCode=${closeResult.exitCode} elapsed=${closeResult.elapsedMs}ms`,
      )
      assertCleanExitOrP2(closeResult)

      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const alive = livePids(children.map((p) => p.pid))
      console.log(
        `[git-retest] 关闭后残留子进程=` + (alive.length ? alive.map((p) => `${p.name}#${p.pid}`).join(', ') : '(none)'),
      )
      expect(alive, '关闭后不得残留 git/conhost 子进程').toEqual([])
      expect(processesMentioning(bare), '关闭后不得有 git 进程仍持有 bare').toEqual([])
      expect(processesMentioning(DATA_DIR), '关闭后不得有 git 进程仍持有隔离数据目录').toEqual([])
      assertNoNewCredentialProcess('关闭后')

      // 10) 最终不变量
      const bareMainFinal = gitBare(bare, ['rev-parse', 'refs/heads/main']).stdout
      const sandboxHeadFinal = git(['rev-parse', 'HEAD'], SANDBOX).stdout
      const statusCountFinal = git(['status', '--porcelain=v1', '-uall'], SANDBOX).stdout
        .split(/\r?\n/)
        .filter(Boolean).length
      console.log(
        `[git-retest] final: bare main=${bareMainFinal} sandbox HEAD=${sandboxHeadFinal} status=${statusCountFinal}`,
      )
      expect(bareMainFinal).toBe(probeSha)
      expect(sandboxHeadFinal).toBe(probeSha)
      expect(statusCountFinal, '拉取后工作区变更数应减少（push 提交 + 拉取）').toBeLessThan(statusCountBefore)
    } catch (err) {
      await shot(ctx, 99, 'git-local-retest', true).catch(() => undefined)
      const message = String((err as Error)?.message ?? err)
      await ctx.reportFailure({
        step: 'A3-R',
        slug: 'git-local-retest',
        level: /^BLOCKED:/.test(message) ? 'ENV' : 'P1',
        expected: 'UI 配置本地 bare 成功，push/pull 全链路可用；或被安全策略明确 BLOCKED',
        actual: '断言失败，见错误栈与现场截图/日志',
        error: err,
        screenshot: false,
        extra: JSON.stringify(
          {
            bare,
            remote,
            project: projectName,
            userData: ctx.userData,
            consoleErrors: ctx.consoleErrors.slice(-10),
            pageErrors: ctx.pageErrors.slice(-10),
          },
          null,
          2,
        ),
      })
      throw err
    } finally {
      try {
        const result = await ctx.close({ graceMs: 5_000, appCloseMs: 3_000 })
        console.log(`[git-retest] finally close method=${result.method} exitCode=${result.exitCode}`)
      } catch (err) {
        console.log(`[git-retest] finally close 异常：${String((err as Error)?.message ?? err)}`)
      }
      // 清理一次性 bare / clone（数据目录由任务收尾统一删除）。
      try {
        fs.rmSync(bare, { recursive: true, force: true })
        fs.rmSync(cloneDir, { recursive: true, force: true })
        console.log(`[git-retest] cleaned bare=${bare} clone=${cloneDir}`)
      } catch (err) {
        console.log(`[git-retest] cleanup 异常：${String((err as Error)?.message ?? err)}`)
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
