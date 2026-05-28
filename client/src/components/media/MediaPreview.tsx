import { isVideoUrl } from "@/lib/media"

export function MediaPreview({
  id,
  className,
  url,
  label,
  fallback,
}: {
  id: string
  className: string
  url?: string | null | undefined
  label?: string | undefined
  fallback: string
}) {
  if (!url) return <div id={id} className={className}>{fallback}</div>
  if (isVideoUrl(url)) {
    return (
      <div id={id} className={className}>
        <video src={url} controls muted playsInline preload="metadata" />
      </div>
    )
  }
  return (
    <div id={id} className={className}>
      <img src={url} alt={label || "Media preview"} />
    </div>
  )
}
