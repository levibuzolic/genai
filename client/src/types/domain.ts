export type Config = {
  mediaDir: string
  hasCookie: boolean
  hasAuthorization: boolean
  authorizationExpiresAt: string | null
  authorizationSource: string | null
  authBrowser?: AuthBrowserStatus
  autoSync?: AutoSyncStatus
  thumbnailDir: string
  pageLimit: number
}

export type AuthBrowserStatus = {
  status: string
  message: string
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

export type CatalogItem = {
  id: string
  type?: string
  status?: string
  prompt?: string
  negativePrompt?: string
  outputUrl?: string
  localFile?: string
  thumbnailFile?: string
  posterUrl?: string
  size?: number
  duration?: number
  createdAt?: number
  createdAtIso?: string
  downloadedAt?: string
  downloadError?: string
  favorited?: boolean
  sha256?: string
  verifiedAt?: string
  duplicateOf?: string
  duplicateGroupSize?: number
  contentType?: string
  externalTaskId?: string
  createModeId?: string
  templateId?: string | null
  templateLabel?: string | null
  sourceKind?: string
  sourceItemId?: string
  sourceUrl?: string
  createdLocallyAt?: string
}

export type MediaFacetCounts = Partial<Record<"all" | "image" | "video", number>>
export type StatusFacetCounts = Partial<
  Record<"all" | "downloaded" | "missing" | "error" | "duplicate" | "unverified" | "favorited", number>
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
  catalogUpdatedAt?: string
  lastSeenJobId?: string
  lastRun?: Record<string, unknown> | null
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

export type CreateField = {
  name: string
  label: string
  required?: boolean
  default?: string
  options?: Array<{ label: string; value: string }>
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
  fields?: CreateField[]
  acceptedKinds?: string[]
}

export type CreateTemplateType = "image" | "video" | "combo"

export type CreateTemplateSettings = {
  modeId: string
  source?: CreationSource | null
  params: Record<string, string>
}

export type CreateTemplateStep = {
  modeId: string
  params: Record<string, string>
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
  type?: string
  status?: string
  prompt?: string
  outputUrl?: string
  resolution?: string
  duration?: number
  error?: string
}

export type CreationSource =
  | { kind: "catalog"; itemId?: string; url?: string; contentType?: string; size?: number }
  | { kind: "upload"; contentType?: string; size?: number }
  | { kind: "url"; url?: string }
  | { kind: string; [key: string]: unknown }

export type Creation = {
  id: string
  jobId?: string | null
  status: string
  modeId?: string | null
  modeLabel?: string | null
  mediaType?: "image" | "video" | string | null
  templateId?: string | null
  templateLabel?: string | null
  source?: CreationSource | null
  params?: Record<string, string>
  error?: string | null
  inputUrl?: string | null
  outputUrl?: string | null
  externalTaskId?: string | null
  createdAt?: number | null
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
  data?: Record<string, unknown> | null
  createdAt: string
}

export type CreationsResponse = {
  creations: Creation[]
  activeCount: number
  total: number
  pollMs: number
}

export type Backup = {
  file: string
  createdAt?: string
  reason?: string
  itemCount?: number
  size?: number
}

export type ViewMode = "grid" | "list"
export type SourceKind = "catalog" | "upload" | "url"
export type UploadSource = "picker" | "drop" | "paste"
