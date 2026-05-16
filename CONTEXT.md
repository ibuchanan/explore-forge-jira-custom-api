# Domain Glossary

This file is the authoritative glossary for this codebase. It defines terms precisely
so that all contributors share a common language. It contains **only definitions** —
no implementation details, no specs, no ADRs.

---

## apiRoute

A Forge module type that exposes a custom REST endpoint secured with OAuth 2.0 (3LO).
Callers authenticate as a Jira user (or service with user-delegated OAuth). Forge
handles JWT verification and token validation automatically. Routes declare custom
scopes in `manifest.yml` that callers must hold.

## allowedValues

The list of valid option values for a Jira field, returned by the `createMeta`
endpoint. Used by the coercion registry to validate caller-supplied values before
calling Jira. Only present for select-style fields (option, priority, version,
component, etc.).

## coercion

The process of transforming a simple caller-supplied value (e.g. the string `"High"`)
into the exact shape that the Jira REST API expects (e.g. `{ "name": "High" }` for a
priority field). Coercion is driven by field schema metadata from `createMeta`.

## coercion registry

A map from field schema type / custom field plugin key to a coercion function.
Each entry handles the structural transformation and `allowedValues` validation for
one field type. Unknown field types have no entry and are rejected.

## createMeta

The Jira REST API endpoint `GET /rest/api/3/issue/createmeta/{project}/issuetypes/{issueTypeId}`
that returns field metadata for a given project and issue type combination, including
field IDs, display names, schema types, clause names, and allowed values. The
authoritative source for field name resolution and value coercion.

## dedup (deduplication)

The optional pre-creation check performed by the upsert endpoint. A caller-supplied
JQL query is executed before creating an issue. If it returns matches, creation is
skipped and the matches are returned instead. The `dedup` field is required on upsert
endpoints and absent on insert endpoints.

## insert

The plain issue creation operation. No deduplication check is performed. Corresponds
to the `POST /workitem` and `POST /workitem/as-user` endpoints.

## otel

The OpenTelemetry trace context supplied by callers in the request body. Stored as a
Jira issue entity property under the key `"otel"` after successful issue creation.
Enables distributed tracing of issue creation and subsequent transitions.

## raiseOnBehalfOf

A Jira `accountId` string supplied in the request body of `/as-user` endpoints. When
present, the issue is created using `asUser(raiseOnBehalfOf)` rather than the Forge
app identity. Follows the naming precedent set by the Jira Service Management REST API.

## upsert

The combined insert-or-return-existing operation. The upsert endpoint runs a
caller-supplied JQL query (the `dedup` field) before creating. If matches are found,
creation is skipped. If no matches are found, the issue is created. The response
envelope always has the same shape, with `created: true/false` indicating the outcome.

## warnings

An array of advisory strings returned in every upsert response. Warnings are
informational — they do not prevent creation or indicate failure. Current uses include:
cross-project dedup matches, and post-creation advisory conditions. Future features
may add additional warning types.

## workitem

The domain term for an issue creation request in this API. A workitem request carries
a `project`, `issueType`, `fields` map (human-readable names), optional `update` map,
optional `otel` context, optional `raiseOnBehalfOf`, and (on upsert endpoints) a
required `dedup` JQL string.
