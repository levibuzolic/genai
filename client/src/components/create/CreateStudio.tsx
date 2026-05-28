import { Loader2, Sparkles, WandSparkles } from "lucide-react"
import * as React from "react"

import { Field } from "@/components/common/Field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
          <Badge variant="muted">
            <WandSparkles className="size-3" />
            Create
          </Badge>
          <h2 id="createTitle">Create</h2>
          <p id="createStatus">{props.createStatus}</p>
        </div>
        <Button id="hideCreateButton" variant="outline" onClick={props.onClose}>
          Hide creator
        </Button>
      </div>

      <div className="createLayout">
        <section className="createPanel" aria-label="Creation controls">
          <SourceTabs value={props.sourceKind} onChange={props.setSourceKind} />
          <CatalogSourcePanel {...props} />
          <UploadSourcePanel {...props} />
          <UrlSourcePanel {...props} />

          <Field label="Mode">
            <select
              id="createModeSelect"
              className="native-select"
              value={props.modeId}
              onChange={(event) => props.setModeId(event.target.value)}
            >
              {props.modes.map((mode) => (
                <option key={mode.id} value={mode.id} disabled={mode.disabled}>
                  {mode.disabled ? `${mode.label} (import required)` : mode.label}
                </option>
              ))}
            </select>
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
              <select
                id="createQualitySelect"
                className="native-select"
                value={props.quality}
                onChange={(event) => props.setQuality(event.target.value)}
              >
                {props.qualityField.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="createActions">
            <Button id="createSubmitButton" onClick={() => void props.onSubmit()} disabled={props.createSubmitting}>
              {props.createSubmitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Create
            </Button>
            <Button id="createResetButton" variant="outline" onClick={props.onReset}>
              Reset
            </Button>
          </div>

          <TemplateTools {...props} />
        </section>

        <CreateResultPanel
          sourcePreviewUrl={sourcePreviewUrl}
          sourceLabel={props.uploadedName || props.selectedSource?.prompt}
          sourceFallback={sourceFallback}
          result={props.createResult}
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
