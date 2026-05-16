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
  "fields": { "Summary": "Missing project" },
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
not valid json at all

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
