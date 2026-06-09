# MedConnect Postman — Task 2

## Import

1. Open Postman → **Import**
2. Select both files in this folder:
   - `MedConnect-Task2.postman_collection.json`
   - `MedConnect.local.postman_environment.json`
3. Select the **MedConnect Local** environment in the top-right dropdown

## Configure environment

Update these variables in the environment:

| Variable | Description |
|----------|-------------|
| `base_url` | API base URL (default: `http://localhost:3000/api/v1`) |
| `supabase_url` | Your Supabase project URL |
| `supabase_anon_key` | Supabase anon/public key |
| `pharmacy_token` | Auto-set by login request |
| `admin_token` | Auto-set by login request |
| `pharmacy_id` | Auto-set by register request |

## Recommended test order

1. **Register Pharmacy** — `POST /pharmacy/register` (no auth required)
2. **Login Pharmacy** — Auth Helpers → sets `pharmacy_token`
3. **Get My Pharmacy Profile** — verify `status: pending`
4. **Login Admin** — Auth Helpers → sets `admin_token`
5. **List Pharmacies** — filter `?status=pending`
6. **Approve Pharmacy** — uses `{{pharmacy_id}}` from step 1
7. **Get My Pharmacy Profile** — verify `status: approved`
8. **Update My Pharmacy Profile** — PATCH allowed fields
9. **Analytics Overview** / **Top Searched Drugs** / **Top Purchased Drugs**
10. **List Users** / **List All Reservations**

## Auth notes

- Pharmacy and Admin login requests call **Supabase Auth directly** (`/auth/v1/token?grant_type=password`), not the NestJS API.
- All protected API requests use `Authorization: Bearer {{token}}`.
- Admin endpoints require a user whose `get_my_role()` RPC returns `'admin'`.

## Response format

Successful responses are wrapped:

```json
{
  "data": { ... },
  "meta": { "timestamp": "..." }
}
```

Errors:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "...",
    "timestamp": "...",
    "path": "..."
  }
}
```
