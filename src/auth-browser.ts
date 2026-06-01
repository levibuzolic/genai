import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"

import type { BrowserContext, Page } from "@playwright/test"

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_TOKEN_TIMEOUT_MS = 20_000
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const REFRESH_LEEWAY_MS = 60_000
const PROFILE_SETTLE_MS = 2500

type AuthBrowserStatusValue = "disconnected" | "profile-ready" | "awaiting-login" | "login-required" | "refreshing" | "connected"
type AuthBrowserMode = "visible" | "headless" | null

type TokenResult = {
  expiresAt: string
  source: string
}

type CapturedAuthSession = {
  token: string
  email: string | null
}

type LaunchOptions = {
  headless: boolean
}

type LaunchPersistentContext = (profileDir: string, options: LaunchOptions) => Promise<BrowserContext>
type AuthSessionReader = (page: Page, timeoutMs: number) => Promise<CapturedAuthSession>

type AuthBrowserLogger = {
  warn?: (error: unknown) => void
}

type AuthBrowserOptions = {
  profileDir: string
  loginUrl: string
  onToken: (token: string, source: string, session: { email?: string | null }) => TokenResult | Promise<TokenResult>
  launchPersistentContext?: LaunchPersistentContext
  sessionReader?: AuthSessionReader
  loginTimeoutMs?: number
  tokenTimeoutMs?: number
  refreshIntervalMs?: number
  logger?: AuthBrowserLogger
}

type AuthBrowserState = {
  status: AuthBrowserStatusValue
  message: string
  email: string | null
  expiresAt: string | null
  lastRefreshAt: string | null
  nextRefreshAt: string | null
  lastError: string | null
  mode: AuthBrowserMode
}

type AuthBrowserStatus = AuthBrowserState & {
  profileDir: string
  loginUrl: string
  hasProfile: boolean
  browserOpen: boolean
}

declare global {
  var Clerk:
    | {
        session?: {
          getToken?: () => Promise<string | null> | string | null
        }
        user?: {
          primaryEmailAddress?: {
            emailAddress?: string | null
          } | null
          primaryEmailAddressId?: string | null
          emailAddresses?: Array<{
            id?: string | null
            emailAddress?: string | null
          }>
        } | null
      }
    | undefined
}

export function createAuthBrowserService(options: AuthBrowserOptions): AuthBrowserService {
  return new AuthBrowserService(options)
}

class AuthBrowserService {
  readonly profileDir: string
  readonly loginUrl: string
  readonly onToken: (token: string, source: string, session: { email?: string | null }) => TokenResult | Promise<TokenResult>
  readonly launchPersistentContext: LaunchPersistentContext
  readonly sessionReader: AuthSessionReader
  readonly loginTimeoutMs: number
  readonly tokenTimeoutMs: number
  readonly refreshIntervalMs: number
  readonly logger: AuthBrowserLogger
  context: BrowserContext | null
  refreshTimer: NodeJS.Timeout | null
  loginPoll: Promise<void> | null
  private connectPromise: Promise<AuthBrowserStatus> | null
  private refreshPromise: Promise<AuthBrowserStatus> | null
  private state: AuthBrowserState

  constructor({
    profileDir,
    loginUrl,
    onToken,
    launchPersistentContext = launchPlaywrightPersistentContext,
    sessionReader = readClerkSession,
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    tokenTimeoutMs = DEFAULT_TOKEN_TIMEOUT_MS,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    logger = console,
  }: AuthBrowserOptions) {
    this.profileDir = profileDir
    this.loginUrl = loginUrl
    this.onToken = onToken
    this.launchPersistentContext = launchPersistentContext
    this.sessionReader = sessionReader
    this.loginTimeoutMs = loginTimeoutMs
    this.tokenTimeoutMs = tokenTimeoutMs
    this.refreshIntervalMs = refreshIntervalMs
    this.logger = logger
    this.context = null
    this.refreshTimer = null
    this.loginPoll = null
    this.connectPromise = null
    this.refreshPromise = null
    this.state = {
      status: existsSync(profileDir) ? "profile-ready" : "disconnected",
      message: existsSync(profileDir) ? "Saved auth browser profile is available." : "No saved auth browser profile.",
      email: null,
      expiresAt: null,
      lastRefreshAt: null,
      nextRefreshAt: null,
      lastError: null,
      mode: null,
    }
  }

  getStatus(): AuthBrowserStatus {
    return {
      ...this.state,
      profileDir: this.profileDir,
      loginUrl: this.loginUrl,
      hasProfile: existsSync(this.profileDir),
      browserOpen: Boolean(this.context),
    }
  }

  async connectVisible(): Promise<AuthBrowserStatus> {
    if (this.connectPromise) {
      return this.connectPromise
    }

    if (this.state.status === "awaiting-login" && this.context) {
      return this.getStatus()
    }

    this.connectPromise = this.openVisibleLogin()

    try {
      return await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  async openVisibleLogin(): Promise<AuthBrowserStatus> {
    await this.closeContext()
    await mkdir(this.profileDir, { recursive: true })
    this.context = await this.launchPersistentContext(this.profileDir, { headless: false })
    const page = await getOrCreatePage(this.context)
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" })
    this.setState({
      status: "awaiting-login",
      mode: "visible",
      message: "Complete the login in the opened browser window. The backend will capture a short-lived token once Clerk is signed in.",
      lastError: null,
    })

    this.loginPoll = this.pollVisibleLogin(page)
    this.loginPoll.catch((error: unknown) => {
      this.setState({
        status: "login-required",
        mode: null,
        message: "Login did not complete. Open the auth browser and try again.",
        lastError: error instanceof Error ? error.message : String(error),
      })
      this.closeContext().catch((closeError) => this.logger.warn?.(closeError))
    })

    return this.getStatus()
  }

  async refreshHeadless(): Promise<AuthBrowserStatus> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    if (this.state.status === "awaiting-login") {
      return this.getStatus()
    }

    this.refreshPromise = this.runHeadlessRefresh()

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async runHeadlessRefresh(): Promise<AuthBrowserStatus> {
    await this.closeContext()
    await mkdir(this.profileDir, { recursive: true })
    this.setState({
      status: "refreshing",
      mode: "headless",
      message: "Refreshing auth from the saved browser profile...",
      lastError: null,
    })

    try {
      this.context = await this.launchPersistentContext(this.profileDir, { headless: true })
      const page = await getOrCreatePage(this.context)
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" })
      const session = await this.sessionReader(page, this.tokenTimeoutMs)
      await this.acceptToken(session)
      await this.closeContext()
      return this.getStatus()
    } catch (error) {
      await this.closeContext()
      this.clearRefreshTimer()
      this.setState({
        status: "login-required",
        mode: null,
        message: "Saved browser profile could not refresh auth. Reconnect with visible login.",
        lastError: error instanceof Error ? error.message : String(error),
      })
      return this.getStatus()
    }
  }

  async disconnect({ deleteProfile = false }: { deleteProfile?: boolean } = {}): Promise<AuthBrowserStatus> {
    this.clearRefreshTimer()
    await this.closeContext()

    if (deleteProfile) {
      await rm(this.profileDir, { recursive: true, force: true })
    }

    this.setState({
      status: existsSync(this.profileDir) ? "profile-ready" : "disconnected",
      mode: null,
      message: existsSync(this.profileDir) ? "Saved auth browser profile is available." : "Auth browser profile removed.",
      email: null,
      expiresAt: null,
      lastRefreshAt: null,
      nextRefreshAt: null,
      lastError: null,
    })

    return this.getStatus()
  }

  startAutoRefresh(): AuthBrowserStatus {
    if (!existsSync(this.profileDir)) {
      return this.getStatus()
    }

    void this.refreshHeadless()
    return this.getStatus()
  }

  async pollVisibleLogin(page: Page): Promise<void> {
    const deadline = Date.now() + this.loginTimeoutMs

    while (Date.now() < deadline && this.context) {
      const session = await this.sessionReader(page, 1000).catch(() => null)

      if (session) {
        await this.acceptToken(session)
        await sleep(PROFILE_SETTLE_MS)
        await this.closeContext()
        return
      }

      await sleep(1500)
    }

    throw new Error("Timed out waiting for login to complete.")
  }

  async acceptToken(session: CapturedAuthSession): Promise<void> {
    const result = await this.onToken(session.token, "auth-browser", { email: session.email })
    const nextRefreshAt = calculateNextRefreshAt(result.expiresAt, this.refreshIntervalMs)
    this.setState({
      status: "connected",
      mode: null,
      message: "Auth browser profile is connected.",
      email: session.email,
      expiresAt: result.expiresAt,
      lastRefreshAt: new Date().toISOString(),
      nextRefreshAt,
      lastError: null,
    })
    this.scheduleRefresh(nextRefreshAt)
  }

  scheduleRefresh(nextRefreshAt: string): void {
    this.clearRefreshTimer()
    const delay = Math.max(5000, Date.parse(nextRefreshAt) - Date.now())
    this.refreshTimer = setTimeout(() => {
      void this.refreshHeadless()
    }, delay)
    this.refreshTimer.unref?.()
  }

  clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  async closeContext(): Promise<void> {
    const context = this.context
    this.context = null

    if (context) {
      await context.close().catch((error: unknown) => this.logger.warn?.(error))
    }
  }

  setState(next: Partial<AuthBrowserState>): void {
    this.state = {
      ...this.state,
      ...next,
    }
  }
}

async function launchPlaywrightPersistentContext(profileDir: string, { headless }: LaunchOptions): Promise<BrowserContext> {
  const { chromium } = await import("@playwright/test")
  return chromium.launchPersistentContext(profileDir, {
    channel: process.env["AUTH_BROWSER_CHANNEL"] || "chrome",
    headless,
    viewport: {
      width: 1280,
      height: 900,
    },
  })
}

async function getOrCreatePage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? context.newPage()
}

async function readClerkSession(page: Page, timeoutMs: number): Promise<CapturedAuthSession> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const session = await page
      .evaluate(async () => {
        const clerk = globalThis.Clerk
        if (!clerk?.session?.getToken) return null
        const token = await clerk.session.getToken()
        if (!token) return null
        const primaryEmail = clerk.user?.primaryEmailAddress?.emailAddress || null
        const primaryEmailId = clerk.user?.primaryEmailAddressId || null
        const emailFromList =
          clerk.user?.emailAddresses?.find((entry) => entry.id && entry.id === primaryEmailId)?.emailAddress ||
          clerk.user?.emailAddresses?.[0]?.emailAddress ||
          null
        return {
          token,
          email: primaryEmail || emailFromList,
        }
      })
      .catch(() => null)

    if (typeof session === "string" && session) {
      return {
        token: session,
        email: null,
      }
    }

    if (session && typeof session === "object" && typeof session.token === "string" && session.token) {
      return {
        token: session.token,
        email: typeof session.email === "string" && session.email ? session.email : null,
      }
    }

    await sleep(1000)
  }

  throw new Error("Clerk did not return an auth token.")
}

function calculateNextRefreshAt(expiresAt: string, refreshIntervalMs: number): string {
  const expiresAtMs = Date.parse(expiresAt)
  const now = Date.now()
  const ttlMs = expiresAtMs - now
  const refreshLeewayMs = Math.min(REFRESH_LEEWAY_MS, Math.max(5000, Math.floor(ttlMs * 0.25)))
  const target = Number.isFinite(expiresAtMs) ? Math.min(now + refreshIntervalMs, expiresAtMs - refreshLeewayMs) : now + refreshIntervalMs
  return new Date(Math.max(Date.now() + 5000, target)).toISOString()
}
