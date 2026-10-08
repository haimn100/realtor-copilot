-- Phase 0: least privilege, immutable fact history, and workspace-safe references.
-- No business rows are updated or deleted. Constraints validate existing rows;
-- inconsistent legacy data aborts the migration instead of being repaired silently.
revoke all on public.workspaces, public.workspace_members, public.clients, public.interactions, public.client_facts, public.properties, public.property_sources, public.client_properties, public.client_property_events, public.search_runs, public.search_results, public.research_items, public.tasks from public, anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.clients, public.interactions, public.client_facts, public.properties, public.property_sources, public.client_properties, public.client_property_events, public.search_runs, public.search_results, public.research_items, public.tasks to authenticated;
grant insert on public.workspaces, public.clients, public.client_facts, public.properties,
  public.property_sources, public.client_properties, public.client_property_events to authenticated;
grant update (status, superseded_by_id) on public.client_facts to authenticated;
grant update (title, property_type, development_name, address, neighborhood, city, state, country,
  bedrooms, bathrooms, interior_m2, exterior_m2, total_m2, asking_price, currency,
  construction_status, delivery_date, notes, updated_at) on public.properties to authenticated;
grant update (status, interest_level, notes, rejection_reason, sent_at, viewed_at, updated_at)
  on public.client_properties to authenticated;

-- Referencing a UUID alone does not prove that parent and child share a tenant.
alter table public.clients add constraint clients_workspace_id_id_key unique (workspace_id, id);
alter table public.interactions add constraint interactions_workspace_id_id_key unique (workspace_id, id);
alter table public.properties add constraint properties_workspace_id_id_key unique (workspace_id, id);
alter table public.client_properties add constraint client_properties_workspace_id_id_key unique (workspace_id, id);
alter table public.search_runs add constraint search_runs_workspace_id_id_key unique (workspace_id, id);
alter table public.interactions add constraint interactions_workspace_client_id_key unique (workspace_id, client_id, id);
alter table public.client_facts add constraint client_facts_workspace_client_key_id_key unique (workspace_id, client_id, key, id);
alter table public.interactions drop constraint interactions_client_id_fkey,
  add constraint interactions_client_id_fkey foreign key (workspace_id, client_id)
  references public.clients (workspace_id, id) on delete cascade;
alter table public.client_facts drop constraint client_facts_client_id_fkey,
  add constraint client_facts_client_id_fkey foreign key (workspace_id, client_id)
  references public.clients (workspace_id, id) on delete cascade;
alter table public.client_facts drop constraint client_facts_source_interaction_id_fkey,
  add constraint client_facts_source_interaction_id_fkey foreign key (workspace_id, client_id, source_interaction_id)
  references public.interactions (workspace_id, client_id, id) on delete set null (source_interaction_id);
alter table public.client_facts drop constraint client_facts_superseded_by_id_fkey,
  add constraint client_facts_superseded_by_id_fkey foreign key (workspace_id, client_id, key, superseded_by_id)
  references public.client_facts (workspace_id, client_id, key, id) on delete set null (superseded_by_id);
alter table public.property_sources drop constraint property_sources_property_id_fkey,
  add constraint property_sources_property_id_fkey foreign key (workspace_id, property_id)
  references public.properties (workspace_id, id) on delete cascade;
alter table public.client_properties drop constraint client_properties_client_id_fkey,
  add constraint client_properties_client_id_fkey foreign key (workspace_id, client_id)
  references public.clients (workspace_id, id) on delete cascade;
alter table public.client_properties drop constraint client_properties_property_id_fkey,
  add constraint client_properties_property_id_fkey foreign key (workspace_id, property_id)
  references public.properties (workspace_id, id) on delete cascade;
alter table public.client_property_events drop constraint client_property_events_client_property_id_fkey,
  add constraint client_property_events_client_property_id_fkey foreign key (workspace_id, client_property_id)
  references public.client_properties (workspace_id, id) on delete cascade;
alter table public.client_property_events drop constraint client_property_events_interaction_id_fkey,
  add constraint client_property_events_interaction_id_fkey foreign key (workspace_id, interaction_id)
  references public.interactions (workspace_id, id) on delete set null (interaction_id);
alter table public.search_runs drop constraint search_runs_client_id_fkey,
  add constraint search_runs_client_id_fkey foreign key (workspace_id, client_id)
  references public.clients (workspace_id, id) on delete set null (client_id);
alter table public.search_results drop constraint search_results_search_run_id_fkey,
  add constraint search_results_search_run_id_fkey foreign key (workspace_id, search_run_id)
  references public.search_runs (workspace_id, id) on delete cascade;
alter table public.search_results drop constraint search_results_promoted_property_id_fkey,
  add constraint search_results_promoted_property_id_fkey foreign key (workspace_id, promoted_property_id)
  references public.properties (workspace_id, id) on delete set null (promoted_property_id);
alter table public.research_items drop constraint research_items_property_id_fkey,
  add constraint research_items_property_id_fkey foreign key (workspace_id, property_id)
  references public.properties (workspace_id, id) on delete cascade;
alter table public.tasks drop constraint tasks_client_id_fkey,
  add constraint tasks_client_id_fkey foreign key (workspace_id, client_id)
  references public.clients (workspace_id, id) on delete cascade;
alter table public.tasks drop constraint tasks_property_id_fkey,
  add constraint tasks_property_id_fkey foreign key (workspace_id, property_id)
  references public.properties (workspace_id, id) on delete cascade;
alter table public.tasks drop constraint tasks_interaction_id_fkey,
  add constraint tasks_interaction_id_fkey foreign key (workspace_id, interaction_id)
  references public.interactions (workspace_id, id) on delete set null (interaction_id);
alter table public.tasks add constraint tasks_assignee_workspace_fkey
  foreign key (workspace_id, assigned_to) references public.workspace_members(workspace_id, user_id)
  on delete set null (assigned_to);
-- Also check client ownership when a task has both a client and an interaction.
alter table public.tasks add constraint tasks_interaction_client_fkey
  foreign key (workspace_id, client_id, interaction_id)
  references public.interactions(workspace_id, client_id, id) on delete set null (interaction_id);

-- Keep the existing SECURITY INVOKER RPC's two-step supersession. No caller-controlled
-- flag or SECURITY DEFINER bypass grants special permission to rewrite history.
create function public.guard_client_fact_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Trusted administrators retain fixture cleanup and Auth FK maintenance.
  if exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'current' or new.superseded_by_id is not null then
      raise exception 'Facts must start current without a successor' using errcode = '42501';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'superseded_by_id')
    is distinct from (to_jsonb(old) - 'status' - 'superseded_by_id') then
    raise exception 'Fact payload, identity, source and attribution are immutable' using errcode = '42501';
  end if;
  if old.status = 'current' and old.superseded_by_id is null
    and new.status = 'superseded' and new.superseded_by_id is null then
    return new;
  end if;
  if old.status = 'superseded' and old.superseded_by_id is null
    and new.status = 'superseded' and new.superseded_by_id is not null then
    return new;
  end if;
  raise exception 'Historical facts cannot be changed' using errcode = '42501';
end;
$$;
create trigger client_fact_history_guard before insert or update on public.client_facts
for each row execute function public.guard_client_fact_history();

-- Both RPC steps must finish in one transaction with an acyclic chain ending in
-- a current fact. Direct status changes cannot leave incomplete or cyclic history.
create function public.check_client_fact_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_cycle boolean;
  v_current boolean;
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    return null;
  end if;
  with recursive chain as (
    select f.id, f.status, f.superseded_by_id, array[f.id] as path, false as cycle
    from public.client_facts f where f.id = new.id and f.workspace_id = new.workspace_id
    union all
    select f.id, f.status, f.superseded_by_id, c.path || f.id, f.id = any(c.path)
    from chain c join public.client_facts f on f.id = c.superseded_by_id
    where not c.cycle
  )
  select coalesce(bool_or(cycle), false),
    coalesce(bool_or(status = 'current' and superseded_by_id is null), false)
  into v_cycle, v_current from chain;
  if v_cycle or not v_current then
    raise exception 'Fact supersession must end in a current fact without cycles' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger client_fact_history_complete after update on public.client_facts
deferrable initially deferred for each row execute function public.check_client_fact_history();

revoke all on function public.guard_client_fact_history() from public, anon;
revoke all on function public.check_client_fact_history() from public, anon;
grant execute on function public.guard_client_fact_history(), public.check_client_fact_history() to authenticated;
