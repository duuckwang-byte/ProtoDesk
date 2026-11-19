/**
 * AI 对话框骨架回归（本包独占：AiDialog / SessionList / TraceView）。
 *
 * 只做结构契约与渲染冒烟，不触 adapters / ai-store / Chat：
 * - Dialog 宽度 1060px、高度 80vh，仍是居中 Dialog；
 * - 单一对话区全宽：无会话列表 / 新建会话 / 会话切换入口；
 * - 打开时确保存在 active session（历史优先复用，空库才新建）；
 * - 顶部「需求对话 | 执行日志 (Trace)」分段切换；
 * - 状态胶囊来自 sources-store / settings-store，历史快照按钮占位禁用；
 * - 作用页选择器为本地状态，发送时随消息传给 ai-store；
 * - 停止/重试在输入区工具条；
 * - 输入框焦点为 1px 低对比边框 + 柔和 focus ring；
 * - TraceView 为独立深色终端面板。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { TraceView } from '@/components/ai-elements/TraceView';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(root, rel), 'utf8');
}

/** 与 e2e/ai.spec.ts 同口径：注释里的“不再用 X”不算引入 X。 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const dialogSrc = read('src/renderer/features/ai/AiDialog.tsx');
const dialogCode = codeOnly(dialogSrc);
const sessionSrc = codeOnly(read('src/renderer/features/ai/SessionList.tsx'));
const traceSrc = codeOnly(read('src/renderer/components/ai-elements/TraceView.tsx'));

afterEach(() => {
  cleanup();
});

describe('AiDialog 布局骨架', () => {
  it('宽度 1060px、高度 80vh，仍由 DialogContent 承载', () => {
    expect(dialogSrc).toContain('data-testid="ai-dialog"');
    expect(dialogSrc).toContain('max-w-[1060px]');
    expect(dialogSrc).toContain('h-[80vh]');
    expect(dialogSrc).not.toContain('max-w-3xl');
  });

  it('顶部有需求对话 / 执行日志分段切换', () => {
    expect(dialogSrc).toContain('需求对话');
    expect(dialogSrc).toContain('执行日志 (Trace)');
    expect(dialogSrc).toContain('data-testid="ai-tab-chat"');
    expect(dialogSrc).toContain('data-testid="ai-tab-trace"');
    expect(dialogSrc).toContain('<TabsList');
  });

  it('状态胶囊只读 sources-store / settings-store', () => {
    expect(dialogSrc).toContain('useSourcesStore');
    expect(dialogSrc).toContain('useSettingsStore');
    expect(dialogSrc).toContain('data-testid="ai-status-sandbox"');
    expect(dialogSrc).toContain('data-testid="ai-status-cli"');
    expect(dialogSrc).toContain('data-testid="ai-status-agent"');
    expect(dialogSrc).toContain('CLI 就绪');
    // 不新增 IPC、不写配置：状态只从已加载 store 派生。
    expect(dialogSrc).not.toContain('ai.checkCli');
  });

  it('历史快照按钮在无全局快照面板 API 时占位禁用并注明', () => {
    expect(dialogSrc).toContain('data-testid="ai-snapshot-history"');
    expect(dialogSrc).toContain('历史快照');
    expect(dialogSrc).toContain('ai-snapshot-history-note');
    expect(dialogSrc).toContain('暂无打开快照面板的 store API');
    expect(dialogSrc).toMatch(/data-testid="ai-snapshot-history"[\s\S]*?disabled/);
  });

  it('模型选择器仍只有一个（底部输入区）', () => {
    expect((dialogSrc.match(/<ModelSelector\b/g) || []).length).toBe(1);
  });

  it('单一对话区全宽：不渲染会话列表 / 新建 / 切换', () => {
    expect(dialogCode).not.toContain('SessionList');
    expect(dialogCode).not.toContain('ai-session-list');
    expect(dialogCode).not.toContain('ai-session-new');
    expect(dialogCode).not.toContain('新建会话');
    expect(dialogCode).not.toContain('store.newSession');
    // 会话栏组件保留为空实现：即便被误引用也不产生 UI。
    expect(sessionSrc).not.toContain('ai-session-list');
    expect(sessionSrc).not.toContain('ai-session-new');
    expect(sessionSrc).toContain('return null');
  });

  it('打开时确保存在 active session，历史优先复用最近会话', () => {
    expect(dialogCode).toContain('if (!aiState.activeSessionId)');
    expect(dialogCode).toContain('aiStore.switchSession');
    expect(dialogCode).toContain('aiStore.ensureActiveSession()');
    // 只调用 ai-store 现有方法，不新建 store 实例。
    expect(dialogCode).not.toContain('createAiStore');
  });

  it('不再显示“会话:xxx”副标题，仅保留 Agent 名', () => {
    expect(dialogCode).toContain('Agent：${agentLabel}');
    expect(dialogCode).not.toContain('会话：${');
  });
});

describe('作用页选择器', () => {
  it('选项来自当前源 pages，值只存本地状态', () => {
    expect(dialogSrc).toContain('data-testid="ai-active-page"');
    expect(dialogSrc).toContain('作用页');
    expect(dialogSrc).toContain('currentSource?.pages');
    expect(dialogSrc).toContain('const [activePage, setActivePage] = React.useState');
    expect(dialogSrc).toContain('data-active-page={selectedActivePage}');
  });

  it('标注 activePage 契约缺口，且不改 ai-store 发送调用签名', () => {
    expect(dialogSrc).toContain('extra.activePage');
    expect(dialogSrc).toContain('sendMessage(text, { activePage })');
    // 仍按既有单参接口发送，避免本包越界修改 ai-store。
    expect(dialogSrc).toContain('store.sendMessage(t)');
  });
});

describe('停止 / 重试位置', () => {
  it('会话列表与新建入口已移除（组件保留空实现）', () => {
    expect(sessionSrc).not.toContain('ai-session-new');
    expect(sessionSrc).not.toContain('store.newSession');
    expect(sessionSrc).not.toContain('store.switchSession');
    expect(sessionSrc).not.toContain('停止');
    expect(sessionSrc).not.toContain('重试');
    expect(sessionSrc).not.toContain('store.cancel');
    expect(sessionSrc).not.toContain('store.retry');
  });

  it('停止/重试在输入区工具条，沿用原 handler', () => {
    expect(dialogCode).toContain('data-testid="ai-stop-btn"');
    expect(dialogCode).toContain('data-testid="ai-retry-btn"');
    expect(dialogCode).toContain('store.cancel()');
    expect(dialogCode).toContain('store.retry()');
  });
});

describe('输入区焦点样式', () => {
  const promptCode = codeOnly(read('src/renderer/components/ai-elements/PromptInput.tsx'));

  it('textarea 改为 1px 低对比边框 + 柔和 focus ring', () => {
    expect(promptCode).toContain('focus:border-zinc-300');
    expect(promptCode).toContain('focus:ring-2');
    expect(promptCode).toContain('focus:ring-ring/10');
    expect(promptCode).not.toContain('focus:border-ring');
  });

  it('外层输入容器不再用近黑 focus-within 描边', () => {
    expect(dialogCode).not.toContain('focus-within:border-ring');
    expect(dialogCode).toContain('focus-within:border-zinc-300');
  });
});

describe('B-AI P2 修复契约', () => {
  const messageSrc = codeOnly(read('src/renderer/components/ai-elements/Message.tsx'));
  const selectorSrc = codeOnly(read('src/renderer/components/ai-elements/ModelSelector.tsx'));
  const promptSrc = codeOnly(read('src/renderer/components/ai-elements/PromptInput.tsx'));

  it('AI 文本走 Markdown 渲染（先转义再生成标签）', () => {
    expect(messageSrc).toContain('renderMarkdownToHtml');
    expect(messageSrc).toContain('dangerouslySetInnerHTML');
    expect(read('src/renderer/features/ai/markdown.ts')).toContain('escapeHtml');
  });

  it('无模型时发送前置禁用并提示原因', () => {
    expect(dialogSrc).toContain('sendBlockedReason');
    expect(dialogSrc).toContain('暂无可用模型');
    expect(promptSrc).toContain('sendBlockedReason');
    expect(promptSrc).toContain('data-testid="ai-send-hint"');
  });

  it('问题卡提交复用既有 sendMessage 回调', () => {
    expect(dialogSrc).toContain('buildQuestionnaireAnswerText');
    expect(dialogSrc).toContain('onQuestionnaireSubmit');
    expect(dialogSrc).toContain('store.sendMessage(text');
  });

  it('模型浮层 portal 到 body 并做碰撞定位', () => {
    expect(selectorSrc).toContain('createPortal');
    expect(selectorSrc).toContain('document.body');
    expect(selectorSrc).toContain('computeCascadePosition');
    expect(selectorSrc).toContain('data-placement');
  });
});

describe('TraceView 独立深色终端面板', () => {
  it('不再使用浅色 Card，改为深色终端容器', () => {
    expect(traceSrc).toContain('data-testid="ai-trace-view"');
    expect(traceSrc).toContain('bg-[#09090b]');
    expect(traceSrc).toContain('font-mono');
    expect(traceSrc).not.toContain('<Card');
  });

  it('渲染日志行与终端工具条', () => {
    render(
      React.createElement(TraceView, {
        lines: [{ time: '14:22:08', tag: 'ACP', level: 'info', text: 'session/start' }],
        onClear: () => {},
      }),
    );
    const panel = screen.getByTestId('ai-trace-view');
    expect(panel.className).toContain('bg-[#09090b]');
    expect(screen.getByText('session/start')).toBeTruthy();
    expect(screen.getByTestId('ai-trace-copy')).toBeTruthy();
    expect(screen.getByTestId('ai-trace-clear')).toBeTruthy();
  });

  it('空日志仍保留深色面板与空态文案', () => {
    render(React.createElement(TraceView, { lines: [] }));
    expect(screen.getByTestId('ai-trace-view')).toBeTruthy();
    expect(screen.getByText('暂无执行日志')).toBeTruthy();
    expect(screen.queryByTestId('ai-trace-clear')).toBeNull();
  });
});
