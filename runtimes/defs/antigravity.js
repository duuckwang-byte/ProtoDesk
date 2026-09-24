const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ANTIGRAVITY_SETTINGS_PATH = path.join(
  os.homedir(),
  '.gemini',
  'antigravity-cli',
  'settings.json'
);

function writeAntigravityModelSelection(label, settingsPath = ANTIGRAVITY_SETTINGS_PATH) {
  try {
    let existing = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed;
        }
      } catch (_) {}
    }
    existing.model = label;
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`);
  } catch (_) {}
}

// 进程内串行锁：直写全局 settings.json，多 agy 并发会互串模型，须串行化“写模型→进程退出”全程。
// promise 链实现：acquire 等待前一个持有者 release 后才返回 release 函数。
let _antigravityModelLockTail = Promise.resolve();

async function acquireAntigravityModelLock() {
  let _releaseCurrent = null;
  const _current = new Promise((resolve) => { _releaseCurrent = resolve; });
  const _prev = _antigravityModelLockTail;
  // 无论前驱成功/失败都放行，避免链断裂；永不抛错
  try {
    _antigravityModelLockTail = _prev.then(() => _current, () => _current);
  } catch (_) {
    _antigravityModelLockTail = _prev.then(() => _current);
  }
  try { await _prev; } catch (_) {}
  let _released = false;
  return function releaseAntigravityModelLock() {
    if (_released) return;
    _released = true;
    try { if (typeof _releaseCurrent === 'function') _releaseCurrent(); } catch (_) {}
  };
}

// 仅当 options.model 非 default 时才需要锁（default 不直写 settings.json，无互串风险）。
function needsAntigravityModelLock(options) {
  try {
    if (!options || typeof options !== 'object') return false;
    const m = options.model;
    if (m == null) return false;
    const s = String(m).trim();
    if (!s || s === 'default') return false;
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  id: 'antigravity',
  name: 'Antigravity',
  bin: 'agy',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
    { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
    { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
  ],
  listModels: {
    args: ['models'],
    timeoutMs: 10000,
    parse: (stdout, stderr) => {
      const text = String(stdout || '').trim() || String(stderr || '').trim();
      if (!text) return [];
      const out = [];
      const seen = new Set();
      const lines = text.split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || /^(fetching|loading|error|warn|available\s+models|---|===)/i.test(line)) continue;
        const m = line.match(/^([a-z0-9][a-z0-9_.-]*)\s+(.+)$/i);
        let id = '';
        let label = '';
        if (m) {
          id = m[1].trim();
          label = m[2].trim();
        } else if (/^[a-z0-9][a-z0-9_.-]*$/i.test(line)) {
          id = line;
          label = line;
        }
        if (!id || id === 'default' || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, label: label || id });
      }
      return out;
    }
  },
  reasoningOptions: [
    { id: 'default', label: '默认推荐 (CLI 预设)', default: true },
    { id: 'high', label: '高强度 (High)' },
    { id: 'medium', label: '中强度 (Medium)' },
    { id: 'low', label: '低强度 (Low)' }
  ],
  buildArgs: (prompt, _images, _extra, options = {}) => {
    // permissionMode 档位约定（缺省即现状）：仅当 options.permissionMode === 'plan' 时，
    // 把默认 --dangerously-skip-permissions 换成 --mode plan；其余（含不配）逐字保持现状。
    // 注：本文件此前无 --mode 取值注释，取值依据 docs/CLI权限矩阵.md（--mode plan / accept-edits）；
    // 本轮仅映射 plan，accept-edits 等待实测后再扩。
    const _pm = (options && typeof options.permissionMode === 'string') ? options.permissionMode.trim() : '';
    const args = (_pm === 'plan') ? ['--mode', 'plan'] : ['--dangerously-skip-permissions'];
    if (options && options.model && options.model !== 'default') {
      try { writeAntigravityModelSelection(options.model); } catch (_) {}
      args.push('--model', options.model);
    }
    if (options && options.reasoning && options.reasoning !== 'default') {
      args.push('--effort', options.reasoning);
    }
    args.push('--output-format', 'stream-json');
    args.push('-p', String(prompt || ''));
    return args;
  },
  writeAntigravityModelSelection,
  promptViaStdin: false,
  streamFormat: 'agy-stream',
  // 通用锁契约：engine 若 def.requiresModelLock === true 则在 buildArgs 前 acquire，close/error 后 release
  requiresModelLock: true,
  acquireAntigravityModelLock,
  acquireModelLock: acquireAntigravityModelLock,
  needsAntigravityModelLock,
  needsModelLock: needsAntigravityModelLock
};
