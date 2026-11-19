import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AI_INTERNAL_EVENT_TYPES,
  aiEventMatchesSession,
  aiEventToMessages,
  deriveModelOptions,
  extractQuestionForms,
  findThoughtConfig,
  formatSnapshotTs,
  internalEventTrace,
  isEmptyEvent,
  isInternalAiEvent,
  normalizePermissionEvent,
  normalizePlan,
  normalizeTrace,
  normalizeUsage,
  parseSessionsFile,
  permissionScopeKey,
  pickActivePage,
  reduceAiEventsToMessages,
  resetThinkingOnModelChange,
  resolveSendContext,
  resolveThoughtValue,
  serializeSessions,
  thoughtOptionsFromAcp,
} from '../adapters';
import type { AiMessage } from '../adapters';

describe('adapters: 归属校验（旧 aiEventMatchesSession 逐字沿用）', () => {
  it('双方一致通过', () => {
    expect(
      aiEventMatchesSession({ id: 's1', agentId: 'opencode' }, { agentId: 'opencode', uiSessionId: 's1' }),
    ).toBe(true);
  });

  it('agentId 不一致拒绝', () => {
    expect(
      aiEventMatchesSession({ id: 's1', agentId: 'opencode' }, { agentId: 'claude', uiSessionId: 's1' }),
    ).toBe(false);
  });

  it('uiSessionId 不一致拒绝', () => {
    expect(
      aiEventMatchesSession({ id: 's1', agentId: 'opencode' }, { agentId: 'opencode', uiSessionId: 's2' }),
    ).toBe(false);
  });

  it('旧事件缺字段不断连', () => {
    expect(aiEventMatchesSession({ id: 's1', agentId: 'opencode' }, { type: 'chunk' })).toBe(true);
    expect(aiEventMatchesSession({ id: 's1' }, { type: 'chunk' })).toBe(true);
  });

  it('空引用返回 false', () => {
    expect(aiEventMatchesSession(null, { type: 'chunk' })).toBe(false);
    expect(aiEventMatchesSession({ id: 's1' }, null)).toBe(false);
  });
});

describe('adapters: 模型切换重置 thinking', () => {
  it('模型变化回落 default', () => {
    expect(resetThinkingOnModelChange('m1', 'm2', 'high')).toBe('default');
  });

  it('同模型保留原值', () => {
    expect(resetThinkingOnModelChange('m1', 'm1', 'high')).toBe('high');
  });

  it('空 thinking 回落 default', () => {
    expect(resetThinkingOnModelChange('m1', 'm1', '')).toBe('default');
  });

  it('ACP 思考解析：已选合法保留，非法回落 currentValue', () => {
    const opts = [{ value: 'low' }, { value: 'high' }];
    expect(resolveThoughtValue(opts, { t: 'high' }, 't', 'low')).toEqual({ value: 'high', stale: false });
    expect(resolveThoughtValue(opts, { t: 'xhigh' }, 't', 'low')).toEqual({ value: 'low', stale: true });
  });
});

describe('adapters: ACP 思考档位归一（probe 与事件共用）', () => {
  it('label 优先，其次主进程 name；有可读文案时不显示原始值', () => {
    const opts = thoughtOptionsFromAcp([
      { value: 'low', name: 'Low', description: '低强度' },
      { value: 'high', label: '高强度', name: 'High' },
      { value: 'max', title: 'Max' },
      { value: 'none' },
    ]);
    expect(opts.map((o) => o.value)).toEqual(['low', 'high', 'max', 'none']);
    expect(opts.map((o) => o.label)).toEqual(['Low', '高强度', 'Max', 'none']);
    expect(opts[0].title).toBe('Low');
    expect(opts[1].title).toBe('高强度');
  });

  it('保留 minimal/xhigh/max/none/enabled 原值，不裁剪', () => {
    const opts = thoughtOptionsFromAcp([
      { value: 'minimal', name: 'Minimal' },
      { value: 'xhigh', name: 'XHigh' },
      { value: 'max', name: 'Max' },
      { value: 'none', name: 'None' },
      { value: 'enabled', name: 'Enabled' },
    ]);
    expect(opts.map((o) => o.value)).toEqual(['minimal', 'xhigh', 'max', 'none', 'enabled']);
  });

  it('兼容 grouped options（主进程已 flatten，渲染层再兜底）', () => {
    const opts = thoughtOptionsFromAcp([
      { name: '常用', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
      { value: 'default', name: 'Default' },
    ] as never);
    expect(opts.map((o) => o.label)).toEqual(['Low', 'High', 'Default']);
  });

  it('识别 thought_level / reasoning_effort / effort（id 或 category）', () => {
    const thoughtLevel = findThoughtConfig([
      { id: 'model', category: 'model', type: 'select', options: [{ value: 'm' }] },
      {
        id: 'thought_level',
        category: 'thought_level',
        type: 'select',
        currentValue: 'enabled',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
          { value: 'max', name: 'Max' },
          { value: 'enabled', name: 'Enabled' },
        ],
      },
    ]);
    expect(thoughtLevel?.id).toBe('thought_level');
    expect(thoughtLevel?.boolean).toBe(false);
    expect(thoughtLevel?.options.map((o) => o.value)).toEqual(['low', 'high', 'max', 'enabled']);

    const reasoning = findThoughtConfig([
      { id: 'reasoning_effort', category: 'thought', type: 'select', options: [{ value: 'xhigh' }] },
    ]);
    expect(reasoning?.id).toBe('reasoning_effort');

    const effort = findThoughtConfig([
      { id: 'effort', category: 'other', type: 'select', options: [{ value: 'minimal' }] },
    ]);
    expect(effort?.id).toBe('effort');
  });

  it('排除 boolean 思考开关（type=boolean 或仅 enabled/disabled）', () => {
    const byType = findThoughtConfig([
      {
        id: 'thinking',
        category: 'thought_level',
        type: 'boolean',
        options: [{ value: 'enabled', name: 'Enabled' }, { value: 'disabled', name: 'Disabled' }],
      },
    ]);
    expect(byType?.boolean).toBe(true);

    const byValues = findThoughtConfig([
      {
        id: 'thought_level',
        category: 'thought_level',
        type: 'select',
        options: [{ value: 'on' }, { value: 'off' }],
      },
    ]);
    expect(byValues?.boolean).toBe(true);

    // 普通强度档位（即使含 enabled）不是布尔开关。
    const strength = findThoughtConfig([
      {
        id: 'thought_level',
        category: 'thought_level',
        type: 'select',
        options: [{ value: 'low' }, { value: 'enabled' }],
      },
    ]);
    expect(strength?.boolean).toBe(false);
  });

  it('没有思考项返回 null（由 UI 显示不支持）', () => {
    expect(
      findThoughtConfig([
        { id: 'model', category: 'model', type: 'select', options: [{ value: 'm' }] },
        { id: 'mode', category: 'mode', type: 'select', options: [{ value: 'fast' }] },
      ]),
    ).toBeNull();
  });
});

describe('adapters: 空事件不崩', () => {
  it('isEmptyEvent 覆盖 null/undefined/{}', () => {
    expect(isEmptyEvent(null)).toBe(true);
    expect(isEmptyEvent(undefined)).toBe(true);
    expect(isEmptyEvent({})).toBe(true);
    expect(isEmptyEvent({ type: 'chunk' })).toBe(false);
  });

  it('归一函数空输入返回安全默认值', () => {
    expect(aiEventToMessages(null, 's1')).toEqual([]);
    expect(aiEventToMessages(undefined, 's1')).toEqual([]);
    expect(aiEventToMessages({}, 's1')).toEqual([]);
    expect(reduceAiEventsToMessages(null, null, 's1')).toEqual([]);
    expect(normalizePermissionEvent(null)).toBeNull();
    expect(normalizePlan(null)).toEqual([]);
    expect(normalizeTrace(null)).toBeNull();
    expect(normalizeUsage(null)).toEqual({ inputTokens: 0, outputTokens: 0, text: '' });
    expect(extractQuestionForms(null)).toEqual([]);
  });
});

describe('adapters: 权限/快照/Trace 归一', () => {
  it('权限键包含 agentId+uiSessionId 归属', () => {
    const p = normalizePermissionEvent({
      type: 'permission_request',
      id: 'p1',
      agentId: 'opencode',
      uiSessionId: 's1',
      title: '执行命令',
      command: 'npm test',
    });
    expect(p).not.toBeNull();
    expect(permissionScopeKey(p!)).toBe('opencode|s1|p1');
  });

  it('快照时间格式化', () => {
    expect(formatSnapshotTs('20260824-101530')).toBe('2026-08-24 10:15:30');
  });

  it('trace 字符串归一', () => {
    const t = normalizeTrace({ type: 'trace', trace: 'hello' });
    expect(t).not.toBeNull();
    expect(t!.tag).toBe('INFO');
    expect(t!.text).toBe('hello');
  });

  it('question-form 提取不抛错', () => {
    const forms = extractQuestionForms('<question-form id="f1" title="确认">{"id":"q1","label":"继续？","type":"radio","options":["是","否"]}</question-form>');
    expect(forms.length).toBe(1);
    expect(forms[0].questions.length).toBe(1);
  });
});

describe('adapters: W3-07 发送上下文（当前源 → ai:ask 载荷）', () => {
  it('子页优先、kind 不写死 mobile、hash 命中页面', () => {
    const ctx = resolveSendContext({
      sandboxDir: '/sandbox/A/登录页',
      mainHtmlFile: '登录页.html',
      activeSubFile: '详情.html',
      kind: 'pc',
      pages: ['page-chat', 'page-list'],
      hash: '#page-list',
    });
    expect(ctx).toEqual({
      sandboxDir: '/sandbox/A/登录页',
      targetFile: '详情.html',
      uiKind: 'pc',
      activePage: 'page-list',
    });
  });

  it('主页时 targetFile 回落 mainHtmlFile', () => {
    const ctx = resolveSendContext({
      sandboxDir: '/sandbox/A/首页',
      mainHtmlFile: '首页.html',
      activeSubFile: '',
      kind: 'mobile',
      pages: ['page-home'],
    });
    expect(ctx.targetFile).toBe('首页.html');
    expect(ctx.uiKind).toBe('mobile');
    expect(ctx.activePage).toBe('page-home');
  });

  it('无源/无 kind 时用舞台兜底，绝不硬编码 mobile', () => {
    const ctx = resolveSendContext({
      sandboxDir: '',
      mainHtmlFile: '',
      activeSubFile: '',
      kind: '',
      pages: [],
      hash: '',
      fallbackKind: 'pc',
      fallbackPage: 'page-x',
    });
    expect(ctx).toEqual({ sandboxDir: '', targetFile: '', uiKind: 'pc', activePage: 'page-x' });
    expect(ctx.uiKind).not.toBe('mobile');
  });

  it('pickActivePage：精确 → 前缀 → hash → 首项', () => {
    expect(pickActivePage(['page-a', 'page-b'], 'page-b')).toBe('page-b');
    expect(pickActivePage(['page-a', 'detail/1'], '#detail/1?x=1')).toBe('detail/1');
    expect(pickActivePage(['page-a'], '#page-unknown')).toBe('page-unknown');
    expect(pickActivePage(['page-ab'], '#page-a')).toBe('page-a');
    expect(pickActivePage(['page-a', 'page-b'], '')).toBe('page-a');
    expect(pickActivePage([], '')).toBe('');
  });
});

describe('adapters: W3-07 模型清单（modelGroups + visibleModels）', () => {
  const groups = [
    {
      provider: 'opencode',
      models: [
        { id: 'm-1', name: 'Model One' },
        'm-2',
        { id: 'm-1', name: '重复项' },
      ],
    },
    { provider: 'api', models: [{ id: 'm-3', label: 'Model Three' }] },
  ];

  it('null 白名单 = 全选（去重保序）', () => {
    expect(deriveModelOptions(groups, null)).toEqual([
      { value: 'm-1', label: 'Model One' },
      { value: 'm-2', label: 'm-2' },
      { value: 'm-3', label: 'Model Three' },
    ]);
  });

  it('空白名单 = 全不选；命中项才出现', () => {
    expect(deriveModelOptions(groups, [])).toEqual([]);
    expect(deriveModelOptions(groups, ['m-3'])).toEqual([{ value: 'm-3', label: 'Model Three' }]);
  });

  it('空输入不崩', () => {
    expect(deriveModelOptions(null, null)).toEqual([]);
    expect(deriveModelOptions([], ['m-1'])).toEqual([]);
  });
});

describe('adapters: W3-07 会话持久化形状', () => {
  const session = {
    id: 's1',
    title: '登录页对话',
    agentId: 'opencode',
    agentName: 'OpenCode',
    agentSessionId: 'oid-1',
    acpSessionId: 'acp-1',
    freshSession: false,
    createdAt: 100,
    updatedAt: 200,
  };
  const messages = [
    { key: 'u1', sessionId: 's1', role: 'user' as const, kind: 'text' as const, text: '你好', ts: 101, sourceType: 'local' },
    { key: 'a1t', sessionId: 's1', role: 'assistant' as const, kind: 'thinking' as const, text: '思考中', ts: 102, sourceType: 'thinking' },
    { key: 'a1', sessionId: 's1', role: 'assistant' as const, kind: 'text' as const, text: '收到', ts: 103, sourceType: 'chunk' },
    { key: 'p1', sessionId: 's1', role: 'assistant' as const, kind: 'permission' as const, text: '执行命令', ts: 104, sourceType: 'permission_request', payload: { id: 'p1', status: 'pending', raw: { huge: 'x'.repeat(100) } } },
  ];

  it('serialize → parse 往返保留完整消息与旧 m 投影', () => {
    const file = serializeSessions({
      sessions: [session],
      activeSessionId: 's1',
      messages: { s1: messages },
    });
    expect(file.activeId).toBe('s1');
    expect(file.sessions.s1.oid).toBe('oid-1');
    expect(file.sessions.s1.m.map((m) => m.r)).toEqual(['u', 'a', 'a', 'a']);
    expect(file.sessions.s1.m[1].think).toBe('思考中');

    const parsed = parseSessionsFile(file)!;
    expect(parsed.activeSessionId).toBe('s1');
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].agentSessionId).toBe('oid-1');
    expect(parsed.sessions[0].acpSessionId).toBe('acp-1');
    expect(parsed.messages.s1).toHaveLength(4);
    expect(parsed.messages.s1[3].kind).toBe('permission');
    expect(parsed.messages.s1[3].payload).toEqual({ id: 'p1', status: 'pending' });
  });

  it('旧 ai_sessions_v2_* 形状（只有 m）可降级恢复', () => {
    const parsed = parseSessionsFile({
      activeId: 'old1',
      sessions: {
        old1: {
          id: 'old1',
          title: '旧会话',
          createdAt: 1,
          updatedAt: 2,
          oid: 'oid-old',
          m: [
            { r: 'u', t: '旧问题', ts: 3 },
            { r: 'a', t: '旧回答', think: '旧思考', ts: 4 },
            { r: 'tool', t: 'npm test', ts: 5 },
          ],
        },
      },
    })!;
    expect(parsed.activeSessionId).toBe('old1');
    expect(parsed.sessions[0].agentSessionId).toBe('oid-old');
    expect(parsed.messages.old1.map((m) => m.kind)).toEqual([
      'text',
      'thinking',
      'text',
      'tool_call',
    ]);
  });

  it('旧 ai_hist_* 单会话形状可恢复', () => {
    const parsed = parseSessionsFile({
      id: 'h1',
      title: '单会话',
      m: [{ r: 'u', t: 'hi', ts: 1 }],
    })!;
    expect(parsed.sessions[0].id).toBe('h1');
    expect(parsed.messages.h1[0].text).toBe('hi');
  });

  it('旧版本控制事件伪消息恢复时被过滤（acp_catalog 不再出现在历史聊天）', () => {
    const parsed = parseSessionsFile({
      activeId: 'h2',
      sessions: {
        h2: {
          id: 'h2',
          title: '含旧控制事件',
          createdAt: 1,
          updatedAt: 2,
          msgs: [
            { key: 'u1', role: 'user', kind: 'text', text: '你好', ts: 1, sourceType: 'local' },
            { key: 'c1', role: 'system', kind: 'info', text: 'acp_catalog', ts: 2, sourceType: 'acp_catalog' },
            { key: 'c2', role: 'system', kind: 'info', text: 'done', ts: 3 },
            { key: 'a1', role: 'assistant', kind: 'text', text: '收到', ts: 4, sourceType: 'chunk' },
          ],
        },
      },
    })!;
    expect(parsed.messages.h2.map((m) => m.text)).toEqual(['你好', '收到']);
  });

  it('旧 m 投影中的 system 控制事件名不恢复，正常系统提示保留', () => {
    const parsed = parseSessionsFile({
      id: 'h3',
      m: [
        { r: 'u', t: 'hi', ts: 1 },
        { r: 's', t: 'session', ts: 2 },
        { r: 's', t: '正常系统提示', ts: 3 },
      ],
    })!;
    expect(parsed.messages.h3.map((m) => m.text)).toEqual(['hi', '正常系统提示']);
  });

  it('非法/空数据返回 null 或空结果，不清空语义', () => {
    expect(parseSessionsFile(null)).toBeNull();
    expect(parseSessionsFile('oops')).toBeNull();
    expect(parseSessionsFile({})).toBeNull();
    expect(parseSessionsFile({ activeId: 'x', sessions: {} })).toEqual({
      sessions: [],
      activeSessionId: null,
      messages: {},
    });
    const parsed = parseSessionsFile({ sessions: { bad: null, ok: { id: 'ok', msgs: [] } } })!;
    expect(parsed.sessions.map((s) => s.id)).toEqual(['ok']);
  });
});

describe('adapters: 内部控制事件不进入聊天流（P0-2 回归）', () => {
  it.each([...AI_INTERNAL_EVENT_TYPES])('%s 不产生可见文本消息', (type) => {
    const msgs = aiEventToMessages(
      { type, agentId: 'opencode', text: '不应显示的内部控制文本', warning: 'w', error: 'e' },
      's1',
    );
    expect(msgs).toEqual([]);
  });

  it.each([...AI_INTERNAL_EVENT_TYPES])('%s 诊断摘要进入 trace（不丢事件）', (type) => {
    const line = internalEventTrace({ type, agentId: 'opencode', id: 'x1' });
    expect(line).not.toBeNull();
    expect(line!.tag).toBe(type.toUpperCase());
    expect(line!.text.length).toBeGreaterThan(0);
  });

  it('acp_catalog 完整目录只留诊断信息（trace），不渲染为聊天文本', () => {
    const ev = {
      type: 'acp_catalog',
      agentId: 'opencode',
      models: [{ id: 'a', name: 'Model A' }, { id: 'b', name: 'Model B' }],
      defaultModel: 'a',
      source: 'acp',
      stale: false,
      ts: 1720000000000,
    };
    expect(aiEventToMessages(ev, 's1')).toEqual([]);
    expect(isInternalAiEvent('acp_catalog')).toBe(true);
    const line = internalEventTrace(ev)!;
    expect(line.tag).toBe('ACP_CATALOG');
    expect(line.text).toContain('agent=opencode');
    expect(line.text).toContain('models=2');
    expect(line.text).toContain('source=acp');
    expect(line.text).not.toContain('不应显示');
  });

  it('acp_catalog 失败事件进 trace 且标为 error/warn', () => {
    const failed = internalEventTrace({
      type: 'acp_catalog',
      agentId: 'opencode',
      error: 'ACP_MODEL_REFRESH_FAILED',
      warning: 'ACP 模型目录刷新失败，已保留旧缓存',
    })!;
    expect(failed.level).toBe('error');
    expect(failed.text).toContain('ACP 模型目录刷新失败');
  });

  it('reduce 后聊天流只保留会话内容，控制事件不追加', () => {
    let list = reduceAiEventsToMessages([], { type: 'chunk', text: '你好' }, 's1');
    list = reduceAiEventsToMessages(list, { type: 'acp_catalog', models: [] }, 's1');
    list = reduceAiEventsToMessages(list, { type: 'run_started', engine: 'cli' }, 's1');
    list = reduceAiEventsToMessages(list, { type: 'done' }, 's1');
    list = reduceAiEventsToMessages(list, { type: 'permission_resolved', id: 'p1' }, 's1');
    expect(list.map((m) => m.text)).toEqual(['你好']);
  });

  it('未知 type 按控制事件过滤，不把事件名当正文', () => {
    expect(aiEventToMessages({ type: 'some_control_event', text: 'raw' }, 's1')).toEqual([]);
    expect(isInternalAiEvent('some_control_event')).toBe(true);
    expect(isInternalAiEvent('chunk')).toBe(false);
    expect(internalEventTrace({ type: 'chunk', text: 'x' })).toBeNull();
  });
});

describe('adapters: 流式 delta 合并（一词一气泡回归）', () => {
  function fold(events: Array<Record<string, unknown>>, sessionId = 's1'): AiMessage[] {
    return events.reduce<AiMessage[]>(
      (prev, ev) => reduceAiEventsToMessages(prev, ev as never, sessionId),
      [],
    );
  }

  it('3 个连续 chunk（同一 runId）合并为 1 条消息，文本为完整句子', () => {
    const list = fold([
      { type: 'chunk', runId: 'r1', seq: 0, mode: 'delta', text: '调整' },
      { type: 'chunk', runId: 'r1', seq: 1, mode: 'delta', text: '功能' },
      { type: 'chunk', runId: 'r1', seq: 2, mode: 'delta', text: '说明' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('assistant');
    expect(list[0].kind).toBe('text');
    expect(list[0].text).toBe('调整功能说明');
    expect(list[0].streaming).toBe(true);
  });

  it('无 runId 的连续 chunk 也能按会话兜底合并（CLI/API 旧事件）', () => {
    const list = fold([
      { type: 'chunk', text: '调整' },
      { type: 'chunk', text: '功能' },
      { type: 'chunk', text: '说明' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('调整功能说明');
  });

  it('纯空格/换行片段保留，不 trim 掉单词间空格与代码换行', () => {
    const spaced = fold([
      { type: 'chunk', runId: 'r1', text: 'hello' },
      { type: 'chunk', runId: 'r1', text: ' ' },
      { type: 'chunk', runId: 'r1', text: 'world' },
    ]);
    expect(spaced).toHaveLength(1);
    expect(spaced[0].text).toBe('hello world');

    const lines = fold([
      { type: 'chunk', runId: 'r2', text: 'a' },
      { type: 'chunk', runId: 'r2', text: '\n\n' },
      { type: 'chunk', runId: 'r2', text: 'b' },
    ]);
    expect(lines[0].text).toBe('a\n\nb');

    // 单事件也不再把纯空白当空文本丢弃。
    expect(aiEventToMessages({ type: 'chunk', text: ' ' }, 's1')).toHaveLength(1);

    // 没有可追加段时，纯空白不生成开头空白气泡（后续正文不受影响）。
    const leading = fold([{ type: 'chunk', runId: 'r3', text: '\n' }]);
    expect(leading).toHaveLength(0);
  });

  it('空字符串 chunk 不新增消息', () => {
    expect(fold([{ type: 'chunk', runId: 'r1', text: '' }])).toHaveLength(0);
  });

  it('两个 run 不串：run_started/done 形成消息边界', () => {
    const list = fold([
      { type: 'run_started', engine: 'cli' },
      { type: 'chunk', text: '第一' },
      { type: 'chunk', text: '轮' },
      { type: 'done' },
      { type: 'run_started', engine: 'cli' },
      { type: 'chunk', text: '第二' },
      { type: 'chunk', text: '轮' },
      { type: 'done' },
    ]);
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.text)).toEqual(['第一轮', '第二轮']);
    expect(list.every((m) => m.streaming === false)).toBe(true);
  });

  it('不同 runId 即使没有边界事件也不合并', () => {
    const list = fold([
      { type: 'chunk', runId: 'r1', text: 'A' },
      { type: 'chunk', runId: 'r2', text: 'B' },
    ]);
    expect(list.map((m) => m.text)).toEqual(['A', 'B']);
  });

  it('messageId 保留且优先于 runId；不同 messageId 必须分段', () => {
    const first = aiEventToMessages(
      { type: 'chunk', messageId: 'm1', runId: 'r1', text: '调整' },
      's1',
    );
    expect(first[0].messageId).toBe('m1');
    expect(first[0].streamId).toBe('text:msg:m1');

    let merged = first;
    merged = reduceAiEventsToMessages(
      merged,
      { type: 'chunk', messageId: 'm1', runId: 'r1', seq: 1, text: '功能' } as never,
      's1',
    );
    // runId 变化但 messageId 相同：仍属于同一条 producer message。
    merged = reduceAiEventsToMessages(
      merged,
      { type: 'chunk', messageId: 'm1', runId: 'r2', seq: 2, text: '说明' } as never,
      's1',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('调整功能说明');
    expect(merged[0].messageId).toBe('m1');
    expect(merged[0].seq).toBe(2);
    // 合并时保留首条 key（消息 id 稳定，React 不重建气泡）。
    expect(merged[0].key).toBe(first[0].key);

    const split = fold([
      { type: 'chunk', messageId: 'm1', runId: 'r1', text: 'A' },
      { type: 'chunk', messageId: 'm2', runId: 'r1', text: 'B' },
    ]);
    expect(split.map((m) => m.text)).toEqual(['A', 'B']);
  });

  it('thinking / tool_call 打断文本段，不跨卡片合并', () => {
    const withThink = fold([
      { type: 'chunk', runId: 'r1', text: '前' },
      { type: 'thinking', runId: 'r1', text: '想' },
      { type: 'chunk', runId: 'r1', text: '后' },
    ]);
    expect(withThink.map((m) => m.kind)).toEqual(['text', 'thinking', 'text']);
    expect(withThink.map((m) => m.text)).toEqual(['前', '想', '后']);

    const withTool = fold([
      { type: 'chunk', runId: 'r1', text: '前' },
      { type: 'tool_call', runId: 'r1', tool: 'read', title: 'Read', toolCallId: 't1' },
      { type: 'chunk', runId: 'r1', text: '后' },
    ]);
    expect(withTool.map((m) => m.kind)).toEqual(['text', 'tool_call', 'text']);
    expect(withTool.map((m) => m.text)).toEqual(['前', 'Read', '后']);
  });

  it('answer 默认按 delta 追加；显式 full 才替换当前段', () => {
    const legacy = fold([
      { type: 'answer', runId: 'r1', text: 'A' },
      { type: 'answer', runId: 'r1', text: 'B' },
    ]);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].text).toBe('AB');

    const replaced = fold([
      { type: 'chunk', runId: 'r1', text: '半截' },
      { type: 'answer', runId: 'r1', mode: 'full', text: '完整快照' },
    ]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].text).toBe('完整快照');
    expect(replaced[0].streamMode).toBe('full');
  });

  it('原始 text_delta 事件也能合并；thought 流与正文分开', () => {
    const list = fold([
      { type: 'text_delta', messageId: 'm9', text: '调整' },
      { type: 'text_delta', messageId: 'm9', text: '说明' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('text');
    expect(list[0].messageId).toBe('m9');
    expect(list[0].text).toBe('调整说明');

    const mixed = fold([
      { type: 'text_delta', stream: 'thought', messageId: 't1', text: '想' },
      { type: 'text_delta', messageId: 't1', text: '正文' },
    ]);
    expect(mixed.map((m) => m.kind)).toEqual(['thinking', 'text']);
    expect(mixed.map((m) => m.text)).toEqual(['想', '正文']);
  });

  it('旧历史恢复时 coalesce 相邻 chunk（一词一气泡自愈）', () => {
    const parsed = parseSessionsFile({
      activeId: 'old1',
      sessions: {
        old1: {
          id: 'old1',
          title: '旧会话',
          createdAt: 1,
          updatedAt: 2,
          msgs: [
            { key: 'u1', role: 'user', kind: 'text', text: '你好', ts: 1, sourceType: 'local' },
            { key: 'c1', role: 'assistant', kind: 'text', text: '调整', ts: 2, sourceType: 'chunk' },
            { key: 'c2', role: 'assistant', kind: 'text', text: '功能', ts: 3, sourceType: 'chunk' },
            { key: 'c3', role: 'assistant', kind: 'text', text: '说明', ts: 4, sourceType: 'chunk' },
            { key: 't1', role: 'assistant', kind: 'tool_call', text: 'Read', ts: 5, sourceType: 'tool_call' },
            { key: 'c4', role: 'assistant', kind: 'text', text: '完成', ts: 6, sourceType: 'chunk' },
          ],
        },
      },
    })!;
    const list = parsed.messages.old1;
    expect(list.map((m) => m.kind)).toEqual(['text', 'text', 'tool_call', 'text']);
    expect(list[1].text).toBe('调整功能说明');
    expect(list[1].key).toBe('c1');
    expect(list[1].ts).toBe(4);
    expect(list[1].streaming).toBe(false);
    // 工具后的文本不并回工具前。
    expect(list[3].text).toBe('完成');
  });

  it('旧历史里两端 streamId 不同的 chunk 不合并（不跨 run 拼接）', () => {
    const parsed = parseSessionsFile({
      id: 'old2',
      msgs: [
        { key: 'c1', role: 'assistant', kind: 'text', text: 'A', ts: 1, sourceType: 'chunk', streamId: 'text:run:r1' },
        { key: 'c2', role: 'assistant', kind: 'text', text: 'B', ts: 2, sourceType: 'chunk', streamId: 'text:run:r2' },
      ],
    })!;
    expect(parsed.messages.old2.map((m) => m.text)).toEqual(['A', 'B']);
  });
});

describe('AiDialog: 模型选择器唯一（P0-2 回归）', () => {
  // vitest 根目录 = 仓库根；用 cwd 解析，避免 jsdom 下 import.meta.url 非 file 协议。
  const root = process.cwd();
  const dialogSrc = readFileSync(
    path.join(root, 'src/renderer/features/ai/AiDialog.tsx'),
    'utf8',
  );
  const selectorSrc = readFileSync(
    path.join(root, 'src/renderer/components/ai-elements/ModelSelector.tsx'),
    'utf8',
  );

  it('AiDialog 只渲染一个 ModelSelector（不再顶部/底部重复）', () => {
    expect((dialogSrc.match(/<ModelSelector\b/g) || []).length).toBe(1);
    expect((dialogSrc.match(/\{cascade\}/g) || []).length).toBe(0);
    expect(dialogSrc).toContain('data-testid="ai-dialog-session"');
  });

  it('ModelSelector 为单个 Popover 双列级联，不再并排两个 Select', () => {
    expect((selectorSrc.match(/<Select\b/g) || []).length).toBe(0);
    expect(selectorSrc).toContain('<Popover');
    expect(selectorSrc).toContain('role="listbox"');
    // E2E 既有锚点保留（模型段 / 思考段共用同一个级联浮层）。
    expect(selectorSrc).toContain('data-testid="ai-model-select"');
    expect(selectorSrc).toContain('data-testid="ai-thinking-select"');
    expect(selectorSrc).toContain('thinkingOptions');
  });
});
