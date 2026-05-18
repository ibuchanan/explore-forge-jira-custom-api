/**
 * Handler for POST /workitem/upsert — the Forge App REST API upsert endpoint.
 *
 * Upsert semantics:
 *  - If the caller-supplied `dedup` JQL finds existing issues → skip creation,
 *    return `created: false` with `matches` populated.
 *  - If the JQL finds no matches → create the issue, return `created: true`.
 *
 * The response always uses the same envelope shape regardless of outcome
 * (ADR-0004 Option C — fully consistent envelope).
 *
 * Validation phases (same as insert handler):
 *  Phase 0 — Dedup JQL validation: `dedup` must be non-empty.
 *  Phase 1 — Field name resolution via createMeta.
 *  Phase 2 — Value coercion to Jira-shaped objects.
 *
 * HTTP status:
 *  200 OK  — always (both created and deduplicated outcomes).
 *  400     — invalid body, invalid JQL (forwarded from Jira), or field errors.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 */

import {
  type ApiRouteRequest,
  type ApiRouteResponse,
  buildErrorResponse,
  logApiRouteRequest,
} from "forge-ahead";
import { verifyBearerToken } from "./auth";
import { createIssue, JiraApiError, writeOtelProperty } from "./jira-client";
import {
  buildUpsertResponse,
  parseBody,
  runDedupSearch,
  runPipeline,
} from "./pipeline";
import { UpsertRequestSchema } from "./types";

/**
 * Forge App REST API handler for POST /workitem/upsert.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=workitem-upsert-handler].handler = index.handleWorkitemUpsert
 */
export async function handleWorkitemUpsert(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  // 0. Verify Bearer token before any other processing
  const auth = await verifyBearerToken(req.headers, "WEBTRIGGER_TOKEN");
  if (!auth.ok) return auth.response;

  logApiRouteRequest(req, "workitem/upsert");

  // 1. Parse body
  const parsed = parseBody(req.body);
  if (!parsed.ok) return parsed.response;

  // 2. Validate shape with zod (includes dedup non-empty check)
  const validation = UpsertRequestSchema.safeParse(parsed.value);
  if (!validation.success) {
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
      "Request body must include: project (string), issueType (string), fields (object), dedup (string). " +
        "Optional: update (object).",
    );
  }

  const { project, issueType, fields, update, otel, dedup } = validation.data;

  // 3–5. Resolve field names, coerce values, build Jira body
  const pipeline = await runPipeline({ project, issueType, fields, update });
  if (!pipeline.ok) return pipeline.response;

  // 6. Pre-creation dedup check
  const dedup_ = await runDedupSearch(dedup, project);
  if (!dedup_.ok) return dedup_.response;

  // 7. Duplicates found — skip creation
  if (dedup_.matchKeys.length > 0) {
    return buildUpsertResponse({
      created: false,
      matches: dedup_.matchKeys,
      warnings: dedup_.warnings,
    });
  }

  // 8. No duplicates — create the issue
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

  // 9. Write OTel entity property (best-effort)
  if (otel) {
    void writeOtelProperty(created.key, otel);
  }

  return buildUpsertResponse({ created: true, ...created });
}
