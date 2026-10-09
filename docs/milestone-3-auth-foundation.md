# Milestone 3 — authenticated agent foundation

Status: design gate; no production authentication is enabled by this document.

## Existing behavior and risk

- `DevelopmentIdentityProvider` signs in as one configured Supabase test user and ignores the incoming MCP caller.
- The current HTTP server does not implement OAuth protected-resource metadata or bearer-token validation.
- Existing workspace filters, RLS and SECURITY INVOKER RPCs are valuable, but they do not establish the identity of the person connecting to ChatGPT.
- The temporary tunnel is explicitly development-only and must not be used for pilot customer data.

## Decision to validate

Keep Supabase as the business data store and user-scoped RLS authority. Prototype WorkOS Standalone Connect as the MCP-facing OAuth authorization layer, with Supabase Google sign-in upstream. This is a *candidate architecture*, not a proven integration. Do not add a hand-written OAuth authorization server.

Before implementation, verify with the actual provider configuration and current documentation:
1. OAuth authorization-code flow with S256 PKCE and ChatGPT-compatible discovery/registration.
2. RFC 8707 resource propagation and audience-bound access tokens, including refresh.
3. Verified issuer, signature, expiry, client/resource audience, revocation and key rotation.
4. Correct subject mapping to an existing Supabase Auth user, without trusting client-supplied workspace IDs, emails or headers.
5. A user-scoped Supabase session usable by existing RLS; **never** replace it with a shared service-role client.
6. Explicit verified-email pilot allowlist, checked server-side at sign-in and on protected requests as appropriate.
7. Safe login callback/session handling and no plaintext refresh tokens in logs or repository.

If Standalone Connect cannot preserve per-user Supabase RLS safely, stop and compare WorkOS AuthKit full migration or another managed MCP-compatible provider. Do not silently switch providers or weaken token validation.

## Implementation sequence after the gate passes

1. Add production authentication configuration with fail-closed startup checks; retain development mode only for loopback/testing.
2. Expose MCP protected-resource metadata and standards-compliant 401 challenges.
3. Introduce a production `IdentityProvider` that validates the MCP bearer token and maps it to a Supabase user.
4. Provision a personal workspace idempotently, bound to that authenticated user. Do not link existing development data.
5. Add an agent profile (name, optional brokerage, languages, markets) and minimal MCP tools for conversational onboarding.
6. Extend imported-conversation speaker roles (agent/client/third party) so suggested actions are from the authenticated agent's perspective.
7. Add integration tests: missing/invalid/wrong-resource/expired tokens; refresh and revocation; disallowed pilot email; two-agent workspace isolation; role-aware import.
8. Only then enable an isolated HTTPS staging MCP endpoint and test the ChatGPT Google sign-in end-to-end.

## Non-goals

Billing, brokerage teams, company-owned client migration, full CRM UI, automatic inventory scraping, and linking legacy development clients.

## Acceptance criteria

- A new allowlisted agent can connect through ChatGPT and complete Google sign-in.
- The server derives agent identity from verified auth, not from an MCP argument.
- A second agent cannot read, write or enumerate the first agent's clients.
- A new agent receives a separate workspace and can import a conversation with agent/client roles preserved.
- Existing local development tests and client-memory tools continue to work.
- No customer traffic is served through the unauthenticated development tunnel.

## Operational constraints

Do not modify Supabase Auth settings, migrations, secrets or deployments as part of the design gate. Obtain explicit approval before enabling external identity services or changing live authentication. Keep implementation in a reviewable branch and merge only after tests and security review.
