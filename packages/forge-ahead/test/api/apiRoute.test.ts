/**
 * Tests for the apiRoute module.
 *
 * Covers response-building helpers (`json`, `problemJson`, `buildSuccessResponse`,
 * `buildErrorResponse`), the `logApiRouteRequest` logging utility, and the
 * `ApiRouteRequest`/`ApiRouteResponse` type shapes.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 */

import { describe, expect, it, vi } from "vitest";
import type { ApiRouteRequest, ApiRouteResponse } from "../../src/api/apiRoute";
import {
  buildErrorResponse,
  buildSuccessResponse,
  logApiRouteRequest,
} from "../../src/api/apiRoute";
import { StandardError } from "../../src/util/errors";

describe("apiRoute module", () => {
  describe("buildSuccessResponse", () => {
    it("should build a response with default values", () => {
      const response = buildSuccessResponse();

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ message: "OK" }));
      expect(response.headers).toEqual({
        "Content-Type": ["application/json"],
      });
    });

    it("should build a response with a custom status code", () => {
      const response = buildSuccessResponse({ id: "new-resource" }, 201);

      expect(response.statusCode).toBe(201);
      expect(response.body).toBe(JSON.stringify({ id: "new-resource" }));
    });

    it("should build a response with a custom message object", () => {
      const customMessage = { result: "success", data: [1, 2, 3] };
      const response = buildSuccessResponse(customMessage);

      expect(response.body).toBe(JSON.stringify(customMessage));
    });

    it("should always set Content-Type header to application/json", () => {
      const response = buildSuccessResponse();

      expect(response.headers?.["Content-Type"]).toEqual(["application/json"]);
    });

    it("should not include a statusText field (unlike webtrigger)", () => {
      const response = buildSuccessResponse() as ApiRouteResponse & {
        statusText?: string;
      };

      expect(response.statusText).toBeUndefined();
    });
  });

  describe("buildErrorResponse", () => {
    describe("overload: (ProblemDetails)", () => {
      it("should build an error response from a ProblemDetails object", () => {
        const error =
          StandardError.getOrDefault(404).error("Resource not found");

        expect(error.isErr()).toBe(true);
        const response = buildErrorResponse(error.error);

        expect(response.statusCode).toBe(404);
        expect(response.headers?.["Content-Type"]).toEqual([
          "application/json",
        ]);
      });

      it("should include full ProblemDetails in the response body", () => {
        const error = StandardError.getOrDefault(404).error(
          "File not found",
          "2024-02-18T10:00:00.000Z",
          "/api/files/123",
        );

        expect(error.isErr()).toBe(true);
        const response = buildErrorResponse(error.error);
        const body = JSON.parse(response.body ?? "{}");

        expect(body.type).toBe("https://httpstatuses.io/404");
        expect(body.title).toBe("Not Found");
        expect(body.status).toBe(404);
        expect(body.detail).toBe("File not found");
        expect(body.timestamp).toBe("2024-02-18T10:00:00.000Z");
        expect(body.instance).toBe("/api/files/123");
      });

      it("should handle 500 Internal Server Error", () => {
        const error = StandardError.getOrDefault(500).error(
          "Server error occurred",
        );

        expect(error.isErr()).toBe(true);
        const response = buildErrorResponse(error.error);

        expect(response.statusCode).toBe(500);
      });

      it("should always set Content-Type header to application/json", () => {
        const error = StandardError.getOrDefault(400).error("Bad input");

        expect(error.isErr()).toBe(true);
        const response = buildErrorResponse(error.error);

        expect(response.headers?.["Content-Type"]).toEqual([
          "application/json",
        ]);
      });
    });

    describe("overload: (statusCode, detail)", () => {
      it("should build an RFC 9457 Problem Details response from a status code and detail", () => {
        const response = buildErrorResponse(
          400,
          "Request body must be valid JSON",
        );

        expect(response.statusCode).toBe(400);
        expect(response.headers?.["Content-Type"]).toEqual([
          "application/json",
        ]);

        const body = JSON.parse(response.body ?? "{}");
        expect(body.type).toBe("https://httpstatuses.io/400");
        expect(body.title).toBe("Bad Request");
        expect(body.status).toBe(400);
        expect(body.detail).toBe("Request body must be valid JSON");
        expect(body.timestamp).toBeDefined();
      });

      it("should handle 404 Not Found", () => {
        const response = buildErrorResponse(404, "Resource not found");
        const body = JSON.parse(response.body ?? "{}");

        expect(response.statusCode).toBe(404);
        expect(body.title).toBe("Not Found");
      });

      it("should handle 500 Internal Server Error", () => {
        const response = buildErrorResponse(500, "Unexpected failure");
        const body = JSON.parse(response.body ?? "{}");

        expect(response.statusCode).toBe(500);
        expect(body.title).toBe("Internal Server Error");
      });

      it("should handle 415 Unsupported Media Type", () => {
        const response = buildErrorResponse(415, "Invalid content type");

        expect(response.statusCode).toBe(415);
      });

      it("should include a timestamp in the body", () => {
        const before = new Date().toISOString();
        const response = buildErrorResponse(400, "Bad input");
        const after = new Date().toISOString();
        const body = JSON.parse(response.body ?? "{}");

        expect(body.timestamp >= before).toBe(true);
        expect(body.timestamp <= after).toBe(true);
      });
    });
  });

  describe("logApiRouteRequest", () => {
    it("should log at debug level with a label prefix", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      const req: ApiRouteRequest = {
        method: "POST",
        path: "/workitem",
        body: '{"key":"value"}',
        headers: { authorization: ["Bearer secret-token"] },
      };

      logApiRouteRequest(req, "workitem");

      expect(debugSpy).toHaveBeenCalledOnce();
      const [prefix, logged] = debugSpy.mock.calls[0];
      expect(prefix).toBe("workitem request:");
      // Headers should be masked
      expect(logged).not.toContain("secret-token");
      expect(logged).toContain("...");

      debugSpy.mockRestore();
    });

    it("should use a default prefix when no label is given", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      logApiRouteRequest({ method: "GET", path: "/ping" });

      expect(debugSpy).toHaveBeenCalledOnce();
      expect(debugSpy.mock.calls[0][0]).toBe("Request:");

      debugSpy.mockRestore();
    });

    it("should mask contextToken in the logged output", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      const req: ApiRouteRequest = {
        method: "GET",
        path: "/ping",
        // contextToken is not on ApiRouteRequest's type but may appear at runtime
        ...({ contextToken: "super-secret-token-value" } as object),
      };

      logApiRouteRequest(req);

      const logged = debugSpy.mock.calls[0][1] as string;
      expect(logged).not.toContain("super-secret-token-value");
      expect(logged).toContain("sup...lue");

      debugSpy.mockRestore();
    });
  });

  describe("ApiRouteRequest type", () => {
    it("should accept a minimal request with no fields", () => {
      const req: ApiRouteRequest = {};
      expect(req).toBeDefined();
    });

    it("should accept a fully populated request", () => {
      const req: ApiRouteRequest = {
        method: "POST",
        path: "/api/resource",
        body: '{"key":"value"}',
        headers: { "content-type": ["application/json"] },
        queryParameters: { page: ["1"], limit: ["10"] },
      };
      expect(req.method).toBe("POST");
      expect(req.queryParameters?.page).toEqual(["1"]);
    });
  });
});
