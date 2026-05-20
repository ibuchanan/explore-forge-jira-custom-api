/**
 * Shared workitem handler pipeline.
 *
 * Extracts the common phases that all four handlers execute identically:
 *  1. JSON parsing
 *  2. Field name resolution (Phase 1)
 *  3. Field key translation
 *  4. Value coercion (Phase 2)
 *  5. Jira body construction
 *
 * Returns a typed discriminated result so handlers can branch on success/failure
 * and then proceed to their endpoint-specific logic (create issue, dedup search, etc.).
 *
 * @internal — not exported from index.ts; used only by handler files.
 */

import { type ApiRouteResponse, buildErrorResponse } from "forge-ahead";
import type { ValidationProblemDetails } from "forge-ahead";
import { resolveFieldNames, translateKeys } from "./field-resolver";
import type { FieldMeta } from "./field-coercer";
import { coerceFields } from "./field-coercer";
import type { AuthClient } from "./jira-client";
import { JiraApiError, ProjectNotFoundError, searchIssues } from "./jira-client";
import type { UpsertResponse } from "./types";

/** Input to the pipeline — the validated, schema-parsed request data. */
export interface PipelineInput {
  project: string;
  issueType: string;
  fields: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/** The Jira-shaped body produced by the pipeline, ready for createIssue(). */
export interface JiraCreateBody {
  fields: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/** Pipeline succeeded — body is ready. */
export interface PipelineOk {
  ok: true;
  body: JiraCreateBody;
}

/** Pipeline failed — response is ready to return immediately. */
export interface PipelineErr {
  ok: false;
  response: ApiRouteResponse;
}

export type PipelineResult = PipelineOk | PipelineErr;

/**
 * Runs the shared resolve→translate→coerce→build pipeline.
 *
 * @param input - Validated request data (project, issueType, fields, update)
 * @returns `PipelineOk` with the Jira body, or `PipelineErr` with a ready response.
 */
export async function runPipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const { project, issueType, fields, update } = input;

  // Phase 1 — Resolve all field names via createMeta
  const namesToResolve = new Set<string>(Object.keys(fields));

  let resolved: Map<string, string>;
  let fieldMetaById: Map<string, FieldMeta>;
  try {
    const result = await resolveFieldNames(project, issueType, namesToResolve);

    if (result.isErr()) {
      return { ok: false, response: toValidationErrorResponse(result.error) };
    }

    resolved = result.value.resolved;
    fieldMetaById = result.value.fieldMetaById as Map<string, FieldMeta>;
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return {
        ok: false,
        response: buildErrorResponse(400, err.message),
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: buildErrorResponse(
        500,
        `Failed to fetch field metadata: ${message}`,
      ),
    };
  }

  // Translate field names → Jira field IDs
  const translatedFields = translateKeys(fields, resolved);
  const translatedUpdate = update ? translateKeys(update, resolved) : undefined;

  // Phase 2 — Coerce all field values to Jira-shaped objects
  const coercionResult = coerceFields(
    translatedFields,
    fieldMetaById,
    resolved,
  );
  if (!coercionResult.ok) {
    const problem: ValidationProblemDetails = {
      type: "https://httpstatuses.io/400",
      title: "Bad Request",
      status: 400,
      detail: `Field value coercion failed for ${coercionResult.errors.length} field(s).`,
      timestamp: new Date().toISOString(),
      errors: coercionResult.errors,
    };
    return { ok: false, response: toValidationErrorResponse(problem) };
  }

  // Build the Jira body: coerced custom fields + standard project/issuetype
  const body: JiraCreateBody = {
    fields: {
      ...coercionResult.fields,
      project: { key: project },
      issuetype: { name: issueType },
    },
  };
  if (translatedUpdate && Object.keys(translatedUpdate).length > 0) {
    body.update = translatedUpdate;
  }

  return { ok: true, body };
}

/**
 * Serialises a ValidationProblemDetails into an ApiRouteResponse.
 * Centralised here so no handler needs to repeat this pattern.
 */
function toValidationErrorResponse(
  problem: ValidationProblemDetails,
): ApiRouteResponse {
  return {
    statusCode: problem.status,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(problem),
  };
}

/**
 * Parses the raw request body string into an unknown value.
 * Returns the parsed value, or an error ApiRouteResponse on failure.
 */
export function parseBody(
  raw: string | null | undefined,
): { ok: true; value: unknown } | { ok: false; response: ApiRouteResponse } {
  try {
    return { ok: true, value: JSON.parse(raw ?? "null") };
  } catch {
    return {
      ok: false,
      response: buildErrorResponse(400, "Request body must be valid JSON"),
    };
  }
}

// ---------------------------------------------------------------------------
// Upsert-specific helpers
// ---------------------------------------------------------------------------

/** Dedup search succeeded — matchKeys and pre-built warnings are available. */
export interface DedupSearchOk {
  ok: true;
  matchKeys: string[];
  warnings: string[];
}

/** Dedup search failed — response is ready to return immediately. */
export interface DedupSearchErr {
  ok: false;
  response: ApiRouteResponse;
}

export type DedupSearchResult = DedupSearchOk | DedupSearchErr;

/**
 * Executes the caller-supplied dedup JQL and builds the warnings array.
 *
 * @param jql        - JQL query to execute
 * @param project    - Target project key (used for cross-project warning)
 * @param authClient - Authenticated Forge API client (default: asApp())
 */
export async function runDedupSearch(
  jql: string,
  project: string,
  authClient?: AuthClient,
): Promise<DedupSearchResult> {
  let matchKeys: string[];
  try {
    matchKeys = await searchIssues(jql, 10, authClient);
  } catch (err) {
    if (err instanceof JiraApiError) {
      return {
        ok: false,
        response: {
          statusCode: err.status,
          headers: { "Content-Type": ["application/json"] },
          body: err.body,
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: buildErrorResponse(500, `Dedup search failed: ${message}`),
    };
  }

  const warnings = buildDedupWarnings(matchKeys, project);
  return { ok: true, matchKeys, warnings };
}

/**
 * Builds the UpsertResponse envelope and wraps it in an ApiRouteResponse.
 * Always 200 OK regardless of whether an issue was created or a dup was found.
 */
export function buildUpsertResponse(
  outcome:
    | { created: true; id: string; key: string; self: string }
    | { created: false; matches: string[]; warnings: string[] },
): ApiRouteResponse {
  const response: UpsertResponse = outcome.created
    ? {
        created: true,
        id: outcome.id,
        key: outcome.key,
        self: outcome.self,
        matches: [],
        warnings: [],
      }
    : {
        created: false,
        id: null,
        key: null,
        self: null,
        matches: outcome.matches,
        warnings: outcome.warnings,
      };

  return {
    statusCode: 200,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(response),
  };
}

/**
 * Builds the warnings array for a dedup hit.
 * Warns when any match key belongs to a project other than the target.
 */
function buildDedupWarnings(matchKeys: string[], project: string): string[] {
  const otherProjectKeys = matchKeys.filter(
    (key) => !key.toUpperCase().startsWith(`${project.toUpperCase()}-`),
  );
  if (otherProjectKeys.length > 0) {
    return [
      `Dedup query returned matches from other projects (e.g. ${otherProjectKeys[0]}) — verify your JQL is scoped correctly.`,
    ];
  }
  return [];
}
