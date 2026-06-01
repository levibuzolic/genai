import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { importServer } from "./helpers/server.js"

test("Playbox cURL import validates cookies and refreshes from the stored session", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-playbox-auth-import-"))
  const requests = []
  let tokenIndex = 0
  const tokens = [fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), fakeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 })]

  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers)
    requests.push({
      url: String(url),
      cookie: headers.get("cookie"),
      userAgent: headers.get("user-agent"),
      authorization: headers.get("authorization"),
    })

    assert.equal(String(url), "https://api.playbox.com/auth/refresh-token")
    assert.equal(headers.get("user-agent"), "Chrome Test")
    assert.equal(headers.get("authorization"), null)

    const token = tokens[tokenIndex] || tokens.at(-1)
    tokenIndex += 1
    return Response.json(
      {
        data: {
          accessToken: token,
          user: {
            email: "levi@example.test",
          },
        },
      },
      {
        headers: {
          "set-cookie": `session=rotated-${tokenIndex}; Path=/; HttpOnly`,
        },
      },
    )
  }

  const server = await importServer(mediaDir)
  const status = await server.importPlayboxCurl(
    [
      "curl 'https://api.playbox.com/api/users/me-new'",
      "-H 'User-Agent: Chrome Test'",
      "-H 'Cookie: session=initial; cf_clearance=clearance'",
      "-H 'Authorization: Bearer ignored'",
    ].join(" "),
  )

  assert.equal(status.hasSession, true)
  assert.equal(status.cookieCount, 2)
  assert.equal(status.email, "levi@example.test")
  assert.equal(requests[0].cookie, "session=initial; cf_clearance=clearance")

  assert.equal(await server.refreshPlayboxImportedAuthorization(), true)
  assert.equal(requests[1].cookie, "session=rotated-1; cf_clearance=clearance")

  const stored = JSON.parse(await readFile(path.join(mediaDir, "_playbox_auth_session.json"), "utf8"))
  assert.equal(stored.cookieHeader, "session=rotated-2; cf_clearance=clearance")
  assert.equal(stored.headers["user-agent"], "Chrome Test")
})

function fakeJwt(payload) {
  return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".")
}
