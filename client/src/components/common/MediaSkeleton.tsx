import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { ViewMode } from "@/types/domain"

export function MediaSkeleton({ view }: { view: ViewMode }) {
  return (
    <article className={cn("card media-card", view === "list" && "is-list")} aria-hidden="true">
      <div className="preview">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
      <div className="cardBody">
        <div className="cardMeta">
          <Skeleton className="h-4 w-3/4 max-md:h-8" />
        </div>
        <div className="prompt grid gap-1">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
        <div className="cardFooter">
          <div className="cardActions">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className={cn("size-8", index === 2 && "max-md:col-span-2 max-md:w-full")} />
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}
