import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { createAuthBrowserService } from "../auth-browser.ts"
import { APP_LOGIN_URL, AUTH_BROWSER_PROFILE_DIR, AUTH_BROWSER_REFRESH_MS } from "./config.ts"
import { httpError } from "./errors.ts"
import { parseJwtExpiration } from "./schemas.ts"

type AuthState = {
  authorization: string | null
  expiresAt: string | null
  receivedAt: string | null
  source: string | null
}

type AuthBrowserServiceInstance = ReturnType<typeof createAuthBrowserService>
type AuthBrowserStatus = ReturnType<AuthBrowserServiceInstance["getStatus"]>

export type AuthAccountStatus = {
  email: string
  hasAuthorization: boolean
  authorizationExpiresAt: string | null
  authorizationSource: string | null
  authBrowser: AuthBrowserStatus
}

const ACCOUNT_REGISTRY_FILE = "accounts.json"
const ACCOUNT_PROFILES_DIR = "accounts"

export const authState = {
  authorization: normalizeAuthorization(process.env["GENERATEPORN_AUTHORIZATION"]),
  expiresAt: getJwtExpiration(process.env["GENERATEPORN_AUTHORIZATION"]),
  receivedAt: process.env["GENERATEPORN_AUTHORIZATION"] ? new Date().toISOString() : null,
  source: process.env["GENERATEPORN_AUTHORIZATION"] ? "env" : null,
} satisfies AuthState

const accountStates = new Map<string, AuthState>()
const accountBrowsers = new Map<string, AuthBrowserServiceInstance>()
let accountEmails: string[] = []

export let authBrowser = createAuthBrowserService({
  profileDir: AUTH_BROWSER_PROFILE_DIR,
  loginUrl: APP_LOGIN_URL,
  refreshIntervalMs: AUTH_BROWSER_REFRESH_MS,
  onToken: acceptAuthorization,
})

export function resetAuthRuntimeState() {
  for (const browser of accountBrowsers.values()) {
    browser.clearRefreshTimer()
  }
  accountBrowsers.clear()
  accountStates.clear()
  accountEmails = loadPersistedAccountEmails()

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

  for (const email of accountEmails) {
    ensureAuthAccount(email)
  }
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

export function acceptAuthorization(
  value: unknown,
  source = "browser",
  accountEmail?: unknown,
): { authorization: string; expiresAt: string; source: string; email: string | null } {
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

  const email = normalizeAccountEmail(accountEmail)
  const state = email ? ensureAuthAccount(email).state : authState
  state.authorization = authorization
  state.expiresAt = expiresAt
  state.receivedAt = new Date().toISOString()
  state.source = source

  return {
    authorization,
    expiresAt,
    source,
    email,
  }
}

export function getActiveAuthorization(accountEmail?: unknown): string | null {
  const now = Date.now()
  const email = normalizeAccountEmail(accountEmail)

  if (email) {
    const state = accountStates.get(email)
    if (state?.authorization && (!state.expiresAt || Date.parse(state.expiresAt) > now + 5000)) {
      return state.authorization
    }

    return null
  }

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

export function hasApiAuth(accountEmail?: unknown): boolean {
  const email = normalizeAccountEmail(accountEmail)
  return Boolean(getActiveAuthorization(email) || (!email && process.env["GENERATEPORN_COOKIE"]))
}

export function getAuthExpiresAt(accountEmail?: unknown): string | null {
  const email = normalizeAccountEmail(accountEmail)
  const active = getActiveAuthorization(email)
  if (!active) {
    return null
  }

  if (email) {
    return accountStates.get(email)?.expiresAt || getJwtExpiration(active)
  }

  return active === authState.authorization ? authState.expiresAt : getJwtExpiration(active)
}

export function getAuthAccountStatuses(): AuthAccountStatus[] {
  return accountEmails.map((email) => {
    const state = ensureAuthAccount(email).state
    return {
      email,
      hasAuthorization: Boolean(getActiveAuthorization(email)),
      authorizationExpiresAt: getAuthExpiresAt(email),
      authorizationSource: state.source,
      authBrowser: getAuthBrowserForAccount(email).getStatus(),
    }
  })
}

export function getDefaultAccountEmail(): string | null {
  return accountEmails.find((email) => Boolean(getActiveAuthorization(email))) || accountEmails[0] || null
}

export function getSyncAccountEmails(): Array<string | null> {
  const accounts = getAuthAccountStatuses()
    .filter((account) => account.hasAuthorization || account.authBrowser.hasProfile)
    .map((account) => account.email)

  if (accounts.length > 0) {
    return accounts
  }

  return hasApiAuth() ? [null] : []
}

export function getAuthBrowserForAccount(accountEmail?: unknown): AuthBrowserServiceInstance {
  const email = normalizeAccountEmail(accountEmail)
  if (!email) {
    return authBrowser
  }

  return ensureAuthAccount(email).browser
}

export function connectAuthAccount(accountEmail: unknown): Promise<AuthBrowserStatus> {
  return getAuthBrowserForAccount(requireAccountEmail(accountEmail)).connectVisible()
}

export function refreshAuthAccount(accountEmail: unknown): Promise<AuthBrowserStatus> {
  return getAuthBrowserForAccount(requireAccountEmail(accountEmail)).refreshHeadless()
}

export async function removeAuthAccount(
  accountEmail: unknown,
  { deleteProfile = false }: { deleteProfile?: boolean } = {},
): Promise<{ ok: true; email: string; accounts: AuthAccountStatus[] }> {
  const email = requireAccountEmail(accountEmail)
  const browser = accountBrowsers.get(email)
  if (browser) {
    await browser.disconnect({ deleteProfile })
  }
  accountBrowsers.delete(email)
  accountStates.delete(email)
  accountEmails = accountEmails.filter((entry) => entry !== email)
  persistAccountEmails()

  return {
    ok: true,
    email,
    accounts: getAuthAccountStatuses(),
  }
}

export function startAuthAccountAutoRefresh(): void {
  authBrowser.startAutoRefresh()
  for (const email of accountEmails) {
    getAuthBrowserForAccount(email).startAutoRefresh()
  }
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
    return parseJwtExpiration(payload)
  } catch {
    return null
  }
}

function ensureAuthAccount(email: string): { state: AuthState; browser: AuthBrowserServiceInstance } {
  if (!accountEmails.includes(email)) {
    accountEmails.push(email)
    accountEmails.sort()
    persistAccountEmails()
  }

  let state = accountStates.get(email)
  if (!state) {
    state = {
      authorization: null,
      expiresAt: null,
      receivedAt: null,
      source: null,
    }
    accountStates.set(email, state)
  }

  let browser = accountBrowsers.get(email)
  if (!browser) {
    browser = createAuthBrowserService({
      profileDir: accountProfileDir(email),
      loginUrl: APP_LOGIN_URL,
      refreshIntervalMs: AUTH_BROWSER_REFRESH_MS,
      onToken: (token, source, session) => {
        const capturedEmail = normalizeAccountEmail(session.email)
        if (capturedEmail && capturedEmail !== email) {
          throw httpError(`Logged in as ${capturedEmail}; expected ${email}.`, 400)
        }

        return acceptAuthorization(token, source, email)
      },
    })
    accountBrowsers.set(email, browser)
  }

  return { state, browser }
}

function requireAccountEmail(value: unknown): string {
  const email = normalizeAccountEmail(value)
  if (!email) {
    throw httpError("Account email is required.", 400)
  }

  return email
}

export function normalizeAccountEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const email = value.trim().toLowerCase()
  if (!email) {
    return null
  }

  if (!email.includes("@")) {
    throw httpError("Account email must be an email address.", 400)
  }

  return email
}

function accountProfileDir(email: string): string {
  return path.join(AUTH_BROWSER_PROFILE_DIR, ACCOUNT_PROFILES_DIR, encodeURIComponent(email))
}

function accountRegistryPath(): string {
  return path.join(AUTH_BROWSER_PROFILE_DIR, ACCOUNT_REGISTRY_FILE)
}

function loadPersistedAccountEmails(): string[] {
  try {
    if (!existsSync(accountRegistryPath())) {
      return []
    }

    const parsed: unknown = JSON.parse(readFileSync(accountRegistryPath(), "utf8"))
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => normalizeAccountEmail(entry))
      .filter((entry): entry is string => Boolean(entry))
      .toSorted()
  } catch {
    return []
  }
}

function persistAccountEmails(): void {
  mkdirSync(AUTH_BROWSER_PROFILE_DIR, { recursive: true })
  writeFileSync(accountRegistryPath(), JSON.stringify(accountEmails, null, 2))
}

resetAuthRuntimeState()
