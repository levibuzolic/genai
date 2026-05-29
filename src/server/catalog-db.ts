import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import { desc, eq } from "drizzle-orm"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"

import { CATALOG_DB_PATH, MEDIA_DIR } from "./config.ts"
import { isActiveCreationStatus, isTerminalCreationStatus } from "./create-shared.ts"
import { catalogMeta, catalogSchema, downloadedJobIds, mediaItems, orphanFiles, type CatalogDbSchema } from "./db-schema.ts"
import { redactDataUrlFields } from "./redaction.ts"
import { isCatalogItem, isRecord, paramsFromUnknown, recordOrNull, stringOrNull } from "./refinements.ts"
import { parseCreationWorkflow, parseOrphanFile } from "./schemas.ts"
import type { Catalog, CreateParams, CreationEventOptions, CreationJob, CreationWorkflow, OrphanFile } from "./types.ts"

type TableInfoRow = {
  name: string
}

type CreationRow = {
  id: string
  job_id: string | null
  status: string
  mode_id: string | null
  mode_label: string | null
  media_type: string | null
  template_id: string | null
  template_label: string | null
  source_json: string | null
  params_json: string | null
  request_json: string | null
  request_body_json: string | null
  workflow_json: string | null
  response_json: string | null
  job_json: string | null
  error: string | null
  input_url: string | null
  output_url: string | null
  external_task_id: string | null
  created_at: string | number | null
  created_at_iso: string | null
  created_locally_at: string | null
  submitted_at: string | null
  updated_at: string | null
  finished_at: string | null
  downloaded_item_id: string | null
}

type CreationEventRow = {
  id: number
  status: string
  message: string | null
  event_json: string | null
  created_at: string
}

type CreationInput = {
  id?: string | null
  jobId?: string | null
  status?: string | null
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
  [key: string]: unknown
}

type PublicCreation = Omit<CreationJob, "requestBody" | "request" | "response" | "job" | "workflow"> & {
  active: boolean
  request?: Record<string, unknown> | null
  response?: Record<string, unknown> | null
  job?: Record<string, unknown> | null
  workflow?: CreationWorkflow | null
}

type CatalogOrm = NodeSQLiteDatabase<CatalogDbSchema>

let catalogDb: DatabaseSync | null = null
let catalogOrm: CatalogOrm | null = null

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
  `)
  ensureCatalogColumn(db, "creation_jobs", "template_id", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "template_label", "TEXT")
  ensureCatalogColumn(db, "creation_jobs", "workflow_json", "TEXT")
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
    updatedAt: stringOrNull(meta.get("updatedAt")),
    lastRun: recordOrNull(meta.get("lastRun")),
  })
}

export function writeCatalogToDb(catalog: Catalog): void {
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

export function readCatalogMeta(key: string): unknown {
  const row = getCatalogOrm().select({ valueJson: catalogMeta.valueJson }).from(catalogMeta).where(eq(catalogMeta.key, key)).get()
  return row ? parseJson(row.valueJson, null) : null
}

export function writeCatalogMeta(key: string, value: unknown): void {
  getCatalogOrm()
    .insert(catalogMeta)
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
  const db = getCatalogDb()

  db.prepare(`
    INSERT INTO creation_jobs (
      id,
      job_id,
      status,
      mode_id,
      mode_label,
      media_type,
      template_id,
      template_label,
      source_json,
      params_json,
      request_json,
      request_body_json,
      workflow_json,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      job_id = excluded.job_id,
      status = excluded.status,
      mode_id = excluded.mode_id,
      mode_label = excluded.mode_label,
      media_type = excluded.media_type,
      template_id = excluded.template_id,
      template_label = excluded.template_label,
      source_json = excluded.source_json,
      params_json = excluded.params_json,
      request_json = excluded.request_json,
      request_body_json = excluded.request_body_json,
      workflow_json = excluded.workflow_json,
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
    next.templateId,
    next.templateLabel,
    stringifyNullable(next.source),
    stringifyNullable(next.params),
    stringifyNullable(next.request),
    stringifyNullable(next.requestBody ? redactDataUrlFields(next.requestBody) : null),
    stringifyNullable(next.workflow),
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

export function moveCreationJob(previousId: string, creation: CreationInput): CreationJob {
  const db = getCatalogDb()
  const existing = findCreationJob(previousId)
  const nextId = stringOrNull(creation.id) || existing?.id || previousId

  if (existing && previousId !== nextId) {
    db.prepare("DELETE FROM creation_jobs WHERE id = ?").run(previousId)
    db.prepare("UPDATE creation_events SET creation_id = ? WHERE creation_id = ?").run(nextId, previousId)
  }

  return saveCreationJob({
    ...existing,
    ...creation,
  })
}

export function addCreationEvent(creationId: string, status: string, message: string | null, data: unknown = null): void {
  getCatalogDb()
    .prepare("INSERT INTO creation_events (creation_id, status, message, event_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(creationId, String(status || "updated"), message || null, stringifyNullable(data), new Date().toISOString())
}

export function findCreationJob(id: string | null | undefined): CreationJob | null {
  if (!id) {
    return null
  }

  const row = getCatalogDb().prepare("SELECT * FROM creation_jobs WHERE id = ? OR job_id = ? LIMIT 1").get(id, id)

  return isCreationRow(row) ? creationJobFromRow(row) : null
}

export function listCreationJobs({ status = "all", limit = 80 }: { status?: string; limit?: number } = {}): CreationJob[] {
  const rows = getCatalogDb()
    .prepare("SELECT * FROM creation_jobs ORDER BY updated_at DESC, created_locally_at DESC LIMIT ?")
    .all(limit)
    .filter(isCreationRow)
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

export function listCreationEvents(
  creationId: string,
): { id: number; status: string; message: string | null; data: unknown; createdAt: string }[] {
  const rows = getCatalogDb()
    .prepare("SELECT id, status, message, event_json, created_at FROM creation_events WHERE creation_id = ? ORDER BY id ASC")
    .all(creationId)
    .filter(isCreationEventRow)

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    message: row.message,
    data: parseJson(row.event_json, null),
    createdAt: row.created_at,
  }))
}

export function normalizeCreationJob(creation: CreationInput = {}): CreationJob {
  const now = new Date().toISOString()

  return {
    id: stringOrNull(creation.id) || stringOrNull(creation.jobId) || `local-${randomUUID()}`,
    jobId: stringOrNull(creation.jobId) || stringOrNull(creation.job_id),
    status: stringOrNull(creation.status) || "draft",
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

function creationJobFromRow(row: CreationRow): CreationJob {
  return normalizeCreationJob({
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    modeId: row.mode_id,
    modeLabel: row.mode_label,
    mediaType: row.media_type,
    templateId: row.template_id,
    templateLabel: row.template_label,
    source: parseJson(row.source_json, null),
    params: parseJson(row.params_json, {}),
    request: parseJson(row.request_json, null),
    requestBody: parseJson(row.request_body_json, null),
    workflow: parseJson(row.workflow_json, null),
    response: parseJson(row.response_json, null),
    job: parseJson(row.job_json, null),
    error: row.error,
    inputUrl: row.input_url,
    outputUrl: row.output_url,
    externalTaskId: row.external_task_id,
    createdAt: row.created_at,
    createdAtIso: row.created_at_iso,
    createdLocallyAt: row.created_locally_at || null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || null,
    finishedAt: row.finished_at,
    downloadedItemId: row.downloaded_item_id,
  })
}

export function toPublicCreation(creation: CreationJob, { details = false }: { details?: boolean } = {}): PublicCreation {
  const publicCreation: PublicCreation = {
    id: creation.id,
    jobId: creation.jobId,
    status: creation.status,
    modeId: creation.modeId,
    modeLabel: creation.modeLabel,
    mediaType: creation.mediaType,
    templateId: creation.templateId,
    templateLabel: creation.templateLabel,
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
    publicCreation.workflow = creation.workflow
  }

  return publicCreation
}

export function stringifyNullable(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

export function normalizeCatalog(catalog: Partial<Catalog> = {}): Catalog {
  return {
    items: Array.isArray(catalog.items) ? catalog.items.filter(isCatalogItem) : [],
    downloadedJobIds: Array.isArray(catalog.downloadedJobIds)
      ? catalog.downloadedJobIds.filter((id): id is string => typeof id === "string")
      : [],
    orphanFiles: Array.isArray(catalog.orphanFiles) ? catalog.orphanFiles.filter(isOrphanFile) : [],
    lastSeenJobId: stringOrNull(catalog.lastSeenJobId),
    updatedAt: stringOrNull(catalog.updatedAt),
    lastRun: recordOrNull(catalog.lastRun),
  }
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
  await mkdir(MEDIA_DIR, { recursive: true })
  writeCatalogToDb(catalog)
}

export function closeCatalogDb(): void {
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

function isOrphanFile(value: unknown): value is OrphanFile {
  return parseOrphanFile(value) !== null
}

function isTableInfoRow(value: unknown): value is TableInfoRow {
  return isRecord(value) && typeof value["name"] === "string"
}

function isCreationRow(value: unknown): value is CreationRow {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["status"] === "string"
}

function isCreationEventRow(value: unknown): value is CreationEventRow {
  return (
    isRecord(value) && typeof value["id"] === "number" && typeof value["status"] === "string" && typeof value["created_at"] === "string"
  )
}
