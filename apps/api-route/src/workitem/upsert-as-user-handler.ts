/**
 * Handler for POST /workitem/upsert/asuser — upsert with raiseOnBehalfOf.
 *
 * Identical to POST /workitem/upsert, except:
 *  - `raiseOnBehalfOf` is **required** (400 if absent).
 *  - Issue creation and dedup search use `asUser(raiseOnBehalfOf)`.
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
import { createIssue, JiraApiError, writeOtelProperty } from "./jira-client";
import {
  buildUpsertResponse,
  parseBody,
  runDedupSearch,
  runPipeline,
} from "./pipeline";
import { UpsertAsUserRequestSchema } from "./types";

/**
 * Forge App REST API handler for POST /workitem/upsert/asuser.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=wi-upsert-asuser-fn].handler = index.handleWorkitemUpsertAsUser
 */
export async function handleWorkitemUpsertAsUser(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  logApiRouteRequest(req, "workitem/upsert/asuser");

  // 1. Parse body
  const parsed = parseBody(req.body);
  if (!parsed.ok) return parsed.response;

  // 2. Validate shape with zod — raiseOnBehalfOf and dedup are both required
  // fallow-ignore-next-line code-duplication
  const validation = UpsertAsUserRequestSchema.safeParse(parsed.value);
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

  // 4–6. Resolve field names, coerce values, build Jira body
  const pipeline = await runPipeline({ project, issueType, fields, update });
  if (!pipeline.ok) return pipeline.response;

  // 7. Pre-creation dedup check as the specified user
  const dedup_ = await runDedupSearch(dedup, project, authClient);
  if (!dedup_.ok) return dedup_.response;

  // 8. Duplicates found — skip creation
  if (dedup_.matchKeys.length > 0) {
    return buildUpsertResponse({
      created: false,
      matches: dedup_.matchKeys,
      warnings: dedup_.warnings,
    });
  }

  // 9. No duplicates — create the issue as the specified user
  let created: { id: string; key: string; self: string };
  try {
    created = await createIssue(pipeline.body, authClient);
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

  // 10. Write OTel entity property (best-effort — always uses asApp())
  if (otel) {
    void writeOtelProperty(created.key, otel);
  }

  return buildUpsertResponse({ created: true, ...created });
}
