import { Sparkles } from "lucide-react"

import { MediaSkeleton } from "@/components/common/MediaSkeleton"
import { MediaCard } from "@/components/media/MediaCard"
import { cn } from "@/lib/utils"

import { ActiveFilters } from "./ActiveFilters"
import { CreateDock } from "./CreateDock"
import { InspectorPanel } from "./InspectorPanel"
import { LibraryHero } from "./LibraryHero"
import { LibraryStatusLine } from "./LibraryStatusLine"
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
  syncStatus,
  backups,
  selectedBackup,
  setSelectedBackup,
  onCreateBackup,
  onRestoreBackup,
  onOpenCreate,
  onDetails,
  onCopyPrompt,
}: LibraryViewProps) {
  const facets = itemsData?.facets || {}
  const total = itemsData?.total || 0
  const downloaded = facets.status?.downloaded || 0
  const progressValue = total ? Math.round((downloaded / total) * 100) : 0

  return (
    <section id="libraryArea" className="library-grid">
      <div className="library-main">
        <LibraryHero total={total} progressValue={progressValue} />
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

        <LibraryStatusLine syncStatus={syncStatus} itemsData={itemsData} />
        <PagerControls page={page} setPage={setPage} pageCount={itemsData?.pageCount || 1} view={view} setView={setView} />
        <CreateDock onOpenCreate={onOpenCreate} />

        <section
          id="grid"
          className={cn("media-grid", view === "list" && "is-list", pending && "opacity-75")}
          aria-label="Downloaded media"
          data-view={view}
        >
          {itemsLoading && !itemsData
            ? Array.from({ length: 12 }, (_, index) => <MediaSkeleton key={index} />)
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

        <section id="emptyState" className={cn("empty-state", deferredItems.length > 0 && "hidden")}>
          <Sparkles className="size-9 text-muted-foreground" />
          <h2>No media found</h2>
          <p>Adjust filters, sync the library, or start creating from an upload.</p>
        </section>
      </div>

      <InspectorPanel
        syncStatus={syncStatus}
        backups={backups}
        selectedBackup={selectedBackup}
        setSelectedBackup={setSelectedBackup}
        onCreateBackup={onCreateBackup}
        onRestoreBackup={onRestoreBackup}
      />
    </section>
  )
}
