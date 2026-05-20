# Integration tests

This directory contains the outside-in Hurl test suites for both Forge apps.
Each app has its own subdirectory with its own environment file, bootstrap
script, and Hurl suite — they can be deployed and tested independently.

| App          | Directory                  | Auth mechanism     | Bootstrap                                |
|--------------|----------------------------|--------------------|------------------------------------------|
| `api-route`  | `integration/api-route/`   | OAuth 2.0 (3LO)    | `npm run test:api:bootstrap:api-route`   |
| `webtrigger` | `integration/webtrigger/`  | JWT Bearer (HS256) | `npm run test:api:bootstrap:webtrigger`  |

## Requirements

- [Hurl](https://hurl.dev/) — runs the `.hurl` test files.
- [uv](https://docs.astral.sh/uv/) — runs the Python bootstrap scripts.
- A deployed and installed Forge app on a Jira Cloud site.

---

## api-route

The api-route app is authenticated via **OAuth 2.0 (3LO)**. The bootstrap
script handles the browser-based authorization code flow and writes a
short-lived access token to `integration/api-route/.oauth.hurl`.

### Atlassian Developer Console setup

Before running, create an OAuth 2.0 (3LO) app in the
[Atlassian Developer Console](https://developer.atlassian.com/console/myapps/):

1. Create a new **OAuth 2.0 (3LO)** app.
2. Permissions -> Add Marketplace or custom app -> add scopes
3. Under **Permissions**, add:
   - `write:workitem:custom`
   - `write:workitem-as-user:custom`
3. Permissions -> Add Jira API -> Granular scopes -> `read:forge-app:jira`
4. Under **Authorization**, add callback URL: `http://localhost:9876/callback`

### Configure api-route local variables

```bash
cp integration/api-route/.env.hurl.example integration/api-route/.env.hurl
# Edit integration/api-route/.env.hurl and fill in:
#   oauth_client_id, oauth_client_secret
#   base_url (from apps/api-route/manifest.yml app.id + forge environments list)
#   project, issue_type, raise_on_behalf_of
```

See `integration/api-route/.env.hurl.example` for full documentation.

### Bootstrap OAuth tokens

```bash
npm run test:api:bootstrap:api-route
```

This opens your browser for the OAuth authorization flow and writes
`integration/api-route/.oauth.hurl` with the access token.

On subsequent runs (within the token lifetime), the script uses the cached
refresh token from `integration/api-route/access_token_response.json`.

### Run the api-route tests

```bash
npm run test:api:api-route
# or (backwards-compatible alias):
npm run test:api
```

### Deploy and install api-route

```bash
npm run forge:deploy    # deploy api-route app
npm run forge:install   # install on site in apps/api-route/.env
npm run forge:upgrade   # upgrade an existing installation
```

### Troubleshooting

* 401 Unauthorized after a successful authorization code flow: Double check OAuth app scope `read:forge-app:jira`
* 403 Forbidden: Enable a Forge app’s REST APIs in Connected Apps in Atlassian Administration

---

## webtrigger

The webtrigger app is authenticated via **JWT Bearer tokens** (HS256). The
bootstrap script mints two short-lived JWTs (plain + as-user) from the shared
secrets and writes them to `integration/webtrigger/.jwt.hurl`.

JWTs expire in 15 minutes. Re-run the bootstrap before each test run.

### Deploy the app and set secrets

```bash
npm run forge:deploy
npm run forge:install
```

Then set the shared secrets as Forge environment variables:

```bash
forge variables set --environment development WEBTRIGGER_TOKEN <value>
forge variables set --environment development WEBTRIGGER_AS_USER_TOKEN <value>
```

Generate strong secrets with:

```bash
openssl rand -hex 32   # run twice — once per token
```

### Find webtrigger URLs

```bash
forge webtrigger list
```

Note the URL for each trigger key — you will need them in `.env.hurl`.

### Configure webtrigger local variables

```bash
cp integration/webtrigger/.env.hurl.example integration/webtrigger/.env.hurl
# Edit integration/webtrigger/.env.hurl and fill in:
#   webtrigger_token, webtrigger_as_user_token  (must match forge variables)
#   webtrigger_url, webtrigger_as_user_url,
#   webtrigger_upsert_url, webtrigger_upsert_as_user_url
#   project, issue_type, raise_on_behalf_of
```

See `integration/webtrigger/.env.hurl.example` for full documentation.

### Bootstrap JWT tokens

```bash
npm run test:api:bootstrap:webtrigger
```

This mints fresh JWTs from the secrets in `.env.hurl` and writes them to
`integration/webtrigger/.jwt.hurl`. JWTs are valid for 15 minutes — re-run
this before each test session.

### Run the webtrigger tests

```bash
npm run test:api:webtrigger
```

### Deploy and install (both apps)

```bash
npm run forge:deploy    # deploy both apps
npm run forge:install   # install both apps on the configured site
npm run forge:upgrade   # upgrade existing installations
```

---

## Generated files

The following files are git-ignored and must not be committed:

| File                                               | Generated by                             |
|----------------------------------------------------|------------------------------------------|
| `integration/api-route/.env.hurl`                  | You (copy from `.env.hurl.example`)      |
| `integration/api-route/.oauth.hurl`                | `npm run test:api:bootstrap:api-route`   |
| `integration/api-route/access_token_response.json` | `npm run test:api:bootstrap:api-route`   |
| `integration/webtrigger/.env.hurl`                 | You (copy from `.env.hurl.example`)      |
| `integration/webtrigger/.jwt.hurl`                 | `npm run test:api:bootstrap:webtrigger`  |

---

## Troubleshooting

### `integration/api-route/.oauth.hurl is missing`

Run `npm run test:api:bootstrap:api-route` first. The bootstrap script opens
your browser for OAuth authorization.

### `integration/webtrigger/.jwt.hurl is missing`

Run `npm run test:api:bootstrap:webtrigger` first.

### OAuth callback fails (api-route)

Ensure `http://localhost:9876/callback` is listed as an authorized redirect
URI in your OAuth 2.0 app in the Atlassian Developer Console.

### Expired access token or OAuth errors (api-route)

Delete `integration/api-route/access_token_response.json` and re-run
`npm run test:api:bootstrap:api-route` to force a fresh authorization code flow.

### JWT expired (webtrigger)

Re-run `npm run test:api:bootstrap:webtrigger`. JWTs are valid for 15 minutes.

### Missing custom scope errors (api-route)

Ensure the custom scopes are registered before deployment:

```bash
npm run forge:scopes
```

### 401 errors from webtrigger

Check that:

1. The correct secrets are set with `forge variables set`
2. The secrets in `integration/webtrigger/.env.hurl` match the Forge variables
3. The JWTs are fresh — re-run `npm run test:api:bootstrap:webtrigger`
4. The `aud` claim matches the endpoint (plain vs as-user)

### App REST API URL errors (api-route)

The `base_url` in `.env.hurl` must include the correct `app-id` and `env-id`:

```text
https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
```

- `app-id`: from `apps/api-route/manifest.yml` → `app.id`, strip the
  `ari:cloud:ecosystem::app/` prefix
- `env-id`: run `forge environments list` to get the environment UUID

### Webtrigger URL errors

The webtrigger URLs are per-installation. Run `forge webtrigger list` after
each fresh install to get the current URLs.
