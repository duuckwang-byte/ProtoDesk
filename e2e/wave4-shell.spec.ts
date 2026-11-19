/**
 * e2e/wave4-shell.spec.ts — Wave4 A1 主壳 / 项目 / 侧栏域真机冒烟。
 *
 * 覆盖（只判 P0/P1 功能阻断）：
 *   1. 冷启动主壳可见 + userData 隔离 + 项目下拉（项目/原型数、搜索过滤、新建并切换）；
 *   2. 侧栏真实原型 + 选中态（无蓝色/无计数）+ 子页（seed 无数据则 SKIP）；
 *   3. 新建文件夹 + 双击行内重命名（Enter/Esc）+ 原型/文件夹跨组拖拽 + 折叠/展开；
 *   3b. 子页排序（seed 无子页，SKIP）；
 *   4. 侧栏收起 → MiniDock（展开 / AI 设计 / 设置）；
 *   5. 顶栏刷新、功能说明/最新需求、AI/Git/导出/设置、终端（stub，不真实拉起）、Esc；
 *   6. console/pageerror 采集与收尾。
 *
 * 运行（先 seed，再单域跑）：
 *   node e2e/wave4/seed.mjs --domain shell
 *   npx playwright test e2e/wave4-shell.spec.ts --workers=1 --output=test-results/wave4/shell
 *
 * 写入范围：本 spec 只写 docs/wave4/shots/shell/** 与 .devdata-wave4-shell/**，不改产品代码。
 */
import { test, expect } from '@playwright/test'
import * as path from 'node:path'
import type { Locator, Page } from 'playwright'
import { ROOT, launchApp, type Wave4App } from './wave4/harness'

type StepStatus = 'PASS' | 'FAIL' | 'SKIP' | 'NOT RUN'

interface StepRow {
  no: number | string
  title: string
  status: StepStatus
  evidence: string
  shots: string[]
  ms: number
}

const rows: StepRow[] = []

function relShot(abs: string): string {
  return path.relative(ROOT, abs).replace(/\\/g, '/')
}

function norm(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n').slice(0, 6).join(' | ')
  return String(err)
}

async function runStep(
  ctx: Wave4App,
  no: number | string,
  title: string,
  slug: string,
  fn: () => Promise<{ evidence: string; shots?: string[]; status?: StepStatus }>,
): Promise<boolean> {
  const started = Date.now()
  try {
    const out = await fn()
    const row: StepRow = {
      no,
      title,
      status: out.status ?? 'PASS',
      evidence: out.evidence,
      shots: (out.shots ?? []).map(relShot),
      ms: Date.now() - started,
    }
    rows.push(row)
    console.log(`[shell] STEP ${no} ${row.status} ${title} | ${row.evidence} | ${row.shots.join(',') || '-'} | ${row.ms}ms`)
    return true
  } catch (err) {
    const message = errorText(err)
    let failShot = ''
    try {
      failShot = relShot(await ctx.shot(no, slug, { fail: true }))
    } catch {
      /* 页面可能已崩溃，无法截图 */
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
    console.error(`[shell] STEP ${no} FAIL ${title} | ${message} | ${row.shots.join(',') || '-'}`)
    return false
  }
}

function markNotRun(from: number, title: string): void {
  rows.push({
    no: from,
    title,
    status: 'NOT RUN',
    evidence: '前序步骤 FAIL，按 A 阶段口径停止后续步骤',
    shots: [],
    ms: 0,
  })
}

/** 冷启动：等项目恢复；若弹选择器则选「测试1」进入。 */
async function ensureProject(page: Page): Promise<boolean> {
  await page.waitForTimeout(2_500)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    const row = picker.locator('li').filter({ hasText: '测试1' }).first()
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
  return shown
}

function sidebarProject(page: Page): Locator {
  return page.getByTestId('sidebar').locator('button[title="切换项目"]')
}

function protoButtons(page: Page): Locator {
  return page.getByTestId('sidebar-tree').locator('button[data-level="proto"]')
}

function groupRow(page: Page, name: string): Locator {
  return page
    .getByTestId('sidebar-tree')
    .locator('[data-level="group-row"]')
    .filter({ hasText: name })
    .first()
}

/** 通过真实 IPC 新建文件夹（侧栏顶部 FolderPlus 按钮 + Dialog）。 */
async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByTestId('sidebar').getByRole('button', { name: '新建文件夹' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  const input = dialog.locator('input[aria-label="新建文件夹"]')
  await expect(input).toBeVisible()
  await input.fill(name)
  await dialog.getByRole('button', { name: '确定' }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await expect(groupRow(page, name)).toBeVisible({ timeout: 10_000 })
}

/** 启动 HTML5 拖拽（React onDragStart 读 dragRef + dataTransfer）。 */
async function startDrag(source: Locator): Promise<void> {
  await source.evaluate((el) => {
    const dt = new DataTransfer()
    ;(window as unknown as { __w4DragDT?: DataTransfer }).__w4DragDT = dt
    el.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }),
    )
  })
}

/** 在目标上 dragover + drop；where 控制 group/rowPosition 的落点。 */
async function dropOn(
  page: Page,
  target: Locator,
  where: 'center' | 'top' | 'bottom' = 'center',
): Promise<void> {
  const box = await target.boundingBox()
  if (!box) throw new Error('拖拽目标没有布局盒（不可见/已卸载）')
  const offsetY =
    where === 'top' ? 2 : where === 'bottom' ? Math.max(2, box.height - 2) : Math.max(2, box.height / 2)
  const dispatch = async (type: 'dragover' | 'drop') => {
    await target.evaluate(
      (el, args) => {
        const dt = (window as unknown as { __w4DragDT?: DataTransfer }).__w4DragDT
        const r = (el as HTMLElement).getBoundingClientRect()
        el.dispatchEvent(
          new DragEvent(args.type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt || null,
            clientX: r.left + r.width / 2,
            clientY: r.top + args.offsetY,
          }),
        )
      },
      { type, offsetY },
    )
  }
  await dispatch('dragover')
  await page.waitForTimeout(150)
  await dispatch('drop')
  await page.waitForTimeout(300)
}

async function readGroups(page: Page): Promise<{ list: Array<{ id: string; name: string; parent: string | null }>; map: Record<string, string> }> {
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    'protoGroups_v1__' + encodeURIComponent('测试1'),
  )
  if (!raw) return { list: [], map: {} }
  return JSON.parse(raw) as { list: Array<{ id: string; name: string; parent: string | null }>; map: Record<string, string> }
}

test.describe('Wave4 A1 主壳 / 项目 / 侧栏', () => {
  test('A1 shell：冷启动→项目→侧栏→文件夹拖拽→MiniDock→顶栏面板/Esc', async ({}, testInfo) => {
    test.setTimeout(300_000)
    const ctx = await launchApp({ domain: 'shell' })
    let closeResult: Awaited<ReturnType<Wave4App['close']>> | null = null
    try {
      const page = ctx.page
      await page.bringToFront().catch(() => undefined)

      // ── 0. 数据隔离（harness 已断言，这里固化到报告证据） ───────────────
      const expected = path.resolve(ctx.dataDir)
      const actual = path.resolve(ctx.userData)
      expect(actual.toLowerCase(), 'userData 必须精确指向域隔离目录').toBe(expected.toLowerCase())
      console.log(`[shell] ISOLATION expected=${expected} actual=${actual} seed=${ctx.seedPresent}`)

      // ── 1. 冷启动 + 项目下拉 ───────────────────────────────────────────
      let baselineProtoCount = 0
      let ok = await runStep(ctx, 1, '冷启动 / 项目下拉（原型数 / 搜索 / 新建 / 切换）', 'cold-start', async () => {
        const shots: string[] = []
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('topbar')).toBeVisible()
        await expect(page.getByTestId('stage-frame')).toBeVisible()

        const pickerShown = await ensureProject(page)
        await expect
          .poll(async () => norm(await sidebarProject(page).innerText()), { timeout: 30_000 })
          .toBe('测试1')
        const protoCount = await protoButtons(page).count()
        baselineProtoCount = protoCount
        expect(protoCount, '侧栏应有真实原型').toBeGreaterThan(0)
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
          timeout: 20_000,
        })
        await expect(page.getByTestId('sidebar-tree')).toBeVisible()
        shots.push(await ctx.shot(1, 'cold-start'))

        // 项目下拉：至少 1 个真实项目；「测试1」显示 2 个原型。
        await page.getByTestId('project-switch').click()
        const menu = page.getByTestId('project-menu')
        await expect(menu).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('project-search')).toBeVisible()
        await expect(page.getByTestId('project-create-input')).toBeVisible()
        const options = menu.locator('[role="option"]')
        await expect.poll(() => options.count(), { timeout: 10_000 }).toBeGreaterThan(0)
        const test1Option = options.filter({ hasText: '测试1' }).first()
        await expect(test1Option).toBeVisible()
        await expect(test1Option).toContainText(new RegExp(`${protoCount}\\s*个原型`))
        const optionTexts = (await options.allInnerTexts()).map(norm)
        shots.push(await ctx.shot(1, 'project-menu'))

        // 搜索过滤：命中 1 个；无匹配时显示空态；清空恢复。
        await page.getByTestId('project-search').fill('测试')
        await expect.poll(() => options.count(), { timeout: 5_000 }).toBe(1)
        await page.getByTestId('project-search').fill('w4-绝对不存在的项目')
        await expect.poll(() => options.count(), { timeout: 5_000 }).toBe(0)
        await expect(menu.getByText('无匹配项目')).toBeVisible()
        shots.push(await ctx.shot(1, 'project-search-empty'))
        await page.getByTestId('project-search').fill('')
        await expect.poll(() => options.count(), { timeout: 5_000 }).toBe(optionTexts.length)

        // 新建临时项目并进入（隔离目录，跑完整目录丢弃）。
        const stamp = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const tempName = `W4-临时-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
        await page.getByTestId('project-create-input').fill(tempName)
        await page.getByTestId('project-create').click()
        await expect(menu).toBeHidden({ timeout: 30_000 })
        await expect
          .poll(async () => norm(await sidebarProject(page).innerText()), { timeout: 30_000 })
          .toBe(tempName)
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '0', {
          timeout: 10_000,
        })
        await expect(page.getByTestId('sidebar-tree').getByText('暂无原型')).toBeVisible({
          timeout: 10_000,
        })
        await expect.poll(() => protoButtons(page).count(), { timeout: 10_000 }).toBe(0)
        shots.push(await ctx.shot(1, 'project-created-empty'))

        // 切换回「测试1」：下拉选择 → 侧栏 2 个原型。
        await page.getByTestId('project-switch').click()
        await expect(menu).toBeVisible({ timeout: 10_000 })
        await menu.locator('[role="option"]').filter({ hasText: '测试1' }).first().click()
        await expect(menu).toBeHidden({ timeout: 30_000 })
        await expect
          .poll(async () => norm(await sidebarProject(page).innerText()), { timeout: 30_000 })
          .toBe('测试1')
        await expect.poll(() => protoButtons(page).count(), { timeout: 20_000 }).toBe(baselineProtoCount)
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
          timeout: 20_000,
        })
        shots.push(await ctx.shot(1, 'project-switched-back'))

        const names = (await protoButtons(page).allInnerTexts()).map(norm)
        return {
          evidence:
            `userData=${actual}（精确隔离）；项目选择器=${pickerShown ? '出现→进入测试1' : '未出现（自动恢复）'}；` +
            `项目下拉=${optionTexts.length} 项（${optionTexts.join(' / ')}）；测试1=「${baselineProtoCount} 个原型」；` +
            `搜索「测试」=1 项、无匹配空态=可见；新建「${tempName}」→侧栏空态/舞台空态；切回测试1 后原型=${names.length}（${names.join(' / ')}）`,
          shots,
        }
      })
      if (!ok) {
        markNotRun(2, '侧栏真实原型/子页')
        markNotRun(3, '文件夹/重命名/拖拽')
        markNotRun(4, 'MiniDock')
        markNotRun(5, '顶栏面板/Esc')
        markNotRun(6, 'console/pageerror')
      }

      // ── 2. 侧栏真实原型 + 选中态 + 子页 ───────────────────────────────
      if (ok) {
        ok = await runStep(ctx, 2, '侧栏真实原型 / 选中态 / 子页', 'sidebar', async () => {
          const shots: string[] = []
          await expect.poll(() => protoButtons(page).count(), { timeout: 20_000 }).toBe(baselineProtoCount)
          const names = (await protoButtons(page).allInnerTexts()).map(norm)
          expect(names, '侧栏应包含真实原型「首页」「我的」').toEqual(expect.arrayContaining(['首页', '我的']))
          expect(names.join(' '), '侧栏不应出现示例/假数据').not.toMatch(/示例|Demo|测试原型/)

          const tree = page.getByTestId('sidebar-tree')
          const selectProto = async (name: string) => {
            const button = tree.locator('button[data-level="proto"]').filter({ hasText: name }).first()
            await expect(button).toBeVisible()
            await button.click()
            await expect.poll(async () => norm(await page.getByTestId('loc-pill').innerText())).toContain(name)
            const selected = tree.locator('[data-key][data-selected="true"]')
            await expect(selected).toHaveCount(1)
            const info = await selected.evaluate((el) => {
              const node = el as HTMLElement
              const cs = getComputedStyle(node)
              return { bg: cs.backgroundColor, color: cs.color, text: (node.innerText || '').trim() }
            })
            const rgb = (value: string): number[] =>
              (value.match(/\d+/g) || []).slice(0, 3).map((n) => Number(n))
            const [r, g, b] = rgb(info.bg)
            const [cr, cg, cb] = rgb(info.color)
            expect(b > r + 20 && b > g + 20, `选中态背景不应为蓝色：${info.bg}`).toBe(false)
            expect(cb > cr + 20 && cb > cg + 20, `选中态文字不应为蓝色：${info.color}`).toBe(false)
            expect(info.text, '选中行不应出现计数/额外文案').toBe(name)
            return info
          }

          const homeInfo = await selectProto('首页')
          await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
            timeout: 20_000,
          })
          shots.push(await ctx.shot(2, 'proto-home-selected'))
          const mineInfo = await selectProto('我的')
          shots.push(await ctx.shot(2, 'proto-mine-selected'))

          // 子页：seed 的 首页/我的 目录只有主 html，没有子页。
          const subPages = tree.locator('button[data-level="subpage"]')
          const subCount = await subPages.count()
          const subFoldButtons = tree.locator(
            'button[aria-label="收起子页面"], button[aria-label="展开子页面"]',
          )
          const subFoldCount = await subFoldButtons.count()
          expect(subCount, 'seed 基线无子页').toBe(0)
          expect(subFoldCount, '无子页时不应出现子页折叠按钮').toBe(0)

          return {
            evidence:
              `原型=${names.length}（${names.join(' / ')}），无示例数据；首页选中背景=${homeInfo.bg}/文字=${homeInfo.color}，` +
              `我的选中背景=${mineInfo.bg}/文字=${mineInfo.color}；选中行文本=原型名（无计数、无蓝色）；` +
              `子页=${subCount}（seed 无子页，子页折叠按钮=${subFoldCount}，子页排序 SKIP）`,
            shots,
          }
        })
        if (!ok) {
          markNotRun(3, '文件夹/重命名/拖拽')
          markNotRun(4, 'MiniDock')
          markNotRun(5, '顶栏面板/Esc')
          markNotRun(6, 'console/pageerror')
        }
      }

      // ── 3. 文件夹 / 行内重命名 / 跨组拖拽 / 折叠 ──────────────────────
      if (ok) {
        ok = await runStep(ctx, 3, '新建文件夹 / 行内重命名 Enter+Esc / 原型与文件夹跨组拖拽 / 折叠', 'folders-dnd', async () => {
          const shots: string[] = []
          const tree = page.getByTestId('sidebar-tree')
          // 每次运行使用唯一文件夹名，避免沿用 seed/上次运行残留的同名分组导致新建对话框停留。
          const stamp = String(Date.now()).slice(-6)
          const folderA = `W4-文件夹-${stamp}`
          const folderRenamed = `W4-改名-${stamp}`
          const folderParent = `W4-父-${stamp}`

          // 新建文件夹
          await createFolder(page, folderA)
          shots.push(await ctx.shot(3, 'folder-created'))
          const rowA = groupRow(page, folderA)
          const groupButtonA = rowA.locator('button[data-level="group"]')

          // 双击 → 行内重命名：Esc 取消
          await groupButtonA.dblclick()
          const renameInput = page.locator('input[aria-label^="重命名文件夹"]')
          await expect(renameInput).toBeVisible({ timeout: 5_000 })
          await renameInput.fill('W4-取消名')
          await renameInput.press('Escape')
          await expect(renameInput).toBeHidden({ timeout: 5_000 })
          await expect(rowA).toContainText(folderA)
          shots.push(await ctx.shot(3, 'rename-esc-cancelled'))

          // 双击 → Enter 提交
          await groupButtonA.dblclick()
          await expect(renameInput).toBeVisible({ timeout: 5_000 })
          await renameInput.fill(folderRenamed)
          await renameInput.press('Enter')
          await expect(renameInput).toBeHidden({ timeout: 10_000 })
          const rowRenamed = groupRow(page, folderRenamed)
          await expect(rowRenamed).toBeVisible({ timeout: 10_000 })
          const groupsAfterRename = await readGroups(page)
          expect(
            groupsAfterRename.list.some((g) => g.name === folderRenamed),
            '重命名应写入 protoGroups_v1__测试1',
          ).toBe(true)
          shots.push(await ctx.shot(3, 'rename-enter-committed'))

          // 原型拖入文件夹：dragstart → data-dragging=true → drop inside
          const homeRow = tree.locator('[data-key="首页"]').first()
          await expect(homeRow).toBeVisible()
          await startDrag(homeRow)
          await expect(homeRow).toHaveAttribute('data-dragging', 'true', { timeout: 5_000 })
          await dropOn(page, rowRenamed)
          const renameBody = rowRenamed.locator('xpath=following-sibling::div[1]')
          await expect(renameBody.locator('[data-key="首页"]')).toBeVisible({ timeout: 10_000 })
          let groups = await readGroups(page)
          const groupRenamed = groups.list.find((g) => g.name === folderRenamed)
          expect(groupRenamed, '重命名后的文件夹应存在').toBeTruthy()
          expect(groups.map['首页'], '首页应写入分组 map').toBe(groupRenamed!.id)
          shots.push(await ctx.shot(3, 'proto-dragged-into-folder'))

          // 折叠 / 展开
          await rowRenamed.locator('button[data-level="group"]').click()
          await expect(tree.locator('[data-key="首页"]')).toBeHidden({ timeout: 5_000 })
          shots.push(await ctx.shot(3, 'folder-collapsed'))
          await rowRenamed.locator('button[data-level="group"]').click()
          await expect(renameBody.locator('[data-key="首页"]')).toBeVisible({ timeout: 5_000 })
          shots.push(await ctx.shot(3, 'folder-expanded'))

          // 拖出文件夹 → 未分组（tail 投放区）
          const homeInFolder = renameBody.locator('[data-key="首页"]').first()
          await startDrag(homeInFolder)
          const tail = tree.getByText('拖到此处移到未分组', { exact: true })
          await expect(tail).toBeVisible({ timeout: 5_000 })
          await dropOn(page, tail)
          await expect(renameBody.locator('[data-key="首页"]')).toHaveCount(0, { timeout: 10_000 })
          await expect(renameBody.getByText('空文件夹 · 可拖入原型')).toBeVisible({ timeout: 5_000 })
          await expect(tree.locator('[data-key="首页"]')).toBeVisible()
          groups = await readGroups(page)
          expect(groups.map['首页'], '拖出后应清空分组 map').toBeUndefined()
          shots.push(await ctx.shot(3, 'proto-dragged-out'))

          // 文件夹跨组：新建父文件夹，把 W4-改名 拖入 W4-父
          await createFolder(page, folderParent)
          const parentRow = groupRow(page, folderParent)
          const childRow = groupRow(page, folderRenamed)
          await startDrag(childRow)
          await expect(childRow).toHaveAttribute('data-dragging', 'true', { timeout: 5_000 })
          await dropOn(page, parentRow)
          const parentBody = parentRow.locator('xpath=following-sibling::div[1]')
          await expect(parentBody.locator('[data-level="group-row"]').filter({ hasText: folderRenamed })).toBeVisible({
            timeout: 10_000,
          })
          groups = await readGroups(page)
          const parentGroup = groups.list.find((g) => g.name === folderParent)
          const childGroup = groups.list.find((g) => g.name === folderRenamed)
          expect(parentGroup, '父文件夹应存在').toBeTruthy()
          expect(childGroup, '子文件夹应存在').toBeTruthy()
          expect(childGroup!.parent, '拖拽后子文件夹 parent 应指向父文件夹').toBe(parentGroup!.id)
          shots.push(await ctx.shot(3, 'folder-dragged-into-parent'))

          // 子页排序：seed 无子页，明确 SKIP。
          const subCount = await tree.locator('button[data-level="subpage"]').count()
          expect(subCount).toBe(0)

          return {
            evidence:
              `新建「${folderA}」→双击 Esc 保持原名→双击 Enter 改名「${folderRenamed}」（localStorage 已写）；` +
              `首页拖入文件夹：data-dragging=true，map[首页]=${groupRenamed!.id}；折叠/展开行数不丢；` +
              `拖到 tail 回未分组（map 键清除、空文件夹提示可见）；` +
              `「${folderRenamed}」拖入「${folderParent}」：parent=${childGroup!.parent}；子页=0（排序 SKIP）`,
            shots,
          }
        })
        if (!ok) {
          markNotRun(4, 'MiniDock')
          markNotRun(5, '顶栏面板/Esc')
          markNotRun(6, 'console/pageerror')
        }
      }

      // ── 3b. 子页排序（seed 无数据，SKIP） ─────────────────────────────
      if (ok) {
        rows.push({
          no: '3b',
          title: '子页排序',
          status: 'SKIP',
          evidence: 'seed 的「首页」「我的」目录均只有主 html（subPages=0），无法排序；未伪造子页数据',
          shots: [],
          ms: 0,
        })
        console.log('[shell] STEP 3b SKIP 子页排序 | seed 无子页')
      }

      // ── 4. 侧栏收起 → 无 MiniDock；入口回到顶栏/侧栏 ─────────────────
      if (ok) {
        ok = await runStep(ctx, 4, '侧栏收起 / 无 MiniDock（展开 / AI / 设置）', 'minidock', async () => {
          const shots: string[] = []
          await page.getByTestId('topbar').getByRole('button', { name: '收起侧栏' }).click()
          await expect(page.getByTestId('sidebar')).toHaveCount(0, { timeout: 5_000 })
          // 入口收敛：左下角 MiniDock 已停用，不再渲染。
          await expect(page.getByTestId('mini-dock'), '侧栏收起不应再出现 MiniDock').toHaveCount(0)
          const expand = page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' })
          await expect(expand).toBeVisible()
          shots.push(await ctx.shot(4, 'sidebar-collapsed-no-dock'))

          // 顶栏 AI 入口
          await page.getByTestId('topbar').getByRole('button', { name: 'AI 对话' }).click()
          const ai = page.getByTestId('ai-dialog')
          await expect(ai).toBeVisible({ timeout: 15_000 })
          shots.push(await ctx.shot(4, 'collapsed-ai-opened'))
          await page.keyboard.press('Escape')
          await expect(ai).toBeHidden({ timeout: 5_000 })

          // 展开侧栏 → 侧栏底部唯一设置入口
          await expand.click()
          await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 5_000 })
          await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
          const settings = page.getByTestId('settings-dialog')
          await expect(settings).toBeVisible({ timeout: 15_000 })
          shots.push(await ctx.shot(4, 'sidebar-settings-opened'))
          await page.keyboard.press('Escape')
          await expect(settings).toBeHidden({ timeout: 5_000 })

          await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 5_000 })
          shots.push(await ctx.shot(4, 'sidebar-restored'))

          return {
            evidence:
              '收起侧栏后 sidebar=0、mini-dock=0（入口已收敛）；顶栏展开侧栏可见；' +
              'AI 对话→ai-dialog 可见、Esc 关闭；展开侧栏→侧栏底部「打开设置」→settings-dialog 可见、Esc 关闭；sidebar 恢复',
            shots,
          }
        })
        if (!ok) {
          markNotRun(5, '顶栏面板/Esc')
          markNotRun(6, 'console/pageerror')
        }
      }

      // ── 5. 顶栏刷新 / 文档 / AI / Git / 导出 / 设置 / 终端 / Esc ───────
      if (ok) {
        ok = await runStep(ctx, 5, '顶栏刷新 / 文档 / AI / Git / 导出 / 设置 / 终端 / Esc', 'topbar', async () => {
          const shots: string[] = []
          // 固定 PC 舞台，保证文档为 overlay 形态。
          await page.locator('button[title="桌面端舞台"]').click()
          await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', {
            timeout: 10_000,
          })

          // 刷新：无重复行、当前选择不丢
          const beforePill = norm(await page.getByTestId('loc-pill').innerText())
          await page.getByTestId('topbar-refresh').click()
          await expect
            .poll(async () => (await page.getByTestId('topbar-refresh').isEnabled()), { timeout: 20_000 })
            .toBe(true)
          await expect.poll(() => protoButtons(page).count(), { timeout: 20_000 }).toBe(baselineProtoCount)
          const afterNames = (await protoButtons(page).allInnerTexts()).map(norm)
          expect(new Set(afterNames).size, '刷新后原型行不得重复').toBe(afterNames.length)
          await expect.poll(async () => norm(await page.getByTestId('loc-pill').innerText())).toBe(beforePill)
          shots.push(await ctx.shot(5, 'topbar-refreshed'))

          // 文档面板：当前 UI 为顶栏单一「文档」按钮 + 面板内 Tab。
          const docs = page.getByTestId('docs-panel')
          await page.getByTestId('topbar-docs').click()
          await expect(docs).toBeVisible({ timeout: 15_000 })
          await expect(docs).toHaveAttribute('data-variant', 'overlay')
          await expect(docs.getByRole('tab', { name: '功能说明' })).toHaveAttribute('aria-selected', 'true')
          shots.push(await ctx.shot(5, 'docs-desc'))

          await docs.getByRole('tab', { name: '最新需求' }).click()
          await expect(docs.getByRole('tab', { name: '最新需求' })).toHaveAttribute('aria-selected', 'true')
          shots.push(await ctx.shot(5, 'docs-latest'))
          await page.keyboard.press('Escape')
          await expect(docs).toBeHidden({ timeout: 5_000 })

          // AI
          const ai = page.getByTestId('ai-dialog')
          await page.getByTestId('topbar').getByRole('button', { name: 'AI 对话' }).click()
          await expect(ai).toBeVisible({ timeout: 15_000 })
          shots.push(await ctx.shot(5, 'ai-panel'))
          await page.keyboard.press('Escape')
          await expect(ai).toBeHidden({ timeout: 5_000 })

          // Git
          const git = page.getByTestId('git-sheet')
          await page.getByTestId('topbar').getByRole('button', { name: 'Git 管理' }).click()
          await expect(git).toBeVisible({ timeout: 15_000 })
          shots.push(await ctx.shot(5, 'git-panel'))
          await page.keyboard.press('Escape')
          await expect(git).toBeHidden({ timeout: 5_000 })

          // 导出菜单
          await page.getByTestId('export-menu').click()
          for (const id of ['export-source', 'export-html', 'export-png', 'export-pdf', 'export-md']) {
            await expect(page.getByTestId(id)).toBeVisible({ timeout: 10_000 })
          }
          shots.push(await ctx.shot(5, 'export-menu'))
          await page.keyboard.press('Escape')
          await expect(page.getByTestId('export-source')).toBeHidden({ timeout: 5_000 })

          // 设置（侧栏底部唯一入口）
          const settings = page.getByTestId('settings-dialog')
          await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
          await expect(settings).toBeVisible({ timeout: 15_000 })
          shots.push(await ctx.shot(5, 'settings-panel'))
          await page.keyboard.press('Escape')
          await expect(settings).toBeHidden({ timeout: 5_000 })

          // 终端：主进程 stub，只验证按钮可点/不崩溃，不实际拉起终端占用 shell。
          await ctx.app.evaluate(({ ipcMain }) => {
            const g = globalThis as unknown as { __w4TerminalCalls?: number }
            g.__w4TerminalCalls = 0
            ipcMain.removeHandler('ai:open-terminal')
            ipcMain.handle('ai:open-terminal', async () => {
              g.__w4TerminalCalls = (g.__w4TerminalCalls || 0) + 1
              return { ok: true, stubbed: true }
            })
          })
          await page.getByTestId('topbar-terminal').click()
          await expect
            .poll(async () => ctx.app.evaluate(() => (globalThis as unknown as { __w4TerminalCalls?: number }).__w4TerminalCalls ?? -1), {
              timeout: 10_000,
            })
            .toBe(1)
          await expect(page.getByTestId('main-window')).toBeVisible()
          shots.push(await ctx.shot(5, 'terminal-stub-click'))

          // Esc 栈（P2 观察，不阻断本域）：打开 文档 → 设置 → AI，逐次 Esc 只关顶层。
          let stackNote = 'Esc 栈=文档+设置+AI 时逐次只关顶层'
          try {
            await page.getByTestId('topbar-docs').evaluate((el) => (el as HTMLElement).click())
            await expect(docs).toBeVisible({ timeout: 10_000 })
            await page
              .getByTestId('sidebar')
              .getByRole('button', { name: '打开设置' })
              .evaluate((el) => (el as HTMLElement).click())
            await expect(settings).toBeVisible({ timeout: 10_000 })
            await page
              .getByTestId('topbar')
              .getByRole('button', { name: 'AI 对话' })
              .evaluate((el) => (el as HTMLElement).click())
            await expect(ai).toBeVisible({ timeout: 10_000 })
            shots.push(await ctx.shot(5, 'esc-stack-before'))

            const layerState = async () => {
              const vis = (loc: Locator) => loc.first().isVisible().catch(() => false)
              return {
                ai: await vis(ai),
                settings: await vis(settings),
                docs: await vis(docs),
                counts: {
                  ai: await ai.count(),
                  settings: await settings.count(),
                  docs: await docs.count(),
                },
              }
            }
            const states = [await layerState()]
            for (let i = 0; i < 3; i += 1) {
              await page.keyboard.press('Escape')
              await page.waitForTimeout(350)
              states.push(await layerState())
              if (i === 0) shots.push(await ctx.shot(5, 'esc-stack-after-1'))
            }
            const oneLayerPerEsc =
              states[1].ai === false &&
              states[1].settings === true &&
              states[1].docs === true &&
              states[2].settings === false &&
              states[2].docs === true &&
              states[3].docs === false
            stackNote = `Esc 栈=${oneLayerPerEsc ? 'PASS（一次只关一层）' : 'P2 观察：未按一次一层'}；层状态=${states
              .map((s) => `${s.ai ? 'AI' : '-'}/${s.settings ? '设置' : '-'}/${s.docs ? '文档' : '-'}`)
              .join(' → ')}；DOM 数=${states
              .map((s) => `${s.counts.ai}/${s.counts.settings}/${s.counts.docs}`)
              .join(' → ')}`
          } catch (err) {
            stackNote = 'Esc 栈观察失败（P2，不阻断）：' + errorText(err)
            for (let i = 0; i < 4; i += 1) await page.keyboard.press('Escape')
            await page.waitForTimeout(300)
          }

          return {
            evidence:
              `刷新后原型=${afterNames.length}（${afterNames.join(' / ')}，无重复）、当前选择保持=${beforePill}；` +
              '功能说明→docs-panel[overlay] 且 Tab 选中；最新需求→docs-panel 且 Tab 选中；均 Esc 关闭；' +
              'AI→ai-dialog、Git→git-sheet、导出→5 项菜单、设置→settings-dialog，均 Esc 关闭；' +
              '终端按钮点击→stub 调用 1 次、主窗仍可见、无崩溃（未真实拉起终端）；' + stackNote,
            shots,
          }
        })
      }

      // ── 6. console / pageerror ───────────────────────────────────────
      if (ok) {
        await runStep(ctx, 6, 'console / pageerror 观察', 'console', async () => {
          const shot = await ctx.shot(6, 'final')
          const consoleErrors = ctx.consoleErrors.slice()
          // seed 原型「大厅.html」自带 Vant/Vue CDN 与内联脚本；其 CSP/语法噪声属用户内容，不计工具 pageerror。
          const pageErrors = ctx.pageErrors.filter((e) => !/cdn\.jsdelivr\.net|unpkg\.com|vant|unexpected token '\.'/i.test(e))
          const crashes = ctx.crashes.slice()
          console.log('[shell] CONSOLE_ERRORS_TOTAL=' + consoleErrors.length)
          if (consoleErrors.length) console.log('[shell] CONSOLE_ERRORS\n' + consoleErrors.join('\n'))
          console.log('[shell] PAGE_ERRORS_TOTAL=' + pageErrors.length)
          if (pageErrors.length) console.log('[shell] PAGE_ERRORS\n' + pageErrors.join('\n'))
          console.log('[shell] CRASHES_TOTAL=' + crashes.length)
          expect(pageErrors, `pageerror 应为 0：\n${pageErrors.join('\n')}`).toStrictEqual([])
          expect(crashes, `页面 crash 应为 0：\n${crashes.join('\n')}`).toStrictEqual([])
          return {
            evidence:
              `console error=${consoleErrors.length}（过滤 favicon/devtools/ResizeObserver 后致命=${ctx.fatalErrors().length}）；` +
              `pageerror=${pageErrors.length}；crash=${crashes.length}`,
            shots: [shot],
          }
        })
      }

      // ── 结算 ─────────────────────────────────────────────────────────
      testInfo.annotations.push({
        type: 'wave4-shell-summary',
        description: rows.map((r) => `${r.no}.${r.status} ${r.title}`).join(' | '),
      })
      console.log('[shell] SUMMARY\n' + JSON.stringify(rows, null, 2))
      const failed = rows.filter((r) => r.status === 'FAIL')
      expect(failed, `主壳域失败：\n${failed.map((r) => `${r.no}. ${r.title}: ${r.evidence}`).join('\n')}`).toStrictEqual([])
    } finally {
      // 该域会创建/拖拽项目与文件夹；在部分机器上 renderer 发起的 window.close()
      // 不触发 window-all-closed，显式从主进程关闭全部窗口，保证进程可正常退出。
      await ctx.app
        .evaluate(({ BrowserWindow }) => {
          const wins = BrowserWindow.getAllWindows()
          console.log(`[shell] windows=${wins.length}`)
          wins.forEach((w) => w.close())
        })
        .catch(() => undefined)
      closeResult = await ctx.close({ graceMs: 5_000 })
      console.log(
        `[shell] CLOSE method=${closeResult.method} exit=${closeResult.exitCode} elapsed=${closeResult.elapsedMs}ms exited=${closeResult.exited}`,
      )
      if (!closeResult.ok) {
        // 已知 P2（非 shell 功能失败）：创建/拖拽项目后主进程 window-all-closed 未触发退出，
        // 需 harness kill 收尾；不阻断主壳域验收，单独记入报告。
        console.warn(
          `[shell] P2 close: window-all-closed 未退出（method=${closeResult.method} exit=${closeResult.exitCode}），已 kill 收尾`,
        )
      }
    }
    if (!closeResult.ok) {
      test.info().annotations.push({
        type: 'wave4-shell-p2',
        description: `Electron 未通过 window-all-closed 退出（${closeResult.method}/${closeResult.exitCode}），已 kill；主壳功能断言全 PASS`,
      })
    }
  })
})
