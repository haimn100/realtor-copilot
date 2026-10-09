# Phase 1: client memory and conversation capture

Live and verified against hosted Supabase and the running HTTP/HTTPS MCP server.
The existing eight MCP tools remain registered; three tools
are added: `update_client`, `record_interaction`, and `get_client_history`.
The existing `supabase/migrations/20261008014443_phase1_client_memory.sql` and
the corrective `20261008040307_phase1_conflict_http_status.sql` are applied.
The server was rebuilt/restarted with its existing environment and tunnel.
Existing business data is unchanged. See [live evidence](phase1-live-acceptance.md)
for deployment versions, synthetic end-to-end checks and the remaining manual
ChatGPT plugin refresh. The [next-phase plan](next-phase-plan.md) is documentation only.

## Facts and compatibility

The existing category/key/value model and supersession chain remain intact.
Current context and fact-write results now expose `id`, `strength`, `valid_from`,
`recorded_at`, `created_by`, `source_type`, `source_interaction_id`, `source_ref`
and `superseded_by_id`, in addition to the previous value/confidence/importance.
History includes every recorded fact status and its successor.

| Concept | Canonical key | Value |
| --- | --- | --- |
| Budget range | `budget_min`, `budget_max` | `{ "amount": 3200000, "currency": "MXN" }` |
| Locations | `preferred_area`, `excluded_areas` | String or list of strings |
| Bedrooms | `bedrooms_min`, `bedrooms_max` | Nonnegative integer |
| Construction | `construction_status` | `completed`, `under_construction`, `preconstruction`, or a list |
| Preconstruction eligibility | `preconstruction` | `false` explicitly excludes preconstruction; `true` allows it |
| Intended use | `intended_use` | `investment`, `residence`, `vacation`, `mixed`, or client wording |
| Other desired/excluded features | `preferences`, `exclusions` | String or list of strings |

Custom snake_case keys and previously stored values still work. Reuse an
existing concept's key when changing it, even when changing its category. For
multiple areas/features use a list. No vocabulary migration rewrites old facts.

`strength` distinguishes `hard`, `soft`, and `unspecified`. New requirements and
constraints default to hard; preferences default to soft; other categories
default to unspecified unless explicitly supplied. Existing facts retain an
unspecified strength alongside their original category; no legacy intent is
silently inferred or rewritten.

`{ "state": "unknown" }` means the answer is unknown.
`{ "state": "unrestricted" }` means there is no restriction. Both are valid
even for numeric/money concepts. Boolean `false` is a known negative answer.
Null is not a fact value; a correction that removes certainty should append
an unknown value rather than erase the original record.

## Write protocol

1. Resolve the client using `find_clients`. When there are multiple candidates
   or `has_more` is true, clarify identity; never select a first match. New writes
   accept a UUID only, with no name-based auto-resolution or auto-creation.
2. Read `get_client_context` for `client.memory_version` and current fact IDs.
3. Send `expected_version` and a new `idempotency_key` with the write. The key
   identifies one logical request within this workspace/client across both new
   write tools. Reuse the same key and identical parsed arguments after an
   uncertain network result.
4. A successful response returns the current client/version, `interaction_id`,
   saved facts, follow-ups, and `replayed`. An identical retry returns the saved
   original result with `replayed: true`, even after subsequent memory changes.
   Its client version describes that original write; re-read context for the
   latest version before another operation.
5. A stale version, mismatched `expected_fact_id`, older effective information
   without explicit correction, or different payload reusing a key returns
   `CONFLICT`. Re-read context/history and reconcile the user's intended change;
   issue a revised request with a new key. Do not merely replace the expected
   version and retry an unreviewed stale payload.

`memory_version` is an opaque increasing revision, not a count of conversations.
Fact writes through the original tool also advance it. Every memory operation
locks the workspace/client row before reading or replacing facts; concurrent
first writes serialize. A no-op profile patch has a durable receipt but does
not change profile history or version.

`update_client.patch` accepts display/first/last name, email, phone, status and
notes. Omitted fields are preserved. Explicit null clears optional fields.
Display name/status cannot be null; empty patches and parent/workspace/creator
reassignments are rejected. An actual patch writes a before/after audit event
via a trigger, including patches issued directly under permitted database
privileges. A separate compact interaction receipt stores the retry request
and original response; receipt rows are excluded from activity/history to
avoid duplicate profile events. The audit event retains the supplied source
reference through its linked receipt.

`record_interaction` accepts call, meeting, message or note, the actual
`occurred_at`, a summary, optional content/channel/direction/source reference,
up to 40 distinct fact changes, and up to 20 follow-ups. It saves exactly one
interaction, attributes all included facts/tasks to it, and preserves unrelated
profile/fact fields. Fact/category replacement, successor links, tasks, revision
and the completed receipt share one transaction. Any failure rolls back all of
them, and the key remains available for a corrected retry.

Facts default `valid_from` to interaction time; an explicit effective time can
override it. `recorded_at` is the database recording time. A delayed conversation
older than a current fact cannot silently overwrite it. To intentionally
correct effective information, supply the current `expected_fact_id` alongside
the corrected fact and source explanation. The original payload/time stays
immutable and is superseded by the appended correction. `expected_fact_id: null`
means no current value may exist for that key.

The original `create_client`/`remember_client_fact` tools retain their existing
non-idempotent API. Single-fact writes now support effective time and optional
fact-ID compare-and-swap; use `record_interaction` for version-checked,
retry-safe conversation or fact capture. No extraction model, semantic search,
property crawling or automatic task delivery is introduced: the connected
agent maps the user's conversation into structured arguments.

## Acceptance request

After resolving John and reading his current version, an agent can save the
conversation in one request. The dates here use Wednesday October 7, 2026 in
America/Cancun; Friday is October 9. The UUID/version/key must come from the
actual intended client/request, rather than this example.

```json
{
  "client_id": "<resolved-client-UUID>",
  "expected_version": 4,
  "idempotency_key": "<unique-operation-key>",
  "interaction_type": "call",
  "occurred_at": "2026-10-07T13:00:00-05:00",
  "summary": "Spoke with John. He increased his budget to 3.2M MXN, no longer wants preconstruction, and requested two completed apartments on Friday.",
  "source_ref": "Phone conversation with John",
  "facts": [
    {
      "category": "requirement",
      "key": "budget_max",
      "value": { "amount": 3200000, "currency": "MXN" },
      "strength": "hard"
    },
    {
      "category": "constraint",
      "key": "preconstruction",
      "value": false,
      "strength": "hard"
    }
  ],
  "follow_ups": [
    {
      "title": "Send John two completed apartments",
    "due_date": "2026-10-09"
    }
  ]
}
```

Resolve relative dates using the user's known date/timezone; do not invent an
unknown time. A date-only deadline uses `due_date`, preserving Friday as the
user's local calendar date. Use `due_at` with an explicit offset when a time is
known. These fields are mutually exclusive. Omit both if the deadline is unknown.
Keep multilingual conversation wording; canonical keys stay stable across
English, Spanish, Hebrew and other languages.

## History and independent recall

`get_client_history` reads one database snapshot. The timeline contains client
creation, profile audit events, all fact versions, conversations, follow-up
task records and existing property relationship events. Every entry has an
ID/kind, `recorded_at`, `effective_at`, creator, source interaction/reference and
event data. Follow-up `effective_at` is its due time when known, otherwise its
creation time; date-only deadlines remain in task data as `due_date`, without
an invented timezone/time. Task data also retains its creation timestamp.
Full transcripts, request payloads and receipt
responses are omitted from history.

Default page size is 30, maximum 50. The newest page is presented in increasing
recording order. `coverage.has_more`/`next_cursor` request older pages, using
recording time, kind and UUID to prevent gaps/duplicates at tied timestamps.
Do not treat recording order as effective chronology: late conversations and
corrections carry a separate effective time. Immutable fact payloads make
historical values inspectable; successor status/IDs reflect current supersession.

In a fresh ChatGPT conversation the agent resolves John again, reads current
context, then reads history and follows older-page cursors as needed. Nothing
depends on a chat session or process-local cache. Workspace comes exclusively
from the authenticated application context; SQL is SECURITY INVOKER with
membership checks, RLS and existing composite parent FKs. Runtime users cannot
rewrite fact payloads or interaction content, delete history, or modify a
completed receipt. Incomplete receipts cannot commit.
Trusted database administrators retain Auth foreign-key maintenance and fixture
cleanup, consistent with Phase 0; the runtime is not an administrator.

## Verification and rollout

Run `npm test` for build, validation, service/repository and source/compiled MCP
contract/HTTP security checks. Run `npm run test:db` for disposable native
PostgreSQL tests (`initdb`, `pg_ctl`, `psql` on PATH or `PG_BIN`). The cluster uses
a random loopback port and a validated temporary directory; it supplies minimal
Supabase Auth/roles, applies repository migrations, tests as `authenticated`,
and is stopped/deleted after testing. It never loads `.env` or targets the
configured Supabase project.

Database coverage includes upgrade data preservation, all 13 existing tables
with RLS, empty-schema replay, atomic acceptance capture, late-failure rollback,
idempotent replay/key collisions, stale client/fact conflicts, explicit historical
corrections, unknown/false/unrestricted values, multilingual data, safe patches,
member-of-both-workspaces isolation, mixed/tied-time keyset pagination,
concurrent retries/conflicting writers, receipt/history immutability and cleanup.
The MCP integration uses the production RPC repository with only the Supabase
transport substituted by authenticated SQL into this isolated cluster; a fresh
HTTP MCP client recalls the interaction, tasks and superseded budget.

Verified: `npm run typecheck` and build pass; `npm test` passes 24 tests;
`npm run test:db` passes 24 tests including its parent migration scenario.
`git diff --check` passes.

`npm run test:live` passes 31 hosted regression tests. `npm run verify:phase1`
passes against both the running loopback endpoint and the unchanged HTTPS tunnel:
all eleven tools execute, independent recall retrieves 18 entries across six pages,
and conflict responses return promptly rather than timing out. The corrective
migration replaces application SQLSTATE `40001` with `PT409`: PostgREST can
otherwise retry domain conflicts indefinitely. RPC signatures, transactions,
idempotency and invoker permissions are preserved.

ChatGPT tool rediscovery and conversational acceptance remain manual; see the
exact [refresh instructions and evidence](phase1-live-acceptance.md).
Do not run setup/demo scripts or use retained clients to generate fixtures.
Phase 2 is outside this change.
