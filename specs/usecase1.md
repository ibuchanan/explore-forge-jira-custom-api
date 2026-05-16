Use Case 1: Async Issue Creation with Deduplication

A customer has a P2 plugin that reads issue creation requests from a Kafka topic, calls Jira's Java API to create the issue, and then writes a response to another Kafka topic.  This asynchronous interface provides rate limiting and failover capability while fitting nicely with other components that also operate asynchronously.

The payload is Jira's IssueUpdateBean with some extensions and tweaks.

* The fields and update maps can have custom field names as their keys.  Based on the project and issue type, we will translate the names to the expected custom field IDs.  An error response is returned if there is any ambiguity in resolving a name.
* An extra dedup element provides an optional deduplication query.  This is a JQL that is executed before creating the issue.  If the query returns any matches, creation is skipped and the response lists up to 10 matching issue keys.  The query is executed a second time after creation to ensure that the new issue matches and a warning is logged if it does not.
* An extra effectiveUser element provides an optional user ID that should be used to invoke the creation.  If absent, we will use a particular default user.  A special project role indicates which user IDs will be accepted.
* OpenTelemetry IDs are extracted from the Kafka payload and converted to Jira issue properties so the creation activity and subsequent transitions can be recorded as additional Spans in an existing Trace.

Possible implementation:

Have a Kafka listener on the customer side that receives messages, translates field names (from cached REST responses), calls Jira to create the issues, and writes the response back to Kafka.

Have a custom REST endpoint on the Cloud side that handles the dedup checks and issue creation.

Whenever creation metadata is updated, a notification should be sent that causes the customer side to update its field name translation cache.
