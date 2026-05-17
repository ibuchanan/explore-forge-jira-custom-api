/**
 * Bearer token authentication for webtrigger handlers.
 *
 * Webtrigger URLs are not authenticated by the Forge platform (by design).
 * This module implements app-level Bearer token verification to gate all
 * four webtrigger handlers.
 *
 * Two tokens mirror the scope split from ADR-0006:
 *  - WEBTRIGGER_TOKEN          → plain insert and upsert handlers
 *  - WEBTRIGGER_AS_USER_TOKEN  → as-user insert and upsert handlers
 *
 * Secrets are stored as Forge environment variables (forge variables set)
 * and read via process.env at runtime.
 *
 * @see specs/bullet4-webtrigger-auth.md
 */

import { timingSafeEqual } from "node:crypto";
import type { ApiRouteResponse } from "forge-ahead";
import { StandardError } from "forge-ahead";

/** HTTP headers as a multi-value map (header names are lowercase). */
type Headers = Record<string, string[]>;

/**
 * The two Forge environment variable names that hold webtrigger Bearer tokens.
 * A union literal type catches typos at compile time.
 */
export type WebtriggerTokenVar =
  | "WEBTRIGGER_TOKEN"
  | "WEBTRIGGER_AS_USER_TOKEN";

/**
 * Build a webtrigger-compatible error response from ProblemDetails.
 * Uses the same shape as all other error responses in this app.
 */
function makeErrorResponse(
  statusCode: number,
  detail: string,
): ApiRouteResponse {
  const std = StandardError.getOrDefault(statusCode);
  return {
    statusCode,
    headers: {
      "Content-Type": ["application/json"],
      ...(statusCode === 401
        ? { "WWW-Authenticate": ["Bearer"] }
        : {}),
    },
    body: JSON.stringify({
      type: std.type,
      title: std.title,
      status: statusCode,
      detail,
      timestamp: new Date().toISOString(),
    }),
  };
}

/**
 * Verifies the Bearer token in the Authorization header against the
 * expected secret stored in the given Forge environment variable.
 *
 * Returns `{ ok: true }` on success.
 * Returns `{ ok: false; response: ApiRouteResponse }` on failure —
 * the caller should return `result.response` immediately.
 *
 * **Failure cases:**
 * - Env var not set → 500 (operator misconfiguration)
 * - Authorization header absent or not `Bearer <token>` → 401
 * - Token present but does not match → 401
 *
 * **Timing safety:** Token comparison uses `crypto.timingSafeEqual`
 * to eliminate timing oracle attacks.
 *
 * @param headers   - Inbound request headers (multi-value, lowercase names)
 * @param envVarName - Which Forge environment variable holds the expected token
 *
 * @example
 * ```typescript
 * const auth = verifyBearerToken(req.headers, "WEBTRIGGER_TOKEN");
 * if (!auth.ok) return auth.response;
 * ```
 */
export function verifyBearerToken(
  headers: Headers | undefined,
  envVarName: WebtriggerTokenVar,
): { ok: true } | { ok: false; response: ApiRouteResponse } {
  // 1. Check env var is configured (operator error if missing)
  const expected = process.env[envVarName];
  if (!expected) {
    console.warn(
      `webtrigger auth: ${envVarName} environment variable is not configured`,
    );
    return {
      ok: false,
      response: makeErrorResponse(
        500,
        `${envVarName} environment variable is not configured.`,
      ),
    };
  }

  // 2. Extract the Authorization header (headers are lowercase, multi-value)
  const authHeader = headers?.["authorization"]?.[0];
  const BEARER_PREFIX = "Bearer ";

  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    console.warn(
      `webtrigger auth failed: missing or malformed Authorization header`,
    );
    return {
      ok: false,
      response: makeErrorResponse(401, "A valid Bearer token is required."),
    };
  }

  // 3. Extract token from "Bearer <token>"
  const provided = authHeader.slice(BEARER_PREFIX.length);

  // 4. Timing-safe comparison — reject immediately if lengths differ
  //    (length difference does not help an attacker)
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (
    providedBuf.byteLength !== expectedBuf.byteLength ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    console.warn(`webtrigger auth failed: invalid token`);
    return {
      ok: false,
      response: makeErrorResponse(401, "A valid Bearer token is required."),
    };
  }

  return { ok: true };
}
