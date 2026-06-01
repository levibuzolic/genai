import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CatalogItem, CreateMode, CreateTemplate } from "@/types/domain"

import { useCreateStudio } from "./use-create-studio"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    expect(result.current.quality).toBe("720p-4")
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
          quality: "720p-4",
        },
        templateId: templateWithDifferentSource.id,
      },
    ])
  })

  it("keeps video quality compatible with the selected model", async () => {
    globalThis.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input)
      if (url === "/api/create/modes") return jsonResponse({ modes: [multiModelVideoMode] })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result } = renderHook(() => useCreateStudio())
    await waitFor(() => expect(result.current.modes).toHaveLength(1))
    await waitFor(() => expect(result.current.modelId).toBe("wan2.7-i2v"))
    await waitFor(() => expect(result.current.quality).toBe("1080p-15"))

    act(() => {
      result.current.setModelId("wan2.2-i2v-plus")
    })

    await waitFor(() => expect(result.current.quality).toBe("1080p-5"))
    expect(result.current.qualityField?.options?.map((option) => option.value)).toEqual(["1080p-5"])
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
      default: "1080p-15",
      options: [
        { label: "720p · 4s", value: "720p-4" },
        { label: "1080p · 15s", value: "1080p-15" },
      ],
    },
  ],
}

const multiModelVideoMode: CreateMode = {
  ...customVideoMode,
  fields: [
    { name: "prompt", label: "Prompt", required: true },
    {
      name: "modelId",
      label: "Model",
      default: "wan2.7-i2v",
      options: [
        { label: "Wan 2.7", value: "wan2.7-i2v" },
        { label: "Wan 2.2 Plus", value: "wan2.2-i2v-plus" },
      ],
    },
    {
      name: "quality",
      label: "Quality",
      default: "1080p-15",
      options: [
        { label: "1080p · 15s", value: "1080p-15", modelId: "wan2.7-i2v" },
        { label: "1080p · 5s", value: "1080p-5", modelId: "wan2.2-i2v-plus" },
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
      quality: "720p-4",
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
