import * as React from "react"

import { fetchJson } from "@/lib/api"
import type { ViewMode } from "@/types/domain"
import type { ItemsResponse } from "@/types/routes"

const SEARCH_DEBOUNCE_MS = 260

export const sortOptions = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["largest", "Largest"],
  ["smallest", "Smallest"],
] as const

export function useLibrary() {
  const initial = readLibraryStateFromUrl()
  const [itemsData, setItemsData] = React.useState<ItemsResponse | null>(null)
  const [itemsLoading, setItemsLoading] = React.useState(true)
  const [searchDraft, setSearchDraft] = React.useState(initial.q)
  const [query, setQuery] = React.useState(initial.q)
  const [media, setMedia] = React.useState(initial.media)
  const [status, setStatus] = React.useState(initial.status)
  const [sort, setSort] = React.useState(initial.sort)
  const [pageSize, setPageSize] = React.useState(initial.pageSize)
  const [page, setPage] = React.useState(initial.page)
  const [view, setView] = React.useState<ViewMode>(initial.view)
  const [pending, startTransition] = React.useTransition()
  const deferredItems = React.useDeferredValue(itemsData?.items || [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setQuery(searchDraft.trim())
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchDraft])

  const loadItems = React.useCallback(
    async (options: { keepLoading?: boolean } = {}) => {
      if (!options.keepLoading) setItemsLoading(true)

      const params = new URLSearchParams({
        media,
        status,
        sort,
        pageSize,
        page: String(page),
      })
      if (query) params.set("q", query)

      try {
        const data = await fetchJson<ItemsResponse>(`/api/items?${params}`)
        startTransition(() => setItemsData(data))
      } finally {
        setItemsLoading(false)
      }
    },
    [media, page, pageSize, query, sort, status],
  )

  React.useEffect(() => {
    void loadItems()
    writeLibraryStateToUrl({ query, media, status, sort, pageSize, page, view })
  }, [loadItems, query, media, status, sort, pageSize, page, view])

  function clearFilters() {
    setSearchDraft("")
    setQuery("")
    setMedia("all")
    setStatus("all")
    setSort("newest")
    setPage(1)
  }

  return {
    itemsData,
    itemsLoading,
    deferredItems,
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
    pageSize,
    setPageSize,
    page,
    setPage,
    view,
    setView,
    loadItems,
    clearFilters,
  }
}

function readLibraryStateFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get("q") || "",
    media: params.get("media") || "all",
    status: params.get("status") || "all",
    sort: params.get("sort") || "newest",
    pageSize: params.get("pageSize") || "48",
    page: Math.max(1, Number(params.get("page") || 1)),
    view: (params.get("view") === "list" ? "list" : "grid") as ViewMode,
  }
}

function writeLibraryStateToUrl(state: {
  query: string
  media: string
  status: string
  sort: string
  pageSize: string
  page: number
  view: ViewMode
}) {
  const params = new URLSearchParams()
  if (state.query) params.set("q", state.query)
  if (state.media !== "all") params.set("media", state.media)
  if (state.status !== "all") params.set("status", state.status)
  if (state.sort !== "newest") params.set("sort", state.sort)
  if (state.pageSize !== "48") params.set("pageSize", state.pageSize)
  if (state.page > 1) params.set("page", String(state.page))
  if (state.view !== "grid") params.set("view", state.view)

  const next = params.toString() ? `?${params}` : window.location.pathname
  window.history.replaceState(null, "", next)
}
