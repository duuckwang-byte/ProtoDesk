/**
 * src/renderer/stores/__tests__/docs-store.test.ts — W3-03 文档闭环单测。
 *
 * 覆盖：
 * - loadDesc：source.md 优先；缺失走 sandbox:read-file({dir,file:mdFile})；同源缓存不覆盖
 * - save 分流：desc → sandbox:write；latest → doc:write-latest({dir,file:'最新需求.md'})
 * - 保存守卫：异步返回后切源 / __ver 推进 → 丢弃结果 + toast
 * - Tab 缓存：desc/latest 内容互不串；loadLatest 参数为 {dir}
 * - mirrorPush：保存成功后 {kind:'content',payload:{content,...}}
 * - applyMirrorContent / useDocWindow（docwin.open/close/toggle）
 * - DocEditor：Ctrl+F 搜索栏 / 命中计数 / Esc 关闭；纯文本粘贴（换行、无富文本标签）
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import DocEditor, {
  findTextRanges,
  insertPlainTextAtSelection,
  normalizePastedText,
} from "@/features/docs/DocEditor"
import {
  applyDocMirrorMessage,
  extractDocHeadings,
  isDocWindowMode,
  parseDocBlocks,
  renderDocInline,
  renderDocPreview,
  useDocsStore,
  useDocWindow,
  type DocsState,
} from "../docs-store"
import { useSourcesStore, type SourceRef } from "../sources-store"
import { useUiStore } from "../ui-store"

type AnyFn = (...args: unknown[]) => unknown

// jsdom 未实现 innerText（赋值只挂到元素对象上，不写 DOM）。DocEditor 用 innerText 灌入
// contenteditable；为让「手动写 innerText → 预览残留」的回归可复现，这里按 Chromium 语义
// 映射到 textContent（编辑区 CSS 为 pre-wrap，换行渲染一致）。
const htmlProto = HTMLElement.prototype as unknown as { textContent: string | null }
if (!Object.getOwnPropertyDescriptor(htmlProto, "innerText")) {
  Object.defineProperty(htmlProto, "innerText", {
    configurable: true,
    get() {
      return (this as HTMLElement).textContent ?? ""
    },
    set(value: unknown) {
      ;(this as HTMLElement).textContent = String(value ?? "")
    },
  })
}

interface ApiCalls {
  readFile: unknown[]
  write: unknown[]
  readLatest: unknown[]
  writeLatest: unknown[]
  mirror: unknown[]
  mirrorBack: unknown[]
  docwinOpen: unknown[]
  docwinClose: number
  docwinToggle: number
}

interface ApiOverrides {
  readFile?: AnyFn
  write?: AnyFn
  readLatest?: AnyFn
  writeLatest?: AnyFn
  mirror?: AnyFn
  mirrorBack?: AnyFn
  docwinOpen?: AnyFn
  docwinClose?: AnyFn
  docwinToggle?: AnyFn
}

const DOCS_INITIAL: Partial<DocsState> = {
  docContent: "",
  draft: "",
  editing: false,
  toc: [],
  search: "",
  reqVersion: 0,
  saving: false,
  loading: false,
  lastError: "",
  tab: "desc",
  descContent: "",
  latestContent: "",
  descLoaded: false,
  latestLoaded: false,
  mirrorDir: "",
  mirrorTab: "desc",
  mirrorContent: "",
  mirrorPending: false,
  sourceDir: "",
  sourceVer: 0,
  sourceName: "",
  sourceDisplayName: "",
  sourceMdFile: null,
  docTitle: "功能说明",
  draftStash: {},
  pendingGuard: null,
}

function reset(): void {
  localStorage.clear()
  try {
    window.history.replaceState({}, "", "/")
  } catch {
    // jsdom 允许；非浏览器环境忽略。
  }
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
  useDocsStore.setState(DOCS_INITIAL)
  useSourcesStore.setState({
    project: "",
    projects: [],
    sources: [],
    currentSource: null,
    activeSubFile: "",
    activeContent: "",
    loading: false,
    error: "",
    pickerOpen: false,
  })
  useUiStore.setState({ toasts: [], docsOpen: false })
  useDocWindow.setState({ mode: "panel", busy: false })
}

function source(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    name: "登录页.html",
    displayName: "登录页",
    kind: "pc",
    sandboxDir: "/sandbox/A/登录页",
    mainHtmlFile: "登录页.html",
    mdFile: "登录页.md",
    subPages: [],
    htmlFiles: ["登录页.html"],
    content: "<html></html>",
    md: "# 登录页\n\n原始说明",
    pages: [],
    __ver: 0,
    ...overrides,
  }
}

function setCurrent(src: SourceRef | null, project = "A"): void {
  useSourcesStore.setState({
    project,
    sources: src ? [src] : [],
    currentSource: src,
  })
}

function installApi(overrides: ApiOverrides = {}): ApiCalls {
  const calls: ApiCalls = {
    readFile: [],
    write: [],
    readLatest: [],
    writeLatest: [],
    mirror: [],
    mirrorBack: [],
    docwinOpen: [],
    docwinClose: 0,
    docwinToggle: 0,
  }
  const api = {
    sandbox: {
      readFile: (o: unknown) => {
        calls.readFile.push(o)
        return overrides.readFile ? overrides.readFile(o) : Promise.resolve({ ok: false, error: "not-found" })
      },
      write: (o: unknown) => {
        calls.write.push(o)
        return overrides.write ? overrides.write(o) : Promise.resolve({ ok: true, path: "/sandbox/A/登录页/登录页.md" })
      },
    },
    doc: {
      readLatest: (o: unknown) => {
        calls.readLatest.push(o)
        return overrides.readLatest
          ? overrides.readLatest(o)
          : Promise.resolve({ ok: true, content: "# 最新需求\n\n默认需求" })
      },
      writeLatest: (o: unknown) => {
        calls.writeLatest.push(o)
        return overrides.writeLatest ? overrides.writeLatest(o) : Promise.resolve({ ok: true, path: "/sandbox/A/登录页/最新需求.md" })
      },
      mirrorPush: (o: unknown) => {
        calls.mirror.push(o)
        return overrides.mirror ? overrides.mirror(o) : Promise.resolve({ ok: true })
      },
      mirrorBack: (o: unknown) => {
        calls.mirrorBack.push(o)
        return overrides.mirrorBack ? overrides.mirrorBack(o) : Promise.resolve({ ok: true })
      },
    },
    docwin: {
      open: (o: unknown) => {
        calls.docwinOpen.push(o)
        return overrides.docwinOpen ? overrides.docwinOpen(o) : Promise.resolve({ ok: true, mode: "win" })
      },
      close: () => {
        calls.docwinClose += 1
        return overrides.docwinClose ? overrides.docwinClose() : Promise.resolve({ ok: true, mode: "panel" })
      },
      toggle: () => {
        calls.docwinToggle += 1
        return overrides.docwinToggle ? overrides.docwinToggle() : Promise.resolve({ ok: true, mode: "win" })
      },
    },
  }
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = api
  return calls
}

beforeEach(reset)
afterEach(cleanup)

describe("loadDesc（功能说明读取）", () => {
  it("优先 source.md，不触发 sandbox:read-file", async () => {
    const calls = installApi()
    const ok = await useDocsStore.getState().loadDesc(source())
    expect(ok).toBe(true)
    const st = useDocsStore.getState()
    expect(st.docContent).toContain("原始说明")
    expect(st.descContent).toContain("原始说明")
    expect(st.sourceDir).toBe("/sandbox/A/登录页")
    expect(st.sourceMdFile).toBe("登录页.md")
    expect(st.docTitle).toContain("功能说明")
    expect(calls.readFile).toHaveLength(0)
  })

  it("source.md 缺失时走 sandbox:read-file({dir,file:mdFile})", async () => {
    const calls = installApi({
      readFile: async () => ({ ok: true, content: "# 磁盘说明" }),
    })
    await useDocsStore.getState().loadDesc(source({ md: "" }))
    expect(calls.readFile).toEqual([{ dir: "/sandbox/A/登录页", file: "登录页.md" }])
    expect(useDocsStore.getState().docContent).toBe("# 磁盘说明")
  })

  it("同源目录已加载时命中缓存，不用列表旧 md 覆盖本地内容", async () => {
    const calls = installApi()
    await useDocsStore.getState().loadDesc(source())
    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# 本地已保存")
    await useDocsStore.getState().save()
    expect(calls.write).toHaveLength(1)

    // 切源事件只推进 __ver，列表里的 md 仍是旧的：缓存命中，不回落旧内容。
    const bumped = source({ __ver: 1 })
    setCurrent(bumped)
    const r = await useDocsStore.getState().loadDesc(bumped)
    expect(r).toBe(true)
    expect(useDocsStore.getState().docContent).toBe("# 本地已保存")
    expect(useDocsStore.getState().sourceVer).toBe(1)
  })

  it("同目录缓存命中但磁盘内容更新时重读，旧缓存不覆盖新磁盘", async () => {
    let disk = "# 旧磁盘"
    const calls = installApi({
      readFile: async () => ({ ok: true, content: disk }),
    })
    const a = source({ md: "" })
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    expect(useDocsStore.getState().docContent).toBe("# 旧磁盘")

    // 外部（docwin/其它进程）落盘后主窗列表 md 仍是旧的：缓存命中也要重读磁盘。
    disk = "# docwin 新落盘"
    const bumped = source({ md: "# 旧磁盘", __ver: 1 })
    setCurrent(bumped)
    const ok = await useDocsStore.getState().loadDesc(bumped)

    expect(ok).toBe(true)
    expect(useDocsStore.getState().docContent).toBe("# docwin 新落盘")
    expect(useDocsStore.getState().descContent).toBe("# docwin 新落盘")
    expect(calls.readFile).toHaveLength(2)
  })

  it("收到 mirror content 后缓存命中直接使用它，不被落后磁盘读回覆盖", async () => {
    let disk = "# 旧磁盘"
    installApi({ readFile: async () => ({ ok: true, content: disk }) })
    const a = source({ md: "" })
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)

    applyDocMirrorMessage({
      kind: "content",
      payload: {
        docwin: true,
        content: "# 独立窗最新",
        tab: "desc",
        dir: a.sandboxDir,
      },
    })
    expect(useDocsStore.getState().docContent).toBe("# 独立窗最新")
    expect(useDocsStore.getState().mirrorPending).toBe(true)

    // 磁盘仍是旧内容（模拟回读落后/失败），关闭/重开面板不能被它覆盖。
    const ok = await useDocsStore.getState().loadDesc(a)
    expect(ok).toBe(true)
    expect(useDocsStore.getState().docContent).toBe("# 独立窗最新")
    expect(useDocsStore.getState().descContent).toBe("# 独立窗最新")
    expect(useDocsStore.getState().mirrorPending).toBe(false)
  })

  it("源为空时清空功能说明与绑定信息", async () => {
    installApi()
    await useDocsStore.getState().loadDesc(source())
    const ok = await useDocsStore.getState().loadDesc(null)
    expect(ok).toBe(false)
    const st = useDocsStore.getState()
    expect(st.docContent).toBe("")
    expect(st.descContent).toBe("")
    expect(st.sourceDir).toBe("")
    expect(st.descLoaded).toBe(false)
  })
})

describe("save 分流（C1：desc → sandbox:write / latest → doc:write-latest）", () => {
  it("功能说明保存走 sandbox:write({dir,file:mdFile,content})，不写 doc:write-latest", async () => {
    const calls = installApi()
    setCurrent(source())
    await useDocsStore.getState().loadDesc(source())
    calls.mirror.length = 0

    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# 新说明")
    const ok = await useDocsStore.getState().save()

    expect(ok).toBe(true)
    expect(calls.write).toEqual([
      { dir: "/sandbox/A/登录页", file: "登录页.md", content: "# 新说明" },
    ])
    expect(calls.writeLatest).toHaveLength(0)
    const st = useDocsStore.getState()
    expect(st.docContent).toBe("# 新说明")
    expect(st.editing).toBe(false)
    expect(st.saving).toBe(false)
    expect(calls.mirror[0]).toMatchObject({
      kind: "content",
      payload: { content: "# 新说明", tab: "desc", reqMode: false },
    })
  })

  it("mdFile 缺失时按原型名推导 <name>.md", async () => {
    const calls = installApi()
    setCurrent(source({ mdFile: null }))
    await useDocsStore.getState().loadDesc(source({ mdFile: null }))
    const st = useDocsStore.getState()
    st.beginEdit()
    st.setDraft("x")
    await useDocsStore.getState().save()
    expect(calls.write[0]).toEqual({
      dir: "/sandbox/A/登录页",
      file: "登录页.md",
      content: "x",
    })
  })

  it("最新需求保存走 doc:write-latest({dir,file:'最新需求.md',content})", async () => {
    const calls = installApi()
    setCurrent(source())
    await useDocsStore.getState().loadDesc(source())
    useDocsStore.getState().setTab("latest")
    await useDocsStore.getState().loadLatest("/sandbox/A/登录页")
    calls.mirror.length = 0

    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("## 本期需求")
    const ok = await useDocsStore.getState().save()

    expect(ok).toBe(true)
    expect(calls.write).toHaveLength(0)
    expect(calls.writeLatest).toEqual([
      { dir: "/sandbox/A/登录页", file: "最新需求.md", content: "## 本期需求" },
    ])
    expect(calls.mirror[0]).toMatchObject({
      kind: "content",
      payload: { content: "## 本期需求", tab: "latest", reqMode: true },
    })
  })

  it("未选择原型时保存失败并 toast", async () => {
    installApi()
    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("x")
    const ok = await useDocsStore.getState().save()
    expect(ok).toBe(false)
    expect(useDocsStore.getState().lastError).toContain("未选择原型")
    expect(useUiStore.getState().toasts.some((t) => t.title === "文档保存失败")).toBe(true)
  })
})

describe("保存守卫（切源 / __ver 推进）", () => {
  it("异步返回前切源：丢弃旧结果，不覆盖新源文档，并 toast", async () => {
    let resolveWrite: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveWrite = resolve
    })
    const calls = installApi({ write: () => pending })

    const a = source()
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# A 的新内容")
    const saving = useDocsStore.getState().save()

    const b = source({
      name: "订单页.html",
      displayName: "订单页",
      sandboxDir: "/sandbox/A/订单页",
      mdFile: "订单页.md",
      md: "# 订单页",
    })
    setCurrent(b)
    await useDocsStore.getState().loadDesc(b)
    expect(useDocsStore.getState().docContent).toBe("# 订单页")

    resolveWrite?.({ ok: true, path: "/sandbox/A/登录页/登录页.md" })
    const ok = await saving

    expect(ok).toBe(false)
    expect(calls.write[0]).toMatchObject({ dir: "/sandbox/A/登录页", content: "# A 的新内容" })
    const st = useDocsStore.getState()
    expect(st.docContent).toBe("# 订单页")
    expect(st.descContent).toBe("# 订单页")
    expect(st.lastError).toContain("已切换原型")
    expect(
      useUiStore.getState().toasts.some((t) => t.title === "保存已阻断" && t.variant === "destructive")
    ).toBe(true)
  })

  it("异步返回前 __ver 推进：按 stale-version 丢弃结果", async () => {
    let resolveWrite: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveWrite = resolve
    })
    installApi({ write: () => pending })

    const a = source()
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# 旧版本保存")
    const saving = useDocsStore.getState().save()

    const bumped = source({ __ver: 1 })
    setCurrent(bumped)
    await useDocsStore.getState().loadDesc(bumped)

    resolveWrite?.({ ok: true, path: "/sandbox/A/登录页/登录页.md" })
    const ok = await saving

    expect(ok).toBe(false)
    expect(useDocsStore.getState().docContent).toBe("# 登录页\n\n原始说明")
    expect(useDocsStore.getState().lastError).toContain("版本已变化")
  })
})

describe("最新需求读取 / Tab 缓存（C2）", () => {
  it("loadLatest 参数为 {dir}，desc/latest 内容互不串", async () => {
    const calls = installApi({ readLatest: async () => ({ ok: true, content: "# 需求正文" }) })
    setCurrent(source())
    await useDocsStore.getState().loadDesc(source())

    useDocsStore.getState().setTab("latest")
    expect(useDocsStore.getState().docContent).toBe("")
    const ok = await useDocsStore.getState().loadLatest("/sandbox/A/登录页")

    expect(ok).toBe(true)
    expect(calls.readLatest).toEqual([{ dir: "/sandbox/A/登录页" }])
    expect(useDocsStore.getState().docContent).toBe("# 需求正文")

    useDocsStore.getState().setTab("desc")
    expect(useDocsStore.getState().docContent).toContain("原始说明")
    expect(useDocsStore.getState().descContent).toContain("原始说明")
    expect(useDocsStore.getState().latestContent).toBe("# 需求正文")
  })

  it("切源后旧 readLatest 回包被归属守卫丢弃", async () => {
    let resolveRead: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveRead = resolve
    })
    installApi({ readLatest: () => pending })
    setCurrent(source())
    await useDocsStore.getState().loadDesc(source())
    useDocsStore.getState().setTab("latest")
    const loading = useDocsStore.getState().loadLatest("/sandbox/A/登录页")

    const b = source({
      name: "订单页.html",
      displayName: "订单页",
      sandboxDir: "/sandbox/A/订单页",
      md: "# 订单页",
    })
    setCurrent(b)
    await useDocsStore.getState().loadDesc(b)
    resolveRead?.({ ok: true, content: "# 旧需求" })

    expect(await loading).toBe(false)
    expect(useDocsStore.getState().latestContent).not.toBe("# 旧需求")
  })
})

describe("mirror 应用", () => {
  it("applyMirrorContent 按 tab 写入缓存并切换当前内容", () => {
    useDocsStore.getState().applyMirrorContent({
      content: "# 文档窗内容",
      tab: "latest",
      title: "最新需求",
    })
    expect(useDocsStore.getState().tab).toBe("latest")
    expect(useDocsStore.getState().docContent).toBe("# 文档窗内容")
    expect(useDocsStore.getState().latestContent).toBe("# 文档窗内容")

    useDocsStore.getState().applyMirrorContent({ md: "# 功能说明", reqMode: false })
    expect(useDocsStore.getState().tab).toBe("desc")
    expect(useDocsStore.getState().docContent).toBe("# 功能说明")
    expect(useDocsStore.getState().descContent).toBe("# 功能说明")
  })

  it("主窗 applyDocMirrorMessage 按 kind=content 更新正文/草稿与对应 Tab 缓存", () => {
    setCurrent(source())
    useDocsStore.setState({
      descContent: "# 主窗旧正文",
      docContent: "# 主窗旧正文",
      draft: "# 主窗旧正文",
      descLoaded: true,
      reqVersion: 3,
    })

    applyDocMirrorMessage({
      kind: "content",
      payload: {
        docwin: true,
        content: "# 独立窗保存后的正文",
        tab: "desc",
        title: "登录页 · 功能说明",
        dir: "/sandbox/A/登录页",
      },
    })

    const st = useDocsStore.getState()
    expect(st.docContent).toBe("# 独立窗保存后的正文")
    expect(st.draft).toBe("# 独立窗保存后的正文")
    expect(st.descContent).toBe("# 独立窗保存后的正文")
    expect(st.descLoaded).toBe(true)
    expect(st.reqVersion).toBe(4)
    expect(st.mirrorPending).toBe(true)
  })

  it("desc mirror 不会被最新需求加载误消费（按 mirrorTab 隔离）", async () => {
    installApi({ readLatest: async () => ({ ok: true, content: "# 最新需求磁盘" }) })
    const a = source()
    setCurrent(a)
    applyDocMirrorMessage({
      kind: "content",
      payload: {
        docwin: true,
        content: "# 功能说明 mirror",
        tab: "desc",
        dir: a.sandboxDir,
      },
    })

    const ok = await useDocsStore.getState().loadLatest(a.sandboxDir)
    expect(ok).toBe(true)
    expect(useDocsStore.getState().latestContent).toBe("# 最新需求磁盘")
    expect(useDocsStore.getState().mirrorPending).toBe(true)
  })

  it("isDocWindowMode 只认 docwin=1", () => {
    expect(isDocWindowMode("?docwin=1")).toBe(true)
    expect(isDocWindowMode("?docwin=1&project=A")).toBe(true)
    expect(isDocWindowMode("?docwin=0")).toBe(false)
    expect(isDocWindowMode("?project=A")).toBe(false)
  })
})

describe("Markdown 预览渲染（表格 / 列表 / 代码块 / 标题锚点）", () => {
  const MD = [
    "# 商城首页",
    "",
    "## 页面数据",
    "",
    "| 维度 | 说明 |",
    "| --- | --- |",
    "| 页面数据 | 字段与值 |",
    "",
    "1. 第一步",
    "2. 第二步",
    "",
    "- 无序甲",
    "- 无序乙",
    "",
    "```ts",
    "const x = 1",
    "# 代码里的井号不是标题",
    "```",
  ].join("\n")

  it("解析 GFM 表格（表头 / 行 / 分隔行不被当成正文）", () => {
    const blocks = parseDocBlocks(MD)
    const table = blocks.find((b) => b.kind === "table")
    expect(table).toBeDefined()
    if (table && table.kind === "table") {
      expect(table.header).toEqual(["维度", "说明"])
      expect(table.rows).toEqual([["页面数据", "字段与值"]])
    }
    expect(blocks.some((b) => b.kind === "paragraph" && b.text.includes("| ---"))).toBe(false)
  })

  it("解析有序 / 无序列表与围栏代码块", () => {
    const blocks = parseDocBlocks(MD)
    const lists = blocks.filter((b) => b.kind === "list")
    expect(lists).toHaveLength(2)
    if (lists[0]?.kind === "list") {
      expect(lists[0].ordered).toBe(true)
      expect(lists[0].items.map((it) => it.text)).toEqual(["第一步", "第二步"])
    }
    if (lists[1]?.kind === "list") {
      expect(lists[1].ordered).toBe(false)
      expect(lists[1].items.map((it) => it.text)).toEqual(["无序甲", "无序乙"])
    }
    const code = blocks.find((b) => b.kind === "code")
    expect(code).toBeDefined()
    if (code && code.kind === "code") {
      expect(code.lang).toBe("ts")
      expect(code.text).toContain("# 代码里的井号不是标题")
    }
  })

  it("代码块内的 # 不计入 TOC", () => {
    expect(extractDocHeadings(MD).map((h) => h.text)).toEqual(["商城首页", "页面数据"])
  })

  it("renderDocPreview 输出 table/ol/ul/pre/h，且不再残留表格语法", () => {
    const html = renderDocPreview(MD)
    expect(html).toContain("<table>")
    expect(html).toContain("<th>维度</th>")
    expect(html).toContain("<td>字段与值</td>")
    expect(html).toContain("<ol>")
    expect(html).toContain("<ul>")
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain('<h1 id="商城首页" data-toc-id="商城首页">')
    expect(html).not.toContain("| 维度 | 说明 |")
    expect(html).not.toContain("| --- | --- |")
  })

  it("重复标题 id 去重，TOC id 与每个标题的 data-toc-id 完全一致", () => {
    const md = ["# A", "", "## B", "", "## B", "", "### C"].join("\n")
    const headings = extractDocHeadings(md)
    expect(headings.map((h) => h.id)).toEqual(["a", "b", "b-1", "c"])
    const html = renderDocPreview(md)
    for (const heading of headings) {
      expect(html).toContain(`data-toc-id="${heading.id}"`)
      expect(html).toContain(`id="${heading.id}"`)
    }
  })

  it("表格单元格内的 <br> 转为换行，不显示为可见标签", () => {
    const html = renderDocPreview("| 维度 | 说明 |\n| --- | --- |\n| A | 1<br>2 |")
    expect(html).toContain("<td>1<br />2</td>")
    expect(html).not.toContain("&lt;br")
  })

  it("XSS 转义：原始 HTML / javascript 链接不会进入可执行标签", () => {
    const md = [
      "# <img src=x onerror=alert(1)>",
      "",
      "<script>alert(1)</script>",
      "",
      "[点我](javascript:alert(1))",
      "",
      "| <b>列</b> | 说明 |",
      "| --- | --- |",
      "| <script>x</script> | 值 |",
    ].join("\n")
    const html = renderDocPreview(md)
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<img src=\"x\"")
    expect(html).not.toContain('href="javascript')
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;img")
  })

  it("行内代码不参与粗体解析，粗体/删除线正常渲染", () => {
    expect(renderDocInline("`**x**`")).toBe("<code>**x**</code>")
    expect(renderDocInline("**重点** 与 ~~删除~~")).toBe("<strong>重点</strong> 与 <del>删除</del>")
  })
})

describe("docwin 保存回推主窗（docs-P1-2）", () => {
  it("docwin 保存成功后走 doc:mirror-back kind=content（带 docwin 标记），不再自投 mirror-push", async () => {
    window.history.replaceState({}, "", "/?docwin=1")
    const calls = installApi()
    const a = source()
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    calls.mirror.length = 0
    calls.mirrorBack.length = 0

    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# 独立窗修改")
    const ok = await useDocsStore.getState().save()

    expect(ok).toBe(true)
    expect(calls.mirror).toHaveLength(0)
    expect(calls.mirrorBack).toHaveLength(1)
    expect(calls.mirrorBack[0]).toMatchObject({
      kind: "content",
      payload: {
        docwin: true,
        content: "# 独立窗修改",
        md: "# 独立窗修改",
        tab: "desc",
        reqMode: false,
        dir: "/sandbox/A/登录页",
      },
    })
  })
})

describe("useDocWindow（docwin.open/close/toggle）", () => {
  it("open 默认带当前 project/proto，成功后 mode=win 并收面板", async () => {
    const calls = installApi()
    setCurrent(source(), "A")
    useUiStore.setState({ docsOpen: true })

    const mode = await useDocWindow.getState().open()
    expect(mode).toBe("win")
    expect(calls.docwinOpen).toEqual([{ project: "A", proto: "登录页" }])
    expect(useDocWindow.getState().mode).toBe("win")
    expect(useUiStore.getState().docsOpen).toBe(false)
  })

  it("close 走 docwin.close 并回 mode=panel", async () => {
    const calls = installApi({ docwinClose: async () => ({ ok: true, mode: "panel" }) })
    const mode = await useDocWindow.getState().close()
    expect(mode).toBe("panel")
    expect(calls.docwinClose).toBe(1)
    expect(useDocWindow.getState().mode).toBe("panel")
  })

  it("close 回面板前按磁盘复核：docwin 已落盘内容无需刷新即可见", async () => {
    let disk = "# 旧正文"
    installApi({ readFile: async () => ({ ok: true, content: disk }) })
    const a = source({ md: "" })
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    expect(useDocsStore.getState().docContent).toBe("# 旧正文")

    disk = "# 独立窗已落盘"
    const mode = await useDocWindow.getState().close()

    expect(mode).toBe("panel")
    expect(useDocsStore.getState().docContent).toBe("# 独立窗已落盘")
    expect(useUiStore.getState().docsOpen).toBe(true)
  })

  it("toggle 遇到 AI busy 返回 null 并 toast", async () => {
    installApi({ docwinToggle: async () => ({ ok: false, error: "busy" }) })
    const mode = await useDocWindow.getState().toggle()
    expect(mode).toBeNull()
    expect(useUiStore.getState().toasts.some((t) => t.description?.includes("AI 任务进行中"))).toBe(true)
  })
})

describe("DocEditor 正文搜索 / 纯文本粘贴（组件）", () => {
  it("Ctrl+F 打开搜索栏并显示命中计数，Esc 关闭", async () => {
    useDocsStore.setState({
      docContent: "# 标题\n\n正文 Alpha 与 alpha",
      draft: "# 标题\n\n正文 Alpha 与 alpha",
      editing: false,
    })
    render(createElement(DocEditor))

    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true })
    expect(await screen.findByTestId("doc-searchbar")).toBeTruthy()
    const input = screen.getByTestId("doc-search-input")
    await waitFor(() => expect(document.activeElement).toBe(input))

    fireEvent.change(input, { target: { value: "alpha" } })
    await waitFor(() =>
      expect(screen.getByTestId("doc-search-count").textContent).toBe("1 / 2")
    )
    // 计数 setState 触发重渲染后，<mark> 仍保留（只改 dangerouslySetInnerHTML 内部节点）。
    expect(screen.getByTestId("doc-preview").querySelectorAll("mark[data-doc-hit]")).toHaveLength(2)

    fireEvent.click(screen.getByTestId("doc-search-next"))
    await waitFor(() =>
      expect(screen.getByTestId("doc-search-count").textContent).toBe("2 / 2")
    )

    fireEvent.keyDown(screen.getByTestId("doc-search-input"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByTestId("doc-searchbar")).toBeNull())
  })

  it("findTextRanges 大小写不敏感；normalizePastedText 统一换行并去掉尾随空行", () => {
    const root = document.createElement("div")
    root.innerHTML = "<p>Alpha beta</p><p>alpha</p>"
    expect(findTextRanges(root, "ALPHA").map((range) => range.toString())).toEqual(["Alpha", "alpha"])
    expect(normalizePastedText("第一行\r\n第二行\r\n\r\n")).toBe("第一行\n第二行")
  })

  it("insertPlainTextAtSelection 以文本 + <br> 插入，不产生富文本标签", () => {
    const root = document.createElement("div")
    root.contentEditable = "true"
    root.textContent = "前缀后缀"
    document.body.appendChild(root)

    const range = document.createRange()
    range.setStart(root.firstChild as Text, 2)
    range.collapse(true)
    const selection = window.getSelection()
    expect(selection).not.toBeNull()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(insertPlainTextAtSelection("A\r\nB", root)).toBe(true)
    expect(root.innerHTML).toBe("前缀A<br>B后缀")
    expect(root.querySelector("span,strong,b,font")).toBeNull()
    root.remove()
  })
})

describe("图片安全 URL（P2-IMAGE）", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="

  it("data:image/* 图片放行，http(s)/proto-asset 不阻断", () => {
    expect(renderDocInline(`![图](${PNG})`)).toContain(`<img src="${PNG}"`)
    expect(renderDocInline("![图](proto-asset://a/b.png)")).toContain('src="proto-asset://a/b.png"')
    expect(renderDocInline("![图](https://example.com/a.png)")).toContain(
      'src="https://example.com/a.png"',
    )
    expect(renderDocPreview(`![图](${PNG})`)).toContain(`<img src="${PNG}"`)
  })

  it("javascript:/vbscript:/非图片 data: 仍被阻断；链接不放行 data:", () => {
    expect(renderDocInline("![图](javascript:alert)")).toBe("图")
    expect(renderDocInline("![图](vbscript:msgbox)")).toBe("图")
    expect(renderDocInline("![图](data:text/html;base64,AAAA)")).toBe("图")
    expect(renderDocInline(`[点](${PNG})`)).toBe("点")
    expect(renderDocInline("[点](javascript:alert)")).toBe("点")
  })
})

describe("未保存草稿守卫（P2-TAB-DRAFT / CLOSE / PROTO）", () => {
  it("切 Tab：有脏草稿先挂起，取消保留编辑态，确认放弃才切换", () => {
    useUiStore.setState({ docsOpen: true })
    useDocsStore.setState({
      tab: "desc",
      descContent: "# 功能说明",
      latestContent: "# 最新需求",
      docContent: "# 功能说明",
      draft: "# 功能说明（改）",
      editing: true,
    })

    useDocsStore.getState().setTab("latest")
    expect(useDocsStore.getState().tab).toBe("desc")
    expect(useDocsStore.getState().pendingGuard).toEqual({ kind: "tab", tab: "latest" })
    expect(useDocsStore.getState().editing).toBe(true)

    // 取消：留在原 Tab，草稿完整保留。
    useDocsStore.getState().resolveGuard(false)
    expect(useDocsStore.getState().tab).toBe("desc")
    expect(useDocsStore.getState().draft).toBe("# 功能说明（改）")
    expect(useDocsStore.getState().editing).toBe(true)

    // 再次切换并确认：丢弃草稿后切到目标 Tab。
    useDocsStore.getState().setTab("latest")
    useDocsStore.getState().resolveGuard(true)
    expect(useDocsStore.getState().tab).toBe("latest")
    expect(useDocsStore.getState().docContent).toBe("# 最新需求")
    expect(useDocsStore.getState().draft).toBe("# 最新需求")
    expect(useDocsStore.getState().editing).toBe(false)
  })

  it("切原型：草稿按目录+Tab 暂存，切回自动恢复编辑态", async () => {
    installApi()
    const a = source()
    const b = source({
      name: "订单页.html",
      displayName: "订单页",
      sandboxDir: "/sandbox/A/订单页",
      mdFile: "订单页.md",
      md: "# 订单页",
    })
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# 登录页\n\n原始说明 + A 草稿")

    setCurrent(b)
    await useDocsStore.getState().loadDesc(b)
    expect(useDocsStore.getState().docContent).toBe("# 订单页")
    expect(useDocsStore.getState().draftStash[`${a.sandboxDir}::desc`]).toBe(
      "# 登录页\n\n原始说明 + A 草稿",
    )

    // 切回 A：恢复编辑态与草稿，正文仍是磁盘内容（dirty 可被保存）。
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    const st = useDocsStore.getState()
    expect(st.editing).toBe(true)
    expect(st.draft).toBe("# 登录页\n\n原始说明 + A 草稿")
    expect(st.docContent).toBe("# 登录页\n\n原始说明")
  })

  it("放弃暂存草稿后切回不再复活；discard 也会清掉暂存", async () => {
    installApi()
    const a = source()
    const b = source({
      name: "订单页.html",
      displayName: "订单页",
      sandboxDir: "/sandbox/A/订单页",
      mdFile: "订单页.md",
      md: "# 订单页",
    })
    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# A 草稿")
    setCurrent(b)
    await useDocsStore.getState().loadDesc(b)

    const key = `${a.sandboxDir}::desc`
    useDocsStore.setState({ pendingGuard: { kind: "source", dir: a.sandboxDir, name: a.displayName, key } })
    useDocsStore.getState().resolveGuard(true)
    expect(useDocsStore.getState().draftStash[key]).toBeUndefined()

    setCurrent(a)
    await useDocsStore.getState().loadDesc(a)
    expect(useDocsStore.getState().editing).toBe(false)
    expect(useDocsStore.getState().draft).toBe("# 登录页\n\n原始说明")

    useDocsStore.getState().beginEdit()
    useDocsStore.getState().setDraft("# 又改了")
    useDocsStore.getState().discard()
    expect(useDocsStore.getState().draftStash[key]).toBeUndefined()
    expect(useDocsStore.getState().editing).toBe(false)
  })

  it("关闭文档面板：脏草稿拦下并要求确认，取消后仍编辑、确认后才关闭", () => {
    useDocsStore.setState({
      sourceDir: "/sandbox/A/登录页",
      docContent: "# A",
      draft: "# A 改",
      editing: true,
    })
    useUiStore.setState({ docsOpen: true })

    useUiStore.getState().closeDocs()
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(useDocsStore.getState().pendingGuard).toEqual({ kind: "close-panel" })

    useDocsStore.getState().resolveGuard(false)
    expect(useDocsStore.getState().editing).toBe(true)
    expect(useDocsStore.getState().draft).toBe("# A 改")

    useUiStore.getState().closeDocs()
    useDocsStore.getState().resolveGuard(true)
    expect(useUiStore.getState().docsOpen).toBe(false)
    expect(useDocsStore.getState().draft).toBe("# A")
    expect(useDocsStore.getState().editing).toBe(false)
  })

  it("无脏草稿时关闭面板不打扰", () => {
    useDocsStore.setState({ docContent: "# A", draft: "# A", editing: false })
    useUiStore.setState({ docsOpen: true })
    useUiStore.getState().closeDocs()
    expect(useUiStore.getState().docsOpen).toBe(false)
    expect(useDocsStore.getState().pendingGuard).toBeNull()
  })
})

describe("DocEditor 编辑/预览切换（docs-P1-1 回归）", () => {
  const MD = [
    "# 商城首页",
    "",
    "商城首页 — 产品需求文档（PRD）",
    "",
    "---",
    "",
    "## 页面数据",
    "",
    "| 维度 | 说明 |",
    "| --- | --- |",
    "| 页面数据 | 字段与值 |",
    "",
    "```text",
    "const x = 1",
    "```",
  ].join("\n")

  function seedPreview(content = MD): void {
    useDocsStore.setState({
      docContent: content,
      draft: content,
      editing: false,
      tab: "desc",
      lastError: "",
    })
  }

  /** 预览区不得出现原始 Markdown 语法，也不得把整篇正文渲染两遍。 */
  function expectCleanPreview(preview: HTMLElement): void {
    const text = preview.textContent ?? ""
    expect(text).not.toContain("# 商城首页")
    expect(text).not.toContain("| 维度 | 说明 |")
    expect(text).not.toContain("| --- | --- |")
    expect(text).not.toContain("```")
    // 直接子节点必须全部是 React 渲染的元素；残留的原始 Markdown 是文本节点。
    expect(Array.from(preview.childNodes).every((node) => node.nodeType === Node.ELEMENT_NODE)).toBe(true)
    // 无重复正文：标题/表格/代码块/唯一单元格各出现一次。
    expect(preview.querySelectorAll("h1")).toHaveLength(1)
    expect(preview.querySelectorAll("table")).toHaveLength(1)
    expect(preview.querySelectorAll("pre[data-doc-code]")).toHaveLength(1)
    expect(text.match(/字段与值/g)).toHaveLength(1)
    expect(text.match(/const x = 1/g)).toHaveLength(1)
  }

  it("进入编辑→取消：预览不混入原始 Markdown，也不重复渲染正文", () => {
    seedPreview()
    render(createElement(DocEditor))

    const previewBefore = screen.getByTestId("doc-preview")
    fireEvent.click(screen.getByRole("button", { name: "进入编辑" }))
    expect(screen.getByTestId("doc-edit-area")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))

    expect(screen.queryByTestId("doc-edit-area")).toBeNull()
    const previewAfter = screen.getByTestId("doc-preview")
    // 编辑/预览不复用同一个 DOM 节点（否则 contenteditable 里的文本会被预览继承）。
    expect(previewAfter).not.toBe(previewBefore)
    expectCleanPreview(previewAfter)
  })

  it("进入编辑→修改→取消：草稿回滚，预览保持原文且不写磁盘", () => {
    const calls = installApi()
    seedPreview()
    render(createElement(DocEditor))

    fireEvent.click(screen.getByRole("button", { name: "进入编辑" }))
    const area = screen.getByTestId("doc-edit-area")
    area.textContent = "# 商城首页\n\n被改坏的正文"
    fireEvent.input(area)
    expect(useDocsStore.getState().draft).toContain("被改坏的正文")

    fireEvent.click(screen.getByRole("button", { name: "取消" }))

    const st = useDocsStore.getState()
    expect(st.docContent).toBe(MD)
    expect(st.draft).toBe(MD)
    expect(st.editing).toBe(false)
    expect(calls.write).toHaveLength(0)
    const preview = screen.getByTestId("doc-preview")
    expect(preview.textContent).not.toContain("被改坏的正文")
    expectCleanPreview(preview)
  })

  it("编辑态粘贴纯文本→取消：编辑区不带富文本标签，预览仍干净", () => {
    seedPreview()
    render(createElement(DocEditor))

    fireEvent.click(screen.getByRole("button", { name: "进入编辑" }))
    const area = screen.getByTestId("doc-edit-area")
    fireEvent.paste(area, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "第一行\n第二行" : '<span style="color:red">富文本</span>',
      },
    })

    // 粘贴只保留纯文本 + <br>，剪贴板 HTML 不进入编辑器。
    expect(area.innerHTML).not.toMatch(/span|style=/)
    expect(area.textContent).toContain("第一行")
    expect(area.textContent).toContain("第二行")
    expect(area.innerHTML).toContain("<br>")
    expect(useDocsStore.getState().draft).toContain("第一行")

    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expectCleanPreview(screen.getByTestId("doc-preview"))
  })

  it("编辑→保存：仍走 sandbox:write，保存后预览渲染新正文", async () => {
    const calls = installApi()
    const src = source({ md: MD })
    setCurrent(src)
    await useDocsStore.getState().loadDesc(src)
    render(createElement(DocEditor))

    fireEvent.click(screen.getByRole("button", { name: "进入编辑" }))
    const area = screen.getByTestId("doc-edit-area")
    area.textContent = "# 新标题\n\n保存后的正文"
    fireEvent.input(area)
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(screen.queryByTestId("doc-edit-area")).toBeNull())
    expect(calls.write).toEqual([
      { dir: "/sandbox/A/登录页", file: "登录页.md", content: "# 新标题\n\n保存后的正文" },
    ])
    const preview = screen.getByTestId("doc-preview")
    expect(preview.textContent).toContain("新标题")
    expect(preview.textContent).toContain("保存后的正文")
    expect(preview.textContent).not.toContain("# 新标题")
    expect(preview.querySelectorAll("h1")).toHaveLength(1)
    expect(useDocsStore.getState().editing).toBe(false)
  })
})
