# Northgate HRMS — Frontend

A single-file React (Vite + Tailwind + lucide-react) client for the FastAPI HRMS backend. All app logic lives in `src/App.jsx`.

## Setup

```bash
npm install
```

Create `.env` in this folder pointing at your running backend:

```
VITE_API_URL=http://localhost:8000
```

Then:

```bash
npm run dev
```

## Backend requirements

- The backend's `FRONTEND_ORIGIN` setting must exactly match this app's origin (e.g. `http://localhost:5173`) — auth uses an httpOnly cookie, which requires CORS `allow_credentials` and a matching origin.
- Run the FastAPI app per its own README (`uvicorn app.main:app --reload`) with MongoDB reachable.

## What's inside `App.jsx`

- **API client** — thin `fetch` wrapper (`credentials: "include"`) covering every route in `auth`, `users`, `attendance`, `leaves`, and `payroll`.
- **`AuthProvider`** — bootstraps the session via `GET /api/auth/me`, exposes `login`, `register`, `logout`, `refreshUser`, and `isPrivileged` (true for `admin`/`hr`).
- **Role-based router** — `admin`/`hr` land in the **Admin console**; everyone else lands in the **Employee workspace**. The two view trees are fully separate components (`AdminApp` / `EmployeeApp`).
- **Employee workspace** — Time clock (check-in/out with live elapsed timer), editable profile, leave requests with a visual calendar, read-only payroll history with a payslip viewer.
- **Admin console** — Master employee directory (search/filter + picker + detail editor + provisioning), live attendance tracker (auto-refreshing), leave approval queue + full history, and a payroll ledger (generate/adjust/settle/delete).

No placeholder empty states — every list/table has a designed empty state, and every async action has loading and error handling wired to inline alerts or toasts.
