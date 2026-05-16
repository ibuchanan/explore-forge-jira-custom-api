# ADR-0007: Move Generated Jira OpenAPI Types into forge-ahead

**Status:** Accepted  
**Date:** 2026-05-16

## Context

The Jira REST API types are generated from the official Jira OpenAPI specs using
`openapi-typescript` (configured via `redocly.yaml`). Currently these generated files
live in `apps/forge/src/jira-platform-2/types.ts` and `apps/forge/src/jira-platform-3/types.ts`.

The `forge-ahead` library has a new `jira/` module (`issue.ts`, `api.ts`, etc.) that
hand-curates types like `Schema`, `Meta`, and `FieldType` — types that are already
present (more completely and accurately) in the generated files.

Hand-curated types risk drifting from the actual Jira API as the API evolves. The
generated types are authoritative by construction.

## Decision

**Move `generate:openapi` and the generated Jira type files into `forge-ahead`.**

- `redocly.yaml` and the `generate:openapi` script move from `apps/forge` to
  `packages/forge-ahead`.
- Generated output targets `packages/forge-ahead/src/jira/` (e.g.
  `packages/forge-ahead/src/jira/platform-3/types.ts`).
- `forge-ahead`'s `jira/` module imports directly from the generated types rather
  than hand-curating equivalents.
- `apps/forge` drops its own generated type files and imports the types it needs
  from `forge-ahead`.

## Generated types are ephemeral

Generated type files are treated as build artifacts:
- They are regenerated on demand (`npm run generate:openapi` in `forge-ahead`).
- Each consumer (app or library) controls when it regenerates — there is no forced
  sync cadence.
- Generated files are committed to the repo so that builds don't require a network
  call to the Atlassian OpenAPI spec endpoints.

## Consequences

**Good:**
- Single source of truth for Jira API types — the generator, not hand-curation.
- `forge-ahead`'s `jira/` module can use `FieldCreateMetadata`, `PageOfCreateMetaIssueTypeWithField`,
  etc. directly without reimplementing them.
- `apps/forge` gets a simpler dependency story — import types from `forge-ahead/jira`
  rather than maintaining its own generated copy.
- Type drift between hand-curated and generated types is eliminated.

**Bad / trade-offs:**
- `forge-ahead` now has a `devDependency` on `openapi-typescript` and `@redocly/cli`.
- Regeneration requires network access to Atlassian's OpenAPI spec endpoints.
- If Atlassian changes a type in the spec, `forge-ahead` absorbs the change — which
  may require updates to the `jira/` module code.

## Alternatives considered

**Keep generated types in `apps/forge`, import into `forge-ahead`:** A library
depending on an app is an inverted dependency — rejected.

**New shared package (`packages/jira-types`):** Adds a third package to maintain for
what is essentially a code-generation concern. Rejected as over-engineering at this
stage.

**Hand-curate only what's needed:** Already doing this — it leads to drift and
incomplete types. Rejected in favour of the authoritative generated source.
