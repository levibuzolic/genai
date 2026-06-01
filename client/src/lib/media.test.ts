import { describe, expect, it } from "vitest"

import { encodeURIPath, isImageItem, isImageUrl, isPendingMediaItem, isVideoItem, isVideoUrl, mediaUrlForItem } from "./media"

describe("media helpers", () => {
  it("builds local media URLs by encoding path segments only", () => {
    expect(encodeURIPath("folder/name with space#1.png")).toBe("folder/name%20with%20space%231.png")
    expect(mediaUrlForItem({ id: "local", localFile: "folder/name with space#1.png", outputUrl: "https://remote/image.png" })).toBe(
      "/media/folder/name%20with%20space%231.png",
    )
  })

  it("falls back to output URLs when no local file exists", () => {
    expect(mediaUrlForItem({ id: "remote", outputUrl: "https://example.com/output.webp" })).toBe("https://example.com/output.webp")
    expect(mediaUrlForItem(null)).toBeNull()
  })

  it("never falls back to remote Playbox media URLs", () => {
    expect(
      mediaUrlForItem({
        id: "playbox-local",
        provider: "playbox",
        localFile: "playbox/clip.mp4",
        outputUrl: "https://cdn.example/clip.mp4",
      }),
    ).toBe("/media/playbox/clip.mp4")
    expect(mediaUrlForItem({ id: "playbox-remote", provider: "playbox", outputUrl: "https://cdn.example/clip.mp4" })).toBeNull()
  })

  it("detects image and video URLs with query strings and data URLs", () => {
    expect(isImageUrl("https://example.com/a.JPG?token=1")).toBe(true)
    expect(isImageUrl("data:image/png;base64,abc")).toBe(true)
    expect(isVideoUrl("https://example.com/a.mp4#preview")).toBe(true)
    expect(isImageItem({ id: "img", localFile: "x.webp" })).toBe(true)
    expect(isVideoItem({ id: "vid", outputUrl: "https://example.com/x.mp4?download=1" })).toBe(true)
  })

  it("detects pending video items without treating completed missing items as active", () => {
    const now = Date.now()
    expect(isVideoItem({ id: "pending-video", type: "video", status: "processing" })).toBe(true)
    expect(
      isPendingMediaItem({
        id: "pending-video",
        type: "video",
        status: "processing",
        createdAtIso: new Date(now - 5 * 60 * 1000).toISOString(),
      }),
    ).toBe(true)
    expect(
      isPendingMediaItem({
        id: "old-pending-video",
        type: "video",
        status: "processing",
        createdAtIso: new Date(now - 61 * 60 * 1000).toISOString(),
      }),
    ).toBe(false)
    expect(isPendingMediaItem({ id: "timestampless-pending-video", type: "video", status: "processing" })).toBe(false)
    expect(isPendingMediaItem({ id: "done-missing", type: "video", status: "done" })).toBe(false)
    expect(isPendingMediaItem({ id: "pending-ready", type: "video", status: "processing", outputUrl: "https://example.com/x.mp4" })).toBe(
      false,
    )
  })
})
