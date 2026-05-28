import { Loader2 } from "lucide-react"

import { formatNumber, formatRange } from "@/lib/format"
import type { ItemsResponse, SyncStatus } from "@/types/domain"

export function LibraryStatusLine({ syncStatus, itemsData }: { syncStatus: SyncStatus; itemsData: ItemsResponse | null }) {
  return (
    <section className="status-line status" aria-live="polite">
      <div id="syncStatus" className="min-w-0 truncate">
        {syncStatus.running ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            {syncStatus.message}
          </span>
        ) : (
          syncStatus.message
        )}
      </div>
      <div id="libraryStatus">
        {itemsData ? `${formatRange(itemsData)} of ${formatNumber(itemsData.total)} items` : "Loading library..."}
      </div>
    </section>
  )
}
