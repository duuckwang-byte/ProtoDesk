/* 用例：项目选择弹窗渲染 → 进入首个项目 → 断言仅加载该项目 */
module.exports = async function projectFlow(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  // 确保在项目选择弹窗状态
  await api.evaluate(`(function(){ if (document.getElementById('projMask').style.display !== 'flex') { if (typeof window.bootProjectFlow === 'function') window.bootProjectFlow(); } })()`);
  await new Promise((r) => setTimeout(r, 800));

  const s1 = JSON.parse(await api.evaluate(`JSON.stringify({
    mask: document.getElementById('projMask').style.display,
    items: document.getElementById('projList').children.length
  })`));
  assert(s1.mask === 'flex', '项目选择弹窗未展示');
  assert(s1.items > 0, '项目列表项为空');

  await api.evaluate(`(function(){
    const l = document.getElementById('projList');
    const f = l ? l.children[0] : null;
    if (f) { f.click(); return true; }
    return false;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  const entered = await api.evaluate(`(function(){
    const ok = document.getElementById('projOk');
    if (ok && !ok.disabled) { ok.click(); return true; }
    return false;
  })()`);
  assert(entered === true, '进入按钮未生效（未选中项目？）');
  await new Promise((r) => setTimeout(r, 2500));
  const s2 = JSON.parse(await api.evaluate(`JSON.stringify({
    proj: window.currentProject||'',
    cnt: (window.sources&&window.sources.length)||0,
    bar: document.getElementById('sbProject').textContent
  })`));
  assert(s2.proj !== '', 'currentProject 为空');
  assert(s2.cnt >= 1, '当前项目原型数为 0');
  assert(String(s2.bar).indexOf('项目：') >= 0, '顶部项目栏未更新');
};