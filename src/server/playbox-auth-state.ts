import { getJwtExpiration, normalizeAuthorization } from "./auth-state.ts"
import {
  AUTH_BROWSER_REFRESH_MS,
  PLAYBOX_API_BASE_URL,
  PLAYBOX_APP_URL,
  PLAYBOX_AUTH_BROWSER_PROFILE_DIR,
  PLAYBOX_CHROME_PATH,
} from "./config.ts"
import { httpError } from "./errors.ts"
import { createPlayboxChromeAuthBrowserService } from "./playbox-chrome-auth-browser.ts"

type PlayboxAuthState = {
  authorization: string | null
  expiresAt: string | null
  receivedAt: string | null
  source: string | null
  email: string | null
}

export const playboxAuthState: PlayboxAuthState = {
  authorization: normalizeAuthorization(process.env["PLAYBOX_AUTHORIZATION"]),
  expiresAt: getJwtExpiration(process.env["PLAYBOX_AUTHORIZATION"]),
  receivedAt: process.env["PLAYBOX_AUTHORIZATION"] ? new Date().toISOString() : null,
  source: process.env["PLAYBOX_AUTHORIZATION"] ? "env" : null,
  email: null,
}

export let playboxAuthBrowser = createPlayboxAuthBrowser()

export function resetPlayboxAuthRuntimeState(): void {
  playboxAuthBrowser.clearRefreshTimer()
  playboxAuthState.authorization = normalizeAuthorization(process.env["PLAYBOX_AUTHORIZATION"])
  playboxAuthState.expiresAt = getJwtExpiration(process.env["PLAYBOX_AUTHORIZATION"])
  playboxAuthState.receivedAt = process.env["PLAYBOX_AUTHORIZATION"] ? new Date().toISOString() : null
  playboxAuthState.source = process.env["PLAYBOX_AUTHORIZATION"] ? "env" : null
  playboxAuthState.email = null
  playboxAuthBrowser = createPlayboxAuthBrowser()
}

export function acceptPlayboxAuthorization(
  value: unknown,
  source = "browser",
  session: { email?: string | null } = {},
): { authorization: string; expiresAt: string; source: string; email: string | null } {
  const authorization = normalizeAuthorization(value)

  if (!authorization) {
    throw httpError("Missing Playbox bearer token.", 400)
  }

  const expiresAt = getJwtExpiration(authorization)
  if (!expiresAt) {
    throw httpError("Playbox token is not a JWT with an exp claim.", 400)
  }

  if (Date.parse(expiresAt) <= Date.now() + 5000) {
    throw httpError("Playbox token is expired or about to expire.", 400)
  }

  playboxAuthState.authorization = authorization
  playboxAuthState.expiresAt = expiresAt
  playboxAuthState.receivedAt = new Date().toISOString()
  playboxAuthState.source = source
  playboxAuthState.email = normalizePlayboxEmail(session.email)

  return {
    authorization,
    expiresAt,
    source,
    email: playboxAuthState.email,
  }
}

export function getActivePlayboxAuthorization(): string | null {
  const authorization = playboxAuthState.authorization || normalizeAuthorization(process.env["PLAYBOX_AUTHORIZATION"])
  const expiresAt = authorization === playboxAuthState.authorization ? playboxAuthState.expiresAt : getJwtExpiration(authorization)

  if (!authorization) {
    return null
  }

  if (!expiresAt || Date.parse(expiresAt) > Date.now() + 5000) {
    return authorization
  }

  return null
}

export function getPlayboxAuthStatus(): Record<string, unknown> {
  return {
    hasAuthorization: Boolean(getActivePlayboxAuthorization()),
    authorizationExpiresAt: playboxAuthState.expiresAt,
    authorizationSource: playboxAuthState.source,
    email: playboxAuthState.email,
    authBrowser: playboxAuthBrowser.getStatus(),
  }
}

function createPlayboxAuthBrowser(): ReturnType<typeof createPlayboxChromeAuthBrowserService> {
  return createPlayboxChromeAuthBrowserService({
    profileDir: PLAYBOX_AUTH_BROWSER_PROFILE_DIR,
    loginUrl: PLAYBOX_APP_URL,
    usersMeUrl: getUsersMeUrl(),
    chromePath: PLAYBOX_CHROME_PATH,
    refreshIntervalMs: AUTH_BROWSER_REFRESH_MS,
    onToken: (token, source, session) => acceptPlayboxAuthorization(token, source, session),
  })
}

function getUsersMeUrl(): string {
  return `${PLAYBOX_API_BASE_URL.replace(/\/+$/, "")}/users/me-new`
}

function normalizePlayboxEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const email = value.trim().toLowerCase()
  return email.includes("@") ? email : null
}

resetPlayboxAuthRuntimeState()
