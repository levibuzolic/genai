import { afterEach, describe, expect, it, vi } from "vitest"

import { copyTextToClipboard } from "./clipboard"

const originalClipboard = navigator.clipboard
const originalExecCommand = document.execCommand

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
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

  it("surfaces a clear error when all clipboard paths are blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    document.execCommand = vi.fn<(command: string) => boolean>(() => false)

    await expect(copyTextToClipboard("blocked text")).rejects.toThrow("Clipboard copy was blocked")
  })
})
