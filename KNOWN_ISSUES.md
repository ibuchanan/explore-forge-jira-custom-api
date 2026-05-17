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

Atlassian's Developer Console URL generator includes this parameter for Forge App
REST API custom scopes, but generic OAuth docs do not mention it. Without `sns`,
Atlassian may silently drop Forge custom scopes before rendering the consent
page. The failure can look like this:

```text
Something went wrong
This app has not requested any supported Atlassian scopes.
```

**Workaround:** `integration/bootstrap-oauth.py` builds the authorization URL
directly and derives `sns` from `base_url`. For a base URL ending in:

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

## App API custom-scope tokens do not have a refresh flow

**Status:** observed in Developer Console behavior.

Forge App API custom scopes appear mutually exclusive with standard Atlassian
scopes such as `offline_access` in the Developer Console. The integration flow
therefore hands Hurl a generated access token directly. There is no normal
Atlassian product 3LO refresh-token workflow for this custom App API grant.

**Workaround:** when the generated access token expires, delete the generated
OAuth files and start a fresh browser flow:

```bash
rm -f integration/access_token_response.json integration/.oauth.hurl
npm run test:api:bootstrap
```

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

## App REST API gateway rejects valid namespaced custom scopes

**Status:** observed after the OAuth flow successfully returned an access token.

The OAuth access token can include the expected namespaced custom scopes, for
example:

```text
<app-id>.<env-id>:write:workitem:custom
<app-id>.<env-id>:write:workitem-as-user:custom
```

The Forge manifest declares the corresponding un-namespaced `apiRoute` scopes:

```text
/workitem                 write:workitem:custom
/workitem/asuser          write:workitem-as-user:custom
/workitem/upsert          write:workitem:custom
/workitem/upsert/asuser   write:workitem-as-user:custom
```

Despite the apparent match, the App REST API gateway can reject requests before
the Forge handler runs:

```text
HTTP 401
x-failure-category: FAILURE_CLIENT_SCOPE_CHECK
{"code":401,"message":"Unauthorized; scope does not match"}
```

This was observed with both documented base URL forms:

```text
https://api.atlassian.com/svc/jira/<cloud-id>/apps/<app-id>_<env-id>/...
https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>/...
```

A redeploy and install upgrade did not resolve it:

```bash
npm run forge:deploy
npm run forge:upgrade
```

**Likely causes:** platform preview behavior, stale remote custom-scope state,
or a Developer Console/OAuth client association issue despite the correct `sns`
value appearing in the consent context and access token scope names.

**Escalation evidence:** include the `atl-traceid`, `atl-request-id`,
`x-failure-category`, token `scope` claim without the token itself, the
`apiRoute` scope declarations, and the App REST API base URL app/environment
segment. Do not include the bearer token or OAuth client secret.

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
