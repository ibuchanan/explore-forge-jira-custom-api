/**
 * Thin Jira REST API client for the workitem handler.
 *
 * All requests use `api.asUser()` so the caller's identity and permissions
 * govern what can be created/read — no extra authorization checks needed.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/product-fetch-api/|Product Fetch API}
 */

import api, { route } from "@forge/api";
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
 */
export async function getIssueTypes(
  projectKey: string,
): Promise<IssueTypeIssueCreateMetadata[]> {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, {
      headers: { Accept: "application/json" },
    });

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
 * Fetches all field definitions for a specific project + issue type combination.
 */
export async function getFieldsForIssueType(
  projectKey: string,
  issueTypeId: string,
): Promise<FieldCreateMetadata[]> {
  const response = await api
    .asUser()
    .requestJira(
      route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`,
      {
        headers: { Accept: "application/json" },
      },
    );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch fields for project ${projectKey}, issueType ${issueTypeId}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as PageOfCreateMetaIssueTypeWithField;

  return data.fields ?? data.results ?? [];
}

/**
 * Creates a Jira issue with the provided (already-translated) body.
 * The `fields` and `update` maps must use raw Jira field IDs at this point.
 */
export async function createIssue(body: {
  fields: Record<string, unknown>;
  update?: Record<string, unknown>;
}): Promise<WorkitemResponse> {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue`, {
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
