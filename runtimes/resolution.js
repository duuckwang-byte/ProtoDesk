const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function isExecutableFile(p) {
  try {
    if (!p || !fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    return st.isFile();
  } catch (_) {
    return false;
  }
}

function getPathDirs() {
  const env = process.env;
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const raw = env[pathKey] || '';
  return raw.split(path.delimiter).map(s => (s || '').trim()).filter(Boolean);
}

function candidateForDir(dir, base) {
  const isWin = process.platform === 'win32';
  if (!isWin) return [path.join(dir, base)];
  // Windows 下必须优先查找可执行脚本与二进制 (.cmd, .bat, .exe)，严禁无后缀优先，防止匹配到 npm 创建的无后缀 bash 脚本
  const suffixes = ['.cmd', '.bat', '.exe', ''];
  // 若 base 已带后缀则不再叠加
  const lower = base.toLowerCase();
  if (lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return [path.join(dir, base)];
  }
  return suffixes.map(sfx => path.join(dir, base + sfx));
}

let cachedNpmRootDirs = null;
function npmRootDirs() {
  // npm 全局根进程内不变，缓存避免 26 并发探测时重复 spawn
  if (cachedNpmRootDirs) return cachedNpmRootDirs;
  const out = [];
  try {
    // npm 全局根推导 bin 目录
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 3000 }).trim().split(/\r?\n/)[0].trim();
    if (npmRoot) {
      out.push(npmRoot);
      out.push(path.join(npmRoot, '.bin'));
      // C:\...\npm\node_modules -> C:\...\npm
      out.push(path.dirname(npmRoot));
    }
  } catch (_) { /* 忽略，降级到常见路径 */ }
  cachedNpmRootDirs = out;
  return out;
}

function collectFallbackDirs() {
  const dirs = [];
  const push = (d) => { if (d) dirs.push(d); };
  npmRootDirs().forEach(push);

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || '';
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  // npm 常见全局 bin
  if (appData) push(path.join(appData, 'npm'));
  if (programFiles) push(programFiles, path.join(programFiles, 'nodejs'));
  if (home) {
    push(path.join(home, 'AppData', 'Roaming', 'npm'));
    push(path.join(home, '.npm-global', 'bin'));
  }
  // scoop 常见路径
  if (home) push(path.join(home, 'scoop', 'shims'));
  push(path.join(programData, 'scoop', 'shims'));
  // choco 常见路径
  push(path.join(programData, 'chocolatey', 'bin'));
  // posix 常见路径
  push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');

  return [...new Set(dirs)];
}

/**
 * Qoder CN 版私有安装目录识别：安装器落盘于 ~/.qoder-cn/bin/qoderclicn/，
 * 内为版本化实文件 qoderclicn-x.y.z.exe + 0 字节占位 qoderclicn.exe。
 * 精确名匹配会命中占位死文件，故按版本 glob 取最大可用版；目录常年不在 PATH 内。
 * @returns {string|null} 可用实文件绝对路径，找不到返回 null（不抛错）
 */
function qoderCnExecutable() {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (!home) return null;
    const dir = path.join(home, '.qoder-cn', 'bin', 'qoderclicn');
    let names = null;
    try { names = fs.readdirSync(dir); } catch (_) { return null; }
    if (!Array.isArray(names)) return null;
    const rx = /^qoderclicn-(\d+)\.(\d+)\.(\d+)\.exe$/i;
    let best = null;
    let bestV = null;
    for (const n of names) {
      const m = rx.exec(String(n || ''));
      if (!m) continue;
      const full = path.join(dir, n);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || st.size <= 0) continue;
      } catch (_) { continue; }
      const v = [+m[1], +m[2], +m[3]];
      if (!bestV || (v[0] !== bestV[0] ? v[0] > bestV[0] : (v[1] !== bestV[1] ? v[1] > bestV[1] : v[2] > bestV[2]))) {
        bestV = v;
        best = full;
      }
    }
    return best;
  } catch (_) {
    return null;
  }
}

/**
 * 二进制文件深度解析器：自定义路径 -> 厂商私有目录(qoderCN) -> PATH -> npm/scoop/choco -> 文件校验
 * @param {Object} def Agent 定义（含 bin / fallbackBins）
 * @param {string} [customPath] 用户手动指定的可执行文件路径
 * @returns {Promise<string|null>} 解析出的绝对路径，找不到返回 null（不抛错）
 */
async function resolveAgentExecutable(def, customPath) {
  try {
    // 1. 自定义路径优先
    if (customPath && typeof customPath === 'string' && customPath.trim()) {
      const cp = customPath.trim().replace(/^["']|["']$/g, '');
      const isWin = process.platform === 'win32';
      if (isWin) {
        const lower = cp.toLowerCase();
        if (!lower.endsWith('.cmd') && !lower.endsWith('.bat') && !lower.endsWith('.exe')) {
          if (isExecutableFile(cp + '.cmd')) return cp + '.cmd';
          if (isExecutableFile(cp + '.bat')) return cp + '.bat';
          if (isExecutableFile(cp + '.exe')) return cp + '.exe';
        }
      }
      if (isExecutableFile(cp)) {
        if (isWin) {
          const lower = cp.toLowerCase();
          if (!lower.endsWith('.cmd') && !lower.endsWith('.bat') && !lower.endsWith('.exe')) {
            if (isExecutableFile(cp + '.cmd')) return cp + '.cmd';
            if (isExecutableFile(cp + '.bat')) return cp + '.bat';
            if (isExecutableFile(cp + '.exe')) return cp + '.exe';
          }
        }
        return cp;
      }
      // 若给的是目录，则在目录内按 bin 顺序拼接查找
      try {
        if (fs.existsSync(cp) && fs.statSync(cp).isDirectory()) {
          const bases = [def && def.bin, ...((def && def.fallbackBins) || [])].filter(Boolean);
          const suffixes = isWin ? ['.cmd', '.bat', '.exe', ''] : [''];
          for (const base of bases) {
            for (const sfx of suffixes) {
              const full = path.join(cp, base + sfx);
              if (isExecutableFile(full)) return full;
            }
          }
        }
      } catch (_) { /* 忽略 */ }
      // 自定义路径存在但不是有效文件时仍继续走 PATH 兜底（不直接返回 null）
      // 若为明确文件路径但不存在，按规约继续兜底查找
    }

    const bases = [def && def.bin, ...((def && def.fallbackBins) || [])].filter(Boolean);
    if (!bases.length) return null;

    // 2. 厂商私有目录优先于 PATH：qoderCN 占位 exe 会让精确名匹配命中死文件，
    //    且该目录常年不在 PATH 内；仅 id=qoder 生效，其他 def 原流程不变
    if (def && def.id === 'qoder') {
      const vendor = qoderCnExecutable();
      if (vendor) return vendor;
    }

    // 3. PATH 遍历查找
    const pathDirs = getPathDirs();
    for (const base of bases) {
      for (const dir of pathDirs) {
        const candidates = candidateForDir(dir, base);
        for (const c of candidates) {
          if (isExecutableFile(c)) return c;
        }
      }
    }

    // 4. npm / scoop / choco 兜底
    const extraDirs = collectFallbackDirs();
    for (const base of bases) {
      for (const dir of extraDirs) {
        const candidates = candidateForDir(dir, base);
        for (const c of candidates) {
          if (isExecutableFile(c)) return c;
        }
      }
    }

    return null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  resolveAgentExecutable
};
