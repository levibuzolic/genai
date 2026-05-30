export const CREATE_POLL_MS = 2000
export const CREATE_IMAGE_ACCEPT_VALUES = ["image/jpeg", "image/png", "image/webp", "image/bmp"] as const
export const CREATE_IMAGE_ACCEPT = new Set<string>(CREATE_IMAGE_ACCEPT_VALUES)
export const CREATE_VIDEO_QUALITY_OPTIONS = [
  { label: "720p · 4s", resolution: "720p", duration: 4 },
  { label: "720p · 8s", resolution: "720p", duration: 8 },
  { label: "1080p · 10s", resolution: "1080p", duration: 10 },
  { label: "1080p · 15s", resolution: "1080p", duration: 15 },
] as const satisfies readonly { label: string; resolution: "720p" | "1080p"; duration: 4 | 8 | 10 | 15 }[]
export const CREATE_VIDEO_DEFAULT_QUALITY = "1080p-15"
export const CREATE_VIDEO_DEFAULT_RESOLUTION = "1080p"
export const CREATE_VIDEO_DEFAULT_DURATION = 15
export const CREATE_IMAGE_ASPECT_RATIO_OPTIONS = [
  { label: "Portrait · 3:4", value: "3:4" },
  { label: "Square · 1:1", value: "1:1" },
  { label: "Landscape · 4:3", value: "4:3" },
] as const satisfies readonly { label: string; value: "1:1" | "3:4" | "4:3" }[]
export const CREATE_IMAGE_DEFAULT_MODEL_ID = "qwen-image-2.0-pro"
export const CREATE_BUILTIN_TEMPLATE_SEEDS = [
  {
    id: "blowjob-video",
    label: "Blowjob",
    seedJobId: "fb62d491-b377-4c24-92ac-98e02e305bce",
    resolution: CREATE_VIDEO_DEFAULT_RESOLUTION,
    duration: CREATE_VIDEO_DEFAULT_DURATION,
  },
] as const satisfies readonly {
  id: string
  label: string
  seedJobId: string
  resolution: "720p" | "1080p"
  duration: number
}[]
export const CREATE_TERMINAL_STATUS_VALUES = ["done", "failed", "error", "cancelled", "canceled"] as const
export const CREATE_ACTIVE_STATUS_VALUES = ["submitted", "queued", "pending", "processing", "running", "in_progress"] as const
export const CREATE_TERMINAL_STATUSES = new Set<string>(CREATE_TERMINAL_STATUS_VALUES)
export const CREATE_ACTIVE_STATUSES = new Set<string>(CREATE_ACTIVE_STATUS_VALUES)
