/**
 * e2e/ai.spec.ts — Wave2-M AI 回归（J 波：居中 Dialog + 模型/思考级联）。
 *
 * testid 锚点：ai-dialog / ai-model-select / ai-thinking-select /
 * ai-chat / ai-dialog-error。
 * 方案 §8.2：居中大型 Dialog，只用 Dialog 不用 Sheet/Resizable；
 * thinking 选项来自 ACP 动态下发，绝不写死（ACP 三Agent计划 §思考强度：
 * 候选 key thought_level → reasoning_effort → effort → thinking，
 * 仅公告 key 可用、值须在 options 内）。
 *
 * 静态契约（无浏览器可跑）。真机步骤见下方 gui 块。
 *
 * 真机步骤（手动，不自动执行）：
 * 1. 打开 AI 对话：居中 Dialog，打开后舞台宽度不变（非 Sheet）；
 * 2. 底部唯一一个「模型 + 思考强度」两级级联可见（顶部重复选择器已删除）；
 * 3. 思考下拉选项与 ACP 公告的 configOptions（thought_level 系）逐项一致，
 *    非公告档位不出现（写死即红）；acp_catalog 等内部事件只进 Trace，不进正文；
 * 4. 切换模型后思考回落默认；发送/停止/权限卡/Trace 正常。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip;

/** 去注释后断言：注释里的“不用 X”不算引入 X。 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

test.describe('ai 静态契约（J 波 AI 对话）', () => {
  test('ai-dialog 为居中 Dialog，不用 Sheet/Resizable', () => {
    const src = codeOnly(readFile('src/renderer/features/ai/AiDialog.tsx'));
    expect(src).toContain('data-testid="ai-dialog"');
    expect(src).toContain('DialogContent');
    expect(src).not.toContain('Sheet');
    expect(src).not.toContain('Resizable');
  });

  test('模型/思考两级级联存在（底部单实例 ModelSelector）', () => {
    const dlg = readFile('src/renderer/features/ai/AiDialog.tsx');
    const sel = readFile('src/renderer/components/ai-elements/ModelSelector.tsx');
    expect(sel).toContain('data-testid="ai-model-select"');
    expect(sel).toContain('data-testid="ai-thinking-select"');
    // 本轮 UI 定稿：AI 对话框只保留底部 1 个模型/思考级联，顶部重复选择器已删除。
    expect(dlg.match(/<ModelSelector/g)?.length).toBe(1);
    expect(dlg).not.toContain('{cascade}');
  });

  test('thinking 非写死：选项只来自 ACP 输入', () => {
    const src = readFile('src/renderer/features/ai/adapters.ts');
    expect(src).toContain('thoughtOptionsFromAcp');
    expect(src).toContain('flattenThoughtOptionRecords');
    expect(src).toContain('if (!Array.isArray(raw)) return;');
    expect(src).not.toContain("['low'");
    expect(src).not.toContain("['off'");
  });

  test('ACP 源公告 thought_level 系 key（动态源存在）', () => {
    const src = readFile('main/acp/acp-runtime.js');
    expect(src).toContain('thought_level');
    expect(src).toContain('configOptions');
  });

  test('模型切换重置 thinking（旧语义沿用）', () => {
    expect(readFile('src/renderer/features/ai/adapters.ts')).toContain(
      'resetThinkingOnModelChange',
    );
  });

  test('消息流容器与归属校验就绪', () => {
    expect(readFile('src/renderer/components/ai-elements/Chat.tsx')).toContain(
      'data-testid="ai-chat"',
    );
    expect(readFile('src/renderer/features/ai/adapters.ts')).toContain(
      'aiEventMatchesSession',
    );
  });
});

test.describe('ai 上下文与持久化静态契约（W3-07）', () => {
  test('发送上下文取自 sources-store，不写死 sandboxDir/targetFile/uiKind/activePage', () => {
    const src = codeOnly(readFile('src/renderer/stores/ai-store.ts'));
    expect(src).toContain('useSourcesStore.getState()');
    expect(src).toContain('resolveSendContext');
    expect(src).toContain("sandboxDir: src?.sandboxDir || ''");
    expect(src).not.toContain("sandboxDir: ''");
    expect(src).not.toContain("uiKind: 'mobile'");
  });

  test('engine 来自 settings-store，acpConfig/reasoning 同源', () => {
    const src = codeOnly(readFile('src/renderer/stores/ai-store.ts'));
    expect(src).toContain('useSettingsStore.getState()');
    expect(src).toContain('engine: settings.engine');
    expect(src).toContain('const reasoning = cur.thinkingLevel');
    expect(src).toContain('acpConfig[cur.thoughtConfigId] = reasoning');
  });

  test('模型清单从 settings-store modelGroups/visibleModels 派生，无单元素伪清单', () => {
    const dlg = codeOnly(readFile('src/renderer/features/ai/AiDialog.tsx'));
    expect(dlg).toContain('useSettingsStore');
    expect(dlg).toContain('modelGroups');
    expect(dlg).toContain('visibleModels');
    expect(dlg).toContain('deriveModelOptions');
    expect(dlg).not.toContain('[{ value: modelId');
    expect(dlg).toContain('React.useMemo');
  });

  test('会话/模型/思考持久化键接线（ai_sessions_v2_/ai_hist_/ai_model/ai_model_reasoning）', () => {
    const src = codeOnly(readFile('src/renderer/stores/ai-store.ts'));
    expect(src).toContain('aiHistKey');
    expect(src).toContain('sessStoreKey');
    expect(src).toContain('AI_MODEL_KEY');
    expect(src).toContain('AI_REASONING_KEY');
    expect(src).toContain('parseSessionsFile');
    expect(src).toContain('serializeSessions');
    expect(src).toContain('loadHistory');
  });

  test('打开对话框先只读补拉 settings-store', () => {
    const dlg = codeOnly(readFile('src/renderer/features/ai/AiDialog.tsx'));
    expect(dlg).toContain('settings.load()');
    expect(dlg).toContain('!settings.config');
  });

  test('thinking 仍只来自 ACP 动态公告', () => {
    const dlg = codeOnly(readFile('src/renderer/features/ai/AiDialog.tsx'));
    expect(dlg).toContain('thinkingOptions');
    expect(dlg).not.toContain('aiStandardReasoningOptions');
  });
});

gui('ai 真机行为（需 PLAND_E2E_APP_URL）', () => {
  test('AI 为居中 Dialog 且级联可见', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    const dlg = page.getByTestId('ai-dialog');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('ai-model-select')).toBeVisible();
    await expect(page.getByTestId('ai-thinking-select')).toBeVisible();
  });
});
