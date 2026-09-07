const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

/* P0-1 fix: 移除全局 allow-file-access-from-files，改为 webPreferences 精细控制（保留 webSecurity:true） */
// app.commandLine.appendSwitch('allow-file-access-from-files');

/* ═══════ 开发隔离：未打包（npx electron .）时把 userData 重定向到本目录 .devdata ═══════
   避免开发/测试读写正式环境的 %APPDATA%/原型工具（sandbox、ai-config、AI 会话等）；
   打包发布（isPackaged=true）后自动使用正式 userData，行为与原版一致。 */
if (!app.isPackaged) {
  try { app.setPath('userData', path.join(__dirname, '.devdata')); } catch (e) {}
}

/* 软件包所在目录：文件选择对话框默认目录 */
const pkgDir = path.dirname(app.getPath('exe'));

/* 应用名固定为「原型工具」，保证 userData 路径稳定（%APPDATA%/原型工具）：
   沙箱随用户数据走，安装/升级/换机不丢失原型与 AI 生成文件 */
app.setName('原型工具');

/* ═══════ 沙箱（项目制）：%APPDATA%/原型工具/sandbox/<项目>/<原型文件夹>，一个项目一个文件夹，
   项目内一个原型一个子文件夹（html + md 同放）。沙箱是唯一数据源，不依赖任何安装包内资源；
   首次运行只创建空沙箱根目录；模型以原型文件夹为工作目录创建文件 ═══════ */
const SANDBOX_ROOT = path.join(app.getPath('userData'), 'sandbox');
// P0-2 fix 缓存 realSandboxRoot 供 isSubPath 使用，避免 symlink 穿越
let realSandboxRoot = SANDBOX_ROOT;
try { realSandboxRoot = fs.realpathSync(SANDBOX_ROOT); } catch (e) { try { realSandboxRoot = path.resolve(SANDBOX_ROOT); } catch (ee) {} }
const GIT_STATUS_MAP={M:'mod',A:'add',D:'del',R:'mod',C:'mod',U:'add',T:'mod','?':'add'};
function gitHandledPath(handledSet, relPath){ if(!relPath||handledSet.has(relPath)) return true; handledSet.add(relPath); return false; }
function gitStatusCode(flag){ var f=String(flag||'').trim(); if(f==='UU'||f==='AA') return 'conflict'; var ch=f.charAt(0); return GIT_STATUS_MAP[ch]||GIT_STATUS_MAP['?']||'mod'; }
function gitStatusLabel(code){ return code==='add'?'新增':code==='del'?'删除':code==='conflict'?'冲突':'修改'; }
function gitStatusInfo(flag){ var code=gitStatusCode(flag); return {code:code, label:gitStatusLabel(code)}; }
const DEFAULT_PROJECT = '默认项目';
function ensureSandbox() {
  try {
    if (!fs.existsSync(SANDBOX_ROOT)) fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  } catch (e) {}
}
/* 顶层目录是否「旧扁平原型」：无子目录、但直接含 html/md 文件（旧版沙箱一个原型一个顶层文件夹） */
function isFlatDir(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hasSub = entries.some((d) => d.isDirectory());
    if (hasSub) return false;
    return entries.some((d) => d.isFile() && /\.(html?|md)$/i.test(d.name));
  } catch (e) { return false; }
}
/* 沙箱整理（一次性，写标记防重复）：旧版扁平目录 → 项目结构
   - 所有旧扁平原型统一移入「默认项目」sandbox/默认项目/<名>/ */
const NORMALIZE_FLAG = 'projects-normalized-v1';
function normalizeProjects() {
  try {
    if (fs.existsSync(path.join(app.getPath('userData'), NORMALIZE_FLAG))) return;
    if (!fs.existsSync(SANDBOX_ROOT)) { try { fs.writeFileSync(path.join(app.getPath('userData'), NORMALIZE_FLAG), '1'); } catch (e) {} return; }
    const top = fs.readdirSync(SANDBOX_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^\./.test(d.name));
    let moved = 0;
    for (const d of top) {
      const dir = path.join(SANDBOX_ROOT, d.name);
      if (!isFlatDir(dir)) continue;
      const defProj = path.join(SANDBOX_ROOT, DEFAULT_PROJECT);
      const dst = path.join(defProj, d.name);
      if (fs.existsSync(dst)) continue;
      try { fs.mkdirSync(defProj, { recursive: true }); fs.renameSync(dir, dst); moved++; } catch (e) {}
    }
    try { fs.writeFileSync(path.join(app.getPath('userData'), NORMALIZE_FLAG), '1'); } catch (e) {}
    if (moved) libStatusSafe('已将沙箱整理为项目结构：' + moved + ' 个目录归入项目（旧数据兼容完成）。');
  } catch (e) {}
}
/* 兼容旧版（sbox 在 exe 旁）：检测旧位置存在且新位置仍为空 → 询问迁移
   （需在 ensureSandbox 展开 seed 之前判断，否则 seed 会占用新目录导致误判） */
function migrateLegacySandbox() {
  try {
    /* 用户曾选择「跳过」：写一次性标记，之后不再每次启动询问 */
    const skipFlag = path.join(app.getPath('userData'), 'migrate-legacy-skip');
    if (fs.existsSync(skipFlag)) return;
    const legacy = path.join(path.dirname(app.getPath('exe')), 'sandbox');
    if (!fs.existsSync(legacy)) return;
    const fresh = !fs.existsSync(SANDBOX_ROOT) || fs.readdirSync(SANDBOX_ROOT).length === 0;
    if (!fresh) return;
    /* 旧 ai-config.json（CLI 手动指定等配置）一并迁移 */
    const cfgOld = path.join(path.dirname(app.getPath('exe')), 'ai-config.json');
    const cfgNew = path.join(app.getPath('userData'), 'ai-config.json');
    if (fs.existsSync(cfgOld) && !fs.existsSync(cfgNew)) { try { fs.copyFileSync(cfgOld, cfgNew); } catch (e) {} }
    const r = dialog.showMessageBoxSync({
      type: 'question', buttons: ['迁移', '跳过'], defaultId: 0, cancelId: 1,
      title: '检测到旧版沙箱数据',
      message: '检测到旧版（软件目录内 sandbox）的原型数据，是否迁移到新的用户数据目录？',
      detail: '旧位置：' + legacy + '\n新位置：' + SANDBOX_ROOT + '\n迁移后旧 sandbox 目录可手动删除。'
    });
    if (r === 1) { try { fs.writeFileSync(skipFlag, '1'); } catch (e) {} libStatusSafe('已跳过旧沙箱数据迁移（不再提示）'); return; }
    fs.cpSync(legacy, SANDBOX_ROOT, { recursive: true });
    dialog.showMessageBoxSync({
      type: 'info', buttons: ['知道了'],
      title: '迁移完成',
      message: '旧版沙箱数据已迁移到用户数据目录。',
      detail: '新位置：' + SANDBOX_ROOT + '\n旧位置可手动删除。'
    });
  } catch (e) {}
}
function libStatusSafe(t) { try { console.log('[proto]', t); } catch (e) {} }

/* ═══════ 本地日志：%APPDATA%/原型工具/logs/app-YYYYMMDD.log，启动清理 7 天前旧文件 ═══════ */
function logsDir() { return path.join(app.getPath('userData'), 'logs'); }
function cleanOldLogs() {
  try {
    const dir = logsDir();
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      try {
        const p = path.join(dir, f);
        if (fs.statSync(p).isFile() && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch (e) {}
    }
  } catch (e) {}
}
ipcMain.handle('log:write', (ev, level, tag, msg) => {
  try {
    const dir = logsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    let text = '';
    try { text = String(msg == null ? '' : msg); } catch (e) { text = String(msg); }
    try{ var st=fs.statSync(path.join(dir,'app-'+ymd+'.log')); if(st.size>5*1024*1024) fs.renameSync(path.join(dir,'app-'+ymd+'.log'), path.join(dir,'app-'+ymd+'.1.log')); }catch(e){}
    fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][' + String(level || 'info') + '][' + String(tag || 'app') + '] ' + text + '\n', 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

/* 应用版本号：设置弹窗展示 */
ipcMain.handle('app:get-version', () => { try { return app.getVersion(); } catch (e) { return ''; } });

function sandboxProjects() {
  try {
    if (!fs.existsSync(SANDBOX_ROOT)) return [];
    return fs.readdirSync(SANDBOX_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && !/^\./.test(d.name))
      .map(d => d.name);
  } catch (e) { return []; }
}
/* 项目内原型文件夹名列表 */
function protoFolders(project) {
  try {
    const dir = path.join(SANDBOX_ROOT, project);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !/^\./.test(d.name))
      .map(d => d.name);
  } catch (e) { return []; }
}
/* 项目名清洗：拒绝路径分隔符与非法字符 */
function sanitizeProjectName(raw) {
  const nm = String(raw || '').trim();
  if (!nm) return null;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(nm) || nm.includes('..') || nm.length > 60) return null; // P0-4 fix 正则第三段移入[]并单判..
  return nm;
}
/* 目录内选 html / md：优先与目录同名，其次按名称排序取第一个 */
function pickInDir(dir, ext, prefer) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(ext)).sort();
    if (!files.length) return null;
    if (prefer) { const exact = files.find(f => path.parse(f).name === prefer); if (exact) return exact; }
    return files[0];
  } catch (e) { return null; }
}

/* 列出沙箱原型：project 指定时只返回该项目内原型（前端单项目加载）；
   缺省遍历全部项目（向后兼容）。返回 { root, project, projects, folders }，item 带 project 归属与多 HTML 子页面列表 */
ipcMain.handle('sandbox:list', async (ev, projectName) => {
  const project = String(projectName || '').trim();
  const projects = sandboxProjects();
  const nameList = project ? [project] : projects;
  const grouped = await Promise.all(nameList.map(async (proj) => {
    const dirs = protoFolders(proj);
    return Promise.all(dirs.map(async (name) => {
      const dir = path.join(SANDBOX_ROOT, proj, name);
      let allHtmlFiles = [];
      try {
        allHtmlFiles = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.html')).sort();
      } catch (e) {}
      const htmlFile = pickInDir(dir, '.html', name);
      const mdFile = pickInDir(dir, '.md', name);
      const subPages = allHtmlFiles
        .filter(f => f !== htmlFile)
        .map(f => ({ file: f, name: path.parse(f).name }));

      const item = {
        name,
        project: proj,
        root: SANDBOX_ROOT,
        dir,
        htmlFile: null,
        html: null,
        mdFile: null,
        md: null,
        subPages: subPages,
        htmlFiles: allHtmlFiles
      };
      if (htmlFile) {
        try { item.htmlFile = htmlFile; item.html = await fs.promises.readFile(path.join(dir, htmlFile), 'utf8'); } catch (e) {}
      }
      if (mdFile) {
        try { item.mdFile = mdFile; item.md = await fs.promises.readFile(path.join(dir, mdFile), 'utf8'); } catch (e) {}
      }
      return item;
    }));
  }));
  const folders = [];
  grouped.forEach((arr) => { arr.forEach((it) => folders.push(it)); });
  return { root: SANDBOX_ROOT, project: project || '', projects, folders };
});

ipcMain.handle('sandbox:write', (ev, o) => {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const file = String(o2.file || '').replace(/\\/g, '/');
  if (!file || file.includes('..') || file.includes('/')) return { ok: false, error: '非法文件名' };
  if (!isSubPath(dir, SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), String(o2.content == null ? '' : o2.content), 'utf8');
    return { ok: true, path: path.join(dir, file) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

ipcMain.handle('sandbox:read-file', async (ev, o) => {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const file = String(o2.file || '').replace(/\\/g, '/');
  if (!file || file.includes('..')) return { ok: false, error: '非法文件名' };
  if (!isSubPath(dir, SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };
    const content = await fs.promises.readFile(p, 'utf8');
    return { ok: true, content, file, path: p };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* 新建子页面：在已有沙箱目录下新建独立 HTML */
ipcMain.handle('sandbox:create-subpage', async (ev, o) => {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const subName = sanitizeProtoName(o2.name);
  if (!subName) return { ok: false, error: '子页面名称不能为空' };
  if (!isSubPath(dir, SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  const fileName = subName + '.html';
  const targetPath = path.join(dir, fileName);
  if (fs.existsSync(targetPath)) return { ok: false, error: '同名子页面已存在' };
  const kind = o2.kind === 'pc' ? 'pc' : 'mobile';
  const vp = kind === 'mobile' ? '<meta name="viewport" content="width=device-width, initial-scale=1">\n' : '';
  const shell = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
    + vp
    + '<title>' + subName + '</title>\n'
    + '<style>body{margin:1.5rem;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#333;line-height:1.7}'
    + 'h1{font-size:1.15rem}</style>\n</head>\n<body>\n'
    + '<h1>' + subName + '（子页面）</h1>\n'
    + '<p>空白子页面。可通过相对路径由主页跳转至此，或在此页面直接唤起 AI 进行设计。</p>\n'
    + '</body>\n</html>\n';
  try {
    fs.writeFileSync(targetPath, shell, 'utf8');
    return { ok: true, file: fileName, name: subName, path: targetPath };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* 删除子页面 */
ipcMain.handle('sandbox:delete-subpage', async (ev, o) => {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const file = String(o2.file || '');
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return { ok: false, error: '非法文件名' };
  if (!isSubPath(dir, SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  const targetPath = path.join(dir, file);
  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* 重命名子页面 */
ipcMain.handle('sandbox:rename-subpage', async (ev, o) => {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const oldFile = String(o2.oldFile || '');
  const newName = sanitizeProtoName(o2.newName);
  if (!oldFile || oldFile.includes('..') || oldFile.includes('/') || oldFile.includes('\\')) return { ok: false, error: '非法原文件名' };
  if (!newName) return { ok: false, error: '新名称不能为空或包含非法字符' };
  if (!isSubPath(dir, SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  const oldPath = path.join(dir, oldFile);
  const newFile = newName + '.html';
  const newPath = path.join(dir, newFile);
  if (!fs.existsSync(oldPath)) return { ok: false, error: '原文件不存在' };
  if (oldFile.toLowerCase() !== newFile.toLowerCase() && fs.existsSync(newPath)) return { ok: false, error: '同名子页面已存在' };
  try {
    fs.renameSync(oldPath, newPath);
    return { ok: true, oldFile, newFile, name: newName, path: newPath };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* 名称清洗：去路径分隔与非法字符，仅保留适合做文件夹名的字符 */
/* 名称清洗：拒绝路径分隔符与非法字符，避免越出沙箱或写入异常文件 */
function sanitizeProtoName(raw) {
  const nm = String(raw || '').trim().replace(/\.(html?|md)$/i, '');
  if (!nm) return null;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(nm) || nm.includes('..') || nm.length > 60) return null; // P0-4 fix 正则第三段移入[]并单判..
  return nm;
}

/* 新建原型：sandbox/<项目>/<名称>/ 下放空壳 html + 同名 md；
   project 缺省时落在「默认项目」；kind: 'pc' | 'mobile' 决定空壳 html 是否带移动视口 */
ipcMain.handle('sandbox:create', (ev, o) => {
  const name = sanitizeProtoName((o || {}).name);
  if (!name) return { ok: false, error: '名称不能为空或包含非法字符' };
  const kind = (o || {}).kind === 'pc' ? 'pc' : 'mobile';
  const project = sanitizeProjectName((o || {}).project) || DEFAULT_PROJECT;
  const dir = path.join(SANDBOX_ROOT, project, name);
  try {
    if (fs.existsSync(dir)) return { ok: false, error: '同名原型已存在', dir };
    fs.mkdirSync(dir, { recursive: true });
    const vp = kind === 'mobile'
      ? '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      : '';
    const shell = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
      + vp
      + '<title>' + name + '</title>\n'
      + '<style>body{margin:2rem;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#333;line-height:1.7}'
      + 'h1{font-size:1.15rem}</style>\n</head>\n<body>\n'
      + '<h1>' + name + ' · 新建原型（' + (kind === 'pc' ? 'PC 端' : '移动端') + '）</h1>\n'
      + '<p>空白原型。已打开大模型对话，工作目录即本文件夹；由 AI 在此生成页面与《' + name + '》文档。</p>\n'
      + '</body>\n</html>\n';
    fs.writeFileSync(path.join(dir, name + '.html'), shell, 'utf8');
    fs.writeFileSync(path.join(dir, name + '.md'), '# ' + name + '\n\n（新建说明，可让大模型按此文件夹生成《' + name + '》文档。）\n', 'utf8');
    return { ok: true, name, project, dir, htmlFile: name + '.html', mdFile: name + '.md', kind };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), dir };
  }
});

/* 从起始位置（指向 '['）提取完整 JSON 数组文本：跳过字符串内转义与嵌套括号 */
function extractJsonArray(s, startIdx) {
  let i = startIdx, depth = 0, inStr = false, esc = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
    else {
      if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) return s.slice(startIdx, i + 1); }
    }
  }
  return null;
}
/* 识别本工具导出的单文件 HTML（含 __EXPORT_BOOT__ 标记与内嵌原型库）并拆解：
   返回 [{ name, displayName, kind, html(原型), md(文档, 由各页文档合并) }]，非导出文件返回 null */
/* 受限解析器：仅从「无引号 key + 双引号字符串值」的 JS 对象数组文本中提取
    name / content / kind / displayName 四个字段的字符串字面量（处理 \" \\ 转义），
    不执行任何代码；其余字段忽略；解析失败返回 null */
// @deprecated 旧导出兼容 懒加载 - parseExportArrLoose 仅在 extractExportedProtos JSON.parse 失败时调用，避免常驻解析开销
function parseExportArrLoose(text) {
  try {
    const re = /\{\s*("?name"?|"?content"?|"?kind"?|"?displayName"?)\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}]/g;
    const raw = [];
    let m;
    while ((m = re.exec(text))) raw.push([m[1].replace(/["]/g, ''), m[2]]);
    if (!raw.length) return null;
    const objs = [];
    let cur = {};
    raw.forEach(([key, val]) => {
      if (key === 'name' && cur.name !== undefined) { if (cur.content !== undefined) objs.push(cur); cur = {}; }
      cur[key] = parseLooseStr(val);
    });
    if (cur.content !== undefined) objs.push(cur);
    if (!objs.length) return null;
    return objs;
  } catch (e) { return null; }
}
function parseLooseStr(s) {
  /* 解码 JS 字符串字面量转义（\" → "，\\ → \，\n \t，\uXXXX）；非法转义原样保留 */
  try { return JSON.parse('"' + s + '"'); } catch (e) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch !== '\\') { out += ch; continue; }
      const n = s[++i];
      if (n === '"') out += '"';
      else if (n === '\\') out += '\\';
      else if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 1, i + 5))) {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4;
      } else { out += n; }
    }
    return out;
  }
}
function extractExportedProtos(content) {
  try {
    const s = String(content || '');
    if (s.indexOf('__EXPORT_BOOT__') < 0 || s.indexOf('protoLib_sources_v1') < 0) return null;
    const ai = s.indexOf('var arr=');
    if (ai < 0) return null;
    const arrText = extractJsonArray(s, ai + 'var arr='.length);
    if (!arrText) return null;
    /* 只接受 JSON 数组；旧格式（无引号 key 的 JS 字面量）用受限解析器兜底，
       不执行任何代码（导入文件完全用户可控，禁止 eval / new Function） */
    let arr = null;
    try { arr = JSON.parse(arrText); } catch (e) { arr = parseExportArrLoose(arrText); /* 旧导出兼容 懒加载 */ }
    if (!arr) return null;
    if (!Array.isArray(arr) || !arr.length) return null;
    /* 解析 boot 中的 __EXPORT_LINKS__（失败静默＝退化为无链接） */
    let exportLinks = null;
    try {
      const li = s.indexOf('window.__EXPORT_LINKS__=');
      if (li >= 0) {
        const lt = extractJsonArray(s, li + 'window.__EXPORT_LINKS__='.length);
        if (lt) { const pl = JSON.parse(lt); if (Array.isArray(pl)) exportLinks = pl; }
      }
    } catch (e) {}
    return arr.map((em) => {
      const html = String(em.content || '').replace(/<\\\/script/g, '</script'); /* 还原导出时对 </script 的转义 */
      const name = String(em.name || '').replace(/\.(html?)$/i, '');
      const title = String(em.displayName || name).replace(/\.(html?)$/i, '');
      let md = '';

      if (em.md && typeof em.md === 'string') {
        md = em.md;
      } else if (em.docs && typeof em.docs === 'object' && Object.keys(em.docs).length) {
        const parts = ['# ' + title];
        Object.keys(em.docs).forEach((k) => { parts.push('## ' + k + '\n\n' + String(em.docs[k] || '')); });
        md = parts.join('\n\n') + '\n';
      } else {
        const docs = {};
        const key = 'localStorage.setItem("protoDoc_v2_' + String(em.name) + '_' + (em.kind || 'mobile') + '","';
        const di = s.indexOf(key);
        if (di >= 0) {
          const rest = s.slice(di + key.length);
          const de = rest.indexOf('");');
          if (de > 0) {
            try { Object.assign(docs, JSON.parse(JSON.parse('"' + rest.slice(0, de) + '"'))); } catch (e) {}
          }
        }
        const ks = Object.keys(docs);
        if (!ks.length) { md = '# ' + title + '\n\n（该原型没有附带功能说明文档。）\n'; }
        else {
          const parts = ['# ' + title];
          ks.forEach((k) => { parts.push('## ' + k + '\n\n' + String(docs[k] || '')); });
          md = parts.join('\n\n') + '\n';
        }
      }
      /* 匹配该原型的 links 数据 */
      let links = [];
      if (exportLinks) {
        for (let i = 0; i < exportLinks.length; i++) {
          const el = exportLinks[i];
          if (el && (el.displayName === title || el.name === em.name)) {
            links = el.links || [];
            break;
          }
        }
      }
      return { name, displayName: title, kind: em.kind || 'mobile', html, md, links };
    });
  } catch (e) { return null; }
}

/* 导入外部原型至沙箱：sandbox/<项目>/<名称>/ 下放 html（源目录同名 md 一并复制）；
   导入成功后后续都从沙箱副本打开（原型文件进沙箱、AI 生成也写入沙箱）。
   若导入的是本工具导出的单文件 HTML：自动拆分为 原型 html + 文档 md，
   多原型导出则每个原型拆成一个独立沙箱文件夹（一文件夹一原型），均归入指定项目。
   project 缺省时落在「默认项目」。 */
ipcMain.handle('sandbox:adopt', (ev, o) => {
  const o2 = o || {};
  const rawName = String(o2.name || '').trim();
  const srcPath = String(o2.srcPath || '');
  const fallbackName = srcPath ? path.basename(srcPath).replace(/\.(html?|md)$/i, '') : '';
  const name = sanitizeProtoName(rawName || fallbackName);
  if (!name) return { ok: false, error: '名称不能为空或包含非法字符' };
  const project = sanitizeProjectName(o2.project) || DEFAULT_PROJECT;
  let content = String(o2.content == null ? '' : o2.content);
  if(content.length>2_000_000) return {ok:false,error:'文件过大'}; // P1-1 fix 限大小防 DoS
  // P1-1 fix 简易净化：移除 on* 事件属性与 javascript: 伪协议，保留 </script 转义由后续 wrap 负责
  try{ content = content.replace(/\son\w+\s*=/gi,' ').replace(/[jJ]avascript\s*:/g,''); }catch(e){}
  const exported = extractExportedProtos(content);
  if (exported) {
    /* 导出文件拆分：每个原型独立文件夹（原型 html + 同名 md），全部归入指定项目 */
    const created = [];
    exported.forEach((em) => {
      if (!em.html) return;
      const nm = sanitizeProtoName(em.displayName || em.name);
      if (!nm || !em.html) return;
      const dir2 = path.join(SANDBOX_ROOT, project, nm);
      if (fs.existsSync(dir2)) return;
      try {
        fs.mkdirSync(dir2, { recursive: true });
        fs.writeFileSync(path.join(dir2, nm + '.html'), em.html, 'utf8');
        fs.writeFileSync(path.join(dir2, nm + '.md'), em.md, 'utf8');
        /* 写入 links.json（如有链接数据） */
        if (em.links && em.links.length) {
          try { fs.writeFileSync(path.join(dir2, 'links.json'), JSON.stringify({ version: 1, links: em.links }, null, 2), 'utf8'); } catch (e) {}
        }
        created.push(nm);
      } catch (e) {}
    });
    if (!created.length) return { ok: false, error: '未能从导出文件拆分出原型（文件夹可能已存在）' };
    return { ok: true, name: created[0], project, split: true, created };
  }
  const dir = path.join(SANDBOX_ROOT, project, name);
  try {
    if (fs.existsSync(dir)) return { ok: false, error: '同名原型已存在：' + name, dir };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.html'), content, 'utf8'); // P1-1 fix 使用净化后 content
    /* 源目录存在同名 .md 时一并复制进沙箱（文档与原型同放一文件夹） */
    let mdFile = null;
    if (srcPath) {
      const srcDir = path.dirname(srcPath);
      const srcBase = path.parse(srcPath).name;
      const srcMd = path.join(srcDir, srcBase + '.md');
      try { if (fs.existsSync(srcMd)) { fs.copyFileSync(srcMd, path.join(dir, name + '.md')); mdFile = name + '.md'; } } catch (e) {}
    }
    return { ok: true, name, project, dir, htmlFile: name + '.html', mdFile };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), dir };
  }
});

/* 重命名原型：文件夹与其中同名的 html/md 一起改名；kind 保持 */
ipcMain.handle('sandbox:rename', (ev, o) => {
  const o2 = o || {};
  const newName = sanitizeProtoName(o2.name);
  if (!newName) return { ok: false, error: '名称不能为空或包含非法字符' };
  const oldDir = path.normalize(String(o2.dir || ''));
  if (!isSubPath(oldDir, SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  const parentDir = path.dirname(oldDir);
  const rootNorm = path.normalize(SANDBOX_ROOT); // P0-4 fix 补 rootNorm 定义，避免 ReferenceError
  if (parentDir === rootNorm) return { ok: false, error: '不可重命名顶级项目根目录' };
  const oldName = path.basename(oldDir);
  if (oldName === newName) return { ok: true, dir: oldDir, name: oldName };
  const newFolder = path.join(parentDir, newName);
  try {
    if (fs.existsSync(newFolder)) return { ok: false, error: '同名原型已存在', dir: oldDir };
    fs.renameSync(oldDir, newFolder);
    /* 同步文件夹内与旧名同名的 html/md 文件 */
    for (const ext of ['.html', '.md']) {
      const oldF = path.join(newFolder, oldName + ext);
      const newF = path.join(newFolder, newName + ext);
      try { if (fs.existsSync(oldF)) fs.renameSync(oldF, newF); } catch (e) {}
    }
    return { ok: true, dir: newFolder, name: newName };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* 删除沙箱原型：整文件夹删除（不可恢复）；仅允许删除项目内的原型二级目录，且不能是项目根本身 */
ipcMain.handle('sandbox:remove', (ev, o) => {
  const rootNorm = path.normalize(SANDBOX_ROOT);
  const dir = path.normalize(String((o || {}).dir || ''));
  if (!isSubPath(dir, SANDBOX_ROOT) || dir === rootNorm) return { ok: false, error: '目录不在沙箱范围内' };
  const rel = path.relative(rootNorm, dir);
  const segments = rel.split(path.sep);
  if (segments.length !== 2) {
    return { ok: false, error: '非法删除操作：只能删除项目内的原型文件夹' };
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* ═══════ 项目级操作：沙箱根下第一层文件夹 = 项目 ═══════ */
ipcMain.handle('sandbox:projects', () => {
  const projects = sandboxProjects().map((name) => {
    let protoCount = 0;
    try { protoCount = protoFolders(name).length; } catch (e) {}
    return { name, protoCount };
  });
  return { root: SANDBOX_ROOT, projects };
});
ipcMain.handle('project:create', (ev, o) => {
  const name = sanitizeProjectName((o || {}).name);
  if (!name) return { ok: false, error: '项目名称不能为空或包含非法字符' };
  const dir = path.join(SANDBOX_ROOT, name);
  try {
    if (fs.existsSync(dir)) return { ok: false, error: '同名项目已存在', dir };
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, name, dir };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), dir };
  }
});
ipcMain.handle('project:rename', (ev, o) => {
  const newName = sanitizeProjectName((o || {}).name);
  if (!newName) return { ok: false, error: '项目名称不能为空或包含非法字符' };
  const oldName = sanitizeProjectName((o || {}).oldName);
  if (!oldName) return { ok: false, error: '缺少原项目名称' };
  const oldDir = path.join(SANDBOX_ROOT, oldName);
  const newFolder = path.join(SANDBOX_ROOT, newName);
  if (oldName === newName) return { ok: true, dir: oldDir, name: oldName };
  try {
    if (fs.existsSync(newFolder)) return { ok: false, error: '同名项目已存在', dir: oldDir };
    if (!fs.existsSync(oldDir)) return { ok: false, error: '原项目不存在', dir: oldDir };
    fs.renameSync(oldDir, newFolder);
    return { ok: true, dir: newFolder, name: newName };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});
ipcMain.handle('project:remove', (ev, o) => {
  const name = sanitizeProjectName((o || {}).name);
  if (!name) return { ok: false, error: '项目名称不能为空或包含非法字符' };
  if (name === DEFAULT_PROJECT) return { ok: false, error: '「默认项目」为旧数据归拢目录，不可删除' };
  const dir = path.join(SANDBOX_ROOT, name);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* ═══════ 渲染进程请求选择文本文件（原型 html / md），默认定位到软件包目录 ═══════ */
ipcMain.handle('pick-text-file', async (event, opts) => {
  const win = BrowserWindow.getFocusedWindow();
  const o = opts || {};
  const r = await dialog.showOpenDialog(win, {
    defaultPath: pkgDir,
    title: o.title || '选择文件',
    filters: o.filters || [{ name: 'HTML 原型', extensions: ['html', 'htm'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  const name = path.basename(p);
  try {
    return { path: p, name, content: fs.readFileSync(p, 'utf8') };
  } catch (err) {
    return { path: p, name, content: null, error: String(err && err.message || err) };
  }
});

/* ════════════════════════════════════════════════════════════
   opencode CLI 集成
   - 发现顺序：设置中手动指定的路径 → npm 全局(node_modules 内 exe)
     → ~/.opencode/bin → scoop shims → Chocolatey → PATH(where)
   - 「安装到其他电脑也能找到」由该多路径发现 + 设置可手动指定保证
   ════════════════════════════════════════════════════════════ */
const aiCfgFile = () => path.join(app.getPath('userData'), 'ai-config.json');
function defaultAiCfg() {
  return {
    cliPath: '',
    engine: 'cli', // 'cli' | 'api'
    api: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      customModels: ['deepseek-chat', 'deepseek-reasoner'],
      enableTools: true
    },
    visibleModels: [],
    visibleModelsCli: null,
    visibleModelsApi: null
  };
}
function loadAiCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(aiCfgFile(), 'utf8'));
    const def = defaultAiCfg();
    const res = Object.assign(def, raw, { api: Object.assign(def.api, raw && raw.api) });
    if (raw && Array.isArray(raw.visibleModelsCli)) res.visibleModelsCli = raw.visibleModelsCli;
    if (raw && Array.isArray(raw.visibleModelsApi)) res.visibleModelsApi = raw.visibleModelsApi;
    return res;
  } catch (e) {
    return defaultAiCfg();
  }
}
function saveAiCfg(c) { try { fs.writeFileSync(aiCfgFile(), JSON.stringify(c, null, 2)); } catch (e) {} }

/* .cmd/.bat 包装脚本 -> 解析出真实可执行文件（如 npm 的 opencode.cmd -> opencode.exe） */
function shimToExe(p) {
  try {
    const t = fs.readFileSync(p, 'utf8').slice(0, 8192);
    let m = t.match(/"([^"]+\.exe)"/i);
    if (!m) m = t.match(/([A-Za-z]:[\\/][^)\r\n]*\.exe)/i);
    if (!m) return null;
    let cand = m[1].replace(/%~?dp0%[\\/]?/gi, '');
    if (!path.isAbsolute(cand)) cand = path.resolve(path.dirname(p), cand);
    if (fs.existsSync(cand) && isValidExe(cand)) return cand;
  } catch (e) {}
  return null;
}

function candidateList() {
  const c = loadAiCfg();
  const list = [];
  if (c.cliPath) list.push(c.cliPath);
  list.push(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  list.push(path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'));
  list.push(path.join(process.env.USERPROFILE || '', '.opencode', 'bin', 'opencode.exe'));
  list.push(path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'opencode.exe'));
  list.push('C:\\ProgramData\\chocolatey\\bin\\opencode.exe');
  list.push('opencode'); /* PATH 兜底 */
  return list;
}

// @deprecated 同步阻塞，F03 async 改用 resolveCliAsync + Promise.race 3s 超时
function resolveCli() {
  for (const p of candidateList()) {
    try {
      if (p === 'opencode') {
        const r = spawnSync('where', ['opencode'], { encoding: 'utf8' });
        if (r.status === 0 && r.stdout) {
          const lines = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          for (const line of lines) {
            if (/\.exe$/i.test(line) && isValidExe(line)) return line;
            if (/\.(cmd|bat)$/i.test(line)) {
              const exe = shimToExe(line);
              if (exe) return exe;
              return line;
            }
          }
        }
        continue;
      }
      if (fs.existsSync(p)) {
        if (/\.(cmd|bat)$/i.test(p)) { const e = shimToExe(p); return e || p; }
        if (!isValidExe(p)) continue; /* 跳过损坏/无效的 exe（如 postinstall 未跑的占位脚本） */
        return p;
      }
    } catch (e) {}
  }
  return null;
}

// F03 async: 异步解析 CLI 路径，避免 spawnSync(where) 阻塞主进程（ai:check 场景）
async function resolveCliAsync() {
  for (const p of candidateList()) {
    try {
      if (p === 'opencode') {
        try {
          const r = await Promise.race([ // P1-4 fix F03 async 超时保护 3000ms
            runCliAsync('where', ['opencode'], 10000),
            new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] where timeout 3000ms'); }catch(e){} res(null); }, 3000))
          ]);
          if (r && r.status === 0 && r.stdout) {
            const lines = String(r.stdout).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            for (const line of lines) {
              if (/\.exe$/i.test(line) && isValidExe(line)) return line;
              if (/\.(cmd|bat)$/i.test(line)) {
                const exe = shimToExe(line);
                if (exe) return exe;
                return line;
              }
            }
          }
        } catch (e) {}
        continue;
      }
      if (fs.existsSync(p)) {
        if (/\.(cmd|bat)$/i.test(p)) { const e = shimToExe(p); return e || p; }
        if (!isValidExe(p)) continue;
        return p;
      }
    } catch (e) {}
  }
  return null;
}

/* PE 有效性检查：前 2 字节必须为 MZ，防止命中 npm 静默升级失败留下的占位脚本 */
function isValidExe(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; /* 'MZ' */
  } catch (e) { return false; }
}

/* CLI 版本检测缓存：同一 exe 只检测一次（F03 async 改造为 Promise 缓存，避免 spawnSync --version 并发阻塞）
   手动更换 CLI 路径后（ai:set-path / ai:pick）需清空缓存重新检测 */
let cliVerCache = { exe: null, version: null, promise: null };

/* ═══════ 「最新需求」文档：每个沙箱目录一个（sandbox/<原型文件夹>/最新需求.md），跟随原型；
   目录无效/沙箱外时回退工具级 %APPDATA%/原型工具/最新需求.md ═══════ */
const REQ_FALLBACK_FILE = path.join(app.getPath('userData'), '最新需求.md');
function reqFileFor(dir) {
  try {
    const d = String(dir || '');
    if (d) {
      const dn = path.normalize(d);
      const rootNorm = path.normalize(SANDBOX_ROOT);
      if (dn === rootNorm || dn.startsWith(rootNorm + path.sep)) return path.join(dn, '最新需求.md');
    }
  } catch (e) {}
  return REQ_FALLBACK_FILE; /* 无有效沙箱目录：回退工具级 */
}
ipcMain.handle('doc:read-latest', (ev, dir) => {
  const f = reqFileFor(dir);
  try {
    if (!fs.existsSync(f)) return { ok: true, content: '# 最新需求\n\n（在此编写当前迭代的需求。）\n' };
    return { ok: true, content: fs.readFileSync(f, 'utf8') };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('doc:write-latest', (ev, dir, content) => {
  const f = reqFileFor(dir);
  try {
    fs.writeFileSync(f, String(content == null ? '' : content), 'utf8');
    return { ok: true, path: f };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
// @deprecated 同步阻塞，F03 async 改用 cliVersionAsync + Promise.race 3s 超时
function cliVersion(exe) {
  if (!exe) return null;
  if (cliVerCache.exe === exe && cliVerCache.version) return cliVerCache.version;
  let v = null;
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (r.status === 0 && r.stdout) v = String(r.stdout).trim().split(/\r?\n/)[0];
  } catch (e) {}
  cliVerCache = { exe, version: v, promise: cliVerCache.promise };
  return v;
}

// F03 async: 异步版本检测，使用 runCliAsync 替代 spawnSync(--version)，Promise 缓存避免并发阻塞
async function cliVersionAsync(exe) {
  if (!exe) return null;
  if (cliVerCache.exe === exe && cliVerCache.promise) return cliVerCache.promise;
  const p = (async () => {
    try {
      const r = await Promise.race([ // P1-4 fix F03 async 超时保护 3000ms
        runCliAsync(exe, ['--version'], 10000),
        new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] cliVersion timeout 3000ms'); }catch(e){} res(null); }, 3000))
      ]);
      if (r.status === 0 && r.stdout) return String(r.stdout).trim().split(/\r?\n/)[0];
      return null;
    } catch (e) { return null; }
  })();
  cliVerCache = { exe, promise: p, version: cliVerCache.version };
  const v = await p;
  cliVerCache.version = v;
  return v;
}
// F03 async TODO: 上述 Promise 缓存确保 ai:check 不阻塞主进程

let aiChild = null;
let aiCancelRequested = false;

/* 隔离配置：禁用全部第三方 MCP 与插件，避免模型擅自联网查企查查/天眼查等，
   答非所问或与沙箱外内容混杂；工具版 AI 只保留 opencode 本体内置工具命中。 */
const AI_ISOLATE_MCPS = ['browsermcp', 'caihui_mcp', 'tyc-mcp', 'bing-search', 'metaso-mcp', 'qcc-document', 'qcc-document-mcp'];
const AI_ISOLATE_FILE = path.join(app.getPath('userData'), 'ai-opencode-isolate.json');
function ensureAiIsolateFile() {
  try {
    const mcp = {};
    for (const k of AI_ISOLATE_MCPS) mcp[k] = { enabled: false };
    fs.writeFileSync(AI_ISOLATE_FILE, JSON.stringify({ mcp, plugin: [] }, null, 2), 'utf8');
  } catch (e) {}
  return AI_ISOLATE_FILE;
}

/* ═══════ 工具内置提示词：随包分发（toolPrompt.md），每次 AI 对话自动前置。
   要求模型生成原型 html 与文档 md 时写入「原型绑定」注释，保证点击交互后文档定位联动 ═══════ */
const TOOL_PROMPT = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'toolPrompt.md'), 'utf8'); } catch (e) { return ''; }
})();
function withToolPrompt(p, isApi) {
  const t = String(p || '');
  if (!TOOL_PROMPT) return t;
  if (isApi === false) return t;
  return TOOL_PROMPT + '\n\n【本次用户需求】\n' + t;
}

/* 启动一次 opencode run：onStart 成功启动、onReasoning 流式思考、onChunk 流式回答、
   onError 失败、onClose 结束、onSession 回传 opencode 会话 ID；cwd=沙箱目录（模型创建
   html/md 即在当前原型文件夹内）
   --format json：每行一个 JSON 事件（reasoning=思考块 / text=回答），便于区分流式输出
   sessionId：非空时追加 --session <id> 续接该会话，使模型保留前文记忆 */
function startAiRun(exe, model, handlers, cwd, sessionId, prompt) {
  const isCmdShim = /\.(cmd|bat)$/i.test(exe);
  /* 默认推理档位：--variant default（快速响应，不做 high/max 深度推理）；--thinking 显示思考块 */
  const args = ['run', '--format', 'json', '--thinking', '--variant', 'default'];
  if (model) args.push('-m', model);
  const sid = String(sessionId || '').trim();
  if (sid) { args.push('--session', sid); }
  args.push(String(prompt));
  const env = Object.assign({}, process.env, {
    OPENCODE_CONFIG: ensureAiIsolateFile(),
    NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'
  });
  const base = { cwd: (cwd && fs.existsSync(cwd)) ? cwd : undefined, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env };
  let child;
  try {
    if (isCmdShim) {
      child = spawn(exe, args, Object.assign({}, base, { shell: true }));
    } else {
      child = spawn(exe, args, base);
    }
  } catch (e) {
    handlers.onError(e);
    return;
  }
  aiChild = child;
  handlers.onStart();
  let gotChunk = false;
  let gotError = false;
  let errorMsg = '';
  let errBuf = '';
  let jsonBuf = '';
  const emitJsonLine = (line) => {
    if (!line.trim()) return;
    let ev = null;
    try { ev = JSON.parse(line); } catch (e) {}
    if (ev && ev.sessionID && handlers.onSession) handlers.onSession(ev.sessionID);
    if (ev && ev.type === 'error') {
      gotError = true;
      errorMsg = (ev.error && (ev.error.data && ev.error.data.message || ev.error.message || ev.error.name)) || (ev.message) || JSON.stringify(ev);
      if (/certificate verification error/i.test(errorMsg)) {
        errorMsg += '（SSL证书校验失败，通常由系统代理/VPN抓包工具引起，请检查网络代理设置）';
      }
      return;
    }
    if (ev && ev.type === 'reasoning' && ev.part && typeof ev.part.text === 'string') {
      handlers.onReasoning(ev.part.text);
    } else if (ev && ev.type === 'text' && ev.part && typeof ev.part.text === 'string') {
      gotChunk = true;
      handlers.onChunk(ev.part.text);
    } else if (!ev) {
      gotChunk = true; /* 非 JSON 输出（旧格式回退）：原样流式显示 */
      handlers.onChunk(line + '\n');
    }
  };
  child.stdout.on('data', (b) => {
    jsonBuf += Buffer.from(b).toString('utf8');
    let nl;
    while ((nl = jsonBuf.indexOf('\n')) >= 0) {
      const line = jsonBuf.slice(0, nl); jsonBuf = jsonBuf.slice(nl + 1);
      emitJsonLine(line);
    }
  });
  child.stderr.on('data', (b) => { /* 流式期间忽略；进程异常退出时作为错误来源 */ errBuf += Buffer.from(b).toString('utf8'); if (errBuf.length > 8192) errBuf = errBuf.slice(-8192); });
  child.on('error', (e) => { aiChild = null; handlers.onError(new Error('CLI 启动失败：' + (e.message || e))); });
  child.on('close', (code) => {
    aiChild = null;
    if (jsonBuf.trim()) emitJsonLine(jsonBuf.trim()); /* 处理末尾无换行的残余行 */
    if (aiCancelRequested) { aiCancelRequested = false; handlers.onClose(); return; }
    if (gotError && errorMsg) { handlers.onError(new Error(errorMsg)); return; }
    if (gotChunk) { handlers.onClose(); return; }
    const msg = extractCliError(errBuf, code);
    if (msg) handlers.onError(new Error(msg));
    else if (code !== 0) handlers.onError(new Error('CLI 异常退出（退出码 ' + code + '）'));
    else handlers.onClose();
  });
}

/* 从进程退出时的 stderr 中提取可读错误（去掉 ANSI 转义与前后噪音） */
function extractCliError(buf, code) {
  if (!buf) return null;
  let t = buf.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const i = t.indexOf('Error:');
  if (i >= 0) t = t.slice(i + 6).trim();
  t = t.split(/\r?\n/).slice(0, 4).join(' ');
  t = t.replace(/^\{\s*/,'').replace(/\s*\}$/,'');
  t = t.replace(/^"name":\s*"(\w+)"/, '$1');
  if (!t) return null;
  const prefix = code === 0 ? '回答为空' : '调用失败（退出码 ' + code + '）';
  return prefix + '：' + t.slice(0, 400) + '（若为模型服务错误，请稍后重试或检查网络）';
}

/* 计算 opencode 实际工作目录：sandboxDir 必须位于沙箱根内，否则回退沙箱根，
   保证 AI 运行始终限定在本地沙箱，不会越权读写沙箱外路径 */
function aiWorkDir(sandboxDir) {
  const rootNorm = path.normalize(SANDBOX_ROOT);
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
const SNAP_KEEP = 10;
function fmtTs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
/* 目录必须是沙箱内的真实原型目录（非沙箱根本身），否则返回 null */
function validProtoDir(dir) {
  try {
    const rootNorm = path.normalize(SANDBOX_ROOT);
    const dn = path.normalize(String(dir || ''));
    if (!dn.startsWith(rootNorm + path.sep)) return null;
    if (dn === rootNorm) return null;
    if (!fs.existsSync(dn)) return null;
    return dn;
  } catch (e) { return null; }
}
function snapRootFor(dir) {
  const rootNorm = path.normalize(SANDBOX_ROOT);
  const dn = path.normalize(String(dir || ''));
  if (!dn.startsWith(rootNorm + path.sep)) return null;
  const rel = dn.slice(rootNorm.length + 1); /* <项目>\<原型> */
  return path.join(app.getPath('userData'), 'snapshots', rel);
}
function listSnapshotDirs(snapRoot) {
  try {
    if (!fs.existsSync(snapRoot)) return [];
    return fs.readdirSync(snapRoot)
      .map((n) => ({ name: n, dir: path.join(snapRoot, n), isDir: fs.statSync(path.join(snapRoot, n)).isDirectory() }))
      .filter((x) => x.isDir)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) { return []; }
}
function pruneSnapshots(snapRoot) {
  try {
    const all = listSnapshotDirs(snapRoot).filter(x=>/^\d{8}-\d{6}$/.test(x.name));
    while (all.length > SNAP_KEEP) {
      const old = all.shift();
      try { fs.rmSync(old.dir, { recursive: true, force: true }); } catch (e) {}
    }
  } catch (e) {}
}
function takeSnapshot(dir) {
  try {
    const dn = validProtoDir(dir);
    if (!dn) return null;
    const root = snapRootFor(dn);
    if (!root) return null;
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const dst = path.join(root, fmtTs(new Date()));
    fs.cpSync(dn, dst, { recursive: true });
    pruneSnapshots(root);
    return dst;
  } catch (e) {
    libStatusSafe('AI 任务前快照失败：' + (e && e.message || e));
    return null;
  }
}
ipcMain.handle('snapshot:list', (ev, dir) => {
  const dn = validProtoDir(dir);
  if (!dn) return { ok: true, items: [] };
  const root = snapRootFor(dn);
  /* 只展示正式任务快照（数字时间戳）；undo- 前缀为恢复前状态备份，不在列表展示但参与保留数清理 */
  const items = listSnapshotDirs(root)
    .filter((x) => /^\d{8}-\d{6}$/.test(x.name))
    .map((x) => ({ ts: x.name }))
    .reverse();
  return { ok: true, items };
});
ipcMain.handle('snapshot:restore', (ev, o) => {
  const o2 = o || {};
  if (aiChild && aiChild.exitCode === null && aiChild.signalCode === null && !aiChild.killed) {
    return { ok: false, error: 'AI 正在生成中，请先停止再恢复历史版本' };
  }
  const dn = validProtoDir(o2.dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  const ts = String(o2.ts || '');
  if (!/^\d{8}-\d{6}$/.test(ts)) return { ok: false, error: '非法快照标识' };
  const root = snapRootFor(dn);
  const src = path.join(root, ts);
  if (!fs.existsSync(src)) return { ok: false, error: '快照不存在' };
  try {
    /* 恢复前把当前状态备份为 undo- 快照（防误恢复丢失），随后整体替换 */
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const undoDst = path.join(root, 'undo-' + fmtTs(new Date()));
    fs.cpSync(dn, undoDst, { recursive: true });
    fs.rmSync(dn, { recursive: true, force: true });
    fs.cpSync(src, dn, { recursive: true });
    pruneSnapshots(root);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

/* ═══════ 跳转绑定：每原型一份 links.json ═══════ */
ipcMain.handle('links:read', (ev, dir) => {
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    const f = path.join(dn, 'links.json');
    if (!fs.existsSync(f)) return { ok: true, data: null };
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ok: true, data: (data && Array.isArray(data.links)) ? { version: 1, links: data.links } : { version: 1, links: [] } };
  } catch (e) { return { ok: true, data: { version: 1, links: [] } }; } /* 损坏文件视为空绑定，不阻断使用 */
});
ipcMain.handle('links:write', (ev, dir, data) => {
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    const links = Array.isArray(data && data.links) ? data.links : [];
    const clean = links.map((l) => { const c = Object.assign({}, l); delete c._stale; return c; });
    fs.writeFileSync(path.join(dn, 'links.json'), JSON.stringify({ version: 1, links: clean }, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* ═══════ 元素标注：每原型一份 annotations.json ═══════ */
function handleAnnoRead(ev, arg1) {
  const dir = typeof arg1 === 'object' && arg1 !== null ? arg1.dir : arg1;
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内', data: [] };
  try {
    const f = path.join(dn, 'annotations.json');
    if (!fs.existsSync(f)) return { ok: true, data: [] };
    const content = fs.readFileSync(f, 'utf8');
    const parsed = JSON.parse(content || '[]');
    const data = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.annotations) ? parsed.annotations : []);
    return { ok: true, data: data };
  } catch (e) { return { ok: true, data: [] }; }
}
function handleAnnoSave(ev, arg1, arg2) {
  let dir = arg1;
  let list = arg2;
  if (typeof arg1 === 'object' && arg1 !== null) {
    dir = arg1.dir;
    list = arg1.annotations !== undefined ? arg1.annotations : arg1.data;
  }
  if (list && typeof list === 'object' && !Array.isArray(list) && Array.isArray(list.annotations)) {
    list = list.annotations;
  }
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  if (!Array.isArray(list)) return { ok: false, error: '数据格式错误' };
  try {
    const f = path.join(dn, 'annotations.json');
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, f);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
ipcMain.handle('annotations:read', handleAnnoRead);
ipcMain.handle('proto:annotations:read', handleAnnoRead);
ipcMain.handle('annotations:write', handleAnnoSave);
ipcMain.handle('annotations:save', handleAnnoSave);
ipcMain.handle('proto:annotations:save', handleAnnoSave);

/* 渲染进程会话：一次性问答，事件经 ai:event 回传；sandboxDir=沙箱工作目录 */
// F03 async: 改为异步，不阻塞主进程（原 spawnSync where/--version 会卡 UI 10s）
ipcMain.handle('ai:check', async () => {
  // P1-4 fix F03 async 加 3000ms 超时保护
  let exe = null;
  try{ exe = await Promise.race([ resolveCliAsync(), new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] ai:check resolveCli timeout 3000ms'); }catch(e){} res(null); }, 3000)) ]); }catch(e){ try{ console.log('[F03 async] ai:check error', e); }catch(ee){} exe=null; }
  if (!exe) return { found: false, path: null, version: null };
  let ver = null;
  try{ ver = await Promise.race([ cliVersionAsync(exe), new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] ai:check cliVersion timeout 3000ms'); }catch(e){} res(null); }, 3000)) ]); }catch(e){ ver=null; }
  return { found: true, path: exe, version: ver };
});

/* ═══════ 模型列表：opencode models 输出（每行 provider/model），按供应商分组 ═══════
   结果反映 opencode 当前配置（含内置 provider 与用户自定义，禁用/不可用的不出现）；
   供应商显示名优先取全局配置 opencode.json[c] 中 provider.<key>.name，取不到则用 key。 */
const DEFAULT_AI_MODEL = 'opencode/deepseek-v4-flash-free';
function stripAnsi(s) { return String(s || '').replace(/\x1b\[[0-9;]*m/g, ''); }
/* 异步执行 opencode CLI（不阻塞主进程）：处理 .cmd/.bat shim，超时自动 kill */
function runCliAsync(exe, args, timeoutMs, cwd) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { OPENCODE_CONFIG: ensureAiIsolateFile() });
    const isCmdShim = /\.(cmd|bat)$/i.test(exe);
    const base = { windowsHide: true, env, cwd: (cwd && fs.existsSync(cwd)) ? cwd : undefined };
    let child;
    try {
      if (isCmdShim) {
        const quote = (a) => '"' + String(a).replace(/"/g, '""') + '"';
        child = spawn('cmd.exe', ['/d', '/s', '/c', quote(exe) + ' ' + args.map(quote).join(' ')], base);
      } else {
        child = spawn(exe, args, base);
      }
    } catch (e) {
      resolve({ status: -1, stdout: '', stderr: String(e && e.message || e) });
      return;
    }
    let stdout = '', stderr = '', done = false;
    const finish = (status) => { if (done) return; done = true; clearTimeout(timer); resolve({ status, stdout, stderr }); };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish(-1); }, timeoutMs || 20000);
    child.stdout.on('data', (b) => { stdout += Buffer.from(b).toString('utf8'); if (stdout.length > 2e6) stdout = stdout.slice(-2e6); });
    child.stderr.on('data', (b) => { stderr += Buffer.from(b).toString('utf8'); if (stderr.length > 2e6) stderr = stderr.slice(-2e6); });
    child.on('error', (e) => { if (!stderr) stderr = String(e && e.message || e); finish(-1); });
    child.on('close', (code) => { finish(code == null ? -1 : code); });
  });
}
function providerDisplayNames(providerKeys) {
  const out = {};
  if (!providerKeys || !providerKeys.length) return out;
  const dir = path.join(process.env.USERPROFILE || '', '.config', 'opencode');
  for (const f of ['opencode.json', 'opencode.jsonc']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    let t = '';
    try { t = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    /* 仅解析 JSONC 文本中的 provider 块（配置允许注释，JSON.parse 不一定可用） */
    const pm = t.match(/"provider"\s*:\s*\{([\s\S]*)\}/);
    if (!pm) continue;
    const block = pm[1];
    for (const k of providerKeys) {
      if (out[k]) continue;
      const re = new RegExp('"' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*:\\s*\\{\\s*"name"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
      const mm = block.match(re);
      if (mm) out[k] = mm[1];
    }
  }
  return out;
}
let apiAbortController = null;

function getCompletionsUrl(baseUrl) {
  let u = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return u + '/chat/completions';
  return u + '/chat/completions';
}

function findSandboxHtmlFile(sandboxDir) {
  if (!sandboxDir || !fs.existsSync(sandboxDir)) return null;
  const baseName = path.basename(sandboxDir);
  const direct = path.join(sandboxDir, `${baseName}.html`);
  if (fs.existsSync(direct)) return direct;
  try {
    const files = fs.readdirSync(sandboxDir);
    const htmls = files.filter(f => f.endsWith('.html'));
    if (htmls.length > 0) return path.join(sandboxDir, htmls[0]);
  } catch (e) {}
  return path.join(sandboxDir, `${baseName}.html`);
}

function pruneHtmlContext(html) {
  try {
    let s = String(html || '');
    if (s.length > 9000) {
      return s.slice(0, 6000) + '\n<!-- ... truncated middle ... -->\n' + s.slice(-3000);
    }
    return s;
  } catch (e) { return String(html || '').slice(0, 9000); }
}
function hashStr(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function makeDiff(prev, cur) {
  try {
    const a = String(prev || '').split('\n');
    const b = String(cur || '').split('\n');
    let out = [];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const av = a[i];
      const bv = b[i];
      if (av === bv) continue;
      if (av !== undefined) out.push('- ' + av);
      if (bv !== undefined) out.push('+ ' + bv);
      if (out.length > 400) break;
    }
    if (out.length === 0) return '';
    return out.join('\n');
  } catch (e) { return ''; }
}
const lastHashMem = new Map();
const prevHtmlMem = new Map();
const LRU_LIMIT = 50;
function lruSet(map, key, val) {
  try {
    if (map.has(key)) map.delete(key);
    map.set(key, val);
    while (map.size > LRU_LIMIT) { const first = map.keys().next().value; map.delete(first); }
  } catch (e) {}
}

function isSubPath(candidate, base) {
  try {
    const cand = String(candidate || '');
    const b = String(base || '');
    if (!cand || !b) return false;
    let realBase;
    // P0-2 fix 使用缓存 realSandboxRoot，避免 symlink 穿越，缺省回退 path.resolve
    if (path.normalize(b) === path.normalize(SANDBOX_ROOT)) realBase = realSandboxRoot;
    else try { realBase = fs.realpathSync(b); } catch (e) { realBase = path.resolve(b); }
    let realCand;
    try { realCand = fs.realpathSync(cand); } catch (e) {
      try {
        const dir = path.dirname(cand);
        const baseName = path.basename(cand);
        let realDir;
        try { realDir = fs.realpathSync(dir); } catch (e2) { realDir = path.resolve(dir); }
        // P0-2 fix 对不存在文件用 realpathSync(dirname)+sep+basename 再 startsWith(realSandboxRoot+sep)
        realCand = path.join(realDir, baseName);
      } catch (e2) { realCand = path.resolve(cand); }
    }
    const normBase = path.normalize(realBase);
    const normCand = path.normalize(realCand);
    if (normCand === normBase) return true;
    return normCand.startsWith(normBase + path.sep);
  } catch (e) { return false; }
}
// P0-2 fix 解码辅助，循环最多3次
function decodeURIComponentSafe(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }
function isSafeGitRel(rel){
  // P0-2 fix 循环解码最多3次，拦 %2e/%2f/%252e 大小写，解码后判 .. \ / 开头
  let d = String(rel || '');
  if (!d) return false;
  if (/%2e|%2f|%252e/i.test(d)) return false; // P0-2 fix 拦编码穿透
  let cur = d;
  for(let i=0;i<3;i++){ try{ const nd=decodeURIComponent(cur); if(nd===cur) break; cur=nd; }catch(e){ break; } }
  d = cur;
  if (d.includes('..')||/[\\]/.test(d)||d.startsWith('/')) return false;
  if (/%2e|%2f/i.test(cur)) return false;
  return isSubPath(path.join(SANDBOX_ROOT, rel), SANDBOX_ROOT);
}
function isValidBranch(b){ return /^[a-zA-Z0-9._\/-]+$/.test(b) && b.length<=60 && !b.includes('..'); }
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  const s = String(haystack || '');
  const n = String(needle || '');
  while (true) {
    const idx = s.indexOf(n, pos);
    if (idx === -1) break;
    count++;
    if (count > 1) break;
    pos = idx + n.length;
  }
  return count;
}
function buildTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取沙箱内指定HTML文件内容（多块原子操作前置探查，15k截断预览，返回hash）',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '相对沙箱根的文件路径，如 index.html 或 sub/page.html' }
          },
          required: ['file']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: '列出沙箱目录下的HTML文件与子页面（多块原子前引导）',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: '相对沙箱根的目录，可选，默认为沙箱根目录' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_skeleton',
        description: '获取指定HTML文件的骨架预览（经pruneHtmlContext压缩，适合大文件多块原子规划）',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '相对沙箱根的文件路径' }
          },
          required: ['file']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_patch',
        description: '对沙箱内HTML文件执行多块原子SEARCH/REPLACE补丁（多块原子，tmp→rename原子写入，唯一性校验）',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '相对沙箱根的文件路径' },
            patches: {
              type: 'array',
              description: '多块原子补丁数组，每块含search与replace',
              items: {
                type: 'object',
                properties: {
                  search: { type: 'string', description: '需被替换的原文片段，需在文件中唯一' },
                  replace: { type: 'string', description: '替换后的新片段' }
                },
                required: ['search', 'replace']
              }
            }
          },
          required: ['file', 'patches']
        }
      }
    }
  ];
}
async function runTool(name, args, sandboxDir) {
  const toolName = String(name || '');
  const a = args && typeof args === 'object' ? args : {};
  const baseDir = String(sandboxDir || SANDBOX_ROOT);
  function resolveSecure(relativeOrAbs) {
    let abs;
    if (path.isAbsolute(relativeOrAbs)) abs = path.normalize(relativeOrAbs);
    else abs = path.normalize(path.join(baseDir, relativeOrAbs));
    if (!isSubPath(abs, SANDBOX_ROOT)) {
      throw new Error('越权访问：路径不在沙箱范围内');
    }
    return abs;
  }
  switch (toolName) {
    case 'read_file': {
      let fileArg = String(a.file || a.path || '').trim();
      if (!fileArg) return { ok: false, error: 'file 不能为空', code: 'MISSING_FILE' };
      let absPath;
      try { absPath = resolveSecure(fileArg); } catch (e) { return { ok: false, error: String(e.message), code: 'FORBIDDEN' }; }
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        return { ok: false, error: '文件不存在: ' + fileArg, code: 'NOT_FOUND' };
      }
      let content;
      try { content = fs.readFileSync(absPath, 'utf8'); } catch (e) { return { ok: false, error: String(e.message) }; }
      const h = hashStr(content);
      const truncated = content.length > 15000;
      const preview = truncated ? content.slice(0, 15000) + '\n...TRUNCATED ' + (content.length - 15000) + ' chars...' : content;
      const previewHash = truncated ? hashStr(preview) : h;
      return { ok: true, file: fileArg, content: preview, hash: h, previewHash, truncated, length: content.length };
    }
    case 'list_files': {
      let dirArg = String(a.dir || '').trim();
      let absDir;
      try {
        if (!dirArg) absDir = path.normalize(baseDir);
        else absDir = resolveSecure(dirArg);
      } catch (e) { return { ok: false, error: String(e.message), code: 'FORBIDDEN' }; }
      if (!isSubPath(absDir, SANDBOX_ROOT)) {
        return { ok: false, error: '越权访问', code: 'FORBIDDEN' };
      }
      if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
        return { ok: false, error: '目录不存在: ' + (dirArg || baseDir), code: 'NOT_FOUND' };
      }
      let entries;
      try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return { ok: false, error: String(e.message) }; }
      const htmlFiles = entries.filter(e => e.isFile() && /\.html?$/i.test(e.name)).map(e => e.name);
      const subPages = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '.git').map(e => e.name);
      const allFiles = entries.filter(e => e.isFile()).map(e => e.name);
      return { ok: true, dir: dirArg || '.', htmlFiles, subPages, allFiles, count: htmlFiles.length + subPages.length };
    }
    case 'get_skeleton': {
      let fileArg = String(a.file || a.path || '').trim();
      if (!fileArg) return { ok: false, error: 'file 不能为空', code: 'MISSING_FILE' };
      let absPath;
      try { absPath = resolveSecure(fileArg); } catch (e) { return { ok: false, error: String(e.message), code: 'FORBIDDEN' }; }
      if (!fs.existsSync(absPath)) return { ok: false, error: '文件不存在: ' + fileArg, code: 'NOT_FOUND' };
      let content;
      try { content = fs.readFileSync(absPath, 'utf8'); } catch (e) { return { ok: false, error: String(e.message) }; }
      const skeleton = pruneHtmlContext(content);
      const h = hashStr(content);
      const sh = hashStr(skeleton);
      return { ok: true, file: fileArg, skeleton, hash: h, skeletonHash: sh, length: content.length, skeletonLength: skeleton.length };
    }
    case 'apply_patch': {
      let fileArg = String(a.file || a.path || '').trim();
      if (!fileArg) {
        try {
          const fb = findSandboxHtmlFile(baseDir);
          if (fb) fileArg = path.basename(fb);
          else fileArg = 'index.html';
        } catch (e) { fileArg = 'index.html'; }
      }
      let patches = a.patches;
      if (!Array.isArray(patches) || patches.length === 0) {
        if (a.search !== undefined) {
          patches = [{ search: String(a.search), replace: String(a.replace || '') }];
        } else {
          return { ok: false, error: 'patches 不能为空', code: 'MISSING_PATCHES' };
        }
      }
      const cleanPatches = [];
      for (let i = 0; i < patches.length; i++) {
        const p = patches[i];
        if (!p || typeof p.search !== 'string') return { ok: false, error: `patches[${i}].search 不能为空`, code: 'MISSING_SEARCH' };
        cleanPatches.push({ search: String(p.search), replace: String(p.replace || '') });
      }
      let absPath;
      try { absPath = resolveSecure(fileArg); } catch (e) { return { ok: false, error: String(e.message), code: 'FORBIDDEN' }; }
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        return { ok: false, error: '文件不存在: ' + fileArg, code: 'NOT_FOUND' };
      }
      let original;
      try { original = fs.readFileSync(absPath, 'utf8'); } catch (e) { return { ok: false, error: String(e.message) }; }
      let modified = original;
      // anchor fix P0: 空白漂移归一化二次判（精确优先，仅空白/换行差异时放宽）
      function normAnchor(s){return String(s||'').replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'');}
      for (let i = 0; i < cleanPatches.length; i++) {
        const pat = cleanPatches[i];
        let cnt = countOccurrences(modified, pat.search);
        // anchor fix P0 NORM_HIT 二次判
        if(cnt===0){
          const nMod = normAnchor(modified), nSearch = normAnchor(pat.search);
          if(countOccurrences(nMod, nSearch)===1){
            modified = nMod.replace(nSearch, normAnchor(pat.replace));
            cnt=1;
            // TAG='NORM_HIT' 空白归一命中
          }
        }
        if (cnt === 0) {
          return { ok: false, error: `SEARCH_NOT_FOUND: patches[${i}] 未在文件中找到匹配`, code: 'SEARCH_NOT_FOUND', index: i, searchPreview: pat.search.slice(0, 120) };
        }
        if (cnt !== 1) {
          return { ok: false, error: `SEARCH_NOT_UNIQUE: patches[${i}] 匹配到 ${cnt} 处，需保证唯一`, code: 'SEARCH_NOT_UNIQUE', index: i, count: cnt };
        }
        if(cnt===1 && modified.includes(pat.search)){
          modified = modified.replace(pat.search, pat.replace);
        } else if(cnt===1){
          // 已在归一分支完成替换，无需二次精确替换
        }
      }
      const tmpPath = absPath + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2, 6);
      try {
        fs.writeFileSync(tmpPath, modified, 'utf8');
        fs.renameSync(tmpPath, absPath);
      } catch (e) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (ee) {}
        return { ok: false, error: '写入失败: ' + String(e.message), code: 'WRITE_FAIL' };
      }
      try {
        const fileKey = path.basename(absPath);
        const newHash = hashStr(modified);
        lruSet(lastHashMem, fileKey, newHash);
        lruSet(prevHtmlMem, fileKey, modified);
        const scopedKey = baseDir + '\0' + fileKey;
        lruSet(lastHashMem, scopedKey, newHash);
        lruSet(prevHtmlMem, scopedKey, modified);
      } catch (e) {}
      return { ok: true, file: fileArg, patched: cleanPatches.length, length: modified.length, hash: hashStr(modified) };
    }
    default:
      return { ok: false, error: '未知工具: ' + toolName, code: 'UNKNOWN_TOOL' };
  }
}


/**
 * 解析并应用 SEARCH/REPLACE 差量补丁到原代码（三级容错）
 * @param {string} originalCode 原始 HTML 文本
 * @param {string} diffText 大模型回复的包含 diff 块的文本
 * @returns {{ ok: boolean, modified: string, count: number, failedBlocks: string[] }}
 */
function applySearchReplace(originalCode, diffText) {
  if (!originalCode || !diffText) return { ok: false, modified: originalCode, count: 0, failedBlocks: [] };

  const pattern = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
  let modified = originalCode;
  let count = 0;
  let match;
  const failedBlocks = [];

  while ((match = pattern.exec(diffText)) !== null) {
    const searchRaw = match[1];
    const replaceRaw = match[2];

    // 1. 原文字符串精确匹配
    if (modified.includes(searchRaw)) {
      modified = modified.replace(searchRaw, replaceRaw);
      count++;
      continue;
    }

    // 2. 换行符归一化重试 (\r\n 与 \n 互换)
    const normModified = modified.replace(/\r\n/g, '\n');
    const normSearch = searchRaw.replace(/\r\n/g, '\n');
    const normReplace = replaceRaw.replace(/\r\n/g, '\n');
    if (normModified.includes(normSearch)) {
      modified = normModified.replace(normSearch, normReplace);
      count++;
      continue;
    }

    // 3. 逐行首尾空白修剪模糊对齐（Fuzzy Line Trim Matching）
    const searchLines = normSearch.split('\n').map(l => l.trim()).filter(Boolean);
    if (searchLines.length > 0) {
      const docLines = modified.replace(/\r\n/g, '\n').split('\n');
      let foundStart = -1;
      for (let i = 0; i <= docLines.length - searchLines.length; i++) {
        let allMatch = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (docLines[i + j].trim() !== searchLines[j]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          foundStart = i;
          break;
        }
      }
      if (foundStart >= 0) {
        docLines.splice(foundStart, searchLines.length, normReplace);
        modified = docLines.join('\n');
        count++;
        continue;
      }
    }

    failedBlocks.push(searchRaw.slice(0, 100));
  }

  return {
    ok: count > 0 && failedBlocks.length === 0,
    modified: modified,
    count: count,
    failedBlocks: failedBlocks
  };
}

async function startDirectApiRun(apiCfg, modelWanted, handlers, sandboxDir, promptText, extraOpts) {
  extraOpts = extraOpts || {};
  const url = getCompletionsUrl(apiCfg.baseUrl);
  let rawKey = String(apiCfg.apiKey || '');
  let key = rawKey.trim();
  // 兼容用户粘贴 "Bearer sk-..." 或带引号的情况
  if (/^Bearer\s+/i.test(key)) key = key.replace(/^Bearer\s+/i, '').trim();
  key = key.replace(/^["']|["']$/g, '').trim();
  const model = modelWanted || apiCfg.model || 'deepseek-chat';
  // 放开工具：移除 !/mimo|reasoner/ 硬禁，由 enableTools 开关决定（400 时自动回退）
  let shouldUseTools = (extraOpts.enableTools !== undefined ? !!extraOpts.enableTools : (apiCfg.enableTools !== undefined ? !!apiCfg.enableTools : true));

  if (!url) { handlers.onError(new Error('未配置 API Base URL')); return; }
  if (!key) { handlers.onError(new Error('未配置 API Key')); return; }
  if (key.length < 10) { handlers.onError(new Error('API Key 过短（仅 '+key.length+' 字符），请检查是否复制完整')); return; }

  const masked = key.length > 12 ? (key.slice(0, 6) + '...' + key.slice(-4)) : (key.slice(0,3)+'...');
  handlers.onTrace({ tag: 'API_INIT', level: 'info', text: `引擎: Direct API (${apiCfg.provider || 'custom'}) -> ${url}, 模型: ${model}, Key: ${masked} (${key.length} chars)` });
  if (rawKey !== key) {
    handlers.onTrace({ tag: 'API_KEY_NORM', level: 'info', text: `Key已自动去除Bearer/引号/空格 (原${rawKey.length}→${key.length})` });
  }

  let targetHtmlPath = null;
  if (extraOpts && extraOpts.targetFile) {
    const specifiedPath = path.join(sandboxDir, String(extraOpts.targetFile).trim());
    if (fs.existsSync(specifiedPath) && isSubPath(specifiedPath, SANDBOX_ROOT)) targetHtmlPath = specifiedPath;
  }
  if (!targetHtmlPath) targetHtmlPath = findSandboxHtmlFile(sandboxDir);
  let existingHtml = '';
  if (targetHtmlPath && fs.existsSync(targetHtmlPath)) {
    try { existingHtml = fs.readFileSync(targetHtmlPath, 'utf8'); } catch (e) {}
  }

  if (existingHtml) {
    handlers.onTrace({ tag: 'CONTEXT', level: 'info', text: `载入当前原型 HTML 上下文 (${(existingHtml.length / 1024).toFixed(1)} KB)` });
  }

  // === hash/锚点 契约 ===
  const fileKey = targetHtmlPath ? (path.relative(SANDBOX_ROOT, targetHtmlPath).replace(/\\/g,'/') || path.basename(targetHtmlPath)) : (extraOpts.targetFile ? String(extraOpts.targetFile).replace(/\\/g,'/').replace(/^\//,'') || path.basename(String(extraOpts.targetFile)) : 'index.html');
  const sid = String(extraOpts.sessionId || '').trim();
  const lastKey = sid + '\0' + fileKey;
  const legacyFileKey = targetHtmlPath ? path.basename(targetHtmlPath) : (extraOpts.targetFile ? path.basename(String(extraOpts.targetFile)) : 'index.html');
  const legacyLastKey = sid + '\0' + legacyFileKey;
  const curHash = existingHtml ? hashStr(existingHtml) : '';
  let lastHash = '';
  try {
    if (lastHashMem.has(lastKey)) lastHash = lastHashMem.get(lastKey);
    else if (lastHashMem.has(fileKey)) lastHash = lastHashMem.get(fileKey);
    else if (lastHashMem.has(legacyLastKey)) lastHash = lastHashMem.get(legacyLastKey);
    else if (lastHashMem.has(legacyFileKey)) lastHash = lastHashMem.get(legacyFileKey);
    else if (targetHtmlPath && lastHashMem.has(sid + '\0' + targetHtmlPath)) lastHash = lastHashMem.get(sid + '\0' + targetHtmlPath);
    else if (targetHtmlPath && lastHashMem.has(targetHtmlPath)) lastHash = lastHashMem.get(targetHtmlPath);
    else if (extraOpts.lastHash && typeof extraOpts.lastHash === 'object' && extraOpts.lastHash[fileKey]) lastHash = String(extraOpts.lastHash[fileKey]);
    else if (extraOpts.lastHash && typeof extraOpts.lastHash === 'object' && extraOpts.lastHash[legacyFileKey]) lastHash = String(extraOpts.lastHash[legacyFileKey]);
    else if (extraOpts.lastHash && typeof extraOpts.lastHash === 'object' && targetHtmlPath && extraOpts.lastHash[targetHtmlPath]) lastHash = String(extraOpts.lastHash[targetHtmlPath]);
  } catch (e) {}
  const isUnchangedRaw = !!existingHtml && !!lastHash && curHash === lastHash;
  const isUnchanged = isUnchangedRaw && shouldUseTools;
  let htmlToSend = '';
  let htmlAnchor = '';
  let useDiff = false;
  if (existingHtml) {
    if (isUnchanged) {
      handlers.onTrace({ tag: 'HTML_CACHE_HIT', level: 'info', text: `[${fileKey}] 未改动，跳过锚点 (hash=${curHash.slice(0,8)})` });
      htmlToSend = '';
    } else if (existingHtml.length < 3000) {
      // anchor fix P0 小文件直通：<3k 不做 diff/prune，直接全量发送（简单页成功率提升）
      htmlToSend = existingHtml;
      useDiff = false;
      handlers.onTrace({ tag: 'HTML_FULL_SMALL', level: 'info', text: `微型页全量直通 (${existingHtml.length} chars, ${existingHtml.split('\n').length} lines)` });
    } else {
      let prevHtml = prevHtmlMem.get(lastKey) || '';
      if (!prevHtml && prevHtmlMem.has(fileKey)) prevHtml = prevHtmlMem.get(fileKey) || '';
      if (!prevHtml && prevHtmlMem.has(legacyLastKey)) prevHtml = prevHtmlMem.get(legacyLastKey) || '';
      if (!prevHtml && prevHtmlMem.has(legacyFileKey)) prevHtml = prevHtmlMem.get(legacyFileKey) || '';
      if (!prevHtml && targetHtmlPath && prevHtmlMem.has(sid + '\0' + targetHtmlPath)) prevHtml = prevHtmlMem.get(sid + '\0' + targetHtmlPath) || '';
      if (!prevHtml && targetHtmlPath && prevHtmlMem.has(targetHtmlPath)) prevHtml = prevHtmlMem.get(targetHtmlPath) || '';
      let diff = makeDiff(prevHtml, existingHtml);
      if (diff && (diff.length > 8000 || diff.split('\n').length > 200)) {
        handlers.onTrace({ tag: 'SKELETON', level: 'info', text: `Diff过大 (${diff.length} chars/${diff.split('\n').length} lines)，回退骨架` });
        htmlToSend = pruneHtmlContext(existingHtml);
      } else if (diff) {
        handlers.onTrace({ tag: 'DIFF_SENT', level: 'info', text: `发送行级Diff (${diff.length} chars)` });
        htmlToSend = diff;
        useDiff = true;
      } else {
        if (existingHtml.length > 8000) {
          handlers.onTrace({ tag: 'SKELETON', level: 'info', text: `首次发送，HTML过大回退骨架 (${existingHtml.length} -> ${pruneHtmlContext(existingHtml).length})` });
          htmlToSend = pruneHtmlContext(existingHtml);
        } else {
          htmlToSend = existingHtml;
          handlers.onTrace({ tag: 'HTML_ANCHOR', level: 'info', text: `首次发送全量HTML (${htmlToSend.length} chars)` });
        }
      }
    }
    if (htmlToSend) {
      if (useDiff) {
        htmlAnchor = `【当前原型 HTML Diff (${fileKey}) vs 上次】\n\`\`\`diff\n${htmlToSend}\n\`\`\``;
      } else {
        htmlAnchor = `【当前原型 HTML 上下文 (${fileKey})】\n\`\`\`html\n${htmlToSend}\n\`\`\``;
      }
    }
  }

  let sysPrompt = '';
  let userContent = promptText;
  if (existingHtml) {
    // anchor fix P0 动态化 SEARCH 上下文：微型页<3k或<40行仅需1~3行且必须含唯一文本/属性
    const isSmallProto = existingHtml.length < 3000 || existingHtml.split('\n').length < 40;
    const searchContextRule = isSmallProto
      ? '2. 每个 SEARCH 块仅需包含 1~3 行且必须含唯一文本/属性（如 id、标题文案、特征类名）以便精准定位，简单页无需冗余 2~5 行上下文；'
      : '2. 每个 SEARCH 块请包含 2~5 行具有唯一特征的上下文代码，以便系统精准定位；';
    const basePrompt = withToolPrompt(`你是一个专业的高保真前端线框原型设计专家。
用户会向你提出原型的修改需求。
【强制输出规范 - 局部差量修改协议】：
当前原型已有完整 HTML 代码。为了极大降低 Token 成本并光速响应，【严禁返回完整 HTML 文件】，必须只输出需要变动的局部代码块（SEARCH/REPLACE 块）：

格式规范：
<<<<<<< SEARCH
[原 HTML 中需要被替换的代码片段，请保持与原代码完全一致以便精确查找定位]
=======
[修改后的新代码片段]
>>>>>>> REPLACE

核心要求：
1. 仅包含发生变动的局部代码（如微调样式、修改文案、增删组件、修改交互等）；
${searchContextRule}
3. 一次回复中可以输出多个独立的 SEARCH/REPLACE 块；
4. 严禁在 SEARCH/REPLACE 块中包含无关的整千行代码，严禁使用省略号（如 <!-- 省略其他 -->）；
5. 仅当用户明确要求“彻底重写整个原型”时，才允许在 \`\`\`html ... \`\`\` 中输出完整代码；
6. 代码块之外，请用 1~2 句简要中文说明修改要点。`, true);
    const rawSys = basePrompt;
    sysPrompt = htmlAnchor ? (htmlAnchor + '\n\n' + rawSys) : rawSys;
    if (isUnchanged) {
      userContent = `【本次修改需求】：\n${promptText}\n\n（提示：HTML 未变化，已省略上下文锚点）`;
    } else if (htmlAnchor) {
      userContent = `【本次修改需求】：\n${promptText}`;
    } else {
      userContent = `【当前原型现有的完整 HTML 代码】：\n\`\`\`html\n${existingHtml}\n\`\`\`\n\n【本次修改需求】：\n${promptText}\n\n请仔细阅读现有 HTML，使用 <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE 块只输出需要修改的局部代码片段。`;
    }
  } else {
    sysPrompt = withToolPrompt(`你是一个专业的高保真前端线框原型设计专家。
用户会向你提出新建原型的需求。
【输出规范】：
请在 \`\`\`html ... \`\`\` 代码块中输出完整的、开箱即用的前端线框原型 HTML 代码。
页面默认采用现代极简灰阶线框图规范，结构清晰扁平。
除代码块外，请用简要中文说明设计要点。`, true);
    userContent = promptText;
  }

  const historyList = Array.isArray(extraOpts.history) ? extraOpts.history.slice(-12) : [];
  const historyMsgs = historyList.map((h) => {
    if (!h) return null;
    if (h.role && h.content !== undefined) return { role: h.role, content: String(h.content) };
    const r = h.r;
    const t = String(h.t ?? h.content ?? '');
    if (r === 'u') return { role: 'user', content: t };
    if (r === 'a') return { role: 'assistant', content: t };
    if (r === 'tool') return null;
    if (h.role) return { role: h.role, content: t };
    return null;
  }).filter(Boolean);

  const messages = [
    { role: 'system', content: sysPrompt },
    ...historyMsgs,
    { role: 'user', content: userContent }
  ];

  let estTokens = messages.reduce((s, m) => s + Math.ceil(String(m.content || '').length / 4), 0);
  while (estTokens > 110000 && messages.length > 2) {
    messages.splice(1, 1);
    estTokens = messages.reduce((s, m) => s + Math.ceil(String(m.content || '').length / 4), 0);
    handlers.onTrace({ tag: 'TRUNCATE', level: 'warn', text: `estTokens ${estTokens} 超限，移除历史保留锚点` });
  }

  apiAbortController = new AbortController();
  handlers.onStart();
  handlers.onTrace({ tag: 'HTTP_REQ', level: 'info', text: `POST ${url} (Stream: true) | history:${historyList.length} fileKey:${fileKey} isUnchanged:${isUnchanged} anchor:${htmlAnchor?htmlAnchor.length:0} estTokens:${estTokens}` });

  let toolPatched = false;
  let curMessages = messages.slice();
  let http500Retries = 0;
  // shouldUseTools 已在上方按 enableTools 计算（放开 mimo 硬禁），此处不重复声明
  let lastFullContent = '';
  let lastFullReasoning = '';
  const startTime = Date.now();
  let firstTokenTime = 0;

  let toolErrStreak = 0, emptyStreak = 0;
  try {
    for (let round = 0; ; round++) {
      apiAbortController = new AbortController();
      // 已移除 20s 自动掐断（用户要求：不自动超时，由前端点停止手动 abort）
      let curFullContent = '';
      let curFullReasoning = '';
      let curFinishReason = '';
      let toolCallBuffer = new Map();
      let autoIdx = 0;
      try {
        const payload = { model: model, messages: curMessages, stream: true, temperature: 0.3, tools: shouldUseTools ? buildTools() : undefined, tool_choice: shouldUseTools ? "auto" : undefined };
        handlers.onTrace({ tag: 'ROUND', level: 'info', text: `Round ${round+1} shouldUseTools:${shouldUseTools} msgs:${curMessages.length} toolErrStreak:${toolErrStreak} emptyStreak:${emptyStreak}` });
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify(payload),
          signal: apiAbortController.signal
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const status = res.status;
          if (status === 401) {
            const hint = `Key无效或与 BaseURL/模型不匹配 (provider=${apiCfg.provider||'custom'}, url=${url}, model=${model}, key=${masked})。请确认已点"保存并应用"且Key属于该服务商 (DeepSeek/阿里/硅基/OpenRouter)`;
            throw new Error(`API 认证失败 HTTP 401: ${hint} 原始返回: ${errText.slice(0, 200)}`);
          }
          const isFallbackStatus = status === 500 || status === 400 || status === 429;
          if (isFallbackStatus && shouldUseTools) {
            handlers.onTrace({ tag: 'TOOL_FALLBACK', level: 'warn', text: `HTTP ${status} 触发工具回退，关闭工具重试` });
            shouldUseTools = false;
            curMessages = messages.slice();
            toolCallBuffer.clear();
            continue;
          }
          if (isFallbackStatus && !shouldUseTools && http500Retries < 2) {
            http500Retries++;
            handlers.onTrace({ tag: 'HTTP_RETRY', level: 'warn', text: `HTTP ${status} 极简重试 ${http500Retries}/2` });
            const basePromptRetry = withToolPrompt('你是一个专业的高保真前端线框原型设计专家。用户会向你提出需求。', true);
            curMessages = [{ role: 'system', content: basePromptRetry }, { role: 'user', content: promptText }];
            toolCallBuffer.clear();
            continue;
          }
          throw new Error(`API 返回错误 HTTP ${status}: ${errText.slice(0, 300)}`);
        }
        if (!res.body) {
          throw new Error('API 返回了空响应体');
        }
        handlers.onTrace({ tag: 'HTTP_200', level: 'success', text: `Round ${round+1} 连接建立成功，开始接收流式响应...` });
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf8');
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') { curFinishReason = curFinishReason || 'stop'; break; }
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const data = JSON.parse(jsonStr);
                const choice = data.choices && data.choices[0];
                if (!choice) continue;
                if (choice.finish_reason) curFinishReason = String(choice.finish_reason);
                const delta = choice.delta;
                if (!delta) continue;
                if (!firstTokenTime) {
                  firstTokenTime = Date.now();
                  handlers.onTrace({ tag: 'TTFT', level: 'info', text: `收到首包 Token (握手耗时: ${firstTokenTime - startTime}ms)` });
                }
                const reasoning = delta.reasoning_content || delta.thought || delta.reasoning || '';
                if (reasoning) {
                  curFullReasoning += reasoning;
                  handlers.onReasoning(reasoning);
                }
                const content = delta.content || '';
                if (content) {
                  curFullContent += content;
                  handlers.onChunk(content);
                }
                const toolCallsDelta = delta.tool_calls || delta.toolCalls || [];
                if (Array.isArray(toolCallsDelta) && toolCallsDelta.length) {
                  for (const tc of toolCallsDelta) {
                    const idxKey = (tc.index != null && tc.index !== undefined) ? String(tc.index) : (tc.idx != null ? String(tc.idx) : '');
                    const rawId = tc.id || tc.tool_call_id || '';
                    const autoKey = 'auto_' + (autoIdx++);
                    const key = idxKey || rawId || autoKey;
                    let entry = toolCallBuffer.get(key);
                    if (!entry) entry = { id: rawId || key, name: '', arguments: '' };
                    const fnName = tc.function && tc.function.name ? String(tc.function.name) : (tc.name ? String(tc.name) : '');
                    if (fnName) {
                      if (!entry.name) entry.name = fnName;
                      else if (entry.name !== fnName) entry.name += fnName;
                    }
                    const fnArgs = tc.function && tc.function.arguments ? String(tc.function.arguments) : (tc.arguments ? String(tc.arguments) : '');
                    if (fnArgs) entry.arguments += fnArgs;
                    if (rawId) entry.id = rawId;
                    if (tc.tool_call_id) entry.id = tc.tool_call_id;
                    toolCallBuffer.set(key, entry);
                  }
                }
                if (delta.function_call) {
                  const fc = delta.function_call;
                  const key = 'func_' + (fc.name || 'unknown');
                  let entry = toolCallBuffer.get(key);
                  if (!entry) entry = { id: key, name: '', arguments: '' };
                  if (fc.name) entry.name = (entry.name || '') + String(fc.name);
                  if (fc.arguments) entry.arguments = (entry.arguments || '') + String(fc.arguments);
                  toolCallBuffer.set(key, entry);
                }
              } catch (e) {}
            }
          }
        }
        if (buffer && buffer.trim().startsWith('data: ')) {
          try {
            const jsonStr = buffer.trim().slice(6);
            if (jsonStr && jsonStr !== '[DONE]') {
              const data = JSON.parse(jsonStr);
              const choice = data.choices && data.choices[0];
              if (choice) {
                if (choice.finish_reason) curFinishReason = String(choice.finish_reason);
                const d = choice.delta;
                if (d) {
                  if (d.content) { curFullContent += d.content; handlers.onChunk(d.content); }
                  if (d.tool_calls) {
                    for (const tc of d.tool_calls) {
                      const idxKey = tc.index != null ? String(tc.index) : (tc.idx != null ? String(tc.idx) : '');
                      const rawId = tc.id || '';
                      const key = idxKey || rawId || 'auto_' + (autoIdx++);
                      let entry = toolCallBuffer.get(key);
                      if (!entry) entry = { id: rawId || key, name: '', arguments: '' };
                      if (tc.function && tc.function.name) entry.name = (entry.name || '') + tc.function.name;
                      if (tc.function && tc.function.arguments) entry.arguments += tc.function.arguments;
                      toolCallBuffer.set(key, entry);
                    }
                  }
                }
              }
            }
          } catch (e) {}
        }
        handlers.onTrace({ tag: 'STREAM_DONE', level: 'success', text: `流式传输完成 round ${round+1} 耗时: ${((Date.now() - startTime) / 1000).toFixed(2)}s finish_reason:${curFinishReason || 'none'} toolCalls:${toolCallBuffer.size} content:${curFullContent.length}` });
        const normFinish = String(curFinishReason || '').toLowerCase().replace(/_/g, '');
        let calls = [];
        for (const [k, v] of toolCallBuffer.entries()) {
          if (!v.name || !String(v.name).trim()) {
            handlers.onTrace({ tag: 'TOOL_SKIP', level: 'warn', text: `跳过空名工具调用 key=${k}` });
            continue;
          }
          let argsObj;
          try {
            const argStr = String(v.arguments || '').trim();
            argsObj = argStr ? JSON.parse(argStr) : {};
          } catch (e) {
            handlers.onTrace({ tag: 'TOOL_FIX', level: 'warn', text: `tool ${v.name} JSON 解析失败，尝试修复` });
            try { argsObj = JSON.parse(String(v.arguments || '').trim() + '}'); } catch (ee) { argsObj = {}; }
          }
          calls.push({ id: String(v.id || k), name: String(v.name).trim(), args: argsObj || {}, rawArgs: String(v.arguments || '') });
        }
        if (calls.length > 0) {
          curMessages.push({ role: 'assistant', content: curFullContent || '', tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
          const readLike = calls.filter(c => ['read_file', 'list_files', 'get_skeleton'].includes(c.name));
          const patchLike = calls.filter(c => c.name === 'apply_patch');
          const toolResults = [];
          if (readLike.length) {
            const promises = readLike.map(async c => {
              if ((c.name === 'read_file' || c.name === 'get_skeleton') && !c.args.file) {
                const fallback = (extraOpts.targetFile ? String(extraOpts.targetFile) : '') || (targetHtmlPath ? path.basename(targetHtmlPath) : 'index.html');
                c.args.file = fallback;
                handlers.onTrace({ tag: 'TOOL_FIX', level: 'info', text: `${c.name} 缺 file 自动补 ${fallback}` });
              }
              const r = await runTool(c.name, c.args, sandboxDir);
              return { call: c, res: r };
            });
            const settled = await Promise.all(promises);
            toolResults.push(...settled);
          }
          for (const c of patchLike) {
            if (!c.args.file) {
              const fallback = (extraOpts.targetFile ? String(extraOpts.targetFile) : '') || (targetHtmlPath ? path.basename(targetHtmlPath) : 'index.html');
              c.args.file = fallback;
              handlers.onTrace({ tag: 'TOOL_FIX', level: 'info', text: `apply_patch 缺 file 自动补 ${fallback}` });
            }
            if (!Array.isArray(c.args.patches) || c.args.patches.length === 0) {
              if (c.args.search !== undefined) {
                c.args.patches = [{ search: String(c.args.search), replace: String(c.args.replace || '') }];
                handlers.onTrace({ tag: 'TOOL_FIX', level: 'info', text: 'patches 兼容单块 {search,replace}' });
              }
            }
            const r = await runTool(c.name, c.args, sandboxDir);
            toolResults.push({ call: c, res: r });
            if (r && r.ok) toolPatched = true;
          }
          let hasToolErr = false;
          for (const { call, res } of toolResults) {
            const contentStr = JSON.stringify(res);
            curMessages.push({ role: 'tool', tool_call_id: call.id, content: contentStr });
            const tag = 'TOOL_' + call.name.toUpperCase();
            handlers.onTrace({ tag, level: res.ok ? 'success' : 'warn', text: `${call.name} ${res.ok ? 'OK' : 'FAIL'}: ${contentStr.slice(0, 400)}` });
            if (call.name === 'apply_patch' && res.ok) toolPatched = true;
            if (!res.ok && res.code && String(res.code).startsWith('SEARCH_')) hasToolErr = true;
            if (!res.ok && call.name === 'apply_patch') hasToolErr = true;
          }
          if (hasToolErr) {
            toolErrStreak++;
            handlers.onTrace({ tag: 'TOOL_ERR_STREAK', level: 'warn', text: `工具异常 ${toolErrStreak}/10` });
            if (toolErrStreak >= 10) { handlers.onTrace({ tag: 'TOOL_ERR_LIMIT', level: 'error', text: `连续10次工具异常，已停止` }); handlers.onError(new Error('连续10次工具调用异常（定位失败），已停止，请检查 SEARCH 是否2-5行唯一或附上更多上下文')); break; }
          } else {
            toolErrStreak = 0;
          }
          emptyStreak = 0;
          lastFullContent = curFullContent;
          lastFullReasoning = curFullReasoning;
          continue;
        } else {
          if (!String(curFullContent||'').trim() || String(curFullContent).trim().length < 20) {
            emptyStreak++;
            if (emptyStreak >= 10) { handlers.onTrace({ tag: 'EMPTY_LIMIT', level: 'warn', text: `连续10轮空内容，已停止` }); break; }
          } else {
            emptyStreak = 0;
          }
          toolErrStreak = 0;
          lastFullContent = curFullContent;
          lastFullReasoning = curFullReasoning;
          break;
        }
      } catch (innerErr) {
        if (innerErr && innerErr.name === 'AbortError') {
          handlers.onTrace({ tag: 'ABORT', level: 'warn', text: `已由用户停止（round ${round+1}）` });
          break;
        }
        throw innerErr;
      } finally {
        // roundTimeout 已移除，无需 clear
      }
    }
    let fullContent = lastFullContent || '';
    let saved = toolPatched;
    if (existingHtml && fullContent.includes('<<<<<<< SEARCH') && fullContent.includes('>>>>>>> REPLACE')) {
      const patchRes = applySearchReplace(existingHtml, fullContent);
      if (patchRes.count > 0 && targetHtmlPath) {
        fs.writeFileSync(targetHtmlPath, patchRes.modified, 'utf8');
        takeSnapshot(sandboxDir);
        saved = true;
        handlers.onTrace({ tag: 'DIFF_APPLY', level: 'success', text: `已成功应用 ${patchRes.count} 处局部差量修改到原型文件: ${path.basename(targetHtmlPath)}` });
        if (patchRes.failedBlocks.length > 0) {
          handlers.onTrace({ tag: 'DIFF_WARN', level: 'warn', text: `有 ${patchRes.failedBlocks.length} 处修改未能在原 HTML 中定位锚点，可能未完全生效` });
        }
      }
    }
    if (!saved) {
      const htmlMatch = fullContent.match(/\`\`\`html\s*([\s\S]*?)\`\`\`/i);
      let extractedHtml = htmlMatch ? htmlMatch[1].trim() : '';
      if (!extractedHtml && (fullContent.includes('<!DOCTYPE html>') || fullContent.includes('<html'))) {
        extractedHtml = fullContent.trim();
      }
      if (extractedHtml && targetHtmlPath) {
        fs.writeFileSync(targetHtmlPath, extractedHtml, 'utf8');
        takeSnapshot(sandboxDir);
        saved = true;
        handlers.onTrace({ tag: 'FS_SAVE', level: 'success', text: `已自动提取并全量覆盖写入原型文件: ${path.basename(targetHtmlPath)} (${(extractedHtml.length / 1024).toFixed(1)} KB)` });
      }
    }
    if (!saved && !toolPatched && targetHtmlPath) {
      handlers.onTrace({ tag: 'FS_WARN', level: 'warn', text: `大模型未输出有效的 SEARCH/REPLACE 差量块或完整 html 代码块，未修改文件` });
    }
    if ((saved || toolPatched) && targetHtmlPath) {
      try {
        let finalHtml = '';
        try { finalHtml = fs.readFileSync(targetHtmlPath, 'utf8'); } catch (e) { finalHtml = existingHtml; }
        const newHash = hashStr(finalHtml);
        lruSet(lastHashMem, lastKey, newHash);
        lruSet(prevHtmlMem, lastKey, finalHtml);
        lruSet(lastHashMem, fileKey, newHash);
        lruSet(prevHtmlMem, fileKey, finalHtml);
        const scopedKey = sandboxDir + '\0' + fileKey;
        lruSet(lastHashMem, scopedKey, newHash);
        lruSet(prevHtmlMem, scopedKey, finalHtml);
        const payload = {};
        payload[fileKey] = newHash;
        handlers.onTrace({ tag: 'LAST_HASH', level: 'info', text: JSON.stringify(payload) });
      } catch (e) {}
    }
    handlers.onClose();
  } catch (err) {
    if (err.name === 'AbortError' || (apiAbortController && apiAbortController.signal.aborted)) {
      handlers.onTrace({ tag: 'ABORT', level: 'warn', text: `用户已中断当前生成请求` });
      handlers.onClose();
    } else {
      handlers.onTrace({ tag: 'ERROR', level: 'error', text: String(err && err.message || err) });
      handlers.onError(err);
    }
  } finally {
    apiAbortController = null;
  }
}
ipcMain.handle('ai:get-config', () => loadAiCfg());
ipcMain.handle('ai:save-config', (ev, cfg) => {
  const cur = loadAiCfg();
  const next = Object.assign(cur, cfg || {});
  if (cfg && cfg.api) next.api = Object.assign(cur.api || {}, cfg.api);
  if (cfg && Array.isArray(cfg.visibleModelsCli)) next.visibleModelsCli = cfg.visibleModelsCli;
  if (cfg && Array.isArray(cfg.visibleModelsApi)) next.visibleModelsApi = cfg.visibleModelsApi;
  if (cfg && Array.isArray(cfg.visibleModels)) next.visibleModels = cfg.visibleModels;
  saveAiCfg(next);
  cliVerCache = { exe: null, version: null, promise: null };
  return { ok: true, config: next };
});

ipcMain.handle('ai:test-connection', async (ev, apiCfg) => {
  if (!apiCfg) return { ok: false, error: '未提供 API 配置' };
  const url = getCompletionsUrl(apiCfg.baseUrl);
  let key = String(apiCfg.apiKey || '').trim();
  if (/^Bearer\s+/i.test(key)) key = key.replace(/^Bearer\s+/i, '').trim();
  key = key.replace(/^["']|["']$/g, '').trim();
  const model = (apiCfg.model || 'deepseek-chat').trim();
  if (!url) return { ok: false, error: 'Base URL 不能为空' };
  if (!key) return { ok: false, error: 'API Key 不能为空' };
  if (key.length < 10) return { ok: false, error: 'API Key 过短（仅 '+key.length+' 字符），请检查是否复制完整' };
  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        stream: false
      })
    });
    const latency = Date.now() - t0;
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 401) {
        return { ok: false, error: `HTTP 401 认证失败: Key无效或与 BaseURL/模型不匹配 (provider=${apiCfg.provider||'custom'}, url=${url}, model=${model})。原始: ${t.slice(0,200)}。请确认已"保存并应用"且Key属于该服务商`, latency };
      }
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}`, latency };
    }
    return { ok: true, latency };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('ai:models', async () => {
  const cfg = loadAiCfg();
  const engine = cfg.engine || 'cli';
  let visible = null;
  if (engine === 'api') {
    visible = Array.isArray(cfg.visibleModelsApi) ? cfg.visibleModelsApi : (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length ? cfg.visibleModels : null);
  } else {
    visible = Array.isArray(cfg.visibleModelsCli) ? cfg.visibleModelsCli : (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length ? cfg.visibleModels : null);
  }

  if (engine === 'api') {
    const apiCfg = cfg.api || {};
    const custom = Array.isArray(apiCfg.customModels) && apiCfg.customModels.length
      ? apiCfg.customModels
      : ['deepseek-chat', 'deepseek-reasoner'];
    const prov = apiCfg.provider || 'custom';
    const provNames = {
      deepseek: 'DeepSeek 官方',
      ali: '阿里百炼 DashScope',
      siliconflow: '硅基流动 SiliconFlow',
      openrouter: 'OpenRouter',
      custom: '自定义 API'
    };
    const provLabel = provNames[prov] || '自定义 API';
    const modelsList = custom.map(m => ({ id: m, name: m }));
    const groups = [{
      provider: prov,
      label: provLabel,
      models: modelsList
    }];
    return { ok: true, groups, default: apiCfg.model || (custom[0] || 'deepseek-chat'), engine: 'api', visibleModels: visible || [] };
  }

  // P1-4 fix F03 async 改用异步解析并加 3000ms 超时保护
  let exe = null;
  try{ exe = await Promise.race([ resolveCliAsync(), new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] ai:models resolveCli timeout 3000ms'); }catch(e){} res(null); }, 3000)) ]); }catch(e){ try{ console.log('[F03 async] ai:models resolveCli error', e); }catch(ee){} exe=null; }
  if (!exe) return { ok: false, error: '未找到 opencode CLI', engine: 'cli', visibleModels: visible || [] };
  try {
    const r = await runCliAsync(exe, ['models'], 20000);
    if (r.status !== 0) return { ok: false, error: extractCliError(r.stderr, r.status) || 'opencode models 执行失败', engine: 'cli', visibleModels: visible || [] };
    const ids = stripAnsi(r.stdout).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const byProv = {};
    ids.forEach((id) => {
      const i = id.indexOf('/');
      const provider = i > 0 ? id.slice(0, i) : '';
      const model = i > 0 ? id.slice(i + 1) : id;
      if (!provider || !model) return;
      (byProv[provider] = byProv[provider] || []).push({ id, name: model });
    });
    const keys = Object.keys(byProv);
    const names = providerDisplayNames(keys);
    const groups = keys.map((k) => ({
      provider: k,
      label: names[k] ? names[k] + '（' + k + '）' : k,
      models: byProv[k]
    })).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return { ok: true, groups, default: process.env.PROTO_AI_MODEL || DEFAULT_AI_MODEL, engine: 'cli', visibleModels: visible || [] };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), engine: 'cli', visibleModels: visible || [] };
  }
});

/* 查询指定 opencode 会话 ID 所属的工作目录（session list --format json，cwd=沙箱根以列出全部）。
   工具用它校验 localStorage 中缓存的会话 oid 是否属于当前沙箱目录——
   cwd 与会话目录不一致会让 opencode 卡死（不输出、不退出）。 */
ipcMain.handle('ai:session-dirs', async (ev, oids) => {
  if (!Array.isArray(oids) || !oids.length) return {};
  // P1-4 fix F03 async 改用异步并加 3000ms 超时保护
  let exe = null;
  try{ exe = await Promise.race([ resolveCliAsync(), new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] ai:session-dirs resolveCli timeout 3000ms'); }catch(e){} res(null); }, 3000)) ]); }catch(e){ try{ console.log('[F03 async] ai:session-dirs error', e); }catch(ee){} exe=null; }
  if (!exe) return {};
  try {
    const r = await runCliAsync(exe, ['session', 'list', '--format', 'json'], 30000, SANDBOX_ROOT);
    if (r.status !== 0) return {};
    const t = stripAnsi(r.stdout);
    const i = t.indexOf('[');
    if (i < 0) return {};
    const arr = JSON.parse(t.slice(i));
    if (!Array.isArray(arr)) return {};
    const map = {};
    arr.forEach((s) => { if (s && s.id && s.directory) map[s.id] = s.directory; });
    const out = {};
    oids.forEach((o) => { if (map[o]) out[o] = map[o]; });
    return out;
  } catch (e) { return {}; }
});

ipcMain.handle('ai:set-path', (ev, p) => { const c = loadAiCfg(); c.cliPath = p || ''; saveAiCfg(c); cliVerCache = { exe: null, version: null, promise: null }; return 'ok'; });

ipcMain.handle('ai:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, {
    defaultPath: pkgDir, title: '选择 opencode CLI 可执行文件',
    filters: [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat'] }], properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const c = loadAiCfg(); c.cliPath = r.filePaths[0]; saveAiCfg(c);
  cliVerCache = { exe: null, version: null, promise: null };
  return { path: r.filePaths[0] };
});

ipcMain.handle('ai:ask', async (ev, prompt, sessionId, sandboxDir, model, extraOpts) => {
  extraOpts = extraOpts || {};
  if (extraOpts && typeof extraOpts === 'object') {
    if (!extraOpts.sessionId && sessionId) extraOpts.sessionId = sessionId;
  }
  const cfg = loadAiCfg();
  const engine = cfg.engine || 'cli';

  if (aiChild || apiAbortController) {
    if (aiChild && (aiChild.exitCode !== null || aiChild.signalCode !== null || aiChild.killed)) { aiChild = null; }
    else if (!aiChild && !apiAbortController) {}
    else return { ok: false, error: 'busy' };
  }
  aiCancelRequested = false;
  takeSnapshot(sandboxDir);
  const win = BrowserWindow.fromWebContents(ev.sender);
  const send = (payload) => { if (win && !win.isDestroyed()) win.webContents.send('ai:event', payload); };

  if (engine === 'api') {
    const apiCfg = cfg.api || {};
    return new Promise((resolve) => {
      startDirectApiRun(apiCfg, model, {
        onStart: () => resolve({ ok: true }),
        onReasoning: (text) => send({ type: 'thinking', text }),
        onChunk: (text) => send({ type: 'chunk', text }),
        onTrace: (trace) => send({ type: 'trace', trace }),
        onError: (err) => send({ type: 'error', message: String(err && err.message || err) }),
        onClose: () => send({ type: 'done' })
      }, aiWorkDir(sandboxDir), prompt, extraOpts);
    });
  }

  // P1-4 fix F03 async 改用异步解析并加 3000ms 超时保护
  let exe = null;
  try{ exe = await Promise.race([ resolveCliAsync(), new Promise(res=> setTimeout(()=> { try{ console.log('[F03 async] ai:ask resolveCli timeout 3000ms'); }catch(e){} res(null); }, 3000)) ]); }catch(e){ try{ console.log('[F03 async] ai:ask resolveCli error', e); }catch(ee){} exe=null; }
  if (!exe) return { ok: false, error: '未找到 opencode，请先在系统安装（npm/scoop/choco），或在「设置」中切换为 API 直连模式或指定 CLI 路径。' };
  
  const want = String(model || '').trim();
  const modelsFinal = (want && want !== '__none__') ? [want] : [null];
  sessionId = String(sessionId || '').trim() || null;
  
  send({ type: 'trace', trace: { tag: 'CLI_START', level: 'info', text: `启动 OpenCode CLI 任务 (模型: ${want || '默认'})` } });

  return new Promise((resolve) => {
    let resolved = false;
    let settled = false;
    const attempt = (idx) => {
      if (settled) return;
      if (idx >= modelsFinal.length) {
        if (!resolved) { resolved = true; settled = true; resolve({ ok: false, error: 'opencode 未能输出任何结果，请检查 CLI 与网络后重试。' }); }
        return;
      }
      let gotChunk = false;
      startAiRun(exe, modelsFinal[idx], {
        onStart: () => { if (!resolved) { resolved = true; resolve({ ok: true }); } },
        onSession: (id) => { if (id && typeof id === 'string') { sessionId = id; send({ type: 'session', id }); send({ type: 'trace', trace: { tag: 'SESSION', level: 'info', text: `会话 ID: ${id}` } }); } },
        onReasoning: (text) => { send({ type: 'thinking', text }); },
        onChunk: (text) => { gotChunk = true; send({ type: 'chunk', text }); },
        onError: (err) => {
          if (settled) return;
          const msg = String(err && err.message || err);
          send({ type: 'trace', trace: { tag: 'CLI_ERR', level: 'error', text: msg } });
          if (gotChunk) { settled = true; send({ type: 'error', message: msg }); return; }
          if (/Session not found/i.test(msg) && sessionId) {
            sessionId = null;
            send({ type: 'session', id: '' });
            attempt(idx);
            return;
          }
          if (want && want !== '__none__') {
            settled = true;
            if (!resolved) { resolved = true; resolve({ ok: false, error: '指定模型 [' + want + '] 调用失败：' + msg }); }
            send({ type: 'error', message: '指定模型 [' + want + '] 调用失败：' + msg });
            return;
          }
          if (idx + 1 < modelsFinal.length) { attempt(idx + 1); return; }
          settled = true;
          if (!resolved) { resolved = true; resolve({ ok: false, error: msg }); }
          send({ type: 'error', message: msg });
        },
        onClose: () => {
          if (settled) return;
          settled = true;
          send({ type: 'trace', trace: { tag: 'CLI_DONE', level: 'success', text: `OpenCode 进程已正常退出` } });
          send({ type: 'done' });
        }
      }, aiWorkDir(sandboxDir), sessionId, withToolPrompt(prompt, false));
    };
    attempt(0);
  });
});

ipcMain.handle('ai:cancel', (ev) => {
  aiCancelRequested = true;
  if (aiChild) { try { aiChild.kill(); } catch (e) {} aiChild = null; }
  if (apiAbortController) { try { apiAbortController.abort(); } catch (e) {} apiAbortController = null; }
  const win = BrowserWindow.fromWebContents(ev.sender);
  if (win && !win.isDestroyed()) win.webContents.send('ai:event', { type: 'done' });
  return 'ok';
});

ipcMain.handle('ai:is-busy', () => {
  if (aiChild) {
    if (aiChild.exitCode !== null || aiChild.signalCode !== null || aiChild.killed) { aiChild = null; }
  }
  return !!(aiChild || apiAbortController);
});

/* ═══════ Git 协同与多项目自动建库体系（基于沙箱总根目录 SANDBOX_ROOT） ═══════ */
const GIT_CONFIG_PATH = path.join(app.getPath('userData'), 'git-config.json');

function loadGitConfig() {
  try {
    if (fs.existsSync(GIT_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(GIT_CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return { defaultConfig: {}, projects: {} };
}

function saveGitConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(GIT_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(GIT_CONFIG_PATH, JSON.stringify(cfg || {}, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function getProjectGitConfig(projectName) {
  const all = loadGitConfig();
  const def = all.defaultConfig || {};
  const proj = (projectName && all.projects && all.projects[projectName]) || {};
  return {
    remoteUrl: proj.remoteUrl || def.remoteUrl || '',
    branch: proj.branch || def.branch || 'main',
    username: proj.username || def.username || '',
    token: proj.token || def.token || '',
    authorName: proj.authorName || def.authorName || '产品设计师',
    authorEmail: proj.authorEmail || def.authorEmail || 'designer@local'
  };
}

function buildGitAuthUrl(remoteUrl, username, token) {
  if (!remoteUrl) return '';
  let url = remoteUrl.trim();
  if (!token && !username) return url;
  try {
    const u = new URL(url);
    if (username) u.username = encodeURIComponent(username.trim());
    if (token) u.password = encodeURIComponent(token.trim());
    return u.toString();
  } catch (e) {
    if (url.startsWith('https://')) {
      const auth = (username ? encodeURIComponent(username.trim()) : '') + (token ? ':' + encodeURIComponent(token.trim()) : '');
      return auth ? 'https://' + auth + '@' + url.slice(8) : url;
    }
    return url;
  }
}

function sanitizeGitError(errText) {
  if (!errText) return '操作失败';
  let t = String(errText).trim();
  t = t.replace(/https:\/\/[^:@]+:[^@]+@/g, 'https://***:***@');
  if (/Authentication failed|401|403|not authorized|could not read Username|Invalid username or password/i.test(t)) {
    return 'Git 鉴权失败：账号密码或 Access Token 错误或已过期（请确保 Token 已开启 write_repository 读写权限）';
  }
  if (/Could not resolve host|Connection refused|timed out|Failed to connect/i.test(t)) {
    return '网络连接失败：无法访问 Git 远程仓库，请检查网络或仓库地址';
  }
  if (/Repository not found|remote: Not Found/i.test(t)) {
    return '远程仓库不存在或无访问权限，请核对仓库 URL';
  }
  if (/fetch first|non-fast-forward|Updates were rejected/i.test(t)) {
    return '远程仓库存在未同步的新版本，请先执行拉取同步后再上传';
  }
  return t;
}

function decodeGitOctal(str) {
  if (!str) return '';
  let s = String(str).trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  if (s.indexOf('\\') >= 0) {
    try {
      const bytes = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 3 < s.length && /^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
          bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
          i += 3;
        } else if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '\\') {
          bytes.push(92);
          i += 1;
        } else {
          bytes.push(s.charCodeAt(i));
        }
      }
      return Buffer.from(bytes).toString('utf8');
    } catch (e) {}
  }
  return s;
}

function runGit(cwd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    try {
      const gitArgs = ['-c', 'core.quotepath=false', ...args];
      const child = spawn('git', gitArgs, {
        cwd,
        env: Object.assign({}, process.env, {
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C.UTF-8'
        }),
        windowsHide: true
      });
      let stdout = '', stderr = '';
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (e) {}
          resolve({ status: 124, stdout, stderr: 'Git 操作超时 (' + timeoutMs + 'ms)' });
        }, timeoutMs);
      }
      child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({ status: -1, stdout, stderr: String(err && err.message || err) });
      });
      child.on('close', (status) => {
        if (timer) clearTimeout(timer);
        resolve({ status: status != null ? status : 0, stdout, stderr });
      });
    } catch (e) {
      resolve({ status: -1, stdout: '', stderr: String(e && e.message || e) });
    }
  });
}

// 确保沙箱总根目录的 Git 仓库健全，并清理子项目历史遗留的嵌套 .git
async function ensureSandboxGitRepo(cfg) {
  try{
  if (!fs.existsSync(SANDBOX_ROOT)) fs.mkdirSync(SANDBOX_ROOT, { recursive: true });

  // 清理子项目内旧版遗留的嵌套 .git 文件夹
  try {
    const entries = fs.readdirSync(SANDBOX_ROOT, { withFileTypes: true });
    entries.forEach((d) => {
      if (d.isDirectory() && d.name !== '.git') {
        const nestedGit = path.join(SANDBOX_ROOT, d.name, '.git');
        if (fs.existsSync(nestedGit)) {
          try { fs.rmSync(nestedGit, { recursive: true, force: true }); } catch (e) {}
        }
      }
    });
  } catch (e) {}

  const gitDir = path.join(SANDBOX_ROOT, '.git');
  const branch = (cfg && cfg.branch) || 'main';
  if (!fs.existsSync(gitDir)) {
    await runGit(SANDBOX_ROOT, ['init', '-b', branch]);
    const gitignorePath = path.join(SANDBOX_ROOT, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      try {
        fs.writeFileSync(gitignorePath, ".DS_Store\nThumbs.db\ndesktop.ini\n*.tmp\ntemp/\n", 'utf8');
      } catch (e) {}
    }
  }

  await runGit(SANDBOX_ROOT, ['config', 'core.quotepath', 'false']);

  if (cfg && cfg.remoteUrl) {
    const remotes = await runGit(SANDBOX_ROOT, ['remote']);
    if (remotes.stdout.indexOf('origin') >= 0) {
      await runGit(SANDBOX_ROOT, ['remote', 'set-url', 'origin', cfg.remoteUrl.trim()]);
    } else {
      await runGit(SANDBOX_ROOT, ['remote', 'add', 'origin', cfg.remoteUrl.trim()]);
    }
  }
  if (cfg && cfg.authorName) {
    await runGit(SANDBOX_ROOT, ['config', 'user.name', cfg.authorName]);
  }
  if (cfg && cfg.authorEmail) {
    await runGit(SANDBOX_ROOT, ['config', 'user.email', cfg.authorEmail]);
  }
  }catch(e){ try{ dialog.showMessageBoxSync({type:'error', title:'Git初始化失败', message:String(e.message)}); }catch(_e){} throw e; }
}

ipcMain.handle('git:config-get', (ev, projectName) => {
  const cfg = getProjectGitConfig(projectName);
  return { ok: true, config: cfg };
});

ipcMain.handle('git:config-save', async (ev, o) => {
  const projName = (o && o.project) || '';
  const cfg = (o && o.config) || {};
  const all = loadGitConfig();
  all.defaultConfig = Object.assign(all.defaultConfig || {}, cfg);
  if (projName) {
    all.projects = all.projects || {};
    all.projects[projName] = Object.assign(all.projects[projName] || {}, cfg);
  }
  saveGitConfig(all);

  await ensureSandboxGitRepo(cfg);
  return { ok: true, config: getProjectGitConfig(projName) };
});

ipcMain.handle('git:list-branches', async (ev, o) => {
  const projName = (o && o.project) || '';
  const cfg = getProjectGitConfig(projName);
  const remoteUrl = (o && o.remoteUrl) || cfg.remoteUrl;
  const username = (o && o.username) != null ? o.username : cfg.username;
  const token = (o && o.token) != null ? o.token : cfg.token;
  const branches = new Set();
  if (cfg.branch) branches.add(cfg.branch);
  branches.add('main');
  branches.add('master');

  if (remoteUrl) {
    const authUrl = buildGitAuthUrl(remoteUrl, username, token);
    const remRes = await runGit(SANDBOX_ROOT, ['ls-remote', '--heads', authUrl], 15000);
    if (remRes.status === 0 && remRes.stdout) {
      remRes.stdout.split(/\r?\n/).forEach((line) => {
        const parts = line.split(/\s+/);
        const ref = parts[1] || '';
        if (ref.startsWith('refs/heads/')) {
          branches.add(ref.replace('refs/heads/', '').trim());
        }
      });
    }
  }

  if (fs.existsSync(path.join(SANDBOX_ROOT, '.git'))) {
    const locRes = await runGit(SANDBOX_ROOT, ['branch', '--list']);
    if (locRes.status === 0 && locRes.stdout) {
      locRes.stdout.split(/\r?\n/).forEach((b) => {
        const name = b.replace(/^[\*\s]+/, '').trim();
        if (name && name !== '(HEAD' && !name.startsWith('(')) branches.add(name);
      });
    }
  }

  return { ok: true, branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main' };
});

ipcMain.handle('git:test-connection', async (ev, cfg) => {
  if (!cfg || !cfg.remoteUrl) return { ok: false, error: '请先填写远程仓库地址' };
  const authUrl = buildGitAuthUrl(cfg.remoteUrl, cfg.username, cfg.token);
  const t0 = Date.now();
  const res = await runGit(process.cwd(), ['ls-remote', '--heads', authUrl], 15000);
  const latency = Date.now() - t0;
  if (res.status === 0) {
    return { ok: true, latency };
  }
  return { ok: false, error: sanitizeGitError(res.stderr || res.stdout) };
});

ipcMain.handle('git:status', async (ev, o) => {
  const projName = (typeof o === 'string' ? o : (o && o.project)) || '';
  const targetBranch = (o && o.branch) || (getProjectGitConfig(projName).branch) || 'main';
  if (!isValidBranch(targetBranch)) return { ok: false, error: '非法分支名' };
  const cfg = getProjectGitConfig(projName);
  await ensureSandboxGitRepo(cfg);

  const handledPaths = new Set();
  const tree = {};
  let totalCount = 0;
  // D-G1 已归一：复用顶层 GIT_STATUS_MAP（原 statusMap 合并至 GIT_STATUS_MAP，handledPaths 通过 gitHandledPath 共享去重逻辑）

  // 1. 工作区未提交变更
  const res = await runGit(SANDBOX_ROOT, ['status', '--porcelain=v1', '-uall']);
  if (res.status === 0 && res.stdout) {
    const lines = res.stdout.split(/\r?\n/).filter(Boolean);
    lines.forEach((line) => {
      const flag = line.slice(0, 2);
      const relRaw = decodeGitOctal(line.slice(3).trim());
      // L02: R/C 重命名场景下 relRaw 为 "old -> new"，需双路径入库
      const relRaws = relRaw.split(" -> ").map(s => s.trim()).filter(Boolean);
      relRaws.forEach((singleRaw) => {
        const relPath = singleRaw.replace(/\\/g, '/');
        if (!relPath || relPath === '.git' || relPath.startsWith('.git/') || gitHandledPath(handledPaths, relPath)) return;
        const st = gitStatusInfo(flag);
        const parts = relPath.split('/');
        const pProject = parts.length > 2 ? parts[0] : (parts.length > 1 ? parts[0] : '默认项目');
        const pProto = parts.length > 2 ? parts[1] : (parts.length > 1 ? parts[1] : parts[0]);
        const pSub = parts.length > 2 ? parts.slice(2).join('/') : (parts.length > 1 ? parts.slice(1).join('/') : relPath);
        tree[pProject] = tree[pProject] || {};
        tree[pProject][pProto] = tree[pProject][pProto] || [];
        tree[pProject][pProto].push({
          path: relPath,
          project: pProject,
          proto: pProto,
          subPath: pSub,
          code: st.code,
          label: st.label
        });
        totalCount++;
      });
    });
  }

  // 2. 本地已提交但未推送到目标分支的变更
  try {
    const headCheck = await runGit(SANDBOX_ROOT, ['rev-parse', 'HEAD']);
    if (headCheck.status === 0 && headCheck.stdout.trim()) {
      let remoteExists = false;
      const remoteCheck = await runGit(SANDBOX_ROOT, ['rev-parse', '--verify', 'origin/' + targetBranch]);
      if (remoteCheck.status === 0) remoteExists = true;

      let unpushedLines = [];
      if (remoteExists) {
        const diffRes = await runGit(SANDBOX_ROOT, ['diff', '--name-status', 'origin/' + targetBranch + '..HEAD']);
        if (diffRes.status === 0) unpushedLines = diffRes.stdout.split(/\r?\n/).filter(Boolean);
      } else {
        const lsRes = await runGit(SANDBOX_ROOT, ['ls-tree', '-r', '--name-only', 'HEAD']);
        if (lsRes.status === 0) unpushedLines = lsRes.stdout.split(/\r?\n/).filter(Boolean).map((f) => 'A\t' + f);
      }

      unpushedLines.forEach((line) => {
        const parts = line.split(/\t+|\s+/);
        const flag = parts[0] ? parts[0].slice(0, 1) : 'A';
        var _si=gitStatusInfo(flag); const stCode=_si.code; const label=_si.label;
        // L02: --name-status 重命名时 parts[1] 为 old, parts[2] 为 new，需双入库
        const candidates = [];
        if (parts[1]) candidates.push(parts[1]);
        if (parts[2]) candidates.push(parts[2]);
        if (!candidates.length) candidates.push(line);
        candidates.forEach((rawPath) => {
          const relPath = decodeGitOctal(rawPath).replace(/\\/g, '/');
          if (!relPath || relPath === '.git' || relPath.startsWith('.git/') || gitHandledPath(handledPaths, relPath)) return;
          const pathParts = relPath.split('/');
          const pProject = pathParts.length > 2 ? pathParts[0] : (pathParts.length > 1 ? pathParts[0] : '默认项目');
          const pProto = pathParts.length > 2 ? pathParts[1] : (pathParts.length > 1 ? pathParts[1] : pathParts[0]);
          const pSub = pathParts.length > 2 ? pathParts.slice(2).join('/') : (pathParts.length > 1 ? pathParts.slice(1).join('/') : relPath);
          tree[pProject] = tree[pProject] || {};
          tree[pProject][pProto] = tree[pProject][pProto] || [];
          tree[pProject][pProto].push({
            path: relPath,
            project: pProject,
            proto: pProto,
            subPath: pSub,
            code: stCode,
            label
          });
          totalCount++;
        });
      });
    }
  } catch (e) {}

  const projectList = Object.keys(tree).map((pName) => {
    const protoList = Object.keys(tree[pName]).map((prName) => ({
      proto: prName,
      files: tree[pName][prName]
    })).sort((a, b) => a.proto.localeCompare(b.proto, 'zh-CN'));
    return {
      project: pName,
      isCurrent: (pName === projName),
      protos: protoList
    };
  }).sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return a.project.localeCompare(b.project, 'zh-CN');
  });

  return { ok: true, projects: projectList, totalCount, branch: targetBranch };
});

ipcMain.handle('git:push', async (ev, o) => {
  const projName = (o && o.project) || '';
  const files = (o && Array.isArray(o.files)) ? o.files : [];
  const message = (o && o.message && o.message.trim()) || '更新原型与文档数据';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };
  const force = !!(o && o.force);

  if (!cfg.remoteUrl) return { ok: false, error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  if (!files.length) return { ok: false, error: '请勾选需要上传的文件' };

  await ensureSandboxGitRepo(cfg);
  const authUrl = buildGitAuthUrl(cfg.remoteUrl, cfg.username, cfg.token);

  // 1. 重置当前暂存区
  await runGit(SANDBOX_ROOT, ['reset']);

  // 2. 依次暂存选中的工作区文件
  for (const rel of files) {
    const joined = path.join(SANDBOX_ROOT, rel);
    if (!isSafeGitRel(rel) || !isSubPath(joined, SANDBOX_ROOT)) { // G03 git:push isSafeGitRel + isSubPath double check, -- retained
      try {
        const dir = logsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
        const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
        try { var st = fs.statSync(path.join(dir, 'app-' + ymd + '.log')); if (st.size > 5*1024*1024) fs.renameSync(path.join(dir, 'app-' + ymd + '.log'), path.join(dir, 'app-' + ymd + '.1.log')); } catch (e) {}
        fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][WARN][git:push] skip unsafe rel: ' + String(rel) + '\n', 'utf8');
      } catch (e) {}
      try { console.warn('[WARN][git:push] skip unsafe rel', rel); } catch (e) {}
      continue;
    }
    const full = joined;
    if (fs.existsSync(full)) {
      await runGit(SANDBOX_ROOT, ['add', '--', rel]);
    } else {
      await runGit(SANDBOX_ROOT, ['rm', '--cached', '--ignore-unmatch', '--', rel]);
    }
  }

  // 3. 检查是否有需要新提交的内容
  const stagedCheck = await runGit(SANDBOX_ROOT, ['diff', '--cached', '--name-only']);
  if (stagedCheck.status === 0 && stagedCheck.stdout && stagedCheck.stdout.trim()) {
    const commitRes = await runGit(SANDBOX_ROOT, ['commit', '-m', message]);
    if (commitRes.status !== 0 && commitRes.stdout.indexOf('nothing to commit') < 0) {
      return { ok: false, error: sanitizeGitError(commitRes.stderr || commitRes.stdout) };
    }
  }

  // 4. 推送到远程分支（HEAD:refs/heads/${branch}，支持 --force 覆盖远程清空/分叉）
  const pushArgs = ['push', '-u'];
  if (force) pushArgs.push('--force');
  pushArgs.push(authUrl, `HEAD:refs/heads/${branch}`);

  const pushRes = await runGit(SANDBOX_ROOT, pushArgs, 35000);
  if (pushRes.status !== 0) {
    const rawErr = pushRes.stderr || pushRes.stdout;
    const needPull = /fetch first|non-fast-forward|Updates were rejected/i.test(rawErr);
    return {
      ok: false,
      needPull,
      canForce: needPull,
      error: needPull ? '远程仓库存在不一致的历史版本（如远端被清空或重置）。您可以先执行拉取同步，或点击「强制覆盖上传」将本地沙箱完整发布至远程。' : sanitizeGitError(rawErr)
    };
  }

  return { ok: true, message: force ? '强制覆盖发布成功' : '发布成功', filesCount: files.length, branch, forced: force };
});

ipcMain.handle('git:fetch-diff', async (ev, o) => {
  const projName = (typeof o === 'string' ? o : (o && o.project)) || '';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };

  if (!cfg.remoteUrl) return { ok: false, error: '未配置 Git 远程仓库地址，请先进行仓库设置' };

  await ensureSandboxGitRepo(cfg);
  const authUrl = buildGitAuthUrl(cfg.remoteUrl, cfg.username, cfg.token);

  // 静默 Fetch 目标分支
  const fetchRes = await runGit(SANDBOX_ROOT, ['fetch', authUrl, branch], 30000);
  if (fetchRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  }

  const hasHead = (await runGit(SANDBOX_ROOT, ['rev-parse', 'HEAD'])).status === 0;
  let diffRes = null;
  if (hasHead) {
    diffRes = await runGit(SANDBOX_ROOT, ['diff', '--name-status', 'HEAD...FETCH_HEAD']);
  } else {
    diffRes = await runGit(SANDBOX_ROOT, ['ls-tree', '-r', '--name-only', 'FETCH_HEAD']);
  }

  if (diffRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(diffRes.stderr) };
  }

  const tree = {};
  let totalCount = 0;
  const handledPaths = new Set(); // D-G1 与 git:status 共享去重逻辑（通过 gitHandledPath 工具函数复用）
  // 复用顶层 GIT_STATUS_MAP

  const rawLines = diffRes.stdout.split(/\r?\n/).filter(Boolean);
  rawLines.forEach((line) => {
    let stCode = 'add', label = '新增', relPath = '';
    if (hasHead) {
      const parts = line.split(/\t+|\s+/);
      const flag = parts[0] ? parts[0].slice(0, 1) : 'M';
      var _si2=gitStatusInfo(flag); stCode=_si2.code; label=_si2.label;
      relPath = decodeGitOctal(parts[1] || '').replace(/\\/g, '/');
    } else {
      relPath = decodeGitOctal(line).replace(/\\/g, '/');
    }

    if (!relPath || relPath === '.git' || relPath.startsWith('.git/') || gitHandledPath(handledPaths, relPath)) return;
    const pathParts = relPath.split('/');
    const pProject = pathParts.length > 2 ? pathParts[0] : (pathParts.length > 1 ? pathParts[0] : '默认项目');
    const pProto = pathParts.length > 2 ? pathParts[1] : (pathParts.length > 1 ? pathParts[1] : pathParts[0]);
    const pSub = pathParts.length > 2 ? pathParts.slice(2).join('/') : (pathParts.length > 1 ? pathParts.slice(1).join('/') : relPath);

    tree[pProject] = tree[pProject] || {};
    tree[pProject][pProto] = tree[pProject][pProto] || [];
    tree[pProject][pProto].push({
      path: relPath,
      project: pProject,
      proto: pProto,
      subPath: pSub,
      code: stCode,
      label
    });
    totalCount++;
  });

  const projectList = Object.keys(tree).map((pName) => {
    const protoList = Object.keys(tree[pName]).map((prName) => ({
      proto: prName,
      files: tree[pName][prName]
    })).sort((a, b) => a.proto.localeCompare(b.proto, 'zh-CN'));
    return {
      project: pName,
      isCurrent: (pName === projName),
      protos: protoList
    };
  }).sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return a.project.localeCompare(b.project, 'zh-CN');
  });

  return { ok: true, projects: projectList, totalCount, branch };
});

ipcMain.handle('git:pull', async (ev, o) => {
  const projName = (o && o.project) || '';
  const files = (o && Array.isArray(o.files)) ? o.files : null;
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };

  if (!cfg.remoteUrl) return { ok: false, error: '未配置 Git 远程仓库地址，请先进行仓库设置' };

  await ensureSandboxGitRepo(cfg);
  const authUrl = buildGitAuthUrl(cfg.remoteUrl, cfg.username, cfg.token);

  // 1. Fetch
  const fetchRes = await runGit(SANDBOX_ROOT, ['fetch', authUrl, branch], 30000);
  if (fetchRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  }

  const affectedProjects = new Set();

  // 2. 选择性检出指定的目录/文件
  if (files && files.length) {
    for (const rel of files) {
      const fullPath = path.join(SANDBOX_ROOT, rel);
      if (!isSafeGitRel(rel) || !isSubPath(fullPath, SANDBOX_ROOT)) { // G03 git:pull isSafeGitRel + isSubPath double check, -- retained
        try {
          const dir = logsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
          const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
          const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
          try { var st = fs.statSync(path.join(dir, 'app-' + ymd + '.log')); if (st.size > 5*1024*1024) fs.renameSync(path.join(dir, 'app-' + ymd + '.log'), path.join(dir, 'app-' + ymd + '.1.log')); } catch (e) {}
          fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][WARN][git:pull] skip unsafe rel: ' + String(rel) + '\n', 'utf8');
        } catch (e) {}
        try { console.warn('[WARN][git:pull] skip unsafe rel', rel); } catch (e) {}
        continue;
      }
      // 保证本地沙箱父级文件夹递归自动创建
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });

      const parts = rel.split('/');
      if (parts.length > 0) affectedProjects.add(parts[0]);

      // 从 FETCH_HEAD 检出该文件
      await runGit(SANDBOX_ROOT, ['checkout', 'FETCH_HEAD', '--', rel]);
    }
  } else {
    // 全量合并拉取
    const mergeRes = await runGit(SANDBOX_ROOT, ['merge', 'FETCH_HEAD']);
    if (mergeRes.status !== 0) {
      return { ok: false, error: sanitizeGitError(mergeRes.stderr || mergeRes.stdout) };
    }
  }

  return {
    ok: true,
    message: '同步完成',
    filesCount: (files && files.length) || 0,
    affectedProjects: Array.from(affectedProjects),
    branch
  };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 1080,
    minWidth: 1024,
    minHeight: 680,
    title: '原型预览',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      webSecurity: true, // P0-1 fix
      allowFileAccessFromFiles: false, // P0-1 fix
      allowRunningInsecureContent: false, // P0-1 fix
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.loadFile('原型+文档.html');
}

app.whenReady().then(() => {
  migrateLegacySandbox(); /* 旧版 exe 旁沙箱数据迁移（弹窗询问） */
  ensureSandbox();        /* 展开内置 seed 为独立项目（同名目录已存在则跳过） */
  normalizeProjects();    /* 旧版扁平目录 → 项目结构整理（一次性） */
  cleanOldLogs();         /* 清理 7 天前本地日志 */
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
