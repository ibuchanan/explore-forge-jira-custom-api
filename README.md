# Forge Jira Custom API — Work Item Service

A Forge app that exposes a clean REST API for creating Jira issues without exposing
Jira's internal field model to callers. Callers send simple human-readable key/value
pairs; the app translates field names, coerces values, handles deduplication, and
propagates OpenTelemetry trace context — all transparently.

## What this is?

A monorepo containing two packages:

| Package | Description |
| --- | --- |
| `apps/forge` | The Forge app — four `apiRoute` endpoints for issue creation |
| `packages/forge-ahead` | Shared library of Forge utilities (auth, HTTP, config, Jira types) |

## The four endpoints

| Route | Scope | Description |
| --- | --- | --- |
| `POST /workitem` | `write:workitem:custom` | Insert an issue as the Forge app identity |
| `POST /workitem/asuser` | `write:workitem-as-user:custom` | Insert on behalf of a Jira user |
| `POST /workitem/upsert` | `write:workitem:custom` | Insert or return existing (dedup via JQL) |
| `POST /workitem/upsert/asuser` | `write:workitem-as-user:custom` | Upsert on behalf of a user |

All endpoints accept `application/json` and are secured with OAuth 2.0 (3LO) via
Forge's `apiRoute` module. Custom scopes are enforced at the platform level — no
handler code needed to gate access.

## Request body

```json
{
  "project": "HSP",
  "issueType": "Bug",
  "fields": {
    "Summary": "Login fails on Safari",
    "Priority": "High",
    "Story Points": 3
  },
  "otel": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7"
  }
}
```

Field names are human-readable display names (or clause names, or raw field IDs).
The app resolves them via `createMeta` and coerces values to the exact shape Jira
expects — callers never supply `customfield_10016` or `{ "name": "High" }`.

For upsert endpoints, add `"dedup": "<JQL>"`.
For `/asuser` endpoints, add `"raiseOnBehalfOf": "<accountId>"` (required).

## Key behaviours

- **Field name resolution** — case-insensitive match against display name, clause
  names, or raw field ID. Two-phase validation: all name errors collected first,
  then all coercion errors.
- **Value coercion** — priorities, options, users, versions, components, sprints,
  dates, numbers, and strings all translated automatically. Unsupported types (e.g.
  cascading select) are rejected with a clear error.
- **Deduplication** — caller supplies a JQL string; if it returns matches, creation
  is skipped and up to 10 matching keys are returned. Post-creation JQL verification
  is intentionally absent (Jira Cloud eventual consistency makes it unreliable —
  see ADR-0003).
- **OTel propagation** — optional `otel` field is stored as a Jira issue entity
  property (`PUT .../properties/otel`) and indexed for JQL via `otelTraceId` /
  `otelSpanId` aliases declared in `manifest.yml`.
- **Default identity** — without `raiseOnBehalfOf`, issues are created as the Forge
  app (`asApp()`). No service account needed.

## Prerequisites

- [Node.js 24](https://nodejs.org/)
- [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/)
  (`npm i -g @forge/cli`)
- An Atlassian site with Jira

## Setup

```bash
npm install
cp apps/forge/.env.example apps/forge/.env
# Edit .env: set SITENAME and PRODUCT
```

## Common workflows

```bash
# Build everything
npm run build

# Run all tests
npm run test

# Lint, format-check, and typecheck
npm run check

# Regenerate Jira OpenAPI types (requires network access)
npm run generate

# Deploy the Forge app (development environment)
npm run forge:deploy

# Install on your Atlassian site (first time)
npm run forge:install

# Register custom OAuth scopes (first time, or after scope changes)
npm run forge:scopes
```

## Testing

Unit tests use [Vitest](https://vitest.dev/):

```bash
npm run test           # all packages
npm run test:coverage  # with coverage
```

Integration tests use [Hurl](https://hurl.dev/):

```bash
# From the monorepo root — requires a deployed app and integration/.env.hurl
npm run test:api
```

Copy `integration/.env.hurl.example` to `integration/.env.hurl` and fill in
your app REST API base URL, OAuth client credentials, and OAuth refresh token
before running integration tests. The Hurl suite exchanges the refresh token for
a fresh bearer token at the start of each run.

## Project layout

```text
apps/forge/
  src/workitem/     # Handlers, pipeline, field resolver, coercer, Jira client
  src/frontend/     # Jira admin page (displays app base URLs and account IDs)
  manifest.yml      # Forge module declarations and custom scopes

integration/        # Hurl integration tests and local env example

packages/forge-ahead/
  src/forge/        # Auth helpers, logging, manifest utilities, triggers
  src/jira/         # Generated OpenAPI types (platform-2/3, servicedesk, software)
  src/config/       # Forge KVS-backed config store
  src/api/          # apiRoute primitives
  src/util/         # ProblemDetails, ValidationProblemDetails, HTTP helpers
  src/rovo/         # Rovo action and agent connector support
```

## Production considerations

- For the `/asuser` endpoints, the `write:workitem-as-user:custom` scope is the
  security boundary. A caller with that scope may provide `raiseOnBehalfOf` to
  create or upsert as the supplied Jira account ID. This follows the same product
  pattern as Jira Service Management request APIs that accept a `raiseOnBehalfOf`
  user, while making the capability explicit for this app with a dedicated custom
  scope.
- The manifest currently uses Jira's classic `read:jira-work` and `write:jira-work`
  scopes. That keeps the sample straightforward, but a production app should review
  the exact Jira endpoints it calls and prefer narrower granular scopes when they
  cover the same operations.
- The handlers log incoming `apiRoute` requests for sample/debug visibility. In a
  production app, treat verbose request logging on hot paths as an anti-pattern:
  log compact metadata or correlation IDs instead of full payloads, and gate any
  debug payload logging. Atlassian's [Forge cost guidance](https://developer.atlassian.com/platform/forge/optimise-forge-costs/)
  identifies log writes as a cost driver and recommends avoiding verbose logging in
  hot paths.

## Architectural decisions

Key decisions are documented in [`docs/adr/`](docs/adr/):

| ADR | Decision |
| --- | --- |
| [0001](docs/adr/0001-simple-key-value-api-contract.md) | Callers send simple key/value pairs — API absorbs Jira complexity |
| [0002](docs/adr/0002-createmeta-only-no-editmeta.md) | Use `createMeta` only — `editMeta` out of scope |
| [0003](docs/adr/0003-drop-post-creation-jql-verification.md) | Drop post-creation JQL check (Jira Cloud eventual consistency) |
| [0004](docs/adr/0004-upsert-response-envelope.md) | Fully consistent upsert envelope with `created` flag |
| [0005](docs/adr/0005-asapp-as-default-user.md) | Use Forge app identity (`asApp()`) as the default |
| [0006](docs/adr/0006-separate-oauth-scopes-for-as-user-routes.md) | Separate custom OAuth scope for `/asuser` routes |
| [0007](docs/adr/0007-openapi-types-in-forge-ahead.md) | Generated Jira OpenAPI types live in `forge-ahead` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributors must sign the
[Atlassian CLA](https://opensource.atlassian.com/individual) before contributions
can be accepted.

## License

Apache 2.0 — see [LICENSE](LICENSE).
