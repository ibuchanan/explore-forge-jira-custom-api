/**
 * Unit tests for the field value coercion registry.
 *
 * Tests the coerceFieldValue and coerceFields functions that translate
 * human-readable caller values into the exact shapes the Jira REST API expects.
 */

import { describe, expect, it } from "vitest";
import type { FieldMeta } from "../../src/workitem/field-coercer";
import {
  coerceFieldValue,
  coerceFields,
} from "../../src/workitem/field-coercer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(overrides: Partial<FieldMeta> = {}): FieldMeta {
  return {
    fieldId: "customfield_99999",
    name: "Test Field",
    schema: { type: "string", system: "string" },
    ...overrides,
  } as FieldMeta;
}

function schema(type: string, items?: string, custom?: string) {
  return { type, ...(items ? { items } : {}), ...(custom ? { custom } : {}) };
}

// ---------------------------------------------------------------------------
// pass-through (no schema)
// ---------------------------------------------------------------------------

describe("coerceFieldValue — no schema (pass-through)", () => {
  it("passes through value when field has no schema", () => {
    const meta = makeMeta({ schema: undefined });
    const result = coerceFieldValue("anything", "Field", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("anything");
  });
});

// ---------------------------------------------------------------------------
// string
// ---------------------------------------------------------------------------

describe("coerceFieldValue — string", () => {
  it("passes string through unchanged", () => {
    const meta = makeMeta({ schema: schema("string") });
    const result = coerceFieldValue("some text", "Summary", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("some text");
  });

  it("returns error for non-string", () => {
    const meta = makeMeta({ schema: schema("string") });
    const result = coerceFieldValue(42, "Summary", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
  });
});

// ---------------------------------------------------------------------------
// number
// ---------------------------------------------------------------------------

describe("coerceFieldValue — number", () => {
  it("passes number through unchanged", () => {
    const meta = makeMeta({ schema: schema("number") });
    const result = coerceFieldValue(5, "Story Points", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(5);
  });

  it("returns error for non-number", () => {
    const meta = makeMeta({ schema: schema("number") });
    const result = coerceFieldValue("five", "Story Points", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
  });
});

// ---------------------------------------------------------------------------
// priority
// ---------------------------------------------------------------------------

describe("coerceFieldValue — priority", () => {
  it("wraps string in { name } object", () => {
    const meta = makeMeta({ schema: schema("priority") });
    const result = coerceFieldValue("High", "Priority", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ name: "High" });
  });

  it("returns error for non-string", () => {
    const meta = makeMeta({ schema: schema("priority") });
    const result = coerceFieldValue(1, "Priority", meta);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// option (select)
// ---------------------------------------------------------------------------

describe("coerceFieldValue — option", () => {
  const allowedValues = [
    { value: "Bug" },
    { value: "Feature" },
    { value: "Task" },
  ];

  it("wraps valid option in { value } object", () => {
    const meta = makeMeta({ schema: schema("option"), allowedValues });
    const result = coerceFieldValue("Bug", "Type", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ value: "Bug" });
  });

  it("is case-insensitive against allowedValues", () => {
    const meta = makeMeta({ schema: schema("option"), allowedValues });
    const result = coerceFieldValue("bug", "Type", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ value: "bug" });
  });

  it("returns error for value not in allowedValues", () => {
    const meta = makeMeta({ schema: schema("option"), allowedValues });
    const result = coerceFieldValue("Epic", "Type", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
    expect(result.error.message).toMatch(/Bug|Feature|Task/);
  });

  it("accepts any value when allowedValues is empty", () => {
    const meta = makeMeta({ schema: schema("option"), allowedValues: [] });
    const result = coerceFieldValue("Anything", "Type", meta);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// user
// ---------------------------------------------------------------------------

describe("coerceFieldValue — user", () => {
  it("wraps accountId string in { accountId } object", () => {
    const meta = makeMeta({ schema: schema("user") });
    const result = coerceFieldValue("accountId-xyz", "Assignee", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ accountId: "accountId-xyz" });
  });

  it("returns error for non-string", () => {
    const meta = makeMeta({ schema: schema("user") });
    const result = coerceFieldValue({ accountId: "abc" }, "Assignee", meta);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

describe("coerceFieldValue — version", () => {
  it("wraps version name in { name } object", () => {
    const meta = makeMeta({ schema: schema("version") });
    const result = coerceFieldValue("v1.2", "Fix Version", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ name: "v1.2" });
  });
});

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

describe("coerceFieldValue — component", () => {
  it("wraps component name in { name } object", () => {
    const meta = makeMeta({ schema: schema("component") });
    const result = coerceFieldValue("Frontend", "Component", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ name: "Frontend" });
  });
});

// ---------------------------------------------------------------------------
// date
// ---------------------------------------------------------------------------

describe("coerceFieldValue — date", () => {
  it("passes valid ISO date string through unchanged", () => {
    const meta = makeMeta({ schema: schema("date") });
    const result = coerceFieldValue("2026-05-16", "Due Date", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("2026-05-16");
  });

  it("returns error for invalid date format", () => {
    const meta = makeMeta({ schema: schema("date") });
    const result = coerceFieldValue("16/05/2026", "Due Date", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
  });

  it("returns error for datetime string as date", () => {
    const meta = makeMeta({ schema: schema("date") });
    const result = coerceFieldValue(
      "2026-05-16T09:00:00.000Z",
      "Due Date",
      meta,
    );
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// datetime
// ---------------------------------------------------------------------------

describe("coerceFieldValue — datetime", () => {
  it("passes valid ISO datetime string through unchanged", () => {
    const meta = makeMeta({ schema: schema("datetime") });
    const result = coerceFieldValue(
      "2026-05-16T09:00:00.000Z",
      "Start Date",
      meta,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("2026-05-16T09:00:00.000Z");
  });

  it("returns error for date-only string", () => {
    const meta = makeMeta({ schema: schema("datetime") });
    const result = coerceFieldValue("2026-05-16", "Start Date", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
  });
});

// ---------------------------------------------------------------------------
// array of option (multi-select)
// ---------------------------------------------------------------------------

describe("coerceFieldValue — array of option", () => {
  const allowedValues = [
    { value: "bug" },
    { value: "ui" },
    { value: "backend" },
  ];

  it("maps each string to { value } object", () => {
    const meta = makeMeta({ schema: schema("array", "option"), allowedValues });
    const result = coerceFieldValue(["bug", "ui"], "Labels", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ value: "bug" }, { value: "ui" }]);
  });

  it("returns error when one item is not in allowedValues", () => {
    const meta = makeMeta({ schema: schema("array", "option"), allowedValues });
    const result = coerceFieldValue(["bug", "invalid-label"], "Labels", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
  });

  it("returns error for non-array input", () => {
    const meta = makeMeta({ schema: schema("array", "option"), allowedValues });
    const result = coerceFieldValue("bug", "Labels", meta);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// array of user (multi-user picker)
// ---------------------------------------------------------------------------

describe("coerceFieldValue — array of user", () => {
  it("maps each accountId to { accountId } object", () => {
    const meta = makeMeta({ schema: schema("array", "user") });
    const result = coerceFieldValue(
      ["accountId-a", "accountId-b"],
      "Watchers",
      meta,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { accountId: "accountId-a" },
      { accountId: "accountId-b" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// array of version
// ---------------------------------------------------------------------------

describe("coerceFieldValue — array of version", () => {
  it("maps each version name to { name } object", () => {
    const meta = makeMeta({ schema: schema("array", "version") });
    const result = coerceFieldValue(["v1.2", "v1.3"], "Fix Versions", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ name: "v1.2" }, { name: "v1.3" }]);
  });
});

// ---------------------------------------------------------------------------
// array of component
// ---------------------------------------------------------------------------

describe("coerceFieldValue — array of component", () => {
  it("maps each component name to { name } object", () => {
    const meta = makeMeta({ schema: schema("array", "component") });
    const result = coerceFieldValue(
      ["Frontend", "Backend"],
      "Components",
      meta,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ name: "Frontend" }, { name: "Backend" }]);
  });
});

// ---------------------------------------------------------------------------
// sprint (custom field)
// ---------------------------------------------------------------------------

describe("coerceFieldValue — sprint", () => {
  const SPRINT_CUSTOM = "com.pyxis.greenhopper.jira:gh-sprint";

  it("resolves sprint name to its ID from allowedValues", () => {
    const meta = makeMeta({
      schema: schema("array", "json", SPRINT_CUSTOM),
      allowedValues: [
        { id: 101, name: "Sprint 1" },
        { id: 102, name: "Sprint 2" },
      ],
    });
    const result = coerceFieldValue("Sprint 2", "Sprint", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(102);
  });

  it("returns error for unknown sprint name", () => {
    const meta = makeMeta({
      schema: schema("array", "json", SPRINT_CUSTOM),
      allowedValues: [{ id: 101, name: "Sprint 1" }],
    });
    const result = coerceFieldValue("Sprint 99", "Sprint", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid_value");
    expect(result.error.message).toMatch(/Sprint 1/);
  });

  it("passes through string when no allowedValues available", () => {
    const meta = makeMeta({
      schema: schema("array", "json", SPRINT_CUSTOM),
      allowedValues: [],
    });
    const result = coerceFieldValue("Sprint 3", "Sprint", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("Sprint 3");
  });
});

// ---------------------------------------------------------------------------
// cascading select (excluded)
// ---------------------------------------------------------------------------

describe("coerceFieldValue — cascading select (excluded)", () => {
  const CASCADING_CUSTOM =
    "com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect";

  it("returns unsupported_type error", () => {
    const meta = makeMeta({
      schema: schema("option", undefined, CASCADING_CUSTOM),
    });
    const result = coerceFieldValue({ child: "x" }, "Cascading", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("unsupported_type");
  });
});

// ---------------------------------------------------------------------------
// unknown type
// ---------------------------------------------------------------------------

describe("coerceFieldValue — unknown type", () => {
  it("returns unsupported_type for unrecognised schema type", () => {
    const meta = makeMeta({ schema: schema("attachment") });
    const result = coerceFieldValue("file.pdf", "Attachment", meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("unsupported_type");
    expect(result.error.message).toMatch(/attachment/i);
  });
});

// ---------------------------------------------------------------------------
// coerceFields (batch)
// ---------------------------------------------------------------------------

describe("coerceFields — batch coercion", () => {
  it("coerces all fields successfully", () => {
    const fieldMetaById = new Map<string, FieldMeta>([
      [
        "priority",
        makeMeta({
          fieldId: "priority",
          name: "Priority",
          schema: schema("priority"),
        }),
      ],
      [
        "customfield_10016",
        makeMeta({
          fieldId: "customfield_10016",
          name: "Story Points",
          schema: schema("number"),
        }),
      ],
    ]);
    const resolved = new Map([
      ["Priority", "priority"],
      ["Story Points", "customfield_10016"],
    ]);
    const translatedFields = { priority: "High", customfield_10016: 5 };

    const result = coerceFields(translatedFields, fieldMetaById, resolved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.priority).toEqual({ name: "High" });
    expect(result.fields.customfield_10016).toBe(5);
  });

  it("collects all coercion errors before returning", () => {
    const fieldMetaById = new Map<string, FieldMeta>([
      [
        "priority",
        makeMeta({
          fieldId: "priority",
          name: "Priority",
          schema: schema("priority"),
        }),
      ],
      [
        "assignee",
        makeMeta({
          fieldId: "assignee",
          name: "Assignee",
          schema: schema("user"),
        }),
      ],
    ]);
    const resolved = new Map([
      ["Priority", "priority"],
      ["Assignee", "assignee"],
    ]);
    const translatedFields = { priority: 123, assignee: 456 }; // both wrong types

    const result = coerceFields(translatedFields, fieldMetaById, resolved);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("Priority");
    expect(fields).toContain("Assignee");
  });

  it("passes through fields with no metadata (e.g. project, issuetype)", () => {
    const fieldMetaById = new Map<string, FieldMeta>();
    const resolved = new Map<string, string>();
    const translatedFields = {
      project: { key: "HSP" },
      issuetype: { name: "Story" },
    };

    const result = coerceFields(translatedFields, fieldMetaById, resolved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.project).toEqual({ key: "HSP" });
    expect(result.fields.issuetype).toEqual({ name: "Story" });
  });
});
