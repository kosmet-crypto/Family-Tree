# Roots & Branches (Породично стабло)

Family tree app: interactive pan/zoom tree, sharing via invitations, cloud sync (Supabase),
backups, PWA + Capacitor Android build.

Stack: Next.js (App Router, TypeScript), Tailwind + shadcn/ui, React Flow, Supabase
(PostgreSQL + RLS + Storage + Realtime), RevenueCat, Capacitor.

## Status

- [x] Phase 1: database schema, RLS, triggers (`supabase/migrations`)
- [x] Phase 2: TypeScript business logic and validation (`src/lib`)
- [ ] Phase 3: API routes (invites, backup/restore, RevenueCat)
- [ ] Phase 4: mobile UI
- [ ] Phase 5: PWA, Capacitor, OTA updates

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

## About

Developed by: Ivan S. - Epicurus001, Oslo
