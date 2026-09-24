'use strict';
/**
 * main/ipc-contract.js — Wave-E 74 IPC 通道冻结契约 (JSDoc 单一真相源, 零运行时副作用)
 *
 * 来源: preload.js (78 invoke, 去重后 74) + main/controllers 下各控制器 (ipcMain.handle 74, 已验证一致).
 * 约束: 通道名与出入参契约冻结, 新增通道必须同步更新本表 + preload + controller + tests/verify-ipc.js,
 *   否则 tests/lint-guard.js [E-IPC-FROZEN] 与 static-verify 将红灯.
 * 本文件仅导出冻结表与 JSDoc 类型, 不注册任何 handler, 不产生副作用, 可被测试 require.
 *
 * 历波基线 (禁止回退):
 * - iframe sandbox + postMessage 受限协议 (P0-A)
 * - TLS 默认安全, 无条件 0 已删 (P0-B, 见 platform/env.js)
 * - .bak 零残留 + asar 排除 (见 package.json build.files 17 条)
 * - AI safeStorage 加密 + IPC 掩码 (见 main/services/ai-config-store.js)
 *
 * @typedef {Object} IpcOk
 * @property {boolean} ok 是否成功
 * @property {string} [error] 失败原因 (ok=false 时)
 * @property {boolean} [cancelled] 用户取消 (dialog 类)
 *
 * @typedef {Object} PageRef
 * @property {string} [project] 项目名
 * @property {string} [proto] 原型展示名
 *
 * @typedef {Object} SandboxRef
 * @property {string} dir 沙箱目录标识 (sandboxDir)
 * @property {string} [file] 文件名 (html/md)
 * @property {string} [name] 新名称 (create/rename)
 *
 * @typedef {Object} DocSnapshot
 * @property {string} sourceId 快照源标识 (Store.sourceIdOf)
 * @property {number} ver 快照版本号 (Store.__ver)
 * @property {string} dir 沙箱目录
 * @property {string} file 文件名
 * @property {string} content 正文快照
 *
 * @typedef {Object} MaskedAiConfig
 * @property {string} engine 引擎 (api/cli)
 * @property {Object} api API 配置 (apiKey 恒为 '' , 真值永不经 IPC)
 * @property {string} api.apiKeyMasked 掩码 (如 ****abcd)
 * @property {boolean} api.hasApiKey 是否已存真凭据
 */

/**
 * 74 通道冻结表 (排序后唯一).
 * 分组: app/log/snapshot(4) + doc(8) + docwin/aiwin(6+2 mirror复用) + sandbox/project(17)
 *   + ai(11) + links/annotations(4) + spec/uilib/binding(12) + git(11) = 74.
 * @type {string[]}
 */
const IPC_CHANNELS = [
  'ai:ask',
  'ai:cancel',
  'ai:check',
  'ai:get-config',
  'ai:is-busy',
  'ai:models',
  'ai:open-terminal',
  'ai:pick',
  'ai:remote-send',
  'ai:save-config',
  'ai:test-connection',
  'aiwin:close',
  'aiwin:open',
  'aiwin:toggle',
  'app:get-version',
  'doc:export-long-image',
  'doc:export-pdf',
  'doc:list',
  'doc:mirror-back',
  'doc:mirror-push',
  'doc:read-latest',
  'doc:write-latest',
  'docwin:close',
  'docwin:open',
  'docwin:toggle',
  'git:cancel',
  'git:config-get',
  'git:config-save',
  'git:fetch-diff',
  'git:heal-repair',
  'git:is-busy',
  'git:list-branches',
  'git:pull',
  'git:push',
  'git:status',
  'git:test-connection',
  'links:read',
  'links:write',
  'log:write',
  'pick-text-file',
  'project:create',
  'project:get-binding',
  'project:remove',
  'project:rename',
  'project:set-binding',
  'proto:annotations:read',
  'proto:annotations:save',
  'sandbox:adopt',
  'sandbox:create',
  'sandbox:create-subpage',
  'sandbox:delete-asset',
  'sandbox:delete-subpage',
  'sandbox:list',
  'sandbox:list-assets',
  'sandbox:projects',
  'sandbox:read-asset-base64',
  'sandbox:read-file',
  'sandbox:remove',
  'sandbox:rename',
  'sandbox:rename-subpage',
  'sandbox:save-asset',
  'sandbox:write',
  'snapshot:list',
  'snapshot:restore',
  'spec:create-from-file',
  'spec:create-from-text',
  'spec:list',
  'spec:read',
  'spec:remove',
  'spec:rename',
  'spec:update',
  'uilib:list',
  'uilib:remove',
  'uilib:save',
];

/**
 * 校验一组通道名是否与冻结表一致 (顺序无关).
 * @param {string[]} channels 待校验通道名数组
 * @returns {{ok:boolean, missing:string[], extra:string[]}} 校验结果 (ok=true 则 missing/extra 均空)
 */
function diffChannels(channels) {
  const have = new Set((Array.isArray(channels) ? channels : []).map(String));
  const want = new Set(IPC_CHANNELS);
  const missing = IPC_CHANNELS.filter((c) => !have.has(c));
  const extra = Array.from(have).filter((c) => !want.has(c));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

module.exports = { IPC_CHANNELS, diffChannels };
