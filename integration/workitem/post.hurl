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
#   hurl --test --variables-file .env.hurl integration/workitem/post.hurl
#
# .env.hurl variables (see .env.hurl.example):
#   base_url   = https://<site>.atlassian.net/gateway/api/svc/jira/apps/<app-id>_<env-id>
#   token      = <3LO OAuth 2.0 bearer token>
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
# Happy path — create an issue with an optional update block
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project": "{{project}}",
  "issueType": "{{issue_type}}",
  "fields": {
    "Summary": "Integration test issue with update [hurl]"
  },
  "update": {
    "Labels": [{ "add": "hurl-test" }]
  }
}

HTTP 201
[Asserts]
jsonpath "$.key" matches /^[A-Z]+-\d+$/


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
jsonpath "$.error" isString


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
jsonpath "$.error" isString


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
jsonpath "$.error" isString


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
jsonpath "$.error" isString


# ---------------------------------------------------------------------------
# 400 — malformed JSON body
# ---------------------------------------------------------------------------
POST {{base_url}}/workitem
Authorization: Bearer {{token}}
Content-Type: application/json
not valid json at all

HTTP 400
[Asserts]
jsonpath "$.error" isString
