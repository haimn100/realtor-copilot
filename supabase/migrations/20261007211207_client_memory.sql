-- Existing tables and read policies remain in place. All functions run as
-- the caller: membership RLS applies to every SELECT/INSERT/UPDATE.
-- Filename version matches the migration recorded on the live project.
create policy members_insert_clients on public.clients for insert to authenticated
with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and created_by = (select auth.uid())
);

create policy members_insert_client_facts on public.client_facts for insert to authenticated
with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and created_by = (select auth.uid())
  and exists (select 1 from public.clients c where c.id = client_id and c.workspace_id = client_facts.workspace_id)
  and (source_interaction_id is null or exists (
    select 1 from public.interactions i where i.id = source_interaction_id
    and i.workspace_id = client_facts.workspace_id and i.client_id = client_facts.client_id
  ))
);

create policy members_update_client_facts on public.client_facts for update to authenticated
using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())))
with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and exists (select 1 from public.clients c where c.id = client_id and c.workspace_id = client_facts.workspace_id)
  and (source_interaction_id is null or exists (
    select 1 from public.interactions i where i.id = source_interaction_id
    and i.workspace_id = client_facts.workspace_id and i.client_id = client_facts.client_id
  ))
);

-- The logical key is per client, across categories. Changing a preference to
-- a dislike supersedes its previous value too. Lists represent multi-values.
create unique index client_facts_one_current_key_idx
on public.client_facts(workspace_id, client_id, key) where status = 'current';

grant select, insert on public.clients to authenticated;
grant select, insert, update on public.client_facts to authenticated;

create function public.remember_client_fact(p_workspace_id uuid, p_client_id uuid, p_fact jsonb)
returns public.client_facts
language plpgsql security invoker set search_path = '' as $$
declare
  v_new public.client_facts;
  v_old_ids uuid[];
  v_key text := p_fact->>'key';
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()
  ) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and workspace_id = p_workspace_id) then
    raise exception 'Client not found in workspace' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_fact) <> 'object' or v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,79}$'
    or p_fact->>'category' is null or not (p_fact ? 'value') or p_fact->'value' = 'null'::jsonb
    or octet_length(p_fact::text) > 4096 then
    raise exception 'Invalid durable fact' using errcode = '22023';
  end if;
  if p_fact->>'source_interaction_id' is not null and not exists (
    select 1 from public.interactions where id = (p_fact->>'source_interaction_id')::uuid
    and workspace_id = p_workspace_id and client_id = p_client_id
  ) then
    raise exception 'Source interaction not found for client' using errcode = '22023';
  end if;

  -- Serialize even the first write, when there is no existing fact to lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':' || p_client_id::text || ':' || v_key, 0
  ));
  select array_agg(id) into v_old_ids from public.client_facts
  where workspace_id = p_workspace_id and client_id = p_client_id and key = v_key and status = 'current';
  update public.client_facts set status = 'superseded'
  where workspace_id = p_workspace_id and client_id = p_client_id and id = any(v_old_ids);

  insert into public.client_facts (
    workspace_id, client_id, category, key, value_json, confidence, importance,
    source_type, source_interaction_id, source_ref, created_by
  ) values (
    p_workspace_id, p_client_id, p_fact->>'category', v_key, p_fact->'value',
    coalesce((p_fact->>'confidence')::numeric, 1), coalesce(p_fact->>'importance', 'normal'),
    'manual', (p_fact->>'source_interaction_id')::uuid, p_fact->>'source_ref', auth.uid()
  ) returning * into v_new;

  update public.client_facts set superseded_by_id = v_new.id
  where workspace_id = p_workspace_id and client_id = p_client_id and id = any(v_old_ids);
  return v_new;
end;
$$;

create function public.create_client_with_facts(p_workspace_id uuid, p_client jsonb, p_facts jsonb default '[]'::jsonb)
returns public.clients
language plpgsql security invoker set search_path = '' as $$
declare
  v_client public.clients;
  v_fact jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()
  ) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_client) <> 'object' or nullif(trim(p_client->>'display_name'), '') is null
    or length(p_client->>'display_name') > 200 or jsonb_typeof(p_facts) <> 'array'
    or jsonb_array_length(p_facts) > 40 then
    raise exception 'Invalid client or initial facts' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_facts)) <>
    (select count(distinct f->>'key') from jsonb_array_elements(p_facts) f) then
    raise exception 'Initial fact keys must be unique' using errcode = '22023';
  end if;
  insert into public.clients(workspace_id, display_name, first_name, last_name, email, phone, status, notes, created_by)
  values (p_workspace_id, trim(p_client->>'display_name'), p_client->>'first_name', p_client->>'last_name',
    p_client->>'email', p_client->>'phone', coalesce(p_client->>'status', 'lead'), p_client->>'notes', auth.uid())
  returning * into v_client;
  for v_fact in select value from jsonb_array_elements(p_facts) loop
    perform public.remember_client_fact(p_workspace_id, v_client.id, v_fact);
  end loop;
  return v_client;
end;
$$;

revoke all on function public.remember_client_fact(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_client_with_facts(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.remember_client_fact(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_client_with_facts(uuid, jsonb, jsonb) to authenticated;
