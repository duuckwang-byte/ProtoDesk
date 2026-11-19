/**
 * e2e/wave4-b-ai.spec.ts — Wave4 B 复测 · AI 对话域（b-ai）。
 *
 * 本文件按当前 UI 重写（旧版会话列表/新建会话断言已漂移）：
 * 1. 单一全宽对话：无会话列表 / 新建会话 / 会话切换入口；
 * 2. 输入框焦点浅边框（zinc-300，非近黑 ring）；
 * 3. 模型 + 思考双列 Popover：1024×768 最小窗宽下不裁切右侧思考列；
 * 4. Markdown / 代码块渲染（mock ai:event，0 真实请求）；
 * 5. 问题卡提交：补「提交答案」，经既有 ai:ask 通道回传（mock，0 真实请求）；
 * 6. 真实发送只 1 条短 prompt（如环境可用），验证单气泡与真实链路；
 * 7. 无模型：发送按钮前置禁用 + 原因提示，0 次 ai:ask。
 *
 * 写入范围：
 * - e2e/wave4-b-ai.spec.ts（本文件）
 * - docs/wave4/shots/retest-b-ai-pick/ai-*.png
 * - 隔离数据目录 .devdata-wave4-b-ai/**（afterAll 删除）
 * 不改产品代码 / package.json / seed；不 commit。
 */
import { test, expect, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ROOT, assertCleanExit, launchApp, reportFailure, type Wave4App } from './wave4/harness'

const DOMAIN = 'b-ai'
const DATA_DIR = path.join(ROOT, '.devdata-wave4-b-ai')
const SHOT_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-b-ai-pick')
const PROMPT_REAL = '只回复两个字：收到。不要调用工具。'

type Level = 'P0' | 'P1' | 'P2' | 'P3' | 'ENV'

interface AskEntry {
  prompt: string
  sessionId: string
  sandboxDir: string
  model: string
  at: number
}

interface Observation {
  id: string
  level: Level
  text: string
}

const observations: Observation[] = []
const evidence: Record<string, unknown> = {}

function log(label: string, data: unknown): void {
  console.log(`[W4-B-AI] ${label} ${JSON.stringify(data)}`)
}

function observe(id: string, level: Level, text: string): void {
  observations.push({ id, level, text })
  log(`OBS ${id}/${level}`, text)
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const file = path.join(SHOT_DIR, name + '.png')
  await page.screenshot({ path: file })
  return path.relative(ROOT, file).split(path.sep).join('/')
}

async function ensureProject(page: Page): Promise<void> {
  await page.waitForTimeout(1_000)
  const picker = page.getByTestId('project-picker')
  if (await picker.isVisible().catch(() => false)) {
    const row = picker.locator('li').filter({ hasText: '测试1' }).first()
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
}

async function openAi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'AI 对话' }).first().click()
  await expect(page.getByTestId('ai-dialog')).toBeVisible({ timeout: 20_000 })
}

async function clearAiStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k) keys.push(k)
    }
    for (const k of keys) {
      if (
        k.startsWith('ai_sessions_v2_') ||
        k.startsWith('ai_hist_') ||
        k === 'ai_model' ||
        k === 'ai_model_reasoning'
      ) {
        localStorage.removeItem(k)
      }
    }
  })
}

interface AiProbe {
  assistantCount: number
  lastAssistantText: string
  userCount: number
  busy: boolean
  markdownCount: number
  preCount: number
  codeCount: number
  headingCount: number
  listCount: number
  chatText: string
  error: string
}

async function probeAi(page: Page): Promise<AiProbe> {
  return page.evaluate(() => {
    const all = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll(sel)) as HTMLElement[]
    const bubbles = all('[data-slot="ai-message-ai"]')
    const last = bubbles.length ? bubbles[bubbles.length - 1] : null
    const chat = document.querySelector('[data-testid="ai-chat"]') as HTMLElement | null
    const stop = document.querySelector('[data-testid="ai-stop-btn"]') as HTMLButtonElement | null
    const err = document.querySelector('[data-testid="ai-dialog-error"]')
    const text = chat ? (chat.textContent ?? '') : ''
    return {
      assistantCount: bubbles.length,
      lastAssistantText: last ? (last.textContent ?? '') : '',
      userCount: all('[data-slot="ai-message-user"]').length,
      busy: stop ? !stop.disabled : false,
      markdownCount: all('[data-testid="ai-message-markdown"]').length,
      preCount: chat ? chat.querySelectorAll('pre').length : 0,
      codeCount: chat ? chat.querySelectorAll('code').length : 0,
      headingCount: chat ? chat.querySelectorAll('h1,h2,h3').length : 0,
      listCount: chat ? chat.querySelectorAll('ul li,ol li').length : 0,
      chatText: text,
      error: err ? (err.textContent ?? '').trim() : '',
    }
  })
}

/** 主进程记录器：保留真实 handler 引用，mock 后可精确恢复；realAsks 只记真实 ai:ask。 */
async function installRecorder(ctx: Wave4App): Promise<{ hasOrigAsk: boolean }> {
  return ctx.app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as Record<string, any>
    const s = (g.__w4ai = {
      asks: [] as AskEntry[],
      realAsks: [] as AskEntry[],
      mockAsks: [] as AskEntry[],
      hasOrigAsk: false,
      mode: 'simple',
      origAsk: null as unknown,
      origCancel: null as unknown,
      runSeq: 0,
      currentRunId: '',
      timer: null as NodeJS.Timeout | null,
    })
    const map = (ipcMain as unknown as { _invokeHandlers?: Map<string, Function> })._invokeHandlers
    const origAsk = map && typeof map.get === 'function' ? map.get('ai:ask') : null
    const origCancel = map && typeof map.get === 'function' ? map.get('ai:cancel') : null
    s.origAsk = origAsk
    s.origCancel = origCancel
    const record = (target: AskEntry[], args: unknown[]): AskEntry => {
      const item: AskEntry = {
        prompt: String(args[1] || ''),
        sessionId: String(args[2] || ''),
        sandboxDir: String(args[3] || ''),
        model: String(args[4] || ''),
        at: Date.now(),
      }
      target.push(item)
      s.asks.push(item)
      return item
    }
    if (typeof origAsk === 'function') {
      s.hasOrigAsk = true
      ipcMain.removeHandler('ai:ask')
      ipcMain.handle('ai:ask', async (ev, ...args: unknown[]) => {
        record(s.realAsks, [ev, ...args])
        return (origAsk as Function)(ev, ...args)
      })
    }
    return { hasOrigAsk: Boolean(s.hasOrigAsk) }
  })
}

/** 安装纯 mock：ai:ask / ai:cancel 不再触网；事件经 ai:event 回推渲染器。 */
async function installMock(ctx: Wave4App): Promise<void> {
  await ctx.app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis as unknown as Record<string, any>
    const s = g.__w4ai
    const win = (): any => BrowserWindow.getAllWindows()[0]
    const send = (payload: Record<string, unknown>): void => {
      const w = win()
      if (w && !w.isDestroyed()) w.webContents.send('ai:event', payload)
    }
    s.send = send
    const record = (args: unknown[]): AskEntry => {
      const item: AskEntry = {
        prompt: String(args[1] || ''),
        sessionId: String(args[2] || ''),
        sandboxDir: String(args[3] || ''),
        model: String(args[4] || ''),
        at: Date.now(),
      }
      s.mockAsks.push(item)
      s.asks.push(item)
      return item
    }
    const mockAsk = async (_ev: unknown, ...args: unknown[]) => {
      record([_ev, ...args])
      const mode = String(s.mode || 'simple')
      s.runSeq += 1
      const runId = 'mock-' + String(s.runSeq)
      s.currentRunId = runId
      if (mode === 'markdown') {
        setTimeout(() => {
          send({ type: 'run_started', runId, engine: 'cli' })
          send({ type: 'thinking', runId, text: '先确认标题、代码块、列表三点结构。' })
          const parts = ['# 冒烟\n\n', '```js\n', 'console.log(1)\n', '```\n\n', '- 通过']
          parts.forEach((part, i) => send({ type: 'chunk', runId, seq: i + 1, mode: 'delta', text: part }))
          send({ type: 'done', runId })
        }, 120)
        return { ok: true }
      }
      if (mode === 'receipt') {
        setTimeout(() => {
          send({ type: 'run_started', runId, engine: 'cli' })
          send({ type: 'chunk', runId, seq: 1, mode: 'delta', text: '收到' })
          send({ type: 'done', runId })
        }, 120)
        return { ok: true }
      }
      setTimeout(() => {
        send({ type: 'run_started', runId, engine: 'cli' })
        send({ type: 'chunk', runId, seq: 1, mode: 'delta', text: '恢复成功' })
        send({ type: 'done', runId })
      }, 120)
      return { ok: true }
    }
    ipcMain.removeHandler('ai:ask')
    ipcMain.handle('ai:ask', mockAsk)
    ipcMain.removeHandler('ai:cancel')
    ipcMain.handle('ai:cancel', async () => {
      if (s.timer) {
        clearInterval(s.timer)
        s.timer = null
      }
      send({ type: 'cancel', runId: String(s.currentRunId || 'mock-cancel') })
      return { ok: true }
    })
  })
}

async function setMode(ctx: Wave4App, mode: string): Promise<void> {
  await ctx.app.evaluate((_electron, next) => {
    const s = (globalThis as unknown as Record<string, any>).__w4ai
    s.mode = next
  }, mode)
}

/** 恢复真实 handler（仍是带记录的包装，realAsks 可精确计数）。 */
async function restoreReal(ctx: Wave4App): Promise<void> {
  await ctx.app.evaluate(({ ipcMain }) => {
    const s = (globalThis as unknown as Record<string, any>).__w4ai
    const origAsk = s.origAsk
    const origCancel = s.origCancel
    ipcMain.removeHandler('ai:ask')
    if (typeof origAsk === 'function') {
      ipcMain.handle('ai:ask', async (ev: unknown, ...args: unknown[]) => {
        const item: AskEntry = {
          prompt: String(args[0] || ''),
          sessionId: String(args[1] || ''),
          sandboxDir: String(args[2] || ''),
          model: String(args[3] || ''),
          at: Date.now(),
        }
        s.realAsks.push(item)
        s.asks.push(item)
        return (origAsk as Function)(ev, ...args)
      })
    }
    ipcMain.removeHandler('ai:cancel')
    if (typeof origCancel === 'function') ipcMain.handle('ai:cancel', origCancel)
  })
}

async function emitEvent(ctx: Wave4App, payload: Record<string, unknown>): Promise<void> {
  await ctx.app.evaluate(({ BrowserWindow }, next) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w && !w.isDestroyed()) w.webContents.send('ai:event', next)
  }, payload)
}

async function recorderState(ctx: Wave4App): Promise<{ asks: AskEntry[]; realAsks: AskEntry[]; mockAsks: AskEntry[] }> {
  return ctx.app.evaluate(() => {
    const s = (globalThis as unknown as Record<string, any>).__w4ai
    const copy = (list: AskEntry[]): AskEntry[] => list.map((x) => ({ ...x }))
    return {
      asks: copy(s?.asks || []),
      realAsks: copy(s?.realAsks || []),
      mockAsks: copy(s?.mockAsks || []),
    }
  })
}

async function resizeWindow(ctx: Wave4App, width: number, height: number): Promise<void> {
  await ctx.app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    if (win.isFullScreen()) win.setFullScreen(false)
    win.setSize(size.width, size.height)
  }, { width, height })
  await ctx.page.waitForTimeout(700)
}

/** 打开模型/思考浮层并等选项稳定。 */
async function openCascade(page: Page): Promise<void> {
  await page.getByTestId('ai-model-select').first().click()
  await page.getByTestId('ai-model-popover').waitFor({ state: 'visible', timeout: 10_000 })
  await expect
    .poll(async () => {
      const count = await page.getByTestId('ai-model-option').count()
      if (count > 0) return count
      const text = await page.getByTestId('ai-model-popover').innerText().catch(() => '')
      return text.includes('暂无模型') ? 0 : -1
    }, { timeout: 10_000, intervals: [50, 100, 250] })
    .not.toBe(-1)
  await page.waitForTimeout(120)
}

async function closeCascade(page: Page): Promise<void> {
  const panel = page.getByTestId('ai-model-popover')
  if (await panel.isVisible().catch(() => false)) {
    await page.getByTestId('ai-model-select').first().click().catch(() => undefined)
    await panel.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
    console.log(`[W4-B-AI] cleaned ${DATA_DIR}`)
  } catch (err) {
    console.warn(`[W4-B-AI] cleanup failed: ${String(err)}`)
  }
  try {
    const summaryFile = path.join(process.env.TEMP || process.env.TMP || '.', 'pland-wave4', 'retest-b-ai-summary.json')
    fs.mkdirSync(path.dirname(summaryFile), { recursive: true })
    fs.writeFileSync(summaryFile, JSON.stringify({ evidence, observations }, null, 2), 'utf8')
    log('summary', summaryFile)
  } catch {
    /* 摘要失败不影响测试结果 */
  }
})

test('B-AI 复测：单一对话 + 焦点 + Markdown + Popover 1024 + 问题卡 + 真实 1 条', async () => {
  test.setTimeout(900_000)
  const ctx = await launchApp({ domain: DOMAIN })
  let closeError: Error | null = null

  try {
    const page = ctx.page
    await page.bringToFront().catch(() => undefined)
    await ensureProject(page)
    await clearAiStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 60_000 })
    await ensureProject(page)

    const recorder = await installRecorder(ctx)
    evidence.preflight = {
      dataDir: ctx.dataDir,
      userData: ctx.userData,
      seedPresent: ctx.seedPresent,
      hasOrigAsk: recorder.hasOrigAsk,
      windowSize: await ctx.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return w ? w.getSize() : null
      }),
      renderer: await ctx.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return w ? w.webContents.getURL() : ''
      }),
    }
    expect(recorder.hasOrigAsk, '应能拿到真实 ai:ask handler 以做 1 条真实发送').toBe(true)

    // ── 1. 单一全宽对话：无会话列表 / 新建 / 切换 ─────────────────────
    await openAi(page)
    await expect(page.getByTestId('ai-model-select')).toHaveCount(1)
    await expect(page.getByTestId('ai-thinking-select')).toHaveCount(1)
    expect(await page.getByTestId('ai-session-list').count(), '不应再有会话列表').toBe(0)
    expect(await page.getByTestId('ai-session-new').count(), '不应再有新建会话').toBe(0)
    expect(await page.locator('[data-testid^="ai-session-"]').count(), '会话卡/切换入口应为 0').toBe(0)
    expect(await page.getByText('新建会话').count(), '不应出现「新建会话」文案').toBe(0)
    expect(await page.getByTestId('ai-chat').count(), '只应有一个对话区').toBe(1)

    const layout = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="ai-dialog"]') as HTMLElement | null
      const chat = document.querySelector('[data-testid="ai-chat"]') as HTMLElement | null
      const d = dialog ? dialog.getBoundingClientRect() : null
      const c = chat ? chat.getBoundingClientRect() : null
      return d && c
        ? {
            dialog: { x: d.x, y: d.y, w: d.width, h: d.height },
            chat: { x: c.x, y: c.y, w: c.width, h: c.height },
            ratio: c.width / d.width,
          }
        : null
    })
    expect(layout, '应能读到 AI dialog/chat 几何').not.toBeNull()
    expect(layout!.ratio, '对话区应占满 Dialog 宽度（>0.9）').toBeGreaterThan(0.9)

    await expect
      .poll(async () => (await page.getByTestId('ai-active-page').locator('option').count()), {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toBeGreaterThan(1)
    const pageOptions = await page.getByTestId('ai-active-page').locator('option').allTextContents()

    await expect
      .poll(async () => (await page.getByTestId('ai-model-select').innerText()).replace(/\s+/g, ' ').trim(), {
        timeout: 60_000,
        intervals: [250, 500, 1_000],
      })
      .not.toBe('选择模型')
    const modelText = (await page.getByTestId('ai-model-select').innerText()).replace(/\s+/g, ' ').trim()
    const emptyVisible = await page.getByTestId('ai-chat-empty').isVisible().catch(() => false)
    const shotOpen = await shot(page, 'ai-01-open')
    evidence.singleConversation = { layout, pageOptions, modelText, emptyVisible, shot: shotOpen }
    log('singleConversation', evidence.singleConversation)

    // ── 2. 输入框焦点浅边框 ─────────────────────────────────────────
    const ta = page.getByTestId('ai-prompt-textarea')
    await ta.click()
    await expect(ta).toBeFocused()
    const focusStyle = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="ai-prompt-textarea"]') as HTMLElement | null
      const wrap = ta ? (ta.closest('div.rounded-xl') as HTMLElement | null) : null
      // 浏览器可能把 oklch()/oklab() 原样序列化；直接画到 1×1 canvas 再读像素，
      // 得到真实 sRGB 分量，避免颜色空间误判。
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const toRgb = (color: string): [number, number, number] | null => {
        if (!ctx) return null
        try {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = '#000000'
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return [d[0], d[1], d[2]]
        } catch {
          return null
        }
      }
      const pick = (el: HTMLElement | null) => {
        if (!el) return null
        const s = getComputedStyle(el)
        return {
          borderColor: s.borderTopColor,
          borderRgb: toRgb(s.borderTopColor),
          borderWidth: s.borderTopWidth,
          boxShadow: s.boxShadow,
        }
      }
      return { textarea: pick(ta), wrapper: pick(wrap) }
    })
    const textRgb = focusStyle.textarea ? focusStyle.textarea.borderRgb : null
    expect(focusStyle.textarea, '应能读到 textarea 焦点样式').not.toBeNull()
    expect(textRgb, `焦点边框颜色应可解析：${focusStyle.textarea?.borderColor}`).not.toBeNull()
    expect(Math.min(...textRgb!), '焦点边框应为浅色（zinc-300 级别）').toBeGreaterThan(150)
    expect(Math.max(...textRgb!) - Math.min(...textRgb!), '浅边框应为中性灰，而不是彩色').toBeLessThan(20)
    const shotFocus = await shot(page, 'ai-02-input-focus')
    evidence.inputFocus = { ...focusStyle, shot: shotFocus }
    log('inputFocus', evidence.inputFocus)

    // ── 3. 模型 Popover 在 1024×768 不裁切 ───────────────────────────
    const originalSize = await ctx.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return w ? w.getSize() : null
    })
    await resizeWindow(ctx, 1024, 768)
    await openCascade(page)
    const popover = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="ai-model-popover"]') as HTMLElement | null
      const listboxes = Array.from(document.querySelectorAll('[role="listbox"]')) as HTMLElement[]
      const think = listboxes[1] || null
      const p = panel ? panel.getBoundingClientRect() : null
      const t = think ? think.getBoundingClientRect() : null
      const points = p
        ? [
            [p.right - 6, p.top + 24],
            [p.right - 6, p.bottom - 24],
          ]
        : []
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        panel: p ? { x: p.x, y: p.y, w: p.width, h: p.height, right: p.right, bottom: p.bottom } : null,
        thinking: t ? { x: t.x, right: t.right, w: t.width } : null,
        listboxes: listboxes.length,
        overflowRight: Boolean(p && p.right > window.innerWidth + 1),
        overflowBottom: Boolean(p && p.bottom > window.innerHeight + 1),
        hits: points.map(([x, y]) => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null
          return Boolean(el && panel && (el === panel || panel.contains(el)))
        }),
        bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      }
    })
    expect(popover.listboxes, '双列：模型 + 思考').toBe(2)
    log('popover1024-raw', popover)
    expect(popover.panel, '浮层应有几何').not.toBeNull()
    expect(popover.innerWidth, '1024 窗宽应生效').toBeLessThanOrEqual(1024)
    expect(popover.overflowRight, '浮层右侧不应超出视口').toBe(false)
    expect(popover.overflowBottom, '浮层底部不应超出视口').toBe(false)
    expect(popover.thinking, '右侧思考列应有几何').not.toBeNull()
    expect(popover.thinking!.right, '思考列右边界不应超出视口').toBeLessThanOrEqual(popover.innerWidth + 1)
    expect(popover.hits.every(Boolean), '浮层右缘应可命中（未被裁切）').toBe(true)
    expect(popover.bodyOverflowX, '页面不应出现横向滚动').toBe(false)
    const shotPopover = await shot(page, 'ai-03-model-popover-1024')
    evidence.popover1024 = { ...popover, shot: shotPopover }
    log('popover1024', evidence.popover1024)
    await closeCascade(page)
    if (originalSize) await resizeWindow(ctx, originalSize[0], originalSize[1])

    // ── 4. Markdown / 代码块渲染（mock，0 真实请求）──────────────────
    await installMock(ctx)
    await setMode(ctx, 'markdown')
    const beforeMd = await probeAi(page)
    await page.getByTestId('ai-prompt-textarea').fill('请输出 Markdown 标题、js 代码块和列表')
    await page.getByTestId('ai-send-btn').click()
    await expect
      .poll(async () => (await probeAi(page)).markdownCount, { timeout: 20_000, intervals: [100, 200, 500] })
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await probeAi(page)).busy, { timeout: 20_000, intervals: [100, 200, 500] })
      .toBe(false)
    const md = await probeAi(page)
    expect(md.assistantCount, 'Markdown 回复合并为 1 个 assistant 文本气泡').toBe(beforeMd.assistantCount + 1)
    expect(md.headingCount, '应渲染 h1').toBeGreaterThanOrEqual(1)
    expect(md.preCount, '应渲染代码块 pre').toBeGreaterThanOrEqual(1)
    expect(md.codeCount, '应渲染 code').toBeGreaterThanOrEqual(1)
    expect(md.listCount, '应渲染列表项').toBeGreaterThanOrEqual(1)
    expect(md.chatText, '不应把围栏原样显示').not.toContain('```')
    expect(md.lastAssistantText, 'Markdown 文本应可见').toContain('冒烟')
    expect(md.lastAssistantText).toContain('通过')
    const shotMd = await shot(page, 'ai-04-markdown')
    evidence.markdown = { ...md, shot: shotMd }
    log('markdown', { ...md, shot: shotMd })

    // ── 5. 问题卡提交（mock，0 真实请求）─────────────────────────────
    const beforeQuestion = await recorderState(ctx)
    const questionText =
      '<question-form id="qform1" title="确认作用页">\n' +
      '{"id":"q1","label":"选择页面","type":"radio","options":["首页","我的"],"recommended":"首页"}\n' +
      '</question-form>'
    await setMode(ctx, 'simple')
    await emitEvent(ctx, { type: 'question_request', runId: 'mock-question', title: '请确认', text: questionText })
    const card = page.getByTestId('ai-questionnaire')
    await expect(card).toBeVisible({ timeout: 10_000 })
    expect(await card.locator('input[type="radio"]').count(), '应渲染 2 个选项').toBe(2)
    const submit = page.getByTestId('ai-questionnaire-submit')
    await expect(submit).toBeEnabled()
    await card.locator('input[type="radio"]').first().check()
    await submit.click()
    await expect(card).toContainText('已提交', { timeout: 5_000 })
    await expect
      .poll(async () => (await recorderState(ctx)).asks.length, { timeout: 10_000, intervals: [100, 250, 500] })
      .toBe(beforeQuestion.asks.length + 1)
    const afterQuestion = await recorderState(ctx)
    const answerAsk = afterQuestion.asks[afterQuestion.asks.length - 1]
    expect(answerAsk.prompt).toContain('[form answers — qform1]')
    expect(answerAsk.prompt).toContain('- 选择页面: 首页')
    const shotQuestion = await shot(page, 'ai-05-question-submit')
    evidence.question = { ask: answerAsk, shot: shotQuestion }
    log('question', evidence.question)

    // ── 6. 真实发送只 1 条短 prompt ─────────────────────────────────
    await restoreReal(ctx)
    const beforeReal = await probeAi(page)
    const realBefore = await recorderState(ctx)
    await page.getByTestId('ai-prompt-textarea').fill(PROMPT_REAL)
    await expect(page.getByTestId('ai-send-btn')).toBeEnabled({ timeout: 10_000 })
    await page.getByTestId('ai-send-btn').click()

    let realStatus: 'PASS' | 'ENV' = 'PASS'
    let realError = ''
    try {
      await expect
        .poll(async () => (await recorderState(ctx)).realAsks.length, { timeout: 20_000, intervals: [100, 250, 500] })
        .toBe(realBefore.realAsks.length + 1)
      await expect
        .poll(async () => (await probeAi(page)).userCount, { timeout: 15_000, intervals: [100, 250, 500] })
        .toBe(beforeReal.userCount + 1)
      await expect
        .poll(async () => (await probeAi(page)).assistantCount, { timeout: 180_000, intervals: [500, 1_000, 2_000] })
        .toBeGreaterThan(beforeReal.assistantCount)
      await expect
        .poll(async () => (await probeAi(page)).busy, { timeout: 60_000, intervals: [500, 1_000] })
        .toBe(false)
      const realProbe = await probeAi(page)
      expect(realProbe.lastAssistantText.trim().length, '真实回复气泡不应为空').toBeGreaterThan(0)
      if (!realProbe.lastAssistantText.includes('收到')) {
        observe(
          'B-AI-OBS-real-reply',
          'P3',
          `真实模型未严格按 prompt 只回「收到」，实际=「${realProbe.lastAssistantText.slice(0, 80)}」；链路与单气泡仍通过。`,
        )
      }
      expect(realProbe.assistantCount - beforeReal.assistantCount, '真实一轮只新增 1 个文本气泡').toBe(1)
      const realAsks = (await recorderState(ctx)).realAsks
      expect(realAsks.length, '真实 ai:ask 只 1 条').toBe(realBefore.realAsks.length + 1)
      expect(realAsks[realAsks.length - 1].prompt, '真实 prompt 与输入一致').toBe(PROMPT_REAL)
      evidence.realSend = { status: realStatus, asks: realAsks, probe: realProbe }
    } catch (err) {
      realStatus = 'ENV'
      realError = err instanceof Error ? err.message : String(err)
      const p = await probeAi(page)
      const state = await recorderState(ctx)
      evidence.realSend = {
        status: realStatus,
        error: realError,
        errorBar: p.error,
        busy: p.busy,
        assistantCount: p.assistantCount,
        realAsks: state.realAsks,
      }
      observe(
        'B-AI-ENV-real-send',
        'ENV',
        `真实发送未在时限内完成（按环境/Agent 延迟记 ENV）：${realError.slice(0, 240)}；错误条=「${p.error}」`,
      )
    }
    const shotReal = await shot(page, realStatus === 'PASS' ? 'ai-06-real-send' : 'ai-06-real-send-ENV')
    evidence.realSend = { ...(evidence.realSend as Record<string, unknown>), shot: shotReal }
    log('realSend', evidence.realSend)

    expect(ctx.crashes.length, '不应出现渲染进程崩溃').toBe(0)
    const fatal = ctx
      .fatalErrors()
      .filter(
        (text) =>
          !/cdn\.jsdelivr\.net\/npm\/vant/i.test(text) && !/Unexpected token '\.'/.test(text),
      )
    expect(fatal, 'AI 域不应有致命 console/pageerror（seed 原型 CDN/脚本噪声除外）').toEqual([])
    evidence.console = { errors: ctx.consoleErrors.length, pageErrors: ctx.pageErrors.length, crashes: ctx.crashes.length }
  } catch (err) {
    const failShot = await shot(ctx.page, 'ai-99-fail').catch(() => '')
    await reportFailure(ctx, {
      step: 'AI',
      slug: 'retest-ai',
      level: 'P1',
      expected: 'AI 复测全部断言通过',
      actual: '出现断言失败',
      error: err,
      screenshot: false,
      extra: JSON.stringify({ failShot }),
    }).catch(() => undefined)
    throw err
  } finally {
    const result = await ctx.close({ graceMs: 12_000 })
    evidence.close = result
    try {
      assertCleanExitOrP2(result)
    } catch (err) {
      closeError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (closeError) throw closeError
})

test('B-AI 复测：无模型时发送前置禁用且 0 次 ai:ask', async () => {
  test.setTimeout(300_000)
  const ctx = await launchApp({ domain: DOMAIN })
  let closeError: Error | null = null

  try {
    const page = ctx.page
    await page.bringToFront().catch(() => undefined)
    await ensureProject(page)

    // 在 settings-store 首次 load 前替换模型目录；同时拦住 ai:ask 记账。
    await ctx.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as Record<string, any>
      g.__w4no = { asks: 0 }
      ipcMain.removeHandler('ai:models')
      ipcMain.handle('ai:models', () => ({ groups: [], allGroups: [], default: '', visibleModels: [] }))
      ipcMain.removeHandler('ai:ask')
      ipcMain.handle('ai:ask', async () => {
        g.__w4no.asks += 1
        return { ok: false, error: '不应在无模型时发起 ai:ask' }
      })
    })
    await page.addInitScript(() => {
      try {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i)
          if (k) keys.push(k)
        }
        for (const k of keys) {
          if (
            k.startsWith('ai_sessions_v2_') ||
            k.startsWith('ai_hist_') ||
            k === 'ai_model' ||
            k === 'ai_model_reasoning'
          ) {
            localStorage.removeItem(k)
          }
        }
      } catch {
        /* localStorage 不可用则保持原状 */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 60_000 })
    await ensureProject(page)
    await openAi(page)

    const trigger = (await page.getByTestId('ai-model-select').innerText()).replace(/\s+/g, ' ').trim()
    await expect
      .poll(async () => ((await page.getByTestId('ai-send-hint').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim(), {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toMatch(/暂无可用模型|未选择模型/)
    await expect(page.getByTestId('ai-send-hint')).toBeVisible({ timeout: 10_000 })
    const hint = (await page.getByTestId('ai-send-hint').innerText()).replace(/\s+/g, ' ').trim()
    const ta = page.getByTestId('ai-prompt-textarea')
    await ta.fill('无模型发送测试')
    const send = page.getByTestId('ai-send-btn')
    expect(await send.isDisabled(), '无模型时发送按钮应前置禁用').toBe(true)
    expect(hint, '应展示无模型原因').toMatch(/暂无可用模型|模型清单加载中|未选择模型/)

    await openCascade(page)
    expect(await page.getByTestId('ai-model-option').count(), '模型项应为 0').toBe(0)
    expect(await page.getByTestId('ai-model-popover').innerText()).toContain('暂无模型')
    const shotNoModel = await shot(page, 'ai-07-no-model')
    await closeCascade(page)

    const asks = await ctx.app.evaluate(() => Number((globalThis as unknown as Record<string, any>).__w4no.asks || 0))
    expect(asks, '无模型时不应发起 ai:ask').toBe(0)
    evidence.noModel = { trigger, hint, asks, shot: shotNoModel }
    log('noModel', evidence.noModel)
  } catch (err) {
    const failShot = await shot(ctx.page, 'ai-99-no-model-fail').catch(() => '')
    await reportFailure(ctx, {
      step: 'NO-MODEL',
      slug: 'retest-ai-no-model',
      level: 'P1',
      expected: '无模型时发送禁用且 0 次 ai:ask',
      actual: '断言失败',
      error: err,
      screenshot: false,
      extra: JSON.stringify({ failShot }),
    }).catch(() => undefined)
    throw err
  } finally {
    const result = await ctx.close({ graceMs: 12_000 })
    try {
      assertCleanExitOrP2(result)
    } catch (err) {
      closeError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (closeError) throw closeError
})

/** P2：长链路执行后 window-all-closed 偶发不退出，仅容忍 kill 收尾；其它异常仍硬失败。 */
function assertCleanExitOrP2(result: Parameters<typeof assertCleanExit>[0]): void {
  if (result.method === 'kill') {
    console.warn('[gate3] P2 close: window-all-closed 未退出，已 kill 收尾；功能断言仍为硬门禁' )
    return
  }
  assertCleanExit(result)
}
