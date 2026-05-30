import { describe, expect, it } from "vitest"

import { isTextEntryTarget } from "./keyboard"

describe("isTextEntryTarget", () => {
  it("detects text entry controls", () => {
    const input = document.createElement("input")
    input.type = "text"
    const textarea = document.createElement("textarea")
    const select = document.createElement("select")

    expect(isTextEntryTarget(input)).toBe(true)
    expect(isTextEntryTarget(textarea)).toBe(true)
    expect(isTextEntryTarget(select)).toBe(true)
  })

  it("ignores non-text controls", () => {
    const button = document.createElement("button")
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"

    expect(isTextEntryTarget(button)).toBe(false)
    expect(isTextEntryTarget(checkbox)).toBe(false)
  })

  it("detects contenteditable targets", () => {
    const editor = document.createElement("div")
    editor.setAttribute("contenteditable", "true")
    const child = document.createElement("span")
    editor.append(child)

    expect(isTextEntryTarget(child)).toBe(true)
  })
})
