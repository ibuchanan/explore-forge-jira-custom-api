# ADR-0005: Use Forge App Identity (asApp) as the Default User

**Status:** Accepted  
**Date:** 2026-05-16

## Context

When a caller does not supply `raiseOnBehalfOf`, the API must create the issue as
*some* identity. Three options were considered:

1. **Forge app identity (`asApp()`):** The Forge app acts as itself — a first-class
   Jira actor with its own permissions, audit trail entries, and identity.
2. **A configured service account:** A specific human Jira accountId is stored in
   Forge KV config and used as the default. The app always acts as a named human.
3. **Configurable, defaulting to `asApp()`:** Admins can optionally set a default
   accountId. If absent, fall back to `asApp()`.

## Decision

**Use the Forge app identity (`asApp()`) as the default. No service account needed.**

Jira Cloud's Forge platform gives apps a first-class identity — `asApp()` is not an
anonymous or degraded mode. The app has its own accountId, appears in Jira's audit
log, can be granted project roles, and its permissions are controlled via the manifest
scopes and Jira project configuration.

This is a deliberate improvement over Jira Data Center, where plugin actions were
often attributed to a configured service account because there was no equivalent
app-identity model. On Cloud, we use the platform as intended.

## Consequences

**Good:**
- Zero configuration — no service account to create, maintain, or rotate credentials for.
- Audit trail entries are attributed to the app identity, not a human user.
- Permissions are controlled via Forge manifest scopes and Jira project roles for the
  app — standard Forge administration.
- If a caller needs a specific user identity, they use `raiseOnBehalfOf` explicitly.

**Bad / trade-offs:**
- Issues created by the default path will show the app as the reporter, not a human.
  This may be unexpected for teams accustomed to Data Center service accounts.
- The app identity must be granted appropriate project roles in Jira for creation to
  succeed — this is an admin setup step that must be documented.

## Lessons for future developers

This is a recurring Data Center → Cloud migration pattern. On Data Center, "act as a
service account" was the standard approach for background/integration work because
plugins had no identity of their own. On Forge Cloud, **`asApp()` IS the service
account** — it is the app's identity, it appears in audit logs, and it can be granted
roles. Prefer `asApp()` over configured service accounts whenever possible.

## Alternatives considered

**Configured service account (Option B):** Rejected. Requires creating and maintaining
a dedicated Jira user, managing credentials in Forge KV store, and adds operational
complexity with no benefit over the app identity that Forge already provides.

**Configurable with fallback (Option C):** Rejected. Adds complexity (config UI, KV
store reads on every request) that may never be needed. If a default user becomes a
real requirement, this ADR should be revisited.
