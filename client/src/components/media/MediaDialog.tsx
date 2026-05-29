import { Copy, ExternalLink, ImageIcon, Play, WandSparkles } from "lucide-react"

import { Fact } from "@/components/common/Fact"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
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
  onCopy: (value: string | null | undefined, label: string) => void
  onCreate: (item: CatalogItem) => void
  onAnimate: (item: CatalogItem) => void
  onUsePrompt: (item: CatalogItem) => void
}) {
  const mediaUrl = mediaUrlForItem(item)
  const canUsePrompt = Boolean(item?.prompt)
  const canUseImage = Boolean(item && isImageItem(item))
  const dialogOpen = open && Boolean(item)

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent id="itemDialog" className="detailDialog" aria-describedby="detailMeta" aria-labelledby="detailTitle" showCloseButton>
        {item && (
          <>
            <DialogTitle id="detailTitle" className="sr-only">
              {item.type ? `${item.type} media` : "Media details"}
            </DialogTitle>
            <DialogDescription id="detailMeta" className="sr-only">
              {[
                formatDate(item.createdAtIso),
                formatDuration(item.duration),
                item.size ? formatBytes(item.size) : "",
                item.status,
                item.localFile ? "downloaded" : "not local",
              ]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
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
                  <p id="detailPrompt" className="detailText">
                    {item.prompt || "No prompt text"}
                  </p>
                </section>
                {item.negativePrompt && (
                  <section id="negativePromptSection">
                    <h3>Negative prompt</h3>
                    <p id="detailNegativePrompt" className="detailText">
                      {item.negativePrompt}
                    </p>
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
                <div className="dialogActions" aria-label="Media actions">
                  <ButtonGroup className="detailActionGroup" aria-label="Create actions">
                    {canUsePrompt && (
                      <Button id="detailUsePromptButton" size="sm" onClick={() => onUsePrompt(item)}>
                        <WandSparkles />
                        Use prompt
                      </Button>
                    )}
                    {canUseImage && (
                      <>
                        <Button id="detailCreateButton" size="sm" variant="outline" onClick={() => onCreate(item)}>
                          <ImageIcon />
                          Create
                        </Button>
                        <Button id="detailAnimateButton" size="sm" variant="outline" onClick={() => onAnimate(item)}>
                          <Play />
                          Animate
                        </Button>
                      </>
                    )}
                    {mediaUrl && (
                      <Button id="detailOpenLink" className="openLink" size="sm" variant="outline" asChild>
                        <a href={mediaUrl} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open
                        </a>
                      </Button>
                    )}
                  </ButtonGroup>

                  <ButtonGroup className="detailActionGroup detailActionSecondary" aria-label="Copy actions">
                    <Button
                      id="detailCopyPromptButton"
                      size="sm"
                      variant="ghost"
                      onClick={() => onCopy(item.prompt, "Prompt copied")}
                      disabled={!item.prompt}
                    >
                      <Copy />
                      Prompt
                    </Button>
                    <Button id="detailCopyIdButton" size="sm" variant="ghost" onClick={() => onCopy(item.id, "ID copied")}>
                      ID
                    </Button>
                    {item.outputUrl && (
                      <Button id="detailCopyUrlButton" size="sm" variant="ghost" onClick={() => onCopy(item.outputUrl, "URL copied")}>
                        URL
                      </Button>
                    )}
                  </ButtonGroup>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
