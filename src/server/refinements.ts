import type { CatalogItem, CreateParams, CreateSource, GeneratePornJob } from "./types.ts"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

export function paramsFromUnknown(value: unknown): CreateParams {
  const params: CreateParams = {}
  if (!isRecord(value)) {
    return params
  }

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      params[key] = entry
    }
  }

  return params
}

export function isCreateSource(value: unknown): value is CreateSource {
  return isRecord(value) && typeof value["kind"] === "string"
}

export function requireCreateSource(value: unknown): CreateSource {
  if (!isCreateSource(value)) {
    throw new Error("Source is required.")
  }

  return value
}

export function isGeneratePornJob(value: unknown): value is GeneratePornJob {
  return isRecord(value) && typeof value["id"] === "string"
}

export function isCatalogItem(value: unknown): value is CatalogItem {
  return isRecord(value) && typeof value["id"] === "string"
}

export async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}
