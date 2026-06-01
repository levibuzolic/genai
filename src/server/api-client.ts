import { getActiveAuthorization, getAuthBrowserForAccount, normalizeAccountEmail } from "./auth-state.ts"
import { API_BASE_URL, AUTH_SETUP_MESSAGE } from "./config.ts"
import { parseApiHeaders, parseJobsPageResponse } from "./schemas.ts"
import type { ApiHeaders, GeneratePornJob } from "./types.ts"

export type DeleteRemoteJobResult = {
  status: "deleted" | "already-deleted"
}

export type FavoriteRemoteJobResult = {
  favorited: boolean
}

const API_AUTH_FAILURE_STATUSES = new Set([401, 403])

export type ApiAccountOptions = {
  accountEmail?: string | null | undefined
}

export async function fetchJobsPage(page: number, options: ApiAccountOptions = {}): Promise<GeneratePornJob[]> {
  const url = new URL(API_BASE_URL)
  url.searchParams.set("type", "all")
  url.searchParams.set("page", String(page))

  const response = await fetchGeneratePornApi(url, {}, options)

  if (response.status === 401 || response.status === 403) {
    throw new Error(`API returned ${response.status}. ${AUTH_SETUP_MESSAGE}`)
  }

  if (!response.ok) {
    throw new Error(`API request failed on page ${page}: ${response.status} ${response.statusText}`)
  }

  const body: unknown = await response.json()
  const jobs = parseJobsPageResponse(body)

  if (!jobs) {
    throw new Error(`Unexpected API response on page ${page}: missing results array`)
  }

  const accountEmail = normalizeNullableAccountEmail(options.accountEmail)
  return accountEmail ? jobs.map((job) => ({ ...job, accountEmail })) : jobs
}

export async function deleteRemoteJob(jobId: string, options: ApiAccountOptions = {}): Promise<DeleteRemoteJobResult> {
  const response = await fetchGeneratePornApi(`${getJobsApiBaseUrl()}/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  }, options)

  if (response.status === 401 || response.status === 403) {
    throw new Error(`API returned ${response.status}. ${AUTH_SETUP_MESSAGE}`)
  }

  if (response.status === 404) {
    return { status: "already-deleted" }
  }

  if (!response.ok) {
    throw new Error((await readApiError(response)) || `Delete request failed: ${response.status} ${response.statusText}`)
  }

  return { status: "deleted" }
}

export async function setRemoteJobFavorite(
  jobId: string,
  favorited: boolean,
  options: ApiAccountOptions = {},
): Promise<FavoriteRemoteJobResult> {
  const response = await fetchGeneratePornApi(`${getJobsApiBaseUrl()}/${encodeURIComponent(jobId)}/favorite`, {
    method: favorited ? "POST" : "DELETE",
  }, options)

  if (response.status === 401 || response.status === 403) {
    throw new Error(`API returned ${response.status}. ${AUTH_SETUP_MESSAGE}`)
  }

  if (!response.ok) {
    throw new Error((await readApiError(response)) || `Favorite request failed: ${response.status} ${response.statusText}`)
  }

  return { favorited }
}

export async function fetchGeneratePornApi(input: string | URL, init: RequestInit = {}, options: ApiAccountOptions = {}): Promise<Response> {
  const response = await fetch(input, buildApiRequestInit(init, options))

  if (!isApiAuthFailure(response.status)) {
    return response
  }

  const refreshed = await refreshApiAuthorization(options)
  if (!refreshed) {
    return response
  }

  return fetch(input, buildApiRequestInit(init, options))
}

export function buildApiHeaders(options: ApiAccountOptions = {}): ApiHeaders {
  const headers: ApiHeaders = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://app.generateporn.ai",
    referer: "https://app.generateporn.ai/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  }

  const accountEmail = normalizeNullableAccountEmail(options.accountEmail)

  if (!accountEmail && process.env["GENERATEPORN_COOKIE"]) {
    headers["cookie"] = process.env["GENERATEPORN_COOKIE"]
  }

  const authorization = getActiveAuthorization(accountEmail)
  if (authorization) {
    headers["authorization"] = authorization
  }

  if (process.env["GENERATEPORN_EXTRA_HEADERS_JSON"]) {
    const extraHeaders: unknown = JSON.parse(process.env["GENERATEPORN_EXTRA_HEADERS_JSON"])
    Object.assign(headers, parseApiHeaders(extraHeaders))
  }

  return headers
}

export function getJobsApiBaseUrl(): string {
  return String(API_BASE_URL).replace(/\/+$/, "")
}

function buildApiRequestInit(init: RequestInit, options: ApiAccountOptions): RequestInit {
  const headers = new Headers(buildApiHeaders(options))

  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  return {
    ...init,
    headers,
  }
}

function isApiAuthFailure(status: number): boolean {
  return API_AUTH_FAILURE_STATUSES.has(status)
}

async function refreshApiAuthorization(options: ApiAccountOptions): Promise<boolean> {
  const accountEmail = normalizeNullableAccountEmail(options.accountEmail)
  const status = await getAuthBrowserForAccount(accountEmail).refreshHeadless()
  return status.status === "connected" && Boolean(getActiveAuthorization(accountEmail))
}

function normalizeNullableAccountEmail(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : normalizeAccountEmail(value)
}

async function readApiError(response: Response): Promise<string | null> {
  const text = await response.text().catch(() => "")
  if (!text) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return String(parsed.error || "")
    }
  } catch {
    return text
  }

  return text
}
