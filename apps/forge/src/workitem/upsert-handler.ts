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
import {
  createIssue,
  JiraApiError,
  searchIssues,
  writeOtelProperty,
} from "./jira-client";
import { parseBody, runPipeline } from "./pipeline";
import { UpsertRequestSchema } from "./types";
import type { UpsertResponse } from "./types";

/**
 * Forge App REST API handler for POST /workitem/upsert.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=workitem-upsert-handler].handler = index.handleWorkitemUpsert
 */
export async function handleWorkitemUpsert(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
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

  // 6. Pre-creation dedup check — execute the caller's JQL
  let matchKeys: string[];
  try {
    matchKeys = await searchIssues(dedup, 10);
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
    const warnings = buildDedupWarnings(matchKeys, project);
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

  // 8. No duplicates — create the issue
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

  // 9. Write OTel entity property (best-effort)
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
