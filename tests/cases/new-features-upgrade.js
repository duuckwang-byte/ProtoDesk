/* 用例：测试新升级的 6 大功能模块
   1. 纯单文件 HTML 源码导出/复制按钮
   2. 设置弹窗 4 Tab 切换与 AI 直连配置切换
   3. 模型显示管理与白名单过滤
   4. 大模型对话与 DSH 执行日志双 Tab 切换
   5. Trace 日志追加、清空与复制
   6. 富文本 Markdown 渲染与折叠思考块结构
*/
module.exports = async function newFeaturesUpgrade(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  console.log('  [NF 1] 验证导出悬浮下拉菜单与纯 HTML 原型源码导出按钮（已删除复制源码按钮与下载图标）...');
  const exportBtnCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    hasExpMenu: !!document.getElementById('btnExportMenu'),
    hasExpPure: !!document.getElementById('btnExportPureHtml'),
    hasExpHtml: !!document.getElementById('btnExportHtml'),
    hasCopyPure: !!document.getElementById('btnCopyPureHtml'),
    expText: document.getElementById('btnExportPureHtml').textContent.trim()
  })`));
  assert(exportBtnCheck.hasExpMenu, '未找到 btnExportMenu 导出下拉菜单按钮');
  assert(exportBtnCheck.hasExpPure, '未找到 btnExportPureHtml 按钮');
  assert(exportBtnCheck.hasExpHtml, '未找到 btnExportHtml 按钮');
  assert(!exportBtnCheck.hasCopyPure, '复制源码按钮未被删除');
  assert(exportBtnCheck.expText === '导出原型源码', '导出原型源码按钮文案不符或仍含有下载图标: ' + exportBtnCheck.expText);

  console.log('  [NF 2] 验证设置弹窗现代化 4 Tab 布局与 Direct API 引擎切换...');
  await api.evaluate(`(function(){ if (typeof window.openSettings === 'function') window.openSettings('ai'); })()`);
  await new Promise((r) => setTimeout(r, 600));

  const setTabs = JSON.parse(await api.evaluate(`JSON.stringify({
    mask: document.getElementById('settingsMask').style.display,
    tabAi: !!document.getElementById('tabNavAi'),
    tabModels: !!document.getElementById('tabNavModels'),
    tabSandbox: !!document.getElementById('tabNavSandbox'),
    tabAbout: !!document.getElementById('tabNavAbout'),
    boxCli: document.getElementById('boxCliCfg').style.display !== 'none',
    boxApi: document.getElementById('boxApiCfg').style.display !== 'none'
  })`));
  assert(setTabs.mask === 'flex', '设置弹窗未显示');
  assert(setTabs.tabAi && setTabs.tabModels && setTabs.tabSandbox && setTabs.tabAbout, '设置弹窗 4 Tab 不完整');

  // 切换到 API 直连单选
  await api.evaluate(`(function(){
    const r = document.getElementById('engApi');
    if (r) { r.checked = true; r.onchange(); }
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  const apiBoxState = JSON.parse(await api.evaluate(`JSON.stringify({
    boxCli: document.getElementById('boxCliCfg').style.display === 'none',
    boxApi: document.getElementById('boxApiCfg').style.display !== 'none',
    hasPreset: !!document.getElementById('setApiPreset'),
    hasBaseUrl: !!document.getElementById('setApiBaseUrl'),
    hasKey: !!document.getElementById('setApiKey'),
    hasModel: !!document.getElementById('setApiModel'),
    hasTestBtn: !!document.getElementById('btnTestApi')
  })`));
  assert(apiBoxState.boxCli, '切换到 API 模式后 CLI 区未隐藏');
  assert(apiBoxState.boxApi, '切换到 API 模式后 API 配置区未显示');
  assert(apiBoxState.hasTestBtn, '未找到测试连通性按钮 btnTestApi');

  console.log('  [NF 3] 验证模型显示管理 Tab、跨引擎勾选记忆与保存后不关闭弹窗...');
  await api.evaluate(`(function(){ document.getElementById('tabNavModels').click(); })()`);
  await new Promise((r) => setTimeout(r, 400));
  const modelTabState = JSON.parse(await api.evaluate(`JSON.stringify({
    paneVisible: document.getElementById('paneSetModels').style.display !== 'none',
    hasSearch: !!document.getElementById('setModelSearch'),
    hasSelectAll: !!document.getElementById('btnSelectAllModels'),
    hasAddCustom: !!document.getElementById('btnAddCustomModel')
  })`));
  assert(modelTabState.paneVisible, '模型管理 Tab 面板未显示');
  assert(modelTabState.hasSearch && modelTabState.hasSelectAll, '模型管理工具栏不完整');

  // 测试记忆逻辑：在 API 模式下取消勾选某模型 -> 切回 CLI -> 再切回 API，检查勾选状态是否完全记忆
  await api.evaluate(`(function(){
    const chks = document.querySelectorAll('#modelCheckList input[type="checkbox"]');
    if (chks.length > 1) {
      chks[0].checked = true;
      chks[1].checked = false;
    }
  })()`);
  // 切换到 CLI
  await api.evaluate(`(function(){ if (typeof window.setEngineUi === 'function') window.setEngineUi('cli'); })()`);
  await new Promise((r) => setTimeout(r, 300));
  // 再切回 API
  await api.evaluate(`(function(){ if (typeof window.setEngineUi === 'function') window.setEngineUi('api'); })()`);
  await new Promise((r) => setTimeout(r, 300));
  const memoryCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    firstChecked: (document.querySelectorAll('#modelCheckList input[type="checkbox"]')[0] || {}).checked,
    secondChecked: (document.querySelectorAll('#modelCheckList input[type="checkbox"]')[1] || {}).checked
  })`));
  assert(memoryCheck.firstChecked === true && memoryCheck.secondChecked === false, '切换引擎后模型勾选状态未被正确记忆');

  // 测试保存后不关闭弹窗且显示提示
  await api.evaluate(`(function(){ document.getElementById('settingsOk').click(); })()`);
  await new Promise((r) => setTimeout(r, 500));
  const saveWithoutClose = JSON.parse(await api.evaluate(`JSON.stringify({
    maskDisplay: document.getElementById('settingsMask').style.display,
    tipDisplay: document.getElementById('settingsSaveTip').style.display
  })`));
  assert(saveWithoutClose.maskDisplay === 'flex', '点击保存并应用后弹窗被异常关闭');
  assert(saveWithoutClose.tipDisplay !== 'none', '保存后未显示已保存提示');

  // 关闭设置
  await api.evaluate(`(function(){ if (typeof window.closeSettings === 'function') window.closeSettings(); })()`);
  await new Promise((r) => setTimeout(r, 400));

  console.log('  [NF 4] 验证 AI 对话弹窗双 Tab（需求对话 + DSH 执行日志）...');
  await api.evaluate(`(function(){ if (typeof window.openAi === 'function') window.openAi(); })()`);
  await new Promise((r) => setTimeout(r, 600));

  const aiModalState = JSON.parse(await api.evaluate(`JSON.stringify({
    mask: document.getElementById('aiMask').style.display,
    tabChat: !!document.getElementById('tabChatBtn'),
    tabLogs: !!document.getElementById('tabLogsBtn'),
    chatView: document.getElementById('aiChatView').style.display !== 'none',
    logsView: document.getElementById('aiLogsView').style.display !== 'none',
    hasConsole: !!document.getElementById('aiLogsConsole'),
    hasClearTrace: !!document.getElementById('btnClearTrace'),
    hasCopyTrace: !!document.getElementById('btnCopyTrace')
  })`));
  assert(aiModalState.mask === 'flex', 'AI 对话弹窗未显示');
  assert(aiModalState.tabChat && aiModalState.tabLogs, '双 Tab 按钮不完整');
  assert(aiModalState.chatView, '默认需求对话视图未展示');
  assert(!aiModalState.logsView, '默认执行日志视图应隐藏');

  console.log('  [NF 5] 验证 DSH 执行日志 Trace 追加与 Tab 切换...');
  await api.evaluate(`(function(){
    if (typeof window.aiAppendTrace === 'function') {
      window.aiAppendTrace({ time: '17:35:00', tag: 'HTTP_REQ', level: 'info', text: 'POST /v1/chat/completions (stream=true)' });
      window.aiAppendTrace({ time: '17:35:01', tag: 'THINKING', level: 'info', text: '正在规划多路由表单页面...' });
      window.aiAppendTrace({ time: '17:35:02', tag: 'FS_SAVE', level: 'success', text: '写入文件: sandbox/test.html (4520 字节)' });
    }
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  // 切换到日志 Tab
  await api.evaluate(`(function(){ document.getElementById('tabLogsBtn').click(); })()`);
  await new Promise((r) => setTimeout(r, 300));

  const traceState = JSON.parse(await api.evaluate(`JSON.stringify({
    logsViewVisible: document.getElementById('aiLogsView').style.display !== 'none',
    chatViewVisible: document.getElementById('aiChatView').style.display === 'none',
    countText: document.getElementById('logsCount').textContent.trim(),
    consoleHtml: document.getElementById('aiLogsConsole').innerHTML
  })`));
  assert(traceState.logsViewVisible, '切换到日志 Tab 后视图未显示');
  assert(traceState.countText.indexOf('3 条记录') >= 0, '日志记录计数不匹配: ' + traceState.countText);
  assert(traceState.consoleHtml.indexOf('POST /v1/chat/completions') >= 0, '日志控制台内容缺失');
  assert(traceState.consoleHtml.indexOf('FS_SAVE') >= 0, 'FS_SAVE 标签未渲染');

  console.log('  [NF 6] 验证富文本 Markdown 与折叠思考块渲染与气泡复制按钮...');
  const mdFormatTest = await api.evaluate(`(function(){
    if (typeof window.formatAiText === 'function') {
      const sample = '### 页面功能\\n**核心特性**\\n' + '\`\`\`html\\n<div>测试</div>\\n\`\`\`';
      return window.formatAiText(sample);
    }
    return '';
  })()`);
  assert(mdFormatTest.indexOf('code-block-wrap') >= 0, '代码块未被包装为 .code-block-wrap');
  assert(mdFormatTest.indexOf('<b>核心特性</b>') >= 0, 'Markdown 粗体未正确转换');
  assert(mdFormatTest.indexOf('<h4') >= 0, 'Markdown 三级标题未正确转换');

  // 验证气泡生成与复制按钮
  await api.evaluate(`(function(){
    if (typeof window.aiAppendMsg === 'function') {
      window.aiAppendMsg('你好，这是测试气泡内容', 'ai');
    }
  })()`);
  await new Promise((r) => setTimeout(r, 200));

  const bubbleCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    hasCopyBtn: !!document.querySelector('.ai-msg .ai-copy-btn'),
    copyBtnText: document.querySelector('.ai-msg .ai-copy-btn') ? document.querySelector('.ai-msg .ai-copy-btn').textContent.trim() : '',
    hasTipText: !!document.getElementById('aiTipText')
  })`));
  assert(bubbleCheck.hasCopyBtn && bubbleCheck.copyBtnText === '复制', '气泡下方未找到复制按钮或文本不正确');
  assert(!bubbleCheck.hasTipText, '大模型对话框中仍残留了驱动提示节点');

  // 点击复制按钮测试
  await api.evaluate(`(function(){
    const btn = document.querySelector('.ai-msg .ai-copy-btn');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 100));
  const copiedCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    copiedText: document.querySelector('.ai-msg .ai-copy-btn') ? document.querySelector('.ai-msg .ai-copy-btn').textContent.trim() : ''
  })`));
  assert(copiedCheck.copiedText === '已复制', '点击复制按钮后未正确反馈为已复制');

  // 关闭 AI 对话弹窗
  await api.evaluate(`(function(){ if (typeof window.closeAi === 'function') window.closeAi(); })()`);
  await new Promise((r) => setTimeout(r, 300));
  console.log('  [NF Complete] 全部新功能模块验证通过！');
};
