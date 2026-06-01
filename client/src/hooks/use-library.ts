import * as React from "react"

import { fetchJson } from "@/lib/api"
import { replaceEqualJson } from "@/lib/render-state"
import type { ViewMode } from "@/types/domain"
import type { ItemsResponse } from "@/types/routes"

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
  const [pending, startTransition] = React.useTransition()
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
            if (options.replace || !current || data.page <= 1) return replaceEqualJson(current, data)
            return replaceEqualJson(current, mergeItemsData(current, data))
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
    pending,
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
    clearFilters,
  }
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
