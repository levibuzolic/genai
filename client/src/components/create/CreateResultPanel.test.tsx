import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreateResultPanel } from "./CreateResultPanel"

afterEach(() => {
  cleanup()
})

describe("CreateResultPanel", () => {
  it("keeps result actions disabled until a completed image output is available", () => {
    render(
      <CreateResultPanel
        sourceFallback="No source"
        result={{ id: "job-1", status: "pending", outputUrl: "https://example.com/result.png" }}
        onDownload={vi.fn<() => Promise<void>>()}
        onAnimate={vi.fn<() => void>()}
      />,
    )

    expect(screen.getByRole<HTMLButtonElement>("button", { name: /download to library/i }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /animate this/i }).disabled).toBe(false)
  })

  it("enables download for completed outputs but only animates image outputs", () => {
    const onDownload = vi.fn<() => Promise<void>>(async () => undefined)
    const onAnimate = vi.fn<() => void>()
    render(
      <CreateResultPanel
        sourcePreviewUrl="https://example.com/source.png"
        sourceLabel="Source image"
        sourceFallback="No source"
        result={{ id: "job-2", type: "video", status: "done", outputUrl: "https://example.com/result.mp4", duration: 4 }}
        onDownload={onDownload}
        onAnimate={onAnimate}
      />,
    )

    expect(screen.getByRole<HTMLButtonElement>("button", { name: /download to library/i }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /animate this/i }).disabled).toBe(true)
    expect(document.body.contains(screen.getByText("job-2"))).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: /download to library/i }))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })
})
