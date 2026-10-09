-- Durable staging must precede client identification. Keep it outside the Data
-- API schema; business memory continues to use the existing thirteen tables.
create schema if not exists import_private;
revoke all on schema import_private from public, anon;
grant usage on schema import_private to authenticated;
create table import_private.sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  document jsonb not null,
  batches jsonb not null default '{}'::jsonb,
  final_request jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  unique(workspace_id,source_sha256),
  check (jsonb_typeof(document)='object' and jsonb_typeof(batches)='object'),
  check ((final_request is null) = (result is null))
);
alter table import_private.sessions enable row level security;
revoke all on import_private.sessions from public, anon, authenticated;
grant select,insert on import_private.sessions to authenticated;
grant update(batches,final_request,result) on import_private.sessions to authenticated;
create policy owner_sessions on import_private.sessions for all to authenticated
  using (created_by=(select auth.uid()) and workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())))
  with check (created_by=(select auth.uid()) and workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));

create function import_private.guard_session() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.document<>old.document or new.source_sha256<>old.source_sha256
    or new.workspace_id<>old.workspace_id or new.created_by<>old.created_by or new.created_at<>old.created_at
    or old.result is not null or exists(select 1 from jsonb_each(old.batches) prior_batch where new.batches->prior_batch.key is distinct from prior_batch.value)) then
    raise exception 'Import source, accepted batches and completion are immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger immutable_import before update on import_private.sessions for each row execute function import_private.guard_session();

-- Exact message occurrence and semantic event key dedup across overlapping exports.
create unique index interactions_generic_import_occurrence_idx on public.interactions(workspace_id,client_id,external_id)
  where channel='client_import' and external_id is not null;

-- The ordinary fact tools must also fail closed when reusing an imported source.
-- Extend the existing historical-source guard without changing its revision logic.
do $$
declare signature text; definition text; updated text;
begin
  foreach signature in array array['public.guard_client_fact_history()','public.remember_client_fact(uuid,uuid,jsonb)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,'channel = ''whatsapp_history''','channel in (''whatsapp_history'',''client_import'')');
    if updated=definition then raise exception 'Expected historical source guard not found in %',signature; end if;
    execute updated;
  end loop;
end;
$$;

create function import_private.check_citations(p_document jsonb,p_citations jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c jsonb; m jsonb;
begin
  if jsonb_typeof(p_citations) is distinct from 'array' or jsonb_array_length(p_citations) not between 1 and 10 then
    raise exception 'Literal source citations are required' using errcode='22023';
  end if;
  for c in select value from jsonb_array_elements(p_citations) loop
    select value into m from jsonb_array_elements(p_document->'messages') where value->>'message_id'=c->>'message_id';
    if m is null or length(trim(coalesce(c->>'quote',''))) not between 1 and 1000
      or strpos(m->>'body',c->>'quote')=0 then
      raise exception 'Citation does not match source message' using errcode='22023';
    end if;
  end loop;
end;
$$;

-- Normalize citation IDs by message occurrence so the same event in an extended
-- export can deduplicate despite different file checksums and source line IDs.
create function import_private.semantic_evidence(p_document jsonb,p_value jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; item record; msg jsonb;
begin
  if jsonb_typeof(p_value)='array' then
    result:='[]';
    for item in select value from jsonb_array_elements(p_value) loop
      result:=result||jsonb_build_array(import_private.semantic_evidence(p_document,item.value));
    end loop;
  elsif jsonb_typeof(p_value)='object' then
    result:='{}';
    for item in select key,value from jsonb_each(p_value) loop
      if item.key in ('message_id','anchor_message_id') then
        select value into msg from jsonb_array_elements(p_document->'messages') where value->'message_id'=item.value;
        result:=result||jsonb_build_object(item.key,encode(public.digest(convert_to((msg->>'speaker')||chr(10)||(msg->>'occurred_at')||chr(10)||(msg->>'body'),'UTF8'),'sha256'),'hex'));
      else result:=result||jsonb_build_object(item.key,import_private.semantic_evidence(p_document,item.value)); end if;
    end loop;
  else result:=p_value; end if;
  return result;
end;
$$;

create function public.client_import(p_workspace_id uuid,p_operation text,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  s import_private.sessions; d jsonb; b jsonb; e jsonb; f jsonb; c jsonb; m jsonb; i jsonb; p jsonb;
  accepted jsonb; missing jsonb; ids jsonb; facts jsonb; saved jsonb; outcome jsonb; payload jsonb;
  v_client public.clients; v_property uuid; v_relation uuid; v_interaction uuid;
  idx integer; count_matches integer; replayed boolean:=false; ref text; occurrence text; marker text;
begin
  if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then
    raise exception 'Workspace access denied' using errcode='42501';
  end if;
  if p_operation not in ('start','read','submit','finalize') or jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'Invalid import operation' using errcode='22023';
  end if;
  if p_operation='start' then
    d:=p_request->'document';
    if d->>'version' is distinct from 'client-import-v1' or d->>'source_kind' is distinct from 'whatsapp_txt'
      or octet_length(coalesce(d->>'source_text','')) not between 1 and 2097152
      or d->>'source_sha256' is distinct from encode(public.digest(convert_to(d->>'source_text','UTF8'),'sha256'),'hex')
      or jsonb_typeof(d->'messages') is distinct from 'array' or jsonb_array_length(d->'messages')<1
      or jsonb_typeof(d->'chunks') is distinct from 'array' or jsonb_array_length(d->'chunks')<1 then
      raise exception 'Invalid source document/version/checksum' using errcode='22023';
    end if;
    -- No missing/duplicate/extra message identifiers in the chunk partition.
    if (select jsonb_agg(x order by x) from jsonb_array_elements(d->'chunks') a cross join lateral jsonb_array_elements(a) x)
      is distinct from (select jsonb_agg(value->'message_id' order by value->'message_id') from jsonb_array_elements(d->'messages'))
      or (select count(*) from jsonb_array_elements(d->'messages'))<>(select count(distinct value->>'message_id') from jsonb_array_elements(d->'messages'))
      or exists(select 1 from jsonb_array_elements(d->'chunks') a where jsonb_array_length(a) not between 1 and 20) then
      raise exception 'Invalid source chunk partition' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||(d->>'source_sha256'),0));
    select * into s from import_private.sessions where workspace_id=p_workspace_id and source_sha256=d->>'source_sha256' for update;
    if found then
      if s.document<>d then raise exception 'Source already staged with different parser settings/name' using errcode='PT409'; end if;
      replayed:=true;
    else
      begin
        insert into import_private.sessions(workspace_id,created_by,source_sha256,document)
          values(p_workspace_id,auth.uid(),d->>'source_sha256',d) returning * into s;
      exception when unique_violation then raise exception 'Source already staged by another workspace member' using errcode='PT409'; end;
    end if;
  else
    select * into s from import_private.sessions where id=(p_request->>'session_id')::uuid and workspace_id=p_workspace_id for update;
    if not found then raise exception 'Import session not found' using errcode='P0002'; end if;
    d:=s.document;
  end if;

  if p_operation in ('submit','finalize') and p_request->>'version' is distinct from d->>'version' then
    raise exception 'Extraction contract version mismatch' using errcode='22023';
  end if;
  if p_operation='submit' then
    idx:=(p_request->>'chunk_index')::integer; ids:=d->'chunks'->idx;
    if idx<0 or ids is null or octet_length(p_request::text)>60000
      or jsonb_typeof(p_request->'dispositions') is distinct from 'array'
      or jsonb_typeof(p_request->'events') is distinct from 'array' or jsonb_array_length(p_request->'events')>20
      or (select jsonb_agg(value order by value) from jsonb_array_elements(ids))
        is distinct from (select jsonb_agg(value->'message_id' order by value->'message_id') from jsonb_array_elements(p_request->'dispositions'))
      or exists(select 1 from jsonb_array_elements(p_request->'dispositions') where coalesce(value->>'classification','') not in ('business','irrelevant','ambiguous')) then
      raise exception 'Batch must classify exactly all messages in its server chunk' using errcode='22023';
    end if;
    if s.batches ? idx::text then
      if s.batches->idx::text <> p_request then raise exception 'Accepted chunk has a different payload; do not revise an accepted batch' using errcode='PT409'; end if;
      replayed:=true;
    elsif s.result is not null then raise exception 'Import already completed' using errcode='PT409';
    else
      for e in select value from jsonb_array_elements(p_request->'events') loop
        if coalesce(e->>'key','') !~ '^[a-z][a-z0-9_]{0,79}$' or not ids ? (e->>'anchor_message_id')
          or not exists(select 1 from jsonb_array_elements(e->'citations') where value->>'message_id'=e->>'anchor_message_id')
          or coalesce(e->>'evidence','') not in ('explicit','agent_reported','inferred')
          or jsonb_typeof(e->'confidence') is distinct from 'number' or (e->>'confidence')::numeric not between 0 and 1
          or length(trim(coalesce(e->>'summary',''))) not between 1 and 2000
          or jsonb_typeof(e->'facts') is distinct from 'array' or jsonb_array_length(e->'facts')>20
          or jsonb_typeof(e->'uncertainty') is distinct from 'array'
          or jsonb_typeof(e->'property_claims') is distinct from 'array'
          or jsonb_typeof(e->'proposed_next_actions') is distinct from 'array'
          or exists(select 1 from jsonb_array_elements(p_request->'dispositions') where value->>'message_id'=e->>'anchor_message_id' and value->>'classification'='irrelevant')
          or (select count(*) from jsonb_array_elements(p_request->'events') where value->>'key'=e->>'key')<>1
          or exists(select 1 from jsonb_each(s.batches) a cross join lateral jsonb_array_elements(a.value->'events') old where old->>'key'=e->>'key') then
          raise exception 'Invalid/duplicate event or anchor' using errcode='22023';
        end if;
        perform import_private.check_citations(d,e->'citations');
        for f in select value from jsonb_array_elements(e->'facts') loop
          perform import_private.check_citations(d,f->'citations');
          if coalesce(f->>'evidence','') not in ('explicit','agent_reported','inferred')
            or not exists(select 1 from jsonb_array_elements(f->'citations') where value->>'message_id'=e->>'anchor_message_id')
            or (f->'fact') ?| array['applicability','source_at','valid_from','valid_until','source_quote','source_ref','source_interaction_id','expected_fact_id'] then
            raise exception 'Fact time/applicability/provenance must be derived from source' using errcode='22023';
          end if;
        end loop;
        if e ? 'property' then
          perform import_private.check_citations(d,e->'property'->'citations');
          if (e->'property' ? 'property_id')=(e->'property' ? 'new_candidate') then raise exception 'Resolve property identity' using errcode='22023'; end if;
          if e->'property' ? 'new_candidate' and not exists(select 1 from jsonb_array_elements(e->'property'->'citations') where
            length(coalesce(e->'property'->'new_candidate'->>'unit_identity',''))>0 and strpos(value->>'quote',e->'property'->'new_candidate'->>'unit_identity')>0) then
            raise exception 'Exact unit identity must be cited' using errcode='22023';
          end if;
          if e->'property' ? 'new_candidate' and exists(select 1 from unnest(array['city','state','country']) field_name
            where length(coalesce(e->'property'->'new_candidate'->>field_name,''))=0 or not exists(select 1 from jsonb_array_elements(e->'property'->'citations')
              where strpos(value->>'quote',e->'property'->'new_candidate'->>field_name)>0)) then
            raise exception 'New candidate requires literal location evidence' using errcode='22023';
          end if;
          if e->'property' ? 'property_id' and not exists(select 1 from public.properties where workspace_id=p_workspace_id and id=(e->'property'->>'property_id')::uuid) then
            raise exception 'Property not found in workspace' using errcode='P0002';
          end if;
        end if;
        for c in select value from jsonb_array_elements(e->'property_claims') loop perform import_private.check_citations(d,c->'citations'); end loop;
      end loop;
      update import_private.sessions set batches=batches||jsonb_build_object(idx::text,p_request) where id=s.id returning * into s;
    end if;
  end if;

  select coalesce(jsonb_agg(n order by n),'[]') into accepted from generate_series(0,jsonb_array_length(d->'chunks')-1) n where s.batches ? n::text;
  select coalesce(jsonb_agg(n order by n),'[]') into missing from generate_series(0,jsonb_array_length(d->'chunks')-1) n where not s.batches ? n::text;
  if p_operation='finalize' then
    if s.result is not null then
      if s.final_request<>p_request then raise exception 'Completed import identity differs' using errcode='PT409'; end if;
      replayed:=true;
    else
      if jsonb_array_length(missing)>0 then raise exception 'Cannot complete: source chunks remain uncovered' using errcode='22023'; end if;
      i:=p_request->'identity';
      perform import_private.check_citations(d,i->'citations');
      if length(trim(coalesce(i->>'display_name',''))) not between 1 and 200 or jsonb_typeof(i->'agent_speakers') is distinct from 'array'
        or jsonb_array_length(i->'agent_speakers')<1 or i->'agent_speakers' ? (i->>'client_speaker')
        or not exists(select 1 from jsonb_array_elements(d->'messages') where value->>'speaker'=i->>'client_speaker')
        or exists(select 1 from jsonb_array_elements_text(i->'agent_speakers') a where not exists(select 1 from jsonb_array_elements(d->'messages') where value->>'speaker'=a))
        or exists(select 1 from jsonb_array_elements(i->'citations') identity_cite where not exists(select 1 from jsonb_array_elements(d->'messages') identity_msg where identity_msg->>'message_id'=identity_cite->>'message_id' and identity_msg->>'speaker'=i->>'client_speaker'))
        or (i->>'display_name'<>i->>'client_speaker' and not exists(select 1 from jsonb_array_elements(i->'citations') where strpos(value->>'quote',i->>'display_name')>0)) then
        raise exception 'Identify source client distinct from agent, with literal client identity evidence' using errcode='22023';
      end if;
      -- Serialize import entity resolution across all sources in this workspace.
      perform pg_advisory_xact_lock(hashtextextended('client-import-finalize:'||p_workspace_id::text,0));
      if i ? 'existing_client_id' then
        select * into v_client from public.clients where workspace_id=p_workspace_id and id=(i->>'existing_client_id')::uuid for update;
        if not found then raise exception 'Client not found in workspace' using errcode='P0002'; end if;
        if strpos(lower(v_client.display_name),lower(i->>'display_name'))=0 and strpos(lower(i->>'display_name'),lower(v_client.display_name))=0 then
          raise exception 'Existing client name does not match the evidenced identity; resolve aliases before importing' using errcode='PT409';
        end if;
      else
        select count(*) into count_matches from public.clients where workspace_id=p_workspace_id and
          (strpos(lower(display_name),lower(i->>'display_name'))>0 or strpos(lower(i->>'display_name'),lower(display_name))>0);
        if count_matches>0 then raise exception 'Possible existing client. Use find_clients to resolve and supply existing_client_id; never create a duplicate' using errcode='PT409'; end if;
        saved:=to_jsonb(public.create_client_with_facts(p_workspace_id,jsonb_build_object('display_name',i->>'display_name','notes','Client identified from historical conversation; present requirements unconfirmed.'),'[]'));
        select * into v_client from public.clients where id=(saved->>'id')::uuid and workspace_id=p_workspace_id;
      end if;
      outcome:=jsonb_build_object('interactions',0,'facts',0,'property_events',0,'tasks',0,'coverage','all_parsed_text_messages_classified','semantic_verification','AI extraction; not independently verified');
      -- Source occurrence order, never chunk submission order.
      for e,m in select ev,msg from jsonb_each(s.batches) a cross join lateral jsonb_array_elements(a.value->'events') ev
        join lateral (select value msg from jsonb_array_elements(d->'messages') where value->>'message_id'=ev->>'anchor_message_id') msgs on true
        order by (msg->>'occurred_at')::timestamptz,(msg->>'line_start')::integer,ev->>'key' loop
        ref:='import:'||s.source_sha256||':'||(e->>'anchor_message_id');
        occurrence:='import:'||encode(public.digest(convert_to((m->>'speaker')||chr(10)||(m->>'occurred_at')||chr(10)||(m->>'body'),'UTF8'),'sha256'),'hex')||':'||(e->>'key');
        payload:=import_private.semantic_evidence(d,e)-'anchor_message_id';
        -- An overlapping export must not silently reinterpret an existing event.
        select id into v_interaction from public.interactions where workspace_id=p_workspace_id and client_id=v_client.id and channel='client_import'
          and (external_id=occurrence or (split_part(external_id,':',2)=split_part(occurrence,':',2) and (metadata->'semantic_payload')-'key'=payload-'key')) order by id limit 1;
        if found then
          if not exists(select 1 from public.interactions where id=v_interaction and (metadata->'semantic_payload')-'key'=payload-'key') then
            raise exception 'Overlapping message event has differing extraction; reconcile instead of duplicating' using errcode='PT409';
          end if;
          continue;
        end if;
        insert into public.interactions(workspace_id,client_id,interaction_type,channel,occurred_at,summary,external_id,metadata,created_by)
          values(p_workspace_id,v_client.id,'message','client_import',(m->>'occurred_at')::timestamptz,e->>'summary',occurrence,
            jsonb_build_object('source_ref',ref,'source_sha256',s.source_sha256,'import_session_id',s.id,'extraction_version',d->>'version',
              'source_name',d->>'source_name','anchor',m-'body','citations',
                (select jsonb_agg(cited.value || (source_msg.value-'body')) from jsonb_array_elements(e->'citations') cited
                  join lateral (select value from jsonb_array_elements(d->'messages') where value->>'message_id'=cited.value->>'message_id') source_msg on true),
              'semantic_payload',payload,
              'evidence',e->'evidence','confidence',e->'confidence','uncertainty',e->'uncertainty','property_claims',e->'property_claims','proposed_next_actions',e->'proposed_next_actions'),auth.uid()) returning id into v_interaction;
        outcome:=jsonb_set(outcome,'{interactions}',to_jsonb((outcome->>'interactions')::integer+1));
        for f in select value from jsonb_array_elements(e->'facts') loop
          if f->>'evidence'='explicit' and not exists(select 1 from jsonb_array_elements(f->'citations') fact_cite
            join lateral (select value from jsonb_array_elements(d->'messages') where value->>'message_id'=fact_cite->>'message_id' and value->>'speaker'=i->>'client_speaker') client_message on true) then
            raise exception 'Explicit client facts must cite the client, not only the realtor' using errcode='22023';
          end if;
          select string_agg(value->>'quote',chr(10)) into marker from jsonb_array_elements(f->'citations');
          if length(marker)>1000 then raise exception 'Combined fact evidence exceeds 1000 characters' using errcode='22023'; end if;
          perform public.remember_client_fact(p_workspace_id,v_client.id,f->'fact'||jsonb_build_object('applicability','historical',
            'confidence',least(coalesce((f->'fact'->>'confidence')::numeric,(e->>'confidence')::numeric),(e->>'confidence')::numeric),
            'valid_from',m->>'occurred_at','source_at',m->>'occurred_at','source_quote',marker,'source_ref',ref,'source_interaction_id',v_interaction));
          outcome:=jsonb_set(outcome,'{facts}',to_jsonb((outcome->>'facts')::integer+1));
        end loop;
        if e ? 'property' then
          p:=e->'property';
          if p ? 'property_id' then
            select id into v_property from public.properties where workspace_id=p_workspace_id and id=(p->>'property_id')::uuid;
            if not found then raise exception 'Property not found in workspace' using errcode='P0002'; end if;
          else
            p:=p->'new_candidate';
            marker:='import-unit:'||encode(public.digest(convert_to(lower(trim(p->>'unit_identity'))||'|'||lower(trim(p->>'city'))||'|'||lower(trim(p->>'state'))||'|'||lower(trim(p->>'country')),'UTF8'),'sha256'),'hex');
            select id into v_property from public.properties where workspace_id=p_workspace_id and notes=marker;
            if not found then
              if exists(select 1 from public.properties where workspace_id=p_workspace_id and
                (strpos(lower(coalesce(title,'')),lower(p->>'title'))>0 or strpos(lower(p->>'title'),lower(coalesce(nullif(title,''),'__no_title__')))>0
                  or (development_name is not null and strpos(lower(p->>'title'),lower(development_name))>0))) then
                raise exception 'Possible saved property match. Resolve with get_property_context and supply property_id' using errcode='PT409';
              end if;
              if exists(select 1 from public.property_sources existing_source cross join lateral jsonb_array_elements(e->'property'->'citations') property_cite
                where existing_source.workspace_id=p_workspace_id and existing_source.url is not null and strpos(property_cite->>'quote',existing_source.url)>0) then
                raise exception 'Cited link already belongs to a saved property. Resolve identity and supply property_id' using errcode='PT409';
              end if;
              saved:=public.save_property(p_workspace_id,p-'unit_identity'||jsonb_build_object('notes',marker),null,null);
              v_property:=(saved->'property'->>'id')::uuid;
            end if;
          end if;
          select id into v_relation from public.client_properties where workspace_id=p_workspace_id and client_id=v_client.id and property_id=v_property;
          if not found then
            insert into public.client_properties(workspace_id,client_id,property_id,status,notes,first_considered_at)
              values(p_workspace_id,v_client.id,v_property,'discovered','Historical import association only; current interest unconfirmed.',(m->>'occurred_at')::timestamptz) returning id into v_relation;
          end if;
          insert into public.client_property_events(workspace_id,client_property_id,event_type,notes,metadata,interaction_id,occurred_at,created_by)
            values(p_workspace_id,v_relation,'historical_discussion',e->>'summary',jsonb_build_object('source_ref',ref,'import_session_id',s.id,
              'evidence',e->'evidence','confidence',e->'confidence','uncertainty',e->'uncertainty','citations',
                (select jsonb_agg(cited.value || (source_msg.value-'body')) from jsonb_array_elements(e->'citations') cited
                  join lateral (select value from jsonb_array_elements(d->'messages') where value->>'message_id'=cited.value->>'message_id') source_msg on true),
              'property_claims',e->'property_claims'),v_interaction,(m->>'occurred_at')::timestamptz,auth.uid());
          outcome:=jsonb_set(outcome,'{property_events}',to_jsonb((outcome->>'property_events')::integer+1));
        end if;
      end loop;
      update public.clients set memory_version=memory_version+1 where id=v_client.id and workspace_id=p_workspace_id;
      outcome:=outcome||jsonb_build_object('client_id',v_client.id);
      update import_private.sessions set final_request=p_request,result=outcome where id=s.id returning * into s;
    end if;
  end if;
  return jsonb_build_object('document',s.document,'batches',s.batches,'progress',jsonb_build_object('session_id',s.id,'version',d->>'version',
    'source_sha256',s.source_sha256,'status',case when s.result is null then 'staging' else 'completed' end,
    'total_messages',jsonb_array_length(d->'messages'),'total_chunks',jsonb_array_length(d->'chunks'),
    'accepted_chunks',accepted,'missing_chunks',missing,'client_id',s.result->'client_id','result',s.result,'replayed',replayed));
end;
$$;
revoke all on function public.client_import(uuid,text,jsonb) from public,anon;
grant execute on function public.client_import(uuid,text,jsonb) to authenticated;
revoke all on all functions in schema import_private from public,anon;
grant execute on all functions in schema import_private to authenticated;
notify pgrst,'reload schema';
