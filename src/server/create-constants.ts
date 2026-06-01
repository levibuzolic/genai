export const CREATE_POLL_MS = 2000
export const CREATE_IMAGE_ACCEPT_VALUES = ["image/jpeg", "image/png", "image/webp", "image/bmp"] as const
export const CREATE_IMAGE_ACCEPT = new Set<string>(CREATE_IMAGE_ACCEPT_VALUES)
export const CREATE_VIDEO_MODEL_DEFINITIONS = [
  {
    id: "wan2.7-i2v",
    label: "Wan 2.7",
    dashscopeModelId: "wan2.7-i2v",
    host: "maas",
    protocol: "media",
    kind: "i2v",
    resolutions: ["720p", "1080p"],
    durations: [4, 8, 10, 15],
    tier: "pro",
    description: "Newest Wan with the most cinematic motion and detail.",
  },
  {
    id: "wan2.7-i2v-spicy",
    label: "Wan 2.7 Spicy",
    dashscopeModelId: "wan2.7-i2v-spicy",
    host: "maas",
    protocol: "media",
    kind: "i2v",
    resolutions: ["720p", "1080p"],
    durations: [4, 8, 10, 15],
    tier: "pro",
    description: "Wan 2.7 image-to-video tuned for explicit high-intensity motion.",
  },
  {
    id: "wan2.6-i2v-flash",
    label: "Wan 2.6 Flash",
    dashscopeModelId: "wan2.6-i2v-flash",
    host: "intl",
    protocol: "img_url",
    kind: "i2v",
    audio: true,
    resolutions: ["720p", "1080p"],
    durations: [4, 8, 10, 15],
    tier: "standard",
    description: "Fast Wan with native audio.",
  },
  {
    id: "wan2.2-i2v-plus",
    label: "Wan 2.2 Plus",
    dashscopeModelId: "wan2.2-i2v-plus",
    host: "maas",
    protocol: "img_url",
    kind: "i2v",
    fixedDuration: true,
    resolutions: ["1080p"],
    durations: [5],
    tier: "standard",
    description: "Reliable Wan 2.2 image-to-video with fixed short clips.",
  },
  {
    id: "happyhorse-1.0-i2v",
    label: "Happy Horse 1.0",
    dashscopeModelId: "happyhorse-1.0-i2v",
    host: "maas",
    protocol: "img_url",
    kind: "i2v",
    resolutions: ["720p", "1080p"],
    durations: [8, 15],
    qualityOptions: [
      { label: "720p · 8s", resolution: "720p", duration: 8 },
      { label: "1080p · 15s", resolution: "1080p", duration: 15 },
    ],
    tier: "standard",
    description: "Specialized image-to-video model captured in the new API HAR.",
  },
  {
    id: "wan2.7-t2v",
    label: "Wan 2.7 Text to Video",
    dashscopeModelId: "wan2.7-t2v",
    host: "maas",
    protocol: "t2v",
    kind: "t2v",
    defaultRatio: "16:9",
    resolutions: ["720p", "1080p"],
    durations: [4, 8, 10, 15],
    tier: "pro",
    description: "Generate video from a prompt without an image source.",
  },
] as const
export const CREATE_VIDEO_DEFAULT_MODEL_ID = "wan2.7-i2v"
export const CREATE_TEXT_VIDEO_DEFAULT_MODEL_ID = "wan2.7-t2v"
export const CREATE_VIDEO_QUALITY_OPTIONS = CREATE_VIDEO_MODEL_DEFINITIONS.flatMap((model) => {
  const options =
    "qualityOptions" in model
      ? model.qualityOptions
      : model.resolutions.flatMap((resolution) =>
          model.durations.map((duration) => ({
            label: `${resolution} · ${duration}s`,
            resolution,
            duration,
          })),
        )

  return options.map((option) =>
    Object.assign({}, option, {
      value: `${model.id}:${option.resolution}-${option.duration}`,
      modelId: model.id,
    }),
  )
})
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
