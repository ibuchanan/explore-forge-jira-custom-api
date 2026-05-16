# Spec: Field Name and Value Translation

## Summary

Callers submit issue creation requests using **simple, human-readable key/value pairs**.
The server is responsible for translating both field *names* and field *values* into the
exact shapes that the Jira REST API expects. No Jira internals leak to callers.

## Design Principle

> Callers send simple key/value pairs. The API absorbs all Jira field complexity.

Callers must never need to know Jira field IDs, `customfield_XXXXX` keys, option wrapper
objects, or any other Jira-internal representation. If a field type is too complex to
map transparently, the API rejects it with a clear error rather than asking the caller
to send Jira-shaped data themselves.

## Field Name Translation

### Mechanism

Field names are resolved using the Jira `createMeta` endpoint:

```
GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}
```

This returns the full field metadata for a given project + issue type combination,
including `fieldId`, `name`, `clauseNames`, `schema`, and `allowedValues`.

### Scope

- `createMeta` only. The `editMeta` endpoint is out of scope for issue creation.
- Both the `fields` map and the `update` map in the request body are translated.

### Pagination

The `createMeta` endpoint returns a paginated `PageOfCreateMetaIssueTypeWithField`.
On Jira Cloud, `maxResults` is capped server-side — callers cannot increase it beyond
the platform default. Therefore, all pages must be fetched in a loop until `isLast: true`
before field name resolution begins. Do not assume all fields are returned in the first page.

### Resolution rules

A field name is matched (case-insensitively) against:
1. The field's display `name`
2. Each of the field's `clauseNames`
3. The raw `fieldId` (pass-through for callers who already know the ID)

### Error behaviour

Field name resolution and value coercion run as **two sequential phases**. Each phase
collects all errors before returning — callers see all problems in one response per phase.

**Phase 1 — field name resolution:** All field names are resolved before any coercion
begins. If any name errors exist, a 400 is returned immediately. Error reasons:
- `not_found` — no field in the project/issue type matches the name
- `ambiguous` — multiple distinct fields share the same normalised name

**Phase 2 — value coercion:** Only runs if Phase 1 succeeds. All field values are
coerced and validated. All coercion errors are collected and returned together in a
single 400 if any exist.

This two-phase approach means callers fix one class of error at a time: first naming
problems, then value problems.

## Field Value Translation (Coercion)

### Mechanism

After field name resolution, each field value is passed through a **type coercion
registry** — a map from field schema type / custom field key to a coercion function.

The schema metadata returned by `createMeta` provides:
- `schema.type` — e.g. `"option"`, `"user"`, `"array"`, `"string"`, `"number"`
- `schema.items` — element type for array fields
- `schema.custom` — custom field plugin key (e.g. `"com.atlassian.jira.plugin.system.customfieldtypes:select"`)
- `allowedValues` — valid options for select-style fields

### Validation

For fields that have `allowedValues`, the coerced value is validated against that list
before the Jira API is called. A mismatch produces a 400 error naming the field and
listing the allowed values.

### Supported field types (initial scope)

| Caller sends | Field type | Jira expects |
|---|---|---|
| `"High"` | `priority` | `{ "name": "High" }` |
| `"High"` | `option` (select) | `{ "value": "High" }` |
| `["bug", "ui"]` | `array` of `option` (multi-select, checkboxes) | `[{ "value": "bug" }, { "value": "ui" }]` |
| `"accountId-xyz"` | `user` (single user picker) | `{ "accountId": "accountId-xyz" }` |
| `["accountId-a", "accountId-b"]` | `array` of `user` (multi user picker) | `[{ "accountId": "accountId-a" }, ...]` |
| `"v1.2"` | `version` (fix version, affects version) | `{ "name": "v1.2" }` |
| `["v1.2", "v1.3"]` | `array` of `version` | `[{ "name": "v1.2" }, ...]` |
| `"Frontend"` | `component` | `{ "name": "Frontend" }` |
| `["Frontend", "Backend"]` | `array` of `component` | `[{ "name": "Frontend" }, ...]` |
| `"Sprint Name"` | sprint (custom) | sprint ID lookup by name |
| `"2026-05-16"` | `date` | `"2026-05-16"` (ISO 8601 validation) |
| `"2026-05-16T09:00:00.000Z"` | `datetime` | `"2026-05-16T09:00:00.000Z"` (ISO 8601 validation) |
| `5` | `number` | `5` |
| `"some text"` | `string` | `"some text"` |

### Excluded field types (initial scope)

- **Cascading select** — excluded due to complexity. Returns 400 if encountered.

### Unknown field types

If a field's schema type/custom key has no registered coercion handler, the request is
rejected with a 400 error:

> "Field 'X' uses type 'Y' which is not supported by this API."

Callers must not send Jira-shaped workaround data for unsupported types.

## Error Response Shape

All validation errors use `ValidationProblemDetails` — an extension of the existing
RFC 9457 `ProblemDetails` interface (from `forge-ahead/errors`) with an additional
`errors` array member:

```json
{
  "type": "https://httpstatuses.io/400",
  "title": "Bad Request",
  "status": 400,
  "detail": "Field name resolution failed for 2 fields.",
  "timestamp": "2026-05-16T12:00:00.000Z",
  "errors": [
    { "field": "Urgancy", "reason": "not_found", "message": "No field named 'Urgancy' for project HSP / Bug." },
    { "field": "Priorty", "reason": "not_found", "message": "No field named 'Priorty' for project HSP / Bug." }
  ]
}
```

- `field` uses the caller's original field name (not the resolved Jira field ID).
- `reason` is a machine-readable code: `not_found`, `ambiguous`, `invalid_value`, `unsupported_type`, `required`.
- `detail` summarises the overall failure; `errors` gives per-field detail.
- `ValidationProblemDetails` lives in `packages/forge-ahead/src/util/errors.ts` alongside `ProblemDetails`.
- All validation errors across all endpoints (field translation, OTel, `dedup`, `raiseOnBehalfOf`) use this same shape for consistency.

## Scope

The `fields` map is translated. The `update` map is **excluded from initial scope** —
its operation semantics (`add`/`set`/`remove`) are significantly more complex and
there is no concrete creation-time use case that can't be served by `fields` alone.

## Implementation Notes

- The coercion registry will be informed by existing implementation code (to be
  contributed by the team).
- The `createMeta` response is fetched **fresh per request** — no caching. This means
  one paginated `createMeta` fetch per issue creation call. For a busy integration
  this is expensive; a future ADR should evaluate caching when performance data is
  available. For this sample codebase, simplicity takes priority over optimisation.
- The `accountId` supplied in `raiseOnBehalfOf` is **not validated upfront** — if the
  accountId is invalid, Jira will return a 400 which is forwarded to the caller.
- The `createMeta` fetch uses the **same identity as the creation call** — `asUser(raiseOnBehalfOf)`
  if set, otherwise `asApp()`. This follows Forge's principle of minimum necessary privilege
  and ensures field metadata reflects what the acting user can actually access.
- The coercion layer sits between field name resolution and the Jira create-issue call.
- New type: `ValidationProblemDetails` extends `ProblemDetails` with `errors?: ValidationError[]`.
