import { Clapperboard, Clock3, CopyPlus, ExternalLink, ImageIcon, Loader2, RefreshCw, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate, formatTime } from "@/lib/format"
import { isImageUrl, isVideoUrl } from "@/lib/media"
import type { Creation, CreationEvent } from "@/types/domain"

function statusVariant(status: string) {
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return "destructive"
  if (["done", "success", "completed"].includes(status)) return "default"
  if (status === "draft") return "secondary"
  return "outline"
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ")
}

function sourceLabel(creation: Creation) {
  if (creation.source?.kind === "catalog") {
    const itemId = typeof creation.source.itemId === "string" ? creation.source.itemId : ""
    return itemId ? `Collection ${itemId.slice(0, 8)}` : "Collection source"
  }
  if (creation.source?.kind === "url") return "URL source"
  if (creation.source?.kind === "upload") return "Upload source"
  return "No source saved"
}

function creationTitle(creation: Creation) {
  const prompt = creation.params?.["prompt"] || creation.job?.["prompt"]
  if (typeof prompt === "string" && prompt) return prompt
  return creation.modeLabel || creation.modeId || "Creation"
}

function creationTime(creation: Creation) {
  return creation.updatedAt || creation.submittedAt || creation.createdLocallyAt || creation.createdAtIso
}

function creationPreviewUrl(creation: Creation) {
  const source = creation.source
  const candidates = [
    creation.outputUrl,
    creation.inputUrl,
    source && "dataUrl" in source ? source.dataUrl : null,
    source && "url" in source ? source.url : null,
  ]

  return candidates.find((value): value is string => typeof value === "string" && isImageUrl(value)) || null
}

function isVideoCreation(creation: Creation) {
  return (
    creation.mediaType === "video" ||
    isVideoUrl(creation.outputUrl || "") ||
    String(creation.modeId || "")
      .toLowerCase()
      .includes("video")
  )
}

export function CreationHistoryPanel({
  creations,
  activeCount,
  loading,
  selectedCreation,
  selectedEvents,
  statusMessage,
  onRefresh,
  onDetails,
  onCloseDetails,
  onDuplicate,
  onSaveTemplate,
}: {
  creations: Creation[]
  activeCount: number
  loading: boolean
  selectedCreation: Creation | null
  selectedEvents: CreationEvent[]
  statusMessage: string
  onRefresh: () => Promise<void>
  onDetails: (creation: Creation) => Promise<void>
  onCloseDetails: () => void
  onDuplicate: (creation: Creation) => Promise<void>
  onSaveTemplate: (creation: Creation) => Promise<void>
}) {
  const active = creations.filter((creation) => creation.active)
  const recent = creations.filter((creation) => !creation.active).slice(0, 8)

  return (
    <section className="creationHistory" aria-label="Creation history">
      <div className="creationHistoryHeader">
        <div>
          <h3>Creation history</h3>
          <p>{activeCount > 0 ? `${activeCount} generation${activeCount === 1 ? "" : "s"} still running` : "No active generations"}</p>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => void onRefresh()}
          disabled={loading}
          aria-label="Refresh history"
          title="Refresh history"
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>

      {statusMessage && <p className="creationHistoryStatus">{statusMessage}</p>}

      <div className="creationHistorySections">
        <div className="creationHistoryGroup is-active">
          <span className="creationHistoryEyebrow">Active</span>
          {active.length ? (
            active.map((creation) => (
              <CreationHistoryRow
                key={creation.id}
                creation={creation}
                prominent
                onDetails={onDetails}
                onDuplicate={onDuplicate}
                onSaveTemplate={onSaveTemplate}
              />
            ))
          ) : (
            <div className="creationHistoryEmpty">Submitted generations will appear here while they run.</div>
          )}
        </div>

        <div className="creationHistoryGroup is-recent">
          <span className="creationHistoryEyebrow">Recent</span>
          {recent.length ? (
            recent.map((creation) => (
              <CreationHistoryRow
                key={creation.id}
                creation={creation}
                onDetails={onDetails}
                onDuplicate={onDuplicate}
                onSaveTemplate={onSaveTemplate}
              />
            ))
          ) : (
            <div className="creationHistoryEmpty">Finished and failed generations will collect here.</div>
          )}
        </div>
      </div>

      <Dialog open={Boolean(selectedCreation)} onOpenChange={(open) => !open && onCloseDetails()}>
        <DialogContent className="creationDetailDialog">
          {selectedCreation && (
            <>
              <DialogHeader className="dialogHeader">
                <DialogTitle>{selectedCreation.modeLabel || selectedCreation.modeId || "Creation details"}</DialogTitle>
                <DialogDescription>
                  {[selectedCreation.jobId, sourceLabel(selectedCreation), formatDate(creationTime(selectedCreation))]
                    .filter(Boolean)
                    .join(" · ")}
                </DialogDescription>
              </DialogHeader>
              <div className="creationDetailBody">
                <section className="creationDetailSummary">
                  <Badge variant={statusVariant(selectedCreation.status)}>{statusLabel(selectedCreation.status)}</Badge>
                  <p>{creationTitle(selectedCreation)}</p>
                  <div className="dialogActions">
                    <Button onClick={() => void onDuplicate(selectedCreation)}>
                      <CopyPlus />
                      Copy settings
                    </Button>
                    <Button variant="outline" onClick={() => void onSaveTemplate(selectedCreation)}>
                      <Save />
                      Save template
                    </Button>
                    {selectedCreation.outputUrl && (
                      <Button variant="outline" asChild>
                        <a href={selectedCreation.outputUrl} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open output
                        </a>
                      </Button>
                    )}
                  </div>
                </section>

                <section>
                  <h4>Timeline</h4>
                  <ol className="creationTimeline">
                    {selectedEvents.map((event) => (
                      <li key={event.id}>
                        <Clock3 className="size-3" />
                        <div>
                          <strong>{statusLabel(event.status)}</strong>
                          {event.message && <span>{event.message}</span>}
                        </div>
                        <time>{formatTime(event.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                </section>

                <section>
                  <h4>Settings</h4>
                  <dl className="detailFacts">
                    <dt>Mode</dt>
                    <dd>{selectedCreation.modeLabel || selectedCreation.modeId}</dd>
                    <dt>Source</dt>
                    <dd>{sourceLabel(selectedCreation)}</dd>
                    <dt>Prompt</dt>
                    <dd>{selectedCreation.params?.["prompt"] || "Preset prompt"}</dd>
                    <dt>Quality</dt>
                    <dd>{selectedCreation.params?.["quality"] || (selectedCreation.job?.["resolution"] as string | undefined) || ""}</dd>
                    <dt>Output</dt>
                    <dd>{selectedCreation.outputUrl || ""}</dd>
                    <dt>Error</dt>
                    <dd>{selectedCreation.error || ""}</dd>
                  </dl>
                </section>

                <section>
                  <h4>Request</h4>
                  <pre className="creationJson">{JSON.stringify(selectedCreation.request || {}, null, 2)}</pre>
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function CreationHistoryRow({
  creation,
  prominent = false,
  onDetails,
  onDuplicate,
  onSaveTemplate,
}: {
  creation: Creation
  prominent?: boolean
  onDetails: (creation: Creation) => Promise<void>
  onDuplicate: (creation: Creation) => Promise<void>
  onSaveTemplate: (creation: Creation) => Promise<void>
}) {
  const previewUrl = creationPreviewUrl(creation)
  const isVideo = isVideoCreation(creation)

  return (
    <article className={prominent ? "creationHistoryRow is-active" : "creationHistoryRow"}>
      <button type="button" className="creationHistoryMain" onClick={() => void onDetails(creation)}>
        <span className="creationHistoryThumb" data-media={isVideo ? "video" : previewUrl ? "image" : "missing"}>
          {previewUrl ? (
            <img src={previewUrl} alt={creationTitle(creation)} loading="lazy" decoding="async" />
          ) : isVideo ? (
            <Clapperboard />
          ) : (
            <ImageIcon />
          )}
        </span>
        <span className="creationHistoryText">
          <span className="creationHistoryTitle">{creationTitle(creation)}</span>
          <span className="creationHistoryMeta">
            {creation.modeLabel || creation.modeId} · {sourceLabel(creation)} · {formatDate(creationTime(creation))}
          </span>
        </span>
      </button>
      <Badge className="creationHistoryStatusBadge" variant={statusVariant(creation.status)}>
        {statusLabel(creation.status)}
      </Badge>
      <Button variant="outline" size="icon-xs" onClick={() => void onDuplicate(creation)} aria-label="Copy" title="Copy settings">
        <CopyPlus />
      </Button>
      <Button variant="outline" size="icon-xs" onClick={() => void onSaveTemplate(creation)} aria-label="Save" title="Save template">
        <Save />
      </Button>
    </article>
  )
}
