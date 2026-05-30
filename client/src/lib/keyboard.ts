const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"])

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  if (target instanceof HTMLElement && target.isContentEditable) return true

  const editableAncestor = target.closest("[contenteditable]:not([contenteditable='false'])")
  if (editableAncestor) return true

  const control = target.closest("input, select, textarea")
  if (!control) return false

  if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) return true
  if (!(control instanceof HTMLInputElement)) return false

  return !NON_TEXT_INPUT_TYPES.has(control.type)
}
