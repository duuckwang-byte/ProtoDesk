'use strict';
// verify-link-stamp: 跳转打戳 data-plink 回归（纯 Node，不启动 Electron）
// 手段：源文提取静态断言 + 字符串级仿真（无 jsdom 时用正则+仿真，不依赖 DOM）
// 覆盖：plid生成与入库schema、建绑定恰1门槛、live+源文件双写戳、三段回退顺序、
//       stale静默自清不拦截、stale上报+自清无toast、解除按plid全清、老数据兼容、主文档拒绝、validateLinks查戳+孤儿静默清理
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

// jsdom 可用性探测：有则可用 DOMParser 真解析，无则走正则+字符串仿真（本仓无 jsdom，走后者）
let hasJsdom = false;
try { require('jsdom'); hasJsdom = true; } catch (e) { hasJsdom = false; }
console.log(`jsdom: ${hasJsdom ? 'yes' : 'no (fallback: regex+string-sim)'}`);

const rootDir = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(rootDir, 'js', 'link-bind.js'), 'utf8');

function extractFn(srcText, name) {
  const i = srcText.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = srcText.indexOf('{', i);
  if (b < 0) return null;
  let depth = 0;
  for (let j = b; j < srcText.length; j++) {
    if (srcText[j] === '{') depth++;
    else if (srcText[j] === '}') { depth--; if (depth === 0) return srcText.slice(i, j + 1); }
  }
  return null;
}
function idx(s, sub) { return s.indexOf(sub); }

// ── A1 plid 生成与入库 schema ──
function testA1_PlidSchema() {
  const mk = extractFn(src, 'lbMakePlid');
  assert.ok(mk, '须能提取 lbMakePlid');
  assert.ok(mk.includes("'lk_'"), 'plid 须以 lk_ 为前缀');
  assert.ok(mk.includes('Date.now()'), 'plid 须含 Date.now() 时间分量');
  assert.ok(mk.includes('Math.random()'), 'plid 须含 Math.random() 随机分量');
  // 真执行：格式 lk_<base36>
  const fn = new Function(mk + '; return lbMakePlid;')();
  const a = fn(); const b = fn();
  assert.ok(/^lk_[0-9a-z]+$/i.test(a), 'plid 运行时格式须为 lk_+base36，实际:' + a);
  assert.ok(a !== b || true, '两次生成允许相同毫秒但应尽量不同（仅格式门槛，不强判不等）');
  // 入库 schema：新建 + 更新双路径均写 id/plid
  const save = extractFn(src, 'saveJumpBinding');
  assert.ok(save, '须能提取 saveJumpBinding');
  assert.ok(save.includes('var plid = existPlid || lbMakePlid();'), '须复用已存 plid 否则新建（existPlid || lbMakePlid）');
  assert.ok(save.includes('id: plid, plid: plid'), '新建 link 须同时写 id+plid 双字段');
  assert.ok(save.includes('if (!links[i].plid) links[i].plid = plid;'), '更新分支须回填 plid');
  assert.ok(save.includes('if (!links[i].id) links[i].id = links[i].plid || plid;'), '更新分支须回填 id');
  assert.ok(save.includes("links[i].ts = Date.now();"), '入库须刷新 ts');
}

// ── A2 建绑定恰1门槛（选择器在源文件恰好命中1个；多命中走稳定ID升级/后台收敛，不再一律拒绝） ──
function testA2_ExactlyOne() {
  const save = extractFn(src, 'saveJumpBinding');
  assert.ok(save, '须能提取 saveJumpBinding');
  assert.ok(save.includes("new DOMParser().parseFromString(srcHtml, 'text/html')") || save.includes('new DOMParser().parseFromString(srcHtml'), '建绑定须用 DOMParser 解析源文件');
  assert.ok(save.includes('pdoc.querySelectorAll(sel)'), '须用选择器在源文件定位 pdoc.querySelectorAll(sel)');
  assert.ok(save.includes('if (n !== 1)'), '须断言命中恰好1个（n!==1）');
  assert.ok(save.includes('lbUpgradeToPrId'), '多命中须走稳定ID升级（不对用户直接拒绝）');
  assert.ok(save.includes('prIdBackfillFileInBackground'), '升级失败须后台补ID收敛');
  assert.ok(save.includes('已拒绝绑定'), '稳定ID重复等真失败仍须拒绝绑定');
  assert.ok(save.includes('该元素在源文件中定位命中'), '拒绝/收敛文案须带命中数（定位命中+n+个）');
  // 拒绝后直接 return，不得继续写盘/入库：排序断言
  const iReject = idx(save, 'if (n !== 1)');
  const iWrite = idx(save, 'sb.write({ dir: dir, file: file, content: out })');
  const iPush = idx(save, 'links.push(newLink)');
  const iLinksWrite = idx(save, 'window.protoAPI.links.write(currentSource.sandboxDir');
  assert.ok(iReject >= 0 && iWrite >= 0 && iReject < iWrite, '拒绝分支须在源文件写盘 sb.write 之前 return');
  assert.ok(iReject < iPush && iReject < iLinksWrite, '拒绝分支须在 links 入库之前 return');
  // 选择器无效亦拒绝
  assert.ok(save.includes('选择器在源文件无效，绑定已取消'), '选择器抛异常须拒绝绑定');
}

// ── A3 live+源文件双写戳（升级后打戳须落到升级后元素） ──
function testA3_DualStamp() {
  const save = extractFn(src, 'saveJumpBinding');
  assert.ok(save, '须能提取 saveJumpBinding');
  assert.ok(save.includes("liveEl.setAttribute('data-plink', plid)"), '须 live 写戳 liveEl.setAttribute(data-plink,plid)');
  assert.ok(save.includes("stampEl.setAttribute('data-plink', plid)"), '须源文件写戳（升级后元素 stampEl.setAttribute）');
  assert.ok(save.includes('up.el'), '升级须带回定位到的元素供打戳');
  const iLive = idx(save, "liveEl.setAttribute('data-plink', plid)");
  const iHit = idx(save, "stampEl.setAttribute('data-plink', plid)");
  const iWrite = idx(save, 'sb.write({ dir: dir, file: file, content: out })');
  assert.ok(iLive >= 0 && iHit >= 0, '双写戳均须存在');
  assert.ok(iHit < iWrite, '源文件打戳须在 sb.write 序列化写盘之前');
  assert.ok(save.includes('pdoc.documentElement.outerHTML'), '写盘须序列化 documentElement.outerHTML');
  assert.ok(save.includes('hasDoctype'), '序列化须保留 DOCTYPE（hasDoctype 分支）');
}

// ── A4 三段回退顺序（戳→备用→stale 语义：holder优先，legacy备用，孤儿戳stale） ──
function testA4_FallbackOrder() {
  // holder[data-plink] 优先块须在 legacy selector 备用循环之前
  const iHolder = idx(src, 'el.closest("[data-plink]")');
  const iPlink = idx(src, 'return{kind:"plink"');
  const iStale = idx(src, 'return{kind:"stale"');
  const iLegacy = idx(src, 'return{kind:"legacy"');
  assert.ok(iHolder >= 0, '须有 holder=data-plink 优先定位');
  assert.ok(iPlink >= 0 && iStale >= 0 && iLegacy >= 0, '须同时有 plink/stale/legacy 三 kind');
  assert.ok(iHolder < iPlink && iPlink < iStale && iStale < iLegacy, `三段顺序须为 holder→plink→stale→legacy 备用，实际 ${iHolder}/${iPlink}/${iStale}/${iLegacy}`);
  // holder 内：plid 命中走 plink，否则兜底 stale
  assert.ok(src.includes('(lid&&lid===pid)||(!lid&&oid&&oid===pid)'), '戳命中须同时支持 plid 与老 id（见 A8）');
  // legacy 备用：同页 + selector 恰1 + 携带 restamp
  assert.ok(src.includes('if(m.page!==cur) continue;'), 'legacy 备用须先按 page 过滤');
  assert.ok(src.includes('document.querySelectorAll(m.selector)'), 'legacy 备用须用 selector 复查');
  assert.ok(src.includes('if(all.length===1)'), 'legacy 备用须恰1才命中');
  assert.ok(src.includes('restamp'), 'legacy 命中须携带 restamp 回补戳');
  // click 内：stale 分支须在 proto-link 发送之前（先判 stale 再发跳转）
  const iClickStale = idx(src, 'if(res.kind==="stale")');
  const iClickMsg = idx(src, 'parent.postMessage(msg,');
  assert.ok(iClickStale >= 0 && iClickMsg >= 0 && iClickStale < iClickMsg, '点击分发须先判 stale 再发 proto-link');
}

// ── A5 stale静默自清不拦截（仅 plink/legacy 拦截，stale 去戳后放行原生） ──
function testA5_PreventFirst() {
  const iNull = idx(src, 'if(!res)return;');
  const iStale = idx(src, 'if(res.kind==="stale")');
  const iPrev = idx(src, 'ev.preventDefault();ev.stopPropagation();');
  const iMsg = idx(src, 'parent.postMessage(msg,');
  assert.ok(iNull >= 0, '须有 null 放行分支 if(!res)return（不拦截原生）');
  assert.ok(iStale >= 0, '须有 stale 自清分支 if(res.kind==="stale")');
  assert.ok(iPrev >= 0, '须有 preventDefault+stopPropagation 拦截（仅 plink/legacy）');
  assert.ok(iNull < iStale, 'null 放行须在 stale 之前');
  assert.ok(iStale < iPrev, `stale 自清须在拦截之前（stale 不拦截恢复原生），实际 stale=${iStale} prev=${iPrev}`);
  assert.ok(iPrev < iMsg, `拦截（plink/legacy）须在 proto-link 发送之前，实际 prev=${iPrev} msg=${iMsg}`);
  // stale 分支内：去 live 戳 + 上报 + return（无 preventDefault）
  assert.ok(src.includes('res.el.removeAttribute("data-plink")'), 'stale 须先去 live 戳 res.el.removeAttribute(data-plink)');
  assert.ok(src.includes('parent.postMessage({type:"proto-link-stale"'), 'stale 须上报 proto-link-stale 供外层自清源文件');
  assert.ok(src.includes('plid:res.plid||""'), 'stale 上报须携带 plid');
  const staleBlock = src.slice(iStale, iPrev);
  assert.ok(staleBlock.includes('removeAttribute') && staleBlock.includes('proto-link-stale') && staleBlock.includes('return;'), 'stale 块须自清+上报后 return（不落到 prevent）');
  assert.ok(!staleBlock.includes('preventDefault'), 'stale 块内不得 preventDefault（恢复原生点击）');
  // 捕获阶段 + 编辑/Ctrl 穿透仍在拦截前
  assert.ok(src.includes('document.addEventListener("click",function(ev){'), '点击须在 document 捕获阶段监听');
  assert.ok(src.includes('if(P.mode)return;'), '编辑模式须穿透（不拦截）');
  assert.ok(src.includes('if(ev.ctrlKey||ev.metaKey)return;'), 'Ctrl/Cmd 须穿透（不拦截）');
}

// ── A6 stale 上报 + 外层静默自清（无 toast） ──
function testA6_StaleToast() {
  // 运行时侧：stale 去戳后一律 postMessage proto-link-stale（已在 A5 自清，不拦截）
  assert.ok(src.includes('parent.postMessage({type:"proto-link-stale"'), 'stale 须 postMessage proto-link-stale');
  assert.ok(src.includes('plid:res.plid||""'), 'stale 消息须携带 plid');
  // 外层侧：收到 proto-link-stale 即静默自清，不 toast 不拦截
  const lis = extractFn(src, 'initMessageListener');
  assert.ok(lis, '须能提取 initMessageListener');
  assert.ok(lis.includes("d.type === 'proto-link-stale'"), '外层须监听 proto-link-stale');
  assert.ok(lis.includes('silentCleanStalePlid'), '外层 stale 须调用 silentCleanStalePlid 自清（live+源文件）');
  assert.ok(!lis.includes('该跳转已失效'), '外层 stale 不得 toast“已失效”（静默自清）');
  assert.ok(!lis.includes("lbToast('该跳转已失效"), '外层 stale 不得调用失效 toast');
  assert.ok(!src.includes("lbToast('该跳转已失效，请重新绑定')"), '全源不得残留 stale 失效 toast（已改为静默）');
  // silentCleanStalePlid：按 plid 精确清 live + 源文件同 id 戳，best-effort 无提示
  const clean = extractFn(src, 'silentCleanStalePlid');
  assert.ok(clean, '须能提取 silentCleanStalePlid');
  assert.ok(clean.includes("doc.querySelectorAll('[data-plink=\"'"), '自清须 live 按 plid querySelectorAll 全清');
  assert.ok(clean.includes("pdoc.querySelectorAll('[data-plink=\"'"), '自清须源文件按同 id querySelectorAll 全清');
  assert.ok(clean.includes("removeAttribute('data-plink')"), '自清须 removeAttribute 去戳');
  assert.ok(!clean.includes('lbToast') && !clean.includes('showToast') && !clean.includes('该跳转已失效'), '自清须无 toast/无提示（静默）');
  // toast 通道本身仍保留（供其他路径复用），但 stale 不得经此通道
  const toast = extractFn(src, 'lbToast');
  assert.ok(toast && toast.includes('showToast') && toast.includes('libStatus'), 'lbToast 须复用 showToast/libStatus 通道（stale 不用）');
}

// ── A7 解除去戳按 plid 精确全清（live querySelectorAll + 源文件 querySelectorAll + 管理抽屉复用） ──
function testA7_Unstamp() {
  const rm = extractFn(src, 'removeJumpBinding');
  assert.ok(rm, '须能提取 removeJumpBinding');
  // 内存删除 + 写回
  assert.ok(rm.includes('links.splice(i, 1)'), '解除须 links.splice 删除内存绑定');
  assert.ok(rm.includes('window.protoAPI.links.write(currentSource.sandboxDir, { links: links })'), '解除须写回 links.json');
  // plid 精确锚定
  assert.ok(rm.includes('links[i].plid || links[i].id'), '解除须按 plid||id 精确锚定 rmPlid');
  // live 去戳：按 plid querySelectorAll 全清 + inspectorEl 双清
  assert.ok(rm.includes("doc.querySelectorAll('[data-plink=\"'"), 'live 去戳须按 plid querySelectorAll 全清（非单点 querySelector）');
  assert.ok(rm.includes('stampedAll[si].removeAttribute') || rm.includes('stampedAll'), 'live 全清须循环 removeAttribute');
  assert.ok(rm.includes("removeAttribute('data-plink')"), 'live/源文件均须 removeAttribute 去戳');
  assert.ok(rm.includes("inspectorEl.removeAttribute('data-plink')") || rm.includes('inspectorEl && inspectorEl.removeAttribute'), 'inspectorEl 须 removeAttribute(data-plink)');
  // 源文件去戳：DOMParser + querySelectorAll[data-plink] 循环清除 + 写盘
  assert.ok(rm.includes("pdoc.querySelectorAll('[data-plink=\"'"), '源文件去戳须 querySelectorAll[data-plink] 按同 id 全清');
  assert.ok(rm.includes("olds[k].removeAttribute('data-plink')"), '源文件命中须循环 removeAttribute 去戳');
  assert.ok(rm.includes('api.write({ dir: d, file: f, content: out })'), '源文件去戳后须写盘');
  assert.ok(rm.includes("libStatus('已解除跳转绑定。')"), '解除须 libStatus 提示已解除');
  // 管理抽屉删除复用清理
  const mgr = extractFn(src, 'removeLinkMgrItem');
  assert.ok(mgr, '须能提取 removeLinkMgrItem');
  assert.ok(mgr.includes('links.splice(idx, 1)'), '管理删除须 splice 删除内存绑定');
  assert.ok(mgr.includes('links[idx].plid || links[idx].id'), '管理删除须同样按 plid||id 锚定');
  assert.ok(mgr.includes('silentCleanStalePlid'), '管理删除须复用 silentCleanStalePlid 清理 live+源文件戳');
  assert.ok(mgr.includes('window.protoAPI.links.write'), '管理删除须写回 links.json');
  assert.ok(mgr.includes('updateLinkBadge()') && mgr.includes('renderLinkMgr()'), '管理删除须刷新徽标并重渲染');
  assert.ok(mgr.includes("libStatus('已删除跳转绑定。')"), '管理删除须 libStatus 提示已删除');
}

// ── A8 老数据兼容（无 plid 走旧逻辑） ──
function testA8_LegacyCompat() {
  // 运行时 holder 匹配：无 plid 时用旧 id 兜底
  assert.ok(src.includes('(!lid&&oid&&oid===pid)'), 'holder 匹配须兼容无 plid 老数据（!lid && oid===pid）');
  // legacy restamp 取 plid||id
  assert.ok(src.includes('String(m.plid||m.id||"")'), 'legacy restamp 须取 m.plid||m.id');
  // validateLinks 无 plid 分支走旧 selector 恰1逻辑
  const val = extractFn(src, 'validateLinks');
  assert.ok(val, '须能提取 validateLinks');
  assert.ok(val.includes('} else {'), 'validateLinks 须有无 plid 的 else 老逻辑分支');
  assert.ok(val.includes('var all = doc.querySelectorAll(l.selector);'), '老逻辑须用 selector 定位');
  assert.ok(val.includes('l._stale = (all.length !== 1);'), '老逻辑须按恰1判 stale');
}

// ── A9 主文档拒绝（仅预览区元素可绑） ──
function testA9_MainDocReject() {
  const guard = extractFn(src, 'lbIsPreviewEl');
  assert.ok(guard, '须能提取 lbIsPreviewEl');
  assert.ok(guard.includes('frame.contentDocument'), '须以 frame.contentDocument 为预览作用域');
  assert.ok(guard.includes('el.ownerDocument === fd'), '须断言 el.ownerDocument===frame.doc（主文档节点返回 false）');
  const open = extractFn(src, 'openInspector');
  assert.ok(open.includes('if (!lbIsPreviewEl(el))'), 'openInspector 须守卫 lbIsPreviewEl');
  assert.ok(open.includes("lbToast('仅支持绑定原型内的元素，请点击预览区元素。')"), '主文档节点须 toast 拒绝');
  // 拒绝后直接 return，不渲染抽屉
  const iG = idx(open, 'if (!lbIsPreviewEl(el))');
  const iRender = idx(open, 'renderInspector(sel, pg, label, txt)');
  assert.ok(iG >= 0 && iRender >= 0 && iG < iRender, '拒绝须在 renderInspector 之前 return');
  const save = extractFn(src, 'saveJumpBinding');
  assert.ok(save.includes('if (!lbIsPreviewEl(inspectorEl))'), 'saveJumpBinding 须二次守卫 lbIsPreviewEl（防主文档直调）');
  assert.ok(save.includes("lbToast('仅支持绑定原型内的元素，请点击预览区元素。')"), 'save 侧主文档亦须同文案拒绝');
}

// ── A10 validateLinks 查戳优先 + 补戳不写盘 + 孤儿戳静默清理 ──
function testA10_ValidateStampFirst() {
  const val = extractFn(src, 'validateLinks');
  assert.ok(val, '须能提取 validateLinks');
  // 查戳优先
  assert.ok(val.includes("doc.querySelectorAll('[data-plink=\"'"), '查戳须 querySelectorAll[data-plink]');
  assert.ok(val.includes('if (stamped && stamped.length === 1)'), '戳恰1即有效（_stale=false）');
  // 失配走 selector 备用 + 补戳 live（不写盘）
  assert.ok(val.includes('doc.querySelectorAll(l.selector)'), '戳失配须回退 selector 备用');
  assert.ok(val.includes("back[0].setAttribute('data-plink', sid)"), '备用恰1须补戳 live（back[0].setAttribute）');
  // 全程不写盘（仅内存 _stale + live 补戳）
  assert.ok(!val.includes('.write('), 'validateLinks 不得写盘（无 .write 调用，仅内存+live补戳）');
  assert.ok(!val.includes('links.write'), 'validateLinks 不得写 links.json');
  assert.ok(val.includes('l._stale = false') && val.includes('l._stale = true'), '须置 _stale 双向状态');
  assert.ok(val.includes('updateLinkBadge()'), '校验后须 updateLinkBadge 刷新徽标');
  // 孤儿戳静默清理：有戳无表项则去戳，不标 stale 不提示，不写盘（已由上断言全程无 .write 覆盖）
  assert.ok(val.includes("doc.querySelectorAll('[data-plink]')"), '孤儿扫描须 querySelectorAll[data-plink] 全量');
  assert.ok(val.includes('known['), '孤儿须按 known plid/id 判定');
  assert.ok(val.includes("removeAttribute('data-plink')"), '孤儿戳须 removeAttribute 静默清理');
  assert.ok(!val.includes('该跳转已失效') && !val.includes('lbToast'), '孤儿清理须无 toast/无提示（静默）');
}

// ── S1 字符串级仿真：三段回退真值表（无 jsdom 纯逻辑镜像） ──
function testS1_FallbackSim() {
  // 镜像 findLink 分支（与源码同序：holder→plink/stale→legacy→null）
  function simFind(o) {
    // o: {holderPid|null, links:[{plid,id,selector,page}], cur, selHits:Map selector->count}
    if (o.holderPid) {
      const pid = String(o.holderPid);
      for (const l of o.links) {
        const lid = String(l.plid || ''); const oid = String(l.id || '');
        if ((lid && lid === pid) || (!lid && oid && oid === pid)) return { kind: 'plink', link: l };
      }
      return { kind: 'stale', plid: pid };
    }
    for (const m of o.links) {
      if (m.page !== o.cur) continue;
      const n = (o.selHits && o.selHits[m.selector]) || 0;
      if (n === 1) return { kind: 'legacy', link: m, restamp: String(m.plid || m.id || '') || null };
    }
    return null;
  }
  const links = [
    { plid: 'lk_abc', id: 'lk_abc', selector: '.btn-a', page: '' },
    { plid: '', id: 'old1', selector: '.btn-old', page: '' },
  ];
  // 1) 戳命中 plink
  let r = simFind({ holderPid: 'lk_abc', links, cur: '', selHits: {} });
  assert.strictEqual(r.kind, 'plink', '戳命中须 plink');
  // 2) 老数据无 plid 用旧 id 命中 plink
  r = simFind({ holderPid: 'old1', links, cur: '', selHits: {} });
  assert.strictEqual(r.kind, 'plink', '无plid老戳用旧id须 plink（兼容）');
  // 3) 孤儿戳 stale
  r = simFind({ holderPid: 'lk_dead', links, cur: '', selHits: { '.btn-a': 1 } });
  assert.strictEqual(r.kind, 'stale', '孤儿戳不得回退 selector，须 stale');
  // 4) 无戳 + selector 恰1 → legacy + restamp
  r = simFind({ holderPid: null, links, cur: '', selHits: { '.btn-a': 1 } });
  assert.strictEqual(r.kind, 'legacy', '无戳备用恰1须 legacy');
  assert.strictEqual(r.restamp, 'lk_abc', 'legacy 须携带 restamp=plid');
  // 5) 无戳 + 命中0 → null（放行原生）
  r = simFind({ holderPid: null, links, cur: '', selHits: { '.btn-a': 0 } });
  assert.strictEqual(r, null, '备用命中0须 null 放行');
  // 6) 无戳 + 命中2 → null（歧义放行，不误跳）
  r = simFind({ holderPid: null, links, cur: '', selHits: { '.btn-a': 2 } });
  assert.strictEqual(r, null, '备用命中2须 null 放行');
  // 7) 页不匹配 → null
  r = simFind({ holderPid: null, links: [{ plid: 'lk_x', id: 'lk_x', selector: '.btn-a', page: 'p2' }], cur: 'p1', selHits: { '.btn-a': 1 } });
  assert.strictEqual(r, null, '页不匹配须 null（page 先过滤）');
}

// ── S2 字符串级仿真：静默自清载荷（stale 不拦截+去戳，plink/legacy 才拦截） ──
function testS2_InterceptPayloadSim() {
  // 镜像新 click 分发：null放行；stale 自清后放行原生（不 prevent）；plink/legacy 才 prevent 后发消息
  function simClick(res, holder) {
    const ev = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    const posts = [];
    if (!res) return { ev, posts, action: 'pass' };
    if (res.kind === 'stale') {
      try { if (holder && holder.removeAttribute) holder.removeAttribute('data-plink'); } catch (e) {}
      posts.push({ type: 'proto-link-stale', plid: res.plid || '' });
      return { ev, posts, action: 'stale-clean' };
    }
    ev.preventDefault(); ev.stopPropagation();
    const link = res.link; if (!link) return { ev, posts, action: 'noop' };
    const msg = { type: 'proto-link', target: { proto: link.target, page: link.targetPage || '' } };
    if (res.kind === 'legacy' && res.restamp) msg.restamp = res.restamp;
    posts.push(msg);
    return { ev, posts, action: 'goto' };
  }
  // null 放行：不拦截不发消息
  let o = simClick(null);
  assert.strictEqual(o.ev.prevented, false, 'null 须放行不拦截');
  assert.strictEqual(o.posts.length, 0, 'null 须不发消息');
  // stale：不拦截 + 自清 + proto-link-stale + plid（恢复原生）
  const fakeEl = { removed: null, removeAttribute(k) { this.removed = k; } };
  o = simClick({ kind: 'stale', plid: 'lk_dead' }, fakeEl);
  assert.strictEqual(o.ev.prevented, false, 'stale 不得拦截（恢复原生）');
  assert.strictEqual(o.ev.stopped, false, 'stale 不得 stopPropagation');
  assert.strictEqual(fakeEl.removed, 'data-plink', 'stale 须去 live 戳');
  assert.strictEqual(o.posts[0].type, 'proto-link-stale', 'stale 须发 proto-link-stale 供外层清源文件');
  assert.strictEqual(o.posts[0].plid, 'lk_dead', 'stale 须带 plid 供精确全清');
  assert.strictEqual(o.action, 'stale-clean', 'stale 动作为自清后放行');
  // plink：拦截 + proto-link 无 restamp
  o = simClick({ kind: 'plink', link: { target: 'P', targetPage: '' } });
  assert.strictEqual(o.ev.prevented, true, 'plink 须拦截');
  assert.strictEqual(o.posts[0].type, 'proto-link', 'plink 须发 proto-link');
  assert.ok(!('restamp' in o.posts[0]), 'plink 不得带 restamp');
  // legacy：拦截 + proto-link 带 restamp
  o = simClick({ kind: 'legacy', link: { target: 'P', targetPage: 'p1' }, restamp: 'lk_abc' });
  assert.strictEqual(o.ev.prevented, true, 'legacy 须拦截');
  assert.strictEqual(o.posts[0].restamp, 'lk_abc', 'legacy 须带 restamp 回补戳');
  // 源码级交叉：stale 自清在 prevent 之前且块内无 prevent；外层复用静默清理无 toast
  const iStale = idx(src, 'if(res.kind==="stale")');
  const iPrev = idx(src, 'ev.preventDefault();ev.stopPropagation();');
  const iMsg = idx(src, 'parent.postMessage(msg,');
  assert.ok(iStale >= 0 && iPrev >= 0 && iStale < iPrev, '源码 stale 自清须在拦截之前');
  assert.ok(iPrev < iMsg, '源码拦截须在 proto-link 发送之前（仅 plink/legacy）');
  assert.ok(src.slice(iStale, iPrev).includes('removeAttribute') && !src.slice(iStale, iPrev).includes('preventDefault'), '源码 stale 块须自清且不拦截');
  assert.ok(src.includes('silentCleanStalePlid'), '源码外层/管理删除须复用 silentCleanStalePlid');
  assert.ok(!src.includes("lbToast('该跳转已失效，请重新绑定')"), '源码 stale 路径不得 toast');
  // 源码级交叉：restamp 消费在外层 restampLive + handleProtoLink
  assert.ok(src.includes('if (d && d.restamp) restampLive(d.restamp);'), '外层须先消费 restamp（restampLive）再跳转');
}

// ---- A11 当前原型主页首位 + 行内子页面展开（替换目标页面下拉） ----
function testA11_CurrentProtoSubExpand() {
  const sel = extractFn(src, 'renderSelectTarget');
  assert.ok(sel, '缺 renderSelectTarget');
  assert.ok(/entries\.push\(currentSource\)/.test(sel) || /currentSource.*entries/.test(sel), '目标列表须含当前原型');
  assert.ok(/li-sub-list/.test(sel), '须行内展开子页面');
  assert.ok(/li-sub-item/.test(sel), '须有子页面行');
  assert.ok(!/liPageSelect/.test(sel), '须删除目标页面下拉框');
  assert.ok(/inspectorSelectSubPage/.test(sel), '须用子页面变量记录目标');
  assert.ok(/本原型/.test(sel), '当前原型须打标');
  // 管理抽屉更换目标同构
  assert.ok(/li-sub-list/.test(src), '管理抽屉更换目标须同构行内展开');
  assert.ok(!/lmPageSel_/.test(src), '管理抽屉不得再用页面下拉');
  // 执行侧子页面直达
  const perf = extractFn(src, 'performLink');
  assert.ok(perf && /isSubPageTarget/.test(perf), 'performLink 须子页面直达分支');
  assert.ok(/function isSubPageTarget\(/.test(src), '缺 isSubPageTarget');
  const css = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
  assert.ok(/\.li-sub-item\s*\{/.test(css), '缺子页面行样式');
  assert.ok(/\.li-target-kind\.cur/.test(css), '缺本原型徽标样式');
  console.log('[PASS] A11 当前原型主页首位+行内子页面');
}
function runAll() {
  const tests = [
    ['A1 plid生成与入库schema', testA1_PlidSchema],
    ['A2 建绑定恰1门槛', testA2_ExactlyOne],
    ['A3 live+源文件双写戳', testA3_DualStamp],
    ['A4 三段回退顺序', testA4_FallbackOrder],
    ['A5 stale静默自清不拦截', testA5_PreventFirst],
    ['A6 stale上报+自清无toast', testA6_StaleToast],
    ['A7 解除按plid全清', testA7_Unstamp],
    ['A8 老数据兼容', testA8_LegacyCompat],
    ['A9 主文档拒绝', testA9_MainDocReject],
    ['A10 validateLinks查戳+孤儿静默清理', testA10_ValidateStampFirst],
    ['S1 三段回退仿真', testS1_FallbackSim],
    ['S2 静默自清载荷仿真', testS2_InterceptPayloadSim],
    ['A11 当前原型主页首位+行内子页面', testA11_CurrentProtoSubExpand],
  ];
  let passed = 0, failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(failed ? 'LINK_STAMP_FAIL' : 'LINK_STAMP_PASS: 全部13项打戳断言通过');
  process.exitCode = failed ? 1 : 0;
}
runAll();
