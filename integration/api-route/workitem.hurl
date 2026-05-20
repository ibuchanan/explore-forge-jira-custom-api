# Workitem App REST API integration tests
#
# This file refreshes the OAuth access token automatically at the start of
# each run using the refresh token from .oauth.hurl. Run
# `npm run test:api:bootstrap:api-route` once to do the initial browser-based
# consent flow; subsequent runs refresh silently without a browser.
#
# Refresh the OAuth access token before every run so the suite is not
# sensitive to token expiry. Requires oauth_client_id, oauth_client_secret,
# and oauth_refresh_token to be present in the variables files.
#
# The response body is captured and the access_token is assigned to `token`
# for all following requests. uuid is generated once per Hurl session.
POST https://auth.atlassian.com/oauth/token
[FormParams]
grant_type: refresh_token
client_id: {{oauth_client_id}}
client_secret: {{oauth_client_secret}}
refresh_token: {{oauth_refresh_token}}

HTTP 200
[Captures]
token: jsonpath "$.access_token"

# Generate a unique UUID for this run — used in upsert happy-path summaries
# and dedup JQL to guarantee no pre-existing match.
GET https://example.invalid/uuid
[Options]
skip: true
variable: uuid={{newUuid}}

HTTP *

# POST /workitem — outside-in integration tests
#
# Prerequisites:
#   - The app must be deployed and installed on the target site.
#   - App REST APIs must be enabled for the site in Atlassian Administration > Connected apps.
#   - A 3LO OAuth 2.0 integration must be configured in the Developer Console with the
#     write:workitem:custom scope granted for this Forge app.
#
# URL format (choose one):
#   https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>/workitem
#   https://api.atlassian.com/svc/jira/<cloud-id>/apps/<app-id>_<env-id>/workitem
#
# Run with:
#   npm run test:api:api-route
#
# .env.hurl variables (see integration/api-route/.env.hurl.example):
#   base_url   = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   project    = <Jira project key, e.g. HSP>
#   issue_type = <issue type name, e.g. Story>


# ---------------------------------------------------------------------------
# Happy path — create a minimal issue
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Integration test issue [hurl]"
  }
}

HTTP 201
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.id" isString
jsonpath "$.key" matches /^[A-Z]+-\d+$/
jsonpath "$.self" startsWith "https://"


# ---------------------------------------------------------------------------
# 400 — missing required field: project
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Missing project"
  }
}

HTTP 400
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — missing required field: issueType
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "fields": {
    "Summary": "Missing issueType"
  }
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — missing required field: fields
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}"
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — empty project string
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Empty project key"
  }
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — malformed JSON body
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
```
not valid json at all
```

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — unknown field name (field resolution failure)
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Field resolution test",
    "NonExistentFieldXYZ": "value"
  }
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString
jsonpath "$.errors" isCollection
jsonpath "$.errors[0].reason" == "not_found"


# ---------------------------------------------------------------------------
# 401 — missing Authorization header
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "No auth" }
}

HTTP 401
# POST /workitem/upsert — outside-in integration tests
#
# Tests the deduplication-aware insert endpoint.
# Always returns 200 OK regardless of whether the issue was created or deduped.
#
# Prerequisites:
#   - The app must be deployed and installed on the target site.
#   - App REST APIs must be enabled for the site in Atlassian Administration > Connected apps.
#   - A 3LO OAuth 2.0 integration must be configured in the Developer Console with the
#     write:workitem:custom scope granted for this Forge app.
#
# Run with:
#   npm run test:api:api-route
#
# .env.hurl variables (see integration/api-route/.env.hurl.example):
#   base_url   = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   project    = <Jira project key, e.g. HSP>
#   issue_type = <issue type name, e.g. Story>


# ---------------------------------------------------------------------------
# Happy path — create a new issue (dedup JQL finds no match)
#
# Uses a deliberately unique summary so the dedup JQL returns no results.
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Upsert integration test [hurl] {{uuid}}"
  },
  "dedup": "project = {{project}} AND summary = \"Upsert integration test [hurl] {{uuid}}\""
}

HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.created" == true
jsonpath "$.id" isString
jsonpath "$.key" matches /^[A-Z]+-\d+$/
jsonpath "$.self" startsWith "https://"
jsonpath "$.matches" isCollection
jsonpath "$.matches" isEmpty
jsonpath "$.warnings" isCollection


# ---------------------------------------------------------------------------
# Dedup hit — second call with same JQL returns created: false
#
# Captures the key from the previous call and uses its summary in the dedup
# JQL — any existing match causes creation to be skipped.
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Upsert dedup hit [hurl]"
  },
  "dedup": "project = {{project}} AND summary ~ \"Upsert dedup hit [hurl]\" ORDER BY created DESC"
}

HTTP 200
[Asserts]
jsonpath "$.created" == false
jsonpath "$.id" == null
jsonpath "$.key" == null
jsonpath "$.self" == null
jsonpath "$.matches" isCollection
jsonpath "$.warnings" isCollection


# ---------------------------------------------------------------------------
# 400 — missing required field: dedup
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Missing dedup"
  }
}

HTTP 400
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — empty dedup string
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Empty dedup"
  },
  "dedup": "   "
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — missing required field: project
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "Missing project" },
  "dedup": "project = {{project}}"
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — malformed JSON body
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Authorization: Bearer {{token}}
Content-Type: application/json
```
not valid json at all
```

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 401 — missing Authorization header
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "No auth" },
  "dedup": "project = {{project}}"
}

HTTP 401
# POST /workitem/asuser — outside-in integration tests
#
# Tests the raise-on-behalf-of insert endpoint.
# Identical to POST /workitem except raiseOnBehalfOf is required and
# the issue is created using api.asUser(raiseOnBehalfOf).
#
# Prerequisites:
#   - The app must be deployed and installed on the target site.
#   - App REST APIs must be enabled for the site in Atlassian Administration > Connected apps.
#   - A 3LO OAuth 2.0 integration must be configured in the Developer Console with the
#     write:workitem-as-user:custom scope granted for this Forge app.
#   - The OAuth grant must include the write:workitem-as-user:custom scope.
#
# Run with:
#   npm run test:api:api-route
#
# .env.hurl variables (see integration/api-route/.env.hurl.example):
#   base_url            = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   project             = <Jira project key, e.g. HSP>
#   issue_type          = <issue type name, e.g. Story>
#   raise_on_behalf_of  = <Jira accountId of the user to raise on behalf of>


# ---------------------------------------------------------------------------
# Happy path — create an issue on behalf of another user
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "As-user integration test [hurl]"
  },
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 201
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.id" isString
jsonpath "$.key" matches /^[A-Z]+-\d+$/
jsonpath "$.self" startsWith "https://"


# ---------------------------------------------------------------------------
# 400 — missing required field: raiseOnBehalfOf
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Missing raiseOnBehalfOf"
  }
}

HTTP 400
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.status" == 400
jsonpath "$.detail" isString
jsonpath "$.detail" contains "raiseOnBehalfOf"


# ---------------------------------------------------------------------------
# 400 — empty raiseOnBehalfOf string
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Empty raiseOnBehalfOf"
  },
  "raiseOnBehalfOf": ""
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString
jsonpath "$.detail" contains "raiseOnBehalfOf"


# ---------------------------------------------------------------------------
# 400 — missing required field: project
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Missing project"
  },
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — malformed JSON body
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
```
not valid json at all
```

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 401 — missing Authorization header
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/asuser
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "No auth" },
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 401
# POST /workitem/upsert/asuser — outside-in integration tests
#
# Tests the raise-on-behalf-of upsert endpoint.
# Combines the dedup semantics of /workitem/upsert with the
# raiseOnBehalfOf auth of /workitem/asuser.
# Both raiseOnBehalfOf and dedup are required.
#
# Prerequisites:
#   - The app must be deployed and installed on the target site.
#   - App REST APIs must be enabled for the site in Atlassian Administration > Connected apps.
#   - A 3LO OAuth 2.0 integration must be configured in the Developer Console with the
#     write:workitem-as-user:custom scope granted for this Forge app.
#   - The OAuth grant must include the write:workitem-as-user:custom scope.
#
# Run with:
#   npm run test:api:api-route
#
# .env.hurl variables (see integration/api-route/.env.hurl.example):
#   base_url            = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   project             = <Jira project key, e.g. HSP>
#   issue_type          = <issue type name, e.g. Story>
#   raise_on_behalf_of  = <Jira accountId of the user to raise on behalf of>


# ---------------------------------------------------------------------------
# Happy path — create a new issue on behalf of another user (no dedup match)
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Upsert as-user integration test [hurl] {{uuid}}"
  },
  "dedup": "project = {{project}} AND summary = \"Upsert as-user integration test [hurl] {{uuid}}\"",
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.created" == true
jsonpath "$.id" isString
jsonpath "$.key" matches /^[A-Z]+-\d+$/
jsonpath "$.self" startsWith "https://"
jsonpath "$.matches" isCollection
jsonpath "$.matches" isEmpty
jsonpath "$.warnings" isCollection


# ---------------------------------------------------------------------------
# Dedup hit — returns created: false when JQL matches existing issues
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Upsert as-user dedup hit [hurl]"
  },
  "dedup": "project = {{project}} AND summary ~ \"Upsert as-user dedup hit [hurl]\" ORDER BY created DESC",
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 200
[Asserts]
jsonpath "$.created" == false
jsonpath "$.id" == null
jsonpath "$.key" == null
jsonpath "$.self" == null
jsonpath "$.matches" isCollection
jsonpath "$.warnings" isCollection


# ---------------------------------------------------------------------------
# 400 — missing required field: raiseOnBehalfOf
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "Missing raiseOnBehalfOf" },
  "dedup": "project = {{project}}"
}

HTTP 400
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.status" == 400
jsonpath "$.detail" isString
jsonpath "$.detail" contains "raiseOnBehalfOf"


# ---------------------------------------------------------------------------
# 400 — missing required field: dedup
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "Missing dedup" },
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString
jsonpath "$.detail" contains "dedup"


# ---------------------------------------------------------------------------
# 400 — empty dedup string
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "Empty dedup" },
  "dedup": "   ",
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — missing required field: project
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "Missing project" },
  "dedup": "project = {{project}}",
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 400 — malformed JSON body
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Authorization: Bearer {{token}}
Content-Type: application/json
```
not valid json at all
```

HTTP 400
[Asserts]
jsonpath "$.status" == 400
jsonpath "$.detail" isString


# ---------------------------------------------------------------------------
# 401 — missing Authorization header
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem/upsert/asuser
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": { "Summary": "No auth" },
  "dedup": "project = {{project}}",
  "raiseOnBehalfOf": "{{raise_on_behalf_of}}"
}

HTTP 401
