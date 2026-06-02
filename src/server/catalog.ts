import { createReadStream } from "node:fs"
import type { Dirent } from "node:fs"
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync, backup as backupSqliteDatabase } from "node:sqlite"

import { count, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"

import { ensureVideoThumbnail } from "../thumbnails.ts"
import type { BackupSummary, CatalogItemResponse, DeleteCatalogItemResponse, ItemsResponse, PublicCatalogItem } from "../types/routes.ts"
import { deleteRemoteJob, setRemoteJobFavorite } from "./api-client.ts"
import {
  closeCatalogDb,
  getCatalogDb,
  getCatalogDbRevision,
  listCreationJobSummaries,
  parseJson,
  readCatalogMeta,
  readCatalogFromDb,
  saveCatalog,
} from "./catalog-db.ts"
import { BACKUP_DIR, CATALOG_DB_PATH, MEDIA_DIR } from "./config.ts"
import { isActiveCreationStatus, isTerminalCreationStatus } from "./create-shared.ts"
import { catalogMeta, catalogSchema, mediaItems } from "./db-schema.ts"
import { httpError } from "./errors.ts"
import { pngBufferToHighQualityJpeg } from "./media-conversion.ts"
import { paramsFromUnknown } from "./refinements.ts"
import { sendJson } from "./static.ts"
import type {
  Catalog,
  CatalogItem,
  CreateParams,
  CreationJob,
  GeneratePornJob,
  HttpResponse,
  LocalMediaFile,
  NormalizedJob,
  ThumbnailPatch,
} from "./types.ts"
import { clamp, contentTypeFor, fileExists, hashBuffer, sanitizePathPart, yieldToEventLoop } from "./utils.ts"

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
    deleted: number
  }
}

type CatalogBackupSummary = BackupSummary
type CreateCatalogBackupOptions = {
  allowEmpty?: boolean
  protectedFiles?: string[]
}
type BackupRetentionCandidate = CatalogBackupSummary & {
  path: string
  createdAtMs: number
}
type PublicCatalogItemRow = {
  accountEmail: string | null
  assetId: string | null
  assetKind: string | null
  collectionId: string | null
  contentType: string | null
  createModeId: string | null
  createParamsJson: string | null
  createdAt: number | null
  createdAtIso: string | null
  createdAtValue: string | null
  createdLocallyAt: string | null
  downloadError: string | null
  downloadedAt: string | null
  duplicateGroupSize: number | null
  duplicateOf: string | null
  duration: number | null
  error: string | null
  externalTaskId: string | null
  favorited: number | null
  fileSize: number | null
  id: string
  inputUrl: string | null
  localFile: string | null
  modelId: string | null
  negativePrompt: string | null
  outputUrl: string | null
  prompt: string | null
  provider: string
  remoteDeletedAt: string | null
  remoteDeleteStatus: string | null
  sha256: string | null
  shared: number | null
  size: number | null
  sourceItemId: string | null
  sourceKind: string | null
  sourceUrl: string | null
  status: string | null
  templateId: string | null
  templateLabel: string | null
  thumbnailError: string | null
  thumbnailFile: string | null
  thumbnailGeneratedAt: string | null
  timeToGenerateMs: number | null
  type: string | null
  updatedAt: string | null
  userId: string | null
  verifiedAt: string | null
}

const ACTIVE_MEDIA_STATUSES = new Set(["pending", "queued", "submitted", "processing", "running", "in_progress"])
const FAILED_MEDIA_STATUSES = new Set(["failed", "error", "cancelled", "canceled"])
const RENDERING_MEDIA_MAX_AGE_MS = 60 * 60 * 1000
const FAILED_MEDIA_VISIBLE_MS = 5 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
let readOnlyCatalogCache: { catalog: Catalog; revision: number } | null = null

export async function downloadJob(job: GeneratePornJob): Promise<Partial<CatalogItem>> {
  const normalizedJob = normalizeJob(job)
  const response = await fetch(normalizedJob.output_url, {
    headers: {
      accept: "*/*",
      referer: "https://app.generateporn.ai/",
    },
  })

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText}`)
  }

  const downloadedBytes = Buffer.from(await response.arrayBuffer())
  const media = await prepareDownloadedMedia(normalizedJob.output_url, downloadedBytes)
  const filename = buildFilename(normalizedJob, media.extension)
  const localPath = path.join(MEDIA_DIR, filename)
  await mkdir(path.dirname(localPath), { recursive: true })

  const tempPath = `${localPath}.tmp`
  await writeFile(tempPath, media.bytes)
  await rename(tempPath, localPath)
  const thumbnail = await ensureCatalogThumbnail(filename)

  return {
    localFile: filename,
    size: media.bytes.byteLength,
    fileSize: media.bytes.byteLength,
    sha256: hashBuffer(media.bytes),
    verifiedAt: new Date().toISOString(),
    contentType: media.contentType || response.headers.get("content-type") || null,
    ...thumbnail,
    downloadedAt: new Date().toISOString(),
  }
}

export function toCatalogItem(job: GeneratePornJob, existing: Partial<CatalogItem> = {}): CatalogItem {
  const lastPolledAt =
    job.last_polled_at ||
    job.lastPolledAt ||
    (existing.lastPolledAt as string | number | null | undefined) ||
    (existing.last_polled_at as string | number | null | undefined) ||
    null

  return {
    ...existing,
    id: job.id,
    accountEmail: job.accountEmail ?? existing.accountEmail ?? null,
    userId: job.user_id,
    type: job.type,
    prompt: job.prompt || "",
    negativePrompt: job.negative_prompt || "",
    status: job.status,
    outputUrl: job.output_url || null,
    inputUrl: job.input_url || null,
    lastPolledAt,
    modelId: job.modelId || job.model_id || null,
    duration: normalizeDurationSeconds(job.duration ?? existing.duration),
    createdAt: job.created_at || null,
    createdAtIso: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : null,
    timeToGenerateMs: calculateTimeToGenerateMs(job.created_at, lastPolledAt),
    externalTaskId: job.external_task_id || null,
    shared: Boolean(job.shared),
    favorited: Boolean(job.favorited),
    error: job.error || null,
    remoteDeletedAt: null,
    remoteDeleteStatus: null,
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

function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }

  return numeric > 1e11 ? numeric : numeric * 1000
}

function calculateTimeToGenerateMs(createdAt: unknown, lastPolledAt: unknown, lastPolledAtAlias?: unknown): number | null {
  const createdAtMs = toEpochMs(createdAt)
  const lastPolledAtMs = toEpochMs(lastPolledAt) ?? toEpochMs(lastPolledAtAlias)

  if (!createdAtMs || !lastPolledAtMs) {
    return null
  }

  const deltaMs = lastPolledAtMs - createdAtMs
  return deltaMs >= 0 ? Math.round(deltaMs) : null
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

export function buildFilename(job: GeneratePornJob, extensionOverride?: string): string {
  const normalizedJob = normalizeJob(job)
  const extension = extensionOverride || getStorageExtension(normalizedJob.output_url)
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

function getStorageExtension(url: string): string {
  const extension = getExtension(url)
  return extension === "png" ? "jpg" : extension
}

async function prepareDownloadedMedia(
  outputUrl: string,
  bytes: Buffer,
): Promise<{ bytes: Buffer; extension: string; contentType: string | null }> {
  const extension = getExtension(outputUrl)

  if (extension !== "png") {
    return {
      bytes,
      extension,
      contentType: null,
    }
  }

  return {
    bytes: await pngBufferToHighQualityJpeg(bytes),
    extension: "jpg",
    contentType: "image/jpeg",
  }
}

export async function getItems(searchParams: URLSearchParams): Promise<ItemsResponse> {
  const query = (searchParams.get("q") || "").trim().toLowerCase()
  const media = searchParams.get("media") || "all"
  const provider = searchParams.get("provider") || "all"
  const status = searchParams.get("status") || "all"
  const sort = searchParams.get("sort") || "newest"
  const page = Math.max(1, Number(searchParams.get("page") || 1))
  const pageSize = clamp(Number(searchParams.get("pageSize") || 60), 12, 240)
  const activeItems = getActiveCreationCatalogItems(provider).filter((item) => matchesItemFilters(item, { media, query, status }))
  const baseWhere = catalogBaseWhere(provider)
  const visibleWhere = `(${baseWhere.sql}) AND NOT (${deletedSql()})`
  const facetRows = readCatalogFacets(visibleWhere, baseWhere.params)
  const deletedCount = readCatalogCount(`(${baseWhere.sql}) AND (${deletedSql()})`, baseWhere.params)
  const activeVisibleItems = activeItems.filter((item) => !isDeletedFilterItem(item))
  const activeDeletedItems = activeItems.filter(isDeletedFilterItem)
  const facets = mergeFacets(facetRows, buildFacets(activeVisibleItems, activeDeletedItems.length + deletedCount))
  const itemWhere = catalogItemsWhere({ baseWhere, media, query, status })
  const tableTotal = readCatalogCount(itemWhere.sql, itemWhere.params)
  const total = tableTotal + activeItems.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * pageSize
  const pageItems = sortItemsForView([...activeItems, ...readCatalogItemPage(itemWhere, sort, start + pageSize)], sort).slice(
    start,
    start + pageSize,
  )

  return {
    items: pageItems.map(toPublicCatalogItem),
    total,
    page: currentPage,
    pageSize,
    pageCount,
    facets: {
      ...facets,
      orphanFiles: provider === "all" || provider === "generateporn" ? readOrphanFileCount() : 0,
    },
    catalogUpdatedAt: stringMeta("updatedAt"),
    lastSeenJobId: stringMeta("lastSeenJobId"),
    lastRun: recordMeta("lastRun"),
  }
}

type CatalogWhere = {
  params: Array<string | number>
  sql: string
}

type CatalogItemFilters = {
  media: string
  query: string
  status: string
}

type CatalogFacetRow = {
  allCount: number
  imageCount: number
  videoCount: number
  downloadedCount: number
  missingCount: number
  errorCount: number
  favoritedCount: number
  duplicateCount: number
  unverifiedCount: number
}

function catalogBaseWhere(provider: string): CatalogWhere {
  const clauses = [`NOT (${staleRenderingSql()})`]
  const params: Array<string | number> = []

  if (provider === "playbox") {
    clauses.push("provider = ?")
    params.push("playbox")
  } else if (provider === "generateporn") {
    clauses.push("provider != ?")
    params.push("playbox")
  }

  return {
    params,
    sql: clauses.join(" AND "),
  }
}

function catalogItemsWhere({
  baseWhere,
  media,
  query,
  status,
}: CatalogItemFilters & {
  baseWhere: CatalogWhere
}): CatalogWhere {
  const clauses = [`(${baseWhere.sql})`]
  const params = [...baseWhere.params]

  if (status === "deleted") {
    clauses.push(`(${deletedSql()})`)
  } else {
    clauses.push(`NOT (${deletedSql()})`)
  }

  if (media === "image") clauses.push("is_image = 1")
  if (media === "video") clauses.push("is_video = 1")

  if (status === "downloaded") clauses.push("has_local_file = 1")
  if (status === "missing") clauses.push(`(${missingSql()})`)
  if (status === "error") clauses.push("has_download_error = 1")
  if (status === "favorited") clauses.push("is_favorited = 1")
  if (status === "duplicate") clauses.push("is_duplicate = 1")
  if (status === "unverified") clauses.push("is_unverified = 1")

  if (query) {
    clauses.push("search_text LIKE ? ESCAPE '\\'")
    params.push(`%${escapeSqliteLike(query)}%`)
  }

  return {
    params,
    sql: clauses.join(" AND "),
  }
}

function readCatalogFacets(sql: string, params: Array<string | number>): CatalogFacets {
  const row = getCatalogDb()
    .prepare(
      `
        SELECT
          COUNT(*) AS allCount,
          COALESCE(SUM(is_image), 0) AS imageCount,
          COALESCE(SUM(is_video), 0) AS videoCount,
          COALESCE(SUM(has_local_file), 0) AS downloadedCount,
          COALESCE(SUM(CASE WHEN ${missingSql()} THEN 1 ELSE 0 END), 0) AS missingCount,
          COALESCE(SUM(has_download_error), 0) AS errorCount,
          COALESCE(SUM(is_favorited), 0) AS favoritedCount,
          COALESCE(SUM(is_duplicate), 0) AS duplicateCount,
          COALESCE(SUM(is_unverified), 0) AS unverifiedCount
        FROM media_items
        WHERE ${sql}
      `,
    )
    .get(...params) as CatalogFacetRow

  return {
    media: {
      all: Number(row.allCount || 0),
      image: Number(row.imageCount || 0),
      video: Number(row.videoCount || 0),
    },
    status: {
      all: Number(row.allCount || 0),
      downloaded: Number(row.downloadedCount || 0),
      missing: Number(row.missingCount || 0),
      error: Number(row.errorCount || 0),
      favorited: Number(row.favoritedCount || 0),
      duplicate: Number(row.duplicateCount || 0),
      unverified: Number(row.unverifiedCount || 0),
      deleted: 0,
    },
  }
}

function readCatalogCount(sql: string, params: Array<string | number>): number {
  const row = getCatalogDb()
    .prepare(`SELECT COUNT(*) AS count FROM media_items WHERE ${sql}`)
    .get(...params) as { count: number }
  return Number(row.count || 0)
}

function readCatalogItemPage(where: CatalogWhere, sort: string, limit: number): CatalogItem[] {
  if (limit <= 0) return []

  const rows = getCatalogDb()
    .prepare(`SELECT ${publicCatalogItemSelectSql()} FROM media_items WHERE ${where.sql} ORDER BY ${catalogOrderBy(sort)} LIMIT ?`)
    .all(...where.params, limit) as PublicCatalogItemRow[]

  return rows.map(catalogItemFromPublicRow)
}

function readCatalogItemById(id: string): CatalogItem | null {
  const row = getCatalogDb().prepare(`SELECT ${publicCatalogItemSelectSql()} FROM media_items WHERE id = ?`).get(id) as
    | PublicCatalogItemRow
    | undefined

  return row ? catalogItemFromPublicRow(row) : null
}

function publicCatalogItemSelectSql(): string {
  return `
    id,
    account_email AS accountEmail,
    provider,
    collection_id AS collectionId,
    asset_id AS assetId,
    asset_kind AS assetKind,
    user_id AS userId,
    type,
    status,
    prompt,
    negative_prompt AS negativePrompt,
    output_url AS outputUrl,
    input_url AS inputUrl,
    duration,
    time_to_generate_ms AS timeToGenerateMs,
    created_at AS createdAt,
    created_at_value AS createdAtValue,
    created_at_iso AS createdAtIso,
    external_task_id AS externalTaskId,
    model_id AS modelId,
    shared,
    favorited,
    error,
    updated_at AS updatedAt,
    local_file AS localFile,
    size,
    file_size AS fileSize,
    sha256,
    verified_at AS verifiedAt,
    content_type AS contentType,
    downloaded_at AS downloadedAt,
    download_error AS downloadError,
    thumbnail_file AS thumbnailFile,
    thumbnail_generated_at AS thumbnailGeneratedAt,
    thumbnail_error AS thumbnailError,
    duplicate_of AS duplicateOf,
    duplicate_group_size AS duplicateGroupSize,
    create_mode_id AS createModeId,
    create_params_json AS createParamsJson,
    template_id AS templateId,
    template_label AS templateLabel,
    source_kind AS sourceKind,
    source_item_id AS sourceItemId,
    source_url AS sourceUrl,
    created_locally_at AS createdLocallyAt,
    remote_deleted_at AS remoteDeletedAt,
    remote_delete_status AS remoteDeleteStatus
  `
}

function catalogItemFromPublicRow(row: PublicCatalogItemRow): CatalogItem {
  const createParams = row.createParamsJson ? paramsFromUnknown(parseJson(row.createParamsJson, null)) : null

  return {
    id: row.id,
    accountEmail: row.accountEmail,
    provider: row.provider,
    collectionId: row.collectionId,
    assetId: row.assetId,
    assetKind: row.assetKind,
    userId: row.userId,
    type: row.type,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    status: row.status,
    outputUrl: row.outputUrl,
    inputUrl: row.inputUrl,
    duration: row.duration,
    createdAt: row.createdAt,
    createdAtIso: row.createdAtIso,
    externalTaskId: row.externalTaskId,
    modelId: row.modelId,
    model_id: row.modelId,
    shared: row.shared === null ? null : Boolean(row.shared),
    favorited: row.favorited === null ? null : Boolean(row.favorited),
    error: row.error,
    updatedAt: row.updatedAt,
    localFile: row.localFile,
    size: row.size,
    fileSize: row.fileSize,
    sha256: row.sha256,
    verifiedAt: row.verifiedAt,
    contentType: row.contentType,
    downloadedAt: row.downloadedAt,
    downloadError: row.downloadError,
    timeToGenerateMs: row.timeToGenerateMs,
    thumbnailFile: row.thumbnailFile,
    thumbnailGeneratedAt: row.thumbnailGeneratedAt,
    thumbnailError: row.thumbnailError,
    duplicateOf: row.duplicateOf,
    duplicateGroupSize: row.duplicateGroupSize,
    createModeId: row.createModeId,
    createParams,
    templateId: row.templateId,
    templateLabel: row.templateLabel,
    sourceKind: row.sourceKind,
    sourceItemId: row.sourceItemId,
    sourceUrl: row.sourceUrl,
    createdLocallyAt: row.createdLocallyAt,
    remoteDeletedAt: row.remoteDeletedAt,
    remoteDeleteStatus: row.remoteDeleteStatus,
  }
}

function catalogOrderBy(sort: string): string {
  if (sort === "oldest") return "created_at ASC, id ASC"
  if (sort === "largest") return "size DESC NULLS LAST, created_at DESC, id ASC"
  if (sort === "smallest") return "size ASC NULLS LAST, created_at DESC, id ASC"
  if (sort === "type") return "media_kind ASC, created_at DESC, id ASC"
  return "created_at DESC, id ASC"
}

function getActiveCreationCatalogItems(provider: string): CatalogItem[] {
  if (provider === "playbox") return []

  const projected = listCreationJobSummaries({ status: "catalog-projection", limit: 500 })
    .map(catalogItemFromActiveCreation)
    .filter((item): item is CatalogItem => Boolean(item))
    .filter((item) => !isStaleRenderingMediaItem(item) && matchesProviderFilter(item, provider))
  const existingIds = readExistingCatalogItemIds(projected.map((item) => item.id))

  return projected.filter((item) => !existingIds.has(item.id))
}

function readExistingCatalogItemIds(ids: string[]): Set<string> {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (!uniqueIds.length) return new Set()

  const placeholders = uniqueIds.map(() => "?").join(",")
  const rows = getCatalogDb()
    .prepare(`SELECT id FROM media_items WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as { id: string }[]
  return new Set(rows.map((row) => row.id))
}

function matchesItemFilters(item: CatalogItem, { media, query, status }: CatalogItemFilters): boolean {
  if (media === "image" && !isImageItem(item)) return false
  if (media === "video" && !isVideoItem(item)) return false

  if (status === "downloaded" && !item.localFile) return false
  if (status === "missing" && !isMissingMediaItem(item)) return false
  if (status === "error" && !item.downloadError) return false
  if (status === "favorited" && !item.favorited) return false
  if (status === "duplicate" && Number(item.duplicateGroupSize || 0) <= 1) return false
  if (status === "unverified" && (!item.localFile || item.sha256)) return false
  if (status === "deleted" && !isDeletedFilterItem(item)) return false
  if (status !== "deleted" && isDeletedFilterItem(item)) return false

  if (!query) return true
  return [
    item.id,
    item.type,
    item.provider,
    item.collectionId,
    item.assetId,
    item.assetKind,
    item.prompt,
    item.negativePrompt,
    item.localFile,
  ].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(query),
  )
}

function mergeFacets(left: CatalogFacets, right: CatalogFacets): CatalogFacets {
  return {
    media: {
      all: left.media.all + right.media.all,
      image: left.media.image + right.media.image,
      video: left.media.video + right.media.video,
    },
    status: {
      all: left.status.all + right.status.all,
      downloaded: left.status.downloaded + right.status.downloaded,
      missing: left.status.missing + right.status.missing,
      error: left.status.error + right.status.error,
      favorited: left.status.favorited + right.status.favorited,
      duplicate: left.status.duplicate + right.status.duplicate,
      unverified: left.status.unverified + right.status.unverified,
      deleted: left.status.deleted + right.status.deleted,
    },
  }
}

function readOrphanFileCount(): number {
  const row = getCatalogDb().prepare("SELECT COUNT(*) AS count FROM orphan_files").get() as { count: number }
  return Number(row.count || 0)
}

function stringMeta(key: string): string | null {
  const value = readCatalogMeta(key)
  return typeof value === "string" ? value : null
}

function recordMeta(key: string): Record<string, unknown> | null {
  const value = readCatalogMeta(key)
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function staleRenderingSql(now = Date.now()): string {
  return `status IN (${sqlStringList(ACTIVE_MEDIA_STATUSES)}) AND has_local_file = 0 AND has_output_url = 0 AND (render_started_at IS NULL OR render_started_at < ${now - RENDERING_MEDIA_MAX_AGE_MS})`
}

function deletedSql(now = Date.now()): string {
  return `remote_deleted_at IS NOT NULL OR (status IN (${sqlStringList(FAILED_MEDIA_STATUSES)}) AND has_local_file = 0 AND has_output_url = 0 AND (failure_observed_at IS NULL OR failure_observed_at < ${now - FAILED_MEDIA_VISIBLE_MS}))`
}

function missingSql(now = Date.now()): string {
  return `has_local_file = 0 AND has_download_error = 0 AND NOT (status IN (${sqlStringList(ACTIVE_MEDIA_STATUSES)}) AND has_local_file = 0 AND has_output_url = 0 AND render_started_at IS NOT NULL AND render_started_at >= ${now - RENDERING_MEDIA_MAX_AGE_MS}) AND NOT (status IN (${sqlStringList(FAILED_MEDIA_STATUSES)}) AND has_local_file = 0 AND has_output_url = 0)`
}

function sqlStringList(values: Iterable<string>): string {
  return [...values].map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")
}

function escapeSqliteLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function matchesProviderFilter(item: CatalogItem, provider: string): boolean {
  if (provider === "playbox") {
    return item.provider === "playbox"
  }

  if (provider === "generateporn") {
    return item.provider !== "playbox"
  }

  return true
}

export async function getCatalogItem(id: string): Promise<CatalogItemResponse> {
  if (!id) {
    throw httpError("Item id is required.", 400)
  }

  const item = readCatalogItemById(id)
  if (!item) {
    throw httpError("Catalog item was not found.", 404)
  }

  return {
    item: toPublicCatalogItem(item),
  }
}

export function buildFacets(items: CatalogItem[], deletedCount = 0): CatalogFacets {
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
    deleted: deletedCount,
  }

  for (const item of items) {
    if (isImageItem(item)) media.image += 1
    if (isVideoItem(item)) media.video += 1
    if (item.localFile) status.downloaded += 1
    if (isMissingMediaItem(item)) status.missing += 1
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

function catalogItemFromActiveCreation(creation: CreationJob): CatalogItem | null {
  if (!creation.id || creation.status === "draft" || !isVisibleCreationCatalogProjection(creation)) {
    return null
  }

  const id = creation.jobId || creation.id
  return {
    id,
    accountEmail: creation.accountEmail,
    type: creation.mediaType || mediaTypeFromCreateMode(creation.modeId),
    status: creation.status,
    prompt: typeof creation.params["prompt"] === "string" ? creation.params["prompt"] : "",
    negativePrompt: typeof creation.params["negativePrompt"] === "string" ? creation.params["negativePrompt"] : "",
    outputUrl: creation.outputUrl,
    inputUrl: creation.inputUrl,
    createdAt: toEpochMs(creation.createdAt) ?? toEpochMs(creation.createdLocallyAt) ?? creation.createdAt,
    createdAtIso: creation.createdAtIso || creation.createdLocallyAt,
    externalTaskId: creation.externalTaskId,
    modelId: typeof creation.params["modelId"] === "string" ? creation.params["modelId"] : null,
    duration: durationFromCreateParams(creation.params),
    error: creation.error,
    updatedAt: creation.updatedAt,
    createModeId: creation.modeId,
    createParams: creation.params,
    templateId: creation.templateId,
    templateLabel: creation.templateLabel,
    sourceKind: sourceString(creation.source, "kind"),
    sourceItemId: sourceString(creation.source, "itemId"),
    sourceUrl: sourceString(creation.source, "url"),
    createdLocallyAt: creation.createdLocallyAt,
  }
}

function isVisibleCreationCatalogProjection(creation: CreationJob): boolean {
  if (isActiveCreationStatus(creation.status)) return true
  if (creation.downloadedItemId) return false
  return isTerminalCreationStatus(creation.status)
}

function mediaTypeFromCreateMode(modeId: string | null): string {
  return modeId === "custom-image" ? "image" : "video"
}

function durationFromCreateParams(params: CreateParams): number | null {
  const quality = typeof params["quality"] === "string" ? params["quality"] : ""
  const match = /-(\d+)$/.exec(quality)
  return match ? Number(match[1]) : null
}

function sourceString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === "string" && value ? value : null
}

export function toPublicCatalogItem(item: CatalogItem): PublicCatalogItem {
  return compactPublicCatalogItem({
    id: item.id,
    accountEmail: item.accountEmail ?? null,
    provider: item.provider ?? null,
    collectionId: item.collectionId ?? null,
    assetId: item.assetId ?? null,
    assetKind: item.assetKind ?? null,
    userId: item.userId ?? null,
    type: item.type ?? null,
    prompt: item.prompt ?? null,
    negativePrompt: item.negativePrompt ?? null,
    status: item.status ?? null,
    outputUrl: item.provider === "playbox" ? null : (item.outputUrl ?? null),
    inputUrl: item.provider === "playbox" ? null : (item.inputUrl ?? null),
    duration: item.duration ?? null,
    createdAt: item.createdAt ?? null,
    createdAtIso: item.createdAtIso ?? null,
    externalTaskId: item.externalTaskId ?? null,
    modelId: item.modelId ?? item.model_id ?? null,
    model_id: item.modelId ?? item.model_id ?? null,
    shared: item.shared ?? null,
    favorited: item.favorited ?? null,
    error: item.error ?? null,
    updatedAt: item.updatedAt ?? null,
    localFile: item.localFile ?? null,
    size: item.size ?? null,
    fileSize: item.fileSize ?? null,
    sha256: item.sha256 ?? null,
    verifiedAt: item.verifiedAt ?? null,
    contentType: item.contentType ?? null,
    downloadedAt: item.downloadedAt ?? null,
    downloadError: item.downloadError ?? null,
    timeToGenerateMs: item.timeToGenerateMs ?? calculateTimeToGenerateMs(item.createdAt, item.lastPolledAt ?? item.last_polled_at),
    thumbnailFile: item.thumbnailFile ?? null,
    thumbnailGeneratedAt: item.thumbnailGeneratedAt ?? null,
    thumbnailError: item.thumbnailError ?? null,
    duplicateOf: item.duplicateOf ?? null,
    duplicateGroupSize: item.duplicateGroupSize ?? null,
    createModeId: item.createModeId ?? null,
    createParams: item.createParams ?? null,
    templateId: item.templateId ?? null,
    templateLabel: item.templateLabel ?? null,
    sourceKind: item.sourceKind ?? null,
    sourceItemId: item.sourceItemId ?? null,
    sourceUrl: item.provider === "playbox" ? null : (item.sourceUrl ?? null),
    createdLocallyAt: item.createdLocallyAt ?? null,
    remoteDeletedAt: typeof item.remoteDeletedAt === "string" ? item.remoteDeletedAt : null,
    remoteDeleteStatus: typeof item.remoteDeleteStatus === "string" ? item.remoteDeleteStatus : null,
    posterUrl: item.thumbnailFile ? mediaUrlForLocalFile(item.thumbnailFile) : null,
  })
}

function compactPublicCatalogItem(item: PublicCatalogItem): PublicCatalogItem {
  const compact: Record<string, unknown> = {
    id: item.id,
    posterUrl: item.posterUrl,
  }
  if (item.provider === "playbox") {
    compact["outputUrl"] = null
    compact["inputUrl"] = null
    compact["sourceUrl"] = null
  }

  for (const [key, value] of Object.entries(item)) {
    if (key === "id" || key === "posterUrl" || value === null || value === undefined) continue
    compact[key] = value
  }

  return compact as PublicCatalogItem
}

export async function deleteCatalogItemRemote(
  id: string,
  { keepLocalFiles = true }: { keepLocalFiles?: boolean } = {},
): Promise<DeleteCatalogItemResponse> {
  if (!id) {
    throw httpError("Item id is required.", 400)
  }

  const catalog = await loadCatalog()
  const item = catalog.items.find((entry) => entry.id === id)

  if (!item) {
    throw httpError("Catalog item was not found.", 404)
  }

  const remoteStatus =
    typeof item.remoteDeletedAt === "string"
      ? "previously-deleted"
      : (await deleteRemoteJob(id, { accountEmail: item.accountEmail })).status
  const now = new Date().toISOString()
  let deletedLocalFiles: string[] = []
  let responseItem: PublicCatalogItem | null = null

  if (keepLocalFiles) {
    item.remoteDeletedAt = typeof item.remoteDeletedAt === "string" ? item.remoteDeletedAt : now
    item.remoteDeleteStatus = remoteStatus
    item.updatedAt = now
    responseItem = toPublicCatalogItem(item)
  } else {
    deletedLocalFiles = await deleteLocalCatalogFiles(item)
    catalog.items = catalog.items.filter((entry) => entry.id !== id)
    catalog.downloadedJobIds = (catalog.downloadedJobIds || []).filter((entry) => entry !== id)
    catalog.orphanFiles = (catalog.orphanFiles || []).filter(
      (file) => file.localFile !== item.localFile && file.localFile !== item.thumbnailFile,
    )
  }

  catalog.updatedAt = now
  await saveCatalog(catalog)

  return {
    ok: true,
    id,
    item: responseItem,
    keepLocalFiles,
    deletedLocalFiles,
    remoteStatus,
  }
}

export async function setCatalogItemFavoriteRemote(
  id: string,
  favorited: boolean,
): Promise<{
  ok: true
  id: string
  item: PublicCatalogItem
  favorited: boolean
}> {
  if (!id) {
    throw httpError("Item id is required.", 400)
  }

  const catalog = await loadCatalog()
  const item = catalog.items.find((entry) => entry.id === id)

  if (!item) {
    throw httpError("Catalog item was not found.", 404)
  }

  await setRemoteJobFavorite(id, favorited, { accountEmail: item.accountEmail })
  item.favorited = favorited
  item.updatedAt = new Date().toISOString()
  catalog.updatedAt = item.updatedAt
  await saveCatalog(catalog)

  return {
    ok: true,
    id,
    item: toPublicCatalogItem(item),
    favorited,
  }
}

export function mediaUrlForLocalFile(localFile: string): string {
  return `/media/${String(localFile).split("/").map(encodeURIComponent).join("/")}`
}

async function deleteLocalCatalogFiles(item: CatalogItem): Promise<string[]> {
  const deleted: string[] = []
  const files = [item.localFile, item.thumbnailFile].filter((value): value is string => Boolean(value))

  for (const localFile of files) {
    const filePath = resolveMediaFilePath(localFile)
    await rm(filePath, { force: true })
    deleted.push(localFile)
  }

  return deleted
}

function resolveMediaFilePath(localFile: string): string {
  const filePath = path.resolve(MEDIA_DIR, localFile)
  const mediaRoot = path.resolve(MEDIA_DIR)

  if (filePath !== mediaRoot && filePath.startsWith(`${mediaRoot}${path.sep}`)) {
    return filePath
  }

  throw httpError("Local file path escapes the media directory.", 400)
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
  return Boolean(
    item.type === "video" || item.localFile?.toLowerCase().endsWith(".mp4") || item.outputUrl?.toLowerCase().match(/\.mp4(?:[?#].*)?$/),
  )
}

export function isPendingMediaItem(item: CatalogItem): boolean {
  return isActiveNoMediaItem(item) && isRecentRenderingMediaItem(item)
}

export function isStaleRenderingMediaItem(item: CatalogItem, now = Date.now()): boolean {
  if (!isActiveNoMediaItem(item)) return false

  const startedAt = mediaItemRenderStartedAtMs(item)
  return startedAt === null || now - startedAt >= RENDERING_MEDIA_MAX_AGE_MS
}

function isActiveNoMediaItem(item: CatalogItem): boolean {
  return ACTIVE_MEDIA_STATUSES.has(String(item.status || "").toLowerCase()) && !item.localFile && !item.outputUrl
}

function isRecentRenderingMediaItem(item: CatalogItem, now = Date.now()): boolean {
  const startedAt = mediaItemRenderStartedAtMs(item)
  return startedAt !== null && now - startedAt < RENDERING_MEDIA_MAX_AGE_MS
}

function mediaItemRenderStartedAtMs(item: CatalogItem): number | null {
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

function isMissingMediaItem(item: CatalogItem): boolean {
  return !item.localFile && !item.downloadError && !isPendingMediaItem(item) && !isFailedMediaGenerationItem(item)
}

function isDeletedCatalogItem(item: CatalogItem): boolean {
  return typeof item.remoteDeletedAt === "string" && item.remoteDeletedAt.length > 0
}

function isDeletedFilterItem(item: CatalogItem): boolean {
  return isDeletedCatalogItem(item) || isExpiredFailedMediaGenerationItem(item)
}

function isFailedMediaGenerationItem(item: CatalogItem): boolean {
  return (
    FAILED_MEDIA_STATUSES.has(
      String(item.status || "")
        .trim()
        .toLowerCase(),
    ) &&
    !item.localFile &&
    !item.outputUrl
  )
}

function isExpiredFailedMediaGenerationItem(item: CatalogItem, now = Date.now()): boolean {
  if (!isFailedMediaGenerationItem(item)) return false

  const failedAt = mediaItemFailureObservedAtMs(item)
  return failedAt === null || now - failedAt >= FAILED_MEDIA_VISIBLE_MS
}

function mediaItemFailureObservedAtMs(item: CatalogItem): number | null {
  for (const value of [item.updatedAt, item.lastPolledAt, item.last_polled_at, item.createdLocallyAt, item.createdAtIso, item.createdAt]) {
    const timestamp = timestampMs(value)
    if (timestamp !== null) return timestamp
  }

  return null
}

export async function loadCatalog({ reconcileLocalFiles = true }: { reconcileLocalFiles?: boolean } = {}): Promise<Catalog> {
  if (!reconcileLocalFiles) {
    const revision = getCatalogDbRevision()
    if (readOnlyCatalogCache?.revision === revision) {
      return readOnlyCatalogCache.catalog
    }

    const catalog = readCatalogFromDb()
    readOnlyCatalogCache = { catalog, revision }
    return catalog
  }

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

  for (const [index, item] of catalog.items.entries()) {
    if (index > 0 && index % 100 === 0) {
      await yieldToEventLoop()
    }

    if (item.provider === "playbox") {
      if (await reconcilePlayboxCatalogItem(item)) {
        changed = true
      }
      if (item.localFile) {
        downloadedJobIds.add(item.id)
      }
      continue
    }

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

async function reconcilePlayboxCatalogItem(item: CatalogItem): Promise<boolean> {
  if (!item.localFile) {
    return false
  }

  const absolutePath = path.join(MEDIA_DIR, item.localFile)
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(absolutePath)
  } catch {
    item.localFile = null
    item.size = null
    item.fileSize = null
    item.sha256 = null
    item.verifiedAt = null
    item.contentType = null
    item.thumbnailFile = null
    item.thumbnailGeneratedAt = null
    item.thumbnailError = null
    return true
  }

  let changed = false
  const contentType = contentTypeFor(absolutePath)
  if (item.size !== fileStat.size || item.fileSize !== fileStat.size || item.contentType !== contentType) {
    item.size = fileStat.size
    item.fileSize = fileStat.size
    item.contentType = contentType
    changed = true
  }

  if (await reconcileCatalogItemThumbnail(item)) {
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
    const match = filename.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpe?g|mp4)$/i)

    if (!match) {
      continue
    }

    const jobId = match[1]
    if (!jobId) {
      continue
    }

    const current = files.get(jobId)
    if (current && !isPreferredLocalMediaFile(file, current)) {
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

  for (const [index, filePath] of entries.entries()) {
    if (index > 0 && index % 100 === 0) {
      await yieldToEventLoop()
    }

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

function isPreferredLocalMediaFile(
  next: Pick<LocalMediaFile, "localFile" | "contentType">,
  current: Pick<LocalMediaFile, "localFile" | "contentType">,
): boolean {
  if (current.contentType === "image/png" && next.contentType === "image/jpeg") {
    return true
  }

  if (current.contentType === "image/jpeg" && next.contentType === "image/png") {
    return false
  }

  return next.localFile.localeCompare(current.localFile) < 0
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

  for (const [index, entry] of entries.entries()) {
    if (index > 0 && index % 100 === 0) {
      await yieldToEventLoop()
    }

    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (isInternalMediaDirectory(entry.name)) {
        continue
      }

      files.push(...(await listMediaFiles(entryPath)))
      continue
    }

    if (entry.isFile() && /\.(png|jpe?g|mp4)$/i.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

function isInternalMediaDirectory(name: string): boolean {
  return (
    name === "_thumbnails" || name === "_catalog_backups" || name === "_auth_browser_profile" || name === "_playbox_auth_browser_profile"
  )
}

export function enqueueDownload(downloadQueue: GeneratePornJob[], queuedJobIds: Set<string>, job: GeneratePornJob): void {
  if (!job?.id || queuedJobIds.has(job.id)) {
    return
  }

  downloadQueue.push(job)
  queuedJobIds.add(job.id)
}

export function isDownloadableCatalogItem(item: CatalogItem | null | undefined): boolean {
  if (item?.provider === "playbox") {
    return false
  }

  return Boolean(
    item?.id && item.status === "done" && typeof item.outputUrl === "string" && /\.(png|mp4)(?:[?#].*)?$/i.test(item.outputUrl),
  )
}

export function jobFromCatalogItem(item: CatalogItem): GeneratePornJob {
  return {
    id: item.id,
    ...(item.accountEmail ? { accountEmail: item.accountEmail } : {}),
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
    output_url: job.output_url || "",
    created_at: job.created_at,
    user_id: job.user_id,
    negative_prompt: job.negative_prompt,
    input_url: job.input_url,
    external_task_id: job.external_task_id,
  }
}

export async function createCatalogBackup(
  reason = "manual",
  { allowEmpty = false, protectedFiles = [] }: CreateCatalogBackupOptions = {},
): Promise<CatalogBackupSummary | null> {
  const catalog = await loadCatalog()

  if (!allowEmpty && !catalog.items.length && !catalog.updatedAt) {
    return null
  }

  await mkdir(BACKUP_DIR, { recursive: true })
  if (await latestCatalogBackupHasSameItemIds(catalog)) {
    await pruneCatalogBackups({ protectedFiles })
    return null
  }

  const timestamp = new Date().toISOString()
  const safeReason = sanitizePathPart(reason).toLowerCase()
  const filename = `${timestamp.replace(/[:.]/g, "-")}_${safeReason}.sqlite`
  const backupPath = path.join(BACKUP_DIR, filename)
  await backupSqliteDatabase(getCatalogDb(), backupPath)
  await pruneCatalogBackups({ protectedFiles: [filename, ...protectedFiles] })

  return backupSummaryFromSqliteFile(filename, backupPath, timestamp, safeReason)
}

async function pruneCatalogBackups({ protectedFiles = [] }: { protectedFiles?: string[] } = {}): Promise<void> {
  const candidates = await listCatalogBackupRetentionCandidates()
  if (candidates.length <= 1) return

  const protectedSet = new Set(protectedFiles)
  const keep = new Set<string>()
  let newestKeptAt: number | null = null
  const now = Date.now()

  for (const candidate of candidates) {
    if (protectedSet.has(candidate.file)) {
      keep.add(candidate.file)
      newestKeptAt = candidate.createdAtMs
      continue
    }

    if (newestKeptAt === null) {
      keep.add(candidate.file)
      newestKeptAt = candidate.createdAtMs
      continue
    }

    const spacing = backupRetentionSpacingMs(now - candidate.createdAtMs)
    if (newestKeptAt - candidate.createdAtMs >= spacing) {
      keep.add(candidate.file)
      newestKeptAt = candidate.createdAtMs
    }
  }

  await Promise.all(candidates.filter((candidate) => !keep.has(candidate.file)).map((candidate) => rm(candidate.path, { force: true })))
}

async function listCatalogBackupRetentionCandidates(): Promise<BackupRetentionCandidate[]> {
  let entries: Dirent<string>[]

  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates: BackupRetentionCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue

    const filePath = path.join(BACKUP_DIR, entry.name)
    const summary = await backupSummaryFromSqliteFile(entry.name, filePath)
    const createdAtMs = Date.parse(summary.createdAt || "")
    if (!Number.isFinite(createdAtMs)) continue
    candidates.push({ ...summary, path: filePath, createdAtMs })
  }

  return candidates.toSorted((a, b) => b.createdAtMs - a.createdAtMs || b.file.localeCompare(a.file))
}

function backupRetentionSpacingMs(ageMs: number): number {
  if (ageMs < 6 * HOUR_MS) return HOUR_MS
  if (ageMs < 2 * DAY_MS) return 6 * HOUR_MS
  if (ageMs < 14 * DAY_MS) return DAY_MS
  if (ageMs < 60 * DAY_MS) return 3 * DAY_MS
  return 7 * DAY_MS
}

async function latestCatalogBackupHasSameItemIds(catalog: Catalog): Promise<boolean> {
  const latestBackupPath = await latestCatalogBackupPath()
  if (!latestBackupPath) return false

  const currentIds = catalogItemIdSignature(catalog.items)
  const backupIds = readCatalogItemIdsFromSqliteFile(latestBackupPath)
  if (!backupIds) return false

  return currentIds.length === backupIds.length && currentIds.every((id, index) => id === backupIds[index])
}

async function latestCatalogBackupPath(): Promise<string | null> {
  let entries: Dirent<string>[]

  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true })
  } catch {
    return null
  }

  const sqliteEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .toSorted((a, b) => b.name.localeCompare(a.name))

  return sqliteEntries[0] ? path.join(BACKUP_DIR, sqliteEntries[0].name) : null
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

  await createCatalogBackup("before-restore", { allowEmpty: true, protectedFiles: [path.basename(backupPath)] })
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
    const backupDb = drizzle({ client: db, schema: catalogSchema })
    const itemCount = backupDb.select({ value: count() }).from(mediaItems).get()?.value ?? 0
    const updatedAt = backupDb
      .select({ valueJson: catalogMeta.valueJson })
      .from(catalogMeta)
      .where(eq(catalogMeta.key, "updatedAt"))
      .get()?.valueJson

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

function readCatalogItemIdsFromSqliteFile(filePath: string): string[] | null {
  let db: DatabaseSync | null = null

  try {
    db = new DatabaseSync(filePath, { readOnly: true })
    const rows = db.prepare("SELECT id FROM media_items ORDER BY id ASC").all() as Array<{ id: unknown }>
    return rows.map((row) => String(row.id || "")).filter(Boolean)
  } catch {
    return null
  } finally {
    db?.close()
  }
}

function catalogItemIdSignature(items: CatalogItem[] = []): string[] {
  return items
    .map((item) => item.id)
    .filter(Boolean)
    .toSorted()
}

async function isValidCatalogDatabase(filePath: string): Promise<boolean> {
  let db: DatabaseSync | null = null

  try {
    db = new DatabaseSync(filePath, { readOnly: true })
    const backupDb = drizzle({ client: db, schema: catalogSchema })
    backupDb.select({ value: count() }).from(mediaItems).get()
    backupDb.select({ value: count() }).from(catalogMeta).get()
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
