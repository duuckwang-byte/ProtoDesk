/* [js/mask-manager.js] 统一遮罩栈 + 单一 Esc 监听（P1-7 双Esc/遮罩 I-02 P1-6联动 治理） - 增强版：17弹窗统一双关闭（点遮罩 + Esc）*/
/* Wave-C/F: 转标准 ESM (export MaskStack) + 经典兼容垫片; 内部 esc() 为遮罩栈顶关闭, 非 HTML 转义 (与 utils.esc 无关, 不导入以避名冲突) */
/* FIX: 经典<script>加载，禁用ESM export(浏览器会整文件罢工)，以window.MaskStack为准 */
var MaskStack = (function () {
  'use strict';
  var stack = [];
  var registry = {}; // maskId/panelId -> {maskId, panelId, closeFn, opts}
  // PC/移动端判定：PC 端 presence 由 body.kind-pc 标记；移动端为切换显示非悬浮，无遮罩且不响应 Esc
  function isPc() {
    try {
      if (document.body && document.body.classList.contains('kind-pc')) return true;
      if (typeof window.pcMode === 'function') { try { return !!window.pcMode(); } catch (e) {} }
      // 兼容兜底：PC 判定亦可通过视口宽度辅助（备用）
      if (window.innerWidth > 600 && document.body && document.body.classList.contains('kind-pc')) return true;
      return false;
    } catch (e) { return false; }
  }
  function push(id, closeFn, opts) {
    if (!id || typeof closeFn !== 'function') return;
    /* 任一弹窗/抽屉打开即收掉需求输入条（拾取条不与弹窗共存） */
    try{
      if(typeof CTRL_PICK!=='undefined'&&CTRL_PICK&&typeof CTRL_PICK.hideFab==='function')CTRL_PICK.hideFab();
    }catch(e){}
    // docsMask/reqMask 默认 pcOnly:true（移动端切换显示，不应入栈关闭）
    if (!opts && (id === 'docsMask' || id === 'reqMask' || id === 'docs' || id === 'req')) {
      opts = { pcOnly: true };
    }
    // 去重：若已存在先移除，再压栈置顶
    for (var i = stack.length - 1; i >= 0; i--) {
      if (stack[i].id === id) { stack.splice(i, 1); break; }
    }
    stack.push({ id: id, closeFn: closeFn, opts: opts || null });
  }
  function pop(id) {
    if (!id) return;
    for (var i = stack.length - 1; i >= 0; i--) {
      if (stack[i].id === id) {
        // 清理 onclick 残留，但须恢复 register 绑定的常驻处理器：
        // 旧逻辑直接置 null，导致二次打开后点遮罩失效（只剩 Esc）。现优先恢复注册态。
        try {
          var reg = registry[id] || registry[stack[i].id];
          var maskId = (reg && reg.maskId) ? reg.maskId : id;
          var el = document.getElementById(maskId) || document.getElementById(id);
          if (el) {
            if (reg && typeof reg._onClick === 'function') { try { el.onclick = reg._onClick; } catch (e0) {} }
            else { try { el.onclick = null; } catch (e0b) {} }
          }
          // 若 id 为逻辑面板名，尝试恢复对应 mask 的注册态
          var altMap = { 'linkInspector':'linkInspMask','linkMgr':'linkMgrMask','multiEdit':'multiEditMask','editDrawer':'editDrawerMask','annoMgr':'annoMgrMask','settings':'settingsMask','settingsMask':'settingsMask','export':'exportMask','exportMask':'exportMask','kind':'kindMask','kindMask':'kindMask','name':'nameMask','nameMask':'nameMask','proj':'projMask','projMask':'projMask','snap':'snapMask','snapMask':'snapMask','gitPush':'gitPushMask','gitPushMask':'gitPushMask','gitPull':'gitPullMask','gitPullMask':'gitPullMask','gitConfig':'gitConfigMask','gitConfigMask':'gitConfigMask','ai':'aiMask','aiMask':'aiMask','docsMask':'docsMask','reqMask':'reqMask' };
          var alt = altMap[id];
          if (alt) {
            var ae = document.getElementById(alt);
            var areg = registry[alt];
            if (ae) {
              if (areg && typeof areg._onClick === 'function') { try { ae.onclick = areg._onClick; } catch (e1) {} }
              else { try { ae.onclick = null; } catch (e1b) {} }
            }
          }
          if (reg && reg.maskId) { var me = document.getElementById(reg.maskId); if (me) { if (typeof reg._onClick === 'function') { try { me.onclick = reg._onClick; } catch (e2) {} } else { try { me.onclick = null; } catch (e2b) {} } } }
        } catch (e) {}
        stack.splice(i, 1); break;
      }
    }
  }
  function top() {
    return stack[stack.length - 1] || null;
  }
  function esc() {
    /* 拾取态优先：Esc 先退出 Ctrl 拾取/清空准星，不关闭弹窗；再按 Esc 才关栈顶 */
    try { if (window.CTRL_PICK && window.CTRL_PICK.holding && typeof window.__cancelCtrlPick === 'function') { window.__cancelCtrlPick(); return; } } catch (e) {}
    var t = top();
    if (!t) return;
    // 移动端例外：docsMask/reqMask 仅 PC 端响应 Esc
    if (t.opts && t.opts.pcOnly && !document.body.classList.contains('kind-pc')) return;
    if (t.opts && t.opts.pcOnly && !isPc()) return;
    try { var reg = registry[t.id]; if (reg && reg.opts && reg.opts.pcOnly && !document.body.classList.contains('kind-pc')) return; } catch (e) {}
    try { var reg2 = registry[t.id]; if (reg2 && reg2.opts && reg2.opts.pcOnly && !isPc()) return; } catch (e) {}
    // sbMask 为 Docked 占位应排除：若栈顶为 sbMask 直接忽略
    if (t.id === 'sbMask') return;
    if (t && typeof t.closeFn === 'function') {
      try { t.closeFn(); } catch (e) {}
    }
  }
  // 新增 register 辅助：自动绑定遮罩点击，支持 pcOnly 标记（docsMask/reqMask 在移动端不响应）
  function register(maskId, panelId, closeFn, opts) {
    if (!maskId || typeof closeFn !== 'function') return;
    // sbMask 为 Docked 占位应排除，不注册遮罩关闭
    if (maskId === 'sbMask') return;
    // docsMask/reqMask 默认 pcOnly:true
    if ((maskId === 'docsMask' || maskId === 'reqMask') && !opts) opts = { pcOnly: true };
    if ((maskId === 'docsMask' || maskId === 'reqMask') && opts && typeof opts.pcOnly === 'undefined') opts.pcOnly = true;
    var onClick = function (e) { try { if (e && e.target && e.target !== el) return; } catch (ee) {} if (opts && opts.pcOnly && !isPc()) return; closeFn(); };
    registry[maskId] = { maskId: maskId, panelId: panelId, closeFn: closeFn, opts: opts || null, _onClick: onClick };
    if (panelId) registry[panelId] = { maskId: maskId, panelId: panelId, closeFn: closeFn, opts: opts || null, _onClick: onClick };
    var el = document.getElementById(maskId);
    if (el) {
      // 核心：pcOnly 时移动端不响应（通过 kind-pc 判定），PC 端才执行 closeFn
      el.onclick = onClick;
      // 备用：亦支持 window.innerWidth>600 && pcMode() 判定（与 isPc 一致）
      // el.onclick = () => { if(opts && opts.pcOnly && !isPc()) return; closeFn(); };
    }
  }
  // 单一全局 Escape 监听（P1-7 fix：避免双监听叠加）
  document.addEventListener('keydown', function (e) {
    var isEsc = e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27;
    if (!isEsc) return;
    if (!stack.length) return;
    e.preventDefault();
    esc();
  });
  return { stack: stack, push: push, pop: pop, top: top, esc: esc, register: register, isPc: isPc, _registry: registry };
})();
/* FIX: 经典<script>加载，移除 export default(以window.MaskStack为准) */
/* ---- 经典兼容垫片 (Wave-D 移除; 保留 window.MaskStack 字符串供门禁) ---- */
try { if (typeof window !== 'undefined') window.MaskStack = window.MaskStack || MaskStack; } catch (e) {}
