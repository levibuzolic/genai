import { existsSync, readFileSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { PLAYBOX_API_BASE_URL, PLAYBOX_AUTH_BASE_URL, PLAYBOX_AUTH_IMPORT_PATH } from "./config.ts"
import { httpError } from "./errors.ts"
import { acceptPlayboxAuthorization } from "./playbox-auth-state.ts"
import type { ApiHeaders } from "./types.ts"

const PLAYBOX_HOST_RE = /(^|\.)playbox\.com$/iu
const IMPORTED_HEADER_NAMES = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "user-agent",
])

type PlayboxImportedAuthSession = {
  version: 1
  cookieHeader: string
  headers: ApiHeaders
  sourceUrl: string | null
  email: string | null
  lastValidatedAt: string | null
  lastRefreshAt: string | null
  lastError: string | null
}

type PlayboxImportStatus = {
  hasSession: boolean
  path: string
  cookieCount: number
  email: string | null
  sourceUrl: string | null
  userAgent: string | null
  lastValidatedAt: string | null
  lastRefreshAt: string | null
  lastError: string | null
}

type PlayboxSessionRefreshResult = {
  token: string
  email: string | null
  setCookies: string[]
}

let importedSession: PlayboxImportedAuthSession | null = loadImportedSessionFromDisk()

export function resetPlayboxImportedAuthRuntimeState(): void {
  importedSession = loadImportedSessionFromDisk()
}

export function getPlayboxImportedAuthStatus(): PlayboxImportStatus {
  return {
    hasSession: Boolean(importedSession),
    path: PLAYBOX_AUTH_IMPORT_PATH,
    cookieCount: countCookies(importedSession?.cookieHeader || ""),
    email: importedSession?.email || null,
    sourceUrl: importedSession?.sourceUrl || null,
    userAgent: importedSession?.headers["user-agent"] || null,
    lastValidatedAt: importedSession?.lastValidatedAt || null,
    lastRefreshAt: importedSession?.lastRefreshAt || null,
    lastError: importedSession?.lastError || null,
  }
}

export function getPlayboxImportedRequestHeaders(): ApiHeaders {
  if (!importedSession) {
    return {}
  }

  return {
    ...importedSession.headers,
    cookie: importedSession.cookieHeader,
  }
}

export async function importPlayboxCurl(curlCommand: string): Promise<PlayboxImportStatus> {
  const parsed = parsePlayboxCurlCommand(curlCommand)
  const draft: PlayboxImportedAuthSession = {
    version: 1,
    cookieHeader: parsed.cookieHeader,
    headers: parsed.headers,
    sourceUrl: parsed.sourceUrl,
    email: null,
    lastValidatedAt: null,
    lastRefreshAt: null,
    lastError: null,
  }

  try {
    const result = await refreshPlayboxSession(draft)
    const now = new Date().toISOString()
    draft.cookieHeader = mergeCookieHeader(draft.cookieHeader, result.setCookies)
    draft.email = normalizePlayboxEmail(result.email)
    draft.lastValidatedAt = now
    draft.lastRefreshAt = now
    draft.lastError = null
    await saveImportedSession(draft)
    acceptPlayboxAuthorization(result.token, "curl-import", { email: draft.email })
    return getPlayboxImportedAuthStatus()
  } catch (error) {
    throw httpError(`Playbox cURL import did not validate from the server: ${error instanceof Error ? error.message : String(error)}`, 400)
  }
}

export async function refreshPlayboxImportedAuthorization(): Promise<boolean> {
  if (!importedSession) {
    return false
  }

  try {
    const result = await refreshPlayboxSession(importedSession)
    const now = new Date().toISOString()
    importedSession = {
      ...importedSession,
      cookieHeader: mergeCookieHeader(importedSession.cookieHeader, result.setCookies),
      email: normalizePlayboxEmail(result.email) || importedSession.email,
      lastRefreshAt: now,
      lastError: null,
    }
    await saveImportedSession(importedSession)
    acceptPlayboxAuthorization(result.token, "curl-import-refresh", { email: importedSession.email })
    return true
  } catch (error) {
    importedSession = {
      ...importedSession,
      lastError: error instanceof Error ? error.message : String(error),
    }
    await saveImportedSession(importedSession)
    return false
  }
}

export async function clearPlayboxImportedAuthSession(): Promise<PlayboxImportStatus> {
  importedSession = null
  await rm(PLAYBOX_AUTH_IMPORT_PATH, { force: true })
  return getPlayboxImportedAuthStatus()
}

async function refreshPlayboxSession(session: PlayboxImportedAuthSession): Promise<PlayboxSessionRefreshResult> {
  const refreshResult = await fetchPlayboxToken(`${PLAYBOX_AUTH_BASE_URL.replace(/\/+$/, "")}/refresh-token`, session)
  if (refreshResult) {
    return refreshResult
  }

  const usersMeResult = await fetchPlayboxToken(`${PLAYBOX_API_BASE_URL.replace(/\/+$/, "")}/users/me-new`, session)
  if (usersMeResult) {
    return usersMeResult
  }

  throw new Error("Playbox refresh endpoints did not return an access token.")
}

async function fetchPlayboxToken(url: string, session: PlayboxImportedAuthSession): Promise<PlayboxSessionRefreshResult | null> {
  const response = await fetch(url, {
    headers: {
      ...session.headers,
      accept: session.headers["accept"] || "application/json",
      cookie: session.cookieHeader,
    },
  })

  const setCookies = getSetCookies(response.headers)
  if (!response.ok) {
    return null
  }

  const body: unknown = await response.json().catch(() => null)
  const token = extractPlayboxAccessToken(body)
  if (!token) {
    return null
  }

  return {
    token,
    email: extractPlayboxEmail(body),
    setCookies,
  }
}

function parsePlayboxCurlCommand(curlCommand: string): { sourceUrl: string | null; cookieHeader: string; headers: ApiHeaders } {
  const tokens = tokenizeCurlCommand(curlCommand)
  if (!tokens.length || tokens[0] !== "curl") {
    throw httpError("Paste a full cURL command copied from Chrome DevTools.", 400)
  }

  let sourceUrl: string | null = null
  let cookieHeader = ""
  const headers: ApiHeaders = {}

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue

    if (token === "-H" || token === "--header") {
      const header = tokens[index + 1]
      index += 1
      if (header) {
        const separator = header.indexOf(":")
        if (separator > 0) {
          const name = header.slice(0, separator).trim().toLowerCase()
          const value = header.slice(separator + 1).trim()
          if (name === "cookie") {
            cookieHeader = value
          } else if (IMPORTED_HEADER_NAMES.has(name)) {
            headers[name] = value
          }
        }
      }
      continue
    }

    if (token === "-b" || token === "--cookie" || token === "--cookie-jar") {
      const cookie = tokens[index + 1]
      index += 1
      if (cookie && cookie.includes("=")) {
        cookieHeader = cookie
      }
      continue
    }

    if (token.startsWith("http://") || token.startsWith("https://")) {
      sourceUrl = token
    }
  }

  if (sourceUrl) {
    validatePlayboxUrl(sourceUrl)
  }

  if (!cookieHeader) {
    throw httpError("The cURL command does not include a Cookie header. Copy a Playbox API request with sensitive headers included.", 400)
  }

  return {
    sourceUrl,
    cookieHeader,
    headers: withDefaultPlayboxHeaders(headers),
  }
}

function tokenizeCurlCommand(command: string): string[] {
  const tokens: string[] = []
  let token = ""
  let quote: "'" | '"' | null = null
  let dollarSingleQuote = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] || ""
    const next = command[index + 1]

    if (!quote && char === "$" && next === "'") {
      quote = "'"
      dollarSingleQuote = true
      index += 1
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
        dollarSingleQuote = false
        continue
      }

      if (char === "\\" && quote === '"' && next) {
        token += next
        index += 1
        continue
      }

      if (char === "\\" && dollarSingleQuote && next) {
        token += decodeDollarQuotedEscape(next)
        index += 1
        continue
      }

      token += char
      continue
    }

    if (/\s/u.test(char)) {
      if (token) {
        tokens.push(token)
        token = ""
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (char === "\\" && next) {
      token += next
      index += 1
      continue
    }

    token += char
  }

  if (token) {
    tokens.push(token)
  }

  return tokens
}

function withDefaultPlayboxHeaders(headers: ApiHeaders): ApiHeaders {
  return {
    accept: "application/json",
    origin: "https://www.playbox.com",
    referer: "https://www.playbox.com/",
    ...headers,
  }
}

function validatePlayboxUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw httpError("The cURL command URL is not valid.", 400)
  }

  if (!PLAYBOX_HOST_RE.test(url.hostname)) {
    throw httpError("Paste a cURL command for a playbox.com request.", 400)
  }
}

async function saveImportedSession(session: PlayboxImportedAuthSession): Promise<void> {
  importedSession = session
  await mkdir(path.dirname(PLAYBOX_AUTH_IMPORT_PATH), { recursive: true })
  await writeFile(PLAYBOX_AUTH_IMPORT_PATH, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
}

function loadImportedSessionFromDisk(): PlayboxImportedAuthSession | null {
  if (!existsSync(PLAYBOX_AUTH_IMPORT_PATH)) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(PLAYBOX_AUTH_IMPORT_PATH, "utf8"))
    if (!parsed || typeof parsed !== "object") {
      return null
    }

    const session = parsed as Partial<PlayboxImportedAuthSession>
    if (session.version !== 1 || typeof session.cookieHeader !== "string" || !session.cookieHeader) {
      return null
    }

    return {
      version: 1,
      cookieHeader: session.cookieHeader,
      headers: sanitizeStoredHeaders(session.headers),
      sourceUrl: typeof session.sourceUrl === "string" ? session.sourceUrl : null,
      email: normalizePlayboxEmail(session.email),
      lastValidatedAt: typeof session.lastValidatedAt === "string" ? session.lastValidatedAt : null,
      lastRefreshAt: typeof session.lastRefreshAt === "string" ? session.lastRefreshAt : null,
      lastError: typeof session.lastError === "string" ? session.lastError : null,
    }
  } catch {
    return null
  }
}

function sanitizeStoredHeaders(value: unknown): ApiHeaders {
  if (!value || typeof value !== "object") {
    return withDefaultPlayboxHeaders({})
  }

  const headers: ApiHeaders = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const name = key.toLowerCase()
    if (IMPORTED_HEADER_NAMES.has(name) && typeof rawValue === "string") {
      headers[name] = rawValue
    }
  }
  return withDefaultPlayboxHeaders(headers)
}

function mergeCookieHeader(cookieHeader: string, setCookies: string[]): string {
  if (!setCookies.length) {
    return cookieHeader
  }

  const cookies = new Map<string, string>()
  for (const cookie of cookieHeader.split(";")) {
    const trimmed = cookie.trim()
    const separator = trimmed.indexOf("=")
    if (separator > 0) {
      cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1))
    }
  }

  for (const setCookie of setCookies) {
    const [pair = "", ...attributes] = setCookie.split(";")
    const separator = pair.indexOf("=")
    if (separator <= 0) continue

    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const lowerAttributes = attributes.map((attribute) => attribute.trim().toLowerCase())
    const isExpired =
      lowerAttributes.includes("max-age=0") ||
      lowerAttributes.some((attribute) => attribute.startsWith("expires=") && Date.parse(attribute.slice(8)) <= Date.now())

    if (isExpired) {
      cookies.delete(name)
    } else {
      cookies.set(name, value)
    }
  }

  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ")
}

function getSetCookies(headers: Headers): string[] {
  const withSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = withSetCookie.getSetCookie?.()
  if (setCookies?.length) {
    return setCookies
  }

  const combined = headers.get("set-cookie")
  return combined ? [combined] : []
}

function extractPlayboxAccessToken(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const response = value as { accessToken?: unknown; data?: { accessToken?: unknown } }
  const token = response.data?.accessToken || response.accessToken
  return typeof token === "string" && token ? token : null
}

function extractPlayboxEmail(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const response = value as { data?: { user?: { userId?: unknown; email?: unknown } } }
  const email = response.data?.user?.userId || response.data?.user?.email || null
  return normalizePlayboxEmail(email)
}

function normalizePlayboxEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const email = value.trim().toLowerCase()
  return email.includes("@") ? email : null
}

function countCookies(cookieHeader: string): number {
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean).length
}

function decodeDollarQuotedEscape(value: string): string {
  if (value === "n") return "\n"
  if (value === "r") return "\r"
  if (value === "t") return "\t"
  return value
}
