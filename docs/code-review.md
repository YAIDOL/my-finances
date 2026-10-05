# Implementation review — 2026-10-05

Reviewed the implementation plan, detailed concept, domain model, authentication and persistence code, SQL migration, App, and all page/editor components. This is a source review of the local implementation; the coordinator is separately performing browser QA.

## Findings to fix before publication

### P1 — Transaction reversal can restore funds into an inaccessible archived account

- Location: `src/lib/finance.ts:22` (`removeTransaction`), with the missing invariant at `src/lib/finance.ts:19`; archived accounts are hidden at `src/pages/Accounts.tsx:5`.
- Reproduction: create account A with 100 UAH and B with zero; transfer all 100 UAH from A to B; archive empty A; delete that transfer in Operations.
- Actual: deletion succeeds, including `restoreFinanceState` validation. A remains archived with 100 UAH, B has zero, and total balance is 100 UAH. A is absent from the account screens and account selectors, and `account()` rejects new operations on it. The user cannot spend or transfer the restored money through the UI.
- Verified with an isolated execution of the existing domain functions: `archived: true`, `hiddenAccountBalance: 10000`, `totalBalance: 10000`.
- Fix: reject reversal that would leave money/reservations on an archived account, or atomically reactivate every affected account. Apply the invariant to backup validation as well. Add a regression test covering transfer deletion after source-account archival.

### P1 — A cancelled planned payment permanently reserves its funds

- Location: `src/pages/Budget.tsx:5`; related behavior at `src/lib/finance.ts:15`, `:22`, `:29`, and `:30`.
- Reproduction: create a reserved payment, then decide it was mistaken or is cancelled. Its only available action is payment. There is no cancel, delete, edit, or release-reservation action.
- Actual: the funds stay unavailable indefinitely. Paying invents an expense; deleting that expense changes the payment back to `planned` and immediately reserves the same funds again. A debt-linked planned payment can also become impossible to pay if its debt has already been settled separately, leaving the reserve stranded.
- Fix: provide an explicit cancellation/removal operation for planned payments that releases its reservation without creating any transaction. If paid payments are removable, preserve their actual transaction instead of silently reversing it. Test that cancelling restores available funds while balance and expenses stay unchanged.

### P2 — Failed modal submissions do not receive their error message

- Location: `src/App.tsx:31` (`mutate`) and `src/components/ui.tsx:18` (`Editor`).
- Reproduction: submit an invalid money string or an expense greater than available funds in the transaction editor.
- Actual: `mutate` catches the error, emits a global toast, and resolves `false`. Editor only renders an inline error when its callback throws, so its error region stays empty. The toast is outside the native dialog's top layer; it is behind the modal/backdrop and may be obscured, dimmed, and inaccessible while the dialog remains open. The user sees an unchanged form without an accessible explanation at the input. This also affects cloud-save failures and delete-confirmation dialogs.
- Fix: return a structured error or propagate errors to the submitting dialog and display them inside that dialog. Keep separate handling for nonmodal actions. Confirm insufficient-funds and network-error flows in browser QA.

### P2 — Accounts with unpaid, unreserved payments can be archived

- Location: `src/lib/finance.ts:31` (`archiveAccount`).
- Reproduction: create an unreserved planned payment on a zero-balance account, then archive that account.
- Actual: archival succeeds because the check only looks at balance and reserved funds. Payment later fails with `Обери активний рахунок.` No UI can change the payment account or restore the archived account.
- Verified with the existing domain functions.
- Fix: prevent archival while any planned payment refers to the account, or require explicit reassignment/cancellation. Add a regression test. Payment cancellation from the preceding finding provides a recovery path but should not replace this guard.

## Scope and code-quality notes

The eight major pages, manual transactions, transfers, goal reservations, debts/repayments, budgets/payments, demo mode, themes, import/export, nickname authentication, and versioned cloud-save code exist. The code uses integer kopecks and keeps ordinary income/expense totals separate from loans and transfers. It validates state before local adoption and preserves confirmed state after failed cloud saves.

The implementation is narrower than `output/finance-concept/sections-detailed.md`. Missing described flows include account editing/reconciliation and account details; transaction editing/repeating/templates/refunds, category filtering, and amount sorting; goal allocation history and completion; debt description/deadline editing; creation of debt-linked planned payments; comparisons across months; and category/default-account customization. These are scope gaps rather than additional safety blockers in the implemented flows. The owner should explicitly record what is deferred before describing the entire detailed concept as complete.

Most components and domain functions are compressed onto a single line. This makes related logic and changes difficult to review, but is a maintainability observation rather than a publication blocker. Formatting can be handled separately without expanding the feature scope.

## Security review observations and limits

The migration enables RLS on all three public tables, restricts reads by `auth.uid()`, revokes direct financial writes, and grants the save RPC only to authenticated users. The definer RPC chooses its owner from `auth.uid()` and checks version while holding a row lock; callers do not supply an arbitrary owner ID. Passwords are passed to Supabase Auth and do not enter application state or backups. No cross-user authorization flaw was identified in this source pass.

Cloud verification remains pending an actual Supabase connection. This review does not verify the applied migration, Auth configuration (email confirmation disabled and minimum password length six), synthetic-email signup behavior, two-user isolation, concurrent first writes/conflicts, or real persistence. Browser authentication success must not be claimed until those checks run.

## Checks performed

- `node node_modules/vitest/vitest.mjs run`: **45 passed**, 2 files.
- `node node_modules/typescript/bin/tsc -b`: **passed**.
- Isolated domain reproductions confirmed both archived-account findings, including restoration validation of the stranded balance.
- Existing tests do not cover these findings or Supabase integration. No application code, migrations, commits, or deployments were changed during this review.
