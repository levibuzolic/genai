import { z } from "zod"

import type {
  CatalogItem,
  CreateParams,
  CreateSource,
  CreationWorkflow,
  CreationWorkflowJob,
  GeneratePornJob,
  OrphanFile,
  TemplateSettings,
} from "./types.ts"

const stringOrNumberSchema = z.union([z.string(), z.number()])
const nullableStringSchema = z.string().nullish()
const nullableStringOrNumberSchema = stringOrNumberSchema.nullish()

export const RecordSchema = z.record(z.string(), z.unknown())
export const CreateParamsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]))
export const CreateSourceSchema = z.object({ kind: z.string().min(1) }).passthrough()

export const GeneratePornJobSchema = z
  .object({
    id: z.string(),
    user_id: nullableStringSchema,
    userId: nullableStringSchema,
    type: nullableStringSchema,
    prompt: nullableStringSchema,
    negative_prompt: nullableStringSchema,
    negativePrompt: nullableStringSchema,
    status: nullableStringSchema,
    output_url: nullableStringSchema,
    outputUrl: nullableStringSchema,
    input_url: nullableStringSchema,
    inputUrl: nullableStringSchema,
    duration: nullableStringOrNumberSchema,
    resolution: nullableStringSchema,
    seed: nullableStringOrNumberSchema,
    created_at: nullableStringOrNumberSchema,
    createdAt: nullableStringOrNumberSchema,
    external_task_id: nullableStringSchema,
    externalTaskId: nullableStringSchema,
    shared: z.boolean().nullish(),
    favorited: z.boolean().nullish(),
    error: nullableStringSchema,
    job_id: z.string().optional(),
  })
  .passthrough()

export const JobsPageResponseSchema = z
  .object({
    results: z.array(GeneratePornJobSchema),
  })
  .passthrough()

export const CatalogItemSchema = z
  .object({
    id: z.string(),
    userId: nullableStringSchema,
    type: nullableStringSchema,
    prompt: nullableStringSchema,
    negativePrompt: nullableStringSchema,
    status: nullableStringSchema,
    outputUrl: nullableStringSchema,
    inputUrl: nullableStringSchema,
    duration: z.number().nullish(),
    createdAt: nullableStringOrNumberSchema,
    createdAtIso: nullableStringSchema,
    externalTaskId: nullableStringSchema,
    shared: z.boolean().nullish(),
    favorited: z.boolean().nullish(),
    error: nullableStringSchema,
    updatedAt: nullableStringSchema,
    localFile: nullableStringSchema,
    size: z.number().nullish(),
    fileSize: z.number().nullish(),
    sha256: nullableStringSchema,
    verifiedAt: nullableStringSchema,
    contentType: nullableStringSchema,
    downloadedAt: nullableStringSchema,
    downloadError: nullableStringSchema,
    thumbnailFile: nullableStringSchema,
    thumbnailGeneratedAt: nullableStringSchema,
    thumbnailError: nullableStringSchema,
    duplicateOf: nullableStringSchema,
    duplicateGroupSize: z.number().nullish(),
    createModeId: nullableStringSchema,
    templateId: nullableStringSchema,
    templateLabel: nullableStringSchema,
    sourceKind: nullableStringSchema,
    sourceItemId: nullableStringSchema,
    sourceUrl: nullableStringSchema,
    createdLocallyAt: nullableStringSchema,
  })
  .passthrough()

export const OrphanFileSchema = z.object({
  localFile: z.string(),
  size: z.number(),
  fileSize: z.number().optional(),
  contentType: z.string(),
  sha256: z.string(),
  discoveredAt: z.string(),
})

export const TemplateSettingsSchema = z
  .object({
    modeId: z.string(),
    source: RecordSchema.nullable().optional(),
    params: CreateParamsSchema.catch({}),
  })
  .passthrough()

export const CreationWorkflowJobSchema = z
  .object({
    stepIndex: z.number(),
    jobId: z.string(),
    modeId: nullableStringSchema,
    status: nullableStringSchema,
  })
  .passthrough()

export const CreationWorkflowSchema = z
  .object({
    templateId: nullableStringSchema,
    currentStep: z.number(),
    activeJobId: z.string().nullable().default(null),
    steps: z.array(TemplateSettingsSchema),
    jobs: z.array(CreationWorkflowJobSchema),
    overrides: CreateParamsSchema.catch({}),
  })
  .passthrough()

export function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = RecordSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseRecordOrEmpty(value: unknown): Record<string, unknown> {
  return parseRecord(value) ?? {}
}

export function parseCreateParams(value: unknown): CreateParams {
  return CreateParamsSchema.catch({}).parse(value)
}

export function parseCreateSource(value: unknown): CreateSource | null {
  const parsed = CreateSourceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseGeneratePornJob(value: unknown): GeneratePornJob | null {
  const parsed = GeneratePornJobSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseJobsPageResponse(value: unknown): GeneratePornJob[] | null {
  const parsed = JobsPageResponseSchema.safeParse(value)
  return parsed.success ? parsed.data.results : null
}

export function parseCatalogItem(value: unknown): CatalogItem | null {
  const parsed = CatalogItemSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseOrphanFile(value: unknown): OrphanFile | null {
  const parsed = OrphanFileSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseTemplateSettings(value: unknown): TemplateSettings | null {
  const parsed = TemplateSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseCreationWorkflowJob(value: unknown): CreationWorkflowJob | null {
  const parsed = CreationWorkflowJobSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseCreationWorkflow(value: unknown): CreationWorkflow | null {
  const parsed = CreationWorkflowSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
