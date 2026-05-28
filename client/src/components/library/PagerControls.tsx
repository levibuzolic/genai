import { ChevronLeft, ChevronRight } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import type { ViewMode } from "@/types/domain"

export function PagerControls({
  page,
  setPage,
  pageCount,
  view,
  setView,
}: {
  page: number
  setPage: React.Dispatch<React.SetStateAction<number>>
  pageCount: number
  view: ViewMode
  setView: (value: ViewMode) => void
}) {
  return (
    <section className="pager" aria-label="Library pages">
      <Button
        id="prevPageButton"
        variant="glass"
        size="sm"
        disabled={page <= 1}
        onClick={() => setPage((current) => Math.max(1, current - 1))}
      >
        <ChevronLeft />
        Previous
      </Button>
      <span id="pageStatus">
        Page {page} of {pageCount}
      </span>
      <Button id="nextPageButton" variant="glass" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
        Next
        <ChevronRight />
      </Button>
      <div className="viewToggle" aria-label="View mode">
        <Button id="gridViewButton" variant={view === "grid" ? "default" : "ghost"} size="sm" onClick={() => setView("grid")}>
          Grid
        </Button>
        <Button id="listViewButton" variant={view === "list" ? "default" : "ghost"} size="sm" onClick={() => setView("list")}>
          List
        </Button>
      </div>
    </section>
  )
}
