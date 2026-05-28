import { Copy } from "lucide-react"

import { Fact } from "@/components/common/Fact"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatBytes, formatDate, formatDuration } from "@/lib/format"
import { isImageItem, mediaUrlForItem } from "@/lib/media"
import type { CatalogItem } from "@/types/domain"

import { MediaPreview } from "./MediaPreview"

export function MediaDialog({
  item,
  open,
  onOpenChange,
  onCopy,
  onCreate,
  onAnimate,
  onUsePrompt,
}: {
  item: CatalogItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopy: (value: string | undefined, label: string) => void
  onCreate: (item: CatalogItem) => void
  onAnimate: (item: CatalogItem) => void
  onUsePrompt: (item: CatalogItem) => void
}) {
  const mediaUrl = mediaUrlForItem(item)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="itemDialog" className="detailDialog" showCloseButton>
        {item && (
          <>
            <DialogHeader className="dialogHeader">
              <DialogTitle id="detailTitle">{item.type ? `${item.type} media` : "Media details"}</DialogTitle>
              <DialogDescription id="detailMeta">
                {[
                  formatDate(item.createdAtIso),
                  formatDuration(item.duration),
                  item.size ? formatBytes(item.size) : "",
                  item.status,
                  item.localFile ? "downloaded" : "not local",
                ].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>
            <div className="dialogBody">
              <MediaPreview
                id="detailPreview"
                className="detailPreview"
                url={mediaUrl}
                label={item.prompt || item.id}
                fallback={item.downloadError || "No local media file"}
              />
              <div className="detailPanel">
                <section>
                  <h3>Prompt</h3>
                  <p id="detailPrompt" className="detailText">{item.prompt || "No prompt text"}</p>
                </section>
                {item.negativePrompt && (
                  <section id="negativePromptSection">
                    <h3>Negative prompt</h3>
                    <p id="detailNegativePrompt" className="detailText">{item.negativePrompt}</p>
                  </section>
                )}
                <dl id="detailFacts" className="detailFacts">
                  <Fact label="Job ID" value={item.id} />
                  <Fact label="Type" value={item.type} />
                  <Fact label="Status" value={item.status} />
                  <Fact label="Local file" value={item.localFile} />
                  <Fact label="Poster" value={item.thumbnailFile} />
                  <Fact label="Create mode" value={item.createModeId} />
                  <Fact label="Source kind" value={item.sourceKind} />
                  <Fact label="Source item" value={item.sourceItemId} />
                  <Fact label="Source URL" value={item.sourceUrl} />
                  <Fact label="Created locally" value={formatDate(item.createdLocallyAt)} />
                  <Fact label="SHA-256" value={item.sha256} />
                  <Fact label="Verified" value={formatDate(item.verifiedAt)} />
                  <Fact label="Duplicate of" value={item.duplicateOf} />
                  <Fact label="Output URL" value={item.outputUrl} />
                </dl>
                <div className="dialogActions">
                  <Button id="detailCopyPromptButton" onClick={() => onCopy(item.prompt, "Prompt copied")} disabled={!item.prompt}>
                    <Copy />
                    Copy prompt
                  </Button>
                  <Button id="detailCopyIdButton" variant="glass" onClick={() => onCopy(item.id, "ID copied")}>Copy ID</Button>
                  <Button id="detailCopyUrlButton" variant="glass" onClick={() => onCopy(item.outputUrl, "URL copied")} disabled={!item.outputUrl}>
                    Copy output URL
                  </Button>
                  <Button id="detailCreateButton" variant="glass" onClick={() => onCreate(item)} disabled={!isImageItem(item)}>Create from image</Button>
                  <Button id="detailAnimateButton" variant="glass" onClick={() => onAnimate(item)} disabled={!isImageItem(item)}>Animate image</Button>
                  <Button id="detailUsePromptButton" variant="glass" onClick={() => onUsePrompt(item)} disabled={!item.prompt}>Use prompt</Button>
                  <Button id="detailOpenLink" className="openLink" variant="glass" asChild>
                    <a href={mediaUrl || "#"} target="_blank" rel="noreferrer">Open media</a>
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
