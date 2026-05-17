/**
 * Unit tests for verifyBearerToken.
 *
 * Tests cover all three failure cases (missing env var, missing/malformed
 * header, invalid token) and the success path.
 *
 * Environment variables are set/restored per test using vi.stubEnv so tests
 * are fully isolated and do not pollute process.env.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyBearerToken } from "../../src/workitem/auth";

const TOKEN_VAR = "WEBTRIGGER_TOKEN" as const;
const AS_USER_TOKEN_VAR = "WEBTRIGGER_AS_USER_TOKEN" as const;
const VALID_TOKEN = "super-secret-token-abc123";

describe("verifyBearerToken — env var not configured", () => {
  beforeEach(() => {
    vi.stubEnv(TOKEN_VAR, undefined as unknown as string);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ok:false with 500 when env var is missing", () => {
    const result = verifyBearerToken(
      { authorization: [`Bearer ${VALID_TOKEN}`] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.statusCode).toBe(500);
      const body = JSON.parse(result.response.body ?? "{}");
      expect(body.status).toBe(500);
      expect(body.detail).toMatch(/WEBTRIGGER_TOKEN/);
    }
  });

  it("returns 500 with no WWW-Authenticate header (not a caller error)", () => {
    const result = verifyBearerToken({}, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.statusCode).toBe(500);
      expect(result.response.headers?.["WWW-Authenticate"]).toBeUndefined();
    }
  });
});

describe("verifyBearerToken — missing or malformed Authorization header", () => {
  beforeEach(() => {
    vi.stubEnv(TOKEN_VAR, VALID_TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ok:false with 401 when headers is undefined", () => {
    const result = verifyBearerToken(undefined, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.statusCode).toBe(401);
      const body = JSON.parse(result.response.body ?? "{}");
      expect(body.status).toBe(401);
      expect(body.detail).toMatch(/Bearer token/i);
    }
  });

  it("returns 401 when Authorization header is absent", () => {
    const result = verifyBearerToken({}, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization header is empty array", () => {
    const result = verifyBearerToken({ authorization: [] }, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization header has no Bearer prefix", () => {
    const result = verifyBearerToken(
      { authorization: [VALID_TOKEN] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization header uses wrong scheme (Basic)", () => {
    const result = verifyBearerToken(
      { authorization: [`Basic dXNlcjpwYXNz`] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for Bearer with no token value", () => {
    const result = verifyBearerToken(
      { authorization: ["Bearer "] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("includes WWW-Authenticate: Bearer on 401 responses", () => {
    const result = verifyBearerToken({}, TOKEN_VAR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.headers?.["WWW-Authenticate"]).toEqual(["Bearer"]);
    }
  });
});

describe("verifyBearerToken — invalid token", () => {
  beforeEach(() => {
    vi.stubEnv(TOKEN_VAR, VALID_TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when token does not match", () => {
    const result = verifyBearerToken(
      { authorization: ["Bearer wrong-token"] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.statusCode).toBe(401);
      const body = JSON.parse(result.response.body ?? "{}");
      expect(body.status).toBe(401);
    }
  });

  it("returns 401 when token is correct prefix but wrong suffix", () => {
    const result = verifyBearerToken(
      { authorization: [`Bearer ${VALID_TOKEN}x`] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 for empty token (different length)", () => {
    const result = verifyBearerToken(
      { authorization: ["Bearer "] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns 401 and does NOT leak token information in body", () => {
    const result = verifyBearerToken(
      { authorization: ["Bearer wrong"] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = JSON.parse(result.response.body ?? "{}");
      // Must not include the actual secret or the provided token
      expect(body.detail).not.toContain(VALID_TOKEN);
      expect(body.detail).not.toContain("wrong");
    }
  });
});

describe("verifyBearerToken — success", () => {
  beforeEach(() => {
    vi.stubEnv(TOKEN_VAR, VALID_TOKEN);
    vi.stubEnv(AS_USER_TOKEN_VAR, "as-user-secret-xyz");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ok:true when token matches exactly", () => {
    const result = verifyBearerToken(
      { authorization: [`Bearer ${VALID_TOKEN}`] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(true);
  });

  it("uses first value when header has multiple values", () => {
    const result = verifyBearerToken(
      { authorization: [`Bearer ${VALID_TOKEN}`, "Bearer other"] },
      TOKEN_VAR,
    );
    expect(result.ok).toBe(true);
  });

  it("verifies WEBTRIGGER_AS_USER_TOKEN independently", () => {
    const result = verifyBearerToken(
      { authorization: ["Bearer as-user-secret-xyz"] },
      AS_USER_TOKEN_VAR,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects WEBTRIGGER_TOKEN against WEBTRIGGER_AS_USER_TOKEN slot", () => {
    // A plain token must not work against the as-user slot
    const result = verifyBearerToken(
      { authorization: [`Bearer ${VALID_TOKEN}`] },
      AS_USER_TOKEN_VAR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("returns ProblemDetails shape on success (no body)", () => {
    const result = verifyBearerToken(
      { authorization: [`Bearer ${VALID_TOKEN}`] },
      TOKEN_VAR,
    );
    // ok:true has no response property
    expect(result).toEqual({ ok: true });
  });
});
