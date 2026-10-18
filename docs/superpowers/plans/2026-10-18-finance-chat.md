# Secure finance assistant implementation plan

**Goal:** Add an authenticated Ukrainian finance chat using NVIDIA `z-ai/glm-5.3-flash`, plus exact day/week/month planning and explicitly confirmed budget proposals.

**Architecture:** Browser calls a Supabase Edge Function; only that function reads `NVIDIA_API_KEY` from server secrets and calls the fixed NVIDIA endpoint. It verifies the session and expected owner, loads that owner's finance document through RLS, computes a reduced summary, and enforces atomic per-user and project request limits. The model receives no keys, account identifiers, card suffixes, transaction notes or debt counterparties. The frontend displays text without HTML and keeps history only while its current owner remains active. Model output cannot write finance data.

**Constraints:** Existing personal data, Auth settings, owner/version-checked saves, and undo behavior remain intact. Keys never enter Vite variables, source files, migrations, logs or browser storage. A key pasted into chat should be rotated and its replacement entered directly into server secrets. User consent is required before sending financial summaries to NVIDIA; demo uses an explicitly labeled local planner without provider requests. No bank transactions or autonomous finance mutations.

- [x] TDD exact planner/context filtering, obligation deduplication, deterministic plan validation and version-safe application of month limits.
- [x] TDD Edge authentication, owner binding, consent/body limits, quota errors, timeout/provider failure, output filtering and secret redaction.
- [x] Add private rate-limit storage and tightly scoped RPCs with owner/session checks and no direct client table access. Verify SQL on synthetic users with rollback.
- [x] Build responsive chat UI, initial privacy consent, suggested prompts, period plan cards, apply-preview confirmation, cancel/error states and owner-change isolation.
- [ ] Deploy Edge Function, prepare `NVIDIA_API_KEY` through server secret configuration, and verify actual provider chat without sending real user finances.
- [ ] Independent security/code review, full tests/typecheck/build, browser desktop/320px checks and secret scan.
- [ ] Document setup/limits, publish to GitHub Pages, verify workflow and live build, save screenshot proof.

Edge deployed (version 2) and all configuration/auth-denial paths verified. Actual provider test remains pending direct user entry of a rotated NVIDIA_API_KEY into managed Edge Secrets; connector cannot set secrets and browser requires sign-in. No key from the user message was stored or used. Documentation explains the final setup step.
