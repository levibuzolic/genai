import { z } from "zod"

import { parseRecordOrEmpty } from "./schemas.ts"

const optionalStringSchema = z.string().optional()
const optionalNullableStringSchema = z.string().nullish()

export const CreateApiResponseSchema = z.object({ job_id: optionalNullableStringSchema, error: optionalNullableStringSchema }).passthrough()

export const CreateSubmissionRequestSchema = z
  .object({
    modeId: optionalStringSchema,
    params: z.unknown().optional(),
    source: z.unknown().optional(),
    templateId: optionalStringSchema,
  })
  .passthrough()

export const CreateTemplateRequestSchema = z
  .object({
    createdAt: optionalStringSchema,
    description: z.unknown().optional(),
    id: z.unknown().optional(),
    label: z.unknown().optional(),
  })
  .passthrough()

export const ImportCreateTemplateRequestSchema = z
  .object({
    id: z.unknown().optional(),
    jobId: z.string().optional(),
    label: z.unknown().optional(),
  })
  .passthrough()

export const CreateTemplateRegistryInputSchema = z
  .object({
    templates: z.array(z.unknown()).catch([]),
    updatedAt: z.string().nullable().catch(null),
  })
  .catch({
    templates: [],
    updatedAt: null,
  })

export const CreateTemplateInputSchema = z
  .object({
    createdAt: optionalStringSchema,
    description: z.unknown().optional(),
    duration: z.unknown().optional(),
    endpoint: z.unknown().optional(),
    id: z.unknown().optional(),
    label: z.unknown().optional(),
    mediaType: z.unknown().optional(),
    modeId: z.unknown().optional(),
    negative_prompt: z.unknown().optional(),
    negativePrompt: z.unknown().optional(),
    params: z.unknown().optional(),
    prompt: z.unknown().optional(),
    resolution: z.unknown().optional(),
    seedJobId: optionalNullableStringSchema,
    settings: z.unknown().optional(),
    source: z.unknown().optional(),
    sourceCreationId: optionalNullableStringSchema,
    sourcePolicy: z.string().catch("image"),
    source_creation_id: z.unknown().optional(),
    templateType: z.unknown().optional(),
    type: z.unknown().optional(),
    updatedAt: optionalStringSchema,
    workflow: z.array(z.unknown()).catch([]),
  })
  .passthrough()

export function parseCreateApiResponse(value: unknown): { body: Record<string, unknown>; error: string | null; jobId: string | null } {
  const body = parseRecordOrEmpty(value)
  const parsed = CreateApiResponseSchema.parse(body)

  return {
    body,
    error: parsed.error || null,
    jobId: parsed.job_id || null,
  }
}

export function parseCreateSubmissionRequest(value: unknown): z.output<typeof CreateSubmissionRequestSchema> {
  return CreateSubmissionRequestSchema.parse(parseRecordOrEmpty(value))
}

export function parseCreateTemplateRequest(value: unknown): z.output<typeof CreateTemplateRequestSchema> {
  return CreateTemplateRequestSchema.parse(parseRecordOrEmpty(value))
}

export function parseImportCreateTemplateRequest(value: unknown): z.output<typeof ImportCreateTemplateRequestSchema> {
  return ImportCreateTemplateRequestSchema.parse(parseRecordOrEmpty(value))
}

export function parseCreateTemplateRegistryInput(value: unknown): z.output<typeof CreateTemplateRegistryInputSchema> {
  return CreateTemplateRegistryInputSchema.parse(value)
}

export function parseCreateTemplateInput(value: unknown): z.output<typeof CreateTemplateInputSchema> | null {
  const parsed = CreateTemplateInputSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
