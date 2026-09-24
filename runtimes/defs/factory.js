'use strict';
/**
 * [runtimes/defs/factory.js] Wave-D/G Agent适配器工厂（数据驱动）+ Wave-E 契约补记 (只加注释, 实现不变)
 * @typedef {Object} ManifestEntry {id:string, name:string, bin:string, buildArgs:{kind:'static'|'model'|'model-cwd', args:string[]}, promptViaStdin?:boolean, streamFormat?:string}
 * @typedef {Object} RuntimeAgentDef {id:string, name:string, bin:string, buildArgs:Function, promptViaStdin:boolean, streamFormat:string}
 * @param {string|ManifestEntry} entryOrId 适配器 id 或清单条目
 * @param {Object} [overrides] 覆盖字段 (测试/特例用)
 * @returns {RuntimeAgentDef} 装配后的适配器定义 (buildArgs 为纯函数, kinds: static/model/model-cwd)
 * 审计报告第五章第2节 + 第七章Phase3：kilo/kiro/amr/trae-cli/vibe等发现型适配器85-90%重复，
 * 仅 id/name/bin(+fallbackBins)/fallbackModels/buildArgs静态参数/needsProtocol 不同。
 * 本工厂以 manifest.json 为单一真相源，按 buildArgs.kind 装配同构 buildArgs 纯函数，
 * registry/engine/detection 接口不变（仍经 defs 子目录按 id 加载，返回 RuntimeAgentDef）。
 * kinds:
 *  - static: () => [...args] 常量拷贝（acp类）
 *  - model: base + options.model!=default ? [modelFlag, model]
 *  - model-cwd: base + ctx.cwd ? [cwdFlag, cwd] + model分支（qoder类）
 */
const path = require('node:path');
const fs = require('node:fs');

let _manifest = null;
function loadManifest() {
  if (_manifest) return _manifest;
  const p = path.join(__dirname, 'manifest.json');
  const raw = fs.readFileSync(p, 'utf8');
  _manifest = JSON.parse(raw);
  return _manifest;
}

function getManifestEntry(id) {
  const m = loadManifest();
  const arr = (m && m.defs) || [];
  for (const e of arr) { if (e && e.id === id) return e; }
  return null;
}

function listManifestIds() {
  const m = loadManifest();
  return ((m && m.defs) || []).map((e) => e && e.id).filter(Boolean);
}

function buildArgsFn(entry) {
  const spec = (entry && entry.buildArgs) || { kind: 'static', args: [] };
  const kind = String(spec.kind || 'static');
  const base = Array.isArray(spec.args) ? spec.args.slice() : [];
  const modelFlag = String(spec.modelFlag || '--model');
  const cwdFlag = String(spec.cwdFlag || '-w');
  if (kind === 'static') {
    return function () { return base.slice(); };
  }
  if (kind === 'model') {
    return function (_prompt, _images, _extra, options) {
      const args = base.slice();
      const o = (options && typeof options === 'object') ? options : {};
      if (o.model && o.model !== 'default') args.push(modelFlag, String(o.model));
      return args;
    };
  }
  if (kind === 'model-cwd') {
    return function (_prompt, _images, _extra, options, ctx) {
      const args = base.slice();
      const c = (ctx && typeof ctx === 'object') ? ctx : {};
      if (c.cwd) args.push(cwdFlag, String(c.cwd));
      const o = (options && typeof options === 'object') ? options : {};
      if (o.model && o.model !== 'default') args.push(modelFlag, String(o.model));
      return args;
    };
  }
  throw new Error('[factory] 未知 buildArgs.kind=' + kind + ' id=' + (entry && entry.id));
}

function createAgentDef(entryOrId, overrides) {
  const entry = (typeof entryOrId === 'string') ? getManifestEntry(entryOrId) : entryOrId;
  if (!entry) throw new Error('[factory] 未知适配器 id=' + entryOrId);
  if (entry.driver && entry.driver !== 'factory') {
    throw new Error('[factory] id=' + entry.id + ' 为 bespoke，仍由原JS实现直供（manifest仅登记）');
  }
  const ov = (overrides && typeof overrides === 'object') ? overrides : {};
  const def = {
    id: entry.id,
    name: entry.name,
    bin: entry.bin,
    versionArgs: Array.isArray(entry.versionArgs) ? entry.versionArgs.slice() : ['--version'],
    fallbackModels: JSON.parse(JSON.stringify(entry.fallbackModels || [{ id: 'default', label: '默认推荐模型 (CLI 预设)', default: true }])),
    buildArgs: buildArgsFn(entry),
    promptViaStdin: !!entry.promptViaStdin,
    streamFormat: entry.streamFormat || 'plain',
  };
  if (Array.isArray(entry.fallbackBins)) def.fallbackBins = entry.fallbackBins.slice();
  else if (entry.fallbackBins !== undefined && entry.fallbackBins !== null) def.fallbackBins = [].concat(entry.fallbackBins);
  if (entry.eventParser) def.eventParser = entry.eventParser;
  if (entry.needsProtocol) def.needsProtocol = entry.needsProtocol;
  if (entry.listModels) def.listModels = entry.listModels;
  /* 终端启动命令：{cmd?: string|string[], args?: string[], unsupported?: string}，缺省走解析到的 bin */
  if (entry.terminal && typeof entry.terminal === 'object') def.terminal = JSON.parse(JSON.stringify(entry.terminal));
  for (const k of Object.keys(ov)) { def[k] = ov[k]; }
  return def;
}

function create(id, overrides) { return createAgentDef(id, overrides); }

module.exports = { loadManifest, getManifestEntry, listManifestIds, buildArgsFn, createAgentDef, create };
