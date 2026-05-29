import { createAuthBrowserService } from "../auth-browser.ts"
import { APP_LOGIN_URL, AUTH_BROWSER_PROFILE_DIR, AUTH_BROWSER_REFRESH_MS } from "./config.ts"
import { httpError } from "./errors.ts"
import { isRecord } from "./refinements.ts"

export const authState = {
  authorization: normalizeAuthorization(process.env["GENERATEPORN_AUTHORIZATION"]),
  expiresAt: getJwtExpiration(process.env["GENERATEPORN_AUTHORIZATION"]),
  receivedAt: process.env["GENERATEPORN_AUTHORIZATION"] ? new Date().toISOString() : null,
  source: process.env["GENERATEPORN_AUTHORIZATION"] ? "env" : null,
}

export let authBrowser = createAuthBrowserService({
  profileDir: AUTH_BROWSER_PROFILE_DIR,
  loginUrl: APP_LOGIN_URL,
  refreshIntervalMs: AUTH_BROWSER_REFRESH_MS,
  onToken: acceptAuthorization,
})

export function resetAuthRuntimeState() {
  authState.authorization = normalizeAuthorization(process.env["GENERATEPORN_AUTHORIZATION"])
  authState.expiresAt = getJwtExpiration(process.env["GENERATEPORN_AUTHORIZATION"])
  authState.receivedAt = process.env["GENERATEPORN_AUTHORIZATION"] ? new Date().toISOString() : null
  authState.source = process.env["GENERATEPORN_AUTHORIZATION"] ? "env" : null
  authBrowser = createAuthBrowserService({
    profileDir: AUTH_BROWSER_PROFILE_DIR,
    loginUrl: APP_LOGIN_URL,
    refreshIntervalMs: AUTH_BROWSER_REFRESH_MS,
    onToken: acceptAuthorization,
  })
}

export function normalizeAuthorization(value: unknown): string | null {
  if (!value || typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
}

export function acceptAuthorization(value: unknown, source = "browser"): { authorization: string; expiresAt: string; source: string } {
  const authorization = normalizeAuthorization(value)

  if (!authorization) {
    throw httpError("Missing bearer token.", 400)
  }

  const expiresAt = getJwtExpiration(authorization)
  if (!expiresAt) {
    throw httpError("Token is not a JWT with an exp claim.", 400)
  }

  if (Date.parse(expiresAt) <= Date.now() + 5000) {
    throw httpError("Token is expired or about to expire.", 400)
  }

  authState.authorization = authorization
  authState.expiresAt = expiresAt
  authState.receivedAt = new Date().toISOString()
  authState.source = source

  return {
    authorization,
    expiresAt,
    source,
  }
}

export function getActiveAuthorization(): string | null {
  const now = Date.now()

  if (authState.authorization && (!authState.expiresAt || Date.parse(authState.expiresAt) > now + 5000)) {
    return authState.authorization
  }

  const envAuthorization = normalizeAuthorization(process.env["GENERATEPORN_AUTHORIZATION"])
  const envExpiresAt = getJwtExpiration(envAuthorization)
  if (envAuthorization && (!envExpiresAt || Date.parse(envExpiresAt) > now + 5000)) {
    return envAuthorization
  }

  return null
}

export function hasApiAuth(): boolean {
  return Boolean(getActiveAuthorization() || process.env["GENERATEPORN_COOKIE"])
}

export function getAuthExpiresAt(): string | null {
  const active = getActiveAuthorization()
  if (!active) {
    return null
  }

  return active === authState.authorization ? authState.expiresAt : getJwtExpiration(active)
}

export function getJwtExpiration(authorization: unknown): string | null {
  const token = normalizeAuthorization(authorization)?.replace(/^bearer\s+/i, "")
  if (!token || token.split(".").length < 2) {
    return null
  }

  try {
    const encodedPayload = token.split(".")[1]
    if (!encodedPayload) {
      return null
    }
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
    const exp = isRecord(payload) ? payload["exp"] : null
    return exp ? new Date(Number(exp) * 1000).toISOString() : null
  } catch {
    return null
  }
}
