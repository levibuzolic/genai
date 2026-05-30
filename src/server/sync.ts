import path from "node:path"

import { fetchJobsPage } from "./api-client.ts"
import { hasApiAuth } from "./auth-state.ts"
import { listCreationJobs } from "./catalog-db.ts"
import {
  applyCatalogThumbnail,
  applyDuplicateMetadata,
  createCatalogBackup,
  downloadJob,
  enqueueDownload,
  ensureCatalogThumbnail,
  getLocalMediaFiles,
  isDownloadableCatalogItem,
  isDownloadableJob,
  isIncrementalBoundaryJob,
  jobFromCatalogItem,
  loadCatalog,
  saveCatalog,
  sortItems,
  toCatalogItem,
} from "./catalog.ts"
import { AUTO_SYNC_ENABLED, AUTO_SYNC_INTERVAL_MS, AUTO_SYNC_STARTUP_DELAY_MS, MEDIA_DIR, PAGE_LIMIT, SYNC_DELAY_MS } from "./config.ts"
import { isActiveCreationStatus } from "./create-shared.ts"
import type { Catalog, CatalogItem, GeneratePornJob, OrphanFile, SyncError } from "./types.ts"
import { fileExists, hashFile, sleep } from "./utils.ts"

type SyncMode = "incremental" | "full" | "download-missing" | "retry-errors" | "generate-thumbnails" | "verify-library" | null
type SyncStatus = "idle" | "running" | "cancelling" | "cancelled" | "error"

type SyncState = {
  running: boolean
  status: SyncStatus
  mode: SyncMode
  currentPage: number
  scanned: number
  downloaded: number
  skipped: number
  errors: SyncError[]
  cancelRequested: boolean
  message: string
  startedAt: string | null
  finishedAt: string | null
}

type AutoSyncState = {
  enabled: boolean
  intervalMs: number
  startupDelayMs: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastSkippedAt: string | null
  lastSkipReason: string | null
  lastError: string | null
  lastReason: string | null
}

type CatalogDownloadMode = "download-missing" | "retry-errors"

const FULL_COVERAGE_SYNC_INTERVAL_MS = 60 * 60 * 1000
const EXPIRED_NO_MEDIA_ITEM_MS = 60 * 60 * 1000

export const syncState: SyncState = {
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

export const autoSyncState: AutoSyncState = {
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
let autoSyncTimer: NodeJS.Timeout | null = null

export function resetSyncRuntimeState(): void {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
  }

  Object.assign(syncState, {
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
  })

  Object.assign(autoSyncState, {
    enabled: AUTO_SYNC_ENABLED,
    intervalMs: AUTO_SYNC_INTERVAL_MS,
    startupDelayMs: AUTO_SYNC_STARTUP_DELAY_MS,
    nextRunAt: null,
    lastRunAt: null,
    lastSkippedAt: null,
    lastSkipReason: null,
    lastError: null,
    lastReason: null,
  })
}

export async function startSync({
  incremental,
  forceFullCoverageIfMissing = true,
}: {
  incremental: boolean
  forceFullCoverageIfMissing?: boolean
}): Promise<void> {
  resetSyncState({
    mode: incremental ? "incremental" : "full",
    message: incremental ? "Starting incremental sync..." : "Starting full sync...",
  })
  await createCatalogBackup(incremental ? "before-incremental-sync" : "before-full-sync")

  const catalog = await loadCatalog()
  const startedAtMs = Date.now()
  const previousFullCoverageAt = lastFullCoverageAt(catalog)
  const fullCoverageScan =
    !incremental || shouldRunFullCoverageScan(previousFullCoverageAt, startedAtMs, { forceIfMissing: forceFullCoverageIfMissing })
  const prunedExpired = pruneExpiredNoMediaItems(catalog, startedAtMs)
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  const downloadQueue: GeneratePornJob[] = []
  const queuedJobIds = new Set<string>()
  const previousLastSeenJobId = incremental && !fullCoverageScan ? catalog.lastSeenJobId : null
  const pendingKnownJobIds = incremental && !fullCoverageScan ? getPendingKnownJobIds(catalog) : new Set<string>()
  const seenApiJobIds = new Set<string>()
  let newestBoundaryJobId: string | null = null
  let stoppedAtPrevious = false
  let reachedApiEnd = false

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
        reachedApiEnd = true
        break
      }

      for (const job of jobs) {
        syncState.scanned += 1
        seenApiJobIds.add(job.id)
        pendingKnownJobIds.delete(job.id)

        const existing = itemById.get(job.id)
        const merged = toCatalogItem(job, existing)
        if (isExpiredNoMediaItem(merged, startedAtMs)) {
          itemById.delete(job.id)
          downloadedJobIds.delete(job.id)
          syncState.skipped += 1
          continue
        }
        itemById.set(job.id, merged)
        const isBoundaryJob = isIncrementalBoundaryJob(job)
        const reachedPreviousBoundary = Boolean(
          previousLastSeenJobId && job.id === previousLastSeenJobId && isBoundaryJob && pendingKnownJobIds.size === 0,
        )

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
  const completedFullCoverage = !cancelled && hasApiAuth() && reachedApiEnd
  const finishedAt = new Date().toISOString()

  let remoteDeleted = 0
  if (completedFullCoverage) {
    remoteDeleted = markMissingApiItemsDeleted(itemById, seenApiJobIds, finishedAt)
  }

  if (!cancelled && syncState.currentPage >= PAGE_LIMIT && !stoppedAtPrevious && !reachedApiEnd) {
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
    fullCoverageScan,
    fullCoverageCompleted: completedFullCoverage,
    fullCoverageCompletedAt: completedFullCoverage ? finishedAt : previousFullCoverageAt,
    prunedExpiredNoMediaItems: prunedExpired,
    remoteDeleted,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled,
    stoppedAtPrevious,
    finishedAt,
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled,
    finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished. Downloaded ${syncState.downloaded} new file${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

function getPendingKnownJobIds(catalog: Catalog): Set<string> {
  const ids = new Set<string>()

  for (const item of catalog.items) {
    if (item.id && !isIncrementalBoundaryJob(jobFromCatalogItem(item))) {
      ids.add(item.id)
    }
  }

  for (const creation of listCreationJobs({ status: "all", limit: 500 })) {
    if (!creation.jobId || creation.downloadedItemId) continue

    if (isActiveCreationStatus(creation.status) || (creation.status === "done" && creation.outputUrl)) {
      ids.add(creation.jobId)
    }
  }

  return ids
}

function shouldRunFullCoverageScan(
  previousFullCoverageAt: string | null,
  now: number,
  { forceIfMissing }: { forceIfMissing: boolean },
): boolean {
  if (!previousFullCoverageAt) return forceIfMissing

  const previous = timestampMs(previousFullCoverageAt)
  return previous === null || now - previous >= FULL_COVERAGE_SYNC_INTERVAL_MS
}

function lastFullCoverageAt(catalog: Catalog): string | null {
  const value = catalog.lastRun?.["fullCoverageCompletedAt"] ?? catalog.lastRun?.["fullScanCompletedAt"]
  if (typeof value === "string" && timestampMs(value) !== null) return value

  if (catalog.lastRun?.["mode"] === "full" && typeof catalog.lastRun["finishedAt"] === "string") {
    return catalog.lastRun["finishedAt"]
  }

  return null
}

function pruneExpiredNoMediaItems(catalog: Catalog, now: number): number {
  const before = catalog.items.length
  const removedIds = new Set<string>()
  catalog.items = catalog.items.filter((item) => {
    const expired = isExpiredNoMediaItem(item, now)
    if (expired) removedIds.add(item.id)
    return !expired
  })

  if (removedIds.size > 0) {
    catalog.downloadedJobIds = (catalog.downloadedJobIds || []).filter((id) => !removedIds.has(id))
  }

  return before - catalog.items.length
}

function isExpiredNoMediaItem(item: CatalogItem, now: number): boolean {
  if (item.localFile || item.outputUrl) return false

  const createdAt = itemStartedAtMs(item)
  return createdAt !== null && now - createdAt >= EXPIRED_NO_MEDIA_ITEM_MS
}

function markMissingApiItemsDeleted(itemById: Map<string, CatalogItem>, seenApiJobIds: Set<string>, deletedAt: string): number {
  let deleted = 0

  for (const item of itemById.values()) {
    if (!item.id || seenApiJobIds.has(item.id) || item.remoteDeletedAt || !hasMediaResult(item)) continue

    item.remoteDeletedAt = deletedAt
    item.remoteDeleteStatus = "deleted"
    deleted += 1
  }

  return deleted
}

function hasMediaResult(item: CatalogItem): boolean {
  return Boolean(item.localFile || item.outputUrl)
}

function itemStartedAtMs(item: CatalogItem): number | null {
  for (const value of [item.createdAtIso, item.createdLocallyAt, item.createdAt, item.updatedAt]) {
    const timestamp = timestampMs(value)
    if (timestamp !== null) return timestamp
  }

  return null
}

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null
    return value > 1_000_000_000_000 ? value : value * 1000
  }

  if (typeof value !== "string") return null

  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function startCatalogDownload({ mode }: { mode: CatalogDownloadMode }): Promise<void> {
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
  const finishedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt,
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

function finishSyncRun({
  cancelled,
  finishedAt,
  completeMessage,
}: {
  cancelled: boolean
  finishedAt: string
  completeMessage: string
}): void {
  syncState.running = false
  syncState.status = cancelled ? "cancelled" : "idle"
  syncState.cancelRequested = false
  syncState.finishedAt = finishedAt
  syncState.message = cancelled
    ? `Cancelled. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"} before stopping.`
    : completeMessage
}

export function requestSyncCancellation(): void {
  syncState.cancelRequested = true
  syncState.status = "cancelling"
  syncState.message = "Cancellation requested. Stopping after the current step..."
}

function shouldStopForCancellation(): boolean {
  if (!syncState.cancelRequested) {
    return false
  }

  syncState.status = "cancelling"
  syncState.message = "Cancelling..."
  return true
}

export function startAutoSyncLoop(): Record<string, unknown> {
  if (!autoSyncState.enabled) {
    return getAutoSyncStatus()
  }

  scheduleAutoSync("startup", autoSyncState.startupDelayMs)
  return getAutoSyncStatus()
}

function scheduleAutoSync(reason: string, delayMs: number): void {
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

export async function triggerAutoSync(reason = "manual"): Promise<Record<string, unknown>> {
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

export function getAutoSyncStatus(): Record<string, unknown> {
  return {
    ...autoSyncState,
    timerActive: Boolean(autoSyncTimer),
  }
}

export async function startThumbnailGeneration(): Promise<void> {
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

    const thumbnail = await ensureCatalogThumbnail(item.localFile || "")
    applyCatalogThumbnail(item, thumbnail)
    syncState.downloaded += thumbnail.thumbnailFile ? 1 : 0
    syncState.message = `Generated ${syncState.downloaded} of ${queue.length} thumbnail${queue.length === 1 ? "" : "s"}.`
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)
    await sleep(SYNC_DELAY_MS)
  }

  catalog.updatedAt = new Date().toISOString()
  const finishedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt,
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt,
    completeMessage: `Finished. Generated ${syncState.downloaded} thumbnail${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

export async function startLibraryVerification(): Promise<void> {
  resetSyncState({
    mode: "verify-library",
    message: "Preparing library verification...",
  })
  await createCatalogBackup("before-library-verification")

  const catalog = await loadCatalog()
  const mediaFiles = await getLocalMediaFiles()
  const itemByLocalFile = new Map<string, CatalogItem>()
  for (const item of catalog.items) {
    if (item.localFile) {
      itemByLocalFile.set(item.localFile, item)
    }
  }
  const orphanFiles: OrphanFile[] = []

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
  const duplicateItems = catalog.items.filter((item) => Number(item.duplicateGroupSize || 0) > 1).length
  const finishedAt = new Date().toISOString()
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: Math.max(0, syncState.scanned - syncState.downloaded),
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    orphanFiles: orphanFiles.length,
    duplicateItems,
    finishedAt,
  }
  await saveCatalog(catalog)

  finishSyncRun({
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt,
    completeMessage: `Finished. Verified ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}, found ${duplicateItems} duplicate item${duplicateItems === 1 ? "" : "s"} and ${orphanFiles.length} orphan file${orphanFiles.length === 1 ? "" : "s"}.`,
  })
}

export function getThumbnailGenerationQueue(items: CatalogItem[]): CatalogItem[] {
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

export function getCatalogDownloadQueue(
  items: CatalogItem[],
  { retryErrors = false, includeErrors = false }: { retryErrors?: boolean; includeErrors?: boolean } = {},
): GeneratePornJob[] {
  const downloadQueue: GeneratePornJob[] = []
  const queuedJobIds = new Set<string>()

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

async function runDownloadQueue({
  catalog,
  itemById,
  downloadedJobIds,
  downloadQueue,
  lastSeenJobId,
  startMessage,
}: {
  catalog: Catalog
  itemById: Map<string, CatalogItem>
  downloadedJobIds: Set<string>
  downloadQueue: GeneratePornJob[]
  lastSeenJobId: string | null
  startMessage: string
}): Promise<void> {
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
        id: job.id,
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

function resetSyncState({ mode, message }: { mode: Exclude<SyncMode, null>; message: string }): void {
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

export function handleBackgroundError(error: unknown): void {
  syncState.running = false
  syncState.status = "error"
  syncState.cancelRequested = false
  syncState.message = error instanceof Error ? error.message : String(error)
  syncState.errors.push({ message: syncState.message })
  syncState.finishedAt = new Date().toISOString()
}
