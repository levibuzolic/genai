import { randomUUID } from "node:crypto"

import type {
  CreateJobPollResponse,
  CreateJobSubmitResponse,
  CreationDetailsResponse,
  CreationsResponse,
  DownloadCreateJobResponse,
  DuplicateCreationResponse,
  RefreshCreationsResponse,
} from "../types/routes.ts"
import { fetchGeneratePornApi, fetchJobsPage, getJobsApiBaseUrl } from "./api-client.ts"
import { getAuthBrowserForAccount, getSyncAccountEmails, hasApiAuth, normalizeAccountEmail } from "./auth-state.ts"
import {
  addCreationEvent,
  findCreationJob,
  listCreationEvents,
  listCreationJobs,
  moveCreationJob,
  saveCreationJob,
  toPublicCreation,
} from "./catalog-db.ts"
import { downloadJob, loadCatalog, saveCatalog, sortItems, toCatalogItem, toPublicCatalogItem } from "./catalog.ts"
import { AUTH_SETUP_MESSAGE, CREATE_HISTORY_PAGE_LIMIT } from "./config.ts"
import { buildCreateApiRequest, resolveCreateSource, toPublicCreateJob, validateCreateSourceUrl } from "./create-api.ts"
import { CREATE_POLL_MS } from "./create-constants.ts"
import { parseCreateApiResponse } from "./create-schemas.ts"
import { getReusableCreationSource, isActiveCreationStatus, isTerminalCreationStatus } from "./create-shared.ts"
import { getCreateModeDefinitions, loadCreateTemplateRegistry, prepareCreateSubmission } from "./create-templates.ts"
import { httpError } from "./errors.ts"
import { readJsonObject, requireCreateSource, stringOrNull } from "./refinements.ts"
import { parseGeneratePornJob } from "./schemas.ts"
import type { CreateMode, CreateParams, CreationJob, CreationWorkflow, GeneratePornJob, TemplateSettings } from "./types.ts"

export { buildCreateApiRequest, resolveCreateSource }

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
  { accountEmail, attemptId, requestStartedAt }: { accountEmail: string | null; attemptId: string; requestStartedAt: string },
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
    status: "submitted",
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
    eventStatus: "submitted",
    eventMessage: "Submitted creation workflow.",
  })

  let response: Response
  let body: Record<string, unknown>
  let apiResponse: ReturnType<typeof parseCreateApiResponse>
  try {
    response = await fetchGeneratePornApi(`${getJobsApiBaseUrl()}/${firstMode.endpoint}`, {
      method: "POST",
      body: JSON.stringify(liveRequest.body),
    }, { accountEmail })
    apiResponse = parseCreateApiResponse(await readJsonObject(response))
    body = apiResponse.body
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveCreationJob(
      {
        ...baseRecord,
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
  if (!response.ok || !jobId) {
    const error =
      apiResponse.error ||
      (!jobId ? "Create response did not include a job_id." : `Create request failed: ${response.status} ${response.statusText}`)
    saveCreationJob(
      {
        ...baseRecord,
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

  const workflowCreation = {
    ...baseRecord,
    id: jobId,
    previousId: attemptId,
    jobId,
    response: body,
    workflow: {
      ...workflow,
      activeJobId: jobId,
      jobs: [{ stepIndex: 0, jobId, modeId: firstMode.id }],
    },
    status: "pending",
    updatedAt: new Date().toISOString(),
  }

  moveCreationJob(attemptId, workflowCreation)
  addCreationEvent(jobId, "pending", "Workflow first step accepted.", body)

  return {
    ok: true,
    jobId,
    accountEmail,
    modeId: workflowCreation.modeId,
    modeLabel: mode.label,
    source: source.publicSource,
    request: liveRequest.publicRequest,
    ...(template ? { templateId: template.id } : {}),
    pollMs: CREATE_POLL_MS,
  }
}

export async function createMediaJob(requestBody: Record<string, unknown>): Promise<CreateJobSubmitResponse> {
  const attemptId = `local-${randomUUID()}`
  const requestStartedAt = new Date().toISOString()
  const accountEmail = optionalAccountEmail(requestBody["accountEmail"])

  await ensureAccountApiAuth(accountEmail)

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
        accountEmail,
        attemptId,
        requestStartedAt,
      },
    )
  }

  const source = mode.source?.required === false ? null : await resolveCreateSource(requireCreateSource(sourceRequest))
  const liveRequest = buildCreateApiRequest(mode, source, params)
  const url = `${getJobsApiBaseUrl()}/${mode.endpoint}`
  const baseRecord = {
    id: attemptId,
    accountEmail,
    status: "submitted",
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
    eventStatus: "submitted",
    eventMessage: "Submitted creation request.",
  })

  let response: Response
  let body: Record<string, unknown>
  let apiResponse: ReturnType<typeof parseCreateApiResponse>
  try {
    response = await fetchGeneratePornApi(url, {
      method: "POST",
      body: JSON.stringify(liveRequest.body),
    }, { accountEmail })
    apiResponse = parseCreateApiResponse(await readJsonObject(response))
    body = apiResponse.body
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveCreationJob(
      {
        ...baseRecord,
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
    saveCreationJob(
      {
        ...baseRecord,
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
  if (!jobId) {
    saveCreationJob(
      {
        ...baseRecord,
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

  const creation = {
    ...baseRecord,
    id: jobId,
    previousId: attemptId,
    jobId,
    modeId: mode.id,
    modeLabel: mode.label,
    source: source?.publicSource || null,
    params,
    templateId: template?.id || mode.templateId || null,
    templateLabel: template?.label || null,
    request: liveRequest.publicRequest,
    requestBody: liveRequest.body,
    response: body,
    status: "pending",
    createdLocallyAt: requestStartedAt,
    submittedAt: requestStartedAt,
    updatedAt: new Date().toISOString(),
  }

  moveCreationJob(attemptId, creation)
  addCreationEvent(jobId, "pending", "Upstream job accepted.", body)

  return {
    ok: true,
    jobId,
    accountEmail,
    modeId: mode.id,
    modeLabel: mode.label,
    source: source?.publicSource || {},
    request: liveRequest.publicRequest,
    pollMs: CREATE_POLL_MS,
  }
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
          modelId: String(params["modelId"] || videoStep?.params["modelId"] || ""),
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
          modelId: String(params["modelId"] || videoStep?.params["modelId"] || ""),
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

export async function pollCreateJob(jobId: string): Promise<CreateJobPollResponse> {
  const existing = findCreationJob(jobId)
  if (existing?.workflow && existing.workflow.steps.length > 1) {
    return pollCreateWorkflowJob({ ...existing, workflow: existing.workflow })
  }

  const job = await fetchCreateJob(jobId, { accountEmail: existing?.accountEmail || null })
  const creation = saveCreationFromJob(job, {
    existing,
    eventMessage: `Job ${job.status || "updated"}.`,
  })

  return {
    job: toPublicCreateJob(job),
    createState: creation ? toPublicCreation(creation) : null,
    pollMs: CREATE_POLL_MS,
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
    const response = await fetchGeneratePornApi(`${getJobsApiBaseUrl()}/${nextMode.endpoint}`, {
      method: "POST",
      body: JSON.stringify(liveRequest.body),
    }, { accountEmail: creation.accountEmail })
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

  if (refresh && getSyncAccountEmails().length > 0) {
    await refreshActiveCreations()
  }

  const rows = listCreationJobs({ status })
  const activeCount = rows.filter((row) => isActiveCreationStatus(row.status)).length

  return {
    creations: rows.map((row) => toPublicCreation(row)),
    activeCount,
    total: rows.length,
    pollMs: activeCount ? CREATE_POLL_MS : 10000,
  }
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

  const rows = listCreationJobs({ status: "all" })
  return {
    ok: true,
    refreshed: active.refreshed,
    imported,
    creations: rows.map((row) => toPublicCreation(row)),
    activeCount: rows.filter((row) => isActiveCreationStatus(row.status)).length,
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
      saveCreationFromJob(job, {
        existing: row,
        eventMessage: `Job ${job.status || "updated"}.`,
      })
      refreshed += 1
    } catch (error) {
      errors.push({
        id: row.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    refreshed,
    errors,
  }
}

export async function fetchCreateJob(jobId: string, { accountEmail = null }: { accountEmail?: string | null } = {}): Promise<GeneratePornJob> {
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
  const modelId = job.modelId || job.model_id || ""
  if (job.type === "video" && modelId.endsWith("-t2v")) return "text-to-video"

  return job.type === "video" ? "custom-video" : "custom-image"
}

function inferCreateModeLabel(job: GeneratePornJob): string {
  const modelId = job.modelId || job.model_id || ""
  if (job.type === "video" && modelId.endsWith("-t2v")) return "Text to Video"

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

  if (job.modelId || job.model_id) {
    params["modelId"] = job.modelId || job.model_id
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
