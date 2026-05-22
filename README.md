# Forge Jira Custom API — Work Item Service

A Forge monorepo that exposes custom HTTP APIs for creating Jira issues without
requiring callers to understand Jira's internal field model. Callers send simple,
human-readable key/value pairs; the apps resolve field names, coerce values,
handle deduplication, propagate OpenTelemetry trace context, and optionally create
issues on behalf of a Jira user.

This repository contains two implementations of the same Work Item API so you can
compare the operational trade-offs between Forge `apiRoute` and `webtrigger`.

## What this is

| Package | Description |
| --- | --- |
| `apps/api-route` | Forge `apiRoute` app secured by OAuth 2.0 (3LO) and custom scopes |
| `apps/webtrigger` | Forge `webtrigger` app secured by short-lived signed JWT Bearer tokens |
| `packages/forge-ahead` | Shared Forge utilities: auth, HTTP, config, Jira types, manifest helpers |

## Choosing an integration style

| Approach | Good fit | Trade-offs |
| --- | --- | --- |
| `api-route` | User-delegated integrations that can complete OAuth 2.0 (3LO) | Stable base URL and readable paths such as `/workitem/upsert`, with Forge-enforced custom scopes. The OAuth 3LO requirement makes this awkward for system-to-system integrations. |
| `webtrigger` | System-to-system callers that can hold a shared signing secret | Each route has a generated URL rather than a stable base URL plus nice path names. Forge does not provide platform auth for webtriggers, so this app rolls its own JWT Bearer auth. Secret rotation requires updating Forge variables and redeploying the app. |

Use `api-route` when OAuth 3LO and user consent are part of the integration model.
Use `webtrigger` when the caller is a service and the operational cost of managing
shared secrets is preferable to a user-delegated OAuth flow.

## Work Item operations

Both apps expose the same four logical operations:

| Operation | Identity | Description |
| --- | --- | --- |
| Insert | `asApp()` | Create an issue as the Forge app identity |
| Insert as user | `asUser(raiseOnBehalfOf)` | Create an issue on behalf of a Jira user |
| Upsert | `asApp()` | Return existing matches or create an issue when no match exists |
| Upsert as user | `asUser(raiseOnBehalfOf)` | Upsert on behalf of a Jira user |

In `apps/api-route`, these operations are exposed as readable paths:

| Route | Scope | Description |
| --- | --- | --- |
| `POST /workitem` | `write:workitem:custom` | Insert as the Forge app identity |
| `POST /workitem/asuser` | `write:workitem-as-user:custom` | Insert on behalf of a Jira user |
| `POST /workitem/upsert` | `write:workitem:custom` | Insert or return existing issue |
| `POST /workitem/upsert/asuser` | `write:workitem-as-user:custom` | Upsert on behalf of a Jira user |

In `apps/webtrigger`, Forge generates one URL for each trigger key:

| Trigger key | Token secret | Description |
| --- | --- | --- |
| `workitem-post` | `WEBTRIGGER_TOKEN` | Insert as the Forge app identity |
| `workitem-as-user-post` | `WEBTRIGGER_AS_USER_TOKEN` | Insert on behalf of a Jira user |
| `workitem-upsert-post` | `WEBTRIGGER_TOKEN` | Insert or return existing issue |
| `workitem-upsert-as-user-post` | `WEBTRIGGER_AS_USER_TOKEN` | Upsert on behalf of a Jira user |

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

Field names can be human-readable display names, clause names, or raw field IDs.
The app resolves them via Jira `createMeta` and coerces values to the shape Jira
expects, so callers do not need to send `customfield_10016` or
`{ "name": "High" }`.

For upsert operations, add `"dedup": "<JQL>"`.
For as-user operations, add `"raiseOnBehalfOf": "<accountId>"`.

## Key behaviours

- **Field name resolution** — case-insensitive match against display name,
  clause names, or raw field ID. Two-phase validation collects all field name
  errors first, then all coercion errors.
- **Value coercion** — priorities, options, users, versions, components,
  sprints, dates, numbers, and strings are translated automatically.
  Unsupported types, such as cascading select, are rejected with a clear error.
- **Deduplication** — upsert operations run caller-supplied JQL before
  creation. If matches are found, creation is skipped and up to 10 matching
  issue keys are returned. Post-creation JQL verification is intentionally
  absent because Jira Cloud indexing is eventually consistent.
- **OTel propagation** — optional `otel` data is stored as a Jira issue entity
  property and indexed for JQL via `otelTraceId` and `otelSpanId` aliases
  declared in each app manifest.
- **Default identity** — operations without `raiseOnBehalfOf` create issues as
  the Forge app identity (`asApp()`), so no service account is needed.
- **As-user identity** — as-user operations require `raiseOnBehalfOf`, following
  the Jira Service Management API pattern for setting the Reporter.

## About `raiseOnBehalfOf`

`raiseOnBehalfOf` is intentionally narrow. In this API it is used to create an
issue as a specified Jira account so the Reporter can reflect the user who raised
the work item. That mirrors the pattern used by Jira Service Management APIs.

Treat the broader `asUser(userId)` pattern with care. A general-purpose
integration should not blindly accept unchecked user IDs from HTTP requests and
then call Jira as those users. That can be safe for this specific Reporter case
when access to the as-user route or token is the security boundary, but more
general impersonation needs explicit threat modeling, authorization checks, and
auditability. For most system-to-system integration points, `asApp()` remains
the preferred default.

## Prerequisites

- [Node.js 24](https://nodejs.org/)
- npm 10.9.0 or newer
- [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/),
  installed and authenticated with `forge login`
- [uv](https://docs.astral.sh/uv/) and [Hurl](https://hurl.dev/) for integration
  tests
- A Jira Cloud site where you can install Forge apps

## Setup

Install dependencies from the monorepo root:

```bash
npm install
```

If you cloned this repository and want your own Forge apps, register fresh app
IDs before deploying. The root script removes the committed `app.id` values from
each Forge app manifest, then runs `forge register` for each app sequentially:

```bash
npm run forge:register
```

If you only need to remove the existing app IDs and register later, run
`npm run forge:reset-registration` instead. Do not use these scripts for normal
day-to-day development unless you intentionally want to disconnect the local
manifests from the currently registered Forge apps.

Configure whichever app you want to run:

```bash
cp apps/api-route/.env.example apps/api-route/.env
cp apps/webtrigger/.env.example apps/webtrigger/.env
```

Edit each `.env` file with the target Forge site, product, and environment. The
webtrigger app also needs `WEBTRIGGER_TOKEN` and `WEBTRIGGER_AS_USER_TOKEN`; generate
strong values, upload them with `npm run forge:variables:set:dotenv`, then redeploy.

See the app READMEs for detailed setup:

- [`apps/api-route/README.md`](apps/api-route/README.md)
- [`apps/webtrigger/README.md`](apps/webtrigger/README.md)

## Common workflows

```bash
# Build everything
npm run build

# Run all tests
npm run test

# Lint, format-check, and typecheck
npm run check

# Regenerate Jira OpenAPI types
npm run generate

# For a cloned repo: remove committed app IDs and register fresh Forge apps
npm run forge:register

# Only remove committed app IDs, leaving registration for later
npm run forge:reset-registration

# Deploy and install both Forge apps for the configured environments
npm run forge:deploy
npm run forge:install

# Register custom OAuth scopes for api-route
npm run forge:scopes

# Upload webtrigger runtime secrets from apps/webtrigger/.env
npm run forge:variables:set:dotenv

# List generated webtrigger URLs
npm run forge:webtrigger:list
```

Use npm workspaces when you only want one app, for example:

```bash
npm --workspace=jira-custom-api-via-api-route run forge:deploy
npm --workspace=jira-custom-api-via-webtriggers run forge:deploy
```

## Testing

Unit tests use Vitest:

```bash
npm run test           # all packages
npm run test:coverage  # with coverage
```

Integration tests use Hurl and app-specific bootstrap scripts:

```bash
# api-route: browser-based OAuth 2.0 authorization code flow
cp integration/api-route/.env.hurl.example integration/api-route/.env.hurl
npm run test:api:bootstrap:api-route
npm run test:api:api-route

# webtrigger: mint short-lived JWT Bearer tokens from local secrets
cp integration/webtrigger/.env.hurl.example integration/webtrigger/.env.hurl
npm run test:api:bootstrap:webtrigger
npm run test:api:webtrigger

# Run both suites
npm run test:api
```

See [`integration/README.md`](integration/README.md) for OAuth app setup,
webtrigger URL variables, generated token files, and troubleshooting.

## Project layout

```text
apps/api-route/
  src/workitem/     # apiRoute handlers, pipeline, field resolver, Jira client
  src/frontend/     # Jira admin page for app base URL and account ID discovery
  manifest.yml      # apiRoute declarations and custom OAuth scopes

apps/webtrigger/
  src/workitem/     # webtrigger handlers, JWT auth, pipeline, Jira client
  src/frontend/     # Jira admin page and resolver for webtrigger URL discovery
  manifest.yml      # webtrigger declarations and Jira scopes

integration/
  api-route/        # Hurl suite and OAuth bootstrap helper
  webtrigger/       # Hurl suite and JWT bootstrap helper

packages/forge-ahead/
  src/forge/        # Auth helpers, logging, manifest utilities, triggers
  src/jira/         # Generated OpenAPI types and Jira API helpers
  src/config/       # Forge KVS-backed config store
  src/api/          # apiRoute primitives
  src/util/         # ProblemDetails, ValidationProblemDetails, HTTP helpers
  src/rovo/         # Rovo action and agent connector support
```

## Production considerations

- Prefer `asApp()` for system-to-system integrations unless there is a specific,
  reviewed need to act as a Jira user.
- Treat as-user operations as elevated. In `api-route`, the
  `write:workitem-as-user:custom` OAuth scope is the route-level security boundary.
  In `webtrigger`, possession of `WEBTRIGGER_AS_USER_TOKEN` is the route-level
  security boundary.
- Rotate webtrigger secrets by updating Forge variables and redeploying the app.
  Existing JWTs are short-lived, but the Forge runtime only sees new secrets after
  deployment.
- The manifests currently use Jira's classic `read:jira-work` and `write:jira-work`
  scopes. A production app should review the exact Jira endpoints it calls and
  prefer narrower granular scopes when they cover the same operations.
- Keep request logging compact on production hot paths. Log correlation IDs and
  metadata rather than full payloads.

## Architectural decisions

Key decisions are documented in [`docs/adr/`](docs/adr/):

| ADR | Decision |
| --- | --- |
| [0001](docs/adr/0001-simple-key-value-api-contract.md) | Callers send simple key/value pairs — API absorbs Jira complexity |
| [0002](docs/adr/0002-createmeta-only-no-editmeta.md) | Use `createMeta` only — `editMeta` out of scope |
| [0003](docs/adr/0003-drop-post-creation-jql-verification.md) | Drop post-creation JQL check due to Jira Cloud eventual consistency |
| [0004](docs/adr/0004-upsert-response-envelope.md) | Fully consistent upsert envelope with `created` flag |
| [0005](docs/adr/0005-asapp-as-default-user.md) | Use Forge app identity (`asApp()`) as the default |
| [0006](docs/adr/0006-separate-oauth-scopes-for-as-user-routes.md) | Separate custom OAuth scope for `/asuser` routes |
| [0007](docs/adr/0007-openapi-types-in-forge-ahead.md) | Generated Jira OpenAPI types live in `forge-ahead` |
| [0008](docs/adr/0008-api-route-vs-webtrigger-integration-style.md) | Document `api-route` vs `webtrigger` integration trade-offs |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributors must sign the
[Atlassian CLA](https://opensource.atlassian.com/individual) before contributions
can be accepted.

## License

Apache 2.0 — see [LICENSE](LICENSE).
