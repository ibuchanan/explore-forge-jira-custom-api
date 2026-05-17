# Spec: Webtrigger Bearer Token Authentication

## Summary

The webtrigger app exposes four endpoints that are not authenticated by the
Forge platform (by design — see Forge docs). This spec defines the app-level
Bearer token authentication scheme that guards all four handlers.

## Background

Forge webtrigger URLs are intentionally unauthenticated at the platform level
to maximise compatibility with external callers. The Forge docs recommend
implementing authentication logic directly inside the handler, matching the
scheme used by the calling service.

The `apiRoute` app gains authentication for free via OAuth 2.0 (3LO) enforced
by Forge. The webtrigger app must implement its own equivalent gate.

## Auth Scheme

**HTTP Bearer tokens** (RFC 6750). Callers include a token in the standard
`Authorization` header:

```
Authorization: Bearer <token>
```

This scheme is consistent with how callers already think about the `apiRoute`
app (OAuth Bearer tokens), even though the mechanism here is a shared secret
rather than an OAuth access token.

## Two Tokens, Mirroring the Scope Split

Two distinct tokens mirror the existing scope boundary from ADR-0006:

| Token env var | Guards | Parallel apiRoute scope |
|---|---|---|
| `WEBTRIGGER_TOKEN` | `handleWorkitem`, `handleWorkitemUpsert` | `write:workitem:custom` |
| `WEBTRIGGER_AS_USER_TOKEN` | `handleWorkitemAsUser`, `handleWorkitemUpsertAsUser` | `write:workitem-as-user:custom` |

A caller that holds only `WEBTRIGGER_TOKEN` cannot call the `/as-user`
handlers. A caller that needs both capabilities is issued both tokens. The
security principle from ADR-0006 is preserved: **access to the endpoint IS
the permission**.

## Secret Storage

Tokens are stored as **Forge environment variables** set via `forge variables set`:

```sh
forge variables set --environment production WEBTRIGGER_TOKEN <value>
forge variables set --environment production WEBTRIGGER_AS_USER_TOKEN <value>
```

Accessed at runtime via `process.env.WEBTRIGGER_TOKEN` and
`process.env.WEBTRIGGER_AS_USER_TOKEN`.

Forge environment variables are encrypted at rest, not visible after setting,
and are the idiomatic Forge primitive for secrets. KVS is not used — it is
the wrong primitive for secrets (visible in UI, logged in network traffic).

## Handler Behaviour

### Auth check position

Auth is checked **first**, before any other processing — before body parsing,
before logging the request body, before any Jira API calls. An unauthenticated
request is rejected with minimal processing and no side effects.

### On missing env var (misconfiguration)

If the expected environment variable is not set, the handler returns **500
Internal Server Error** with a `ProblemDetails` body. A missing secret is an
operator error, not a caller error. A 500 surfaces the misconfiguration loudly
in logs and monitoring.

Log line (warn): `"WEBTRIGGER_TOKEN environment variable is not configured"`

### On missing or malformed Authorization header

If the `Authorization` header is absent, or present but not in the form
`Bearer <token>`, return **401 Unauthorized** with:
- `ProblemDetails` response body (consistent with all other error responses)
- `WWW-Authenticate: Bearer` response header (RFC 6750)

Log line (warn): `"webtrigger auth failed: missing or malformed Authorization header"`

### On invalid token

If the header is present and well-formed but the token does not match the
stored secret, return **401 Unauthorized** (same shape as above).

Log line (warn): `"webtrigger auth failed: invalid token"`

### Token comparison

Tokens are compared using **`crypto.timingSafeEqual`** (Node built-in
`node:crypto`). Buffer lengths are compared first; if they differ, reject
immediately (length leakage does not help an attacker). This eliminates
timing oracle attacks.

## Implementation

### New file: `apps/webtrigger/src/workitem/auth.ts`

A single `verifyBearerToken` function, local to the webtrigger app. Not placed
in `forge-ahead` — webtrigger bearer auth is app-specific (env var names, the
two-token split) and there is no second consumer. If a future app needs the
same pattern it should copy and adapt, not import.

```typescript
import type { Headers } from "forge-ahead";
import type { Result } from "forge-ahead";
import type { WebTriggerResponse } from "forge-ahead";

type WebtriggerTokenVar = "WEBTRIGGER_TOKEN" | "WEBTRIGGER_AS_USER_TOKEN";

/**
 * Verifies the Bearer token in the Authorization header against the
 * expected secret stored in the given environment variable.
 *
 * Returns ok(undefined) on success.
 * Returns err(WebTriggerResponse) on failure — caller returns the response directly.
 *
 * Responds with 500 if the env var is not configured (operator error).
 * Responds with 401 if the token is missing, malformed, or invalid (caller error).
 */
export function verifyBearerToken(
  headers: Headers,
  envVarName: WebtriggerTokenVar,
): Result<void, WebTriggerResponse>
```

The env var name is a **union literal type** so typos are caught at compile
time rather than becoming a runtime 500.

### Usage in each handler

```typescript
export async function handleWorkitem(
  req: WebtriggerEvent,
): Promise<WebTriggerResponse> {
  const auth = verifyBearerToken(req.headers, "WEBTRIGGER_TOKEN");
  if (auth.isErr()) return auth.error;

  logWebtriggerRequest(req, "workitem");
  // ... rest of handler unchanged
}
```

The pattern mirrors the existing `Result`-based early-return style used
throughout the app (`parseBody`, `runPipeline`).

### Handler → token mapping

| Handler | `envVarName` |
|---|---|
| `handleWorkitem` | `"WEBTRIGGER_TOKEN"` |
| `handleWorkitemUpsert` | `"WEBTRIGGER_TOKEN"` |
| `handleWorkitemAsUser` | `"WEBTRIGGER_AS_USER_TOKEN"` |
| `handleWorkitemUpsertAsUser` | `"WEBTRIGGER_AS_USER_TOKEN"` |

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

### 401 — missing or invalid token

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
|---|---|---|
| Auth scheme | Bearer token | Consistent with apiRoute caller mental model; widely supported |
| Two tokens | Yes | Mirrors ADR-0006 scope split; preserves "access = permission" principle |
| Secret storage | Forge env vars | Encrypted at rest; idiomatic Forge secret primitive; not visible in UI |
| Missing env var | 500 | Operator error; must surface loudly |
| Missing/bad header | 401 + WWW-Authenticate | RFC 6750 compliant |
| Token comparison | `timingSafeEqual` | Eliminates timing oracle; standard practice |
| Error shape | `ProblemDetails` | Consistent with all other error responses in the app |
| Auth position | Before all other processing | No side effects from unauthenticated requests |
| Code location | `apps/webtrigger/src/workitem/auth.ts` | App-specific; no general solution encouraged |
