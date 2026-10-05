# Backend Task 2 report

Completed files:

- `src/lib/auth.ts`: case-normalized ASCII nickname validation, deterministic synthetic email, six-character minimum, 72-byte UTF-8 maximum, whitespace/control rejection, advisory strength meter in Ukrainian.
- `src/lib/auth.test.ts`: meaningful auth and cloud-boundary tests written and observed failing before implementation, then passing.
- `src/lib/supabase.ts`: publishable/legacy anon configuration, nickname signup/signin/signout, identity-checked state loading, atomic version RPC saving, Ukrainian errors and actionable conflict; no demo or local fallback.
- `supabase/migrations/202610050001_finance.sql`: private unique lowercase profiles, isolated JSON state and preferences, RLS, restrictive grants, server-side signup checks, locked atomic save and simultaneous initial-save protection.
- `docs/SUPABASE.md`: exact setup, credentials handling, no-email-recovery limitation and pending cloud verification checklist.

Verification: bundled Node invoking `node_modules/vitest/vitest.mjs run src/lib/auth.test.ts` passes **32 tests**. `node_modules/typescript/bin/tsc --noEmit` passes with the current complete source tree. Initial auth red run had 22 expected failures; initial cloud-boundary red run had five expected failures. The pnpm wrapper initially refused ignored esbuild build scripts; direct bundled Node successfully runs Vitest. No commits made by this agent.

Remaining settings/actions in the actual Supabase project:

1. Select the intended project and apply the migration once.
2. Enable Email/password and new-user signup; **disable Confirm email**.
3. Set minimum password length **6** and do not require additional character classes. Synthetic emails cannot recover passwords or receive confirmation links.
4. Provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) at build time; never a service-role/secret key.
5. Set Site URL to the published GitHub Pages address and allow local development URL as needed.
6. Execute the documented two-user isolation, invalid direct signup, unauthenticated-access, direct-write rejection, concurrent-first-save, reload and offline checks.

**No Supabase connector/project credentials were available during this task. The SQL migration has not been executed against a live database, and cloud deployment/RLS/concurrency have not been claimed as verified.** The preferences table is separate and prepared, while required finance APIs do not read/write preferences. Frontend may keep device preferences locally.
