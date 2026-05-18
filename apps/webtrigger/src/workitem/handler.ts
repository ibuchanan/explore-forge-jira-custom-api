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
import { verifyBearerToken } from "./auth";
import { createIssue, JiraApiError, writeOtelProperty } from "./jira-client";
import { parseBody, runPipeline } from "./pipeline";
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
  // 0. Verify Bearer token before any other processing
  const auth = await verifyBearerToken(req.headers, "WEBTRIGGER_TOKEN");
  if (!auth.ok) return auth.response;

  logApiRouteRequest(req, "workitem");

  // 1. Parse body
  const parsed = parseBody(req.body);
  if (!parsed.ok) return parsed.response;

  // 2. Validate shape with zod
  const validation = WorkitemRequestSchema.safeParse(parsed.value);
  if (!validation.success) {
    return buildErrorResponse(
      400,
      "Request body must include: project (string), issueType (string), fields (object). " +
        "Optional: update (object).",
    );
  }

  const { project, issueType, fields, update, otel } = validation.data;

  // 3–5. Resolve field names, coerce values, build Jira body
  const pipeline = await runPipeline({ project, issueType, fields, update });
  if (!pipeline.ok) return pipeline.response;

  // 6. Create the issue
  // fallow-ignore-next-line code-duplication
  let created: { id: string; key: string; self: string };
  try {
    created = await createIssue(pipeline.body);
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

  // 7. Write OTel entity property (best-effort)
  if (otel) {
    void writeOtelProperty(created.key, otel);
  }

  return buildSuccessResponse(created as object, 201);
}
