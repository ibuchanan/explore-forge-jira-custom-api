/**
 * Shared test helpers for workitem handler tests.
 *
 * Centralises the `makeRequest` and `makeResolution` builders that are
 * common across handler.test.ts, upsert-handler.test.ts,
 * insert-as-user-handler.test.ts, and upsert-as-user-handler.test.ts.
 */

import { ok } from "forge-ahead";

/**
 * The test token used by makeRequest. Handler tests stub this env var
 * so verifyBearerToken passes without needing a real secret.
 */
export const TEST_WEBTRIGGER_TOKEN = "test-token-for-unit-tests";
export const TEST_WEBTRIGGER_AS_USER_TOKEN = "test-as-user-token-for-unit-tests";

/**
 * Serialise any value as a Forge-style request body object,
 * including a valid Authorization header so the auth gate passes.
 *
 * Handler tests should also call vi.stubEnv("WEBTRIGGER_TOKEN", TEST_WEBTRIGGER_TOKEN)
 * (or the AS_USER variant) in their beforeEach to satisfy verifyBearerToken.
 */
export function makeRequest(
  body: unknown,
  token: string = TEST_WEBTRIGGER_TOKEN,
): { body: string; headers: Record<string, string[]> } {
  return {
    body: JSON.stringify(body),
    headers: { authorization: [`Bearer ${token}`] },
  };
}

/**
 * Build a request with a raw (pre-serialised) body string and auth header.
 * Use this when testing invalid JSON or other malformed body strings that
 * must NOT be JSON.stringified by makeRequest.
 */
export function makeRawRequest(
  rawBody: string,
  token: string = TEST_WEBTRIGGER_TOKEN,
): { body: string; headers: Record<string, string[]> } {
  return {
    body: rawBody,
    headers: { authorization: [`Bearer ${token}`] },
  };
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
