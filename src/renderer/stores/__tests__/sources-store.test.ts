/**
 * src/renderer/stores/__tests__/sources-store.test.ts — W3-01 数据底座单测。
 *
 * 覆盖：
 * - 纯函数：detectKind / detectKindByName / extractPages（旧实现逐字移植）
 * - sandbox:projects → projects[]
 * - sandbox:list → SourceRef（字段逐字对齐 project-ai-export.js:8125-8127）
 * - 当前源 / 子页切换（sandbox:read-file）与 app-store project/proto/page 同步
 * - protoLastProject 启动恢复键
 * - 裸键 protoGroups_v1 一次性迁移（legacy-migrate.ts）
 * - contentZoom clamp 下限 0.2 / fallback 0.85
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  detectKind,
  detectKindByName,
  extractPages,
  protoGroupKey,
  useSourcesStore,
} from "../sources-store"
import { useAppStore } from "../app-store"
import { migrateLegacyGroups } from "@/lib/legacy-migrate"
import {
  ORDER_KEY,
  PROTO_LAST_PROJECT,
  SUB_ORDER_KEY,
  groupsKey,
  loadGroupsData,
  readContentZoom,
} from "@/lib/storage-keys"

type AnyFn = (...args: unknown[]) => unknown

const INITIAL = {
  project: "",
  projects: [],
  sources: [],
  currentSource: null,
  activeSubFile: "",
  activeContent: "",
  loading: false,
  error: "",
  pickerOpen: false,
  orderRevision: 0,
  folderRevision: 0,
}

function reset(): void {
  localStorage.clear()
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
  useSourcesStore.setState(INITIAL)
  useAppStore.setState({ project: "", proto: "", page: "", kind: "pc" })
}

interface ApiHandlers {
  projects?: AnyFn
  list?: AnyFn
  readFile?: AnyFn
}

function installApi(handlers: ApiHandlers): void {
  const api = {
    sandbox: {
      projects: handlers.projects ?? (async () => ({ root: "R", projects: [] })),
      list: handlers.list ?? (async () => ({ root: "R", folders: [] })),
      readFile: handlers.readFile ?? (async () => ({ ok: false, error: "not-found" })),
    },
  }
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = api
}

function folder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "登录页",
    project: "A",
    root: "R",
    dir: "/sandbox/A/登录页",
    htmlFile: "登录页.html",
    html:
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<a href="#page-chat">进入</a><a href="#page-list">列表</a>',
    mdFile: "登录页.md",
    md: "# 登录页",
    subPages: [{ file: "详情.html", name: "详情" }],
    htmlFiles: ["登录页.html", "详情.html"],
    ...overrides,
  }
}

function namedFolder(name: string, subPages?: unknown[]): Record<string, unknown> {
  return folder({
    name,
    dir: `/sandbox/A/${name}`,
    htmlFile: `${name}.html`,
    mdFile: `${name}.md`,
    subPages: subPages ?? [],
    htmlFiles: [`${name}.html`, ...(subPages ?? []).map((sp) => (sp as { file: string }).file)],
  })
}

function seedGroups(
  list: Array<{ id: string; name: string; parent: string | null }>,
  map: Record<string, string> = {}
): void {
  localStorage.setItem(groupsKey("A"), JSON.stringify({ list, map }))
}

function storedProtoOrder(): Record<string, Record<string, string[]>> {
  return JSON.parse(localStorage.getItem(ORDER_KEY) || "{}")
}

function storedSubOrder(): Record<string, string[]> {
  return JSON.parse(localStorage.getItem(SUB_ORDER_KEY) || "{}")
}

beforeEach(reset)

describe("纯函数：端别推断（旧 sandbox-core.js:28-47）", () => {
  it("移动视口 + device-width → mobile", () => {
    expect(detectKind('<meta name="viewport" content="width=device-width">')).toBe("mobile")
  })

  it("明显桌面断点 → pc", () => {
    expect(
      detectKind('<style>@media (min-width: 1024px) { .a{display:block} }</style>')
    ).toBe("pc")
  })

  it("空内容/普通 html → pc", () => {
    expect(detectKind("")).toBe("pc")
    expect(detectKind("<html><body>hello</body></html>")).toBe("pc")
  })

  it("文件名优先：含「移动」→ mobile；含 PC → pc；否则回退内容", () => {
    expect(detectKindByName("移动端首页.html", "")).toBe("mobile")
    expect(detectKindByName("PC-home.html", "")).toBe("pc")
    expect(detectKindByName("pc_home.html", "")).toBe("pc")
    expect(detectKindByName("home.html", '<meta name="viewport" content="width=device-width">')).toBe(
      "mobile"
    )
  })
})

describe("纯函数：页面路由提取（旧 nav-zoom.js:12-26）", () => {
  it("提取 hash 路由与 switchRoot/push/showPage 参数，去重保序", () => {
    const html = [
      '<a href="#page-chat">a</a>',
      '<a href="#page-list?x=1">b</a>',
      '<a href="#sheet-x">忽略</a>',
      "switchRoot('page-detail')",
      'showPage("page-chat")',
      'push("page-form")',
    ].join("\n")
    expect(extractPages(html)).toEqual(["page-chat", "page-list", "page-detail", "page-form"])
  })

  it("空内容返回空数组", () => {
    expect(extractPages("")).toEqual([])
  })
})

describe("项目列表（sandbox:projects）", () => {
  it("归一化并按 zh-CN 名称排序，保留 protoCount", async () => {
    installApi({
      projects: async () => ({
        ok: true,
        root: "R",
        projects: [
          { name: "B 项目", protoCount: 2 },
          { name: "A 项目", protoCount: 0 },
          { name: "" },
        ],
      }),
    })
    const list = await useSourcesStore.getState().loadProjects()
    expect(list.map((p) => p.name)).toEqual(["A 项目", "B 项目"])
    expect(useSourcesStore.getState().projects).toEqual(list)
    expect(list[1].protoCount).toBe(2)
    expect(useSourcesStore.getState().loading).toBe(false)
  })

  it("网关缺失时回空列表 + 错误，不抛错", async () => {
    const list = await useSourcesStore.getState().loadProjects()
    expect(list).toEqual([])
    expect(useSourcesStore.getState().error).toContain("missing protoAPI")
  })

  it("真实主进程形态（无 ok 字段）仍能读到载荷", async () => {
    installApi({
      projects: async () => ({ root: "R", projects: [{ name: "A", protoCount: 1 }] }),
    })
    const list = await useSourcesStore.getState().loadProjects()
    expect(list).toEqual([{ name: "A", protoCount: 1 }])
    expect(useSourcesStore.getState().error).toBe("")
  })
})

describe("原型列表（sandbox:list）→ SourceRef", () => {
  it("字段逐字对齐冻结契约，并同步 app-store project/proto/page/kind", async () => {
    installApi({ list: async () => ({ root: "R", folders: [folder()] }) })
    await useSourcesStore.getState().loadSources("A")

    const s = useSourcesStore.getState().currentSource
    expect(s).not.toBeNull()
    expect(s).toMatchObject({
      name: "登录页.html",
      displayName: "登录页",
      kind: "mobile",
      sandboxDir: "/sandbox/A/登录页",
      mainHtmlFile: "登录页.html",
      mdFile: "登录页.md",
      md: "# 登录页",
      subPages: [{ file: "详情.html", name: "详情" }],
      htmlFiles: ["登录页.html", "详情.html"],
    })
    expect(s?.content).toContain("page-chat")
    expect(s?.pages).toEqual(["page-chat", "page-list"])
    expect(s?.__ver).toBeGreaterThanOrEqual(1)
    expect(s?.activeSubFile).toBe("登录页.html")

    const app = useAppStore.getState()
    expect(app.project).toBe("A")
    expect(app.proto).toBe("登录页")
    expect(app.page).toBe("page-chat")
    expect(app.kind).toBe("mobile")
  })

  it("无 html 的文件夹不作为原型源；空项目清掉上个项目残留", async () => {
    installApi({ list: async () => ({ ok: true, folders: [folder()] }) })
    await useSourcesStore.getState().loadSources("A")
    expect(useSourcesStore.getState().sources).toHaveLength(1)

    installApi({
      list: async () => ({
        ok: true,
        folders: [folder({ name: "空文件夹", dir: "/sandbox/A/空文件夹", htmlFile: null, html: null })],
      }),
    })
    await useSourcesStore.getState().loadSources("A")
    expect(useSourcesStore.getState().sources).toEqual([])
    expect(useSourcesStore.getState().currentSource).toBeNull()
    expect(useSourcesStore.getState().activeSubFile).toBe("")
    expect(useAppStore.getState().proto).toBe("")
    expect(useAppStore.getState().page).toBe("")
  })

  it("selectName 命中 displayName（新建原型后自动选中）", async () => {
    installApi({
      list: async () => ({
        ok: true,
        folders: [folder(), folder({ name: "订单页", dir: "/sandbox/A/订单页", htmlFile: "订单页.html" })],
      }),
    })
    await useSourcesStore.getState().loadSources("A", "订单页")
    expect(useSourcesStore.getState().currentSource?.displayName).toBe("订单页")
  })

  it("refresh 保留当前源且 __ver 递增（保存守卫不丢版本）", async () => {
    installApi({ list: async () => ({ ok: true, folders: [folder()] }) })
    await useSourcesStore.getState().loadSources("A")
    const first = useSourcesStore.getState().currentSource
    await useSourcesStore.getState().refresh()
    const second = useSourcesStore.getState().currentSource
    expect(second?.displayName).toBe("登录页")
    expect(second?.__ver).toBeGreaterThan(first?.__ver ?? 0)
  })

  it("顶栏手动切端别回写当前源（旧 setKind 语义）", async () => {
    installApi({ list: async () => ({ ok: true, folders: [folder()] }) })
    await useSourcesStore.getState().loadSources("A")
    expect(useSourcesStore.getState().currentSource?.kind).toBe("mobile")
    useAppStore.getState().setKind("pc")
    expect(useSourcesStore.getState().currentSource?.kind).toBe("pc")
    await useSourcesStore.getState().refresh()
    expect(useSourcesStore.getState().currentSource?.kind).toBe("pc")
  })
})

describe("切源 / 切子页", () => {
  it("selectSource 回到主页并同步 app-store", async () => {
    installApi({
      list: async () => ({ ok: true, folders: [folder()] }),
      readFile: async () => ({ ok: true, content: '<a href="#page-detail">详情</a>' }),
    })
    await useSourcesStore.getState().loadSources("A")
    await useSourcesStore.getState().selectSubPage("详情.html")
    expect(useSourcesStore.getState().activeSubFile).toBe("详情.html")

    useSourcesStore.getState().selectSource("登录页")
    expect(useSourcesStore.getState().activeSubFile).toBe("登录页.html")
    expect(useSourcesStore.getState().activeContent).toBe("")
    expect(useAppStore.getState().page).toBe("page-chat")
  })

  it("selectSubPage 走 sandbox:readFile 并更新 activeContent/page", async () => {
    let readArgs: unknown = null
    installApi({
      list: async () => ({ ok: true, folders: [folder()] }),
      readFile: async (o) => {
        readArgs = o
        return { ok: true, file: "详情.html", content: '<a href="#page-detail">详情</a>' }
      },
    })
    await useSourcesStore.getState().loadSources("A")
    await useSourcesStore.getState().selectSubPage("详情.html")

    expect(readArgs).toEqual({ dir: "/sandbox/A/登录页", file: "详情.html" })
    const state = useSourcesStore.getState()
    expect(state.activeSubFile).toBe("详情.html")
    expect(state.activeContent).toContain("page-detail")
    expect(state.currentSource?.activeSubFile).toBe("详情.html")
    expect(state.currentSource?.activeContent).toContain("page-detail")
    expect(useAppStore.getState().page).toBe("page-detail")
  })

  it("读子页失败保留主页并给出错误，不串源", async () => {
    installApi({
      list: async () => ({ ok: true, folders: [folder()] }),
      readFile: async () => ({ ok: false, error: "EACCES" }),
    })
    await useSourcesStore.getState().loadSources("A")
    await useSourcesStore.getState().selectSubPage("详情.html")
    const state = useSourcesStore.getState()
    expect(state.activeSubFile).toBe("登录页.html")
    expect(state.error).toContain("EACCES")
    expect(useAppStore.getState().page).toBe("page-chat")
  })
})

describe("新建子页后刷新并切换（B4 P2-2）", () => {
  it("非当前原型创建子页：刷新父源 subPages/htmlFiles 后切到新子页", async () => {
    let folders: Record<string, unknown>[] = [namedFolder("首页"), namedFolder("我的")]
    const readArgs: unknown[] = []
    installApi({
      list: async () => ({ folders }),
      readFile: async (o) => {
        readArgs.push(o)
        return { ok: true, file: "新页.html", content: '<a href="#page-new">新</a>' }
      },
    })
    await useSourcesStore.getState().loadSources("A", "我的")
    expect(useSourcesStore.getState().currentSource?.displayName).toBe("我的")

    // 模拟 sandbox:create-subpage 后 sandbox:list 带回新文件。
    folders = [
      namedFolder("首页", [{ file: "新页.html", name: "新页" }]),
      namedFolder("我的"),
    ]
    const switched = await useSourcesStore
      .getState()
      .syncCreatedSubPage("/sandbox/A/首页", "新页.html", "新页")

    expect(switched).toBe(true)
    expect(readArgs).toEqual([{ dir: "/sandbox/A/首页", file: "新页.html" }])
    const state = useSourcesStore.getState()
    expect(state.currentSource?.displayName).toBe("首页")
    expect(state.currentSource?.subPages).toContainEqual({ file: "新页.html", name: "新页" })
    expect(state.currentSource?.htmlFiles).toContain("新页.html")
    expect(state.activeSubFile).toBe("新页.html")
    expect(state.activeContent).toContain("page-new")
    expect(state.error).toBe("")
    expect(useAppStore.getState().proto).toBe("首页")
    expect(useAppStore.getState().page).toBe("page-new")
  })

  it("当前原型创建子页：刷新后直接切到新子页", async () => {
    let folders: Record<string, unknown>[] = [namedFolder("首页")]
    installApi({
      list: async () => ({ folders }),
      readFile: async () => ({ ok: true, content: "<html>新页</html>" }),
    })
    await useSourcesStore.getState().loadSources("A", "首页")

    folders = [namedFolder("首页", [{ file: "新页.html", name: "新页" }])]
    const switched = await useSourcesStore
      .getState()
      .syncCreatedSubPage("/sandbox/A/首页", "新页.html", "新页")

    expect(switched).toBe(true)
    expect(useSourcesStore.getState().currentSource?.displayName).toBe("首页")
    expect(useSourcesStore.getState().activeSubFile).toBe("新页.html")
  })

  it("sandbox:list 尚未收录新文件时补入 UI 状态，不报「子页面不存在」", async () => {
    const folders = [namedFolder("首页"), namedFolder("我的")]
    installApi({
      list: async () => ({ folders }),
      readFile: async () => ({ ok: true, content: "<html>新页</html>" }),
    })
    await useSourcesStore.getState().loadSources("A", "我的")

    const switched = await useSourcesStore
      .getState()
      .syncCreatedSubPage("/sandbox/A/首页", "新页.html", "新页")

    expect(switched).toBe(true)
    const home = useSourcesStore.getState().sources.find((s) => s.displayName === "首页")
    expect(home?.subPages).toContainEqual({ file: "新页.html", name: "新页" })
    expect(home?.htmlFiles).toContain("新页.html")
    expect(useSourcesStore.getState().activeSubFile).toBe("新页.html")
    expect(useSourcesStore.getState().error).toBe("")
  })

  it("父原型不在 sources 时不刷新、不切换", async () => {
    let listCalls = 0
    installApi({
      list: async () => {
        listCalls += 1
        return { folders: [namedFolder("首页")] }
      },
    })
    await useSourcesStore.getState().loadSources("A", "首页")
    const before = listCalls
    const current = useSourcesStore.getState().currentSource

    const switched = await useSourcesStore
      .getState()
      .syncCreatedSubPage("/sandbox/A/不存在", "新页.html", "新页")

    expect(switched).toBe(false)
    expect(listCalls).toBe(before)
    expect(useSourcesStore.getState().currentSource).toBe(current)
  })
})

describe("项目进入 / 启动恢复", () => {
  it("enterProject 写 protoLastProject 并清空旧项目残留", async () => {
    installApi({ list: async () => ({ ok: true, folders: [folder()] }) })
    await useSourcesStore.getState().loadSources("旧项目")
    await useSourcesStore.getState().enterProject("A")

    expect(localStorage.getItem(PROTO_LAST_PROJECT)).toBe("A")
    expect(useSourcesStore.getState().project).toBe("A")
    expect(useSourcesStore.getState().currentSource?.displayName).toBe("登录页")
    expect(useAppStore.getState().project).toBe("A")
  })

  it("空项目名不进入、不写键", async () => {
    await useSourcesStore.getState().enterProject("   ")
    expect(localStorage.getItem(PROTO_LAST_PROJECT)).toBeNull()
    expect(useSourcesStore.getState().project).toBe("")
  })
})

describe("裸键迁移（legacy-migrate.ts，C12）", () => {
  it("protoGroups_v1 一次性迁入当前项目并删除裸键", () => {
    const legacy = {
      list: [{ id: "g1", name: "老文件夹", parent: null }],
      map: { 登录页: "g1" },
    }
    localStorage.setItem("protoGroups_v1", JSON.stringify(legacy))

    expect(migrateLegacyGroups("A")).toBe(true)
    expect(localStorage.getItem("protoGroups_v1")).toBeNull()
    expect(JSON.parse(localStorage.getItem(groupsKey("A")) as string)).toEqual(legacy)
    expect(useAppStore.getState().readGroups("A").list).toHaveLength(1)
  })

  it("已有作用域数据时不迁移、不覆盖", () => {
    const scoped = { list: [{ id: "g2", name: "新文件夹", parent: null }], map: {} }
    localStorage.setItem(groupsKey("A"), JSON.stringify(scoped))
    localStorage.setItem(
      "protoGroups_v1",
      JSON.stringify({ list: [{ id: "g1", name: "老文件夹", parent: null }], map: {} })
    )

    expect(migrateLegacyGroups("A")).toBe(false)
    expect(JSON.parse(localStorage.getItem(groupsKey("A")) as string)).toEqual(scoped)
    expect(localStorage.getItem("protoGroups_v1")).not.toBeNull()
  })

  it("enterProject 前迁移，随后 Sidebar 能读到老分组", async () => {
    localStorage.setItem(
      "protoGroups_v1",
      JSON.stringify({ list: [{ id: "g1", name: "老文件夹", parent: "p1" }], map: {} })
    )
    installApi({ list: async () => ({ ok: true, folders: [] }) })
    await useSourcesStore.getState().enterProject("A")
    expect(localStorage.getItem("protoGroups_v1")).toBeNull()
    expect(useAppStore.getState().readGroups("A").list[0]).toEqual({
      id: "g1",
      name: "老文件夹",
      parent: "p1",
    })
  })
})

describe("侧栏排序 / 跨文件夹移动 / 文件夹 CRUD（P0-4）", () => {
  it("reorderProto 同组排序写入 protoOrder_v1，刷新顺序不变", async () => {
    installApi({
      list: async () => ({
        folders: [namedFolder("A"), namedFolder("B"), namedFolder("C")],
      }),
    })
    await useSourcesStore.getState().loadSources("A")
    expect(useSourcesStore.getState().sources.map(protoGroupKey)).toEqual(["A", "B", "C"])

    expect(useSourcesStore.getState().reorderProto("", "A", "C", "before")).toBe(true)
    expect(storedProtoOrder().A.ungrouped).toEqual(["B", "A", "C"])
    expect(useSourcesStore.getState().orderRevision).toBeGreaterThan(0)

    // 刷新（重新拉列表）后，持久化顺序仍由 Sidebar 的 orderedBy 读取。
    await useSourcesStore.getState().loadSources("A")
    expect(storedProtoOrder().A.ungrouped).toEqual(["B", "A", "C"])

    expect(useSourcesStore.getState().reorderProto("", "C", "B", "after")).toBe(true)
    expect(storedProtoOrder().A.ungrouped).toEqual(["B", "C", "A"])
  })

  it("moveProtoToGroup 跨文件夹移动：改分组 map + 目标组插入顺序", async () => {
    seedGroups(
      [
        { id: "g1", name: "运营", parent: null },
        { id: "g2", name: "产品", parent: null },
      ],
      { B: "g1" }
    )
    installApi({
      list: async () => ({
        folders: [namedFolder("A"), namedFolder("B"), namedFolder("C")],
      }),
    })
    await useSourcesStore.getState().loadSources("A")

    expect(useSourcesStore.getState().moveProtoToGroup("B", "g2")).toBe(true)
    expect(loadGroupsData("A").map.B).toBe("g2")
    expect(storedProtoOrder().A.g2).toEqual(["B"])

    // 插入到目标组已有节点之前。
    expect(useSourcesStore.getState().moveProtoToGroup("C", "g2", "B")).toBe(true)
    expect(storedProtoOrder().A.g2).toEqual(["C", "B"])
    expect(loadGroupsData("A").map.C).toBe("g2")

    // 追加到末尾。
    expect(useSourcesStore.getState().moveProtoToGroup("A", "g2")).toBe(true)
    expect(storedProtoOrder().A.g2).toEqual(["C", "B", "A"])
    expect(loadGroupsData("A").map.A).toBe("g2")

    // 再移出到未分组：分组 map 删除对应键，排序数组去重。
    expect(useSourcesStore.getState().moveProtoToGroup("B", "")).toBe(true)
    expect(loadGroupsData("A").map.B).toBeUndefined()
    expect(storedProtoOrder().A.ungrouped).toEqual(["B"])
    expect(storedProtoOrder().A.g2).toEqual(["C", "A"])
  })

  it("remapProtoKey 改名后保留分组与排序", async () => {
    seedGroups([{ id: "g1", name: "运营", parent: null }], { A: "g1" })
    localStorage.setItem(ORDER_KEY, JSON.stringify({ A: { g1: ["A", "B"] } }))
    installApi({
      list: async () => ({ folders: [namedFolder("A"), namedFolder("B")] }),
    })
    await useSourcesStore.getState().loadSources("A")

    expect(useSourcesStore.getState().remapProtoKey("A", "A2")).toBe(true)
    expect(loadGroupsData("A").map.A2).toBe("g1")
    expect(loadGroupsData("A").map.A).toBeUndefined()
    expect(storedProtoOrder().A.g1).toEqual(["A2", "B"])
  })

  it("reorderSubPage 同目录排序写入 subPageOrder_v1", async () => {
    const dir = "/sandbox/A/登录页"
    const subPages = [
      { file: "详情.html", name: "详情" },
      { file: "列表.html", name: "列表" },
      { file: "结算.html", name: "结算" },
    ]
    localStorage.setItem(
      SUB_ORDER_KEY,
      JSON.stringify({ [dir]: ["详情.html", "列表.html", "结算.html"] })
    )
    installApi({ list: async () => ({ folders: [folder({ subPages })] }) })
    await useSourcesStore.getState().loadSources("A")

    expect(useSourcesStore.getState().reorderSubPage(dir, "结算.html", "详情.html", "before")).toBe(
      true
    )
    expect(storedSubOrder()[dir]).toEqual(["结算.html", "详情.html", "列表.html"])
  })

  it("createFolder / renameFolder 持久化到分组键；同级重名拒绝", async () => {
    seedGroups([{ id: "g1", name: "运营", parent: null }])
    installApi({ list: async () => ({ folders: [namedFolder("A")] }) })
    await useSourcesStore.getState().loadSources("A")

    const created = useSourcesStore.getState().createFolder("产品")
    expect(created.ok).toBe(true)
    expect(created.id).toBeTruthy()
    const child = useSourcesStore.getState().createFolder("子文件夹", created.id)
    expect(child.ok).toBe(true)

    expect(loadGroupsData("A").list.map((g) => g.name)).toEqual(["运营", "产品", "子文件夹"])
    expect(loadGroupsData("A").list.find((g) => g.id === child.id)?.parent).toBe(created.id)

    expect(useSourcesStore.getState().createFolder("产品").ok).toBe(false)
    expect(useSourcesStore.getState().renameFolder(created.id!, "产品2").ok).toBe(true)
    expect(loadGroupsData("A").list.find((g) => g.id === created.id)?.name).toBe("产品2")
    expect(useSourcesStore.getState().renameFolder(created.id!, "运营").ok).toBe(false)
  })

  it("moveFolder 同/跨父级排序持久化，拒绝移入自身后代", async () => {
    seedGroups([
      { id: "g1", name: "运营", parent: null },
      { id: "g2", name: "产品", parent: null },
      { id: "g3", name: "设计", parent: null },
    ])
    installApi({ list: async () => ({ folders: [namedFolder("A")] }) })
    await useSourcesStore.getState().loadSources("A")

    expect(useSourcesStore.getState().moveFolder("g3", null, "g1").ok).toBe(true)
    expect(loadGroupsData("A").list.map((g) => g.id)).toEqual(["g3", "g1", "g2"])

    expect(useSourcesStore.getState().moveFolder("g1", "g2").ok).toBe(true)
    expect(loadGroupsData("A").list.find((g) => g.id === "g1")?.parent).toBe("g2")

    expect(useSourcesStore.getState().moveFolder("g2", "g1").ok).toBe(false)
    expect(loadGroupsData("A").list.find((g) => g.id === "g1")?.parent).toBe("g2")
  })

  it("removeFolder 递归删除子文件夹，原型移入未分组且保留排序", async () => {
    seedGroups(
      [
        { id: "g1", name: "运营", parent: null },
        { id: "gc", name: "子文件夹", parent: "g1" },
      ],
      { A: "g1", B: "gc" }
    )
    localStorage.setItem(
      ORDER_KEY,
      JSON.stringify({ A: { g1: ["A"], gc: ["B"], ungrouped: ["C"] } })
    )
    installApi({
      list: async () => ({
        folders: [namedFolder("A"), namedFolder("B"), namedFolder("C")],
      }),
    })
    await useSourcesStore.getState().loadSources("A")

    expect(useSourcesStore.getState().removeFolder("g1").ok).toBe(true)
    expect(loadGroupsData("A").list).toEqual([])
    expect(loadGroupsData("A").map).toEqual({})
    expect(storedProtoOrder().A.g1).toBeUndefined()
    expect(storedProtoOrder().A.gc).toBeUndefined()
    expect(storedProtoOrder().A.ungrouped).toEqual(["C", "A", "B"])
  })
})

describe("contentZoom（C15）", () => {
  it("clamp 下限 0.2，上限 3", () => {
    useAppStore.getState().setZoom(0.05)
    expect(useAppStore.getState().zoom).toBe(0.2)
    useAppStore.getState().setZoom(9)
    expect(useAppStore.getState().zoom).toBe(3)
  })

  it("存量越界值夹到 0.2，非法值回退 0.85", () => {
    localStorage.setItem("contentZoom", "0.1")
    expect(readContentZoom()).toBe(0.2)
    localStorage.setItem("contentZoom", "abc")
    expect(readContentZoom()).toBe(0.85)
    localStorage.setItem("contentZoom", "9")
    expect(readContentZoom()).toBe(0.85)
  })
})
