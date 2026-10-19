-- Persist an affirmative chat-data consent independently of financial state.
-- Apply after the private finance-chat owner/session helper migration.
create function public.get_finance_chat_consent(p_expected_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_accepted boolean;
begin
 v_user_id:=private.require_finance_chat_owner(p_expected_user_id);
 select preferences->'financeChatConsent'->'accepted'='true'::jsonb
    and preferences->'financeChatConsent'->'version'='1'::jsonb
 into v_accepted from public.user_preferences where user_id=v_user_id;
 return coalesce(v_accepted,false);
end;
$$;
revoke all on function public.get_finance_chat_consent(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_chat_consent(uuid) to authenticated;

create function public.accept_finance_chat_consent(p_expected_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
 v_user_id:=private.require_finance_chat_owner(p_expected_user_id);
 insert into public.user_preferences(user_id) values(v_user_id)
  on conflict(user_id) do nothing;
 -- Read the current row inside UPDATE so unrelated preference edits survive.
 -- A replay leaves the first successful acceptance (including its date) intact.
 update public.user_preferences
 set preferences=jsonb_set(preferences,'{financeChatConsent}',jsonb_build_object(
  'version',1,'accepted',true,'acceptedAt',clock_timestamp()),true)
 where user_id=v_user_id and (
  preferences->'financeChatConsent'->'accepted'='true'::jsonb
  and preferences->'financeChatConsent'->'version'='1'::jsonb
 ) is not true;
 return true;
end;
$$;
revoke all on function public.accept_finance_chat_consent(uuid) from public,anon,authenticated,service_role;
grant execute on function public.accept_finance_chat_consent(uuid) to authenticated;
