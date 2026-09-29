# Roots & Branches (Породично стабло)

Family tree app: interactive pan/zoom tree, sharing via invitations, cloud sync (Supabase),
backups, PWA + Capacitor Android build.

Stack: Next.js (App Router, TypeScript), Tailwind + shadcn/ui, React Flow, Supabase
(PostgreSQL + RLS + Storage + Realtime), RevenueCat, Capacitor.

## Status

- [x] Phase 1: database schema, RLS, triggers (`supabase/migrations`)
- [x] Phase 2: TypeScript business logic and validation (`src/lib`)
- [x] Phase 3: API routes (invites, backup/restore, RevenueCat) (`src/app/api`, `src/server`)
- [x] Phase 4: mobile UI (`src/app`, `src/components`, `src/client`)
- [x] Phase 5: PWA, Capacitor Android app, OTA updates, backup UI

## Database (Phase 1)

| Migration | Contents |
|---|---|
| `…100_core.sql` | enums, `profiles` (auto-created on sign-up, billing fields), `trees`, `tree_members` (viewer / editor / owner), `has_tree_role()` |
| `…200_people.sql` | `persons`, `parent_child` (biological / adoptive / step / foster / guardian), `partnerships` (multiple marriages, status, dates), `person_siblings` view (full / half / adoptive / step), validation triggers |
| `…300_media.sql` | `media` (photos, documents), 30-photo free limit, private Storage bucket `family-media` and its policies |
| `…400_invitations.sql` | `invitations` (token link, optional email lock, 14-day expiry), `get_invitation()`, `accept_invitation()` |
| `…500_graph_backup.sql` | `get_ancestors()`, `get_descendants()`, `export_tree()` (JSON), `tree_snapshots`, `create_snapshot()`, `auto_snapshot()`, `restore_tree()`, `merge_trees()` |
| `…600_rls_grants_realtime.sql` | RLS on every table, column-level grants, Realtime publication |
| `…700_app_settings.sql` | `app_settings`; `free_photo_limit` (JSON `null` = off, the default during testing) |
| `…800_billing.sql` | `billing_events` (webhook idempotency), `profiles.plan_event_at`, `apply_plan_change()` (ignores out-of-order events) |

Rules enforced in the database:
- No cycles (nobody is their own ancestor), at most 2 biological parents, a biological parent is
  born before the child (exact dates), a living person has no death date, one active marriage per pair.
- Edges and media can never point across trees (composite foreign keys).
- Free plan photo limit (switched off by default; turn on with
  `update public.app_settings set value = '30' where key = 'free_photo_limit';`),
  enforced by the Storage upload policy + trigger; premium (`profiles.plan`,
  written only by the service role / RevenueCat webhook) is unlimited. Documents do not count.
- Clients cannot write server-owned columns (`plan`, `owner_id`, `uploaded_by`, `is_copy`, ...).

Storage path: `family-media/<tree_id>/photos/<file>` or `.../documents/<file>`. Upload the file
first, then insert the `media` row.

Automatic backups: the app calls `auto_snapshot(tree_id)` on start (max. one per 24 h, only after
changes). With `pg_cron` it can also run server-side:

```sql
select cron.schedule('auto-snapshots', '17 3 * * *',
  $$ select public.auto_snapshot(id) from public.trees $$);
```

### Apply

```bash
supabase link --project-ref <ref>
supabase db push
```

### Test locally (plain PostgreSQL 15+)

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh
```

`supabase/tests/00_supabase_stub.sql` imitates the Supabase `auth` / `storage` schemas; the tests
(`10_phase1_test.sql`) run as different users and check RLS, triggers, quota, invites, restore and
merge. CI runs the same script (`.github/workflows/db-tests.yml`).

## Business logic (Phase 2, `src/lib`)

| Module | Contents |
|---|---|
| `types/db.ts` | row types and enums matching the schema |
| `dates.ts` | partial dates (exact / month / year / about / before / after): ranges, comparisons, ages, `05.03.1930.` / `око 1930.` formatting |
| `search.ts` | search that matches Cyrillic, Latin and ASCII (`Петровић` = `Petrović` = `petrovic`) |
| `graph/family-graph.ts` | parents, children, partners, siblings (full / half / adoptive / step), ancestors, descendants, branches, generations for the list view, cycle detection |
| `graph/kinship.ts`, `kinship-labels.ts` | "who is B to A": отац, деда, стриц / ујак / тетка, синовац / сестрић, брат од стрица, полубрат, таст / свекар, зет / снаха, девер / заова, шурак / свастика ... (sr, sr-Latn, en) |
| `validation/person.ts` | person form (zod) for Simple / Complex model; Simple never erases Complex fields |
| `validation/relations.ts` | parent/child and partnership checks: errors mirror the DB triggers, warnings for likely mistakes (parent age, posthumous birth, overlapping marriage, cousins) |
| `validation/issues.ts` | issue codes, sr/en messages, mapping of DB trigger errors |
| `media/quota.ts` | photo quota maths, batch split, storage paths |
| `media/compress.ts` | in-browser resize + re-encode (WebP, JPEG fallback), EXIF/GPS stripped, thumbnail |
| `backup/schema.ts` | validation of backup JSON before restore, file names |

```bash
npm ci
npm run typecheck
npm test               # unit tests (vitest)
npm run test:browser   # compression in headless Chromium (needs a local Chromium)
```

## API (Phase 3)

All routes answer JSON errors as `{ "error": "<code>" }`. Auth: Supabase session cookie (web) or
`Authorization: Bearer <access token>` (Capacitor app). Every call runs as the user, so RLS applies;
only the RevenueCat webhook/sync use the service role.

| Method & path | Who | What |
|---|---|---|
| `GET /api/health` | anyone | liveness |
| `GET/POST /api/trees/:treeId/invites` | editor+ | list / create invitation (`{ email?, role, message?, expiresInDays? }`) → `url` to share |
| `DELETE /api/trees/:treeId/invites/:inviteId` | inviter / owner | revoke |
| `GET /api/invites/:token` | anyone | preview (tree, inviter, role, status) |
| `POST /api/invites/:token/accept` | signed in | join the tree |
| `GET /api/trees/:treeId/members` | member | members with names |
| `PATCH/DELETE /api/trees/:treeId/members/:userId` | owner (or self to leave) | change role / remove |
| `POST /api/trees/:treeId/merge` | editor of both | `{ sourceTreeId, personMap }` copies another tree in |
| `GET /api/trees/:treeId/backup?format=json\|zip` | member | download backup (ZIP includes media files) |
| `POST /api/trees/:treeId/restore` | owner | upload JSON or ZIP (raw body or multipart `file`); a `pre_restore` snapshot is kept |
| `POST /api/backups/import?name=` | signed in | JSON/ZIP → new tree with new ids and re-uploaded files |
| `GET/POST /api/trees/:treeId/snapshots` | editor+ | list / create manual snapshot |
| `POST /api/trees/:treeId/snapshots/:id/restore` | owner | restore a snapshot |
| `POST /api/trees/:treeId/auto-backup` | editor+ | daily automatic snapshot (call on app start) |
| `DELETE /api/trees/:treeId/media/:mediaId` | editor+ | delete photo/document row + file |
| `GET /api/billing` | signed in | plan, expiry, photo quota |
| `POST /api/billing/sync` | signed in | refresh plan from RevenueCat after a purchase |
| `POST /api/webhooks/revenuecat` | RevenueCat | subscription events → `profiles.plan` |

RevenueCat setup: use the Supabase user id as RevenueCat `appUserID`; create entitlement
`premium`; add a webhook to `<app>/api/webhooks/revenuecat` with the Authorization header value
from `REVENUECAT_WEBHOOK_AUTH`. Google Play / App Store / Stripe (Web Billing) all arrive through it.

```bash
cp .env.example .env.local   # fill in
npm run dev
# tests against a real database (PostgreSQL + PostgREST, no Supabase needed)
scripts/get-postgrest.sh
PGHOST=localhost PGUSER=postgres npm run test:integration
```

## App (Phases 4–5)

**Try it:** https://kosmet-crypto.github.io/Family-Tree/ (after the `pages` workflow has run on
`main`), or the APK from the latest GitHub Release.

Without Supabase settings the app runs in **local mode**: everything is stored in the browser /
phone (IndexedDB), JSON backups include the photos. With `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` it switches to **cloud mode**: sign-in, sync, Realtime, sharing.

| Screen | What |
|---|---|
| `/` | trees, create, import backup |
| `/tree?id=` | interactive tree (pan / pinch-zoom, search with fly-to), list by generations, person card (relation to "me", relatives, photos), add parent / partner / child / sibling or link an existing person, Simple / Complex entry model, sharing (cloud) |
| `/settings` | entry model, backup (JSON; ZIP with photos in cloud), import, plan, **About** with the developer credit |
| `/login`, `/invite?token=` | cloud mode sign-in and invitations |

Layout: `src/client/layout.ts` (one row per generation, partners side by side, children under
their parents). Data access: `src/client/repo` (`local.ts` IndexedDB, `cloud.ts` Supabase).

### PWA
`app/manifest.ts`, `public/sw.js` (offline app shell, new version on every deploy), iOS meta
tags: in Safari use Share → "Add to Home Screen".

### Android (Capacitor)
- `npm run build:static` builds the UI into `out/` (API routes are left out; in cloud mode the
  app calls them at `NEXT_PUBLIC_API_BASE`).
- `.github/workflows/android.yml` builds a signed APK and publishes a Release `v1.0.<run>` on
  every push to `main`.
- **OTA / rich updates (test phase):** the APK is built with `CAP_LIVE_URL` = the GitHub Pages
  URL, so it always loads the latest web version; a new APK is only needed for native changes.
  **For Google Play** set the repository variable `OTA=false`: the web app is bundled and
  updates go through the store. The committed test key `android/app/roots-branches.keystore`
  keeps updates installable; for Play use Play App Signing with your own upload key
  (`ANDROID_KEYSTORE_*` env variables).
- In-app purchases: RevenueCat (`@revenuecat/purchases-capacitor`), enabled when
  `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` is set.

Full web + API hosting (for cloud mode) needs a Next.js host, e.g. Vercel: import the repo and set
the variables from `.env.example`.

```bash
npm run dev                  # http://localhost:3000 (local mode without .env.local)
npm run build:static         # static UI in out/
node scripts/serve-static.mjs 3200 && BASE_URL=http://localhost:3200 npm run test:e2e
npx cap sync android         # after build:static; open android/ in Android Studio
```

## About

Developed by: Ivan S. - Epicurus001, Oslo
