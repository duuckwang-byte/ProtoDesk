/* 用例：重命名沙箱越界防护 + 删除深度校验 + 首页草稿 route key + 联动解耦检验 */
module.exports = async function guardAndRenameCase(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  // 1. 验证联动完全解耦：__onProtoNav 应为 undefined
  const hasOnProtoNav = await api.evaluate(`typeof window.__onProtoNav`);
  assert(hasOnProtoNav === 'undefined', '__onProtoNav 未被完全清除');

  // 2. 验证首页 route key 统一为空字符串
  const hashKey = await api.evaluate(`(function(){ return typeof editFrameHash==='function' ? editFrameHash() : null; })()`);
  assert(hashKey === '', '首页 editFrameHash 未返回空字符串（实际返回：' + hashKey + '）');

  // 3. 验证文档渲染：loadDesc() 正常执行且 docContent 有内容
  const docLen = await api.evaluate(`(function(){
    loadDesc();
    return document.getElementById('docContent').children.length;
  })()`);
  assert(docLen > 0, 'loadDesc 渲染文档内容为空');

  // 4. 验证沙箱删除安全守卫：禁止删除一级项目目录
  const curDir = await api.evaluate(`(window.currentSource&&window.currentSource.sandboxDir)||''`);
  assert(curDir !== '', '当前源无沙箱目录');

  const rootRes = await api.evaluate(`(async function(){
    const parentDir = ${JSON.stringify(curDir)}.split(/[/\\\\]/).slice(0, -1).join('/');
    return window.protoAPI.sandbox.remove({ dir: parentDir });
  })()`);
  assert(rootRes && rootRes.ok === false, 'sandbox:remove 未拦截对一级项目目录的删除！');

  // 5. 验证重命名防护：重命名后路径依然在原项目内
  const renameRes = await api.evaluate(`(async function(){
    const cur = window.currentSource;
    // 重命名为相同名称
    return window.protoAPI.sandbox.rename({ dir: cur.sandboxDir, name: cur.displayName });
  })()`);
  assert(renameRes && renameRes.ok === true, '同名重命名应成功返回');

  // 6. 验证检查器抽屉弹出与遮罩
  const inspState = await api.evaluate(`(function(){
    const el = document.createElement('button');
    el.textContent = '测试按钮';
    document.body.appendChild(el);
    LinkBind.openInspector(el);
    const drawer = document.getElementById('linkInspector');
    const mask = document.getElementById('linkInspMask');
    const res = {
      open: drawer.classList.contains('open'),
      display: window.getComputedStyle(drawer).display,
      maskDisplay: window.getComputedStyle(mask).display
    };
    LinkBind.closeInspector();
    el.remove();
    return JSON.stringify(res);
  })()`);
  const insp = JSON.parse(inspState);
  assert(insp.open === true, 'linkInspector 未添加 open 类');
  assert(insp.display !== 'none', 'linkInspector 处于 display:none 隐藏状态');
  assert(insp.maskDisplay !== 'none', 'linkInspMask 遮罩处于 display:none 隐藏状态');

  // 7. 验证菜单栏 Docked 布局与展开收起宽窄变化
  const menuTestRes = await api.evaluate(`(function(){
    // 1. 验证 sbMask 始终为 none
    setSbOpen(true);
    const maskDisplay = window.getComputedStyle(document.getElementById('sbMask')).display;
    const sbIsOpen = document.body.classList.contains('sb-open');
    
    // 2. 移动端：文档宽度在收起时变宽、展开时变窄
    setKind('mobile');
    setSbOpen(false);
    const docWClosed = document.querySelector('.docs-panel').offsetWidth;
    setSbOpen(true);
    const docWOpen = document.querySelector('.docs-panel').offsetWidth;

    // 3. 验证切换原型不自动关闭菜单栏
    if(sources.length > 1){
      loadSource(sources[0]);
    }
    const sbStillOpen = document.body.classList.contains('sb-open');

    return JSON.stringify({
      maskDisplay,
      sbIsOpen,
      docWClosed,
      docWOpen,
      sbStillOpen
    });
  })()`);
  const menuCheck = JSON.parse(menuTestRes);
  assert(menuCheck.maskDisplay === 'none', 'sbMask 不应显示为弹窗遮罩');
  assert(menuCheck.sbIsOpen === true, 'setSbOpen(true) 失败');
  assert(menuCheck.docWClosed >= menuCheck.docWOpen, '移动端展开菜单栏后文档说明板块应变窄');
  assert(menuCheck.sbStillOpen === true, '切换原型后菜单栏不应自动关闭');
};
