-- Supabase installs pgcrypto in extensions; disposable PostgreSQL may install it
-- in public. Use PostgreSQL's built-in SHA-256 without relocating the extension.
create function import_private.digest(p_value bytea,p_algorithm text) returns bytea
language plpgsql immutable strict security invoker set search_path='' as $$
begin
  if p_algorithm <> 'sha256' then
    raise exception 'Import hashing supports SHA-256 only' using errcode='22023';
  end if;
  return pg_catalog.sha256(p_value);
end;
$$;
revoke all on function import_private.digest(bytea,text) from public,anon;
grant execute on function import_private.digest(bytea,text) to authenticated;

do $$
declare signature text; definition text; updated text;
begin
  foreach signature in array array['public.client_import(uuid,text,jsonb)','import_private.semantic_evidence(jsonb,jsonb)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,'public.digest(','import_private.digest(');
    if updated=definition then raise exception 'Expected import hash call missing in %',signature; end if;
    execute updated;
  end loop;
end;
$$;
notify pgrst,'reload schema';
