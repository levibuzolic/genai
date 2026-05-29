import { Loader2, Sparkles, X } from "lucide-react"
import * as React from "react"

import { Field } from "@/components/common/Field"
import { SelectControl } from "@/components/common/NativeSelect"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Textarea } from "@/components/ui/textarea"
import { mediaUrlForItem } from "@/lib/media"

import { CatalogSourcePanel } from "./CatalogSourcePanel"
import { CreateResultPanel } from "./CreateResultPanel"
import { CreationHistoryPanel } from "./CreationHistoryPanel"
import { SourceTabs } from "./SourceTabs"
import { TemplateTools } from "./TemplateTools"
import type { CreateStudioProps } from "./types"
import { UploadSourcePanel } from "./UploadSourcePanel"
import { UrlSourcePanel } from "./UrlSourcePanel"

export const CreateStudio = React.forwardRef<HTMLElement, CreateStudioProps>(function CreateStudio(props, ref) {
  const sourcePreviewUrl =
    props.sourceKind === "catalog"
      ? mediaUrlForItem(props.selectedSource)
      : props.sourceKind === "upload"
        ? props.uploadedDataUrl
        : props.sourceUrl
  const sourceFallback =
    props.sourceKind === "catalog"
      ? "No collection image selected"
      : props.sourceKind === "upload"
        ? "No upload selected"
        : "No URL entered"

  return (
    <section id="createArea" ref={ref} className="create-studio createArea" aria-label="Create media">
      <div className="createHeader">
        <div>
          <h2 id="createTitle">Create</h2>
          <p id="createStatus">{props.createStatus}</p>
        </div>
        <Button id="hideCreateButton" variant="outline" size="icon" onClick={props.onClose} aria-label="Close creator">
          <X />
          <span className="sr-only">Close creator</span>
        </Button>
      </div>

      <div className="createLayout">
        <section className="createPanel" aria-label="Creation controls">
          <SourceTabs value={props.sourceKind} onChange={props.setSourceKind} />
          {props.sourceKind === "catalog" && <CatalogSourcePanel {...props} />}
          {props.sourceKind === "upload" && <UploadSourcePanel {...props} />}
          {props.sourceKind === "url" && <UrlSourcePanel {...props} />}

          <Field label="Mode">
            <SelectControl id="createModeSelect" value={props.modeId} onChange={(value) => props.setModeId(value)}>
              {props.modes.map((mode) => (
                <option key={mode.id} value={mode.id} disabled={mode.disabled}>
                  {mode.disabled ? `${mode.label} (import required)` : mode.label}
                </option>
              ))}
            </SelectControl>
          </Field>

          {props.promptField && (
            <Field id="createPromptLabel" label="Prompt">
              <Textarea
                id="createPromptInput"
                value={props.prompt}
                onChange={(event) => props.setPrompt(event.target.value)}
                placeholder="Describe the edit or video"
              />
            </Field>
          )}

          {props.qualityField && (
            <Field id="createQualityLabel" label="Quality">
              <SelectControl id="createQualitySelect" value={props.quality} onChange={(value) => props.setQuality(value)}>
                {props.qualityField.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectControl>
            </Field>
          )}

          <ButtonGroup className="createActions">
            <Button id="createSubmitButton" onClick={() => void props.onSubmit()} disabled={props.createSubmitting}>
              {props.createSubmitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Create
            </Button>
            <Button id="createResetButton" variant="outline" onClick={props.onReset}>
              Reset
            </Button>
          </ButtonGroup>

          <TemplateTools {...props} />
        </section>

        <CreateResultPanel
          sourcePreviewUrl={sourcePreviewUrl}
          sourceLabel={props.uploadedName || props.selectedSource?.prompt || props.sourceUrl}
          sourceFallback={sourceFallback}
          result={props.createResult}
          onClearSource={props.onClearSource}
          onDownload={props.onDownload}
          onAnimate={props.onAnimate}
        />

        <CreationHistoryPanel
          creations={props.creations}
          activeCount={props.activeCreationCount}
          loading={props.creationHistoryLoading}
          selectedCreation={props.selectedCreation}
          selectedEvents={props.selectedCreationEvents}
          statusMessage={props.creationHistoryStatus}
          onRefresh={props.onRefreshCreations}
          onDetails={props.onCreationDetails}
          onCloseDetails={props.onCloseCreationDetails}
          onDuplicate={props.onDuplicateCreation}
          onSaveTemplate={props.onSaveCreationTemplate}
        />
      </div>
    </section>
  )
})
