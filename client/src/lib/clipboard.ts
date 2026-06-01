function fallbackCopyTextToClipboard(value: string): void {
  if (!document.body) throw new Error("Clipboard copy is unavailable")

  const textarea = document.createElement("textarea")
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

  textarea.value = value
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  textarea.style.opacity = "0"
  textarea.style.fontSize = "16px"

  document.body.append(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)

    if (!document.execCommand("copy")) throw new Error("Clipboard copy was blocked")
  } finally {
    textarea.remove()
    activeElement?.focus()
  }
}

export async function copyTextToClipboard(value: string): Promise<void> {
  if (shouldUseSynchronousClipboardFirst()) {
    try {
      fallbackCopyTextToClipboard(value)
      return
    } catch (fallbackError) {
      const clipboard = navigator.clipboard
      if (clipboard?.writeText) {
        try {
          await clipboard.writeText(value)
          return
        } catch {
          throw fallbackError
        }
      }
      throw fallbackError
    }
  }

  const clipboard = navigator.clipboard
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value)
      return
    } catch {
      // Fall through to the synchronous copy path for browsers that expose the
      // Clipboard API but reject it outside stricter permission contexts.
    }
  }

  fallbackCopyTextToClipboard(value)
}

function shouldUseSynchronousClipboardFirst(): boolean {
  const platform = navigator.platform || ""
  const userAgent = navigator.userAgent || ""
  const maxTouchPoints = navigator.maxTouchPoints || 0

  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)
}
