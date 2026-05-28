import { createHash, randomUUID } from "node:crypto"
import { createReadStream, readFileSync } from "node:fs"
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { createAuthBrowserService } from "./auth-browser.js"
import { ensureVideoThumbnail, getThumbnailDir } from "./thumbnails.js"

const CURRENT_FILE = fileURLToPath(import.meta.url)
const __dirname = path.dirname(CURRENT_FILE)
const ROOT_DIR = path.resolve(__dirname, "..")
loadDotEnv(path.join(ROOT_DIR, ".env"))

const PORT = Number(process.env.PORT || 5177)
const API_BASE_URL = process.env.GENERATEPORN_API_URL || "https://api.generateporn.ai/api/jobs"
const APP_LOGIN_URL = process.env.GENERATEPORN_APP_URL || "https://app.generateporn.ai/"
const PAGE_LIMIT = Number(process.env.GENERATEPORN_PAGE_LIMIT || 1000)
const CREATE_HISTORY_PAGE_LIMIT = Number(process.env.GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT || 20)
const MEDIA_DIR = resolveMediaDir(process.env.MEDIA_DIR || "media")
const CATALOG_PATH = path.join(MEDIA_DIR, "catalog.json")
const CATALOG_DB_PATH = path.join(MEDIA_DIR, "catalog.sqlite")
const BACKUP_DIR = path.join(MEDIA_DIR, "_catalog_backups")
const LEGACY_JSON_DIR = path.join(MEDIA_DIR, "_legacy_json")
const THUMBNAIL_DIR = getThumbnailDir(MEDIA_DIR)
const CREATE_TEMPLATES_PATH = path.join(MEDIA_DIR, "create-templates.json")
const AUTH_BROWSER_PROFILE_DIR = path.resolve(process.env.AUTH_BROWSER_PROFILE_DIR || path.join(MEDIA_DIR, "_auth_browser_profile"))
const PUBLIC_DIR = path.join(ROOT_DIR, "public")
const SYNC_DELAY_MS = Number(process.env.SYNC_DELAY_MS || 150)
const AUTH_BROWSER_REFRESH_MS = Number(process.env.AUTH_BROWSER_REFRESH_MS || 15 * 60 * 1000)
const AUTO_SYNC_ENABLED = parseBooleanEnv(process.env.AUTO_SYNC_ENABLED, true)
const AUTO_SYNC_INTERVAL_MS = Number(process.env.AUTO_SYNC_INTERVAL_MS || 60 * 60 * 1000)
const AUTO_SYNC_STARTUP_DELAY_MS = Number(process.env.AUTO_SYNC_STARTUP_DELAY_MS || 10 * 1000)
const AUTH_SETUP_MESSAGE =
  "Open More > Auth browser > Connect account, complete login in the visible browser window, then retry. The legacy extension token helper can still post to /api/auth/token."

const CREATE_POLL_MS = 2000
const CREATE_IMAGE_ACCEPT = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"])
const CREATE_VIDEO_QUALITY_OPTIONS = [
  { label: "720p · 4s", resolution: "720p", duration: 4 },
  { label: "720p · 8s", resolution: "720p", duration: 8 },
  { label: "1080p · 10s", resolution: "1080p", duration: 10 },
  { label: "1080p · 15s", resolution: "1080p", duration: 15 },
]
const CREATE_BUILTIN_TEMPLATE_SEEDS = [
  {
    id: "blowjob-video",
    label: "Blowjob",
    seedJobId: "fb62d491-b377-4c24-92ac-98e02e305bce",
    resolution: "720p",
    duration: 4,
  },
]
const CREATE_DISALLOWED_TEXT_PATTERNS = [
  /\b(?:minor|underage|child|kid|preteen|schoolgirl|schoolboy)\b/i,
  /\b(?:[0-9]|1[0-7])\s*(?:yo|yrs?|years?\s*old)\b/i,
  /\b(?:rape|raped|raping|non[-\s]?consensual|forced)\b/i,
]
const CREATE_TERMINAL_STATUSES = new Set(["done", "failed", "error", "cancelled", "canceled"])
const CREATE_ACTIVE_STATUSES = new Set(["submitted", "queued", "pending", "processing", "running", "in_progress"])

const authState = {
  authorization: normalizeAuthorization(process.env.GENERATEPORN_AUTHORIZATION),
  expiresAt: getJwtExpiration(process.env.GENERATEPORN_AUTHORIZATION),
  receivedAt: process.env.GENERATEPORN_AUTHORIZATION ? new Date().toISOString() : null,
  source: process.env.GENERATEPORN_AUTHORIZATION ? "env" : null,
}

const authBrowser = createAuthBrowserService({
  profileDir: AUTH_BROWSER_PROFILE_DIR,
  loginUrl: APP_LOGIN_URL,
  refreshIntervalMs: AUTH_BROWSER_REFRESH_MS,
  onToken: acceptAuthorization,
})

const syncState = {
  running: false,
  status: "idle",
  mode: null,
  currentPage: 0,
  scanned: 0,
  downloaded: 0,
  skipped: 0,
  errors: [],
  cancelRequested: false,
  message: "Idle.",
  startedAt: null,
  finishedAt: null,
}

const autoSyncState = {
  enabled: AUTO_SYNC_ENABLED,
  intervalMs: AUTO_SYNC_INTERVAL_MS,
  startupDelayMs: AUTO_SYNC_STARTUP_DELAY_MS,
  nextRunAt: null,
  lastRunAt: null,
  lastSkippedAt: null,
  lastSkipReason: null,
  lastError: null,
  lastReason: null,
}
let autoSyncTimer = null

let catalogDb = null
let catalogJsonMigrationChecked = false
let createTemplateJsonMigrationChecked = false

await mkdir(MEDIA_DIR, { recursive: true })

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)

    if (request.method === "OPTIONS") {
      return sendJson(response, { ok: true })
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, {
        mediaDir: MEDIA_DIR,
        hasCookie: Boolean(process.env.GENERATEPORN_COOKIE),
        hasAuthorization: Boolean(getActiveAuthorization()),
        authorizationExpiresAt: getAuthExpiresAt(),
        authorizationSource: authState.source,
        authBrowser: authBrowser.getStatus(),
        autoSync: getAutoSyncStatus(),
        thumbnailDir: THUMBNAIL_DIR,
        pageLimit: PAGE_LIMIT,
      })
    }

    if (request.method === "GET" && url.pathname === "/api/create/modes") {
      return sendJson(response, await getCreateModes())
    }

    if (request.method === "GET" && url.pathname === "/api/create/templates") {
      return sendJson(response, await loadCreateTemplateRegistry())
    }

    if (request.method === "POST" && url.pathname === "/api/create/templates/import") {
      const body = await readJsonBody(request)
      return sendJson(response, {
        ok: true,
        template: await importCreateTemplateFromHistory(body),
      })
    }

    if (request.method === "POST" && url.pathname === "/api/create/jobs") {
      const body = await readJsonBody(request)
      return sendJson(response, await createMediaJob(body))
    }

    const createJobMatch = url.pathname.match(/^\/api\/create\/jobs\/([^/]+)$/)
    if (request.method === "GET" && createJobMatch) {
      return sendJson(response, await pollCreateJob(createJobMatch[1]))
    }

    const createDownloadMatch = url.pathname.match(/^\/api\/create\/jobs\/([^/]+)\/download$/)
    if (request.method === "POST" && createDownloadMatch) {
      return sendJson(response, await downloadCreateJob(createDownloadMatch[1]))
    }

    if (request.method === "GET" && url.pathname === "/api/creations") {
      return sendJson(response, await getCreations(url.searchParams))
    }

    const creationMatch = url.pathname.match(/^\/api\/creations\/([^/]+)$/)
    if (request.method === "GET" && creationMatch) {
      return sendJson(response, await getCreationDetails(creationMatch[1]))
    }

    const creationDuplicateMatch = url.pathname.match(/^\/api\/creations\/([^/]+)\/duplicate$/)
    if (request.method === "POST" && creationDuplicateMatch) {
      return sendJson(response, await duplicateCreation(creationDuplicateMatch[1]))
    }

    if (request.method === "POST" && url.pathname === "/api/creations/refresh") {
      const body = await readJsonBody(request)
      return sendJson(
        response,
        await refreshCreations({
          pageLimit: clamp(Number(body.pageLimit || CREATE_HISTORY_PAGE_LIMIT), 1, PAGE_LIMIT),
        }),
      )
    }

    if (request.method === "POST" && url.pathname === "/api/auth/token") {
      const body = await readJsonBody(request)
      const auth = acceptAuthorization(body.authorization || body.token, body.source || "browser")

      return sendJson(response, {
        ok: true,
        expiresAt: auth.expiresAt,
        source: auth.source,
      })
    }

    if (request.method === "GET" && url.pathname === "/api/auth/browser/status") {
      return sendJson(response, authBrowser.getStatus())
    }

    if (request.method === "POST" && url.pathname === "/api/auth/browser/connect") {
      return sendJson(response, await authBrowser.connectVisible())
    }

    if (request.method === "POST" && url.pathname === "/api/auth/browser/refresh") {
      return sendJson(response, await authBrowser.refreshHeadless())
    }

    if (request.method === "POST" && url.pathname === "/api/auth/browser/disconnect") {
      const body = await readJsonBody(request)
      return sendJson(response, await authBrowser.disconnect({ deleteProfile: Boolean(body.deleteProfile) }))
    }

    if (request.method === "GET" && url.pathname === "/api/items") {
      return sendJson(response, await getItems(url.searchParams))
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/export") {
      return sendCatalogExport(response)
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/backups") {
      return sendJson(response, { backups: await listCatalogBackups() })
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/backup") {
      const body = await readJsonBody(request)
      const backup = await createCatalogBackup(body.reason || "manual")
      return sendJson(response, { ok: true, backup })
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/restore") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, thumbnail, or verification job is already running." }, 409)
      }

      const body = await readJsonBody(request)
      const restored = await restoreCatalogBackup(body.file)
      return sendJson(response, { ok: true, restored })
    }

    if (request.method === "GET" && url.pathname === "/api/sync/status") {
      return sendJson(response, syncState)
    }

    if (request.method === "POST" && url.pathname === "/api/sync/start") {
      const body = await readJsonBody(request)

      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync is already running." }, 409)
      }

      const incremental = body.incremental !== false
      startSync({ incremental }).catch(handleBackgroundError)

      return sendJson(response, { ok: true, incremental })
    }

    if (request.method === "POST" && url.pathname === "/api/sync/cancel") {
      if (!syncState.running) {
        return sendJson(response, { ok: false, error: "No sync or download is running." }, 409)
      }

      requestSyncCancellation()
      return sendJson(response, { ok: true, status: syncState.status })
    }

    if (request.method === "POST" && url.pathname === "/api/download/missing") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync or download is already running." }, 409)
      }

      startCatalogDownload({ mode: "download-missing" }).catch(handleBackgroundError)
      return sendJson(response, { ok: true, mode: "download-missing" })
    }

    if (request.method === "POST" && url.pathname === "/api/download/retry-errors") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync or download is already running." }, 409)
      }

      startCatalogDownload({ mode: "retry-errors" }).catch(handleBackgroundError)
      return sendJson(response, { ok: true, mode: "retry-errors" })
    }

    if (request.method === "POST" && url.pathname === "/api/thumbnails/generate") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, or thumbnail job is already running." }, 409)
      }

      startThumbnailGeneration().catch(handleBackgroundError)
      return sendJson(response, { ok: true, mode: "generate-thumbnails" })
    }

    if (request.method === "POST" && url.pathname === "/api/library/verify") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, thumbnail, or verification job is already running." }, 409)
      }

      startLibraryVerification().catch(handleBackgroundError)
      return sendJson(response, { ok: true, mode: "verify-library" })
    }

    if (request.method === "POST" && url.pathname === "/api/history/reset") {
      await createCatalogBackup("before-history-reset")
      const catalog = await loadCatalog()
      catalog.lastSeenJobId = null
      catalog.downloadedJobIds = []
      catalog.updatedAt = new Date().toISOString()
      await saveCatalog(catalog)
      return sendJson(response, { ok: true })
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/media/")) {
      return serveMedia(request, response, url.pathname.slice("/media/".length))
    }

    if (request.method === "GET") {
      return serveStatic(response, url.pathname)
    }

    sendJson(response, { error: "Not found" }, 404)
  } catch (error) {
    console.error(error)
    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : String(error),
      },
      error?.statusCode || 500,
    )
  }
})

if (isCliEntry()) {
  server.listen(PORT, () => {
    console.log(`Media library running at http://localhost:${PORT}`)
    console.log(`Media directory: ${MEDIA_DIR}`)
    authBrowser.startAutoRefresh()
    startAutoSyncLoop()
  })
}

async function startSync({ incremental }) {
  resetSyncState({
    mode: incremental ? "incremental" : "full",
    message: incremental ? "Starting incremental sync..." : "Starting full sync...",
  })
  await createCatalogBackup(incremental ? "before-incremental-sync" : "before-full-sync")

  const catalog = await loadCatalog()
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  const downloadQueue = []
  const queuedJobIds = new Set()
  const previousLastSeenJobId = incremental ? catalog.lastSeenJobId : null
  let newestBoundaryJobId = null
  let stoppedAtPrevious = false

  for (const job of getCatalogDownloadQueue(catalog.items, { includeErrors: true })) {
    enqueueDownload(downloadQueue, queuedJobIds, job)
  }

  if (hasApiAuth()) {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      if (shouldStopForCancellation()) {
        break
      }

      syncState.currentPage = page
      syncState.message = `Fetching page ${page}...`

      const jobs = await fetchJobsPage(page)

      if (jobs.length === 0) {
        syncState.message = "Reached the end of the API."
        break
      }

      for (const job of jobs) {
        syncState.scanned += 1

        const existing = itemById.get(job.id)
        const merged = toCatalogItem(job, existing)
        itemById.set(job.id, merged)
        const isBoundaryJob = isIncrementalBoundaryJob(job)
        const reachedPreviousBoundary = Boolean(previousLastSeenJobId && job.id === previousLastSeenJobId && isBoundaryJob)

        if (!newestBoundaryJobId && isBoundaryJob) {
          newestBoundaryJobId = job.id
        }

        if (!isDownloadableJob(job)) {
          syncState.skipped += 1
          if (reachedPreviousBoundary) {
            stoppedAtPrevious = true
            syncState.message = "Reached the previously saved latest settled job."
            break
          }
          continue
        }

        if (existing?.localFile && (await fileExists(path.join(MEDIA_DIR, existing.localFile)))) {
          downloadedJobIds.add(job.id)
          syncState.skipped += 1
          if (reachedPreviousBoundary) {
            stoppedAtPrevious = true
            syncState.message = "Reached the previously saved latest settled job."
            break
          }
          continue
        }

        enqueueDownload(downloadQueue, queuedJobIds, job)

        if (reachedPreviousBoundary) {
          stoppedAtPrevious = true
          syncState.message = "Reached the previously saved latest settled job."
          break
        }
      }

      catalog.items = sortItems(Array.from(itemById.values()))
      catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
      catalog.lastSeenJobId = newestBoundaryJobId || catalog.lastSeenJobId
      catalog.updatedAt = new Date().toISOString()
      await saveCatalog(catalog)

      if (stoppedAtPrevious) {
        break
      }
    }
  } else {
    syncState.message = downloadQueue.length
      ? "No active API auth; downloading known missing files only."
      : "No active API auth and no known missing files to download."
  }

  await runDownloadQueue({
    catalog,
    itemById,
    downloadedJobIds,
    downloadQueue,
    lastSeenJobId: newestBoundaryJobId || catalog.lastSeenJobId,
    startMessage: `Finished API scan. Downloading ${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"}...`,
  })

  const cancelled = Boolean(syncState.cancelRequested)

  if (!cancelled && syncState.currentPage >= PAGE_LIMIT && !stoppedAtPrevious) {
    syncState.errors.push({
      message: `Stopped after page limit ${PAGE_LIMIT}; increase GENERATEPORN_PAGE_LIMIT if needed.`,
    })
  }

  catalog.items = sortItems(Array.from(itemById.values()))
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  catalog.lastSeenJobId = newestBoundaryJobId || catalog.lastSeenJobId
  catalog.updatedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled,
    stoppedAtPrevious,
    finishedAt: new Date().toISOString(),
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished. Downloaded ${syncState.downloaded} new file${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

async function startCatalogDownload({ mode }) {
  const isRetry = mode === "retry-errors"
  resetSyncState({
    mode,
    message: isRetry ? "Preparing failed downloads..." : "Preparing missing downloads...",
  })
  await createCatalogBackup(`before-${mode}`)

  const catalog = await loadCatalog()
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  const downloadQueue = getCatalogDownloadQueue(catalog.items, { retryErrors: isRetry })

  syncState.scanned = catalog.items.length
  syncState.skipped = Math.max(0, catalog.items.length - downloadQueue.length)

  await runDownloadQueue({
    catalog,
    itemById,
    downloadedJobIds,
    downloadQueue,
    lastSeenJobId: catalog.lastSeenJobId,
    startMessage: `Downloading ${downloadQueue.length} ${isRetry ? "failed" : "missing"} file${downloadQueue.length === 1 ? "" : "s"}...`,
  })

  catalog.items = sortItems(Array.from(itemById.values()))
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  catalog.updatedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt: new Date().toISOString(),
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled: catalog.lastRun.cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

function finishSyncRun({ cancelled, finishedAt, completeMessage }) {
  syncState.running = false
  syncState.status = cancelled ? "cancelled" : "idle"
  syncState.cancelRequested = false
  syncState.finishedAt = finishedAt
  syncState.message = cancelled
    ? `Cancelled. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"} before stopping.`
    : completeMessage
}

function requestSyncCancellation() {
  syncState.cancelRequested = true
  syncState.status = "cancelling"
  syncState.message = "Cancellation requested. Stopping after the current step..."
}

function shouldStopForCancellation() {
  if (!syncState.cancelRequested) {
    return false
  }

  syncState.status = "cancelling"
  syncState.message = "Cancelling..."
  return true
}

function startAutoSyncLoop() {
  if (!autoSyncState.enabled) {
    return getAutoSyncStatus()
  }

  scheduleAutoSync("startup", autoSyncState.startupDelayMs)
  return getAutoSyncStatus()
}

function scheduleAutoSync(reason, delayMs) {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
  }

  const delay = Math.max(0, Number(delayMs) || 0)
  autoSyncState.nextRunAt = new Date(Date.now() + delay).toISOString()
  autoSyncTimer = setTimeout(async () => {
    autoSyncTimer = null
    await triggerAutoSync(reason)
    scheduleAutoSync("interval", autoSyncState.intervalMs)
  }, delay)
  autoSyncTimer.unref?.()
}

async function triggerAutoSync(reason = "manual") {
  if (!autoSyncState.enabled) {
    autoSyncState.lastSkippedAt = new Date().toISOString()
    autoSyncState.lastSkipReason = "disabled"
    return { started: false, reason: "disabled" }
  }

  if (syncState.running) {
    autoSyncState.lastSkippedAt = new Date().toISOString()
    autoSyncState.lastSkipReason = "sync-running"
    return { started: false, reason: "sync-running" }
  }

  autoSyncState.lastRunAt = new Date().toISOString()
  autoSyncState.lastReason = reason
  autoSyncState.lastError = null
  autoSyncState.lastSkipReason = null

  try {
    await startSync({ incremental: true })
    return { started: true, reason }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    autoSyncState.lastError = message
    handleBackgroundError(error)
    return { started: false, reason: "error", error: message }
  }
}

function getAutoSyncStatus() {
  return {
    ...autoSyncState,
    timerActive: Boolean(autoSyncTimer),
  }
}

async function startThumbnailGeneration() {
  resetSyncState({
    mode: "generate-thumbnails",
    message: "Preparing video thumbnails...",
  })
  await createCatalogBackup("before-thumbnail-generation")

  const catalog = await loadCatalog()
  const queue = getThumbnailGenerationQueue(catalog.items)

  syncState.scanned = catalog.items.length
  syncState.skipped = Math.max(0, catalog.items.length - queue.length)
  syncState.message = `Generating ${queue.length} video thumbnail${queue.length === 1 ? "" : "s"}...`

  for (const item of queue) {
    if (shouldStopForCancellation()) {
      break
    }

    const thumbnail = await ensureCatalogThumbnail(item.localFile)
    applyCatalogThumbnail(item, thumbnail)
    syncState.downloaded += thumbnail.thumbnailFile ? 1 : 0
    syncState.message = `Generated ${syncState.downloaded} of ${queue.length} thumbnail${queue.length === 1 ? "" : "s"}.`
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)
    await sleep(SYNC_DELAY_MS)
  }

  catalog.updatedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt: new Date().toISOString(),
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled: catalog.lastRun.cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: `Finished. Generated ${syncState.downloaded} thumbnail${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

async function startLibraryVerification() {
  resetSyncState({
    mode: "verify-library",
    message: "Preparing library verification...",
  })
  await createCatalogBackup("before-library-verification")

  const catalog = await loadCatalog()
  const mediaFiles = await getLocalMediaFiles()
  const itemByLocalFile = new Map(catalog.items.filter((item) => item.localFile).map((item) => [item.localFile, item]))
  const orphanFiles = []

  syncState.scanned = mediaFiles.length
  syncState.message = `Verifying ${mediaFiles.length} local file${mediaFiles.length === 1 ? "" : "s"}...`

  for (const [index, file] of mediaFiles.entries()) {
    if (shouldStopForCancellation()) {
      break
    }

    const item = itemByLocalFile.get(file.localFile)
    const existingHash = item?.sha256 && Number(item.fileSize || item.size || 0) === file.size ? item.sha256 : null
    const sha256 = existingHash || (await hashFile(file.absolutePath))
    const verifiedAt = new Date().toISOString()

    if (item) {
      item.size = file.size
      item.fileSize = file.size
      item.contentType = file.contentType
      item.sha256 = sha256
      item.verifiedAt = verifiedAt
      item.downloadError = null
    } else {
      orphanFiles.push({
        localFile: file.localFile,
        size: file.size,
        fileSize: file.size,
        contentType: file.contentType,
        sha256,
        discoveredAt: verifiedAt,
      })
    }

    syncState.downloaded = index + 1
    syncState.message = `Verified ${syncState.downloaded} of ${mediaFiles.length} local file${mediaFiles.length === 1 ? "" : "s"}.`
    await sleep(SYNC_DELAY_MS)
  }

  applyDuplicateMetadata(catalog.items)
  syncState.skipped = Math.max(0, syncState.scanned - syncState.downloaded)
  catalog.orphanFiles = orphanFiles
  catalog.updatedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: Math.max(0, syncState.scanned - syncState.downloaded),
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    orphanFiles: orphanFiles.length,
    duplicateItems: catalog.items.filter((item) => Number(item.duplicateGroupSize || 0) > 1).length,
    finishedAt: new Date().toISOString(),
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled: catalog.lastRun.cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: `Finished. Verified ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}, found ${catalog.lastRun.duplicateItems} duplicate item${catalog.lastRun.duplicateItems === 1 ? "" : "s"} and ${orphanFiles.length} orphan file${orphanFiles.length === 1 ? "" : "s"}.`,
  })
}

function getThumbnailGenerationQueue(items) {
  return items.filter((item) => {
    if (!item.localFile?.toLowerCase().endsWith(".mp4")) {
      return false
    }

    if (item.thumbnailError) {
      return false
    }

    return !item.thumbnailFile
  })
}

function getCatalogDownloadQueue(items, { retryErrors = false, includeErrors = false } = {}) {
  const downloadQueue = []
  const queuedJobIds = new Set()

  for (const item of items) {
    const matchesMode = retryErrors
      ? Boolean(item.downloadError) && !item.localFile
      : !item.localFile && (includeErrors || !item.downloadError)

    if (matchesMode && isDownloadableCatalogItem(item)) {
      enqueueDownload(downloadQueue, queuedJobIds, jobFromCatalogItem(item))
    }
  }

  return downloadQueue
}

async function runDownloadQueue({ catalog, itemById, downloadedJobIds, downloadQueue, lastSeenJobId, startMessage }) {
  syncState.message = startMessage

  for (const job of downloadQueue) {
    if (shouldStopForCancellation()) {
      break
    }

    const existing = itemById.get(job.id)

    try {
      const downloaded = await downloadJob(job)
      itemById.set(
        job.id,
        toCatalogItem(job, {
          ...existing,
          ...downloaded,
          downloadError: null,
        }),
      )
      downloadedJobIds.add(job.id)
      syncState.downloaded += 1
      syncState.message = `Downloaded ${syncState.downloaded} of ${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"}.`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      syncState.errors.push({ id: job.id, message })
      itemById.set(job.id, {
        ...existing,
        downloadError: message,
      })
    }

    catalog.items = sortItems(Array.from(itemById.values()))
    catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
    catalog.lastSeenJobId = lastSeenJobId || catalog.lastSeenJobId
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)

    await sleep(SYNC_DELAY_MS)
  }
}

function resetSyncState({ mode, message }) {
  Object.assign(syncState, {
    running: true,
    status: "running",
    mode,
    currentPage: 0,
    scanned: 0,
    downloaded: 0,
    skipped: 0,
    errors: [],
    cancelRequested: false,
    message,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  })
}

function handleBackgroundError(error) {
  syncState.running = false
  syncState.status = "error"
  syncState.cancelRequested = false
  syncState.message = error instanceof Error ? error.message : String(error)
  syncState.errors.push({ message: syncState.message })
  syncState.finishedAt = new Date().toISOString()
}

async function fetchJobsPage(page) {
  const url = new URL(API_BASE_URL)
  url.searchParams.set("type", "all")
  url.searchParams.set("page", String(page))

  const response = await fetch(url, {
    headers: buildApiHeaders(),
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error(`API returned ${response.status}. ${AUTH_SETUP_MESSAGE}`)
  }

  if (!response.ok) {
    throw new Error(`API request failed on page ${page}: ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.results)) {
    throw new Error(`Unexpected API response on page ${page}: missing results array`)
  }

  return body.results
}

function buildApiHeaders() {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://app.generateporn.ai",
    referer: "https://app.generateporn.ai/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  }

  if (process.env.GENERATEPORN_COOKIE) {
    headers.cookie = process.env.GENERATEPORN_COOKIE
  }

  const authorization = getActiveAuthorization()
  if (authorization) {
    headers.authorization = authorization
  }

  if (process.env.GENERATEPORN_EXTRA_HEADERS_JSON) {
    Object.assign(headers, JSON.parse(process.env.GENERATEPORN_EXTRA_HEADERS_JSON))
  }

  return headers
}

function getJobsApiBaseUrl() {
  return String(API_BASE_URL).replace(/\/+$/, "")
}

function getCreateModeDefinitions(templates = []) {
  const modes = [
    {
      id: "custom-image",
      label: "Edit Image",
      kind: "custom",
      mediaType: "image",
      endpoint: "edit",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fields: [{ name: "prompt", label: "Prompt", type: "textarea", required: true }],
      defaults: {
        seed: null,
      },
    },
    {
      id: "nudify",
      label: "Nudify",
      kind: "preset",
      mediaType: "image",
      endpoint: "edit",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fixed: {
        prompt: "Remove all clothing, fully nude, keep face and pose unchanged",
      },
      fields: [],
    },
    {
      id: "custom-video",
      label: "Custom Video",
      kind: "custom",
      mediaType: "video",
      endpoint: "video",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fields: [
        { name: "prompt", label: "Prompt", type: "textarea", required: true },
        {
          name: "quality",
          label: "Quality",
          type: "select",
          required: true,
          default: "720p-4",
          options: CREATE_VIDEO_QUALITY_OPTIONS.map((option) => ({
            value: `${option.resolution}-${option.duration}`,
            label: option.label,
            resolution: option.resolution,
            duration: option.duration,
          })),
        },
      ],
      defaults: {
        resolution: "720p",
        duration: 4,
        seed: null,
      },
    },
  ]

  for (const template of templates) {
    modes.push(templateToCreateMode(template))
  }

  for (const seed of CREATE_BUILTIN_TEMPLATE_SEEDS) {
    if (!modes.some((mode) => mode.id === seed.id)) {
      modes.push({
        id: seed.id,
        label: seed.label,
        kind: "template",
        mediaType: "video",
        endpoint: "video",
        disabled: true,
        disabledReason: "Import this template from history before use.",
        seedJobId: seed.seedJobId,
        source: {
          required: true,
          acceptedKinds: ["catalog", "upload", "url"],
        },
        fields: [],
      })
    }
  }

  return modes
}

async function getCreateModes() {
  const registry = await loadCreateTemplateRegistry()
  return {
    modes: getCreateModeDefinitions(registry.templates),
    templates: registry.templates,
    pollMs: CREATE_POLL_MS,
    uploadAccept: Array.from(CREATE_IMAGE_ACCEPT).join(","),
  }
}

function templateToCreateMode(template) {
  return {
    id: template.id,
    label: template.label,
    kind: "template",
    mediaType: template.mediaType || "video",
    endpoint: template.endpoint || "video",
    source: {
      required: true,
      acceptedKinds: ["catalog", "upload", "url"],
    },
    fixed: {
      prompt: template.prompt,
      negativePrompt: template.negativePrompt || "",
      resolution: template.resolution || "720p",
      duration: Number(template.duration || 4),
    },
    seedJobId: template.seedJobId || null,
    fields: [],
  }
}

async function createMediaJob(requestBody) {
  const attemptId = `local-${randomUUID()}`
  const requestStartedAt = new Date().toISOString()

  if (!hasApiAuth()) {
    throw new Error(`No active API auth token. ${AUTH_SETUP_MESSAGE}`)
  }

  const registry = await loadCreateTemplateRegistry()
  const modes = getCreateModeDefinitions(registry.templates)
  const mode = modes.find((entry) => entry.id === requestBody?.modeId)

  if (!mode) {
    throw new Error("Unknown creation mode.")
  }

  if (mode.disabled) {
    throw new Error(mode.disabledReason || "Creation mode is disabled.")
  }

  const source = await resolveCreateSource(requestBody.source)
  const liveRequest = buildCreateApiRequest(mode, source, requestBody.params || {})
  const url = `${getJobsApiBaseUrl()}/${mode.endpoint}`
  const baseRecord = {
    id: attemptId,
    status: "submitted",
    modeId: mode.id,
    modeLabel: mode.label,
    mediaType: mode.mediaType || null,
    source: source.publicSource,
    params: requestBody.params || {},
    request: liveRequest.publicRequest,
    requestBody: liveRequest.body,
    createdLocallyAt: requestStartedAt,
    submittedAt: requestStartedAt,
    updatedAt: requestStartedAt,
  }

  saveCreationJob(baseRecord, {
    eventStatus: "submitted",
    eventMessage: "Submitted creation request.",
  })

  let response
  let body
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildApiHeaders(),
      body: JSON.stringify(liveRequest.body),
    })
    body = await response.json().catch(() => ({}))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveCreationJob(
      {
        ...baseRecord,
        status: "error",
        error: message,
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: message,
      },
    )
    throw error
  }

  if (!response.ok) {
    const error = body?.error || `Create request failed: ${response.status} ${response.statusText}`
    const wrapped = new Error(error)
    wrapped.statusCode = response.status
    saveCreationJob(
      {
        ...baseRecord,
        status: "error",
        response: body,
        error,
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: error,
        eventData: body,
      },
    )
    throw wrapped
  }

  if (!body?.job_id) {
    saveCreationJob(
      {
        ...baseRecord,
        status: "error",
        response: body,
        error: "Create response did not include a job_id.",
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: "Create response did not include a job_id.",
        eventData: body,
      },
    )
    throw new Error("Create response did not include a job_id.")
  }

  const creation = {
    ...baseRecord,
    id: body.job_id,
    previousId: attemptId,
    jobId: body.job_id,
    modeId: mode.id,
    modeLabel: mode.label,
    source: source.publicSource,
    params: requestBody.params || {},
    request: liveRequest.publicRequest,
    requestBody: liveRequest.body,
    response: body,
    status: "pending",
    createdLocallyAt: requestStartedAt,
    submittedAt: requestStartedAt,
    updatedAt: new Date().toISOString(),
  }

  moveCreationJob(attemptId, creation)
  addCreationEvent(body.job_id, "pending", "Upstream job accepted.", body)

  return {
    ok: true,
    jobId: body.job_id,
    modeId: mode.id,
    modeLabel: mode.label,
    source: source.publicSource,
    request: liveRequest.publicRequest,
    pollMs: CREATE_POLL_MS,
  }
}

async function pollCreateJob(jobId) {
  const job = await fetchCreateJob(jobId)
  const creation = saveCreationFromJob(job, {
    existing: findCreationJob(jobId),
    eventMessage: `Job ${job.status || "updated"}.`,
  })

  return {
    job: toPublicCreateJob(job),
    createState: creation ? toPublicCreation(creation) : null,
    pollMs: CREATE_POLL_MS,
  }
}

async function downloadCreateJob(jobId) {
  const job = await fetchCreateJob(jobId)

  if (job.status !== "done" || !job.output_url) {
    throw new Error("Creation job is not ready to download.")
  }

  const catalog = await loadCatalog()
  const existing = catalog.items.find((item) => item.id === job.id)
  const createState = findCreationJob(job.id)
  const downloaded = await downloadJob(job)
  const nextItem = toCatalogItem(job, {
    ...existing,
    ...downloaded,
    downloadError: null,
    createModeId: createState?.modeId || existing?.createModeId || null,
    sourceKind: createState?.source?.kind || existing?.sourceKind || null,
    sourceItemId: createState?.source?.itemId || existing?.sourceItemId || null,
    sourceUrl: createState?.source?.url || existing?.sourceUrl || null,
    createdLocallyAt: createState?.createdLocallyAt || existing?.createdLocallyAt || null,
  })
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  itemById.set(job.id, nextItem)
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  downloadedJobIds.add(job.id)

  catalog.items = sortItems(Array.from(itemById.values()))
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  catalog.lastSeenJobId ||= job.id
  catalog.updatedAt = new Date().toISOString()
  await saveCatalog(catalog)
  saveCreationFromJob(job, {
    existing: createState,
    downloadedItemId: nextItem.id,
    eventMessage: "Downloaded to library.",
  })

  return {
    ok: true,
    item: toPublicCatalogItem(nextItem),
  }
}

async function getCreations(searchParams = new URLSearchParams()) {
  const status = searchParams.get("status") || "all"
  const refresh = searchParams.get("refresh") === "true"

  if (refresh && hasApiAuth()) {
    await refreshActiveCreations()
  }

  const rows = listCreationJobs({ status })
  const activeCount = rows.filter((row) => isActiveCreationStatus(row.status)).length

  return {
    creations: rows.map(toPublicCreation),
    activeCount,
    total: rows.length,
    pollMs: activeCount ? CREATE_POLL_MS : 10000,
  }
}

async function getCreationDetails(id) {
  const creation = findCreationJob(id)

  if (!creation) {
    const error = new Error("Creation was not found.")
    error.statusCode = 404
    throw error
  }

  return {
    creation: toPublicCreation(creation, { details: true }),
    events: listCreationEvents(creation.id),
  }
}

async function duplicateCreation(id) {
  const creation = findCreationJob(id)

  if (!creation) {
    const error = new Error("Creation was not found.")
    error.statusCode = 404
    throw error
  }

  const now = new Date().toISOString()
  const draft = {
    id: `draft-${randomUUID()}`,
    status: "draft",
    modeId: creation.modeId,
    modeLabel: creation.modeLabel,
    mediaType: creation.mediaType,
    source: getReusableCreationSource(creation.source),
    params: creation.params || {},
    createdLocallyAt: now,
    updatedAt: now,
  }

  saveCreationJob(draft, {
    eventStatus: "draft",
    eventMessage: `Copied settings from ${creation.jobId || creation.id}.`,
  })

  return {
    ok: true,
    draft: toPublicCreation(draft),
    form: {
      modeId: draft.modeId,
      source: draft.source,
      params: draft.params,
    },
  }
}

async function refreshCreations({ pageLimit = CREATE_HISTORY_PAGE_LIMIT } = {}) {
  if (!hasApiAuth()) {
    throw new Error(`No active API auth token. ${AUTH_SETUP_MESSAGE}`)
  }

  const active = await refreshActiveCreations()
  let imported = 0

  for (let page = 1; page <= pageLimit; page += 1) {
    const jobs = await fetchJobsPage(page)

    if (jobs.length === 0) {
      break
    }

    for (const job of jobs) {
      const existing = findCreationJob(job.id)
      saveCreationFromJob(job, {
        existing,
        eventMessage: existing ? `History refresh saw ${job.status}.` : "Imported from upstream history.",
      })
      if (!existing) {
        imported += 1
      }
    }
  }

  const rows = listCreationJobs({ status: "all" })
  return {
    ok: true,
    refreshed: active.refreshed,
    imported,
    creations: rows.map(toPublicCreation),
    activeCount: rows.filter((row) => isActiveCreationStatus(row.status)).length,
    pollMs: rows.some((row) => isActiveCreationStatus(row.status)) ? CREATE_POLL_MS : 10000,
    total: rows.length,
  }
}

async function refreshActiveCreations() {
  const activeRows = listCreationJobs({ status: "active" }).filter((row) => row.jobId)
  const errors = []
  let refreshed = 0

  for (const row of activeRows) {
    try {
      const job = await fetchCreateJob(row.jobId)
      saveCreationFromJob(job, {
        existing: row,
        eventMessage: `Job ${job.status || "updated"}.`,
      })
      refreshed += 1
    } catch (error) {
      errors.push({
        id: row.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    refreshed,
    errors,
  }
}

async function fetchCreateJob(jobId) {
  if (!hasApiAuth()) {
    throw new Error(`No active API auth token. ${AUTH_SETUP_MESSAGE}`)
  }

  const response = await fetch(`${getJobsApiBaseUrl()}/${encodeURIComponent(jobId)}`, {
    headers: buildApiHeaders(),
  })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(body?.error || `Job request failed: ${response.status} ${response.statusText}`)
  }

  return body
}

function buildCreateApiRequest(mode, source, params = {}) {
  const body = {}
  const prompt = mode.fixed?.prompt || params.prompt

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Prompt is required.")
  }
  assertCreateTextAllowed(prompt, "Prompt")

  if (source.isDataUrl) {
    body.image_base64 = source.value
  } else {
    body.input_url = source.value
  }

  body.prompt = prompt.trim()

  if (mode.endpoint === "video") {
    const quality = getVideoQuality(params, mode)
    body.resolution = quality.resolution
    body.duration = quality.duration

    const negativePrompt = mode.fixed?.negativePrompt ?? mode.fixed?.negative_prompt
    if (negativePrompt) {
      assertCreateTextAllowed(negativePrompt, "Negative prompt")
      body.negative_prompt = negativePrompt
    }
  }

  if (mode.id === "custom-image" || mode.id === "custom-video") {
    body.seed = params.seed ?? mode.defaults?.seed ?? null
  }

  return {
    body,
    publicRequest: redactCreateRequestBody(body),
  }
}

function getVideoQuality(params, mode) {
  if (mode.kind === "template") {
    return {
      resolution: mode.fixed?.resolution || "720p",
      duration: Number(mode.fixed?.duration || 4),
    }
  }

  if (params.quality) {
    const option = CREATE_VIDEO_QUALITY_OPTIONS.find((entry) => `${entry.resolution}-${entry.duration}` === params.quality)
    if (option) {
      return {
        resolution: option.resolution,
        duration: option.duration,
      }
    }
  }

  const resolution = params.resolution || mode.defaults?.resolution || "720p"
  const duration = Number(params.duration || mode.defaults?.duration || 4)
  const allowed = CREATE_VIDEO_QUALITY_OPTIONS.some((entry) => entry.resolution === resolution && entry.duration === duration)

  if (!allowed) {
    throw new Error("Unsupported video quality.")
  }

  return {
    resolution,
    duration,
  }
}

async function resolveCreateSource(source) {
  if (!source?.kind) {
    throw new Error("Source is required.")
  }

  if (source.kind === "url") {
    const url = validateCreateSourceUrl(source.url)
    return {
      value: url,
      isDataUrl: false,
      publicSource: {
        kind: "url",
        url,
      },
    }
  }

  if (source.kind === "upload") {
    const parsed = validateCreateDataUrl(source.dataUrl)
    return {
      value: source.dataUrl,
      isDataUrl: true,
      publicSource: {
        kind: "upload",
        contentType: parsed.contentType,
        size: parsed.byteLength,
      },
    }
  }

  if (source.kind === "catalog") {
    const catalog = await loadCatalog()
    const item = catalog.items.find((entry) => entry.id === source.itemId)

    if (!item) {
      throw new Error("Catalog source item was not found.")
    }

    if (!isImageItem(item)) {
      throw new Error("Creation source must be an image.")
    }
    assertCreateTextAllowed(item.prompt, "Source prompt")
    assertCreateTextAllowed(item.negativePrompt, "Source negative prompt")

    if (item.outputUrl) {
      const url = validateCreateSourceUrl(item.outputUrl)
      return {
        value: url,
        isDataUrl: false,
        publicSource: {
          kind: "catalog",
          itemId: item.id,
          url,
        },
      }
    }

    if (!item.localFile) {
      throw new Error("Catalog source item does not have a usable image URL or local file.")
    }

    const dataUrl = await catalogItemToDataUrl(item)
    const parsed = validateCreateDataUrl(dataUrl)
    return {
      value: dataUrl,
      isDataUrl: true,
      publicSource: {
        kind: "catalog",
        itemId: item.id,
        contentType: parsed.contentType,
        size: parsed.byteLength,
      },
    }
  }

  throw new Error("Unsupported source kind.")
}

async function catalogItemToDataUrl(item) {
  const filePath = path.resolve(MEDIA_DIR, item.localFile)
  const mediaRoot = path.resolve(MEDIA_DIR)

  if (!filePath.startsWith(`${mediaRoot}${path.sep}`)) {
    throw new Error("Catalog source file is outside the media directory.")
  }

  const contentType = contentTypeFor(filePath)
  if (!CREATE_IMAGE_ACCEPT.has(contentType)) {
    throw new Error("Catalog source file must be a supported image type.")
  }

  const bytes = await readFile(filePath)
  return `data:${contentType};base64,${bytes.toString("base64")}`
}

function validateCreateSourceUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") {
      throw new Error("Source URL must use https.")
    }

    return url.href
  } catch (error) {
    if (error instanceof Error && error.message === "Source URL must use https.") {
      throw error
    }

    throw new Error("Source URL is not valid.", { cause: error })
  }
}

function assertCreateTextAllowed(value, label = "Text") {
  if (!value) {
    return
  }

  const text = String(value)
  if (CREATE_DISALLOWED_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    const error = new Error(`${label} contains disallowed age or consent language.`)
    error.statusCode = 400
    throw error
  }
}

function validateCreateDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) {
    throw new Error("Upload source must be an image data URL.")
  }

  const contentType = match[1].toLowerCase()
  if (!CREATE_IMAGE_ACCEPT.has(contentType)) {
    throw new Error("Upload source must be a JPEG, PNG, WebP, or BMP image.")
  }

  return {
    contentType,
    byteLength: Buffer.byteLength(match[2], "base64"),
  }
}

function redactCreateRequestBody(body) {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (key === "image_base64") {
        return [key, "[image data URL omitted]"]
      }

      return [key, value]
    }),
  )
}

function toPublicCreateJob(job) {
  return {
    id: job.id,
    type: job.type,
    inputUrl: job.input_url || null,
    prompt: job.prompt || "",
    negativePrompt: job.negative_prompt || "",
    resolution: job.resolution || null,
    duration: job.duration || null,
    seed: job.seed ?? null,
    externalTaskId: job.external_task_id || null,
    outputUrl: job.output_url || null,
    status: job.status,
    error: job.error || null,
    createdAt: job.created_at || null,
    createdAtIso: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : null,
  }
}

function saveCreationFromJob(job, options = {}) {
  const existing = options.existing || findCreationJob(job.id)
  const publicJob = toPublicCreateJob(job)
  const status = publicJob.status || existing?.status || "pending"
  const now = new Date().toISOString()
  const creation = {
    ...existing,
    id: existing?.id || job.id,
    jobId: job.id,
    status,
    modeId: existing?.modeId || inferCreateModeId(job),
    modeLabel: existing?.modeLabel || inferCreateModeLabel(job),
    mediaType: existing?.mediaType || (job.type === "video" ? "video" : "image"),
    source: existing?.source || sourceFromCreateJob(job),
    params: existing?.params || paramsFromCreateJob(job),
    response: existing?.response || null,
    job: publicJob,
    error: job.error || null,
    inputUrl: job.input_url || null,
    outputUrl: job.output_url || null,
    externalTaskId: job.external_task_id || null,
    createdAt: job.created_at || existing?.createdAt || null,
    createdAtIso: publicJob.createdAtIso || existing?.createdAtIso || null,
    createdLocallyAt: existing?.createdLocallyAt || publicJob.createdAtIso || now,
    submittedAt: existing?.submittedAt || publicJob.createdAtIso || null,
    updatedAt: now,
    finishedAt: isTerminalCreationStatus(status) ? existing?.finishedAt || now : null,
    downloadedItemId: options.downloadedItemId || existing?.downloadedItemId || null,
  }

  saveCreationJob(creation, {
    eventStatus: status,
    eventMessage: options.eventMessage,
    eventData: publicJob,
  })

  return creation
}

function inferCreateModeId(job) {
  return job.type === "video" ? "custom-video" : "custom-image"
}

function inferCreateModeLabel(job) {
  return job.type === "video" ? "Custom Video" : "Edit Image"
}

function paramsFromCreateJob(job) {
  const params = {}

  if (job.prompt) {
    params.prompt = job.prompt
  }

  if (job.resolution && job.duration) {
    params.quality = `${job.resolution}-${job.duration}`
  }

  return params
}

function sourceFromCreateJob(job) {
  if (job.input_url) {
    return {
      kind: "url",
      url: job.input_url,
    }
  }

  return null
}

function getReusableCreationSource(source) {
  if (!source?.kind) {
    return null
  }

  if (source.kind === "catalog" && source.itemId) {
    return {
      kind: "catalog",
      itemId: source.itemId,
    }
  }

  if (source.kind === "url" && source.url) {
    return {
      kind: "url",
      url: source.url,
    }
  }

  return {
    kind: source.kind,
  }
}

function isTerminalCreationStatus(status) {
  return CREATE_TERMINAL_STATUSES.has(String(status || "").toLowerCase())
}

function isActiveCreationStatus(status) {
  const normalized = String(status || "").toLowerCase()
  return CREATE_ACTIVE_STATUSES.has(normalized) || (!isTerminalCreationStatus(normalized) && normalized !== "draft")
}

async function loadCreateTemplateRegistry() {
  await ensureCreateTemplateJsonMigrated()

  return normalizeCreateTemplateRegistry(readCatalogMeta("createTemplateRegistry") || {})
}

async function saveCreateTemplateRegistry(registry) {
  await mkdir(MEDIA_DIR, { recursive: true })
  const body = {
    templates: registry.templates.map(normalizeCreateTemplate).filter(Boolean),
    updatedAt: new Date().toISOString(),
  }
  writeCatalogMeta("createTemplateRegistry", body)
  return body
}

async function ensureCreateTemplateJsonMigrated() {
  if (createTemplateJsonMigrationChecked) {
    await archiveLegacyJsonFile(CREATE_TEMPLATES_PATH, "ignored")
    return
  }

  createTemplateJsonMigrationChecked = true

  if (!(await fileExists(CREATE_TEMPLATES_PATH))) {
    return
  }

  if (!readCatalogMeta("createTemplateRegistry")) {
    const parsed = JSON.parse(await readFile(CREATE_TEMPLATES_PATH, "utf8"))
    writeCatalogMeta("createTemplateRegistry", normalizeCreateTemplateRegistry(parsed))
    await archiveLegacyJsonFile(CREATE_TEMPLATES_PATH, "migrated")
    return
  }

  await archiveLegacyJsonFile(CREATE_TEMPLATES_PATH, "ignored")
}

function normalizeCreateTemplateRegistry(registry = {}) {
  return {
    templates: Array.isArray(registry.templates) ? registry.templates.map(normalizeCreateTemplate).filter(Boolean) : [],
    updatedAt: registry.updatedAt || null,
  }
}

function normalizeCreateTemplate(template) {
  if (!template?.id || !template?.label || !template?.prompt) {
    return null
  }

  assertCreateTextAllowed(template.prompt, "Template prompt")
  assertCreateTextAllowed(template.negativePrompt || template.negative_prompt, "Template negative prompt")

  return {
    id: sanitizePathPart(template.id).toLowerCase(),
    label: String(template.label).trim(),
    endpoint: template.endpoint || "video",
    mediaType: template.mediaType || "video",
    prompt: String(template.prompt),
    negativePrompt: template.negativePrompt || template.negative_prompt || "",
    resolution: template.resolution || "720p",
    duration: Number(template.duration || 4),
    sourcePolicy: template.sourcePolicy || "image",
    seedJobId: template.seedJobId || null,
    createdAt: template.createdAt || new Date().toISOString(),
    updatedAt: template.updatedAt || new Date().toISOString(),
  }
}

async function importCreateTemplateFromHistory(body) {
  const jobId = body?.jobId
  if (!jobId) {
    throw new Error("Template jobId is required.")
  }

  const job = await findJobForTemplate(jobId)
  if (!job) {
    throw new Error("Template seed job was not found in catalog or API history.")
  }

  if (job.type !== "video" || !job.prompt) {
    throw new Error("Template seed job must be a video job with a prompt.")
  }

  const registry = await loadCreateTemplateRegistry()
  const now = new Date().toISOString()
  const template = normalizeCreateTemplate({
    id: body.id || templateIdFromLabel(body.label) || templateIdFromJob(job),
    label: body.label || templateLabelFromJob(job),
    prompt: job.prompt,
    negativePrompt: job.negative_prompt || job.negativePrompt || "",
    resolution: job.resolution || "720p",
    duration: Number(job.duration || 4),
    seedJobId: job.id,
    createdAt: now,
    updatedAt: now,
  })
  const nextTemplates = registry.templates.filter((entry) => entry.id !== template.id)
  nextTemplates.push(template)
  await saveCreateTemplateRegistry({
    templates: nextTemplates,
  })

  return template
}

async function findJobForTemplate(jobId) {
  const catalog = await loadCatalog()
  const item = catalog.items.find((entry) => entry.id === jobId)
  if (item) {
    return jobFromCatalogItem(item)
  }

  if (!hasApiAuth()) {
    return null
  }

  for (let page = 1; page <= CREATE_HISTORY_PAGE_LIMIT; page += 1) {
    const jobs = await fetchJobsPage(page)
    const job = jobs.find((entry) => entry.id === jobId)
    if (job) {
      return job
    }

    if (jobs.length === 0) {
      break
    }
  }

  return null
}

function templateIdFromLabel(label) {
  return label ? sanitizePathPart(label).toLowerCase() : null
}

function templateIdFromJob(job) {
  const seed = CREATE_BUILTIN_TEMPLATE_SEEDS.find((entry) => entry.seedJobId === job.id)
  return seed?.id || `template-${job.id}`
}

function templateLabelFromJob(job) {
  const seed = CREATE_BUILTIN_TEMPLATE_SEEDS.find((entry) => entry.seedJobId === job.id)
  return seed?.label || `Template ${String(job.id).slice(0, 8)}`
}

async function downloadJob(job) {
  const normalizedJob = normalizeJob(job)
  const filename = buildFilename(normalizedJob)
  const localPath = path.join(MEDIA_DIR, filename)
  await mkdir(path.dirname(localPath), { recursive: true })

  const response = await fetch(normalizedJob.output_url, {
    headers: {
      accept: "*/*",
      referer: "https://app.generateporn.ai/",
    },
  })

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  const tempPath = `${localPath}.tmp`
  await writeFile(tempPath, bytes)
  await rename(tempPath, localPath)
  const thumbnail = await ensureCatalogThumbnail(filename)

  return {
    localFile: filename,
    size: bytes.byteLength,
    fileSize: bytes.byteLength,
    sha256: hashBuffer(bytes),
    verifiedAt: new Date().toISOString(),
    contentType: response.headers.get("content-type") || null,
    ...thumbnail,
    downloadedAt: new Date().toISOString(),
  }
}

function toCatalogItem(job, existing = {}) {
  return {
    ...existing,
    id: job.id,
    userId: job.user_id,
    type: job.type,
    prompt: job.prompt || "",
    negativePrompt: job.negative_prompt || "",
    status: job.status,
    outputUrl: job.output_url || null,
    inputUrl: job.input_url || null,
    duration: normalizeDurationSeconds(job.duration ?? existing.duration),
    createdAt: job.created_at || null,
    createdAtIso: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : null,
    externalTaskId: job.external_task_id || null,
    shared: Boolean(job.shared),
    favorited: Boolean(job.favorited),
    error: job.error || null,
    updatedAt: new Date().toISOString(),
  }
}

function isDownloadableJob(job) {
  return Boolean(job?.id && job.status === "done" && typeof job.output_url === "string" && /\.(png|mp4)(?:[?#].*)?$/i.test(job.output_url))
}

function normalizeDurationSeconds(value) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

function isIncrementalBoundaryJob(job) {
  return Boolean(job?.id && ((job.status === "done" && typeof job.output_url === "string" && job.output_url) || isTerminalErrorJob(job)))
}

function isTerminalErrorJob(job) {
  const status = String(job?.status || "").toLowerCase()
  return Boolean(
    job?.id &&
    (["failed", "error", "cancelled", "canceled"].includes(status) ||
      (status !== "done" && typeof job?.error === "string" && job.error.trim())),
  )
}

function buildFilename(job) {
  const normalizedJob = normalizeJob(job)
  const extension = getExtension(normalizedJob.output_url)
  const date = normalizedJob.created_at ? new Date(Number(normalizedJob.created_at) * 1000).toISOString().slice(0, 10) : "undated"
  const type = sanitizePathPart(normalizedJob.type || "media")
  const id = sanitizePathPart(normalizedJob.id)

  return `${date}/${date}_${type}_${id}.${extension}`
}

function getExtension(url) {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1]?.toLowerCase() || "bin"
  } catch {
    const match = url.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)
    return match?.[1]?.toLowerCase() || "bin"
  }
}

async function getItems(searchParams) {
  const catalog = await loadCatalog()
  const query = (searchParams.get("q") || "").trim().toLowerCase()
  const media = searchParams.get("media") || "all"
  const status = searchParams.get("status") || "all"
  const sort = searchParams.get("sort") || "newest"
  const page = Math.max(1, Number(searchParams.get("page") || 1))
  const pageSize = clamp(Number(searchParams.get("pageSize") || 60), 12, 240)

  let items = catalog.items || []
  const facets = buildFacets(items)

  if (media !== "all") {
    items = items.filter((item) => {
      if (media === "image") return isImageItem(item)
      if (media === "video") return isVideoItem(item)
      return true
    })
  }

  if (status !== "all") {
    items = items.filter((item) => {
      if (status === "downloaded") return Boolean(item.localFile)
      if (status === "missing") return !item.localFile && !item.downloadError
      if (status === "error") return Boolean(item.downloadError)
      if (status === "favorited") return Boolean(item.favorited)
      if (status === "duplicate") return Number(item.duplicateGroupSize || 0) > 1
      if (status === "unverified") return Boolean(item.localFile) && !item.sha256
      return true
    })
  }

  if (query) {
    items = items.filter((item) =>
      [item.id, item.type, item.prompt, item.negativePrompt, item.localFile].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      ),
    )
  }

  items = sortItemsForView(items, sort)
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)

  return {
    items: pageItems.map(toPublicCatalogItem),
    total,
    page: currentPage,
    pageSize,
    pageCount,
    facets: {
      ...facets,
      orphanFiles: catalog.orphanFiles?.length || 0,
    },
    catalogUpdatedAt: catalog.updatedAt || null,
    lastSeenJobId: catalog.lastSeenJobId || null,
    lastRun: catalog.lastRun || null,
  }
}

function buildFacets(items) {
  const media = {
    all: items.length,
    image: 0,
    video: 0,
  }
  const status = {
    all: items.length,
    downloaded: 0,
    missing: 0,
    error: 0,
    favorited: 0,
    duplicate: 0,
    unverified: 0,
  }

  for (const item of items) {
    if (isImageItem(item)) media.image += 1
    if (isVideoItem(item)) media.video += 1
    if (item.localFile) status.downloaded += 1
    if (!item.localFile && !item.downloadError) status.missing += 1
    if (item.downloadError) status.error += 1
    if (item.favorited) status.favorited += 1
    if (Number(item.duplicateGroupSize || 0) > 1) status.duplicate += 1
    if (item.localFile && !item.sha256) status.unverified += 1
  }

  return {
    media,
    status,
  }
}

function toPublicCatalogItem(item) {
  return {
    ...item,
    posterUrl: item.thumbnailFile ? mediaUrlForLocalFile(item.thumbnailFile) : null,
  }
}

function mediaUrlForLocalFile(localFile) {
  return `/media/${String(localFile).split("/").map(encodeURIComponent).join("/")}`
}

function sortItemsForView(items, sort) {
  return items.toSorted((a, b) => {
    if (sort === "oldest") return Number(a.createdAt || 0) - Number(b.createdAt || 0)
    if (sort === "largest") return Number(b.size || 0) - Number(a.size || 0)
    if (sort === "smallest") return Number(a.size || 0) - Number(b.size || 0)
    if (sort === "type")
      return String(a.type || "").localeCompare(String(b.type || "")) || Number(b.createdAt || 0) - Number(a.createdAt || 0)
    return Number(b.createdAt || 0) - Number(a.createdAt || 0)
  })
}

function isImageItem(item) {
  return /\.(png|jpe?g|webp|bmp)$/i.test(item.localFile || "") || item.outputUrl?.toLowerCase().match(/\.(png|jpe?g|webp|bmp)(?:[?#].*)?$/)
}

function isVideoItem(item) {
  return item.localFile?.toLowerCase().endsWith(".mp4") || item.outputUrl?.toLowerCase().match(/\.mp4(?:[?#].*)?$/)
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

async function loadCatalog() {
  await ensureCatalogJsonMigrated()

  const catalog = readCatalogFromDb()
  const changed = await reconcileCatalogWithLocalFiles(catalog)

  if (changed) {
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)
  }

  return catalog
}

async function reconcileCatalogWithLocalFiles(catalog) {
  const filesById = await getLocalMediaFilesByJobId()
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  let changed = false

  for (const item of catalog.items) {
    const localFile = filesById.get(item.id)

    if (localFile) {
      if (item.localFile !== localFile.localFile || item.size !== localFile.size || item.contentType !== localFile.contentType) {
        item.localFile = localFile.localFile
        item.size = localFile.size
        item.fileSize = localFile.size
        item.contentType = localFile.contentType
        item.downloadedAt ||= localFile.downloadedAt
        item.downloadError = null
        changed = true
      }

      if (await reconcileCatalogItemThumbnail(item)) {
        changed = true
      }

      downloadedJobIds.add(item.id)
      continue
    }

    if (item.localFile) {
      item.localFile = null
      item.size = null
      item.fileSize = null
      item.sha256 = null
      item.verifiedAt = null
      item.duplicateOf = null
      item.duplicateGroupSize = null
      item.contentType = null
      item.thumbnailFile = null
      item.thumbnailGeneratedAt = null
      item.thumbnailError = null
      changed = true
    }
  }

  const nextDownloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  if (JSON.stringify(catalog.downloadedJobIds || []) !== JSON.stringify(nextDownloadedJobIds)) {
    catalog.downloadedJobIds = nextDownloadedJobIds
    changed = true
  }

  return changed
}

function applyDuplicateMetadata(items) {
  const groups = new Map()

  for (const item of items) {
    item.duplicateOf = null
    item.duplicateGroupSize = null

    if (!item.sha256 || !item.localFile) {
      continue
    }

    const key = `${item.sha256}:${item.fileSize || item.size || 0}`
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue
    }

    const canonical = group.toSorted(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id).localeCompare(String(b.id)),
    )[0]

    for (const item of group) {
      item.duplicateGroupSize = group.length
      item.duplicateOf = item.id === canonical.id ? null : canonical.id
    }
  }
}

async function reconcileCatalogItemThumbnail(item) {
  if (!item.localFile?.toLowerCase().endsWith(".mp4")) {
    if (item.thumbnailFile || item.thumbnailError) {
      item.thumbnailFile = null
      item.thumbnailGeneratedAt = null
      item.thumbnailError = null
      return true
    }

    return false
  }

  if (item.thumbnailFile && (await fileExists(path.join(MEDIA_DIR, item.thumbnailFile)))) {
    return false
  }

  if (item.thumbnailFile) {
    item.thumbnailFile = null
    item.thumbnailGeneratedAt = null
    return true
  }

  return false
}

async function ensureCatalogThumbnail(localFile) {
  const result = await ensureVideoThumbnail(MEDIA_DIR, localFile)

  if (result.thumbnailFile) {
    return {
      thumbnailFile: result.thumbnailFile,
      thumbnailGeneratedAt: result.generatedAt || null,
      thumbnailError: null,
    }
  }

  if (result.error) {
    return {
      thumbnailFile: null,
      thumbnailGeneratedAt: null,
      thumbnailError: result.error,
    }
  }

  return {}
}

function applyCatalogThumbnail(item, thumbnail) {
  let changed = false

  for (const key of ["thumbnailFile", "thumbnailGeneratedAt", "thumbnailError"]) {
    if (Object.hasOwn(thumbnail, key) && item[key] !== thumbnail[key]) {
      item[key] = thumbnail[key]
      changed = true
    }
  }

  return changed
}

async function getLocalMediaFilesByJobId() {
  const files = new Map()
  const entries = await getLocalMediaFiles()

  for (const file of entries) {
    const filename = path.basename(file.absolutePath)
    const match = filename.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|mp4)$/i)

    if (!match) {
      continue
    }

    files.set(match[1], {
      localFile: file.localFile,
      size: file.size,
      contentType: file.contentType,
      downloadedAt: file.downloadedAt,
    })
  }

  return files
}

async function getLocalMediaFiles() {
  const entries = await listMediaFiles(MEDIA_DIR)
  const files = []

  for (const filePath of entries) {
    const fileStat = await stat(filePath)
    const localFile = path.relative(MEDIA_DIR, filePath).split(path.sep).join("/")

    files.push({
      absolutePath: filePath,
      localFile,
      size: fileStat.size,
      contentType: contentTypeFor(filePath),
      downloadedAt: fileStat.mtime.toISOString(),
    })
  }

  return files.toSorted((a, b) => a.localFile.localeCompare(b.localFile))
}

async function listMediaFiles(directory) {
  let entries

  try {
    entries = await readdir(directory, {
      withFileTypes: true,
    })
  } catch {
    return []
  }

  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listMediaFiles(entryPath)))
      continue
    }

    if (entry.isFile() && /\.(png|mp4)$/i.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

function hashBuffer(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)

    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function enqueueDownload(downloadQueue, queuedJobIds, job) {
  if (!job?.id || queuedJobIds.has(job.id)) {
    return
  }

  downloadQueue.push(job)
  queuedJobIds.add(job.id)
}

function isDownloadableCatalogItem(item) {
  return Boolean(
    item?.id && item.status === "done" && typeof item.outputUrl === "string" && /\.(png|mp4)(?:[?#].*)?$/i.test(item.outputUrl),
  )
}

function jobFromCatalogItem(item) {
  return {
    id: item.id,
    user_id: item.userId,
    type: item.type,
    prompt: item.prompt,
    negative_prompt: item.negativePrompt,
    status: item.status,
    output_url: item.outputUrl,
    input_url: item.inputUrl,
    created_at: item.createdAt,
    external_task_id: item.externalTaskId,
    shared: item.shared,
    favorited: item.favorited,
    error: item.error,
  }
}

function normalizeJob(job) {
  return {
    ...job,
    output_url: job.output_url || job.outputUrl,
    created_at: job.created_at || job.createdAt,
    user_id: job.user_id || job.userId,
    negative_prompt: job.negative_prompt || job.negativePrompt,
    input_url: job.input_url || job.inputUrl,
    external_task_id: job.external_task_id || job.externalTaskId,
  }
}

async function ensureCatalogJsonMigrated() {
  if (catalogJsonMigrationChecked) {
    await archiveLegacyJsonFile(CATALOG_PATH, "ignored")
    return
  }

  catalogJsonMigrationChecked = true
  const db = getCatalogDb()

  if (!(await fileExists(CATALOG_PATH))) {
    return
  }

  if (isCatalogDbEmpty(db)) {
    const parsed = JSON.parse(await readFile(CATALOG_PATH, "utf8"))
    writeCatalogToDb(normalizeCatalog(parsed))
    await archiveLegacyJsonFile(CATALOG_PATH, "migrated")
    return
  }

  await archiveLegacyJsonFile(CATALOG_PATH, "ignored")
}

function getCatalogDb() {
  if (catalogDb) {
    return catalogDb
  }

  catalogDb = new DatabaseSync(CATALOG_DB_PATH)
  catalogDb.exec("PRAGMA journal_mode = DELETE")
  catalogDb.exec("PRAGMA foreign_keys = ON")
  catalogDb.exec("PRAGMA busy_timeout = 5000")
  ensureCatalogSchema(catalogDb)
  return catalogDb
}

function ensureCatalogSchema(db) {
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

    CREATE TABLE IF NOT EXISTS creation_jobs (
      id TEXT PRIMARY KEY,
      job_id TEXT UNIQUE,
      status TEXT NOT NULL,
      mode_id TEXT,
      mode_label TEXT,
      media_type TEXT,
      source_json TEXT,
      params_json TEXT,
      request_json TEXT,
      request_body_json TEXT,
      response_json TEXT,
      job_json TEXT,
      error TEXT,
      input_url TEXT,
      output_url TEXT,
      external_task_id TEXT,
      created_at INTEGER,
      created_at_iso TEXT,
      created_locally_at TEXT,
      submitted_at TEXT,
      updated_at TEXT,
      finished_at TEXT,
      downloaded_item_id TEXT
    );

    CREATE INDEX IF NOT EXISTS creation_jobs_status_idx ON creation_jobs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS creation_jobs_job_id_idx ON creation_jobs(job_id);

    CREATE TABLE IF NOT EXISTS creation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      event_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS creation_events_creation_id_idx ON creation_events(creation_id, id ASC);
  `)
}

function isCatalogDbEmpty(db) {
  const mediaCount = db.prepare("SELECT COUNT(*) AS count FROM media_items").get().count
  const metaCount = db
    .prepare("SELECT COUNT(*) AS count FROM catalog_meta WHERE key IN ('lastSeenJobId', 'updatedAt', 'lastRun')")
    .get().count
  return Number(mediaCount || 0) === 0 && Number(metaCount || 0) === 0
}

function readCatalogFromDb() {
  const db = getCatalogDb()
  const metaRows = db.prepare("SELECT key, value_json FROM catalog_meta").all()
  const meta = new Map(metaRows.map((row) => [row.key, parseJson(row.value_json, null)]))
  const itemRows = db.prepare("SELECT item_json FROM media_items ORDER BY created_at DESC, id ASC").all()
  const downloadedRows = db.prepare("SELECT id FROM downloaded_job_ids ORDER BY position ASC").all()
  const orphanRows = db.prepare("SELECT file_json FROM orphan_files ORDER BY local_file ASC").all()

  return normalizeCatalog({
    items: itemRows.map((row) => parseJson(row.item_json, null)).filter(Boolean),
    downloadedJobIds: downloadedRows.map((row) => row.id),
    orphanFiles: orphanRows.map((row) => parseJson(row.file_json, null)).filter(Boolean),
    lastSeenJobId: meta.get("lastSeenJobId") || null,
    updatedAt: meta.get("updatedAt") || null,
    lastRun: meta.get("lastRun") || null,
  })
}

function writeCatalogToDb(catalog) {
  const db = getCatalogDb()
  const normalized = normalizeCatalog(catalog)

  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec("DELETE FROM media_items")
    db.exec("DELETE FROM downloaded_job_ids")
    db.exec("DELETE FROM orphan_files")

    const insertItem = db.prepare("INSERT INTO media_items (id, item_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
    for (const item of normalized.items) {
      if (!item?.id) {
        continue
      }

      insertItem.run(item.id, JSON.stringify(item), Number(item.createdAt || 0), item.updatedAt || null)
    }

    const insertDownloaded = db.prepare("INSERT INTO downloaded_job_ids (id, position) VALUES (?, ?)")
    normalized.downloadedJobIds.forEach((id, index) => {
      insertDownloaded.run(id, index)
    })

    const insertOrphan = db.prepare("INSERT INTO orphan_files (local_file, file_json) VALUES (?, ?)")
    for (const file of normalized.orphanFiles) {
      if (file?.localFile) {
        insertOrphan.run(file.localFile, JSON.stringify(file))
      }
    }

    const upsertMeta = db.prepare(`
      INSERT INTO catalog_meta (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `)
    upsertMeta.run("lastSeenJobId", JSON.stringify(normalized.lastSeenJobId || null))
    upsertMeta.run("updatedAt", JSON.stringify(normalized.updatedAt || null))
    upsertMeta.run("lastRun", JSON.stringify(normalized.lastRun || null))

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function readCatalogMeta(key) {
  const row = getCatalogDb().prepare("SELECT value_json FROM catalog_meta WHERE key = ?").get(key)
  return row ? parseJson(row.value_json, null) : null
}

function writeCatalogMeta(key, value) {
  getCatalogDb()
    .prepare(`
      INSERT INTO catalog_meta (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `)
    .run(key, JSON.stringify(value))
}

function saveCreationJob(creation, event = {}) {
  const existing = creation.id ? findCreationJob(creation.id) : null
  const next = normalizeCreationJob({
    ...existing,
    ...creation,
    updatedAt: creation.updatedAt || new Date().toISOString(),
  })
  const db = getCatalogDb()

  db.prepare(`
    INSERT INTO creation_jobs (
      id,
      job_id,
      status,
      mode_id,
      mode_label,
      media_type,
      source_json,
      params_json,
      request_json,
      request_body_json,
      response_json,
      job_json,
      error,
      input_url,
      output_url,
      external_task_id,
      created_at,
      created_at_iso,
      created_locally_at,
      submitted_at,
      updated_at,
      finished_at,
      downloaded_item_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      job_id = excluded.job_id,
      status = excluded.status,
      mode_id = excluded.mode_id,
      mode_label = excluded.mode_label,
      media_type = excluded.media_type,
      source_json = excluded.source_json,
      params_json = excluded.params_json,
      request_json = excluded.request_json,
      request_body_json = excluded.request_body_json,
      response_json = excluded.response_json,
      job_json = excluded.job_json,
      error = excluded.error,
      input_url = excluded.input_url,
      output_url = excluded.output_url,
      external_task_id = excluded.external_task_id,
      created_at = excluded.created_at,
      created_at_iso = excluded.created_at_iso,
      created_locally_at = excluded.created_locally_at,
      submitted_at = excluded.submitted_at,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at,
      downloaded_item_id = excluded.downloaded_item_id
  `).run(
    next.id,
    next.jobId,
    next.status,
    next.modeId,
    next.modeLabel,
    next.mediaType,
    stringifyNullable(next.source),
    stringifyNullable(next.params),
    stringifyNullable(next.request),
    stringifyNullable(next.requestBody ? redactCreateRequestBody(next.requestBody) : null),
    stringifyNullable(next.response),
    stringifyNullable(next.job),
    next.error,
    next.inputUrl,
    next.outputUrl,
    next.externalTaskId,
    next.createdAt,
    next.createdAtIso,
    next.createdLocallyAt,
    next.submittedAt,
    next.updatedAt,
    next.finishedAt,
    next.downloadedItemId,
  )

  const eventStatus = event.eventStatus || (existing?.status !== next.status ? next.status : null)
  if (eventStatus && (event.eventMessage || existing?.status !== next.status || !existing)) {
    addCreationEvent(next.id, eventStatus, event.eventMessage || `Status changed to ${eventStatus}.`, event.eventData || null)
  }

  return next
}

function moveCreationJob(previousId, creation) {
  const db = getCatalogDb()
  const existing = findCreationJob(previousId)

  if (existing && previousId !== creation.id) {
    db.prepare("DELETE FROM creation_jobs WHERE id = ?").run(previousId)
    db.prepare("UPDATE creation_events SET creation_id = ? WHERE creation_id = ?").run(creation.id, previousId)
  }

  return saveCreationJob({
    ...existing,
    ...creation,
  })
}

function addCreationEvent(creationId, status, message, data = null) {
  getCatalogDb()
    .prepare("INSERT INTO creation_events (creation_id, status, message, event_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(creationId, String(status || "updated"), message || null, stringifyNullable(data), new Date().toISOString())
}

function findCreationJob(id) {
  if (!id) {
    return null
  }

  const row = getCatalogDb().prepare("SELECT * FROM creation_jobs WHERE id = ? OR job_id = ? LIMIT 1").get(id, id)

  return row ? creationJobFromRow(row) : null
}

function listCreationJobs({ status = "all", limit = 80 } = {}) {
  const rows = getCatalogDb()
    .prepare("SELECT * FROM creation_jobs ORDER BY updated_at DESC, created_locally_at DESC LIMIT ?")
    .all(limit)
    .map(creationJobFromRow)
  const filtered = rows.filter((row) => {
    if (status === "active") return isActiveCreationStatus(row.status)
    if (status === "finished") return isTerminalCreationStatus(row.status)
    return true
  })

  return filtered.toSorted((a, b) => {
    const activeDelta = Number(isActiveCreationStatus(b.status)) - Number(isActiveCreationStatus(a.status))
    if (activeDelta) return activeDelta
    return String(b.updatedAt || b.createdLocallyAt || "").localeCompare(String(a.updatedAt || a.createdLocallyAt || ""))
  })
}

function listCreationEvents(creationId) {
  return getCatalogDb()
    .prepare("SELECT id, status, message, event_json, created_at FROM creation_events WHERE creation_id = ? ORDER BY id ASC")
    .all(creationId)
    .map((row) => ({
      id: row.id,
      status: row.status,
      message: row.message,
      data: parseJson(row.event_json, null),
      createdAt: row.created_at,
    }))
}

function normalizeCreationJob(creation = {}) {
  const now = new Date().toISOString()

  return {
    id: creation.id || creation.jobId || `local-${randomUUID()}`,
    jobId: creation.jobId || creation.job_id || null,
    status: creation.status || "draft",
    modeId: creation.modeId || creation.mode_id || null,
    modeLabel: creation.modeLabel || creation.mode_label || null,
    mediaType: creation.mediaType || creation.media_type || null,
    source: creation.source || null,
    params: creation.params || {},
    request: creation.request || null,
    requestBody: creation.requestBody || null,
    response: creation.response || null,
    job: creation.job || null,
    error: creation.error || null,
    inputUrl: creation.inputUrl || creation.input_url || null,
    outputUrl: creation.outputUrl || creation.output_url || null,
    externalTaskId: creation.externalTaskId || creation.external_task_id || null,
    createdAt: creation.createdAt || creation.created_at || null,
    createdAtIso: creation.createdAtIso || creation.created_at_iso || null,
    createdLocallyAt: creation.createdLocallyAt || creation.created_locally_at || now,
    submittedAt: creation.submittedAt || creation.submitted_at || null,
    updatedAt: creation.updatedAt || creation.updated_at || now,
    finishedAt: creation.finishedAt || creation.finished_at || null,
    downloadedItemId: creation.downloadedItemId || creation.downloaded_item_id || null,
  }
}

function creationJobFromRow(row) {
  return normalizeCreationJob({
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    modeId: row.mode_id,
    modeLabel: row.mode_label,
    mediaType: row.media_type,
    source: parseJson(row.source_json, null),
    params: parseJson(row.params_json, {}),
    request: parseJson(row.request_json, null),
    requestBody: parseJson(row.request_body_json, null),
    response: parseJson(row.response_json, null),
    job: parseJson(row.job_json, null),
    error: row.error,
    inputUrl: row.input_url,
    outputUrl: row.output_url,
    externalTaskId: row.external_task_id,
    createdAt: row.created_at,
    createdAtIso: row.created_at_iso,
    createdLocallyAt: row.created_locally_at,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    downloadedItemId: row.downloaded_item_id,
  })
}

function toPublicCreation(creation, { details = false } = {}) {
  const publicCreation = {
    id: creation.id,
    jobId: creation.jobId,
    status: creation.status,
    modeId: creation.modeId,
    modeLabel: creation.modeLabel,
    mediaType: creation.mediaType,
    source: creation.source,
    params: creation.params || {},
    error: creation.error,
    inputUrl: creation.inputUrl,
    outputUrl: creation.outputUrl,
    externalTaskId: creation.externalTaskId,
    createdAt: creation.createdAt,
    createdAtIso: creation.createdAtIso,
    createdLocallyAt: creation.createdLocallyAt,
    submittedAt: creation.submittedAt,
    updatedAt: creation.updatedAt,
    finishedAt: creation.finishedAt,
    downloadedItemId: creation.downloadedItemId,
    active: isActiveCreationStatus(creation.status),
  }

  if (details) {
    publicCreation.request = creation.request
    publicCreation.response = creation.response
    publicCreation.job = creation.job
  }

  return publicCreation
}

function stringifyNullable(value) {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function normalizeCatalog(catalog = {}) {
  return {
    items: Array.isArray(catalog.items) ? catalog.items : [],
    downloadedJobIds: Array.isArray(catalog.downloadedJobIds) ? catalog.downloadedJobIds : [],
    orphanFiles: Array.isArray(catalog.orphanFiles) ? catalog.orphanFiles : [],
    lastSeenJobId: catalog.lastSeenJobId || null,
    updatedAt: catalog.updatedAt || null,
    lastRun: catalog.lastRun || null,
  }
}

function stringifyCatalog(catalog) {
  return `${JSON.stringify(normalizeCatalog(catalog), null, 2)}\n`
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

async function archiveLegacyJsonFile(filePath, reason) {
  if (!(await fileExists(filePath))) {
    return null
  }

  await mkdir(LEGACY_JSON_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `${timestamp}_${sanitizePathPart(reason).toLowerCase()}_${path.basename(filePath)}`
  const archivePath = path.join(LEGACY_JSON_DIR, filename)
  await rename(filePath, archivePath)
  return archivePath
}

async function saveCatalog(catalog) {
  await mkdir(MEDIA_DIR, { recursive: true })
  writeCatalogToDb(catalog)
}

async function createCatalogBackup(reason = "manual", { allowEmpty = false } = {}) {
  const catalog = await loadCatalog()

  if (!allowEmpty && !catalog.items.length && !catalog.updatedAt) {
    return null
  }

  await mkdir(BACKUP_DIR, { recursive: true })
  const raw = stringifyCatalog(catalog)
  const timestamp = new Date().toISOString()
  const safeReason = sanitizePathPart(reason).toLowerCase()
  const filename = `${timestamp.replace(/[:.]/g, "-")}_${safeReason}.json`
  const backupPath = path.join(BACKUP_DIR, filename)
  await writeFile(backupPath, raw)

  return backupSummaryFromRaw(filename, raw, timestamp, safeReason)
}

async function listCatalogBackups() {
  let entries

  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const backups = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue
    }

    const filePath = path.join(BACKUP_DIR, entry.name)
    const [fileStat, raw] = await Promise.all([stat(filePath), readFile(filePath, "utf8")])
    backups.push(backupSummaryFromRaw(entry.name, raw, fileStat.mtime.toISOString()))
  }

  return backups.toSorted((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
}

async function restoreCatalogBackup(filename) {
  const backupPath = resolveCatalogBackupPath(filename)
  const raw = await readFile(backupPath, "utf8")
  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed.items)) {
    throw new Error("Selected backup is not a valid catalog.")
  }

  await createCatalogBackup("before-restore", { allowEmpty: true })
  await saveCatalog(normalizeCatalog(parsed))

  return backupSummaryFromRaw(path.basename(backupPath), raw)
}

async function sendCatalogExport(response) {
  const catalog = await loadCatalog()

  if (!catalog.items.length && !catalog.updatedAt) {
    return sendJson(response, { error: "No catalog exists yet." }, 404)
  }

  const raw = stringifyCatalog(catalog)
  const filename = `catalog-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "access-control-allow-origin": "*",
  })
  response.end(raw)
}

function resolveCatalogBackupPath(filename) {
  if (!filename || path.basename(filename) !== filename || !filename.endsWith(".json")) {
    throw new Error("Invalid backup filename.")
  }

  const backupPath = path.resolve(BACKUP_DIR, filename)
  const backupRoot = path.resolve(BACKUP_DIR)

  if (!backupPath.startsWith(`${backupRoot}${path.sep}`)) {
    throw new Error("Invalid backup path.")
  }

  return backupPath
}

function backupSummaryFromRaw(filename, raw, fallbackCreatedAt = null, fallbackReason = null) {
  let parsed = null

  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  const match = filename.match(/^(.+?)_([a-z0-9_-]+)\.json$/i)
  const createdAt = match?.[1]
    ? match[1].replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z")
    : fallbackCreatedAt

  return {
    file: filename,
    reason: fallbackReason || match?.[2] || "unknown",
    createdAt,
    size: Buffer.byteLength(raw),
    itemCount: Array.isArray(parsed?.items) ? parsed.items.length : null,
    catalogUpdatedAt: parsed?.updatedAt || null,
  }
}

function sortItems(items) {
  return items.toSorted((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
}

async function serveStatic(response, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname
  const filePath = path.resolve(PUBLIC_DIR, `.${cleanPath}`)

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(response, { error: "Not found" }, 404)
  }

  if (!(await fileExists(filePath))) {
    return sendJson(response, { error: "Not found" }, 404)
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
  })
  createReadStream(filePath).pipe(response)
}

async function serveMedia(request, response, mediaPath) {
  const decodedPath = decodeURIComponent(mediaPath)
  const filePath = path.resolve(MEDIA_DIR, decodedPath)

  if (!filePath.startsWith(MEDIA_DIR)) {
    return sendJson(response, { error: "Not found" }, 404)
  }

  if (!(await fileExists(filePath))) {
    return sendJson(response, { error: "Not found" }, 404)
  }

  const fileStat = await stat(filePath)
  const contentType = contentTypeFor(filePath)
  const range = parseRangeHeader(request.headers.range, fileStat.size)

  if (range?.error) {
    response.writeHead(416, {
      "content-range": `bytes */${fileStat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    })
    response.end()
    return
  }

  if (range) {
    response.writeHead(206, {
      "content-type": contentType,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    })

    if (request.method === "HEAD") {
      response.end()
      return
    }

    createReadStream(filePath, {
      start: range.start,
      end: range.end,
    }).pipe(response)
    return
  }

  response.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  })

  if (request.method === "HEAD") {
    response.end()
    return
  }

  createReadStream(filePath).pipe(response)
}

function parseRangeHeader(header, size) {
  if (!header) {
    return null
  }

  const match = String(header).match(/^bytes=(\d*)-(\d*)$/)
  if (!match || size < 1) {
    return {
      error: true,
    }
  }

  let start
  let end

  if (match[1] === "" && match[2] === "") {
    return {
      error: true,
    }
  }

  if (match[1] === "") {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      return {
        error: true,
      }
    }

    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === "" ? size - 1 : Number(match[2])
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return {
      error: true,
    }
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim()
  return raw ? JSON.parse(raw) : {}
}

function sendJson(response, body, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
  }
  return types[extension] || "application/octet-stream"
}

function sanitizePathPart(value) {
  return (
    String(value)
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "unknown"
  )
}

function resolveMediaDir(value) {
  const expanded = String(value).replace(/^~(?=$|\/|\\)/, process.env.HOME || "~")
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(ROOT_DIR, expanded)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }

  return !/^(?:0|false|no|off)$/i.test(String(value).trim())
}

function normalizeAuthorization(value) {
  if (!value || typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
}

function acceptAuthorization(value, source = "browser") {
  const authorization = normalizeAuthorization(value)

  if (!authorization) {
    const error = new Error("Missing bearer token.")
    error.statusCode = 400
    throw error
  }

  const expiresAt = getJwtExpiration(authorization)
  if (!expiresAt) {
    const error = new Error("Token is not a JWT with an exp claim.")
    error.statusCode = 400
    throw error
  }

  if (Date.parse(expiresAt) <= Date.now() + 5000) {
    const error = new Error("Token is expired or about to expire.")
    error.statusCode = 400
    throw error
  }

  authState.authorization = authorization
  authState.expiresAt = expiresAt
  authState.receivedAt = new Date().toISOString()
  authState.source = source

  return {
    authorization,
    expiresAt,
    source,
  }
}

function getActiveAuthorization() {
  const now = Date.now()

  if (authState.authorization && (!authState.expiresAt || Date.parse(authState.expiresAt) > now + 5000)) {
    return authState.authorization
  }

  const envAuthorization = normalizeAuthorization(process.env.GENERATEPORN_AUTHORIZATION)
  const envExpiresAt = getJwtExpiration(envAuthorization)
  if (envAuthorization && (!envExpiresAt || Date.parse(envExpiresAt) > now + 5000)) {
    return envAuthorization
  }

  return null
}

function hasApiAuth() {
  return Boolean(getActiveAuthorization() || process.env.GENERATEPORN_COOKIE)
}

function getAuthExpiresAt() {
  const active = getActiveAuthorization()
  if (!active) {
    return null
  }

  return active === authState.authorization ? authState.expiresAt : getJwtExpiration(active)
}

function getJwtExpiration(authorization) {
  const token = normalizeAuthorization(authorization)?.replace(/^bearer\s+/i, "")
  if (!token || token.split(".").length < 2) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))
    return payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null
  } catch {
    return null
  }
}

function loadDotEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8")

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const index = trimmed.indexOf("=")
      if (index === -1) continue

      const key = trimmed.slice(0, index).trim()
      let value = trimmed.slice(index + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[key] ??= value
    }
  } catch {
    // A .env file is optional.
  }
}

function isCliEntry() {
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE)
}

export {
  acceptAuthorization,
  autoSyncState,
  authBrowser,
  buildFacets,
  buildCreateApiRequest,
  createCatalogBackup,
  createMediaJob,
  downloadCreateJob,
  findJobForTemplate,
  duplicateCreation,
  getCatalogDownloadQueue,
  getCreateModes,
  getCreationDetails,
  getCreations,
  getThumbnailGenerationQueue,
  getItems,
  hashBuffer,
  importCreateTemplateFromHistory,
  isDownloadableCatalogItem,
  jobFromCatalogItem,
  listCatalogBackups,
  loadCreateTemplateRegistry,
  normalizeJob,
  resolveCreateSource,
  saveCreateTemplateRegistry,
  applyDuplicateMetadata,
  reconcileCatalogWithLocalFiles,
  requestSyncCancellation,
  refreshCreations,
  restoreCatalogBackup,
  resolveMediaDir,
  server,
  startCatalogDownload,
  startAutoSyncLoop,
  startLibraryVerification,
  startSync,
  startThumbnailGeneration,
  syncState,
  triggerAutoSync,
}
