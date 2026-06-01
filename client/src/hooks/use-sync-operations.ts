import * as React from "react"

import { fetchJson } from "@/lib/api"
import { replaceEqualJson } from "@/lib/render-state"
import type { SyncStatus } from "@/types/domain"

const ACTIVE_POLL_MS = 1400
const IDLE_POLL_MS = 9500

const defaultSyncStatus: SyncStatus = {
  running: false,
  status: "idle",
  currentPage: 0,
  scanned: 0,
  downloaded: 0,
  skipped: 0,
  errors: [],
  cancelRequested: false,
  message: "Idle.",
}

export function useSyncOperations(onSettled: () => void, onProgress?: () => void) {
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus>(defaultSyncStatus)
  const onSettledRef = React.useRef(onSettled)
  const onProgressRef = React.useRef(onProgress)
  const lastSettledFinishedAtRef = React.useRef<string | null>(defaultSyncStatus.finishedAt || null)
  const lastProgressSignatureRef = React.useRef("")

  React.useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  React.useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  React.useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    const poll = async () => {
      try {
        const next = await fetchJson<SyncStatus>("/api/sync/status")
        if (cancelled) return
        setSyncStatus((current) => replaceEqualJson(current, next))
        timer = window.setTimeout(poll, next.running ? ACTIVE_POLL_MS : IDLE_POLL_MS)
        if (next.running) {
          const progressSignature = JSON.stringify([next.downloaded, next.errors.length])
          if (progressSignature !== lastProgressSignatureRef.current) {
            lastProgressSignatureRef.current = progressSignature
            onProgressRef.current?.()
          }
        }
        if (!next.running && next.finishedAt && next.finishedAt !== lastSettledFinishedAtRef.current) {
          lastSettledFinishedAtRef.current = next.finishedAt
          lastProgressSignatureRef.current = ""
          onSettledRef.current()
        }
      } catch {
        timer = window.setTimeout(poll, IDLE_POLL_MS)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const startSync = React.useCallback(async (incremental: boolean) => {
    const data = await fetchJson<{ ok: boolean }>("/api/sync/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incremental }),
    })
    if (data.ok) {
      setSyncStatus((current) => replaceEqualJson(current, { ...current, running: true, status: "syncing", message: "Sync started." }))
    }
  }, [])

  async function startDownload(modeName: "missing" | "retry-errors") {
    const endpoint = modeName === "missing" ? "/api/download/missing" : "/api/download/retry-errors"
    await fetchJson(endpoint, { method: "POST" })
    setSyncStatus((current) => replaceEqualJson(current, { ...current, running: true, status: modeName, message: "Download queued." }))
  }

  async function startPlayboxSync() {
    await fetchJson("/api/playbox/sync/start", { method: "POST" })
    setSyncStatus((current) => replaceEqualJson(current, { ...current, running: true, status: "playbox", message: "Playbox sync queued." }))
  }

  async function startThumbnailGeneration() {
    await fetchJson("/api/thumbnails/generate", { method: "POST" })
    setSyncStatus((current) =>
      replaceEqualJson(current, { ...current, running: true, status: "thumbnails", message: "Thumbnail generation queued." }),
    )
  }

  async function startLibraryVerification() {
    await fetchJson("/api/library/verify", { method: "POST" })
    setSyncStatus((current) => replaceEqualJson(current, { ...current, running: true, status: "verify", message: "Verification queued." }))
  }

  async function cancelSync() {
    const next = await fetchJson<SyncStatus>("/api/sync/cancel", { method: "POST" })
    setSyncStatus((current) => replaceEqualJson(current, next))
  }

  return {
    syncStatus,
    startSync,
    startDownload,
    startPlayboxSync,
    startThumbnailGeneration,
    startLibraryVerification,
    cancelSync,
  }
}
