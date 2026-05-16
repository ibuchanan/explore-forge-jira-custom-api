/**
 * Unit tests for jira/issue.ts pure functions.
 *
 * Tests cover:
 *  - mapFieldsToRealized: resolves ContentFields to their Jira metadata
 *  - mapFieldsToExpand: extracts field keys for the Jira expand parameter
 *  - mapResultToCard: maps a Jira API response to a structured IssueCard
 */

import { describe, expect, it } from "vitest";
import {
  ContentType,
  mapFieldsToExpand,
  mapFieldsToRealized,
  mapResultToCard,
} from "../../src/jira/issue";
import type {
  ContentField,
  Meta,
  RealizedContentField,
  ResultIssue,
} from "../../src/jira/issue";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const META: Meta = {
  fields: {
    summary: {
      schema: { type: "string", system: "summary" },
      name: "Summary",
      key: "summary",
    },
    priority: {
      schema: { type: "priority", system: "priority" },
      name: "Priority",
      key: "priority",
    },
    assignee: {
      schema: { type: "user", system: "assignee" },
      name: "Assignee",
      key: "assignee",
    },
    customfield_10016: {
      schema: {
        type: "number",
        system: "",
        custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
      },
      name: "Story Points",
      key: "customfield_10016",
    },
  },
};

// ---------------------------------------------------------------------------
// mapFieldsToRealized
// ---------------------------------------------------------------------------

describe("mapFieldsToRealized", () => {
  it("resolves a known field to its key and schema", () => {
    const fields: ContentField[] = [
      { name: "Summary", type: ContentType.Specified },
    ];
    const realized = mapFieldsToRealized(fields, META);
    expect(realized).toHaveLength(1);
    expect(realized[0]?.key).toBe("summary");
    expect(realized[0]?.schema?.type).toBe("string");
  });

  it("returns undefined key and schema for unknown field name", () => {
    const fields: ContentField[] = [
      { name: "NonExistent", type: ContentType.Frontmatter },
    ];
    const realized = mapFieldsToRealized(fields, META);
    expect(realized[0]?.key).toBeUndefined();
    expect(realized[0]?.schema).toBeUndefined();
  });

  it("preserves the ContentType from the input field", () => {
    const fields: ContentField[] = [
      { name: "Priority", type: ContentType.Frontmatter },
    ];
    const realized = mapFieldsToRealized(fields, META);
    expect(realized[0]?.type).toBe(ContentType.Frontmatter);
  });

  it("maps multiple fields at once", () => {
    const fields: ContentField[] = [
      { name: "Summary", type: ContentType.Specified },
      { name: "Priority", type: ContentType.Frontmatter },
      { name: "Assignee", type: ContentType.Frontmatter },
    ];
    const realized = mapFieldsToRealized(fields, META);
    expect(realized).toHaveLength(3);
    expect(realized[0]?.key).toBe("summary");
    expect(realized[1]?.key).toBe("priority");
    expect(realized[2]?.key).toBe("assignee");
  });
});

// ---------------------------------------------------------------------------
// mapFieldsToExpand
// ---------------------------------------------------------------------------

describe("mapFieldsToExpand", () => {
  it("returns the key for each realized field that has one", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Summary",
        type: ContentType.Specified,
        key: "summary",
        schema: { type: "string", system: "summary" },
      },
      {
        name: "Priority",
        type: ContentType.Frontmatter,
        key: "priority",
        schema: { type: "priority", system: "priority" },
      },
    ];
    expect(mapFieldsToExpand(realized)).toEqual(["summary", "priority"]);
  });

  it("omits fields with undefined key", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Unknown",
        type: ContentType.Frontmatter,
        key: undefined,
        schema: undefined,
      },
      {
        name: "Summary",
        type: ContentType.Specified,
        key: "summary",
        schema: { type: "string", system: "summary" },
      },
    ];
    expect(mapFieldsToExpand(realized)).toEqual(["summary"]);
  });

  it("returns empty array when all fields have undefined keys", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Unknown",
        type: ContentType.Frontmatter,
        key: undefined,
        schema: undefined,
      },
    ];
    expect(mapFieldsToExpand(realized)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mapResultToCard
// ---------------------------------------------------------------------------

describe("mapResultToCard", () => {
  const baseResponse: ResultIssue<Record<string, unknown>> = {
    expand: "",
    id: "10001",
    self: "https://example.atlassian.net/rest/api/3/issue/10001",
    key: "HSP-42",
    fields: {
      summary: "Fix the login bug",
      priority: { name: "High" },
      assignee: { displayName: "Alice" },
    },
  };

  it("maps key and self to specified fields", () => {
    const card = mapResultToCard(baseResponse, []);
    expect(card.specified.key).toBe("HSP-42");
    expect(card.specified.url).toBe(baseResponse.self);
  });

  it("maps summary from fields", () => {
    const card = mapResultToCard(baseResponse, []);
    expect(card.specified.summary).toBe("Fix the login bug");
  });

  it("description is undefined when renderedFields is absent", () => {
    const card = mapResultToCard(baseResponse, []);
    expect(card.specified.description).toBeUndefined();
  });

  it("maps description from renderedFields when present", () => {
    const response = {
      ...baseResponse,
      renderedFields: { description: "<p>rendered</p>" },
    };
    const card = mapResultToCard(response, []);
    expect(card.specified.description).toBe("<p>rendered</p>");
  });

  it("maps a priority frontmatter field using the priority mapper", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Priority",
        type: ContentType.Frontmatter,
        key: "priority",
        schema: { type: "priority", system: "priority" },
      },
    ];
    const card = mapResultToCard(baseResponse, realized);
    expect(card.frontmatter.Priority).toBe("High");
  });

  it("maps a user frontmatter field using displayName", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Assignee",
        type: ContentType.Frontmatter,
        key: "assignee",
        schema: { type: "user", system: "assignee" },
      },
    ];
    const card = mapResultToCard(baseResponse, realized);
    expect(card.frontmatter.Assignee).toBe("Alice");
  });

  it("skips frontmatter fields with undefined key", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Unknown",
        type: ContentType.Frontmatter,
        key: undefined,
        schema: undefined,
      },
    ];
    const card = mapResultToCard(baseResponse, realized);
    expect(card.frontmatter.Unknown).toBeUndefined();
  });

  it("skips array-type fields (not yet supported)", () => {
    const realized: RealizedContentField[] = [
      {
        name: "Labels",
        type: ContentType.Frontmatter,
        key: "labels",
        schema: { type: "array", system: "labels", items: "string" },
      },
    ];
    const card = mapResultToCard(baseResponse, realized);
    expect(card.frontmatter.Labels).toBeUndefined();
  });

  it("produces empty frontmatter and rendered when no realized fields", () => {
    const card = mapResultToCard(baseResponse, []);
    expect(card.frontmatter).toEqual({});
    expect(card.rendered).toEqual({});
  });
});
