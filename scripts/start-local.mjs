import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const port = process.env["PORT"] || "6177"
const vitePort = process.env["VITE_PORT"] || "6173"
const host = process.env["HOST"] || "127.0.0.1"
const env = {
  ...process.env,
  PORT: port,
  VITE_PORT: vitePort,
  REDIRECT_STATIC_TO_VITE: process.env["REDIRECT_STATIC_TO_VITE"] || "true",
}
await runCleanup()

const children = [
  spawn(process.execPath, ["src/server.ts"], {
    cwd: rootDir,
    env,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", host], {
    cwd: rootDir,
    env,
    stdio: "inherit",
  }),
]

let shuttingDown = false

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return
    shuttingDown = true
    for (const other of children) {
      if (other !== child && other.exitCode === null) {
        other.kill(signal || "SIGTERM")
      }
    }
    process.exitCode = typeof code === "number" ? code : 1
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill(signal)
      }
    }
  })
}

async function runCleanup() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/kill-local-servers.mjs", "all"], {
      cwd: rootDir,
      env,
      stdio: "inherit",
    })
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Port cleanup failed with exit code ${code ?? "unknown"}.`))
      }
    })
  })
}
