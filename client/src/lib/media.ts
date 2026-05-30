import type { CatalogItem } from "@/types/domain"

const ACTIVE_MEDIA_STATUSES = new Set(["pending", "queued", "submitted", "processing", "running", "in_progress"])
const RENDERING_MEDIA_MAX_AGE_MS = 60 * 60 * 1000

export function mediaUrlForItem(item?: CatalogItem | null) {
  if (!item) return null
  return item.localFile ? `/media/${encodeURIPath(item.localFile)}` : item.outputUrl || null
}

export function isImageItem(item?: CatalogItem | null) {
  const value = item?.localFile || item?.outputUrl || ""
  return isImageUrl(value)
}

export function isVideoItem(item?: CatalogItem | null) {
  const value = item?.localFile || item?.outputUrl || ""
  return item?.type === "video" || isVideoUrl(value)
}

export function isPendingMediaItem(item?: CatalogItem | null) {
  if (!item || !ACTIVE_MEDIA_STATUSES.has(String(item.status || "").toLowerCase()) || mediaUrlForItem(item)) return false

  const startedAt = mediaItemRenderStartedAtMs(item)
  return startedAt !== null && Date.now() - startedAt < RENDERING_MEDIA_MAX_AGE_MS
}

export function isImageUrl(value = "") {
  return /\.(png|jpe?g|webp|bmp)(?:[?#].*)?$/i.test(value) || value.startsWith("data:image/")
}

export function isVideoUrl(value = "") {
  return /\.mp4(?:[?#].*)?$/i.test(value)
}

export function encodeURIPath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/")
}

function mediaItemRenderStartedAtMs(item: CatalogItem): number | null {
  for (const value of [item.createdAtIso, item.createdLocallyAt, item.createdAt, item.updatedAt]) {
    const timestamp = timestampMs(value)
    if (timestamp !== null) return timestamp
  }

  return null
}

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null
    return value > 1_000_000_000_000 ? value : value * 1000
  }

  if (typeof value !== "string") return null

  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
