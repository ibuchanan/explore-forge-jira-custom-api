/**
 * Handler for POST /workitem/as-user — insert with raiseOnBehalfOf.
 *
 * Identical to POST /workitem, except:
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
  buildSuccessResponse,
  logApiRouteRequest,
} from "forge-ahead";
import type { ValidationProblemDetails } from "forge-ahead";
import { resolveFieldNames, translateKeys } from "./field-resolver";
import type { FieldMeta } from "./field-coercer";
import { coerceFields } from "./field-coercer";
import { createIssue, JiraApiError, writeOtelProperty } from "./jira-client";
import { InsertAsUserRequestSchema } from "./types";

/**
 * Forge App REST API handler for POST /workitem/as-user.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=workitem-as-user-handler].handler = index.handleWorkitemAsUser
 */
export async function handleWorkitemAsUser(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  logApiRouteRequest(req, "workitem/asuser");

  // 1. Parse body
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body ?? "null");
  } catch {
    return buildErrorResponse(400, "Request body must be valid JSON");
  }

  // 2. Validate shape with zod — raiseOnBehalfOf is required here
  const validation = InsertAsUserRequestSchema.safeParse(parsed);
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
    return buildErrorResponse(
      400,
      "Request body must include: project (string), issueType (string), fields (object), raiseOnBehalfOf (string). " +
        "Optional: update (object).",
    );
  }

  // raiseOnBehalfOf is guaranteed non-empty by the schema
  const { project, issueType, fields, update, otel, raiseOnBehalfOf } =
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

  // 6. Inject project + issueType into the coerced fields object
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

  // 7. Create the issue as the specified user
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

  // 8. Write OTel entity property (best-effort — always uses asApp())
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
