import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CatalogItem } from "@/types/domain"

import { MediaCard } from "./MediaCard"

afterEach(() => {
  cleanup()
})

const baseItem = {
  id: "item-1",
  prompt: "soft studio portrait",
  createdAtIso: "2026-05-28T01:00:00.000Z",
} satisfies CatalogItem

function renderCard(item: CatalogItem) {
  const onDetails = vi.fn<() => void>()
  const props = {
    item,
    view: "grid" as const,
    onDetails,
    onCopyPrompt: vi.fn<() => void>(),
    onCreate: vi.fn<() => void>(),
    onDeleteRemote: vi.fn<() => void>(),
    onToggleFavorite: vi.fn<() => void>(),
  }

  const result = render(<MediaCard {...props} />)
  return { ...result, onDetails }
}

describe("MediaCard", () => {
  it("uses the video thumbnail in the index and opens details from it", () => {
    const { container, onDetails } = renderCard({
      ...baseItem,
      id: "video-1",
      type: "video",
      localFile: "renders/clip.mp4",
      posterUrl: "/media/_thumbnails/clip.jpg",
      duration: 6,
    })

    expect(container.querySelector("video")).toBeNull()
    expect(screen.queryByRole("button", { name: /^details$/i })).toBeNull()
    expect(screen.getByRole("img", { name: /soft studio portrait/i }).getAttribute("src")).toBe("/media/_thumbnails/clip.jpg")

    fireEvent.mouseEnter(container.querySelector(".media-card") as HTMLElement)
    const hoverVideo = container.querySelector("video")
    expect(hoverVideo?.getAttribute("src")).toBe("/media/renders/clip.mp4")
    expect(hoverVideo?.controls).toBe(false)
    expect(hoverVideo?.muted).toBe(true)
    expect(hoverVideo?.loop).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: /open video details/i }))

    expect(onDetails).toHaveBeenCalledTimes(1)
  })

  it("opens image details from the image thumbnail instead of linking to the file", () => {
    const { container, onDetails } = renderCard({
      ...baseItem,
      id: "image-1",
      type: "image",
      localFile: "renders/image one.png",
    })

    expect(container.querySelector("a.previewLink")).toBeNull()
    expect(screen.getByRole("img", { name: /soft studio portrait/i }).getAttribute("src")).toBe("/media/renders/image%20one.png")

    fireEvent.click(screen.getByRole("button", { name: /open image details/i }))

    expect(onDetails).toHaveBeenCalledTimes(1)
  })

  it("opens details from rendering media cards", () => {
    const { onDetails } = renderCard({
      ...baseItem,
      id: "pending-video-1",
      type: "video",
      status: "processing",
      localFile: null,
      outputUrl: null,
      createdAtIso: new Date().toISOString(),
    })

    expect(screen.getByText("Rendering video")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /open video details/i }))

    expect(onDetails).toHaveBeenCalledTimes(1)
  })

  it("marks remote-deleted media with a deleted state and overlay", () => {
    const { container } = renderCard({
      ...baseItem,
      id: "deleted-image-1",
      type: "image",
      localFile: "renders/deleted.png",
      remoteDeletedAt: "2026-05-30T01:00:00.000Z",
      remoteDeleteStatus: "deleted",
    })

    expect(container.querySelector(".media-card")?.classList.contains("is-deleted")).toBe(true)
    expect(container.querySelector(".media-card")?.getAttribute("data-remote-deleted")).toBe("true")
    expect(screen.getByText("Deleted remotely")).toBeTruthy()
  })

  it("marks failed media as failed, keeps details openable, and hides favorite", () => {
    const { container, onDetails } = renderCard({
      ...baseItem,
      id: "failed-image-1",
      type: "image",
      status: "failed",
      prompt: "soft studio portrait failed",
      downloadError: "Server returned an error",
    })

    expect(container.querySelector(".media-card")?.classList.contains("is-failed")).toBe(true)
    expect(screen.getByText("failed")).toBeTruthy()
    expect(screen.getByText("Server returned an error")).toBeTruthy()
    expect(screen.getByRole("button", { name: /open media details/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /favorite|unfavorite/i })).toBeNull()
    expect(screen.getByRole("button", { name: /delete remote/i })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /open media details/i }))
    expect(onDetails).toHaveBeenCalledTimes(1)
  })
})
