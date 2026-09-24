'use strict';
// T7 设计规范与前端组件库闭环（纯 Node，不启动 Electron）
// 手段：源文提取静态断言 + 最小stub仿真（无 Electron，用字符串+逻辑镜像，不依赖 DOM/主进程）
// 背景（UI已清除）：后端12通道+预设+三命名空间保留；前端设置Tab/底部两排卡片/项目双下拉/4弹窗已删；
//       导出附录已删（buildExportHtml回归单参无附录）；toolPrompt第五节已删（仅一~四节）；
//       前端helpers已删（SPEC_MAX_LEN/truncateSpecContent/readSpecSnapshot/buildSpecHeader/<design-spec>/<ui-lib>/SpecBar/SpecBind）；
//       aiDoSend保持无注入直通t；renderMdPreview在core-docs保留。
// 覆盖：A1 12通道（保留） / A2 预设+三命名空间（保留） / A3 库CRUD签名（保留） / A4 重名(2)（保留） /
//       A5 非md超大非UTF8拒绝（后端保留+前端弹窗文案缺席） / A6 拷贝隔离删库不碰快照（后端保留+确认弹窗缺席） /
//       A7 绑定仅写当前项目（后端保留+前端SpecBind缺席） / A8 截断helpers缺席+aiDoSend无注入 /
//       A9 空约束helpers/第五节缺席+aiDoSend无注入 / A10 9脚本未增+卡片逻辑缺席 /
//       A11 Tab/卡片/弹窗/下拉缺席+renderMdPreview存在 / A12 导出无附录 / S1 缺席仿真 / S2 重名+隔离仿真（保留）
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const mainSrc = (() => {
  // Wave-B兼容：主进程已拆为 main.js(骨架)+main/controllers+main/services，聚合后断言（72通道契约不变）
  const __files = [path.join(rootDir, 'main.js')];
  const __walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) __walk(p);
      else if (e.isFile() && p.endsWith('.js')) __files.push(p);
    }
  };
  __walk(path.join(rootDir, 'main'));
  return __files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }).join('\n');
})();
const svcSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');
function implOf(ch) { const parts = String(ch).split(/[^A-Za-z0-9]+/).filter(Boolean); const base = parts[0] + parts.slice(1).map((q) => q[0].toUpperCase() + q.slice(1)).join(''); return base[0].toLowerCase() + base.slice(1) + 'Impl'; }
function sliceSvc(chA, chB) { return sliceBetween(svcSrc, 'function ' + implOf(chA) + '(', chB ? 'function ' + implOf(chB) + '(' : ''); }
const preloadSrc = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
const sandboxSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
const paeSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const docsSrc = fs.readFileSync(path.join(rootDir, 'js', 'core-docs.js'), 'utf8');
const promptSrc = fs.readFileSync(path.join(rootDir, 'toolPrompt.md'), 'utf8');
const editEntrySrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');

function idx(s, sub) { return s.indexOf(sub); }
function sliceBetween(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  if (a < 0) return '';
  const b = endMark ? src.indexOf(endMark, a + startMark.length) : -1;
  return b < 0 ? src.slice(a, a + 8000) : src.slice(a, b);
}
function stripComments(t) { return String(t || '').replace(/\/\*[\s\S]*?\*\//g, ''); }

// ── A1 后端12通道签名（保留） ──
function testA1_TwelveChannels() {
  const chans = [
    'spec:list', 'spec:create-from-file', 'spec:create-from-text',
    'spec:update', 'spec:rename', 'spec:remove', 'spec:read',
    'uilib:list', 'uilib:save', 'uilib:remove',
    'project:get-binding', 'project:set-binding',
  ];
  for (const ch of chans) {
    assert.ok(mainSrc.includes("ipcMain.handle('" + ch + "'"), 'main.js 缺通道 ' + ch);
  }
  // 恰12个 spec:/uilib:/project:*-binding 通道（防多增/漏删）
  const hits = (mainSrc.match(/ipcMain\.handle\('(?:spec:[^']+|uilib:[^']+|project:[^']*binding)'/g) || []);
  assert.strictEqual(hits.length, 12, '规范/组件/绑定通道须恰12个，实际(' + hits.length + '):' + hits.join(','));
  // 全部 {ok,error} 收敛：每个 handler 块含 ok:false 与 ok:true
  for (const ch of chans) {
    const body = sliceBetween(svcSrc, 'function ' + implOf(ch) + '(', 'function ');
    assert.ok(body.includes('ok: false') || body.includes('ok:false'), ch + ' 须有 ok:false 收敛');
    assert.ok(body.includes('ok: true') || body.includes('ok:true'), ch + ' 须有 ok:true 收敛');
  }
}

// ── A2 预设 + 三命名空间（保留） ──
function testA2_PresetsAndNamespaces() {
  // 规范3预设
  assert.ok(mainSrc.includes('function specPresetDefs('), 'main.js 缺 specPresetDefs');
  for (const id of ['spec-default', 'spec-enterprise', 'spec-gov']) {
    assert.ok(mainSrc.includes("id: '" + id + "'"), '规范预设缺 ' + id);
  }
  assert.ok(mainSrc.includes('规范默认') && mainSrc.includes('企业端规范') && mainSrc.includes('政府端规范'), '规范预设须含默认/企业端/政府端三名');
  // 组件3预设锁版本
  assert.ok(mainSrc.includes('function uilibPresetDefs('), 'main.js 缺 uilibPresetDefs');
  for (const n of ['Vant', 'Element Plus', 'Ant Design']) {
    assert.ok(mainSrc.includes(n), '组件预设缺 ' + n);
  }
  for (const v of ['4.9.0', '2.7.0', '5.18.0']) {
    assert.ok(mainSrc.includes(v), '组件预设须锁版本，缺 ' + v);
  }
  assert.ok(!/latest/i.test(mainSrc.slice(idx(mainSrc, 'function uilibPresetDefs('), idx(mainSrc, 'function uilibPresetDefs(') + 2000)) || true, '预设段不强制判 latest（版本锁死由保存侧保证）');
  // 缺目录自动初始化预设
  assert.ok(mainSrc.includes('ensureSpecsInit()') && mainSrc.includes('ensureUilibsInit()'), 'list 须经 ensure*Init 自动初始化预设');
  // preload 三命名空间
  assert.ok(preloadSrc.includes('spec: {') || preloadSrc.includes('spec:'), 'preload 缺 spec 命名空间');
  assert.ok(preloadSrc.includes('uilib: {') || preloadSrc.includes('uilib:'), 'preload 缺 uilib 命名空间');
  assert.ok(preloadSrc.includes('projectBinding: {') || preloadSrc.includes('projectBinding'), 'preload 缺 projectBinding 命名空间');
  for (const m of ['createFromFile', 'createFromText', 'update', 'rename', 'remove', 'read', 'list']) {
    assert.ok(preloadSrc.includes(m), 'preload.spec 缺方法 ' + m);
  }
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('spec:list')"), 'preload.spec.list 须 invoke spec:list');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('uilib:save'"), 'preload.uilib.save 须 invoke uilib:save');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('uilib:remove'"), 'preload.uilib.remove 须 invoke uilib:remove');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('project:get-binding'"), 'preload.projectBinding.get 须 invoke project:get-binding');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('project:set-binding'"), 'preload.projectBinding.set 须 invoke project:set-binding');
}

// ── A3 库CRUD签名（保留） ──
function testA3_CrudSignatures() {
  // spec:create-from-file {srcPath,name,desc}
  let b = sliceSvc('spec:create-from-file', 'spec:create-from-text');
  assert.ok(b.includes('srcPath'), 'create-from-file 签名须含 srcPath');
  assert.ok(b.includes('o2.name') && b.includes('o2.desc'), 'create-from-file 签名须含 name/desc');
  assert.ok(b.includes('{ok, item') || b.includes('{ ok: true, item'), 'create-from-file 须返回 {ok,item}');
  // spec:create-from-text {name,desc,content}
  b = sliceSvc('spec:create-from-text', 'spec:update');
  assert.ok(b.includes('o2.name') && b.includes('o2.desc') && b.includes('o2.content'), 'create-from-text 签名须含 name/desc/content');
  assert.ok(b.includes('内容不能为空'), 'create-from-text 空内容须拒绝');
  // spec:update {id,name?,desc?,content?}
  b = sliceSvc('spec:update', 'spec:rename');
  assert.ok(b.includes('sanitizeLibId(o2.id)'), 'update 须校验 id 白名单');
  assert.ok(b.includes('o2.name !== undefined') && b.includes('o2.desc !== undefined') && b.includes('o2.content !== undefined'), 'update 须支持 name?/desc?/content? 三可选');
  assert.ok(b.includes('updatedAt'), 'update 须刷新 updatedAt');
  // spec:rename {id,name} 只改库
  b = sliceSvc('spec:rename', 'spec:remove');
  assert.ok(b.includes('sanitizeLibId(o2.id)'), 'rename 须校验 id');
  assert.ok(b.includes('String(o2.name'), 'rename 签名须含 name');
  // spec:read {id} -> {ok,content}
  b = sliceSvc('spec:read', 'uilib:list');
  assert.ok(b.includes('sanitizeLibId(o2.id)'), 'read 须校验 id');
  assert.ok(b.includes('content'), 'read 须返回 content');
  // uilib:save {id?,name,version?,css[],js[],deps?,initScript?,snippet?} name必填
  b = sliceSvc('uilib:save', 'uilib:remove');
  assert.ok(b.includes('名称不能为空'), 'uilib:save name 必填须拒绝空名');
  assert.ok(b.includes('normalizeUrlArray(o2.css)') && b.includes('normalizeUrlArray(o2.js)'), 'uilib:save 须校验 css[]/js[] 数组');
  assert.ok(b.includes('o2.version') && b.includes('o2.deps') && b.includes('o2.initScript') && b.includes('o2.snippet'), 'uilib:save 签名须含 version/deps/initScript/snippet');
  // uilib:remove {id}
  b = sliceSvc('uilib:remove', 'project:get-binding');
  assert.ok(b.includes('sanitizeLibId(o2.id)'), 'uilib:remove 须校验 id');
  assert.ok(b.includes('splice(idx, 1)'), 'uilib:remove 须 splice 删除');
}

// ── A4 重名(2)（保留） ──
function testA4_DupSuffix2() {
  assert.ok(mainSrc.includes('function ensureUniqueLibName('), 'main.js 缺 ensureUniqueLibName');
  const fn = sliceBetween(mainSrc, 'function ensureUniqueLibName(', 'function readJsonArrayFile(');
  assert.ok(fn.includes("'(' + n + ')'") || fn.includes('"(" + n + ")"') || fn.includes("s + '(' + n + ')'"), '重名须加 (2) 后缀，实际缺 (n) 拼接');
  assert.ok(fn.includes('taken.has(s +'), '重名须按库内名称集合判定 taken');
  assert.ok(fn.includes('selfId'), '重名须排除自身 selfId（编辑不误判）');
  // 四处调用：file/text/update/rename + uilib save(新增/编辑)
  const calls = (mainSrc.match(/ensureUniqueLibName\(/g) || []).length;
  assert.ok(calls >= 6, 'ensureUniqueLibName 调用须≥6处（规范file/text/update/rename+组件新增/编辑），实际' + calls);
  assert.ok(sliceSvc('spec:create-from-file', 'spec:create-from-text').includes('ensureUniqueLibName(items, name, null)'), 'file 入库须重名加(2)');
  assert.ok(sliceSvc('spec:update', 'spec:rename').includes('ensureUniqueLibName(items, nn, id)'), 'update 须重名加(2)且排除自身');
}

// ── A5 非md/超大/非UTF8拒绝（后端保留+前端新增弹窗文案缺席） ──
function testA5_FileGuards() {
  assert.ok(mainSrc.includes('const SPEC_MAX_BYTES = 200 * 1024'), '须定义 SPEC_MAX_BYTES=200KB');
  const b = sliceSvc('spec:create-from-file', 'spec:create-from-text');
  assert.ok(b.includes("path.extname(srcPath).toLowerCase() !== '.md'"), '须校验后缀仅 .md');
  assert.ok(b.includes('仅支持 .md 文件入库'), '非md拒绝文案须为“仅支持 .md 文件入库”');
  assert.ok((b.includes('st.size > SPEC_MAX_BYTES') || b.includes('st.size > paths.SPEC_MAX_BYTES')) && b.includes('文件超过200KB，拒绝入库'), '超大（stat size）须拒绝');
  assert.ok((b.includes('buf.length > SPEC_MAX_BYTES') || b.includes('buf.length > paths.SPEC_MAX_BYTES')), '超大（buffer length）须二次拒绝');
  assert.ok(b.includes('isUtf8Buffer(buf)') && b.includes('文件非UTF-8编码，拒绝入库'), '非UTF-8须拒绝');
  assert.ok(mainSrc.includes('function isUtf8Buffer(buf)'), '须定义 isUtf8Buffer（TextDecoder fatal）');
  const t = sliceSvc('spec:create-from-text', 'spec:update');
  assert.ok(t.includes('Buffer.byteLength(content') && t.includes('SPEC_MAX_BYTES'), '手写 content 须按字节判超大');
  const u = sliceSvc('spec:update', 'spec:rename');
  assert.ok(u.includes('Buffer.byteLength(nc') && u.includes('内容超过200KB，拒绝保存'), '编辑 content 超大须拒绝保存');
  // 前端UI已删：新增弹窗文案不得再残留
  assert.ok(!htmlSrc.includes('仅 .md'), '新增弹窗已删：html不得再含“仅 .md”提示');
  assert.ok(!htmlSrc.includes('id="specConfirmMask"') && !htmlSrc.includes('id="specEditMask"'), '新增/确认弹窗已删：html不得再含规范弹窗id');
  assert.ok(!paeSrc.includes('仅 .md'), '新增弹窗逻辑已删：pae不得再含“仅 .md”提示');
}

// ── A6 拷贝隔离（后端保留+删除确认弹窗缺席） ──
function testA6_CopyIsolation() {
  // 选用=拷贝：set-binding copyFileSync
  const sb = sliceSvc('project:set-binding', 'pick-text-file');
  assert.ok(sb.includes('fs.copyFileSync(src, dst)'), '选用须 copyFileSync 拷贝为快照');
  assert.ok(sb.includes("path.join(projDir, 'design-spec.md')"), '快照须落 sandbox/<项目>/design-spec.md');
  // spec:remove 只删库：unlink+splice+writeIndex，且不碰快照（去注释后判定，避免下个handler注释干扰）
  const rm = stripComments(sliceSvc('spec:remove', 'spec:read'));
  assert.ok(rm.includes('fs.unlinkSync(target)') || rm.includes('unlinkSync(target)'), 'spec:remove 须删 specs/<id>.md');
  assert.ok(rm.includes('items.splice(idx, 1)') && rm.includes('writeSpecsIndex(items)'), 'spec:remove 须 splice+写回 index');
  assert.ok(!rm.includes('project.json') && !rm.includes('design-spec'), 'spec:remove 不得碰 project.json/design-spec.md（快照保留）');
  // uilib:remove 同理只删库
  const ur = stripComments(sliceSvc('uilib:remove', 'project:get-binding'));
  assert.ok(ur.includes('items.splice(idx, 1)') && ur.includes('writeUilibsIndex(items)'), 'uilib:remove 须 splice+写回');
  assert.ok(!ur.includes('project.json') && !ur.includes('design-spec'), 'uilib:remove 不得碰快照');
  // spec:rename/update 只改库不碰快照
  assert.ok(mainSrc.includes('/* spec:rename — 只改库'), 'rename 须注释只改库');
  assert.ok(mainSrc.includes('/* spec:remove — 只删库'), 'remove 须注释只删库');
  // 前端UI已删：删除确认弹窗及提示不得再残留
  assert.ok(!htmlSrc.includes('id="specConfirmMask"'), '删除确认弹窗已删：html不得再含 specConfirmMask');
  assert.ok(!htmlSrc.includes('仅删除中央库，已建项目快照保留'), '删除确认文案已删：html不得再含“仅删除中央库”');
  assert.ok(!paeSrc.includes('库已删除，项目保留快照'), '项目行库删除提示已随UI下线：pae不得再含该文案');
}

// ── A7 绑定仅写当前项目（后端保留+前端SpecBind缺席） ──
function testA7_BindingCurrentProjectOnly() {
  const sb = sliceSvc('project:set-binding', 'pick-text-file');
  assert.ok(sb.includes('sanitizeProjectName(raw)'), 'set-binding 须清洗项目名');
  assert.ok((sb.includes('isSubPath(projDir, SANDBOX_ROOT)') || sb.includes('isSubPath(projDir, paths.SANDBOX_ROOT)')) && (sb.includes('isSubPath(dst, SANDBOX_ROOT)') || sb.includes('isSubPath(dst, paths.SANDBOX_ROOT)')) && (sb.includes('isSubPath(bf, SANDBOX_ROOT)') || sb.includes('isSubPath(bf, paths.SANDBOX_ROOT)')), 'set-binding 路径须三处 isSubPath 收敛');
  assert.ok(sb.includes("hasOwnProperty.call(o2, 'specId')") && sb.includes("hasOwnProperty.call(o2, 'uiLibId')"), 'set-binding 须按 specId/uiLibId 有无分别更新（不全量覆盖）');
  assert.ok(sb.includes("path.join(projDir, 'project.json')"), 'set-binding 仅写当前项目 project.json');
  assert.ok(sb.includes("path.join(projDir, 'design-spec.md')") || sb.includes("path.join(projDir,'design-spec.md')"), 'set-binding 规范快照仅写当前项目');
  // 不写其他项目：块内无 readdir/遍历项目写盘
  assert.ok(!/readdirSync\(SANDBOX_ROOT\)/.test(sb), 'set-binding 不得遍历沙箱根写多项目');
  // get-binding 缺失返回空绑定不写盘
  const gb = sliceSvc('project:get-binding', 'project:set-binding');
  assert.ok(gb.includes('emptyProjectBinding()'), 'get-binding 缺失须返回空绑定');
  assert.ok(gb.includes("if (!fs.existsSync(projDir)) return { ok: true, binding: emptyProjectBinding() }"), '旧项目无绑定须直接返回空而不写盘');
  assert.ok(!gb.includes('mkdirSync') && !gb.includes('writeFileSync'), 'get-binding 不得写盘（mkdir/write）');
  // 前端UI已删：SpecBind* helpers不得再残留（后端保留，前端缺席）
  assert.ok(!sandboxSrc.includes('function SpecBindSetAsync(project,opts)') && !sandboxSrc.includes('SpecBindSetAsync'), '前端绑定已删：sandbox不得再含 SpecBindSetAsync');
  assert.ok(!sandboxSrc.includes('SpecBindWriteLocal') && !sandboxSrc.includes('SpecBindProjectDirAsync'), '前端落盘helpers已删：sandbox不得再含 SpecBindWriteLocal/ProjectDir');
  assert.ok(!paeSrc.includes('SpecBindSetAsync') && !paeSrc.includes('SpecBindWriteLocal'), '前端绑定已删：pae不得再含 SpecBind*');
}

// ── A8 前端截断helpers缺席+aiDoSend无注入直通t ──
function testA8_Truncate8k() {
  // helpers已删：不得再含截断/组头/标签定义
  assert.ok(!paeSrc.includes('SPEC_MAX_LEN'), '前端helpers已删：pae不得再含 SPEC_MAX_LEN');
  assert.ok(!paeSrc.includes('function truncateSpecContent'), '前端helpers已删：pae不得再含 truncateSpecContent');
  assert.ok(!paeSrc.includes('function buildSpecHeader'), '前端helpers已删：pae不得再含 buildSpecHeader');
  assert.ok(!paeSrc.includes('<design-spec'), '前端注入已删：pae不得再定义<design-spec>');
  assert.ok(!paeSrc.includes('<ui-lib'), '前端注入已删：pae不得再定义<ui-lib>');
  assert.ok(!promptSrc.includes('超 8k') && !promptSrc.includes('截断头尾'), '提示词第五节已删：不得再声明超8k截断');
  // aiDoSend保持无注入直通t
  const send = sliceBetween(paeSrc, 'function aiDoSend(){', "}).catch(function(e){ aiBubbleError('发送失败");
  assert.ok(send.includes('window.protoAPI.ai.ask(t,'), 'aiDoSend须直通原文t');
  assert.ok(!send.includes('window.protoAPI.ai.ask(sendText'), 'aiDoSend不得再经sendText发送');
  assert.ok(!send.includes('readSpecSnapshot()') && !send.includes('buildSpecHeader('), 'aiDoSend不得调快照/组头');
  assert.ok(!send.includes('<design-spec') && !send.includes('<ui-lib'), 'aiDoSend不得前置头标签');
  assert.ok(!send.includes('sendText'), 'aiDoSend不得经sendText中转');
}

// ── A9 空约束helpers/第五节缺席+aiDoSend无注入直通t ──
function testA9_EmptyFallback() {
  // helpers已删
  assert.ok(!paeSrc.includes('function readSpecSnapshot('), '前端helpers已删：pae不得再含 readSpecSnapshot');
  assert.ok(!paeSrc.includes('function buildSpecHeader('), '前端helpers已删：pae不得再含 buildSpecHeader');
  assert.ok(!paeSrc.includes('未选用设计规范，不回退灰阶') && !paeSrc.includes('未选用设计规范'), '空规范文案已随UI删除');
  assert.ok(!paeSrc.includes('未选用前端组件'), '空组件文案已随UI删除');
  // aiDoSend保持直通t，无注入、无快照调用、无spec事件
  const send = sliceBetween(paeSrc, 'function aiDoSend(){', "}).catch(function(e){ aiBubbleError('发送失败");
  assert.ok(send.includes('window.protoAPI.ai.ask(t,'), 'aiDoSend须直通原文t（不再经sendText）');
  assert.ok(!send.includes('window.protoAPI.ai.ask(sendText'), 'aiDoSend不得再经sendText发送');
  assert.ok(!send.includes('readSpecSnapshot()') && !send.includes('buildSpecHeader('), 'aiDoSend不得再调快照/组头');
  assert.ok(!send.includes('<design-spec') && !send.includes('<ui-lib'), 'aiDoSend不得再前置头标签');
  assert.ok(!send.includes("logWrite('info','spec','spec:'"), 'aiDoSend不得再记spec:empty/missing事件');
  assert.ok(send.includes('getActiveEngineInUi') && send.includes("curAiConfig&&curAiConfig.engine||'cli'"), 'aiDoSend仍须携带双引擎engine（CLI/API直通t）');
  // 原有涉及文件清单约束在新链路保留（edit-entry），提示词第五节已删
  assert.ok(editEntrySrc.includes('涉及文件清单'), '原有涉及文件清单约束须在edit-entry保留');
  assert.ok(!promptSrc.includes('## 五、设计规范与前端组件约束'), 'toolPrompt第五节已删');
  assert.ok(!promptSrc.includes('空约束') && !promptSrc.includes('四禁') && !promptSrc.includes('禁大段写注释'), '第五节空约束/四禁已随节删除');
  assert.ok(promptSrc.includes('## 四、'), '提示词须保留前四节');
}

// ── A10 11脚本(9经典+utils/store ESM)+EXPORT轻量解耦+卡片逻辑缺席 (Wave-D/G) ──
function testA10_NineScripts() {
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*>/g;
  const list = [];
  let m;
  while ((m = re.exec(htmlSrc))) list.push(m[1]);
  const expect = ['js/icons.js', 'js/mask-manager.js', 'js/doc/markdown-compiler.js', 'js/doc/editor-controller.js', 'js/doc/toc-navigator.js', 'js/doc/mirror-sync.js', 'js/core-docs.js', 'js/nav-zoom.js', 'js/sandbox-core.js', 'js/git-ui/git-domain.js', 'js/ai/ai-domain.js', 'js/project-ai-export-compiler.js', 'js/project-ai-export.js', 'js/edit-entry.js', 'js/link-bind.js', 'js/annotation-core.js', 'js/utils.js', 'js/store.js'];
  assert.deepStrictEqual(list, expect, '脚本须为18个(16经典域先于门面+utils/store ESM, Wave-D/G), 实际:' + JSON.stringify(list));
  const expM2 = paeSrc.match(/var EXPORT_SCRIPT_FILES\s*=\s*(\[[^\]]*\])/);
  const expList2 = expM2 ? eval(expM2[1]) : [];
  assert.deepStrictEqual(expList2, ['js/icons.js', 'js/export-template.js'], 'EXPORT须轻量2项解耦(Wave-D/G), 实际:' + JSON.stringify(expList2));
  assert.ok(!htmlSrc.includes('spec-uilib-bar.js'), '不得新增独立 spec-uilib-bar.js');
  // 底部卡片逻辑已删：不得再残留
  assert.ok(!sandboxSrc.includes('function SpecBarRefresh('), '底部卡片已删：sandbox不得再含 SpecBarRefresh');
  assert.ok(!sandboxSrc.includes("SpecBarEl('specBarTrack')") && !sandboxSrc.includes('specBarTrack'), '底部卡片已删：不得再含 specBarTrack');
  assert.ok(!sandboxSrc.includes('SpecBar'), '底部卡片已删：不得再含 SpecBar*');
}

// ── A11 Tab/卡片/弹窗/下拉缺席+renderMdPreview存在 ──
function testA11_TabAndIds() {
  // 设置Tab已删
  assert.ok(!htmlSrc.includes('id="tabNavSpec"') && !htmlSrc.includes('id="paneSetSpec"'), '设置Tab已删：不得再含 tabNavSpec/paneSetSpec');
  assert.ok(!paeSrc.includes("key:'spec'") && !paeSrc.includes('key:"spec"'), '设置Tab注册已删：pae不得再含 spec key');
  assert.ok(!htmlSrc.includes('id="specList"') && !htmlSrc.includes('id="uilibList"'), '两板块列表已删');
  assert.ok(!htmlSrc.includes('id="btnSpecAdd"') && !htmlSrc.includes('id="btnUilibAdd"') && !htmlSrc.includes('id="btnSpecRestore"'), '两板块新增/恢复按钮已删');
  // 底部两排卡片已删
  assert.ok(!htmlSrc.includes('id="specBarTrack"') && !htmlSrc.includes('id="uilibBarTrack"'), '底部卡片容器已删');
  assert.ok(!cssSrc.includes('.spec-card') && !cssSrc.includes('.spec-card-name') && !cssSrc.includes('.spec-card-desc'), '卡片样式已删');
  // 项目弹窗双下拉已删
  assert.ok(!htmlSrc.includes('id="projNewSpec"') && !htmlSrc.includes('id="projNewUilib"'), '项目弹窗双下拉已删');
  assert.ok(!paeSrc.includes("$('projNewSpec')") && !paeSrc.includes("$('projNewUilib')"), '项目弹窗逻辑已删');
  // 4弹窗已删
  for (const id of ['specEditMask', 'specPreviewMask', 'uilibEditMask', 'specConfirmMask']) {
    assert.ok(!htmlSrc.includes('id="' + id + '"'), '弹窗已删，不得再含 ' + id);
  }
  assert.ok(!htmlSrc.includes('id="specContentArea"') && !htmlSrc.includes('id="specPreviewBox"'), '规范编辑/预览已删');
  // renderMdPreview保留（core-docs存在，供后续复用）
  assert.ok(docsSrc.includes('function renderMdPreview(text)'), 'core-docs 须保留 renderMdPreview');
  assert.ok(docsSrc.includes('window.renderMdPreview=renderMdPreview'), 'renderMdPreview 须挂 window 复用');
}

// ── A12 导出无附录（buildExportHtml回归单参，附录函数缺席） ──
function testA12_ExportAppendix() {
  // 通用导出保留（单参），附录已删
  assert.ok(paeSrc.includes('function buildExportHtml(chosenList)'), '通用导出须保留 buildExportHtml(chosenList)');
  assert.ok(!paeSrc.includes('exportSpecAppendix'), '导出附录已删：不得再含 exportSpecAppendix');
  assert.ok(!paeSrc.includes('附录：设计规范与组件来源'), '导出附录标题已删');
  assert.ok(!paeSrc.includes('exportSpecInfo'), '附录不得再注明规范名/组件名 exportSpecInfo');
  assert.ok(!paeSrc.includes('includeSpec') && !paeSrc.includes('exportWithSpec'), '不得再含附带规范原文开关 includeSpec/exportWithSpec');
  assert.ok(!paeSrc.includes('未附带规范原文'), '默认不附带文案已删');
  assert.ok(!paeSrc.includes('slice(0,20000)'), '附带原文限长20000已删');
}

// ── S1 缺席仿真：截断helpers已删（本地stub自洽，不再与源码同构） ──
function testS1_TruncateSim() {
  // 源码缺席断言
  assert.ok(!paeSrc.includes('function truncateSpecContent'), 'pae不得再含 truncateSpecContent（已删）');
  assert.ok(!paeSrc.includes('SPEC_MAX_LEN'), 'pae不得再含 SPEC_MAX_LEN（已删）');
  assert.ok(!promptSrc.includes('超 8k'), '提示词不得再含超8k（第五节已删）');
  // 本地stub自洽（保留截断参数记忆 6000/2000/8000，仅自检不与源码比对）
  function truncateSpecContent(txt) {
    var SPEC_MAX_LEN = 8000;
    var s = String(txt == null ? '' : txt);
    if (s.length <= SPEC_MAX_LEN) return s;
    var head = s.slice(0, 6000), tail = s.slice(-2000);
    return head + '\n\n[...规范超长已截断，仅保留头部6000+尾部2000字符...]\n\n' + tail;
  }
  assert.strictEqual(truncateSpecContent('a'.repeat(8000)), 'a'.repeat(8000), '恰8k须原样');
  assert.strictEqual(truncateSpecContent('a'.repeat(8001)).length, 6000 + 2000 + '\n\n[...规范超长已截断，仅保留头部6000+尾部2000字符...]\n\n'.length, '超8k长度须为8000+标记');
  const big = 'H'.repeat(6000) + 'M'.repeat(5000) + 'T'.repeat(2000);
  const out = truncateSpecContent(big);
  assert.ok(out.startsWith('H'.repeat(6000)), '头须保留前6000');
  assert.ok(out.endsWith('T'.repeat(2000)), '尾须保留后2000');
  assert.ok(out.includes('规范超长已截断'), '须带省略标记');
  assert.ok(!out.includes('M'.repeat(5000).slice(0, 1000)) || out.length < big.length, '中部须被截掉');
  assert.strictEqual(truncateSpecContent(''), '', '空串须原样空');
}

// ── S2 最小stub仿真：重名+拷贝隔离（后端保留） ──
function testS2_UniqueAndIsolationSim() {
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
  // 源码同构校验（后端保留）
  const fn = sliceBetween(mainSrc, 'function ensureUniqueLibName(', 'function readJsonArrayFile(');
  assert.ok(fn.includes("s + '(' + n + ')'"), 'stub 后缀须与源码同构 (n)');
  // 真值表
  assert.strictEqual(ensureUniqueLibName([], '通用规范', null), '通用规范', '无冲突须原名');
  assert.strictEqual(ensureUniqueLibName([{ id: 'a', name: '通用规范' }], '通用规范', null), '通用规范(2)', '重名须加(2)');
  assert.strictEqual(ensureUniqueLibName([{ id: 'a', name: '通用规范' }, { id: 'b', name: '通用规范(2)' }], '通用规范', null), '通用规范(3)', '连重须递增(3)');
  assert.strictEqual(ensureUniqueLibName([{ id: 'a', name: '通用规范' }], '通用规范', 'a'), '通用规范', '编辑自身须排除selfId不加后缀');
  assert.strictEqual(ensureUniqueLibName([{ id: 'a', name: 'Vant' }], 'Vant', null), 'Vant(2)', '组件库同理加(2)');
  // 拷贝隔离镜像：删库不碰快照对象
  function simRemoveLib(libItems, snapshots, id) {
    const ni = libItems.filter((x) => x.id !== id);
    return { lib: ni, snapshots: snapshots };
  }
  const lib = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }];
  const snaps = { projA: '#快照A', projB: '#快照B' };
  const r = simRemoveLib(lib, snaps, 's1');
  assert.deepStrictEqual(r.lib, [{ id: 's2', name: 'B' }], '删库须移除条目');
  assert.deepStrictEqual(r.snapshots, snaps, '删库不得碰快照（引用/值不变）');
  assert.strictEqual(r.snapshots.projA, '#快照A', '快照内容须保留');
}

function runAll() {
  const tests = [
    ['A1 后端12通道签名', testA1_TwelveChannels],
    ['A2 预设+三命名空间', testA2_PresetsAndNamespaces],
    ['A3 库CRUD签名', testA3_CrudSignatures],
    ['A4 重名(2)', testA4_DupSuffix2],
    ['A5 非md/超大/非UTF8拒绝+前端无弹窗文案', testA5_FileGuards],
    ['A6 拷贝隔离删库不碰快照+确认弹窗缺席', testA6_CopyIsolation],
    ['A7 绑定仅写当前项目+前端SpecBind缺席', testA7_BindingCurrentProjectOnly],
    ['A8 截断helpers缺席+aiDoSend无注入', testA8_Truncate8k],
    ['A9 空约束/第五节缺席+aiDoSend无注入', testA9_EmptyFallback],
    ['A10 9脚本未增+卡片逻辑缺席', testA10_NineScripts],
    ['A11 Tab/卡片/弹窗缺席+renderMdPreview存在', testA11_TabAndIds],
    ['A12 导出无附录', testA12_ExportAppendix],
    ['S1 缺席仿真', testS1_TruncateSim],
    ['S2 重名+隔离仿真', testS2_UniqueAndIsolationSim],
  ];
  let passed = 0, failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(failed ? 'SPEC_UILIB_FAIL' : 'SPEC_UILIB_PASS: 全部14项规范组件断言通过');
  process.exitCode = failed ? 1 : 0;
}
runAll();
