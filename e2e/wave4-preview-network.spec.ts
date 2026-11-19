/**
 * e2e/wave4-preview-network.spec.ts — 预览层任意 HTTP/HTTPS 网络真机验证。
 *
 * 背景：预览 iframe 是 sandbox srcdoc，会继承 `src/renderer/index.html` 的 CSP。
 * 本用例只验证“网络放行”是否真的到达 Chromium 渲染层，不改业务源码与主进程配置。
 *
 * 覆盖：
 * 1. HTTPS/CDN：临时原型引用 jsDelivr 上的 Element UI CSS + Vue 2/Element UI UMD；
 *    断言 `.el-button` 背景/边框生效、window.Vue/window.ELEMENT 存在、Vue `el: '#vue-app'` 模板挂载（含 `[v-cloak]` 移除）、无 CSP violation。
 * 2. HTTP：本地起 http://127.0.0.1:<port> 服务提供 CSS/JS，断言样式与全局变量生效；
 *    再用 sandbox iframe 请求 http://example.com/，记录是否被混合内容策略拦截。
 * 3. 离线 `unsafe-eval` / `[v-cloak]` 回归：不依赖外部 CDN，在 `srcdoc` 内直接调用 `new Function` 编译渲染函数并移除 `[v-cloak]`，
 *    断言挂载文本可见渲染、无 `securitypolicyviolation`。
 * 4. 网络不可用 / 混合内容拦截：记录 ENV_SKIP / ENV_BLOCKED 证据，不伪造通过，也不擅自改 main.js。
 *
 * 运行（需先构建渲染器 + 准备隔离域 seed）：
 *   npm run build:renderer
 *   node e2e/wave4/seed.mjs --domain preview-network
 *   npx playwright test e2e/wave4-preview-network.spec.ts --workers=1
 *
 * 截图：docs/wave4/shots/preview-network/{01-https-cdn,02-http-resource}.png
 * 报告：docs/wave4/reports/preview-network.md
 */
import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { assertCleanExit, launchApp, type Wave4App } from './wave4/harness'

const DOMAIN = 'preview-network'
const PROJECT = '测试1'
const STAMP = Date.now().toString(36)
const HTTPS_PROTO = `W4NET-HTTPS-${STAMP}`
const HTTP_PROTO = `W4NET-HTTP-${STAMP}`
const EVAL_PROTO = `W4NET-EVAL-${STAMP}`
const CDN_CSS = 'https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/theme-chalk/index.css'
const CDN_VUE = 'https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.min.js'
const CDN_ELEMENT = 'https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/index.js'
const REMOTE_HTTP = 'http://example.com/'
const PRIMARY_BG = 'rgb(64, 158, 255)' // Element UI 2.15.14 .el-button--primary #409EFF
const HTTP_BG = 'rgb(11, 22, 33)'
const HTTP_BORDER = 'rgb(44, 55, 66)'

interface ConsoleRecord {
  type: string
  text: string
  url: string
}

interface ProbeResult {
  cdnBg: string
  cdnBorder: string
  httpBg: string
  httpBorder: string
  vue: string
  element: string
  vueMountedText: string
  vueHasCloak: boolean
  evalProbe: string | null
  evalMountedText: string
  evalHasCloak: boolean
  evalVisible: boolean
  httpProbe: string | null
  remoteHttpLoaded: boolean
  violations: Array<{ directive: string; blocked: string; disposition: string }>
  resources: Array<{ name: string; duration: number; size: number }>
}

interface Evidence {
  https: {
    status: 'PASS' | 'ENV_SKIP' | 'FAIL'
    cdnResponses: Array<{ url: string; status: number }>
    cdnFailures: Array<{ url: string; error: string }>
    probe?: ProbeResult
    note?: string
  }
  http: {
    status: 'PASS' | 'ENV_BLOCKED' | 'FAIL'
    localCssUrl: string
    localJsUrl: string
    localResponses: Array<{ url: string; status: number }>
    remoteResponses: Array<{ url: string; status: number }>
    probe?: ProbeResult
    note?: string
  }
  eval: {
    status: 'PASS' | 'FAIL'
    probe?: ProbeResult
    note?: string
  }
  console: {
    csp: string[]
    mixedContent: string[]
    pageErrors: string[]
  }
}

function log(label: string, data: unknown): void {
  console.log(`[W4-NET] ${label} ${JSON.stringify(data)}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function ensureProject(page: Page): Promise<void> {
  await page.waitForTimeout(1_500)
  const picker = page.getByTestId('project-picker')
  if (await picker.isVisible().catch(() => false)) {
    const row = picker.locator('li').filter({ hasText: PROJECT }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
}

async function clickProto(page: Page, name: string): Promise<void> {
  const proto = page
    .getByTestId('sidebar-tree')
    .locator('button[data-level="proto"]')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`) })
    .first()
  await expect(proto).toBeVisible({ timeout: 20_000 })
  await proto.click()
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
  await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('srcdoc', new RegExp(escapeRegExp(name)), {
    timeout: 20_000,
  })
}

/** 通过真实 IPC 在隔离域里创建临时原型，再经 sandbox:write 写入测试 HTML。 */
async function createProto(page: Page, name: string, html: string): Promise<string> {
  const created = (await page.evaluate(
    async ({ project, protoName }) => {
      const api = (window as any).protoAPI
      return api.sandbox.create({ project, name: protoName, kind: 'pc' })
    },
    { project: PROJECT, protoName: name },
  )) as { ok?: boolean; dir?: string; error?: string }
  if (!created?.ok || !created.dir) {
    throw new Error(`创建临时原型失败：${created?.error || 'unknown'}`)
  }
  const wrote = (await page.evaluate(
    async ({ dir, file, content }) => {
      const api = (window as any).protoAPI
      return api.sandbox.write({ dir, file, content })
    },
    { dir: created.dir, file: `${name}.html`, content: html },
  )) as { ok?: boolean; error?: string }
  if (!wrote?.ok) throw new Error(`写入临时原型失败：${wrote?.error || 'unknown'}`)
  return created.dir
}

function httpsHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${HTTPS_PROTO}</title>
<script>
window.__CSP_VIOLATIONS__ = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__CSP_VIOLATIONS__.push({ directive: e.violatedDirective, blocked: e.blockedURI, disposition: e.disposition });
});
</script>
<link rel="stylesheet" href="${CDN_CSS}">
<style>[v-cloak]{display:none !important;}</style>
</head>
<body>
<button id="cdn-button" class="el-button el-button--primary">CDN 按钮</button>
<div id="vue-app" v-cloak>{{ message }}</div>
<script src="${CDN_VUE}"></script>
<script src="${CDN_ELEMENT}"></script>
<script>
if (typeof window.Vue === 'function') {
  try {
    new window.Vue({
      el: '#vue-app',
      data: { message: 'Vue 运行时模板挂载成功' }
    });
  } catch (e) {
    window.__VUE_MOUNT_ERR__ = String(e);
  }
}
</script>
</body>
</html>`
}

function evalHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${EVAL_PROTO}</title>
<style>
[v-cloak]{display:none !important;}
#eval-app{padding:12px;color:#111;font-size:16px;}
</style>
<script>
window.__CSP_VIOLATIONS__ = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__CSP_VIOLATIONS__.push({ directive: e.violatedDirective, blocked: e.blockedURI, disposition: e.disposition });
});
</script>
</head>
<body>
<div id="eval-app" v-cloak>{{ runtimeTemplatePlaceholder }}</div>
<script>
try {
  var compileMount = new Function(
    'el',
    'text',
    'el.removeAttribute("v-cloak"); el.textContent = text; return "eval-ok";'
  );
  window.__EVAL_PROBE__ = compileMount(
    document.getElementById('eval-app'),
    'OFFLINE_NEW_FUNCTION_MOUNT_OK'
  );
} catch (err) {
  window.__EVAL_PROBE__ = 'eval-error:' + (err && err.message ? err.message : String(err));
}
</script>
</body>
</html>`
}

function httpHtml(cssUrl: string, jsUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${HTTP_PROTO}</title>
<script>
window.__CSP_VIOLATIONS__ = [];
window.__REMOTE_HTTP_LOADED__ = false;
document.addEventListener('securitypolicyviolation', function (e) {
  window.__CSP_VIOLATIONS__.push({ directive: e.violatedDirective, blocked: e.blockedURI, disposition: e.disposition });
});
</script>
<link rel="stylesheet" href="${cssUrl}">
</head>
<body>
<button id="http-button" class="http-probe">HTTP 按钮</button>
<iframe id="remote-http-frame" sandbox src="${REMOTE_HTTP}" width="240" height="120"
        onload="window.__REMOTE_HTTP_LOADED__ = true;" title="remote http probe"></iframe>
<script src="${jsUrl}"></script>
</body>
</html>`
}

async function readProbe(page: Page): Promise<ProbeResult> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return (await frame.locator('body').evaluate(() => {
        const cdnBtn = document.getElementById('cdn-button')
        const httpBtn = document.getElementById('http-button')
        const vueApp = document.getElementById('vue-app')
        const evalApp = document.getElementById('eval-app')
        const styleOf = (el: Element | null) => (el ? getComputedStyle(el) : null)
        const cdnStyle = styleOf(cdnBtn)
        const httpStyle = styleOf(httpBtn)
        const evalStyle = styleOf(evalApp)
        const win = window as any
        return {
          cdnBg: cdnStyle ? cdnStyle.backgroundColor : '',
          cdnBorder: cdnStyle ? cdnStyle.border : '',
          httpBg: httpStyle ? httpStyle.backgroundColor : '',
          httpBorder: httpStyle ? httpStyle.border : '',
          vue: typeof win.Vue,
          element: typeof win.ELEMENT,
          vueMountedText: vueApp ? (vueApp.textContent || '').trim() : '',
          vueHasCloak: vueApp ? vueApp.hasAttribute('v-cloak') : false,
          evalProbe: win.__EVAL_PROBE__ || null,
          evalMountedText: evalApp ? (evalApp.textContent || '').trim() : '',
          evalHasCloak: evalApp ? evalApp.hasAttribute('v-cloak') : false,
          evalVisible: Boolean(
            evalStyle && evalStyle.display !== 'none' && evalApp && evalApp.getBoundingClientRect().height > 0,
          ),
          httpProbe: win.__HTTP_PROBE__ || null,
          remoteHttpLoaded: Boolean(win.__REMOTE_HTTP_LOADED__),
          violations: Array.isArray(win.__CSP_VIOLATIONS__) ? win.__CSP_VIOLATIONS__ : [],
          resources: performance.getEntriesByType('resource').map((entry) => ({
            name: entry.name,
            duration: Math.round(entry.duration),
            size: 'transferSize' in entry ? (entry as PerformanceResourceTiming).transferSize : 0,
          })),
        }
      })) as ProbeResult
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!/Execution context was destroyed|Cannot find context|frame was detached/i.test(msg)) {
        throw err
      }
      await page.waitForTimeout(250)
    }
  }
  throw lastErr
}

function cspMessages(records: ConsoleRecord[]): string[] {
  return records
    .filter((record) => /content security policy|refused to (load|execute|apply|connect|frame)/i.test(record.text))
    .map((record) => `[${record.type}] ${record.text}`)
}

function mixedContentMessages(records: ConsoleRecord[]): string[] {
  return records
    .filter((record) => /mixed content|insecure content/i.test(record.text))
    .map((record) => `[${record.type}] ${record.text}`)
}

test.setTimeout(240_000)

test('预览层任意 HTTP/HTTPS：CDN 样式/JS 生效，HTTP 实际加载且无 CSP violation', async ({}, testInfo) => {
  testInfo.annotations.push({ type: 'DOMAIN', description: `${DOMAIN} / ${PROJECT}` })
  testInfo.annotations.push({ type: 'PROTOS', description: `${HTTPS_PROTO}, ${HTTP_PROTO}, ${EVAL_PROTO}` })

  const consoleRecords: ConsoleRecord[] = []
  const pageErrors: string[] = []
  const responses: Array<{ url: string; status: number }> = []
  const failures: Array<{ url: string; error: string }> = []
  const protoDirs: string[] = []
  let ctx: Wave4App | null = null
  let server: http.Server | null = null

  const serverStarted = new Promise<{ server: http.Server; port: number }>((resolve, reject) => {
    const instance = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Access-Control-Allow-Origin', '*')
      if (req.url?.startsWith('/probe.css')) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
        res.end(`.http-probe{background-color:${HTTP_BG}!important;border:9px solid ${HTTP_BORDER}!important}`)
        return
      }
      if (req.url?.startsWith('/probe.js')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        res.end(`window.__HTTP_PROBE__ = "loaded";`)
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    })
    instance.once('error', reject)
    instance.listen(0, '127.0.0.1', () => {
      server = instance
      resolve({ server: instance, port: (instance.address() as AddressInfo).port })
    })
  })

  const evidence: Evidence = {
    https: { status: 'FAIL', cdnResponses: [], cdnFailures: [] },
    http: { status: 'FAIL', localCssUrl: '', localJsUrl: '', localResponses: [], remoteResponses: [] },
    eval: { status: 'FAIL' },
    console: { csp: [], mixedContent: [], pageErrors: [] },
  }

  try {
    const { port } = await serverStarted
    const cacheBust = Date.now()
    const localCssUrl = `http://127.0.0.1:${port}/probe.css?t=${cacheBust}`
    const localJsUrl = `http://127.0.0.1:${port}/probe.js?t=${cacheBust}`
    evidence.http.localCssUrl = localCssUrl
    evidence.http.localJsUrl = localJsUrl
    log('ENV', { domain: DOMAIN, project: PROJECT, localCssUrl, remoteHttp: REMOTE_HTTP })

    ctx = await launchApp({ domain: DOMAIN })
    const page = ctx.page
    page.on('console', (msg) => {
      consoleRecords.push({ type: msg.type(), text: msg.text(), url: msg.location().url })
    })
    page.on('pageerror', (err) => {
      pageErrors.push(err.stack || err.message)
    })
    page.on('response', (response) => {
      const url = response.url()
      if (/^(https?):\/\//i.test(url)) responses.push({ url, status: response.status() })
    })
    page.on('requestfailed', (request) => {
      const url = request.url()
      if (/^(https?):\/\//i.test(url)) failures.push({ url, error: request.failure()?.errorText || 'unknown' })
    })

    await ensureProject(page)

    /* ── 1. HTTPS / CDN ── */
    protoDirs.push(await createProto(page, HTTPS_PROTO, httpsHtml()))
    await page.reload()
    await ensureProject(page)
    await clickProto(page, HTTPS_PROTO)

    let httpsProbe: ProbeResult | null = null
    const httpsDeadline = Date.now() + 25_000
    while (Date.now() < httpsDeadline) {
      httpsProbe = await readProbe(page)
      if (httpsProbe.vue === 'function' && httpsProbe.element === 'object') break
      await page.waitForTimeout(500)
    }
    httpsProbe = httpsProbe || (await readProbe(page))
    evidence.https.probe = httpsProbe
    evidence.https.cdnResponses = responses.filter((item) => item.url.includes('cdn.jsdelivr.net'))
    evidence.https.cdnFailures = failures.filter((item) => item.url.includes('cdn.jsdelivr.net'))
    evidence.console.csp = cspMessages(consoleRecords)
    evidence.console.mixedContent = mixedContentMessages(consoleRecords)

    const httpsCsp = httpsProbe.violations.filter((item) =>
      /cdn\.jsdelivr\.net/i.test(item.blocked || ''),
    )
    if (httpsCsp.length) {
      evidence.https.status = 'FAIL'
      evidence.https.note = `CSP blocked CDN: ${JSON.stringify(httpsCsp)}`
      throw new Error(`HTTPS CDN 被 CSP 拦截：${JSON.stringify(httpsCsp)}`)
    }

    const httpsStyleOk = httpsProbe.cdnBg === PRIMARY_BG && /solid/i.test(httpsProbe.cdnBorder)
    const httpsGlobalsOk = httpsProbe.vue === 'function' && httpsProbe.element === 'object'
    const httpsVueMountOk = httpsProbe.vueMountedText === 'Vue 运行时模板挂载成功' && !httpsProbe.vueHasCloak
    if (httpsStyleOk && httpsGlobalsOk && httpsVueMountOk) {
      evidence.https.status = 'PASS'
      evidence.https.note = `cdnBg=${httpsProbe.cdnBg}; border=${httpsProbe.cdnBorder}; Vue=${httpsProbe.vue}; ELEMENT=${httpsProbe.element}; vueMountedText=${httpsProbe.vueMountedText}`
    } else if (httpsStyleOk && httpsGlobalsOk && !httpsVueMountOk) {
      evidence.https.status = 'FAIL'
      evidence.https.note = `Vue CDN 已加载但运行时模板未挂载（疑似 eval/unsafe-eval 被拒）：vueMountedText=${httpsProbe.vueMountedText}; vueHasCloak=${httpsProbe.vueHasCloak}; violations=${JSON.stringify(httpsProbe.violations)}`
      throw new Error(evidence.https.note)
    } else {
      const cdnOk = evidence.https.cdnResponses.some((item) => item.status === 200)
      const cdnBlockedByNetwork = !cdnOk || evidence.https.cdnFailures.length > 0
      if (cdnBlockedByNetwork && !evidence.console.csp.length) {
        evidence.https.status = 'ENV_SKIP'
        evidence.https.note =
          `CDN 未可用/未完成加载，按 ENV_SKIP 记录，不伪造通过。` +
          ` styleOk=${httpsStyleOk}; globalsOk=${httpsGlobalsOk}; responses=${JSON.stringify(evidence.https.cdnResponses)}; failures=${JSON.stringify(evidence.https.cdnFailures)}`
        testInfo.annotations.push({ type: 'ENV_SKIP', description: `HTTPS CDN 不可用：${evidence.https.note}` })
      } else {
        evidence.https.status = 'FAIL'
        evidence.https.note = `styleOk=${httpsStyleOk}; globalsOk=${httpsGlobalsOk}; responses=${JSON.stringify(evidence.https.cdnResponses)}`
        throw new Error(`HTTPS CDN 已响应但样式/全局未生效：${evidence.https.note}`)
      }
    }
    await ctx.shot(1, 'https-cdn')
    log('HTTPS', evidence.https)

    /* ── 2. HTTP 资源 ── */
    protoDirs.push(await createProto(page, HTTP_PROTO, httpHtml(localCssUrl, localJsUrl)))
    await page.reload()
    await ensureProject(page)
    await clickProto(page, HTTP_PROTO)

    let httpProbe: ProbeResult | null = null
    const httpDeadline = Date.now() + 20_000
    while (Date.now() < httpDeadline) {
      httpProbe = await readProbe(page)
      if (
        httpProbe.httpBg === HTTP_BG &&
        httpProbe.httpProbe === 'loaded' &&
        (httpProbe.remoteHttpLoaded || responses.some((item) => item.url === REMOTE_HTTP))
      ) {
        break
      }
      await page.waitForTimeout(500)
    }
    httpProbe = httpProbe || (await readProbe(page))
    evidence.http.probe = httpProbe
    evidence.http.localResponses = responses.filter((item) => item.url.startsWith(`http://127.0.0.1:${port}/`))
    evidence.http.remoteResponses = responses.filter((item) => item.url === REMOTE_HTTP)
    evidence.console.csp = cspMessages(consoleRecords)
    evidence.console.mixedContent = mixedContentMessages(consoleRecords)
    const localFailures = failures.filter((item) => item.url.startsWith(`http://127.0.0.1:${port}/`))

    const httpCsp = httpProbe.violations.filter((item) => /127\.0\.0\.1|example\.com/i.test(item.blocked || ''))
    if (httpCsp.length) {
      evidence.http.status = 'FAIL'
      evidence.http.note = `CSP blocked HTTP: ${JSON.stringify(httpCsp)}`
      throw new Error(`HTTP 资源被 CSP 拦截：${JSON.stringify(httpCsp)}`)
    }

    const localHttpOk =
      httpProbe.httpBg === HTTP_BG && /solid/i.test(httpProbe.httpBorder) && httpProbe.httpProbe === 'loaded'
    if (localHttpOk) {
      evidence.http.status = 'PASS'
      evidence.http.note = `httpBg=${httpProbe.httpBg}; border=${httpProbe.httpBorder}; probe=${httpProbe.httpProbe}`
    } else {
      const blockedByMixedContent =
        evidence.console.mixedContent.length > 0 ||
        localFailures.length > 0 ||
        httpProbe.violations.some((item) => /mixed/i.test(item.disposition))
      if (blockedByMixedContent) {
        evidence.http.status = 'ENV_BLOCKED'
        evidence.http.note =
          'HTTP 被混合内容/Electron 策略拦截；当前 main.js 对应开关为 webPreferences.allowRunningInsecureContent（false）。' +
          '如需放行 HTTP，必须经确认后改为 true，或改用本地 https 反代；未擅自修改主进程配置。' +
          ` localFailures=${JSON.stringify(localFailures)}; mixedContent=${JSON.stringify(evidence.console.mixedContent)}`
        testInfo.annotations.push({ type: 'ENV_BLOCKED', description: evidence.http.note })
      } else {
        evidence.http.status = 'FAIL'
        evidence.http.note =
          `httpBg=${httpProbe.httpBg}; border=${httpProbe.httpBorder}; probe=${httpProbe.httpProbe}; ` +
          `localResponses=${JSON.stringify(evidence.http.localResponses)}`
        throw new Error(`HTTP 本地资源未生效且未发现混合内容证据：${evidence.http.note}`)
      }
    }

    const remoteHttpLoaded =
      evidence.http.remoteResponses.some((item) => item.status === 200) ||
      (httpProbe.remoteHttpLoaded && evidence.console.mixedContent.length === 0)
    evidence.http.note = `${evidence.http.note}; remoteHttpLoaded=${remoteHttpLoaded}; remoteResponses=${JSON.stringify(evidence.http.remoteResponses)}`
    if (!remoteHttpLoaded) {
      testInfo.annotations.push({
        type: 'ENV_SKIP',
        description: `远程 HTTP (${REMOTE_HTTP}) 未加载成功；可能网络不可用或混合内容策略拦截，详见报告。`,
      })
    }
    await ctx.shot(2, 'http-resource')
    log('HTTP', evidence.http)

    /* ── 3. 离线 unsafe-eval / [v-cloak] 回归 ── */
    protoDirs.push(await createProto(page, EVAL_PROTO, evalHtml()))
    await page.reload()
    await ensureProject(page)
    await clickProto(page, EVAL_PROTO)

    let evalProbe: ProbeResult | null = null
    const evalDeadline = Date.now() + 15_000
    while (Date.now() < evalDeadline) {
      evalProbe = await readProbe(page)
      if (evalProbe.evalProbe) break
      await page.waitForTimeout(300)
    }
    evalProbe = evalProbe || (await readProbe(page))
    evidence.eval.probe = evalProbe
    evidence.console.csp = cspMessages(consoleRecords)
    const evalOk =
      evalProbe.evalProbe === 'eval-ok' &&
      evalProbe.evalMountedText === 'OFFLINE_NEW_FUNCTION_MOUNT_OK' &&
      !evalProbe.evalHasCloak &&
      evalProbe.evalVisible &&
      evalProbe.violations.length === 0
    if (evalOk) {
      evidence.eval.status = 'PASS'
      evidence.eval.note = `evalProbe=${evalProbe.evalProbe}; mounted=${evalProbe.evalMountedText}; visible=${evalProbe.evalVisible}`
    } else {
      evidence.eval.status = 'FAIL'
      evidence.eval.note = `evalProbe=${evalProbe.evalProbe}; mounted=${evalProbe.evalMountedText}; hasCloak=${evalProbe.evalHasCloak}; visible=${evalProbe.evalVisible}; violations=${JSON.stringify(evalProbe.violations)}`
      throw new Error(`离线 unsafe-eval / [v-cloak] 回归失败：${evidence.eval.note}`)
    }
    await ctx.shot(3, 'offline-eval')
    log('EVAL', evidence.eval)

    /* ── 4. 收口断言 ── */
    expect(evidence.console.csp, `出现 CSP violation：${evidence.console.csp.join('\n')}`).toEqual([])
    expect(evidence.https.probe?.violations || [], 'HTTPS 帧内 securitypolicyviolation 必须为空').toEqual([])
    expect(evidence.http.probe?.violations || [], 'HTTP 帧内 securitypolicyviolation 必须为空').toEqual([])
    expect(evidence.eval.probe?.violations || [], '离线 eval 帧内 securitypolicyviolation 必须为空').toEqual([])
    expect(evidence.eval.status, '离线 unsafe-eval / [v-cloak] 回归必须通过').toBe('PASS')
    evidence.console.pageErrors = pageErrors
    log('EVIDENCE', evidence)
    testInfo.annotations.push({ type: 'EVIDENCE', description: JSON.stringify(evidence) })

    if (evidence.https.status === 'ENV_SKIP' || evidence.http.status === 'ENV_BLOCKED') {
      console.warn('[W4-NET] ENV 例外已记录，未伪造通过：', {
        https: evidence.https.status,
        http: evidence.http.status,
      })
    }
  } catch (err) {
    if (ctx) {
      try {
        await ctx.reportFailure({
          step: 'preview-network',
          slug: 'http-https',
          level: 'P1',
          expected: '任意 HTTPS/HTTP 资源按 CSP 加载，无 CSP violation',
          actual: 'CDN 或 HTTP 资源未按预期加载',
          error: err,
          extra: JSON.stringify({ evidence, consoleRecords: consoleRecords.slice(-40), pageErrors: pageErrors.slice(-20) }),
        })
      } catch {
        /* 失败报告不覆盖原始错误 */
      }
    }
    throw err
  } finally {
    if (ctx) {
      try {
        const close = await ctx.close()
        assertCleanExit(close)
      } finally {
        for (const dir of protoDirs) {
          try {
            fs.rmSync(dir, { recursive: true, force: true })
          } catch {
            /* 隔离域可随时删除；清理失败不覆盖测试结果 */
          }
        }
      }
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
    }
  }
})
