/**
 * Field name resolution logic.
 *
 * Translates human-readable field names (e.g. "Story Points", "Assignee")
 * to Jira field IDs (e.g. "customfield_10016", "assignee") using the
 * Jira create-meta API for a given project + issue type combination.
 *
 * Returns ALL errors at once so callers can surface a complete error list
 * rather than failing one name at a time.
 *
 * @see {@link https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-types/#api-rest-api-3-issue-createmeta-projectidorkey-issuetypes-issuetypeid-get|Create meta fields}
 */

import { err, ok, type Result } from "forge-ahead";
import type { ValidationProblemDetails } from "forge-ahead";
import type { components } from "forge-ahead/jira/platform-3";
import { getFieldsForIssueType, getIssueTypes } from "./jira-client";
import type { AuthClient } from "./jira-client";
import type { FieldResolution, FieldResolutionError } from "./types";

/**
 * Jira's createmeta field endpoint returns `clauseNames` in practice, but it is
 * not included in the published OpenAPI schema. Extend `FieldCreateMetadata` to
 * capture it so the resolver can build complete name aliases.
 */
export type JiraFieldMeta = components["schemas"]["FieldCreateMetadata"] & {
  clauseNames?: string[];
};

type JiraIssueTypeMeta = components["schemas"]["IssueTypeIssueCreateMetadata"];

/**
 * Dependency injection interface for the Jira metadata calls.
 * Used in tests to supply mock data without hitting the network.
 */
export interface FieldResolverDeps {
  getIssueTypes: (
    projectKey: string,
    authClient?: AuthClient,
  ) => Promise<JiraIssueTypeMeta[]>;
  getFieldsForIssueType: (
    projectKey: string,
    issueTypeId: string,
    authClient?: AuthClient,
  ) => Promise<JiraFieldMeta[]>;
}

/**
 * Successful result of resolving field names — carries both the name→id map
 * and the full field metadata (needed downstream for value coercion).
 */
export interface FieldResolutionSuccess {
  /** Maps caller field name → Jira field ID */
  resolved: Map<string, string>;
  /** Maps Jira field ID → full field metadata (for coercion) */
  fieldMetaById: Map<string, JiraFieldMeta>;
}

/** Default production dependencies */
// fallow-ignore-next-line unused-export
export const defaultDeps: FieldResolverDeps = {
  getIssueTypes,
  getFieldsForIssueType,
};

/**
 * Builds a lookup map from all recognised names for a field to its resolution.
 *
 * A field is registered under:
 *  - Its exact display name (case-insensitive)
 *  - Each of its clauseNames (case-insensitive)
 *  - Its raw fieldId
 *
 * When multiple distinct fields share the same normalised name the entry
 * holds multiple resolutions, which triggers an "ambiguous" error.
 */
function buildFieldIndex(
  fields: JiraFieldMeta[],
): Map<string, FieldResolution[]> {
  const index = new Map<string, FieldResolution[]>();

  function register(normalised: string, resolution: FieldResolution): void {
    const existing = index.get(normalised) ?? [];
    // Avoid duplicating the same field registered via multiple alias paths
    if (!existing.some((r) => r.id === resolution.id)) {
      existing.push(resolution);
    }
    index.set(normalised, existing);
  }

  for (const field of fields) {
    const resolution: FieldResolution = {
      name: field.name,
      id: field.fieldId,
      clauseNames: field.clauseNames ?? [],
    };

    register(field.name.toLowerCase(), resolution);
    register(field.fieldId.toLowerCase(), resolution);
    for (const alias of field.clauseNames ?? []) {
      register(alias.toLowerCase(), resolution);
    }
  }

  return index;
}

/**
 * Resolves a set of human-readable field names to Jira field IDs for a
 * specific project + issue type.
 *
 * Returns both the name→id map AND the full field metadata so the caller
 * can perform value coercion in a second phase without re-fetching.
 *
 * @param projectKey    - Jira project key, e.g. "HSP"
 * @param issueTypeName - Issue type display name, e.g. "Story"
 * @param names         - Set of field names to resolve (from fields map)
 * @param deps          - Injectable dependencies (defaults to real Jira client)
 * @returns ok(FieldResolutionSuccess) or err(ValidationProblemDetails)
 */
export async function resolveFieldNames(
  projectKey: string,
  issueTypeName: string,
  names: ReadonlySet<string>,
  deps: FieldResolverDeps = defaultDeps,
  authClient?: AuthClient,
): Promise<Result<FieldResolutionSuccess, ValidationProblemDetails>> {
  // 1. Find the issue type by name (case-insensitive)
  const issueTypes = await deps.getIssueTypes(projectKey, authClient);
  const issueType = issueTypes.find(
    (it) => it.name?.toLowerCase() === issueTypeName.toLowerCase(),
  );

  if (!issueType) {
    const problem: ValidationProblemDetails = {
      type: "https://httpstatuses.io/400",
      title: "Bad Request",
      status: 400,
      detail: `Issue type "${issueTypeName}" not found in project "${projectKey}"`,
      timestamp: new Date().toISOString(),
      errors: [
        {
          field: "issueType",
          reason: "not_found",
          message: `Issue type "${issueTypeName}" not found in project "${projectKey}"`,
        },
      ],
    };
    return err(problem);
  }

  // 2. Fetch all fields for this project + issue type (paginated via jira-client)
  const fields = await deps.getFieldsForIssueType(
    projectKey,
    issueType.id ?? "",
    authClient,
  );
  const index = buildFieldIndex(fields);

  // Build fieldMetaById for downstream coercion
  const fieldMetaById = new Map<string, JiraFieldMeta>();
  for (const field of fields) {
    fieldMetaById.set(field.fieldId, field);
  }

  // 3. Resolve every requested name, collecting all errors
  const resolved = new Map<string, string>();
  const errors: FieldResolutionError[] = [];

  for (const name of names) {
    const matches = index.get(name.toLowerCase());

    if (!matches || matches.length === 0) {
      errors.push({ name, reason: "not_found" });
    } else if (matches.length > 1) {
      errors.push({
        name,
        reason: "ambiguous",
        matches: matches.map((m) => `${m.name} (${m.id})`),
      });
    } else {
      // matches.length === 1 guaranteed by the else branch above
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      resolved.set(name, matches[0]!.id);
    }
  }

  if (errors.length > 0) {
    const problem: ValidationProblemDetails = {
      type: "https://httpstatuses.io/400",
      title: "Bad Request",
      status: 400,
      detail: `Field name resolution failed for ${errors.length} field(s).`,
      timestamp: new Date().toISOString(),
      errors: errors.map((e) => ({
        field: e.name,
        reason: e.reason,
        message:
          e.reason === "ambiguous"
            ? `'${e.name}' is ambiguous — matches: ${(e.matches ?? []).join(", ")}`
            : `No field named '${e.name}' for project ${projectKey} / ${issueTypeName}.`,
      })),
    };
    return err(problem);
  }

  return ok({ resolved, fieldMetaById });
}

/**
 * Translates the keys of a record using a resolved name→id map.
 * Keys not in the map are left unchanged (covers standard fields like
 * "summary" that the caller may have already used as their raw field ID).
 */
export function translateKeys(
  input: Record<string, unknown>,
  resolved: Map<string, string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[resolved.get(key) ?? key] = value;
  }
  return output;
}
