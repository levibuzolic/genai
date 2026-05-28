import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  root: "client",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
