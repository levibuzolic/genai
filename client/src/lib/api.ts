export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const data = await response.json()

  if (!response.ok) {
    const message = data.error || `Request failed: ${response.status}`
    if (response.status === 401 || response.status === 403) {
      dispatchToast(message)
    }
    throw new Error(message)
  }

  return data
}

function dispatchToast(message: string): void {
  window.dispatchEvent(
    new CustomEvent("genai:toast", {
      detail: {
        message,
      },
    }),
  )
}
