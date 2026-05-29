import { Grid2X2, List, ChevronLeft, ChevronRight } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMediaQuery } from "@/hooks/use-media-query"
import { formatNumber, formatRange } from "@/lib/format"
import type { ItemsResponse, ViewMode } from "@/types/domain"

export function PagerControls({
  page,
  setPage,
  pageCount,
  itemsData,
  view,
  setView,
}: {
  page: number
  setPage: React.Dispatch<React.SetStateAction<number>>
  pageCount: number
  itemsData: ItemsResponse | null
  view: ViewMode
  setView: (value: ViewMode) => void
}) {
  const showViewToggle = useMediaQuery("(min-width: 861px)")

  return (
    <section
      className="pager grid items-center gap-2 border-b bg-background px-3 py-2 md:grid-cols-[auto_minmax(0,1fr)_auto]"
      aria-label="Library pages"
    >
      <div className="grid grid-cols-[6.5rem_7.5rem_6.5rem] items-center gap-1 md:grid-cols-[7rem_8.5rem_7rem]">
        <Button
          id="prevPageButton"
          className="w-full"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          <ChevronLeft />
          Previous
        </Button>
        <span id="pageStatus" className="text-center tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Button
          id="nextPageButton"
          className="w-full"
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
      <span id="libraryStatus" className="min-w-0 justify-self-start md:justify-self-end">
        {itemsData ? `${formatRange(itemsData)} of ${formatNumber(itemsData.total)}` : "Loading..."}
      </span>
      {showViewToggle && (
        <Tabs className="viewToggle justify-self-end" value={view} onValueChange={(nextView) => setView(nextView as ViewMode)}>
          <TabsList aria-label="View mode">
            <TabsTrigger id="gridViewButton" value="grid">
              <Grid2X2 />
              Grid
            </TabsTrigger>
            <TabsTrigger id="listViewButton" value="list">
              <List />
              List
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
    </section>
  )
}
