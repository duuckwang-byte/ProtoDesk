'use strict';
// verify-inline-edit: 预览区Ctrl+Shift+单击就地改 INLINE_EDIT 回归（纯 Node，不启动 Electron）
// iter24 多行模式：不限标签，仅直接文本叶可进；初值=直接文本按序拼接（br占一个\n，子元素不展平）；保存按\n拆分分段回填（多余并入末段+toast，不足保留原文）；浮层textarea rows=4宽440、按钮内嵌右下小尺寸；回车原生换行，Ctrl+Enter保存。
// 手段：源文提取静态断言 + 最小 stub 真执行（HasDirectText/GetDirectText/ApplyDirectText/IsChrome/editDblClick委托分发）
// 覆盖：不限标签与chrome排除、无dblclick绑定+window抢占防重入+视口钳制+代理字段+失败toast、Ctrl穿透、保存定位恰1+多行分段回填（多余并末段/不足保留）、直接文本分段拼接初值（br占位）、
//       失败转AI队列、互斥与AI忙禁、写通道readFile/write复用、无新增script、浮层样式、快捷键/脏confirm（initText）、
//       Ctrl+Shift单击委托同入口/抑制高亮/已开无效/原Ctrl单击不动、无文字拒绝文案
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const editSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
const pkgSrc = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = src.indexOf('{', i);
  let depth = 0;
  for (let j = b; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}
function evalFn(fnText, fnName) {
  return new Function(fnText + '; return ' + fnName + ';')();
}
function mkT(v) { return { nodeType: 3, nodeValue: String(v) }; }
function mkBr() { return { nodeType: 1, tagName: 'BR', childNodes: [] }; }
function mkSpanEl(txt) { return { nodeType: 1, tagName: 'SPAN', childNodes: [mkT(txt)], textContent: String(txt) }; }
function mkChromeEl(over) {
  return Object.assign({
    nodeType: 1,
    tagName: 'P',
    className: '',
    id: '',
    textContent: 'hello',
    style: {},
    childNodes: [mkT('hello')],
    hasAttribute(k) { return false; },
    getAttribute() { return null; },
    closest() { return null; },
    parentElement: null,
  }, over || {});
}

// ── A1 不限标签 + 直接文本叶准入（源码级：IsTextTag恒true，准入改由HasDirectText判定，无直接文字拒绝） ──
function testA1_WhitelistSrc() {
  const body = extractFn(editSrc, 'inlineEditIsTextTag');
  assert.ok(body, '须能提取 inlineEditIsTextTag');
  assert.ok(body.includes('return true'), '纯文本模式须 return true（不限标签）');
  assert.ok(body.includes('inlineEditHasDirectText'), '须注明准入改由 inlineEditHasDirectText 判定');
  assert.ok(!/tag==='p'/.test(body), '不得再按 p 白名单限标签');
  assert.ok(!/tag==='li'/.test(body), '不得再按 li 白名单限标签');
  assert.ok(!/tag==='div'/.test(body), '不得再按 div 限标签（div/span一视同仁）');
  assert.ok(!/tag==='span'/.test(body), '不得再按 span 限标签');
  assert.ok(!body.includes("/^h[1-6]$/"), '不得再用 H1-H6 正则限标签');
  const hasBody = extractFn(editSrc, 'inlineEditHasDirectText');
  assert.ok(hasBody, '须能提取 inlineEditHasDirectText');
  assert.ok(hasBody.includes('el.childNodes'), '须遍历 childNodes 判定直接文本叶');
  assert.ok(hasBody.includes('nodeType===3'), '须只认直接文本节点 nodeType===3');
  assert.ok(hasBody.includes("trim()!==''"), '须 trim 判非空（过滤纯空白文本）');
  assert.ok(hasBody.includes('return true') && hasBody.includes('return false'), '有直接文字 true、无则 false');
  const dbl = extractFn(editSrc, 'editDblClick');
  assert.ok(dbl, '须能提取 editDblClick');
  assert.ok(dbl.includes('inlineEditHasDirectText(t)'), 'editDblClick 须以 HasDirectText 判定准入');
  assert.ok(dbl.includes('该元素无可编辑文字'), '无直接文字拒绝文案须为“该元素无可编辑文字”');
  assert.ok(!dbl.includes('暂不支持'), '不得再用“暂不支持就地改”旧文案');
  assert.ok(!dbl.includes('inlineEditIsTextTag('), '准入不得再调 IsTextTag（已不限标签）');
  assert.ok(!editSrc.includes('暂不支持'), '全文件不得残留“暂不支持”旧拒绝文案');
}

// ── A2 chrome 元素排除（源码级） ──
function testA2_ChromeSrc() {
  const body = extractFn(editSrc, 'inlineEditIsChrome');
  assert.ok(body, '须能提取 inlineEditIsChrome');
  for (const t of ["'script'", "'style'", "'iframe'", "'link'", "'meta'"]) {
    assert.ok(body.includes(t), 'chrome 排除须含 ' + t);
  }
  assert.ok(body.includes('data-plrt'), '须排除 LinkBind data-plrt（含 closest）');
  assert.ok(body.includes('selection-box-overlay'), '须排除拾取覆盖层');
  assert.ok(body.includes('selection-badge'), '须排除序号角标');
  assert.ok(body.includes('anno-badge'), '须排除标注角标');
  assert.ok(body.includes('selectionOverlay') && body.includes('editHover') && body.includes('ctrlPickTip'),
    '须按 id 排除 selectionOverlay/editHover/ctrlPickTip');
  assert.ok(body.includes('跳转至 ') && body.includes("==='99999'"), '须排除 LinkBind 跳转气泡（跳转至 + zIndex 99999）');
}

// ── A3 无dblclick绑定 + window抢占 + 防重入（源码级：本批删除原型dblclick绑定，editDblClick仅作Ctrl+Shift委托入口） ──
function testA3_DblclickBindSrc() {
  // 无dblclick绑定（原型就地改不再挂dblclick，本批已删除）
  assert.ok(!editSrc.includes("'dblclick'") && !editSrc.includes('"dblclick"'),
    '原型就地改须无dblclick绑定（本批已删除dblclick挂载，Ctrl+Shift+单击为唯一入口）');
  assert.ok(!editSrc.includes('__inlineDblAttached'), '不得残留 __inlineDblAttached 旧防重标志');
  // editDblClick保留供纯双击（文字浮层）；Ctrl+Shift 改走代码编辑抽屉
  assert.ok(editSrc.includes('function editDblClick('), '须保留 editDblClick 实现供纯双击');
  assert.ok(editSrc.includes('codeEditOpenFromLive(_csT)'), 'Ctrl+Shift须委托 codeEditOpenFromLive（代码编辑抽屉）');
  // window capture抢占 + document保留兼容
  assert.ok(editSrc.includes("_fw.addEventListener('click', editClick, true)"),
    '须有 window capture抢占：_fw.addEventListener(click,editClick,true)（先于document，与原型库注册顺序无关）');
  assert.ok(editSrc.includes("d.addEventListener('click', editClick, true)"),
    'document须保留 click->editClick 兼容绑定');
  assert.ok(editSrc.includes('抢占式') && editSrc.includes('editEvtDedup防重入'),
    '须有抢占式注释（window先于document，靠editEvtDedup防重入）');
  // 防重入：editEvtDedup + _editEvtSeen + 幂等标志
  assert.ok(editSrc.includes('function editEvtDedup('), '须有 editEvtDedup 防重入函数');
  assert.ok(editSrc.includes('var _editEvtSeen='), '须有 _editEvtSeen 去重状态');
  assert.ok(editSrc.includes('__editAttached') && editSrc.includes('__inlineAttached'),
    '须有 __editAttached/__inlineAttached 幂等标志');
  assert.ok(editSrc.includes('inlineEditFrameMouseDown'), '须有 frame 内 mousedown 点外放弃');
  assert.ok(editSrc.includes("d.addEventListener('mousedown', inlineEditFrameMouseDown, true)"),
    'frame mousedown 须绑定 inlineEditFrameMouseDown');
  assert.ok(editSrc.includes('var INLINE_EDIT={'), '须有 INLINE_EDIT 命名空间');
  // 文案去双击：原型就地改实现无“双击”中文（Ctrl+Shift为准；舞台/侧栏/微浮层等非原型项不在此文件断言删除）
  assert.ok(!editSrc.includes('双击'), 'edit-entry文案须去双击（无“双击”中文残留）');
}

// ── A4 Ctrl 穿透与 holding 互斥（源码级） ──
function testA4_CtrlPassthroughSrc() {
  const body = extractFn(editSrc, 'editDblClick');
  assert.ok(body, '须能提取 editDblClick');
  assert.ok(body.includes('if(ev&&(ev.ctrlKey||ev.metaKey))return;'), 'Ctrl/Cmd 按住时 dblclick 须直接穿透 return（不抢 CTRL_PICK）');
  assert.ok(body.includes('CTRL_PICK&&CTRL_PICK.holding)return;') || body.includes("CTRL_PICK.holding)return;"),
    'CTRL_PICK holding 时须 return（互斥，不进就地改）');
}

// ── A5 保存定位恰1 + 多行分段回填（源码级：DOMParser + hits.length!==1 + ApplyDirectText，不写innerHTML） ──
function testA5_SaveExactlyOneSrc() {
  const body = extractFn(editSrc, 'inlineEditSave');
  assert.ok(body, '须能提取 inlineEditSave');
  assert.ok(body.includes("new DOMParser().parseFromString(srcHtml,'text/html')"), '须用 DOMParser 解析源文件');
  assert.ok(body.includes('pdoc.querySelectorAll(selector)'), '须用保存时 selector 在源文件定位');
  assert.ok(body.includes('hits.length!==1'), '须断言命中恰好 1 个（!==1 则转 AI 队列）');
  assert.ok(body.includes('源文件定位命中') && body.includes('需恰好1个'), '恰1失败提示须写明“需恰好1个”');
  assert.ok(!body.includes('hits[0].innerHTML='), '不得再直接写 hits[0].innerHTML（须分段回填文本节点，不动结构/子元素）');
  assert.ok(body.includes('inlineEditApplyDirectText(hits[0],newText)'), '命中恰1后须经 inlineEditApplyDirectText 回填');
  assert.ok(body.includes('if(!_apply||!_apply.ok)'), '须判回填 ok（源文件无直接文字则转队列）');
  assert.ok(body.includes('源文件无可编辑直接文字'), '无直接文字须转队列提示“源文件无可编辑直接文字”');
  assert.ok(body.includes("pdoc.documentElement.outerHTML"), '须序列化 documentElement.outerHTML 写回');
  assert.ok(body.includes('hasDoctype'), '序列化须保留 DOCTYPE（hasDoctype 分支）');
  // 多余并末段 toast：overflow 分段回填语义
  assert.ok(body.includes('_overflow') && body.includes('if(_overflow)inlineEditToast'), '多余行须经 _overflow 触发 toast（并入末段提示）');
  assert.ok(body.includes('换行多于原文文本段，多余已并入末段'), 'overflow 提示须写明“多余已并入末段”');
  assert.ok(body.includes('<br>数量不变'), 'overflow 提示须写明 <br> 数量不变');
  // ApplyDirectText 本体：多行模式——\r\n/\r 归一为\n、按\n拆分、逐段映射、多余并末段overflow=true、不足保留原文、子元素/br不动
  const ap = extractFn(editSrc, 'inlineEditApplyDirectText');
  assert.ok(ap, '须能提取 inlineEditApplyDirectText');
  assert.ok(ap.includes("replace(/\\r\\n/g,'\\n')"), '须将 \\r\\n 归一为 \\n（多行）');
  assert.ok(ap.includes("replace(/\\r/g,'\\n')"), '须将 \\r 归一为 \\n（多行）');
  assert.ok(ap.includes("split('\\n')"), '须按 \\n 拆分分段回填（多行）');
  assert.ok(ap.includes('nodeType===3') && ap.includes('texts.push'), '须只收集直接文本节点（br/子元素不进 texts）');
  assert.ok(ap.includes('texts[j].nodeValue=lines[j]'), '须逐段映射 texts[j]=lines[j]（分段回填）');
  assert.ok(ap.includes("lines.slice(j).join('\\n')"), '多余行须并入末段 slice(j).join');
  assert.ok(ap.includes('overflow=true'), '多余须置 overflow=true（并末段）');
  assert.ok(ap.includes('if(j<lines.length)'), '不足行须保留原文分支（j<lines.length 守卫，无赋值即保留）');
  assert.ok(!ap.includes("texts[j].nodeValue=''"), '不得再首写余清（多余置空已废止，不足保留）');
  assert.ok(!ap.includes("replace(/\\s+/g,' ')"), '不得再压缩连续空白（多行保留原文空白）');
  assert.ok(!/\.innerHTML\s*=/.test(ap), '回填不得写 innerHTML（子元素/br 不动）');
  assert.ok(ap.includes('applied:Math.min'), '须返回 applied=min（映射段数）');
}

// ── A6 多行浮层：标题修改+无tag头无hint+textarea多行+分段拼接初值（源码级：GetDirectText分段拼接，子元素不展平） ──
function testA6_InitHtmlSrc() {
  const openBody = extractFn(editSrc, 'inlineEditOpen');
  const buildBody = extractFn(editSrc, 'inlineEditBuildPop');
  const getBody = extractFn(editSrc, 'inlineEditGetDirectText');
  assert.ok(openBody && buildBody && getBody, '须能提取 inlineEditOpen/inlineEditBuildPop/inlineEditGetDirectText');
  assert.ok(openBody.includes('INLINE_EDIT.initText=inlineEditGetDirectText(targetEl)'), '初值须经 GetDirectText 取直接文本分段拼接');
  assert.ok(openBody.includes('INLINE_EDIT.initHtml=INLINE_EDIT.initText'), 'initHtml 须兼容等于 initText（纯文本）');
  assert.ok(!openBody.includes('targetEl.innerHTML'), '初值不得再取 innerHTML（不展平子元素/行内标签）');
  assert.ok(!/INLINE_EDIT\.initHtml=String\(targetEl\.innerText/.test(openBody), '初值不得用 innerText');
  assert.ok(!/INLINE_EDIT\.initHtml=String\(targetEl\.textContent/.test(openBody), '初值不得用 textContent');
  // 浮层头部仅“修改”、无tag头、无hint
  assert.ok(buildBody.includes("hd.textContent='修改'"), '浮层头部标题须仅为“修改”');
  assert.ok(!buildBody.includes('inline-edit-tag'), '浮层不得再建 tag 头（已删）');
  assert.ok(!buildBody.includes('inline-edit-sel'), '浮层不得再建 selector 行（已删）');
  assert.ok(!buildBody.includes('inline-edit-hint'), '浮层不得再建 hint（已删）');
  assert.ok(!buildBody.includes('只改本元素'), '不得残留旧 hint 文案（只改本元素）');
  assert.ok(!buildBody.includes('换行即分行'), '不得残留多行 hint（换行即分行）');
  assert.ok(!buildBody.includes('保留行内标签'), '旧 hint（保留行内标签）不得残留');
  // textarea 多行 + 内嵌右下小尺寸按钮
  assert.ok(buildBody.includes("document.createElement('textarea')"), '浮层须用 textarea 多行（createElement textarea）');
  assert.ok(buildBody.includes("ta.className='inline-edit-ta'"), 'textarea 须带 inline-edit-ta 样式');
  assert.ok(buildBody.includes('ta.rows=4'), 'textarea rows 须为 4（多行）');
  assert.ok(buildBody.includes('ta.value=INLINE_EDIT.initText'), '浮层 textarea 初值须为 initText 纯文本');
  assert.ok(buildBody.includes("wrap.className='inline-edit-wrap'"), '须有 wrap 包裹实现按钮内嵌定位');
  assert.ok(buildBody.includes('inline-edit-inbtn'), '按钮须内嵌样式 inbtn（右下小尺寸）');
  assert.ok(buildBody.includes('inline-edit-incancel') && buildBody.includes('inline-edit-insave'), '须有内嵌放弃/保存按钮（incancel/insave）');
  assert.ok(!buildBody.includes("document.createElement('input')"), '不得再建 input 单行');
  assert.ok(!buildBody.includes('inline-edit-input'), '不得残留 input 单行样式');
  assert.ok(!buildBody.includes("ta.type='text'"), '不得再设单行 type=text');
  assert.ok(!buildBody.includes('ta.value=INLINE_EDIT.initHtml'), '不得再以 initHtml（innerHTML）作初值');
  // 初值分段拼接：br 占一个\n、直接文本按序拼接、子元素不展平、无空白压缩
  assert.ok(getBody.includes("toLowerCase()==='br'"), 'GetDirectText 须识别 <br>');
  assert.ok(getBody.includes("out+='\\n'"), 'br 须占一个换行位拼入初值（多行分段）');
  assert.ok(!getBody.includes("parts.push(' ')"), '不得再将 br 转空格（已占换行位）');
  assert.ok(!getBody.includes("parts.join(' ')"), '不得再以空格连接（已分段拼接）');
  assert.ok(!getBody.includes("replace(/[\\r\\n]+/g,' ')"), '换行不得转空格（多行保留换行）');
  assert.ok(!getBody.includes("replace(/\\s+/g,' ')"), '连续空白不得压缩（多行保留原文）');
  assert.ok(getBody.includes('nodeType===3'), '须拼接直接文本节点内容');
  assert.ok(!getBody.includes('querySelector'), '不得展平子元素（无 querySelector 抓子树文字）');
  assert.ok(!getBody.includes('innerHTML') && !getBody.includes('innerText'), 'GetDirectText 不得用 innerHTML/innerText 展平');
  // 多行不拦截换行：不得监听 input/paste 转空格
  assert.ok(!buildBody.includes("addEventListener('input'"), '多行不得再监听 input 拦截换行（回车原生换行）');
  assert.ok(!buildBody.includes("addEventListener('paste'"), '多行不得再监听 paste 转空格');
}

// ── A7 失败转 AI 队列存在（源码级，纯文本 newText） ──
function testA7_FallbackSrc() {
  const fb = extractFn(editSrc, 'inlineEditQueueFallback');
  assert.ok(fb, '须有 inlineEditQueueFallback');
  assert.ok(fb.includes("editQueueAdd(INLINE_EDIT.target,'将该元素内容改为："), 'fallback 须经 editQueueAdd 入待提交队列');
  assert.ok(fb.includes('inlineEditToast('), 'fallback 须 toast 提示已转队列');
  assert.ok(fb.includes('inlineEditQueueFallback(newText'), 'fallback 签名须为 (newText,note) 纯文本');
  const saveBody = extractFn(editSrc, 'inlineEditSave');
  const calls = (saveBody.match(/inlineEditQueueFallback\(newText,/g) || []).length;
  assert.ok(calls >= 8, `inlineEditSave 内 fallback 分支应>=8（不支持写盘/无selector/读失败/解析失败/selector无效/非恰1/无直接文字/写失败/读写异常），实际${calls}`);
  assert.ok(!/inlineEditQueueFallback\(newHtml,/.test(saveBody), '不得再用 newHtml 旧变量名（已纯文本 newText）');
  assert.ok(saveBody.includes('当前原型不支持直接写盘，已转AI队列'), '无写通道须转队列');
  assert.ok(saveBody.includes('源文件读取失败，已转AI队列') && saveBody.includes('写盘失败，已转AI队列'),
    '读写失败均须转队列');
  assert.ok(saveBody.includes('源文件无可编辑直接文字，已转AI队列'), '源文件无直接文字须转队列');
  assert.ok(saveBody.includes('选择器在源文件无效，已转AI队列') && saveBody.includes('选择器生成失败，已转AI队列'),
    'selector 失败均须转队列');
}

// ── A8 互斥与 AI 忙禁（源码级） ──
function testA8_MutexBusySrc() {
  const dbl = extractFn(editSrc, 'editDblClick');
  const save = extractFn(editSrc, 'inlineEditSave');
  const open = extractFn(editSrc, 'inlineEditOpen');
  assert.ok(editSrc.includes('function inlineEditIsAiBusy('), '须有 inlineEditIsAiBusy');
  assert.ok(dbl.includes('inlineEditIsAiBusy()'), 'dblclick 入口须判 AI 忙');
  assert.ok(dbl.includes('AI 正在生成，请先停止再就地改。'), 'AI 忙提示文案须一致');
  assert.ok(save.includes('inlineEditIsAiBusy()'), '保存时须再判 AI 忙（防并发写盘）');
  assert.ok(dbl.includes("inlineEditToast('请先保存或放弃当前就地改。')"), '已开浮层时 dblclick 须提示先保存/放弃');
  assert.ok(open.includes('CTRL_PICK.holding=false'), 'open 时须清 CTRL_PICK.holding');
  assert.ok(open.includes('CTRL_PICK.exit()'), 'open 时须 CTRL_PICK.exit() 清准星/悬停');
  assert.ok(open.includes('LinkBind.closeAllDrawers'), 'open 时须关 LinkBind 抽屉');
  assert.ok(editSrc.includes("if(typeof INLINE_EDIT!=='undefined'&&INLINE_EDIT&&INLINE_EDIT.open)return;"),
    'editHover/editClick/拾取 keydown 须判 INLINE_EDIT.open 互斥');
  // 保存成功即关浮层，不残留
  assert.ok(save.includes('inlineEditCloseNow()'), '保存成功须 inlineEditCloseNow');
}

// ── A9 写通道 readFile/write 复用（源码级：无新通道） ──
function testA9_WriteChannelSrc() {
  const save = extractFn(editSrc, 'inlineEditSave');
  assert.ok(save.includes('(window.protoAPI&&window.protoAPI.sandbox)||null'), '须复用 window.protoAPI.sandbox 写通道');
  assert.ok(save.includes("typeof sb.readFile!=='function'||typeof sb.write!=='function'"), '须同时校验 readFile/write 可用性');
  assert.ok(save.includes('sb.readFile({dir:dir,file:file})'), '读须 sb.readFile({dir,file})');
  assert.ok(save.includes('sb.write({dir:dir,file:file,content:out})'), '写须 sb.write({dir,file,content})');
  assert.ok(!/sandbox:inline/.test(editSrc), '不得新增 sandbox:inline 新 IPC 通道');
  assert.ok(!/proto:inline/.test(editSrc), '不得新增 proto:inline 新通道');
  assert.ok(!/ipcRenderer\.invoke\(['"]inline/.test(editSrc), '不得经 ipcRenderer 新增 inline 通道');
}

// ── A10 脚本清单（Wave-D/G: 开发11不变 + EXPORT轻量2解耦；白名单17不变 js/**已覆盖export-template） ──
function testA10_NoNewScript() {
  const scripts = [...htmlSrc.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(x => x[1].replace(/\\/g, '/'));
  assert.strictEqual(scripts.length, 18, `HTML script 须为 18 个(16经典+utils/store ESM, Wave-D/G), 实际${scripts.length}: ${scripts.join(',')}`);
  assert.deepStrictEqual(scripts.slice(0, 16), ['js/icons.js', 'js/mask-manager.js', 'js/doc/markdown-compiler.js', 'js/doc/editor-controller.js', 'js/doc/toc-navigator.js', 'js/doc/mirror-sync.js', 'js/core-docs.js', 'js/nav-zoom.js', 'js/sandbox-core.js', 'js/git-ui/git-domain.js', 'js/ai/ai-domain.js', 'js/project-ai-export-compiler.js', 'js/project-ai-export.js', 'js/edit-entry.js', 'js/link-bind.js', 'js/annotation-core.js'], '前16经典域先于门面顺序不动(Wave-D/G)');
  assert.deepStrictEqual(scripts.slice(16), ['js/utils.js', 'js/store.js'], '新增仅 utils/store ESM (event-bus/sandbox-agent/main 经 import, 不占配额)');
  const paeForExport = require('node:fs').readFileSync(require('node:path').join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
  const expM = paeForExport.match(/var EXPORT_SCRIPT_FILES\s*=\s*(\[[^\]]*\])/);
  const expList = expM ? eval(expM[1]) : [];
  assert.deepStrictEqual(expList, ['js/icons.js', 'js/export-template.js'], 'EXPORT须轻量2项解耦(Wave-D/G), 实际:' + JSON.stringify(expList));
  assert.ok(!scripts.some(s => /inline/i.test(s)), '不得新增 inline-* 独立脚本');
  assert.ok(!/id="inlineEditPop"/.test(htmlSrc), '浮层须 JS 动态创建，HTML 不得预置 #inlineEditPop（零污染）');
  const pkg = JSON.parse(pkgSrc);
  const filesList = (((pkg || {}).build || {}).files || []);
  assert.strictEqual(filesList.length, 18, `build.files 白名单须为 18 条(12白+6bak排除，Wave-B新增main/**，UI规范新增design-specs/**)，实际${filesList.length}`);
  assert.strictEqual(filesList.filter(p => String(p).startsWith('!')).length, 6, '新增6条须全为!排除项(防借机偷渡文件进包)');
  assert.ok(filesList.includes('main/**'), 'Wave-B主进程拆分目录须进包');
  assert.ok(filesList.includes('design-specs/**'), 'UI规范种子目录须进包');
}

// ── A11 浮层样式（app.css 纯色多行浮层：宽440+按钮内嵌右下小尺寸） ──
function testA11_PopCss() {
  for (const sel of ['.inline-edit-pop', '.inline-edit-hd', '.inline-edit-tag', '.inline-edit-sel',
    '.inline-edit-ta', '.inline-edit-wrap', '.inline-edit-inbtn', '.inline-edit-insave', '.inline-edit-incancel',
    '.inline-edit-ft', '.inline-edit-hint', '.inline-edit-btn', '.inline-edit-btn.primary']) {
    assert.ok(cssSrc.includes(sel), 'CSS 缺失 ' + sel);
  }
  const i = cssSrc.indexOf('.inline-edit-pop{');
  assert.ok(i >= 0, '须能定位 .inline-edit-pop 规则');
  const slice = cssSrc.slice(i, i + 600);
  assert.ok(slice.includes('position:fixed'), '浮层须 position:fixed（跟随定位由 JS 计算）');
  assert.ok(slice.includes('z-index:400'), '浮层 z-index 须为 400（抽屉之下、遮罩之上按既有层级）');
  assert.ok(slice.includes('width:440px'), '浮层宽须 440px（多行）');
  assert.ok(!slice.includes('width:360px'), '不得残留单行 360px 宽度');
  assert.ok(!/linear-gradient/.test(slice), '浮层须纯色无渐变');
  // 内嵌按钮位置尺寸：wrap 相对定位 + textarea 留白 + inbtn 绝对右下小尺寸
  const wIdx = cssSrc.indexOf('.inline-edit-wrap{');
  assert.ok(wIdx >= 0, '须能定位 .inline-edit-wrap 规则');
  assert.ok(cssSrc.slice(wIdx, wIdx + 200).includes('position:relative'), 'wrap 须 position:relative（按钮内嵌定位基准）');
  assert.ok(cssSrc.includes('padding-bottom:38px'), 'textarea 须留底部 38px 给内嵌按钮');
  const bIdx = cssSrc.indexOf('.inline-edit-inbtn{');
  assert.ok(bIdx >= 0, '须能定位 .inline-edit-inbtn 规则');
  const bSlice = cssSrc.slice(bIdx, bIdx + 300);
  assert.ok(bSlice.includes('position:absolute'), '内嵌按钮须 position:absolute（右下内嵌）');
  assert.ok(bSlice.includes('bottom:8px'), '内嵌按钮 bottom 须 8px');
  assert.ok(bSlice.includes('height:24px'), '内嵌按钮高须 24px（小尺寸）');
  assert.ok(cssSrc.includes('.inline-edit-insave{right:8px}'), '保存按钮 right 须 8px（右下）');
  assert.ok(cssSrc.includes('.inline-edit-incancel{right:66px}'), '放弃按钮 right 须 66px（保存左侧）');
  const buildBody = extractFn(editSrc, 'inlineEditBuildPop');
  assert.ok(buildBody.includes("pop.id='inlineEditPop'") && buildBody.includes("pop.className='inline-edit-pop'"),
    '浮层 DOM 须 id=inlineEditPop + class=inline-edit-pop 与 CSS 对齐');
  assert.ok(buildBody.includes("wrap.className='inline-edit-wrap'"), '浮层须建 wrap 内嵌容器');
  assert.ok(buildBody.includes('ta.rows=4'), '浮层 textarea rows 须为 4（多行期望）');
}

// ── A12 快捷键与脏 confirm（源码级，纯文本 initText；多行回车原生换行、Ctrl+Enter保存） ──
function testA12_KeysDirtySrc() {
  const buildBody = extractFn(editSrc, 'inlineEditBuildPop');
  assert.ok(buildBody.includes("(ev.ctrlKey||ev.metaKey)&&(ev.key==='Enter'"), '须支持 Ctrl+Enter 保存（含 Cmd）');
  assert.ok(!/if\s*\(\s*ev\.key==='Enter'/.test(buildBody), '回车须原生换行，不得有裸 Enter 保存分支（仅 Ctrl+Enter 保存）');
  assert.ok(!buildBody.includes("if(ev.key==='Enter'||ev.keyCode===13)"), '不得残留单行回车即保存分支');
  assert.ok(buildBody.includes('inlineEditSave()'), 'Ctrl+Enter须走 inlineEditSave');
  assert.ok(buildBody.includes("ev.key==='Escape'"), '须支持 Esc 放弃');
  assert.ok(buildBody.includes('inlineEditTryClose()'), 'Esc/点外须走 inlineEditTryClose');
  assert.ok(buildBody.includes("document.createElement('textarea')"), '多行须为 textarea（回车原生换行前提）');
  assert.ok(!buildBody.includes("document.createElement('input')"), '不得再用 input 单行（回车保存已废止）');
  const closeBody = extractFn(editSrc, 'inlineEditTryClose');
  assert.ok(closeBody.includes('cur!==INLINE_EDIT.initText'), '须按 cur!==initText 判脏（纯文本）');
  assert.ok(!closeBody.includes('cur!==INLINE_EDIT.initHtml'), '不得再按 initHtml 判脏');
  assert.ok(closeBody.includes("window.confirm('内容已修改，确定放弃本次就地改吗？')"), '脏时须 confirm 确认放弃');
  const saveBody = extractFn(editSrc, 'inlineEditSave');
  assert.ok(saveBody.includes('newText===INLINE_EDIT.initText'), '无变化须按 newText===initText 判定');
  assert.ok(!saveBody.includes('newHtml===INLINE_EDIT.initHtml') && !saveBody.includes('newHtml===INLINE_EDIT.initText'), '不得残留 newHtml 旧变量比较');
  assert.ok(saveBody.includes("inlineEditToast('内容无变化，已关闭。')"), '无变化保存须提示并关闭');
}

// ── S1 IsTextTag 不限标签（最小 stub 真执行：恒true，兼容保留） ──
function testS1_TextTagRuntime() {
  const fn = evalFn(extractFn(editSrc, 'inlineEditIsTextTag'), 'inlineEditIsTextTag');
  for (const t of ['p', 'P', 'li', 'LI', 'td', 'TD', 'th', 'TH', 'h1', 'H1', 'h2', 'h3', 'h4', 'h5', 'h6', 'H6',
    'div', 'DIV', 'span', 'SPAN', 'a', 'A', 'button', 'ul', 'ol', 'table', 'tr', 'section', 'input', 'img', '', null, undefined]) {
    assert.strictEqual(fn(t), true, `${String(t)} 纯文本模式均须 true（不限标签，准入看直接文本叶）`);
  }
}

// ── S1b HasDirectText 真值表（最小 stub 真执行：直接文本叶判定） ──
function testS1b_HasDirectTextRuntime() {
  const fn = evalFn(extractFn(editSrc, 'inlineEditHasDirectText'), 'inlineEditHasDirectText');
  const el = (children) => ({ nodeType: 1, tagName: 'DIV', childNodes: children });
  assert.strictEqual(fn(el([mkT('hello')])), true, '单直接文本须 true');
  assert.strictEqual(fn(el([mkT('  hello  ')])), true, '带空白直接文本须 true');
  assert.strictEqual(fn(el([mkT('   ')])), false, '纯空白文本须 false');
  assert.strictEqual(fn(el([])), false, '空 childNodes 须 false');
  assert.strictEqual(fn({ nodeType: 1, tagName: 'DIV' }), false, '无 childNodes 须 false');
  assert.strictEqual(fn(null), false, 'null 须 false');
  assert.strictEqual(fn(undefined), false, 'undefined 须 false');
  assert.strictEqual(fn(el([mkSpanEl('hi')])), false, '仅子元素文字须 false（子元素不展平）');
  assert.strictEqual(fn(el([mkT('a'), mkSpanEl('X')])), true, '直接文本+子元素须 true（直接部分即准入）');
  assert.strictEqual(fn(el([mkT('a'), mkBr()])), true, '直接文本+br 须 true');
  assert.strictEqual(fn(el([mkBr()])), false, '仅 br 无文本须 false（br 不是文字）');
}

// ── S2 IsChrome 真值表（最小 stub 真执行） ──
function testS2_ChromeRuntime() {
  const fn = evalFn(extractFn(editSrc, 'inlineEditIsChrome'), 'inlineEditIsChrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'P' })), false, '普通 P 不得判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'SCRIPT' })), true, 'script 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'STYLE' })), true, 'style 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'IFRAME' })), true, 'iframe 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'P', hasAttribute: () => true })), true, 'data-plrt 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'P', closest: (s) => (s === '[data-plrt]' ? {} : null) })), true, '祖先 data-plrt 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'P', className: 'selection-box-overlay' })), true, '拾取框须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'SPAN', className: 'selection-badge' })), true, '角标须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'DIV', className: 'anno-badge' })), true, '标注角标须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'DIV', id: 'selectionOverlay' })), true, '#selectionOverlay 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({ tagName: 'DIV', id: 'editHover' })), true, '#editHover 须判 chrome');
  assert.strictEqual(fn(mkChromeEl({
    tagName: 'DIV', textContent: '跳转至 原型A', style: { zIndex: '99999' },
    parentElement: { tagName: 'BODY' },
  })), true, 'LinkBind 跳转气泡须判 chrome');
}

// ── S3 dblclick 分发新语义（vm 注入 stub 真执行 editDblClick：不限标签 + 无文字拒绝） ──
function testS3_DblclickDispatch() {
  const srcHas = extractFn(editSrc, 'inlineEditHasDirectText');
  const srcIsChrome = extractFn(editSrc, 'inlineEditIsChrome');
  const srcIsBusy = extractFn(editSrc, 'inlineEditIsAiBusy');
  const srcDbl = extractFn(editSrc, 'editDblClick');
  assert.ok(srcHas && srcIsChrome && srcIsBusy && srcDbl, '须能提取四函数（HasDirectText/IsChrome/IsAiBusy/editDblClick）');
  const sb = {
    console, JSON, RegExp, String,
    CTRL_PICK: { holding: false },
    INLINE_EDIT: { open: false },
    __busy: false,
    __opened: null,
    __toasts: [],
    inlineEditToast(m) { sb.__toasts.push(String(m)); },
    inlineEditOpen(el) { sb.__opened = el; sb.INLINE_EDIT.open = true; },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(srcHas + '\n' + srcIsChrome + '\n' + srcIsBusy + '\n' + srcDbl, sb, { filename: 'inline-edit-dbl' });
  const mkEv = (tag, over) => Object.assign({
    ctrlKey: false, metaKey: false,
    target: mkChromeEl({ tagName: tag }),
    preventDefault() { this._pd = true; }, stopPropagation() { this._sp = true; },
  }, over || {});
  // 1) Ctrl 穿透：不 open、不 toast
  sb.__opened = null; sb.__toasts.length = 0; sb.CTRL_PICK.holding = false; sb.INLINE_EDIT.open = false; sb.__busy = false;
  vm.runInContext('this.__r1 = (function(){ editDblClick(arguments[0]); return 1; })', sb);
  sb.editDblClick = vm.runInContext('editDblClick', sb);
  sb.editDblClick(mkEv('P', { ctrlKey: true }));
  assert.strictEqual(sb.__opened, null, 'Ctrl 按住 dblclick 不得 open');
  assert.strictEqual(sb.__toasts.length, 0, 'Ctrl 穿透不得 toast');
  // 2) holding 互斥
  sb.__opened = null; sb.__toasts.length = 0;
  sb.CTRL_PICK.holding = true;
  sb.editDblClick(mkEv('P'));
  assert.strictEqual(sb.__opened, null, 'holding 时不得 open');
  sb.CTRL_PICK.holding = false;
  // 3) 已开浮层：提示先保存/放弃
  sb.__opened = null; sb.__toasts.length = 0; sb.INLINE_EDIT.open = true;
  sb.editDblClick(mkEv('P'));
  assert.strictEqual(sb.__opened, null, '已开浮层不得重开');
  assert.ok(sb.__toasts.some(t => t.includes('请先保存或放弃')), '已开浮层须提示先保存/放弃');
  sb.INLINE_EDIT.open = false;
  // 4) 无直接文字：toast 无可编辑、不 open、无旧文案（空子节点）
  sb.__opened = null; sb.__toasts.length = 0;
  const noTextEv = mkEv('DIV', { target: mkChromeEl({ tagName: 'DIV', childNodes: [], textContent: '' }) });
  sb.editDblClick(noTextEv);
  assert.strictEqual(sb.__opened, null, '无直接文字不得 open');
  assert.ok(sb.__toasts.some(t => t.includes('该元素无可编辑文字')), '无直接文字须提示“该元素无可编辑文字”');
  assert.ok(!sb.__toasts.some(t => t.includes('暂不支持')), '不得再提示旧“暂不支持”文案');
  assert.ok(!sb.__toasts.some(t => t.includes('已转AI队列') || t.includes('走AI队列')), '无文字拒绝为轻提示，不直接转队列');
  // 4b) 仅子元素文字同样无直接文字（子元素不展平）
  sb.__opened = null; sb.__toasts.length = 0;
  const spanOnly = mkChromeEl({ tagName: 'DIV', childNodes: [mkSpanEl('hi')], textContent: 'hi' });
  const evSpanOnly = mkEv('DIV'); evSpanOnly.target = spanOnly;
  sb.editDblClick(evSpanOnly);
  assert.strictEqual(sb.__opened, null, '仅子元素文字不得 open（不展平）');
  assert.ok(sb.__toasts.some(t => t.includes('该元素无可编辑文字')), '仅子元素文字同样提示无可编辑文字');
  // 5) DIV 有直接文字须 open（不限标签证明）
  sb.__opened = null; sb.__toasts.length = 0; sb.INLINE_EDIT.open = false;
  const divEl = mkChromeEl({ tagName: 'DIV' });
  const evDiv = mkEv('DIV'); evDiv.target = divEl;
  sb.editDblClick(evDiv);
  assert.strictEqual(sb.__opened, divEl, 'DIV 有直接文字须 open（不限标签）');
  assert.strictEqual(evDiv._pd, true, '合法进入须 preventDefault');
  // 6) 合法 P 有直接文字：open
  sb.__opened = null; sb.__toasts.length = 0; sb.INLINE_EDIT.open = false;
  const pEl = mkChromeEl({ tagName: 'P' });
  const ev = mkEv('P'); ev.target = pEl;
  sb.editDblClick(ev);
  assert.strictEqual(sb.__opened, pEl, 'P 有直接文字须 open');
  assert.strictEqual(ev._pd, true, '合法进入须 preventDefault');
}

// ── A13 Ctrl+Shift+click委托代码编辑抽屉（源码级：editDblClick仅供纯双击） ──
function testA13_CtrlShiftClickDelegatesSrc() {
  const body = extractFn(editSrc, 'editClick');
  assert.ok(body, '须能提取 editClick');
  assert.ok(body.includes('(ev.ctrlKey||ev.metaKey)&&ev.shiftKey'), 'editClick须有 Ctrl+Shift分支 (ctrlKey||metaKey)&&shiftKey');
  assert.ok(body.includes('codeEditOpenFromLive(_csT)'), 'Ctrl+Shift+click须走代码编辑抽屉（codeEditOpenFromLive）');
  assert.ok(body.includes('_csT') && body.includes("typeof codeEditOpenFromLive==='function'"), '委托须取ev.target为_csT并判函数可用');
  assert.ok(body.includes('CTRL_PICK.holding=false') && body.includes('CTRL_PICK.exit()'),
    '委托前须清holding并exit（不残留准星/悬停，不进拾取）');
  assert.ok(body.includes('ev.preventDefault(); ev.stopPropagation();'), 'Ctrl+Shift分支须preventDefault+stopPropagation');
  const iShift = body.indexOf('(ev.ctrlKey||ev.metaKey)&&ev.shiftKey');
  const iToggle = body.indexOf('CTRL_PICK.toggle');
  assert.ok(iShift >= 0 && iToggle >= 0 && iShift < iToggle, 'Ctrl+Shift分支须在原CTRL_PICK.toggle之前return（不进拾取）');
  assert.ok(body.includes('if(ev.ctrlKey || ev.metaKey){'), '原Ctrl+单击分支须保留（仅Ctrl/Cmd无Shift仍走拾取）');
  assert.ok(editSrc.includes("d.addEventListener('click', editClick, true)"), 'frame须绑定click->editClick（Ctrl+Shift可达）');
}

// ── A14 抑制高亮+浮层互斥+原行为不动（源码级） ──
function testA14_CtrlShiftSuppressAndCompatSrc() {
  const hover = extractFn(editSrc, 'editHover');
  const click = extractFn(editSrc, 'editClick');
  const dbl = extractFn(editSrc, 'editDblClick');
  assert.ok(hover && click && dbl, '须能提取 editHover/editClick/editDblClick');
  // 1) 按住不启动高亮
  assert.ok(hover.includes('ev.shiftKey&&(ev.ctrlKey||ev.metaKey)'), 'editHover须有Ctrl+Shift抑制分支');
  assert.ok(hover.includes('CTRL_PICK.hovering=null'), '抑制须清CTRL_PICK.hovering');
  assert.ok(hover.includes('editHideHover()'), '抑制须editHideHover（不残留高亮框）');
  const iGuard = hover.indexOf('shiftKey');
  const iShow = hover.indexOf('editShowHover');
  assert.ok(iGuard >= 0 && iShow >= 0 && iGuard < iShow, '抑制须在editShowHover之前return（按住不启动高亮）');
  assert.ok(editSrc.includes("d.addEventListener('mousemove', editHover, true)"), 'mousemove->editHover绑定须保留');
  // 2) 浮层已开再按无效
  assert.ok(hover.includes('INLINE_EDIT') && hover.includes('INLINE_EDIT.open'), 'editHover须判INLINE_EDIT.open互斥（已开不进高亮）');
  assert.ok(click.includes('INLINE_EDIT') && click.includes('INLINE_EDIT.open'), 'editClick须判INLINE_EDIT.open（已开再按无效，不重开）');
  assert.ok(dbl.includes("inlineEditToast('请先保存或放弃当前就地改。')"), 'editDblClick已开提示须保留（互斥语义一致，供Ctrl+Shift委托）');
  // 3) 原行为不动（Ctrl穿透/拾取链不动；原dblclick绑定已删，函数仅作委托入口）
  assert.ok(dbl.includes('if(ev&&(ev.ctrlKey||ev.metaKey))return;'), 'editDblClick Ctrl/Cmd穿透须保留（代理剥键后可达）');
  assert.ok(click.includes('CTRL_PICK.toggle(t, ev)'), '原Ctrl+单击须仍走CTRL_PICK.toggle');
  assert.ok(click.includes('CTRL_PICK.holding = true') && click.includes('CTRL_PICK.enter()'), '原Ctrl+单击置位holding+enter须保留');
  assert.ok(editSrc.includes('!e.shiftKey'), 'keydown须要求!e.shiftKey（Ctrl+Shift不置holding）');
  assert.ok(editSrc.includes('function editDblClick('), 'editDblClick实现须保留（供Ctrl+Shift委托，原dblclick绑定已删）');
}

// ── S4 Ctrl+Shift+click运行时分发（vm真执行 editClick→codeEditOpenFromLive） ──
function testS4_CtrlShiftClickDispatch() {
  const srcClick = extractFn(editSrc, 'editClick');
  const srcDedup = extractFn(editSrc, 'editEvtDedup');
  assert.ok(srcClick && srcDedup, '须能提取 editClick/editEvtDedup');
  const sb = {
    console, JSON, RegExp, String,
    CTRL_PICK: {
      holding: false, hovering: null, exitN: 0, enterN: 0, toggleN: 0,
      exit() { this.exitN++; }, enter() { this.enterN++; }, toggle() { this.toggleN++; },
    },
    INLINE_EDIT: { open: false },
    __codeTarget: null,
    codeEditOpenFromLive(t) { sb.__codeTarget = t; },
    showToast() {}, libStatus() {},
  };
  sb.window = sb; sb.LinkBind = null;
  vm.createContext(sb);
  vm.runInContext('var EDIT_HOVER_EL=null;\nvar EDIT_LOCKED_EL=null;\nvar _editEvtSeen={type:\'\',stamp:-1,target:null};\n'
    + srcDedup + '\n' + srcClick, sb, { filename: 'inline-edit-ctrlshift' });
  sb.editClick = vm.runInContext('editClick', sb);
  const mkEv = (tag, over) => Object.assign({
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    target: mkChromeEl({ tagName: tag }),
    preventDefault() { this._pd = true; }, stopPropagation() { this._sp = true; },
  }, over || {});
  const reset = () => { sb.__codeTarget = null; sb.CTRL_PICK.holding = false; sb.CTRL_PICK.toggleN = 0; sb.CTRL_PICK.exitN = 0; };
  // 1) Ctrl+Shift+click(P) → 代码编辑抽屉，不进拾取
  reset();
  const pEl = mkChromeEl({ tagName: 'P' });
  const evCs = mkEv('P', { ctrlKey: true, shiftKey: true }); evCs.target = pEl;
  sb.editClick(evCs);
  assert.strictEqual(sb.__codeTarget, pEl, 'Ctrl+Shift+click须调 codeEditOpenFromLive');
  assert.strictEqual(evCs._pd, true, 'Ctrl+Shift须preventDefault');
  assert.strictEqual(sb.CTRL_PICK.toggleN, 0, 'Ctrl+Shift不得进CTRL_PICK.toggle（不进拾取）');
  // 2) Cmd+Shift 同样进抽屉
  reset();
  const pMeta = mkChromeEl({ tagName: 'P' });
  const evMeta = mkEv('P', { metaKey: true, shiftKey: true }); evMeta.target = pMeta;
  sb.editClick(evMeta);
  assert.strictEqual(sb.__codeTarget, pMeta, 'Cmd+Shift+click须同样进抽屉');
  assert.strictEqual(sb.CTRL_PICK.toggleN, 0, 'Cmd+Shift不得进拾取');
  // 3) holding须被清除并exit
  reset(); sb.CTRL_PICK.holding = true;
  const pHold = mkChromeEl({ tagName: 'P' });
  const evHold = mkEv('P', { ctrlKey: true, shiftKey: true }); evHold.target = pHold;
  sb.editClick(evHold);
  assert.strictEqual(sb.CTRL_PICK.holding, false, 'Ctrl+Shift须清holding');
  assert.strictEqual(sb.CTRL_PICK.exitN, 1, '须调CTRL_PICK.exit清准星');
  assert.strictEqual(sb.__codeTarget, pHold, '清holding后仍须进抽屉');
  // 4) 原行为不变：纯Ctrl+单击仍走拾取不进抽屉
  reset();
  const evCtrl = mkEv('P', { ctrlKey: true, shiftKey: false }); evCtrl.target = mkChromeEl({ tagName: 'P' });
  sb.editClick(evCtrl);
  assert.strictEqual(sb.CTRL_PICK.toggleN, 1, '原Ctrl+单击须仍走CTRL_PICK.toggle（不动）');
  assert.strictEqual(sb.__codeTarget, null, '原Ctrl+单击不得进抽屉');
}

// ── S5 editHover抑制运行时（vm真执行：按住不启动高亮） ──
function testS5_CtrlShiftHoverSuppress() {
  const srcHover = extractFn(editSrc, 'editHover');
  assert.ok(srcHover, '须能提取 editHover');
  const sb = {
    console, JSON, RegExp, String,
    CTRL_PICK: { holding: false, hovering: null },
    INLINE_EDIT: { open: false },
    __hide: 0, __show: 0, __showArg: null,
    editHideHover() { sb.__hide++; },
    editShowHover(t) { sb.__show++; sb.__showArg = t; },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext('var EDIT_HOVER_EL=null;\n' + srcHover, sb, { filename: 'inline-edit-hover' });
  sb.editHover = vm.runInContext('editHover', sb);
  const mkEv = (t, over) => Object.assign({ ctrlKey: false, metaKey: false, shiftKey: false, target: t }, over || {});
  // 1) Ctrl+Shift按住不启动高亮（holding真/假均抑制）：清hovering、hide、不show
  for (const holding of [false, true]) {
    sb.CTRL_PICK.holding = holding; sb.CTRL_PICK.hovering = mkChromeEl({ tagName: 'P' });
    sb.__hide = 0; sb.__show = 0; sb.__showArg = null; sb.INLINE_EDIT.open = false;
    const p = mkChromeEl({ tagName: 'P' });
    sb.editHover(mkEv(p, { ctrlKey: true, shiftKey: true }));
    assert.strictEqual(sb.CTRL_PICK.hovering, null, `Ctrl+Shift须清hovering（holding=${holding}）`);
    assert.strictEqual(sb.__hide, 1, `Ctrl+Shift须hide（holding=${holding}）`);
    assert.strictEqual(sb.__show, 0, `Ctrl+Shift不得show（holding=${holding}，不启动高亮）`);
  }
  // 1b) Cmd+Shift同样抑制
  sb.CTRL_PICK.holding = true; sb.CTRL_PICK.hovering = mkChromeEl({ tagName: 'P' });
  sb.__hide = 0; sb.__show = 0; sb.INLINE_EDIT.open = false;
  sb.editHover(mkEv(mkChromeEl({ tagName: 'P' }), { metaKey: true, shiftKey: true }));
  assert.strictEqual(sb.CTRL_PICK.hovering, null, 'Cmd+Shift须清hovering');
  assert.strictEqual(sb.__show, 0, 'Cmd+Shift不得show');
  // 2) 原高亮不动：纯Ctrl holding mousemove仍高亮
  sb.CTRL_PICK.holding = true; sb.CTRL_PICK.hovering = null; sb.__hide = 0; sb.__show = 0; sb.INLINE_EDIT.open = false;
  const p2 = mkChromeEl({ tagName: 'P' });
  sb.editHover(mkEv(p2, { ctrlKey: true, shiftKey: false }));
  assert.strictEqual(sb.CTRL_PICK.hovering, p2, '原Ctrl holding悬停须仍置hovering（不动）');
  assert.strictEqual(sb.__show, 1, '原Ctrl holding须仍show高亮（不动）');
  assert.strictEqual(sb.__showArg, p2, 'show须为当前元素');
  // 3) 浮层已开再按无效：任何hover均不show
  sb.CTRL_PICK.holding = true; sb.CTRL_PICK.hovering = null; sb.__hide = 0; sb.__show = 0; sb.INLINE_EDIT.open = true;
  sb.editHover(mkEv(mkChromeEl({ tagName: 'P' }), { ctrlKey: true, shiftKey: false }));
  assert.strictEqual(sb.__show, 0, '已开浮层时hover不得show');
  sb.__hide = 0; sb.__show = 0;
  sb.editHover(mkEv(mkChromeEl({ tagName: 'P' }), { ctrlKey: true, shiftKey: true }));
  assert.strictEqual(sb.__show, 0, '已开浮层时Ctrl+Shift hover也不得show');
  sb.INLINE_EDIT.open = false;
  // 4) 非holding无修饰不进高亮（原行为）
  sb.CTRL_PICK.holding = false; sb.__show = 0; sb.__hide = 0;
  sb.editHover(mkEv(mkChromeEl({ tagName: 'P' }), {}));
  assert.strictEqual(sb.__show, 0, '非holding无修饰不得show（原行为）');
}

// ── S6 GetDirectText 多行分段拼接运行时（直接文本按序+br占一个\n，子元素不展平） ──
function testS6_GetDirectTextRuntime() {
  const fn = evalFn(extractFn(editSrc, 'inlineEditGetDirectText'), 'inlineEditGetDirectText');
  const el = (children) => ({ nodeType: 1, tagName: 'P', childNodes: children });
  assert.strictEqual(fn(el([mkT('hello')])), 'hello', '单段直接文本原样');
  assert.strictEqual(fn(el([mkT('a'), mkBr(), mkT('b')])), 'a\nb', 'br 须占一个换行位（多行分段）');
  assert.strictEqual(fn(el([mkT('a'), mkBr(), mkBr(), mkT('b')])), 'a\n\nb', '连续 br 须占两个换行位（不压缩）');
  assert.strictEqual(fn(el([mkT('a'), mkSpanEl('X'), mkT('b')])), 'ab', '子元素丢弃且相邻文本直接拼接（不补空格）');
  assert.strictEqual(fn(el([mkT('A'), mkBr(), mkT('B'), mkSpanEl('C'), mkT('D')])), 'A\nBD', '顺序分段拼接：文本+br换行+子元素丢弃');
  assert.strictEqual(fn(el([mkT('a\r\nb')])), 'a\r\nb', '文本内换行原文保留（归一在保存侧）');
  assert.strictEqual(fn(el([mkT('  a   b  ')])), '  a   b  ', '空白原文保留（不压缩不去首尾）');
  assert.strictEqual(fn(el([mkSpanEl('X')])), '', '纯子元素初值须为空（不展平）');
  assert.strictEqual(fn(el([])), '', '空元素初值须为空');
  assert.strictEqual(fn(null), '', 'null 初值须为空');
}

// ── S7 ApplyDirectText 多行分段回填运行时（逐段映射、多余并末段、不足保留、子元素/br不动） ──
function testS7_ApplyDirectTextRuntime() {
  const fn = evalFn(extractFn(editSrc, 'inlineEditApplyDirectText'), 'inlineEditApplyDirectText');
  const hit = (children) => ({ nodeType: 1, tagName: 'P', childNodes: children });
  // 1) 等段逐段映射
  {
    const t1 = mkT('A'), t2 = mkT('B');
    const r = fn(hit([t1, t2]), 'x\ny');
    assert.strictEqual(r.ok, true, '等段须 ok');
    assert.strictEqual(r.overflow, false, '等段 overflow=false');
    assert.strictEqual(t1.nodeValue, 'x', '首段映射 x');
    assert.strictEqual(t2.nodeValue, 'y', '次段映射 y');
    assert.strictEqual(r.applied, 2, 'applied=2（等段全映射）');
    assert.strictEqual(r.total, 2, 'total=2');
  }
  // 2) 多余并入末段 + overflow=true
  {
    const t1 = mkT('A'), t2 = mkT('B');
    const r = fn(hit([t1, t2]), 'x\ny\nz');
    assert.strictEqual(r.ok, true, '多余须 ok');
    assert.strictEqual(r.overflow, true, '多余须 overflow=true（并入末段）');
    assert.strictEqual(t1.nodeValue, 'x', '首段仍 x');
    assert.strictEqual(t2.nodeValue, 'y\nz', '末段合并 y\\nz');
    assert.strictEqual(r.applied, 2, 'applied=2（末段合并计数）');
  }
  // 2b) 单段承接多行并末段
  {
    const t1 = mkT('A');
    const r = fn(hit([t1]), '1\n2\n3');
    assert.strictEqual(r.ok, true, '单段多行须 ok');
    assert.strictEqual(r.overflow, true, '单段多余须 overflow=true');
    assert.strictEqual(t1.nodeValue, '1\n2\n3', '单段合并 1\\n2\\n3');
    assert.strictEqual(r.applied, 1, 'applied=1');
  }
  // 3) 不足保留原文（不再置空）
  {
    const t1 = mkT('A'), t2 = mkT('B'), t3 = mkT('C');
    const r = fn(hit([t1, t2, t3]), 'only');
    assert.strictEqual(r.ok, true, '不足须 ok');
    assert.strictEqual(r.overflow, false, '不足须 overflow=false');
    assert.strictEqual(t1.nodeValue, 'only', '首段更新');
    assert.strictEqual(t2.nodeValue, 'B', '次段保留原文 B（不足保留）');
    assert.strictEqual(t3.nodeValue, 'C', '末段保留原文 C（不足保留）');
    assert.strictEqual(r.applied, 1, 'applied=1');
    assert.strictEqual(r.total, 3, 'total=3');
  }
  // 3b) 部分不足：前段映射、末段保留
  {
    const t1 = mkT('A'), t2 = mkT('B'), t3 = mkT('C');
    const r = fn(hit([t1, t2, t3]), 'x\ny');
    assert.strictEqual(r.ok, true, '部分不足须 ok');
    assert.strictEqual(t1.nodeValue, 'x', '首段 x');
    assert.strictEqual(t2.nodeValue, 'y', '次段 y');
    assert.strictEqual(t3.nodeValue, 'C', '末段保留原文 C');
    assert.strictEqual(r.overflow, false, '不足仍 overflow=false');
    assert.strictEqual(r.applied, 2, 'applied=2');
  }
  // 4) br/子元素不动，仅文本节点分段映射
  {
    const t1 = mkT('A'), br = mkBr(), t2 = mkT('B'), sp = mkSpanEl('S');
    const h = hit([t1, br, t2, sp]);
    const n = h.childNodes.length;
    const r = fn(h, 'x\ny');
    assert.strictEqual(r.ok, true, '含 br/子元素须 ok');
    assert.strictEqual(t1.nodeValue, 'x', '首文本映射 x');
    assert.strictEqual(t2.nodeValue, 'y', '次文本映射 y');
    assert.strictEqual(h.childNodes.length, n, '子节点数不变');
    assert.strictEqual(h.childNodes[1], br, 'br 对象不动');
    assert.strictEqual(h.childNodes[1].tagName, 'BR', 'br 仍为 BR');
    assert.strictEqual(h.childNodes[3], sp, 'span 对象不动');
    assert.strictEqual(sp.childNodes[0].nodeValue, 'S', 'span 内部文字不动');
    assert.strictEqual(r.overflow, false, '等段不 overflow');
  }
  // 4b) 含 br/子元素多余并末段
  {
    const t1 = mkT('A'), br = mkBr(), t2 = mkT('B'), sp = mkSpanEl('S');
    const h = hit([t1, br, t2, sp]);
    const r = fn(h, 'x\ny\nz');
    assert.strictEqual(r.ok, true, '含结构多余须 ok');
    assert.strictEqual(t1.nodeValue, 'x', '首文本 x');
    assert.strictEqual(t2.nodeValue, 'y\nz', '末文本合并 y\\nz');
    assert.strictEqual(r.overflow, true, '多余须 overflow=true');
    assert.strictEqual(h.childNodes[1], br, 'br 仍不动（数量不变）');
    assert.strictEqual(sp.childNodes[0].nodeValue, 'S', 'span 内部仍不动');
  }
  // 5) 无直接文字
  {
    const r1 = fn(hit([]), 'x');
    assert.strictEqual(r1.ok, false, '空元素须 ok=false');
    const r2 = fn(hit([mkSpanEl('hi')]), 'x');
    assert.strictEqual(r2.ok, false, '纯子元素须 ok=false（无可编辑直接文字）');
  }
  // 6) \r\n/\r 归一为\n后分段
  {
    const t1 = mkT('A'), t2 = mkT('B');
    const r = fn(hit([t1, t2]), 'x\r\ny');
    assert.strictEqual(r.ok, true, '\\r\\n 须 ok');
    assert.strictEqual(t1.nodeValue, 'x', '\\r\\n 归一后首段 x');
    assert.strictEqual(t2.nodeValue, 'y', '\\r\\n 归一后次段 y');
    assert.strictEqual(r.overflow, false, '归一等段不 overflow');
  }
  {
    const t1 = mkT('A'), t2 = mkT('B');
    const r = fn(hit([t1, t2]), 'a\rb\nc');
    assert.strictEqual(t1.nodeValue, 'a', '\\r 归一后首段 a');
    assert.strictEqual(t2.nodeValue, 'b\nc', '多余合并 b\\nc');
    assert.strictEqual(r.overflow, true, '归一后多余须 overflow=true');
  }
  {
    const t1 = mkT('A');
    const r = fn(hit([t1]), 'a   b');
    assert.strictEqual(t1.nodeValue, 'a   b', '连续空白原文保留（不压缩）');
    assert.strictEqual(r.overflow, false, '单段单行不 overflow');
  }
}

// ── A15 浮层视口钳制（源码级：上一批新增 inlineEditPosition，视口内钳制+上翻+重定位联动） ──
function testA15_ClampSrc() {
  const body = extractFn(editSrc, 'inlineEditPosition');
  assert.ok(body, '须能提取 inlineEditPosition');
  assert.ok(body.includes('var vw=window.innerWidth||1024,vh=window.innerHeight||768'), '须取视口 vw/vh（默认1024x768）');
  assert.ok(body.includes('left=Math.max(8,Math.min(left,Math.max(8,vw-w-8)))'), '水平须钳制 8..vw-w-8');
  assert.ok(body.includes('if(top+h>vh-8){ top=p.top-h-8; }'), '下方放不下须上翻 p.top-h-8');
  assert.ok(body.includes('top=Math.max(8,Math.min(top,Math.max(8,vh-h-8)))'), '垂直须钳制 8..vh-h-8');
  assert.ok(body.includes("pop.style.left=left+'px'") && body.includes("pop.style.top=top+'px'"), '须回写 left/top');
  // 重定位联动：frame scroll / window resize-open 时调用
  assert.ok(editSrc.includes("d.addEventListener('scroll'") && editSrc.includes('inlineEditPosition()'), 'frame scroll须触发 inlineEditPosition 重定位');
  assert.ok(editSrc.includes("window.addEventListener('resize'") && editSrc.includes('inlineEditPosition'), 'window resize须重定位');
}

// ── A16 代码编辑委托 + 失败toast（源码级：Ctrl+Shift 走 codeEditOpenFromLive，失败toast链不变） ──
function testA16_ProxyToastSrc() {
  const clickBody = extractFn(editSrc, 'editClick');
  assert.ok(clickBody, '须能提取 editClick');
  // 新委托：Ctrl+Shift 直接调 codeEditOpenFromLive（代码编辑抽屉），不再拼代理对象
  assert.ok(clickBody.includes('codeEditOpenFromLive(_csT)'), 'Ctrl+Shift须委托 codeEditOpenFromLive');
  assert.ok(clickBody.includes("typeof codeEditOpenFromLive==='function'"), '委托前须判函数可用');
  // 失败toast链：showToast->libStatus->alert
  const toastBody = extractFn(editSrc, 'inlineEditToast');
  assert.ok(toastBody, '须有 inlineEditToast');
  assert.ok(toastBody.includes("typeof showToast==='function'") && toastBody.includes("typeof libStatus==='function'") && toastBody.includes('alert(msg)'),
    '失败toast须 showToast->libStatus->alert 三段回退');
  const openBody = extractFn(editSrc, 'inlineEditOpen');
  assert.ok(openBody, '须能提取 inlineEditOpen（纯双击链路保留）');
  assert.ok(openBody.includes('未能定位目标元素，请重试或用Ctrl+拾取走AI队列。'), 'open失败须toast未能定位');
  assert.ok(openBody.includes('读取元素位置失败，请用Ctrl+拾取走AI队列。'), 'open失败须toast读取位置失败');
  assert.ok(openBody.includes('就地改浮层打开失败，请用Ctrl+拾取走AI队列。'), 'open失败须toast浮层打开失败');
  // 防重入在双入口均生效（window+document双触发不重开）
  const dblBody = extractFn(editSrc, 'editDblClick');
  assert.ok(clickBody.includes('if(editEvtDedup(ev))return;'), 'editClick须防重入 editEvtDedup');
  assert.ok(dblBody.includes('if(editEvtDedup(ev))return;'), 'editDblClick须同样防重入（window+document双触发不重开）');
}

function runAll() {
  const tests = [
    ['A1 不限标签+直接文本叶准入', testA1_WhitelistSrc],
    ['A2 chrome排除', testA2_ChromeSrc],
    ['A3 无dblclick绑定+window抢占防重入', testA3_DblclickBindSrc],
    ['A4 Ctrl穿透与holding互斥', testA4_CtrlPassthroughSrc],
    ['A5 保存恰1+多行分段回填（多余并末段/不足保留）', testA5_SaveExactlyOneSrc],
    ['A6 多行浮层修改无hint+textarea分段拼接', testA6_InitHtmlSrc],
    ['A7 失败转AI队列', testA7_FallbackSrc],
    ['A8 互斥与AI忙禁', testA8_MutexBusySrc],
    ['A9 写通道readFile/write复用', testA9_WriteChannelSrc],
    ['A10 无新增script', testA10_NoNewScript],
    ['A11 浮层样式宽440+内嵌右下按钮', testA11_PopCss],
    ['A12 回车换行与Ctrl+Enter保存+脏confirm(initText)', testA12_KeysDirtySrc],
    ['A13 CtrlShift委托同入口', testA13_CtrlShiftClickDelegatesSrc],
    ['A14 抑制高亮互斥与兼容', testA14_CtrlShiftSuppressAndCompatSrc],
    ['A15 浮层视口钳制', testA15_ClampSrc],
    ['A16 代码编辑委托+失败toast', testA16_ProxyToastSrc],
    ['S1 IsTextTag不限标签', testS1_TextTagRuntime],
    ['S1b HasDirectText真值表', testS1b_HasDirectTextRuntime],
    ['S2 IsChrome真值表', testS2_ChromeRuntime],
    ['S3 无文字拒绝+不限标签分发', testS3_DblclickDispatch],
    ['S4 CtrlShift进代码编辑抽屉', testS4_CtrlShiftClickDispatch],
    ['S5 Hover抑制语义', testS5_CtrlShiftHoverSuppress],
    ['S6 GetDirectText分段拼接（br占位）', testS6_GetDirectTextRuntime],
    ['S7 ApplyDirectText分段回填（并末段/保留）', testS7_ApplyDirectTextRuntime],
  ];
  let passed = 0, failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(failed ? 'INLINE_EDIT_FAIL' : `INLINE_EDIT_PASS: 全部${tests.length}项就地改断言通过`);
  process.exitCode = failed ? 1 : 0;
}
runAll();
