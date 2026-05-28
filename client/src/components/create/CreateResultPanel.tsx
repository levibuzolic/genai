import { Clapperboard, Download, ExternalLink } from "lucide-react"

import { Fact } from "@/components/common/Fact"
import { MediaPreview } from "@/components/media/MediaPreview"
import { Button } from "@/components/ui/button"
import { isImageUrl } from "@/lib/media"
import type { CreateJob } from "@/types/domain"

export function CreateResultPanel({
  sourcePreviewUrl,
  sourceLabel,
  sourceFallback,
  result,
  onDownload,
  onAnimate,
}: {
  sourcePreviewUrl?: string | null
  sourceLabel?: string | undefined
  sourceFallback: string
  result: CreateJob | null
  onDownload: () => Promise<void>
  onAnimate: () => void
}) {
  return (
    <section className="createResult" aria-label="Creation result">
      <MediaPreview
        id="createSourcePreview"
        className="createSourcePreview"
        url={sourcePreviewUrl}
        label={sourceLabel || "Source preview"}
        fallback={sourceFallback}
      />
      <MediaPreview
        id="createResultPreview"
        className="createResultPreview"
        url={result?.outputUrl}
        label={result?.prompt || "Result preview"}
        fallback={result?.error || "No result yet"}
      />
      <dl id="createResultFacts" className="detailFacts">
        {result && (
          <>
            <Fact label="Job ID" value={result.id} />
            <Fact label="Type" value={result.type} />
            <Fact label="Status" value={result.status} />
            <Fact label="Resolution" value={result.resolution} />
            <Fact label="Duration" value={result.duration ? `${result.duration}s` : ""} />
          </>
        )}
      </dl>
      <div className="dialogActions">
        <Button id="createDownloadButton" disabled={result?.status !== "done" || !result.outputUrl} onClick={() => void onDownload()}>
          <Download />
          Download to library
        </Button>
        <Button id="createAnimateButton" variant="glass" disabled={!result?.outputUrl || !isImageUrl(result.outputUrl)} onClick={onAnimate}>
          <Clapperboard />
          Animate this
        </Button>
        {result?.outputUrl && (
          <Button id="createOpenLink" variant="glass" asChild>
            <a href={result.outputUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open result
            </a>
          </Button>
        )}
      </div>
    </section>
  )
}
