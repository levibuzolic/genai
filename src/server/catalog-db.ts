import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import { asc, desc, eq, inArray, or } from "drizzle-orm"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"

import type { PublicCreation } from "../types/routes.ts"
import { CATALOG_DB_PATH, MEDIA_DIR } from "./config.ts"
import { CREATE_ACTIVE_STATUS_VALUES, CREATE_TERMINAL_STATUS_VALUES } from "./create-constants.ts"
import { isActiveCreationStatus, isTerminalCreationStatus } from "./create-shared.ts"
import {
  catalogMeta,
  catalogSchema,
  creationEvents,
  creationJobs,
  downloadedJobIds,
  mediaItems,
  orphanFiles,
  playboxAssets,
  playboxCollections,
  type CatalogDbSchema,
} from "./db-schema.ts"
import { redactDataUrlFields } from "./redaction.ts"
import { isCatalogItem, isRecord, paramsFromUnknown, recordOrNull, stringOrNull } from "./refinements.ts"
import { parseCatalogInput, parseCreationWorkflow, parseOrphanFile } from "./schemas.ts"
import type {
  Catalog,
  CatalogItem,
  CreateParams,
  CreateSource,
  CreationEventOptions,
  CreationJob,
  CreationWorkflow,
  OrphanFile,
} from "./types.ts"
import { yieldToEventLoop } from "./utils.ts"

type TableInfoRow = {
  name: string
}

type CreationJobRow = typeof creationJobs.$inferSelect
type CreationJobInsert = typeof creationJobs.$inferInsert

type CreationInput = {
  id?: string | null
  accountEmail?: string | null
  jobId?: string | null
  status?: string | null
  queueNotBefore?: string | null
  queueAttempt?: number | string | null
  lastRateLimitedAt?: string | null
  modeId?: string | null
  modeLabel?: string | null
  mediaType?: string | null
  templateId?: string | null
  templateLabel?: string | null
  source?: unknown
  params?: unknown
  request?: unknown
  requestBody?: unknown
  workflow?: unknown
  response?: unknown
  job?: unknown
  error?: string | null
  inputUrl?: string | null
  outputUrl?: string | null
  externalTaskId?: string | null
  createdAt?: string | number | null
  createdAtIso?: string | null
  createdLocallyAt?: string | null
  submittedAt?: string | null
  updatedAt?: string | null
  finishedAt?: string | null
  downloadedItemId?: string | null
  job_id?: string | null
  mode_id?: string | null
  mode_label?: string | null
  media_type?: string | null
  template_id?: string | null
  template_label?: string | null
  input_url?: string | null
  output_url?: string | null
  external_task_id?: string | null
  created_at?: string | number | null
  created_at_iso?: string | null
  created_locally_at?: string | null
  submitted_at?: string | null
  updated_at?: string | null
  finished_at?: string | null
  downloaded_item_id?: string | null
  account_email?: string | null
  queue_not_before?: string | null
  queue_attempt?: number | string | null
  last_rate_limited_at?: string | null
  [key: string]: unknown
}

type CreationIndexColumns = {
  modelId: string | null
  negativePrompt: string | null
  prompt: string | null
  quality: string | null
  sourceItemId: string | null
  sourceKind: string | null
  sourceUrl: string | null
}

type CatalogOrm = NodeSQLiteDatabase<CatalogDbSchema>
type PlayboxCollectionRow = typeof playboxCollections.$inferSelect
type PlayboxAssetRow = typeof playboxAssets.$inferSelect
type PlayboxCollectionInsert = typeof playboxCollections.$inferInsert
type PlayboxAssetInsert = typeof playboxAssets.$inferInsert

type MediaItemIndexColumns = {
  accountEmail: string | null
  provider: string
  collectionId: string | null
  assetId: string | null
  assetKind: string | null
  userId: string | null
  type: string | null
  mediaKind: string
  status: string | null
  prompt: string | null
  negativePrompt: string | null
  searchText: string | null
  localFile: string | null
  outputUrl: string | null
  inputUrl: string | null
  downloadError: string | null
  remoteDeletedAt: string | null
  remoteDeleteStatus: string | null
  size: number | null
  fileSize: number | null
  duration: number | null
  timeToGenerateMs: number | null
  duplicateGroupSize: number | null
  hasLocalFile: number
  hasOutputUrl: number
  hasDownloadError: number
  isDeleted: number
  isMissing: number
  isFavorited: number
  shared: number | null
  favorited: number | null
  isDuplicate: number
  isUnverified: number
  isImage: number
  isVideo: number
  externalTaskId: string | null
  modelId: string | null
  error: string | null
  sha256: string | null
  verifiedAt: string | null
  contentType: string | null
  downloadedAt: string | null
  thumbnailFile: string | null
  thumbnailGeneratedAt: string | null
  thumbnailError: string | null
  duplicateOf: string | null
  createModeId: string | null
  createParamsJson: string | null
  templateId: string | null
  templateLabel: string | null
  sourceKind: string | null
  sourceItemId: string | null
  sourceUrl: string | null
  renderStartedAt: number | null
  failureObservedAt: number | null
  createdAt: number
  createdAtValue: string | null
  createdAtIso: string | null
  createdLocallyAt: string | null
  lastPolledAt: number | null
  updatedAt: string | null
}

type MediaItemProjectionRow = {
  accountEmail: string | null
  assetId: string | null
  assetKind: string | null
  collectionId: string | null
  contentType: string | null
  createModeId: string | null
  createParamsJson: string | null
  createdAt: number | null
  createdAtIso: string | null
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

export type PlayboxCollectionRecord = {
  id: string
  accountId: string | null
  name: string | null
  status: string | null
  modelId: string | null
  modelName: string | null
  modelType: string | null
  outputType: string | null
  createdAt: string | null
  updatedAt: string | null
  collection: Record<string, unknown>
}

export type PlayboxAssetRecord = {
  id: string
  collectionId: string
  kind: string
  remoteUrlBase: string | null
  remoteUrlExpiresAt: string | null
  contentType: string | null
  localFile: string | null
  size: number | null
  sha256: string | null
  downloadedAt: string | null
  downloadError: string | null
}

const MEDIA_ITEM_INDEX_VERSION = 2
const CREATION_JOB_INDEX_VERSION = 1
const ACTIVE_MEDIA_STATUSES = new Set(["pending", "queued", "submitted", "processing", "running", "in_progress"])
const FAILED_MEDIA_STATUSES = new Set(["failed", "error", "cancelled", "canceled"])
const RENDERING_MEDIA_MAX_AGE_MS = 60 * 60 * 1000
const FAILED_MEDIA_VISIBLE_MS = 5 * 60 * 1000

let catalogDb: DatabaseSync | null = null
let catalogOrm: CatalogOrm | null = null
let catalogDbRevision = 0

export function getCatalogDb(): DatabaseSync {
  if (catalogDb) {
    return catalogDb
  }

  catalogDb = new DatabaseSync(CATALOG_DB_PATH)
  catalogDb.exec("PRAGMA journal_mode = DELETE")
  catalogDb.exec("PRAGMA foreign_keys = ON")
  catalogDb.exec("PRAGMA busy_timeout = 5000")
  ensureCatalogSchema(catalogDb)
  backfillMediaItemIndexColumns(catalogDb)
  backfillCreationJobIndexColumns(catalogDb)
  return catalogDb
}

function getCatalogOrm(): CatalogOrm {
  if (!catalogOrm) {
    catalogOrm = drizzle({
      client: getCatalogDb(),
      schema: catalogSchema,
    })
  }

  return catalogOrm
}

export function getCatalogDbRevision(): number {
  return catalogDbRevision
}

function bumpCatalogDbRevision(): void {
  catalogDbRevision += 1
}

function ensureCatalogSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      item_json TEXT NOT NULL,
      account_email TEXT,
      provider TEXT NOT NULL DEFAULT 'generateporn',
      collection_id TEXT,
      asset_id TEXT,
      asset_kind TEXT,
      user_id TEXT,
      type TEXT,
      media_kind TEXT NOT NULL DEFAULT 'unknown',
      status TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      search_text TEXT,
      local_file TEXT,
      output_url TEXT,
      input_url TEXT,
      download_error TEXT,
      remote_deleted_at TEXT,
      remote_delete_status TEXT,
      size INTEGER,
      file_size INTEGER,
      duration INTEGER,
      time_to_generate_ms INTEGER,
      duplicate_group_size INTEGER,
      has_local_file INTEGER NOT NULL DEFAULT 0,
      has_output_url INTEGER NOT NULL DEFAULT 0,
      has_download_error INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      is_missing INTEGER NOT NULL DEFAULT 0,
      is_favorited INTEGER NOT NULL DEFAULT 0,
      shared INTEGER,
      favorited INTEGER,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      is_unverified INTEGER NOT NULL DEFAULT 0,
      is_image INTEGER NOT NULL DEFAULT 0,
      is_video INTEGER NOT NULL DEFAULT 0,
      external_task_id TEXT,
      model_id TEXT,
      error TEXT,
      sha256 TEXT,
      verified_at TEXT,
      content_type TEXT,
      downloaded_at TEXT,
      thumbnail_file TEXT,
      thumbnail_generated_at TEXT,
      thumbnail_error TEXT,
      duplicate_of TEXT,
      create_mode_id TEXT,
      create_params_json TEXT,
      template_id TEXT,
      template_label TEXT,
      source_kind TEXT,
      source_item_id TEXT,
      source_url TEXT,
      render_started_at INTEGER,
      failure_observed_at INTEGER,
      created_at INTEGER,
      created_at_value TEXT,
      created_at_iso TEXT,
      created_locally_at TEXT,
      last_polled_at INTEGER,
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
      queue_not_before TEXT,
      queue_attempt INTEGER,
      last_rate_limited_at TEXT,
      mode_id TEXT,
      mode_label TEXT,
      media_type TEXT,
      template_id TEXT,
      template_label TEXT,
      source_kind TEXT,
      source_item_id TEXT,
      source_url TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model_id TEXT,
      quality TEXT,
      source_json TEXT,
      params_json TEXT,
      request_json TEXT,
      request_body_json TEXT,
      workflow_json TEXT,
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

    CREATE TABLE IF NOT EXISTS playbox_collections (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      name TEXT,
      status TEXT,
      model_id TEXT,
      model_name TEXT,
      model_type TEXT,
      output_type TEXT,
      created_at TEXT,
      updated_at TEXT,
      collection_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS playbox_collections_created_at_idx ON playbox_collections(created_at DESC);

    CREATE TABLE IF NOT EXISTS playbox_assets (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      remote_url_base TEXT,
      remote_url_expires_at TEXT,
      content_type TEXT,
      local_file TEXT,
      size INTEGER,
      sha256 TEXT,
      downloaded_at TEXT,
      download_error TEXT
    );

    CREATE INDEX IF NOT EXISTS playbox_assets_collection_id_idx ON playbox_assets(collection_id);
    CREATE INDEX IF NOT EXISTS playbox_assets_kind_idx ON playbox_assets(kind);
  `)
  ensureCatalogColumn(db, "media_items", "account_email", "TEXT")
  ensureCatalogColumn(db, "media_items", "provider", "TEXT NOT NULL DEFAULT 'generateporn'")
  ensureCatalogColumn(db, "media_items", "collection_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "asset_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "asset_kind", "TEXT")
  ensureCatalogColumn(db, "media_items", "user_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "type", "TEXT")
  ensureCatalogColumn(db, "media_items", "media_kind", "TEXT NOT NULL DEFAULT 'unknown'")
  ensureCatalogColumn(db, "media_items", "status", "TEXT")
  ensureCatalogColumn(db, "media_items", "prompt", "TEXT")
  ensureCatalogColumn(db, "media_items", "negative_prompt", "TEXT")
  ensureCatalogColumn(db, "media_items", "search_text", "TEXT")
  ensureCatalogColumn(db, "media_items", "local_file", "TEXT")
  ensureCatalogColumn(db, "media_items", "output_url", "TEXT")
  ensureCatalogColumn(db, "media_items", "input_url", "TEXT")
  ensureCatalogColumn(db, "media_items", "download_error", "TEXT")
  ensureCatalogColumn(db, "media_items", "remote_deleted_at", "TEXT")
  ensureCatalogColumn(db, "media_items", "remote_delete_status", "TEXT")
  ensureCatalogColumn(db, "media_items", "size", "INTEGER")
  ensureCatalogColumn(db, "media_items", "file_size", "INTEGER")
  ensureCatalogColumn(db, "media_items", "duration", "INTEGER")
  ensureCatalogColumn(db, "media_items", "time_to_generate_ms", "INTEGER")
  ensureCatalogColumn(db, "media_items", "duplicate_group_size", "INTEGER")
  ensureCatalogColumn(db, "media_items", "has_local_file", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "has_output_url", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "has_download_error", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "is_deleted", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "is_missing", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "is_favorited", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "shared", "INTEGER")
  ensureCatalogColumn(db, "media_items", "favorited", "INTEGER")
  ensureCatalogColumn(db, "media_items", "is_duplicate", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "is_unverified", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "is_image", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "is_video", "INTEGER NOT NULL DEFAULT 0")
  ensureCatalogColumn(db, "media_items", "external_task_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "model_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "error", "TEXT")
  ensureCatalogColumn(db, "media_items", "sha256", "TEXT")
  ensureCatalogColumn(db, "media_items", "verified_at", "TEXT")
  ensureCatalogColumn(db, "media_items", "content_type", "TEXT")
  ensureCatalogColumn(db, "media_items", "downloaded_at", "TEXT")
  ensureCatalogColumn(db, "media_items", "thumbnail_file", "TEXT")
  ensureCatalogColumn(db, "media_items", "thumbnail_generated_at", "TEXT")
  ensureCatalogColumn(db, "media_items", "thumbnail_error", "TEXT")
  ensureCatalogColumn(db, "media_items", "duplicate_of", "TEXT")
  ensureCatalogColumn(db, "media_items", "create_mode_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "create_params_json", "TEXT")
  ensureCatalogColumn(db, "media_items", "template_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "template_label", "TEXT")
  ensureCatalogColumn(db, "media_items", "source_kind", "TEXT")
  ensureCatalogColumn(db, "media_items", "source_item_id", "TEXT")
  ensureCatalogColumn(db, "media_items", "source_url", "TEXT")
  ensureCatalogColumn(db, "media_items", "render_started_at", "INTEGER")
  ensureCatalogColumn(db, "media_items", "failure_observed_at", "INTEGER")
  ensureCatalogColumn(db, "media_items", "created_at_value", "TEXT")
  ensureCatalogColumn(db, "media_items", "created_at_iso", "TEXT")
  ensureCatalogColumn(db, "media_items", "created_locally_at", "TEXT")
  ensureCatalogColumn(db, "media_items", "last_polled_at", "INTEGER")
  db.exec(`
    CREATE INDEX IF NOT EXISTS media_items_provider_created_at_idx ON media_items(provider, created_at DESC);
    CREATE INDEX IF NOT EXISTS media_items_media_kind_created_at_idx ON media_items(media_kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS media_items_status_created_at_idx ON media_items(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS media_items_prompt_created_at_idx ON media_items(prompt, created_at DESC);
    CREATE INDEX IF NOT EXISTS media_items_size_idx ON media_items(size);
  `)
  ensureCatalogColumn(db, "creation_jobs", "template_id", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "template_label", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "workflow_json", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "account_email", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "queue_not_before", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "queue_attempt", "INTEGER")
  ensureCatalogColumn(db, "creation_jobs", "last_rate_limited_at", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "source_kind", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "source_item_id", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "source_url", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "prompt", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "negative_prompt", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "model_id", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "quality", "TEXT")
  db.exec("CREATE INDEX IF NOT EXISTS creation_jobs_prompt_idx ON creation_jobs(prompt)")
}

function backfillMediaItemIndexColumns(db: DatabaseSync): void {
  const versionRow = db.prepare("SELECT value_json AS valueJson FROM catalog_meta WHERE key = ?").get("mediaItemIndexVersion") as
    | { valueJson: string }
    | undefined
  const currentVersion = versionRow ? Number(parseJson(versionRow.valueJson, 0)) : 0
  if (currentVersion >= MEDIA_ITEM_INDEX_VERSION) {
    return
  }

  const rows = db.prepare("SELECT id, item_json AS itemJson FROM media_items").all() as { id: string; itemJson: string }[]
  const update = db.prepare(`
    UPDATE media_items
    SET account_email = ?,
        provider = ?,
        collection_id = ?,
        asset_id = ?,
        asset_kind = ?,
        user_id = ?,
        type = ?,
        media_kind = ?,
        status = ?,
        prompt = ?,
        negative_prompt = ?,
        search_text = ?,
        local_file = ?,
        output_url = ?,
        input_url = ?,
        download_error = ?,
        remote_deleted_at = ?,
        remote_delete_status = ?,
        size = ?,
        file_size = ?,
        duration = ?,
        time_to_generate_ms = ?,
        duplicate_group_size = ?,
        has_local_file = ?,
        has_output_url = ?,
        has_download_error = ?,
        is_deleted = ?,
        is_missing = ?,
        is_favorited = ?,
        shared = ?,
        favorited = ?,
        is_duplicate = ?,
        is_unverified = ?,
        is_image = ?,
        is_video = ?,
        external_task_id = ?,
        model_id = ?,
        error = ?,
        sha256 = ?,
        verified_at = ?,
        content_type = ?,
        downloaded_at = ?,
        thumbnail_file = ?,
        thumbnail_generated_at = ?,
        thumbnail_error = ?,
        duplicate_of = ?,
        create_mode_id = ?,
        create_params_json = ?,
        template_id = ?,
        template_label = ?,
        source_kind = ?,
        source_item_id = ?,
        source_url = ?,
        render_started_at = ?,
        failure_observed_at = ?,
        created_at = ?,
        created_at_value = ?,
        created_at_iso = ?,
        created_locally_at = ?,
        last_polled_at = ?,
        updated_at = ?
    WHERE id = ?
  `)
  const upsertVersion = db.prepare(`
    INSERT INTO catalog_meta (key, value_json)
    VALUES ('mediaItemIndexVersion', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `)

  db.exec("BEGIN IMMEDIATE")
  try {
    for (const row of rows) {
      const item = parseJson(row.itemJson, null)
      if (!isCatalogItem(item)) continue

      const index = mediaItemIndexColumns(item)
      update.run(...mediaItemIndexUpdateArgs(index), row.id)
    }
    upsertVersion.run(JSON.stringify(MEDIA_ITEM_INDEX_VERSION))
    db.exec("COMMIT")
    bumpCatalogDbRevision()
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function backfillCreationJobIndexColumns(db: DatabaseSync): void {
  const versionRow = db.prepare("SELECT value_json AS valueJson FROM catalog_meta WHERE key = ?").get("creationJobIndexVersion") as
    | { valueJson: string }
    | undefined
  const currentVersion = versionRow ? Number(parseJson(versionRow.valueJson, 0)) : 0
  if (currentVersion >= CREATION_JOB_INDEX_VERSION) {
    return
  }

  const rows = db.prepare("SELECT id, source_json AS sourceJson, params_json AS paramsJson FROM creation_jobs").all() as {
    id: string
    paramsJson: string | null
    sourceJson: string | null
  }[]
  const update = db.prepare(`
    UPDATE creation_jobs
    SET source_kind = ?,
        source_item_id = ?,
        source_url = ?,
        prompt = ?,
        negative_prompt = ?,
        model_id = ?,
        quality = ?
    WHERE id = ?
  `)
  const upsertVersion = db.prepare(`
    INSERT INTO catalog_meta (key, value_json)
    VALUES ('creationJobIndexVersion', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `)

  db.exec("BEGIN IMMEDIATE")
  try {
    for (const row of rows) {
      const index = creationIndexColumns(parseJson(row.sourceJson || "null", null), parseJson(row.paramsJson || "{}", {}))
      update.run(...creationIndexUpdateArgs(index), row.id)
    }
    upsertVersion.run(JSON.stringify(CREATION_JOB_INDEX_VERSION))
    db.exec("COMMIT")
    bumpCatalogDbRevision()
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function mediaItemIndexColumns(item: CatalogItem): MediaItemIndexColumns {
  const isImage = isImageCatalogItem(item)
  const isVideo = isVideoCatalogItem(item)
  const localFile = stringOrNull(item.localFile)
  const outputUrl = stringOrNull(item.outputUrl)
  const downloadError = stringOrNull(item.downloadError)
  const renderStartedAt = mediaItemRenderStartedAtMs(item)
  const failureObservedAt = mediaItemFailureObservedAtMs(item)
  const size = finiteNumberOrNull(item.size ?? item.fileSize)
  const createdAt = Math.trunc(timestampMs(item.createdAt) || 0)

  return {
    accountEmail: stringOrNull(item.accountEmail),
    provider: stringOrNull(item.provider) || "generateporn",
    collectionId: stringOrNull(item.collectionId),
    assetId: stringOrNull(item.assetId),
    assetKind: stringOrNull(item.assetKind),
    userId: stringOrNull(item.userId),
    type: stringOrNull(item.type),
    mediaKind: isImage ? "image" : isVideo ? "video" : "unknown",
    status: stringOrNull(item.status),
    prompt: stringOrNull(item.prompt),
    negativePrompt: stringOrNull(item.negativePrompt),
    searchText: mediaItemSearchText(item),
    localFile,
    outputUrl,
    inputUrl: stringOrNull(item.inputUrl),
    downloadError,
    remoteDeletedAt: stringOrNull(item.remoteDeletedAt),
    remoteDeleteStatus: stringOrNull(item.remoteDeleteStatus),
    size,
    fileSize: finiteNumberOrNull(item.fileSize),
    duration: finiteNumberOrNull(item.duration),
    timeToGenerateMs: finiteNumberOrNull(item.timeToGenerateMs),
    duplicateGroupSize: finiteNumberOrNull(item.duplicateGroupSize),
    hasLocalFile: bit(Boolean(localFile)),
    hasOutputUrl: bit(Boolean(outputUrl)),
    hasDownloadError: bit(Boolean(downloadError)),
    isDeleted: bit(isDeletedCatalogItem(item) || isExpiredFailedMediaGenerationItem(item)),
    isMissing: bit(isMissingMediaItem(item)),
    isFavorited: bit(Boolean(item.favorited)),
    shared: item.shared === null || item.shared === undefined ? null : bit(Boolean(item.shared)),
    favorited: item.favorited === null || item.favorited === undefined ? null : bit(Boolean(item.favorited)),
    isDuplicate: bit(Number(item.duplicateGroupSize || 0) > 1),
    isUnverified: bit(Boolean(localFile) && !item.sha256),
    isImage: bit(isImage),
    isVideo: bit(isVideo),
    externalTaskId: stringOrNull(item.externalTaskId),
    modelId: stringOrNull(item.modelId ?? item.model_id),
    error: stringOrNull(item.error),
    sha256: stringOrNull(item.sha256),
    verifiedAt: stringOrNull(item.verifiedAt),
    contentType: stringOrNull(item.contentType),
    downloadedAt: stringOrNull(item.downloadedAt),
    thumbnailFile: stringOrNull(item.thumbnailFile),
    thumbnailGeneratedAt: stringOrNull(item.thumbnailGeneratedAt),
    thumbnailError: stringOrNull(item.thumbnailError),
    duplicateOf: stringOrNull(item.duplicateOf),
    createModeId: stringOrNull(item.createModeId),
    createParamsJson: stringifyNullable(item.createParams),
    templateId: stringOrNull(item.templateId),
    templateLabel: stringOrNull(item.templateLabel),
    sourceKind: stringOrNull(item.sourceKind),
    sourceItemId: stringOrNull(item.sourceItemId),
    sourceUrl: stringOrNull(item.sourceUrl),
    renderStartedAt,
    failureObservedAt,
    createdAt,
    createdAtValue: textScalarOrNull(item.createdAt),
    createdAtIso: stringOrNull(item.createdAtIso),
    createdLocallyAt: stringOrNull(item.createdLocallyAt),
    lastPolledAt: timestampMs(item.lastPolledAt ?? item.last_polled_at),
    updatedAt: stringOrNull(item.updatedAt),
  }
}

function mediaItemIndexUpdateArgs(index: MediaItemIndexColumns): Array<string | number | null> {
  return [
    index.accountEmail,
    index.provider,
    index.collectionId,
    index.assetId,
    index.assetKind,
    index.userId,
    index.type,
    index.mediaKind,
    index.status,
    index.prompt,
    index.negativePrompt,
    index.searchText,
    index.localFile,
    index.outputUrl,
    index.inputUrl,
    index.downloadError,
    index.remoteDeletedAt,
    index.remoteDeleteStatus,
    index.size,
    index.fileSize,
    index.duration,
    index.timeToGenerateMs,
    index.duplicateGroupSize,
    index.hasLocalFile,
    index.hasOutputUrl,
    index.hasDownloadError,
    index.isDeleted,
    index.isMissing,
    index.isFavorited,
    index.shared,
    index.favorited,
    index.isDuplicate,
    index.isUnverified,
    index.isImage,
    index.isVideo,
    index.externalTaskId,
    index.modelId,
    index.error,
    index.sha256,
    index.verifiedAt,
    index.contentType,
    index.downloadedAt,
    index.thumbnailFile,
    index.thumbnailGeneratedAt,
    index.thumbnailError,
    index.duplicateOf,
    index.createModeId,
    index.createParamsJson,
    index.templateId,
    index.templateLabel,
    index.sourceKind,
    index.sourceItemId,
    index.sourceUrl,
    index.renderStartedAt,
    index.failureObservedAt,
    index.createdAt,
    index.createdAtValue,
    index.createdAtIso,
    index.createdLocallyAt,
    index.lastPolledAt,
    index.updatedAt,
  ]
}

function mediaItemSearchText(item: CatalogItem): string | null {
  const values = [
    item.id,
    item.type,
    item.provider,
    item.collectionId,
    item.assetId,
    item.assetKind,
    item.prompt,
    item.negativePrompt,
    item.localFile,
  ]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)

  return values.length ? values.join("\n") : null
}

function isImageCatalogItem(item: CatalogItem): boolean {
  return Boolean(
    /\.(png|jpe?g|webp|bmp)$/i.test(item.localFile || "") || item.outputUrl?.toLowerCase().match(/\.(png|jpe?g|webp|bmp)(?:[?#].*)?$/),
  )
}

function isVideoCatalogItem(item: CatalogItem): boolean {
  return Boolean(
    item.type === "video" || item.localFile?.toLowerCase().endsWith(".mp4") || item.outputUrl?.toLowerCase().match(/\.mp4(?:[?#].*)?$/),
  )
}

function isMissingMediaItem(item: CatalogItem): boolean {
  return !item.localFile && !item.downloadError && !isPendingMediaItem(item) && !isFailedMediaGenerationItem(item)
}

function isPendingMediaItem(item: CatalogItem): boolean {
  return isActiveNoMediaItem(item) && isRecentRenderingMediaItem(item)
}

function isActiveNoMediaItem(item: CatalogItem): boolean {
  return ACTIVE_MEDIA_STATUSES.has(String(item.status || "").toLowerCase()) && !item.localFile && !item.outputUrl
}

function isRecentRenderingMediaItem(item: CatalogItem, now = Date.now()): boolean {
  const startedAt = mediaItemRenderStartedAtMs(item)
  return startedAt !== null && now - startedAt < RENDERING_MEDIA_MAX_AGE_MS
}

function isDeletedCatalogItem(item: CatalogItem): boolean {
  return typeof item.remoteDeletedAt === "string" && item.remoteDeletedAt.length > 0
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

function mediaItemRenderStartedAtMs(item: CatalogItem): number | null {
  for (const value of [item.createdAtIso, item.createdLocallyAt, item.createdAt, item.updatedAt]) {
    const timestamp = timestampMs(value)
    if (timestamp !== null) return timestamp
  }

  return null
}

function mediaItemFailureObservedAtMs(item: CatalogItem): number | null {
  for (const value of [item.updatedAt, item.lastPolledAt, item.last_polled_at, item.createdLocallyAt, item.createdAtIso, item.createdAt]) {
    const timestamp = timestampMs(value)
    if (timestamp !== null) return timestamp
  }

  return null
}

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.trunc(value > 1_000_000_000_000 ? value : value * 1000)
  }

  if (typeof value !== "string") return null

  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function finiteNumberOrNull(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function textScalarOrNull(value: unknown): string | null {
  if (typeof value === "string" && value) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function bit(value: boolean): number {
  return value ? 1 : 0
}

function creationIndexColumns(source: unknown, params: unknown): CreationIndexColumns {
  const sourceRecord = recordOrNull(source)
  const paramsRecord = recordOrNull(params) || {}

  return {
    modelId: stringOrNull(paramsRecord["modelId"]),
    negativePrompt: stringOrNull(paramsRecord["negativePrompt"] ?? paramsRecord["negative_prompt"]),
    prompt: stringOrNull(paramsRecord["prompt"]),
    quality: stringOrNull(paramsRecord["quality"]),
    sourceItemId: stringOrNull(sourceRecord?.["itemId"]),
    sourceKind: stringOrNull(sourceRecord?.["kind"]),
    sourceUrl: stringOrNull(sourceRecord?.["url"]),
  }
}

function creationIndexUpdateArgs(index: CreationIndexColumns): Array<string | null> {
  return [index.sourceKind, index.sourceItemId, index.sourceUrl, index.prompt, index.negativePrompt, index.modelId, index.quality]
}

function creationSourceFromIndex(row: Pick<CreationIndexColumns, "sourceItemId" | "sourceKind" | "sourceUrl">): CreateSource | null {
  if (!row.sourceKind) return null

  const source: CreateSource = { kind: row.sourceKind }
  if (row.sourceItemId) source["itemId"] = row.sourceItemId
  if (row.sourceUrl) source["url"] = row.sourceUrl
  return source
}

function creationParamsFromIndex(row: Pick<CreationIndexColumns, "modelId" | "negativePrompt" | "prompt" | "quality">): CreateParams {
  const params: CreateParams = {}
  if (row.modelId) params["modelId"] = row.modelId
  if (row.negativePrompt) params["negativePrompt"] = row.negativePrompt
  if (row.prompt) params["prompt"] = row.prompt
  if (row.quality) params["quality"] = row.quality
  return params
}

export function savePlayboxCollection(collection: PlayboxCollectionRecord): PlayboxCollectionRecord {
  const row: PlayboxCollectionInsert = {
    id: collection.id,
    accountId: collection.accountId,
    name: collection.name,
    status: collection.status,
    modelId: collection.modelId,
    modelName: collection.modelName,
    modelType: collection.modelType,
    outputType: collection.outputType,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    collectionJson: JSON.stringify(collection.collection),
  }
  const { id: _id, ...updateRow } = row

  getCatalogOrm()
    .insert(playboxCollections)
    .values(row)
    .onConflictDoUpdate({
      target: playboxCollections.id,
      set: updateRow,
    })
    .run()
  bumpCatalogDbRevision()

  return collection
}

export function savePlayboxAsset(asset: PlayboxAssetRecord): PlayboxAssetRecord {
  const row: PlayboxAssetInsert = {
    id: asset.id,
    collectionId: asset.collectionId,
    kind: asset.kind,
    remoteUrlBase: asset.remoteUrlBase,
    remoteUrlExpiresAt: asset.remoteUrlExpiresAt,
    contentType: asset.contentType,
    localFile: asset.localFile,
    size: asset.size,
    sha256: asset.sha256,
    downloadedAt: asset.downloadedAt,
    downloadError: asset.downloadError,
  }
  const { id: _id, ...updateRow } = row

  getCatalogOrm()
    .insert(playboxAssets)
    .values(row)
    .onConflictDoUpdate({
      target: playboxAssets.id,
      set: updateRow,
    })
    .run()
  bumpCatalogDbRevision()

  return asset
}

export function findPlayboxAsset(id: string | null | undefined): PlayboxAssetRecord | null {
  if (!id) {
    return null
  }

  const row = getCatalogOrm().select().from(playboxAssets).where(eq(playboxAssets.id, id)).limit(1).get()
  return row ? playboxAssetFromRow(row) : null
}

export function listPlayboxCollections(): PlayboxCollectionRecord[] {
  return getCatalogOrm()
    .select()
    .from(playboxCollections)
    .orderBy(desc(playboxCollections.createdAt), playboxCollections.id)
    .all()
    .map(playboxCollectionFromRow)
}

export function listPlayboxAssetsForCollection(collectionId: string): PlayboxAssetRecord[] {
  return getCatalogOrm()
    .select()
    .from(playboxAssets)
    .where(eq(playboxAssets.collectionId, collectionId))
    .orderBy(asc(playboxAssets.kind), playboxAssets.id)
    .all()
    .map(playboxAssetFromRow)
}

function ensureCatalogColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter(isTableInfoRow)
  if (columns.some((entry) => entry.name === column)) {
    return
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function readCatalogFromDb(): Catalog {
  const db = getCatalogOrm()
  const metaRows = db.select().from(catalogMeta).all()
  const meta = new Map(metaRows.map((row) => [row.key, parseJson(row.valueJson, null)]))
  const itemRows = db.select().from(mediaItems).orderBy(desc(mediaItems.createdAt), mediaItems.id).all()
  const downloadedRows = db.select({ id: downloadedJobIds.id }).from(downloadedJobIds).orderBy(downloadedJobIds.position).all()
  const orphanRows = db.select().from(orphanFiles).orderBy(orphanFiles.localFile).all()

  return normalizeCatalog({
    items: itemRows.map((row) => parseJson(row.itemJson, null)).filter(isCatalogItem),
    downloadedJobIds: downloadedRows.map((row) => row.id),
    orphanFiles: orphanRows.map((row) => parseJson(row.fileJson, null)).filter(isOrphanFile),
    lastSeenJobId: stringOrNull(meta.get("lastSeenJobId")),
    lastSeenJobIdsByAccount: (recordOrNull(meta.get("lastSeenJobIdsByAccount")) as Record<string, string | null> | null) || undefined,
    updatedAt: stringOrNull(meta.get("updatedAt")),
    lastRun: recordOrNull(meta.get("lastRun")),
  })
}

export function listCatalogItemsByPrompts(prompts: Iterable<string>, limit = 6): CatalogItem[] {
  const promptSet = new Set([...prompts].map(normalizePromptLink).filter(Boolean))
  if (!promptSet.size) return []

  const db = getCatalogDb()
  const promptsList = [...promptSet]
  const placeholders = promptsList.map(() => "?").join(",")
  const rows = db
    .prepare(
      `SELECT ${mediaItemProjectionSelectSql()} FROM media_items WHERE prompt IN (${placeholders}) ORDER BY created_at DESC, id LIMIT ?`,
    )
    .all(...promptsList, limit) as MediaItemProjectionRow[]
  const items = rows.map(catalogItemFromMediaItemProjection).filter((item) => promptSet.has(normalizePromptLink(item.prompt)))

  return items.slice(0, limit)
}

function mediaItemProjectionSelectSql(): string {
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

function catalogItemFromMediaItemProjection(row: MediaItemProjectionRow): CatalogItem {
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

function normalizePromptLink(prompt: unknown): string {
  return String(prompt || "").trim()
}

export function writeCatalogToDb(catalog: Catalog): void {
  const db = getCatalogOrm()
  const normalized = normalizeCatalog(catalog)

  db.transaction(
    (tx) => {
      tx.delete(mediaItems).run()
      tx.delete(downloadedJobIds).run()
      tx.delete(orphanFiles).run()

      const itemRows = normalized.items
        .filter((item) => Boolean(item.id))
        .map((item) => ({
          id: item.id,
          itemJson: JSON.stringify(item),
          ...mediaItemIndexColumns(item),
        }))
      if (itemRows.length) {
        tx.insert(mediaItems).values(itemRows).run()
      }

      const downloadedRows = normalized.downloadedJobIds.map((id, position) => ({ id, position }))
      if (downloadedRows.length) {
        tx.insert(downloadedJobIds).values(downloadedRows).run()
      }

      const orphanRows = normalized.orphanFiles
        .filter((file) => Boolean(file.localFile))
        .map((file) => ({
          localFile: file.localFile,
          fileJson: JSON.stringify(file),
        }))
      if (orphanRows.length) {
        tx.insert(orphanFiles).values(orphanRows).run()
      }

      upsertCatalogMeta(tx, "lastSeenJobId", normalized.lastSeenJobId || null)
      upsertCatalogMeta(tx, "lastSeenJobIdsByAccount", normalized.lastSeenJobIdsByAccount || {})
      upsertCatalogMeta(tx, "updatedAt", normalized.updatedAt || null)
      upsertCatalogMeta(tx, "lastRun", normalized.lastRun || null)
    },
    { behavior: "immediate" },
  )
  bumpCatalogDbRevision()
}

export function readCatalogMeta(key: string): unknown {
  const row = getCatalogOrm().select({ valueJson: catalogMeta.valueJson }).from(catalogMeta).where(eq(catalogMeta.key, key)).get()
  return row ? parseJson(row.valueJson, null) : null
}

export function writeCatalogMeta(key: string, value: unknown): void {
  upsertCatalogMeta(getCatalogOrm(), key, value)
  bumpCatalogDbRevision()
}

function upsertCatalogMeta(db: CatalogOrm, key: string, value: unknown): void {
  db.insert(catalogMeta)
    .values({ key, valueJson: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: catalogMeta.key,
      set: { valueJson: JSON.stringify(value) },
    })
    .run()
}

export function saveCreationJob(creation: CreationInput, event: CreationEventOptions = {}): CreationJob {
  const existing = creation.id ? findCreationJob(creation.id) : null
  const next = normalizeCreationJob({
    ...existing,
    ...creation,
    updatedAt: creation.updatedAt || new Date().toISOString(),
  })
  const row = creationJobToInsert(next)
  const { id: _id, ...updateRow } = row

  getCatalogOrm()
    .insert(creationJobs)
    .values(row)
    .onConflictDoUpdate({
      target: creationJobs.id,
      set: updateRow,
    })
    .run()
  bumpCatalogDbRevision()

  const eventStatus = event.eventStatus || (existing?.status !== next.status ? next.status : null)
  if (eventStatus && (event.eventMessage || existing?.status !== next.status || !existing)) {
    addCreationEvent(next.id, eventStatus, event.eventMessage || `Status changed to ${eventStatus}.`, event.eventData || null)
  }

  return next
}

export function moveCreationJob(previousId: string, creation: CreationInput): CreationJob {
  const db = getCatalogOrm()
  const existing = findCreationJob(previousId)
  const nextId = stringOrNull(creation.id) || existing?.id || previousId

  if (existing && previousId !== nextId) {
    db.delete(creationJobs).where(eq(creationJobs.id, previousId)).run()
    db.update(creationEvents).set({ creationId: nextId }).where(eq(creationEvents.creationId, previousId)).run()
  }

  return saveCreationJob({
    ...existing,
    ...creation,
  })
}

export function addCreationEvent(creationId: string, status: string, message: string | null, data: unknown = null): void {
  getCatalogOrm()
    .insert(creationEvents)
    .values({
      creationId,
      status: String(status || "updated"),
      message: message || null,
      eventJson: stringifyNullable(data),
      createdAt: new Date().toISOString(),
    })
    .run()
  bumpCatalogDbRevision()
}

export function findCreationJob(id: string | null | undefined): CreationJob | null {
  if (!id) {
    return null
  }

  const row = getCatalogOrm()
    .select()
    .from(creationJobs)
    .where(or(eq(creationJobs.id, id), eq(creationJobs.jobId, id)))
    .limit(1)
    .get()

  return row ? creationJobFromRow(row) : null
}

export function listCreationJobs({ status = "all", limit = 80 }: { status?: string; limit?: number } = {}): CreationJob[] {
  const rows = getCatalogOrm()
    .select()
    .from(creationJobs)
    .orderBy(desc(creationJobs.updatedAt), desc(creationJobs.createdLocallyAt))
    .limit(limit)
    .all()
  const creations = rows.map(creationJobFromRow)
  const filtered = creations.filter((row) => {
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

export function listCreationJobSummaries({ status = "all", limit = 80 }: { status?: string; limit?: number } = {}): CreationJob[] {
  const selection = {
    id: creationJobs.id,
    accountEmail: creationJobs.accountEmail,
    jobId: creationJobs.jobId,
    status: creationJobs.status,
    queueNotBefore: creationJobs.queueNotBefore,
    queueAttempt: creationJobs.queueAttempt,
    lastRateLimitedAt: creationJobs.lastRateLimitedAt,
    modeId: creationJobs.modeId,
    modeLabel: creationJobs.modeLabel,
    mediaType: creationJobs.mediaType,
    templateId: creationJobs.templateId,
    templateLabel: creationJobs.templateLabel,
    modelId: creationJobs.modelId,
    negativePrompt: creationJobs.negativePrompt,
    prompt: creationJobs.prompt,
    quality: creationJobs.quality,
    sourceItemId: creationJobs.sourceItemId,
    sourceKind: creationJobs.sourceKind,
    sourceUrl: creationJobs.sourceUrl,
    error: creationJobs.error,
    inputUrl: creationJobs.inputUrl,
    outputUrl: creationJobs.outputUrl,
    externalTaskId: creationJobs.externalTaskId,
    createdAt: creationJobs.createdAt,
    createdAtIso: creationJobs.createdAtIso,
    createdLocallyAt: creationJobs.createdLocallyAt,
    submittedAt: creationJobs.submittedAt,
    updatedAt: creationJobs.updatedAt,
    finishedAt: creationJobs.finishedAt,
    downloadedItemId: creationJobs.downloadedItemId,
  }
  const rows =
    status === "active"
      ? getCatalogOrm()
          .select(selection)
          .from(creationJobs)
          .where(inArray(creationJobs.status, CREATE_ACTIVE_STATUS_VALUES))
          .orderBy(desc(creationJobs.updatedAt), desc(creationJobs.createdLocallyAt))
          .limit(limit)
          .all()
      : status === "finished"
        ? getCatalogOrm()
            .select(selection)
            .from(creationJobs)
            .where(inArray(creationJobs.status, CREATE_TERMINAL_STATUS_VALUES))
            .orderBy(desc(creationJobs.updatedAt), desc(creationJobs.createdLocallyAt))
            .limit(limit)
            .all()
        : status === "catalog-projection"
          ? getCatalogOrm()
              .select(selection)
              .from(creationJobs)
              .where(inArray(creationJobs.status, [...CREATE_ACTIVE_STATUS_VALUES, ...CREATE_TERMINAL_STATUS_VALUES]))
              .orderBy(desc(creationJobs.updatedAt), desc(creationJobs.createdLocallyAt))
              .limit(limit)
              .all()
          : getCatalogOrm()
              .select(selection)
              .from(creationJobs)
              .orderBy(desc(creationJobs.updatedAt), desc(creationJobs.createdLocallyAt))
              .limit(limit)
              .all()
  const creations = rows.map((row) =>
    normalizeCreationJob({
      ...row,
      source: creationSourceFromIndex(row),
      params: creationParamsFromIndex(row),
    }),
  )
  const filtered = creations.filter((row) => {
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

export function getPendingCreationCountsByAccount(): Record<string, number> {
  const rows = getCatalogOrm()
    .select({
      accountEmail: creationJobs.accountEmail,
      jobId: creationJobs.jobId,
      status: creationJobs.status,
    })
    .from(creationJobs)
    .all()
  const counts: Record<string, number> = {}

  for (const row of rows) {
    if (!row.jobId || !isActiveCreationStatus(row.status)) continue

    const key = row.accountEmail || "__default__"
    counts[key] = (counts[key] || 0) + 1
  }

  return counts
}

export function listCreationEvents(
  creationId: string,
): { id: number; status: string; message: string | null; data: unknown; createdAt: string }[] {
  const rows = getCatalogOrm()
    .select()
    .from(creationEvents)
    .where(eq(creationEvents.creationId, creationId))
    .orderBy(asc(creationEvents.id))
    .all()

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    message: row.message,
    data: parseJson(row.eventJson, null),
    createdAt: row.createdAt,
  }))
}

export function normalizeCreationJob(creation: CreationInput = {}): CreationJob {
  const now = new Date().toISOString()

  return {
    id: stringOrNull(creation.id) || stringOrNull(creation.jobId) || `local-${randomUUID()}`,
    accountEmail: stringOrNull(creation.accountEmail) || stringOrNull(creation.account_email),
    jobId: stringOrNull(creation.jobId) || stringOrNull(creation.job_id),
    status: stringOrNull(creation.status) || "draft",
    queueNotBefore: stringOrNull(creation.queueNotBefore) || stringOrNull(creation.queue_not_before),
    queueAttempt: nonNegativeInteger(creation.queueAttempt ?? creation.queue_attempt),
    lastRateLimitedAt: stringOrNull(creation.lastRateLimitedAt) || stringOrNull(creation.last_rate_limited_at),
    modeId: stringOrNull(creation.modeId) || stringOrNull(creation.mode_id),
    modeLabel: stringOrNull(creation.modeLabel) || stringOrNull(creation.mode_label),
    mediaType: stringOrNull(creation.mediaType) || stringOrNull(creation.media_type),
    templateId: stringOrNull(creation.templateId) || stringOrNull(creation.template_id),
    templateLabel: stringOrNull(creation.templateLabel) || stringOrNull(creation.template_label),
    source: recordOrNull(creation.source),
    params: paramsOrEmpty(creation.params),
    request: recordOrNull(creation.request),
    requestBody: recordOrNull(creation.requestBody),
    workflow: workflowOrNull(creation.workflow),
    response: recordOrNull(creation.response),
    job: recordOrNull(creation.job),
    error: stringOrNull(creation.error),
    inputUrl: stringOrNull(creation.inputUrl) || stringOrNull(creation.input_url),
    outputUrl: stringOrNull(creation.outputUrl) || stringOrNull(creation.output_url),
    externalTaskId: stringOrNull(creation.externalTaskId) || stringOrNull(creation.external_task_id),
    createdAt: creation.createdAt || creation.created_at || null,
    createdAtIso: stringOrNull(creation.createdAtIso) || stringOrNull(creation.created_at_iso),
    createdLocallyAt: stringOrNull(creation.createdLocallyAt) || stringOrNull(creation.created_locally_at) || now,
    submittedAt: stringOrNull(creation.submittedAt) || stringOrNull(creation.submitted_at),
    updatedAt: stringOrNull(creation.updatedAt) || stringOrNull(creation.updated_at) || now,
    finishedAt: stringOrNull(creation.finishedAt) || stringOrNull(creation.finished_at),
    downloadedItemId: stringOrNull(creation.downloadedItemId) || stringOrNull(creation.downloaded_item_id),
  }
}

function creationJobToInsert(creation: CreationJob): CreationJobInsert {
  const index = creationIndexColumns(creation.source, creation.params)

  return {
    id: creation.id,
    accountEmail: creation.accountEmail,
    jobId: creation.jobId,
    status: creation.status,
    queueNotBefore: creation.queueNotBefore,
    queueAttempt: creation.queueAttempt,
    lastRateLimitedAt: creation.lastRateLimitedAt,
    modeId: creation.modeId,
    modeLabel: creation.modeLabel,
    mediaType: creation.mediaType,
    templateId: creation.templateId,
    templateLabel: creation.templateLabel,
    sourceKind: index.sourceKind,
    sourceItemId: index.sourceItemId,
    sourceUrl: index.sourceUrl,
    prompt: index.prompt,
    negativePrompt: index.negativePrompt,
    modelId: index.modelId,
    quality: index.quality,
    sourceJson: stringifyNullable(creation.source),
    paramsJson: stringifyNullable(creation.params),
    requestJson: stringifyNullable(creation.request),
    requestBodyJson: stringifyNullable(creation.requestBody ? redactDataUrlFields(creation.requestBody) : null),
    workflowJson: stringifyNullable(creation.workflow),
    responseJson: stringifyNullable(creation.response),
    jobJson: stringifyNullable(creation.job),
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
  }
}

function creationJobFromRow(row: CreationJobRow): CreationJob {
  return normalizeCreationJob({
    id: row.id,
    accountEmail: row.accountEmail,
    jobId: row.jobId,
    status: row.status,
    queueNotBefore: row.queueNotBefore,
    queueAttempt: row.queueAttempt,
    lastRateLimitedAt: row.lastRateLimitedAt,
    modeId: row.modeId,
    modeLabel: row.modeLabel,
    mediaType: row.mediaType,
    templateId: row.templateId,
    templateLabel: row.templateLabel,
    source: parseJson(row.sourceJson, null),
    params: parseJson(row.paramsJson, {}),
    request: parseJson(row.requestJson, null),
    requestBody: parseJson(row.requestBodyJson, null),
    workflow: parseJson(row.workflowJson, null),
    response: parseJson(row.responseJson, null),
    job: parseJson(row.jobJson, null),
    error: row.error,
    inputUrl: row.inputUrl,
    outputUrl: row.outputUrl,
    externalTaskId: row.externalTaskId,
    createdAt: row.createdAt,
    createdAtIso: row.createdAtIso,
    createdLocallyAt: row.createdLocallyAt || null,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt || null,
    finishedAt: row.finishedAt,
    downloadedItemId: row.downloadedItemId,
  })
}

function playboxCollectionFromRow(row: PlayboxCollectionRow): PlayboxCollectionRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    status: row.status,
    modelId: row.modelId,
    modelName: row.modelName,
    modelType: row.modelType,
    outputType: row.outputType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    collection: recordOrNull(parseJson(row.collectionJson, null)) || {},
  }
}

function playboxAssetFromRow(row: PlayboxAssetRow): PlayboxAssetRecord {
  return {
    id: row.id,
    collectionId: row.collectionId,
    kind: row.kind,
    remoteUrlBase: row.remoteUrlBase,
    remoteUrlExpiresAt: row.remoteUrlExpiresAt,
    contentType: row.contentType,
    localFile: row.localFile,
    size: row.size,
    sha256: row.sha256,
    downloadedAt: row.downloadedAt,
    downloadError: row.downloadError,
  }
}

export function toPublicCreation(creation: CreationJob, { details = false }: { details?: boolean } = {}): PublicCreation {
  const publicCreation: PublicCreation = {
    id: creation.id,
    accountEmail: creation.accountEmail,
    jobId: creation.jobId,
    status: creation.status,
    queueNotBefore: creation.queueNotBefore,
    queueAttempt: creation.queueAttempt,
    lastRateLimitedAt: creation.lastRateLimitedAt,
    modeId: creation.modeId,
    modeLabel: creation.modeLabel,
    mediaType: creation.mediaType,
    templateId: creation.templateId,
    templateLabel: creation.templateLabel,
    source: publicCreationSource(creation.source),
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
    publicCreation.workflow = creation.workflow
  }

  return compactPublicCreation(publicCreation)
}

function compactPublicCreation(creation: PublicCreation): PublicCreation {
  const compact: Record<string, unknown> = {
    id: creation.id,
    accountEmail: creation.accountEmail,
    source: creation.source,
    active: creation.active,
    params: creation.params,
    status: creation.status,
  }

  for (const key of ["request", "response", "job", "workflow"] as const) {
    if (Object.hasOwn(creation, key)) compact[key] = creation[key]
  }

  for (const [key, value] of Object.entries(creation)) {
    if (key in compact || value === null || value === undefined) continue
    compact[key] = value
  }

  return compact as PublicCreation
}

function publicCreationSource(source: Record<string, unknown> | null): CreateSource | null {
  if (!source) {
    return null
  }

  const kind = stringOrNull(source["kind"])
  if (!kind) {
    return null
  }

  return {
    ...source,
    kind,
  }
}

export function stringifyNullable(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

export function normalizeCatalog(catalog: Partial<Catalog> = {}): Catalog {
  const parsed = parseCatalogInput(catalog)

  return {
    items: parsed.items.filter(isCatalogItem),
    downloadedJobIds: parsed.downloadedJobIds,
    orphanFiles: parsed.orphanFiles.filter(isOrphanFile),
    lastSeenJobId: stringOrNull(parsed.lastSeenJobId),
    lastSeenJobIdsByAccount: normalizeLastSeenJobIdsByAccount(parsed.lastSeenJobIdsByAccount),
    updatedAt: stringOrNull(parsed.updatedAt),
    lastRun: recordOrNull(parsed.lastRun),
  }
}

function normalizeLastSeenJobIdsByAccount(value: Record<string, unknown> | null | undefined): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  if (!value) {
    return result
  }

  for (const [key, entry] of Object.entries(value)) {
    const id = stringOrNull(entry)
    result[key] = id || null
  }

  return result
}

export function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") {
    return fallback
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    return fallback
  }
}

export async function saveCatalog(catalog: Catalog): Promise<void> {
  await yieldToEventLoop()
  await mkdir(MEDIA_DIR, { recursive: true })
  await yieldToEventLoop()
  writeCatalogToDb(catalog)
  await yieldToEventLoop()
}

export function closeCatalogDb(): void {
  bumpCatalogDbRevision()
  if (!catalogDb) {
    return
  }

  catalogDb.close()
  catalogDb = null
  catalogOrm = null
}

function workflowOrNull(value: unknown): CreationWorkflow | null {
  return parseCreationWorkflow(value)
}

function paramsOrEmpty(value: unknown): CreateParams {
  return paramsFromUnknown(value)
}

function nonNegativeInteger(value: unknown): number {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0
}

function isOrphanFile(value: unknown): value is OrphanFile {
  return parseOrphanFile(value) !== null
}

function isTableInfoRow(value: unknown): value is TableInfoRow {
  return isRecord(value) && typeof value["name"] === "string"
}
