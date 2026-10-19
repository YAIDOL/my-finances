-- Applied via Supabase migration private_finance_chat_history.
-- Conversations contain only completed plaintext user/assistant turns.
create function private.valid_finance_chat_messages(p_messages jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_message jsonb; v_content text; v_role text; v_index integer:=0; v_count integer;
begin
 if jsonb_typeof(p_messages) is distinct from 'array' then return false; end if;
 v_count:=jsonb_array_length(p_messages);
 if v_count<2 or v_count>200 or v_count%2<>0 or octet_length(p_messages::text)>500000 then return false; end if;
 for v_message in select value from jsonb_array_elements(p_messages) loop
  if jsonb_typeof(v_message) is distinct from 'object'
     or not(v_message ?& array['role','content'])
     or (v_message-array['role','content','model'])<>'{}'::jsonb
     or jsonb_typeof(v_message->'role') is distinct from 'string'
     or jsonb_typeof(v_message->'content') is distinct from 'string' then return false; end if;
  v_role:=v_message->>'role'; v_content:=v_message->>'content';
  if v_role is distinct from (case when v_index%2=0 then 'user' else 'assistant' end)
     or char_length(v_content)<1
     or char_length(v_content)>(case when v_role='user' then 1000 else 8000 end)
     or v_content !~ '[^[:space:]]'
     -- PostgreSQL JSONB rejects U+0000 before this function is called.
     or v_content ~ ('['||chr(1)||'-'||chr(8)||chr(11)||chr(12)||chr(14)||'-'||chr(31)||']')
     or v_content ~* 'nvapi-|sb_secret_|(sk|sk-proj)-[A-Za-z0-9_-]{16,}' then return false; end if;
  if v_message ? 'model' then
   if v_role<>'assistant' or jsonb_typeof(v_message->'model') is distinct from 'string'
      or v_message->>'model' not in ('z-ai/glm-5.3-flash','nvidia/nemotron-3.5-lightning-30b-a3b') then return false; end if;
  end if;
  v_index:=v_index+1;
 end loop;
 return true;
end;
$$;
revoke all on function private.valid_finance_chat_messages(jsonb) from public,anon,authenticated,service_role;

create table public.finance_chat_threads (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 80),
 messages jsonb not null check (private.valid_finance_chat_messages(messages) is true),
 version bigint not null default 1 check (version between 1 and 9007199254740991),
 updated_at timestamptz not null default clock_timestamp(),
 message_count integer generated always as (jsonb_array_length(messages)) stored,
 constraint finance_chat_title_from_first_user check (
  title=left(btrim(regexp_replace(messages->0->>'content','[[:space:]]+',' ','g')),80)
 )
);
create index finance_chat_threads_owner_updated on public.finance_chat_threads(user_id,updated_at desc,id);
alter table public.finance_chat_threads enable row level security;
create policy finance_chat_threads_read_own on public.finance_chat_threads for select to authenticated
 using (user_id=(select auth.uid()));
revoke all on table public.finance_chat_threads from public,anon,authenticated;
grant select on table public.finance_chat_threads to authenticated;

-- Called only inside the two public SECURITY DEFINER entry points. Owner and
-- session key-share locks keep account deletion / session revocation atomic
-- with a mutation. A revoked JWT alone never authorizes a mutation.
create function private.require_finance_chat_owner(p_expected_user_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_session_id uuid;
begin
 if v_user_id is null then raise exception 'CHAT_AUTH_REQUIRED' using errcode='42501'; end if;
 if p_expected_user_id is distinct from v_user_id then raise exception 'CHAT_OWNER_MISMATCH' using errcode='42501'; end if;
 perform 1 from auth.users where id=v_user_id and coalesce(is_anonymous,false)=false for key share;
 if not found then raise exception 'CHAT_AUTH_REQUIRED' using errcode='42501'; end if;
 begin
  v_session_id:=(auth.jwt()->>'session_id')::uuid;
 exception when invalid_text_representation then
  raise exception 'CHAT_AUTH_REQUIRED' using errcode='42501';
 end;
 if v_session_id is null then raise exception 'CHAT_AUTH_REQUIRED' using errcode='42501'; end if;
 perform 1 from auth.sessions where id=v_session_id and user_id=v_user_id
  and (not_after is null or not_after>statement_timestamp()) for key share;
 if not found then raise exception 'CHAT_AUTH_REQUIRED' using errcode='42501'; end if;
 -- A fixed namespace plus the authenticated owner serializes creates, appends
 -- and deletes, including the count-before-insert 100-thread limit.
 perform pg_advisory_xact_lock(hashtextextended('finance-chat:'||v_user_id::text,0));
 return v_user_id;
end;
$$;
revoke all on function private.require_finance_chat_owner(uuid) from public,anon,authenticated,service_role;

create function public.save_finance_chat(p_chat_id uuid,p_messages jsonb,p_expected_version bigint,p_expected_user_id uuid)
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
   raise exception 'CHAT_CONFLICT' using errcode='40001';
  end if;
  -- Every previous object, including the model annotation, must be identical.
  if exists(select 1 from generate_series(0,v_thread.message_count-1) as old(i)
    where p_messages->old.i is distinct from v_thread.messages->old.i) then
   raise exception 'CHAT_CONFLICT' using errcode='40001';
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
  if not found then raise exception 'CHAT_CONFLICT' using errcode='40001'; end if;
 end if;
 return jsonb_build_object('id',v_thread.id,'title',v_thread.title,'updated_at',v_thread.updated_at,'version',v_thread.version,'message_count',v_thread.message_count);
end;
$$;
revoke all on function public.save_finance_chat(uuid,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_finance_chat(uuid,jsonb,bigint,uuid) to authenticated;

create function public.delete_finance_chat(p_chat_id uuid,p_expected_version bigint,p_expected_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_version bigint;
begin
 v_user_id:=private.require_finance_chat_owner(p_expected_user_id);
 if p_chat_id is null or p_expected_version is null or p_expected_version<1 or p_expected_version>9007199254740991 then
  raise exception 'CHAT_INVALID' using errcode='22023';
 end if;
 select version into v_version from public.finance_chat_threads where id=p_chat_id and user_id=v_user_id for update;
 if not found then raise exception 'CHAT_NOT_FOUND' using errcode='P0002'; end if;
 if v_version<>p_expected_version then raise exception 'CHAT_CONFLICT' using errcode='40001'; end if;
 delete from public.finance_chat_threads where id=p_chat_id and user_id=v_user_id;
 return true;
end;
$$;
revoke all on function public.delete_finance_chat(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_finance_chat(uuid,bigint,uuid) to authenticated;
