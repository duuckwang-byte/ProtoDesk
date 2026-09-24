/* 用例：全功能模拟综合测试（菜单栏响应式布局、中文按钮提取与交互卡片、项目弹窗输入、HTML导出） */
module.exports = async function fullSimulationCase(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  // 1. 菜单栏展开/收起、宽窄自适应与常驻不关闭模拟
  console.log('  [Sim 1] 测试菜单栏移动端/PC端宽窄自适应与常驻...');
  const navSim = await api.evaluate(`(async function(){
    setKind('mobile');
    setSbOpen(false);
    await new Promise(function(r){ setTimeout(r, 260); });
    var docW0 = document.querySelector('.docs-panel').offsetWidth;
    var sbW0 = document.querySelector('.sb').offsetWidth;
    var mask0 = window.getComputedStyle(document.getElementById('sbMask')).display;

    setSbOpen(true);
    await new Promise(function(r){ setTimeout(r, 260); });
    var docW1 = document.querySelector('.docs-panel').offsetWidth;
    var sbW1 = document.querySelector('.sb').offsetWidth;
    var mask1 = window.getComputedStyle(document.getElementById('sbMask')).display;

    if(sources && sources.length > 0) {
      loadSource(sources[0]);
    }
    var sbStayOpen = document.body.classList.contains('sb-open');

    setKind('pc');
    setSbOpen(true);
    await new Promise(function(r){ setTimeout(r, 260); });
    var pcHolderW_open = document.getElementById('phoneHolder').offsetWidth;
    var pcDocsDisplay0 = window.getComputedStyle(document.querySelector('.docs-panel')).position;

    setDocsOpen(true);
    await new Promise(function(r){ setTimeout(r, 260); });
    var pcDocsOpen = document.body.classList.contains('docs-open');
    var pcDocsMask = window.getComputedStyle(document.getElementById('docsMask')).display;

    setDocsOpen(false);
    await new Promise(function(r){ setTimeout(r, 260); });
    var pcDocsClosed = !document.body.classList.contains('docs-open');

    setSbOpen(false);
    fitPhone();
    await new Promise(function(r){ setTimeout(r, 260); });
    var pcHolderW_closed = document.getElementById('phoneHolder').offsetWidth;

    return JSON.stringify({
      docW0: docW0, docW1: docW1,
      sbW0: sbW0, sbW1: sbW1,
      mask0: mask0, mask1: mask1,
      sbStayOpen: sbStayOpen,
      pcDocsDisplay0: pcDocsDisplay0,
      pcDocsOpen: pcDocsOpen,
      pcDocsMask: pcDocsMask,
      pcDocsClosed: pcDocsClosed,
      pcHolderW_open: pcHolderW_open,
      pcHolderW_closed: pcHolderW_closed
    });
  })()`);
  const r1 = JSON.parse(navSim);
  assert(r1.sbW0 === 0, '收起状态下菜单栏宽度应为 0');
  assert(r1.sbW1 >= 200, '展开状态下菜单栏宽度应大于等于 200px');
  assert(r1.mask0 === 'none' && r1.mask1 === 'none', '菜单栏不应显示半透明遮罩');
  assert(r1.docW0 > r1.docW1, '移动端展开菜单栏后文档面板应变窄，收起后应变宽');
  assert(r1.sbStayOpen === true, '切换原型后菜单栏应保持常驻展开，不应自动关闭');
  assert(r1.pcDocsDisplay0 === 'fixed', 'PC 端文档说明应为浮窗定位（fixed）');
  assert(r1.pcDocsOpen === true && r1.pcDocsMask !== 'none', 'PC 端展开文档说明应唤出弹窗与遮罩');
  assert(r1.pcDocsClosed === true, 'PC 端文档说明应能正常关闭');

  // 2. 按钮中文名称智能提取、卡片化检查器与交互管理模拟
  console.log('  [Sim 2] 测试按钮中文名称提取、卡片检查器与交互抽屉...');
  const elemSim = await api.evaluate(`(function(){
    var wrap = document.createElement('div');
    wrap.id = 'testSimWrap';
    wrap.innerHTML = ''
      + '<button id="simBtnDirect">提交审批</button>'
      + '<button id="simBtnNested"><i class="icon"></i><span>发起立项申请</span></button>'
      + '<div class="nav-item"><button id="simBtnSibling"><i class="icon"></i></button><span class="label">我的资产中心</span></div>'
      + '<button id="simBtnAttr" title="系统高级设置"></button>';
    document.body.appendChild(wrap);

    var t1 = extractElementText(document.getElementById('simBtnDirect'));
    var t2 = extractElementText(document.getElementById('simBtnNested'));
    var t3 = extractElementText(document.getElementById('simBtnSibling'));
    var t4 = extractElementText(document.getElementById('simBtnAttr'));

    LinkBind.openInspector(document.getElementById('simBtnNested'));
    var liTitle = document.getElementById('liTitle').textContent;
    var jumpCardHasClass = document.getElementById('liSecJump').classList.contains('jump-card');
    var reqCardHasClass = document.getElementById('liSecReq').classList.contains('req-card');
    var dividerExists = !!document.querySelector('.li-divider');

    var reqInput = document.getElementById('liReqText');
    if(reqInput) reqInput.value = '把按钮背景改成渐变蓝色';
    var qCount0 = (window.editQueueGet ? window.editQueueGet().length : 0);
    if(typeof editQueueAdd === 'function'){
      editQueueAdd(document.getElementById('simBtnNested'), '把按钮背景改成渐变蓝色');
    }
    var qCount1 = (window.editQueueGet ? window.editQueueGet().length : 0);

    LinkBind.closeInspector();
    wrap.remove();

    return JSON.stringify({
      t1: t1, t2: t2, t3: t3, t4: t4,
      liTitle: liTitle,
      jumpCardHasClass: jumpCardHasClass,
      reqCardHasClass: reqCardHasClass,
      dividerExists: dividerExists,
      qCount0: qCount0,
      qCount1: qCount1
    });
  })()`);
  const r2 = JSON.parse(elemSim);
  assert(r2.t1.indexOf('提交审批') >= 0, '直接文字提取失败: ' + r2.t1);
  assert(r2.t2.indexOf('发起立项申请') >= 0, '子元素中文提取失败: ' + r2.t2);
  assert(r2.t3.indexOf('我的资产中心') >= 0, '下方/兄弟标签中文提取失败: ' + r2.t3);
  assert(r2.t4.indexOf('系统高级设置') >= 0, '属性中文提取失败: ' + r2.t4);
  assert(r2.liTitle.indexOf('发起立项申请') >= 0, '检查器标题未正确显示按钮中文名: ' + r2.liTitle);
  assert(r2.jumpCardHasClass === true, '跳转交互卡片缺少 jump-card 样式类');
  assert(r2.reqCardHasClass === true, '修改需求卡片缺少 req-card 样式类');
  assert(r2.dividerExists === true, '缺少卡片间视觉分割线 .li-divider');
  assert(r2.qCount1 > r2.qCount0, '添加修改需求至待提交队列失败');

  // 3. 项目弹窗聚焦与输入能力模拟
  console.log('  [Sim 3] 测试项目管理弹窗输入框聚焦与样式...');
  const projSim = await api.evaluate(`(function(){
    var input = document.getElementById('projNewName');
    var isInputDisabled = input ? input.disabled : true;
    var pointerEvents = input ? window.getComputedStyle(input).pointerEvents : '';
    return JSON.stringify({
      hasInput: !!input,
      isInputDisabled: isInputDisabled,
      pointerEvents: pointerEvents
    });
  })()`);
  const r3 = JSON.parse(projSim);
  assert(r3.hasInput === true, '未找到项目名称输入框');
  assert(r3.isInputDisabled === false, '项目输入框处于禁用状态');
  assert(r3.pointerEvents !== 'none', '项目输入框 pointer-events 为 none，无法接收点击');

  // 4. HTML 导出完整性模拟
  console.log('  [Sim 4] 测试导出 HTML 生成与脚本内嵌完整性...');
  const expSim = await api.evaluate(`(async function(){
    if(typeof buildExportHtml !== 'function') return JSON.stringify({ ok: false, msg: '无 buildExportHtml' });
    try {
      var html = await buildExportHtml();
      return JSON.stringify({
        ok: true,
        len: html.length,
        hasDockedSb: html.indexOf('body.sb-open .sb{width:220px') >= 0 || html.indexOf('.sb{flex:none;width:0') >= 0,
        hasCards: html.indexOf('jump-card') >= 0 && html.indexOf('req-card') >= 0,
        hasCoreScripts: html.indexOf('function setSbOpen') >= 0 && html.indexOf('function extractElementText') >= 0
      });
    } catch(e) {
      return JSON.stringify({ ok: false, msg: (e && e.message) || String(e) });
    }
  })()`);
  const r4 = JSON.parse(expSim);
  assert(r4.ok === true, 'buildExportHtml 导出失败: ' + r4.msg);
  assert(r4.len > 1000, '导出的 HTML 文件过小');
  assert(r4.hasDockedSb === true, '导出的 HTML 缺少 Docked 侧栏布局样式');
  assert(r4.hasCards === true, '导出的 HTML 缺少检查器卡片结构');
  // 5. 最新需求编辑并保存后立即刷新展示模拟
  console.log('  [Sim 5] 测试「最新需求」编辑并保存后实时刷新内容...');
  const reqSim = await api.evaluate(`(async function(){
    try {
      // 切换至最新需求模式
      if(typeof setReqModeMobile === 'function') setReqModeMobile(true);
      // 模拟进入编辑
      var btnEdit = document.getElementById('btnEditDoc');
      if(btnEdit) btnEdit.click();
      var editArea = document.getElementById('docEditArea');
      var testText = '# 最新需求\\n\\n- 测试即时保存刷新 ' + Date.now();
      if(editArea) editArea.value = testText;
      // 模拟保存
      var btnSave = document.getElementById('btnSaveDoc');
      if(btnSave) btnSave.click();
      await new Promise(function(r){ setTimeout(r, 200); });
      var content = document.getElementById('docContent') ? document.getElementById('docContent').textContent : '';
      return JSON.stringify({
        ok: true,
        hasNewContent: content.indexOf('测试即时保存刷新') >= 0
      });
    } catch(e) {
      return JSON.stringify({ ok: false, msg: String(e) });
    }
  })()`);
  const r5 = JSON.parse(reqSim);
  assert(r5.ok === true, '最新需求编辑保存执行异常: ' + r5.msg);
  assert(r5.hasNewContent === true, '最新需求保存后未立即刷新展示最新内容');

  console.log('  [Sim Complete] 全部功能模拟测试项均校验通过！');
};
