/**
 * features/git/git-api.ts — Git 11 条冻结通道薄封装（Wave3-05）。
 *
 * 只做参数透传与 {ok,error} 归一，不含业务分支，不新增 IPC 通道：
 * config-get / config-save / test-connection / list-branches / status /
 * fetch-diff / push / pull / is-busy / cancel / heal-repair。
 *
 * 例外：主进程 `git:is-busy` 返回 `{busy,currentOp}`（无 ok 字段），
 * 走 invokeProtoMethod 会被归一成 `{ok:false,error:'bad-ipc-result'}` 并丢掉 busy，
 * 因此这里直连 protoAPI 并收敛为 boolean（供轮询使用）。
 */

import { getProtoApi, invokeProtoMethod } from "@/lib/ipc";

/** git:config-get / config-save 的脱敏配置视图（无 token 明文字段）。 */
export interface GitConfig {
  remoteUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  /** 仅供保存时提交的新 token（空 = 不更新，主进程不落盘）。 */
  token?: string;
  hasToken?: boolean;
  tokenMasked?: string;
  hasUsername?: boolean;
  username?: string;
  persistHint?: string;
}

/** git:status / git:fetch-diff 的文件条目（后端暂未提供 numstat）。 */
export interface GitFile {
  path: string;
  project: string;
  proto: string;
  subPath: string;
  code: string;
  label: string;
  additions?: number;
  deletions?: number;
}

/** git:status / git:fetch-diff 的原型分组。 */
export interface GitProtoGroup {
  proto: string;
  files: GitFile[];
}

/** git:status / git:fetch-diff 的项目卡片。 */
export interface GitProjectTree {
  project: string;
  isCurrent?: boolean;
  protos: GitProtoGroup[];
}

/** 统一返回：保留业务载荷，并保证 ok 必为 boolean、失败必有 error 文案。 */
export type GitResult<T extends object = Record<string, unknown>> = T & {
  ok: boolean;
  error?: string;
  code?: string;
};

/** git:push 入参。 */
export interface GitPushInput {
  project: string;
  branch: string;
  files: string[];
  message?: string;
  force?: boolean;
}

/** git:pull 入参（files 为空 = 拉取全部）。 */
export interface GitPullInput {
  project: string;
  branch: string;
  files?: string[] | null;
  backup?: boolean;
}

export interface GitTestConnectionInput {
  project: string;
  remoteUrl: string;
  branch?: string;
  authorName?: string;
  authorEmail?: string;
  username?: string;
  token?: string;
}

export interface GitListBranchesInput {
  project: string;
  remoteUrl?: string;
}

export interface GitConfigData {
  config?: GitConfig;
}

export interface GitBranchesData {
  branches?: string[];
  currentBranch?: string;
  remoteConfigured?: boolean;
}

export interface GitStatusData {
  projects?: GitProjectTree[];
  totalCount?: number;
  branch?: string;
}

export interface GitTestConnectionData {
  latency?: number;
}

export interface GitPushData {
  message?: string;
  filesCount?: number;
  branch?: string;
  forced?: boolean;
}

export interface GitPullData {
  message?: string;
  filesCount?: number;
  affectedProjects?: string[];
  failed?: unknown[];
  backupPath?: string;
  branch?: string;
}

export interface GitCancelData {
  cancelled?: boolean;
  op?: string | null;
}

export interface GitHealData {
  backupDir?: string;
  healed?: unknown[];
  nested?: string[];
}

export interface GitConfigSaveData extends GitConfigData {
  reason?: string;
  nested?: string[];
  detail?: string;
}

/**
 * 调用一条 git 通道并归一化。
 * @param {string} method preload 的 git 方法名
 * @param {unknown[]} args 透传参数
 * @returns {Promise<GitResult<T>>} ok 必为 boolean；失败时 error 回落到 code 或通用文案
 */
async function callGit<T extends object>(method: string, ...args: unknown[]): Promise<GitResult<T>> {
  const raw = (await invokeProtoMethod("git", method, ...args)) as unknown as Record<string, unknown>;
  const ok = raw.ok === true;
  const code = typeof raw.code === "string" ? raw.code : undefined;
  const errorText = typeof raw.error === "string" && raw.error ? raw.error : undefined;
  const out = { ...(raw as T), ok } as GitResult<T>;
  if (code) out.code = code;
  if (!ok) out.error = errorText || code || `git ${method} 调用失败`;
  else if (errorText) out.error = errorText;
  return out;
}

/**
 * 读取项目 Git 配置（token 已脱敏）。
 * @param {string} project 项目名
 * @returns {Promise<GitResult<GitConfigData>>} `{ok,config}`
 */
export function configGet(project: string): Promise<GitResult<GitConfigData>> {
  return callGit<GitConfigData>("getConfig", project);
}

/**
 * 保存项目 Git 配置；token 留空表示不更新。
 * @param {{project: string, config: GitConfig}} input 项目名 + 配置
 * @returns {Promise<GitResult<GitConfigSaveData>>} `{ok,config}`；仓库异常时带 `code:'NEED_HEAL'`
 */
export function saveConfig(input: { project: string; config: GitConfig }): Promise<GitResult<GitConfigSaveData>> {
  return callGit<GitConfigSaveData>("saveConfig", input);
}

/**
 * 测试远端连通性。
 * @param {GitTestConnectionInput} input 远端与可选凭据
 * @returns {Promise<GitResult<GitTestConnectionData>>} 成功带 `latency`（毫秒）
 */
export function testConnection(input: GitTestConnectionInput): Promise<GitResult<GitTestConnectionData>> {
  return callGit<GitTestConnectionData>("testConnection", input);
}

/**
 * 列分支（远端不可达/未配置时只返回本地分支）。
 * @param {GitListBranchesInput} input 项目名（可选 remoteUrl）
 * @returns {Promise<GitResult<GitBranchesData>>} `{ok,branches,currentBranch,remoteConfigured}`
 */
export function listBranches(input: GitListBranchesInput): Promise<GitResult<GitBranchesData>> {
  return callGit<GitBranchesData>("listBranches", input);
}

/**
 * 读取本地未提交/未推送变更树。
 * @param {string} project 项目名
 * @param {string} [branch] 目标分支
 * @returns {Promise<GitResult<GitStatusData>>} `{ok,projects,totalCount,branch}`
 */
export function status(project: string, branch?: string): Promise<GitResult<GitStatusData>> {
  return callGit<GitStatusData>("getStatus", { project, branch });
}

/**
 * 读取远端分支相对本地的差异树（与 status 同结构）。
 * @param {string} project 项目名
 * @param {string} [branch] 目标分支
 * @returns {Promise<GitResult<GitStatusData>>} `{ok,projects,totalCount,branch}`
 */
export function fetchDiff(project: string, branch?: string): Promise<GitResult<GitStatusData>> {
  return callGit<GitStatusData>("fetchDiff", { project, branch });
}

/**
 * 上传发布所选文件。
 * @param {GitPushInput} input 项目/分支/文件/提交说明
 * @returns {Promise<GitResult<GitPushData>>} `{ok,message,filesCount,branch,forced}`
 */
export function push(input: GitPushInput): Promise<GitResult<GitPushData>> {
  return callGit<GitPushData>("push", input);
}

/**
 * 拉取同步远端变更。
 * @param {GitPullInput} input 项目/分支/可选文件/是否备份
 * @returns {Promise<GitResult<GitPullData>>} `{ok,message,filesCount,affectedProjects,failed,backupPath,branch}`
 */
export function pull(input: GitPullInput): Promise<GitResult<GitPullData>> {
  return callGit<GitPullData>("pull", input);
}

/**
 * 查询是否有 Git 操作进行中（主进程返回 `{busy,currentOp}`，这里只取 boolean）。
 * @returns {Promise<boolean>} busy 为 true 时 true；网关缺失/异常时 false
 */
export async function isBusy(): Promise<boolean> {
  try {
    const api = getProtoApi();
    const space = api ? (api.git as Record<string, unknown> | undefined) : undefined;
    const fn = space ? space.isBusy : undefined;
    if (typeof fn !== "function") return false;
    const raw = await (fn as () => unknown).call(space);
    if (typeof raw === "boolean") return raw;
    if (raw && typeof raw === "object" && typeof (raw as { busy?: unknown }).busy === "boolean") {
      return (raw as { busy: boolean }).busy;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 取消当前 Git 操作。
 * @returns {Promise<GitResult<GitCancelData>>} `{ok,cancelled,op}`
 */
export function cancel(): Promise<GitResult<GitCancelData>> {
  return callGit<GitCancelData>("cancel");
}

/**
 * 备份后修复仓库（嵌套/缺库/坏库）。
 * @param {string} project 项目名
 * @returns {Promise<GitResult<GitHealData>>} `{ok,backupDir,healed,nested}`
 */
export function healRepair(project: string): Promise<GitResult<GitHealData>> {
  return callGit<GitHealData>("healRepair", { project });
}

/** 11 条通道对外方法表（供静态契约与测试断言）。 */
export const GIT_API_METHODS = [
  "configGet",
  "saveConfig",
  "testConnection",
  "listBranches",
  "status",
  "fetchDiff",
  "push",
  "pull",
  "isBusy",
  "cancel",
  "healRepair",
] as const;
