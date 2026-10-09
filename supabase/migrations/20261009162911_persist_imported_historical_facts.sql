-- Unknown historical source/effective instants are NULL, never fabricated midnight
-- or receipt timestamps. Existing facts and receipts are not rewritten/backfilled.
alter table public.client_facts
  alter column valid_from drop not null,
  add column source_date text check (source_date is null or length(trim(source_date)) between 1 and 100),
  add column evidence text check (evidence in ('explicit','agent_reported','inferred','uncertain')),
  add constraint client_facts_unknown_effective_time check
    (valid_from is not null or (applicability is not distinct from 'historical' and valid_until is null));
create unique index client_facts_import_assertion_idx
  on public.client_facts(workspace_id,client_id,source_ref)
  where applicability='historical' and source_ref like 'ai:%';

create or replace function public.guard_client_fact_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Trusted administrators retain fixture cleanup and Auth FK maintenance.
  if exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.applicability := coalesce(new.applicability,'confirmed_current');
    if new.applicability <> 'historical' then
      new.source_at := coalesce(new.source_at,(select occurred_at from public.interactions where id = new.source_interaction_id and workspace_id = new.workspace_id and client_id = new.client_id),new.created_at);
    end if;
    if exists (select 1 from public.interactions where id = new.source_interaction_id and workspace_id = new.workspace_id
      and client_id = new.client_id and channel in ('whatsapp_history','client_import')) and new.applicability <> 'historical' then
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
  v_applicability := coalesce(p_fact->>'applicability',case when v_source.channel in ('whatsapp_history','client_import') then 'historical' else 'confirmed_current' end);
  -- Explicit NULL on historical facts means the source instant is unknown.
  -- Recording time remains in created_at; never use the import receipt as source time.
  if v_applicability = 'historical' and p_fact->'valid_from' = 'null'::jsonb then v_effective := null; end if;
  v_source_at := case when v_applicability = 'historical' and p_fact->'source_at' = 'null'::jsonb then null
    else coalesce((p_fact->>'source_at')::timestamptz,v_source.occurred_at,clock_timestamp()) end;
  v_until := (p_fact->>'valid_until')::timestamptz;
  if v_applicability not in ('confirmed_current','historical','unconfirmed')
    or (v_source.channel in ('whatsapp_history','client_import') and v_applicability <> 'historical')
    or not isfinite(v_source_at) or (v_until is not null and (not isfinite(v_until) or v_effective is null or v_until <= v_effective))
    or (p_fact ? 'source_quote' and (jsonb_typeof(p_fact->'source_quote') <> 'string' or length(trim(p_fact->>'source_quote')) not between 1 and 1000))
    or exists (select 1 from jsonb_each(p_fact) e where e.key in ('applicability','source_at','valid_until') and jsonb_typeof(e.value) <> 'string'
      and not (v_applicability='historical' and e.key='source_at' and e.value='null'::jsonb))
    or exists (select 1 from jsonb_each_text(p_fact) e where e.key in ('source_at','valid_until') and e.value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'Invalid applicability or source time' using errcode = '22023';
  end if;
  if jsonb_typeof(p_fact) is distinct from 'object' or v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,79}$'
    or coalesce(p_fact->>'category','') not in ('requirement','preference','dislike','context','constraint','other')
    or v_value is null or v_value = 'null'::jsonb or octet_length(p_fact::text) > 4096
    or exists (select 1 from jsonb_object_keys(p_fact) k where k not in
      ('category','key','value','confidence','importance','source_interaction_id','source_ref','strength','valid_from','expected_fact_id','applicability','source_at','valid_until','source_quote','source_date','evidence')) then
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
  if (p_fact ? 'valid_from' and not (v_applicability='historical' and p_fact->'valid_from'='null'::jsonb) and (jsonb_typeof(p_fact->'valid_from') <> 'string'
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
      and key = v_key and applicability = v_applicability and valid_from is not distinct from v_effective
      and source_ref is not distinct from p_fact->>'source_ref'
      and source_interaction_id is not distinct from v_source.id
      order by created_at,id limit 1;
    if found and not (p_fact ? 'expected_fact_id') then
      if v_duplicate.value_json is distinct from v_value or v_duplicate.category is distinct from p_fact->>'category'
        or v_duplicate.confidence <> coalesce((p_fact->>'confidence')::numeric,1)
        or v_duplicate.source_quote is distinct from p_fact->>'source_quote'
        or v_duplicate.valid_until is distinct from v_until
        or v_duplicate.source_date is distinct from p_fact->>'source_date'
        or v_duplicate.evidence is distinct from p_fact->>'evidence'
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
    source_type,source_interaction_id,source_ref,strength,valid_from,created_by,applicability,source_at,valid_until,source_quote,source_date,evidence)
  values (p_workspace_id,p_client_id,p_fact->>'category',v_key,v_value,
    coalesce((p_fact->>'confidence')::numeric,1),coalesce(p_fact->>'importance','normal'),
    case when p_fact->>'source_interaction_id' is null then 'manual' else 'interaction' end,
    (p_fact->>'source_interaction_id')::uuid,p_fact->>'source_ref',
    coalesce(p_fact->>'strength',case when p_fact->>'category' in ('requirement','constraint') then 'hard'
      when p_fact->>'category' = 'preference' then 'soft' else 'unspecified' end),v_effective,auth.uid(),v_applicability,v_source_at,v_until,p_fact->>'source_quote',p_fact->>'source_date',p_fact->>'evidence') returning * into v_new;
  update public.client_facts set superseded_by_id = v_new.id where id = v_old.id and workspace_id = p_workspace_id;
  return v_new;
end;
$$;


-- Internal SQL helper, not an additional MCP tool or import workflow.
-- Both new imports and exact receipt retries use the same atomic projection.
create function public.persist_client_import_facts(p_workspace_id uuid,p_receipt_id uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare
  receipt public.interactions; finding jsonb; fact jsonb; saved public.client_facts;
  existing public.client_facts; inserted integer:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.workspace_members
    where workspace_id=p_workspace_id and user_id=auth.uid()) then
    raise exception 'Workspace access denied' using errcode='42501';
  end if;
  select * into receipt from public.interactions where workspace_id=p_workspace_id and id=p_receipt_id
    and channel='client_import' and metadata->>'extraction_version'='ai-findings-v1';
  if not found then raise exception 'Import receipt not found' using errcode='P0002'; end if;
  perform 1 from public.clients where workspace_id=p_workspace_id and id=receipt.client_id for update;
  for finding in select value from jsonb_array_elements(receipt.metadata->'findings') where value->>'kind'='fact' loop
    fact:=finding->'fact'||jsonb_build_object('applicability','historical',
      'source_at',finding->>'occurred_at','valid_from',finding->>'occurred_at',
      'source_interaction_id',receipt.id,'source_ref','ai:'||(receipt.metadata->>'import_key')||':'||(finding->>'key'),
      'evidence',finding->>'evidence',
      'confidence',coalesce((finding->>'confidence')::numeric,case when finding->>'evidence' in ('inferred','uncertain') then 0.5 else 1 end));
    if finding ? 'source_quote' then fact:=fact||jsonb_build_object('source_quote',finding->>'source_quote'); end if;
    if finding ? 'source_date' then fact:=fact||jsonb_build_object('source_date',finding->>'source_date'); end if;
    select * into existing from public.client_facts where workspace_id=p_workspace_id and client_id=receipt.client_id
      and applicability='historical' and source_ref=fact->>'source_ref';
    if found then
      if existing.source_interaction_id is distinct from receipt.id then
        raise exception 'Import assertion belongs to another receipt' using errcode='PT409';
      end if;
      -- Older dated imports have these new columns NULL. Preserve their immutable
      -- rows and retain full evidence in the linked receipt instead of rewriting.
      if existing.evidence is null then fact:=fact-'evidence'; end if;
      if existing.source_date is null then fact:=fact-'source_date'; end if;
    else inserted:=inserted+1; end if;
    saved:=public.remember_client_fact(p_workspace_id,receipt.client_id,fact);
  end loop;
  return inserted;
end;
$$;
revoke all on function public.persist_client_import_facts(uuid,uuid) from public,anon;
grant execute on function public.persist_client_import_facts(uuid,uuid) to authenticated;

create or replace function public.import_client_findings(p_workspace_id uuid,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_client public.clients; v_receipt public.interactions; v_old jsonb;
  finding jsonb; fresh jsonb:='[]'; response jsonb;
  marker text; v_request_key text; interaction_id uuid; relation_id uuid;
  count_matches integer; saved_count integer:=0; fact_count integer:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then
    raise exception 'Workspace access denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>60000
    or length(trim(coalesce(p_request->>'import_key',''))) not between 1 and 80
    or length(trim(coalesce(p_request->>'batch_key',''))) not between 1 and 80
    or length(trim(coalesce(p_request->>'target_display_name',''))) not between 1 and 200
    or jsonb_typeof(p_request->'findings') is distinct from 'array'
    or jsonb_array_length(p_request->'findings') not between 1 and 40
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('import_key','batch_key','target_display_name','source','findings','limitations')) then
    raise exception 'Send a compact results batch, not source text or coverage data' using errcode='22023';
  end if;
  marker:='ai-client-import:'||(p_request->>'import_key');
  v_request_key:='ai:'||encode(pg_catalog.sha256(convert_to((p_request->>'import_key')||chr(10)||(p_request->>'batch_key'),'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('ai-import:'||p_workspace_id::text,0));
  select count(distinct c.id) into count_matches from public.clients c where c.workspace_id=p_workspace_id and
    (c.notes=marker or exists(select 1 from public.interactions r where r.workspace_id=p_workspace_id and r.client_id=c.id
      and r.channel='client_import' and r.metadata->>'import_key'=p_request->>'import_key'));
  if count_matches>1 then raise exception 'Import key resolves to multiple clients' using errcode='PT409'; end if;
  select c.* into v_client from public.clients c where c.workspace_id=p_workspace_id and
    (c.notes=marker or exists(select 1 from public.interactions r where r.workspace_id=p_workspace_id and r.client_id=c.id
      and r.channel='client_import' and r.metadata->>'import_key'=p_request->>'import_key')) for update;
  if found then
    if v_client.display_name<>p_request->>'target_display_name' then
      raise exception 'Import key already belongs to another target name' using errcode='PT409';
    end if;
  else
    if exists(select 1 from public.clients where workspace_id=p_workspace_id and lower(trim(display_name))=lower(trim(p_request->>'target_display_name'))) then
      raise exception 'That exact target name already exists. Choose a distinct new name or continue its original import_key' using errcode='PT409';
    end if;
    select * into v_client from public.create_client_with_facts(p_workspace_id,
      jsonb_build_object('display_name',p_request->>'target_display_name','notes',marker),'[]');
  end if;
  select * into v_receipt from public.interactions r where r.workspace_id=p_workspace_id and r.client_id=v_client.id and r.request_key=v_request_key;
  if found then
    if v_receipt.request_payload<>p_request then raise exception 'Batch key reused with different findings' using errcode='PT409'; end if;
    fact_count:=public.persist_client_import_facts(p_workspace_id,v_receipt.id);
    if fact_count>0 then
      update public.clients set memory_version=memory_version+1 where workspace_id=p_workspace_id and id=v_client.id;
    end if;
    -- Keep the original audit response unchanged, but report the reconciled count.
    return v_receipt.response_json||jsonb_build_object('replayed',true,'historical_facts_count',
      (select count(*) from public.client_facts where workspace_id=p_workspace_id and client_id=v_client.id
        and source_interaction_id=v_receipt.id and applicability='historical' and source_ref like 'ai:%'));
  end if;
  for finding in select value from jsonb_array_elements(p_request->'findings') loop
    if coalesce(finding->>'key','') !~ '^[a-z][a-z0-9_]{0,79}$'
      or coalesce(finding->>'kind','') not in ('fact','property_discussion','interaction','proposed_action')
      or coalesce(finding->>'evidence','') not in ('explicit','agent_reported','inferred','uncertain')
      or length(trim(coalesce(finding->>'summary',''))) not between 1 and 1000
      or (finding ? 'source_quote' and length(trim(finding->>'source_quote')) not between 1 and 1000)
      or (finding ? 'occurred_at' and (finding->>'occurred_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite((finding->>'occurred_at')::timestamptz)))
      or (finding ? 'confidence' and (finding->>'confidence')::numeric not between 0 and 1)
      or ((finding->>'kind'='fact') is distinct from (finding ? 'fact'))
      or exists(select 1 from jsonb_object_keys(finding) k where k not in
        ('key','kind','summary','evidence','occurred_at','source_date','source_speaker','source_quote','confidence','uncertainty','fact','property_id','details'))
      or (select count(*) from jsonb_array_elements(p_request->'findings') f where f->>'key'=finding->>'key')<>1 then
      raise exception 'Invalid compact finding' using errcode='22023';
    end if;
    if finding ? 'fact' and exists(select 1 from jsonb_object_keys(finding->'fact') k where k not in ('category','key','value','strength','importance')) then
      raise exception 'Import fact applicability/provenance are server controlled' using errcode='22023';
    end if;
    if finding ? 'property_id' then
      if finding->>'kind'<>'property_discussion' or not finding ? 'occurred_at' then
        raise exception 'Property history requires a known source instant; otherwise keep narrative' using errcode='22023';
      end if;
      if not exists(select 1 from public.properties where workspace_id=p_workspace_id and id=(finding->>'property_id')::uuid) then
        raise exception 'Property not found in workspace' using errcode='P0002';
      end if;
    end if;
    select old_finding.value into v_old from public.interactions r cross join lateral jsonb_array_elements(coalesce(r.metadata->'findings','[]')) old_finding
      where r.workspace_id=p_workspace_id and r.client_id=v_client.id and r.channel='client_import'
      and r.metadata->>'import_key'=p_request->>'import_key' and old_finding.value->>'key'=finding->>'key' order by r.id limit 1;
    if found then
      if v_old<>finding then raise exception 'Finding key already has different evidence; use a new correction key' using errcode='PT409'; end if;
    else fresh:=fresh||jsonb_build_array(finding); end if;
  end loop;
  insert into public.interactions(workspace_id,client_id,interaction_type,channel,summary,metadata,created_by,request_key,request_payload)
    values(p_workspace_id,v_client.id,'note','client_import','AI findings imported; source dates are carried by individual findings.',
      jsonb_build_object('import_key',p_request->>'import_key','extraction_version','ai-findings-v1','source',p_request->'source',
        'findings',fresh,'limitations',coalesce(p_request->'limitations','[]'),'coverage','not_verified_or_required'),
      auth.uid(),v_request_key,p_request) returning id into interaction_id;
  fact_count:=public.persist_client_import_facts(p_workspace_id,interaction_id);
  for finding in select value from jsonb_array_elements(fresh) loop
    saved_count:=saved_count+1;
    if finding ? 'property_id' then
      select id into relation_id from public.client_properties where workspace_id=p_workspace_id and client_id=v_client.id and property_id=(finding->>'property_id')::uuid;
      if not found then
        insert into public.client_properties(workspace_id,client_id,property_id,status,notes,first_considered_at)
          values(p_workspace_id,v_client.id,(finding->>'property_id')::uuid,'discovered','Historical imported discussion; current interest unconfirmed.',
            (finding->>'occurred_at')::timestamptz) returning id into relation_id;
      end if;
      insert into public.client_property_events(workspace_id,client_property_id,event_type,notes,metadata,interaction_id,occurred_at,created_by)
        values(p_workspace_id,relation_id,'historical_discussion',finding->>'summary',finding,interaction_id,(finding->>'occurred_at')::timestamptz,auth.uid());
    end if;
  end loop;
  update public.clients set memory_version=memory_version+1 where id=v_client.id and workspace_id=p_workspace_id;
  response:=jsonb_build_object('client_id',v_client.id,'display_name',v_client.display_name,'batch_key',p_request->>'batch_key',
    'saved_findings_count',saved_count,'historical_facts_count',fact_count,'replayed',false,
    'limitations',coalesce(p_request->'limitations','[]'));
  update public.interactions set response_json=response where id=interaction_id and workspace_id=p_workspace_id;
  return response;
end;
$$;
revoke all on function public.import_client_findings(uuid,jsonb) from public,anon;
grant execute on function public.import_client_findings(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
