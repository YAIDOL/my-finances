# Personal finance site implementation plan

> Execute inline with bounded subagent help for the independent Supabase integration and final review.

**Goal:** Build the approved Ukrainian finance manager, publish its static frontend to GitHub Pages, and connect username/password authentication and private data to Supabase.

**Architecture:** React and TypeScript static SPA using hash routes, Vite relative asset URLs, Supabase Auth, private profiles and an atomic versioned finance_state JSON document per user. All money is stored as integer kopecks and all state changes go through domain functions. Supabase RLS binds rows to auth.uid().

**Tech stack:** React, TypeScript, Vite, motion, lucide-react, Supabase JS, Vitest, Playwright for local QA.

**Spec:** output/finance-concept/sections-detailed.md and dashboard-dark-v3.png, plus the user's new auth, themes, GitHub Pages and Supabase requirements.

## Constraints and decisions

- Ukrainian UI, graphite/navy default, light and system themes, reduced-motion support.
- Manual finance entry; authenticated accounts start empty, illustrative data only in a clearly marked demo.
- Minimum password length 6 characters, strength meter and repeat-password check; passwords never enter application database or demo persistence.
- Nicknames normalized lowercase, 3–24 Latin letters/digits/underscores. Private username profiles. Auth maps nickname to a deterministic synthetic email; confirm-email must be off for nickname-only signup.
- GitHub Pages is the chosen host; no Sites hosting.
- No secret or service role key in the frontend or public repository.
- Cloud edits use optimistic version checking; a failed save must not replace confirmed state or silently switch to local persistence.
- A brand-new repo is initialized in this otherwise empty workspace on codex/build-finance; no shared checkout is changed.

## Task 1: Domain and meaningful tests

Files: src/lib/types.ts, src/lib/finance.ts, src/lib/finance.test.ts, package.json, vite.config.ts.
Write failing tests for account balances, internal transfers, savings reservation limits, debt repayment, transaction deletion and budget summaries. Then implement integer-money domain operations and sample demo state. Run Vitest.

## Task 2: Supabase auth and persistence

Files: src/lib/auth.ts, src/lib/auth.test.ts, src/lib/supabase.ts, supabase/migrations/202610050001_finance.sql, docs/SUPABASE.md.
Interfaces: FinanceState has accounts, transactions, goals, debts, payments, budgets arrays; user preferences persist separately. Auth validates nickname/password, signup/signin use Supabase. loadFinanceState(userId) returns state/version; saveFinanceState(state,expectedVersion) returns new version or raises a conflict. Migration creates profiles, finance_state, RLS and atomic save RPC.
Test auth validation and strength scoring before implementation. Document exact setup and no-password-recovery limitation for nickname-only auth.

## Task 3: App and UI

Files: src/App.tsx, src/components/*, src/pages/*, src/styles.css, public/assets/*.
Implement auth, home, accounts, transactions with filters/delete, savings with allocate/release, debts with lend/borrow/repay, budgets/planned payments, analytics, settings/themes/export. Add accessible forms with loading/error/success states. Integrate domain functions and cloud load/save. Keep home compact and match approved serious color design. Demo is an explicit separate mode with session-local state.

## Task 4: Quality and publication

Files: .github/workflows/pages.yml, README.md, .env.example, docs/verification.md.
Run meaningful domain/auth tests, TypeScript and production build, then browser tests of demo CRUD, auth validation, light/dark mode, mobile navigation, keyboard dialogs and reduced motion. Review auth isolation and persistence. Publish only public frontend config with Supabase URL and publishable key; verify GitHub Pages URL and actual cloud auth/data if connection is supplied.

## Progress

- Plan and architecture: complete.
- Domain: complete; 51 domain/auth tests pass, including edit/archive/payment regressions.
- Supabase: project created, migration applied, nickname auth configured; real two-user persistence/isolation/concurrency QA passed.
- Interface: complete; dark/light/system themes, responsive navigation, reduced motion, manual finance flows and safe edits.
- Verification: TypeScript and production build pass; demo and real cloud save/reload checked in browser; independent code review complete.
- Publication: code pushed to YAIDOL/my-finances, public Supabase variables configured. GitHub Pages deployment delayed by the confirmed GitHub Actions runner incident on 2026-10-05. A compiled gh-pages fallback was also requested and entered the same runner queue.
