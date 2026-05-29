import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { setThumbnailProcessRunnerForTests } from "../src/thumbnails.ts"
import { fakeBearerToken, imageDataUrl, importServer, jsonResponse, readCatalog, writeCatalog } from "./helpers/server.js"

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

test("creation templates save all reusable settings and apply submission overrides without mutation", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-template-save-"))
  const sourceId = "20202020-2020-4202-8202-202020202020"
  const jobId = "21212121-2121-4212-8212-212121212121"
  await writeCatalog(mediaDir, {
    items: [
      {
        id: sourceId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/source.png",
        createdAt: 1779893300,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: sourceId,
  })

  let submitBody = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      submitBody = JSON.parse(options.body)
      return jsonResponse({ job_id: jobId })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const template = await server.saveCreateTemplateFromRequest({
      label: "Reusable video",
      type: "video",
      settings: {
        modeId: "custom-video",
        source: {
          kind: "catalog",
          itemId: sourceId,
        },
        params: {
          prompt: "template prompt",
          quality: "720p-4",
        },
      },
    })

    await server.createMediaJob({
      templateId: template.id,
      params: {
        prompt: "override prompt",
      },
    })
    const registry = await server.loadCreateTemplateRegistry()
    const details = await server.getCreationDetails(jobId)

    assert.equal(template.settings.source.itemId, sourceId)
    assert.equal(submitBody.input_url, "https://assets.example/source.png")
    assert.equal(submitBody.prompt, "override prompt")
    assert.equal(registry.templates[0].settings.params.prompt, "template prompt")
    assert.equal(details.creation.templateId, template.id)
    assert.equal(details.creation.params.prompt, "override prompt")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("downloaded media keeps the template association for preview lookup", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-template-preview-"))
  const jobId = "22222222-2222-4222-8222-222222222222"
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      return jsonResponse({ job_id: jobId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${jobId}`) {
      return jsonResponse({
        id: jobId,
        type: "video",
        prompt: "template associated",
        status: "done",
        resolution: "720p",
        duration: 4,
        output_url: "https://assets.example/template-associated.mp4",
        created_at: 1779893400,
      })
    }

    if (href === "https://assets.example/template-associated.mp4") {
      return new Response(new Uint8Array([2, 2, 2, 2]), {
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
    const template = await server.saveCreateTemplateFromRequest({
      label: "Preview template",
      type: "video",
      settings: {
        modeId: "custom-video",
        source: {
          kind: "url",
          url: "https://assets.example/source.png",
        },
        params: {
          prompt: "template associated",
          quality: "720p-4",
        },
      },
    })

    await server.createMediaJob({ templateId: template.id })
    await server.downloadCreateJob(jobId)
    const catalog = await readCatalog(mediaDir)
    const registry = await server.getCreateTemplateRegistryResponse()
    const item = catalog.items.find((entry) => entry.id === jobId)
    const previewTemplate = registry.templates.find((entry) => entry.id === template.id)

    assert.equal(item.templateId, template.id)
    assert.equal(item.templateLabel, template.label)
    assert.equal(previewTemplate.previews.length, 1)
    assert.equal(previewTemplate.previews[0].id, jobId)
  } finally {
    globalThis.fetch = originalFetch
  }
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
    const history = await server.getCreations(new URLSearchParams())
    const details = await server.getCreationDetails(jobId)

    assert.equal(created.jobId, jobId)
    assert.equal(submitBody.image_base64, sourceDataUrl)
    assert.equal(submitBody.input_url, undefined)
    assert.equal(submitBody.seed, null)
    assert.equal(
      history.creations.some((creation) => creation.jobId === jobId && creation.status === "done"),
      true,
    )
    assert.equal(details.creation.downloadedItemId, jobId)
    assert.equal(
      details.events.some((event) => event.status === "pending"),
      true,
    )
    assert.equal(
      details.events.some((event) => event.message === "Downloaded to library."),
      true,
    )
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

test("creation history persists submitted jobs across server imports", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-history-persist-"))
  const jobId = "17171717-1717-4171-8171-171717171717"
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      return jsonResponse({ job_id: jobId })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "make it cinematic",
      },
    })

    const reimported = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const history = await reimported.getCreations(new URLSearchParams())
    const details = await reimported.getCreationDetails(jobId)

    assert.equal(history.creations[0].jobId, jobId)
    assert.equal(history.creations[0].status, "pending")
    assert.equal(details.creation.params.prompt, "make it cinematic")
    assert.equal(details.creation.source.url, "https://assets.example/source.png")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("failed creation submissions are recorded with reusable settings", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-history-failed-"))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      return new Response(JSON.stringify({ error: "submission_failed" }), {
        status: 500,
        headers: {
          "content-type": "application/json",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })

    await assert.rejects(
      () =>
        server.createMediaJob({
          modeId: "custom-image",
          source: {
            kind: "url",
            url: "https://assets.example/source.png",
          },
          params: {
            prompt: "failed prompt",
          },
        }),
      /submission_failed/,
    )

    const history = await server.getCreations(new URLSearchParams())
    const failed = history.creations.find((creation) => creation.status === "error")
    const copied = await server.duplicateCreation(failed.id)

    assert.equal(failed.error, "submission_failed")
    assert.equal(failed.params.prompt, "failed prompt")
    assert.equal(copied.form.modeId, "custom-image")
    assert.equal(copied.form.params.prompt, "failed prompt")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("creation refresh updates active jobs and imports upstream history", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-history-refresh-"))
  const activeId = "18181818-1818-4181-8181-181818181818"
  const importedId = "19191919-1919-4191-8191-191919191919"
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      return jsonResponse({ job_id: activeId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${activeId}`) {
      return jsonResponse({
        id: activeId,
        type: "edit",
        prompt: "active now done",
        status: "done",
        output_url: "https://assets.example/active.png",
        input_url: "https://assets.example/source.png",
        created_at: 1779893100,
      })
    }

    if (href.includes("/api/jobs") && href.includes("page=1")) {
      return jsonResponse({
        results: [
          {
            id: importedId,
            type: "video",
            prompt: "history import",
            status: "processing",
            output_url: null,
            input_url: "https://assets.example/history-source.png",
            resolution: "720p",
            duration: 4,
            created_at: 1779893200,
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
    await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "active now done",
      },
    })

    const refreshed = await server.refreshCreations({ pageLimit: 2 })
    const activeDetails = await server.getCreationDetails(activeId)
    const importedDetails = await server.getCreationDetails(importedId)

    assert.equal(refreshed.refreshed, 1)
    assert.equal(refreshed.imported, 1)
    assert.equal(activeDetails.creation.status, "done")
    assert.equal(activeDetails.creation.outputUrl, "https://assets.example/active.png")
    assert.equal(importedDetails.creation.status, "processing")
    assert.equal(importedDetails.creation.modeId, "custom-video")
  } finally {
    globalThis.fetch = originalFetch
  }
})
