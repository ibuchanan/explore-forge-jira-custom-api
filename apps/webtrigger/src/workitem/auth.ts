/**
 * JWT Bearer token authentication for webtrigger handlers.
 *
 * Webtrigger URLs are not authenticated by the Forge platform (by design).
 * This module implements app-level JWT authentication to gate all four
 * webtrigger handlers.
 *
 * Callers generate a short-lived JWT (≤15 min) signed with a shared secret
 * (HS256) and send it as a Bearer token. The app verifies the signature,
 * expiry, audience, and issuer claims before processing the request.
 *
 * Two secrets mirror the scope split from ADR-0006:
 *  - WEBTRIGGER_TOKEN          → aud "write:workitem:custom"
 *  - WEBTRIGGER_AS_USER_TOKEN  → aud "write:workitem-as-user:custom"
 *
 * Secrets are stored as Forge environment variables (forge variables set).
 *
 * Known limitations (see README and specs/bullet4-webtrigger-auth.md):
 *  - No jti: JWTs can be replayed within the 15-min window
 *  - No iss allowlist: any non-empty iss is accepted
 *
 * @see specs/bullet4-webtrigger-auth.md
 */

import { createSecretKey } from "node:crypto";
import { jwtVerify } from "jose";
import type { ApiRouteResponse } from "forge-ahead";
import { StandardError } from "forge-ahead";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Clock skew leeway in seconds applied when checking the `exp` claim.
 * Tokens expired by less than this amount are still accepted.
 * Adjust if callers have unusual clock drift relative to Forge infrastructure.
 */
const CLOCK_SKEW_LEEWAY_SECONDS = 30;

/**
 * The two Forge environment variable names that hold webtrigger shared secrets.
 * A union literal type catches typos at compile time.
 */
export type WebtriggerTokenVar =
  | "WEBTRIGGER_TOKEN"
  | "WEBTRIGGER_AS_USER_TOKEN";

/**
 * Maps each env var to the `aud` claim value the JWT must carry.
 * Mirrors the custom scope split from ADR-0006.
 */
const EXPECTED_AUDIENCE: Record<WebtriggerTokenVar, string> = {
  WEBTRIGGER_TOKEN: "write:workitem:custom",
  WEBTRIGGER_AS_USER_TOKEN: "write:workitem-as-user:custom",
};

/** HTTP headers as a multi-value map (header names are lowercase). */
type Headers = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a webtrigger-compatible error response using ProblemDetails shape.
 * Consistent with all other error responses in this app.
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
      ...(statusCode === 401 ? { "WWW-Authenticate": ["Bearer"] } : {}),
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verifies the JWT Bearer token in the Authorization header.
 *
 * Returns `{ ok: true }` on success.
 * Returns `{ ok: false; response: ApiRouteResponse }` on failure —
 * the caller should return `result.response` immediately.
 *
 * **Failure cases:**
 * - Env var not set → 500 (operator misconfiguration)
 * - Authorization header absent or not `Bearer <token>` → 401
 * - JWT invalid (bad signature, wrong aud, expired, missing claims) → 401
 *
 * **JWT requirements (HS256):**
 * - `exp`: must be ≤ 15 min from `iat` (enforced by callers; not checked here)
 * - `iat`: required for auditing
 * - `iss`: required; logged on success for audit trail
 * - `aud`: must match the scope for the target endpoint
 *
 * **Known limitations:**
 * - No `jti` check: replay possible within the `exp` window
 * - No `iss` allowlist: any non-empty `iss` is accepted
 *   (TODO: add WEBTRIGGER_ALLOWED_ISSUERS env var for stricter isolation)
 *
 * @param headers    - Inbound request headers (multi-value, lowercase names)
 * @param envVarName - Which Forge environment variable holds the shared secret
 *
 * @example
 * ```typescript
 * const auth = await verifyBearerToken(req.headers, "WEBTRIGGER_TOKEN");
 * if (!auth.ok) return auth.response;
 * ```
 */
export async function verifyBearerToken(
  headers: Headers | undefined,
  envVarName: WebtriggerTokenVar,
): Promise<{ ok: true } | { ok: false; response: ApiRouteResponse }> {
  // 1. Check env var is configured (operator error if missing)
  const secret = process.env[envVarName];
  if (!secret) {
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
      "webtrigger auth failed: missing or malformed Authorization header",
    );
    return {
      ok: false,
      response: makeErrorResponse(401, "A valid Bearer token is required."),
    };
  }

  // 3. Extract the JWT from "Bearer <jwt>"
  const token = authHeader.slice(BEARER_PREFIX.length);

  // 4. Verify: signature, exp (with leeway), aud, iss presence
  const audience = EXPECTED_AUDIENCE[envVarName];
  const secretKey = createSecretKey(secret, "utf-8");

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
      audience,
      clockTolerance: CLOCK_SKEW_LEEWAY_SECONDS,
      requiredClaims: ["iss", "iat"],
    });

    // iss is required and validated present by requiredClaims above
    console.info(`webtrigger auth success: iss=${String(payload.iss)}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`webtrigger auth failed: ${message}`);
    return {
      ok: false,
      response: makeErrorResponse(401, "A valid Bearer token is required."),
    };
  }
}
