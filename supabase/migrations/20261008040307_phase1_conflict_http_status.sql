-- Domain conflicts are permanent until the caller reconciles the request.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely; PT409 returns HTTP 409.
-- Change only the four explicit conflict codes in the existing Phase 1 RPCs,
-- preserving their bodies, signatures, invoker security and permissions.
do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.remember_client_fact(uuid,uuid,jsonb)'::regprocedure,
    'public.write_client_memory(uuid,uuid,text,jsonb)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if (length(v_definition) - length(replace(v_definition, 'errcode = ''40001''', ''))) / length('errcode = ''40001''') <> 2 then
      raise exception 'Unexpected Phase 1 conflict RPC definition: %', v_function;
    end if;
    execute replace(v_definition, 'errcode = ''40001''', 'errcode = ''PT409''');
  end loop;
end;
$$;
