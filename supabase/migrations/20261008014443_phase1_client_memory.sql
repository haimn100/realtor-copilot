-- Phase 1 uses existing facts, interactions and tasks. No business rows are
-- corrected, replaced or deleted by this migration.
alter table public.clients add column memory_version bigint not null default 0 check (memory_version >= 0);
alter table public.client_facts add column strength text not null default 'unspecified'
  check (strength in ('hard','soft','unspecified'));
alter table public.interactions add column request_key text,
  add column request_payload jsonb, add column response_json jsonb;
-- A requested Friday is a calendar date, not an invented appointment time.
alter table public.tasks add column due_date date,
  add constraint tasks_one_deadline_kind check (due_date is null or due_at is null);
create unique index interactions_memory_request_idx
  on public.interactions(workspace_id, client_id, request_key) where request_key is not null;
create index client_facts_recorded_history_idx on public.client_facts(workspace_id, client_id, created_at desc, id desc);
create index interactions_recorded_history_idx on public.interactions(workspace_id, client_id, created_at desc, id desc);
create index tasks_recorded_history_idx on public.tasks(workspace_id, client_id, created_at desc, id desc);

grant update (display_name,first_name,last_name,email,phone,status,notes,updated_at,memory_version) on public.clients to authenticated;
grant insert on public.interactions, public.tasks to authenticated;
grant update (response_json) on public.interactions to authenticated;
create policy members_patch_clients on public.clients for update to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy members_insert_interactions on public.interactions for insert to authenticated
  with check (created_by = (select auth.uid()) and workspace_id in
    (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
    and exists (select 1 from public.clients c where c.workspace_id = interactions.workspace_id and c.id = client_id));
create policy members_complete_memory_receipt on public.interactions for update to authenticated
  using (created_by = (select auth.uid()) and request_key is not null and response_json is null
    and workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())))
  with check (created_by = (select auth.uid()) and request_key is not null and response_json is not null
    and workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));
create policy members_insert_tasks on public.tasks for insert to authenticated
  with check (created_by = (select auth.uid()) and workspace_id in
    (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
    and exists (select 1 from public.clients c where c.workspace_id = tasks.workspace_id and c.id = client_id));

-- A receipt can be completed once, in the same transaction as the interaction.
-- Transcript, attribution and the original request can never be edited.
create function public.guard_memory_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Match the existing fact guard: trusted administrators may maintain Auth
  -- foreign keys and disposable fixtures; runtime roles retain immutable history.
  if exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    return new;
  end if;
  if tg_op = 'UPDATE' and ((to_jsonb(new) - 'response_json') is distinct from (to_jsonb(old) - 'response_json')
    or old.request_key is null or old.response_json is not null or jsonb_typeof(new.response_json) is distinct from 'object') then
    raise exception 'Interaction history is immutable' using errcode = '42501';
  end if;
  if new.request_key is not null and (length(new.request_key) not between 1 and 100
    or jsonb_typeof(new.request_payload) is distinct from 'object') then
    raise exception 'Invalid memory receipt' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger memory_receipt_guard before insert or update on public.interactions
  for each row execute function public.guard_memory_receipt();
create function public.check_memory_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.request_key is not null and exists (select 1 from public.interactions
    where id = new.id and workspace_id = new.workspace_id and response_json is null) then
    raise exception 'Memory write receipt must be complete' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger memory_receipt_complete after insert on public.interactions
  deferrable initially deferred for each row execute function public.check_memory_receipt();

-- Direct permitted profile patches are audited too. Fact inserts advance the
-- same client version, including writes through the existing legacy RPC.
create function public.guard_client_memory_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'memory_version') is distinct from (to_jsonb(old) - 'updated_at' - 'memory_version') then
    new.memory_version := old.memory_version + 1;
    new.updated_at := clock_timestamp();
  elsif new.memory_version is distinct from old.memory_version and new.memory_version <> old.memory_version + 1 then
    raise exception 'Invalid client memory version' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger client_memory_version_guard before update on public.clients
  for each row execute function public.guard_client_memory_version();
create function public.audit_client_profile() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_before jsonb; v_after jsonb;
begin
  v_before := jsonb_build_object('display_name',old.display_name,'first_name',old.first_name,'last_name',old.last_name,
    'email',old.email,'phone',old.phone,'status',old.status,'notes',old.notes);
  v_after := jsonb_build_object('display_name',new.display_name,'first_name',new.first_name,'last_name',new.last_name,
    'email',new.email,'phone',new.phone,'status',new.status,'notes',new.notes);
  if v_before is distinct from v_after then
    insert into public.interactions(workspace_id,client_id,interaction_type,summary,metadata,created_by)
    values (new.workspace_id,new.id,'profile_change','Client profile changed',
      jsonb_build_object('before',v_before,'after',v_after,'memory_version',new.memory_version),auth.uid());
  end if;
  return null;
end;
$$;
create trigger client_profile_audit after update on public.clients for each row execute function public.audit_client_profile();
create function public.advance_fact_memory_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.clients set memory_version = memory_version + 1, updated_at = clock_timestamp()
    where id = new.client_id and workspace_id = new.workspace_id;
  return null;
end;
$$;
create trigger fact_memory_version after insert on public.client_facts for each row execute function public.advance_fact_memory_version();

create or replace function public.remember_client_fact(p_workspace_id uuid, p_client_id uuid, p_fact jsonb)
returns public.client_facts language plpgsql security invoker set search_path = '' as $$
declare
  v_new public.client_facts; v_old public.client_facts;
  v_key text := p_fact->>'key'; v_value jsonb := p_fact->'value';
  v_effective timestamptz;
  v_state boolean := false;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  -- One common lock order for every client-memory writer, including first writes.
  perform 1 from public.clients where id = p_client_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Client not found in workspace' using errcode = 'P0002'; end if;
  v_effective := coalesce((p_fact->>'valid_from')::timestamptz, clock_timestamp());
  if jsonb_typeof(p_fact) is distinct from 'object' or v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,79}$'
    or coalesce(p_fact->>'category','') not in ('requirement','preference','dislike','context','constraint','other')
    or v_value is null or v_value = 'null'::jsonb or octet_length(p_fact::text) > 4096
    or exists (select 1 from jsonb_object_keys(p_fact) k where k not in
      ('category','key','value','confidence','importance','source_interaction_id','source_ref','strength','valid_from','expected_fact_id')) then
    raise exception 'Invalid durable fact' using errcode = '22023';
  end if;
  v_state := jsonb_typeof(v_value) = 'object' and v_value->>'state' in ('unknown','unrestricted')
    and (v_value - 'state') = '{}'::jsonb;
  v_state := coalesce(v_state,false);
  if jsonb_typeof(v_value) = 'object' and not v_state then
    if jsonb_typeof(v_value->'amount') is distinct from 'number' or (v_value->>'amount')::numeric < 0
      or (v_value->>'amount')::numeric > 9007199254740991 or coalesce(v_value->>'currency','') !~ '^[A-Z]{3}$'
      or (v_value - 'amount' - 'currency') <> '{}'::jsonb then
      raise exception 'Invalid fact value' using errcode = '22023';
    end if;
  elsif jsonb_typeof(v_value) = 'array' then
    if jsonb_array_length(v_value) not between 1 and 20 or exists
      (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string' or length(e#>>'{}') not between 1 and 200) then
      raise exception 'Invalid fact list' using errcode = '22023';
    end if;
  elsif jsonb_typeof(v_value) = 'string' and length(trim(v_value#>>'{}')) not between 1 and 1000 then
    raise exception 'Invalid fact text' using errcode = '22023';
  end if;
  if not v_state and v_key in ('budget_min','budget_max') and (jsonb_typeof(v_value) <> 'object' or not (v_value ? 'amount')) then
    raise exception 'Budget requires amount and currency' using errcode = '22023';
  end if;
  if not v_state and v_key in ('bedrooms_min','bedrooms_max') then
    if jsonb_typeof(v_value) <> 'number' or (v_value#>>'{}')::numeric < 0 or trunc((v_value#>>'{}')::numeric) <> (v_value#>>'{}')::numeric then
      raise exception 'Bedrooms require a nonnegative integer' using errcode = '22023';
    end if;
  end if;
  if not isfinite(v_effective) or (p_fact ? 'confidence' and jsonb_typeof(p_fact->'confidence') <> 'number') then
    raise exception 'Invalid fact time or confidence' using errcode = '22023';
  end if;
  if (p_fact ? 'valid_from' and (jsonb_typeof(p_fact->'valid_from') <> 'string'
    or p_fact->>'valid_from' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'))
    or (p_fact ? 'source_ref' and (jsonb_typeof(p_fact->'source_ref') <> 'string'
      or length(trim(p_fact->>'source_ref')) not between 1 and 300)) then
    raise exception 'Invalid fact time or source' using errcode = '22023';
  end if;
  if p_fact->>'source_interaction_id' is not null and not exists (select 1 from public.interactions
    where id = (p_fact->>'source_interaction_id')::uuid and workspace_id = p_workspace_id and client_id = p_client_id) then
    raise exception 'Source interaction not found for client' using errcode = '22023';
  end if;
  select * into v_old from public.client_facts where workspace_id = p_workspace_id and client_id = p_client_id and key = v_key and status = 'current';
  if p_fact ? 'expected_fact_id' and (p_fact->>'expected_fact_id')::uuid is distinct from v_old.id then
    raise exception 'Fact changed since it was read' using errcode = '40001';
  end if;
  if v_old.id is not null and v_effective < v_old.valid_from and not (p_fact ? 'expected_fact_id') then
    raise exception 'Older information requires an explicit correction of the current fact' using errcode = '40001';
  end if;
  update public.client_facts set status = 'superseded' where id = v_old.id and workspace_id = p_workspace_id;
  insert into public.client_facts(workspace_id,client_id,category,key,value_json,confidence,importance,
    source_type,source_interaction_id,source_ref,strength,valid_from,created_by)
  values (p_workspace_id,p_client_id,p_fact->>'category',v_key,v_value,
    coalesce((p_fact->>'confidence')::numeric,1),coalesce(p_fact->>'importance','normal'),
    case when p_fact->>'source_interaction_id' is null then 'manual' else 'interaction' end,
    (p_fact->>'source_interaction_id')::uuid,p_fact->>'source_ref',
    coalesce(p_fact->>'strength',case when p_fact->>'category' in ('requirement','constraint') then 'hard'
      when p_fact->>'category' = 'preference' then 'soft' else 'unspecified' end),v_effective,auth.uid()) returning * into v_new;
  update public.client_facts set superseded_by_id = v_new.id where id = v_old.id and workspace_id = p_workspace_id;
  return v_new;
end;
$$;

create function public.write_client_memory(p_workspace_id uuid,p_client_id uuid,p_operation text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_client public.clients; v_receipt public.interactions; v_interaction_id uuid;
  v_fact jsonb; v_saved public.client_facts; v_task jsonb; v_saved_task public.tasks;
  v_facts jsonb := '[]'; v_tasks jsonb := '[]'; v_response jsonb; v_patch jsonb;
  v_request jsonb := jsonb_build_object('operation',p_operation,'arguments',p_request);
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into v_client from public.clients where id = p_client_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Client not found in workspace' using errcode = 'P0002'; end if;
  if p_operation not in ('record_interaction','update_client') or jsonb_typeof(p_request) is distinct from 'object'
    or jsonb_typeof(p_request->'idempotency_key') is distinct from 'string'
    or length(trim(coalesce(p_request->>'idempotency_key',''))) not between 1 and 100
    or jsonb_typeof(p_request->'expected_version') is distinct from 'number'
    or octet_length(p_request::text) > 60000 then
    raise exception 'Invalid memory request' using errcode = '22023';
  end if;
  if (p_request->>'expected_version')::numeric < 0 or (p_request->>'expected_version')::numeric > 9007199254740991
    or trunc((p_request->>'expected_version')::numeric) <> (p_request->>'expected_version')::numeric
    or (p_request ? 'client_id' and p_request->>'client_id' is distinct from p_client_id::text)
    or (p_request ? 'source_ref' and (jsonb_typeof(p_request->'source_ref') <> 'string'
      or length(trim(p_request->>'source_ref')) not between 1 and 300)) then
    raise exception 'Invalid request identity, version or source' using errcode = '22023';
  end if;
  select * into v_receipt from public.interactions where workspace_id = p_workspace_id and client_id = p_client_id and request_key = p_request->>'idempotency_key';
  if found then
    if v_receipt.request_payload is distinct from v_request then
      raise exception 'Idempotency key already used for a different request' using errcode = '40001';
    end if;
    return v_receipt.response_json || '{"replayed":true}'::jsonb;
  end if;
  if v_client.memory_version <> (p_request->>'expected_version')::bigint then
    raise exception 'Client memory changed since it was read' using errcode = '40001';
  end if;
  if p_operation = 'update_client' then
    if exists (select 1 from jsonb_object_keys(p_request) k where k not in ('client_id','expected_version','idempotency_key','patch','source_ref')) then
      raise exception 'Unknown profile request field' using errcode = '22023';
    end if;
    v_patch := p_request->'patch';
    if jsonb_typeof(v_patch) is distinct from 'object' or v_patch = '{}' or exists (select 1 from jsonb_object_keys(v_patch) k
      where k not in ('display_name','first_name','last_name','email','phone','status','notes'))
      or exists (select 1 from jsonb_each(v_patch) e where jsonb_typeof(e.value) not in ('string','null'))
      or exists (select 1 from jsonb_each(v_patch) e where jsonb_typeof(e.value) = 'string' and
        length(trim(e.value#>>'{}')) not between 1 and case e.key when 'first_name' then 100 when 'last_name' then 100
          when 'email' then 254 when 'phone' then 50 when 'notes' then 2000 else 200 end)
      or (v_patch ? 'display_name' and length(trim(coalesce(v_patch->>'display_name',''))) not between 1 and 200)
      or (v_patch ? 'status' and coalesce(v_patch->>'status','') not in ('lead','active','paused','won','lost','archived')) then
      raise exception 'Invalid client patch' using errcode = '22023';
    end if;
    update public.clients set
      display_name = case when v_patch ? 'display_name' then trim(v_patch->>'display_name') else display_name end,
      first_name = case when v_patch ? 'first_name' then v_patch->>'first_name' else first_name end,
      last_name = case when v_patch ? 'last_name' then v_patch->>'last_name' else last_name end,
      email = case when v_patch ? 'email' then v_patch->>'email' else email end,
      phone = case when v_patch ? 'phone' then v_patch->>'phone' else phone end,
      status = case when v_patch ? 'status' then v_patch->>'status' else status end,
      notes = case when v_patch ? 'notes' then v_patch->>'notes' else notes end
      where id = p_client_id and workspace_id = p_workspace_id returning * into v_client;
    -- Link the immutable actual profile change to its operation receipt. A
    -- no-op patch has a receipt but produces no profile-change event.
    select id into v_interaction_id from public.interactions where workspace_id = p_workspace_id and client_id = p_client_id
      and interaction_type = 'profile_change' and metadata->>'memory_version' = v_client.memory_version::text
      and created_at = transaction_timestamp() order by id desc limit 1;
    -- Receipt fields are set on INSERT only; a separate compact receipt keeps
    -- actual profile history immutable even for direct permitted updates.
    insert into public.interactions(workspace_id,client_id,interaction_type,summary,metadata,created_by,request_key,request_payload)
      values (p_workspace_id,p_client_id,'profile_update','Profile patch recorded',
        jsonb_build_object('profile_change_id',v_interaction_id,'source_ref',p_request->>'source_ref'),auth.uid(),p_request->>'idempotency_key',v_request)
      returning id into v_interaction_id;
  else
    if exists (select 1 from jsonb_object_keys(p_request) k where k not in
      ('client_id','expected_version','idempotency_key','interaction_type','occurred_at','summary','content','channel','direction','source_ref','facts','follow_ups'))
      or coalesce(p_request->>'interaction_type','') not in ('call','meeting','message','note')
      or length(trim(coalesce(p_request->>'summary',''))) not between 1 and 2000
      or jsonb_typeof(p_request->'summary') is distinct from 'string'
      or (p_request ? 'content' and (jsonb_typeof(p_request->'content') <> 'string' or length(p_request->>'content') not between 1 and 12000))
      or (p_request ? 'channel' and (jsonb_typeof(p_request->'channel') <> 'string' or length(trim(p_request->>'channel')) not between 1 and 100))
      or p_request->>'occurred_at' is null or not isfinite((p_request->>'occurred_at')::timestamptz)
      or p_request->>'occurred_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (p_request ? 'facts' and jsonb_typeof(p_request->'facts') is distinct from 'array')
      or (p_request ? 'follow_ups' and jsonb_typeof(p_request->'follow_ups') is distinct from 'array') then
      raise exception 'Invalid interaction' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(p_request->'facts','[]')) > 40 or jsonb_array_length(coalesce(p_request->'follow_ups','[]')) > 20
      or (select count(*) from jsonb_array_elements(coalesce(p_request->'facts','[]'))) <>
        (select count(distinct f->>'key') from jsonb_array_elements(coalesce(p_request->'facts','[]')) f) then
      raise exception 'Invalid fact changes or follow-ups' using errcode = '22023';
    end if;
    insert into public.interactions(workspace_id,client_id,interaction_type,channel,direction,occurred_at,summary,content,metadata,
      created_by,request_key,request_payload)
    values (p_workspace_id,p_client_id,p_request->>'interaction_type',p_request->>'channel',p_request->>'direction',
      (p_request->>'occurred_at')::timestamptz,p_request->>'summary',p_request->>'content',
      jsonb_build_object('source_ref',p_request->>'source_ref'),auth.uid(),p_request->>'idempotency_key',v_request)
    returning id into v_interaction_id;
    for v_fact in select value from jsonb_array_elements(coalesce(p_request->'facts','[]')) loop
      if v_fact ? 'source_interaction_id' then raise exception 'Fact source is assigned by the interaction' using errcode = '22023'; end if;
      v_fact := v_fact || jsonb_build_object('source_interaction_id',v_interaction_id,
        'valid_from',coalesce(v_fact->>'valid_from',p_request->>'occurred_at'),
        'source_ref',coalesce(v_fact->>'source_ref',p_request->>'source_ref'));
      -- Strip absent source_ref rather than changing the legacy fact contract.
      v_fact := jsonb_strip_nulls(v_fact - 'expected_fact_id') || case when v_fact ? 'expected_fact_id'
        then jsonb_build_object('expected_fact_id',v_fact->'expected_fact_id') else '{}'::jsonb end;
      v_saved := public.remember_client_fact(p_workspace_id,p_client_id,v_fact);
      v_facts := v_facts || jsonb_build_array(to_jsonb(v_saved) - 'workspace_id' - 'client_id');
    end loop;
    for v_task in select value from jsonb_array_elements(coalesce(p_request->'follow_ups','[]')) loop
      if jsonb_typeof(v_task) is distinct from 'object' or length(trim(coalesce(v_task->>'title',''))) not between 1 and 200
        or jsonb_typeof(v_task->'title') is distinct from 'string'
        or (v_task ? 'description' and (jsonb_typeof(v_task->'description') <> 'string' or length(trim(v_task->>'description')) not between 1 and 2000))
        or exists (select 1 from jsonb_object_keys(v_task) k where k not in ('title','description','priority','due_at','due_date'))
        or (v_task ? 'due_date' and (v_task->>'due_date' is null or v_task->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or not isfinite((v_task->>'due_date')::date)))
        or (v_task ? 'due_date' and v_task ? 'due_at')
        or (v_task ? 'due_at' and (v_task->>'due_at' is null or not isfinite((v_task->>'due_at')::timestamptz)
          or v_task->>'due_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$')) then
        raise exception 'Invalid follow-up' using errcode = '22023';
      end if;
      insert into public.tasks(workspace_id,client_id,interaction_id,title,description,priority,due_at,due_date,created_by)
      values (p_workspace_id,p_client_id,v_interaction_id,trim(v_task->>'title'),v_task->>'description',
        coalesce(v_task->>'priority','normal'),(v_task->>'due_at')::timestamptz,(v_task->>'due_date')::date,auth.uid()) returning * into v_saved_task;
      v_tasks := v_tasks || jsonb_build_array(to_jsonb(v_saved_task) - 'workspace_id' - 'client_id');
    end loop;
    update public.clients set memory_version = memory_version + 1, updated_at = clock_timestamp()
      where id = p_client_id and workspace_id = p_workspace_id returning * into v_client;
  end if;
  v_response := jsonb_build_object('client',to_jsonb(v_client) - 'workspace_id' - 'created_by' - 'created_at' - 'updated_at',
    'interaction_id',v_interaction_id,'facts',v_facts,'follow_ups',v_tasks,'replayed',false);
  update public.interactions set response_json = v_response where id = v_interaction_id and workspace_id = p_workspace_id;
  return v_response;
end;
$$;

-- One SQL snapshot and deterministic keyset pagination, including tied times.
-- Pages are selected by recording time, with effective times supplied separately;
-- this makes late notes and corrections discoverable without rewriting history.
create function public.get_client_history(p_workspace_id uuid,p_client_id uuid,p_limit integer default 30,p_cursor jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_client jsonb; v_rows jsonb; v_next jsonb; v_more boolean;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select to_jsonb(c) - 'workspace_id' - 'created_by' - 'created_at' - 'updated_at' into v_client
    from public.clients c where id = p_client_id and workspace_id = p_workspace_id;
  if v_client is null then raise exception 'Client not found in workspace' using errcode = 'P0002'; end if;
  if p_limit is null or p_limit not between 1 and 50 or (p_cursor is not null and
    (jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->>'recorded_at' is null
      or p_cursor->>'id' is null or coalesce(p_cursor->>'kind','') not in ('client','fact','interaction','task','property_event'))) then
    raise exception 'Invalid history page' using errcode = '22023';
  end if;
  with timeline as (
    select c.id,'client'::text kind,c.created_at recorded_at,c.created_at effective_at,c.created_by,
      null::uuid source_interaction_id,null::text source_ref,
      jsonb_build_object('event','client_created') data
      from public.clients c where c.workspace_id = p_workspace_id and c.id = p_client_id
    union all
    select f.id,'fact',f.created_at,f.valid_from,f.created_by,f.source_interaction_id,f.source_ref,
      to_jsonb(f) - 'workspace_id' - 'client_id' from public.client_facts f where f.workspace_id = p_workspace_id and f.client_id = p_client_id
    union all
    select i.id,'interaction',i.created_at,i.occurred_at,i.created_by,i.id,
      coalesce(i.metadata->>'source_ref',(select r.metadata->>'source_ref' from public.interactions r
        where r.workspace_id = p_workspace_id and r.client_id = p_client_id
          and r.interaction_type = 'profile_update' and r.metadata->>'profile_change_id' = i.id::text limit 1)),
      jsonb_build_object('interaction_type',i.interaction_type,'channel',i.channel,'direction',i.direction,
        'summary',i.summary,'metadata',i.metadata)
      from public.interactions i where i.workspace_id = p_workspace_id and i.client_id = p_client_id and i.interaction_type <> 'profile_update'
    union all
    select t.id,'task',t.created_at,coalesce(t.due_at,t.created_at),t.created_by,t.interaction_id,i.metadata->>'source_ref',
      to_jsonb(t) - 'workspace_id' - 'client_id' from public.tasks t
      left join public.interactions i on i.id = t.interaction_id and i.workspace_id = t.workspace_id and i.client_id = t.client_id
      where t.workspace_id = p_workspace_id and t.client_id = p_client_id
    union all
    select e.id,'property_event',e.created_at,e.occurred_at,e.created_by,e.interaction_id,null,
      jsonb_build_object('property_id',cp.property_id,'event_type',e.event_type,'notes',e.notes,'metadata',e.metadata)
      from public.client_property_events e join public.client_properties cp on cp.id = e.client_property_id and cp.workspace_id = e.workspace_id
      where e.workspace_id = p_workspace_id and cp.client_id = p_client_id
  ), page as (
    select * from timeline where p_cursor is null or (recorded_at,kind,id) <
      ((p_cursor->>'recorded_at')::timestamptz,p_cursor->>'kind',(p_cursor->>'id')::uuid)
    order by recorded_at desc,kind desc,id desc limit p_limit + 1
  ), numbered as (select *,row_number() over (order by recorded_at desc,kind desc,id desc) n from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'recorded_at',recorded_at,'effective_at',effective_at,
    'created_by',created_by,'source_interaction_id',source_interaction_id,'source_ref',source_ref,'data',data)
    order by recorded_at,kind,id) filter (where n <= p_limit),'[]'::jsonb),
    count(*) > p_limit,
    (jsonb_agg(jsonb_build_object('recorded_at',recorded_at,'kind',kind,'id',id)) filter (where n = p_limit))->0
    into v_rows,v_more,v_next from numbered;
  return jsonb_build_object('client',v_client,'timeline',v_rows,
    'coverage',jsonb_build_object('limit',p_limit,'has_more',v_more,'next_cursor',case when v_more then v_next else null end));
end;
$$;

revoke all on function public.guard_memory_receipt(),public.check_memory_receipt(),public.guard_client_memory_version(),
  public.audit_client_profile(),public.advance_fact_memory_version(),public.write_client_memory(uuid,uuid,text,jsonb),
  public.get_client_history(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.guard_memory_receipt(),public.check_memory_receipt(),public.guard_client_memory_version(),
  public.audit_client_profile(),public.advance_fact_memory_version(),public.write_client_memory(uuid,uuid,text,jsonb),
  public.get_client_history(uuid,uuid,integer,jsonb) to authenticated;
