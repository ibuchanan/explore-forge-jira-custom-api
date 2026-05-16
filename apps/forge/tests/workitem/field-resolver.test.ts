/**
 * Unit tests for the field name resolver.
 *
 * Uses injected mock dependencies so no Jira network calls are made.
 */

import type { components } from "forge-ahead/jira/platform-3";
import { describe, expect, it } from "vitest";
import type { FieldResolverDeps } from "../../src/workitem/field-resolver";
import {
  resolveFieldNames,
  translateKeys,
} from "../../src/workitem/field-resolver";

type JiraFieldMeta = components["schemas"]["FieldCreateMetadata"] & {
  clauseNames?: string[];
};
type JiraIssueTypeMeta = components["schemas"]["IssueTypeIssueCreateMetadata"];

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ISSUE_TYPES: JiraIssueTypeMeta[] = [
  {
    id: "10001",
    name: "Story",
    self: "https://example.atlassian.net/rest/api/3/issuetype/10001",
  },
  {
    id: "10002",
    name: "Bug",
    self: "https://example.atlassian.net/rest/api/3/issuetype/10002",
  },
];

const FIELDS_FOR_STORY: JiraFieldMeta[] = [
  {
    fieldId: "summary",
    name: "Summary",
    clauseNames: ["summary"],
  },
  {
    fieldId: "customfield_10016",
    name: "Story Points",
    clauseNames: ["story_points", "cf[10016]"],
    schema: {
      type: "number",
      custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
      customId: 10016,
    },
  },
  {
    fieldId: "assignee",
    name: "Assignee",
    clauseNames: ["assignee"],
  },
  {
    fieldId: "labels",
    name: "Labels",
    clauseNames: ["labels"],
  },
];

function makeDeps(
  issueTypes: JiraIssueTypeMeta[] = ISSUE_TYPES,
  fields: JiraFieldMeta[] = FIELDS_FOR_STORY,
): FieldResolverDeps {
  return {
    getIssueTypes: async (_projectKey: string) => issueTypes,
    getFieldsForIssueType: async (_projectKey: string, _issueTypeId: string) =>
      fields,
  };
}

/** Resolve a set of names against the default Story issue type in project HSP. */
async function resolveStory(
  names: string[],
  deps: FieldResolverDeps = makeDeps(),
) {
  return resolveFieldNames("HSP", "Story", new Set(names), deps);
}

/** Resolve against a given issue type name in project HSP. */
async function resolveAs(issueType: string, names: string[]) {
  return resolveFieldNames("HSP", issueType, new Set(names), makeDeps());
}

// ---------------------------------------------------------------------------
// resolveFieldNames — success paths
// ---------------------------------------------------------------------------

describe("resolveFieldNames — success", () => {
  it("resolves a standard field by display name", async () => {
    const result = await resolveStory(["Summary"]);
    // fallow-ignore-next-line code-duplication
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("Summary")).toBe("summary");
  });

  it("resolves a custom field by display name", async () => {
    const result = await resolveStory(["Story Points"]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("Story Points")).toBe("customfield_10016");
  });

  it("resolves a field by clause name", async () => {
    const result = await resolveStory(["story_points"]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("story_points")).toBe("customfield_10016");
  });

  it("resolves a field by its raw fieldId", async () => {
    const result = await resolveStory(["customfield_10016"]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("customfield_10016")).toBe(
      "customfield_10016",
    );
  });

  it("resolves multiple fields at once", async () => {
    const result = await resolveStory(["Summary", "Story Points", "Assignee"]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("Summary")).toBe("summary");
    expect(result.value.resolved.get("Story Points")).toBe("customfield_10016");
    expect(result.value.resolved.get("Assignee")).toBe("assignee");
  });

  it("is case-insensitive for display names", async () => {
    const result = await resolveStory(["story points", "SUMMARY"]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("story points")).toBe("customfield_10016");
    expect(result.value.resolved.get("SUMMARY")).toBe("summary");
  });

  it("resolves issue type name case-insensitively", async () => {
    const result = await resolveAs("story", ["Summary"]); // lowercase issue type
    // fallow-ignore-next-line code-duplication
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved.get("Summary")).toBe("summary");
  });

  it("returns fieldMetaById mapping for all resolved fields", async () => {
    const result = await resolveStory(["Story Points"]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const meta = result.value.fieldMetaById.get("customfield_10016");
    expect(meta).toBeDefined();
    expect(meta?.name).toBe("Story Points");
  });
});

// ---------------------------------------------------------------------------
// resolveFieldNames — error paths
// ---------------------------------------------------------------------------

describe("resolveFieldNames — errors", () => {
  it("returns error when issue type does not exist", async () => {
    const result = await resolveAs("Epic", ["Summary"]); // Epic not in fixtures
    // fallow-ignore-next-line code-duplication
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.status).toBe(400);
    expect(result.error.detail).toMatch(/Epic/);
    expect(result.error.detail).toMatch(/not found/i);
  });

  it("returns error for an unknown field name", async () => {
    const result = await resolveStory(["NonExistentField"]);
    // fallow-ignore-next-line code-duplication
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.status).toBe(400);
    // detail is a summary; field names are in errors[]
    expect(result.error.errors).toBeDefined();
    const fieldError = result.error.errors?.find(
      (e) => e.field === "NonExistentField",
    );
    expect(fieldError).toBeDefined();
    expect(fieldError?.reason).toBe("not_found");
  });

  it("collects ALL not_found errors before returning", async () => {
    const result = await resolveStory(["FieldA", "FieldB", "FieldC"]);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.detail).toMatch(/3 field/i);
    expect(result.error.errors).toHaveLength(3);
    const fields = result.error.errors?.map((e) => e.field) ?? [];
    expect(fields).toContain("FieldA");
    expect(fields).toContain("FieldB");
    expect(fields).toContain("FieldC");
  });

  it("returns error for ambiguous field name", async () => {
    const ambiguousFields: JiraFieldMeta[] = [
      { fieldId: "customfield_10100", name: "Priority Score", clauseNames: [] },
      { fieldId: "customfield_10200", name: "Priority Score", clauseNames: [] },
    ];
    const result = await resolveStory(
      ["Priority Score"],
      makeDeps(ISSUE_TYPES, ambiguousFields),
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.status).toBe(400);
    const fieldError = result.error.errors?.find(
      (e) => e.field === "Priority Score",
    );
    expect(fieldError).toBeDefined();
    expect(fieldError?.reason).toBe("ambiguous");
    expect(fieldError?.message).toMatch(/ambiguous/i);
  });

  it("mixes not_found and valid results, collecting all errors", async () => {
    const result = await resolveStory(["Summary", "MissingField"]);
    // fallow-ignore-next-line code-duplication
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    const fieldError = result.error.errors?.find(
      (e) => e.field === "MissingField",
    );
    expect(fieldError).toBeDefined();
    expect(fieldError?.reason).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// translateKeys
// ---------------------------------------------------------------------------

describe("translateKeys", () => {
  it("translates known keys using the resolved map", () => {
    const resolved = new Map([
      ["Story Points", "customfield_10016"],
      ["Assignee", "assignee"],
    ]);
    const input = { "Story Points": 5, Assignee: { accountId: "abc123" } };
    const output = translateKeys(input, resolved);
    expect(output).toEqual({
      customfield_10016: 5,
      assignee: { accountId: "abc123" },
    });
  });

  it("passes through unknown keys unchanged", () => {
    const resolved = new Map([["Story Points", "customfield_10016"]]);
    const input = { "Story Points": 8, summary: "My issue" };
    const output = translateKeys(input, resolved);
    expect(output).toEqual({ customfield_10016: 8, summary: "My issue" });
  });

  it("handles empty input", () => {
    const output = translateKeys({}, new Map());
    expect(output).toEqual({});
  });
});
