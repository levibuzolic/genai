import type * as React from "react"

import type {
  CatalogItem,
  CreateField,
  CreateMode,
  CreateTemplate,
  CreateTemplateType,
  Creation,
  CreationEvent,
  SourceKind,
  UploadSource,
} from "@/types/domain"

export type CreateStudioProps = {
  sourceKind: SourceKind
  setSourceKind: (kind: SourceKind) => void
  sourceItems: CatalogItem[]
  sourceItemsLoading: boolean
  onSelectCatalogSource: (item: CatalogItem) => void
  onRefreshCatalogSources: () => Promise<void>
  selectedSource: CatalogItem | null
  uploadMeta: string
  uploadedDataUrl: string | null
  uploadedName: string
  sourceUrl: string
  setSourceUrl: (value: string) => void
  modes: CreateMode[]
  modeId: string
  setModeId: (id: string) => void
  accountOptions: string[]
  selectedAccountEmail: string
  autoAccountEmail: string
  setSelectedAccountEmail: (email: string) => void
  pendingGenerationCountsByAccount: Record<string, number>
  queuedGenerationCountsByAccount: Record<string, number>
  pendingGenerationCount: number
  queuedGenerationCount: number
  generationConcurrencyLimit: number
  prompt: string
  setPrompt: (value: string) => void
  negativePrompt: string
  setNegativePrompt: (value: string) => void
  promptField: CreateField | undefined
  modelId: string
  setModelId: (value: string) => void
  modelField: CreateField | undefined
  quality: string
  setQuality: (value: string) => void
  qualityField: CreateField | undefined
  createStatus: string
  createSubmitting: boolean
  isDraggingUpload: boolean
  setIsDraggingUpload: (value: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onUploadFile: (file: File | null, source: UploadSource) => Promise<void>
  onClearSource: () => void
  onSubmit: (options?: { queue?: boolean }) => Promise<void>
  onReset: () => void
  onClose: () => void
  templates: CreateTemplate[]
  selectedTemplateId: string
  onApplyTemplate: (template: CreateTemplate) => void
  onClearTemplate: () => void
  templateType: CreateTemplateType
  setTemplateType: (value: CreateTemplateType) => void
  onSaveCurrentTemplate: (label: string, type: CreateTemplateType) => Promise<void>
  onOpenTemplates: () => void
  templateJobId: string
  setTemplateJobId: (value: string) => void
  templateLabel: string
  setTemplateLabel: (value: string) => void
  onImportTemplate: () => Promise<void>
  creations: Creation[]
  activeCreationCount: number
  creationHistoryLoading: boolean
  selectedCreation: Creation | null
  selectedCreationEvents: CreationEvent[]
  creationHistoryStatus: string
  onRefreshCreations: () => Promise<void>
  onCreationDetails: (creation: Creation) => Promise<void>
  onCloseCreationDetails: () => void
  onDuplicateCreation: (creation: Creation, options?: { includeSource?: boolean }) => Promise<void>
  onSaveCreationTemplate: (creation: Creation) => Promise<void>
}
