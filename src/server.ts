import { mkdir } from "node:fs/promises"
import http from "node:http"
import path from "node:path"

import {
  acceptAuthorization,
  authBrowser,
  authState,
  getActiveAuthorization,
  getAuthExpiresAt,
  resetAuthRuntimeState,
} from "./server/auth-state.ts"
import { closeCatalogDb } from "./server/catalog-db.ts"
import {
  applyDuplicateMetadata,
  buildFacets,
  createCatalogBackup,
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
} from "./server/catalog.ts"
import {
  CREATE_HISTORY_PAGE_LIMIT,
  MEDIA_DIR,
  PAGE_LIMIT,
  PORT,
  ROOT_DIR,
  SERVER_ENTRY_FILE,
  THUMBNAIL_DIR,
  reloadConfigFromEnv,
} from "./server/config.ts"
import {
  buildCreateApiRequest,
  createMediaJob,
  downloadCreateJob,
  duplicateCreation,
  getCreationDetails,
  getCreations,
  pollCreateJob,
  refreshCreations,
  resolveCreateSource,
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
import { readJsonBody, sendJson, serveMedia, serveStatic } from "./server/static.ts"
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
  startSync,
  startThumbnailGeneration,
  syncState,
  triggerAutoSync,
} from "./server/sync.ts"
import { clamp, hashBuffer, resolveMediaDirFromRoot } from "./server/utils.ts"

reloadConfigFromEnv()
closeCatalogDb()
resetAuthRuntimeState()
resetSyncRuntimeState()
await mkdir(MEDIA_DIR, { recursive: true })

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`)

    if (request.method === "OPTIONS") {
      return sendJson(response, { ok: true })
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, {
        mediaDir: MEDIA_DIR,
        hasCookie: Boolean(process.env["GENERATEPORN_COOKIE"]),
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
      return sendJson(response, await duplicateCreation(creationDuplicateMatch[1] || ""))
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
      const body = await readJsonBody(request)
      return sendJson(
        response,
        await refreshCreations({
          pageLimit: clamp(Number(body["pageLimit"] || CREATE_HISTORY_PAGE_LIMIT), 1, PAGE_LIMIT),
        }),
      )
    }

    if (request.method === "POST" && url.pathname === "/api/auth/token") {
      const body = await readJsonBody(request)
      const auth = acceptAuthorization(body["authorization"] || body["token"], String(body["source"] || "browser"))

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
      return sendJson(response, await authBrowser.disconnect({ deleteProfile: Boolean(body["deleteProfile"]) }))
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
      const backup = await createCatalogBackup(String(body["reason"] || "manual"))
      return sendJson(response, { ok: true, backup })
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/restore") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, thumbnail, or verification job is already running." }, 409)
      }

      const body = await readJsonBody(request)
      const restored = await restoreCatalogBackup(String(body["file"] || ""))
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

      const incremental = body["incremental"] !== false
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
      getErrorStatusCode(error) || 500,
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

function isCliEntry(): boolean {
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === SERVER_ENTRY_FILE)
}

function resolveMediaDir(value: unknown): string {
  return resolveMediaDirFromRoot(ROOT_DIR, value)
}

export {
  acceptAuthorization,
  autoSyncState,
  authBrowser,
  buildFacets,
  buildCreateApiRequest,
  createCatalogBackup,
  createMediaJob,
  deleteCreateTemplate,
  downloadCreateJob,
  findJobForTemplate,
  duplicateCreation,
  getCatalogDownloadQueue,
  getCreateModes,
  getCreateTemplateRegistryResponse,
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
  saveCreateTemplateFromCreation,
  saveCreateTemplateFromRequest,
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
