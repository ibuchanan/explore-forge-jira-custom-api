# Spec: Raise On Behalf Of (actAsUser)

## Summary

Issue creation (both insert and upsert) can optionally be performed as a specific
Jira user rather than as the Forge app identity. This capability is named
`raiseOnBehalfOf`, following the precedent set by the Jira Service Management REST API.

## Field Name

`raiseOnBehalfOf` — a Jira `accountId` string identifying the user on whose behalf
the issue should be created.

## Endpoint Design

`raiseOnBehalfOf` is a **security-sensitive capability** and is exposed via dedicated
endpoints, separate from the plain insert and upsert endpoints. This gives the Forge
manifest a clean, explicit boundary for scope declaration.

The four endpoints are:

| Endpoint | Description |
|---|---|
| `POST /insert` | Plain insert, Forge app identity |
| `POST /insert/as-user` | Insert, caller-specified `raiseOnBehalfOf` |
| `POST /upsert` | Upsert with dedup, Forge app identity |
| `POST /upsert/as-user` | Upsert with dedup, caller-specified `raiseOnBehalfOf` |

The `/as-user` endpoints carry an explicit Forge scope. **Access to the endpoint is
the permission** — if a caller can reach an `/as-user` endpoint, they are authorised
to raise on behalf of any valid Jira `accountId`. No per-user-ID role check is
performed at runtime.

Start with Option C (shared middleware, two function keys with branching). Fall back
to Option A (four distinct Forge function keys) if the middleware approach becomes
unwieldy.

## Authentication Strategy

A new auth selection function, `getAuthForRequest(event, body)`, will be added to the
`forge-ahead` library (in `packages/forge-ahead/src/forge/auth.ts`). It extends the
existing `getAuthForEvent` pattern with a new strategy:

| Condition | Strategy | Auth client |
|---|---|---|
| `raiseOnBehalfOf` present in request body | `asUserRaiseOnBehalfOf` | `asUser(raiseOnBehalfOf)` |
| `raiseOnBehalfOf` absent | `asApp` | `asApp()` |

The function checks for `raiseOnBehalfOf` first, then delegates to the existing
`getAuthForEvent` logic for all other cases.

## Required on As-User Endpoints

The `raiseOnBehalfOf` field is **required** on `/as-user` endpoints. If a caller
holds the `write:workitem-as-user:custom` scope but omits the field, the request is
rejected with a 400:

> "`raiseOnBehalfOf` is required on this endpoint. Provide a Jira accountId."

Callers who omit `raiseOnBehalfOf` should use the plain insert or upsert endpoints
instead. There is no fallback to `asApp()` on `/as-user` endpoints.

## Default User

When `raiseOnBehalfOf` is absent (i.e. on plain insert/upsert endpoints), the Forge
app identity (`asApp()`) is used. This is:

- Zero-configuration
- The standard Forge Cloud pattern
- A deliberate advantage over Jira Data Center, which lacked a clean app-identity model

No configured service account is needed. If a caller always wants to act as a specific
user, they should always supply `raiseOnBehalfOf`.

## Implementation Notes

- The `getAuthForRequest` function should be implemented in `forge-ahead` from the
  start, even though the exact signature will be informed by implementation experience.
- The new `AuthStrategy` type in `forge-ahead` will gain a `"asUserRaiseOnBehalfOf"`
  variant alongside the existing `"asUserAccount"`, `"asUserContext"`, and `"asApp"`.
- The `raiseOnBehalfOf` field is part of the request body envelope, not a Jira field —
  it must be extracted before field name/value translation and not passed through to
  the Jira issue creation payload.
