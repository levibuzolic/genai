import type http from "node:http"

export type { AppDomainResponse, AppRouteRequest, AppRouteResponse } from "../types/routes.ts"
export type * from "../types/domain.ts"

export type HttpRequest = http.IncomingMessage
export type HttpResponse = http.ServerResponse

export type AppError = Error & {
  statusCode?: number
}
