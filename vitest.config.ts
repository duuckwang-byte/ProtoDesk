import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src/renderer") } },
  test: {
    environment: "jsdom",
    include: ["src/renderer/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    passWithNoTests: true,
  },
})
