/**
 * Forge event log sanitization tests
 *
 * These tests complement Forge event documentation by specifying the safe logging
 * behavior for sensitive invocation fields such as context tokens and headers.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/function-arguments/|Forge function arguments}
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */

import { describe, expect, it } from "vitest";
import { truncateEvents } from "../../src/forge/logging";
import scheduled from "../data/event/scheduled.json";
import webtrigger from "../data/event/webtrigger.json";

describe("truncateEvents", () => {
  it("should return primitives as is", () => {
    expect(truncateEvents(null)).toBe(null);
    expect(truncateEvents(123)).toBe(123);
    expect(truncateEvents("test")).toBe("test");
    expect(truncateEvents(true)).toBe(true);
  });

  it("should truncate contextToken", () => {
    const input = { contextToken: "1234567890" };
    const output = truncateEvents(input);
    expect(output.contextToken).toBe("123...890");
  });

  it("should replace headers", () => {
    const input = { headers: { Authorization: "Bearer 123" } };
    const output = truncateEvents(input);
    expect(output.headers).toEqual({ "...": "..." });
  });

  it("should handle nested objects", () => {
    const input = {
      nested: {
        contextToken: "abcdefghij",
        other: "value",
      },
    };
    const output = truncateEvents(input);
    expect(output.nested.contextToken).toBe("abc...hij");
    expect(output.nested.other).toBe("value");
  });

  it("should handle arrays", () => {
    const input = [{ contextToken: "111222333" }, { headers: { a: 1 } }];
    const output = truncateEvents(input);
    expect(output[0].contextToken).toBe("111...333");
    expect(output[1].headers).toEqual({ "...": "..." });
  });

  it("should truncate the context token from scheduled events", () => {
    const event = truncateEvents(scheduled);
    expect(event.contextToken.length).toBeLessThan(10);
  });

  it("should truncate the headers from webtrigger events", () => {
    const event = truncateEvents(webtrigger);
    expect(Object.keys(event.headers).length).toBe(1);
  });
});
