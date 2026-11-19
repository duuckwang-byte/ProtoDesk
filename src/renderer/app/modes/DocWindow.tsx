/**
 * src/renderer/app/modes/DocWindow.tsx — W3-03 `?docwin=1` 独立文档窗口。
 *
 * 纯净文档模式：只渲染文档面板（DocsPanel），无顶栏/侧栏/舞台。
 * 窗口本身不套 overlay 遮罩：目录与正文左右 flex 常驻（目录 220px，不收起）。
 *
 * 启动直进（对应 `js/core-docs.js:4191-4232 docWinBootProject`）：
 * - query `project` / `proto` 直进 sources-store（`loadSources(project, proto)`）；
 * - 缺 project 时回退 `protoLastProject`，缺 proto 时选中第一个原型；
 * - SourcesStore 驱动 SourceRef → DocsPanel 自动 loadDesc / loadLatest。
 *
 * mirror 语义（与旧通道一字不差，见 preload.js / main/controllers/window-controller.js）：
 * - 监听 `doc:mirror`（经 lib/events onDocMirror），content 到达写入 docs-store（含 tab）；
 * - 保存成功后由 docs-store 经 `doc:mirror-back` 回推 `{ kind: 'content', payload: { docwin: true } }`，
 *   主窗 `applyDocMirrorMessage` 即时更新正文/草稿（本组件只负责接收主窗 push 与 mode 上报）；
 * - open 时上报 `doc:mirror-back` `{ kind: 'mode', mode: 'win' }`；
 * - close 前（beforeunload / 卸载 / Esc 关闭）回 `{ kind: 'mode', mode: 'panel' }`，
 *   与主进程 `closed` 通知互补。
 * - Esc 关闭本窗口，不设全局 closeTopmost 栈。
 */

import { useEffect } from "react"
import DocsPanel from "@/features/docs/DocsPanel"
import { useAppStore } from "@/stores/app-store"
import { useDocsStore } from "@/stores/docs-store"
import { useSourcesStore } from "@/stores/sources-store"
import { onDocMirror } from "@/lib/events"
import { invokeProtoMethod } from "@/lib/ipc"
import { PROTO_LAST_PROJECT, readText } from "@/lib/storage-keys"

function reportMode(mode: "win" | "panel"): void {
  try {
    void invokeProtoMethod("doc", "mirrorBack", { kind: "mode", mode })
  } catch {
    // 上报失败静默（主进程 closed 通知仍会同步面板态）。
  }
}

/** query 参数与 window-controller `encodeURIComponent` 配对；非法转义保持原文。 */
function decodeParam(value: string | null): string {
  const s = String(value ?? "").trim()
  if (!s) return ""
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ""
  return typeof value === "string" ? value : String(value)
}

export default function DocWindow() {
  useEffect(() => {
    let project = ""
    let proto = ""
    try {
      const q = new URLSearchParams(window.location.search)
      project = decodeParam(q.get("project"))
      proto = decodeParam(q.get("proto"))
    } catch {
      // query 解析失败则按空项目/原型启动。
    }
    if (!project) {
      try {
        project = String(readText(PROTO_LAST_PROJECT) ?? "").trim()
      } catch {
        project = ""
      }
    }
    if (proto) {
      useAppStore.getState().setProto(proto.replace(/\.(html?|md)$/i, ""))
    }
    if (project) {
      useAppStore.getState().setProject(project)
      void useSourcesStore
        .getState()
        .loadSources(project, proto || undefined)
        .then(() => {
          try {
            const cur = useSourcesStore.getState().currentSource
            if (cur) document.title = "文档 · " + (cur.displayName || cur.name)
          } catch {
            // 标题失败不影响文档读取。
          }
        })
        .catch(() => {
          // 沙箱读取失败由 sources-store.error 承载。
        })
    }

    // open 上报 mode=win。
    reportMode("win")

    const offMirror = onDocMirror((msg) => {
      try {
        if (!msg || typeof msg !== "object") return
        if (msg.kind === "source") {
          const p =
            msg.payload && typeof msg.payload === "object"
              ? (msg.payload as Record<string, unknown>)
              : (msg as unknown as Record<string, unknown>)
          const project = textOf(p.project).trim()
          const proto = textOf(p.proto ?? p.displayName ?? p.sourceName).trim()
          if (project) {
            void useSourcesStore.getState().loadSources(project, proto || undefined)
          }
          return
        }
        if (msg.kind !== "content") return
        useDocsStore.getState().applyMirrorContent(msg.payload ?? msg)
      } catch {
        // mirror 脏消息静默丢弃。
      }
    })

    // close 前回 mode=panel。
    let reported = false
    const reportPanel = () => {
      if (reported) return
      reported = true
      reportMode("panel")
    }
    const onBeforeUnload = () => reportPanel()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        window.close()
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("keydown", onKeyDown)
      offMirror()
      reportPanel()
    }
  }, [])

  return (
    <div
      data-testid="doc-window"
      className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground"
    >
      <DocsPanel variant="window" />
    </div>
  )
}
