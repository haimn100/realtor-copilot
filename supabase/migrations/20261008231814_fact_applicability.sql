-- Applicability is independent of immutable typed assertions and revision status.
-- No UPDATE/DELETE/backfill of existing records. NULL means legacy unclassified;
-- reads fail closed rather than guessing applicability from prose or dates.
alter table public.client_facts
  add column applicability text check (applicability in ('confirmed_current','historical','unconfirmed')),
  add column source_at timestamptz,
  add column valid_until timestamptz,
  add column source_quote text,
  add constraint client_facts_effective_interval check (valid_until is null or valid_until > valid_from);
drop index public.client_facts_one_current_key_idx;
create unique index client_facts_one_current_key_idx on public.client_facts(workspace_id,client_id,key)
  where status = 'current' and (applicability = 'confirmed_current' or applicability is null);
create index client_facts_applicability_idx on public.client_facts(workspace_id,client_id,applicability,valid_from desc);

create or replace function public.guard_client_fact_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Trusted administrators retain fixture cleanup and Auth FK maintenance.
  if exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.applicability := coalesce(new.applicability,'confirmed_current');
    new.source_at := coalesce(new.source_at,(select occurred_at from public.interactions where id = new.source_interaction_id and workspace_id = new.workspace_id and client_id = new.client_id),new.created_at);
    if exists (select 1 from public.interactions where id = new.source_interaction_id and workspace_id = new.workspace_id
      and client_id = new.client_id and channel = 'whatsapp_history') and new.applicability <> 'historical' then
      raise exception 'Historical sources cannot activate client facts' using errcode = '22023';
    end if;
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

create or replace function public.check_client_fact_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_cycle boolean;
  v_current boolean;
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    return null;
  end if;
  if exists (select 1 from public.client_facts f join public.client_facts successor on successor.id=f.superseded_by_id
    where f.id=new.id and f.workspace_id=new.workspace_id
      and coalesce(f.applicability,'confirmed_current') is distinct from successor.applicability) then
    raise exception 'Supersession cannot cross applicability chains' using errcode = '23514';
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

create or replace function public.remember_client_fact(p_workspace_id uuid, p_client_id uuid, p_fact jsonb)
returns public.client_facts language plpgsql security invoker set search_path = '' as $$
declare
  v_new public.client_facts; v_old public.client_facts;
  v_key text := p_fact->>'key'; v_value jsonb := p_fact->'value';
  v_effective timestamptz;
  v_state boolean := false;
  v_applicability text; v_source_at timestamptz; v_until timestamptz; v_source public.interactions; v_duplicate public.client_facts;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  -- One common lock order for every client-memory writer, including first writes.
  perform 1 from public.clients where id = p_client_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Client not found in workspace' using errcode = 'P0002'; end if;
  v_effective := coalesce((p_fact->>'valid_from')::timestamptz, clock_timestamp());
  if p_fact->>'source_interaction_id' is not null then
    select * into v_source from public.interactions where id = (p_fact->>'source_interaction_id')::uuid
      and workspace_id = p_workspace_id and client_id = p_client_id;
    if not found then raise exception 'Source interaction not found for client' using errcode = '22023'; end if;
  end if;
  v_applicability := coalesce(p_fact->>'applicability',case when v_source.channel = 'whatsapp_history' then 'historical' else 'confirmed_current' end);
  v_source_at := coalesce((p_fact->>'source_at')::timestamptz,v_source.occurred_at,clock_timestamp());
  v_until := (p_fact->>'valid_until')::timestamptz;
  if v_applicability not in ('confirmed_current','historical','unconfirmed')
    or (v_source.channel = 'whatsapp_history' and v_applicability <> 'historical')
    or not isfinite(v_source_at) or (v_until is not null and (not isfinite(v_until) or v_until <= v_effective))
    or (p_fact ? 'source_quote' and (jsonb_typeof(p_fact->'source_quote') <> 'string' or length(trim(p_fact->>'source_quote')) not between 1 and 1000))
    or exists (select 1 from jsonb_each(p_fact) e where e.key in ('applicability','source_at','valid_until') and jsonb_typeof(e.value) <> 'string')
    or exists (select 1 from jsonb_each_text(p_fact) e where e.key in ('source_at','valid_until') and e.value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'Invalid applicability or source time' using errcode = '22023';
  end if;
  if jsonb_typeof(p_fact) is distinct from 'object' or v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,79}$'
    or coalesce(p_fact->>'category','') not in ('requirement','preference','dislike','context','constraint','other')
    or v_value is null or v_value = 'null'::jsonb or octet_length(p_fact::text) > 4096
    or exists (select 1 from jsonb_object_keys(p_fact) k where k not in
      ('category','key','value','confidence','importance','source_interaction_id','source_ref','strength','valid_from','expected_fact_id','applicability','source_at','valid_until','source_quote')) then
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
  if v_key = 'view_before_offer' and not v_state and jsonb_typeof(v_value) <> 'boolean' then
    raise exception 'view_before_offer requires a boolean or explicit state' using errcode = '22023';
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
  -- Exact source assertion replay is a no-op, even after later supersession.
  -- A reused source identity with changed evidence requires explicit reconciliation.
  if p_fact->>'source_ref' is not null or v_source.id is not null then
    select * into v_duplicate from public.client_facts where workspace_id = p_workspace_id and client_id = p_client_id
      and key = v_key and applicability = v_applicability and valid_from = v_effective
      and source_ref is not distinct from p_fact->>'source_ref'
      and source_interaction_id is not distinct from v_source.id
      order by created_at,id limit 1;
    if found and not (p_fact ? 'expected_fact_id') then
      if v_duplicate.value_json is distinct from v_value or v_duplicate.category is distinct from p_fact->>'category'
        or v_duplicate.confidence <> coalesce((p_fact->>'confidence')::numeric,1)
        or v_duplicate.source_quote is distinct from p_fact->>'source_quote'
        or v_duplicate.valid_until is distinct from v_until
        or (p_fact ? 'source_at' and v_duplicate.source_at is distinct from v_source_at)
        or v_duplicate.importance <> coalesce(p_fact->>'importance','normal')
        or v_duplicate.strength <> coalesce(p_fact->>'strength',case when p_fact->>'category' in ('requirement','constraint') then 'hard'
          when p_fact->>'category' = 'preference' then 'soft' else 'unspecified' end) then
        raise exception 'Source assertion already exists with different payload' using errcode = 'PT409';
      end if;
      return v_duplicate;
    end if;
  end if;
  if v_applicability = 'confirmed_current' then
    select * into v_old from public.client_facts where workspace_id = p_workspace_id and client_id = p_client_id
      and key = v_key and status = 'current' and (applicability = 'confirmed_current' or applicability is null);
  elsif p_fact->>'expected_fact_id' is not null then
    select * into v_old from public.client_facts where workspace_id = p_workspace_id and client_id = p_client_id
      and key = v_key and status = 'current' and applicability = v_applicability and id = (p_fact->>'expected_fact_id')::uuid;
  end if;
  if p_fact ? 'expected_fact_id' and (p_fact->>'expected_fact_id')::uuid is distinct from v_old.id then
    raise exception 'Fact changed since it was read or belongs to another applicability' using errcode = 'PT409';
  end if;
  if v_applicability = 'confirmed_current' and v_old.id is not null and v_effective <= v_old.valid_from and not (p_fact ? 'expected_fact_id') then
    raise exception 'Older or tied information requires an explicit correction of the current fact' using errcode = 'PT409';
  end if;
  update public.client_facts set status = 'superseded' where id = v_old.id and workspace_id = p_workspace_id;
  insert into public.client_facts(workspace_id,client_id,category,key,value_json,confidence,importance,
    source_type,source_interaction_id,source_ref,strength,valid_from,created_by,applicability,source_at,valid_until,source_quote)
  values (p_workspace_id,p_client_id,p_fact->>'category',v_key,v_value,
    coalesce((p_fact->>'confidence')::numeric,1),coalesce(p_fact->>'importance','normal'),
    case when p_fact->>'source_interaction_id' is null then 'manual' else 'interaction' end,
    (p_fact->>'source_interaction_id')::uuid,p_fact->>'source_ref',
    coalesce(p_fact->>'strength',case when p_fact->>'category' in ('requirement','constraint') then 'hard'
      when p_fact->>'category' = 'preference' then 'soft' else 'unspecified' end),v_effective,auth.uid(),v_applicability,v_source_at,v_until,p_fact->>'source_quote') returning * into v_new;
  update public.client_facts set superseded_by_id = v_new.id where id = v_old.id and workspace_id = p_workspace_id;
  return v_new;
end;
$$;

