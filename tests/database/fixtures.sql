-- Synthetic fixture IDs only. This file is used solely by the disposable cluster test.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.workspaces(id,name) values
  ('20000000-0000-4000-8000-000000000001','fixture A'),
  ('20000000-0000-4000-8000-000000000002','fixture B'),
  ('20000000-0000-4000-8000-000000000003','fixture forbidden');
insert into public.workspace_members(workspace_id,user_id) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
insert into public.clients(id,workspace_id,display_name) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','John'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','John other tenant'),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Other client');
insert into public.interactions(id,workspace_id,client_id,summary) values
  ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Budget discussion'),
  ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Foreign discussion');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '{"category":"requirement","key":"budget_max","value":{"amount":4000000,"currency":"MXN"},"source_interaction_id":"40000000-0000-4000-8000-000000000001","source_ref":"fixture call"}');
select public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '{"category":"requirement","key":"budget_max","value":{"amount":4500000,"currency":"MXN"}}');
reset role;
insert into public.properties(id,workspace_id,title) values
  ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Marbella fixture'),
  ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Foreign property');
set role authenticated;
select public.update_client_property('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','{"status":"considering"}');
reset role;
