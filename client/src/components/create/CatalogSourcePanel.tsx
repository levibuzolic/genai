import type { CreateStudioProps } from "./types"

export function CatalogSourcePanel(props: CreateStudioProps) {
  return (
    <div id="catalogSourcePanel" className="sourcePanel">
      <p className="createHint">{props.selectedSource ? "Using the attached collection image." : "No collection image attached."}</p>
    </div>
  )
}
