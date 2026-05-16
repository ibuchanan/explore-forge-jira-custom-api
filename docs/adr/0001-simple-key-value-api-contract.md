# ADR-0001: Callers Send Simple Key/Value Pairs — API Absorbs All Jira Complexity

**Status:** Accepted  
**Date:** 2026-05-16

## Context

Jira's REST API is notoriously complex. Field identifiers are opaque (`customfield_10016`
instead of `"Story Points"`). Field values must be shaped precisely per field type —
a priority must be `{ "name": "High" }`, a select option must be `{ "value": "High" }`,
a user must be `{ "accountId": "..." }`. These shapes differ by field type and
sometimes by plugin. Cascading selects, version fields, component fields, sprint fields,
and user pickers all have different shapes and validation rules.

This API's intended callers are integration developers who should not need to understand
Jira's internal field model to create issues.

## Decision

**Callers send simple, human-readable key/value pairs. The API is responsible for all
translation, coercion, and validation.**

Specifically:
- Field *names* are human-readable strings (e.g. `"Story Points"`, `"Priority"`), not
  Jira field IDs (e.g. `"customfield_10016"`, `"priority"`).
- Field *values* are simple primitives or arrays (e.g. `"High"`, `["bug", "ui"]`), not
  Jira-shaped objects (e.g. `{ "name": "High" }`, `[{ "value": "bug" }]`).
- If a field type is too complex to map transparently (e.g. cascading select), the API
  rejects the request with a clear error rather than asking the caller to supply
  Jira-shaped data.
- Callers must never need to know Jira field IDs, custom field keys, option wrapper
  objects, or any other Jira-internal representation.

## Consequences

**Good:**
- Integration developers have a dramatically simpler API surface.
- Jira field shape changes (e.g. a plugin update changing how a field is stored) are
  absorbed by the API without requiring caller changes.
- Field validation errors are returned in the API's own language, not Jira's.
- The coercion registry is the single place where Jira field complexity lives.

**Bad / trade-offs:**
- The API must maintain a coercion registry and keep it current as Jira evolves.
- Unsupported field types result in hard rejections — callers cannot work around them
  by supplying pre-shaped values.
- Initial implementation scope is limited (e.g. cascading select excluded).

## Alternatives considered

**Pass-through with optional coercion:** Allow callers to supply either simple values
or Jira-shaped objects. The API coerces simple values and passes Jira-shaped objects
through as-is. Rejected because it undermines the contract — callers would need to
know when to use which form, and the API loses its ability to validate all inputs.
