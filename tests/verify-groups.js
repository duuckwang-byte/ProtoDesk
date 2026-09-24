'use strict';
// 文件夹按项目隔离回归：分组存取键含项目、切换重载、老全局一次性迁移、parent保留
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const sb = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
const pae = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');

function extract(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, `[提取失败] function ${name}`);
  return m[0];
}

function makeStore() {
  const data = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    _dump() { return data; },
  };
}

function makeScope(ls) {
  const decl = "var GROUPS_KEY='protoGroups_v1',GROUPS_FOLD_KEY='protoGroupsFold_v1';\nvar groupsData={list:[],map:{}},groupsFold={};\nvar currentProject='';\n";
  const fns = extract(sb, 'groupsKey') + '\n' + extract(sb, 'groupsFoldKey') + '\n' + extract(sb, 'loadGroups') + '\n' + extract(sb, 'saveGroups');
  return new Function('localStorage', decl + fns + '\nreturn {loadGroups,saveGroups,groupsKey,setProj:(p)=>{currentProject=p;},get:()=>({groupsData,groupsFold})};')(ls);
}

// 断言1：键按项目隔离
function test1_KeyScoped() {
  const sc = makeScope(makeStore());
  sc.setProj('A'); const ka = sc.groupsKey();
  sc.setProj('B'); const kb = sc.groupsKey();
  assert.ok(ka !== kb && ka.includes('A') && kb.includes('B'), `键须含项目区分，A=${ka} B=${kb}`);
}

// 断言2：A建文件夹→B看不到→切回A还在
function test2_Isolation() {
  const ls = makeStore();
  const sc = makeScope(ls);
  sc.setProj('A'); sc.loadGroups();
  sc.get().groupsData.list.push({ id: 'g1', name: 'A的文件夹', parent: null });
  sc.get().groupsData.map['dirX'] = 'g1';
  sc.saveGroups();
  sc.setProj('B'); sc.loadGroups();
  assert.strictEqual(sc.get().groupsData.list.length, 0, 'B中不应看到A的文件夹');
  sc.setProj('A'); sc.loadGroups();
  assert.strictEqual(sc.get().groupsData.list.length, 1, '切回A文件夹应还在');
  assert.strictEqual(sc.get().groupsData.map['dirX'], 'g1', '映射应随项目恢复');
  const keys = Object.keys(ls._dump());
  assert.ok(!keys.includes('protoGroups_v1'), `不得再写裸全局键，实测${JSON.stringify(keys)}`);
}

// 断言3：老全局数据一次性迁入当前项目
function test3_LegacyMigrate() {
  const ls = makeStore();
  ls.setItem('protoGroups_v1', JSON.stringify({ list: [{ id: 'g0', name: '老文件夹', parent: null }], map: {} }));
  const sc = makeScope(ls);
  sc.setProj('A'); sc.loadGroups();
  assert.strictEqual(sc.get().groupsData.list.length, 1, '老数据应迁入当前项目');
  assert.strictEqual(ls.getItem('protoGroups_v1'), null, '迁完须删全局键');
  sc.setProj('B'); sc.loadGroups();
  assert.strictEqual(sc.get().groupsData.list.length, 0, '迁移只归当前项目，B不受影响');
}

// 断言4：二级文件夹parent不丢
function test4_ParentKept() {
  const ls = makeStore();
  ls.setItem('protoGroups_v1__' + encodeURIComponent('A'), JSON.stringify({ list: [{ id: 'p1', name: '一级', parent: null }, { id: 'c1', name: '二级', parent: 'p1' }], map: {} }));
  const sc = makeScope(ls);
  sc.setProj('A'); sc.loadGroups();
  const c = sc.get().groupsData.list.find((g) => g.id === 'c1');
  assert.ok(c && c.parent === 'p1', '二级文件夹parent须保留（重启不 flatten）');
}

// 断言5：切换项目重载分组
function test5_EnterReload() {
  const idx = pae.indexOf('function enterProject');
  assert.ok(idx >= 0, '缺enterProject');
  const seg = pae.slice(idx, idx + 800);
  assert.ok(/loadGroups\(\)/.test(seg), 'enterProject须重载本项目分组');
}

function runAll() {
  const ts = [['键按项目隔离', test1_KeyScoped], ['跨项目不可见', test2_Isolation], ['老全局迁移', test3_LegacyMigrate], ['parent保留', test4_ParentKept], ['切换重载', test5_EnterReload]];
  let p = 0, f = 0;
  for (const [t, fn] of ts) { try { fn(); console.log(`[PASS] ${t}`); p++; } catch (e) { console.error(`[FAIL] ${t}`); console.error(e); f++; } }
  console.log(`SUMMARY passed=${p} failed=${f}\n`);
  if (f) process.exit(1);
}
runAll();
