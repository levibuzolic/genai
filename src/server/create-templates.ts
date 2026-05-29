import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"

import { fetchJobsPage } from "./api-client.ts"
import { hasApiAuth } from "./auth-state.ts"
import { findCreationJob, getCatalogDb, parseJson, readCatalogMeta, writeCatalogMeta } from "./catalog-db.ts"
import { jobFromCatalogItem, loadCatalog, toPublicCatalogItem } from "./catalog.ts"
import { CREATE_HISTORY_PAGE_LIMIT, MEDIA_DIR } from "./config.ts"
import { CREATE_BUILTIN_TEMPLATE_SEEDS, CREATE_IMAGE_ACCEPT, CREATE_POLL_MS, CREATE_VIDEO_QUALITY_OPTIONS } from "./create-constants.ts"
import { assertCreateTextAllowed, getReusableCreationSource } from "./create-shared.ts"
import { httpError } from "./errors.ts"
import { isCatalogItem, isRecord, paramsFromUnknown, recordOrEmpty, stringOrNull } from "./refinements.ts"
import type {
  CatalogItem,
  CreateMode,
  CreateParams,
  CreateTemplate,
  CreateTemplateRegistry,
  GeneratePornJob,
  TemplateSettings,
} from "./types.ts"
import { sanitizePathPart } from "./utils.ts"

type CatalogItemRow = {
  item_json: string
}

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
          default: "720p-4",
          options: CREATE_VIDEO_QUALITY_OPTIONS.map((option) => ({
            value: `${option.resolution}-${option.duration}`,
            label: option.label,
            resolution: option.resolution,
            duration: option.duration,
          })),
        },
      ],
      defaults: {
        resolution: "720p",
        duration: 4,
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

export async function getCreateModes(): Promise<Record<string, unknown>> {
  const registry = await loadCreateTemplateRegistry()
  return {
    modes: getCreateModeDefinitions(registry.templates),
    templates: registry.templates,
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
  const registry = await loadCreateTemplateRegistry()
  const modes = getCreateModeDefinitions(registry.templates)
  const templateId = typeof requestBody["templateId"] === "string" ? requestBody["templateId"] : null
  const template = templateId ? registry.templates.find((entry) => entry.id === sanitizePathPart(templateId).toLowerCase()) : null

  if (templateId && !template) {
    throw new Error("Template was not found.")
  }

  if (template) {
    const settings = getPrimaryTemplateSettings(template)
    const modeId = typeof requestBody["modeId"] === "string" ? requestBody["modeId"] : settings.modeId
    const mode = modes.find((entry) => entry.id === modeId)

    return {
      modes,
      mode,
      template,
      sourceRequest: requestBody["source"] || settings.source,
      params: {
        ...settings.params,
        ...paramsFromUnknown(requestBody["params"]),
      },
    }
  }

  return {
    modes,
    mode: modes.find((entry) => entry.id === requestBody["modeId"]),
    template: null,
    sourceRequest: requestBody["source"],
    params: paramsFromUnknown(requestBody["params"]),
  }
}

export async function loadCreateTemplateRegistry(): Promise<CreateTemplateRegistry> {
  return normalizeCreateTemplateRegistry(readCatalogMeta("createTemplateRegistry") || {})
}

export async function getCreateTemplateRegistryResponse(): Promise<Record<string, unknown>> {
  const registry = await loadCreateTemplateRegistry()

  return {
    ...registry,
    templates: registry.templates.map((template) => Object.assign({}, template, { previews: getCreateTemplatePreviews(template.id) })),
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
  const registryRecord = recordOrEmpty(registry)
  return {
    templates: Array.isArray(registryRecord["templates"])
      ? registryRecord["templates"].map(normalizeCreateTemplate).filter(isCreateTemplate)
      : [],
    updatedAt: typeof registryRecord["updatedAt"] === "string" ? registryRecord["updatedAt"] : null,
  }
}

function normalizeCreateTemplate(template: unknown): CreateTemplate | null {
  const templateRecord = recordOrEmpty(template)
  if (!templateRecord["label"] && !templateRecord["id"]) {
    return null
  }

  const settingsRecord = recordOrEmpty(templateRecord["settings"])
  const legacyParams: CreateParams = {}
  if (templateRecord["prompt"]) legacyParams["prompt"] = String(templateRecord["prompt"])
  if (templateRecord["negativePrompt"] || templateRecord["negative_prompt"])
    legacyParams["negativePrompt"] = String(templateRecord["negativePrompt"] || templateRecord["negative_prompt"])
  if (templateRecord["resolution"] || templateRecord["duration"])
    legacyParams["quality"] = `${templateRecord["resolution"] || "720p"}-${Number(templateRecord["duration"] || 4)}`

  const settings = normalizeTemplateSettings({
    modeId:
      settingsRecord["modeId"] ||
      templateRecord["modeId"] ||
      (templateRecord["mediaType"] === "image" || templateRecord["endpoint"] === "edit" ? "custom-image" : "custom-video"),
    source: settingsRecord["source"] || templateRecord["source"] || null,
    params: {
      ...legacyParams,
      ...recordOrEmpty(settingsRecord["params"]),
      ...recordOrEmpty(templateRecord["params"]),
    },
  })
  const rawWorkflow =
    Array.isArray(templateRecord["workflow"]) && templateRecord["workflow"].length ? templateRecord["workflow"] : [settings]
  const workflow = rawWorkflow.map(normalizeTemplateStep).filter(isTemplateSettings)
  const type = normalizeTemplateType(
    templateRecord["type"] || templateRecord["templateType"] || (workflow.length > 1 ? "combo" : inferTemplateTypeFromSettings(settings)),
  )

  for (const step of workflow) {
    assertCreateTextAllowed(step.params?.["prompt"], "Template prompt")
    assertCreateTextAllowed(step.params?.["negativePrompt"], "Template negative prompt")
  }

  const quality = getQualityFromTemplateParams(settings.params)

  return {
    id: sanitizePathPart(templateRecord["id"] || templateRecord["label"]).toLowerCase(),
    label: String(templateRecord["label"] || templateRecord["id"]).trim(),
    description: templateRecord["description"] ? String(templateRecord["description"]).trim() : "",
    type,
    settings,
    workflow: type === "combo" && workflow.length === 1 ? buildDefaultComboWorkflow(settings) : workflow,
    prompt: String(settings.params["prompt"] || ""),
    negativePrompt: String(settings.params["negativePrompt"] || ""),
    resolution: quality.resolution,
    duration: quality.duration,
    sourcePolicy: typeof templateRecord["sourcePolicy"] === "string" ? templateRecord["sourcePolicy"] : "image",
    seedJobId: typeof templateRecord["seedJobId"] === "string" ? templateRecord["seedJobId"] : null,
    sourceCreationId:
      typeof templateRecord["sourceCreationId"] === "string"
        ? templateRecord["sourceCreationId"]
        : stringOrNull(templateRecord["source_creation_id"]),
    createdAt: typeof templateRecord["createdAt"] === "string" ? templateRecord["createdAt"] : new Date().toISOString(),
    updatedAt: typeof templateRecord["updatedAt"] === "string" ? templateRecord["updatedAt"] : new Date().toISOString(),
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
  if (value === "image" || value === "video" || value === "combo") {
    return value
  }

  return "video"
}

function inferTemplateTypeFromSettings(settings: TemplateSettings): CreateTemplate["type"] {
  return settings.modeId === "custom-image" ? "image" : "video"
}

export function getPrimaryTemplateSettings(template: CreateTemplate): TemplateSettings {
  return (
    template.settings ||
    template.workflow?.[0] || {
      modeId: template.type === "image" ? "custom-image" : "custom-video",
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
        quality: String(settings.params?.["quality"] || "720p-4"),
      },
    },
  ]
}

export function getQualityFromTemplateParams(params: CreateParams = {}): { resolution: string; duration: number } {
  const [resolution, duration] = String(params["quality"] || "720p-4").split("-")

  return {
    resolution: resolution || "720p",
    duration: Number(duration || 4),
  }
}

export async function saveCreateTemplateFromRequest(
  body: Record<string, unknown> = {},
): Promise<CreateTemplate & { previews: (CatalogItem & { posterUrl: string | null })[] }> {
  const registry = await loadCreateTemplateRegistry()
  const now = new Date().toISOString()
  const id = sanitizePathPart(body["id"] || body["label"] || `template-${randomUUID()}`).toLowerCase()
  const existing = registry.templates.find((entry) => entry.id === id)
  const template = normalizeCreateTemplate({
    ...existing,
    ...body,
    id,
    createdAt: existing?.createdAt || body["createdAt"] || now,
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
    ...template,
    previews: getCreateTemplatePreviews(template.id),
  }
}

export async function saveCreateTemplateFromCreation(
  id: string,
  body: Record<string, unknown> = {},
): Promise<CreateTemplate & { previews: (CatalogItem & { posterUrl: string | null })[] }> {
  const creation = findCreationJob(id)

  if (!creation) {
    throw httpError("Creation was not found.", 404)
  }

  return saveCreateTemplateFromRequest({
    id: body["id"],
    label: body["label"] || `${creation.modeLabel || "Creation"} ${String(creation.jobId || creation.id).slice(0, 8)}`,
    description: body["description"] || "",
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

function getCreateTemplatePreviews(templateId: string, limit = 6): (CatalogItem & { posterUrl: string | null })[] {
  const rows = getCatalogDb().prepare("SELECT item_json FROM media_items ORDER BY created_at DESC, id ASC").all().filter(isCatalogItemRow)

  const items = rows
    .map((row) => parseJson(row["item_json"], null))
    .filter((item): item is CatalogItem => isCatalogItem(item) && item.templateId === templateId)
    .slice(0, limit)

  return items.map(toPublicCatalogItem)
}

export async function importCreateTemplateFromHistory(body: Record<string, unknown>): Promise<CreateTemplate> {
  const jobId = typeof body["jobId"] === "string" ? body["jobId"] : null
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
    id: body["id"] || templateIdFromLabel(body["label"]) || templateIdFromJob(job),
    label: body["label"] || templateLabelFromJob(job),
    type: "video",
    settings: {
      modeId: "custom-video",
      params: {
        prompt: job.prompt,
        negativePrompt: job.negative_prompt || job.negativePrompt || "",
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

  return template
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

function isCatalogItemRow(value: unknown): value is CatalogItemRow {
  return isRecord(value) && typeof value["item_json"] === "string"
}
