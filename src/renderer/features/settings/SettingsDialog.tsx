import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import {
  AgentMatrix,
  type ApiProfileDraft,
  type ApiProfileValue,
  type ApiTestResult,
} from './AgentMatrix';
import { SandboxTab } from './SandboxTab';
import { ShortcutTab } from './ShortcutTab';
import { AboutTab } from './AboutTab';
import { ModelManager, aiStoredModel } from '../models/ModelManager';
import { ModelFetchModal } from '../models/ModelFetchModal';
import {
  useSettingsStore,
  type AiConfig,
  type SettingsEngine,
  type SettingsSaveResult,
  type SpecItem,
  type UiLibItem,
} from '@/stores/settings-store';
import { getProtoApi, ipcErrorText } from '@/lib/ipc';

/**
 * features/settings/SettingsDialog.tsx — 设置 6 Tab 容器。
 * Tabs：Agent / 模型 / 设计规范 / 沙箱 / 快捷键 / 关于。
 *
 * W3-06：数据全部从 settings-store 内部取，不再由 MainWindow 透传假数组。
 * P0-3：左 184px 垂直导航 + 右内容 + 底部「关闭 / 保存并应用」；6 Tab 内容保留。
 * 模型 Tab 内嵌 ModelManager（全量清单勾选 = 菜单白名单）+「获取模型」全量弹窗。
 * 设计规范 Tab 使用 spec/uilib 真实列表 + 项目绑定（保存即写 project.json / design-spec.md）。
 */

export type SettingsTabId = 'agent' | 'models' | 'design' | 'sandbox' | 'shortcuts' | 'about';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab?: SettingsTabId;
  defaultTab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
}

const NONE = '__none__';

const NAV_TRIGGER_CLASS =
  'h-8 w-full justify-start border border-transparent px-2.5 text-[12.5px] data-[state=active]:border-border data-[state=active]:font-semibold';

function notifyResult(result: SettingsSaveResult, okMessage?: string): void {
  try {
    if (!result.ok) toast(`保存失败：${result.error || '未知错误'}`);
    else if (okMessage) toast(okMessage);
  } catch {
    /* toast 不可用时静默 */
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** API Profile 落盘片段：空 Key 不写入（主进程语义：空串不覆盖已保存凭据）。 */
function buildApiSection(draft: ApiProfileDraft): Record<string, unknown> {
  // provider 只用于展示标签：OpenAI 协议下保留 deepseek/ali 等兼容厂商标识；
  // 切到 Anthropic / Google 等原生协议时，provider 必须跟随协议，避免目录标签错配。
  const provider =
    draft.protocol === 'openai' && draft.provider ? draft.provider : draft.protocol;
  const section: Record<string, unknown> = {
    protocol: draft.protocol,
    baseUrl: draft.baseUrl,
    provider,
  };
  if (draft.apiKey) section.apiKey = draft.apiKey;
  return section;
}

const KNOWN_API_PROTOCOLS = ['openai', 'anthropic', 'google', 'ollama', 'azure'];

/**
 * API Profile 展示值：按 byok → apiConfig → api 的优先级取主进程真实字段。
 * API Key 只用掩码；明文永不经 IPC（ai.getConfig 返回 apiKeyMasked / hasApiKey）。
 */
export function readApiProfile(config: AiConfig | null): ApiProfileValue {
  const api = asRecord(config?.api);
  const byok = asRecord(config?.byok);
  const apiConfig = asRecord(config?.apiConfig);
  const candidates = [byok, apiConfig, api];
  const src =
    candidates.find((s) => cleanText(s.baseUrl)) ||
    candidates.find((s) => s.hasApiKey === true) ||
    candidates.find((s) => cleanText(s.protocol) || cleanText(s.provider)) ||
    api;
  const rawProtocol = cleanText(src.protocol) || cleanText(src.provider) || 'openai';
  return {
    protocol: KNOWN_API_PROTOCOLS.includes(rawProtocol) ? rawProtocol : 'openai',
    baseUrl: cleanText(src.baseUrl),
    hasApiKey: src.hasApiKey === true,
    apiKeyMasked: cleanText(src.apiKeyMasked),
    provider: cleanText(src.provider) || cleanText(api.provider) || undefined,
  };
}

function DesignSpecTab() {
  const specs = useSettingsStore((s) => s.specs);
  const uiLibs = useSettingsStore((s) => s.uiLibs);
  const binding = useSettingsStore((s) => s.binding);
  const project = useSettingsStore((s) => s.project);
  const save = useSettingsStore((s) => s.save);

  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);

  const [addingSpec, setAddingSpec] = React.useState(false);
  const [specName, setSpecName] = React.useState('');
  const [specDesc, setSpecDesc] = React.useState('');
  const [specContent, setSpecContent] = React.useState('');

  const [addingLib, setAddingLib] = React.useState(false);
  const [libName, setLibName] = React.useState('');
  const [libCss, setLibCss] = React.useState('');
  const [libJs, setLibJs] = React.useState('');

  const bindSpec = (next: string) => {
    void save({ binding: { specId: next === NONE ? '' : next } }).then((r) =>
      notifyResult(r, next === NONE ? '已解绑设计规范' : '已绑定设计规范'),
    );
  };

  const bindUiLib = (next: string) => {
    void save({ binding: { uiLibId: next === NONE ? '' : next } }).then((r) =>
      notifyResult(r, next === NONE ? '已解绑 UI 库' : '已绑定 UI 库'),
    );
  };

  const toggleSpecBinding = (spec: SpecItem) => {
    bindSpec(binding.specId === spec.id ? NONE : spec.id);
  };

  const toggleUiLibBinding = (lib: UiLibItem) => {
    bindUiLib(binding.uiLibId === lib.id ? NONE : lib.id);
  };

  const removeSpec = (spec: SpecItem) => {
    if (pendingDelete !== spec.id) {
      setPendingDelete(spec.id);
      return;
    }
    setPendingDelete(null);
    void save({ spec: { action: 'remove', payload: { id: spec.id } } }).then((r) =>
      notifyResult(r, '已删除设计规范'),
    );
  };

  const importSpec = async () => {
    const api = getProtoApi();
    const pick = api && typeof api.pickTextFile === 'function' ? api.pickTextFile : null;
    if (typeof pick !== 'function') {
      toast('仅桌面端支持选择本地文件');
      return;
    }
    try {
      const raw = await (pick as (o: unknown) => Promise<unknown>).call(api, {
        title: '选择设计规范 md 文件',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!raw || typeof raw !== 'object') return;
      const info = raw as { path?: string; name?: string };
      if (!info.path) return;
      const fallback = String(info.name || info.path.split(/[\\/]/).pop() || '').replace(
        /\.md$/i,
        '',
      );
      const result = await save({
        spec: {
          action: 'createFromFile',
          payload: { srcPath: info.path, name: fallback || '未命名规范' },
        },
      });
      notifyResult(result, '已导入设计规范');
    } catch (e) {
      toast(`导入失败：${ipcErrorText(e)}`);
    }
  };

  const submitSpec = () => {
    const name = specName.trim();
    const content = specContent.trim();
    if (!name) {
      toast('请填写规范名称');
      return;
    }
    if (!content) {
      toast('请填写规范内容');
      return;
    }
    void save({
      spec: { action: 'createFromText', payload: { name, desc: specDesc.trim(), content } },
    }).then((r) => {
      notifyResult(r, '已新增设计规范');
      if (r.ok) {
        setAddingSpec(false);
        setSpecName('');
        setSpecDesc('');
        setSpecContent('');
      }
    });
  };

  const submitLib = () => {
    const name = libName.trim();
    if (!name) {
      toast('请填写 UI 库名称');
      return;
    }
    const split = (text: string) =>
      text
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    void save({ uiLib: { name, css: split(libCss), js: split(libJs) } }).then((r) => {
      notifyResult(r, '已新增 UI 库');
      if (r.ok) {
        setAddingLib(false);
        setLibName('');
        setLibCss('');
        setLibJs('');
      }
    });
  };

  return (
    <Card data-testid="design-tab">
      <CardHeader>
        <CardTitle className="text-[13px]">设计规范</CardTitle>
        <CardDescription>
          spec.list / uilib.list 真实列表；项目绑定写入 project.json，并快照 design-spec.md
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!project ? (
          <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
            当前未选择项目，项目绑定不可用；规范与 UI 库仍可管理。
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">项目规范</span>
            <Select value={binding.specId || NONE} onValueChange={bindSpec}>
              <SelectTrigger className="h-8 w-64" aria-label="项目设计规范绑定" disabled={!project}>
                <span className="truncate">{binding.specName || '未绑定'}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>不绑定</SelectItem>
                {specs.map((spec) => (
                  <SelectItem key={spec.id} value={spec.id}>
                    {spec.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {binding.specName ? (
              <Badge variant="secondary">{binding.specName}</Badge>
            ) : (
              <Badge variant="outline">未绑定</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">项目 UI 库</span>
            <Select value={binding.uiLibId || NONE} onValueChange={bindUiLib}>
              <SelectTrigger className="h-8 w-64" aria-label="项目 UI 库绑定" disabled={!project}>
                <span className="truncate">{binding.uiLibName || '未绑定'}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>不绑定</SelectItem>
                {uiLibs.map((lib) => (
                  <SelectItem key={lib.id} value={lib.id}>
                    {lib.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {binding.uiLibName ? (
              <Badge variant="secondary">{binding.uiLibName}</Badge>
            ) : (
              <Badge variant="outline">未绑定</Badge>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">规范库（{specs.length}）</div>
          <div className="flex gap-2">
            <Button size="default" variant="outline" onClick={() => void importSpec()}>
              导入 md
            </Button>
            <Button size="default" variant="outline" onClick={() => setAddingSpec((v) => !v)}>
              {addingSpec ? '收起' : '新建规范'}
            </Button>
          </div>
        </div>

        {addingSpec ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-testid="spec-add-form">
            <Input
              className="h-8"
              placeholder="规范名称"
              value={specName}
              onChange={(e) => setSpecName(e.target.value)}
              aria-label="规范名称"
            />
            <Input
              className="h-8"
              placeholder="规范描述（可选）"
              value={specDesc}
              onChange={(e) => setSpecDesc(e.target.value)}
              aria-label="规范描述"
            />
            <Textarea
              className="min-h-24"
              placeholder="规范正文（Markdown）"
              value={specContent}
              onChange={(e) => setSpecContent(e.target.value)}
              aria-label="规范内容"
            />
            <div className="flex justify-end">
              <Button size="default" onClick={submitSpec}>
                保存规范
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {specs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              规范库为空（spec.list 返回 0 条）
            </div>
          ) : (
            specs.map((spec) => (
              <div
                key={spec.id}
                className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5"
                data-testid={`spec-row-${spec.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium">{spec.name}</span>
                    {spec.kind ? <Badge variant="outline">{spec.kind}</Badge> : null}
                    {binding.specId === spec.id ? <Badge variant="default">已绑定</Badge> : null}
                  </div>
                  {spec.desc ? (
                    <div className="line-clamp-2 text-xs text-muted-foreground">{spec.desc}</div>
                  ) : null}
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {spec.id}
                  </div>
                </div>
                <Button
                  size="default"
                  variant="ghost"
                  disabled={!project}
                  onClick={() => toggleSpecBinding(spec)}
                >
                  {binding.specId === spec.id ? '解绑' : '绑定'}
                </Button>
                <Button
                  size="default"
                  variant={pendingDelete === spec.id ? 'destructive' : 'ghost'}
                  onClick={() => removeSpec(spec)}
                >
                  {pendingDelete === spec.id ? '确认删除' : '删除'}
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">UI 库（{uiLibs.length}）</div>
          <Button size="default" variant="outline" onClick={() => setAddingLib((v) => !v)}>
            {addingLib ? '收起' : '新增 UI 库'}
          </Button>
        </div>

        {addingLib ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-testid="uilib-add-form">
            <Input
              className="h-8"
              placeholder="UI 库名称"
              value={libName}
              onChange={(e) => setLibName(e.target.value)}
              aria-label="UI 库名称"
            />
            <Input
              className="h-8"
              placeholder="CSS URL（逗号或换行分隔）"
              value={libCss}
              onChange={(e) => setLibCss(e.target.value)}
              aria-label="UI 库 CSS"
            />
            <Input
              className="h-8"
              placeholder="JS URL（逗号或换行分隔，可选）"
              value={libJs}
              onChange={(e) => setLibJs(e.target.value)}
              aria-label="UI 库 JS"
            />
            <div className="flex justify-end">
              <Button size="default" onClick={submitLib}>
                保存 UI 库
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {uiLibs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              UI 库为空（uilib.list 返回 0 条）
            </div>
          ) : (
            uiLibs.map((lib) => (
              <div
                key={lib.id}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                data-testid={`uilib-row-${lib.id}`}
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                  {lib.name}
                </span>
                {lib.version ? <Badge variant="secondary">{lib.version}</Badge> : null}
                {binding.uiLibId === lib.id ? <Badge variant="default">已绑定</Badge> : null}
                <Button
                  size="default"
                  variant="ghost"
                  disabled={!project}
                  onClick={() => toggleUiLibBinding(lib)}
                >
                  {binding.uiLibId === lib.id ? '解绑' : '绑定'}
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  tab,
  defaultTab = 'agent',
  onTabChange,
}: SettingsDialogProps) {
  const [innerTab, setInnerTab] = React.useState<SettingsTabId>(defaultTab);
  const [fetchOpen, setFetchOpen] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [apiDraft, setApiDraft] = React.useState<ApiProfileDraft | null>(null);
  const [currentModel, setCurrentModel] = React.useState(() => aiStoredModel());

  const agents = useSettingsStore((s) => s.agents);
  const config = useSettingsStore((s) => s.config);
  const acp = useSettingsStore((s) => s.acp);
  const modelGroups = useSettingsStore((s) => s.modelGroups);
  const allGroups = useSettingsStore((s) => s.allGroups);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const visibleModels = useSettingsStore((s) => s.visibleModels);
  const engine = useSettingsStore((s) => s.engine);
  const sandboxRoot = useSettingsStore((s) => s.sandboxRoot);
  const version = useSettingsStore((s) => s.version);
  const loading = useSettingsStore((s) => s.loading);
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  const save = useSettingsStore((s) => s.save);

  const active = tab ?? innerTab;
  const setActive = (next: SettingsTabId) => {
    if (tab === undefined) setInnerTab(next);
    onTabChange?.(next);
  };

  React.useEffect(() => {
    if (!open) return;
    // AI 对话框可能在本设置弹窗挂载后改过当前模型；每次打开时重读本地键。
    setCurrentModel(aiStoredModel());
    void load();
  }, [open, load]);

  const persist = React.useCallback(
    (promise: Promise<SettingsSaveResult>, okMessage?: string) => {
      void promise.then((r) => notifyResult(r, okMessage));
    },
    [],
  );

  const handleVisibleChange = React.useCallback(
    (next: string[]) => {
      persist(save({ visibleModels: next }));
    },
    [persist, save],
  );

  const apiProfile = React.useMemo(() => readApiProfile(config), [config]);

  const handleEngineChange = React.useCallback(
    async (next: SettingsEngine): Promise<SettingsSaveResult> => {
      const result = await save({ config: { engine: next } });
      notifyResult(
        result,
        next === 'api' ? '已切换到 API 直连' : '已切换到本地 CLI',
      );
      return result;
    },
    [save],
  );

  /**
   * 保存 API Profile → settings-store.save → ai.saveConfig。
   * 空 API Key 不写入（主进程语义：空串不覆盖已保存凭据）。
   */
  const handleSaveApiProfile = React.useCallback(
    (draft: ApiProfileDraft): Promise<SettingsSaveResult> => {
      // 两段同写：执行链路优先读 byok，ai:models 的 API 分支优先读 api；
      // 只写一段会导致「模型目录」与「实际调用」使用不同 BaseURL/Key。
      return save({
        config: {
          engine: 'api',
          byok: buildApiSection(draft),
          api: buildApiSection(draft),
        },
      });
    },
    [save],
  );

  /** 连通性测试：真实 ai:test-connection 通道，失败文案来自主进程。 */
  const handleTestConnection = React.useCallback(
    async (draft: ApiProfileDraft): Promise<ApiTestResult> => {
      const gateway = getProtoApi();
      const space =
        gateway && gateway.ai && typeof gateway.ai === 'object'
          ? (gateway.ai as Record<string, unknown>)
          : null;
      const fn =
        space && typeof space.testConnection === 'function'
          ? (space.testConnection as (...args: unknown[]) => unknown)
          : null;
      if (!fn || !space) return { ok: false, error: '当前环境缺少 ai.testConnection 通道' };
      try {
        const payload: Record<string, unknown> = {
          protocol: draft.protocol,
          baseUrl: draft.baseUrl,
        };
        if (draft.provider) payload.provider = draft.provider;
        // 空 Key 故意不传：主进程会回落到已保存凭据，而不是用空串覆盖。
        if (draft.apiKey) payload.apiKey = draft.apiKey;
        const raw = await fn.apply(space, [payload]);
        const rec = asRecord(raw);
        const ok = rec.ok === true || rec.success === true;
        const latency = typeof rec.latency === 'number' ? rec.latency : rec.latencyMs;
        return {
          ok,
          latency: typeof latency === 'number' ? latency : undefined,
          status: typeof rec.status === 'number' ? rec.status : undefined,
          error: ok
            ? undefined
            : cleanText(rec.error) || cleanText(rec.message) || '连接失败',
        };
      } catch (e) {
        return { ok: false, error: ipcErrorText(e) };
      }
    },
    [],
  );

  const applySettings = async () => {
    if (applying) return;
    setApplying(true);
    try {
      // API 直连时把 Agent 页当前草稿一并应用（未点页内「保存 API 配置」也不丢）。
      const patch: Record<string, unknown> = { engine };
      if (engine === 'api' && apiDraft) {
        patch.byok = buildApiSection(apiDraft);
        patch.api = buildApiSection(apiDraft);
      }
      const result = await save({ config: patch });
      if (!result.ok) {
        notifyResult(result);
        return;
      }
      toast('设置已保存并应用');
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[580px] max-h-[85vh] max-w-[780px] flex-col gap-0 overflow-hidden p-0"
        data-testid="settings-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>Agent / 模型 / 设计规范 / 沙箱 / 快捷键 / 关于</DialogDescription>
        </DialogHeader>

        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as SettingsTabId)}
          className="flex min-h-0 flex-1 flex-row gap-0"
        >
          <TabsList
            aria-label="设置分类"
            className="flex w-[184px] shrink-0 flex-col items-stretch gap-0.5 rounded-none border-r border-border bg-muted/30 p-2.5"
          >
            <TabsTrigger className={NAV_TRIGGER_CLASS} value="agent">
              Agent 设置
            </TabsTrigger>
            <TabsTrigger className={NAV_TRIGGER_CLASS} value="models">
              模型管理
            </TabsTrigger>
            <TabsTrigger className={NAV_TRIGGER_CLASS} value="design">
              设计规范
            </TabsTrigger>
            <TabsTrigger className={NAV_TRIGGER_CLASS} value="sandbox">
              沙箱存储
            </TabsTrigger>
            <TabsTrigger className={NAV_TRIGGER_CLASS} value="shortcuts">
              快捷键
            </TabsTrigger>
            <TabsTrigger className={NAV_TRIGGER_CLASS} value="about">
              关于软件
            </TabsTrigger>
          </TabsList>

          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 p-5">
              {loading ? (
                <div className="text-xs text-muted-foreground" data-testid="settings-loading">
                  正在读取设置…
                </div>
              ) : null}
              {error ? (
                <div
                  className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
                  data-testid="settings-error"
                >
                  <span className="min-w-0 flex-1 break-all">{error}</span>
                  <Button variant="outline" onClick={() => void load()}>
                    重试
                  </Button>
                </div>
              ) : null}

              <TabsContent value="agent" className="flex flex-col gap-3">
                <AgentMatrix
                  agents={agents}
                  acpEnabled={acp.enabled}
                  permissionMode={acp.defaultPermissionMode}
                  loading={loading}
                  engine={engine}
                  apiProfile={apiProfile}
                  onSelectAgent={(id) =>
                    persist(
                      save({ config: { agentId: id, mainAgent: id, engine: 'cli' } }),
                      '已切换主力 Agent',
                    )
                  }
                  onAcpChange={(enabled) =>
                    persist(save({ config: { acp: { ...acp, enabled } } }), '已保存 ACP 开关')
                  }
                  onPermissionChange={(defaultPermissionMode) =>
                    persist(
                      save({ config: { acp: { ...acp, defaultPermissionMode } } }),
                      '已保存权限模式',
                    )
                  }
                  onEngineChange={handleEngineChange}
                  onSaveApiProfile={handleSaveApiProfile}
                  onTestConnection={handleTestConnection}
                  onApiDraftChange={setApiDraft}
                  onRedetect={load}
                />
              </TabsContent>

              <TabsContent value="models" className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">模型管理</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      勾选需要暴露给 AI 对话框下拉菜单的模型；搜索只过滤显示，不改勾选
                    </div>
                  </div>
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    {engine === 'api' ? 'API 直连' : '本地 CLI'}
                  </Badge>
                </div>
                <ModelManager
                  groups={allGroups.length ? allGroups : modelGroups}
                  visibleIds={visibleModels}
                  defaultModelId={defaultModel}
                  currentModelId={currentModel}
                  onChange={handleVisibleChange}
                  onRefresh={() => void load()}
                  refreshing={loading}
                  onFetchModels={() => setFetchOpen(true)}
                />
              </TabsContent>

              <TabsContent value="design">
                <DesignSpecTab />
              </TabsContent>
              <TabsContent value="sandbox">
                <SandboxTab root={sandboxRoot} loading={loading} />
              </TabsContent>
              <TabsContent value="shortcuts">
                <ShortcutTab />
              </TabsContent>
              <TabsContent value="about">
                <AboutTab version={version} loading={loading} />
              </TabsContent>
            </div>
          </div>
        </Tabs>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">所有更改即时保存</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
              关闭
            </Button>
            <Button onClick={() => void applySettings()} disabled={applying}>
              {applying ? '应用中…' : '保存并应用'}
            </Button>
          </div>
        </footer>

        <ModelFetchModal
          open={fetchOpen}
          onOpenChange={setFetchOpen}
          groups={allGroups}
          visibleIds={visibleModels}
          onChange={handleVisibleChange}
        />
      </DialogContent>
    </Dialog>
  );
}
