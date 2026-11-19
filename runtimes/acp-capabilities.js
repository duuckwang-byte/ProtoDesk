'use strict';
/**
 * runtimes/acp-capabilities.js — ACP 能力单一真相源（Phase 0）
 * 仅声明 20 个可通过 ACP 启动的 Agent；runtimes/registry.js 在构建
 * BASE_AGENT_DEFS 后统一挂载 transport:'acp' 与 acp:{args, adapter}，
 * 因此无需逐个修改 defs/*.js，也不改变 manifest.json 既有结构。
 *
 * adapter 仅允许以下三种（空字符串表示 CLI 原生 ACP 子命令）：
 *  - claude-agent-acp：Claude Code 官方 ACP 适配器（claude 自身无 ACP 模式）
 *  - codex-acp：Codex 官方 ACP 适配器（codex 自身无 ACP 模式）
 *  - pi-acp：Pi 社区 ACP 适配器（pi 自身无 ACP 模式）
 *
 * args 语义：启动 ACP 服务时追加在可执行文件后的参数；
 * 适配器型 Agent 的 args 保持为空，由适配器自行拉起底层 CLI。
 */

/**
 * 20 个可通过 ACP 启动的 Agent。
 * 全部复用 def.bin 作为可执行文件，差异仅由 args / adapter 表达；
 * 不再声明 command（Antigravity 实际入口是 `agy acp`，无独立 ACP 二进制）。
 */
/** @type {Object<string, {args: string[], adapter: string}>} */
const ACP_CAPABILITIES = {
  opencode: { args: ['acp'], adapter: '' },
  claude: { args: [], adapter: 'claude-agent-acp' },
  codex: { args: [], adapter: 'codex-acp' },
  'cursor-agent': { args: ['acp'], adapter: '' },
  'deepseek-harness': { args: ['--profile', 'acp'], adapter: '' },
  qwen: { args: ['--acp'], adapter: '' },
  codebuddy: { args: ['--acp'], adapter: '' },
  'grok-build': { args: ['agent', 'stdio'], adapter: '' },
  antigravity: { args: ['acp'], adapter: '' },
  copilot: { args: ['--acp', '--stdio'], adapter: '' },
  devin: { args: ['acp'], adapter: '' },
  hermes: { args: ['acp', '--accept-hooks'], adapter: '' },
  kilo: { args: ['acp'], adapter: '' },
  kimi: { args: ['acp'], adapter: '' },
  kiro: { args: ['acp'], adapter: '' },
  pi: { args: [], adapter: 'pi-acp' },
  qoder: { args: ['--acp'], adapter: '' },
  reasonix: { args: ['acp'], adapter: '' },
  'trae-cli': { args: ['acp', 'serve'], adapter: '' },
  vibe: { args: [], adapter: '' }
};

module.exports = {
  ACP_CAPABILITIES,
  // 兼容技术方案 9.2/10.5 的命名，二者指向同一张能力表
  ACP_CAPABLE: ACP_CAPABILITIES
};
