import { Loader2, Sparkles, X } from "lucide-react"
import * as React from "react"

import { Field } from "@/components/common/Field"
import { SelectControl } from "@/components/common/NativeSelect"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { CatalogSourcePanel } from "./CatalogSourcePanel"
import { CreationHistoryPanel } from "./CreationHistoryPanel"
import { SourceTabs } from "./SourceTabs"
import { TemplateTools } from "./TemplateTools"
import type { CreateStudioProps } from "./types"
import { UploadSourcePanel } from "./UploadSourcePanel"
import { UrlSourcePanel } from "./UrlSourcePanel"

export const CreateStudio = React.forwardRef<HTMLElement, CreateStudioProps>(function CreateStudio(props, ref) {
  const selectedMode = props.modes.find((mode) => mode.id === props.modeId)
  const visibleModeId = props.modeId === "nudify-video" ? "custom-video" : props.modeId
  const modeOptions = props.selectedTemplateId
    ? props.modes.filter((mode) => ["custom-image", "custom-video", "custom-image-video"].includes(mode.id))
    : props.modes.filter((mode) => mode.id !== "nudify-video")
  const showNudifyToggle = visibleModeId === "custom-video"
  const sourceRequired = selectedMode?.source?.required !== false
  const shouldQueue = props.pendingGenerationCount >= props.generationConcurrencyLimit || props.queuedGenerationCount > 0
  const defaultPendingCount = getPendingGenerationCount(props.pendingGenerationCountsByAccount, "")

  return (
    <section id="createArea" ref={ref} className="create-studio createArea" aria-label="Create media">
      <div className="createHeader">
        <div>
          <h2 id="createTitle">Create</h2>
          <p id="createStatus">{props.createStatus}</p>
        </div>
        <div className="createHeaderActions">
          <Button id="createSubmitButton" onClick={() => void props.onSubmit({ queue: shouldQueue })} disabled={props.createSubmitting}>
            {props.createSubmitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {shouldQueue ? "Queue" : "Create"}
          </Button>
          <Button id="createResetButton" variant="outline" onClick={props.onReset}>
            Reset
          </Button>
          <Button id="hideCreateButton" variant="outline" size="icon" onClick={props.onClose} aria-label="Close creator">
            <X />
            <span className="sr-only">Close creator</span>
          </Button>
        </div>
      </div>

      <div className="createLayout">
        <section className="createPanel" aria-label="Creation controls">
          <div className="createModeGrid">
            <Field label="Mode">
              <SelectControl id="createModeSelect" value={visibleModeId} onChange={(value) => props.setModeId(value)}>
                {modeOptions.map((mode) => (
                  <option key={mode.id} value={mode.id} disabled={mode.disabled}>
                    {mode.disabled ? `${mode.label} (import required)` : mode.label}
                  </option>
                ))}
              </SelectControl>
            </Field>

            <Field label="Account">
              <SelectControl
                id="createAccountSelect"
                value={props.selectedAccountEmail}
                onChange={(value) => props.setSelectedAccountEmail(value)}
              >
                {props.accountOptions.length === 0 ? (
                  <option value="">{formatAccountOptionLabel("Default", defaultPendingCount)}</option>
                ) : (
                  props.accountOptions.map((email) => (
                    <option key={email} value={email}>
                      {formatAccountOptionLabel(email, getPendingGenerationCount(props.pendingGenerationCountsByAccount, email))}
                    </option>
                  ))
                )}
              </SelectControl>
            </Field>

            {props.modelField && (
              <Field id="createModelLabel" label={props.modelField.label || "Model"}>
                <SelectControl id="createModelSelect" value={props.modelId} onChange={(value) => props.setModelId(value)}>
                  {props.modelField.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectControl>
              </Field>
            )}

            {props.qualityField && (
              <Field id="createQualityLabel" label={props.qualityField.label || "Quality"}>
                <SelectControl id="createQualitySelect" value={props.quality} onChange={(value) => props.setQuality(value)}>
                  {props.qualityField.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectControl>
              </Field>
            )}
          </div>

          {showNudifyToggle && (
            <label id="createNudifyToggleLabel" className="createNudifyToggle">
              <input
                id="createNudifyToggle"
                type="checkbox"
                aria-label="Add Nudify first"
                checked={props.modeId === "nudify-video"}
                onChange={(event) => props.setModeId(event.currentTarget.checked ? "nudify-video" : "custom-video")}
              />
              <span>Add Nudify first</span>
            </label>
          )}

          {sourceRequired && (
            <>
              <SourceTabs value={props.sourceKind} onChange={props.setSourceKind} />
              {props.sourceKind === "catalog" && <CatalogSourcePanel {...props} />}
              {props.sourceKind === "upload" && <UploadSourcePanel {...props} />}
              {props.sourceKind === "url" && <UrlSourcePanel {...props} />}
            </>
          )}

          {props.promptField && (
            <Field id="createPromptLabel" label="Prompt">
              <Textarea
                id="createPromptInput"
                className="createPromptInput"
                value={props.prompt}
                onChange={(event) => props.setPrompt(event.target.value)}
                placeholder="Describe the edit or video"
              />
            </Field>
          )}

          {props.promptField && (
            <Field id="createNegativePromptLabel" label="Negative prompt">
              <Textarea
                id="createNegativePromptInput"
                className="createNegativePromptInput"
                value={props.negativePrompt}
                onChange={(event) => props.setNegativePrompt(event.target.value)}
                placeholder="Optional exclusions"
              />
            </Field>
          )}

          <TemplateTools {...props} />
        </section>

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

export function formatAccountOptionLabel(label: string, pendingCount: number): string {
  return `${label} (${pendingCount.toLocaleString()} pending)`
}

function getPendingGenerationCount(counts: Record<string, number>, accountEmail: string): number {
  return counts[accountEmail || "__default__"] || 0
}
