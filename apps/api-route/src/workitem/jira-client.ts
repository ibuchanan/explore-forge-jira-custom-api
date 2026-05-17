/**
 * Thin Jira REST API client for the workitem handler.
 *
 * All requests use `api.asUser()` so the caller's identity and permissions
 * govern what can be created/read — no extra authorization checks needed.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/product-fetch-api/|Product Fetch API}
 */

import api, { route } from "@forge/api";
import type { RequestProductMethods } from "@forge/api";
import type { components } from "forge-ahead/jira/platform-3";
import type { WorkitemResponse } from "./types";

type IssueTypeIssueCreateMetadata =
  components["schemas"]["IssueTypeIssueCreateMetadata"];
type FieldCreateMetadata = components["schemas"]["FieldCreateMetadata"];
type PageOfCreateMetaIssueTypes =
  components["schemas"]["PageOfCreateMetaIssueTypes"];
type PageOfCreateMetaIssueTypeWithField =
  components["schemas"]["PageOfCreateMetaIssueTypeWithField"];
type CreatedIssue = components["schemas"]["CreatedIssue"];

/**
 * Fetches all issue types available for a project via the create-meta endpoint.
 *
 * @param projectKey - Jira project key (e.g. "HSP")
 * @param caller     - Which identity to use: `asUser()` or `asApp()`
 */
export async function getIssueTypes(
  projectKey: string,
  caller: "asUser" | "asApp" = "asUser",
): Promise<IssueTypeIssueCreateMetadata[]> {
  const url = route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`;
  const response = await (caller === "asApp"
    ? api.asApp().requestJira(url, { headers: { Accept: "application/json" } })
    : api
        .asUser()
        .requestJira(url, { headers: { Accept: "application/json" } }));

  if (!response.ok) {
    throw new Error(
      `Failed to fetch issue types for project ${projectKey}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as PageOfCreateMetaIssueTypes;

  // Jira returns either `issueTypes` or `createMetaIssueType` depending on the endpoint variant
  return data.issueTypes ?? data.createMetaIssueType ?? [];
}

/**
 * Fetches ALL field definitions for a specific project + issue type combination.
 *
 * The createMeta fields endpoint is paginated. Jira Cloud caps maxResults
 * server-side, so this fetches all pages in a loop until `isLast: true`.
 *
 * @param projectKey   - Jira project key (e.g. "HSP")
 * @param issueTypeId  - Jira issue type ID (e.g. "10001")
 * @param caller       - Which identity to use: `asUser()` or `asApp()`
 */
export async function getFieldsForIssueType(
  projectKey: string,
  issueTypeId: string,
  caller: "asUser" | "asApp" = "asUser",
): Promise<FieldCreateMetadata[]> {
  const allFields: FieldCreateMetadata[] = [];
  let startAt = 0;
  let isLast = false;

  while (!isLast) {
    const url = route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}?startAt=${startAt}&maxResults=50`;

    const response = await (caller === "asApp"
      ? api
          .asApp()
          .requestJira(url, { headers: { Accept: "application/json" } })
      : api
          .asUser()
          .requestJira(url, { headers: { Accept: "application/json" } }));

    if (!response.ok) {
      throw new Error(
        `Failed to fetch fields for project ${projectKey}, issueType ${issueTypeId}: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as PageOfCreateMetaIssueTypeWithField;
    const pageFields = data.fields ?? data.results ?? [];
    allFields.push(...pageFields);

    // isLast is a boolean on PageOfCreateMetaIssueTypeWithField; fall back to
    // empty page as termination signal for APIs that don't set it.
    isLast = (data as { isLast?: boolean }).isLast ?? pageFields.length === 0;
    startAt += pageFields.length;
  }

  return allFields;
}

/**
 * Minimal interface for an authenticated Forge API client.
 * Satisfied by both `api.asApp()` and `api.asUser(accountId)` return values.
 */
export type AuthClient = RequestProductMethods;

/**
 * Searches Jira issues using JQL and returns up to `maxResults` issue keys.
 *
 * Used by the upsert handler to check for duplicates before creating an issue.
 * Caps at 10 results per the dedup spec.
 *
 * @param jql        - JQL query string to execute
 * @param maxResults - Maximum number of results to fetch (default 10)
 * @param authClient - Authenticated Forge API client (default: asApp())
 */
export async function searchIssues(
  jql: string,
  maxResults = 10,
  authClient: AuthClient = api.asApp(),
): Promise<string[]> {
  const response = await authClient.requestJira(
    route`/rest/api/3/issue/search`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jql, maxResults, fields: ["key"] }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new JiraApiError(response.status, errorBody);
  }

  const data = (await response.json()) as {
    issues?: { key?: string }[];
  };
  return (data.issues ?? [])
    .map((issue) => issue.key ?? "")
    .filter(Boolean)
    .slice(0, maxResults);
}

/**
 * Creates a Jira issue with the provided (already-translated) body.
 * The `fields` and `update` maps must use raw Jira field IDs at this point.
 *
 * @param body       - Translated issue body with raw Jira field IDs
 * @param authClient - Authenticated Forge API client (default: asApp())
 */
export async function createIssue(
  body: {
    fields: Record<string, unknown>;
    update?: Record<string, unknown>;
  },
  authClient: AuthClient = api.asApp(),
): Promise<WorkitemResponse> {
  const response = await authClient.requestJira(route`/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Surface Jira's own error body to the caller
    const errorBody = await response.text();
    throw new JiraApiError(response.status, errorBody);
  }

  const created = (await response.json()) as CreatedIssue;
  return {
    id: created.id ?? "",
    key: created.key ?? "",
    self: created.self ?? "",
  };
}

/**
 * Writes OTel trace context as an issue entity property.
 *
 * This is best-effort: if the write fails, the error is logged but the
 * caller is not notified (issue creation is not rolled back).
 *
 * @see {@link https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-properties/#api-rest-api-3-issue-issueidorkey-properties-propertykey-put|Jira issue properties API}
 */
export async function writeOtelProperty(
  issueKey: string,
  otel: {
    traceId: string;
    spanId: string;
    traceFlags?: string;
    traceState?: string;
  },
): Promise<void> {
  const response = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueKey}/properties/otel`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        traceId: otel.traceId,
        spanId: otel.spanId,
        traceFlags: otel.traceFlags ?? "01",
        traceState: otel.traceState ?? "",
      }),
    });

  if (!response.ok) {
    const text = await response.text();
    console.warn(
      `[otel] Failed to write issue property for ${issueKey}: ${response.status} ${text}`,
    );
  }
}

/**
 * Structured error carrying the Jira HTTP status and raw response body,
 * so the handler can forward it faithfully.
 */
export class JiraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Jira API error ${status}: ${body}`);
    this.name = "JiraApiError";
  }
}
