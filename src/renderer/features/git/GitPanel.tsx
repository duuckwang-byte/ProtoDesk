/**
 * features/git/GitPanel.tsx — Git 全量面板（Wave3-05：配置/分支/差异/取消 + 自愈）。
 *
 * 结构保持方案 §8.1/Phase 6：可折叠项目卡片 + 原型分组 + 树形文件复选框行，
 * 行级增删统计（后端未提供 numstat 时不编造）、三态勾选、顶部等高筛选栏；
 * 全程卡片 + 复选框行，无二维网格组件。
 *
 * 主窗以 660px 居中 Dialog 承载：顶部工具区拆为“分支/筛选/操作”三行，660px 下不换行；
 * 文件行带 FileText 图标、原型分组带 Folder 图标，项目头显示“已选/总数”。
 *
 * 通道统一经 ./git-api（11 条 git 冻结通道，不新增）：状态 / 差异同结构复用卡片树；
 * 分支下拉走 listBranches（remoteConfigured=false 时提示先配置）；
 * 操作期间轮询 isBusy 并显示取消；远端为空时提示先配置；
 * destructive（拉取覆盖 / 自愈修复）经 Confirm，通知走 ui-store pushToast。
 */

import * as React from "react";
import { FileText, Folder, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Confirm } from "@/components/overlays/Confirm";
import { useUiStore } from "@/stores/ui-store";
import { GitConfigDialog } from "./GitConfigDialog";
import * as git from "./git-api";
import type { GitConfig, GitFile, GitProjectTree } from "./git-api";

export type { GitFile, GitProtoGroup } from "./git-api";
export type GitProject = GitProjectTree;

export interface GitPanelProps {
  project: string;
  branch?: string;
  onChanged?: () => void;
}

type TriState = boolean | "indeterminate";
type ViewMode = "status" | "diff";
type OpKind = "push" | "pull" | "heal";

function triState(selected: number, total: number): TriState {
  if (selected <= 0) return false;
  if (selected >= total) return true;
  return "indeterminate";
}

function statusTone(code: string): string {
  if (code === "add") return "bg-emerald-600 text-white";
  if (code === "del") return "bg-destructive text-destructive-foreground";
  if (code === "conflict") return "bg-amber-700 text-white";
  if (code === "mod") return "bg-amber-500 text-white";
  return "bg-muted text-muted-foreground";
}

/** 路径展示：目录前缀弱化，文件名正常。 */
function SplitPath({ path }: { path: string }) {
  const i = path.lastIndexOf("/");
  if (i < 0) return <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{path}</span>;
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
      <span className="text-muted-foreground/70">{path.slice(0, i + 1)}</span>
      <span>{path.slice(i + 1)}</span>
    </span>
  );
}

/** 行级增删行数：有数值展示 +n/−n，无数值仅保留状态徽标（后端暂未提供 numstat 时不编造）。 */
function LineStats({ file }: { file: GitFile }) {
  const hasAdd = typeof file.additions === "number";
  const hasDel = typeof file.deletions === "number";
  if (!hasAdd && !hasDel) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px]">
      {hasAdd ? <span className="text-emerald-600">+{file.additions}</span> : null}
      {hasDel ? <span className="text-destructive">−{file.deletions}</span> : null}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "add", label: "新增" },
  { value: "mod", label: "修改" },
  { value: "del", label: "删除" },
  { value: "conflict", label: "冲突" },
];

function errorText(r: { error?: string; code?: string }): string {
  const message = r.error || "未知错误";
  return r.code && !message.includes(r.code) ? `${message}（${r.code}）` : message;
}

/** NEED_AUTH 补充引导：本地 bare 夹具可填假 token，但仍须先保存。 */
function authHint(code?: string): string {
  return code === "NEED_AUTH"
    ? " 请先在“仓库设置”中保存访问令牌；本地 bare 夹具可填任意假 token（勿用真实凭据）。"
    : "";
}

/** Git 面板：配置 / 分支 / 本地变更 / 远端差异 / 上传 / 拉取 / 自愈 / 取消。 */
export function GitPanel({ project, branch = "main", onChanged }: GitPanelProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [config, setConfig] = React.useState<GitConfig | null>(null);
  const [configOpen, setConfigOpen] = React.useState(false);
  const [curBranch, setCurBranch] = React.useState(branch);
  const [branches, setBranches] = React.useState<string[]>([branch]);
  const [remoteConfigured, setRemoteConfigured] = React.useState<boolean | null>(null);
  const [branchLoading, setBranchLoading] = React.useState(false);
  const [projects, setProjects] = React.useState<GitProjectTree[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [diffProjects, setDiffProjects] = React.useState<GitProjectTree[]>([]);
  const [diffCount, setDiffCount] = React.useState(0);
  const [mode, setMode] = React.useState<ViewMode>("status");
  const [loading, setLoading] = React.useState(false);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [message, setMessage] = React.useState("");
  const [localOp, setLocalOp] = React.useState<OpKind | null>(null);
  const [remoteBusy, setRemoteBusy] = React.useState(false);
  const [confirmKind, setConfirmKind] = React.useState<"pull" | "heal" | null>(null);
  const [needHeal, setNeedHeal] = React.useState<string | null>(null);
  const metaSeq = React.useRef(0);
  const statusSeq = React.useRef(0);
  const diffSeq = React.useRef(0);

  const operationBusy = localOp !== null || remoteBusy;

  /** 读取配置 + 分支（远端未配置时 listBranches 只回本地分支）。 */
  const loadMeta = React.useCallback(async () => {
    const seq = ++metaSeq.current;
    if (!project) {
      setConfig(null);
      setBranches([branch]);
      setRemoteConfigured(null);
      setNeedHeal(null);
      return;
    }
    const cfgRes = await git.configGet(project);
    if (seq !== metaSeq.current) return;
    if (cfgRes.ok) {
      setConfig(cfgRes.config ?? null);
      if (cfgRes.config?.branch) setCurBranch(cfgRes.config.branch);
    } else {
      setConfig(null);
      if (cfgRes.code === "NEED_HEAL") {
        setNeedHeal(cfgRes.error || "仓库需要自愈修复");
      } else {
        pushToast({ title: `Git 配置读取失败：${errorText(cfgRes)}` });
      }
    }

    setBranchLoading(true);
    try {
      const br = await git.listBranches({ project });
      if (seq !== metaSeq.current) return;
      if (br.ok || br.code === "NEED_HEAL") {
        const list = Array.isArray(br.branches) ? br.branches.filter((b) => typeof b === "string" && b) : [];
        setBranches((prev) => {
          const merged: string[] = [];
          for (const item of [...prev, ...list, br.currentBranch || "", branch]) {
            if (item && !merged.includes(item)) merged.push(item);
          }
          return merged.length ? merged : [branch];
        });
        if (br.currentBranch) setCurBranch(br.currentBranch);
        if (typeof br.remoteConfigured === "boolean") setRemoteConfigured(br.remoteConfigured);
        if (br.code === "NEED_HEAL") setNeedHeal(br.error || "仓库需要自愈修复");
      } else if (br.code === "NEED_CONFIG") {
        setRemoteConfigured(false);
      } else {
        pushToast({ title: `Git 分支读取失败：${errorText(br)}${authHint(br.code)}` });
      }
    } finally {
      if (seq === metaSeq.current) setBranchLoading(false);
    }
  }, [project, branch, pushToast]);

  const refreshStatus = React.useCallback(async () => {
    const seq = ++statusSeq.current;
    if (!project) {
      setProjects([]);
      setTotalCount(0);
      return;
    }
    setLoading(true);
    try {
      const r = await git.status(project, curBranch);
      if (seq !== statusSeq.current) return;
      if (r.ok) {
        setProjects(Array.isArray(r.projects) ? r.projects : []);
        setTotalCount(typeof r.totalCount === "number" ? r.totalCount : 0);
        if (r.branch) setCurBranch((prev) => (prev === r.branch ? prev : (r.branch as string)));
        setNeedHeal(null);
      } else {
        setProjects([]);
        setTotalCount(0);
        if (r.code === "NEED_HEAL") {
          setNeedHeal(r.error || "仓库需要自愈修复");
          pushToast({ title: `Git 仓库需要自愈修复：${errorText(r)}` });
        } else if (r.code === "NEED_CONFIG") {
          setRemoteConfigured(false);
        } else {
          pushToast({ title: `Git 状态读取失败：${errorText(r)}` });
        }
      }
    } finally {
      if (seq === statusSeq.current) setLoading(false);
    }
  }, [project, curBranch, pushToast]);

  const refreshDiff = React.useCallback(async () => {
    const seq = ++diffSeq.current;
    if (!project) {
      setDiffProjects([]);
      setDiffCount(0);
      return;
    }
    setDiffLoading(true);
    try {
      const r = await git.fetchDiff(project, curBranch);
      if (seq !== diffSeq.current) return;
      if (r.ok) {
        setDiffProjects(Array.isArray(r.projects) ? r.projects : []);
        setDiffCount(typeof r.totalCount === "number" ? r.totalCount : 0);
        if (r.branch) setCurBranch((prev) => (prev === r.branch ? prev : (r.branch as string)));
        setNeedHeal(null);
      } else {
        setDiffProjects([]);
        setDiffCount(0);
        if (r.code === "NEED_CONFIG") {
          setRemoteConfigured(false);
        } else if (r.code === "NEED_HEAL") {
          setNeedHeal(r.error || "仓库需要自愈修复");
        } else {
          pushToast({ title: `Git 差异读取失败：${errorText(r)}` });
        }
      }
    } finally {
      if (seq === diffSeq.current) setDiffLoading(false);
    }
  }, [project, curBranch, pushToast]);

  // 项目切换：重读配置/分支；清空选择。
  React.useEffect(() => {
    setSelected(new Set());
    setMessage("");
    setMode("status");
    setProjects([]);
    setTotalCount(0);
    setDiffProjects([]);
    setDiffCount(0);
    if (!project) {
      setConfig(null);
      setBranches([branch]);
      setRemoteConfigured(null);
      setNeedHeal(null);
      return;
    }
    setCurBranch(branch);
    setBranches([branch]);
    setRemoteConfigured(null);
    void loadMeta();
  }, [project, branch, loadMeta]);

  // 分支 / 视图切换：按当前视图拉数据。
  React.useEffect(() => {
    if (!project) return;
    if (mode === "diff") void refreshDiff();
    else void refreshStatus();
  }, [project, mode, curBranch, refreshStatus, refreshDiff]);

  // 操作期轮询 isBusy；空闲时也做一次探测，接管外部操作（如上次未结束的 push）。
  React.useEffect(() => {
    if (!project) return;
    let alive = true;
    const tick = async () => {
      const busy = await git.isBusy();
      if (alive) setRemoteBusy(busy);
    };
    void tick();
    if (localOp === null && !remoteBusy) {
      return () => {
        alive = false;
      };
    }
    const timer = window.setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [project, localOp, remoteBusy]);

  const displayProjects = mode === "diff" ? diffProjects : projects;
  const displayLoading = mode === "diff" ? diffLoading : loading;
  const displayCount = mode === "diff" ? diffCount : totalCount;
  const selectable = mode === "status";

  const visible = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    return displayProjects
      .map((p) => ({
        ...p,
        protos: p.protos
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => {
              if (statusFilter && f.code !== statusFilter) return false;
              if (!q) return true;
              return f.path.toLowerCase().includes(q) || f.proto.toLowerCase().includes(q);
            }),
          }))
          .filter((g) => g.files.length > 0),
      }))
      // 过滤后没有文件的项目不渲染空卡片（P2：避免「已选 0/0」残影）。
      .filter((p) => p.protos.length > 0);
  }, [displayProjects, filter, statusFilter]);

  const filterActive = filter.trim() !== "" || statusFilter !== "";
  const visibleFileCount = React.useMemo(
    () => visible.reduce((sum, p) => sum + p.protos.reduce((n, g) => n + g.files.length, 0), 0),
    [visible],
  );
  // 有筛选/搜索时计数跟随可见结果，无结果即 0；未筛选时沿用后端总数。
  const shownCount = filterActive ? visibleFileCount : displayCount;

  const togglePath = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleMany = (paths: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (on) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  };

  const selectedList = React.useMemo(() => [...selected], [selected]);

  const reloadAll = async () => {
    await loadMeta();
    if (mode === "diff") await refreshDiff();
    else await refreshStatus();
  };

  const doPush = async () => {
    if (!project || operationBusy) return;
    if (!config?.remoteUrl) {
      pushToast({ title: "尚未配置远程仓库，请先在“仓库设置”中填写远端地址。" });
      setConfigOpen(true);
      return;
    }
    setLocalOp("push");
    try {
      const r = await git.push({
        project,
        branch: curBranch,
        files: selectedList,
        message: message.trim() || "更新原型与文档数据",
      });
      if (r.ok) {
        pushToast({
          title: r.message || `发布成功${typeof r.filesCount === "number" ? `（${r.filesCount} 个文件）` : ""}。`,
        });
        setSelected(new Set());
        setMessage("");
        await refreshStatus();
        onChanged?.();
      } else {
        pushToast({ title: `发布失败：${errorText(r)}${authHint(r.code)}` });
        if (r.code === "NEED_HEAL") setNeedHeal(r.error || "仓库需要自愈修复");
        if (r.code === "NEED_CONFIG") setConfigOpen(true);
      }
    } finally {
      setLocalOp(null);
    }
  };

  const doPull = async () => {
    if (!project || operationBusy) return;
    if (!config?.remoteUrl) {
      pushToast({ title: "尚未配置远程仓库，请先在“仓库设置”中填写远端地址。" });
      setConfigOpen(true);
      return;
    }
    setLocalOp("pull");
    try {
      const r = await git.pull({
        project,
        branch: curBranch,
        files: selectedList.length ? selectedList : null,
        backup: true,
      });
      if (r.ok) {
        const backup = r.backupPath ? `，本地旧版已备份到 ${r.backupPath}` : "";
        pushToast({
          title: r.message || `同步成功${typeof r.filesCount === "number" ? `（${r.filesCount} 个文件）` : ""}${backup}。`,
        });
        await refreshStatus();
        if (mode === "diff") await refreshDiff();
        onChanged?.();
      } else {
        pushToast({ title: `同步失败：${errorText(r)}${authHint(r.code)}` });
        if (r.code === "NEED_HEAL") setNeedHeal(r.error || "仓库需要自愈修复");
        if (r.code === "NEED_CONFIG") setConfigOpen(true);
      }
    } finally {
      setLocalOp(null);
      setConfirmKind(null);
    }
  };

  const doHeal = async () => {
    if (!project || operationBusy) return;
    setLocalOp("heal");
    try {
      const r = await git.healRepair(project);
      if (r.ok) {
        const count = Array.isArray(r.healed) ? r.healed.length : 0;
        pushToast({
          title: `自愈完成${r.backupDir ? `（已备份 ${count} 处到 ${r.backupDir}）` : ""}。`,
        });
        setNeedHeal(null);
        await loadMeta();
        await refreshStatus();
        if (mode === "diff") await refreshDiff();
        onChanged?.();
      } else {
        pushToast({ title: `自愈失败：${errorText(r)}` });
      }
    } finally {
      setLocalOp(null);
      setConfirmKind(null);
    }
  };

  const doCancel = async () => {
    const r = await git.cancel();
    if (r.ok) {
      pushToast({ title: r.cancelled ? `已取消 ${r.op || "Git"} 操作。` : "当前没有进行中的 Git 操作。" });
      setRemoteBusy(false);
      setLocalOp(null);
      await refreshStatus();
    } else {
      pushToast({ title: `取消失败：${errorText(r)}` });
    }
  };

  const busyLabel =
    localOp === "push" ? "发布中…" : localOp === "pull" ? "同步中…" : localOp === "heal" ? "修复中…" : "Git 操作进行中…";

  const missingRemote = !!project && config !== null && !config.remoteUrl;
  const pushDisabled =
    !project || operationBusy || !config?.remoteUrl || !selectable || selectedList.length === 0;
  const pullDisabled = !project || operationBusy || !config?.remoteUrl;
  const healDisabled = !project || operationBusy;

  return (
    <Card
      data-testid="git-panel"
      className="flex h-full min-h-0 flex-col gap-0 rounded-none border-0 bg-transparent shadow-none"
    >
      <CardHeader className="shrink-0 gap-2 border-b border-border px-5 py-3">
        {/* 行 1：分支 / 变更总数 / 仓库动作（660px 下不换行） */}
        <div className="flex flex-nowrap items-center gap-2" data-testid="git-toolbar">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <select
            data-testid="git-branch-select"
            aria-label="分支"
            value={curBranch}
            onChange={(e) => {
              setCurBranch(e.target.value);
              setSelected(new Set());
            }}
            disabled={!project || branchLoading || operationBusy}
            className="h-8 w-[120px] shrink-0 rounded-md border border-input bg-background px-2 text-xs outline-none"
          >
            {!branches.includes(curBranch) ? <option value={curBranch}>{curBranch}</option> : null}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <Badge variant="outline" data-testid="git-total" className="shrink-0 tabular-nums">
            {shownCount} 处变更
          </Badge>
          {branchLoading && !operationBusy ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">读取中…</span>
          ) : null}
          {operationBusy ? (
            <Badge variant="outline" data-testid="git-busy" className="shrink-0">
              {busyLabel}
            </Badge>
          ) : null}
          <span className="ml-auto" />
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            data-testid="git-config-open"
            disabled={!project || operationBusy}
            onClick={() => setConfigOpen(true)}
          >
            仓库设置
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0"
            data-testid="git-refresh"
            disabled={!project || displayLoading || operationBusy}
            onClick={() => void reloadAll()}
          >
            {displayLoading ? "读取中…" : "刷新"}
          </Button>
          {operationBusy ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              data-testid="git-cancel"
              onClick={() => void doCancel()}
            >
              取消操作
            </Button>
          ) : null}
        </div>

        {/* 行 2：视图 / 搜索 / 状态筛选（搜索占满剩余宽度） */}
        <div className="flex flex-nowrap items-center gap-2" data-testid="git-filterbar">
          <div className="inline-flex h-8 shrink-0 items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              data-testid="git-mode-status"
              aria-pressed={mode === "status"}
              onClick={() => {
                setMode("status");
                setSelected(new Set());
              }}
              className={`h-7 rounded px-2 text-[11px] ${
                mode === "status" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              本地变更
            </button>
            <button
              type="button"
              data-testid="git-mode-diff"
              aria-pressed={mode === "diff"}
              onClick={() => {
                setMode("diff");
                setSelected(new Set());
              }}
              className={`h-7 rounded px-2 text-[11px] ${
                mode === "diff" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              差异预览
            </button>
          </div>
          <Input
            data-testid="git-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="筛选路径/原型…"
            className="h-8 min-w-0 flex-1"
          />
          <select
            data-testid="git-status-filter"
            aria-label="状态筛选"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 w-[96px] shrink-0 rounded-md border border-input bg-background px-2 text-xs outline-none"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* 行 3：提交说明 / 上传 / 拉取 / 自愈（操作按钮不参与换行） */}
        <div className="flex flex-nowrap items-center gap-2" data-testid="git-actionbar">
          <Input
            data-testid="git-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="提交说明（可空）"
            className="h-8 min-w-0 flex-1"
            disabled={!selectable || operationBusy}
          />
          <Button
            size="sm"
            className="h-8 shrink-0"
            data-testid="git-push"
            disabled={pushDisabled}
            title={mode === "diff" ? "差异预览仅供查看，请切回“本地变更”勾选文件" : undefined}
            onClick={() => void doPush()}
          >
            {localOp === "push" ? "发布中…" : `上传发布${selectedList.length ? `（${selectedList.length}）` : ""}`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            data-testid="git-pull"
            disabled={pullDisabled}
            onClick={() => setConfirmKind("pull")}
          >
            拉取同步
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0"
            data-testid="git-heal"
            disabled={healDisabled}
            onClick={() => setConfirmKind("heal")}
          >
            自愈修复
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-5 pt-3">
        {!project ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="git-no-project">
            当前没有选中项目，请先进入项目后再使用 Git 协同。
          </div>
        ) : null}

        {project && missingRemote ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-800"
            data-testid="git-need-config"
          >
            <span>尚未配置远程仓库，上传/拉取不可用。请先填写远端地址。</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setConfigOpen(true)}>
              去配置
            </Button>
          </div>
        ) : null}

        {project && remoteConfigured === false && !missingRemote ? (
          <p className="text-[11px] text-muted-foreground" data-testid="git-branch-hint">
            未配置远端，仅显示本地分支；配置远端后可拉取远端分支。
          </p>
        ) : null}

        {project && needHeal ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
            data-testid="git-need-heal"
          >
            <span>仓库需要自愈修复：{needHeal}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={operationBusy}
              onClick={() => setConfirmKind("heal")}
            >
              立即修复
            </Button>
          </div>
        ) : null}

        {project && mode === "diff" ? (
          <p className="text-[11px] text-muted-foreground" data-testid="git-diff-hint">
            差异预览：远端分支相对本地 HEAD 的变更，仅供查看；勾选发布请切回“本地变更”。
          </p>
        ) : null}

        {project ? (
          visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="git-empty">
              {displayLoading
                ? mode === "diff"
                  ? "正在比对远端差异…"
                  : "正在读取变更…"
                : filterActive
                  ? "没有匹配的变更。"
                  : mode === "diff"
                    ? "远端暂无差异。"
                    : "工作区干净，无待发布变更。"}
            </div>
          ) : (
            visible.map((p) => {
              const allPaths = p.protos.flatMap((g) => g.files.map((f) => f.path));
              const selCount = allPaths.filter((x) => selected.has(x)).length;
              return (
                <Collapsible
                  key={p.project}
                  defaultOpen={p.isCurrent}
                  data-testid="git-project-card"
                  className="rounded-lg border border-border"
                >
                  <div className="flex items-center gap-2 px-3 py-2" data-testid="git-project-head">
                    <Checkbox
                      checked={triState(selCount, allPaths.length)}
                      onCheckedChange={(v) => toggleMany(allPaths, v)}
                      disabled={!selectable || operationBusy}
                      aria-label={`全选项目 ${p.project}`}
                    />
                    <CollapsibleTrigger className="min-w-0 flex-1 text-left text-[13px] font-semibold">
                      <span className="truncate">{p.project}</span>
                    </CollapsibleTrigger>
                    {p.isCurrent ? <Badge className="shrink-0">当前项目</Badge> : null}
                    <Badge
                      variant="outline"
                      data-testid="git-project-count"
                      data-selected={selCount}
                      data-total={allPaths.length}
                      className="shrink-0 font-mono text-[10.5px] tabular-nums"
                    >
                      已选 {selCount}/{allPaths.length}
                    </Badge>
                  </div>
                  <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
                    {p.protos.map((g) => {
                      const gPaths = g.files.map((f) => f.path);
                      const gSel = gPaths.filter((x) => selected.has(x)).length;
                      return (
                        <div key={g.proto} className="rounded-md bg-muted/40 p-2" data-testid="git-proto-group">
                          <div className="flex items-center gap-2 px-1 pb-1">
                            <Checkbox
                              checked={triState(gSel, gPaths.length)}
                              onCheckedChange={(v) => toggleMany(gPaths, v)}
                              disabled={!selectable || operationBusy}
                              aria-label={`全选原型 ${g.proto}`}
                            />
                            <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate text-xs font-medium">{g.proto}</span>
                            <Badge variant="outline" className="ml-auto shrink-0">
                              {g.files.length}
                            </Badge>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {g.files.map((f) => (
                              <label
                                key={f.path}
                                data-testid="git-file-row"
                                data-path={f.path}
                                data-code={f.code}
                                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-accent"
                              >
                                <Checkbox
                                  checked={selected.has(f.path)}
                                  onCheckedChange={() => togglePath(f.path)}
                                  disabled={!selectable || operationBusy}
                                  aria-label={f.path}
                                />
                                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${statusTone(f.code)}`}>
                                  {f.label || f.code}
                                </span>
                                <SplitPath path={f.path} />
                                <LineStats file={f} />
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )
        ) : null}
      </CardContent>

      <GitConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        project={project}
        onSaved={(cfg) => {
          setConfig(cfg);
          setNeedHeal(null);
          void reloadAll();
        }}
      />

      <Confirm
        open={confirmKind !== null}
        onOpenChange={(next) => !next && !operationBusy && setConfirmKind(null)}
        title={confirmKind === "pull" ? "拉取同步" : "自愈修复"}
        description={
          confirmKind === "pull"
            ? "拉取远端并合并到本地，未提交的修改可能被覆盖（已自动备份）。确定继续吗？"
            : "自愈修复将先备份再重建/修复本地仓库配置，确定继续吗？"
        }
        confirmText={confirmKind === "pull" ? "拉取" : "修复"}
        loading={operationBusy}
        onConfirm={async () => {
          if (confirmKind === "pull") await doPull();
          else await doHeal();
        }}
      />
    </Card>
  );
}

export default GitPanel;
