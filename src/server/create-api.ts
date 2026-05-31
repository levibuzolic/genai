import { readFile } from "node:fs/promises"
import path from "node:path"

import { isImageItem, loadCatalog } from "./catalog.ts"
import { MEDIA_DIR } from "./config.ts"
import {
  CREATE_IMAGE_ACCEPT,
  CREATE_IMAGE_ASPECT_RATIO_OPTIONS,
  CREATE_IMAGE_DEFAULT_MODEL_ID,
  CREATE_VIDEO_QUALITY_OPTIONS,
  CREATE_VIDEO_DEFAULT_DURATION,
  CREATE_VIDEO_DEFAULT_RESOLUTION,
} from "./create-constants.ts"
import { assertCreateTextAllowed } from "./create-shared.ts"
import { imageBufferToCreateJpeg } from "./media-conversion.ts"
import { redactDataUrlFields } from "./redaction.ts"
import type { CatalogItem, CreateMode, CreateParams, CreateSource, GeneratePornJob, ResolvedCreateSource } from "./types.ts"
import { contentTypeFor } from "./utils.ts"

export type PublicCreateJob = {
  id: string
  type: string | null
  inputUrl: string | null
  prompt: string
  negativePrompt: string
  resolution: string | null
  duration: string | number | null
  seed: string | number | null
  externalTaskId: string | null
  outputUrl: string | null
  status: string | null
  error: string | null
  createdAt: string | number | null
  createdAtIso: string | null
}

export function buildCreateApiRequest(
  mode: CreateMode,
  source: ResolvedCreateSource | null,
  params: CreateParams = {},
): { body: Record<string, unknown>; publicRequest: Record<string, unknown> } {
  const body: Record<string, unknown> = {}
  const prompt = mode.fixed?.prompt || params["prompt"]

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Prompt is required.")
  }
  assertCreateTextAllowed(prompt, "Prompt")

  body["prompt"] = prompt.trim()

  if (mode.endpoint === "text2image") {
    body["modelId"] = params["modelId"] || mode.defaults?.["modelId"] || CREATE_IMAGE_DEFAULT_MODEL_ID
    body["aspectRatio"] = getImageAspectRatio(params, mode)
    if (params["seed"] !== undefined && params["seed"] !== "") {
      body["seed"] = params["seed"]
    }
    return {
      body,
      publicRequest: redactDataUrlFields(body),
    }
  }

  if (!source) {
    throw new Error("Source is required.")
  }

  if (source.isDataUrl) {
    body["image_base64"] = source.value
  } else {
    body["input_url"] = source.value
  }

  if (mode.endpoint === "video") {
    const quality = getVideoQuality(params, mode)
    body["resolution"] = quality.resolution
    body["duration"] = quality.duration

    const negativePrompt = mode.fixed?.negativePrompt ?? mode.fixed?.negative_prompt ?? params["negativePrompt"]
    if (negativePrompt) {
      assertCreateTextAllowed(negativePrompt, "Negative prompt")
      body["negative_prompt"] = negativePrompt
    }
  }

  if (mode.id === "custom-image" || mode.id === "custom-video") {
    body["seed"] = params["seed"] ?? mode.defaults?.["seed"] ?? null
  }

  return {
    body,
    publicRequest: redactDataUrlFields(body),
  }
}

function getImageAspectRatio(params: CreateParams, mode: CreateMode): string {
  const aspectRatio = String(params["aspectRatio"] || params["quality"] || mode.defaults?.["aspectRatio"] || "3:4")
  const allowed = CREATE_IMAGE_ASPECT_RATIO_OPTIONS.some((entry) => entry.value === aspectRatio)

  if (!allowed) {
    throw new Error("Unsupported image aspect ratio.")
  }

  return aspectRatio
}

function getVideoQuality(params: CreateParams, mode: CreateMode): { resolution: string; duration: number } {
  if (mode.kind === "template") {
    return {
      resolution: mode.fixed?.resolution || CREATE_VIDEO_DEFAULT_RESOLUTION,
      duration: Number(mode.fixed?.duration || CREATE_VIDEO_DEFAULT_DURATION),
    }
  }

  if (params["quality"]) {
    const option = CREATE_VIDEO_QUALITY_OPTIONS.find((entry) => `${entry.resolution}-${entry.duration}` === params["quality"])
    if (option) {
      return {
        resolution: option.resolution,
        duration: option.duration,
      }
    }
  }

  const resolution = String(params["resolution"] || mode.defaults?.["resolution"] || CREATE_VIDEO_DEFAULT_RESOLUTION)
  const duration = Number(params["duration"] || mode.defaults?.["duration"] || CREATE_VIDEO_DEFAULT_DURATION)
  const allowed = CREATE_VIDEO_QUALITY_OPTIONS.some((entry) => entry.resolution === resolution && entry.duration === duration)

  if (!allowed) {
    throw new Error("Unsupported video quality.")
  }

  return {
    resolution,
    duration,
  }
}

export async function resolveCreateSource(source: CreateSource | null | undefined): Promise<ResolvedCreateSource> {
  if (!source?.kind) {
    throw new Error("Source is required.")
  }

  if (source.kind === "url") {
    const url = validateCreateSourceUrl(source.url)
    return {
      value: url,
      isDataUrl: false,
      publicSource: {
        kind: "url",
        url,
      },
    }
  }

  if (source.kind === "upload") {
    const image = await normalizeCreateDataUrl(source.dataUrl)
    return {
      value: image.dataUrl,
      isDataUrl: true,
      publicSource: {
        kind: "upload",
        contentType: image.contentType,
        size: image.byteLength,
      },
    }
  }

  if (source.kind === "catalog") {
    const catalog = await loadCatalog()
    const item = catalog.items.find((entry) => entry.id === source.itemId)

    if (!item) {
      throw new Error("Catalog source item was not found.")
    }

    if (!isImageItem(item)) {
      throw new Error("Creation source must be an image.")
    }
    assertCreateTextAllowed(item.prompt, "Source prompt")
    assertCreateTextAllowed(item.negativePrompt, "Source negative prompt")

    if (item.outputUrl) {
      const url = validateCreateSourceUrl(item.outputUrl)
      return {
        value: url,
        isDataUrl: false,
        publicSource: {
          kind: "catalog",
          itemId: item.id,
          url,
        },
      }
    }

    if (!item.localFile) {
      throw new Error("Catalog source item does not have a usable image URL or local file.")
    }

    const image = await normalizeCreateDataUrl(await catalogItemToDataUrl(item))
    return {
      value: image.dataUrl,
      isDataUrl: true,
      publicSource: {
        kind: "catalog",
        itemId: item.id,
        contentType: image.contentType,
        size: image.byteLength,
      },
    }
  }

  throw new Error("Unsupported source kind.")
}

async function catalogItemToDataUrl(item: CatalogItem): Promise<string> {
  const filePath = path.resolve(MEDIA_DIR, item.localFile || "")
  const mediaRoot = path.resolve(MEDIA_DIR)

  if (!filePath.startsWith(`${mediaRoot}${path.sep}`)) {
    throw new Error("Catalog source file is outside the media directory.")
  }

  const contentType = contentTypeFor(filePath)
  if (!CREATE_IMAGE_ACCEPT.has(contentType)) {
    throw new Error("Catalog source file must be a supported image type.")
  }

  const bytes = await readFile(filePath)
  return `data:${contentType};base64,${bytes.toString("base64")}`
}

export function validateCreateSourceUrl(value: unknown): string {
  const source = String(value || "")
  if (!URL.canParse(source)) {
    throw new Error("Source URL is not valid.")
  }

  try {
    const url = new URL(source)
    if (url.protocol !== "https:") {
      throw new Error("Source URL must use https.")
    }

    return url.href
  } catch (error) {
    if (error instanceof Error && error.message === "Source URL must use https.") {
      throw error
    }

    throw new Error("Source URL is not valid.", { cause: error })
  }
}

function parseCreateDataUrl(value: unknown): { contentType: string; bytes: Buffer; byteLength: number } {
  const match = String(value || "").match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) {
    throw new Error("Upload source must be an image data URL.")
  }

  const contentType = match[1]?.toLowerCase()
  const payload = match[2]
  if (!contentType || !payload) {
    throw new Error("Upload source must be an image data URL.")
  }
  if (!CREATE_IMAGE_ACCEPT.has(contentType)) {
    throw new Error("Upload source must be a JPEG, PNG, WebP, or BMP image.")
  }

  const bytes = Buffer.from(payload, "base64")
  return {
    contentType,
    bytes,
    byteLength: bytes.byteLength,
  }
}

async function normalizeCreateDataUrl(value: unknown): Promise<{ dataUrl: string; contentType: string; byteLength: number }> {
  const parsed = parseCreateDataUrl(value)
  let output: Awaited<ReturnType<typeof imageBufferToCreateJpeg>>

  try {
    output = await imageBufferToCreateJpeg(parsed.bytes)
  } catch (error) {
    throw new Error("Upload source could not be decoded as a supported image.", { cause: error })
  }

  return {
    dataUrl: `data:image/jpeg;base64,${output.bytes.toString("base64")}`,
    contentType: "image/jpeg",
    byteLength: output.bytes.byteLength,
  }
}

export function toPublicCreateJob(job: GeneratePornJob): PublicCreateJob {
  return {
    id: job.id,
    type: job.type || null,
    inputUrl: job.input_url || null,
    prompt: job.prompt || "",
    negativePrompt: job.negative_prompt || "",
    resolution: job.resolution || null,
    duration: job.duration || null,
    seed: job.seed ?? null,
    externalTaskId: job.external_task_id || null,
    outputUrl: job.output_url || null,
    status: job.status || null,
    error: job.error || null,
    createdAt: job.created_at || null,
    createdAtIso: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : null,
  }
}
