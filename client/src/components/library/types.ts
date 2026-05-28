import type * as React from "react"

import type { Backup, CatalogItem, ItemsResponse, SourceKind, ViewMode } from "@/types/domain"

export type OpenCreateOptions = {
  sourceKind?: SourceKind | undefined
  sourceItem?: CatalogItem | null | undefined
  prompt?: string | undefined
  modeId?: string | undefined
}

export type LibraryViewProps = {
  itemsData: ItemsResponse | null
  itemsLoading: boolean
  deferredItems: CatalogItem[]
  pending: boolean
  searchDraft: string
  setSearchDraft: (value: string) => void
  query: string
  media: string
  setMedia: (value: string) => void
  status: string
  setStatus: (value: string) => void
  sort: string
  setSort: (value: string) => void
  pageSize: string
  setPageSize: (value: string) => void
  page: number
  setPage: React.Dispatch<React.SetStateAction<number>>
  view: ViewMode
  setView: (value: ViewMode) => void
  clearFilters: () => void
  backups: Backup[]
  selectedBackup: string
  setSelectedBackup: (value: string) => void
  onCreateBackup: () => void
  onRestoreBackup: () => void
  onOpenCreate: (options?: OpenCreateOptions) => void
  onDetails: (item: CatalogItem) => void
  onCopyPrompt: (item: CatalogItem) => void
}
