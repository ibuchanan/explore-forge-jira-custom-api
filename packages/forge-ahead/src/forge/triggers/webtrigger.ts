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

import type {
  WebTriggerMethod,
  WebTriggerRequest,
  WebTriggerResponse,
} from "@forge/api";
import type { ProblemDetails } from "../../util/errors";
import type { Headers, HttpRequest, QueryParameters } from "../../util/http";
import type { CommonEvent, InstallContext } from "../function";
import { truncateEvents } from "../logging";
import type { JSONValue } from "../types";

/**
 * WebTrigger request event
 *
 * This interface represents an incoming HTTP request to a WebTrigger endpoint.
 * It extends CommonEvent to include Forge context and Request for HTTP properties.
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
export interface WebtriggerEvent
  extends CommonEvent,
    HttpRequest,
    WebTriggerRequest {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) */
  method: WebTriggerMethod;

  /** Raw request body as a string. */
  body: string;

  /** Request path (e.g., "/webhook" or "/api/v1/resource") */
  path: string;

  /** HTTP headers from the request (header names are lowercase) */
  headers: Headers;

  /** Query parameters from the URL (?key=value) */
  queryParameters: QueryParameters;

  /**
   * Undocumented field that appears in real events
   * Contains the function key that was invoked
   */
  call?: { functionKey: string };
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
): WebTriggerResponse {
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
export function buildErrorResponse(error: ProblemDetails): WebTriggerResponse {
  return {
    body: JSON.stringify(error),
    headers: { "Content-Type": ["application/json"] },
    statusCode: error.status,
    statusText: error.title,
  };
}

/**
 * Safely log an incoming `webtrigger` request at debug level.
 *
 * Uses {@link truncateEvents} to mask `headers` and any `contextToken`
 * fields before logging, preventing accidental credential leaks.
 *
 * @param req - The incoming {@link WebtriggerEvent}
 * @param label - Optional label prefix (e.g. the trigger name)
 *
 * @example
 * ```typescript
 * export const handler: WebtriggerFunction = (request, context) => {
 *   logWebtriggerRequest(request, "myTrigger");
 *   // Debug: myTrigger request: {"method":"POST","path":"/...","body":"..."}
 *   return buildSuccessResponse();
 * };
 * ```
 */
export function logWebtriggerRequest(
  req: WebtriggerEvent,
  label?: string,
): void {
  const prefix = label ? `${label} request` : "Request";
  console.debug(
    `${prefix}:`,
    JSON.stringify(truncateEvents(req as unknown as JSONValue)),
  );
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
) => WebTriggerResponse | Promise<WebTriggerResponse>;
