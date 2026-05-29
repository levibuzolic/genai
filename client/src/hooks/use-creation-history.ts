import * as React from "react"

import { fetchJson } from "@/lib/api"
import type { CreateParams, Creation, CreationEvent, CreationSource, CreationsResponse } from "@/types/domain"
import type { CreationDetailsResponse, DuplicateCreationResponse, RefreshCreationsResponse } from "@/types/routes"

const IDLE_CREATION_POLL_MS = 10000

export function useCreationHistory(
  onApplyDraft: (form: { modeId?: string | null; source?: CreationSource | null; params?: CreateParams }) => Promise<void>,
) {
  const [creations, setCreations] = React.useState<Creation[]>([])
  const [activeCount, setActiveCount] = React.useState(0)
  const [pollMs, setPollMs] = React.useState(IDLE_CREATION_POLL_MS)
  const [loading, setLoading] = React.useState(false)
  const [selectedCreation, setSelectedCreation] = React.useState<Creation | null>(null)
  const [selectedEvents, setSelectedEvents] = React.useState<CreationEvent[]>([])
  const [statusMessage, setStatusMessage] = React.useState("")
  const pollTimerRef = React.useRef<number | null>(null)

  const loadCreations = React.useCallback(async ({ refresh = false }: { refresh?: boolean } = {}) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: "all" })
      if (refresh) params.set("refresh", "true")
      const data = await fetchJson<CreationsResponse>(`/api/creations?${params}`)
      setCreations(data.creations || [])
      setActiveCount(data.activeCount || 0)
      setPollMs(data.pollMs || IDLE_CREATION_POLL_MS)
      setStatusMessage("")
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadCreations()
  }, [loadCreations])

  React.useEffect(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
    }

    pollTimerRef.current = window.setTimeout(
      () => {
        void loadCreations({ refresh: activeCount > 0 })
      },
      activeCount > 0 ? pollMs : IDLE_CREATION_POLL_MS,
    )

    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current)
      }
    }
  }, [activeCount, loadCreations, pollMs])

  async function refreshNow() {
    setStatusMessage("Refreshing creation history...")
    try {
      const data = await fetchJson<RefreshCreationsResponse>("/api/creations/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      setCreations(data.creations || [])
      setActiveCount(data.activeCount || 0)
      setPollMs(data.pollMs || IDLE_CREATION_POLL_MS)
      setStatusMessage("Creation history refreshed.")
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function openDetails(creation: Creation) {
    const data = await fetchJson<CreationDetailsResponse>(`/api/creations/${encodeURIComponent(creation.id)}`)
    setSelectedCreation(data.creation)
    setSelectedEvents(data.events || [])
  }

  async function duplicateSettings(creation: Creation) {
    const data = await fetchJson<DuplicateCreationResponse>(`/api/creations/${encodeURIComponent(creation.id)}/duplicate`, {
      method: "POST",
    })
    await onApplyDraft(data.form)
    await loadCreations()
    setStatusMessage("Settings copied into a new draft.")
  }

  return {
    creations,
    activeCount,
    loading,
    selectedCreation,
    selectedEvents,
    setSelectedCreation,
    statusMessage,
    loadCreations,
    refreshNow,
    openDetails,
    duplicateSettings,
  }
}
