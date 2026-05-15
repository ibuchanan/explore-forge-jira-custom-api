/**
 * Problem Details and standard error helper tests
 *
 * These tests specify the library's RFC 9457 Problem Details response shape and
 * shell exit-code mapping used by Forge and remote-agent helpers.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc9457|RFC 9457 Problem Details for HTTP APIs}
 * @see {@link https://nodejs.org/api/process.html#exit-codes|Node.js process exit codes}
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  type ProblemDetails,
  ShellExitCodes,
  StandardError,
} from "../../src/util/errors";

// Codes used only in tests — cleaned up after each test to prevent shared
// mutable state from leaking across the suite via StandardError.types.
const TEST_CODES = [9999, 9001, 9002, 9003, 8888, 7777, 6666];

describe("StandardError", () => {
  describe("constructor", () => {
    it("should create a StandardError with status and title", () => {
      const error = new StandardError(400, "Bad Request");
      expect(error.status).toBe(400);
      expect(error.title).toBe("Bad Request");
    });

    it("should handle different status codes", () => {
      const error404 = new StandardError(404, "Not Found");
      const error500 = new StandardError(500, "Internal Server Error");

      expect(error404.status).toBe(404);
      expect(error404.title).toBe("Not Found");
      expect(error500.status).toBe(500);
      expect(error500.title).toBe("Internal Server Error");
    });
  });

  describe("type getter", () => {
    it("should generate correct URI for status code", () => {
      const error = new StandardError(404, "Not Found");
      expect(error.type).toBe("https://httpstatuses.io/404");
    });

    it("should generate correct URI for different status codes", () => {
      const error400 = new StandardError(400, "Bad Request");
      const error500 = new StandardError(500, "Internal Server Error");

      expect(error400.type).toBe("https://httpstatuses.io/400");
      expect(error500.type).toBe("https://httpstatuses.io/500");
    });
  });

  describe("error() method", () => {
    it("should create ProblemDetails with all required fields", () => {
      const error = new StandardError(404, "Not Found");
      const result = error.error("Resource not found");

      expect(result.isErr()).toBe(true);
      const problemDetails = result.error;
      expect(problemDetails).toHaveProperty("type");
      expect(problemDetails).toHaveProperty("title");
      expect(problemDetails).toHaveProperty("status");
      expect(problemDetails).toHaveProperty("detail");
      expect(problemDetails).toHaveProperty("timestamp");
    });

    it("should populate ProblemDetails correctly with message only", () => {
      const error = new StandardError(404, "Not Found");
      const result = error.error("Resource not found");

      expect(result.isErr()).toBe(true);
      const problemDetails = result.error;
      expect(problemDetails.type).toBe("https://httpstatuses.io/404");
      expect(problemDetails.title).toBe("Not Found");
      expect(problemDetails.status).toBe(404);
      expect(problemDetails.detail).toBe("Resource not found");
      expect(problemDetails.instance).toBeUndefined();
    });

    it("should generate ISO timestamp when not provided", () => {
      const error = new StandardError(500, "Internal Server Error");
      const result = error.error("Something went wrong");

      expect(result.isErr()).toBe(true);
      expect(result.error.timestamp).toBeDefined();
      expect(typeof result.error.timestamp).toBe("string");
      expect(() => new Date(result.error.timestamp)).not.toThrow();
    });

    it("should use provided timestamp when given", () => {
      const error = new StandardError(400, "Bad Request");
      const customTimestamp = "2024-01-15T10:30:00.000Z";
      const result = error.error("Invalid input", customTimestamp);

      expect(result.isErr()).toBe(true);
      expect(result.error.timestamp).toBe(customTimestamp);
    });

    it("should include instance when provided", () => {
      const error = new StandardError(404, "Not Found");
      const result = error.error(
        "User not found",
        undefined,
        "https://api.example.com/users/123",
      );

      expect(result.isErr()).toBe(true);
      expect(result.error.instance).toBe("https://api.example.com/users/123");
    });

    it("should handle all parameters provided", () => {
      const error = new StandardError(403, "Forbidden");
      const timestamp = "2024-02-14T12:00:00.000Z";
      const instance = "https://api.example.com/resource";

      const result = error.error("Access denied", timestamp, instance);

      expect(result.isErr()).toBe(true);
      const problemDetails = result.error;
      expect(problemDetails.type).toBe("https://httpstatuses.io/403");
      expect(problemDetails.title).toBe("Forbidden");
      expect(problemDetails.status).toBe(403);
      expect(problemDetails.detail).toBe("Access denied");
      expect(problemDetails.timestamp).toBe(timestamp);
      expect(problemDetails.instance).toBe(instance);
    });

    it("should handle empty message", () => {
      const error = new StandardError(500, "Internal Server Error");
      const result = error.error("");

      expect(result.isErr()).toBe(true);
      expect(result.error.detail).toBe("");
    });
  });

  describe("static add() method", () => {
    afterEach(() => {
      // Remove any test-only codes so they don't leak into other tests
      // via the shared StandardError.types static Map.
      for (const code of TEST_CODES) {
        StandardError.types.delete(code);
      }
    });

    it("should add error type to static types map", () => {
      const initialSize = StandardError.types.size;
      StandardError.add(9999, "Test Error");

      const retrieved = StandardError.types.get(9999);
      expect(retrieved).toBeDefined();
      expect(retrieved?.status).toBe(9999);
      expect(retrieved?.title).toBe("Test Error");
      expect(StandardError.types.size).toBe(initialSize + 1);
    });

    it("should add multiple error types", () => {
      const initialSize = StandardError.types.size;
      StandardError.add(9001, "Test 1");
      StandardError.add(9002, "Test 2");
      StandardError.add(9003, "Test 3");

      expect(StandardError.types.get(9001)?.title).toBe("Test 1");
      expect(StandardError.types.get(9002)?.title).toBe("Test 2");
      expect(StandardError.types.get(9003)?.title).toBe("Test 3");
      expect(StandardError.types.size).toBe(initialSize + 3);
    });

    it("should overwrite existing error type with same status", () => {
      const testStatus = 9999;
      StandardError.add(testStatus, "Original");
      const sizeAfterFirst = StandardError.types.size;
      StandardError.add(testStatus, "Updated");

      const retrieved = StandardError.types.get(testStatus);
      expect(retrieved?.title).toBe("Updated");
      // Size should not change since we're replacing, not adding
      expect(StandardError.types.size).toBe(sizeAfterFirst);
    });

    it("should create StandardError instances in the map", () => {
      StandardError.add(500, "Internal Server Error");

      const retrieved = StandardError.types.get(500);
      expect(retrieved).toBeInstanceOf(StandardError);
    });
  });

  describe("pre-registered error types", () => {
    it("should have at least 5 pre-registered error types", () => {
      // Verify the pre-registered ones exist
      const preRegisteredStatuses = [404, 415, 416, 500, 507];
      const allRegistered = preRegisteredStatuses.every((status) =>
        StandardError.types.has(status),
      );

      expect(allRegistered).toBe(true);
    });
  });

  describe("static getOrDefault() method", () => {
    it("should return the registered error type when it exists", () => {
      const error = StandardError.getOrDefault(404);
      expect(error.status).toBe(404);
      expect(error.title).toBe("Not Found");
    });

    it("should return 500 Internal Server Error for unknown status codes", () => {
      const error = StandardError.getOrDefault(418);
      expect(error.status).toBe(500);
      expect(error.title).toBe("Internal Server Error");
    });

    it("should return registered error for any pre-registered status", () => {
      const statuses = [404, 415, 416, 500, 507];
      statuses.forEach((status) => {
        const error = StandardError.getOrDefault(status);
        expect(error.status).toBe(status);
      });
    });

    it("should never return undefined", () => {
      const error1 = StandardError.getOrDefault(999);
      const error2 = StandardError.getOrDefault(123);
      const error3 = StandardError.getOrDefault(-1);

      expect(error1).toBeDefined();
      expect(error2).toBeDefined();
      expect(error3).toBeDefined();
    });

    it("should allow creating error objects from getOrDefault result", () => {
      const error = StandardError.getOrDefault(418);
      const result = error.error("Teapot error");

      expect(result.isErr()).toBe(true);
      const problemDetails = result.error;
      expect(problemDetails.status).toBe(500);
      expect(problemDetails.title).toBe("Internal Server Error");
      expect(problemDetails.detail).toBe("Teapot error");
    });

    it("should handle custom registered error types", () => {
      StandardError.add(8888, "Custom Error");
      const error = StandardError.getOrDefault(8888);

      expect(error.status).toBe(8888);
      expect(error.title).toBe("Custom Error");

      StandardError.types.delete(8888);
    });

    it("should still default to 500 for unregistered codes even after adding custom ones", () => {
      StandardError.add(7777, "Another Custom");
      const error = StandardError.getOrDefault(6666);

      expect(error.status).toBe(500);
      expect(error.title).toBe("Internal Server Error");

      StandardError.types.delete(7777);
    });
  });

  describe("usage patterns", () => {
    it("should allow retrieving and using pre-registered errors", () => {
      const notFoundError = StandardError.types.get(404);
      const result = notFoundError?.error("manifest.yml not found");

      expect(result?.isErr()).toBe(true);
      const problemDetails = result?.error;
      expect(problemDetails?.status).toBe(404);
      expect(problemDetails?.title).toBe("Not Found");
      expect(problemDetails?.detail).toBe("manifest.yml not found");
    });

    it("should support creating error from types map with all parameters", () => {
      const serverError = StandardError.types.get(500);
      const timestamp = "2024-02-14T14:00:00.000Z";
      const instance = "https://api.example.com/endpoint";

      const result = serverError?.error(
        "Unexpected error occurred",
        timestamp,
        instance,
      );

      expect(result?.isErr()).toBe(true);
      const problemDetails = result?.error;
      expect(problemDetails?.status).toBe(500);
      expect(problemDetails?.timestamp).toBe(timestamp);
      expect(problemDetails?.instance).toBe(instance);
    });

    it("should handle multiple errors from same type", () => {
      const badRequestError = StandardError.types.get(415);

      const error1 = badRequestError?.error("Invalid YAML format");
      const error2 = badRequestError?.error("Invalid manifest structure");

      expect(error1?.isErr()).toBe(true);
      expect(error2?.isErr()).toBe(true);
      expect(error1?.error.detail).toBe("Invalid YAML format");
      expect(error2?.error.detail).toBe("Invalid manifest structure");
      expect(error1?.error.status).toBe(error2?.error.status);
    });
  });

  describe("ProblemDetails interface compliance", () => {
    it("should return object matching ProblemDetails interface", () => {
      const error = new StandardError(404, "Not Found");
      const resultWrapper = error.error(
        "Resource not found",
        "2024-01-01T00:00:00.000Z",
        "https://example.com/resource/1",
      );

      // Extract ProblemDetails from Result
      expect(resultWrapper.isErr()).toBe(true);
      const result: ProblemDetails = resultWrapper.error;

      // TypeScript compilation will fail if interface doesn't match
      expect(result.type).toBe("https://httpstatuses.io/404");
      expect(result.title).toBe("Not Found");
      expect(result.status).toBe(404);
      expect(result.detail).toBe("Resource not found");
      expect(result.timestamp).toBe("2024-01-01T00:00:00.000Z");
      expect(result.instance).toBe("https://example.com/resource/1");
    });

    it("should have correct types for all required fields", () => {
      const error = new StandardError(500, "Internal Server Error");
      const resultWrapper = error.error("Error message");

      expect(resultWrapper.isErr()).toBe(true);
      const result = resultWrapper.error;

      expect(typeof result.type).toBe("string");
      expect(typeof result.title).toBe("string");
      expect(typeof result.status).toBe("number");
      expect(typeof result.detail).toBe("string");
      expect(typeof result.timestamp).toBe("string");
    });
  });

  describe("toExitCode() method", () => {
    it("should return 1 for 4xx client errors", () => {
      expect(StandardError.toExitCode(400)).toBe(1);
      expect(StandardError.toExitCode(404)).toBe(1);
      expect(StandardError.toExitCode(415)).toBe(1);
      expect(StandardError.toExitCode(416)).toBe(1);
      expect(StandardError.toExitCode(499)).toBe(1);
    });

    it("should return 1 for 5xx server errors", () => {
      expect(StandardError.toExitCode(500)).toBe(1);
      expect(StandardError.toExitCode(501)).toBe(1);
      expect(StandardError.toExitCode(507)).toBe(1);
      expect(StandardError.toExitCode(599)).toBe(1);
    });

    it("should return 1 for any non-success status code", () => {
      expect(StandardError.toExitCode(200)).toBe(1);
      expect(StandardError.toExitCode(301)).toBe(1);
      expect(StandardError.toExitCode(304)).toBe(1);
      expect(StandardError.toExitCode(418)).toBe(1);
    });

    it("should handle all registered error codes consistently", () => {
      const registeredCodes = [404, 415, 416, 500, 507];
      registeredCodes.forEach((code) => {
        expect(StandardError.toExitCode(code)).toBe(1);
      });
    });
  });

  describe("readonly properties", () => {
    it("should have status and title properties", () => {
      const error = new StandardError(404, "Not Found");

      // Verify properties are set correctly
      expect(error.status).toBe(404);
      expect(error.title).toBe("Not Found");

      // Note: TypeScript's readonly keyword provides compile-time type safety
      // but doesn't make properties truly immutable at runtime. The readonly
      // modifier will prevent accidental mutation in TypeScript code.
      expect(error).toHaveProperty("status", 404);
      expect(error).toHaveProperty("title", "Not Found");
    });
  });

  describe("ShellExitCodes", () => {
    it("should export ShellExitCodes map", () => {
      expect(ShellExitCodes).toBeDefined();
      expect(ShellExitCodes instanceof Map).toBe(true);
    });

    it("should contain standard POSIX exit codes", () => {
      expect(ShellExitCodes.get(0)).toBe("Success");
      expect(ShellExitCodes.get(1)).toBe("Catchall for general errors");
      expect(ShellExitCodes.get(2)).toBe("Misuse of shell builtins");
      expect(ShellExitCodes.get(126)).toBe("Command invoked cannot execute");
      expect(ShellExitCodes.get(127)).toBe("Command not found");
      expect(ShellExitCodes.get(128)).toBe("Invalid argument to exit");
      expect(ShellExitCodes.get(130)).toBe("Script terminated by Control-C");
    });

    it("should have at least 7 exit codes defined", () => {
      expect(ShellExitCodes.size).toBeGreaterThanOrEqual(7);
    });
  });
});
