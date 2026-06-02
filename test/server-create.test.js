import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import sharp from "sharp"

import { setThumbnailProcessRunnerForTests } from "../src/thumbnails.ts"
import {
  PNG_BYTES,
  deferred,
  fakeBearerToken,
  imageDataUrl,
  importServer,
  jsonResponse,
  readCatalog,
  writeCatalog,
} from "./helpers/server.js"

test("creation request shaping uses image_base64 for uploads and input_url for URLs", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-shape-"))
  const server = await importServer(mediaDir)
  const modes = (await server.getCreateModes()).modes
  const customVideo = modes.find((mode) => mode.id === "custom-video")
  const customImage = modes.find((mode) => mode.id === "custom-image")
  const textToImage = modes.find((mode) => mode.id === "text-to-image")
  const imageVideo = modes.find((mode) => mode.id === "custom-image-video")
  const nudifyVideo = modes.find((mode) => mode.id === "nudify-video")
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
  const spicyVideo = server.buildCreateApiRequest(customVideo, dataSource, {
    prompt: "spicy motion",
    modelId: "wan2.7-i2v-spicy",
    quality: "1080p-15",
  }).body
  const imageUrl = server.buildCreateApiRequest(customImage, urlSource, {
    prompt: "edit this",
  }).body
  const imageUpload = server.buildCreateApiRequest(customImage, dataSource, {
    prompt: "edit upload",
  }).body
  const templateUpload = server.buildCreateApiRequest(template, dataSource).body
  const templateUrl = server.buildCreateApiRequest(template, urlSource).body
  const generatedImage = server.buildCreateApiRequest(textToImage, null, {
    prompt: "make a poster",
    quality: "1:1",
  }).body

  assert.equal(videoUpload.image_base64, imageDataUrl())
  assert.equal(videoUpload.input_url, undefined)
  assert.equal(videoUpload.modelId, "wan2.7-i2v")
  assert.equal(videoUpload.resolution, "1080p")
  assert.equal(videoUpload.duration, 10)
  assert.equal(customVideo.fields.find((field) => field.name === "modelId").options.length, 5)
  assert.equal(customVideo.fields.find((field) => field.name === "quality").default, "1080p-15")
  assert.deepEqual(
    {
      modelId: spicyVideo.modelId,
      resolution: spicyVideo.resolution,
      duration: spicyVideo.duration,
      seed: spicyVideo.seed,
      hasSource: Boolean(spicyVideo.image_base64),
    },
    {
      modelId: "wan2.7-i2v-spicy",
      resolution: "1080p",
      duration: 15,
      seed: null,
      hasSource: true,
    },
  )
  assert.equal(imageVideo.label, "Image Edit + Video")
  assert.equal(nudifyVideo.label, "Nudify + Video")
  assert.equal(videoUpload.seed, null)
  assert.equal(imageUrl.input_url, "https://assets.example/source.png")
  assert.equal(imageUrl.image_base64, undefined)
  assert.equal(imageUrl.seed, undefined)
  assert.equal(imageUpload.image_base64, imageDataUrl())
  assert.equal(imageUpload.input_url, undefined)
  assert.equal(imageUpload.seed, undefined)
  assert.equal(templateUpload.image_base64, imageDataUrl())
  assert.equal(templateUpload.negative_prompt, "template negative")
  assert.equal(templateUrl.input_url, "https://assets.example/source.png")
  assert.equal(templateUrl.image_base64, undefined)
  assert.equal(generatedImage.input_url, undefined)
  assert.equal(generatedImage.image_base64, undefined)
  assert.equal(generatedImage.prompt, "make a poster")
  assert.equal(generatedImage.modelId, "qwen-image-2.0-pro")
  assert.equal(generatedImage.aspectRatio, "1:1")

  const textToVideo = modes.find((mode) => mode.id === "text-to-video")
  const generatedVideo = server.buildCreateApiRequest(textToVideo, null, {
    prompt: "make a video",
    modelId: "wan2.7-t2v",
    quality: "1080p-15",
  }).body
  assert.deepEqual(generatedVideo, {
    prompt: "make a video",
    modelId: "wan2.7-t2v",
    resolution: "1080p",
    duration: 15,
    seed: null,
  })
  assert.throws(
    () =>
      server.buildCreateApiRequest(customVideo, urlSource, {
        prompt: "bad combo",
        modelId: "wan2.2-i2v-plus",
        quality: "720p-4",
      }),
    /Unsupported video quality/,
  )
})

test("template selection does not force a combo workflow when mode is video only", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-template-mode-override-"))
  const jobId = "62626262-6262-4626-8626-626262626262"
  const submitted = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    submitted.push({ url: String(url), body: options.body ? JSON.parse(String(options.body)) : null })

    if (String(url) === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      return jsonResponse({ job_id: jobId })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const template = await server.saveCreateTemplateFromRequest({
      label: "Edit then animate",
      type: "combo",
      settings: {
        modeId: "custom-image-video",
        source: {
          kind: "url",
          url: "https://assets.example/source.png",
        },
        params: {
          prompt: "video prompt",
          quality: "720p-4",
        },
      },
      workflow: [
        {
          modeId: "custom-image",
          params: {
            prompt: "image edit prompt",
          },
        },
        {
          modeId: "custom-video",
          params: {
            prompt: "video prompt",
            quality: "720p-4",
          },
        },
      ],
    })

    const response = await server.createMediaJob({
      templateId: template.id,
      modeId: "custom-video",
    })
    await server.runCreationQueueBackgroundJob()
    const details = await server.getCreationDetails(jobId)

    assert.equal(response.queued, true)
    assert.equal(response.modeId, "custom-video")
    assert.equal(submitted.length, 1)
    assert.equal(submitted[0].url, "https://api.generateporn.ai/api/jobs/video")
    assert.equal(submitted[0].body.prompt, "video prompt")
    assert.equal(submitted[0].body.input_url, "https://assets.example/source.png")
    assert.equal(details.creation.templateId, template.id)
    assert.equal(details.creation.modeId, "custom-video")
    assert.equal(details.creation.workflow, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("creation requests refresh auth in the browser once after an upstream token failure", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-auth-refresh-"))
  const jobId = "63636363-6363-4636-8636-636363636363"
  const initialToken = fakeBearerTokenWithClaim("initial")
  const refreshedToken = fakeBearerTokenWithClaim("refreshed")
  const authorizations = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    const headers = new Headers(options.headers)
    authorizations.push(headers.get("authorization"))

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      if (authorizations.length === 1) {
        return new Response(JSON.stringify({ error: "expired_token" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      return jsonResponse({ job_id: jobId })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: initialToken,
    })
    let refreshes = 0
    server.authBrowser.refreshHeadless = async () => {
      refreshes += 1
      server.acceptAuthorization(refreshedToken, "auth-browser")
      return { ...server.authBrowser.getStatus(), status: "connected" }
    }

    const result = await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "refresh auth once",
      },
    })
    await server.runCreationQueueBackgroundJob()

    assert.equal(result.queued, true)
    assert.equal(refreshes, 1)
    assert.deepEqual(authorizations, [initialToken, refreshedToken])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("creation requests report a second auth failure without another automatic refresh", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-auth-refresh-failed-"))
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    requests += 1

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      return new Response(JSON.stringify({ error: `expired_token_${requests}` }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerTokenWithClaim("initial"),
    })
    let refreshes = 0
    server.authBrowser.refreshHeadless = async () => {
      refreshes += 1
      server.acceptAuthorization(fakeBearerTokenWithClaim("refreshed"), "auth-browser")
      return { ...server.authBrowser.getStatus(), status: "connected" }
    }

    const queued = await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "refresh auth fails",
      },
    })
    await server.runCreationQueueBackgroundJob()
    const details = await server.getCreationDetails(queued.jobId)

    assert.equal(requests, 2)
    assert.equal(refreshes, 1)
    assert.equal(details.creation.status, "error")
    assert.match(details.creation.error, /expired_token_2/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("creation source resolver prefers catalog output URL and falls back to local image data", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-source-"))
  const remoteId = "14141414-1414-4141-8141-141414141414"
  const localId = "15151515-1515-4151-8151-151515151515"
  const localFile = `2026-05-27/2026-05-27_edit_${localId}.png`
  await mkdir(path.dirname(path.join(mediaDir, localFile)), { recursive: true })
  await writeFile(path.join(mediaDir, localFile), PNG_BYTES)
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
  assert.equal(local.value.startsWith("data:image/jpeg;base64,"), true)
})

test("creation submits are accepted locally before upstream queue dispatch", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-async-submit-"))
  const jobIds = ["67676767-6767-4767-8767-676767676767", "68686868-6868-4768-8768-686868686868", "69696969-6969-4769-8769-696969696969"]
  const submitted = []
  const releaseSubmissions = deferred()
  let timeout = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      submitted.push(JSON.parse(String(options.body)))
      const jobId = jobIds[submitted.length - 1]
      if (submitted.length === jobIds.length) {
        if (timeout) clearTimeout(timeout)
        releaseSubmissions.resolve()
      }
      await releaseSubmissions.promise
      return jsonResponse({ job_id: jobId })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    server.setMediaGenerationConcurrencyLimit(3)

    const queued = await Promise.all(
      ["first", "second", "third"].map((prompt) =>
        server.createMediaJob({
          modeId: "custom-image",
          source: { kind: "url", url: `https://assets.example/${prompt}.png` },
          params: { prompt },
        }),
      ),
    )
    const historyBeforeDispatch = await server.getCreations(new URLSearchParams())

    assert.equal(submitted.length, 0)
    assert.deepEqual(
      queued.map((creation) => creation.queued),
      [true, true, true],
    )
    assert.equal(historyBeforeDispatch.creations.filter((creation) => creation.status === "queued").length, 3)

    timeout = setTimeout(() => {
      releaseSubmissions.reject(new Error("Queued creations did not dispatch concurrently."))
    }, 500)
    await server.runCreationQueueBackgroundJob()

    assert.equal(submitted.length, 3)
    assert.deepEqual(submitted.map((body) => body.prompt).toSorted(), ["first", "second", "third"])
  } finally {
    if (timeout) clearTimeout(timeout)
    releaseSubmissions.resolve()
    globalThis.fetch = originalFetch
  }
})

test("creation submits are accepted locally before auth refresh", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-async-auth-"))
  const jobId = "70707070-7070-4770-8770-707070707070"
  const releaseRefresh = deferred()
  const originalFetch = globalThis.fetch
  let refreshes = 0
  let upstreamRequests = 0
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      upstreamRequests += 1
      return jsonResponse({ job_id: jobId })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir)
    server.authBrowser.refreshHeadless = async () => {
      refreshes += 1
      await releaseRefresh.promise
      server.acceptAuthorization(fakeBearerToken(), "auth-browser")
      return { ...server.authBrowser.getStatus(), status: "connected" }
    }

    const queued = await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "accept locally before auth",
      },
    })
    const details = await server.getCreationDetails(queued.jobId)

    assert.equal(queued.queued, true)
    assert.equal(details.creation.status, "queued")
    assert.equal(refreshes, 0)
    assert.equal(upstreamRequests, 0)

    const dispatched = server.runCreationQueueBackgroundJob()
    await Promise.resolve()
    assert.equal(refreshes, 1)
    assert.equal(upstreamRequests, 0)

    releaseRefresh.resolve()
    await dispatched
    assert.equal(upstreamRequests, 1)
  } finally {
    releaseRefresh.resolve()
    globalThis.fetch = originalFetch
  }
})

test("text-to-image creation submits without a source image", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-text-to-image-"))
  const jobId = "57575757-5757-4575-8575-575757575757"
  const originalFetch = globalThis.fetch
  let submittedBody = null
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.generateporn.ai/api/jobs/text2image")
    submittedBody = JSON.parse(String(options.body))
    return jsonResponse({ job_id: jobId })
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const response = await server.createMediaJob({
      modeId: "text-to-image",
      params: {
        prompt: "make a portrait",
        quality: "4:3",
      },
      source: null,
    })
    await server.runCreationQueueBackgroundJob()

    assert.equal(response.queued, true)
    assert.equal(response.modeId, "text-to-image")
    assert.deepEqual(submittedBody, {
      prompt: "make a portrait",
      modelId: "qwen-image-2.0-pro",
      aspectRatio: "4:3",
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("text-to-video creation submits model video without a source image", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-text-to-video-"))
  const jobId = "59595959-5959-4595-8595-595959595959"
  const originalFetch = globalThis.fetch
  let submittedBody = null
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.generateporn.ai/api/jobs/video")
    submittedBody = JSON.parse(String(options.body))
    return jsonResponse({ job_id: jobId })
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const response = await server.createMediaJob({
      modeId: "text-to-video",
      params: {
        prompt: "make a cinematic shot",
        modelId: "wan2.7-t2v",
        quality: "720p-8",
      },
      source: null,
    })
    await server.runCreationQueueBackgroundJob()

    assert.equal(response.queued, true)
    assert.equal(response.modeId, "text-to-video")
    assert.deepEqual(submittedBody, {
      prompt: "make a cinematic shot",
      modelId: "wan2.7-t2v",
      resolution: "720p",
      duration: 8,
      seed: null,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("creation requests queue per account when the configured generation limit is full", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-queue-"))
  const job1 = "71717171-7171-4717-8717-717171717171"
  const job2 = "72727272-7272-4727-8727-727272727272"
  const submitted = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      submitted.push(JSON.parse(String(options.body)))
      return jsonResponse({ job_id: submitted.length === 1 ? job1 : job2 })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${job1}`) {
      return jsonResponse({
        id: job1,
        type: "edit",
        prompt: "first",
        status: "done",
        output_url: "https://assets.example/first.png",
        created_at: 1779893000,
      })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${job2}`) {
      return jsonResponse({
        id: job2,
        type: "edit",
        prompt: "second",
        status: "pending",
        created_at: 1779893001,
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    server.setMediaGenerationConcurrencyLimit(1)

    const first = await server.createMediaJob({
      modeId: "custom-image",
      source: { kind: "url", url: "https://assets.example/source-1.png" },
      params: { prompt: "first" },
    })
    const queued = await server.createMediaJob({
      modeId: "custom-image",
      source: { kind: "url", url: "https://assets.example/source-2.png" },
      params: { prompt: "second" },
    })
    await server.runCreationQueueBackgroundJob()

    assert.equal(first.queued, true)
    assert.equal(queued.queued, true)
    assert.equal(submitted.length, 1)

    await server.pollCreateJob(job1)
    await server.runCreationQueueBackgroundJob()
    const queuedDetails = await server.getCreationDetails(queued.jobId)

    assert.equal(submitted.length, 2)
    assert.equal(queuedDetails.creation.jobId, job2)
    assert.equal(queuedDetails.creation.status, "pending")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("auto account creation requests balance across queued account load", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-auto-account-"))
  const server = await importServer(mediaDir)
  server.acceptAuthorization(fakeBearerToken({ account: "primary" }), "auth-browser", "primary@example.com")
  server.acceptAuthorization(fakeBearerToken({ account: "backup" }), "auth-browser", "backup@example.com")

  const queued = []
  for (const prompt of ["first", "second", "third", "fourth"]) {
    queued.push(
      await server.createMediaJob({
        modeId: "text-to-image",
        params: { prompt },
      }),
    )
  }

  const counts = new Map()
  for (const creation of queued) {
    const details = await server.getCreationDetails(creation.jobId)
    const accountEmail = details.creation.accountEmail
    counts.set(accountEmail, (counts.get(accountEmail) || 0) + 1)
  }

  assert.deepEqual(
    counts,
    new Map([
      ["primary@example.com", 2],
      ["backup@example.com", 2],
    ]),
  )
})

test("rate limited creation responses show queued retry with exponential backoff", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-rate-limit-"))
  const jobId = "73737373-7373-4737-8737-737373737373"
  const submitted = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    if (href === "https://api.generateporn.ai/api/jobs/edit" && options.method === "POST") {
      submitted.push(JSON.parse(String(options.body)))
      if (submitted.length === 1) {
        return jsonResponse({
          id: "772d7629-0073-4bb4-a237-ca5c2650a351",
          status: "failed",
          error: "Throttling.RateQuota: Requests rate limit exceeded, please try again later.",
        })
      }

      return jsonResponse({ job_id: jobId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${jobId}`) {
      return jsonResponse({
        id: jobId,
        type: "edit",
        prompt: "retry me",
        status: "pending",
        created_at: 1779893002,
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    const created = await server.createMediaJob({
      modeId: "custom-image",
      source: { kind: "url", url: "https://assets.example/source.png" },
      params: { prompt: "retry me" },
    })
    await server.runCreationQueueBackgroundJob()
    const queuedDetails = await server.getCreationDetails(created.jobId)

    assert.equal(created.queued, true)
    assert.equal(queuedDetails.creation.lastRateLimitedAt !== null, true)
    assert.match(queuedDetails.creation.error, /rate limit/i)
    assert.equal(queuedDetails.creation.status, "queued")
    assert.equal(queuedDetails.creation.queueAttempt, 1)
    assert.equal(submitted.length, 1)

    await server.runCreationQueueBackgroundJob()
    assert.equal(submitted.length, 1)

    const db = new DatabaseSync(path.join(mediaDir, "catalog.sqlite"))
    try {
      db.prepare("UPDATE creation_jobs SET queue_not_before = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), created.jobId)
    } finally {
      db.close()
    }

    await server.runCreationQueueBackgroundJob()
    const retriedDetails = await server.getCreationDetails(created.jobId)
    assert.equal(submitted.length, 2)
    assert.equal(retriedDetails.creation.jobId, jobId)
    assert.equal(retriedDetails.creation.status, "pending")
    assert.equal(retriedDetails.creation.queueAttempt, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("uploaded images are resized and compressed before create submission", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-image-resize-"))
  const jobId = "58585858-5858-4585-8585-585858585858"
  const sourceBytes = await sharp({
    create: {
      width: 3200,
      height: 1800,
      channels: 4,
      background: { r: 20, g: 100, b: 180, alpha: 0.8 },
    },
  })
    .png()
    .toBuffer()
  const sourceDataUrl = `data:image/png;base64,${sourceBytes.toString("base64")}`
  const originalFetch = globalThis.fetch
  let submittedBody = null
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.generateporn.ai/api/jobs/edit")
    submittedBody = JSON.parse(String(options.body))
    return jsonResponse({ job_id: jobId })
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "upload",
        dataUrl: sourceDataUrl,
      },
      params: {
        prompt: "resize this",
      },
    })
    await server.runCreationQueueBackgroundJob()
    const details = await server.getCreationDetails(jobId)
    const submittedDataUrl = submittedBody.image_base64
    const submittedBytes = Buffer.from(submittedDataUrl.split(",")[1], "base64")
    const metadata = await sharp(submittedBytes).metadata()

    assert.equal(submittedDataUrl.startsWith("data:image/jpeg;base64,"), true)
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, 2400)
    assert.equal(metadata.height, 1350)
    assert.equal(details.creation.source.contentType, "image/jpeg")
    assert.equal(details.creation.source.size, submittedBytes.byteLength)
  } finally {
    globalThis.fetch = originalFetch
  }
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
  const overrideSourceId = "30303030-3030-4303-8303-303030303030"
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
      {
        id: overrideSourceId,
        type: "edit",
        status: "done",
        outputUrl: "https://assets.example/override-source.png",
        createdAt: 1779893301,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: overrideSourceId,
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
      source: {
        kind: "catalog",
        itemId: overrideSourceId,
      },
      params: {
        prompt: "override prompt",
      },
    })
    await server.runCreationQueueBackgroundJob()
    const registry = await server.loadCreateTemplateRegistry()
    const details = await server.getCreationDetails(jobId)

    assert.equal(template.settings.source.itemId, sourceId)
    assert.equal(submitBody.input_url, "https://assets.example/override-source.png")
    assert.equal(submitBody.prompt, "override prompt")
    assert.equal(registry.templates[0].settings.params.prompt, "template prompt")
    assert.equal(details.creation.templateId, template.id)
    assert.equal(details.creation.source.itemId, overrideSourceId)
    assert.equal(details.creation.params.prompt, "override prompt")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("template previews use matching media prompts as the association", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-template-preview-"))
  const jobId = "22222222-2222-4222-8222-222222222222"
  const promptLinkedId = "23232323-2323-4232-8232-232323232323"
  await writeCatalog(mediaDir, {
    items: [
      {
        id: promptLinkedId,
        type: "video",
        status: "done",
        prompt: "template associated",
        outputUrl: "https://assets.example/prompt-linked.mp4",
        createdAt: 1779893500,
      },
    ],
    downloadedJobIds: [],
    lastSeenJobId: promptLinkedId,
  })
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
    await server.runCreationQueueBackgroundJob()
    await server.downloadCreateJob(jobId)
    const catalog = await readCatalog(mediaDir)
    const registry = await server.getCreateTemplateRegistryResponse()
    const item = catalog.items.find((entry) => entry.id === jobId)
    const previewTemplate = registry.templates.find((entry) => entry.id === template.id)

    assert.equal(item.templateId, template.id)
    assert.equal(item.templateLabel, template.label)
    assert.deepEqual(
      previewTemplate.previews.map((preview) => preview.id),
      [promptLinkedId, jobId],
    )
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
    items: [
      {
        id: "older-existing-item",
        type: "video",
        status: "done",
        outputUrl: "https://assets.example/older.mp4",
        localFile: "2026-05-01/older.mp4",
        createdAt: 1777600000000,
      },
    ],
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
    await server.runCreationQueueBackgroundJob()
    const pendingView = await server.getItems(new URLSearchParams())
    await server.pollCreateJob(jobId)
    const completedView = await server.getItems(new URLSearchParams())
    const downloaded = await server.downloadCreateJob(jobId)
    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === jobId)
    const history = await server.getCreations(new URLSearchParams())
    const details = await server.getCreationDetails(jobId)

    assert.equal(created.queued, true)
    assert.equal(
      pendingView.items.some((entry) => entry.id === jobId && entry.status === "pending" && entry.createModeId === "custom-video"),
      true,
    )
    assert.equal(
      completedView.items.some((entry) => entry.id === jobId && entry.status === "done" && entry.outputUrl && !entry.localFile),
      true,
    )
    assert.equal(completedView.items[0].id, jobId)
    assert.equal(submitBody.image_base64.startsWith("data:image/jpeg;base64,"), true)
    assert.notEqual(submitBody.image_base64, sourceDataUrl)
    assert.equal(submitBody.input_url, undefined)
    assert.equal(submitBody.modelId, "wan2.7-i2v")
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
    assert.deepEqual(downloaded.item.createParams, {
      prompt: "animate this",
      quality: "720p-4",
    })
    assert.equal(item.createModeId, "custom-video")
    assert.deepEqual(item.createParams, {
      prompt: "animate this",
      quality: "720p-4",
    })
    assert.equal(item.sourceKind, "upload")
    assert.equal(item.localFile, `2026-05-27/2026-05-27_video_${jobId}.mp4`)
    assert.equal(item.thumbnailFile, `_thumbnails/2026-05-27/2026-05-27_video_${jobId}.jpg`)
    assert.equal(catalog.downloadedJobIds.includes(jobId), true)
  } finally {
    globalThis.fetch = originalFetch
    restoreRunner()
  }
})

test("creation queue downloads completed creations into the catalog", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-auto-download-"))
  const jobId = "19191919-1919-4191-8191-191919191919"
  const originalFetch = globalThis.fetch
  const restoreRunner = setThumbnailProcessRunnerForTests(async (_command, args) => {
    await writeFile(args.at(-1), new Uint8Array([7, 7, 7]))
  })

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      return jsonResponse({ job_id: jobId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${jobId}`) {
      return jsonResponse({
        id: jobId,
        type: "video",
        prompt: "auto download this",
        output_url: "https://assets.example/auto-download.mp4",
        status: "done",
        created_at: 1779893000,
      })
    }

    if (href === "https://assets.example/auto-download.mp4") {
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

    await server.createMediaJob({
      modeId: "text-to-video",
      params: {
        prompt: "auto download this",
        quality: "720p-5",
      },
    })
    await server.runCreationQueueBackgroundJob()
    await server.pollCreateJob(jobId)
    await server.runCreationQueueBackgroundJob()

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === jobId)
    const details = await server.getCreationDetails(jobId)

    assert.equal(item.localFile, `2026-05-27/2026-05-27_video_${jobId}.mp4`)
    assert.equal(item.thumbnailFile, `_thumbnails/2026-05-27/2026-05-27_video_${jobId}.jpg`)
    assert.equal(details.creation.downloadedItemId, jobId)
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
    await server.runCreationQueueBackgroundJob()

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

    const queued = await server.createMediaJob({
      modeId: "custom-image",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "failed prompt",
      },
    })
    await server.runCreationQueueBackgroundJob()

    const history = await server.getCreations(new URLSearchParams())
    const failed = history.creations.find((creation) => creation.id === queued.jobId)
    const copied = await server.duplicateCreation(failed.id)
    const copiedWithSource = await server.duplicateCreation(failed.id, { includeSource: true })

    assert.equal(failed.error, "submission_failed")
    assert.equal(failed.params.prompt, "failed prompt")
    assert.equal(copied.form.modeId, "custom-image")
    assert.equal(copied.form.params.prompt, "failed prompt")
    assert.equal(copied.form.source, undefined)
    assert.equal(copiedWithSource.form.source.url, "https://assets.example/source.png")
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
    await server.runCreationQueueBackgroundJob()

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

test("active creation polling does not rewrite unchanged pending jobs", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-poll-stable-"))
  const activeId = "20202020-2020-4202-8202-202020202020"
  const activeJob = {
    id: activeId,
    type: "video",
    prompt: "still rendering",
    status: "processing",
    output_url: null,
    input_url: "https://assets.example/source.png",
    resolution: "720p",
    duration: 4,
    created_at: 1779893300,
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      return jsonResponse({ job_id: activeId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${activeId}`) {
      return jsonResponse(activeJob)
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    await server.createMediaJob({
      modeId: "custom-video",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "still rendering",
      },
    })
    await server.runCreationQueueBackgroundJob()

    await server.getCreations(new URLSearchParams("status=all&refresh=true"))
    const firstDetails = await server.getCreationDetails(activeId)
    await server.getCreations(new URLSearchParams("status=all&refresh=true"))
    const secondDetails = await server.getCreationDetails(activeId)

    assert.equal(secondDetails.creation.status, "processing")
    assert.equal(secondDetails.creation.updatedAt, firstDetails.creation.updatedAt)
    assert.equal(secondDetails.events.length, firstDetails.events.length)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("failed app-created pending media remains visible in the gallery after polling", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-create-failed-gallery-"))
  const activeId = "21212121-2121-4212-8212-212121212121"
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)

    if (href === "https://api.generateporn.ai/api/jobs/video" && options.method === "POST") {
      return jsonResponse({ job_id: activeId })
    }

    if (href === `https://api.generateporn.ai/api/jobs/${activeId}`) {
      return jsonResponse({
        id: activeId,
        type: "video",
        prompt: "failed visible",
        status: "failed",
        error: "upstream failed",
        output_url: null,
        input_url: "https://assets.example/source.png",
        created_at: Math.floor(Date.now() / 1000),
      })
    }

    throw new Error(`Unexpected fetch: ${href}`)
  }

  try {
    const server = await importServer(mediaDir, {
      GENERATEPORN_AUTHORIZATION: fakeBearerToken(),
    })
    await server.createMediaJob({
      modeId: "custom-video",
      source: {
        kind: "url",
        url: "https://assets.example/source.png",
      },
      params: {
        prompt: "failed visible",
      },
    })
    await server.runCreationQueueBackgroundJob()

    await server.getCreations(new URLSearchParams("status=all&refresh=true"))
    const items = await server.getItems(new URLSearchParams())

    assert.equal(
      items.items.some((item) => item.id === activeId && item.status === "failed"),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

function fakeBearerTokenWithClaim(claim) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      claim,
    }),
  ).toString("base64url")

  return `Bearer ${header}.${payload}.signature`
}
