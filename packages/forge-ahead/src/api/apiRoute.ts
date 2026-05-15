/**
 * Shared types and utilities for Forge App REST API (apiRoute) handlers.
 *
 * Provides the request/response interfaces and response-building helpers
 * that every `apiRoute` module handler needs, plus safe request logging
 * via {@link truncateEvents}.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 *
 * @example
 * ```typescript
 * import { type ApiRouteRequest, type ApiRouteResponse, buildSuccessResponse, buildErrorResponse } from "forge-ahead/api";
 *
 * export async function handleFoo(req: ApiRouteRequest): Promise<ApiRouteResponse> {
 *   logApiRouteRequest(req, "foo");
 *   // ... handler logic
 *   return buildSuccessResponse({ result: "ok" });
 * }
 * ```
 */

import { truncateEvents } from "../forge/logging";
import type { JSONValue } from "../forge/types";
import type { ProblemDetails } from "../util/errors";
import { StandardError } from "../util/errors";
import type { HttpRequest, HttpResponse } from "../util/http";

/**
 * Shape of an incoming Forge App REST API request.
 *
 * Alias of {@link HttpRequest} — matches the object Forge passes to
 * `apiRoute` handler functions.
 */
export type ApiRouteRequest = HttpRequest;

/**
 * Handler function type for Forge App REST API (`apiRoute`) endpoints.
 *
 * Matches the signature Forge expects: receives an {@link ApiRouteRequest}
 * and returns an {@link ApiRouteResponse} (or a Promise of one).
 *
 * @example
 * ```typescript
 * export const handler: ApiRouteFunction = async (req) => {
 *   logApiRouteRequest(req, "myRoute");
 *   return buildSuccessResponse({ result: "ok" });
 * };
 * ```
 */
export type ApiRouteFunction = (
  req: ApiRouteRequest,
) => ApiRouteResponse | Promise<ApiRouteResponse>;

/**
 * Shape of a Forge App REST API response.
 *
 * Alias of {@link HttpResponse} — returned from `apiRoute` handler functions
 * to set the HTTP response. Note that response `headers` are single-value
 * ({@link HttpResponseHeaders}), unlike request headers which are multi-value.
 */
export type ApiRouteResponse = HttpResponse;

/**
 * Build a JSON success response.
 *
 * Sets `Content-Type: application/json` automatically.
 *
 * @param message - Response body object (default: `{ message: "OK" }`)
 * @param statusCode - HTTP status code (default: `200`)
 * @returns {@link ApiRouteResponse} with a JSON-encoded body
 *
 * @example
 * ```typescript
 * return buildSuccessResponse({ data: results });
 * return buildSuccessResponse({ id: created.id }, 201);
 * ```
 */
export function buildSuccessResponse(
  message: object = { message: "OK" },
  statusCode: number = 200,
): ApiRouteResponse {
  return {
    statusCode,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(message),
  };
}

/**
 * Build an RFC 9457 Problem Details error response.
 *
 * Accepts either a pre-built {@link ProblemDetails} object or a raw
 * `(statusCode, detail)` pair. When called with a status code and detail
 * string, it looks up the standard error title and constructs the
 * Problem Details body automatically.
 *
 * @example
 * ```typescript
 * // From a ProblemDetails object (e.g. from StandardError)
 * return buildErrorResponse(StandardError.getOrDefault(404).error("Not found").error);
 *
 * // From a status code and detail string
 * return buildErrorResponse(400, "Request body must be valid JSON");
 * ```
 */
export function buildErrorResponse(error: ProblemDetails): ApiRouteResponse;
export function buildErrorResponse(
  statusCode: number,
  detail: string,
): ApiRouteResponse;
export function buildErrorResponse(
  errorOrCode: ProblemDetails | number,
  detail?: string,
): ApiRouteResponse {
  if (typeof errorOrCode === "number") {
    const std = StandardError.getOrDefault(errorOrCode);
    const problem: ProblemDetails = {
      type: std.type,
      title: std.title,
      status: std.status,
      detail: detail ?? "",
      timestamp: new Date().toISOString(),
    };
    return {
      statusCode: errorOrCode,
      headers: { "Content-Type": ["application/json"] },
      body: JSON.stringify(problem),
    };
  }
  return {
    statusCode: errorOrCode.status,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(errorOrCode),
  };
}

/**
 * Safely log an incoming `apiRoute` request at debug level.
 *
 * Uses {@link truncateEvents} to mask `headers` and any `contextToken`
 * fields before logging, preventing accidental credential leaks.
 *
 * @param req - The incoming `ApiRouteRequest`
 * @param label - Optional label prefix (e.g. the route name)
 *
 * @example
 * ```typescript
 * export async function handleFoo(req: ApiRouteRequest): Promise<ApiRouteResponse> {
 *   logApiRouteRequest(req, "foo");
 *   // Debug: foo request: {"method":"POST","path":"/foo","body":"..."}
 * }
 * ```
 */
export function logApiRouteRequest(req: ApiRouteRequest, label?: string): void {
  const prefix = label ? `${label} request` : "Request";
  console.debug(
    `${prefix}:`,
    JSON.stringify(truncateEvents(req as unknown as JSONValue)),
  );
}
