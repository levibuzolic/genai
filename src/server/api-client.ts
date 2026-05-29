import { getActiveAuthorization } from "./auth-state.ts"
import { API_BASE_URL, AUTH_SETUP_MESSAGE } from "./config.ts"
import { isGeneratePornJob, isRecord } from "./refinements.ts"
import type { ApiHeaders, GeneratePornJob } from "./types.ts"

export async function fetchJobsPage(page: number): Promise<GeneratePornJob[]> {
  const url = new URL(API_BASE_URL)
  url.searchParams.set("type", "all")
  url.searchParams.set("page", String(page))

  const response = await fetch(url, {
    headers: buildApiHeaders(),
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error(`API returned ${response.status}. ${AUTH_SETUP_MESSAGE}`)
  }

  if (!response.ok) {
    throw new Error(`API request failed on page ${page}: ${response.status} ${response.statusText}`)
  }

  const body: unknown = await response.json()

  if (!isRecord(body) || !Array.isArray(body["results"])) {
    throw new Error(`Unexpected API response on page ${page}: missing results array`)
  }

  return body["results"].filter(isGeneratePornJob)
}

export function buildApiHeaders(): ApiHeaders {
  const headers: ApiHeaders = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://app.generateporn.ai",
    referer: "https://app.generateporn.ai/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  }

  if (process.env["GENERATEPORN_COOKIE"]) {
    headers["cookie"] = process.env["GENERATEPORN_COOKIE"]
  }

  const authorization = getActiveAuthorization()
  if (authorization) {
    headers["authorization"] = authorization
  }

  if (process.env["GENERATEPORN_EXTRA_HEADERS_JSON"]) {
    Object.assign(headers, JSON.parse(process.env["GENERATEPORN_EXTRA_HEADERS_JSON"]))
  }

  return headers
}

export function getJobsApiBaseUrl(): string {
  return String(API_BASE_URL).replace(/\/+$/, "")
}
