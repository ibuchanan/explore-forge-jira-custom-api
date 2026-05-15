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
