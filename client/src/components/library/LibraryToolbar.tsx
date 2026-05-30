import { Search, X } from "lucide-react"

import { SelectControl } from "@/components/common/NativeSelect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sortOptions } from "@/hooks/use-library"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
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
}) {
  const showAdvancedControls = useMediaQuery("(min-width: 861px)")

  return (
    <section
      className={cn(
        "toolbar grid grid-cols-2 gap-2 border-b bg-background p-3",
        showAdvancedControls && "sticky top-14 z-20 grid-cols-[minmax(240px,1fr)_148px_176px_132px]",
      )}
      aria-label="Library filters"
    >
      <div className={cn("relative", showAdvancedControls ? "col-span-1" : "col-span-2")}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="searchInput"
          className="h-9 pl-9 pr-9"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search prompt, ID, type..."
        />
        {searchDraft && (
          <Button
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            variant="ghost"
            size="icon"
            onClick={() => setSearchDraft("")}
            aria-label="Clear search"
          >
            <X />
          </Button>
        )}
      </div>

      <SelectControl
        id="mediaSelect"
        className="mediaFilter h-9"
        aria-label="Media filter"
        value={media}
        onChange={(value) => {
          setMedia(value)
        }}
      >
        <option value="all">Media: All ({facets.media?.all || 0})</option>
        <option value="image">Images ({facets.media?.image || 0})</option>
        <option value="video">Videos ({facets.media?.video || 0})</option>
      </SelectControl>
      <SelectControl
        id="statusSelect"
        className="statusFilter h-9"
        aria-label="Status filter"
        value={status}
        onChange={(value) => {
          setStatus(value)
        }}
      >
        <option value="all">Status: All ({facets.status?.all || 0})</option>
        <option value="downloaded">Downloaded ({facets.status?.downloaded || 0})</option>
        <option value="missing">Missing ({facets.status?.missing || 0})</option>
        <option value="error">Errors ({facets.status?.error || 0})</option>
        <option value="duplicate">Duplicates ({facets.status?.duplicate || 0})</option>
        <option value="unverified">Unverified ({facets.status?.unverified || 0})</option>
        <option value="favorited">Favorited ({facets.status?.favorited || 0})</option>
        <option value="deleted">Deleted ({facets.status?.deleted || 0})</option>
      </SelectControl>
      {showAdvancedControls && (
        <>
          <SelectControl
            id="sortSelect"
            className="sortFilter h-9"
            aria-label="Sort order"
            value={sort}
            onChange={(value) => {
              setSort(value)
            }}
          >
            {sortOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectControl>
        </>
      )}
    </section>
  )
}
