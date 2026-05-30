import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"

import type {
  CreateModesResponse,
  CreateTemplatesResponse,
  PublicCatalogItem,
  PublicCreateTemplate,
  PublicTemplateSettings,
} from "../types/routes.ts"
import { fetchJobsPage } from "./api-client.ts"
import { hasApiAuth } from "./auth-state.ts"
import { findCreationJob, listCatalogItemsByPrompts, readCatalogMeta, writeCatalogMeta } from "./catalog-db.ts"
import { jobFromCatalogItem, loadCatalog, toPublicCatalogItem } from "./catalog.ts"
import { CREATE_HISTORY_PAGE_LIMIT, MEDIA_DIR } from "./config.ts"
import {
  CREATE_BUILTIN_TEMPLATE_SEEDS,
  CREATE_IMAGE_ACCEPT,
  CREATE_IMAGE_ASPECT_RATIO_OPTIONS,
  CREATE_IMAGE_DEFAULT_MODEL_ID,
  CREATE_VIDEO_DEFAULT_DURATION,
  CREATE_VIDEO_DEFAULT_QUALITY,
  CREATE_VIDEO_DEFAULT_RESOLUTION,
  CREATE_POLL_MS,
  CREATE_VIDEO_QUALITY_OPTIONS,
} from "./create-constants.ts"
import {
  parseCreateSubmissionRequest,
  parseCreateTemplateInput,
  parseCreateTemplateRegistryInput,
  parseCreateTemplateRequest,
  parseImportCreateTemplateRequest,
} from "./create-schemas.ts"
import { assertCreateTextAllowed, getReusableCreationSource } from "./create-shared.ts"
import { httpError } from "./errors.ts"
import { paramsFromUnknown, recordOrEmpty, stringOrNull } from "./refinements.ts"
import type { CreateMode, CreateParams, CreateTemplate, CreateTemplateRegistry, GeneratePornJob, TemplateSettings } from "./types.ts"
import { sanitizePathPart } from "./utils.ts"

export function getCreateModeDefinitions(templates: CreateTemplate[] = []): CreateMode[] {
  const modes: CreateMode[] = [
    {
      id: "custom-image",
      label: "Edit Image",
      kind: "custom",
      mediaType: "image",
      endpoint: "edit",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fields: [{ name: "prompt", label: "Prompt", type: "textarea", required: true }],
      defaults: {
        seed: null,
      },
    },
    {
      id: "text-to-image",
      label: "Text to Image",
      kind: "custom",
      mediaType: "image",
      endpoint: "text2image",
      source: {
        required: false,
        acceptedKinds: [],
      },
      fields: [
        { name: "prompt", label: "Prompt", type: "textarea", required: true },
        {
          name: "quality",
          label: "Aspect ratio",
          type: "select",
          required: true,
          default: "3:4",
          options: CREATE_IMAGE_ASPECT_RATIO_OPTIONS,
        },
      ],
      defaults: {
        modelId: CREATE_IMAGE_DEFAULT_MODEL_ID,
        aspectRatio: "3:4",
        seed: null,
      },
    },
    {
      id: "nudify",
      label: "Nudify",
      kind: "preset",
      mediaType: "image",
      endpoint: "edit",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fixed: {
        prompt: "Remove all clothing, fully nude, keep face and pose unchanged",
      },
      fields: [],
    },
    {
      id: "custom-video",
      label: "Custom Video",
      kind: "custom",
      mediaType: "video",
      endpoint: "video",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fields: [
        { name: "prompt", label: "Prompt", type: "textarea", required: true },
        {
          name: "quality",
          label: "Quality",
          type: "select",
          required: true,
          default: CREATE_VIDEO_DEFAULT_QUALITY,
          options: CREATE_VIDEO_QUALITY_OPTIONS.map((option) => ({
            value: `${option.resolution}-${option.duration}`,
            label: option.label,
            resolution: option.resolution,
            duration: option.duration,
          })),
        },
      ],
      defaults: {
        resolution: CREATE_VIDEO_DEFAULT_RESOLUTION,
        duration: CREATE_VIDEO_DEFAULT_DURATION,
        seed: null,
      },
    },
    {
      id: "custom-image-video",
      label: "Image Edit + Video",
      kind: "workflow",
      mediaType: "video",
      endpoint: "workflow",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fields: [
        { name: "prompt", label: "Prompt", type: "textarea", required: true },
        {
          name: "quality",
          label: "Quality",
          type: "select",
          required: true,
          default: CREATE_VIDEO_DEFAULT_QUALITY,
          options: CREATE_VIDEO_QUALITY_OPTIONS.map((option) => ({
            value: `${option.resolution}-${option.duration}`,
            label: option.label,
            resolution: option.resolution,
            duration: option.duration,
          })),
        },
      ],
      defaults: {
        resolution: CREATE_VIDEO_DEFAULT_RESOLUTION,
        duration: CREATE_VIDEO_DEFAULT_DURATION,
        seed: null,
      },
    },
    {
      id: "nudify-video",
      label: "Nudify + Video",
      kind: "workflow",
      mediaType: "video",
      endpoint: "workflow",
      source: {
        required: true,
        acceptedKinds: ["catalog", "upload", "url"],
      },
      fields: [
        { name: "prompt", label: "Video prompt", type: "textarea", required: true },
        {
          name: "quality",
          label: "Quality",
          type: "select",
          required: true,
          default: CREATE_VIDEO_DEFAULT_QUALITY,
          options: CREATE_VIDEO_QUALITY_OPTIONS.map((option) => ({
            value: `${option.resolution}-${option.duration}`,
            label: option.label,
            resolution: option.resolution,
            duration: option.duration,
          })),
        },
      ],
      defaults: {
        resolution: CREATE_VIDEO_DEFAULT_RESOLUTION,
        duration: CREATE_VIDEO_DEFAULT_DURATION,
        seed: null,
      },
    },
  ]

  for (const template of templates) {
    modes.push(templateToCreateMode(template))
  }

  for (const seed of CREATE_BUILTIN_TEMPLATE_SEEDS) {
    if (!modes.some((mode) => mode.id === seed.id)) {
      modes.push({
        id: seed.id,
        label: seed.label,
        kind: "template",
        mediaType: "video",
        endpoint: "video",
        disabled: true,
        disabledReason: "Import this template from history before use.",
        seedJobId: seed.seedJobId,
        source: {
          required: true,
          acceptedKinds: ["catalog", "upload", "url"],
        },
        fields: [],
      })
    }
  }

  return modes
}

export async function getCreateModes(): Promise<CreateModesResponse> {
  const registry = await loadCreateTemplateRegistry()
  return {
    modes: getCreateModeDefinitions(registry.templates),
    templates: registry.templates.map(toPublicCreateTemplate),
    pollMs: CREATE_POLL_MS,
    uploadAccept: Array.from(CREATE_IMAGE_ACCEPT).join(","),
  }
}

export function templateToCreateMode(template: CreateTemplate): CreateMode {
  const settings = getPrimaryTemplateSettings(template)
  const params = settings.params || {}
  const quality = getQualityFromTemplateParams(params)

  return {
    id: template.id,
    label: template.label,
    kind: "template",
    mediaType: template.type === "image" ? "image" : "video",
    endpoint: template.type === "image" ? "edit" : "video",
    source: {
      required: true,
      acceptedKinds: ["catalog", "upload", "url"],
    },
    fixed: {
      prompt: String(params["prompt"] || ""),
      negativePrompt: String(params["negativePrompt"] || ""),
      resolution: quality.resolution,
      duration: quality.duration,
    },
    seedJobId: template.seedJobId || null,
    templateId: template.id,
    fields: [],
  }
}

export async function prepareCreateSubmission(requestBody: Record<string, unknown> = {}): Promise<{
  modes: CreateMode[]
  mode: CreateMode | undefined
  template: CreateTemplate | null
  sourceRequest: unknown
  params: CreateParams
}> {
  const body = parseCreateSubmissionRequest(requestBody)
  const registry = await loadCreateTemplateRegistry()
  const modes = getCreateModeDefinitions(registry.templates)
  const templateId = body.templateId || null
  const template = templateId ? registry.templates.find((entry) => entry.id === sanitizePathPart(templateId).toLowerCase()) : null

  if (templateId && !template) {
    throw new Error("Template was not found.")
  }

  if (template) {
    const settings = getPrimaryTemplateSettings(template)
    const modeId = body.modeId || templateDefaultModeId(template)
    const mode = modes.find((entry) => entry.id === modeId)

    return {
      modes,
      mode,
      template,
      sourceRequest: body.source || settings.source,
      params: {
        ...templateParamsForMode(template, modeId),
        ...paramsFromUnknown(body.params),
      },
    }
  }

  return {
    modes,
    mode: modes.find((entry) => entry.id === body.modeId),
    template: null,
    sourceRequest: body.source,
    params: paramsFromUnknown(body.params),
  }
}

export async function loadCreateTemplateRegistry(): Promise<CreateTemplateRegistry> {
  return normalizeCreateTemplateRegistry(readCatalogMeta("createTemplateRegistry") || {})
}

export async function getCreateTemplateRegistryResponse(): Promise<CreateTemplatesResponse> {
  const registry = await loadCreateTemplateRegistry()

  return {
    updatedAt: registry.updatedAt,
    templates: registry.templates.map((template) =>
      Object.assign(toPublicCreateTemplate(template), {
        previews: getCreateTemplatePreviews(template),
      }),
    ),
  }
}

export async function saveCreateTemplateRegistry(registry: Partial<CreateTemplateRegistry>): Promise<CreateTemplateRegistry> {
  await mkdir(MEDIA_DIR, { recursive: true })
  const body = {
    templates: (registry.templates || []).map(normalizeCreateTemplate).filter(isCreateTemplate),
    updatedAt: new Date().toISOString(),
  }
  writeCatalogMeta("createTemplateRegistry", body)
  return body
}

function normalizeCreateTemplateRegistry(registry: unknown = {}): CreateTemplateRegistry {
  const registryRecord = parseCreateTemplateRegistryInput(registry)
  return {
    templates: registryRecord.templates.map(normalizeCreateTemplate).filter(isCreateTemplate),
    updatedAt: registryRecord.updatedAt,
  }
}

function normalizeCreateTemplate(template: unknown): CreateTemplate | null {
  const templateRecord = parseCreateTemplateInput(template)
  if (!templateRecord || (!templateRecord.label && !templateRecord.id)) {
    return null
  }

  const settingsRecord = recordOrEmpty(templateRecord.settings)
  const legacyParams: CreateParams = {}
  if (templateRecord.prompt) legacyParams["prompt"] = String(templateRecord.prompt)
  if (templateRecord.negativePrompt || templateRecord.negative_prompt)
    legacyParams["negativePrompt"] = String(templateRecord.negativePrompt || templateRecord.negative_prompt)
  if (templateRecord.resolution || templateRecord.duration)
    legacyParams["quality"] = `${templateRecord.resolution || "720p"}-${Number(templateRecord.duration || 4)}`

  const settings = normalizeTemplateSettings({
    modeId:
      settingsRecord["modeId"] ||
      templateRecord.modeId ||
      (templateRecord.mediaType === "image" || templateRecord.endpoint === "edit" ? "custom-image" : "custom-video"),
    source: settingsRecord["source"] || templateRecord.source || null,
    params: {
      ...legacyParams,
      ...recordOrEmpty(settingsRecord["params"]),
      ...recordOrEmpty(templateRecord.params),
    },
  })
  const rawWorkflow = templateRecord.workflow.length ? templateRecord.workflow : [settings]
  const workflow = rawWorkflow.map(normalizeTemplateStep).filter(isTemplateSettings)
  const type = normalizeTemplateType(
    templateRecord.type || templateRecord.templateType || (workflow.length > 1 ? "combo" : inferTemplateTypeFromSettings(settings)),
  )

  for (const step of workflow) {
    assertCreateTextAllowed(step.params?.["prompt"], "Template prompt")
    assertCreateTextAllowed(step.params?.["negativePrompt"], "Template negative prompt")
  }

  const quality = getQualityFromTemplateParams(settings.params)

  return {
    id: sanitizePathPart(templateRecord.id || templateRecord.label).toLowerCase(),
    label: String(templateRecord.label || templateRecord.id).trim(),
    description: templateRecord.description ? String(templateRecord.description).trim() : "",
    type,
    settings,
    workflow: defaultWorkflowForType(type, settings, workflow),
    prompt: String(settings.params["prompt"] || ""),
    negativePrompt: String(settings.params["negativePrompt"] || ""),
    resolution: quality.resolution,
    duration: quality.duration,
    sourcePolicy: templateRecord.sourcePolicy,
    seedJobId: templateRecord.seedJobId || null,
    sourceCreationId: templateRecord.sourceCreationId || stringOrNull(templateRecord.source_creation_id),
    createdAt: templateRecord.createdAt || new Date().toISOString(),
    updatedAt: templateRecord.updatedAt || new Date().toISOString(),
  }
}

function normalizeTemplateSettings(settings: unknown = {}): TemplateSettings {
  const settingsRecord = recordOrEmpty(settings)
  return {
    modeId: String(settingsRecord["modeId"] || "custom-video"),
    source: getReusableCreationSource(settingsRecord["source"]) || null,
    params: normalizeTemplateParams(settingsRecord["params"] || {}),
  }
}

function normalizeTemplateStep(step: unknown = {}): TemplateSettings | null {
  const stepRecord = recordOrEmpty(step)
  if (!stepRecord["modeId"]) {
    return null
  }

  return {
    modeId: String(stepRecord["modeId"]),
    params: normalizeTemplateParams(stepRecord["params"] || {}),
  }
}

function normalizeTemplateParams(params: unknown = {}): CreateParams {
  const next: CreateParams = {}

  for (const [key, value] of Object.entries(recordOrEmpty(params))) {
    if (value === undefined || value === null) {
      continue
    }

    next[key] = String(value)
  }

  return next
}

function normalizeTemplateType(value: unknown): CreateTemplate["type"] {
  if (value === "image" || value === "video" || value === "combo" || value === "nudify-video") {
    return value
  }

  return "video"
}

function inferTemplateTypeFromSettings(settings: TemplateSettings): CreateTemplate["type"] {
  return settings.modeId === "custom-image" ? "image" : "video"
}

function templateDefaultModeId(template: CreateTemplate): string {
  if (template.type === "image") return "custom-image"
  if (template.type === "combo") return "custom-image-video"
  if (template.type === "nudify-video") return "nudify-video"

  return "custom-video"
}

function templateParamsForMode(template: CreateTemplate, modeId: string): CreateParams {
  const settings = getPrimaryTemplateSettings(template)

  if (modeId === "custom-image-video") {
    const imageStep = template.workflow.find((step) => step.modeId === "custom-image")
    const videoStep = template.workflow.find((step) => step.modeId === "custom-video")
    return {
      ...settings.params,
      prompt: String(videoStep?.params["prompt"] || imageStep?.params["prompt"] || settings.params["prompt"] || ""),
      quality: String(videoStep?.params["quality"] || settings.params["quality"] || CREATE_VIDEO_DEFAULT_QUALITY),
    }
  }

  if (modeId === "nudify-video") {
    const videoStep = template.workflow.find((step) => step.modeId === "custom-video")
    return {
      ...settings.params,
      prompt: String(videoStep?.params["prompt"] || settings.params["prompt"] || ""),
      quality: String(videoStep?.params["quality"] || settings.params["quality"] || CREATE_VIDEO_DEFAULT_QUALITY),
    }
  }

  if (modeId === "custom-video") {
    const videoStep = template.workflow.find((step) => step.modeId === "custom-video")
    return {
      ...settings.params,
      prompt: String(videoStep?.params["prompt"] || settings.params["prompt"] || ""),
      quality: String(videoStep?.params["quality"] || settings.params["quality"] || CREATE_VIDEO_DEFAULT_QUALITY),
    }
  }

  if (modeId === "custom-image") {
    const imageStep = template.workflow.find((step) => step.modeId === "custom-image")
    return {
      ...settings.params,
      prompt: String(imageStep?.params["prompt"] || settings.params["prompt"] || ""),
    }
  }

  return settings.params
}

export function getPrimaryTemplateSettings(template: CreateTemplate): TemplateSettings {
  return (
    template.settings ||
    template.workflow?.[0] || {
      modeId: template.type === "image" ? "custom-image" : template.type === "combo" ? "custom-image-video" : "custom-video",
      source: null,
      params: {},
    }
  )
}

function buildDefaultComboWorkflow(settings: TemplateSettings): TemplateSettings[] {
  return [
    {
      modeId: "custom-image",
      params: {
        prompt: String(settings.params?.["prompt"] || ""),
      },
    },
    {
      modeId: "custom-video",
      params: {
        prompt: String(settings.params?.["prompt"] || ""),
        quality: String(settings.params?.["quality"] || CREATE_VIDEO_DEFAULT_QUALITY),
      },
    },
  ]
}

function buildDefaultNudifyVideoWorkflow(settings: TemplateSettings): TemplateSettings[] {
  return [
    {
      modeId: "nudify",
      params: {},
    },
    {
      modeId: "custom-video",
      params: {
        prompt: String(settings.params?.["prompt"] || ""),
        quality: String(settings.params?.["quality"] || CREATE_VIDEO_DEFAULT_QUALITY),
      },
    },
  ]
}

function defaultWorkflowForType(
  type: CreateTemplate["type"],
  settings: TemplateSettings,
  workflow: TemplateSettings[],
): TemplateSettings[] {
  if (type === "combo" && workflow.length === 1) return buildDefaultComboWorkflow(settings)
  if (type === "nudify-video" && workflow.length === 1) return buildDefaultNudifyVideoWorkflow(settings)

  return workflow
}

export function getQualityFromTemplateParams(params: CreateParams = {}): { resolution: string; duration: number } {
  const [resolution, duration] = String(params["quality"] || CREATE_VIDEO_DEFAULT_QUALITY).split("-")

  return {
    resolution: resolution || CREATE_VIDEO_DEFAULT_RESOLUTION,
    duration: Number(duration || CREATE_VIDEO_DEFAULT_DURATION),
  }
}

export async function saveCreateTemplateFromRequest(
  body: Record<string, unknown> = {},
): Promise<PublicCreateTemplate & { previews: PublicCatalogItem[] }> {
  const requestBody = parseCreateTemplateRequest(body)
  const registry = await loadCreateTemplateRegistry()
  const now = new Date().toISOString()
  const id = sanitizePathPart(requestBody.id || requestBody.label || `template-${randomUUID()}`).toLowerCase()
  const existing = registry.templates.find((entry) => entry.id === id)
  const template = normalizeCreateTemplate({
    ...existing,
    ...requestBody,
    id,
    createdAt: existing?.createdAt || requestBody.createdAt || now,
    updatedAt: now,
  })

  if (!template) {
    throw new Error("Template label is required.")
  }

  const nextTemplates = registry.templates.filter((entry) => entry.id !== template.id)
  nextTemplates.push(template)
  await saveCreateTemplateRegistry({
    templates: nextTemplates,
  })

  return {
    ...toPublicCreateTemplate(template),
    previews: getCreateTemplatePreviews(template),
  }
}

export async function saveCreateTemplateFromCreation(
  id: string,
  body: Record<string, unknown> = {},
): Promise<PublicCreateTemplate & { previews: PublicCatalogItem[] }> {
  const requestBody = parseCreateTemplateRequest(body)
  const creation = findCreationJob(id)

  if (!creation) {
    throw httpError("Creation was not found.", 404)
  }

  return saveCreateTemplateFromRequest({
    id: requestBody.id,
    label: requestBody.label || `${creation.modeLabel || "Creation"} ${String(creation.jobId || creation.id).slice(0, 8)}`,
    description: requestBody.description || "",
    type: creation.mediaType === "image" ? "image" : "video",
    settings: {
      modeId: creation.modeId,
      source: getReusableCreationSource(creation.source),
      params: creation.params || {},
    },
    sourceCreationId: creation.id,
  })
}

export async function deleteCreateTemplate(id: string): Promise<{ ok: true; id: string }> {
  const templateId = sanitizePathPart(id).toLowerCase()
  const registry = await loadCreateTemplateRegistry()
  const nextTemplates = registry.templates.filter((entry) => entry.id !== templateId)

  if (nextTemplates.length === registry.templates.length) {
    throw httpError("Template was not found.", 404)
  }

  await saveCreateTemplateRegistry({
    templates: nextTemplates,
  })

  return {
    ok: true,
    id: templateId,
  }
}

function getCreateTemplatePreviews(template: CreateTemplate, limit = 6): PublicCatalogItem[] {
  return listCatalogItemsByPrompts(templatePreviewPrompts(template), limit).map(toPublicCatalogItem)
}

function templatePreviewPrompts(template: CreateTemplate): string[] {
  const prompts = new Set<string>()
  addPromptLink(prompts, template.prompt)
  addPromptLink(prompts, template.settings.params?.["prompt"])
  for (const step of template.workflow) {
    addPromptLink(prompts, step.params?.["prompt"])
  }

  return [...prompts]
}

function addPromptLink(prompts: Set<string>, prompt: unknown): void {
  const normalized = String(prompt || "").trim()
  if (normalized) prompts.add(normalized)
}

export async function importCreateTemplateFromHistory(body: Record<string, unknown>): Promise<PublicCreateTemplate> {
  const requestBody = parseImportCreateTemplateRequest(body)
  const jobId = requestBody.jobId || null
  if (!jobId) {
    throw new Error("Template jobId is required.")
  }

  const job = await findJobForTemplate(jobId)
  if (!job) {
    throw new Error("Template seed job was not found in catalog or API history.")
  }

  if (job.type !== "video" || !job.prompt) {
    throw new Error("Template seed job must be a video job with a prompt.")
  }

  const registry = await loadCreateTemplateRegistry()
  const now = new Date().toISOString()
  const template = normalizeCreateTemplate({
    id: requestBody.id || templateIdFromLabel(requestBody.label) || templateIdFromJob(job),
    label: requestBody.label || templateLabelFromJob(job),
    type: "video",
    settings: {
      modeId: "custom-video",
      params: {
        prompt: job.prompt,
        negativePrompt: job.negative_prompt || "",
        quality: `${job.resolution || "720p"}-${Number(job.duration || 4)}`,
      },
    },
    seedJobId: job.id,
    createdAt: now,
    updatedAt: now,
  })
  if (!template) {
    throw new Error("Template could not be normalized.")
  }

  const nextTemplates = registry.templates.filter((entry) => entry.id !== template.id)
  nextTemplates.push(template)
  await saveCreateTemplateRegistry({
    templates: nextTemplates,
  })

  return toPublicCreateTemplate(template)
}

function toPublicCreateTemplate(template: CreateTemplate): PublicCreateTemplate {
  return {
    id: template.id,
    label: template.label,
    description: template.description,
    type: template.type,
    settings: toPublicTemplateSettings(template.settings),
    workflow: template.workflow.map(toPublicTemplateSettings),
    prompt: template.prompt,
    negativePrompt: template.negativePrompt,
    resolution: template.resolution,
    duration: template.duration,
    sourcePolicy: template.sourcePolicy,
    seedJobId: template.seedJobId,
    sourceCreationId: template.sourceCreationId,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }
}

function toPublicTemplateSettings(settings: TemplateSettings): PublicTemplateSettings {
  return {
    modeId: settings.modeId,
    source: getReusableCreationSource(settings.source),
    params: settings.params || {},
  }
}

export async function findJobForTemplate(jobId: string): Promise<GeneratePornJob | null> {
  const catalog = await loadCatalog()
  const item = catalog.items.find((entry) => entry.id === jobId)
  if (item) {
    return jobFromCatalogItem(item)
  }

  if (!hasApiAuth()) {
    return null
  }

  for (let page = 1; page <= CREATE_HISTORY_PAGE_LIMIT; page += 1) {
    const jobs = await fetchJobsPage(page)
    const job = jobs.find((entry) => entry.id === jobId)
    if (job) {
      return job
    }

    if (jobs.length === 0) {
      break
    }
  }

  return null
}

function templateIdFromLabel(label: unknown): string | null {
  return label ? sanitizePathPart(label).toLowerCase() : null
}

function templateIdFromJob(job: GeneratePornJob): string {
  const seed = CREATE_BUILTIN_TEMPLATE_SEEDS.find((entry) => entry.seedJobId === job.id)
  return seed?.id || `template-${job.id}`
}

function templateLabelFromJob(job: GeneratePornJob): string {
  const seed = CREATE_BUILTIN_TEMPLATE_SEEDS.find((entry) => entry.seedJobId === job.id)
  return seed?.label || `Template ${String(job.id).slice(0, 8)}`
}

function isCreateTemplate(value: CreateTemplate | null): value is CreateTemplate {
  return Boolean(value)
}

function isTemplateSettings(value: TemplateSettings | null): value is TemplateSettings {
  return Boolean(value)
}
