import type { CatalogItem } from "@/types/domain"

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
  return isVideoUrl(value)
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
