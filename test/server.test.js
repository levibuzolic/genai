import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { ensureVideoThumbnail, getThumbnailRelativePath, setThumbnailProcessRunnerForTests } from "../src/thumbnails.js"

const SERVER_PATH = new URL("../src/server.js", import.meta.url)

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

test("catalog migrates from legacy JSON into SQLite storage", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-sqlite-"))
  const id = "10101010-1010-4010-8010-101010101010"
  await writeCatalog(mediaDir, {
    items: [
      {
        id,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/sqlite.png",
        createdAt: 1779769825,
        prompt: "sqlite prompt",
      },
    ],
    downloadedJobIds: [],
    orphanFiles: [],
    lastSeenJobId: id,
    updatedAt: "2026-05-27T00:00:00.000Z",
  })

  const server = await importServer(mediaDir)
  const catalog = await server.getItems(new URLSearchParams())
  const stored = await readCatalog(mediaDir)

  assert.equal(existsSync(path.join(mediaDir, "catalog.sqlite")), true)
  assert.equal(existsSync(path.join(mediaDir, "catalog.json")), false)
  assert.equal((await readdir(path.join(mediaDir, "_legacy_json"))).some((name) => name.endsWith("_migrated_catalog.json")), true)
  assert.equal(catalog.items[0].id, id)
  assert.equal(stored.items[0].prompt, "sqlite prompt")
  assert.equal(stored.lastSeenJobId, id)
})

test("legacy catalog JSON is archived without overwriting existing SQLite data", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-sqlite-ignore-"))
  const sqliteId = "20202020-2020-4020-8020-202020202020"
  const jsonId = "21212121-2121-4121-8121-212121212121"
  const server = await importServer(mediaDir)

  await server.getItems(new URLSearchParams())
  await writeCatalog(mediaDir, {
    items: [
      {
        id: sqliteId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/sqlite-source.png",
        createdAt: 1779769825,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: sqliteId,
  })
  await writeFile(path.join(mediaDir, "catalog.json"), `${JSON.stringify({
    items: [
      {
        id: jsonId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/json-source.png",
        createdAt: 1779769826,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: jsonId,
  }, null, 2)}\n`)

  await server.getItems(new URLSearchParams())

  const stored = await readCatalog(mediaDir)
  const archived = await readdir(path.join(mediaDir, "_legacy_json"))

  assert.equal(existsSync(path.join(mediaDir, "catalog.json")), false)
  assert.equal(stored.items.length, 1)
  assert.equal(stored.items[0].id, sqliteId)
  assert.equal(archived.some((name) => name.endsWith("_ignored_catalog.json")), true)
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

test("creation request shaping uses image_base64 for uploads and input_url for URLs", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-shape-"))
  const server = await importServer(mediaDir)
  const modes = (await server.getCreateModes()).modes
  const customVideo = modes.find((mode) => mode.id === "custom-video")
  const customImage = modes.find((mode) => mode.id === "custom-image")
  const template = {
    id: "test-template",
    label: "Test Template",
    kind: "template",
    endpoint: "video",
    fixed: {
      prompt: "template prompt",
      negativePrompt: "template negative",
      resolution: "720p",
      duration: 4,
    },
  }
  const dataSource = {
    value: imageDataUrl(),
    isDataUrl: true,
  }
  const urlSource = {
    value: "https://assets.example/source.png",
    isDataUrl: false,
  }

  const videoUpload = server.buildCreateApiRequest(customVideo, dataSource, {
    prompt: "animate this",
    quality: "1080p-10",
  }).body
  const imageUrl = server.buildCreateApiRequest(customImage, urlSource, {
    prompt: "edit this",
  }).body
  const templateUpload = server.buildCreateApiRequest(template, dataSource).body
  const templateUrl = server.buildCreateApiRequest(template, urlSource).body

  assert.equal(videoUpload.image_base64, imageDataUrl())
  assert.equal(videoUpload.input_url, undefined)
  assert.equal(videoUpload.resolution, "1080p")
  assert.equal(videoUpload.duration, 10)
  assert.equal(videoUpload.seed, null)
  assert.equal(imageUrl.input_url, "https://assets.example/source.png")
  assert.equal(imageUrl.image_base64, undefined)
  assert.equal(imageUrl.seed, null)
  assert.equal(templateUpload.image_base64, imageDataUrl())
  assert.equal(templateUpload.negative_prompt, "template negative")
  assert.equal(templateUrl.input_url, "https://assets.example/source.png")
  assert.equal(templateUrl.image_base64, undefined)
})

test("creation request shaping blocks unsafe age and consent language", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-safety-"))
  const server = await importServer(mediaDir)
  const customImage = (await server.getCreateModes()).modes.find((mode) => mode.id === "custom-image")

  assert.throws(
    () =>
      server.buildCreateApiRequest(
        customImage,
        {
          value: imageDataUrl(),
          isDataUrl: true,
        },
        {
          prompt: "portrait of someone 17 years old",
        },
      ),
    /disallowed age or consent language/,
  )

  assert.throws(
    () =>
      server.buildCreateApiRequest(
        customImage,
        {
          value: imageDataUrl(),
          isDataUrl: true,
        },
        {
          prompt: "forced scene",
        },
      ),
    /disallowed age or consent language/,
  )
})

test("creation source resolver prefers catalog output URL and falls back to local image data", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-source-"))
  const remoteId = "14141414-1414-4141-8141-141414141414"
  const localId = "15151515-1515-4151-8151-151515151515"
  const localFile = `2026-05-27/2026-05-27_edit_${localId}.png`
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), new Uint8Array([1, 2, 3]))
  await writeCatalog(mediaDir, {
    items: [
      {
        id: remoteId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/remote.png",
        createdAt: 1779890000,
      },
      {
        id: localId,
        type: "edit",
        status: "done",
        localFile,
        createdAt: 1779890001,
      },
    ],
    downloadedJobIds: [localId],
    lastSeenJobId: localId,
  })

  const server = await importServer(mediaDir)
  const remote = await server.resolveCreateSource({
    kind: "catalog",
    itemId: remoteId,
  })
  const local = await server.resolveCreateSource({
    kind: "catalog",
    itemId: localId,
  })

  assert.equal(remote.isDataUrl, false)
  assert.equal(remote.value, "https://assets.example/remote.png")
  assert.equal(local.isDataUrl, true)
  assert.equal(local.value, "data:image/png;base64,AQID")
})

test("template import reads prompt fields from mocked API history", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-template-import-"))
  const seedJobId = "fb62d491-b377-4c24-92ac-98e02e305bce"
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id: seedJobId,
            type: "video",
            prompt: "template prompt from history",
            negative_prompt: "template negative from history",
            resolution: "720p",
            duration: 4,
            status: "done",
            output_url: "https://assets.example/template.mp4",
            created_at: 1779890851,
          },
        ],
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const template = await server.importCreateTemplateFromHistory({
      jobId: seedJobId,
      label: "Blowjob",
    })
    const registry = await server.loadCreateTemplateRegistry()
    const mode = (await server.getCreateModes()).modes.find((entry) => entry.id === "blowjob")

    assert.equal(template.id, "blowjob")
    assert.equal(template.prompt, "template prompt from history")
    assert.equal(template.negativePrompt, "template negative from history")
    assert.equal(registry.templates.length, 1)
    assert.equal(mode.disabled, undefined)
    assert.equal(mode.fixed.prompt, "template prompt from history")
    assert.equal(mode.seedJobId, seedJobId)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("create template registry migrates from legacy JSON into SQLite", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-template-sqlite-"))
  await writeFile(
    path.join(mediaDir, "create-templates.json"),
    `${JSON.stringify({
      templates: [
        {
          id: "legacy-template",
          label: "Legacy Template",
          prompt: "legacy template prompt",
          endpoint: "video",
          mediaType: "video",
        },
      ],
      updatedAt: "2026-05-27T00:00:00.000Z",
    }, null, 2)}\n`,
  )

  const server = await importServer(mediaDir)
  const registry = await server.loadCreateTemplateRegistry()

  assert.equal(existsSync(path.join(mediaDir, "catalog.sqlite")), true)
  assert.equal(existsSync(path.join(mediaDir, "create-templates.json")), false)
  assert.equal((await readdir(path.join(mediaDir, "_legacy_json"))).some((name) => name.endsWith("_migrated_create-templates.json")), true)
  assert.equal(registry.templates.length, 1)
  assert.equal(registry.templates[0].id, "legacy-template")
})

test("creation job submit and download use mocked API and merge into catalog", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-job-"))
  const jobId = "16161616-1616-4161-8161-161616161616"
  const sourceDataUrl = imageDataUrl()
  let submitBody = null
  await writeCatalog(mediaDir, {
    items: [],
    downloadedJobIds: [],
    lastSeenJobId: null,
  })

  const restoreRunner = setThumbnailProcessRunnerForTests(async (_command, args) => {
    await writeFile(args.at(-1), new Uint8Array([8, 8, 8]))
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      submitBody = JSON.parse(options.body)
      return jsonResponse({ job_id: jobId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${jobId}`) {
      return jsonResponse({
        id: jobId,
        type: "video",
        input_url: null,
        prompt: "animate this",
        negative_prompt: null,
        resolution: "720p",
        duration: 4,
        seed: null,
        external_task_id: "task_create",
        output_url: "https://assets.example/create.mp4",
        status: "done",
        error: null,
        created_at: 1779893000,
      })
    }

    if (href === "https://assets.example/create.mp4") {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
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
    const created = await server.createMediaJob({
      modeId: "custom-video",
      source: {
        kind: "upload",
        dataUrl: sourceDataUrl,
      },
      params: {
        prompt: "animate this",
        quality: "720p-4",
      },
    })
    const downloaded = await server.downloadCreateJob(jobId)
    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === jobId)

    assert.equal(created.jobId, jobId)
    assert.equal(submitBody.image_base64, sourceDataUrl)
    assert.equal(submitBody.input_url, undefined)
    assert.equal(submitBody.seed, null)
    assert.equal(downloaded.item.id, jobId)
    assert.equal(item.createModeId, "custom-video")
    assert.equal(item.sourceKind, "upload")
    assert.equal(item.localFile, `2026-05-27/2026-05-27_video_${jobId}.mp4`)
    assert.equal(item.thumbnailFile, `_thumbnails/2026-05-27/2026-05-27_video_${jobId}.jpg`)
    assert.equal(catalog.downloadedJobIds.includes(jobId), true)
  } finally {
    globalThis.fetch = originalFetch
    restoreRunner()
  }
})

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
      return new Response(new Uint8Array([2]), {
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
      new Response(new Uint8Array([7, 8, 9]), {
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
    assert.equal(firstItem.localFile, `2026-05-26/2026-05-26_edit_${firstId}.png`)
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
  assert.equal(catalog.items.length, 1)
  assert.equal(catalog.items[0].id, id)
  assert.equal(
    (await server.listCatalogBackups()).some((entry) => entry.reason === "before-restore"),
    true,
  )
  await assert.rejects(() => server.restoreCatalogBackup("../catalog.json"), /Invalid backup filename/)
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
  const backupCatalog = JSON.parse(await readFile(path.join(mediaDir, "_catalog_backups", backup.file), "utf8"))
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

async function importServer(mediaDir, env = {}) {
  const previousEnv = {
    MEDIA_DIR: process.env.MEDIA_DIR,
    PORT: process.env.PORT,
    SYNC_DELAY_MS: process.env.SYNC_DELAY_MS,
    AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED,
    AUTO_SYNC_INTERVAL_MS: process.env.AUTO_SYNC_INTERVAL_MS,
    AUTO_SYNC_STARTUP_DELAY_MS: process.env.AUTO_SYNC_STARTUP_DELAY_MS,
    GENERATEPORN_AUTHORIZATION: process.env.GENERATEPORN_AUTHORIZATION,
    GENERATEPORN_COOKIE: process.env.GENERATEPORN_COOKIE,
    GENERATEPORN_PAGE_LIMIT: process.env.GENERATEPORN_PAGE_LIMIT,
    GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT: process.env.GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT,
  }

  process.env.MEDIA_DIR = mediaDir
  process.env.PORT = "0"
  process.env.SYNC_DELAY_MS = "0"
  process.env.AUTO_SYNC_ENABLED = env.AUTO_SYNC_ENABLED || "false"
  process.env.AUTO_SYNC_INTERVAL_MS = env.AUTO_SYNC_INTERVAL_MS || "3600000"
  process.env.AUTO_SYNC_STARTUP_DELAY_MS = env.AUTO_SYNC_STARTUP_DELAY_MS || "10000"
  process.env.GENERATEPORN_PAGE_LIMIT = "3"
  process.env.GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT = "3"
  process.env.GENERATEPORN_AUTHORIZATION = env.GENERATEPORN_AUTHORIZATION || ""
  process.env.GENERATEPORN_COOKIE = env.GENERATEPORN_COOKIE || ""

  const imported = await import(`${SERVER_PATH.href}?test=${Date.now()}-${Math.random()}`)

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return imported
}

async function writeCatalog(mediaDir, catalog) {
  const dbPath = path.join(mediaDir, "catalog.sqlite")

  if (!existsSync(dbPath)) {
    await writeFile(path.join(mediaDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`)
    return
  }

  const db = new DatabaseSync(dbPath)
  const normalized = {
    items: Array.isArray(catalog.items) ? catalog.items : [],
    downloadedJobIds: Array.isArray(catalog.downloadedJobIds) ? catalog.downloadedJobIds : [],
    orphanFiles: Array.isArray(catalog.orphanFiles) ? catalog.orphanFiles : [],
    lastSeenJobId: catalog.lastSeenJobId || null,
    updatedAt: catalog.updatedAt || null,
    lastRun: catalog.lastRun || null,
  }

  try {
    db.exec("BEGIN IMMEDIATE")
    db.exec("DELETE FROM media_items")
    db.exec("DELETE FROM downloaded_job_ids")
    db.exec("DELETE FROM orphan_files")

    const insertItem = db.prepare("INSERT INTO media_items (id, item_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
    for (const item of normalized.items) {
      insertItem.run(item.id, JSON.stringify(item), Number(item.createdAt || 0), item.updatedAt || null)
    }

    const insertDownloaded = db.prepare("INSERT INTO downloaded_job_ids (id, position) VALUES (?, ?)")
    normalized.downloadedJobIds.forEach((id, index) => insertDownloaded.run(id, index))

    const insertOrphan = db.prepare("INSERT INTO orphan_files (local_file, file_json) VALUES (?, ?)")
    for (const file of normalized.orphanFiles) {
      if (file?.localFile) insertOrphan.run(file.localFile, JSON.stringify(file))
    }

    const upsertMeta = db.prepare(`
      INSERT INTO catalog_meta (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `)
    upsertMeta.run("lastSeenJobId", JSON.stringify(normalized.lastSeenJobId))
    upsertMeta.run("updatedAt", JSON.stringify(normalized.updatedAt))
    upsertMeta.run("lastRun", JSON.stringify(normalized.lastRun))
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  } finally {
    db.close()
  }
}

async function readCatalog(mediaDir) {
  const dbPath = path.join(mediaDir, "catalog.sqlite")

  if (!existsSync(dbPath)) {
    return JSON.parse(await readFile(path.join(mediaDir, "catalog.json"), "utf8"))
  }

  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const metaRows = db.prepare("SELECT key, value_json FROM catalog_meta").all()
    const meta = new Map(metaRows.map((row) => [row.key, JSON.parse(row.value_json)]))

    return {
      items: db.prepare("SELECT item_json FROM media_items ORDER BY created_at DESC, id ASC").all().map((row) => JSON.parse(row.item_json)),
      downloadedJobIds: db.prepare("SELECT id FROM downloaded_job_ids ORDER BY position ASC").all().map((row) => row.id),
      orphanFiles: db.prepare("SELECT file_json FROM orphan_files ORDER BY local_file ASC").all().map((row) => JSON.parse(row.file_json)),
      lastSeenJobId: meta.get("lastSeenJobId") || null,
      updatedAt: meta.get("updatedAt") || null,
      lastRun: meta.get("lastRun") || null,
    }
  } finally {
    db.close()
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function listenOnRandomPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, () => {
      server.off("error", reject)
      resolve({
        port: server.address().port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()))
          }),
      })
    })
  })
}

function postJson(port, pathname, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        const chunks = []

        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null,
          })
        })
      },
    )

    request.on("error", reject)
    request.end(payload)
  })
}

function requestRaw(port, pathname, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers,
      },
      (response) => {
        const chunks = []

        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        })
      },
    )

    request.on("error", reject)
    request.end()
  })
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  })
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

function imageDataUrl() {
  return "data:image/png;base64,AQID"
}
