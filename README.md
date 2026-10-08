# Realtor Copilot

TypeScript MCP server for persistent real-estate client and property memory in the existing
Supabase project `mcnhnxeayepgrstjefvg`. No frontend or model API key is required.
Uses the official MCP SDK v2 and stateless Streamable HTTP at `/mcp`.

## Local setup

Requires Node.js 22+ and Supabase. A fresh Supabase project can create the
application schema using all four files in `supabase/migrations`, in filename
order: initial schema, client memory, property memory, then Phase 0 security.
The original initial migration was recovered from the live migration ledger.
Supabase supplies the Auth schema and database roles; migrations supply all
13 application tables, policies, RPCs and guards. All four migrations are already
applied to project `mcnhnxeayepgrstjefvg`. Do not replay the initial migration or
reset that project. See [Phase 0 verification](docs/phase0.md) for evidence,
security changes and the remaining manual ChatGPT check.

```sh
npm ci
# Uses your authenticated Supabase CLI account to provision a dedicated test
# user/workspace and write credentials to gitignored .env. Keeps existing config.
npm run setup:dev
npm run build
npm start
```

Alternatively create a gitignored `.env` and fill in a modern publishable key,
confirmed Supabase test-user email/password, and a workspace UUID where that user
is a member. Workspace provisioning is an administrative setup operation.
`SUPABASE_PROJECT_ID` / `SUPABASE_PROJECT_SECRET` alone are not runtime login
configuration; the required runtime variable names and isolated live-test setup
are in [Phase 0 acceptance](docs/phase0-acceptance.md).

Endpoint: `http://127.0.0.1:8787/mcp`. Health: `/health`. `npm run dev` watches
source files. In a second terminal:

```sh
npm run demo
```

The Milestone 1 demo calls the four client tools over HTTP. It creates John with investment intent,
2+ bedrooms, a 4M MXN budget and Coco Beach preference; reads his context; changes
the budget to 4.5M; and reads context again. It retains John in Supabase and prints
his ID. Each demo run creates a new client.

## Tools and memory

| Tool | Input | Result |
| --- | --- | --- |
| `create_client` | `display_name`, optional identity/status/notes and `facts` | Client identity and initial fact count |
| `find_clients` | `name`, optional `status` / `limit` | Concise identity matches and `has_more` |
| `get_client_context` | `client_id` | Current facts grouped by category plus bounded activity |
| `remember_client_fact` | `client_id`, `fact` | New current fact |
| `save_property` | New `title` and known details, optional `source`; or existing `property_id` and changes/source | Concise canonical property and saved source |
| `get_property_context` | Exactly one of `property_id` or `name` | Details, sources/verification, associated clients, recent events and existing research; ambiguous names return choices |
| `update_client_property` | `client_id`, `property_id`, optional `status`, `interest_level`, `notes`, `rejection_reason` | Current relationship; every meaningful change appends an event atomically |
| `get_client_property_history` | `client_id`, `property_id`, optional `limit` / `cursor` | Current state and chronological timeline page with an older-page cursor |

Name lookup checks display, first and last names case-insensitively; wildcard
characters and quotes in the supplied name are treated literally.

A fact has `category`, a stable snake_case `key`, and a typed `value`.
Categories match the existing database: `requirement`, `preference`, `dislike`,
`context`, `constraint`, `other`. Optional confidence, importance and source
interaction/reference support provenance. Budget values require explicit units:

```json
{
  "client_id": "<John's UUID>",
  "fact": {
    "category": "requirement",
    "key": "budget_max",
    "value": { "amount": 4500000, "currency": "MXN" }
  }
}
```

Supersession is by workspace/client/key, including category changes. Use a list
for multiple preferred areas. Replacement serializes concurrent writes, marks
the previous value `superseded`, inserts the current value and sets the previous
row's `superseded_by_id`, in one database transaction. A partial unique index
enforces one current fact per key. Creation and initial facts are also atomic.
Repeated writes create new history; write tools are not idempotent.

Context includes identity/status/notes, current requirements/preferences/dislikes/
context/constraints, property status/details/rejection/viewing information, recent
interaction summaries, open tasks and recent client-linked search summaries.
Limits are 60 current facts, 12 properties, 8 property events, 8 interactions,
12 tasks and 5 searches. The existing `properties` array keeps status, notes,
rejection reasons and viewing information; `recent_property_events` adds earlier
reactions without loading full timelines. Use the dedicated history tool for
more detail or older history.
It reports truncated sections, clips long activity text, omits transcripts and
historical search criteria, and excludes superseded/disputed/retracted facts.
Searches are read from existing rows; no new search functionality is implemented.

## Property memory and client/property history (Milestone 2)

Save only meaningful properties the realtor explicitly asks to save/keep.
No automatic property persistence or web search is implemented. A canonical
property is distinct from its listing sources. Reuse a saved `property_id` with
`save_property` to amend known details or add another source without creating
another canonical property. No URL is fetched by these tools.

Canonical details support title, property type, development, address/neighborhood,
city/state/country, bedrooms/bathrooms, interior/exterior/total square meters,
asking price/currency, construction status, delivery date and notes. New saves
require a meaningful title; prices require explicit three-letter currency.

A source supports `source_name`, `url`, `external_id`, `listing_price`, `currency`,
`listing_updated_at`, `accessed_at`, `availability_status`,
`availability_verified`, and `availability_verified_at`. `listing_price` maps
to the existing source's `asking_price`, independently of canonical price.
Unknown listing update times stay null; access defaults to the save time.
Access never verifies availability. A reported `available` listing remains
unverified unless actual verification is explicitly confirmed. When confirmed,
the verification time defaults to save time if none was supplied; it is never
copied from access/update time. Source verification does not rewrite canonical
availability. Read both the status and its verification fields when answering.

Relationship states are `discovered`, `considering`, `sent`, `interested`,
`liked`, `rejected`, `viewing_scheduled`, `viewed`, `offer_considered`,
`offer_made`, and `closed`. Interest is `low`, `medium`, `high`, or null.
Omitted patch fields retain their values; explicit null clears optional fields.
A first link without a status starts `discovered`. `sent_at`/`viewed_at` are
recorded on the corresponding transition. No-op patches add no event.
Notes-only or interest/reason changes append a `relationship_updated` event.
Each event preserves its state, previous state, interest, notes and rejection
reason. Events cannot be edited or deleted by the authenticated runtime user.
Concurrent updates serialize, including the first link. The relationship write
and its AFTER-trigger event insertion share a transaction; either failure rolls
back both. Property/source saves are also atomic, including detail amendments.

Property context limits sources to 6, associated clients to 12, events to 12,
and existing research summaries to 5. Raw listing snapshots, research findings
and transcripts are excluded. History defaults to the latest 30 events (maximum
50), returned in chronological order. `coverage.has_more` and `next_cursor`
allow older pages; the cursor uses time plus event ID to handle tied timestamps.
Current state is always returned independently of the selected history page.
No association returns null current state and an empty timeline.

### ChatGPT milestone test

Restart the existing server with the new build and rediscover tools in the
existing ChatGPT connection. The server must advertise eight tools. Use the
retained John:

1. “Save this property: Marbella Residence unit 104, 2BR, 3.8M MXN, Coco Beach.”
2. “Keep it for John; mark it considering.”
3. “John likes the location.”
4. “John rejected it because the HOA is too high.”
5. In a new conversation with Realtor Copilot, ask “What happened with the
   Marbella property for John?”

The last conversation should use `find_clients`, then `get_property_context`
with `name: "Marbella"` (or the ID from John's context), then
`get_client_property_history` with the resolved client/property IDs. Ambiguous
names return choices and must be clarified before writes. Expect persisted
`considering → liked → rejected`, a prior note about the location, and the
rejection reason `HOA too high`. A sent step appears only if it was recorded.

`tests/live/property-memory.test.ts` verifies this flow through the actual MCP
HTTP transport and an independent new MCP connection, with disposable data.
It does not create a Marbella relationship for the retained John. The actual
ChatGPT conversation remains a manual acceptance test.

## Architecture and identity

- `src/mcp`: eight validated business tools and MCP response formatting.
- `src/application`: typed service/repository contracts and context construction.
- `src/data`: workspace-scoped Supabase repository and generated database types.
- `src/infrastructure`: validated environment, identity adapter, HTTP transport.
- `scripts`: explicit development provisioning and HTTP demo.

`IdentityProvider` supplies authenticated `ApplicationContext` before the service
is constructed. A repository is bound to that workspace; no MCP parameter or
request header selects it. All reads include workspace filters, including
property detail lookups. Writes use `SECURITY INVOKER` RPCs with membership checks
and RLS. The migration adds only the necessary client/fact write policies, RPCs
and uniqueness constraint to the existing schema. Milestone 2 adds property
write policies, atomic save/relationship RPCs and an event trigger. Parent
ownership is checked; runtime users cannot reassign workspaces or relationship
parent IDs, or edit/delete history.

The local identity provider signs in as a real Supabase user and checks workspace
membership. The runtime uses a publishable key and user session, so RLS stays
active. Development provisioning/live fixtures use an admin key retrieved into
memory by the already-authenticated Supabase CLI. That key is never saved to
runtime configuration, logged or returned through MCP.

Development mode binds only to loopback, validates Host/Origin and refuses
`NODE_ENV=production`. Local-only access remains the default. An explicit
`DEV_TUNNEL_URL` enables the temporary HTTPS development workflow below; it does
not change `DevelopmentIdentityProvider`, the configured Supabase user/workspace,
MCP inputs, or RLS. The current slice does not implement OAuth. Production will
require verified OAuth identity and server-side workspace resolution.
See [official SDK](https://ts.sdk.modelcontextprotocol.io/v2/) and
[OpenAI MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).

## Temporary ChatGPT dogfood connection over HTTPS

**This is public, unauthenticated development access, not production-ready.**
Anyone who reaches the URL can use all eight tools to read or write development
data as the fixed development Supabase user. Host/Origin validation is not
authentication. Use only the intended development data, keep the URL private,
and **stop the tunnel immediately after testing; never leave it exposed**.
No Supabase credentials, workspace header, API key, or OAuth credentials are
entered in ChatGPT. Do not use a service-role key for the runtime.

Use the existing `.env` and retained John. Do not rerun `setup:dev` or `demo` for
this check: the demo creates a new John on every run. Keep
`NODE_ENV=development`, `AUTH_MODE=development`, `HOST=127.0.0.1`, and `PORT=8787`.

### 1. Start the existing server (PowerShell, terminal A)

```powershell
Set-Location C:\code\realtor-copilot
npm ci
npm run build
npm start
```

The local endpoint is `http://127.0.0.1:8787/mcp`. Keep terminal A open.
If it is already running, use that process until the restart in step 3.

### 2. Start ngrok (terminal B)

Install the [ngrok agent](https://ngrok.com/download/windows) if needed:

```powershell
winget install --id Ngrok.Ngrok --exact
```

ngrok requires an account and a locally configured agent authtoken. If it is not
already configured, follow the private setup instructions in your
[ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken).
Store the token only in ngrok's local config; do not add it to this repository,
`.env.example`, command transcripts shared with others, or ChatGPT.

```powershell
Set-Location C:\code\realtor-copilot
npm run tunnel:dev
# Equivalent: ngrok http http://127.0.0.1:8787 --inspect=false
```

Keep terminal B open. Copy the **HTTPS** forwarding origin displayed by ngrok,
for example `https://your-temporary-domain.ngrok-free.dev`. Request inspection is
disabled to avoid retaining client payloads in the local traffic inspector.
Use the direct HTTP upstream above so ngrok preserves the public Host header;
do not configure Host rewriting, browser login, or Basic Auth for this test.

The running agent's local API can also show its HTTPS origin (terminal C):

```powershell
$tunnelOrigin = (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels |
  Where-Object { $_.public_url -like 'https://*' } |
  Select-Object -First 1 -ExpandProperty public_url
$tunnelOrigin
"$tunnelOrigin/mcp"
```

If you run multiple tunnels, select the entry forwarding to port 8787 rather
than using the first entry. The `/mcp` URL is the URL to copy into ChatGPT.

### 3. Allow this exact origin and restart the server (terminal A)

Press Ctrl+C in terminal A, then set the origin you just copied and restart:

```powershell
$env:DEV_TUNNEL_URL = 'https://your-temporary-domain.ngrok-free.dev'
npm start
```

Use the actual domain, **without `/mcp`**. This shell variable takes precedence
over `.env`; you do not need to edit generated credentials. The startup warning
prints the public `/mcp` URL. Source development also works with `npm run dev`.
If ngrok changes domains, repeat this step and update the ChatGPT connection.

The server still binds only to loopback. It allows loopback Host values plus
only the configured tunnel hostname, with no wildcard ngrok domains. Requests
without Origin are accepted for server-to-server MCP clients; a supplied Origin
must be an existing loopback origin or exactly the configured HTTPS origin
(including scheme/port). Other origins remain blocked. Forwarded Host/Proto and
workspace headers are not trusted. The 64 KiB request limit, request timeouts,
fixed identity membership checks, publishable key/user session, and RLS remain.
`DEV_TUNNEL_URL` is rejected outside `NODE_ENV=development`.

### 4. Verify the public Streamable HTTP path (terminal C)

```powershell
$env:MCP_URL = "$tunnelOrigin/mcp"
npm run verify:mcp
```

Or set `MCP_URL` directly to the copied HTTPS `/mcp` URL. This command performs
MCP initialization, discovers exactly eight tools, calls `find_clients` for John,
and calls `get_client_context`. It verifies the persisted current max budget
4.5M MXN, 2+ bedrooms, investment intent, and Coco Beach preference without
writing data. With no `MCP_URL`, it checks the local endpoint. If John is
ambiguous, use an ID printed by `find_clients`:

```powershell
$env:MCP_CLIENT_ID = '<intended John UUID>'
npm run verify:mcp
```

Opening `/mcp` in a browser returns **405**, intentionally: the stateless
Streamable HTTP endpoint accepts POST and does not provide a standalone GET SSE
stream. This does not mean discovery is broken. A 403 from the server usually
means `DEV_TUNNEL_URL` does not match the active domain or Origin. An ngrok error
or HTML page means the tunnel, upstream, or gateway must be checked; do not
remove the server's validation or add custom request headers in ChatGPT.

### 5. Connect in ChatGPT and ask about John

The [official custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
supports Streamable HTTP and **No authentication**. Workspace permissions and
security restrictions may control whether the creation option is available.
The current [plugin quickstart](https://developers.openai.com/plugins/quickstart)
uses this workflow:

1. Open ChatGPT on the web and go to **Plugins**.
2. Select **+**, then **Add custom MCP server** (some screens say
   **Create custom MCP server**).
3. Name it **Realtor Copilot Dev**. Under **Connection**, use **Server URL** and
   paste the public HTTPS URL ending in `/mcp`.
4. Select **No authentication**. Review the warning and select
   **I understand and want to continue**, then **Create as a plugin**.
5. Find it in your personal plugins and install it with the **+** button.
6. Return home, choose **Work**, start a new chat, type `@`, and select
   **Realtor Copilot Dev**. Ask: **“What are we looking for for John?”**
7. Inspect the tool calls: ChatGPT should use `find_clients` with `name: "John"`,
   then `get_client_context` with the returned ID. Expect investment intent,
   2+ bedrooms, Coco Beach, and a current maximum budget of **4.5M MXN**.
   If it asks which John, select the existing client ID from step 4.

If tool selection needs a more explicit prompt, use: “Use Realtor Copilot Dev.
Find John with find_clients, then read get_client_context. What are we looking
for for John? Do not create a client or update facts.” This is a personal test
connection; do not publish it to the plugin directory or share it with others.

### 6. Shut it down immediately

Press **Ctrl+C in terminal B** to stop ngrok first, then **Ctrl+C in terminal A**
to stop the server. Disable/remove the temporary plugin in ChatGPT. Clear the
temporary shell variables:

```powershell
# Terminal A
Remove-Item Env:DEV_TUNNEL_URL -ErrorAction SilentlyContinue
# Terminal C
Remove-Item Env:MCP_URL, Env:MCP_CLIENT_ID -ErrorAction SilentlyContinue
```

A later `npm start` without `DEV_TUNNEL_URL` returns to local-only Host/Origin
policy. An ngrok-assigned domain may be reused on another run; its obscurity is
not an access control. Always stop the agent when the test ends.

## Verification

```sh
npm test            # Offline context and validation regressions
npm run typecheck
npm run build
npm run test:db     # Disposable native PostgreSQL migration/security suite
npm run verify:mcp  # Read-only check of retained John; set MCP_URL for HTTPS
npm run test:live   # Real Supabase + SDK HTTP client; requires .env and CLI login
```

`npm start` and `npm test` rebuild first. Discovery tests compare the source and
compiled HTTP servers with all eight registered input/output contracts.
`verify:mcp` also checks these contracts against the selected running endpoint.
For `test:db`, install PostgreSQL 17+ and put its `bin` directory on PATH, or set
`PG_BIN` to that directory. It creates and removes its own temporary cluster,
uses a minimal Supabase Auth/role shim, and never resets the live database.

Live tests create disposable workspaces and fixture rows, then remove those
workspaces in `finally`. They cover the milestone, history links, failed-write
rollback, atomic creation, concurrent updates, category changes, context bounds,
name/status search, tenant isolation, RLS, source ownership and HTTP guards.
They do not remove the retained demo client or development workspace.
Property tests also cover source timestamps and verified/unverified availability,
multiple sources per canonical property, relationship transitions, notes-only
updates, append-only history, tied-time pagination, fresh-connection recall,
context bounds, concurrent first links, cross-workspace parent denial, and
relationship/event and property/source rollback.

The live Supabase security advisor reports no property-table/RLS/function
findings. Its existing Auth warning is
[leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
This milestone does not change Auth configuration.
