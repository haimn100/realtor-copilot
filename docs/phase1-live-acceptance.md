# Phase 1 live verification

Verified October 7, 2026 in America/Cancun (October 8 UTC). Existing Phase 1 work
was preserved and deployed. No next-phase property-observation/event work was
implemented; its scope is in [the next-phase plan](next-phase-plan.md).

## Live state

Supabase project: `mcnhnxeayepgrstjefvg`. All 13 tables retain RLS. Phase 1 columns,
receipt/index/trigger protections, `write_client_memory` and `get_client_history`
are deployed. RPCs are SECURITY INVOKER, executable by `authenticated`, denied
to `anon`. The migration ledger contains the four original migrations plus:

| Repository SQL | Hosted ledger version/name |
| --- | --- |
| `20261008014443_phase1_client_memory.sql` | `20261008035846 / phase1_client_memory` |
| `20261008040307_phase1_conflict_http_status.sql` | `20261008040425 / phase1_conflict_http_status` |

Supabase MCP generated the hosted timestamps when applying the exact SQL bodies.
The mapping is intentional; these SQL bodies are already deployed. Any future
CLI migration-history reconciliation must use this mapping rather than apply
them again. The original Phase 1 SQL file was not rewritten after deployment.

The corrective migration changes four explicit domain conflicts from SQLSTATE
`40001` to `PT409`, preserving the two existing functions and their permissions.
The initial hosted conflict test timed out despite successful native SQL tests:
PostgREST retried application conflicts. After correction, both RPC definitions
contain two `PT409` branches and no explicit `40001` branches. This follows
[Supabase's documented PostgREST retry issue](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
The failed test cleaned up its fixtures; a follow-up activity check found no
active `write_client_memory` backend. No project restart was needed.

The compiled server runs at `http://127.0.0.1:8787/mcp` (PID 25136 at verification),
with the unchanged `.env`, user/workspace identity and configured HTTPS origin:
`https://parklike-uncriticizingly-johanne.ngrok-free.dev/mcp`.
The existing ngrok process (PID 22628), upstream and disabled inspection were
preserved. Automatic review rejected hidden background-process launch; the
server instead runs in a managed terminal session. It remains running for the
requested ChatGPT refresh. This is the existing temporary development deployment.

The eleven tools are `create_client`, `find_clients`, `get_client_context`,
`remember_client_fact`, `update_client`, `record_interaction`, `get_client_history`,
`save_property`, `get_property_context`, `update_client_property`, and
`get_client_property_history`. Fresh discovery matches every input/output contract.

## Validation evidence

| Check | Result |
| --- | --- |
| `npm test` | 24 passed; builds first; source/compiled contracts and HTTP guards |
| `npm run test:db` with PostgreSQL 17 | 24 passed; all six migrations replay; upgrade preservation, rollback, concurrency, immutability, tied-time pagination, HTTP conflict codes |
| `npm run test:live` | 31 passed after correction; actual hosted Supabase/PostgREST, disposable workspaces, client/property/security regressions |
| `npm run typecheck`, `npm run build`, `git diff --check` | Passed |
| `npm run verify:mcp`, loopback and HTTPS | Eleven tools; retained John read without writes |
| `npm run verify:phase1`, loopback | Eleven tools exercised, two independent connections, 18 history entries over six pages; conflict responses 210/209/205 ms |
| `npm run verify:phase1`, HTTPS | Same acceptance; conflict responses 346/342/335 ms |

`verify:phase1` creates UUID-labelled **SYNTHETIC** client/property fixtures on the
actual running endpoint, using the production identity and hosted database.
It verifies budget supersession (4M to 3.2M MXN), hard preconstruction exclusion,
soft area preference changes, unchanged unrelated facts, unknown/unrestricted
states, multilingual conversation, profile null clearing and before/after audit,
interaction attribution, Friday `due_date` without invented time, safe retries
including replay after later changes, prompt conflict responses, and atomic
rollback when a late second fact conflicts. It also exercises the original
property tools and independently recalls considering/liked/rejected history.
Paginated client history equals the complete bounded page, with all five entry
kinds, preserved old values/successor links and no gaps/duplicates. Transcript
content and retry payloads stay excluded from compact history.

All synthetic fixtures were removed in `finally` using their generated IDs,
workspace and unique labels; no business client was used as a write fixture.
Baseline versus final row counts and MD5 hashes of legacy business fields match
for **all 13 tables**, before migration and after all hosted tests/cleanup.
New Phase 1 columns are excluded from that comparison; timestamps and other
existing fields are included. Retained counts:

| Table | Rows |
| --- | ---: |
| workspaces / workspace_members / clients | 1 each |
| client_facts | 7 |
| properties / client_properties | 1 each |
| client_property_events | 2 |
| property_sources / interactions / tasks / research_items / search_runs / search_results | 0 each |

Retained John still has maximum budget 4.5M MXN, 2+ bedrooms, investment intent
and Coco Beach preference. Existing property relationship/history is unchanged.
The Supabase security advisor returned no new schema/RLS/RPC findings; its sole
existing Auth finding remains [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining manual ChatGPT step

The attached connector catalog in this agent session still has the original
eight tools. Fresh raw MCP clients see eleven. No ChatGPT conversational
acceptance is claimed and no plugin refresh was performed through this integration.

Open **ChatGPT → Plugins → Realtor Copilot Dev → connection details → Refresh**.
Confirm `update_client`, `record_interaction` and `get_client_history` appear
alongside the original eight, then start a **new conversation** and select
`@Realtor Copilot Dev`. Keep the existing HTTPS `/mcp` URL and authentication
configuration. This follows the [official refresh workflow](https://developers.openai.com/plugins/deploy/connect-chatgpt).

Read-only confirmation prompt: “Use Realtor Copilot Dev. Find John, read his
current context, then retrieve his client history and follow older-page cursors
as needed. Explain the current preferences and earlier budget changes. Do not
create or update any records.” Actual writes through ChatGPT remain a separate
manual acceptance exercise; server/transport acceptance above used isolated
synthetic fixtures instead of business data.

## Model/effort evidence

T3 confirms inherited model `gpt-6.1-sol` with provider `codex`. The injected
runtime declaration says HIGH, while `orchestrator_capabilities` reports
`reasoningEffort.currentValue = low` in its live model catalog. The integration
exposes no current-run model/effort setter or authoritative inference telemetry.
HIGH could not be independently verified or set here; no model substitution,
delegated task or new thread was used.
