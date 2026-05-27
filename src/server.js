import http from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureVideoThumbnail, getThumbnailDir } from "./thumbnails.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const __dirname = path.dirname(CURRENT_FILE);
const ROOT_DIR = path.resolve(__dirname, "..");
loadDotEnv(path.join(ROOT_DIR, ".env"));

const PORT = Number(process.env.PORT || 5177);
const API_BASE_URL = process.env.GENERATEPORN_API_URL || "https://api.generateporn.ai/api/jobs";
const PAGE_LIMIT = Number(process.env.GENERATEPORN_PAGE_LIMIT || 1000);
const MEDIA_DIR = resolveMediaDir(process.env.MEDIA_DIR || "media");
const CATALOG_PATH = path.join(MEDIA_DIR, "catalog.json");
const BACKUP_DIR = path.join(MEDIA_DIR, "_catalog_backups");
const THUMBNAIL_DIR = getThumbnailDir(MEDIA_DIR);
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SYNC_DELAY_MS = Number(process.env.SYNC_DELAY_MS || 150);

const authState = {
  authorization: normalizeAuthorization(process.env.GENERATEPORN_AUTHORIZATION),
  expiresAt: getJwtExpiration(process.env.GENERATEPORN_AUTHORIZATION),
  receivedAt: process.env.GENERATEPORN_AUTHORIZATION ? new Date().toISOString() : null,
  source: process.env.GENERATEPORN_AUTHORIZATION ? "env" : null
};

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
  finishedAt: null
};

await mkdir(MEDIA_DIR, { recursive: true });

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
      return sendJson(response, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, {
        mediaDir: MEDIA_DIR,
        hasCookie: Boolean(process.env.GENERATEPORN_COOKIE),
        hasAuthorization: Boolean(getActiveAuthorization()),
        authorizationExpiresAt: getAuthExpiresAt(),
        authorizationSource: authState.source,
        thumbnailDir: THUMBNAIL_DIR,
        pageLimit: PAGE_LIMIT
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/token") {
      const body = await readJsonBody(request);
      const authorization = normalizeAuthorization(body.authorization || body.token);

      if (!authorization) {
        return sendJson(response, { ok: false, error: "Missing bearer token." }, 400);
      }

      const expiresAt = getJwtExpiration(authorization);
      if (!expiresAt) {
        return sendJson(response, { ok: false, error: "Token is not a JWT with an exp claim." }, 400);
      }

      if (Date.parse(expiresAt) <= Date.now() + 5000) {
        return sendJson(response, { ok: false, error: "Token is expired or about to expire." }, 400);
      }

      authState.authorization = authorization;
      authState.expiresAt = expiresAt;
      authState.receivedAt = new Date().toISOString();
      authState.source = body.source || "browser";

      return sendJson(response, {
        ok: true,
        expiresAt: authState.expiresAt,
        source: authState.source
      });
    }

    if (request.method === "GET" && url.pathname === "/api/items") {
      return sendJson(response, await getItems(url.searchParams));
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/export") {
      return sendCatalogExport(response);
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/backups") {
      return sendJson(response, { backups: await listCatalogBackups() });
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/backup") {
      const body = await readJsonBody(request);
      const backup = await createCatalogBackup(body.reason || "manual");
      return sendJson(response, { ok: true, backup });
    }

    if (request.method === "POST" && url.pathname === "/api/catalog/restore") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, thumbnail, or verification job is already running." }, 409);
      }

      const body = await readJsonBody(request);
      const restored = await restoreCatalogBackup(body.file);
      return sendJson(response, { ok: true, restored });
    }

    if (request.method === "GET" && url.pathname === "/api/sync/status") {
      return sendJson(response, syncState);
    }

    if (request.method === "POST" && url.pathname === "/api/sync/start") {
      const body = await readJsonBody(request);

      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync is already running." }, 409);
      }

      const incremental = body.incremental !== false;
      startSync({ incremental }).catch(handleBackgroundError);

      return sendJson(response, { ok: true, incremental });
    }

    if (request.method === "POST" && url.pathname === "/api/sync/cancel") {
      if (!syncState.running) {
        return sendJson(response, { ok: false, error: "No sync or download is running." }, 409);
      }

      requestSyncCancellation();
      return sendJson(response, { ok: true, status: syncState.status });
    }

    if (request.method === "POST" && url.pathname === "/api/download/missing") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync or download is already running." }, 409);
      }

      startCatalogDownload({ mode: "download-missing" }).catch(handleBackgroundError);
      return sendJson(response, { ok: true, mode: "download-missing" });
    }

    if (request.method === "POST" && url.pathname === "/api/download/retry-errors") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync or download is already running." }, 409);
      }

      startCatalogDownload({ mode: "retry-errors" }).catch(handleBackgroundError);
      return sendJson(response, { ok: true, mode: "retry-errors" });
    }

    if (request.method === "POST" && url.pathname === "/api/thumbnails/generate") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, or thumbnail job is already running." }, 409);
      }

      startThumbnailGeneration().catch(handleBackgroundError);
      return sendJson(response, { ok: true, mode: "generate-thumbnails" });
    }

    if (request.method === "POST" && url.pathname === "/api/library/verify") {
      if (syncState.running) {
        return sendJson(response, { ok: false, error: "A sync, download, thumbnail, or verification job is already running." }, 409);
      }

      startLibraryVerification().catch(handleBackgroundError);
      return sendJson(response, { ok: true, mode: "verify-library" });
    }

    if (request.method === "POST" && url.pathname === "/api/history/reset") {
      await createCatalogBackup("before-history-reset");
      const catalog = await loadCatalog();
      catalog.lastSeenJobId = null;
      catalog.downloadedJobIds = [];
      catalog.updatedAt = new Date().toISOString();
      await saveCatalog(catalog);
      return sendJson(response, { ok: true });
    }

    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      return serveMedia(request, response, url.pathname.slice("/media/".length));
    }

    if (request.method === "GET") {
      return serveStatic(response, url.pathname);
    }

    sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    sendJson(response, {
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

if (isCliEntry()) {
  server.listen(PORT, () => {
    console.log(`Media library running at http://localhost:${PORT}`);
    console.log(`Media directory: ${MEDIA_DIR}`);
  });
}

async function startSync({ incremental }) {
  resetSyncState({
    mode: incremental ? "incremental" : "full",
    message: incremental ? "Starting incremental sync..." : "Starting full sync..."
  });
  await createCatalogBackup(incremental ? "before-incremental-sync" : "before-full-sync");

  const catalog = await loadCatalog();
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const downloadedJobIds = new Set(catalog.downloadedJobIds || []);
  const downloadQueue = [];
  const queuedJobIds = new Set();
  const previousLastSeenJobId = incremental ? catalog.lastSeenJobId : null;
  let newestJobId = null;
  let stoppedAtPrevious = false;

  for (const item of catalog.items) {
    if (isDownloadableCatalogItem(item) && !item.localFile) {
      enqueueDownload(downloadQueue, queuedJobIds, jobFromCatalogItem(item));
    }
  }

  if (hasApiAuth()) {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      if (shouldStopForCancellation()) {
        break;
      }

      syncState.currentPage = page;
      syncState.message = `Fetching page ${page}...`;

      const jobs = await fetchJobsPage(page);

      if (jobs.length === 0) {
        syncState.message = "Reached the end of the API.";
        break;
      }

      for (const job of jobs) {
        syncState.scanned += 1;

        if (!newestJobId) {
          newestJobId = job.id;
        }

        if (previousLastSeenJobId && job.id === previousLastSeenJobId) {
          stoppedAtPrevious = true;
          syncState.message = "Reached the previously saved latest job.";
          break;
        }

        const existing = itemById.get(job.id);
        const merged = toCatalogItem(job, existing);
        itemById.set(job.id, merged);

        if (!isDownloadableJob(job)) {
          syncState.skipped += 1;
          continue;
        }

        if (existing?.localFile && await fileExists(path.join(MEDIA_DIR, existing.localFile))) {
          downloadedJobIds.add(job.id);
          syncState.skipped += 1;
          continue;
        }

        enqueueDownload(downloadQueue, queuedJobIds, job);
      }

      catalog.items = sortItems(Array.from(itemById.values()));
      catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000);
      catalog.lastSeenJobId = newestJobId || catalog.lastSeenJobId;
      catalog.updatedAt = new Date().toISOString();
      await saveCatalog(catalog);

      if (stoppedAtPrevious) {
        break;
      }
    }
  } else {
    syncState.message = downloadQueue.length
      ? "No active API auth; downloading known missing files only."
      : "No active API auth and no known missing files to download.";
  }

  await runDownloadQueue({
    catalog,
    itemById,
    downloadedJobIds,
    downloadQueue,
    lastSeenJobId: newestJobId || catalog.lastSeenJobId,
    startMessage: `Finished API scan. Downloading ${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"}...`
  });

  const cancelled = Boolean(syncState.cancelRequested);

  if (!cancelled && syncState.currentPage >= PAGE_LIMIT && !stoppedAtPrevious) {
    syncState.errors.push({
      message: `Stopped after page limit ${PAGE_LIMIT}; increase GENERATEPORN_PAGE_LIMIT if needed.`
    });
  }

  catalog.items = sortItems(Array.from(itemById.values()));
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000);
  catalog.lastSeenJobId = newestJobId || catalog.lastSeenJobId;
  catalog.updatedAt = new Date().toISOString();
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled,
    stoppedAtPrevious,
    finishedAt: new Date().toISOString()
  };
  await saveCatalog(catalog);

  finishSyncRun({
    cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished. Downloaded ${syncState.downloaded} new file${syncState.downloaded === 1 ? "" : "s"}.`
  });
}

async function startCatalogDownload({ mode }) {
  const isRetry = mode === "retry-errors";
  resetSyncState({
    mode,
    message: isRetry ? "Preparing failed downloads..." : "Preparing missing downloads..."
  });
  await createCatalogBackup(`before-${mode}`);

  const catalog = await loadCatalog();
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const downloadedJobIds = new Set(catalog.downloadedJobIds || []);
  const downloadQueue = getCatalogDownloadQueue(catalog.items, { retryErrors: isRetry });

  syncState.scanned = catalog.items.length;
  syncState.skipped = Math.max(0, catalog.items.length - downloadQueue.length);

  await runDownloadQueue({
    catalog,
    itemById,
    downloadedJobIds,
    downloadQueue,
    lastSeenJobId: catalog.lastSeenJobId,
    startMessage: `Downloading ${downloadQueue.length} ${isRetry ? "failed" : "missing"} file${downloadQueue.length === 1 ? "" : "s"}...`
  });

  catalog.items = sortItems(Array.from(itemById.values()));
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000);
  catalog.updatedAt = new Date().toISOString();
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt: new Date().toISOString()
  };
  await saveCatalog(catalog);

  finishSyncRun({
    cancelled: catalog.lastRun.cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}.`
  });
}

function finishSyncRun({ cancelled, finishedAt, completeMessage }) {
  syncState.running = false;
  syncState.status = cancelled ? "cancelled" : "idle";
  syncState.cancelRequested = false;
  syncState.finishedAt = finishedAt;
  syncState.message = cancelled
    ? `Cancelled. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"} before stopping.`
    : completeMessage;
}

function requestSyncCancellation() {
  syncState.cancelRequested = true;
  syncState.status = "cancelling";
  syncState.message = "Cancellation requested. Stopping after the current step...";
}

function shouldStopForCancellation() {
  if (!syncState.cancelRequested) {
    return false;
  }

  syncState.status = "cancelling";
  syncState.message = "Cancelling...";
  return true;
}

async function startThumbnailGeneration() {
  resetSyncState({
    mode: "generate-thumbnails",
    message: "Preparing video thumbnails..."
  });
  await createCatalogBackup("before-thumbnail-generation");

  const catalog = await loadCatalog();
  const queue = getThumbnailGenerationQueue(catalog.items);

  syncState.scanned = catalog.items.length;
  syncState.skipped = Math.max(0, catalog.items.length - queue.length);
  syncState.message = `Generating ${queue.length} video thumbnail${queue.length === 1 ? "" : "s"}...`;

  for (const item of queue) {
    if (shouldStopForCancellation()) {
      break;
    }

    const thumbnail = await ensureCatalogThumbnail(item.localFile);
    applyCatalogThumbnail(item, thumbnail);
    syncState.downloaded += thumbnail.thumbnailFile ? 1 : 0;
    syncState.message = `Generated ${syncState.downloaded} of ${queue.length} thumbnail${queue.length === 1 ? "" : "s"}.`;
    catalog.updatedAt = new Date().toISOString();
    await saveCatalog(catalog);
    await sleep(SYNC_DELAY_MS);
  }

  catalog.updatedAt = new Date().toISOString();
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    finishedAt: new Date().toISOString()
  };
  await saveCatalog(catalog);

  finishSyncRun({
    cancelled: catalog.lastRun.cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: `Finished. Generated ${syncState.downloaded} thumbnail${syncState.downloaded === 1 ? "" : "s"}.`
  });
}

async function startLibraryVerification() {
  resetSyncState({
    mode: "verify-library",
    message: "Preparing library verification..."
  });
  await createCatalogBackup("before-library-verification");

  const catalog = await loadCatalog();
  const mediaFiles = await getLocalMediaFiles();
  const itemByLocalFile = new Map(
    catalog.items
      .filter((item) => item.localFile)
      .map((item) => [item.localFile, item])
  );
  const orphanFiles = [];

  syncState.scanned = mediaFiles.length;
  syncState.message = `Verifying ${mediaFiles.length} local file${mediaFiles.length === 1 ? "" : "s"}...`;

  for (const [index, file] of mediaFiles.entries()) {
    if (shouldStopForCancellation()) {
      break;
    }

    const item = itemByLocalFile.get(file.localFile);
    const existingHash = item?.sha256 && Number(item.fileSize || item.size || 0) === file.size
      ? item.sha256
      : null;
    const sha256 = existingHash || await hashFile(file.absolutePath);
    const verifiedAt = new Date().toISOString();

    if (item) {
      item.size = file.size;
      item.fileSize = file.size;
      item.contentType = file.contentType;
      item.sha256 = sha256;
      item.verifiedAt = verifiedAt;
      item.downloadError = null;
    } else {
      orphanFiles.push({
        localFile: file.localFile,
        size: file.size,
        fileSize: file.size,
        contentType: file.contentType,
        sha256,
        discoveredAt: verifiedAt
      });
    }

    syncState.downloaded = index + 1;
    syncState.message = `Verified ${syncState.downloaded} of ${mediaFiles.length} local file${mediaFiles.length === 1 ? "" : "s"}.`;
    await sleep(SYNC_DELAY_MS);
  }

  applyDuplicateMetadata(catalog.items);
  syncState.skipped = Math.max(0, syncState.scanned - syncState.downloaded);
  catalog.orphanFiles = orphanFiles;
  catalog.updatedAt = new Date().toISOString();
  catalog.lastRun = {
    mode: syncState.mode,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: Math.max(0, syncState.scanned - syncState.downloaded),
    errors: syncState.errors,
    cancelled: Boolean(syncState.cancelRequested),
    orphanFiles: orphanFiles.length,
    duplicateItems: catalog.items.filter((item) => Number(item.duplicateGroupSize || 0) > 1).length,
    finishedAt: new Date().toISOString()
  };
  await saveCatalog(catalog);

  finishSyncRun({
    cancelled: catalog.lastRun.cancelled,
    finishedAt: catalog.lastRun.finishedAt,
    completeMessage: `Finished. Verified ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}, found ${catalog.lastRun.duplicateItems} duplicate item${catalog.lastRun.duplicateItems === 1 ? "" : "s"} and ${orphanFiles.length} orphan file${orphanFiles.length === 1 ? "" : "s"}.`
  });
}

function getThumbnailGenerationQueue(items) {
  return items.filter((item) => {
    if (!item.localFile?.toLowerCase().endsWith(".mp4")) {
      return false;
    }

    if (item.thumbnailError) {
      return false;
    }

    return !item.thumbnailFile;
  });
}

function getCatalogDownloadQueue(items, { retryErrors = false } = {}) {
  const downloadQueue = [];
  const queuedJobIds = new Set();

  for (const item of items) {
    const matchesMode = retryErrors
      ? Boolean(item.downloadError) && !item.localFile
      : !item.localFile && !item.downloadError;

    if (matchesMode && isDownloadableCatalogItem(item)) {
      enqueueDownload(downloadQueue, queuedJobIds, jobFromCatalogItem(item));
    }
  }

  return downloadQueue;
}

async function runDownloadQueue({
  catalog,
  itemById,
  downloadedJobIds,
  downloadQueue,
  lastSeenJobId,
  startMessage
}) {
  syncState.message = startMessage;

  for (const job of downloadQueue) {
    if (shouldStopForCancellation()) {
      break;
    }

    const existing = itemById.get(job.id);

    try {
      const downloaded = await downloadJob(job);
      itemById.set(job.id, toCatalogItem(job, {
        ...existing,
        ...downloaded,
        downloadError: null
      }));
      downloadedJobIds.add(job.id);
      syncState.downloaded += 1;
      syncState.message = `Downloaded ${syncState.downloaded} of ${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      syncState.errors.push({ id: job.id, message });
      itemById.set(job.id, {
        ...existing,
        downloadError: message
      });
    }

    catalog.items = sortItems(Array.from(itemById.values()));
    catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000);
    catalog.lastSeenJobId = lastSeenJobId || catalog.lastSeenJobId;
    catalog.updatedAt = new Date().toISOString();
    await saveCatalog(catalog);

    await sleep(SYNC_DELAY_MS);
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
    finishedAt: null
  });
}

function handleBackgroundError(error) {
  syncState.running = false;
  syncState.status = "error";
  syncState.cancelRequested = false;
  syncState.message = error instanceof Error ? error.message : String(error);
  syncState.errors.push({ message: syncState.message });
  syncState.finishedAt = new Date().toISOString();
}

async function fetchJobsPage(page) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("type", "all");
  url.searchParams.set("page", String(page));

  const response = await fetch(url, {
    headers: buildApiHeaders()
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`API returned ${response.status}. Open app.generateporn.ai and use the extension panel to send a fresh Clerk token to the local server.`);
  }

  if (!response.ok) {
    throw new Error(`API request failed on page ${page}: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();

  if (!Array.isArray(body?.results)) {
    throw new Error(`Unexpected API response on page ${page}: missing results array`);
  }

  return body.results;
}

function buildApiHeaders() {
  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "origin": "https://app.generateporn.ai",
    "referer": "https://app.generateporn.ai/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
  };

  if (process.env.GENERATEPORN_COOKIE) {
    headers.cookie = process.env.GENERATEPORN_COOKIE;
  }

  const authorization = getActiveAuthorization();
  if (authorization) {
    headers.authorization = authorization;
  }

  if (process.env.GENERATEPORN_EXTRA_HEADERS_JSON) {
    Object.assign(headers, JSON.parse(process.env.GENERATEPORN_EXTRA_HEADERS_JSON));
  }

  return headers;
}

async function downloadJob(job) {
  const normalizedJob = normalizeJob(job);
  const filename = buildFilename(normalizedJob);
  const localPath = path.join(MEDIA_DIR, filename);
  await mkdir(path.dirname(localPath), { recursive: true });

  const response = await fetch(normalizedJob.output_url, {
    headers: {
      "accept": "*/*",
      "referer": "https://app.generateporn.ai/"
    }
  });

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const tempPath = `${localPath}.tmp`;
  await writeFile(tempPath, bytes);
  await rename(tempPath, localPath);
  const thumbnail = await ensureCatalogThumbnail(filename);

  return {
    localFile: filename,
    size: bytes.byteLength,
    fileSize: bytes.byteLength,
    sha256: hashBuffer(bytes),
    verifiedAt: new Date().toISOString(),
    contentType: response.headers.get("content-type") || null,
    ...thumbnail,
    downloadedAt: new Date().toISOString()
  };
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
    createdAt: job.created_at || null,
    createdAtIso: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : null,
    externalTaskId: job.external_task_id || null,
    shared: Boolean(job.shared),
    favorited: Boolean(job.favorited),
    error: job.error || null,
    updatedAt: new Date().toISOString()
  };
}

function isDownloadableJob(job) {
  return Boolean(
    job?.id &&
    job.status === "done" &&
    typeof job.output_url === "string" &&
    /\.(png|mp4)(?:[?#].*)?$/i.test(job.output_url)
  );
}

function buildFilename(job) {
  const normalizedJob = normalizeJob(job);
  const extension = getExtension(normalizedJob.output_url);
  const date = normalizedJob.created_at
    ? new Date(Number(normalizedJob.created_at) * 1000).toISOString().slice(0, 10)
    : "undated";
  const type = sanitizePathPart(normalizedJob.type || "media");
  const id = sanitizePathPart(normalizedJob.id);

  return `${date}/${date}_${type}_${id}.${extension}`;
}

function getExtension(url) {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1]?.toLowerCase() || "bin";
  } catch {
    const match = url.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
    return match?.[1]?.toLowerCase() || "bin";
  }
}

async function getItems(searchParams) {
  const catalog = await loadCatalog();
  const query = (searchParams.get("q") || "").trim().toLowerCase();
  const media = searchParams.get("media") || "all";
  const status = searchParams.get("status") || "all";
  const sort = searchParams.get("sort") || "newest";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = clamp(Number(searchParams.get("pageSize") || 60), 12, 240);

  let items = catalog.items || [];
  const facets = buildFacets(items);

  if (media !== "all") {
    items = items.filter((item) => {
      if (media === "image") return isImageItem(item);
      if (media === "video") return isVideoItem(item);
      return true;
    });
  }

  if (status !== "all") {
    items = items.filter((item) => {
      if (status === "downloaded") return Boolean(item.localFile);
      if (status === "missing") return !item.localFile && !item.downloadError;
      if (status === "error") return Boolean(item.downloadError);
      if (status === "favorited") return Boolean(item.favorited);
      if (status === "duplicate") return Number(item.duplicateGroupSize || 0) > 1;
      if (status === "unverified") return Boolean(item.localFile) && !item.sha256;
      return true;
    });
  }

  if (query) {
    items = items.filter((item) => [
      item.id,
      item.type,
      item.prompt,
      item.negativePrompt,
      item.localFile
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }

  items = sortItemsForView(items, sort);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    items: pageItems.map(toPublicCatalogItem),
    total,
    page: currentPage,
    pageSize,
    pageCount,
    facets: {
      ...facets,
      orphanFiles: catalog.orphanFiles?.length || 0
    },
    catalogUpdatedAt: catalog.updatedAt || null,
    lastSeenJobId: catalog.lastSeenJobId || null,
    lastRun: catalog.lastRun || null
  };
}

function buildFacets(items) {
  const media = {
    all: items.length,
    image: 0,
    video: 0
  };
  const status = {
    all: items.length,
    downloaded: 0,
    missing: 0,
    error: 0,
    favorited: 0,
    duplicate: 0,
    unverified: 0
  };

  for (const item of items) {
    if (isImageItem(item)) media.image += 1;
    if (isVideoItem(item)) media.video += 1;
    if (item.localFile) status.downloaded += 1;
    if (!item.localFile && !item.downloadError) status.missing += 1;
    if (item.downloadError) status.error += 1;
    if (item.favorited) status.favorited += 1;
    if (Number(item.duplicateGroupSize || 0) > 1) status.duplicate += 1;
    if (item.localFile && !item.sha256) status.unverified += 1;
  }

  return {
    media,
    status
  };
}

function toPublicCatalogItem(item) {
  return {
    ...item,
    posterUrl: item.thumbnailFile ? mediaUrlForLocalFile(item.thumbnailFile) : null
  };
}

function mediaUrlForLocalFile(localFile) {
  return `/media/${String(localFile).split("/").map(encodeURIComponent).join("/")}`;
}

function sortItemsForView(items, sort) {
  return items.slice().sort((a, b) => {
    if (sort === "oldest") return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    if (sort === "largest") return Number(b.size || 0) - Number(a.size || 0);
    if (sort === "smallest") return Number(a.size || 0) - Number(b.size || 0);
    if (sort === "type") return String(a.type || "").localeCompare(String(b.type || "")) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function isImageItem(item) {
  return item.localFile?.toLowerCase().endsWith(".png") || item.outputUrl?.toLowerCase().match(/\.png(?:[?#].*)?$/);
}

function isVideoItem(item) {
  return item.localFile?.toLowerCase().endsWith(".mp4") || item.outputUrl?.toLowerCase().match(/\.mp4(?:[?#].*)?$/);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

async function loadCatalog() {
  try {
    const parsed = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    const catalog = {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      downloadedJobIds: Array.isArray(parsed.downloadedJobIds) ? parsed.downloadedJobIds : [],
      orphanFiles: Array.isArray(parsed.orphanFiles) ? parsed.orphanFiles : [],
      lastSeenJobId: parsed.lastSeenJobId || null,
      updatedAt: parsed.updatedAt || null,
      lastRun: parsed.lastRun || null
    };
    const changed = await reconcileCatalogWithLocalFiles(catalog);

    if (changed) {
      catalog.updatedAt = new Date().toISOString();
      await saveCatalog(catalog);
    }

    return catalog;
  } catch {
    return {
      items: [],
      downloadedJobIds: [],
      orphanFiles: [],
      lastSeenJobId: null,
      updatedAt: null,
      lastRun: null
    };
  }
}

async function reconcileCatalogWithLocalFiles(catalog) {
  const filesById = await getLocalMediaFilesByJobId();
  const downloadedJobIds = new Set(catalog.downloadedJobIds || []);
  let changed = false;

  for (const item of catalog.items) {
    const localFile = filesById.get(item.id);

    if (localFile) {
      if (
        item.localFile !== localFile.localFile ||
        item.size !== localFile.size ||
        item.contentType !== localFile.contentType
      ) {
        item.localFile = localFile.localFile;
        item.size = localFile.size;
        item.fileSize = localFile.size;
        item.contentType = localFile.contentType;
        item.downloadedAt ||= localFile.downloadedAt;
        item.downloadError = null;
        changed = true;
      }

      if (await reconcileCatalogItemThumbnail(item)) {
        changed = true;
      }

      downloadedJobIds.add(item.id);
      continue;
    }

    if (item.localFile) {
      item.localFile = null;
      item.size = null;
      item.fileSize = null;
      item.sha256 = null;
      item.verifiedAt = null;
      item.duplicateOf = null;
      item.duplicateGroupSize = null;
      item.contentType = null;
      item.thumbnailFile = null;
      item.thumbnailGeneratedAt = null;
      item.thumbnailError = null;
      changed = true;
    }
  }

  const nextDownloadedJobIds = Array.from(downloadedJobIds).slice(-10000);
  if (JSON.stringify(catalog.downloadedJobIds || []) !== JSON.stringify(nextDownloadedJobIds)) {
    catalog.downloadedJobIds = nextDownloadedJobIds;
    changed = true;
  }

  return changed;
}

function applyDuplicateMetadata(items) {
  const groups = new Map();

  for (const item of items) {
    item.duplicateOf = null;
    item.duplicateGroupSize = null;

    if (!item.sha256 || !item.localFile) {
      continue;
    }

    const key = `${item.sha256}:${item.fileSize || item.size || 0}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const canonical = group
      .slice()
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id).localeCompare(String(b.id)))[0];

    for (const item of group) {
      item.duplicateGroupSize = group.length;
      item.duplicateOf = item.id === canonical.id ? null : canonical.id;
    }
  }
}

async function reconcileCatalogItemThumbnail(item) {
  if (!item.localFile?.toLowerCase().endsWith(".mp4")) {
    if (item.thumbnailFile || item.thumbnailError) {
      item.thumbnailFile = null;
      item.thumbnailGeneratedAt = null;
      item.thumbnailError = null;
      return true;
    }

    return false;
  }

  if (item.thumbnailFile && await fileExists(path.join(MEDIA_DIR, item.thumbnailFile))) {
    return false;
  }

  if (item.thumbnailFile) {
    item.thumbnailFile = null;
    item.thumbnailGeneratedAt = null;
    return true;
  }

  return false;
}

async function ensureCatalogThumbnail(localFile) {
  const result = await ensureVideoThumbnail(MEDIA_DIR, localFile);

  if (result.thumbnailFile) {
    return {
      thumbnailFile: result.thumbnailFile,
      thumbnailGeneratedAt: result.generatedAt || null,
      thumbnailError: null
    };
  }

  if (result.error) {
    return {
      thumbnailFile: null,
      thumbnailGeneratedAt: null,
      thumbnailError: result.error
    };
  }

  return {};
}

function applyCatalogThumbnail(item, thumbnail) {
  let changed = false;

  for (const key of ["thumbnailFile", "thumbnailGeneratedAt", "thumbnailError"]) {
    if (Object.hasOwn(thumbnail, key) && item[key] !== thumbnail[key]) {
      item[key] = thumbnail[key];
      changed = true;
    }
  }

  return changed;
}

async function getLocalMediaFilesByJobId() {
  const files = new Map();
  const entries = await getLocalMediaFiles();

  for (const file of entries) {
    const filename = path.basename(file.absolutePath);
    const match = filename.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|mp4)$/i);

    if (!match) {
      continue;
    }

    files.set(match[1], {
      localFile: file.localFile,
      size: file.size,
      contentType: file.contentType,
      downloadedAt: file.downloadedAt
    });
  }

  return files;
}

async function getLocalMediaFiles() {
  const entries = await listMediaFiles(MEDIA_DIR);
  const files = [];

  for (const filePath of entries) {
    const fileStat = await stat(filePath);
    const localFile = path.relative(MEDIA_DIR, filePath).split(path.sep).join("/");

    files.push({
      absolutePath: filePath,
      localFile,
      size: fileStat.size,
      contentType: contentTypeFor(filePath),
      downloadedAt: fileStat.mtime.toISOString()
    });
  }

  return files.sort((a, b) => a.localFile.localeCompare(b.localFile));
}

async function listMediaFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, {
      withFileTypes: true
    });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listMediaFiles(entryPath));
      continue;
    }

    if (entry.isFile() && /\.(png|mp4)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function hashBuffer(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function enqueueDownload(downloadQueue, queuedJobIds, job) {
  if (!job?.id || queuedJobIds.has(job.id)) {
    return;
  }

  downloadQueue.push(job);
  queuedJobIds.add(job.id);
}

function isDownloadableCatalogItem(item) {
  return Boolean(
    item?.id &&
    item.status === "done" &&
    typeof item.outputUrl === "string" &&
    /\.(png|mp4)(?:[?#].*)?$/i.test(item.outputUrl)
  );
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
    error: item.error
  };
}

function normalizeJob(job) {
  return {
    ...job,
    output_url: job.output_url || job.outputUrl,
    created_at: job.created_at || job.createdAt,
    user_id: job.user_id || job.userId,
    negative_prompt: job.negative_prompt || job.negativePrompt,
    input_url: job.input_url || job.inputUrl,
    external_task_id: job.external_task_id || job.externalTaskId
  };
}

async function saveCatalog(catalog) {
  await mkdir(MEDIA_DIR, { recursive: true });
  const tempPath = `${CATALOG_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await rename(tempPath, CATALOG_PATH);
}

async function createCatalogBackup(reason = "manual") {
  if (!await fileExists(CATALOG_PATH)) {
    return null;
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  const raw = await readFile(CATALOG_PATH, "utf8");
  const timestamp = new Date().toISOString();
  const safeReason = sanitizePathPart(reason).toLowerCase();
  const filename = `${timestamp.replace(/[:.]/g, "-")}_${safeReason}.json`;
  const backupPath = path.join(BACKUP_DIR, filename);
  await writeFile(backupPath, raw);

  return backupSummaryFromRaw(filename, raw, timestamp, safeReason);
}

async function listCatalogBackups() {
  let entries;

  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(BACKUP_DIR, entry.name);
    const [fileStat, raw] = await Promise.all([
      stat(filePath),
      readFile(filePath, "utf8")
    ]);
    backups.push(backupSummaryFromRaw(entry.name, raw, fileStat.mtime.toISOString()));
  }

  return backups.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function restoreCatalogBackup(filename) {
  const backupPath = resolveCatalogBackupPath(filename);
  const raw = await readFile(backupPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.items)) {
    throw new Error("Selected backup is not a valid catalog.");
  }

  await createCatalogBackup("before-restore");
  const tempPath = `${CATALOG_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`);
  await rename(tempPath, CATALOG_PATH);

  return backupSummaryFromRaw(path.basename(backupPath), raw);
}

async function sendCatalogExport(response) {
  if (!await fileExists(CATALOG_PATH)) {
    return sendJson(response, { error: "No catalog exists yet." }, 404);
  }

  const raw = await readFile(CATALOG_PATH, "utf8");
  const filename = `catalog-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "access-control-allow-origin": "*"
  });
  response.end(raw);
}

function resolveCatalogBackupPath(filename) {
  if (!filename || path.basename(filename) !== filename || !filename.endsWith(".json")) {
    throw new Error("Invalid backup filename.");
  }

  const backupPath = path.resolve(BACKUP_DIR, filename);
  const backupRoot = path.resolve(BACKUP_DIR);

  if (!backupPath.startsWith(`${backupRoot}${path.sep}`)) {
    throw new Error("Invalid backup path.");
  }

  return backupPath;
}

function backupSummaryFromRaw(filename, raw, fallbackCreatedAt = null, fallbackReason = null) {
  let parsed = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const match = filename.match(/^(.+?)_([a-z0-9_-]+)\.json$/i);
  const createdAt = match?.[1]
    ? match[1].replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z")
    : fallbackCreatedAt;

  return {
    file: filename,
    reason: fallbackReason || match?.[2] || "unknown",
    createdAt,
    size: Buffer.byteLength(raw),
    itemCount: Array.isArray(parsed?.items) ? parsed.items.length : null,
    catalogUpdatedAt: parsed?.updatedAt || null
  };
}

function sortItems(items) {
  return items.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function serveStatic(response, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${cleanPath}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(response, { error: "Not found" }, 404);
  }

  if (!await fileExists(filePath)) {
    return sendJson(response, { error: "Not found" }, 404);
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath)
  });
  createReadStream(filePath).pipe(response);
}

async function serveMedia(request, response, mediaPath) {
  const decodedPath = decodeURIComponent(mediaPath);
  const filePath = path.resolve(MEDIA_DIR, decodedPath);

  if (!filePath.startsWith(MEDIA_DIR)) {
    return sendJson(response, { error: "Not found" }, 404);
  }

  if (!await fileExists(filePath)) {
    return sendJson(response, { error: "Not found" }, 404);
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": "private, max-age=3600"
  });
  createReadStream(filePath).pipe(response);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, body, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp4": "video/mp4"
  };
  return types[extension] || "application/octet-stream";
}

function sanitizePathPart(value) {
  return String(value)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "unknown";
}

function resolveMediaDir(value) {
  const expanded = String(value).replace(/^~(?=$|\/|\\)/, process.env.HOME || "~");
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(ROOT_DIR, expanded);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAuthorization(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function getActiveAuthorization() {
  const now = Date.now();

  if (authState.authorization && (!authState.expiresAt || Date.parse(authState.expiresAt) > now + 5000)) {
    return authState.authorization;
  }

  const envAuthorization = normalizeAuthorization(process.env.GENERATEPORN_AUTHORIZATION);
  const envExpiresAt = getJwtExpiration(envAuthorization);
  if (envAuthorization && (!envExpiresAt || Date.parse(envExpiresAt) > now + 5000)) {
    return envAuthorization;
  }

  return null;
}

function hasApiAuth() {
  return Boolean(getActiveAuthorization() || process.env.GENERATEPORN_COOKIE);
}

function getAuthExpiresAt() {
  const active = getActiveAuthorization();
  if (!active) {
    return null;
  }

  return active === authState.authorization
    ? authState.expiresAt
    : getJwtExpiration(active);
}

function getJwtExpiration(authorization) {
  const token = normalizeAuthorization(authorization)?.replace(/^bearer\s+/i, "");
  if (!token || token.split(".").length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function loadDotEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] ??= value;
    }
  } catch {
    // A .env file is optional.
  }
}

function isCliEntry() {
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE);
}

export {
  buildFacets,
  createCatalogBackup,
  getCatalogDownloadQueue,
  getThumbnailGenerationQueue,
  getItems,
  hashBuffer,
  isDownloadableCatalogItem,
  jobFromCatalogItem,
  listCatalogBackups,
  normalizeJob,
  applyDuplicateMetadata,
  reconcileCatalogWithLocalFiles,
  requestSyncCancellation,
  restoreCatalogBackup,
  resolveMediaDir,
  server,
  startCatalogDownload,
  startLibraryVerification,
  startSync,
  startThumbnailGeneration,
  syncState
};
