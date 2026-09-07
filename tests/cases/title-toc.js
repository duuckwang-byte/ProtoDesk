/* 用例：标题=当前原型名；目录点击=定位+flash+自动关闭+动画后清除 */
module.exports = async function titleToc(api) {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const s1 = JSON.parse(await api.evaluate(`JSON.stringify({
    loc: document.getElementById('loc').textContent,
    docTitle: document.getElementById('docTitle').textContent,
    name: (window.currentSource&&window.currentSource.displayName)||'',
    docsOpen: document.body.classList.contains('docs-open')
  })`));
  assert(s1.name !== '', 'currentSource 未加载');
  assert(s1.loc === s1.name, '左上角标题≠原型名：'+s1.loc);
  assert(s1.docTitle === s1.name, '功能说明标题≠原型名：'+s1.docTitle);
  /* 打开目录 */
  await api.evaluate(`(function(){ const b=document.getElementById('btnToc'); if(b)b.click(); return 'ok'; })()`);
  await new Promise((r) => setTimeout(r, 300));
  const s2 = JSON.parse(await api.evaluate(`JSON.stringify({
    open: document.getElementById('docToc').style.display!=='none',
    items: document.getElementById('docToc').querySelectorAll('.toc-item').length
  })`));
  assert(s2.open === true, '目录未打开');
  assert(s2.items > 0, '目录项为空');
  /* 点击第 2 项：定位+闪烁+关闭 */
  await api.evaluate(`(function(){ const items=document.getElementById('docToc').querySelectorAll('.toc-item'); if(items.length>1){ items[1].click(); } return 'ok'; })()`);
  await new Promise((r) => setTimeout(r, 200));
  const s3 = JSON.parse(await api.evaluate(`JSON.stringify((function(){
    const h=document.querySelectorAll('#docContent h1,#docContent h2,#docContent h3,#docContent h4,#docContent h5,#docContent h6');
    return { toc: document.getElementById('docToc').style.display, cls: h.length>1?h[1].className:'none' };
  })())`));
  assert(s3.toc === 'none', '点击目录项后弹窗未自动关闭');
  assert(String(s3.cls).indexOf('toc-title-flash') >= 0, '目标标题未获得闪烁 class');
  /* 动画结束（720ms 定时移除） */
  await new Promise((r) => setTimeout(r, 900));
  const cls2 = await api.evaluate(`(function(){ const h=document.querySelectorAll('#docContent h1,#docContent h2,#docContent h3,#docContent h4,#docContent h5,#docContent h6'); return h.length>1?h[1].className:'none'; })()`);
  assert(String(cls2).indexOf('toc-title-flash') < 0, '闪烁 class 未被清除');
};