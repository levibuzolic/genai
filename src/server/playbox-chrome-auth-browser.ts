import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_TOKEN_TIMEOUT_MS = 30_000
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const REFRESH_LEEWAY_MS = 60_000
const PROFILE_SETTLE_MS = 2500
const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort"

type PlayboxAuthBrowserStatusValue = "disconnected" | "profile-ready" | "awaiting-login" | "login-required" | "refreshing" | "connected"
type PlayboxAuthBrowserMode = "visible" | null

type TokenResult = {
  expiresAt: string
  source: string
}

type CapturedPlayboxSession = {
  token: string
  email: string | null
}

type PlayboxAuthBrowserState = {
  status: PlayboxAuthBrowserStatusValue
  message: string
  email: string | null
  expiresAt: string | null
  lastRefreshAt: string | null
  nextRefreshAt: string | null
  lastError: string | null
  mode: PlayboxAuthBrowserMode
}

type PlayboxAuthBrowserStatus = PlayboxAuthBrowserState & {
  profileDir: string
  loginUrl: string
  hasProfile: boolean
  browserOpen: boolean
}

type PlayboxChromeAuthBrowserLogger = {
  warn?: (error: unknown) => void
}

type PlayboxChromeLaunch = {
  process: ChildProcess | null
  endpoint: DevToolsEndpoint
}

type ChromeLauncher = (profileDir: string, loginUrl: string) => Promise<PlayboxChromeLaunch>
type DevToolsFactory = (webSocketUrl: string) => Promise<DevToolsClient>

type PlayboxChromeAuthBrowserOptions = {
  profileDir: string
  loginUrl: string
  usersMeUrl: string
  onToken: (token: string, source: string, session: { email?: string | null }) => TokenResult | Promise<TokenResult>
  chromePath?: string | null
  chromeLauncher?: ChromeLauncher
  devToolsFactory?: DevToolsFactory
  loginTimeoutMs?: number
  tokenTimeoutMs?: number
  refreshIntervalMs?: number
  logger?: PlayboxChromeAuthBrowserLogger
}

type DevToolsEndpoint = {
  port: number
  baseUrl: string
}

type DevToolsTarget = {
  id?: string
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

type RemoteObject = {
  value?: unknown
}

type RuntimeEvaluateResult = {
  result?: RemoteObject
}

type CdpResponse = {
  id?: number
  result?: unknown
  error?: {
    message?: string
  }
}

type MinimalWebSocket = {
  addEventListener: {
    (type: "message", listener: (event: { data: unknown }) => void, options?: { once?: boolean }): void
    (type: "open" | "close" | "error", listener: (event: unknown) => void, options?: { once?: boolean }): void
  }
  send: (data: string) => void
  close: () => void
}

declare const WebSocket: {
  new (url: string): MinimalWebSocket
}

export type PlayboxChromeAuthBrowserService = ReturnType<typeof createPlayboxChromeAuthBrowserService>

export function createPlayboxChromeAuthBrowserService(options: PlayboxChromeAuthBrowserOptions): PlayboxChromeAuthBrowser {
  return new PlayboxChromeAuthBrowser(options)
}

class PlayboxChromeAuthBrowser {
  readonly profileDir: string
  readonly loginUrl: string
  readonly usersMeUrl: string
  readonly onToken: (token: string, source: string, session: { email?: string | null }) => TokenResult | Promise<TokenResult>
  readonly chromeLauncher: ChromeLauncher
  readonly devToolsFactory: DevToolsFactory
  readonly loginTimeoutMs: number
  readonly tokenTimeoutMs: number
  readonly refreshIntervalMs: number
  readonly logger: PlayboxChromeAuthBrowserLogger
  process: ChildProcess | null
  endpoint: DevToolsEndpoint | null
  refreshTimer: NodeJS.Timeout | null
  loginPoll: Promise<void> | null
  private connectPromise: Promise<PlayboxAuthBrowserStatus> | null
  private refreshPromise: Promise<PlayboxAuthBrowserStatus> | null
  private state: PlayboxAuthBrowserState

  constructor({
    profileDir,
    loginUrl,
    usersMeUrl,
    onToken,
    chromePath = null,
    chromeLauncher = (launchProfileDir, launchLoginUrl) => launchChromeWithDevTools(launchProfileDir, launchLoginUrl, chromePath),
    devToolsFactory = (webSocketUrl) => DevToolsClient.connect(webSocketUrl),
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    tokenTimeoutMs = DEFAULT_TOKEN_TIMEOUT_MS,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    logger = console,
  }: PlayboxChromeAuthBrowserOptions) {
    this.profileDir = profileDir
    this.loginUrl = loginUrl
    this.usersMeUrl = usersMeUrl
    this.onToken = onToken
    this.chromeLauncher = chromeLauncher
    this.devToolsFactory = devToolsFactory
    this.loginTimeoutMs = loginTimeoutMs
    this.tokenTimeoutMs = tokenTimeoutMs
    this.refreshIntervalMs = refreshIntervalMs
    this.logger = logger
    this.process = null
    this.endpoint = null
    this.refreshTimer = null
    this.loginPoll = null
    this.connectPromise = null
    this.refreshPromise = null
    this.state = {
      status: existsSync(profileDir) ? "profile-ready" : "disconnected",
      message: existsSync(profileDir) ? "Saved Playbox Chrome profile is available." : "No saved Playbox Chrome profile.",
      email: null,
      expiresAt: null,
      lastRefreshAt: null,
      nextRefreshAt: null,
      lastError: null,
      mode: null,
    }
  }

  getStatus(): PlayboxAuthBrowserStatus {
    return {
      ...this.state,
      profileDir: this.profileDir,
      loginUrl: this.loginUrl,
      hasProfile: existsSync(this.profileDir),
      browserOpen: Boolean(this.process && !this.process.killed),
    }
  }

  async connectVisible(): Promise<PlayboxAuthBrowserStatus> {
    if (this.connectPromise) {
      return this.connectPromise
    }

    if (this.state.status === "awaiting-login" && this.process) {
      return this.getStatus()
    }

    this.connectPromise = this.openVisibleLogin()

    try {
      return await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  async refreshHeadless(): Promise<PlayboxAuthBrowserStatus> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    if (this.state.status === "awaiting-login") {
      return this.getStatus()
    }

    this.refreshPromise = this.runVisibleRefresh()

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  async disconnect({ deleteProfile = false }: { deleteProfile?: boolean } = {}): Promise<PlayboxAuthBrowserStatus> {
    this.clearRefreshTimer()
    await this.closeBrowser()

    if (deleteProfile) {
      await rm(this.profileDir, { recursive: true, force: true })
    }

    this.setState({
      status: existsSync(this.profileDir) ? "profile-ready" : "disconnected",
      mode: null,
      message: existsSync(this.profileDir) ? "Saved Playbox Chrome profile is available." : "Playbox Chrome profile removed.",
      email: null,
      expiresAt: null,
      lastRefreshAt: null,
      nextRefreshAt: null,
      lastError: null,
    })

    return this.getStatus()
  }

  startAutoRefresh(): PlayboxAuthBrowserStatus {
    if (!existsSync(this.profileDir)) {
      return this.getStatus()
    }

    void this.refreshHeadless()
    return this.getStatus()
  }

  clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private async openVisibleLogin(): Promise<PlayboxAuthBrowserStatus> {
    await this.closeBrowser()
    await mkdir(this.profileDir, { recursive: true })
    const launch = await this.chromeLauncher(this.profileDir, this.loginUrl)
    this.process = launch.process
    this.endpoint = launch.endpoint
    this.setState({
      status: "awaiting-login",
      mode: "visible",
      message:
        "Complete Playbox login in the opened Chrome window. The backend will capture a short-lived token once Playbox is signed in.",
      lastError: null,
    })

    this.loginPoll = this.pollVisibleLogin(this.loginTimeoutMs)
    this.loginPoll.catch((error: unknown) => {
      this.setState({
        status: "login-required",
        mode: null,
        message: "Playbox login did not complete. Open the Playbox auth browser and try again.",
        lastError: error instanceof Error ? error.message : String(error),
      })
      this.closeBrowser().catch((closeError) => this.logger.warn?.(closeError))
    })

    return this.getStatus()
  }

  private async runVisibleRefresh(): Promise<PlayboxAuthBrowserStatus> {
    await this.closeBrowser()
    await mkdir(this.profileDir, { recursive: true })
    this.setState({
      status: "refreshing",
      mode: "visible",
      message: "Refreshing Playbox auth from the saved Chrome profile...",
      lastError: null,
    })

    try {
      const launch = await this.chromeLauncher(this.profileDir, this.loginUrl)
      this.process = launch.process
      this.endpoint = launch.endpoint
      const session = await this.readSession(this.tokenTimeoutMs)
      await this.acceptToken(session)
      await sleep(PROFILE_SETTLE_MS)
      await this.closeBrowser()
      return this.getStatus()
    } catch (error) {
      await this.closeBrowser()
      this.clearRefreshTimer()
      this.setState({
        status: "login-required",
        mode: null,
        message: "Saved Playbox Chrome profile could not refresh auth. Reconnect with visible login.",
        lastError: error instanceof Error ? error.message : String(error),
      })
      return this.getStatus()
    }
  }

  private async pollVisibleLogin(timeoutMs: number): Promise<void> {
    const session = await this.readSession(timeoutMs)
    await this.acceptToken(session)
    await sleep(PROFILE_SETTLE_MS)
    await this.closeBrowser()
  }

  private async readSession(timeoutMs: number): Promise<CapturedPlayboxSession> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      try {
        const endpoint = this.endpoint
        if (!endpoint) {
          throw new Error("Chrome DevTools endpoint is not available.")
        }

        const target = await waitForPlayboxTarget(endpoint, this.loginUrl, deadline)
        const client = await this.devToolsFactory(target.webSocketDebuggerUrl)
        try {
          await client.send("Page.enable")
          if (!target.url || !sameOrigin(target.url, this.loginUrl)) {
            await client.send("Page.navigate", { url: this.loginUrl })
            await sleep(1500)
          }

          const session = await readPlayboxSessionFromDevTools(client, this.usersMeUrl)
          if (session) {
            return session
          }
        } finally {
          client.close()
        }
      } catch (error) {
        this.logger.warn?.(error)
      }

      await sleep(1000)
    }

    throw new Error("Playbox did not return an auth token.")
  }

  private async acceptToken(session: CapturedPlayboxSession): Promise<void> {
    const result = await this.onToken(session.token, "playbox-chrome-cdp", { email: session.email })
    const nextRefreshAt = calculateNextRefreshAt(result.expiresAt, this.refreshIntervalMs)
    this.setState({
      status: "connected",
      mode: null,
      message: "Playbox Chrome profile is connected.",
      email: session.email,
      expiresAt: result.expiresAt,
      lastRefreshAt: new Date().toISOString(),
      nextRefreshAt,
      lastError: null,
    })
    this.scheduleRefresh(nextRefreshAt)
  }

  private scheduleRefresh(nextRefreshAt: string): void {
    this.clearRefreshTimer()
    const delay = Math.max(5000, Date.parse(nextRefreshAt) - Date.now())
    this.refreshTimer = setTimeout(() => {
      void this.refreshHeadless()
    }, delay)
    this.refreshTimer.unref?.()
  }

  private async closeBrowser(): Promise<void> {
    const process = this.process
    const endpoint = this.endpoint
    this.process = null
    this.endpoint = null

    if (endpoint) {
      await closeChromeThroughDevTools(endpoint).catch((error: unknown) => this.logger.warn?.(error))
    }

    if (process && !process.killed) {
      process.kill()
    }
  }

  private setState(next: Partial<PlayboxAuthBrowserState>): void {
    this.state = {
      ...this.state,
      ...next,
    }
  }
}

class DevToolsClient {
  private readonly socket: MinimalWebSocket
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private constructor(socket: MinimalWebSocket) {
    this.socket = socket
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data))
    this.socket.addEventListener("close", () => this.rejectAll(new Error("Chrome DevTools connection closed.")))
    this.socket.addEventListener("error", (event) => this.rejectAll(new Error(`Chrome DevTools socket error: ${String(event)}`)))
  }

  static connect(webSocketUrl: string): Promise<DevToolsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl)
      socket.addEventListener("open", () => resolve(new DevToolsClient(socket)), { once: true })
      socket.addEventListener("error", (event) => reject(new Error(`Chrome DevTools socket error: ${String(event)}`)), {
        once: true,
      })
    })
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.socket.send(JSON.stringify({ id, method, params }))
    return promise
  }

  close(): void {
    this.socket.close()
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return
    }

    const message = parseJsonObject<CdpResponse>(data)
    if (!message || typeof message.id !== "number") {
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }

    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(message.error.message || "Chrome DevTools command failed."))
      return
    }

    pending.resolve(message.result)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

async function launchChromeWithDevTools(
  profileDir: string,
  loginUrl: string,
  configuredChromePath: string | null,
): Promise<PlayboxChromeLaunch> {
  const chromePath = resolveChromePath(configuredChromePath)
  const process = spawn(
    chromePath,
    [
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profileDir}`,
      "--new-window",
      loginUrl,
    ],
    {
      detached: false,
      stdio: "ignore",
    },
  )

  process.unref()
  const endpoint = await waitForDevToolsEndpoint(profileDir, process)
  return { process, endpoint }
}

async function waitForDevToolsEndpoint(profileDir: string, process: ChildProcess): Promise<DevToolsEndpoint> {
  const portFile = `${profileDir}/${DEVTOOLS_ACTIVE_PORT_FILE}`
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was available with code ${process.exitCode}.`)
    }

    const contents = await readFile(portFile, "utf8").catch(() => null)
    const portText = contents?.split(/\r?\n/u)[0]?.trim()
    const port = Number(portText)
    if (Number.isInteger(port) && port > 0) {
      return {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
      }
    }

    await sleep(250)
  }

  throw new Error("Timed out waiting for Chrome DevTools to become available.")
}

async function waitForPlayboxTarget(endpoint: DevToolsEndpoint, loginUrl: string, deadline: number): Promise<Required<DevToolsTarget>> {
  while (Date.now() < deadline) {
    const targets = await listTargets(endpoint).catch(() => [])
    const pageTargets = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl)
    const playboxTarget = pageTargets.find((target) => target.url && sameOrigin(target.url, loginUrl)) || pageTargets[0]

    if (playboxTarget?.webSocketDebuggerUrl) {
      return {
        id: playboxTarget.id || "",
        type: playboxTarget.type || "page",
        url: playboxTarget.url || "",
        webSocketDebuggerUrl: playboxTarget.webSocketDebuggerUrl,
      }
    }

    const newTarget = await openNewTarget(endpoint, loginUrl).catch(() => null)
    if (newTarget?.webSocketDebuggerUrl) {
      return {
        id: newTarget.id || "",
        type: newTarget.type || "page",
        url: newTarget.url || loginUrl,
        webSocketDebuggerUrl: newTarget.webSocketDebuggerUrl,
      }
    }

    await sleep(500)
  }

  throw new Error("Timed out waiting for a Playbox Chrome tab.")
}

async function listTargets(endpoint: DevToolsEndpoint): Promise<DevToolsTarget[]> {
  const response = await fetch(`${endpoint.baseUrl}/json/list`)
  if (!response.ok) {
    throw new Error(`Chrome target list failed: ${response.status}`)
  }

  const body: unknown = await response.json()
  return Array.isArray(body) ? body.filter(isDevToolsTarget) : []
}

async function openNewTarget(endpoint: DevToolsEndpoint, loginUrl: string): Promise<DevToolsTarget | null> {
  const response = await fetch(`${endpoint.baseUrl}/json/new?${encodeURIComponent(loginUrl)}`, { method: "PUT" })
  if (!response.ok) {
    return null
  }

  const body: unknown = await response.json()
  return isDevToolsTarget(body) ? body : null
}

async function readPlayboxSessionFromDevTools(client: DevToolsClient, usersMeUrl: string): Promise<CapturedPlayboxSession | null> {
  const result = await client.send("Runtime.evaluate", {
    expression: `(${fetchPlayboxSessionInPage.toString()})(${JSON.stringify(usersMeUrl)})`,
    awaitPromise: true,
    returnByValue: true,
  })

  const evaluateResult = isRuntimeEvaluateResult(result) ? result : null
  const value = evaluateResult?.result?.value
  return isCapturedPlayboxSession(value) ? value : null
}

function fetchPlayboxSessionInPage(usersMeUrl: string): Promise<CapturedPlayboxSession | null> {
  return fetch(usersMeUrl, {
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  })
    .then(async (response) => {
      if (!response.ok) return null
      const body = (await response.json()) as {
        data?: {
          accessToken?: unknown
          user?: {
            userId?: unknown
            email?: unknown
          }
        }
      }
      const data = body?.data
      const token = data?.accessToken
      const userEmail = data?.user?.userId || data?.user?.email || null
      const email = typeof userEmail === "string" ? userEmail : null
      return typeof token === "string" && token ? { token, email } : null
    })
    .catch(() => null)
}

async function closeChromeThroughDevTools(endpoint: DevToolsEndpoint): Promise<void> {
  const response = await fetch(`${endpoint.baseUrl}/json/version`)
  if (!response.ok) {
    return
  }

  const body = parseJsonObject<{ webSocketDebuggerUrl?: unknown }>(await response.text())
  const webSocketDebuggerUrl = typeof body?.webSocketDebuggerUrl === "string" ? body.webSocketDebuggerUrl : null
  if (!webSocketDebuggerUrl) {
    return
  }

  const client = await DevToolsClient.connect(webSocketDebuggerUrl)
  try {
    await client.send("Browser.close")
  } finally {
    client.close()
  }
}

function resolveChromePath(configuredChromePath: string | null): string {
  if (configuredChromePath) {
    return configuredChromePath
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
  const candidate = candidates.find((path) => existsSync(path))
  if (candidate) {
    return candidate
  }

  throw new Error("Google Chrome was not found. Set PLAYBOX_CHROME_PATH to the Chrome executable.")
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function calculateNextRefreshAt(expiresAt: string, refreshIntervalMs: number): string {
  const expiresAtMs = Date.parse(expiresAt)
  const now = Date.now()
  const ttlMs = expiresAtMs - now
  const refreshLeewayMs = Math.min(REFRESH_LEEWAY_MS, Math.max(5000, Math.floor(ttlMs * 0.25)))
  const target = Number.isFinite(expiresAtMs) ? Math.min(now + refreshIntervalMs, expiresAtMs - refreshLeewayMs) : now + refreshIntervalMs
  return new Date(Math.max(Date.now() + 5000, target)).toISOString()
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return Boolean(value && typeof value === "object" && "webSocketDebuggerUrl" in value)
}

function isRuntimeEvaluateResult(value: unknown): value is RuntimeEvaluateResult {
  return Boolean(value && typeof value === "object" && "result" in value)
}

function isCapturedPlayboxSession(value: unknown): value is CapturedPlayboxSession {
  return Boolean(value && typeof value === "object" && "token" in value && typeof value.token === "string" && value.token)
}

function parseJsonObject<T extends object>(value: string): T | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" ? (parsed as T) : null
  } catch {
    return null
  }
}
