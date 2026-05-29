import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { parseCreateApiResponse } from "../src/server/create-schemas.ts"
import { parseGeneratePornJob } from "../src/server/schemas.ts"
import { ensureVideoThumbnail, getThumbnailRelativePath, setThumbnailProcessRunnerForTests } from "../src/thumbnails.ts"
import { fakeBearerToken, importServer, jsonResponse, readCatalog, writeCatalog } from "./helpers/server.js"

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
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "video",
        status: "processing",
        outputUrl: null,
        createdAt: 1779769825,
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
            created_at: 1779769825,
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

    await server.startSync({ incremental: true })

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === id)

    assert.equal(server.syncState.downloaded, 1)
    assert.equal(item.status, "done")
    assert.equal(item.duration, 8)
    assert.equal(item.downloadError, null)
    assert.equal(item.localFile, `2026-05-26/2026-05-26_video_${id}.mp4`)
    assert.equal(catalog.downloadedJobIds.includes(id), true)
  } finally {
    globalThis.fetch = originalFetch
  }
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
      return new Response(new Uint8Array([1, 5, 1, 5]), {
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

    assert.equal(pending.status, "processing")
    assert.equal(pending.localFile, undefined)
    assert.equal(pending.downloadError, undefined)
    assert.equal(done.localFile, `2026-05-26/2026-05-26_edit_${doneId}.png`)
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
      return new Response(new Uint8Array([9, 8, 7, 6]), {
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
    assert.equal(catalog.items.length, 2)
    assert.equal(catalog.lastSeenJobId, id)
    assert.equal(downloaded.localFile, `2026-05-26/2026-05-26_edit_${id}.png`)
    assert.equal(downloaded.size, 4)
    assert.equal(failed.status, "failed")
    assert.equal(failed.localFile, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
