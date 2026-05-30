import { Sparkles } from "lucide-react"

import { ActiveFilters } from "./ActiveFilters"
import { LibraryIndexControls } from "./LibraryIndexControls"
import { LibraryToolbar } from "./LibraryToolbar"
import { SummaryStrip } from "./SummaryStrip"
import type { LibraryViewProps } from "./types"
import { VirtualMediaGrid } from "./VirtualMediaGrid"

export function LibraryView({
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
  clearFilters,
  onLoadMore,
  onOpenCreate,
  onDetails,
  onCopyPrompt,
  onDeleteRemote,
  onToggleFavorite,
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
        />

        <SummaryStrip facets={facets} status={status} setStatus={setStatus} />
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

        <LibraryIndexControls itemsData={itemsData} loading={itemsLoading} loadingMore={loadingMore} view={view} setView={setView} />

        <VirtualMediaGrid
          items={deferredItems}
          itemsLoading={itemsLoading}
          pending={pending}
          view={view}
          hasMore={hasMoreItems}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          onDetails={onDetails}
          onCopyPrompt={onCopyPrompt}
          onOpenCreate={(item) => onOpenCreate({ sourceItem: item, prompt: "", modeId: "custom-video" })}
          onDeleteRemote={onDeleteRemote}
          onToggleFavorite={onToggleFavorite}
        />

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
