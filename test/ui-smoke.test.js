import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { chromium } from "@playwright/test"

const SERVER_PATH = new URL("../src/server.js", import.meta.url)
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
    assert.deepEqual(await visibleTopActions(page), ["Create", "Sync & download", "Blur", "More"])
    assert.deepEqual(await page.locator(".summaryCard span").allTextContents(), ["Missing", "Unverified", "Favorited", "Orphans"])

    await page.locator("#mediaBlurButton").click()
    assert.notEqual(
      await page
        .locator(".preview img")
        .first()
        .evaluate((node) => getComputedStyle(node).filter),
      "none",
    )
    await page.locator("#mediaBlurButton").click()

    await page.getByRole("button", { name: "More actions" }).click()
    assert.deepEqual(await page.getByRole("menuitem").allTextContents(), [
      "Full rescan",
      "Download missing",
      "Retry errors",
      "Thumbnails",
      "Verify",
      "Connect account",
      "Refresh token",
      "Close browser",
      "Export catalog",
    ])
    await page.keyboard.press("Escape")

    const cardActions = await page.locator(".card").first().locator(".cardActions").boundingBox()
    assert.ok(cardActions)
    assert.ok(cardActions.height <= 72, `expected compact card actions, got ${cardActions.height}px`)
    assert.deepEqual((await page.locator(".card").first().locator(".cardActions *").allTextContents()).filter(Boolean), [
      "Create",
      "Details",
      "Prompt",
      "Open",
    ])
    assert.match(await page.locator('.card[data-media="video"] .cardMeta').first().textContent(), /0:12/)

    const lazyState = await page.evaluate(() => {
      const media = [...document.querySelectorAll(".preview img, .preview video")]
      return {
        loaded: media.filter((node) => node.getAttribute("src")).length,
        deferred: media.filter((node) => node.dataset.src).length,
        nativeLazy: media.filter((node) => node.getAttribute("loading") === "lazy").length,
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
    assert.equal(lazyState.visibleLoaded, true)

    const videoStayedMounted = await page.evaluate(async () => {
      const video = [...document.querySelectorAll(".card video")].find((node) => node.getAttribute("src"))
      if (!video) return false

      video.dataset.stableMarker = "present"
      document.querySelector("#sortSelect").dispatchEvent(new Event("change", { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 500))
      return [...document.querySelectorAll(".card video")].some((node) => node.dataset.stableMarker === "present")
    })
    assert.equal(videoStayedMounted, true)

    await page.locator("#createViewButton").click()
    await page.waitForSelector("#createArea:not([hidden])", { timeout: 5000 })
    assert.equal(await page.locator("#libraryArea").isHidden(), false)
    assert.equal(await page.locator("#createModeSelect").isVisible(), true)
    await page.waitForFunction(() => document.querySelector("#createCatalogSelect")?.options.length > 0)
    assert.equal((await page.locator("#createCatalogSelect option").count()) > 0, true)
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
    await page.locator("#libraryViewButton").click()
    await page.waitForSelector("#libraryArea:not([hidden])", { timeout: 5000 })

    await page.selectOption("#statusSelect", "missing")
    await page.waitForURL(/status=missing/, { timeout: 5000 })
    assert.equal(new URL(page.url()).searchParams.get("status"), "missing")
    await page.reload()
    await page.waitForSelector(".card", { timeout: 10000 })
    assert.equal(await page.locator("#statusSelect").inputValue(), "missing")
    assert.equal(await page.locator(".card").count(), 1)

    await page.locator(".detailsButton").first().click()
    await page.waitForSelector("#itemDialog", { timeout: 5000 })
    assert.equal(await page.locator("#detailCopyPromptButton").isVisible(), true)
    assert.equal(await page.locator("#detailCopyIdButton").isVisible(), true)

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
          pageSizeVisible: getComputedStyle(document.querySelector(".pageSizeFilter")).display !== "none",
          viewToggleVisible: getComputedStyle(document.querySelector(".viewToggle")).display !== "none",
        }
      })
      assert.ok(mobileLayout.firstCardTop < 844, `expected first mobile card in first viewport, got y=${mobileLayout.firstCardTop}`)
      assert.equal(mobileLayout.firstRowCount, 2)
      assert.equal(mobileLayout.pageSizeVisible, false)
      assert.equal(mobileLayout.viewToggleVisible, false)

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

    if (!isMissing) {
      await mkdir(path.join(mediaDir, date), { recursive: true })
      await writeFile(path.join(mediaDir, localFile), isVideo ? new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) : PNG_BYTES)
    }

    items.push({
      id,
      type,
      status: "done",
      outputUrl: `https://assets.example/${id}.${extension}`,
      localFile: isMissing ? null : localFile,
      size: isMissing ? null : isVideo ? 8 : PNG_BYTES.byteLength,
      duration: isVideo ? 12 : null,
      createdAt: 1779769900 - index,
      createdAtIso: new Date((1779769900 - index) * 1000).toISOString(),
      prompt: `Fixture prompt ${index}`,
      favorited: index === 5,
      sha256: null,
      verifiedAt: null,
    })
  }

  await writeFile(
    path.join(mediaDir, "catalog.json"),
    `${JSON.stringify(
      {
        items,
        downloadedJobIds: items.filter((item) => item.localFile).map((item) => item.id),
        orphanFiles: [],
        lastSeenJobId: items[0].id,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
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

function uuidForIndex(index) {
  return `${String(index).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`
}
