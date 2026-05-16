/**
 * Handler for POST /workitem/upsert/as-user — upsert with raiseOnBehalfOf.
 *
 * Identical to POST /workitem/upsert, except:
 *  - `raiseOnBehalfOf` is **required** (400 if absent).
 *  - Issue creation uses `asUser(raiseOnBehalfOf)` instead of `asApp()`.
 *  - `raiseOnBehalfOf` is extracted from the body before field translation
 *    and is NOT passed through to the Jira issue creation payload.
 *
 * Access to this endpoint IS the permission — callers holding the
 * `write:workitem-as-user:custom` scope may raise on behalf of any Jira accountId.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 */

import api from "@forge/api";
import {
  type ApiRouteRequest,
  type ApiRouteResponse,
  buildErrorResponse,
  logApiRouteRequest,
} from "forge-ahead";
import type { ValidationProblemDetails } from "forge-ahead";
import { resolveFieldNames, translateKeys } from "./field-resolver";
import type { FieldMeta } from "./field-coercer";
import { coerceFields } from "./field-coercer";
import {
  createIssue,
  JiraApiError,
  searchIssues,
  writeOtelProperty,
} from "./jira-client";
import { UpsertAsUserRequestSchema } from "./types";
import type { UpsertResponse } from "./types";

/**
 * Forge App REST API handler for POST /workitem/upsert/as-user.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=workitem-upsert-as-user-handler].handler = index.handleWorkitemUpsertAsUser
 */
export async function handleWorkitemUpsertAsUser(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  logApiRouteRequest(req, "workitem/upsert/asuser");

  // 1. Parse body
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body ?? "null");
  } catch {
    return buildErrorResponse(400, "Request body must be valid JSON");
  }

  // 2. Validate shape with zod — raiseOnBehalfOf and dedup are both required
  const validation = UpsertAsUserRequestSchema.safeParse(parsed);
  if (!validation.success) {
    const robError = validation.error.errors.find((e) =>
      e.path.includes("raiseOnBehalfOf"),
    );
    if (robError) {
      return buildErrorResponse(
        400,
        "`raiseOnBehalfOf` is required on this endpoint. Provide a Jira accountId.",
      );
    }
    const dedupError = validation.error.errors.find((e) =>
      e.path.includes("dedup"),
    );
    if (dedupError) {
      return buildErrorResponse(
        400,
        "`dedup` must be a non-empty JQL string. Use the insert endpoint if deduplication is not needed.",
      );
    }
    return buildErrorResponse(
      400,
      "Request body must include: project (string), issueType (string), fields (object), dedup (string), raiseOnBehalfOf (string). " +
        "Optional: update (object).",
    );
  }

  const { project, issueType, fields, update, otel, dedup, raiseOnBehalfOf } =
    validation.data;

  // 3. Build the auth client for this specific user
  const authClient = api.asUser(raiseOnBehalfOf);

  // 4. Collect all field names that need resolving
  const namesToResolve = new Set<string>(Object.keys(fields));

  // Phase 1 — Resolve all field names
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

  // 5. Translate field names → Jira field IDs
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

  // 6. Pre-creation dedup check — execute the caller's JQL as the specified user
  let matchKeys: string[];
  try {
    matchKeys = await searchIssues(dedup, 10, authClient);
  } catch (err) {
    if (err instanceof JiraApiError) {
      return {
        statusCode: err.status,
        headers: { "Content-Type": ["application/json"] },
        body: err.body,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return buildErrorResponse(500, `Dedup search failed: ${message}`);
  }

  // 7. If duplicates found, skip creation and return matches
  if (matchKeys.length > 0) {
    const warnings: string[] = [];

    // Project-scope warning: flag matches from a different project
    const otherProjectKeys = matchKeys.filter(
      (key) => !key.toUpperCase().startsWith(`${project.toUpperCase()}-`),
    );
    if (otherProjectKeys.length > 0) {
      warnings.push(
        `Dedup query returned matches from other projects (e.g. ${otherProjectKeys[0]}) — verify your JQL is scoped correctly.`,
      );
    }

    const response: UpsertResponse = {
      created: false,
      id: null,
      key: null,
      self: null,
      matches: matchKeys,
      warnings,
    };
    return {
      statusCode: 200,
      headers: { "Content-Type": ["application/json"] },
      body: JSON.stringify(response),
    };
  }

  // 8. No duplicates — create the issue as the specified user
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

  let created: { id: string; key: string; self: string };
  try {
    created = await createIssue(jiraBody, authClient);
  } catch (err) {
    if (err instanceof JiraApiError) {
      return {
        statusCode: err.status,
        headers: { "Content-Type": ["application/json"] },
        body: err.body,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return buildErrorResponse(500, `Failed to create issue: ${message}`);
  }

  // 9. Write OTel entity property (best-effort — always uses asApp())
  if (otel) {
    void writeOtelProperty(created.key, otel);
  }

  const response: UpsertResponse = {
    created: true,
    id: created.id,
    key: created.key,
    self: created.self,
    matches: [],
    warnings: [],
  };
  return {
    statusCode: 200,
    headers: { "Content-Type": ["application/json"] },
    body: JSON.stringify(response),
  };
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
