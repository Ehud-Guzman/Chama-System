# Wazo Moja Self-Help Group — contribution system

Digital record-keeping for the group (a chama) — replaces the manual book. Admins log
contributions; members check their own history by phone number (no login, rate-limited, exact
match only). Built mobile-first: 98% of usage is on phones. Live at https://wazomojashg.co.ke

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

- `/` — public lookup: group totals, your own record by phone number, and the members' area
  (documents, minutes, constitution). Standalone — loads no admin code.
- `/constitution` — the constitution, members only: the page fetches the text for a registered
  phone number and there is no public link to it.
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
  because the API runs on hosts that default to UTC while the treasurer's phone is on EAT. The
  opening week (**week 92**) is the **baseline** and is never scored: every member's money for it
  is already on the books as the opening balance the treasurer verified against the paper ledger,
  so requiring the week's 1,400 would report the whole group as being behind on the day the cycle
  started and take a week's tea off a balance that was checked without one. Week 92 therefore
  expects nothing and costs nothing — the totals keyed in for it are the members' money for that
  week, its chai already deducted — and a week after it is scored the day *after* its Thursday, not
  while it is still running: the group collects a week's money on that Thursday, so counting it
  earlier would charge the open book for money nobody has been asked for yet. A sheet keyed in on a
  Friday therefore reads exactly as keyed, and from the Friday after the first collection that week
  counts. Per member:
  `required so far = weeklyAmount × the weeks that have closed` (0 while week 93 is running, 1,400
  from the day after it closes, 2,800 the week after, …), and
  `his money = openingBalance + what he has paid since the cycle opened − required − tea`.
  Paying above the 1,400 pushes his money up instead of being swallowed; a closed week with nothing
  paid takes 1,400 back off it — the "expected total deducted from his money" the members already
  work to, which is the accumulated credit/arrears of constitution §7.5. **Tea is automatic**:
  `chaiAmount` is deducted from every member for every closed scored week of the cycle whether or
  not anybody logged anything, it needs no entry, it can never be in arrears, and it is shown per
  member so each can see the total he has put into the Group's Tea Fund. That mirrors the paper
  ledger's "Previous + Weekly + Extra − Chai = Member Total". A closed NILL week is flagged for the
  §7.5 KES 50 fine but never charged automatically — a fine has to be issued with its week and
  reason. The baseline week is labelled as the opening week everywhere it appears — the week strip,
  the week table, the passbook's schedule and the weekly reconciliation — and it is excluded from
  the "weeks expected" figure on the performance report, along with the week still running, so
  neither can ever be counted against anybody. The rule lives in one place, `scoredWeeks()` in
  `weekCycle.js`, so the ledger, the funds, the public page and the performance report cannot drift
  apart on it.
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
- **Every list counts the same money as the ledger:** the cards at `/admin/members` and a
  member's own passbook both show his balance from the cycle engine (opening balance + what he
  has paid − required − tea), not a sum of contribution rows. After go-live those two are
  different figures — the money that carried across from the paper ledger lives in
  `openingBalance`, so a row sum reads 0 for everybody — and a card reading "no contributions
  yet" next to a ledger that says he holds money is exactly the confusion this avoids. The
  passbook's own row column is labelled "Paid to date" for the same reason: it is cash logged
  against him, while the stamped total underneath ("Held by member") is what he actually holds.
  The PDF and Excel statements lead with that same figure and print the four numbers it is made
  of.
- **One-time opening balances:** `/admin/finance/setup` is where each member's current total is
  keyed in at go-live. Every member is listed with his ledger figure already filled in as a
  suggestion, any of them can be typed over, and one save applies the lot. That is the only manual
  figure entry the system needs. The entry point sits at the **top** of both the finance page and
  the dashboard (next to the week they are working in) rather than below the member list, and the
  resulting **brought-forward total is one of the headline tiles** on that same header, so the
  figure the books opened with is always visible without scrolling.
  A save that would **cut** the members' total by a quarter or more is held back once: the API answers
  `409` with both totals and the number of members it would move (`summary`), the screen puts them in a
  confirm dialog, and only a deliberate second click (`confirm: true`) writes it. Nothing is written on
  the refused path, so the mistyped box is still there to fix. The footer under the table also prints the
  entered total beside the total already saved — the one comparison that makes a wrong sheet obvious
  *before* it is stored rather than after.
- **A wrong sheet can be put back:** every save writes a before/after snapshot of each member to the
  audit trail, so the figures it replaced are never actually lost.
  `npm run balances:restore --prefix backend` reads them back and prints, member by member, what each
  balance is now and what it would become — a dry run by default, `--confirm-write` applies it (after
  copying the members to `backend/data/`). It also takes `--as-of=<time>` for the figures as they stood
  at that moment, `--from-backup=data/reset-backup-….json` for the roll-forward recomputed from the
  imported ledger, and `--member=<name>` to do one person.
- **"All time" carries the opening balances.** The reports headline, the per-member performance column
  and the public group page all count what the members and the funds already held when the books opened
  — read from the same `openingBalance` figures the ledger header shows — plus everything logged since
  (`GET /api/reports/summary`, `…/performance`, `GET /api/public/overview`). A total built from
  contribution rows alone reads Ksh 44,800 against the Ksh 3.4M actually on the books, which tells every
  member that the years they paid into the paper ledger never happened. The breakdowns underneath
  (by method, by type, by fund) stay rows-only and are labelled **since the books opened**, so the parts
  are never mistaken for the whole; the headline names its own parts in the same breath.
- **The funds get the same one-time carry-in:** the same screen lists every fund the group collects
  — the Tea Fund, plus registration, resignation, welfare or anything else — each with a
  **Carried in** figure: what that fund already held before this ledger started counting
  (`ContributionType.openingBalance`). A fund's balance is then `carried in + collected + derived
  − spent`, wherever it is shown: the member's page, the public group page, and the balance check
  before an expense is logged. Without it every fund would read as if the group had never collected
  anything — the same trap the members' opening balances exist to avoid. A fund the system does not
  have yet can be **added from that page** (name, whether it belongs to the group, whether the group
  spends from it) through the ordinary `/api/types` API, so registration and resignation do not need
  a separate screen.
- **The fund list is seeded, not typed:** `seedGroupFunds()` (boot, and again whenever the go-live
  screen is opened) creates the funds the group's own ledger kept — Registration Fees, Resignation
  Fines, Fines & Penalties, Welfare Contribution, Welfare & Gifts Fund, Member Refunds & Loans Fund,
  Group Objectives Fund, Group Expenses, Former Member Deposits and Bank Interest — alongside the
  weekly contribution and Chai. It only ever *inserts what is missing*, so a fund renamed or
  re-flagged by hand is left alone, and `Extra Contributions` is deliberately not among them.
  The four rows the old import built from a bank statement (Bank Opening Balance, Unallocated Bank
  Deposits, Audit Assessed Contribution, Audit Member Balance Reconciliation) are left out too: they
  describe a reconciliation rather than a fund the group collects, and the float behind them is
  carried in through the funds above. Any of them can still be added by hand.
- **`openingBalance`** on each member carries his verified paper-ledger balance into the cycle,
  so his money starts where the old sheet left him. It is shown at the top wherever a member
  appears — the header tile on the ledger list, a "Brought forward" tile on his own page, the first
  figure in his passbook's at-a-glance strip, and at the top of his admin record (which reads
  "Held by member", not a row sum that says 0). `/admin/finance/setup` suggests each figure from
  what the ledger already says he holds (`GET /api/ledger/setup`), so the 32 balances never have to
  be retyped by hand.
- **A whole week collected in one go (one-time):** `/admin/finance/setup` carries a bulk entry for a
  week that was paid in cash for everybody at once — **week 91**, the week the paper ledger closed
  just before the books opened, is the case it exists for. It posts two rows per active member (the
  week's contribution and the week's tea) dated on the Thursday that week closed, so the money shows
  against week 91 rather than against the opening week, and each member's figure moves by the
  contribution less the tea while the Tea Fund gains the tea. It **previews before it writes
  anything**, every row carries a deterministic `clientRequestId` so running it twice posts nothing
  the second time and a dropped response cannot double a member up, and
  `DELETE /api/ledger/collect-week?weekNumber=91` soft-deletes the batch again — the trail stays in
  the audit log as one System entry carrying the member ids and the totals.
- **Tea before the cycle:** the automatic `chaiAmount` covers the *scored* weeks. Tea for the weeks
  the ledger only lists (1–91) was collected off the paper ledger, so it is counted from the rows
  logged for those weeks (`chai.beforeCycle`) — that is what puts the week-91 tea into the Tea Fund
  and takes it off the member, without the automatic figure counting it twice.
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
- **Putting a balance back** (`npm run balances:restore --prefix backend`, dry run by default) is the
  undo for that screen: it reads the before/after snapshots the audit trail kept of each member and
  prints what every balance is now against what it would become. `--confirm-write` applies it after
  copying the members to `backend/data/opening-balances-*.json`, and the write is itself audit-logged,
  so a wrong undo is recoverable too.
- **The week-91 batch from the command line** (`npm run ledger:collect-week --prefix backend`, dry run by
  default) is the same write as the go-live screen's bulk entry, for when the API is not deployed: it
  posts the week's 1,400 contribution and 100 tea for every active member, dated on the Thursday that
  week closed, skipping anyone who already has a row that week and anyone the batch already posted
  (`week91-<memberId>-weekly` / `-chai`). `--week=`, `--weekly=`, `--chai=`, `--method=` and `--note=`
  change what it posts, and `--undo --confirm-write` takes the whole batch back out — the same rows the
  screen's Undo removes. Post it while `Week number now` is **92**, not 91: a week that ended before the
  cycle opened is history (its tea is deducted and added to the Tea Fund), whereas the cycle's own
  opening week is the baseline and carries no tea at all.
- **Phone normalization:** `+2547…`, `2547…`, `07…` all resolve to one stored format
  (`07XXXXXXXX`) — enforced on member create/edit, CSV import, and public lookup.
- **Public lookup — your own record, nobody else's:** exact phone match only, 5 requests/minute/IP
  (configurable via env), returning the member's masked phone, member-since date, what he holds
  today with the four figures it is made of, the rows he has logged since the cycle opened,
  pledges by type, fines (pending + settled) and the weekly schedule. Never returns internal ids
  or admin metadata. There is deliberately **no public member directory**: a member's record is
  opened by proving his own number, never by browsing a list of names, balances and phone
  numbers. The home page carries group-wide totals only (`GET /api/public/overview` — chama name,
  membership size, raised by fund, fund balances), which hold no per-member data at all. The same
  response carries the group's identity for that page: its **logo** (Settings, uploaded to
  Cloudinary like a member photo) and its **vision and mission**, which default to Chapter 2 of the
  published constitution — clauses 2.1 and 2.2 — unless an admin rewrites either in Settings
  (`utils/groupIdentity`). Those two clauses are resolved on the server precisely because the rest
  of the constitution stays behind the phone gate; a group's vision and mission are meant to be read
  by anyone, its rules are not.
- **Chama documents, minutes and the constitution (phone-gated):** title deeds, certificates and
  other group records are uploaded from `/admin/documents` (PDF, Word/Excel, or a photo, up to
  8 MB) and minutes are written at `/admin/minutes`. Both are stored in MongoDB itself —
  Render/Railway disks are ephemeral, so a file written to disk would not survive a deploy or a
  backup. Members open those, and the constitution, on the public page only after entering a
  phone number registered with the chama (`GET /api/public/documents?phone=…`,
  `…/documents/:id/file?phone=…`, `GET /api/public/minutes?phone=…`, `…/minutes/:id?phone=…`,
  `GET /api/public/constitution?phone=…`, 30 requests/minute/IP). An upload or a minute can be
  marked hidden from members to keep it admin-only; removals are soft deletes, like every other
  record. The phone number is the only credential — anyone who knows a member's number can open
  the members' area, so treat it as group-visible material, not private documents.
- **The constitution is served, not bundled:** the published edition lives in
  `backend/src/data/constitution.js` and reaches the browser only through the phone-gated
  endpoint above, so the members-only gate is real rather than cosmetic — a reader that shipped
  the text inside the app bundle would leave it one devtools download away for anybody who never
  signed in. The page (`/constitution`) has no public link and asks for a number itself when
  opened directly; arriving from the members' area it opens straight onto the document, since the
  number was just proved there.
- **Member profile photos:** uploaded from the member form (`POST /api/uploads/member-photo`,
  image-only, 5 MB) and stored on Cloudinary, cropped square around the face at 512px. The
  publicId is saved with the member so a replaced photo's old asset is deleted rather than
  orphaned. Without `CLOUDINARY_*` configured, the picker reports that uploads aren't set up and
  everything else keeps working.
- **The group's logo:** uploaded from Admin → Chama identity (`POST /api/uploads/chama-logo` — the
  same proxied Cloudinary path, admin-only because the logo is a Settings field, not a member
  field). It is stored in its own folder and never face-cropped, and the page falls back to the mark
  the app ships (`public/icon.svg`) while Settings holds no URL.
- **The credit line:** one line sits at the foot of every screen a member or an officer can reach —
  the members' page, the sign-in card, the constitution's footer, and every admin page (it lives in
  `AdminLayout`, so each role's screens carry it from one place rather than from per-page copies).
  It reads *Created and managed by GlimmerInk Creations* and links to `glimmerink.co.ke` in a new
  tab, so nobody loses a number he has just typed (`components/shared/CreditLine.jsx`).
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
subfolder to build. The live site is **https://wazomojashg.co.ke**, served by Netlify; the API is
on its own host (Render/Railway).

### Frontend → Netlify

`netlify.toml` at the repo root already sets base directory `frontend`, build command
`npm run build`, publish directory `dist`, Node 20, the SPA fallback (`/* → /index.html`, 200) so
client-side routes like `/admin/dashboard` or `/member/:id` don't 404 on refresh, cache rules
(fingerprinted `/assets/*` for a year, `index.html` always revalidated) and security headers.
`frontend/public/_redirects` carries the SPA rule as a backup, since Vite copies anything in
`public/` straight into `dist/`.

Go-live steps for the domain:

1. **Registrar** (where `wazomojashg.co.ke` was bought): set the nameservers to the four Netlify
   shows under **Domain management → Netlify DNS** (they look like `dns1.p05.nsone.net`). Copy all
   four; the zone is managed by Netlify, so no A/CNAME records are needed for the apex. `.co.ke`
   delegation usually lands within a few hours, but give it a full day before worrying.
2. **Netlify → Domain management:** add `wazomojashg.co.ke`, and add `www.wazomojashg.co.ke` as a
   domain alias as well. Whichever one is marked **primary** is served; Netlify 301s the other to
   it, so there is one origin rather than two.
3. **Wait for "Netlify DNS verified", then provision the certificate** (Let's Encrypt, automatic).
   If it says the certificate is waiting on DNS, click **Verify DNS configuration**, then
   **Provision certificate**.
4. **Environment variables** (Site configuration → Environment variables): set
   `VITE_API_URL` to the API's address, e.g. `https://api.wazomojashg.co.ke` or the host's own
   `https://<service>.onrender.com`. It is baked in at build time, so after changing it run
   **Deploys → Trigger deploy → Clear cache and deploy site**.
5. Keep the free `<site>.netlify.app` address working — it is handy for a preview before the
   domain is live.

### Backend → Render / Railway

Root `backend/`, start `npm start`, health check `/api/health`. Set every variable from
`.env.example`; at minimum `MONGO_URI`, `JWT_SECRET`, `NODE_ENV=production` and `FRONTEND_URL`.
`trust proxy` is already enabled so per-IP rate limiting works behind their proxies.

`FRONTEND_URL` is the CORS allow-list, and it takes a **comma-separated list** — list every
origin the app is opened from, because a member who opens the site on `www.` while the API only
allows the apex would see every request fail:

```
FRONTEND_URL=https://wazomojashg.co.ke,https://www.wazomojashg.co.ke,https://<site>.netlify.app
```

**Optional custom API domain:** in **Netlify DNS** add a CNAME `api → <service>.onrender.com`, then
add `api.wazomojashg.co.ke` as a custom domain on the backend host so it issues its own
certificate for it. That keeps the API address on the group's own domain (and out of the frontend
bundle as a foreign-looking URL).

### After the first deploy

- Sign in as the super admin, check **Settings → chama name** reads `WAZO MOJA SELF-HELP GROUP`.
- Email and Cloudinary keep working only if their variables are set on the host too (7 `SMTP_*` /
  `MAIL_FROM` and the `CLOUDINARY_*` trio) — on the server they are silently disabled otherwise.
- Open a member's passbook from a phone on mobile data (not the office Wi-Fi) to confirm the
  public lookup and the gated PDF/Excel work over the real domain.

## Environment variables (backend)

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | 32+ random characters — the server refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime, default `8h` |
| `FRONTEND_URL` | Allowed CORS origins — one, or several separated by commas |
| `LOOKUP_RATE_LIMIT_WINDOW_MS` | Lookup rate-limit window (default 60000) |
| `LOOKUP_RATE_LIMIT_MAX` | Max lookups per window per IP (default 5) |
| `CLOUDINARY_URL` *or* `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | Member profile photo storage |
| `CLOUDINARY_FOLDER` | Where photos are stored in the Cloudinary account (default `chama-system/members`) |
| `CLOUDINARY_BRANDING_FOLDER` | Where the group's logo is stored (default `chama-system/branding`) |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASS` · `SMTP_SECURE` | Outgoing mail for reminders |
| `MAIL_FROM` | Address reminders are sent as — required for sending to work at all |
| `MAIL_REPLY_TO` | Optional reply-to (e.g. the treasurer's own inbox) |

## Environment variables (frontend)

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | The API's address. Baked in at build time; unset falls back to `http://localhost:5000`. See `frontend/.env.example` |
