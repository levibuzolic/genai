import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import { asc, desc, eq, or } from "drizzle-orm"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"

import { CATALOG_DB_PATH, MEDIA_DIR } from "./config.ts"
import { isActiveCreationStatus, isTerminalCreationStatus } from "./create-shared.ts"
import {
  catalogMeta,
  catalogSchema,
  creationEvents,
  creationJobs,
  downloadedJobIds,
  mediaItems,
  orphanFiles,
  type CatalogDbSchema,
} from "./db-schema.ts"
import { redactDataUrlFields } from "./redaction.ts"
import { isCatalogItem, isRecord, paramsFromUnknown, recordOrNull, stringOrNull } from "./refinements.ts"
import { parseCreationWorkflow, parseOrphanFile } from "./schemas.ts"
import type { Catalog, CatalogItem, CreateParams, CreationEventOptions, CreationJob, CreationWorkflow, OrphanFile } from "./types.ts"

type TableInfoRow = {
  name: string
}

type CreationJobRow = typeof creationJobs.$inferSelect
type CreationJobInsert = typeof creationJobs.$inferInsert

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

export function listCatalogItemsByTemplate(templateId: string, limit = 6): CatalogItem[] {
  return getCatalogOrm()
    .select({ itemJson: mediaItems.itemJson })
    .from(mediaItems)
    .orderBy(desc(mediaItems.createdAt), mediaItems.id)
    .all()
    .map((row) => parseJson(row.itemJson, null))
    .filter((item): item is CatalogItem => isCatalogItem(item) && item.templateId === templateId)
    .slice(0, limit)
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
      upsertCatalogMeta(tx, "updatedAt", normalized.updatedAt || null)
      upsertCatalogMeta(tx, "lastRun", normalized.lastRun || null)
    },
    { behavior: "immediate" },
  )
}

export function readCatalogMeta(key: string): unknown {
  const row = getCatalogOrm().select({ valueJson: catalogMeta.valueJson }).from(catalogMeta).where(eq(catalogMeta.key, key)).get()
  return row ? parseJson(row.valueJson, null) : null
}

export function writeCatalogMeta(key: string, value: unknown): void {
  upsertCatalogMeta(getCatalogOrm(), key, value)
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

function creationJobToInsert(creation: CreationJob): CreationJobInsert {
  return {
    id: creation.id,
    jobId: creation.jobId,
    status: creation.status,
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
    jobId: row.jobId,
    status: row.status,
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
