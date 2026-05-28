import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createAuthBrowserService } from "../src/auth-browser.js"

test("auth browser visible login captures token and closes the visible context", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "auth-browser-visible-"))
  const page = new FakePage(fakeBearerToken())
  const context = new FakeContext(page)
  const accepted = []
  const service = createAuthBrowserService({
    profileDir,
    loginUrl: "https://app.example.test/",
    launchPersistentContext: async (receivedProfileDir, options) => {
      assert.equal(receivedProfileDir, profileDir)
      assert.equal(options.headless, false)
      return context
    },
    onToken: async (token, source) => {
      accepted.push({ token, source })
      return { expiresAt: new Date(Date.now() + 3600_000).toISOString(), source }
    },
    refreshIntervalMs: 3600_000,
  })

  const initial = await service.connectVisible()
  assert.equal(initial.status, "awaiting-login")
  assert.equal(page.gotoUrl, "https://app.example.test/")

  await service.loginPoll

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].source, "auth-browser")
  assert.equal(context.closed, true)
  assert.equal(service.getStatus().status, "connected")
})

test("auth browser headless refresh reuses persistent profile", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "auth-browser-headless-"))
  const page = new FakePage(fakeBearerToken())
  const context = new FakeContext(page)
  const service = createAuthBrowserService({
    profileDir,
    loginUrl: "https://app.example.test/",
    launchPersistentContext: async (receivedProfileDir, options) => {
      assert.equal(receivedProfileDir, profileDir)
      assert.equal(options.headless, true)
      return context
    },
    onToken: async (_token, source) => ({ expiresAt: new Date(Date.now() + 3600_000).toISOString(), source }),
    refreshIntervalMs: 3600_000,
  })

  const status = await service.refreshHeadless()

  assert.equal(status.status, "connected")
  assert.equal(status.mode, null)
  assert.equal(status.browserOpen, false)
  assert.equal(context.closed, true)
  assert.equal(page.gotoUrl, "https://app.example.test/")
})

test("auth browser connect is single-flight for duplicate requests", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "auth-browser-single-flight-"))
  const page = new FakePage(fakeBearerToken())
  const context = new FakeContext(page)
  let launches = 0
  let releaseLaunch
  const launchGate = new Promise((resolve) => {
    releaseLaunch = resolve
  })
  const service = createAuthBrowserService({
    profileDir,
    loginUrl: "https://app.example.test/",
    launchPersistentContext: async (_receivedProfileDir, options) => {
      launches += 1
      assert.equal(options.headless, false)
      await launchGate
      return context
    },
    onToken: async (_token, source) => ({ expiresAt: new Date(Date.now() + 3600_000).toISOString(), source }),
    refreshIntervalMs: 3600_000,
  })

  const first = service.connectVisible()
  const second = service.connectVisible()
  releaseLaunch()
  const [firstStatus, secondStatus] = await Promise.all([first, second])

  assert.equal(launches, 1)
  assert.equal(firstStatus.status, "awaiting-login")
  assert.equal(secondStatus.status, "awaiting-login")

  await service.disconnect()
})

class FakeContext {
  constructor(page) {
    this.page = page
    this.closed = false
  }

  pages() {
    return [this.page]
  }

  async newPage() {
    return this.page
  }

  async close() {
    this.closed = true
  }
}

class FakePage {
  constructor(token) {
    this.token = token
    this.gotoUrl = null
  }

  async goto(url) {
    this.gotoUrl = url
  }

  async waitForFunction() {
    if (!this.token) {
      throw new Error("No token")
    }
  }

  async evaluate() {
    return this.token
  }
}

function fakeBearerToken() {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url")

  return `Bearer ${header}.${payload}.signature`
}
