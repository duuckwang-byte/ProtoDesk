import { defineConfig } from "@playwright/test"

/**
 * Playwright 配置（Phase 0 最小可跑；用例目录 e2e/）。
 *
 * workers: 1 —— 全量必须串行，原因：
 * e2e/electron-live.spec.ts 会通过 `_electron.launch()` 拉起真实 Electron 主进程，
 * 而开发态所有实例共用仓库内的同一份 userData（.devdata）：项目列表、protoLastProject、
 * localStorage 都是同一份磁盘状态。并行 worker 会同时读写它，导致 A 用例弹出的
 * 项目选择器遮住 B 用例的顶栏点击、项目被并发创建/恢复等互相干扰的假失败。
 * Electron 单实例场景无法安全并行，因此全量固定单 worker；文件内另有 serial 约束。
 *
 * timeout 保持 30s：Playwright 的 worker 收尾（Worker Cleanup / gracefullyCloseAll）
 * 使用的也是该 project.timeout。这里刻意不调大，避免用大数值掩盖 Electron/子进程未收尾的
 * 真实泄漏；两个 electron spec 已在 finally/catch + closeAndExpectExit 中显式关闭
 * 5 条启动管道（fd1..4），收尾耗时实测 <1s。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  reporter: "list",
  workers: 1,
})
