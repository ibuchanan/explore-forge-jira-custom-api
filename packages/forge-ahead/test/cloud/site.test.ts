/**
 * Atlassian site context ARI parsing tests
 *
 * These tests complement Forge lifecycle/remote docs by specifying how the
 * library extracts a Cloud ID from site context ARIs delivered by Forge events.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/life-cycle/|Forge lifecycle events}
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */

import { describe, expect, it } from "vitest";
import { extractCloudId } from "../../src/cloud/site";

describe("cloud/site", () => {
  describe("extractCloudId", () => {
    it("should extract cloudId from valid Atlassian Cloud site context ARI", () => {
      const ari = "ari:cloud:jira::site/89a6b224-3b44-4cef-8e4d-37aff29af277";
      const result = extractCloudId(ari);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("89a6b224-3b44-4cef-8e4d-37aff29af277");
      }
    });

    it("should handle multiple hyphens in cloudId", () => {
      const ari = "ari:cloud:jira::site/12345678-abcd-ef01-2345-6789abcdef01";
      const result = extractCloudId(ari);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("12345678-abcd-ef01-2345-6789abcdef01");
      }
    });

    it("should return Err for invalid ARI format", () => {
      const result = extractCloudId("invalid-ari-format");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(400);
        expect(result.error.detail).toContain("valid site cloudId");
      }
    });

    it("should return Err for ARI without site prefix", () => {
      const ari =
        "ari:cloud:jira::installation/89a6b224-3b44-4cef-8e4d-37aff29af277";
      const result = extractCloudId(ari);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(400);
        expect(result.error.detail).toContain("valid site cloudId");
      }
    });

    it("should return Err for non-string input", () => {
      const result = extractCloudId(null as any);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(400);
        expect(result.error.detail).toContain("non-empty string");
      }
    });

    it("should return Err for empty string", () => {
      const result = extractCloudId("");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(400);
        expect(result.error.detail).toContain("non-empty string");
      }
    });

    it("should return Err if site/ prefix exists but no cloudId follows", () => {
      const result = extractCloudId("ari:cloud:jira::site/");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(400);
        expect(result.error.detail).toContain("valid site cloudId");
      }
    });
  });
});
