# Known issues

This file records integration and tooling gotchas discovered while wiring the
Forge App REST API Hurl tests. These are practical notes for maintainers rather
than stable product documentation.

## Atlassian OAuth consent requires undocumented `sns`

**Status:** observed, not found in public docs.

When requesting Forge App REST API custom scopes through Atlassian OAuth 2.0
(3LO), the authorization URL must include an `sns` query parameter:

```text
sns=<app-id>.<env-id>
```

Without `sns`, Atlassian may silently drop Forge custom scopes before rendering
the consent page. The failure can look like this:

```text
Something went wrong
This app has not requested any supported Atlassian scopes.
```

The generated consent URL may reveal the problem: the embedded authorize request
contains only `scope=offline_access`, even though the bootstrap script requested
custom scopes such as `write:workitem:custom`.

The Developer Console URL generator includes `sns`, but the parameter is not
obvious from generic OAuth 2.0 documentation.

**Workaround:** `integration/bootstrap-oauth.py` derives `sns` from `base_url`.
For a base URL ending in:

```text
/apps/<app-id>_<env-id>
```

it sends:

```text
sns=<app-id>.<env-id>
```

If derivation fails, set an explicit override in `integration/.env.hurl`:

```properties
oauth_sns=<app-id>.<env-id>
```

## Atlassian's `sns` parameter is required for custom scopes

**Status:** observed with this integration.

Atlassian's Developer Console URL generator includes an `sns` parameter for
Forge App REST API custom scopes. Generic OAuth docs do not mention it, but the
consent page may omit custom scopes without it.

`integration/bootstrap-oauth.py` builds the authorization URL directly so it can
include `sns=<app-id>.<env-id>` exactly as shown by the Developer Console.

## `oauth_scopes` is space-separated in `.env.hurl`

**Status:** repository convention.

Atlassian's Developer Console generated authorization URL uses OAuth's normal
space-separated scope string. Keep `oauth_scopes` space-separated.

```properties
oauth_scopes=write:workitem:custom write:workitem-as-user:custom
```

## Hurl variable files are properties files, not token JSON

**Status:** documented by Hurl CLI help and examples.

Hurl's `--variables-file` option reads properties-style files:

```properties
name=value
```

It does not read `access_token_response.json` directly as Hurl variables. That
means Hurl cannot directly use the raw OAuth token response JSON as a variables
file.

**Workaround:** the bootstrap script writes a generated Hurl variables file:

```text
integration/.oauth.hurl
```

with:

```properties
oauth_access_token=<latest-access-token>
```

`npm run test:api` loads both files:

```bash
hurl --variables-file integration/.env.hurl \
  --variables-file integration/.oauth.hurl \
  integration/workitem.hurl
```

## Hurl top-level `[Options]` is not accepted

**Status:** observed with Hurl 8.0.1.

A top-level `[Options]` section before the first request is parsed as an invalid
HTTP method. Request options must be attached to a request entry.

**Workaround:** define generated variables on the first request:

```hurl
POST https://auth.atlassian.com/oauth/token
Content-Type: application/json
[Options]
variable: uuid={{newUuid}}
{
  "grant_type": "refresh_token"
}
```

Variables defined this way are available to following requests, so the Hurl suite
uses one generated UUID consistently for summary and dedup JQL values.

## Hurl CLI `--variable uuid={{newUuid}}` is literal

**Status:** observed with Hurl 8.0.1.

Passing a template function through the CLI variable flag did not evaluate it as
a Hurl template function; it was passed literally as `{{newUuid}}`.

**Workaround:** define `uuid` inside `integration/workitem.hurl` using a request
`[Options]` section:

```hurl
[Options]
variable: uuid={{newUuid}}
```

## App API custom-scope tokens may be access-token only

**Status:** observed in Developer Console behavior.

Forge App API custom scopes appear mutually exclusive with standard Atlassian
scopes such as `offline_access` in the Developer Console. The integration flow
therefore hands Hurl a generated access token directly instead of requiring a
refresh token.

**Workaround:** when the generated access token expires, delete the generated
OAuth files and start a fresh browser flow:

```bash
rm -f integration/access_token_response.json integration/.oauth.hurl
npm run test:api:bootstrap
```

## The bootstrap script requires a fixed callback URL

**Status:** repository convention.

The OAuth app in the Atlassian Developer Console must include this callback URL:

```text
http://localhost:9876/callback
```

If the callback differs, the browser authorization flow fails before token
bootstrap can complete.

## Custom scopes must exist for the Forge environment

**Status:** Forge behavior.

The Forge custom scopes must be registered for the environment under test. The
repo declares them in `apps/forge/custom-scopes.yaml`, but they still need to be
created for the target environment.

Check the development environment with:

```bash
forge custom-scopes list --environment development
```

Expected scopes include:

```text
write:workitem:custom
write:workitem-as-user:custom
```

If they are missing, run:

```bash
npm run forge:scopes
```

## Custom scopes cannot be deleted individually with the Forge CLI

**Status:** observed from Forge CLI help and behavior.

`forge custom-scopes` currently exposes `create` and `list`, but no `delete`
subcommand. Rerunning `forge custom-scopes create` after removing a scope from
`apps/forge/custom-scopes.yaml` appears additive/upsert-like: previously created
custom scopes can remain listed for the environment.

This matters when cleaning up unused custom scopes such as a scope that was
registered remotely but is no longer referenced by any `apiRoute` in
`apps/forge/manifest.yml`.

**Potential workaround:** delete and recreate the development environment. Treat
this as destructive and environment-scoped, not as a routine cleanup step.
Recreating an environment can change or invalidate:

- the Forge environment UUID,
- the App REST API `base_url`,
- the derived OAuth `sns` value,
- environment variables,
- deployments and installations,
- generated OAuth grants and local token caches.

A reset flow would look like:

```bash
forge environments list
forge variables list --environment development
forge environments delete --environment development
forge environments create --environment development
npm run forge:deploy
npm run forge:install
npm run forge:scopes
forge custom-scopes list --environment development
```

After recreating the environment, update `integration/.env.hurl` with the new
environment ID in `base_url`, then regenerate OAuth state:

```bash
rm -f integration/access_token_response.json integration/.oauth.hurl
npm run test:api:bootstrap
```

## App API tokens do not use accessible resources

**Status:** observed with the App API custom-scope flow.

Atlassian's normal product 3LO flow often uses
`/oauth/token/accessible-resources` to discover site `cloudId` values. The Forge
App API custom-scope flow is different: the token authorizes a specific app and
environment through `sns`, and the integration already has its App REST API
`base_url`.

Calling `/oauth/token/accessible-resources` with this token can return no usable
cloud ID. The bootstrap script therefore does not call it or generate
`integration/accessible_resources.json`.

## Generated OAuth files are local state

**Status:** repository convention.

These files contain local secrets or token-derived data and must not be
committed:

```text
integration/.env.hurl
integration/.oauth.hurl
integration/access_token_response.json
```

They are ignored by `.gitignore`. If integration behavior becomes confusing,
regenerate them from scratch:

```bash
rm -f integration/access_token_response.json \
  integration/.oauth.hurl
npm run test:api:bootstrap
```
