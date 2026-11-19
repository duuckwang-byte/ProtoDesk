import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ipcErrorText } from '@/lib/ipc';
import type { AcpPermissionMode, SettingsAgent, SettingsEngine, SettingsSaveResult } from '@/stores/settings-store';

/**
 * features/settings/AgentMatrix.tsx — Agent 矩阵 + 引擎切换 + ACP / API 直连配置。
 *
 * W3-06：Agent 行全部来自 ai.checkCli 的真实返回，不保留 DEFAULT_AGENTS 假数据。
 * P0-3：新增「本地 CLI / API 直连」切换；API Profile（协议 / Base URL / API Key）
 *       经 settings-store.save → ai.saveConfig（byok 段）落盘，测试走 ai.testConnection。
 * API Key 永不明文回显：掩码来自 ai.getConfig 的 apiKeyMasked，输入留空 = 不修改已保存凭据。
 */

export type AgentRow = SettingsAgent;

export interface ApiProfileValue {
  protocol: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  provider?: string;
}

export interface ApiProfileDraft {
  protocol: string;
  baseUrl: string;
  /** 空串 = 不修改已保存凭据（主进程 ai:save-config 对空 Key 不覆盖）。 */
  apiKey: string;
  provider?: string;
}

export interface ApiTestResult {
  ok: boolean;
  latency?: number;
  status?: number;
  error?: string;
}

export interface AgentMatrixProps {
  agents?: AgentRow[];
  acpEnabled?: boolean;
  permissionMode?: AcpPermissionMode;
  loading?: boolean;
  engine?: SettingsEngine;
  apiProfile?: ApiProfileValue;
  onSelectAgent?: (id: string) => void;
  onAcpChange?: (enabled: boolean) => void;
  onPermissionChange?: (mode: AcpPermissionMode) => void;
  onEngineChange?: (engine: SettingsEngine) => Promise<SettingsSaveResult> | void;
  onSaveApiProfile?: (draft: ApiProfileDraft) => Promise<SettingsSaveResult> | void;
  onTestConnection?: (draft: ApiProfileDraft) => Promise<ApiTestResult> | ApiTestResult;
  /** 草稿上报：底部「保存并应用」可连同未显式保存的 API 字段一起写回。 */
  onApiDraftChange?: (draft: ApiProfileDraft) => void;
  onRedetect?: () => void | Promise<void>;
}

const API_PROTOCOLS: Array<{ value: string; label: string }> = [
  { value: 'openai', label: 'OpenAI 协议（兼容 DeepSeek / 中转）' },
  { value: 'anthropic', label: 'Anthropic Claude 协议' },
  { value: 'google', label: 'Google Gemini 协议' },
  { value: 'ollama', label: 'Ollama 本地协议' },
  { value: 'azure', label: 'Azure OpenAI 协议' },
];

const PERMISSION_MODES: Array<{ value: AcpPermissionMode; label: string; short: string }> = [
  { value: 'approve-all', label: '全部批准（approve-all）', short: '全部批准' },
  { value: 'approve-reads', label: '仅批准读取（approve-reads）', short: '仅批准读取' },
  { value: 'deny-all', label: '全部拒绝（deny-all）', short: '全部拒绝' },
];

const DEFAULT_API_PROFILE: ApiProfileValue = {
  protocol: 'openai',
  baseUrl: '',
  hasApiKey: false,
  apiKeyMasked: '',
};

function AgentRowView({
  agent,
  disabled,
  onSelect,
}: {
  agent: AgentRow;
  disabled: boolean;
  onSelect?: (id: string) => void;
}) {
  const acpSupported = agent.acp?.supported === true;
  // transport=acp 与 acp.supported 表达同一事实：只保留一个 ACP 徽章，避免同卡重复。
  const transport = (agent.transport ?? '').trim();
  const isAcpTransport = transport.toLowerCase() === 'acp';
  const path = (agent.path ?? '').trim();
  const version = (agent.version ?? '').trim();
  const versionText = version
    ? /^v/i.test(version)
      ? version
      : `v${version}`
    : agent.available
      ? '版本未知'
      : '未安装';
  const versionTitle = version ? `版本 ${version}` : versionText;
  const pathText = path || (agent.available ? '未返回安装路径' : '未检测到安装路径');
  const metaBadgeClass = 'h-[18px] shrink-0 px-1.5 text-[10px] font-medium';

  return (
    <div
      data-testid={`agent-row-${agent.id}`}
      data-current={agent.enabled ? 'true' : 'false'}
      data-available={agent.available ? 'true' : 'false'}
      className={cn(
        'flex h-full min-w-0 flex-col rounded-lg border bg-background transition-colors',
        agent.enabled ? 'border-primary/60 ring-1 ring-primary/10' : 'border-border hover:border-muted-foreground/40',
        !agent.available && 'bg-muted/20'
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 pb-2">
        <div className="flex min-w-0 items-start gap-2">
          <span
            role="img"
            aria-label={agent.available ? '可用' : '未安装'}
            title={agent.available ? '可用' : '未安装'}
            className={cn(
              'mt-1 size-2 shrink-0 rounded-full',
              agent.available ? 'bg-[var(--emerald)]' : 'bg-muted-foreground/40'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-[12.5px] font-semibold" title={agent.name}>
                {agent.name}
              </span>
              {agent.enabled ? (
                <Badge variant="cobalt" className={metaBadgeClass}>
                  当前
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 flex h-5 min-w-0 items-center gap-1 overflow-hidden">
              {transport && !isAcpTransport ? (
                <Badge variant="outline" className={metaBadgeClass}>
                  {transport}
                </Badge>
              ) : null}
              {isAcpTransport || acpSupported ? (
                <Badge
                  variant="outline"
                  className={cn(
                    metaBadgeClass,
                    'border-[var(--cobalt-border)] bg-[var(--cobalt-soft)] text-[var(--cobalt)]'
                  )}
                >
                  ACP
                </Badge>
              ) : null}
              <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground" title={agent.id}>
                {agent.id}
              </span>
            </div>
          </div>
        </div>
        <div
          className="flex h-7 min-w-0 items-center rounded-md border border-dashed border-border bg-muted/40 px-2"
          title={pathText}
        >
          <span
            className={cn(
              'min-w-0 truncate font-mono text-[10.5px]',
              path ? 'text-muted-foreground' : 'text-muted-foreground/70'
            )}
          >
            {pathText}
          </span>
        </div>
      </div>
      <div
        className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border/70 px-3"
        data-testid={`agent-card-actions-${agent.id}`}
      >
        <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
          <Switch
            checked={agent.enabled}
            disabled={disabled || !agent.available}
            onCheckedChange={(next) => {
              if (next) onSelect?.(agent.id);
            }}
            aria-label={agent.enabled ? `${agent.name} 当前主力` : `设为主力 ${agent.name}`}
          />
          <span
            className={cn(
              'truncate text-[11px]',
              agent.enabled ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            {agent.enabled ? '当前主力' : agent.available ? '设为主力' : '不可用'}
          </span>
        </label>
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={versionTitle}>
          {versionText}
        </span>
      </div>
    </div>
  );
}

export function AgentMatrix({
  agents,
  acpEnabled = false,
  permissionMode = 'approve-reads',
  loading = false,
  engine = 'cli',
  apiProfile = DEFAULT_API_PROFILE,
  onSelectAgent,
  onAcpChange,
  onPermissionChange,
  onEngineChange,
  onSaveApiProfile,
  onTestConnection,
  onApiDraftChange,
  onRedetect,
}: AgentMatrixProps) {
  const [probing, setProbing] = React.useState(false);
  const [probeText, setProbeText] = React.useState('');
  const [mode, setMode] = React.useState<SettingsEngine>(engine);

  const [protocol, setProtocol] = React.useState(apiProfile.protocol || 'openai');
  const [baseUrl, setBaseUrl] = React.useState(apiProfile.baseUrl || '');
  const [apiKey, setApiKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const [savingApi, setSavingApi] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testState, setTestState] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    setMode(engine);
  }, [engine]);

  React.useEffect(() => {
    setProtocol(apiProfile.protocol || 'openai');
    setBaseUrl(apiProfile.baseUrl || '');
    setApiKey('');
    setTestState(null);
  }, [apiProfile.protocol, apiProfile.baseUrl, apiProfile.hasApiKey]);

  const list = Array.isArray(agents) ? agents : [];
  const available = list.filter((a) => a.available);
  const missing = list.filter((a) => !a.available);

  const switchMode = async (next: SettingsEngine) => {
    if (next === mode) return;
    setMode(next);
    try {
      const result = await onEngineChange?.(next);
      if (result && !result.ok) setMode(engine);
    } catch {
      setMode(engine);
    }
  };

  const redetect = async () => {
    setProbing(true);
    setProbeText('正在探测…');
    try {
      await onRedetect?.();
      setProbeText('探测完成');
    } catch (e) {
      setProbeText(`探测失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProbing(false);
    }
  };

  const draft = React.useMemo<ApiProfileDraft>(
    () => ({
      protocol,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      provider: apiProfile.provider,
    }),
    [protocol, baseUrl, apiKey, apiProfile.provider]
  );

  React.useEffect(() => {
    if (mode !== 'api') return;
    onApiDraftChange?.(draft);
  }, [mode, draft, onApiDraftChange]);

  const saveApiProfile = async () => {
    if (!onSaveApiProfile) {
      toast('保存失败：未接入 ai.saveConfig 通道');
      return;
    }
    setSavingApi(true);
    try {
      const result = await onSaveApiProfile(draft);
      if (result && !result.ok) {
        toast(`保存失败：${result.error || '未知错误'}`);
        return;
      }
      setApiKey('');
      toast('API 配置已保存');
    } catch (e) {
      toast(`保存失败：${ipcErrorText(e)}`);
    } finally {
      setSavingApi(false);
    }
  };

  const testConnection = async () => {
    if (!onTestConnection) {
      toast('连通性测试失败：未接入 ai.testConnection 通道');
      return;
    }
    setTesting(true);
    setTestState(null);
    try {
      const result = await onTestConnection(draft);
      if (!result.ok) {
        const text = result.error || '连接失败';
        setTestState({ ok: false, text });
        toast(`连通性测试失败：${text}`);
        return;
      }
      const parts = ['连通'];
      if (typeof result.latency === 'number') parts.push(`${result.latency}ms`);
      if (typeof result.status === 'number') parts.push(`HTTP ${result.status}`);
      const text = parts.join(' · ');
      setTestState({ ok: true, text });
      toast(`连通性测试通过（${text}）`);
    } catch (e) {
      const text = ipcErrorText(e);
      setTestState({ ok: false, text });
      toast(`连通性测试失败：${text}`);
    } finally {
      setTesting(false);
    }
  };

  const keyPlaceholder = apiProfile.hasApiKey
    ? `已保存 ${apiProfile.apiKeyMasked || '****'}（留空不修改）`
    : '输入 API Key';

  return (
    <div className="flex flex-col gap-3" data-testid="agent-matrix">
      <div
        className="inline-flex w-fit items-center overflow-hidden rounded-md border border-border bg-background shadow-sm"
        role="group"
        aria-label="AI 调用引擎"
      >
        <button
          type="button"
          data-testid="engine-cli"
          aria-pressed={mode === 'cli'}
          onClick={() => void switchMode('cli')}
          className={cn(
            'h-8 px-3 text-[12.5px] font-medium transition-colors',
            mode === 'cli'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          本地 CLI
        </button>
        <button
          type="button"
          data-testid="engine-api"
          aria-pressed={mode === 'api'}
          onClick={() => void switchMode('api')}
          className={cn(
            'h-8 border-l border-border px-3 text-[12.5px] font-medium transition-colors',
            mode === 'api'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          API 直连
        </button>
      </div>

      {mode === 'cli' ? (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
              <div className="min-w-0">
                <CardTitle className="text-[13px]">Agent 矩阵</CardTitle>
                <CardDescription className="mt-1">
                  {list.length ? `已探测 ${list.length} 个本地 Agent CLI` : '等待 ai:check 返回本地 Agent CLI'}
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Button variant="outline" onClick={redetect} disabled={probing || loading}>
                  {probing || loading ? '探测中…' : '重新探测'}
                </Button>
                {probeText ? (
                  <span className="max-w-[132px] truncate text-[10.5px] text-muted-foreground" title={probeText}>
                    {probeText}
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="@container flex flex-col gap-2.5">
              {list.length === 0 ? (
                <div
                  className="rounded-lg border border-dashed border-border p-5 text-center"
                  data-testid="agent-empty"
                >
                  <div className="text-[12px] font-medium">
                    {loading ? '正在探测本地 Agent CLI…' : '未探测到本地 Agent CLI'}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {loading ? '请稍候，探测完成后自动刷新' : '不显示占位/假数据；安装 CLI 后可重新探测'}
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="grid auto-rows-fr grid-cols-1 gap-2.5 @min-[500px]:grid-cols-2"
                    data-testid="agent-card-grid"
                  >
                    {available.map((a) => (
                      <AgentRowView key={a.id} agent={a} disabled={loading} onSelect={onSelectAgent} />
                    ))}
                  </div>
                  {available.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                      未发现可用 CLI；以下为探测到但未安装的条目。
                    </div>
                  ) : null}
                  {missing.length ? (
                    <details
                      className="group rounded-lg border border-dashed border-border bg-muted/20"
                      data-testid="agent-missing-fold"
                    >
                      <summary className="flex h-8 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[11.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
                        <span>未安装的 CLI（{missing.length}）</span>
                        <span className="text-[10.5px] group-open:hidden">展开</span>
                        <span className="hidden text-[10.5px] group-open:inline">收起</span>
                      </summary>
                      <div
                        className="grid auto-rows-fr grid-cols-1 gap-2.5 border-t border-border/70 p-2.5 @min-[500px]:grid-cols-2"
                        data-testid="agent-missing-grid"
                      >
                        {missing.map((a) => (
                          <AgentRowView key={a.id} agent={a} disabled={loading} onSelect={onSelectAgent} />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-[13px]">ACP 与权限模式</CardTitle>
                {acpEnabled ? <Badge variant="cobalt">ACP 已启用</Badge> : <Badge variant="secondary">CLI 直连</Badge>}
              </div>
              <CardDescription>全局配置：写入 ai:save-config 的 acp 段</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5">
                <Switch checked={acpEnabled} onCheckedChange={(v) => onAcpChange?.(v)} aria-label="ACP 开关" />
                <span className="text-[12px] font-medium">走 ACP 标准协议</span>
                <span className="ml-auto text-[10.5px] text-muted-foreground">全局</span>
              </div>
              <div className="flex h-8 items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground">权限模式</span>
                <Select value={permissionMode} onValueChange={(v) => onPermissionChange?.(v as AcpPermissionMode)}>
                  <SelectTrigger className="h-8 w-40" aria-label="权限模式">
                    <span className="truncate">
                      {PERMISSION_MODES.find((m) => m.value === permissionMode)?.short || permissionMode}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10.5px] text-muted-foreground">
                ACP 关闭时回退 CLI 兼容模式；权限模式仅作用于 ACP 会话。
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card data-testid="api-profile">
          <CardHeader>
            <CardTitle className="text-[13px]">API 直连配置</CardTitle>
            <CardDescription>
              写入 ai:save-config 的 byok / api 段；修改后点「保存 API 配置」生效，Key 留空沿用已保存凭据
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">通信协议</span>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger className="h-8 w-full" aria-label="API 协议">
                  <span className="truncate">{API_PROTOCOLS.find((p) => p.value === protocol)?.label || protocol}</span>
                </SelectTrigger>
                <SelectContent>
                  {API_PROTOCOLS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Base URL</span>
              <Input
                className="h-8 font-mono"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
                aria-label="API Base URL"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">API Key</span>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1 font-mono"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keyPlaceholder}
                  autoComplete="off"
                  aria-label="API Key"
                />
                <Button
                  className="h-8"
                  variant="outline"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showKey ? '隐藏' : '显示'}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void testConnection()} disabled={testing}>
                {testing ? '测试中…' : '测试连通性'}
              </Button>
              <Button onClick={() => void saveApiProfile()} disabled={savingApi}>
                {savingApi ? '保存中…' : '保存 API 配置'}
              </Button>
              {testState ? (
                <Badge
                  variant={testState.ok ? 'cobalt' : 'secondary'}
                  className={cn('max-w-full truncate', !testState.ok && 'border-destructive/40 text-destructive')}
                >
                  {testState.text}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">失败时返回主进程真实错误</span>
              )}
            </div>

            {apiProfile.hasApiKey ? (
              <div className="text-[11.5px] text-muted-foreground">
                已保存凭据 {apiProfile.apiKeyMasked || '****'}；验证时留空即使用该凭据。
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
