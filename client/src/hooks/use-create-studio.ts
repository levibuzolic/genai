import * as React from "react"

import { fetchJson } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { isImageItem } from "@/lib/media"
import { extensionForImageType, fileToDataUrl, getImageFileFromTransfer, sourceLabel, UPLOAD_IMAGE_TYPES } from "@/lib/upload"
import type {
  CatalogItem,
  CreateField,
  CreateJob,
  CreateMode,
  CreationSource,
  ItemsResponse,
  SourceKind,
  UploadSource,
} from "@/types/domain"

const CREATE_SOURCE_SEARCH_DEBOUNCE_MS = 220

export function useCreateStudio(onLibraryChanged: () => Promise<void>) {
  const [open, setOpen] = React.useState(false)
  const [modes, setModes] = React.useState<CreateMode[]>([])
  const [sourceKind, setSourceKind] = React.useState<SourceKind>("catalog")
  const [sourceSearch, setSourceSearch] = React.useState("")
  const [sourceSearchQuery, setSourceSearchQuery] = React.useState("")
  const [sourceItems, setSourceItems] = React.useState<CatalogItem[]>([])
  const [selectedSourceId, setSelectedSourceId] = React.useState("")
  const [uploadedDataUrl, setUploadedDataUrl] = React.useState<string | null>(null)
  const [uploadedName, setUploadedName] = React.useState("")
  const [uploadMeta, setUploadMeta] = React.useState("No file selected.")
  const [sourceUrl, setSourceUrl] = React.useState("")
  const [modeId, setModeId] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [quality, setQuality] = React.useState("")
  const [status, setStatus] = React.useState("Choose a source and mode.")
  const [result, setResult] = React.useState<CreateJob | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [templateJobId, setTemplateJobId] = React.useState("")
  const [templateLabel, setTemplateLabel] = React.useState("")
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
    setModes(data.modes || [])
    const firstEnabled = data.modes?.find((modeOption) => !modeOption.disabled)
    setModeId((current) => {
      if (current && data.modes?.some((entry) => entry.id === current && !entry.disabled)) return current
      return firstEnabled?.id || ""
    })
  }, [])

  const loadSources = React.useCallback(async () => {
    const params = new URLSearchParams({
      media: "image",
      status: "all",
      sort: "newest",
      pageSize: "240",
      page: "1",
    })
    if (sourceSearchQuery) params.set("q", sourceSearchQuery)
    const data = await fetchJson<ItemsResponse>(`/api/items?${params}`)
    setSourceItems(data.items || [])
    setSelectedSourceId((current) => {
      if (current && data.items?.some((item) => item.id === current)) return current
      return data.items?.[0]?.id || ""
    })
  }, [sourceSearchQuery])

  React.useEffect(() => {
    void loadModes()
  }, [loadModes])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSourceSearchQuery(sourceSearch.trim())
    }, CREATE_SOURCE_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [sourceSearch])

  React.useEffect(() => {
    if (!open) return
    void loadModes()
  }, [loadModes, open])

  React.useEffect(() => {
    if (!open) return
    void loadSources()
  }, [loadSources, open])

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

  React.useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const file = getImageFileFromTransfer(event.clipboardData)
      if (!file) return
      event.preventDefault()
      await openCreator({ sourceKind: "upload" })
      await acceptUploadFile(file, "paste")
    }

    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])

  async function openCreator(
    options: {
      sourceKind?: SourceKind | undefined
      sourceItem?: CatalogItem | null | undefined
      source?: CreationSource | null | undefined
      prompt?: string | undefined
      modeId?: string | undefined
      params?: Record<string, string> | undefined
    } = {},
  ) {
    setOpen(true)
    if (options.sourceKind) setSourceKind(options.sourceKind)
    if (options.prompt) setPrompt(options.prompt)
    if (options.modeId) setModeId(options.modeId)
    if (options.params?.["prompt"]) setPrompt(options.params["prompt"])
    if (options.params?.["quality"]) setQuality(options.params["quality"])
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
  }

  async function acceptUploadFile(file: File | null, source: UploadSource) {
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
  }

  async function submitCreateJob() {
    setSubmitting(true)
    setStatus("Submitting creation job...")
    setResult(null)
    try {
      const response = await fetchJson<{ jobId: string; modeId: string; modeLabel: string; pollMs?: number }>("/api/create/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modeId,
          source: buildCreateSourcePayload(),
          params: buildCreateParamsPayload(),
        }),
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
    const data = await fetchJson<{ job: CreateJob; pollMs?: number }>(`/api/create/jobs/${encodeURIComponent(jobId)}`)
    setResult(data.job)
    setStatus(`Job ${data.job.status || "pending"}.`)
    if (["done", "failed", "error"].includes(data.job.status || "")) return
    window.setTimeout(() => {
      void pollCreateJob(jobId, data.pollMs || pollMs)
    }, data.pollMs || pollMs)
  }

  async function downloadCreateJob() {
    if (!result?.id) return
    setStatus("Downloading to library...")
    await fetchJson(`/api/create/jobs/${encodeURIComponent(result.id)}/download`, { method: "POST" })
    setStatus("Downloaded to library.")
    await onLibraryChanged()
  }

  async function importTemplate() {
    setStatus("Importing template from history...")
    const response = await fetchJson<{ template: { id: string; label: string } }>("/api/create/templates/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: templateJobId.trim(), label: templateLabel.trim() }),
    })
    await loadModes()
    setModeId(response.template.id)
    setStatus(`Imported ${response.template.label}.`)
  }

  function buildCreateSourcePayload() {
    if (sourceKind === "catalog") {
      if (!selectedSource) throw new Error("Choose a collection image.")
      return { kind: "catalog", itemId: selectedSource.id }
    }
    if (sourceKind === "upload") {
      if (!uploadedDataUrl) throw new Error("Choose, drop, or paste an image.")
      return { kind: "upload", dataUrl: uploadedDataUrl }
    }
    if (!sourceUrl.trim()) throw new Error("Enter an image URL.")
    return { kind: "url", url: sourceUrl.trim() }
  }

  function buildCreateParamsPayload() {
    const params: Record<string, string> = {}
    if (promptField) params["prompt"] = prompt.trim()
    if (qualityField) params["quality"] = quality
    return params
  }

  function resetCreateForm() {
    setUploadedDataUrl(null)
    setUploadedName("")
    setUploadMeta("No file selected.")
    setSourceUrl("")
    setPrompt("")
    setResult(null)
    setStatus("Choose a source and mode.")
  }

  function animateCreateResult() {
    if (!result?.outputUrl) return
    setSourceKind("url")
    setSourceUrl(result.outputUrl)
    setModeId("custom-video")
    setResult(null)
    setStatus("Ready to animate this output.")
  }

  return {
    open,
    setOpen,
    panelRef,
    fileInputRef,
    modes,
    sourceKind,
    setSourceKind,
    sourceSearch,
    setSourceSearch,
    sourceItems,
    selectedSource,
    selectedSourceId,
    setSelectedSourceId,
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
    promptField,
    quality,
    setQuality,
    qualityField,
    status,
    result,
    submitting,
    templateJobId,
    setTemplateJobId,
    templateLabel,
    setTemplateLabel,
    isDraggingUpload,
    setIsDraggingUpload,
    openCreator,
    acceptUploadFile,
    submitCreateJob,
    downloadCreateJob,
    importTemplate,
    resetCreateForm,
    animateCreateResult,
  }
}
