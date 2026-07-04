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

## Endpoints implemented in this pass

| Method | Path                | Auth required | Description                          |
|--------|---------------------|---------------|---------------------------------------|
| POST   | /api/auth/register  | No            | Create a user, auto-login on success  |
| POST   | /api/auth/login     | No            | Verify credentials, issue cookie      |
| POST   | /api/auth/logout    | No            | Clear the auth cookie                 |
| GET    | /api/auth/me        | Yes           | Return the current user's profile     |
| GET    | /api/health         | No            | Liveness probe                        |

## Notes for the next milestone

The `Attendance`, `LeaveRequest`, and `Payroll` Pydantic schemas are already
defined in `app/models/schemas.py` so the next set of routers (attendance
check-in/out, leave application + approval, payroll generation) can be
built directly on top of them using the same `get_current_user` /
`require_admin` dependencies.
