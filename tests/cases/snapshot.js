/* 用例：快照 IPC 通道可用性（list 返回结构 / restore 非法 ts 报错）；
   深度链路（AI 任务前快照→恢复内容一致）依赖 opencode CLI，由人工冒烟覆盖 */
module.exports = async function snapshotCase(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const hasApi = await api.evaluate(`!!(window.protoAPI&&window.protoAPI.snapshot)`);
  assert(hasApi === true, 'protoAPI.snapshot 未暴露');
  const dir = await api.evaluate(`(window.currentSource&&window.currentSource.sandboxDir)||''`);
  assert(dir !== '', '当前源无沙箱目录');
  const lst = JSON.parse(await api.evaluate(`window.protoAPI.snapshot.list(${JSON.stringify(dir)}).then(JSON.stringify)`));
  assert(lst && lst.ok === true && Array.isArray(lst.items), 'snapshot:list 返回结构异常');
  const bad = JSON.parse(await api.evaluate(`window.protoAPI.snapshot.restore({dir:${JSON.stringify(dir)},ts:'00000000-000000'}).then(JSON.stringify)`));
  assert(bad && bad.ok === false, 'restore 非法 ts 应失败');
};