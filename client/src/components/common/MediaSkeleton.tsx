import { Skeleton } from "@/components/ui/skeleton"

export function MediaSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <Skeleton className="aspect-square rounded-none" />
      <div className="space-y-3 p-3">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  )
}
