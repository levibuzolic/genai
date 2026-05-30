import { ExternalLink, Save, X } from "lucide-react"
import * as React from "react"

import { Field } from "@/components/common/Field"
import { SelectControl } from "@/components/common/NativeSelect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { CreateStudioProps } from "./types"

export function TemplateTools(props: CreateStudioProps) {
  const [saveLabel, setSaveLabel] = React.useState("")
  const filteredTemplates = React.useMemo(() => {
    const query = props.templateSearch.trim().toLowerCase()
    if (!query) return props.templates

    return props.templates.filter((template) =>
      [template.label, template.description, template.type, template.prompt].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      ),
    )
  }, [props.templateSearch, props.templates])
  const selectedTemplate = props.templates.find((template) => template.id === props.selectedTemplateId)

  return (
    <div className="templateTools">
      <div className="templatePickerHeader">
        <strong>Templates</strong>
        <Button type="button" variant="outline" size="sm" onClick={props.onOpenTemplates}>
          <ExternalLink />
          Browse
        </Button>
      </div>
      <div className="templatePicker">
        <Input
          id="templateSearchInput"
          value={props.templateSearch}
          onChange={(event) => props.setTemplateSearch(event.target.value)}
          placeholder="Filter templates"
        />
        <SelectControl
          id="createTemplateSelect"
          value={props.selectedTemplateId}
          onChange={(value) => {
            const template = props.templates.find((entry) => entry.id === value)
            if (template) props.onApplyTemplate(template)
          }}
        >
          <option value="">No template</option>
          {filteredTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.label} · {template.type}
            </option>
          ))}
        </SelectControl>
        {selectedTemplate && (
          <div className="selectedTemplateLine">
            <span>{selectedTemplate.label}</span>
            <Button type="button" variant="ghost" size="icon" onClick={props.onClearTemplate} aria-label="Clear template">
              <X />
            </Button>
          </div>
        )}
      </div>
      <div className="templateSaveInline">
        <Input value={saveLabel} onChange={(event) => setSaveLabel(event.target.value)} placeholder="Save current settings as..." />
        <SelectControl
          value={props.templateType}
          onChange={(value) => props.setTemplateType(value as typeof props.templateType)}
          aria-label="Template type"
        >
          <option value="image">Image edit</option>
          <option value="video">Video</option>
          <option value="combo">Edit + video</option>
          <option value="nudify-video">Nudify + video</option>
        </SelectControl>
        <Button
          type="button"
          variant="outline"
          disabled={!saveLabel.trim()}
          onClick={async () => {
            await props.onSaveCurrentTemplate(saveLabel.trim(), props.templateType)
            setSaveLabel("")
          }}
        >
          <Save />
          Save
        </Button>
      </div>

      <details>
        <summary>Import history template</summary>
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
          <Button id="importTemplateButton" type="button" variant="outline" onClick={() => void props.onImportTemplate()}>
            Import template
          </Button>
        </div>
      </details>
    </div>
  )
}
