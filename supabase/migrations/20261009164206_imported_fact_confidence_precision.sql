-- Normalize projection to existing numeric(4,3) storage precision.
-- Full supplied confidence remains in the unchanged receipt. Exact retries
-- must compare the same rounded value, including pre-fix dated imports.
create or replace function public.persist_client_import_facts(p_workspace_id uuid,p_receipt_id uuid) returns integer
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
      'confidence',round(coalesce((finding->>'confidence')::numeric,case when finding->>'evidence' in ('inferred','uncertain') then 0.5 else 1 end),3));
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

notify pgrst,'reload schema';
