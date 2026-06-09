# Task 2 Setup Guide — Pharmacy + Admin

Follow these steps to run Task 2 locally against Supabase.

## Prerequisites

- Node.js 18+
- Supabase project with PostgreSQL 15
- Task 1 foundation deployed (Auth, Users, Guards, Config)

## Step 1 — Apply Task 1 DB changes (if not done)

Ensure these exist before Task 2:

- `user_profiles.deleted_at` column
- `get_my_role()` RPC updated for soft-deleted users
- RLS policies on `user_profiles` with `deleted_at IS NULL`
- `on_user_soft_deleted` trigger

## Step 2 — Verify `pharmacy_profiles` table

The table should have at least:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Matches `auth.users.id` |
| `pharmacy_name` | TEXT | |
| `phone` | TEXT | |
| `address` | TEXT | |
| `license_number` | TEXT UNIQUE | |
| `location` | GEOGRAPHY(POINT) | PostGIS |
| `status` | TEXT | `pending`, `approved`, `rejected` |
| `rejection_reason` | TEXT NULL | |
| `verified_by` | UUID NULL | Admin who reviewed |
| `verified_at` | TIMESTAMPTZ NULL | |
| `created_at` | TIMESTAMPTZ | Default `now()` |

## Step 3 — Run Task 2 migration

1. Open **Supabase Dashboard → SQL Editor**
2. Paste and run [`supabase/migrations/002_task2_analytics_views.sql`](../supabase/migrations/002_task2_analytics_views.sql)
3. Enable **pg_cron** extension if prompted (Database → Extensions)
4. Run initial refresh manually:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_search_analytics;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_purchase_analytics;
```

## Step 4 — Create an admin test user

1. Create a user in Supabase Auth (Dashboard → Authentication → Users)
2. Assign admin role so `get_my_role()` returns `'admin'` (via your role assignment table or `app_metadata`, depending on your Task 1 RPC implementation)
3. Note the admin email/password for Postman login

## Step 5 — Configure environment

```bash
cp .env.example .env
# Fill in all values — see comments in .env.example
npm install
npm run start:dev
```

API base URL: `http://localhost:3000/api/v1`  
Swagger docs: `http://localhost:3000/docs`

## Step 6 — Import Postman collection

1. Open Postman → **Import**
2. Import `postman/MedConnect-Task2.postman_collection.json`
3. Import `postman/MedConnect.local.postman_environment.json`
4. Select the **MedConnect Local** environment

## Step 7 — Recommended test flow

1. **Register pharmacy** — `POST /pharmacy/register` (no auth)
2. **Login as pharmacy** — Supabase Auth REST API (see Postman README) → set `pharmacy_token`
3. **Get pharmacy profile** — `GET /pharmacy/me` → expect `status: pending`
4. **Login as admin** → set `admin_token`
5. **List pending pharmacies** — `GET /admin/pharmacies?status=pending`
6. **Approve pharmacy** — `POST /admin/pharmacies/:id/approve`
7. **Verify approval** — `GET /pharmacy/me` → expect `status: approved`
8. **Update profile** — `PATCH /pharmacy/me`
9. **Admin analytics** — `GET /admin/analytics/overview`, searched/purchased drugs
10. **Admin users/reservations** — list endpoints with pagination

## Notes

- `POST /pharmacy/register` creates both a Supabase Auth user and a `pharmacy_profiles` row with `status = pending`.
- `GET /pharmacy/me` uses auth only (no `@Roles('pharmacy')`) so pending pharmacies can view their status.
- Redis role-cache invalidation on soft-delete is deferred until Task 1 `CacheService` is available.
- Analytics views depend on `search_logs`, `reservations`, `inventory`, and `drugs` tables from other tasks.
