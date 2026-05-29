import { Archive, Database, Download, KeyRound, RefreshCw, RotateCcw, Settings, ShieldCheck } from "lucide-react"
import * as React from "react"

import { AutoSyncStatus } from "@/components/app/AutoSyncStatus"
import { SelectControl } from "@/components/common/NativeSelect"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { formatDate, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Backup, Config, SyncStatus } from "@/types/domain"

type SettingsSection = "library" | "account" | "backups"

export function SettingsDialog({
  open,
  onOpenChange,
  config,
  syncStatus,
  authActionPending,
  backups,
  selectedBackup,
  setSelectedBackup,
  onStartSync,
  onStartDownload,
  onGenerateThumbnails,
  onVerifyLibrary,
  onAuthConnect,
  onAuthRefresh,
  onAuthDisconnect,
  onCreateBackup,
  onRestoreBackup,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: Config | null
  syncStatus: SyncStatus
  authActionPending: boolean
  backups: Backup[]
  selectedBackup: string
  setSelectedBackup: (value: string) => void
  onStartSync: (incremental: boolean) => void
  onStartDownload: (mode: "missing" | "retry-errors") => void
  onGenerateThumbnails: () => void
  onVerifyLibrary: () => void
  onAuthConnect: () => void
  onAuthRefresh: () => void
  onAuthDisconnect: () => void
  onCreateBackup: () => void
  onRestoreBackup: () => void
}) {
  const [section, setSection] = React.useState<SettingsSection>("library")
  const authBrowser = config?.authBrowser
  const hasAuthorization = Boolean(config?.hasAuthorization)
  const authStatus = authBrowser?.status || (hasAuthorization ? "connected" : "missing")
  const authMessage = authBrowser?.message || (hasAuthorization ? "API token is active." : "Connect the auth browser to sync.")
  const connectLabel = hasAuthorization || authBrowser?.hasProfile || authBrowser?.lastError ? "Reconnect account" : "Connect account"
  const authorizationExpiry = config?.authorizationExpiresAt || authBrowser?.expiresAt

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="settingsDialog" className="settingsDialog">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Library operations, account authentication, and catalog backups.</DialogDescription>
        <aside className="settingsSidebar" aria-label="Settings sections">
          <div className="settingsTitle">
            <Settings className="size-4" />
            <span>Settings</span>
          </div>
          <SettingsNavButton icon={Database} label="Library" active={section === "library"} onClick={() => setSection("library")} />
          <SettingsNavButton icon={KeyRound} label="Account" active={section === "account"} onClick={() => setSection("account")} />
          <SettingsNavButton icon={Archive} label="Backups" active={section === "backups"} onClick={() => setSection("backups")} />
        </aside>

        <div className="settingsContent">
          {section === "library" && (
            <SettingsPane title="Library" description="Maintenance actions and background sync state.">
              <div className="settingsStatusGrid">
                <SettingsStat label="Sync" value={syncStatus.running ? "Running" : "Idle"} />
                <SettingsStat label="Scanned" value={syncStatus.scanned.toLocaleString()} />
                <SettingsStat label="Downloaded" value={syncStatus.downloaded.toLocaleString()} />
                <SettingsStat label="Errors" value={(syncStatus.errors?.length || 0).toLocaleString()} />
              </div>
              <ButtonGroup className="settingsActionGrid">
                <Button variant="outline" onClick={() => onStartSync(false)} disabled={syncStatus.running}>
                  <RefreshCw />
                  Full rescan
                </Button>
                <Button variant="outline" onClick={() => onStartDownload("missing")} disabled={syncStatus.running}>
                  <Download />
                  Download missing
                </Button>
                <Button variant="outline" onClick={() => onStartDownload("retry-errors")} disabled={syncStatus.running}>
                  <RefreshCw />
                  Retry errors
                </Button>
                <Button variant="outline" onClick={onGenerateThumbnails} disabled={syncStatus.running}>
                  <Archive />
                  Thumbnails
                </Button>
                <Button variant="outline" onClick={onVerifyLibrary} disabled={syncStatus.running}>
                  <ShieldCheck />
                  Verify
                </Button>
                <Button variant="outline" asChild>
                  <a href="/api/catalog/export" download>
                    <Database />
                    Export database
                  </a>
                </Button>
              </ButtonGroup>
              <AutoSyncStatus autoSync={config?.autoSync} className="w-full bg-background shadow-none" />
            </SettingsPane>
          )}

          {section === "account" && (
            <SettingsPane title="Account" description="Connection state for the browser-backed API session.">
              <div className="settingsAccountStatus">
                <div className="min-w-0">
                  <div className="settingsStatusHeading">
                    <span>Auth browser</span>
                    <Badge variant={getAuthBadgeVariant(authStatus, hasAuthorization, authBrowser?.lastError)}>
                      {authActionPending ? "working" : authStatus.replaceAll("-", " ")}
                    </Badge>
                  </div>
                  <p>{authMessage}</p>
                  <p>
                    {authorizationExpiry ? `Token until ${formatTime(authorizationExpiry)}` : "No active token"}
                    {authBrowser?.lastRefreshAt ? ` · refreshed ${formatTime(authBrowser.lastRefreshAt)}` : ""}
                  </p>
                  {authBrowser?.lastError && <p className="text-red-300">{authBrowser.lastError}</p>}
                </div>
              </div>
              <ButtonGroup className="settingsActionGrid">
                <Button variant="outline" disabled={authActionPending} onClick={onAuthConnect}>
                  <KeyRound />
                  {connectLabel}
                </Button>
                <Button variant="outline" disabled={authActionPending || !authBrowser?.hasProfile} onClick={onAuthRefresh}>
                  <RefreshCw />
                  Refresh token
                </Button>
                <Button variant="outline" disabled={authActionPending || !authBrowser?.browserOpen} onClick={onAuthDisconnect}>
                  Close browser
                </Button>
              </ButtonGroup>
              {config?.mediaDir && (
                <div className="settingsPath">
                  <Label>Media directory</Label>
                  <p>{config.mediaDir}</p>
                </div>
              )}
            </SettingsPane>
          )}

          {section === "backups" && (
            <SettingsPane title="Backups" description="Create and restore catalog database snapshots.">
              <div className="settingsField">
                <Label htmlFor="backupSelect">Catalog backup</Label>
                <SelectControl id="backupSelect" value={selectedBackup} onChange={setSelectedBackup}>
                  {backups.length === 0 ? (
                    <option value="">No backups</option>
                  ) : (
                    backups.map((backup) => (
                      <option key={backup.file} value={backup.file}>
                        {formatDate(backup.createdAt)} · {backup.reason || "backup"} · {backup.itemCount || 0}
                      </option>
                    ))
                  )}
                </SelectControl>
              </div>
              <ButtonGroup className="settingsActionGrid">
                <Button variant="outline" onClick={onCreateBackup}>
                  <Archive />
                  Create backup
                </Button>
                <Button variant="outline" disabled={!selectedBackup} onClick={onRestoreBackup}>
                  <RotateCcw />
                  Restore selected
                </Button>
              </ButtonGroup>
            </SettingsPane>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingsNavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button className={cn("settingsNavButton", active && "is-active")} variant="ghost" onClick={onClick}>
      <Icon className="size-4" />
      {label}
    </Button>
  )
}

function SettingsPane({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="settingsPane">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

function SettingsStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getAuthBadgeVariant(status: string, hasAuthorization: boolean, lastError?: string | null) {
  if (lastError) return "destructive"
  if (hasAuthorization || status === "connected") return "default"
  if (status === "awaiting-login" || status === "refreshing" || status === "starting") return "outline"
  return "secondary"
}
