export type Config = {
  mediaDir: string
  hasCookie: boolean
  hasAuthorization: boolean
  authorizationExpiresAt: string | null
  authorizationSource: string | null
  authBrowser?: AuthBrowserStatus
  playbox?: PlayboxAuthStatus
  authAccounts?: AuthAccountStatus[]
  defaultAccountEmail?: string | null
  mediaGenerationConcurrencyLimit?: number
  pendingGenerationsByAccount?: Record<string, number>
  backgroundWorkers?: Record<string, BackgroundWorkerStatus>
  autoSync?: AutoSyncStatus
  thumbnailDir: string
  pageLimit: number
}

export type AuthBrowserStatus = {
  status: string
  message: string
  email?: string | null
  expiresAt: string | null
  lastRefreshAt: string | null
  nextRefreshAt: string | null
  lastError: string | null
  mode: string | null
  profileDir: string
  loginUrl: string
  hasProfile: boolean
  browserOpen: boolean
}

export type AuthAccountStatus = {
  email: string
  isDefault?: boolean
  hasAuthorization: boolean
  authorizationExpiresAt: string | null
  authorizationSource: string | null
  authBrowser: AuthBrowserStatus
}

export type PlayboxAuthStatus = {
  hasAuthorization: boolean
  authorizationExpiresAt: string | null
  authorizationSource: string | null
  email?: string | null
  importedSession?: PlayboxImportedAuthStatus
}

export type PlayboxImportedAuthStatus = {
  hasSession: boolean
  path: string
  cookieCount: number
  email: string | null
  sourceUrl: string | null
  userAgent: string | null
  lastValidatedAt: string | null
  lastRefreshAt: string | null
  lastError: string | null
}

export type AutoSyncStatus = {
  enabled: boolean
  intervalMs: number
  startupDelayMs: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastSkippedAt: string | null
  lastSkipReason: string | null
  lastError: string | null
  lastReason: string | null
  timerActive: boolean
}

export type BackgroundWorkerStatus = {
  id: string
  label: string
  enabled: boolean
  running: boolean
  intervalMs: number | null
  startupDelayMs: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastFinishedAt: string | null
  lastError: string | null
  lastReason: string | null
  lastResult: Record<string, unknown> | null
  runCount: number
  skippedCount: number
  timerActive: boolean
}

export type CatalogItem = {
  id: string
  accountEmail?: string | null
  provider?: string | null
  collectionId?: string | null
  assetId?: string | null
  assetKind?: string | null
  type?: string | null
  status?: string | null
  prompt?: string | null
  negativePrompt?: string | null
  outputUrl?: string | null
  inputUrl?: string | null
  localFile?: string | null
  thumbnailFile?: string | null
  modelId?: string | null
  model_id?: string | null
  timeToGenerateMs?: number | null
  posterUrl?: string | null
  size?: number | null
  duration?: number | null
  createdAt?: string | number | null
  createdAtIso?: string | null
  updatedAt?: string | null
  downloadedAt?: string | null
  downloadError?: string | null
  favorited?: boolean | null
  sha256?: string | null
  verifiedAt?: string | null
  duplicateOf?: string | null
  duplicateGroupSize?: number | null
  contentType?: string | null
  externalTaskId?: string | null
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
}

export type MediaFacetCounts = Partial<Record<"all" | "image" | "video", number>>
export type StatusFacetCounts = Partial<
  Record<"all" | "downloaded" | "missing" | "error" | "duplicate" | "unverified" | "favorited" | "deleted", number>
>

export type Facets = {
  media?: MediaFacetCounts
  status?: StatusFacetCounts
  orphanFiles?: number
}

export type ItemsResponse = {
  items: CatalogItem[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  facets: Facets
  catalogUpdatedAt?: string | null
  lastSeenJobId?: string | null
  lastRun?: Record<string, unknown> | null
}

export type DeleteCatalogItemResponse = {
  ok: true
  id: string
  item: CatalogItem | null
  keepLocalFiles: boolean
  deletedLocalFiles: string[]
  remoteStatus: "deleted" | "already-deleted" | "previously-deleted"
}

export type FavoriteCatalogItemResponse = {
  ok: true
  id: string
  item: CatalogItem
  favorited: boolean
}

export type SyncStatus = {
  running: boolean
  status: string
  mode?: string | null
  currentPage: number
  scanned: number
  downloaded: number
  skipped: number
  errors: string[]
  cancelRequested: boolean
  message: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type CreateFieldOption = {
  label: string
  value: string
  modelId?: string | null
  resolution?: string
  duration?: number
  description?: string
  coinCost?: number
  tier?: string
  protocol?: string
  kind?: string
  audio?: boolean
  fixedDuration?: boolean
}

export type CreateField = {
  name: string
  label: string
  type?: string
  required?: boolean
  default?: string
  options?: CreateFieldOption[]
}

export type CreateMode = {
  id: string
  label: string
  kind?: string
  description?: string
  mediaType?: "image" | "video"
  endpoint?: string
  disabled?: boolean
  disabledReason?: string
  source?: {
    required?: boolean
    acceptedKinds?: string[]
  }
  fields?: CreateField[]
  acceptedKinds?: string[]
}

export type CreateTemplateType = "image" | "video" | "combo" | "nudify-video"
export type CreateParamValue = string | number | boolean | null | undefined
export type CreateParams = Record<string, CreateParamValue>

export type CreateTemplateSettings = {
  modeId: string
  source?: CreationSource | null | undefined
  params: CreateParams
}

export type CreateTemplateStep = {
  modeId: string
  params: CreateParams
}

export type CreateTemplate = {
  id: string
  label: string
  description?: string
  type: CreateTemplateType
  settings: CreateTemplateSettings
  workflow: CreateTemplateStep[]
  prompt?: string
  negativePrompt?: string
  resolution?: string
  duration?: number
  sourcePolicy?: string
  seedJobId?: string | null
  sourceCreationId?: string | null
  createdAt?: string
  updatedAt?: string
  previews?: CatalogItem[]
}

export type CreateTemplatesResponse = {
  templates: CreateTemplate[]
  updatedAt?: string | null
}

export type CreateJob = {
  id: string
  accountEmail?: string | null
  type?: string | null
  status?: string | null
  prompt?: string
  outputUrl?: string | null
  resolution?: string | null
  duration?: string | number | null
  modelId?: string | null
  error?: string | null
}

export type CreationSource =
  | { kind: "catalog"; itemId?: string; url?: string; contentType?: string; size?: number }
  | { kind: "upload"; dataUrl?: string; contentType?: string; size?: number }
  | { kind: "url"; url?: string }
  | { kind: string; [key: string]: unknown }

export type Creation = {
  id: string
  accountEmail?: string | null
  jobId?: string | null
  status: string
  queueNotBefore?: string | null
  queueAttempt?: number
  lastRateLimitedAt?: string | null
  modeId?: string | null
  modeLabel?: string | null
  mediaType?: "image" | "video" | string | null
  templateId?: string | null
  templateLabel?: string | null
  source?: CreationSource | null
  params?: CreateParams
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
  active?: boolean
  request?: Record<string, unknown> | null
  response?: Record<string, unknown> | null
  job?: Record<string, unknown> | null
}

export type CreationEvent = {
  id: number
  status: string
  message?: string | null
  data?: unknown
  createdAt: string
}

export type CreationsResponse = {
  creations: Creation[]
  activeCount: number
  total: number
  queuePaused: boolean
  failedQueuedCount: number
  pollMs: number
}

export type Backup = {
  file: string
  createdAt?: string
  reason?: string
  itemCount?: number | null
  size?: number
}

export type ViewMode = "grid" | "list"
export type MediaFitMode = "fill" | "contain"
export type SourceKind = "catalog" | "upload" | "url"
export type UploadSource = "picker" | "drop" | "paste"
