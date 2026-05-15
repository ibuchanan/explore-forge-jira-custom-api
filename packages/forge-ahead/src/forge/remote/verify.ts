/**
 * Atlassian Forge Invocation Token (FIT) verification utilities.
 *
 * This module handles the networked, cryptographic side of Forge Remote auth:
 * - Fetching Atlassian's public JWKS endpoint
 * - Creating a cached JWKS key store
 * - Verifying and parsing Forge Invocation Tokens
 * - Validating an HTTP Authorization header end-to-end
 *
 * Dependencies: `jose` (JWT crypto), `../util/errors` (Result type).
 * Does NOT depend on `@forge/api` — safe to use in non-Forge Node backends.
 *
 * For lightweight, non-networked JWT helpers (parseJwt, isJwtExpired, etc.)
 * see `./jwt.ts`.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */

import * as jose from "jose";
import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "../../util/errors";
import type { JwtPayload } from "./jwt";

/**
 * The JWKS endpoint URL for verifying Forge Invocation Tokens (FIT).
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract}
 */
const ATLASSIAN_JWKS_URL =
  "https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json";

// ---------------------------------------------------------------------------
// JWKS fetching / key store
// ---------------------------------------------------------------------------

/**
 * Fetch the raw JWKS from Atlassian's public endpoint.
 *
 * Prefer `createJwksKeyStore()` in production — it returns a cached,
 * auto-refreshing key store rather than a one-shot fetch.
 */
export async function fetchAtlassianJwks(): Promise<jose.JSONWebKeySet> {
  try {
    const response = await fetch(ATLASSIAN_JWKS_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch JWKS: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as jose.JSONWebKeySet;
  } catch (error) {
    throw new Error(
      `Error fetching Atlassian JWKS: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Create a reusable, auto-refreshing JWKS key store backed by Atlassian's
 * public endpoint.
 *
 * Instantiate this once (e.g. at module level or in a warm-up handler) and
 * pass it to `verifyJwt()` / `validateAuthHeader()` to avoid a fresh JWKS
 * fetch on every invocation.
 */
export async function createJwksKeyStore(): Promise<jose.JWTVerifyGetKey> {
  return jose.createRemoteJWKSet(new URL(ATLASSIAN_JWKS_URL));
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verify a Forge Invocation Token (FIT) against Atlassian's JWKS.
 *
 * @param token    - The JWT string to verify.
 * @param audience - Expected `aud` claim (typically your Forge app ARI).
 * @param jwks     - Optional pre-created key store. When omitted a new one
 *                   is created (adds a network round-trip).
 * @returns The verified `jose.JWTVerifyResult` (payload + protected header).
 * @throws  When the token is invalid, expired, or the audience does not match.
 *
 * @example
 * ```ts
 * const jwks = await createJwksKeyStore();
 * const { payload } = await verifyJwt(token, "ari:cloud:ecosystem::app/my-app-id", jwks);
 * ```
 */
export async function verifyJwt(
  token: string,
  audience: string,
  jwks?: jose.JWTVerifyGetKey,
): Promise<jose.JWTVerifyResult> {
  const keyStore = jwks ?? (await createJwksKeyStore());

  try {
    return await jose.jwtVerify(token, keyStore, { audience });
  } catch (error) {
    throw new Error(
      `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify a Forge Invocation Token and return only its payload.
 * Convenience wrapper around `verifyJwt()`.
 *
 * @param token    - The JWT string to verify.
 * @param audience - Expected `aud` claim.
 * @param jwks     - Optional pre-created key store.
 */
export async function verifyAndParseJwt(
  token: string,
  audience: string,
  jwks?: jose.JWTVerifyGetKey,
): Promise<JwtPayload> {
  const result = await verifyJwt(token, audience, jwks);
  return result.payload as JwtPayload;
}

// ---------------------------------------------------------------------------
// Authorization header validation
// ---------------------------------------------------------------------------

/**
 * Validate an HTTP `Authorization: Bearer <token>` header containing a
 * Forge Invocation Token (FIT).
 *
 * Extracts the Bearer token, discovers the `aud` from the decoded payload,
 * verifies the signature against Atlassian's JWKS, and returns the verified
 * payload wrapped in a `Result`.
 *
 * Errors use RFC 9457 Problem Details format, consistent with the rest of
 * the forge-ahead library.
 *
 * @param authHeader - The raw `Authorization` header value, e.g.
 *                     `"Bearer eyJ..."`.
 * @param options    - Optional config.
 * @param options.jwks - A pre-created JWKS key store (recommended for
 *                       production to avoid per-request JWKS fetches).
 *
 * @example
 * ```ts
 * const jwks = await createJwksKeyStore(); // warm up once
 *
 * // inside your request handler:
 * const result = await validateAuthHeader(req.headers.authorization, { jwks });
 * if (result.isErr()) {
 *   return res.status(result.error.status).json(result.error);
 * }
 * const payload = result.value;
 * ```
 */
export async function validateAuthHeader(
  authHeader: string | undefined,
  options?: { jwks?: jose.JWTVerifyGetKey },
): Promise<Result<JwtPayload, ProblemDetails>> {
  let forgeInvocationToken: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    forgeInvocationToken = authHeader.slice(7);
  }

  if (!forgeInvocationToken) {
    return StandardError.getOrDefault(401).error(
      "No valid auth token provided in the Authorization header",
    );
  }

  try {
    const decoded = jose.decodeJwt(forgeInvocationToken);
    const appData = (decoded as Record<string, unknown>).app as
      | Record<string, unknown>
      | undefined;
    const appId = appData?.id as string | undefined;

    if (!appId) {
      return StandardError.getOrDefault(401).error(
        "App ID not found in JWT payload",
      );
    }

    const keyStore =
      options?.jwks ?? jose.createRemoteJWKSet(new URL(ATLASSIAN_JWKS_URL));

    const result = await jose.jwtVerify(forgeInvocationToken, keyStore, {
      audience: appId,
      issuer: "forge/invocation-token",
    });

    return ok(result.payload as JwtPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return StandardError.getOrDefault(401).error(
      `Failed to validate the invocation token: ${message}`,
    );
  }
}
