import { describe, expect, it } from "vitest"

import { fileToDataUrl, getImageFileFromTransfer } from "./upload"

function transferWith(files: File[], items: Array<{ kind: string; type: string; getAsFile: () => File | null }> = []) {
  return { files, items } as unknown as DataTransfer
}

describe("upload helpers", () => {
  it("prefers image files from a transfer and ignores non-image files", () => {
    const text = new File(["hello"], "note.txt", { type: "text/plain" })
    const image = new File(["image"], "image.png", { type: "image/png" })

    expect(getImageFileFromTransfer(transferWith([text, image]))).toBe(image)
  })

  it("falls back to file items when the transfer file list is empty", () => {
    const image = new File(["image"], "pasted.webp", { type: "image/webp" })
    const result = getImageFileFromTransfer(transferWith([], [{ kind: "file", type: "image/webp", getAsFile: () => image }]))

    expect(result).toBe(image)
  })

  it("reads files as data URLs for API upload payloads", async () => {
    const dataUrl = await fileToDataUrl(new File(["hello"], "image.png", { type: "image/png" }))

    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })
})
