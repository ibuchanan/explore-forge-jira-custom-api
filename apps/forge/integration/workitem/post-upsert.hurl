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
#   npm run test:api
#
# .env.hurl variables (see integration/.env.hurl.example):
#   base_url   = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   token      = <3LO OAuth 2.0 bearer token>
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
not valid json at all

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
