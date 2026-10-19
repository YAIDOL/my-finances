-- Run as the migration owner after installing finance-chat-history.sql.
-- Only synthetic accounts are touched; every change is rolled back.
begin;

create temporary table qa_chat_history (
 user_a uuid, user_b uuid, session_a uuid, session_b uuid,
 chat_a uuid, chat_b uuid, pair jsonb, extended jsonb
);
insert into qa_chat_history values (
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
 gen_random_uuid(),gen_random_uuid(),
 '[{"role":"user","content":"Synthetic budget question"},{"role":"assistant","content":"Synthetic answer","model":"z-ai/glm-5.3-flash"}]',
 '[{"role":"user","content":"Synthetic budget question"},{"role":"assistant","content":"Synthetic answer","model":"z-ai/glm-5.3-flash"},{"role":"user","content":"Another question"},{"role":"assistant","content":"Another answer","model":"nvidia/nemotron-3.5-lightning-30b-a3b"}]'
);
grant select on qa_chat_history to authenticated,anon;

-- Tests fail if an expected rejection is absent or has the wrong safe code.
create function pg_temp.expect_chat_error(p_sql text,p_expected text)
returns void language plpgsql security invoker set search_path='' as $$
declare v_message text; v_state text;
begin
 begin
  execute p_sql;
 exception when others then
  get stacked diagnostics v_message=message_text,v_state=returned_sqlstate;
  if v_message=p_expected then
   if p_expected='CHAT_CONFLICT' and v_state<>'PT409' then raise exception 'RETRYABLE_CHAT_CONFLICT_SQLSTATE_%',v_state; end if;
   return;
  end if;
  if v_state=p_expected then return; end if;
  raise exception 'Expected %, received % (%)',p_expected,v_message,v_state;
 end;
 raise exception 'Expected rejection %',p_expected;
end;
$$;

do $$
declare f qa_chat_history%rowtype; n text;
begin
 select * into strict f from qa_chat_history;
 n:='qachist'||substr(replace(gen_random_uuid()::text,'-',''),1,16);
 insert into auth.users(id,email,raw_user_meta_data)
 values(f.user_a,n||'@users.my-finances.invalid',jsonb_build_object('username',n));
 n:='qachist'||substr(replace(gen_random_uuid()::text,'-',''),1,16);
 insert into auth.users(id,email,raw_user_meta_data)
 values(f.user_b,n||'@users.my-finances.invalid',jsonb_build_object('username',n));
 insert into auth.sessions(id,user_id) values(f.session_a,f.user_a),(f.session_b,f.user_b);
end;
$$;

set local role authenticated;
do $$
declare f record; r jsonb; replay jsonb; invalid jsonb; i integer; huge jsonb; boundary_chat uuid;
begin
 select * into strict f from qa_chat_history;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a)::text,true);
 r:=public.save_finance_chat(f.chat_a,f.pair,0,f.user_a);
 if r->>'id'<>f.chat_a::text or (r->>'version')::bigint<>1 or (r->>'message_count')::integer<>2
    or r->>'title'<>'Synthetic budget question' or r->>'updated_at' is null
    or (r-array['id','title','updated_at','version','message_count'])<>'{}'::jsonb then
  raise exception 'CREATE_METADATA_FAILED';
 end if;
 replay:=public.save_finance_chat(f.chat_a,f.pair,0,f.user_a);
 if replay<>r then raise exception 'CREATE_LOST_RESPONSE_REPLAY_FAILED'; end if;
 if (select count(*) from public.finance_chat_threads where id=f.chat_a)<>1 then raise exception 'OWN_READ_FAILED'; end if;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,1,%L)',f.chat_a,f.extended,f.user_b),'CHAT_OWNER_MISMATCH');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,1,%L)',f.chat_a,f.user_b),'CHAT_OWNER_MISMATCH');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',f.chat_a,f.extended,f.user_a),'CHAT_CONFLICT');
 r:=public.save_finance_chat(f.chat_a,f.extended,1,f.user_a);
 if (r->>'version')::bigint<>2 or (r->>'message_count')::integer<>4 then raise exception 'APPEND_FAILED'; end if;
 if public.save_finance_chat(f.chat_a,f.extended,1,f.user_a)<>r then raise exception 'APPEND_LOST_RESPONSE_REPLAY_FAILED'; end if;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,f.pair,f.user_a),'CHAT_CONFLICT');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,jsonb_set(f.extended,'{0,content}','"Changed question"'),f.user_a),'CHAT_CONFLICT');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,1,%L)',f.chat_a,f.user_a),'CHAT_CONFLICT');
 perform pg_temp.expect_chat_error(format('insert into public.finance_chat_threads(id,user_id,title,messages) values(%L,%L,''Injected'',%L::jsonb)',gen_random_uuid(),f.user_a,f.pair),'42501');
 perform pg_temp.expect_chat_error(format('update public.finance_chat_threads set user_id=%L where id=%L',f.user_b,f.chat_a),'42501');
 perform pg_temp.expect_chat_error(format('delete from public.finance_chat_threads where id=%L',f.chat_a),'42501');
 perform pg_temp.expect_chat_error(format('truncate public.finance_chat_threads'),'42501');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),f.extended,f.user_a),'CHAT_INVALID');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,null,%L)',gen_random_uuid(),f.pair,f.user_a),'CHAT_INVALID');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,9007199254740992,%L)',gen_random_uuid(),f.pair,f.user_a),'CHAT_INVALID');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,0,%L)',f.chat_a,f.user_a),'CHAT_INVALID');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,1,%L)',gen_random_uuid(),f.pair,f.user_a),'CHAT_NOT_FOUND');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(null,%L::jsonb,0,%L)',f.pair,f.user_a),'CHAT_INVALID');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(null,1,%L)',f.user_a),'CHAT_INVALID');
 for invalid in select value from jsonb_array_elements(jsonb_build_array(
  'null'::jsonb,'{}'::jsonb,'[]'::jsonb,'[{}]'::jsonb,
  '[1,2]'::jsonb,'[null,null]'::jsonb,'[[],[]]'::jsonb,'[true,false]'::jsonb,
  '[{"role":"system","content":"x"},{"role":"assistant","content":"x"}]'::jsonb,
  '[{"role":"assistant","content":"x"},{"role":"user","content":"x"}]'::jsonb,
  '[{"role":"user","content":"x"},{"role":"user","content":"x"}]'::jsonb,
  '[{"role":"user","content":""},{"role":"assistant","content":"x"}]'::jsonb,
  '[{"role":"user","content":"  "},{"role":"assistant","content":"x"}]'::jsonb,
  '[{"role":"user","content":2},{"role":"assistant","content":"x"}]'::jsonb,
  '[{"role":"user","content":"x","extra":true},{"role":"assistant","content":"x"}]'::jsonb,
  '[{"role":"user","content":"x","model":"z-ai/glm-5.3-flash"},{"role":"assistant","content":"x"}]'::jsonb,
  '[{"role":"user","content":"x"},{"role":"assistant","content":"x","model":"unknown"}]'::jsonb,
  '[{"role":"user","content":"x"},{"role":"assistant","content":"x","model":null}]'::jsonb,
  '[{"role":"user","content":"x"},{"role":"assistant","content":"x","extra":true}]'::jsonb,
  '[{"role":"user","content":"x"},{"role":"assistant","content":""}]'::jsonb,
  '[{"role":"user","content":"x"},{"role":"assistant"}]'::jsonb,
  jsonb_set(f.pair,'{0,content}',to_jsonb(repeat('x',1001))),
  jsonb_set(f.pair,'{1,content}',to_jsonb(repeat('x',8001))),
  jsonb_set(f.pair,'{0,content}',to_jsonb('bad'||chr(1))),
  jsonb_set(f.pair,'{0,content}',to_jsonb('nvapi-synthetic-never-a-real-key'::text)),
  jsonb_set(f.pair,'{1,content}',to_jsonb('sb_secret_synthetic-test-key'::text)),
  jsonb_set(f.pair,'{1,content}',to_jsonb('sk-proj-synthetic_never_a_real_key'::text)),
  jsonb_set(f.pair,'{0,content}',to_jsonb('sk-synthetic_never_a_real_key'::text))
 )) loop
  perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),invalid,f.user_a),'CHAT_INVALID');
 end loop;
 select jsonb_agg(case when g.i%2=1 then jsonb_build_object('role','user','content','x') else jsonb_build_object('role','assistant','content',repeat('ж',8000)) end order by g.i)
 into huge from generate_series(1,200) as g(i);
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,huge,f.user_a),'CHAT_INVALID');
 select jsonb_agg(f.pair->(g.i%2) order by g.i) into huge from generate_series(0,201) as g(i);
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,huge,f.user_a),'CHAT_INVALID');
 -- Valid boundary content includes tabs/newlines/CR; titles collapse whitespace.
 boundary_chat:=gen_random_uuid();
 invalid:=jsonb_set(jsonb_set(f.pair,'{0,content}',to_jsonb(E' \t\n'||repeat('x',80)||E'\r\n')), '{1,content}',to_jsonb(repeat('a',8000)));
 r:=public.save_finance_chat(boundary_chat,invalid,0,f.user_a);
 if r->>'title'<>repeat('x',80) then raise exception 'TITLE_BOUNDARY_FAILED'; end if;
 perform public.delete_finance_chat(boundary_chat,1,f.user_a);
 boundary_chat:=gen_random_uuid();
 invalid:=jsonb_set(f.pair,'{0,content}',to_jsonb(repeat('u',1000)));
 r:=public.save_finance_chat(boundary_chat,invalid,0,f.user_a);
 if char_length(r->>'title')<>80 then raise exception 'TITLE_TRUNCATION_FAILED'; end if;
 select jsonb_agg(case when g.i<2 then invalid->g.i else f.pair->(g.i%2) end order by g.i)
  into huge from generate_series(0,199) as g(i);
 r:=public.save_finance_chat(boundary_chat,huge,1,f.user_a);
 if (r->>'message_count')::integer<>200 then raise exception 'MAX_MESSAGES_BOUNDARY_FAILED'; end if;
 perform public.delete_finance_chat(boundary_chat,2,f.user_a);
 -- B cannot read or mutate A, and a guessed UUID reveals no row contents.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_b,'role','authenticated','session_id',f.session_b)::text,true);
 if (select count(*) from public.finance_chat_threads where id=f.chat_a)<>0 then raise exception 'OTHER_OWNER_READ'; end if;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',f.chat_a,f.pair,f.user_b),'CHAT_CONFLICT');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,2,%L)',f.chat_a,f.user_b),'CHAT_NOT_FOUND');
 perform public.save_finance_chat(f.chat_b,f.pair,0,f.user_b);
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',f.chat_b,jsonb_set(f.pair,'{0,content}','"Different competing initial turn"'),f.user_b),'CHAT_CONFLICT');
 if (select count(*) from public.finance_chat_threads)<>1 then raise exception 'LIST_OWNER_ISOLATION_FAILED'; end if;
 -- 100-thread cap is checked while holding the same owner lock on every save.
 for i in 2..100 loop perform public.save_finance_chat(gen_random_uuid(),f.pair,0,f.user_b); end loop;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),f.pair,f.user_b),'CHAT_LIMIT');
 if not public.delete_finance_chat(f.chat_b,1,f.user_b) then raise exception 'DELETE_FAILED'; end if;
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,1,%L)',f.chat_b,f.user_b),'CHAT_NOT_FOUND');
 perform public.save_finance_chat(gen_random_uuid(),f.pair,0,f.user_b);
 -- No session, malformed session, and another user's session all fail closed.
 for invalid in select value from jsonb_array_elements(jsonb_build_array('null'::jsonb,to_jsonb('not-a-uuid'::text),to_jsonb(f.session_a::text))) loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_b,'role','authenticated','session_id',invalid)::text,true);
  if (select count(*) from public.finance_chat_threads)<>0 then raise exception 'INVALID_SESSION_CHAT_READ'; end if;
  perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),f.pair,f.user_b),'CHAT_AUTH_REQUIRED');
  perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,1,%L)',f.chat_b,f.user_b),'CHAT_AUTH_REQUIRED');
 end loop;
 perform set_config('request.jwt.claims','{}',true);
 if (select count(*) from public.finance_chat_threads)<>0 then raise exception 'MISSING_AUTH_CHAT_READ'; end if;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),f.pair,f.user_a),'CHAT_AUTH_REQUIRED');
end;
$$;
reset role;

set local role anon;
do $$
declare f record;
begin
 select * into strict f from qa_chat_history;
 perform pg_temp.expect_chat_error('select * from public.finance_chat_threads','42501');
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),f.pair,f.user_a),'42501');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,2,%L)',f.chat_a,f.user_a),'42501');
end;
$$;
reset role;

-- Verify a still-valid JWT cannot read or write after expiry/logout/deletion.
do $$
declare f record;
begin
 select * into strict f from qa_chat_history;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a)::text,true);
 set local role authenticated;
 if (select count(*) from public.finance_chat_threads)<>1 then raise exception 'LIVE_SESSION_CHAT_READ_FAILED'; end if;
 reset role;
 update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=f.session_a;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a)::text,true);
 set local role authenticated;
 if (select count(*) from public.finance_chat_threads)<>0 then raise exception 'EXPIRED_SESSION_CHAT_READ'; end if;
 reset role;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,f.extended,f.user_a),'CHAT_AUTH_REQUIRED');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,2,%L)',f.chat_a,f.user_a),'CHAT_AUTH_REQUIRED');
 update auth.sessions set not_after=null where id=f.session_a;
 update auth.users set is_anonymous=true where id=f.user_a;
 set local role authenticated;
 if (select count(*) from public.finance_chat_threads)<>0 then raise exception 'ANONYMOUS_USER_CHAT_READ'; end if;
 reset role;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,f.extended,f.user_a),'CHAT_AUTH_REQUIRED');
 update auth.users set is_anonymous=false where id=f.user_a;
 delete from auth.sessions where id=f.session_a;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a)::text,true);
 set local role authenticated;
 if (select count(*) from public.finance_chat_threads)<>0 then raise exception 'REVOKED_SESSION_CHAT_READ'; end if;
 reset role;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,2,%L)',f.chat_a,f.extended,f.user_a),'CHAT_AUTH_REQUIRED');
 perform pg_temp.expect_chat_error(format('select public.delete_finance_chat(%L,2,%L)',f.chat_a,f.user_a),'CHAT_AUTH_REQUIRED');
 delete from auth.users where id=f.user_a or id=f.user_b;
 if exists(select 1 from public.finance_chat_threads where user_id in(f.user_a,f.user_b)) then raise exception 'ACCOUNT_DELETE_CASCADE_FAILED'; end if;
 perform pg_temp.expect_chat_error(format('select public.save_finance_chat(%L,%L::jsonb,0,%L)',gen_random_uuid(),f.pair,f.user_a),'CHAT_AUTH_REQUIRED');
 if has_function_privilege('anon','public.save_finance_chat(uuid,jsonb,bigint,uuid)','EXECUTE')
    or has_function_privilege('anon','public.delete_finance_chat(uuid,bigint,uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.valid_finance_chat_messages(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','private.require_finance_chat_owner(uuid)','EXECUTE')
    or has_function_privilege('service_role','public.save_finance_chat(uuid,jsonb,bigint,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.delete_finance_chat(uuid,bigint,uuid)','EXECUTE') then
  raise exception 'FUNCTION_ACL_FAILED';
 end if;
 if not has_function_privilege('authenticated','private.can_read_finance_chat()','EXECUTE')
    or has_function_privilege('anon','private.can_read_finance_chat()','EXECUTE')
    or has_function_privilege('service_role','private.can_read_finance_chat()','EXECUTE')
    or has_table_privilege('authenticated','auth.users','SELECT')
    or has_table_privilege('authenticated','auth.sessions','SELECT') then
  raise exception 'READ_SESSION_HELPER_ACL_FAILED';
 end if;
end;
$$;
select 'chat history owner/RLS/ACL/session/validation/version/idempotency/limits/cascade checks: passed' as result;
rollback;
