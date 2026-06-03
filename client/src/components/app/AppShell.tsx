import {
  Archive,
  Images,
  Loader2,
  Maximize2,
  Minimize2,
  PauseCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  Zap,
} from "lucide-react"
import * as React from "react"

import { SettingsDialog } from "@/components/app/SettingsDialog"
import type { SettingsSection } from "@/components/app/SettingsDialog"
import { RailButton } from "@/components/common/RailButton"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import type { Backup, Config, MediaFitMode, SyncStatus } from "@/types/domain"

export function AppShell({
  config,
  syncStatus,
  createOpen,
  activeView,
  onOpenLibrary,
  onOpenPlaybox,
  onOpenCreate,
  onOpenTemplates,
  onStartSync,
  onStartPlayboxSync,
  onStartDownload,
  onGenerateThumbnails,
  onVerifyLibrary,
  onCancelSync,
  onAuthConnect,
  onAuthRefresh,
  onAuthDisconnect,
  onImportPlayboxCurl,
  onRefreshPlayboxImport,
  onClearPlayboxImport,
  onAuthAccountConnect,
  onAuthAccountRefresh,
  onAuthAccountRemove,
  authActionPending,
  settingsActionPending,
  onSaveMediaGenerationConcurrencyLimit,
  mediaBlurred,
  onToggleMediaBlur,
  mediaFitMode,
  onToggleMediaFitMode,
  settingsOpen,
  settingsSection,
  onOpenSettings,
  onCloseSettings,
  onSettingsSectionChange,
  backups,
  selectedBackup,
  setSelectedBackup,
  onCreateBackup,
  onRestoreBackup,
  children,
}: {
  config: Config | null
  syncStatus: SyncStatus
  createOpen: boolean
  activeView: "library" | "playbox" | "templates"
  onOpenLibrary: () => void
  onOpenPlaybox: () => void
  onOpenCreate: () => void
  onOpenTemplates: () => void
  onStartSync: (incremental: boolean) => void
  onStartPlayboxSync: () => void
  onStartDownload: (mode: "missing" | "retry-errors") => void
  onGenerateThumbnails: () => void
  onVerifyLibrary: () => void
  onCancelSync: () => void
  onAuthConnect: () => void
  onAuthRefresh: () => void
  onAuthDisconnect: () => void
  onImportPlayboxCurl: (curl: string) => void
  onRefreshPlayboxImport: () => void
  onClearPlayboxImport: () => void
  onAuthAccountConnect: (email: string) => void
  onAuthAccountRefresh: (email: string) => void
  onAuthAccountRemove: (email: string) => void
  authActionPending: boolean
  settingsActionPending: boolean
  onSaveMediaGenerationConcurrencyLimit: (limit: number) => void
  mediaBlurred: boolean
  onToggleMediaBlur: () => void
  mediaFitMode: MediaFitMode
  onToggleMediaFitMode: () => void
  settingsOpen: boolean
  settingsSection: SettingsSection
  onOpenSettings: () => void
  onCloseSettings: () => void
  onSettingsSectionChange: (section: SettingsSection) => void
  backups: Backup[]
  selectedBackup: string
  setSelectedBackup: (value: string) => void
  onCreateBackup: () => void
  onRestoreBackup: () => void
  children: React.ReactNode
}) {
  const autoSync = config?.autoSync
  const syncLabel = activeView === "playbox" ? "Sync Playbox" : "Sync"
  const isDesktop = useMediaQuery("(min-width: 1024px)")

  return (
    <div
      className={cn(
        "min-h-screen bg-background text-foreground",
        mediaBlurred && "media-blurred",
        mediaFitMode === "fill" ? "media-fit-fill" : "media-fit-contain",
      )}
    >
      {isDesktop && (
        <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r bg-background p-3">
          <nav className="grid gap-1" aria-label="Primary">
            <RailButton id="libraryViewButton" active={activeView === "library"} icon={Archive} label="Library" onClick={onOpenLibrary} />
            <RailButton id="playboxViewButton" active={activeView === "playbox"} icon={Images} label="Playbox" onClick={onOpenPlaybox} />
            <RailButton id="createViewButton" active={createOpen} icon={WandSparkles} label="Create" onClick={onOpenCreate} />
            <RailButton
              id="templateViewButton"
              active={activeView === "templates"}
              icon={Sparkles}
              label="Templates"
              onClick={onOpenTemplates}
            />
          </nav>

          <div className="-mx-3 mt-auto grid gap-0 border-t pt-2" aria-label="System status">
            <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 overflow-hidden px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0" />
              <div className="min-w-0 overflow-hidden">
                <strong className="block truncate font-medium text-foreground">
                  {config?.hasAuthorization ? "API linked" : "Auth needed"}
                </strong>
                <span className="block truncate">{autoSync?.enabled ? "Auto sync on" : "Manual sync"}</span>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 overflow-hidden px-3 py-2 text-xs text-muted-foreground">
              {syncStatus.running ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Zap className="size-4 shrink-0" />}
              <div className="min-w-0 overflow-hidden">
                <strong className="block truncate font-medium text-foreground">{syncStatus.running ? "Sync running" : "Sync idle"}</strong>
                <span className="block truncate">{syncStatus.message || "Ready"}</span>
              </div>
            </div>
          </div>
        </aside>
      )}

      <div className={cn("min-h-screen", isDesktop && "pl-56")}>
        <header
          className={cn(
            "sticky top-0 z-30 flex min-h-14 justify-between gap-3 border-b bg-background px-3 py-2",
            isDesktop ? "items-center px-5" : "static flex-col items-end",
          )}
        >
          <div className={cn("top-actions actions shrink-0 gap-2", isDesktop ? "flex items-center" : "grid grid-cols-[1fr_1fr_auto]")}>
            <Button
              id="syncNewButton"
              className={cn(!isDesktop && "w-full")}
              variant={syncStatus.running ? "secondary" : "default"}
              aria-pressed={syncStatus.running}
              title={
                syncStatus.running
                  ? syncStatus.message || "Sync running"
                  : activeView === "playbox"
                    ? "Sync and download Playbox media"
                    : "Sync and download new media"
              }
              onClick={() => {
                if (syncStatus.running) return
                if (activeView === "playbox") {
                  onStartPlayboxSync()
                } else {
                  onStartSync(true)
                }
              }}
            >
              {syncStatus.running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {syncStatus.running ? "Syncing" : syncLabel}
            </Button>
            {syncStatus.running && (
              <Button id="cancelSyncButton" className={cn(!isDesktop && "w-full")} variant="outline" onClick={onCancelSync}>
                <PauseCircle />
                Cancel
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id="viewOptionsButton" className={cn(!isDesktop && "w-full")} variant="outline" aria-label="View options">
                  <SlidersHorizontal />
                  View
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Media display</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={mediaFitMode}
                  onValueChange={(nextValue) => {
                    if (nextValue !== mediaFitMode) onToggleMediaFitMode()
                  }}
                >
                  <DropdownMenuRadioItem id="mediaFitFillItem" value="fill">
                    <Maximize2 />
                    Crop to fill
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem id="mediaFitContainItem" value="contain">
                    <Minimize2 />
                    Scale to fit
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem id="mediaBlurButton" checked={mediaBlurred} onCheckedChange={onToggleMediaBlur}>
                    Blur media (Option+B)
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button id="settingsButton" variant="outline" size="icon" onClick={onOpenSettings} aria-label="Settings">
              <Settings />
              <span className="sr-only">Settings</span>
            </Button>
          </div>
        </header>
        <main className={cn(isDesktop ? "p-0" : "px-3 pt-3 pb-20")}>{children}</main>
      </div>

      {!isDesktop && (
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background p-2" aria-label="Primary">
          <RailButton
            className="h-10 justify-center [&_svg]:size-4"
            active={activeView === "library"}
            icon={Archive}
            label="Library"
            onClick={onOpenLibrary}
          />
          <RailButton
            className="h-10 justify-center [&_svg]:size-4"
            active={activeView === "playbox"}
            icon={Images}
            label="Playbox"
            onClick={onOpenPlaybox}
          />
          <RailButton
            className="h-10 justify-center [&_svg]:size-4"
            active={createOpen}
            icon={WandSparkles}
            label="Create"
            onClick={onOpenCreate}
          />
          <RailButton
            className="h-10 justify-center [&_svg]:size-4"
            active={activeView === "templates"}
            icon={Sparkles}
            label="Templates"
            onClick={onOpenTemplates}
          />
        </nav>
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) onCloseSettings()
        }}
        section={settingsSection}
        onSectionChange={onSettingsSectionChange}
        config={config}
        syncStatus={syncStatus}
        authActionPending={authActionPending}
        backups={backups}
        selectedBackup={selectedBackup}
        setSelectedBackup={setSelectedBackup}
        onStartSync={onStartSync}
        onStartPlayboxSync={onStartPlayboxSync}
        onStartDownload={onStartDownload}
        onGenerateThumbnails={onGenerateThumbnails}
        onVerifyLibrary={onVerifyLibrary}
        onAuthConnect={onAuthConnect}
        onAuthRefresh={onAuthRefresh}
        onAuthDisconnect={onAuthDisconnect}
        onImportPlayboxCurl={onImportPlayboxCurl}
        onRefreshPlayboxImport={onRefreshPlayboxImport}
        onClearPlayboxImport={onClearPlayboxImport}
        onAuthAccountConnect={onAuthAccountConnect}
        onAuthAccountRefresh={onAuthAccountRefresh}
        onAuthAccountRemove={onAuthAccountRemove}
        settingsActionPending={settingsActionPending}
        onSaveMediaGenerationConcurrencyLimit={onSaveMediaGenerationConcurrencyLimit}
        onCreateBackup={onCreateBackup}
        onRestoreBackup={onRestoreBackup}
      />
    </div>
  )
}
