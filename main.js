const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
/* L4 统一IPC割接：收敛至 runtimes/engine + providers，删除旧手写 CLI/API 双轨 */
const { detectAllAgents } = require('./runtimes/detection');
const { getAgentDef, getAllAgentDefs } = require('./runtimes/registry');
const { resolveAgentExecutable } = require('./runtimes/resolution');
const { startAgentExecution } = require('./runtimes/engine');
const { buildOpenCodeByokProviderConfig } = require('./runtimes/byok-opencode');
const { testProviderConnection } = require('./providers/connection-test');
const { fetchProviderModels } = require('./providers/model-fetcher');
const { killProcessTree } = require('./platform/process');
const { createCommandInvocation } = require('./platform/command');
const { applyAgentLaunchEnv } = require('./platform/env');
/* P0 Git止血：安全原语 + 凭据分离存储（只增 require，不改旧逻辑） */
const gitAuth = require('./git/auth');
const gitConfigStore = require('./git/config-store');
const os = require('node:os');

let activeExecution = null;

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
/* T4.4: 导出解析只接受标准 JSON 数组，非标旧格式直接返回 null（单文件导入兜底） */
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
    try { arr = JSON.parse(arrText); } catch (e) { return null; }
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
    cliPaths: {},
    agentId: 'opencode',
    mainAgent: 'opencode',
    engine: 'cli', // 'cli' | 'api'
    api: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      customModels: ['deepseek-chat', 'deepseek-reasoner'],
      enableTools: true
    },
    customModelsCli: [],
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
    if (raw && Array.isArray(raw.customModelsCli)) res.customModelsCli = raw.customModelsCli;
    if (raw && typeof raw.agentId === 'string' && raw.agentId) res.agentId = raw.agentId;
    if (raw && typeof raw.mainAgent === 'string' && raw.mainAgent) res.mainAgent = raw.mainAgent;
    if (raw && typeof raw.cliPaths === 'object' && raw.cliPaths) res.cliPaths = raw.cliPaths;
    return res;
  } catch (e) {
    return defaultAiCfg();
  }
}
function saveAiCfg(c) { try { fs.writeFileSync(aiCfgFile(), JSON.stringify(c, null, 2)); } catch (e) {} }

/* L4: 旧 CLI 发现/版本探测已删除，统一走 runtimes/resolution + runtimes/detection */

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
/* L4: 旧 cliVersion/withToolPrompt/isolate 已删除，统一走 runtimes/engine + byok-opencode */

/* L4: 旧 startAiRun/extractCliError 已删除，统一走 runtimes/engine */

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

/**
 * 快速扫描原型目录内全部文件的元数据（mtime + size）签名映射表
 * 毫秒级耗时，用于无感检测 AI 任务期间是否有真实物理文件被修改
 */
function getProtoFileSignature(dirPath) {
  const sig = new Map();
  if (!dirPath || !fs.existsSync(dirPath)) return sig;

  function scan(currentDir, relBase = '') {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(currentDir, entry.name);
        const rel = path.join(relBase, entry.name).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          scan(full, rel);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(full);
            sig.set(rel, { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  scan(dirPath);
  return sig;
}

/**
 * 对比任务前后的文件签名，返回真实修改的文件清单
 */
function diffFileSignatures(beforeMap, afterMap) {
  const changes = [];
  if (!beforeMap || !afterMap) return changes;

  for (const [relPath, beforeStat] of beforeMap.entries()) {
    if (!afterMap.has(relPath)) {
      changes.push({ path: relPath, action: 'deleted' });
    } else {
      const afterStat = afterMap.get(relPath);
      if (beforeStat.size !== afterStat.size || Math.abs(beforeStat.mtimeMs - afterStat.mtimeMs) > 20) {
        changes.push({ path: relPath, action: 'modified' });
      }
    }
  }

  for (const [relPath] of afterMap.entries()) {
    if (!beforeMap.has(relPath)) {
      changes.push({ path: relPath, action: 'created' });
    }
  }

  return changes;
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
  if (typeof activeExecution!=='undefined' && activeExecution) {
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
ipcMain.handle('proto:annotations:read', handleAnnoRead);
ipcMain.handle('proto:annotations:save', handleAnnoSave);

/* L4 统一IPC：ai:check → detectAllAgents 并发探测，兼容旧前端 {found,path,version} */
ipcMain.handle('ai:check', async () => {
  try {
    const aiCfg = loadAiCfg();
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
});

/* L4: 旧 runCliAsync/stripAnsi/providerDisplayNames/getCompletionsUrl/findSandboxHtml/prune/makeDiff/hash/lru 已删除 */

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

/* L4 old code removed, unified to startAgentExecution */

ipcMain.handle('ai:get-config', () => loadAiCfg());
/* 模型显示管理重构：CLI 动态模型探测 + 10分钟内存缓存 + customModelsCli 融合 */
const cliModelsCache = new Map(); /* key -> { ts, items:[{id,label}] } */
const CLI_MODELS_CACHE_TTL = 10 * 60 * 1000;
ipcMain.handle('ai:save-config', (ev, cfg) => {
  const cur = loadAiCfg();
  const next = Object.assign(cur, cfg || {});
  if (cfg && cfg.api) next.api = Object.assign(cur.api || {}, cfg.api);
  if (cfg && Array.isArray(cfg.visibleModelsCli)) next.visibleModelsCli = cfg.visibleModelsCli;
  if (cfg && Array.isArray(cfg.visibleModelsApi)) next.visibleModelsApi = cfg.visibleModelsApi;
  if (cfg && Array.isArray(cfg.visibleModels)) next.visibleModels = cfg.visibleModels;
  if (cfg && Array.isArray(cfg.customModelsCli)) next.customModelsCli = cfg.customModelsCli;
  if (cfg && typeof cfg.agentId === 'string') next.agentId = cfg.agentId;
  if (cfg && typeof cfg.mainAgent === 'string') next.mainAgent = cfg.mainAgent;
  if (cfg && typeof cfg.cliPaths === 'object' && cfg.cliPaths) next.cliPaths = cfg.cliPaths;
  /* 引擎显式切换时同步清理历史遗留字段，避免 mode/providerType 残留导致 isApi 误判 */
  if (cfg && (cfg.engine === 'cli' || cfg.engine === 'api')) {
    next.engine = cfg.engine;
    if (cfg.engine === 'cli') { delete next.mode; delete next.providerType; }
    else { next.mode = 'api'; next.providerType = 'api'; }
  }
  saveAiCfg(next);
  try { cliModelsCache.clear(); } catch (e) {}
  return { ok: true, config: next };
});

/* 模型动态探测辅助函数 */
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
ipcMain.handle('ai:test-connection', async (ev, apiCfg) => {
  try {
    const stored = loadAiCfg();
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
});

/* L4统一IPC：ai:models -> CLI读def.fallbackModels / API调fetchProviderModels（兼容旧前端 {ok,groups,default,engine,visibleModels}） */
ipcMain.handle('ai:models', async (ev, hint) => {
  const cfg = loadAiCfg();
  /* 设置面板按当前UI引擎预览：显式hint优先，仅无hint时回退落盘判定（兼容旧前端与对话下拉） */
  const h = (hint && typeof hint === 'object') ? hint : (typeof hint === 'string' ? { engine: hint } : {});
  const hintEngine = (h.engine === 'cli' || h.engine === 'api') ? h.engine : null;
  const isApi = hintEngine ? hintEngine === 'api' : (cfg.mode === 'api' || cfg.providerType === 'api' || cfg.engine === 'api');
  let visible = null;
  if (isApi) {
    visible = Array.isArray(cfg.visibleModelsApi) ? cfg.visibleModelsApi
      : (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length ? cfg.visibleModels : null);
  } else {
    visible = Array.isArray(cfg.visibleModelsCli) ? cfg.visibleModelsCli
      : (Array.isArray(cfg.visibleModels) && cfg.visibleModels.length ? cfg.visibleModels : null);
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
      const hit = cliModelsCache.get(cacheKey);
      if (hit && (now - hit.ts) < CLI_MODELS_CACHE_TTL && Array.isArray(hit.items) && hit.items.length) {
        dynItems = hit.items;
      } else {
        const raw = await execCliListModels(resolvedBin, def);
        if (Array.isArray(raw) && raw.length) {
          dynItems = normalizeCliModelIds(raw);
          if (dynItems.length) cliModelsCache.set(cacheKey, { ts: now, items: dynItems });
          else dynItems = [];
        }
      }
    }
  } catch (e) { dynItems = []; }
  /* 融合：fallback default项 + 动态全量 + 用户customModelsCli（每次合并，不进缓存） */
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
  (Array.isArray(cfg.customModelsCli) ? cfg.customModelsCli : []).forEach((id) => pushM({ id, label: id }));
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
});

ipcMain.handle('ai:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, {
    defaultPath: pkgDir, title: '选择 opencode CLI 可执行文件',
    filters: [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat'] }], properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const c = loadAiCfg(); c.cliPath = r.filePaths[0]; saveAiCfg(c);
  return { path: r.filePaths[0] };
});

/* L4统一分流器：ai:ask -> startAgentExecution（BYOK走opencode桥接，CLI走对应def；Stdin管道注入；事件经ai:event推送） */
ipcMain.handle('ai:ask', async (ev, prompt, sessionId, sandboxDir, model, extraOpts = {}) => {
  if (activeExecution) {
    return { ok: false, success: false, error: 'busy' };
  }
  const aiCfg = loadAiCfg();
  const webContents = ev.sender;
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
  try { takeSnapshot(sandboxDir); } catch (e) {}
  const cwd = aiWorkDir(sandboxDir);
  if (isApiMode) {
    def = getAgentDef('opencode');
    if (!def) throw new Error('未找到 OpenCode 适配器，BYOK 模式依赖本地 OpenCode CLI');
    resolvedBin = await resolveAgentExecutable(def, aiCfg.cliPath);
    if (!resolvedBin) {
      webContents.send('ai:event', {
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
      webContents.send('ai:event', {
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
      webContents.send('ai:event', { type: 'error', code: 'AGENT_NOT_FOUND', title: '未找到 Agent', message: String(agentId) });
      return { ok: false, success: false, error: '未找到 Agent 适配器' };
    }
    let customPath = aiCfg.cliPath;
    try {
      if (aiCfg.cliPaths && aiCfg.cliPaths[def.id]) customPath = aiCfg.cliPaths[def.id];
    } catch (e) {}
    resolvedBin = await resolveAgentExecutable(def, customPath);
    if (!resolvedBin) {
      webContents.send('ai:event', {
        type: 'error', code: 'CLI_NOT_FOUND', title: ('未检测到 ' + def.name),
        message: ('未找到 ' + def.name + ' 可执行文件，请在终端执行安装或在设置中心指定路径。')
      });
      return { ok: false, success: false, error: '未检测到 ' + def.name };
    }
    executionOptions.model = (targetModel && targetModel !== '__none__') ? targetModel : 'default';
  }

  const beforeSignature = getProtoFileSignature(cwd);

  function runAgentProcess(opts, isRetry = false) {
    return startAgentExecution({
      def,
      resolvedBin,
      prompt,
      cwd,
      options: opts,
      handlers: {
        onThinking: (text) => webContents.send('ai:event', { type: 'thinking', text: String((text && text.text) || text || '') }),
        onChunk: (text) => webContents.send('ai:event', { type: 'chunk', text: String((text && text.text) || text || '') }),
        onToolCall: (data) => webContents.send('ai:event', { type: 'tool_call', ...data }),
        onSession: (id) => {
          const sid = String((id && (id.sessionId || id.id || id.sessionID || id.session_id || id.session)) || (typeof id === 'string' ? id : '') || '');
          webContents.send('ai:event', { type: 'session', id: sid, sessionId: sid });
        },
        onError: (diag) => {
          const d = (diag && typeof diag === 'object') ? diag : { message: String((diag && diag.message) || diag || '未知错误') };
          // 自愈降级：若因携带失效的 sessionId 导致 SESSION_NOT_FOUND，自动抹除并无感重试一次全新会话
          if (d.code === 'SESSION_NOT_FOUND' && opts.sessionId && !isRetry) {
            try { webContents.send('ai:event', { type: 'session', id: '', sessionId: '' }); } catch (e) {}
            const retryOpts = { ...opts };
            delete retryOpts.sessionId;
            activeExecution = runAgentProcess(retryOpts, true);
            return;
          }
          activeExecution = null;
          try {
            webContents.send('ai:event', { type: 'error', code: d.code || 'EXECUTION_FAILURE', title: d.title || '调用失败', message: d.message || '调用失败', action: d.action || 'retry' });
          } catch (e) {
            try { webContents.send('ai:event', { type: 'error', message: String((diag && diag.message) || diag || '未知错误') }); } catch (ee) {}
          }
        },
        onClose: ({ cancelled, code } = {}) => {
          activeExecution = null;
          let fileChanges = [];
          try {
            const afterSignature = getProtoFileSignature(cwd);
            fileChanges = diffFileSignatures(beforeSignature, afterSignature);
          } catch (err) {
            fileChanges = [];
          }
          try {
            webContents.send('ai:event', {
              type: 'done',
              cancelled: !!cancelled,
              code,
              fileChanges
            });
          } catch (e) {}
        }
      }
    });
  }

  activeExecution = runAgentProcess(executionOptions, false);
  return { ok: true, success: true, pid: activeExecution ? activeExecution.pid : null };
});

ipcMain.handle('ai:cancel', async () => {
  try {
    if (activeExecution) {
      try { await activeExecution.cancel(); } catch (e) {}
      try { if (activeExecution && activeExecution.pid) await killProcessTree(activeExecution.pid); } catch (e) {}
    }
  } catch (e) {}
  activeExecution = null;
  return 'ok';
});

ipcMain.handle('ai:is-busy', () => { return !!activeExecution; });

/* ═══════ Git 协同与多项目自动建库体系（基于沙箱总根目录 SANDBOX_ROOT） ═══════ */
const GIT_CONFIG_PATH = path.join(app.getPath('userData'), 'git-config.json');

/* P0 Git止血：独立 gitState（与 AI activeExecution 同构，互不干扰）+ 读写锁 + 自愈/备份辅助 */
const gitState = { busy: null }; // {op, startedAt}
let gitCurrentChild = null;
function gitIsBusy() { return !!gitState.busy; }
async function withGitLock(mode, opName, fn) {
  if (mode === 'write') {
    if (gitState.busy) return { ok: false, error: 'git-busy', currentOp: gitState.busy.op };
    gitState.busy = { op: opName, startedAt: Date.now() };
    try { return await fn(); } finally { gitState.busy = null; }
  }
  // read：写忙时最多等待 2s，否则返回 git-busy（避免 UI 卡死）
  if (gitState.busy) {
    const t0 = Date.now();
    while (gitState.busy && (Date.now() - t0) < 2000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (gitState.busy) return { ok: false, error: 'git-busy', currentOp: gitState.busy.op };
  }
  return await fn();
}
function detectNestedGit() {
  const nested = [];
  try {
    const entries = fs.readdirSync(SANDBOX_ROOT, { withFileTypes: true });
    for (const d of entries) {
      try {
        if (!d.isDirectory()) continue;
        if (d.name === '.git' || d.name === '.heal-backup' || d.name === '.pull-backup') continue;
        const p = path.join(SANDBOX_ROOT, d.name, '.git');
        if (fs.existsSync(p)) nested.push(d.name + '/.git');
      } catch (e) {}
    }
  } catch (e) {}
  return nested;
}
async function checkSandboxRepoHealth() {
  const gitDir = path.join(SANDBOX_ROOT, '.git');
  try {
    if (!fs.existsSync(gitDir)) return { healthy: false, reason: 'missing' };
  } catch (e) { return { healthy: false, reason: 'missing' }; }
  try {
    const r = await runGit(SANDBOX_ROOT, ['rev-parse', '--git-dir'], 5000);
    if (r && r.status === 0) return { healthy: true };
    let detail = '';
    try { detail = gitAuth.redactSecrets(String((r && (r.stderr || r.stdout)) || '')); } catch (e) {}
    return { healthy: false, reason: 'broken', detail };
  } catch (e) {
    return { healthy: false, reason: 'broken', detail: String((e && e.message) || e) };
  }
}
function fmtGitTs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
/** P0-D4 自愈检查：嵌套 .git / 缺库 / 坏库统一收口，调用方据此返回 NEED_HEAL（不做任何删除） */
async function checkGitHealNeeded() {
  let nested = [];
  try { nested = detectNestedGit(); } catch (e) {}
  if (nested && nested.length) return { needHeal: true, reason: 'nested', nested };
  try {
    const h = await checkSandboxRepoHealth();
    if (!h.healthy) return { needHeal: true, reason: h.reason || 'missing', nested: [], detail: h.detail || '' };
  } catch (e) {}
  return { needHeal: false, nested: [] };
}
/** P0-D3 拉取备份：把本次 files 中本地现存文件拷贝到 sandbox/.pull-backup/<时间>-<branch>/ */
function backupPullFiles(files, branch) {
  const safeBranch = String(branch || 'main').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40) || 'main';
  const backupDir = path.join(SANDBOX_ROOT, '.pull-backup', fmtGitTs(new Date()) + '-' + safeBranch);
  try { fs.mkdirSync(backupDir, { recursive: true }); } catch (e) {}
  try {
    for (const rel of (files || [])) {
      try {
        if (!rel || typeof rel !== 'string') continue;
        const src = path.join(SANDBOX_ROOT, rel);
        let st = null;
        try { st = fs.statSync(src); } catch (e) { continue; }
        if (!st || !st.isFile()) continue;
        const dst = path.join(backupDir, rel);
        try { fs.mkdirSync(path.dirname(dst), { recursive: true }); } catch (e) {}
        try { fs.copyFileSync(src, dst); } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}
  return backupDir;
}
/** 取项目凭据（同步优先，兼容新旧两套入参：o.username/o.token 显式覆盖 > 安全存储） */
function resolveGitCredentials(projName, o) {
  let username = '';
  let token = '';
  try {
    const saved = gitConfigStore.getProjectGitCredentialsSync(projName);
    if (saved) { username = String(saved.username || ''); token = String(saved.token || ''); }
  } catch (e) {}
  try {
    if (o && o.username != null && String(o.username) !== '') username = String(o.username);
    if (o && o.token != null && String(o.token) !== '') token = String(o.token);
  } catch (e) {}
  return { username, token };
}

/**
 * @deprecated 旧直读写保留（回滚影子），新代码请走 git/config-store.js
 * 保留签名，仅用于存量迁移兜底；正常链路不再调用本函数写 token。
 */
function loadGitConfig() {
  try {
    if (fs.existsSync(GIT_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(GIT_CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return { defaultConfig: {}, projects: {} };
}

/**
 * @deprecated 旧明文落盘保留（回滚影子），新链路禁止调用；请走 gitConfigStore.saveProjectGitConfig
 */
function saveGitConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(GIT_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(GIT_CONFIG_PATH, JSON.stringify(cfg || {}, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * @deprecated 保留签名，内部已代理到 git/config-store 脱敏视图（无 token 字段）。
 * 新链路直接调 gitConfigStore.getProjectGitConfig；此处保留供旧调用方兼容。
 */
function getProjectGitConfig(projectName) {
  try {
    return gitConfigStore.getProjectGitConfig(projectName);
  } catch (e) {}
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

/**
 * @deprecated Token 拼 URL 已废止（进程可见风险），新链路须走 gitAuth.buildGitAuthEnv + 裸 URL。
 * 保留签名仅供回滚对比，禁止新调用。
 */
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

/**
 * @deprecated 保留签名，内部已代理到 git/auth.sanitizeGitError（先脱敏+超时124分支）。
 */
function sanitizeGitError(errText) {
  try { return gitAuth.sanitizeGitError(errText); } catch (e) {}
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

function runGit(cwd, args, timeoutMs = 30000, extraEnv) {
  // 兼容新签名：第三参可为 {timeoutMs, envAdd}，第四参可为 envAdd
  let timeout = 30000;
  let envAdd = {};
  try {
    if (timeoutMs && typeof timeoutMs === 'object') {
      timeout = (timeoutMs.timeoutMs != null ? timeoutMs.timeoutMs : 30000);
      envAdd = timeoutMs.envAdd || timeoutMs.extraEnv || {};
    } else {
      timeout = (timeoutMs == null ? 30000 : timeoutMs);
      if (extraEnv && typeof extraEnv === 'object') envAdd = extraEnv;
    }
  } catch (e) {}
  // P0 安全红线：argv 含凭据 URL 直接抛错（倒逼上层走 extraHeader + 裸 URL）
  try {
    const list = Array.isArray(args) ? args : [];
    const hit = list.some((a) => typeof a === 'string' && /https?:\/\/[^\s]*@[^\s]*/.test(a));
    if (hit) {
      const err = new Error('AUTH_URL_BLOCKED: argv 中禁止携带凭据 URL，须走 http.extraHeader');
      err.code = 'AUTH_URL_BLOCKED';
      return Promise.reject(err);
    }
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return Promise.reject(e);
  }
  return new Promise((resolve) => {
    try {
      const gitArgs = ['-c', 'core.quotepath=false', ...args];
      const child = spawn('git', gitArgs, {
        cwd,
        env: Object.assign({}, process.env, {
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C.UTF-8'
        }, envAdd || {}),
        windowsHide: true
      });
      try { gitCurrentChild = child; } catch (e) {}
      let stdout = '', stderr = '';
      let timer = null;
      let settled = false;
      const done = (obj) => { if (settled) return; settled = true; try { if (timer) clearTimeout(timer); } catch (e) {} try { if (gitCurrentChild === child) gitCurrentChild = null; } catch (e) {} resolve(obj); };
      if (timeout > 0) {
        timer = setTimeout(async () => {
          if (settled) return;
          try { await killProcessTree(child.pid); } catch (e) {}
          try { child.kill('SIGKILL'); } catch (e) {}
          done({ status: 124, stdout, stderr: 'Git 操作超时 (' + timeout + 'ms，已整树终止)', timedOut: true });
        }, timeout);
      }
      child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      child.on('error', (err) => {
        done({ status: -1, stdout, stderr: String(err && err.message || err), timedOut: false });
      });
      child.on('close', (status) => {
        done({ status: status != null ? status : 0, stdout, stderr, timedOut: false });
      });
    } catch (e) {
      resolve({ status: -1, stdout: '', stderr: String(e && e.message || e), timedOut: false });
    }
  });
}

/**
 * @deprecated 静默 rm -rf 已废止（P0-D4）。保留签名，内部改为检测上报，不做任何删除。
 * 新链路：先 checkGitHealNeeded()，需修复走 git:heal-repair（备份后隔离）。
 */
async function ensureSandboxGitRepo(cfg) {
  try{
  if (!fs.existsSync(SANDBOX_ROOT)) fs.mkdirSync(SANDBOX_ROOT, { recursive: true });

  // P0-D4：不再 rm -rf 嵌套 .git，仅检测上报（调用方据此返回 NEED_HEAL）
  let nested = [];
  try { nested = detectNestedGit(); } catch (e) {}
  if (nested && nested.length) {
    try { console.warn('[git] detect nested .git (no auto delete):', nested.join(',')); } catch (e) {}
    return { ok: false, needHeal: true, reason: 'nested', nested };
  }
  // 缺库 / 坏库同样上报，不自动 init（由 git:heal-repair 经确认后修复）
  try {
    const h = await checkSandboxRepoHealth();
    if (!h.healthy) return { ok: false, needHeal: true, reason: h.reason || 'missing', nested: [], detail: h.detail || '' };
  } catch (e) {}

  const branch = (cfg && cfg.branch) || 'main';
  const gitDir = path.join(SANDBOX_ROOT, '.git');
  if (!fs.existsSync(gitDir)) {
    // 健康检查已拦截缺库，此处仅为极端竞态兜底：仍需确认才 init，故直接返回 NEED_HEAL
    return { ok: false, needHeal: true, reason: 'missing', nested: [] };
  }

  await runGit(SANDBOX_ROOT, ['config', 'core.quotepath', 'false']);

  if (cfg && cfg.remoteUrl) {
    // P0 安全：改写 origin 前先过白名单
    try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
      throw Object.assign(new Error(String((e && e.message) || e)), { code: (e && e.code) || 'GIT_URL_BLOCKED' });
    }
    const remotes = await runGit(SANDBOX_ROOT, ['remote']);
    if (remotes.stdout.indexOf('origin') >= 0) {
      await runGit(SANDBOX_ROOT, ['remote', 'set-url', 'origin', String(cfg.remoteUrl).trim()]);
    } else {
      await runGit(SANDBOX_ROOT, ['remote', 'add', 'origin', String(cfg.remoteUrl).trim()]);
    }
  }
  if (cfg && cfg.authorName) {
    await runGit(SANDBOX_ROOT, ['config', 'user.name', cfg.authorName]);
  }
  if (cfg && cfg.authorEmail) {
    await runGit(SANDBOX_ROOT, ['config', 'user.email', cfg.authorEmail]);
  }
  return { ok: true, nested: [] };
  }catch(e){ try{ dialog.showMessageBoxSync({type:'error', title:'Git初始化失败', message: gitAuth.redactSecrets(String(e.message))}); }catch(_e){} throw e; }
}

ipcMain.handle('git:config-get', (ev, projectName) => {
  // P0：返回脱敏视图（无 token 字段，token 已脱敏；签名不变）
  const cfg = getProjectGitConfig(projectName);
  return { ok: true, config: cfg };
});

ipcMain.handle('git:config-save', async (ev, o) => {
  const projName = (o && o.project) || '';
  const cfg = (o && o.config) || {};
  // P0 安全：入口先过 URL 白名单（含 remoteUrl 时）
  try {
    if (cfg.remoteUrl != null && String(cfg.remoteUrl).trim() !== '') {
      gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl));
    }
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  // P0 凭据分离：非敏感走 config-store 剥离落盘；凭据走 safeStorage/内存（空提交=不更新）
  try {
    await gitConfigStore.saveProjectGitConfig(projName, cfg);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  try {
    if ((cfg.token != null && String(cfg.token) !== '') || (cfg.username != null && String(cfg.username) !== '')) {
      await gitConfigStore.saveProjectGitCredentials(projName, { username: cfg.username, token: cfg.token });
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }

  const effCfg = getProjectGitConfig(projName);
  // 自愈：嵌套/缺库/坏库返回 NEED_HEAL（不自动修）
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) {
      return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '', config: effCfg };
    }
  } catch (e) {}
  try {
    await ensureSandboxGitRepo(effCfg);
  } catch (e) {
    if (e && (e.code === 'GIT_URL_BLOCKED')) return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: gitAuth.sanitizeGitError(String((e && e.message) || e)) };
  }
  return { ok: true, config: getProjectGitConfig(projName) };
});

ipcMain.handle('git:list-branches', async (ev, o) => {
  const projName = (o && o.project) || '';
  const cfg = getProjectGitConfig(projName);
  const remoteUrl = String((o && o.remoteUrl) || cfg.remoteUrl || '').trim();
  const cred = resolveGitCredentials(projName, o);
  const username = cred.username;
  const token = cred.token;
  const branches = new Set();
  if (cfg.branch) branches.add(cfg.branch);
  branches.add('main');
  branches.add('master');

  // P1-1（顺带）：无远端返回本地分支 + remoteConfigured:false（不调远端）
  if (!remoteUrl) {
    if (fs.existsSync(path.join(SANDBOX_ROOT, '.git'))) {
      try {
        const locRes = await runGit(SANDBOX_ROOT, ['branch', '--list']);
        if (locRes.status === 0 && locRes.stdout) {
          locRes.stdout.split(/\r?\n/).forEach((b) => {
            const name = b.replace(/^[\*\s]+/, '').trim();
            if (name && name !== '(HEAD' && !name.startsWith('(')) branches.add(name);
          });
        }
      } catch (e) {}
    }
    return { ok: true, branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main', remoteConfigured: false };
  }
  // P0 安全：远端先过白名单
  try { gitAuth.assertAllowedRemoteUrl(remoteUrl); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  // P0-D4：嵌套/坏库上报（list-branches 同样守门，但无远端时已提前返回本地分支）
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) {
      // 仍附带本地分支，便于前端展示；主体 code 为 NEED_HEAL
      if (fs.existsSync(path.join(SANDBOX_ROOT, '.git'))) {
        try {
          const locRes = await runGit(SANDBOX_ROOT, ['branch', '--list']);
          if (locRes.status === 0 && locRes.stdout) {
            locRes.stdout.split(/\r?\n/).forEach((b) => {
              const name = b.replace(/^[\*\s]+/, '').trim();
              if (name && name !== '(HEAD' && !name.startsWith('(')) branches.add(name);
            });
          }
        } catch (e) {}
      }
      return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main', remoteConfigured: true };
    }
  } catch (e) {}

  if (remoteUrl) {
    // P0：extraHeader + 裸 URL（特殊字符 Token 免编码，绝不拼 Token URL）
    const auth = gitAuth.buildGitAuthEnv({ username, token });
    const plainUrl = remoteUrl;
    try {
      const remRes = await runGit(SANDBOX_ROOT, [...auth.argsPrefix, 'ls-remote', '--heads', plainUrl], { timeoutMs: 15000, envAdd: auth.envAdd });
      if (remRes.status === 0 && remRes.stdout) {
        remRes.stdout.split(/\r?\n/).forEach((line) => {
          const parts = line.split(/\s+/);
          const ref = parts[1] || '';
          if (ref.startsWith('refs/heads/')) {
            branches.add(ref.replace('refs/heads/', '').trim());
          }
        });
      }
    } catch (e) {
      if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
      throw e;
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

  return { ok: true, branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main', remoteConfigured: true };
});

ipcMain.handle('git:test-connection', async (ev, cfg) => {
  if (!cfg || !cfg.remoteUrl) return { ok: false, error: '请先填写远程仓库地址' };
  const remoteUrl = String(cfg.remoteUrl).trim();
  try { gitAuth.assertAllowedRemoteUrl(remoteUrl); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  // 兼容：显式传入优先，否则回读安全存储（特殊字符免编码）
  let username = (cfg.username != null ? String(cfg.username) : '');
  let token = (cfg.token != null ? String(cfg.token) : '');
  try {
    const projName = (cfg && cfg.project) || '';
    const saved = gitConfigStore.getProjectGitCredentialsSync(projName);
    if ((username === '' || username == null) && saved && saved.username) username = String(saved.username);
    if ((token === '' || token == null) && saved && saved.token) token = String(saved.token);
  } catch (e) {}
  const auth = gitAuth.buildGitAuthEnv({ username, token });
  const t0 = Date.now();
  let res = null;
  try {
    res = await runGit(process.cwd(), [...auth.argsPrefix, 'ls-remote', '--heads', remoteUrl], { timeoutMs: 15000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const latency = Date.now() - t0;
  if (res.status === 0) {
    return { ok: true, latency };
  }
  if (res.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(res.stderr || res.stdout) };
  return { ok: false, error: sanitizeGitError(res.stderr || res.stdout) };
});

ipcMain.handle('git:status', async (ev, o) => {
  return withGitLock('read', 'status', async () => {
  const projName = (typeof o === 'string' ? o : (o && o.project)) || '';
  const targetBranch = (o && o.branch) || (getProjectGitConfig(projName).branch) || 'main';
  if (!isValidBranch(targetBranch)) return { ok: false, error: '非法分支名' };
  const cfg = getProjectGitConfig(projName);
  // P0-D4：嵌套/缺库/坏库直接返回 NEED_HEAL（不自动修）
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }

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
});

ipcMain.handle('git:push', async (ev, o) => {
  return withGitLock('write', 'push', async () => {
  const projName = (o && o.project) || '';
  const files = (o && Array.isArray(o.files)) ? o.files : [];
  const message = (o && o.message && o.message.trim()) || '更新原型与文档数据';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };
  const force = !!(o && o.force);

  if (!cfg.remoteUrl) return { ok: false, code: 'NEED_CONFIG', error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  if (!files.length) return { ok: false, error: '请勾选需要上传的文件' };
  try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const cred = resolveGitCredentials(projName, o);
  const auth = gitAuth.buildGitAuthEnv(cred);
  const plainUrl = String(cfg.remoteUrl).trim();

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
  // P0：extraHeader + 裸 URL（特殊字符 Token 免编码）
  const pushArgs = [...auth.argsPrefix, 'push', '-u'];
  if (force) pushArgs.push('--force');
  pushArgs.push(plainUrl, `HEAD:refs/heads/${branch}`);

  let pushRes = null;
  try {
    pushRes = await runGit(SANDBOX_ROOT, pushArgs, { timeoutMs: 35000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  if (pushRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(pushRes.stderr || pushRes.stdout) };
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
});

ipcMain.handle('git:fetch-diff', async (ev, o) => {
  return withGitLock('read', 'fetch-diff', async () => {
  const projName = (typeof o === 'string' ? o : (o && o.project)) || '';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };

  // P1-1：无远端返回 NEED_CONFIG（不调远端，避免误以为已同步）
  if (!cfg.remoteUrl) return { ok: false, code: 'NEED_CONFIG', error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const cred = resolveGitCredentials(projName, o);
  const auth = gitAuth.buildGitAuthEnv(cred);
  const plainUrl = String(cfg.remoteUrl).trim();

  // 静默 Fetch 目标分支
  let fetchRes = null;
  try {
    fetchRes = await runGit(SANDBOX_ROOT, [...auth.argsPrefix, 'fetch', plainUrl, branch], { timeoutMs: 30000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  if (fetchRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
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
});

ipcMain.handle('git:pull', async (ev, o) => {
  return withGitLock('write', 'pull', async () => {
  const projName = (o && o.project) || '';
  const files = (o && Array.isArray(o.files)) ? o.files : null;
  const wantBackup = !!(o && o.backup);
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };

  if (!cfg.remoteUrl) return { ok: false, code: 'NEED_CONFIG', error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const cred = resolveGitCredentials(projName, o);
  const auth = gitAuth.buildGitAuthEnv(cred);
  const plainUrl = String(cfg.remoteUrl).trim();

  // 1. Fetch
  let fetchRes = null;
  try {
    fetchRes = await runGit(SANDBOX_ROOT, [...auth.argsPrefix, 'fetch', plainUrl, branch], { timeoutMs: 30000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  if (fetchRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  if (fetchRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  }

  const affectedProjects = new Set();
  const failed = [];
  let backupPath = null;
  // P0-D3：o.backup=true 时先备份本次 files 交集的本地现存文件
  if (wantBackup && files && files.length) {
    try { backupPath = backupPullFiles(files, branch); } catch (e) { backupPath = null; }
  }

  // 2. 选择性检出指定的目录/文件（逐文件判 status，不吞错）
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
        failed.push({ path: rel, error: '非法路径，已跳过' });
        continue;
      }
      // 保证本地沙箱父级文件夹递归自动创建
      try { fs.mkdirSync(path.dirname(fullPath), { recursive: true }); } catch (e) {}

      const parts = rel.split('/');
      if (parts.length > 0) affectedProjects.add(parts[0]);

      // 从 FETCH_HEAD 检出该文件
      try {
        const co = await runGit(SANDBOX_ROOT, ['checkout', 'FETCH_HEAD', '--', rel]);
        if (co.timedOut) { failed.push({ path: rel, error: sanitizeGitError(co.stderr || co.stdout), code: 'TIMEOUT' }); continue; }
        if (co.status !== 0) failed.push({ path: rel, error: sanitizeGitError(co.stderr || co.stdout) });
      } catch (e) {
        if (e && e.code === 'AUTH_URL_BLOCKED') failed.push({ path: rel, error: String(e.message), code: 'AUTH_URL_BLOCKED' });
        else failed.push({ path: rel, error: sanitizeGitError(String((e && e.message) || e)) });
      }
    }
    if (failed.length) {
      return {
        ok: false,
        error: '部分文件拉取失败（' + failed.length + '/' + files.length + '），未失败文件已检出，详见 failed 清单',
        failed,
        backupPath,
        affectedProjects: Array.from(affectedProjects),
        branch,
        filesCount: (files && files.length) || 0
      };
    }
  } else {
    // 全量合并拉取
    let mergeRes = null;
    try {
      mergeRes = await runGit(SANDBOX_ROOT, ['merge', 'FETCH_HEAD']);
    } catch (e) {
      return { ok: false, error: sanitizeGitError(String((e && e.message) || e)), backupPath, branch };
    }
    if (mergeRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(mergeRes.stderr || mergeRes.stdout), backupPath, branch };
    if (mergeRes.status !== 0) {
      return { ok: false, error: sanitizeGitError(mergeRes.stderr || mergeRes.stdout), backupPath, branch };
    }
  }

  return {
    ok: true,
    message: '同步完成',
    filesCount: (files && files.length) || 0,
    affectedProjects: Array.from(affectedProjects),
    branch,
    failed,
    backupPath
  };
  });
});

/* P0 新增：git 忙态查询 / 取消 / 自愈修复（通道名新增，旧通道不变） */
ipcMain.handle('git:is-busy', () => {
  return { busy: gitIsBusy(), currentOp: (gitState.busy && gitState.busy.op) || null };
});
ipcMain.handle('git:cancel', async () => {
  try {
    if (!gitState.busy) return { ok: true, cancelled: false };
    const op = gitState.busy.op;
    try { if (gitCurrentChild && gitCurrentChild.pid) await killProcessTree(gitCurrentChild.pid); } catch (e) {}
    try { if (gitCurrentChild) gitCurrentChild.kill('SIGKILL'); } catch (e) {}
    gitState.busy = null;
    try { gitCurrentChild = null; } catch (e) {}
    return { ok: true, cancelled: true, op };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('git:heal-repair', async (ev, o) => {
  const projName = (o && o.project) || '';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && String(o.branch).trim()) || cfg.branch || 'main';
  let nested = [];
  try { nested = detectNestedGit(); } catch (e) {}
  const ts = fmtGitTs(new Date());
  const backupRoot = path.join(SANDBOX_ROOT, '.heal-backup', ts);
  const healed = [];
  try { fs.mkdirSync(backupRoot, { recursive: true }); } catch (e) {}
  // 先备份嵌套 .git 到 sandbox/.heal-backup/<时间>/ 再隔离（改名，不 rm -rf）
  for (const rel of (nested || [])) {
    try {
      const src = path.join(SANDBOX_ROOT, rel);
      const dst = path.join(backupRoot, rel);
      try { fs.mkdirSync(path.dirname(dst), { recursive: true }); } catch (e) {}
      try {
        if (fs.existsSync(src)) {
          const st = fs.statSync(src);
          if (st.isDirectory()) fs.cpSync(src, dst, { recursive: true });
          else fs.copyFileSync(src, dst);
        }
      } catch (e) {}
      try {
        if (fs.existsSync(src)) {
          const bakName = src + '.bak-' + ts;
          try { fs.renameSync(src, bakName); healed.push(rel); } catch (e) {
            // 改名失败（如跨盘）则在已备份前提下删除原目录
            try { fs.rmSync(src, { recursive: true, force: true }); healed.push(rel); } catch (ee) {}
          }
        }
      } catch (e) {}
    } catch (e) {}
  }
  // 再重建总根库（缺库/坏库修复）
  try {
    const gitDir = path.join(SANDBOX_ROOT, '.git');
    let needInit = false;
    try { if (!fs.existsSync(gitDir)) needInit = true; } catch (e) { needInit = true; }
    if (!needInit) {
      try {
        const h = await checkSandboxRepoHealth();
        if (!h.healthy) {
          // 备份坏库后重建
          try {
            const badBak = path.join(backupRoot, '.git-broken-' + ts);
            try { fs.cpSync(gitDir, badBak, { recursive: true }); } catch (e) {}
            try { fs.renameSync(gitDir, gitDir + '.bak-' + ts); } catch (e) {}
          } catch (e) {}
          needInit = true;
        }
      } catch (e) {}
    }
    if (needInit) {
      await runGit(SANDBOX_ROOT, ['init', '-b', branch]);
      const gi = path.join(SANDBOX_ROOT, '.gitignore');
      try { if (!fs.existsSync(gi)) fs.writeFileSync(gi, '.DS_Store\nThumbs.db\ndesktop.ini\n*.tmp\ntemp/\n', 'utf8'); } catch (e) {}
    }
    await runGit(SANDBOX_ROOT, ['config', 'core.quotepath', 'false']);
    if (cfg && cfg.remoteUrl) {
      try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
        return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e), backupDir: backupRoot, healed };
      }
      try {
        const remotes = await runGit(SANDBOX_ROOT, ['remote']);
        if (String(remotes.stdout || '').indexOf('origin') >= 0) await runGit(SANDBOX_ROOT, ['remote', 'set-url', 'origin', String(cfg.remoteUrl).trim()]);
        else await runGit(SANDBOX_ROOT, ['remote', 'add', 'origin', String(cfg.remoteUrl).trim()]);
      } catch (e) {}
    }
    if (cfg && cfg.authorName) { try { await runGit(SANDBOX_ROOT, ['config', 'user.name', cfg.authorName]); } catch (e) {} }
    if (cfg && cfg.authorEmail) { try { await runGit(SANDBOX_ROOT, ['config', 'user.email', cfg.authorEmail]); } catch (e) {} }
  } catch (e) {
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)), backupDir: backupRoot, healed };
  }
  return { ok: true, backupDir: backupRoot, healed, nested };
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
  /* P0 凭据迁移：旧明文 token/username 先备份再迁入安全存储（失败不阻塞启动） */
  try { gitConfigStore.migratePlaintextTokensOnce().catch(() => {}); } catch (e) {}
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
