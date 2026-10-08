# Phase 0 acceptance follow-up

The eight ChatGPT tools, property creation, relationship transitions, event
history, and persistence across independent conversations were manually verified
by the user. No Phase 1 work is included in this baseline.

## Baseline and clean checkout

The baseline includes application source, the four migration SQL files, offline,
database and live tests, scripts, package.json, package-lock.json and tsconfig.json.
Environment files, credentials, dependencies, compiled output and Supabase CLI
temporary state are excluded. The database TypeScript declarations are required
source inputs; compiled artifacts belong in the ignored dist directory.

Verify the committed baseline in a separate checkout without copying .env:

```powershell
npm ci
npm test
$env:PG_BIN = 'C:\Program Files\PostgreSQL\17\bin'
npm run test:db
npm run typecheck
npm run build
```

The native database suite allocates an independent temporary PostgreSQL cluster,
replays all four migrations, checks the hardened upgrade with fixtures, and
replays again into an empty application schema. It supplies a minimal Supabase
Auth/role shim; it is not a complete fresh Supabase stack test.

## Isolated live suite prerequisites

The existing .env targets mcnhnxeayepgrstjefvg, the retained development project.
That project is excluded from destructive verification. Read-only inspection
found no branch of that project and no separately configured test target.
Other unrelated projects must not be treated as disposable test environments.

The live suite creates fixture workspaces, memberships and business rows and
deletes those workspaces in finally blocks. Its administrative helper retrieves
keys through the authenticated Supabase CLI. It requires a hosted project with a
20-character lowercase reference and both a modern publishable key and an admin
secret/service-role key. Local Supabase cannot run this suite unchanged because
the helper validates hosted project references and constructs its hosted URL.

To run the suite unchanged:

1. Select an explicitly approved disposable hosted Supabase project, separate
   from mcnhnxeayepgrstjefvg. Provisioning paid infrastructure requires approval.
2. Apply only this checkout's four migrations to its fresh database, in filename
   order. Confirm their versions in the migration ledger and expose public
   application tables/functions through the Data API.
3. Enable email/password Auth and create a confirmed synthetic test user. As an
   administrator, create a seed workspace and a workspace_members row linking
   that user's UUID to the workspace. The runtime checks this membership before
   any test creates its own fixtures.
4. Authenticate the Supabase CLI with access to that project and verify it can
   retrieve the publishable and admin keys. Never print or commit the keys.
5. Use a separate clean checkout. Create only its ignored .env with the values
   below. Do not copy the original project's .env. Do not run setup:dev: that
   script hardcodes the retained project reference.
6. Confirm the configured URL/reference is the approved isolated project, then
   run npm ci, npm run build and npm run test:live. Require all 31 tests to pass
   and fixture cleanup to succeed. The seed user/workspace remains test setup.

| Variable | Value |
| --- | --- |
| NODE_ENV | test |
| HOST | 127.0.0.1 |
| PORT | 8787 |
| AUTH_MODE | development |
| SUPABASE_URL | HTTPS API URL of the approved isolated project |
| SUPABASE_PUBLISHABLE_KEY | That project's modern sb_publishable_ key |
| DEV_WORKSPACE_ID | Seed workspace UUID |
| DEV_SUPABASE_EMAIL | Confirmed synthetic user's email |
| DEV_SUPABASE_PASSWORD | Synthetic user's password |

Leave DEV_TUNNEL_URL and MCP_URL unset. These tests create their own loopback HTTP
listeners; no public tunnel, deployed application or ChatGPT connection is needed.
loadConfig loads .env without overriding existing process environment values, so
remove stale Supabase/identity overrides from the test shell before configuring it.

The live suite remains NOT VERIFIED until it runs against that isolated target.
Historical passing results in phase0.md are prior evidence, not this follow-up run.
