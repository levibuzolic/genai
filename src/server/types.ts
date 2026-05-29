import type http from "node:http"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type MutableJsonObject = { [key: string]: JsonValue | undefined }

export type ApiHeaders = Record<string, string>

export type HttpRequest = http.IncomingMessage
export type HttpResponse = http.ServerResponse

export type AppError = Error & {
  statusCode?: number
}

export type GeneratePornJob = {
  id: string
  user_id?: string | null | undefined
  userId?: string | null | undefined
  type?: string | null | undefined
  prompt?: string | null | undefined
  negative_prompt?: string | null | undefined
  negativePrompt?: string | null | undefined
  status?: string | null | undefined
  output_url?: string | null | undefined
  outputUrl?: string | null | undefined
  input_url?: string | null | undefined
  inputUrl?: string | null | undefined
  duration?: string | number | null | undefined
  resolution?: string | null | undefined
  seed?: string | number | null | undefined
  created_at?: string | number | null | undefined
  createdAt?: string | number | null | undefined
  external_task_id?: string | null | undefined
  externalTaskId?: string | null | undefined
  shared?: boolean | null | undefined
  favorited?: boolean | null | undefined
  error?: string | null | undefined
  job_id?: string | undefined
  [key: string]: unknown
}

export type NormalizedJob = GeneratePornJob & {
  output_url: string
  created_at?: string | number | null | undefined
  user_id?: string | null | undefined
  negative_prompt?: string | null | undefined
  input_url?: string | null | undefined
  external_task_id?: string | null | undefined
}

export type CatalogItem = {
  id: string
  userId?: string | null | undefined
  type?: string | null | undefined
  prompt?: string | null | undefined
  negativePrompt?: string | null | undefined
  status?: string | null | undefined
  outputUrl?: string | null | undefined
  inputUrl?: string | null | undefined
  duration?: number | null | undefined
  createdAt?: string | number | null | undefined
  createdAtIso?: string | null | undefined
  externalTaskId?: string | null | undefined
  shared?: boolean | null | undefined
  favorited?: boolean | null | undefined
  error?: string | null | undefined
  updatedAt?: string | null | undefined
  localFile?: string | null | undefined
  size?: number | null | undefined
  fileSize?: number | null | undefined
  sha256?: string | null | undefined
  verifiedAt?: string | null | undefined
  contentType?: string | null | undefined
  downloadedAt?: string | null | undefined
  downloadError?: string | null | undefined
  thumbnailFile?: string | null | undefined
  thumbnailGeneratedAt?: string | null | undefined
  thumbnailError?: string | null | undefined
  duplicateOf?: string | null | undefined
  duplicateGroupSize?: number | null | undefined
  createModeId?: string | null | undefined
  templateId?: string | null | undefined
  templateLabel?: string | null | undefined
  sourceKind?: string | null | undefined
  sourceItemId?: string | null | undefined
  sourceUrl?: string | null | undefined
  createdLocallyAt?: string | null | undefined
  [key: string]: unknown
}

export type OrphanFile = {
  localFile: string
  size: number
  fileSize?: number | undefined
  contentType: string
  sha256: string
  discoveredAt: string
}

export type SyncError = {
  id?: string
  message: string
}

export type Catalog = {
  items: CatalogItem[]
  downloadedJobIds: string[]
  orphanFiles: OrphanFile[]
  lastSeenJobId: string | null
  updatedAt: string | null
  lastRun: Record<string, unknown> | null
}

export type LocalMediaFile = {
  absolutePath: string
  localFile: string
  size: number
  contentType: string
  downloadedAt: string
}

export type ThumbnailPatch = {
  thumbnailFile?: string | null
  thumbnailGeneratedAt?: string | null
  thumbnailError?: string | null
}

export type CreateSource =
  | { kind: "url"; url?: string }
  | { kind: "upload"; dataUrl?: string }
  | { kind: "catalog"; itemId?: string }
  | { kind: string; [key: string]: unknown }

export type ResolvedCreateSource = {
  value: string
  isDataUrl: boolean
  publicSource: Record<string, unknown>
}

export type CreateParams = Record<string, string | number | boolean | null | undefined>

export type CreateMode = {
  id: string
  label: string
  kind: string
  mediaType?: "image" | "video" | string
  endpoint: "edit" | "video" | string
  source?: {
    required: boolean
    acceptedKinds: string[]
  }
  fields: Record<string, unknown>[]
  defaults?: CreateParams
  fixed?: CreateParams & {
    prompt?: string
    negativePrompt?: string
    negative_prompt?: string
    resolution?: string
    duration?: number | string
  }
  disabled?: boolean
  disabledReason?: string
  seedJobId?: string | null
  templateId?: string | null
}

export type TemplateSettings = {
  modeId: string
  source?: Record<string, unknown> | null | undefined
  params: CreateParams
}

export type CreateTemplate = {
  id: string
  label: string
  description: string
  type: "image" | "video" | "combo"
  settings: TemplateSettings
  workflow: TemplateSettings[]
  prompt: string
  negativePrompt: string
  resolution: string
  duration: number
  sourcePolicy: string
  seedJobId: string | null
  sourceCreationId: string | null
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export type CreateTemplateRegistry = {
  templates: CreateTemplate[]
  updatedAt: string | null
}

export type CreationWorkflowJob = {
  stepIndex: number
  jobId: string
  modeId?: string | null | undefined
  status?: string | null | undefined
}

export type CreationWorkflow = {
  templateId?: string | null | undefined
  currentStep: number
  activeJobId: string | null
  steps: TemplateSettings[]
  jobs: CreationWorkflowJob[]
  overrides: CreateParams
}

export type CreationJob = {
  id: string
  jobId: string | null
  status: string
  modeId: string | null
  modeLabel: string | null
  mediaType: string | null
  templateId: string | null
  templateLabel: string | null
  source: Record<string, unknown> | null
  params: CreateParams
  request: Record<string, unknown> | null
  requestBody: Record<string, unknown> | null
  workflow: CreationWorkflow | null
  response: Record<string, unknown> | null
  job: Record<string, unknown> | null
  error: string | null
  inputUrl: string | null
  outputUrl: string | null
  externalTaskId: string | null
  createdAt: string | number | null
  createdAtIso: string | null
  createdLocallyAt: string
  submittedAt: string | null
  updatedAt: string
  finishedAt: string | null
  downloadedItemId: string | null
}

export type CreationEventOptions = {
  eventStatus?: string | null
  eventMessage?: string | undefined
  eventData?: unknown
}
