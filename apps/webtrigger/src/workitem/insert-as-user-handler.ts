/**
 * Handler for POST /workitem/asuser — insert with raiseOnBehalfOf.
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
import { verifyBearerToken } from "./auth";
import { createIssue, JiraApiError, writeOtelProperty } from "./jira-client";
import { parseBody, runPipeline } from "./pipeline";
import { InsertAsUserRequestSchema } from "./types";

/**
 * Forge App REST API handler for POST /workitem/asuser.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=wi-asuser-handler].handler = index.handleWorkitemAsUser
 */
export async function handleWorkitemAsUser(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  // 0. Verify Bearer token before any other processing
  const auth = await verifyBearerToken(req.headers, "WEBTRIGGER_AS_USER_TOKEN");
  if (!auth.ok) return auth.response;

  logApiRouteRequest(req, "workitem/asuser");

  // 1. Parse body
  const parsed = parseBody(req.body);
  if (!parsed.ok) return parsed.response;

  // 2. Validate shape with zod — raiseOnBehalfOf is required here
  // fallow-ignore-next-line code-duplication
  const validation = InsertAsUserRequestSchema.safeParse(parsed.value);
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

  const { project, issueType, fields, update, otel, raiseOnBehalfOf } =
    validation.data;

  // 3. Build the auth client for this specific user
  const authClient = api.asUser(raiseOnBehalfOf);

  // 4–6. Resolve field names, coerce values, build Jira body
  const pipeline = await runPipeline({ project, issueType, fields, update });
  if (!pipeline.ok) return pipeline.response;

  // 7. Create the issue as the specified user
  // fallow-ignore-next-line code-duplication
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

  // 8. Write OTel entity property (best-effort — always uses asApp())
  if (otel) {
    void writeOtelProperty(created.key, otel);
  }

  return buildSuccessResponse(created as object, 201);
}
