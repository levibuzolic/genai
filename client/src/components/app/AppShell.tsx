import { Archive, EyeOff, MoreHorizontal, PauseCircle, ShieldCheck, Sparkles, WandSparkles, Zap } from "lucide-react"
import type * as React from "react"

import { AuthBrowserStatus } from "@/components/app/AuthBrowserStatus"
import { AutoSyncStatus } from "@/components/app/AutoSyncStatus"
import { RailButton } from "@/components/common/RailButton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Config, SyncStatus } from "@/types/domain"

export function AppShell({
  config,
  syncStatus,
  createOpen,
  onOpenCreate,
  onStartSync,
  onStartDownload,
  onGenerateThumbnails,
  onVerifyLibrary,
  onCancelSync,
  onAuthConnect,
  onAuthRefresh,
  onAuthDisconnect,
  authActionPending,
  mediaBlurred,
  onToggleMediaBlur,
  children,
}: {
  config: Config | null
  syncStatus: SyncStatus
  createOpen: boolean
  onOpenCreate: () => void
  onStartSync: (incremental: boolean) => void
  onStartDownload: (mode: "missing" | "retry-errors") => void
  onGenerateThumbnails: () => void
  onVerifyLibrary: () => void
  onCancelSync: () => void
  onAuthConnect: () => void
  onAuthRefresh: () => void
  onAuthDisconnect: () => void
  authActionPending: boolean
  mediaBlurred: boolean
  onToggleMediaBlur: () => void
  children: React.ReactNode
}) {
  const authBrowser = config?.authBrowser
  const autoSync = config?.autoSync

  return (
    <div className={cn("min-h-screen bg-background text-foreground", mediaBlurred && "media-blurred")}>
      <aside className="app-rail">
        <div className="rail-logo">
          <Sparkles className="size-5" />
        </div>
        <RailButton active icon={Archive} label="Library" />
        <RailButton icon={WandSparkles} label="Create" onClick={onOpenCreate} />
        <div className="mt-auto" />
        <RailButton icon={ShieldCheck} label="Auth" active={Boolean(config?.hasAuthorization)} />
      </aside>

      <div className="app-shell">
        <header className="topbar">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1>Media Library</h1>
              <Badge variant={config?.hasAuthorization ? "success" : "warning"}>
                {config?.hasAuthorization ? "API linked" : "Auth needed"}
              </Badge>
              {autoSync?.enabled && <Badge variant={autoSync.lastError ? "danger" : "muted"}>Auto sync</Badge>}
            </div>
            <p id="configLine" className="truncate">
              {config
                ? `${config.mediaDir} · ${config.authorizationSource || authBrowser?.status || "no browser token"}${config.authorizationExpiresAt ? ` until ${formatTime(config.authorizationExpiresAt)}` : ""}`
                : "Loading local library..."}
            </p>
          </div>

          <div className="top-actions actions">
            <Button id="createViewButton" variant={createOpen ? "default" : "glass"} onClick={onOpenCreate}>
              <WandSparkles />
              Create
            </Button>
            <Button id="syncNewButton" onClick={() => onStartSync(true)} disabled={syncStatus.running}>
              <Zap />
              Sync & download
            </Button>
            <Button
              id="mediaBlurButton"
              variant={mediaBlurred ? "secondary" : "glass"}
              onClick={onToggleMediaBlur}
              title={mediaBlurred ? "Show media" : "Blur media"}
            >
              <EyeOff />
              Blur
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="glass" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Library jobs</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onStartSync(false)}>Full rescan</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onStartDownload("missing")}>Download missing</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onStartDownload("retry-errors")}>Retry errors</DropdownMenuItem>
                <DropdownMenuItem onClick={onGenerateThumbnails}>Thumbnails</DropdownMenuItem>
                <DropdownMenuItem onClick={onVerifyLibrary}>Verify</DropdownMenuItem>
                <AuthBrowserStatus
                  config={config}
                  pending={authActionPending}
                  onConnect={onAuthConnect}
                  onRefresh={onAuthRefresh}
                  onDisconnect={onAuthDisconnect}
                />
                <DropdownMenuSeparator />
                <DropdownMenuLabel asChild>
                  <AutoSyncStatus autoSync={autoSync} />
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/api/catalog/export" download>
                    Export database
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {syncStatus.running && (
              <Button id="cancelSyncButton" variant="secondary" onClick={onCancelSync}>
                <PauseCircle />
                Cancel
              </Button>
            )}
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  )
}
