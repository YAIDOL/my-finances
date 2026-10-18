begin;
do $$
declare
 u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); n text:='qa_ai_'||substr(replace(gen_random_uuid()::text,'-',''),1,16);
 r jsonb; i integer; v_day timestamptz:=date_trunc('day',clock_timestamp(),'UTC');
begin
 if has_function_privilege('authenticated','public.consume_finance_ai_quota(uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.consume_finance_ai_quota(uuid,uuid)','EXECUTE') then raise exception 'PUBLIC_QUOTA_ACCESS'; end if;
 if not has_function_privilege('service_role','public.consume_finance_ai_quota(uuid,uuid)','EXECUTE') then raise exception 'SERVICE_ACCESS_MISSING'; end if;
 if has_table_privilege('authenticated','private.finance_ai_user_usage','SELECT') or has_table_privilege('service_role','private.finance_ai_user_usage','SELECT') then raise exception 'DIRECT_QUOTA_ACCESS'; end if;
 insert into auth.users(id,email,raw_user_meta_data) values(u,n||'@users.my-finances.invalid',jsonb_build_object('username',n));
 insert into auth.sessions(id,user_id) values(s,u);
 r:=public.consume_finance_ai_quota(u,gen_random_uuid());
 if (r->>'sessionValid')::boolean then raise exception 'FAKE_SESSION_ACCEPTED'; end if;
 -- Reset counters only inside this rolled-back isolated verification transaction.
 insert into private.finance_ai_global_usage(singleton,day_bucket) values(true,v_day) on conflict do nothing;
 update private.finance_ai_global_usage set day_bucket=v_day,day_count=0;
 for i in 1..6 loop
  r:=public.consume_finance_ai_quota(u,s);
  if not (r->>'allowed')::boolean then raise exception 'REQUEST_%_NOT_ALLOWED',i; end if;
 end loop;
 r:=public.consume_finance_ai_quota(u,s);
 if (r->>'allowed')::boolean or (r->>'retryAfter')::integer not between 1 and 60 then raise exception 'MINUTE_CAP_FAILED'; end if;
 update private.finance_ai_user_usage set minute_bucket=minute_bucket-interval '1 minute' where user_id=u;
 if not (public.consume_finance_ai_quota(u,s)->>'allowed')::boolean then raise exception 'MINUTE_RESET_FAILED'; end if;
 update private.finance_ai_user_usage set day_count=30,minute_count=0 where user_id=u;
 if (public.consume_finance_ai_quota(u,s)->>'allowed')::boolean then raise exception 'DAY_CAP_FAILED'; end if;
 update private.finance_ai_user_usage set day_bucket=day_bucket-interval '1 day' where user_id=u;
 if not (public.consume_finance_ai_quota(u,s)->>'allowed')::boolean then raise exception 'DAY_RESET_FAILED'; end if;
 update private.finance_ai_global_usage set day_count=200;
 if (public.consume_finance_ai_quota(u,s)->>'allowed')::boolean then raise exception 'GLOBAL_CAP_FAILED'; end if;
 delete from auth.sessions where id=s;
 if (public.consume_finance_ai_quota(u,s)->>'sessionValid')::boolean then raise exception 'REVOKED_SESSION_ACCEPTED'; end if;
 delete from auth.users where id=u;
 if exists(select 1 from private.finance_ai_user_usage where user_id=u) then raise exception 'DELETE_CASCADE_FAILED'; end if;
end;
$$;
select 'quota ACL, sessions, minute/day/global boundaries, window reset and deletion cascade: passed' as result;
rollback;
