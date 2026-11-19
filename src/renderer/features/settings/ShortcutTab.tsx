import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * features/settings/ShortcutTab.tsx — 快捷键（本地校验；无对应 IPC 通道，不伪造持久化）。
 * Ctrl+F 为文档面板内置行为（仅面板内聚焦正文搜索），不可在此改键；修改只做格式校验。
 * 校验：非空、形如 Ctrl/Alt/Shift + 主键、不重复。
 */

export interface ShortcutRow {
  id: string;
  label: string;
  keys: string;
}

export interface ShortcutTabProps {
  value?: ShortcutRow[];
  onChange?: (v: ShortcutRow[]) => void;
}

const DEFAULT_SHORTCUTS: ShortcutRow[] = [
  { id: 'send', label: '发送', keys: 'Ctrl+Enter' },
  { id: 'stop', label: '停止', keys: 'Esc' },
  { id: 'search', label: '文档搜索', keys: 'Ctrl+F' },
];

const KEYS_RE = /^(Ctrl|Alt|Shift)(\+(Ctrl|Alt|Shift))*\+[A-Za-z0-9]+$|^Esc$|^F\d{1,2}$/;

export function validateShortcuts(rows: ShortcutRow[]): string {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const k = r.keys.trim();
    if (!k) return `「${r.label}」快捷键不能为空`;
    if (!KEYS_RE.test(k)) return `「${r.label}」格式非法（示例 Ctrl+Enter / Esc / F5）`;
    const low = k.toLowerCase();
    if (seen.has(low)) return `「${r.label}」与「${seen.get(low)}」重复`;
    seen.set(low, r.label);
  }
  return '';
}

export function ShortcutTab({ value, onChange }: ShortcutTabProps) {
  const [inner, setInner] = React.useState<ShortcutRow[]>(() =>
    (value ?? DEFAULT_SHORTCUTS).map((r) => ({ ...r })),
  );
  const rows = value ?? inner;
  const emit = (next: ShortcutRow[]) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };
  const err = validateShortcuts(rows);
  const setKeys = (id: string, keys: string) => {
    emit(rows.map((r) => (r.id === id ? { ...r, keys } : r)));
  };
  const reset = () => emit(DEFAULT_SHORTCUTS.map((r) => ({ ...r })));
  return (
    <Card data-testid="shortcut-tab">
      <CardHeader>
        <CardTitle className="text-[13px]">快捷键</CardTitle>
        <CardDescription>
          仅本地校验格式与重复；Ctrl+F 只在文档面板内生效，修改不会保存或改变实际按键
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{r.label}</span>
            <Input
              className="h-8"
              value={r.keys}
              onChange={(e) => setKeys(r.id, e.target.value)}
              aria-label={`${r.label}快捷键`}
            />
          </div>
        ))}
        {err ? <div className="text-xs text-destructive">{err}</div> : null}
        <div>
          <Button size="default" variant="outline" onClick={reset}>
            恢复默认
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { DEFAULT_SHORTCUTS };
