import { Archive, Database, Download, KeyRound, RefreshCw, RotateCcw, Settings, ShieldCheck, Trash2 } from "lucide-react"
import * as React from "react"

import { AutoSyncStatus } from "@/components/app/AutoSyncStatus"
import { SelectControl } from "@/components/common/NativeSelect"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Backup, Config, SyncStatus } from "@/types/domain"

export type SettingsSection = "library" | "account" | "playbox-auth" | "backups"

export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  config,
  syncStatus,
  authActionPending,
  backups,
  selectedBackup,
  setSelectedBackup,
  onStartSync,
  onStartPlayboxSync,
  onStartDownload,
  onGenerateThumbnails,
  onVerifyLibrary,
  onAuthConnect,
  onAuthRefresh,
  onAuthDisconnect,
  onImportPlayboxCurl,
  onRefreshPlayboxImport,
  onClearPlayboxImport,
  onAuthAccountConnect,
  onAuthAccountRefresh,
  onAuthAccountRemove,
  settingsActionPending,
  onSaveMediaGenerationConcurrencyLimit,
  onCreateBackup,
  onRestoreBackup,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  config: Config | null
  syncStatus: SyncStatus
  authActionPending: boolean
  backups: Backup[]
  selectedBackup: string
  setSelectedBackup: (value: string) => void
  onStartSync: (incremental: boolean) => void
  onStartPlayboxSync: () => void
  onStartDownload: (mode: "missing" | "retry-errors") => void
  onGenerateThumbnails: () => void
  onVerifyLibrary: () => void
  onAuthConnect: () => void
  onAuthRefresh: () => void
  onAuthDisconnect: () => void
  onImportPlayboxCurl: (curl: string) => void
  onRefreshPlayboxImport: () => void
  onClearPlayboxImport: () => void
  onAuthAccountConnect: (email: string) => void
  onAuthAccountRefresh: (email: string) => void
  onAuthAccountRemove: (email: string) => void
  settingsActionPending: boolean
  onSaveMediaGenerationConcurrencyLimit: (limit: number) => void
  onCreateBackup: () => void
  onRestoreBackup: () => void
}) {
  const authBrowser = config?.authBrowser
  const hasAuthorization = Boolean(config?.hasAuthorization)
  const authStatus = authBrowser?.status || (hasAuthorization ? "connected" : "missing")
  const authMessage = authBrowser?.message || (hasAuthorization ? "API token is active." : "Connect the auth browser to sync.")
  const connectLabel = hasAuthorization || authBrowser?.hasProfile || authBrowser?.lastError ? "Reconnect account" : "Connect account"
  const authorizationExpiry = config?.authorizationExpiresAt || authBrowser?.expiresAt
  const accounts = config?.authAccounts || []
  const playbox = config?.playbox
  const playboxImportedSession = playbox?.importedSession
  const hasPlayboxAuthorization = Boolean(playbox?.hasAuthorization)
  const playboxAuthorizationExpiry = playbox?.authorizationExpiresAt
  const [accountEmailDraft, setAccountEmailDraft] = React.useState("")
  const [playboxCurlDraft, setPlayboxCurlDraft] = React.useState("")
  const [generationLimitDraft, setGenerationLimitDraft] = React.useState(() => String(config?.mediaGenerationConcurrencyLimit || 2))
  const trimmedAccountEmail = accountEmailDraft.trim()
  const trimmedPlayboxCurl = playboxCurlDraft.trim()
  const generationLimit = Math.max(1, Math.floor(Number(generationLimitDraft) || 2))

  React.useEffect(() => {
    setGenerationLimitDraft(String(config?.mediaGenerationConcurrencyLimit || 2))
  }, [config?.mediaGenerationConcurrencyLimit])

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
          <SettingsNavButton icon={Database} label="Library" active={section === "library"} onClick={() => onSectionChange("library")} />
          <SettingsNavButton icon={KeyRound} label="Account" active={section === "account"} onClick={() => onSectionChange("account")} />
          <SettingsNavButton
            icon={ShieldCheck}
            label="Playbox Auth"
            active={section === "playbox-auth"}
            onClick={() => onSectionChange("playbox-auth")}
          />
          <SettingsNavButton icon={Archive} label="Backups" active={section === "backups"} onClick={() => onSectionChange("backups")} />
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
                <Button variant="outline" onClick={onStartPlayboxSync} disabled={syncStatus.running}>
                  <Download />
                  Sync Playbox
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

          {section === "playbox-auth" && (
            <SettingsPane title="Playbox Auth" description="Import a browser-authenticated API request for server-side refresh.">
              <div className="settingsAccountStatus">
                <div className="min-w-0">
                  <div className="settingsStatusHeading">
                    <span>Imported session</span>
                    <Badge
                      variant={
                        playboxImportedSession?.lastError ? "destructive" : playboxImportedSession?.hasSession ? "default" : "outline"
                      }
                    >
                      {playboxImportedSession?.hasSession ? "available" : "missing"}
                    </Badge>
                  </div>
                  <p>{hasPlayboxAuthorization ? "Playbox token is active." : "No active Playbox token."}</p>
                  <p>{playboxAuthorizationExpiry ? `Token until ${formatTime(playboxAuthorizationExpiry)}` : "No active token"}</p>
                  <p>
                    {playboxImportedSession?.hasSession
                      ? `${playboxImportedSession.cookieCount.toLocaleString()} cookies captured`
                      : "No imported Playbox session."}
                  </p>
                  <p>
                    {playboxImportedSession?.lastRefreshAt
                      ? `Refreshed ${formatTime(playboxImportedSession.lastRefreshAt)}`
                      : playboxImportedSession?.lastValidatedAt
                        ? `Validated ${formatTime(playboxImportedSession.lastValidatedAt)}`
                        : "Not validated yet"}
                  </p>
                  {playboxImportedSession?.email && <p>{playboxImportedSession.email}</p>}
                  {playboxImportedSession?.lastError && <p className="text-red-300">{playboxImportedSession.lastError}</p>}
                </div>
              </div>
              <div className="settingsPath">
                <Label>Capture steps</Label>
                <ol className="grid gap-1 text-sm text-muted-foreground">
                  <li>1. Open Playbox in your normal Chrome profile and sign in.</li>
                  <li>2. Open DevTools, then the Network tab.</li>
                  <li>3. Select a successful request to api.playbox.com, preferably users/me-new or refresh-token.</li>
                  <li>4. Choose Copy as cURL and paste it below.</li>
                </ol>
              </div>
              <div className="settingsField">
                <Label htmlFor="playboxCurlInput">Playbox cURL request</Label>
                <Textarea
                  id="playboxCurlInput"
                  className="min-h-40 resize-y font-mono text-xs"
                  value={playboxCurlDraft}
                  placeholder="curl 'https://api.playbox.com/api/users/me-new' -H 'Cookie: ...'"
                  onChange={(event) => setPlayboxCurlDraft(event.currentTarget.value)}
                />
              </div>
              <ButtonGroup className="settingsActionGrid">
                <Button
                  variant="outline"
                  disabled={settingsActionPending || !trimmedPlayboxCurl}
                  onClick={() => onImportPlayboxCurl(trimmedPlayboxCurl)}
                >
                  <KeyRound />
                  Import cURL
                </Button>
                <Button
                  variant="outline"
                  disabled={settingsActionPending || !playboxImportedSession?.hasSession}
                  onClick={onRefreshPlayboxImport}
                >
                  <RefreshCw />
                  Test refresh
                </Button>
                <Button
                  variant="outline"
                  disabled={settingsActionPending || !playboxImportedSession?.hasSession}
                  onClick={onClearPlayboxImport}
                >
                  <Trash2 />
                  Clear session
                </Button>
              </ButtonGroup>
              <div className="settingsPath">
                <Label>Stored session file</Label>
                <code className="break-all text-xs text-muted-foreground">{playboxImportedSession?.path || "Unavailable"}</code>
              </div>
            </SettingsPane>
          )}

          {section === "account" && (
            <SettingsPane title="Account" description="Connection state for the browser-backed API session.">
              {accounts.length === 0 && (
                <>
                  <div className="settingsAccountStatus">
                    <div className="min-w-0">
                      <div className="settingsStatusHeading">
                        <span>Account</span>
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
                </>
              )}
              {accounts.length > 0 && (
                <div className="grid gap-2">
                  {accounts.map((account) => (
                    <div key={account.email} className="settingsAccountStatus">
                      <div className="min-w-0">
                        <div className="settingsStatusHeading">
                          <span className="truncate">{account.email}</span>
                          <Badge
                            variant={getAuthBadgeVariant(
                              account.authBrowser.status,
                              account.hasAuthorization,
                              account.authBrowser.lastError,
                            )}
                          >
                            {account.authBrowser.status.replaceAll("-", " ")}
                          </Badge>
                        </div>
                        <p>
                          {account.authorizationExpiresAt ? `Token until ${formatTime(account.authorizationExpiresAt)}` : "No active token"}
                          {account.authBrowser.lastRefreshAt ? ` · refreshed ${formatTime(account.authBrowser.lastRefreshAt)}` : ""}
                        </p>
                        {account.authBrowser.lastError && <p className="text-red-300">{account.authBrowser.lastError}</p>}
                      </div>
                      <ButtonGroup>
                        <Button
                          variant="outline"
                          disabled={authActionPending}
                          onClick={() => (account.isDefault ? onAuthConnect() : onAuthAccountConnect(account.email))}
                        >
                          <KeyRound />
                          Reconnect
                        </Button>
                        <Button
                          variant="outline"
                          disabled={authActionPending || !account.authBrowser.hasProfile}
                          onClick={() => (account.isDefault ? onAuthRefresh() : onAuthAccountRefresh(account.email))}
                        >
                          <RefreshCw />
                          Refresh
                        </Button>
                        {!account.isDefault && (
                          <Button variant="outline" disabled={authActionPending} onClick={() => onAuthAccountRemove(account.email)}>
                            <Trash2 />
                            Remove
                          </Button>
                        )}
                      </ButtonGroup>
                    </div>
                  ))}
                </div>
              )}
              <div className="settingsPath">
                <Label htmlFor="accountEmailInput">Add account</Label>
                <div className="flex gap-2">
                  <input
                    id="accountEmailInput"
                    className="min-h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                    value={accountEmailDraft}
                    type="email"
                    aria-label="Add account email"
                    placeholder="email@example.com"
                    onChange={(event) => setAccountEmailDraft(event.currentTarget.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={authActionPending || !trimmedAccountEmail}
                    onClick={() => onAuthAccountConnect(trimmedAccountEmail)}
                  >
                    <KeyRound />
                    Add
                  </Button>
                </div>
              </div>
              <div className="settingsField">
                <Label htmlFor="generationLimitInput">Concurrent generations per account</Label>
                <div className="flex gap-2">
                  <input
                    id="generationLimitInput"
                    className="min-h-9 w-24 rounded-md border bg-background px-3 text-sm"
                    type="number"
                    min={1}
                    max={20}
                    aria-label="Concurrent generations per account"
                    value={generationLimitDraft}
                    onChange={(event) => setGenerationLimitDraft(event.currentTarget.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={settingsActionPending || generationLimit === (config?.mediaGenerationConcurrencyLimit || 2)}
                    onClick={() => onSaveMediaGenerationConcurrencyLimit(generationLimit)}
                  >
                    Save
                  </Button>
                </div>
              </div>
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
