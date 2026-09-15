'use strict';
// UI 设计规范（出厂内置 + 用户可替换 + AI 按端别遵循）：种子、增量补齐、用户主权、prompt 组装
// 约定：渲染层 aiDoSend 保持直通原文 t（回滚锁）；注入只发生在主进程 aiAskImpl 下发前。
// 碰磁盘的 seed 行为在子进程（cwd=临时目录）中验证，避免污染仓库；静态断言在进程内。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const svcSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');
const aiSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'ai-process-service.js'), 'utf8');
const paeSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');

function extract(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, '[提取失败] function ' + name);
  return m[0];
}

// ---- 1. 种子文件随包 ----
(function testSeeds() {
  for (const f of ['ui-mobile.md', 'ui-desktop.md']) {
    const p = path.join(rootDir, 'design-specs', f);
    assert.ok(fs.existsSync(p), '种子缺失 design-specs/' + f);
    const buf = fs.readFileSync(p);
    assert.ok(buf.length > 1000, f + ' 内容过短');
    assert.ok(buf.length <= 48 * 1024, f + ' 超出单次注入上限 48KB');
    new (require('util').TextDecoder)('utf-8', { fatal: true }).decode(buf);
  }
  const mob = fs.readFileSync(path.join(rootDir, 'design-specs', 'ui-mobile.md'), 'utf8');
  const desk = fs.readFileSync(path.join(rootDir, 'design-specs', 'ui-desktop.md'), 'utf8');
  assert.ok(/#F5F7FA/.test(mob) && /44/.test(mob), '移动规范须含配色与触摸目标');
  assert.ok(/Ant Design/.test(desk) && /1677FF/.test(desk), '桌面规范须为 Ant Design');
  console.log('[PASS] 种子文件随包且有效');
})();

// ---- 2. 预设声明（含端别/种子/开关字段，老三项保留） ----
(function testPresets() {
  assert.ok(svcSrc.includes('function specPresetDefs('), '缺 specPresetDefs');
  for (const id of ['spec-default', 'spec-enterprise', 'spec-gov', 'spec-ui-mobile', 'spec-ui-desktop']) {
    assert.ok(svcSrc.includes("id: '" + id + "'"), '预设缺 ' + id);
  }
  assert.ok(svcSrc.includes("seedFile: 'ui-mobile.md'") && svcSrc.includes("kind: 'mobile'"), '移动预设须声明种子与端别');
  assert.ok(svcSrc.includes("seedFile: 'ui-desktop.md'") && svcSrc.includes("kind: 'pc'"), '桌面预设须声明种子与端别');
  console.log('[PASS] 预设声明完整');
})();

// ---- 3. 主进程注入点（aiDoSend 仍直通 t） ----
(function testWiring() {
  assert.ok(aiSrc.includes('function resolveUiSpecKind('), '缺 resolveUiSpecKind');
  assert.ok(aiSrc.includes('function buildUiSpecSection('), '缺 buildUiSpecSection');
  assert.ok(aiSrc.includes('readUiSpecForKind'), 'aiAsk 须经 readUiSpecForKind 取规范');
  assert.ok(aiSrc.includes('prompt: finalPrompt'), '下发须用注入后的 finalPrompt');
  assert.ok(aiSrc.includes('UI_SPEC_PROMPT_MAX_BYTES'), '须有注入长度上限');
  assert.ok(paeSrc.includes('window.protoAPI.ai.ask(t,'), 'aiDoSend 须保持直通原文 t');
  assert.ok(paeSrc.includes('uiKind:'), 'aiDoSend 须携带原型端别 uiKind');
  console.log('[PASS] 注入链路完整');
})();

// ---- 4. 组装函数纯逻辑（提取仿真） ----
(function testBuilder() {
  const capM = aiSrc.match(/const UI_SPEC_PROMPT_MAX_BYTES\s*=\s*([^;]+);/);
  assert.ok(capM, '须能提取注入上限');
  const helper = 'const UI_SPEC_PROMPT_MAX_BYTES = ' + capM[1] + ';\n'
    + extract(aiSrc, 'resolveUiSpecKind') + '\n' + extract(aiSrc, 'buildUiSpecSection');
  const fn = new Function(helper + '\nreturn {resolveUiSpecKind: resolveUiSpecKind, buildUiSpecSection: buildUiSpecSection};')();
  assert.strictEqual(fn.resolveUiSpecKind({ uiKind: 'pc' }), 'pc', 'pc 映射');
  assert.strictEqual(fn.resolveUiSpecKind({ uiKind: 'mobile' }), 'mobile', 'mobile 映射');
  assert.strictEqual(fn.resolveUiSpecKind({}), 'mobile', '缺省回落 mobile');
  assert.strictEqual(fn.resolveUiSpecKind({ uiKind: 'PC' }), 'pc', '大小写兼容');
  const sec = fn.buildUiSpecSection('mobile', { name: '移动端UI规范', content: '# t\nabc' });
  assert.ok(sec.includes('移动端UI规范') && sec.includes('# t\nabc'), '组装须含规范名与正文');
  assert.ok(sec.includes('不约束代码实现方式'), '须声明 UI 规范非代码规范');
  assert.ok(sec.includes('以用户需求为准'), '冲突须以用户需求为准');
  const big = fn.buildUiSpecSection('pc', { name: 'X', content: 'z'.repeat(100 * 1024) });
  assert.ok(big.length < 100 * 1024 && /截断/.test(big), '超限须截断并标记');
  console.log('[PASS] 组装函数行为正确');
})();

// ---- 5. 子进程：seed/增量/用户主权/kind 读取 ----
(function testRuntime() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uispec-'));
  const child = `
const path=require('path'),fs=require('fs'),assert=require('assert');
const ROOT=process.env.PLAND_ROOT;
const svc=require(path.join(ROOT,'main/services/sandbox-storage-service.js'));
const specsDir=path.join(process.cwd(),'specs');
// 5a 全新 seed：3 旧 + 2 UI，出厂 md 与种子逐字节一致
let items=svc.ensureSpecsInit();
assert.strictEqual(items.length,5,'全新应seed出5条，实际'+items.length);
const mob=items.find(x=>x.id==='spec-ui-mobile'), desk=items.find(x=>x.id==='spec-ui-desktop');
assert.ok(mob&&mob.kind==='mobile'&&mob.uiSpec&&mob.enabled!==false&&mob.file==='spec-ui-mobile.md','移动条目字段');
assert.ok(desk&&desk.kind==='pc','桌面条目字段');
assert.strictEqual(fs.readFileSync(path.join(specsDir,'spec-ui-mobile.md'),'utf8'),fs.readFileSync(path.join(ROOT,'design-specs','ui-mobile.md'),'utf8'),'移动种子一致');
assert.strictEqual(fs.readFileSync(path.join(specsDir,'spec-ui-desktop.md'),'utf8'),fs.readFileSync(path.join(ROOT,'design-specs','ui-desktop.md'),'utf8'),'桌面种子一致');
// 5b 用户主权：改 md + 加自定条目，二次初始化不动
fs.writeFileSync(path.join(specsDir,'spec-ui-mobile.md'),'用户修改版','utf8');
items.push({id:'spec-custom',name:'自定',file:'spec-custom.md',updatedAt:Date.now()});
fs.writeFileSync(path.join(specsDir,'spec-custom.md'),'custom','utf8');
fs.writeFileSync(path.join(specsDir,'index.json'),JSON.stringify(items));
const items2=svc.ensureSpecsInit();
assert.strictEqual(items2.length,6,'用户条目须保留');
assert.strictEqual(fs.readFileSync(path.join(specsDir,'spec-ui-mobile.md'),'utf8'),'用户修改版','用户修改不得被覆盖');
// 5c 存量增量：只有老3条时追加2条，老文件不动
const oldOnly=items2.filter(x=>['spec-default','spec-enterprise','spec-gov'].includes(x.id));
fs.writeFileSync(path.join(specsDir,'index.json'),JSON.stringify(oldOnly));
fs.rmSync(path.join(specsDir,'spec-ui-mobile.md'));fs.rmSync(path.join(specsDir,'spec-ui-desktop.md'));
const items3=svc.ensureSpecsInit();
assert.strictEqual(items3.length,5,'存量应增量补齐到5条');
assert.ok(items3.some(x=>x.id==='spec-ui-mobile'),'补齐移动');
// 5d 选中制读取：初始即空（无选中不注入）；ai-config 隔离到本目录，防读到仓库 dev 配置
const astore5=require(path.join(ROOT,'main/services/ai-config-store.js'));
astore5._setPathsForTest({configPath:path.join(process.cwd(),'ai-config.json'),credPath:path.join(process.cwd(),'ai-credentials.json')});
fs.writeFileSync(path.join(process.cwd(),'ai-config.json'),JSON.stringify({engine:'cli'}));
let r1=svc.readUiSpecForKind('mobile');assert.strictEqual(r1,null,'初始无选中须返回null');
let r2=svc.readUiSpecForKind('pc');assert.strictEqual(r2,null,'初始无选中须返回null');
// 显式选中生效
fs.writeFileSync(path.join(process.cwd(),'ai-config.json'),JSON.stringify({engine:'cli',activeUiSpecMobile:'spec-ui-mobile'}));
r1=svc.readUiSpecForKind('mobile');assert.ok(r1&&r1.kind==='mobile'&&r1.content.length>1000,'显式选中移动生效');
// 显式选中生效（双端）
fs.writeFileSync(path.join(process.cwd(),'ai-config.json'),JSON.stringify({engine:'cli',activeUiSpecMobile:'spec-ui-mobile',activeUiSpecPc:'spec-ui-desktop'}));
r1=svc.readUiSpecForKind('mobile');assert.ok(r1&&r1.kind==='mobile'&&r1.content.length>1000,'显式选中移动生效');
r2=svc.readUiSpecForKind('pc');assert.ok(r2&&r2.kind==='pc'&&/Ant Design/.test(r2.content),'显式选中桌面生效');
let r3=svc.readUiSpecForKind('whatever');assert.ok(r3&&r3.kind==='mobile','未知端别归一到移动端');
const idx=JSON.parse(fs.readFileSync(path.join(specsDir,'index.json'),'utf8'));
idx.forEach(x=>{if(x.id==='spec-ui-mobile')x.enabled=false;});
fs.writeFileSync(path.join(specsDir,'index.json'),JSON.stringify(idx));
let r4=svc.readUiSpecForKind('mobile');assert.strictEqual(r4,null,'停用返回null');
console.log('CHILD_ALL_PASS');
`;
  const r = spawnSync(process.execPath, ['-e', child], {
    cwd: tmp, env: { ...process.env, PLAND_ROOT: rootDir }, encoding: 'utf8', timeout: 60000,
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  assert.strictEqual(r.status, 0, '子进程退出码\nSTDOUT:\n' + (r.stdout || '') + '\nSTDERR:\n' + (r.stderr || ''));
  assert.ok((r.stdout || '').includes('CHILD_ALL_PASS'), '子进程须全过\n' + (r.stdout || '') + (r.stderr || ''));
  console.log('[PASS] seed/增量/用户主权/kind读取');
})();

console.log('UISPEC_PASS: UI规范种子与注入全绿');

// ---- 6. 设置页 UI（静态）：新 Tab/卡片/新增弹窗，旧回滚锁保持 ----
(function testSettingsUi() {
  const html = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
  for (const id of ['tabNavUispec', 'paneSetUispec', 'uispecSubMobile', 'uispecSubPc', 'uispecCardList',
    'uispecAddMask', 'uispecAddTitle', 'uispecAddFileRow', 'uispecPickFile', 'uispecAddFileName', 'uispecAddName', 'uispecAddDesc',
    'uispecAddSave', 'uispecAddCancel', 'uispecAddClose']) {
    assert.ok(html.includes('id="' + id + '"'), '设置页缺 #' + id);
  }
  // 新 Tab 在“关于”之前（与快捷键 Tab 同序约束）
  assert.ok(html.indexOf('id="tabNavUispec"') < html.indexOf('id="tabNavAbout"'), '规范Tab须在关于之前');
  assert.ok(html.indexOf('id="paneSetUispec"') < html.indexOf('id="paneSetAbout"'), '规范Pane须在关于之前');
  // 旧回滚锁：不得复活旧 id/类
  for (const bad of ['id="tabNavSpec"', 'id="paneSetSpec"', 'id="specList"', 'id="uilibList"',
    'id="projNewSpec"', 'id="specEditMask"', 'id="specContentArea"']) {
    assert.ok(!html.includes(bad), '旧规范UI不得复活：' + bad);
  }
  assert.ok(!css.includes('.spec-card'), '旧卡片样式不得复活');
  assert.ok(css.includes('.uispec-card') && css.includes('.uispec-add'), '新卡片样式缺失');
  assert.ok(css.includes('.uispec-op') && !css.includes('.uispec-del'), '操作须为文字按钮（uispec-op），×图标已移除');
  assert.ok(css.includes('.uispec-grid{display:flex'), '卡片须整行单列展示');
  // JS 注册：key 不得为 spec（回滚锁），须为 uispec
  assert.ok(paeSrc.includes("key:'uispec'"), 'switchSettingsTab 须注册 uispec');
  assert.ok(!paeSrc.includes("key:'spec'"), '不得出现 key:spec（回滚锁）');
  for (const fn of ['uispecActiveId', 'renderUispecCards', 'refreshUispecList', 'uispecToggleActive',
    'uispecDeleteSpec', 'openUispecAdd', 'closeUispecAdd', 'uispecSwitchSub']) {
    assert.ok(paeSrc.includes('function ' + fn + '('), '缺函数 ' + fn);
  }
  assert.ok(paeSrc.includes('var uispecEditId=null'), '新增弹窗须复用为编辑（uispecEditId）');
  assert.ok(paeSrc.includes('data-act'), '卡片操作须为文字按钮（编辑/删除）');
  assert.ok(paeSrc.includes('activeUiSpecMobile') && paeSrc.includes('activeUiSpecPc'), '选中态须存双端键');
  assert.ok(paeSrc.includes('spec.createFromFile'), '新增须走现有 createFromFile 通道');
  assert.ok(paeSrc.includes('kind:tabKind'), '新增后须经 update 打上当前 Tab 端别');
  assert.ok(paeSrc.includes('spec.remove'), '删除须走现有 remove 通道（物理删除）');
  assert.ok(paeSrc.includes('removedBuiltinSpecs'), '删内置须记墓碑防复活');
  assert.ok(paeSrc.includes('回读不一致'), '选中保存后须回读校验落盘');
  assert.ok(paeSrc.includes('保存失败'), '保存失败须报因，不得静默');
  const svcSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');
  assert.ok(svcSrc.includes('function getRemovedBuiltinIds('), '缺墓碑读取函数');
  // 跨域按键：帧侧只上报修饰键态（安全），宿主驱动同一状态机；刷新祛静默
  const sbSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
  const agentSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-agent.js'), 'utf8');
  for (const [nm, src] of [['sandbox-core', sbSrc], ['sandbox-agent', agentSrc]]) {
    assert.ok(src.includes('function sendCtrlState(ev)') || src.includes('function sendCtrlState('), nm + '帧模板缺修饰键上报');
    assert.ok(src.includes('inFormFocus'), nm + '帧模板缺输入框抑制');
    assert.ok((src.match(/document\.addEventListener\("keydown"/g) || []).length >= 1, nm + '帧模板缺keydown监听');
    assert.ok(src.includes('CTRL_STATE'), nm + '帧模板缺CTRL_STATE类型');
    assert.ok(src.includes('sendEscape'), nm + '帧模板缺Esc转发');
    assert.ok(src.includes('sendHover') && src.includes('mousemove'), nm + '帧模板缺悬停上报');
  }
  assert.ok(sbSrc.includes('CTRL_STATE: 1') && agentSrc.includes('CTRL_STATE: 1'), '双向白名单须含CTRL_STATE');
  assert.ok(sbSrc.includes('__onRemoteCtrlState'), '宿主须分发CTRL_STATE到注册表');
  assert.ok(sbSrc.includes("t === 'PICK_MISS'") && agentSrc.includes('PICK_MISS'), '未武装补偿须双端实现');
  const eeSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  assert.ok(eeSrc.includes('function remoteCtrlStateChanged('), '缺远端按键状态机');
  assert.ok(eeSrc.includes('__onRemoteCtrlState'), '须注册远端按键回调');
  assert.ok(eeSrc.includes('function remotePickMiss(') && eeSrc.includes('__onRemotePickMiss'), '未武装命中须收编');
  assert.ok(eeSrc.includes('activeElement===frame'), 'blur切帧须保活拾取会话');
  assert.ok(eeSrc.includes('function remoteEscape(') && eeSrc.includes('__onRemoteEscape'), '帧Esc须进统一关闭链');
  assert.ok(eeSrc.includes('function cancelCtrlPickState(') && eeSrc.includes('__cancelCtrlPick'), '须有拾取取消出口');
  assert.ok(eeSrc.includes('function editShowHoverRect(') && eeSrc.includes('__onRemoteHover'), '远端悬停须复用高亮框');
  assert.ok(paeSrc.includes('正在刷新'), '刷新须有开始提示（祛静默）');
  assert.ok(paeSrc.includes('尚未进入任何项目'), '无项目刷新须提示（祛静默）');
  // 绑定后默认刷新原型：saveJumpBinding 成功路径须走刷新链路（子页面保持）
  const lbSrc = fs.readFileSync(path.join(rootDir, 'js', 'link-bind.js'), 'utf8');
  assert.ok(lbSrc.includes('loadSandboxSources'), '绑定保存后须默认刷新原型');
  assert.ok(lbSrc.includes('_refreshSavedSub'), '刷新须保持子页面');
  // 遮罩/Esc统一：pop恢复注册态、漏注册补齐、空函数修实
  const maskSrc = fs.readFileSync(path.join(rootDir, 'js', 'mask-manager.js'), 'utf8');
  assert.ok(maskSrc.includes('_onClick'), 'pop须恢复注册态（二次打开遮罩可点）');
  assert.ok(paeSrc.includes("register('apiProfileMask'") && paeSrc.includes("register('uispecAddMask'"), '漏注册须补齐');
  assert.ok(!paeSrc.includes("register('gitHealConfirmMask','gitHealConfirmMask', function() {})"), '空函数注册须修实');
  assert.ok(maskSrc.includes('__cancelCtrlPick'), 'Esc须优先取消拾取态');
  console.log('[PASS] 设置页 UI 静态完整');
})();

// ---- 7. 子进程：选中语义（显式优先/跨端回落/明确不选/update端别校验） ----
(function testSelection() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uispec-sel-'));
  const child = `
const path=require('path'),fs=require('fs'),assert=require('assert');
const ROOT=process.env.PLAND_ROOT;
const svc=require(path.join(ROOT,'main/services/sandbox-storage-service.js'));
const astore=require(path.join(ROOT,'main/services/ai-config-store.js'));
astore._setPathsForTest({configPath:path.join(process.cwd(),'ai-config.json'),credPath:path.join(process.cwd(),'ai-credentials.json')});
const writeCfg=(o)=>fs.writeFileSync(path.join(process.cwd(),'ai-config.json'),JSON.stringify(o));
svc.ensureSpecsInit();
// 显式选中：pc 端选桌面规范生效
writeCfg({engine:'cli',activeUiSpecPc:'spec-ui-desktop'});
let r=svc.readUiSpecForKind('pc');
assert.ok(r&&r.id==='spec-ui-desktop'&&/Ant Design/.test(r.content),'pc显式选中桌面规范');
// 跨端错选：mobile 端指向桌面规范 → 端别不兼容，不注入
writeCfg({engine:'cli',activeUiSpecMobile:'spec-ui-desktop'});
r=svc.readUiSpecForKind('mobile');
assert.strictEqual(r,null,'跨端错选须返回null');
// 明确不选：null 即无注入
writeCfg({engine:'cli',activeUiSpecMobile:null});
assert.strictEqual(svc.readUiSpecForKind('mobile'),null,'null须返回null');
// 缺失（初始空选中）：无注入，不设默认
writeCfg({engine:'cli'});
r=svc.readUiSpecForKind('mobile');
assert.strictEqual(r,null,'缺失须返回null（初始即空选中）');
// 停用：选中已停用项 → null
writeCfg({engine:'cli',activeUiSpecMobile:'spec-ui-mobile'});
let idx0=JSON.parse(fs.readFileSync(path.join(process.cwd(),'specs','index.json'),'utf8'));
idx0.forEach(x=>{if(x.id==='spec-ui-mobile')x.enabled=false;});
fs.writeFileSync(path.join(process.cwd(),'specs','index.json'),JSON.stringify(idx0));
assert.strictEqual(svc.readUiSpecForKind('mobile'),null,'停用须返回null');
// update 端别校验
let bad=svc.specUpdateImpl(null,{id:'spec-ui-mobile',kind:'weird'});
assert.ok(bad&&!bad.ok,'非法端别须拒绝');
let ok2=svc.specUpdateImpl(null,{id:'spec-ui-mobile',kind:'mobile'});
assert.ok(ok2&&ok2.ok,'合法端别须接受');
// 墓碑：删内置mobile并记墓碑 → 不复活；清墓碑 → 复活
let idx1=JSON.parse(fs.readFileSync(path.join(process.cwd(),'specs','index.json'),'utf8')).filter(x=>x.id!=='spec-ui-mobile');
fs.writeFileSync(path.join(process.cwd(),'specs','index.json'),JSON.stringify(idx1));
try{fs.rmSync(path.join(process.cwd(),'specs','spec-ui-mobile.md'));}catch(e){}
writeCfg({engine:'cli',removedBuiltinSpecs:['spec-ui-mobile']});
let idx2=svc.ensureSpecsInit();
assert.ok(!idx2.some(x=>x.id==='spec-ui-mobile'),'有墓碑不得复活');
writeCfg({engine:'cli',removedBuiltinSpecs:[]});
let idx3=svc.ensureSpecsInit();
assert.ok(idx3.some(x=>x.id==='spec-ui-mobile'),'无墓碑应补回');
assert.strictEqual(fs.readFileSync(path.join(process.cwd(),'specs','spec-ui-mobile.md'),'utf8'),fs.readFileSync(path.join(ROOT,'design-specs','ui-mobile.md'),'utf8'),'补回内容须与种子一致');
console.log('CHILD2_ALL_PASS');
`;
  const r = spawnSync(process.execPath, ['-e', child], {
    cwd: tmp, env: { ...process.env, PLAND_ROOT: rootDir }, encoding: 'utf8', timeout: 60000,
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  assert.strictEqual(r.status, 0, '子进程退出码\nSTDOUT:\n' + (r.stdout || '') + '\nSTDERR:\n' + (r.stderr || ''));
  assert.ok((r.stdout || '').includes('CHILD2_ALL_PASS'), '子进程须全过\n' + (r.stdout || '') + (r.stderr || ''));
  console.log('[PASS] 选中语义正确');
})();

console.log('UISPEC_UI_PASS: 设计规范设置页全绿');
