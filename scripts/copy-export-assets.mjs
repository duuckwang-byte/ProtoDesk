// Phase 0 基座：把导出单文件运行时的三个静态资源复制到 dist 产物。
// 目标目录 dist/renderer/export-assets/；任一源文件缺失即报错并以非零码退出。
import { copyFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const pairs = [
  ["js/export-template.js", "dist/renderer/export-assets/export-template.js"],
  ["js/icons.js", "dist/renderer/export-assets/icons.js"],
  ["src/renderer/styles/export.css", "dist/renderer/export-assets/export.css"],
]

let failed = false
for (const [srcRel, destRel] of pairs) {
  const src = resolve(root, srcRel)
  const dest = resolve(root, destRel)
  if (!existsSync(src)) {
    console.error(`[copy-export-assets] missing source: ${srcRel}`)
    failed = true
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  console.log(`[copy-export-assets] ${srcRel} -> ${destRel}`)
}

if (failed) {
  console.error("[copy-export-assets] FAILED: one or more sources missing")
  process.exit(1)
}
