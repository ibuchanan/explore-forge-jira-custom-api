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

import type {
  ProblemDetails,
  Result,
  ValidationProblemDetails,
} from "forge-ahead";
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
/**
 * Zod schema for the optional OTel (OpenTelemetry) trace context field.
 *
 * W3C Trace Context format:
 * - traceId: 32 lowercase hex chars
 * - spanId: 16 lowercase hex chars
 * - traceFlags: optional, defaults to "01"
 * - traceState: optional, defaults to ""
 *
 * @see {@link https://www.w3.org/TR/trace-context/|W3C Trace Context}
 */
const OtelContextSchema = z.object({
  /** W3C 32-hex-char trace ID */
  traceId: z
    .string()
    .regex(
      /^[0-9a-f]{32}$/,
      "traceId must be a 32-character lowercase hex string",
    ),
  /** W3C 16-hex-char span ID */
  spanId: z
    .string()
    .regex(
      /^[0-9a-f]{16}$/,
      "spanId must be a 16-character lowercase hex string",
    ),
  /** W3C trace flags (default "01") */
  traceFlags: z.string().optional(),
  /** W3C tracestate header value (default "") */
  traceState: z.string().optional(),
});

/** OTel trace context — inferred from {@link OtelContextSchema}. */
type OtelContext = z.infer<typeof OtelContextSchema>;

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
  /**
   * OpenTelemetry trace context to store as a Jira issue entity property.
   * Optional — if absent, no entity property is written.
   */
  otel: OtelContextSchema.optional(),
  /**
   * Jira accountId of the user on whose behalf the issue should be created.
   * On plain insert/upsert endpoints this field is ignored if present.
   * On /as-user endpoints this field is required.
   */
  raiseOnBehalfOf: z.string().optional(),
});

/** Request body for POST /workitem — inferred from {@link WorkitemRequestSchema}. */
type WorkitemRequest = z.infer<typeof WorkitemRequestSchema>;

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
 * On failure: a {@link ValidationProblemDetails} describing what went wrong,
 * with the `detail` field summarising the problems and `errors` listing each one.
 */
type FieldResolutionResult = Result<
  Map<string, string>,
  ValidationProblemDetails
>;

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
 * Required `raiseOnBehalfOf` field schema — shared by all /as-user schemas.
 * The error message is the canonical 400 message for this endpoint family.
 */
const RequiredRaiseOnBehalfOf = z
  .string()
  .min(
    1,
    "`raiseOnBehalfOf` is required on this endpoint. Provide a Jira accountId.",
  );

/**
 * Required `dedup` field schema — shared by all upsert schemas.
 */
const RequiredDedup = z
  .string()
  .trim()
  .min(
    1,
    "`dedup` must be a non-empty JQL string. Use the insert endpoint if deduplication is not needed.",
  );

/**
 * Zod schema for POST /workitem/as-user request body.
 *
 * Extends WorkitemRequest, making `raiseOnBehalfOf` required.
 * Callers that omit the field should use the plain /workitem endpoint instead.
 */
export const InsertAsUserRequestSchema = WorkitemRequestSchema.extend({
  /**
   * Jira accountId of the user on whose behalf the issue should be created.
   * Required on this endpoint — use POST /workitem if acting as the app identity.
   */
  raiseOnBehalfOf: RequiredRaiseOnBehalfOf,
});

/** Request body for POST /workitem/as-user — inferred from {@link InsertAsUserRequestSchema}. */
type InsertAsUserRequest = z.infer<typeof InsertAsUserRequestSchema>;

/**
 * Zod schema for POST /workitem/upsert/as-user request body.
 *
 * Extends WorkitemRequest, making both `dedup` and `raiseOnBehalfOf` required.
 */
export const UpsertAsUserRequestSchema = WorkitemRequestSchema.extend({
  /**
   * JQL query that defines what counts as a duplicate.
   */
  dedup: RequiredDedup,
  /**
   * Jira accountId of the user on whose behalf the issue should be created.
   * Required on this endpoint — use POST /workitem/upsert if acting as the app identity.
   */
  raiseOnBehalfOf: RequiredRaiseOnBehalfOf,
});

/** Request body for POST /workitem/upsert/as-user — inferred from {@link UpsertAsUserRequestSchema}. */
type UpsertAsUserRequest = z.infer<typeof UpsertAsUserRequestSchema>;

/**
 * Zod schema for POST /workitem/upsert request body.
 *
 * Extends WorkitemRequest with a required `dedup` JQL string.
 * The `dedup` field must be non-empty — it is executed against Jira search
 * before creation to detect existing matching issues.
 */
export const UpsertRequestSchema = WorkitemRequestSchema.extend({
  /**
   * JQL query that defines what counts as a duplicate.
   * Executed pre-creation; if results are found, creation is skipped.
   * Must be non-empty — use the insert endpoint if deduplication is not needed.
   */
  dedup: RequiredDedup,
});

/** Request body for POST /workitem/upsert — inferred from {@link UpsertRequestSchema}. */
type UpsertRequest = z.infer<typeof UpsertRequestSchema>;

/**
 * Successful response body for POST /workitem.
 */
export interface WorkitemResponse {
  id: string;
  key: string;
  self: string;
}

/**
 * Response body for POST /workitem/upsert — always 200 OK.
 *
 * Uses a fully consistent envelope (ADR-0004 Option C):
 * - `created: true`  → new issue created; `id`/`key`/`self` are populated.
 * - `created: false` → duplicate(s) found; `id`/`key`/`self` are null; `matches` populated.
 * - `warnings`       → always present (may be empty); advisory messages.
 * - `matches`        → always present (empty on creation, populated on dedup hit).
 */
export interface UpsertResponse {
  created: boolean;
  id: string | null;
  key: string | null;
  self: string | null;
  matches: string[];
  warnings: string[];
}

/**
 * Error response body returned on 4xx/5xx — RFC 9457 Problem Details.
 * Re-exported from forge-ahead so handler code has a single import point.
 */
// fallow-ignore-next-line unused-type
export type { ProblemDetails as ErrorResponse };
