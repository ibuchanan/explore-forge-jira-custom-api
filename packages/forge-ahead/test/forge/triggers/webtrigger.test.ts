/**
 * Forge web trigger helper tests
 *
 * These tests complement the web trigger docs by specifying event header
 * extraction and response envelope behavior for web trigger handlers.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/web-trigger/|Web trigger module}
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/web-trigger/|Web trigger event payload}
 */

import type { WebTriggerMethod } from "@forge/api";
import { describe, expect, it } from "vitest";
import type {
  WebtriggerEvent,
  WebtriggerResponse,
} from "../../../src/forge/triggers/webtrigger";
import {
  buildErrorResponse,
  buildSuccessResponse,
  extractClientHeaders,
} from "../../../src/forge/triggers/webtrigger";
import { StandardError } from "../../../src/util/errors";

// Sample event and context data
const sampleEvent = JSON.parse(
  JSON.stringify(require("../../data/event/webtrigger.json")),
) as WebtriggerEvent;

// Headers added by Atlassian infrastructure that client code should never see.
// Kept in one place so both the unit tests and integration tests stay in sync.
const INFRASTRUCTURE_HEADERS = [
  "host",
  "content-type",
  "content-length",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-amzn-trace-id",
];

describe("webtrigger module", () => {
  describe("extractClientHeaders", () => {
    it("should extract only client-relevant headers from a request", () => {
      const extracted = extractClientHeaders(sampleEvent);

      // Verify it includes client headers
      expect(extracted).toHaveProperty("user-agent");
      expect(extracted).toHaveProperty("atl-traceid");
      expect(extracted).toHaveProperty("atl-edge-true-client-ip");
      expect(extracted).toHaveProperty("atl-edge-ip-tags");
    });

    it("should exclude server and infrastructure headers", () => {
      const extracted = extractClientHeaders(sampleEvent);

      for (const header of INFRASTRUCTURE_HEADERS) {
        expect(extracted).not.toHaveProperty(header);
      }
    });

    it("should return empty object when no client headers are present", () => {
      const eventWithoutClientHeaders: WebtriggerEvent = {
        ...sampleEvent,
        headers: {
          "content-type": ["application/json"],
          "content-length": ["100"],
        },
      };

      const extracted = extractClientHeaders(eventWithoutClientHeaders);
      expect(extracted).toEqual({});
    });

    it("should preserve header array values", () => {
      const extracted = extractClientHeaders(sampleEvent);

      // Headers should maintain their array format
      expect(Array.isArray(extracted["user-agent"])).toBe(true);
      expect(Array.isArray(extracted["atl-traceid"])).toBe(true);
    });
  });

  describe("buildSuccessResponse", () => {
    it("should build a response with default values", () => {
      const response = buildSuccessResponse();

      expect(response.statusCode).toBe(200);
      expect(response.statusText).toBe("OK");
      expect(response.body).toBe(JSON.stringify({ message: "OK" }));
      expect(response.headers).toEqual({
        "Content-Type": ["application/json"],
      });
    });

    it("should build a response with custom status code and text", () => {
      const response = buildSuccessResponse(
        { error: "Not found" },
        404,
        "Not Found",
      );

      expect(response.statusCode).toBe(404);
      expect(response.statusText).toBe("Not Found");
      expect(response.body).toBe(JSON.stringify({ error: "Not found" }));
    });

    it("should build a response with custom message object", () => {
      const customMessage = { result: "success", data: [1, 2, 3] };
      const response = buildSuccessResponse(customMessage, 201, "Created");

      expect(response.statusCode).toBe(201);
      expect(response.body).toBe(JSON.stringify(customMessage));
    });

    it("should build a 204 No Content response", () => {
      const response = buildSuccessResponse({}, 204, "No Content");

      expect(response.statusCode).toBe(204);
      expect(response.statusText).toBe("No Content");
      expect(response.body).toBe(JSON.stringify({}));
    });

    it("should always set Content-Type header to application/json", () => {
      const response = buildSuccessResponse();

      expect(response.headers["Content-Type"]).toEqual(["application/json"]);
    });
  });

  describe("buildErrorResponse", () => {
    it("should build an error response from ProblemDetails", () => {
      const error = StandardError.getOrDefault(404).error("Resource not found");

      expect(error.isErr()).toBe(true);
      const response = buildErrorResponse(error.error);

      expect(response.statusCode).toBe(404);
      expect(response.statusText).toBe("Not Found");
      expect(response.headers["Content-Type"]).toEqual(["application/json"]);
    });

    it("should include full ProblemDetails in response body", () => {
      const error = StandardError.getOrDefault(404).error(
        "File not found",
        "2024-02-18T10:00:00.000Z",
        "/api/files/123",
      );

      expect(error.isErr()).toBe(true);
      const response = buildErrorResponse(error.error);
      const body = JSON.parse(response.body || "{}");

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
      expect(response.statusText).toBe("Internal Server Error");
    });

    it("should handle 415 Unsupported Media Type", () => {
      const error = StandardError.getOrDefault(415).error(
        "Invalid YAML format",
      );

      expect(error.isErr()).toBe(true);
      const response = buildErrorResponse(error.error);

      expect(response.statusCode).toBe(415);
      expect(response.statusText).toBe("Unsupported Media Type");
    });

    it("should handle 416 Range Not Satisfiable for validation errors", () => {
      const error = StandardError.getOrDefault(416).error(
        "Missing required field",
      );

      expect(error.isErr()).toBe(true);
      const response = buildErrorResponse(error.error);

      expect(response.statusCode).toBe(416);
      expect(response.statusText).toBe("Range Not Satisfiable");
    });

    it("should always set Content-Type header to application/json", () => {
      const error = StandardError.getOrDefault(404).error("Not found");

      expect(error.isErr()).toBe(true);
      const response = buildErrorResponse(error.error);

      expect(response.headers["Content-Type"]).toEqual(["application/json"]);
    });
  });

  describe("WebtriggerEvent type", () => {
    it("should parse sample event data correctly", () => {
      expect(sampleEvent.method).toBe("POST");
      expect(sampleEvent.path).toBe("/x1/tONwwo2l6ahslA_2zT-6536LRZQ");
      expect(sampleEvent.body).toBe('{ "me": 0 }');
      expect(sampleEvent.context.moduleKey).toBe("dev-trigger");
      expect(sampleEvent.call?.functionKey).toBe("");
    });

    it("should include CommonEvent properties", () => {
      // From CommonEvent interface
      expect(sampleEvent).toHaveProperty("context");
      expect(sampleEvent).toHaveProperty("contextToken");
      expect(sampleEvent.context).toHaveProperty("cloudId");
      expect(sampleEvent.context).toHaveProperty("moduleKey");
    });

    it("should have headers as Record<string, string[]>", () => {
      Object.values(sampleEvent.headers).forEach((headerValue) => {
        expect(Array.isArray(headerValue)).toBe(true);
        expect(headerValue.every((v) => typeof v === "string")).toBe(true);
      });
    });

    it("should have queryParameters as Record<string, string[]>", () => {
      expect(typeof sampleEvent.queryParameters).toBe("object");
      Object.values(sampleEvent.queryParameters).forEach((paramValue) => {
        expect(Array.isArray(paramValue)).toBe(true);
      });
    });

    it("should support optional body field", () => {
      const eventWithoutBody: WebtriggerEvent = {
        ...sampleEvent,
        body: undefined,
      };

      // Should not throw
      expect(eventWithoutBody.body).toBeUndefined();
    });

    it("should include undocumented call field", () => {
      expect(sampleEvent.call).toBeDefined();
      expect(sampleEvent.call?.functionKey).toBeDefined();
    });
  });

  describe("WebtriggerResponse type", () => {
    it("should create a valid response with all fields", () => {
      const response: WebtriggerResponse = {
        body: "test",
        headers: { "X-Custom": ["value"] },
        statusCode: 200,
        statusText: "OK",
      };

      expect(response.body).toBe("test");
      expect(response.statusCode).toBe(200);
      expect(response.statusText).toBe("OK");
    });

    it("should allow optional body field", () => {
      const responseWithoutBody: WebtriggerResponse = {
        headers: { "Content-Type": ["application/json"] },
        statusCode: 204,
        statusText: "No Content",
      };

      expect(responseWithoutBody.body).toBeUndefined();
    });

    it("should support various HTTP status codes", () => {
      const statusCodes = [200, 201, 204, 400, 404, 500];

      statusCodes.forEach((code) => {
        const response: WebtriggerResponse = {
          statusCode: code,
          statusText: `Status ${code}`,
          headers: {},
        };

        expect(response.statusCode).toBe(code);
      });
    });
  });

  describe("HTTP method typing", () => {
    it("should accept valid HTTP methods", () => {
      const methods: WebTriggerMethod[] = [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
      ];

      methods.forEach((method) => {
        const event: WebtriggerEvent = {
          ...sampleEvent,
          method: method,
        };

        expect(event.method).toBe(method);
      });
    });

    it("sample event has valid HTTP method", () => {
      const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      expect(validMethods).toContain(sampleEvent.method);
    });
  });

  describe("integration: extracting headers from real event", () => {
    it("should extract client headers from sample event", () => {
      const clientHeaders = extractClientHeaders(sampleEvent);

      // Should have the key headers we care about
      expect(clientHeaders["user-agent"]).toBeDefined();
      expect(clientHeaders["atl-traceid"]).toBeDefined();
      expect(clientHeaders["atl-edge-true-client-ip"]).toBeDefined();
    });

    it("should filter out all infrastructure headers from sample event", () => {
      const clientHeaders = extractClientHeaders(sampleEvent);

      for (const header of INFRASTRUCTURE_HEADERS) {
        expect(clientHeaders[header]).toBeUndefined();
      }
    });
  });
});
