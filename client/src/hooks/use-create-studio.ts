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
  const [sourceItemsLoading, setSourceItemsLoading] = React.useState(false)
  const [selectedSourceId, setSelectedSourceId] = React.useState("")
  const [uploadedDataUrl, setUploadedDataUrl] = React.useState<string | null>(null)
  const [uploadedName, setUploadedName] = React.useState("")
  const [uploadMeta, setUploadMeta] = React.useState("No file selected.")
  const [sourceUrl, setSourceUrl] = React.useState("")
  const [modeId, setModeId] = React.useState("")
  const [selectedAccountEmail, setSelectedAccountEmail] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [negativePrompt, setNegativePrompt] = React.useState("")
  const [modelId, setModelId] = React.useState("")
  const [quality, setQuality] = React.useState("")
  const [status, setStatus] = React.useState("Pick source and mode.")
  const [submitting, setSubmitting] = React.useState(false)
  const [templateJobId, setTemplateJobId] = React.useState("")
  const [templateLabel, setTemplateLabel] = React.useState("")
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("")
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
  const modelField = selectedMode?.fields?.find((field) => field.name === "modelId") as CreateField | undefined
  const qualityField = selectedMode?.fields?.find((field) => field.name === "quality") as CreateField | undefined
  const availableQualityOptions = React.useMemo(() => {
    const options = qualityField?.options || []
    if (!modelField || !modelId) return options
    return options.filter((option) => !option.modelId || option.modelId === modelId)
  }, [modelField, modelId, qualityField])

  const loadModes = React.useCallback(async () => {
    const data = await fetchJson<{ modes: CreateMode[] }>("/api/create/modes")
    setModes((current) => replaceEqualJson(current, data.modes || []))
    const firstEnabled = data.modes?.find((modeOption) => !modeOption.disabled)
    setModeId((current) => {
      if (current && data.modes?.some((entry) => entry.id === current && !entry.disabled)) return current
      return firstEnabled?.id || ""
    })
  }, [])

  const loadCatalogSourceItems = React.useCallback(async () => {
    setSourceItemsLoading(true)
    try {
      const data = await fetchJson<{ items: CatalogItem[] }>(
        "/api/items?provider=generateporn&media=image&status=all&sort=newest&pageSize=120",
      )
      setSourceItems((current) => {
        const selected = current.find((item) => item.id === selectedSourceId)
        const nextItems = (data.items || []).filter((item) => isImageItem(item) && (item.localFile || item.outputUrl))
        const next = selected && !nextItems.some((item) => item.id === selected.id) ? [selected, ...nextItems] : nextItems
        return replaceEqualJson(current, next)
      })
    } catch {
      setSourceItems((current) => replaceEqualJson(current, []))
    } finally {
      setSourceItemsLoading(false)
    }
  }, [selectedSourceId])

  React.useEffect(() => {
    void loadModes()
  }, [loadModes])

  React.useEffect(() => {
    if (!open) return
    void loadModes()
  }, [loadModes, open])

  React.useEffect(() => {
    if (!modeId || !selectedMode) return
    const firstModelOption = modelField?.options?.[0]
    if (firstModelOption) {
      setModelId((current) => {
        if (current && modelField.options?.some((option) => option.value === current)) return current
        return modelField.default || firstModelOption.value
      })
    } else {
      setModelId("")
    }
  }, [modeId, modelField, selectedMode])

  React.useEffect(() => {
    if (!modeId || !selectedMode) return
    const firstQualityOption = qualityField?.options?.[0]
    const firstAvailableQualityOption = availableQualityOptions[0] || firstQualityOption
    if (firstAvailableQualityOption) {
      setQuality((current) => {
        if (current && availableQualityOptions.some((option) => option.value === current)) return current
        const defaultForModel = availableQualityOptions.find((option) => option.value === qualityField?.default)
        return defaultForModel?.value || firstAvailableQualityOption.value
      })
    } else {
      setQuality("")
    }
  }, [availableQualityOptions, modeId, qualityField, selectedMode])

  const attachCatalogSourceItem = React.useCallback(async (itemId: string) => {
    try {
      const data = await fetchJson<{ item: CatalogItem }>(`/api/items/${encodeURIComponent(itemId)}`)
      if (!isImageItem(data.item)) return
      setSourceItems((current) => {
        if (current.some((item) => item.id === data.item.id)) return current
        return [data.item, ...current]
      })
    } catch {
      // The source id is still enough for submission; the preview is best-effort.
    }
  }, [])

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
        accountEmail?: string | null | undefined
      } = {},
    ) {
      onOpen?.()
      setOpen(true)
      if (options.templateId) setSelectedTemplateId(options.templateId)
      if (options.sourceKind) setSourceKind(options.sourceKind)
      if (options.prompt !== undefined) setPrompt(options.prompt)
      if (options.modeId) setModeId(options.modeId)
      if (options.accountEmail) setSelectedAccountEmail(options.accountEmail)
      const promptParam = paramAsString(options.params?.["prompt"])
      const negativePromptParam = paramAsString(options.params?.["negativePrompt"] ?? options.params?.["negative_prompt"])
      const modelParam = paramAsString(options.params?.["modelId"])
      const qualityParam = paramAsString(options.params?.["quality"])
      if (promptParam !== undefined) setPrompt(promptParam)
      if (negativePromptParam !== undefined) setNegativePrompt(negativePromptParam)
      if (modelParam) setModelId(modelParam)
      if (qualityParam) setQuality(qualityParam)
      if (options.source?.kind === "url" && typeof options.source.url === "string") {
        setSourceKind("url")
        setSourceUrl(options.source.url)
      } else if (options.source?.kind === "catalog" && typeof options.source.itemId === "string") {
        setSourceKind("catalog")
        setSelectedSourceId(options.source.itemId)
        void attachCatalogSourceItem(options.source.itemId)
      } else if (options.source?.kind === "upload") {
        setSourceKind("upload")
        setUploadMeta("Choose, drop, or paste the source image again.")
      }
      const sourceItem = options.sourceItem
      if (sourceItem && isImageItem(sourceItem)) {
        if (sourceItem.accountEmail) setSelectedAccountEmail(sourceItem.accountEmail)
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
    [attachCatalogSourceItem, onOpen],
  )

  const selectCatalogSource = React.useCallback((item: CatalogItem) => {
    if (!isImageItem(item)) return
    setSourceKind("catalog")
    setSourceItems((current) => {
      if (current.some((entry) => entry.id === item.id)) return current
      return [item, ...current]
    })
    setSelectedSourceId(item.id)
  }, [])

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

  async function submitCreateJob({ queue = true, accountEmail = selectedAccountEmail }: { queue?: boolean; accountEmail?: string } = {}) {
    setSubmitting(true)
    setStatus(queue ? "Queueing..." : "Submitting...")
    try {
      const request: CreateJobSubmitRequest = {
        modeId,
        source: buildCreateSourcePayload(),
        params: buildCreateParamsPayload(),
      }
      if (accountEmail) request.accountEmail = accountEmail
      if (queue) request.queue = true
      if (selectedTemplateId) request.templateId = selectedTemplateId
      const response = await fetchJson<CreateJobSubmitResponse>("/api/create/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      })
      if (response.rateLimited) {
        dispatchCreateToast(response.error || "Upstream rate limit exceeded; retry queued.")
      }
      setStatus(response.rateLimited ? "Rate-limited; queued." : response.queued ? "Queued." : "Submitted.")
      window.setTimeout(() => {
        void pollCreateJob(response.jobId, response.pollMs || 2000)
      }, 0)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function pollCreateJob(jobId: string, pollMs: number) {
    setSubmitting(false)
    const data = await fetchJson<CreateJobPollResponse>(`/api/create/jobs/${encodeURIComponent(jobId)}`)
    setSubmitting(false)
    setStatus(formatCreateJobStatus(data.job.status))
    if (["done", "failed", "error"].includes(data.job.status || "")) return
    window.setTimeout(() => {
      void pollCreateJob(jobId, data.pollMs || pollMs)
    }, data.pollMs || pollMs)
  }

  async function importTemplate() {
    setStatus("Importing template...")
    const response = await fetchJson<ImportCreateTemplateResponse>("/api/create/templates/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: templateJobId.trim(), label: templateLabel.trim() }),
    })
    await loadModes()
    setModeId(modeIdForTemplate(response.template))
    setSelectedTemplateId(response.template.id)
    setStatus("Template imported.")
  }

  function applyTemplate(template: CreateTemplate) {
    const settings = template.settings
    setSelectedTemplateId(template.id)
    setTemplateType(template.type)
    setModeId(modeIdForTemplate(template))
    const promptParam = paramAsString(settings.params?.["prompt"])
    const negativePromptParam =
      paramAsString(settings.params?.["negativePrompt"] ?? settings.params?.["negative_prompt"]) ?? template.negativePrompt
    const modelParam = paramAsString(settings.params?.["modelId"])
    const qualityParam = paramAsString(settings.params?.["quality"])
    if (promptParam !== undefined) setPrompt(promptParam)
    if (negativePromptParam !== undefined) setNegativePrompt(negativePromptParam)
    if (modelParam !== undefined) setModelId(modelParam)
    if (qualityParam !== undefined) setQuality(qualityParam)
    setStatus("Template applied.")
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
    const modelParam = paramAsString(settings.params["modelId"]) || modelId
    const imageParams: CreateParams = { prompt: promptParam }
    const videoParams: CreateParams = { prompt: promptParam, quality: qualityParam, modelId: modelParam }

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
    if (modelField) params["modelId"] = modelId
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
    setModelId("")
    setStatus("Pick source and mode.")
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
    sourceItems,
    sourceItemsLoading,
    onSelectCatalogSource: selectCatalogSource,
    onRefreshCatalogSources: loadCatalogSourceItems,
    selectedSource,
    uploadedDataUrl,
    uploadedName,
    uploadMeta,
    sourceUrl,
    setSourceUrl,
    modeId,
    setModeId,
    selectedAccountEmail,
    setSelectedAccountEmail,
    selectedMode,
    prompt,
    setPrompt,
    negativePrompt,
    setNegativePrompt,
    promptField,
    modelId,
    setModelId,
    modelField,
    quality,
    setQuality,
    qualityField: qualityField ? { ...qualityField, options: availableQualityOptions } : undefined,
    status,
    submitting,
    templateJobId,
    setTemplateJobId,
    templateLabel,
    setTemplateLabel,
    selectedTemplateId,
    setSelectedTemplateId,
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

function dispatchCreateToast(message: string): void {
  window.dispatchEvent(
    new CustomEvent("genai:toast", {
      detail: {
        message,
      },
    }),
  )
}

function formatCreateJobStatus(status: string | null | undefined): string {
  const normalized = String(status || "pending").replace(/_/g, " ")
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}.`
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
