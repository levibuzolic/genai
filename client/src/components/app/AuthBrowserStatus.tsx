import { Badge } from "@/components/ui/badge"
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { formatTime } from "@/lib/format"
import type { Config } from "@/types/domain"

type AuthBrowserStatusProps = {
  config: Config | null
  pending: boolean
  onConnect: () => void
  onRefresh: () => void
  onDisconnect: () => void
}

export function AuthBrowserStatus({ config, pending, onConnect, onRefresh, onDisconnect }: AuthBrowserStatusProps) {
  const authBrowser = config?.authBrowser
  const hasAuthorization = Boolean(config?.hasAuthorization)
  const status = authBrowser?.status || (hasAuthorization ? "connected" : "missing")
  const message = authBrowser?.message || (hasAuthorization ? "API token is active." : "Connect the auth browser to sync.")
  const expiresAt = config?.authorizationExpiresAt || authBrowser?.expiresAt
  const badgeVariant = getAuthBadgeVariant(status, hasAuthorization, authBrowser?.lastError)
  const connectLabel = hasAuthorization || authBrowser?.hasProfile || authBrowser?.lastError ? "Reconnect account" : "Connect account"

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="space-y-1.5">
        <span className="flex items-center justify-between gap-3">
          <span>Auth browser</span>
          <Badge variant={badgeVariant}>{formatStatus(status, pending)}</Badge>
        </span>
        <span className="block truncate text-xs font-normal text-muted-foreground">{message}</span>
        <span className="block text-[11px] font-normal text-muted-foreground/80">
          {expiresAt ? `Token until ${formatTime(expiresAt)}` : "No active token"}
          {authBrowser?.lastRefreshAt ? ` · refreshed ${formatTime(authBrowser.lastRefreshAt)}` : ""}
        </span>
        {authBrowser?.lastError && <span className="block text-[11px] font-normal text-red-300">{authBrowser.lastError}</span>}
      </DropdownMenuLabel>
      <DropdownMenuItem disabled={pending} onClick={onConnect}>
        {connectLabel}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={pending || !authBrowser?.hasProfile} onClick={onRefresh}>
        Refresh token
      </DropdownMenuItem>
      <DropdownMenuItem disabled={pending || !authBrowser?.browserOpen} onClick={onDisconnect}>
        Close browser
      </DropdownMenuItem>
    </>
  )
}

function getAuthBadgeVariant(status: string, hasAuthorization: boolean, lastError?: string | null) {
  if (lastError) return "danger"
  if (hasAuthorization || status === "connected") return "success"
  if (status === "awaiting-login" || status === "refreshing" || status === "starting") return "warning"
  return "muted"
}

function formatStatus(status: string, pending: boolean) {
  if (pending) return "working"
  return status.replaceAll("-", " ")
}
