/**
 * Field value coercion registry.
 *
 * Translates human-readable field values (e.g. `"High"`, `"accountId-xyz"`)
 * into the exact shapes the Jira REST API expects (e.g. `{ name: "High" }`,
 * `{ accountId: "accountId-xyz" }`).
 *
 * Design:
 *  - A registry maps schema type strings to coercion functions.
 *  - Each coercion function receives the raw caller value and the field
 *    metadata (including allowedValues for validation) and returns the
 *    coerced Jira value or a {@link ValidationError}.
 *  - Array fields delegate to the element-type coercer for each item.
 *  - Unknown types produce an `unsupported_type` error.
 *  - Cascading select is explicitly excluded (returns unsupported_type).
 *
 * @see {@link https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post|Jira Create Issue}
 */

import type { ValidationError } from "forge-ahead";
import type { components } from "forge-ahead/jira/platform-3";

type FieldCreateMetadata = components["schemas"]["FieldCreateMetadata"] & {
  clauseNames?: string[];
};

/**
 * The full set of field metadata for a resolved field, including schema and
 * allowedValues needed for coercion and validation.
 */
export interface FieldMeta extends FieldCreateMetadata {
  /** The resolved Jira field ID (e.g. "customfield_10016") */
  fieldId: string;
}

/** Result of coercing a single field value. */
export type CoercionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: ValidationError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(value: unknown): CoercionResult {
  return { ok: true, value };
}

function coercionError(
  field: string,
  reason: ValidationError["reason"],
  message: string,
): CoercionResult {
  return { ok: false, error: { field, reason, message } };
}

/**
 * Validates a string value against a field's allowedValues list.
 * Returns `null` if valid (or no allowedValues), or an error message string.
 */
function checkAllowedValues(
  callerValue: string,
  meta: FieldMeta,
  keyProp: "value" | "name",
): string | null {
  const allowed = meta.allowedValues as
    | Array<{ value?: string; name?: string }>
    | undefined;
  if (!allowed || allowed.length === 0) return null;

  const match = allowed.some(
    (av) => (av[keyProp] ?? "").toLowerCase() === callerValue.toLowerCase(),
  );
  if (match) return null;

  const list = allowed
    .map((av) => av[keyProp])
    .filter(Boolean)
    .join(", ");
  return `Allowed values: ${list}`;
}

// ---------------------------------------------------------------------------
// Atomic coercers (non-array)
// ---------------------------------------------------------------------------

/** priority: "High" → { name: "High" } */
function coercePriority(
  callerValue: unknown,
  fieldName: string,
): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a string priority name.`,
    );
  }
  return ok({ name: callerValue });
}

/** option (select): "High" → { value: "High" } — validated against allowedValues */
function coerceOption(
  callerValue: unknown,
  fieldName: string,
  meta: FieldMeta,
): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a string option value.`,
    );
  }
  const allowed = checkAllowedValues(callerValue, meta, "value");
  if (allowed !== null) {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}': '${callerValue}' is not a valid option. ${allowed}`,
    );
  }
  return ok({ value: callerValue });
}

/** user (single user picker): "accountId-xyz" → { accountId: "accountId-xyz" } */
function coerceUser(callerValue: unknown, fieldName: string): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a string accountId.`,
    );
  }
  return ok({ accountId: callerValue });
}

/** version (fixVersions, affectsVersions): "v1.2" → { name: "v1.2" } */
function coerceVersion(
  callerValue: unknown,
  fieldName: string,
): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a string version name.`,
    );
  }
  return ok({ name: callerValue });
}

/** component: "Frontend" → { name: "Frontend" } */
function coerceComponent(
  callerValue: unknown,
  fieldName: string,
): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a string component name.`,
    );
  }
  return ok({ name: callerValue });
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** date: "2026-05-16" → "2026-05-16" (ISO 8601 date validation) */
function coerceDate(callerValue: unknown, fieldName: string): CoercionResult {
  if (typeof callerValue !== "string" || !ISO_DATE_RE.test(callerValue)) {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects an ISO 8601 date string (YYYY-MM-DD).`,
    );
  }
  return ok(callerValue);
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** datetime: "2026-05-16T09:00:00.000Z" → same (ISO 8601 datetime validation) */
function coerceDatetime(
  callerValue: unknown,
  fieldName: string,
): CoercionResult {
  if (typeof callerValue !== "string" || !ISO_DATETIME_RE.test(callerValue)) {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects an ISO 8601 datetime string (e.g. 2026-05-16T09:00:00.000Z).`,
    );
  }
  return ok(callerValue);
}

/** number: 5 → 5 */
function coerceNumber(callerValue: unknown, fieldName: string): CoercionResult {
  if (typeof callerValue !== "number") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a number.`,
    );
  }
  return ok(callerValue);
}

/** string: "some text" → "some text" */
function coerceString(callerValue: unknown, fieldName: string): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a string.`,
    );
  }
  return ok(callerValue);
}

// ---------------------------------------------------------------------------
// Sprint coercer (custom field — looks up by name)
// ---------------------------------------------------------------------------

/** sprint: "Sprint Name" → sprint ID number (looked up from allowedValues) */
function coerceSprint(
  callerValue: unknown,
  fieldName: string,
  meta: FieldMeta,
): CoercionResult {
  if (typeof callerValue !== "string") {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects a sprint name string.`,
    );
  }
  // allowedValues for sprint fields contain objects with `id` and `name`
  const allowed = meta.allowedValues as
    | Array<{ id?: number; name?: string }>
    | undefined;
  if (allowed && allowed.length > 0) {
    const match = allowed.find(
      (av) => (av.name ?? "").toLowerCase() === callerValue.toLowerCase(),
    );
    if (!match) {
      const list = allowed
        .map((av) => av.name)
        .filter(Boolean)
        .join(", ");
      return coercionError(
        fieldName,
        "invalid_value",
        `'${fieldName}': sprint '${callerValue}' not found. Known sprints: ${list}`,
      );
    }
    return ok(match.id);
  }
  // If no allowedValues are present in metadata, pass the name through as-is
  // (Jira accepts sprint name in some contexts)
  return ok(callerValue);
}

// ---------------------------------------------------------------------------
// Array coercer (delegates to item coercer)
// ---------------------------------------------------------------------------

/**
 * Coerces an array field by applying the appropriate item coercer to each element.
 * Returns the first error encountered per element, collecting all element errors.
 */
function coerceArray(
  callerValue: unknown,
  fieldName: string,
  meta: FieldMeta,
  itemsType: string | undefined,
): CoercionResult {
  if (!Array.isArray(callerValue)) {
    return coercionError(
      fieldName,
      "invalid_value",
      `'${fieldName}' expects an array.`,
    );
  }

  const coercedItems: unknown[] = [];
  const errors: string[] = [];

  for (let i = 0; i < callerValue.length; i++) {
    const item = callerValue[i];
    let itemResult: CoercionResult;

    switch (itemsType) {
      case "option":
        itemResult = coerceOption(item, fieldName, meta);
        break;
      case "user":
        itemResult = coerceUser(item, fieldName);
        break;
      case "version":
        itemResult = coerceVersion(item, fieldName);
        break;
      case "component":
        itemResult = coerceComponent(item, fieldName);
        break;
      case "string":
        itemResult = coerceString(item, fieldName);
        break;
      default:
        return coercionError(
          fieldName,
          "unsupported_type",
          `'${fieldName}' uses array item type '${itemsType ?? "unknown"}' which is not supported by this API.`,
        );
    }

    if (!itemResult.ok) {
      errors.push(`[${i}]: ${itemResult.error.message}`);
    } else {
      coercedItems.push(itemResult.value);
    }
  }

  if (errors.length > 0) {
    return coercionError(fieldName, "invalid_value", errors.join("; "));
  }
  return ok(coercedItems);
}

// ---------------------------------------------------------------------------
// Custom field keys for special handling
// ---------------------------------------------------------------------------

const SPRINT_CUSTOM_KEY = "com.pyxis.greenhopper.jira:gh-sprint";

const CASCADING_SELECT_CUSTOM_KEY =
  "com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect";

// ---------------------------------------------------------------------------
// Main coerce entry point
// ---------------------------------------------------------------------------

/**
 * Coerces a single field value using the field's schema metadata.
 *
 * Dispatches on `schema.type` (and `schema.custom` for custom fields),
 * falling back to `unsupported_type` for unknown types.
 *
 * @param callerValue - The raw value from the caller's request
 * @param fieldName   - The caller's field name (for error messages)
 * @param meta        - Full field metadata from createMeta
 * @returns CoercionResult
 */
export function coerceFieldValue(
  callerValue: unknown,
  fieldName: string,
  meta: FieldMeta,
): CoercionResult {
  const schema = meta.schema;

  // Fields without schema are treated as pass-through (e.g. summary, description)
  if (!schema) {
    return ok(callerValue);
  }

  const { type, items, custom } = schema as {
    type?: string;
    items?: string;
    custom?: string;
  };

  // Explicitly excluded: cascading select
  if (custom === CASCADING_SELECT_CUSTOM_KEY) {
    return coercionError(
      fieldName,
      "unsupported_type",
      `'${fieldName}' uses cascading select which is not supported by this API.`,
    );
  }

  // Sprint custom field (identified by custom key)
  if (custom === SPRINT_CUSTOM_KEY) {
    return coerceSprint(callerValue, fieldName, meta);
  }

  switch (type) {
    case "priority":
      return coercePriority(callerValue, fieldName);
    case "option":
      return coerceOption(callerValue, fieldName, meta);
    case "user":
      return coerceUser(callerValue, fieldName);
    case "version":
      return coerceVersion(callerValue, fieldName);
    case "component":
      return coerceComponent(callerValue, fieldName);
    case "date":
      return coerceDate(callerValue, fieldName);
    case "datetime":
      return coerceDatetime(callerValue, fieldName);
    case "number":
      return coerceNumber(callerValue, fieldName);
    case "string":
      return coerceString(callerValue, fieldName);
    case "array":
      return coerceArray(callerValue, fieldName, meta, items);
    default:
      return coercionError(
        fieldName,
        "unsupported_type",
        `'${fieldName}' uses type '${type ?? "unknown"}' which is not supported by this API.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Batch coercion
// ---------------------------------------------------------------------------

/**
 * Result of coercing all fields in a request.
 */
export type BatchCoercionResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

/**
 * Coerces all values in a translated fields map.
 *
 * The `fieldIdToMeta` map provides schema metadata keyed by the Jira field ID
 * (the values in the `resolved` name→id map). Fields with no matching metadata
 * entry are passed through unchanged (safe fallback for standard fields like
 * `project` and `issuetype` that are injected by the handler).
 *
 * All errors are collected before returning — the caller sees every problem.
 *
 * @param translatedFields - Record keyed by Jira field ID (post-name-translation)
 * @param fieldIdToMeta    - Map from Jira field ID to field metadata
 * @param resolvedNames    - Map from caller name to Jira field ID (for error messages)
 * @returns BatchCoercionResult
 */
export function coerceFields(
  translatedFields: Record<string, unknown>,
  fieldIdToMeta: Map<string, FieldMeta>,
  resolvedNames: Map<string, string>,
): BatchCoercionResult {
  // Build a reverse map: fieldId → callerName (for error messages)
  const idToCallerName = new Map<string, string>();
  for (const [callerName, fieldId] of resolvedNames) {
    idToCallerName.set(fieldId, callerName);
  }

  const coerced: Record<string, unknown> = {};
  const errors: ValidationError[] = [];

  for (const [fieldId, callerValue] of Object.entries(translatedFields)) {
    const meta = fieldIdToMeta.get(fieldId);
    if (!meta) {
      // No metadata — pass through (standard injected fields like project/issuetype)
      coerced[fieldId] = callerValue;
      continue;
    }

    const callerName = idToCallerName.get(fieldId) ?? fieldId;
    const result = coerceFieldValue(callerValue, callerName, meta);

    if (!result.ok) {
      errors.push(result.error);
    } else {
      coerced[fieldId] = result.value;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, fields: coerced };
}
