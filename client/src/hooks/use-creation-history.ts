import * as React from "react"

import { fetchJson } from "@/lib/api"
import { replaceEqualJson } from "@/lib/render-state"
import type { CreateParams, Creation, CreationEvent, CreationSource, CreationsResponse } from "@/types/domain"
import type { CreationDetailsResponse, DuplicateCreationResponse, RefreshCreationsResponse } from "@/types/routes"

const IDLE_CREATION_POLL_MS = 10000
export type ActiveCreationTransition = {
  hasDownloadableCompletion: boolean
  hasFailedCompletion: boolean
  downloadableCreations: Creation[]
}

export function useCreationHistory(
  onApplyDraft: (form: { modeId?: string | null; source?: CreationSource | null; params?: CreateParams }) => Promise<void>,
  onActiveCompletion?: (transition: ActiveCreationTransition) => void | Promise<void>,
) {
  const [creations, setCreations] = React.useState<Creation[]>([])
  const [activeCount, setActiveCount] = React.useState(0)
  const [pollMs, setPollMs] = React.useState(IDLE_CREATION_POLL_MS)
  const [loading, setLoading] = React.useState(false)
  const [selectedCreation, setSelectedCreation] = React.useState<Creation | null>(null)
  const [selectedEvents, setSelectedEvents] = React.useState<CreationEvent[]>([])
  const [statusMessage, setStatusMessage] = React.useState("")
  const pollTimerRef = React.useRef<number | null>(null)
  const activeCountRef = React.useRef(0)
  const onActiveCompletionRef = React.useRef(onActiveCompletion)

  React.useEffect(() => {
    onActiveCompletionRef.current = onActiveCompletion
  }, [onActiveCompletion])

  const loadCreations = React.useCallback(
    async ({ refresh = false, showLoading = true }: { refresh?: boolean; showLoading?: boolean } = {}) => {
      if (showLoading) setLoading(true)
      try {
        const params = new URLSearchParams({ status: "all" })
        if (refresh) params.set("refresh", "true")
        const data = await fetchJson<CreationsResponse>(`/api/creations?${params}`)
        const nextActiveCount = data.activeCount || 0
        const transition = getActiveCreationTransition(activeCountRef.current, nextActiveCount, data.creations || [])
        setCreations((current) => replaceEqualJson(current, data.creations || []))
        setActiveCount(nextActiveCount)
        activeCountRef.current = nextActiveCount
        setPollMs(data.pollMs || IDLE_CREATION_POLL_MS)
        setStatusMessage((current) => (current ? "" : current))
        if (refresh && (transition.hasDownloadableCompletion || transition.hasFailedCompletion)) {
          await onActiveCompletionRef.current?.(transition)
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : String(error))
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [],
  )

  React.useEffect(() => {
    void loadCreations()
  }, [loadCreations])

  React.useEffect(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
    }

    pollTimerRef.current = window.setInterval(
      () => {
        void loadCreations({ refresh: activeCount > 0, showLoading: false })
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
      const nextActiveCount = data.activeCount || 0
      const transition = getActiveCreationTransition(activeCountRef.current, nextActiveCount, data.creations || [])
      setCreations((current) => replaceEqualJson(current, data.creations || []))
      setActiveCount(nextActiveCount)
      activeCountRef.current = nextActiveCount
      setPollMs(data.pollMs || IDLE_CREATION_POLL_MS)
      setStatusMessage("Creation history refreshed.")
      if (transition.hasDownloadableCompletion || transition.hasFailedCompletion) {
        await onActiveCompletionRef.current?.(transition)
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function openDetails(creation: Creation) {
    const data = await fetchJson<CreationDetailsResponse>(`/api/creations/${encodeURIComponent(creation.id)}`)
    setSelectedCreation((current) => replaceEqualJson(current, data.creation))
    setSelectedEvents((current) => replaceEqualJson(current, data.events || []))
  }

  async function duplicateSettings(creation: Creation, { includeSource = false }: { includeSource?: boolean } = {}) {
    const data = await fetchJson<DuplicateCreationResponse>(`/api/creations/${encodeURIComponent(creation.id)}/duplicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ includeSource }),
    })
    await onApplyDraft(data.form)
    await loadCreations()
    setStatusMessage(includeSource ? "Settings and source copied into a new draft." : "Settings copied into a new draft.")
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

function getActiveCreationTransition(
  previousActiveCount: number,
  nextActiveCount: number,
  creations: Creation[],
): ActiveCreationTransition {
  if (previousActiveCount <= 0 || nextActiveCount >= previousActiveCount) {
    return {
      hasDownloadableCompletion: false,
      hasFailedCompletion: false,
      downloadableCreations: [],
    }
  }

  const downloadableCreations = creations.filter(
    (creation) => creation.status === "done" && Boolean(creation.outputUrl) && !creation.downloadedItemId,
  )

  return {
    hasDownloadableCompletion: downloadableCreations.length > 0,
    hasFailedCompletion: creations.some((creation) => isFailedCreationStatus(creation.status) && !creation.downloadedItemId),
    downloadableCreations,
  }
}

function isFailedCreationStatus(status: string): boolean {
  return ["failed", "error", "cancelled", "canceled"].includes(status.toLowerCase())
}
