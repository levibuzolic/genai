import { afterEach, describe, expect, it, vi } from "vitest"

import { copyTextToClipboard } from "./clipboard"

const originalClipboard = navigator.clipboard
const originalExecCommand = document.execCommand
const originalPlatform = navigator.platform
const originalUserAgent = navigator.userAgent
const originalMaxTouchPoints = navigator.maxTouchPoints

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  })
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: originalPlatform,
  })
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: originalUserAgent,
  })
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: originalMaxTouchPoints,
  })
  document.execCommand = originalExecCommand
  vi.restoreAllMocks()
})

describe("copyTextToClipboard", () => {
  it("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    await copyTextToClipboard("copy me")

    expect(writeText).toHaveBeenCalledWith("copy me")
  })

  it("falls back to execCommand when the Clipboard API is unavailable", async () => {
    const execCommand = vi.fn<(command: string) => boolean>(() => true)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    document.execCommand = execCommand

    await copyTextToClipboard("fallback text")

    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(document.querySelector("textarea")).toBeNull()
  })

  it("falls back to execCommand when Clipboard API writes are blocked", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => {
      throw new Error("denied")
    })
    const execCommand = vi.fn<(command: string) => boolean>(() => true)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    document.execCommand = execCommand

    await copyTextToClipboard("blocked text")

    expect(writeText).toHaveBeenCalledWith("blocked text")
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("uses the synchronous copy path first on iOS to keep user activation", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined)
    const execCommand = vi.fn<(command: string) => boolean>(() => true)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    })
    document.execCommand = execCommand

    await copyTextToClipboard("ios text")

    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(writeText).not.toHaveBeenCalled()
  })

  it("still tries Clipboard API on iPadOS when synchronous copy is unavailable", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    })
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    })
    document.execCommand = vi.fn<(command: string) => boolean>(() => false)

    await copyTextToClipboard("ipad text")

    expect(writeText).toHaveBeenCalledWith("ipad text")
  })

  it("surfaces a clear error when all clipboard paths are blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    document.execCommand = vi.fn<(command: string) => boolean>(() => false)

    await expect(copyTextToClipboard("blocked text")).rejects.toThrow("Clipboard copy was blocked")
  })
})
