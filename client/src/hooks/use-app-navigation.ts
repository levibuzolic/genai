import * as React from "react"

import type { SettingsSection } from "@/components/app/SettingsDialog"

export type AppRoute = {
  createOpen: boolean
  itemId: string | null
  settingsOpen: boolean
  settingsSection: SettingsSection
  view: "library" | "templates"
}

const SETTINGS_SECTIONS = new Set<SettingsSection>(["library", "account", "backups"])

export function useAppNavigation() {
  const [route, setRoute] = React.useState(() => routeFromLocation(window.location))

  React.useEffect(() => {
    function onPopState() {
      setRoute(routeFromLocation(window.location))
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const navigate = React.useCallback((path: string, { replace = false }: { replace?: boolean } = {}) => {
    const nextUrl = new URL(path, window.location.href)
    nextUrl.search = window.location.search
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextPath === currentPath) return

    if (replace) {
      window.history.replaceState(null, "", nextPath)
    } else {
      window.history.pushState(null, "", nextPath)
    }
    setRoute(routeFromLocation(window.location))
  }, [])

  return {
    route,
    navigateToCreate: React.useCallback((options?: { replace?: boolean }) => navigate("/create", options), [navigate]),
    navigateToItem: React.useCallback(
      (id: string, options?: { replace?: boolean }) => navigate(`/items/${encodeURIComponent(id)}`, options),
      [navigate],
    ),
    navigateToLibrary: React.useCallback((options?: { replace?: boolean }) => navigate("/", options), [navigate]),
    navigateToSettings: React.useCallback(
      (section: SettingsSection = "library", options?: { replace?: boolean }) => navigate(`/settings/${section}`, options),
      [navigate],
    ),
    navigateToTemplates: React.useCallback((options?: { replace?: boolean }) => navigate("/templates", options), [navigate]),
  }
}

function routeFromLocation(location: Location): AppRoute {
  const pathParts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  const firstPart = pathParts[0] || ""

  if (firstPart === "templates") return baseRoute({ view: "templates" })
  if (firstPart === "create") return baseRoute({ createOpen: true })
  if (firstPart === "items" && pathParts[1]) return baseRoute({ itemId: pathParts[1] })
  if (firstPart === "settings") {
    const section = SETTINGS_SECTIONS.has(pathParts[1] as SettingsSection) ? (pathParts[1] as SettingsSection) : "library"
    return baseRoute({ settingsOpen: true, settingsSection: section })
  }

  return baseRoute()
}

function baseRoute(overrides: Partial<AppRoute> = {}): AppRoute {
  return {
    createOpen: false,
    itemId: null,
    settingsOpen: false,
    settingsSection: "library",
    view: "library",
    ...overrides,
  }
}
