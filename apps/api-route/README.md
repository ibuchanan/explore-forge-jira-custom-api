# jira-custom-api-via-api-route

A Forge app that exposes a custom REST API for creating Jira issues with
human-readable field names. Callers send `"Summary"` and `"Story Points"`;
the app translates those to Jira field IDs and creates the issue.

Authentication is handled by the Forge platform via **OAuth 2.0 (3LO)**.
Callers obtain an access token through the standard Atlassian OAuth flow and
include it as a `Bearer` token on every request.

## Endpoints

| Method | Path                      | Scope required                  | Description                                                       |
|--------|---------------------------|---------------------------------|-------------------------------------------------------------------|
| POST   | `/workitem`               | `write:workitem:custom`         | Create an issue as the app identity                               |
| POST   | `/workitem/asuser`        | `write:workitem-as-user:custom` | Create an issue on behalf of a specified user (`raiseOnBehalfOf`) |
| POST   | `/workitem/upsert`        | `write:workitem:custom`         | Create or return existing issue (deduplication via JQL)           |
| POST   | `/workitem/upsert/asuser` | `write:workitem-as-user:custom` | Upsert on behalf of a specified user                              |

### Minimal request body

```json
{
  "project": "HSP",
  "issueType": "Story",
  "fields": {
    "Summary": "My issue title",
    "Story Points": 5
  }
}
```

Upsert endpoints also require `"dedup"` (a JQL string). As-user endpoints also
require `"raiseOnBehalfOf"` (a Jira `accountId`).

## Prerequisites

- [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/)
  installed and authenticated (`forge login`)
- A Jira Cloud site where you have admin rights
- Node.js 20+ and npm

## Admin setup

### 1. Configure your target site

```bash
cp .env.example .env
# Edit .env: set FORGE_SITENAME (e.g. "mycompany") and FORGE_PRODUCT (e.g. "jira")
```

### 2. Register custom OAuth scopes

Custom scopes must be registered before the app is deployed. Run this once per
environment:

```bash
npm run forge:scopes
```

This registers `write:workitem:custom` and `write:workitem-as-user:custom`
from `custom-scopes.yaml`.

### 3. Deploy and install

```bash
npm run forge:deploy    # Build and deploy to the environment configured in .env
npm run forge:install   # Install on the site configured in .env
```

To upgrade an existing installation after redeployment:

```bash
npm run forge:upgrade
```

### 4. Find the app base URL

The base URL for API callers follows this pattern:

```text
https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
```

- `app-id`: from `manifest.yml` → `app.id`, strip the
  `ari:cloud:ecosystem::app/` prefix
- `env-id`: run `forge environments list` to get the environment UUID

Share this base URL with callers so they can construct endpoint URLs.

## Caller setup: the OAuth dance

Callers authenticate using Atlassian OAuth 2.0 (3LO). As admin, you need to
set up an OAuth app and help callers request the right scopes.

### Step 1 — Create an OAuth 2.0 app

In the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/):

1. Create a new **OAuth 2.0 (3LO)** app.
2. Under **Permissions**, add the scopes your caller needs:
   - `write:workitem:custom` — for plain insert and upsert endpoints
   - `write:workitem-as-user:custom` — for as-user endpoints (elevated privilege)
3. Under **Authorization**, add the callback URL your caller will use.

> **Important:** App API custom scopes (`write:*:custom`) are **mutually
> exclusive** with `offline_access` in the Developer Console. Do not add
> `offline_access` — the authorization URL must include the `sns` parameter
> (see below) instead.

### Step 2 — Construct the authorization URL

The authorization URL requires a special `sns` parameter that ties the OAuth
token to your specific Forge app installation:

```text
https://auth.atlassian.com/authorize
  ?audience=api.atlassian.com
  &client_id=<oauth-client-id>
  &scope=write:workitem:custom%20write:workitem-as-user:custom
  &redirect_uri=<your-callback-url>
  &response_type=code
  &prompt=consent
  &sns=<app-id>.<env-id>
```

The `sns` value is `<app-id>.<env-id>` — the same IDs used in the base URL.

### Step 3 — Exchange code for token

Standard OAuth 2.0 authorization code exchange:

```bash
curl -X POST https://auth.atlassian.com/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "<oauth-client-id>",
    "client_secret": "<oauth-client-secret>",
    "code": "<auth-code>",
    "redirect_uri": "<your-callback-url>"
  }'
```

### Step 4 — Call the API

```bash
curl -X POST \
  "https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>/workitem" \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "HSP",
    "issueType": "Story",
    "fields": { "Summary": "Hello from the API" }
  }'
```

## Jira permissions

The app creates issues as either its own identity (`asApp`) or a specified user
(`raiseOnBehalfOf`). In both cases the relevant identity must have **Create
Issues** permission in the target Jira project.

- For plain endpoints: grant the Forge app identity project access in Jira
  project settings → Project roles.
- For as-user endpoints: the `raiseOnBehalfOf` user must have project access
  themselves.

## Integration tests

See [`integration/README.md`](../../integration/README.md) for the full
outside-in Hurl test suite, including the OAuth bootstrap script.

## Development

```bash
npm test              # Run unit tests (vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run check         # Full check: test + lint + format + typecheck
npm run typecheck     # TypeScript type-check only
```

## Scripts reference

| Script            | Description                                             |
|-------------------|---------------------------------------------------------|
| `forge:scopes`    | Register custom OAuth scopes (run once per environment) |
| `forge:deploy`    | Build and deploy to the environment in `.env`           |
| `forge:install`   | Install on the site in `.env`                           |
| `forge:upgrade`   | Upgrade an existing installation                        |
| `forge:uninstall` | Uninstall from the site in `.env`                       |
| `test`            | Run unit tests                                          |
| `check`           | Full quality check (test + lint + format + typecheck)   |
