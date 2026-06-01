import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CatalogItem } from "@/types/domain"

import { MediaDialog } from "./MediaDialog"

afterEach(() => {
  cleanup()
})

const failedItem = {
  id: "failed-item-1",
  type: "image",
  status: "failed",
  prompt: "failed prompt",
  createdAtIso: "2026-05-28T01:00:00.000Z",
  downloadError: "Generation failed due to timeout",
} satisfies CatalogItem

describe("MediaDialog", () => {
  it("hides favorite action for failed items while keeping other actions", () => {
    render(
      <MediaDialog
        item={failedItem}
        open
        onOpenChange={vi.fn()}
        onCopy={vi.fn()}
        onCreate={vi.fn()}
        onAnimate={vi.fn()}
        onUsePrompt={vi.fn()}
        onDeleteRemote={vi.fn()}
        onToggleFavorite={vi.fn()}
        previousItem={null}
        nextItem={null}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        videoMuted
        onVideoMutedChange={vi.fn()}
      />,
    )

    expect(screen.getByText("failed prompt")).toBeTruthy()
    expect(screen.getByText("failed")).toBeTruthy()
    expect(screen.getByText("Generation failed due to timeout")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /favorite|unfavorite/i })).toBeNull()
    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy()
  })
})
