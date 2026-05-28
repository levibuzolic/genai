import { AlertTriangle, Clock3, RefreshCw } from "lucide-react"
import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AutoSyncStatus as AutoSyncStatusValue } from "@/types/domain"

type AutoSyncStatusProps = {
  autoSync: AutoSyncStatusValue | null | undefined
  className?: string
}

export function AutoSyncStatus({ autoSync, className }: AutoSyncStatusProps) {
  const enabled = Boolean(autoSync?.enabled)
  const hasError = Boolean(autoSync?.lastError)
  const badgeVariant = hasError ? "danger" : enabled ? "success" : "muted"
  const nextRun = enabled ? formatNullableTime(autoSync?.nextRunAt) : "Off"
  const lastRun = formatRun(autoSync?.lastRunAt, autoSync?.lastReason)
  const skipped = formatRun(autoSync?.lastSkippedAt, autoSync?.lastSkipReason)

  return (
    <section
      className={cn("w-72 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md", className)}
      aria-label="Auto sync status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <RefreshCw className={cn("size-4 text-muted-foreground", enabled && "text-emerald-300")} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium leading-none">Auto sync</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{formatCadence(autoSync)}</p>
          </div>
        </div>
        <Badge variant={badgeVariant}>{enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      <Separator className="my-3" />

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
        <StatusLabel>Next</StatusLabel>
        <StatusValue>
          <Clock3 className="size-3" />
          <span className="min-w-0 flex-1 truncate">{nextRun}</span>
        </StatusValue>

        <StatusLabel>Last</StatusLabel>
        <StatusValue>{lastRun}</StatusValue>

        <StatusLabel>Skipped</StatusLabel>
        <StatusValue>{skipped}</StatusValue>

        {autoSync?.lastError ? (
          <>
            <StatusLabel>Error</StatusLabel>
            <StatusValue tone="danger">
              <AlertTriangle className="size-3" />
              <span className="min-w-0 flex-1 truncate">{autoSync.lastError}</span>
            </StatusValue>
          </>
        ) : null}
      </dl>
    </section>
  )
}

function StatusLabel({ children }: { children: React.ReactNode }) {
  return <dt className="text-muted-foreground">{children}</dt>
}

function StatusValue({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "danger" }) {
  return (
    <dd className={cn("flex min-w-0 items-center gap-1.5 text-right text-foreground", tone === "danger" && "text-red-200")}>
      {typeof children === "string" || typeof children === "number" ? (
        <span className="min-w-0 flex-1 truncate">{children}</span>
      ) : (
        children
      )}
    </dd>
  )
}

function formatRun(value?: string | null, reason?: string | null) {
  if (!value) return "Never"
  const time = formatTime(value)
  return reason ? `${time} · ${formatReason(reason)}` : time
}

function formatNullableTime(value?: string | null) {
  return value ? formatTime(value) : "Not scheduled"
}

function formatCadence(autoSync: AutoSyncStatusValue | null | undefined) {
  if (!autoSync?.enabled) return "Background sync is off"
  return `Every ${formatInterval(autoSync.intervalMs)}`
}

function formatInterval(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "custom interval"

  const minutes = Math.round(value / 60_000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.round(minutes / 60)
  return `${hours}h`
}

function formatReason(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ")
}
