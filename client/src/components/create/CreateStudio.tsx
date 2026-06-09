import { Loader2, Sparkles, X } from "lucide-react"
import * as React from "react"

import { ComboboxSelect, type ComboboxOption } from "@/components/common/ComboboxSelect"
import { Field } from "@/components/common/Field"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { CreateFieldOption } from "@/types/domain"

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
  const modeOptions = React.useMemo(
    () =>
      props.selectedTemplateId
        ? props.modes.filter((mode) => ["custom-image", "custom-video", "custom-image-video"].includes(mode.id))
        : props.modes.filter((mode) => mode.id !== "nudify-video"),
    [props.modes, props.selectedTemplateId],
  )
  const showNudifyToggle = visibleModeId === "custom-video"
  const sourceRequired = selectedMode?.source?.required !== false
  const defaultPendingCount = getPendingGenerationCount(props.pendingGenerationCountsByAccount, "")
  const defaultQueuedCount = getQueuedGenerationCount(props.queuedGenerationCountsByAccount, "")
  const autoPendingCount = getPendingGenerationCount(props.pendingGenerationCountsByAccount, props.autoAccountEmail)
  const autoQueuedCount = getQueuedGenerationCount(props.queuedGenerationCountsByAccount, props.autoAccountEmail)
  const modeSelectOptions = React.useMemo(
    () =>
      modeOptions.map((mode) => ({
        value: mode.id,
        label: mode.disabled ? `${mode.label} (import required)` : mode.label,
        disabled: Boolean(mode.disabled),
        searchText: mode.id,
      })) satisfies ComboboxOption[],
    [modeOptions],
  )
  const accountSelectOptions = React.useMemo(
    () =>
      [
        {
          value: "",
          label: formatAutoAccountOptionLabel(
            props.autoAccountEmail || "Default",
            props.autoAccountEmail ? autoPendingCount : defaultPendingCount,
            props.autoAccountEmail ? autoQueuedCount : defaultQueuedCount,
          ),
          searchText: `auto default ${props.autoAccountEmail}`,
        },
        ...props.accountOptions.map((email) => ({
          value: email,
          label: formatAccountOptionLabel(
            email,
            getPendingGenerationCount(props.pendingGenerationCountsByAccount, email),
            getQueuedGenerationCount(props.queuedGenerationCountsByAccount, email),
          ),
          searchText: email,
        })),
      ] satisfies ComboboxOption[],
    [
      autoPendingCount,
      autoQueuedCount,
      defaultPendingCount,
      defaultQueuedCount,
      props.accountOptions,
      props.autoAccountEmail,
      props.pendingGenerationCountsByAccount,
      props.queuedGenerationCountsByAccount,
    ],
  )
  const modelSelectOptions = React.useMemo(
    () =>
      props.modelField?.options?.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.tier || option.kind || "",
        searchText: [option.value, option.modelId, option.protocol].filter(Boolean).join(" "),
      })) || [],
    [props.modelField?.options],
  )
  const qualitySelectOptions = React.useMemo(
    () =>
      props.qualityField?.options?.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.duration ? `${option.duration}s` : option.resolution || "",
        searchText: [option.value, option.modelId, option.resolution].filter(Boolean).join(" "),
      })) || [],
    [props.qualityField?.options],
  )
  const videoQualityOptions = React.useMemo(() => getVideoQualityOptions(props.qualityField?.options), [props.qualityField?.options])

  return (
    <section id="createArea" ref={ref} className="create-studio createArea" aria-label="Create media">
      <div className="createHeader">
        <div>
          <h2 id="createTitle">Create</h2>
          <p id="createStatus">{props.createStatus}</p>
        </div>
        <div className="createHeaderActions">
          <Button id="createSubmitButton" onClick={() => void props.onSubmit({ queue: true })} disabled={props.createSubmitting}>
            {props.createSubmitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Create
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
            <ComboboxSelect
              id="createModeSelect"
              label="Mode"
              value={visibleModeId}
              options={modeSelectOptions}
              onChange={(value) => props.setModeId(value)}
              searchPlaceholder="Filter modes"
            />

            <ComboboxSelect
              id="createAccountSelect"
              label="Account"
              value={props.selectedAccountEmail}
              options={accountSelectOptions}
              onChange={(value) => props.setSelectedAccountEmail(value)}
              searchPlaceholder="Filter accounts"
            />

            {props.modelField && (
              <ComboboxSelect
                id="createModelSelect"
                label={props.modelField.label || "Model"}
                value={props.modelId}
                options={modelSelectOptions}
                onChange={(value) => props.setModelId(value)}
                searchPlaceholder="Filter models"
              />
            )}

            {props.qualityField && videoQualityOptions ? (
              <VideoQualityControls options={videoQualityOptions} value={props.quality} onChange={props.setQuality} />
            ) : props.qualityField ? (
              <ComboboxSelect
                id="createQualitySelect"
                label={props.qualityField.label || "Quality"}
                value={props.quality}
                options={qualitySelectOptions}
                onChange={(value) => props.setQuality(value)}
                searchPlaceholder="Filter quality"
              />
            ) : null}
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
          onRetry={props.onRetryCreation}
          onSaveTemplate={props.onSaveCreationTemplate}
        />
      </div>
    </section>
  )
})

export function formatAccountOptionLabel(label: string, pendingCount: number, queuedCount: number): string {
  return `${label} (${pendingCount.toLocaleString()} pending, ${queuedCount.toLocaleString()} queued)`
}

export function formatAutoAccountOptionLabel(label: string, pendingCount: number, queuedCount: number): string {
  return `Auto · ${formatAccountOptionLabel(label, pendingCount, queuedCount)}`
}

function VideoQualityControls({
  options,
  value,
  onChange,
}: {
  options: CreateFieldOption[]
  value: string
  onChange: (value: string) => void
}) {
  const selectedOption = options.find((option) => option.value === value) || options[0]
  const selectedResolution = selectedOption?.resolution || options[0]?.resolution || ""
  const resolutionOptions = uniqueValues(
    options.map((option) => option.resolution).filter((resolution): resolution is string => Boolean(resolution)),
  )
  const durationOptions = sortQualityOptionsByDuration(
    options.filter((option) => option.resolution === selectedResolution && typeof option.duration === "number"),
  )
  const selectedDuration = Number(selectedOption?.duration || durationOptions[0]?.duration || 0)
  const minDuration = Number(durationOptions[0]?.duration || selectedDuration || 0)
  const maxDuration = Number(durationOptions.at(-1)?.duration || selectedDuration || 0)

  function setResolution(resolution: string) {
    const sameDuration = options.find((option) => option.resolution === resolution && option.duration === selectedDuration)
    const fallback = options.find((option) => option.resolution === resolution)
    const next = sameDuration || fallback
    if (next) onChange(next.value)
  }

  function setDuration(duration: number) {
    const next = closestDurationOption(durationOptions, duration)
    if (next) onChange(next.value)
  }

  return (
    <div className="createVideoQuality" aria-label="Video quality">
      <Tabs value={selectedResolution} onValueChange={setResolution}>
        <TabsList className="w-full" aria-label="Resolution">
          {resolutionOptions.map((resolution) => (
            <TabsTrigger key={resolution} value={resolution}>
              {resolution}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="createDurationControl">
        <output htmlFor="createDurationSlider">{selectedDuration.toLocaleString()}s</output>
        <input
          id="createDurationSlider"
          type="range"
          min={minDuration}
          max={maxDuration}
          step={1}
          value={selectedDuration}
          aria-label="Duration"
          onChange={(event) => setDuration(Number(event.currentTarget.value))}
        />
      </div>
    </div>
  )
}

function getVideoQualityOptions(options: CreateFieldOption[] | undefined): CreateFieldOption[] | null {
  const videoOptions = options?.filter((option) => option.resolution && typeof option.duration === "number") || []
  return videoOptions.length === options?.length && videoOptions.length > 0 ? videoOptions : null
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)]
}

function closestDurationOption(options: CreateFieldOption[], duration: number): CreateFieldOption | undefined {
  let closest = options[0]
  for (const option of options) {
    if (!closest || Math.abs(Number(option.duration) - duration) < Math.abs(Number(closest.duration) - duration)) {
      closest = option
    }
  }
  return closest
}

function sortQualityOptionsByDuration(options: CreateFieldOption[]): CreateFieldOption[] {
  const sorted: CreateFieldOption[] = []
  for (const option of options) {
    const insertionIndex = sorted.findIndex((entry) => Number(option.duration) < Number(entry.duration))
    if (insertionIndex === -1) {
      sorted.push(option)
    } else {
      sorted.splice(insertionIndex, 0, option)
    }
  }
  return sorted
}

function getPendingGenerationCount(counts: Record<string, number>, accountEmail: string): number {
  return counts[accountEmail || "__default__"] || 0
}

function getQueuedGenerationCount(counts: Record<string, number>, accountEmail: string): number {
  return counts[accountEmail || "__default__"] || 0
}
