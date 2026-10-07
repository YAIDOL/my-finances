begin;
create schema if not exists private;
create or replace function private.finance_shape_ok(s jsonb)
returns boolean language sql immutable set search_path = '' as $$
 select case when (
  jsonb_typeof(s)='object'
  and (s-array['accounts','transactions','goals','debts','payments','budgets','categories','assistance']::text[])='{}'::jsonb
  and s ?& array['accounts','transactions','goals','debts','payments','budgets']::text[]
  and jsonb_typeof(s->'accounts')='array' and jsonb_typeof(s->'transactions')='array'
  and jsonb_typeof(s->'goals')='array' and jsonb_typeof(s->'debts')='array'
  and jsonb_typeof(s->'payments')='array' and jsonb_typeof(s->'budgets')='array'
  and (not s ? 'categories' or jsonb_typeof(s->'categories')='array')
 ) is not true then false
 when not s ? 'assistance' then true
 when (jsonb_typeof(s->'assistance')='object'
  and ((s->'assistance')-array['templates','recurring','nextIncomeDate']::text[])='{}'::jsonb
  and jsonb_typeof(s->'assistance'->'templates')='array'
  and jsonb_typeof(s->'assistance'->'recurring')='array'
  and jsonb_typeof(s->'assistance'->'nextIncomeDate')='string'
  and (s->'assistance'->>'nextIncomeDate'='' or s->'assistance'->>'nextIncomeDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
 ) is not true then false
 else jsonb_array_length(s->'assistance'->'templates')<=50
  and jsonb_array_length(s->'assistance'->'recurring')<=100
  and not exists (select 1 from jsonb_array_elements(s->'assistance'->'templates') t where (
    jsonb_typeof(t)='object' and jsonb_typeof(t->'id')='string' and jsonb_typeof(t->'name')='string'
    and t->>'kind' in ('expense','income') and jsonb_typeof(t->'accountId')='string'
    and jsonb_typeof(t->'category')='string' and jsonb_typeof(t->'note')='string'
    and jsonb_typeof(t->'amount')='number' and t->>'amount' ~ '^[0-9]{1,12}$'
  ) is not true)
  and not exists (select 1 from jsonb_array_elements(s->'assistance'->'recurring') r where (
    jsonb_typeof(r)='object' and jsonb_typeof(r->'id')='string' and jsonb_typeof(r->'name')='string'
    and jsonb_typeof(r->'accountId')='string' and jsonb_typeof(r->'category')='string'
    and jsonb_typeof(r->'amount')='number' and r->>'amount' ~ '^[0-9]{1,12}$'
    and r->>'frequency' in ('weekly','monthly','yearly') and jsonb_typeof(r->'paused')='boolean'
    and r->>'startDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and r->>'nextDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) is not true)
 end;
$$;
revoke all on function private.finance_shape_ok(jsonb) from public, anon, authenticated;
alter table public.finance_state drop constraint finance_state_shape;
alter table public.finance_state add constraint finance_state_shape check (private.finance_shape_ok(state) is true);
create or replace function public.save_finance_state(p_state jsonb,p_expected_version bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_version bigint; v_old_state jsonb;
begin
 if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
 if p_expected_version is null or p_expected_version<0 or p_expected_version>=9007199254740991 then raise exception 'INVALID_FINANCE_VERSION' using errcode='22023'; end if;
 if private.finance_shape_ok(p_state) is not true then raise exception 'INVALID_FINANCE_STATE' using errcode='22023'; end if;
 insert into public.finance_state(user_id) values(v_user_id) on conflict(user_id) do nothing;
 select version,state into v_version,v_old_state from public.finance_state where user_id=v_user_id for update;
 if v_version<>p_expected_version then raise exception 'FINANCE_VERSION_CONFLICT' using errcode='P0001',hint='Reload the confirmed state before attempting another edit.'; end if;
 if (v_old_state ? 'categories' and not p_state ? 'categories') or (v_old_state ? 'assistance' and not p_state ? 'assistance') then raise exception 'FINANCE_CLIENT_OUTDATED' using errcode='22023'; end if;
 update public.finance_state set state=p_state,version=v_version+1,updated_at=now() where user_id=v_user_id;
 return v_version+1;
end;
$$;
revoke all on function public.save_finance_state(jsonb,bigint) from public,anon,authenticated;
-- The existing three-argument RPC still binds auth.uid() to the expected owner.
revoke all on function public.save_finance_state(jsonb,bigint,uuid) from public,anon;
grant execute on function public.save_finance_state(jsonb,bigint,uuid) to authenticated;
commit;
