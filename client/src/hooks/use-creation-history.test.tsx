import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Creation, CreationsResponse } from "@/types/domain"

import { useCreationHistory } from "./use-creation-history"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const finishedCreation: Creation = {
  id: "creation-1",
  jobId: "job-1",
  status: "done",
  modeId: "custom-image",
  modeLabel: "Edit Image",
  source: { kind: "url", url: "https://assets.example/source.png" },
  params: { prompt: "polish image" },
  updatedAt: "2026-05-28T00:00:00.000Z",
  active: false,
}

describe("useCreationHistory", () => {
  it("keeps background polling out of the visible loading state", async () => {
    vi.useFakeTimers()
    const response: CreationsResponse = {
      creations: [finishedCreation],
      activeCount: 0,
      total: 1,
      queuePaused: false,
      failedQueuedCount: 0,
      pollMs: 10000,
    }
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(response))
    globalThis.fetch = fetchMock
    const loadingValues: boolean[] = []

    const { result } = renderHook(() => {
      const history = useCreationHistory(async () => undefined)
      loadingValues.push(history.loading)
      return history
    })

    await flushAsyncWork()
    expect(result.current.creations).toHaveLength(1)
    expect(result.current.loading).toBe(false)
    loadingValues.length = 0

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(loadingValues).not.toContain(true)
  })

  it("triggers completion work when active polling sees a downloadable finished creation", async () => {
    vi.useFakeTimers()
    const activeCreation: Creation = {
      ...finishedCreation,
      id: "creation-active",
      jobId: "job-active",
      status: "pending",
      outputUrl: null,
      active: true,
    }
    const completedCreation: Creation = {
      ...activeCreation,
      status: "done",
      outputUrl: "https://assets.example/result.mp4",
      downloadedItemId: null,
      active: false,
    }
    const responses: CreationsResponse[] = [
      {
        creations: [activeCreation],
        activeCount: 1,
        total: 1,
        queuePaused: false,
        failedQueuedCount: 0,
        pollMs: 1000,
      },
      {
        creations: [completedCreation],
        activeCount: 0,
        total: 1,
        queuePaused: false,
        failedQueuedCount: 0,
        pollMs: 10000,
      },
    ]
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      return jsonResponse(responses.shift() || responses[responses.length - 1])
    })
    const onActiveCompletion = vi.fn<(transition: { hasDownloadableCompletion: boolean; hasFailedCompletion: boolean }) => void>()
    globalThis.fetch = fetchMock

    renderHook(() => useCreationHistory(async () => undefined, onActiveCompletion))

    await flushAsyncWork()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onActiveCompletion).toHaveBeenCalledWith({
      downloadableCreations: [completedCreation],
      hasDownloadableCompletion: true,
      hasFailedCompletion: false,
    })
  })

  it("reports failed active completion without treating unchanged active polls as gallery updates", async () => {
    vi.useFakeTimers()
    const activeCreation: Creation = {
      ...finishedCreation,
      id: "creation-active",
      jobId: "job-active",
      status: "pending",
      outputUrl: null,
      active: true,
    }
    const failedCreation: Creation = {
      ...activeCreation,
      status: "failed",
      outputUrl: null,
      downloadedItemId: null,
      active: false,
    }
    const responses: CreationsResponse[] = [
      {
        creations: [activeCreation],
        activeCount: 1,
        total: 1,
        queuePaused: false,
        failedQueuedCount: 0,
        pollMs: 1000,
      },
      {
        creations: [activeCreation],
        activeCount: 1,
        total: 1,
        queuePaused: false,
        failedQueuedCount: 0,
        pollMs: 1000,
      },
      {
        creations: [failedCreation],
        activeCount: 0,
        total: 1,
        queuePaused: false,
        failedQueuedCount: 1,
        pollMs: 10000,
      },
    ]
    let index = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return jsonResponse(response)
    })
    const onActiveCompletion = vi.fn<(transition: { hasDownloadableCompletion: boolean; hasFailedCompletion: boolean }) => void>()
    globalThis.fetch = fetchMock

    renderHook(() => useCreationHistory(async () => undefined, onActiveCompletion))

    await flushAsyncWork()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flushAsyncWork()
    expect(onActiveCompletion).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onActiveCompletion).toHaveBeenCalledWith({
      downloadableCreations: [],
      hasDownloadableCompletion: false,
      hasFailedCompletion: true,
    })
  })

  it("pauses the queue and retries an individual failed creation", async () => {
    let queuePaused = false
    const failedCreation: Creation = {
      ...finishedCreation,
      id: "creation-error",
      status: "error",
      active: false,
    }
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input)
      if (url.startsWith("/api/creations?")) {
        return jsonResponse({
          creations: [failedCreation],
          activeCount: 0,
          total: 1,
          queuePaused,
          failedQueuedCount: 1,
          pollMs: 10000,
        } satisfies CreationsResponse)
      }
      if (url === "/api/creations/queue/pause" && init?.method === "POST") {
        queuePaused = true
        return jsonResponse({ ok: true, paused: true, queued: 0, pending: 0, failedQueuedCount: 1 })
      }
      if (url === "/api/creations/creation-error/retry" && init?.method === "POST") {
        return jsonResponse({ ok: true, creation: { ...failedCreation, status: "queued", active: true } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock

    const { result } = renderHook(() => useCreationHistory(async () => undefined))
    await flushAsyncWork()

    await act(async () => {
      await result.current.setQueuePaused(true)
    })
    await act(async () => {
      await result.current.retryCreation(failedCreation)
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/creations/queue/pause", { method: "POST" })
    expect(fetchMock).toHaveBeenCalledWith("/api/creations/creation-error/retry", { method: "POST" })
    expect(result.current.queuePaused).toBe(true)
    expect(result.current.failedQueuedCount).toBe(1)
  })
})

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
