import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_TOKEN_TIMEOUT_MS = 20_000
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const REFRESH_LEEWAY_MS = 60_000
const PROFILE_SETTLE_MS = 2500

export function createAuthBrowserService(options) {
  return new AuthBrowserService(options)
}

class AuthBrowserService {
  constructor({
    profileDir,
    loginUrl,
    onToken,
    launchPersistentContext = launchPlaywrightPersistentContext,
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    tokenTimeoutMs = DEFAULT_TOKEN_TIMEOUT_MS,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    logger = console,
  }) {
    this.profileDir = profileDir
    this.loginUrl = loginUrl
    this.onToken = onToken
    this.launchPersistentContext = launchPersistentContext
    this.loginTimeoutMs = loginTimeoutMs
    this.tokenTimeoutMs = tokenTimeoutMs
    this.refreshIntervalMs = refreshIntervalMs
    this.logger = logger
    this.context = null
    this.refreshTimer = null
    this.loginPoll = null
    this.connectPromise = null
    this.state = {
      status: existsSync(profileDir) ? "profile-ready" : "disconnected",
      message: existsSync(profileDir) ? "Saved auth browser profile is available." : "No saved auth browser profile.",
      expiresAt: null,
      lastRefreshAt: null,
      nextRefreshAt: null,
      lastError: null,
      mode: null,
    }
  }

  getStatus() {
    return {
      ...this.state,
      profileDir: this.profileDir,
      loginUrl: this.loginUrl,
      hasProfile: existsSync(this.profileDir),
      browserOpen: Boolean(this.context),
    }
  }

  async connectVisible() {
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

  async openVisibleLogin() {
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
    this.loginPoll.catch((error) => {
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

  async refreshHeadless() {
    if (this.state.status === "awaiting-login") {
      return this.getStatus()
    }

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
      const token = await readClerkToken(page, this.tokenTimeoutMs)
      await this.acceptToken(token)
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

  async disconnect({ deleteProfile = false } = {}) {
    this.clearRefreshTimer()
    await this.closeContext()

    if (deleteProfile) {
      await rm(this.profileDir, { recursive: true, force: true })
    }

    this.setState({
      status: existsSync(this.profileDir) ? "profile-ready" : "disconnected",
      mode: null,
      message: existsSync(this.profileDir) ? "Saved auth browser profile is available." : "Auth browser profile removed.",
      expiresAt: null,
      lastRefreshAt: null,
      nextRefreshAt: null,
      lastError: null,
    })

    return this.getStatus()
  }

  startAutoRefresh() {
    if (!existsSync(this.profileDir)) {
      return this.getStatus()
    }

    void this.refreshHeadless()
    return this.getStatus()
  }

  async pollVisibleLogin(page) {
    const deadline = Date.now() + this.loginTimeoutMs

    while (Date.now() < deadline && this.context) {
      const token = await readClerkToken(page, 1000).catch(() => null)

      if (token) {
        await this.acceptToken(token)
        await sleep(PROFILE_SETTLE_MS)
        await this.closeContext()
        return
      }

      await sleep(1500)
    }

    throw new Error("Timed out waiting for login to complete.")
  }

  async acceptToken(token) {
    const result = await this.onToken(token, "auth-browser")
    const nextRefreshAt = calculateNextRefreshAt(result.expiresAt, this.refreshIntervalMs)
    this.setState({
      status: "connected",
      mode: null,
      message: "Auth browser profile is connected.",
      expiresAt: result.expiresAt,
      lastRefreshAt: new Date().toISOString(),
      nextRefreshAt,
      lastError: null,
    })
    this.scheduleRefresh(nextRefreshAt)
  }

  scheduleRefresh(nextRefreshAt) {
    this.clearRefreshTimer()
    const delay = Math.max(5000, Date.parse(nextRefreshAt) - Date.now())
    this.refreshTimer = setTimeout(() => {
      void this.refreshHeadless()
    }, delay)
    this.refreshTimer.unref?.()
  }

  clearRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  async closeContext() {
    const context = this.context
    this.context = null

    if (context) {
      await context.close().catch((error) => this.logger.warn?.(error))
    }
  }

  setState(next) {
    this.state = {
      ...this.state,
      ...next,
    }
  }
}

async function launchPlaywrightPersistentContext(profileDir, { headless }) {
  const { chromium } = await import("@playwright/test")
  return chromium.launchPersistentContext(profileDir, {
    channel: process.env.AUTH_BROWSER_CHANNEL || "chrome",
    headless,
    viewport: {
      width: 1280,
      height: 900,
    },
  })
}

async function getOrCreatePage(context) {
  return context.pages()[0] || context.newPage()
}

async function readClerkToken(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const token = await page
      .evaluate(async () => {
        const clerk = globalThis.Clerk
        if (!clerk?.session?.getToken) return null
        return await clerk.session.getToken()
      })
      .catch(() => null)

    if (token) {
      return token
    }

    await sleep(1000)
  }

  throw new Error("Clerk did not return an auth token.")
}

function calculateNextRefreshAt(expiresAt, refreshIntervalMs) {
  const expiresAtMs = Date.parse(expiresAt)
  const now = Date.now()
  const ttlMs = expiresAtMs - now
  const refreshLeewayMs = Math.min(REFRESH_LEEWAY_MS, Math.max(5000, Math.floor(ttlMs * 0.25)))
  const target = Number.isFinite(expiresAtMs) ? Math.min(now + refreshIntervalMs, expiresAtMs - refreshLeewayMs) : now + refreshIntervalMs
  return new Date(Math.max(Date.now() + 5000, target)).toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
