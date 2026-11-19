/**
 * features/export/ExportMenu.tsx — 导出菜单（Wave 2-L）。
 * 方案 §10.3/Phase 6：源码 / 独立 HTML / 文档 PNG-PDF-MD 菜单。
 * 单文件导出只读 `export-assets/`（构建时 scripts/copy-export-assets.mjs 把
 * js/export-template.js、js/icons.js、export.css 复制到 dist/renderer/export-assets，
 * 开发态 http://localhost:5173/export-assets 同样可达），不再假设根目录存在 app.css。
 * 契约不变：注入 window.__EXPORT_BOOT__ / window.__EXPORT_SOURCES__ /
 * window.__REQ_MAP__ / window.__EXPORT_LINKS__ / window.__ANNO_MAP__（与旧
 * buildExportHtml 一致，js/export-template.js 本人只读消费不改动）；
 * 导出 HTML 仅内联轻量 vanilla 模板，不加载 React。
 *
 * W3-04：
 * - 文档 PNG/PDF 先经 `renderDocPreview(docContent)` 生成 HTML，再发
 *   `{title,html,width,scale}`（主进程 doc-export-service.js 只认 `html`）。
 * - 独立 HTML 取真实源内容；md 图片经 `sandbox:list-assets` →
 *   `sandbox:read-asset-base64` 内联为 dataUrl（失败降级不阻断）。
 *
 * W4-P2：独立 HTML 右侧文档区只保留一份可见 DOM（`#docContent` 参与布局），
 * 不再输出隐藏的 `#docContent/#docTitle` 副本；`js/export-template.js` 按
 * 可见节点优先渲染 md，兼容旧导出（隐藏 docContent + 可见 exportLiteDoc）。
 */

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { renderDocPreview } from "@/stores/docs-store";
import { invokeProtoMethod } from "@/lib/ipc";
import { buildDocExportPayload, inlineMarkdownImages } from "@/features/export/export-assets";

/** 导出源（沿用旧 buildExportHtml chosenList 条目口径的子集）。 */
export interface ExportSourceItem {
  name: string;
  displayName: string;
  kind?: string;
  method?: string;
  content?: string;
  path?: string;
  mdName?: string;
  md?: string;
  sandboxDir?: string;
  /** 主 html 文件名（SourceRef.mainHtmlFile，缺 content 时按此读取）。 */
  mainHtmlFile?: string;
  /** 同目录 md 文件名（SourceRef.mdFile，缺 md 时按此读取）。 */
  mdFile?: string | null;
}

export interface ExportMenuProps {
  projectName?: string;
  sources: ExportSourceItem[];
  currentName?: string;
  reqMap?: Record<string, string>;
  linksData?: Array<{ name: string; displayName: string; links: unknown[] }>;
  annoMap?: Record<string, unknown[]>;
  /** 当前文档 Markdown（文档 PNG/PDF/MD 导出用）。 */
  docText?: string;
  docTitle?: string;
  onExported?: (kind: "source" | "html" | "png" | "pdf" | "md") => void;
}

/** 导出产物注入的全局契约键（与旧 buildExportHtml / export-template 完全一致）。 */
const EXPORT_BOOT_KEY = "__EXPORT_BOOT__";
const EXPORT_SOURCES_KEY = "__EXPORT_SOURCES__";

function escAttr(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 内联脚本转义：防止 `</script>` 提前闭合（与旧 safeScript 一致）。 */
function safeScript(s: string): string {
  return String(s ?? "").replace(/<\/script/gi, "<\\/script");
}

/** 读文本资源（fetch；file:// 下失败回 null，由调用方降级）。 */
async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

/**
 * 读导出模板资源：优先 `export-assets/<file>`，失败回 `./export-assets/<file>`。
 * 对应构建复制产物 dist/renderer/export-assets/（§5.3/§5.4），绝不读根 app.css。
 */
async function loadExportAsset(file: string): Promise<string | null> {
  const direct = await fetchText("export-assets/" + file);
  if (direct !== null) return direct;
  return fetchText("./export-assets/" + file);
}

/** 读源内容：内存 content → sandbox:read-file(mainHtmlFile) → fetchText(path)。 */
async function readSourceContent(s: ExportSourceItem): Promise<string> {
  let content = String(s.content ?? "");
  if (content) return content;
  const dir = String(s.sandboxDir ?? "").trim();
  const file = String(s.mainHtmlFile || s.name || "").trim();
  if (dir && file) {
    const r = (await invokeProtoMethod("sandbox", "readFile", { dir, file })) as {
      ok: boolean;
      content?: unknown;
    };
    if (r && r.ok && typeof r.content === "string") content = r.content;
  }
  if (!content && s.path) content = (await fetchText(s.path)) || "";
  return content;
}

/**
 * 读源 md：优先磁盘最新内容（sandbox:read-file(mdFile|同名 .md)），失败回内存 md，
 * 最后回 fetchText(mdName)。docs 面板保存只写盘、不刷新 sources-store.md，
 * 因此导出必须先读盘，避免导出列表加载时的旧快照。
 */
async function readSourceMd(s: ExportSourceItem): Promise<string> {
  const dir = String(s.sandboxDir ?? "").trim();
  if (dir) {
    const file =
      String(s.mdFile || "").trim() ||
      String(s.name || "原型").replace(/\.(html?)$/i, "") + ".md";
    const r = (await invokeProtoMethod("sandbox", "readFile", { dir, file })) as {
      ok: boolean;
      content?: unknown;
    };
    if (r && r.ok && typeof r.content === "string") return r.content;
  }
  const memory = String(s.md ?? "");
  if (memory) return memory;
  if (s.mdName) return (await fetchText(s.mdName)) || "";
  return "";
}

function downloadText(filename: string, text: string, mime = "text/html;charset=utf-8"): void {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    useUiStore.getState().pushToast({ title: "导出文件创建失败。" });
  }
}

/**
 * 组装独立单文件 HTML（轻量只读查看器 + JSON 数据，不加载 React）。
 * 契约：window.__EXPORT_BOOT__=true、window.__REQ_MAP__、window.__EXPORT_SOURCES__、
 * window.__EXPORT_LINKS__、window.__ANNO_MAP__；模板脚本为 export-assets 产物。
 */
export function buildStandaloneHtml(opts: {
  title: string;
  embeds: Array<{ name: string; displayName: string; kind: string; content: string; md: string }>;
  reqMap: Record<string, string>;
  linksData: Array<{ name: string; displayName: string; links: unknown[] }>;
  annoMap: Record<string, unknown[]>;
  cssText: string;
  templateJs: string;
  iconsJs: string;
}): string {
  const liteCss =
    "\n.export-lite{max-width:1200px;margin:0 auto;padding:16px;font-family:system-ui,sans-serif;}\n" +
    ".export-lite-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}\n" +
    ".export-lite-item{border:1px solid #ddd;border-radius:8px;padding:6px 12px;background:#fff;cursor:pointer;}\n" +
    ".export-lite-item.on{border-color:#0052ff;color:#0052ff;}\n" +
    ".export-lite-stage{display:flex;gap:16px;}\n" +
    ".export-lite-frame{flex:1 1 auto;min-height:480px;border:1px solid #e5e7eb;border-radius:8px;}\n" +
    ".export-lite-doc{flex:1 1 360px;max-width:480px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fff;}\n" +
    ".export-lite-doc-body{min-height:32px;}\n";
  // 文档区只保留一份可见 DOM：md 直接渲染进参与布局的 #docContent；
  // 标题用可见的 #exportLiteTitle（模板优先可见节点，兼容旧导出结构）。
  const liteBody =
    '<div class="export-lite"><h2>原型预览 · ' + escAttr(opts.embeds[0]?.displayName || opts.title) + "（只读导出）</h2>" +
    '<div class="export-lite-bar" id="exportLiteList"></div>' +
    '<div class="export-lite-stage"><iframe id="frame" class="export-lite-frame" src="about:blank" title="原型预览"></iframe>' +
    '<div class="export-lite-doc"><h3 id="exportLiteTitle"></h3><div id="docContent" class="export-lite-doc-body"></div>' +
    '<div id="sbList" style="display:none"></div></div></div></div>';
  // 契约字面量（与旧 buildExportHtml 逐字一致，__EXPORT_BOOT__/__EXPORT_SOURCES__ 不得更名）。
  const bootScript =
    "window." + EXPORT_BOOT_KEY + "=true;\n" +
    "window.__REQ_MAP__=" + JSON.stringify(opts.reqMap) + ";\n" +
    "window." + EXPORT_SOURCES_KEY + "=" + JSON.stringify(opts.embeds) + ";\n" +
    "window.__EXPORT_LINKS__=" + JSON.stringify(opts.linksData) + ";\n" +
    "window.__ANNO_MAP__=" + JSON.stringify(opts.annoMap) + ";\n";
  return (
    "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>原型预览 · " + escAttr(opts.title) + "</title>\n<style>\n" + opts.cssText + "\n" + liteCss + "\n</style>\n" +
    "<script>\n" + safeScript(bootScript) + "\n<\/script>\n</head>\n<body>\n" +
    liteBody + "\n<!-- standalone viewer: vanilla template only, no react runtime -->\n" +
    "<script>\n" + safeScript(opts.templateJs) + "\n<\/script>\n" +
    (opts.iconsJs ? "<script>\n" + safeScript(opts.iconsJs) + "\n<\/script>\n" : "") +
    "\n</body>\n</html>"
  );
}

/** 导出菜单：源码 / 独立 HTML / 文档 PNG-PDF-MD。 */
export function ExportMenu({
  projectName = "",
  sources,
  currentName,
  reqMap,
  linksData,
  annoMap,
  docText = "",
  docTitle = "",
  onExported,
}: ExportMenuProps) {
  const [busy, setBusy] = React.useState<"source" | "html" | "png" | "pdf" | "md" | null>(null);
  const pushToast = useUiStore((s) => s.pushToast);

  const pickSources = React.useCallback((): ExportSourceItem[] => {
    if (!sources.length) return [];
    if (currentName) {
      const hit = sources.find(
        (s) =>
          s.name === currentName ||
          s.mainHtmlFile === currentName ||
          s.displayName === currentName,
      );
      if (hit) return [hit];
    }
    return [sources[0]];
  }, [sources, currentName]);

  /** 源码导出：JSON 包（含各原型 content + md），与旧“源码”口径对齐。 */
  const exportSource = async () => {
    if (!sources.length) {
      pushToast({ title: "当前没有可导出的原型。" });
      return;
    }
    setBusy("source");
    try {
      const items = await Promise.all(
        sources.map(async (s) => ({
          name: s.name,
          displayName: s.displayName,
          kind: s.kind || "mobile",
          content: await readSourceContent(s),
          md: (await readSourceMd(s)) || (reqMap ? reqMap[s.name] || "" : ""),
        })),
      );
      const bundle = {
        project: projectName,
        exportedAt: new Date().toISOString(),
        sources: items,
      };
      downloadText((projectName || "proto") + "[源码].json", JSON.stringify(bundle, null, 2), "application/json;charset=utf-8");
      pushToast({ title: "源码包已导出。" });
      onExported?.("source");
    } finally {
      setBusy(null);
    }
  };

  /** 独立 HTML 导出：读 dist/export-assets（或构建注入串），契约 __EXPORT_BOOT__/__EXPORT_SOURCES__ 不变。 */
  const exportHtml = async () => {
    const chosen = pickSources();
    if (!chosen.length) {
      pushToast({ title: "请先选择要导出的原型。" });
      return;
    }
    setBusy("html");
    try {
      const [cssText, templateJs, iconsJs] = await Promise.all([
        loadExportAsset("export.css"),
        loadExportAsset("export-template.js"),
        loadExportAsset("icons.js"),
      ]);
      if (!templateJs) {
        pushToast({ title: "导出模板读取失败（export-assets/export-template.js 缺失，请先执行构建复制）。" });
        return;
      }
      const embeds = await Promise.all(
        chosen.map(async (s) => {
          const content = await readSourceContent(s);
          let md = await readSourceMd(s);
          if (!md && reqMap && reqMap[s.name] !== undefined) md = reqMap[s.name];
          // md 图片内联：assets/ 相对图片经 list-assets + read-asset-base64 转 dataUrl。
          if (md) md = await inlineMarkdownImages(md, String(s.sandboxDir ?? ""));
          return {
            name: s.name,
            displayName: s.displayName || s.name,
            kind: s.kind || "mobile",
            content,
            md,
          };
        }),
      );
      if (!embeds.length || !embeds[0].content) {
        pushToast({ title: "所选原型内容读取失败。" });
        return;
      }
      // 最新需求映射：显式传入优先，否则经 doc.readLatest 逐源读取（与旧 buildExportHtml 一致）。
      let finalReqMap: Record<string, string> = reqMap ? { ...reqMap } : {};
      if (!reqMap) {
        const pairs = await Promise.all(
          chosen.map(async (s) => {
            if (!s.sandboxDir) return { name: s.name, content: "" };
            try {
              const r = (await invokeProtoMethod("doc", "readLatest", s.sandboxDir, null)) as { ok: boolean; content?: string };
              return { name: s.name, content: (r && r.ok && typeof r.content === "string" ? r.content : "") || "" };
            } catch {
              return { name: s.name, content: "" };
            }
          }),
        );
        finalReqMap = {};
        for (const p of pairs) finalReqMap[p.name] = p.content;
      }
      const finalLinks =
        linksData ??
        (
          await Promise.all(
            chosen.map(async (s) => {
              if (!s.sandboxDir) return { name: s.name, displayName: s.displayName || s.name, links: [] as unknown[] };
              try {
                const r = (await invokeProtoMethod("links", "read", s.sandboxDir)) as {
                  ok: boolean;
                  data?: { links?: unknown[] };
                };
                return {
                  name: s.name,
                  displayName: s.displayName || s.name,
                  links: (r && r.ok && r.data && Array.isArray(r.data.links) ? r.data.links : []) as unknown[],
                };
              } catch {
                return { name: s.name, displayName: s.displayName || s.name, links: [] as unknown[] };
              }
            }),
          )
        );
      let finalAnno: Record<string, unknown[]> = annoMap ? { ...annoMap } : {};
      if (!annoMap) {
        const pairs = await Promise.all(
          chosen.map(async (s) => {
            if (!s.sandboxDir) return { key: s.displayName || s.name, list: [] as unknown[] };
            try {
              const r = (await invokeProtoMethod("annotations", "read", s.sandboxDir)) as { ok: boolean; data?: unknown };
              return { key: s.displayName || s.name, list: (r && r.ok && Array.isArray(r.data) ? r.data : []) as unknown[] };
            } catch {
              return { key: s.displayName || s.name, list: [] as unknown[] };
            }
          }),
        );
        finalAnno = {};
        for (const p of pairs) finalAnno[p.key] = p.list;
      }
      const html = buildStandaloneHtml({
        title: embeds[0].displayName,
        embeds,
        reqMap: finalReqMap,
        linksData: finalLinks,
        annoMap: finalAnno,
        cssText: cssText || "",
        templateJs,
        iconsJs: iconsJs || "",
      });
      const base =
        chosen.length > 1
          ? `多原型合并(${chosen.length})`
          : String((chosen[0] && (chosen[0].displayName || chosen[0].name)) || "原型").replace(/\.(html?)$/i, "");
      downloadText(base + "[导出].html", html);
      pushToast({ title: "独立 HTML 已导出（离线可读，含 __EXPORT_BOOT__ 数据）。" });
      onExported?.("html");
    } finally {
      setBusy(null);
    }
  };

  /** 文档图片/PDF 导出：md → HTML（renderDocPreview），经 doc 通道落盘（含取消语义）。 */
  const exportDoc = async (kind: "png" | "pdf") => {
    const text = String(docText ?? "");
    if (!text.trim()) {
      pushToast({ title: "当前文档为空，无需导出。" });
      return;
    }
    // 主进程只认 html；空 HTML（渲染失败）同样不发起 IPC。
    const payload = buildDocExportPayload(docTitle, renderDocPreview(text));
    if (!payload) {
      pushToast({ title: "当前文档渲染结果为空，无法导出。" });
      return;
    }
    setBusy(kind);
    try {
      const channel = kind === "png" ? "exportLongImage" : "exportPdf";
      const r = (await invokeProtoMethod("doc", channel, payload)) as {
        ok: boolean;
        error?: string;
        cancelled?: boolean;
      };
      if (!r) return;
      if (r.cancelled) return;
      if (r.ok) {
        pushToast({ title: kind === "png" ? "文档长图已导出。" : "文档 PDF 已导出。" });
        onExported?.(kind);
      } else {
        pushToast({ title: `文档导出失败：${r.error || "未知错误"}` });
      }
    } finally {
      setBusy(null);
    }
  };

  /** 文档 Markdown 导出：本地下载。 */
  const exportMd = () => {
    if (!docText.trim()) {
      pushToast({ title: "当前文档为空，无需导出。" });
      return;
    }
    setBusy("md");
    try {
      downloadText((docTitle || projectName || "文档") + ".md", docText, "text/markdown;charset=utf-8");
      pushToast({ title: "文档 Markdown 已导出。" });
      onExported?.("md");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="export-menu"
        disabled={busy !== null}
        aria-label="导出"
        title="导出源码 / 独立 HTML / 文档"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      >
        <Download className="size-3.5" />
        <span className="hidden xl:inline">{busy ? "导出中…" : "导出"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>源码 / 独立 HTML</DropdownMenuLabel>
        <DropdownMenuItem data-testid="export-source" onSelect={() => void exportSource()}>
          导出源码包（JSON）
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="export-html" onSelect={() => void exportHtml()}>
          导出独立 HTML（单文件离线）
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>文档</DropdownMenuLabel>
        <DropdownMenuItem data-testid="export-png" onSelect={() => void exportDoc("png")}>
          导出文档长图（PNG）
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="export-pdf" onSelect={() => void exportDoc("pdf")}>
          导出文档（PDF）
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="export-md" onSelect={() => void exportMd()}>
          导出文档（Markdown）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ExportMenu;
