/**
 * Unit tests for jira/api.ts utility functions.
 */

import { describe, expect, it } from "vitest";
import { sanitizeKey, sanitizeTextQuery } from "../../src/jira/api";

describe("sanitizeKey", () => {
  it("strips spaces and uppercases", () => {
    expect(sanitizeKey("my project")).toBe("MYPROJECT");
  });

  it("handles already-uppercase input", () => {
    expect(sanitizeKey("HSP")).toBe("HSP");
  });

  it("strips multiple spaces", () => {
    expect(sanitizeKey("a b  c")).toBe("ABC");
  });

  it("handles empty string", () => {
    expect(sanitizeKey("")).toBe("");
  });
});

describe("sanitizeTextQuery", () => {
  it("strips non-word/space characters and lowercases", () => {
    expect(sanitizeTextQuery("Hello, World!")).toBe("hello world");
  });

  it("preserves words and spaces", () => {
    expect(sanitizeTextQuery("find me an issue")).toBe("find me an issue");
  });

  it("strips special chars like punctuation", () => {
    expect(sanitizeTextQuery("bug: can't login")).toBe("bug cant login");
  });

  it("handles empty string", () => {
    expect(sanitizeTextQuery("")).toBe("");
  });
});
