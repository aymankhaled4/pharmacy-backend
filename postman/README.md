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
| `user_email` / `user_password` | Test user credentials |
| `pharmacy_email` / `pharmacy_password` | Test pharmacy credentials |
| `admin_email` / `admin_password` | Admin credentials (create in Supabase Dashboard) |
| `user_token` | Auto-set by Register/Login User |
| `pharmacy_token` | Auto-set by Register/Login Pharmacy |
| `admin_token` | Auto-set by Login Admin |
| `access_token` | Last login token (any role) |
| `user_id` | Auto-set on user register/login |
| `pharmacy_id` | Auto-set on pharmacy register/login |

## Recommended test order

### User flow
1. **Auth → Registration → Register User** — Supabase signup; auto-logs in and sets `user_token`
2. **Auth → Verify Role → Get Role (User)** — expect `{ role: "user" }`
3. **Users → Get My Profile** — verify profile exists

### Pharmacy + Admin flow
1. **Auth → Registration → Register Pharmacy** — creates account + auto-logs in → sets `pharmacy_token` and `pharmacy_id`
2. **Pharmacy → Get My Pharmacy Profile** — verify `status: pending`
3. **Auth → Login → Login Admin** — sets `admin_token` (admin must exist in Supabase)
4. **Admin → List Pharmacies** — filter `?status=pending`
5. **Admin → Approve Pharmacy** — uses `{{pharmacy_id}}`
6. **Pharmacy → Get My Pharmacy Profile** — verify `status: approved`
7. **Pharmacy → Update My Pharmacy Profile**
8. **Admin → Analytics Overview** / **Top Searched Drugs** / **Top Purchased Drugs**

## Auth notes

- **User registration** uses Supabase Auth (`/auth/v1/signup`) with `user_metadata.role = "user"`.
- **Pharmacy registration** uses the NestJS API (`POST /pharmacy/register`), which creates the Supabase user and profile.
- **Login** requests call Supabase Auth (`/auth/v1/token?grant_type=password`) and save tokens automatically.
- Register requests also attempt auto-login so you can test protected endpoints immediately.
- All protected API requests use `Authorization: Bearer {{role_token}}`.
- Admin users must be created manually in Supabase Dashboard with role `'admin'`.

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
