# Roots & Branches (Породично стабло)

Family tree app: interactive pan/zoom tree, sharing via invitations, cloud sync (Supabase),
backups, PWA + Capacitor Android build.

Stack: Next.js (App Router, TypeScript), Tailwind + shadcn/ui, React Flow, Supabase
(PostgreSQL + RLS + Storage + Realtime), RevenueCat, Capacitor.

## Status

- [x] Phase 1: database schema, RLS, triggers (`supabase/migrations`)
- [ ] Phase 2: TypeScript business logic and validation
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

Rules enforced in the database:
- No cycles (nobody is their own ancestor), at most 2 biological parents, a biological parent is
  born before the child (exact dates), a living person has no death date, one active marriage per pair.
- Edges and media can never point across trees (composite foreign keys).
- Free plan: 30 photos per user (Storage upload policy + trigger); premium (`profiles.plan`,
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

## About

Developed by: Ivan S. - Epicurus001, Oslo
