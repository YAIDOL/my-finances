# Accounts, money operations and private categories

**Goal:** Separate account creation from money movement, filter payment accounts by method, and give each user their own colored categories.

**Architecture:** Keep categories in the existing owner-protected Supabase finance document, with stable IDs. Read legacy six-array documents and migrate their category names in memory without changing money. Accept legacy documents on the server, but reject outdated writes once a document contains categories to prevent silent loss.

**Scope authorized by user:** Create accounts at zero; explicit income/expense/transfer actions; cash cannot select a card; category creation and editing; seeded random tests and adversarial UI testing by a subagent; publish the verified update to the existing GitHub Pages site.

- [x] Write failing regression tests for empty account creation, category identity/color/isolation, migration, method mismatch and calendar dates.
- [x] Add categories and strict validation to finance types/functions, preserving legacy balances and references.
- [x] Add category management and controlled operation/account editors; use category colors in journal, budget and analytics.
- [x] Extend Supabase shape constraint and versioned RPC with backward-compatible reads and stale-client write protection; verify RLS with two disposable test identities.
- [x] Run seeded random tests across all operations and exercise unusual UI inputs, state changes and every existing section.
- [x] Fix reproduced defects, run full tests and production build, update docs, commit/push and verify live GitHub Pages.

**Validation:** Unit regressions first; randomized sequences preserve account, debt and reservation invariants; rejected actions leave source state untouched. Browser checks must cover method switching, category creation/editing, account creation, transaction editing, responsive navigation and theme. Cloud checks verify category persistence and owner isolation. Never test against a real user's finances.
