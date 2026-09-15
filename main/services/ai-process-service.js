'use strict';
/**
 * main/services/ai-process-service.js — AIProcessService（Wave-B/D）
 * 职责：CLI/API 双轨探测、模型动态拉取与缓存、BYOK 桥接、Agent 进程启停看门狗、会话快照。
 * 凭据一律经 ai-config-store（safeStorage 加密 + 原子写 + 掩码），本文件永不落明文、永不经 IPC 返明文。
 *
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} AiAskArgs {prompt:string, sessionId?:string, sandboxDir?:string, model?:string, extra?:Object}
 * @typedef {Object} AiAskResult {ok:boolean, sessionId?:string, error?:string, cancelled?:boolean}
 * @param {AiAskArgs|Object} [args] 问答载荷 (prompt 必需, 其余可选, 由 aiAskImpl 清洗并 takeSnapshot)
 * @returns {Promise<AiAskResult>} 问答调度结果 (流式经 ai:event 推送, 取消走整树终止)
 */
const path = require('path');
const fs = require('fs');
const os = require('node:os');
const { spawn } = require('child_process');
const { BrowserWindow, dialog } = require('electron');
const { detectAllAgents } = require('../../runtimes/detection');
const { getAgentDef, getAllAgentDefs } = require('../../runtimes/registry');
const { resolveAgentExecutable } = require('../../runtimes/resolution');
const { startAgentExecution } = require('../../runtimes/engine');
const { buildOpenCodeByokProviderConfig } = require('../../runtimes/byok-opencode');
const { testProviderConnection } = require('../../providers/connection-test');
const { fetchProviderModels } = require('../../providers/model-fetcher');
const { killProcessTree } = require('../../platform/process');
const { createCommandInvocation } = require('../../platform/command');
const { applyAgentLaunchEnv } = require('../../platform/env');
const shared = require('../state');
const paths = require('../paths');
const aiConfigStore = require('./ai-config-store');
const sandboxStorage = require('./sandbox-storage-service');

/* ═══════ UI 设计规范注入（出厂内置 specs/ + 用户可替换） ═══════
 * 渲染层 aiDoSend 保持直通原文 t（回滚锁）；规范由主进程在下发前按原型端别拼到 prompt 头部。
 * 这是 UI 规范（只约束视觉呈现与交互形态），不是代码规范：不限制实现方式（手写/CSS库均可），
 * 只要求视觉结果符合；与用户本次明确需求冲突处以用户需求为准。 */
const UI_SPEC_PROMPT_MAX_BYTES = 48 * 1024;
function resolveUiSpecKind(extraOpts) {
  try {
    const k = String((extraOpts && (extraOpts.uiKind || extraOpts.kind)) || '').toLowerCase();
    if (k === 'pc' || k === 'desktop') return 'pc';
  } catch (e) {}
  return 'mobile';
}
function buildUiSpecSection(kind, spec) {
  const k = (String(kind || '').toLowerCase() === 'pc') ? 'pc' : 'mobile';
  const name = (spec && spec.name) || (k === 'pc' ? '桌面端UI规范' : '移动端UI规范');
  let body = String((spec && spec.content) || '');
  let cut = false;
  try {
    if (Buffer.byteLength(body, 'utf8') > UI_SPEC_PROMPT_MAX_BYTES) {
      cut = true;
      let n = 0;
      const lines = body.split('\n');
      const kept = [];
      for (let i = 0; i < lines.length; i++) {
        n += Buffer.byteLength(lines[i] + '\n', 'utf8');
        if (n > UI_SPEC_PROMPT_MAX_BYTES) break;
        kept.push(lines[i]);
      }
      body = kept.join('\n');
    }
  } catch (e) {}
  const kindLabel = (k === 'pc') ? '桌面端（pc）' : '移动端（mobile）';
  return '【UI 设计规范·本次任务强制遵循】\n'
    + '当前原型端别：' + kindLabel + '，适用规范《' + name + '》。\n'
    + '以下为 UI 规范全文：它只约束界面的视觉呈现与交互形态（配色/字号/间距/圆角/组件形态/布局/触摸目标等），'
    + '不约束代码实现方式（手写 CSS 或引用任意组件库均可，只要视觉结果符合规范）。\n'
    + '与用户本次明确需求冲突处，以用户需求为准；需求未涉及处，严格按规范执行。\n'
    + '---UI规范开始---\n' + body + '\n---UI规范结束---'
    + (cut ? '\n（注：规范过长已按行截断，优先遵循上文可见部分。）' : '');
}

function aiWorkDir(sandboxDir) {
  const rootNorm = path.normalize(paths.SANDBOX_ROOT);
  const d = String(sandboxDir || '');
  if (d && fs.existsSync(d)) {
    const dn = path.normalize(d);
    if (dn === rootNorm || dn.startsWith(rootNorm + path.sep)) return dn;
  }
  return rootNorm;
}

/* ═══════ AI 任务快照与恢复：每次 ai:ask 前整目录复制到
   %APPDATA%/原型工具/snapshots/<项目>/<原型>/<yyyyMMdd-HHmmss>/，
   每原型保留最近 10 份；恢复前先把当前状态存为 undo- 前缀快照防误恢复丢失 ═══════ */
function stripFreeSuffix(s) {
  let v = String(s || '').trim();
  if (/[-_]free$/i.test(v)) v = v.replace(/[-_]free$/i, '').trim();
  return v;
}
function normalizeCliModelIds(rawList) {
  const seen = new Set(); const out = [];
  (Array.isArray(rawList) ? rawList : []).forEach((m) => {
    let id = '';
    if (typeof m === 'string') id = m;
    else if (m && typeof m === 'object') id = m.id || m.name || m.model || '';
    id = stripFreeSuffix(id);
    if (!id || id === 'default') return;
    if (/embed|tts\b|text-to-speech|stt\b|whisper|dall-?e|text-embedding|image-?gen/i.test(id)) return;
    if (id.length > 128 || /\s/.test(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: (m && typeof m === 'object' && (m.label || m.name)) || id });
  });
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function execCliListModels(resolvedBin, def) {
  return new Promise((resolve) => {
    try {
      const args = (def && def.listModels && Array.isArray(def.listModels.args)) ? def.listModels.args : ['models'];
      const timeoutMs = (def && def.listModels && def.listModels.timeoutMs) || 5000;
      const invocation = createCommandInvocation({ command: resolvedBin, args, env: applyAgentLaunchEnv() });
      const child = spawn(invocation.command, invocation.args, { cwd: os.tmpdir(), windowsVerbatimArguments: invocation.windowsVerbatimArguments });
      let out = ''; let err = '';
      let done = false;
      const finish = (items) => { if (!done) { done = true; try { child.kill(); } catch (e) {} resolve(items); } };
      const timer = setTimeout(() => finish(null), timeoutMs);
      child.stdout.on('data', (d) => { out += d.toString('utf8'); });
      child.stderr.on('data', (d) => { err += d.toString('utf8'); });
      child.on('error', () => { clearTimeout(timer); finish(null); });
      child.on('close', () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        try {
          const parse = def && def.listModels && typeof def.listModels.parse === 'function' ? def.listModels.parse : null;
          let items = parse ? parse(out, err) : [];
          if (!Array.isArray(items)) items = [];
          resolve(items);
        } catch (e) { resolve(null); }
      });
    } catch (e) { resolve(null); }
  });
}

/* L4统一IPC：ai:test-connection -> testProviderConnection（兼容旧前端 {ok,latency,error}） */
async function aiCheckImpl() {
  try {
    const aiCfg = aiConfigStore.loadAiConfigFull();
    const customPaths = {};
    try {
      if (aiCfg && typeof aiCfg.cliPaths === 'object' && aiCfg.cliPaths) {
        for (const k of Object.keys(aiCfg.cliPaths)) { if (aiCfg.cliPaths[k]) customPaths[k] = aiCfg.cliPaths[k]; }
      }
      if (aiCfg && aiCfg.cliPath) customPaths.opencode = customPaths.opencode || aiCfg.cliPath;
    } catch (e) {}
    const agents = await detectAllAgents(customPaths);
    const oc = (agents || []).find(a => a && a.id === 'opencode') || null;
    if (oc && oc.available) return { found: true, path: oc.path, version: oc.version, agents };
    const anyOk = (agents || []).find(a => a && a.available) || null;
    if (anyOk) return { found: true, path: anyOk.path, version: anyOk.version, agents };
    return { found: false, path: null, version: null, agents: agents || [] };
  } catch (e) {
    return { found: false, path: null, version: null, agents: [] };
  }

}
function aiGetConfigImpl() {
  return aiConfigStore.getMaskedAiConfig();
}
async function aiSaveConfigImpl(ev, cfg) {
  const r = await aiConfigStore.saveAiConfig((cfg && typeof cfg === 'object') ? cfg : {});
  try { shared.cliModelsCache.clear(); } catch (e) {}
  return { ok: true, config: r.config, persisted: r.persisted, hint: r.hint };
}
async function aiTestConnectionImpl(ev, apiCfg) {
  try {
    const stored = aiConfigStore.loadAiConfigFull();
    const src = (apiCfg && typeof apiCfg === 'object') ? apiCfg : {};
    const rawProv = src.protocol || src.provider
      || (stored.byok && stored.byok.protocol) || (stored.apiConfig && stored.apiConfig.protocol)
      || (stored.api && stored.api.provider) || 'openai';
    const known = ['openai', 'anthropic', 'google', 'ollama', 'azure'];
    const protocol = known.includes(String(rawProv)) ? String(rawProv) : 'openai';
    const apiKey = String(
      src.apiKey != null ? src.apiKey
      : (stored.byok && stored.byok.apiKey) || (stored.apiConfig && stored.apiConfig.apiKey)
      || (stored.api && stored.api.apiKey) || ''
    ).trim();
    const baseUrl = String(
      src.baseUrl != null ? src.baseUrl
      : (stored.byok && stored.byok.baseUrl) || (stored.apiConfig && stored.apiConfig.baseUrl)
      || (stored.api && stored.api.baseUrl) || ''
    ).trim();
    const model = String(src.model != null ? src.model : (stored.api && stored.api.model) || '').trim() || 'deepseek-chat';
    const r = await testProviderConnection({ protocol, apiKey, baseUrl, model, timeoutMs: 8000 });
    return {
      ok: !!r.success, success: !!r.success, kind: r.kind,
      latency: r.latencyMs, latencyMs: r.latencyMs, status: r.status,
      error: r.success ? undefined : r.message, message: r.message
    };
  } catch (e) {
    return { ok: false, success: false, kind: 'unknown', error: String((e && e.message) || e) };
  }

}
async function aiModelsImpl(ev, hint) {
  const cfg = aiConfigStore.loadAiConfigFull();
  /* 设置面板按当前UI引擎预览：显式hint优先，仅无hint时回退落盘判定（兼容旧前端与对话下拉） */
  const h = (hint && typeof hint === 'object') ? hint : (typeof hint === 'string' ? { engine: hint } : {});
  const hintEngine = (h.engine === 'cli' || h.engine === 'api') ? h.engine : null;
  const isApi = hintEngine ? hintEngine === 'api' : (cfg.mode === 'api' || cfg.providerType === 'api' || cfg.engine === 'api');
  let visible = null;
  /* CLI 可见模型按 CLI 分 CLI 隔离存放 {agentId:[ids]}；兼容旧全局数组（视为当前 CLI 的）与 visibleModels 回退 */
  const pickCliList = (v, agent) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const a = v[agent];
      if (Array.isArray(a)) return a;
      return [];
    }
    return null;
  };
  const curAgentForVisible = String((cfg && (cfg.agentId || cfg.mainAgent)) || 'opencode');
  if (isApi) {
    visible = Array.isArray(cfg.visibleModelsApi) ? cfg.visibleModelsApi
      : (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length ? cfg.visibleModels : null);
  } else {
    visible = pickCliList(cfg.visibleModelsCli, curAgentForVisible);
    if (visible === null) {
      visible = (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length ? cfg.visibleModels : null);
    }
  }
  if (isApi) {
    try {
      const src = h.api || h.byok || h.apiConfig || cfg.byok || cfg.apiConfig || cfg.api || {};
      const rawProv = src.protocol || src.provider || 'openai';
      const known = ['openai', 'anthropic', 'google', 'ollama', 'azure'];
      const protocol = known.includes(String(rawProv)) ? String(rawProv) : 'openai';
      const apiKey = String(src.apiKey || '').trim();
      const baseUrl = String(src.baseUrl || '').trim();
      const list = await fetchProviderModels({ protocol, apiKey, baseUrl, timeoutMs: 10000 });
      const dispProv = String(src.provider || protocol);
      const labelMap = {
        deepseek: 'DeepSeek 官方', ali: '阿里百炼 DashScope',
        siliconflow: '硅基流动 SiliconFlow', openrouter: 'OpenRouter',
        custom: '自定义 API', openai: 'OpenAI', anthropic: 'Anthropic',
        google: 'Google', ollama: 'Ollama', azure: 'Azure'
      };
      const label = labelMap[dispProv] || dispProv;
      const defModel = String(src.model || cfg.model || ((Array.isArray(list) && list[0] && list[0].id) || 'default'));
      return { ok: true, groups: [{ provider: dispProv, label, models: list }], default: defModel, engine: 'api', visibleModels: visible || [] };
    } catch (e) {
      const fb = [{ id: 'deepseek-chat', label: 'deepseek-chat' }, { id: 'deepseek-reasoner', label: 'deepseek-reasoner' }];
      return { ok: true, groups: [{ provider: 'custom', label: '自定义 API', models: fb }], default: 'deepseek-chat', engine: 'api', visibleModels: visible || [] };
    }
  }
  const agentId = cfg.agentId || cfg.mainAgent || 'opencode';
  const def = getAgentDef(agentId) || getAgentDef('opencode');
  if (!def) return { ok: false, error: '未找到 Agent 适配器', engine: 'cli', visibleModels: visible || [] };
  const fms = Array.isArray(def.fallbackModels) ? def.fallbackModels : [];
  /* 动态执行 def.listModels（如 opencode models），5s熔断+10分钟缓存，失败降级fallback */
  let dynItems = [];
  try {
    let customPath = cfg.cliPath;
    try { if (cfg.cliPaths && cfg.cliPaths[def.id]) customPath = cfg.cliPaths[def.id]; } catch (e) {}
    const resolvedBin = await resolveAgentExecutable(def, customPath);
    if (resolvedBin && def.listModels && Array.isArray(def.listModels.args)) {
      const cacheKey = def.id + ':' + resolvedBin;
      const now = Date.now();
      const hit = shared.cliModelsCache.get(cacheKey);
      if (hit && (now - hit.ts) < shared.CLI_MODELS_CACHE_TTL && Array.isArray(hit.items) && hit.items.length) {
        dynItems = hit.items;
      } else {
        const raw = await execCliListModels(resolvedBin, def);
        if (Array.isArray(raw) && raw.length) {
          dynItems = normalizeCliModelIds(raw);
          if (dynItems.length) shared.cliModelsCache.set(cacheKey, { ts: now, items: dynItems });
          else dynItems = [];
        }
      }
    }
  } catch (e) { dynItems = []; }
  /* 融合：fallback default项 + 动态全量 + 当前 CLI 的用户customModelsCli（分 CLI 隔离，旧全局数组兼容为当前 CLI 的；每次合并，不进缓存） */
  const cliCustoms = (() => {
    const v = cfg.customModelsCli;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const a = v[(def && def.id) || curAgentForVisible];
      return Array.isArray(a) ? a : [];
    }
    return [];
  })();
  const merged = [];
  const seenIds = new Set();
  const pushM = (m) => {
    const id0 = String((m && m.id) || '').trim();
    if (!id0) return;
    const id = stripFreeSuffix(id0);
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    merged.push({ id, label: String((m && m.label) || id) });
  };
  fms.forEach(pushM);
  (Array.isArray(dynItems) ? dynItems : []).forEach(pushM);
  (Array.isArray(cliCustoms) ? cliCustoms : []).forEach((id) => pushM({ id, label: id }));
  const useList = merged.length ? merged : fms.map((m) => ({ id: stripFreeSuffix(m.id), label: m.label || m.id })).filter((m) => m.id);
  const byProv = {};
  useList.forEach((m) => {
    const id = String((m && m.id) || '').trim();
    if (!id) return;
    const label = String((m && m.label) || id);
    const i = id.indexOf('/');
    const provider = i > 0 ? id.slice(0, i) : def.id;
    const name = i > 0 ? id.slice(i + 1) : label;
    (byProv[provider] = byProv[provider] || []).push({ id, name });
  });
  const groups = Object.keys(byProv).map((k) => ({ provider: k, label: k, models: byProv[k] }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  let defId = 'default';
  try {
    const d0 = fms.find((m) => m && m.default) || fms[0];
    if (d0 && d0.id) defId = d0.id;
  } catch (e) {}
  return {
    ok: true, groups, default: process.env.PROTO_AI_MODEL || cfg.model || defId,
    engine: 'cli', visibleModels: visible || [], agentId: def.id
  };

}
async function aiPickImpl() {
  const win = BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, {
    defaultPath: paths.pkgDir, title: '选择 opencode CLI 可执行文件',
    filters: [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat'] }], properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const c = aiConfigStore.loadAiConfigFull(); c.cliPath = r.filePaths[0]; aiConfigStore.saveAiCfgSyncCompat(c);
  return { path: r.filePaths[0] };

}
async function aiAskImpl(ev, prompt, sessionId, sandboxDir, model, extraOpts = {}) {
  if (shared.activeExecution) {
    return { ok: false, success: false, error: 'busy' };
  }
  const aiCfg = aiConfigStore.loadAiConfigFull();
  const webContents = ev.sender;
  /* iter25: 记录事件归属，支持关窗后转主窗口续跑 */
  try { shared.aiEventTarget = ev.sender; shared.aiTransferToMain = false; } catch (e) {}
  function emitAiEvent(payload) {
    try {
      var target = null;
      try {
        if (shared.aiTransferToMain && shared.mainWin && !shared.mainWin.isDestroyed()) target = shared.mainWin.webContents;
        else target = shared.aiEventTarget || webContents;
      } catch (e) { target = webContents; }
      try { if (target && !target.isDestroyed()) target.send('ai:event', payload); } catch (e) {}
    } catch (e) {}
  }
  const isApiMode = aiCfg.mode === 'api' || aiCfg.providerType === 'api' || aiCfg.engine === 'api';
  let def = null;
  let resolvedBin = null;
  const rawModel = String(model || '').trim();
  let normModel = (!rawModel || rawModel === '__none__') ? '' : rawModel;
  if (normModel.endsWith('-free')) normModel = normModel.slice(0, -5);
  let targetModel = normModel || String(aiCfg.model || '').trim() || 'default';
  if (targetModel.endsWith('-free')) targetModel = targetModel.slice(0, -5);
  if (targetModel === '__none__') targetModel = 'default';
  // 严格区分：positional 参数 sessionId 代表 Agent 远端/CLI 会话标识（如 OpenCode 的 ses_...）
  // extraOpts.uiSessionId 代表前端 Tab 标识（s_...），严禁侵入底层执行选项 options.sessionId
  let agentSessionToken = (typeof sessionId === 'string' && sessionId.trim()) ? sessionId.trim() : null;
  if (!agentSessionToken && typeof extraOpts.agentSessionId === 'string' && extraOpts.agentSessionId.trim()) {
    agentSessionToken = extraOpts.agentSessionId.trim();
  }
  let executionOptions = { ...extraOpts };
  delete executionOptions.sessionId; // 坚决剔除前端 Tab ID，杜绝同名覆盖
  if (agentSessionToken && !agentSessionToken.startsWith('s_')) {
    executionOptions.sessionId = agentSessionToken;
  }
  try { sandboxStorage.takeSnapshot(sandboxDir); } catch (e) {}
  const cwd = aiWorkDir(sandboxDir);
  if (isApiMode) {
    def = getAgentDef('opencode');
    if (!def) throw new Error('未找到 OpenCode 适配器，BYOK 模式依赖本地 OpenCode CLI');
    resolvedBin = await resolveAgentExecutable(def, aiCfg.cliPath);
    if (!resolvedBin) {
      emitAiEvent({
        type: 'error', code: 'CLI_NOT_FOUND', title: '缺少 OpenCode CLI',
        message: '大模型 API 模式需要本地安装 OpenCode 负责执行文件修改，请先安装或指定路径。'
      });
      return { ok: false, success: false, error: '缺少 OpenCode CLI' };
    }
    const legacyApi = aiCfg.api || {};
    let legacyProtocol = 'openai';
    try {
      const pv = String(legacyApi.provider || 'openai');
      legacyProtocol = ['openai', 'anthropic', 'google', 'ollama', 'azure'].includes(pv) ? pv : 'openai';
    } catch (e) {}
    const byokSrc = aiCfg.byok || aiCfg.apiConfig || {
      protocol: legacyProtocol,
      apiKey: legacyApi.apiKey || '',
      baseUrl: legacyApi.baseUrl || '',
      apiVersion: legacyApi.apiVersion || undefined,
      model: legacyApi.model || undefined
    };
    const byokModel = (targetModel && targetModel !== 'default') ? targetModel : String(byokSrc.model || '').trim();
    const byokConfig = buildOpenCodeByokProviderConfig(byokSrc, byokModel);
    if (!byokConfig) {
      emitAiEvent({
        type: 'error', code: 'INVALID_BYOK_CONFIG', title: 'API 配置不完整',
        message: '请在设置中心检查 API Key、BaseURL 及模型名称是否已正确配置。'
      });
      return { ok: false, success: false, error: 'API 配置不完整' };
    }
    executionOptions.env = byokConfig.env;
    executionOptions.model = byokConfig.modelId;
  } else {
    const agentId = aiCfg.agentId || 'opencode';
    def = getAgentDef(agentId) || getAgentDef('opencode');
    if (!def) {
      emitAiEvent({ type: 'error', code: 'AGENT_NOT_FOUND', title: '未找到 Agent', message: String(agentId) });
      return { ok: false, success: false, error: '未找到 Agent 适配器' };
    }
    let customPath = aiCfg.cliPath;
    try {
      if (aiCfg.cliPaths && aiCfg.cliPaths[def.id]) customPath = aiCfg.cliPaths[def.id];
    } catch (e) {}
    resolvedBin = await resolveAgentExecutable(def, customPath);
    if (!resolvedBin) {
      emitAiEvent({
        type: 'error', code: 'CLI_NOT_FOUND', title: ('未检测到 ' + def.name),
        message: ('未找到 ' + def.name + ' 可执行文件，请在终端执行安装或在设置中心指定路径。')
      });
      return { ok: false, success: false, error: '未检测到 ' + def.name };
    }
    executionOptions.model = (targetModel && targetModel !== '__none__') ? targetModel : 'default';
  }

  /* UI 规范注入：按端别取启用的出厂/用户规范拼到 prompt 头部；取不到则原样下发（不断链） */
  let finalPrompt = prompt;
  try {
    const uiKind = resolveUiSpecKind(extraOpts);
    const uiSpec = sandboxStorage.readUiSpecForKind(uiKind);
    if (uiSpec && uiSpec.content) finalPrompt = buildUiSpecSection(uiKind, uiSpec) + '\n\n' + String(prompt || '');
  } catch (e) {}

  const beforeSignature = sandboxStorage.getProtoFileSignature(cwd);

  function runAgentProcess(opts, isRetry = false) {
    return startAgentExecution({
      def,
      resolvedBin,
      prompt: finalPrompt,
      cwd,
      options: opts,
      handlers: {
        onThinking: (text) => emitAiEvent({ type: 'thinking', text: String((text && text.text) || text || '') }),
        onChunk: (text) => emitAiEvent({ type: 'chunk', text: String((text && text.text) || text || '') }),
        onToolCall: (data) => emitAiEvent({ type: 'tool_call', ...data }),
        onSession: (id) => {
          const sid = String((id && (id.sessionId || id.id || id.sessionID || id.session_id || id.session)) || (typeof id === 'string' ? id : '') || '');
          emitAiEvent({ type: 'session', id: sid, sessionId: sid });
        },
        onError: (diag) => {
          const d = (diag && typeof diag === 'object') ? diag : { message: String((diag && diag.message) || diag || '未知错误') };
          // 自愈降级：若因携带失效的 sessionId 导致 SESSION_NOT_FOUND，自动抹除并无感重试一次全新会话
          if (d.code === 'SESSION_NOT_FOUND' && opts.sessionId && !isRetry) {
            try { emitAiEvent({ type: 'session', id: '', sessionId: '' }); } catch (e) {}
            const retryOpts = { ...opts };
            delete retryOpts.sessionId;
            shared.activeExecution = runAgentProcess(retryOpts, true);
            return;
          }
          shared.activeExecution = null;
          try { shared.aiTransferToMain = false; shared.aiEventTarget = null; } catch (e) {}
          try {
            emitAiEvent({ type: 'error', code: d.code || 'EXECUTION_FAILURE', title: d.title || '调用失败', message: d.message || '调用失败', action: d.action || 'retry' });
          } catch (e) {
            try { emitAiEvent({ type: 'error', message: String((diag && diag.message) || diag || '未知错误') }); } catch (ee) {}
          }
        },
        onClose: ({ cancelled, code } = {}) => {
          shared.activeExecution = null;
          let fileChanges = [];
          try {
            const afterSignature = sandboxStorage.getProtoFileSignature(cwd);
            fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature);
          } catch (err) {
            fileChanges = [];
          }
          try {
            emitAiEvent({
              type: 'done',
              cancelled: !!cancelled,
              code,
              fileChanges
            });
          } catch (e) {}
          try { shared.aiTransferToMain = false; shared.aiEventTarget = null; } catch (e) {}
        }
      }
    });
  }

  shared.activeExecution = runAgentProcess(executionOptions, false);
  return { ok: true, success: true, pid: shared.activeExecution ? shared.activeExecution.pid : null };

}
async function aiCancelImpl() {
  try {
    if (shared.activeExecution) {
      try { await shared.activeExecution.cancel(); } catch (e) {}
      try { if (shared.activeExecution && shared.activeExecution.pid) await killProcessTree(shared.activeExecution.pid); } catch (e) {}
    }
  } catch (e) {}
  shared.activeExecution = null;
  try { shared.aiTransferToMain = false; shared.aiEventTarget = null; } catch (e) {}
  return 'ok';

}
function aiIsBusyImpl() { return !!shared.activeExecution; 
}
module.exports = {
  aiWorkDir,
  stripFreeSuffix,
  normalizeCliModelIds,
  execCliListModels,
  aiCheckImpl,
  aiGetConfigImpl,
  aiSaveConfigImpl,
  aiTestConnectionImpl,
  aiModelsImpl,
  aiPickImpl,
  aiAskImpl,
  aiCancelImpl,
  aiIsBusyImpl,
  resolveUiSpecKind,
  buildUiSpecSection,
  UI_SPEC_PROMPT_MAX_BYTES,
};
