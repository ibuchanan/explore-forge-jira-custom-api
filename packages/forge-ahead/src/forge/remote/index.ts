/**
 * forge-ahead Forge Remote module.
 *
 * Barrel that re-exports all JWT and JWKS verification utilities for
 * Forge Remote backends.
 *
 * Available as `forge-ahead/remote`:
 *
 *   import {
 *     parseJwt, isJwtExpired, getKeyIdFromToken,  // pure helpers, no deps
 *     createJwksKeyStore, validateAuthHeader,      // JWKS / verification
 *   } from "forge-ahead/remote";
 *
 * If you only need the pure parsing helpers and want to avoid pulling in
 * `jose`, import directly from the sub-module:
 *
 *   import { parseJwt } from "forge-ahead/remote/jwt";  // zero deps
 */

// Pure JWT parsing helpers (no jose, no network, no @forge/api)
export type {
  ForgeInvocationTokenPayload,
  JwtHeader,
  JwtPayload,
  JwtToken,
} from "./jwt";
export { getKeyIdFromToken, isJwtExpired, parseJwt } from "./jwt";

// Atlassian JWKS verification (requires jose, makes network calls)
export {
  createJwksKeyStore,
  fetchAtlassianJwks,
  validateAuthHeader,
  verifyAndParseJwt,
  verifyJwt,
} from "./verify";
