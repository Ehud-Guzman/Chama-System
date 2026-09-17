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

- `/` — public lookup + group overview + member directory + chama document vault (standalone,
  loads no admin code)
- `/member/:id` — public passbook view for one member, reached by browsing the directory
- `/admin/login` — admin sign in
- `/admin/dashboard` · `/admin/members` · `/admin/reports` · `/admin/minutes` ·
  `/admin/reminders` · `/admin/documents` · `/admin/disciplinary` — protected
- `/admin/finance` · `/admin/finance/setup` · `/admin/finance/:id` — the ledger: the member list,
  one member's page, and the go-live figures. This is the only place money is logged — the admin
  dashboard shows the same list, `/admin/log` redirects here, and the old weekly grid and
  per-type/expense panels are gone.

Admin accounts are managed from the Dashboard (visible to the super admin only).

## Key behaviors

- **The week cycle (the treasurer's maths).** `weekAnchorDate` + `cycleStartWeek` in Settings
  pin the group to one shared week number — week 92 when this went live, closing on its
  Thursday — and it advances by itself every Friday, so nobody ever has to "start" a week. The
  anchor is checked against the group's own ledger, which labelled its weeks by the Thursday they
  closed on (week 86 = Thu 6 Aug 2026, week 87 = 13 Aug, …), and it reproduces that to the day.
  Week boundaries are pinned to East African time (a fixed +3) rather than the server's clock,
  because the API runs on hosts that default to UTC while the treasurer's phone is on EAT. Per
  member:
  `required so far = weeklyAmount × weeks elapsed since the opening week` (1,400 in week 92,
  2,800 in 93, …), and
  `his money = openingBalance + what he has paid since week 92 − required − tea`. Paying above
  the 1,400 pushes his money up instead of being swallowed; a week with nothing paid takes 1,400
  back off it — the "expected total deducted from his money" the members already work to, which
  is the accumulated credit/arrears of constitution §7.5. **Tea is automatic**: `chaiAmount` is
  deducted from every member for every week of the cycle whether or not anybody logged anything,
  it needs no entry, it can never be in arrears, and it is shown per member so each can see the
  total he has put into the Group's Tea Fund. That mirrors the paper ledger's
  "Previous + Weekly + Extra − Chai = Member Total". A closed NILL week is flagged for the §7.5
  KES 50 fine but never charged automatically — a fine has to be issued with its week and reason.
- **Speed, and how it is kept:** the cost of a page here is *round trips to the database*, so the
  app counts them. Settings is held in-process for 30 seconds rather than re-read by nearly every
  request; one member's ledger is three round trips; the member list and each member's ledger are
  cached in the browser for 30 seconds and prefetched on touch-down, so tapping a name opens a
  panel *over* the list — no page change, no lazily-loaded chunk, and closing it leaves the scroll
  exactly where it was; logging money inside the panel refreshes the list underneath in place.
  Navigation is warmed on intent (`frontend/src/services/prefetch.js`): hovering or pressing a nav
  link, a workflow tile or a member card starts the destination's chunk loading and, on the screens
  that show one, fetches the ledger or the member list into the cache — so the click swaps a page
  that is already there rather than waiting on the press. The sidebar and bottom bar also stay
  painted while a page's chunk arrives (`Suspense` sits *inside* the admin shell, not above it), and
  a list painted from cache quietly revalidates in the background instead of showing stale figures
  until its 30-second TTL runs out. If the hosted app still feels slow, the first thing to check is
  that the API and the Atlas cluster are in the same region: a cross-region round trip measures
  around half a second, and no handler tuning beats that. The free tier of some hosts also spins the
  service down after idling, which makes the first load of the day slow for a reason nothing in this
  repo can fix.
- **Every list counts the same money as the ledger:** the cards at `/admin/members`, the public
  directory at `/` and a member's own passbook all show his balance from the cycle engine
  (opening balance + what he has paid − required − tea), not a sum of contribution rows. After
  go-live those two are different figures — the money that carried across from the paper ledger
  lives in `openingBalance`, so a row sum reads 0 for everybody — and a card reading "no
  contributions yet" next to a ledger that says he holds money is exactly the confusion this
  avoids. The passbook's own row column is labelled "Paid to date" for the same reason: it is cash
  logged against him, while the stamped total underneath ("Held by member") is what he actually
  holds. The PDF and Excel statements lead with that same figure and print the four numbers it is
  made of.
- **One-time opening balances:** `/admin/finance/setup` (also linked from the dashboard as
  "Opening balances (one-time)") is where each member's current total is keyed in at go-live.
  Every member is listed with his ledger figure already filled in as a suggestion, any of them
  can be typed over, and one save applies the lot. That is the only manual figure entry the
  system needs.
- **`openingBalance`** on each member carries his verified paper-ledger balance into the cycle,
  so his money starts where the old sheet left him. `/admin/finance/setup` suggests each figure
  from what the ledger already says he holds (`GET /api/ledger/setup`), so the 32 balances never
  have to be retyped by hand.
- **One write for the treasurer:** `POST /api/ledger/members/:id/log` with
  `kind: weekly | expense` decides which collection the entry lands in, so the UI keeps a single
  "Add a log" panel. There is no tea entry and no "extra contribution" — tea is deducted
  automatically, and anything above the 1,400 is simply a bigger weekly payment, which the
  cumulative credit carries forward on its own. Every entry — contributions *and* expenses —
  carries a free text `note`, which is where the M-Pesa or bank message gets pasted, so the
  evidence sits on the entry it explains. `clientRequestId` makes a retried submit resolve to
  the entry already written instead of charging the member twice.
- **Logging an earlier week:** the member's page has a week strip (every cycle week with its
  `now` / `settled` / `owing` state). Picking one moves the date into that Friday→Thursday week
  and prefills what that week still needs, so a late payment is recorded against the week it
  belongs to instead of landing on today's date as anonymous credit. Where a member is behind,
  one button fills in the whole arrears total against the earliest week he owes — the cumulative
  credit of §7.5 then settles the weeks after it on its own, so there is no need to enter a line
  per week. Below that, the week table and the passbook's schedule both list **every week back to
  week 1** (from 13 Dec 2024), each one running Friday to Thursday exactly as the paper ledger
  numbered them; the weeks before the cycle opened are marked "carried forward" and never scored,
  because their money is already inside the member's `openingBalance`.
- **The Week-92 reset** (`npm run reset:week92 --prefix backend`, dry run by default;
  `--confirm-reset` applies it) rolls every member's ledger balance into `openingBalance`, clears
  contributions, expenses, fines, fine types, contribution types and pledges, and reseeds the
  three ledger types. It writes a full backup to `backend/data/reset-backup-*.json` first (that
  file is gitignored — same reason the old import scripts are: it carries real names, phones and
  balances), leaves an audit entry behind, and keeps members, accounts, minutes, documents and
  Settings untouched. `--remove-artifacts` also deletes the pseudo-members an old import created
  ("Opening Balances …", group totals stored as if they were people); `--clear-audit` empties the
  audit trail as well.
- **Phone normalization:** `+2547…`, `2547…`, `07…` all resolve to one stored format
  (`07XXXXXXXX`) — enforced on member create/edit, CSV import, and public lookup.
- **Public lookup:** exact phone match only, 5 requests/minute/IP (configurable via env),
  returns the member's masked phone, member-since date, what he holds today with the four figures
  it is made of, the rows he has logged since the cycle opened, pledges by type, fines (pending +
  settled) and the weekly schedule. The open directory (`GET /api/public/directory`) lists every
  active member with the same cycle-engine balance, so the public page and the treasurer's ledger
  can never disagree about the same person. Never returns internal ids or admin metadata.
- **Chama documents and minutes (phone-gated):** title deeds, certificates and other group
  records are uploaded from `/admin/documents` (PDF, Word/Excel, or a photo, up to 8 MB) and
  minutes are written at `/admin/minutes`. Both are stored in MongoDB itself — Render/Railway
  disks are ephemeral, so a file written to disk would not survive a deploy or a backup.
  Members open them on the public page only after entering a phone number registered with the
  chama (`GET /api/public/documents?phone=…`, `…/documents/:id/file?phone=…`,
  `GET /api/public/minutes?phone=…`, `…/minutes/:id?phone=…`, 30 requests/minute/IP). An upload
  or a minute can be marked hidden from members to keep it admin-only; removals are soft
  deletes, like every other record. The phone number is the only credential — anyone who knows
  a member's number can open the members' area, so treat it as group-visible material, not
  private documents.
- **Member profile photos:** uploaded from the member form (`POST /api/uploads/member-photo`,
  image-only, 5 MB) and stored on Cloudinary, cropped square around the face at 512px. The
  publicId is saved with the member so a replaced photo's old asset is deleted rather than
  orphaned. Without `CLOUDINARY_*` configured, the picker reports that uploads aren't set up and
  everything else keeps working.
- **Email reminders:** `/admin/reminders` lists every member who is behind on the weekly
  contribution or has unpaid fines, computed from the same cycle engine the member's own page
  shows (`computeMemberLedger`), so a reminder can never quote a week number or an amount the
  member isn't seeing himself (`POST /api/notifications/reminders` sends). A week still in
  progress is never counted as late, and the cycle only reaches back as far as week 92, so
  nobody is emailed about unreconcilable history. Sending needs `SMTP_*` + `MAIL_FROM`; without
  them the page says so and the API returns a 503 with the same explanation. Every send is
  audit-logged, members can be opted out individually (`emailNotifications`), and a member with
  no address is listed as un-emailable rather than silently skipped.
- **Member records:** each member carries an email address, a profile photo, a next of kin
  (name, relationship, phone, email) and an email-reminders switch. Next of kin and notes stay
  on the admin side; only the photo and public passbook fields are exposed publicly.
- **Backups** include document files, base64-encoded (`{$binary: "…"}`) rather than as raw
  byte arrays, so a backup of a 5 MB scan stays a sane size. Member photos are *not* in the
  backup (they live on Cloudinary) — the photo URL is, so a restore re-links them.
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
| `CLOUDINARY_URL` *or* `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | Member profile photo storage |
| `CLOUDINARY_FOLDER` | Where photos are stored in the Cloudinary account (default `chama-system/members`) |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASS` · `SMTP_SECURE` | Outgoing mail for reminders |
| `MAIL_FROM` | Address reminders are sent as — required for sending to work at all |
| `MAIL_REPLY_TO` | Optional reply-to (e.g. the treasurer's own inbox) |
