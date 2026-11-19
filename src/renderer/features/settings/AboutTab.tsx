import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * features/settings/AboutTab.tsx — 关于（纯展示，无表单无校验）。
 * 版本号来自主进程 app:get-version，不再写死。
 */

export interface AboutTabProps {
  version?: string;
  loading?: boolean;
}

export function AboutTab({ version = '', loading = false }: AboutTabProps) {
  const shown = version.trim();
  return (
    <Card data-testid="about-tab">
      <CardHeader>
        <CardTitle className="text-[13px]">关于</CardTitle>
        <CardDescription>版本与通道信息（只读）</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">版本</span>
          <Badge variant="secondary" data-testid="about-version">
            {shown ? `v${shown}` : loading ? '读取中…' : '未知'}
          </Badge>
          <Badge variant="outline">renderer: react</Badge>
        </div>
        <div className="text-muted-foreground">
          旧渲染器（原型+文档.html）保留为 fallback；设置/模型走新 React 实现，本地键原样读写。
        </div>
      </CardContent>
    </Card>
  );
}
