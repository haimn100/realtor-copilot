# Simple ChatGPT-led conversation import

For the reviewed fact-row fix, retry backfill and exact live before/after counts,
see [Imported fact persistence acceptance](imported-facts-fix.md).

ChatGPT reads the user's WhatsApp TXT attachment itself, including large files
within ChatGPT's own attachment limits. MCP receives **only compact findings**.
No source upload, private staging table, source chunks, coverage proof, sessions,
resume protocol, or finalization is used. Partial initial extraction is acceptable.

The server has thirteen tools: the eleven existing memory tools plus
`get_client_import_guidance` and `import_client_findings`. The former is optional;
it returns extraction guidelines and the exact write schema. Each write persists
immediately. The earlier source staging/upload task is canceled; no original
WhatsApp file was staged during that task.

## Exact ChatGPT workflow

1. Upload the original TXT to **ChatGPT**, not this server or a local CLI.
2. Ask ChatGPT to optionally call `get_client_import_guidance({})`, read the
   attachment and extract compact business findings. Do not send the transcript.
3. Explicitly choose a NEW target name, such as `חיים2` or `Haim2`. The source
   speaker can still be Haim. No identity quote proving that test alias is needed.
   Check the basic client entity first: a display name is essential. If neither
   the source client name nor an explicit target alias is available, ask for the
   missing name **before creating**. Do not invent identity. Phone/email are
   optional; show them as unknown if absent.
4. Call `import_client_findings` with one stable `import_key` for that new client
   and a unique `batch_key` for each results batch. Maximum: 40 findings and
   48,000 UTF-8 bytes per call. Send another results batch if needed; batches do
   not correspond to source chunks and no completion/coverage claim is required.
5. Retry an uncertain write with **identical arguments and the same keys**.
   Repeated finding keys with identical content are skipped across batches;
   changed evidence requires a new correction key, not overwriting history.
6. Recall the new client with `find_clients` and `get_client_history`, paginating
   for full findings, dates, quotes and uncertainties. There is no finalize call.
7. Present a **compact, concise organized summary of imported client data**:
   client card, dated budgets, requirements, preferences, dislikes, properties,
   negotiations/offers, interactions/viewings, proposed follow-ups and limitations
   wherever present, consolidating related evidence to minimize screen space.
   Label historical evidence and separately confirmed-current knowledge.
   Avoid raw JSON, transcript dumps and a count-only receipt.
   Once identity is sufficient and the client exists, show **no verification or
   confirmation button** and do not ask approval for the completed import.
   End with **one prominent, evidence-based primary recommendation and two
   unobtrusive alternatives**, using small text options/real links or plain text.
   Choose them from recency, lifecycle/possible inactivity, data volume versus
   quality, requirement currentness, last request, blockers, open promises and
   deal stage. Explain the primary briefly with relevant evidence; do not use
   generic fixed CTAs or assume an old client is ready for a search.
   Creating tasks or promoting historical facts still requires explicit approval.

Paste this prompt after attaching the export:

> Read the attached WhatsApp conversation yourself. Optionally get Realtor Copilot
> import guidance, then persist useful compact findings with import_client_findings.
> Create a NEW client named חיים2; the source speaker is Haim and the original Haim
> must remain unchanged. Use import_key haim2-whatsapp-acceptance and batch keys
> batch-1, batch-2, etc. Keep dated budgets/preferences, agent reports, historical
> offers, client reactions, tentative/completed viewings, ambiguous groups and
> proposed actions distinct. Preserve short literal quotes, dates and uncertainty
> where available. Do not guess missing amounts, units or timezone offsets.
> Historical claims must not become current facts or active tasks. Missing some
> findings is acceptable; state your limitations. Send only structured findings,
> never the raw file. After writing, retrieve persisted history in a fresh chat.
> Show a compact organized summary, labelled historical versus confirmed-current.
> Recommend one evidence-based primary next action with two small secondary
> alternatives; do not show a verification button for the already created client.

Minimal dated example (quotes/dates here are illustrative, not real extraction):

```json
{
  "import_key": "haim2-whatsapp-acceptance",
  "batch_key": "batch-1",
  "target_display_name": "חיים2",
  "source": {"kind": "whatsapp_txt", "name": "Isabel/Haim WhatsApp export"},
  "findings": [{
    "key": "budget_may_2024",
    "kind": "fact",
    "summary": "Historical client budget; current applicability unconfirmed.",
    "evidence": "explicit",
    "occurred_at": "2024-05-25T10:00:00-05:00",
    "source_speaker": "Haim",
    "source_quote": "Budget USD 165000.",
    "fact": {
      "category": "requirement",
      "key": "budget_max",
      "value": {"amount": 165000, "currency": "USD"}
    }
  }],
  "limitations": ["Partial AI extraction; source evidence not independently verified."]
}
```

If only a date/range is known, omit `occurred_at` and supply `source_date`,
e.g. `"May 2024"`. Never invent midnight/timezone. **Every kind=fact finding**
also creates a typed `client_facts` row with `applicability=historical`.
Date-only/undated facts have NULL `source_at` and `valid_from`; real ingestion
time remains in `created_at`/`recorded_at`. The literal `source_date`,
`source_quote`, evidence and confidence are retained on the fact. The source
interaction and stable import/finding reference link to the full receipt,
including speaker, summary, uncertainty and details. Revision `status=current`
means the assertion has not been superseded; it does not activate a historical
fact. Current verified facts, including budgets with the same key, are preserved.

An identical retry of a pre-fix batch safely projects only missing fact rows from
its existing receipt. It neither creates another interaction nor changes the
original request, metadata or audit response. The retry result reports the now
persisted historical-fact count. Repeated finding keys are still deduplicated
across batches; changed evidence conflicts and needs a new correction key.
Ambiguous budgets use `{state:"unknown"}` with the literal quote. The server
validates typed structure; it cannot prove that an AI supplied amount/currency
was supported by the transcript.

## Concise response acceptance example

For a synthetic extraction containing a named client, an old USD budget, a
one-bedroom preference, a dislike of noisy streets, a Marbella discussion/offer
and a tentative viewing, the successful response could be:

> **Client:** Haim2; phone/email not supplied. **Historical budget:** USD 165,000
> in May 2024; current budget unknown. **Requirements/preferences:** one bedroom.
> **Dislikes:** noisy streets. **Property/negotiation:** Marbella discussed;
> MXN 2.7M offer, acceptance and availability unverified. **Interaction/follow-up:**
> tentative viewing, no confirmed appointment. **Limitations:** media omitted;
> these findings have not been confirmed as current.
>
> **Recommended: Draft a follow-up on Marbella's offer and viewing** — the latest
> exchange left both unresolved.
>
> Other options: analyze Marbella's fit · inspect the historical budget timeline.

Pass only if the summary is compact and organized, historical/current distinctions
are clear, exactly one prominent primary action and two small alternatives are
chosen from the evidence, and there is no verification/confirmation button.
For a stale conversation with unclear client activity, prefer a relevant
re-engagement draft over assuming an active deal/search. For a recent unresolved
property question, prioritize that question over generic property searching.
If the name/target alias is missing, the
response asks for the name before any import write. These are ChatGPT response
requirements; MCP supplies instructions and data, not a new UI or tool.

The 29-finding persistence regression uses 19 facts, 6 property discussions,
2 interactions and 2 proposed actions. It expects 19 historical facts, one
receipt, no tasks and no unresolved property links; identical/concurrent retries
must preserve those counts. A verified current budget on the imported client
must survive subsequent imports unchanged. Original Haim is never targeted.

Other finding kinds: `property_discussion`, `interaction`, `proposed_action`.
Use compact `details` for links, multiple units, asking prices, offer status or
viewing outcomes; `uncertainty` for unresolved interpretation. Optional resolved
`property_id` attaches a dated property discussion to existing saved property
history; the importer never creates canonical properties or changes current
relationship status. Unresolved/shared-link properties remain narrative.
No active tasks are created. Email/transcript findings use the same schema.

## Identity and persistence

The write tool deliberately creates a NEW client. It never accepts an arbitrary
existing `client_id` or resolves the source speaker to original Haim. Later batches
resolve only the client owned by that `import_key`; target name cannot change.
An exact existing target-name collision is refused, rather than modifying that
client. Similar names such as Haim and Haim2 are allowed. A new import_key cannot
create another client with the same exact selected name; reuse its original key
for more results, or explicitly select a different new name.

The existing thirteen public business tables/RPCs store findings, historical
facts, property history and idempotency receipts. Each batch is atomic. Failed
batches roll back client creation, facts and receipt; earlier successful batches
remain. Workspace scope comes from the existing authenticated server context.
Quotes and semantic classification are supplied by ChatGPT and cannot be
independently verified without the source. There is no exhaustive-import claim.

## Development deployment

Migration `20261009122654_simple_ai_client_import.sql` retires the old public
import RPC and drops the private staging schema. It retains business clients and
their already-imported history, and adds the compact invoker RPC. Earlier applied
migration files remain for reproducible ledger replay. The old upload CLI and
three MCP tools are removed. No authentication changes were made.

Applied to development project `mcnhnxeayepgrstjefvg` on October 9, 2026, with
hosted ledger version `20261009123651` / name `simple_ai_client_import` (ten
applied migrations). Verified thirteen public tables, the new invoker RPC,
absence of the old RPC/private staging schema, and an unchanged hash of original
Haim's client, facts, interactions, tasks, relationships and property events.

The existing development endpoint is:
`https://parklike-uncriticizingly-johanne.ngrok-free.dev/mcp`.

Refresh/reconnect the ChatGPT connector and confirm thirteen discovered tools,
including `get_client_import_guidance` and `import_client_findings`; the three
old staging tools should be absent. The existing development tunnel/identity
setup is unchanged.

The compiled server was started with the existing `.env` and tunnel origin. If it
stops, run this from `C:\code\realtor-copilot` while the existing ngrok tunnel
continues running:

```powershell
$env:DEV_TUNNEL_URL='https://parklike-uncriticizingly-johanne.ngrok-free.dev'
node dist/src/index.js
```

After source changes, run `npm run build` before starting it. Fresh SDK discovery
was verified against both localhost and the public endpoint; the ChatGPT UI must
still reconnect/refresh its connector to discard cached old tool definitions.
The actual ChatGPT attachment-analysis acceptance remains a user-run test.

Validation covers explicit Hebrew/Latin target aliases, original Haim preservation,
partial/date-only evidence, historical-only facts, zero tasks, atomic rollback,
workspace scope, retries, bounded payloads and fresh source/compiled MCP discovery.

Results: `npm run typecheck`, `npm test` (build plus 33 offline tests), and
`npm run test:db` (36 PostgreSQL integration/regression checks) passed. A targeted
live MCP smoke test passed through the public tunnel: synthetic source speaker
Haim with a distinct Hebrew target alias, dated/date-only findings, historical-only
context, zero tasks, identical retries, a second compact batch, finding deduplication
and recall after a fresh connection. Its isolated synthetic client was removed.
No real source was uploaded, staged or semantically extracted by Codex.

Implementation files for this simplification: `src/import/client-import.ts`,
`src/mcp/server.ts`, `src/mcp/tool-contracts.ts`, `src/data/database.types.ts`,
`supabase/migrations/20261009122654_simple_ai_client_import.sql`,
`tests/client-import.test.ts`, `tests/database/generic-import-checks.ts`,
`tests/database/migrations.test.ts`, `tests/mcp-contracts.test.ts`,
`tests/http-security.test.ts`, `README.md`, and this document. Obsolete
`scripts/upload-client-import.ts` and `tests/fixtures/client-import.ts` were removed.
The local live smoke artifact is `artifacts/verify-simple-import.mts`.
