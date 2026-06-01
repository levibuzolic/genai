import { ImagePlus, RefreshCw } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { mediaUrlForItem } from "@/lib/media"

import { SelectedSourcePreview } from "./SelectedSourcePreview"
import type { CreateStudioProps } from "./types"

export function CatalogSourcePanel(props: CreateStudioProps) {
  const previewUrl = mediaUrlForItem(props.selectedSource)
  const [browserOpen, setBrowserOpen] = React.useState(false)

  return (
    <div id="catalogSourcePanel" className="sourcePanel">
      <SelectedSourcePreview
        id="createSelectedCatalogPreview"
        url={previewUrl}
        label={props.selectedSource?.prompt || props.selectedSource?.id || "Selected catalog image"}
        onClear={props.onClearSource}
      />
      <p className="createHint">{props.selectedSource ? "Using the attached collection image." : "No collection image attached."}</p>
      <div className="sourceBrowserHeader">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setBrowserOpen((current) => !current)
            if (!browserOpen) void props.onRefreshCatalogSources()
          }}
        >
          <ImagePlus />
          Browse library
        </Button>
        {browserOpen && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void props.onRefreshCatalogSources()}
            title="Refresh images"
            aria-label="Refresh images"
          >
            <RefreshCw />
          </Button>
        )}
      </div>
      {browserOpen && (
        <div className="sourceImageGrid" aria-label="Library source images">
          {props.sourceItems.map((item) => {
            const url = mediaUrlForItem(item)
            if (!url) return null
            return (
              <button
                key={item.id}
                type="button"
                className={item.id === props.selectedSource?.id ? "sourceImageTile is-selected" : "sourceImageTile"}
                onClick={() => props.onSelectCatalogSource(item)}
                title={item.prompt || item.id}
                aria-label={item.prompt || item.id}
                aria-pressed={item.id === props.selectedSource?.id}
              >
                <img src={url} alt="" loading="lazy" decoding="async" />
              </button>
            )
          })}
          {!props.sourceItemsLoading && props.sourceItems.length === 0 && (
            <div className="sourceImageEmpty">
              <ImagePlus className="size-4" />
              <span>No library images found</span>
            </div>
          )}
          {props.sourceItemsLoading && (
            <div className="sourceImageEmpty">
              <RefreshCw className="size-4 animate-spin" />
              <span>Loading images</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
