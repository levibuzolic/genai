import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchJson } from "./api"

describe("fetchJson", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("announces final auth failures as toast events", async () => {
    const messages: string[] = []
    const onToast = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.message === "string") {
        messages.push(event.detail.message)
      }
    }
    window.addEventListener("genai:toast", onToast)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "API returned 401 after token refresh." }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      }),
    )

    try {
      await expect(fetchJson("/api/test")).rejects.toThrow("API returned 401 after token refresh.")
      expect(messages).toEqual(["API returned 401 after token refresh."])
    } finally {
      window.removeEventListener("genai:toast", onToast)
    }
  })
})
