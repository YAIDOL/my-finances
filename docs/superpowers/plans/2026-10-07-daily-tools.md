# Everyday finance tools

Approved scope: quick templates, recurring payments, funds until next income, debt reminders, and single-step undo. No installation/offline feature.

1. Extend the private FinanceState with an optional `assistance` envelope (templates, recurring rules, nextIncomeDate). Normalize legacy snapshots to defaults and validate imports. Debt reminders use optional `remindOn` alongside existing dueDate. Keep all amounts in integer kopecks.
2. Add domain tests first: monthly end-day/leap-year recurrence, confirmation atomicity, insufficiency, forecast double counting/reservations/overdue debts, snooze and repayment, user-bound undo and state mismatch. Run failing tests, then implement pure helpers in `daily.ts` and `undo.ts`.
3. Add an Everyday Tools page for template CRUD, recurring CRUD/pause/confirm, next-income date and explanation. Templates prefill ordinary TransactionEditor; every payment requires confirmation. Add compact Home shortcuts and expandable reminders. Link Budget and Debts to their tools. Preserve mobile layout and hidden amounts.
4. Integrate undo in the shared cloud mutation path. Capture the confirmed before/after snapshots and owner; clear on identity changes, reload/conflict, or next mutation. Undo uses the same versioned owner-bound server save. Never persist history or undo preferences/authentication.
5. Extend the existing Supabase RPC shape guard with assistance validation and reject old clients that would erase it. Keep RLS, expected owner/version checks and function privileges. Verify the migration with transactional synthetic data, without modifying real records.
6. Run targeted and randomized tests, full tests, typecheck/build, and browser demo checks on mobile/desktop. Test cash-only selectors, reminders/forecast/undo and linked recurrence records. Publish to existing GitHub Pages and verify live assets/UI. Save proof screenshots.
