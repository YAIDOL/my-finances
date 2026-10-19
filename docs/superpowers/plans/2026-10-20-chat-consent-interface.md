# Persistent chat consent and conversation interface

User scope: replace the permanent consent/model information with a first-entry Yes/No dialog; retain Yes for each account, repeat after No on the next chat visit; present a conversation interface resembling familiar chat apps.

- [x] Add atomic owner/session-guarded consent get/accept RPCs inside existing private user preferences; preserve unrelated preference keys and financial versions; verify isolation and cascade.
- [x] Test-first owner-bound client load/accept API with strict acknowledgment, cancellation and safe failures.
- [x] Rework chat into history sidebar, conversation and compact composer; hide provider/model details from routine UI; expose local planner through a separate control.
- [x] Add the specific provider/data disclosure to the Yes/No dialog. Never send a provider request after No or failed consent persistence; demo makes no consent/history/provider calls.
- [x] Verify No/re-entry, Yes/reload, private owner persistence, account changes, history/privacy/save/delete behavior and mobile sizes through CUA and real synthetic API users.
- [ ] Independent review, full tests/typecheck/build/credential scan, publish and verify GitHub Pages.

Decisions: consent stored in `user_preferences.preferences.financeChatConsent` via dedicated RPCs, never Auth metadata or a shared device flag. Only explicit Yes is persisted; No lasts for the mounted chat visit. Existing `finance-chat` requires an explicit true consent parameter on every message, unchanged. Existing conversation storage and account-deletion cascade stay in force. Provider/model metadata may remain internal to stored messages, but is absent from routine labels/statuses. The consent dialog continues to identify NVIDIA and the exact classes of data sent.
