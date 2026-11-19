'use strict';
/**
 * git/auth.js — Git 安全原语（P0 止血）
 * 职责：URL 白名单 + extraHeader 凭据注入 + 脱敏 + 错误映射
 * 约束：绝不拼 Token URL；默认仅 https 放行；不引入 npm 依赖；纯 Node 可单测
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

/** 本地 bare 夹具开关：仅未打包开发态且值为 '1' 时生效（生产边界见 docs/git-local-fixture.md） */
const LOCAL_FIXTURE_ENV = 'PLAND_GIT_ALLOW_LOCAL';
/** 测试注入的打包态；生产路径始终读 electron.app.isPackaged */
let _packagedOverrideForTest = null;

function blockedError(reason) {
  const e = new Error('不支持的仓库地址协议：' + reason);
  e.code = 'GIT_URL_BLOCKED';
  return e;
}

/**
 * 是否打包态。无法确认运行态时按打包态处理（fail-closed）。
 * @returns {boolean}
 */
function isPackagedApp() {
  if (typeof _packagedOverrideForTest === 'boolean') return _packagedOverrideForTest;
  try {
    const el = require('electron');
    const app = el && (el.app || (el.default && el.default.app));
    if (app && typeof app.isPackaged === 'boolean') return app.isPackaged;
  } catch (e) {}
  return true;
}

/**
 * file:/// 本地夹具是否放行：必须同时满足 !isPackaged 且 PLAND_GIT_ALLOW_LOCAL=1。
 * @returns {boolean}
 */
function isLocalFixtureAllowed() {
  try {
    if (String(process.env[LOCAL_FIXTURE_ENV] || '').trim() !== '1') return false;
  } catch (e) {
    return false;
  }
  return !isPackagedApp();
}

/**
 * 解析 git config，仅在 [core] 段内读取 bare=true。
 * 避免任意段落的 bare=true 被误判为 bare 仓库。
 * @param {string} cfgText
 * @returns {boolean}
 */
function hasCoreBareTrue(cfgText) {
  let section = '';
  const lines = String(cfgText || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) continue;
    const sec = t.match(/^\[([^\]]+)\]/);
    if (sec) {
      section = sec[1].trim().toLowerCase();
      continue;
    }
    if (section !== 'core') continue;
    const kv = t.match(/^bare\s*=\s*(.*)$/i);
    if (kv) return /^true$/i.test(kv[1].trim());
  }
  return false;
}

/**
 * 结构校验：须为目录且形如 bare git 仓库（HEAD + objects + refs + [core] bare=true）。
 * 目的：把 file:/// 收紧到本地 bare 夹具，而非任意本地路径（含工作区 .git）。
 * @param {string} absPath 本地绝对路径
 * @returns {boolean}
 */
function looksLikeBareRepoDir(absPath) {
  try {
    const st = fs.statSync(absPath);
    if (!st || !st.isDirectory()) return false;
    if (!fs.existsSync(path.join(absPath, 'HEAD'))) return false;
    if (!fs.existsSync(path.join(absPath, 'objects'))) return false;
    if (!fs.existsSync(path.join(absPath, 'refs'))) return false;
    return hasCoreBareTrue(fs.readFileSync(path.join(absPath, 'config'), 'utf8'));
  } catch (e) {
    return false;
  }
}

/**
 * 校验开发态本地 bare 夹具 URL：仅 file:/// 绝对路径，拒绝主机名/UNC/查询串/..。
 * @param {string} raw 已确认以 file:/// 开头的原始 URL
 * @returns {true}
 */
function assertAllowedLocalFixtureUrl(raw) {
  if (!/^file:\/\/\//i.test(raw)) throw blockedError('file:// 仅支持 file:/// 绝对路径（不支持主机名/UNC）');
  if (/\\/.test(raw)) throw blockedError('file:// 路径不得含反斜杠');
  let u = null;
  try {
    u = new URL(raw);
  } catch (e) {
    throw blockedError('不是合法 URL');
  }
  if (u.protocol.toLowerCase() !== 'file:') throw blockedError('仅支持 file:/// 协议');
  if (u.host) throw blockedError('file:// 不支持主机名或共享路径');
  if (u.username || u.password) throw blockedError('地址中不得携带用户名/口令');
  if (u.search || u.hash) throw blockedError('file:// 地址不得携带查询参数或片段');
  if (!u.pathname || u.pathname === '/') throw blockedError('file:// 地址缺少仓库路径');
  // file:////server/share 解析后 pathname 以 // 开头，按 UNC 拒绝
  if (u.pathname.slice(1).startsWith('/')) throw blockedError('file:// 不支持 UNC/双斜杠路径');
  // URL 解析会归一化点段，故先按原始段拦截 .. / .（含 %2e 编码）
  const rawSegs = raw.split('/').slice(3);
  for (const seg of rawSegs) {
    let ds = seg;
    try { ds = decodeURIComponent(seg); } catch (e) { throw blockedError('file:// 路径编码非法'); }
    if (ds === '..' || ds === '.') throw blockedError('file:// 路径不得含 .. 或 . 段');
    if (ds.indexOf('/') >= 0) throw blockedError('file:// 路径不得含编码斜杠');
    if (/[\u0000-\u001f\u007f]/.test(ds)) throw blockedError('file:// 路径含控制字符');
    if (ds.indexOf('\\') >= 0) throw blockedError('file:// 路径含非法字符');
  }
  if (raw.length > 500) throw blockedError('地址长度超限（≤500）');
  if (process.platform === 'win32' && !/^\/[A-Za-z]:\//.test(u.pathname)) {
    throw blockedError('Windows 下 file:/// 须为盘符绝对路径（如 file:///C:/repo.git）');
  }
  let abs = '';
  try {
    abs = fileURLToPath(raw);
  } catch (e) {
    throw blockedError('file:// 路径无法解析为本地绝对路径');
  }
  if (!path.isAbsolute(abs)) throw blockedError('file:// 路径须为绝对路径');
  if (!looksLikeBareRepoDir(abs)) throw blockedError('file:// 路径不是可用的本地 bare 仓库（须含 HEAD/objects/refs 且 core.bare=true）');
  return true;
}

/**
 * 校验远端 URL 合法性，不合法抛 {code:'GIT_URL_BLOCKED'}。
 * 拒绝：ext:: / fd:: / -e / --upload-pack / --receive-pack / --exec /
 * 换行 / 以 - 开头 / 含空格 / 非 https / 含用户信息(@) / shell 元字符。
 * file:// 默认拒绝；仅未打包开发态且 PLAND_GIT_ALLOW_LOCAL=1 时放行本地 bare 仓库 file:/// 绝对路径。
 * @param {string} remoteUrl
 */
function assertAllowedRemoteUrl(remoteUrl) {
  const raw = String(remoteUrl == null ? '' : remoteUrl).trim();
  if (!raw) throw blockedError('仓库地址为空');
  if (/[\r\n\u2028\u2029]/.test(raw)) throw blockedError('仓库地址含非法换行');
  if (/^-/.test(raw)) throw blockedError('仓库地址不能以 - 开头');
  if (/^ext::/i.test(raw)) throw blockedError('不支持 ext:: 协议（存在命令执行风险）');
  if (/^fd::/i.test(raw)) throw blockedError('不支持 fd:: 协议');
  if (/--upload-pack/i.test(raw)) throw blockedError('仓库地址含非法参数 --upload-pack');
  if (/--receive-pack/i.test(raw)) throw blockedError('仓库地址含非法参数 --receive-pack');
  if (/(^|\s)-e(\s|$|=)/.test(raw)) throw blockedError('仓库地址含非法参数 -e');
  if (/--exec($|=|\s)/i.test(raw)) throw blockedError('仓库地址含非法参数 --exec');
  if (/`/.test(raw)) throw blockedError('仓库地址含非法字符 `');
  if (/\$\(/.test(raw)) throw blockedError('仓库地址含非法字符 $(');
  if (/\s/.test(raw)) throw blockedError('仓库地址不得含空格');
  // file:// 例外：仅开发态 + PLAND_GIT_ALLOW_LOCAL=1，且必须是本地 bare 仓库目录；其余一律拒绝
  if (/^file:\/\//i.test(raw)) {
    if (!isLocalFixtureAllowed()) {
      throw blockedError('默认不支持 file:// 本地路径（仅未打包开发态且 PLAND_GIT_ALLOW_LOCAL=1 时允许本地 bare 夹具）');
    }
    return assertAllowedLocalFixtureUrl(raw);
  }
  // 默认仅 https 放行
  if (!/^https:\/\//i.test(raw)) throw blockedError('默认仅支持 https:// 仓库地址');
  let u = null;
  try {
    u = new URL(raw);
  } catch (e) {
    throw blockedError('不是合法 URL');
  }
  if (!u.hostname) throw blockedError('缺少主机名');
  if (u.protocol.toLowerCase() !== 'https:') throw blockedError('仅支持 https:// 协议');
  // 裸 URL 不得携带用户信息，凭据须走输入框 + extraHeader
  if (u.username || u.password) throw blockedError('地址中不得携带用户名/口令，请走凭据输入框');
  if (raw.length > 500) throw blockedError('地址长度超限（≤500）');
  return true;
}

/**
 * 构造凭据注入：绝不返回拼 Token 的 URL。
 * @param {{username?:string,token?:string}} o
 * @returns {{envAdd:Object,argsPrefix:string[]}}
 */
function buildGitAuthEnv(o) {
  const username = String((o && o.username) == null ? '' : o.username).trim();
  const token = String((o && o.token) == null ? '' : o.token).trim();
  if (!username && !token) return { envAdd: {}, argsPrefix: [] };
  // 仅用户名无 token：无法构造有效 header，返回空（调用方用裸 URL，将走鉴权失败分支，不泄露）
  if (username && !token) return { envAdd: {}, argsPrefix: [] };
  let header = '';
  if (username && token) {
    const b64 = Buffer.from(username + ':' + token, 'utf8').toString('base64');
    header = 'AUTHORIZATION: Basic ' + b64;
  } else {
    header = 'AUTHORIZATION: Bearer ' + token;
  }
  return {
    envAdd: { GIT_HTTP_EXTRAHEADER: header },
    argsPrefix: ['-c', 'http.extraHeader=' + header]
  };
}

function decodeLoop(s) {
  let cur = String(s || '');
  for (let i = 0; i < 3; i++) {
    try {
      const nd = decodeURIComponent(cur);
      if (nd === cur) break;
      cur = nd;
    } catch (e) { break; }
  }
  return cur;
}

/**
 * 脱敏：覆盖 https 带/不带用户名、%编码、Bearer/token=/basic、extraHeader 行，截断 2000。
 * @param {*} text
 * @returns {string}
 */
function redactSecrets(text) {
  let s = String(text == null ? '' : text);
  if (!s) return s;
  // 1. extraHeader 整行脱敏（先做，避免 header 值被后续规则部分残留）
  try {
    s = s.replace(/^.*GIT_HTTP_EXTRAHEADER.*$/gmi, 'GIT_HTTP_EXTRAHEADER: ***');
    s = s.replace(/^.*http\.extraHeader.*$/gmi, 'http.extraHeader: ***');
  } catch (e) {}
  // 2. %编码先归一化一遍再扫（防 %40/%3A/%20 绕过）：把常见编码还原为空格/@/: /= 后再走同样规则
  // 注意：此处在原串上做归一化替换，不做全量 decode（避免改变正常 URL 编码语义过多），后续再全量 decode 扫一遍
  try {
    let norm = s.replace(/%40/gi, '@').replace(/%3A/gi, ':').replace(/%3D/gi, '=').replace(/%20/gi, ' ');
    if (norm !== s) s = norm;
  } catch (e) {}
  // 3. https 带用户名密码形态：https://user:pass@host -> https://***:***@
  try {
    s = s.replace(/https?:\/\/[^\s\/@]+:[^@\s]+@/g, 'https://***:***@');
  } catch (e) {}
  // 4. https 仅 token 形态：https://TOKEN@host -> https://***@
  try {
    s = s.replace(/https?:\/\/[^\s\/:@]+@/g, 'https://***@');
  } catch (e) {}
  // 5. Bearer / private_token / access_token 形态
  try {
    s = s.replace(/(bearer|private_token|access_token)(\s*[:=\s]\s*)([A-Za-z0-9\-._~+/=]{8,})/gi, '$1$2****');
  } catch (e) {}
  // 6. token=xxx / token: xxx 形态（含引号包裹）
  try {
    s = s.replace(/(["'`\s(=]|^)(token)(\s*[:=]\s*)(["']?)([A-Za-z0-9\-._~+/=]{8,})(["']?)/gi, '$1$2$3$4****$6');
  } catch (e) {}
  // 7. Basic base64 片段
  try {
    s = s.replace(/(basic\s+)([A-Za-z0-9+/=]{8,})/gi, '$1****');
  } catch (e) {}
  // 8. 解码后再扫一遍（防双重编码绕过）
  try {
    const d = decodeLoop(s);
    if (d && d !== s) {
      let rd = d;
      rd = rd.replace(/^.*GIT_HTTP_EXTRAHEADER.*$/gmi, 'GIT_HTTP_EXTRAHEADER: ***');
      rd = rd.replace(/^.*http\.extraHeader.*$/gmi, 'http.extraHeader: ***');
      rd = rd.replace(/https?:\/\/[^\s\/@]+:[^@\s]+@/g, 'https://***:***@');
      rd = rd.replace(/https?:\/\/[^\s\/:@]+@/g, 'https://***@');
      rd = rd.replace(/(bearer|private_token|access_token)(\s*[:=\s]\s*)([A-Za-z0-9\-._~+/=]{8,})/gi, '$1$2****');
      rd = rd.replace(/(["'`\s(=]|^)(token)(\s*[:=]\s*)(["']?)([A-Za-z0-9\-._~+/=]{8,})(["']?)/gi, '$1$2$3$4****$6');
      rd = rd.replace(/(basic\s+)([A-Za-z0-9+/=]{8,})/gi, '$1****');
      // 若解码后发现了凭据而原串未脱敏，说明原串含编码凭据，做保守兜底：把原串中 %XX 长序列整体打码
      if (rd !== d) {
        s = s.replace(/(%[0-9A-Fa-f]{2}){4,}/g, '***');
        // 再跑一次基础规则，确保归一化后残留被清除
        s = s.replace(/https?:\/\/[^\s\/@]+:[^@\s]+@/g, 'https://***:***@');
        s = s.replace(/https?:\/\/[^\s\/:@]+@/g, 'https://***@');
      }
    }
  } catch (e) {}
  // 9. 换行规范化 + 截断 2000（防超大 stderr 刷屏）
  try {
    s = s.replace(/\r\n/g, '\n');
  } catch (e) {}
  if (s.length > 2000) s = s.slice(0, 2000) + '...（已截断）';
  return s;
}

/**
 * 错误映射：先脱敏后保留现有友好映射，新增超时 124 分支。
 * @param {*} errText
 * @returns {string}
 */
function sanitizeGitError(errText) {
  if (errText == null || errText === '') return '操作失败';
  let t = '';
  try { t = redactSecrets(String(errText)).trim(); } catch (e) { t = String(errText).trim(); }
  if (!t) return '操作失败';
  // 超时（新增）：覆盖 status 124 / timedOut / 操作超时
  if (/Git 操作超时|操作超时.*整树终止|timedOut|status[:\s]*124|timed out.*124/i.test(t) || /Git 操作超时\s*\(\d+ms\)/.test(t)) {
    return 'Git 操作超时：远端响应过慢或文件过多，可重试或分批勾选后重试';
  }
  if (/Authentication failed|401|403|not authorized|could not read Username|Invalid username or password/i.test(t)) {
    return 'Git 鉴权失败：账号密码或 Access Token 错误或已过期（请确保 Token 已开启 write_repository 读写权限）';
  }
  if (/Could not resolve host|Connection refused|timed out|Failed to connect/i.test(t)) {
    return '网络连接失败：无法访问 Git 远程仓库，请检查网络或仓库地址';
  }
  if (/Repository not found|remote: Not Found|does not exist/i.test(t)) {
    return '远程仓库不存在或无访问权限，请核对仓库 URL';
  }
  if (/fetch first|non-fast-forward|Updates were rejected/i.test(t)) {
    return '远程仓库存在未同步的新版本，请先执行拉取同步后再上传';
  }
  return t;
}

/**
 * 分支名校验代理（与 main.js:isValidBranch 同规则，handlers 统一调用）。
 */
function isValidBranchRef(b) {
  return /^[a-zA-Z0-9._\/-]+$/.test(String(b || '')) && String(b || '').length <= 60 && !String(b || '').includes('..');
}

/**
 * 仅测试使用：注入打包态，模拟 Electron app.isPackaged。
 * 传 null 恢复为真实探测（纯 Node 下按打包态 fail-closed）。
 * @param {boolean|null} v
 */
function _setPackagedForTest(v) {
  _packagedOverrideForTest = (typeof v === 'boolean') ? v : null;
}

module.exports = {
  assertAllowedRemoteUrl,
  buildGitAuthEnv,
  redactSecrets,
  sanitizeGitError,
  isValidBranchRef,
  _setPackagedForTest
};
