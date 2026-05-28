import { Search } from "lucide-react"
import type * as React from "react"

import { NativeSelect } from "@/components/common/NativeSelect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sortOptions } from "@/hooks/use-library"
import type { ItemsResponse } from "@/types/domain"

export function LibraryToolbar({
  searchDraft,
  setSearchDraft,
  facets,
  media,
  setMedia,
  status,
  setStatus,
  sort,
  setSort,
  pageSize,
  setPageSize,
  setPage,
}: {
  searchDraft: string
  setSearchDraft: (value: string) => void
  facets: ItemsResponse["facets"]
  media: string
  setMedia: (value: string) => void
  status: string
  setStatus: (value: string) => void
  sort: string
  setSort: (value: string) => void
  pageSize: string
  setPageSize: (value: string) => void
  setPage: React.Dispatch<React.SetStateAction<number>>
}) {
  return (
    <section className="toolbar" aria-label="Library filters">
      <div className="search-shell">
        <Search className="size-4 text-muted-foreground" />
        <Input
          id="searchInput"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search prompt, ID, type..."
        />
        {searchDraft && (
          <Button variant="ghost" size="icon" onClick={() => setSearchDraft("")} aria-label="Clear search">
            ×
          </Button>
        )}
      </div>

      <NativeSelect
        id="mediaSelect"
        className="mediaFilter"
        label="Media"
        value={media}
        onChange={(value) => {
          setPage(1)
          setMedia(value)
        }}
      >
        <option value="all">All ({facets.media?.all || 0})</option>
        <option value="image">Images ({facets.media?.image || 0})</option>
        <option value="video">Videos ({facets.media?.video || 0})</option>
      </NativeSelect>
      <NativeSelect
        id="statusSelect"
        className="statusFilter"
        label="Status"
        value={status}
        onChange={(value) => {
          setPage(1)
          setStatus(value)
        }}
      >
        <option value="all">All ({facets.status?.all || 0})</option>
        <option value="downloaded">Downloaded ({facets.status?.downloaded || 0})</option>
        <option value="missing">Missing ({facets.status?.missing || 0})</option>
        <option value="error">Errors ({facets.status?.error || 0})</option>
        <option value="duplicate">Duplicates ({facets.status?.duplicate || 0})</option>
        <option value="unverified">Unverified ({facets.status?.unverified || 0})</option>
        <option value="favorited">Favorited ({facets.status?.favorited || 0})</option>
      </NativeSelect>
      <NativeSelect
        id="sortSelect"
        className="sortFilter"
        label="Sort"
        value={sort}
        onChange={(value) => {
          setPage(1)
          setSort(value)
        }}
      >
        {sortOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        id="pageSizeSelect"
        className="pageSizeFilter"
        label="Page"
        value={pageSize}
        onChange={(value) => {
          setPage(1)
          setPageSize(value)
        }}
      >
        <option value="48">48</option>
        <option value="96">96</option>
        <option value="180">180</option>
      </NativeSelect>
    </section>
  )
}
