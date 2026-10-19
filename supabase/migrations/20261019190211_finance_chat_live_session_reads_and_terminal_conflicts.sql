-- Applied via Supabase migration finance_chat_live_session_reads_and_terminal_conflicts.
-- A JWT identifies the caller but a live registered session authorizes reads.
create function private.can_read_finance_chat()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_user_id uuid; v_session_id uuid;
begin
 -- Keep parsing inside the helper: an invalid claim always returns false,
 -- independently of the RLS planner's predicate evaluation order.
 begin
  v_user_id:=auth.uid();
  v_session_id:=(auth.jwt()->>'session_id')::uuid;
 exception when invalid_text_representation then return false;
 end;
 if v_user_id is null or v_session_id is null then return false; end if;
 return exists(
  select 1 from auth.users as u join auth.sessions as s on s.user_id=u.id
  where u.id=v_user_id and coalesce(u.is_anonymous,false)=false
   and s.id=v_session_id and (s.not_after is null or s.not_after>statement_timestamp())
 );
end;
$$;
revoke all on function private.can_read_finance_chat() from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.can_read_finance_chat() to authenticated;

alter policy finance_chat_threads_read_own on public.finance_chat_threads
 using ((select private.can_read_finance_chat()) and user_id=(select auth.uid()));

-- Business conflicts are terminal HTTP409, never retryable serialization failures.
-- PostgREST14 retries SQLSTATE40001 indefinitely; preserve safe CHAT_CONFLICT messages.
create or replace function public.save_finance_chat(p_chat_id uuid,p_messages jsonb,p_expected_version bigint,p_expected_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_thread public.finance_chat_threads%rowtype; v_count integer;
begin
 v_user_id:=private.require_finance_chat_owner(p_expected_user_id);
 if p_chat_id is null or p_expected_version is null or p_expected_version<0 or p_expected_version>9007199254740991
    or not private.valid_finance_chat_messages(p_messages) then
  raise exception 'CHAT_INVALID' using errcode='22023';
 end if;
 select * into v_thread from public.finance_chat_threads
  where id=p_chat_id and user_id=v_user_id for update;
 if found then
  -- Exact JSON replay also accepts the previous version after a lost response.
  -- It performs no write and returns the original timestamp/version.
  if v_thread.messages=p_messages then
   return jsonb_build_object('id',v_thread.id,'title',v_thread.title,'updated_at',v_thread.updated_at,'version',v_thread.version,'message_count',v_thread.message_count);
  end if;
  if v_thread.version<>p_expected_version or v_thread.version>=9007199254740991
     or jsonb_array_length(p_messages)<=v_thread.message_count then
   raise exception 'CHAT_CONFLICT' using errcode='PT409';
  end if;
  -- Every previous object, including the model annotation, must be identical.
  if exists(select 1 from generate_series(0,v_thread.message_count-1) as old(i)
    where p_messages->old.i is distinct from v_thread.messages->old.i) then
   raise exception 'CHAT_CONFLICT' using errcode='PT409';
  end if;
  update public.finance_chat_threads set messages=p_messages,version=version+1,updated_at=clock_timestamp()
   where id=p_chat_id and user_id=v_user_id returning * into v_thread;
 else
  if p_expected_version<>0 then raise exception 'CHAT_NOT_FOUND' using errcode='P0002'; end if;
  if jsonb_array_length(p_messages)<>2 then raise exception 'CHAT_INVALID' using errcode='22023'; end if;
  select count(*) into v_count from public.finance_chat_threads where user_id=v_user_id;
  if v_count>=100 then raise exception 'CHAT_LIMIT' using errcode='54000'; end if;
  insert into public.finance_chat_threads(id,user_id,title,messages)
   values(p_chat_id,v_user_id,left(btrim(regexp_replace(p_messages->0->>'content','[[:space:]]+',' ','g')),80),p_messages)
   on conflict(id) do nothing returning * into v_thread;
  -- A colliding UUID never causes a lookup or disclosure of another owner's row.
  if not found then raise exception 'CHAT_CONFLICT' using errcode='PT409'; end if;
 end if;
 return jsonb_build_object('id',v_thread.id,'title',v_thread.title,'updated_at',v_thread.updated_at,'version',v_thread.version,'message_count',v_thread.message_count);
end;
$$;
revoke all on function public.save_finance_chat(uuid,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_finance_chat(uuid,jsonb,bigint,uuid) to authenticated;

create or replace function public.delete_finance_chat(p_chat_id uuid,p_expected_version bigint,p_expected_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_version bigint;
begin
 v_user_id:=private.require_finance_chat_owner(p_expected_user_id);
 if p_chat_id is null or p_expected_version is null or p_expected_version<1 or p_expected_version>9007199254740991 then
  raise exception 'CHAT_INVALID' using errcode='22023';
 end if;
 select version into v_version from public.finance_chat_threads where id=p_chat_id and user_id=v_user_id for update;
 if not found then raise exception 'CHAT_NOT_FOUND' using errcode='P0002'; end if;
 if v_version<>p_expected_version then raise exception 'CHAT_CONFLICT' using errcode='PT409'; end if;
 delete from public.finance_chat_threads where id=p_chat_id and user_id=v_user_id;
 return true;
end;
$$;
revoke all on function public.delete_finance_chat(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_finance_chat(uuid,bigint,uuid) to authenticated;
