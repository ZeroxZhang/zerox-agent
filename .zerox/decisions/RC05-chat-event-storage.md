# RC05 Decision: Append-Only Chat Storage And Incremental Projections

Status: Accepted

Date: 2026-08-14

## Context

The current Chat store keeps every session and every message in one
`chat-sessions.json`. Every message, activity event, usage update, goal link,
rename, archive, and restore serializes the complete history. Sidebar listing
and message search scan the complete in-memory history.

The existing generic SQLite `sessions` and `chat_messages` tables are
insufficient as the production Chat source:

- `sessions.payload` contains the entire historical Chat record;
- there is no Chat event sequence or projection watermark;
- archive, usage, activity, context, workspace, and Goal mutations are not
  represented as facts;
- deletion has no tombstone;
- list reads cannot be versioned independently from full transcript reads.

## Decision

Add three Chat-specific SQLite structures:

1. `chat_session_events`
   - append-only facts;
   - unique `(session_id, seq)`;
   - event id, type, payload, timestamp.
2. `chat_session_projections`
   - one small metadata projection per live session;
   - no message array;
   - projection version and event watermark;
   - denormalized fields for list ordering and counts;
   - payload contains only `Omit<ChatSessionRecord, "messages">`.
3. existing `chat_messages`
   - one immutable message row per message;
   - full message payload;
   - indexed by session and creation order.

Mutation transactions append the event, update the projection, and insert or
delete message rows atomically.

## Event Vocabulary

- `session_imported`
- `message_appended`
- `session_renamed`
- `session_archived`
- `session_restored`
- `token_usage_added`
- `activity_appended`
- `goal_attached`
- `active_goal_cleared`
- `session_deleted`

Event payloads are bounded facts, not full transcript snapshots. Import is the
only snapshot-shaped event and exists solely to establish legacy provenance.

## Projection Contract

Projection version 1 contains:

- title and summary;
- workspace identity and summary;
- active/historical Goal summaries;
- bounded activity and context snapshots;
- archive timestamp;
- cumulative token usage;
- message count and last assistant timestamp;
- created/updated timestamps;
- event watermark.

`list()` reads only projections. `get(sessionId)` joins one projection with only
that session's ordered messages. `searchMessages()` reads message rows and
projection titles without loading session payloads.

Projection updates are pure functions over the prior projection and one event.
The repository persists their output transactionally. A future projection
version can rebuild from the event log plus message table.

## Production Cutover

Chat storage is SQLite-authoritative independently of the legacy global
`ZEROX_STORAGE_BACKEND` default.

At first Chat access:

1. open/migrate `zerox.db`;
2. if the Chat projection table is empty and legacy JSON exists, read it through
   the existing normalization/recovery logic;
3. import all sessions in one transaction;
4. read every imported session from SQLite and compare canonical values;
5. fail without marking bootstrap complete if parity differs.

The legacy JSON file is not rewritten after cutover. It remains a read-only
recovery source. New installs do not create it.

If SQLite cannot be opened, the container may use the legacy JSON store for
availability, but it must log the explicit degradation. A working SQLite store
never silently falls back after migration or parity failure.

## Idempotency And Concurrency

- all mutations are serialized by the public async store;
- repository sequence allocation and projection update occur in one
  `BEGIN IMMEDIATE` transaction;
- message ids are caller-generated and primary-key idempotent;
- attachment retry detection reads only the final message of one session;
- import is idempotent by session/message/event keys;
- delete appends a tombstone before removing the live projection and messages.

## Search

RC05 preserves the existing deterministic token scoring and result shape.
It removes the full transcript load but does not introduce FTS ranking changes.
FTS can be added later with a separately calibrated migration.

## Compatibility

- `ChatSessionStore` async interface and all return shapes stay unchanged.
- Existing JSON tests remain as compatibility tests.
- A new SQLite suite runs the same behavioral contract.
- Existing IDs, timestamps, exact Markdown content, attachment metadata,
  guided-input payload recovery, activity cap, Goal semantics, ordering, and
  search scores remain unchanged.
- The generic `SessionRepository` remains available to other domains; Chat no
  longer treats its full payload as authoritative.

## Rollback

`rollback-sqlite-to-json.mjs --confirmSqliteAuthoritative` exports projections
joined with messages into a new `chat-sessions.json`, first freezing any
existing JSON as a legacy backup.

No automatic runtime downgrade overwrites JSON. Rollback is an explicit
operator action after SQLite verification.

## Verification

1. JSON/SQLite behavioral parity across every store operation.
2. Legacy import and corrupt-file recovery.
3. SQLite-to-JSON export round trip.
4. Concurrent mutation ordering and event sequence monotonicity.
5. Projection watermark/version checks.
6. Long-history test proving:
   - append inserts one message/event and updates one projection;
   - sidebar list does not read message payloads;
   - one-session get does not scan other sessions.
7. Full repository verification and production smoke.

## Deferred Work

- FTS-backed Chat search.
- compressed event chunks.
- projection checkpoint compaction.
- cross-device sync.
- replay-safe model context surface (RC06).
