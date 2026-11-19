/**
 * src/renderer/stores/__tests__/settings-store.test.ts — 设置保存 × 思考强度缓存预热
 *
 * 只覆盖本轮「主进程后台缓存 + 启动预热」相关行为：
 * - 保存成功（config / 可见模型 / 引擎任一变化）后 fire-and-forget 调
 *   ai.listModels({probeModel, agentId, background:true})；
 * - 该调用不 await：后台探测卡住也不能阻塞保存返回；
 * - api 引擎不预热（ACP 只服务 CLI）；
 * - pickProbeModel 取值优先级：config.model → 可见模型首个 → 目录默认值。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickProbeModel, useSettingsStore, defaultAcpConfig } from '../settings-store';

type AnyFn = (...args: unknown[]) => unknown;

const CLI_CONFIG = {
  engine: 'cli' as const,
  agentId: 'opencode',
  mainAgent: 'opencode',
  visibleModelsCli: { opencode: ['model-a'] },
  visibleModels: [],
  acp: { enabled: true, defaultPermissionMode: 'approve-reads' as const, agents: {} },
};

/**
 * 安装最小 protoAPI：saveConfig 回显配置，listModels 区分「目录」与「probe」两种调用。
 * @param probe listModels 收到 probe 提示时的返回值工厂
 * @returns 记录所有 listModels 调用的数组
 */
function installApi(probe: () => unknown): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  const listModels = vi.fn(async (hint: unknown) => {
    const h = (hint && typeof hint === 'object' ? hint : {}) as Record<string, unknown>;
    calls.push(h);
    if (h.probeModel) return probe();
    return {
      ok: true,
      groups: [{ label: 'OpenCode', models: ['model-a', 'model-b'] }],
      allGroups: [{ label: 'OpenCode', models: ['model-a', 'model-b'] }],
      default: 'model-b',
    };
  });
  const saveConfig = vi.fn(async (cfg: unknown) => ({ ok: true, config: cfg }));
  Object.defineProperty(window, 'protoAPI', {
    value: { ai: { listModels, saveConfig } },
    configurable: true,
    writable: true,
  });
  return calls;
}

/**
 * 取出真正带 probeModel 的调用。
 * @param calls listModels 调用记录
 * @returns probe 调用参数（无则 undefined）
 */
function probeCall(calls: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  return calls.find((c) => typeof c.probeModel === 'string' && c.probeModel);
}

beforeEach(() => {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
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
    binding: { specId: '', specName: '', uiLibId: '', uiLibName: '', updatedAt: 0 },
    sandboxRoot: '',
    version: '',
    project: '项目A',
    loading: false,
    error: null,
  });
});

describe('settings-store: 保存后预热思考强度缓存', () => {
  it('保存成功 → 以 background:true 预探测当前模型（不新增通道）', async () => {
    const calls = installApi(() => ({ ok: true, probe: true, status: 'probing', configOptions: [] }));
    const result = await useSettingsStore.getState().save({ config: CLI_CONFIG });

    expect(result.ok).toBe(true);
    const probe = probeCall(calls);
    expect(probe).toBeTruthy();
    expect(probe).toMatchObject({
      engine: 'cli',
      probeModel: 'model-a',
      agentId: 'opencode',
      background: true,
    });
    /* 目录调用仍只有一次，预热复用同一 ai:models 通道 */
    expect(calls.filter((c) => !c.probeModel)).toHaveLength(1);
  });

  it('后台探测卡住也不阻塞保存返回', async () => {
    let release: ((v: unknown) => void) | null = null;
    const calls = installApi(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const started = Date.now();
    const result = await useSettingsStore.getState().save({ visibleModels: ['model-a'] });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(probeCall(calls)).toBeTruthy();
    expect(elapsed).toBeLessThan(1000);
    /* 收尾悬挂的探测 promise，避免影响后续用例 */
    const done = release as ((v: unknown) => void) | null;
    if (done) done({ ok: true });
  });

  it('api 引擎不触发预热（ACP 只服务 CLI）', async () => {
    const calls = installApi(() => ({ ok: true, probe: true, status: 'probing', configOptions: [] }));
    const result = await useSettingsStore
      .getState()
      .save({ config: { engine: 'api', agentId: 'opencode' } });

    expect(result.ok).toBe(true);
    expect(probeCall(calls)).toBeUndefined();
  });

  it('pickProbeModel：config.model → 可见首个 → 默认值', () => {
    expect(pickProbeModel({ model: 'explicit' }, ['visible'], 'fallback')).toBe('explicit');
    expect(pickProbeModel({}, ['visible'], 'fallback')).toBe('visible');
    expect(pickProbeModel({}, null, 'fallback')).toBe('fallback');
    expect(pickProbeModel(null, [], '')).toBe('');
  });
});
