/**
 * Unit tests for verifyBearerToken (JWT edition).
 *
 * Tests use jose's SignJWT to mint real HS256 tokens so that the full
 * jose verification code path is exercised. Failure cases are produced
 * by minting tokens with wrong secrets, wrong audiences, expired expiry,
 * or missing required claims.
 *
 * Environment variables are stubbed per-test using vi.stubEnv so tests
 * are fully isolated and do not pollute process.env.
 */

import { SignJWT } from "jose";
import { createSecretKey } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyBearerToken } from "../../src/workitem/auth";
import {
  AUDIENCE_AS_USER,
  AUDIENCE_PLAIN,
  TEST_WEBTRIGGER_AS_USER_TOKEN,
  TEST_WEBTRIGGER_TOKEN,
  makeJwt,
} from "./test-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN_VAR = "WEBTRIGGER_TOKEN" as const;
const AS_USER_TOKEN_VAR = "WEBTRIGGER_AS_USER_TOKEN" as const;

/** Build a valid plain JWT with sensible defaults. */
async function validPlainJwt(overrides: Parameters<typeof makeJwt>[0] = {}) {
  return makeJwt({ secret: TEST_WEBTRIGGER_TOKEN, audience: AUDIENCE_PLAIN, ...overrides });
}

/** Build a valid as-user JWT with sensible defaults. */
async function validAsUserJwt(overrides: Parameters<typeof makeJwt>[0] = {}) {
  return makeJwt({ secret: TEST_WEBTRIGGER_AS_USER_TOKEN, audience: AUDIENCE_AS_USER, ...overrides });
}

/** Headers object carrying the given token as a Bearer. */
function authHeaders(token: string): Record<string, string[]> {
  return { authorization: [`Bearer ${token}`] };
}

// ---------------------------------------------------------------------------
// Env var not configured
// ---------------------------------------------------------------------------

describe("verifyBearerToken — env var not configured", () => {
  beforeEach(() => {
    vi.stubEnv(TOKEN_VAR, undefined as unknown as string);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns ok:false with 500 when env var is missing", async () => {
    const jwt = await validPlainJwt();
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.statusCode).toBe(500);
      const body = JSON.parse(result.response.body ?? "{}");
      expect(body.status).toBe(500);
      expect(body.detail).toMatch(/WEBTRIGGER_TOKEN/);
    }
  });

  it("returns 500 with no WWW-Authenticate header (not a caller error)", async () => {
    const jwt = await validPlainJwt();
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.statusCode).toBe(500);
      expect(result.response.headers?.["WWW-Authenticate"]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Missing or malformed Authorization header
// ---------------------------------------------------------------------------

describe("verifyBearerToken — missing or malformed Authorization header", () => {
  beforeEach(() => vi.stubEnv(TOKEN_VAR, TEST_WEBTRIGGER_TOKEN));
  afterEach(() => vi.unstubAllEnvs());

  it("returns 401 when headers is undefined", async () => {
    const result = await verifyBearerToken(undefined, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization header is absent", async () => {
    const result = await verifyBearerToken({}, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization header has no Bearer prefix", async () => {
    const result = await verifyBearerToken(
      { authorization: ["sometoken"] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization uses Basic scheme", async () => {
    const result = await verifyBearerToken(
      { authorization: ["Basic dXNlcjpwYXNz"] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("includes WWW-Authenticate: Bearer on 401 responses", async () => {
    const result = await verifyBearerToken({}, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.headers?.["WWW-Authenticate"]).toEqual(["Bearer"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid JWT
// ---------------------------------------------------------------------------

describe("verifyBearerToken — invalid JWT", () => {
  beforeEach(() => vi.stubEnv(TOKEN_VAR, TEST_WEBTRIGGER_TOKEN));
  afterEach(() => vi.unstubAllEnvs());

  it("returns 401 for a raw secret (not a JWT)", async () => {
    const result = await verifyBearerToken(
      authHeaders(TEST_WEBTRIGGER_TOKEN),
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for a JWT signed with the wrong secret", async () => {
    const jwt = await validPlainJwt({ secret: "wrong-secret-entirely" });
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for a JWT with the wrong audience", async () => {
    const jwt = await validPlainJwt({ audience: AUDIENCE_AS_USER });
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for an expired JWT (exp in the past beyond leeway)", async () => {
    const now = Math.floor(Date.now() / 1000);
    // iat and exp both 10 minutes in the past — well beyond 30s leeway
    const jwt = await validPlainJwt({
      issuedAt: now - 660,
      expiresIn: "-10m",
    });
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for a JWT missing the iss claim", async () => {
    // Build token manually without iss
    const secretKey = createSecretKey(TEST_WEBTRIGGER_TOKEN, "utf-8");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(AUDIENCE_PLAIN)
      .setIssuedAt()
      .setExpirationTime("15m")
      // no setIssuer()
      .sign(secretKey);
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for a JWT missing the iat claim", async () => {
    const secretKey = createSecretKey(TEST_WEBTRIGGER_TOKEN, "utf-8");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(AUDIENCE_PLAIN)
      .setIssuer("test-issuer")
      .setExpirationTime("15m")
      // no setIssuedAt()
      .sign(secretKey);
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("does NOT leak JWT error details in the response body", async () => {
    const jwt = await validPlainJwt({ secret: "wrong-secret" });
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = JSON.parse(result.response.body ?? "{}");
      // Must not include jose internals or the actual secret
      expect(body.detail).toBe("A valid Bearer token is required.");
    }
  });
});

// ---------------------------------------------------------------------------
// Clock skew leeway
// ---------------------------------------------------------------------------

describe("verifyBearerToken — clock skew leeway", () => {
  beforeEach(() => vi.stubEnv(TOKEN_VAR, TEST_WEBTRIGGER_TOKEN));
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a JWT expired by less than 30 seconds (within leeway)", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Expired 20 seconds ago — within the 30s leeway
    const jwt = await validPlainJwt({
      issuedAt: now - 920,
      expiresIn: "-20s",
    });
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(true);
  });

  it("rejects a JWT expired by more than 30 seconds (beyond leeway)", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Expired 60 seconds ago — beyond the 30s leeway
    const jwt = await validPlainJwt({
      issuedAt: now - 960,
      expiresIn: "-60s",
    });
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Success cases
// ---------------------------------------------------------------------------

describe("verifyBearerToken — success", () => {
  beforeEach(() => {
    vi.stubEnv(TOKEN_VAR, TEST_WEBTRIGGER_TOKEN);
    vi.stubEnv(AS_USER_TOKEN_VAR, TEST_WEBTRIGGER_AS_USER_TOKEN);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns ok:true for a valid plain JWT", async () => {
    const jwt = await validPlainJwt();
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for a valid as-user JWT", async () => {
    const jwt = await validAsUserJwt();
    const result = await verifyBearerToken(authHeaders(jwt), AS_USER_TOKEN_VAR);
    expect(result.ok).toBe(true);
  });

  it("uses first value when Authorization header has multiple values", async () => {
    const jwt = await validPlainJwt();
    const result = await verifyBearerToken(
      { authorization: [`Bearer ${jwt}`, "Bearer other"] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects WEBTRIGGER_TOKEN secret against WEBTRIGGER_AS_USER_TOKEN slot", async () => {
    // Plain token JWT cannot pass against the as-user slot (wrong secret + wrong aud)
    const jwt = await validPlainJwt();
    const result = await verifyBearerToken(authHeaders(jwt), AS_USER_TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns { ok: true } with no response property on success", async () => {
    const jwt = await validPlainJwt();
    const result = await verifyBearerToken(authHeaders(jwt), TOKEN_VAR);
    expect(result).toEqual({ ok: true });
  });
});
