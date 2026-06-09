import { randomUUID } from "node:crypto"

import type {
  CreateJobPollResponse,
  CreateJobSubmitResponse,
  CreationDetailsResponse,
  CreationQueueControlResponse,
  CreationsResponse,
  DownloadCreateJobResponse,
  DuplicateCreationResponse,
  RefreshCreationsResponse,
  RetryQueuedCreationResponse,
} from "../types/routes.ts"
import { fetchGeneratePornApi, fetchJobsPage, getJobsApiBaseUrl } from "./api-client.ts"
import { getAuthBrowserForAccount, getDefaultAccountEmail, getSyncAccountEmails, hasApiAuth, normalizeAccountEmail } from "./auth-state.ts"
import { scheduleBackgroundJob } from "./background-worker.ts"
import {
  addCreationEvent,
  findCreationJob,
  getPendingCreationCountsByAccount,
  listCreationEvents,
  listCreationJobSummaries,
  listCreationJobs,
  readCatalogMeta,
  saveCreationJob,
  toPublicCreation,
  writeCatalogMeta,
} from "./catalog-db.ts"
import { downloadJob, loadCatalog, saveCatalog, sortItems, toCatalogItem, toPublicCatalogItem } from "./catalog.ts"
import { AUTH_SETUP_MESSAGE, CREATE_HISTORY_PAGE_LIMIT } from "./config.ts"
import { buildCreateApiRequest, resolveCreateSource, toPublicCreateJob, validateCreateSourceUrl } from "./create-api.ts"
import {
  CREATE_IMAGE_ASPECT_RATIO_OPTIONS,
  CREATE_POLL_MS,
  CREATE_VIDEO_DEFAULT_QUALITY,
  CREATE_VIDEO_QUALITY_OPTIONS,
} from "./create-constants.ts"
import { parseCreateApiResponse } from "./create-schemas.ts"
import { getReusableCreationSource, isActiveCreationStatus, isTerminalCreationStatus } from "./create-shared.ts"
import { getCreateModeDefinitions, loadCreateTemplateRegistry, prepareCreateSubmission } from "./create-templates.ts"
import { httpError } from "./errors.ts"
import { readJsonObject, requireCreateSource, stringOrNull } from "./refinements.ts"
import { parseGeneratePornJob } from "./schemas.ts"
import { scheduleMissingThumbnailBackgroundJobForCatalog } from "./sync.ts"
import type {
  CreateMode,
  CreateParams,
  CreationJob,
  CreationWorkflow,
  GeneratePornJob,
  ResolvedCreateSource,
  TemplateSettings,
} from "./types.ts"

export { buildCreateApiRequest, resolveCreateSource }

const DEFAULT_MEDIA_GENERATION_CONCURRENCY_LIMIT = 2
const MEDIA_GENERATION_CONCURRENCY_LIMIT_META_KEY = "mediaGenerationConcurrencyLimit"
const CREATION_QUEUE_PAUSED_META_KEY = "creationQueuePaused"
const QUEUED_CREATION_STATUS = "queued"
const COMPLETED_CREATION_DOWNLOAD_BATCH_SIZE = 25
export const CREATION_QUEUE_BACKGROUND_JOB_ID = "creation-queue"
const RATE_LIMIT_INITIAL_BACKOFF_MS = 60_000
const RATE_LIMIT_MAX_BACKOFF_MS = 60 * 60 * 1000
const queuedRequestBodies = new Map<string, Record<string, unknown>>()
const LEGACY_VIDEO_MODEL_IDS = new Set(["wan2.7-i2v", "wan2.7-i2v-spicy", "wan2.6-i2v-flash", "wan2.2-i2v-plus", "happyhorse-1.0-i2v"])
const LEGACY_TEXT_TO_VIDEO_MODEL_IDS = new Set(["wan2.7-t2v"])
const LEGACY_IMAGE_MODEL_IDS = new Set(["qwen-image-2.0-pro", "qwen-image-2.0", "wan2.7-image-pro", "wan2.7-image", "z-image-turbo"])
const LEGACY_MODEL_IDS = new Set([...LEGACY_VIDEO_MODEL_IDS, ...LEGACY_TEXT_TO_VIDEO_MODEL_IDS, ...LEGACY_IMAGE_MODEL_IDS])

async function createWorkflowJob(
  {
    modes,
    mode,
    template,
    sourceRequest,
    params,
    steps,
  }: Awaited<ReturnType<typeof prepareCreateSubmission>> & {
    mode: CreateMode
    steps: TemplateSettings[]
  },
  {
    requestedAccountEmail,
    attemptId,
    requestStartedAt,
  }: { requestedAccountEmail: string | null; attemptId: string; requestStartedAt: string },
): Promise<CreateJobSubmitResponse> {
  const source = await resolveCreateSource(requireCreateSource(sourceRequest))
  const firstStep = steps[0]
  if (!firstStep) {
    throw new Error("Workflow has no steps.")
  }
  const firstMode = modes.find((entry) => entry.id === firstStep.modeId)

  if (!firstMode || firstMode.disabled) {
    throw new Error("Workflow first step is not available.")
  }

  const liveRequest = buildCreateApiRequest(firstMode, source, firstStep.params || {})
  queuedRequestBodies.set(attemptId, liveRequest.body)
  const accountEmail = resolveCreateAccountEmail(requestedAccountEmail)
  const workflow = {
    templateId: template?.id || null,
    currentStep: 0,
    activeJobId: null,
    steps,
    jobs: [],
    overrides: {},
  }
  const baseRecord = {
    id: attemptId,
    accountEmail,
    status: QUEUED_CREATION_STATUS,
    modeId: mode.id,
    modeLabel: mode.label,
    mediaType: "video",
    templateId: template?.id || mode.templateId || null,
    templateLabel: template?.label || null,
    source: source.publicSource,
    params: params || {},
    request: liveRequest.publicRequest,
    requestBody: liveRequest.body,
    workflow,
    createdLocallyAt: requestStartedAt,
    submittedAt: requestStartedAt,
    updatedAt: requestStartedAt,
  }

  saveCreationJob(baseRecord, {
    eventStatus: QUEUED_CREATION_STATUS,
    eventMessage: "Queued creation workflow.",
  })
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "creation-submitted")

  return queuedCreateResponse(baseRecord, mode, source.publicSource, liveRequest.publicRequest, template?.id)
}

async function submitWorkflowCreation(creation: CreationJob & { workflow: CreationWorkflow }): Promise<CreationJob | null> {
  const firstStep = creation.workflow.steps[0]
  if (!firstStep) {
    throw new Error("Workflow has no steps.")
  }

  const registry = await loadCreateTemplateRegistry()
  const modes = getCreateModeDefinitions(registry.templates)
  const firstMode = modes.find((entry) => entry.id === firstStep.modeId)
  if (!firstMode || firstMode.disabled) {
    throw new Error("Workflow first step is not available.")
  }

  let response: Response
  let body: Record<string, unknown>
  let apiResponse: ReturnType<typeof parseCreateApiResponse>
  try {
    response = await fetchGeneratePornApi(
      `${getJobsApiBaseUrl()}/${firstMode.endpoint}`,
      {
        method: "POST",
        body: JSON.stringify(getQueuedRequestBody(creation)),
      },
      { accountEmail: creation.accountEmail },
    )
    apiResponse = parseCreateApiResponse(await readJsonObject(response))
    body = apiResponse.body
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveCreationJob(
      {
        ...creation,
        status: "error",
        error: message,
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: message,
      },
    )
    throw error
  }

  const jobId = apiResponse.jobId
  if (isRetryableRateLimitCreateResponse(body, apiResponse.error)) {
    return requeueRateLimitedCreation(creation, body, apiResponse.error)
  }

  if (!response.ok || !jobId) {
    const error =
      apiResponse.error ||
      (!jobId ? "Create response did not include a job_id." : `Create request failed: ${response.status} ${response.statusText}`)
    saveCreationJob(
      {
        ...creation,
        status: "error",
        response: body,
        error,
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: error,
        eventData: body,
      },
    )
    throw httpError(error, response.status)
  }

  const workflowCreation = saveCreationJob({
    ...creation,
    jobId,
    response: body,
    queueNotBefore: null,
    queueAttempt: 0,
    lastRateLimitedAt: null,
    workflow: {
      ...creation.workflow,
      activeJobId: jobId,
      jobs: [{ stepIndex: 0, jobId, modeId: firstMode.id }],
    },
    status: "pending",
    updatedAt: new Date().toISOString(),
  })
  queuedRequestBodies.delete(creation.id)
  addCreationEvent(jobId, "pending", "Workflow first step accepted.", body)

  return workflowCreation
}

export async function createMediaJob(requestBody: Record<string, unknown>): Promise<CreateJobSubmitResponse> {
  const attemptId = `local-${randomUUID()}`
  const requestStartedAt = new Date().toISOString()
  const requestedAccountEmail = optionalAccountEmail(requestBody["accountEmail"])

  const submission = await prepareCreateSubmission(requestBody)
  const { mode, sourceRequest, params, template } = submission

  if (!mode) {
    throw new Error("Unknown creation mode.")
  }

  if (mode.disabled) {
    throw new Error(mode.disabledReason || "Creation mode is disabled.")
  }

  const workflowSteps = createWorkflowSteps(mode.id, params, template?.workflow || null)
  if (workflowSteps) {
    return createWorkflowJob(
      {
        ...submission,
        mode,
        steps: workflowSteps,
      },
      {
        requestedAccountEmail,
        attemptId,
        requestStartedAt,
      },
    )
  }

  const source = mode.source?.required === false ? null : await resolveCreateSource(requireCreateSource(sourceRequest))
  const liveRequest = buildCreateApiRequest(mode, source, params)
  queuedRequestBodies.set(attemptId, liveRequest.body)
  const accountEmail = resolveCreateAccountEmail(requestedAccountEmail)
  const baseRecord = {
    id: attemptId,
    accountEmail,
    status: QUEUED_CREATION_STATUS,
    modeId: mode.id,
    modeLabel: mode.label,
    mediaType: mode.mediaType || null,
    templateId: template?.id || mode.templateId || null,
    templateLabel: template?.label || null,
    source: source?.publicSource || null,
    params,
    request: liveRequest.publicRequest,
    requestBody: liveRequest.body,
    createdLocallyAt: requestStartedAt,
    submittedAt: requestStartedAt,
    updatedAt: requestStartedAt,
  }

  saveCreationJob(baseRecord, {
    eventStatus: QUEUED_CREATION_STATUS,
    eventMessage: "Queued creation request.",
  })
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "creation-submitted")

  return queuedCreateResponse(baseRecord, mode, source?.publicSource || {}, liveRequest.publicRequest, template?.id)
}

async function submitDirectCreation(creation: CreationJob): Promise<CreationJob | null> {
  const mode = await findCreateMode(creation.modeId)
  if (!mode || mode.disabled) {
    throw new Error("Creation mode is not available.")
  }

  const url = `${getJobsApiBaseUrl()}/${mode.endpoint}`
  let response: Response
  let body: Record<string, unknown>
  let apiResponse: ReturnType<typeof parseCreateApiResponse>
  try {
    response = await fetchGeneratePornApi(
      url,
      {
        method: "POST",
        body: JSON.stringify(getQueuedRequestBody(creation)),
      },
      { accountEmail: creation.accountEmail },
    )
    apiResponse = parseCreateApiResponse(await readJsonObject(response))
    body = apiResponse.body
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveCreationJob(
      {
        ...creation,
        status: "error",
        error: message,
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: message,
      },
    )
    throw error
  }

  if (!response.ok) {
    const error = apiResponse.error || `Create request failed: ${response.status} ${response.statusText}`
    if (isRetryableRateLimitCreateResponse(body, error)) {
      return requeueRateLimitedCreation(creation, body, error)
    }

    saveCreationJob(
      {
        ...creation,
        status: "error",
        response: body,
        error,
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: error,
        eventData: body,
      },
    )
    throw httpError(error, response.status)
  }

  const jobId = apiResponse.jobId
  if (isRetryableRateLimitCreateResponse(body, apiResponse.error)) {
    return requeueRateLimitedCreation(creation, body, apiResponse.error)
  }

  if (!jobId) {
    saveCreationJob(
      {
        ...creation,
        status: "error",
        response: body,
        error: "Create response did not include a job_id.",
        finishedAt: new Date().toISOString(),
      },
      {
        eventStatus: "error",
        eventMessage: "Create response did not include a job_id.",
        eventData: body,
      },
    )
    throw new Error("Create response did not include a job_id.")
  }

  const submitted = saveCreationJob({
    ...creation,
    jobId,
    response: body,
    queueNotBefore: null,
    queueAttempt: 0,
    lastRateLimitedAt: null,
    status: "pending",
    updatedAt: new Date().toISOString(),
  })
  queuedRequestBodies.delete(creation.id)
  addCreationEvent(jobId, "pending", "Upstream job accepted.", body)

  return submitted
}

function createWorkflowSteps(modeId: string, params: CreateParams, templateWorkflow: TemplateSettings[] | null): TemplateSettings[] | null {
  if (modeId === "custom-image-video") {
    const imageStep = templateWorkflow?.find((step) => step.modeId === "custom-image")
    const videoStep = templateWorkflow?.find((step) => step.modeId === "custom-video")

    return [
      {
        modeId: "custom-image",
        params: {
          ...imageStep?.params,
          prompt: String(imageStep?.params["prompt"] || params["prompt"] || ""),
        },
      },
      {
        modeId: "custom-video",
        params: {
          ...videoStep?.params,
          prompt: String(params["prompt"] || videoStep?.params["prompt"] || ""),
          quality: String(params["quality"] || videoStep?.params["quality"] || ""),
        },
      },
    ]
  }

  if (modeId === "nudify-video") {
    const videoStep = templateWorkflow?.find((step) => step.modeId === "custom-video")

    return [
      {
        modeId: "nudify",
        params: {},
      },
      {
        modeId: "custom-video",
        params: {
          ...videoStep?.params,
          prompt: String(params["prompt"] || videoStep?.params["prompt"] || ""),
          quality: String(params["quality"] || videoStep?.params["quality"] || ""),
        },
      },
    ]
  }

  if (modeId.startsWith("template:") && templateWorkflow?.length) {
    return templateWorkflow.map((step) => ({
      modeId: step.modeId,
      params: {
        ...step.params,
        ...params,
      },
    }))
  }

  return null
}

export function getMediaGenerationConcurrencyLimit(): number {
  const stored = Number(readCatalogMeta(MEDIA_GENERATION_CONCURRENCY_LIMIT_META_KEY))
  if (Number.isInteger(stored) && stored > 0) {
    return stored
  }

  return DEFAULT_MEDIA_GENERATION_CONCURRENCY_LIMIT
}

export function setMediaGenerationConcurrencyLimit(limit: number): { limit: number } {
  const normalized = Math.max(1, Math.min(20, Math.floor(Number(limit) || DEFAULT_MEDIA_GENERATION_CONCURRENCY_LIMIT)))
  writeCatalogMeta(MEDIA_GENERATION_CONCURRENCY_LIMIT_META_KEY, normalized)
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "limit-updated")
  return { limit: normalized }
}

export function getCreationQueuePaused(): boolean {
  return readCatalogMeta(CREATION_QUEUE_PAUSED_META_KEY) === "true"
}

export function setCreationQueuePaused(paused: boolean): CreationQueueControlResponse {
  writeCatalogMeta(CREATION_QUEUE_PAUSED_META_KEY, paused ? "true" : "false")
  if (!paused) {
    scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "queue-resumed")
  }
  return creationQueueControlResponse()
}

export function startCreationQueueProcessing(): void {
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "startup")
}

export async function runCreationQueueBackgroundJob(): Promise<Record<string, unknown>> {
  return processCreationQueues()
}

export function getPendingGenerationCountsByAccount(): Record<string, number> {
  return getPendingCreationCountsByAccount()
}

async function processCreationQueues(accountEmail?: string | null): Promise<Record<string, unknown>> {
  const downloaded = await downloadCompletedCreations()
  if (getCreationQueuePaused()) {
    return {
      accounts: 0,
      dispatched: 0,
      downloaded,
      paused: true,
      queued: countQueuedCreationsForAllAccounts(),
    }
  }
  const accounts = new Set<string>()
  if (accountEmail !== undefined) {
    accounts.add(accountQueueKey(accountEmail))
  } else {
    for (const creation of listCreationJobs({ status: "all", limit: 1000 })) {
      if (creation.status === QUEUED_CREATION_STATUS) {
        accounts.add(accountQueueKey(creation.accountEmail))
      }
    }
  }

  let dispatched = 0
  const results = await Promise.all(
    [...accounts].map((accountKey) => processCreationQueueForAccount(accountKey === "__default__" ? null : accountKey)),
  )
  dispatched = results.reduce((total, count) => total + count, 0)

  scheduleNextQueuedCreationRun()
  return {
    accounts: accounts.size,
    dispatched,
    downloaded,
    queued: countQueuedCreationsForAllAccounts(),
  }
}

async function downloadCompletedCreations(): Promise<number> {
  const downloadable = listCreationJobs({ status: "all", limit: 1000 })
    .filter(isDownloadableCompletedCreation)
    .toSorted(compareDownloadableCreations)
    .slice(0, COMPLETED_CREATION_DOWNLOAD_BATCH_SIZE)

  let downloaded = 0
  for (const creation of downloadable) {
    try {
      await downloadCreateJob(creation.jobId || creation.id)
      downloaded += 1
    } catch {
      // Keep the queue moving; the creation remains downloadable for the next run.
    }
  }

  return downloaded
}

function isDownloadableCompletedCreation(creation: CreationJob): boolean {
  return creation.status === "done" && Boolean(creation.outputUrl) && !creation.downloadedItemId
}

function compareDownloadableCreations(a: CreationJob, b: CreationJob): number {
  return String(b.finishedAt || b.updatedAt || b.createdLocallyAt || "").localeCompare(
    String(a.finishedAt || a.updatedAt || a.createdLocallyAt || ""),
  )
}

async function processCreationQueueForAccount(accountEmail: string | null): Promise<number> {
  const availableSlots = Math.max(0, getMediaGenerationConcurrencyLimit() - countPendingGenerations(accountEmail))
  if (availableSlots === 0) {
    return 0
  }

  const readyQueued = listCreationJobs({ status: "all", limit: 1000 })
    .filter(
      (creation) => creation.status === QUEUED_CREATION_STATUS && accountQueueKey(creation.accountEmail) === accountQueueKey(accountEmail),
    )
    .filter(isQueueReady)
    .toSorted(compareQueuedCreations)
    .slice(0, availableSlots)

  const results = await Promise.all(
    readyQueued.map(async (creation) => {
      try {
        await submitQueuedCreation(creation.id)
        return 1 as number
      } catch {
        return 0 as number
      }
    }),
  )

  return results.reduce((total, count) => total + count, 0)
}

async function submitQueuedCreation(id: string): Promise<CreationJob | null> {
  let creation = findCreationJob(id)
  if (!creation || creation.status !== QUEUED_CREATION_STATUS) {
    return creation
  }

  if (isLegacyQueuedCreation(creation)) {
    creation = (await repairQueuedCreationIfLegacy(creation)) || creation
  }
  await ensureAccountApiAuth(creation.accountEmail)
  const submitting = saveCreationJob(
    {
      ...creation,
      status: "submitted",
      queueNotBefore: null,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      eventStatus: "submitted",
      eventMessage: "Submitting queued creation.",
    },
  )

  const submitted =
    submitting.workflow && submitting.workflow.steps.length > 0
      ? await submitWorkflowCreation({ ...submitting, workflow: submitting.workflow })
      : await submitDirectCreation(submitting)
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "queued-submitted")
  return submitted
}

export async function repairLegacyQueuedCreations(): Promise<{
  ok: true
  inspected: number
  updated: number
  skipped: number
  failed: number
  failures: { id: string; error: string }[]
}> {
  const queued = listCreationJobs({ status: "all", limit: 1000 }).filter((creation) => creation.status === QUEUED_CREATION_STATUS)
  let updated = 0
  let skipped = 0
  const failures: { id: string; error: string }[] = []

  for (const creation of queued) {
    try {
      const repaired = await repairQueuedCreationIfLegacy(creation)
      if (repaired) {
        updated += 1
      } else {
        skipped += 1
      }
    } catch (error) {
      failures.push({
        id: creation.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    ok: true,
    inspected: queued.length,
    updated,
    skipped,
    failed: failures.length,
    failures,
  }
}

export function retryFailedQueuedCreation(id: string): RetryQueuedCreationResponse {
  const creation = findCreationJob(id)
  if (!creation) {
    throw httpError("Creation was not found.", 404)
  }

  if (!isFailedQueuedCreation(creation)) {
    throw httpError("Creation is not in a retryable error state.", 400)
  }

  const saved = requeueFailedCreation(creation)
  if (!getCreationQueuePaused()) {
    scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "failed-queued-retried")
  }

  return {
    ok: true,
    creation: toPublicCreation(saved),
  }
}

async function repairQueuedCreationIfLegacy(creation: CreationJob): Promise<CreationJob | null> {
  const repaired = await buildLegacyQueuedCreationRepair(creation)
  if (!repaired) return null

  const saved = saveCreationJob(repaired, {
    eventStatus: QUEUED_CREATION_STATUS,
    eventMessage: "Mapped queued creation to current GeneratePorn models.",
    eventData: {
      previousModeId: creation.modeId,
      modeId: repaired.modeId,
    },
  })
  queuedRequestBodies.set(saved.id, saved.requestBody || {})
  return saved
}

async function buildLegacyQueuedCreationRepair(creation: CreationJob): Promise<CreationJob | null> {
  if (!isLegacyQueuedCreation(creation)) return null

  const registry = await loadCreateTemplateRegistry()
  const modes = getCreateModeDefinitions(registry.templates)
  const modeId = mapLegacyModeId(creation)
  const mode = modes.find((entry) => entry.id === modeId)
  if (!mode || mode.disabled) {
    throw new Error(`Mapped creation mode is not available: ${modeId}`)
  }

  const params = normalizeLegacyCreateParams(creation.params, modeId)
  const workflow = normalizeLegacyWorkflow(creation.workflow)
  const requestMode = workflow?.steps[0] ? modes.find((entry) => entry.id === workflow.steps[0]?.modeId) : mode
  if (!requestMode || requestMode.disabled) {
    throw new Error("Mapped queued creation request mode is not available.")
  }

  const requestParams = workflow?.steps[0]?.params || params
  const source = await resolveQueuedRepairSource(requestMode, creation)
  const liveRequest = buildCreateApiRequest(requestMode, source, requestParams)
  const now = new Date().toISOString()

  return {
    ...creation,
    modeId: mode.id,
    modeLabel: mode.label,
    mediaType: mode.mediaType || creation.mediaType,
    params,
    request: liveRequest.publicRequest,
    requestBody: liveRequest.body,
    workflow,
    updatedAt: now,
  }
}

function isLegacyQueuedCreation(creation: CreationJob): boolean {
  if (creation.status !== QUEUED_CREATION_STATUS) return false
  if (creation.modeId === "text-to-video") return true
  if (hasLegacyCreateParams(creation.params)) return true
  if (hasLegacyRequestBody(creation.requestBody) || hasLegacyRequestBody(creation.request)) return true
  return Boolean(creation.workflow?.steps.some((step) => hasLegacyCreateParams(step.params) || step.modeId === "text-to-video"))
}

function hasLegacyCreateParams(params: CreateParams = {}): boolean {
  const modelId = stringOrNull(params["modelId"])
  if (modelId && LEGACY_MODEL_IDS.has(modelId)) return true

  const quality = stringOrNull(params["quality"])
  return Boolean(quality && quality.includes(":") && LEGACY_MODEL_IDS.has(quality.split(":")[0] || ""))
}

function hasLegacyRequestBody(body: Record<string, unknown> | null): boolean {
  const modelId = stringOrNull(body?.["modelId"])
  return Boolean(modelId && LEGACY_MODEL_IDS.has(modelId))
}

function mapLegacyModeId(creation: CreationJob): string {
  const modelId =
    stringOrNull(creation.params["modelId"]) ||
    stringOrNull(creation.requestBody?.["modelId"]) ||
    stringOrNull(creation.request?.["modelId"])
  if (creation.modeId === "text-to-video" || (modelId && LEGACY_TEXT_TO_VIDEO_MODEL_IDS.has(modelId) && !creation.source)) {
    return "text-to-image"
  }

  if (creation.modeId) return creation.modeId
  if (modelId && LEGACY_TEXT_TO_VIDEO_MODEL_IDS.has(modelId)) return "text-to-image"
  if (modelId && LEGACY_VIDEO_MODEL_IDS.has(modelId)) return "custom-video"
  return "custom-image"
}

function normalizeLegacyWorkflow(workflow: CreationWorkflow | null): CreationWorkflow | null {
  if (!workflow) return null

  return {
    ...workflow,
    steps: workflow.steps.map((step) => {
      const modeId = step.modeId === "text-to-video" ? "text-to-image" : step.modeId
      return {
        ...step,
        modeId,
        params: normalizeLegacyCreateParams(step.params || {}, modeId),
      }
    }),
  }
}

function normalizeLegacyCreateParams(params: CreateParams = {}, modeId: string): CreateParams {
  const next: CreateParams = {}

  for (const [key, value] of Object.entries(params)) {
    if (key === "modelId") continue
    if (key === "seed" && (value === null || value === "")) continue
    next[key] = value
  }

  if (isVideoModeId(modeId)) {
    next["quality"] = normalizeLegacyVideoQuality(params["quality"])
    delete next["aspectRatio"]
    return next
  }

  if (modeId === "text-to-image") {
    const aspectRatio = normalizeLegacyImageAspectRatio(params["aspectRatio"] || params["quality"])
    delete next["quality"]
    next["aspectRatio"] = aspectRatio
  }

  return next
}

function normalizeLegacyVideoQuality(value: unknown): string {
  const raw = stringOrNull(value)
  const quality = raw?.includes(":") ? raw.split(":").at(-1) || "" : raw || CREATE_VIDEO_DEFAULT_QUALITY
  return CREATE_VIDEO_QUALITY_OPTIONS.some((option) => option.value === quality) ? quality : CREATE_VIDEO_DEFAULT_QUALITY
}

function normalizeLegacyImageAspectRatio(value: unknown): string {
  const raw = stringOrNull(value)
  const aspectRatio = raw || ""
  return CREATE_IMAGE_ASPECT_RATIO_OPTIONS.some((option) => option.value === aspectRatio) ? aspectRatio : "3:4"
}

function isVideoModeId(modeId: string | null): boolean {
  return modeId === "custom-video" || modeId === "custom-image-video" || modeId === "nudify-video"
}

async function resolveQueuedRepairSource(mode: CreateMode, creation: CreationJob): Promise<ResolvedCreateSource | null> {
  if (mode.source?.required === false) return null

  const existingBody = queuedRequestBodies.get(creation.id) || creation.requestBody || creation.request || {}
  const inputUrl = stringOrNull(existingBody["input_url"])
  if (inputUrl) {
    const url = validateCreateSourceUrl(inputUrl)
    return {
      value: url,
      isDataUrl: false,
      publicSource: {
        kind: "url",
        url,
      },
    }
  }

  const imageBase64 = stringOrNull(existingBody["image_base64"])
  if (imageBase64?.startsWith("data:image/")) {
    return {
      value: imageBase64,
      isDataUrl: true,
      publicSource: creation.source?.["kind"]
        ? requireCreateSource(creation.source)
        : {
            kind: "upload",
          },
    }
  }

  if (creation.source?.["kind"] && creation.source["kind"] !== "upload") {
    return resolveCreateSource(requireCreateSource(creation.source))
  }

  throw new Error("Queued creation source cannot be rebuilt. Recreate this upload-based job from the source image.")
}

function countPendingGenerations(accountEmail: string | null): number {
  return listCreationJobs({ status: "all", limit: 1000 }).filter(
    (creation) => accountQueueKey(creation.accountEmail) === accountQueueKey(accountEmail) && isPendingGeneration(creation),
  ).length
}

function countQueuedGenerations(accountEmail: string | null): number {
  return listCreationJobs({ status: "all", limit: 1000 }).filter(
    (creation) => accountQueueKey(creation.accountEmail) === accountQueueKey(accountEmail) && creation.status === QUEUED_CREATION_STATUS,
  ).length
}

function countQueuedCreationsForAllAccounts(): number {
  return listCreationJobs({ status: "all", limit: 1000 }).filter((creation) => creation.status === QUEUED_CREATION_STATUS).length
}

function countFailedQueuedCreations(): number {
  return listCreationJobs({ status: "all", limit: 1000 }).filter(isFailedQueuedCreation).length
}

function creationQueueControlResponse(): CreationQueueControlResponse {
  return {
    ok: true,
    paused: getCreationQueuePaused(),
    queued: countQueuedCreationsForAllAccounts(),
    pending: listCreationJobs({ status: "all", limit: 1000 }).filter((creation) => isPendingGeneration(creation)).length,
    failedQueuedCount: countFailedQueuedCreations(),
  }
}

function isFailedQueuedCreation(creation: CreationJob): boolean {
  const status = creation.status.toLowerCase()
  return (status === "failed" || status === "error") && (creation.id.startsWith("local-") || Boolean(creation.requestBody))
}

function getRetryableQueuedRequestBody(creation: CreationJob): Record<string, unknown> {
  const body = queuedRequestBodies.get(creation.id) || creation.requestBody || {}
  if (Object.keys(body).length === 0) {
    throw new Error("Creation does not have a reusable queued request body.")
  }

  if (body["image_base64"] === "[image data URL omitted]") {
    throw new Error("Uploaded image data was not retained; recreate this job from the source image.")
  }

  return body
}

function requeueFailedCreation(creation: CreationJob): CreationJob {
  const body = getRetryableQueuedRequestBody(creation)
  const now = new Date().toISOString()
  const saved = saveCreationJob(
    {
      ...creation,
      jobId: null,
      status: QUEUED_CREATION_STATUS,
      requestBody: body,
      error: null,
      response: null,
      job: null,
      queueNotBefore: null,
      queueAttempt: 0,
      lastRateLimitedAt: null,
      submittedAt: now,
      updatedAt: now,
      finishedAt: null,
    },
    {
      eventStatus: QUEUED_CREATION_STATUS,
      eventMessage: "Retrying failed queued creation.",
    },
  )
  queuedRequestBodies.set(saved.id, body)
  return saved
}

function resolveCreateAccountEmail(requestedAccountEmail: string | null): string | null {
  if (requestedAccountEmail) {
    return requestedAccountEmail
  }

  const accounts = getSyncAccountEmails()
  if (accounts.length === 0) {
    return null
  }

  const defaultAccountEmail = getDefaultAccountEmail()
  let selected = accounts[0] ?? null
  let selectedLoad = getCreateAccountLoad(selected)

  for (const accountEmail of accounts) {
    const load = getCreateAccountLoad(accountEmail)
    if (
      load < selectedLoad ||
      (load === selectedLoad &&
        accountQueueKey(accountEmail) === accountQueueKey(defaultAccountEmail) &&
        accountQueueKey(selected) !== accountQueueKey(defaultAccountEmail))
    ) {
      selected = accountEmail
      selectedLoad = load
    }
  }

  return selected
}

function getCreateAccountLoad(accountEmail: string | null): number {
  return countPendingGenerations(accountEmail) + countQueuedGenerations(accountEmail)
}

function isPendingGeneration(creation: CreationJob): boolean {
  return Boolean(creation.jobId && isActiveCreationStatus(creation.status))
}

function isQueueReady(creation: CreationJob): boolean {
  if (creation.status !== QUEUED_CREATION_STATUS) return false
  if (!creation.queueNotBefore) return true

  const timestamp = Date.parse(creation.queueNotBefore)
  return !Number.isFinite(timestamp) || timestamp <= Date.now()
}

function compareQueuedCreations(a: CreationJob, b: CreationJob): number {
  const aReadyAt = queueReadyAtMs(a)
  const bReadyAt = queueReadyAtMs(b)
  if (aReadyAt !== bReadyAt) return aReadyAt - bReadyAt

  return String(a.createdLocallyAt || "").localeCompare(String(b.createdLocallyAt || ""))
}

function queueReadyAtMs(creation: CreationJob): number {
  const timestamp = Date.parse(creation.queueNotBefore || "")
  return Number.isFinite(timestamp) ? timestamp : 0
}

function requeueRateLimitedCreation(creation: CreationJob, body: Record<string, unknown>, error: string | null): CreationJob {
  const now = new Date()
  const nextAttempt = Math.max(1, creation.queueAttempt + 1)
  const delayMs = Math.min(RATE_LIMIT_MAX_BACKOFF_MS, RATE_LIMIT_INITIAL_BACKOFF_MS * 2 ** (nextAttempt - 1))
  const queueNotBefore = new Date(now.getTime() + delayMs).toISOString()
  const message = error || rateLimitMessageFromBody(body) || "Upstream rate limit exceeded."
  const next = saveCreationJob(
    {
      ...creation,
      jobId: null,
      status: QUEUED_CREATION_STATUS,
      response: body,
      job: body,
      error: message,
      queueAttempt: nextAttempt,
      queueNotBefore,
      lastRateLimitedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      finishedAt: null,
    },
    {
      eventStatus: QUEUED_CREATION_STATUS,
      eventMessage: `${retryableQueueEventPrefix(message)}; retrying after ${queueNotBefore}.`,
      eventData: body,
    },
  )

  scheduleNextQueuedCreationRun()
  return next
}

function isRetryableRateLimitCreateResponse(body: Record<string, unknown>, error: string | null): boolean {
  const status = String(body["status"] || "").toLowerCase()
  const message = String(error || body["error"] || "")
  return (
    (status === "failed" || Boolean(error)) &&
    (/throttling\.ratequota/i.test(message) ||
      /rate limit/i.test(message) ||
      /requests rate limit exceeded/i.test(message) ||
      /insufficient[_\s-]?coins/i.test(message))
  )
}

function rateLimitMessageFromBody(body: Record<string, unknown>): string | null {
  return typeof body["error"] === "string" && body["error"] ? body["error"] : null
}

function retryableQueueEventPrefix(message: string): string {
  return /insufficient[_\s-]?coins/i.test(message) ? "Insufficient coins" : "Rate limited"
}

function queuedCreateResponse(
  creation: {
    id: string
    accountEmail: string | null
    error?: string | null
    lastRateLimitedAt?: string | null
    modeId: string | null
    modeLabel: string | null
    queueNotBefore?: string | null
  },
  mode: CreateMode,
  source: Record<string, unknown>,
  request: Record<string, unknown>,
  templateId?: string | null,
): CreateJobSubmitResponse {
  return {
    ok: true,
    queued: true,
    rateLimited: Boolean(creation.lastRateLimitedAt),
    error: creation.error || null,
    queueNotBefore: creation.queueNotBefore || null,
    jobId: creation.id,
    accountEmail: creation.accountEmail,
    modeId: creation.modeId || mode.id,
    modeLabel: creation.modeLabel || mode.label,
    source,
    request,
    ...(templateId ? { templateId } : {}),
    pollMs: CREATE_POLL_MS,
  }
}

async function findCreateMode(modeId: string | null): Promise<CreateMode | null> {
  if (!modeId) {
    return null
  }

  const registry = await loadCreateTemplateRegistry()
  const modes = getCreateModeDefinitions(registry.templates)
  return modes.find((entry) => entry.id === modeId) || null
}

function accountQueueKey(accountEmail: string | null): string {
  return accountEmail || "__default__"
}

function scheduleNextQueuedCreationRun(): void {
  if (getCreationQueuePaused()) {
    return
  }

  const nextQueued = listCreationJobs({ status: "all", limit: 1000 })
    .filter((creation) => creation.status === QUEUED_CREATION_STATUS && !isQueueReady(creation))
    .toSorted(compareQueuedCreations)[0]

  if (!nextQueued?.queueNotBefore) {
    return
  }

  const delayMs = Math.max(1000, Date.parse(nextQueued.queueNotBefore) - Date.now())
  if (!Number.isFinite(delayMs)) {
    return
  }

  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, delayMs, "queue-not-before")
}

function getQueuedRequestBody(creation: CreationJob): Record<string, unknown> {
  return queuedRequestBodies.get(creation.id) || creation.requestBody || {}
}

export async function pollCreateJob(jobId: string): Promise<CreateJobPollResponse> {
  const existing = findCreationJob(jobId)
  if (existing?.status === QUEUED_CREATION_STATUS) {
    scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "poll-queued")
  }

  if (existing?.status === QUEUED_CREATION_STATUS || (existing && !existing.jobId)) {
    return {
      job: toPublicCreateJob(creationToQueuedJob(existing)),
      createState: toPublicCreation(existing),
      pollMs: CREATE_POLL_MS,
    }
  }

  if (existing?.workflow && existing.workflow.steps.length > 1) {
    return pollCreateWorkflowJob({ ...existing, workflow: existing.workflow })
  }

  const upstreamJobId = existing?.jobId || jobId
  const job = await fetchCreateJob(upstreamJobId, { accountEmail: existing?.accountEmail || null })
  const creation = saveCreationFromJob(job, {
    existing,
    eventMessage: `Job ${job.status || "updated"}.`,
  })
  if (isTerminalCreationStatus(job.status)) {
    scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "creation-terminal")
  }

  return {
    job: toPublicCreateJob(job),
    createState: creation ? toPublicCreation(creation) : null,
    pollMs: CREATE_POLL_MS,
  }
}

function creationToQueuedJob(creation: CreationJob): GeneratePornJob {
  return {
    id: creation.id,
    accountEmail: creation.accountEmail,
    type: creation.mediaType,
    prompt: typeof creation.params["prompt"] === "string" ? creation.params["prompt"] : "",
    negative_prompt: typeof creation.params["negativePrompt"] === "string" ? creation.params["negativePrompt"] : "",
    status: creation.status,
    output_url: creation.outputUrl,
    input_url: creation.inputUrl,
    created_at: creation.createdAt || creation.createdLocallyAt,
    external_task_id: creation.externalTaskId,
    error: creation.error,
  }
}

async function pollCreateWorkflowJob(creation: CreationJob & { workflow: CreationWorkflow }): Promise<CreateJobPollResponse> {
  const workflow = creation.workflow
  if (!workflow.activeJobId) {
    throw new Error("Workflow has no active job.")
  }

  const job = await fetchCreateJob(workflow.activeJobId, { accountEmail: creation.accountEmail })
  const publicJob = toPublicCreateJob(job)
  const now = new Date().toISOString()
  const isLastStep = workflow.currentStep >= workflow.steps.length - 1

  if (job.status === "done" && job.output_url && !isLastStep) {
    const nextStepIndex = workflow.currentStep + 1
    const registry = await loadCreateTemplateRegistry()
    const modes = getCreateModeDefinitions(registry.templates)
    const nextStep = workflow.steps[nextStepIndex]
    if (!nextStep) {
      throw new Error("Template next step is missing.")
    }
    const nextMode = modes.find((entry) => entry.id === nextStep.modeId)

    if (!nextMode || nextMode.disabled) {
      throw new Error("Template next step is not available.")
    }

    const liveRequest = buildCreateApiRequest(
      nextMode,
      {
        value: validateCreateSourceUrl(job.output_url),
        isDataUrl: false,
        publicSource: {
          kind: "url",
          url: job.output_url,
        },
      },
      {
        ...nextStep.params,
        ...workflow.overrides,
      },
    )
    const response = await fetchGeneratePornApi(
      `${getJobsApiBaseUrl()}/${nextMode.endpoint}`,
      {
        method: "POST",
        body: JSON.stringify(liveRequest.body),
      },
      { accountEmail: creation.accountEmail },
    )
    const { body, error: responseError, jobId } = parseCreateApiResponse(await readJsonObject(response))

    if (!response.ok || !jobId) {
      const error =
        responseError ||
        (!jobId ? "Create response did not include a job_id." : `Create request failed: ${response.status} ${response.statusText}`)
      saveCreationJob(
        {
          ...creation,
          status: "error",
          response: body,
          error,
          job: publicJob,
          workflow: {
            ...workflow,
            jobs: [...workflow.jobs, { stepIndex: workflow.currentStep, jobId: job.id, modeId: nextStep.modeId, status: job.status }],
          },
          updatedAt: now,
          finishedAt: now,
        },
        {
          eventStatus: "error",
          eventMessage: error,
          eventData: body,
        },
      )
      throw httpError(error, response.status)
    }

    const nextWorkflow = {
      ...workflow,
      currentStep: nextStepIndex,
      activeJobId: jobId,
      jobs: [
        ...workflow.jobs.filter((entry) => entry.jobId !== job.id),
        { stepIndex: workflow.currentStep, jobId: job.id, modeId: workflow.steps[workflow.currentStep]?.modeId, status: job.status },
        { stepIndex: nextStepIndex, jobId, modeId: nextMode.id },
      ],
    }

    const nextCreation = saveCreationJob(
      {
        ...creation,
        jobId,
        status: "pending",
        request: liveRequest.publicRequest,
        requestBody: liveRequest.body,
        response: body,
        job: publicJob,
        outputUrl: null,
        workflow: nextWorkflow,
        updatedAt: now,
        finishedAt: null,
      },
      {
        eventStatus: "pending",
        eventMessage: `Workflow step ${nextStepIndex + 1} accepted.`,
        eventData: body,
      },
    )

    return {
      job: {
        ...publicJob,
        id: nextCreation.id,
        status: "pending",
        outputUrl: null,
      },
      createState: toPublicCreation(nextCreation),
      pollMs: CREATE_POLL_MS,
    }
  }

  const status = publicJob.status || creation.status || "pending"
  const nextCreation = saveCreationJob(
    {
      ...creation,
      jobId: workflow.activeJobId,
      status,
      job: publicJob,
      inputUrl: publicJob.inputUrl,
      outputUrl: publicJob.outputUrl,
      externalTaskId: publicJob.externalTaskId,
      error: publicJob.error,
      createdAt: publicJob.createdAt || creation.createdAt,
      createdAtIso: publicJob.createdAtIso || creation.createdAtIso,
      updatedAt: now,
      finishedAt: isTerminalCreationStatus(status) ? creation.finishedAt || now : null,
      workflow: {
        ...workflow,
        jobs: [
          ...workflow.jobs.filter((entry) => entry.jobId !== job.id),
          { stepIndex: workflow.currentStep, jobId: job.id, modeId: workflow.steps[workflow.currentStep]?.modeId, status },
        ],
      },
    },
    {
      eventStatus: status,
      eventMessage: `Workflow job ${status}.`,
      eventData: publicJob,
    },
  )
  if (isTerminalCreationStatus(status)) {
    scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "creation-terminal")
  }

  return {
    job: {
      ...publicJob,
      id: nextCreation.id,
    },
    createState: toPublicCreation(nextCreation),
    pollMs: CREATE_POLL_MS,
  }
}

export async function downloadCreateJob(jobId: string): Promise<DownloadCreateJobResponse> {
  const createState = findCreationJob(jobId)
  const activeJobId = createState?.workflow?.activeJobId || jobId
  const job = await fetchCreateJob(activeJobId, { accountEmail: createState?.accountEmail || null })

  if (job.status !== "done" || !job.output_url) {
    throw new Error("Creation job is not ready to download.")
  }

  const catalog = await loadCatalog()
  const existing = catalog.items.find((item) => item.id === job.id)
  const creationState = createState || findCreationJob(job.id)
  const downloaded = await downloadJob(job)
  const nextItem = toCatalogItem(job, {
    ...existing,
    ...downloaded,
    accountEmail: createState?.accountEmail || job.accountEmail || existing?.accountEmail || null,
    downloadError: null,
    createModeId: creationState?.modeId || existing?.createModeId || null,
    createParams: creationState?.params || existing?.createParams || null,
    templateId: creationState?.templateId || existing?.templateId || null,
    templateLabel: creationState?.templateLabel || existing?.templateLabel || null,
    sourceKind: stringOrNull(creationState?.source?.["kind"]) || existing?.sourceKind || null,
    sourceItemId: stringOrNull(creationState?.source?.["itemId"]) || existing?.sourceItemId || null,
    sourceUrl: stringOrNull(creationState?.source?.["url"]) || existing?.sourceUrl || null,
    createdLocallyAt: creationState?.createdLocallyAt || existing?.createdLocallyAt || null,
  })
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  itemById.set(job.id, nextItem)
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  downloadedJobIds.add(job.id)

  catalog.items = sortItems(Array.from(itemById.values()))
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  catalog.lastSeenJobId ||= job.id
  catalog.updatedAt = new Date().toISOString()
  await saveCatalog(catalog)
  scheduleMissingThumbnailBackgroundJobForCatalog(catalog, "creation-download-finished")
  saveCreationFromJob(job, {
    existing: creationState,
    downloadedItemId: nextItem.id,
    eventMessage: "Downloaded to library.",
  })

  return {
    ok: true,
    item: toPublicCatalogItem(nextItem),
  }
}

export async function getCreations(searchParams = new URLSearchParams()): Promise<CreationsResponse> {
  const status = searchParams.get("status") || "all"
  const refresh = searchParams.get("refresh") === "true"
  const limit = normalizeCreationHistoryLimit(searchParams.get("limit"))

  if (refresh && getSyncAccountEmails().length > 0) {
    await refreshActiveCreations()
  }
  const rows = listCreationJobSummaries({ status, limit })
  const activeCount = rows.filter((row) => isActiveCreationStatus(row.status)).length

  return {
    creations: rows.map((row) => toPublicCreation(row)),
    activeCount,
    total: rows.length,
    queuePaused: getCreationQueuePaused(),
    failedQueuedCount: countFailedQueuedCreations(),
    pollMs: activeCount ? CREATE_POLL_MS : 10000,
  }
}

function normalizeCreationHistoryLimit(value: string | null): number {
  if (!value) return 80
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 80
  return Math.max(1, Math.min(5000, Math.floor(parsed)))
}

export async function getCreationDetails(id: string): Promise<CreationDetailsResponse> {
  const creation = findCreationJob(id)

  if (!creation) {
    throw httpError("Creation was not found.", 404)
  }

  return {
    creation: toPublicCreation(creation, { details: true }),
    events: listCreationEvents(creation.id),
  }
}

export async function duplicateCreation(id: string, options: Record<string, unknown> = {}): Promise<DuplicateCreationResponse> {
  const creation = findCreationJob(id)

  if (!creation) {
    throw httpError("Creation was not found.", 404)
  }

  const now = new Date().toISOString()
  const includeSource = options["includeSource"] === true
  const source = includeSource ? getReusableCreationSource(creation.source) : null
  const draft = {
    id: `draft-${randomUUID()}`,
    accountEmail: creation.accountEmail,
    status: "draft",
    modeId: creation.modeId,
    modeLabel: creation.modeLabel,
    mediaType: creation.mediaType,
    templateId: creation.templateId,
    templateLabel: creation.templateLabel,
    source,
    params: creation.params || {},
    createdLocallyAt: now,
    updatedAt: now,
  }

  const savedDraft = saveCreationJob(draft, {
    eventStatus: "draft",
    eventMessage: `Copied settings from ${creation.jobId || creation.id}.`,
  })

  return {
    ok: true,
    draft: toPublicCreation(savedDraft),
    form: {
      modeId: draft.modeId,
      templateId: draft.templateId,
      params: draft.params,
      ...(includeSource ? { source: draft.source } : {}),
    },
  }
}

export async function refreshCreations({
  pageLimit = CREATE_HISTORY_PAGE_LIMIT,
}: {
  pageLimit?: number
} = {}): Promise<RefreshCreationsResponse> {
  const syncAccounts = getSyncAccountEmails()
  if (syncAccounts.length === 0) {
    throw new Error(`No active API auth token. ${AUTH_SETUP_MESSAGE}`)
  }

  const active = await refreshActiveCreations()
  let imported = 0

  for (const accountEmail of syncAccounts) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const jobs = await fetchJobsPage(page, { accountEmail })

      if (jobs.length === 0) {
        break
      }

      for (const job of jobs) {
        const existing = findCreationJob(job.id)
        saveCreationFromJob(job, {
          existing,
          accountEmail,
          eventMessage: existing ? `History refresh saw ${job.status}.` : "Imported from upstream history.",
        })
        if (!existing) {
          imported += 1
        }
      }
    }
  }
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "creation-refresh")

  const rows = listCreationJobs({ status: "all" })
  return {
    ok: true,
    refreshed: active.refreshed,
    imported,
    creations: rows.map((row) => toPublicCreation(row)),
    activeCount: rows.filter((row) => isActiveCreationStatus(row.status)).length,
    queuePaused: getCreationQueuePaused(),
    failedQueuedCount: countFailedQueuedCreations(),
    pollMs: rows.some((row) => isActiveCreationStatus(row.status)) ? CREATE_POLL_MS : 10000,
    total: rows.length,
  }
}

async function refreshActiveCreations(): Promise<{ refreshed: number; errors: { id: string; message: string }[] }> {
  const activeRows = listCreationJobs({ status: "active" }).filter((row) => row.jobId)
  const errors: { id: string; message: string }[] = []
  let refreshed = 0

  for (const row of activeRows) {
    try {
      const job = await fetchCreateJob(row.jobId || "", { accountEmail: row.accountEmail })
      if (shouldPersistCreationPollResult(row, job)) {
        saveCreationFromJob(job, {
          existing: row,
          eventMessage: `Job ${job.status || "updated"}.`,
        })
        refreshed += 1
      }
    } catch (error) {
      errors.push({
        id: row.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  scheduleBackgroundJob(CREATION_QUEUE_BACKGROUND_JOB_ID, 0, "active-refresh")

  return {
    refreshed,
    errors,
  }
}

export async function fetchCreateJob(
  jobId: string,
  { accountEmail = null }: { accountEmail?: string | null } = {},
): Promise<GeneratePornJob> {
  await ensureAccountApiAuth(accountEmail)

  const response = await fetchGeneratePornApi(`${getJobsApiBaseUrl()}/${encodeURIComponent(jobId)}`, {}, { accountEmail })
  const { body, error } = parseCreateApiResponse(await readJsonObject(response))

  if (!response.ok) {
    throw new Error(error || `Job request failed: ${response.status} ${response.statusText}`)
  }

  const job = parseGeneratePornJob(body)
  if (!job) {
    throw new Error("Job response did not include an id.")
  }

  return accountEmail ? { ...job, accountEmail } : job
}

function shouldPersistCreationPollResult(existing: CreationJob, job: GeneratePornJob): boolean {
  const publicJob = toPublicCreateJob(job)
  const status = publicJob.status || existing.status || "pending"
  const createdAtIso = publicJob.createdAtIso || existing.createdAtIso || null

  return (
    existing.status !== status ||
    (existing.outputUrl || null) !== (job.output_url || null) ||
    (existing.inputUrl || null) !== (job.input_url || null) ||
    (existing.error || null) !== (job.error || null) ||
    (existing.externalTaskId || null) !== (job.external_task_id || null) ||
    (existing.createdAt || null) !== (job.created_at || existing.createdAt || null) ||
    (existing.createdAtIso || null) !== createdAtIso
  )
}

export function saveCreationFromJob(
  job: GeneratePornJob,
  options: { existing?: CreationJob | null; accountEmail?: string | null; downloadedItemId?: string | null; eventMessage?: string } = {},
): CreationJob {
  const existing = options.existing || findCreationJob(job.id)
  const publicJob = toPublicCreateJob(job)
  const status = publicJob.status || existing?.status || "pending"
  const now = new Date().toISOString()
  const creation: CreationJob = {
    ...existing,
    id: existing?.id || job.id,
    accountEmail: existing?.accountEmail || options.accountEmail || job.accountEmail || null,
    jobId: job.id,
    status,
    modeId: existing?.modeId || inferCreateModeId(job),
    modeLabel: existing?.modeLabel || inferCreateModeLabel(job),
    mediaType: existing?.mediaType || (job.type === "video" ? "video" : "image"),
    templateId: existing?.templateId || null,
    templateLabel: existing?.templateLabel || null,
    source: existing?.source || sourceFromCreateJob(job),
    params: existing?.params || paramsFromCreateJob(job),
    request: existing?.request || null,
    requestBody: existing?.requestBody || null,
    response: existing?.response || null,
    workflow: existing?.workflow || null,
    job: publicJob,
    error: job.error || null,
    queueNotBefore: null,
    queueAttempt: 0,
    lastRateLimitedAt: null,
    inputUrl: job.input_url || null,
    outputUrl: job.output_url || null,
    externalTaskId: job.external_task_id || null,
    createdAt: job.created_at || existing?.createdAt || null,
    createdAtIso: publicJob.createdAtIso || existing?.createdAtIso || null,
    createdLocallyAt: existing?.createdLocallyAt || publicJob.createdAtIso || now,
    submittedAt: existing?.submittedAt || publicJob.createdAtIso || null,
    updatedAt: now,
    finishedAt: isTerminalCreationStatus(status) ? existing?.finishedAt || now : null,
    downloadedItemId: options.downloadedItemId || existing?.downloadedItemId || null,
  }

  saveCreationJob(creation, {
    eventStatus: status,
    eventMessage: options.eventMessage,
    eventData: publicJob,
  })

  return creation
}

function inferCreateModeId(job: GeneratePornJob): string {
  if (job.type === "text2image") return "text-to-image"
  return job.type === "video" ? "custom-video" : "custom-image"
}

function inferCreateModeLabel(job: GeneratePornJob): string {
  if (job.type === "text2image") return "Text to Image"
  return job.type === "video" ? "Custom Video" : "Edit Image"
}

function paramsFromCreateJob(job: GeneratePornJob): CreateParams {
  const params: CreateParams = {}

  if (job.prompt) {
    params["prompt"] = job.prompt
  }

  if (job.resolution && job.duration) {
    params["quality"] = `${job.resolution}-${job.duration}`
  }

  return params
}

function sourceFromCreateJob(job: GeneratePornJob): Record<string, unknown> | null {
  if (job.input_url) {
    return {
      kind: "url",
      url: job.input_url,
    }
  }

  return null
}

function optionalAccountEmail(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : normalizeAccountEmail(value)
}

async function ensureAccountApiAuth(accountEmail: string | null): Promise<void> {
  if (hasApiAuth(accountEmail)) {
    return
  }

  const status = await getAuthBrowserForAccount(accountEmail).refreshHeadless()
  if (status.status === "connected" && hasApiAuth(accountEmail)) {
    return
  }

  throw new Error(`No active API auth token. ${AUTH_SETUP_MESSAGE}`)
}
