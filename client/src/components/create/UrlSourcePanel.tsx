import { Field } from "@/components/common/Field"
import { Input } from "@/components/ui/input"

import { SelectedSourcePreview } from "./SelectedSourcePreview"
import type { CreateStudioProps } from "./types"

export function UrlSourcePanel(props: CreateStudioProps) {
  return (
    <div id="urlSourcePanel" className="sourcePanel">
      <Field label="Image URL">
        <Input
          id="createUrlInput"
          type="url"
          value={props.sourceUrl}
          onChange={(event) => props.setSourceUrl(event.target.value)}
          placeholder="https://example.com/image.jpg"
        />
      </Field>
      <SelectedSourcePreview
        id="createSelectedUrlPreview"
        url={props.sourceUrl.trim()}
        label={props.sourceUrl.trim() || "Selected URL"}
        onClear={props.onClearSource}
      />
    </div>
  )
}
