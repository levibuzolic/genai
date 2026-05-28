import type { UploadSource } from "@/types/domain"

export const UPLOAD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"])

export function getImageFileFromTransfer(transfer: DataTransfer | null) {
  if (!transfer) return null
  const file = [...transfer.files].find((entry) => entry.type.startsWith("image/"))
  if (file) return file
  return [...transfer.items].find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile() || null
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => resolve(String(reader.result)))
    reader.addEventListener("error", () => reject(reader.error || new Error("Unable to read file.")))
    reader.readAsDataURL(file)
  })
}

export function sourceLabel(source: UploadSource) {
  if (source === "drop") return "Dropped"
  if (source === "paste") return "Pasted"
  return "Selected"
}

export function extensionForImageType(type: string) {
  if (type === "image/jpeg") return "jpg"
  if (type === "image/webp") return "webp"
  if (type === "image/bmp") return "bmp"
  return "png"
}
