import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"

import { MEDIA_DIR, PUBLIC_DIR } from "./config.ts"
import { recordOrEmpty } from "./refinements.ts"
import type { HttpRequest, HttpResponse } from "./types.ts"
import { contentTypeFor, fileExists } from "./utils.ts"

type RangeResult = { ok: true; start: number; end: number } | { ok: false } | null
const APP_ROUTE_PREFIXES = new Set(["create", "items", "settings", "templates"])

export async function serveStatic(response: HttpResponse, pathname: string): Promise<void> {
  const cleanPath = pathname === "/" ? "/index.html" : pathname
  let filePath = path.resolve(PUBLIC_DIR, `.${cleanPath}`)

  if (!filePath.startsWith(PUBLIC_DIR)) {
    logHttpNotFound("static path escaped public root", { pathname, filePath })
    return sendJson(response, { error: "Not found" }, 404)
  }

  if (!(await fileExists(filePath))) {
    const indexPath = path.resolve(PUBLIC_DIR, "./index.html")
    if (!isAppRoutePath(cleanPath) || !(await fileExists(indexPath))) {
      logHttpNotFound("static file not found", { pathname, filePath })
      return sendJson(response, { error: "Not found" }, 404)
    }
    filePath = indexPath
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
  })
  createReadStream(filePath).pipe(response)
}

export function isAppRoutePath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/index.html") {
    return true
  }

  if (path.extname(pathname)) {
    return false
  }

  const prefix = pathname.split("/").find(Boolean)
  return APP_ROUTE_PREFIXES.has(prefix || "")
}

export async function serveMedia(request: HttpRequest, response: HttpResponse, mediaPath: string): Promise<void> {
  const decodedPath = decodeURIComponent(mediaPath)
  const filePath = path.resolve(MEDIA_DIR, decodedPath)

  if (!filePath.startsWith(MEDIA_DIR)) {
    logHttpNotFound("media path escaped media root", { mediaPath, filePath })
    return sendJson(response, { error: "Not found" }, 404)
  }

  if (!(await fileExists(filePath))) {
    logHttpNotFound("media file not found", { mediaPath, filePath })
    return sendJson(response, { error: "Not found" }, 404)
  }

  const fileStat = await stat(filePath)
  const contentType = contentTypeFor(filePath)
  const range = parseRangeHeader(request.headers.range, fileStat.size)

  if (range?.ok === false) {
    response.writeHead(416, {
      "content-range": `bytes */${fileStat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    })
    response.end()
    return
  }

  if (range?.ok) {
    response.writeHead(206, {
      "content-type": contentType,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    })

    if (request.method === "HEAD") {
      response.end()
      return
    }

    createReadStream(filePath, {
      start: range.start,
      end: range.end,
    }).pipe(response)
    return
  }

  response.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  })

  if (request.method === "HEAD") {
    response.end()
    return
  }

  createReadStream(filePath).pipe(response)
}

function parseRangeHeader(header: string | string[] | undefined, size: number): RangeResult {
  if (!header) {
    return null
  }

  const match = String(header).match(/^bytes=(\d*)-(\d*)$/)
  if (!match || size < 1) {
    return {
      ok: false,
    }
  }

  let start: number
  let end: number

  if (match[1] === "" && match[2] === "") {
    return {
      ok: false,
    }
  }

  if (match[1] === "") {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      return {
        ok: false,
      }
    }

    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === "" ? size - 1 : Number(match[2])
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return {
      ok: false,
    }
  }

  return {
    ok: true,
    start,
    end: Math.min(end, size - 1),
  }
}

export async function readJsonBody(request: HttpRequest): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim()
  const parsed: unknown = raw ? JSON.parse(raw) : {}
  return recordOrEmpty(parsed)
}

export function sendJson(response: HttpResponse, body: unknown, statusCode = 200): void {
  sendJsonText(response, stringifyJson(body), statusCode)
}

export function stringifyJson(body: unknown): string {
  return JSON.stringify(body)
}

export function sendJsonText(response: HttpResponse, body: string, statusCode = 200): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
  })
  response.end(body)
}

export function logHttpNotFound(message: string, details: Record<string, unknown> = {}): void {
  const suffix = Object.entries(details)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ")
  console.warn(`[http-404] ${message}${suffix ? ` ${suffix}` : ""}`)
}
