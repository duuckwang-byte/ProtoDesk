'use strict';
/**
 * main/services/sandbox-storage-service.js — SandboxStorageService（Wave-B）
 * 职责：沙箱/项目/规范库/组件库/绑定/快照/外链/标注/资产/文档读写 + 原子落盘与目录守卫。
 * 由 SandboxController（39通道）与 DocController（doc:list/read/write）调用；AI  ask 经 takeSnapshot 调用。
 * 全部实现自 main.js 原文搬迁（仅共享态/路径/加密/补零做机械替换，通道契约不变）。
 *
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} SandboxOpResult {ok:boolean, error?:string, cancelled?:boolean, filePath?:string}
 * @typedef {Object} ListResult {ok:boolean, list?:Array, error?:string}
 * @param {Object} [o] 通道载荷对象 (dir/file/name/content 等, 各 Impl 首行做对象化清洗)
 * @param {string} [dir] 沙箱目录标识 (links/snapshot/annotations 类通道的扁平首参形态)
 * @returns {Promise<SandboxOpResult|ListResult>} 存储操作结果 (原子写, 目录越界阻断)
 */
const path = require('path');
const fs = require('fs');
const os = require('node:os');
const { BrowserWindow, dialog, app } = require('electron');
const shared = require('../state');
const paths = require('../paths');
const aiConfigStore = require('./ai-config-store');

/* userData/exe 安全取值：Electron 主进程走 app.getPath；纯 Node 测试环境
   require('electron') 仅返回路径字符串无 app 对象，回退到 paths 派生目录，保证不抛 ReferenceError/TypeError */
function userDataDir() {
  try { if (app && typeof app.getPath === 'function') return app.getPath('userData'); } catch (e) {}
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') return el.app.getPath('userData');
  } catch (e) {}
  try { return path.dirname(paths.SANDBOX_ROOT); } catch (e) { return process.cwd(); }
}
function exeDir() {
  try { if (app && typeof app.getPath === 'function') return path.dirname(app.getPath('exe')); } catch (e) {}
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') return path.dirname(el.app.getPath('exe'));
  } catch (e) {}
  try { if (paths.pkgDir) return paths.pkgDir; } catch (e) {}
  return process.cwd();
}

function ensureSandbox() {
  try {
    if (!fs.existsSync(paths.SANDBOX_ROOT)) fs.mkdirSync(paths.SANDBOX_ROOT, { recursive: true });
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
function normalizeProjects() {
  try {
    if (fs.existsSync(path.join(userDataDir(), paths.NORMALIZE_FLAG))) return;
    if (!fs.existsSync(paths.SANDBOX_ROOT)) { try { fs.writeFileSync(path.join(userDataDir(), paths.NORMALIZE_FLAG), '1'); } catch (e) {} return; }
    const top = fs.readdirSync(paths.SANDBOX_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^\./.test(d.name));
    let moved = 0;
    for (const d of top) {
      const dir = path.join(paths.SANDBOX_ROOT, d.name);
      if (!isFlatDir(dir)) continue;
      const defProj = path.join(paths.SANDBOX_ROOT, paths.DEFAULT_PROJECT);
      const dst = path.join(defProj, d.name);
      if (fs.existsSync(dst)) continue;
      try { fs.mkdirSync(defProj, { recursive: true }); fs.renameSync(dir, dst); moved++; } catch (e) {}
    }
    try { fs.writeFileSync(path.join(userDataDir(), paths.NORMALIZE_FLAG), '1'); } catch (e) {}
    if (moved) libStatusSafe('已将沙箱整理为项目结构：' + moved + ' 个目录归入项目（旧数据兼容完成）。');
  } catch (e) {}
}
/* 兼容旧版（sbox 在 exe 旁）：检测旧位置存在且新位置仍为空 → 询问迁移
   （需在 ensureSandbox 展开 seed 之前判断，否则 seed 会占用新目录导致误判） */
function migrateLegacySandbox() {
  try {
    /* 用户曾选择「跳过」：写一次性标记，之后不再每次启动询问 */
    const skipFlag = path.join(userDataDir(), 'migrate-legacy-skip');
    if (fs.existsSync(skipFlag)) return;
    const legacy = path.join(exeDir(), 'sandbox');
    if (!fs.existsSync(legacy)) return;
    const fresh = !fs.existsSync(paths.SANDBOX_ROOT) || fs.readdirSync(paths.SANDBOX_ROOT).length === 0;
    if (!fresh) return;
    /* 旧 ai-config.json（CLI 手动指定等配置）一并迁移 */
    const cfgOld = path.join(exeDir(), 'ai-config.json');
    const cfgNew = path.join(userDataDir(), 'ai-config.json');
    if (fs.existsSync(cfgOld) && !fs.existsSync(cfgNew)) { try { fs.copyFileSync(cfgOld, cfgNew); } catch (e) {} }
    const r = dialog.showMessageBoxSync({
      type: 'question', buttons: ['迁移', '跳过'], defaultId: 0, cancelId: 1,
      title: '检测到旧版沙箱数据',
      message: '检测到旧版（软件目录内 sandbox）的原型数据，是否迁移到新的用户数据目录？',
      detail: '旧位置：' + legacy + '\n新位置：' + paths.SANDBOX_ROOT + '\n迁移后旧 sandbox 目录可手动删除。'
    });
    if (r === 1) { try { fs.writeFileSync(skipFlag, '1'); } catch (e) {} libStatusSafe('已跳过旧沙箱数据迁移（不再提示）'); return; }
    fs.cpSync(legacy, paths.SANDBOX_ROOT, { recursive: true });
    dialog.showMessageBoxSync({
      type: 'info', buttons: ['知道了'],
      title: '迁移完成',
      message: '旧版沙箱数据已迁移到用户数据目录。',
      detail: '新位置：' + paths.SANDBOX_ROOT + '\n旧位置可手动删除。'
    });
  } catch (e) {}
}
function libStatusSafe(t) { try { console.log('[proto]', t); } catch (e) {} }

/* ═══════ 本地日志：%APPDATA%/原型工具/logs/app-YYYYMMDD.log，启动清理 7 天前旧文件 ═══════ */
function logsDir() { return path.join(userDataDir(), 'logs'); }
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
function sandboxProjects() {
  try {
    if (!fs.existsSync(paths.SANDBOX_ROOT)) return [];
    return fs.readdirSync(paths.SANDBOX_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && !/^\./.test(d.name))
      .map(d => d.name);
  } catch (e) { return []; }
}
/* 项目内原型文件夹名列表 */
function protoFolders(project) {
  try {
    const dir = path.join(paths.SANDBOX_ROOT, project);
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
function sanitizeProtoName(raw) {
  const nm = String(raw || '').trim().replace(/\.(html?|md)$/i, '');
  if (!nm) return null;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(nm) || nm.includes('..') || nm.length > 60) return null; // P0-4 fix 正则第三段移入[]并单判..
  return nm;
}

/* 新建原型：sandbox/<项目>/<名称>/ 下放空壳 html + 同名 md；
   project 缺省时落在「默认项目」；kind: 'pc' | 'mobile' 决定空壳 html 是否带移动视口 */
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
function sanitizeLibId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 80) return null;
  if (s.indexOf('\0') >= 0) return null;
  if (s.indexOf('/') >= 0 || s.indexOf('\\') >= 0) return null;
  if (s.indexOf('..') >= 0) return null;
  if (s === '.' || s === '..') return null;
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/.test(s)) return null;
  return s;
}
function slugifyLibName(raw, fb) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  s = s.replace(/[\s_]+/g, '-').replace(/[^a-z0-9\-\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!s) s = fb || 'spec';
  return s;
}
function specTsNow(d) {
  try {
    const p = shared.pad2;
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  } catch (e) { return String(Date.now()); }
}
function genUniqueLibId(wantName, existingIds, fb) {
  const slug = slugifyLibName(wantName, fb);
  const ts = specTsNow(new Date());
  let rand = '';
  try { rand = Date.now().toString(36).slice(-4); } catch (e) { rand = String(Math.floor(Math.random() * 46656).toString(36)); }
  const set = new Set(existingIds || []);
  let id = slug + '-' + ts + '-' + rand;
  if (!set.has(id)) return id;
  let n = 2;
  while (set.has(id + '-' + n) && n < 10000) n++;
  return id + '-' + n;
}
function ensureUniqueLibName(items, name, selfId) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return s;
  const taken = new Set();
  (items || []).forEach((it) => { if (it && it.name && (!selfId || it.id !== selfId)) taken.add(String(it.name)); });
  if (!taken.has(s)) return s;
  let n = 2;
  while (taken.has(s + '(' + n + ')') && n < 10000) n++;
  return s + '(' + n + ')';
}
function readJsonArrayFile(f) {
  try {
    if (!fs.existsSync(f)) return [];
    const raw = fs.readFileSync(f, 'utf8');
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function specPresetDefs() {
  return [
    { id: 'spec-default', name: '规范默认', desc: '通用设计规范（默认预设）', content: '# 通用设计规范\n\n> 默认预设：适用于大多数原型，约束色彩/字体/间距/圆角/按钮/表单。\n\n## 色彩\n- 主色 #1677FF，成功 #52C41A，警告 #FAAD14，错误 #FF4D4F，中性 #111418 / #8A94A6。\n- 背景 #FFFFFF / #F5F7FA，边框 #E5E8EF。\n\n## 字体字号\n- 中文 PingFang SC / Microsoft YaHei，数字 Roboto / Consolas。标题 18/16，正文 14，辅助 12。\n\n## 间距圆角\n- 基准 8px 网格；卡片内边距 16/20；圆角 6/8；按钮高 32/40。\n\n## 组件形态\n- 按钮主/次/文本三态齐全；表单 label 顶置或左置统一；表格斑马线可选。\n' },
    { id: 'spec-enterprise', name: '企业端规范', desc: '企业中后台规范（默认预设）', content: '# 企业端设计规范\n\n> 默认预设：中后台密度优先，侧边导航 + 顶栏，表格/表单为主。\n\n## 布局\n- 左侧导航宽 200/208，顶栏高 48/56；内容区最大 1200，左右 24 留白。\n\n## 色彩\n- 主色 #165DFF（企业蓝），背景 #F2F3F5，卡片白底 1px 边框。\n\n## 表格表单\n- 表格行高 40/48，分页右下；查询表单一行 3-4 项，更多收起。\n\n## 适配组件库\n- 优先 Element Plus（桌面端），版本锁死见组件库预设。\n' },
    { id: 'spec-gov', name: '政府端规范', desc: '政务端设计规范（默认预设）', content: '# 政府端设计规范\n\n> 默认预设：庄重稳重，高对比、无障碍，政务蓝主导。\n\n## 色彩\n- 政务蓝 #0B5FFF / #003A8C，深红点缀 #C41D23；正文 #1A1A1A，背景 #FFFFFF / #F5F6F7。\n\n## 字体\n- 标题黑体加粗，正文 14-16，行高不小于 1.75；对比度不低于 4.5:1。\n\n## 布局\n- 顶栏含国徽/标题区，面包屑必备；页脚版权信息齐全。\n\n## 无障碍\n- 焦点可见，键盘可达；图片必有 alt。\n' },
    /* UI 规范（出厂内置，随包内 design-specs/ 种子文件分发；正文从种子文件读取，不内联）：
     * kind 决定 AI 生成原型时按端别选用；enabled=false 可停用；用户可直接改 specs/ 下对应 md 即时生效 */
    { id: 'spec-ui-mobile', name: '移动端UI规范', desc: '移动端B2B原型UI规范（出厂内置，可替换）', seedFile: 'ui-mobile.md', kind: 'mobile', uiSpec: true, builtin: true, enabled: true, version: 1, content: '' },
    { id: 'spec-ui-desktop', name: '桌面端UI规范', desc: '桌面端Ant Design UI规范（出厂内置，可替换）', seedFile: 'ui-desktop.md', kind: 'pc', uiSpec: true, builtin: true, enabled: true, version: 1, content: '' }
  ];
}
/* 出厂种子目录解析：开发期与打包后均为 <root>/design-specs（随 build.files 进 asar，只读） */
function resolveSeedFile(name) {
  try {
    const clean = String(name == null ? '' : name).replace(/\\/g, '/');
    if (!clean || clean.indexOf('/') >= 0 || clean.indexOf('..') >= 0 || !clean.endsWith('.md')) return null;
    const p = path.join(__dirname, '..', '..', 'design-specs', clean);
    if (fs.existsSync(p)) return p;
  } catch (e) {}
  return null;
}
function readSeedContent(name, fallbackTitle) {
  try {
    const p = resolveSeedFile(name);
    if (p) {
      const buf = fs.readFileSync(p);
      if (buf && buf.length && buf.length <= paths.SPEC_MAX_BYTES && isUtf8Buffer(buf)) return buf.toString('utf8');
    }
  } catch (e) {}
  return '# ' + String(fallbackTitle || name || 'UI规范') + '\n\n（出厂种子缺失，可直接编辑覆盖本文件。）\n';
}
function uilibPresetDefs() {
  const now = Date.now();
  return [
    { id: 'uilib-vant', name: 'Vant', version: '4.9.0', css: ['https://cdn.jsdelivr.net/npm/vant@4.9.0/lib/index.css'], js: ['https://cdn.jsdelivr.net/npm/vue@3.4.0/dist/vue.global.prod.js', 'https://cdn.jsdelivr.net/npm/vant@4.9.0/lib/vant.min.js'], deps: 'vue@3.4.0', initScript: '', snippet: '<!-- Vant 4.9.0（移动端，锁版本） -->\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vant@4.9.0/lib/index.css">', updatedAt: now },
    { id: 'uilib-element-plus', name: 'Element Plus', version: '2.7.0', css: ['https://cdn.jsdelivr.net/npm/element-plus@2.7.0/dist/index.css'], js: ['https://cdn.jsdelivr.net/npm/vue@3.4.0/dist/vue.global.prod.js', 'https://cdn.jsdelivr.net/npm/element-plus@2.7.0/dist/index.full.min.js'], deps: 'vue@3.4.0', initScript: '', snippet: '<!-- Element Plus 2.7.0（桌面端，锁版本） -->\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/element-plus@2.7.0/dist/index.css">', updatedAt: now },
    { id: 'uilib-antd', name: 'Ant Design', version: '5.18.0', css: ['https://cdn.jsdelivr.net/npm/antd@5.18.0/dist/reset.css'], js: ['https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js', 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js', 'https://cdn.jsdelivr.net/npm/antd@5.18.0/dist/antd.min.js'], deps: 'react@18.3.1 react-dom@18.3.1', initScript: '', snippet: '<!-- Ant Design 5.18.0（桌面端，锁版本） -->\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/antd@5.18.0/dist/reset.css">', updatedAt: now }
  ];
}
function ensureSpecsInit() {
  try {
    if (!fs.existsSync(paths.SPECS_ROOT)) fs.mkdirSync(paths.SPECS_ROOT, { recursive: true });
    const seedBuiltinDefs = function () {
      try { return specPresetDefs().filter(function (d) { return d && d.builtin && d.uiSpec && d.seedFile; }); } catch (e) { return []; }
    };
    const seedOneBuiltin = function (d, now) {
      const content = (d.seedFile ? readSeedContent(d.seedFile, d.name) : String(d.content || ''));
      try { fs.writeFileSync(path.join(paths.SPECS_ROOT, d.id + '.md'), content, 'utf8'); } catch (e) {}
      return { id: d.id, name: d.name, desc: d.desc, file: d.id + '.md', kind: d.kind || '', uiSpec: true, builtin: true, enabled: d.enabled !== false, version: d.version || 1, updatedAt: now };
    };
    let items = readJsonArrayFile(paths.SPECS_INDEX_FILE);
    if (Array.isArray(items) && items.length) {
      try {
        items.forEach((it) => {
          if (!it || !it.id || !it.file) return;
          const f = path.normalize(path.join(paths.SPECS_ROOT, String(it.file)));
          if (f !== path.normalize(paths.SPECS_ROOT) && f.indexOf(path.normalize(paths.SPECS_ROOT) + path.sep) === 0 && !fs.existsSync(f)) {
            /* 索引有但文件缺失：占位空文件，避免 read 500 穿透 */
            try { fs.writeFileSync(f, '# ' + String(it.name || it.id) + '\n\n（规范正文文件缺失，可重新编辑覆盖。）\n', 'utf8'); } catch (e) {}
          }
        });
      } catch (e) {}
      /* 存量用户增量补齐：缺失的出厂内置 UI 规范只追加、不动用户现有条目与文件；
       * 用户亲手删掉的内置（墓碑 removedBuiltinSpecs）不再复活 */
      try {
        const now = Date.now();
        let removed = [];
        try { removed = getRemovedBuiltinIds(); } catch (e) {}
        let changed = false;
        seedBuiltinDefs().forEach((d) => {
          if (removed.indexOf(d.id) >= 0) return;
          let found = false;
          for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === d.id) { found = true; break; } }
          if (!found) { items.push(seedOneBuiltin(d, now)); changed = true; }
        });
        if (changed) { try { fs.writeFileSync(paths.SPECS_INDEX_FILE, JSON.stringify(items, null, 2), 'utf8'); } catch (e) {} }
      } catch (e) {}
      return items;
    }
    const defs = specPresetDefs();
    const now = Date.now();
    items = defs.map((d) => {
      if (d && d.builtin && d.uiSpec && d.seedFile) return seedOneBuiltin(d, now);
      try { fs.writeFileSync(path.join(paths.SPECS_ROOT, d.id + '.md'), d.content, 'utf8'); } catch (e) {}
      return { id: d.id, name: d.name, desc: d.desc, file: d.id + '.md', updatedAt: now };
    });
    try { fs.writeFileSync(paths.SPECS_INDEX_FILE, JSON.stringify(items, null, 2), 'utf8'); } catch (e) {}
    return items;
  } catch (e) { return []; }
}
/* 用户删除的出厂内置规范 id 墓碑（存 ai-config removedBuiltinSpecs）：增量补齐时跳过，
 * 否则下次打开设置页会自动复活用户删掉的内置规范。 */
function getRemovedBuiltinIds() {
  try {
    const cfg = aiConfigStore.loadAiConfigFull() || {};
    const arr = cfg.removedBuiltinSpecs;
    if (Array.isArray(arr)) return arr.filter(function (x) { return typeof x === 'string' && x; });
  } catch (e) {}
  return [];
}
/* 按端别读取选中的 UI 规范正文（AI 生成原型时注入；用户改 specs/ 下 md 即时生效，无需重启）
 * 选中态存 ai-config：activeUiSpecMobile/activeUiSpecPc（规范 id；null 或缺失=该端不选，不注入）。
 * 设置页每端最多选中一个，切换端互不影响。初始即为空选中（不设默认）。 */
function readUiSpecForKind(kind) {
  try {
    const k = (String(kind || '').toLowerCase() === 'pc') ? 'pc' : 'mobile';
    const items = ensureSpecsInit();
    const list = Array.isArray(items) ? items : [];
    const readItemFile = function (it) {
      if (!it || !it.file) return null;
      const f = path.normalize(path.join(paths.SPECS_ROOT, String(it.file)));
      if (f === path.normalize(paths.SPECS_ROOT) || f.indexOf(path.normalize(paths.SPECS_ROOT) + path.sep) !== 0) return null;
      try { if (!isSubPath(f, paths.SPECS_ROOT)) return null; } catch (e) { return null; }
      let buf = null;
      try { buf = fs.readFileSync(f); } catch (e) { return null; }
      if (!buf || !buf.length || buf.length > paths.SPEC_MAX_BYTES || !isUtf8Buffer(buf)) return null;
      const content = buf.toString('utf8');
      if (!content.trim()) return null;
      return { id: it.id, name: it.name || it.id, kind: k, content: content };
    };
    const kindOk = function (it) {
      const ik = String((it && it.kind) || '');
      return ik === '' || ik === k;
    };
    /* 1) 仅显式选中生效：未选（缺失/null）即不注入；选中项缺失/端别不兼容/不可读即不注入 */
    try {
      const cfg = aiConfigStore.loadAiConfigFull() || {};
      const sel = (k === 'pc') ? cfg.activeUiSpecPc : cfg.activeUiSpecMobile;
      if (typeof sel === 'string' && sel) {
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it && it.id === sel && kindOk(it) && it.enabled !== false) {
            return readItemFile(it);
          }
        }
      }
      return null;
    } catch (e) { return null; }
  } catch (e) { return null; }
}
function ensureUilibsInit() {
  try {
    if (!fs.existsSync(paths.UILIBS_ROOT)) fs.mkdirSync(paths.UILIBS_ROOT, { recursive: true });
    const items = readJsonArrayFile(paths.UILIBS_INDEX_FILE);
    if (Array.isArray(items) && items.length) return items;
    const defs = uilibPresetDefs();
    try { fs.writeFileSync(paths.UILIBS_INDEX_FILE, JSON.stringify(defs, null, 2), 'utf8'); } catch (e) {}
    return defs;
  } catch (e) { return []; }
}
function writeSpecsIndex(items) { try { if (!fs.existsSync(paths.SPECS_ROOT)) fs.mkdirSync(paths.SPECS_ROOT, { recursive: true }); fs.writeFileSync(paths.SPECS_INDEX_FILE, JSON.stringify(items || [], null, 2), 'utf8'); } catch (e) {} }
function writeUilibsIndex(items) { try { if (!fs.existsSync(paths.UILIBS_ROOT)) fs.mkdirSync(paths.UILIBS_ROOT, { recursive: true }); fs.writeFileSync(paths.UILIBS_INDEX_FILE, JSON.stringify(items || [], null, 2), 'utf8'); } catch (e) {} }
function specTargetFor(id) {
  const clean = sanitizeLibId(id);
  if (!clean) return null;
  const rootNorm = path.normalize(paths.SPECS_ROOT);
  const target = path.normalize(path.join(paths.SPECS_ROOT, clean + '.md'));
  if (target === rootNorm || target.indexOf(rootNorm + path.sep) !== 0) return null;
  try { if (!isSubPath(target, paths.SPECS_ROOT)) return null; } catch (e) { return null; }
  return target;
}
function isUtf8Buffer(buf) {
  try {
    const TD = (typeof TextDecoder !== 'undefined') ? TextDecoder : require('util').TextDecoder;
    new TD('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch (e) { return false; }
}
function firstNonEmptyLine(text) {
  try {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const t = String(lines[i] || '').trim().replace(/^#+\s*/, '').trim();
      if (t) return t.slice(0, 120);
    }
  } catch (e) {}
  return '';
}
function normalizeUrlArray(v) {
  if (v == null || v === '') return { ok: true, list: [] };
  if (!Array.isArray(v)) return { ok: false, error: 'css/js 须为数组' };
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const u = String(v[i] == null ? '' : v[i]).trim();
    if (!u) continue;
    if (u.indexOf('\0') >= 0 || /\s/.test(u) || !/^https?:\/\/\S+$/i.test(u)) return { ok: false, error: '组件地址格式错误，仅支持 http(s) URL：' + u.slice(0, 80) };
    out.push(u);
  }
  return { ok: true, list: out };
}
function emptyProjectBinding() { return { specId: '', specName: '', uiLibId: '', uiLibName: '', updatedAt: 0 }; }
function readProjectBindingFile(projDir) {
  try {
    const f = path.join(projDir, 'project.json');
    if (!fs.existsSync(f)) return emptyProjectBinding();
    const raw = JSON.parse(fs.readFileSync(f, 'utf8') || '{}');
    const b = emptyProjectBinding();
    b.specId = String((raw && raw.specId) || '');
    b.specName = String((raw && raw.specName) || '');
    b.uiLibId = String((raw && raw.uiLibId) || '');
    b.uiLibName = String((raw && raw.uiLibName) || '');
    b.updatedAt = Number((raw && raw.updatedAt) || 0) || 0;
    return b;
  } catch (e) { return emptyProjectBinding(); }
}
/* spec:list — 读库全量，缺目录自动初始化预设 */
function reqFileFor(dir) {
  try {
    const d = String(dir || '');
    if (d) {
      const dn = path.normalize(d);
      const rootNorm = path.normalize(paths.SANDBOX_ROOT);
      if (dn === rootNorm || dn.startsWith(rootNorm + path.sep)) return path.join(dn, '最新需求.md');
    }
  } catch (e) {}
  return paths.REQ_FALLBACK_FILE; /* 无有效沙箱目录：回退工具级 */
}
/* P3 多文档：doc 文件名清洗（仅允许 [a-zA-Z0-9_\u4e00-\u9fa5.-]，拒 / \ 盘符 ../ \0，且须为 .md） */
function sanitizeDocFile(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.includes('\0')) return null;
  if (s.includes('/') || s.includes('\\')) return null;
  if (s.includes('..')) return null;
  if (/^[a-zA-Z]:/.test(s)) return null;
  if (s === '.' || s === '..') return null;
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5.\-]+$/.test(s)) return null;
  if (!/\.md$/i.test(s)) return null;
  if (s.length > 100) return null;
  return s;
}
/* P3 多文档：兼容旧调用(doc:read-latest,dir)与新对象({dir,file}) */
function parseDocReadArgs(a, b) {
  let dir = '';
  let file;
  if (typeof a === 'string') {
    dir = a;
    if (typeof b === 'string' && b) file = b;
    else if (b && typeof b === 'object' && typeof b.file === 'string' && b.file) file = b.file;
  } else if (a && typeof a === 'object') {
    dir = a.dir != null ? String(a.dir) : '';
    if (typeof a.file === 'string' && a.file) file = a.file;
    else if (typeof b === 'string' && b) file = b;
  }
  return { dir: dir, file: file };
}
/* P3 多文档：兼容旧调用(doc:write-latest,dir,content)与新对象({dir,file,content})/({dir,file},content) */
function parseDocWriteArgs(a, b, c) {
  let dir = '';
  let file;
  let content;
  if (typeof a === 'string') {
    dir = a;
    if (b && typeof b === 'object') {
      file = b.file;
      content = (b.content !== undefined ? b.content : c);
    } else {
      content = b;
      if (typeof c === 'string' && c) file = c;
      else if (c && typeof c === 'object' && typeof c.file === 'string') file = c.file;
    }
  } else if (a && typeof a === 'object') {
    dir = a.dir != null ? String(a.dir) : '';
    if (typeof a.file === 'string' && a.file) file = a.file;
    content = (a.content !== undefined ? a.content : b);
    if (content !== undefined && typeof content === 'object' && content !== null && content.content !== undefined && a.content === undefined) content = content.content;
    if (!file && c && typeof c === 'string') file = c;
  }
  return { dir: dir, file: file, content: content };
}
function fmtTs(d) {
  const p = shared.pad2;
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
/* 目录必须是沙箱内的真实原型目录（非沙箱根本身），否则返回 null */
function validProtoDir(dir) {
  try {
    const rootNorm = path.normalize(paths.SANDBOX_ROOT);
    const dn = path.normalize(String(dir || ''));
    if (!dn.startsWith(rootNorm + path.sep)) return null;
    if (dn === rootNorm) return null;
    if (!fs.existsSync(dn)) return null;
    return dn;
  } catch (e) { return null; }
}
function snapRootFor(dir) {
  const rootNorm = path.normalize(paths.SANDBOX_ROOT);
  const dn = path.normalize(String(dir || ''));
  if (!dn.startsWith(rootNorm + path.sep)) return null;
  const rel = dn.slice(rootNorm.length + 1); /* <项目>\<原型> */
  return path.join(userDataDir(), 'snapshots', rel);
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
    while (all.length > paths.SNAP_KEEP) {
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

/* ═══════ AI执行流 done.fileChanges 行级diff（功能说明 5.1/6.2）：任务前后快照做行级diff，不依赖git ═══════
 * 沙箱文件不一定在 git 仓库，行数一律由任务前后内容快照逐行对比得出；任何失败回落为只有 {path,action}，永不抛错。
 * 白名单仅覆盖常见文本扩展（html/md/js/css/json），单文件上限 200KB，含 NUL 字节按二进制跳过。 */
const AI_DIFF_TEXT_EXTS = new Set(['.html', '.htm', '.md', '.js', '.css', '.json']);
const AI_DIFF_MAX_BYTES = 200 * 1024;
const AI_DIFF_LCS_CELL_LIMIT = 2500000;

function isDiffableTextFile(relPath, size) {
  try {
    if (typeof size === 'number' && size > AI_DIFF_MAX_BYTES) return false;
    const ext = path.extname(String(relPath || '')).toLowerCase();
    return AI_DIFF_TEXT_EXTS.has(ext);
  } catch (e) { return false; }
}

/**
 * 快照原型目录内可diff文本文件的内容表（行级diff用，不依赖git）。
 * @param {string} dirPath 沙箱目录（须在沙箱范围内，复用 validProtoDir/isSubPath 越权校验）
 * @returns {Map<string,string>} 相对路径 -> UTF8文本内容（不可读/超限/二进制/非白名单扩展一律跳过，永不抛错）
 */
function snapshotProtoFileContents(dirPath) {
  const out = new Map();
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return out;
    try {
      const rootNorm = path.normalize(paths.SANDBOX_ROOT);
      const dn = path.normalize(String(dirPath));
      const inRoot = (dn === rootNorm) || dn.startsWith(rootNorm + path.sep);
      if (!inRoot) return out;
      if (dn !== rootNorm && typeof isSubPath === 'function' && !isSubPath(dn, paths.SANDBOX_ROOT)) return out;
    } catch (e) { return out; }
    const walk = (cur, relBase) => {
      let entries = null;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        try {
          if (!entry || !entry.name || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(cur, entry.name);
          const rel = path.join(relBase, entry.name).replace(/\\/g, '/');
          if (entry.isDirectory()) { walk(full, rel); continue; }
          if (!entry.isFile()) continue;
          let st = null;
          try { st = fs.statSync(full); } catch (e) { continue; }
          if (!st || !st.isFile()) continue;
          if (!isDiffableTextFile(rel, st.size)) continue;
          let buf = null;
          try { buf = fs.readFileSync(full); } catch (e) { continue; }
          if (!buf || buf.length > AI_DIFF_MAX_BYTES) continue;
          if (buf.indexOf(0) >= 0) continue;
          let text = '';
          try { text = buf.toString('utf8'); } catch (e) { continue; }
          if (text.indexOf('\0') >= 0) continue;
          out.set(rel, text);
        } catch (e) {}
      }
    };
    walk(path.normalize(String(dirPath)), '');
  } catch (e) {}
  return out;
}

/**
 * 统计文本行数（空文件计 0，末尾换行不另计一行）。
 * @param {string} text 文本内容
 * @returns {number} 行数
 */
function countTextLines(text) {
  try {
    const s = String(text == null ? '' : text);
    if (!s) return 0;
    const parts = s.split(/\r?\n/);
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts.length;
  } catch (e) { return 0; }
}

/**
 * 两段文本的行级diff（前后公共前缀/后缀裁剪后，中段用 LCS 精确计算；中段过大回落整段替换估算）。
 * @param {string} beforeText 修改前全文
 * @param {string} afterText 修改后全文
 * @returns {{added:number,deleted:number}} 新增行数/删除行数
 */
function diffTextLines(beforeText, afterText) {
  let aLines = [];
  let bLines = [];
  try {
    const a = String(beforeText == null ? '' : beforeText);
    const b = String(afterText == null ? '' : afterText);
    aLines = a ? a.split(/\r?\n/) : [];
    bLines = b ? b.split(/\r?\n/) : [];
    if (aLines.length && aLines[aLines.length - 1] === '') aLines.pop();
    if (bLines.length && bLines[bLines.length - 1] === '') bLines.pop();
  } catch (e) { return { added: 0, deleted: 0 }; }
  let pre = 0;
  while (pre < aLines.length && pre < bLines.length && aLines[pre] === bLines[pre]) pre++;
  let suf = 0;
  while (suf < (aLines.length - pre) && suf < (bLines.length - pre) && aLines[aLines.length - 1 - suf] === bLines[bLines.length - 1 - suf]) suf++;
  const aMid = aLines.slice(pre, aLines.length - suf);
  const bMid = bLines.slice(pre, bLines.length - suf);
  if (!aMid.length) return { added: bMid.length, deleted: 0 };
  if (!bMid.length) return { added: 0, deleted: aMid.length };
  if ((aMid.length * bMid.length) > AI_DIFF_LCS_CELL_LIMIT) return { added: bMid.length, deleted: aMid.length };
  let prev = new Uint32Array(bMid.length + 1);
  let cur = new Uint32Array(bMid.length + 1);
  for (let i = 1; i <= aMid.length; i++) {
    cur[0] = 0;
    const ai = aMid[i - 1];
    for (let j = 1; j <= bMid.length; j++) {
      if (ai === bMid[j - 1]) cur[j] = prev[j - 1] + 1;
      else cur[j] = prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1];
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  const lcs = prev[bMid.length];
  return { added: bMid.length - lcs, deleted: aMid.length - lcs };
}

/**
 * 两份内容快照的内容级diff（created=全部行added，deleted=全部行deleted，modified=行级diff）。
 * @param {Map<string,string>} beforeContents 修改前内容表
 * @param {Map<string,string>} afterContents 修改后内容表
 * @returns {Map<string,{added:number,deleted:number}>} 相对路径 -> 行数变化（永不抛错）
 */
function diffFileContents(beforeContents, afterContents) {
  const out = new Map();
  try {
    const b = (beforeContents instanceof Map) ? beforeContents : new Map();
    const a = (afterContents instanceof Map) ? afterContents : new Map();
    const keys = new Set([...b.keys(), ...a.keys()]);
    for (const k of keys) {
      try {
        const hasB = b.has(k);
        const hasA = a.has(k);
        if (hasB && !hasA) out.set(k, { added: 0, deleted: countTextLines(b.get(k)) });
        else if (!hasB && hasA) out.set(k, { added: countTextLines(a.get(k)), deleted: 0 });
        else out.set(k, diffTextLines(b.get(k), a.get(k)));
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}

/**
 * 对比任务前后的文件签名，返回真实修改的文件清单
 * @param {Map<string,{size:number,mtimeMs:number}>} beforeMap 任务前签名表
 * @param {Map<string,{size:number,mtimeMs:number}>} afterMap 任务后签名表
 * @param {Map<string,string>} [beforeContents] 任务前内容快照（可选，传入则附带 added/deleted）
 * @param {Map<string,string>} [afterContents] 任务后内容快照（可选，传入则附带 added/deleted）
 * @returns {Array<{path:string,action:string,added?:number,deleted?:number}>} 变更清单（行数失败回落只有 path+action）
 */
function diffFileSignatures(beforeMap, afterMap, beforeContents, afterContents) {
  const changes = [];
  if (!beforeMap || !afterMap) return changes;
  const hasContents = (beforeContents instanceof Map) && (afterContents instanceof Map);
  const withNumbers = (base, relPath, kind) => {
    try {
      if (!hasContents) return base;
      let nums = null;
      if (kind === 'deleted' && beforeContents.has(relPath)) {
        nums = { added: 0, deleted: countTextLines(beforeContents.get(relPath)) };
      } else if (kind === 'created' && afterContents.has(relPath)) {
        nums = { added: countTextLines(afterContents.get(relPath)), deleted: 0 };
      } else if (kind === 'modified' && beforeContents.has(relPath) && afterContents.has(relPath)) {
        nums = diffTextLines(beforeContents.get(relPath), afterContents.get(relPath));
      } else {
        return base;
      }
      if (!nums) return base;
      if (nums.added === 0 && nums.deleted === 0) return base;
      base.added = nums.added;
      base.deleted = nums.deleted;
      return base;
    } catch (e) { return base; }
  };

  for (const [relPath, beforeStat] of beforeMap.entries()) {
    if (!afterMap.has(relPath)) {
      try { changes.push(withNumbers({ path: relPath, action: 'deleted' }, relPath, 'deleted')); }
      catch (e) { changes.push({ path: relPath, action: 'deleted' }); }
    } else {
      const afterStat = afterMap.get(relPath);
      if (beforeStat.size !== afterStat.size || Math.abs(beforeStat.mtimeMs - afterStat.mtimeMs) > 20) {
        try { changes.push(withNumbers({ path: relPath, action: 'modified' }, relPath, 'modified')); }
        catch (e) { changes.push({ path: relPath, action: 'modified' }); }
      }
    }
  }

  for (const [relPath] of afterMap.entries()) {
    if (!beforeMap.has(relPath)) {
      try { changes.push(withNumbers({ path: relPath, action: 'created' }, relPath, 'created')); }
      catch (e) { changes.push({ path: relPath, action: 'created' }); }
    }
  }

  /* AI执行流展示2.4：多文件修改时按path排序后返回，保证done.fileChanges回放确定性（只定序，不改元素结构） */
  try {
    changes.sort((a, b) => {
      const pa = String((a && (a.path || a.file || a.name)) || '');
      const pb = String((b && (b.path || b.file || b.name)) || '');
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  } catch (e) {}
  return changes;
}

/* 沙箱根越界守卫：单目录文件数上限（性能有界，超限截断并标记 truncated） */
const SANDBOX_GUARD_MAX_FILES_PER_DIR = 1000;

/**
 * 扫描沙箱根下现状并与任务前快照对比，仅返回落在 allowedDir 之外的变更。
 * 纯助手函数：只读扫描，不写盘，永不抛错；复用白名单/200KB/二进制跳过与点目录/node_modules 跳过。
 * @param {string} rootDir 沙箱根目录绝对路径（如 paths.SANDBOX_ROOT）
 * @param {string} allowedDir 本次任务允许变动的原型目录（绝对路径，或相对沙箱根的顶层原型名；其下变更一律过滤）
 * @param {Map|Object} beforeMap 任务开始前对沙箱根下各原型目录的签名快照（调用方传入）
 * @returns {Array<{path:string,action:string}>} 落在 allowedDir 之外的变更列表，path 为相对沙箱根路径（/ 分隔，已按 path 排序）；数组附带 truncated:boolean，超限截断时为 true
 *
 * 快照侧配套用法（调用方负责，本文件不接线，不接到 aiAsk 调用链）：
 * 任务前调一次：遍历沙箱根下各原型目录，逐目录调 getProtoFileSignature 取签名，
 * 按“顶层目录名/目录内相对路径”拼成相对沙箱根路径，合并为一个 beforeMap 传入。
 *   const beforeMap = new Map();
 *   for (const d of fs.readdirSync(rootDir, { withFileTypes: true })) {
 *     if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
 *     const sig = getProtoFileSignature(path.join(rootDir, d.name));
 *     for (const [rel, st] of sig) beforeMap.set(d.name + '/' + rel, st);
 *   }
 * 任务后调一次：diffSandboxRootAgainst(rootDir, allowedProtoDir, beforeMap)，
 * allowedProtoDir 传本次任务的原型目录绝对路径（如 path.join(rootDir, '原型A')），
 * 返回中凡 path 落在该目录内的一律已过滤，只剩隔壁原型越界变更。
 * beforeMap 也兼容 { 顶层目录名: Map/对象 } 的分组形态，函数内自动拍平。
 */
function diffSandboxRootAgainst(rootDir, allowedDir, beforeMap) {
  const changes = [];
  changes.truncated = false;
  try {
    if (rootDir == null || (typeof rootDir !== 'string' && typeof rootDir !== 'object')) return changes;
    const rawRoot = String(rootDir || '').trim();
    if (!rawRoot || rawRoot.indexOf('\0') >= 0) return changes;
    const rootNorm = path.normalize(rawRoot);
    if (!rootNorm || !fs.existsSync(rootNorm)) return changes;
    let rootStat = null;
    try { rootStat = fs.statSync(rootNorm); } catch (e) { return changes; }
    if (!rootStat || !rootStat.isDirectory()) return changes;
    const toSlash = (s) => String(s || '').replace(/\\/g, '/');
    const isSkippedRel = (rel) => {
      try {
        const segs = toSlash(rel).split('/');
        for (const sg of segs) {
          if (!sg) continue;
          if (sg.startsWith('.') || sg === 'node_modules') return true;
        }
        return false;
      } catch (e) { return false; }
    };
    let allowedRel = null;
    try {
      const raw = String(allowedDir == null ? '' : allowedDir).trim();
      if (raw) {
        if (path.isAbsolute(raw)) {
          const aNorm = path.normalize(raw);
          const rel = path.relative(rootNorm, aNorm);
          if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
            allowedRel = toSlash(rel).replace(/\/+$/, '');
          } else if (!rel) {
            allowedRel = '';
          } else {
            allowedRel = null;
          }
        } else {
          const cleaned = toSlash(raw).replace(/^\/+|\/+$/g, '').replace(/^\.\//, '');
          if (cleaned && !cleaned.startsWith('..') && cleaned.indexOf('\0') < 0) {
            allowedRel = cleaned;
          }
        }
      }
    } catch (e) { allowedRel = null; }
    const isOutside = (rel) => {
      try {
        const r = toSlash(rel).replace(/^\/+/, '');
        if (allowedRel == null) return true;
        if (allowedRel === '') return false;
        if (r === allowedRel) return false;
        return !(r.startsWith(allowedRel + '/'));
      } catch (e) { return true; }
    };
    const flatBefore = new Map();
    try {
      const putOne = (k, v) => {
        try {
          const key = toSlash(String(k || '')).replace(/^\/+/, '');
          if (!key || isSkippedRel(key)) return;
          if (!v || typeof v !== 'object') return;
          const size = (typeof v.size === 'number') ? v.size : undefined;
          if (!isDiffableTextFile(key, size)) return;
          const mtimeMs = (typeof v.mtimeMs === 'number') ? v.mtimeMs : Number(v.mtimeMs) || 0;
          flatBefore.set(key, { size: size, mtimeMs: mtimeMs });
        } catch (e) {}
      };
      const expandGroup = (dirName, group) => {
        try {
          const prefix = toSlash(String(dirName || '')).replace(/^\/+|\/+$/g, '');
          if (!prefix || isSkippedRel(prefix)) return;
          if (group instanceof Map) {
            for (const [rk, rv] of group.entries()) {
              try {
                const inner = toSlash(String(rk || '')).replace(/^\/+/, '');
                if (!inner || isSkippedRel(inner)) continue;
                putOne(prefix + '/' + inner, rv);
              } catch (e) {}
            }
          } else if (group && typeof group === 'object') {
            for (const rk of Object.keys(group)) {
              try {
                const inner = toSlash(String(rk || '')).replace(/^\/+/, '');
                if (!inner || isSkippedRel(inner)) continue;
                putOne(prefix + '/' + inner, group[rk]);
              } catch (e) {}
            }
          }
        } catch (e) {}
      };
      if (beforeMap instanceof Map) {
        for (const [k, v] of beforeMap.entries()) {
          try {
            if (v instanceof Map) expandGroup(k, v);
            else if (v && typeof v === 'object' && typeof v.size !== 'number' && typeof v.mtimeMs !== 'number') {
              const keys = Object.keys(v);
              const looksGroup = keys.length && keys.every((kk) => v[kk] && typeof v[kk] === 'object');
              if (looksGroup) expandGroup(k, v);
              else putOne(k, v);
            } else putOne(k, v);
          } catch (e) {}
        }
      } else if (beforeMap && typeof beforeMap === 'object') {
        for (const k of Object.keys(beforeMap)) {
          try {
            const v = beforeMap[k];
            if (v instanceof Map) expandGroup(k, v);
            else if (v && typeof v === 'object' && typeof v.size !== 'number' && typeof v.mtimeMs !== 'number') {
              const keys = Object.keys(v);
              const looksGroup = keys.length && keys.every((kk) => v[kk] && typeof v[kk] === 'object');
              if (looksGroup) expandGroup(k, v);
              else putOne(k, v);
            } else putOne(k, v);
          } catch (e) {}
        }
      }
    } catch (e) {}
    const afterMap = new Map();
    let truncated = false;
    try {
      let topEntries = null;
      try { topEntries = fs.readdirSync(rootNorm, { withFileTypes: true }); } catch (e) { topEntries = null; }
      if (topEntries) {
        for (const top of topEntries) {
          try {
            if (!top || !top.name || top.name.startsWith('.') || top.name === 'node_modules') continue;
            const topFull = path.join(rootNorm, top.name);
            if (top.isDirectory()) {
              let count = 0;
              const stack = [{ cur: topFull, base: '' }];
              let stopDir = false;
              while (stack.length && !stopDir) {
                let curItem = null;
                try { curItem = stack.pop(); } catch (e) { break; }
                if (!curItem) break;
                let entries = null;
                try { entries = fs.readdirSync(curItem.cur, { withFileTypes: true }); } catch (e) { continue; }
                if (!entries) continue;
                for (const entry of entries) {
                  try {
                    if (!entry || !entry.name || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    const full = path.join(curItem.cur, entry.name);
                    const inner = curItem.base ? curItem.base + '/' + entry.name : entry.name;
                    const rootRel = top.name + '/' + toSlash(inner);
                    if (isSkippedRel(rootRel)) continue;
                    if (entry.isDirectory()) {
                      stack.push({ cur: full, base: toSlash(inner) });
                      continue;
                    }
                    if (!entry.isFile()) continue;
                    count++;
                    if (count > SANDBOX_GUARD_MAX_FILES_PER_DIR) { truncated = true; stopDir = true; break; }
                    let st = null;
                    try { st = fs.statSync(full); } catch (e) { continue; }
                    if (!st || !st.isFile()) continue;
                    if (!isDiffableTextFile(rootRel, st.size)) continue;
                    let buf = null;
                    try { buf = fs.readFileSync(full); } catch (e) { continue; }
                    if (!buf || buf.length > AI_DIFF_MAX_BYTES) continue;
                    if (buf.indexOf(0) >= 0) continue;
                    afterMap.set(rootRel, { size: st.size, mtimeMs: Math.round(st.mtimeMs) });
                  } catch (e) {}
                }
              }
            } else if (top.isFile()) {
              try {
                const rootRel = top.name;
                if (isSkippedRel(rootRel)) continue;
                let st = null;
                try { st = fs.statSync(topFull); } catch (e) { continue; }
                if (!st || !st.isFile()) continue;
                if (!isDiffableTextFile(rootRel, st.size)) continue;
                let buf = null;
                try { buf = fs.readFileSync(topFull); } catch (e) { continue; }
                if (!buf || buf.length > AI_DIFF_MAX_BYTES) continue;
                if (buf.indexOf(0) >= 0) continue;
                afterMap.set(toSlash(rootRel), { size: st.size, mtimeMs: Math.round(st.mtimeMs) });
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    try {
      for (const [rel, b] of flatBefore.entries()) {
        try {
          if (!afterMap.has(rel)) {
            if (isOutside(rel)) changes.push({ path: rel, action: 'deleted' });
          } else {
            const a = afterMap.get(rel);
            const bs = (b && typeof b.size === 'number') ? b.size : -1;
            const asz = (a && typeof a.size === 'number') ? a.size : -2;
            const bm = (b && typeof b.mtimeMs === 'number') ? b.mtimeMs : 0;
            const am = (a && typeof a.mtimeMs === 'number') ? a.mtimeMs : 0;
            if (bs !== asz || Math.abs(bm - am) > 20) {
              if (isOutside(rel)) changes.push({ path: rel, action: 'modified' });
            }
          }
        } catch (e) {}
      }
      for (const [rel] of afterMap.entries()) {
        try {
          if (!flatBefore.has(rel)) {
            if (isOutside(rel)) changes.push({ path: rel, action: 'created' });
          }
        } catch (e) {}
      }
      try {
        changes.sort((a, b) => {
          const pa = String((a && a.path) || '');
          const pb = String((b && b.path) || '');
          return pa < pb ? -1 : pa > pb ? 1 : 0;
        });
      } catch (e) {}
    } catch (e) {}
    changes.truncated = !!truncated;
    return changes;
  } catch (e) {
    try { changes.truncated = false; } catch (e2) {}
    return changes;
  }
}

/* ═══════ 技能快照 stageSkillsToContext：agy 实测结论纯关键词不会自动读 skill，必须显式给地址 ═══════
 * 把每个 skill 目录只读式拷贝到 <cwd>/.context/skills/<skill-id>/，返回 [{id, keywords, relPath}]。
 * 映射关系写死在函数内（SKILL_KEYWORDS_MAP），未知 id 直接跳过；单个 skill 失败跳过不断链。
 * @param {string} cwd 沙箱原型目录（工作目录，须存在）
 * @param {Array<string|Object>} [skills] 可选覆盖：string 为 skill-id 走默认源查找；{id, src|srcDir} 可显式指定源目录/文件
 * @returns {Array<{id:string,keywords:string,relPath:string}>} 已落盘技能清单（源缺失/拷贝失败即跳过该项） */
const SKILL_KEYWORDS_MAP = {
  'prototype-ui': '修改原型、页面、原型图、prototype-ui',
  'prd-skill': '修改文档、功能说明、PRD、需求文档'
};
const SKILL_CONTEXT_SUBDIR = 'skills';
function resolveSkillMainFile(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir);
    if (!entries || !entries.length) return null;
    let lower = null;
    try {
      for (let i = 0; i < entries.length; i++) {
        const n = String(entries[i] || '');
        if (n.toLowerCase() === 'skill.md') { lower = n; break; }
      }
    } catch (e) { lower = null; }
    if (lower) return lower;
    for (let i = 0; i < entries.length; i++) {
      const n = String(entries[i] || '');
      if (/\.md$/i.test(n)) return n;
    }
    return null;
  } catch (e) { return null; }
}
function findSkillSourceDir(skillId, explicitSrc) {
  try {
    const id = String(skillId || '').trim();
    if (!id) return null;
    if (explicitSrc) {
      try {
        let abs = String(explicitSrc).trim();
        if (!abs) return null;
        try { if (!path.isAbsolute(abs)) abs = path.resolve(abs); } catch (e) {}
        let st = null;
        try { st = fs.statSync(abs); } catch (e) { st = null; }
        if (st && st.isFile()) { try { return path.dirname(abs); } catch (e) { return null; } }
        if (st && st.isDirectory()) return abs;
      } catch (e) {}
    }
    const cands = [];
    try { cands.push(path.join(os.homedir(), '.agents', 'skills', id)); } catch (e) {}
    try { if (process.env.USERPROFILE) cands.push(path.join(process.env.USERPROFILE, '.agents', 'skills', id)); } catch (e) {}
    try { cands.push(path.join(__dirname, '..', '..', 'skills', id)); } catch (e) {}
    try { cands.push(path.join(process.cwd(), 'skills', id)); } catch (e) {}
    for (let i = 0; i < cands.length; i++) {
      try {
        const p = cands[i];
        if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
      } catch (e) {}
    }
    return null;
  } catch (e) { return null; }
}
function copyDirRecursiveSafe(srcDir, dstDir) {
  try {
    const srcNorm = path.normalize(String(srcDir || ''));
    const dstNorm = path.normalize(String(dstDir || ''));
    if (!srcNorm || !dstNorm || srcNorm === dstNorm) return false;
    if (dstNorm.startsWith(srcNorm + path.sep) || srcNorm.startsWith(dstNorm + path.sep)) return false;
    let entries = null;
    try { entries = fs.readdirSync(srcNorm, { withFileTypes: true }); } catch (e) { return false; }
    try { fs.mkdirSync(dstNorm, { recursive: true }); } catch (e) {}
    for (const entry of (entries || [])) {
      try {
        if (!entry || !entry.name) continue;
        const n = String(entry.name);
        if (n === '.git' || n === 'node_modules') continue;
        const s = path.join(srcNorm, n);
        const d = path.join(dstNorm, n);
        if (entry.isDirectory()) {
          copyDirRecursiveSafe(s, d);
        } else if (entry.isFile()) {
          try { fs.copyFileSync(s, d); } catch (e) {}
        }
      } catch (e) {}
    }
    return true;
  } catch (e) { return false; }
}
function stageSkillsToContext(cwd, skills) {
  const out = [];
  try {
    if (!cwd) return out;
    let st0 = null;
    try { st0 = fs.statSync(cwd); } catch (e) { return out; }
    if (!st0 || !st0.isDirectory()) return out;
    let list = null;
    try {
      if (Array.isArray(skills) && skills.length) {
        list = skills;
      } else if (skills && typeof skills === 'object') {
        const ks = Object.keys(skills);
        if (ks.length) list = ks.map((k) => ({ id: k, src: skills[k] }));
        else list = [{ id: 'prototype-ui' }, { id: 'prd-skill' }];
      } else {
        list = [{ id: 'prototype-ui' }, { id: 'prd-skill' }];
      }
    } catch (e) { list = [{ id: 'prototype-ui' }, { id: 'prd-skill' }]; }
    let destRoot = null;
    try {
      destRoot = path.join(String(cwd), '.context', SKILL_CONTEXT_SUBDIR);
      fs.mkdirSync(destRoot, { recursive: true });
    } catch (e) { return out; }
    for (let i = 0; i < (list || []).length; i++) {
      try {
        const item = list[i];
        let id = '';
        let explicit = null;
        if (typeof item === 'string') {
          id = String(item).trim();
        } else if (item && typeof item === 'object') {
          id = String(item.id || item.skillId || item.name || '').trim();
          explicit = item.src || item.srcDir || item.dir || item.path || item.source || null;
        }
        if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
        const keywords = SKILL_KEYWORDS_MAP[id];
        if (!keywords) continue;
        let srcDir = null;
        let srcFile = null;
        if (explicit) {
          try {
            let abs = String(explicit).trim();
            if (!abs) continue;
            try { if (!path.isAbsolute(abs)) abs = path.resolve(abs); } catch (e2) {}
            let st = null;
            try { st = fs.statSync(abs); } catch (e2) { st = null; }
            if (st && st.isFile()) { srcFile = abs; try { srcDir = path.dirname(abs); } catch (e2) { srcDir = null; } }
            else if (st && st.isDirectory()) { srcDir = abs; }
            else { continue; }
          } catch (e2) { continue; }
        } else {
          try { srcDir = findSkillSourceDir(id, null); } catch (e2) {}
        }
        if (!srcFile && !srcDir) continue;
        if (srcFile && !srcDir) {
          try { srcDir = path.dirname(srcFile); } catch (e2) {}
        }
        if (!srcDir) continue;
        const dstDir = path.join(destRoot, id);
        try { fs.mkdirSync(dstDir, { recursive: true }); } catch (e2) { continue; }
        try {
          if (srcFile) {
            const base = path.basename(srcFile);
            if (!base || base.indexOf('\0') >= 0 || base.indexOf('..') >= 0) continue;
            try { fs.copyFileSync(srcFile, path.join(dstDir, base)); } catch (e2) { continue; }
          } else {
            copyDirRecursiveSafe(srcDir, dstDir);
          }
        } catch (e2) { continue; }
        let relPath = '.context/skills/' + id + '/';
        try {
          const main = resolveSkillMainFile(dstDir) || resolveSkillMainFile(srcDir);
          if (main) relPath = '.context/skills/' + id + '/' + main;
        } catch (e2) {}
        out.push({ id: id, keywords: keywords, relPath: relPath });
      } catch (e2) {}
    }
  } catch (e) {}
  return out;
}

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
function isSubPath(candidate, base) {
  try {
    const cand = String(candidate || '');
    const b = String(base || '');
    if (!cand || !b) return false;
    let realBase;
    // P0-2 fix 使用缓存 paths.realSandboxRoot，避免 symlink 穿越，缺省回退 path.resolve
    if (path.normalize(b) === path.normalize(paths.SANDBOX_ROOT)) realBase = paths.realSandboxRoot;
    else try { realBase = fs.realpathSync(b); } catch (e) { realBase = path.resolve(b); }
    let realCand;
    try { realCand = fs.realpathSync(cand); } catch (e) {
      try {
        const dir = path.dirname(cand);
        const baseName = path.basename(cand);
        let realDir;
        try { realDir = fs.realpathSync(dir); } catch (e2) { realDir = path.resolve(dir); }
        // P0-2 fix 对不存在文件用 realpathSync(dirname)+sep+basename 再 startsWith(paths.realSandboxRoot+sep)
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
  return isSubPath(path.join(paths.SANDBOX_ROOT, rel), paths.SANDBOX_ROOT);
}
function isValidBranch(b){ return /^[a-zA-Z0-9._\/-]+$/.test(b) && b.length<=60 && !b.includes('..'); }

/* ═══════ P1 MD重构三-(1)(2)：proto-asset 图片资产（sandbox/<项目>/<原型>/assets/*） ═══════ */
const PROTO_ASSET_EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};
/* P1 asset 文件名时间戳：img_yyyyMMdd_HHmmss（与 fmtTs 的 yyyyMMdd-HHmmss 区分，下划线分隔） */
function fmtAssetTs(d) {
  const p = shared.pad2;
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
/* P1 proto-asset 协议 handler：只服务 paths.SANDBOX_ROOT 内 assets 图片（normalize+startsWith 防..穿越，白名单后缀，不存在404） */
async function handleProtoAsset(request) {
  try {
    const u = new URL(request.url);
    let rel = '';
    try {
      const host = String(u.host || u.hostname || '');
      const p = decodeURIComponentSafe(u.pathname || '');
      /* 映射规范 proto-asset://local/<项目>/<原型>/assets/x.png：host=local 剥离，仅用 pathname；非 local host 则拼回首段 */
      if (host && host !== '' && host !== 'local') rel = String('/' + host + p).replace(/^\/+/, '');
      else rel = String(p || '').replace(/^\/+/, '');
    } catch (e) { return new Response('Bad Request', { status: 400 }); }
    if (!rel || rel.includes('\0')) return new Response('Forbidden', { status: 403 });
    const rootNorm = path.normalize(paths.SANDBOX_ROOT);
    const full = path.normalize(path.join(paths.SANDBOX_ROOT, rel));
    if (full !== rootNorm && !full.startsWith(rootNorm + path.sep)) return new Response('Forbidden', { status: 403 });
    if (!isSubPath(full, paths.SANDBOX_ROOT)) return new Response('Forbidden', { status: 403 });
    const ext = path.extname(full).toLowerCase();
    const mime = PROTO_ASSET_EXT_MIME[ext];
    if (!mime) return new Response('Forbidden', { status: 403 });
    /* 仅服务 assets/ 内文件，不直接暴露 md/html/links 等 */
    const segs = full.split(path.sep);
    if (segs.indexOf('assets') < 0) return new Response('Forbidden', { status: 403 });
    let st = null;
    try { st = fs.statSync(full); } catch (e) { return new Response('Not Found', { status: 404 }); }
    if (!st || !st.isFile()) return new Response('Not Found', { status: 404 });
    const buf = fs.readFileSync(full);
    return new Response(buf, { status: 200, headers: { 'content-type': mime, 'content-length': String(st.size) } });
  } catch (e) {
    return new Response('Not Found', { status: 404 });
  }
}

/* P1 MD重构：保存剪贴板截图/图片到 <原型dir>/assets/ */
function logWriteImpl(ev, level, tag, msg) {
  try {
    const dir = logsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const p2 = shared.pad2;
    const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    let text = '';
    try { text = String(msg == null ? '' : msg); } catch (e) { text = String(msg); }
    try{ var st=fs.statSync(path.join(dir,'app-'+ymd+'.log')); if(st.size>5*1024*1024) fs.renameSync(path.join(dir,'app-'+ymd+'.log'), path.join(dir,'app-'+ymd+'.1.log')); }catch(e){}
    fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][' + String(level || 'info') + '][' + String(tag || 'app') + '] ' + text + '\n', 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }

}
function appGetVersionImpl() { try { return app.getVersion(); } catch (e) { return ''; } 
}
async function sandboxListImpl(ev, projectName) {
  const project = String(projectName || '').trim();
  const projects = sandboxProjects();
  const nameList = project ? [project] : projects;
  const grouped = await Promise.all(nameList.map(async (proj) => {
    const dirs = protoFolders(proj);
    return Promise.all(dirs.map(async (name) => {
      const dir = path.join(paths.SANDBOX_ROOT, proj, name);
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
        root: paths.SANDBOX_ROOT,
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
  return { root: paths.SANDBOX_ROOT, project: project || '', projects, folders };

}
/* 稳定ID注入（对齐 PlanC data-pr-id 语义，PlanD 覆盖放宽到一切带 class 的元素）：
 * 仅补缺失（已有 data-pr-id / data-testid 跳过），跳过 script/style/注释与 html/head/body 等骨架标签；
 * 同文件内唯一（pr-<tag>-<序号>，从已用最大序号续排），幂等，多次执行不增量。 */
function ensurePrIdInjected(html) {
  try {
    let s = String(html == null ? '' : html);
    const seen = Object.create(null);
    let maxN = 0;
    let m;
    const reExist = /data-pr-id\s*=\s*"([^"]*)"/gi;
    while ((m = reExist.exec(s))) {
      seen[m[1]] = 1;
      const k = /^pr-[a-z0-9]+-(\d+)$/.exec(m[1]);
      if (k) { const n = parseInt(k[1], 10); if (n > maxN) maxN = n; }
    }
    let cnt = maxN;
    const nid = (tag) => {
      cnt++;
      let id = 'pr-' + String(tag || 'div').toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + cnt;
      while (seen[id]) { cnt++; id = 'pr-' + String(tag || 'div').toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + cnt; }
      seen[id] = 1;
      return id;
    };
    const parts = s.split(/(<!--[\s\S]*?-->|<script[\s>][\s\S]*?<\/script\s*>|<style[\s>][\s\S]*?<\/style\s*>)/gi);
    for (let i = 0; i < parts.length; i += 2) {
      let chunk = parts[i];
      chunk = chunk.replace(/<(button|a|input|select|textarea|option|label)([^>]*?)>/gi, (m0, tag, attrs) => {
        if (/data-pr-id\s*=/.test(attrs) || /data-testid\s*=/.test(attrs)) return m0;
        return '<' + tag + attrs + ' data-pr-id="' + nid(tag) + '">';
      });
      chunk = chunk.replace(/<([a-z][a-z0-9]*)([^>]*\bclass\s*=\s*["'][^"']*["'][^>]*?)>/gi, (m0, tag, attrs) => {
        const tl = String(tag).toLowerCase();
        if (/^(html|head|body|script|style|link|meta|title|base|template)$/.test(tl)) return m0;
        if (/data-pr-id\s*=/.test(attrs) || /data-testid\s*=/.test(attrs)) return m0;
        return '<' + tag + attrs + ' data-pr-id="' + nid(tag) + '">';
      });
      chunk = chunk.replace(/<([a-z][a-z0-9]*)([^>]*\b(?:data-page|onclick)\s*=[^>]*?)>/gi, (m0, tag, attrs) => {
        if (/data-pr-id\s*=/.test(attrs)) return m0;
        return '<' + tag + attrs + ' data-pr-id="' + nid(tag) + '">';
      });
      parts[i] = chunk;
    }
    return parts.join('');
  } catch (e) { return String(html == null ? '' : html); }
}
function sandboxWriteImpl(ev, o) {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const file = String(o2.file || '').replace(/\\/g, '/');
  if (!file || file.includes('..') || file.includes('/')) return { ok: false, error: '非法文件名' };
  if (!isSubPath(dir, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let content = String(o2.content == null ? '' : o2.content);
    /* 稳定ID（对齐 PlanC data-pr-id）：html 写盘时为缺失元素补唯一标识并持久化，已有则跳过，保证选择器跨活文档/磁盘文件稳定 */
    try { if (/\.html?$/i.test(file)) content = ensurePrIdInjected(content); } catch (e) {}
    fs.writeFileSync(path.join(dir, file), content, 'utf8');
    return { ok: true, path: path.join(dir, file) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

}
async function sandboxReadFileImpl(ev, o) {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const file = String(o2.file || '').replace(/\\/g, '/');
  if (!file || file.includes('..')) return { ok: false, error: '非法文件名' };
  if (!isSubPath(dir, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };
    const content = await fs.promises.readFile(p, 'utf8');
    return { ok: true, content, file, path: p };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }

}
async function sandboxCreateSubpageImpl(ev, o) {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const subName = sanitizeProtoName(o2.name);
  if (!subName) return { ok: false, error: '子页面名称不能为空' };
  if (!isSubPath(dir, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
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

}
async function sandboxDeleteSubpageImpl(ev, o) {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const file = String(o2.file || '');
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return { ok: false, error: '非法文件名' };
  if (!isSubPath(dir, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  const targetPath = path.join(dir, file);
  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }

}
async function sandboxRenameSubpageImpl(ev, o) {
  const o2 = o || {};
  const dir = String(o2.dir || '');
  const oldFile = String(o2.oldFile || '');
  const newName = sanitizeProtoName(o2.newName);
  if (!oldFile || oldFile.includes('..') || oldFile.includes('/') || oldFile.includes('\\')) return { ok: false, error: '非法原文件名' };
  if (!newName) return { ok: false, error: '新名称不能为空或包含非法字符' };
  if (!isSubPath(dir, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
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

}
function sandboxCreateImpl(ev, o) {
  const name = sanitizeProtoName((o || {}).name);
  if (!name) return { ok: false, error: '名称不能为空或包含非法字符' };
  const kind = (o || {}).kind === 'pc' ? 'pc' : 'mobile';
  const project = sanitizeProjectName((o || {}).project) || paths.DEFAULT_PROJECT;
  const dir = path.join(paths.SANDBOX_ROOT, project, name);
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

}
function sandboxAdoptImpl(ev, o) {
  const o2 = o || {};
  const rawName = String(o2.name || '').trim();
  const srcPath = String(o2.srcPath || '');
  const fallbackName = srcPath ? path.basename(srcPath).replace(/\.(html?|md)$/i, '') : '';
  const name = sanitizeProtoName(rawName || fallbackName);
  if (!name) return { ok: false, error: '名称不能为空或包含非法字符' };
  const project = sanitizeProjectName(o2.project) || paths.DEFAULT_PROJECT;
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
      const dir2 = path.join(paths.SANDBOX_ROOT, project, nm);
      if (fs.existsSync(dir2)) return;
      try {
        fs.mkdirSync(dir2, { recursive: true });
        let adoptHtml = em.html;
        try { adoptHtml = ensurePrIdInjected(adoptHtml); } catch (e) {}
        fs.writeFileSync(path.join(dir2, nm + '.html'), adoptHtml, 'utf8');
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
  const dir = path.join(paths.SANDBOX_ROOT, project, name);
  try {
    if (fs.existsSync(dir)) return { ok: false, error: '同名原型已存在：' + name, dir };
    fs.mkdirSync(dir, { recursive: true });
    try { content = ensurePrIdInjected(content); } catch (e) {}
    fs.writeFileSync(path.join(dir, name + '.html'), content, 'utf8'); // P1-1 fix 使用净化后 content（已补稳定ID）
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

}
function sandboxRenameImpl(ev, o) {
  const o2 = o || {};
  const newName = sanitizeProtoName(o2.name);
  if (!newName) return { ok: false, error: '名称不能为空或包含非法字符' };
  const oldDir = path.normalize(String(o2.dir || ''));
  if (!isSubPath(oldDir, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
  const parentDir = path.dirname(oldDir);
  const rootNorm = path.normalize(paths.SANDBOX_ROOT); // P0-4 fix 补 rootNorm 定义，避免 ReferenceError
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

}
function sandboxRemoveImpl(ev, o) {
  const rootNorm = path.normalize(paths.SANDBOX_ROOT);
  const dir = path.normalize(String((o || {}).dir || ''));
  if (!isSubPath(dir, paths.SANDBOX_ROOT) || dir === rootNorm) return { ok: false, error: '目录不在沙箱范围内' };
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

}
function sandboxProjectsImpl() {
  const projects = sandboxProjects().map((name) => {
    let protoCount = 0;
    try { protoCount = protoFolders(name).length; } catch (e) {}
    return { name, protoCount };
  });
  return { root: paths.SANDBOX_ROOT, projects };

}
function projectCreateImpl(ev, o) {
  const name = sanitizeProjectName((o || {}).name);
  if (!name) return { ok: false, error: '项目名称不能为空或包含非法字符' };
  const dir = path.join(paths.SANDBOX_ROOT, name);
  try {
    if (fs.existsSync(dir)) return { ok: false, error: '同名项目已存在', dir };
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, name, dir };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), dir };
  }

}
function projectRenameImpl(ev, o) {
  const newName = sanitizeProjectName((o || {}).name);
  if (!newName) return { ok: false, error: '项目名称不能为空或包含非法字符' };
  const oldName = sanitizeProjectName((o || {}).oldName);
  if (!oldName) return { ok: false, error: '缺少原项目名称' };
  const oldDir = path.join(paths.SANDBOX_ROOT, oldName);
  const newFolder = path.join(paths.SANDBOX_ROOT, newName);
  if (oldName === newName) return { ok: true, dir: oldDir, name: oldName };
  try {
    if (fs.existsSync(newFolder)) return { ok: false, error: '同名项目已存在', dir: oldDir };
    if (!fs.existsSync(oldDir)) return { ok: false, error: '原项目不存在', dir: oldDir };
    fs.renameSync(oldDir, newFolder);
    return { ok: true, dir: newFolder, name: newName };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }

}
function projectRemoveImpl(ev, o) {
  const name = sanitizeProjectName((o || {}).name);
  if (!name) return { ok: false, error: '项目名称不能为空或包含非法字符' };
  if (name === paths.DEFAULT_PROJECT) return { ok: false, error: '「默认项目」为旧数据归拢目录，不可删除' };
  const dir = path.join(paths.SANDBOX_ROOT, name);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }

}
function specListImpl() {
  try {
    const items = ensureSpecsInit();
    return { ok: true, items: Array.isArray(items) ? items : [] };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), items: [] }; }

}
function specCreateFromFileImpl(ev, o) {
  try {
    const o2 = o || {};
    const srcPath = String(o2.srcPath == null ? '' : o2.srcPath).trim();
    if (!srcPath) return { ok: false, error: '缺少源文件路径（请先经 pick-text-file 选择 .md）' };
    if (srcPath.indexOf('\0') >= 0) return { ok: false, error: '非法源文件路径' };
    if (path.extname(srcPath).toLowerCase() !== '.md') return { ok: false, error: '仅支持 .md 文件入库' };
    let st = null;
    try { st = fs.statSync(srcPath); } catch (e) { return { ok: false, error: '源文件不存在或不可读' }; }
    if (!st || !st.isFile()) return { ok: false, error: '源文件不存在或不可读' };
    if (st.size > paths.SPEC_MAX_BYTES) return { ok: false, error: '文件超过200KB，拒绝入库' };
    let buf = null;
    try { buf = fs.readFileSync(srcPath); } catch (e) { return { ok: false, error: '源文件读取失败：' + String((e && e.message) || e) }; }
    if (!buf || buf.length > paths.SPEC_MAX_BYTES) return { ok: false, error: '文件超过200KB，拒绝入库' };
    if (!isUtf8Buffer(buf)) return { ok: false, error: '文件非UTF-8编码，拒绝入库' };
    const content = buf.toString('utf8');
    let name = String(o2.name == null ? '' : o2.name).trim();
    if (!name) { try { name = path.parse(srcPath).name; } catch (e) {} name = String(name || '').trim() || '未命名规范'; }
    if (name.length > 60) return { ok: false, error: '名称过长（≤60字符）' };
    let desc = String(o2.desc == null ? '' : o2.desc).trim();
    if (!desc) desc = firstNonEmptyLine(content);
    const items = ensureSpecsInit();
    const uniqName = ensureUniqueLibName(items, name, null);
    const id = genUniqueLibId(uniqName, items.map((x) => x && x.id), 'spec');
    if (!sanitizeLibId(id)) return { ok: false, error: '生成规范ID失败' };
    const target = specTargetFor(id);
    if (!target) return { ok: false, error: '非法规范ID' };
    try { fs.writeFileSync(target, content, 'utf8'); } catch (e) { return { ok: false, error: '写入规范失败：' + String((e && e.message) || e) }; }
    const item = { id: id, name: uniqName, desc: desc, file: id + '.md', updatedAt: Date.now() };
    items.push(item);
    writeSpecsIndex(items);
    return { ok: true, item: item };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function specCreateFromTextImpl(ev, o) {
  try {
    const o2 = o || {};
    const name = String(o2.name == null ? '' : o2.name).trim();
    if (!name) return { ok: false, error: '名称不能为空' };
    if (name.length > 60) return { ok: false, error: '名称过长（≤60字符）' };
    const content = String(o2.content == null ? '' : o2.content);
    if (!content.trim()) return { ok: false, error: '内容不能为空' };
    if (Buffer.byteLength(content, 'utf8') > paths.SPEC_MAX_BYTES) return { ok: false, error: '内容超过200KB，拒绝入库' };
    let desc = String(o2.desc == null ? '' : o2.desc).trim();
    if (!desc) desc = firstNonEmptyLine(content);
    const items = ensureSpecsInit();
    const uniqName = ensureUniqueLibName(items, name, null);
    const id = genUniqueLibId(uniqName, items.map((x) => x && x.id), 'spec');
    if (!sanitizeLibId(id)) return { ok: false, error: '生成规范ID失败' };
    const target = specTargetFor(id);
    if (!target) return { ok: false, error: '非法规范ID' };
    try { fs.writeFileSync(target, content, 'utf8'); } catch (e) { return { ok: false, error: '写入规范失败：' + String((e && e.message) || e) }; }
    const item = { id: id, name: uniqName, desc: desc, file: id + '.md', updatedAt: Date.now() };
    items.push(item);
    writeSpecsIndex(items);
    return { ok: true, item: item };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function specUpdateImpl(ev, o) {
  try {
    const o2 = o || {};
    const id = sanitizeLibId(o2.id);
    if (!id) return { ok: false, error: '非法规范ID' };
    const items = ensureSpecsInit();
    let idx = -1;
    for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { idx = i; break; } }
    if (idx < 0) return { ok: false, error: '规范不存在' };
    const it = items[idx] || {};
    if (o2.name !== undefined) {
      const nn = String(o2.name == null ? '' : o2.name).trim();
      if (!nn) return { ok: false, error: '名称不能为空' };
      if (nn.length > 60) return { ok: false, error: '名称过长（≤60字符）' };
      it.name = ensureUniqueLibName(items, nn, id);
    }
    if (o2.desc !== undefined) it.desc = String(o2.desc == null ? '' : o2.desc).trim();
    /* UI 规范端别归属（设置页移动/PC分开展示用；仅 mobile/pc 合法） */
    if (o2.kind !== undefined) {
      const kk = String(o2.kind == null ? '' : o2.kind).trim().toLowerCase();
      if (kk !== 'mobile' && kk !== 'pc') return { ok: false, error: '端别仅支持 mobile/pc' };
      it.kind = kk;
    }
    if (o2.content !== undefined) {
      const nc = String(o2.content == null ? '' : o2.content);
      if (!nc.trim()) return { ok: false, error: '内容不能为空' };
      if (Buffer.byteLength(nc, 'utf8') > paths.SPEC_MAX_BYTES) return { ok: false, error: '内容超过200KB，拒绝保存' };
      const target = specTargetFor(id);
      if (!target) return { ok: false, error: '非法规范ID' };
      try { fs.writeFileSync(target, nc, 'utf8'); } catch (e) { return { ok: false, error: '写入规范失败：' + String((e && e.message) || e) }; }
      if (!it.desc) it.desc = firstNonEmptyLine(nc);
    }
    it.file = id + '.md';
    it.updatedAt = Date.now();
    items[idx] = it;
    writeSpecsIndex(items);
    return { ok: true, item: it };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
/* spec:rename — 只改库（index.json），不碰 md 正文 */
function specRenameImpl(ev, o) {
  try {
    const o2 = o || {};
    const id = sanitizeLibId(o2.id);
    const name = String(o2.name == null ? '' : o2.name).trim();
    if (!id) return { ok: false, error: '非法规范ID' };
    if (!name) return { ok: false, error: '名称不能为空' };
    if (name.length > 60) return { ok: false, error: '名称过长（≤60字符）' };
    const items = ensureSpecsInit();
    let idx = -1;
    for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { idx = i; break; } }
    if (idx < 0) return { ok: false, error: '规范不存在' };
    items[idx].name = ensureUniqueLibName(items, name, id);
    items[idx].updatedAt = Date.now();
    writeSpecsIndex(items);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
/* spec:remove — 只删库（index + specs/<id>.md），不碰项目快照 */
function specRemoveImpl(ev, o) {
  try {
    const o2 = o || {};
    const id = sanitizeLibId(o2.id);
    if (!id) return { ok: false, error: '非法规范ID' };
    const items = ensureSpecsInit();
    let idx = -1;
    for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { idx = i; break; } }
    if (idx < 0) return { ok: false, error: '规范不存在' };
    const target = specTargetFor(id);
    try { if (target && fs.existsSync(target)) fs.unlinkSync(target); } catch (e) {}
    items.splice(idx, 1);
    writeSpecsIndex(items);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function specReadImpl(ev, o) {
  try {
    const o2 = o || {};
    const id = sanitizeLibId(o2.id);
    if (!id) return { ok: false, error: '非法规范ID' };
    const items = ensureSpecsInit();
    let found = null;
    for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { found = items[i]; break; } }
    if (!found) return { ok: false, error: '规范不存在' };
    const target = specTargetFor(id);
    if (!target) return { ok: false, error: '非法规范ID' };
    if (!fs.existsSync(target)) return { ok: false, error: '规范文件缺失' };
    let content = '';
    try { content = fs.readFileSync(target, 'utf8'); } catch (e) { return { ok: false, error: '规范读取失败：' + String((e && e.message) || e) }; }
    return { ok: true, content: content, item: found };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function uilibListImpl() {
  try {
    const items = ensureUilibsInit();
    return { ok: true, items: Array.isArray(items) ? items : [] };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), items: [] }; }

}
function uilibSaveImpl(ev, o) {
  try {
    const o2 = o || {};
    const name = String(o2.name == null ? '' : o2.name).trim();
    if (!name) return { ok: false, error: '名称不能为空' };
    if (name.length > 60) return { ok: false, error: '名称过长（≤60字符）' };
    const cssR = normalizeUrlArray(o2.css);
    if (!cssR.ok) return { ok: false, error: cssR.error };
    const jsR = normalizeUrlArray(o2.js);
    if (!jsR.ok) return { ok: false, error: jsR.error };
    const version = String(o2.version == null ? '' : o2.version).trim().slice(0, 40);
    const deps = String(o2.deps == null ? '' : o2.deps).trim().slice(0, 500);
    const initScript = String(o2.initScript == null ? '' : o2.initScript);
    if (Buffer.byteLength(initScript, 'utf8') > 50 * 1024) return { ok: false, error: 'initScript 过大（≤50KB）' };
    const snippet = String(o2.snippet == null ? '' : o2.snippet);
    if (Buffer.byteLength(snippet, 'utf8') > 50 * 1024) return { ok: false, error: 'snippet 过大（≤50KB）' };
    const items = ensureUilibsInit();
    const rawId = (o2.id == null || String(o2.id).trim() === '') ? '' : String(o2.id).trim();
    if (rawId) {
      const id = sanitizeLibId(rawId);
      if (!id) return { ok: false, error: '非法组件ID' };
      let idx = -1;
      for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { idx = i; break; } }
      if (idx < 0) return { ok: false, error: '组件库不存在' };
      const it = items[idx] || {};
      it.name = ensureUniqueLibName(items, name, id);
      it.version = version;
      it.css = cssR.list;
      it.js = jsR.list;
      it.deps = deps;
      it.initScript = initScript;
      it.snippet = snippet;
      it.updatedAt = Date.now();
      items[idx] = it;
      writeUilibsIndex(items);
      return { ok: true, item: it };
    }
    const uniqName = ensureUniqueLibName(items, name, null);
    const id = genUniqueLibId(uniqName, items.map((x) => x && x.id), 'uilib');
    if (!sanitizeLibId(id)) return { ok: false, error: '生成组件ID失败' };
    const item = { id: id, name: uniqName, version: version, css: cssR.list, js: jsR.list, deps: deps, initScript: initScript, snippet: snippet, updatedAt: Date.now() };
    items.push(item);
    writeUilibsIndex(items);
    return { ok: true, item: item };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function uilibRemoveImpl(ev, o) {
  try {
    const o2 = o || {};
    const id = sanitizeLibId(o2.id);
    if (!id) return { ok: false, error: '非法组件ID' };
    const items = ensureUilibsInit();
    let idx = -1;
    for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { idx = i; break; } }
    if (idx < 0) return { ok: false, error: '组件库不存在' };
    items.splice(idx, 1);
    writeUilibsIndex(items);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function projectGetBindingImpl(ev, o) {
  try {
    const raw = (typeof o === 'string') ? o : ((o && o.project) || '');
    const project = sanitizeProjectName(raw);
    if (!project) return { ok: false, error: '非法项目名' };
    const projDir = path.join(paths.SANDBOX_ROOT, project);
    if (!isSubPath(projDir, paths.SANDBOX_ROOT)) return { ok: false, error: '项目不在沙箱范围内' };
    if (!fs.existsSync(projDir)) return { ok: true, binding: emptyProjectBinding() };
    const binding = readProjectBindingFile(projDir);
    return { ok: true, binding: binding };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
function projectSetBindingImpl(ev, o) {
  try {
    const o2 = o || {};
    const raw = (typeof o2 === 'string') ? o2 : (o2.project || '');
    const project = sanitizeProjectName(raw);
    if (!project) return { ok: false, error: '非法项目名' };
    const projDir = path.join(paths.SANDBOX_ROOT, project);
    if (!isSubPath(projDir, paths.SANDBOX_ROOT)) return { ok: false, error: '项目不在沙箱范围内' };
    try { if (!fs.existsSync(projDir)) fs.mkdirSync(projDir, { recursive: true }); } catch (e) { return { ok: false, error: '创建项目目录失败' }; }
    const projNorm = path.normalize(projDir);
    const rootNorm = path.normalize(paths.SANDBOX_ROOT);
    if (projNorm === rootNorm) return { ok: false, error: '不可绑定沙箱根目录' };
    let binding = readProjectBindingFile(projDir);
    const hasSpec = Object.prototype.hasOwnProperty.call(o2, 'specId');
    const hasUi = Object.prototype.hasOwnProperty.call(o2, 'uiLibId');
    if (hasSpec) {
      const v = (o2.specId == null) ? '' : String(o2.specId).trim();
      if (!v) {
        binding.specId = '';
        binding.specName = '';
        try {
          const dst = path.normalize(path.join(projDir, 'design-spec.md'));
          if (dst !== projNorm && dst.indexOf(projNorm + path.sep) === 0 && isSubPath(dst, paths.SANDBOX_ROOT) && fs.existsSync(dst)) fs.unlinkSync(dst);
        } catch (e) {}
      } else {
        const sid = sanitizeLibId(v);
        if (!sid) return { ok: false, error: '非法规范ID' };
        const items = ensureSpecsInit();
        let found = null;
        for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === sid) { found = items[i]; break; } }
        if (!found) return { ok: false, error: '规范不存在' };
        const src = specTargetFor(sid);
        if (!src || !fs.existsSync(src)) return { ok: false, error: '规范文件缺失' };
        const dst = path.normalize(path.join(projDir, 'design-spec.md'));
        if (dst === projNorm || dst.indexOf(projNorm + path.sep) !== 0) return { ok: false, error: '非法快照路径' };
        if (!isSubPath(dst, paths.SANDBOX_ROOT)) return { ok: false, error: '项目不在沙箱范围内' };
        try { fs.copyFileSync(src, dst); } catch (e) { return { ok: false, error: '拷贝规范快照失败：' + String((e && e.message) || e) }; }
        binding.specId = found.id;
        binding.specName = found.name;
      }
    }
    if (hasUi) {
      const v = (o2.uiLibId == null) ? '' : String(o2.uiLibId).trim();
      if (!v) {
        binding.uiLibId = '';
        binding.uiLibName = '';
      } else {
        const uid = sanitizeLibId(v);
        if (!uid) return { ok: false, error: '非法组件ID' };
        const items = ensureUilibsInit();
        let found = null;
        for (let i = 0; i < items.length; i++) { if (items[i] && items[i].id === uid) { found = items[i]; break; } }
        if (!found) return { ok: false, error: '组件库不存在' };
        binding.uiLibId = found.id;
        binding.uiLibName = found.name;
      }
    }
    binding.updatedAt = Date.now();
    const bf = path.normalize(path.join(projDir, 'project.json'));
    if (bf === projNorm || bf.indexOf(projNorm + path.sep) !== 0) return { ok: false, error: '非法绑定路径' };
    if (!isSubPath(bf, paths.SANDBOX_ROOT)) return { ok: false, error: '项目不在沙箱范围内' };
    try {
      const tmp = bf + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(binding, null, 2), 'utf8');
      fs.renameSync(tmp, bf);
    } catch (e) { return { ok: false, error: '写入绑定失败：' + String((e && e.message) || e) }; }
    return { ok: true, binding: binding };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

}
async function pickTextFileImpl(event, opts) {
  const win = BrowserWindow.getFocusedWindow();
  const o = opts || {};
  const multi = !!(o.multi || o.multiple);
  const r = await dialog.showOpenDialog(win, {
    defaultPath: paths.pkgDir,
    title: o.title || '选择文件',
    filters: o.filters || [{ name: 'HTML 原型', extensions: ['html', 'htm'] }],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  if (!multi) {
    const p = r.filePaths[0];
    const name = path.basename(p);
    try {
      return { path: p, name, content: fs.readFileSync(p, 'utf8') };
    } catch (err) {
      return { path: p, name, content: null, error: String(err && err.message || err) };
    }
  }
  const files = [];
  for (const p of r.filePaths) {
    const name = path.basename(p);
    try {
      const st = fs.statSync(p);
      if (st && st.size > 8 * 1024 * 1024) { files.push({ path: p, name, content: null, error: '文件超过 8MB，已跳过读取' }); continue; }
      files.push({ path: p, name, content: fs.readFileSync(p, 'utf8') });
    } catch (err) {
      files.push({ path: p, name, content: null, error: String(err && err.message || err) });
    }
  }
  return { files };

}
function docListImpl(ev, o) {
  let dir = '';
  if (typeof o === 'string') dir = o;
  else if (o && typeof o === 'object') dir = String(o.dir != null ? o.dir : '');
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    let entries = null;
    try { entries = fs.readdirSync(dn, { withFileTypes: true }); } catch (e) { return { ok: false, error: '读取目录失败' }; }
    const docs = [];
    const dnNorm = path.normalize(dn);
    for (const ent of (entries || [])) {
      try {
        if (!ent || !ent.isFile()) continue;
        const name = String(ent.name || '');
        if (!name) continue;
        if (name.charAt(0) === '.' || name.charAt(0) === '~' || name.charAt(0) === '$') continue;
        if (name.slice(-1) === '~' || /\.tmp$/i.test(name)) continue;
        if (!/\.md$/i.test(name)) continue;
        const full = path.normalize(path.join(dn, name));
        if (full !== path.normalize(path.join(dnNorm, name))) continue;
        if (full !== dnNorm && !full.startsWith(dnNorm + path.sep)) continue;
        if (!isSubPath(full, paths.SANDBOX_ROOT)) continue;
        let st = null;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st || !st.isFile()) continue;
        docs.push({ file: name, size: st.size, mtimeMs: st.mtimeMs });
      } catch (e) {}
    }
    docs.sort((x, y) => y.mtimeMs - x.mtimeMs);
    return { ok: true, docs: docs.slice(0, 20) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

}
function docReadLatestImpl(ev, a, b) {
  const parsed = parseDocReadArgs(a, b);
  const fileRaw = parsed.file;
  if (fileRaw != null && String(fileRaw) !== '') {
    const clean = sanitizeDocFile(fileRaw);
    if (!clean) return { ok: false, error: '非法文件名' };
    try {
      const dirNorm = path.normalize(String(parsed.dir || ''));
      if (!isSubPath(dirNorm, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
      const target = path.normalize(path.join(dirNorm, clean));
      if (target === dirNorm || (!target.startsWith(dirNorm + path.sep))) return { ok: false, error: '目录不在沙箱范围内' };
      if (!isSubPath(target, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
      try {
        if (!fs.existsSync(target)) return { ok: false, error: '文件不存在' };
        return { ok: true, content: fs.readFileSync(target, 'utf8') };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  const f = reqFileFor(parsed.dir);
  try {
    if (!fs.existsSync(f)) return { ok: true, content: '# 最新需求\n\n（在此编写当前迭代的需求。）\n' };
    return { ok: true, content: fs.readFileSync(f, 'utf8') };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

}
function docWriteLatestImpl(ev, a, b, c) {
  const parsed = parseDocWriteArgs(a, b, c);
  const fileRaw = parsed.file;
  if (fileRaw != null && String(fileRaw) !== '') {
    const clean = sanitizeDocFile(fileRaw);
    if (!clean) return { ok: false, error: '非法文件名' };
    try {
      const dirNorm = path.normalize(String(parsed.dir || ''));
      if (!isSubPath(dirNorm, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
      const target = path.normalize(path.join(dirNorm, clean));
      if (target === dirNorm || (!target.startsWith(dirNorm + path.sep))) return { ok: false, error: '目录不在沙箱范围内' };
      if (!isSubPath(target, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
      try {
        fs.writeFileSync(target, String(parsed.content == null ? '' : parsed.content), 'utf8');
        return { ok: true, path: target };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  const f = reqFileFor(parsed.dir);
  try {
    fs.writeFileSync(f, String(parsed.content == null ? '' : parsed.content), 'utf8');
    return { ok: true, path: f };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

}
function snapshotListImpl(ev, dir) {
  const dn = validProtoDir(dir);
  if (!dn) return { ok: true, items: [] };
  const root = snapRootFor(dn);
  if (!root) return { ok: true, items: [] };
  /* 只展示正式任务快照（数字时间戳）；undo- 前缀为恢复前状态备份，不在列表展示但参与保留数清理 */
  const items = listSnapshotDirs(root)
    .filter((x) => /^\d{8}-\d{6}$/.test(x.name))
    .map((x) => ({ ts: x.name }))
    .reverse();
  return { ok: true, items };

}
function snapshotRestoreImpl(ev, o) {
  const o2 = o || {};
  if (typeof shared.activeExecution!=='undefined' && shared.activeExecution) {
    return { ok: false, error: 'AI 正在生成中，请先停止再恢复历史版本' };
  }
  const dn = validProtoDir(o2.dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  const ts = String(o2.ts || '');
  if (!/^\d{8}-\d{6}$/.test(ts)) return { ok: false, error: '非法快照标识' };
  const root = snapRootFor(dn);
  if (!root) return { ok: false, error: '目录不在沙箱范围内' };
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

}
function linksReadImpl(ev, dir) {
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    const f = path.join(dn, 'links.json');
    if (!fs.existsSync(f)) return { ok: true, data: null };
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ok: true, data: (data && Array.isArray(data.links)) ? { version: 1, links: data.links } : { version: 1, links: [] } };
  } catch (e) { return { ok: true, data: { version: 1, links: [] } }; } /* 损坏文件视为空绑定，不阻断使用 */

}
function linksWriteImpl(ev, dir, data) {
  const dn = validProtoDir(dir);
  if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
  try {
    const links = Array.isArray(data && data.links) ? data.links : [];
    const clean = links.map((l) => { const c = Object.assign({}, l); delete c._stale; return c; });
    fs.writeFileSync(path.join(dn, 'links.json'), JSON.stringify({ version: 1, links: clean }, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

}
async function sandboxSaveAssetImpl(ev, o) {
  try {
    const o2 = o || {};
    const dn = validProtoDir(o2.dir);
    if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
    let ext = String(o2.ext == null ? '' : o2.ext).trim().toLowerCase().replace(/^\./, '');
    try {
      if (!ext) {
        const m = String(o2.name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
        if (m) ext = m[1];
      }
    } catch (e) {}
    if (!PROTO_ASSET_EXT_MIME['.' + ext]) ext = 'png';
    let base = String(o2.name == null ? '' : o2.name).trim().replace(/\.[A-Za-z0-9]+$/, '');
    try { base = String(base || '').replace(/\\/g, '/').split('/').pop(); } catch (e) {}
    base = String(base || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    if (!base) base = 'img_' + fmtAssetTs(new Date());
    const assetsDir = path.join(dn, 'assets');
    try { if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true }); } catch (e) { return { ok: false, error: '创建 assets 目录失败' }; }
    let fileName = base + '.' + ext;
    try {
      let i = 1;
      while (fs.existsSync(path.join(assetsDir, fileName)) && i < 1000) { fileName = base + '_' + i + '.' + ext; i++; }
      if (fs.existsSync(path.join(assetsDir, fileName))) fileName = base + '_' + fmtAssetTs(new Date()) + '.' + ext;
    } catch (e) {}
    const target = path.normalize(path.join(assetsDir, fileName));
    if (!isSubPath(target, paths.SANDBOX_ROOT) || !target.startsWith(path.normalize(assetsDir) + path.sep)) return { ok: false, error: '非法文件名' };
    let b64 = String(o2.dataUrl == null ? '' : o2.dataUrl);
    if (!b64) return { ok: false, error: '缺少图片数据' };
    const comma = b64.indexOf(',');
    if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);
    b64 = b64.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=_-]+$/.test(b64)) return { ok: false, error: '图片数据格式错误' };
    if (b64.length > 20 * 1024 * 1024) return { ok: false, error: '图片过大（超过20MB）' };
    let buf = null;
    try { buf = Buffer.from(b64, 'base64'); } catch (e) { return { ok: false, error: '图片数据解码失败' }; }
    if (!buf || !buf.length) return { ok: false, error: '图片数据为空' };
    fs.writeFileSync(target, buf);
    return { ok: true, relPath: 'assets/' + fileName };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e || '保存失败') };
  }

}
async function sandboxReadAssetBase64Impl(ev, o) {
  try {
    const o2 = o || {};
    const dn = validProtoDir(o2.dir);
    if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
    let rel = String(o2.relPath == null ? '' : o2.relPath).replace(/\\/g, '/').trim();
    if (!rel) return { ok: false, error: '缺少图片路径' };
    if (rel.includes('\0')) return { ok: false, error: '非法图片路径' };
    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.includes('..')) return { ok: false, error: '非法图片路径' };
    rel = rel.replace(/^\/+/, '').replace(/^\.\//, '');
    const assetsNorm = path.normalize(path.join(dn, 'assets'));
    const target = path.normalize(path.join(dn, rel));
    if (target !== assetsNorm && !target.startsWith(assetsNorm + path.sep)) return { ok: false, error: '仅允许读取 assets 内图片' };
    if (!isSubPath(target, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
    const ext = path.extname(target).toLowerCase();
    const mime = PROTO_ASSET_EXT_MIME[ext];
    if (!mime) return { ok: false, error: '不支持的图片格式' };
    let st = null;
    try { st = fs.statSync(target); } catch (e) { return { ok: false, error: '图片不存在' }; }
    if (!st || !st.isFile()) return { ok: false, error: '图片不存在' };
    const buf = fs.readFileSync(target);
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e || '读取失败') };
  }

}
async function sandboxListAssetsImpl(ev, o) {
  try {
    const o2 = o || {};
    const dn = validProtoDir(o2.dir);
    if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
    const assetsDir = path.join(dn, 'assets');
    try {
      if (!fs.existsSync(assetsDir)) return { ok: true, items: [] };
    } catch (e) { return { ok: true, items: [] }; }
    let entries = null;
    try { entries = fs.readdirSync(assetsDir, { withFileTypes: true }); } catch (e) { return { ok: false, error: '读取 assets 目录失败' }; }
    const items = [];
    for (const ent of (entries || [])) {
      try {
        if (!ent || !ent.isFile()) continue;
        const name = String(ent.name || '');
        if (!name || name.includes('\0')) continue;
        const ext = path.extname(name).toLowerCase();
        if (!PROTO_ASSET_EXT_MIME[ext]) continue;
        const full = path.normalize(path.join(assetsDir, name));
        if (!full.startsWith(path.normalize(assetsDir) + path.sep)) continue;
        if (!isSubPath(full, paths.SANDBOX_ROOT)) continue;
        let st = null;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st || !st.isFile()) continue;
        items.push({ name: name, relPath: 'assets/' + name, size: st.size, mtimeMs: st.mtimeMs });
      } catch (e) {}
    }
    items.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { ok: true, items: items };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e || '获取失败') };
  }

}
async function sandboxDeleteAssetImpl(ev, o) {
  try {
    const o2 = o || {};
    const dn = validProtoDir(o2.dir);
    if (!dn) return { ok: false, error: '目录不在沙箱范围内' };
    const name = String(o2.name == null ? '' : o2.name).trim();
    if (!name) return { ok: false, error: '缺少文件名' };
    if (name.includes('\0')) return { ok: false, error: '非法文件名' };
    if (name.includes('/') || name.includes('\\')) return { ok: false, error: '非法文件名' };
    if (/^[a-zA-Z]:/.test(name) || name.includes('..')) return { ok: false, error: '非法文件名' };
    if (name === '.' || name === '..') return { ok: false, error: '非法文件名' };
    if (!/^[a-zA-Z0-9_.\-]+$/.test(name)) return { ok: false, error: '非法文件名' };
    const assetsDir = path.join(dn, 'assets');
    const assetsNorm = path.normalize(assetsDir);
    const target = path.normalize(path.join(assetsDir, name));
    if (target === assetsNorm || !target.startsWith(assetsNorm + path.sep)) return { ok: false, error: '非法文件名' };
    if (!isSubPath(target, paths.SANDBOX_ROOT)) return { ok: false, error: '目录不在沙箱范围内' };
    let st = null;
    try { st = fs.statSync(target); } catch (e) { return { ok: false, error: '文件不存在' }; }
    if (!st || !st.isFile()) return { ok: false, error: '仅允许删除文件' };
    try { fs.unlinkSync(target); } catch (e) { return { ok: false, error: String((e && e.message) || e || '删除失败') }; }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e || '删除失败') };
  }

}
module.exports = {
  ensureSandbox,
  isFlatDir,
  normalizeProjects,
  migrateLegacySandbox,
  libStatusSafe,
  logsDir,
  cleanOldLogs,
  sandboxProjects,
  protoFolders,
  sanitizeProjectName,
  pickInDir,
  sanitizeProtoName,
  extractJsonArray,
  extractExportedProtos,
  sanitizeLibId,
  slugifyLibName,
  specTsNow,
  genUniqueLibId,
  ensureUniqueLibName,
  readJsonArrayFile,
  specPresetDefs,
  uilibPresetDefs,
  ensureSpecsInit,
  ensureUilibsInit,
  resolveSeedFile,
  readSeedContent,
  getRemovedBuiltinIds,
  readUiSpecForKind,
  writeSpecsIndex,
  writeUilibsIndex,
  specTargetFor,
  isUtf8Buffer,
  firstNonEmptyLine,
  normalizeUrlArray,
  emptyProjectBinding,
  readProjectBindingFile,
  reqFileFor,
  sanitizeDocFile,
  parseDocReadArgs,
  parseDocWriteArgs,
  fmtTs,
  validProtoDir,
  snapRootFor,
  listSnapshotDirs,
  pruneSnapshots,
  takeSnapshot,
  getProtoFileSignature,
  diffFileSignatures,
  diffSandboxRootAgainst,
  SANDBOX_GUARD_MAX_FILES_PER_DIR,
  stageSkillsToContext,
  SKILL_KEYWORDS_MAP,
  snapshotProtoFileContents,
  diffFileContents,
  diffTextLines,
  countTextLines,
  isDiffableTextFile,
  handleAnnoRead,
  handleAnnoSave,
  isSubPath,
  decodeURIComponentSafe,
  isSafeGitRel,
  isValidBranch,
  PROTO_ASSET_EXT_MIME,
  fmtAssetTs,
  handleProtoAsset,
  logWriteImpl,
  appGetVersionImpl,
  sandboxListImpl,
  sandboxWriteImpl,
  sandboxReadFileImpl,
  sandboxCreateSubpageImpl,
  sandboxDeleteSubpageImpl,
  sandboxRenameSubpageImpl,
  sandboxCreateImpl,
  sandboxAdoptImpl,
  sandboxRenameImpl,
  sandboxRemoveImpl,
  sandboxProjectsImpl,
  projectCreateImpl,
  projectRenameImpl,
  projectRemoveImpl,
  specListImpl,
  specCreateFromFileImpl,
  specCreateFromTextImpl,
  specUpdateImpl,
  specRenameImpl,
  specRemoveImpl,
  specReadImpl,
  uilibListImpl,
  uilibSaveImpl,
  uilibRemoveImpl,
  projectGetBindingImpl,
  projectSetBindingImpl,
  pickTextFileImpl,
  docListImpl,
  docReadLatestImpl,
  docWriteLatestImpl,
  snapshotListImpl,
  snapshotRestoreImpl,
  linksReadImpl,
  linksWriteImpl,
  sandboxSaveAssetImpl,
  sandboxReadAssetBase64Impl,
  sandboxListAssetsImpl,
  sandboxDeleteAssetImpl,
};
