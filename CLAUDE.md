# Roots & Branches: notes for Claude

Family tree app. Next.js (App Router, TypeScript) + Supabase + Capacitor. See README.md for the
architecture, API and build/deploy setup.

The owner writes in Serbian (Cyrillic); answer in Serbian. Code, comments and commit messages in
English. UI text is Serbian Cyrillic.

## Privacy
- Commit as `Claude <noreply@anthropic.com>` (`git -c user.name=Claude -c user.email=noreply@anthropic.com commit ...`),
  never with a name or email from git config or the session.
- The only personal credit in the app is the one the owner asked for: "Developed by: Ivan S. - Epicurus001, Oslo".

## Workflow
- Work on a branch, open a PR, merge only when the owner says so ("спој"). Batch small items into one PR.
- Before pushing run: `npm run typecheck`, `npm test`, `supabase/tests/run.sh` (PostgreSQL),
  `npm run test:integration` (PostgreSQL + `.bin/postgrest` from `scripts/get-postgrest.sh`),
  and for UI changes `npm run build:static` + `scripts/serve-static.mjs` + `npm run test:e2e`.
- Verify UI with numbers (the e2e checks); screenshot only when the layout changes a lot.
- Do not watch CI live; report once it is done.

## Rules
- Database changes: new migration file in `supabase/migrations` (never edit applied ones), extend
  `supabase/tests/10_phase1_test.sql`. Keep `src/lib/types/db.ts` in sync.
- Validation rules exist twice on purpose (SQL triggers + `src/lib/validation`); change both.
- Pages must work as a static export (no server-only APIs in `src/app/**/page.tsx`; use query
  params, not dynamic segments). API routes live in `src/app/api` and are excluded from `build:static`.
- `android/app/roots-branches.keystore` must not change (installed test apps could not update).
- Photo limit is off by default (`app_settings.free_photo_limit = null`).
