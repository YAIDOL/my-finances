# Private Chat History Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for isolated file responsibilities, tests and review.

**Goal:** Give chat a visible navigation entry and retain each user's past conversations across sessions/devices.

**Architecture:** Private owner-bound Supabase conversation documents, SELECT-only RLS for clients, and owner/session/version checked save/delete RPCs. Completed user/assistant turns save atomically. The UI shows full history while sending only bounded recent context to the existing secure Edge Function. Provider keys and finance data access remain server-only.

**Tech Stack:** React, TypeScript, Supabase Auth/Postgres/RLS, existing NVIDIA Edge Function and GitHub Pages.

**Spec:** User request of 19 October: separate visible chat menu, past chats saved individually for each user. Includes a new-chat button, dated thread list, continuation, explicit delete confirmation and save failure recovery. Past memory-only chats cannot be recovered.

## Global Constraints

- Keep the current codex branch/workspace and unrelated untracked files intact; deployment remains authorized from this task's prior work.
- No real user finances changed, no provider secrets read or placed in source, no hidden browser storage for chat bodies.
- Conversations cascade on account deletion. UI privacy mode hides titles, messages and drafts. Demo makes no history/provider calls.
- Up to 100 threads/owner, 200 messages/thread, 500000 JSON bytes. Plaintext user/assistant pairs, user<=1000 chars, assistant<=8000 chars, known optional assistant model only.
- Saves are append-only and version checked; exact repeat is idempotent. No overwrite or cross-owner writes. Failed persistence retains the visible answer and a retry-save action without another provider call.

- [x] Add SQL validation, table/index/RLS, owner/session/version RPCs and rollback isolation/concurrency/deletion tests.
- [x] TDD history client list/load/save/delete validation and owner-change protection.
- [x] Integrate history sidebar, lazy new conversations, full display/bounded model context, save recovery, switching/cancel guards and explicit deletion.
- [x] Add visible desktop Chat link and direct mobile Chat control.
- [x] Apply/verify migration on synthetic users, test real REST reload/account isolation and account-deletion cascade.
- [x] Independent security/UI review, full tests/typecheck/build/secret scan.
- [ ] Publish and verify GitHub Pages.

Verification: 489 Vitest tests, TypeScript and production build passed. Live rollback SQL QA and two-user REST concurrency/isolation/cascade QA passed. Secret scan: zero credentials or server-only references in client assets. Review findings fixed: Unicode title length, immediate session revocation for reads, terminal PT409 conflicts instead of PostgREST14's infinite 40001 retries. Browser observation of the existing error tab was blocked by URL policy; no bypass attempted.

Shared client contract (src/lib/chat-history.ts): ChatThread{id,title,updatedAt,version,messageCount}; SavedChat extends ChatThread{messages:ChatMessage[]}; listChatThreads(ownerId,signal?); loadChatThread(id,ownerId,signal?); saveChatThread({id,version,messages},ownerId,signal?); deleteChatThread({id,version},ownerId,signal?). ChatHistoryError is safe for UI display. SQL public.finance_chat_threads columns id,user_id,title,messages,version,updated_at,message_count. RPC save_finance_chat(p_chat_id,p_messages,p_expected_version,p_expected_user_id) returns {id,title,updated_at,version,message_count}; delete_finance_chat(p_chat_id,p_expected_version,p_expected_user_id) returns true. Initial version=0 creates first completed turn; id is a browser-generated UUID. Neither empty drafts nor failed provider calls create a saved thread.
