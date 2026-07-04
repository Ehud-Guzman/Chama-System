# Contribution Manager

Digital record-keeping for a chama / contribution group — replaces the manual book. Admins log
contributions; members check their own history by phone number (no login, rate-limited, exact
match only). Built mobile-first: 98% of usage is on phones.

## Stack

- **Frontend:** React + Vite + Tailwind CSS (v4) — `frontend/`
- **Backend:** Node.js + Express + Mongoose — `backend/`
- **Database:** MongoDB (Atlas free tier works)
- **Auth:** JWT, admins only. Members are never authenticated.

## Local setup

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in MONGO_URI and a JWT_SECRET of 32+ random chars
npm run dev            # starts on http://localhost:5000
```

Create the first super admin (one-time, run manually — this is deliberately not an API endpoint):

```bash
node src/scripts/seedSuperAdmin.js "Your Name" you@example.com "a-strong-password"
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The frontend reads `VITE_API_URL` (defaults to `http://localhost:5000`). For production builds,
set it to the deployed API URL.

## Routes

- `/` — public lookup + group overview + member directory (standalone, loads no admin code)
- `/member/:id` — public passbook view for one member, reached by browsing the directory
- `/admin/login` — admin sign in
- `/admin/dashboard` · `/admin/members` · `/admin/log` · `/admin/reports` — protected

Admin accounts are managed from the Dashboard (visible to the super admin only).

## Key behaviors

- **Phone normalization:** `+2547…`, `2547…`, `07…` all resolve to one stored format
  (`07XXXXXXXX`) — enforced on member create/edit, CSV import, and public lookup.
- **Public lookup:** exact phone match only, 5 requests/minute/IP (configurable via env),
  returns name, reg number, ledger with running balance, and total. Never returns internal
  ids or admin metadata.
- **Soft delete only:** members and contributions are never hard-deleted. Every
  create/edit/delete writes an audit log entry with full before/after snapshots
  (Reports → Audit trail).
- **CSV import:** columns `name, phone, regNumber (optional), notes (optional)`. Duplicate
  phones are skipped and reported, never overwritten.
- **CSV export:** members and full contribution register, UTF-8 with BOM so Excel opens them
  correctly.

## Deploying

This is a monorepo (`frontend/` + `backend/` at the root) — both hosts need to be told which
subfolder to build.

- **Frontend → Netlify:** `netlify.toml` at the repo root already sets base directory
  `frontend`, build command `npm run build`, and publish directory `dist`. It also configures
  the SPA fallback (`/* → /index.html`, 200) so client-side routes like `/admin/dashboard` or
  `/member/:id` don't 404 on refresh or direct link — `frontend/public/_redirects` carries the
  same rule as a backup, since Vite copies anything in `public/` straight into `dist/`. Set
  `VITE_API_URL` (Site settings → Environment variables) to the deployed backend URL.
- **Frontend → Vercel (alternative):** project root `frontend/`, build `npm run build`, output
  `dist/`. Set `VITE_API_URL` the same way. Add a SPA rewrite (all routes → `/index.html`) —
  Vercel doesn't read `netlify.toml`, so this needs its own `vercel.json` if you go this route.
- **Backend → Render/Railway:** root `backend/`, start `npm start`. Set all vars from
  `.env.example`; `FRONTEND_URL` must be the exact deployed frontend origin (CORS is locked to
  it). `trust proxy` is already enabled so per-IP rate limiting works behind their proxies.

## Environment variables (backend)

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | 32+ random characters — the server refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime, default `8h` |
| `FRONTEND_URL` | Allowed CORS origin |
| `LOOKUP_RATE_LIMIT_WINDOW_MS` | Lookup rate-limit window (default 60000) |
| `LOOKUP_RATE_LIMIT_MAX` | Max lookups per window per IP (default 5) |
