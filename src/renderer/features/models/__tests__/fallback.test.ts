import { describe, expect, it, beforeEach } from 'vitest';
import {
  AI_MODEL_KEY,
  cleanModelId,
  matchesQuery,
  removeVisibleModelAndFallback,
  resolveModelFallback,
  type ModelItem,
} from '../ModelManager';
import { computeBatchFetchCheck } from '../ModelFetchModal';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('模型移除回落（逐字沿用 aiRenderModelOptions §6311-6317）', () => {
  it('移除已选当前模型 → 落 r.default 并持久化', () => {
    const allIds = ['m-a', 'm-b', 'm-c'];
    localStorage.setItem(AI_MODEL_KEY, 'm-b');
    const r = removeVisibleModelAndFallback({
      visibleIds: ['m-a', 'm-b', 'm-c'],
      allIds,
      removeId: 'm-b',
      cur: 'm-b',
      defaultId: 'm-c',
    });
    expect(r.visibleIds).toEqual(['m-a', 'm-c']);
    // found=false → defId=m-c 在 allIds(移除后)内 → 落 m-c
    expect(r.cur).toBe('m-c');
    expect(localStorage.getItem(AI_MODEL_KEY)).toBe('m-c');
  });

  it('r.default 不在可见列表 → 落首个可见 allIds[0] 并持久化', () => {
    const r = removeVisibleModelAndFallback({
      visibleIds: ['m-a', 'm-b'],
      allIds: ['m-a', 'm-b'],
      removeId: 'm-b',
      cur: 'm-b',
      defaultId: 'm-gone',
    });
    expect(r.visibleIds).toEqual(['m-a']);
    expect(r.cur).toBe('m-a');
    expect(localStorage.getItem(AI_MODEL_KEY)).toBe('m-a');
  });

  it('未移除当前选中 → 保持原值且 found=true', () => {
    const r = resolveModelFallback('m-a', ['m-a', 'm-b'], 'm-b');
    expect(r).toEqual({ cur: 'm-a', found: true });
  });

  it('空列表 → cur=""（绝不写死旧模型常量）', () => {
    const r = resolveModelFallback('m-x', [], 'm-default');
    expect(r).toEqual({ cur: '', found: false });
  });

  it('cleanModelId 仅去空白', () => {
    expect(cleanModelId('  m-a  ')).toBe('m-a');
  });
});

describe('搜索绝不改勾选', () => {
  const items: ModelItem[] = [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话', tags: ['fast'] },
    { id: 'gpt-4o', name: 'GPT-4o', description: '多模态', tags: ['vision'] },
  ];

  it('query 过滤只影响显示集合，勾选集合原样保留', () => {
    const selected = ['deepseek-chat', 'gpt-4o'];
    const shown = items.filter((m) => matchesQuery(m, 'deepseek'));
    expect(shown.map((m) => m.id)).toEqual(['deepseek-chat']);
    // 勾选态不受搜索影响
    expect(selected).toEqual(['deepseek-chat', 'gpt-4o']);
  });

  it('batchFetchCheck 只处理显示中的项（隐藏项保持）', () => {
    const allIds = ['a', 'b', 'c'];
    // 当前全选，搜索仅命中 a，对显示项取消勾选后 b/c 应保留
    const next = computeBatchFetchCheck(['a'], ['a', 'b', 'c'], allIds, false);
    expect(next).toEqual(['b', 'c']);
    // 对显示项全选：隐藏项不动，已选项不重复
    const next2 = computeBatchFetchCheck(['a'], ['b'], allIds, true);
    expect(next2.sort()).toEqual(['a', 'b']);
  });
});
