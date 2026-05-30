import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  deferred,
  fakeBearerToken,
  importServer,
  jsonResponse,
  listenOnRandomPort,
  PNG_BYTES,
  postJson,
  readCatalog,
  readCatalogFromDbFile,
  requestJson,
  requestRaw,
  writeCatalog,
} from "./helpers/server.js"

test("sync cancel endpoint stops before the next API page and preserves scanned catalog state", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-cancel-api-"))
  const id = "99999999-9999-4999-8999-999999999999"
  await writeCatalog(mediaDir, {
    items: [],
    downloadedJobIds: [],
    lastSeenJobId: null,
  })

  const pageOne = deferred()
  const pageOneRequested = deferred()
  let pageTwoRequests = 0
  let mediaRequests = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      pageOneRequested.resolve()
      return pageOne.promise
    }

    if (href.includes("/api/jobs") && href.includes("page=2")) {
      pageTwoRequests += 1
      return jsonResponse({ results: [] })
    }

    if (href === "https://assets.example/cancel_00.png") {
      mediaRequests += 1
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  let listener = null

  try {
    const imported = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    listener = await listenOnRandomPort(imported.server)
    const syncPromise = imported.startSync({ incremental: false })

    await pageOneRequested.promise
    const cancelResponse = await postJson(listener.port, "/api/sync/cancel")
    assert.equal(cancelResponse.statusCode, 200)
    assert.equal(cancelResponse.body.ok, true)
    assert.equal(imported.syncState.status, "cancelling")
    assert.equal(imported.syncState.cancelRequested, true)

    pageOne.resolve(
      jsonResponse({
        results: [
          {
            id,
            user_id: "user_test",
            type: "edit",
            prompt: "cancelled prompt",
            negative_prompt: "",
            status: "done",
            output_url: "https://assets.example/cancel_00.png",
            input_url: null,
            created_at: 1779769825,
            external_task_id: "task_cancel",
            shared: false,
            favorited: false,
            error: null,
          },
        ],
      }),
    )

    await syncPromise

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)

    assert.equal(imported.syncState.running, false)
    assert.equal(imported.syncState.status, "cancelled")
    assert.match(imported.syncState.message, /^Cancelled\./)
    assert.equal(imported.syncState.scanned, 1)
    assert.equal(imported.syncState.downloaded, 0)
    assert.equal(pageTwoRequests, 0)
    assert.equal(mediaRequests, 0)
    assert.equal(catalog.lastSeenJobId, id)
    assert.equal(catalog.lastRun.cancelled, true)
    assert.equal(item.localFile, undefined)
  } finally {
    if (listener) {
      await listener.close()
    }
    globalThis.fetch = originalFetch
  }
})

test("download cancel endpoint stops between media downloads", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-cancel-download-"))
  const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  await writeCatalog(mediaDir, {
    items: [
      {
        id: firstId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/first.png",
        createdAt: 1779769825,
      },
      {
        id: secondId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/second.png",
        createdAt: 1779769800,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: firstId,
  })

  const firstDownload = deferred()
  const firstDownloadRequested = deferred()
  let secondRequests = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href === "https://assets.example/first.png") {
      firstDownloadRequested.resolve()
      return firstDownload.promise
    }

    if (href === "https://assets.example/second.png") {
      secondRequests += 1
      return new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  let listener = null

  try {
    const imported = await importServer(mediaDir)
    listener = await listenOnRandomPort(imported.server)
    const downloadPromise = imported.startCatalogDownload({ mode: "download-missing" })

    await firstDownloadRequested.promise
    const cancelResponse = await postJson(listener.port, "/api/sync/cancel")
    assert.equal(cancelResponse.statusCode, 200)
    assert.equal(cancelResponse.body.ok, true)

    firstDownload.resolve(
      new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      }),
    )

    await downloadPromise

    const catalog = await readCatalog(mediaDir)
    const firstItem = catalog.items.find((entry) => entry.id === firstId)
    const secondItem = catalog.items.find((entry) => entry.id === secondId)

    assert.equal(imported.syncState.status, "cancelled")
    assert.equal(imported.syncState.downloaded, 1)
    assert.equal(secondRequests, 0)
    assert.equal(catalog.lastRun.cancelled, true)
    assert.equal(firstItem.localFile, `2026-05-26/2026-05-26_edit_${firstId}.jpg`)
    assert.equal(secondItem.localFile, undefined)
    assert.equal(existsSync(path.join(mediaDir, firstItem.localFile)), true)
  } finally {
    if (listener) {
      await listener.close()
    }
    globalThis.fetch = originalFetch
  }
})

test("catalog item helpers are exported at module scope", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-helpers-"))
  const server = await importServer(mediaDir)
  const id = "44444444-4444-4444-8444-444444444444"
  const item = {
    id,
    type: "edit",
    status: "done",
    outputUrl: "https://assets.example/result_00.png",
    createdAt: 1779769825,
  }

  assert.equal(server.isDownloadableCatalogItem(item), true)
  assert.deepEqual(server.jobFromCatalogItem(item), {
    id,
    user_id: undefined,
    type: "edit",
    prompt: undefined,
    negative_prompt: undefined,
    status: "done",
    output_url: "https://assets.example/result_00.png",
    input_url: undefined,
    created_at: 1779769825,
    external_task_id: undefined,
    shared: undefined,
    favorited: undefined,
    error: undefined,
  })
})

test("item delete endpoint deletes upstream job and keeps local files by default", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-remote-delete-keep-"))
  const id = "12121212-1212-4121-8121-121212121212"
  const localFile = `2026-05-26/2026-05-26_edit_${id}.jpg`
  const thumbnailFile = `_thumbnails/2026-05-26/2026-05-26_video_${id}.jpg`
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await mkdir(path.dirname(path.join(mediaDir, thumbnailFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), PNG_BYTES)
  await writeFile(path.join(mediaDir, thumbnailFile), PNG_BYTES)
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/delete-keep.png",
        localFile,
        thumbnailFile,
        createdAt: 1779769825,
      },
    ],
    downloadedJobIds: [id],
    lastSeenJobId: id,
  })

  const originalFetch = globalThis.fetch
  let deleteRequests = 0
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), `https://api.generateporn.ai/api/jobs/${id}`)
    assert.equal(options.method, "DELETE")
    deleteRequests += 1
    return new Response(null, { status: 204 })
  }

  let listener = null

  try {
    const imported = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    listener = await listenOnRandomPort(imported.server)
    const response = await requestJson(listener.port, `/api/items/${id}`, "DELETE")
    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)
    const defaultView = await imported.getItems(new URLSearchParams())
    const deletedView = await imported.getItems(new URLSearchParams("status=deleted"))

    assert.equal(response.statusCode, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.body.keepLocalFiles, true)
    assert.equal(response.body.remoteStatus, "deleted")
    assert.equal(deleteRequests, 1)
    assert.equal(item.remoteDeleteStatus, "deleted")
    assert.equal(typeof item.remoteDeletedAt, "string")
    assert.equal(existsSync(path.join(mediaDir, localFile)), true)
    assert.equal(existsSync(path.join(mediaDir, thumbnailFile)), true)
    assert.deepEqual(catalog.downloadedJobIds, [id])
    assert.equal(defaultView.total, 0)
    assert.equal(defaultView.facets.status?.all, 0)
    assert.equal(defaultView.facets.status?.deleted, 1)
    assert.deepEqual(
      deletedView.items.map((entry) => entry.id),
      [id],
    )
    assert.equal(deletedView.total, 1)
  } finally {
    if (listener) {
      await listener.close()
    }
    globalThis.fetch = originalFetch
  }
})

test("item delete endpoint can remove local files and catalog entry", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-remote-delete-local-"))
  const id = "34343434-3434-4343-8343-343434343434"
  const localFile = `2026-05-26/2026-05-26_video_${id}.mp4`
  const thumbnailFile = `_thumbnails/2026-05-26/2026-05-26_video_${id}.jpg`
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await mkdir(path.dirname(path.join(mediaDir, thumbnailFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([0, 0, 0, 24]))
  await writeFile(path.join(mediaDir, thumbnailFile), PNG_BYTES)
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/delete-local.mp4",
        localFile,
        thumbnailFile,
        createdAt: 1779769825,
      },
    ],
    downloadedJobIds: [id],
    lastSeenJobId: id,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), `https://api.generateporn.ai/api/jobs/${id}`)
    assert.equal(options.method, "DELETE")
    return jsonResponse({ ok: true })
  }

  let listener = null

  try {
    const imported = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    listener = await listenOnRandomPort(imported.server)
    const response = await requestJson(listener.port, `/api/items/${id}`, "DELETE", { keepLocalFiles: false })
    const catalog = await readCatalog(mediaDir)

    assert.equal(response.statusCode, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.body.item, null)
    assert.equal(response.body.keepLocalFiles, false)
    assert.deepEqual(response.body.deletedLocalFiles.toSorted(), [localFile, thumbnailFile].toSorted())
    assert.equal(
      catalog.items.some((entry) => entry.id === id),
      false,
    )
    assert.deepEqual(catalog.downloadedJobIds, [])
    assert.equal(existsSync(path.join(mediaDir, localFile)), false)
    assert.equal(existsSync(path.join(mediaDir, thumbnailFile)), false)
  } finally {
    if (listener) {
      await listener.close()
    }
    globalThis.fetch = originalFetch
  }
})

test("item favorite endpoint toggles upstream favorite state and updates catalog", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-favorite-"))
  const id = "56565656-5656-4565-8565-565656565656"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/favorite.png",
        favorited: false,
        createdAt: 1779769825,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: id,
  })

  const originalFetch = globalThis.fetch
  const methods = []
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), `https://api.generateporn.ai/api/jobs/${id}/favorite`)
    methods.push(options.method)
    return jsonResponse({ ok: true })
  }

  let listener = null

  try {
    const imported = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    listener = await listenOnRandomPort(imported.server)

    const favoriteResponse = await requestJson(listener.port, `/api/items/${id}/favorite`, "POST")
    assert.equal(favoriteResponse.statusCode, 200)
    assert.equal(favoriteResponse.body.favorited, true)
    assert.equal(favoriteResponse.body.item.favorited, true)
    assert.equal((await readCatalog(mediaDir)).items[0].favorited, true)

    const unfavoriteResponse = await requestJson(listener.port, `/api/items/${id}/favorite`, "DELETE")
    assert.equal(unfavoriteResponse.statusCode, 200)
    assert.equal(unfavoriteResponse.body.favorited, false)
    assert.equal(unfavoriteResponse.body.item.favorited, false)
    assert.equal((await readCatalog(mediaDir)).items[0].favorited, false)
    assert.deepEqual(methods, ["POST", "DELETE"])
  } finally {
    if (listener) {
      await listener.close()
    }
    globalThis.fetch = originalFetch
  }
})

test("catalog download retries failed media and clears old error", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-retry-"))
  const id = "55555555-5555-4555-8555-555555555555"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/retry_00.mp4",
        createdAt: 1779769825,
        downloadError: "old network failure",
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: id,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://assets.example/retry_00.mp4")
    return new Response(new Uint8Array([4, 5, 6, 7]), {
      status: 200,
      headers: {
        "content-type": "video/mp4",
      },
    })
  }

  try {
    const server = await importServer(mediaDir)

    await server.startCatalogDownload({ mode: "retry-errors" })

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)

    assert.equal(server.syncState.mode, "retry-errors")
    assert.equal(server.syncState.downloaded, 1)
    assert.equal(item.downloadError, null)
    assert.equal(item.localFile, `2026-05-26/2026-05-26_video_${id}.mp4`)
    assert.equal(existsSync(path.join(mediaDir, item.localFile)), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("sync retries known missing catalog files with previous download errors", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-sync-errors-"))
  const id = "56565656-5656-4565-8565-565656565656"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/sync_retry.mp4",
        createdAt: 1779769825,
        downloadError: "old transient failure",
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: id,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://assets.example/sync_retry.mp4")
    return new Response(new Uint8Array([5, 6, 5, 6]), {
      status: 200,
      headers: {
        "content-type": "video/mp4",
      },
    })
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: "",
      GENERATEPORN_COOKIE: "",
    })

    await server.startSync({ incremental: true })

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)

    assert.equal(server.syncState.downloaded, 1)
    assert.equal(item.downloadError, null)
    assert.equal(item.localFile, `2026-05-26/2026-05-26_video_${id}.mp4`)
    assert.equal(existsSync(path.join(mediaDir, item.localFile)), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("catalog download queues separate missing and errored items", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-queues-"))
  const server = await importServer(mediaDir)
  const missing = {
    id: "66666666-6666-4666-8666-666666666666",
    type: "edit",
    status: "done",
    outputUrl: "https://assets.example/missing.png",
  }
  const errored = {
    id: "77777777-7777-4777-8777-777777777777",
    type: "video",
    status: "done",
    outputUrl: "https://assets.example/errored.mp4",
    downloadError: "failed",
  }
  const downloaded = {
    id: "88888888-8888-4888-8888-888888888888",
    type: "edit",
    status: "done",
    outputUrl: "https://assets.example/downloaded.png",
    localFile: "2026-05-26/downloaded.png",
  }

  assert.deepEqual(
    server.getCatalogDownloadQueue([missing, errored, downloaded]).map((item) => item.id),
    [missing.id],
  )
  assert.deepEqual(
    server.getCatalogDownloadQueue([missing, errored, downloaded], { retryErrors: true }).map((item) => item.id),
    [errored.id],
  )
  assert.deepEqual(
    server.getCatalogDownloadQueue([missing, errored, downloaded], { includeErrors: true }).map((item) => item.id),
    [missing.id, errored.id],
  )
})

test("media directory resolution supports absolute and home-relative paths", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-paths-"))
  const server = await importServer(mediaDir)
  const homeRelative = server.resolveMediaDir("~/RemoteDrive/media")

  assert.equal(server.resolveMediaDir("/Volumes/RemoteDrive/media"), "/Volumes/RemoteDrive/media")
  assert.equal(homeRelative, path.join(os.homedir(), "RemoteDrive/media"))
})

test("media route supports byte ranges for browser video playback", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-range-"))
  const localFile = "2026-05-27/2026-05-27_video_48e8224f-ffbe-4f68-aaff-b794a629406b.mp4"
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))

  const imported = await importServer(mediaDir)
  const listener = await listenOnRandomPort(imported.server)

  try {
    const partial = await requestRaw(listener.port, `/media/${localFile}`, {
      range: "bytes=2-5",
    })
    const suffix = await requestRaw(listener.port, `/media/${localFile}`, {
      range: "bytes=-2",
    })
    const invalid = await requestRaw(listener.port, `/media/${localFile}`, {
      range: "bytes=99-120",
    })
    const head = await requestRaw(listener.port, `/media/${localFile}`, {}, "HEAD")

    assert.equal(partial.statusCode, 206)
    assert.equal(partial.headers["content-type"], "video/mp4")
    assert.equal(partial.headers["accept-ranges"], "bytes")
    assert.equal(partial.headers["content-range"], "bytes 2-5/8")
    assert.equal(partial.headers["content-length"], "4")
    assert.deepEqual([...partial.body], [2, 3, 4, 5])
    assert.equal(suffix.headers["content-range"], "bytes 6-7/8")
    assert.deepEqual([...suffix.body], [6, 7])
    assert.equal(invalid.statusCode, 416)
    assert.equal(invalid.headers["content-range"], "bytes */8")
    assert.equal(head.statusCode, 200)
    assert.equal(head.headers["content-length"], "8")
    assert.equal(head.body.length, 0)
  } finally {
    await listener.close()
  }
})

test("library verification hashes files, marks duplicate catalog items, and records orphans", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-verify-"))
  const firstId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"
  const secondId = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"
  const firstFile = `2026-05-26/2026-05-26_edit_${firstId}.png`
  const secondFile = `2026-05-26/2026-05-26_edit_${secondId}.png`
  const orphanFile = "loose/orphan.png"

  await mkdir(path.dirname(path.join(mediaDir, firstFile)), { recursive: true })
  await mkdir(path.dirname(path.join(mediaDir, orphanFile)), { recursive: true })
  await writeFile(path.join(mediaDir, firstFile), new Uint8Array([1, 2, 3, 4]))
  await writeFile(path.join(mediaDir, secondFile), new Uint8Array([1, 2, 3, 4]))
  await writeFile(path.join(mediaDir, orphanFile), new Uint8Array([9, 9]))
  await writeCatalog(mediaDir, {
    items: [
      {
        id: firstId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/first.png",
        localFile: firstFile,
        createdAt: 1779769800,
      },
      {
        id: secondId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/second.png",
        localFile: secondFile,
        createdAt: 1779769900,
      },
    ],
    downloadedJobIds: [firstId, secondId],
    lastSeenJobId: secondId,
  })

  const server = await importServer(mediaDir)

  await server.startLibraryVerification()

  const catalog = await readCatalog(mediaDir)
  const first = catalog.items.find((entry) => entry.id === firstId)
  const second = catalog.items.find((entry) => entry.id === secondId)
  const duplicateView = await server.getItems(new URLSearchParams("status=duplicate"))
  const unverifiedView = await server.getItems(new URLSearchParams("status=unverified"))

  assert.equal(server.syncState.mode, "verify-library")
  assert.equal(server.syncState.downloaded, 3)
  assert.equal(first.sha256, server.hashBuffer(new Uint8Array([1, 2, 3, 4])))
  assert.equal(first.fileSize, 4)
  assert.equal(first.duplicateGroupSize, 2)
  assert.equal(first.duplicateOf, null)
  assert.equal(second.duplicateGroupSize, 2)
  assert.equal(second.duplicateOf, firstId)
  assert.equal(catalog.orphanFiles.length, 1)
  assert.equal(catalog.orphanFiles[0].localFile, orphanFile)
  assert.equal(duplicateView.total, 2)
  assert.equal(duplicateView.facets.orphanFiles, 1)
  assert.equal(unverifiedView.total, 0)
})

test("item index hides rendering media after one hour without removing catalog details", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-stale-rendering-"))
  const staleId = "15151515-1515-4151-8151-151515151515"
  const recentId = "16161616-1616-4161-8161-161616161616"
  const doneId = "17171717-1717-4171-8171-171717171717"
  const now = Date.now()

  await writeCatalog(mediaDir, {
    items: [
      {
        id: staleId,
        type: "video",
        status: "processing",
        prompt: "stale rendering",
        createdAtIso: new Date(now - 61 * 60 * 1000).toISOString(),
      },
      {
        id: recentId,
        type: "video",
        status: "processing",
        prompt: "recent rendering",
        createdAtIso: new Date(now - 5 * 60 * 1000).toISOString(),
      },
      {
        id: doneId,
        type: "edit",
        status: "done",
        prompt: "finished media",
        outputUrl: "https://assets.example/done.png",
        localFile: "2026-05-27/2026-05-27_edit_17171717-1717-4171-8171-171717171717.png",
        createdAt: Math.floor(now / 1000),
      },
    ],
    downloadedJobIds: [doneId],
    lastSeenJobId: staleId,
  })

  const server = await importServer(mediaDir)
  let listener = null

  try {
    listener = await listenOnRandomPort(server.server)

    const data = await server.getItems(new URLSearchParams())
    const staleDetail = await requestJson(listener.port, `/api/items/${staleId}`, "GET")

    assert.deepEqual(
      data.items.map((item) => item.id),
      [doneId, recentId],
    )
    assert.equal(data.total, 2)
    assert.equal(data.facets.media?.all, 2)
    assert.equal(data.facets.media?.video, 1)
    assert.equal(staleDetail.statusCode, 200)
    assert.equal(staleDetail.body.item.id, staleId)
    assert.equal(staleDetail.body.item.status, "processing")
  } finally {
    if (listener) {
      await listener.close()
    }
  }
})

test("catalog backups can be created, listed, and restored safely", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-backups-"))
  const id = "cccccccc-3333-4ccc-8ccc-cccccccccccc"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/original.png",
        createdAt: 1779769800,
      },
    ],
    downloadedJobIds: [id],
    lastSeenJobId: id,
  })

  const server = await importServer(mediaDir)
  const backup = await server.createCatalogBackup("manual test")
  assert.equal(backup.file.endsWith(".sqlite"), true)
  assert.equal(backup.itemCount, 1)
  const listener = await listenOnRandomPort(server.server)

  try {
    const exported = await requestRaw(listener.port, "/api/catalog/export")
    assert.equal(exported.headers["content-type"], "application/vnd.sqlite3")
    assert.match(exported.headers["content-disposition"], /\.sqlite"/)
    assert.equal(exported.body.subarray(0, 16).toString("utf8"), "SQLite format 3\u0000")

    await writeCatalog(mediaDir, {
      items: [],
      downloadedJobIds: [],
      lastSeenJobId: null,
    })

    const listed = await server.listCatalogBackups()
    const restored = await server.restoreCatalogBackup(backup.file)
    const catalog = await readCatalog(mediaDir)

    assert.equal(
      listed.some((entry) => entry.file === backup.file),
      true,
    )
    assert.equal(restored.file, backup.file)
    assert.equal(restored.itemCount, 1)
    assert.equal(catalog.items.length, 1)
    assert.equal(catalog.items[0].id, id)
    assert.equal(
      (await server.listCatalogBackups()).some((entry) => entry.reason === "before-restore"),
      true,
    )
    await assert.rejects(() => server.restoreCatalogBackup("../backup.sqlite"), /Invalid backup filename/)
  } finally {
    await listener.close()
  }
})

test("mutating long jobs create a catalog backup before changing verification metadata", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-auto-backup-"))
  const id = "dddddddd-4444-4ddd-8ddd-dddddddddddd"
  const localFile = `2026-05-26/2026-05-26_edit_${id}.png`

  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([5, 6, 7]))
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/verify.png",
        localFile,
        createdAt: 1779769800,
      },
    ],
    downloadedJobIds: [id],
    lastSeenJobId: id,
  })

  const server = await importServer(mediaDir)

  await server.startLibraryVerification()

  const backups = await server.listCatalogBackups()
  const backup = backups.find((entry) => entry.reason === "before-library-verification")
  assert.equal(Boolean(backup), true)
  const backupCatalog = await readCatalogFromDbFile(path.join(mediaDir, "_catalog_backups", backup.file))
  const verifiedCatalog = await readCatalog(mediaDir)

  assert.equal(backupCatalog.items[0].sha256, undefined)
  assert.equal(typeof verifiedCatalog.items[0].sha256, "string")
})

test("auto sync trigger runs an incremental sync without API auth", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-auto-sync-"))
  await writeCatalog(mediaDir, {
    items: [],
    downloadedJobIds: [],
    lastSeenJobId: null,
  })

  const server = await importServer(mediaDir, {
    AUTO_SYNC_ENABLED: "true",
  })

  const result = await server.triggerAutoSync("test")
  const catalog = await readCatalog(mediaDir)

  assert.deepEqual(result, { started: true, reason: "test" })
  assert.equal(catalog.lastRun.mode, "incremental")
  assert.equal(server.autoSyncState.lastReason, "test")
  assert.equal(server.autoSyncState.lastError, null)
})

test("auto sync trigger skips while another library job is running", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-auto-sync-skip-"))
  const server = await importServer(mediaDir, {
    AUTO_SYNC_ENABLED: "true",
  })

  server.syncState.running = true
  const result = await server.triggerAutoSync("test")
  server.syncState.running = false

  assert.deepEqual(result, { started: false, reason: "sync-running" })
  assert.equal(server.autoSyncState.lastSkipReason, "sync-running")
  assert.equal(typeof server.autoSyncState.lastSkippedAt, "string")
})
