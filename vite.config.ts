import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { viteStaticCopy } from "vite-plugin-static-copy"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))
const cesiumBuildDirectory = path.resolve(rootDirectory, "node_modules/cesium/Build/Cesium")
const cesiumStaticDirectories = ["Workers", "ThirdParty", "Assets", "Widgets"]

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: cesiumStaticDirectories.map((directory) => ({
        src: path.resolve(cesiumBuildDirectory, directory, "**/*").replaceAll(path.sep, "/"),
        dest: `cesium/${directory}`,
        rename: { stripBase: 5 },
      })),
    }),
  ],
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
