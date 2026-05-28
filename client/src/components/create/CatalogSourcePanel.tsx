import { Field } from "@/components/common/Field"
import { Input } from "@/components/ui/input"
import { formatSourceOption } from "@/lib/format"
import { cn } from "@/lib/utils"

import type { CreateStudioProps } from "./types"

export function CatalogSourcePanel(props: CreateStudioProps) {
  return (
    <div id="catalogSourcePanel" className={cn("sourcePanel", props.sourceKind !== "catalog" && "hidden")}>
      <Field label="Find image">
        <Input
          value={props.sourceSearch}
          onChange={(event) => props.setSourceSearch(event.target.value)}
          placeholder="Search prompts or IDs"
        />
      </Field>
      <Field label="Collection image">
        <select
          id="createCatalogSelect"
          className="native-select"
          value={props.selectedSourceId}
          onChange={(event) => props.setSelectedSourceId(event.target.value)}
        >
          {props.sourceItems.length === 0 ? (
            <option value="">No images found</option>
          ) : (
            props.sourceItems.map((item) => (
              <option key={item.id} value={item.id}>
                {formatSourceOption(item)}
              </option>
            ))
          )}
        </select>
      </Field>
    </div>
  )
}
