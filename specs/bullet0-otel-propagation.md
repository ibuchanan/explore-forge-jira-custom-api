# Spec: OpenTelemetry Propagation (Bullet 0)

## Summary

OpenTelemetry trace context supplied in the request body is stored as a Jira issue
entity property on the newly created issue. This allows the creation activity and
subsequent issue transitions to be recorded as additional Spans in an existing
distributed Trace.

This is implemented first (Bullet 0) as it is the simplest feature and establishes
the Jira entity property pattern used by the rest of the API.

## Request Body Field

The caller supplies OTel context as a top-level field in the request body:

```json
{
  "fields": { ... },
  "otel": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7",
    "traceFlags": "01",
    "traceState": ""
  }
}
```

The `otel` field is **optional**. If absent, no issue property is written.

### Field definitions

| Field | Required | Description |
|---|---|---|
| `traceId` | yes (if `otel` present) | W3C 32-hex-char trace ID |
| `spanId` | yes (if `otel` present) | W3C 16-hex-char span ID |
| `traceFlags` | no | W3C trace flags (default `"01"`) |
| `traceState` | no | W3C tracestate header value |

### Rationale for request body (not HTTP headers)

OTel context is placed in the request body rather than HTTP headers because:
- The caller controls the full JSON payload and can explicitly include OTel context
- Body fields are explicit, visible, and versionable
- Avoids any HTTP header forwarding limitations in the transport layer

## Jira Issue Entity Property

After the issue is created, the OTel context is written as a Jira issue entity
property using:

```
PUT /rest/api/3/issue/{issueKey}/properties/otel
```

### Property structure

| Key | Value |
|---|---|
| `"otel"` | JSON object (see below) |

```json
{
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "traceFlags": "01",
  "traceState": ""
}
```

A single property key keeps all OTel context co-located and extensible. Additional
fields (e.g. `baggage`) can be added to the JSON value without introducing new
property keys.

## JQL Indexing — Manifest Requirement

Entity properties are **not automatically indexed for JQL**. To make `otel` fields
queryable, the app must declare a `jira:entityProperty` module in `manifest.yml`
specifying which paths to extract and index.

### Required manifest declaration

```yaml
modules:
  jira:entityProperty:
    - key: otel-issue-property
      entityType: issue
      propertyKey: otel
      values:
        - path: traceId
          type: string
          alias: otelTraceId
        - path: spanId
          type: string
          alias: otelSpanId
```

Without this declaration, the `otel` property is stored on the issue but is not
queryable via JQL.

## Querying with JQL

Once indexed, the `otel` fields are queryable via JQL using the declared aliases:

```jql
-- Find all issues in a trace (using alias)
otelTraceId = "4bf92f3577b34da6a3ce929d0e0e4736"

-- Find issues created from a specific span
otelSpanId = "00f067aa0ba902b7"

-- Combine with other filters
project = HSP AND otelTraceId = "4bf92f3577b34da6a3ce929d0e0e4736"
```

> **Note:** JQL aliases (`otelTraceId`, `otelSpanId`) are declared in the manifest
> `jira:entityProperty` module. The raw `issue.property[otel].traceId` dot notation
> syntax only works when indexed — the alias form shown above is the standard pattern.

## Error Behaviour

- If the `otel` field is present but malformed or incomplete, return a `ValidationProblemDetails`
  400 response before attempting issue creation. Per-field errors use dotted paths:
  ```json
  { "errors": [{ "field": "otel.spanId", "reason": "required", "message": "spanId is required when otel is provided." }] }
  ```
- `traceId` and `spanId` are validated as hex strings (32 and 16 chars respectively).
- `traceFlags` and `traceState` are optional — absent is treated as `"01"` and `""` respectively.
- If the issue is created successfully but the property write fails, log a warning and
  return the issue key. The creation is not rolled back — the property write is
  best-effort.

## Endpoint Type (Resolved)

The endpoint type is confirmed as a Forge **`apiRoute`** (Forge App REST API) with
OAuth 2.0 (3LO). See `specs/endpoint-architecture.md` for the full routing and
manifest design.

## Implementation Notes

- The `otel` field is extracted from the request body before field name/value
  translation and must not be passed through to the Jira issue creation payload.
- The property write (`PUT .../properties/otel`) happens after successful issue
  creation, using the same auth client (`asApp()` or `asUser(raiseOnBehalfOf)`) as
  the creation call.
- This pattern (write entity properties post-creation) will be reused by other
  features in this API.
