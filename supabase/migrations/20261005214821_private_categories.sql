begin;
-- Existing six-array documents remain readable; categories use the same owner RLS.
alter table public.finance_state drop constraint finance_state_shape;
alter table public.finance_state add constraint finance_state_shape check (
 jsonb_typeof(state) = 'object'
 and (state - array['accounts','transactions','goals','debts','payments','budgets','categories']::text[]) = '{}'::jsonb
 and jsonb_typeof(state->'accounts') = 'array'
 and jsonb_typeof(state->'transactions') = 'array'
 and jsonb_typeof(state->'goals') = 'array'
 and jsonb_typeof(state->'debts') = 'array'
 and jsonb_typeof(state->'payments') = 'array'
 and jsonb_typeof(state->'budgets') = 'array'
 and state ?& array['accounts','transactions','goals','debts','payments','budgets']::text[]
 and (not state ? 'categories' or coalesce(jsonb_typeof(state->'categories') = 'array', false))
);

create or replace function public.save_finance_state(p_state jsonb, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_version bigint;
  v_has_categories boolean;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or p_expected_version >= 9007199254740991 then
    raise exception 'INVALID_FINANCE_VERSION' using errcode = '22023';
  end if;
  if (jsonb_typeof(p_state) = 'object'
    and (p_state - array['accounts','transactions','goals','debts','payments','budgets','categories']::text[]) = '{}'::jsonb
    and jsonb_typeof(p_state->'accounts') = 'array'
    and jsonb_typeof(p_state->'transactions') = 'array'
    and jsonb_typeof(p_state->'goals') = 'array'
    and jsonb_typeof(p_state->'debts') = 'array'
    and jsonb_typeof(p_state->'payments') = 'array'
    and jsonb_typeof(p_state->'budgets') = 'array'
    and (not p_state ? 'categories' or coalesce(jsonb_typeof(p_state->'categories') = 'array', false))
    and p_state ?& array['accounts','transactions','goals','debts','payments','budgets']::text[]
  ) is not true then
    raise exception 'INVALID_FINANCE_STATE' using errcode = '22023';
  end if;

  -- ON CONFLICT serializes simultaneous initial inserts. The following locked
  -- read observes the winning save, including when both callers expected zero.
  insert into public.finance_state(user_id) values (v_user_id)
    on conflict (user_id) do nothing;
  select version, state ? 'categories' into v_version, v_has_categories from public.finance_state
    where user_id = v_user_id for update;
  if v_version <> p_expected_version then
    raise exception 'FINANCE_VERSION_CONFLICT' using errcode = 'P0001',
      hint = 'Reload the confirmed state before attempting another edit.';
  end if;
  -- A previous client must not silently remove private categories.
  if v_has_categories and not p_state ? 'categories' then
    raise exception 'FINANCE_CLIENT_OUTDATED' using errcode = '22023';
  end if;
  update public.finance_state set state = p_state, version = v_version + 1,
    updated_at = now() where user_id = v_user_id;
  return v_version + 1;
end;
$$;

revoke all on function public.save_finance_state(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_finance_state(jsonb, bigint) to authenticated;
commit;
