# Ledger comfort implementation plan

**Goal:** Deliver the user's six approved features on the existing GitHub Pages/Supabase site: reconcile balances, split purchases, 80% budget alerts, confirmed income distribution, monthly summary, and opening balances.

**Architecture:** Preserve integer kopecks and one private, versioned financial document. An expense stores optional category parts inside one transaction; reconciliation uses explicit adjustment transaction kinds excluded from income/expense. Goal allocation histories and an income's distribution receipt are nested metadata. A formatVersion=2 marker protects the new schema from old clients; legacy documents normalize on read.

**Tech stack:** React/TypeScript, existing Vite/Vitest/Supabase. No new runtime dependencies. Ukrainian UI, dark/light themes, hidden amounts, 320px forms, reduced motion, session undo.

## Constraints and decisions

- Work in the existing clean `codex/build-finance` checkout so the user preview remains usable; no new checkout needed for this continuation.
- Opening balances describe existing money and do not create income. Reconciliation never spends reserved money; reject a factual balance below reservations and explain how to release them first.
- Expense parts are positive kopecks, 2–20 distinct expense categories, exactly equal to the transaction's total. Edits/deletion/undo affect the single transaction atomically.
- Distribution reserves existing unreserved planned payments on the income's account, creates reserved debt installments, and allocates goals. It does not pay bills, transfer bank funds, or create another income. Source budget is at most min(income amount, currently available account funds), applies once per income, with explicit editable review. Everyday funds are the unallocated remainder.
- Goal histories record new allocation/release changes, not invented dates for legacy savings. Monthly report labels the tracked history limitation.
- Existing publication and random QA authorization continues. No receipt scanning, PWA, offline feature, or external notifications in this scope.

## Task 1 — ledger and opening balance

Files: types.ts, finance.ts, ledger.test.ts, Accounts.tsx, ReconcileAccount.tsx.
- [x] Write failing tests for upward/downward/no-change reconciliation, reservations, invalid dates, cash, and opening balance excluded from income.
- [x] Implement `reconcileAccount(state,id,actual,note,date)` and adjustment validation/account signs.
- [x] Add required zero-allowed opening balance input and live reconciliation preview/confirmation.

## Task 2 — split expense

Files: finance.ts, TransactionEditor.tsx, ui.tsx, Transactions.tsx, ledger.test.ts.
- [x] Test exact-total parts, category type/duplicates/count, edit/delete/undo conservation, invalid imports.
- [x] Implement optional `Transaction.splits`, `expenseParts(tx)`, and split validation. Update journal search/details and category-aware consumers.
- [x] Add expense-only split editor with 2–20 editable lines, colors, remaining amount, and one confirm.

## Task 3 — goal history and reports

Files: finance.ts, reporting.ts/test.ts, Analytics.tsx, Budget.tsx, BudgetWarnings.tsx, reporting.css, Home.tsx.
- [x] Record dated goal allocation/release history through the existing helpers.
- [x] Test split aggregation, exact 80%/100% thresholds, month boundary, savings flows, debt principal movements, category growth.
- [x] Add monthly summary and budget alerts, with compact expandable Home alerts and hidden amounts.

## Task 4 — confirmed income distribution

Files: distribution.ts/test.ts, IncomeDistributor.tsx/css, App.tsx, Transactions.tsx.
- [x] Test source cap, reserved/debt overlap, goals cap, active owner account, duplicate application, stale proposals, atomic failure, and journal conservation.
- [x] Implement editable suggestion and atomic confirmed application, store a nested distribution receipt on the source income.
- [x] Offer the proposal after new income and from its journal row; allow dismissing without changing finance.

## Task 5 — cloud compatibility

Files: supabase.ts, migration, SQL rollback QA.
- [x] Extend client shape guard for formatVersion=2 and nested metadata validation.
- [x] Read current Supabase docs, apply a migration preserving RLS/owner/version checks and legacy reads; reject old saves once version 2 is stored.
- [x] Verify synthetic owner-bound save/undo, nested fields persistence, version conflict and legacy-client rejection within ROLLBACK.

## Task 6 — review, random QA and publication

- [x] Independent review for each delegated task and whole change; random mixed-action tests using disposable fixtures.
- [x] Run full tests, TypeScript and build; browser demo checks of all six flows at desktop and 320px, light theme, hidden amounts.
- [x] Update feature/setup/verification docs and save browser proof screenshots. Release checkpoint: commit, push HEAD:main, then verify successful workflow and live asset/UI; record that outcome in the execution ledger.
