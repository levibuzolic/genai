import { createReadStream } from "node:fs"
import type { Dirent } from "node:fs"
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync, backup as backupSqliteDatabase } from "node:sqlite"

import { ensureVideoThumbnail } from "../thumbnails.ts"
import { closeCatalogDb, getCatalogDb, parseJson, readCatalogFromDb, saveCatalog } from "./catalog-db.ts"
import { BACKUP_DIR, CATALOG_DB_PATH, MEDIA_DIR } from "./config.ts"
import { isRecord } from "./refinements.ts"
import { sendJson } from "./static.ts"
import type { Catalog, CatalogItem, GeneratePornJob, HttpResponse, LocalMediaFile, NormalizedJob, ThumbnailPatch } from "./types.ts"
import { clamp, contentTypeFor, fileExists, hashBuffer, sanitizePathPart } from "./utils.ts"

export { saveCatalog }

type CatalogFacets = {
  media: {
    all: number
    image: number
    video: number
  }
  status: {
    all: number
    downloaded: number
    missing: number
    error: number
    favorited: number
    duplicate: number
    unverified: number
  }
}

type CatalogBackupSummary = {
  file: string
  reason: string
  createdAt: string
  size: number
  itemCount: number | null
  catalogUpdatedAt: unknown
}

export async function downloadJob(job: GeneratePornJob): Promise<Partial<CatalogItem>> {
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

export function toCatalogItem(job: GeneratePornJob, existing: Partial<CatalogItem> = {}): CatalogItem {
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

export function isDownloadableJob(job: GeneratePornJob | null | undefined): boolean {
  return Boolean(job?.id && job.status === "done" && typeof job.output_url === "string" && /\.(png|mp4)(?:[?#].*)?$/i.test(job.output_url))
}

function normalizeDurationSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

export function isIncrementalBoundaryJob(job: GeneratePornJob | null | undefined): boolean {
  return Boolean(job?.id && ((job.status === "done" && typeof job.output_url === "string" && job.output_url) || isTerminalErrorJob(job)))
}

function isTerminalErrorJob(job: GeneratePornJob | null | undefined): boolean {
  const status = String(job?.status || "").toLowerCase()
  return Boolean(
    job?.id &&
    (["failed", "error", "cancelled", "canceled"].includes(status) ||
      (status !== "done" && typeof job?.error === "string" && job.error.trim())),
  )
}

export function buildFilename(job: GeneratePornJob): string {
  const normalizedJob = normalizeJob(job)
  const extension = getExtension(normalizedJob.output_url)
  const date = normalizedJob.created_at ? new Date(Number(normalizedJob.created_at) * 1000).toISOString().slice(0, 10) : "undated"
  const type = sanitizePathPart(normalizedJob.type || "media")
  const id = sanitizePathPart(normalizedJob.id)

  return `${date}/${date}_${type}_${id}.${extension}`
}

function getExtension(url: string): string {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1]?.toLowerCase() || "bin"
  } catch {
    const match = url.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)
    return match?.[1]?.toLowerCase() || "bin"
  }
}

export async function getItems(searchParams: URLSearchParams): Promise<Record<string, unknown>> {
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

export function buildFacets(items: CatalogItem[]): CatalogFacets {
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

export function toPublicCatalogItem(item: CatalogItem): CatalogItem & { posterUrl: string | null } {
  return {
    ...item,
    posterUrl: item.thumbnailFile ? mediaUrlForLocalFile(item.thumbnailFile) : null,
  }
}

export function mediaUrlForLocalFile(localFile: string): string {
  return `/media/${String(localFile).split("/").map(encodeURIComponent).join("/")}`
}

export function sortItemsForView(items: CatalogItem[], sort: string): CatalogItem[] {
  return items.toSorted((a, b) => {
    if (sort === "oldest") return Number(a.createdAt || 0) - Number(b.createdAt || 0)
    if (sort === "largest") return Number(b.size || 0) - Number(a.size || 0)
    if (sort === "smallest") return Number(a.size || 0) - Number(b.size || 0)
    if (sort === "type")
      return String(a.type || "").localeCompare(String(b.type || "")) || Number(b.createdAt || 0) - Number(a.createdAt || 0)
    return Number(b.createdAt || 0) - Number(a.createdAt || 0)
  })
}

export function isImageItem(item: CatalogItem): boolean {
  return Boolean(
    /\.(png|jpe?g|webp|bmp)$/i.test(item.localFile || "") || item.outputUrl?.toLowerCase().match(/\.(png|jpe?g|webp|bmp)(?:[?#].*)?$/),
  )
}

export function isVideoItem(item: CatalogItem): boolean {
  return Boolean(item.localFile?.toLowerCase().endsWith(".mp4") || item.outputUrl?.toLowerCase().match(/\.mp4(?:[?#].*)?$/))
}

export async function loadCatalog(): Promise<Catalog> {
  const catalog = readCatalogFromDb()
  const changed = await reconcileCatalogWithLocalFiles(catalog)

  if (changed) {
    catalog.updatedAt = new Date().toISOString()
    await saveCatalog(catalog)
  }

  return catalog
}

export async function reconcileCatalogWithLocalFiles(catalog: Catalog): Promise<boolean> {
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

export function applyDuplicateMetadata(items: CatalogItem[]): void {
  const groups = new Map<string, CatalogItem[]>()

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
    if (!canonical) {
      continue
    }

    for (const item of group) {
      item.duplicateGroupSize = group.length
      item.duplicateOf = item.id === canonical.id ? null : canonical.id
    }
  }
}

async function reconcileCatalogItemThumbnail(item: CatalogItem): Promise<boolean> {
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

export async function ensureCatalogThumbnail(localFile: string): Promise<ThumbnailPatch> {
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

export function applyCatalogThumbnail(item: CatalogItem, thumbnail: ThumbnailPatch): boolean {
  let changed = false

  for (const key of ["thumbnailFile", "thumbnailGeneratedAt", "thumbnailError"] as const) {
    if (Object.hasOwn(thumbnail, key) && item[key] !== thumbnail[key]) {
      item[key] = thumbnail[key]
      changed = true
    }
  }

  return changed
}

export async function getLocalMediaFilesByJobId(): Promise<
  Map<string, Pick<LocalMediaFile, "localFile" | "size" | "contentType" | "downloadedAt">>
> {
  const files = new Map<string, Pick<LocalMediaFile, "localFile" | "size" | "contentType" | "downloadedAt">>()
  const entries = await getLocalMediaFiles()

  for (const file of entries) {
    const filename = path.basename(file.absolutePath)
    const match = filename.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|mp4)$/i)

    if (!match) {
      continue
    }

    const jobId = match[1]
    if (!jobId) {
      continue
    }

    files.set(jobId, {
      localFile: file.localFile,
      size: file.size,
      contentType: file.contentType,
      downloadedAt: file.downloadedAt,
    })
  }

  return files
}

export async function getLocalMediaFiles(): Promise<LocalMediaFile[]> {
  const entries = await listMediaFiles(MEDIA_DIR)
  const files: LocalMediaFile[] = []

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

async function listMediaFiles(directory: string): Promise<string[]> {
  let entries: Dirent<string>[]

  try {
    entries = await readdir(directory, {
      withFileTypes: true,
    })
  } catch {
    return []
  }

  const files: string[] = []

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

export function enqueueDownload(downloadQueue: GeneratePornJob[], queuedJobIds: Set<string>, job: GeneratePornJob): void {
  if (!job?.id || queuedJobIds.has(job.id)) {
    return
  }

  downloadQueue.push(job)
  queuedJobIds.add(job.id)
}

export function isDownloadableCatalogItem(item: CatalogItem | null | undefined): boolean {
  return Boolean(
    item?.id && item.status === "done" && typeof item.outputUrl === "string" && /\.(png|mp4)(?:[?#].*)?$/i.test(item.outputUrl),
  )
}

export function jobFromCatalogItem(item: CatalogItem): GeneratePornJob {
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

export function normalizeJob(job: GeneratePornJob): NormalizedJob {
  return {
    ...job,
    output_url: job.output_url || job.outputUrl || "",
    created_at: job.created_at || job.createdAt,
    user_id: job.user_id || job.userId,
    negative_prompt: job.negative_prompt || job.negativePrompt,
    input_url: job.input_url || job.inputUrl,
    external_task_id: job.external_task_id || job.externalTaskId,
  }
}

export async function createCatalogBackup(
  reason = "manual",
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Promise<CatalogBackupSummary | null> {
  const catalog = await loadCatalog()

  if (!allowEmpty && !catalog.items.length && !catalog.updatedAt) {
    return null
  }

  await mkdir(BACKUP_DIR, { recursive: true })
  const timestamp = new Date().toISOString()
  const safeReason = sanitizePathPart(reason).toLowerCase()
  const filename = `${timestamp.replace(/[:.]/g, "-")}_${safeReason}.sqlite`
  const backupPath = path.join(BACKUP_DIR, filename)
  await backupSqliteDatabase(getCatalogDb(), backupPath)

  return backupSummaryFromSqliteFile(filename, backupPath, timestamp, safeReason)
}

export async function listCatalogBackups(): Promise<CatalogBackupSummary[]> {
  let entries: Dirent<string>[]

  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const backups: CatalogBackupSummary[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sqlite")) {
      continue
    }

    const filePath = path.join(BACKUP_DIR, entry.name)
    backups.push(await backupSummaryFromSqliteFile(entry.name, filePath))
  }

  return backups.toSorted((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
}

export async function restoreCatalogBackup(filename: string): Promise<CatalogBackupSummary> {
  const backupPath = resolveCatalogBackupPath(filename)

  if (!(await isValidCatalogDatabase(backupPath))) {
    throw new Error("Selected backup is not a valid catalog.")
  }

  await createCatalogBackup("before-restore", { allowEmpty: true })
  closeCatalogDb()
  await copyFile(backupPath, CATALOG_DB_PATH)
  getCatalogDb()

  return backupSummaryFromSqliteFile(path.basename(backupPath), backupPath)
}

export async function sendCatalogExport(response: HttpResponse): Promise<void> {
  const catalog = await loadCatalog()

  if (!catalog.items.length && !catalog.updatedAt) {
    return sendJson(response, { error: "No catalog exists yet." }, 404)
  }

  const filename = `catalog-export-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`
  const exportPath = path.join(BACKUP_DIR, `.${filename}.${process.pid}.tmp`)
  await mkdir(BACKUP_DIR, { recursive: true })
  await backupSqliteDatabase(getCatalogDb(), exportPath)

  response.writeHead(200, {
    "content-type": "application/vnd.sqlite3",
    "content-disposition": `attachment; filename="${filename}"`,
    "access-control-allow-origin": "*",
  })

  const stream = createReadStream(exportPath)
  stream.on("close", () => {
    rm(exportPath, { force: true }).catch(() => {})
  })
  stream.pipe(response)
}

function resolveCatalogBackupPath(filename: string): string {
  if (!filename || path.basename(filename) !== filename || !filename.endsWith(".sqlite")) {
    throw new Error("Invalid backup filename.")
  }

  const backupPath = path.resolve(BACKUP_DIR, filename)
  const backupRoot = path.resolve(BACKUP_DIR)

  if (!backupPath.startsWith(`${backupRoot}${path.sep}`)) {
    throw new Error("Invalid backup path.")
  }

  return backupPath
}

async function backupSummaryFromSqliteFile(
  filename: string,
  filePath: string,
  fallbackCreatedAt: string | null = null,
  fallbackReason: string | null = null,
): Promise<CatalogBackupSummary> {
  const fileStat = await stat(filePath)
  const match = filename.match(/^(.+?)_([a-z0-9_-]+)\.sqlite$/i)
  const createdAt = match?.[1]
    ? match[1].replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z")
    : fallbackCreatedAt
  const metadata = readCatalogDatabaseSummary(filePath)

  return {
    file: filename,
    reason: fallbackReason || match?.[2] || "unknown",
    createdAt: createdAt || fileStat.mtime.toISOString(),
    size: fileStat.size,
    itemCount: metadata.itemCount,
    catalogUpdatedAt: metadata.catalogUpdatedAt,
  }
}

function readCatalogDatabaseSummary(filePath: string): { itemCount: number | null; catalogUpdatedAt: unknown } {
  let db: DatabaseSync | null = null

  try {
    db = new DatabaseSync(filePath, { readOnly: true })
    const itemCountRow = db.prepare("SELECT COUNT(*) AS count FROM media_items").get()
    const updatedAtRow = db.prepare("SELECT value_json FROM catalog_meta WHERE key = 'updatedAt'").get()
    const itemCount = isRecord(itemCountRow) && typeof itemCountRow["count"] === "number" ? itemCountRow["count"] : 0
    const updatedAt = isRecord(updatedAtRow) && typeof updatedAtRow["value_json"] === "string" ? updatedAtRow["value_json"] : null

    return {
      itemCount: Number(itemCount || 0),
      catalogUpdatedAt: updatedAt ? parseJson(updatedAt, null) : null,
    }
  } catch {
    return {
      itemCount: null,
      catalogUpdatedAt: null,
    }
  } finally {
    db?.close()
  }
}

async function isValidCatalogDatabase(filePath: string): Promise<boolean> {
  let db: DatabaseSync | null = null

  try {
    db = new DatabaseSync(filePath, { readOnly: true })
    db.prepare("SELECT COUNT(*) AS count FROM media_items").get()
    db.prepare("SELECT COUNT(*) AS count FROM catalog_meta").get()
    return true
  } catch {
    return false
  } finally {
    db?.close()
  }
}

export function sortItems(items: CatalogItem[]): CatalogItem[] {
  return items.toSorted((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
}
