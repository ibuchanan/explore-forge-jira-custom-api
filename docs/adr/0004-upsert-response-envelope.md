# ADR-0004: Upsert Response Envelope Shape

**Status:** Accepted  
**Date:** 2026-05-16

## Context

The upsert endpoint can have two outcomes:
1. A new issue was created (no duplicates found).
2. Creation was skipped (duplicates found — the dedup JQL returned matches).

Additionally, the dedup JQL may produce advisory conditions worth surfacing to the
caller (e.g. matches came from a different project than the target).

The response shape must communicate the outcome unambiguously, support both cases
with the same structure, and provide a channel for advisory information.

Three shapes were considered:

**Option A — divergent shapes by status code:**
- `201 Created` + `{ id, key, self }` when a new issue is created
- `200 OK` + `{ matches: [...] }` when duplicates are found
Callers branch on HTTP status code.

**Option B — unified envelope with `created` flag:**
- Always `200 OK`
- `{ created: true, id, key, self, matches: [], warnings: [] }` on creation
- `{ created: false, matches: [...], warnings: [] }` on dedup hit
`id`/`key`/`self` only present when `created: true`; `matches` only populated when `created: false`.

**Option C — fully consistent envelope (all fields always present):**
- Always `200 OK`
- `{ created: true/false, id, key, self, matches: [...], warnings: [] }`
- `matches` is always present (empty on creation, populated on dedup hit)
- This naturally expresses the post-creation verification case where `matches` would
  be empty even after creation (indicating the JQL wouldn't catch the new issue)

## Decision

**Use Option C — a fully consistent envelope with all fields always present.**

The key insight that drove this decision: Option C naturally expresses edge cases that
Option B cannot. Specifically, the post-creation verification result (whether the
dedup JQL matches the newly created issue) can be expressed as the content of
`matches` after creation — empty means the JQL wouldn't catch this issue in future.

Even though post-creation JQL verification was ultimately dropped (see ADR-0003), the
consistent envelope remains the right shape because:
- Callers always parse the same structure — no conditional field handling.
- The `warnings` array provides a general-purpose advisory channel that will grow.
- `created: true/false` is the idiomatic upsert response pattern (database upsert
  semantics).

## Response shape

```json
{
  "created": true,
  "id": "10042",
  "key": "HSP-42",
  "self": "https://your-domain.atlassian.net/rest/api/3/issue/10042",
  "matches": [],
  "warnings": []
}
```

```json
{
  "created": false,
  "id": null,
  "key": null,
  "self": null,
  "matches": ["HSP-40", "HSP-38"],
  "warnings": ["Dedup query returned matches from other projects (e.g. OTHER-5) — verify your JQL is scoped correctly."]
}
```

## Consequences

**Good:**
- Consistent shape — callers always get the same fields.
- `created` boolean is idiomatic for upsert semantics.
- `warnings` is a general-purpose advisory channel for future use.
- `matches` is always present and meaningful.

**Bad / trade-offs:**
- `id`/`key`/`self` are null when `created: false` — callers must handle nulls.
- A `201` status code for new creation would be more RESTfully correct, but was
  sacrificed for response shape consistency.

## Alternatives considered

**Option A (divergent shapes):** Rejected. Callers must branch on status code and
handle two different response schemas. More complex client code for marginal REST
purity gain.

**Option B (unified with absent fields):** Rejected. Optional fields create parsing
ambiguity and don't naturally express the post-creation verification case that
motivated the design.
