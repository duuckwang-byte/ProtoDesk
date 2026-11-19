import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src/renderer") } },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react"
          if (/[\\/]node_modules[\\/]zustand[\\/]/.test(id)) return "vendor-zustand"
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-lucide"
          return "vendor"
        },
      },
    },
  },
})
