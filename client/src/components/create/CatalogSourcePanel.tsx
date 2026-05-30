import { mediaUrlForItem } from "@/lib/media"

import { SelectedSourcePreview } from "./SelectedSourcePreview"
import type { CreateStudioProps } from "./types"

export function CatalogSourcePanel(props: CreateStudioProps) {
  const previewUrl = mediaUrlForItem(props.selectedSource)

  return (
    <div id="catalogSourcePanel" className="sourcePanel">
      <SelectedSourcePreview
        id="createSelectedCatalogPreview"
        url={previewUrl}
        label={props.selectedSource?.prompt || props.selectedSource?.id || "Selected catalog image"}
        onClear={props.onClearSource}
      />
      <p className="createHint">{props.selectedSource ? "Using the attached collection image." : "No collection image attached."}</p>
    </div>
  )
}
