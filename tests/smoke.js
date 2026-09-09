/* 快速冒烟：验证模块核心（图标系统 / 主题切换 / 4 Tab 设置 / 导出链路 / 页面加载）
   不跑全量 9 用例，只做关键断言，速度快、带超时保护。 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { connect } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const child = spawn(exe, ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'],
  { cwd: ROOT, windowsHide: true, stdio: 'ignore' });

async function main() {
  let api = null;
  try {
    await sleep(3000);
    api = await connect({ port: PORT, waitMs: 20000 });
    await sleep(1500); /* 等项目选择弹窗渲染 */
    await api.evaluate(`(function(){
      var btn = document.getElementById('projOk');
      if (btn) btn.click();
    })()`);
    await sleep(600);
    const r = await api.evaluate(`(async function(){
      var out = {};
      /* 1. 图标系统 */
      out.hasPlanBIcon = typeof window.PlanBIcon === 'function';
      out.iconSvg = (typeof window.PlanBIcon === 'function') ? (window.PlanBIcon('folder', 14) || '').indexOf('<svg') >= 0 : false;
      out.icReplaced = document.querySelectorAll('[data-ic] svg').length > 0;
      /* 2. 主题已剥离：应无data-theme、无applyTheme */
      out.themeAttr = document.documentElement.getAttribute('data-theme');
      out.hasApplyTheme = (typeof applyTheme === 'function');
      /* 3. 核心函数存在（测试约束） */
      out.fns = {
        setSbOpen: typeof setSbOpen === 'function',
        setKind: typeof setKind === 'function',
        extractElementText: typeof extractElementText === 'function',
        buildExportHtml: typeof buildExportHtml === 'function',
        editQueueAdd: typeof editQueueAdd === 'function',
        fitPhone: typeof fitPhone === 'function'
      };
      /* 4. 布局约束（测试断言） */
      out.sbBase = document.querySelector('.sb') ? document.querySelector('.sb').offsetWidth : -1;
      setSbOpen(true);
      await new Promise(function(r2){ setTimeout(r2, 300); });
      out.sbOpen = document.querySelector('.sb') ? document.querySelector('.sb').offsetWidth : -1;
      setSbOpen(false);
      await new Promise(function(r2){ setTimeout(r2, 300); });
      out.sbClosed = document.querySelector('.sb') ? document.querySelector('.sb').offsetWidth : -1;
      /* 5. 检查器卡片结构（测试断言） */
      out.liJump = !!document.querySelector('.li-card.jump-card');
      out.liReq = !!document.querySelector('.li-card.req-card');
      out.liAnno = !!document.querySelector('.li-card.anno-card');
      out.liDivider = !!document.querySelector('.li-divider');
      /* 6. 设置面板无主题 radio + 4 Tab */
      out.themeRadio = !!document.getElementById('themeAuto') || !!document.getElementById('themeDark');
      out.settingsTabs = !!document.getElementById('tabNavAi') && !!document.getElementById('tabNavModels') && !!document.getElementById('tabNavSandbox') && !!document.getElementById('tabNavAbout');
      out.settingsPanes = !!document.getElementById('paneSetAi') && !!document.getElementById('paneSetModels') && !!document.getElementById('paneSetSandbox') && !!document.getElementById('paneSetAbout');
      /* 7. 导出链路（含 icons.js 内嵌） */
      if (typeof buildExportHtml === 'function' && window.sources && window.sources.length) {
        try {
          var html = await buildExportHtml([window.sources[0]]);
          out.exportOk = !!html;
          out.exportHasIcons = !!html && html.indexOf('database') < 0 && /PlanBIcon[\s\S]{0,400}window\.PlanBIcon/.test(html || '');
          out.exportHasIcs = !!html && (html.indexOf('js/icons.js') >= 0 || html.indexOf('PlanBIcon') >= 0);
        } catch (e) { out.exportOk = 'ERR:' + e.message; out.exportHasIcs = false; }
      } else { out.exportOk = 'SKIP(no sources)'; out.exportHasIcs = 'SKIP'; }
      return JSON.stringify(out);
    })()`);
    console.log('SMOKE_RESULT', r);
    const o = JSON.parse(r);
    const fails = [];
    if (!o.hasPlanBIcon) fails.push('PlanBIcon 缺失');
    if (!o.iconSvg) fails.push('iconSvg 生成失败');
    if (!o.icReplaced) fails.push('data-ic 未被替换');
    if (o.themeAttr) fails.push('主题未剥离: data-theme残留:' + o.themeAttr);
    if (o.hasApplyTheme) fails.push('主题未剥离: applyTheme残留');
    if (!o.fns.setSbOpen || !o.fns.setKind || !o.fns.extractElementText || !o.fns.buildExportHtml || !o.fns.editQueueAdd || !o.fns.fitPhone) fails.push('核心函数缺失');
    if (o.sbOpen < 200) fails.push('侧栏展开宽度不足: ' + o.sbOpen);
    if (o.sbClosed !== 0) fails.push('侧栏收起应为 0: ' + o.sbClosed);
    if (!o.liJump || !o.liReq || !o.liAnno || !o.liDivider) fails.push('检查器卡片结构缺失');
    if (o.themeRadio) fails.push('主题未剥离: theme radio残留');
    if (!o.settingsTabs || !o.settingsPanes) fails.push('4 Tab 设置面板结构缺失');
    if (!o.exportOk || String(o.exportOk).indexOf('ERR') === 0) fails.push('导出失败: ' + o.exportOk);
    if (o.exportHasIcs !== true && o.exportHasIcs !== 'SKIP') fails.push('导出未含 icons.js: ' + o.exportHasIcs);
    console.log(fails.length ? 'SMOKE_FAIL: ' + fails.join(' | ') : 'SMOKE_PASS: 全部关键断言通过');
    if (fails.length) process.exitCode = 1;
  } catch (e) {
    console.log('SMOKE_FATAL', (e && e.message) || e);
    process.exitCode = 2;
  } finally {
    if (api) api.close();
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch (e) {}
  }
}
main().then(() => process.exit(process.exitCode || 0));
setTimeout(function(){ console.log('SMOKE_TIMEOUT'); process.exit(3); }, 90000).unref();
