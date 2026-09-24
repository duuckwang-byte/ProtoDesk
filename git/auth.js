'use strict';
/**
 * git/auth.js — Git 安全原语（P0 止血）
 * 职责：URL 白名单 + extraHeader 凭据注入 + 脱敏 + 错误映射
 * 约束：绝不拼 Token URL；默认仅 https 放行；不引入 npm 依赖；纯 Node 可单测
 */

function blockedError(reason) {
  const e = new Error('不支持的仓库地址协议：' + reason);
  e.code = 'GIT_URL_BLOCKED';
  return e;
}

/**
 * 校验远端 URL 合法性，不合法抛 {code:'GIT_URL_BLOCKED'}。
 * 拒绝：ext:: / fd:: / file:// / -e / --upload-pack / --receive-pack / --exec /
 * 换行 / 以 - 开头 / 含空格 / 非 https / 含用户信息(@) / shell 元字符。
 * 默认仅 https 放行。
 * @param {string} remoteUrl
 */
function assertAllowedRemoteUrl(remoteUrl) {
  const raw = String(remoteUrl == null ? '' : remoteUrl).trim();
  if (!raw) throw blockedError('仓库地址为空');
  if (/[\r\n\u2028\u2029]/.test(raw)) throw blockedError('仓库地址含非法换行');
  if (/^-/.test(raw)) throw blockedError('仓库地址不能以 - 开头');
  if (/^ext::/i.test(raw)) throw blockedError('不支持 ext:: 协议（存在命令执行风险）');
  if (/^fd::/i.test(raw)) throw blockedError('不支持 fd:: 协议');
  if (/^file:\/\//i.test(raw)) throw blockedError('默认不支持 file:// 本地路径');
  if (/--upload-pack/i.test(raw)) throw blockedError('仓库地址含非法参数 --upload-pack');
  if (/--receive-pack/i.test(raw)) throw blockedError('仓库地址含非法参数 --receive-pack');
  if (/(^|\s)-e(\s|$|=)/.test(raw)) throw blockedError('仓库地址含非法参数 -e');
  if (/--exec($|=|\s)/i.test(raw)) throw blockedError('仓库地址含非法参数 --exec');
  if (/`/.test(raw)) throw blockedError('仓库地址含非法字符 `');
  if (/\$\(/.test(raw)) throw blockedError('仓库地址含非法字符 $(');
  // 默认仅 https 放行
  if (!/^https:\/\//i.test(raw)) throw blockedError('默认仅支持 https:// 仓库地址');
  if (/\s/.test(raw)) throw blockedError('仓库地址不得含空格');
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

module.exports = {
  assertAllowedRemoteUrl,
  buildGitAuthEnv,
  redactSecrets,
  sanitizeGitError,
  isValidBranchRef
};
