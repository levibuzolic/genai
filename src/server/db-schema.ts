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
    accountEmail: text("account_email"),
    provider: text("provider").notNull().default("generateporn"),
    collectionId: text("collection_id"),
    assetId: text("asset_id"),
    assetKind: text("asset_kind"),
    userId: text("user_id"),
    type: text("type"),
    mediaKind: text("media_kind").notNull().default("unknown"),
    status: text("status"),
    prompt: text("prompt"),
    negativePrompt: text("negative_prompt"),
    searchText: text("search_text"),
    localFile: text("local_file"),
    outputUrl: text("output_url"),
    inputUrl: text("input_url"),
    downloadError: text("download_error"),
    remoteDeletedAt: text("remote_deleted_at"),
    remoteDeleteStatus: text("remote_delete_status"),
    size: integer("size"),
    fileSize: integer("file_size"),
    duration: integer("duration"),
    timeToGenerateMs: integer("time_to_generate_ms"),
    duplicateGroupSize: integer("duplicate_group_size"),
    hasLocalFile: integer("has_local_file").notNull().default(0),
    hasOutputUrl: integer("has_output_url").notNull().default(0),
    hasDownloadError: integer("has_download_error").notNull().default(0),
    isDeleted: integer("is_deleted").notNull().default(0),
    isMissing: integer("is_missing").notNull().default(0),
    isFavorited: integer("is_favorited").notNull().default(0),
    shared: integer("shared"),
    favorited: integer("favorited"),
    isDuplicate: integer("is_duplicate").notNull().default(0),
    isUnverified: integer("is_unverified").notNull().default(0),
    isImage: integer("is_image").notNull().default(0),
    isVideo: integer("is_video").notNull().default(0),
    externalTaskId: text("external_task_id"),
    modelId: text("model_id"),
    error: text("error"),
    sha256: text("sha256"),
    verifiedAt: text("verified_at"),
    contentType: text("content_type"),
    downloadedAt: text("downloaded_at"),
    thumbnailFile: text("thumbnail_file"),
    thumbnailGeneratedAt: text("thumbnail_generated_at"),
    thumbnailError: text("thumbnail_error"),
    duplicateOf: text("duplicate_of"),
    createModeId: text("create_mode_id"),
    createParamsJson: text("create_params_json"),
    templateId: text("template_id"),
    templateLabel: text("template_label"),
    sourceKind: text("source_kind"),
    sourceItemId: text("source_item_id"),
    sourceUrl: text("source_url"),
    renderStartedAt: integer("render_started_at"),
    failureObservedAt: integer("failure_observed_at"),
    createdAt: integer("created_at"),
    createdAtValue: text("created_at_value"),
    createdAtIso: text("created_at_iso"),
    createdLocallyAt: text("created_locally_at"),
    lastPolledAt: looseInteger("last_polled_at"),
    updatedAt: text("updated_at"),
  }),
  (table) => [
    index("media_items_created_at_idx").on(desc(table.createdAt)),
    index("media_items_provider_created_at_idx").on(table.provider, desc(table.createdAt)),
    index("media_items_media_kind_created_at_idx").on(table.mediaKind, desc(table.createdAt)),
    index("media_items_status_created_at_idx").on(table.status, desc(table.createdAt)),
    index("media_items_prompt_created_at_idx").on(table.prompt, desc(table.createdAt)),
    index("media_items_size_idx").on(table.size),
  ],
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
    queueNotBefore: text("queue_not_before"),
    queueAttempt: looseInteger("queue_attempt"),
    lastRateLimitedAt: text("last_rate_limited_at"),
    modeId: text("mode_id"),
    modeLabel: text("mode_label"),
    mediaType: text("media_type"),
    templateId: text("template_id"),
    templateLabel: text("template_label"),
    sourceKind: text("source_kind"),
    sourceItemId: text("source_item_id"),
    sourceUrl: text("source_url"),
    prompt: text("prompt"),
    negativePrompt: text("negative_prompt"),
    modelId: text("model_id"),
    quality: text("quality"),
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
    index("creation_jobs_prompt_idx").on(table.prompt),
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

export const playboxCollections = sqliteTable(
  "playbox_collections",
  ({ text }) => ({
    id: text("id").primaryKey(),
    accountId: text("account_id"),
    name: text("name"),
    status: text("status"),
    modelId: text("model_id"),
    modelName: text("model_name"),
    modelType: text("model_type"),
    outputType: text("output_type"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    collectionJson: text("collection_json").notNull(),
  }),
  (table) => [index("playbox_collections_created_at_idx").on(desc(table.createdAt))],
)

export const playboxAssets = sqliteTable(
  "playbox_assets",
  ({ integer, text }) => ({
    id: text("id").primaryKey(),
    collectionId: text("collection_id").notNull(),
    kind: text("kind").notNull(),
    remoteUrlBase: text("remote_url_base"),
    remoteUrlExpiresAt: text("remote_url_expires_at"),
    contentType: text("content_type"),
    localFile: text("local_file"),
    size: integer("size"),
    sha256: text("sha256"),
    downloadedAt: text("downloaded_at"),
    downloadError: text("download_error"),
  }),
  (table) => [index("playbox_assets_collection_id_idx").on(table.collectionId), index("playbox_assets_kind_idx").on(table.kind)],
)

export const catalogSchema = {
  catalogMeta,
  creationEvents,
  creationJobs,
  downloadedJobIds,
  mediaItems,
  orphanFiles,
  playboxAssets,
  playboxCollections,
} as const

export type CatalogDbSchema = typeof catalogSchema
