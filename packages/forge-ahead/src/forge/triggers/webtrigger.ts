/**
 * WebTrigger Module
 *
 * This module provides types and utilities for building WebTrigger handlers in Forge.
 * WebTriggers allow you to expose HTTP endpoints that can be called from outside your app.
 *
 * Key Features:
 * - Type-safe request/response handling
 * - RFC 9457 compliant error responses
 * - Header extraction utilities
 * - Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH)
 *
 * @see https://developer.atlassian.com/platform/forge/events-reference/web-trigger/
 */

import type { WebTriggerMethod } from "@forge/api";
import type { ProblemDetails } from "../../util/errors";
import type { CommonEvent, InstallContext } from "../function";

// Note: We define our own WebtriggerEvent and WebtriggerResponse types instead of using
// the types from @forge/api because our types are more complete:
// - WebtriggerEvent extends CommonEvent to include context and contextToken
// - WebtriggerResponse enforces all required fields (official types make them optional)
// - We capture the undocumented "call" field that appears in real events
// For reference, see @forge/api types: WebTriggerRequest, WebTriggerResponse

/**
 * HTTP headers as provided by the Forge platform
 *
 * Headers are stored as Record<string, string[]> where each header name maps
 * to an array of values. This allows multiple values for the same header.
 *
 * @example
 * ```typescript
 * const headers: Headers = {
 *   "content-type": ["application/json"],
 *   "user-agent": ["Mozilla/5.0..."],
 *   "set-cookie": ["session=abc", "tracking=xyz"]
 * };
 * ```
 */
export type Headers = Record<string, string[]>;

/**
 * Query parameters as provided by the Forge platform
 *
 * Query parameters are stored as Record<string, string[]> where each parameter
 * name maps to an array of values. This supports multiple values for the same parameter.
 *
 * @example
 * ```typescript
 * // URL: /webhook?tag=urgent&tag=bug&name=alice
 * const params: Parameters = {
 *   "tag": ["urgent", "bug"],
 *   "name": ["alice"]
 * };
 * ```
 */
export type Parameters = Record<string, string[]>;
/**
 * WebTrigger request event
 *
 * This interface represents an incoming HTTP request to a WebTrigger endpoint.
 * It extends CommonEvent to include Forge context and adds HTTP-specific properties.
 *
 * All WebTrigger handlers receive this event as their first parameter.
 *
 * @see https://developer.atlassian.com/platform/forge/events-reference/web-trigger/#request
 *
 * @example
 * ```typescript
 * export const handler: WebtriggerFunction = (request, context) => {
 *   console.log(`${request.method} ${request.path}`);
 *   const name = request.queryParameters.name?.[0];
 *   const body = request.body ? JSON.parse(request.body) : null;
 *
 *   return buildSuccessResponse({ name, body });
 * };
 * ```
 */
export interface WebtriggerEvent extends CommonEvent {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) */
  method: WebTriggerMethod;

  /** HTTP headers from the request (header names are lowercase) */
  headers: Headers;

  /** Query parameters from the URL (?key=value) */
  queryParameters: Parameters;

  /** Request body as a string (parse as JSON if needed) */
  body?: string;

  /** Request path (e.g., "/webhook" or "/api/v1/resource") */
  path: string;

  /**
   * Undocumented field that appears in real events
   * Contains the function key that was invoked
   */
  call?: { functionKey: string };
}

/**
 * WebTrigger response object
 *
 * This interface represents the HTTP response your WebTrigger handler returns.
 * All fields are required except body, which can be omitted for 204 No Content responses.
 *
 * The Forge platform recognizes:
 * - Status code 204 as success (no content)
 * - Status codes in the 500 series as errors
 * - All other 2xx codes as success
 *
 * @see https://developer.atlassian.com/platform/forge/events-reference/web-trigger/#response
 *
 * @example
 * ```typescript
 * // Success response
 * const response: WebtriggerResponse = {
 *   body: JSON.stringify({ message: "OK" }),
 *   headers: { "Content-Type": ["application/json"] },
 *   statusCode: 200,
 *   statusText: "OK"
 * };
 *
 * // No content response
 * const response: WebtriggerResponse = {
 *   headers: {},
 *   statusCode: 204,
 *   statusText: "No Content"
 * };
 * ```
 */
export interface WebtriggerResponse {
  /** HTTP response body sent back to the caller (typically JSON string) */
  body?: string;

  /** HTTP headers to send back to the caller */
  headers: Headers;

  /** HTTP status code (200, 201, 400, 404, 500, etc.) */
  statusCode: number;

  /** HTTP status text that provides context to the status code */
  statusText: string;
}

/**
 * Extract client-relevant headers from a WebTrigger request
 *
 * Filters the request headers to include only those relevant to the client/request,
 * excluding infrastructure and server headers. This is useful for logging, tracing,
 * and forwarding requests while maintaining request context.
 *
 * Extracted headers:
 * - `user-agent`: Client software making the request
 * - `atl-traceid`: Unique Atlassian trace ID for this request (use for distributed tracing)
 * - `atl-edge-true-client-ip`: Originating client IP address
 * - `atl-edge-ip-tags`: IP classification tags (e.g., enterprise, residential)
 *
 * Excluded headers (infrastructure):
 * - host, content-type, content-length
 * - x-forwarded-*, x-amzn-*
 * - All other server/infrastructure headers
 *
 * @param request - The WebTrigger request event
 * @returns Headers object containing only client-relevant headers
 *
 * @example
 * ```typescript
 * export const handler: WebtriggerFunction = (request, context) => {
 *   const clientHeaders = extractClientHeaders(request);
 *   const traceId = clientHeaders["atl-traceid"]?.[0] || "unknown";
 *
 *   console.log(`[${traceId}] Request from ${clientHeaders["user-agent"]?.[0]}`);
 *
 *   return buildSuccessResponse({ traceId });
 * };
 * ```
 */
export function extractClientHeaders(request: WebtriggerEvent): Headers {
  const clientHeaders = [
    "user-agent",
    "atl-traceid",
    "atl-edge-true-client-ip",
    "atl-edge-ip-tags",
  ];
  return Object.fromEntries(
    Object.entries(request.headers).filter(([key, _]) =>
      clientHeaders.includes(key),
    ),
  );
}

/**
 * Build a successful WebtriggerResponse
 *
 * @param message - Response body object (default: { message: "OK" })
 * @param statusCode - HTTP status code (default: 200)
 * @param statusText - HTTP status text (default: "OK")
 * @returns WebtriggerResponse with JSON-encoded body
 *
 * @example
 * ```typescript
 * return buildSuccessResponse({ data: { id: "123", name: "Test" } });
 * return buildSuccessResponse({ data: results }, 201, "Created");
 * ```
 */
export function buildSuccessResponse(
  message: object = { message: "OK" },
  statusCode: number = 200,
  statusText: string = "OK",
): WebtriggerResponse {
  return {
    body: JSON.stringify(message),
    headers: { "Content-Type": ["application/json"] },
    statusCode,
    statusText,
  };
}

/**
 * Build an error WebtriggerResponse from RFC 9457 ProblemDetails
 *
 * Creates a properly formatted error response using the ProblemDetails object.
 * The HTTP status code and text are derived from the error details.
 *
 * @param error - ProblemDetails error object containing status and details
 * @returns WebtriggerResponse with error status code and ProblemDetails body
 *
 * @example
 * ```typescript
 * const error = StandardError.getOrDefault(404).error("Resource not found");
 * if (error.isErr()) {
 *   return buildErrorResponse(error.error);
 * }
 * ```
 */
export function buildErrorResponse(error: ProblemDetails): WebtriggerResponse {
  return {
    body: JSON.stringify(error),
    headers: { "Content-Type": ["application/json"] },
    statusCode: error.status,
    statusText: error.title,
  };
}

/**
 * WebTrigger handler function type
 *
 * This is the type signature for all WebTrigger handlers. Handlers can be
 * synchronous or asynchronous (return Promise<WebtriggerResponse>).
 *
 * All WebTrigger handlers receive:
 * - `request`: The incoming HTTP request with method, headers, body, etc.
 * - `context`: Forge installation context with cloudId, moduleKey, etc.
 *
 * Handlers must return a WebtriggerResponse with statusCode, statusText, headers,
 * and optionally a body.
 *
 * @param request - The incoming WebTrigger request event
 * @param context - The Forge installation context
 * @returns WebtriggerResponse or Promise<WebtriggerResponse>
 *
 * @example
 * ```typescript
 * // Synchronous handler
 * export const syncHandler: WebtriggerFunction = (request, context) => {
 *   return buildSuccessResponse({ message: "Hello" });
 * };
 *
 * // Asynchronous handler
 * export const asyncHandler: WebtriggerFunction = async (request, context) => {
 *   const data = await fetchData();
 *   return buildSuccessResponse(data);
 * };
 *
 * // With error handling
 * export const handler: WebtriggerFunction = (request, context) => {
 *   if (!request.queryParameters.id) {
 *     return buildErrorResponse(
 *       StandardError.getOrDefault(416).error("Missing id parameter").error
 *     );
 *   }
 *   return buildSuccessResponse({ id: request.queryParameters.id[0] });
 * };
 * ```
 */
export type WebtriggerFunction = (
  request: WebtriggerEvent,
  context: InstallContext,
) => WebtriggerResponse | Promise<WebtriggerResponse>;
