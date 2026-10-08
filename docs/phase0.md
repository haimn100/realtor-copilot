# Phase 0 verification

This is the historical implementation report. The user has since verified all
eight tools and persistence in ChatGPT. See [Phase 0 acceptance follow-up](phase0-acceptance.md)
for the committed-baseline verification procedure and remaining isolated live-test gap.

Phase 0 changes are implemented and the hardening migration is applied to
Supabase project `mcnhnxeayepgrstjefvg`. Local MCP discovery and database tests
pass. The public ChatGPT connection still needs the manual restart and refresh
below; the entire Phase 0 acceptance checklist is therefore not yet complete.
No Phase 1 features were added.

## MCP mismatch and compatibility

The four-tool listener was PID 3736, running `node dist/src/index.js`, created
at 18:21 on October 7, 2026 (local time). Eight-tool source was modified at
18:36 and its compiled file at 18:44. Fresh MCP discovery against that listener
still returned four tools even though the on-disk source and build registered
eight. The process had loaded the earlier build before the property tools were
added. This evidence identifies the running process as the cause.

The old local listener was stopped and the rebuilt server was started locally.
`prestart` now builds before startup. `pretest` also builds so automated tests
compare the source server and compiled production HTTP factory. Tool contracts
describe all eight existing input/output shapes; names, inputs, response data
and handlers remain compatible. Tests detect missing tools or changed schemas
and exercise every handler, including property-name ambiguity. The read-only
`npm run verify:mcp` verifies the selected live endpoint's tool set and schemas.

The local endpoint exposes:

1. `create_client`
2. `find_clients`
3. `get_client_context`
4. `remember_client_fact`
5. `save_property`
6. `get_property_context`
7. `update_client_property`
8. `get_client_property_history`

Automatic review blocked restarting the local server with the public tunnel
origin enabled. It is running with local-only Host validation. No external
service or tunnel was restarted. The public endpoint and ChatGPT rediscovery
are not claimed as verified.

## Migration history and security

The original `20261007204914_initial_realtor_copilot_schema.sql` was recovered
from the live ledger's SQL statements, rather than reconstructed from guessed
table definitions. The existing client and property migrations follow it.

The approved hardening migration was submitted as
`20261008000114_phase0_security.sql`. Supabase recorded the applied migration
as version `20261008001058`; the repository file was renamed to
`20261008001058_phase0_security.sql` to match the live ledger. Its SQL was not
changed by this rename. All four repository migration versions match live.

The hardening migration:

- Revokes broad table privileges, including TRUNCATE and DELETE, from anonymous
  and authenticated users. Authenticated reads remain governed by RLS. Only
  existing legitimate inserts and necessary update columns are granted.
- Makes fact payload, identifiers, attribution, provenance and timestamps
  immutable for runtime users. Completed historical facts cannot be rewritten.
  The existing invoker RPC can still supersede a fact transactionally. A deferred
  guard rejects incomplete or cyclic supersession at commit.
- Uses composite foreign keys to require parent/child workspace agreement
  throughout the application schema. Fact sources must also belong to the same
  client; successor facts must use the same client and key. Task assignees must
  belong to their workspace.
- Retains existing RLS and SECURITY INVOKER RPCs, transaction rollback and
  administrator fixture cleanup. Superuser/BYPASSRLS maintenance remains trusted;
  tenant foreign keys still constrain administrator writes.

Constraints validated existing rows; the migration performed no business-row
updates or deletes. Before/after counts and whole-row digests matched for all
11 business tables: one retained client, seven facts, and no existing property
or other activity rows. Mutation tests used disposable workspaces or a separate
temporary PostgreSQL cluster.

## Verification results

| Check | Result |
| --- | --- |
| Offline regressions and HTTP/schema contracts | 19/19 passed |
| TypeScript typecheck | Passed |
| Production build | Passed |
| Native migration/security/workflow suite | 7/7 passed |
| Live Supabase client/property/security regressions | 31/31 passed |
| Local running endpoint discovery and persisted John recall | Passed; all eight tools and schemas |
| Existing business data comparison | Unchanged across all 11 business tables |
| Live migration history | Matches all four repository versions |
| Public tunnel discovery and actual ChatGPT refresh | Pending manual verification |

Initial test harness and fixture failures were corrected before these passing
runs. The native test replays migrations both as an upgrade with fixture data
and into an empty application schema. It models Supabase's Auth/role prerequisites
with a small shim; a full local Supabase Docker stack was not tested.

Reproduce checks from the repository root:

```powershell
npm ci
npm test
npm run typecheck
npm run build
$env:PG_BIN = 'C:\Program Files\PostgreSQL\17\bin' # or use PATH
npm run test:db
npm run test:live # existing .env and authenticated Supabase CLI required
npm run verify:mcp # running local server; read-only
```

## Manual verification in ChatGPT

Use the existing development workspace and retained John. Do not rerun `demo`
or `setup:dev`. Follow the temporary tunnel restrictions in the README.

1. Stop the current local server with Ctrl+C in its terminal. If there is no
   terminal, identify only the listener on port 8787 and verify its command line
   before stopping that process. Do not restart Supabase or ngrok.
2. Copy the existing tunnel's HTTPS origin forwarding to `127.0.0.1:8787`.
   In PowerShell, set `$env:DEV_TUNNEL_URL = '<actual HTTPS origin>'` (without
   `/mcp`) and run `npm start`. This rebuilds before startup.
3. In a second terminal, set `$env:MCP_URL = '<same HTTPS origin>/mcp'` and run
   `npm run verify:mcp`. Require all eight tool contracts and retained John recall
   to pass before continuing.
4. In ChatGPT, open **Plugins**, open **Realtor Copilot Dev**, and select
   **Refresh**. Check the discovered tools against the eight names above.
5. Start a new conversation, select the plugin with `@`, and ask: "Use
   find_clients to find John, then get_client_context. What are we looking for
   for John? Do not create a client or update facts." Expect investment intent,
   2+ bedrooms, Coco Beach and a current maximum budget of 4.5M MXN. Clarify
   duplicate names before selecting a client.
6. Inspect the calls and confirm persisted memory. Stop the temporary tunnel
   after testing and clear `DEV_TUNNEL_URL`/`MCP_URL` as described in the README.

The Refresh/new-conversation procedure follows
[OpenAI's connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
Checking the discovered write-tool names requires no mutation of retained data;
write workflows were already exercised with isolated fixtures.

## Remaining limitations

The fixed development identity maps every caller to one configured user and
workspace. Public tunnel access has no caller authentication. This remains a
blocker for production and multi-user pilots; Phase 0 adds no new authentication
architecture. Workspace members retain the existing shared-member permissions;
per-agent authorization is not introduced.

Supabase's security advisor still reports the existing leaked-password-protection
Auth warning. Auth configuration was unchanged. New application tables require
an explicit privilege/RLS review rather than inheriting these existing-table
grants automatically.

An early failed native test left a stopped temporary directory at
`C:\Users\haimn\AppData\Local\Temp\realtor-copilot-phase0-1HkwJU`.
Its PostgreSQL process was stopped and its port is no longer listening. Automatic
review blocked deletion of that exact directory; subsequent test clusters
cleaned up successfully. The review returned only a policy-block message for
this deletion and public-origin startup, without a more specific reason.
