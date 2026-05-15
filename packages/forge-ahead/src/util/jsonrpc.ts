/**
 * JSON-RPC 2.0 Utilities
 *
 * Generic JSON-RPC 2.0 types and helpers for remote procedure calls.
 * These types are reusable across any JSON-RPC implementation.
 *
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */

/**
 * JSON-RPC 2.0 Request structure
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 Response structure
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Type guard to check if an error object is a valid JSON-RPC error
 * @param error - The error object to validate
 * @returns true if the error is a valid JSON-RPC error
 */
export function isJsonRpcError(
  error: unknown,
): error is JsonRpcResponse["error"] {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const obj = error as Record<string, unknown>;
  return typeof obj.code === "number" && typeof obj.message === "string";
}

/**
 * Validates incoming JSON-RPC request structure
 * @param data - The data to validate
 * @returns true if the data is a valid JSON-RPC request
 */
export function validateJsonRpcRequest(data: unknown): data is JsonRpcRequest {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;
  return (
    obj.jsonrpc === "2.0" &&
    (typeof obj.id === "string" || typeof obj.id === "number") &&
    typeof obj.method === "string" &&
    typeof obj.params === "object" &&
    obj.params !== null
  );
}

/**
 * Creates a JSON-RPC error response
 * @param id - The request ID to include in the response
 * @param code - The error code (negative integer per JSON-RPC spec)
 * @param message - The error message
 * @param data - Optional additional error data
 * @returns A JSON-RPC error response object
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

/**
 * Creates a JSON-RPC success response
 * @param id - The request ID to include in the response
 * @param result - The result value to return
 * @returns A JSON-RPC success response object
 */
export function createSuccessResponse(
  id: string | number,
  result: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}
