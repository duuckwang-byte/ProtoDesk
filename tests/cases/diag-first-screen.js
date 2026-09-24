module.exports = async function diagFirstScreen(api) {
  const assert = (c,m)=>{ if(!c) throw new Error(m) };
  console.log('  [Diag] 检查首屏按钮绑定与标注徽标');
  const state = JSON.parse(await api.evaluate(`JSON.stringify({
    hasRefresh: !!document.getElementById('btnRefresh'),
    refreshOnclick: !!(document.getElementById('btnRefresh') && document.getElementById('btnRefresh').onclick),
    hasAnnoMgr: !!document.getElementById('btnAnnoMgr'),
    annoMgrOnclick: !!(document.getElementById('btnAnnoMgr') && document.getElementById('btnAnnoMgr').onclick),
    hasLinkMgr: !!document.getElementById('btnLinkMgr'),
    linkMgrOnclick: !!(document.getElementById('btnLinkMgr') && document.getElementById('btnLinkMgr').onclick),
    hasKindMobile: !!document.getElementById('btnKindMobile'),
    kindMobileOnclick: !!(document.getElementById('btnKindMobile') && document.getElementById('btnKindMobile').onclick),
    hasKindPc: !!document.getElementById('btnKindPc'),
    kindPcOnclick: !!(document.getElementById('btnKindPc') && document.getElementById('btnKindPc').onclick),
    hasSbTrigger: !!document.getElementById('sbTrigger'),
    sbTriggerOnclick: !!(document.getElementById('sbTrigger') && document.getElementById('sbTrigger').onclick),
    hasDocsFab: !!document.getElementById('docsFab'),
    docsFabOnclick: !!(document.getElementById('docsFab') && document.getElementById('docsFab').onclick),
    hasReqFab: !!document.getElementById('reqFab'),
    reqFabOnclick: !!(document.getElementById('reqFab') && document.getElementById('reqFab').onclick),
    maskStack: !!window.MaskStack,
    annotationEngine: !!window.AnnotationEngine,
    linkBind: !!window.LinkBind,
    ctrlPick: !!window.CTRL_PICK,
    sourcesLen: (window.sources||[]).length,
    errors: (window.__diagErrors||[]).slice(0,5)
  })`));
  console.log('  [Diag] state:', JSON.stringify(state, null, 2));
  assert(state.hasRefresh && state.refreshOnclick, 'btnRefresh 未绑定');
  assert(state.hasAnnoMgr && state.annoMgrOnclick, 'btnAnnoMgr 未绑定');
  assert(state.hasLinkMgr && state.linkMgrOnclick, 'btnLinkMgr 未绑定');
  assert(state.hasKindMobile && state.kindMobileOnclick, 'btnKindMobile 未绑定');
  assert(state.hasSbTrigger && state.sbTriggerOnclick, 'sbTrigger 未绑定');
  assert(state.maskStack, 'MaskStack 未定义');
  assert(state.annotationEngine, 'AnnotationEngine 未定义');
  assert(state.linkBind, 'LinkBind 未定义');
  console.log('  [Diag] 首屏按钮全部已绑定');
};
