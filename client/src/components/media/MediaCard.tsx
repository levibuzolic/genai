import { Copy, ExternalLink, FileDown, Info, Play, Sparkles } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { formatBytes, formatDate, formatDuration } from "@/lib/format"
import { isImageItem, isVideoItem, mediaUrlForItem } from "@/lib/media"
import { cn } from "@/lib/utils"
import type { CatalogItem, ViewMode } from "@/types/domain"

export function MediaCard({
  item,
  view,
  onDetails,
  onCopyPrompt,
  onCreate,
}: {
  item: CatalogItem
  view: ViewMode
  onDetails: () => void
  onCopyPrompt: () => void
  onCreate: () => void
}) {
  const mediaUrl = mediaUrlForItem(item)
  const isVideo = isVideoItem(item)
  const isImage = isImageItem(item)
  const [videoActive, setVideoActive] = React.useState(false)

  return (
    <article
      className={cn("card media-card group", view === "list" && "is-list")}
      data-media={isVideo ? "video" : isImage ? "image" : "missing"}
      data-media-loaded="true"
    >
      {isVideo && mediaUrl ? (
        <div className="preview videoPreview">
          {videoActive ? (
            <video
              src={mediaUrl}
              poster={item.posterUrl}
              muted
              playsInline
              preload="metadata"
              controls
              autoPlay
              aria-label={item.prompt || item.id}
            />
          ) : (
            <button className="videoPosterButton" type="button" onClick={() => setVideoActive(true)} aria-label="Play video">
              {item.posterUrl ? (
                <img src={item.posterUrl} alt={item.prompt || item.id} loading="lazy" decoding="async" />
              ) : (
                <span className="videoPosterFallback">Poster pending</span>
              )}
              <span className="videoPlayBadge">
                <Play className="size-4 fill-current" />
              </span>
            </button>
          )}
          <span className="durationBadge">{formatDuration(item.duration)}</span>
        </div>
      ) : (
        <a className="previewLink preview" href={mediaUrl || "#"} target="_blank" rel="noreferrer">
          {isImage && mediaUrl ? (
            <img src={mediaUrl} alt={item.prompt || item.id} loading="lazy" decoding="async" />
          ) : (
            <div className="missing-preview">
              <FileDown className="size-6" />
              <span>{item.downloadError || "No local file"}</span>
            </div>
          )}
        </a>
      )}
      <div className="cardBody">
        <div className="cardMeta">
          {[
            item.type || "media",
            formatDate(item.createdAtIso),
            formatDuration(item.duration),
            item.size ? formatBytes(item.size) : "",
            item.createModeId ? "created here" : "",
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
            <Button className="detailsButton" size="icon-sm" variant="outline" onClick={onDetails} title="Details" aria-label="Details">
              <Info />
            </Button>
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
            <Button className="openLink" size="icon-sm" variant="outline" asChild>
              <a href={mediaUrl || "#"} target="_blank" rel="noreferrer" title="Open" aria-label="Open">
                <ExternalLink />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}
