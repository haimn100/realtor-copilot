-- Extend the existing entities only. Runtime functions and trigger execute as
-- the authenticated caller; workspace membership RLS remains active.
create policy members_insert_properties on public.properties for insert to authenticated
with check (created_by = (select auth.uid()) and workspace_id in (
  select workspace_id from public.workspace_members where user_id = (select auth.uid())
));
create policy members_update_properties on public.properties for update to authenticated
using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())))
with check (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())));

create policy members_insert_property_sources on public.property_sources for insert to authenticated
with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and exists (select 1 from public.properties p where p.id = property_id and p.workspace_id = property_sources.workspace_id)
);
create policy members_insert_client_properties on public.client_properties for insert to authenticated
with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and exists (select 1 from public.clients c where c.id = client_id and c.workspace_id = client_properties.workspace_id)
  and exists (select 1 from public.properties p where p.id = property_id and p.workspace_id = client_properties.workspace_id)
);
create policy members_update_client_properties on public.client_properties for update to authenticated
using (workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid())))
with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and exists (select 1 from public.clients c where c.id = client_id and c.workspace_id = client_properties.workspace_id)
  and exists (select 1 from public.properties p where p.id = property_id and p.workspace_id = client_properties.workspace_id)
);
create policy members_append_client_property_events on public.client_property_events for insert to authenticated
with check (
  created_by = (select auth.uid())
  and workspace_id in (select workspace_id from public.workspace_members where user_id = (select auth.uid()))
  and exists (select 1 from public.client_properties cp
    join public.clients c on c.id = cp.client_id and c.workspace_id = cp.workspace_id
    join public.properties p on p.id = cp.property_id and p.workspace_id = cp.workspace_id
    where cp.id = client_property_id and cp.workspace_id = client_property_events.workspace_id
    and (interaction_id is null or exists (select 1 from public.interactions i
      where i.id = interaction_id and i.workspace_id = cp.workspace_id and i.client_id = cp.client_id)))
);

-- Do not allow authenticated callers to reparent records, edit/delete events,
-- or truncate tables. Admin setup and disposable fixture cleanup are unaffected.
revoke all on public.properties, public.property_sources, public.client_properties, public.client_property_events from anon, authenticated;
grant select, insert on public.properties, public.property_sources, public.client_properties, public.client_property_events to authenticated;
grant update (title, property_type, development_name, address, neighborhood, city, state, country,
  bedrooms, bathrooms, interior_m2, exterior_m2, total_m2, asking_price, currency,
  construction_status, delivery_date, notes, updated_at) on public.properties to authenticated;
grant update (status, interest_level, notes, rejection_reason, sent_at, viewed_at, updated_at)
on public.client_properties to authenticated;

-- History text stays compact even when written directly through the Data API.
alter table public.client_property_events add constraint client_property_event_notes_size
check (notes is null or char_length(notes) <= 2000) not valid;

create function public.append_client_property_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_previous_status text;
  v_event_type text;
begin
  -- Historical fixtures may predate this trigger. New writes must have valid parents.
  if not exists (select 1 from public.clients where id = new.client_id and workspace_id = new.workspace_id)
    or not exists (select 1 from public.properties where id = new.property_id and workspace_id = new.workspace_id) then
    raise exception 'Relationship parents must belong to the same workspace' using errcode = '23514';
  end if;
  if new.status not in ('discovered','considering','sent','interested','liked','rejected',
    'viewing_scheduled','viewed','offer_considered','offer_made','closed')
    or char_length(new.rejection_reason) > 1000 then
    raise exception 'Invalid relationship state or rejection reason' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if (new.workspace_id, new.client_id, new.property_id) is distinct from (old.workspace_id, old.client_id, old.property_id) then
      raise exception 'Relationship identity cannot change' using errcode = '23514';
    end if;
    if (new.status, new.interest_level, new.notes, new.rejection_reason, new.sent_at, new.viewed_at)
      is not distinct from (old.status, old.interest_level, old.notes, old.rejection_reason, old.sent_at, old.viewed_at) then
      return new;
    end if;
    v_previous_status := old.status;
  end if;
  v_event_type := case when v_previous_status is not distinct from new.status then 'relationship_updated' else new.status end;
  -- clock_timestamp records write order after serialization, not transaction start.
  insert into public.client_property_events(workspace_id, client_property_id, event_type, notes, metadata, occurred_at, created_by)
  values (new.workspace_id, new.id, v_event_type, new.notes,
    jsonb_build_object('previous_status', v_previous_status, 'status', new.status,
      'interest_level', new.interest_level, 'rejection_reason', new.rejection_reason,
      'sent_at', new.sent_at, 'viewed_at', new.viewed_at), pg_catalog.clock_timestamp(), auth.uid());
  return new;
end;
$$;
create trigger client_property_history after insert or update on public.client_properties
for each row execute function public.append_client_property_event();

create function public.update_client_property(p_workspace_id uuid, p_client_id uuid, p_property_id uuid, p_changes jsonb)
returns public.client_properties language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.client_properties;
  v_new public.client_properties;
  v_status text;
  v_interest text;
  v_notes text;
  v_rejection text;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and workspace_id = p_workspace_id)
    or not exists (select 1 from public.properties where id = p_property_id and workspace_id = p_workspace_id) then
    raise exception 'Client or property not found in workspace' using errcode = 'P0002';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('status','interest_level','notes','rejection_reason')) then
    raise exception 'Invalid relationship patch' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':' || p_client_id::text || ':' || p_property_id::text, 0));
  select * into v_old from public.client_properties where workspace_id = p_workspace_id
    and client_id = p_client_id and property_id = p_property_id for update;
  v_status := case when p_changes ? 'status' then p_changes->>'status' else coalesce(v_old.status, 'discovered') end;
  v_interest := case when p_changes ? 'interest_level' then p_changes->>'interest_level' else v_old.interest_level end;
  v_notes := case when p_changes ? 'notes' then p_changes->>'notes' else v_old.notes end;
  v_rejection := case when p_changes ? 'rejection_reason' then p_changes->>'rejection_reason' else v_old.rejection_reason end;
  if v_old.id is null then
    insert into public.client_properties(workspace_id, client_id, property_id, status, interest_level, notes, rejection_reason, sent_at, viewed_at)
    values (p_workspace_id, p_client_id, p_property_id, v_status, v_interest, v_notes, v_rejection,
      case when v_status = 'sent' then pg_catalog.clock_timestamp() end,
      case when v_status = 'viewed' then pg_catalog.clock_timestamp() end) returning * into v_new;
  elsif (v_old.status, v_old.interest_level, v_old.notes, v_old.rejection_reason)
    is distinct from (v_status, v_interest, v_notes, v_rejection) then
    update public.client_properties set status = v_status, interest_level = v_interest, notes = v_notes, rejection_reason = v_rejection,
      sent_at = case when v_status = 'sent' then coalesce(sent_at, pg_catalog.clock_timestamp()) else sent_at end,
      viewed_at = case when v_status = 'viewed' then coalesce(viewed_at, pg_catalog.clock_timestamp()) else viewed_at end,
      updated_at = pg_catalog.clock_timestamp()
    where id = v_old.id and workspace_id = p_workspace_id returning * into v_new;
  else
    v_new := v_old;
  end if;
  return v_new;
end;
$$;

create function public.save_property(p_workspace_id uuid, p_property jsonb, p_property_id uuid default null, p_source jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_property public.properties;
  v_patch public.properties;
  v_source public.property_sources;
  v_verified boolean := coalesce((p_source->>'availability_verified')::boolean, false);
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid()) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_property is null or jsonb_typeof(p_property) <> 'object' or octet_length(p_property::text) > 16000
    or exists (select 1 from jsonb_object_keys(p_property) k where k not in (
      'title','property_type','development_name','address','neighborhood','city','state','country',
      'bedrooms','bathrooms','interior_m2','exterior_m2','total_m2','asking_price','currency','construction_status','delivery_date','notes'))
    or (p_property ? 'asking_price' and (p_property->>'currency' is null or p_property->>'currency' !~ '^[A-Z]{3}$')) then
    raise exception 'Invalid canonical property data' using errcode = '22023';
  end if;
  if p_property_id is not null then
    select * into v_property from public.properties where id = p_property_id and workspace_id = p_workspace_id for update;
    if v_property.id is null then raise exception 'Property not found in workspace' using errcode = 'P0002'; end if;
  else
    v_property.city := 'Playa del Carmen'; v_property.state := 'Quintana Roo'; v_property.country := 'Mexico';
    v_property.currency := 'MXN'; v_property.availability_status := 'unknown';
  end if;
  v_patch := jsonb_populate_record(v_property, p_property);
  if nullif(trim(v_patch.title), '') is null or char_length(v_patch.title) > 200
    or char_length(v_patch.notes) > 2000 or v_patch.asking_price < 0
    or v_patch.bedrooms < 0 or v_patch.bathrooms < 0
    or v_patch.interior_m2 < 0 or v_patch.exterior_m2 < 0 or v_patch.total_m2 < 0 then
    raise exception 'Invalid canonical property values' using errcode = '22023';
  end if;
  if p_property_id is null then
    insert into public.properties(workspace_id, title, property_type, development_name, address, neighborhood, city, state, country,
      bedrooms, bathrooms, interior_m2, exterior_m2, total_m2, asking_price, currency, construction_status, delivery_date, notes, created_by)
    values (p_workspace_id, trim(v_patch.title), v_patch.property_type, v_patch.development_name, v_patch.address, v_patch.neighborhood,
      v_patch.city, v_patch.state, v_patch.country, v_patch.bedrooms, v_patch.bathrooms, v_patch.interior_m2, v_patch.exterior_m2,
      v_patch.total_m2, v_patch.asking_price, v_patch.currency, v_patch.construction_status, v_patch.delivery_date, v_patch.notes, auth.uid())
    returning * into v_property;
  elsif p_property <> '{}'::jsonb then
    update public.properties set title = v_patch.title, property_type = v_patch.property_type, development_name = v_patch.development_name,
      address = v_patch.address, neighborhood = v_patch.neighborhood, city = v_patch.city, state = v_patch.state, country = v_patch.country,
      bedrooms = v_patch.bedrooms, bathrooms = v_patch.bathrooms, interior_m2 = v_patch.interior_m2, exterior_m2 = v_patch.exterior_m2,
      total_m2 = v_patch.total_m2, asking_price = v_patch.asking_price, currency = v_patch.currency, construction_status = v_patch.construction_status,
      delivery_date = v_patch.delivery_date, notes = v_patch.notes, updated_at = pg_catalog.clock_timestamp()
    where id = p_property_id and workspace_id = p_workspace_id returning * into v_property;
  end if;
  if p_source is not null then
    if jsonb_typeof(p_source) <> 'object' or nullif(trim(p_source->>'source_name'), '') is null
      or octet_length(p_source::text) > 16000
      or exists (select 1 from jsonb_object_keys(p_source) k where k not in ('source_name','url','external_id','listing_price','currency',
        'listing_updated_at','accessed_at','availability_status','availability_verified','availability_verified_at'))
      or (p_source ? 'listing_price' and (p_source->>'currency' is null or p_source->>'currency' !~ '^[A-Z]{3}$'))
      or (p_source->>'listing_price')::numeric < 0
      or (p_source->>'availability_status' is not null and p_source->>'availability_status' not in ('unknown','available','reserved','sold','unavailable'))
      or (v_verified and (p_source->>'availability_status' is null or p_source->>'availability_status' = 'unknown'))
      or (not v_verified and p_source->>'availability_verified_at' is not null) then
      raise exception 'Invalid listing source or verification' using errcode = '22023';
    end if;
    insert into public.property_sources(workspace_id, property_id, source_name, url, external_id, asking_price, currency,
      listing_updated_at, accessed_at, availability_status, availability_verified, availability_verified_at)
    values (p_workspace_id, v_property.id, trim(p_source->>'source_name'), p_source->>'url', p_source->>'external_id',
      (p_source->>'listing_price')::numeric, p_source->>'currency', (p_source->>'listing_updated_at')::timestamptz,
      coalesce((p_source->>'accessed_at')::timestamptz, pg_catalog.clock_timestamp()), coalesce(p_source->>'availability_status', 'unknown'),
      v_verified, case when v_verified then coalesce((p_source->>'availability_verified_at')::timestamptz, pg_catalog.clock_timestamp()) end)
    returning * into v_source;
  end if;
  return jsonb_build_object('property', to_jsonb(v_property), 'source', case when v_source.id is null then null else to_jsonb(v_source) end);
end;
$$;

revoke all on function public.append_client_property_event() from public, anon;
revoke all on function public.update_client_property(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.save_property(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.append_client_property_event() to authenticated;
grant execute on function public.update_client_property(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_property(uuid, jsonb, uuid, jsonb) to authenticated;
