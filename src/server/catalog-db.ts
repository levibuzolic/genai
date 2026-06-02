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

type CatalogOrm = NodeSQLiteDatabase<CatalogDbSchema>
type PlayboxCollectionRow = typeof playboxCollections.$inferSelect
type PlayboxAssetRow = typeof playboxAssets.$inferSelect
type PlayboxCollectionInsert = typeof playboxCollections.$inferInsert
type PlayboxAssetInsert = typeof playboxAssets.$inferInsert

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
      queue_not_before TEXT,
      queue_attempt INTEGER,
      last_rate_limited_at TEXT,
      mode_id TEXT,
      mode_label TEXT,
      media_type TEXT,
      template_id TEXT,
      template_label TEXT,
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
  ensureCatalogColumn(db, "creation_jobs", "template_id", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "template_label", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "workflow_json", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "account_email", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "queue_not_before", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "queue_attempt", "INTEGER")
  ensureCatalogColumn(db, "creation_jobs", "last_rate_limited_at", "TEXT")
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
  const items = new Map<string, CatalogItem>()

  for (const prompt of promptSet) {
    const pattern = `%${escapeSqliteLike(`"prompt":${JSON.stringify(prompt)}`)}%`
    const rows = db
      .prepare("SELECT item_json AS itemJson FROM media_items WHERE item_json LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id LIMIT ?")
      .all(pattern, limit) as { itemJson: string }[]

    for (const row of rows) {
      const item = parseJson(row.itemJson, null)
      if (!isCatalogItem(item) || !promptSet.has(normalizePromptLink(item.prompt))) continue
      items.set(item.id, item)
    }
  }

  return [...items.values()].toSorted((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, limit)
}

function normalizePromptLink(prompt: unknown): string {
  return String(prompt || "").trim()
}

function escapeSqliteLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
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
          createdAt: Number(item.createdAt || 0),
          updatedAt: item.updatedAt || null,
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
    sourceJson: creationJobs.sourceJson,
    paramsJson: creationJobs.paramsJson,
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
      source: parseJson(row.sourceJson, null),
      params: parseJson(row.paramsJson, {}),
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

  return publicCreation
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
