# ADR-0006: Separate Custom OAuth Scopes for As-User Routes

**Status:** Accepted  
**Date:** 2026-05-16

## Context

The `raiseOnBehalfOf` capability allows the API to create issues as any
specified Jira user, not just the Forge app identity. This is a security-sensitive
capability — a caller who can create issues as any user could potentially create
issues attributed to users who never authorized such actions.

Two approaches to gating this capability were considered:

1. **Separate custom OAuth scope** declared only on the `/as-user` routes in
   `manifest.yml`. An OAuth app must explicitly request this scope to call these
   routes. Forge enforces the scope at the platform level.

2. **Same scope, different path:** All routes share `write:workitem:custom`. The
   path itself (`/as-user`) is the semantic distinction, but any caller with the
   base scope can call the as-user routes. Access control would need to be implemented
   in handler code.

## Decision

**Use a separate custom OAuth scope (`write:workitem-as-user:custom`) declared
exclusively on the `/workitem/as-user` and `/workitem/upsert/as-user` routes.**

The core principle: **access to the endpoint IS the permission.** If an OAuth app
holds `write:workitem-as-user:custom`, it is authorized to raise on behalf of any
valid Jira accountId. No per-user-ID runtime check is needed.

This mirrors how JSM's own `raiseOnBehalfOf` capability is gated — by the OAuth
scope granted to the integration, not by runtime checks inside the handler.

## Security note: not a general impersonation pattern

This decision is intentionally narrow. `raiseOnBehalfOf` exists so issue creation
can set the Reporter in the same style as Jira Service Management request APIs.
The trusted integration holds an elevated scope, and that route-level scope is the
security boundary.

Do **not** generalize this into a pattern where arbitrary HTTP callers can provide
unchecked user IDs and the app blindly calls `asUser(userId)` for broader Jira
operations. That would turn request input into an impersonation primitive. Broader
use of `asUser(userId)` needs a separate authorization model, threat analysis,
input constraints, and auditability requirements.

## Manifest declaration

```yaml
- key: workitem-insert-as-user
  path: /workitem/as-user
  operation: POST
  function: workitem-as-user-handler
  scopes:
    - write:workitem-as-user:custom   # ← distinct scope

- key: workitem-upsert-as-user
  path: /workitem/upsert/as-user
  operation: POST
  function: workitem-upsert-as-user-handler
  scopes:
    - write:workitem-as-user:custom   # ← same distinct scope
```

## Consequences

**Good:**

- Security boundary is enforced at the Forge platform level — no handler code
  needed.
- OAuth apps must explicitly request the elevated scope, making the privilege
  opt-in and auditable.
- Scope names are self-documenting in OAuth consent screens and audit logs.
- Consistent with how Forge recommends gating sensitive capabilities.

**Bad / trade-offs:**

- OAuth apps that need both plain and as-user creation must request two scopes.
- Adding a new scope requires re-consent from all existing OAuth app installations
  if this scope is added after initial deployment.

## Lessons for future developers

In Forge `apiRoute` apps, **custom scopes are the recommended security boundary
for sensitive capabilities.** Avoid implementing security gates inside handler
code when the Forge manifest can enforce them at the platform level.
Platform-enforced gates are harder to accidentally bypass, appear in audit logs,
and require explicit opt-in from callers.

When designing new endpoints with elevated privileges, always ask whether this
can be a separate scope rather than a runtime check. Also ask whether
caller-supplied identity should be accepted at all. `raiseOnBehalfOf` is safe
only for this
narrow Reporter-setting case because endpoint access is the explicit permission.
For more general operations, unchecked user IDs from request bodies are not
sufficient authorization to call Jira as that user.

## Alternatives considered

**Runtime check in handler (Option B):** Rejected. Any handler-level check can
be accidentally omitted, misconfigured, or bypassed by future refactoring.
Platform-level enforcement is more robust and requires zero handler code.
