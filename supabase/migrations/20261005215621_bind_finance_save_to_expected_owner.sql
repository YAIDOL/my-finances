begin;
-- Bind the snapshot to the identity captured by the caller before async work.
create function public.save_finance_state(p_state jsonb, p_expected_version bigint, p_expected_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then
    raise exception 'FINANCE_OWNER_MISMATCH' using errcode = '42501';
  end if;
  return public.save_finance_state(p_state, p_expected_version);
end;
$$;

-- The existing two-argument implementation is now an internal helper only.
revoke all on function public.save_finance_state(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.save_finance_state(jsonb, bigint, uuid) from public, anon, authenticated;
grant execute on function public.save_finance_state(jsonb, bigint, uuid) to authenticated;
commit;
