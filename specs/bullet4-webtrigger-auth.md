# Spec: Webtrigger JWT Bearer Token Authentication

## Summary

The webtrigger app exposes four endpoints that are not authenticated by the
Forge platform (by design — see Forge docs). This spec defines the app-level
JWT Bearer token authentication scheme that guards all four handlers.

## Background

Forge webtrigger URLs are intentionally unauthenticated at the platform level
to maximise compatibility with external callers. The Forge docs recommend
implementing authentication logic directly inside the handler, matching the
scheme used by the calling service.

The `apiRoute` app gains authentication for free via OAuth 2.0 (3LO) enforced
by Forge. The webtrigger app must implement its own equivalent gate.

## Auth Scheme

**HTTP Bearer tokens (RFC 6750) carrying a signed JWT (RFC 7519).**

Callers generate a short-lived JWT signed with a shared secret (HS256) and
send it as the Bearer token on every request:

```
Authorization: Bearer <jwt>
```

The JWT is **caller-generated** — no token issuer or STS is involved. The
caller holds the shared secret, mints a new JWT per request (or per batch),
and signs it with HMAC-SHA256. The app verifies the signature and enforces
expiry.

This replaces the previous scheme of sending the raw shared secret directly.
The JWT's `exp` claim limits the replay window to ≤15 minutes, and the `aud`
claim ties the token to a specific privilege level.

## Two Secrets, Mirroring the Scope Split

Two distinct shared secrets mirror the existing scope boundary from ADR-0006:

| Secret env var             | `aud` claim                     | Guards                                              |
|----------------------------|---------------------------------|-----------------------------------------------------|
| `WEBTRIGGER_TOKEN`         | `write:workitem:custom`         | `handleWorkitem`, `handleWorkitemUpsert`            |
| `WEBTRIGGER_AS_USER_TOKEN` | `write:workitem-as-user:custom` | `handleWorkitemAsUser`, `handleWorkitemUpsertAsUser` |

The `aud` claim in the JWT must exactly match the audience for the endpoint
being called. A token minted for plain endpoints cannot call as-user endpoints,
even if the caller somehow obtained both secrets — the `aud` mismatch rejects
it.

The security principle from ADR-0006 is preserved: **access to the endpoint
IS the permission**.

## JWT Claims

### Required claims

| Claim | Type | Description |
|-------|------|-------------|
| `exp` | NumericDate | Expiry — must be ≤ 15 minutes from `iat` |
| `iat` | NumericDate | Issued-at — used for clock skew detection and auditing |
| `iss` | string | Issuer — identifies the calling system (e.g. `"ci-system"`) |
| `aud` | string | Audience — must match the scope for the target endpoint |

### Signing algorithm

**HS256** (HMAC-SHA256). Symmetric — the same secret used to sign is used to
verify. No public/private key pair required.

### Expiry window

Callers set `exp = iat + 900` (15 minutes). The app enforces this with a
**30-second clock skew leeway** to absorb realistic clock drift between
distributed systems.

The leeway is a named constant in `auth.ts`:

```typescript
const CLOCK_SKEW_LEEWAY_SECONDS = 30;
```

### `iss` claim handling

The `iss` claim is **required** (the JWT is rejected if absent) but is not
validated against an allowlist. Its value is logged on every successful auth:

```
webtrigger auth success: iss=<value>
```

This provides an audit trail for multi-caller deployments. An allowlist
(`WEBTRIGGER_ALLOWED_ISSUERS`) would add stronger isolation between callers
but is deferred as a future hardening step — see the README.

## Secret Storage

Shared secrets are stored as **Forge environment variables** set via
`forge variables set`:

```sh
forge variables set --environment production WEBTRIGGER_TOKEN <value>
forge variables set --environment production WEBTRIGGER_AS_USER_TOKEN <value>
```

Accessed at runtime via `process.env.WEBTRIGGER_TOKEN` and
`process.env.WEBTRIGGER_AS_USER_TOKEN`.

Forge environment variables are encrypted at rest, not visible after setting,
and are the idiomatic Forge primitive for secrets.

## Handler Behaviour

### Auth check position

Auth is checked **first**, before any other processing — before body parsing,
before logging the request body, before any Jira API calls. An unauthenticated
request is rejected with minimal processing and no side effects.

### On missing env var (misconfiguration)

If the expected environment variable is not set, the handler returns **500
Internal Server Error** with a `ProblemDetails` body. A missing secret is an
operator error, not a caller error.

Log line (warn): `"webtrigger auth: WEBTRIGGER_TOKEN environment variable is not configured"`

### On missing or malformed Authorization header

If the `Authorization` header is absent or not in the form `Bearer <token>`,
return **401 Unauthorized** with:
- `ProblemDetails` response body (consistent with all other error responses)
- `WWW-Authenticate: Bearer` response header (RFC 6750)

Log line (warn): `"webtrigger auth failed: missing or malformed Authorization header"`

### On invalid JWT (bad signature, wrong aud, expired, missing claims)

If the JWT cannot be verified — for any reason — return **401 Unauthorized**
(same shape as above). The error detail does not reveal the reason (no
information leakage to attackers).

Log line (warn): `"webtrigger auth failed: <jose error message>"` (internal only)

### On successful auth

Log line (info): `"webtrigger auth success: iss=<iss value>"`

## Implementation

### Library

**`jose`** — already in the monorepo via `forge-ahead`. Must be added as a
direct dependency of `apps/webtrigger` (`bun add jose`). Uses the Web Crypto
API internally; `jwtVerify` is async.

### New file: `apps/webtrigger/src/workitem/auth.ts`

A single `verifyBearerToken` function, local to the webtrigger app. Not placed
in `forge-ahead` — webtrigger JWT auth is app-specific (env var names, the
two-audience split) and there is no second consumer.

```typescript
import { jwtVerify, createSecretKey } from "jose";
import type { ApiRouteResponse } from "forge-ahead";

/** Clock skew leeway in seconds. Adjust if callers have unusual clock drift. */
const CLOCK_SKEW_LEEWAY_SECONDS = 30;

type WebtriggerTokenVar = "WEBTRIGGER_TOKEN" | "WEBTRIGGER_AS_USER_TOKEN";

/**
 * Verifies the JWT Bearer token in the Authorization header.
 *
 * Returns ok(undefined) on success.
 * Returns err(ApiRouteResponse) on failure — caller returns the response directly.
 *
 * 500 if the env var is not configured (operator error).
 * 401 if the token is missing, malformed, or invalid (caller error).
 */
export async function verifyBearerToken(
  headers: Headers | undefined,
  envVarName: WebtriggerTokenVar,
): Promise<{ ok: true } | { ok: false; response: ApiRouteResponse }>
```

### `aud` claim per endpoint

| Env var                    | `aud` value passed to `jwtVerify` |
|----------------------------|-----------------------------------|
| `WEBTRIGGER_TOKEN`         | `"write:workitem:custom"`         |
| `WEBTRIGGER_AS_USER_TOKEN` | `"write:workitem-as-user:custom"` |

The mapping from env var → expected audience is expressed as a constant map
inside `auth.ts`, not as a runtime argument, so callers cannot accidentally
pass the wrong audience.

### Handler call sites

```typescript
export async function handleWorkitem(
  req: ApiRouteRequest,
): Promise<ApiRouteResponse> {
  const auth = await verifyBearerToken(req.headers, "WEBTRIGGER_TOKEN");
  if (!auth.ok) return auth.response;

  logApiRouteRequest(req, "workitem");
  // ... rest of handler unchanged
}
```

### Handler → token/audience mapping

| Handler                      | `envVarName`                | `aud`                           |
|------------------------------|-----------------------------|---------------------------------|
| `handleWorkitem`             | `"WEBTRIGGER_TOKEN"`        | `"write:workitem:custom"`       |
| `handleWorkitemUpsert`       | `"WEBTRIGGER_TOKEN"`        | `"write:workitem:custom"`       |
| `handleWorkitemAsUser`       | `"WEBTRIGGER_AS_USER_TOKEN"` | `"write:workitem-as-user:custom"` |
| `handleWorkitemUpsertAsUser` | `"WEBTRIGGER_AS_USER_TOKEN"` | `"write:workitem-as-user:custom"` |

## Caller: How to Mint a JWT

Callers generate a JWT using the shared secret before each request (or cache
for up to 15 minutes). Example using `jose` in Node.js:

```typescript
import { SignJWT, createSecretKey } from "jose";

const secret = createSecretKey(process.env.WEBTRIGGER_TOKEN!, "utf-8");
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("15m")
  .setIssuer("my-ci-system")
  .setAudience("write:workitem:custom")
  .sign(secret);

// Use: Authorization: Bearer <token>
```

## Known Limitations and Future Hardening

### No `jti` (replay prevention within the window)

JWTs with the same `exp` can be replayed within the 15-minute window. A `jti`
nonce with a server-side seen-cache would eliminate this, but requires
server-side state (KVS). The 15-minute expiry is the primary replay defence.

### No `iss` allowlist

The `iss` claim is required and logged but not validated against a known list
of permitted issuers. A `WEBTRIGGER_ALLOWED_ISSUERS` env var would add
stronger isolation in multi-caller deployments (a compromised caller cannot
impersonate another). Deferred for now.

## No Manifest Changes Required

Webtrigger modules do not declare scopes in `manifest.yml`. The auth is
enforced entirely in handler code. No manifest changes are needed.

## Response Examples

### 500 — env var not configured

```json
{
  "type": "https://httpstatuses.io/500",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "WEBTRIGGER_TOKEN environment variable is not configured.",
  "timestamp": "2026-05-18T09:00:00.000Z"
}
```

### 401 — missing, malformed, or invalid JWT

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer

{
  "type": "https://httpstatuses.io/401",
  "title": "Unauthorized",
  "status": 401,
  "detail": "A valid Bearer token is required.",
  "timestamp": "2026-05-18T09:00:00.000Z"
}
```

## Decisions Made (and Why)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth scheme | JWT Bearer (HS256) | Signed + expiring tokens; no raw secret on the wire |
| JWT issuer | Caller-generated | No extra infrastructure; caller holds the secret |
| Algorithm | HS256 | Symmetric; no key pair management; `jose` supports natively |
| `exp` window | 15 minutes | Short enough to limit replay; generous enough for clock drift |
| Clock leeway | 30 seconds | Absorbs realistic drift; named constant for easy adjustment |
| `aud` claim | Custom scope names | Self-describing; reuses ADR-0006 scope boundary |
| `iss` claim | Required, logged only | Audit trail without allowlist complexity |
| `jti` | Not implemented | Requires stateful cache; noted as future hardening |
| Secret storage | Forge env vars | Encrypted at rest; idiomatic Forge secret primitive |
| Missing env var | 500 | Operator error; must surface loudly |
| Bad JWT | 401 + WWW-Authenticate | RFC 6750 compliant; no reason leakage |
| Error shape | ProblemDetails | Consistent with all other error responses in the app |
| Auth position | Before all other processing | No side effects from unauthenticated requests |
| Library | `jose` | Already in monorepo; async Web Crypto; native claim validation |
| Code location | `apps/webtrigger/src/workitem/auth.ts` | App-specific; no general solution encouraged |
