import { parseCatalogItem, parseCreateParams, parseCreateSource, parseGeneratePornJob, parseRecord, parseRecordOrEmpty } from "./schemas.ts"
import type { CatalogItem, CreateParams, CreateSource, GeneratePornJob } from "./types.ts"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return parseRecord(value) !== null
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return parseRecord(value)
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return parseRecordOrEmpty(value)
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

export function paramsFromUnknown(value: unknown): CreateParams {
  return parseCreateParams(value)
}

export function isCreateSource(value: unknown): value is CreateSource {
  return parseCreateSource(value) !== null
}

export function requireCreateSource(value: unknown): CreateSource {
  const source = parseCreateSource(value)
  if (!source) {
    throw new Error("Source is required.")
  }

  return source
}

export function isGeneratePornJob(value: unknown): value is GeneratePornJob {
  return parseGeneratePornJob(value) !== null
}

export function isCatalogItem(value: unknown): value is CatalogItem {
  return parseCatalogItem(value) !== null
}

export async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => ({}))
  return recordOrEmpty(body)
}
