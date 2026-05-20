/**
 * Tests for POST /workitem/as-user — the raiseOnBehalfOf insert endpoint.
 *
 * Key behaviours under test:
 *  - 400 when `raiseOnBehalfOf` is absent
 *  - 400 when `raiseOnBehalfOf` is an empty string
 *  - 400 for other invalid bodies (missing project, issueType, fields)
 *  - 400 for invalid JSON
 *  - createIssue is called with asUser(raiseOnBehalfOf) auth client
 *  - raiseOnBehalfOf is NOT forwarded to the Jira issue body
 *  - Successful 201 response with created issue
 *  - Jira API error forwarding
 *  - OTel property write after creation
 */

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  makeAsUserRequest,
  makeRawAsUserRequest,
  makeResolution,
  TEST_WEBTRIGGER_AS_USER_TOKEN,
} from "./test-helpers";

import { resolveFieldNames } from "../../src/workitem/field-resolver";
import {
  createIssue,
  JiraApiError,
  writeOtelProperty,
} from "../../src/workitem/jira-client";
import { handleWorkitemAsUser } from "../../src/workitem/insert-as-user-handler";
import api from "@forge/api";

// Use the dedicated as-user helpers (pre-filled with AUDIENCE_AS_USER)
const makeRequest = makeAsUserRequest;
const makeRawRequest = makeRawAsUserRequest;

vi.mock("../../src/workitem/field-resolver", () => ({
  resolveFieldNames: vi.fn(),
  translateKeys: (obj: Record<string, unknown>, map: Map<string, string>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[map.get(k) ?? k] = v;
    }
    return out;
  },
}));

vi.mock("../../src/workitem/field-coercer", () => ({
  coerceFields: (_fields: Record<string, unknown>) => ({
    ok: true,
    fields: _fields,
    errors: [],
  }),
}));

vi.mock("../../src/workitem/jira-client", () => ({
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

// Mock @forge/api so asUser(accountId) returns a trackable object
const mockRequestJira = vi.fn();
vi.mock("@forge/api", () => ({
  default: {
    asUser: vi.fn((accountId?: string) => ({
      requestJira: mockRequestJira,
      _accountId: accountId,
    })),
    asApp: vi.fn(() => ({ requestJira: mockRequestJira })),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), ""),
}));


const mockResolveFieldNames = vi.mocked(resolveFieldNames);
const mockCreateIssue = vi.mocked(createIssue);
const mockWriteOtelProperty = vi.mocked(writeOtelProperty);

// makeRequest and makeResolution are imported from ./test-helpers

const CREATED_ISSUE = { id: "10001", key: "HSP-1", self: "https://jira/i/1" };

const VALID_BODY = {
  project: "HSP",
  issueType: "Story",
  fields: { Summary: "My Story" },
  raiseOnBehalfOf: "user-account-123",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEBTRIGGER_AS_USER_TOKEN", TEST_WEBTRIGGER_AS_USER_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Validation — raiseOnBehalfOf required
// ---------------------------------------------------------------------------

describe("handleWorkitemAsUser — raiseOnBehalfOf validation", () => {
  it("returns 400 when raiseOnBehalfOf is absent", async () => {
    const { raiseOnBehalfOf: _rob, ...bodyWithout } = VALID_BODY;
    const res = await handleWorkitemAsUser(await makeRequest(bodyWithout));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/raiseOnBehalfOf/i);
  });

  it("returns 400 when raiseOnBehalfOf is an empty string", async () => {
    const res = await handleWorkitemAsUser(
      await makeRequest({ ...VALID_BODY, raiseOnBehalfOf: "" }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/raiseOnBehalfOf/i);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await handleWorkitemAsUser(await makeRawRequest("not json"));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when project is missing", async () => {
    const { project: _p, ...bodyWithout } = VALID_BODY;
    const res = await handleWorkitemAsUser(await makeRequest(bodyWithout));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fields is missing", async () => {
    const { fields: _f, ...bodyWithout } = VALID_BODY;
    const res = await handleWorkitemAsUser(await makeRequest(bodyWithout));
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Auth — createIssue called with asUser(raiseOnBehalfOf)
// ---------------------------------------------------------------------------

describe("handleWorkitemAsUser — auth client forwarding", () => {
  it("passes asUser(raiseOnBehalfOf) auth client to createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    expect(vi.mocked(api.asUser)).toHaveBeenCalledWith("user-account-123");
    expect(mockCreateIssue).toHaveBeenCalledOnce();
    // The second argument to createIssue should be the asUser client
    const [, authArg] = mockCreateIssue.mock.calls[0];
    expect(authArg).toBeDefined();
  });

  it("raiseOnBehalfOf is NOT in the Jira issue body fields", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    const [jiraBody] = mockCreateIssue.mock.calls[0];
    const allFieldKeys = Object.keys(jiraBody.fields);
    expect(allFieldKeys).not.toContain("raiseOnBehalfOf");
  });
});

// ---------------------------------------------------------------------------
// Happy path — successful creation
// ---------------------------------------------------------------------------

describe("handleWorkitemAsUser — successful creation", () => {
  it("returns 201 with created issue on success", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const res = await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe("10001");
    expect(body.key).toBe("HSP-1");
  });

  it("includes project and issuetype in the Jira body", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    const [jiraBody] = mockCreateIssue.mock.calls[0];
    expect(jiraBody.fields.project).toEqual({ key: "HSP" });
    expect(jiraBody.fields.issuetype).toEqual({ name: "Story" });
  });

  it("calls writeOtelProperty after creation when otel is provided", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const otel = {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    };

    const res = await handleWorkitemAsUser(
      await makeRequest({ ...VALID_BODY, otel }),
    );

    expect(res.statusCode).toBe(201);
    expect(mockWriteOtelProperty).toHaveBeenCalledOnce();
    expect(mockWriteOtelProperty).toHaveBeenCalledWith(CREATED_ISSUE.key, otel);
  });

  it("does not call writeOtelProperty when otel is absent", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    expect(mockWriteOtelProperty).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Jira API error forwarding
// ---------------------------------------------------------------------------

describe("handleWorkitemAsUser — Jira API error forwarding", () => {
  it("forwards Jira 400 errors with their status and body", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    const jiraError = new JiraApiError(
      400,
      JSON.stringify({ errorMessages: ["Field required"] }),
    );
    mockCreateIssue.mockRejectedValue(jiraError);

    const res = await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errorMessages).toContain("Field required");
  });

  it("returns 500 for unexpected errors from createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockCreateIssue.mockRejectedValue(new Error("Network timeout"));

    const res = await handleWorkitemAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/create issue/i);
  });
});
