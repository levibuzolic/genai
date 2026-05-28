import { describe, expect, it } from "vitest"

import type { ItemsResponse } from "@/types/domain"

import { formatDuration, formatRange } from "./format"

function itemsResponse(overrides: Partial<ItemsResponse>): ItemsResponse {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 48,
    pageCount: 1,
    facets: {},
    ...overrides,
  }
}

describe("formatRange", () => {
  it("formats empty and paginated ranges without exceeding the total", () => {
    expect(formatRange(itemsResponse({ total: 0 }))).toBe("0")
    expect(formatRange(itemsResponse({ total: 120, page: 3, pageSize: 48 }))).toBe("97-120")
  })
})

describe("formatDuration", () => {
  it("rounds to whole seconds before splitting minutes and seconds", () => {
    expect(formatDuration(65.4)).toBe("1:05")
    expect(formatDuration(59.6)).toBe("1:00")
  })
})
