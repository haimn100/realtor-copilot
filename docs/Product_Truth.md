# Realtor Copilot
## Product Truth & Vision

**Version:** 1.0\
**Status:** Foundational Product Definition\
**Date:** October 2026

---

## 1. The Vision

Realtor Copilot is an AI colleague for real estate agents, starting in Playa del Carmen, Mexico.

Its purpose is to help agents understand their clients better, remember everything that matters, and make better decisions throughout the client relationship.

The product combines the conversational intelligence of ChatGPT with persistent, structured business memory.

**The central idea:**

> An AI colleague that remembers every client, understands their evolving needs, and helps move every relationship forward.

Realtor Copilot is not intended to replace the real estate agent. It exists to make a good agent dramatically more effective.

## 2. The Center of Gravity: The Client

**The client is the central entity of Realtor Copilot.**

The product is organized around understanding and serving clients, rather than managing listings, completing forms, or maintaining a traditional CRM database.

Almost everything in the system ultimately connects to a client:

- Requirements and constraints
- Preferences and dislikes
- Conversations and interactions
- Properties considered, liked, or rejected
- Decisions and their explanations
- Changes in circumstances or priorities
- Questions, concerns, and unknown information
- Follow-ups and next actions
- Relationship history

Properties, research, tasks, and market knowledge are important, but they primarily exist to support better client decisions.

The system may also retain independent property and market knowledge, which can be reused across clients.

### The most important distinction

**The product is not the client record. The product is the understanding of the client.**

A traditional CRM stores information.

Realtor Copilot should understand how that information connects, how it changes, and what it means.

For example:

A CRM knows that John has a budget of 3 million MXN.

Realtor Copilot knows that John previously had a budget of 2.5 million MXN, increased it after selling another property, and is now prioritizing completed properties near the beach.

A CRM knows that John rejected a condominium.

Realtor Copilot remembers that he rejected it because of excessive HOA fees and considers that concern when evaluating future properties.

This distinction is fundamental to the product.

## 3. The Problem We Solve

Real estate agents manage relationships containing large amounts of fragmented, evolving information.

Important details are distributed across:

- WhatsApp conversations
- Phone calls
- Property viewings
- Emails
- Personal notes
- Spreadsheets
- CRM systems
- The agent's own memory

Information gets lost, becomes outdated, or is difficult to retrieve when needed.

Agents repeatedly reconstruct client requirements, forget earlier objections, miss follow-ups, and spend time searching through conversations.

The fundamental problem is not simply the absence of organized data.

**It is the absence of accessible, reliable, evolving business memory.**

## 4. The Product Experience

ChatGPT is the primary interface.

Agents interact with Realtor Copilot through natural conversation, in Spanish, English, or other languages.

They should not need to learn database structures, field names, or specialized commands.

Examples:

**Remembering**

"What are we looking for for John?"

"What did John tell me during our last conversation?"

"Why did John reject the Marbella apartment?"

**Finding**

"Find the client who wanted a two-bedroom investment property near Coco Beach."

"Which clients are interested in completed apartments under 3 million pesos?"

**Updating**

"John no longer wants preconstruction."

"I spoke with Maria. Her budget increased to 4 million, but she now needs two parking spaces."

**Taking action**

"Who should I follow up with today?"

"Which clients are waiting for information from me?"

**Reasoning**

"I found this property. Which of my clients might be interested?"

"What concerns should I raise before recommending this apartment to John?"

The assistant should retrieve existing knowledge, reason about it, ask for clarification when necessary, and persist meaningful changes.

The experience should feel like talking to a knowledgeable colleague who has been involved in the business for years.

## 5. Client Memory Is the Core Capability

Client memory must be:

**Persistent**

Information survives individual ChatGPT conversations, sessions, and devices.

**Structured**

Important facts have recognizable meaning, types, and relationships. A budget is not merely a sentence buried in a note.

**Historical**

New information does not silently erase the past. The system can explain what changed, when, and why.

**Contextual**

A statement about one property is not automatically a general client preference.

**Attributed**

The system can distinguish information supplied by the agent, reported by the client, inferred by AI, or obtained from external sources.

**Uncertainty-aware**

Unknown information must remain unknown. An inference must not become a confirmed fact.

**Safe to update**

Changing one requirement must not overwrite unrelated information. Ambiguous client identities or conflicting updates require clarification.

**Multilingual**

The language used to store information should not determine whether it can be retrieved.

## 6. Intelligent Retrieval Is a Defining Experience

Agents should be able to find clients without remembering their names.

They may remember a conversation, requirement, objection, location, or property instead.

For example:

"Who was the investor who wanted something near Coco Beach but was worried about maintenance fees?"

The system should retrieve plausible clients, explain the evidence, and distinguish ambiguous matches.

Retrieval must consider both structured information and relevant narrative history.

It must also distinguish current requirements from superseded ones.

**Finding the right client through natural description is a primary product capability, not an optional search enhancement.**

## 7. Conversation Is the Workflow

Realtor Copilot should not force agents into a predefined CRM workflow.

An agent can naturally describe what happened:

"I spoke with John today. He increased his budget, no longer wants preconstruction, and asked me to send him two options by Friday."

The system should understand that this represents:

- An interaction with John
- A change in budget
- A change in construction requirements
- A follow-up obligation
- An event in the relationship history

These changes should be saved reliably and coherently.

The agent should not need to perform five separate manual operations.

At the same time, the system must not invent missing details or silently modify unrelated facts.

## 8. Follow-ups and Relationship Continuity

Client memory becomes more valuable when it helps the agent act.

Realtor Copilot should understand:

- When meaningful contact last occurred
- What the agent promised
- What the client is waiting for
- What information is still missing
- Which relationships have become inactive
- Which actions are overdue

The objective is not to build a sophisticated task-management application.

It is to help agents maintain relationship continuity and prevent opportunities from being lost.

## 9. Properties Serve the Client Relationship

Realtor Copilot is not primarily a property portal or inventory management system.

Properties matter because agents evaluate them for clients.

The system should remember which properties were considered, sent, viewed, liked, or rejected, and why.

It should help compare property characteristics with current client requirements.

Hard constraints should be distinguished from soft preferences, and missing information should be clearly identified.

External property searches can be performed through ChatGPT and available tools.

However, search results are research candidates, not guaranteed complete or current inventory.

Availability, source freshness, and verification status must not be invented.

## 10. Playa del Carmen Knowledge

The initial market is Playa del Carmen.

Over time, Realtor Copilot should accumulate useful knowledge about:

- Neighborhoods and location trade-offs
- Developments and developers
- Local prices and market conditions
- Buying considerations
- Rental and investment characteristics
- Common risks and recurring client concerns

This knowledge should improve client recommendations.

It should be grounded in research, reliable sources, and agent experience.

Market knowledge is a supporting intelligence layer, not the center of the product.

## 11. What Makes Realtor Copilot Different

The differentiation is not simply that a CRM has AI.

ChatGPT already provides strong language understanding, reasoning, and general research capabilities.

Realtor Copilot should concentrate on what ChatGPT alone cannot reliably maintain:

**Persistent business context.**

Its distinctive value comes from combining:

1. Long-term client memory
2. Reliable structured knowledge
3. Relationship history and provenance
4. Intelligent retrieval
5. Context-aware actions
6. Specialized local real estate knowledge

The product should make ChatGPT meaningfully more capable in the context of an agent's actual business.

## 12. V1 Priorities

| Priority | Area | Weight |
|---|---|---:|
| 1 | Client memory | 35% |
| 2 | Intelligent client retrieval | 25% |
| 3 | Conversational management | 20% |
| 4 | Follow-ups | 15% |
| 5 | Property matching | 5% |

These percentages represent current product emphasis, not fixed engineering budgets.

### Explicitly outside V1

- A comprehensive property inventory
- Large-scale property crawling
- A traditional CRM dashboard
- A standalone mobile application
- Complex workflow automation
- Multi-agent orchestration
- Advanced analytics and reporting

These may become useful later, but none defines the initial product.

## 13. Product Development Philosophy

We do not yet know the ideal daily workflow of a Playa del Carmen real estate agent.

We should not invent an elaborate workflow and force agents to adopt it.

Instead, we will provide useful capabilities and observe real behavior.

We need to learn:

- What agents repeatedly do manually
- What information they struggle to find
- Where important context gets lost
- What causes missed opportunities
- Which activities consume disproportionate time
- What agents already handle effectively without software

Actual agent behavior should guide product evolution.

The goal is to discover valuable workflows, not assume them.

## 14. Current Implementation Direction

The current technical foundation uses ChatGPT, MCP tools, and persistent storage in Supabase/PostgreSQL.

The architecture separates conversational intelligence from durable business memory.

Existing foundations include client entities, structured facts, history, workspace boundaries, property relationships, and transactional persistence.

The initial implementation has demonstrated basic persistent client recall.

However, the product experience described in this document is not yet fully implemented.

The most important remaining capabilities include:

- Descriptive and multilingual client retrieval
- Complete conversation and interaction capture
- Reliable multi-fact updates
- Accessible history and provenance
- Follow-up management
- Safe ambiguity and conflict handling
- Production-ready identity and tenant isolation

The existing architecture should be extended where practical rather than replaced.

Implementation milestones, database schemas, and MCP tool contracts belong in separate technical documents.

**This document defines product intent, not implementation status or a technical specification.**

## 15. The Product Decision Test

Every proposed feature should answer at least one of these questions:

1. Does it improve our understanding of the client?
2. Does it help retrieve important client knowledge?
3. Does it save the agent meaningful time?
4. Does it prevent lost opportunities or forgotten commitments?
5. Does it improve client service or decision-making?
6. Does it help the agent close more business?

If a feature does none of these, it probably does not belong in the product.

## 16. Long-Term Direction

Realtor Copilot may eventually become the persistent intelligence layer over a real estate agent's business.

Future integrations could allow the assistant to learn from WhatsApp, email, calendars, property research, and other authorized business sources.

It could proactively identify important changes, recommend next actions, and connect clients with opportunities.

These are possible directions to validate, not promises or requirements for V1.

The fundamental concept should remain unchanged:

**Client understanding is the center of gravity.**

---

## North Star

> Every client has a story. Realtor Copilot remembers that story, understands how it evolves, and helps the agent decide what to do next.

**We are not building a CRM that agents have to maintain. We are building an AI colleague that maintains the context agents need to do their jobs exceptionally well.**
