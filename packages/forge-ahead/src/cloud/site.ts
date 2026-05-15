/**
 * Atlassian Cloud Site Module
 *
 * Utilities for working with Atlassian Cloud sites.
 *
 * An Atlassian Cloud ID is a unique, alphanumeric string that identifies
 * a specific Atlassian Cloud site. Each site has its own cloudId.
 *
 * @see {@link https://developer.atlassian.com/platform/atlassian-resource-identifier/|Atlassian Resource Identifier (ARI)}
 */

import type { ProblemDetails } from "../util/errors";
import { ok, type Result, StandardError } from "../util/errors";

/**
 * Extract cloudId from Atlassian context ARI
 *
 * Atlassian uses ARIs (Atlassian Resource Identifiers) to uniquely identify
 * resources across the platform. The context ARI format for Jira sites is:
 * `ari:cloud:jira::site/${cloudId}`
 *
 * The cloudId is a unique identifier for a specific Atlassian Cloud site.
 *
 * @param context - The context ARI from installation webhook or FIT payload
 * @returns Ok(cloudId) on success, or Err(ProblemDetails) with status 400
 *          if the input is not a string or does not contain a site cloudId.
 *
 * @example
 * ```typescript
 * const ari = "ari:cloud:jira::site/89a6b224-3b44-4cef-8e4d-37aff29af277";
 * const result = extractCloudId(ari);
 * if (result.isOk()) {
 *   console.log(result.value); // "89a6b224-3b44-4cef-8e4d-37aff29af277"
 * }
 * ```
 */
export function extractCloudId(
  context: string,
): Result<string, ProblemDetails> {
  if (!context || typeof context !== "string") {
    return StandardError.getOrDefault(400).error(
      "ARI must be a non-empty string",
    );
  }
  const match = context.match(/site\/([a-f0-9-]+)$/);
  if (!match?.[1]) {
    return StandardError.getOrDefault(400).error(
      "ARI does not contain a valid site cloudId",
    );
  }
  return ok(match[1]);
}
