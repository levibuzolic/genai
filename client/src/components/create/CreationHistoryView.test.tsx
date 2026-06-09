import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Creation, CreationEvent } from "@/types/domain"

import { CreationHistoryView } from "./CreationHistoryView"

afterEach(() => {
  cleanup()
})

const queuedCreation: Creation = {
  id: "creation-queued",
  status: "queued",
  modeId: "custom-video",
  modeLabel: "Custom Video",
  mediaType: "video",
  source: { kind: "catalog", itemId: "source-1" },
  params: { prompt: "animate the portrait" },
  updatedAt: "2026-06-04T01:00:00.000Z",
  active: true,
}

const failedCreation: Creation = {
  id: "creation-error",
  status: "error",
  modeId: "custom-image",
  modeLabel: "Edit Image",
  mediaType: "image",
  source: { kind: "url", url: "https://assets.example/source.png" },
  params: { prompt: "polish the frame" },
  error: "temporary upstream failure",
  updatedAt: "2026-06-04T02:00:00.000Z",
  active: false,
}

const creationHistoryViewCreations = [queuedCreation, failedCreation]
const emptyEvents: CreationEvent[] = []

describe("CreationHistoryView", () => {
  it("filters creation attempts and retries only the selected failed row", () => {
    const onRetry = vi.fn<(creation: Creation) => Promise<void>>(async () => undefined)
    render(
      <CreationHistoryView
        creations={creationHistoryViewCreations}
        loading={false}
        selectedCreation={null}
        selectedEvents={emptyEvents}
        statusMessage=""
        onCloseDetails={vi.fn<() => void>()}
        onRefresh={vi.fn<() => Promise<void>>()}
        onDetails={vi.fn<(creation: Creation) => Promise<void>>()}
        onDuplicate={vi.fn<(creation: Creation, options?: { includeSource?: boolean }) => Promise<void>>()}
        onRetry={onRetry}
        onSaveTemplate={vi.fn<(creation: Creation) => Promise<void>>()}
      />,
    )

    fireEvent.change(screen.getByLabelText("Search creation history"), { target: { value: "polish" } })

    expect(screen.getByText("polish the frame")).toBeTruthy()
    expect(screen.queryByText("animate the portrait")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /^retry creation$/i }))

    expect(onRetry).toHaveBeenCalledWith(failedCreation)
  })
})
