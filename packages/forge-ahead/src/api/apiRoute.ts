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
 * import { type ApiRouteRequest, type ApiRouteResponse, problemJson, json } from "forge-ahead/api";
 *
 * export async function handleFoo(req: ApiRouteRequest): Promise<ApiRouteResponse> {
 *   logApiRouteRequest(req, "foo");
 *   // ... handler logic
 *   return json(200, { result: "ok" });
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
 * Shape of a Forge App REST API response.
 *
 * Alias of {@link HttpResponse} — returned from `apiRoute` handler functions
 * to set the HTTP response. Note that response `headers` are single-value
 * ({@link HttpResponseHeaders}), unlike request headers which are multi-value.
 */
export type ApiRouteResponse = HttpResponse;

/**
 * Build a JSON response with the given status code and body.
 *
 * Sets `Content-Type: application/json` automatically.
 *
 * @param statusCode - HTTP status code (e.g. 200, 201, 400)
 * @param body - Any JSON-serializable value
 */
export function json(statusCode: number, body: JSONValue): ApiRouteResponse {
  return {
    statusCode,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(body),
  };
}

/**
 * Build an RFC 9457 Problem Details JSON response.
 *
 * Looks up the standard error title for the given status code and produces
 * a {@link ProblemDetails} body with `type`, `title`, `status`, `detail`,
 * and `timestamp`.
 *
 * @param statusCode - HTTP status code (e.g. 400, 500)
 * @param detail - Human-readable explanation specific to this occurrence
 *
 * @example
 * ```typescript
 * return problemJson(400, "Request body must be valid JSON");
 * // → { type: "https://httpstatuses.io/400", title: "Bad Request",
 * //     status: 400, detail: "...", timestamp: "..." }
 * ```
 */
export function problemJson(
  statusCode: number,
  detail: string,
): ApiRouteResponse {
  const error = StandardError.getOrDefault(statusCode);
  const problem: ProblemDetails = {
    type: error.type,
    title: error.title,
    status: error.status,
    detail,
    timestamp: new Date().toISOString(),
  };
  return json(statusCode, problem as unknown as JSONValue);
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
