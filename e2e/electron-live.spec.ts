/**
 * e2e/electron-live.spec.ts — W3 最终真机验收（Playwright `_electron` 拉起真实 Electron）。
 *
 * 与其它 e2e 的“静态契约”不同：本文件真的启动 Electron 主进程（main.js），
 * 走 file:// 加载 dist/renderer，验证 React 主窗骨架、四个顶栏入口弹层与 Esc 关闭，
 * 并验证 PLAND_RENDERER=legacy 的旧版回退；最后断言主进程正常退出。
 *
 * 运行：npx playwright test e2e/electron-live.spec.ts
 * 截图：docs/wave3-react-live.png（有项目选择器时截选择器，否则截主窗骨架）
 *
 * 注：Playwright 的 electronApplication.close() 在打开过 Git / 设置 / AI 面板后会出现
 * “进程已退出但 Promise 不 resolve”的假死（已实测 proc.exitCode === 0）。
 * 根因：Playwright 以 stdio: "pipe" 启动 Electron 时会创建 5 条管道（fd0=ignore，fd1..4=pipe）；
 * 设置/AI 面板的 Agent CLI/ACP 探测子进程（实测 codebuddy --acp）会继承 fd3/fd4，主进程退出后探测进程仍存活，
 * 写端不关 → Node ChildProcess 不派发 'close' → Playwright launchProcess 一直留在
 * gracefullyCloseSet → worker 收尾空等 30s（Worker teardown timeout）。
 * 本文件改用真实用户路径：window.close() → window-all-closed → app.quit()，
 * 再主动销毁 5 条启动管道的读端（不碰产品代码），让 'close' 立即到达。
 */
import { test, expect } from '@playwright/test'
import { spawnSync, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ElectronApplication, Page } from 'playwright'

// 任务口径：使用 playwright 的 _electron 启动真机（@playwright/test 已装，含 playwright）。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _electron } = require('playwright') as typeof import('playwright')

const ROOT = path.resolve(__dirname, '..')
const SHOT = path.join(ROOT, 'docs', 'wave3-react-live.png')

// 两个用例各拉起一次 Electron，串行执行，避免共用 .devdata 时互相抢写。
test.describe.configure({ mode: 'serial' })

/**
 * 真机环境：禁止 Git 走交互式凭据弹窗。
 * 验收机无人在场时，credential-manager / git-remote-https 会挂起并占住 Electron 的
 * stdio 管道，导致 Playwright 收不到进程 close 事件（teardown 30s 超时）。
 * 只影响测试环境，不改业务代码。
 */
const GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
}

type Bucket = { errors: string[] }

/** 已知无害噪声（favicon / 第三方 / devtools / 布局抖动），不计为致命。 */
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

function attachCollectors(page: Page, bucket: Bucket): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.errors.push(msg.text().slice(0, 1000))
  })
  page.on('pageerror', (err) => {
    bucket.errors.push('pageerror: ' + String(err?.message ?? err).slice(0, 1000))
  })
}

interface LiveApp {
  app: ElectronApplication
  page: Page
  bucket: Bucket
}

async function launchApp(renderer: 'react' | 'legacy'): Promise<LiveApp> {
  const app = await _electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      ...GIT_NONINTERACTIVE_ENV,
      PLAND_RENDERER: renderer,
    } as Record<string, string>,
  })
  try {
    const page = await app.firstWindow()
    const bucket: Bucket = { errors: [] }
    attachCollectors(page, bucket)
    return { app, page, bucket }
  } catch (err) {
    // firstWindow/collector 失败时也不能把 Electron 留在后台。
    disposeApp(app)
    throw err
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

/**
 * 关闭真机并断言主进程退出 + Playwright 启动管道已关闭。
 * 不用 app.close()：它内部等待的也是 ChildProcess 'close'，同样会被残留探测进程拖住。
 * @returns 取证字符串（exit/close 耗时）
 */
async function closeAndExpectExit(app: ElectronApplication, page: Page): Promise<string> {
  const proc = app.process()
  const started = Date.now()
  let closeAt = 0
  proc.once('close', () => {
    closeAt = Date.now()
  })
  const exited = new Promise<number | null>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode)
      return
    }
    proc.once('exit', (code) => resolve(code))
  })
  await page.evaluate(() => window.close()).catch(() => undefined)
  const result = await Promise.race([
    exited.then((code) => ({ kind: 'exit' as const, code })),
    new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 15_000)),
  ])
  const exitElapsed = Date.now() - started
  if (result.kind === 'timeout') disposeApp(app)
  expect(result.kind, 'Electron 主进程应在 15s 内退出（window-all-closed → app.quit）').toBe('exit')
  expect(proc.exitCode, '主进程 exitCode 应已落定').not.toBeNull()

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
  expect(
    closed,
    'Electron 启动管道应在主进程退出后 5s 内关闭（否则 Playwright worker 收尾会超时）',
  ).toBe(true)
  const summary = `exit:${proc.exitCode}@${exitElapsed}ms；close@${closeAt - started}ms`
  console.log(`[electron-live] 进程收尾 ${summary}`)
  return summary
}

test.describe('W3 真机验收（React / legacy）', () => {
  test('A. React 真机：骨架 + 设置/Git/AI/导出 + Esc + 进程退出', async ({}, testInfo) => {
    test.setTimeout(180_000)
    const { app, page, bucket } = await launchApp('react')
    try {
      // 1) 主窗骨架
      await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('topbar')).toBeVisible()
      await expect(page.getByTestId('stage-frame')).toBeVisible()
      // 等冷启动 IPC（sandbox.projects → 恢复上次项目 / 弹选择器）落地
      await page.waitForTimeout(3_000)

      // 6) 项目选择器：冷启动无 protoLastProject 才出现；出现则截图并关闭后继续。
      const picker = page.getByTestId('project-picker')
      const pickerVisible = await picker.isVisible().catch(() => false)
      if (pickerVisible) {
        await expect(picker.getByText('选择项目')).toBeVisible()
        fs.mkdirSync(path.dirname(SHOT), { recursive: true })
        await page.screenshot({ path: SHOT, fullPage: false })
        testInfo.annotations.push({
          type: 'project-picker',
          description: 'PASS：冷启动出现项目选择器，已截图 docs/wave3-react-live.png',
        })
        // 进入真实项目，保证后续设置/Git/AI/导出都有可用上下文。
        const row = picker.locator('li').filter({ hasText: '测试1' }).first()
        await expect(row).toBeVisible({ timeout: 15_000 })
        await row.getByRole('button').first().click()
        await picker.getByRole('button', { name: '进入项目' }).click()
        await expect(picker).toBeHidden({ timeout: 30_000 })
      } else {
        testInfo.annotations.push({
          type: 'project-picker',
          description: 'SKIP：已存在 protoLastProject（自动恢复上次项目），冷启动不弹选择器',
        })
      }

      // 2) 设置（侧栏底部唯一入口；顶栏已移除设置按钮）
      // 移动端默认展开侧栏；若上次会话手动收起，再走顶栏左侧开关兜底展开。
      if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
        await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
      }
      await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
      // 固定选「首页」源，避免上次会话遗留的第三方原型（如 Vant CDN）噪声污染 console 断言。
      const homeProto = page
        .getByTestId('sidebar')
        .locator('button[data-level="proto"]')
        .filter({ hasText: '首页' })
        .first()
      if (await homeProto.count()) {
        await homeProto.click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 15_000 })
      }
      await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
      await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('settings-dialog')).toBeHidden({ timeout: 5_000 })

      // 3) Git 管理（居中 Dialog 660×80vh；testid 仍沿用 git-sheet 兼容旧锚点）
      await page.getByRole('button', { name: 'Git 管理' }).click()
      const gitDialog = page.getByTestId('git-sheet')
      await expect(gitDialog).toBeVisible({ timeout: 10_000 })
      await expect(gitDialog).toHaveAttribute('data-surface', 'dialog')
      const gitBox = await gitDialog.boundingBox()
      expect(gitBox, 'Git Dialog 应有布局盒').not.toBeNull()
      expect(Math.round((gitBox as { width: number }).width), 'Git Dialog 宽度应为 660px').toBe(660)
      await page.keyboard.press('Escape')
      await expect(gitDialog).toBeHidden({ timeout: 5_000 })

      // 4) AI 对话
      await page.getByRole('button', { name: 'AI 对话' }).click()
      await expect(page.getByTestId('ai-dialog')).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('ai-dialog')).toBeHidden({ timeout: 5_000 })

      // 5) 导出下拉（菜单项可见）
      await page.getByTestId('export-menu').click()
      await expect(page.getByTestId('export-source')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('export-html')).toBeVisible()
      await expect(page.getByTestId('export-png')).toBeVisible()
      await expect(page.getByTestId('export-pdf')).toBeVisible()
      await expect(page.getByTestId('export-md')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('export-source')).toBeHidden({ timeout: 5_000 })

      // 无选择器时，主窗骨架截图作为证据
      if (!pickerVisible) {
        fs.mkdirSync(path.dirname(SHOT), { recursive: true })
        await page.screenshot({ path: SHOT, fullPage: false })
      }
      expect(fs.existsSync(SHOT), '截图应落盘 docs/wave3-react-live.png').toBe(true)

      // 1) console error 结算（排除 favicon/第三方噪声）
      await page.waitForTimeout(1_000)
      if (bucket.errors.length) {
        console.log(`[electron-live] 采集到 console error ${bucket.errors.length} 条：\n` + bucket.errors.join('\n'))
      }
      const fatal = bucket.errors.filter(isFatal)
      if (fatal.length) console.log('[electron-live] 致命 console error:\n' + fatal.join('\n'))
      expect(fatal, `致命 console error:\n${fatal.join('\n')}`).toStrictEqual([])

      // 7) 关闭并断言进程退出
      const exit = await closeAndExpectExit(app, page)
      testInfo.annotations.push({ type: 'process-exit', description: `PASS：${exit}` })
    } catch (err) {
      // 失败也尽量收尸，避免残留 Electron 进程/启动管道拖住 worker 收尾。
      disposeApp(app)
      throw err
    }
  })

  test('B. legacy 回退：旧版 原型+文档.html + 旧顶栏 + 进程退出', async ({}, testInfo) => {
    test.setTimeout(120_000)
    const { app, page, bucket } = await launchApp('legacy')
    try {
      await page.waitForLoadState('domcontentloaded').catch(() => undefined)
      await page.getByTestId('main-window').waitFor({ state: 'detached', timeout: 3_000 }).catch(() => undefined)

      // URL 必须是旧版单文件（file:// 下中文文件名以百分号编码出现）
      const url = page.url()
      const decoded = decodeURIComponent(url)
      expect(decoded, 'legacy 应加载 原型+文档.html').toContain('原型+文档.html')
      expect(url, 'legacy 不应加载 dist/renderer').not.toContain('dist/renderer')

      // 标题为旧版口径
      await expect(page).toHaveTitle(/原型预览/)

      // 旧顶栏存在且有内容
      await expect(page.locator('#btnSettings')).toBeVisible({ timeout: 10_000 })
      const bodyText = (await page.locator('body').innerText()).trim()
      expect(bodyText.length, 'legacy 页面应有可见内容').toBeGreaterThan(20)

      // 确认没有挂 React 主窗（真回退，而不是同一个 React 入口）
      expect(await page.locator('[data-testid="main-window"]').count()).toBe(0)

      const fatal = bucket.errors.filter(isFatal)
      if (fatal.length) console.log('[electron-live][legacy] console error:\n' + fatal.join('\n'))

      const exit = await closeAndExpectExit(app, page)
      testInfo.annotations.push({ type: 'process-exit', description: `PASS：${exit}` })
    } catch (err) {
      disposeApp(app)
      throw err
    }
  })
})
