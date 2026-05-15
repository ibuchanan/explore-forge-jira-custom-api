/**
 * Unit tests for the POST /workitem handler.
 *
 * Mocks the field-resolver and jira-client modules so no real network calls
 * are made. Tests validate the full request/response cycle including
 * validation, error aggregation, translation, and Jira proxying.
 */

import { err, ok, StandardError } from "forge-ahead";
import { describe, expect, it, vi, beforeEach } from "vitest";

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
  // getIssueTypes and getFieldsForIssueType are used by defaultDeps in field-resolver;
  // they must be present even though handler tests mock resolveFieldNames at a higher level
  getIssueTypes: vi.fn(),
  getFieldsForIssueType: vi.fn(),
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
import { createIssue, JiraApiError } from "../../src/workitem/jira-client";

const mockResolveFieldNames = vi.mocked(resolveFieldNames);
const mockCreateIssue = vi.mocked(createIssue);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): { body: string } {
  return { body: JSON.stringify(body) };
}

const SUCCESS_RESOLUTION = ok(
  new Map([
    ["Summary", "summary"],
    ["Story Points", "customfield_10016"],
  ]),
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
      StandardError.getOrDefault(400).error(
        'Could not resolve 1 field name(s): "Unknown Field" not found in project "HSP" for issue type "Story"',
      ),
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
    expect(body.detail).toMatch(/not found/i);
  });

  it("returns 400 with detail for ambiguous fields", async () => {
    mockResolveFieldNames.mockResolvedValue(
      StandardError.getOrDefault(400).error(
        '"Priority Score" is ambiguous — matches: Priority Score (customfield_10100), Priority Score (customfield_10200)',
      ),
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
    expect(body.detail).toMatch(/ambiguous/i);
  });

  it("returns all errors at once (multiple failures)", async () => {
    mockResolveFieldNames.mockResolvedValue(
      StandardError.getOrDefault(400).error(
        'Could not resolve 3 field name(s): "FieldA" not found in project "HSP" for issue type "Story"; "FieldB" not found in project "HSP" for issue type "Story"; "FieldC" is ambiguous — matches: FieldC (cf1), FieldC (cf2)',
      ),
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
    const resolutionWithLabels = ok(
      new Map([
        ["Summary", "summary"],
        ["Labels", "labels"],
      ]),
    );
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
    mockResolveFieldNames.mockResolvedValue(ok(new Map([["Summary", "summary"]])));
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
