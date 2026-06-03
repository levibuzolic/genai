import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Cpu,
  ExternalLink,
  FileType,
  HardDrive,
  Heart,
  ImageIcon,
  Play,
  RotateCcw,
  Timer,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { formatBytes, formatDate, formatDuration } from "@/lib/format"
import { isFailedMediaItem, isImageItem, mediaUrlForItem } from "@/lib/media"
import type { CatalogItem } from "@/types/domain"

import { MediaPreview } from "./MediaPreview"

function titleCase(value?: string | null): string {
  if (!value) return "Media"
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function MediaDialog({
  item,
  open,
  onOpenChange,
  onCopy,
  onCreate,
  onAnimate,
  onUsePrompt,
  onTryAgain,
  onDeleteRemote,
  onToggleFavorite,
  previousItem,
  nextItem,
  onPrevious,
  onNext,
  videoMuted,
  onVideoMutedChange,
}: {
  item: CatalogItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopy: (value: string | null | undefined, label: string) => void
  onCreate: (item: CatalogItem) => void
  onAnimate: (item: CatalogItem) => void
  onUsePrompt: (item: CatalogItem) => void
  onTryAgain: (item: CatalogItem) => void
  onDeleteRemote: (item: CatalogItem) => void
  onToggleFavorite: (item: CatalogItem) => void
  previousItem: CatalogItem | null
  nextItem: CatalogItem | null
  onPrevious: () => void
  onNext: () => void
  videoMuted: boolean
  onVideoMutedChange: (muted: boolean) => void
}) {
  const mediaUrl = mediaUrlForItem(item)
  const isFailed = Boolean(item && isFailedMediaItem(item))
  const canUsePrompt = Boolean(item?.prompt)
  const canUseImage = Boolean(item && isImageItem(item))
  const canTryAgain = Boolean(item && item.provider !== "playbox" && (item.createModeId || item.createParams || item.sourceKind))
  const isPlaybox = item?.provider === "playbox"
  const dialogOpen = open && Boolean(item)
  const modelId = item ? (item.modelId ?? item.model_id) : null
  const timeToGenerate = item?.timeToGenerateMs ? formatDuration(item.timeToGenerateMs / 1000) : null
  const mediaKind = item ? titleCase(item.type) : "Media"
  const statusLabel = item ? titleCase(isFailed ? "failed" : item.status || (item.localFile ? "downloaded" : "missing")) : ""
  const storageLabel = item?.localFile ? "Local" : "Not local"
  const providerLabel = isPlaybox ? "Playbox" : item?.provider ? titleCase(item.provider) : "Generated"
  const detailFacts = item
    ? [
        { Icon: CalendarDays, label: "Created", value: formatDate(item.createdAtIso) },
        { Icon: Clock3, label: "Duration", value: formatDuration(item.duration) },
        { Icon: HardDrive, label: "Size", value: item.size ? formatBytes(item.size) : "" },
        { Icon: Cpu, label: "Model", value: modelId },
        { Icon: Timer, label: "Generated", value: timeToGenerate },
        { Icon: FileType, label: "Source", value: item.sourceKind ? titleCase(item.sourceKind) : providerLabel },
      ].filter((fact) => fact.value)
    : []

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent
        id="itemDialog"
        className="detailDialog"
        aria-describedby="detailMeta"
        aria-labelledby="detailTitle"
        showCloseButton={false}
      >
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
                videoAutoPlay
                videoLoop
                videoMuted={videoMuted}
                onVideoMutedChange={onVideoMutedChange}
              />
              <div className="detailPanel">
                <header className="detailPanelHeader">
                  <div className="detailHeading">
                    <div className="detailKicker" aria-label="Media status">
                      <span>{mediaKind}</span>
                      <span>{statusLabel}</span>
                      <span>{storageLabel}</span>
                    </div>
                    <h2 className="detailTitleText">{mediaKind} Details</h2>
                    <p className="detailSubtitle">{[formatDate(item.createdAtIso), providerLabel, item.id].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Button
                    id="detailCloseButton"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    aria-label="Close details"
                    title="Close details"
                  >
                    <X />
                  </Button>
                </header>
                <div className="dialogActions" aria-label="Media actions">
                  <ButtonGroup className="detailActionGroup detailActionPrimary" aria-label="Create actions">
                    {canUsePrompt && (
                      <Button id="detailUsePromptButton" size="sm" onClick={() => onUsePrompt(item)}>
                        <WandSparkles />
                        Use prompt
                      </Button>
                    )}
                    {canTryAgain && (
                      <Button id="detailTryAgainButton" size="sm" variant="outline" onClick={() => onTryAgain(item)}>
                        <RotateCcw />
                        Try again
                      </Button>
                    )}
                    {canUseImage && (
                      <>
                        <Button id="detailCreateButton" size="sm" variant="outline" onClick={() => onCreate(item)}>
                          <ImageIcon />
                          Edit image
                        </Button>
                        <Button id="detailAnimateButton" size="sm" variant="outline" onClick={() => onAnimate(item)}>
                          <Play />
                          Custom video
                        </Button>
                      </>
                    )}
                    {mediaUrl && !isPlaybox && (
                      <Button id="detailOpenLink" className="openLink" size="sm" variant="outline" asChild>
                        <a href={mediaUrl} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open
                        </a>
                      </Button>
                    )}
                  </ButtonGroup>
                </div>
                <div className="detailPanelContent">
                  <section className="detailSection detailPromptSection">
                    <div className="detailSectionHeader">
                      <h3>Prompt</h3>
                      <Button
                        id="detailCopyPromptButton"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => onCopy(item.prompt, "Prompt copied")}
                        disabled={!item.prompt}
                        title="Copy prompt"
                        aria-label="Copy prompt"
                      >
                        <Copy />
                      </Button>
                    </div>
                    <p id="detailPrompt" className="detailText">
                      {item.prompt || "No prompt text"}
                    </p>
                  </section>
                  {detailFacts.length > 0 && (
                    <section className="detailSection" aria-label="Media facts">
                      <div className="detailFactGrid">
                        {detailFacts.map(({ Icon, label, value }) => (
                          <div className="detailFact" key={label}>
                            <Icon aria-hidden="true" />
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {item.negativePrompt && (
                    <section id="negativePromptSection" className="detailSection">
                      <h3>Negative prompt</h3>
                      <p id="detailNegativePrompt" className="detailText">
                        {item.negativePrompt}
                      </p>
                    </section>
                  )}
                  <ButtonGroup className="detailActionGroup detailActionSecondary" aria-label="Copy actions">
                    <Button id="detailCopyIdButton" size="sm" variant="ghost" onClick={() => onCopy(item.id, "ID copied")}>
                      ID
                    </Button>
                    {item.outputUrl && (
                      <Button id="detailCopyUrlButton" size="sm" variant="ghost" onClick={() => onCopy(item.outputUrl, "URL copied")}>
                        URL
                      </Button>
                    )}
                    {!isFailed && (
                      <Button id="detailFavoriteButton" size="sm" variant="ghost" onClick={() => onToggleFavorite(item)}>
                        <Heart className={item.favorited ? "fill-current" : undefined} />
                        {item.favorited ? "Unfavorite" : "Favorite"}
                      </Button>
                    )}
                    <Button id="detailDeleteRemoteButton" size="sm" variant="ghost" onClick={() => onDeleteRemote(item)}>
                      <Trash2 />
                      Delete
                    </Button>
                  </ButtonGroup>
                </div>
                <div className="detailNav" aria-label="Gallery navigation">
                  <Button
                    id="detailPreviousButton"
                    className="detailNavButton"
                    size="sm"
                    variant="secondary"
                    onClick={onPrevious}
                    disabled={!previousItem}
                    aria-label={previousItem ? "Previous media" : "No previous media"}
                    title={previousItem ? "Previous media" : "No previous media"}
                  >
                    <ChevronLeft />
                    Previous
                  </Button>
                  <Button
                    id="detailNextButton"
                    className="detailNavButton"
                    size="sm"
                    variant="secondary"
                    onClick={onNext}
                    disabled={!nextItem}
                    aria-label={nextItem ? "Next media" : "No next media"}
                    title={nextItem ? "Next media" : "No next media"}
                  >
                    Next
                    <ChevronRight />
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
