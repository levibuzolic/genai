import { Archive, EyeOff, Loader2, MoreHorizontal, PauseCircle, ShieldCheck, Sparkles, WandSparkles, Zap } from "lucide-react"
import type * as React from "react"

import { AuthBrowserStatus } from "@/components/app/AuthBrowserStatus"
import { AutoSyncStatus } from "@/components/app/AutoSyncStatus"
import { RailButton } from "@/components/common/RailButton"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Config, SyncStatus } from "@/types/domain"

export function AppShell({
  config,
  syncStatus,
  createOpen,
  activeView,
  onOpenLibrary,
  onOpenCreate,
  onOpenTemplates,
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
  activeView: "library" | "templates"
  onOpenLibrary: () => void
  onOpenCreate: () => void
  onOpenTemplates: () => void
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
  const autoSync = config?.autoSync
  const currentTitle = createOpen ? "Create" : activeView === "templates" ? "Templates" : "Media"

  return (
    <div className={cn("min-h-screen bg-background text-foreground", mediaBlurred && "media-blurred")}>
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <strong>GenAI</strong>
            <span>Local media</span>
          </div>
        </div>

        <nav className="app-nav" aria-label="Primary">
          <RailButton id="libraryViewButton" active={activeView === "library"} icon={Archive} label="Library" onClick={onOpenLibrary} />
          <RailButton id="createViewButton" active={createOpen} icon={WandSparkles} label="Create" onClick={onOpenCreate} />
          <RailButton
            id="templateViewButton"
            active={activeView === "templates"}
            icon={Sparkles}
            label="Templates"
            onClick={onOpenTemplates}
          />
        </nav>

        <div className="sidebar-footer" aria-label="System status">
          <div className="nav-status">
            <ShieldCheck className="size-4" />
            <div className="min-w-0">
              <strong>{config?.hasAuthorization ? "API linked" : "Auth needed"}</strong>
              <span>{autoSync?.enabled ? "Auto sync on" : "Manual sync"}</span>
            </div>
          </div>
          <div className="nav-status">
            {syncStatus.running ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            <div className="min-w-0">
              <strong>{syncStatus.running ? "Sync running" : "Sync idle"}</strong>
              <span>{syncStatus.message || "Ready"}</span>
            </div>
          </div>
          <div className="sidebar-metrics">
            <span>{syncStatus.scanned.toLocaleString()} scanned</span>
            <span>{syncStatus.downloaded.toLocaleString()} downloaded</span>
            <span>{(syncStatus.errors?.length || 0).toLocaleString()} errors</span>
          </div>
          {config?.mediaDir && <div className="sidebar-path">{config.mediaDir}</div>}
        </div>
      </aside>

      <div className="app-shell">
        <header className="topbar">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1>{currentTitle}</h1>
            </div>
          </div>

          <div className="top-actions actions">
            <Button id="syncNewButton" onClick={() => onStartSync(true)} disabled={syncStatus.running}>
              <Zap />
              Sync & download
            </Button>
            <Button
              id="mediaBlurButton"
              variant={mediaBlurred ? "secondary" : "outline"}
              onClick={onToggleMediaBlur}
              title={mediaBlurred ? "Show media" : "Blur media"}
            >
              <EyeOff />
              Blur
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
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

      <nav className="mobile-tabbar" aria-label="Primary">
        <RailButton active={activeView === "library"} icon={Archive} label="Library" onClick={onOpenLibrary} />
        <RailButton active={createOpen} icon={WandSparkles} label="Create" onClick={onOpenCreate} />
        <RailButton active={activeView === "templates"} icon={Sparkles} label="Templates" onClick={onOpenTemplates} />
      </nav>
    </div>
  )
}
