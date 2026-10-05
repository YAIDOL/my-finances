# Seeded adversarial QA

The randomized suites are deterministic. UUID values do not select actions, so failures report a seed, step, and recent sequence that can be replayed. Each accepted transition is checked against an independently reconstructed balance/reservation ledger and then round-tripped through backup validation. Rejected operations must preserve the original state. Successful operations must preserve their input state too.

Run:

```powershell
node node_modules/vitest/vitest.mjs run
```

Focused run:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/finance.random.test.ts src/lib/auth.random.test.ts
```

## Automated coverage

- 20 finance seeds × 200 mixed actions = 4,000 transition attempts. Seeds start at `0xBADC0DE` and increase by `7919`.
- All 16 exported mutation functions, exercised through 18 action variants: account creation/archive/reactivation; income/expense/transfer creation; transaction edit/delete; goal creation/allocation/release; debt creation/repayment; payment creation/settlement/cancellation; category creation/rename.
- All finance calculation, empty/demo state, date, ID, formatting, parsing, and category lookup/option functions, plus category-name normalization.
- 2,000 generated money amounts parsed from decimal-dot and Ukrainian grouped decimal-comma inputs; amount precision, upper bound, zero, and display regressions.
- 500 independently corrupted backups, plus explicit hostile debt/payment/category/reference cases.
- 3,000 generated nicknames and 3,000 generated passwords. Nickname normalization and identity mapping; valid alphabet and length; Unicode codepoints, UTF-8 byte limits, whitespace, hidden controls, strength guidance.
- Owner-bound mocked cloud saves: explicit intended-owner transport, server-rejected account switch, invalid identities rejected before network access, exact version acknowledgments, and old-client reload guidance. Untrusted display metadata is included in nickname fuzzing and a separate focused profile suite.
- 1,000 unique UUID checks; Kyiv month/year boundaries; payable and receivable repayments; exact repayment limits; payment reversal and reservation release; transfers and archive/reversal sequences.
- Independent default category arrays; private state isolation; income/expense kind isolation; immutable category IDs after rename; malformed metadata; normalized duplicates; 200-category limit; legacy backup migration and stable references.

## Discovered regressions

1. Removing an original borrow/lend transaction could remove its debt while leaving a planned payment referencing that debt. The initial randomized generator reproduced this at seed `195952316`, step `93`. The minimized regression is `keeps a planned debt payment valid when its original loan is deleted`. The safe behavior is to reject the removal until linked payments are canceled.
2. Calendar validation accepted impossible dates such as `2026-02-30`, including through restored backups. The regression checks transactions, goals, debts without recording a money movement, planned payments, restored data, and a valid leap day.
3. Legacy category migration created equivalent custom categories for `Future trips` and `  FUTURE   trips  `. The migrated state then failed its next restore because category-name validation correctly rejected the duplicates. The regression is `deduplicates equivalent legacy custom category names during migration`.
4. A paid ordinary payment's category could differ from the linked expense category in a restored backup. Both category IDs were individually valid, but Budget and Journal/Analytics then described the same payment differently. The focused regression `rejects a paid expense whose category differs from its linked planned payment` reproduced the missing consistency check.

## Independent source review

The review covered transaction/category editors, modal/editor infrastructure, Accounts, Categories, Budget, Analytics, App, cloud reads/saves, and the category migration. Category identity is represented by stable IDs, displayed names are React-escaped, and category colors are constrained to hex. SQL categories remain in the owning user's existing private state row, and the RPC locks the row before checking its version. The migration rejects a legacy client that tries to remove an existing categories field.

Two additional issues were reported and corrected by the main agent: account display assumed user-editable authentication metadata `username` was a string, permitting a runtime `.slice()` crash for object/numeric metadata; and saving captured the intended owner only in App while the RPC obtained its current JWT asynchronously, permitting an account-switch race between state capture and authorization. Display metadata now passes a type/format guard. Save requests carry the captured owner, which the owner-bound RPC checks against the request identity. The race was identified from the installed Supabase SDK token-fetch code and was not reproduced against live accounts by this subagent; the updated request and failure paths are covered by mocked tests.

## Verification status

Final verification on 2026-10-06: `node node_modules/vitest/vitest.mjs run` passed all 113 tests across 7 files in approximately 3.5 seconds. The two new randomized files contain 45 passing tests, including all four discovered backup/domain regressions and the additional cloud boundaries. `node node_modules/typescript/bin/tsc --noEmit --pretty false` also passed. Each newly reproduced backup regression failed before its correction and passed afterward.

## Limits

These tests cover exported domain functions and authentication validation. They do not prove every possible sequence or provide an instrumented branch-coverage percentage. Counts describe generated cases and action attempts, not successful actions. Random scenarios include both intentional domain rejections and accepted transitions.

The cloud tests use mocked requests. Actual Supabase row-level security with two signed-in users, live persistence/reload, concurrent browser sessions and version conflicts, production deployment, browser UI interaction, keyboard/accessibility behavior, and mobile layout require separate verification. No browser was used by this subagent during the automated domain run. Passing tests cannot guarantee the absence of bugs.

A later isolated demo browser walkthrough was attempted at `http://127.0.0.1:4173/`. The browser tool returned `Browser is not available: iab`, and its browser inventory was empty (`[]`). Native automation APIs were disabled. No demo tab was created or interacted with. The exclusive browser slot was released immediately; this attempt does not count as UI verification.
