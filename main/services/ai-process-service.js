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
const { createCommandInvocation, quoteWindowsCommandArg } = require('../../platform/command');
const { applyAgentLaunchEnv } = require('../../platform/env');
const shared = require('../state');
const paths = require('../paths');
const aiConfigStore = require('./ai-config-store');
const aiThinkingCache = require('./ai-thinking-cache');
const sandboxStorage = require('./sandbox-storage-service');
const acpRuntime = require('../acp/acp-runtime');
const acpProcessLifecycle = require('../acp/acp-process-lifecycle');
const { isAcpEnabled } = acpRuntime;
const { resolveAgentCommand } = require('../acp/acp-registry');
const {
  ACP_MODEL_FALLBACKS,
  normalizeModelCatalog,
  mergeVisibleModels,
  resolveModelChoice
} = require('../acp/acp-config');
const { createAcpModelCache, buildCacheKey } = require('../acp/acp-model-cache');

/* ═══════ UI 设计规范注入（出厂内置 specs/ + 用户可替换） ═══════
 * 渲染层 aiDoSend 保持直通原文 t（回滚锁）；规范由主进程在下发前按原型端别拼到 prompt 头部。
 * 这是 UI 规范（只约束视觉呈现与交互形态），不是代码规范：不限制实现方式（手写/CSS库均可），
 * 只要求视觉结果符合；与用户本次明确需求冲突处以用户需求为准。 */
/* ═══════ 上下文内收（指针引用 + .context/ 快照） ═══════
 * 全文注入改为指针引用：规范/toolPrompt 正文不再进 argv，只下发沙箱内相对路径，
 * 由模型按需读取。规范/toolPrompt 快照 + history 落盘全部收敛到 <cwd>/.context/，
 * 该目录只读声明、diff 天然排除（getProtoFileSignature/snapshotProtoFileContents 跳过 `.` 开头目录）。
 * 历史不限轮数/大小：只设 100KB 观测告警线，不截断，溢出控制交给各 CLI。 */
const UI_SPEC_PROMPT_MAX_BYTES = 48 * 1024;
const CONTEXT_DIR_NAME = '.context';
const CONTEXT_SPEC_FILE = 'ui-spec.md';
const CONTEXT_TOOLPROMPT_FILE = 'toolPrompt.md';
const CONTEXT_HISTORY_FILE = 'history.md';
const CONTEXT_SNAPSHOT_MAX_BYTES = 200 * 1024;
const HISTORY_ALARM_BYTES = 100 * 1024;
const CONTEXT_ARCHIVE_DIR = 'archive';
const HISTORY_ARCHIVE_NAME_MAX = 64;
/* 每 cwd 上次前端 tab（uiSessionId）映射：切 tab 检测用，进程内内存态，失败不阻断下发 */
const lastTabByCwd = new Map();
/* history 超限告警已提示集合（key=history 文件绝对路径，一文件只提示一次；归档/清空后删 key 允许新文件再提示） */
const historyAlarmWarned = new Set();
/* 归档文件名清洗：只留字母数字-_、截断 64 字符，空回落 unknown（防路径穿越/非法字符/超长） */
function sanitizeArchiveTabId(tabId) {
  try {
    const s = String(tabId == null ? '' : tabId).replace(/[^A-Za-z0-9-_]/g, '').slice(0, HISTORY_ARCHIVE_NAME_MAX);
    return s || 'unknown';
  } catch (e) { return 'unknown'; }
}
function historyArchivePath(cwd, tabId) {
  try {
    if (!cwd) return null;
    return path.join(cwd, CONTEXT_DIR_NAME, CONTEXT_ARCHIVE_DIR, sanitizeArchiveTabId(tabId) + '.md');
  } catch (e) { return null; }
}
/* 切 tab 归档：aiAskImpl 下发前调用。若同 cwd 上次 tab 与本次不同且 history.md 有内容，
 * 则重命名旧 history 到 .context/archive/<旧tab>.md，新任务从空文件开始 append。
 * 全部 try 包裹、失败返回 {archived:false} 不阻断下发；调用方不得因归档失败中断任务。 */
function maybeArchiveHistoryOnTabSwitch(cwd, uiSessionId) {
  const out = { archived: false };
  try {
    if (!cwd) return out;
    let cur = '';
    try { cur = String(uiSessionId == null ? '' : uiSessionId).trim(); } catch (_) { cur = ''; }
    if (!cur) return out;
    const key = String(cwd);
    let prev = null;
    try { prev = lastTabByCwd.get(key) || null; } catch (_) { prev = null; }
    if (!prev) { try { lastTabByCwd.set(key, cur); } catch (_) {} return out; }
    if (prev === cur) return out;
    try {
      const f = historyFilePath(cwd);
      let hasContent = false;
      try {
        const st = fs.statSync(f);
        if (st && st.size > 0) hasContent = true;
      } catch (_) { hasContent = false; }
      if (hasContent) {
        try {
          const dir = path.join(cwd, CONTEXT_DIR_NAME, CONTEXT_ARCHIVE_DIR);
          try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
          const dest = path.join(dir, sanitizeArchiveTabId(prev) + '.md');
          try {
            try { fs.renameSync(f, dest); }
            catch (e2) {
              try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (_) {}
              try { fs.renameSync(f, dest); }
              catch (e3) { try { fs.copyFileSync(f, dest); try { fs.unlinkSync(f); } catch (_) {} } catch (_) {} }
            }
          } catch (_) {}
          try { historyAlarmWarned.delete(f); } catch (_) {}
          out.archived = true;
        } catch (_) {}
      }
    } catch (_) {}
    try { lastTabByCwd.set(key, cur); } catch (_) {}
  } catch (e) {}
  return out;
}
function resolveUiSpecKind(extraOpts) {
  try {
    const k = String((extraOpts && (extraOpts.uiKind || extraOpts.kind)) || '').toLowerCase();
    if (k === 'pc' || k === 'desktop') return 'pc';
  } catch (e) {}
  return 'mobile';
}
/* 无依赖小哈希（FNV-1a 8位）：给快照打版本，不引入 require，保证测试可提取 */
function contextHash(text) {
  try {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  } catch (e) { return 'unknown'; }
}
function buildUiSpecSection(kind, spec) {
  const k = (String(kind || '').toLowerCase() === 'pc') ? 'pc' : 'mobile';
  const name = (spec && spec.name) || (k === 'pc' ? '桌面端UI规范' : '移动端UI规范');
  let version = 'unknown';
  try {
    const body = String((spec && spec.content) || '');
    if (body) version = (spec && spec.id ? String(spec.id) + '@' : '') + contextHash(body);
    else if (spec && spec.id) version = String(spec.id);
  } catch (e) {}
  const kindLabel = (k === 'pc') ? '桌面端（pc）' : '移动端（mobile）';
  return '【UI 设计规范】\n'
    + '当前原型端别：' + kindLabel + '，适用规范《' + name + '》（版本 ' + version + '）。\n'
    + '规范全文位于本工作目录 ' + CONTEXT_DIR_NAME + '/' + CONTEXT_SPEC_FILE + '，读不读、何时读按 toolPrompt.md 第五节执行。\n'
    + '它只约束界面的视觉呈现与交互形态，不约束代码实现方式（手写 CSS 或引用任意组件库均可，只要视觉结果符合规范）。';
}
function buildToolPromptPointer() {
  return '【工作纪律·必读】\n'
    + '开工前必须完整读取本工作目录 ' + CONTEXT_DIR_NAME + '/' + CONTEXT_TOOLPROMPT_FILE + ' 并严格遵守（原型与文档相互独立、只改所属文件、沙箱外文件只读、仅当前目录可写；违例视为任务失败）。'
    + '除任务必需外，只读工作目录及指针文件；严禁全盘扫描、枚举盘符、查看进程表。';
}
/* 目标文件显式声明（防同名副本改错地方）：argv/各 CLI 会按名全盘搜，
 * 必须给绝对路径 + 禁令。越界（不在 cwd 内）则返回空串不断链。
 * @param {string} cwd 沙箱工作目录
 * @param {Object} extraOpts 透传参数（含 targetFile/activePage）
 * @returns {string} 目标文件声明段或空串 */
function buildTargetFileSection(cwd, extraOpts) {
  try {
    if (!cwd) return '';
    const raw = String((extraOpts && (extraOpts.targetFile || extraOpts.activePage)) || '').trim();
    if (!raw) return '';
    if (/[\x00-\x1f\x7f]/.test(raw)) return '';
    const abs = path.normalize(path.isAbsolute(raw) ? raw : path.join(cwd, raw));
    const base = path.normalize(String(cwd));
    if (abs !== base && abs.indexOf(base + path.sep) !== 0) return '';
    const rel = path.relative(base, abs).replace(/\\/g, '/') || '.';
    return '【目标文件】本次只允许修改这一个文件：' + abs + '（相对工作目录：' + rel + '）。'
      + '严禁修改其他目录下的同名文件（包括开发目录或其他原型的同名副本）；'
      + '如该文件不存在，先报错停止，不得自行另找同名文件替代。';
  } catch (e) { return ''; }
}
/* ═══════ 技能映射·按关键词取用（agy 实测：纯关键词不会自动读 skill，必须显式给地址） ═══════
 * 仅当 staged 非空时下发：表格列触发关键词 + 沙箱内相对地址，命中时动手前完整读取全文。
 * @param {Array<{id:string,keywords:string,relPath:string}>} staged stageSkillsToContext 返回的已落盘清单
 * @returns {string} 映射段（空数组回空串，永不抛错） */
function buildSkillMapSection(staged) {
  try {
    if (!Array.isArray(staged) || !staged.length) return '';
    const rows = [];
    for (let i = 0; i < staged.length; i++) {
      try {
        const s = staged[i] || {};
        const kw = String(s.keywords || '').trim();
        let rel = String(s.relPath || '').trim().replace(/\\/g, '/');
        if (!kw || !rel) continue;
        if (rel.charAt(0) === '/') rel = rel.replace(/^\/+/, '');
        rows.push('| ' + kw + ' | ' + rel + ' |');
      } catch (e) {}
    }
    if (!rows.length) return '';
    return '【技能映射·按关键词取用】\n'
      + '下表按用户需求关键词取用对应技能；取用与读取时机按 toolPrompt.md 第五节执行。\n'
      + '| 触发关键词 | 技能地址（本工作目录相对路径） |\n'
      + '|---|---|\n'
      + rows.join('\n');
    } catch (e) { return ''; }
}
/* ═══════ 事前范围确认 S5（下发前快检，零打扰优先） ═══════
 * 无越界引用直接放行（不经 IPC，零打扰）；有则经 ai:event 发 scope_confirm 问渲染层一次
 * （允许本次/总是允许这类/拒绝），120 秒无应答按“仅沙箱内放行 + trace 注明”处理，不卡死。
 * 请求复用既有 ai:event 通道（前端 onEvent 已有多播，不新增主→渲通道）；
 * 回复走新通道 'ai:scope-confirm'（ai-controller.js 内 ipcMain.on + preload send，
 * 不占 ipcMain.handle 计数，70 通道冻结门禁保持全绿；无新依赖）。
 * “总是允许这类”记进程内内存 Map（key=cwd，不落盘，落盘是下一步的事）。
 * @param {string} text 下发前 finalPrompt 全文（指针 + 用户原文）
 * @param {string} cwd 沙箱工作目录（允许范围基准）
 * @returns {string[]} 越界引用片段（去重，上限 SCOPE_HITS_MAX；空即放行） */
const SCOPE_CONFIRM_TIMEOUT_MS = 120000;
const SCOPE_HITS_MAX = 20;
const scopeAlwaysAllowByCwd = new Map();
let scopeConfirmPending = false;
let scopeConfirmSeq = 0;
const scopeConfirmWaiters = new Map();
function findScopeRefs(text, cwd) {
  const hits = [];
  const seen = new Set();
  function pushHit(s) {
    try {
      let v = String(s || '').trim().replace(/[.,;:!?)\]}'"`、，。；：！？）】」]+$/, '');
      if (!v || v.length <= 3 || v.length > 260) return;
      if (seen.has(v)) return;
      seen.add(v);
      if (hits.length < SCOPE_HITS_MAX) hits.push(v);
    } catch (e) {}
  }
  let src = '';
  try { src = String(text || ''); } catch (e) { return hits; }
  if (!src) return hits;
  let cwdNorm = '';
  try { cwdNorm = path.normalize(String(cwd || '')).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(); } catch (e) { cwdNorm = ''; }
  function stripUncPrefix(s) {
    try { return String(s || '').replace(/^\\\\\?\\/, ''); } catch (e) { return String(s || ''); }
  }
  function isInsideCwd(p) {
    try {
      if (!cwdNorm || !p) return false;
      const nn = path.normalize(stripUncPrefix(String(p).replace(/\//g, '\\'))).replace(/\\+$/, '').toLowerCase();
      if (nn === cwdNorm || nn.indexOf(cwdNorm + '\\') === 0) return true;
      /* 截断的自身路径：候选是 cwd 的字符串前缀、但断点不在分隔符上
       *（如历史规模行“上次结论”取 120 字，把 \sandbox 切成 \s）。
       * 真父目录（断点正在分隔符上）仍判外面，不被本规则放行。 */
      if (nn && cwdNorm.indexOf(nn) === 0) {
        const nx = cwdNorm.charAt(nn.length);
        if (nx && nx !== '\\' && nx !== '/') return true;
      }
      return false;
    } catch (e) { return false; }
  }
  /* 预处理：先把 file:// 与正斜杠盘符路径整体判定（沙箱内直接放行，沙箱外记一条），
   * 并把已处理的 span 抹掉，避免 posix 分支把它们的尾巴（/sandbox/...）二次误判为外面。
   * 背景：agy 回答惯用 file:///C:/... 链接，历史指针的结论片段会把它带进下一轮 prompt。 */
  let masked = src;
  function maskSpan(s, start, len) {
    try {
      return s.slice(0, start) + ' '.repeat(len) + s.slice(start + len);
    } catch (e) { return s; }
  }
  try {
    const fileRe = /file:\/\/\/([A-Za-z]:[\/][^\s"'<>|`、。；：！？）】」]*)/gi;
    let mf = null;
    const spans = [];
    while ((mf = fileRe.exec(src)) !== null) {
      try {
        const raw = String(mf[1] || '');
        const norm = raw.replace(/\//g, '\\');
        spans.push([mf.index, mf[0].length]);
        if (norm.length > 3 && !isInsideCwd(norm)) pushHit(norm);
      } catch (e) {}
    }
    for (let si = spans.length - 1; si >= 0; si--) {
      masked = maskSpan(masked, spans[si][0], spans[si][1]);
    }
  } catch (e) {}
  try {
    const fwdRe = /(^|[^A-Za-z0-9_:\/\\])([A-Za-z]:\/[^\s"'<>|`、。；：！？）】」]*)/g;
    let mg = null;
    const spans2 = [];
    while ((mg = fwdRe.exec(masked)) !== null) {
      try {
        const raw2 = String(mg[2] || '');
        const norm2 = raw2.replace(/\//g, '\\');
        const at = mg.index + mg[1].length;
        spans2.push([at, mg[2].length]);
        if (norm2.length > 3 && !isInsideCwd(norm2)) pushHit(norm2);
      } catch (e) {}
    }
    for (let si2 = spans2.length - 1; si2 >= 0; si2--) {
      masked = maskSpan(masked, spans2[si2][0], spans2[si2][1]);
    }
  } catch (e) {}
  const scanSrc = masked;
  const posixRoots = ['users', 'home', 'etc', 'var', 'tmp', 'opt', 'root', 'mnt', 'data', 'private', 'usr', 'bin', 'sbin', 'lib', 'system', 'library', 'applications'];
  try {
    const drvRe = /(^|[^A-Za-z0-9_:/\\])([A-Za-z]:[\\/][^\s"'<>|`、。；：！？）】」]*)/g;
    let m = null;
    while ((m = drvRe.exec(scanSrc)) !== null) {
      try {
        const cand = String(m[2] || '').trim().replace(/[.,;:!?)\]}'"`、，。；：！？）】」]+$/, '');
        if (cand.length > 3 && !isInsideCwd(cand)) pushHit(cand);
      } catch (e) {}
    }
  } catch (e) {}
  try {
    const uncRe = /(^|[^A-Za-z0-9_:/\\])(\\\\[^\s"'<>|`、。；：！？）】」]+)/g;
    let m2 = null;
    while ((m2 = uncRe.exec(scanSrc)) !== null) {
      try {
        const cand2 = String(m2[2] || '').trim().replace(/[.,;:!?)\]}'"`、，。；：！？）】」]+$/, '');
        if (cand2.length > 3 && !isInsideCwd(cand2)) pushHit(cand2);
      } catch (e) {}
    }
  } catch (e) {}
  try {
    const pxRe = /(^|[^A-Za-z0-9_:/\\.\-])(\/[^\s"'<>|`、。；：！？）】」]+)/g;
    let m3 = null;
    while ((m3 = pxRe.exec(scanSrc)) !== null) {
      try {
        const cand3 = String(m3[2] || '').trim().replace(/[.,;:!?)\]}'"`、，。；：！？）】」]+$/, '');
        if (!cand3 || cand3.length <= 3) continue;
        const segs = cand3.replace(/^\/+/, '').split('/');
        const first = String(segs[0] || '').toLowerCase();
        const looksRooted = posixRoots.indexOf(first) >= 0;
        const looksDeep = segs.length >= 3 || (segs.length === 2 && /\.[A-Za-z0-9]{1,8}$/.test(segs[1]));
        /* 中文 prose 豁免：含 CJK 且非已知根的（如技能映射“修改原型、页面…”、用户“甲/乙/丙”）视为中文枚举而非路径；
         * 纯 ASCII 深路径（如 /etc/passwd、/a/b/c）照旧判定。win32 产品不考虑 CJK 的 posix 绝对路径。 */
        const hasCjk = /[一-鿿]/.test(cand3);
        if ((looksRooted || (looksDeep && !hasCjk)) && !isInsideCwd(cand3)) pushHit(cand3);
      } catch (e) {}
    }
  } catch (e) {}
  try {
    const ddRe = /[^\s"'<>|`、。；：！？）】」]*\.\.[\\/][^\s"'<>|`、。；：！？）】」]*/g;
    let m4 = null;
    while ((m4 = ddRe.exec(scanSrc)) !== null) {
      try { pushHit(m4[0]); } catch (e) {}
    }
  } catch (e) {}
  return hits;
}
/* “总是允许这类”内存态读写（key=String(cwd)，不落盘）。
 * @param {string} cwd 沙箱工作目录
 * @returns {boolean} 是否已记总是允许 */
function isScopeAlwaysAllowed(cwd) {
  try {
    if (!cwd) return false;
    return scopeAlwaysAllowByCwd.get(String(cwd)) === true;
  } catch (e) { return false; }
}
/* 记一笔总是允许（内存态，不落盘）。
 * @param {string} cwd 沙箱工作目录
 * @returns {void} */
function setScopeAlwaysAllowed(cwd) {
  try { if (cwd) scopeAlwaysAllowByCwd.set(String(cwd), true); } catch (e) {}
}
/* 测试/取消用：清空内存态与等待中的确认（不碰磁盘）。
 * @returns {void} */
function resetScopeConfirmForTest() {
  try { scopeAlwaysAllowByCwd.clear(); } catch (e) {}
  try {
    for (const w of scopeConfirmWaiters.values()) { try { w.resolve('deny'); } catch (e) {} }
    scopeConfirmWaiters.clear();
  } catch (e) {}
  try { scopeConfirmPending = false; } catch (e) {}
}
/* 渲染层回复入口（ai-controller.js 的 ipcMain.on 薄层路由到此；只认等待中的 id，未知 id/非法值忽略）。
 * @param {Object} payload {id:string, decision:'allow-once'|'allow-always'|'deny'}
 * @returns {boolean} 是否命中等待中的确认 */
function handleScopeConfirmResponse(payload) {
  try {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const id = String(p.id || p.scopeId || '').trim();
    if (!id) return false;
    let waiter = null;
    try { waiter = scopeConfirmWaiters.get(id) || null; } catch (e) { waiter = null; }
    if (!waiter) return false;
    const d = String(p.decision || p.choice || '').trim().toLowerCase().replace(/_/g, '-');
    const norm = (d === 'allow-once' || d === 'once' || d === 'allow') ? 'allow-once'
      : (d === 'allow-always' || d === 'always') ? 'allow-always'
      : (d === 'deny' || d === 'reject' || d === 'cancel') ? 'deny' : null;
    if (!norm) return false;
    try { waiter.resolve(norm); } catch (e) {}
    return true;
  } catch (e) { return false; }
}
/* 发起一次范围确认：经 sendFn 发 scope_confirm（复用 ai:event 信封），等回复或超时。
 * 超时/无发送能力按 'timeout' 解决（调用方转“仅沙箱内放行 + trace 注明”，不卡死）。
 * @param {Function} sendFn 发送函数 (payload)=>void（生产传 emitAiEvent 包装）
 * @param {string} cwd 沙箱工作目录
 * @param {string[]} hits findScopeRefs 命中的片段
 * @param {number} [timeoutMs] 超时毫秒（缺省 SCOPE_CONFIRM_TIMEOUT_MS；测试可传小值）
 * @returns {Promise<string>} 'allow-once'|'allow-always'|'deny'|'timeout' */
function awaitScopeConfirm(sendFn, cwd, hits, timeoutMs) {
  return new Promise((resolve) => {
    let id = '';
    try {
      scopeConfirmSeq += 1;
      id = 'scope-' + Date.now().toString(36) + '-' + scopeConfirmSeq;
    } catch (e) { id = 'scope-' + String(Date.now()); }
    let done = false;
    let timer = null;
    const finish = (decision) => {
      if (done) return;
      done = true;
      try { scopeConfirmWaiters.delete(id); } catch (e) {}
      try { if (timer) clearTimeout(timer); } catch (e) {}
      /* 框必关：超时/取消/回复任一解决都通知渲染层撤框（回复方已自撤，收到即 no-op），杜绝全屏遮罩孤儿导致全局输入失焦 */
      try {
        if (typeof sendFn === 'function') sendFn({ type: 'scope_confirm_dismiss', id });
      } catch (e) {}
      resolve(decision);
    };
    try { scopeConfirmWaiters.set(id, { resolve: finish, cwd: String(cwd || '') }); } catch (e) {}
    const ms = (typeof timeoutMs === 'number' && isFinite(timeoutMs) && timeoutMs > 0)
      ? Math.floor(timeoutMs) : SCOPE_CONFIRM_TIMEOUT_MS;
    try {
      timer = setTimeout(() => { finish('timeout'); }, ms);
      if (timer && typeof timer.unref === 'function') { try { timer.unref(); } catch (e) {} }
    } catch (e) {}
    try {
      if (typeof sendFn !== 'function') { finish('timeout'); return; }
      sendFn({ type: 'scope_confirm', id, cwd: String(cwd || ''), hits: Array.isArray(hits) ? hits.slice(0, SCOPE_HITS_MAX) : [] });
    } catch (e) { finish('timeout'); }
  });
}
/* 本轮用量累加（累加本轮各事件 usage；缺失/非法按 0；永不抛错）。
 * @param {Object} acc 累加器 {input_tokens,output_tokens,thinking_tokens,total_tokens}
 * @param {Object} u 单事件 usage（蛇形/camel 双兼容）
 * @returns {Object} 累加器本身 */
function addUsageCounts(acc, u) {
  try {
    if (!acc || typeof acc !== 'object') return acc;
    const s = (u && typeof u === 'object') ? u : null;
    if (!s) return acc;
    const num = (v) => { const n = Number(v); return (isFinite(n) && n > 0) ? Math.floor(n) : 0; };
    const pick = (o, a, b) => (o[a] != null ? o[a] : o[b]);
    acc.input_tokens = (Number(acc.input_tokens) || 0) + num(pick(s, 'input_tokens', 'inputTokens'));
    acc.output_tokens = (Number(acc.output_tokens) || 0) + num(pick(s, 'output_tokens', 'outputTokens'));
    acc.thinking_tokens = (Number(acc.thinking_tokens) || 0) + num(pick(s, 'thinking_tokens', 'thinkingTokens'));
    acc.total_tokens = (Number(acc.total_tokens) || 0) + num(pick(s, 'total_tokens', 'totalTokens'));
  } catch (e) {}
  return acc;
}
/* 用量总量行（全 0 回空串，调用方跳过不打扰）。
 * @param {Object} u 累加器
 * @returns {string} 文案或空串 */
function formatUsageLine(u) {
  try {
    const s = (u && typeof u === 'object') ? u : null;
    if (!s) return '';
    const num = (v) => { const n = Number(v); return (isFinite(n) && n > 0) ? Math.floor(n) : 0; };
    const i = num(s.input_tokens), o = num(s.output_tokens), t = num(s.total_tokens);
    if (i <= 0 && o <= 0 && t <= 0) return '';
    return '本轮 token 用量：输入 ' + i + ' / 输出 ' + o + ' / 共计 ' + t;
  } catch (e) { return ''; }
}
/* permissionMode 从配置读取（没有就当没配：回空串，调用方零行为变化）。
 * @param {Object} aiCfg loadAiConfigFull() 全量配置
 * @param {string} defId Agent 定义 id
 * @returns {string} 档位值或空串 */
function resolveCliPermissionMode(aiCfg, defId) {
  try {
    const id = String(defId || '').trim();
    if (!id) return '';
    const m = aiCfg && aiCfg.cliPermissionModes;
    if (!m || typeof m !== 'object') return '';
    const v = m[id];
    return (typeof v === 'string') ? v.trim() : '';
  } catch (e) { return ''; }
}
/**
 * 读取单个 Agent 的 ACP 配置（cfg.acp.agents[id]）；缺失/非法一律回空对象。
 * @param {Object} aiCfg loadAiConfigFull() 全量配置
 * @param {string} agentId Agent id
 * @returns {Object} Agent ACP 配置
 */
function resolveAgentAcpConfig(aiCfg, agentId) {
  try {
    const agents = aiCfg && aiCfg.acp && aiCfg.acp.agents;
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return {};
    const entry = agents[String(agentId || '')];
    return (entry && typeof entry === 'object' && !Array.isArray(entry)) ? entry : {};
  } catch (e) { return {}; }
}
/* ═══════ 沙箱根越界守卫（任务前后快照对比，性能有界） ═══════
 * 任务前对沙箱根计数，超 SANDBOX_GUARD_TOTAL_MAX_FILES 则跳过快照并 trace 注明；
 * 否则逐原型目录复用 getProtoFileSignature 拼 beforeMap（相对沙箱根路径），任务结束调 diffSandboxRootAgainst 对比。 */
const SANDBOX_GUARD_TOTAL_MAX_FILES = 5000;
/* 统计沙箱根下文件量（跳过点目录/node_modules，超限早退）。永不抛错。
 * @param {string} rootDir 沙箱根绝对路径
 * @param {number} [limit] 上限，缺省 5000
 * @returns {{count:number,over:boolean}} */
function countFilesUnderRoot(rootDir, limit) {
  const out = { count: 0, over: false };
  try {
    const lim = (typeof limit === 'number' && isFinite(limit) && limit > 0) ? Math.floor(limit) : SANDBOX_GUARD_TOTAL_MAX_FILES;
    if (!rootDir || !fs.existsSync(rootDir)) return out;
    let st = null;
    try { st = fs.statSync(rootDir); } catch (e) { return out; }
    if (!st || !st.isDirectory()) return out;
    const stack = [String(rootDir)];
    let n = 0;
    while (stack.length) {
      let cur = null;
      try { cur = stack.pop(); } catch (e) { break; }
      if (!cur) break;
      let entries = null;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { continue; }
      for (let i = 0; i < (entries || []).length; i++) {
        try {
          const en = entries[i];
          if (!en || !en.name) continue;
          if (String(en.name).charAt(0) === '.' || en.name === 'node_modules') continue;
          const full = path.join(cur, en.name);
          if (en.isDirectory()) {
            stack.push(full);
          } else if (en.isFile()) {
            n++;
            if (n > lim) { out.count = n; out.over = true; return out; }
          }
        } catch (e) {}
      }
    }
    out.count = n;
    out.over = n > lim;
  } catch (e) {}
  return out;
}
/* 组装沙箱根 beforeMap：遍历顶层原型目录，逐目录调 getProtoFileSignature，按“顶层名/目录内相对路径”拼键。
 * @param {string} rootDir 沙箱根绝对路径
 * @returns {Map<string,{size:number,mtimeMs:number}>} */
function buildSandboxRootBeforeMap(rootDir) {
  const beforeMap = new Map();
  try {
    if (!rootDir || !fs.existsSync(rootDir)) return beforeMap;
    let topEntries = null;
    try { topEntries = fs.readdirSync(String(rootDir), { withFileTypes: true }); } catch (e) { return beforeMap; }
    for (let i = 0; i < (topEntries || []).length; i++) {
      try {
        const t = topEntries[i];
        if (!t || !t.name) continue;
        if (String(t.name).charAt(0) === '.' || t.name === 'node_modules') continue;
        if (!t.isDirectory()) continue;
        const full = path.join(String(rootDir), t.name);
        let sig = null;
        try { sig = sandboxStorage.getProtoFileSignature(full); } catch (e) { sig = null; }
        if (!(sig instanceof Map)) continue;
        for (const [rel, vst] of sig.entries()) {
          try {
            const k = String(t.name) + '/' + String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
            beforeMap.set(k, vst);
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
  return beforeMap;
}
/* 安装根 toolPrompt.md 定位（main/services → 项目根；dev 与打包结构一致） */
function findToolPromptFile() {
  const cands = [];
  try { cands.push(path.join(__dirname, '..', '..', 'toolPrompt.md')); } catch (e) {}
  try { cands.push(path.join(process.cwd(), 'toolPrompt.md')); } catch (e) {}
  for (let i = 0; i < cands.length; i++) {
    try {
      const p = cands[i];
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}
/* 下发前快照：规范 + toolPrompt 拷进 <cwd>/.context/（覆盖写，保证新鲜）。失败回落 null，调用方跳过指针不断链。 */
function stageContextDir(cwd, uiSpec) {
  const out = { dir: null, specVersion: null, toolPromptBytes: 0 };
  try {
    if (!cwd || !fs.existsSync(cwd)) return out;
    const dir = path.join(cwd, CONTEXT_DIR_NAME);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { return out; }
    out.dir = dir;
    if (uiSpec && uiSpec.content) {
      try {
        const body = String(uiSpec.content);
        if (body && body.trim() && Buffer.byteLength(body, 'utf8') <= CONTEXT_SNAPSHOT_MAX_BYTES) {
          fs.writeFileSync(path.join(dir, CONTEXT_SPEC_FILE), body, 'utf8');
          out.specVersion = ((uiSpec && uiSpec.id) ? String(uiSpec.id) + '@' : '') + contextHash(body);
        }
      } catch (_) {}
    }
    const tp = findToolPromptFile();
    if (tp) {
      try {
        const tb = fs.readFileSync(tp, 'utf8');
        if (tb && tb.trim()) {
          fs.writeFileSync(path.join(dir, CONTEXT_TOOLPROMPT_FILE), tb, 'utf8');
          out.toolPromptBytes = Buffer.byteLength(tb, 'utf8');
        }
      } catch (_) {}
    }
  } catch (e) {}
  return out;
}
function historyFilePath(cwd) {
  try {
    if (!cwd) return null;
    return path.join(cwd, CONTEXT_DIR_NAME, CONTEXT_HISTORY_FILE);
  } catch (e) { return null; }
}
/* 读取历史规模：轮数/字节/上次结论（供指针规模行）。文件不存在即零记录，永不抛错。 */
function readHistoryScale(cwd) {
  const out = { rounds: 0, bytes: 0, lastConclusion: '' };
  try {
    const f = historyFilePath(cwd);
    if (!f || !fs.existsSync(f)) return out;
    let st = null;
    try { st = fs.statSync(f); } catch (_) { return out; }
    out.bytes = (st && st.size) || 0;
    if (!out.bytes) return out;
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch (_) { return out; }
    if (!text) return out;
    const rounds = text.match(/^## 第\d+轮/mg);
    out.rounds = rounds ? rounds.length : 0;
    const conclusions = text.match(/^\*\*结论\*\*：([^\n]*)/mg);
    if (conclusions && conclusions.length) {
      out.lastConclusion = cutSummaryLine(String(conclusions[conclusions.length - 1]).replace(/^\*\*结论\*\*：/, ''));
    }
  } catch (e) {}
  return out;
}
/* 摘要不断句：目标长度 SUMMARY_SOFT，允许向后波动到 SUMMARY_HARD，在句末标点处收尾；
 * 找不到句末则在目标处硬切。无依赖纯函数（句末：。！？!?；与换行）。 */
const SUMMARY_SOFT_LEN = 120;
const SUMMARY_HARD_LEN = 170;
function cutSummaryLine(s) {
  try {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    if (t.length <= SUMMARY_SOFT_LEN) return t;
    const win = t.slice(SUMMARY_SOFT_LEN, SUMMARY_HARD_LEN);
    const m = win.match(/[。！？!?\n；]/);
    if (m && typeof m.index === 'number') return t.slice(0, SUMMARY_SOFT_LEN + m.index + 1).trim();
    return t.slice(0, SUMMARY_SOFT_LEN).trim();
  } catch (e) {
    try { return String(s || '').trim().slice(0, SUMMARY_SOFT_LEN); } catch (_) { return ''; }
  }
}
function buildHistoryPointer(cwd) {
  try {
    const s = readHistoryScale(cwd);
    if (!s.rounds) {
      return '【对话历史】本原型暂无历史记录（首轮结束后将生成 ' + CONTEXT_DIR_NAME + '/' + CONTEXT_HISTORY_FILE + '）。';
    }
    const kb = Math.max(1, Math.round(s.bytes / 1024));
    return '【对话历史】本工作目录 ' + CONTEXT_DIR_NAME + '/' + CONTEXT_HISTORY_FILE
      + '（共' + s.rounds + '轮，约' + kb + 'KB，上次结论：' + (s.lastConclusion || '无') + '）。'
      + '如需前情，按需读取该文件相关轮次；与本轮无关则忽略。';
  } catch (e) {
    return '';
  }
}
/* 任务结束 append 一轮（冻结在开工视角之外，专供下一轮读）。文件只增不减；超观测线仅回传 alarm，由调用方决定是否提示。 */
function appendHistoryRound(cwd, round) {
  const out = { ok: false, alarm: false };
  try {
    if (!cwd) return out;
    const dir = path.join(cwd, CONTEXT_DIR_NAME);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { return out; }
    const f = path.join(dir, CONTEXT_HISTORY_FILE);
    const r = (round && typeof round === 'object') ? round : {};
    const scale = readHistoryScale(cwd);
    const n = scale.rounds + 1;
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const user = String(r.user || '').trim();
    const answer = String(r.answer || '').trim();
    let changes = '无';
    try {
      const fc = Array.isArray(r.fileChanges) ? r.fileChanges : [];
      const parts = [];
      for (let i = 0; i < fc.length; i++) {
        const c = fc[i] || {};
        const p = String(c.path || c.file || c.name || '').trim();
        if (!p) continue;
        let seg = p + '（' + String(c.action || '修改') + '）';
        const a = Number(c.added), x = Number(c.deleted);
        if (isFinite(a) || isFinite(x)) {
          seg += '[+' + (isFinite(a) ? a : 0) + ' −' + (isFinite(x) ? x : 0) + ']';
        }
        parts.push(seg);
      }
      if (parts.length) changes = parts.join('；');
    } catch (_) {}
    const block = '## 第' + n + '轮 · ' + ts + '\n'
      + '**用户**：' + (user || '（空）') + '\n'
      + '**结论**：' + (answer || '（本轮无文本输出）') + '\n'
      + '**改动**：' + changes + '\n\n';
    let head = '';
    try {
      if (!fs.existsSync(f)) {
        head = '# 对话记录（本文件只增不减，供模型按需读取前情）\n\n';
      }
    } catch (_) {}
    fs.appendFileSync(f, head + block, 'utf8');
    out.ok = true;
    try {
      const st = fs.statSync(f);
      if (st && st.size > HISTORY_ALARM_BYTES) out.alarm = true;
    } catch (_) {}
  } catch (e) {}
  return out;
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
/* 历史遗留：早期曾统一清洗 -free 后缀，现 free 为独立模型不再调用，仅保留符号兼容（门禁锁名） */
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
    id = String(id || '').trim();
    if (!id || id === 'default') return;
    if (/embed|tts\b|text-to-speech|stt\b|whisper|dall-?e|text-embedding|image-?gen/i.test(id)) return;
    if (id.length > 128 || /\s/.test(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: (m && typeof m === 'object' && (m.label || m.name)) || id });
  });
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/* 行式模型表兜底解析（qoderclicn --list-models 类纯文本表）：按行取id，跳过表头与空行；
 * 仅当 def.listModels.lineBased 显式开启时启用，其他 def 保持原 [] 语义不变 */
function parseLineBasedModels(out, def) {
  try {
    if (!def || !def.listModels || def.listModels.lineBased !== true) return [];
    const skip = String(def.listModels.skipHeader || '').trim().toLowerCase();
    const ids = [];
    String(out || '').split(/\r?\n/).forEach((line) => {
      const id = String(line || '').trim();
      if (!id) return;
      if (skip && id.toLowerCase() === skip) return;
      if (/\s/.test(id) || id.length > 128) return;
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  } catch (e) { return []; }
}
/* CLI 原生模型探测：超时 / 取消 / 失败时按进程树收尾。
 * .cmd/.bat 经 cmd.exe 包装后会派生 node 子进程；只 child.kill() 会留下 node + conhost，
 * 并让它们继续继承 Electron 的 fd3/fd4。统一交给 acp-process-lifecycle：
 * taskkill /pid <cmdPid> /T /F，同时销毁 stdout/stderr，确保探测结束即释放管道。 */
function execCliListModels(resolvedBin, def, options) {
  const opts = (options && typeof options === 'object') ? options : {};
  return new Promise((resolve) => {
    let child = null;
    let timer = null;
    let done = false;
    let removeAbort = null;
    const cleanup = () => {
      if (timer) { try { clearTimeout(timer); } catch (e) {} timer = null; }
      if (removeAbort) { try { removeAbort(); } catch (e) {} removeAbort = null; }
    };
    const finish = (items, killTree) => {
      if (done) return;
      done = true;
      cleanup();
      let stopping = null;
      try {
        stopping = killTree
          ? acpProcessLifecycle.killPidTree(child && child.pid, 'cli-list-models')
          : Promise.resolve(acpProcessLifecycle.releaseChild(child));
      } catch (e) {
        stopping = null;
      }
      Promise.resolve(stopping).catch(() => {}).then(() => resolve(items));
    };
    try {
      const args = (def && def.listModels && Array.isArray(def.listModels.args)) ? def.listModels.args : ['models'];
      const timeoutMs = (def && def.listModels && def.listModels.timeoutMs) || 5000;
      const invocation = createCommandInvocation({ command: resolvedBin, args, env: applyAgentLaunchEnv() });
      child = spawn(invocation.command, invocation.args, {
        cwd: os.tmpdir(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: invocation.windowsVerbatimArguments
      });
      try {
        acpProcessLifecycle.registerChild(child, {
          kind: 'cli-list-models',
          label: String(resolvedBin || invocation.command || ''),
          command: String(invocation.command || '')
        });
      } catch (e) {}

      const signal = opts.signal;
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) { finish(null, true); return; }
        const onAbort = () => finish(null, true);
        try {
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbort = () => { try { signal.removeEventListener('abort', onAbort); } catch (e) {} };
        } catch (e) {}
      }

      let out = ''; let err = '';
      timer = setTimeout(() => finish(null, true), timeoutMs);
      if (timer && typeof timer.unref === 'function') { try { timer.unref(); } catch (e) {} }
      if (child.stdout) child.stdout.on('data', (d) => { out += d.toString('utf8'); });
      if (child.stderr) child.stderr.on('data', (d) => { err += d.toString('utf8'); });
      child.on('error', () => { finish(null, true); });
      child.on('close', () => {
        if (done) return;
        let items = null;
        try {
          const parse = def && def.listModels && typeof def.listModels.parse === 'function' ? def.listModels.parse : null;
          items = parse ? parse(out, err) : parseLineBasedModels(out, def);
          if (!Array.isArray(items)) items = [];
        } catch (e) { items = null; }
        finish(items, false);
      });
    } catch (e) { finish(null, false); }
  });
}

/* ═══════ ACP 模型探测（B1） ═══════
 * ai:models 的 ACP 分支：先按 T1 的 resolveAgentCommand 解析选中 Agent 的启动命令，
 * 再调 acpx inspectAgentModels（只做 initialize/session/new 探测，不发送 prompt）。
 * 命令解析失败显性返回 ACP_BACKEND_MISSING，不再拿 legacy def.fallbackModels 冒充成功；
 * 探测失败/返回空才落到 acp-config 的 ACP_MODEL_FALLBACKS（全部为 ACP id）。 */
const ACP_MODELS_TIMEOUT_MS = 15000;
/** @type {Promise<{inspectAgentModels:Function}>|null} acpx 模块加载缓存 */
let acpxModelsModulePromise = null;

/* ═══════ ACP 模型目录磁盘缓存 + 后台刷新（T7a） ═══════
 * 首屏路径：内存缓存 -> userData/acp-model-catalog.json -> CLI 原生 models -> ACP fallback。
 * ACP inspectAgentModels 只在后台跑（stale-while-revalidate），完成后经 ai:event 的
 * acp_catalog 事件回推；同一 key 的刷新在进程内去重，失败保留旧目录不发空列表。
 * 测试可注入 inspectAgentModels / CLI / 命令解析 / 缓存实例，纯 Node 不启 Electron。 */
const acpModelCatalog = createAcpModelCache();
/** @type {Map<string,Promise<Object>>} `<agentId>::<command>` → 进行中的刷新 */
const acpCatalogRefreshMap = new Map();
let acpCatalogRequestSeq = 0;
/** @type {Set<AbortController>} 进行中的 ACP 模型目录探测（退出/取消时统一 abort） */
const acpCatalogAbortControllers = new Set();
/** @type {Set<string>} ACP 探测命令签名（退出兜底扫描 inspectAgentModels 这类无 processLifecycle 的进程） */
const acpProbeCommandSignatures = new Set();
/** @type {boolean} 本次生命周期是否已做过后代树兜底扫描（避免 will-quit / exit 重复 PowerShell 查询） */
let acpOrphanSweepDone = false;

/**
 * 记录 ACP 探测命令签名，供退出时按后代树兜底清理。
 * 只取长度 >= 5 的命令/路径片段，避免用 node/cmd 等通用词误杀。
 * @param {string[]} agentCommand 解析后的启动命令
 * @returns {void}
 */
function rememberAcpProbeCommand(agentCommand) {
  try {
    const argv = Array.isArray(agentCommand) ? agentCommand : [];
    for (const raw of argv) {
      const s = String(raw || '').trim();
      if (s.length < 5 || s.charAt(0) === '-') continue;
      acpProbeCommandSignatures.add(s.toLowerCase());
      try {
        const base = path.basename(s).toLowerCase().replace(/\.(cmd|bat|exe)$/, '');
        if (base.length >= 5) acpProbeCommandSignatures.add(base);
      } catch (e) {}
    }
    acpProbeCommandSignatures.add('--acp');
    acpOrphanSweepDone = false;
  } catch (e) {}
}

/**
 * 中止所有后台 ACP 模型目录探测，避免应用退出后仍持有 agent 子进程。
 * @param {string} [reason] 中止原因（仅诊断）
 * @returns {number} 中止数量
 */
function abortAcpCatalogRefreshes(reason) {
  let n = 0;
  for (const controller of Array.from(acpCatalogAbortControllers)) {
    try {
      controller.abort(new Error(String(reason || 'acp-catalog-aborted')));
      n += 1;
    } catch (e) {}
  }
  acpCatalogAbortControllers.clear();
  return n;
}

/**
 * 等待被 abort 的 ACP 目录探测自行收尾（acpx 会在 finally 中 close agent）。
 * 超时后继续退出流程，由进程树登记兜底。
 * @param {number} timeoutMs 最长等待毫秒
 * @returns {Promise<void>}
 */
function waitForAcpCatalogRefreshes(timeoutMs) {
  const pending = [];
  try {
    for (const promise of acpCatalogRefreshMap.values()) pending.push(promise);
  } catch (e) {}
  if (!pending.length) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(1, timeoutMs));
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (e) {}
    }
    Promise.allSettled(pending).then(finish, finish);
  });
}

const acpModelsTestHooks = {
  inspectAgentModels: null,
  execCliListModels: null,
  resolveLaunchCommand: null,
  cache: null,
  previewModelConfig: null,
  /* undefined = 未注入（生产走真实磁盘缓存）；false = 显式禁用；实例 = 注入 */
  thinkingCache: undefined,
  /* 是否装了任何 ai:models 探测钩子：装了默认隔离真实用户缓存，保证用例可重复 */
  installed: false
};

/**
 * 注入 ACP 模型目录依赖（仅测试使用；传空对象恢复真实实现）。
 * @param {Object} [hooks] {inspectAgentModels, execCliListModels, resolveLaunchCommand, cache, previewModelConfig, thinkingCache}
 * @returns {void}
 */
function __setAcpModelsTestHooks(hooks) {
  const h = (hooks && typeof hooks === 'object') ? hooks : {};
  acpModelsTestHooks.inspectAgentModels = typeof h.inspectAgentModels === 'function' ? h.inspectAgentModels : null;
  acpModelsTestHooks.execCliListModels = typeof h.execCliListModels === 'function' ? h.execCliListModels : null;
  acpModelsTestHooks.resolveLaunchCommand = typeof h.resolveLaunchCommand === 'function' ? h.resolveLaunchCommand : null;
  acpModelsTestHooks.cache = (h.cache && typeof h.cache.get === 'function' && typeof h.cache.set === 'function')
    ? h.cache
    : null;
  acpModelsTestHooks.previewModelConfig = typeof h.previewModelConfig === 'function' ? h.previewModelConfig : null;
  /* 思考缓存只认显式声明：false 禁用；合法实例注入；其余回到「未注入」 */
  if (h.thinkingCache === false) acpModelsTestHooks.thinkingCache = false;
  else if (h.thinkingCache && typeof h.thinkingCache.get === 'function' && typeof h.thinkingCache.set === 'function') {
    acpModelsTestHooks.thinkingCache = h.thinkingCache;
  } else acpModelsTestHooks.thinkingCache = undefined;
  acpModelsTestHooks.installed = !!(acpModelsTestHooks.inspectAgentModels
    || acpModelsTestHooks.execCliListModels
    || acpModelsTestHooks.resolveLaunchCommand
    || acpModelsTestHooks.previewModelConfig);
}

/**
 * 生成一次 ai:models / acp_catalog 关联 id（UI 可据此丢弃过期事件）。
 * @returns {string} 请求 id
 */
function nextAcpCatalogRequestId() {
  acpCatalogRequestSeq += 1;
  return 'acpcat-' + Date.now().toString(36) + '-' + acpCatalogRequestSeq;
}

/**
 * 在项目根 / 当前目录的 node_modules/.bin 内查找适配器命令（与 acp-runtime 默认解析保持一致）。
 * @param {string} name 适配器或命令名
 * @returns {string|null} 可执行文件绝对路径或 null
 */
function resolveAcpLocalBin(name) {
  const base = String(name || '').trim();
  if (!base) return null;
  const roots = [];
  try { roots.push(path.join(__dirname, '..', '..')); } catch (e) {}
  try { roots.push(process.cwd()); } catch (e) {}
  const isWin = process.platform === 'win32';
  const suffixes = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const root of roots) {
    if (!root) continue;
    for (const suffix of suffixes) {
      try {
        const full = path.join(root, 'node_modules', '.bin', base + suffix);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch (e) {}
    }
  }
  return null;
}

/**
 * 解析适配器 / 专用命令名：node_modules/.bin 优先，其次 PATH / npm 全局。
 * @param {string} name 适配器或命令名
 * @returns {Promise<string|null>} 可执行文件绝对路径或 null
 */
async function resolveAcpCommandName(name) {
  const local = resolveAcpLocalBin(name);
  if (local) return local;
  try {
    return await resolveAgentExecutable({ id: String(name || ''), bin: String(name || ''), fallbackBins: [] }, '');
  } catch (e) {
    return null;
  }
}

/**
 * 汇总用户自定义 CLI 路径（cliPaths 优先，旧 cliPath 兜底 opencode）。
 * @param {Object} cfg AI 配置
 * @returns {Object<string,string>} id → 自定义路径
 */
function collectAcpCustomPaths(cfg) {
  const out = {};
  try {
    const map = cfg && cfg.cliPaths;
    if (map && typeof map === 'object') {
      for (const id of Object.keys(map)) {
        const v = map[id] == null ? '' : String(map[id]).trim();
        if (v) out[String(id)] = v;
      }
    }
  } catch (e) {}
  try {
    const legacy = cfg && cfg.cliPath ? String(cfg.cliPath).trim() : '';
    if (legacy && !out.opencode) out.opencode = legacy;
  } catch (e) {}
  return out;
}

/**
 * 解析选中 Agent 的 ACP 启动命令（自定义路径 > adapter/command > 原生 bin）。
 * @param {Object} def Agent 定义
 * @param {Object} cfg AI 配置
 * @returns {Promise<{command:string[]|null, unresolved:Object|null}>} 解析结果
 */
async function resolveAcpLaunchCommand(def, cfg) {
  const customPaths = collectAcpCustomPaths(cfg);
  try {
    return await resolveAgentCommand(def, {
      customPaths,
      resolveBin: (d) => resolveAgentExecutable(d, customPaths[(d && d.id) || ''] || ''),
      resolveAdapter: (name) => resolveAcpCommandName(name),
      resolveCommand: (name) => resolveAcpCommandName(name)
    });
  } catch (e) {
    return {
      command: null,
      unresolved: {
        reason: 'resolve_failed',
        candidates: [],
        error: String((e && e.message) || e).slice(0, 300)
      }
    };
  }
}

/**
 * 加载 acpx 模块里的 inspectAgentModels（ESM 动态 import，失败转 ACP_BACKEND_MISSING）。
 * @returns {Promise<{inspectAgentModels:Function}>} 探测器
 */
async function loadAcpxModelsModule() {
  if (!acpxModelsModulePromise) {
    acpxModelsModulePromise = import('acpx/runtime').then((mod) => {
      const fn = mod && (mod.inspectAgentModels || (mod.default && mod.default.inspectAgentModels));
      if (typeof fn !== 'function') {
        const err = new Error('acpx/runtime 未导出 inspectAgentModels');
        err.code = 'ACP_BACKEND_MISSING';
        throw err;
      }
      return { inspectAgentModels: fn };
    }).catch((e) => {
      acpxModelsModulePromise = null;
      if (e && e.code === 'ACP_BACKEND_MISSING') throw e;
      const err = new Error('ACP 运行时不可用：未安装 acpx，或 acpx/runtime 无法加载。');
      err.code = 'ACP_BACKEND_MISSING';
      err.cause = e;
      throw err;
    });
  }
  return acpxModelsModulePromise;
}

/**
 * 探测用工作目录：优先 hint 显式目录，其次沙箱根，最后临时目录 / 当前目录。
 * @param {Object} hint ai:models 的 hint
 * @returns {string} 存在的目录绝对路径
 */
function resolveAcpModelsCwd(hint) {
  const cands = [];
  try {
    const own = hint && (hint.cwd || hint.sandboxDir);
    if (own) cands.push(String(own));
  } catch (e) {}
  try { cands.push(paths.SANDBOX_ROOT); } catch (e) {}
  try { cands.push(os.tmpdir()); } catch (e) {}
  for (const c of cands) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch (e) {}
  }
  return process.cwd();
}

/**
 * 组装 ACP_BACKEND_MISSING 的 detail（可读候选链，已脱敏且截断 800 字）。
 * @param {Object} def Agent 定义
 * @param {Object} unresolved resolveAgentCommand 的失败明细
 * @returns {string} detail 文本
 */
function formatAcpBackendMissingDetail(def, unresolved) {
  const u = (unresolved && typeof unresolved === 'object') ? unresolved : {};
  const acp = (def && def.acp && typeof def.acp === 'object') ? def.acp : {};
  const expected = acp.command || acp.adapter || (def && def.bin) || (def && def.id) || 'unknown';
  const parts = ['ACP 启动命令解析失败：' + String(expected)];
  if (u.reason) parts.push('reason=' + String(u.reason));
  const chain = [];
  const cands = Array.isArray(u.candidates) ? u.candidates.slice(0, 8) : [];
  for (const c of cands) {
    if (!c || typeof c !== 'object') continue;
    const seg = [];
    if (c.kind) seg.push(String(c.kind));
    if (c.name) seg.push(String(c.name));
    if (c.reason) seg.push(String(c.reason));
    if (seg.length) chain.push(seg.join(':'));
  }
  if (chain.length) parts.push('candidates=' + chain.join(' -> '));
  if (u.error) parts.push('error=' + String(u.error).slice(0, 300));
  return parts.join('；').slice(0, 800);
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
    /* Phase 1：探测结果只附加静态 transport/acp 元数据，不做 ACP initialize（26 个 Agent 全量握手太慢）。 */
    const acpEnabled = !!(aiCfg && aiCfg.acp && aiCfg.acp.enabled === true);
    const agentDefsById = {};
    try {
      for (const d of getAllAgentDefs()) { if (d && d.id) agentDefsById[d.id] = d; }
    } catch (e) {}
    const withTransport = (agents || []).map((a) => {
      if (!a || typeof a !== 'object') return a;
      let def = agentDefsById[a.id] || null;
      if (!def) { try { def = getAgentDef(a.id) || null; } catch (e) { def = null; } }
      const transport = (def && def.transport) || 'legacy';
      const acpDef = (def && def.acp && typeof def.acp === 'object') ? def.acp : {};
      return Object.assign({}, a, {
        transport,
        acp: {
          supported: transport === 'acp',
          adapter: !!acpDef.adapter,
          adapterName: acpDef.adapter ? String(acpDef.adapter) : '',
          command: acpDef.command ? String(acpDef.command) : '',
          enabled: acpEnabled
        }
      });
    });
    const oc = (withTransport || []).find(a => a && a.id === 'opencode') || null;
    if (oc && oc.available) return { found: true, path: oc.path, version: oc.version, agents: withTransport };
    const anyOk = (withTransport || []).find(a => a && a.available) || null;
    if (anyOk) return { found: true, path: anyOk.path, version: anyOk.version, agents: withTransport };
    return { found: false, path: null, version: null, agents: withTransport || [] };
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

/* ═══════ 思考强度缓存（主进程后台） ═══════
 * ACP previewModelConfig 要拉起 Agent 子进程，不能让「打开设置 / 保存模型 / 应用启动」等它。
 * 缓存落在 userData/ai-thinking-cache.json（见 services/ai-thinking-cache），key = `agentId|model`：
 * - 命中（ready / unsupported）直接回上次 configOptions，不解析命令、不启动 ACP；
 * - hint.background=true 立刻回 {status:'probing'}，真实探测丢后台队列，同 key 单飞去重；
 * - 探测完成（无论成功/失败）回写缓存，供下次秒回。
 * 只存 UI 元数据，敏感键在 cache 模块内递归剔除。 */
/** @type {Object|null} 真实磁盘缓存实例（惰性创建；失败回 null 按无缓存处理） */
let thinkingCacheSingleton = null;
/** @type {Map<string,Promise<Object>>} `<agentId>|<model>` → 进行中的后台探测（同 key 单飞） */
const thinkingProbeInflight = new Map();
/** @type {Promise<Object>|null} 启动预热 promise（只跑一次；并发调用复用） */
let thinkingWarmPromise = null;

/**
 * 取真实磁盘缓存实例（惰性；构造失败不抛）。
 * @returns {Object|null} 缓存实例
 */
function getThinkingCacheInstance() {
  if (thinkingCacheSingleton) return thinkingCacheSingleton;
  try {
    thinkingCacheSingleton = aiThinkingCache.createThinkingCache();
  } catch (e) {
    thinkingCacheSingleton = null;
  }
  return thinkingCacheSingleton;
}

/**
 * 选本次可用的缓存实例（测试可注入 / 可禁用）。
 * - 注入实例优先；
 * - 显式 false 或装了任何 ai:models 探测钩子（用例）→ 不碰真实用户缓存，保证用例可重复；
 * - 生产无钩子 → 真实磁盘缓存。
 * @returns {Object|null} 缓存实例或 null
 */
function resolveThinkingCache() {
  const injected = acpModelsTestHooks.thinkingCache;
  if (injected && typeof injected.get === 'function' && typeof injected.set === 'function') return injected;
  if (injected === false) return null;
  if (acpModelsTestHooks.installed) return null;
  if (String(process.env.PLAND_THINKING_CACHE || '') === '0') return null;
  return getThinkingCacheInstance();
}

/**
 * 诊断输出：默认静默（不弹窗、不打断流程），需要时用 PLAND_AI_TRACE=1 打开。
 * @param {string} text 说明
 * @param {boolean} [force] 是否强制输出（启动预热失败用，每次启动至多一行）
 * @returns {void}
 */
function traceThinking(text, force) {
  try {
    if (!force && !process.env.PLAND_AI_TRACE) return;
    console.warn('[ai-thinking-cache] ' + String(text || ''));
  } catch (e) {}
}

/**
 * 读缓存命中项：只有 ready / unsupported 算命中（error 视为未命中，允许重探）。
 * @param {Object|null} cache 缓存实例
 * @param {string} key `<agentId>|<model>`
 * @returns {Object|null} 命中记录
 */
function readThinkingCacheHit(cache, key) {
  if (!cache) return null;
  let entry = null;
  try { entry = cache.get(key); } catch (e) { return null; }
  if (!entry || typeof entry !== 'object') return null;
  if (entry.status !== 'ready' && entry.status !== 'unsupported') return null;
  if (entry.status === 'ready' && !(Array.isArray(entry.configOptions) && entry.configOptions.length)) return null;
  return entry;
}

/**
 * 把一次探测结果回写缓存（成功 / 不支持 / 失败都记，失败记录不参与命中）。
 * @param {Object|null} cache 缓存实例
 * @param {{agentId:string, model:string}} meta 目标 agent/模型
 * @param {Object} result probeAcpModelConfig 结果
 * @returns {Object|null} 写入的记录
 */
function writeThinkingCacheOutcome(cache, meta, result) {
  if (!cache) return null;
  try {
    const r = (result && typeof result === 'object') ? result : {};
    const agentId = String((meta && meta.agentId) || r.agentId || '').trim();
    const model = String((meta && meta.model) || r.model || '').trim();
    if (!agentId || !model) return null;
    const errorCode = String(r.error || '');
    const status = r.ok === true ? 'ready' : (errorCode === 'ACP_MODEL_UNSUPPORTED' ? 'unsupported' : 'error');
    const payload = {
      agentId,
      model,
      configOptions: (status === 'ready' && Array.isArray(r.configOptions)) ? r.configOptions : [],
      modelConfigId: status === 'ready' ? String(r.modelConfigId || '') : '',
      status
    };
    if (status !== 'ready') {
      payload.error = (errorCode + (r.detail ? ':' + String(r.detail) : '')) || 'ACP_PROBE_FAILED';
    }
    return cache.set(aiThinkingCache.buildCacheKey(agentId, model), payload);
  } catch (e) {
    traceThinking('write failed: ' + String((e && e.message) || e));
    return null;
  }
}

/**
 * 后台探测排队 + 同 key 单飞：立刻返回 promise，实际执行推到下一轮事件循环。
 * @param {string} key `<agentId>|<model>`
 * @param {Function} run 返回 Promise 的探测任务
 * @returns {Promise<Object|null>} 任务结果（永不 reject）
 */
function startBackgroundThinkingProbe(key, run) {
  const k = String(key || '');
  if (!k || typeof run !== 'function') return Promise.resolve(null);
  const running = thinkingProbeInflight.get(k);
  if (running) return running;
  const task = new Promise((resolve) => {
    const kick = () => {
      Promise.resolve().then(run).then(resolve, (err) => {
        traceThinking('probe failed: ' + String((err && err.message) || err));
        resolve(null);
      });
    };
    try { setImmediate(kick); } catch (e) { kick(); }
  }).finally(() => {
    try { thinkingProbeInflight.delete(k); } catch (e) {}
  });
  thinkingProbeInflight.set(k, task);
  return task;
}

/**
 * 读当前配置里「最近的模型」：显式 cfg.model → 当前 Agent 的 CLI 可见首个 → 旧全局可见首个。
 * agentId 参与隔离，换 Agent 不会串档。
 * @param {Object} cfg 完整 AI 配置
 * @param {string} agentId 当前 Agent id
 * @returns {string} 模型 id（可能为空）
 */
function resolveConfiguredModel(cfg, agentId) {
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  const direct = String(c.model || '').trim();
  if (direct) return direct;
  const id = String(agentId || '').trim();
  const cli = c.visibleModelsCli;
  const firstOf = (list) => {
    if (!Array.isArray(list)) return '';
    for (const item of list) {
      const m = String(item == null ? '' : item).trim();
      if (m) return m;
    }
    return '';
  };
  let picked = '';
  if (cli && typeof cli === 'object' && !Array.isArray(cli) && id) picked = firstOf(cli[id]);
  if (!picked) picked = firstOf(cli);
  if (!picked) picked = firstOf(c.visibleModels);
  return picked;
}

/**
 * 启动预热：当前 Agent + 模型下，ACP 启用时后台探测一次思考档位并写入缓存。
 * 只执行一次（并发复用同一 promise）；失败只 trace，不弹窗、不阻塞启动。
 * @param {Object} [options] {force?:boolean} 强制重探（忽略缓存命中）
 * @returns {Promise<Object>} {ok, agentId, model, cached?/skipped?/scheduled?, task?}
 */
function warmThinkingCache(options) {
  if (thinkingWarmPromise) return thinkingWarmPromise;
  const opts = (options && typeof options === 'object') ? options : {};
  thinkingWarmPromise = (async () => {
    let agentId = '';
    let model = '';
    try {
      const cfg = aiConfigStore.loadAiConfigFull();
      agentId = String(cfg.agentId || cfg.mainAgent || 'opencode');
      model = resolveConfiguredModel(cfg, agentId);
      if (!model) return { ok: true, agentId, model, skipped: 'no-model' };
      const def = getAgentDef(agentId);
      if (!def) return { ok: true, agentId, model, skipped: 'agent-not-found' };
      if (!isAcpEnabled(cfg, def)) return { ok: true, agentId, model, skipped: 'acp-disabled' };
      const cache = resolveThinkingCache();
      const key = aiThinkingCache.buildCacheKey(agentId, model);
      if (!opts.force && readThinkingCacheHit(cache, key)) {
        return { ok: true, agentId, model, cached: true };
      }
      /* 直接排非 background 任务：background 分支只负责「立刻返回占位」，
       * 预热本身已经在后台队列里，不能再绕一层占位。 */
      const task = startBackgroundThinkingProbe(key, () => probeAcpModelConfig({
        engine: 'cli',
        probeModel: model,
        agentId,
        background: false,
        force: opts.force === true
      }, model, cfg));
      task.catch(() => {});
      return { ok: true, agentId, model, scheduled: true, task };
    } catch (e) {
      traceThinking('warm failed: ' + String((e && e.message) || e), true);
      return { ok: false, agentId, model, error: String((e && e.message) || e) };
    }
  })();
  return thinkingWarmPromise;
}

/**
 * 等所有后台思考探测收尾（测试用；退出时也可用来观察）。
 * @returns {Promise<void>} 全部 settle 后 resolve
 */
function waitForThinkingProbes() {
  const pending = [];
  try {
    for (const task of thinkingProbeInflight.values()) pending.push(task);
  } catch (e) {}
  if (!pending.length) return Promise.resolve();
  return Promise.allSettled(pending).then(() => undefined, () => undefined);
}

/**
 * 重置启动预热的「只跑一次」标记（仅测试使用）。
 * @returns {void}
 */
function __resetThinkingWarmForTest() {
  thinkingWarmPromise = null;
}

/**
 * ai:models 的 ACP 配置预探测分支（hint.probeModel）。
 *
 * 只读取单个模型的 configOptions（尤其思考强度），不跑目录探测、
 * 不返回完整模型列表、不启动 turn；因此不会触发 15s 模型目录预算。
 * 复用既有 ai:models 通道，不新增 IPC。
 *
 * 时序：
 * 1) 缓存命中且非 force → 立刻返回 {ok:true, cached:true, configOptions}，不拉起 ACP；
 * 2) hint.background=true → 立刻返回缓存或 {status:'probing'}，真实探测丢后台队列（同 key 单飞）；
 * 3) 其余情况保持等待探测，完成后回写缓存。
 *
 * @param {Object} hint ai:models hint（probeModel/agentId/uiSessionId/cwd/background/force）
 * @param {string} model 目标模型 id
 * @param {Object} cfg 完整 AI 配置
 * @returns {Promise<Object>} {ok,probe,model,configOptions,modelConfigId} / {ok:false,error,detail,availableModels}
 */
async function probeAcpModelConfig(hint, model, cfg) {
  const h = (hint && typeof hint === 'object') ? hint : {};
  const hintAgent = String(h.agentId || h.agent || '').trim();
  const agentId = hintAgent || String((cfg && (cfg.agentId || cfg.mainAgent)) || 'opencode');
  const target = String(model || '').trim();
  const force = h.force === true;
  /* __run：后台队列真正执行时置 true，避免再次排队（防自递归） */
  const background = h.background === true && h.__run !== true;
  const base = {
    ok: false,
    probe: true,
    engine: 'cli',
    transport: 'acp',
    agentId,
    model: target
  };
  if (!target) {
    return Object.assign({}, base, {
      error: 'ACP_MODEL_EMPTY',
      detail: '未指定模型，无法读取思考档位',
      availableModels: []
    });
  }
  const cache = resolveThinkingCache();
  const cacheKey = aiThinkingCache.buildCacheKey(agentId, target);

  /* 1) 缓存优先：命中即秒回，不解析启动命令、不拉起子进程。 */
  if (!force) {
    const hit = readThinkingCacheHit(cache, cacheKey);
    if (hit && hit.status === 'unsupported') {
      /* 与真实探测的「模型不支持」保持同一出入参：ok:false + ACP_MODEL_UNSUPPORTED */
      return Object.assign({}, base, {
        cached: true,
        error: 'ACP_MODEL_UNSUPPORTED',
        availableModels: []
      });
    }
    if (hit) {
      return Object.assign({}, base, {
        ok: true,
        cached: true,
        status: hit.status,
        agentId: hit.agentId || agentId,
        model: hit.model || target,
        configOptions: Array.isArray(hit.configOptions) ? hit.configOptions : [],
        modelConfigId: String(hit.modelConfigId || '')
      });
    }
  }

  /* 2) 后台模式：立刻给占位，探测丢队列（同 key 单飞，完成后回写缓存）。 */
  if (background) {
    startBackgroundThinkingProbe(cacheKey, () => probeAcpModelConfig(
      Object.assign({}, h, { background: false, __run: true, force: true }),
      target,
      cfg
    ));
    return Object.assign({}, base, {
      ok: true,
      probe: true,
      status: 'probing',
      scheduled: true,
      configOptions: []
    });
  }

  /* 3) 前台等待探测（缓存未命中）：保持既有语义，失败原因原样返回。 */
  const def = getAgentDef(agentId);
  if (!def) {
    const miss = Object.assign({}, base, {
      error: 'ACP_AGENT_NOT_FOUND',
      detail: '未找到 Agent 适配器：' + agentId,
      availableModels: []
    });
    writeThinkingCacheOutcome(cache, { agentId, model: target }, miss);
    return miss;
  }
  if (!isAcpEnabled(cfg, def)) {
    const off = Object.assign({}, base, {
      error: 'ACP_DISABLED',
      detail: '当前 Agent 未启用 ACP：' + agentId,
      availableModels: []
    });
    writeThinkingCacheOutcome(cache, { agentId, model: target }, off);
    return off;
  }
  const previewArgs = {
    def,
    aiCfg: cfg,
    cwd: resolveAcpModelsCwd(h),
    uiSessionId: String(h.uiSessionId || h.sessionId || ''),
    model: target
  };
  try {
    const preview = acpModelsTestHooks.previewModelConfig;
    const result = preview ? await preview(previewArgs) : await acpRuntime.previewModelConfig(previewArgs);
    const r = (result && typeof result === 'object') ? result : {};
    if (r.ok) {
      const okOut = Object.assign({}, base, {
        ok: true,
        agentId: def.id,
        model: String(r.model || target),
        configOptions: Array.isArray(r.configOptions) ? r.configOptions : [],
        modelConfigId: String(r.modelConfigId || '')
      });
      writeThinkingCacheOutcome(cache, { agentId: def.id, model: target }, okOut);
      return okOut;
    }
    const available = Array.isArray(r.availableModels) ? r.availableModels.slice() : [];
    const failOut = Object.assign({}, base, {
      agentId: def.id,
      error: String(r.error || 'ACP_PROBE_FAILED'),
      detail: String(r.detail || ''),
      availableModels: available
    });
    writeThinkingCacheOutcome(cache, { agentId: def.id, model: target }, failOut);
    return failOut;
  } catch (e) {
    const errOut = Object.assign({}, base, {
      agentId: def.id,
      error: String((e && e.code) || 'ACP_PROBE_FAILED'),
      detail: String((e && e.message) || e || '').slice(0, 800),
      availableModels: []
    });
    writeThinkingCacheOutcome(cache, { agentId: def.id, model: target }, errOut);
    return errOut;
  }
}

async function aiModelsImpl(ev, hint) {
  const cfg = aiConfigStore.loadAiConfigFull();
  /* 设置面板按当前UI引擎预览：显式hint优先，仅无hint时回退落盘判定（兼容旧前端与对话下拉） */
  const h = (hint && typeof hint === 'object') ? hint : (typeof hint === 'string' ? { engine: hint } : {});
  /* 模型级联预探测：选中模型即经 ACP 读取该模型的 configOptions。
   * 必须早于 isApi / inspectAgentModels / 缓存读取，避免把 15s 模型目录探测带进来。 */
  const probeModel = String((h && h.probeModel) || '').trim();
  if (probeModel) return probeAcpModelConfig(h, probeModel, cfg);
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
      const list = (await fetchProviderModels({ protocol, apiKey, baseUrl, timeoutMs: 10000 })) || [];
      const defaultApiReasoning = [
        { id: 'default', label: '默认推荐 (Default)', default: true },
        { id: 'high', label: '高强度 (High)' },
        { id: 'medium', label: '中强度 (Medium)' },
        { id: 'low', label: '低强度 (Low)' }
      ];
      const listWithReasoning = list.map((m) => {
        if (!m || typeof m !== 'object') return { id: String(m || ''), name: String(m || ''), reasoningOptions: defaultApiReasoning };
        return {
          ...m,
          reasoningOptions: (Array.isArray(m.reasoningOptions) && m.reasoningOptions.length) ? m.reasoningOptions : defaultApiReasoning
        };
      });
      const dispProv = String(src.provider || protocol);
      const labelMap = {
        deepseek: 'DeepSeek 官方', ali: '阿里百炼 DashScope',
        siliconflow: '硅基流动 SiliconFlow', openrouter: 'OpenRouter',
        custom: '自定义 API', openai: 'OpenAI', anthropic: 'Anthropic',
        google: 'Google', ollama: 'Ollama', azure: 'Azure'
      };
      const label = labelMap[dispProv] || dispProv;
      const defModel = String(src.model || cfg.model || ((Array.isArray(list) && list[0] && list[0].id) || 'default'));
      const apiGroups = [{ provider: dispProv, label, models: listWithReasoning }];
      return { ok: true, groups: apiGroups, allGroups: apiGroups, default: defModel, engine: 'api', visibleModels: visible || [] };
    } catch (e) {
      const fbReasoning = [
        { id: 'default', label: '默认推荐', default: true },
        { id: 'high', label: '高强度 (High)' },
        { id: 'medium', label: '中强度 (Medium)' },
        { id: 'low', label: '低强度 (Low)' }
      ];
      const fb = [
        { id: 'deepseek-chat', label: 'deepseek-chat', reasoningOptions: fbReasoning },
        { id: 'deepseek-reasoner', label: 'deepseek-reasoner', reasoningOptions: fbReasoning }
      ];
      const fbGroups = [{ provider: 'custom', label: '自定义 API', models: fb }];
      return { ok: true, groups: fbGroups, allGroups: fbGroups, default: 'deepseek-chat', engine: 'api', visibleModels: visible || [] };
    }
  }
  const agentId = cfg.agentId || cfg.mainAgent || 'opencode';
  const def = getAgentDef(agentId) || getAgentDef('opencode');
  if (!def) return { ok: false, error: '未找到 Agent 适配器', engine: 'cli', visibleModels: visible || [] };
  /* Phase 1 ACP：解析选中 Agent 的启动命令，真实探测模型目录（不再只回 legacy fallbackModels）。 */
  if (isAcpEnabled(cfg, def)) {
    /* 白名单：visibleModelsCli[id] 优先；缺省回退旧全局 visibleModels；显式空数组表示不过滤。 */
    let whitelist = pickCliList(cfg.visibleModelsCli, def.id);
    if (whitelist === null) {
      whitelist = (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length) ? cfg.visibleModels : null;
    }
    const launch = typeof acpModelsTestHooks.resolveLaunchCommand === 'function'
      ? await acpModelsTestHooks.resolveLaunchCommand(def, cfg)
      : await resolveAcpLaunchCommand(def, cfg);
    if (!launch || !Array.isArray(launch.command) || !launch.command.length) {
      return {
        ok: false,
        error: 'ACP_BACKEND_MISSING',
        detail: formatAcpBackendMissingDetail(def, launch && launch.unresolved),
        engine: 'cli',
        transport: 'acp',
        agentId: def.id,
        visibleModels: whitelist || []
      };
    }
    const agentCommand = launch.command.map((v) => String(v));
    const commandText = agentCommand.join(' ');
    /* 缓存 key 带 Agent 与完整启动命令：换 Agent / 换自定义路径后天然不串缓存；save-config 会 clear。 */
    const cacheKey = 'acp:' + def.id + ':' + agentCommand.join(' ');
    const catalogKey = buildCacheKey(def.id, commandText);
    const catalogCache = acpModelsTestHooks.cache || acpModelCatalog;
    const requestId = String((h && h.requestId) || '').trim() || nextAcpCatalogRequestId();
    const hintCliVersion = String((h && (h.cliVersion || h.agentVersion || h.version)) || '').trim();
    const now = Date.now();
    const refreshCwd = resolveAcpModelsCwd(h);
    /* 首屏只读缓存：内存 -> 磁盘。过期条目也立即返回（stale-while-revalidate），刷新放后台。 */
    let catalog = null;
    let stale = false;
    /* ACP 刷新与首屏缓存 / CLI 并行启动，仅后台跑（首屏不 await）；同一 key 进程内去重。 */
    const acpRefreshPromise = startAcpCatalogRefresh();
    try {
      const hit = shared.cliModelsCache.get(cacheKey);
      if (hit && Array.isArray(hit.models) && hit.models.length) {
        catalog = {
          models: hit.models,
          defaultModel: String(hit.defaultModel || ''),
          source: String(hit.source || 'first-advertised'),
          ts: Number(hit.ts) || 0
        };
        stale = !((now - catalog.ts) < shared.CLI_MODELS_CACHE_TTL);
      }
    } catch (e) {}
    if (!catalog) {
      try {
        const cached = catalogCache.get(catalogKey);
        if (cached && Array.isArray(cached.models) && cached.models.length) {
          catalog = {
            models: cached.models,
            defaultModel: String(cached.defaultModel || ''),
            source: String(cached.source || 'first-advertised'),
            ts: Number(cached.ts) || 0
          };
          stale = !catalogCache.isFresh(catalog.ts, shared.CLI_MODELS_CACHE_TTL);
          /* CLI 版本变化：旧目录立即视为 stale，后台刷新会覆盖；不阻塞首屏。 */
          const cachedVersion = String(cached.cliVersion || '').trim();
          if (hintCliVersion && cachedVersion && cachedVersion !== hintCliVersion) stale = true;
        }
      } catch (e) {}
    }
    if (catalog) {
      /* 回填进程内缓存：后续打开弹窗不再读盘；TTL 与磁盘一致（10 分钟）。 */
      try {
        shared.cliModelsCache.set(cacheKey, {
          ts: catalog.ts,
          models: catalog.models,
          defaultModel: catalog.defaultModel,
          source: catalog.source
        });
      } catch (e) {}
    }
    let advertised = (catalog && Array.isArray(catalog.models)) ? catalog.models.slice() : [];
    let catalogSource = catalog ? String(catalog.source || 'none') : 'none';
    let catalogDefault = catalog ? String(catalog.defaultModel || '') : '';
    let firstScreenSource = 'cache';
    let catalogWarning = null;
    if (catalog) {
      catalogWarning = stale ? 'catalog-stale' : null;
    } else {
      /* 无缓存：CLI 原生 models（def.listModels，5-10s 预算）优先；ACP 握手只放后台，不阻塞首屏。 */
      let cliItems = [];
      try {
        if (def.listModels && Array.isArray(def.listModels.args) && agentCommand[0]) {
          const listFn = typeof acpModelsTestHooks.execCliListModels === 'function'
            ? acpModelsTestHooks.execCliListModels
            : execCliListModels;
          const raw = await listFn(agentCommand[0], def);
          if (Array.isArray(raw) && raw.length) cliItems = normalizeCliModelIds(raw);
        }
      } catch (e) { cliItems = []; }
      if (cliItems.length) {
        advertised = cliItems.map((m) => ({
          id: String(m.id),
          name: String(m.label || m.id),
          description: ''
        }));
        catalogSource = 'cli';
        catalogDefault = advertised.length ? advertised[0].id : '';
        firstScreenSource = 'cli';
      } else {
        /* CLI 不可用：仅使用 acp-config 的 ACP id 兜底，绝不回退 legacy def.fallbackModels。 */
        advertised = (ACP_MODEL_FALLBACKS[def.id] || []).map((id) => ({
          id: String(id),
          name: String(id),
          description: ''
        }));
        catalogSource = 'fallback';
        catalogDefault = advertised.length ? advertised[0].id : '';
        firstScreenSource = 'fallback';
        catalogWarning = 'catalog-fallback';
      }
    }
    /**
     * 后台 ACP 刷新：同一 key 进程内去重；成功写磁盘/内存缓存，失败保留旧目录。
     * @returns {Promise<Object>} 归一化缓存记录
     */
    function startAcpCatalogRefresh() {
      let existing = null;
      try { existing = acpCatalogRefreshMap.get(catalogKey) || null; } catch (e) { existing = null; }
      if (existing) return existing;
      const inspectAgentModels = typeof acpModelsTestHooks.inspectAgentModels === 'function'
        ? acpModelsTestHooks.inspectAgentModels
        : async (args) => {
          const acpx = await loadAcpxModelsModule();
          return acpx.inspectAgentModels(args);
        };
      rememberAcpProbeCommand(agentCommand);
      const promise = (async () => {
        const abortController = new AbortController();
        try {
          acpCatalogAbortControllers.add(abortController);
          /* 首屏预算 15s 之外，后台刷新给到 30s（ACP_MODELS_TIMEOUT_MS + 15s），超时由 acpx 处理。
           * signal 供应用退出 / 统一收尾时中止探测，让 acpx 的 finally 关闭 agent 子进程。 */
          const inspection = await inspectAgentModels({
            agentCommand,
            cwd: refreshCwd,
            timeoutMs: ACP_MODELS_TIMEOUT_MS + 15000,
            signal: abortController.signal
          });
          const fresh = normalizeModelCatalog(inspection);
          if (!fresh || !Array.isArray(fresh.models) || !fresh.models.length) {
            const emptyErr = new Error('ACP 模型目录为空');
            emptyErr.code = 'ACP_MODEL_CATALOG_EMPTY';
            throw emptyErr;
          }
          const ts = Date.now();
          const entry = {
            agentId: def.id,
            command: commandText,
            models: fresh.models,
            defaultModel: String(fresh.defaultModel || ''),
            source: String(fresh.source || 'first-advertised'),
            ts,
            cliVersion: String((h && (h.cliVersion || h.agentVersion || h.version)) || '').trim() || undefined
          };
          try { catalogCache.set(catalogKey, entry); } catch (e) {}
          try {
            shared.cliModelsCache.set(cacheKey, {
              ts,
              models: fresh.models,
              defaultModel: entry.defaultModel,
              source: entry.source
            });
          } catch (e) {}
          return entry;
        } finally {
          try { acpCatalogAbortControllers.delete(abortController); } catch (e) {}
        }
      })();
      try { acpCatalogRefreshMap.set(catalogKey, promise); } catch (e) {}
      const clear = () => {
        try {
          if (acpCatalogRefreshMap.get(catalogKey) === promise) acpCatalogRefreshMap.delete(catalogKey);
        } catch (e) {}
      };
      promise.then(clear, clear);
      return promise;
    }
    /* 刷新事件只回发起本次 ai:models 的窗口；窗口销毁则静默丢弃。 */
    function emitAcpCatalog(payload) {
      try {
        const sender = ev && ev.sender;
        if (sender && typeof sender.send === 'function'
          && !(typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
          sender.send('ai:event', payload);
        }
      } catch (e) {}
    }
    /* 刷新结果回调：成功回推完整目录，失败保留旧缓存并回 warning/error。 */
    try {
      acpRefreshPromise.then((entry) => {
        const visibleFresh = mergeVisibleModels(entry.models, whitelist);
        const eventModels = visibleFresh.models.map((m) => ({
          id: String(m.id),
          name: String(m.name || m.label || m.id),
          description: String(m.description || '')
        }));
        let eventDefault = String(entry.defaultModel || '');
        if (!eventModels.some((m) => m.id === eventDefault)) {
          eventDefault = eventModels.length ? eventModels[0].id : '';
        }
        emitAcpCatalog({
          type: 'acp_catalog',
          agentId: def.id,
          command: commandText,
          models: eventModels,
          defaultModel: eventDefault,
          source: 'acp',
          stale: false,
          requestId,
          ts: entry.ts
        });
      }).catch((err) => {
        emitAcpCatalog({
          type: 'acp_catalog',
          agentId: def.id,
          command: commandText,
          error: String((err && err.code) || 'ACP_MODEL_REFRESH_FAILED'),
          warning: 'ACP 模型目录刷新失败，已保留' + (catalog ? '旧缓存' : '兜底列表') + '：'
            + String((err && err.message) || err || '').slice(0, 200),
          stale: true,
          requestId,
          ts: Date.now()
        });
      });
    } catch (e) {
      emitAcpCatalog({
        type: 'acp_catalog',
        agentId: def.id,
        command: commandText,
        error: 'ACP_MODEL_REFRESH_FAILED',
        warning: 'ACP 模型目录刷新启动失败：' + String((e && e.message) || e).slice(0, 200),
        stale: true,
        requestId,
        ts: Date.now()
      });
    }
    const visibleResult = mergeVisibleModels(advertised, whitelist);
    const reasoningForModel = (Array.isArray(def.reasoningOptions) && def.reasoningOptions.length)
      ? def.reasoningOptions
      : null;
    const toModelEntry = (model) => {
      const id = String((model && model.id) || '').trim();
      if (!id) return null;
      return {
        id,
        name: String((model && (model.name || model.label)) || id),
        reasoningOptions: reasoningForModel
      };
    };
    const finalModels = [];
    for (const model of visibleResult.models) {
      const entry = toModelEntry(model);
      if (entry) finalModels.push(entry);
    }
    /* 管理页数据源：ACP 全量公告目录，不受 visibleModelsCli 白名单裁剪。
     * groups 仍保持白名单交集语义（对话下拉），allGroups 只供模型管理/获取模型弹窗展示。 */
    const allModels = [];
    const allModelIds = new Set();
    for (const model of advertised) {
      const entry = toModelEntry(model);
      if (!entry || allModelIds.has(entry.id)) continue;
      allModelIds.add(entry.id);
      allModels.push(entry);
    }
    /* 列表阶段只认 UI hint 显式传入的模型；cfg.model 是 API/legacy 全局值，绝不作为 ACP 默认。 */
    const requestedModel = String((h && (h.model || h.requestedModel)) || '').trim();
    const agentCfg = (cfg.acp && cfg.acp.agents && cfg.acp.agents[def.id]) || {};
    const choice = resolveModelChoice({
      requestedModel,
      modelSource: requestedModel ? 'ui' : '',
      agentConfigModel: String(agentCfg.model || ''),
      currentModelId: catalogSource === 'agent-current' ? catalogDefault : '',
      advertised: finalModels,
      globalModel: String(cfg.model || cfg.defaultModel || '')
    });
    let defaultModel = choice.model || (finalModels[0] && finalModels[0].id) || '';
    let defaultSource = choice.source || 'none';
    let warning = visibleResult.warning || choice.warning || null;
    if (choice.error) {
      /* 显式选择不受支持：列表照常返回，ask 阶段按 ACP_MODEL_UNSUPPORTED 拒绝，避免静默改模型。 */
      defaultSource = 'none';
      warning = choice.error;
    }
    /* 默认模型必须来自本次真实目录（cache / CLI / fallback / ACP）：deepseek-chat 等 legacy 全局值永不外泄。 */
    if (!defaultModel || !finalModels.some((m) => m.id === defaultModel)) {
      defaultModel = (finalModels[0] && finalModels[0].id) || '';
      defaultSource = defaultModel ? 'first-advertised' : 'none';
    }
    return {
      ok: true,
      groups: [{ provider: def.id, label: def.name || def.id, models: finalModels }],
      allGroups: [{ provider: def.id, label: def.name || def.id, models: allModels }],
      default: defaultModel,
      engine: 'cli',
      transport: 'acp',
      visibleModels: whitelist || [],
      agentId: def.id,
      reasoningOptions: def.reasoningOptions || null,
      configOptions: null,
      defaultSource,
      refreshing: true,
      stale: !!stale,
      source: firstScreenSource,
      catalogWarning: catalogWarning || null,
      requestId,
      warning
    };
  }
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
    const id = id0; /* free 独立模型：按全 id 去重，不再合并 */
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    const reasoning = (m && Array.isArray(m.reasoningOptions) && m.reasoningOptions.length)
      ? m.reasoningOptions
      : (Array.isArray(def.reasoningOptions) && def.reasoningOptions.length ? def.reasoningOptions : null);
    merged.push({ id, label: String((m && m.label) || id), reasoningOptions: reasoning });
  };
  fms.forEach(pushM);
  (Array.isArray(dynItems) ? dynItems : []).forEach(pushM);
  (Array.isArray(cliCustoms) ? cliCustoms : []).forEach((id) => pushM({ id, label: id }));
  const useList = merged.length ? merged : fms.map((m) => ({
    id: String(m.id || '').trim(),
    label: m.label || m.id,
    reasoningOptions: (m && Array.isArray(m.reasoningOptions) && m.reasoningOptions.length) ? m.reasoningOptions : (def.reasoningOptions || null)
  })).filter((m) => m.id);
  const byProv = {};
  useList.forEach((m) => {
    const id = String((m && m.id) || '').trim();
    if (!id) return;
    const label = String((m && m.label) || id);
    const i = id.indexOf('/');
    const provider = i > 0 ? id.slice(0, i) : def.id;
    const name = i > 0 ? id.slice(i + 1) : label;
    const reasoningOptions = (m && Array.isArray(m.reasoningOptions) && m.reasoningOptions.length)
      ? m.reasoningOptions
      : (Array.isArray(def.reasoningOptions) && def.reasoningOptions.length ? def.reasoningOptions : null);
    (byProv[provider] = byProv[provider] || []).push({ id, name, reasoningOptions });
  });
  const groups = Object.keys(byProv).map((k) => ({ provider: k, label: k, models: byProv[k] }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  let defId = 'default';
  try {
    const d0 = fms.find((m) => m && m.default) || fms[0];
    if (d0 && d0.id) defId = d0.id;
  } catch (e) {}
  return {
    ok: true, groups, allGroups: groups, default: process.env.PROTO_AI_MODEL || cfg.model || defId,
    engine: 'cli', visibleModels: visible || [], agentId: def.id,
    reasoningOptions: def.reasoningOptions || null
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
  if (scopeConfirmPending) {
    return { ok: false, success: false, error: 'busy' };
  }
  const aiCfg = aiConfigStore.loadAiConfigFull();
  const webContents = ev.sender;
  function emitAiEvent(payload) {
    try {
      if (webContents && !webContents.isDestroyed()) webContents.send('ai:event', payload);
    } catch (e) {}
  }
  const isApiMode = aiCfg.mode === 'api' || aiCfg.providerType === 'api' || aiCfg.engine === 'api';
  let def = null;
  let resolvedBin = null;
  let useAcp = false;
  const rawModel = String(model || '').trim();
  let normModel = (!rawModel || rawModel === '__none__' || rawModel === 'default') ? '' : rawModel;
  /* free 独立模型：原样透传，由服务商做免费路由；若未选模型则空置，使用 CLI 原生配置 */
  let targetModel = normModel || String(aiCfg.model || '').trim() || '';
  if (targetModel === '__none__' || targetModel === 'default') targetModel = '';
  // 严格区分：positional 参数 sessionId 代表 Agent 远端/CLI 会话标识（如 OpenCode 的 ses_...）
  // extraOpts.uiSessionId 代表前端 Tab 标识（s_...），严禁侵入底层执行选项 options.sessionId
  let agentSessionToken = (typeof sessionId === 'string' && sessionId.trim()) ? sessionId.trim() : null;
  if (!agentSessionToken && typeof extraOpts.agentSessionId === 'string' && extraOpts.agentSessionId.trim()) {
    agentSessionToken = extraOpts.agentSessionId.trim();
  }
  let executionOptions = { ...extraOpts };
  delete executionOptions.sessionId; // 坚决剔除前端 Tab ID，杜绝同名覆盖
  delete executionOptions.acpConfig; // acpConfig 只经 requestedConfig 下发，不得进入 legacy 执行选项
  if (agentSessionToken && !agentSessionToken.startsWith('s_')) {
    executionOptions.sessionId = agentSessionToken;
  }
  try { sandboxStorage.takeSnapshot(sandboxDir); } catch (e) {}
  const cwd = aiWorkDir(sandboxDir);
  /* 切 tab 归档（只读 extraOpts.uiSessionId，不碰 executionOptions.sessionId）：tab 变且旧 history 有内容则归档，新任务从空文件开始；全 try 包裹失败不阻断 */
  try { maybeArchiveHistoryOnTabSwitch(cwd, extraOpts && extraOpts.uiSessionId); } catch (e) {}
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
    if (extraOpts && extraOpts.reasoning) {
      executionOptions.reasoning = String(extraOpts.reasoning).trim();
    }
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
    /* Phase 1：ACP 开启时由 acpx 解析 Agent / 适配器，不再要求原生 bin 存在（Claude/Codex 走 adapter）。 */
    useAcp = isAcpEnabled(aiCfg, def);
    if (!useAcp) {
      resolvedBin = await resolveAgentExecutable(def, customPath);
      if (!resolvedBin) {
        emitAiEvent({
          type: 'error', code: 'CLI_NOT_FOUND', title: ('未检测到 ' + def.name),
          message: ('未找到 ' + def.name + ' 可执行文件，请在终端执行安装或在设置中心指定路径。')
        });
        return { ok: false, success: false, error: '未检测到 ' + def.name };
      }
      executionOptions.model = (targetModel && targetModel !== '__none__') ? targetModel : '';
      if (extraOpts && extraOpts.reasoning && targetModel) {
        executionOptions.reasoning = String(extraOpts.reasoning).trim();
      }
    }
  }
  /* permissionMode 从配置读取：aiConfig.cliPermissionModes[defId]，没有就当没配（零行为变化）；
   * 仅当调用方未显式传入时才补（不覆盖 extraOpts 明示值）。 */
  try {
    const cfgPm = resolveCliPermissionMode(aiCfg, def && def.id);
    if (cfgPm && !String(executionOptions.permissionMode || '').trim()) {
      executionOptions.permissionMode = cfgPm;
    }
  } catch (e) {}

  /* 上下文内收：规范/toolPrompt 只下发沙箱内指针（.context/ 快照由 stageContextDir 落盘），
     正文由模型按需读取；历史只下发指针 + 规模行。取不到则原样下发（不断链） */
  let finalPrompt = String(prompt || '');
  const userPromptText = finalPrompt;
  try {
    const uiKind = resolveUiSpecKind(extraOpts);
    const uiSpec = sandboxStorage.readUiSpecForKind(uiKind);
    const staged = stageContextDir(cwd, uiSpec);
    const heads = [];
    if (uiSpec && uiSpec.content && staged.specVersion) heads.push(buildUiSpecSection(uiKind, uiSpec));
    if (staged.toolPromptBytes > 0) heads.push(buildToolPromptPointer());
    try {
      let stagedSkills = null;
      try { stagedSkills = sandboxStorage.stageSkillsToContext(cwd); } catch (e) { stagedSkills = null; }
      if (Array.isArray(stagedSkills) && stagedSkills.length) {
        const skillSec = buildSkillMapSection(stagedSkills);
        if (skillSec) heads.push(skillSec);
      }
    } catch (e) {}
    try {
      const tfSec = buildTargetFileSection(cwd, extraOpts);
      if (tfSec) heads.push(tfSec);
    } catch (e) {}
    const histPtr = buildHistoryPointer(cwd);
    if (histPtr) heads.push(histPtr);
    if (heads.length) finalPrompt = heads.join('\n\n') + '\n\n' + finalPrompt;
  } catch (e) {}

  /* S5 事前范围确认：扫描 finalPrompt 找沙箱外绝对路径/.. 跳出片段；没有直接放行零打扰；
   * 有则问渲染层一次（允许本次/总是允许这类/拒绝）；120 秒无应答按仅沙箱内放行 + trace 注明，不卡死。 */
  try {
    let scopeHits = [];
    try { scopeHits = findScopeRefs(finalPrompt, cwd); } catch (e) { scopeHits = []; }
    if (Array.isArray(scopeHits) && scopeHits.length && !isScopeAlwaysAllowed(cwd)) {
      let decision = 'timeout';
      try {
        scopeConfirmPending = true;
        decision = await awaitScopeConfirm((p) => emitAiEvent(p), cwd, scopeHits, SCOPE_CONFIRM_TIMEOUT_MS);
      } catch (e) { decision = 'timeout'; }
      try { scopeConfirmPending = false; } catch (e) {}
      if (decision === 'deny') {
        try {
          emitAiEvent({ type: 'trace', trace: { tag: 'SCOPE', level: 'warn', text: '范围确认被拒绝（发现' + scopeHits.length + '处沙箱外引用），本轮已中止下发' } });
        } catch (e2) {}
        return { ok: false, success: false, error: 'scope-denied', denied: true };
      }
      if (decision === 'allow-always') { try { setScopeAlwaysAllowed(cwd); } catch (e2) {} }
      if (decision === 'timeout') {
        try {
          emitAiEvent({ type: 'trace', trace: { tag: 'SCOPE', level: 'warn', text: '范围确认120秒无应答，仅沙箱内操作被允许（发现' + scopeHits.length + '处沙箱外引用）' } });
        } catch (e2) {}
      }
    }
  } catch (e) { try { scopeConfirmPending = false; } catch (e2) {} }

  const beforeSignature = sandboxStorage.getProtoFileSignature(cwd);
  /* 功能说明 5.1/6.2：任务开始前除签名外再快照可diff文本内容（白名单+200KB上限+二进制跳过，失败回落无行数） */
  let beforeContents = null;
  try {
    if (sandboxStorage.snapshotProtoFileContents) beforeContents = sandboxStorage.snapshotProtoFileContents(cwd);
  } catch (e) { beforeContents = null; }
  /* 沙箱根越界守卫（任务前快照）：复用 getProtoFileSignature 逐原型目录拼 beforeMap；
   * 性能有界：先数文件量，超 5000 则跳过快照并 trace 注明（不断链）。 */
  let sandboxGuardBefore = null;
  let sandboxGuardSkipped = false;
  try {
    let rootDir = null;
    try { rootDir = paths.SANDBOX_ROOT; } catch (e) { rootDir = null; }
    if (rootDir) {
      let cnt = null;
      try { cnt = countFilesUnderRoot(rootDir, SANDBOX_GUARD_TOTAL_MAX_FILES); } catch (e) { cnt = null; }
      if (cnt && cnt.over) {
        sandboxGuardSkipped = true;
        try {
          emitAiEvent({ type: 'trace', trace: { tag: 'SANDBOX', level: 'warn', text: '沙箱根文件量超 ' + SANDBOX_GUARD_TOTAL_MAX_FILES + '（现约' + cnt.count + '），跳过沙箱越界快照对比' } });
        } catch (e2) {}
      } else {
        try { sandboxGuardBefore = buildSandboxRootBeforeMap(rootDir); } catch (e2) { sandboxGuardBefore = null; }
      }
    }
  } catch (e) {}

  /* ═══════ Phase 1 ACP 分流（默认关闭：!isApiMode && acp.enabled===true && def.transport==='acp'） ═══════
   * 复用上面的 prompt 前缀、S5 scope confirm、before signature / 内容快照与沙箱根快照；
   * 事件由 acp-runtime 按现有 ai:event 契约发出，这里只提供文件变更与收尾回调。 */
  if (useAcp) {
    function collectAcpFileChanges() {
      let fileChanges = [];
      try {
        const afterSignature = sandboxStorage.getProtoFileSignature(cwd);
        try {
          let afterContents = null;
          try {
            if (sandboxStorage.snapshotProtoFileContents) afterContents = sandboxStorage.snapshotProtoFileContents(cwd);
          } catch (e) { afterContents = null; }
          if (beforeContents instanceof Map && afterContents instanceof Map) {
            fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature, beforeContents, afterContents);
          } else {
            fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature);
          }
        } catch (err2) {
          try { fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature); }
          catch (e) { fileChanges = []; }
        }
      } catch (err) {
        fileChanges = [];
      }
      try {
        if (!Array.isArray(fileChanges)) return [];
        const clean = [];
        for (let i = 0; i < fileChanges.length; i++) {
          try {
            const fc = fileChanges[i] || {};
            const p = String(fc.path || fc.file || fc.name || '');
            if (!p) continue;
            const item = { path: p, action: String(fc.action || 'modified') };
            const a = Number(fc.added);
            const d = Number(fc.deleted);
            if (fc.added != null && isFinite(a)) item.added = Math.max(0, Math.floor(a));
            if (fc.deleted != null && isFinite(d)) item.deleted = Math.max(0, Math.floor(d));
            clean.push(item);
          } catch (e) {}
        }
        clean.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        return clean;
      } catch (e) { return []; }
    }

    function finalizeAcpTurn(info) {
      const cancelled = !!(info && info.cancelled);
      const fileChanges = (info && Array.isArray(info.fileChanges)) ? info.fileChanges : [];
      /* 沙箱根越界守卫（任务后对比）：同 legacy onClose，只 trace-warn，不打断流程。 */
      try {
        if (!sandboxGuardSkipped && sandboxGuardBefore instanceof Map) {
          let outs = [];
          try {
            let rootDir2 = null;
            try { rootDir2 = paths.SANDBOX_ROOT; } catch (e2) { rootDir2 = null; }
            if (rootDir2 && sandboxStorage.diffSandboxRootAgainst) {
              outs = sandboxStorage.diffSandboxRootAgainst(rootDir2, cwd, sandboxGuardBefore) || [];
            }
          } catch (e2) { outs = []; }
          if (Array.isArray(outs) && outs.length) {
            try {
              const list = [];
              for (let i = 0; i < outs.length && list.length < 20; i++) {
                const pp = String((outs[i] && outs[i].path) || '').trim();
                if (pp) list.push(pp);
              }
              emitAiEvent({ type: 'trace', trace: { tag: 'SANDBOX', level: 'warn', text: '检测到允许目录之外的变更（' + outs.length + ' 处）：' + list.join('、') } });
            } catch (e2) {}
          }
        }
      } catch (e) {}
      /* 历史落盘：与 legacy onClose 同口径（取消不写）。 */
      try {
        if (!cancelled) {
          let hr = null;
          try { hr = appendHistoryRound(cwd, { user: userPromptText, answer: String((info && info.answer) || ''), fileChanges }); } catch (e) { hr = null; }
          try {
            if (hr && hr.alarm) {
              let hk = '';
              try { hk = historyFilePath(cwd) || String(cwd || ''); } catch (_) { hk = String(cwd || ''); }
              if (hk && !historyAlarmWarned.has(hk)) {
                try { historyAlarmWarned.add(hk); } catch (_) {}
                try {
                  let kb = 0;
                  try { kb = Math.max(1, Math.round((readHistoryScale(cwd).bytes || 0) / 1024)); } catch (_) {}
                  emitAiEvent({ type: 'trace', trace: { tag: 'HISTORY', level: 'warn', text: '对话历史 .context/history.md 已超 100KB 观测线（现约' + kb + 'KB，只增不减不截断，本轮仍已落盘；按需读取前情即可，溢出控制交给各 CLI）' } });
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      } catch (e) {}
    }

    /* ═══ ACP 参数映射（B2） ═══
     * - requestedModel 只认 UI 显式选择 normModel；aiCfg.model 是 API/legacy 全局值，
     *   绝不作为 ACP 模型，只作为 acp-config 的 globalModel 用于识别/忽略泄漏。
     * - resumeSessionId 只认 ACP 专用字段，不再回落到 legacy CLI 会话标识。 */
    const agentAcpCfg = resolveAgentAcpConfig(aiCfg, def.id);
    return acpRuntime.ask({
      def,
      cwd,
      uiSessionId: (extraOpts && extraOpts.uiSessionId) || '',
      prompt: finalPrompt,
      requestedModel: normModel,
      modelSource: normModel ? 'ui' : (agentAcpCfg.model ? 'agent-config' : ''),
      agentConfigModel: String(agentAcpCfg.model || '').trim(),
      requestedThought: String((extraOpts && extraOpts.reasoning) || agentAcpCfg.thoughtLevel || '').trim(),
      requestedConfig: (extraOpts && extraOpts.acpConfig && typeof extraOpts.acpConfig === 'object')
        ? extraOpts.acpConfig
        : {},
      globalModel: String(aiCfg.model || aiCfg.defaultModel || '').trim(),
      freshSession: !!((extraOpts && (extraOpts.freshSession === true || extraOpts.resetSession === true))),
      extra: executionOptions,
      aiCfg,
      resumeSessionId: String(
        (extraOpts && (extraOpts.acpSessionId || extraOpts.resumeSessionId))
        || ''
      ),
      handlers: {
        emit: emitAiEvent,
        getFileChanges: collectAcpFileChanges,
        onDone: finalizeAcpTurn
      }
    });
  }

  function runAgentProcess(opts, isRetry = false) {
    let answerAcc = '';
    /* 本轮用量累加器：各事件 usage（tool_call/chunk 透传的 per-step 值）在此累加，onClose 报总量 */
    const roundUsage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 };
    function addEvUsage(u) { try { addUsageCounts(roundUsage, u); } catch (e) {} }
    return startAgentExecution({
      def,
      resolvedBin,
      prompt: finalPrompt,
      cwd,
      options: opts,
      handlers: {
        onStart: (info) => {
          try {
            var _pid = (info && info.pid) || (shared.activeExecution ? shared.activeExecution.pid : null);
            emitAiEvent({ type: 'run_started', pid: _pid, agentId: def.id, agentName: (info && info.agentName) || def.name || def.id, engine: isApiMode ? 'api' : 'cli' });
          } catch (e) {}
        },
        onThinking: (text) => emitAiEvent({ type: 'thinking', text: String((text && text.text) || text || '') }),
        onChunk: (text) => {
          try {
            const t = String((text && text.text) || text || '');
            if (t) answerAcc += t;
          } catch (e) {}
          try { addEvUsage(text && text.usage); } catch (e) {}
          emitAiEvent({ type: 'chunk', text: String((text && text.text) || text || '') });
        },
        onToolCall: (data) => {
          try {
            const d = (data && typeof data === 'object') ? data : {};
            const part = (d.part && typeof d.part === 'object') ? d.part : null;
            const state = (part && part.state && typeof part.state === 'object') ? part.state : null;
            const input = (state && state.input != null) ? state.input : (d.input != null ? d.input : d.args);
            const tool = d.tool || d.name || d.toolName || d.call || (part && part.tool) || '';
            const flat = { ...d, type: 'tool_call', tool: String(tool || '') };
            try {
              const cand = (input && typeof input === 'object') ? input : null;
              const f = (cand && (cand.path || cand.file || cand.filename || cand.filePath || cand.pattern))
                || d.path || d.file || d.filename || d.filePath || '';
              if (f && !flat.path && !flat.file) flat.path = String(f);
              const cmd = (cand && (cand.command || cand.cmd)) || d.command || d.cmd || '';
              if (cmd && !flat.command && !flat.cmd) flat.command = String(cmd);
              if (cand && flat.args == null && flat.input == null) { try { flat.args = cand; } catch (e) {} }
              else if (input != null && flat.args == null && flat.input == null) { try { flat.input = input; } catch (e) {} }
            } catch (e) {}
            try { const sid = d.sessionID || d.sessionId || d.session_id || (part && part.sessionID); if (sid && !flat.sessionID) flat.sessionID = String(sid); } catch (e) {}
            try { addEvUsage(d.usage); } catch (e) {}
            emitAiEvent(flat);
          } catch (e) { try { emitAiEvent({ ...(data || {}), type: 'tool_call' }); } catch (_) {} }
        },
        onSession: (id) => {
          const sid = String((id && (id.sessionId || id.id || id.sessionID || id.session_id || id.session)) || (typeof id === 'string' ? id : '') || '');
          emitAiEvent({ type: 'session', id: sid, sessionId: sid });
        },
        /* question-form 子任务C：提问体透传（仅复用现有 ai:event 通道，不新增 IPC）。
         * onQuestion 到达只发事件：不触发 ErrorCard，不碰 answerAcc/用量/改动，不改变成功/失败判定；
         * 前端凭 {type:'question', questions} 经既有任务事件体系（aiCurTaskEvents→会话落盘）记录，供重开对话框重建。 */
        onQuestion: (data) => {
          try {
            const d = (data && typeof data === 'object') ? data : {};
            const qs = Array.isArray(d.questions) ? d.questions : [];
            emitAiEvent({ type: 'question', questions: qs, raw: (d.raw != null ? d.raw : d) });
          } catch (e) {}
        },
        /* question-form 留痕直通：解析器 onTrace({tag,level,text}) 原样转 ai:event trace（QUESTION 排查证据）。 */
        onTrace: (t) => {
          try {
            const o = (t && typeof t === 'object') ? t : {};
            emitAiEvent({ type: 'trace', trace: { tag: String(o.tag || 'TRACE'), level: String(o.level || 'info'), text: String(o.text || '') } });
          } catch (e) {}
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
            try {
              let afterContents = null;
              try {
                if (sandboxStorage.snapshotProtoFileContents) afterContents = sandboxStorage.snapshotProtoFileContents(cwd);
              } catch (e) { afterContents = null; }
              if (beforeContents instanceof Map && afterContents instanceof Map) {
                fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature, beforeContents, afterContents);
              } else {
                fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature);
              }
            } catch (err2) {
              try { fileChanges = sandboxStorage.diffFileSignatures(beforeSignature, afterSignature); }
              catch (e) { fileChanges = []; }
            }
          } catch (err) {
            fileChanges = [];
          }
          /* AI执行流展示2.4：清洗+按path排序后发出，保证多编辑行回放确定性；
             added/deleted缺失或非数字时只保留path+action（前端回落纯文件名），全程永不抛错 */
          try {
            if (Array.isArray(fileChanges)) {
              const clean = [];
              for (let i = 0; i < fileChanges.length; i++) {
                try {
                  const fc = fileChanges[i] || {};
                  const p = String(fc.path || fc.file || fc.name || '');
                  if (!p) continue;
                  const item = { path: p, action: String(fc.action || 'modified') };
                  const a = Number(fc.added);
                  const d = Number(fc.deleted);
                  if (fc.added != null && isFinite(a)) item.added = Math.max(0, Math.floor(a));
                  if (fc.deleted != null && isFinite(d)) item.deleted = Math.max(0, Math.floor(d));
                  clean.push(item);
                } catch (e) {}
              }
              clean.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
              fileChanges = clean;
            } else {
              fileChanges = [];
            }
          } catch (e) { try { if (!Array.isArray(fileChanges)) fileChanges = []; } catch (ee) { fileChanges = []; } }
          /* 用量总量行：复用既有 ai:event type:'trace' 通道（与 history/SANDBOX 告警同口径），
           * 全 0（无用量事件的 CLI）则跳过不打扰。 */
          try {
            const usageLine = formatUsageLine(roundUsage);
            if (usageLine) emitAiEvent({ type: 'trace', trace: { tag: 'USAGE', level: 'info', text: usageLine } });
          } catch (e) {}
          try {
            emitAiEvent({
              type: 'done',
              cancelled: !!cancelled,
              code,
              fileChanges
            });
          } catch (e) {}
          /* 沙箱根越界守卫（任务后对比）：允许目录之外有变更即 trace-warn 列出路径；
           * 通道选择理由同 history 告警：复用既有 ai:event type:'trace'（前端 trace=>aiAppendTrace 黄色样式），
           * 不新增 IPC 通道，不弹红卡不打断流程。超量跳过时本轮不对比（任务前已 trace 注明）。 */
          try {
            if (!sandboxGuardSkipped && sandboxGuardBefore instanceof Map) {
              let outs = [];
              try {
                let rootDir2 = null;
                try { rootDir2 = paths.SANDBOX_ROOT; } catch (e2) { rootDir2 = null; }
                if (rootDir2 && sandboxStorage.diffSandboxRootAgainst) {
                  outs = sandboxStorage.diffSandboxRootAgainst(rootDir2, cwd, sandboxGuardBefore) || [];
                }
              } catch (e2) { outs = []; }
              if (Array.isArray(outs) && outs.length) {
                try {
                  const list = [];
                  for (let i = 0; i < outs.length && list.length < 20; i++) {
                    const pp = String((outs[i] && outs[i].path) || '').trim();
                    if (pp) list.push(pp);
                  }
                  emitAiEvent({ type: 'trace', trace: { tag: 'SANDBOX', level: 'warn', text: '检测到允许目录之外的变更（' + outs.length + ' 处）：' + list.join('、') } });
                } catch (e2) {}
              }
            }
          } catch (e) {}
          /* 历史落盘：本轮结论 + 改动 append 进 .context/history.md（只增不减，供下一轮指针引用）。
           * 100KB 告警接线（通道选择理由）：复用既有 ai:event 的 type:'trace' 通道，
           * 前端 onEvent 已有 trace=>aiAppendTrace 分支（含 .trace-tag.warn 黄色样式），用户在日志面板即刻可见，
           * 无需新增 IPC 通道（任务禁令），且比 type:'error' 更轻（不弹红卡/不打断流程），
           * 比主进程 console/log 文件更直达（后两者仅落盘/终端，用户不可见）。
           * 一次性语义：同 history 文件路径只发一次（historyAlarmWarned 集合），归档后删 key 允许新文件再提示。 */
          try {
            if (!cancelled) {
              let hr = null;
              try { hr = appendHistoryRound(cwd, { user: userPromptText, answer: answerAcc, fileChanges }); } catch (e) { hr = null; }
              try {
                if (hr && hr.alarm) {
                  let hk = '';
                  try { hk = historyFilePath(cwd) || String(cwd || ''); } catch (_) { hk = String(cwd || ''); }
                  if (hk && !historyAlarmWarned.has(hk)) {
                    try { historyAlarmWarned.add(hk); } catch (_) {}
                    try {
                      let kb = 0;
                      try { kb = Math.max(1, Math.round((readHistoryScale(cwd).bytes || 0) / 1024)); } catch (_) {}
                      emitAiEvent({ type: 'trace', trace: { tag: 'HISTORY', level: 'warn', text: '对话历史 .context/history.md 已超 100KB 观测线（现约' + kb + 'KB，只增不减不截断，本轮仍已落盘；按需读取前情即可，溢出控制交给各 CLI）' } });
                    } catch (_) {}
                  }
                }
              } catch (_) {}
            }
          } catch (e) {}
        }
      }
    });
  }

  shared.activeExecution = runAgentProcess(executionOptions, false);
  return { ok: true, success: true, pid: shared.activeExecution ? shared.activeExecution.pid : null };

}
async function aiCancelImpl() {
/* 确认等待中的范围确认按拒绝解决（aiAskImpl 走 scope-denied 中止，不悬挂 120 秒） */
  try {
    for (const w of scopeConfirmWaiters.values()) { try { w.resolve('deny'); } catch (e) {} }
    scopeConfirmWaiters.clear();
    scopeConfirmPending = false;
  } catch (e) {}
  /* 本地 CLI 模型探测也按进程树收尾：只 kill cmd.exe 会留下 node/conhost 持有 fd3/fd4。 */
  try {
    await acpProcessLifecycle.shutdownAll({ kind: 'cli-list-models', reason: 'ai-cancel', timeoutMs: 1500 });
  } catch (e) {}
  /* Phase 1 ACP：turn.cancel + 2 秒兜底 + 权限等待清理统一由 acp-runtime 负责，这里不再二次 kill。 */
  try {
    if (shared.activeExecution && shared.activeExecution.kind === 'acp') {
      try { await acpRuntime.cancel(); } catch (e) {}
      shared.activeExecution = null;
      return 'ok';
    }
  } catch (e) {}
  try {
    if (shared.activeExecution) {
      try { await shared.activeExecution.cancel(); } catch (e) {}
      try { if (shared.activeExecution && shared.activeExecution.pid) await killProcessTree(shared.activeExecution.pid); } catch (e) {}
    }
  } catch (e) {}
  shared.activeExecution = null;
  return 'ok';

}
function aiIsBusyImpl() { return !!shared.activeExecution;
}

/**
 * 应用退出统一收尾：中止后台 ACP 目录探测，关闭 ACP runtime，并强杀仍在运行的探测进程树。
 * 清理范围仅限本进程登记过的 PID，以及当前 Electron 后代树中带 ACP 命令签名的孤儿；
 * 不按镜像名全盘清杀，不影响用户其它终端/进程。
 * @param {{reason?:string,timeoutMs?:number}} [options] 收尾选项
 * @returns {Promise<void>}
 */
async function shutdownAiProcesses(options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(1, Number(opts.timeoutMs)) : 3000;
  try { abortAcpCatalogRefreshes(opts.reason || 'app-quit'); } catch (e) {}
  /* Windows 有后代树兜底扫描，acpx 的 AbortSignal/client.close 只需短暂让路；
   * 其它平台没有 taskkill 兜底，保留更长等待。 */
  const acpxWaitMs = process.platform === 'win32' ? 400 : 1200;
  try { await waitForAcpCatalogRefreshes(Math.min(acpxWaitMs, timeoutMs)); } catch (e) {}
  const acpShutdownMs = Math.min(1500, timeoutMs);
  try { await acpRuntime.shutdown({ reason: opts.reason || 'app-quit', timeoutMs: acpShutdownMs }); } catch (e) {}
  try {
    await acpProcessLifecycle.shutdownAll({
      kind: 'cli-list-models',
      reason: opts.reason || 'app-quit',
      timeoutMs
    });
  } catch (e) {}
  /* acpRuntime.shutdown 内部已按 kind=acp 收尾；这里再兜一次，防止 runtime 创建失败时遗留登记。 */
  try {
    await acpProcessLifecycle.shutdownAll({ kind: 'acp', reason: opts.reason || 'app-quit', timeoutMs });
  } catch (e) {}
  /* inspectAgentModels 由 acpx 内部 client 管理，不暴露 processLifecycle：
   * abort + client.close 有时赶不上 Electron 退出，按“后代树 + ACP 命令签名”再扫一次。 */
  if (!acpOrphanSweepDone && acpProbeCommandSignatures.size) {
    acpOrphanSweepDone = true;
    try {
      acpProcessLifecycle.sweepOrphanDescendants({
        parentPid: process.pid,
        signatures: Array.from(acpProbeCommandSignatures)
      });
    } catch (e) {}
  }
}

/**
 * 同步收尾（window-all-closed / process exit）：中止探测信号并强杀所有登记的 AI 进程树。
 * @param {{sweep?:boolean}} [options] sweep=false 时只清理登记项（留给 before-quit 做后代树兜底）
 * @returns {void}
 */
function shutdownAiProcessesSync(options) {
  const opts = (options && typeof options === 'object') ? options : {};
  try { abortAcpCatalogRefreshes('app-exit-sync'); } catch (e) {}
  try { acpRuntime.shutdownSync(); } catch (e) {}
  try { acpProcessLifecycle.killAllSync(); } catch (e) {}
  if (opts.sweep !== false && !acpOrphanSweepDone && acpProbeCommandSignatures.size) {
    acpOrphanSweepDone = true;
    try {
      acpProcessLifecycle.sweepOrphanDescendants({
        parentPid: process.pid,
        signatures: Array.from(acpProbeCommandSignatures)
      });
    } catch (e) {}
  }
}
/* 本地 CLI 终端：纯组装（可单测），Windows 走 cmd start 开独立控制台窗口
 * @param {string} resolvedBin CLI 可执行文件（绝对路径或 PATH 名）
 * @param {string} cwd 沙箱工作目录
 * @param {string[]} [extraArgs] 终端启动附加参数（缺省无）
 * @returns {{ok:boolean, command?:string, args?:string[], error?:string}} */
function buildTerminalLaunch(resolvedBin, cwd, extraArgs) {
  try {
    if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' };
    const bin = String(resolvedBin || '').trim();
    const dir = String(cwd || '').trim();
    if (!bin || !dir) return { ok: false, error: '缺少可执行文件或目录' };
    const tail = Array.isArray(extraArgs) ? extraArgs.map((s) => String(s || '')).filter((s) => s) : [];
    const line = ['start', 'Proto CLI', '/D', dir, bin].concat(tail).map((s) => quoteWindowsCommandArg(s)).join(' ');
    /* 整行已按 cmd 语法转义完毕，须 verbatim 投递：否则 Node 会给含空格参数再包引号、
     * 内部引号被反斜杠转义后 cmd 不认，start 会把标题 "Proto CLI" 当成要执行的文件 */
    return { ok: true, command: 'cmd.exe', args: ['/d', '/s', '/c', line], windowsVerbatimArguments: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
/* 解析某 CLI 的终端启动目标（每家独立启动命令表）：
 * def.terminal = {cmd?: string|string[], args?: string[], unsupported?: string}，缺省用解析到的 bin、无附加参数。
 * @param {Object} def Agent 定义
 * @param {string} customPath 用户指定的自定义路径
 * @returns {Promise<{ok:boolean, bin?:string, args?:string[], display?:string, error?:string, tried?:string[]}>} */
async function resolveTerminalTarget(def, customPath) {
  try {
    if (!def) return { ok: false, error: '未找到 Agent 适配器' };
    const term = (def.terminal && typeof def.terminal === 'object') ? def.terminal : null;
    if (term && term.unsupported) {
      return { ok: false, error: String(term.unsupported) };
    }
    let bin = null;
    try { bin = await resolveAgentExecutable(def, customPath); } catch (e) { bin = null; }
    if (term && term.cmd != null) {
      const override = Array.isArray(term.cmd) ? term.cmd.map((s) => String(s || '')).filter((s) => s) : [String(term.cmd || '').trim()].filter((s) => s);
      if (!override.length) return { ok: false, error: '该 CLI 的终端启动命令为空' };
      const args = Array.isArray(term.args) ? term.args.map((s) => String(s || '')).filter((s) => s) : [];
      return { ok: true, bin: override[0], args: override.slice(1).concat(args), display: override.concat(args).join(' ') };
    }
    if (!bin) {
      const tried = [def.bin].concat(def.fallbackBins || []).filter(Boolean).map((s) => String(s));
      return { ok: false, error: '未找到 ' + (def.name || def.id) + '（已尝试：' + (tried.join('、') || '无') + '），请确认已安装或在设置中心指定路径', tried };
    }
    const args = (term && Array.isArray(term.args)) ? term.args.map((s) => String(s || '')).filter((s) => s) : [];
    const disp = ([bin].concat(args)).join(' ');
    return { ok: true, bin, args, display: disp };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
/* 在当前沙箱目录打开当前 CLI 的可交互终端（ai:open-terminal 实现）
 * @param {Object} ev IPC 事件
 * @param {string} dir 沙箱目录（渲染层 aiSbxDir）
 * @returns {Promise<{ok:boolean, success:boolean, pid?, agent?, cmd?, error?}>} */
async function aiOpenTerminalImpl(ev, dir) {
  try {
    const cwd = aiWorkDir(dir);
    try {
      if (!fs.existsSync(cwd)) return { ok: false, success: false, error: '沙箱目录不存在' };
    } catch (e) { return { ok: false, success: false, error: '沙箱目录不可读' }; }
    const aiCfg = aiConfigStore.loadAiConfigFull();
    const agentId = String((aiCfg && (aiCfg.agentId || aiCfg.mainAgent)) || 'opencode');
    const def = getAgentDef(agentId) || getAgentDef('opencode');
    if (!def) return { ok: false, success: false, error: '未找到 Agent 适配器' };
    let customPath = aiCfg.cliPath;
    try {
      if (aiCfg.cliPaths && aiCfg.cliPaths[def.id]) customPath = aiCfg.cliPaths[def.id];
    } catch (e) {}
    const target = await resolveTerminalTarget(def, customPath);
    if (!target.ok) return { ok: false, success: false, error: target.error };
    const launch = buildTerminalLaunch(target.bin, cwd, target.args);
    if (!launch.ok) return { ok: false, success: false, error: launch.error };
    const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: !!launch.windowsVerbatimArguments });
    try { if (child && typeof child.unref === 'function') child.unref(); } catch (e) {}
    return { ok: true, success: true, pid: (child && child.pid) || null, agent: def.name || def.id, cmd: target.display };
  } catch (e) { return { ok: false, success: false, error: String((e && e.message) || e) }; }
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
  warmThinkingCache,
  resolveConfiguredModel,
  waitForThinkingProbes,
  __resetThinkingWarmForTest,
  aiPickImpl,
  aiAskImpl,
  aiCancelImpl,
  aiIsBusyImpl,
  shutdownAiProcesses,
  shutdownAiProcessesSync,
  abortAcpCatalogRefreshes,
  __setAcpModelsTestHooks,
  resolveUiSpecKind,
  buildUiSpecSection,
  buildToolPromptPointer,
  buildTargetFileSection,
  contextHash,
  findToolPromptFile,
  stageContextDir,
  historyFilePath,
  readHistoryScale,
  buildHistoryPointer,
  appendHistoryRound,
  sanitizeArchiveTabId,
  historyArchivePath,
  maybeArchiveHistoryOnTabSwitch,
  lastTabByCwd,
  historyAlarmWarned,
  buildSkillMapSection,
  countFilesUnderRoot,
  buildSandboxRootBeforeMap,
  SANDBOX_GUARD_TOTAL_MAX_FILES,
  UI_SPEC_PROMPT_MAX_BYTES,
  CONTEXT_DIR_NAME,
  CONTEXT_SPEC_FILE,
  CONTEXT_TOOLPROMPT_FILE,
  CONTEXT_HISTORY_FILE,
  CONTEXT_ARCHIVE_DIR,
  HISTORY_ARCHIVE_NAME_MAX,
  HISTORY_ALARM_BYTES,
  findScopeRefs,
  isScopeAlwaysAllowed,
  setScopeAlwaysAllowed,
  resetScopeConfirmForTest,
  handleScopeConfirmResponse,
  awaitScopeConfirm,
  addUsageCounts,
  formatUsageLine,
  resolveCliPermissionMode,
  scopeAlwaysAllowByCwd,
  scopeConfirmWaiters,
  SCOPE_CONFIRM_TIMEOUT_MS,
  SCOPE_HITS_MAX,
  aiOpenTerminalImpl,
  buildTerminalLaunch,
  resolveTerminalTarget,
  cutSummaryLine,
  SUMMARY_SOFT_LEN,
  SUMMARY_HARD_LEN,
};
