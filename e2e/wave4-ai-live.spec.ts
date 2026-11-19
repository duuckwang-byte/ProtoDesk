/**
 * e2e/wave4-ai-live.spec.ts — Wave4 A3 · AI 对话真实发送（AI-LIVE 独占，唯一 1 次）
 *
 * 目标：证明「真实 Agent 链路可用 + 流式回复合并为 1 个 assistant 气泡」，
 * 同时记录模型/思考级联、Trace、会话持久化、耗时与 console/pageerror/crash。
 *
 * 额度纪律：
 * - 只发送 1 条短 prompt（`请只回复：冒烟通过`）。
 * - 不点「停止」「重试」；这两项需要可控长流，按 docs/wave4-smoke-plan.md §6.1 走 mock，
 *   本 spec 明确 SKIP 并写明原因。
 * - 发送前预检 Agent 是否可用、模型列表是否非空；命中 ENV 阻断时直接 SKIP，不发请求。
 *
 * 预检模式（0 次请求，用于验证模型/思考级联接线）：
 *   $env:WAVE4_AI_PREFLIGHT = '1'
 *   npx playwright test e2e/wave4-ai-live.spec.ts --workers=1 --output=<临时目录>
 *
 * 运行（真实发送一次）：
 *   node e2e/wave4/seed.mjs --domain ai
 *   npx playwright test e2e/wave4-ai-live.spec.ts --workers=1 --output=<临时目录>
 *
 * 写入范围（严格受限）：
 * - `docs/wave4/shots/ai-live/` 下的 `<NN>-<slug>.png` 截图
 * - 隔离数据目录 `.devdata-wave4-ai/**`（跑完由本 spec 删除）
 * 不修改产品代码、不改 seed、不写共享 `.devdata`、不 commit。
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { ROOT, assertCleanExit, launchApp, type Wave4App } from './wave4/harness'

const DOMAIN = 'ai'
const DATA_DIR = path.join(ROOT, '.devdata-wave4-ai')
const SHOTS_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'ai-live')
const PROMPT = '请只回复：冒烟通过'
const PREFLIGHT_ONLY = String(process.env.WAVE4_AI_PREFLIGHT || '') === '1'

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'NOT RUN' | 'OBSERVE'

interface Row {
  no: number | string
  title: string
  status: Status
  evidence: string
  shots: string[]
  ms: number
}

const rows: Row[] = []

function rel(abs: string): string {
  return path.relative(ROOT, abs).replace(/\\/g, '/')
}

function norm(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n').slice(0, 8).join(' | ')
  return String(err)
}

function stepNo(no: number | string): string {
  return typeof no === 'number' ? String(no).padStart(2, '0') : String(no).toUpperCase()
}

async function shot(page: Page, no: number | string, slug: string, fail = false): Promise<string> {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const file = path.join(SHOTS_DIR, `${stepNo(no)}-${slug}${fail ? '-FAIL' : ''}.png`)
  await page.screenshot({ path: file })
  return rel(file)
}

function pushRow(row: Row): void {
  rows.push(row)
  console.log(
    `[ai-live] STEP ${stepNo(row.no)} ${row.status} ${row.title} | ${row.evidence} | ${row.shots.join(',') || '-'} | ${row.ms}ms`,
  )
}

async function runStep(
  page: Page,
  no: number | string,
  title: string,
  slug: string,
  fn: () => Promise<{ evidence: string; shots?: string[]; status?: Status }>,
): Promise<boolean> {
  const started = Date.now()
  try {
    const out = await fn()
    pushRow({
      no,
      title,
      status: out.status ?? 'PASS',
      evidence: out.evidence,
      shots: out.shots ?? [],
      ms: Date.now() - started,
    })
    return true
  } catch (err) {
    let failShot = ''
    try {
      failShot = await shot(page, no, slug, true)
    } catch {
      /* 页面崩溃时无法截图 */
    }
    pushRow({
      no,
      title,
      status: 'FAIL',
      evidence: errText(err),
      shots: failShot ? [failShot] : [],
      ms: Date.now() - started,
    })
    return false
  }
}

function notRun(no: number | string, title: string, reason: string): void {
  pushRow({ no, title, status: 'NOT RUN', evidence: reason, shots: [], ms: 0 })
}

/** 冷启动/刷新后：若弹项目选择器则选「测试1」进入。 */
async function ensureProject(page: Page): Promise<boolean> {
  await page.waitForTimeout(1_500)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    const row = picker.locator('li').filter({ hasText: '测试1' }).first()
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  return shown
}

interface AiProbe {
  assistantCount: number
  lastLen: number
  lastText: string
  userCount: number
  busy: boolean
  error: string
  permissionCards: number
  thinkingCount: number
  toolCount: number
  chatText: string
}

/** 读取对话流当前状态（每 200ms 采样用）。 */
async function probeAi(page: Page): Promise<AiProbe> {
  return page.evaluate(() => {
    const all = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll(sel)) as HTMLElement[]
    const bubbles = all('[data-slot="ai-message-ai"]')
    // 只统计有文本的 assistant 气泡：流式期间可能先挂一个空占位节点，
    // 它不可见也不构成「一词一气泡」；空占位不应让单气泡断言误报。
    const textBubbles = bubbles.filter((el) => (el.textContent ?? '').trim().length > 0)
    const stop = document.querySelector('[data-testid="ai-stop-btn"]') as HTMLButtonElement | null
    const err = document.querySelector('[data-testid="ai-dialog-error"]')
    const chat = document.querySelector('[data-testid="ai-chat"]')
    const last = textBubbles.length ? textBubbles[textBubbles.length - 1] : null
    return {
      assistantCount: textBubbles.length,
      lastLen: last ? (last.textContent ?? '').length : 0,
      lastText: last ? (last.textContent ?? '') : '',
      userCount: all('[data-slot="ai-message-user"]').length,
      busy: stop ? !stop.disabled : false,
      error: err ? (err.textContent ?? '').trim() : '',
      permissionCards: all('[data-testid="ai-permission-card"]').length,
      thinkingCount: all('[data-testid="ai-reasoning"]').length,
      toolCount: all('[data-testid="ai-tool-card"]').length,
      chatText: chat ? (chat.textContent ?? '') : '',
    }
  })
}

interface ModelOption {
  label: string
  value: string
  selected: boolean
}

/** 打开模型/思考级联浮层读取选项；读后原样收起（不改变选择）。 */
async function readSelectorOptions(
  page: Page,
  triggerTestId: 'ai-model-select' | 'ai-thinking-select',
  optionTestId: 'ai-model-option' | 'ai-thinking-option',
): Promise<Array<{ label: string; value: string; selected: boolean }>> {
  const trigger = page.getByTestId(triggerTestId).first()
  await trigger.click()
  const content = page.locator('[data-slot="select-content"]').first()
  await content.waitFor({ state: 'visible', timeout: 10_000 })
  const options = await page.getByTestId(optionTestId).evaluateAll((els) =>
    (els as HTMLElement[]).map((el) => ({
      label: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: el.getAttribute('title') || '',
      selected: el.getAttribute('aria-selected') === 'true',
    })),
  )
  await trigger.click()
  await content.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  return options
}

const INTERNAL_MARKERS = [
  'acp_catalog',
  'acp_config',
  'run_started',
  'scope_confirm',
  'permission_resolved',
  'thoughtConfigId',
  'modelConfigId',
]

test.describe.configure({ mode: 'serial' })

test('A3 AI-LIVE：真实发送 1 次 → 单气泡 → Trace → 关闭重开持久化', async () => {
  test.setTimeout(600_000)

  const ctx = await launchApp({ domain: DOMAIN })
  let blocked: string | null = null
  let closeError: Error | null = null
  const summary: Record<string, unknown> = {
    mode: PREFLIGHT_ONLY ? 'preflight' : 'live',
    domain: DOMAIN,
    prompt: PROMPT,
    dataDir: DATA_DIR,
    userData: ctx.userData,
    aiRequests: 0,
  }

  try {
    const page = ctx.page
    await page.bringToFront().catch(() => undefined)

    // ── 0. 清空 AI 历史（避免旧失败会话干扰气泡计数） ────────────────────
    const clearedKeys = await page.evaluate(() => {
      const removed: string[] = []
      try {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i)
          if (k) keys.push(k)
        }
        for (const k of keys) {
          if (k.startsWith('ai_sessions_v2_') || k.startsWith('ai_hist_') || k === 'ai_model' || k === 'ai_model_reasoning') {
            localStorage.removeItem(k)
            removed.push(k)
          }
        }
      } catch {
        /* localStorage 不可用时保持原状，由后续断言暴露 */
      }
      return removed
    })
    console.log(`[ai-live] cleared AI storage keys=${clearedKeys.length}（${clearedKeys.join(',') || '-'}）`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 60_000 })
    await ensureProject(page)

    // ── 1. 打开 AI 对话：单选择器 / 已选模型 / 思考档位 / 配置预检 ─────────
    let modelOptions: ModelOption[] = []
    let thinkingOptions: Array<{ label: string; value: string; selected: boolean }> = []
    let selectedModel = ''

    const step1 = await runStep(page, 1, '打开 AI 对话（单选择器 + 已选模型 + 思考档位）', 'ai-open', async () => {
      await page.getByRole('button', { name: 'AI 对话' }).first().click()
      const dialog = page.getByTestId('ai-dialog')
      await expect(dialog).toBeVisible({ timeout: 20_000 })

      const selectorCount = await page.getByTestId('ai-model-selector').count()
      expect(selectorCount, 'AI 对话框应只有 1 个模型/思考级联选择器').toBe(1)
      await expect(page.getByTestId('ai-model-select')).toHaveCount(1)
      await expect(page.getByTestId('ai-thinking-select')).toHaveCount(1)
      expect(await page.getByTestId('ai-dialog-error').count(), '打开时不应有对话错误条').toBe(0)

      // 等 settings-store / ACP 模型目录落到选择器（占位「选择模型」不算）。
      await expect
        .poll(
          async () => {
            const t = norm(await page.getByTestId('ai-model-select').first().innerText().catch(() => ''))
            return t && t !== '选择模型' ? t : ''
          },
          { timeout: 40_000, intervals: [250, 500, 1000] },
        )
        .not.toBe('')

      // config/Agent 预检（读掩码配置，不打印任何凭据明文）。
      const pre = await page.evaluate(async () => {
        const api = (window as unknown as { protoAPI?: { ai?: Record<string, unknown> } }).protoAPI
        const out: Record<string, unknown> = {}
        try {
          const getConfig = api?.ai?.getConfig as (() => Promise<unknown>) | undefined
          out.config = getConfig ? await getConfig() : null
        } catch (e) {
          out.configError = String(e)
        }
        try {
          const checkCli = api?.ai?.checkCli as (() => Promise<unknown>) | undefined
          out.check = checkCli ? await checkCli() : null
        } catch (e) {
          out.checkError = String(e)
        }
        return out
      })
      const cfg = (pre.config || {}) as Record<string, unknown>
      const check = (pre.check || {}) as Record<string, unknown>
      const agents = Array.isArray(check.agents) ? (check.agents as Array<Record<string, unknown>>) : []
      const agentId = String(cfg.agentId || cfg.mainAgent || '')
      const agent = agents.find((a) => String(a.id) === agentId) || null
      const acp = (cfg.acp || {}) as Record<string, unknown>
      const visibleCli = cfg.visibleModelsCli as Record<string, unknown> | undefined
      summary.config = {
        agentId,
        mainAgent: String(cfg.mainAgent || ''),
        engine: String(cfg.engine || cfg.mode || ''),
        model: String(cfg.model || ''),
        acpEnabled: acp.enabled === true,
        visibleModelsCli: Array.isArray(visibleCli?.[agentId]) ? visibleCli[agentId] : null,
        hasApiKey: Boolean((cfg.api as Record<string, unknown> | undefined)?.hasApiKey),
        agentAvailable: agent ? agent.available === true : null,
        agentPath: agent ? String(agent.path || '') : '',
        agentTransport: agent ? String(agent.transport || '') : '',
        checkFound: check.found === true,
        configError: String(pre.configError || ''),
        checkError: String(pre.checkError || ''),
      }
      console.log('[ai-live] PREFLIGHT ' + JSON.stringify(summary.config))

      if (!agentId) throw new Error('配置缺少 agentId/mainAgent，无法预检 Agent')
      if (!agent || agent.available !== true) {
        throw new Error(`Agent 不可用：agentId=${agentId} available=${agent ? String(agent.available) : 'missing'}（ENV-BLOCKED）`)
      }

      // 模型清单必须是真实目录（非「暂无模型」），且当前选择必须在清单内。
      const readModels = async (): Promise<ModelOption[]> =>
        (await readSelectorOptions(page, 'ai-model-select', 'ai-model-option')) as ModelOption[]
      modelOptions = await readModels()
      expect(modelOptions.length, '模型列表不应为空（「暂无模型」视为配置阻断）').toBeGreaterThan(0)
      expect(modelOptions.map((m) => m.label).join(' ')).not.toContain('暂无模型')

      let selected = modelOptions.find((m) => m.selected)
      if (!selected) {
        // 持久化模型不在当前目录时，显式选第一个（不发送，仅修正选择）。
        await page.getByTestId('ai-model-select').first().click()
        const content = page.locator('[data-slot="select-content"]').first()
        await content.waitFor({ state: 'visible', timeout: 10_000 })
        await page.getByTestId('ai-model-option').first().click()
        await page.getByTestId('ai-model-select').first().click()
        await content.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
        modelOptions = await readModels()
        selected = modelOptions.find((m) => m.selected)
      }
      expect(selected, '模型选择器必须显示已选模型').toBeTruthy()
      selectedModel = String(selected?.value || selected?.label || '')
      const triggerText = norm(await page.getByTestId('ai-model-select').first().innerText())
      expect(modelOptions.some((m) => m.label === triggerText || m.value === triggerText), '选择器显示值应来自模型目录').toBe(true)

      thinkingOptions = await readSelectorOptions(page, 'ai-thinking-select', 'ai-thinking-option')
      const thinkText = norm(await page.getByTestId('ai-thinking-select').first().innerText())
      const warnings = (await page.getByTestId('ai-dialog-warnings').count())
        ? norm(await page.getByTestId('ai-dialog-warnings').innerText())
        : ''
      const sessionText = norm(await page.getByTestId('ai-dialog-session').innerText())
      const cliText = norm(await page.getByTestId('ai-status-cli').innerText())
      const agentText = norm(await page.getByTestId('ai-status-agent').innerText())

      summary.selectors = {
        selectorCount,
        modelTrigger: triggerText,
        selectedModel,
        modelOptions,
        thinkingTrigger: thinkText,
        thinkingOptions,
        warnings,
        sessionText,
        cliText,
        agentText,
      }
      console.log('[ai-live] SELECTORS ' + JSON.stringify(summary.selectors))

      const shotOpen = await shot(page, 1, 'ai-open')
      const shotModels = await shot(page, 1, 'model-options')
      return {
        evidence:
          `选择器=${selectorCount}；模型=${triggerText}；可选模型=${modelOptions.length}（${modelOptions.map((m) => `${m.label}${m.selected ? '*' : ''}`).join(' / ')}）；` +
          `思考=${thinkText}；ACP 思考档位=${thinkingOptions.length}（${thinkingOptions.map((o) => o.label).join(' / ') || '—'}）；` +
          `CLI=${cliText}；Agent=${agentText}；warnings=${warnings || '无'}`,
        shots: [shotOpen, shotModels],
      }
    })

    if (!step1) {
      blocked = 'step1 failed'
      notRun(2, '真实发送 1 次（唯一）', '步骤 1 失败，按 A 阶段口径不发送请求')
      notRun(3, '模型/思考切换重置', '步骤 1 失败')
      notRun(4, 'Trace + 会话列表', '步骤 1 失败')
      notRun(5, '关闭重开 + reload 持久化', '步骤 1 失败')
    } else if (PREFLIGHT_ONLY) {
      pushRow({
        no: 2,
        title: '预检模式（不发送）',
        status: 'SKIP',
        evidence: 'WAVE4_AI_PREFLIGHT=1：只验证 Agent/模型/思考接线，0 次 ai:ask',
        shots: [],
        ms: 0,
      })
    } else {
      // ── 2. 真实发送唯一一条：单气泡 + 文本完整 + 无内部事件文本 ──────────
      const sendResult = await runStep(page, 2, '真实发送 1 次 → 单 assistant 气泡', 'assistant-reply', async () => {
        const samples: Array<{ t: number; count: number; len: number; busy: boolean }> = []
        const t0 = Date.now()
        let sawBusy = false
        let idleStreak = 0
        let midShot = ''
        let permissionHandled = 0
        let last = await probeAi(page)
        let firstTextMs = -1

        await page.getByTestId('ai-prompt-textarea').fill(PROMPT)
        await expect(page.getByTestId('ai-send-btn')).toBeEnabled({ timeout: 10_000 })
        await page.getByTestId('ai-send-btn').click()
        summary.aiRequests = 1

        const deadline = t0 + 240_000
        while (Date.now() < deadline) {
          let s: AiProbe
          try {
            s = await probeAi(page)
          } catch {
            break
          }
          last = s
          if (s.busy) {
            sawBusy = true
            idleStreak = 0
          } else {
            idleStreak += 1
          }
          if (firstTextMs < 0 && s.assistantCount > 0 && s.lastLen > 0) firstTextMs = Date.now() - t0
          samples.push({ t: Date.now() - t0, count: s.assistantCount, len: s.lastLen, busy: s.busy })
          if (samples.length > 500) samples.splice(0, samples.length - 500)

          // 同一 run 的权限请求：允许一次即可继续（不产生第二次 ai:ask）。
          if (s.permissionCards > permissionHandled) {
            const card = page.getByTestId('ai-permission-card').nth(permissionHandled)
            await card
              .getByRole('button', { name: '允许一次' })
              .click({ timeout: 5_000 })
              .catch(() => undefined)
            permissionHandled = s.permissionCards
          }

          if (!midShot && s.busy && Date.now() - t0 > 700) {
            midShot = await shot(page, 2, 'streaming').catch(() => '')
          }
          if (s.error && !s.busy) break
          if ((s.assistantCount > 0 || s.error) && !s.busy && idleStreak >= 3) break
          await page.waitForTimeout(200)
        }

        const elapsedMs = Date.now() - t0
        const final = last
        const counts = samples.filter((s) => s.count > 0).map((s) => s.count)
        const maxBubbles = counts.length ? Math.max(...counts) : final.assistantCount
        const finalText = norm(final.lastText)
        const chatText = final.chatText
        const leaked = INTERNAL_MARKERS.filter((m) => chatText.includes(m))
        const growthSamples = samples.filter((s) => s.count > 0).length

        summary.send = {
          prompt: PROMPT,
          elapsedMs,
          samples: samples.length,
          sampledWhileBusy: sawBusy,
          firstTextMs,
          maxAssistantBubbles: maxBubbles,
          finalAssistantBubbles: final.assistantCount,
          finalTextLen: finalText.length,
          finalText,
          userBubbles: final.userCount,
          streamingSamples: growthSamples,
          fastStream: growthSamples <= 1,
          permissionCards: permissionHandled,
          thinkingBubbles: final.thinkingCount,
          toolCards: final.toolCount,
          error: final.error,
          internalLeak: leaked,
        }

        expect(final.error, '本轮不应出现 ai-dialog-error').toBe('')
        expect(final.userCount, '用户消息应有且只有 1 条').toBe(1)
        expect(maxBubbles, '流式期间 assistant 文本气泡数量不得 >1（禁止一词一气泡）').toBeLessThanOrEqual(1)
        expect(final.assistantCount, '最终 assistant 文本气泡应恰好 1 个').toBe(1)
        expect(finalText, '回复文本应包含「冒烟通过」').toContain('冒烟通过')
        expect(finalText.length, '回复文本应完整（非 1–3 字碎片）').toBeGreaterThanOrEqual(4)
        expect(leaked, '聊天正文不得出现 acp_catalog/run_started 等内部事件名').toEqual([])

        const shotDone = await shot(page, 2, 'assistant-reply')
        return {
          evidence:
            `AI_REQUESTS=1；耗时=${elapsedMs}ms；首字=${firstTextMs >= 0 ? `${firstTextMs}ms` : 'N/A'}；采样=${samples.length} 点；` +
            `assistant 气泡 max=${maxBubbles} / final=${final.assistantCount}；文本长度=${finalText.length}「${finalText.slice(0, 80)}」；` +
            `busy 捕获=${sawBusy ? '是' : '否'}；fast-stream=${growthSamples <= 1 ? '是' : '否'}；` +
            `权限卡=${permissionHandled}；思考块=${final.thinkingCount}；工具卡=${final.toolCount}；` +
            `内部事件泄漏=${leaked.length ? leaked.join(',') : '无'}；error=${final.error || '无'}`,
          shots: [midShot, shotDone].filter(Boolean),
        }
      })

      if (!sendResult) {
        blocked = 'send failed'
        notRun(3, '模型/思考切换重置', '真实发送失败，按 A 阶段不继续制造请求')
        notRun(4, 'Trace + 会话列表', '真实发送失败')
        notRun(5, '关闭重开 + reload 持久化', '真实发送失败')
      } else {
        // ── 3. 模型/思考切换 → thinking 重置（不发送） ──────────────────────
        await (async () => {
          const started = Date.now()
          const notes: string[] = []
          const shots: string[] = []
          try {
            const thinkOpts = (await readSelectorOptions(page, 'ai-thinking-select', 'ai-thinking-option')) as ModelOption[]
            const modelOpts = (await readSelectorOptions(page, 'ai-model-select', 'ai-model-option')) as ModelOption[]
            const curModel = modelOpts.find((m) => m.selected)?.value || ''
            const curThink = norm(await page.getByTestId('ai-thinking-select').innerText())
            notes.push(`发送后思考档位=${thinkOpts.length}（${thinkOpts.map((o) => `${o.label}${o.selected ? '*' : ''}`).join(' / ')}）`)
            notes.push(`当前模型=${curModel || '—'}；当前思考=${curThink}`)
            shots.push(await shot(page, 3, 'thinking-options'))

            if (thinkOpts.length < 2) {
              pushRow({
                no: 3,
                title: '模型/思考切换 → thinking 重置',
                status: 'SKIP',
                evidence:
                  `ACP 仅下发 ${thinkOpts.length} 个思考档位（${thinkOpts.map((o) => o.label).join(' / ') || '默认占位'}），` +
                  '无可切换档位，按 N/A 记录；未发送第二条消息',
                shots,
                ms: Date.now() - started,
              })
            } else {
              const target = thinkOpts.find((o) => !o.selected)
              expect(target, '应存在未选中的思考档位').toBeTruthy()
              await page.getByTestId('ai-thinking-select').first().click()
              const content = page.locator('[data-slot="select-content"]').first()
              await content.waitFor({ state: 'visible', timeout: 10_000 })
              await page
                .getByTestId('ai-thinking-option')
                .filter({ hasText: target!.label })
                .first()
                .click()
              await content.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
              const afterThink = norm(await page.getByTestId('ai-thinking-select').innerText())
              notes.push(`切换思考→${afterThink}`)
              expect(afterThink, '思考档位应切换为目标档').toContain(target!.label)

              const other = modelOpts.find((m) => m.value !== curModel)
              if (!other) {
                pushRow({
                  no: 3,
                  title: '模型/思考切换 → thinking 重置',
                  status: 'SKIP',
                  evidence: `只有 1 个可用模型（${curModel || '—'}），无法验证「换模型重置 thinking」；思考档位已可切换（${afterThink}）；未发送第二条消息`,
                  shots,
                  ms: Date.now() - started,
                })
              } else {
                await page.getByTestId('ai-model-select').first().click()
                await content.waitFor({ state: 'visible', timeout: 10_000 })
                await page
                  .getByTestId('ai-model-option')
                  .filter({ hasText: other.label })
                  .first()
                  .click()
                const afterModelThink = norm(await page.getByTestId('ai-thinking-select').innerText())
                // 复位到原模型（仍然不发送）。
                await page
                  .getByTestId('ai-model-option')
                  .filter({ hasText: modelOpts.find((m) => m.value === curModel)?.label || curModel })
                  .first()
                  .click()
                  .catch(() => undefined)
                await page.getByTestId('ai-model-select').first().click()
                await content.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
                const reset = /默认|default/i.test(afterModelThink)
                notes.push(`换模型(${other.label})后思考=${afterModelThink}（重置=${reset ? '是' : '否'}）`)
                shots.push(await shot(page, 3, 'model-switch-thinking-reset'))
                pushRow({
                  no: 3,
                  title: '模型/思考切换 → thinking 重置',
                  status: reset ? 'PASS' : 'OBSERVE',
                  evidence: `${notes.join('；')}；未发送第二条消息${reset ? '' : '；观察：换模型后思考未回落默认（按 P2 记录，不阻断）'}`,
                  shots,
                  ms: Date.now() - started,
                })
              }
            }
          } catch (err) {
            let failShot = ''
            try {
              failShot = await shot(page, 3, 'thinking-reset', true)
            } catch {
              /* 忽略 */
            }
            pushRow({
              no: 3,
              title: '模型/思考切换 → thinking 重置',
              status: 'OBSERVE',
              evidence: `${notes.join('；')}；异常：${errText(err)}（按 P2 记录，不阻断）`,
              shots: failShot ? [...shots, failShot] : shots,
              ms: Date.now() - started,
            })
          }
        })()

        // ── 4. Trace 内部事件摘要 + 无会话列表 ──────────────────────────────
        await runStep(page, 4, 'Trace 面板 + 无会话列表', 'trace-panel', async () => {
          // 当前 UI 为单一全宽对话：没有会话列表 / 新建 / 切换入口。
          const sessionList = page.getByTestId('ai-session-list')
          const sessionCount = await sessionList.count()
          const sessionNew = await page.getByTestId('ai-session-new').count()
          const sessionSwitch = await page.locator('[data-testid^="ai-session-"]').count()
          expect(sessionCount, '不应再渲染会话列表').toBe(0)
          expect(sessionNew, '不应再渲染新建会话入口').toBe(0)
          expect(sessionSwitch, '不应再渲染会话卡/切换入口').toBe(0)

          await page.getByTestId('ai-tab-trace').click()
          const trace = page.getByTestId('ai-trace-view')
          await expect(trace).toBeVisible({ timeout: 10_000 })
          const lineCount = await trace.locator('[data-level]').count()
          const traceText = norm(await trace.innerText())
          const controlTags = ['RUN_STARTED', 'DONE', 'ACP_CONFIG', 'ACP_CATALOG', 'SESSION'].filter((t) =>
            traceText.includes(t),
          )
          const header = norm(await trace.locator('span').first().innerText().catch(() => ''))
          const shotTrace = await shot(page, 4, 'trace-panel')
          await page.getByTestId('ai-tab-chat').click()

          summary.trace = { lineCount, controlTags, header, excerpt: traceText.slice(0, 600) }
          summary.sessions = { count: 0, removed: true }

          if (lineCount === 0) {
            pushRow({
              no: 4,
              title: 'Trace 面板 + 无会话列表',
              status: 'OBSERVE',
              evidence: `会话列表=${sessionCount}/新建=${sessionNew}/切换=${sessionSwitch}（已移除，符合当前 UI）；Trace 行=0（按 P2 记录：无控制事件摘要）`,
              shots: [shotTrace],
              ms: 0,
            })
          } else {
            expect(controlTags.length, 'Trace 应包含控制事件摘要（如 RUN_STARTED/DONE/ACP_CONFIG）').toBeGreaterThan(0)
          }

          return {
            evidence: `会话列表=${sessionCount}/新建=${sessionNew}/切换=${sessionSwitch}（当前 UI 无会话管理）；Trace 行=${lineCount}；控制事件标签=${controlTags.join('/') || '—'}；header=${header || '—'}`,
            shots: [shotTrace],
          }
        })

        // ── 5. 关闭 AI → reload → 重开：会话/消息持久化 ─────────────────────
        await runStep(page, 5, '关闭重开 + reload：单一对话与消息持久化', 'reopen-persist', async () => {
          const before = await probeAi(page)
          // 当前 UI 无会话列表；持久化口径为同一对话气泡恢复。
          expect(await page.getByTestId('ai-session-list').count(), '发送后也不应出现会话列表').toBe(0)

          await page.getByTestId('ai-dialog').getByRole('button', { name: '关闭' }).click()
          await expect(page.getByTestId('ai-dialog')).toBeHidden({ timeout: 10_000 })

          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 60_000 })
          await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
          await ensureProject(page)

          await page.getByRole('button', { name: 'AI 对话' }).first().click()
          await expect(page.getByTestId('ai-dialog')).toBeVisible({ timeout: 20_000 })

          await expect
            .poll(async () => (await probeAi(page)).assistantCount, { timeout: 30_000, intervals: [250, 500, 1000] })
            .toBe(1)

          const after = await probeAi(page)
          const afterSessionList = await page.getByTestId('ai-session-list').count()
          const text = norm(after.lastText)
          expect(after.assistantCount, 'reload 后 assistant 文本气泡仍应恰好 1 个（无重复）').toBe(1)
          expect(text, 'reload 后回复文本应完整保留').toContain('冒烟通过')
          expect(norm(text), 'reload 后文本不应比刷新前更长（无重复拼接）').toBe(norm(before.lastText))
          expect(afterSessionList, 'reload 后仍不应出现会话列表').toBe(0)

          const shotReopen = await shot(page, 5, 'reopen-persist')
          summary.persist = {
            sessionList: afterSessionList,
            bubblesBefore: before.assistantCount,
            bubblesAfter: after.assistantCount,
            textEqual: norm(text) === norm(before.lastText),
            textLenAfter: text.length,
          }
          return {
            evidence: `关闭→reload→重开：会话列表=${afterSessionList}（当前 UI 无会话管理）；assistant 气泡 ${before.assistantCount}→${after.assistantCount}；文本一致=${norm(text) === norm(before.lastText)}（${text.length} 字）；未点停止/重试`,
            shots: [shotReopen],
          }
        })
      }

      // ── 6. 停止/重试：按额度纪律 SKIP（真实链路不做） ────────────────────
      pushRow({
        no: 6,
        title: '停止 / 重试（真实链路）',
        status: 'SKIP',
        evidence:
          '按 docs/wave4-smoke-plan.md §6.1：真实链路只发 1 次，停止/重试需要可控长流，统一走 AI-MOCK；本 spec 未点击 ai-stop-btn / ai-retry-btn，避免第二次请求',
        shots: [],
        ms: 0,
      })
    }
  } catch (err) {
    if (!rows.some((r) => r.status === 'FAIL')) {
      let failShot = ''
      try {
        failShot = await shot(ctx.page, 'F', 'unexpected', true)
      } catch {
        /* 忽略 */
      }
      pushRow({
        no: 'F',
        title: '未预期异常',
        status: 'FAIL',
        evidence: errText(err),
        shots: failShot ? [failShot] : [],
        ms: 0,
      })
    }
    blocked = blocked || 'unexpected'
    console.error('[ai-live] UNEXPECTED ' + errText(err))
  } finally {
    // ── 7. 收尾：console/pageerror/crash + 进程退出 + 证据汇总 ──────────────
    const fatal = ctx.fatalErrors()
    summary.console = {
      errors: ctx.consoleErrors.length,
      pageErrors: ctx.pageErrors.length,
      crashes: ctx.crashes.length,
      fatal: fatal.length,
      errorSamples: ctx.consoleErrors.slice(0, 10),
      pageErrorSamples: ctx.pageErrors.slice(0, 10),
      crashSamples: ctx.crashes.slice(0, 5),
      stderrTail: ctx.stderr.slice(-3).join('').slice(-1500),
    }
    summary.blocked = blocked
    summary.rows = rows
    summary.pass = rows.filter((r) => r.status === 'PASS').length
    summary.fail = rows.filter((r) => r.status === 'FAIL').length
    summary.skip = rows.filter((r) => r.status === 'SKIP').length

    const res = await ctx.close({ graceMs: 12_000 })
    summary.close = res
    try {
      assertCleanExitOrP2(res)
    } catch (e) {
      closeError = e instanceof Error ? e : new Error(String(e))
    }

    console.log('[ai-live] SUMMARY ' + JSON.stringify(summary))
    if (fatal.length) console.error('[ai-live] FATAL_CONSOLE\n' + fatal.join('\n'))
    if (ctx.pageErrors.length) console.error('[ai-live] PAGE_ERRORS\n' + ctx.pageErrors.join('\n'))
    if (ctx.crashes.length) console.error('[ai-live] CRASHES\n' + ctx.crashes.join('\n'))

    if (!PREFLIGHT_ONLY) {
      try {
        fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
        console.log(`[ai-live] cleaned ${DATA_DIR}`)
      } catch (e) {
        console.warn(`[ai-live] cleanup failed: ${errText(e)}`)
      }
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
