/**
 * Core HTTP primitives for Forge handlers.
 *
 * These types model the fundamental HTTP concepts — headers, parameters,
 * requests, and responses — that underpin multiple Forge module types
 * (apiRoute, webtrigger, etc.).
 *
 * Forge-specific module types (e.g. {@link WebtriggerResponse},
 * {@link ApiRouteRequest}) are type aliases or extensions of these primitives,
 * keeping the platform contract thin and the core reusable.
 */

/**
 * Standard HTTP methods supported by Forge module handlers.
 *
 * Matches `WebTriggerMethod` from `@forge/api` but defined here to avoid
 * a dependency on that package in the util layer.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * HTTP headers as a multi-value map.
 *
 * Follows the HTTP specification where a single header name may have multiple
 * values. Used in both incoming request headers and outgoing response headers
 * across Forge module types.
 *
 * @example
 * ```typescript
 * const headers: Headers = {
 *   "content-type": ["application/json"],
 *   "accept": ["application/json", "text/plain"],
 * };
 * ```
 */
export type Headers = Record<string, string[]>;

/**
 * HTTP query parameters as a multi-value map.
 *
 * A single parameter name may appear multiple times in a query string,
 * producing multiple values (e.g. `?tag=a&tag=b` → `{ tag: ["a", "b"] }`).
 *
 * @example
 * ```typescript
 * const params: QueryParameters = {
 *   tag: ["bug", "feature"],
 *   page: ["1"],
 * };
 * ```
 */
export type QueryParameters = Record<string, string[]>;

/**
 * An inbound HTTP request.
 *
 * Base shape shared by Forge module types that receive HTTP requests
 * (e.g. `apiRoute`, `webtrigger`). All fields are optional because
 * Forge may omit fields that are not applicable to a given invocation.
 */
export interface HttpRequest {
  /** HTTP method (e.g. `"GET"`, `"POST"`). */
  method?: HttpMethod;
  /** Request path (e.g. `"/workitem"`). */
  path?: string;
  /** Raw request body as a string. */
  body?: string;
  /** Inbound request headers (multi-value). */
  headers?: Headers;
  /** Parsed query string parameters (multi-value). */
  queryParameters?: QueryParameters;
}

/**
 * Atlassian-specific request headers that are safe to extract and log.
 *
 * These headers carry client/tracing context without exposing credentials.
 * Used by {@link extractClientHeaders} to filter inbound request headers.
 */
const CLIENT_HEADERS = [
  "user-agent",
  "atl-traceid",
  "atl-edge-true-client-ip",
  "atl-edge-ip-tags",
] as const;

/**
 * Extract client-relevant headers from an inbound HTTP request.
 *
 * Filters the request headers to only those that carry client or tracing
 * context (user-agent, Atlassian trace ID, client IP). Infrastructure and
 * credential headers (Authorization, x-forwarded-*, etc.) are excluded.
 *
 * Useful for safe logging and distributed tracing across both `apiRoute`
 * and `webtrigger` handlers.
 *
 * @param request - Any {@link HttpRequest} (ApiRouteRequest or WebtriggerEvent)
 * @returns A {@link Headers} object containing only client-relevant headers
 *
 * @example
 * ```typescript
 * const clientHeaders = extractClientHeaders(req);
 * const traceId = clientHeaders["atl-traceid"]?.[0] ?? "unknown";
 * console.debug(`[${traceId}] Handling request`);
 * ```
 */
export function extractClientHeaders(request: HttpRequest): Headers {
  return Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(([key]) =>
      (CLIENT_HEADERS as readonly string[]).includes(key),
    ),
  );
}

/**
 * An outbound HTTP response.
 *
 * Base shape returned by Forge module handler functions that produce
 * HTTP responses (e.g. `apiRoute`, `webtrigger`).
 */
export interface HttpResponse {
  /** HTTP status code (e.g. `200`, `400`, `500`). */
  statusCode: number;
  /** Outbound response headers. */
  headers?: Headers;
  /** Serialised response body. */
  body?: string;
}
