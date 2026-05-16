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
#   - The caller's OAuth token must have the write:workitem-as-user:custom scope.
#
# Run with:
#   npm run test:api
#
# .env.hurl variables (see integration/.env.hurl.example):
#   base_url            = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   token               = <3LO OAuth 2.0 bearer token with write:workitem-as-user:custom scope>
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
not valid json at all

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
