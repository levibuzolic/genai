import path from "node:path"

import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const apiPort = Number(process.env["PORT"] || 6177)
const vitePort = Number(process.env["VITE_PORT"] || 6173)

export default defineConfig({
  root: "client",
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/media": `http://127.0.0.1:${apiPort}`,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
    },
  },
})
