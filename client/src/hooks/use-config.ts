import * as React from "react"

import { fetchJson } from "@/lib/api"
import { replaceEqualJson } from "@/lib/render-state"
import type { Config } from "@/types/domain"

export function useConfig() {
  const [config, setConfig] = React.useState<Config | null>(null)

  const loadConfig = React.useCallback(async () => {
    try {
      const next = await fetchJson<Config>("/api/config")
      setConfig((current) => replaceEqualJson(current, next))
    } catch {
      setConfig((current) => (current === null ? current : null))
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false

    async function loadInitialConfig() {
      try {
        const next = await fetchJson<Config>("/api/config")
        if (!cancelled) setConfig((current) => replaceEqualJson(current, next))
      } catch {
        if (!cancelled) setConfig((current) => (current === null ? current : null))
      }
    }

    void loadInitialConfig()
    const interval = window.setInterval(() => {
      if (!cancelled) void loadConfig()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loadConfig])

  return {
    config,
    reloadConfig: loadConfig,
  }
}
