# ADR-0008: Document apiRoute vs Webtrigger Integration Trade-offs

**Status:** Accepted
**Date:** 2026-05-22

## Context

The Work Item API now has two Forge app implementations with the same logical
capabilities:

1. **`apps/api-route`:** Uses Forge `apiRoute` modules. Callers authenticate with
   Atlassian OAuth 2.0 (3LO), and Forge enforces custom scopes declared on each
   route.
2. **`apps/webtrigger`:** Uses Forge `webtrigger` modules. Callers authenticate
   with short-lived signed JWT Bearer tokens that this repository validates in
   handler code.

Both implementations support insert, insert as user, upsert, and upsert as user.
Both use the same request shape, field translation, value coercion, deduplication,
OTel propagation, and `raiseOnBehalfOf` pattern.

The two Forge module types make different platform trade-offs. We need to document
those trade-offs so future developers choose an integration style intentionally
instead of treating the two apps as interchangeable.

## Decision

**Keep both implementations and document their intended fit.**

Use **`api-route`** when the caller can participate in OAuth 2.0 (3LO), user
consent is acceptable, and the integration benefits from a stable base URL with
readable route paths.

Use **`webtrigger`** when the caller is a system-to-system integration that can
hold a shared signing secret, and avoiding a user-delegated OAuth flow is more
important than route aesthetics and platform-managed authorization.

## Comparison

| Approach | Fit | Platform/auth model | Trade-offs |
| --- | --- | --- | --- |
| `api-route` | User-delegated integrations | OAuth 2.0 (3LO) with Forge-enforced custom scopes | Stable base URL and readable paths such as `/workitem/upsert`. Not a natural fit for system-to-system callers because acquiring tokens requires a 3LO consent flow. |
| `webtrigger` | System-to-system integrations | App-validated JWT Bearer tokens signed with shared secrets | Each route has a separate generated URL, with no nice path names. Forge does not provide platform auth for webtriggers, so the app owns token validation, secret storage, and rotation behavior. |

## Consequences

**Good:**

- The repository demonstrates both Forge HTTP integration styles side by side.
- Callers that need stable paths and platform-managed OAuth scopes can use
  `api-route`.
- Service callers can avoid forcing a user-delegated OAuth 3LO flow by using
  `webtrigger` with signed JWT Bearer tokens.
- The README and app-specific documentation can direct users to the appropriate
  implementation rather than presenting one option as universally better.

**Bad / trade-offs:**

- The two apps duplicate some Work Item API wiring and test coverage.
- `api-route` is awkward for system-to-system integrations because of OAuth 2.0
  (3LO) consent and token bootstrap requirements.
- `webtrigger` has operational burden that `apiRoute` avoids: generated URLs per
  trigger, application-owned auth, shared-secret management, and redeploy-driven
  secret rotation.
- Webtrigger URL shape is less ergonomic for API consumers because the generated
  URL is the route; callers do not get a stable app base URL plus semantic path
  segments.

## Security notes

For `api-route`, Forge custom scopes are the route-level security boundary. The
plain routes require `write:workitem:custom`, and as-user routes require
`write:workitem-as-user:custom`.

For `webtrigger`, possession of the relevant shared secret is the route-level
security boundary:

- `WEBTRIGGER_TOKEN` for plain insert and upsert routes.
- `WEBTRIGGER_AS_USER_TOKEN` for `raiseOnBehalfOf` routes.

JWTs are short-lived, but secret rotation requires updating Forge runtime variables
and redeploying the app so the runtime observes the new values.

## Lessons for future developers

Do not choose between Forge `apiRoute` and `webtrigger` based only on handler code.
Choose based on the caller's authentication model and operational constraints:

- If the caller is a user-delegated integration and OAuth consent is acceptable,
  prefer `apiRoute` for platform-managed authorization and readable API paths.
- If the caller is a service integration and 3LO is inappropriate, consider
  `webtrigger`, but budget for owning authentication, secret rotation, and URL
  distribution.

For system-to-system integrations, continue to prefer `asApp()` as the default Jira
identity. Use `raiseOnBehalfOf` only for narrow Reporter-setting cases where the
as-user route or token is the explicit security boundary.

## Alternatives considered

**Only ship `api-route`:** Rejected. It gives the cleanest API surface, but OAuth
2.0 (3LO) is not a good default for service-to-service integrations that do not
have a natural user consent flow.

**Only ship `webtrigger`:** Rejected. It fits service callers better, but loses
Forge's platform-managed OAuth scope enforcement and has less ergonomic generated
URLs.

**Build custom path routing behind one webtrigger:** Deferred. It could provide
nice path names on top of a single webtrigger URL, but would require extra routing
and still would not provide platform-managed authentication.

**Use `asUser(userId)` broadly for all caller-supplied user IDs:** Rejected as a
general pattern. `raiseOnBehalfOf` is intentionally narrow and mirrors the Jira
Service Management Reporter-setting pattern. Broader impersonation requires a
separate authorization model and threat analysis.
