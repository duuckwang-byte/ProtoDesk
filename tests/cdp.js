/* CDP 公共连接器：连 remote-debugging-port，提供 evaluate 封装 */
const http = require('http');
function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
/* 连接首个 page target；返回 { evaluate(expr), close() } */
async function connect({ port = 9333, waitMs = 15000 } = {}) {
  const deadline = Date.now() + waitMs;
  let targets = null;
  while (Date.now() < deadline) {
    try {
      targets = await getJSON('http://127.0.0.1:' + port + '/json/list');
      if (targets && targets.length) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = (targets || []).find((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'));
  if (!page) throw new Error('NO_PAGE');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = {};
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS_ERROR')); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend[m.id]) { pend[m.id].res(m.result); delete pend[m.id]; }
  };
  async function evaluate(expression) {
    const r = await new Promise((res, rej) => {
      const i = ++id; pend[i] = { res, rej };
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (r && r.exceptionDetails) throw new Error('EVAL_ERROR: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r && r.result && r.result.value;
  }
  async function screenshot() { /* visual regression reserved */
    const r = await new Promise((res, rej) => {
      const i = ++id; pend[i] = { res, rej };
      ws.send(JSON.stringify({ id: i, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    return r && r.data;
  }
  function close() { try { ws.close(); } catch (e) {} }
  return { evaluate, screenshot, close };
}
module.exports = { connect };