-- No messages, provider secrets, financial summaries, or IP addresses are stored here.
create table private.finance_ai_user_usage (
 user_id uuid primary key references auth.users(id) on delete cascade,
 minute_bucket timestamptz not null,
 minute_count integer not null default 0 check (minute_count between 0 and 6),
 day_bucket timestamptz not null,
 day_count integer not null default 0 check (day_count between 0 and 30)
);
create table private.finance_ai_global_usage (
 singleton boolean primary key default true check (singleton),
 day_bucket timestamptz not null,
 day_count integer not null default 0 check (day_count between 0 and 200)
);
alter table private.finance_ai_user_usage enable row level security;
alter table private.finance_ai_global_usage enable row level security;
revoke all on private.finance_ai_user_usage, private.finance_ai_global_usage from public,anon,authenticated,service_role;

-- This wrapper is callable only by the Edge service role after auth.getUser().
-- A single advisory lock makes quota checks/increments atomic across instances.
create function public.consume_finance_ai_quota(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_now timestamptz := clock_timestamp();
 v_minute timestamptz := date_trunc('minute',v_now,'UTC');
 v_day timestamptz := date_trunc('day',v_now,'UTC');
 v_user private.finance_ai_user_usage%rowtype;
 v_global private.finance_ai_global_usage%rowtype;
 v_retry integer;
begin
 perform pg_advisory_xact_lock(74430185);
 -- Lock the owner/session against concurrent account deletion or logout.
 perform 1 from auth.users where id=p_user_id and coalesce(is_anonymous,false)=false for key share;
 if not found then return jsonb_build_object('allowed',false,'sessionValid',false,'retryAfter',0); end if;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_user_id for key share;
 if not found then return jsonb_build_object('allowed',false,'sessionValid',false,'retryAfter',0); end if;
 insert into private.finance_ai_global_usage(singleton,day_bucket) values(true,v_day) on conflict do nothing;
 select * into v_global from private.finance_ai_global_usage where singleton for update;
 if v_global.day_bucket<>v_day then
  update private.finance_ai_global_usage set day_bucket=v_day,day_count=0 where singleton returning * into v_global;
 end if;
 insert into private.finance_ai_user_usage(user_id,minute_bucket,day_bucket) values(p_user_id,v_minute,v_day) on conflict do nothing;
 select * into v_user from private.finance_ai_user_usage where user_id=p_user_id for update;
 if v_user.minute_bucket<>v_minute then v_user.minute_count:=0; end if;
 if v_user.day_bucket<>v_day then v_user.day_count:=0; end if;
 if v_user.day_count>=30 or v_global.day_count>=200 then
  v_retry:=greatest(1,ceil(extract(epoch from v_day+interval '1 day'-v_now))::integer);
 elsif v_user.minute_count>=6 then
  v_retry:=greatest(1,ceil(extract(epoch from v_minute+interval '1 minute'-v_now))::integer);
 else
  update private.finance_ai_user_usage set minute_bucket=v_minute,minute_count=v_user.minute_count+1,day_bucket=v_day,day_count=v_user.day_count+1 where user_id=p_user_id;
  update private.finance_ai_global_usage set day_count=day_count+1 where singleton;
  return jsonb_build_object('allowed',true,'sessionValid',true,'retryAfter',0);
 end if;
 return jsonb_build_object('allowed',false,'sessionValid',true,'retryAfter',v_retry);
end;
$$;
revoke all on function public.consume_finance_ai_quota(uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_finance_ai_quota(uuid,uuid) to service_role;
comment on function public.consume_finance_ai_quota(uuid,uuid) is 'Server-only atomic AI limits: 6/minute, 30/day/user, 200/day/project (UTC). No message storage.';
