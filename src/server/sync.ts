import path from "node:path"

import { fetchJobsPage } from "./api-client.ts"
import { getSyncAccountEmails } from "./auth-state.ts"
import { scheduleBackgroundJob } from "./background-worker.ts"
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
import {
  AUTO_SYNC_ENABLED,
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_STARTUP_DELAY_MS,
  BACKGROUND_THUMBNAIL_BATCH_SIZE,
  MEDIA_DIR,
  PAGE_LIMIT,
  SYNC_DELAY_MS,
} from "./config.ts"
import { isActiveCreationStatus } from "./create-shared.ts"
import type { Catalog, CatalogItem, GeneratePornJob, OrphanFile, SyncError } from "./types.ts"
import { fileExists, hashFile, sleep } from "./utils.ts"

type SyncMode =
  | "incremental"
  | "full"
  | "download-missing"
  | "retry-errors"
  | "generate-thumbnails"
  | "verify-library"
  | "playbox-sync"
  | null
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
type AccountScanPage = {
  page: number
  jobs: GeneratePornJob[]
}
type AccountScanResult = {
  accountKey: string
  seenApiJobIds: Set<string>
  pages: AccountScanPage[]
  reachedApiEnd: boolean
  stoppedAtPrevious: boolean
  newestBoundaryJobId: string | null
}

const FULL_COVERAGE_SYNC_INTERVAL_MS = 60 * 60 * 1000
const EXPIRED_NO_MEDIA_ITEM_MS = 60 * 60 * 1000
const CATALOG_PROGRESS_SAVE_BATCH_SIZE = 5
export const MISSING_THUMBNAIL_BACKGROUND_JOB_ID = "missing-video-thumbnails"

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
  refreshCreationCatalogMetadata()
  const startedAtMs = Date.now()
  const previousFullCoverageAt = lastFullCoverageAt(catalog)
  const fullCoverageScan =
    !incremental || shouldRunFullCoverageScan(previousFullCoverageAt, startedAtMs, { forceIfMissing: forceFullCoverageIfMissing })
  const prunedExpired = pruneExpiredNoMediaItems(catalog, startedAtMs)
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  const downloadQueue: GeneratePornJob[] = []
  const queuedJobIds = new Set<string>()
  const lastSeenJobIdsByAccount = { ...catalog.lastSeenJobIdsByAccount }
  const pendingKnownJobIds = incremental && !fullCoverageScan ? getPendingKnownJobIds(catalog) : new Set<string>()
  const seenApiJobIdsByAccount = new Map<string, Set<string>>()
  const completedFullCoverageAccounts = new Set<string>()
  let newestBoundaryJobId: string | null = null
  let stoppedAtPrevious = false
  let reachedApiEnd = false
  let softStopAfterBoundaryPage: number | null = null

  for (const job of getCatalogDownloadQueue(catalog.items, { includeErrors: true })) {
    enqueueDownload(downloadQueue, queuedJobIds, job)
  }

  const syncAccounts = getSyncAccountEmails()

  if (syncAccounts.length > 0) {
    if (syncAccounts.length > 1) {
      syncState.message = `Fetching ${syncAccounts.length} accounts in parallel...`
      const accountResults = await Promise.all(
        syncAccounts.map((accountEmail) => {
          const accountKey = accountSyncKey(accountEmail)
          const previousLastSeenJobId =
            incremental && !fullCoverageScan
              ? lastSeenJobIdsByAccount[accountKey] || (accountEmail ? null : catalog.lastSeenJobId) || null
              : null
          return scanAccountPages({
            accountEmail,
            accountKey,
            previousLastSeenJobId,
            pendingKnownJobIds: incremental && !fullCoverageScan ? getPendingKnownJobIds(catalog, accountKey) : new Set<string>(),
            totalAccounts: syncAccounts.length,
          })
        }),
      )

      for (const result of accountResults) {
        seenApiJobIdsByAccount.set(result.accountKey, result.seenApiJobIds)
        if (result.reachedApiEnd) {
          reachedApiEnd = true
          completedFullCoverageAccounts.add(result.accountKey)
        }
        if (result.stoppedAtPrevious) {
          stoppedAtPrevious = true
        }
        if (result.newestBoundaryJobId) {
          newestBoundaryJobId ||= result.newestBoundaryJobId
          lastSeenJobIdsByAccount[result.accountKey] = result.newestBoundaryJobId
        }

        for (const pageResult of result.pages) {
          syncState.currentPage = Math.max(syncState.currentPage, pageResult.page)
          for (const job of pageResult.jobs) {
            syncState.scanned += 1

            const existing = itemById.get(job.id)
            const merged = toCatalogItem(job, {
              ...existing,
              ...creationCatalogMetadataByJobId.get(job.id),
            })
            if (isExpiredNoMediaItem(merged, startedAtMs)) {
              itemById.delete(job.id)
              downloadedJobIds.delete(job.id)
              syncState.skipped += 1
              continue
            }

            itemById.set(job.id, merged)
            if (!isDownloadableJob(job)) {
              syncState.skipped += 1
              continue
            }

            if (existing?.localFile && (await fileExists(path.join(MEDIA_DIR, existing.localFile)))) {
              downloadedJobIds.add(job.id)
              syncState.skipped += 1
              continue
            }

            enqueueDownload(downloadQueue, queuedJobIds, job)
          }
        }
      }

      catalog.items = sortItems(Array.from(itemById.values()))
      catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
      catalog.lastSeenJobId = newestBoundaryJobId || catalog.lastSeenJobId
      catalog.lastSeenJobIdsByAccount = lastSeenJobIdsByAccount
      catalog.updatedAt = new Date().toISOString()
      await saveCatalog(catalog)

      await drainDownloadQueue({
        catalog,
        itemById,
        downloadedJobIds,
        downloadQueue,
        lastSeenJobId: newestBoundaryJobId || catalog.lastSeenJobId,
        startMessage: `Finished parallel account scan. Downloading ${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"}...`,
      })
    } else {
      for (const accountEmail of syncAccounts) {
        const accountKey = accountSyncKey(accountEmail)
        const seenApiJobIds = new Set<string>()
        seenApiJobIdsByAccount.set(accountKey, seenApiJobIds)
        const previousLastSeenJobId =
          incremental && !fullCoverageScan
            ? lastSeenJobIdsByAccount[accountKey] || (accountEmail ? null : catalog.lastSeenJobId) || null
            : null
        let accountReachedApiEnd = false
        let accountNewestBoundaryJobId: string | null = null
        softStopAfterBoundaryPage = null

        for (let page = 1; page <= PAGE_LIMIT; page += 1) {
          if (shouldStopForCancellation()) {
            break
          }

          syncState.currentPage = page
          syncState.message = `Fetching ${accountLabel(accountEmail)} page ${page}...`

          const jobs = await fetchJobsPage(page, { accountEmail })

          if (jobs.length === 0) {
            syncState.message = `Reached the end of ${accountLabel(accountEmail)}.`
            reachedApiEnd = true
            accountReachedApiEnd = true
            break
          }

          for (const job of jobs) {
            syncState.scanned += 1
            seenApiJobIds.add(job.id)
            pendingKnownJobIds.delete(job.id)

            const existing = itemById.get(job.id)
            const merged = toCatalogItem(job, {
              ...existing,
              ...creationCatalogMetadataByJobId.get(job.id),
            })
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

            if (!accountNewestBoundaryJobId && isBoundaryJob) {
              accountNewestBoundaryJobId = job.id
              newestBoundaryJobId ||= job.id
              lastSeenJobIdsByAccount[accountKey] = job.id
            }

            if (!isDownloadableJob(job)) {
              syncState.skipped += 1
              if (reachedPreviousBoundary) {
                stoppedAtPrevious = true
                syncState.message = "Reached the previously saved latest settled job."
                if (softStopAfterBoundaryPage === null) {
                  softStopAfterBoundaryPage = syncState.currentPage
                }
                continue
              }
              continue
            }

            if (existing?.localFile && (await fileExists(path.join(MEDIA_DIR, existing.localFile)))) {
              downloadedJobIds.add(job.id)
              syncState.skipped += 1
              if (reachedPreviousBoundary) {
                stoppedAtPrevious = true
                syncState.message = "Reached the previously saved latest settled job."
                if (softStopAfterBoundaryPage === null) {
                  softStopAfterBoundaryPage = syncState.currentPage
                }
                continue
              }
              continue
            }

            enqueueDownload(downloadQueue, queuedJobIds, job)

            if (reachedPreviousBoundary) {
              stoppedAtPrevious = true
              syncState.message = "Reached the previously saved latest settled job."
              if (softStopAfterBoundaryPage === null) {
                softStopAfterBoundaryPage = syncState.currentPage
              }
            }
          }

          catalog.items = sortItems(Array.from(itemById.values()))
          catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
          catalog.lastSeenJobId = newestBoundaryJobId || catalog.lastSeenJobId
          catalog.lastSeenJobIdsByAccount = lastSeenJobIdsByAccount
          catalog.updatedAt = new Date().toISOString()
          await saveCatalog(catalog)

          await drainDownloadQueue({
            catalog,
            itemById,
            downloadedJobIds,
            downloadQueue,
            lastSeenJobId: newestBoundaryJobId || catalog.lastSeenJobId,
            startMessage: `Downloading media found through page ${page}...`,
          })

          if (softStopAfterBoundaryPage !== null && syncState.currentPage >= softStopAfterBoundaryPage) {
            break
          }
        }

        if (accountReachedApiEnd) {
          completedFullCoverageAccounts.add(accountKey)
        }
      }
    }
  } else {
    syncState.message = downloadQueue.length
      ? "No active API auth; downloading known missing files only."
      : "No active API auth and no known missing files to download."
  }

  if (downloadQueue.length > 0) {
    await runDownloadQueue({
      catalog,
      itemById,
      downloadedJobIds,
      downloadQueue,
      lastSeenJobId: newestBoundaryJobId || catalog.lastSeenJobId,
      startMessage: `Finished API scan. Downloading ${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"}...`,
    })
  }

  const cancelled = Boolean(syncState.cancelRequested)
  const completedFullCoverage = !cancelled && syncAccounts.length > 0 && reachedApiEnd
  const finishedAt = new Date().toISOString()

  let remoteDeleted = 0
  if (completedFullCoverage) {
    for (const [accountKey, seenApiJobIds] of seenApiJobIdsByAccount) {
      if (!completedFullCoverageAccounts.has(accountKey)) continue
      remoteDeleted += markMissingApiItemsDeleted(itemById, seenApiJobIds, finishedAt, accountKey)
    }
  }

  if (!cancelled && syncState.currentPage >= PAGE_LIMIT && !stoppedAtPrevious && !reachedApiEnd) {
    syncState.errors.push({
      message: `Stopped after page limit ${PAGE_LIMIT}; increase GENERATEPORN_PAGE_LIMIT if needed.`,
    })
  }

  catalog.items = sortItems(Array.from(itemById.values()))
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  catalog.lastSeenJobId = newestBoundaryJobId || catalog.lastSeenJobId
  catalog.lastSeenJobIdsByAccount = lastSeenJobIdsByAccount
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
  scheduleMissingThumbnailBackgroundJobForCatalog(catalog, "sync-finished")
}

async function drainDownloadQueue(options: {
  catalog: Catalog
  itemById: Map<string, CatalogItem>
  downloadedJobIds: Set<string>
  downloadQueue: GeneratePornJob[]
  lastSeenJobId: string | null
  startMessage: string
}): Promise<void> {
  if (options.downloadQueue.length === 0) {
    return
  }

  await runDownloadQueue(options)
  options.downloadQueue.splice(0)
}

async function scanAccountPages({
  accountEmail,
  accountKey,
  previousLastSeenJobId,
  pendingKnownJobIds,
  totalAccounts,
}: {
  accountEmail: string | null
  accountKey: string
  previousLastSeenJobId: string | null
  pendingKnownJobIds: Set<string>
  totalAccounts: number
}): Promise<AccountScanResult> {
  const seenApiJobIds = new Set<string>()
  const pages: AccountScanPage[] = []
  let reachedApiEnd = false
  let stoppedAtPrevious = false
  let newestBoundaryJobId: string | null = null

  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    if (shouldStopForCancellation()) {
      break
    }

    syncState.currentPage = Math.max(syncState.currentPage, page)
    syncState.message = `Fetching ${accountLabel(accountEmail)} page ${page} (${totalAccounts} accounts)...`
    const jobs = await fetchJobsPage(page, { accountEmail })

    if (jobs.length === 0) {
      syncState.message = `Reached the end of ${accountLabel(accountEmail)}.`
      reachedApiEnd = true
      break
    }

    pages.push({ page, jobs })
    let stopAfterPage = false
    for (const job of jobs) {
      seenApiJobIds.add(job.id)
      pendingKnownJobIds.delete(job.id)

      const isBoundaryJob = isIncrementalBoundaryJob(job)
      if (!newestBoundaryJobId && isBoundaryJob) {
        newestBoundaryJobId = job.id
      }

      if (previousLastSeenJobId && job.id === previousLastSeenJobId && isBoundaryJob && pendingKnownJobIds.size === 0) {
        stoppedAtPrevious = true
        stopAfterPage = true
      }
    }

    if (stopAfterPage) {
      break
    }
  }

  return {
    accountKey,
    seenApiJobIds,
    pages,
    reachedApiEnd,
    stoppedAtPrevious,
    newestBoundaryJobId,
  }
}

function getPendingKnownJobIds(catalog: Catalog, accountKeyFilter?: string): Set<string> {
  const ids = new Set<string>()

  for (const item of catalog.items) {
    if (accountKeyFilter && itemAccountSyncKey(item) !== accountKeyFilter) continue
    if (item.id && !isIncrementalBoundaryJob(jobFromCatalogItem(item))) {
      ids.add(item.id)
    }
  }

  for (const creation of listCreationJobs({ status: "all", limit: 500 })) {
    if (accountKeyFilter && accountSyncKey(creation.accountEmail) !== accountKeyFilter) continue
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

function markMissingApiItemsDeleted(
  itemById: Map<string, CatalogItem>,
  seenApiJobIds: Set<string>,
  deletedAt: string,
  accountKey: string,
): number {
  let deleted = 0

  for (const item of itemById.values()) {
    if (!item.id || itemAccountSyncKey(item) !== accountKey || seenApiJobIds.has(item.id) || item.remoteDeletedAt || !hasMediaResult(item))
      continue

    item.remoteDeletedAt = deletedAt
    item.remoteDeleteStatus = "deleted"
    deleted += 1
  }

  return deleted
}

function accountSyncKey(accountEmail: string | null): string {
  return accountEmail || "__legacy__"
}

function itemAccountSyncKey(item: CatalogItem): string {
  return accountSyncKey(typeof item.accountEmail === "string" && item.accountEmail ? item.accountEmail : null)
}

function accountLabel(accountEmail: string | null): string {
  return accountEmail || "default account"
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
  scheduleMissingThumbnailBackgroundJobForCatalog(catalog, "catalog-download-finished")
}

export function finishSyncRun({
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

export function shouldStopForCancellation(): boolean {
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
  let changedSinceSave = false
  let changedSinceSaveCount = 0

  for (const item of queue) {
    if (shouldStopForCancellation()) {
      break
    }

    const thumbnail = await ensureCatalogThumbnail(item.localFile || "")
    const changed = applyCatalogThumbnail(item, thumbnail)
    changedSinceSave ||= changed
    changedSinceSaveCount += changed ? 1 : 0
    syncState.downloaded += thumbnail.thumbnailFile ? 1 : 0
    syncState.message = `Generated ${syncState.downloaded} of ${queue.length} thumbnail${queue.length === 1 ? "" : "s"}.`
    if (changedSinceSave && changedSinceSaveCount >= CATALOG_PROGRESS_SAVE_BATCH_SIZE) {
      catalog.updatedAt = new Date().toISOString()
      await saveCatalog(catalog)
      changedSinceSave = false
      changedSinceSaveCount = 0
    }
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

export async function runMissingThumbnailBackgroundJob({
  limit = BACKGROUND_THUMBNAIL_BATCH_SIZE,
}: {
  limit?: number
} = {}): Promise<Record<string, unknown>> {
  if (syncState.running) {
    return {
      skipped: true,
      reason: "sync-running",
    }
  }

  const catalog = await loadCatalog()
  const queue = getThumbnailGenerationQueue(catalog.items).slice(0, Math.max(1, Number(limit) || BACKGROUND_THUMBNAIL_BATCH_SIZE))
  let generated = 0
  const errors: SyncError[] = []
  let changedSinceSave = false
  let changedSinceSaveCount = 0

  for (const item of queue) {
    try {
      const thumbnail = await ensureCatalogThumbnail(item.localFile || "")
      if (applyCatalogThumbnail(item, thumbnail)) {
        generated += thumbnail.thumbnailFile ? 1 : 0
        catalog.updatedAt = new Date().toISOString()
        changedSinceSave = true
        changedSinceSaveCount += 1
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ id: item.id, message })
      item.thumbnailError = message
      item.updatedAt = new Date().toISOString()
      catalog.updatedAt = item.updatedAt
      changedSinceSave = true
      changedSinceSaveCount += 1
    }

    if (changedSinceSave && changedSinceSaveCount >= CATALOG_PROGRESS_SAVE_BATCH_SIZE) {
      await saveCatalog(catalog)
      changedSinceSave = false
      changedSinceSaveCount = 0
    }

    await sleep(SYNC_DELAY_MS)
  }

  if (changedSinceSave) {
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)
  }

  return {
    scanned: catalog.items.length,
    queued: queue.length,
    generated,
    errors: errors.length,
  }
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
  scheduleMissingThumbnailBackgroundJobForCatalog(catalog, "library-verification-finished")
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

export function scheduleMissingThumbnailBackgroundJobForCatalog(catalog: Catalog, reason = "missing-thumbnails"): boolean {
  if (getThumbnailGenerationQueue(catalog.items).length === 0) {
    return false
  }

  return scheduleBackgroundJob(MISSING_THUMBNAIL_BACKGROUND_JOB_ID, 0, reason)
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
  refreshCreationCatalogMetadata()
  syncState.message = startMessage
  let processedInBatch = 0
  let changedSinceSave = false
  let changedSinceSaveCount = 0

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
          ...creationCatalogMetadataByJobId.get(job.id),
          ...downloaded,
          downloadError: null,
        }),
      )
      downloadedJobIds.add(job.id)
      syncState.downloaded += 1
      processedInBatch += 1
      syncState.message = `Downloaded ${processedInBatch} of ${downloadQueue.length} queued file${downloadQueue.length === 1 ? "" : "s"} (${syncState.downloaded} total).`
      changedSinceSave = true
      changedSinceSaveCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      syncState.errors.push({ id: job.id, message })
      itemById.set(job.id, {
        ...existing,
        id: job.id,
        downloadError: message,
      })
      changedSinceSave = true
      changedSinceSaveCount += 1
    }

    if (changedSinceSave && changedSinceSaveCount >= CATALOG_PROGRESS_SAVE_BATCH_SIZE) {
      catalog.items = sortItems(Array.from(itemById.values()))
      catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
      catalog.lastSeenJobId = lastSeenJobId || catalog.lastSeenJobId
      catalog.updatedAt = new Date().toISOString()
      await saveCatalog(catalog)
      changedSinceSave = false
      changedSinceSaveCount = 0
    }

    await sleep(SYNC_DELAY_MS)
  }

  if (changedSinceSave) {
    catalog.items = sortItems(Array.from(itemById.values()))
    catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
    catalog.lastSeenJobId = lastSeenJobId || catalog.lastSeenJobId
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)
  }
}

const creationCatalogMetadataByJobId = new Map<string, Partial<CatalogItem>>()

function refreshCreationCatalogMetadata(): void {
  creationCatalogMetadataByJobId.clear()
  for (const creation of listCreationJobs({ status: "all", limit: 1000 })) {
    if (!creation.jobId) continue
    creationCatalogMetadataByJobId.set(creation.jobId, {
      accountEmail: creation.accountEmail,
      createModeId: creation.modeId,
      createParams: creation.params,
      templateId: creation.templateId,
      templateLabel: creation.templateLabel,
      sourceKind: sourceString(creation.source, "kind"),
      sourceItemId: sourceString(creation.source, "itemId"),
      sourceUrl: sourceString(creation.source, "url"),
      createdLocallyAt: creation.createdLocallyAt,
    })
  }
}

function sourceString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === "string" && value ? value : null
}

export function resetSyncState({ mode, message }: { mode: Exclude<SyncMode, null>; message: string }): void {
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
