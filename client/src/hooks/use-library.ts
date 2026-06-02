import * as React from "react"

import { fetchJson } from "@/lib/api"
import { isImageItem, isVideoItem } from "@/lib/media"
import { replaceEqualJson } from "@/lib/render-state"
import type { CatalogItem, Creation, ViewMode } from "@/types/domain"
import type { ItemsResponse, PublicCatalogItem } from "@/types/routes"

const SEARCH_DEBOUNCE_MS = 260
const VIRTUAL_PAGE_SIZE = "48"
export type LibraryProviderFilter = "all" | "generateporn" | "playbox"

export const sortOptions = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["largest", "Largest"],
  ["smallest", "Smallest"],
] as const

export function useLibrary({ provider = "generateporn" }: { provider?: LibraryProviderFilter } = {}) {
  const initial = readLibraryStateFromUrl()
  const [itemsData, setItemsData] = React.useState<ItemsResponse | null>(null)
  const [itemsLoading, setItemsLoading] = React.useState(true)
  const [searchDraft, setSearchDraft] = React.useState(initial.q)
  const [query, setQuery] = React.useState(initial.q)
  const [media, setMedia] = React.useState(initial.media)
  const [status, setStatus] = React.useState(initial.status)
  const [sort, setSort] = React.useState(initial.sort)
  const [view, setView] = React.useState<ViewMode>(initial.view)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [, startTransition] = React.useTransition()
  const deferredItems = React.useDeferredValue(itemsData?.items || [])
  const requestIdRef = React.useRef(0)
  const loadingMoreRef = React.useRef(false)
  const querySignature = React.useMemo(() => JSON.stringify([provider, query, media, status, sort]), [media, provider, query, sort, status])
  const querySignatureRef = React.useRef(querySignature)

  React.useEffect(() => {
    querySignatureRef.current = querySignature
  }, [querySignature])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchDraft.trim())
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchDraft])

  const loadItemsPage = React.useCallback(
    async (pageToLoad: number, options: { replace: boolean; keepLoading?: boolean; more?: boolean }) => {
      const requestId = ++requestIdRef.current
      const requestSignature = querySignatureRef.current
      if (options.more) {
        loadingMoreRef.current = true
        setLoadingMore(true)
      } else if (!options.keepLoading) {
        setItemsLoading(true)
      }

      const params = new URLSearchParams({
        media,
        status,
        sort,
        provider,
        pageSize: VIRTUAL_PAGE_SIZE,
        page: String(pageToLoad),
      })
      if (query) params.set("q", query)

      try {
        const data = await fetchJson<ItemsResponse>(`/api/items?${params}`)
        if (requestSignature !== querySignatureRef.current || (!options.more && requestId !== requestIdRef.current)) return
        startTransition(() =>
          setItemsData((current) => {
            if (options.replace || !current || data.page <= 1) return reconcileItemsData(current, data)
            return reconcileItemsData(current, mergeItemsData(current, data))
          }),
        )
      } finally {
        if (options.more) {
          loadingMoreRef.current = false
          setLoadingMore(false)
        } else if (requestId === requestIdRef.current) {
          setItemsLoading(false)
        }
      }
    },
    [media, provider, query, sort, status],
  )

  const loadItems = React.useCallback(
    async (options: { keepLoading?: boolean } = {}) => {
      await loadItemsPage(1, {
        replace: true,
        ...(options.keepLoading === undefined ? {} : { keepLoading: options.keepLoading }),
      })
    },
    [loadItemsPage],
  )

  const loadNextPage = React.useCallback(
    async function loadNextPage() {
      if (!itemsData || itemsLoading || loadingMoreRef.current) return
      if (itemsData.page >= itemsData.pageCount || itemsData.items.length >= itemsData.total) return
      await loadItemsPage(itemsData.page + 1, { replace: false, more: true, keepLoading: true })
    },
    [itemsData, itemsLoading, loadItemsPage],
  )

  const addOptimisticCreations = React.useCallback(
    (creations: Creation[]) => {
      if (provider === "playbox") return

      const optimisticItems = creations.map(buildOptimisticCatalogItemFromCreation).filter((item): item is PublicCatalogItem => {
        if (!item) return false
        return matchesCurrentLibraryFilters(item, { media, provider, query, status })
      })
      if (!optimisticItems.length) return

      startTransition(() => {
        setItemsData((current) => (current ? mergeOptimisticItemsData(current, optimisticItems, sort) : current))
      })
    },
    [media, provider, query, sort, status],
  )

  React.useEffect(() => {
    void loadItems()
    writeLibraryStateToUrl({ query, media, status, sort, view })
  }, [loadItems, query, media, status, sort, view])

  function clearFilters() {
    setSearchDraft("")
    setQuery("")
    setMedia("all")
    setStatus("all")
    setSort("newest")
  }

  const hasMoreItems = Boolean(itemsData && itemsData.items.length < itemsData.total && itemsData.page < itemsData.pageCount)

  return {
    itemsData,
    itemsLoading,
    deferredItems,
    hasMoreItems,
    loadingMore,
    searchDraft,
    setSearchDraft,
    query,
    media,
    setMedia,
    status,
    setStatus,
    sort,
    setSort,
    view,
    setView,
    loadItems,
    loadNextPage,
    addOptimisticCreations,
    clearFilters,
  }
}

export function buildOptimisticCatalogItemFromCreation(creation: Creation): PublicCatalogItem | null {
  if (creation.status !== "done" || !creation.outputUrl || creation.downloadedItemId) return null

  const item: PublicCatalogItem = {
    id: creation.jobId || creation.id,
    provider: "generateporn",
    type: creation.mediaType || mediaTypeFromCreation(creation),
    status: creation.status,
    outputUrl: creation.outputUrl,
    prompt: typeof creation.params?.["prompt"] === "string" ? creation.params["prompt"] : "",
    negativePrompt: typeof creation.params?.["negativePrompt"] === "string" ? creation.params["negativePrompt"] : "",
    createdAt: creationCreatedAtMs(creation),
    createdAtIso:
      creation.createdAtIso || creation.finishedAt || creation.updatedAt || creation.createdLocallyAt || new Date().toISOString(),
    updatedAt: creation.updatedAt || creation.finishedAt || null,
    createModeId: creation.modeId || null,
    createParams: creation.params || null,
    templateId: creation.templateId || null,
    templateLabel: creation.templateLabel || null,
    createdLocallyAt: creation.createdLocallyAt || null,
    posterUrl: null,
  }

  if (creation.accountEmail !== undefined) item.accountEmail = creation.accountEmail
  if (creation.inputUrl !== undefined) item.inputUrl = creation.inputUrl
  if (creation.externalTaskId !== undefined) item.externalTaskId = creation.externalTaskId
  if (creation.error !== undefined) item.downloadError = creation.error
  if (typeof creation.params?.["modelId"] === "string") item.modelId = creation.params["modelId"]
  const duration = durationFromCreationParams(creation)
  if (duration !== null) item.duration = duration
  const source = creation.source
  if (source) {
    const kind = stringField(source, "kind")
    const itemId = stringField(source, "itemId")
    const url = stringField(source, "url")
    if (kind) item.sourceKind = kind
    if (itemId) item.sourceItemId = itemId
    if (url) item.sourceUrl = url
  }

  return item
}

function mergeOptimisticItemsData(current: ItemsResponse, optimisticItems: PublicCatalogItem[], sort: string): ItemsResponse {
  let addedCount = 0
  const optimisticItemsById = new Map(optimisticItems.map((item) => [item.id, item]))
  const seenOptimisticIds = new Set<string>()
  const addedItems: PublicCatalogItem[] = []
  const items = current.items.map((item) => {
    const optimisticItem = optimisticItemsById.get(item.id) || optimisticItems.find((nextItem) => sameOptimisticMedia(item, nextItem))
    if (!optimisticItem) return item
    seenOptimisticIds.add(optimisticItem.id)
    return optimisticItem
  })

  for (const optimisticItem of optimisticItems) {
    if (seenOptimisticIds.has(optimisticItem.id)) continue
    seenOptimisticIds.add(optimisticItem.id)
    items.push(optimisticItem)
    addedItems.push(optimisticItem)
    addedCount += 1
  }

  const sortedItems = sortCatalogItemsForView(items, sort)
  return replaceEqualJson(current, {
    ...current,
    items: sortedItems,
    total: current.total + addedCount,
    pageCount: Math.max(current.pageCount, Math.ceil((current.total + addedCount) / current.pageSize)),
    facets: incrementOptimisticFacets(current.facets, addedItems),
  })
}

function sameOptimisticMedia(left: CatalogItem, right: CatalogItem): boolean {
  return Boolean(
    (right.outputUrl && left.outputUrl === right.outputUrl) ||
    (right.externalTaskId && left.externalTaskId === right.externalTaskId) ||
    (right.createdLocallyAt && left.createdLocallyAt === right.createdLocallyAt),
  )
}

function incrementOptimisticFacets(facets: ItemsResponse["facets"], addedItems: PublicCatalogItem[]): ItemsResponse["facets"] {
  if (!addedItems.length) return facets

  let imageCount = 0
  let videoCount = 0
  for (const item of addedItems) {
    if (isImageItem(item)) imageCount += 1
    if (isVideoItem(item)) videoCount += 1
  }

  return {
    ...facets,
    media: {
      ...facets.media,
      all: (facets.media?.all || 0) + addedItems.length,
      image: (facets.media?.image || 0) + imageCount,
      video: (facets.media?.video || 0) + videoCount,
    },
    status: {
      ...facets.status,
      all: (facets.status?.all || 0) + addedItems.length,
    },
  }
}

function matchesCurrentLibraryFilters(
  item: CatalogItem,
  filters: { media: string; provider: LibraryProviderFilter; query: string; status: string },
): boolean {
  if (filters.provider === "playbox") return false
  if (filters.provider !== "all" && item.provider && item.provider !== filters.provider) return false
  if (filters.media === "image" && !isImageItem(item)) return false
  if (filters.media === "video" && !isVideoItem(item)) return false
  if (filters.status !== "all") return false

  const query = filters.query.trim().toLowerCase()
  if (!query) return true

  return [
    item.id,
    item.type,
    item.provider,
    item.collectionId,
    item.assetId,
    item.assetKind,
    item.prompt,
    item.negativePrompt,
    item.localFile,
  ].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(query),
  )
}

function sortCatalogItemsForView(items: PublicCatalogItem[], sort: string): PublicCatalogItem[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- TS target does not include Array#toSorted; slice keeps this immutable.
  return items.slice().sort((left, right) => {
    if (sort === "oldest") return itemCreatedAtMs(left) - itemCreatedAtMs(right)
    if (sort === "largest") return Number(right.size || 0) - Number(left.size || 0)
    if (sort === "smallest") return Number(left.size || 0) - Number(right.size || 0)
    return itemCreatedAtMs(right) - itemCreatedAtMs(left)
  })
}

function mediaTypeFromCreation(creation: Creation): string {
  if (creation.outputUrl && /\.mp4(?:[?#].*)?$/i.test(creation.outputUrl)) return "video"
  if (creation.outputUrl && /\.(png|jpe?g|webp|bmp)(?:[?#].*)?$/i.test(creation.outputUrl)) return "image"
  if (creation.modeId?.includes("video")) return "video"
  if (creation.modeId?.includes("image")) return "image"
  return "image"
}

function durationFromCreationParams(creation: Creation): number | null {
  const duration = Number(creation.params?.["duration"])
  if (Number.isFinite(duration) && duration > 0) return duration

  const quality = typeof creation.params?.["quality"] === "string" ? creation.params["quality"] : ""
  const match = quality.match(/(?:^|-)(\d+)$/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === "string" && field ? field : null
}

function creationCreatedAtMs(creation: Creation): number {
  return (
    timestampMs(creation.createdAt) ||
    timestampMs(creation.createdAtIso) ||
    timestampMs(creation.finishedAt) ||
    timestampMs(creation.updatedAt) ||
    timestampMs(creation.createdLocallyAt) ||
    Date.now()
  )
}

function itemCreatedAtMs(item: CatalogItem): number {
  return (
    timestampMs(item.createdAt) || timestampMs(item.createdAtIso) || timestampMs(item.createdLocallyAt) || timestampMs(item.updatedAt) || 0
  )
}

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? (value > 1_000_000_000_000 ? value : value * 1000) : null
  if (typeof value !== "string") return null

  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function reconcileItemsData(current: ItemsResponse | null, next: ItemsResponse): ItemsResponse {
  if (!current) return next

  const currentItemsById = new Map(current.items.map((item) => [item.id, item]))
  const items = next.items.map((item) => {
    const currentItem = currentItemsById.get(item.id)
    return currentItem && catalogItemRenderEqual(currentItem, item) ? currentItem : item
  })
  const reconciled = { ...next, items }
  if (itemsResponseRenderEqual(current, reconciled)) return current
  return replaceEqualJson(current, reconciled)
}

function itemsResponseRenderEqual(left: ItemsResponse, right: ItemsResponse): boolean {
  return (
    left.total === right.total &&
    left.page === right.page &&
    left.pageSize === right.pageSize &&
    left.pageCount === right.pageCount &&
    JSON.stringify(left.facets) === JSON.stringify(right.facets) &&
    left.items.length === right.items.length &&
    left.items.every((item, index) => {
      const rightItem = right.items[index]
      return rightItem ? item === rightItem || catalogItemRenderEqual(item, rightItem) : false
    })
  )
}

function catalogItemRenderEqual(left: CatalogItem, right: CatalogItem): boolean {
  return JSON.stringify(renderStableCatalogItem(left)) === JSON.stringify(renderStableCatalogItem(right))
}

function renderStableCatalogItem(item: CatalogItem): Omit<CatalogItem, "updatedAt"> {
  const { updatedAt: _updatedAt, ...stableItem } = item
  return stableItem
}

function mergeItemsData(current: ItemsResponse, data: ItemsResponse): ItemsResponse {
  const seen = new Set(current.items.map((item) => item.id))
  const items = current.items.slice()
  for (const item of data.items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }

  return {
    ...data,
    items,
    page: Math.max(current.page, data.page),
  }
}

function readLibraryStateFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get("q") || "",
    media: params.get("media") || "all",
    status: params.get("status") || "all",
    sort: params.get("sort") || "newest",
    view: (params.get("view") === "list" ? "list" : "grid") as ViewMode,
  }
}

function writeLibraryStateToUrl(state: { query: string; media: string; status: string; sort: string; view: ViewMode }) {
  const params = new URLSearchParams()
  if (state.query) params.set("q", state.query)
  if (state.media !== "all") params.set("media", state.media)
  if (state.status !== "all") params.set("status", state.status)
  if (state.sort !== "newest") params.set("sort", state.sort)
  if (state.view !== "grid") params.set("view", state.view)

  const search = params.toString()
  const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== current) {
    window.history.replaceState(null, "", next)
  }
}
