import { CREATE_ACTIVE_STATUSES, CREATE_TERMINAL_STATUSES } from "./create-constants.ts"
import { isRecord } from "./refinements.ts"
import type { CreateSource } from "./types.ts"

export function getReusableCreationSource(source: unknown): CreateSource | null {
  if (!isRecord(source)) {
    return null
  }

  const kind = typeof source["kind"] === "string" ? source["kind"] : ""
  if (!kind) {
    return null
  }

  if (source["kind"] === "catalog" && source["itemId"]) {
    return {
      kind: "catalog",
      itemId: String(source["itemId"]),
    }
  }

  if (source["kind"] === "url" && source["url"]) {
    return {
      kind: "url",
      url: String(source["url"]),
    }
  }

  return {
    kind,
  }
}

export function isTerminalCreationStatus(status: unknown): boolean {
  return CREATE_TERMINAL_STATUSES.has(String(status || "").toLowerCase())
}

export function isActiveCreationStatus(status: unknown): boolean {
  const normalized = String(status || "").toLowerCase()
  return CREATE_ACTIVE_STATUSES.has(normalized) || (!isTerminalCreationStatus(normalized) && normalized !== "draft")
}

export function assertCreateTextAllowed(value: unknown, _label = "Text"): void {
  if (!value) {
    return
  }
}
