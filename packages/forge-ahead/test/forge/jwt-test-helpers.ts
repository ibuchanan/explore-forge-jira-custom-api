/**
 * Shared JWT test helpers
 *
 * Build minimal signed JWTs in-process using jose so tests can exercise JWT
 * verification paths without hitting the real Atlassian JWKS endpoint.
 *
 * Usage:
 *   import { generateTestKeyPair, buildToken, buildLocalJwks } from "./jwt-test-helpers";
 */

import * as jose from "jose";

/**
 * Generates a fresh RSA-256 key pair for use in a single test or describe block.
 * Generate a new pair per test to keep tests independent.
 */
export async function generateTestKeyPair() {
  return jose.generateKeyPair("RS256");
}

/**
 * Encodes an object as a base64url string — the encoding used in JWT parts.
 * Useful for hand-crafting JWT tokens in parseJwt / getKeyIdFromToken tests.
 */
export function encodeJwtPart(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Signs a JWT payload with the given private key.
 *
 * @param payload - Claims to include in the token
 * @param privateKey - RSA private key (from generateTestKeyPair)
 * @param kid - Key ID embedded in the JWT header (default: "test-key-1")
 */
export async function buildToken(
  payload: Record<string, unknown>,
  privateKey: jose.KeyLike,
  kid = "test-key-1",
): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid })
    .sign(privateKey);
}

/**
 * Creates an in-memory JWTVerifyGetKey function backed by a single public key.
 * Pass the result directly to verifyJwt / verifyAndParseJwt / validateAuthHeader
 * as the `jwks` option to avoid any network calls.
 *
 * @param publicKey - RSA public key (from generateTestKeyPair)
 * @param kid - The key ID this store recognises (must match the kid used in buildToken)
 */
export function buildLocalJwks(
  publicKey: jose.KeyLike,
  kid = "test-key-1",
): jose.JWTVerifyGetKey {
  return async (header) => {
    if (header.kid === kid) return publicKey;
    throw new Error(`Unknown kid: ${header.kid}`);
  };
}

/**
 * Convenience helper: generate a key pair, sign a token, and return all three
 * artefacts in one call. Reduces boilerplate in tests that need a complete
 * signed token and a matching key store.
 *
 * @param payload - Claims to include in the token
 * @param kid - Key ID (default: "test-key-1")
 */
export async function buildSignedToken(
  payload: Record<string, unknown>,
  kid = "test-key-1",
): Promise<{
  token: string;
  jwks: jose.JWTVerifyGetKey;
  publicKey: jose.KeyLike;
}> {
  const { privateKey, publicKey } = await generateTestKeyPair();
  const token = await buildToken(payload, privateKey, kid);
  const jwks = buildLocalJwks(publicKey, kid);
  return { token, jwks, publicKey };
}
