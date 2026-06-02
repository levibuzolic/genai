import { mkdir } from "node:fs/promises"
import http from "node:http"
import path from "node:path"

import { z } from "zod"

import {
  acceptAuthorization,
  authBrowser,
  authState,
  connectAuthAccount,
  getAuthAccountStatuses,
  getActiveAuthorization,
  getAuthExpiresAt,
  getDefaultAccountEmail,
  refreshAuthAccount,
  removeAuthAccount,
  resetAuthRuntimeState,
  startAuthAccountAutoRefresh,
} from "./server/auth-state.ts"
import {
  getBackgroundWorkerStatus,
  registerBackgroundJob,
  resetBackgroundWorkers,
  startBackgroundWorkers,
  triggerBackgroundJob,
} from "./server/background-worker.ts"
import { closeCatalogDb } from "./server/catalog-db.ts"
import {
  applyDuplicateMetadata,
  buildFacets,
  createCatalogBackup,
  deleteCatalogItemRemote,
  getCatalogItem,
  getItems,
  isDownloadableCatalogItem,
  jobFromCatalogItem,
  listCatalogBackups,
  loadCatalog,
  normalizeJob,
  reconcileCatalogWithLocalFiles,
  restoreCatalogBackup,
  saveCatalog,
  sendCatalogExport,
  setCatalogItemFavoriteRemote,
} from "./server/catalog.ts"
import {
  CREATE_HISTORY_PAGE_LIMIT,
  AUTO_SYNC_ENABLED,
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_STARTUP_DELAY_MS,
  BACKGROUND_THUMBNAIL_BATCH_SIZE,
  BACKGROUND_THUMBNAIL_ENABLED,
  BACKGROUND_THUMBNAIL_INTERVAL_MS,
  BACKGROUND_THUMBNAIL_STARTUP_DELAY_MS,
  BACKGROUND_WORKERS_ENABLED,
  MEDIA_DIR,
  LOCAL_APP_URL,
  PAGE_LIMIT,
  PORT,
  REDIRECT_STATIC_TO_VITE,
  ROOT_DIR,
  SERVER_ENTRY_FILE,
  THUMBNAIL_DIR,
  VITE_PORT,
  reloadConfigFromEnv,
} from "./server/config.ts"
import {
  buildCreateApiRequest,
  createMediaJob,
  downloadCreateJob,
  duplicateCreation,
  getCreationDetails,
  getCreations,
  getMediaGenerationConcurrencyLimit,
  getPendingGenerationCountsByAccount,
  pollCreateJob,
  refreshCreations,
  resolveCreateSource,
  setMediaGenerationConcurrencyLimit,
  startCreationQueueProcessing,
  CREATION_QUEUE_BACKGROUND_JOB_ID,
  runCreationQueueBackgroundJob,
} from "./server/create-jobs.ts"
import {
  getCreateModes,
  getCreateTemplateRegistryResponse,
  importCreateTemplateFromHistory,
  saveCreateTemplateFromCreation,
  saveCreateTemplateFromRequest,
  deleteCreateTemplate,
  findJobForTemplate,
  loadCreateTemplateRegistry,
  saveCreateTemplateRegistry,
} from "./server/create-templates.ts"
import { getErrorStatusCode } from "./server/errors.ts"
import {
  clearPlayboxImportedAuthSession,
  getPlayboxImportedAuthStatus,
  importPlayboxCurl,
  refreshPlayboxImportedAuthorization,
  resetPlayboxImportedAuthRuntimeState,
} from "./server/playbox-auth-import.ts"
import { getPlayboxAuthStatus, playboxAuthBrowser, resetPlayboxAuthRuntimeState } from "./server/playbox-auth-state.ts"
import { startPlayboxSync } from "./server/playbox-sync.ts"
import { logHttpNotFound, readJsonBody, sendJson, serveMedia, serveStatic } from "./server/static.ts"
import {
  autoSyncState,
  getAutoSyncStatus,
  getCatalogDownloadQueue,
  getThumbnailGenerationQueue,
  handleBackgroundError,
  requestSyncCancellation,
  resetSyncRuntimeState,
  startAutoSyncLoop,
  startCatalogDownload,
  startLibraryVerification,
  runMissingThumbnailBackgroundJob,
  startSync,
  startThumbnailGeneration,
  syncState,
  triggerAutoSync,
} from "./server/sync.ts"
import { clamp, hashBuffer, resolveMediaDirFromRoot } from "./server/utils.ts"

const AuthAccountBodySchema = z.object({ email: z.string(), deleteProfile: z.boolean().catch(false) }).passthrough()
const PlayboxCurlImportBodySchema = z.object({ curl: z.string().min(1) }).passthrough()
const CatalogBackupBodySchema = z.object({ reason: z.string().catch("manual") }).passthrough()
const CatalogRestoreBodySchema = z.object({ file: z.string().catch("") }).passthrough()
const DisconnectBrowserBodySchema = z.object({ deleteProfile: z.boolean().catch(false) }).passthrough()
const DeleteCatalogItemBodySchema = z.object({ keepLocalFiles: z.boolean().catch(true) }).passthrough()
const MediaGenerationConcurrencyLimitBodySchema = z.object({ limit: z.coerce.number() }).passthrough()
const RefreshCreationsBodySchema = z.object({ pageLimit: z.coerce.number().catch(CREATE_HISTORY_PAGE_LIMIT) }).passthrough()
const SyncStartBodySchema = z.object({ incremental: z.boolean().catch(true) }).passthrough()
const PLAYBOX_SYNC_STARTUP_OFFSET_MS = 30_000
const VITE_REDIRECT_CACHE_MS = 5000
let viteRedirectCache: { checkedAt: number; url: string | null } = { checkedAt: 0, url: null }
let viteRedirectProbe: Promise<string | null> | null = null

reloadConfigFromEnv()
closeCatalogDb()
resetAuthRuntimeState()
resetPlayboxAuthRuntimeState()
resetPlayboxImportedAuthRuntimeState()
resetSyncRuntimeState()
resetBackgroundWorkers()
registerBackgroundJobs()
await mkdir(MEDIA_DIR, { recursive: true })

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`)

    if (request.method === "OPTIONS") {
      return sendJson(response, { ok: true })
    }

    if (await handleStaticRequestThroughVite(request, response, url)) {
      return
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      const authAccounts = getAuthAccountStatuses()
      return sendJson(response, {
        mediaDir: MEDIA_DIR,
        hasCookie: Boolean(process.env["GENERATEPORN_COOKIE"]),
        hasAuthorization: Boolean(getActiveAuthorization() || authAccounts.some((account) => account.hasAuthorization)),
        authorizationExpiresAt: getAuthExpiresAt(),
        authorizationSource: authState.source,
        authBrowser: authBrowser.getStatus(),
        playbox: {
          ...getPlayboxAuthStatus(),
          importedSession: getPlayboxImportedAuthStatus(),
        },
        authAccounts,
        defaultAccountEmail: getDefaultAccountEmail(),
        mediaGenerationConcurrencyLimit: getMediaGenerationConcurrencyLimit(),
        pendingGenerationsByAccount: getPendingGenerationCountsByAccount(),
        backgroundWorkers: getBackgroundWorkerStatus(),
        autoSync: getAutoSyncStatus(),
        thumbnailDir: THUMBNAIL_DIR,
        pageLimit: PAGE_LIMIT,
      })
    }

    if (request.method === "GET" && url.pathname === "/api/create/modes") {
      return sendJson(response, await getCreateModes())
    }

    if (request.method === "GET" && url.pathname === "/api/background/jobs") {
      return sendJson(response, { jobs: getBackgroundWorkerStatus() })
    }

    const backgroundJobMatch = url.pathname.match(/^\/api\/background\/jobs\/([^/]+)$/)
    if (request.method === "POST" && backgroundJobMatch) {
      return sendJson(response, await triggerBackgroundJob(decodeURIComponent(backgroundJobMatch[1] || ""), "manual"))
    }

    if (request.method === "POST" && url.pathname === "/api/settings/media-generation-concurrency-limit") {
      const body = MediaGenerationConcurrencyLimitBodySchema.parse(await readJsonBody(request))
      return sendJson(response, {
        ok: true,
        ...setMediaGenerationConcurrencyLimit(body.limit),
      })
    }

    if (request.method === "GET" && url.pathname === "/api/create/templates") {
      return sendJson(response, await getCreateTemplateRegistryResponse())
    }

    if (request.method === "POST" && url.pathname === "/api/create/templates") {
      const body = await readJsonBody(request)
      return sendJson(response, {
        ok: true,
        template: await saveCreateTemplateFromRequest(body),
      })
    }

    if (request.method === "POST" && url.pathname === "/api/create/templates/import") {
      const body = await readJsonBody(request)
      return sendJson(response, {
        ok: true,
        template: await importCreateTemplateFromHistory(body),
      })
    }

    const createTemplateMatch = url.pathname.match(/^\/api\/create\/templates\/([^/]+)$/)
    if (createTemplateMatch) {
      if (request.method === "PUT") {
        const body = await readJsonBody(request)
        return sendJson(response, {
          ok: true,
          template: await saveCreateTemplateFromRequest({ ...body, id: createTemplateMatch[1] || "" }),
        })
      }

      if (request.method === "DELETE") {
        return sendJson(response, await deleteCreateTemplate(createTemplateMatch[1] || ""))
      }
    }

    if (request.method === "POST" && url.pathname === "/api/create/jobs") {
      const body = await readJsonBody(request)
      return sendJson(response, await createMediaJob(body))
    }

    const createJobMatch = url.pathname.match(/^\/api\/create\/jobs\/([^/]+)$/)
    if (request.method === "GET" && createJobMatch) {
      return sendJson(response, await pollCreateJob(createJobMatch[1] || ""))
    }

    const createDownloadMatch = url.pathname.match(/^\/api\/create\/jobs\/([^/]+)\/download$/)
    if (request.method === "POST" && createDownloadMatch) {
      return sendJson(response, await downloadCreateJob(createDownloadMatch[1] || ""))
    }

    if (request.method === "GET" && url.pathname === "/api/creations") {
      return sendJson(response, await getCreations(url.searchParams))
    }

    const creationMatch = url.pathname.match(/^\/api\/creations\/([^/]+)$/)
    if (request.method === "GET" && creationMatch) {
      return sendJson(response, await getCreationDetails(creationMatch[1] || ""))
    }

    const creationDuplicateMatch = url.pathname.match(/^\/api\/creations\/([^/]+)\/duplicate$/)
    if (request.method === "POST" && creationDuplicateMatch) {
      const body = await readJsonBody(request)
      return sendJson(response, await duplicateCreation(creationDuplicateMatch[1] || "", body))
    }

    const creationTemplateMatch = url.pathname.match(/^\/api\/creations\/([^/]+)\/template$/)
    if (request.method === "POST" && creationTemplateMatch) {
      const body = await readJsonBody(request)
      return sendJson(response, {
        ok: true,
        template: await saveCreateTemplateFromCreation(creationTemplateMatch[1] || "", body),
      })
    }

    if (request.method === "POST" && url.pathname === "/api/creations/refresh") {
      const body = RefreshCreationsBodySchema.parse(await readJsonBody(request))
      return sendJson(
        response,
        await refreshCreations({
          pageLimit: clamp(body.pageLimit, 1, PAGE_LIMIT),
        }),
      )
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
      const body = DisconnectBrowserBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await authBrowser.disconnect({ deleteProfile: body.deleteProfile }))
    }

    if (request.method === "GET" && url.pathname === "/api/auth/accounts") {
      return sendJson(response, { accounts: getAuthAccountStatuses(), defaultAccountEmail: getDefaultAccountEmail() })
    }

    if (request.method === "POST" && url.pathname === "/api/auth/accounts/connect") {
      const body = AuthAccountBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await connectAuthAccount(body.email))
    }

    if (request.method === "POST" && url.pathname === "/api/auth/accounts/refresh") {
      const body = AuthAccountBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await refreshAuthAccount(body.email))
    }

    if (request.method === "POST" && url.pathname === "/api/auth/accounts/remove") {
      const body = AuthAccountBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await removeAuthAccount(body.email, { deleteProfile: body.deleteProfile }))
    }

    if (request.method === "GET" && url.pathname === "/api/playbox/auth/browser/status") {
      return sendJson(response, playboxAuthBrowser.getStatus())
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/auth/browser/connect") {
      return sendJson(response, await playboxAuthBrowser.connectVisible())
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/auth/browser/refresh") {
      return sendJson(response, await playboxAuthBrowser.refreshHeadless())
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/auth/browser/disconnect") {
      const body = DisconnectBrowserBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await playboxAuthBrowser.disconnect({ deleteProfile: body.deleteProfile }))
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/auth/import-curl") {
      const body = PlayboxCurlImportBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await importPlayboxCurl(body.curl))
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/auth/import/refresh") {
      const ok = await refreshPlayboxImportedAuthorization()
      return sendJson(response, { ok, importedSession: getPlayboxImportedAuthStatus(), playbox: getPlayboxAuthStatus() }, ok ? 200 : 400)
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/auth/import/disconnect") {
      return sendJson(response, await clearPlayboxImportedAuthSession())
    }

    if (request.method === "GET" && url.pathname === "/api/items") {
      return sendJson(response, await getItems(url.searchParams))
    }

    const catalogItemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/)
    if (request.method === "GET" && catalogItemMatch) {
      return sendJson(response, await getCatalogItem(decodeURIComponent(catalogItemMatch[1] || "")))
    }

    if (request.method === "DELETE" && catalogItemMatch) {
      const body = DeleteCatalogItemBodySchema.parse(await readJsonBody(request))
      return sendJson(response, await deleteCatalogItemRemote(decodeURIComponent(catalogItemMatch[1] || ""), body))
    }

    const favoriteItemMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/favorite$/)
    if ((request.method === "POST" || request.method === "DELETE") && favoriteItemMatch) {
      return sendJson(
        response,
        await setCatalogItemFavoriteRemote(decodeURIComponent(favoriteItemMatch[1] || ""), request.method === "POST"),
      )
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/export") {
      return sendCatalogExport(response)
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/backups") {
      return sendJson(response, { backups: await listCatalogBackups() })
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/backup") {
      const body = CatalogBackupBodySchema.parse(await readJsonBody(request))
      const backup = await createCatalogBackup(body.reason)
      return sendJson(response, { ok: true, backup })
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/restore") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, thumbnail, or verification job is already running." }, 409)
      }

      const body = CatalogRestoreBodySchema.parse(await readJsonBody(request))
      const restored = await restoreCatalogBackup(body.file)
      return sendJson(response, { ok: true, restored })
    }

    if (request.method === "GET" && url.pathname === "/api/sync/status") {
      return sendJson(response, syncState)
    }

    if (request.method === "POST" && url.pathname === "/api/sync/start") {
      const body = SyncStartBodySchema.parse(await readJsonBody(request))

      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync is already running." }, 409)
      }

      const incremental = body.incremental
      startSync({ incremental }).catch(handleBackgroundError)

      return sendJson(response, { ok: true, incremental })
    }

    if (request.method === "POST" && url.pathname === "/api/playbox/sync/start") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync is already running." }, 409)
      }

      startPlayboxSync().catch(handleBackgroundError)
      return sendJson(response, { ok: true, provider: "playbox" })
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

    logHttpNotFound("route not found", { method: request.method, pathname: url.pathname })
    sendJson(response, { error: "Not found" }, 404)
  } catch (error) {
    console.error(error)
    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : String(error),
      },
      getErrorStatusCode(error) || 500,
    )
  }
})

if (isCliEntry()) {
  server.listen(PORT, () => {
    void resolveStartupAppUrl().then((appUrl) => {
      console.log(`Media library running at ${appUrl}`)
      console.log(`API server listening at http://localhost:${PORT}`)
      console.log(`Media directory: ${MEDIA_DIR}`)
      return undefined
    })
    startAuthAccountAutoRefresh()
    void refreshPlayboxImportedAuthorization().then((ok) => {
      if (!ok) {
        console.log("Playbox imported auth session is not active. Open Settings > Playbox Auth to import or refresh it.")
      }
      return undefined
    })
    startBackgroundWorkers()
    startAutoSyncLoop()
  })
}

async function resolveStartupAppUrl(): Promise<string> {
  if (LOCAL_APP_URL) {
    return LOCAL_APP_URL
  }

  if (REDIRECT_STATIC_TO_VITE) {
    return `http://localhost:${VITE_PORT}`
  }

  const viteUrl = await findMediaLibraryViteUrl({ scanFallbackPorts: true, timeoutMs: 2000 })
  return viteUrl || `http://localhost:${PORT}`
}

type ViteProbeOptions = {
  scanFallbackPorts?: boolean
  timeoutMs?: number
}

async function handleStaticRequestThroughVite(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<boolean> {
  if (!REDIRECT_STATIC_TO_VITE || (request.method !== "GET" && request.method !== "HEAD") || isApiOrMediaPath(url.pathname)) {
    return false
  }

  const viteUrl = await getViteRedirectUrl()
  if (viteUrl) {
    const redirectUrl = new URL(`${url.pathname}${url.search}`, withTrailingSlash(viteUrl))
    response.writeHead(307, {
      location: redirectUrl.toString(),
      "cache-control": "no-store",
    })
    response.end()
    return true
  }

  response.writeHead(503, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  })
  if (request.method !== "HEAD") {
    response.end(
      [
        "<!doctype html>",
        "<html><head><title>Vite dev server unavailable</title></head>",
        "<body>",
        `<h1>Vite dev server is not running on port ${VITE_PORT}</h1>`,
        "<p>Start the app with <code>pnpm start</code>, then open the Vite app URL.</p>",
        "</body></html>",
      ].join(""),
    )
  } else {
    response.end()
  }
  return true
}

async function getViteRedirectUrl(): Promise<string | null> {
  if (LOCAL_APP_URL) {
    return LOCAL_APP_URL
  }

  const now = Date.now()
  if (now - viteRedirectCache.checkedAt < VITE_REDIRECT_CACHE_MS) {
    return viteRedirectCache.url
  }

  viteRedirectProbe ??= findMediaLibraryViteUrl({ scanFallbackPorts: false, timeoutMs: 750 }).finally(() => {
    viteRedirectProbe = null
  })

  const url = await viteRedirectProbe
  viteRedirectCache = {
    checkedAt: Date.now(),
    url,
  }
  return url
}

async function findMediaLibraryViteUrl({ scanFallbackPorts = true, timeoutMs = 2000 }: ViteProbeOptions = {}): Promise<string | null> {
  const preferredPort = VITE_PORT
  const candidatePorts = [preferredPort]
  if (scanFallbackPorts) {
    for (let port = 6173; port <= 6183; port += 1) {
      if (!candidatePorts.includes(port)) {
        candidatePorts.push(port)
      }
    }
  }

  for (const port of candidatePorts) {
    if (await isMediaLibraryViteUrl(`http://127.0.0.1:${port}`, timeoutMs)) {
      return `http://localhost:${port}`
    }
  }

  return null
}

async function isMediaLibraryViteUrl(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) {
      return false
    }

    const html = await response.text()
    return html.includes("<title>Media Library</title>") && html.includes("/src/main.tsx")
  } catch {
    return false
  }
}

function isApiOrMediaPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/media" || pathname.startsWith("/media/")
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function isCliEntry(): boolean {
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === SERVER_ENTRY_FILE)
}

function resolveMediaDir(value: unknown): string {
  return resolveMediaDirFromRoot(ROOT_DIR, value)
}

function registerBackgroundJobs(): void {
  registerBackgroundJob({
    id: CREATION_QUEUE_BACKGROUND_JOB_ID,
    label: "Creation queue",
    enabled: BACKGROUND_WORKERS_ENABLED,
    startupDelayMs: 0,
    handler: runCreationQueueBackgroundJob,
  })
  registerBackgroundJob({
    id: "missing-video-thumbnails",
    label: "Missing video thumbnails",
    enabled: BACKGROUND_WORKERS_ENABLED && BACKGROUND_THUMBNAIL_ENABLED,
    intervalMs: BACKGROUND_THUMBNAIL_INTERVAL_MS,
    startupDelayMs: BACKGROUND_THUMBNAIL_STARTUP_DELAY_MS,
    handler: () => runMissingThumbnailBackgroundJob({ limit: BACKGROUND_THUMBNAIL_BATCH_SIZE }),
  })
  registerBackgroundJob({
    id: "playbox-sync",
    label: "Playbox sync",
    enabled: BACKGROUND_WORKERS_ENABLED && AUTO_SYNC_ENABLED,
    intervalMs: AUTO_SYNC_INTERVAL_MS,
    startupDelayMs: AUTO_SYNC_STARTUP_DELAY_MS + PLAYBOX_SYNC_STARTUP_OFFSET_MS,
    handler: async () => {
      if (syncState.running) {
        return { skipped: true, reason: "sync-running" }
      }

      await startPlayboxSync()
      return {
        scanned: syncState.scanned,
        downloaded: syncState.downloaded,
        skipped: syncState.skipped,
        errors: syncState.errors.length,
      }
    },
  })
}

export {
  acceptAuthorization,
  autoSyncState,
  authBrowser,
  connectAuthAccount,
  buildFacets,
  buildCreateApiRequest,
  createCatalogBackup,
  deleteCatalogItemRemote,
  createMediaJob,
  deleteCreateTemplate,
  downloadCreateJob,
  findJobForTemplate,
  duplicateCreation,
  getCatalogDownloadQueue,
  getAuthAccountStatuses,
  getBackgroundWorkerStatus,
  getCreateModes,
  getCreateTemplateRegistryResponse,
  getCreationDetails,
  getCreations,
  getDefaultAccountEmail,
  getMediaGenerationConcurrencyLimit,
  getThumbnailGenerationQueue,
  getItems,
  hashBuffer,
  importPlayboxCurl,
  importCreateTemplateFromHistory,
  isDownloadableCatalogItem,
  jobFromCatalogItem,
  listCatalogBackups,
  loadCreateTemplateRegistry,
  normalizeJob,
  pollCreateJob,
  playboxAuthBrowser,
  resolveCreateSource,
  saveCreateTemplateRegistry,
  setMediaGenerationConcurrencyLimit,
  saveCreateTemplateFromCreation,
  saveCreateTemplateFromRequest,
  applyDuplicateMetadata,
  reconcileCatalogWithLocalFiles,
  refreshAuthAccount,
  refreshPlayboxImportedAuthorization,
  requestSyncCancellation,
  refreshCreations,
  restoreCatalogBackup,
  resolveMediaDir,
  removeAuthAccount,
  runCreationQueueBackgroundJob,
  runMissingThumbnailBackgroundJob,
  server,
  setCatalogItemFavoriteRemote,
  startCatalogDownload,
  startAutoSyncLoop,
  startBackgroundWorkers,
  startCreationQueueProcessing,
  startLibraryVerification,
  startPlayboxSync,
  startSync,
  startThumbnailGeneration,
  syncState,
  triggerAutoSync,
}
