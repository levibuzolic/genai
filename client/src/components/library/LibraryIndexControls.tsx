import { Grid2X2, List } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMediaQuery } from "@/hooks/use-media-query"
import { formatNumber } from "@/lib/format"
import type { ItemsResponse, ViewMode } from "@/types/domain"

export function LibraryIndexControls({
  itemsData,
  loading,
  loadingMore,
  view,
  setView,
}: {
  itemsData: ItemsResponse | null
  loading: boolean
  loadingMore: boolean
  view: ViewMode
  setView: (value: ViewMode) => void
}) {
  const showViewToggle = useMediaQuery("(min-width: 861px)")
  const status = itemsData
    ? `${formatNumber(itemsData.items.length)} of ${formatNumber(itemsData.total)} loaded`
    : loading
      ? "Loading..."
      : "No media"

  return (
    <section className="indexStatusBar" aria-label="Library loading status">
      <span id="libraryStatus" className="min-w-0">
        {loadingMore ? `${status} · loading more` : status}
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
