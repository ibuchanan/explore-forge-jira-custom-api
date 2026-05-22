# jira-custom-api-via-webtriggers

A Forge app that exposes HTTP webhook endpoints for creating Jira issues with
human-readable field names. Callers send `"Summary"` and `"Story Points"`;
the app translates those to Jira field IDs and creates the issue.

Authentication is handled by the app itself using **short-lived JWT Bearer
tokens** (HS256, signed with a shared secret). The Forge platform does not
authenticate webtrigger URLs — the app verifies every request before
processing it. Callers generate a new JWT (≤15 min expiry) per request and
sign it with the shared secret stored as a Forge environment variable.

## Endpoints

Webtrigger URLs are generated per-installation. Use `npm run forge:webtrigger:list` to
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
# Edit .env: set FORGE_SITENAME (e.g. "mycompany") and FORGE_PRODUCT (e.g. "jira")
```

`FORGE_*` variables configure local Forge CLI scripts and are not uploaded as
Forge runtime variables by `npm run forge:variables:set:dotenv`. Non-`FORGE_*`
variables, such as `WEBTRIGGER_TOKEN`, are candidates for Forge runtime
variables.

### 2. Deploy and install

```bash
npm run forge:deploy    # Build and deploy to the environment configured in .env
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

Store them in `apps/webtrigger/.env` as `WEBTRIGGER_TOKEN` and
`WEBTRIGGER_AS_USER_TOKEN`, then set the same values as Forge environment
variables:

```bash
forge variables set --environment "$FORGE_ENVIRONMENT" WEBTRIGGER_TOKEN <plain-token>
forge variables set --environment "$FORGE_ENVIRONMENT" WEBTRIGGER_AS_USER_TOKEN <as-user-token>
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
npm run forge:webtrigger:list
```

Share the appropriate URL and token with each caller.

## Caller setup

Callers generate a short-lived **JWT** (HS256, ≤15 minutes) signed with the
shared secret and send it as the Bearer token. The JWT must include `exp`,
`iat`, `iss`, and `aud` claims.

### Minting a JWT (Node.js / `jose`)

```typescript
import { SignJWT } from "jose";
import { createSecretKey } from "node:crypto";

const secret = createSecretKey(process.env.WEBTRIGGER_TOKEN!, "utf-8");
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("15m")
  .setIssuer("my-ci-system")           // identifies your caller in logs
  .setAudience("write:workitem:custom") // must match the target endpoint
  .sign(secret);
// Authorization: Bearer <token>
```

For as-user endpoints, use `"write:workitem-as-user:custom"` as the audience.

### Making a request

```bash
curl -X POST "<webtrigger-url>" \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "HSP",
    "issueType": "Story",
    "fields": { "Summary": "Hello from the webhook" }
  }'
```

### Required JWT claims

| Claim | Value                                                          |
|-------|----------------------------------------------------------------|
| `alg` | `HS256` (header)                                               |
| `iss` | Any non-empty string identifying your caller                   |
| `aud` | `"write:workitem:custom"` or `"write:workitem-as-user:custom"` |
| `iat` | Issued-at (Unix timestamp)                                     |
| `exp` | Expiry — must be ≤ 15 minutes from `iat`                       |

The app applies a **30-second clock skew leeway** to `exp`.

### Auth error responses

| Situation                                                        | Status | Cause                                         |
|------------------------------------------------------------------|--------|-----------------------------------------------|
| Missing or malformed `Authorization: Bearer` header              | 401    | Caller error                                  |
| Invalid JWT (bad signature, wrong `aud`, expired, missing claim) | 401    | Caller error                                  |
| `WEBTRIGGER_TOKEN` / `WEBTRIGGER_AS_USER_TOKEN` not configured   | 500    | Operator error — rerun `forge variables set`  |

All error responses use RFC 9457 `application/json` `ProblemDetails` bodies.

### Known limitations

**No `jti` replay prevention.** A JWT can be replayed within its 15-minute
expiry window. Adding a `jti` nonce with a server-side seen-cache (Forge KVS)
would eliminate this. The short expiry is the primary replay defence for now.

**No `iss` allowlist.** The `iss` claim is required and logged on every
successful request (`webtrigger auth success: iss=<value>`) but is not
validated against a known list. A `WEBTRIGGER_ALLOWED_ISSUERS` variable
would give stronger isolation in multi-caller deployments.

### Rotating secrets

To rotate a secret, update the value in `apps/webtrigger/.env`, set the same
new value as the Forge variable, and redeploy. There is no grace period — old
tokens signed with the previous secret stop working immediately.

```bash
forge variables set --environment "$FORGE_ENVIRONMENT" WEBTRIGGER_TOKEN <new-value>
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
| `forge:deploy`    | Build and deploy to the environment in `.env`         |
| `forge:install`   | Install on the site in `.env`                         |
| `forge:upgrade`   | Upgrade an existing installation                      |
| `forge:uninstall` | Uninstall from the site in `.env`                     |
| `test`            | Run unit tests                                        |
| `check`           | Full quality check (test + lint + format + typecheck) |
