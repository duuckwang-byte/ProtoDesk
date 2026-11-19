import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Chat } from '@/components/ai-elements/Chat';
import { Message } from '@/components/ai-elements/Message';
import { ModelSelector } from '@/components/ai-elements/ModelSelector';
import { PromptInput } from '@/components/ai-elements/PromptInput';
import { TraceView } from '@/components/ai-elements/TraceView';
import {
  buildQuestionnaireAnswerText,
  type QuestionnaireForm,
} from '@/components/ai-elements/Questionnaire';
import { PermissionCard } from './PermissionCard';
import { deriveModelOptions, internalEventTrace, normalizePermissionEvent } from './adapters';
import type { AiEventLike, TraceLine } from './adapters';
import { useAiStore, getAiStore, bindAiEvents } from '@/stores/ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSourcesStore } from '@/stores/sources-store';

type DialogTab = 'chat' | 'trace';

/**
 * AiDialog：AI 对话主容器（J 独占）。
 *
 * - 居中大型 Dialog 承载（§8.2 AI Elements 模式），打开不挤压原型；
 *   硬约束：只用 Dialog，不用 Sheet/Resizable。
 * - 顶部「需求对话 | 执行日志 (Trace)」分段切换，执行日志为独立深色终端面板。
 * - 顶栏状态胶囊（沙箱 / CLI 就绪 / 当前 Agent）只读 sources-store、settings-store；
 *   「历史快照」仅在快照面板有全局打开 API 前占位禁用（见按钮 title）。
 * - 输入区工具条承载「作用页 / 停止 / 重试」；作用页选择随发送传给 ai-store（未选回退自动解析）。
 * - 单一对话区（全宽）：不提供新建会话/会话列表/会话切换；打开时确保存在 active session，
 *   历史持久化仍由 ai-store 按沙箱目录恢复最近会话，UI 只展示该会话。
 * - 底部常驻唯一一个模型 + 思考强度两级级联（ModelSelector）：模型清单来自
 *   settings-store 的 modelGroups/visibleModels（W3-07），thinking 选项来自
 *   ACP 动态下发的 thinkingOptions，绝不写死。
 * - 打开时若 settings-store 尚未 load，先只读补拉一次（不写配置）。
 * - 数据源只走 ai:event（经 stores/ai-store + bindAiEvents 订阅）；
 *   控制事件（acp_catalog/run_started/done 等）只进执行日志，不渲染成聊天文本。
 * - data-testid="ai-dialog"（E2E 锚点）。
 */
export function AiDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const store = getAiStore();
  const activeSessionId = useAiStore((s) => s.activeSessionId);
  const sessions = useAiStore((s) => s.sessions);
  // 稳定 selector：只取 store 内的稳定引用（messages 映射整体），派生数组在组件内 useMemo。
  // zustand v5 用 useSyncExternalStore，selector 返回新数组会触发 getSnapshot 未缓存告警并无限重渲染。
  const messagesBySession = useAiStore((s) => s.messages);
  const messages = React.useMemo(
    () => (activeSessionId ? (messagesBySession[activeSessionId] ?? []) : []),
    [activeSessionId, messagesBySession],
  );
  const activeSession = React.useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const busy = useAiStore((s) => s.busy);
  const error = useAiStore((s) => s.error);
  const modelId = useAiStore((s) => s.modelId);
  const thinkingLevel = useAiStore((s) => s.thinkingLevel);
  const thinkingOptions = useAiStore((s) => s.thinkingOptions);
  const thinkingStatus = useAiStore((s) => s.thinkingStatus);
  const thinkingError = useAiStore((s) => s.thinkingError);
  const trace = useAiStore((s) => s.trace);
  const acpWarnings = useAiStore((s) => s.acpWarnings);
  const [tab, setTab] = React.useState<DialogTab>('chat');
  // 作用页：只保存在本地状态（契约缺口见下方注释），不写 ai-store。
  const [activePage, setActivePage] = React.useState('');

  // 设置数据源：只读 settings-store 的稳定引用，派生列表一律 useMemo（防 zustand v5 快照循环）。
  const modelGroups = useSettingsStore((s) => s.modelGroups);
  const visibleModels = useSettingsStore((s) => s.visibleModels);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const agents = useSettingsStore((s) => s.agents);
  const settingsConfig = useSettingsStore((s) => s.config);
  const engine = useSettingsStore((s) => s.engine);
  const settingsLoading = useSettingsStore((s) => s.loading);

  // 沙箱 / 作用页数据源：当前源（sources-store 只读）。
  const currentSource = useSourcesStore((s) => s.currentSource);
  const project = useSourcesStore((s) => s.project);
  const pageOptions = React.useMemo(
    () => (currentSource?.pages ?? []).filter((p) => !!p),
    [currentSource],
  );

  React.useEffect(() => {
    if (!open) return;
    // 单一对话区：打开时保证存在 active session。
    // 历史恢复后若 activeId 丢失，优先复用最近会话（sessions[0]）；空库才新建。
    // 不新增/修改 ai-store：只调用现有 switchSession / ensureActiveSession。
    const aiStore = getAiStore();
    const aiState = aiStore.getState();
    if (!aiState.activeSessionId) {
      if (aiState.sessions.length > 0) aiStore.switchSession(aiState.sessions[0].id);
      else aiStore.ensureActiveSession();
    }
    const settings = useSettingsStore.getState();
    if (!settings.config && !settings.loading) {
      // 只读补拉：engine/模型/可见白名单都以 settings-store 为唯一真相源。
      void settings.load();
    }
    const off = bindAiEvents();
    return off;
  }, [open]);

  // 控制事件不进聊天流：把新增的 acp_catalog/run_started/done 等压缩成 trace 行，
  // 原始事件仍保留在 store.events；只在打开期间订阅，避免重复记录历史事件。
  React.useEffect(() => {
    if (!open) return;
    const aiStore = getAiStore();
    let seen = aiStore.getState().events.length;
    const off = aiStore.subscribe(() => {
      const state = aiStore.getState();
      // 切会话/恢复历史会清空 events：游标同步归零，避免越界。
      if (state.events.length < seen) seen = 0;
      if (state.events.length === seen) return;
      const lines: TraceLine[] = [];
      for (let i = seen; i < state.events.length; i += 1) {
        const line = internalEventTrace(state.events[i] as AiEventLike);
        if (line) lines.push(line);
      }
      seen = state.events.length;
      for (const line of lines) aiStore.dispatch({ type: 'push-trace', line });
    });
    return off;
  }, [open]);

  // 模型清单：modelGroups 经 visibleModels 过滤（null=全选，[]=全不选）。
  const models = React.useMemo(
    () => deriveModelOptions(modelGroups, visibleModels),
    [modelGroups, visibleModels],
  );

  // 持久化模型不在当前目录/白名单内时，按旧 aiRenderModelOptions 口径回落（default → 首个）。
  React.useEffect(() => {
    if (!open || models.length === 0) return;
    if (models.some((m) => m.value === modelId)) return;
    const next =
      defaultModel && models.some((m) => m.value === defaultModel)
        ? defaultModel
        : models[0].value;
    store.setModel(next);
  }, [open, models, modelId, defaultModel, store]);

  // 顶栏状态胶囊：全部从只读 store 派生，不发起 IPC、不写配置。
  const sandboxLabel = project || currentSource?.displayName || '未进入项目';
  const sandboxDir = currentSource?.sandboxDir || '';
  const availableAgentCount = React.useMemo(
    () => (Array.isArray(agents) ? agents.filter((a) => a.available).length : 0),
    [agents],
  );
  const cliReady = availableAgentCount > 0;
  const cliText =
    settingsLoading && agents.length === 0
      ? 'CLI 检测中'
      : cliReady
        ? 'CLI 就绪'
        : 'CLI 未就绪';
  const agentLabel = React.useMemo(() => {
    const list = Array.isArray(agents) ? agents : [];
    const enabled = list.find((a) => a.enabled);
    if (enabled) return enabled.name || enabled.id;
    const configuredId = String(settingsConfig?.agentId || settingsConfig?.mainAgent || '');
    const configured = configuredId ? list.find((a) => a.id === configuredId) : null;
    if (configured) return configured.name || configured.id;
    return activeSession?.agentName || activeSession?.agentId || configuredId || '未绑定';
  }, [agents, settingsConfig, activeSession]);

  // 思考探测作用域：设置里的主力 Agent 优先（实际 ai:ask 也走它）；设置未加载时退回会话 Agent。
  const probeAgentId = React.useMemo(() => {
    const list = Array.isArray(agents) ? agents : [];
    const enabled = list.find((a) => a.enabled);
    if (enabled && enabled.id) return enabled.id;
    return String(settingsConfig?.agentId || settingsConfig?.mainAgent || '');
  }, [agents, settingsConfig]);

  // 打开对话 / 选模型 / 切 Agent / 切会话都预探测一次思考档位（不发送 prompt）。
  // setModel 内部也会探测，这里按 agent|session|model 缓存去重，不会重复请求。
  React.useEffect(() => {
    if (!open) return;
    const id = modelId.trim();
    if (!id) return;
    const aiStore = getAiStore();
    // 确定性失败（ACP_DISABLED / 超时等）允许下次打开/切换时重试；不支持思考仍走缓存，避免反复慢探测。
    void aiStore.probeThinking(id, { force: aiStore.getState().thinkingStatus === 'error' });
  }, [open, modelId, activeSessionId, probeAgentId]);

  // 作用页：本地选择值随发送传入 ai-store（sendMessage(text, { activePage })），
  // 非空时覆盖 extra.activePage；未选则回退 store 的自动解析（跟随当前页），不写死。
  // 源切换后旧选择可能已不存在：回落到「自动（跟随当前页）」。
  const selectedActivePage = pageOptions.includes(activePage) ? activePage : '';

  // B-AI-P2-5：模型目录为空（或尚未选中模型）时发送前置拦截。
  // 只读派生，不写 settings-store；点击发送不再产生一次必然失败的 ai:ask。
  const noModel = models.length === 0;
  const modelLoading = noModel && settingsLoading && !settingsConfig;
  const hasSelectedModel = models.some((m) => m.value === modelId);
  const sendBlockedReason = noModel
    ? modelLoading
      ? '模型清单加载中…'
      : '暂无可用模型：请先在 设置 › 模型 中启用至少一个模型'
    : !hasSelectedModel
      ? '未选择模型：请先在 设置 › 模型 中选择一个模型'
      : '';

  // B-AI-P2-4：问题卡提交 → 复用既有 sendMessage 通道回传答案（不新增 IPC/store action）。
  const submitQuestionnaire = React.useCallback(
    (answers: Record<string, string>, forms: QuestionnaireForm[]): boolean => {
      if (busy || sendBlockedReason) return false;
      const text = buildQuestionnaireAnswerText(forms, answers);
      if (!text) return false;
      if (selectedActivePage) {
        void store.sendMessage(text, { activePage: selectedActivePage });
        return true;
      }
      void store.sendMessage(text);
      return true;
    },
    [busy, selectedActivePage, sendBlockedReason, store],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="ai-dialog"
        className="flex h-[80vh] max-w-[1060px] flex-col p-0"
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v === 'trace' ? 'trace' : 'chat')}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <DialogHeader className="flex-row flex-wrap items-center gap-2 border-b border-border bg-chrome px-3 py-2 pr-12">
            <TabsList aria-label="AI 对话视图">
              <TabsTrigger data-testid="ai-tab-chat" value="chat">
                需求对话
              </TabsTrigger>
              <TabsTrigger data-testid="ai-tab-trace" value="trace">
                执行日志 (Trace)
              </TabsTrigger>
            </TabsList>

            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <Button
                data-testid="ai-snapshot-history"
                size="sm"
                variant="outline"
                disabled
                title="历史快照面板目前只能从预览工具栏打开；AI 对话框暂无打开快照面板的 store API，按钮占位"
                aria-describedby="ai-snapshot-history-note"
              >
                历史快照
              </Button>
              <span id="ai-snapshot-history-note" className="sr-only">
                历史快照按钮为占位禁用：暂无全局打开快照面板的 store API。
              </span>
              <Badge
                data-testid="ai-status-sandbox"
                variant="secondary"
                className="max-w-[14rem] min-w-0 font-mono"
                title={sandboxDir || sandboxLabel}
              >
                <span className="truncate">沙箱: {sandboxLabel}</span>
              </Badge>
              <Badge
                data-testid="ai-status-cli"
                variant="outline"
                className={
                  cliReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : undefined
                }
                title={`引擎：${engine === 'api' ? 'API 直连' : '本地 CLI'} · 可用 Agent ${availableAgentCount}/${agents.length}`}
              >
                {cliReady || cliText === 'CLI 检测中' ? '●' : '○'} {cliText}
              </Badge>
              <Badge
                data-testid="ai-status-agent"
                variant="cobalt"
                className="max-w-[12rem] min-w-0"
                title={`当前 Agent：${agentLabel}`}
              >
                <span className="truncate">Agent: {agentLabel}</span>
              </Badge>
            </div>

            <DialogTitle className="sr-only">AI 对话</DialogTitle>
            <DialogDescription data-testid="ai-dialog-session" className="sr-only">
              {`Agent：${agentLabel}`}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div data-testid="ai-dialog-error" className="border-b border-border px-4 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
          {acpWarnings.length > 0 ? (
            <div data-testid="ai-dialog-warnings" className="border-b border-border px-4 py-1.5 text-[11.5px] text-muted-foreground">
              {acpWarnings.join(' · ')}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
              <div className={tab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <Chat
                  messages={messages}
                  renderMessage={(m) => {
                    if (m.kind === 'permission') {
                      const p = normalizePermissionEvent((m.payload || {}) as never);
                      if (!p) return <Message message={m} onQuestionnaireSubmit={submitQuestionnaire} />;
                      return <PermissionCard payload={p} pending={String((m.payload as Record<string, unknown>).status || 'pending') === 'pending'} />;
                    }
                    return <Message message={m} onQuestionnaireSubmit={submitQuestionnaire} />;
                  }}
                />
                <div className="border-t border-border p-3">
                  <div className="rounded-xl border border-border bg-background p-1.5 shadow-sm transition-colors focus-within:border-zinc-300">
                    {/* 停止/重试统一由下方工具条承载：busy 传 false 避免 PromptInput 再渲染一个停止按钮；
                        发送禁用由 disabled=busy + sendBlockedReason（无模型）保证，onStop 仍保留原 handler 不漂移组件契约。 */}
                    <PromptInput
                      busy={false}
                      disabled={busy}
                      sendBlockedReason={sendBlockedReason}
                      onSend={(t) => {
                        // 双保险：即使外部绕过按钮直接触发 onSend，也不在无模型时发请求。
                        if (sendBlockedReason) return;
                        if (selectedActivePage) {
                          void store.sendMessage(t, { activePage: selectedActivePage });
                          return;
                        }
                        void store.sendMessage(t);
                      }}
                      onStop={() => store.cancel()}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-0.5">
                      <label
                        className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground"
                        title="作用页：选中后随本条消息发送；自动则跟随当前页解析"
                      >
                        <span className="shrink-0">作用页</span>
                        <select
                          data-testid="ai-active-page"
                          data-active-page={selectedActivePage}
                          value={selectedActivePage}
                          disabled={busy || pageOptions.length === 0}
                          onChange={(e) => setActivePage(e.target.value)}
                          className="h-7 max-w-[14rem] rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none disabled:opacity-50"
                        >
                          <option value="">自动（跟随当前页）</option>
                          {pageOptions.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="h-4 w-px bg-border" aria-hidden="true" />
                      <Button
                        data-testid="ai-stop-btn"
                        size="sm"
                        variant="outline"
                        disabled={!busy}
                        onClick={() => {
                          void store.cancel();
                        }}
                      >
                        停止
                      </Button>
                      <Button
                        data-testid="ai-retry-btn"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void store.retry();
                        }}
                      >
                        重试
                      </Button>
                      <div className="ml-auto min-w-0">
                        <ModelSelector
                          models={models}
                          thinkingOptions={thinkingOptions}
                          thinkingStatus={thinkingStatus}
                          thinkingError={thinkingError}
                          modelId={modelId}
                          thinkingLevel={thinkingLevel}
                          disabled={busy}
                          onModelChange={(v) => store.setModel(v)}
                          onThinkingChange={(v) => store.setThinking(v)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={tab === 'trace' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <TraceView
                  lines={trace}
                  onClear={() => store.dispatch({ type: 'clear-trace' })}
                />
              </div>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default AiDialog;
