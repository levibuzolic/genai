import { Copy, ExternalLink, FileDown, Sparkles } from "lucide-react"

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

  return (
    <article
      className={cn("card media-card group", view === "list" && "is-list")}
      data-media={isVideo ? "video" : isImage ? "image" : "missing"}
      data-media-loaded="true"
    >
      <a className="previewLink preview" href={mediaUrl || "#"} target="_blank" rel="noreferrer">
        {isVideo && mediaUrl ? (
          <video src={mediaUrl} poster={item.posterUrl} muted playsInline preload="metadata" controls aria-label={item.prompt || item.id} />
        ) : isImage && mediaUrl ? (
          <img src={mediaUrl} alt={item.prompt || item.id} loading="lazy" decoding="async" />
        ) : (
          <div className="missing-preview">
            <FileDown className="size-6" />
            <span>{item.downloadError || "No local file"}</span>
          </div>
        )}
        {isVideo && <span className="durationBadge">{formatDuration(item.duration)}</span>}
      </a>
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
              <Button className="cardCreateButton" size="sm" variant="outline" onClick={onCreate}>
                <Sparkles />
                Create
              </Button>
            )}
            <Button className="detailsButton" size="sm" variant="outline" onClick={onDetails}>
              Details
            </Button>
            <Button className="copyPromptButton" size="sm" variant="outline" disabled={!item.prompt} onClick={onCopyPrompt}>
              <Copy />
              Prompt
            </Button>
            <Button className="openLink" size="sm" variant="outline" asChild>
              <a href={mediaUrl || "#"} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}
