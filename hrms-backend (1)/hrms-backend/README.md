# HRMS Backend (FastAPI + Motor)

Production-ready authentication foundation for a Human Resource Management
System, built with FastAPI and Motor (async MongoDB driver).

## Stack

- **FastAPI** — async web framework
- **Motor** — async MongoDB driver
- **Pydantic v2** — schema validation
- **python-jose** — JWT signing/verification
- **passlib + bcrypt** — password hashing

## Project layout

```
app/
├── main.py                # App factory, CORS, lifespan (DB connect/disconnect)
├── config.py               # Environment-driven settings
├── database.py              # Motor client, indexes, get_database dependency
├── models/
│   └── schemas.py            # User, Attendance, LeaveRequest, Payroll schemas
├── core/
│   ├── security.py           # Password hashing + JWT create/decode
│   └── deps.py                # get_current_user, require_admin
└── routers/
    └── auth.py                # /api/auth/register, /login, /logout, /me
```

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit JWT_SECRET_KEY and MONGO_URI
uvicorn app.main:app --reload
```

API docs available at `http://localhost:8000/docs`.

## Authentication model

- JWTs are issued on register/login and stored in an **httpOnly, samesite
  cookie** (`hrms_access_token`) — never exposed in the response body or to
  client-side JS.
- `get_current_user` reads the cookie, decodes the JWT, and loads the user
  from MongoDB on every protected request.
- `require_admin` builds on `get_current_user` and restricts access to
  `admin` / `hr` roles — attach it to any router that manages other
  employees' data (payroll processing, leave approval, etc).
- Because the frontend and backend must share cookies, CORS is configured
  with `allow_credentials=True` and a specific `FRONTEND_ORIGIN` (wildcard
  `*` origins are not permitted alongside credentials).

## Endpoints

### Auth (`app/routers/auth.py`)

| Method | Path                | Auth required | Description                          |
|--------|---------------------|---------------|---------------------------------------|
| POST   | /api/auth/register  | No            | Create a user, auto-login on success  |
| POST   | /api/auth/login     | No            | Verify credentials, issue cookie      |
| POST   | /api/auth/logout    | No            | Clear the auth cookie                 |
| GET    | /api/auth/me        | Yes           | Return the current user's profile     |

### Users (`app/routers/users.py`)

| Method | Path                  | Auth required   | Description                                                        |
|--------|-----------------------|-----------------|----------------------------------------------------------------------|
| GET    | /api/users/me         | Any user        | Own profile                                                          |
| PATCH  | /api/users/me         | Any user        | Self-update — **only** `phone`, `address`, `profile_picture`         |
| GET    | /api/users            | Admin/HR        | List/search all users (filters: role, department, is_active, search) |
| POST   | /api/users            | Admin/HR        | Directly provision a new account (any role, pre-verified)            |
| GET    | /api/users/{id}       | Admin/HR        | Fetch one user                                                       |
| PATCH  | /api/users/{id}       | Admin/HR        | Full override (role, email, employee_id, status, etc.)               |
| DELETE | /api/users/{id}       | Admin/HR        | Soft-delete (deactivate) a user                                      |

Guard rails: an admin can't deactivate or demote their own account. Email/employee_id
uniqueness is re-checked on every override.

### Attendance (`app/routers/attendance.py`)

| Method | Path                          | Auth required | Description                                                |
|--------|-------------------------------|---------------|--------------------------------------------------------------|
| POST   | /api/attendance/check-in      | Any user      | Clock in; status derived server-side from time of day        |
| POST   | /api/attendance/check-out     | Any user      | Clock out; status re-evaluated against hours worked          |
| GET    | /api/attendance/me            | Any user      | Own attendance history (date-range filterable)                |
| GET    | /api/attendance/today         | Admin/HR      | Live tracker: every active employee's status today            |
| PATCH  | /api/attendance/{id}          | Admin/HR      | Manually correct a record                                     |

**Status logic:**
- Check-in ≤ `WORKDAY_START` + `LATE_GRACE_MINUTES` → `present` (or `work_from_home` if flagged); later → `half_day`.
- Check-out with fewer than `MIN_FULL_DAY_HOURS` worked → downgrades to `half_day`.
- An approved leave for today blocks check-in with a 400.
- `/today` shows employees who never checked in as `on_leave` (if approved leave covers today) or `absent`.
- All three thresholds are configurable via `.env` (see `app/config.py`).

### Leave Requests (`app/routers/leaves.py`)

| Method | Path                        | Auth required | Description                                        |
|--------|-----------------------------|---------------|------------------------------------------------------|
| POST   | /api/leaves                 | Any user      | Submit a new request                                  |
| GET    | /api/leaves                 | Any user      | Own requests (employee) / all requests (admin/HR)     |
| GET    | /api/leaves/{id}            | Owner/Admin   | Fetch a single request                                |
| PATCH  | /api/leaves/{id}            | Admin/HR      | Approve or reject a pending request                    |
| PATCH  | /api/leaves/{id}/cancel     | Owner         | Withdraw your own still-pending request                |

Overlap checks prevent double-booking against pending/approved requests, and
against other approved leaves at approval time.

### Payroll (`app/routers/payroll.py`)

| Method | Path                     | Auth required | Description                                             |
|--------|--------------------------|---------------|------------------------------------------------------------|
| GET    | /api/payroll             | Any user      | Employees: own records only (read-only). Admin/HR: everyone's, filterable. |
| GET    | /api/payroll/{id}        | Owner/Admin   | Fetch a single record                                       |
| POST   | /api/payroll             | Admin/HR      | Generate a new record (net salary computed server-side)     |
| PATCH  | /api/payroll/{id}        | Admin/HR      | Adjust amounts and/or status (marking `paid` stamps `paid_on`) |
| DELETE | /api/payroll/{id}        | Admin/HR      | Remove an erroneous record                                   |

Employees have no write access to payroll under any circumstance — every
mutating verb on this router is gated by `require_admin`.

## Testing note

All endpoints above were exercised end-to-end (register → create → update →
approve/reject → status transitions → permission boundaries) using an
in-memory Mongo-compatible client before delivery; see the assistant's test
run for the exact scenarios covered.
