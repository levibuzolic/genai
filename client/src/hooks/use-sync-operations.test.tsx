import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SyncStatus } from "@/types/domain"

import { useSyncOperations } from "./use-sync-operations"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useSyncOperations", () => {
  it("settles each observed sync completion once", async () => {
    vi.useFakeTimers()
    const statuses = [
      syncStatus({ finishedAt: "2026-05-28T00:00:00.000Z", message: "Previous run finished." }),
      syncStatus({ running: true, status: "running", finishedAt: null, message: "Sync running." }),
      syncStatus({ finishedAt: "2026-05-28T00:01:00.000Z", message: "New run finished." }),
      syncStatus({ finishedAt: "2026-05-28T00:01:00.000Z", message: "New run finished." }),
    ]
    let index = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      const status = statuses[Math.min(index, statuses.length - 1)]
      index += 1
      return jsonResponse(status)
    })
    globalThis.fetch = fetchMock
    const onSettled = vi.fn<() => void>()

    renderHook(() => useSyncOperations(onSettled))

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9500)
    })
    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSettled).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400)
    })
    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onSettled).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9500)
    })
    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(onSettled).toHaveBeenCalledTimes(2)
  })

  it("reports running progress when visible library counters advance", async () => {
    vi.useFakeTimers()
    const statuses = [
      syncStatus({ running: true, status: "running", currentPage: 1, scanned: 1, downloaded: 0, finishedAt: null }),
      syncStatus({ running: true, status: "running", currentPage: 2, scanned: 24, downloaded: 0, skipped: 23, finishedAt: null }),
      syncStatus({ running: true, status: "running", currentPage: 2, scanned: 24, downloaded: 1, skipped: 23, finishedAt: null }),
      syncStatus({ running: false, finishedAt: "2026-05-28T00:02:00.000Z" }),
    ]
    let index = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      const status = statuses[Math.min(index, statuses.length - 1)]
      index += 1
      return jsonResponse(status)
    })
    globalThis.fetch = fetchMock
    const onSettled = vi.fn<() => void>()
    const onProgress = vi.fn<() => void>()

    renderHook(() => useSyncOperations(onSettled, onProgress))

    await flushAsyncWork()
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400)
    })
    await flushAsyncWork()
    expect(onProgress).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400)
    })
    await flushAsyncWork()
    expect(onProgress).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400)
    })
    await flushAsyncWork()
    expect(onSettled).toHaveBeenCalledTimes(1)
  })
})

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function syncStatus(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    running: false,
    status: "idle",
    currentPage: 0,
    scanned: 0,
    downloaded: 0,
    skipped: 0,
    errors: [],
    cancelRequested: false,
    message: "Idle.",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
