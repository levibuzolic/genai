import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { setThumbnailProcessRunnerForTests } from "../src/thumbnails.ts"
import { importServer, readCatalog } from "./helpers/server.js"

test("Playbox sync stores collections, downloads primary media, and projects items into the catalog", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-playbox-sync-"))
  const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
  const collectionId = "6a1cf290af0850a33d300f06"
  const expires = Math.floor(Date.now() / 1000) + 1800
  const outputUrl = `https://playbox-uploads.b-cdn.net/media2/user/${collectionId}.mp4?token=secret&expires=${expires}`
  const posterUrl = `https://playbox-uploads.b-cdn.net/media2/user/poster-${collectionId}.jpg?token=secret&expires=${expires}`
  const audioUrl = `https://playbox-videos.b-cdn.net/user/audio-${collectionId}.mp3?token=secret&expires=${expires}`
  const inputUrl = `https://playbox-uploads.b-cdn.net/media2/user/input-${collectionId}.jpg?token=secret&expires=${expires}`
  const requested = []

  const restoreRunner = setThumbnailProcessRunnerForTests(async (_command, args) => {
    const output = args.at(-1)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, Buffer.from("poster"))
    return { code: 0, stderr: "" }
  })

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    requested.push({ href, authorization: new Headers(options.headers).get("authorization") })

    if (href === "https://api.playbox.com/api/model/collections?page=1&filter=ALL") {
      assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${token}`)
      return Response.json({
        message: "Collections found",
        data: [
          {
            _id: collectionId,
            name: "Example Video",
            user: "user-id",
            model: "model-id",
            modelName: "PB_EXAMPLE",
            modelType: "GENERATE_VIDEO",
            status: "COMPLETED",
            isPublic: false,
            isPinned: true,
            customPrompt: "sync this playbox item",
            input: {
              type: "IMAGE",
              image: {
                url: inputUrl,
                resizedImage: {
                  url: inputUrl.replace("input-", "resized-"),
                  width: 832,
                  height: 1248,
                },
              },
            },
            midProcessMedia: {
              audio: {
                url: audioUrl,
              },
            },
            output: {
              type: "VIDEO",
              resolution: "MEDIUM",
              fps: 30,
              videoDuration: 10,
              video: {
                url: outputUrl,
                posterUrl,
              },
            },
            createdAt: "2026-06-01T02:46:40.669Z",
            updatedAt: "2026-06-01T02:52:21.216Z",
          },
        ],
        maxReached: true,
        total: 1,
        perPage: 30,
        page: "1",
      })
    }

    if (href === outputUrl) {
      return new Response(Buffer.from("video bytes"), { headers: { "content-type": "video/mp4" } })
    }

    if (href === audioUrl) {
      return new Response(Buffer.from("audio bytes"), { headers: { "content-type": "audio/mpeg" } })
    }

    if (href === posterUrl) {
      return new Response(Buffer.from("poster bytes"), { headers: { "content-type": "image/jpeg" } })
    }

    throw new Error(`Unexpected fetch ${href}`)
  }

  try {
    const server = await importServer(mediaDir, { PLAYBOX_AUTHORIZATION: token })
    await server.startPlayboxSync()

    const catalog = await readCatalog(mediaDir)
    const item = catalog.items.find((entry) => entry.id === `playbox-${collectionId}`)
    assert.ok(item)
    assert.equal(item.provider, "playbox")
    assert.equal(item.collectionId, collectionId)
    assert.equal(item.status, "done")
    assert.equal(item.type, "video")
    assert.equal(item.prompt, "sync this playbox item")
    assert.equal(item.localFile, `playbox/2026-06-01/2026-06-01_output-video_${collectionId}.mp4`)
    assert.equal(item.contentType, "video/mp4")
    assert.equal(item.outputUrl, `https://playbox-uploads.b-cdn.net/media2/user/${collectionId}.mp4`)
    assert.equal(item.inputUrl, `https://playbox-uploads.b-cdn.net/media2/user/input-${collectionId}.jpg?expires=${expires}`)
    assert.equal(item.thumbnailFile, `playbox/2026-06-01/2026-06-01_poster_${collectionId}.jpg`)
    assert.equal(catalog.lastRun.provider, "playbox")
    assert.equal(catalog.lastRun.downloaded, 3)

    const publicItems = await server.getItems(new URLSearchParams("provider=playbox"))
    assert.equal(publicItems.items[0].outputUrl, null)
    assert.equal(publicItems.items[0].inputUrl, null)
    assert.equal(publicItems.items[0].posterUrl, `/media/playbox/2026-06-01/2026-06-01_poster_${collectionId}.jpg`)

    const db = new DatabaseSync(path.join(mediaDir, "catalog.sqlite"), { readOnly: true })
    try {
      const collections = db.prepare("SELECT id, collection_json FROM playbox_collections").all()
      assert.equal(collections.length, 1)
      assert.equal(collections[0].id, collectionId)
      assert.equal(collections[0].collection_json.includes("token=secret"), false)

      const assets = db.prepare("SELECT kind, local_file, download_error FROM playbox_assets ORDER BY kind").all()
      assert.deepEqual(
        assets.map((asset) => asset.kind),
        ["audio", "input-image", "output-video", "poster", "resized-input-image"],
      )
      assert.equal(assets.find((asset) => asset.kind === "output-video").local_file, item.localFile)
      assert.equal(assets.find((asset) => asset.kind === "audio").local_file?.endsWith(".mp3"), true)
      assert.equal(assets.find((asset) => asset.kind === "input-image").local_file, null)
    } finally {
      db.close()
    }

    assert.equal(
      requested.some((entry) => entry.href === outputUrl),
      true,
    )
    assert.equal(
      requested.some((entry) => entry.href === audioUrl),
      true,
    )
    assert.equal(
      requested.some((entry) => entry.href === posterUrl),
      true,
    )
    assert.equal(
      requested.some((entry) => entry.href === inputUrl),
      false,
    )
  } finally {
    restoreRunner()
  }
})

test("Playbox sync is registered as an automatic background worker", async () => {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-playbox-background-"))
  const server = await importServer(mediaDir, {
    AUTO_SYNC_ENABLED: "true",
    BACKGROUND_WORKERS_ENABLED: "true",
  })

  const worker = server.getBackgroundWorkerStatus()["playbox-sync"]

  assert.ok(worker)
  assert.equal(worker.enabled, true)
  assert.equal(worker.intervalMs, 3600000)
  assert.equal(worker.label, "Playbox sync")
})

function fakeJwt(payload) {
  return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".")
}
