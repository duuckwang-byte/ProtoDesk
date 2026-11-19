import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AgentMatrix } from '@/features/settings/AgentMatrix';
import {
  defaultAcpConfig,
  emptyProjectBinding,
  pickVisibleModels,
  useSettingsStore,
  type AiConfig,
} from '@/stores/settings-store';

const BASE_CONFIG: AiConfig = {
  engine: 'cli',
  agentId: 'opencode',
  mainAgent: 'opencode',
  api: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    apiKeyMasked: '****1234',
    hasApiKey: true,
  },
  byok: {},
  visibleModels: ['m-1'],
  visibleModelsCli: { opencode: ['m-1'] },
  visibleModelsApi: null,
  acp: {
    enabled: true,
    defaultPermissionMode: 'approve-reads',
    agents: {},
  },
};

const AGENTS = [
  {
    id: 'qoder',
    name: 'Qoder CLI',
    available: true,
    path: 'C:/bin/qoder',
    version: '1.2.0',
    transport: 'legacy',
    acp: { supported: false },
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    available: true,
    path: 'C:/bin/opencode',
    version: '2.0.0',
    transport: 'legacy',
    acp: { supported: false },
  },
  {
    id: 'agy',
    name: 'Agy',
    available: false,
    path: '',
    version: '',
    transport: 'legacy',
    acp: { supported: false },
  },
  {
    id: 'codebuddy',
    name: 'Codebuddy Code',
    available: false,
    path: '',
    version: '',
    transport: 'legacy',
    acp: { supported: false },
  },
];

const GROUPS = [
  {
    provider: 'opencode',
    label: 'OpenCode',
    models: [
      { id: 'm-1', name: 'Model One' },
      { id: 'm-2', name: 'Model Two' },
    ],
  },
];

const ALL_GROUPS = [
  ...GROUPS,
  {
    provider: 'opencode',
    label: 'OpenCode（全量）',
    models: [{ id: 'm-3', name: 'Model Three' }],
  },
];

interface MockOptions {
  agents?: unknown;
  config?: AiConfig;
  models?: {
    groups?: unknown;
    allGroups?: unknown;
    default?: unknown;
    visibleModels?: unknown;
  };
}

function makeApi(options: MockOptions = {}) {
  const config = options.config ?? BASE_CONFIG;
  const groups = options.models?.groups ?? GROUPS;
  const allGroups = options.models?.allGroups ?? ALL_GROUPS;
  return {
    ai: {
      checkCli: vi.fn(async () => ({
        found: true,
        path: 'C:/bin/opencode',
        version: '2.0.0',
        agents: options.agents ?? AGENTS,
      })),
      getConfig: vi.fn(async () => config),
      listModels: vi.fn(async () => ({
        ok: true,
        groups,
        allGroups,
        default: 'm-1',
        engine: 'cli',
        visibleModels: ['m-1'],
      })),
      saveConfig: vi.fn(async (next: unknown) => ({ ok: true, config: next, persisted: true })),
    },
    spec: {
      list: vi.fn(async () => ({
        ok: true,
        items: [
          { id: 'spec-1', name: '默认规范', desc: '通用', file: 'spec-1.md', updatedAt: 1 },
        ],
      })),
      createFromFile: vi.fn(async () => ({ ok: true, item: { id: 'spec-new' } })),
      createFromText: vi.fn(async () => ({ ok: true, item: { id: 'spec-new' } })),
      update: vi.fn(async () => ({ ok: true })),
      rename: vi.fn(async () => ({ ok: true })),
      remove: vi.fn(async () => ({ ok: true })),
    },
    uilib: {
      list: vi.fn(async () => ({
        ok: true,
        items: [{ id: 'uilib-1', name: 'Vant', version: '4.9.0', css: [], js: [] }],
      })),
      save: vi.fn(async (payload: unknown) => ({
        ok: true,
        item: { id: 'uilib-new', ...(payload as Record<string, unknown>) },
      })),
    },
    projectBinding: {
      get: vi.fn(async () => ({
        ok: true,
        binding: {
          specId: 'spec-1',
          specName: '默认规范',
          uiLibId: 'uilib-1',
          uiLibName: 'Vant',
          updatedAt: 10,
        },
      })),
      set: vi.fn(async (payload: unknown) => {
        const p = payload as { project?: string; specId?: string; uiLibId?: string };
        return {
          ok: true,
          binding: {
            specId: p.specId ?? '',
            specName: p.specId ? '默认规范' : '',
            uiLibId: p.uiLibId ?? '',
            uiLibName: p.uiLibId ? 'Vant' : '',
            updatedAt: 20,
          },
        };
      }),
    },
    sandbox: {
      list: vi.fn(async () => ({
        root: 'D:/sandbox',
        project: '',
        projects: [],
        folders: [],
      })),
    },
    app: {
      getVersion: vi.fn(async () => '9.9.9'),
    },
  };
}

function installApi(api: unknown): void {
  Object.defineProperty(window, 'protoAPI', {
    value: api,
    configurable: true,
    writable: true,
  });
}

function resetStore(): void {
  useSettingsStore.setState({
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
  });
}

beforeEach(() => {
  resetStore();
  try {
    delete (window as unknown as { protoAPI?: unknown }).protoAPI;
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
});

describe('settings-store load：真实数据接线', () => {
  it('拉齐 check/config/models/spec/uilib/binding/sandbox/version 并派生当前 Agent', async () => {
    const api = makeApi();
    installApi(api);

    await useSettingsStore.getState().load('proj-a');
    const s = useSettingsStore.getState();

    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.project).toBe('proj-a');

    // Agent 行完全来自 ai.checkCli，不补 DEFAULT_AGENTS 假数据。
    expect(s.agents.map((a) => a.id)).toEqual(['qoder', 'opencode', 'agy', 'codebuddy']);
    expect(s.agents.find((a) => a.id === 'opencode')?.enabled).toBe(true);
    expect(s.agents.find((a) => a.id === 'qoder')?.enabled).toBe(false);
    expect(s.agents.find((a) => a.id === 'agy')?.available).toBe(false);

    expect(s.config?.agentId).toBe('opencode');
    expect(s.engine).toBe('cli');
    expect(s.acp.enabled).toBe(true);
    expect(s.acp.defaultPermissionMode).toBe('approve-reads');

    expect(s.modelGroups).toEqual(GROUPS);
    expect(s.allGroups).toEqual(ALL_GROUPS);
    expect(s.defaultModel).toBe('m-1');
    expect(s.visibleModels).toEqual(['m-1']);

    expect(s.specs.map((x) => x.id)).toEqual(['spec-1']);
    expect(s.uiLibs.map((x) => x.id)).toEqual(['uilib-1']);
    expect(s.binding.specId).toBe('spec-1');
    expect(s.binding.uiLibId).toBe('uilib-1');
    expect(s.sandboxRoot).toBe('D:/sandbox');
    expect(s.version).toBe('9.9.9');

    expect(api.ai.listModels).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'cli' }),
    );
    expect(api.projectBinding.get).toHaveBeenCalledWith('proj-a');
    expect(api.spec.list).toHaveBeenCalled();
    expect(api.uilib.list).toHaveBeenCalled();
    expect(api.sandbox.list).toHaveBeenCalledWith();
    expect(api.app.getVersion).toHaveBeenCalled();
  });

  it('API 引擎的 visibleModels 来自 config.visibleModelsApi', async () => {
    const api = makeApi({
      config: {
        ...BASE_CONFIG,
        engine: 'api',
        mode: 'api',
        providerType: 'api',
        visibleModelsCli: null,
        visibleModelsApi: ['api-1', 'api-2'],
      },
      models: {
        groups: [{ provider: 'deepseek', label: 'DeepSeek', models: ['api-1', 'api-2', 'api-3'] }],
        allGroups: [
          { provider: 'deepseek', label: 'DeepSeek', models: ['api-1', 'api-2', 'api-3'] },
        ],
      },
    });
    installApi(api);

    await useSettingsStore.getState().load('proj-a');
    const s = useSettingsStore.getState();

    expect(s.engine).toBe('api');
    expect(s.visibleModels).toEqual(['api-1', 'api-2']);
    expect(api.ai.listModels).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'api' }),
    );
  });

  it('ai.check 返回空 agents 时保持空态，不编造四行', async () => {
    const api = makeApi({ agents: [] });
    installApi(api);

    await useSettingsStore.getState().load('proj-a');
    const s = useSettingsStore.getState();

    expect(s.agents).toEqual([]);
    expect(s.loading).toBe(false);
  });

  it('无 protoAPI 网关时收敛为错误文案，不抛错', async () => {
    await useSettingsStore.getState().load('proj-a');
    const s = useSettingsStore.getState();

    expect(s.loading).toBe(false);
    expect(s.error).toContain('window.protoAPI');
    expect(s.agents).toEqual([]);
    expect(s.specs).toEqual([]);
  });
});

describe('settings-store save：写回 ai.saveConfig / projectBinding.set / spec.*', () => {
  it('visibleModels 写回 config 的全局字段 + 当前 Agent 的 visibleModelsCli', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const r = await useSettingsStore.getState().save({ visibleModels: ['m-1', 'm-2'] });
    expect(r.ok).toBe(true);

    const calls = api.ai.saveConfig.mock.calls;
    const payload = calls[calls.length - 1]?.[0] as AiConfig;
    expect(payload.visibleModels).toEqual(['m-1', 'm-2']);
    expect(payload.visibleModelsCli).toEqual({ opencode: ['m-1', 'm-2'] });
    expect(useSettingsStore.getState().visibleModels).toEqual(['m-1', 'm-2']);
  });

  it('项目绑定走 projectBinding.set 并回写 binding', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const r = await useSettingsStore.getState().save({ binding: { specId: 'spec-2' } });
    expect(r.ok).toBe(true);
    expect(api.projectBinding.set).toHaveBeenCalledWith({
      project: 'proj-a',
      specId: 'spec-2',
    });
    expect(useSettingsStore.getState().binding.specId).toBe('spec-2');
  });

  it('切换 Agent 会写 agentId/mainAgent，并把 enabled 派生到新 Agent', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const r = await useSettingsStore.getState().save({
      config: { agentId: 'qoder', mainAgent: 'qoder' },
    });
    expect(r.ok).toBe(true);
    const s = useSettingsStore.getState();
    expect(s.config?.agentId).toBe('qoder');
    expect(s.agents.find((a) => a.id === 'qoder')?.enabled).toBe(true);
    expect(s.agents.find((a) => a.id === 'opencode')?.enabled).toBe(false);
  });

  it('spec 新增/删除走 spec.* 并刷新规范列表', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const created = await useSettingsStore.getState().save({
      spec: {
        action: 'createFromText',
        payload: { name: '新规范', content: '# 新规范' },
      },
    });
    expect(created.ok).toBe(true);
    expect(api.spec.createFromText).toHaveBeenCalledWith({
      name: '新规范',
      content: '# 新规范',
    });

    const removed = await useSettingsStore.getState().save({
      spec: { action: 'remove', payload: { id: 'spec-1' } },
    });
    expect(removed.ok).toBe(true);
    expect(api.spec.remove).toHaveBeenCalledWith({ id: 'spec-1' });
    // 删除当前绑定规范时同步清空项目绑定。
    expect(api.projectBinding.set).toHaveBeenCalledWith({
      project: 'proj-a',
      specId: '',
    });
  });

  it('API 直连配置写回 ai.saveConfig 的 engine/byok 段', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const r = await useSettingsStore.getState().save({
      config: {
        engine: 'api',
        byok: {
          protocol: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
        },
        api: {
          protocol: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
        },
      },
    });
    expect(r.ok).toBe(true);

    const calls = api.ai.saveConfig.mock.calls;
    const payload = calls[calls.length - 1]?.[0] as AiConfig;
    expect(payload.engine).toBe('api');
    expect(payload.byok).toEqual({
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    expect(payload.api).toEqual({
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });

    const s = useSettingsStore.getState();
    expect(s.engine).toBe('api');
    expect(s.config?.byok).toEqual({
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
  });

  it('API 引擎下 visibleModels 写入 visibleModelsApi，不污染 CLI 映射', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const r = await useSettingsStore.getState().save({
      config: { engine: 'api' },
      visibleModels: ['api-1', 'api-2'],
    });
    expect(r.ok).toBe(true);

    const calls = api.ai.saveConfig.mock.calls;
    const payload = calls[calls.length - 1]?.[0] as AiConfig;
    expect(payload.visibleModelsApi).toEqual(['api-1', 'api-2']);
    expect(payload.visibleModelsCli).toEqual({ opencode: ['m-1'] });
    expect(useSettingsStore.getState().visibleModels).toEqual(['api-1', 'api-2']);
  });

  it('uilib.save 走真实通道并刷新 UI 库列表', async () => {
    const api = makeApi();
    installApi(api);
    await useSettingsStore.getState().load('proj-a');

    const r = await useSettingsStore.getState().save({
      uiLib: { name: 'Element Plus', css: ['https://cdn/x.css'], js: [] },
    });
    expect(r.ok).toBe(true);
    expect(api.uilib.save).toHaveBeenCalledWith({
      name: 'Element Plus',
      css: ['https://cdn/x.css'],
      js: [],
    });
    expect(api.uilib.list).toHaveBeenCalledTimes(2);
  });
});

describe('pickVisibleModels：与旧 getFetchVisible/getCliVisibleIds 对齐', () => {
  it('API：null=未落盘全选，[]=明确全不选', () => {
    expect(pickVisibleModels({ visibleModelsApi: null }, 'api', 'opencode')).toBeNull();
    expect(pickVisibleModels({ visibleModelsApi: [] }, 'api', 'opencode')).toEqual([]);
    expect(pickVisibleModels({ visibleModelsApi: ['a'] }, 'api', 'opencode')).toEqual(['a']);
  });

  it('CLI：按当前 Agent 取映射，缺 key 为空数组', () => {
    expect(
      pickVisibleModels({ visibleModelsCli: { opencode: ['a'] } }, 'cli', 'opencode'),
    ).toEqual(['a']);
    expect(pickVisibleModels({ visibleModelsCli: {} }, 'cli', 'qoder')).toEqual([]);
    expect(pickVisibleModels({ visibleModelsCli: ['x'] }, 'cli', 'qoder')).toEqual(['x']);
    expect(pickVisibleModels({}, 'cli', 'qoder')).toEqual([]);
  });
});

describe('AgentMatrix 徽章：transport 与 acp.supported 去重（UI 契约）', () => {
  const agents = [
    {
      id: 'opencode',
      name: 'OpenCode CLI',
      available: true,
      enabled: false,
      transport: 'acp',
      acp: { supported: true },
    },
    {
      id: 'claude',
      name: 'Claude Code',
      available: true,
      enabled: false,
      transport: 'cli',
      acp: { supported: true },
    },
    {
      id: 'deepseek',
      name: 'DeepSeek Harness',
      available: true,
      enabled: false,
      transport: 'api',
    },
    {
      id: 'agy',
      name: 'Agy',
      available: true,
      enabled: false,
      transport: 'ACP',
      acp: { supported: false },
    },
  ];

  it('transport=acp 且 acp.supported=true 时只渲染一个 ACP 徽章', () => {
    render(React.createElement(AgentMatrix, { agents }));
    const row = within(screen.getByTestId('agent-row-opencode'));

    expect(row.getAllByText('ACP')).toHaveLength(1);
    expect(row.queryByText('acp')).toBeNull();
  });

  it('cli/api 等其他 transport 仍显示自身徽章，ACP 能力徽章不受影响', () => {
    render(React.createElement(AgentMatrix, { agents }));
    const cliRow = within(screen.getByTestId('agent-row-claude'));
    const apiRow = within(screen.getByTestId('agent-row-deepseek'));

    expect(cliRow.getByText('cli')).toBeTruthy();
    expect(cliRow.getAllByText('ACP')).toHaveLength(1);
    expect(apiRow.getByText('api')).toBeTruthy();
    expect(apiRow.queryByText('ACP')).toBeNull();
  });

  it('transport 大小写不敏感：ACP 不会再叠加能力徽章', () => {
    render(React.createElement(AgentMatrix, { agents }));
    const row = within(screen.getByTestId('agent-row-agy'));

    expect(row.getAllByText('ACP')).toHaveLength(1);
    expect(row.queryByText('acp')).toBeNull();
  });
});
