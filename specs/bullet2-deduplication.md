# Spec: Deduplication (Upsert Endpoint)

## Summary

Deduplication is exposed as a **distinct upsert endpoint**, separate from the plain
insert endpoint. Callers who want dedup behaviour use the upsert endpoint and supply
a JQL query that defines what counts as a duplicate.

## Upsert Semantics

The upsert endpoint behaves like a database upsert:

- If the JQL finds existing matching issues → skip creation, return the matches.
- If the JQL finds no matches → create the issue, return the new issue.

The response always has the same shape regardless of outcome.

## Response Shape

```json
{
  "created": true | false,
  "id": "10042",
  "key": "HSP-42",
  "self": "https://...",
  "matches": ["HSP-40", "HSP-38"],
  "warnings": ["..."]
}
```

| Field | Present when | Meaning |
|---|---|---|
| `created` | always | `true` = new issue created; `false` = duplicate(s) found |
| `id`, `key`, `self` | `created: true` | Details of the newly created issue |
| `matches` | `created: false` | Up to 10 issue keys returned by the dedup JQL |
| `warnings` | always (may be empty) | Advisory messages — not errors, but worth attention |

## Dedup JQL

### Execution

The caller supplies a JQL string in the request body. It is executed against the Jira
search API before the issue is created:

- If the query returns **0 results** → proceed with creation.
- If the query returns **1–10 results** → skip creation, return `created: false` with
  `matches` populated.
- Results are capped at **10**. If Jira returns more, we return the first 10.

### Validation

We do not attempt to parse or validate the JQL ourselves. If Jira rejects the JQL as
invalid, we return a 400 with the error forwarded from Jira.

The `dedup` field is **required** on upsert endpoints. An empty or whitespace-only
string is rejected with a 400:

> "`dedup` must be a non-empty JQL string. Use the insert endpoint if deduplication
> is not needed."

This prevents callers from accidentally calling the upsert endpoint with no effective
dedup check.

### Project-scope warning (Option C)

After the pre-creation search, if any returned issue keys belong to a **different
project** than the target insert project, a warning is added:

> "Dedup query returned matches from other projects (e.g. OTHER-123) — verify your
> JQL is scoped correctly."

Creation is still skipped (the matches are treated as duplicates), but the caller is
alerted that their JQL may be broader than intended.

## Post-Creation Verification

### Decision: dropped

The original spec called for a second JQL execution after creation to verify the new
issue would be matched by the dedup query.

**This is dropped for Jira Cloud.** Jira Cloud uses eventual consistency for its search
index — a newly created issue may not appear in JQL search results for several seconds
after creation. A post-creation JQL check would produce false negatives even when the
JQL is correct, making it an unreliable signal.

**Documented constraint:** Callers are responsible for writing JQL that will match the
issues they create. The pre-creation check is the authoritative dedup gate. Post-creation
JQL verification is not reliable on Jira Cloud and is not performed.

## Warnings Channel

The `warnings` array in the response is a general-purpose advisory channel. Current
uses:

1. **Cross-project dedup match** — matches returned from a project other than the
   target insert project.

Additional advisory conditions from other parts of the API (e.g. field coercion
fallbacks) may also surface here in future.

## HTTP Status

- `200 OK` — always, for both created and deduplicated outcomes.
- `400 Bad Request` — invalid request body, invalid JQL (forwarded from Jira), or
  field translation errors.
