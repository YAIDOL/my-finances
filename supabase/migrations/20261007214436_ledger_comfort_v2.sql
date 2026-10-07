begin;
create or replace function private.finance_shape_v1_ok(s jsonb)
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
revoke all on function private.finance_shape_v1_ok(jsonb) from public, anon, authenticated;
create or replace function private.finance_date_ok(v text)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if v is null or v !~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$' then return false; end if;
 return (v::date)::text=v;
exception when others then return false;
end; $$;
create or replace function private.finance_money_ok(v jsonb,allow_zero boolean default false)
returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v)='number' and (v#>>'{}') ~ '^[0-9]{1,12}$'
 then (v#>>'{}')::numeric between (case when allow_zero then 0 else 1 end) and 100000000000 else false end;
$$;
create or replace function private.finance_metadata_ok(s jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare t jsonb; g jsonb; h jsonb; part jsonb; item jsonb; receipt jsonb; total numeric; ids text[];
begin
 if s ? 'formatVersion' and s->'formatVersion' <> '2'::jsonb then return false; end if;
 if s ? 'formatVersion' and (not s ? 'categories' or not s ? 'assistance') then return false; end if;
 for t in select value from jsonb_array_elements(s->'transactions') loop
  if t ? 'splits' or t ? 'distribution' or t->>'kind' in ('adjustment-increase','adjustment-decrease') then
   if s->'formatVersion' is distinct from '2'::jsonb then return false; end if;
  end if;
  if t->>'kind' in ('adjustment-increase','adjustment-decrease') and
   (private.finance_money_ok(t->'amount') and private.finance_date_ok(t->>'date') and jsonb_typeof(t->'note')='string' and length(btrim(t->>'note')) between 1 and 200 and not t ? 'debtId' and not t ? 'paymentId') is not true then return false; end if;
  if t ? 'splits' then
   if t->>'kind' <> 'expense' or t ? 'paymentId' or jsonb_typeof(t->'splits') is distinct from 'array' then return false; end if;
   if jsonb_array_length(t->'splits') not between 2 and 20 then return false; end if;
   total:=0; ids:=array[]::text[];
   for part in select value from jsonb_array_elements(t->'splits') loop
    if (jsonb_typeof(part)='object' and private.finance_money_ok(part->'amount') and jsonb_typeof(part->'category')='string') is not true then return false; end if;
    if part->>'category'=any(ids) or not exists(select 1 from jsonb_array_elements(s->'categories') c where c->>'id'=part->>'category' and c->>'kind'='expense') then return false; end if;
    ids:=array_append(ids,part->>'category'); total:=total+(part->>'amount')::numeric;
   end loop;
   if private.finance_money_ok(t->'amount') is not true or total<>(t->>'amount')::numeric or t->>'category' is distinct from t->'splits'->0->>'category' then return false; end if;
  end if;
  if t ? 'distribution' then
   receipt:=t->'distribution';
   if (t->>'kind'='income' and jsonb_typeof(receipt)='object' and private.finance_date_ok(receipt->>'date') and private.finance_money_ok(receipt->'sourceAmount',true) and private.finance_money_ok(receipt->'daily',true) and jsonb_typeof(receipt->'items')='array' and private.finance_money_ok(t->'amount')) is not true then return false; end if;
   if jsonb_array_length(receipt->'items')>200 or (receipt->>'sourceAmount')::numeric>(t->>'amount')::numeric then return false; end if;
   total:=(receipt->>'daily')::numeric;
   for item in select value from jsonb_array_elements(receipt->'items') loop
    if (jsonb_typeof(item)='object' and item->>'kind' in ('goal','payment','debt') and jsonb_typeof(item->'name')='string' and length(btrim(item->>'name')) between 1 and 60 and private.finance_money_ok(item->'amount')) is not true then return false; end if;
    total:=total+(item->>'amount')::numeric;
   end loop;
   if total<>(receipt->>'sourceAmount')::numeric then return false; end if;
  end if;
 end loop;
 for g in select value from jsonb_array_elements(s->'goals') loop
  if g ? 'history' then
   if s->'formatVersion' is distinct from '2'::jsonb or jsonb_typeof(g->'history') is distinct from 'array' then return false; end if;
   if jsonb_array_length(g->'history')>5000 then return false; end if;
   ids:=array[]::text[];
   for h in select value from jsonb_array_elements(g->'history') loop
    if (jsonb_typeof(h)='object' and jsonb_typeof(h->'id')='string' and length(h->>'id') between 1 and 200 and jsonb_typeof(h->'accountId')='string' and private.finance_money_ok(h->'amount') and private.finance_date_ok(h->>'date') and h->>'direction' in ('save','release')) is not true then return false; end if;
    if h->>'id'=any(ids) or not exists(select 1 from jsonb_array_elements(s->'accounts') a where a->>'id'=h->>'accountId') then return false; end if;
    ids:=array_append(ids,h->>'id');
   end loop;
  end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function private.finance_date_ok(text),private.finance_money_ok(jsonb,boolean),private.finance_metadata_ok(jsonb) from public,anon,authenticated;
create or replace function private.finance_shape_ok(s jsonb)
returns boolean language sql immutable set search_path='' as $$
 select private.finance_shape_v1_ok(s-'formatVersion') is true and private.finance_metadata_ok(s) is true;
$$;
revoke all on function private.finance_shape_ok(jsonb) from public,anon,authenticated;

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
 if (v_old_state ? 'categories' and not p_state ? 'categories') or (v_old_state ? 'assistance' and not p_state ? 'assistance') or (v_old_state->'formatVersion'='2'::jsonb and p_state->'formatVersion' is distinct from '2'::jsonb) then raise exception 'FINANCE_CLIENT_OUTDATED' using errcode='22023'; end if;
 update public.finance_state set state=p_state,version=v_version+1,updated_at=now() where user_id=v_user_id;
 return v_version+1;
end;
$$;
revoke all on function public.save_finance_state(jsonb,bigint) from public,anon,authenticated;
-- The existing three-argument RPC still binds auth.uid() to the expected owner.
revoke all on function public.save_finance_state(jsonb,bigint,uuid) from public,anon;
grant execute on function public.save_finance_state(jsonb,bigint,uuid) to authenticated;
commit;
