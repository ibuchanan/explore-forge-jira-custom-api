/**
 * Tests for POST /workitem/upsert/as-user — the raiseOnBehalfOf upsert endpoint.
 *
 * Key behaviours under test:
 *  - 400 when `raiseOnBehalfOf` is absent
 *  - 400 when `dedup` is absent or empty
 *  - 400 for other invalid bodies
 *  - createIssue and searchIssues called with asUser(raiseOnBehalfOf) auth client
 *  - raiseOnBehalfOf is NOT forwarded to the Jira issue body
 *  - Dedup hit: 200 with created: false
 *  - No dedup match: 200 with created: true
 *  - Cross-project warning on dedup hit
 *  - OTel property write after creation
 *  - Jira API error forwarding (create + search)
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
  searchIssues,
  writeOtelProperty,
} from "../../src/workitem/jira-client";
import { handleWorkitemUpsertAsUser } from "../../src/workitem/upsert-as-user-handler";
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
  searchIssues: vi.fn(),
  writeOtelProperty: vi.fn().mockResolvedValue(undefined),
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
const mockSearchIssues = vi.mocked(searchIssues);
const mockWriteOtelProperty = vi.mocked(writeOtelProperty);

// makeRequest and makeResolution are imported from ./test-helpers

const CREATED_ISSUE = { id: "10001", key: "HSP-1", self: "https://jira/i/1" };

const VALID_BODY = {
  project: "HSP",
  issueType: "Story",
  fields: { Summary: "My Story" },
  dedup: 'project = HSP AND summary ~ "My Story"',
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
// Validation
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsertAsUser — validation", () => {
  it("returns 400 when raiseOnBehalfOf is absent", async () => {
    const { raiseOnBehalfOf: _rob, ...bodyWithout } = VALID_BODY;
    const res = await handleWorkitemUpsertAsUser(await makeRequest(bodyWithout));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/raiseOnBehalfOf/i);
  });

  it("returns 400 when raiseOnBehalfOf is an empty string", async () => {
    const res = await handleWorkitemUpsertAsUser(
      await makeRequest({ ...VALID_BODY, raiseOnBehalfOf: "" }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/raiseOnBehalfOf/i);
  });

  it("returns 400 when dedup is absent", async () => {
    const { dedup: _d, ...bodyWithout } = VALID_BODY;
    const res = await handleWorkitemUpsertAsUser(await makeRequest(bodyWithout));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/dedup/i);
  });

  it("returns 400 when dedup is empty string", async () => {
    const res = await handleWorkitemUpsertAsUser(
      await makeRequest({ ...VALID_BODY, dedup: "" }),
    );

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/dedup/i);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await handleWorkitemUpsertAsUser(await makeRawRequest("not json"));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when project is missing", async () => {
    const { project: _p, ...bodyWithout } = VALID_BODY;
    const res = await handleWorkitemUpsertAsUser(await makeRequest(bodyWithout));
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Auth — asUser(raiseOnBehalfOf) forwarded to createIssue and searchIssues
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsertAsUser — auth client forwarding", () => {
  it("passes asUser(raiseOnBehalfOf) to searchIssues", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(vi.mocked(api.asUser)).toHaveBeenCalledWith("user-account-123");
    const [, , authArg] = mockSearchIssues.mock.calls[0];
    expect(authArg).toBeDefined();
  });

  it("passes asUser(raiseOnBehalfOf) to createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    const [, authArg] = mockCreateIssue.mock.calls[0];
    expect(authArg).toBeDefined();
  });

  it("raiseOnBehalfOf is NOT in the Jira issue body fields", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    const [jiraBody] = mockCreateIssue.mock.calls[0];
    const allFieldKeys = Object.keys(jiraBody.fields);
    expect(allFieldKeys).not.toContain("raiseOnBehalfOf");
  });
});

// ---------------------------------------------------------------------------
// Dedup hit — skip creation, return matches
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsertAsUser — dedup hit", () => {
  it("returns 200 with created: false when duplicates found", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["HSP-1", "HSP-2"]);

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.created).toBe(false);
    expect(body.matches).toEqual(["HSP-1", "HSP-2"]);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("includes cross-project warning when matches are from another project", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["OTHER-5"]);

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    const body = JSON.parse(res.body);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0]).toMatch(/other project/i);
  });

  it("has no cross-project warning when all matches are in the target project", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue(["HSP-1", "HSP-2"]);

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    const body = JSON.parse(res.body);
    expect(body.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No dedup match — create issue
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsertAsUser — creation after no dedup match", () => {
  it("returns 200 with created: true when no duplicates found", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.created).toBe(true);
    expect(body.key).toBe("HSP-1");
    expect(body.matches).toEqual([]);
  });

  it("calls writeOtelProperty when otel is provided and issue is created", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    const otel = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
    await handleWorkitemUpsertAsUser(await makeRequest({ ...VALID_BODY, otel }));

    expect(mockWriteOtelProperty).toHaveBeenCalledWith(CREATED_ISSUE.key, otel);
  });

  it("does not call writeOtelProperty when otel is absent", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue(CREATED_ISSUE);

    await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(mockWriteOtelProperty).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Jira API error forwarding
// ---------------------------------------------------------------------------

describe("handleWorkitemUpsertAsUser — Jira API error forwarding", () => {
  it("forwards Jira JQL error from searchIssues", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    const jiraError = new JiraApiError(
      400,
      JSON.stringify({ errorMessages: ["Invalid JQL"] }),
    );
    mockSearchIssues.mockRejectedValue(jiraError);

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errorMessages).toContain("Invalid JQL");
  });

  it("forwards Jira error from createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    const jiraError = new JiraApiError(
      400,
      JSON.stringify({ errorMessages: ["Field required"] }),
    );
    mockCreateIssue.mockRejectedValue(jiraError);

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errorMessages).toContain("Field required");
  });

  it("returns 500 for unexpected errors from createIssue", async () => {
    mockResolveFieldNames.mockResolvedValue(makeResolution());
    mockSearchIssues.mockResolvedValue([]);
    mockCreateIssue.mockRejectedValue(new Error("Network timeout"));

    const res = await handleWorkitemUpsertAsUser(await makeRequest(VALID_BODY));

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/create issue/i);
  });
});
