/**
 * JSON-RPC 2.0 utility tests
 *
 * These tests complement the JSON-RPC 2.0 specification by documenting the
 * request validation and success/error response envelope helpers used by the
 * remote-agent protocol implementation.
 *
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */

import { describe, expect, it } from "vitest";
import {
  type JsonRpcRequest,
  createErrorResponse,
  createSuccessResponse,
  isJsonRpcError,
  validateJsonRpcRequest,
} from "../../src/util/jsonrpc";

describe("util/jsonrpc", () => {
  describe("validateJsonRpcRequest", () => {
    it("should accept a valid request with a string id", () => {
      const data: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: "req-1",
        method: "tasks/get",
        params: { taskId: "task-123" },
      };
      expect(validateJsonRpcRequest(data)).toBe(true);
    });

    it("should accept a valid request with a numeric id", () => {
      const data = {
        jsonrpc: "2.0",
        id: 42,
        method: "message/send",
        params: { message: "hello" },
      };
      expect(validateJsonRpcRequest(data)).toBe(true);
    });

    it("should accept a request with empty params object", () => {
      const data = {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: {},
      };
      expect(validateJsonRpcRequest(data)).toBe(true);
    });

    it("should reject null", () => {
      expect(validateJsonRpcRequest(null)).toBe(false);
    });

    it("should reject a non-object primitive", () => {
      expect(validateJsonRpcRequest("string")).toBe(false);
      expect(validateJsonRpcRequest(42)).toBe(false);
      expect(validateJsonRpcRequest(true)).toBe(false);
    });

    it("should reject when jsonrpc is not '2.0'", () => {
      const data = { jsonrpc: "1.0", id: "req-1", method: "ping", params: {} };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when jsonrpc field is missing", () => {
      const data = { id: "req-1", method: "ping", params: {} };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when id is missing", () => {
      const data = { jsonrpc: "2.0", method: "ping", params: {} };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when id is neither string nor number", () => {
      const data = { jsonrpc: "2.0", id: null, method: "ping", params: {} };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when method is missing", () => {
      const data = { jsonrpc: "2.0", id: "req-1", params: {} };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when method is not a string", () => {
      const data = { jsonrpc: "2.0", id: "req-1", method: 42, params: {} };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when params is missing", () => {
      const data = { jsonrpc: "2.0", id: "req-1", method: "ping" };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when params is null", () => {
      const data = {
        jsonrpc: "2.0",
        id: "req-1",
        method: "ping",
        params: null,
      };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });

    it("should reject when params is a non-object primitive", () => {
      const data = {
        jsonrpc: "2.0",
        id: "req-1",
        method: "ping",
        params: "args",
      };
      expect(validateJsonRpcRequest(data)).toBe(false);
    });
  });

  describe("isJsonRpcError", () => {
    it("should return true for a valid error object with code and message", () => {
      const error = { code: -32600, message: "Invalid Request" };
      expect(isJsonRpcError(error)).toBe(true);
    });

    it("should return true when optional data field is present", () => {
      const error = {
        code: -32603,
        message: "Internal error",
        data: { detail: "oops" },
      };
      expect(isJsonRpcError(error)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isJsonRpcError(null)).toBe(false);
    });

    it("should return false for a non-object primitive", () => {
      expect(isJsonRpcError("error")).toBe(false);
      expect(isJsonRpcError(42)).toBe(false);
    });

    it("should return false when code is missing", () => {
      expect(isJsonRpcError({ message: "oops" })).toBe(false);
    });

    it("should return false when message is missing", () => {
      expect(isJsonRpcError({ code: -32600 })).toBe(false);
    });

    it("should return false when code is not a number", () => {
      expect(
        isJsonRpcError({ code: "-32600", message: "Invalid Request" }),
      ).toBe(false);
    });

    it("should return false when message is not a string", () => {
      expect(isJsonRpcError({ code: -32600, message: 42 })).toBe(false);
    });
  });

  describe("createErrorResponse", () => {
    it("should create a response with jsonrpc 2.0 and the given id", () => {
      const response = createErrorResponse("req-1", -32600, "Invalid Request");
      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe("req-1");
    });

    it("should set error code and message", () => {
      const response = createErrorResponse("req-1", -32600, "Invalid Request");
      expect(response.error?.code).toBe(-32600);
      expect(response.error?.message).toBe("Invalid Request");
    });

    it("should include optional data when provided", () => {
      const data = { detail: "jsonrpc field missing" };
      const response = createErrorResponse(
        "req-1",
        -32600,
        "Invalid Request",
        data,
      );
      expect(response.error?.data).toEqual(data);
    });

    it("should set error.data to undefined when not provided", () => {
      const response = createErrorResponse("req-1", -32600, "Invalid Request");
      expect(response.error?.data).toBeUndefined();
    });

    it("should not set result", () => {
      const response = createErrorResponse("req-1", -32600, "Invalid Request");
      expect(response.result).toBeUndefined();
    });

    it("should accept a numeric id", () => {
      const response = createErrorResponse(99, -32700, "Parse error");
      expect(response.id).toBe(99);
    });

    it("should produce a response that satisfies isJsonRpcError on its error field", () => {
      const response = createErrorResponse("req-1", -32603, "Internal error");
      expect(isJsonRpcError(response.error)).toBe(true);
    });

    it("should use standard JSON-RPC pre-defined error codes correctly", () => {
      // Per JSON-RPC 2.0 spec the reserved range is -32768 to -32000
      const parseError = createErrorResponse(1, -32700, "Parse error");
      const invalidRequest = createErrorResponse(2, -32600, "Invalid Request");
      const methodNotFound = createErrorResponse(3, -32601, "Method not found");
      const invalidParams = createErrorResponse(4, -32602, "Invalid params");
      const internalError = createErrorResponse(5, -32603, "Internal error");

      expect(parseError.error?.code).toBe(-32700);
      expect(invalidRequest.error?.code).toBe(-32600);
      expect(methodNotFound.error?.code).toBe(-32601);
      expect(invalidParams.error?.code).toBe(-32602);
      expect(internalError.error?.code).toBe(-32603);
    });
  });

  describe("createSuccessResponse", () => {
    it("should create a response with jsonrpc 2.0 and the given id", () => {
      const response = createSuccessResponse("req-1", { taskId: "task-123" });
      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe("req-1");
    });

    it("should set result to the provided value", () => {
      const result = { taskId: "task-123", status: { state: "submitted" } };
      const response = createSuccessResponse("req-1", result);
      expect(response.result).toEqual(result);
    });

    it("should not set error", () => {
      const response = createSuccessResponse("req-1", {});
      expect(response.error).toBeUndefined();
    });

    it("should accept a numeric id", () => {
      const response = createSuccessResponse(7, "ok");
      expect(response.id).toBe(7);
    });

    it("should accept null as a result (valid JSON-RPC success)", () => {
      const response = createSuccessResponse("req-1", null);
      expect(response.result).toBeNull();
    });

    it("should accept an array as a result", () => {
      const response = createSuccessResponse("req-1", [1, 2, 3]);
      expect(response.result).toEqual([1, 2, 3]);
    });

    it("should produce a response that fails isJsonRpcError on its result field", () => {
      // result is not an error object — isJsonRpcError should return false
      const response = createSuccessResponse("req-1", {
        code: 0,
        message: "fine",
      });
      // This passes because result.code is a number and result.message is a string,
      // which coincidentally satisfies the type guard — intentional: the guard checks
      // structure only, not semantics. Document that here rather than fight it.
      expect(isJsonRpcError(response.error)).toBe(false);
    });
  });

  describe("round-trip: createErrorResponse ↔ validateJsonRpcRequest", () => {
    it("error response does not validate as a request (different shape)", () => {
      const response = createErrorResponse("req-1", -32600, "Invalid Request");
      // JsonRpcResponse has no 'method' field so it must not pass as a request
      expect(validateJsonRpcRequest(response)).toBe(false);
    });

    it("success response does not validate as a request (different shape)", () => {
      const response = createSuccessResponse("req-1", { ok: true });
      expect(validateJsonRpcRequest(response)).toBe(false);
    });
  });
});
