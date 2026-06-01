import { asc, desc } from "drizzle-orm"
import { customType, index, sqliteTable } from "drizzle-orm/sqlite-core"

const looseInteger = customType<{ data: string | number; driverData: string | number }>({
  dataType: () => "integer",
})

export const catalogMeta = sqliteTable("catalog_meta", ({ text }) => ({
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
}))

export const mediaItems = sqliteTable(
  "media_items",
  ({ integer, text }) => ({
    id: text("id").primaryKey(),
    itemJson: text("item_json").notNull(),
    createdAt: integer("created_at"),
    updatedAt: text("updated_at"),
  }),
  (table) => [index("media_items_created_at_idx").on(desc(table.createdAt))],
)

export const downloadedJobIds = sqliteTable("downloaded_job_ids", ({ integer, text }) => ({
  id: text("id").primaryKey(),
  position: integer("position").notNull(),
}))

export const orphanFiles = sqliteTable("orphan_files", ({ text }) => ({
  localFile: text("local_file").primaryKey(),
  fileJson: text("file_json").notNull(),
}))

export const creationJobs = sqliteTable(
  "creation_jobs",
  ({ text }) => ({
    id: text("id").primaryKey(),
    accountEmail: text("account_email"),
    jobId: text("job_id").unique(),
    status: text("status").notNull(),
    modeId: text("mode_id"),
    modeLabel: text("mode_label"),
    mediaType: text("media_type"),
    templateId: text("template_id"),
    templateLabel: text("template_label"),
    sourceJson: text("source_json"),
    paramsJson: text("params_json"),
    requestJson: text("request_json"),
    requestBodyJson: text("request_body_json"),
    workflowJson: text("workflow_json"),
    responseJson: text("response_json"),
    jobJson: text("job_json"),
    error: text("error"),
    inputUrl: text("input_url"),
    outputUrl: text("output_url"),
    externalTaskId: text("external_task_id"),
    createdAt: looseInteger("created_at"),
    createdAtIso: text("created_at_iso"),
    createdLocallyAt: text("created_locally_at"),
    submittedAt: text("submitted_at"),
    updatedAt: text("updated_at"),
    finishedAt: text("finished_at"),
    downloadedItemId: text("downloaded_item_id"),
  }),
  (table) => [
    index("creation_jobs_status_idx").on(table.status, desc(table.updatedAt)),
    index("creation_jobs_job_id_idx").on(table.jobId),
    index("creation_jobs_account_email_idx").on(table.accountEmail),
  ],
)

export const creationEvents = sqliteTable(
  "creation_events",
  ({ integer, text }) => ({
    id: integer("id").primaryKey({ autoIncrement: true }),
    creationId: text("creation_id").notNull(),
    status: text("status").notNull(),
    message: text("message"),
    eventJson: text("event_json"),
    createdAt: text("created_at").notNull(),
  }),
  (table) => [index("creation_events_creation_id_idx").on(table.creationId, asc(table.id))],
)

export const catalogSchema = {
  catalogMeta,
  creationEvents,
  creationJobs,
  downloadedJobIds,
  mediaItems,
  orphanFiles,
} as const

export type CatalogDbSchema = typeof catalogSchema
