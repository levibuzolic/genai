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
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onCopy={vi.fn<(value: string | null | undefined, label: string) => void>()}
        onCreate={vi.fn<(item: CatalogItem) => void>()}
        onAnimate={vi.fn<(item: CatalogItem) => void>()}
        onUsePrompt={vi.fn<(item: CatalogItem) => void>()}
        onDeleteRemote={vi.fn<(item: CatalogItem) => void>()}
        onToggleFavorite={vi.fn<(item: CatalogItem) => void>()}
        previousItem={null}
        nextItem={null}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        videoMuted
        onVideoMutedChange={vi.fn<(muted: boolean) => void>()}
      />,
    )

    expect(screen.getByText("failed prompt")).toBeTruthy()
    expect(screen.getByText(/failed · not local/)).toBeTruthy()
    expect(screen.getByText("Generation failed due to timeout")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /favorite|unfavorite/i })).toBeNull()
    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy()
  })

  it("hides the open link for Playbox items", () => {
    render(
      <MediaDialog
        item={{
          id: "playbox-item-1",
          provider: "playbox",
          type: "video",
          localFile: "playbox/clip.mp4",
          outputUrl: "https://playbox-cdn.example/clip.mp4",
          prompt: "playbox prompt",
        }}
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onCopy={vi.fn<(value: string | null | undefined, label: string) => void>()}
        onCreate={vi.fn<(item: CatalogItem) => void>()}
        onAnimate={vi.fn<(item: CatalogItem) => void>()}
        onUsePrompt={vi.fn<(item: CatalogItem) => void>()}
        onDeleteRemote={vi.fn<(item: CatalogItem) => void>()}
        onToggleFavorite={vi.fn<(item: CatalogItem) => void>()}
        previousItem={null}
        nextItem={null}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        videoMuted
        onVideoMutedChange={vi.fn<(muted: boolean) => void>()}
      />,
    )

    expect(screen.queryByRole("link", { name: /open/i })).toBeNull()
  })
})
