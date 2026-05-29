import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

export function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
  } as const
  return types[extension] || "application/octet-stream"
}

export function sanitizePathPart(value: unknown): string {
  return (
    String(value)
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "unknown"
  )
}

export function resolveMediaDirFromRoot(rootDir: string, value: unknown): string {
  const expanded = String(value).replace(/^~(?=$|\/|\\)/, process.env["HOME"] || "~")
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(rootDir, expanded)
}

export { sleep }

export function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }

  return !/^(?:0|false|no|off)$/i.test(String(value).trim())
}

export function hashBuffer(bytes: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)

    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}
