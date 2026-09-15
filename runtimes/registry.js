/**
 * runtimes/registry.js — Wave-E 契约补记 (只加注释, 实现不变)
 * 26 适配器注册表 (BASE_AGENT_DEFS), id 唯一守卫.
 * @typedef {Object} RuntimeAgentDef {id:string, name:string, bin:string, buildArgs:Function}
 * @param {string} id 适配器 id (如 opencode)
 * @returns {RuntimeAgentDef|null} 适配器定义或 null
 */
const opencodeDef = require('./defs/opencode');
const claudeDef = require('./defs/claude');
const cursorAgentDef = require('./defs/cursor-agent');
const codexDef = require('./defs/codex');
const deepseekHarnessDef = require('./defs/deepseek-harness');
// 直驱移植（opendesign defs，引擎原生支持）
const qwenDef = require('./defs/qwen');
const deepseekDef = require('./defs/deepseek');
const mimoDef = require('./defs/mimo');
const ampDef = require('./defs/amp');
const codebuddyDef = require('./defs/codebuddy');
const aiderDef = require('./defs/aider');
const grokBuildDef = require('./defs/grok-build');
const antigravityDef = require('./defs/antigravity');
const atomcodeDef = require('./defs/atomcode');
// 发现型移植（特殊协议，探测展示；执行经 needsProtocol 诚实降级）
const amrDef = require('./defs/amr');
const copilotDef = require('./defs/copilot');
const devinDef = require('./defs/devin');
const hermesDef = require('./defs/hermes');
const kiloDef = require('./defs/kilo');
const kimiDef = require('./defs/kimi');
const kiroDef = require('./defs/kiro');
const piDef = require('./defs/pi');
const qoderDef = require('./defs/qoder');
const reasonixDef = require('./defs/reasonix');
const traeCliDef = require('./defs/trae-cli');
const vibeDef = require('./defs/vibe');

const BASE_AGENT_DEFS = [
  opencodeDef,
  claudeDef,
  cursorAgentDef,
  codexDef,
  deepseekHarnessDef,
  qwenDef,
  deepseekDef,
  mimoDef,
  ampDef,
  codebuddyDef,
  aiderDef,
  grokBuildDef,
  antigravityDef,
  atomcodeDef,
  amrDef,
  copilotDef,
  devinDef,
  hermesDef,
  kiloDef,
  kimiDef,
  kiroDef,
  piDef,
  qoderDef,
  reasonixDef,
  traeCliDef,
  vibeDef
];

// 启动时唯一 ID 守卫校验
const defMap = new Map();
for (const def of BASE_AGENT_DEFS) {
  if (defMap.has(def.id)) {
    throw new Error(`[Registry Error] 重复的 Agent ID: ${def.id}`);
  }
  defMap.set(def.id, def);
}

function getAgentDef(id) {
  return defMap.get(id) || null;
}

function getAllAgentDefs() {
  return [...BASE_AGENT_DEFS];
}

module.exports = {
  BASE_AGENT_DEFS,
  getAgentDef,
  getAllAgentDefs
};
