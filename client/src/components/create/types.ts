import type * as React from "react"

import type {
  CatalogItem,
  CreateField,
  CreateJob,
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
  sourceSearch: string
  setSourceSearch: (value: string) => void
  sourceItems: CatalogItem[]
  selectedSource: CatalogItem | null
  selectedSourceId: string
  setSelectedSourceId: (id: string) => void
  uploadMeta: string
  uploadedDataUrl: string | null
  uploadedName: string
  sourceUrl: string
  setSourceUrl: (value: string) => void
  modes: CreateMode[]
  modeId: string
  setModeId: (id: string) => void
  prompt: string
  setPrompt: (value: string) => void
  promptField: CreateField | undefined
  quality: string
  setQuality: (value: string) => void
  qualityField: CreateField | undefined
  createStatus: string
  createResult: CreateJob | null
  createSubmitting: boolean
  isDraggingUpload: boolean
  setIsDraggingUpload: (value: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onUploadFile: (file: File | null, source: UploadSource) => Promise<void>
  onSubmit: () => Promise<void>
  onReset: () => void
  onClose: () => void
  onDownload: () => Promise<void>
  onAnimate: () => void
  templates: CreateTemplate[]
  templateSearch: string
  setTemplateSearch: (value: string) => void
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
  onDuplicateCreation: (creation: Creation) => Promise<void>
  onSaveCreationTemplate: (creation: Creation) => Promise<void>
}
