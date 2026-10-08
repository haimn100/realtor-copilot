-- Runs only against the disposable PostgreSQL cluster from migrations.test.ts.
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';

do $$
declare field text;
begin
  foreach field in array array['workspace_id','client_id','category','key','value_json','confidence','importance',
    'source_type','source_interaction_id','source_ref','valid_from','created_by','created_at'] loop
    begin
      execute format('update public.client_facts set %I=%I where status=''superseded''',field,field);
      raise exception 'Mutable immutable fact column: %',field;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    update public.client_facts set status='current' where status='superseded';
    raise exception 'History status changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.client_facts set superseded_by_id=null where status='superseded';
    raise exception 'History successor changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.client_facts;
    raise exception 'History deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.client_facts(workspace_id,client_id,category,key,value_json,status,created_by)
    values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      'context','fake_history','true','retracted',auth.uid());
    raise exception 'Fabricated historical fact inserted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.client_facts set status='superseded' where status='current';
    set constraints all immediate;
    raise exception 'Incomplete supersession committed';
  exception when check_violation then null;
  end;
  begin
    update public.client_facts set status='superseded' where status='current';
    update public.client_facts set superseded_by_id=(select id from public.client_facts where key='budget_max' and superseded_by_id is not null)
      where key='budget_max' and superseded_by_id is null;
    set constraints all immediate;
    raise exception 'Cyclic history committed';
  exception when check_violation then null;
  end;
end;
$$;

-- Existing transactional client operations still work, including category changes.
select public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '{"category":"preference","key":"preconstruction","value":true}');
select public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '{"category":"constraint","key":"preconstruction","value":false}');
set constraints all immediate;
set constraints all deferred;
do $$
begin
  if (select count(*) from public.client_facts where key='preconstruction' and status='current' and category='constraint') <> 1 then
    raise exception 'Category replacement failed';
  end if;
  begin
    perform public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      '{"category":"invalid","key":"budget_max","value":1}');
    raise exception 'Invalid replacement succeeded';
  exception when check_violation then null;
  end;
  if (select value_json->>'amount' from public.client_facts where key='budget_max' and status='current') <> '4500000' then
    raise exception 'Failed replacement changed budget';
  end if;
  begin
    perform public.create_client_with_facts('20000000-0000-4000-8000-000000000001',
      '{"display_name":"Must roll back"}','[{"category":"invalid","key":"bad","value":true}]');
    raise exception 'Invalid initial facts succeeded';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.clients where display_name='Must roll back') then raise exception 'Creation was not atomic'; end if;
  begin
    perform public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      '{"category":"context","key":"bad_source","value":true,"source_interaction_id":"40000000-0000-4000-8000-000000000002"}');
    raise exception 'Cross-workspace source accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_client_with_facts('20000000-0000-4000-8000-000000000003','{"display_name":"Denied"}');
    raise exception 'Non-member RPC accepted';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.workspaces where id='20000000-0000-4000-8000-000000000003') then raise exception 'RLS exposed non-member workspace'; end if;
end;
$$;

-- Existing property lifecycle, no-op events, and atomic rollback.
do $$
declare saved jsonb; v_property_id uuid; relation public.client_properties; events bigint;
begin
  saved := public.save_property('20000000-0000-4000-8000-000000000001',
    '{"title":"Saved fixture","bedrooms":2,"asking_price":3800000,"currency":"MXN"}',null,
    '{"source_name":"Broker","external_id":"fixture-1","availability_status":"available","availability_verified":true}');
  v_property_id := (saved->'property'->>'id')::uuid;
  perform public.save_property('20000000-0000-4000-8000-000000000001','{"notes":"Known details retained"}',v_property_id,
    '{"source_name":"Other broker","external_id":"fixture-2","availability_status":"available"}');
  if (select bedrooms from public.properties where id=v_property_id) <> 2 then raise exception 'Property patch lost omitted details'; end if;
  if (select count(*) from public.property_sources s where s.property_id=v_property_id) <> 2 then raise exception 'Sources not preserved'; end if;
  perform public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',v_property_id,'{"status":"considering"}');
  perform public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',v_property_id,'{"status":"sent"}');
  perform public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',v_property_id,'{"status":"liked","notes":"Likes location"}');
  relation := public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',v_property_id,'{"status":"rejected","rejection_reason":"HOA too high"}');
  if relation.notes <> 'Likes location' or relation.sent_at is null then raise exception 'Relationship omitted fields lost'; end if;
  select count(*) into events from public.client_property_events where client_property_id=relation.id;
  perform public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',v_property_id,'{"status":"rejected","rejection_reason":"HOA too high"}');
  if events <> 4 or (select count(*) from public.client_property_events where client_property_id=relation.id) <> 4 then raise exception 'Timeline/no-op regression'; end if;
  begin
    perform public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',v_property_id,
      jsonb_build_object('status','liked','notes',repeat('x',2001)));
    raise exception 'Invalid event accepted';
  exception when check_violation then null;
  end;
  if (select status from public.client_properties where id=relation.id) <> 'rejected' then raise exception 'Event failure did not roll back relationship'; end if;
  begin
    perform public.save_property('20000000-0000-4000-8000-000000000001','{"title":"Invalid source rollback"}',null,
      '{"source_name":"Broker","availability_status":"invalid"}');
    raise exception 'Invalid source accepted';
  exception when invalid_parameter_value then null;
  end;
  if exists(select 1 from public.properties where title='Invalid source rollback') then raise exception 'Source failure did not roll back property'; end if;
  begin
    update public.client_property_events set notes='Rewrite';
    raise exception 'Events mutable';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set role anon;
do $$ begin
  begin perform * from public.clients; raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.create_client_with_facts('20000000-0000-4000-8000-000000000001','{"display_name":"Anonymous"}');
    raise exception 'Anonymous RPC allowed'; exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- Even a trusted administrator cannot create cross-tenant parent links. These
-- failures come from database constraints, independently of application/RLS filters.
do $$ begin
  begin insert into public.interactions(workspace_id,client_id) values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
    raise exception 'Interaction tenant mismatch accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.property_sources(workspace_id,property_id,source_name) values ('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','Wrong tenant');
    raise exception 'Source tenant mismatch accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.tasks(workspace_id,client_id,title) values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','Wrong tenant');
    raise exception 'Task tenant mismatch accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.tasks(workspace_id,assigned_to,title) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Non-member assignment');
    raise exception 'Task non-member assignment accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.client_facts(workspace_id,client_id,category,key,value_json,source_interaction_id) values
    ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','context','bad_same_tenant_source','true','40000000-0000-4000-8000-000000000001');
    raise exception 'Another client source accepted'; exception when foreign_key_violation then null; end;
end; $$;
select 'PASS: immutable history, source attribution, complete supersession, RLS, atomic client/property workflows and tenant constraints';
