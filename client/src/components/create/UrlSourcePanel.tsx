import { Field } from "@/components/common/Field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import type { CreateStudioProps } from "./types"

export function UrlSourcePanel(props: CreateStudioProps) {
  return (
    <div id="urlSourcePanel" className={cn("sourcePanel", props.sourceKind !== "url" && "hidden")}>
      <Field label="Image URL">
        <Input
          id="createUrlInput"
          type="url"
          value={props.sourceUrl}
          onChange={(event) => props.setSourceUrl(event.target.value)}
          placeholder="https://example.com/image.jpg"
        />
      </Field>
    </div>
  )
}
