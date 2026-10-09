# One-time Haim / Isabel history import — preview and audit

Status on 8 October 2026: **blocked on the original WhatsApp export**. No live
Supabase connection or writes were made for this task. John's demo data was not
touched. The original source is needed before a real reviewed manifest, final
entity counts, or executable real-data import can be prepared.

The supplied `realtor_copilot_whatsapp_extraction.md` is accessible. It explicitly
describes itself as a draft review aid. The original text export or ZIP is absent
from the repository and the attachment directory. The preparation workflow
rejects the review aid as an import source.

## Provisional structured preview

The local artifact is `artifacts/whatsapp-history/preliminary-preview.json`.
It contains each review table row, its original cells and extraction-file line
reference. These are references to the **review document**, not WhatsApp message
references. The directory is gitignored; source chats, reviewed manifests and
generated SQL should also stay there or in another private local directory.

| Review-aid group | Rows found | Meaning |
| --- | ---: | --- |
| Client fact candidates | 19 | Requirements, budgets, preferences and negotiation-specific observations; not 19 current facts |
| Property discussion rows | 30 | Includes repeated developments, unnamed candidates and multi-property batches; not 30 distinct properties |
| Business interaction rows | 10 | Overlaps the other tables; not 10 independently verified events |
| Proposed client profiles | 1 | A dedicated Haim profile, resolved by an import marker rather than name |
| Proposed open tasks | 0 | No historical item is automatically made overdue |
| Verified entities / events | 0 / 0 | Authoritative export unavailable |

These counts cannot be added to produce a distinct event total. The final
counts will be computed from the source-checked manifest after message-to-event
and property identity review.

Provisional review priorities, all drawn from the aid and **not independently
confirmed**:

- Preserve the May 2024 USD 165,000 ceiling as historical. Keep June's literal
  `150 usd` ambiguous rather than inventing USD 150,000.
- September 2026 MXN 2.8M is the latest general budget reported by the aid.
  October's MXN 2.7M is a property-specific negotiation target; it does not
  supersede the general budget or establish a submitted/accepted offer.
- Treat the 60m²/windows/view/terrace criteria as Isabel's reported understanding
  until buyer evidence supports them. Older preferences are dated claims;
  latest known does not mean reconfirmed today.
- Do not merge Marsella and Marbella without contextual evidence. Confirm which
  ANAH references are the same unit, and separate building identity from units.
- A shared ANAH/L Condos URL and multiple links followed by a group rejection
  cannot reliably establish individual property identities/decisions.
- Distinguish planned, likely and explicitly completed visits. Marbella pickup
  coordination alone does not establish inspection conclusions. Coco Beach's
  Saturday discussion does not establish a completed or confirmed appointment.
- Preserve historical prices, discounts, promotions, closing-cost estimates,
  delivery dates and title questions as dated reports. None establishes current
  price, availability, financing terms, ownership or legal readiness.
- Keep Marbella inventory/HOA/title/cash-price questions and Coco Beach offer
  feasibility as historical unanswered/proposed follow-ups; establish continued
  relevance before creating any active task.

## Existing implementation audit and mapping

All six repository migrations, the thirteen-table schema, both application
services/repositories, all eleven MCP contracts, documentation and offline/local
database tests were inspected. Existing uncommitted Phase 1 work was retained.

| Import information | Existing representation | Handling |
| --- | --- | --- |
| Dedicated buyer identity | `clients`, `create_client_with_facts` | Haim only, no phone/email/personal context; atomic import-marker resolution |
| Selected current requirements | `client_facts`, `write_client_memory` | Exact buyer citations; one selected latest explicit value per key |
| Historical/inferred/reported requirements | Dated `interactions` with structured metadata | Typed historical fact, evidence classification and citation; never becomes current automatically |
| Business conversation, negotiations and follow-up history | `interactions`, `write_client_memory` | Original occurrence time, compact business summary, checksum/line source references |
| Identified candidate | `properties`, `save_property` | Reviewed details only; location explicitly supplied; no canonical price or availability verification |
| Historical asking-price reports | `property_sources`, `save_property` | Separate reported snapshots, currency, historical report date in source name, unknown availability/update time |
| Client's latest recorded relationship | `client_properties` | Explicit supported status only; actual historical sent/viewed times when supported |
| Dated decisions/discussions | `client_property_events` | Permitted append-only inserts with occurrence time, interaction link, evidence and source metadata |
| Ambiguous/group decisions | Dated interaction | No speculative individual-property link/status |
| Completed/cancelled/planned/unknown follow-ups | Interaction/event narrative | Zero tasks; task lifecycle API is outside this one-time import |

No migration, new MCP tool, external listing lookup, generic connector, model API
or production deployment is proposed. The work adds a local preparation script
and tests using existing schema/RPCs.

## Representational limits and deliberate tradeoffs

The relationship RPC cannot accept a historical occurrence time or provenance;
its trigger timestamps events at write time and would misdate the import.
The one-time generated transaction instead inserts the final relationship with
historical sent/viewed times, then appends the actual dated events directly under
existing authenticated grants and RLS. The existing trigger remains enabled and
creates one **clearly labelled import-time snapshot** per relationship. It is an
import snapshot, not another visit, decision or original message.

There is no historical-only fact status: database guards require facts to start
current, and every supersession chain must end in a current fact. Unselected
historical facts therefore use separate dated interaction notes whose metadata
contains the typed historical fact, evidence classification and parent interaction
ID. They remain in `get_client_history`; summaries label them `historical_only`.
They never enter current fact groups. This preserves old observations without
asserting that they remain applicable or fabricating a supersession chain.

Only selected business excerpts are stored: interaction `content` contains
reviewed citations, and historical fact/property-event metadata also contains
their short literal evidence. The existing history tool exposes that metadata
but intentionally omits interaction content. Current fact summaries and dated
business summaries remain retrievable with exact checksum/line references.

Property sources are listing identities/snapshots, not a typed observation
timeline. The POC preserves source-reported prices separately from the null
canonical asking price and repeats important reported details in dated event
summaries. Source `accessed_at` records import access to the WhatsApp evidence;
it never means the website was fetched. Missing listing update dates remain null.
Other reported/disputed details should remain narrative rather than become
unqualified canonical attributes. A complete typed observation system is already
proposed in `docs/next-phase-plan.md`; this task does not implement that expansion.

Dedicated property history drops arbitrary metadata and clips notes to 500
characters; its full provenance is available through paginated client history's
property-event metadata and linked interactions. Context limits (12 properties,
8 property events, 8 interactions) are insufficient for an exhaustive answer.
`get_client_history` and `get_client_property_history` must be paginated. Mixed
client history pages by recording time and carries effective time separately;
reconstruct chronology using effective time, not import recording time.

This importer creates dedicated canonical candidates and never automatically
merges into John's saved demo properties or existing name matches. The reviewed
manifest must resolve repeated export identities/URLs; cross-CRM identity merges
are a separate review. It refuses changed manifests after a completed import,
instead of trying to amend or reimport an existing real client automatically.

The current development tunnel has unauthenticated public access, documented in
README. Before an approved real-data import, use the intended private workspace
and close that tunnel; source minimization does not provide authentication.

## Local preparation workflow

`scripts/prepare-whatsapp-import.ts` has no apply mode, database client, credential
loading or network access. It creates new local files and refuses to overwrite
an existing preview/SQL file. Preliminary and authoritative modes are distinct.

```powershell
npx tsx scripts/prepare-whatsapp-import.ts --preliminary <extraction.md> --output <private-preview.json>

# After receiving and reviewing the actual original export:
npx tsx scripts/prepare-whatsapp-import.ts --source <original.txt> --manifest <reviewed-manifest.json> --output <reviewed-preview.json> --workspace <approved-workspace-uuid> --sql <reviewed-import.sql>
```

Manifest format is defined by `historyManifestSchema` in
`src/import/whatsapp-history.ts`. `tests/fixtures/whatsapp-history.ts` provides a
complete **synthetic** example, not extracted real data. A real manifest requires:

- `source.kind: original_whatsapp_export`, SHA-256 of exact original bytes,
  explicitly chosen day/month ordering, confirmed source UTC offset and buyer
  speaker label. ZIPs must first be unpacked locally; this POC accepts text.
- A business-only, source-verified review with reviewer and export/review cutoff.
- Exact message-start line, speaker and a short literal excerpt for each event,
  fact and property. Full raw transcript and omitted media are never imported.
- Each event's timestamp matching a cited message, preserving that message's
  timezone. Multi-day discussion must be split into dated events.
- Explicit separation between buyer statements, agent reports and inference;
  only buyer-supported explicit statements may be selected current.
- One stable key per property/event/source; reviewed relationships and no
  speculative metadata. Historical prices belong to separate source records.
- No current value older than a later explicit statement for the same key;
  ambiguous numeric shorthand remains a narrative question.

Checks establish byte/quote/time correspondence, not semantic truth. The source
review must still determine what statements mean, which property a response
concerns, whether a visit happened, and which latest facts remain applicable.

The SQL artifact wraps the entire batch in one authenticated transaction,
checks workspace membership, serializes imports with an advisory lock, resolves
the dedicated profile by an exact marker, and records a manifest-digest completion
receipt with the existing memory RPC. Identical repeats are no-ops; conflicting
manifests fail. Interrupted/failed imports roll back every inserted row. It uses
no elevated bypass or trigger disabling. Execution after explicit approval
requires an operator session whose `auth.uid()` is the intended workspace member;
do not execute as an unscoped service-role import.

There is **no real reviewed manifest or import SQL yet** because the original
source is missing. No approval for live writes is being requested at this stage.

## Retrieval acceptance after an approved import

Resolve Haim using `find_clients` and the import marker in profile context.
Use `get_client_context` for latest selected statements as of the export, and
paginate `get_client_history` for budget/requirement changes, negotiations and
business follow-ups. Resolve each saved candidate with `get_property_context`,
then paginate `get_client_property_history` for dated presentations/reactions.

For Marbella, retrieve its dated questions, reports, visit evidence and offer
target; clearly distinguish unknown title/availability and unaccepted terms.
For rejected/interesting properties, cite explicit reactions and preserve group
ambiguity. Report last known **client relationship** separately from currently
unverified **listing availability**. If the export never establishes a completed
visit, outcome, current price or current requirement, the answer must say so.

## Validation

Tests use synthetic messages exclusively. They cover parsing, date-order choices,
invalid dates, multiline messages, source checksums, quote/speaker/date matching,
duplicate keys, stale current selections, inferred/agent-only current facts,
uncited URLs, unknown availability, canonical-price exclusion, SQL quoting and
the absence of an apply CLI option.

The disposable native PostgreSQL suite exercises the generated SQL using the
actual migrations, existing RPCs, authenticated role and RLS. It checks replay
and concurrency without duplicates, historical ordering and provenance,
current/historical fact separation, historical prices, uncompleted viewings,
zero open tasks, existing retrieval services/output contracts and pagination,
manifest conflicts, workspace denial, whole-batch rollback and unchanged John
fixtures. It never connects to configured/live Supabase. Real export parsing and
ChatGPT retrieval remain blocked/pending until that source is supplied and the
approved import occurs.

Completed local results: `npm test` **30/30 passed** (including build),
`npm run test:db` **29/29 passed** (including five new import database checks),
and `npm run typecheck` passed. The existing MCP discovery/contract tests remain
green. No live tests, demo scripts, provisioning, migrations or imports were run
against Supabase.
