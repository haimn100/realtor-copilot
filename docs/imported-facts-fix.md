# Imported fact persistence: review and live acceptance

Applied October 9, 2026 to Supabase project `mcnhnxeayepgrstjefvg` after
SQL/security review, offline tests and disposable PostgreSQL migration tests.
The compiled MCP server was rebuilt and restarted on port 8787; fresh local and
public Streamable HTTP connections passed discovery, writes and recall.
Applied migrations: `persist_imported_historical_facts` and the reviewed
`imported_fact_confidence_precision` retry correction.

## Fix and historical semantics

The previous importer persisted fact rows only when `occurred_at` was present.
The real batch used literal source dates, so its 19 typed facts were saved only
among 29 receipt findings. The new migration projects every `kind=fact` entry
into `public.client_facts`, preserving the interaction audit receipt.

Imported applicability is always `historical`. Revision `status=current` means
the assertion is not superseded; active searches continue to require
`applicability=confirmed_current`. Historical assertions never overwrite current
verified facts, even when they share `budget_max` or another typed key.
Unknown source/effective instants remain NULL in `source_at`/`valid_from`.
Real recording time stays in `created_at`; no midnight, timezone or source time
is invented. Current/legacy non-historical facts still require an effective time.

Rows retain typed category/key/value, literal source_date/source_quote, evidence,
confidence, source_interaction_id and a stable import/finding source_ref.
Speaker, uncertainty, summary, details and source label remain in the immutable
linked receipt. Exact retries use the same projection, including old receipts,
and add only missing rows. A source identity index and client lock protect
against duplicate/concurrent writes. A changed batch/finding payload conflicts.

No source staging, chunks, finalize flow or additional MCP tools were introduced.
SQL functions remain security invoker, workspace member scoped and unavailable
to anonymous callers. The security advisor reported no new findings; its prior
[Auth password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains outside this change.

## Exact live before/after

| Client | Facts before → after | Interactions before → after | Property links before → after | Tasks before → after |
|---|---:|---:|---:|---:|
| Original Haim | 24 → 24 | 360 → 360 | 7 → 7 | 0 → 0 |
| חיים2 | 0 → 19 | 1 → 1 | 0 → 0 | 0 → 0 |

The 29 findings comprise 19 facts, 6 property discussions, 2 interactions and
2 proposed actions. All 19 resulting rows are historical, have literal dates,
quotes and evidence, have NULL source/effective instants, and reference the
original receipt. Confirmed-current fact count is zero. All 19 source references
are distinct. The original receipt continues to hold all 29 findings.

The backfill used an exact replay of the request already saved in the receipt,
through the freshly connected public MCP endpoint. No source re-extraction or
new import keys were needed. Concurrent identical retries were no-ops. Another
fresh connection retrieved all 19 facts through context and history.

Original Haim's client, fact payloads, interactions, property links and task
hashes matched before/after. Its original fact-payload MD5 remained
`3c8fb77493fe3975188028c78b70524b` (excluding the two additive NULL columns).
The imported receipt's full-row MD5 remained
`8d0c9992457c370aa8522f001e84e801`. Its original audit response still records the
pre-fix zero fact count; the retry response accurately reports 19 persisted facts.
The imported client's memory version advances once for the backfill.

## Tests and product acceptance

`npm test`: 35 passing tests, including source/compiled MCP contract checks.
`npm run test:db`: 38 passing PostgreSQL checks, including schema upgrade/replay,
29 findings, dated/date-only/undated facts, ambiguous money, atomic rollback,
retry/backfill/concurrency, existing verified budgets and original-client safety.
`npm run typecheck` and `git diff --check` passed.
Live verification artifacts: `artifacts/verify-fact-import-fix.mts`,
`artifacts/fact-import-before.json`, `artifacts/fact-import-verification.json`.

The final import guidance requires essential identity before creation, then a
compact organized summary, one prominent evidence-based recommendation and two
small alternatives chosen from recency, lifecycle/inactivity, data quality,
requirement currentness, latest request, blockers, promises and deal stage.
There is no verification button for an already-created client. The concise
acceptance example is in `docs/client-conversation-import.md`.

## Limits

Confidence on fact rows uses existing three-decimal storage precision; the
receipt retains the full supplied value. Projection normalizes to that precision
before writes/retries, including confidence with more than three decimals.

The backend validates typed structure, not semantic truth or exhaustive extraction.
An ambiguous amount must be extracted as `{state:"unknown"}`; the server cannot
prove that a supplied money amount/currency matches a short quote. Existing AI
interpretations in this batch were retained as historical evidence, without
activating budgets. Unresolved property discussions remain in receipt history;
canonical property links require resolved IDs and known source instants.

ChatGPT must generate the actual summary/action choices. Tests verify the supplied
guidance and MCP data; they do not execute a ChatGPT UI conversation. A ChatGPT
connector that cached old guidance/contracts must reconnect before that manual
acceptance check. Previously persisted dated fact rows remain immutable; their
new date/evidence columns stay NULL, with full evidence available in their receipts.
