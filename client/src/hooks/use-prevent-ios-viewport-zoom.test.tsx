import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { usePreventIosViewportZoom } from "./use-prevent-ios-viewport-zoom"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setNavigatorValue("userAgent", "Mozilla/5.0")
  setNavigatorValue("platform", "MacIntel")
  setNavigatorValue("maxTouchPoints", 0)
})

describe("usePreventIosViewportZoom", () => {
  it("prevents iOS pinch gesture events", () => {
    setNavigatorValue("userAgent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")
    renderHook(() => usePreventIosViewportZoom())

    const event = new Event("gesturestart", { cancelable: true })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it("prevents multi-touch movement on iPadOS without blocking single-touch movement", () => {
    setNavigatorValue("platform", "MacIntel")
    setNavigatorValue("maxTouchPoints", 5)
    renderHook(() => usePreventIosViewportZoom())

    const singleTouch = touchMoveEvent(1)
    const multiTouch = touchMoveEvent(2)
    document.dispatchEvent(singleTouch)
    document.dispatchEvent(multiTouch)

    expect(singleTouch.defaultPrevented).toBe(false)
    expect(multiTouch.defaultPrevented).toBe(true)
  })
})

function touchMoveEvent(touchCount: number): TouchEvent {
  const event = new Event("touchmove", { cancelable: true }) as TouchEvent
  Object.defineProperty(event, "touches", {
    configurable: true,
    value: Array.from({ length: touchCount }, () => ({})),
  })
  return event
}

function setNavigatorValue(key: keyof Navigator, value: unknown): void {
  Object.defineProperty(window.navigator, key, {
    configurable: true,
    value,
  })
}
