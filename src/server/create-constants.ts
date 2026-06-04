export const CREATE_POLL_MS = 2000
export const CREATE_IMAGE_ACCEPT_VALUES = ["image/jpeg", "image/png", "image/webp", "image/bmp"] as const
export const CREATE_IMAGE_ACCEPT = new Set<string>(CREATE_IMAGE_ACCEPT_VALUES)
export const CREATE_STILLHEAT_MODEL_ID = "stillheat"
export const CREATE_STILLHEAT_EDIT_MODEL_ID = "stillheat-edit"
export const CREATE_MOTIONHEAT_MODEL_ID = "motionheat"
export const CREATE_REALISM_DEFAULT = 0.55
export const CREATE_REALISM_MIN = 0.2
export const CREATE_REALISM_MAX = 0.9
export const CREATE_VIDEO_RESOLUTIONS = ["720p", "1080p"] as const
export const CREATE_VIDEO_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const
export const CREATE_VIDEO_COIN_COST_PER_SECOND = {
  "720p": 12,
  "1080p": 18,
} as const satisfies Record<(typeof CREATE_VIDEO_RESOLUTIONS)[number], number>
export const CREATE_VIDEO_QUALITY_OPTIONS = CREATE_VIDEO_RESOLUTIONS.flatMap((resolution) =>
  CREATE_VIDEO_DURATIONS.map((duration) => ({
    value: `${resolution}-${duration}`,
    label: `${resolution} · ${duration}s`,
    resolution,
    duration,
    coinCost: CREATE_VIDEO_COIN_COST_PER_SECOND[resolution] * duration,
  })),
)
export const CREATE_VIDEO_DEFAULT_QUALITY = "720p-4"
export const CREATE_VIDEO_DEFAULT_RESOLUTION = "720p"
export const CREATE_VIDEO_DEFAULT_DURATION = 4
export const CREATE_IMAGE_ASPECT_RATIO_OPTIONS = [
  { label: "Portrait · 3:4", value: "3:4" },
  { label: "Square · 1:1", value: "1:1" },
  { label: "Landscape · 4:3", value: "4:3" },
  { label: "Vertical · 9:16", value: "9:16" },
] as const satisfies readonly { label: string; value: "1:1" | "3:4" | "4:3" | "9:16" }[]
export const CREATE_BUILTIN_TEMPLATE_SEEDS: readonly {
  id: string
  label: string
  seedJobId: string
  resolution: "720p" | "1080p"
  duration: number
}[] = []
export const CREATE_TERMINAL_STATUS_VALUES = ["done", "failed", "error", "cancelled", "canceled"] as const
export const CREATE_ACTIVE_STATUS_VALUES = ["submitted", "queued", "pending", "processing", "running", "in_progress"] as const
export const CREATE_TERMINAL_STATUSES = new Set<string>(CREATE_TERMINAL_STATUS_VALUES)
export const CREATE_ACTIVE_STATUSES = new Set<string>(CREATE_ACTIVE_STATUS_VALUES)
