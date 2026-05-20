/**
 * Tests for POST /workitem/upsert handler.
 *
 * Covers:
 *  - Request body validation (missing fields, empty dedup, whitespace dedup)
 *  - Dedup hit → 200 with created:false, matches populated
 *  - Cross-project dedup warning
 *  - No match → creation → 200 with created:true
 *  - Jira JQL rejection forwarded as 400
 *  - Jira create error forwarding
 *  - Field resolution errors
 *  - Field coercion errors
 *  - OTel property write after creation
 */

import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { err } from "forge-ahead";
import { makeRequest, makeRawRequest, makeResolution, TEST_WEBTRIGGER_TOKEN } from "./test-helpers";
import { handleWorkitemUpsert } from "../../src/workitem/upsert-handler";
import { resolveFieldNames } from "../../src/workitem/field-resolver";

vi.mock("../../src/workitem/field-resolver", () => ({
  resolveFieldNames: vi.fn(),
  translateKeys: (
    fields: Record<string, unknown>,
    resolved: Map<string, string>,
  ) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[resolved.get(k) ?? k] = v;
    }
    return out;
  },
}));

vi.mock("../../src/workitem/field-coercer", () => ({
  coerceFields: (fields: Record<string, unknown>) => ({
    ok: true,
    fields,
    errors: [],
  }),
}));

vi.mock("../../src/workitem/jira-client", () => ({
  searchIssues: vi.fn(),
  createIssue: vi.fn(),
  writeOtelProperty: vi.fn().mockResolvedValue(undefined),
  getIssueTypes: vi.fn(),
  getFieldsForIssueType: vi.fn(),
  ProjectNotFoundError: class ProjectNotFoundError extends Error {
    projectKey: string;
    constructor(projectKey: string) {
      super(`Project "${projectKey}" not found or not accessible.`);
      this.name = "ProjectNotFoundError";
      this.projectKey = projectKey;
    }
  },
  JiraApiError: class JiraApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`Jira API error ${status}: ${body}`);
      this.name = "JiraApiError";
      this.status = status;
      this.body = body;
    }
  },
}));

import {
  searchIssues,
  createIssue,
  writeOtelProperty,
  JiraApiError,
} from "../../src/workitem/jira-client";

const mockResolveFieldNames = vi.mocked(resolveFieldNames);
const mockSearchIssues = vi.mocked(searchIssues);
const mockCreateIssue = vi.mocked(createIssue);
const mockWriteOtelProperty = vi.mocked(writeOtelProperty);

// makeRequest and makeResolution are imported from ./test-helpers

const CREATED_ISSUE = {
  id: "10042",
  key: "HSP-42",
  self: "https://example.atlassian.net/rest/api/3/issue/10042",
};

const VALID_UPSERT_BODY = {
  project: "HSP",
  issueType: "Story",
  fields: { Summary: "My Story" },
  dedup: 'project = HSP AND summary ~ "My Story"',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEBTRIGGER_TOKEN", TEST_WEBTRIGGER_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Request body validation
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — request body validation", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await handleWorkitemUpsert(await makeRawRequest("not json"));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).detail).toMatch(/valid JSON/i);
  });

  it("returns 400 when project is missing", async () => {
    const res = await handleWorkitemUpsert(
      await makeRequest({ issueType: "Story", fields: {}, dedup: "project = HSP" }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when dedup is missing", async () => {
    const res = await handleWorkitemUpsert(
      await makeRequest({ project: "HSP", issueType: "Story", fields: {} }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/dedup/i);
  });

  it("returns 400 when dedup is empty string", async () => {
    const res = await handleWorkitemUpsert(
      await makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: {},
        dedup: "",
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/dedup/i);
  });

  it("returns 400 when dedup is whitespace-only", async () => {
    const res = await handleWorkitemUpsert(
      await makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: {},
        dedup: "   ",
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/dedup/i);
  });

  it("returns 400 for null body", async () => {
    const res = await handleWorkitemUpsert(await makeRawRequest("null"));
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Dedup hit — skip creation
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — dedup hit", () => {
  it("returns 200 with created:false and matches when duplicates found", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["HSP-40", "HSP-38"]);

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.created).toBe(false);
    expect(body.id).toBeNull();
    expect(body.key).toBeNull();
    expect(body.self).toBeNull();
    expect(body.matches).toEqual(["HSP-40", "HSP-38"]);
    expect(body.warnings).toEqual([]);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("does not call createIssue when dedup finds matches", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["HSP-1"]);

    await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("caps matches at 10 (searchIssues is responsible, but response preserves all returned)", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    const tenKeys = Array.from({ length: 10 }, (_, i) => `HSP-${i + 1}`);
    mockSearchIssues.mockResolvedValue(tenKeys);

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    const body = JSON.parse(res.body);
    expect(body.matches).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Cross-project warning
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — cross-project warning", () => {
  it("adds a warning when matches are from a different project", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["OTHER-123", "HSP-40"]);

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    const body = JSON.parse(res.body);
    expect(body.created).toBe(false);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatch(/other projects/i);
    expect(body.warnings[0]).toContain("OTHER-123");
  });

  it("adds no warning when all matches are from the target project", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["HSP-40", "HSP-38"]);

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    const body = JSON.parse(res.body);
    expect(body.warnings).toEqual([]);
  });

  it("is case-insensitive when comparing project keys", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    // project is "HSP", matches include "hsp-10" (lowercase) — should NOT warn
    mockSearchIssues.mockResolvedValue(["hsp-10"]);

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    const body = JSON.parse(res.body);
    expect(body.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No duplicate — creation path
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — creation path", () => {
  it("returns 200 with created:true when no duplicates found", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.created).toBe(true);
    expect(body.id).toBe("10042");
    expect(body.key).toBe("HSP-42");
    expect(body.self).toBe(CREATED_ISSUE.self);
    expect(body.matches).toEqual([]);
    expect(body.warnings).toEqual([]);
  });

  it("calls createIssue with correct project and issueType injected", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    const call = mockCreateIssue.mock.calls[0][0];
    expect(call.fields.project).toEqual({ key: "HSP" });
    expect(call.fields.issuetype).toEqual({ name: "Story" });
  });

  it("calls searchIssues with the dedup JQL string", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const jql = 'project = HSP AND summary ~ "My Story"';
    await handleWorkitemUpsert(
      await makeRequest({ ...VALID_UPSERT_BODY, dedup: jql }),
    );

    expect(mockSearchIssues).toHaveBeenCalledWith(jql, 10, undefined);
  });
});

// ---------------------------------------------------------------------------
// Jira error forwarding
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — Jira error forwarding", () => {
  it("forwards Jira JQL rejection (400) from searchIssues", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockRejectedValue(
      new JiraApiError(400, JSON.stringify({ errorMessages: ["Invalid JQL"] })),
    );

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errorMessages).toContain("Invalid JQL");
  });

  it("returns 500 for unexpected errors from searchIssues", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockRejectedValue(new Error("Network timeout"));

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/dedup search/i);
  });

  it("forwards Jira 400 errors from createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockRejectedValue(
      new JiraApiError(
        400,
        JSON.stringify({ errorMessages: ["Field required"] }),
      ),
    );

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errorMessages).toContain("Field required");
  });

  it("returns 500 for unexpected errors from createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockRejectedValue(new Error("Timeout"));

    const res = await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/create issue/i);
  });
});

// ---------------------------------------------------------------------------
// Field resolution errors
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — field resolution errors", () => {
  it("returns 400 when field name resolution fails", async () => {
    mockResolveFieldNames.mockResolvedValue(
      err({
        type: "https://httpstatuses.io/400",
        title: "Bad Request",
        status: 400,
        detail: "Field name resolution failed for 1 field(s).",
        timestamp: new Date().toISOString(),
        errors: [
          {
            field: "Unknown Field",
            reason: "not_found" as const,
            message: "No field named 'Unknown Field'.",
          },
        ],
      }),
    );

    const res = await handleWorkitemUpsert(
      await makeRequest({ ...VALID_UPSERT_BODY, fields: { "Unknown Field": 1 } }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0].reason).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// OTel property write
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsert — OTel property write", () => {
  it("calls writeOtelProperty after creation when otel is provided", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const otel = {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    };

    const res = await handleWorkitemUpsert(
      await makeRequest({ ...VALID_UPSERT_BODY, otel }),
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.created).toBe(true);
    expect(mockWriteOtelProperty).toHaveBeenCalledOnce();
    expect(mockWriteOtelProperty).toHaveBeenCalledWith(CREATED_ISSUE.key, otel);
  });

  it("does not call writeOtelProperty when dedup skips creation", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["HSP-1"]);

    const otel = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
    await handleWorkitemUpsert(await makeRequest({ ...VALID_UPSERT_BODY, otel }));

    expect(mockWriteOtelProperty).not.toHaveBeenCalled();
  });

  it("does not call writeOtelProperty when otel is absent", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemUpsert(await makeRequest(VALID_UPSERT_BODY));

    expect(mockWriteOtelProperty).not.toHaveBeenCalled();
  });
});
