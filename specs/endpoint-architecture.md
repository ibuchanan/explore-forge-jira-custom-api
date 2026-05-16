# Spec: Endpoint Architecture (Cross-Cutting)

## Module Type

All endpoints in this API use the Forge **`apiRoute`** module — a Forge App REST API.
This is confirmed by the existing `manifest.yml` which already declares a `workitem-post`
route using `apiRoute`.

This means:
- Callers authenticate via **OAuth 2.0 (3LO)** as a Jira user (or service with
  user-delegated OAuth).
- Forge handles JWT verification and OAuth token validation automatically.
- No custom JWT verification or webtrigger secret handling is needed.
- Scopes are declared per-route in `manifest.yml` and enforced at the platform level.

## The Four Endpoints

| Route | Method | Scope | Description |
|---|---|---|---|
| `/workitem` | POST | `write:workitem:custom` | Plain insert, Forge app identity |
| `/workitem/as-user` | POST | `write:workitem-as-user:custom` | Insert with `raiseOnBehalfOf` |
| `/workitem/upsert` | POST | `write:workitem:custom` | Upsert with dedup, Forge app identity |
| `/workitem/upsert/as-user` | POST | `write:workitem-as-user:custom` | Upsert with dedup + `raiseOnBehalfOf` |

## Custom Scopes

| Scope | Endpoints | Meaning |
|---|---|---|
| `write:workitem:custom` | `/workitem`, `/workitem/upsert` | Create issues as the Forge app identity |
| `write:workitem-as-user:custom` | `/workitem/as-user`, `/workitem/upsert/as-user` | Create issues on behalf of a specified user |

The `/as-user` endpoints carry a **distinct custom scope**. An OAuth app must explicitly
request `write:workitem-as-user:custom` to use `raiseOnBehalfOf`. This is enforced at
the Forge platform level — no handler code is needed to gate access.

## Two Identities on As-User Endpoints

On the `/as-user` endpoints, two user identities are in play:

1. **The OAuth caller** — the Jira user (or service) that authenticated with OAuth and
   holds the `write:workitem-as-user:custom` scope. This identity is validated by Forge.
2. **The `raiseOnBehalfOf` target** — the Jira `accountId` supplied in the request body.
   The issue is created using `asUser(raiseOnBehalfOf)`, not as the OAuth caller.

Access to the endpoint (i.e. holding the scope) is the permission to use any valid
`accountId` as `raiseOnBehalfOf`. No per-user-ID role check is performed at runtime.

## Request Body Envelope Design Principles

`project` and `issueType` are **top-level fields**, not nested inside `fields`. They
are routing/context — they determine which `createMeta` to fetch and which coercion
rules apply to all other fields. Putting them top-level:
- Makes the context explicit and prevents accidental coercion through the field translation layer
- Signals to callers that these are not Jira content fields
- Keeps the API self-describing without mirroring Jira's internal structure

Note: In Jira's own `IssueUpdateBean`, `project` and `issuetype` live inside `fields`.
We deliberately diverge from this convention to honour ADR-0001 (callers send simple
key/value pairs; the API absorbs Jira complexity).

## Request Body Envelope

All four endpoints share the same base request body shape, with fields added depending
on the endpoint:

```json
{
  "project": "HSP",
  "issueType": "Bug",
  "fields": { "Summary": "...", "Priority": "High" },
  "update": { },
  "otel": { "traceId": "...", "spanId": "..." },
  "raiseOnBehalfOf": "accountId-xyz",
  "dedup": "project = HSP AND summary ~ \"...\""
}
```

| Field | Insert | Insert/as-user | Upsert | Upsert/as-user |
|---|---|---|---|---|
| `project` | ✅ required (top-level) | ✅ required (top-level) | ✅ required (top-level) | ✅ required (top-level) |
| `issueType` | ✅ required (top-level) | ✅ required (top-level) | ✅ required (top-level) | ✅ required (top-level) |
| `fields` | ✅ required | ✅ required | ✅ required | ✅ required |
| `update` | ❌ excluded (v1) | ❌ excluded (v1) | ❌ excluded (v1) | ❌ excluded (v1) |
| `otel` | optional | optional | optional | optional |
| `raiseOnBehalfOf` | ❌ not accepted | ✅ required | ❌ not accepted | ✅ required |
| `dedup` | ❌ not accepted | ❌ not accepted | ✅ required | ✅ required |

## Manifest Wiring (target state)

```yaml
modules:
  apiRoute:
    - key: workitem-insert
      path: /workitem
      operation: POST
      function: workitem-handler
      accept:
        - application/json
      scopes:
        - write:workitem:custom

    - key: workitem-insert-as-user
      path: /workitem/as-user
      operation: POST
      function: workitem-as-user-handler
      accept:
        - application/json
      scopes:
        - write:workitem-as-user:custom

    - key: workitem-upsert
      path: /workitem/upsert
      operation: POST
      function: workitem-upsert-handler
      accept:
        - application/json
      scopes:
        - write:workitem:custom

    - key: workitem-upsert-as-user
      path: /workitem/upsert/as-user
      operation: POST
      function: workitem-upsert-as-user-handler
      accept:
        - application/json
      scopes:
        - write:workitem-as-user:custom

  function:
    - key: workitem-handler
      handler: index.handleWorkitem
    - key: workitem-as-user-handler
      handler: index.handleWorkitemAsUser
    - key: workitem-upsert-handler
      handler: index.handleWorkitemUpsert
    - key: workitem-upsert-as-user-handler
      handler: index.handleWorkitemUpsertAsUser
```

> **Note:** Start with the Option C middleware approach (two function keys with shared
> handler logic). Move to four distinct function keys (as shown above) if the shared
> handler becomes unwieldy. The manifest target state above reflects the Option A
> fallback for clarity.

## Insert Response Shape

Plain insert endpoints (`POST /workitem`, `POST /workitem/as-user`) return a simple
flat response mirroring Jira's own create issue response:

```json
{ "id": "10042", "key": "HSP-42", "self": "https://your-domain.atlassian.net/rest/api/3/issue/10042" }
```

No `created`, `matches`, or `warnings` fields. The caller knows they're inserting —
the envelope doesn't need to state it.

> **Revisit after implementation:** If the inconsistency between insert and upsert
> response shapes proves awkward in practice (e.g. clients calling both endpoints),
> consider moving insert to the full upsert envelope (`created: true`, empty `matches`
> and `warnings`).

## Error Response Shape (All Endpoints)

All validation errors across all endpoints use `ValidationProblemDetails` — an RFC 9457
extension with an `errors` array. See `specs/bullet1-field-translation.md` for the
full shape definition and `reason` codes.

HTTP 400 errors from Jira (e.g. invalid JQL, invalid accountId) are forwarded wrapped
in a `ProblemDetails` response with the Jira error detail in the `detail` field.
