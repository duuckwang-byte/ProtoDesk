/* [js/git-ui/git-domain.js] Wave-D/G Git协作域（经典脚本，SoC分层）
 * 来源：js/project-ai-export.js executeGitPush(1107-1170式DOM+校验+IPC+定时混杂) 拆分。
 * 分层（经 Store/EventBus 通信，禁止 DOM+IPC+定时同函数）：
 *  - GitPushValidation（纯函数，无DOM/IPC/定时）：validate(branch, files)
 *  - GitPushService（仅IPC，无DOM）：push(api, payload)
 *  - GitPushUI（仅DOM Via 传入 el 句柄，无IPC）：collectChecked/collectBranch/setBusy/renderOk/renderErr/scheduleClose
 *  - GitDomain.executeGitPush(ctx)（编排，经 Store 取 project，bus 抛 git:push-* 事件）
 * 常量：GIT_PUSH_CLOSE_DELAY_MS 替代 1600 硬编码。
 * 兼容：project-ai-export.js 保留 function executeGitPush thin delegate（门禁 git-security 仍见 executeGitPush(true) 调用）。
 */
var GitDomain = (function () {
  'use strict';
  var GIT_PUSH_CLOSE_DELAY_MS = 1600;

  function storeProject(fallback) {
    try {
      if (typeof window !== 'undefined' && window.Store && typeof window.Store.getState === 'function') {
        var s = window.Store.getState();
        if (s && s.project) return String(s.project);
      }
    } catch (e) {}
    try { if (typeof currentProject !== 'undefined' && currentProject) return String(currentProject); } catch (e) {}
    try { if (typeof window !== 'undefined' && window.currentProject) return String(window.currentProject); } catch (e) {}
    return String(fallback || '');
  }
  function emit(type, payload) {
    try {
      if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.emit === 'function') { window.EventBus.emit(type, payload); return; }
    } catch (e) {}
    try {
      if (typeof _paeBus !== 'undefined' && _paeBus && typeof _paeBus.emit === 'function') { _paeBus.emit(type, payload); return; }
    } catch (e) {}
  }
  function toast(msg) {
    try { if (typeof showToast === 'function') { showToast(msg); return; } } catch (e) {}
    try { if (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) { window.Utils.showToast(msg); return; } } catch (e) {}
  }

  /* ---- Validation（纯） ---- */
  var GitPushValidation = {
    validate: function (branch, files, helpers) {
      var h = helpers || {};
      var fns = {
        branchMsg: h.branchMsg || ((typeof gitBranchRuleMsg === 'function') ? gitBranchRuleMsg : function () { return ''; }),
        foreign: h.foreign || ((typeof gitForeignProjects === 'function') ? gitForeignProjects : function () { return []; })
      };
      var list = Array.isArray(files) ? files : [];
      if (!list.length) return { ok: false, code: 'EMPTY', title: '尚未勾选文件', body: '请至少勾选一个需要发布的文件。' };
      var bMsg = '';
      try { bMsg = fns.branchMsg(branch); } catch (e) { bMsg = ''; }
      if (bMsg) return { ok: false, code: 'INVALID_BRANCH', title: '分支名不合法', body: String(bMsg) };
      var foreign = [];
      try { foreign = fns.foreign(list) || []; } catch (e) { foreign = []; }
      return { ok: true, code: '', foreign: foreign };
    }
  };

  /* ---- Service（仅IPC） ---- */
  var GitPushService = {
    push: function (api, payload) {
      var a = api || ((typeof window !== 'undefined' && window.protoAPI && window.protoAPI.git) || null);
      if (!a || typeof a.push !== 'function') return Promise.resolve({ ok: false, code: 'NO_API', error: '仅桌面端支持 Git 协同' });
      try { return Promise.resolve(a.push(payload)); } catch (e) { return Promise.resolve({ ok: false, code: 'THROW', error: String((e && e.message) || e) }); }
    }
  };

  /* ---- UI（仅DOM Via 句柄） ---- */
  var GitPushUI = {
    collectChecked: function (treeList, collectFn) {
      try {
        if (typeof collectFn === 'function') return collectFn(treeList) || [];
        if (typeof gitCollectChecked === 'function') return gitCollectChecked(treeList) || [];
      } catch (e) {}
      return [];
    },
    setBusy: function (els, busy, text) {
      try {
        if (els && els.submit) { els.submit.disabled = !!busy; if (text) els.submit.textContent = text; }
        if (els && els.force) els.force.disabled = !!busy;
      } catch (e) {}
    },
    renderOk: function (els, msg) {
      try {
        if (els && els.status) { els.status.className = 'git-status-msg ok'; els.status.textContent = String(msg || ''); els.status.style.display = 'block'; }
      } catch (e) {}
    },
    renderErr: function (els, msg) {
      try {
        if (els && els.status) { els.status.className = 'git-status-msg err'; els.status.textContent = String(msg || ''); els.status.style.display = 'block'; }
      } catch (e) {}
    },
    scheduleClose: function (closeFn, delay) {
      var ms = (typeof delay === 'number') ? delay : GIT_PUSH_CLOSE_DELAY_MS;
      try { setTimeout(function () { try { closeFn(); } catch (e) {} }, ms); } catch (e) {}
    }
  };

  /* ---- Orchestrator（编排，无裸DOM/IPC细节） ---- */
  function executeGitPush(ctx) {
    ctx = (ctx && typeof ctx === 'object') ? ctx : {};
    var force = !!ctx.force;
    var project = storeProject(ctx.project);
    if (!project) return;
    var api = ctx.api || ((typeof window !== 'undefined' && window.protoAPI && window.protoAPI.git) || null);
    if (!api) { try { toast('仅桌面端支持 Git 协同'); } catch (e) {} return; }
    var files = ctx.files || GitPushUI.collectChecked(ctx.treeList, ctx.collectChecked);
    var branch = (ctx.branch !== undefined) ? ctx.branch : ((typeof getActiveBranch === 'function' && ctx.branchSelect) ? getActiveBranch(ctx.branchSelect, ctx.branchCustom) : '');
    var message = (ctx.message !== undefined) ? ctx.message : '更新原型与文档数据';
    var v = GitPushValidation.validate(branch, files, ctx.helpers);
    if (!v.ok) {
      try {
        if (typeof showGitError === 'function') showGitError({ title: v.title, body: v.body, detail: v.code, primaryText: '知道了', primaryFn: function () {} });
        else toast(v.title + '：' + v.body);
      } catch (e) {}
      try { emit('git:push-validated', { ok: false, code: v.code, branch: branch }); } catch (e2) {}
      return;
    }
    if (!force && v.foreign && v.foreign.length && typeof ctx.onCrossProject === 'function') {
      try { ctx.onCrossProject({ files: files, message: message, branch: branch, foreign: v.foreign }); } catch (e) {}
      return;
    }
    try { GitPushUI.setBusy(ctx.els, true, force ? '强制覆盖中…' : '上传中…'); } catch (e) {}
    try { emit('git:push-start', { branch: branch, count: files.length, force: force }); } catch (e2) {}
    GitPushService.push(api, { project: project, files: files, message: message, branch: branch, force: force }).then(function (r) {
      if (r && r.ok) {
        try { if (ctx.els && ctx.els.force) ctx.els.force.style.display = 'none'; } catch (e) {}
        GitPushUI.renderOk(ctx.els, (force ? '强制覆盖发布成功！' : '发布成功！') + '已上传 ' + (r.filesCount || files.length) + ' 个文件至分支 [' + (r.branch || branch) + ']。' + (force ? '远端历史已被改写。' : ''));
        try { emit('git:push-ok', { branch: (r.branch || branch), count: (r.filesCount || files.length) }); } catch (e2) {}
        try { if (typeof ctx.refreshList === 'function') ctx.refreshList(r.branch || branch); } catch (e3) {}
        /* 成功后不再自动关窗：列表就地刷新为空即是凭证，用户手动关闭 */
      } else if (r && r.code === 'NEED_HEAL') {
        try { GitPushUI.setBusy(ctx.els, false, '确认上传'); } catch (e) {}
        try { if (typeof ctx.onNeedHeal === 'function') ctx.onNeedHeal(r, function () { executeGitPush(ctx); }); } catch (e2) {}
      } else if (r && r.code === 'NEED_CONFIG') {
        try { GitPushUI.setBusy(ctx.els, false, '确认上传'); } catch (e2) {}
        try { if (typeof ctx.onNeedConfig === 'function') ctx.onNeedConfig(); } catch (e3) {}
      } else {
        try { GitPushUI.setBusy(ctx.els, false, '重试上传'); } catch (e) {}
        var info = { title: '发布失败', body: String((r && r.error) || '') };
        try { if (typeof gitErrorInfo === 'function') info = gitErrorInfo((r && r.code) || '', String((r && r.error) || '')); } catch (e2) {}
        /* 详情必须可见：未知错误也带原文（截断），否则用户无法定位 */
        var detailTxt = '';
        try { detailTxt = String((r && r.error) || '').trim().slice(0, 200); } catch (e3) {}
        GitPushUI.renderErr(ctx.els, info.title + '：' + info.body + (detailTxt ? '（详情：' + detailTxt + '）' : ''));
        try { emit('git:push-err', { code: (r && r.code) || '', title: info.title }); } catch (e3) {}
        try { if (typeof ctx.onRoutableError === 'function') ctx.onRoutableError(r, info); } catch (e4) {}
      }
    }).catch(function (err) {
      try { GitPushUI.setBusy(ctx.els, false, '重试上传'); } catch (e) {}
      var info2 = { title: '发布失败', body: String((err && err.message) || err) };
      try { if (typeof gitErrorInfo === 'function') info2 = gitErrorInfo('', String((err && err.message) || err)); } catch (e2) {}
      var detailTxt2 = '';
      try { detailTxt2 = String((err && err.message) || err || '').trim().slice(0, 200); } catch (e3) {}
      GitPushUI.renderErr(ctx.els, info2.title + '：' + info2.body + (detailTxt2 ? '（详情：' + detailTxt2 + '）' : ''));
    });
  }

  function executeGitPushWithForeign(ctx) {
    ctx = (ctx && typeof ctx === 'object') ? ctx : {};
    var project = storeProject(ctx.project);
    var api = ctx.api || ((typeof window !== 'undefined' && window.protoAPI && window.protoAPI.git) || null);
    if (!api || !project) return;
    var files = ctx.files || [];
    try { GitPushUI.setBusy(ctx.els, true, '上传中…'); } catch (e) {}
    GitPushService.push(api, { project: project, files: files, message: (ctx.message || '更新原型与文档数据'), branch: ctx.branch, force: false }).then(function (r) {
      if (r && r.ok) {
        try { if (ctx.els && ctx.els.force) ctx.els.force.style.display = 'none'; } catch (e) {}
        GitPushUI.renderOk(ctx.els, '发布成功！已上传 ' + (r.filesCount || files.length) + ' 个文件至分支 [' + (r.branch || ctx.branch) + ']。');
        try { if (typeof ctx.refreshList === 'function') ctx.refreshList(r.branch || ctx.branch); } catch (e2) {}
        /* 成功后不再自动关窗：列表就地刷新为空即是凭证，用户手动关闭 */
      } else if (r && r.code === 'NEED_HEAL') {
        try { GitPushUI.setBusy(ctx.els, false, '确认上传'); } catch (e) {}
        try { if (typeof ctx.onNeedHeal === 'function') ctx.onNeedHeal(r, function () { executeGitPushWithForeign(ctx); }); } catch (e2) {}
      } else {
        try { GitPushUI.setBusy(ctx.els, false, '重试上传'); } catch (e) {}
        var info = { title: '发布失败', body: String((r && r.error) || '') };
        try { if (typeof gitErrorInfo === 'function') info = gitErrorInfo((r && r.code) || '', (r && r.error) || ''); } catch (e2) {}
        GitPushUI.renderErr(ctx.els, info.title + '：' + info.body);
      }
    }).catch(function (err) {
      try { GitPushUI.setBusy(ctx.els, false, '重试上传'); } catch (e) {}
      try { GitPushUI.renderErr(ctx.els, String((err && err.message) || err)); } catch (e2) {}
    });
  }

  return {
    GIT_PUSH_CLOSE_DELAY_MS: GIT_PUSH_CLOSE_DELAY_MS,
    Validation: GitPushValidation,
    Service: GitPushService,
    UI: GitPushUI,
    executeGitPush: executeGitPush,
    executeGitPushWithForeign: executeGitPushWithForeign
  };
})();
try { if (typeof window !== 'undefined' && !window.GitDomain) window.GitDomain = GitDomain; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = GitDomain; } catch (e) {}
