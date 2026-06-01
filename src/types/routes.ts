import type { CreateMode, CreateSource, CreationJob, CreateParams } from "./domain.ts"

export type OkResponse = {
  ok: true
}

export type ErrorResponse = {
  error: string
}

export type AppDomainResponse<T> = T | ErrorResponse

export type AppRouteRequest<T = Record<string, unknown>> = T
export type AppRouteResponse<T> = AppDomainResponse<T>

export type PublicCatalogItem = {
  id: string
  accountEmail?: string | null
  provider?: string | null
  collectionId?: string | null
  assetId?: string | null
  assetKind?: string | null
  userId?: string | null
  type?: string | null
  prompt?: string | null
  negativePrompt?: string | null
  status?: string | null
  outputUrl?: string | null
  inputUrl?: string | null
  duration?: number | null
  timeToGenerateMs?: number | null
  createdAt?: string | number | null
  createdAtIso?: string | null
  externalTaskId?: string | null
  modelId?: string | null
  model_id?: string | null
  shared?: boolean | null
  favorited?: boolean | null
  error?: string | null
  updatedAt?: string | null
  localFile?: string | null
  size?: number | null
  fileSize?: number | null
  sha256?: string | null
  verifiedAt?: string | null
  contentType?: string | null
  downloadedAt?: string | null
  downloadError?: string | null
  thumbnailFile?: string | null
  thumbnailGeneratedAt?: string | null
  thumbnailError?: string | null
  duplicateOf?: string | null
  duplicateGroupSize?: number | null
  createModeId?: string | null
  createParams?: CreateParams | null
  templateId?: string | null
  templateLabel?: string | null
  sourceKind?: string | null
  sourceItemId?: string | null
  sourceUrl?: string | null
  createdLocallyAt?: string | null
  remoteDeletedAt?: string | null
  remoteDeleteStatus?: string | null
  posterUrl: string | null
}

export type PublicTemplateSettings = {
  modeId: string
  source: CreateSource | null
  params: CreateParams
}

export type PublicCreateTemplate = {
  id: string
  label: string
  description: string
  type: "image" | "video" | "combo" | "nudify-video"
  settings: PublicTemplateSettings
  workflow: PublicTemplateSettings[]
  prompt: string
  negativePrompt: string
  resolution: string
  duration: number
  sourcePolicy: string
  seedJobId: string | null
  sourceCreationId: string | null
  createdAt: string
  updatedAt: string
}

export type ItemsResponse = {
  items: PublicCatalogItem[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  facets: {
    media?: Partial<Record<"all" | "image" | "video", number>>
    orphanFiles?: number
    status?: Partial<Record<"all" | "downloaded" | "missing" | "error" | "duplicate" | "unverified" | "favorited" | "deleted", number>>
  }
  catalogUpdatedAt: string | null
  lastSeenJobId: string | null
  lastRun: Record<string, unknown> | null
}

export type CatalogItemResponse = {
  item: PublicCatalogItem
}

export type DeleteCatalogItemRequest = {
  keepLocalFiles?: boolean
}

export type DeleteCatalogItemResponse = OkResponse & {
  id: string
  item: PublicCatalogItem | null
  keepLocalFiles: boolean
  deletedLocalFiles: string[]
  remoteStatus: "deleted" | "already-deleted" | "previously-deleted"
}

export type FavoriteCatalogItemResponse = OkResponse & {
  id: string
  item: PublicCatalogItem
  favorited: boolean
}

export type CreateModesResponse = {
  modes: CreateMode[]
  templates: PublicCreateTemplate[]
  pollMs: number
  uploadAccept: string
}

export type CreateTemplatesResponse = {
  templates: Array<PublicCreateTemplate & { previews: PublicCatalogItem[] }>
  updatedAt: string | null
}

export type CreateTemplateMutationResponse = OkResponse & {
  template: PublicCreateTemplate & { previews: PublicCatalogItem[] }
}

export type DeleteCreateTemplateResponse = OkResponse & {
  id: string
}

export type ImportCreateTemplateResponse = OkResponse & {
  template: PublicCreateTemplate
}

export type CreateJobSubmitRequest = {
  accountEmail?: string | null
  modeId?: string
  params?: CreateParams
  queue?: boolean
  source?: CreateSource | null
  templateId?: string
}

export type CreateJobSubmitResponse = OkResponse & {
  jobId: string
  accountEmail?: string | null
  error?: string | null
  queueNotBefore?: string | null
  queued?: boolean
  rateLimited?: boolean
  modeId: string
  modeLabel: string
  pollMs: number
  request: Record<string, unknown>
  source: Record<string, unknown>
  templateId?: string
}

export type PublicCreateJob = {
  id: string
  accountEmail?: string | null
  type: string | null
  inputUrl: string | null
  prompt: string
  negativePrompt: string
  resolution: string | null
  duration: string | number | null
  seed: string | number | null
  externalTaskId: string | null
  modelId: string | null
  outputUrl: string | null
  status: string | null
  error: string | null
  createdAt: string | number | null
  createdAtIso: string | null
}

export type CreateJobPollResponse = {
  job: PublicCreateJob
  createState: PublicCreation | null
  pollMs: number
}

export type DownloadCreateJobResponse = OkResponse & {
  item: PublicCatalogItem
}

export type PublicCreation = Omit<CreationJob, "requestBody" | "source" | "request" | "response" | "job" | "workflow"> & {
  accountEmail: string | null
  source: CreateSource | null
  active: boolean
  request?: Record<string, unknown> | null
  response?: Record<string, unknown> | null
  job?: Record<string, unknown> | null
  workflow?: CreationJob["workflow"]
}

export type CreationEvent = {
  id: number
  status: string
  message: string | null
  data: unknown
  createdAt: string
}

export type CreationsResponse = {
  creations: PublicCreation[]
  activeCount: number
  total: number
  pollMs: number
}

export type CreationDetailsResponse = {
  creation: PublicCreation
  events: CreationEvent[]
}

export type DuplicateCreationResponse = OkResponse & {
  draft: PublicCreation
  form: {
    modeId?: string | null
    params?: CreateParams
    source?: CreateSource | null
    templateId?: string | null
  }
}

export type RefreshCreationsResponse = OkResponse &
  CreationsResponse & {
    imported: number
    refreshed: number
  }

export type BackupSummary = {
  catalogUpdatedAt: unknown
  createdAt: string
  file: string
  itemCount: number | null
  reason: string
  size: number
}

export type CatalogBackupsResponse = {
  backups: BackupSummary[]
}

export type CatalogBackupResponse = OkResponse & {
  backup: BackupSummary | null
}

export type CatalogRestoreResponse = OkResponse & {
  restored: BackupSummary
}
