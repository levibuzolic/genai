import * as React from "react"

export function usePreventIosViewportZoom(): void {
  React.useEffect(() => {
    if (!isIosLikeBrowser()) return

    const preventGestureDefault = (event: Event) => {
      event.preventDefault()
    }
    const preventMultiTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault()
      }
    }

    document.addEventListener("gesturestart", preventGestureDefault, { passive: false })
    document.addEventListener("gesturechange", preventGestureDefault, { passive: false })
    document.addEventListener("gestureend", preventGestureDefault, { passive: false })
    document.addEventListener("touchmove", preventMultiTouchMove, { passive: false })

    return () => {
      document.removeEventListener("gesturestart", preventGestureDefault)
      document.removeEventListener("gesturechange", preventGestureDefault)
      document.removeEventListener("gestureend", preventGestureDefault)
      document.removeEventListener("touchmove", preventMultiTouchMove)
    }
  }, [])
}

function isIosLikeBrowser(): boolean {
  const userAgent = window.navigator.userAgent
  const platform = window.navigator.platform
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && window.navigator.maxTouchPoints > 1)
}
