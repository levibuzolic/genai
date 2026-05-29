import { FilterChip } from "@/components/common/FilterChip"
import { Button } from "@/components/ui/button"

export function ActiveFilters({
  query,
  media,
  status,
  sort,
  setSearchDraft,
  setMedia,
  setStatus,
  setSort,
  clearFilters,
}: {
  query: string
  media: string
  status: string
  sort: string
  setSearchDraft: (value: string) => void
  setMedia: (value: string) => void
  setStatus: (value: string) => void
  setSort: (value: string) => void
  clearFilters: () => void
}) {
  const active = Boolean(query || media !== "all" || status !== "all" || sort !== "newest")
  if (!active) return null

  return (
    <section id="activeFilters" className="filter-chips">
      {query && <FilterChip label={`Search: ${query}`} onClear={() => setSearchDraft("")} />}
      {media !== "all" && <FilterChip label={`Media: ${media}`} onClear={() => setMedia("all")} />}
      {status !== "all" && <FilterChip label={`Status: ${status}`} onClear={() => setStatus("all")} />}
      {sort !== "newest" && <FilterChip label={`Sort: ${sort}`} onClear={() => setSort("newest")} />}
      <Button variant="ghost" size="sm" onClick={clearFilters}>
        Clear all
      </Button>
    </section>
  )
}
