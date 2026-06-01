import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createPlayboxChromeAuthBrowserService } from "../src/server/playbox-chrome-auth-browser.ts"

test("Playbox Chrome auth captures token through a DevTools page context", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "playbox-chrome-auth-"))
  const server = await startDevToolsServer()
  const accepted = []
  const client = new FakeDevToolsClient(fakeBearerToken())
  const service = createPlayboxChromeAuthBrowserService({
    profileDir,
    loginUrl: "https://www.playbox.com/collection",
    usersMeUrl: "https://api.playbox.com/api/users/me-new",
    chromeLauncher: async () => ({
      process: null,
      endpoint: {
        port: server.port,
        baseUrl: server.baseUrl,
      },
    }),
    devToolsFactory: async (webSocketUrl) => {
      assert.equal(webSocketUrl, "ws://127.0.0.1/devtools/page/1")
      return client
    },
    onToken: async (token, source, session) => {
      accepted.push({ token, source, email: session.email })
      return { expiresAt: new Date(Date.now() + 3600_000).toISOString(), source }
    },
    refreshIntervalMs: 3600_000,
  })

  const status = await service.connectVisible()
  assert.equal(status.status, "awaiting-login")

  await service.loginPoll
  await server.close()

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].source, "playbox-chrome-cdp")
  assert.equal(accepted[0].email, "levi@example.test")
  assert.equal(service.getStatus().status, "connected")
  assert.equal(client.closed, true)
})

class FakeDevToolsClient {
  constructor(token) {
    this.token = token
    this.closed = false
    this.methods = []
  }

  async send(method, _params = {}) {
    this.methods.push(method)
    if (method === "Runtime.evaluate") {
      return {
        result: {
          value: {
            token: this.token,
            email: "levi@example.test",
          },
        },
      }
    }

    return {}
  }

  close() {
    this.closed = true
  }
}

async function startDevToolsServer() {
  const server = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      sendJson(response, [
        {
          type: "page",
          url: "https://www.playbox.com/collection",
          webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/1",
        },
      ])
      return
    }

    if (request.url === "/json/version") {
      sendJson(response, {})
      return
    }

    response.statusCode = 404
    response.end()
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  const port = address.port
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

function sendJson(response, value) {
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify(value))
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
