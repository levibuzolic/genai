import type { AppError } from "./types.ts"

export function httpError(message: string, statusCode: number): AppError {
  return Object.assign(new Error(message), { statusCode })
}

export function getErrorStatusCode(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("statusCode" in error)) {
    return undefined
  }

  return typeof error.statusCode === "number" ? error.statusCode : undefined
}
