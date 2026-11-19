import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * features/settings/SandboxTab.tsx — 沙箱设置（W3-06 真实数据）。
 *
 * sandbox root 由主进程 sandbox:list 返回，是项目/原型/文档的落盘根目录；
 * 设置页只读展示，不再用本地默认空目录冒充真实值。
 */

export interface SandboxTabProps {
  root?: string;
  loading?: boolean;
  error?: string | null;
}

export function SandboxTab({ root = '', loading = false, error = null }: SandboxTabProps) {
  const shown = root.trim();
  return (
    <Card data-testid="sandbox-tab">
      <CardHeader>
        <CardTitle className="text-[13px]">沙箱</CardTitle>
        <CardDescription>项目、原型与文档的落盘根目录（来自主进程，只读）</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">沙箱根目录</span>
          <div
            className="break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11.5px]"
            data-testid="sandbox-root"
          >
            {shown || (loading ? '正在读取…' : '未获取到沙箱目录')}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">sandbox:list</Badge>
          <span>路径由主进程返回，设置页不提供修改入口。</span>
        </div>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </CardContent>
    </Card>
  );
}
