const fs = require('node:fs');
const path = require('node:path');

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

/**
 * 候选文件名后缀顺序：Windows 下必须优先查找可执行脚本与二进制 (.cmd, .bat, .exe)，
 * 严禁无后缀优先，防止匹配到 npm 创建的无后缀 bash 脚本。
 * @param {string} base 可执行文件名（可带后缀）
 * @returns {string[]} 候选文件名（带后缀）
 */
function candidateNames(base) {
  const isWin = process.platform === 'win32';
  if (!isWin) return [base];
  const lower = base.toLowerCase();
  if (lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return [base];
  }
  return [base + '.cmd', base + '.bat', base + '.exe', base];
}

/**
 * 单次探测批次的目录项缓存：26 个 def 共享同一份 PATH 目录列表，
 * 每个目录只 readdir 一次，把 O(defs × dirs × suffixes) 次 stat 降为 O(dirs) 次 readdir。
 * 缓存只在一次 detectAllAgents 内复用，不跨调用，避免新增 CLI 后长期看不到。
 * @returns {{ dirs: Map<string, Set<string>|null> }}
 */
function createResolutionCache() {
  return { dirs: new Map() };
}

/**
 * @param {string} dir 目录
 * @returns {string} 大小写归一后的缓存键（Windows 文件系统不区分大小写）
 */
function dirCacheKey(dir) {
  return process.platform === 'win32' ? dir.toLowerCase() : dir;
}

/**
 * 读取目录内文件名集合；目录不存在/无权限时返回 null（调用方回退到逐文件探测）。
 * @param {{ dirs: Map }} cache 目录项缓存
 * @param {string} dir 目录
 * @returns {Set<string>|null} 文件名集合（Windows 已转小写）
 */
function readDirNames(cache, dir) {
  const key = dirCacheKey(dir);
  if (cache && cache.dirs.has(key)) return cache.dirs.get(key);
  let names = null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    names = new Set();
    for (const ent of entries) {
      // 指向文件的符号链接也保留，命中后再用 stat 确认目标类型
      if (!ent.isFile() && !ent.isSymbolicLink()) continue;
      names.add(process.platform === 'win32' ? ent.name.toLowerCase() : ent.name);
    }
  } catch (e) {
    // 目录不存在等价于空目录，直接按“无候选”处理，避免对每个候选再补一次 exists 探测
    names = e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? new Set() : null;
  }
  if (cache) cache.dirs.set(key, names);
  return names;
}

/**
 * 判断目录内是否存在指定候选文件。
 * @param {{ dirs: Map }|null} cache 目录项缓存
 * @param {string} dir 目录
 * @param {string} name 文件名
 * @returns {boolean} 存在且为常规文件
 */
function hasCandidateFile(cache, dir, name) {
  if (cache) {
    const names = readDirNames(cache, dir);
    if (names) {
      const key = process.platform === 'win32' ? name.toLowerCase() : name;
      // 目录项已声明为文件/链接，links 需 stat 兜底确认；未命中直接跳过，避免无谓 stat
      return names.has(key) ? isExecutableFile(path.join(dir, name)) : false;
    }
  }
  return isExecutableFile(path.join(dir, name));
}

/**
 * 在给定目录序列中按「base 优先、目录其次、后缀最后」的原顺序查找。
 * @param {{ dirs: Map }|null} cache 目录项缓存
 * @param {string[]} bases 可执行文件名列表（bin + fallbackBins）
 * @param {string[]} dirs 目录列表
 * @returns {string|null} 命中路径
 */
function findInDirs(cache, bases, dirs) {
  for (const base of bases) {
    for (const dir of dirs) {
      for (const name of candidateNames(base)) {
        if (hasCandidateFile(cache, dir, name)) return path.join(dir, name);
      }
    }
  }
  return null;
}

let cachedNpmRootDirs = null;

/**
 * 读取 .npmrc 中的 prefix（npm 全局安装前缀），避免为拿全局根而 spawn 一个 npm 进程。
 * 支持 ${VAR} / %VAR% 形式的环境变量展开，失败返回空串。
 * @param {string} file .npmrc 路径
 * @returns {string} 前缀路径
 */
function readNpmrcPrefix(file) {
  try {
    if (!file || !fs.existsSync(file)) return '';
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*prefix\s*=\s*(.+?)\s*$/i.exec(line);
      if (!m) continue;
      let value = m[1].replace(/^["']|["']$/g, '');
      value = value.replace(/\$\{([^}]+)\}|%([^%]+)%/g, (all, a, b) => {
        const name = a || b;
        return process.env[name] || process.env[name.toUpperCase()] || all;
      });
      return value.trim();
    }
  } catch (_) { /* 忽略 */ }
  return '';
}

/**
 * npm 全局根候选目录：由环境变量 + Node 安装位置 + .npmrc 推导，纯同步读取，不 spawn 进程。
 * Windows 默认全局前缀是 %APPDATA%\npm（npm root -g 即其下 node_modules），
 * 自定义前缀通过 npm_config_prefix 或 .npmrc prefix 覆盖。
 * @returns {string[]} 去重后的候选目录
 */
function npmRootDirs() {
  if (cachedNpmRootDirs) return cachedNpmRootDirs;
  const isWin = process.platform === 'win32';
  const out = [];
  const push = (d) => { if (d) out.push(d); };
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const execDir = path.dirname(process.execPath);

  const prefixes = [];
  const envPrefix = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX;
  if (envPrefix) prefixes.push(envPrefix);
  // 与 `npm root -g` 的配置优先级保持一致：项目 .npmrc > 用户 .npmrc > 全局 npmrc
  const npmrcFiles = [
    path.join(process.cwd(), '.npmrc'),
    process.env.npm_config_userconfig || path.join(home, '.npmrc'),
    path.join(execDir, 'node_modules', 'npm', 'npmrc')
  ];
  for (const file of npmrcFiles) {
    const prefix = readNpmrcPrefix(file);
    if (prefix) prefixes.push(prefix);
  }

  for (const prefix of prefixes) {
    push(path.join(prefix, 'node_modules'));
    push(path.join(prefix, 'node_modules', '.bin'));
    push(prefix);
    if (!isWin) push(path.join(prefix, 'bin'));
  }

  if (isWin) {
    const appData = process.env.APPDATA || '';
    if (appData) {
      // npm root -g 的默认值：%APPDATA%\npm\node_modules
      push(path.join(appData, 'npm', 'node_modules'));
      push(path.join(appData, 'npm', 'node_modules', '.bin'));
      push(path.join(appData, 'npm'));
    }
    // Node 安装目录自带的全局 node_modules（部分安装器把 CLI 装在这里）
    push(path.join(execDir, 'node_modules'));
    push(path.join(execDir, 'node_modules', '.bin'));
  } else {
    // /usr/local/bin/node -> /usr/local；全局包在 lib/node_modules，bin 在 bin
    const prefix = path.dirname(execDir);
    push(path.join(prefix, 'lib', 'node_modules'));
    push(path.join(prefix, 'lib', 'node_modules', '.bin'));
    push(path.join(prefix, 'bin'));
  }

  cachedNpmRootDirs = [...new Set(out)];
  return cachedNpmRootDirs;
}

function collectFallbackDirs() {
  const dirs = [];
  const push = (d) => { if (d) dirs.push(d); };

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  // 厂商私有安装目录（Antigravity/agy）：安装器不写 PATH，CLI 实际落盘于
  // %LOCALAPPDATA%\agy\bin\agy.exe（或 Programs\agy\bin）。仅作为 PATH 之后的兜底，
  // 放在 npm/scoop 之前，避免被同名 shim 抢先。
  if (localAppData) {
    push(path.join(localAppData, 'agy', 'bin'));
    push(path.join(localAppData, 'Programs', 'agy', 'bin'));
  }

  npmRootDirs().forEach(push);

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
 * 二进制文件深度解析器：自定义路径 -> 厂商私有目录(qoderCN) -> PATH -> 厂商兜底(agy) / npm/scoop/choco -> 文件校验
 * @param {Object} def Agent 定义（含 bin / fallbackBins）
 * @param {string} [customPath] 用户手动指定的可执行文件路径
 * @param {{ cache?: { dirs: Map } }} [options] 可选目录项缓存（一次探测内共享，避免重复 readdir/stat）
 * @returns {Promise<string|null>} 解析出的绝对路径，找不到返回 null（不抛错）
 */
async function resolveAgentExecutable(def, customPath, options = {}) {
  try {
    const cache = options && options.cache ? options.cache : createResolutionCache();

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
          const hit = findInDirs(cache, bases, [cp]);
          if (hit) return hit;
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
    const pathHit = findInDirs(cache, bases, getPathDirs());
    if (pathHit) return pathHit;

    // 4. npm / scoop / choco 兜底
    return findInDirs(cache, bases, collectFallbackDirs());
  } catch (_) {
    return null;
  }
}

module.exports = {
  createResolutionCache,
  resolveAgentExecutable
};
