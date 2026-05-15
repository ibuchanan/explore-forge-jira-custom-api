/**
 * Pure JWT parsing and inspection utilities.
 *
 * This module has NO runtime dependencies — not on `jose`, not on `@forge/api`,
 * not on any network call. Everything here works purely on strings and plain
 * JavaScript objects, making it safe to import in any environment (Node, edge,
 * browser, or non-Forge backends).
 *
 * For cryptographic verification of Forge Invocation Tokens, see `./verify.ts`.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtHeader {
  alg: string;
  typ: string;
  kid: string;
}

export interface JwtPayload {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

/**
 * Forge Invocation Token (FIT) payload structure.
 * Contains context and metadata about the Forge app invocation.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */
export interface ForgeInvocationTokenPayload extends JwtPayload {
  app: {
    id: string;
    version: string;
    appVersion: string;
    installationId: string;
    apiBaseUrl: string;
    environment: {
      type: string;
      id: string;
    };
    module: {
      type: string;
      key: string;
    };
    installation: {
      id: string;
      contexts: Array<{
        name: string;
        apiBaseUrl: string;
      }>;
    };
  };
  context: {
    cloudId: string;
    moduleKey: string;
    userAccess: {
      enabled: boolean;
      hasAccess: boolean;
    };
  };
  principal: string;
}

/** A JWT split into its three decoded components. */
export interface JwtToken {
  header: JwtHeader;
  payload: JwtPayload;
  signature: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JWT string into its components (header, payload, signature)
 * **without** performing any cryptographic verification.
 *
 * Use this only for extracting metadata (e.g. to read the `kid` before
 * fetching the matching public key). For cryptographic verification, use
 * `verifyJwt()` from `./verify.ts`.
 *
 * @throws When the token does not have the expected `header.payload.sig` format.
 */
export function parseJwt(token: string): JwtToken {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format: expected 3 parts separated by dots");
  }

  const [headerB64, payloadB64, signature] = parts;

  try {
    const header = JSON.parse(
      Buffer.from(headerB64 || "", "base64").toString("utf-8"),
    ) as JwtHeader;
    const payload = JSON.parse(
      Buffer.from(payloadB64 || "", "base64").toString("utf-8"),
    ) as JwtPayload;

    return { header, payload, signature: signature || "" };
  } catch (error) {
    throw new Error(
      `Failed to parse JWT: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Return `true` when the JWT `exp` claim is in the past.
 *
 * This is a local check against `Date.now()` — no network call is made and
 * no signature is verified. Use alongside `verifyJwt()` for full validation.
 */
export function isJwtExpired(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now >= payload.exp;
}

/**
 * Extract the `kid` (key ID) from a JWT's header without verifying it.
 * Useful for selecting the right public key from a JWKS before verification.
 *
 * @throws When the token cannot be parsed.
 */
export function getKeyIdFromToken(token: string): string | undefined {
  try {
    const parsed = parseJwt(token);
    return parsed.header.kid;
  } catch (error) {
    throw new Error(
      `Failed to extract key ID from token: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
