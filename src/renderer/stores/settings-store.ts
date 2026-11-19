/**
 * src/renderer/stores/settings-store.ts — 设置 6 Tab 唯一数据源（W3-06）。
 *
 * 启动/打开设置时一次拉齐：
 *   ai.checkCli / ai.getConfig / ai.listModels({engine,api,byok}) /
 *   spec.list / uilib.list / projectBinding.get(project) / sandbox.list(root) / app.getVersion
 *
 * 保存统一走：
 *   ai.saveConfig / projectBinding.set / uilib.save / spec.*
 *
 * 契约（W3-06 × W3-07 冻结，不得改名）：
 *   selectors: agents/config/modelGroups/visibleModels/engine/acp/specs/uiLibs/
 *              binding/sandboxRoot/version/loading/error
 *   actions:   load/save
 * W3-07 只读消费 modelGroups/visibleModels/engine/acp。
 *
 * 说明：ai.checkCli / ai.getConfig / sandbox.list / app.getVersion 的返回体没有 ok 字段，
 * 因此这里用 raw 调用（getProtoApi）而不是 invokeProtoMethod —— 后者会把无 ok 的载荷
 * 归一化成 {ok:false,error:'bad-ipc-result'}，丢失真实数据。
 */

import { create } from 'zustand';
import { getProtoApi, ipcErrorText } from '@/lib/ipc';
import type { ModelGroup } from '@/features/models/ModelManager';
import { useAppStore } from './app-store';

export type SettingsEngine = 'cli' | 'api';

export type AcpPermissionMode = 'approve-all' | 'approve-reads' | 'deny-all';

export interface AgentAcpInfo {
  supported?: boolean;
  adapter?: boolean;
  adapterName?: string;
  command?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface SettingsAgent {
  id: string;
  name: string;
  available: boolean;
  /** 是否当前主力 Agent（由 config.agentId/mainAgent 派生，不编造）。 */
  enabled: boolean;
  path?: string;
  version?: string;
  transport?: string;
  acp?: AgentAcpInfo;
}

export interface AcpConfig {
  enabled: boolean;
  defaultPermissionMode: AcpPermissionMode;
  agents: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AiConfig {
  engine?: SettingsEngine;
  mode?: string;
  providerType?: string;
  agentId?: string;
  mainAgent?: string;
  api?: Record<string, unknown>;
  byok?: Record<string, unknown>;
  visibleModels?: string[];
  visibleModelsCli?: string[] | Record<string, string[]> | null;
  visibleModelsApi?: string[] | null;
  acp?: AcpConfig;
  [key: string]: unknown;
}

export interface SpecItem {
  id: string;
  name: string;
  desc?: string;
  file?: string;
  updatedAt?: number;
  kind?: string;
  uiSpec?: boolean;
  builtin?: boolean;
  [key: string]: unknown;
}

export interface UiLibItem {
  id: string;
  name: string;
  version?: string;
  css?: string[];
  js?: string[];
  [key: string]: unknown;
}

export interface ProjectBinding {
  specId: string;
  specName: string;
  uiLibId: string;
  uiLibName: string;
  updatedAt: number;
}

export type SettingsSpecAction = 'createFromFile' | 'createFromText' | 'update' | 'rename' | 'remove';

export interface SettingsSavePatch {
  /** 直接合并进 ai:save-config 的配置片段。 */
  config?: Record<string, unknown>;
  /** 可见模型（菜单白名单）；空数组 = 明确全不选，null = 旧配置未落盘（API 全选）。 */
  visibleModels?: string[] | null;
  /** 项目绑定；缺省字段不写。 */
  binding?: { specId?: string | null; uiLibId?: string | null };
  /** uilib:save 载荷（{id?,name,css,js,...}）。 */
  uiLib?: Record<string, unknown>;
  /** spec:* 动作。 */
  spec?: { action: SettingsSpecAction; payload: Record<string, unknown> };
}

export interface SettingsSaveResult {
  ok: boolean;
  error?: string;
}

export interface SettingsState {
  agents: SettingsAgent[];
  config: AiConfig | null;
  modelGroups: ModelGroup[];
  allGroups: ModelGroup[];
  defaultModel: string;
  visibleModels: string[] | null;
  engine: SettingsEngine;
  acp: AcpConfig;
  specs: SpecItem[];
  uiLibs: UiLibItem[];
  binding: ProjectBinding;
  sandboxRoot: string;
  version: string;
  project: string;
  loading: boolean;
  error: string | null;
  load: (project?: string) => Promise<void>;
  save: (patch: SettingsSavePatch) => Promise<SettingsSaveResult>;
}

type RawFn = (...args: unknown[]) => unknown;

interface AiCheckResult {
  found?: boolean;
  path?: string | null;
  version?: string | null;
  agents?: unknown;
}

interface AiModelsResult {
  ok?: boolean;
  error?: string;
  groups?: unknown;
  allGroups?: unknown;
  default?: unknown;
  engine?: unknown;
  visibleModels?: unknown;
  agentId?: unknown;
}

interface AiSaveConfigResult {
  ok?: boolean;
  error?: string;
  config?: unknown;
  persisted?: boolean;
  hint?: string;
}

interface SpecListResult {
  ok?: boolean;
  error?: string;
  items?: unknown;
}

interface UilibListResult {
  ok?: boolean;
  error?: string;
  items?: unknown;
}

interface BindingResult {
  ok?: boolean;
  error?: string;
  binding?: unknown;
}

interface SandboxListResult {
  ok?: boolean;
  error?: string;
  root?: unknown;
}

export function emptyProjectBinding(): ProjectBinding {
  return { specId: '', specName: '', uiLibId: '', uiLibName: '', updatedAt: 0 };
}

export function defaultAcpConfig(): AcpConfig {
  return { enabled: false, defaultPermissionMode: 'approve-reads', agents: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** 以 raw 方式调用 protoAPI，保留无 ok 字段的返回体；失败只记录文案，不抛错。 */
async function rawCall<T>(
  namespace: string,
  method: string,
  args: unknown[],
  errors: string[],
  label: string,
): Promise<T | null> {
  const api = getProtoApi();
  const space: unknown = api ? api[namespace] : undefined;
  const fn: unknown =
    space && typeof space === 'object' ? (space as Record<string, unknown>)[method] : undefined;
  if (typeof fn !== 'function') {
    errors.push(`${label}：缺少 protoAPI.${namespace}.${method}`);
    return null;
  }
  try {
    const result = await (fn as RawFn).apply(space, args);
    if (isRecord(result) && result.ok === false) {
      const reason = cleanString(result.error);
      errors.push(`${label}：${reason || '未知错误'}`);
    }
    return result as T;
  } catch (e) {
    errors.push(`${label}：${ipcErrorText(e)}`);
    return null;
  }
}

export function resolveEngine(config: AiConfig | null | undefined): SettingsEngine {
  if (!config) return 'cli';
  if (config.engine === 'api' || config.engine === 'cli') return config.engine;
  if (config.mode === 'api' || config.providerType === 'api') return 'api';
  return 'cli';
}

export function resolveAgentId(config: AiConfig | null | undefined): string {
  return cleanString(config?.agentId) || cleanString(config?.mainAgent) || 'opencode';
}

function cliVisibleMap(value: unknown, agentId: string): Record<string, string[]> {
  if (Array.isArray(value)) return { [agentId]: stringArray(value) };
  const out: Record<string, string[]> = {};
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (Array.isArray(value[key])) out[key] = stringArray(value[key]);
    }
  }
  return out;
}

/**
 * 可见模型（菜单白名单）以 config 为唯一真相源，语义与旧 getFetchVisible/getCliVisibleIds 对齐：
 * - API：visibleModelsApi 数组 → 该数组；未落盘 → null（全选）。
 * - CLI：visibleModelsCli 数组 → 该数组；按当前 Agent 取对象值；对象存在但缺 key → []；
 *        完全缺省 → []（菜单空态，去「获取模型」勾选）。
 */
export function pickVisibleModels(
  config: AiConfig | null | undefined,
  engine: SettingsEngine,
  agentId: string,
): string[] | null {
  if (!config) return engine === 'api' ? null : [];
  if (engine === 'api') {
    return Array.isArray(config.visibleModelsApi) ? stringArray(config.visibleModelsApi) : null;
  }
  const cli = config.visibleModelsCli;
  if (Array.isArray(cli)) return stringArray(cli);
  if (isRecord(cli)) {
    return Array.isArray(cli[agentId]) ? stringArray(cli[agentId]) : [];
  }
  return [];
}

export function normalizeAcpConfig(value: unknown): AcpConfig {
  const src = isRecord(value) ? value : {};
  const mode = cleanString(src.defaultPermissionMode);
  const agents: Record<string, Record<string, unknown>> = {};
  if (isRecord(src.agents)) {
    for (const id of Object.keys(src.agents)) {
      const entry = src.agents[id];
      if (isRecord(entry)) agents[id] = { ...entry };
    }
  }
  return {
    ...src,
    enabled: src.enabled === true,
    defaultPermissionMode:
      mode === 'approve-all' || mode === 'approve-reads' || mode === 'deny-all'
        ? mode
        : 'approve-reads',
    agents,
  };
}

function normalizeConfig(value: unknown): AiConfig | null {
  if (!isRecord(value) || value.ok === false) return null;
  const out = { ...value } as AiConfig;
  out.engine = resolveEngine(out);
  if (isRecord(value.api)) out.api = { ...value.api };
  if (isRecord(value.byok)) out.byok = { ...value.byok };
  out.acp = normalizeAcpConfig(value.acp);
  return out;
}

function normalizeAgents(value: unknown, agentId: string): SettingsAgent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SettingsAgent[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = cleanString(entry.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const acp = isRecord(entry.acp) ? ({ ...entry.acp } as AgentAcpInfo) : undefined;
    out.push({
      id,
      name: cleanString(entry.name) || id,
      available: entry.available === true,
      enabled: id === agentId,
      ...(cleanString(entry.path) ? { path: cleanString(entry.path) } : {}),
      ...(cleanString(entry.version) ? { version: cleanString(entry.version) } : {}),
      ...(cleanString(entry.transport) ? { transport: cleanString(entry.transport) } : {}),
      ...(acp ? { acp } : {}),
    });
  }
  return out;
}

function normalizeModelGroups(value: unknown): ModelGroup[] {
  if (!Array.isArray(value)) return [];
  const out: ModelGroup[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !Array.isArray(entry.models)) continue;
    out.push({
      provider: cleanString(entry.provider) || undefined,
      label: cleanString(entry.label) || undefined,
      models: entry.models.filter(
        (m) => typeof m === 'string' || isRecord(m),
      ) as ModelGroup['models'],
    });
  }
  return out;
}

function normalizeSpecs(value: unknown): SpecItem[] {
  if (!Array.isArray(value)) return [];
  const out: SpecItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = cleanString(entry.id);
    if (!id) continue;
    out.push({
      ...entry,
      id,
      name: cleanString(entry.name) || id,
      desc: cleanString(entry.desc) || undefined,
      file: cleanString(entry.file) || undefined,
      kind: cleanString(entry.kind) || undefined,
      uiSpec: entry.uiSpec === true,
      builtin: entry.builtin === true,
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : undefined,
    });
  }
  return out;
}

function normalizeUiLibs(value: unknown): UiLibItem[] {
  if (!Array.isArray(value)) return [];
  const out: UiLibItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = cleanString(entry.id);
    if (!id) continue;
    out.push({
      ...entry,
      id,
      name: cleanString(entry.name) || id,
      version: cleanString(entry.version) || undefined,
      css: stringArray(entry.css),
      js: stringArray(entry.js),
    });
  }
  return out;
}

function normalizeBinding(value: unknown): ProjectBinding {
  const src = isRecord(value) ? value : {};
  return {
    specId: cleanString(src.specId),
    specName: cleanString(src.specName),
    uiLibId: cleanString(src.uiLibId),
    uiLibName: cleanString(src.uiLibName),
    updatedAt: typeof src.updatedAt === 'number' ? src.updatedAt : 0,
  };
}

function normalizeVersion(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return cleanString(value.version);
  return '';
}

interface ModelsData {
  modelGroups: ModelGroup[];
  allGroups: ModelGroup[];
  defaultModel: string;
  engine: SettingsEngine;
  visibleModels: string[] | null;
}

async function fetchModels(
  config: AiConfig | null,
  errors: string[],
): Promise<ModelsData> {
  const engine = resolveEngine(config);
  const result = await rawCall<AiModelsResult>(
    'ai',
    'listModels',
    [{ engine, api: config?.api ?? {}, byok: config?.byok ?? {} }],
    errors,
    '读取模型目录',
  );
  const agentId = resolveAgentId(config);
  const groups = normalizeModelGroups(result?.groups);
  return {
    modelGroups: groups,
    allGroups: normalizeModelGroups(result?.allGroups ?? result?.groups),
    defaultModel: cleanString(result?.default),
    engine,
    visibleModels: config
      ? pickVisibleModels(config, engine, agentId)
      : Array.isArray(result?.visibleModels)
        ? stringArray(result?.visibleModels)
        : null,
  };
}

/**
 * 保存后预热的「当前模型」：显式 config.model → 可见模型首个 → 目录默认值。
 * 与主进程 resolveConfiguredModel 同序，保证预热 key（agentId|model）和对话首探一致。
 */
export function pickProbeModel(
  config: AiConfig | null | undefined,
  visible: string[] | null,
  fallback: string,
): string {
  const direct = cleanString(config?.model);
  if (direct) return direct;
  const first = visible && visible.length ? cleanString(visible[0]) : '';
  if (first) return first;
  return cleanString(fallback);
}

/**
 * 保存成功后 fire-and-forget 预热思考强度缓存：
 * 主进程按 `agentId|model` 后台探测并写 ai-thinking-cache.json，下次打开设置/对话秒回。
 * 刻意不 await、不新增通道、失败静默——保存链路绝不能被 ACP 冷启动拖住。
 * @param config 已落盘的 AI 配置
 * @param engine 当前引擎（ACP 只服务 CLI，api 引擎不预热）
 * @param agentId 当前 Agent
 * @param visible 当前可见模型（可空）
 * @param fallback 目录默认模型
 */
function warmThinkingCache(
  config: AiConfig | null,
  engine: SettingsEngine,
  agentId: string,
  visible: string[] | null,
  fallback: string,
): void {
  try {
    if (engine !== 'cli') return;
    const model = pickProbeModel(config, visible, fallback);
    if (!model) return;
    const api = getProtoApi();
    const space: unknown = api ? api.ai : undefined;
    const fn: unknown =
      space && typeof space === 'object' ? (space as Record<string, unknown>).listModels : undefined;
    if (typeof fn !== 'function') return;
    const hint = { engine, probeModel: model, agentId, background: true };
    // 主进程立刻回 {status:'probing'}，真实探测在其后台队列里跑；这里只发不等。
    void Promise.resolve((fn as RawFn).apply(space, [hint])).catch(() => {});
  } catch (e) {
    /* 预热失败不影响保存结果 */
  }
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  agents: [],
  config: null,
  modelGroups: [],
  allGroups: [],
  defaultModel: '',
  visibleModels: null,
  engine: 'cli',
  acp: defaultAcpConfig(),
  specs: [],
  uiLibs: [],
  binding: emptyProjectBinding(),
  sandboxRoot: '',
  version: '',
  project: '',
  loading: false,
  error: null,

  load: async (project) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    const errors: string[] = [];
    try {
      const targetProject = String(project ?? useAppStore.getState().project ?? '').trim();
      if (!getProtoApi()) {
        set({
          loading: false,
          error: '桌面端网关不可用（缺少 window.protoAPI），无法读取设置',
        });
        return;
      }

      // config 先单独 await，模型目录与 check/spec/uilib/binding/sandbox/version 并行，
      // 避免慢速 Agent 探测阻塞 ai:listModels。
      const checkPromise = rawCall<AiCheckResult>('ai', 'checkCli', [], errors, 'Agent 探测');
      const cfgPromise = rawCall<AiConfig>('ai', 'getConfig', [], errors, '读取 AI 配置');
      const specPromise = rawCall<SpecListResult>('spec', 'list', [], errors, '读取设计规范');
      const uiPromise = rawCall<UilibListResult>('uilib', 'list', [], errors, '读取 UI 库');
      const bindPromise = targetProject
        ? rawCall<BindingResult>('projectBinding', 'get', [targetProject], errors, '读取项目绑定')
        : Promise.resolve(null);
      const sandboxPromise = rawCall<SandboxListResult>(
        'sandbox',
        'list',
        [],
        errors,
        '读取沙箱目录',
      );
      const versionPromise = rawCall<unknown>('app', 'getVersion', [], errors, '读取版本');

      const config = normalizeConfig(await cfgPromise);
      const modelsPromise = fetchModels(config, errors);

      const [checkRaw, specRaw, uiRaw, bindRaw, sandboxRaw, versionRaw, models] =
        await Promise.all([
          checkPromise,
          specPromise,
          uiPromise,
          bindPromise,
          sandboxPromise,
          versionPromise,
          modelsPromise,
        ]);

      const engine = resolveEngine(config);
      const agentId = resolveAgentId(config);
      const agents = normalizeAgents(checkRaw?.agents, agentId);

      set({
        project: targetProject,
        agents,
        config,
        modelGroups: models.modelGroups,
        allGroups: models.allGroups,
        defaultModel: models.defaultModel,
        visibleModels: models.visibleModels,
        engine: models.engine,
        acp: normalizeAcpConfig(config?.acp),
        specs: normalizeSpecs(specRaw?.items),
        uiLibs: normalizeUiLibs(uiRaw?.items),
        binding: bindRaw?.binding
          ? normalizeBinding(bindRaw.binding)
          : emptyProjectBinding(),
        sandboxRoot: cleanString(sandboxRaw?.root),
        version: normalizeVersion(versionRaw),
        loading: false,
        error: errors.length ? errors.join('；') : null,
      });
    } catch (e) {
      set({
        loading: false,
        error: `读取设置失败：${ipcErrorText(e)}`,
      });
    }
  },

  save: async (patch) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const finish = (): SettingsSaveResult => {
      const error = errors.length ? errors.join('；') : undefined;
      if (error) {
        set({ error });
        return { ok: false, error };
      }
      // 写操作成功但刷新列表失败：保存仍算成功，错误条只做只读提示。
      set({ error: warnings.length ? warnings.join('；') : null });
      return { ok: true };
    };

    try {
      if (patch.spec) {
        const action = patch.spec.action;
        const result = await rawCall<{ ok?: boolean; error?: string }>(
          'spec',
          action,
          [patch.spec.payload],
          errors,
          '保存设计规范',
        );
        if (!result || result.ok === false) return finish();

        const removedId = cleanString(patch.spec.payload.id);
        // 内置 UI 规范删除后记墓碑，避免 ensureSpecsInit 下次又把预置项补回来。
        if (action === 'remove') {
          const target = get().specs.find((s) => s.id === removedId);
          if (target?.builtin && target?.uiSpec) {
            const prev = stringArray(get().config?.removedBuiltinSpecs);
            if (!prev.includes(removedId)) {
              await rawCall<AiSaveConfigResult>(
                'ai',
                'saveConfig',
                [{ removedBuiltinSpecs: [...prev, removedId] }],
                [],
                '记录内置规范删除',
              );
            }
          }
        }

        // 删除的是当前绑定规范时同步清掉项目绑定，避免 design-spec.md 变成孤儿快照。
        if (action === 'remove' && get().binding.specId === removedId) {
          const project = get().project;
          if (project) {
            await rawCall<BindingResult>(
              'projectBinding',
              'set',
              [{ project, specId: '' }],
              warnings,
              '清除失效项目绑定',
            );
          }
        }

        const [specRaw, bindRaw] = await Promise.all([
          rawCall<SpecListResult>('spec', 'list', [], warnings, '读取设计规范'),
          get().project
            ? rawCall<BindingResult>(
                'projectBinding',
                'get',
                [get().project],
                warnings,
                '读取项目绑定',
              )
            : Promise.resolve(null),
        ]);
        if (specRaw) set({ specs: normalizeSpecs(specRaw.items) });
        if (bindRaw?.binding) set({ binding: normalizeBinding(bindRaw.binding) });
      }

      if (patch.uiLib) {
        const result = await rawCall<{ ok?: boolean; error?: string }>(
          'uilib',
          'save',
          [patch.uiLib],
          errors,
          '保存 UI 库',
        );
        if (!result || result.ok === false) return finish();
        const uiRaw = await rawCall<UilibListResult>(
          'uilib',
          'list',
          [],
          warnings,
          '读取 UI 库',
        );
        if (uiRaw) set({ uiLibs: normalizeUiLibs(uiRaw.items) });
      }

      if (patch.binding) {
        const project = get().project;
        if (!project) {
          errors.push('保存项目绑定：未选择项目');
          return finish();
        }
        const payload: Record<string, unknown> = { project };
        if (Object.prototype.hasOwnProperty.call(patch.binding, 'specId')) {
          payload.specId = patch.binding.specId ?? '';
        }
        if (Object.prototype.hasOwnProperty.call(patch.binding, 'uiLibId')) {
          payload.uiLibId = patch.binding.uiLibId ?? '';
        }
        const result = await rawCall<BindingResult>(
          'projectBinding',
          'set',
          [payload],
          errors,
          '保存项目绑定',
        );
        if (!result || result.ok === false) return finish();
        if (result.binding) set({ binding: normalizeBinding(result.binding) });
      }

      if (patch.config || patch.visibleModels !== undefined) {
        const state = get();
        const base: AiConfig = state.config ? { ...state.config } : {};
        if (patch.config) Object.assign(base, patch.config);

        if (patch.visibleModels !== undefined) {
          const nextVisible =
            patch.visibleModels === null ? null : stringArray(patch.visibleModels);
          const engine = resolveEngine(base);
          if (nextVisible === null) {
            base.visibleModels = [];
            if (engine === 'api') base.visibleModelsApi = null;
            else {
              const map = cliVisibleMap(base.visibleModelsCli, resolveAgentId(base));
              delete map[resolveAgentId(base)];
              base.visibleModelsCli = map;
            }
          } else {
            base.visibleModels = nextVisible.slice();
            if (engine === 'api') {
              base.visibleModelsApi = nextVisible.slice();
            } else {
              const agentId = resolveAgentId(base);
              const map = cliVisibleMap(base.visibleModelsCli, agentId);
              map[agentId] = nextVisible.slice();
              base.visibleModelsCli = map;
            }
          }
          // 勾选即时反馈；保存失败回滚到旧白名单。
          set({ visibleModels: nextVisible });
        }

        const result = await rawCall<AiSaveConfigResult>(
          'ai',
          'saveConfig',
          [base],
          errors,
          '保存 AI 配置',
        );
        if (!result || result.ok === false) {
          if (patch.visibleModels !== undefined) {
            set({ visibleModels: state.visibleModels });
          }
          return finish();
        }

        const saved = normalizeConfig(result.config) ?? normalizeConfig(base);
        const engine = resolveEngine(saved);
        const agentId = resolveAgentId(saved);
        const models = await fetchModels(saved, warnings);
        set({
          config: saved,
          engine: models.engine,
          acp: normalizeAcpConfig(saved?.acp),
          agents: get().agents.map((a) => ({ ...a, enabled: a.id === agentId })),
          modelGroups: models.modelGroups,
          allGroups: models.allGroups,
          defaultModel: models.defaultModel,
          visibleModels: models.visibleModels,
        });
        // 配置/引擎/可见模型任一变化后预热思考强度缓存：不 await，保存立即返回。
        warmThinkingCache(saved, models.engine, agentId, models.visibleModels, models.defaultModel);
      }

      return finish();
    } catch (e) {
      errors.push(`保存设置：${ipcErrorText(e)}`);
      return finish();
    }
  },
}));
