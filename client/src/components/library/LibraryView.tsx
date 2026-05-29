import { Sparkles } from "lucide-react"

import { MediaSkeleton } from "@/components/common/MediaSkeleton"
import { MediaCard } from "@/components/media/MediaCard"
import { cn } from "@/lib/utils"

import { ActiveFilters } from "./ActiveFilters"
import { LibraryToolbar } from "./LibraryToolbar"
import { PagerControls } from "./PagerControls"
import { SummaryStrip } from "./SummaryStrip"
import type { LibraryViewProps } from "./types"

export function LibraryView({
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
  clearFilters,
  onOpenCreate,
  onDetails,
  onCopyPrompt,
}: LibraryViewProps) {
  const facets = itemsData?.facets || {}
  const showEmptyState = !itemsLoading && Boolean(itemsData) && (itemsData?.items.length || 0) === 0

  return (
    <section id="libraryArea" className="library-grid">
      <div className="library-main">
        <LibraryToolbar
          searchDraft={searchDraft}
          setSearchDraft={setSearchDraft}
          facets={facets}
          media={media}
          setMedia={setMedia}
          status={status}
          setStatus={setStatus}
          sort={sort}
          setSort={setSort}
          pageSize={pageSize}
          setPageSize={setPageSize}
          setPage={setPage}
        />

        <SummaryStrip facets={facets} status={status} setStatus={setStatus} setPage={setPage} />
        <ActiveFilters
          query={query}
          media={media}
          status={status}
          sort={sort}
          setSearchDraft={setSearchDraft}
          setMedia={setMedia}
          setStatus={setStatus}
          setSort={setSort}
          clearFilters={clearFilters}
        />

        <PagerControls
          page={page}
          setPage={setPage}
          pageCount={itemsData?.pageCount || 1}
          itemsData={itemsData}
          view={view}
          setView={setView}
        />

        <section
          id="grid"
          className={cn("media-grid", view === "list" && "is-list", pending && "opacity-75")}
          aria-label="Downloaded media"
          data-view={view}
        >
          {itemsLoading && !itemsData
            ? Array.from({ length: 12 }, (_, index) => <MediaSkeleton key={index} view={view} />)
            : deferredItems.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  view={view}
                  onDetails={() => onDetails(item)}
                  onCopyPrompt={() => onCopyPrompt(item)}
                  onCreate={() => onOpenCreate({ sourceItem: item, prompt: item.prompt })}
                />
              ))}
        </section>

        {showEmptyState && (
          <section id="emptyState" className="empty-state">
            <Sparkles className="size-9 text-muted-foreground" />
            <h2>No media found</h2>
            <p>Adjust filters, sync the library, or start creating from an upload.</p>
          </section>
        )}
      </div>
    </section>
  )
}
