/**
 * src/renderer/types/ipc.d.ts — 70 IPC 通道冻结契约的渲染层转录（纯类型，无运行时）。
 *
 * 转录来源：main/ipc-contract.js（IPC_CHANNELS 冻结表，70 通道）与 preload.js（window.protoAPI 网关形态）。
 * 转录日期：2026-11-12；转录方式：人工逐字转录 + 一次性 `node -e` 集合 diff 断言（脚本不落地）。
 * 校验口径：本文件 IpcChannel 联合类型逐字提取后，与 IPC_CHANNELS 做集合 diff，必须 diff 为空。
 *
 * 约束（与 main/ipc-contract.js 同源）：通道名冻结，差一个字母都是事故。
 * 新增/改名必须先改 main/ipc-contract.js + preload.js + main/controllers + tests/verify-ipc.js，
 * 再同步本文件并重跑 diff 断言。运行时真相源仍是 main/ipc-contract.js，本文件只做类型约束。
 */

/**
 * 单个 IPC 调用的统一返回形态（沿用 main/ipc-contract.js IpcOk typedef 与 preload.js 网关契约）。
 */
export interface IpcOk {
  /** 是否成功 */
  ok: boolean;
  /** 失败原因（ok=false 时） */
  error?: string;
  /** 用户取消（dialog 类通道） */
  cancelled?: boolean;
}

/**
 * 70 通道冻结表转录（顺序与 main/ipc-contract.js IPC_CHANNELS 逐字一致，一行一通道）。
 * 分组：app/log/snapshot/pick(5) + doc(7) + docwin(3) + sandbox/project(20)
 *   + ai(10) + links/annotations(4) + spec/uilib(10) + git(11) = 70。
 */
export type IpcChannel =
  | 'ai:ask'
  | 'ai:cancel'
  | 'ai:check'
  | 'ai:get-config'
  | 'ai:is-busy'
  | 'ai:models'
  | 'ai:open-terminal'
  | 'ai:pick'
  | 'ai:save-config'
  | 'ai:test-connection'
  | 'app:get-version'
  | 'doc:export-long-image'
  | 'doc:export-pdf'
  | 'doc:list'
  | 'doc:mirror-back'
  | 'doc:mirror-push'
  | 'doc:read-latest'
  | 'doc:write-latest'
  | 'docwin:close'
  | 'docwin:open'
  | 'docwin:toggle'
  | 'git:cancel'
  | 'git:config-get'
  | 'git:config-save'
  | 'git:fetch-diff'
  | 'git:heal-repair'
  | 'git:is-busy'
  | 'git:list-branches'
  | 'git:pull'
  | 'git:push'
  | 'git:status'
  | 'git:test-connection'
  | 'links:read'
  | 'links:write'
  | 'log:write'
  | 'pick-text-file'
  | 'project:create'
  | 'project:get-binding'
  | 'project:remove'
  | 'project:rename'
  | 'project:set-binding'
  | 'proto:annotations:read'
  | 'proto:annotations:save'
  | 'sandbox:adopt'
  | 'sandbox:create'
  | 'sandbox:create-subpage'
  | 'sandbox:delete-asset'
  | 'sandbox:delete-subpage'
  | 'sandbox:list'
  | 'sandbox:list-assets'
  | 'sandbox:projects'
  | 'sandbox:read-asset-base64'
  | 'sandbox:read-file'
  | 'sandbox:remove'
  | 'sandbox:rename'
  | 'sandbox:rename-subpage'
  | 'sandbox:save-asset'
  | 'sandbox:write'
  | 'snapshot:list'
  | 'snapshot:restore'
  | 'spec:create-from-file'
  | 'spec:create-from-text'
  | 'spec:list'
  | 'spec:read'
  | 'spec:remove'
  | 'spec:rename'
  | 'spec:update'
  | 'uilib:list'
  | 'uilib:remove'
  | 'uilib:save';
