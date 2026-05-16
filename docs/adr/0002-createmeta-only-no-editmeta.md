# ADR-0002: Use createMeta Only — editMeta Out of Scope

**Status:** Accepted  
**Date:** 2026-05-16

## Context

Jira exposes two metadata endpoints relevant to field name and value resolution:

- `createMeta` (`GET /rest/api/3/issue/createmeta/{project}/issuetypes/{issueTypeId}`)
  — returns field metadata for fields that can be set at issue *creation* time.
- `editMeta` (`GET /rest/api/3/issue/{issueKey}/editmeta`)
  — returns field metadata for fields that can be set when *editing* an existing issue.

Some fields only appear post-creation (e.g. resolution, certain status-dependent
fields). These are accessible via the Jira `update` map at creation time in some
configurations, which could require `editMeta` to resolve.

## Decision

**Use `createMeta` only. `editMeta` is out of scope for issue creation.**

The `update` map in the request body is translated using the same `createMeta`
metadata as the `fields` map. If a field only appears in `editMeta` and not
`createMeta`, it will fail field name resolution with a clear `not_found` error.

## Consequences

**Good:**
- A single metadata fetch (`createMeta`) covers all field resolution needs for the
  creation use case.
- No need to have an existing issue key to call `editMeta` at creation time.
- Simpler implementation — one metadata source, one resolution path.

**Bad / trade-offs:**
- Fields that only appear in `editMeta` cannot be set through this API at creation
  time, even if Jira technically allows it via the `update` map.
- If this limitation becomes a real caller need, a future ADR should evaluate whether
  to add a supplementary `editMeta` fetch.

## Alternatives considered

**Fetch both createMeta and editMeta:** Merge the two field sets and resolve against
the union. Rejected because `editMeta` requires an existing issue key (which doesn't
exist at creation time), and the additional complexity isn't justified by a known
caller need.
