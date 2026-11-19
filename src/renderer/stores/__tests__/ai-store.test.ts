/**
 * src/renderer/stores/__tests__/ai-store.test.ts — W3-07 AI 上下文与持久化单测。
 *
 * 覆盖：
 * - sendMessage 的 ai:ask 载荷：sandboxDir/targetFile/uiKind/activePage 来自 sources-store；
 *   opts.activePage 非空时覆盖自动解析的作用页，缺省仍走自动解析；
 *   engine 来自 settings-store；acpConfig/reasoning 同源。
 * - ai_model / ai_model_reasoning 的读写与 __none__/default/空 删键语义。
 * - ai_sessions_v2_* + ai_hist_* 落盘 / 启动恢复 / 空状态不清空旧数据。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MODEL_KEY,
  AI_REASONING_KEY,
  aiHistKey,
  readJson,
  readText,
  sessStoreKey,
  writeJson,
  writeText,
} from '@/lib/storage-keys';
import {
  createAiStore,
  readStoredModel,
  readStoredReasoning,
  storeModel,
  storeReasoning,
  type AiStore,
} from '../ai-store';
import { useSourcesStore, type SourceRef } from '../sources-store';
import { useSettingsStore } from '../settings-store';
import { useAppStore } from '../app-store';
import { parseSessionsFile } from '@/features/ai/adapters';

type AnyFn = (...args: unknown[]) => unknown;

const DIR = '/sandbox/项目A/登录页';

function source(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    name: '登录页.html',
    displayName: '登录页',
    kind: 'pc',
    sandboxDir: DIR,
    mainHtmlFile: '登录页.html',
    mdFile: '登录页.md',
    subPages: [{ file: '详情.html', name: '详情' }],
    htmlFiles: ['登录页.html', '详情.html'],
    content: '<a href="#page-chat">聊天</a><a href="#page-list">列表</a>',
    md: '# 登录页',
    pages: ['page-chat', 'page-list'],
    __ver: 1,
    activeSubFile: '登录页.html',
    activeContent: '',
    ...overrides,
  };
}

function installApi(ask: AnyFn): void {
  const api = { ai: { ask: vi.fn(ask) } };
  Object.defineProperty(window, 'protoAPI', {
    value: api,
    configurable: true,
    writable: true,
  });
}

function installListModels(listModels: AnyFn): ReturnType<typeof vi.fn> {
  const fn = vi.fn(listModels);
  Object.defineProperty(window, 'protoAPI', {
    value: { ai: { listModels: fn } },
    configurable: true,
    writable: true,
  });
  return fn;
}

function thoughtConfig(
  id: string,
  currentValue: string,
  values: Array<{ value: string; name: string }>,
): Record<string, unknown> {
  return {
    id,
    name: id,
    category: id === 'effort' ? 'thought_level' : 'thought_level',
    type: 'select',
    currentValue,
    options: values,
  };
}

function resetStores(): void {
  localStorage.clear();
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
  useSourcesStore.setState({
    project: '',
    projects: [],
    sources: [],
    currentSource: null,
    activeSubFile: '',
    activeContent: '',
    loading: false,
    error: '',
    pickerOpen: false,
  });
  useAppStore.setState({ project: '', proto: '', page: '', kind: 'pc' });
  useSettingsStore.setState({
    agents: [],
    config: null,
    modelGroups: [],
    allGroups: [],
    defaultModel: '',
    visibleModels: null,
    engine: 'cli',
    acp: { enabled: false, defaultPermissionMode: 'approve-reads', agents: {} },
    specs: [],
    uiLibs: [],
    binding: { specId: '', specName: '', uiLibId: '', uiLibName: '', updatedAt: 0 },
    sandboxRoot: '',
    version: '',
    project: '',
    loading: false,
    error: null,
  });
}

function setSource(src: SourceRef | null, activeSubFile = '', activeContent = ''): void {
  useSourcesStore.setState({
    project: '项目A',
    sources: src ? [src] : [],
    currentSource: src,
    activeSubFile: activeSubFile || (src ? src.mainHtmlFile : ''),
    activeContent,
  });
}

const openStores: AiStore[] = [];

function makeStore(): AiStore {
  const store = createAiStore();
  openStores.push(store);
  return store;
}

beforeEach(() => {
  resetStores();
  try {
    window.history.replaceState(null, '', '/');
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  while (openStores.length) openStores.pop()!.dispose();
});

describe('ai-store: sendMessage 载荷（W3-07 / C8）', () => {
  it('sandboxDir/targetFile/uiKind/activePage 来自当前源，engine 来自 settings-store', async () => {
    setSource(source(), '详情.html');
    useSettingsStore.setState({
      config: { engine: 'api' },
      engine: 'api',
      modelGroups: [],
      visibleModels: null,
    });
    window.history.replaceState(null, '', '#page-list');

    let captured: unknown[] = [];
    installApi(async (...args: unknown[]) => {
      captured = args;
      return { ok: true, success: true, pid: 1 };
    });

    const store = makeStore();
    store.loadHistory(DIR);
    store.setModel('m-2');
    store.dispatch({
      type: 'set-acp',
      thoughtConfigId: 'thought_level',
      thinkingLevel: 'high',
      options: [
        { value: 'low', label: '低', title: '低' },
        { value: 'high', label: '高', title: '高' },
      ],
      config: {},
      warnings: [],
    });
    store.setThinking('low');

    const r = await store.sendMessage('生成登录页');
    expect(r.ok).toBe(true);

    expect(captured[0]).toBe('生成登录页');
    expect(captured[2]).toBe(DIR);
    expect(captured[3]).toBe('m-2');
    const extra = captured[4] as Record<string, unknown>;
    expect(extra.engine).toBe('api');
    expect(extra.targetFile).toBe('详情.html');
    expect(extra.uiKind).toBe('pc');
    expect(extra.activePage).toBe('page-list');
    // acpConfig 与 reasoning 同源（同一次选择），不是两份互相打架的值。
    expect(extra.reasoning).toBe('low');
    expect(extra.acpConfig).toEqual({ thought_level: 'low' });
    expect(extra.freshSession).toBe(true);
    expect(extra.enableTools).toBe(true);
  });

  it('opts.activePage 非空时覆盖自动解析；空/缺省仍用自动值', async () => {
    setSource(source());
    useSettingsStore.setState({ config: { engine: 'cli' }, engine: 'cli' });
    // 自动解析命中 hash：page-list。
    window.history.replaceState(null, '', '#page-list');

    let captured: unknown[] = [];
    installApi(async (...args: unknown[]) => {
      captured = args;
      return { ok: true };
    });

    const store = makeStore();
    store.loadHistory(DIR);

    await store.sendMessage('指定作用页', { activePage: 'page-chat' });
    expect((captured[4] as Record<string, unknown>).activePage).toBe('page-chat');

    // 空白等同未选：回退自动解析，不覆盖成空串。
    store.dispatch({ type: 'set-busy', busy: false });
    await store.sendMessage('空白作用页', { activePage: '   ' });
    expect((captured[4] as Record<string, unknown>).activePage).toBe('page-list');

    // 不传 opts：保持原单参调用口径，仍走自动解析。
    store.dispatch({ type: 'set-busy', busy: false });
    await store.sendMessage('缺省作用页');
    expect((captured[4] as Record<string, unknown>).activePage).toBe('page-list');
  });

  it('子页激活时 activePage 从子页内容解析；无源时用舞台端别而非 mobile', async () => {
    const sub = '<a href="#detail/1">详情</a>';
    setSource(source(), '详情.html', sub);
    useSettingsStore.setState({ config: { engine: 'cli' }, engine: 'cli' });
    window.history.replaceState(null, '', '/');

    let captured: unknown[] = [];
    installApi(async (...args: unknown[]) => {
      captured = args;
      return { ok: true };
    });

    const store = makeStore();
    store.loadHistory(DIR);
    await store.sendMessage('补一个详情页');
    const extra = captured[4] as Record<string, unknown>;
    expect(extra.uiKind).toBe('pc');
    expect(extra.targetFile).toBe('详情.html');
    expect(extra.activePage).toBe('detail/1');

    // 无当前源：uiKind 用 app-store 舞台端别（真实状态），不写死 mobile。
    setSource(null);
    useAppStore.setState({ kind: 'mobile', page: 'page-x' });
    store.dispatch({ type: 'set-busy', busy: false }); // 首轮任务未收到 done 事件，先复位
    await store.sendMessage('没有原型时');
    const extra2 = captured[4] as Record<string, unknown>;
    expect(captured[2]).toBe('');
    expect(extra2.uiKind).toBe('mobile');
    expect(extra2.activePage).toBe('page-x');
  });
});

describe('ai-store: 模型 / 思考持久化（ai_model / ai_model_reasoning）', () => {
  it('setModel / setThinking 写键，新实例启动恢复', () => {
    const store = makeStore();
    store.setModel('m-9');
    store.setThinking('high');
    expect(readText(AI_MODEL_KEY)).toBe('m-9');
    expect(readText(AI_REASONING_KEY)).toBe('high');

    const restored = makeStore();
    expect(restored.getState().modelId).toBe('m-9');
    expect(restored.getState().thinkingLevel).toBe('high');
  });

  it('__none__/default/空 删键（读写两侧）', () => {
    storeModel('m-1');
    expect(readStoredModel()).toBe('m-1');

    storeModel('__none__');
    expect(readText(AI_MODEL_KEY)).toBeNull();
    storeModel('default');
    expect(readText(AI_MODEL_KEY)).toBeNull();
    storeModel('');
    expect(readText(AI_MODEL_KEY)).toBeNull();

    // 读侧：历史脏值 __none__/default 视为未选并删键。
    writeText(AI_MODEL_KEY, 'default');
    expect(readStoredModel()).toBe('');
    expect(readText(AI_MODEL_KEY)).toBeNull();
    writeText(AI_MODEL_KEY, '__none__');
    expect(readStoredModel()).toBe('');
    expect(readText(AI_MODEL_KEY)).toBeNull();

    // 思考键：空串回落 default。
    writeText(AI_REASONING_KEY, '');
    expect(readStoredReasoning()).toBe('default');
    storeReasoning('low');
    expect(readText(AI_REASONING_KEY)).toBe('low');
  });

  it('模型切换重置 thinking 时两键一起更新（不残留旧档位）', () => {
    const store = makeStore();
    store.setThinking('high');
    store.setModel('m-2');
    expect(store.getState().thinkingLevel).toBe('default');
    expect(readText(AI_REASONING_KEY)).toBe('default');
  });
});

describe('ai-store: 会话/历史持久化（ai_sessions_v2_* + ai_hist_*）', () => {
  it('发送后落盘，新实例启动恢复会话与消息', async () => {
    setSource(source());
    useSettingsStore.setState({ config: { engine: 'cli' }, engine: 'cli' });
    installApi(async () => ({ ok: true }));

    const store = makeStore();
    store.loadHistory(DIR);
    await store.sendMessage('你好，世界');
    store.flushPersist();

    const parsed = parseSessionsFile(readJson(sessStoreKey(DIR), null))!;
    expect(parsed.sessions).toHaveLength(1);
    const sid = parsed.activeSessionId;
    expect(sid).toBeTruthy();
    expect(parsed.messages[sid!].some((m) => m.role === 'user' && m.text === '你好，世界')).toBe(true);
    expect(parsed.sessions[0].title).toContain('你好');

    // 旧读取口径同步字段：会话 oid/activeId 与 ai_hist_* 单会话。
    const rawFile = readJson(sessStoreKey(DIR), null) as {
      activeId: string;
      sessions: Record<string, { m: Array<{ r: string; t: string }> }>;
    };
    expect(rawFile.activeId).toBe(sid);
    expect(rawFile.sessions[sid!].m.some((m) => m.r === 'u' && m.t === '你好，世界')).toBe(true);
    const hist = parseSessionsFile(readJson(aiHistKey(DIR), null))!;
    expect(hist.sessions[0].id).toBe(sid);

    const restored = makeStore();
    restored.loadHistory(DIR);
    const state = restored.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(sid);
    expect(state.messages[sid!].some((m) => m.role === 'user' && m.text === '你好，世界')).toBe(true);
  });

  it('切目录：旧目录落盘、新目录恢复独立会话', async () => {
    const otherDir = '/sandbox/项目A/首页';
    setSource(source());
    useSettingsStore.setState({ config: { engine: 'cli' }, engine: 'cli' });
    installApi(async () => ({ ok: true }));

    const store = makeStore();
    store.loadHistory(DIR);
    await store.sendMessage('登录页对话');

    store.flushPersist();
    store.loadHistory(otherDir);
    expect(store.getState().sessions).toHaveLength(0);
    expect(store.getLoadedDir()).toBe(otherDir);

    store.dispatch({ type: 'set-busy', busy: false });
    await store.sendMessage('首页对话');
    store.flushPersist();

    store.loadHistory(DIR);
    const login = store.getState();
    expect(login.messages[login.activeSessionId!].some((m) => m.text === '登录页对话')).toBe(true);

    store.loadHistory(otherDir);
    const home = store.getState();
    expect(home.messages[home.activeSessionId!].some((m) => m.text === '首页对话')).toBe(true);
  });

  it('空状态 flush 不覆盖已有历史（读取失败不清空用户数据）', () => {
    const sentinel = {
      activeId: 'keep',
      sessions: {
        keep: { id: 'keep', title: '保留会话', createdAt: 1, updatedAt: 2, m: [] },
      },
    };
    writeJson(sessStoreKey(DIR), sentinel);
    setSource(source());

    const empty = makeStore(); // 不 loadHistory，状态为空
    empty.flushPersist();
    expect(readJson(sessStoreKey(DIR), null)).toEqual(sentinel);

    // loadHistory 能恢复 sentinel。
    empty.loadHistory(DIR);
    expect(empty.getState().sessions.map((s) => s.id)).toEqual(['keep']);
  });
});

describe('ai-store: 流式 chunk 合并（一词一气泡回归）', () => {
  function storeWithSession(): { store: AiStore; sid: string } {
    const store = makeStore();
    const s = store.ensureActiveSession();
    return { store, sid: s.id };
  }

  it('run_started + 3 chunks + done → 1 条消息，文本完整、busy 复位', () => {
    const { store, sid } = storeWithSession();
    store.handleEvent({ type: 'run_started', engine: 'cli' });
    expect(store.getState().busy).toBe(true);
    store.handleEvent({ type: 'chunk', text: '调整' });
    store.handleEvent({ type: 'chunk', text: '功能' });
    store.handleEvent({ type: 'chunk', text: '说明' });
    store.handleEvent({ type: 'done' });

    const list = store.getState().messages[sid];
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('assistant');
    expect(list[0].kind).toBe('text');
    expect(list[0].text).toBe('调整功能说明');
    expect(list[0].streaming).toBe(false);
    expect(store.getState().busy).toBe(false);
  });

  it('纯空格/换行保留（store 的 append-messages 不再 trim）', () => {
    const { store, sid } = storeWithSession();
    store.handleEvent({ type: 'chunk', text: 'hello' });
    store.handleEvent({ type: 'chunk', text: ' ' });
    store.handleEvent({ type: 'chunk', text: 'world' });
    store.handleEvent({ type: 'chunk', text: '\n\n' });
    store.handleEvent({ type: 'chunk', text: 'next' });
    const list = store.getState().messages[sid];
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('hello world\n\nnext');
  });

  it('两个 run → 2 条消息，不跨轮拼接', () => {
    const { store, sid } = storeWithSession();
    store.handleEvent({ type: 'run_started', engine: 'cli' });
    store.handleEvent({ type: 'chunk', text: '第一' });
    store.handleEvent({ type: 'chunk', text: '轮' });
    store.handleEvent({ type: 'done' });
    store.handleEvent({ type: 'run_started', engine: 'cli' });
    store.handleEvent({ type: 'chunk', text: '第二' });
    store.handleEvent({ type: 'chunk', text: '轮' });
    store.handleEvent({ type: 'done' });

    const list = store.getState().messages[sid];
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.text)).toEqual(['第一轮', '第二轮']);
    expect(list[0].streamId).not.toBe(list[1].streamId);
  });

  it('messageId 保留并作为 streamId（同一 ACP 消息只出一条）', () => {
    const { store, sid } = storeWithSession();
    store.handleEvent({ type: 'run_started', engine: 'cli' });
    store.handleEvent({ type: 'chunk', messageId: 'acp-msg-1', text: '调整' });
    store.handleEvent({ type: 'chunk', messageId: 'acp-msg-1', text: '功能' });
    store.handleEvent({ type: 'chunk', messageId: 'acp-msg-1', text: '说明' });
    store.handleEvent({ type: 'done' });

    const list = store.getState().messages[sid];
    expect(list).toHaveLength(1);
    expect(list[0].messageId).toBe('acp-msg-1');
    expect(list[0].streamId).toBe('text:msg:acp-msg-1');
    expect(list[0].text).toBe('调整功能说明');
  });

  it('工具卡打断文本段：text / tool / text 三条，顺序不变', () => {
    const { store, sid } = storeWithSession();
    store.handleEvent({ type: 'chunk', text: '前' });
    store.handleEvent({ type: 'tool_call', tool: 'read', title: 'Read', toolCallId: 't1' });
    store.handleEvent({ type: 'chunk', text: '后' });
    const list = store.getState().messages[sid];
    expect(list.map((m) => m.kind)).toEqual(['text', 'tool_call', 'text']);
    expect(list.map((m) => m.text)).toEqual(['前', 'Read', '后']);
  });

  it('3 chunks 持久化 → 恢复仍是 1 条完整消息', () => {
    const store = makeStore();
    store.loadHistory(DIR);
    const s = store.ensureActiveSession();
    store.handleEvent({ type: 'run_started', engine: 'cli' });
    store.handleEvent({ type: 'chunk', text: '调整' });
    store.handleEvent({ type: 'chunk', text: '功能' });
    store.handleEvent({ type: 'chunk', text: '说明' });
    store.handleEvent({ type: 'done' });
    store.flushPersist();

    const parsed = parseSessionsFile(readJson(sessStoreKey(DIR), null))!;
    expect(parsed.messages[s.id]).toHaveLength(1);
    expect(parsed.messages[s.id][0].text).toBe('调整功能说明');

    const restored = makeStore();
    restored.loadHistory(DIR);
    expect(restored.getState().messages[s.id]).toHaveLength(1);
    expect(restored.getState().messages[s.id][0].text).toBe('调整功能说明');
    expect(restored.getState().messages[s.id][0].streaming).toBe(false);
  });

  it('旧历史（一词一条 chunk）恢复时合并为 1 条', () => {
    writeJson(sessStoreKey(DIR), {
      activeId: 'old-stream',
      sessions: {
        'old-stream': {
          id: 'old-stream',
          title: '旧会话',
          createdAt: 1,
          updatedAt: 2,
          msgs: [
            { key: 'u1', role: 'user', kind: 'text', text: '你好', ts: 1, sourceType: 'local' },
            { key: 'c1', role: 'assistant', kind: 'text', text: '调整', ts: 2, sourceType: 'chunk' },
            { key: 'c2', role: 'assistant', kind: 'text', text: '功能', ts: 3, sourceType: 'chunk' },
            { key: 'c3', role: 'assistant', kind: 'text', text: '说明', ts: 4, sourceType: 'chunk' },
          ],
        },
      },
    });
    const store = makeStore();
    store.loadHistory(DIR);
    const list = store.getState().messages['old-stream'];
    expect(list).toHaveLength(2);
    expect(list[0].text).toBe('你好');
    expect(list[1].text).toBe('调整功能说明');
    expect(list[1].key).toBe('c1');
  });

  it('一轮 300 个 chunk 合并后仍只有 1 条（不挤掉旧对话配额）', () => {
    const { store, sid } = storeWithSession();
    store.handleEvent({ type: 'run_started', engine: 'cli' });
    for (let i = 0; i < 300; i++) store.handleEvent({ type: 'chunk', text: 'x' });
    store.handleEvent({ type: 'done' });
    const list = store.getState().messages[sid];
    expect(list).toHaveLength(1);
    expect(list[0].text).toHaveLength(300);
  });
});

describe('ai-store: 思考档位预探测（probeThinking）', () => {
  const MODEL = 'opencode-go/deepseek-v4.1-flash';
  const OPTIONS = [
    { value: 'low', name: 'Low' },
    { value: 'high', name: 'High' },
    { value: 'max', name: 'Max' },
    { value: 'default', name: 'Default' },
  ];

  function setupAgent(): void {
    setSource(source());
    useSettingsStore.setState({
      config: { engine: 'cli', agentId: 'opencode' },
      engine: 'cli',
      agents: [
        { id: 'opencode', name: 'OpenCode CLI', available: true, enabled: true },
      ],
    });
  }

  it('setModel 触发一次 ai.listModels({probeModel})，选项文案取 name', async () => {
    setupAgent();
    const calls: Array<Record<string, unknown>> = [];
    const fn = installListModels(async (hint: unknown) => {
      calls.push(hint as Record<string, unknown>);
      return {
        ok: true,
        model: MODEL,
        configOptions: [thoughtConfig('effort', 'high', OPTIONS)],
      };
    });
    const store = makeStore();
    const session = store.ensureActiveSession();
    store.setModel(MODEL);
    await store.probeThinking(MODEL);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      engine: 'cli',
      probeModel: MODEL,
      agentId: 'opencode',
      uiSessionId: session.id,
      cwd: DIR,
    });
    const st = store.getState();
    expect(st.thinkingStatus).toBe('ready');
    expect(st.thinkingOptions.map((o) => o.label)).toEqual(['Low', 'High', 'Max', 'Default']);
    expect(st.thinkingOptions.map((o) => o.value)).toEqual(['low', 'high', 'max', 'default']);
    expect(st.thinkingLevel).toBe('high');
    expect(st.thoughtConfigId).toBe('effort');
    expect(st.thinkingModelId).toBe(MODEL);
  });

  it('agent|session|model 同键复用 in-flight 与成功缓存', async () => {
    setupAgent();
    let release!: (v: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fn = installListModels(() => gate);
    const store = makeStore();
    store.ensureActiveSession();
    // 只设置当前模型（走 reducer，避免 setModel 自动探测干扰计数）。
    store.dispatch({ type: 'set-model', modelId: MODEL });

    const first = store.probeThinking(MODEL);
    const second = store.probeThinking(MODEL);
    expect(fn).toHaveBeenCalledTimes(1);

    release({ ok: true, model: MODEL, configOptions: [thoughtConfig('effort', 'low', OPTIONS)] });
    await Promise.all([first, second]);
    expect(store.getState().thinkingStatus).toBe('ready');

    await store.probeThinking(MODEL);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('主进程命中缓存（cached:true）直接 ready，且不重复探测', async () => {
    setupAgent();
    const fn = installListModels(async () => ({
      ok: true,
      cached: true,
      status: 'ready',
      model: MODEL,
      modelConfigId: 'effort',
      configOptions: [thoughtConfig('effort', 'high', OPTIONS)],
    }));
    const store = makeStore();
    store.ensureActiveSession();
    store.dispatch({ type: 'set-model', modelId: MODEL });

    await store.probeThinking(MODEL);
    const st = store.getState();
    expect(st.thinkingStatus).toBe('ready');
    expect(st.thinkingLevel).toBe('high');
    expect(st.thinkingOptions.map((o) => o.value)).toEqual(['low', 'high', 'max', 'default']);
    expect(fn).toHaveBeenCalledTimes(1);

    /* 同一 Agent/会话/模型：命中渲染层缓存，不再打主进程 */
    await store.probeThinking(MODEL);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('切换 Agent / 会话后按新作用域重新探测', async () => {
    setupAgent();
    const calls: Array<Record<string, unknown>> = [];
    installListModels(async (hint: unknown) => {
      calls.push(hint as Record<string, unknown>);
      return {
        ok: true,
        model: MODEL,
        configOptions: [thoughtConfig('effort', 'high', OPTIONS)],
      };
    });
    const store = makeStore();
    const first = store.ensureActiveSession();
    store.setModel(MODEL);
    await store.probeThinking(MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0].agentId).toBe('opencode');

    // 切 Agent：同一会话/模型也要换 cache key 重新探测。
    useSettingsStore.setState({
      config: { engine: 'cli', agentId: 'codebuddy' },
      agents: [{ id: 'codebuddy', name: 'CodeBuddy', available: true, enabled: true }],
    });
    await store.probeThinking(MODEL);
    expect(calls).toHaveLength(2);
    expect(calls[1].agentId).toBe('codebuddy');

    // 切会话：uiSessionId 进入 cache key，不能复用上一会话结果。
    store.dispatch({
      type: 'ensure-session',
      session: {
        id: 's-second',
        title: '第二会话',
        agentId: '',
        agentName: '',
        agentSessionId: '',
        acpSessionId: '',
        freshSession: true,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    store.switchSession('s-second');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(3);
    expect(calls[2].uiSessionId).toBe('s-second');
    expect(calls[0].uiSessionId).toBe(first.id);
  });

  it('旧模型响应晚到不覆盖当前模型档位', async () => {
    setupAgent();
    const gates = new Map<string, (v: unknown) => void>();
    const fn = installListModels(
      (hint: unknown) =>
        new Promise((resolve) => {
          gates.set(String((hint as Record<string, unknown>).probeModel), resolve);
        }),
    );
    const store = makeStore();
    store.ensureActiveSession();

    store.setModel('m-old');
    const oldProbe = store.probeThinking('m-old');
    store.setModel('m-new');
    const newProbe = store.probeThinking('m-new');
    expect(fn).toHaveBeenCalledTimes(2);

    gates.get('m-new')!({
      ok: true,
      model: 'm-new',
      configOptions: [thoughtConfig('effort', 'high', [{ value: 'high', name: 'High' }])],
    });
    await newProbe;
    expect(store.getState().thinkingOptions.map((o) => o.value)).toEqual(['high']);

    gates.get('m-old')!({
      ok: true,
      model: 'm-old',
      configOptions: [thoughtConfig('effort', 'low', [{ value: 'low', name: 'Low' }])],
    });
    await oldProbe;
    expect(store.getState().modelId).toBe('m-new');
    expect(store.getState().thinkingOptions.map((o) => o.value)).toEqual(['high']);
  });

  it('切换模型立即清空旧档位并标记探测中（不残留上一模型）', () => {
    setupAgent();
    installListModels(() => new Promise(() => {}));
    const store = makeStore();
    store.ensureActiveSession();
    store.dispatch({
      type: 'set-acp',
      thoughtConfigId: 'effort',
      thinkingLevel: 'high',
      options: OPTIONS.map((o) => ({ value: o.value, label: o.name, title: o.name })),
      config: { effort: 'high' },
      warnings: [],
    });
    expect(store.getState().thinkingOptions).toHaveLength(4);

    store.setModel('m-next');
    const st = store.getState();
    expect(st.thinkingOptions).toEqual([]);
    expect(st.thinkingStatus).toBe('probing');
    expect(st.thoughtConfigId).toBe('');
    expect(st.acpConfig).toEqual({});
  });

  it('ACP_MODEL_UNSUPPORTED：明确 unsupported、清空档位、不写全局错误', async () => {
    setupAgent();
    installListModels(async () => ({
      ok: false,
      error: 'ACP_MODEL_UNSUPPORTED',
      availableModels: [],
    }));
    const store = makeStore();
    store.ensureActiveSession();
    store.setModel('qoder/Qwen3.8-Flash');
    await store.probeThinking('qoder/Qwen3.8-Flash');

    const st = store.getState();
    expect(st.thinkingStatus).toBe('unsupported');
    expect(st.thinkingOptions).toEqual([]);
    expect(st.thinkingLevel).toBe('default');
    expect(st.error).toBeNull();
  });

  it('只有 boolean 思考开关不算强度档位', async () => {
    setupAgent();
    installListModels(async () => ({
      ok: true,
      model: 'm-switch',
      configOptions: [
        {
          id: 'thinking',
          category: 'thought_level',
          type: 'boolean',
          currentValue: 'enabled',
          options: [
            { value: 'enabled', name: 'Enabled' },
            { value: 'disabled', name: 'Disabled' },
          ],
        },
      ],
    }));
    const store = makeStore();
    store.ensureActiveSession();
    store.setModel('m-switch');
    await store.probeThinking('m-switch');

    expect(store.getState().thinkingStatus).toBe('unsupported');
    expect(store.getState().thinkingOptions).toEqual([]);
    expect(store.getState().thinkingLevel).toBe('default');
  });

  it('busy 时跳过探测，done 后补探一次', async () => {
    setupAgent();
    const fn = installListModels(async () => ({
      ok: true,
      model: MODEL,
      configOptions: [thoughtConfig('effort', 'low', [{ value: 'low', name: 'Low' }])],
    }));
    const store = makeStore();
    store.ensureActiveSession();
    store.dispatch({ type: 'set-busy', busy: true });
    store.setModel(MODEL);
    expect(fn).not.toHaveBeenCalled();
    expect(store.getState().thinkingStatus).toBe('probing');

    store.handleEvent({ type: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getState().thinkingStatus).toBe('ready');
    expect(store.getState().thinkingOptions.map((o) => o.value)).toEqual(['low']);
  });

  it('acp_config 旧模型事件不覆盖当前模型档位', () => {
    const store = makeStore();
    store.dispatch({ type: 'set-model', modelId: 'm-new' });
    store.dispatch({
      type: 'set-acp',
      thoughtConfigId: 'effort',
      thinkingLevel: 'high',
      options: [{ value: 'high', label: 'High', title: 'High' }],
      config: { effort: 'high' },
      warnings: [],
    });

    store.handleEvent({
      type: 'acp_config',
      model: 'm-old',
      configOptions: [thoughtConfig('effort', 'low', [{ value: 'low', name: 'Low' }])],
    });
    expect(store.getState().thinkingOptions.map((o) => o.value)).toEqual(['high']);

    store.handleEvent({
      type: 'acp_config',
      model: 'm-new',
      configOptions: [thoughtConfig('effort', 'low', [{ value: 'low', name: 'Low' }])],
    });
    expect(store.getState().thinkingOptions.map((o) => o.value)).toEqual(['low']);
    expect(store.getState().thinkingLevel).toBe('low');
  });
});

