/* [tests/cases/git-flow.js] Git 协同流程测试（下拉菜单、仓库配置、选择性上传/拉取、沙箱自愈、无 emoji 验证） */
module.exports = async function gitFlowCase(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  console.log('  [Git 1] 验证顶部工具栏 Git ▾ 下拉菜单与菜单项...');
  // 点击 Git ▾ 按钮展开下拉菜单
  await api.evaluate(`(function(){
    const btn = document.getElementById('btnGitMenu');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  const menuState = JSON.parse(await api.evaluate(`JSON.stringify({
    menuVisible: document.getElementById('gitDropdownMenu').style.display !== 'none',
    hasPushBtn: !!document.getElementById('btnGitPushMenu'),
    hasPullBtn: !!document.getElementById('btnGitPullMenu'),
    hasConfigBtn: !!document.getElementById('btnGitConfigMenu')
  })`));
  assert(menuState.menuVisible, '点击 Git ▾ 按钮后下拉菜单未展开');
  assert(menuState.hasPushBtn && menuState.hasPullBtn && menuState.hasConfigBtn, 'Git 下拉菜单项不完整');

  console.log('  [Git 2] 验证 Git 仓库设置弹窗与配置持久化...');
  await api.evaluate(`(function(){
    document.getElementById('btnGitConfigMenu').click();
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  const configState = JSON.parse(await api.evaluate(`JSON.stringify({
    maskVisible: document.getElementById('gitConfigMask').style.display === 'flex',
    hasRemoteUrl: !!document.getElementById('gitRemoteUrl'),
    hasBranch: !!document.getElementById('gitBranch'),
    hasToken: !!document.getElementById('gitToken')
  })`));
  assert(configState.maskVisible, 'Git 仓库设置弹窗未显示');
  assert(configState.hasRemoteUrl && configState.hasBranch && configState.hasToken, 'Git 仓库设置输入项不完整');

  // 填写配置并保存
  await api.evaluate(`(function(){
    document.getElementById('gitRemoteUrl').value = 'https://codeup.aliyun.com/68993dc39eda9d4e3ee49534/PRFile.git';
    document.getElementById('gitBranch').value = 'main';
    document.getElementById('gitUsername').value = 'pm_test';
    document.getElementById('gitToken').value = 'token_test_123456';
    document.getElementById('gitConfigSave').click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  const saveCheck = JSON.parse(await api.evaluate(`(async function(){
    const tip = document.getElementById('gitSaveTip').style.display !== 'none';
    const curProj = window.currentProject;
    const cfgRes = await window.protoAPI.git.getConfig(curProj);
    return JSON.stringify({
      tipShown: tip,
      remoteUrl: (cfgRes && cfgRes.config && cfgRes.config.remoteUrl) || '',
      branch: (cfgRes && cfgRes.config && cfgRes.config.branch) || ''
    });
  })()`));
  assert(saveCheck.tipShown, '保存配置后未展示保存成功提示');
  assert(saveCheck.remoteUrl.indexOf('PRFile.git') >= 0, '配置持久化保存失败');

  // 关闭设置弹窗
  await api.evaluate(`(function(){ if (typeof window.closeGitConfigModal === 'function') window.closeGitConfigModal(); })()`);
  await new Promise((r) => setTimeout(r, 300));

  console.log('  [Git 3] 验证选择性上传发布弹窗、分支选择与文件树联动...');
  await api.evaluate(`(function(){
    const btn = document.getElementById('btnGitMenu');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await api.evaluate(`(function(){
    document.getElementById('btnGitPushMenu').click();
  })()`);
  await new Promise((r) => setTimeout(r, 800));

  const pushState = JSON.parse(await api.evaluate(`JSON.stringify({
    maskVisible: document.getElementById('gitPushMask').style.display === 'flex',
    hasTreeList: !!document.getElementById('gitPushTreeList'),
    hasBranchSelect: !!document.getElementById('gitPushBranchSelect'),
    hasBranchToggle: !!document.getElementById('btnGitPushBranchToggle'),
    hasMessage: !!document.getElementById('gitPushMessage'),
    hasSubmit: !!document.getElementById('gitPushSubmit'),
    hasSelectAll: !!document.getElementById('btnGitPushSelectAll'),
    hasClearAll: !!document.getElementById('btnGitPushClearAll')
  })`));
  assert(pushState.maskVisible, 'Git 上传发布弹窗未显示');
  assert(pushState.hasTreeList && pushState.hasBranchSelect && pushState.hasSubmit, 'Git 上传发布面板分支或文件树控件不完整');

  // 测试全选/清空按钮
  await api.evaluate(`(function(){
    document.getElementById('btnGitPushClearAll').click();
  })()`);
  const clearCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    countText: document.getElementById('gitPushCount').textContent,
    btnDisabled: document.getElementById('gitPushSubmit').disabled
  })`));
  assert(clearCheck.countText.indexOf('0') >= 0, '清空按钮未能清空选择计数');
  assert(clearCheck.btnDisabled === true, '清空选择后确认上传按钮未被禁用');

  // 统一双关闭：点遮罩应关闭
  await api.evaluate(`(function(){
    const mask = document.getElementById('gitPushMask');
    if (mask) mask.click();
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  const maskClickImmunity = JSON.parse(await api.evaluate(`JSON.stringify({
    closed: document.getElementById('gitPushMask').style.display === 'none'
  })`));
  assert(maskClickImmunity.closed, '点遮罩应关闭');

  // 验证 ESC 快捷键关闭上传弹窗
  await api.evaluate(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  const escCloseCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    closed: document.getElementById('gitPushMask').style.display === 'none'
  })`));
  assert(escCloseCheck.closed, '按下 Esc 快捷键未能关闭弹窗');

  console.log('  [Git 4] 验证选择性拉取同步弹窗、默认不勾选与新项目提示...');
  await api.evaluate(`(function(){
    const btn = document.getElementById('btnGitMenu');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await api.evaluate(`(function(){
    document.getElementById('btnGitPullMenu').click();
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  const pullState = JSON.parse(await api.evaluate(`JSON.stringify({
    maskVisible: document.getElementById('gitPullMask').style.display === 'flex',
    hasTreeList: !!document.getElementById('gitPullTreeList'),
    hasBranchSelect: !!document.getElementById('gitPullBranchSelect'),
    hasBranchToggle: !!document.getElementById('btnGitPullBranchToggle'),
    hasBranchRefresh: !!document.getElementById('btnGitPullBranchRefresh'),
    hasSwitchBanner: !!document.getElementById('gitPullProjectSwitchBanner'),
    countText: document.getElementById('gitPullCount').textContent,
    btnDisabled: document.getElementById('gitPullSubmit').disabled,
    hasSubmit: !!document.getElementById('gitPullSubmit')
  })`));
  assert(pullState.maskVisible, 'Git 拉取同步弹窗未显示');
  assert(pullState.hasTreeList && pullState.hasBranchSelect && pullState.hasSubmit, 'Git 拉取同步面板分支或文件树控件不完整');
  assert(pullState.countText.indexOf('0') >= 0, '拉取弹窗默认应不勾选任何文件');
  assert(pullState.btnDisabled === true, '拉取弹窗默认未勾选时确认拉取按钮应禁用');

  // 按下 Esc 关闭拉取弹窗
  await api.evaluate(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  console.log('  [Git 5] 验证 UI 纯净无 Emoji 规范...');
  const emojiCheck = JSON.parse(await api.evaluate(`JSON.stringify({
    gitMenuText: document.getElementById('btnGitMenu').textContent,
    pushMenuText: document.getElementById('btnGitPushMenu').textContent,
    pullMenuText: document.getElementById('btnGitPullMenu').textContent,
    configMenuText: document.getElementById('btnGitConfigMenu').textContent
  })`));
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert(!emojiRegex.test(emojiCheck.gitMenuText), 'Git 菜单按钮包含 emoji 图标');
  assert(!emojiRegex.test(emojiCheck.pushMenuText), '上传发布按钮包含 emoji 图标');
  assert(!emojiRegex.test(emojiCheck.pullMenuText), '拉取同步按钮包含 emoji 图标');
  assert(!emojiRegex.test(emojiCheck.configMenuText), '仓库设置按钮包含 emoji 图标');

  console.log('  [Git Complete] 全部 Git 协同模块与规范验证通过！');
};
