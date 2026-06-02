import { ExternalLink, Save, X } from "lucide-react"
import * as React from "react"

import { ComboboxSelect, type ComboboxOption } from "@/components/common/ComboboxSelect"
import { Field } from "@/components/common/Field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { CreateStudioProps } from "./types"

export function TemplateTools(props: CreateStudioProps) {
  const [saveLabel, setSaveLabel] = React.useState("")
  const selectedTemplate = props.templates.find((template) => template.id === props.selectedTemplateId)
  const templateOptions = [
    { value: "", label: "No template" },
    ...props.templates.map((template) => ({
      value: template.id,
      label: template.label,
      description: template.type,
      searchText: [template.description, template.prompt].filter(Boolean).join(" "),
    })),
  ] satisfies ComboboxOption[]
  const templateTypeOptions = [
    { value: "image", label: "Image edit" },
    { value: "video", label: "Video" },
    { value: "combo", label: "Edit + video" },
    { value: "nudify-video", label: "Nudify + video" },
  ] satisfies ComboboxOption[]

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
        <ComboboxSelect
          id="createTemplateSelect"
          label="Apply"
          value={props.selectedTemplateId}
          options={templateOptions}
          onChange={(value) => {
            const template = props.templates.find((entry) => entry.id === value)
            if (template) props.onApplyTemplate(template)
            if (!value) props.onClearTemplate()
          }}
          placeholder="No template"
          searchPlaceholder="Filter templates"
          emptyMessage="No templates match"
        />
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
        <ComboboxSelect
          value={props.templateType}
          options={templateTypeOptions}
          onChange={(value) => props.setTemplateType(value as typeof props.templateType)}
          aria-label="Template type"
          searchPlaceholder="Filter types"
        />
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
