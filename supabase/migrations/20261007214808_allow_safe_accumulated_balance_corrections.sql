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
   ((jsonb_typeof(t->'amount')='number' and t->>'amount' ~ '^[0-9]{1,16}$' and (t->>'amount')::numeric between 1 and 9007199254740991) and private.finance_date_ok(t->>'date') and jsonb_typeof(t->'note')='string' and length(btrim(t->>'note')) between 1 and 200 and not t ? 'debtId' and not t ? 'paymentId') is not true then return false; end if;
  if t ? 'splits' then
   if t->>'kind' is distinct from 'expense' or t ? 'paymentId' or jsonb_typeof(t->'splits') is distinct from 'array' then return false; end if;
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

revoke all on function private.finance_metadata_ok(jsonb) from public,anon,authenticated;
