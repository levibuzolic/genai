import { Field } from "@/components/common/Field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { CreateStudioProps } from "./types"

export function TemplateTools(props: CreateStudioProps) {
  return (
    <details className="templateTools">
      <summary>Template tools</summary>
      <div className="templateImport">
        <Field label="History job ID">
          <Input
            id="templateJobIdInput"
            value={props.templateJobId}
            onChange={(event) => props.setTemplateJobId(event.target.value)}
            placeholder="fb62d491-b377-4c24-92ac-98e02e305bce"
          />
        </Field>
        <Field label="Template label">
          <Input
            id="templateLabelInput"
            value={props.templateLabel}
            onChange={(event) => props.setTemplateLabel(event.target.value)}
            placeholder="Blowjob"
          />
        </Field>
        <Button id="importTemplateButton" type="button" variant="glass" onClick={() => void props.onImportTemplate()}>
          Import template
        </Button>
      </div>
    </details>
  )
}
