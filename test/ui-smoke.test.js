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
  const baseUrl = `http://127.0.0.1:${listener.port}`
  const page = await browser.newPage({
    viewport: {
      width: 1512,
      height: 828,
    },
  })
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl })

  try {
    await page.goto(`${baseUrl}/create`)
    await page.waitForSelector(".createOverlay #createArea", { timeout: 10000 })
    await page.reload()
    await page.waitForSelector(".createOverlay #createArea", { timeout: 10000 })
    assert.equal(page.url(), `${baseUrl}/create`)

    await page.goto(baseUrl)
    await page.waitForFunction(
      () =>
        document.querySelector("#libraryStatus")?.textContent === "48 of 51 loaded" &&
        document.querySelectorAll('.card:not([aria-hidden="true"])').length > 0,
      { timeout: 10000 },
    )

    const initiallyMountedCards = await page.locator('.card:not([aria-hidden="true"])').count()
    assert.ok(initiallyMountedCards > 0)
    assert.ok(initiallyMountedCards < 48, `expected virtualized card count below first page size, got ${initiallyMountedCards}`)
    assert.equal(await page.locator("#libraryStatus").textContent(), "48 of 51 loaded")
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForFunction(() => document.querySelector("#libraryStatus")?.textContent?.includes("51 of 51 loaded"), {
      timeout: 5000,
    })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForSelector(".card .copyPromptButton:not([disabled])", { timeout: 5000 })
    assert.equal(await page.locator("#emptyState").count(), 0)
    assert.deepEqual(await visibleTopActions(page), ["Sync", "View", "Settings"])
    assert.deepEqual(await page.locator(".summaryCard span").allTextContents(), [
      "Missing",
      "Unverified",
      "Favorited",
      "Deleted",
      "Orphans",
    ])

    await page.locator("#templateViewButton").click()
    await page.waitForSelector(".templateBrowser", { timeout: 5000 })
    assert.equal(await page.getByRole("heading", { name: "Saved templates", exact: true }).isVisible(), true)
    await page.getByRole("button", { name: "Library" }).click()
    await page.waitForSelector(".card", { timeout: 10000 })
    await page.locator("#playboxViewButton").click()
    await page.waitForFunction(() => document.querySelector("#libraryStatus")?.textContent === "1 of 1 loaded", { timeout: 5000 })
    assert.equal(await page.locator(".card").first().locator(".prompt").count(), 0)
    await page.locator(".copyPromptButton").first().click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Playbox fixture prompt")
    assert.equal(page.url(), `${baseUrl}/playbox`)
    await page.locator("#libraryViewButton").click()
    await page.waitForFunction(() => document.querySelector("#libraryStatus")?.textContent === "48 of 51 loaded", { timeout: 5000 })

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
    assert.deepEqual(await page.locator(".settingsSidebar button").allTextContents(), ["Library", "Account", "Playbox Auth", "Backups"])
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
      ["Create", "Favorite", "Prompt", "Delete remote"],
    )
    await page.locator(".copyPromptButton").first().click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Fixture prompt 0")
    const videoCardMeta = await page.locator('.card[data-media="video"] .cardMeta').first().textContent()
    assert.match(videoCardMeta, /^.+ · unverified$/)
    assert.doesNotMatch(videoCardMeta, /\bvideo\b/)
    assert.doesNotMatch(videoCardMeta, /\d+:\d{2}/)
    assert.equal(await page.locator('.card[data-media="video"] .mediaTypeBadge').first().getAttribute("aria-label"), "Video")
    assert.equal(
      await page.locator('.card[data-media="video"][data-media-state="loading"] .pending-preview').first().textContent(),
      "Rendering video",
    )
    assert.equal(await page.locator('.card[data-media="video"][data-media-state="loading"] .mediaPreviewButton').first().isVisible(), true)
    assert.equal(await page.locator('.card[data-media-state="loading"] .missing-preview').count(), 0)
    assert.equal(await page.locator('.card[data-media="image"] .mediaTypeBadge').first().getAttribute("aria-label"), "Edit")

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

    await page.locator('.card[data-media="video"][data-media-state="ready"] .mediaPreviewButton').first().click()
    await page.waitForSelector("#itemDialog", { timeout: 5000 })
    const videoDetailFit = await page.evaluate(() => {
      const preview = document.querySelector("#detailPreview")
      const media = document.querySelector("#detailPreview video")
      const panel = document.querySelector(".detailPanel")
      const nav = document.querySelector(".detailNav")
      const previewRect = preview?.getBoundingClientRect()
      const mediaRect = media?.getBoundingClientRect()
      const panelRect = panel?.getBoundingClientRect()
      const navRect = nav?.getBoundingClientRect()

      return {
        dataMedia: preview?.getAttribute("data-media"),
        mediaAutoPlay: media?.autoplay || false,
        mediaLoop: media?.loop || false,
        mediaMuted: media?.muted ?? null,
        mediaObjectFit: media ? getComputedStyle(media).objectFit : "",
        mediaPosition: media ? getComputedStyle(media).position : "",
        mediaWidth: mediaRect?.width || 0,
        mediaHeight: mediaRect?.height || 0,
        navInPanel: Boolean(document.querySelector("#detailNextButton")?.closest(".detailPanel")),
        navTop: navRect?.top || 0,
        panelWidth: panelRect?.width || 0,
        panelMiddle: panelRect ? panelRect.top + panelRect.height / 2 : 0,
        previewWidth: previewRect?.width || 0,
        previewHeight: previewRect?.height || 0,
      }
    })
    assert.equal(videoDetailFit.dataMedia, "video")
    assert.equal(videoDetailFit.mediaAutoPlay, true)
    assert.equal(videoDetailFit.mediaLoop, true)
    assert.equal(videoDetailFit.mediaMuted, true)
    assert.equal(videoDetailFit.mediaObjectFit, "contain")
    assert.equal(videoDetailFit.mediaPosition, "absolute")
    assert.ok(videoDetailFit.previewWidth > videoDetailFit.panelWidth)
    assert.ok(Math.abs(videoDetailFit.mediaWidth - videoDetailFit.previewWidth) < 2)
    assert.ok(Math.abs(videoDetailFit.mediaHeight - videoDetailFit.previewHeight) < 2)
    assert.equal(videoDetailFit.navInPanel, true)
    assert.ok(videoDetailFit.navTop > videoDetailFit.panelMiddle)
    assert.equal(await page.locator("#detailFacts").count(), 0)
    assert.equal(await page.locator("#detailPreviousButton").isVisible(), true)
    assert.equal(await page.locator("#detailNextButton").isVisible(), true)
    const videoDetailPrompt = await page.locator("#detailPrompt").textContent()
    const videoDetailUrl = page.url()
    await page.locator("#detailNextButton").click()
    await page.waitForFunction((prompt) => document.querySelector("#detailPrompt")?.textContent !== prompt, videoDetailPrompt)
    assert.notEqual(await page.locator("#detailPrompt").textContent(), videoDetailPrompt)
    assert.notEqual(page.url(), videoDetailUrl)
    assert.equal(await page.locator("#detailPreviousButton").isEnabled(), true)
    await page.locator("#detailPreviousButton").click()
    await page.waitForFunction((prompt) => document.querySelector("#detailPrompt")?.textContent === prompt, videoDetailPrompt)
    await page.evaluate(() => {
      const video = document.querySelector("#detailPreview video")
      if (!(video instanceof HTMLVideoElement)) throw new Error("Expected detail video")
      video.muted = false
      video.dispatchEvent(new Event("volumechange", { bubbles: true }))
    })
    await page.waitForFunction(() => window.localStorage.getItem("detailVideoMuted") === "false")
    await page.keyboard.press("Escape")
    await page.waitForSelector("#itemDialog", { state: "detached", timeout: 5000 })
    await page.locator('.card[data-media="video"][data-media-state="ready"] .mediaPreviewButton').nth(1).click()
    await page.waitForSelector("#itemDialog", { timeout: 5000 })
    assert.equal(
      await page.evaluate(() => {
        const video = document.querySelector("#detailPreview video")
        return video instanceof HTMLVideoElement ? video.muted : null
      }),
      false,
    )
    await page.evaluate(() => {
      const video = document.querySelector("#detailPreview video")
      if (!(video instanceof HTMLVideoElement)) throw new Error("Expected detail video")
      video.muted = true
      video.dispatchEvent(new Event("volumechange", { bubbles: true }))
    })
    await page.waitForFunction(() => window.localStorage.getItem("detailVideoMuted") === "true")
    await page.keyboard.press("Escape")
    await page.waitForSelector("#itemDialog", { state: "detached", timeout: 5000 })
    await page.mouse.move(8, 8)
    await page.waitForFunction(() => document.querySelectorAll(".card video").length === 0, { timeout: 5000 })

    const lazyState = await page.evaluate(() => {
      const media = [...document.querySelectorAll(".preview img, .preview video")]
      return {
        loaded: media.filter((node) => node.getAttribute("src")).length,
        deferred: media.filter((node) => node.dataset.src).length,
        nativeLazy: media.filter((node) => node.getAttribute("loading") === "lazy").length,
        mountedVideos: document.querySelectorAll(".card video").length,
        videoPreviewButtons: document.querySelectorAll('.card[data-media="video"] .mediaPreviewButton').length,
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
    assert.ok(lazyState.videoPreviewButtons > 0)
    assert.equal(lazyState.visibleLoaded, true)

    await page.locator('.card[data-media="video"][data-media-state="ready"]').first().hover()
    await page.waitForSelector('.card[data-media="video"][data-media-state="ready"] .hoverPreviewVideo[src]', { timeout: 5000 })
    const hoverPreviewState = await page.evaluate(() => {
      const video = document.querySelector('.card[data-media="video"][data-media-state="ready"] .hoverPreviewVideo')
      return video instanceof HTMLVideoElement
        ? {
            controls: video.controls,
            muted: video.muted,
            loop: video.loop,
            playsInline: video.playsInline,
            ariaHidden: video.getAttribute("aria-hidden"),
          }
        : null
    })
    assert.deepEqual(hoverPreviewState, {
      controls: false,
      muted: true,
      loop: true,
      playsInline: true,
      ariaHidden: "true",
    })

    await page.locator('.card[data-media="video"] .mediaPreviewButton').first().click()
    await page.waitForSelector("#detailPreview video[src]", { timeout: 5000 })
    await page.keyboard.press("Escape")
    await page.waitForSelector("#itemDialog", { state: "detached", timeout: 5000 })

    await page.locator('.card[data-media="video"][data-media-state="loading"] .mediaPreviewButton').first().click()
    await page.waitForSelector('#detailPreview[data-media="missing"]', { timeout: 5000 })
    assert.equal(await page.locator("#detailPrompt").textContent(), "Fixture prompt 4")
    await page.keyboard.press("Escape")
    await page.waitForSelector("#itemDialog", { state: "detached", timeout: 5000 })

    await page.locator("#createViewButton").click()
    await page.waitForSelector(".createOverlay #createArea:not([hidden])", { timeout: 5000 })
    const createOverlay = await page.evaluate(() => {
      const overlay = document.querySelector(".createOverlay")
      const backdrop = document.querySelector(".createOverlayBackdrop")
      const panel = document.querySelector("#createArea")
      const controlPanel = document.querySelector(".createPanel")
      const historyPanel = document.querySelector(".creationHistory")
      const panelRect = panel?.getBoundingClientRect()
      const controlRect = controlPanel?.getBoundingClientRect()
      const historyRect = historyPanel?.getBoundingClientRect()
      return {
        overlayPosition: overlay ? getComputedStyle(overlay).position : "",
        backdropFilter: backdrop ? getComputedStyle(backdrop).backdropFilter || getComputedStyle(backdrop).webkitBackdropFilter : "",
        panelWidth: panelRect?.width || 0,
        panelHeight: panelRect?.height || 0,
        controlWidth: controlRect?.width || 0,
        historyWidth: historyRect?.width || 0,
        resultPanelCount: document.querySelectorAll(".createResult").length,
        negativePromptVisible: document.querySelector("#createNegativePromptInput") !== null,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }
    })
    assert.equal(createOverlay.overlayPosition, "fixed")
    assert.match(createOverlay.backdropFilter, /blur/)
    assert.ok(createOverlay.panelWidth > createOverlay.viewportWidth * 0.9)
    assert.ok(createOverlay.panelHeight > createOverlay.viewportHeight * 0.9)
    assert.ok(createOverlay.controlWidth > createOverlay.historyWidth)
    assert.equal(createOverlay.resultPanelCount, 0)
    assert.equal(createOverlay.negativePromptVisible, true)
    assert.equal(await page.locator("#libraryArea").isHidden(), false)
    assert.equal(await page.locator("#createModeSelect").isVisible(), true)
    assert.equal(await page.locator("#createCatalogSelect").count(), 0)
    await page.locator('[data-source-kind="url"]').click()
    await page.locator("#createUrlInput").fill("https://assets.example/source.png")
    assert.equal(await page.locator('#createSelectedUrlPreview img[src="https://assets.example/source.png"]').count(), 1)
    await page.getByRole("button", { name: "Clear selected source" }).click()
    assert.equal(await page.locator("#createSelectedUrlPreview").count(), 0)
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
    assert.equal(await page.locator("#createSelectedUploadPreview img").count(), 1)
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
    assert.match(await page.locator("#createModeSelect").textContent(), /Custom Video/)
    assert.equal(await page.locator("#createPromptInput").inputValue(), "")
    assert.equal(await page.locator("#createNudifyToggleLabel").isVisible(), true)
    await page.locator("#createNudifyToggleLabel").click()
    assert.equal(await page.locator("#createNudifyToggle").isChecked(), true)
    assert.equal(await page.locator("#createSelectedCatalogPreview img").count(), 1)
    assert.equal(await page.getByRole("button", { name: "Clear selected source" }).isVisible(), true)
    await page.getByRole("button", { name: "Clear selected source" }).click()
    assert.equal(await page.locator("#createSelectedCatalogPreview").count(), 0)
    await page.locator("#hideCreateButton").click()
    await page.waitForSelector(".createOverlay", { state: "detached", timeout: 5000 })

    await page.locator("#statusSelect").click()
    await page.getByRole("option", { name: /Deleted/ }).click()
    await page.waitForURL(/status=deleted/, { timeout: 5000 })
    assert.equal(new URL(page.url()).searchParams.get("status"), "deleted")
    await page.waitForFunction(() => document.querySelectorAll(".card").length === 1, { timeout: 5000 })
    assert.equal(await page.locator(".card").count(), 1)
    assert.equal(await page.locator('.card[data-remote-deleted="true"].is-deleted').count(), 1)
    assert.equal(await page.locator(".deletedMediaBadge").isVisible(), true)

    await page.locator("#statusSelect").click()
    await page.getByRole("option", { name: /Missing/ }).click()
    await page.waitForURL(/status=missing/, { timeout: 5000 })
    assert.equal(new URL(page.url()).searchParams.get("status"), "missing")
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll(".card").length === 1, { timeout: 10000 })
    assert.match(await page.locator("#statusSelect").textContent(), /Missing/)
    assert.equal(await page.locator(".card").count(), 1)

    await page.locator(".mediaPreviewButton").first().click()
    await page.waitForSelector("#itemDialog", { timeout: 5000 })
    assert.equal(await page.locator("#detailCopyPromptButton").isVisible(), true)
    assert.equal(await page.locator("#detailCopyIdButton").isVisible(), true)
    await page.locator("#detailCopyPromptButton").click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Fixture prompt 1")
    assert.equal(await page.locator("#detailPreviousButton").isEnabled(), false)
    assert.equal(await page.locator("#detailNextButton").isEnabled(), false)
    const detailLayout = await page.evaluate(() => {
      const title = document.querySelector("#detailTitle")
      const body = document.querySelector(".dialogBody")
      const preview = document.querySelector("#detailPreview")
      const panel = document.querySelector(".detailPanel")
      const panelContent = document.querySelector(".detailPanelContent")
      const previewRect = preview?.getBoundingClientRect()

      return {
        bodyOverflow: body ? getComputedStyle(body).overflow : "",
        panelOverflowY: panel ? getComputedStyle(panel).overflowY : "",
        panelContentOverflowY: panelContent ? getComputedStyle(panelContent).overflowY : "",
        previewWidth: previewRect?.width || 0,
        previewHeight: previewRect?.height || 0,
        titleVisible: title ? getComputedStyle(title).position !== "absolute" : true,
      }
    })
    assert.equal(detailLayout.bodyOverflow, "hidden")
    assert.equal(detailLayout.panelOverflowY, "hidden")
    assert.equal(detailLayout.panelContentOverflowY, "auto")
    assert.ok(detailLayout.previewWidth > 0)
    assert.ok(detailLayout.previewHeight > 0)
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
      await mobilePage.goto(baseUrl)
      await mobilePage.waitForFunction(() => document.querySelectorAll('.media-card:not([aria-hidden="true"])').length > 0, {
        timeout: 10000,
      })

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

      await mobilePage.getByRole("button", { name: "Settings" }).click()
      await mobilePage.waitForSelector("#settingsDialog", { timeout: 5000 })
      await mobilePage.waitForTimeout(250)
      const mobileSettingsLayout = await mobilePage.evaluate(() => {
        const dialog = document.querySelector("#settingsDialog")
        const sidebar = document.querySelector(".settingsSidebar")
        const content = document.querySelector(".settingsContent")
        const dialogRect = dialog?.getBoundingClientRect()

        return {
          left: dialogRect?.left ?? -1,
          top: dialogRect?.top ?? -1,
          width: dialogRect?.width ?? 0,
          height: dialogRect?.height ?? 0,
          right: dialogRect?.right ?? 0,
          bottom: dialogRect?.bottom ?? 0,
          sidebarOverflowX: sidebar ? getComputedStyle(sidebar).overflowX : "",
          contentOverflowY: content ? getComputedStyle(content).overflowY : "",
        }
      })
      assert.ok(Math.abs(mobileSettingsLayout.left) < 1)
      assert.ok(Math.abs(mobileSettingsLayout.top) < 1)
      assert.ok(mobileSettingsLayout.width >= 390)
      assert.ok(mobileSettingsLayout.height >= 844)
      assert.ok(mobileSettingsLayout.right <= 391)
      assert.ok(mobileSettingsLayout.bottom <= 845)
      assert.equal(mobileSettingsLayout.sidebarOverflowX, "auto")
      assert.equal(mobileSettingsLayout.contentOverflowY, "auto")
      await mobilePage.keyboard.press("Escape")
      await mobilePage.waitForSelector("#settingsDialog", { state: "detached", timeout: 5000 })

      await mobilePage.goto(`${baseUrl}/create`)
      await mobilePage.waitForSelector("#createArea", { timeout: 5000 })
      const mobileCreateLayout = await mobilePage.evaluate(() => {
        const overlay = document.querySelector(".createOverlay")
        const createArea = document.querySelector("#createArea")
        const overlayRect = overlay?.getBoundingClientRect()
        const createRect = createArea?.getBoundingClientRect()

        return {
          overlay: {
            left: Math.round(overlayRect?.left ?? -1),
            top: Math.round(overlayRect?.top ?? -1),
            right: Math.round(overlayRect?.right ?? 0),
            bottom: Math.round(overlayRect?.bottom ?? 0),
          },
          create: {
            left: Math.round(createRect?.left ?? -1),
            top: Math.round(createRect?.top ?? -1),
            right: Math.round(createRect?.right ?? 0),
            bottom: Math.round(createRect?.bottom ?? 0),
            width: Math.round(createRect?.width ?? 0),
            height: Math.round(createRect?.height ?? 0),
            borderRadius: createArea ? getComputedStyle(createArea).borderRadius : "",
          },
          bodyPosition: document.body.style.position,
          htmlOverflow: document.documentElement.style.overflow,
          bodyOverflow: document.body.style.overflow,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        }
      })
      assert.deepEqual(mobileCreateLayout.overlay, {
        left: 0,
        top: 0,
        right: mobileCreateLayout.viewportWidth,
        bottom: mobileCreateLayout.viewportHeight,
      })
      assert.deepEqual(
        {
          left: mobileCreateLayout.create.left,
          top: mobileCreateLayout.create.top,
          right: mobileCreateLayout.create.right,
          bottom: mobileCreateLayout.create.bottom,
        },
        {
          left: 0,
          top: 0,
          right: mobileCreateLayout.viewportWidth,
          bottom: mobileCreateLayout.viewportHeight,
        },
      )
      assert.equal(mobileCreateLayout.create.borderRadius, "0px")
      assert.equal(mobileCreateLayout.bodyPosition, "fixed")
      assert.equal(mobileCreateLayout.htmlOverflow, "hidden")
      assert.equal(mobileCreateLayout.bodyOverflow, "hidden")
      await mobilePage.getByRole("button", { name: "Browse library" }).click()
      await mobilePage.waitForFunction(() => document.querySelectorAll(".sourceImageTile").length > 0, { timeout: 10000 })
      const mobileSourceGrid = await mobilePage.evaluate(() => {
        const tile = document.querySelector(".sourceImageTile")
        const grid = document.querySelector(".sourceImageGrid")
        const tileRect = tile?.getBoundingClientRect()
        const gridRect = grid?.getBoundingClientRect()

        return {
          tileWidth: tileRect?.width ?? 0,
          tileHeight: tileRect?.height ?? 0,
          gridHeight: gridRect?.height ?? 0,
        }
      })
      assert.ok(mobileSourceGrid.tileHeight >= 90, `expected visible source tiles, got ${mobileSourceGrid.tileHeight}px`)
      assert.ok(Math.abs(mobileSourceGrid.tileHeight - mobileSourceGrid.tileWidth) < 4)
      assert.ok(mobileSourceGrid.gridHeight >= mobileSourceGrid.tileHeight)

      await mobilePage.goto(baseUrl)
      await mobilePage.waitForFunction(() => document.querySelectorAll('.media-card:not([aria-hidden="true"])').length > 0, {
        timeout: 10000,
      })

      await mobilePage.locator('.card[data-media="video"][data-media-state="ready"] .mediaPreviewButton').first().click()
      await mobilePage.waitForSelector("#itemDialog", { timeout: 5000 })
      const mobileDialog = await mobilePage.locator("#itemDialog").boundingBox()
      assert.ok(mobileDialog)
      assert.equal(Math.round(mobileDialog.x), 0)
      assert.equal(Math.round(mobileDialog.y), 0)
      assert.equal(Math.round(mobileDialog.width), 390)
      assert.equal(Math.round(mobileDialog.height), 844)
      const mobileDetailControls = await mobilePage.evaluate(() => {
        const preview = document.querySelector("#detailPreview")
        const close = document.querySelector("#detailCloseButton")
        const panel = document.querySelector(".detailPanel")
        const dialog = document.querySelector("#itemDialog")
        const previewRect = preview?.getBoundingClientRect()
        const closeRect = close?.getBoundingClientRect()
        const panelRect = panel?.getBoundingClientRect()

        return {
          bodyPosition: document.body.style.position,
          htmlOverflow: document.documentElement.style.overflow,
          bodyOverflow: document.body.style.overflow,
          dialogBorderRadius: dialog ? getComputedStyle(dialog).borderRadius : "",
          closeInPanel: Boolean(close?.closest(".detailPanel")),
          closeTop: closeRect?.top || 0,
          panelTop: panelRect?.top || 0,
          previewBottom: previewRect?.bottom || 0,
        }
      })
      assert.equal(mobileDetailControls.bodyPosition, "fixed")
      assert.equal(mobileDetailControls.htmlOverflow, "hidden")
      assert.equal(mobileDetailControls.bodyOverflow, "hidden")
      assert.equal(mobileDetailControls.dialogBorderRadius, "0px")
      assert.equal(mobileDetailControls.closeInPanel, true)
      assert.ok(mobileDetailControls.closeTop >= mobileDetailControls.panelTop)
      assert.ok(mobileDetailControls.closeTop >= mobileDetailControls.previewBottom)
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
  const createdAtBase = Math.floor(Date.now() / 1000)

  for (let index = 0; index < 52; index += 1) {
    const id = uuidForIndex(index)
    const isMissing = index === 1
    const isPending = index === 4
    const isDeleted = index === 8
    const isVideo = isPending || (index > 1 && index % 3 === 0)
    const extension = isVideo ? "mp4" : "png"
    const type = isVideo ? "video" : "edit"
    const date = "2026-05-27"
    const localFile = `${date}/${date}_${type}_${id}.${extension}`
    const thumbnailFile = isVideo && !isMissing && !isPending ? `_thumbnails/${date}/${date}_${type}_${id}.jpg` : null

    if (!isMissing && !isPending) {
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
      status: isPending ? "processing" : "done",
      outputUrl: isMissing || isPending ? null : `https://assets.example/${id}.${extension}`,
      localFile: isMissing || isPending ? null : localFile,
      size: isMissing || isPending ? null : isVideo ? 8 : PNG_BYTES.byteLength,
      duration: isVideo ? 12 : null,
      thumbnailFile,
      thumbnailError: null,
      createdAt: createdAtBase - index,
      createdAtIso: new Date((createdAtBase - index) * 1000).toISOString(),
      prompt: `Fixture prompt ${index}`,
      favorited: index === 5,
      remoteDeletedAt: isDeleted ? new Date((createdAtBase - index) * 1000).toISOString() : null,
      remoteDeleteStatus: isDeleted ? "deleted" : null,
      sha256: null,
      verifiedAt: null,
    })
  }

  const playboxId = "playbox-fixture-collection"
  const playboxDate = "2026-05-27"
  const playboxLocalFile = `playbox/${playboxDate}/${playboxDate}_image_${playboxId}.png`
  await mkdir(path.dirname(path.join(mediaDir, playboxLocalFile)), { recursive: true })
  await writeFile(path.join(mediaDir, playboxLocalFile), PNG_BYTES)
  items.push({
    id: playboxId,
    provider: "playbox",
    collectionId: "fixture-collection",
    assetId: "fixture-asset",
    assetKind: "image",
    type: "image",
    status: "done",
    outputUrl: "https://playbox.example/fixture.png",
    localFile: playboxLocalFile,
    size: PNG_BYTES.byteLength,
    duration: null,
    thumbnailFile: null,
    thumbnailError: null,
    createdAt: createdAtBase + 1,
    createdAtIso: new Date((createdAtBase + 1) * 1000).toISOString(),
    prompt: "Playbox fixture prompt",
    favorited: false,
    remoteDeletedAt: null,
    remoteDeleteStatus: null,
    sha256: null,
    verifiedAt: null,
  })

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
    REDIRECT_STATIC_TO_VITE: process.env.REDIRECT_STATIC_TO_VITE,
    VITE_PORT: process.env.VITE_PORT,
  }

  process.env.MEDIA_DIR = mediaDir
  process.env.PORT = "0"
  process.env.SYNC_DELAY_MS = "0"
  process.env.GENERATEPORN_PAGE_LIMIT = "3"
  process.env.GENERATEPORN_AUTHORIZATION = ""
  process.env.GENERATEPORN_COOKIE = ""
  process.env.REDIRECT_STATIC_TO_VITE = "false"
  process.env.VITE_PORT = ""

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
