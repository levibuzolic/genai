import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Creation } from "@/types/domain"
import type { ItemsResponse, PublicCatalogItem } from "@/types/routes"

import { buildOptimisticCatalogItemFromCreation, useLibrary } from "./use-library"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, "", "/")
})

const pendingItem = {
  id: "job-1",
  provider: "generateporn",
  type: "video",
  status: "pending",
  prompt: "cinematic test",
  createdAt: 1780350000000,
  createdAtIso: "2026-06-02T00:00:00.000Z",
  createModeId: "custom-video",
  posterUrl: null,
} satisfies PublicCatalogItem

const completedCreation = {
  id: "creation-1",
  jobId: "job-1",
  status: "done",
  modeId: "custom-video",
  modeLabel: "Custom Video",
  mediaType: "video",
  params: {
    prompt: "cinematic test",
    quality: "1080p-15",
  },
  outputUrl: "https://assets.example/result.mp4",
  createdAtIso: "2026-06-02T00:00:00.000Z",
  createdLocallyAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:01:00.000Z",
  downloadedItemId: null,
} satisfies Creation

describe("useLibrary", () => {
  it("builds a catalog item projection for successful completed creations", () => {
    expect(buildOptimisticCatalogItemFromCreation(completedCreation)).toMatchObject({
      id: "job-1",
      provider: "generateporn",
      type: "video",
      status: "done",
      prompt: "cinematic test",
      outputUrl: "https://assets.example/result.mp4",
      duration: 15,
      createModeId: "custom-video",
    })
  })

  it("replaces a visible pending item with the optimistic completed item", async () => {
    const response = {
      items: [pendingItem],
      total: 1,
      page: 1,
      pageSize: 48,
      pageCount: 1,
      facets: {
        media: { all: 1, video: 1 },
        status: { all: 1 },
      },
      catalogUpdatedAt: "2026-06-02T00:00:00.000Z",
      lastSeenJobId: null,
      lastRun: null,
    } satisfies ItemsResponse
    globalThis.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(response))

    const { result } = renderHook(() => useLibrary())

    await waitFor(() => expect(result.current.itemsData?.items).toHaveLength(1))

    act(() => {
      result.current.addOptimisticCreations([completedCreation])
    })

    await waitFor(() => expect(result.current.itemsData?.items[0]?.status).toBe("done"))
    expect(result.current.itemsData?.items[0]).toMatchObject({
      id: "job-1",
      outputUrl: "https://assets.example/result.mp4",
    })
    expect(result.current.itemsData?.total).toBe(1)
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
