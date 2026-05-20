/**
 * Unit tests for the POST /workitem handler.
 *
 * Mocks the field-resolver and jira-client modules so no real network calls
 * are made. Tests validate the full request/response cycle including
 * validation, error aggregation, translation, and Jira proxying.
 */

import { err } from "forge-ahead";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeRequest, makeResolution } from "./test-helpers";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("../../src/workitem/field-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/workitem/field-resolver")>();
  return {
    ...actual,
    // translateKeys is pure — use the real implementation
    resolveFieldNames: vi.fn(),
  };
});

vi.mock("../../src/workitem/jira-client", () => ({
  // createIssue is called directly by the handler
  createIssue: vi.fn(),
  // writeOtelProperty is called post-creation; best-effort so handler never awaits rejection
  writeOtelProperty: vi.fn().mockResolvedValue(undefined),
  // getIssueTypes and getFieldsForIssueType are used by defaultDeps in field-resolver;
  // they must be present even though handler tests mock resolveFieldNames at a higher level
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

import { handleWorkitem } from "../../src/workitem/handler";
import { resolveFieldNames } from "../../src/workitem/field-resolver";
import {
  createIssue,
  JiraApiError,
  writeOtelProperty,
} from "../../src/workitem/jira-client";

const mockResolveFieldNames = vi.mocked(resolveFieldNames);
const mockCreateIssue = vi.mocked(createIssue);
const mockWriteOtelProperty = vi.mocked(writeOtelProperty);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// makeRequest and makeResolution are imported from ./test-helpers

// handler tests mock resolveFieldNames at a high level; passing an empty
// fieldMetaById skips coercion so numeric values pass through unchanged.
const SUCCESS_RESOLUTION = makeResolution(
  [
    ["Summary", "summary"],
    ["Story Points", "customfield_10016"],
  ],
  new Map(),
);

const CREATED_ISSUE = {
  id: "10001",
  key: "HSP-42",
  self: "https://example.atlassian.net/rest/api/3/issue/10001",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("handleWorkitem — input validation", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await handleWorkitem({ body: "not json" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/valid JSON/i);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await handleWorkitem(makeRequest({ project: "HSP" }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/issueType/i);
  });

  it("returns 400 when fields is an array", async () => {
    const res = await handleWorkitem(
      makeRequest({ project: "HSP", issueType: "Story", fields: [] }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when update is not an object", async () => {
    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: {},
        update: "bad",
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for null body", async () => {
    const res = await handleWorkitem({ body: "null" });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Field resolution errors
// ---------------------------------------------------------------------------

describe("handleWorkitem — field resolution errors", () => {
  it("returns 400 with detail for not_found fields", async () => {
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

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { "Unknown Field": 1 },
      }),
    );

    // fallow-ignore-next-line code-duplication
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/1 field/i);
    expect(body.errors[0].reason).toBe("not_found");
  });

  it("returns 400 with detail for ambiguous fields", async () => {
    mockResolveFieldNames.mockResolvedValue(
      err({
        type: "https://httpstatuses.io/400",
        title: "Bad Request",
        status: 400,
        detail: "Field name resolution failed for 1 field(s).",
        timestamp: new Date().toISOString(),
        errors: [
          {
            field: "Priority Score",
            reason: "ambiguous" as const,
            message:
              "'Priority Score' is ambiguous — matches: Priority Score (customfield_10100), Priority Score (customfield_10200)",
          },
        ],
      }),
    );

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { "Priority Score": 3 },
      }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0].reason).toBe("ambiguous");
  });

  it("returns all errors at once (multiple failures)", async () => {
    mockResolveFieldNames.mockResolvedValue(
      err({
        type: "https://httpstatuses.io/400",
        title: "Bad Request",
        status: 400,
        detail: "Field name resolution failed for 3 field(s).",
        timestamp: new Date().toISOString(),
        errors: [
          {
            field: "FieldA",
            reason: "not_found" as const,
            message: "No field named 'FieldA'.",
          },
          {
            field: "FieldB",
            reason: "not_found" as const,
            message: "No field named 'FieldB'.",
          },
          {
            field: "FieldC",
            reason: "ambiguous" as const,
            message: "'FieldC' is ambiguous.",
          },
        ],
      }),
    );

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { FieldA: 1, FieldB: 2, FieldC: 3 },
      }),
    );

    // fallow-ignore-next-line code-duplication
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/3 field/i);
    expect(body.errors).toHaveLength(3);
  });

  it("returns 400 when the project is not found", async () => {
    const { ProjectNotFoundError } = await import(
      "../../src/workitem/jira-client"
    );
    mockResolveFieldNames.mockRejectedValue(
      new ProjectNotFoundError("MISSING"),
    );

    const res = await handleWorkitem(
      makeRequest({
        project: "MISSING",
        issueType: "Story",
        fields: { Summary: "Test" },
      }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/MISSING/);
  });

  it("returns 500 when the field resolver throws", async () => {
    mockResolveFieldNames.mockRejectedValue(new Error("Jira unreachable"));

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "Test" },
      }),
    );

    // fallow-ignore-next-line code-duplication
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/metadata/i);
  });
});

// ---------------------------------------------------------------------------
// Successful creation
// ---------------------------------------------------------------------------

describe("handleWorkitem — successful creation", () => {
  it("returns 201 with issue details on success", async () => {
    mockResolveFieldNames.mockResolvedValue(SUCCESS_RESOLUTION);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "My Story", "Story Points": 5 },
      }),
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.key).toBe("HSP-42");
    expect(body.id).toBe("10001");
  });

  it("translates field names to IDs in the Jira call", async () => {
    mockResolveFieldNames.mockResolvedValue(SUCCESS_RESOLUTION);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "My Story", "Story Points": 5 },
      }),
    );

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          summary: "My Story",
          customfield_10016: 5,
          project: { key: "HSP" },
          issuetype: { name: "Story" },
        }),
      }),
    );
  });

  it("includes translated update map when provided", async () => {
    const resolutionWithLabels = makeResolution([
      ["Summary", "summary"],
      ["Labels", "labels"],
    ]);
    mockResolveFieldNames.mockResolvedValue(resolutionWithLabels);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "My Story" },
        update: { Labels: [{ add: "bugfix" }] },
      }),
    );

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { labels: [{ add: "bugfix" }] },
      }),
    );
  });

  it("omits update key when no update fields provided", async () => {
    mockResolveFieldNames.mockResolvedValue(
      makeResolution([["Summary", "summary"]]),
    );
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "No Update" },
      }),
    );

    const call = mockCreateIssue.mock.calls[0][0];
    expect(call.update).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Jira API error forwarding
// ---------------------------------------------------------------------------

describe("handleWorkitem — Jira API error forwarding", () => {
  it("forwards Jira 400 errors with their status and body", async () => {
    mockResolveFieldNames.mockResolvedValue(SUCCESS_RESOLUTION);
    const jiraError = new JiraApiError(
      400,
      JSON.stringify({ errorMessages: ["Field required"] }),
    );
    mockCreateIssue.mockRejectedValue(jiraError);

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "Test", "Story Points": 3 },
      }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errorMessages).toContain("Field required");
  });

  it("returns 500 for unexpected errors from createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(SUCCESS_RESOLUTION);
    mockCreateIssue.mockRejectedValue(new Error("Network timeout"));

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "Test", "Story Points": 3 },
      }),
    );

    // fallow-ignore-next-line code-duplication
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/create issue/i);
  });
});

// ---------------------------------------------------------------------------
// Real Forge request envelope
// ---------------------------------------------------------------------------

describe("handleWorkitem — real Forge request envelope", () => {
  it("accepts the full Forge App REST API request shape and returns 201", async () => {
    // Uses the fixture captured from a live Forge invocation to confirm the
    // handler correctly reads req.body from the full envelope (not the envelope
    // itself). Regression test for the asUser→asApp bug that caused 500s.
    const fixture = (await import("../data/requests/workitem.json")) as {
      body: string;
    };

    mockResolveFieldNames.mockResolvedValue(
      makeResolution([["Summary", "summary"]]),
    );
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const res = await handleWorkitem(fixture);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.key).toBe(CREATED_ISSUE.key);
  });
});

// ---------------------------------------------------------------------------
// OTel — input validation
// ---------------------------------------------------------------------------

describe("handleWorkitem — OTel input validation", () => {
  it("returns 400 when traceId is not 32 lowercase hex chars", async () => {
    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "Test" },
        otel: { traceId: "tooshort", spanId: "abcd1234abcd1234" },
      }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/traceId|issueType|project/i);
  });

  it("returns 400 when spanId is not 16 lowercase hex chars", async () => {
    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "Test" },
        otel: {
          traceId: "a".repeat(32),
          spanId: "UPPERCASE00000000", // uppercase — invalid
        },
      }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/spanId|issueType|project/i);
  });

  it("accepts request without otel field (otel is optional)", async () => {
    mockResolveFieldNames.mockResolvedValue(
      makeResolution([["Summary", "summary"]]),
    );
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "No OTel" },
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(mockWriteOtelProperty).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// OTel — property write (happy path)
// ---------------------------------------------------------------------------

describe("handleWorkitem — OTel property write", () => {
  it("calls writeOtelProperty with issueKey and otel context after creation", async () => {
    mockResolveFieldNames.mockResolvedValue(
      makeResolution([["Summary", "summary"]]),
    );
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);
    mockWriteOtelProperty.mockResolvedValue(undefined);

    const otel = {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      traceFlags: "01",
      traceState: "vendor=abc",
    };

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "OTel Story" },
        otel,
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(mockWriteOtelProperty).toHaveBeenCalledOnce();
    expect(mockWriteOtelProperty).toHaveBeenCalledWith(CREATED_ISSUE.key, otel);
  });

  it("still returns 201 even when writeOtelProperty rejects (best-effort)", async () => {
    mockResolveFieldNames.mockResolvedValue(
      makeResolution([["Summary", "summary"]]),
    );
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);
    // Simulate a failed property write — should NOT affect the response
    mockWriteOtelProperty.mockRejectedValue(
      new Error("Jira property write failed"),
    );

    const res = await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "OTel Story" },
        otel: { traceId: "a".repeat(32), spanId: "b".repeat(16) },
      }),
    );

    // The handler fires the write as `void` so rejection must not propagate
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.key).toBe(CREATED_ISSUE.key);
  });

  it("does not call writeOtelProperty when otel is absent", async () => {
    mockResolveFieldNames.mockResolvedValue(
      makeResolution([["Summary", "summary"]]),
    );
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitem(
      makeRequest({
        project: "HSP",
        issueType: "Story",
        fields: { Summary: "No OTel" },
      }),
    );

    expect(mockWriteOtelProperty).not.toHaveBeenCalled();
  });
});
