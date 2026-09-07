/* 用例：单文件 HTML 导出包含结构化 md/docs + DOM 清理黑名单检验 */
module.exports = async function exportVerifyCase(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  const exportHtml = await api.evaluate(`(async function(){
    if (typeof buildExportHtml !== 'function') return null;
    return buildExportHtml([window.currentSource]);
  })()`);

  assert(exportHtml && typeof exportHtml === 'string', 'buildExportHtml 导出失败或返回空');
  assert(exportHtml.indexOf('window.__EXPORT_SOURCES__=') >= 0, '导出的 HTML 未包含 __EXPORT_SOURCES__');
  assert(exportHtml.indexOf('window.__EXPORT_BOOT__=true;') >= 0, '导出的 HTML 未设置 __EXPORT_BOOT__');
  
  // 验证 DOM 黑名单已清理
  assert(exportHtml.indexOf('id="snapMask"') < 0, '导出的 HTML 中残留了 #snapMask');
  assert(exportHtml.indexOf('id="projMask"') < 0, '导出的 HTML 中残留了 #projMask');
  assert(exportHtml.indexOf('id="reqMask"') < 0, '导出的 HTML 中残留了 #reqMask');

  // 验证文档 md 已正确内嵌，未退化为 "{}"
  assert(exportHtml.indexOf('localStorage.setItem("protoDoc_v2_') >= 0 || exportHtml.indexOf('localStorage.setItem(\'protoDoc_v2_') >= 0, '导出的 HTML 未包含 protoDoc_v2_ 注入');
  assert(exportHtml.indexOf('"{}"') < 0 && exportHtml.indexOf('"{}\"') < 0, '导出的 HTML 中文档内容异常为 "{}"');
};
