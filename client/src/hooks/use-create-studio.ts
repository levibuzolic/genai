import * as React from "react"

import { fetchJson } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { isImageItem } from "@/lib/media"
import { replaceEqualJson } from "@/lib/render-state"
import {
  extensionForImageType,
  fileToDataUrl,
  getImageFileFromTransfer,
  hasImageTransfer,
  sourceLabel,
  UPLOAD_IMAGE_TYPES,
} from "@/lib/upload"
import type {
  CatalogItem,
  CreateParams,
  CreateField,
  CreateMode,
  CreateTemplate,
  CreateTemplateType,
  CreationSource,
  SourceKind,
  UploadSource,
} from "@/types/domain"
import type { CreateJobPollResponse, CreateJobSubmitRequest, CreateJobSubmitResponse, ImportCreateTemplateResponse } from "@/types/routes"

export function useCreateStudio(onOpen?: () => void) {
  const [open, setOpen] = React.useState(false)
  const [modes, setModes] = React.useState<CreateMode[]>([])
  const [sourceKind, setSourceKind] = React.useState<SourceKind>("catalog")
  const [sourceItems, setSourceItems] = React.useState<CatalogItem[]>([])
  const [selectedSourceId, setSelectedSourceId] = React.useState("")
  const [uploadedDataUrl, setUploadedDataUrl] = React.useState<string | null>(null)
  const [uploadedName, setUploadedName] = React.useState("")
  const [uploadMeta, setUploadMeta] = React.useState("No file selected.")
  const [sourceUrl, setSourceUrl] = React.useState("")
  const [modeId, setModeId] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [negativePrompt, setNegativePrompt] = React.useState("")
  const [quality, setQuality] = React.useState("")
  const [status, setStatus] = React.useState("Choose a source and mode.")
  const [submitting, setSubmitting] = React.useState(false)
  const [templateJobId, setTemplateJobId] = React.useState("")
  const [templateLabel, setTemplateLabel] = React.useState("")
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("")
  const [templateSearch, setTemplateSearch] = React.useState("")
  const [templateType, setTemplateType] = React.useState<CreateTemplateType>("video")
  const [isDraggingUpload, setIsDraggingUpload] = React.useState(false)
  const panelRef = React.useRef<HTMLElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const selectedMode = React.useMemo(() => modes.find((modeOption) => modeOption.id === modeId) || null, [modes, modeId])
  const selectedSource = React.useMemo(
    () => sourceItems.find((item) => item.id === selectedSourceId) || null,
    [sourceItems, selectedSourceId],
  )
  const promptField = selectedMode?.fields?.find((field) => field.name === "prompt") as CreateField | undefined
  const qualityField = selectedMode?.fields?.find((field) => field.name === "quality") as CreateField | undefined

  const loadModes = React.useCallback(async () => {
    const data = await fetchJson<{ modes: CreateMode[] }>("/api/create/modes")
    setModes((current) => replaceEqualJson(current, data.modes || []))
    const firstEnabled = data.modes?.find((modeOption) => !modeOption.disabled)
    setModeId((current) => {
      if (current && data.modes?.some((entry) => entry.id === current && !entry.disabled)) return current
      return firstEnabled?.id || ""
    })
  }, [])

  React.useEffect(() => {
    void loadModes()
  }, [loadModes])

  React.useEffect(() => {
    if (!open) return
    void loadModes()
  }, [loadModes, open])

  React.useEffect(() => {
    if (!modeId || !selectedMode) return
    const firstQualityOption = qualityField?.options?.[0]
    if (firstQualityOption) {
      setQuality((current) => {
        if (current && qualityField.options?.some((option) => option.value === current)) return current
        return qualityField?.default || firstQualityOption.value
      })
    } else {
      setQuality("")
    }
  }, [modeId, qualityField, selectedMode])

  const openCreator = React.useCallback(
    async function openCreator(
      options: {
        sourceKind?: SourceKind | undefined
        sourceItem?: CatalogItem | null | undefined
        source?: CreationSource | null | undefined
        prompt?: string | undefined
        modeId?: string | undefined
        params?: CreateParams | undefined
        templateId?: string | undefined
      } = {},
    ) {
      onOpen?.()
      setOpen(true)
      if (options.templateId) setSelectedTemplateId(options.templateId)
      if (options.sourceKind) setSourceKind(options.sourceKind)
      if (options.prompt !== undefined) setPrompt(options.prompt)
      if (options.modeId) setModeId(options.modeId)
      const promptParam = paramAsString(options.params?.["prompt"])
      const negativePromptParam = paramAsString(options.params?.["negativePrompt"] ?? options.params?.["negative_prompt"])
      const qualityParam = paramAsString(options.params?.["quality"])
      if (promptParam !== undefined) setPrompt(promptParam)
      if (negativePromptParam !== undefined) setNegativePrompt(negativePromptParam)
      if (qualityParam) setQuality(qualityParam)
      if (options.source?.kind === "url" && typeof options.source.url === "string") {
        setSourceKind("url")
        setSourceUrl(options.source.url)
      } else if (options.source?.kind === "catalog" && typeof options.source.itemId === "string") {
        setSourceKind("catalog")
        setSelectedSourceId(options.source.itemId)
      } else if (options.source?.kind === "upload") {
        setSourceKind("upload")
        setUploadMeta("Choose, drop, or paste the source image again.")
      }
      const sourceItem = options.sourceItem
      if (sourceItem && isImageItem(sourceItem)) {
        setSourceKind("catalog")
        setSourceItems((current) => {
          if (current.some((item) => item.id === sourceItem.id)) return current
          return [sourceItem, ...current]
        })
        setSelectedSourceId(sourceItem.id)
      }
      window.requestAnimationFrame(() => {
        panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
      })
    },
    [onOpen],
  )

  const acceptUploadFile = React.useCallback(async function acceptUploadFile(file: File | null, source: UploadSource) {
    setUploadedDataUrl(null)
    setUploadedName("")
    if (!file) {
      setUploadMeta(source === "picker" ? "No file selected." : "No supported image found.")
      return
    }
    if (!UPLOAD_IMAGE_TYPES.has(file.type)) {
      setUploadMeta("Unsupported image type.")
      return
    }
    const dataUrl = await fileToDataUrl(file)
    const name = file.name || `Pasted image.${extensionForImageType(file.type)}`
    setSourceKind("upload")
    setUploadedDataUrl(dataUrl)
    setUploadedName(name)
    setUploadMeta(`${sourceLabel(source)} ${name} · ${formatBytes(file.size)}`)
  }, [])

  React.useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const file = getImageFileFromTransfer(event.clipboardData)
      if (!file) return
      event.preventDefault()
      await openCreator({ sourceKind: "upload" })
      await acceptUploadFile(file, "paste")
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasImageTransfer(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
      setIsDraggingUpload(true)
    }
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setIsDraggingUpload(false)
    }
    const onDrop = async (event: DragEvent) => {
      if (event.defaultPrevented) return
      const file = getImageFileFromTransfer(event.dataTransfer)
      if (!file) return
      event.preventDefault()
      setIsDraggingUpload(false)
      await openCreator({ sourceKind: "upload" })
      await acceptUploadFile(file, "drop")
    }

    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("paste", onPaste)
    }
  }, [acceptUploadFile, openCreator])

  async function submitCreateJob() {
    setSubmitting(true)
    setStatus("Submitting creation job...")
    try {
      const request: CreateJobSubmitRequest = {
        modeId,
        source: buildCreateSourcePayload(),
        params: buildCreateParamsPayload(),
      }
      if (selectedTemplateId) request.templateId = selectedTemplateId
      const response = await fetchJson<CreateJobSubmitResponse>("/api/create/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      })
      setStatus("Submitted. Waiting for output...")
      await pollCreateJob(response.jobId, response.pollMs || 2000)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function pollCreateJob(jobId: string, pollMs: number) {
    const data = await fetchJson<CreateJobPollResponse>(`/api/create/jobs/${encodeURIComponent(jobId)}`)
    setStatus(`Job ${data.job.status || "pending"}.`)
    if (["done", "failed", "error"].includes(data.job.status || "")) return
    window.setTimeout(() => {
      void pollCreateJob(jobId, data.pollMs || pollMs)
    }, data.pollMs || pollMs)
  }

  async function importTemplate() {
    setStatus("Importing template from history...")
    const response = await fetchJson<ImportCreateTemplateResponse>("/api/create/templates/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: templateJobId.trim(), label: templateLabel.trim() }),
    })
    await loadModes()
    setModeId(modeIdForTemplate(response.template))
    setSelectedTemplateId(response.template.id)
    setStatus(`Imported ${response.template.label}.`)
  }

  function applyTemplate(template: CreateTemplate) {
    const settings = template.settings
    setSelectedTemplateId(template.id)
    setTemplateType(template.type)
    setModeId(modeIdForTemplate(template))
    const promptParam = paramAsString(settings.params?.["prompt"])
    const negativePromptParam =
      paramAsString(settings.params?.["negativePrompt"] ?? settings.params?.["negative_prompt"]) ?? template.negativePrompt
    const qualityParam = paramAsString(settings.params?.["quality"])
    if (promptParam !== undefined) setPrompt(promptParam)
    if (negativePromptParam !== undefined) setNegativePrompt(negativePromptParam)
    if (qualityParam !== undefined) setQuality(qualityParam)
    setStatus(`Using template ${template.label}. Overrides apply only to this run.`)
  }

  function clearTemplate() {
    setSelectedTemplateId("")
    setStatus("Template cleared.")
  }

  function buildTemplateDraft(label: string, type: CreateTemplateType = templateType) {
    const settings = {
      modeId,
      source: buildReusableTemplateSource(),
      params: buildCreateParamsPayload(),
    }
    const promptParam = paramAsString(settings.params["prompt"]) || ""
    const negativePromptParam = paramAsString(settings.params["negativePrompt"]) || ""
    const qualityParam = paramAsString(settings.params["quality"]) || "1080p-15"
    const imageParams: CreateParams = { prompt: promptParam }
    const videoParams: CreateParams = { prompt: promptParam, quality: qualityParam }

    if (negativePromptParam) {
      imageParams["negativePrompt"] = negativePromptParam
      videoParams["negativePrompt"] = negativePromptParam
    }

    return {
      label,
      type,
      settings,
      workflow:
        type === "combo"
          ? [
              {
                modeId: "custom-image",
                params: imageParams,
              },
              {
                modeId: "custom-video",
                params: videoParams,
              },
            ]
          : type === "nudify-video"
            ? [
                {
                  modeId: "nudify",
                  params: {},
                },
                {
                  modeId: "custom-video",
                  params: videoParams,
                },
              ]
            : [settings],
    }
  }

  function buildCreateSourcePayload(): CreationSource | null {
    if (selectedMode?.source?.required === false) {
      return null
    }

    if (sourceKind === "catalog") {
      if (!selectedSourceId) throw new Error("Attach a collection image.")
      return { kind: "catalog", itemId: selectedSourceId }
    }
    if (sourceKind === "upload") {
      if (!uploadedDataUrl) throw new Error("Choose, drop, or paste an image.")
      return { kind: "upload", dataUrl: uploadedDataUrl }
    }
    if (!sourceUrl.trim()) throw new Error("Enter an image URL.")
    return { kind: "url", url: sourceUrl.trim() }
  }

  function buildCreateParamsPayload(): CreateParams {
    const params: CreateParams = {}
    if (promptField) params["prompt"] = prompt.trim()
    if (promptField && negativePrompt.trim()) params["negativePrompt"] = negativePrompt.trim()
    if (qualityField) params["quality"] = quality
    return params
  }

  function buildReusableTemplateSource(): CreationSource | null {
    if (sourceKind === "catalog" && selectedSourceId) {
      return selectedSource?.outputUrl
        ? { kind: "catalog", itemId: selectedSourceId, url: selectedSource.outputUrl }
        : { kind: "catalog", itemId: selectedSourceId }
    }
    if (sourceKind === "url" && sourceUrl.trim()) {
      return { kind: "url", url: sourceUrl.trim() }
    }
    if (sourceKind === "upload") {
      return { kind: "upload" }
    }

    return null
  }

  function resetCreateForm() {
    clearSource()
    setPrompt("")
    setNegativePrompt("")
    setStatus("Choose a source and mode.")
  }

  function clearSource() {
    setSelectedSourceId("")
    setUploadedDataUrl(null)
    setUploadedName("")
    setUploadMeta("No file selected.")
    setSourceUrl("")
  }

  return {
    open,
    setOpen,
    panelRef,
    fileInputRef,
    modes,
    sourceKind,
    setSourceKind,
    selectedSource,
    uploadedDataUrl,
    uploadedName,
    uploadMeta,
    sourceUrl,
    setSourceUrl,
    modeId,
    setModeId,
    selectedMode,
    prompt,
    setPrompt,
    negativePrompt,
    setNegativePrompt,
    promptField,
    quality,
    setQuality,
    qualityField,
    status,
    submitting,
    templateJobId,
    setTemplateJobId,
    templateLabel,
    setTemplateLabel,
    selectedTemplateId,
    setSelectedTemplateId,
    templateSearch,
    setTemplateSearch,
    templateType,
    setTemplateType,
    isDraggingUpload,
    setIsDraggingUpload,
    openCreator,
    acceptUploadFile,
    clearSource,
    submitCreateJob,
    importTemplate,
    applyTemplate,
    clearTemplate,
    buildTemplateDraft,
    resetCreateForm,
  }
}

function paramAsString(value: CreateParams[string]): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function modeIdForTemplate(template: CreateTemplate): string {
  if (template.type === "image") return "custom-image"
  if (template.type === "combo") return "custom-image-video"
  if (template.type === "nudify-video") return "nudify-video"

  return "custom-video"
}
