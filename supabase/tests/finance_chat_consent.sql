-- Run as the migration owner after the finance-chat consent migration.
-- Synthetic accounts only; all data and test helpers roll back.
begin;

create temporary table qa_chat_consent (
 user_a uuid, user_b uuid, session_a uuid, session_a_device_two uuid,
 session_b uuid, started_at timestamptz, preferences_a jsonb, finance_a jsonb
);
insert into qa_chat_consent values (
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
 gen_random_uuid(),clock_timestamp(),
 '{"theme":"light","reducedMotion":true,"hideAmounts":true,"custom":{"nested":[1,"keep",false]},"financeChatConsent":{"accepted":false,"version":1}}',
 null
);
grant select on qa_chat_consent to authenticated,anon,service_role;

create function pg_temp.expect_consent_error(p_sql text,p_expected text)
returns void language plpgsql security invoker set search_path='' as $$
declare v_message text; v_state text;
begin
 begin
  execute p_sql;
 exception when others then
  get stacked diagnostics v_message=message_text,v_state=returned_sqlstate;
  if v_state='42501' and (v_message=p_expected or p_expected='42501') then return; end if;
  raise exception 'Expected % (42501), received % (%)',p_expected,v_message,v_state;
 end;
 raise exception 'Expected rejection %',p_expected;
end;
$$;

do $$
declare f qa_chat_consent%rowtype; n text;
begin
 select * into strict f from qa_chat_consent;
 n:='qaconsent'||substr(replace(gen_random_uuid()::text,'-',''),1,15);
 insert into auth.users(id,email,raw_user_meta_data)
 values(f.user_a,n||'@users.my-finances.invalid',jsonb_build_object('username',n));
 n:='qaconsent'||substr(replace(gen_random_uuid()::text,'-',''),1,15);
 insert into auth.users(id,email,raw_user_meta_data)
 values(f.user_b,n||'@users.my-finances.invalid',jsonb_build_object('username',n));
 insert into auth.sessions(id,user_id)
 values(f.session_a,f.user_a),(f.session_a_device_two,f.user_a),(f.session_b,f.user_b);
 update public.user_preferences set preferences=f.preferences_a where user_id=f.user_a;
 delete from public.user_preferences where user_id=f.user_b;
 insert into public.finance_state(user_id,version) values(f.user_a,7);
 update qa_chat_consent set finance_a=(select to_jsonb(s) from public.finance_state s where user_id=f.user_a);
end;
$$;

set local role authenticated;
do $$
declare f qa_chat_consent%rowtype; v_preferences jsonb; v_invalid jsonb; v_rows integer;
begin
 select * into strict f from qa_chat_consent;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a)::text,true);
 if public.get_finance_chat_consent(f.user_a) is distinct from false then raise exception 'FALSE_CONSENT_ACCEPTED'; end if;
 -- Every malformed representation must remain false, including JSON strings.
 for v_invalid in select value from jsonb_array_elements('[
  null,false,true,1,"true",[],{},
  {"accepted":true},{"version":1},{"accepted":false,"version":1},
  {"accepted":"true","version":1},{"accepted":1,"version":1},
  {"accepted":true,"version":"1"},{"accepted":true,"version":true},
  {"accepted":true,"version":null},{"accepted":true,"version":0},
  {"accepted":true,"version":2},{"accepted":true,"version":1.1},
  {"accepted":null,"version":1},{"accepted":[],"version":1}
 ]'::jsonb) loop
  update public.user_preferences set preferences=jsonb_set(f.preferences_a,'{financeChatConsent}',v_invalid) where user_id=f.user_a;
  if public.get_finance_chat_consent(f.user_a) is distinct from false then raise exception 'MALFORMED_CONSENT_ACCEPTED: %',v_invalid; end if;
 end loop;
 -- Acceptance depends on these two typed fields, not an optional date field.
 update public.user_preferences set preferences=jsonb_set(f.preferences_a,'{financeChatConsent}','{"accepted":true,"version":1.0}') where user_id=f.user_a;
 if public.get_finance_chat_consent(f.user_a) is distinct from true then raise exception 'NUMERIC_VERSION_ONE_NOT_ACCEPTED'; end if;
 update public.user_preferences set preferences=f.preferences_a-'financeChatConsent' where user_id=f.user_a;
 if public.get_finance_chat_consent(f.user_a) is distinct from false then raise exception 'MISSING_KEY_ACCEPTED'; end if;
 if (select preferences from public.user_preferences where user_id=f.user_a) is distinct from f.preferences_a-'financeChatConsent' then raise exception 'GETTER_WROTE_PREFERENCES'; end if;
 if public.accept_finance_chat_consent(f.user_a) is distinct from true
    or public.get_finance_chat_consent(f.user_a) is distinct from true then raise exception 'ACCEPT_FAILED'; end if;
 select preferences into strict v_preferences from public.user_preferences where user_id=f.user_a;
 if v_preferences-'financeChatConsent' is distinct from f.preferences_a-'financeChatConsent'
    or ((v_preferences->'financeChatConsent')-array['version','accepted','acceptedAt'])<>'{}'::jsonb
    or jsonb_typeof(v_preferences->'financeChatConsent'->'acceptedAt') is distinct from 'string'
    or (v_preferences->'financeChatConsent'->>'acceptedAt')::timestamptz<f.started_at
    or (v_preferences->'financeChatConsent'->>'acceptedAt')::timestamptz>clock_timestamp() then raise exception 'ACCEPT_CHANGED_OTHER_KEYS_OR_INVALID_SERVER_DATE'; end if;
 if public.accept_finance_chat_consent(f.user_a) is distinct from true
    or (select preferences from public.user_preferences where user_id=f.user_a) is distinct from v_preferences then raise exception 'ACCEPT_REPLAY_CHANGED_PREFERENCES'; end if;
 -- A different live session sees the same durable account-level acceptance.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a_device_two)::text,true);
 if public.get_finance_chat_consent(f.user_a) is distinct from true then raise exception 'CROSS_DEVICE_CONSENT_MISSING'; end if;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_b),'CHAT_OWNER_MISMATCH');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_b),'CHAT_OWNER_MISMATCH');
 perform pg_temp.expect_consent_error('select public.get_finance_chat_consent(null)','CHAT_OWNER_MISMATCH');
 perform pg_temp.expect_consent_error('select public.accept_finance_chat_consent(null)','CHAT_OWNER_MISMATCH');
 if exists(select 1 from public.user_preferences where user_id=f.user_b) then raise exception 'OTHER_OWNER_PREF_READ'; end if;
 update public.user_preferences set preferences='{}' where user_id=f.user_b;
 get diagnostics v_rows=row_count;
 if v_rows<>0 then raise exception 'OTHER_OWNER_PREF_UPDATE'; end if;
 perform pg_temp.expect_consent_error(format('insert into public.user_preferences(user_id) values(%L)',f.user_b),'42501');
 if (select to_jsonb(s) from public.finance_state s where user_id=f.user_a) is distinct from f.finance_a then raise exception 'ACCEPT_CHANGED_FINANCE_STATE'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_b,'role','authenticated','session_id',f.session_b)::text,true);
 if public.get_finance_chat_consent(f.user_b) is distinct from false then raise exception 'MISSING_ROW_ACCEPTED'; end if;
 if exists(select 1 from public.user_preferences where user_id=f.user_b) then raise exception 'GETTER_CREATED_PREFERENCE_ROW'; end if;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'CHAT_OWNER_MISMATCH');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'CHAT_OWNER_MISMATCH');
 if public.accept_finance_chat_consent(f.user_b) is distinct from true then raise exception 'MISSING_ROW_ACCEPT_FAILED'; end if;
 select preferences into strict v_preferences from public.user_preferences where user_id=f.user_b;
 if v_preferences-'financeChatConsent' is distinct from '{"theme":"dark","reducedMotion":false,"hideAmounts":false}'::jsonb
    or public.get_finance_chat_consent(f.user_b) is distinct from true then raise exception 'MISSING_ROW_DEFAULTS_LOST'; end if;
 if exists(select 1 from public.finance_state where user_id=f.user_b) then raise exception 'ACCEPT_CREATED_FINANCE_STATE'; end if;
 if exists(select 1 from public.user_preferences where user_id=f.user_a) then raise exception 'OTHER_OWNER_ACCEPTED_PREF_READ'; end if;
 update public.user_preferences set preferences='{}' where user_id=f.user_a;
 get diagnostics v_rows=row_count;
 if v_rows<>0 then raise exception 'OTHER_OWNER_ACCEPTED_PREF_UPDATE'; end if;
 -- Repair malformed old data while retaining every unrelated preference.
 update public.user_preferences set preferences=jsonb_set(preferences,'{financeChatConsent}','{"accepted":"true","version":"1"}') where user_id=f.user_b;
 if public.accept_finance_chat_consent(f.user_b) is distinct from true
    or public.get_finance_chat_consent(f.user_b) is distinct from true
    or (select preferences-'financeChatConsent' from public.user_preferences where user_id=f.user_b) is distinct from v_preferences-'financeChatConsent' then raise exception 'MALFORMED_CONSENT_REPAIR_FAILED'; end if;
end;
$$;
reset role;

-- Only authenticated callers may enter either public RPC.
set local role anon;
do $$
declare f qa_chat_consent%rowtype;
begin
 select * into strict f from qa_chat_consent;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'42501');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'42501');
end;
$$;
reset role;
set local role service_role;
do $$
declare f qa_chat_consent%rowtype;
begin
 select * into strict f from qa_chat_consent;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'42501');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'42501');
end;
$$;
reset role;

do $$
declare f qa_chat_consent%rowtype; v_claims jsonb; v_rpc text; v_function regprocedure;
begin
 select * into strict f from qa_chat_consent;
 -- Absent/malformed/wrong-owner session IDs and a missing subject fail closed.
 for v_claims in select value from jsonb_array_elements(jsonb_build_array(
  '{}'::jsonb,
  jsonb_build_object('sub',f.user_a,'role','authenticated'),
  jsonb_build_object('sub',f.user_a,'role','authenticated','session_id','invalid'),
  jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',gen_random_uuid()),
  jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_b)
 )) loop
  perform set_config('request.jwt.claims',v_claims::text,true);
  set local role authenticated;
  perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
  perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
  reset role;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.user_a,'role','authenticated','session_id',f.session_a)::text,true);
 update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=f.session_a;
 set local role authenticated;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 reset role;
 update auth.sessions set not_after=null where id=f.session_a;
 update auth.users set is_anonymous=true where id=f.user_a;
 set local role authenticated;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 reset role;
 update auth.users set is_anonymous=false where id=f.user_a;
 delete from auth.sessions where id=f.session_a;
 set local role authenticated;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 reset role;
 delete from auth.users where id in(f.user_a,f.user_b);
 if exists(select 1 from public.user_preferences where user_id in(f.user_a,f.user_b)) then raise exception 'PREFERENCES_ACCOUNT_CASCADE_FAILED'; end if;
 set local role authenticated;
 perform pg_temp.expect_consent_error(format('select public.get_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 perform pg_temp.expect_consent_error(format('select public.accept_finance_chat_consent(%L)',f.user_a),'CHAT_AUTH_REQUIRED');
 reset role;
 foreach v_rpc in array array['get_finance_chat_consent','accept_finance_chat_consent'] loop
  v_function:=('public.'||v_rpc||'(uuid)')::regprocedure;
  if not has_function_privilege('authenticated',v_function,'EXECUTE')
     or has_function_privilege('anon',v_function,'EXECUTE')
     or has_function_privilege('service_role',v_function,'EXECUTE')
     or exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=v_function and a.grantee=0 and a.privilege_type='EXECUTE')
     or not exists(select 1 from pg_proc where oid=v_function and prosecdef
      and prorettype='boolean'::regtype and proconfig @> array['search_path=""']) then raise exception 'CONSENT_RPC_SECURITY_FAILED: %',v_rpc; end if;
 end loop;
 if has_function_privilege('authenticated','private.require_finance_chat_owner(uuid)','EXECUTE')
    or has_table_privilege('authenticated','auth.users','SELECT')
    or has_table_privilege('authenticated','auth.sessions','SELECT')
    or not (select relrowsecurity from pg_class where oid='public.user_preferences'::regclass) then raise exception 'EXISTING_SECURITY_CHANGED'; end if;
end;
$$;
select 'chat consent owner/RLS/ACL/session/strict JSON/idempotency/defaults/finance/cascade checks: passed' as result;
rollback;
