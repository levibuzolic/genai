import type { CatalogItem, ItemsResponse, SourceKind, ViewMode } from "@/types/domain"

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
  hasMoreItems: boolean
  loadingMore: boolean
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
  view: ViewMode
  setView: (value: ViewMode) => void
  clearFilters: () => void
  onLoadMore: () => void
  onOpenCreate: (options?: OpenCreateOptions) => void
  onDetails: (item: CatalogItem) => void
  onCopyPrompt: (item: CatalogItem) => void
  onDeleteRemote: (item: CatalogItem) => void
  onToggleFavorite: (item: CatalogItem) => void
}
