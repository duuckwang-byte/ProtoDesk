/* [js/ai/ai-domain.js] Wave-D/G AI会话域（经典脚本，SoC分层）
 * 来源：js/project-ai-export.js newPrototype(alert+魔法延迟260) 与 closeAi 分离。
 * 分层（经 Store/EventBus，无 alert/魔法数字裸写）：
 *  - PrototypeValidation.validateName(nm) 纯函数 → {ok, error}（替代 alert 校验）
 *  - PrototypeService.create(api, {name,kind,project}) 仅IPC
 *  - AiDialog.requestClose() 经 EventBus ai:request-close（替代 window.closeAi 直调裸挂）
 * 常量：PROTOTYPE_OPEN_DELAY_MS 替代 setTimeout(openAi,260)。
 * 兼容：project-ai-export.js 保留 function newPrototype/closeAi thin delegate。
 */
var AiDomain = (function () {
  'use strict';
  var PROTOTYPE_OPEN_DELAY_MS = 260;
  var PROTOTYPE_NAME_MAX = 60;
  var PROTOTYPE_NAME_BAD = /[\\\/:*?"<>|]|\.\./;

  function emit(type, payload) {
    try {
      if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.emit === 'function') { window.EventBus.emit(type, payload); return 0; }
    } catch (e) {}
    try {
      if (typeof _paeBus !== 'undefined' && _paeBus && typeof _paeBus.emit === 'function') return _paeBus.emit(type, payload);
    } catch (e) {}
    return 0;
  }
  function toast(msg) {
    try { if (typeof showToast === 'function') { showToast(msg); return; } } catch (e) {}
    try { if (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) { window.Utils.showToast(msg); return; } } catch (e) {}
  }
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

  var PrototypeValidation = {
    validateName: function (nm) {
      var s = String(nm == null ? '' : nm).trim();
      if (!s) return { ok: false, code: 'EMPTY', error: '名称不能为空。' };
      if (PROTOTYPE_NAME_BAD.test(s)) return { ok: false, code: 'ILLEGAL', error: '名称含非法字符（不能含 \\ / : * ? " < > |）。' };
      if (s.length > PROTOTYPE_NAME_MAX) return { ok: false, code: 'TOO_LONG', error: '名称过长（≤60字）。' };
      return { ok: true, code: '', name: s };
    }
  };

  var PrototypeService = {
    create: function (api, opts) {
      var a = api || ((typeof window !== 'undefined' && window.protoAPI && window.protoAPI.sandbox) || null);
      if (!a || typeof a.create !== 'function') return Promise.resolve({ ok: false, code: 'NO_API', error: '新建原型仅桌面端（exe）可用。' });
      var o = (opts && typeof opts === 'object') ? opts : {};
      try { return Promise.resolve(a.create({ name: o.name, kind: o.kind, project: o.project })); }
      catch (e) { return Promise.resolve({ ok: false, code: 'THROW', error: String((e && e.message) || e) }); }
    }
  };

  function reportValidationError(v) {
    /* SoC修复：alert → 非阻塞 toast + EventBus（可测试、无模态阻塞） */
    try { toast(v.error); } catch (e) {}
    try { emit('ai:prototype-invalid', { code: v.code, error: v.error }); } catch (e2) {}
  }

  function newPrototypeDomain(kind, ctx) {
    ctx = (ctx && typeof ctx === 'object') ? ctx : {};
    var api = ctx.api || ((typeof window !== 'undefined' && window.protoAPI && window.protoAPI.sandbox) || null);
    if (!api) { reportValidationError({ ok: false, code: 'NO_API', error: '新建原型仅桌面端（exe）可用。' }); return; }
    var label = (kind === 'pc') ? 'PC 端' : '移动端';
    function ask() {
      try {
        if (typeof askNamePrompt === 'function') {
          askNamePrompt({
            title: '新建' + label + '原型', label: '原型名称',
            hint: '将创建独立文件夹沙箱（含空 html 与 md），并自动打开大模型对话。', value: ''
          }, onName);
          return;
        }
      } catch (e) {}
      try { toast('名称输入弹窗不可用。'); } catch (e2) {}
    }
    function onName(nm) {
      if (nm == null || nm === '') return;
      var v = PrototypeValidation.validateName(nm);
      if (!v.ok) { reportValidationError(v); return; }
      var project = storeProject(ctx.project);
      PrototypeService.create(api, { name: v.name, kind: kind, project: project }).then(function (r) {
        if (r && r.ok) {
          try { if (typeof libStatus === 'function') libStatus('已创建' + label + '原型沙箱：' + v.name + '（生成的文件将写入该文件夹）。'); } catch (e) {}
          try { if (typeof loadSandboxSources === 'function') loadSandboxSources(v.name, true); } catch (e2) {}
          try { emit('ai:prototype-created', { name: v.name, kind: kind, project: project }); } catch (e3) {}
          var hasAi = false;
          try { hasAi = !!ctx.hasAi; } catch (e) {}
          try { if (typeof HAS_AI !== 'undefined') hasAi = hasAi || !!HAS_AI; } catch (e4) {}
          if (hasAi) {
            try {
              var openFn = ctx.openAi || ((typeof openAi === 'function') ? openAi : null);
              if (typeof openFn === 'function') setTimeout(function () { try { openFn(); } catch (e) {} }, PROTOTYPE_OPEN_DELAY_MS);
            } catch (e5) {}
          }
        } else {
          try {
            if (typeof reportError === 'function') reportError('proto-create', new Error((r && r.error) || '未知错误'), '创建失败：' + ((r && r.error) || '未知错误'));
            else toast('创建失败：' + ((r && r.error) || '未知错误'));
          } catch (e) {}
        }
      });
    }
    ask();
  }

  function requestAiClose(reason) {
    var guarded = false;
    try {
      if (typeof window !== 'undefined' && window.__aiWinCloseGuard) {
        try { if (typeof isAiWinMode === 'function' && isAiWinMode()) guarded = true; } catch (e) {}
        try { if (window.isAiWinMode && window.isAiWinMode()) guarded = true; } catch (e2) {}
      }
    } catch (e3) {}
    if (guarded) return { closed: false, reason: 'aiwin-guarded' };
    try { emit('ai:request-close', { reason: reason || 'user' }); } catch (e) {}
    try { if (window.MaskStack) window.MaskStack.pop('aiMask'); } catch (e2) {}
    try { var m = (typeof aiMaskEl !== 'undefined') ? aiMaskEl : ((typeof document !== 'undefined') ? document.getElementById('aiMask') : null); if (m) m.style.display = 'none'; } catch (e3) {}
    try { if (typeof sweepStrayMasks === 'function') sweepStrayMasks(); } catch (e4) {}
    try { emit('ai:closed', { reason: reason || 'user' }); } catch (e5) {}
    return { closed: true, reason: reason || 'user' };
  }

  return {
    PROTOTYPE_OPEN_DELAY_MS: PROTOTYPE_OPEN_DELAY_MS,
    PROTOTYPE_NAME_MAX: PROTOTYPE_NAME_MAX,
    Validation: PrototypeValidation,
    Service: PrototypeService,
    newPrototype: newPrototypeDomain,
    requestClose: requestAiClose
  };
})();
try { if (typeof window !== 'undefined' && !window.AiDomain) window.AiDomain = AiDomain; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = AiDomain; } catch (e) {}
