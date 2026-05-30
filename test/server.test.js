import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { parseCreateApiResponse } from "../src/server/create-schemas.ts"
import { parseGeneratePornJob } from "../src/server/schemas.ts"
import { ensureVideoThumbnail, getThumbnailRelativePath, setThumbnailProcessRunnerForTests } from "../src/thumbnails.ts"
import { fakeBearerToken, importServer, jsonResponse, PNG_BYTES, readCatalog, writeCatalog } from "./helpers/server.js"

test("job response parser normalizes upstream aliases at the boundary", () => {
  const job = parseGeneratePornJob({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "user_alias",
    negativePrompt: "alias negative",
    outputUrl: "https://assets.example/alias.mp4",
    inputUrl: "https://assets.example/input.png",
    createdAt: 1779893000,
    externalTaskId: "task_alias",
    status: "done",
  })

  assert.equal(job.user_id, "user_alias")
  assert.equal(job.negative_prompt, "alias negative")
  assert.equal(job.output_url, "https://assets.example/alias.mp4")
  assert.equal(job.input_url, "https://assets.example/input.png")
  assert.equal(job.created_at, 1779893000)
  assert.equal(job.external_task_id, "task_alias")
  assert.equal(parseGeneratePornJob({ id: 123 }), null)
})

test("create API response parser narrows nullable upstream fields", () => {
  const parsed = parseCreateApiResponse({
    job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    error: null,
  })

  assert.equal(parsed.jobId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
  assert.equal(parsed.error, null)
})

test("video thumbnail helper writes predictable poster path with a stubbed ffmpeg runner", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-thumb-helper-"))
  const localFile = "2026-05-26/2026-05-26_video_99999999-9999-4999-8999-999999999999.mp4"
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([1, 2, 3]))

  const result = await ensureVideoThumbnail(mediaDir, localFile, {
    runProcess: async (command, args) => {
      assert.equal(command, "ffmpeg")
      assert.equal(args.includes(path.join(mediaDir, localFile)), true)
      assert.equal(args.at(-1).endsWith(".tmp.jpg"), true)
      await writeFile(args.at(-1), new Uint8Array([9, 8, 7]))
    },
  })

  assert.equal(result.thumbnailFile, "_thumbnails/2026-05-26/2026-05-26_video_99999999-9999-4999-8999-999999999999.jpg")
  assert.equal(getThumbnailRelativePath(localFile), result.thumbnailFile)
  assert.equal(existsSync(path.join(mediaDir, result.thumbnailFile)), true)
})

test("video thumbnail helper degrades gracefully when ffmpeg is unavailable", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-thumb-missing-"))
  const localFile = "2026-05-26/2026-05-26_video_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4"
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([1, 2, 3]))

  const result = await ensureVideoThumbnail(mediaDir, localFile, {
    ffmpegPath: "missing-ffmpeg",
    runProcess: async () => {
      const error = new Error("spawn missing-ffmpeg ENOENT")
      error.code = "ENOENT"
      throw error
    },
  })

  assert.equal(result.thumbnailFile, null)
  assert.match(result.error, /missing-ffmpeg is not available/)
})

test("sync downloads known missing catalog files without API auth", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-known-"))
  const id = "11111111-1111-4111-8111-111111111111"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/result_00.mp4",
        createdAt: 1779769825,
        prompt: "known prompt",
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: id,
    lastRun: {
      fullCoverageCompletedAt: new Date().toISOString(),
    },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://assets.example/result_00.mp4")
    return new Response(new Uint8Array([1, 2, 3]), {
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
    assert.equal(item.localFile, `2026-05-26/2026-05-26_video_${id}.mp4`)
    assert.equal(item.size, 3)
    assert.equal(item.contentType, "video/mp4")
    assert.equal(catalog.downloadedJobIds.includes(id), true)
    assert.equal(existsSync(path.join(mediaDir, item.localFile)), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("incremental sync refreshes a previously seen pending job before stopping", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-pending-refresh-"))
  const id = "13131313-1313-4131-8131-131313131313"
  const createdAt = Math.floor(Date.now() / 1000)
  const createdDate = new Date(createdAt * 1000).toISOString().slice(0, 10)
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "processing",
        outputUrl: null,
        createdAt,
        prompt: "pending prompt",
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: id,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id,
            user_id: "user_test",
            type: "video",
            prompt: "pending prompt",
            negative_prompt: "",
            status: "done",
            duration: 8,
            output_url: "https://assets.example/pending_now_done.mp4",
            input_url: null,
            created_at: createdAt,
            external_task_id: "task_pending",
            shared: false,
            favorited: false,
            error: null,
          },
        ],
      })
    }

    if (href === "https://assets.example/pending_now_done.mp4") {
      return new Response(new Uint8Array([1, 3, 1, 3]), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })

    await server.startSync({ incremental: true, forceFullCoverageIfMissing: false })

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)

    assert.equal(server.syncState.downloaded, 1)
    assert.equal(item.status, "done")
    assert.equal(item.duration, 8)
    assert.equal(item.downloadError, null)
    assert.equal(item.localFile, `${createdDate}/${createdDate}_video_${id}.mp4`)
    assert.equal(catalog.downloadedJobIds.includes(id), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("incremental sync scans past previous boundary for older pending completions", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-pending-past-boundary-"))
  const boundaryId = "41414141-4141-4141-8141-414141414141"
  const pendingId = "42424242-4242-4242-8242-424242424242"
  const createdAt = Math.floor(Date.now() / 1000)
  const pendingDate = new Date((createdAt - 10) * 1000).toISOString().slice(0, 10)
  await writeCatalog(mediaDir, {
    items: [
      {
        id: boundaryId,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/already_seen.mp4",
        localFile: `2026-05-26/2026-05-26_video_${boundaryId}.mp4`,
        createdAt,
      },
      {
        id: pendingId,
        type: "video",
        status: "processing",
        outputUrl: null,
        createdAt: createdAt - 10,
        prompt: "older pending prompt",
      },
    ],
    downloadedJobIds: [boundaryId],
    lastSeenJobId: boundaryId,
    lastRun: {
      fullCoverageCompletedAt: new Date().toISOString(),
    },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id: boundaryId,
            user_id: "user_test",
            type: "video",
            prompt: "already seen",
            status: "done",
            output_url: "https://assets.example/already_seen.mp4",
            created_at: createdAt,
          },
        ],
      })
    }

    if (href.includes("/api/jobs") && href.includes("page=2")) {
      return jsonResponse({
        results: [
          {
            id: pendingId,
            user_id: "user_test",
            type: "video",
            prompt: "older pending prompt",
            negative_prompt: "",
            status: "done",
            duration: 8,
            output_url: "https://assets.example/older_pending_done.mp4",
            input_url: null,
            created_at: createdAt - 10,
            external_task_id: "task_older_pending",
            shared: false,
            favorited: false,
            error: null,
          },
        ],
      })
    }

    if (href.includes("/api/jobs") && href.includes("page=3")) {
      return jsonResponse({ results: [] })
    }

    if (href === "https://assets.example/older_pending_done.mp4") {
      return new Response(new Uint8Array([4, 2, 4, 2]), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })

    await server.startSync({ incremental: true, forceFullCoverageIfMissing: false })

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === pendingId)

    assert.equal(server.syncState.currentPage, 3)
    assert.equal(server.syncState.downloaded, 1)
    assert.equal(item.status, "done")
    assert.equal(item.localFile, `${pendingDate}/${pendingDate}_video_${pendingId}.mp4`)
    assert.equal(catalog.downloadedJobIds.includes(pendingId), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("incremental sync runs full coverage when the last full scan is older than an hour", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-hourly-full-"))
  const presentId = "51515151-5151-4151-8151-515151515151"
  const deletedId = "52525252-5252-4252-8252-525252525252"
  const presentFile = `2026-05-26/2026-05-26_edit_${presentId}.jpg`
  const deletedFile = `2026-05-26/2026-05-26_edit_${deletedId}.jpg`
  await mkdir(path.join(mediaDir, "2026-05-26"), { recursive: true })
  await writeFile(path.join(mediaDir, presentFile), PNG_BYTES)
  await writeFile(path.join(mediaDir, deletedFile), PNG_BYTES)
  await writeCatalog(mediaDir, {
    items: [
      {
        id: presentId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/present.png",
        localFile: presentFile,
        createdAt: 1779769925,
      },
      {
        id: deletedId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/deleted.png",
        localFile: deletedFile,
        createdAt: 1779769825,
      },
    ],
    downloadedJobIds: [presentId, deletedId],
    lastSeenJobId: presentId,
    lastRun: {
      fullCoverageCompletedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id: presentId,
            user_id: "user_test",
            type: "edit",
            prompt: "still present",
            status: "done",
            output_url: "https://assets.example/present.png",
            created_at: 1779769925,
          },
        ],
      })
    }

    if (href.includes("/api/jobs") && href.includes("page=2")) {
      return jsonResponse({ results: [] })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })

    await server.startSync({ incremental: true })

    const catalog = await readCatalog(mediaDir)
    const present = catalog.items.find((entry) => entry.id === presentId)
    const deleted = catalog.items.find((entry) => entry.id === deletedId)

    assert.equal(server.syncState.currentPage, 2)
    assert.equal(present.remoteDeletedAt, undefined)
    assert.equal(deleted.remoteDeleteStatus, "deleted")
    assert.equal(typeof deleted.remoteDeletedAt, "string")
    assert.equal(catalog.lastRun.fullCoverageScan, true)
    assert.equal(catalog.lastRun.fullCoverageCompleted, true)
    assert.equal(catalog.lastRun.remoteDeleted, 1)
    assert.equal(typeof catalog.lastRun.fullCoverageCompletedAt, "string")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("sync removes no-output media records after an hour", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-expired-no-output-"))
  const staleId = "61616161-6161-4161-8161-616161616161"
  const freshId = "62626262-6262-4262-8262-626262626262"
  const now = Date.now()
  await writeCatalog(mediaDir, {
    items: [
      {
        id: staleId,
        type: "video",
        status: "processing",
        outputUrl: null,
        createdAtIso: new Date(now - 61 * 60 * 1000).toISOString(),
      },
      {
        id: freshId,
        type: "video",
        status: "processing",
        outputUrl: null,
        createdAtIso: new Date(now - 5 * 60 * 1000).toISOString(),
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: null,
  })

  const server = await importServer(mediaDir, {
    GENERATEPORN_AUTHORIZATION: "",
    GENERATEPORN_COOKIE: "",
  })

  await server.startSync({ incremental: true })

  const catalog = await readCatalog(mediaDir)

  assert.equal(
    catalog.items.some((entry) => entry.id === staleId),
    false,
  )
  assert.equal(
    catalog.items.some((entry) => entry.id === freshId),
    true,
  )
  assert.equal(catalog.lastRun.prunedExpiredNoMediaItems, 1)
})

test("sync does not use pending jobs as the incremental stop marker", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-pending-marker-"))
  const pendingId = "14141414-1414-4141-8141-141414141414"
  const doneId = "15151515-1515-4151-8151-151515151515"

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id: pendingId,
            user_id: "user_test",
            type: "video",
            prompt: "still rendering",
            negative_prompt: "",
            status: "processing",
            output_url: null,
            input_url: null,
            created_at: 1779769925,
            external_task_id: "task_pending_marker",
            shared: false,
            favorited: false,
            error: null,
          },
          {
            id: doneId,
            user_id: "user_test",
            type: "edit",
            prompt: "ready image",
            negative_prompt: "",
            status: "done",
            output_url: "https://assets.example/ready_marker.png",
            input_url: null,
            created_at: 1779769825,
            external_task_id: "task_done_marker",
            shared: false,
            favorited: false,
            error: null,
          },
        ],
      })
    }

    if (href.includes("/api/jobs") && href.includes("page=2")) {
      return jsonResponse({ results: [] })
    }

    if (href === "https://assets.example/ready_marker.png") {
      return new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })

    await server.startSync({ incremental: false })

    const catalog = await readCatalog(mediaDir)
    const pending = catalog.items.find((entry) => entry.id === pendingId)
    const done = catalog.items.find((entry) => entry.id === doneId)

    assert.equal(pending, undefined)
    assert.equal(done.localFile, `2026-05-26/2026-05-26_edit_${doneId}.jpg`)
    assert.equal(catalog.lastSeenJobId, doneId)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("downloaded mp4 catalog items include generated poster metadata and API poster URLs", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-poster-"))
  const id = "12121212-1212-4121-8121-121212121212"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/poster_00.mp4",
        createdAt: 1779769825,
        prompt: "poster prompt",
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: id,
  })

  const restoreRunner = setThumbnailProcessRunnerForTests(async (_command, args) => {
    await writeFile(args.at(-1), new Uint8Array([8, 8, 8]))
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://assets.example/poster_00.mp4")
    return new Response(new Uint8Array([4, 5, 6, 7]), {
      status: 200,
      headers: {
        "content-type": "video/mp4",
      },
    })
  }

  try {
    const server = await importServer(mediaDir)

    await server.startCatalogDownload({ mode: "download-missing" })

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)
    const data = await server.getItems(new URLSearchParams())
    const publicItem = data.items.find((entry) => entry.id === id)

    assert.equal(item.thumbnailFile, `_thumbnails/2026-05-26/2026-05-26_video_${id}.jpg`)
    assert.equal(item.thumbnailError, null)
    assert.equal(existsSync(path.join(mediaDir, item.thumbnailFile)), true)
    assert.equal(publicItem.posterUrl, `/media/_thumbnails/2026-05-26/2026-05-26_video_${id}.jpg`)
  } finally {
    globalThis.fetch = originalFetch
    restoreRunner()
  }
})

test("thumbnail generation action creates posters for existing downloaded videos", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-existing-thumbs-"))
  const id = "13131313-1313-4131-8131-131313131313"
  const localFile = `2026-05-26/2026-05-26_video_${id}.mp4`
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([1, 2, 3]))
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/existing_00.mp4",
        localFile,
        createdAt: 1779769825,
      },
    ],
    downloadedJobIds: [id],
    lastSeenJobId: id,
  })

  const restoreRunner = setThumbnailProcessRunnerForTests(async (_command, args) => {
    await writeFile(args.at(-1), new Uint8Array([7, 7, 7]))
  })

  try {
    const server = await importServer(mediaDir)

    assert.deepEqual(
      server.getThumbnailGenerationQueue((await readCatalog(mediaDir)).items).map((item) => item.id),
      [id],
    )

    await server.startThumbnailGeneration()

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)

    assert.equal(server.syncState.mode, "generate-thumbnails")
    assert.equal(server.syncState.downloaded, 1)
    assert.equal(item.thumbnailFile, `_thumbnails/2026-05-26/2026-05-26_video_${id}.jpg`)
    assert.equal(item.thumbnailError, null)
    assert.equal(existsSync(path.join(mediaDir, item.thumbnailFile)), true)
  } finally {
    restoreRunner()
  }
})

test("sync scans stubbed API responses and downloads completed media", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-api-"))
  const id = "22222222-2222-4222-8222-222222222222"
  const failedId = "33333333-3333-4333-8333-333333333333"
  await writeCatalog(mediaDir, {
    items: [],
    downloadedJobIds: [],
    lastSeenJobId: null,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id,
            user_id: "user_test",
            type: "edit",
            prompt: "api prompt",
            negative_prompt: "",
            status: "done",
            output_url: "https://assets.example/result_00.png",
            input_url: null,
            created_at: 1779769825,
            external_task_id: "task_test",
            shared: false,
            favorited: false,
            error: null,
          },
          {
            id: failedId,
            user_id: "user_test",
            type: "video",
            prompt: "failed prompt",
            status: "failed",
            output_url: null,
            created_at: 1779769800,
          },
        ],
      })
    }

    if (href.includes("/api/jobs") && href.includes("page=2")) {
      return jsonResponse({ results: [] })
    }

    if (href === "https://assets.example/result_00.png") {
      return new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })

    await server.startSync({ incremental: false })

    const catalog = await readCatalog(mediaDir)
    const downloaded = catalog.items.find((entry) => entry.id === id)
    const failed = catalog.items.find((entry) => entry.id === failedId)

    assert.equal(server.syncState.scanned, 2)
    assert.equal(server.syncState.downloaded, 1)
    assert.equal(catalog.items.length, 1)
    assert.equal(catalog.lastSeenJobId, id)
    assert.equal(downloaded.localFile, `2026-05-26/2026-05-26_edit_${id}.jpg`)
    assert.equal(downloaded.contentType, "image/jpeg")
    assert.ok(downloaded.size > 0)
    assert.equal(failed, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
