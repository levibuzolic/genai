import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Creation } from "@/types/domain"

import { CreationHistoryPanel } from "./CreationHistoryPanel"

afterEach(() => {
  cleanup()
})

const activeCreation: Creation = {
  id: "job-active",
  jobId: "job-active",
  status: "pending",
  modeId: "custom-video",
  modeLabel: "Custom Video",
  source: { kind: "url", url: "https://assets.example/source.png" },
  params: { prompt: "animate this", quality: "720p-4" },
  updatedAt: "2026-05-28T01:00:00.000Z",
  active: true,
}

const finishedCreation: Creation = {
  id: "job-done",
  jobId: "job-done",
  status: "done",
  modeId: "custom-image",
  modeLabel: "Edit Image",
  source: { kind: "catalog", itemId: "11111111-1111-4111-8111-111111111111" },
  params: { prompt: "polish image" },
  outputUrl: "https://assets.example/result.png",
  updatedAt: "2026-05-28T01:01:00.000Z",
  active: false,
}
const mixedCreations = [activeCreation, finishedCreation]
const noEvents: [] = []

describe("CreationHistoryPanel", () => {
  it("separates active queue work from recent finished work", () => {
    render(
      <CreationHistoryPanel
        creations={mixedCreations}
        activeCount={1}
        loading={false}
        selectedCreation={null}
        selectedEvents={noEvents}
        statusMessage=""
        onRefresh={vi.fn<() => Promise<void>>()}
        onDetails={vi.fn<(creation: Creation) => Promise<void>>()}
        onCloseDetails={vi.fn<() => void>()}
        onDuplicate={vi.fn<(creation: Creation, options?: { includeSource?: boolean }) => Promise<void>>()}
        onRetry={vi.fn<(creation: Creation) => Promise<void>>()}
        onSaveTemplate={vi.fn<(creation: Creation) => Promise<void>>()}
      />,
    )

    expect(screen.getByText("1 generation still running")).toBeTruthy()
    expect(screen.getByText("animate this")).toBeTruthy()
    expect(screen.getByText("polish image")).toBeTruthy()
  })

  it("offers copy settings from rows and the detail dialog", () => {
    const onDuplicate = vi.fn<(creation: Creation, options?: { includeSource?: boolean }) => Promise<void>>(async () => undefined)
    const props = {
      creations: [finishedCreation],
      activeCount: 0,
      loading: false,
      selectedEvents: [{ id: 1, status: "done", message: "Job done.", createdAt: "2026-05-28T01:01:00.000Z" }],
      statusMessage: "",
      onRefresh: vi.fn<() => Promise<void>>(),
      onDetails: vi.fn<(creation: Creation) => Promise<void>>(),
      onCloseDetails: vi.fn<() => void>(),
      onDuplicate,
      onRetry: vi.fn<(creation: Creation) => Promise<void>>(),
      onSaveTemplate: vi.fn<(creation: Creation) => Promise<void>>(),
    }
    const { rerender } = render(<CreationHistoryPanel {...props} selectedCreation={null} />)

    fireEvent.click(screen.getByRole("button", { name: /^copy settings$/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy settings and source/i }))
    rerender(<CreationHistoryPanel {...props} selectedCreation={finishedCreation} />)
    fireEvent.click(screen.getAllByRole("button", { name: /^copy settings$/i }).at(-1) as HTMLElement)
    fireEvent.click(screen.getByRole("button", { name: /^copy with source$/i }))

    expect(onDuplicate).toHaveBeenCalledTimes(4)
    expect(onDuplicate).toHaveBeenNthCalledWith(1, finishedCreation)
    expect(onDuplicate).toHaveBeenNthCalledWith(2, finishedCreation, { includeSource: true })
    expect(onDuplicate).toHaveBeenNthCalledWith(3, finishedCreation)
    expect(onDuplicate).toHaveBeenNthCalledWith(4, finishedCreation, { includeSource: true })
  })

  it("offers retry actions for failed creations only", () => {
    const failedCreation: Creation = {
      ...finishedCreation,
      id: "job-error",
      status: "error",
      error: "temporary upstream failure",
    }
    const onRetry = vi.fn<(creation: Creation) => Promise<void>>(async () => undefined)
    const props = {
      creations: [failedCreation, finishedCreation],
      activeCount: 0,
      loading: false,
      selectedEvents: [],
      statusMessage: "",
      onRefresh: vi.fn<() => Promise<void>>(),
      onDetails: vi.fn<(creation: Creation) => Promise<void>>(),
      onCloseDetails: vi.fn<() => void>(),
      onDuplicate: vi.fn<(creation: Creation, options?: { includeSource?: boolean }) => Promise<void>>(),
      onRetry,
      onSaveTemplate: vi.fn<(creation: Creation) => Promise<void>>(),
    }
    const { rerender } = render(<CreationHistoryPanel {...props} selectedCreation={null} />)

    fireEvent.click(screen.getByRole("button", { name: /^retry creation$/i }))
    rerender(<CreationHistoryPanel {...props} selectedCreation={failedCreation} />)
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }))

    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, failedCreation)
    expect(onRetry).toHaveBeenNthCalledWith(2, failedCreation)
  })
})
