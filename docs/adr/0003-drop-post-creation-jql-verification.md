# ADR-0003: Drop Post-Creation JQL Verification on Jira Cloud

**Status:** Accepted  
**Date:** 2026-05-16

## Context

The original use case spec (derived from a Jira Data Center plugin) called for a
two-phase dedup check:

1. **Pre-creation:** Run the caller's JQL. If matches are found, skip creation.
2. **Post-creation:** Run the same JQL again. If the newly created issue does NOT
   appear in results, log a warning — indicating the caller's JQL is poorly written
   and would not have caught this issue as a duplicate in the future.

The post-creation check was designed to surface JQL quality problems to operators.

## Decision

**Drop the post-creation JQL verification entirely for Jira Cloud.**

Jira Cloud uses **eventual consistency** for its search index. A newly created issue
may not be indexed and therefore may not appear in JQL search results for several
seconds after creation. This makes the post-creation check structurally unreliable —
it will produce false negatives (warning that the JQL doesn't match) even when the
JQL is perfectly correct, simply because the index hasn't caught up yet.

The cost of making the check reliable (consistency tokens, retry loops with backoff,
waiting for index convergence) far outweighs its diagnostic value.

## Consequences

**Good:**
- No false warnings due to index lag.
- Simpler implementation — one JQL call per request instead of two.
- No retry/backoff logic needed.
- Faster response time.

**Bad / trade-offs:**
- Callers with poorly written JQL will not receive a warning that their query wouldn't
  catch future duplicates. This is documented as the caller's responsibility.
- The original Data Center behavior cannot be replicated exactly on Cloud.

## Lessons for future developers

This is a recurring pattern when migrating Data Center plugins to Jira Cloud:
**eventual consistency breaks assumptions about immediate read-your-writes consistency.**
Any feature that reads data immediately after writing it must account for index lag.
For JQL specifically, there is no free workaround — either accept eventual consistency
or pay the cost of convergence polling.

## Alternatives considered

**Use Jira's consistency token / convergence API:** Some Jira Cloud APIs support
requesting a consistent read after a write. This was evaluated but found to be
expensive (additional round-trips, latency) and not universally supported across
all JQL search paths. Rejected on cost/benefit grounds.

**Retain the check with a fixed delay:** Wait N seconds after creation before running
the post-creation JQL. Rejected because the delay is unpredictable and adds latency
to every upsert response.
