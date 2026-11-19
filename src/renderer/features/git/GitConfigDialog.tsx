/**
 * features/git/GitConfigDialog.tsx — Git 仓库设置弹窗（Wave3-05）。
 *
 * 字段对齐 `git:config-get` 的脱敏 config：remoteUrl / branch / authorName /
 * authorEmail / hasToken / tokenMasked；token 只写不回显（留空 = 不更新）。
 * 保存发 `{project,config}`；测试连接显示 latency；远端为空时提示先配置。
 * 通道统一经 ./git-api，不新增 IPC。
 *
 * 远端地址前端只做协议/语法预检：https:// 与开发态 file:/// 绝对路径放行，
 * http/ssh/scp/裸路径仍直接拒绝；file:/// 是否真正可用（未打包 + PLAND_GIT_ALLOW_LOCAL=1 +
 * bare 仓库）由主进程 git/auth.js 最终判定，拒绝时原样展示后端 GIT_URL_BLOCKED。
 */

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui-store";
import * as git from "./git-api";
import type { GitConfig } from "./git-api";

export interface GitConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  /** 保存成功后回传主进程脱敏视图。 */
  onSaved?: (config: GitConfig) => void;
}

function errorText(r: { error?: string; code?: string }): string {
  const message = r.error || "未知错误";
  return r.code && !message.includes(r.code) ? `${message}（${r.code}）` : message;
}

/**
 * file:/// 本地 bare 夹具的语法预检（不访问文件系统，安全判定仍在主进程）。
 * 仅放行三斜杠绝对路径：`file:///C:/Temp/pland-fixture/repo.git`。
 * @param {string} s 已确认以 file:// 开头的地址
 * @returns {string} 空串 = 语法通过；非空 = 展示给用户的错误文案
 */
function localFixtureUrlMsg(s: string): string {
  if (!/^file:\/\/\//i.test(s)) {
    return "file:// 仅支持 file:/// 绝对路径（如 file:///C:/Temp/pland-fixture/repo.git），不支持主机名或 UNC";
  }
  if (/\\/.test(s)) return "file:// 路径不得含反斜杠，请改用正斜杠（如 file:///C:/Temp/repo.git）";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "不是合法 URL";
  }
  if (u.protocol.toLowerCase() !== "file:") return "仅支持 file:/// 协议";
  if (u.host) return "file:// 不支持主机名或共享路径（UNC）";
  if (u.username || u.password) return "地址中不得携带用户名/口令";
  if (u.search || u.hash) return "file:// 地址不得携带查询参数或片段";
  if (!u.pathname || u.pathname === "/") return "file:// 地址缺少仓库路径";
  // file:////server/share 解析后 pathname 以 // 开头，按 UNC 拒绝
  if (u.pathname.slice(1).startsWith("/")) return "file:// 不支持 UNC/双斜杠路径";
  // URL 解析会归一化点段，故先按原始段拦截 .. / .（含 %2e 编码）
  for (const seg of s.split("/").slice(3)) {
    let ds = seg;
    try {
      ds = decodeURIComponent(seg);
    } catch {
      return "file:// 路径编码非法";
    }
    if (ds === ".." || ds === ".") return "file:// 路径不得含 .. 或 . 段";
    if (ds.includes("/")) return "file:// 路径不得含编码斜杠";
    if (/[\u0000-\u001f\u007f]/.test(ds)) return "file:// 路径含控制字符";
    if (ds.includes("\\")) return "file:// 路径含非法字符";
  }
  // 绝对路径：Windows 盘符（file:///C:/...）或 POSIX 绝对路径（file:///home/...）
  if (/^\/[A-Za-z]:/.test(u.pathname) && !/^\/[A-Za-z]:\//.test(u.pathname)) {
    return "Windows 盘符路径须写成 file:///C:/...（盘符后要有斜杠）";
  }
  if (!/^\/[A-Za-z]:\//.test(u.pathname) && !/^\/[^/]/.test(u.pathname)) {
    return "file:// 路径须为绝对路径";
  }
  return "";
}

/**
 * 远端地址前端预检：仅做协议/语法拦截，最终安全由主进程 `git:config-save` / test / push 判定。
 * 放行：https://；file:/// 绝对路径（开发态 bare 夹具，后端再校验 env 与真实目录）。
 * 拒绝：http://、ssh://、scp 形态、裸本地路径/UNC、带凭据的 https 等。
 * @param {string} raw 输入框原始地址
 * @returns {string} 空串 = 通过；非空 = 直接展示给用户的错误文案
 */
export function gitRemoteUrlMsg(raw: string): string {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "远程仓库地址必填（https://，或开发态本地夹具 file:///）";
  if (s.length > 500) return "地址长度超限（须 ≤500 字符）";
  if (/[\r\n\u2028\u2029]/.test(s)) return "地址不得含换行";
  if (/[\u0000-\u001f\u007f]/.test(s)) return "地址含控制字符";
  if (/\s/.test(s)) return "地址不得含空格";

  if (/^https:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return "不是合法 URL";
    }
    if (u.protocol.toLowerCase() !== "https:") return "仅支持 https:// 协议";
    if (!u.hostname) return "地址缺少主机名";
    if (u.username || u.password) return "地址中不得携带用户名/口令，请填在下方“访问令牌”";
    return "";
  }

  if (/^file:\/\//i.test(s)) return localFixtureUrlMsg(s);

  if (/^http:\/\//i.test(s)) return "不支持 http://，请使用 https:// 仓库地址";
  if (/^(ssh|git|ftp|ftps):\/\//i.test(s) || /^[^\s/@]+@[^\s/:]+:/.test(s)) {
    return "不支持 SSH/SCP 地址，仅支持 https://（开发态本地 bare 夹具可用 file:///）";
  }
  return "仅支持 https:// 或开发态 file:/// 本地 bare 仓库地址，不支持本地直接路径";
}

/** 仓库设置弹窗：加载脱敏配置 → 编辑 → 测试连接 / 保存。 */
export function GitConfigDialog({ open, onOpenChange, project, onSaved }: GitConfigDialogProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [remoteUrl, setRemoteUrl] = React.useState("");
  const [branch, setBranch] = React.useState("main");
  const [authorName, setAuthorName] = React.useState("");
  const [authorEmail, setAuthorEmail] = React.useState("");
  const [token, setToken] = React.useState("");
  const [hasToken, setHasToken] = React.useState(false);
  const [tokenMasked, setTokenMasked] = React.useState("");
  const [persistHint, setPersistHint] = React.useState("");
  const [latency, setLatency] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");

  const resetMessages = React.useCallback(() => {
    setError("");
    setNotice("");
    setLatency(null);
  }, []);

  /** 输入以 file: 开头时展示开发态夹具说明（是否真正可用由主进程判定）。 */
  const localFixtureInput = /^file:/i.test(remoteUrl.trim());

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    resetMessages();
    setToken("");
    setRemoteUrl("");
    setBranch("main");
    setAuthorName("");
    setAuthorEmail("");
    setHasToken(false);
    setTokenMasked("");
    setPersistHint("");
    if (!project) {
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    setLoading(true);
    void (async () => {
      const r = await git.configGet(project);
      if (!alive) return;
      if (r.ok && r.config) {
        const cfg = r.config;
        setRemoteUrl(cfg.remoteUrl || "");
        setBranch(cfg.branch || "main");
        setAuthorName(cfg.authorName || "");
        setAuthorEmail(cfg.authorEmail || "");
        setHasToken(!!cfg.hasToken);
        setTokenMasked(cfg.tokenMasked || "");
        setPersistHint(cfg.persistHint || "");
      } else {
        setError(errorText(r));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, project, resetMessages]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next && (saving || testing)) return;
      onOpenChange(next);
    },
    [saving, testing, onOpenChange],
  );

  /**
   * 嵌套弹层自行消费 Esc：只关本层，并阻止冒泡到 MainWindow 的 closeTopmost，
   * 避免一次 Esc 把下面的 Git 主面板一起关掉；X / 遮罩仍走 Dialog 的
   * onOpenChange（同样只关本层）。保存/测试连接中暂缓关闭，但 Esc 仍被本层吃掉。
   */
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleOpenChange]);

  const doTest = async () => {
    resetMessages();
    const url = remoteUrl.trim();
    if (!url) {
      setError("请先填写远程仓库地址");
      return;
    }
    const urlMsg = gitRemoteUrlMsg(url);
    if (urlMsg) {
      setError(urlMsg);
      return;
    }
    setTesting(true);
    try {
      const r = await git.testConnection({
        project,
        remoteUrl: url,
        branch: branch.trim() || "main",
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim(),
        token: token.trim() || undefined,
      });
      if (r.ok) {
        const ms = typeof r.latency === "number" ? r.latency : null;
        setLatency(ms);
        setNotice(ms === null ? "连接成功" : `连接成功 · ${ms}ms`);
      } else {
        setError(errorText(r));
        if (r.code === "NEED_AUTH") {
          setError(`${errorText(r)}。请先保存访问令牌后重试；本地 bare 夹具可填任意假 token。`);
        }
      }
    } finally {
      setTesting(false);
    }
  };

  const doSave = async () => {
    if (!project) {
      setError("请先进入项目后再配置仓库");
      return;
    }
    resetMessages();
    const url = remoteUrl.trim();
    // 空地址允许保存（用于清除远端）；非空地址先做前端语法预检，安全仍由主进程判定。
    if (url) {
      const urlMsg = gitRemoteUrlMsg(url);
      if (urlMsg) {
        setError(urlMsg);
        return;
      }
    }
    setSaving(true);
    try {
      const config: GitConfig = {
        remoteUrl: url,
        branch: branch.trim() || "main",
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim(),
      };
      if (token.trim()) config.token = token.trim();
      const r = await git.saveConfig({ project, config });
      if (r.ok) {
        const saved = r.config || config;
        setHasToken(!!saved.hasToken);
        setTokenMasked(saved.tokenMasked || "");
        setToken("");
        pushToast({ title: "Git 仓库配置已保存。" });
        onSaved?.(saved);
        onOpenChange(false);
      } else {
        setError(errorText(r));
        if (r.code === "NEED_HEAL") {
          setError(`${errorText(r)}。请关闭本弹窗后在 Git 面板点击“自愈修复”。`);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="git-config-dialog" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Git 仓库设置</DialogTitle>
          <DialogDescription>
            {project ? `项目：${project}` : "请先进入项目后再配置仓库。"}
          </DialogDescription>
        </DialogHeader>

        {!project ? (
          <div className="mt-3 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="git-config-no-project">
            当前没有选中项目，无法读取或保存 Git 配置。
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">远程仓库地址</span>
              <Input
                data-testid="git-config-remote"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://gitee.com/user/repo.git"
                className="h-8 font-mono text-[12px]"
                disabled={loading || saving}
              />
              <span className="text-[11px] text-muted-foreground" data-testid="git-config-remote-format-hint">
                生产仅支持 https://；file:/// 仅用于未打包开发态的本地 bare 夹具，需 PLAND_GIT_ALLOW_LOCAL=1，
                最终由主进程校验，生产环境会拒绝。
              </span>
              {!loading && !remoteUrl.trim() ? (
                <span className="text-[11px] text-amber-600" data-testid="git-config-remote-hint">
                  尚未配置远端，填写后才能测试连接与上传/拉取。
                </span>
              ) : null}
              {localFixtureInput ? (
                <span className="text-[11px] text-amber-600" data-testid="git-config-local-fixture-hint">
                  本地夹具示例：file:///C:/Temp/pland-fixture/repo.git。主进程会校验路径确实为 bare
                  仓库（含 HEAD/objects/refs 且 core.bare=true）；缺少开关或处于打包态时返回 GIT_URL_BLOCKED。
                </span>
              ) : null}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">分支</span>
                <Input
                  data-testid="git-config-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="h-8"
                  disabled={loading || saving}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">提交人姓名</span>
                <Input
                  data-testid="git-config-author-name"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="产品设计师"
                  className="h-8"
                  disabled={loading || saving}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">提交人邮箱</span>
                <Input
                  data-testid="git-config-author-email"
                  value={authorEmail}
                  onChange={(e) => setAuthorEmail(e.target.value)}
                  placeholder="designer@local"
                  className="h-8"
                  disabled={loading || saving}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="flex items-center gap-2 font-medium">
                  访问令牌
                  <Badge variant="outline" data-testid="git-config-token-state">
                    {hasToken ? `已配置 ${tokenMasked || "****"}` : "未配置"}
                  </Badge>
                </span>
                <Input
                  data-testid="git-config-token"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    hasToken
                      ? "已配置，留空不更新"
                      : localFixtureInput
                        ? "本地夹具可填任意假 token"
                        : "填写个人访问令牌"
                  }
                  className="h-8"
                  disabled={loading || saving}
                />
              </label>
            </div>

            {localFixtureInput ? (
              <p className="text-[11px] text-amber-600" data-testid="git-config-local-token-hint">
                本地 bare 夹具不校验真实令牌，但测试连接/上传/拉取要求已保存 Token（否则返回
                NEED_AUTH）；可填任意假 token，请勿使用真实凭据。
              </p>
            ) : null}

            {persistHint ? (
              <p className="text-[11px] text-amber-600" data-testid="git-config-persist-hint">
                {persistHint}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                data-testid="git-test-connection"
                disabled={loading || saving || testing}
                onClick={() => void doTest()}
              >
                {testing ? "测试中…" : "测试连接"}
              </Button>
              <span className="text-[11px] text-muted-foreground" data-testid="git-test-latency">
                {latency === null ? "" : `延迟 ${latency}ms`}
              </span>
            </div>

            {notice ? (
              <p className="text-[11px] text-emerald-600" data-testid="git-config-notice">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="text-[11px] text-destructive" data-testid="git-config-error">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            data-testid="git-config-cancel"
            disabled={saving || testing}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="h-8"
            data-testid="git-config-save"
            disabled={!project || loading || saving || testing}
            onClick={() => void doSave()}
          >
            {saving ? "保存中…" : "保存配置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GitConfigDialog;
