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

const imageItem = {
  id: "image-item-1",
  type: "image",
  status: "done",
  prompt: "source portrait",
  localFile: "renders/source.png",
  createdAtIso: "2026-05-28T01:00:00.000Z",
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
        onTryAgain={vi.fn<(item: CatalogItem) => void>()}
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
        onTryAgain={vi.fn<(item: CatalogItem) => void>()}
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

  it("offers image detail shortcuts for edit and custom video", () => {
    const onCreate = vi.fn<(item: CatalogItem) => void>()
    const onAnimate = vi.fn<(item: CatalogItem) => void>()

    render(
      <MediaDialog
        item={imageItem}
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onCopy={vi.fn<(value: string | null | undefined, label: string) => void>()}
        onCreate={onCreate}
        onAnimate={onAnimate}
        onUsePrompt={vi.fn<(item: CatalogItem) => void>()}
        onTryAgain={vi.fn<(item: CatalogItem) => void>()}
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

    screen.getByRole("button", { name: /edit image/i }).click()
    screen.getByRole("button", { name: /custom video/i }).click()

    expect(onCreate).toHaveBeenCalledWith(imageItem)
    expect(onAnimate).toHaveBeenCalledWith(imageItem)
  })

  it("offers try again for app-created media", () => {
    const onTryAgain = vi.fn<(item: CatalogItem) => void>()
    const item = {
      id: "created-item-1",
      type: "video",
      status: "done",
      prompt: "animate this",
      localFile: "renders/clip.mp4",
      createModeId: "custom-video",
      createParams: { prompt: "animate this", quality: "720p-4" },
      sourceKind: "catalog",
      modelId: "video-model",
      timeToGenerateMs: 62000,
      sourceItemId: "source-image-1",
    } satisfies CatalogItem

    render(
      <MediaDialog
        item={item}
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onCopy={vi.fn<(value: string | null | undefined, label: string) => void>()}
        onCreate={vi.fn<(item: CatalogItem) => void>()}
        onAnimate={vi.fn<(item: CatalogItem) => void>()}
        onUsePrompt={vi.fn<(item: CatalogItem) => void>()}
        onTryAgain={onTryAgain}
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

    screen.getByRole("button", { name: /try again/i }).click()

    expect(screen.queryByRole("button", { name: /edit image/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /custom video/i })).toBeNull()
    expect(screen.getByText("Video Details")).toBeTruthy()
    expect(screen.getByText("Catalog")).toBeTruthy()
    expect(screen.getByText("video-model")).toBeTruthy()
    expect(screen.getByText("1:02")).toBeTruthy()
    expect(onTryAgain).toHaveBeenCalledWith(item)
  })
})
