/**
 * Shared test helpers for workitem handler tests.
 *
 * Centralises the `makeRequest` and `makeResolution` builders that are
 * common across handler.test.ts, upsert-handler.test.ts,
 * insert-as-user-handler.test.ts, and upsert-as-user-handler.test.ts.
 */

import { ok } from "forge-ahead";

/**
 * Serialise any value as a Forge-style request body object.
 */
export function makeRequest(body: unknown): { body: string } {
  return { body: JSON.stringify(body) };
}

/**
 * Build a successful `resolveFieldNames` result from a list of
 * [displayName, fieldId] pairs.
 *
 * Defaults to a single `["Summary", "summary"]` entry so callers that only
 * care about the happy path can skip the argument entirely.
 *
 * Pass an explicit `fieldMetaById` map to control coercion behaviour in tests
 * that mock at the resolver level but still exercise the coercion path.
 * Pass an empty map to skip coercion entirely (values pass through unchanged).
 */
export function makeResolution(
  entries: [string, string][] = [["Summary", "summary"]],
  fieldMetaById?: Map<string, unknown>,
) {
  return ok({
    resolved: new Map(entries),
    fieldMetaById:
      fieldMetaById ??
      new Map(entries.map(([, id]) => [id, { schema: { type: "string" } }])),
  });
}
