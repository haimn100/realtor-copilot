# Next phase: preserve property evidence behind client decisions

Plan only; no schema or tools in this document are implemented. This follows the
completed `[ChatGPT] Audit Schema Against Magic Answers` thread
`thread:project:8c7ebbaa-b547-4108-8173-39c07da01ce8:a5d69dc1-ddd7-4333-9bff-f4e04b8960d2`.

Deliver one story: John saw a property at **4.1M MXN**, liked its location,
and rejected **6,200 MXN/month HOA**. A later source reports **3.65M MXN**.
Retrieve the original presentation, reactions and later price evidence so the
agent can explain reconsideration while preserving the unresolved HOA objection.

## Minimum schema

1. Add one append-only `property_observations` table: `id`, `workspace_id`,
   `property_id`, `attribute`, typed `value_json`, optional `property_source_id`,
   `source_ref` (including speaker/provider when known), optional `interaction_id`,
   `observed_at`, optional `valid_from`, `recorded_at`, `created_by`, and optional
   `corrects_observation_id`. Require a source row or a meaningful source reference.
   Money uses `{amount,currency}`; HOA also includes `period:"month"`. Distinguish
   `asking_price` from `quoted_price`; location and other attributes use bounded
   strings/lists or explicit unknown states. Never treat unknown as false/zero.
   Recording time is database-generated; observation/effective time needs an
   explicit offset. Corrections append and reference prior evidence. Conflicting
   sources coexist; a newer record does not automatically invalidate another source.
2. Extend existing `client_property_events`, reusing `occurred_at`, `created_at`,
   `interaction_id` and `metadata`. Define bounded typed metadata:
   `reactions` (attribute, `liked|disliked|concern|neutral`, reason and optional
   observation reference), `presented_evidence` (attribute, observation ID and/or
   immutable presented value/source snapshot), and `source_ref`. Capture actual
   occurrence time independently of recording time. Keep price/currency and HOA
   amount/period presented to John even when canonical details change later.
   Legacy events retain their existing data; label legacy automatic timestamps
   rather than pretending they were user-reported occurrence times.
3. Retain `properties`, `property_sources`, `client_properties`, interactions and
   both existing history paths. Sources remain listing identities: repeated
   observations reuse the same source instead of inserting duplicate listing rows.
   Add only `properties.asking_price_observation_id` if the observation writer
   explicitly promotes a price to the canonical snapshot. Promotion must update
   price/currency/pointer atomically; all later `save_property` price edits must
   append evidence too. Existing prices have unknown historical provenance and
   must not be backfilled with invented observation dates.

Use workspace-aware property/source/interaction/observation references, invoker
RPCs, RLS, and runtime append-only guards consistent with Phase 1. Validate that
event evidence belongs to the same property and workspace; an interaction used
for a client event must belong to that client. No replacement decision-history table.

## Minimum tools and implementation order

1. `record_property_observations`: bounded batch (up to 40), explicit property and
   sources/times, idempotency receipt, optional explicit canonical-price promotion.
   Store corrections without rewriting evidence. Use non-retrying domain conflicts.
2. `record_client_property_event`: explicit occurrence, optional interaction,
   typed reactions and presented evidence, plus optional supported relationship
   transition. Append a distinct viewing/feedback occurrence even if status is
   unchanged. Event, current relationship and receipt share one transaction;
   adapt the existing relationship trigger/RPC so each operation emits one event.
   Keep `update_client_property` backward compatible and its no-op semantics.
3. `get_property_history`: all observations for one property, with source identity,
   times and corrections; default 30, maximum 50, older-page cursor and optional
   attribute/source filters. Hydrate evidence source references even when property
   context's six-source limit is exceeded. Expose canonical creation time and the
   explicitly selected current price separately from raw claims.
4. Enrich `get_client_property_history` and `get_client_history` with the typed event
   payload and decision evidence. Page by recording time plus ID (plus kind for
   mixed history), carrying actual occurrence time separately. Preserve existing
   cursors through a documented compatibility path. First-page coverage includes
   a fixed recording high-water mark reused by cursors: page through the whole
   selected evidence set without late insertions causing omissions or duplicates.
   Return `has_more`, `next_cursor` and snapshot/filter coverage; compact context
   truncation never establishes absence or an exhaustive count.

Implement observation capture first, then event capture, then both retrieval
paths and the integrated story. Complete bounded retrieval here means complete
property/decision evidence for the selected client and property. Cross-client
candidate discovery, research browsing and broad inventory comparisons are separate work.

## Acceptance checks

- Capture a source-attributed asking price of 4,100,000 MXN and HOA of
  6,200 MXN/month. Record John's actual viewing time, positive location reaction,
  HOA objection/rejection and references to the presented evidence.
- Later append 3,650,000 MXN from the same identified source and explicitly select
  it as current price. The old price, HOA evidence and reactions remain unchanged.
  A fresh MCP connection retrieves them all and explains the 450,000 MXN reduction
  (about 11%) as a reason to reconsider while HOA remains unresolved. Do not assert
  that HOA changed, that he now accepts it, or that it was his only objection.
- More than 50 observations/events, tied timestamps, backdated occurrences and
  concurrent inserts paginate without gaps/duplicates within the stated snapshot.
  Repeated unchanged-status viewings survive. Conflicting HOA claims from two
  sources remain distinguishable; exact evidence referenced by a decision survives
  later corrections and current-price edits.
- Retries create no duplicates; stale requests, cross-property/cross-workspace
  references and invalid late batch items fail atomically. Runtime evidence edits
  and deletes are denied. Existing eleven tools and histories remain compatible.

Reconsideration, implicit preferences, thresholds and rankings remain computed
at query time from retrieved evidence. Defer dedup/entity resolution, source
reliability scoring, building identity, broad market analytics, task lifecycle,
property-only communications and automated ingestion to later focused work.
