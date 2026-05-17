# jira-custom-api-via-webtriggers

A Forge app that exposes HTTP webhook endpoints for creating Jira issues with
human-readable field names. Callers send `"Summary"` and `"Story Points"`;
the app translates those to Jira field IDs and creates the issue.

Authentication is handled by the app itself using **Bearer tokens** stored as
Forge environment variables. The Forge platform does not authenticate webtrigger
URLs — the app verifies every request before processing it.

## Endpoints

Webtrigger URLs are generated per-installation. Use `forge webtrigger list` to
find the URL for each endpoint after installation.

| Trigger key                    | Token required              | Description                                                       |
|--------------------------------|-----------------------------|-------------------------------------------------------------------|
| `workitem-post`                | `WEBTRIGGER_TOKEN`          | Create an issue as the app identity                               |
| `workitem-as-user-post`        | `WEBTRIGGER_AS_USER_TOKEN`  | Create an issue on behalf of a specified user (`raiseOnBehalfOf`) |
| `workitem-upsert-post`         | `WEBTRIGGER_TOKEN`          | Create or return existing issue (deduplication via JQL)           |
| `workitem-upsert-as-user-post` | `WEBTRIGGER_AS_USER_TOKEN`  | Upsert on behalf of a specified user                              |

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
# Edit .env: set SITENAME (e.g. "mycompany") and PRODUCT (e.g. "jira")
```

### 2. Deploy and install

```bash
npm run forge:deploy    # Build and deploy to the development environment
npm run forge:install   # Install on the site configured in .env
```

To upgrade an existing installation after redeployment:

```bash
npm run forge:upgrade
```

### 3. Generate Bearer tokens

Choose strong random secrets for the two tokens. A 32-byte random hex string
works well:

```bash
openssl rand -hex 32   # run twice — once per token
```

Store them as Forge environment variables:

```bash
forge variables set --environment development WEBTRIGGER_TOKEN <plain-token>
forge variables set --environment development WEBTRIGGER_AS_USER_TOKEN <as-user-token>
```

> **Security:** These values are encrypted at rest and are never visible again
> after being set. Keep a copy in your password manager or secrets vault before
> running the command.

Two tokens mirror the two privilege levels:

| Variable                   | Guards                                                  | Privilege                          |
|----------------------------|---------------------------------------------------------|------------------------------------|
| `WEBTRIGGER_TOKEN`         | `workitem-post`, `workitem-upsert-post`                 | Create as app identity             |
| `WEBTRIGGER_AS_USER_TOKEN` | `workitem-as-user-post`, `workitem-upsert-as-user-post` | Create on behalf of any Jira user  |

Give callers only the token(s) they need. A caller that does not need
`raiseOnBehalfOf` should only receive `WEBTRIGGER_TOKEN`.

### 4. Find the webtrigger URLs

After installation, retrieve the URL for each trigger:

```bash
forge webtrigger list
```

Share the appropriate URL and token with each caller.

## Caller setup

Callers include the Bearer token in every request:

```bash
curl -X POST "<webtrigger-url>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "HSP",
    "issueType": "Story",
    "fields": { "Summary": "Hello from the webhook" }
  }'
```

### Auth error responses

| Situation                                                       | Status | Cause                                         |
|-----------------------------------------------------------------|--------|-----------------------------------------------|
| Missing or malformed `Authorization` header                     | 401    | Caller error                                  |
| Wrong token                                                     | 401    | Caller error                                  |
| `WEBTRIGGER_TOKEN` / `WEBTRIGGER_AS_USER_TOKEN` not configured  | 500    | Operator error — rerun `forge variables set`  |

All error responses use RFC 9457 `application/json` `ProblemDetails` bodies.
A 500 means the Forge environment variable was not set — redeploy after
setting it.

### Rotating tokens

To rotate a token, set the new value with `forge variables set` and redeploy.
There is no grace period — old tokens stop working immediately after redeployment.

```bash
forge variables set --environment development WEBTRIGGER_TOKEN <new-value>
npm run forge:deploy
```

## Jira permissions

The app creates issues as either its own identity (`asApp`) or a specified user
(`raiseOnBehalfOf`). In both cases the relevant identity must have **Create
Issues** permission in the target Jira project.

- For plain endpoints: grant the Forge app identity project access in Jira
  project settings → Project roles.
- For as-user endpoints: the `raiseOnBehalfOf` user must have project access
  themselves.

## Development

```bash
npm test              # Run unit tests (vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run check         # Full check: test + lint + format + typecheck
npm run typecheck     # TypeScript type-check only
```

## Scripts reference

| Script            | Description                                           |
|-------------------|-------------------------------------------------------|
| `forge:deploy`    | Build and deploy to development environment           |
| `forge:install`   | Install on the site in `.env`                         |
| `forge:upgrade`   | Upgrade an existing installation                      |
| `forge:uninstall` | Uninstall from the site in `.env`                     |
| `test`            | Run unit tests                                        |
| `check`           | Full quality check (test + lint + format + typecheck) |
