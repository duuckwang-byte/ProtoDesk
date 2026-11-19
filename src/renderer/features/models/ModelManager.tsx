import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * features/models/ModelManager.tsx — 设置 → 模型管理「可用模型清单」。
 *
 * 新交互（模型管理拆分）：
 * - 主清单只渲染已选模型（resolveChecked === true），未选模型不渲染。
 * - 搜索仅在已选集合内过滤显示，绝不改勾选。
 * - 空态：已选为 0 提示「暂未选择模型…」，目录为空时追加「模型目录为空」配置提示；
 *   搜索无命中提示「已选模型无匹配」。搜索仅过滤显示、勾选不变，旧「无匹配模型」文案不再单列。
 * - 取消勾选即从主清单消失；全选 / 取消全选只在「获取模型」弹窗内，主清单不提供批量按钮。
 * - 手动添加的自定义模型 ID 归入「自定义模型」分组，与目录项同样可勾选。
 * - 当前模型回落沿用 resolveModelFallback（AI 对话框选择器消费），本组件不重复落盘。
 *
 * 旧语义来源（只读消费，不改 js/**）：
 * - js/project-ai-export.js buildModelManagerHtml / filterModelManagerList / batchFetchCheck。
 * - aiStoreModel/aiStoredModel(§5761-5769)：ai_model 键；空/__none__/default 即删键。
 *
 * 与 J 的级联选择器对接契约（props，不互相改文件）：
 * - 调用方传 visibleIds（菜单白名单，null = 旧配置未落盘白名单即全选，[] = 明确全不选）。
 * - 勾选经 onChange(nextVisibleIds) 单点写回，调用方同步菜单 + 持久化。
 */

// 与旧代码逐字一致的存储键（js §5697：var AI_MODEL_KEY='ai_model'）。
export const AI_MODEL_KEY = 'ai_model';

export interface ModelItem {
  id: string;
  name?: string;
  /** 主进程模型目录常用 label 字段（如 CLI fallbackModels），展示时作为 name 的别名。 */
  label?: string;
  description?: string;
  tags?: string[];
}

export interface ModelGroup {
  provider?: string;
  label?: string;
  models: Array<ModelItem | string>;
}

/** 旧 cleanId：仅去空白，不清洗后缀（free 独立模型手输原样保留）。 */
export function cleanModelId(s: unknown): string {
  return String(s ?? '').trim();
}

export function aiStoredModel(): string {
  try {
    const m = localStorage.getItem(AI_MODEL_KEY) || '';
    if (m === '__none__' || m === 'default') {
      try {
        localStorage.removeItem(AI_MODEL_KEY);
      } catch {
        /* ignore */
      }
      return '';
    }
    return m;
  } catch {
    return '';
  }
}

/** 逐字沿用 js §5761-5769 aiStoreModel。 */
export function aiStoreModel(m: string): void {
  try {
    if (!m || m === '__none__' || m === 'default') {
      localStorage.removeItem(AI_MODEL_KEY);
    } else {
      localStorage.setItem(AI_MODEL_KEY, m);
    }
  } catch {
    /* ignore */
  }
}

function normalizeItem(m: ModelItem | string): ModelItem {
  if (typeof m === 'string') return { id: cleanModelId(m), name: m };
  return {
    id: cleanModelId((m && (m.id || (m as { name?: string }).name)) || ''),
    name: (m && (m.name || m.label || m.id)) || '',
    label: m.label,
    description: m.description,
    tags: m.tags,
  };
}

export function flattenGroups(groups: ModelGroup[] | null | undefined): ModelItem[] {
  const out: ModelItem[] = [];
  const seen = new Set<string>();
  (groups || []).forEach((g) => {
    (g.models || []).forEach((m) => {
      const it = normalizeItem(m);
      if (!it.id || seen.has(it.id)) return;
      seen.add(it.id);
      out.push(it);
    });
  });
  return out;
}

/**
 * 可见集合（菜单侧）：null = 旧配置未落盘白名单（全选）；[] = 明确全不选。
 * 与 getFetchVisible / modelManagerVisibleIds 一致。
 */
export function resolveChecked(id: string, visible: string[] | null | undefined): boolean {
  if (!visible) return true;
  return visible.indexOf(id) >= 0;
}

/**
 * 回落判定（逐字沿用 js §6311-6317 aiRenderModelOptions）。
 *
 * 保留为纯函数以兼容旧调用/单测；新版 ModelManager 的取消勾选不再自动回落，
 * 当前模型由 AI 对话框选择器自行维护。
 */
export function resolveModelFallback(
  cur: string,
  allIds: string[],
  defaultId: string | null | undefined,
): { cur: string; found: boolean } {
  const cleanCur = cleanModelId(cur);
  const found0 = !!cleanCur && allIds.indexOf(cleanCur) >= 0;
  let next = cleanCur;
  let found = found0;
  if (!found && allIds.length) {
    const defId = cleanModelId(defaultId || '');
    next = defId && allIds.indexOf(defId) >= 0 ? defId : allIds[0];
    found = true;
    try {
      aiStoreModel(next);
    } catch {
      /* ignore */
    }
  }
  if (!found) next = '';
  return { cur: next, found };
}

/**
 * 移除可见模型 + 回落（旧组合语义，保留导出兼容单测）。
 * 新版 UI 不再调用：取消勾选只写回白名单。
 */
export function removeVisibleModelAndFallback(opts: {
  visibleIds: string[] | null | undefined;
  allIds: string[];
  removeId: string;
  cur: string;
  defaultId: string | null | undefined;
}): { visibleIds: string[]; cur: string; found: boolean } {
  const base = Array.isArray(opts.visibleIds) ? opts.visibleIds.slice() : opts.allIds.slice();
  const rid = cleanModelId(opts.removeId);
  const nextVisible = base.filter((x) => x !== rid);
  const fb = resolveModelFallback(cleanModelId(opts.cur), nextVisible, opts.defaultId);
  const curStillThere = !!cleanModelId(opts.cur) && nextVisible.indexOf(cleanModelId(opts.cur)) >= 0;
  if (curStillThere) return { visibleIds: nextVisible, cur: cleanModelId(opts.cur), found: true };
  return { visibleIds: nextVisible, cur: fb.cur, found: fb.found };
}

/** 搜索命中判定：纯显示过滤，绝不改勾选（沿用 filterModelManagerList 只改 display）。 */
export function matchesQuery(item: ModelItem, q: string): boolean {
  const query = String(q ?? '').trim().toLowerCase();
  if (!query) return true;
  const hay = `${item.id} ${item.name || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
  return hay.indexOf(query) >= 0;
}

interface GroupView {
  key: string;
  label: string;
  models: ModelItem[];
}

export interface ModelManagerProps {
  groups?: ModelGroup[];
  /** 菜单白名单：null=全选(旧配置)，[]=全不选；J 级联侧用 selectedIds 别名时以其为准。 */
  visibleIds: string[] | null | undefined;
  /** J 级联选择器契约别名：传入时作为勾选态真相源（与 visibleIds 同义）。 */
  selectedIds?: string[] | null | undefined;
  defaultModelId?: string;
  currentModelId?: string;
  onChange?: (nextVisibleIds: string[]) => void;
  onSelectModel?: (id: string) => void;
  /** 顶栏「刷新」：重新读取当前引擎模型目录。 */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** 顶栏「获取模型」：打开全量目录勾选弹窗。 */
  onFetchModels?: () => void;
}

/** 目录项去重 + 分组；保持 provider 顺序。 */
function buildCatalog(groups: ModelGroup[] | null | undefined): GroupView[] {
  const seen = new Set<string>();
  const out: GroupView[] = [];
  (groups || []).forEach((g, index) => {
    const models: ModelItem[] = [];
    (g.models || []).forEach((m) => {
      const item = normalizeItem(m);
      if (!item.id || seen.has(item.id)) return;
      seen.add(item.id);
      models.push(item);
    });
    if (!models.length) return;
    out.push({
      key: `${g.provider || g.label || 'group'}-${index}`,
      label: g.label || g.provider || '模型',
      models,
    });
  });
  return out;
}

export function ModelManager({
  groups = [],
  visibleIds,
  selectedIds,
  defaultModelId,
  currentModelId,
  onChange,
  onRefresh,
  refreshing = false,
  onFetchModels,
}: ModelManagerProps) {
  const [query, setQuery] = React.useState('');
  const [customId, setCustomId] = React.useState('');
  const [customError, setCustomError] = React.useState('');

  // J 契约：selectedIds 传入时优先，否则用 visibleIds；均缺省(null)即全选。
  const effectiveVisible = selectedIds !== undefined ? selectedIds : visibleIds;

  const catalog = React.useMemo(() => buildCatalog(groups), [groups]);
  const catalogIds = React.useMemo(
    () => new Set(catalog.flatMap((g) => g.models.map((m) => m.id))),
    [catalog],
  );

  // 白名单里存在、但当前目录缺失的模型（手输/旧配置）：归入「自定义模型」分组，避免无勾选入口。
  const outsideGroup = React.useMemo<GroupView | null>(() => {
    if (!Array.isArray(effectiveVisible)) return null;
    const outside: ModelItem[] = [];
    const seen = new Set<string>();
    effectiveVisible.forEach((raw) => {
      const id = cleanModelId(raw);
      if (!id || seen.has(id) || catalogIds.has(id)) return;
      seen.add(id);
      outside.push({ id, name: id, description: '目录外 / 手动添加' });
    });
    return outside.length ? { key: '__custom__', label: '自定义模型', models: outside } : null;
  }, [effectiveVisible, catalogIds]);

  const allGroupsView = React.useMemo<GroupView[]>(
    () => (outsideGroup ? [...catalog, outsideGroup] : catalog),
    [catalog, outsideGroup],
  );
  const all = React.useMemo(() => allGroupsView.flatMap((g) => g.models), [allGroupsView]);

  // 主清单数据源：只保留 checked 的模型；null（旧配置）经 resolveChecked 视为全选。
  const selectedGroups = React.useMemo<GroupView[]>(
    () =>
      allGroupsView
        .map((g) => ({
          ...g,
          models: g.models.filter((m) => resolveChecked(m.id, effectiveVisible)),
        }))
        .filter((g) => g.models.length > 0),
    [allGroupsView, effectiveVisible],
  );

  // 搜索只在已选集合内过滤，绝不改勾选。
  const shownGroups = React.useMemo<GroupView[]>(() => {
    if (!query.trim()) return selectedGroups;
    return selectedGroups
      .map((g) => ({ ...g, models: g.models.filter((m) => matchesQuery(m, query)) }))
      .filter((g) => g.models.length > 0);
  }, [selectedGroups, query]);
  const shownCount = React.useMemo(
    () => shownGroups.reduce((sum, g) => sum + g.models.length, 0),
    [shownGroups],
  );
  const checkedCount = React.useMemo(
    () => selectedGroups.reduce((sum, g) => sum + g.models.length, 0),
    [selectedGroups],
  );

  const currentBase = () =>
    Array.isArray(effectiveVisible) ? effectiveVisible.map(cleanModelId) : all.map((m) => m.id);

  const toggle = (id: string, checked: boolean) => {
    const base = currentBase();
    const at = base.indexOf(id);
    if (checked && at < 0) base.push(id);
    if (!checked && at >= 0) base.splice(at, 1);
    onChange?.(base);
  };

  const addCustom = () => {
    const val = cleanModelId(customId);
    if (!val) {
      setCustomError('模型 id 不能为空');
      return;
    }
    if (val.length > 200) {
      setCustomError('模型 id 过长（须 ≤200）');
      return;
    }
    setCustomError('');
    const base = currentBase();
    if (base.indexOf(val) < 0) base.push(val);
    onChange?.(base);
    setCustomId('');
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="model-manager">
      {/* 搜索 + 自定义添加合并为同一操作区（单行，窄屏自动换行）；统一 32px 高。 */}
      <div
        data-testid="model-manager-actions"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2"
      >
        <div className="relative min-w-[180px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="h-8 pl-8 pr-8"
            placeholder="在已选模型中按 ID 或能力描述过滤（不改勾选）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索模型"
          />
          {query ? (
            <button
              type="button"
              aria-label="清除搜索"
              title="清除搜索"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Input
          className="h-8 min-w-[180px] flex-1"
          placeholder="输入自定义模型 ID（例如 qwen-coder-plus）"
          value={customId}
          onChange={(e) => setCustomId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addCustom();
          }}
          aria-label="自定义模型 id"
        />
        <Button className="h-8 shrink-0" onClick={addCustom}>
          添加模型
        </Button>
      </div>
      {customError ? <div className="text-xs text-destructive">{customError}</div> : null}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="model-manager-count">
          已选 {checkedCount} / 共 {all.length} 个 · 显示 {shownCount} 个
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex h-9 items-center justify-between border-b border-border bg-muted/40 px-3">
          <span className="text-xs font-medium text-muted-foreground">可用模型清单</span>
          <div className="flex items-center gap-1">
            {onRefresh ? (
              <Button
                className="h-8 px-2 text-xs"
                variant="ghost"
                onClick={() => onRefresh()}
                disabled={refreshing}
              >
                {refreshing ? '刷新中…' : '刷新'}
              </Button>
            ) : null}
            {onFetchModels ? (
              <Button className="h-8 px-2 text-xs" variant="ghost" onClick={() => onFetchModels()}>
                获取模型
              </Button>
            ) : null}
          </div>
        </div>

        {checkedCount === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <div>暂未选择模型，点击「获取模型」选择</div>
            {all.length === 0 ? (
              <div className="mt-1 text-[11px]">
                模型目录为空（请检查引擎 / API 配置后刷新）
              </div>
            ) : null}
          </div>
        ) : shownCount === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            已选模型无匹配
          </div>
        ) : (
          <div className="max-h-[240px] overflow-y-auto">
            {shownGroups.map((group) => (
              <div key={group.key}>
                <div className="flex h-7 items-center justify-between bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground">
                  <span className="truncate">{group.label}</span>
                  <span className="font-mono">{group.models.length}</span>
                </div>
                {group.models.map((m) => {
                  const checked = resolveChecked(m.id, effectiveVisible);
                  const isCurrent = cleanModelId(currentModelId) === m.id;
                  const isDefault = cleanModelId(defaultModelId) === m.id;
                  const description =
                    m.description || (m.name && m.name !== m.id ? m.name : '');
                  return (
                    <div
                      key={m.id}
                      data-model-id={m.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-accent/40',
                        checked && 'bg-background',
                      )}
                      onClick={() => toggle(m.id, !checked)}
                    >
                      <span onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => toggle(m.id, next)}
                          aria-label={`勾选模型 ${m.id}`}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-[12.5px] font-semibold">
                            {m.id}
                          </span>
                          {isDefault ? <Badge variant="cobalt">推荐</Badge> : null}
                          {isCurrent ? <Badge variant="secondary">当前</Badge> : null}
                        </div>
                        {description ? (
                          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                            {description}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {(m.tags || []).slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="outline" className="font-mono">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
