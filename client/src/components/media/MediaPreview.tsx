import { isVideoUrl } from "@/lib/media"

export function MediaPreview({
  id,
  className,
  url,
  label,
  fallback,
  videoAutoPlay = false,
  videoLoop = false,
  videoMuted = true,
  onVideoMutedChange,
}: {
  id: string
  className: string
  url?: string | null | undefined
  label?: string | undefined
  fallback: string
  videoAutoPlay?: boolean | undefined
  videoLoop?: boolean | undefined
  videoMuted?: boolean | undefined
  onVideoMutedChange?: ((muted: boolean) => void) | undefined
}) {
  if (!url)
    return (
      <div id={id} className={className} data-media="missing">
        {fallback}
      </div>
    )
  if (isVideoUrl(url)) {
    return (
      <div id={id} className={className} data-media="video">
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Generated/local preview videos do not include caption tracks. */}
        <video
          src={url}
          controls
          muted={videoMuted}
          autoPlay={videoAutoPlay}
          loop={videoLoop}
          playsInline
          preload={videoAutoPlay ? "auto" : "metadata"}
          aria-label={label || "Media preview"}
          onVolumeChange={(event) => onVideoMutedChange?.(event.currentTarget.muted)}
        />
      </div>
    )
  }
  return (
    <div id={id} className={className} data-media="image">
      <img src={url} alt={label || "Media preview"} />
    </div>
  )
}
