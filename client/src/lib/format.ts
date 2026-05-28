import type { CatalogItem, ItemsResponse } from "@/types/domain"

export function formatRange(data: ItemsResponse) {
  if (data.total === 0) return "0"
  const start = (data.page - 1) * data.pageSize + 1
  const end = Math.min(data.total, data.page * data.pageSize)
  return `${formatNumber(start)}-${formatNumber(end)}`
}

export function formatDate(value?: string | number | null) {
  if (!value) return ""
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function formatTime(value?: string | null) {
  if (!value) return ""
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(new Date(value))
}

export function formatBytes(bytes?: number | null) {
  if (!bytes) return ""
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let index = 0

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatDuration(value?: number | string | null) {
  const seconds = Math.round(Number(value || 0))
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, "0")}`
}

export function formatNumber(value?: number | null) {
  return new Intl.NumberFormat().format(value || 0)
}

export function formatSourceOption(item: CatalogItem) {
  return [item.type || "image", formatDate(item.createdAtIso), item.id.slice(0, 8), item.localFile ? "local" : "remote"]
    .filter(Boolean)
    .join(" · ")
}
