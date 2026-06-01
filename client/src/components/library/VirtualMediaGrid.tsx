import * as React from "react"

import { MediaSkeleton } from "@/components/common/MediaSkeleton"
import { MediaCard } from "@/components/media/MediaCard"
import { cn } from "@/lib/utils"
import type { CatalogItem, ViewMode } from "@/types/domain"

const GRID_MIN_COLUMN_WIDTH = 200
const GRID_DESKTOP_GAP = 12
const DEFAULT_GRID_ROW_HEIGHT = 320
const DEFAULT_MOBILE_ROW_HEIGHT = 270
const DEFAULT_LIST_ROW_HEIGHT = 190
const OVERSCAN_ROWS = 2

export function VirtualMediaGrid({
  items,
  itemsLoading,
  view,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenCreate,
  onDetails,
  onCopyPrompt,
  onDeleteRemote,
  onToggleFavorite,
}: {
  items: CatalogItem[]
  itemsLoading: boolean
  view: ViewMode
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onOpenCreate: (item: CatalogItem) => void
  onDetails: (item: CatalogItem) => void
  onCopyPrompt: (item: CatalogItem) => void
  onDeleteRemote: (item: CatalogItem) => void
  onToggleFavorite: (item: CatalogItem) => void
}) {
  const gridRef = React.useRef<HTMLElement | null>(null)
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = React.useState(() => ({
    scrollY: window.scrollY,
    height: window.innerHeight,
    width: window.innerWidth,
    top: 0,
  }))
  const [measuredRowHeight, setMeasuredRowHeight] = React.useState(0)

  const columnCount = React.useMemo(() => {
    if (view === "list") return 1
    const width = viewport.width
    if (width < 768) return 2
    return Math.max(1, Math.floor((width + GRID_DESKTOP_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_DESKTOP_GAP)))
  }, [view, viewport.width])

  const fallbackRowHeight = React.useMemo(() => {
    if (view === "list") return DEFAULT_LIST_ROW_HEIGHT
    return viewport.width < 768 ? DEFAULT_MOBILE_ROW_HEIGHT : DEFAULT_GRID_ROW_HEIGHT
  }, [view, viewport.width])
  const rowHeight = measuredRowHeight || fallbackRowHeight
  const totalRows = Math.ceil(items.length / columnCount)
  const renderedRows = Math.max(1, Math.ceil(viewport.height / rowHeight) + OVERSCAN_ROWS * 2)
  const maxFirstRow = Math.max(0, totalRows - renderedRows)
  const firstRow = Math.min(maxFirstRow, Math.max(0, Math.floor((viewport.scrollY - viewport.top) / rowHeight) - OVERSCAN_ROWS))
  const lastRow = Math.min(totalRows, firstRow + renderedRows)
  const startIndex = firstRow * columnCount
  const endIndex = Math.min(items.length, lastRow * columnCount)
  const visibleItems = items.slice(startIndex, endIndex)
  const topSpacerHeight = firstRow * rowHeight
  const bottomSpacerHeight = Math.max(0, (totalRows - lastRow) * rowHeight)

  React.useEffect(() => {
    function updateViewport() {
      const element = gridRef.current
      const rect = element?.getBoundingClientRect()
      setViewport({
        scrollY: window.scrollY,
        height: window.innerHeight,
        width: element?.clientWidth || window.innerWidth,
        top: rect ? rect.top + window.scrollY : 0,
      })
    }

    updateViewport()
    window.addEventListener("scroll", updateViewport, { passive: true })
    window.addEventListener("resize", updateViewport)
    const observer = new ResizeObserver(updateViewport)
    if (gridRef.current) observer.observe(gridRef.current)

    return () => {
      window.removeEventListener("scroll", updateViewport)
      window.removeEventListener("resize", updateViewport)
      observer.disconnect()
    }
  }, [])

  React.useEffect(() => {
    const element = gridRef.current
    if (!element) return
    const firstCard = element.querySelector<HTMLElement>(".media-card")
    if (!firstCard) return
    const gridStyles = window.getComputedStyle(element)
    const rowGap = Number.parseFloat(gridStyles.rowGap || "0") || 0
    const nextHeight = firstCard.getBoundingClientRect().height + rowGap
    if (nextHeight > 0 && Math.abs(nextHeight - measuredRowHeight) > 2) {
      setMeasuredRowHeight(nextHeight)
    }
  }, [measuredRowHeight, visibleItems.length, view])

  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { rootMargin: "720px 0px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, onLoadMore])

  return (
    <>
      <section
        id="grid"
        ref={gridRef}
        className={cn("media-grid virtual-media-grid", view === "list" && "is-list")}
        aria-label="Downloaded media"
        data-view={view}
      >
        {itemsLoading && items.length === 0 ? (
          Array.from({ length: 12 }, (_, index) => <MediaSkeleton key={index} view={view} />)
        ) : (
          <>
            {topSpacerHeight > 0 && <div className="virtualSpacer" style={{ height: topSpacerHeight }} aria-hidden="true" />}
            {visibleItems.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                view={view}
                onDetails={() => onDetails(item)}
                onCopyPrompt={() => onCopyPrompt(item)}
                onCreate={() => onOpenCreate(item)}
                onDeleteRemote={() => onDeleteRemote(item)}
                onToggleFavorite={() => onToggleFavorite(item)}
              />
            ))}
            {bottomSpacerHeight > 0 && <div className="virtualSpacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" />}
          </>
        )}
      </section>
      <div ref={sentinelRef} className="loadMoreSentinel" aria-hidden="true" />
      {(loadingMore || hasMore) && (
        <div className="loadMoreStatus" aria-live="polite">
          {loadingMore ? "Loading more media..." : "Scroll to load more"}
        </div>
      )}
    </>
  )
}
