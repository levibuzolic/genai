import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DEFAULT_PORTS = {
  api: process.env["PORT"] || "6177",
  vite: process.env["VITE_PORT"] || "6173",
}
const SKIPPED_PIDS = new Set([String(process.pid), String(process.ppid)])

const targets = new Set(process.argv.slice(2))
const ports = []

if (targets.size === 0 || targets.has("all") || targets.has("api")) {
  ports.push(DEFAULT_PORTS.api)
}
if (targets.size === 0 || targets.has("all") || targets.has("vite")) {
  ports.push(DEFAULT_PORTS.vite)
}

for (const port of new Set(ports)) {
  await killPortListeners(port)
}

async function killPortListeners(port) {
  const pids = await listenerPids(port)
  if (pids.length === 0) return

  console.log(`Stopping existing local server on port ${port}: ${pids.join(", ")}`)
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM")
    } catch (error) {
      if (error?.code !== "ESRCH") throw error
    }
  }

  await waitForPort(port)
  const remainingPids = await listenerPids(port)
  for (const pid of remainingPids) {
    console.log(`Force stopping local server on port ${port}: ${pid}`)
    try {
      process.kill(Number(pid), "SIGKILL")
    } catch (error) {
      if (error?.code !== "ESRCH") throw error
    }
  }
}

async function listenerPids(port) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
    return stdout
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value && !SKIPPED_PIDS.has(value))
  } catch (error) {
    if (error?.code === 1) return []
    throw error
  }
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await listenerPids(port)).length === 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
