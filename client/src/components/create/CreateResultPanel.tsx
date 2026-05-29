import { Clapperboard, Download, ExternalLink, X } from "lucide-react"

import { Fact } from "@/components/common/Fact"
import { MediaPreview } from "@/components/media/MediaPreview"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { isImageUrl } from "@/lib/media"
import type { CreateJob } from "@/types/domain"

export function CreateResultPanel({
  sourcePreviewUrl,
  sourceLabel,
  sourceFallback,
  result,
  onClearSource,
  onDownload,
  onAnimate,
}: {
  sourcePreviewUrl?: string | null
  sourceLabel?: string | undefined
  sourceFallback: string
  result: CreateJob | null
  onClearSource: () => void
  onDownload: () => Promise<void>
  onAnimate: () => void
}) {
  return (
    <section className="createResult" aria-label="Creation result">
      <div className="createSourcePreviewSlot">
        <MediaPreview
          id="createSourcePreview"
          className="createSourcePreview"
          url={sourcePreviewUrl}
          label={sourceLabel || "Source preview"}
          fallback={sourceFallback}
        />
        {sourcePreviewUrl && (
          <Button
            id="createClearSourceButton"
            className="createClearSourceButton"
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClearSource}
          >
            <X />
            Clear source
          </Button>
        )}
      </div>
      <MediaPreview
        id="createResultPreview"
        className="createResultPreview"
        url={result?.outputUrl}
        label={result?.prompt || "Result preview"}
        fallback={result?.error || "No result yet"}
      />
      {result && (
        <div className="createResultMeta">
          <dl id="createResultFacts" className="createResultFacts">
            <>
              <Fact label="Job ID" value={result.id} />
              <Fact label="Type" value={result.type} />
              <Fact label="Status" value={result.status} />
              <Fact label="Resolution" value={result.resolution} />
              <Fact label="Duration" value={result.duration ? `${result.duration}s` : ""} />
            </>
          </dl>
          <ButtonGroup className="createResultActions">
            <Button id="createDownloadButton" disabled={result.status !== "done" || !result.outputUrl} onClick={() => void onDownload()}>
              <Download />
              Download to library
            </Button>
            <Button
              id="createAnimateButton"
              variant="outline"
              disabled={!result.outputUrl || !isImageUrl(result.outputUrl)}
              onClick={onAnimate}
            >
              <Clapperboard />
              Animate this
            </Button>
            {result.outputUrl && (
              <Button id="createOpenLink" variant="outline" asChild>
                <a href={result.outputUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open result
                </a>
              </Button>
            )}
          </ButtonGroup>
        </div>
      )}
    </section>
  )
}
