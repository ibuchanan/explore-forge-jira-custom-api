/**
 * Shared test helpers for workitem handler tests.
 *
 * Centralises the `makeRequest`, `makeRawRequest`, `makeJwt`, and
 * `makeResolution` builders that are common across handler tests.
 *
 * JWT helpers use `jose` to mint real signed tokens so that the JWT
 * verification in `verifyBearerToken` exercises the full jose code path.
 * Handler tests stub the env var to a known test secret and use `makeJwt`
 * (or `makeRequest` which calls it internally) to produce valid tokens.
 */

import { SignJWT } from "jose";
import { createSecretKey } from "node:crypto";
import { ok } from "forge-ahead";

// ---------------------------------------------------------------------------
// Test secrets and audiences
// ---------------------------------------------------------------------------

/**
 * Test shared secret for plain (non-as-user) handlers.
 * Tests stub WEBTRIGGER_TOKEN to this value in beforeEach.
 */
export const TEST_WEBTRIGGER_TOKEN = "test-secret-for-unit-tests-plain";

/**
 * Test shared secret for as-user handlers.
 * Tests stub WEBTRIGGER_AS_USER_TOKEN to this value in beforeEach.
 */
export const TEST_WEBTRIGGER_AS_USER_TOKEN =
  "test-secret-for-unit-tests-as-user";

/** The aud claim for plain handlers — mirrors EXPECTED_AUDIENCE in auth.ts. */
export const AUDIENCE_PLAIN = "write:workitem:custom";

/** The aud claim for as-user handlers — mirrors EXPECTED_AUDIENCE in auth.ts. */
export const AUDIENCE_AS_USER = "write:workitem-as-user:custom";

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

export interface MakeJwtOptions {
  /** Shared secret to sign with. Defaults to TEST_WEBTRIGGER_TOKEN. */
  secret?: string;
  /** aud claim. Defaults to AUDIENCE_PLAIN. */
  audience?: string;
  /** iss claim. Defaults to "test-issuer". */
  issuer?: string;
  /** Expiry string or NumericDate. Defaults to "15m". */
  expiresIn?: string;
  /** Override the iat (seconds since epoch). Defaults to now. */
  issuedAt?: number;
}

/**
 * Mint a real HS256-signed JWT for use in tests.
 *
 * Produces a valid token that passes `verifyBearerToken` when the corresponding
 * env var is stubbed to the same secret. Override fields to test failure cases
 * (wrong aud, expired token, wrong secret, etc.).
 */
export async function makeJwt(options: MakeJwtOptions = {}): Promise<string> {
  const {
    secret = TEST_WEBTRIGGER_TOKEN,
    audience = AUDIENCE_PLAIN,
    issuer = "test-issuer",
    expiresIn = "15m",
    issuedAt,
  } = options;

  const secretKey = createSecretKey(secret, "utf-8");
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setExpirationTime(expiresIn);

  if (issuedAt !== undefined) {
    builder.setIssuedAt(issuedAt);
  } else {
    builder.setIssuedAt();
  }

  return builder.sign(secretKey);
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

/**
 * Serialise any value as a Forge-style request body object with a valid JWT
 * Authorization header.
 *
 * Handler tests must also stub the env var in beforeEach:
 *   vi.stubEnv("WEBTRIGGER_TOKEN", TEST_WEBTRIGGER_TOKEN)
 *
 * @param body  - Request body (will be JSON.stringified)
 * @param token - Pre-minted JWT string. Defaults to a freshly minted valid token.
 */
export async function makeRequest(
  body: unknown,
  token?: string,
): Promise<{ body: string; headers: Record<string, string[]> }> {
  const jwt = token ?? (await makeJwt());
  return {
    body: JSON.stringify(body),
    headers: { authorization: [`Bearer ${jwt}`] },
  };
}

/**
 * Like makeRequest but for as-user handlers — uses AUDIENCE_AS_USER by default.
 */
export async function makeAsUserRequest(
  body: unknown,
  token?: string,
): Promise<{ body: string; headers: Record<string, string[]> }> {
  const jwt =
    token ??
    (await makeJwt({
      secret: TEST_WEBTRIGGER_AS_USER_TOKEN,
      audience: AUDIENCE_AS_USER,
    }));
  return {
    body: JSON.stringify(body),
    headers: { authorization: [`Bearer ${jwt}`] },
  };
}

/**
 * Build a request with a raw (pre-serialised) body string and a JWT auth header.
 * Use when testing invalid JSON or other malformed body strings.
 */
export async function makeRawRequest(
  rawBody: string,
  token?: string,
): Promise<{ body: string; headers: Record<string, string[]> }> {
  const jwt = token ?? (await makeJwt());
  return {
    body: rawBody,
    headers: { authorization: [`Bearer ${jwt}`] },
  };
}

/**
 * Like makeRawRequest but for as-user handlers.
 */
export async function makeRawAsUserRequest(
  rawBody: string,
  token?: string,
): Promise<{ body: string; headers: Record<string, string[]> }> {
  const jwt =
    token ??
    (await makeJwt({
      secret: TEST_WEBTRIGGER_AS_USER_TOKEN,
      audience: AUDIENCE_AS_USER,
    }));
  return {
    body: rawBody,
    headers: { authorization: [`Bearer ${jwt}`] },
  };
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

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
