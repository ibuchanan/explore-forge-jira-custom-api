/**
 * Forge Remote invocation token verification tests
 *
 * These tests complement the Forge Remote invocation contract by specifying JWT
 * parsing, JWKS discovery, audience/issuer verification, and Authorization
 * header handling for Forge Invocation Tokens (FITs).
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#the-forge-invocation-token-fit|Forge Invocation Token}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7519|RFC 7519 JSON Web Token}
 */

import { describe, expect, it, vi } from "vitest";
import {
  createJwksKeyStore,
  fetchAtlassianJwks,
  getKeyIdFromToken,
  isJwtExpired,
  parseJwt,
  validateAuthHeader,
  verifyAndParseJwt,
  verifyJwt,
  type JwtPayload,
} from "../../src/forge/remote";
import {
  buildLocalJwks,
  buildToken,
  encodeJwtPart,
  generateTestKeyPair,
} from "./jwt-test-helpers";

describe("forge/remote", () => {
  describe("parseJwt", () => {
    it("should parse a valid JWT token", () => {
      // Create a simple JWT (header.payload.signature)
      const header = encodeJwtPart({ alg: "RS256", kid: "key1" });
      const payload = encodeJwtPart({
        iss: "forge/invocation-token",
        sub: "user123",
        aud: "app123",
        iat: 1000000000,
        exp: 1000003600,
      });
      const signature = "signature123";
      const token = `${header}.${payload}.${signature}`;

      const result = parseJwt(token);

      expect(result.header).toEqual({
        alg: "RS256",
        kid: "key1",
      });
      expect(result.payload).toEqual({
        iss: "forge/invocation-token",
        sub: "user123",
        aud: "app123",
        iat: 1000000000,
        exp: 1000003600,
      });
      expect(result.signature).toBe(signature);
    });

    it("should throw for invalid JWT format", () => {
      expect(() => parseJwt("invalid-token")).toThrow();
    });

    it("should throw for malformed JWT payload", () => {
      const token = "header.invalid-base64!!!.signature";
      expect(() => parseJwt(token)).toThrow();
    });
  });

  describe("isJwtExpired", () => {
    it("should return false for valid (not expired) token", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
      const payload: JwtPayload = {
        iss: "test",
        sub: "user",
        aud: "app",
        iat: Math.floor(Date.now() / 1000),
        exp: futureTime,
      };

      expect(isJwtExpired(payload)).toBe(false);
    });

    it("should return true for expired token", () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour in past
      const payload: JwtPayload = {
        iss: "test",
        sub: "user",
        aud: "app",
        iat: pastTime - 7200,
        exp: pastTime,
      };

      expect(isJwtExpired(payload)).toBe(true);
    });

    it("should return true for token expiring now", () => {
      const nowTime = Math.floor(Date.now() / 1000);
      const payload: JwtPayload = {
        iss: "test",
        sub: "user",
        aud: "app",
        iat: nowTime - 3600,
        exp: nowTime,
      };

      expect(isJwtExpired(payload)).toBe(true);
    });
  });

  describe("getKeyIdFromToken", () => {
    it("should extract key ID from JWT header", () => {
      const header = encodeJwtPart({ alg: "RS256", typ: "JWT", kid: "mykey" });
      const payload = encodeJwtPart({ test: "data" });
      const token = `${header}.${payload}.signature`;

      const keyId = getKeyIdFromToken(token);

      expect(keyId).toBe("mykey");
    });

    it("should return undefined if kid not in header", () => {
      const header = encodeJwtPart({ alg: "RS256", typ: "JWT" });
      const payload = encodeJwtPart({ test: "data" });
      const token = `${header}.${payload}.signature`;

      const keyId = getKeyIdFromToken(token);

      // JwtHeader requires kid, so this will be undefined when not present
      expect(keyId as any).toBeUndefined();
    });
  });

  describe("fetchAtlassianJwks", () => {
    it("should fetch JWKS from Atlassian endpoint", async () => {
      const mockJwks = {
        keys: [
          {
            kty: "RSA",
            kid: "key1",
            use: "sig",
            n: "test-modulus",
            e: "AQAB",
          },
        ],
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockJwks),
        } as Response),
      );

      const result = await fetchAtlassianJwks();

      expect(result).toEqual(mockJwks);
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should throw if JWKS fetch fails", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response),
      );

      await expect(fetchAtlassianJwks()).rejects.toThrow();
    });
  });

  describe("validateAuthHeader", () => {
    it("should return error for empty string Authorization header", async () => {
      const result = await validateAuthHeader("");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(401);
      }
    });

    it("should return error for missing Bearer prefix", async () => {
      const result = await validateAuthHeader("just-a-token");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(401);
      }
    });

    it("should return error for empty Bearer token", async () => {
      const result = await validateAuthHeader("Bearer ");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(401);
      }
    });

    it("should return error for undefined Authorization header", async () => {
      const result = await validateAuthHeader(undefined);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(401);
      }
    });

    it("should return error when Bearer token has no app.id claim", async () => {
      // Build a token without an app field — decodeJwt will succeed but appId will be missing
      const { privateKey, publicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(publicKey);
      const token = await buildToken(
        {
          iss: "forge/invocation-token",
          aud: "some-app",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        privateKey,
      );

      const result = await validateAuthHeader(`Bearer ${token}`, { jwks });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(401);
        expect(result.error.detail).toContain("App ID not found");
      }
    });

    it("should return ok with payload when token is valid and app.id matches audience", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(publicKey);
      const appId = "ari:cloud:ecosystem::app/test-app";
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        {
          iss: "forge/invocation-token",
          aud: appId,
          iat: now,
          exp: now + 3600,
          app: { id: appId },
        },
        privateKey,
      );

      const result = await validateAuthHeader(`Bearer ${token}`, { jwks });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.aud).toBe(appId);
      }
    });

    it("should return error when token signature is invalid", async () => {
      const { privateKey } = await generateTestKeyPair();
      const { publicKey: wrongPublicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(wrongPublicKey); // wrong key — verification will fail
      const appId = "ari:cloud:ecosystem::app/test-app";
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        {
          iss: "forge/invocation-token",
          aud: appId,
          iat: now,
          exp: now + 3600,
          app: { id: appId },
        },
        privateKey,
      );

      const result = await validateAuthHeader(`Bearer ${token}`, { jwks });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.status).toBe(401);
        expect(result.error.detail).toContain("Failed to validate");
      }
    });
  });

  describe("createJwksKeyStore", () => {
    it("should return a callable key store (JWTVerifyGetKey)", async () => {
      // createJwksKeyStore calls jose.createRemoteJWKSet internally.
      // We verify the returned value is a function without hitting the network
      // by building an actual in-process key pair and confirming the type.
      // (ESM modules cannot be spied upon, so we test the observable contract.)
      const keyStore = await createJwksKeyStore();
      expect(typeof keyStore).toBe("function");
    });
  });

  describe("verifyJwt", () => {
    it("should return a JWTVerifyResult for a valid signed token", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(publicKey);
      const audience = "ari:cloud:ecosystem::app/my-app";
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        {
          iss: "forge/invocation-token",
          aud: audience,
          iat: now,
          exp: now + 3600,
        },
        privateKey,
      );

      const result = await verifyJwt(token, audience, jwks);

      expect(result.payload.aud).toBe(audience);
    });

    it("should throw when audience does not match", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(publicKey);
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        {
          iss: "forge/invocation-token",
          aud: "correct-audience",
          iat: now,
          exp: now + 3600,
        },
        privateKey,
      );

      await expect(verifyJwt(token, "wrong-audience", jwks)).rejects.toThrow(
        "JWT verification failed",
      );
    });

    it("should throw when the token is signed with the wrong key", async () => {
      const { privateKey } = await generateTestKeyPair();
      const { publicKey: wrongKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(wrongKey);
      const audience = "ari:cloud:ecosystem::app/my-app";
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        { aud: audience, iat: now, exp: now + 3600 },
        privateKey,
      );

      await expect(verifyJwt(token, audience, jwks)).rejects.toThrow(
        "JWT verification failed",
      );
    });

    it("should throw when no jwks is supplied and no network is available", async () => {
      // Without a jwks argument, verifyJwt calls createJwksKeyStore() which
      // calls jose.createRemoteJWKSet. The returned key store will fail when
      // asked to verify an invalid token, confirming the code path runs.
      // We use an obviously malformed token so it fails fast without network I/O.
      await expect(verifyJwt("not.a.jwt", "audience")).rejects.toThrow();
    });
  });

  describe("verifyAndParseJwt", () => {
    it("should return the verified payload directly", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(publicKey);
      const audience = "ari:cloud:ecosystem::app/my-app";
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        {
          iss: "forge/invocation-token",
          aud: audience,
          sub: "user-123",
          iat: now,
          exp: now + 3600,
        },
        privateKey,
      );

      const payload = await verifyAndParseJwt(token, audience, jwks);

      expect(payload.aud).toBe(audience);
      expect(payload.sub).toBe("user-123");
    });

    it("should throw when verifyJwt throws", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const jwks = buildLocalJwks(publicKey);
      const now = Math.floor(Date.now() / 1000);
      const token = await buildToken(
        { aud: "correct", iat: now, exp: now + 3600 },
        privateKey,
      );

      await expect(
        verifyAndParseJwt(token, "wrong-audience", jwks),
      ).rejects.toThrow("JWT verification failed");
    });
  });
});
