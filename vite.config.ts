import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDirectory, "./src"),
    },
  },
})
