/**
 * Handler for POST /workitem — the Forge App REST API endpoint.
 *
 * Accepts a strongly-typed workitem body where field names are human-readable
 * (e.g. "Story Points") rather than raw Jira IDs (e.g. "customfield_10016").
 *
 * Two-phase validation:
 *  Phase 1 — Field name resolution: all names resolved via createMeta.
 *             Returns 400 with ValidationProblemDetails if any name fails.
 *  Phase 2 — Value coercion: all values translated to Jira-shaped objects.
 *             Returns 400 with ValidationProblemDetails if any value fails.
 *
 * Error behaviour:
 *  - All errors within each phase are collected before returning.
 *  - Jira API errors are forwarded with their original status code.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 */

import {
  type ApiRouteRequest,
  type ApiRouteResponse,
  buildErrorResponse,
  buildSuccessResponse,
  logApiRouteRequest,
} from "forge-ahead";
import type { ValidationProblemDetails } from "forge-ahead";
import { resolveFieldNames, translateKeys } from "./field-resolver";
import type { FieldMeta } from "./field-coercer";
import { coerceFields } from "./field-coercer";
import { createIssue, JiraApiError, writeOtelProperty } from "./jira-client";
import { WorkitemRequestSchema } from "./types";

/**
 * Forge App REST API handler for POST /workitem.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=workitem-handler].handler = index.handleWorkitem
 */
export async function handleWorkitem(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  logApiRouteRequest(req, "workitem");

  // 1. Parse body
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body ?? "null");
  } catch {
    return buildErrorResponse(400, "Request body must be valid JSON");
  }

  // 2. Validate shape with zod
  const validation = WorkitemRequestSchema.safeParse(parsed);
  if (!validation.success) {
    return buildErrorResponse(
      400,
      "Request body must include: project (string), issueType (string), fields (object). " +
        "Optional: update (object).",
    );
  }

  const { project, issueType, fields, update, otel } = validation.data;

  // 3. Collect all field names that need resolving (fields only — update excluded from scope)
  const namesToResolve = new Set<string>(Object.keys(fields));

  // Phase 1 — Resolve all field names, collecting ALL errors before returning
  let resolved: Map<string, string>;
  let fieldMetaById: Map<string, FieldMeta>;
  try {
    const result = await resolveFieldNames(project, issueType, namesToResolve);

    if (result.isErr()) {
      return buildValidationErrorResponse(result.error);
    }

    resolved = result.value.resolved;
    fieldMetaById = result.value.fieldMetaById as Map<string, FieldMeta>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildErrorResponse(
      500,
      `Failed to fetch field metadata: ${message}`,
    );
  }

  // 4. Translate field names → Jira field IDs
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
    return buildValidationErrorResponse(problem);
  }

  const coercedFields = coercionResult.fields;

  // 5. Inject project + issueType into the coerced fields object
  //    (these are always standard Jira fields, not custom ones)
  const jiraBody: {
    fields: Record<string, unknown>;
    update?: Record<string, unknown>;
  } = {
    fields: {
      ...coercedFields,
      project: { key: project },
      issuetype: { name: issueType },
    },
  };
  if (translatedUpdate && Object.keys(translatedUpdate).length > 0) {
    jiraBody.update = translatedUpdate;
  }

  // 6. Create the issue
  let created: { id: string; key: string; self: string };
  try {
    created = await createIssue(jiraBody);
  } catch (err) {
    if (err instanceof JiraApiError) {
      // Forward Jira's status + body faithfully (Jira's own error format)
      return {
        statusCode: err.status,
        headers: { "Content-Type": ["application/json"] },
        body: err.body,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return buildErrorResponse(500, `Failed to create issue: ${message}`);
  }

  // 7. Write OTel entity property (best-effort — never blocks or fails the response)
  if (otel) {
    void writeOtelProperty(created.key, otel);
  }

  return buildSuccessResponse(created as object, 201);
}

/**
 * Serialises a ValidationProblemDetails into an ApiRouteResponse.
 */
function buildValidationErrorResponse(
  problem: ValidationProblemDetails,
): ApiRouteResponse {
  return {
    statusCode: problem.status,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(problem),
  };
}
