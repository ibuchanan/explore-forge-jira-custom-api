/**
 * Unit tests for the Jira API client functions.
 *
 * The @forge/api module is mocked via the automatic stub in
 * tests/__mocks__/@forge/api.ts so no real network calls are made.
 * Each test controls the mock response by replacing `requestJira` on
 * the `asUser()` / `asApp()` chain.
 *
 * Covered:
 *  - searchIssues   — POST /rest/api/3/search/jql, key extraction, cap, JQL errors
 *  - createIssue    — POST /rest/api/3/issue, happy path and error forwarding
 *  - writeOtelProperty — PUT issue property, happy path and silent failure
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @forge/api so we can control requestJira responses per-test
// ---------------------------------------------------------------------------

const mockRequestJira = vi.fn();

vi.mock("@forge/api", () => {
  const makeClient = () => ({ requestJira: mockRequestJira });
  return {
    default: {
      asUser: () => makeClient(),
      asApp: () => makeClient(),
    },
    route: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), ""),
  };
});

import {
  JiraApiError,
  createIssue,
  searchIssues,
  writeOtelProperty,
} from "../../src/workitem/jira-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// searchIssues
// ---------------------------------------------------------------------------

describe("searchIssues", () => {
  it("returns keys from the issues array", async () => {
    mockRequestJira.mockResolvedValue(
      makeOkResponse({
        issues: [{ key: "HSP-1" }, { key: "HSP-2" }, { key: "HSP-3" }],
      }),
    );

    const keys = await searchIssues("project = HSP");

    expect(keys).toEqual(["HSP-1", "HSP-2", "HSP-3"]);
  });

  it("returns empty array when no issues found", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({ issues: [] }));

    const keys = await searchIssues('project = HSP AND summary ~ "nothing"');

    expect(keys).toEqual([]);
  });

  it("handles missing issues field gracefully", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({}));

    const keys = await searchIssues("project = HSP");

    expect(keys).toEqual([]);
  });

  it("filters out issues with missing key", async () => {
    mockRequestJira.mockResolvedValue(
      makeOkResponse({
        issues: [{ key: "HSP-1" }, {}, { key: "HSP-3" }],
      }),
    );

    const keys = await searchIssues("project = HSP");

    expect(keys).toEqual(["HSP-1", "HSP-3"]);
  });

  it("caps results at maxResults (default 10)", async () => {
    const issues = Array.from({ length: 10 }, (_, i) => ({
      key: `HSP-${i + 1}`,
    }));
    mockRequestJira.mockResolvedValue(makeOkResponse({ issues }));

    const keys = await searchIssues("project = HSP");

    expect(keys).toHaveLength(10);
  });

  it("respects a custom maxResults cap", async () => {
    const issues = Array.from({ length: 5 }, (_, i) => ({
      key: `HSP-${i + 1}`,
    }));
    mockRequestJira.mockResolvedValue(makeOkResponse({ issues }));

    const keys = await searchIssues("project = HSP", 3);

    // searchIssues passes maxResults to Jira and also slices the response
    expect(keys).toHaveLength(3);
  });

  it("passes POST body with jql, maxResults, and fields=[key]", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({ issues: [] }));

    await searchIssues('project = HSP AND summary ~ "My Story"', 5);

    expect(mockRequestJira).toHaveBeenCalledOnce();
    const [, options] = mockRequestJira.mock.calls[0];
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body);
    expect(body.jql).toBe('project = HSP AND summary ~ "My Story"');
    expect(body.maxResults).toBe(5);
    expect(body.fields).toContain("key");
  });

  it("throws JiraApiError when Jira returns a non-ok status", async () => {
    mockRequestJira.mockResolvedValue(
      makeErrorResponse(
        400,
        JSON.stringify({ errorMessages: ["Invalid JQL"] }),
      ),
    );

    await expect(searchIssues("INVALID JQL !!!")).rejects.toThrow(JiraApiError);
  });

  it("JiraApiError carries the Jira status and body", async () => {
    const errorBody = JSON.stringify({ errorMessages: ["Bad query"] });
    mockRequestJira.mockResolvedValue(makeErrorResponse(400, errorBody));

    let caught: JiraApiError | undefined;
    try {
      await searchIssues("bad");
    } catch (e) {
      caught = e as JiraApiError;
    }

    expect(caught).toBeInstanceOf(JiraApiError);
    expect(caught?.status).toBe(400);
    expect(caught?.body).toBe(errorBody);
  });
});

// ---------------------------------------------------------------------------
// createIssue
// ---------------------------------------------------------------------------

describe("createIssue", () => {
  it("returns id, key, and self from the Jira response", async () => {
    mockRequestJira.mockResolvedValue(
      makeOkResponse({
        id: "10042",
        key: "HSP-42",
        self: "https://example.atlassian.net/rest/api/3/issue/10042",
      }),
    );

    const result = await createIssue({
      fields: { summary: "My Story", project: { key: "HSP" } },
    });

    expect(result.id).toBe("10042");
    expect(result.key).toBe("HSP-42");
    expect(result.self).toBe(
      "https://example.atlassian.net/rest/api/3/issue/10042",
    );
  });

  it("sends a POST with the correct body", async () => {
    mockRequestJira.mockResolvedValue(
      makeOkResponse({ id: "1", key: "HSP-1", self: "https://example.com" }),
    );

    const body = {
      fields: {
        summary: "Test",
        project: { key: "HSP" },
        issuetype: { name: "Story" },
      },
    };
    await createIssue(body);

    const [, options] = mockRequestJira.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual(body);
  });

  it("throws JiraApiError on non-ok response", async () => {
    mockRequestJira.mockResolvedValue(
      makeErrorResponse(
        400,
        JSON.stringify({ errorMessages: ["Field required"] }),
      ),
    );

    await expect(
      createIssue({ fields: { project: { key: "HSP" } } }),
    ).rejects.toThrow(JiraApiError);
  });

  it("JiraApiError status and body are preserved", async () => {
    const errorBody = JSON.stringify({ errorMessages: ["Validation failed"] });
    mockRequestJira.mockResolvedValue(makeErrorResponse(422, errorBody));

    let caught: JiraApiError | undefined;
    try {
      await createIssue({ fields: {} });
    } catch (e) {
      caught = e as JiraApiError;
    }

    expect(caught?.status).toBe(422);
    expect(caught?.body).toBe(errorBody);
  });

  it("returns empty strings for missing id/key/self fields", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({}));

    const result = await createIssue({ fields: {} });

    expect(result.id).toBe("");
    expect(result.key).toBe("");
    expect(result.self).toBe("");
  });
});

// ---------------------------------------------------------------------------
// writeOtelProperty
// ---------------------------------------------------------------------------

describe("writeOtelProperty", () => {
  it("sends a PUT to the otel issue property endpoint", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({}, 200));

    await writeOtelProperty("HSP-42", {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });

    expect(mockRequestJira).toHaveBeenCalledOnce();
    const [, options] = mockRequestJira.mock.calls[0];
    expect(options.method).toBe("PUT");
    const body = JSON.parse(options.body);
    expect(body.traceId).toBe("a".repeat(32));
    expect(body.spanId).toBe("b".repeat(16));
  });

  it("applies default traceFlags='01' and traceState='' when not provided", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({}, 200));

    await writeOtelProperty("HSP-1", {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });

    const [, options] = mockRequestJira.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.traceFlags).toBe("01");
    expect(body.traceState).toBe("");
  });

  it("forwards provided traceFlags and traceState", async () => {
    mockRequestJira.mockResolvedValue(makeOkResponse({}, 200));

    await writeOtelProperty("HSP-1", {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      traceFlags: "00",
      traceState: "vendor=abc",
    });

    const [, options] = mockRequestJira.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.traceFlags).toBe("00");
    expect(body.traceState).toBe("vendor=abc");
  });

  it("does not throw when Jira returns a non-ok response (best-effort)", async () => {
    mockRequestJira.mockResolvedValue(
      makeErrorResponse(500, "Internal Server Error"),
    );

    // Should resolve without throwing
    await expect(
      writeOtelProperty("HSP-1", {
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
      }),
    ).resolves.toBeUndefined();
  });
});
