import { PLAYBOX_API_BASE_URL, PLAYBOX_AUTH_BASE_URL, PLAYBOX_APP_URL } from "./config.ts"
import { AUTH_SETUP_MESSAGE } from "./config.ts"
import { getPlayboxImportedRequestHeaders, refreshPlayboxImportedAuthorization } from "./playbox-auth-import.ts"
import { getActivePlayboxAuthorization, playboxAuthBrowser } from "./playbox-auth-state.ts"
import { parseApiHeaders } from "./schemas.ts"
import type { ApiHeaders, PlayboxCollection, PlayboxCollectionsResponse } from "./types.ts"

const API_AUTH_FAILURE_STATUSES = new Set([401, 403])

export async function fetchPlayboxCollectionsPage(page: number): Promise<PlayboxCollectionsResponse> {
  const url = new URL(`${getPlayboxApiBaseUrl()}/model/collections`)
  url.searchParams.set("page", String(page))
  url.searchParams.set("filter", "ALL")

  const response = await fetchPlayboxApi(url)

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Playbox API returned ${response.status}. ${AUTH_SETUP_MESSAGE}`)
  }

  if (!response.ok) {
    throw new Error((await readApiError(response)) || `Playbox collections request failed: ${response.status} ${response.statusText}`)
  }

  const body: unknown = await response.json()
  return parseCollectionsResponse(body)
}

export async function fetchPlayboxApi(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, buildPlayboxRequestInit(init))

  if (!API_AUTH_FAILURE_STATUSES.has(response.status)) {
    return response
  }

  const refreshed = await refreshPlayboxAuthorization()
  if (!refreshed) {
    return response
  }

  return fetch(input, buildPlayboxRequestInit(init))
}

export async function fetchPlayboxAuthApi(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" && input.startsWith("/") ? `${PLAYBOX_AUTH_BASE_URL.replace(/\/+$/, "")}${input}` : input
  return fetch(url, buildPlayboxRequestInit(init))
}

export function buildPlayboxHeaders(): ApiHeaders {
  const headers: ApiHeaders = {
    accept: "application/json",
    origin: "https://www.playbox.com",
    referer: "https://www.playbox.com/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  }
  Object.assign(headers, getPlayboxImportedRequestHeaders())

  const authorization = getActivePlayboxAuthorization()
  if (authorization) {
    headers["authorization"] = authorization
  }

  if (process.env["PLAYBOX_COOKIE"]) {
    headers["cookie"] = process.env["PLAYBOX_COOKIE"]
  }

  if (process.env["PLAYBOX_EXTRA_HEADERS_JSON"]) {
    const extraHeaders: unknown = JSON.parse(process.env["PLAYBOX_EXTRA_HEADERS_JSON"])
    Object.assign(headers, parseApiHeaders(extraHeaders))
  }

  return headers
}

export function getPlayboxApiBaseUrl(): string {
  return PLAYBOX_API_BASE_URL.replace(/\/+$/, "")
}

function buildPlayboxRequestInit(init: RequestInit): RequestInit {
  const headers = new Headers(buildPlayboxHeaders())

  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  return {
    ...init,
    headers,
  }
}

async function refreshPlayboxAuthorization(): Promise<boolean> {
  if (await refreshPlayboxImportedAuthorization()) {
    return Boolean(getActivePlayboxAuthorization())
  }

  const status = await playboxAuthBrowser.refreshHeadless()
  return status.status === "connected" && Boolean(getActivePlayboxAuthorization())
}

function parseCollectionsResponse(value: unknown): PlayboxCollectionsResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Unexpected Playbox collections response: missing object")
  }

  const response = value as Record<string, unknown>
  const data = Array.isArray(response["data"]) ? response["data"].filter(isPlayboxCollection) : null

  if (!data) {
    throw new Error("Unexpected Playbox collections response: missing data array")
  }

  return {
    message: stringOrNull(response["message"]),
    data,
    maxReached: typeof response["maxReached"] === "boolean" ? response["maxReached"] : null,
    total: numberOrNull(response["total"]),
    perPage: numberOrNull(response["perPage"]),
    page: typeof response["page"] === "string" || typeof response["page"] === "number" ? response["page"] : null,
  }
}

function isPlayboxCollection(value: unknown): value is PlayboxCollection {
  return Boolean(value && typeof value === "object" && typeof (value as { _id?: unknown })._id === "string")
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function readApiError(response: Response): Promise<string | null> {
  const text = await response.text().catch(() => "")
  if (!text) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      return String(parsed.message || "")
    }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return String(parsed.error || "")
    }
  } catch {
    return text
  }

  return text
}

export function getPlayboxAppUrl(): string {
  return PLAYBOX_APP_URL
}
