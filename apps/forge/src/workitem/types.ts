/**
 * Strongly-typed interfaces for the /workitem App REST API endpoint.
 *
 * Field keys in `fields` and `update` maps use human-readable names
 * (e.g. "Story Points") rather than raw Jira field IDs (e.g. "customfield_10016").
 * The handler resolves names to IDs before calling the Jira API.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 * @see {@link https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post|Jira Create Issue}
 */

import type { ProblemDetails, Result } from "forge-ahead";
import { z } from "zod";

/**
 * Zod schema for POST /workitem request body.
 *
 * `fields` values follow standard Jira field value formats for the field type
 * (e.g. `{ "Story Points": 5 }`, `{ "Assignee": { "accountId": "..." } }`).
 *
 * `update` values follow Jira's update operation format
 * (e.g. `{ "Labels": [{ "add": "bugfix" }] }`).
 */
export const WorkitemRequestSchema = z.object({
  /** Jira project key (e.g. "HSP") */
  project: z.string().min(1),
  /** Issue type name (e.g. "Story", "Bug") */
  issueType: z.string().min(1),
  /**
   * Fields to set on the issue, keyed by human-readable field name.
   * Standard fields (summary, description, etc.) and custom fields alike.
   */
  fields: z.record(z.string(), z.unknown()),
  /**
   * Update operations per field, keyed by human-readable field name.
   * Optional — used for atomic field-level operations (add/remove/set).
   */
  update: z.record(z.string(), z.unknown()).optional(),
});

/** Request body for POST /workitem — inferred from {@link WorkitemRequestSchema}. */
export type WorkitemRequest = z.infer<typeof WorkitemRequestSchema>;

/**
 * Metadata for a single resolved Jira field.
 */
export interface FieldResolution {
  /** Human-readable display name from Jira metadata */
  name: string;
  /**
   * Jira field key (e.g. "customfield_10016" for custom fields,
   * "summary" for standard fields)
   */
  id: string;
  /** Alternative names Jira recognises for this field */
  clauseNames: string[];
}

/**
 * Result of resolving all field names in a request.
 * On success: every input name maps to exactly one field key.
 * On failure: a {@link ProblemDetails} (RFC 9457) describing what went wrong,
 * with the `detail` field listing every unresolvable or ambiguous name.
 */
export type FieldResolutionResult = Result<Map<string, string>, ProblemDetails>;

/**
 * A single field-name resolution failure.
 */
export interface FieldResolutionError {
  name: string;
  reason: "not_found" | "ambiguous";
  /** Populated when reason === "ambiguous"; lists all matching field IDs */
  matches?: string[];
}

/**
 * Successful response body for POST /workitem.
 */
export interface WorkitemResponse {
  id: string;
  key: string;
  self: string;
}

/**
 * Error response body returned on 4xx/5xx — RFC 9457 Problem Details.
 * Re-exported from forge-ahead so handler code has a single import point.
 */
export type { ProblemDetails as ErrorResponse };
