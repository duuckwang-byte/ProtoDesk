/**
 * e2e/electron-functional.spec.ts — W3 真操作功能验收（不是只开面板）。
 *
 * 用 Playwright `_electron` 拉起真实 Electron（PLAND_RENDERER=react），按用户路径
 * 依次执行 9 步真实操作，每步记录 PASS / FAIL / SKIP + 截图：
 *   1. 冷启动主窗 + 项目选择（测试1）
 *   2. 侧栏真实原型数据 + 点第一个原型
 *   3. 预览 iframe / srcdoc
 *   4. 移动端 375×780 舞台
 *   5. 文档面板正文 + 最新需求 Tab
 *   6. 设置 6 Tab + Agent 真实行/空态
 *   7. 导出菜单 + 导出源码包（JSON 下载）
 *   8. AI 对话模型选择器（只读，不发送消息）
 *   9. 关窗并断言进程 15s 内退出
 *
 * 运行：npx playwright test e2e/electron-functional.spec.ts
 * 截图：docs/wave3-functional-shots/*.png
 *
 * 说明：下载在 Electron + Playwright 下不保证触发 page 'download' 事件。
 * 本文件在主进程注册 will-download 重定向到临时目录，既能避开原生保存弹窗，
 * 又能以“文件真实落盘”作为更强证据；事件拿不到时按任务口径退化为 toast +
 * 无致命 console error，并标 SKIP（原因写入报告）。
 *
 * 收尾说明：Playwright 以 stdio: "pipe" 启动 Electron 会创建 5 条管道（fd0=ignore，fd1..4=pipe），
 * 设置/AI 面板探测 Agent CLI 拉起的子进程（实测 codebuddy --acp）会继承 fd3/fd4；主进程 exit:0 后探测进程仍可能存活，
 * 写端不关 → Node ChildProcess 不派发 'close' → Playwright launchProcess 留在 gracefullyCloseSet
 * → worker 收尾空等 30s。本文件在 exit 后主动销毁 5 条启动管道读端（不改产品代码）。
 */
import { test, expect } from '@playwright/test'
import { spawnSync, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ElectronApplication, Page } from 'playwright'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _electron } = require('playwright') as typeof import('playwright')

const ROOT = path.resolve(__dirname, '..')
const SHOT_DIR = path.join(ROOT, 'docs', 'wave3-functional-shots')

const GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
}

type StepStatus = 'PASS' | 'FAIL' | 'SKIP'

interface StepResult {
  no: number
  title: string
  status: StepStatus
  evidence: string
  shots: string[]
  ms: number
}

interface StepOutcome {
  status?: StepStatus
  evidence: string
  shots?: string[]
}

const results: StepResult[] = []
const failures: string[] = []
const consoleErrors: string[] = []

function isFatal(text: string): boolean {
  const t = text.toLowerCase()
  const ignored = [
    'favicon',
    'third-party',
    'thirdparty',
    'react devtools',
    'devtools',
    'resizeobserver loop',
    'autofill',
    // 用户原型夹具自身引用的第三方 CDN（大厅.html 的 Vant/Vue）及其中脚本语法噪声，
    // 属沙箱内容而非工具前端；工具无法修正用户 HTML。
    'cdn.jsdelivr.net',
    'unpkg.com',
    'vant',
    "unexpected token '.'",
  ]
  return !ignored.some((s) => t.includes(s))
}

function attachCollectors(page: Page): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 1000))
  })
  page.on('pageerror', (err) => {
    consoleErrors.push('pageerror: ' + String(err?.message ?? err).slice(0, 1000))
  })
}

async function snap(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const abs = path.join(SHOT_DIR, name)
  await page.screenshot({ path: abs, fullPage: false })
  return path.relative(ROOT, abs).replace(/\\/g, '/')
}

async function runStep(
  page: Page,
  no: number,
  title: string,
  slug: string,
  fn: () => Promise<StepOutcome>,
): Promise<void> {
  const started = Date.now()
  try {
    const out = await fn()
    const status: StepStatus = out.status ?? 'PASS'
    const shots = out.shots ?? []
    results.push({ no, title, status, evidence: out.evidence, shots, ms: Date.now() - started })
    console.log(
      `[functional] STEP ${no} ${status} ${title} | ${out.evidence} | ${shots.join(',') || '-'} | ${Date.now() - started}ms`,
    )
    if (status === 'FAIL') failures.push(`${no}. ${title}: ${out.evidence}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    let shot = ''
    try {
      shot = await snap(page, `${slug}-FAIL.png`)
    } catch {
      /* 页面已关闭等场景无法截图 */
    }
    const shots = shot ? [shot] : []
    results.push({ no, title, status: 'FAIL', evidence: message, shots, ms: Date.now() - started })
    failures.push(`${no}. ${title}: ${message}`)
    console.log(`[functional] STEP ${no} FAIL ${title} | ${message} | ${shots.join(',') || '-'}`)
  }
}

/**
 * 销毁 Playwright 为 Electron 创建的 5 条启动管道读端（fd0 为 ignore，fd1..4 为 pipe）。
 * 残留的 Agent CLI 探测子进程会继承 fd3/fd4 的写端；不主动关闭读端时 ChildProcess
 * 永远不派发 'close'，Playwright worker 收尾会空等 30s。
 */
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

/** 异常/超时兜底：结束整棵 Electron 进程树，再关闭启动管道，避免 worker 收尾被拖住。 */
function disposeApp(app: ElectronApplication): void {
  let proc: ReturnType<ElectronApplication['process']>
  try {
    proc = app.process()
  } catch {
    // app 已随进程退出被 Playwright 释放（process() 会抛 _object 错误），无需再收尸。
    return
  }
  if (proc.exitCode === null) {
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
  }
  destroyLaunchStdio(proc)
}

interface CloseOutcome {
  /** exit 事件结果（exit:0 / timeout） */
  result: string
  /** 从 window.close() 到 exit 的耗时 */
  elapsed: number
  /** 从 window.close() 到 Playwright 启动管道 close 的耗时；未关闭为 -1 */
  closeElapsed: number
  /** ChildProcess 'close' 是否在 5s 内到达（Playwright worker 收尾依赖此事件） */
  closed: boolean
}

async function closeAndExpectExit(app: ElectronApplication, page: Page): Promise<CloseOutcome> {
  const proc = app.process()
  const started = Date.now()
  let closeAt = 0
  proc.once('close', () => {
    closeAt = Date.now()
  })
  const exited = new Promise<string>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(`exit:${proc.exitCode}`)
      return
    }
    proc.once('exit', (code) => resolve(`exit:${code}`))
  })
  await page.evaluate(() => window.close()).catch(() => undefined)
  const result = await Promise.race([
    exited,
    new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ])
  const elapsed = Date.now() - started
  if (result === 'timeout') disposeApp(app)

  // 主进程已退出：主动关闭启动管道读端，残留探测进程持有写端也不会拖住 'close'。
  destroyLaunchStdio(proc)
  const closed = await Promise.race([
    new Promise<boolean>((resolve) => {
      if (closeAt) {
        resolve(true)
        return
      }
      proc.once('close', () => resolve(true))
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (!closed) disposeApp(app)
  return { result, elapsed, closeElapsed: closed ? closeAt - started : -1, closed }
}

test.describe('W3 真操作功能验收', () => {
  test('A. React 真机 9 步功能操作 + 进程退出', async ({}, testInfo) => {
    test.setTimeout(300_000)

    const app = await _electron.launch({
      args: ['.'],
      cwd: ROOT,
      env: {
        ...process.env,
        ...GIT_NONINTERACTIVE_ENV,
        PLAND_RENDERER: 'react',
      } as Record<string, string>,
    })

    let exitedCleanly = false
    try {
      const page = await app.firstWindow()
      attachCollectors(page)
      await page.bringToFront().catch(() => undefined)

      // ── 1. 冷启动 + 项目选择 ──────────────────────────────────────────────
      await runStep(page, 1, '冷启动 / 项目选择', '01-cold-start', async () => {
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('topbar')).toBeVisible()
        await expect(page.getByTestId('stage-frame')).toBeVisible()
        // 等冷启动 IPC（sandbox.projects → 恢复上次项目 / 弹选择器）落地。
        await page.waitForTimeout(3_000)

        const picker = page.getByTestId('project-picker')
        const pickerShown = await picker.isVisible().catch(() => false)
        const shots: string[] = []
        if (pickerShown) {
          shots.push(await snap(page, '01-project-picker.png'))
          await expect(picker.getByText('选择项目')).toBeVisible()
          const row = picker.locator('li').filter({ hasText: '测试1' }).first()
          const visible = await row
            .waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true)
            .catch(() => false)
          if (!visible) {
            const list = (await picker.locator('li').allInnerTexts()).map((s) => s.trim())
            throw new Error(`项目选择器未列出「测试1」；可见项目：${list.join(' / ') || '（空）'}`)
          }
          await row.getByRole('button').first().click()
          await picker.getByRole('button', { name: '进入项目' }).click()
          await expect(picker).toBeHidden({ timeout: 30_000 })
        }

        // 移动端默认展开侧栏；若上次会话手动收起，顶栏左侧开关展开后再读项目/原型树。
        if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
          await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
        }
        await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
        const project = (await page.locator('[data-testid="sidebar"] button[title="切换项目"]').innerText())
          .replace(/\s+/g, ' ')
          .trim()
        if (project !== '测试1') {
          throw new Error(`期望进入测试数据项目「测试1」，实际当前项目为「${project || '空'}」`)
        }
        await expect(page.getByTestId('sidebar-tree')).toBeVisible()
        shots.push(await snap(page, '01-main-window.png'))
        return {
          evidence: `main-window 可见；项目选择器=${pickerShown ? '出现 → 选择「测试1」进入' : '未出现（自动恢复上次项目）'}；当前项目=「${project}」`,
          shots,
        }
      })

      // ── 2. 侧栏真实数据 + 点第一个原型 ────────────────────────────────────
      await runStep(page, 2, '侧栏真实数据 / 点击原型', '02-sidebar', async () => {
        const sidebar = page.getByTestId('sidebar')
        const protos = sidebar.locator('button[data-level="proto"]')
        await expect.poll(() => protos.count(), { timeout: 20_000 }).toBeGreaterThan(0)
        const names = (await protos.allInnerTexts()).map((s) => s.trim()).filter(Boolean)
        const fake = names.filter((n) => n.includes('示例'))
        expect(fake, '侧栏不应出现「示例」占位/假数据').toStrictEqual([])
        expect(names.length).toBeGreaterThan(0)

        await protos.first().click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
          timeout: 15_000,
        })
        const pill = (await page.getByTestId('loc-pill').innerText()).replace(/\s+/g, ' ').trim()
        const shot = await snap(page, '02-sidebar.png')
        return {
          evidence: `侧栏原型数=${names.length}；名称=${names.join(' / ')}；已点击「${names[0]}」；面包屑=${pill}`,
          shots: [shot],
        }
      })

      // ── 3. 预览 iframe / srcdoc ───────────────────────────────────────────
      await runStep(page, 3, '预览 iframe / srcdoc', '03-preview', async () => {
        const frames = page.getByTestId('preview-frame')
        await expect(frames).toHaveCount(1)
        await expect(frames).toBeVisible({ timeout: 20_000 })
        await expect
          .poll(async () => ((await frames.getAttribute('srcdoc')) || '').trim().length, {
            timeout: 20_000,
          })
          .toBeGreaterThan(0)
        const srcdocLen = ((await frames.getAttribute('srcdoc')) || '').length
        let bodyLen = 0
        let bodyText = ''
        try {
          bodyText = await page
            .frameLocator('[data-testid="preview-frame"]')
            .locator('body')
            .innerText({ timeout: 8_000 })
          bodyLen = bodyText.trim().length
        } catch {
          /* 沙箱 opaque origin 下若无法读取正文，srcdoc 非空仍满足断言 */
        }
        expect(srcdocLen, 'iframe srcdoc 应非空').toBeGreaterThan(0)
        const shot = await snap(page, '03-preview.png')
        return {
          evidence: `iframe 数量=1；srcdoc 长度=${srcdocLen}；iframe body 文本长度=${bodyLen}（${bodyText.slice(0, 40).replace(/\s+/g, ' ')}）`,
          shots: [shot],
        }
      })

      // ── 4. 移动端 375 逻辑宽 + 动态视口高 ───────────────────────────────
      await runStep(page, 4, '移动端 375 逻辑宽舞台', '04-mobile', async () => {
        const mobileBtn = page.locator('button[title="移动端舞台（375 逻辑宽）"]')
        await expect(mobileBtn).toBeVisible()
        await mobileBtn.click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', {
          timeout: 10_000,
        })
        const viewport = page.getByTestId('stage-viewport')
        await expect(viewport).toBeVisible()
        const metrics = await viewport.evaluate((el) => {
          const node = el as HTMLElement
          const rect = node.getBoundingClientRect()
          return {
            width: node.style.width,
            height: node.style.height,
            renderedWidth: Math.round(rect.width),
            renderedHeight: Math.round(rect.height),
          }
        })
        expect(metrics.width, '移动端逻辑宽度').toBe('375px')
        // W5 动态视口高：高度随可用区变化（不再固定 780）。
        expect(
          Number.parseFloat(metrics.height),
          `移动端逻辑视口高应为动态正值，实测 ${metrics.height}`,
        ).toBeGreaterThan(300)
        const shot = await snap(page, '04-mobile-dynamic-viewport.png')
        return {
          evidence: `stage-frame[data-kind=mobile]；stage-viewport 逻辑尺寸=${metrics.width}×${metrics.height}，屏幕渲染=${metrics.renderedWidth}×${metrics.renderedHeight}`,
          shots: [shot],
        }
      })

      // ── 5. 文档面板 + 最新需求 Tab ────────────────────────────────────────
      await runStep(page, 5, '文档面板 / 最新需求', '05-docs', async () => {
        // 移动端默认已打开文档：仅在未打开时点入口，避免把默认打开的文档切换关闭。
        const panel = page.getByTestId('docs-panel')
        if (!(await panel.isVisible().catch(() => false))) {
          await page.getByRole('button', { name: '文档', exact: true }).click()
        }
        await expect(panel).toBeVisible({ timeout: 10_000 })
        await expect(panel.getByRole('tab', { name: '功能说明' })).toBeVisible()
        const preview = panel.getByTestId('doc-preview')
        await expect
          .poll(async () => (await preview.innerText().catch(() => '')).trim().length, {
            timeout: 20_000,
          })
          .toBeGreaterThan(0)
        const descText = (await preview.innerText()).trim()
        const descLen = descText.length
        const descHead = descText.split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
        const shots = [await snap(page, '05-docs-desc.png')]

        // 文档 Markdown 真渲染：PRD 含表格；不再是纯文本/原始 Markdown 直出。
        await expect(preview.locator('table').first()).toBeVisible({ timeout: 10_000 })
        const tableCount = await preview.locator('table').count()

        // 历史回归：移动端 inline 文档曾与浮层工具栏/弹层同级而互相遮挡。
        // 现在移动端文档 z-40、Dialog/Sheet z-50；仍保留命中检查，Tab 中心点必须命中 docs-panel。
        // 本步如实尝试一次；若被遮挡则保留证据并切回 PC 完成 Tab 验证（不改业务代码）。
        let mobileTabBlocked = false
        let mobileTabError = ''
        const latestTab = panel.getByRole('tab', { name: '最新需求' })
        // P0/P1 回归：浮层不再遮挡——Tab 中心点必须命中 docs-panel（而非 overlays-toolbar）。
        const hit = await latestTab.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const node = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null
          const owner = node?.closest('[data-testid]') as HTMLElement | null
          return {
            insideDocs: !!(node && node.closest('[data-testid="docs-panel"]')),
            owner: owner?.getAttribute('data-testid') || node?.tagName || 'none',
          }
        })
        expect(
          hit.insideDocs,
          `「最新需求」Tab 中心点应命中 docs-panel，实际命中=${hit.owner}（浮层遮挡回归）`,
        ).toBe(true)
        try {
          await latestTab.click({ timeout: 2_500 })
        } catch (err) {
          mobileTabBlocked = true
          mobileTabError = (err instanceof Error ? err.message : String(err)).split('\n')[0]
          shots.push(await snap(page, '05-docs-mobile-overlap.png'))
          await page.locator('button[title="桌面端舞台"]').click()
          await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', {
            timeout: 10_000,
          })
          // 切 PC 会在切换瞬间关闭移动端默认打开的文档；按用户操作重新打开后再验证 Tab。
          await expect(page.getByTestId('docs-panel')).toBeHidden({ timeout: 10_000 })
          await page.getByRole('button', { name: '文档', exact: true }).click()
          const pcPanel = page.getByTestId('docs-panel')
          await expect(pcPanel).toBeVisible({ timeout: 10_000 })
          await expect
            .poll(async () => (await pcPanel.getByTestId('doc-preview').innerText().catch(() => '')).trim().length, {
              timeout: 20_000,
            })
            .toBeGreaterThan(0)
          await pcPanel.getByRole('tab', { name: '最新需求' }).click({ timeout: 10_000 })
        }
        await expect(panel.getByRole('tab', { name: '最新需求' })).toHaveAttribute(
          'aria-selected',
          'true',
          { timeout: 10_000 },
        )
        await page.waitForTimeout(1_500)
        const latestText = (await preview.innerText().catch(() => '')).trim()
        shots.push(await snap(page, '05-docs-latest.png'))

        // 收尾：Esc 关闭文档面板（closeTopmost），避免面板挤压/遮挡影响后续顶栏操作。
        await page.keyboard.press('Escape')
        await expect(panel).toBeHidden({ timeout: 5_000 })

        return {
          evidence: `docs-panel 可见；功能说明正文长度=${descLen}（首行：${descHead}）；Markdown 表格=${tableCount} 个（已渲染）；最新需求长度=${latestText.length}（${latestText === '暂无最新需求' ? '空态：暂无最新需求' : latestText.slice(0, 40).replace(/\s+/g, ' ')}）；Tab 命中=${hit.owner}（docs-panel 内）；移动端 Tab 点击=${mobileTabBlocked ? `被 overlays-toolbar 遮挡（${mobileTabError}），已切 PC 完成` : '直接成功'}`,
          shots,
        }
      })

      // ── 6. 设置 6 Tab + Agent 真实数据 ────────────────────────────────────
      await runStep(page, 6, '设置 6 Tab / Agent 数据', '06-settings', async () => {
        // 设置入口已收敛到侧栏底部（顶栏移除设置按钮）；移动端默认展开，手动收起时兜底展开。
        if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
          await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
        }
        await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
        const dlg = page.getByTestId('settings-dialog')
        await expect(dlg).toBeVisible({ timeout: 10_000 })
        const tabs = dlg.getByRole('tab')
        await expect(tabs).toHaveCount(6)
        const tabTexts = (await tabs.allInnerTexts()).map((s) => s.trim())
        await expect(page.getByTestId('settings-loading')).toBeHidden({ timeout: 30_000 })
        await expect(page.getByTestId('agent-matrix')).toBeVisible()

        // P0/P1 回归：设置控件 32px 等高 + CLI/API 直连切换。
        const engineCli = page.getByTestId('engine-cli')
        const engineApi = page.getByTestId('engine-api')
        await expect(engineCli).toBeVisible()
        await expect(engineApi).toBeVisible()
        for (const [name, loc] of [
          ['本地 CLI', engineCli],
          ['API 直连', engineApi],
        ] as const) {
          const box = await loc.boundingBox()
          expect(box, `${name} 按钮应有布局盒`).not.toBeNull()
          expect(Math.round((box as { height: number }).height), `${name} 按钮高度应为 32px`).toBe(32)
        }

        let agentMode = ''
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          const rowCount = await page.locator('[data-testid^="agent-row-"]').count()
          if (rowCount > 0) {
            agentMode = 'rows'
            break
          }
          const emptyText = (await page.getByTestId('agent-empty').innerText().catch(() => '')).trim()
          if (emptyText.includes('未探测到')) {
            agentMode = 'empty'
            break
          }
          await page.waitForTimeout(250)
        }
        expect(agentMode, 'Agent 区应在超时内出现真实行或明确空态').not.toBe('')

        const agentIds = await page
          .locator('[data-testid^="agent-row-"]')
          .evaluateAll((els) =>
            els.map((el) => (el.getAttribute('data-testid') || '').replace('agent-row-', '')),
          )
        const dialogText = await dlg.innerText()
        expect(dialogText, '不得出现 DEFAULT_AGENTS 假数据文案').not.toContain('DEFAULT_AGENTS')
        expect(dialogText, '不得出现示例 Agent 占位文案').not.toMatch(/示例\s*Agent/)

        const shot = await snap(page, '06-settings-agent.png')
        const agentEvidence =
          agentMode === 'rows'
            ? `Agent 真实行=${agentIds.length}（${agentIds.join(' / ')}）`
            : 'Agent 明确空态（未探测到本地 Agent CLI，无占位/假数据）'
        await page.keyboard.press('Escape')
        await expect(dlg).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `Tab 数=${tabTexts.length}（${tabTexts.join(' / ')}）；引擎切换=本地 CLI / API 直连（高度 32px）；${agentEvidence}；DEFAULT_AGENTS 检查=通过`,
          shots: [shot],
        }
      })

      // ── 7. 导出菜单 + 导出源码包（JSON） ─────────────────────────────────
      await runStep(page, 7, '导出菜单 / 源码包下载', '07-export', async () => {
        // 收尾兜底：若文档仍打开，按 Esc 关闭后再开导出菜单（顶栏下拉 z-50 已高于文档 z-40）。
        if (await page.getByTestId('docs-panel').isVisible().catch(() => false)) {
          await page.keyboard.press('Escape')
          await expect(page.getByTestId('docs-panel')).toBeHidden({ timeout: 5_000 })
        }
        await page.getByTestId('export-menu').click()
        const menuIds = ['export-source', 'export-html', 'export-png', 'export-pdf', 'export-md']
        for (const id of menuIds) {
          await expect(page.getByTestId(id)).toBeVisible({ timeout: 10_000 })
        }
        const labels: string[] = []
        for (const id of menuIds) labels.push((await page.getByTestId(id).innerText()).trim())
        const shots = [await snap(page, '07-export-menu.png')]

        // 主进程把下载重定向到临时目录：避开原生保存弹窗，并以文件落盘为强证据。
        const downloadDir = path.join(os.tmpdir(), `pland-functional-${Date.now()}`)
        fs.mkdirSync(downloadDir, { recursive: true })
        const savePath = path.join(downloadDir, 'export-source.json')
        let handlerReady = false
        try {
          await app.evaluate(
            ({ session }, target) => {
              session.defaultSession.on('will-download', (_event, item) => {
                try {
                  item.setSavePath(target)
                } catch {
                  /* ignore */
                }
              })
            },
            savePath,
          )
          handlerReady = true
        } catch {
          handlerReady = false
        }

        let downloadEvent = false
        const onDownload = () => {
          downloadEvent = true
        }
        page.on('download', onDownload)

        let toastText = ''
        let toastAt = 0
        await page.getByTestId('export-source').click()

        // 等 toast / 文件落盘（最多 15s）；toast 一出现即截图，避免自动消失。
        let fileSize = 0
        let toastShot = ''
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          if (!toastText) {
            const toastLoc = page.locator('[data-slot="toast"]').first()
            if (await toastLoc.isVisible().catch(() => false)) {
              const raw = await toastLoc.innerText().catch(() => '')
              toastText = raw.replace(/\s+/g, ' ').trim()
              if (toastText) {
                toastAt = Date.now()
                toastShot = await snap(page, '07-export-source-toast.png')
              }
            }
          }
          if (fs.existsSync(savePath)) {
            fileSize = fs.statSync(savePath).size
            if (fileSize > 0) break
          }
          if (toastAt && Date.now() - toastAt > 6_000) break
          await page.waitForTimeout(200)
        }
        page.off('download', onDownload)
        if (!toastText && (fileSize > 0 || downloadEvent)) {
          // 文件落盘可能早于 sonner 挂载；补等最多 2.5s 捕获完成 toast。
          const toastLoc = page.locator('[data-sonner-toast]').first()
          const toastDeadline = Date.now() + 2_500
          while (Date.now() < toastDeadline) {
            if (await toastLoc.isVisible().catch(() => false)) {
              const raw = await toastLoc.innerText().catch(() => '')
              toastText = raw.replace(/\s+/g, ' ').trim()
              if (toastText) {
                toastShot = await snap(page, '07-export-source-toast.png')
                break
              }
            }
            await page.waitForTimeout(150)
          }
        }
        if (!toastText && !fileSize) {
          // 再给一次兜底时间（下载可能慢于 toast）。
          await page.waitForTimeout(1_500)
          if (fs.existsSync(savePath)) fileSize = fs.statSync(savePath).size
        }
        if (toastShot) shots.push(toastShot)
        shots.push(await snap(page, '07-export-source-result.png'))

        const fatalNow = consoleErrors.filter(isFatal)
        const actionTriggered = !!toastText || fileSize > 0 || downloadEvent
        if (!actionTriggered) {
          throw new Error(
            `点击导出后既无 toast、无 download 事件、也无文件落盘；fatal console error=${fatalNow.length}`,
          )
        }
        const hasRealDownload = fileSize > 0 || downloadEvent
        return {
          status: hasRealDownload ? 'PASS' : 'SKIP',
          evidence: `菜单项=${labels.length}（${labels.join(' / ')}）；download 事件=${downloadEvent ? '有' : '无'}；will-download 重定向=${handlerReady ? '已注册' : '注册失败'}；落盘=${fileSize ? `${fileSize} bytes @ ${savePath}` : '无'}；toast=${toastText || '未捕获'}；fatal console error=${fatalNow.length}${hasRealDownload ? '' : '；SKIP 原因：Electron+Playwright 未暴露 download 事件且文件未落盘，按口径以 toast/动作触发为准'}`,
          shots,
        }
      })

      // ── 8. AI 对话：模型选择器非空（不发送消息） ──────────────────────────
      await runStep(page, 8, 'AI 对话 / 模型列表', '08-ai', async () => {
        await page.getByRole('button', { name: 'AI 对话' }).click()
        const dialog = page.getByTestId('ai-dialog')
        await expect(dialog).toBeVisible({ timeout: 15_000 })
        const selectors = page.getByTestId('ai-model-selector')
        await expect(selectors.first()).toBeVisible({ timeout: 10_000 })
        const selectorCount = await selectors.count()
        // P0/P1 回归：AI 只保留 1 个模型/思考级联，且内部事件 acp_catalog 不得渲染成聊天文本。
        expect(selectorCount, 'AI 对话框应只有 1 个模型选择器').toBe(1)
        await expect(page.getByTestId('ai-model-select')).toHaveCount(1)
        await expect(page.getByTestId('ai-thinking-select')).toHaveCount(1)
        const aiText = await dialog.innerText()
        expect(aiText, 'acp_catalog 属内部事件，不得漏进对话正文').not.toContain('acp_catalog')

        // 等 settings-store 的模型清单落到选择器（占位「选择模型」不算）。
        let selected = ''
        const deadline = Date.now() + 25_000
        while (Date.now() < deadline) {
          const text = (await page.getByTestId('ai-model-select').first().innerText().catch(() => ''))
            .replace(/\s+/g, ' ')
            .trim()
          if (text && text !== '选择模型') {
            selected = text
            break
          }
          await page.waitForTimeout(250)
        }
        expect(selected, '模型选择器应显示来自 settings-store 的已选模型').not.toBe('')

        await page.getByTestId('ai-model-select').first().click()
        // 自研 Select（components/ui/select.tsx）不是 Radix：内容为
        // [data-slot="select-content"]，选项为 role="option"，没有 role="listbox"。
        const selectContent = page.locator('[data-slot="select-content"]').first()
        await expect(selectContent).toBeVisible({ timeout: 10_000 })
        await expect
          .poll(() => selectContent.getByRole('option').count(), { timeout: 10_000 })
          .toBeGreaterThan(0)
        const optionTexts = (await selectContent.getByRole('option').allInnerTexts())
          .map((s) => s.trim())
          .filter(Boolean)
        expect(optionTexts.join(' '), '模型列表不应是「暂无模型」空态').not.toContain('暂无模型')
        const listShot = await snap(page, '08-ai-model-list.png')

        // 点触发器收起下拉（不用 Esc：自研 Select 与 Dialog 都监听 Escape，会连带关掉弹窗）。
        await page.getByTestId('ai-model-select').first().click()
        await expect(selectContent).toBeHidden({ timeout: 5_000 })
        const dialogShot = await snap(page, '08-ai-dialog.png')

        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden({ timeout: 5_000 })
        return {
          evidence: `ai-dialog 可见；模型选择器=${selectorCount} 个级联；当前模型=${selected}；可选模型数=${optionTexts.length}（${optionTexts.slice(0, 5).join(' / ')}${optionTexts.length > 5 ? ' …' : ''}）；未发送消息`,
          shots: [listShot, dialogShot],
        }
      })

      // ── 9. 关闭 Electron + 进程退出 ──────────────────────────────────────
      await runStep(page, 9, '关闭进程 / 退出耗时', '09-exit', async () => {
        const shot = await snap(page, '09-before-close.png')
        const { result, elapsed, closed, closeElapsed } = await closeAndExpectExit(app, page)
        if (result === 'timeout') throw new Error('Electron 主进程 15s 内未退出')
        expect(elapsed, '退出耗时应在 15s 内').toBeLessThanOrEqual(15_000)
        expect(closed, 'Electron 启动管道应在主进程退出后 5s 内关闭（worker 收尾依赖 close）').toBe(true)
        exitedCleanly = true
        return {
          evidence: `主进程退出事件=${result}；exit 耗时=${elapsed}ms（≤15000ms 断言通过）；启动管道 close=${closeElapsed}ms`,
          shots: [shot],
        }
      })

      // ── 结算 ─────────────────────────────────────────────────────────────
      const fatal = consoleErrors.filter(isFatal)
      console.log(`[functional] CONSOLE_ERRORS_TOTAL=${consoleErrors.length}`)
      if (consoleErrors.length) console.log('[functional] CONSOLE_ERRORS\n' + consoleErrors.join('\n'))
      console.log(`[functional] CONSOLE_ERRORS_FATAL=${fatal.length}`)
      if (fatal.length) console.log('[functional] FATAL_ERRORS\n' + fatal.join('\n'))
      console.log('[functional] SUMMARY\n' + JSON.stringify(results, null, 2))
      testInfo.annotations.push({
        type: 'functional-summary',
        description: results
          .map((r) => `${r.no}.${r.status} ${r.title}${r.shots.length ? ' [' + r.shots.join('; ') + ']' : ''}`)
          .join(' | '),
      })

      expect(failures, `功能验收失败：\n${failures.join('\n')}`).toStrictEqual([])
      expect(fatal, `致命 console error：\n${fatal.join('\n')}`).toStrictEqual([])
      if (consoleErrors.length) console.log('[functional] 非致命 console error 已记录，见报告。')
    } finally {
      if (!exitedCleanly) {
        // 失败也尽量收尸：结束整棵 Electron 树 + 关闭启动管道，避免 worker 收尾超时。
        disposeApp(app)
      }
    }
  })

  /**
   * B. P0/P1 回归复核（本轮 UI 定稿契约）
   * 覆盖：Git 660 Dialog / 顶栏项目下拉+刷新+终端 / 侧栏三层真实拖拽 /
   * 设置 32px + CLI-API / 文档 Markdown + 目录 / AI 单选择器 + 无 acp_catalog。
   * 与 A 分开是为了不改变 A 的 9 步编号与历史截图口径。
   */
  test('B. P0/P1 回归复核（Git/顶栏/侧栏/设置/文档/AI）', async ({}, testInfo) => {
    test.setTimeout(240_000)
    const app = await _electron.launch({
      args: ['.'],
      cwd: ROOT,
      env: {
        ...process.env,
        ...GIT_NONINTERACTIVE_ENV,
        PLAND_RENDERER: 'react',
      } as Record<string, string>,
    })
    let exitedCleanly = false
    const checks: string[] = []
    try {
      const page = await app.firstWindow()
      attachCollectors(page)
      await page.bringToFront().catch(() => undefined)
      await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(3_000)

      // 冷启动可能弹项目选择器：优先进入真实项目「测试1」。
      const picker = page.getByTestId('project-picker')
      if (await picker.isVisible().catch(() => false)) {
        const row = picker.locator('li').filter({ hasText: '测试1' }).first()
        await row.getByRole('button').first().click()
        await picker.getByRole('button', { name: '进入项目' }).click()
        await expect(picker).toBeHidden({ timeout: 30_000 })
      }
      if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
        await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
      }
      await expect(page.getByTestId('sidebar-tree')).toBeVisible()
      // 选中第一个原型，保证舞台/文档有上下文。
      const protos = page.getByTestId('sidebar').locator('button[data-level="proto"]')
      await expect.poll(() => protos.count(), { timeout: 20_000 }).toBeGreaterThan(0)
      await protos.first().click()
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
        timeout: 15_000,
      })
      // 首页原型自身是移动端 kind（enterSource 会同步 app.kind）；显式切 PC 以验证 PC 文档目录侧栏。
      await page.locator('button[title="桌面端舞台"]').click()
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', {
        timeout: 10_000,
      })
      // 切 PC 只在 mobile → PC 的切换瞬间关闭文档（侧栏保留），不再需要手动关闭；
      // 后续顶栏下拉不会被文档 overlay 遮挡（用例在步骤 5 重新打开验证）。
      await expect(page.getByTestId('docs-panel'), '切 PC 应关闭移动端默认打开的文档').toBeHidden({
        timeout: 10_000,
      })

      // ── 1) 顶栏：项目下拉 / 刷新 / 终端 ────────────────────────────────
      await expect(page.getByTestId('topbar-refresh')).toBeVisible()
      await expect(page.getByTestId('topbar-refresh')).toBeEnabled()
      await expect(page.getByTestId('topbar-terminal')).toBeVisible()
      await expect(page.getByTestId('topbar-terminal')).toBeEnabled()
      await page.getByTestId('project-switch').click()
      await expect(page.getByTestId('project-menu')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('project-search')).toBeVisible()
      await expect(page.getByTestId('project-create-input')).toBeVisible()
      const projectOptions = await page.getByTestId('project-menu').locator('[role="option"]').count()
      expect(projectOptions, '项目下拉应列出真实项目').toBeGreaterThan(0)
      const topbarShot = await snap(page, '10-p0p1-topbar-project.png')
      await page.getByTestId('project-switch').click()
      await expect(page.getByTestId('project-menu')).toBeHidden({ timeout: 5_000 })
      // 项目菜单展开会触发一次 sources 刷新；等分组/原型树状态落定后再计数，避免读到过渡态。
      await page.waitForTimeout(1_000)
      checks.push(`顶栏=项目下拉(${projectOptions}项)/刷新/终端`)

      // ── 2) 侧栏三层 + 真实拖拽 wiring ──────────────────────────────────
      const tree = page.getByTestId('sidebar-tree')
      const groupCount = await tree.locator('[data-level="group"]').count()
      const protoCount = await tree.locator('button[data-level="proto"]').count()
      const subCount = await tree.locator('button[data-level="subpage"]').count()
      expect(protoCount, '侧栏应有原型层').toBeGreaterThan(0)
      const grips = tree.locator('button[aria-grabbed]')
      const gripCount = await grips.count()
      expect(gripCount, '每个原型行都应有拖拽手柄').toBeGreaterThanOrEqual(protoCount)
      if (groupCount > 0) {
        await expect(tree.locator('[data-level="group-row"]').first()).toHaveAttribute('draggable', 'true')
      }
      const protoRow = page.locator('[data-key][draggable="true"]').first()
      await expect(protoRow).toHaveAttribute('draggable', 'true')
      await protoRow.evaluate((el) => {
        const dt = new DataTransfer()
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      })
      await expect(protoRow).toHaveAttribute('data-dragging', 'true', { timeout: 5_000 })
      await protoRow.evaluate((el) => {
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))
      })
      await expect(protoRow).toHaveAttribute('data-dragging', 'false', { timeout: 5_000 })
      checks.push(`侧栏=三层可拖(文件夹${groupCount}/原型${protoCount}/子页${subCount})+手柄${gripCount}，dragstart→data-dragging=true`)

      // ── 3) Git：居中 Dialog 660 ────────────────────────────────────────
      await page.getByRole('button', { name: 'Git 管理' }).click()
      const gitDialog = page.getByTestId('git-sheet')
      await expect(gitDialog).toBeVisible({ timeout: 15_000 })
      await expect(gitDialog).toHaveAttribute('data-surface', 'dialog')
      const gitBox = await gitDialog.boundingBox()
      expect(gitBox, 'Git Dialog 应有布局盒').not.toBeNull()
      const gitWidth = Math.round((gitBox as { width: number }).width)
      expect(gitWidth, 'Git Dialog 宽度应为 660px').toBe(660)
      const gitShot = await snap(page, '10-p0p1-git-dialog.png')
      await page.keyboard.press('Escape')
      await expect(gitDialog).toBeHidden({ timeout: 5_000 })
      checks.push(`Git=居中 Dialog ${gitWidth}px（data-surface=dialog）`)

      // ── 4) 设置：32px 等高 + CLI/API 直连 ─────────────────────────────
      // 设置入口收敛为侧栏底部唯一按钮；移动端默认展开，手动收起时兜底展开。
      if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
        await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
      }
      await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
      const settings = page.getByTestId('settings-dialog')
      await expect(settings).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('agent-matrix')).toBeVisible({ timeout: 20_000 })
      const engineHeights: number[] = []
      for (const id of ['engine-cli', 'engine-api']) {
        const box = await page.getByTestId(id).boundingBox()
        expect(box, `${id} 应有布局盒`).not.toBeNull()
        engineHeights.push(Math.round((box as { height: number }).height))
      }
      expect(engineHeights, 'CLI/API 按钮高度均为 32px').toStrictEqual([32, 32])
      const settingsText = await settings.innerText()
      expect(settingsText).toContain('本地 CLI')
      expect(settingsText).toContain('API 直连')
      const settingsShot = await snap(page, '10-p0p1-settings-32px-cliapi.png')
      await page.keyboard.press('Escape')
      await expect(settings).toBeHidden({ timeout: 5_000 })
      checks.push(`设置=CLI/API 按钮 ${engineHeights.join('/')}px`)

      // ── 5) 文档：Markdown 渲染 + 目录 ─────────────────────────────────
      const docs = page.getByTestId('docs-panel')
      // 默认打开口径下文档可能已展开：仅在未打开时点击入口，避免误切换为关闭。
      if (!(await docs.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: '文档', exact: true }).click()
      }
      await expect(docs).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('doc-toc-sidebar')).toBeVisible({ timeout: 10_000 })
      const tocCount = await page.getByTestId('doc-toc-item').count()
      expect(tocCount, '文档目录应有真实条目标题').toBeGreaterThan(0)
      const preview = docs.getByTestId('doc-preview')
      await expect(preview.locator('table').first()).toBeVisible({ timeout: 20_000 })
      const docTableCount = await preview.locator('table').count()
      const docShot = await snap(page, '10-p0p1-docs-toc-markdown.png')
      await page.keyboard.press('Escape')
      await expect(docs).toBeHidden({ timeout: 5_000 })
      checks.push(`文档=目录${tocCount}条+Markdown表格${docTableCount}个`)

      // ── 6) AI：单选择器 + 无 acp_catalog 泄漏 ─────────────────────────
      await page.getByRole('button', { name: 'AI 对话' }).click()
      const ai = page.getByTestId('ai-dialog')
      await expect(ai).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('ai-model-select')).toHaveCount(1)
      await expect(page.getByTestId('ai-thinking-select')).toHaveCount(1)
      const aiSelectorCount = await page.getByTestId('ai-model-selector').count()
      expect(aiSelectorCount, 'AI 对话框模型选择器应恰为 1 个').toBe(1)
      const aiText = await ai.innerText()
      expect(aiText, 'acp_catalog 内部事件不得出现在对话正文').not.toContain('acp_catalog')
      const aiShot = await snap(page, '10-p0p1-ai-single-selector.png')
      await page.keyboard.press('Escape')
      await expect(ai).toBeHidden({ timeout: 5_000 })
      checks.push('AI=1 个模型选择器，无 acp_catalog 文本')

      testInfo.annotations.push({ type: 'p0p1-regression', description: checks.join(' | ') })
      testInfo.annotations.push({
        type: 'p0p1-shots',
        description: [topbarShot, gitShot, settingsShot, docShot, aiShot].join('; '),
      })
      console.log('[functional][P0P1] ' + checks.join(' | '))

      const fatal = consoleErrors.filter(isFatal)
      expect(fatal, `致命 console error：\n${fatal.join('\n')}`).toStrictEqual([])

      const { result, elapsed, closed, closeElapsed } = await closeAndExpectExit(app, page)
      exitedCleanly = true
      expect(result, 'Electron 主进程应在 15s 内退出').not.toBe('timeout')
      expect(elapsed, '退出耗时应在 15s 内').toBeLessThanOrEqual(15_000)
      expect(closed, 'Electron 启动管道应在主进程退出后 5s 内关闭（worker 收尾依赖 close）').toBe(true)
      console.log(`[functional][P0P1] 退出=${result} ${elapsed}ms；close=${closeElapsed}ms`)
    } finally {
      if (!exitedCleanly) {
        // 失败也尽量收尸：结束整棵 Electron 树 + 关闭启动管道，避免 worker 收尾超时。
        disposeApp(app)
      }
    }
  })
})
