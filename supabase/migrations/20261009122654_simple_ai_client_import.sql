-- Replace the development source-staging workflow with compact AI findings.
-- Existing business clients/history are retained. Applied migration history stays
-- reproducible; only the unused private staging data/API are removed.
drop function public.client_import(uuid,text,jsonb);
drop schema import_private cascade;

create function public.import_client_findings(p_workspace_id uuid,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_client public.clients; v_receipt public.interactions; v_old jsonb;
  finding jsonb; fresh jsonb:='[]'; response jsonb; fact jsonb; v_saved public.client_facts;
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
    return v_receipt.response_json||jsonb_build_object('replayed',true);
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
  for finding in select value from jsonb_array_elements(fresh) loop
    saved_count:=saved_count+1;
    if finding ? 'fact' and finding ? 'occurred_at' then
      fact:=finding->'fact'||jsonb_build_object('applicability','historical','source_at',finding->>'occurred_at',
        'valid_from',finding->>'occurred_at','source_interaction_id',interaction_id,
        'source_ref','ai:'||(p_request->>'import_key')||':'||(finding->>'key'),
        'confidence',coalesce((finding->>'confidence')::numeric,case when finding->>'evidence' in ('inferred','uncertain') then 0.5 else 1 end));
      if finding ? 'source_quote' then fact:=fact||jsonb_build_object('source_quote',finding->>'source_quote'); end if;
      v_saved:=public.remember_client_fact(p_workspace_id,v_client.id,fact);
      fact_count:=fact_count+1;
    end if;
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
