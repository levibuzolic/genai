import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { chromium } from "@playwright/test"

const SERVER_PATH = new URL("../src/server.ts", import.meta.url)
const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")

test("browser UI smoke covers filters, menus, lazy media, and stable card rendering", async (t) => {
  const browser = await launchChromeOrSkip(t)
  if (!browser) return

  const mediaDir = await mkdtemp(path.join(os.tmpdir(), "media-library-ui-"))
  await writeFixtureCatalog(mediaDir)
  const imported = await importServer(mediaDir)
  const listener = await listenOnRandomPort(imported.server)
  const page = await browser.newPage({
    viewport: {
      width: 1512,
      height: 828,
    },
  })

  try {
    await page.goto(`http://127.0.0.1:${listener.port}`)
    await page.waitForSelector(".card", { timeout: 10000 })

    assert.equal(await page.locator(".card").count(), 48)
    assert.equal(await page.locator("#emptyState").count(), 0)
    assert.deepEqual(await visibleTopActions(page), ["Sync", "View", "Settings"])
    assert.deepEqual(await page.locator(".summaryCard span").allTextContents(), ["Missing", "Unverified", "Favorited", "Orphans"])

    await page.locator("#templateViewButton").click()
    await page.waitForSelector(".templateBrowser", { timeout: 5000 })
    assert.equal(await page.getByRole("heading", { name: "Templates", exact: true }).isVisible(), true)
    await page.getByRole("button", { name: "Library" }).click()
    await page.waitForSelector(".card", { timeout: 10000 })

    await openViewOptions(page)
    await page.locator("#mediaBlurButton").click()
    await page.keyboard.press("Escape")
    assert.notEqual(
      await page
        .locator(".preview img")
        .first()
        .evaluate((node) => getComputedStyle(node).filter),
      "none",
    )

    assert.equal(await page.locator(".inspector-panel").count(), 0)
    await page.getByRole("button", { name: "Settings" }).click()
    await page.waitForSelector("#settingsDialog", { timeout: 5000 })
    assert.deepEqual(await page.locator(".settingsSidebar button").allTextContents(), ["Library", "Account", "Backups"])
    assert.equal(await page.getByRole("button", { name: "Full rescan" }).isVisible(), true)
    assert.equal(await page.getByRole("link", { name: "Export database" }).isVisible(), true)
    await page.getByRole("button", { name: "Backups" }).click()
    assert.equal(await page.locator("#backupSelect").isVisible(), true)
    assert.equal(await page.getByRole("button", { name: "Create backup" }).isVisible(), true)
    await page.keyboard.press("Escape")
    await page.waitForSelector("#settingsDialog", { state: "detached", timeout: 5000 })

    const cardActions = await page.locator(".card").first().locator(".cardActions").boundingBox()
    assert.ok(cardActions)
    assert.ok(cardActions.height <= 36, `expected compact card actions, got ${cardActions.height}px`)
    assert.deepEqual(
      await page
        .locator(".card")
        .first()
        .locator(".cardActions [aria-label]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
      ["Create", "Details", "Prompt", "Open"],
    )
    assert.match(await page.locator('.card[data-media="video"] .cardMeta').first().textContent(), /0:12/)

    const initialMediaFit = await page.evaluate(() => ({
      rootFill: document.querySelector(".media-fit-fill") !== null,
      imageFit: getComputedStyle(document.querySelector(".preview img")).objectFit,
    }))
    assert.equal(initialMediaFit.rootFill, true)
    assert.equal(initialMediaFit.imageFit, "cover")
    await openViewOptions(page)
    await page.locator("#mediaFitContainItem").click()
    const containedMediaFit = await page.evaluate(() => ({
      rootContain: document.querySelector(".media-fit-contain") !== null,
      imageFit: getComputedStyle(document.querySelector(".preview img")).objectFit,
    }))
    assert.equal(containedMediaFit.rootContain, true)
    assert.equal(containedMediaFit.imageFit, "contain")
    assert.equal(await page.locator("#mediaFitContainItem").getAttribute("aria-checked"), "true")
    await page.keyboard.press("Escape")

    const lazyState = await page.evaluate(() => {
      const media = [...document.querySelectorAll(".preview img, .preview video")]
      return {
        loaded: media.filter((node) => node.getAttribute("src")).length,
        deferred: media.filter((node) => node.dataset.src).length,
        nativeLazy: media.filter((node) => node.getAttribute("loading") === "lazy").length,
        mountedVideos: document.querySelectorAll(".card video").length,
        videoPosters: document.querySelectorAll('.card[data-media="video"] .videoPosterButton').length,
        visibleLoaded: [...document.querySelectorAll(".card")]
          .filter((card) => {
            const rect = card.getBoundingClientRect()
            return rect.bottom > 0 && rect.top < innerHeight
          })
          .every((card) => card.dataset.mediaLoaded === "true"),
      }
    })
    assert.ok(lazyState.loaded > 0)
    assert.equal(lazyState.deferred, 0)
    assert.ok(lazyState.nativeLazy > 0)
    assert.equal(lazyState.mountedVideos, 0)
    assert.ok(lazyState.videoPosters > 0)
    assert.equal(lazyState.visibleLoaded, true)

    await page.locator('.card[data-media="video"] .videoPosterButton').first().click()
    await page.waitForSelector('.card[data-media="video"] video[src]', { timeout: 5000 })

    await page.locator("#createViewButton").click()
    await page.waitForSelector(".createOverlay #createArea:not([hidden])", { timeout: 5000 })
    const createOverlay = await page.evaluate(() => {
      const overlay = document.querySelector(".createOverlay")
      const backdrop = document.querySelector(".createOverlayBackdrop")
      const panel = document.querySelector("#createArea")
      const panelRect = panel?.getBoundingClientRect()
      return {
        overlayPosition: overlay ? getComputedStyle(overlay).position : "",
        backdropFilter: backdrop ? getComputedStyle(backdrop).backdropFilter || getComputedStyle(backdrop).webkitBackdropFilter : "",
        panelWidth: panelRect?.width || 0,
        panelHeight: panelRect?.height || 0,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }
    })
    assert.equal(createOverlay.overlayPosition, "fixed")
    assert.match(createOverlay.backdropFilter, /blur/)
    assert.ok(createOverlay.panelWidth > createOverlay.viewportWidth * 0.9)
    assert.ok(createOverlay.panelHeight > createOverlay.viewportHeight * 0.9)
    assert.equal(await page.locator("#libraryArea").isHidden(), false)
    assert.equal(await page.locator("#createModeSelect").isVisible(), true)
    assert.equal(await page.locator("#createCatalogSelect").count(), 0)
    await page.locator('[data-source-kind="url"]').click()
    await page.locator("#createUrlInput").fill("https://assets.example/source.png")
    assert.equal(await page.locator('#createSourcePreview img[src="https://assets.example/source.png"]').count(), 1)
    await page.locator("#createClearSourceButton").click()
    assert.equal(await page.locator("#createSourcePreview img").count(), 0)
    await page.locator('[data-source-kind="upload"]').click()
    await page.evaluate(() => {
      const file = new File([new Uint8Array([137, 80, 78, 71])], "drop.png", { type: "image/png" })
      const data = new DataTransfer()
      data.items.add(file)
      document.querySelector("#createUploadDropZone").dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      )
    })
    await page.waitForFunction(() => document.querySelector("#createUploadMeta")?.textContent.includes("Dropped drop.png"))
    assert.equal(await page.locator("#createSourcePreview img").count(), 1)
    await page.evaluate(() => {
      const file = new File([new Uint8Array([137, 80, 78, 71])], "paste.png", { type: "image/png" })
      const data = new DataTransfer()
      data.items.add(file)
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      )
    })
    await page.waitForFunction(() => document.querySelector("#createUploadMeta")?.textContent.includes("Pasted paste.png"))
    await page.locator("#hideCreateButton").click()
    await page.waitForSelector(".createOverlay", { state: "detached", timeout: 5000 })
    await page.waitForSelector("#libraryArea:not([hidden])", { timeout: 5000 })

    await page.evaluate(() => {
      const file = new File([new Uint8Array([137, 80, 78, 71])], "global-drop.png", { type: "image/png" })
      const data = new DataTransfer()
      data.items.add(file)
      window.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      )
    })
    await page.waitForSelector(".createOverlay #createArea", { timeout: 5000 })
    await page.waitForFunction(() => document.querySelector("#createUploadMeta")?.textContent.includes("Dropped global-drop.png"))
    assert.equal(await page.locator('[data-source-kind="upload"][data-state="active"]').isVisible(), true)
    await page.locator("#hideCreateButton").click()
    await page.waitForSelector(".createOverlay", { state: "detached", timeout: 5000 })

    await page.locator('.card[data-media="image"] .cardCreateButton').first().click()
    await page.waitForSelector(".createOverlay #createArea", { timeout: 5000 })
    assert.equal(await page.locator("#createSourcePreview img").count(), 1)
    assert.equal(await page.locator("#createClearSourceButton").isVisible(), true)
    await page.locator("#createClearSourceButton").click()
    assert.equal(await page.locator("#createSourcePreview img").count(), 0)
    await page.locator("#hideCreateButton").click()
    await page.waitForSelector(".createOverlay", { state: "detached", timeout: 5000 })

    await page.locator("#statusSelect").click()
    await page.getByRole("option", { name: /Missing/ }).click()
    await page.waitForURL(/status=missing/, { timeout: 5000 })
    assert.equal(new URL(page.url()).searchParams.get("status"), "missing")
    await page.reload()
    await page.waitForSelector(".card", { timeout: 10000 })
    assert.match(await page.locator("#statusSelect").textContent(), /Missing/)
    assert.equal(await page.locator(".card").count(), 1)

    await page.locator(".detailsButton").first().click()
    await page.waitForSelector("#itemDialog", { timeout: 5000 })
    assert.equal(await page.locator("#detailCopyPromptButton").isVisible(), true)
    assert.equal(await page.locator("#detailCopyIdButton").isVisible(), true)
    const detailLayout = await page.evaluate(() => {
      const title = document.querySelector("#detailTitle")
      const body = document.querySelector(".dialogBody")
      const preview = document.querySelector("#detailPreview")
      const panel = document.querySelector(".detailPanel")
      const previewRect = preview?.getBoundingClientRect()

      return {
        bodyOverflow: body ? getComputedStyle(body).overflow : "",
        panelOverflowY: panel ? getComputedStyle(panel).overflowY : "",
        previewWidth: previewRect?.width || 0,
        previewHeight: previewRect?.height || 0,
        titleVisible: title ? getComputedStyle(title).position !== "absolute" : true,
      }
    })
    assert.equal(detailLayout.bodyOverflow, "hidden")
    assert.equal(detailLayout.panelOverflowY, "auto")
    assert.ok(Math.abs(detailLayout.previewWidth - detailLayout.previewHeight) < 2)
    assert.equal(detailLayout.titleVisible, false)

    const mobilePage = await browser.newPage({
      viewport: {
        width: 390,
        height: 844,
      },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    })

    try {
      await mobilePage.goto(`http://127.0.0.1:${listener.port}`)
      await mobilePage.waitForSelector(".card", { timeout: 10000 })

      const mobileLayout = await mobilePage.evaluate(() => {
        const firstCard = document.querySelector(".card")
        const firstCardTop = firstCard?.getBoundingClientRect().top ?? Infinity
        const firstRowTop = firstCardTop
        const firstRowCount = [...document.querySelectorAll(".card")].filter(
          (card) => Math.abs(card.getBoundingClientRect().top - firstRowTop) < 4,
        ).length

        return {
          firstCardTop,
          firstRowCount,
          pageSizeRendered: document.querySelector(".pageSizeFilter") !== null,
          viewToggleRendered: document.querySelector(".viewToggle") !== null,
        }
      })
      assert.ok(mobileLayout.firstCardTop < 844, `expected first mobile card in first viewport, got y=${mobileLayout.firstCardTop}`)
      assert.equal(mobileLayout.firstRowCount, 2)
      assert.equal(mobileLayout.pageSizeRendered, false)
      assert.equal(mobileLayout.viewToggleRendered, false)

      await mobilePage.locator(".detailsButton").first().click()
      await mobilePage.waitForSelector("#itemDialog", { timeout: 5000 })
      const mobileDialog = await mobilePage.locator("#itemDialog").boundingBox()
      assert.ok(mobileDialog)
      assert.ok(mobileDialog.width >= 370, `expected mobile dialog to fill viewport, got ${mobileDialog.width}px`)
    } finally {
      await mobilePage.close().catch(() => {})
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
    await listener.close()
  }
})

async function launchChromeOrSkip(t) {
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: true,
    })
  } catch (error) {
    t.skip(`Chrome browser is not available for UI smoke tests: ${error.message}`)
    return null
  }
}

async function writeFixtureCatalog(mediaDir) {
  const items = []

  for (let index = 0; index < 52; index += 1) {
    const id = uuidForIndex(index)
    const isMissing = index === 1
    const isVideo = index > 1 && index % 3 === 0
    const extension = isVideo ? "mp4" : "png"
    const type = isVideo ? "video" : "edit"
    const date = "2026-05-27"
    const localFile = `${date}/${date}_${type}_${id}.${extension}`
    const thumbnailFile = isVideo && !isMissing ? `_thumbnails/${date}/${date}_${type}_${id}.jpg` : null

    if (!isMissing) {
      await mkdir(path.join(mediaDir, date), { recursive: true })
      await writeFile(path.join(mediaDir, localFile), isVideo ? new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) : PNG_BYTES)
      if (thumbnailFile) {
        await mkdir(path.join(mediaDir, "_thumbnails", date), { recursive: true })
        await writeFile(path.join(mediaDir, thumbnailFile), PNG_BYTES)
      }
    }

    items.push({
      id,
      type,
      status: "done",
      outputUrl: `https://assets.example/${id}.${extension}`,
      localFile: isMissing ? null : localFile,
      size: isMissing ? null : isVideo ? 8 : PNG_BYTES.byteLength,
      duration: isVideo ? 12 : null,
      thumbnailFile,
      thumbnailError: null,
      createdAt: 1779769900 - index,
      createdAtIso: new Date((1779769900 - index) * 1000).toISOString(),
      prompt: `Fixture prompt ${index}`,
      favorited: index === 5,
      sha256: null,
      verifiedAt: null,
    })
  }

  writeFixtureCatalogDb(mediaDir, {
    items,
    downloadedJobIds: items.filter((item) => item.localFile).map((item) => item.id),
    orphanFiles: [],
    lastSeenJobId: items[0].id,
    updatedAt: new Date().toISOString(),
  })
}

function writeFixtureCatalogDb(mediaDir, catalog) {
  const db = new DatabaseSync(path.join(mediaDir, "catalog.sqlite"))
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        item_json TEXT NOT NULL,
        created_at INTEGER,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS media_items_created_at_idx ON media_items(created_at DESC);

      CREATE TABLE IF NOT EXISTS downloaded_job_ids (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orphan_files (
        local_file TEXT PRIMARY KEY,
        file_json TEXT NOT NULL
      );
    `)

    const insertItem = db.prepare("INSERT INTO media_items (id, item_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
    for (const item of catalog.items) {
      insertItem.run(item.id, JSON.stringify(item), Number(item.createdAt || 0), item.updatedAt || null)
    }

    const insertDownloaded = db.prepare("INSERT INTO downloaded_job_ids (id, position) VALUES (?, ?)")
    catalog.downloadedJobIds.forEach((id, index) => insertDownloaded.run(id, index))

    const upsertMeta = db.prepare("INSERT INTO catalog_meta (key, value_json) VALUES (?, ?)")
    upsertMeta.run("lastSeenJobId", JSON.stringify(catalog.lastSeenJobId || null))
    upsertMeta.run("updatedAt", JSON.stringify(catalog.updatedAt || null))
    upsertMeta.run("lastRun", JSON.stringify(catalog.lastRun || null))
  } finally {
    db.close()
  }
}

async function importServer(mediaDir) {
  const previousEnv = {
    MEDIA_DIR: process.env.MEDIA_DIR,
    PORT: process.env.PORT,
    SYNC_DELAY_MS: process.env.SYNC_DELAY_MS,
    GENERATEPORN_AUTHORIZATION: process.env.GENERATEPORN_AUTHORIZATION,
    GENERATEPORN_COOKIE: process.env.GENERATEPORN_COOKIE,
    GENERATEPORN_PAGE_LIMIT: process.env.GENERATEPORN_PAGE_LIMIT,
  }

  process.env.MEDIA_DIR = mediaDir
  process.env.PORT = "0"
  process.env.SYNC_DELAY_MS = "0"
  process.env.GENERATEPORN_PAGE_LIMIT = "3"
  process.env.GENERATEPORN_AUTHORIZATION = ""
  process.env.GENERATEPORN_COOKIE = ""

  const imported = await import(`${SERVER_PATH.href}?uiTest=${Date.now()}-${Math.random()}`)

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return imported
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

function visibleTopActions(page) {
  return page.locator(".actions > button:not([hidden]), .actions > details > summary").allTextContents()
}

async function openViewOptions(page) {
  await page.locator("#viewOptionsButton").click()
  await page.waitForSelector('[data-slot="dropdown-menu-content"]', { timeout: 5000 })
}

function uuidForIndex(index) {
  return `${String(index).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`
}
