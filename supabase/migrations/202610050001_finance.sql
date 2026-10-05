-- Apply with a privileged migration account in the intended Supabase project.
-- Passwords remain exclusively in Supabase Auth; never store them in public tables.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

create table public.finance_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"accounts":[],"transactions":[],"goals":[],"debts":[],"payments":[],"budgets":[]}'::jsonb,
  version bigint not null default 0 check (version between 0 and 9007199254740991),
  updated_at timestamptz not null default now(),
  constraint finance_state_shape check (
    jsonb_typeof(state) = 'object'
    and (state - array['accounts','transactions','goals','debts','payments','budgets']::text[]) = '{}'::jsonb
    and jsonb_typeof(state->'accounts') = 'array'
    and jsonb_typeof(state->'transactions') = 'array'
    and jsonb_typeof(state->'goals') = 'array'
    and jsonb_typeof(state->'debts') = 'array'
    and jsonb_typeof(state->'payments') = 'array'
    and jsonb_typeof(state->'budgets') = 'array'
    and state ?& array['accounts','transactions','goals','debts','payments','budgets']::text[]
  )
);

-- Preferences have an independent row and do not invalidate financial edits.
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{"theme":"dark","reducedMotion":false,"hideAmounts":false}'::jsonb,
  constraint user_preferences_object check (jsonb_typeof(preferences) = 'object')
);

alter table public.profiles enable row level security;
alter table public.finance_state enable row level security;
alter table public.user_preferences enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy finance_state_read_own on public.finance_state for select to authenticated
  using (user_id = (select auth.uid()));
create policy preferences_read_own on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy preferences_insert_own on public.user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy preferences_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on table public.profiles, public.finance_state, public.user_preferences from public, anon, authenticated;
grant select on table public.profiles, public.finance_state, public.user_preferences to authenticated;
grant insert (user_id, preferences), update (preferences) on public.user_preferences to authenticated;

create function public.create_finance_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  if jsonb_typeof(new.raw_user_meta_data->'username') is distinct from 'string' then
    raise exception 'INVALID_NICKNAME' using errcode = '22023';
  end if;
  -- Reject non-ASCII input before lowercasing, including Unicode lookalikes.
  v_username := btrim(new.raw_user_meta_data->>'username');
  if v_username !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'INVALID_NICKNAME' using errcode = '22023';
  end if;
  v_username := lower(v_username);
  if new.email is distinct from v_username || '@users.my-finances.invalid' then
    raise exception 'INVALID_NICKNAME_EMAIL' using errcode = '22023';
  end if;
  insert into public.profiles(user_id, username) values (new.id, v_username);
  insert into public.user_preferences(user_id) values (new.id);
  return new;
end;
$$;

revoke all on function public.create_finance_profile() from public, anon, authenticated;
create trigger on_auth_user_created_finance
  after insert on auth.users
  for each row execute function public.create_finance_profile();

create function public.save_finance_state(p_state jsonb, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_version bigint;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or p_expected_version >= 9007199254740991 then
    raise exception 'INVALID_FINANCE_VERSION' using errcode = '22023';
  end if;
  if (jsonb_typeof(p_state) = 'object'
    and (p_state - array['accounts','transactions','goals','debts','payments','budgets']::text[]) = '{}'::jsonb
    and jsonb_typeof(p_state->'accounts') = 'array'
    and jsonb_typeof(p_state->'transactions') = 'array'
    and jsonb_typeof(p_state->'goals') = 'array'
    and jsonb_typeof(p_state->'debts') = 'array'
    and jsonb_typeof(p_state->'payments') = 'array'
    and jsonb_typeof(p_state->'budgets') = 'array'
    and p_state ?& array['accounts','transactions','goals','debts','payments','budgets']::text[]
  ) is not true then
    raise exception 'INVALID_FINANCE_STATE' using errcode = '22023';
  end if;

  -- ON CONFLICT serializes simultaneous initial inserts. The following locked
  -- read observes the winning save, including when both callers expected zero.
  insert into public.finance_state(user_id) values (v_user_id)
    on conflict (user_id) do nothing;
  select version into v_version from public.finance_state
    where user_id = v_user_id for update;
  if v_version <> p_expected_version then
    raise exception 'FINANCE_VERSION_CONFLICT' using errcode = 'P0001',
      hint = 'Reload the confirmed state before attempting another edit.';
  end if;
  update public.finance_state set state = p_state, version = v_version + 1,
    updated_at = now() where user_id = v_user_id;
  return v_version + 1;
end;
$$;

-- No direct financial writes: every edit must obey the atomic version check.
revoke all on function public.save_finance_state(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_finance_state(jsonb, bigint) to authenticated;

commit;
