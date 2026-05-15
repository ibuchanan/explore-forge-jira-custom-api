/**
 * Handler for POST /workitem — the Forge App REST API endpoint.
 *
 * Accepts a strongly-typed workitem body where field names are human-readable
 * (e.g. "Story Points") rather than raw Jira IDs (e.g. "customfield_10016").
 * Resolves names via Jira create-meta, then proxies the translated body to
 * the Jira issue create API.
 *
 * Error behaviour:
 *  - All field name resolution errors are collected and returned together
 *    in a single 400 response — the caller sees every problem at once.
 *  - Jira API errors are forwarded with their original status code.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/app-rest-apis/|Forge App REST APIs}
 */

import { StandardError } from "forge-ahead";
import type { ProblemDetails } from "forge-ahead";
import { resolveFieldNames, translateKeys } from "./field-resolver";
import { createIssue, JiraApiError } from "./jira-client";
import type { WorkitemResponse } from "./types";
import { WorkitemRequestSchema } from "./types";

/** Shape of an incoming Forge App REST API request */
interface ApiRouteRequest {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
  queryParameters?: Record<string, string[]>;
}

/** Shape of a Forge App REST API response */
interface ApiRouteResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

function json(
  statusCode: number,
  body: WorkitemResponse | ProblemDetails,
): ApiRouteResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function problemJson(statusCode: number, detail: string): ApiRouteResponse {
  return json(
    statusCode,
    StandardError.getOrDefault(statusCode).error(detail).error,
  );
}

/**
 * Forge App REST API handler for POST /workitem.
 *
 * Registered in manifest.yml as:
 *   modules.function[key=workitem-handler].handler = index.handleWorkitem
 */
export async function handleWorkitem(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  // 1. Parse body
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body ?? "null");
  } catch {
    return problemJson(400, "Request body must be valid JSON");
  }

  // 2. Validate shape with zod
  const validation = WorkitemRequestSchema.safeParse(parsed);
  if (!validation.success) {
    return problemJson(
      400,
      "Request body must include: project (string), issueType (string), fields (object). " +
        "Optional: update (object).",
    );
  }

  const { project, issueType, fields, update } = validation.data;

  // 3. Collect all field names that need resolving (fields + update combined)
  const namesToResolve = new Set<string>([
    ...Object.keys(fields),
    ...Object.keys(update ?? {}),
  ]);

  // 3. Resolve all names in one pass — get ALL errors before returning
  let resolved: Map<string, string>;
  try {
    const result = await resolveFieldNames(project, issueType, namesToResolve);

    if (result.isErr()) {
      return json(result.error.status, result.error);
    }

    resolved = result.value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return problemJson(500, `Failed to fetch field metadata: ${message}`);
  }

  // 4. Translate field names → Jira field IDs
  const translatedFields = translateKeys(fields, resolved);
  const translatedUpdate = update ? translateKeys(update, resolved) : undefined;

  // 5. Inject project + issueType into the translated fields object
  //    (these are always standard Jira fields, not custom ones)
  const jiraBody: {
    fields: Record<string, unknown>;
    update?: Record<string, unknown>;
  } = {
    fields: {
      ...translatedFields,
      project: { key: project },
      issuetype: { name: issueType },
    },
  };
  if (translatedUpdate && Object.keys(translatedUpdate).length > 0) {
    jiraBody.update = translatedUpdate;
  }

  // 6. Create the issue
  try {
    const created = await createIssue(jiraBody);
    return json(201, created);
  } catch (err) {
    if (err instanceof JiraApiError) {
      // Forward Jira's status + body faithfully (Jira's own error format)
      return {
        statusCode: err.status,
        headers: { "Content-Type": "application/json" },
        body: err.body,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return problemJson(500, `Failed to create issue: ${message}`);
  }
}
