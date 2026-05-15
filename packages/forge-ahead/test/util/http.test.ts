/**
 * Tests for core HTTP primitives in util/http.
 *
 * Covers `extractClientHeaders`, which filters inbound request headers to
 * only the client/tracing subset safe for logging and forwarding.
 */

import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../../src/util/http";
import { extractClientHeaders } from "../../src/util/http";

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

const sampleRequest: HttpRequest = {
  method: "POST",
  path: "/webhook",
  headers: {
    // Infrastructure headers — should be excluded
    host: ["80cf424b-14e2-4b82-adb5-e0f6eedc5059.hello.atlassian-dev.net"],
    "x-forwarded-for": ["104.30.161.180, 10.16.110.32"],
    "x-forwarded-proto": ["https"],
    "x-amzn-trace-id": ["Root=1-68f25ddb-31a4556901db90b16f8f118d"],
    "content-length": ["11"],
    "content-type": ["application/json"],
    // Client headers — should be included
    "user-agent": ["bruno-runtime/2.13.1"],
    "atl-traceid": ["6b6e4cd2c5a14365b51f89af1d8f99d3"],
    "atl-edge-true-client-ip": ["104.30.161.180"],
    "atl-edge-ip-tags": ["AtlassianOffices"],
  },
};

describe("util/http", () => {
  describe("extractClientHeaders", () => {
    it("should extract only client-relevant headers from a request", () => {
      const extracted = extractClientHeaders(sampleRequest);

      expect(extracted).toHaveProperty("user-agent");
      expect(extracted).toHaveProperty("atl-traceid");
      expect(extracted).toHaveProperty("atl-edge-true-client-ip");
      expect(extracted).toHaveProperty("atl-edge-ip-tags");
    });

    it("should exclude server and infrastructure headers", () => {
      const extracted = extractClientHeaders(sampleRequest);

      for (const header of INFRASTRUCTURE_HEADERS) {
        expect(extracted).not.toHaveProperty(header);
      }
    });

    it("should return empty object when no client headers are present", () => {
      const requestWithoutClientHeaders: HttpRequest = {
        ...sampleRequest,
        headers: {
          "content-type": ["application/json"],
          "content-length": ["100"],
        },
      };

      const extracted = extractClientHeaders(requestWithoutClientHeaders);
      expect(extracted).toEqual({});
    });

    it("should return empty object when headers are undefined", () => {
      const requestWithoutHeaders: HttpRequest = {
        method: "GET",
        path: "/ping",
      };

      const extracted = extractClientHeaders(requestWithoutHeaders);
      expect(extracted).toEqual({});
    });

    it("should preserve header array values", () => {
      const extracted = extractClientHeaders(sampleRequest);

      expect(Array.isArray(extracted["user-agent"])).toBe(true);
      expect(Array.isArray(extracted["atl-traceid"])).toBe(true);
    });

    it("should only include headers that are present in the request", () => {
      const partialRequest: HttpRequest = {
        headers: {
          "user-agent": ["test-client/1.0"],
          "content-type": ["application/json"],
        },
      };

      const extracted = extractClientHeaders(partialRequest);

      expect(extracted).toHaveProperty("user-agent");
      expect(extracted).not.toHaveProperty("atl-traceid");
      expect(extracted).not.toHaveProperty("atl-edge-true-client-ip");
      expect(extracted).not.toHaveProperty("atl-edge-ip-tags");
    });
  });
});

describe("util/http integration: real webtrigger event data", () => {
  // Use the same fixture as the webtrigger tests to verify extractClientHeaders
  // works correctly against a real Forge event payload.
  const realEvent = JSON.parse(
    JSON.stringify(require("../data/event/webtrigger.json")),
  ) as HttpRequest;

  it("should extract client headers from a real webtrigger event", () => {
    const clientHeaders = extractClientHeaders(realEvent);

    expect(clientHeaders["user-agent"]).toBeDefined();
    expect(clientHeaders["atl-traceid"]).toBeDefined();
    expect(clientHeaders["atl-edge-true-client-ip"]).toBeDefined();
  });

  it("should filter out all infrastructure headers from a real webtrigger event", () => {
    const clientHeaders = extractClientHeaders(realEvent);

    for (const header of INFRASTRUCTURE_HEADERS) {
      expect(clientHeaders[header]).toBeUndefined();
    }
  });
});
