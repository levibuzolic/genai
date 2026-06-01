import {
  AlertTriangle,
  Clapperboard,
  Copy,
  FileDown,
  FileQuestion,
  Heart,
  ImageIcon,
  Info,
  Loader2,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { formatDuration, formatShortMonthDay } from "@/lib/format"
import { isFailedMediaItem, isImageItem, isPendingMediaItem, isVideoItem, mediaUrlForItem } from "@/lib/media"
import { cn } from "@/lib/utils"
import type { CatalogItem, ViewMode } from "@/types/domain"

function mediaTypeBadge(item: CatalogItem, isVideo: boolean, isImage: boolean) {
  if (isVideo) return { Icon: Clapperboard, label: "Video" }
  if (item.type === "edit") return { Icon: WandSparkles, label: "Edit" }
  if (isImage) return { Icon: ImageIcon, label: item.type || "Image" }
  return { Icon: FileQuestion, label: item.type || "Unknown media" }
}

type MediaCardProps = {
  item: CatalogItem
  view: ViewMode
  onDetails: () => void
  onCopyPrompt: () => void
  onCreate: () => void
  onDeleteRemote: () => void
  onToggleFavorite: () => void
}

export const MediaCard = React.memo(function MediaCard({
  item,
  view,
  onDetails,
  onCopyPrompt,
  onCreate,
  onDeleteRemote,
  onToggleFavorite,
}: MediaCardProps) {
  const [previewActive, setPreviewActive] = React.useState(false)
  const mediaUrl = mediaUrlForItem(item)
  const isVideo = isVideoItem(item)
  const isImage = isImageItem(item)
  const isPendingMedia = isPendingMediaItem(item)
  const isFailed = isFailedMediaItem(item)
  const isDeleted = Boolean(item.remoteDeletedAt)
  const badge = mediaTypeBadge(item, isVideo, isImage)
  const previewLabel = isVideo ? "Open video details" : isImage ? "Open image details" : "Open media details"
  const deletedBadge = isDeleted ? (
    <span className="deletedMediaBadge" title="Deleted remotely">
      <Trash2 aria-hidden="true" />
      <span className="sr-only">Deleted remotely</span>
    </span>
  ) : null
  const failedBadge = isFailed ? (
    <span className="failedMediaBadge" title="Generation failed">
      <AlertTriangle aria-hidden="true" />
      <span className="sr-only">Failed generation</span>
    </span>
  ) : null

  return (
    <article
      className={cn("card media-card group", view === "list" && "is-list", isDeleted && "is-deleted", isFailed && "is-failed")}
      data-media={isVideo ? "video" : isImage ? "image" : "missing"}
      data-media-state={isFailed ? "failed" : isPendingMedia ? "loading" : mediaUrl ? "ready" : "missing"}
      data-remote-deleted={isDeleted ? "true" : undefined}
      data-media-loaded="true"
      onMouseEnter={() => setPreviewActive(true)}
      onMouseLeave={() => setPreviewActive(false)}
      onFocus={() => setPreviewActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreviewActive(false)
      }}
    >
      {isPendingMedia ? (
        <div className="preview pendingPreview">
          <button className="mediaPreviewButton" type="button" onClick={onDetails} aria-label={previewLabel}>
            <output className="pending-preview" aria-live="polite">
              <Loader2 className="size-6 animate-spin" />
              <span>{isVideo ? "Rendering video" : "Rendering media"}</span>
            </output>
          </button>
          <span className="previewOpenBadge" aria-hidden="true">
            <Info className="size-4" />
          </span>
          <span className="mediaTypeBadge" title={badge.label} aria-label={badge.label}>
            <badge.Icon />
          </span>
          {deletedBadge}
        </div>
      ) : isVideo && mediaUrl && !isFailed ? (
        <div className="preview videoPreview">
          <button className="mediaPreviewButton" type="button" onClick={onDetails} aria-label={previewLabel}>
            {item.posterUrl ? (
              <img
                className={cn("videoPoster", previewActive && "is-hidden")}
                src={item.posterUrl}
                alt={item.prompt || item.id}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className={cn("thumbnailFallback", previewActive && "is-hidden")}>Thumbnail pending</span>
            )}
            {previewActive && (
              // oxlint-disable-next-line jsx-a11y/media-has-caption -- Generated/local gallery preview videos do not include caption tracks.
              <video className="hoverPreviewVideo" src={mediaUrl} autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
            )}
          </button>
          <span className="previewOpenBadge" aria-hidden="true">
            <Info className="size-4" />
          </span>
          <span className="mediaTypeBadge" title={badge.label} aria-label={badge.label}>
            <badge.Icon />
          </span>
          <span className="durationBadge">{formatDuration(item.duration)}</span>
          {deletedBadge}
        </div>
      ) : isImage && mediaUrl && !isFailed ? (
        <div className="preview imagePreview">
          <button className="mediaPreviewButton" type="button" onClick={onDetails} aria-label={previewLabel}>
            <img src={mediaUrl} alt={item.prompt || item.id} loading="lazy" decoding="async" />
          </button>
          <span className="previewOpenBadge" aria-hidden="true">
            <Info className="size-4" />
          </span>
          <span className="mediaTypeBadge" title={badge.label} aria-label={badge.label}>
            <badge.Icon />
          </span>
          {deletedBadge}
        </div>
      ) : isFailed ? (
        <div className="preview failedPreview">
          <button className="mediaPreviewButton" type="button" onClick={onDetails} aria-label={previewLabel}>
            <div className="failed-preview">
              <AlertTriangle className="size-6" />
              <span>{item.downloadError || "Generation failed"}</span>
            </div>
          </button>
          <span className="previewOpenBadge" aria-hidden="true">
            <Info className="size-4" />
          </span>
          <span className="mediaTypeBadge" title={badge.label} aria-label={badge.label}>
            <badge.Icon />
          </span>
          {deletedBadge}
          {failedBadge}
        </div>
      ) : (
        <div className="preview missingPreview">
          <button className="mediaPreviewButton" type="button" onClick={onDetails} aria-label={previewLabel}>
            <div className="missing-preview">
              <FileDown className="size-6" />
              <span>{item.downloadError || "No local file"}</span>
            </div>
          </button>
          <span className="previewOpenBadge" aria-hidden="true">
            <Info className="size-4" />
          </span>
          <span className="mediaTypeBadge" title={badge.label} aria-label={badge.label}>
            <badge.Icon />
          </span>
          {deletedBadge}
        </div>
      )}
      <div className="cardBody">
        <div className="cardMeta">
          {[
            formatShortMonthDay(item.createdAtIso),
            isPendingMedia ? "rendering" : "",
            isFailed ? "failed" : "",
            item.createModeId ? "created here" : "",
            item.remoteDeletedAt ? "remote deleted" : "",
            item.localFile && !item.sha256 ? "unverified" : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <p className="prompt">{item.prompt || "No prompt text"}</p>
        <div className="cardFooter">
          <div className="cardActions">
            {isImage && (
              <Button className="cardCreateButton" size="icon-sm" variant="outline" onClick={onCreate} title="Create" aria-label="Create">
                <Sparkles />
              </Button>
            )}
            {!isFailed && (
              <Button
                className={cn("favoriteButton", item.favorited && "is-favorited")}
                size="icon-sm"
                variant="outline"
                onClick={onToggleFavorite}
                title={item.favorited ? "Unfavorite" : "Favorite"}
                aria-label={item.favorited ? "Unfavorite" : "Favorite"}
              >
                <Heart className={item.favorited ? "fill-current" : undefined} />
              </Button>
            )}
            <Button
              className="copyPromptButton"
              size="icon-sm"
              variant="outline"
              disabled={!item.prompt}
              onClick={onCopyPrompt}
              title="Copy prompt"
              aria-label="Prompt"
            >
              <Copy />
            </Button>
            <Button
              className="deleteRemoteButton"
              size="icon-sm"
              variant="outline"
              onClick={onDeleteRemote}
              title="Delete remote"
              aria-label="Delete remote"
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}, areMediaCardPropsEqual)

function areMediaCardPropsEqual(left: MediaCardProps, right: MediaCardProps): boolean {
  return left.view === right.view && JSON.stringify(left.item) === JSON.stringify(right.item)
}
