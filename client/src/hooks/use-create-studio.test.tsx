import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CatalogItem, CreateMode, CreateTemplate } from "@/types/domain"

import { useCreateStudio } from "./use-create-studio"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("useCreateStudio", () => {
  it("keeps the supplied media untouched when selecting a template", async () => {
    const submittedBodies: unknown[] = []
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input)
      if (url === "/api/create/modes") return jsonResponse({ modes: [customVideoMode] })
      if (url === "/api/create/jobs" && init?.method === "POST") {
        submittedBodies.push(JSON.parse(String(init.body)))
        return jsonResponse({ ok: true, jobId: "job-1", modeId: "custom-video", pollMs: 1000 })
      }
      if (url === "/api/create/jobs/job-1") {
        return jsonResponse({ job: { id: "job-1", status: "done" }, pollMs: 1000 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })

    const { result } = renderHook(() => useCreateStudio())
    await waitFor(() => expect(result.current.modes).toHaveLength(1))

    await act(async () => {
      await result.current.openCreator({
        sourceItem: sourceItem,
        modeId: "custom-video",
      })
    })

    act(() => {
      result.current.applyTemplate(templateWithDifferentSource)
    })

    expect(result.current.sourceKind).toBe("catalog")
    expect(result.current.selectedSource?.id).toBe(sourceItem.id)
    expect(result.current.sourceUrl).toBe("")
    expect(result.current.prompt).toBe("template prompt")
    expect(result.current.negativePrompt).toBe("template negative")
    expect(result.current.quality).toBe("720p-16")
    expect(result.current.selectedTemplateId).toBe(templateWithDifferentSource.id)

    await act(async () => {
      await result.current.submitCreateJob()
    })

    expect(submittedBodies).toEqual([
      {
        modeId: "custom-video",
        source: { kind: "catalog", itemId: sourceItem.id },
        params: {
          prompt: "template prompt",
          negativePrompt: "template negative",
          quality: "720p-16",
        },
        queue: true,
        templateId: templateWithDifferentSource.id,
      },
    ])
  })

  it("uses the server supplied MotionHeat quality options without a model selector", async () => {
    globalThis.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input)
      if (url === "/api/create/modes") return jsonResponse({ modes: [customVideoMode] })
      if (url === "/api/create/jobs/job-1") return jsonResponse({ job: { status: "pending" } })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result } = renderHook(() => useCreateStudio())
    await waitFor(() => expect(result.current.modes).toHaveLength(1))
    await waitFor(() => expect(result.current.modelId).toBe(""))
    await waitFor(() => expect(result.current.quality).toBe("720p-16"))

    expect(result.current.qualityField?.options?.map((option) => option.value)).toEqual(["720p-16", "1080p-15"])
    expect(result.current.selectedMode?.fields?.some((field) => field.name === "modelId")).toBe(false)
  })

  it("clears the submit loading state after the local queue accepts a pending job", async () => {
    globalThis.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input)
      if (url === "/api/create/modes") return jsonResponse({ modes: [customVideoMode] })
      if (url === "/api/create/jobs" && init?.method === "POST") {
        return jsonResponse({ ok: true, queued: true, jobId: "job-1", modeId: "custom-video", pollMs: 1000 })
      }
      if (url === "/api/create/jobs/job-1") return jsonResponse({ job: { id: "job-1", status: "pending" }, pollMs: 1000 })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result } = renderHook(() => useCreateStudio())
    await waitFor(() => expect(result.current.modes).toHaveLength(1))
    await act(async () => {
      await result.current.openCreator({
        sourceItem,
        modeId: "custom-video",
      })
    })
    vi.useFakeTimers()

    await act(async () => {
      await result.current.submitCreateJob()
    })

    expect(result.current.submitting).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.status).toBe("Pending.")
    expect(result.current.submitting).toBe(false)
  })

  it("shows a detailed toast when create submission cannot reach the API", async () => {
    const toastMessages: string[] = []
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      if (detail?.message) toastMessages.push(detail.message)
    }
    window.addEventListener("genai:toast", onToast)
    globalThis.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input)
      if (url === "/api/create/modes") return jsonResponse({ modes: [customVideoMode] })
      if (url === "/api/create/jobs" && init?.method === "POST") throw new TypeError("Failed to fetch")
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result } = renderHook(() => useCreateStudio())
    await waitFor(() => expect(result.current.modes).toHaveLength(1))
    await act(async () => {
      await result.current.openCreator({
        sourceItem,
        modeId: "custom-video",
      })
    })

    await act(async () => {
      await result.current.submitCreateJob()
    })

    expect(result.current.status).toBe("Create request could not reach the local API.")
    expect(result.current.submitting).toBe(false)
    expect(toastMessages).toEqual(["Create request could not reach the local API. Check that the local server is running and retry."])

    window.removeEventListener("genai:toast", onToast)
  })
})

const sourceItem: CatalogItem = {
  id: "source-1",
  type: "edit",
  status: "done",
  localFile: "source.png",
  outputUrl: "https://assets.example/original-source.png",
}

const customVideoMode: CreateMode = {
  id: "custom-video",
  label: "Custom Video",
  mediaType: "video",
  endpoint: "video",
  source: {
    required: true,
    acceptedKinds: ["catalog", "upload", "url"],
  },
  fields: [
    { name: "prompt", label: "Prompt", required: true },
    {
      name: "quality",
      label: "Quality",
      default: "720p-16",
      options: [
        { label: "720p · 16s", value: "720p-16" },
        { label: "1080p · 15s", value: "1080p-15" },
      ],
    },
  ],
}

const templateWithDifferentSource: CreateTemplate = {
  id: "template-1",
  label: "Template One",
  type: "video",
  settings: {
    modeId: "custom-video",
    source: { kind: "url", url: "https://assets.example/template-source.png" },
    params: {
      prompt: "template prompt",
      negativePrompt: "template negative",
      quality: "720p-16",
    },
  },
  workflow: [],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
