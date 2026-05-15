/**
 * JWT verification utilities for Forge Remote apps
 *
 * This module uses the 'jose' library as recommended by Atlassian for Forge Remote apps.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */

import * as jose from "jose";
import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "../util/errors";

/**
 * The JWKS endpoint URL for verifying Forge Invocation Tokens (FIT)
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract}
 */
const ATLASSIAN_JWKS_URL =
  "https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json";

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
 * Forge Invocation Token (FIT) payload structure
 * Contains context and metadata about the Forge app invocation
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

export interface JwtToken {
  header: JwtHeader;
  payload: JwtPayload;
  signature: string;
}

/**
 * Parses a JWT into its components (header, payload, signature) without verification
 * Use this only for extracting metadata. For verification, use verifyJwt().
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
 * Verifies JWT expiration
 */
export function isJwtExpired(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now >= payload.exp;
}

/**
 * Retrieves the key ID (kid) from JWT header
 * This is needed to fetch the correct public key from JWKS endpoint
 */
export function getKeyIdFromToken(token: string): string {
  try {
    const parsed = parseJwt(token);
    return parsed.header.kid;
  } catch (error) {
    throw new Error(
      `Failed to extract key ID from token: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Fetches the JWKS (JSON Web Key Set) from Atlassian's public endpoint
 * @returns Promise<jose.JSONWebKeySet>
 */
export async function fetchAtlassianJwks(): Promise<jose.JSONWebKeySet> {
  const jwksUrl = ATLASSIAN_JWKS_URL;

  try {
    const response = await fetch(jwksUrl);
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
 * Creates a local JWKS from Atlassian's public endpoint
 * This creates a reusable key store for efficient verification
 */
export async function createJwksKeyStore(): Promise<jose.JWTVerifyGetKey> {
  return jose.createRemoteJWKSet(new URL(ATLASSIAN_JWKS_URL));
}

/**
 * Verifies a Forge Invocation Token (FIT) using JWKS
 *
 * @param token - The JWT token string
 * @param audience - Expected audience claim (typically your app ID)
 * @param jwks - Optional JWKS key store. If not provided, will fetch from Atlassian
 * @returns Promise<jose.JWTVerifyResult> - Verified JWT payload and protected header
 *
 * @example
 * ```typescript
 * const result = await verifyJwt(token, "ari:cloud:ecosystem::app/your-app-id");
 * console.log(result.payload); // Verified claims
 * ```
 */
export async function verifyJwt(
  token: string,
  audience: string,
  jwks?: jose.JWTVerifyGetKey,
): Promise<jose.JWTVerifyResult> {
  const keyStore = jwks || (await createJwksKeyStore());

  try {
    const result = await jose.jwtVerify(token, keyStore, {
      audience,
    });

    return result;
  } catch (error) {
    throw new Error(
      `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verifies a Forge Invocation Token and extracts the payload
 * This is a convenience function that combines verification and payload extraction
 *
 * @param token - The JWT token string
 * @param audience - Expected audience claim (typically your app ID)
 * @param jwks - Optional JWKS key store
 * @returns Promise<JwtPayload> - Verified and parsed payload
 */
export async function verifyAndParseJwt(
  token: string,
  audience: string,
  jwks?: jose.JWTVerifyGetKey,
): Promise<JwtPayload> {
  const result = await verifyJwt(token, audience, jwks);
  return result.payload as JwtPayload;
}

/**
 * Validates an Authorization header containing a Forge Invocation Token (FIT)
 *
 * Extracts the Bearer token from the Authorization header, validates it against
 * Atlassian's JWKS endpoint, and returns the verified payload in a Result type.
 *
 * Uses RFC 9457 Problem Details format for error responses, consistent with
 * the rest of the forge-ahead library.
 *
 * @param authHeader - The Authorization header value (e.g., "Bearer <token>")
 * @param options - Optional configuration
 * @param options.jwks - Optional pre-created JWKS key store for efficiency
 * @returns Promise<Result<JwtPayload, ProblemDetails>> - Result containing verified JWT payload or error details
 *
 * @example
 * ```typescript
 * const result = await validateAuthHeader(req.headers.authorization, {
 *   jwks: keyStore
 * });
 *
 * if (result.isErr()) {
 *   console.error("Token validation failed:", result.error);
 *   return { statusCode: result.error.status, body: JSON.stringify(result.error) };
 * }
 *
 * const payload = result.value;
 * const appId = payload.app?.id;
 * ```
 */
export async function validateAuthHeader(
  authHeader: string | undefined,
  options?: { jwks?: jose.JWTVerifyGetKey },
): Promise<Result<JwtPayload, ProblemDetails>> {
  let forgeInvocationToken: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    forgeInvocationToken = authHeader.slice(7); // Remove "Bearer " prefix
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

    // Verify the token with Atlassian's JWKS endpoint
    const keyStore =
      options?.jwks || jose.createRemoteJWKSet(new URL(ATLASSIAN_JWKS_URL));

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
