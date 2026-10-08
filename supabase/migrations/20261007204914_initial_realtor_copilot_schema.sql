create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('owner','admin','agent')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  first_name text,
  last_name text,
  display_name text not null,
  email text,
  phone text,
  status text not null default 'lead' check (status in ('lead','active','paused','won','lost','archived')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  interaction_type text not null default 'note',
  channel text,
  direction text check (direction is null or direction in ('inbound','outbound','internal')),
  occurred_at timestamptz not null default now(),
  summary text,
  content text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.client_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  category text not null check (category in ('requirement','preference','dislike','context','constraint','other')),
  key text not null,
  value_json jsonb not null,
  status text not null default 'current' check (status in ('current','superseded','disputed','retracted')),
  confidence numeric(4,3) not null default 1 check (confidence >= 0 and confidence <= 1),
  importance text not null default 'normal' check (importance in ('low','normal','high','critical')),
  source_type text not null default 'manual',
  source_interaction_id uuid references public.interactions(id) on delete set null,
  source_ref text,
  valid_from timestamptz not null default now(),
  superseded_by_id uuid references public.client_facts(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text,
  property_type text,
  development_name text,
  address text,
  neighborhood text,
  city text not null default 'Playa del Carmen',
  state text not null default 'Quintana Roo',
  country text not null default 'Mexico',
  latitude numeric(9,6),
  longitude numeric(9,6),
  bedrooms numeric(4,1),
  bathrooms numeric(4,1),
  interior_m2 numeric(10,2),
  exterior_m2 numeric(10,2),
  total_m2 numeric(10,2),
  currency text default 'MXN',
  asking_price numeric(14,2),
  construction_status text,
  delivery_date date,
  description text,
  notes text,
  availability_status text default 'unknown',
  availability_verified_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.property_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  source_name text not null,
  source_type text not null default 'web',
  url text,
  external_id text,
  listing_title text,
  asking_price numeric(14,2),
  currency text,
  availability_status text,
  availability_verified boolean not null default false,
  availability_verified_at timestamptz,
  listing_updated_at timestamptz,
  accessed_at timestamptz not null default now(),
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, source_name, external_id)
);

create table public.client_properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'discovered',
  interest_level text check (interest_level is null or interest_level in ('low','medium','high')),
  notes text,
  rejection_reason text,
  first_considered_at timestamptz not null default now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, property_id)
);

create table public.client_property_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_property_id uuid not null references public.client_properties(id) on delete cascade,
  event_type text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  interaction_id uuid references public.interactions(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.search_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  query_text text not null,
  criteria_snapshot jsonb not null default '{}'::jsonb,
  sources_requested jsonb not null default '[]'::jsonb,
  sources_searched jsonb not null default '[]'::jsonb,
  status text not null default 'completed' check (status in ('running','completed','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.search_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_run_id uuid not null references public.search_runs(id) on delete cascade,
  rank integer,
  source_name text,
  url text,
  external_id text,
  title text,
  price numeric(14,2),
  currency text,
  bedrooms numeric(4,1),
  bathrooms numeric(4,1),
  interior_m2 numeric(10,2),
  total_m2 numeric(10,2),
  neighborhood text,
  summary text,
  listing_updated_at timestamptz,
  accessed_at timestamptz not null default now(),
  availability_verified boolean not null default false,
  availability_status text,
  data jsonb not null default '{}'::jsonb,
  promoted_property_id uuid references public.properties(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.research_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_type text not null check (subject_type in ('property','development','developer','neighborhood','market','other')),
  subject_key text,
  property_id uuid references public.properties(id) on delete cascade,
  title text,
  summary text not null,
  findings jsonb not null default '{}'::jsonb,
  source_url text,
  source_name text,
  accessed_at timestamptz,
  source_updated_at timestamptz,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  interaction_id uuid references public.interactions(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  completed_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Core query/RLS indexes
create index workspace_members_user_idx on public.workspace_members(user_id);
create index clients_workspace_status_idx on public.clients(workspace_id, status);
create index client_facts_client_current_idx on public.client_facts(client_id, status, key);
create index interactions_client_time_idx on public.interactions(client_id, occurred_at desc);
create index properties_workspace_idx on public.properties(workspace_id);
create index property_sources_property_idx on public.property_sources(property_id);
create index client_properties_client_idx on public.client_properties(client_id, status);
create index client_properties_property_idx on public.client_properties(property_id);
create index client_property_events_relation_time_idx on public.client_property_events(client_property_id, occurred_at desc);
create index search_runs_client_time_idx on public.search_runs(client_id, created_at desc);
create index search_results_run_rank_idx on public.search_results(search_run_id, rank);
create index research_workspace_subject_idx on public.research_items(workspace_id, subject_type, subject_key);
create index tasks_workspace_status_due_idx on public.tasks(workspace_id, status, due_at);

-- RLS: no anonymous access. Authenticated members may access rows in their workspaces.
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.clients enable row level security;
alter table public.client_facts enable row level security;
alter table public.properties enable row level security;
alter table public.property_sources enable row level security;
alter table public.client_properties enable row level security;
alter table public.client_property_events enable row level security;
alter table public.interactions enable row level security;
alter table public.search_runs enable row level security;
alter table public.search_results enable row level security;
alter table public.research_items enable row level security;
alter table public.tasks enable row level security;

create policy "members_read_workspaces" on public.workspaces for select to authenticated
using (id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "creator_insert_workspace" on public.workspaces for insert to authenticated
with check (created_by = (select auth.uid()));

create policy "members_read_memberships" on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()));

-- For MVP writes, server/service role is expected. Authenticated frontend gets workspace-scoped read access.
create policy "members_read_clients" on public.clients for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_client_facts" on public.client_facts for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_properties" on public.properties for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_property_sources" on public.property_sources for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_client_properties" on public.client_properties for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_client_property_events" on public.client_property_events for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_interactions" on public.interactions for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_search_runs" on public.search_runs for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_search_results" on public.search_results for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_research" on public.research_items for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy "members_read_tasks" on public.tasks for select to authenticated using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
