# Wazo Moja Self-Help Group — contribution system

Digital record-keeping for the group (a chama) — replaces the manual book. Admins log
contributions; members check their own history by their ID number (no login, rate-limited, exact
match only). Built mobile-first: 98% of usage is on phones. Live at https://wazomojashg.co.ke

## Stack

- **Frontend:** React + Vite + Tailwind CSS (v4) — `frontend/`
- **Backend:** Node.js + Express + Mongoose — `backend/`
- **Database:** MongoDB (Atlas free tier works)
- **Auth:** JWT, admins only. Members are never authenticated.

## Member data in this repository — what already happened, and what is left

**This repository has been public, and it contained the group's real member data.**

What was exposed: two spreadsheets and an earlier revision of one of them —
`backend/test.xlsx` (one member's full statement), `backend/data/ledger_weeks_61_86_template.xlsx`
and `backend/data/ledger_weeks_62_84_template.xlsx` — plus twenty one-off scripts from the
migration, of which `importHarambeeContributions.js` alone carried 355 phone numbers, and
`findWrongAmounts.js`, `Fixwrongamounts.js`, `importWeek60Ledger.js`, `importWeek61Ledger.js`,
`importWeek75Ledger.js`, `Liststraymembercontributions.js`,
`Listrealopeningbalancescontributions.js` and others carried names, amounts or phones. A
phone number is not a name here: it is the *credential* for the members' area.

**Done (2026-09-18).** The files were removed from the tree, the ignore rules now cover
`backend/data/` and every spreadsheet under `backend/` (`npm run check:data` fails a build
in which one is tracked again), and the **history was rewritten** with `git filter-repo`:
194 commits replayed, all 23 paths purged, the rewritten `main` force-pushed, and verified —
no leaked path is reachable from any remote ref, the old blob objects are gone from the
object store, and GitHub refuses to serve the pre-purge commits at all
(`git fetch origin 9925d94` → `couldn't find remote ref`).

A full copy of the **old** history — which still contains all of it — was taken first and
lives outside the repository:

```
%USERPROFILE%\chama-history-backup-<date>.bundle       (git bundle)
```

Keep it somewhere the committee controls, never inside the repository, and treat it exactly
as the register: it is the only remaining copy of those old scripts.

**Still to do — and it matters more than the purge did:**

1. **Make the repository private.** GitHub → Settings → Danger zone → Change visibility.
   Anyone who cloned, forked or scraped the repository before the rewrite still has the
   data, and a private repository stops new copies being made.
2. **Tell the committee what was exposed** — names, phone numbers, amounts, balances, and
   the scripts that carried them — and let them decide whether members should be told. It
   is their call, not a technical one; it is also the honest default.
3. **Rotate what the leak protects**: every admin password, and `JWT_SECRET` on the server
   (which logs everybody out). The material that leaked is the material those protect.
4. Optionally ask GitHub Support to expire cached copies of the unreachable objects, for
   completeness.
5. **Keep the constitution out of it too** — done: the text is seeded into the database
   (`npm run seed:constitution`) and `backend/src/data/constitution.js` is out of the tree.

If a copy of the spreadsheets is needed for the audit, keep it outside the repository (or in
`backend/data/`, which is ignored) — never in the tree that gets pushed.

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

### Checks and tests

```bash
npm test                    # the week engine, money, uploads, minutes, 2FA, the audit chain,
                            # the job schedules, and the API's own behaviour (no database needed)
npm run test:integration    # the rehearsal: the money paths, the audit chain and the scheduled
                            # jobs, against a real MongoDB (below)
npm run check:data          # refuses to pass if any spreadsheet or dump is tracked
npm run check:national-ids  # read-only: two members sharing a national ID
npm run verify:figures      # read-only: does the live database agree with the new rules
npm run verify:audit        # read-only: has anybody edited the audit trail (see below)
npm audit --omit=dev        # dependency advisories
```

In `frontend/`:

```bash
npm test                    # the pure frontend logic (formatting, ID handling, links)
npm run report:bundle -- --max=150   # the critical path in gzip KB, and fails if it is over 150
```

`npm test` needs no database and no `.env`. `npm run test:integration` is the rehearsal: it starts
the API against a scratch MongoDB, signs in, logs a payment, checks a duplicate submit is not
counted twice, issues and settles a fine, watches the quarter-drop guard refuse a save, takes a
backup through the real endpoint and restores it into a second database — then writes audit entries,
edits one *behind the API's back* and checks the chain notices, drives the job runner, and writes a
real backup file and reads it back. CI runs it against a `mongo:7` service container.

```bash
docker run -d --name chama-rehearsal -p 27017:27017 mongo:7   # once
npm run test:integration
docker start chama-rehearsal                                  # next time
```

Or with Compose, from the repository root (`docker compose up -d mongo`, or `up --build` for the
API too).

Point it somewhere else with `TEST_MONGO_URI=mongodb://host:27017/chama-scratch`; it
creates and drops its own databases and refuses a URL that does not look like a scratch one.


The first test to reach for when a balance looks wrong is `test/weekCycle.test.js`:
it pins the Friday→Thursday boundary, the history back to week 1, and the rule that
money dated before the cycle opens is credited to the opening week.

### Maintenance scripts

| Script | What it does |
| --- | --- |
| `npm run verify:figures` | **Read-only.** Reports anything already stored that disagrees with the rules the API now enforces on write (money needing rounding, out-of-range or non-numeric amounts, text over a new cap, duplicate national IDs, more than one Settings row) and prints the books' totals to compare against after a deploy. No writes, and indexes are not built |
| `npm run restore:backup -- <file.json>` | Puts a downloaded backup back into a database. Dry run without `--confirm-write`; upserts by `_id` unless `--replace`; refuses the live database unless `--replace-live` as well. Restore into a scratch database (`--target=…`) before you ever need it |
| `npm run test:integration` | The rehearsal: the money paths and a backup round trip against a scratch MongoDB (see Checks and tests) |
| `npm run seed:constitution -- --confirm-write` | Copies the constitution into the database (then the file can leave git). `--from=/path` seeds from a copy kept outside the repository |
| `npm run check:national-ids` | Reports duplicate/blank/free-text IDs. Exit code 1 on duplicates — a unique index cannot build while two members share a number, and the gate refuses both |
| `npm run audit:prune -- --days=730 --confirm-write` | Trims the audit trail to a retention window. Dry run without `--confirm-write`; the prune itself is recorded in what remains |
| `npm run reset:week92` · `balances:restore` · `ledger:clear-contributions` · `ledger:collect-week` | The destructive ones. All dry-run by default, all back up to `backend/data/` (gitignored), all write a `System` audit entry naming the operator (`--by=<email>`, or the earliest super admin) |

A fine can be cleared in two ways: automatically (a logged payment pays down pending
fines oldest-first, on both the ledger's own log endpoint and `/api/contributions`),
or by hand from the member's page — **Fines → Pay**. Voiding a fine is for a fine
that should never have been issued, not for one that has been paid.

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The frontend reads `VITE_API_URL` (defaults to `http://localhost:5000`). For production builds,
set it to the deployed API URL.

## Routes

- `/` — public lookup: group totals, your own record by ID number, and the members' area
  (documents, minutes, constitution). Standalone — loads no admin code.
- `/constitution` — the constitution, members only: the page fetches the text for an ID recorded
  against a member, and there is no public link to it.
- `/admin/login` — admin sign in
- `/admin/dashboard` · `/admin/members` · `/admin/reports` · `/admin/minutes` ·
  `/admin/reminders` · `/admin/documents` · `/admin/disciplinary` · `/admin/audit` — protected
- `/admin/audit` — the audit trail: every change, filtered by category, who, when and what, with the
  unusual entries flagged and an export of the view on screen. Its own destination because it is the
  screen somebody opens when a figure needs explaining.
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
- **The weekly reconciliation names both sides of a week:** the drill-down behind each week
  (`/admin/reports` → Weekly reconciliation) leads with the members who **paid in full**, each with
  what he put in ("Who paid in full (2)"), and then — under a "Still to pay" heading — the members
  who still owe their weekly minimum. The payers lead because that is the question the page is held
  open to answer ("did he pay?"); they used to sit at the bottom, behind a click, under a roster of
  everybody who had *not* paid. Neither list is decoration: a week with two payers and thirty
  non-payers otherwise shows Ksh 9,000 collected on the fund line with every name beneath it reading
  zero — money from nobody. The two lists are complements, so between them they account for every
  eligible member, and both are cut from the same `personalPaid` on each member's own ledger row —
  which is what makes the names add up to the figure above them
  (`backend/test/memberLedger.test.js`). The `.xlsx` export keeps the same order: **Paid in full**
  before **Shortfalls**.
- **Every money label says what it means.** The paper ledger's shorthand is not what a new
  treasurer knows, so each figure carries its own explanation in brackets, and the same words are
  used for the same thing on every screen — the dashboard and finance list (which set the pattern,
  `frontend/src/components/ledger/MemberLedgerList.jsx`), the member's page, the passbook, the
  reports and the PDF/Excel statements (`backend/src/utils/memberStatement.js`):
  - **money held by member** — carried in + paid in − due so far − tea
  - **carried in at week 92** — what the paper ledger held when these books opened
  - **paid in since week 92** — contributions logged on this ledger
  - **due so far** — the weekly amount × the weeks that have closed
  - **owed** — closed weeks still unpaid (never a week still running: its Thursday is to come)
  - **tea** — deducted automatically, the weekly tea × the weeks that have closed
  - **settled** — every closed week paid, by payment or by earlier extra saved
  - **nothing due yet** — no week has closed, so nobody owes and nobody has settled anything; the
    pill says this rather than "settled" while the first week is still running
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
- **The performance report reads 0/0 for everybody until the first week has closed — and that is
  correct.** Its "weeks closed" ratio counts only weeks that have closed and been scored, and by
  design the opening week is the baseline (never scored) and the week running now is not scored
  either (its Thursday is to come). So between the day a cycle opens and the first Thursday after
  it, every member shows `0/0` with a consistency of `—` while the ledger and the passbook plainly
  show money coming in — a report that looks broken on the day somebody is most likely to read it.
  What answers the question then is **paid this week (running)**, on each row and in the workbook's
  own column, and the screen says so in a line above the list rather than leaving it to be
  discovered. The `0/0` is asserted, deliberately, in
  `backend/test/integration/performance.test.js`: the tempting "fix" is to count the running week as
  expected, which would mark every member late for money nobody has been asked for yet and put this
  screen in disagreement with the passbook, the reminders and the ledger.
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
  (`07XXXXXXXX`) — enforced on member create/edit and CSV import. The phone is how the office
  reaches a member; it is no longer the key to his record (see the ID below).
- **The member's ID is the key to his own record:** a member opens his passbook, the group's
  documents, the minutes and the constitution by typing the `nationalId` recorded for him —
  exactly as written on the register, so spaces, dashes and slashes are ignored and a passport
  number's letters are accepted (`utils/nationalId` normalizes; `utils/publicAccess` checks).
  **Phone numbers were the old key and are no longer accepted anywhere on the public side.** The
  group keys its records on the ID instead: it is the number the register already holds for every
  member, it does not change, and it is not something a member has to read off a bill to be
  recognised. It is also the one field the office has to fill in: an active member with no
  ID (or a note like "not yet issued" in it) cannot look himself up, so `/admin/members` counts
  those members for the office and each card of one is marked "No ID". IDs can be loaded in bulk
  from a spreadsheet — the CSV import already reads a `nationalId` column.
  One ID belongs to one member: create, edit and import refuse a duplicate, and if two records ever
  end up sharing one the gate answers 409 rather than showing the wrong passbook.
- **The spreadsheets are meant to be edited, and the members one comes back in.** Every export is a
  real `.xlsx` (`utils/xlsxExport`), and the member register is the one that round-trips: the
  export, the blank import template and the importer share one table of headings
  (`FORM_EXPORT_COLUMNS`), the parser accepts several spellings of each, and
  `POST /api/members/import` reads `.csv` or `.xlsx` (the browser converts the workbook, so no
  upload endpoint is needed). Three details are what make that work rather than nearly work. A date
  is written as **text** (`1990-04-17`), because SheetJS would otherwise write a serial number the
  office has to fix by hand before the file reads properly — and the importer could not read it
  back. A national ID keeps its leading zero for the same reason: as a number it would not have one,
  and the ID is the key to a member's own record. And a cell starting `=`, `+`, `-` or `@` gets a
  quote in front of it so Excel cannot run it as a formula (CWE-1236) — a guard the importer
  **undoes**, because that quote is a character in the cell, not a formatting flag: a next-of-kin
  phone of `+254712345678` would otherwise come back as `'+254712345678`, a contact number that does
  not work, and a note of `-50 owed` would come back quoted. `test/xlsxRoundTrip.test.js` runs the
  whole pipeline — write the workbook, read it back the way the browser does, parse it — and asserts
  both halves at once: the file stays inert to open, and the data comes back as it went in. The
  contributions template (`GET /api/contributions/bulk/template` + `POST /bulk`) is deliberately
  API-only: the bulk weekly grid it was written for was retired in favour of logging member by
  member, and it is kept for a scripted one-off backfill. Every other workbook — statements, fines,
  performance, monthly, weekly reconciliation, audit trail — is a report to read, to hand to a
  committee or to give an auditor. None of them is disguised as an import format.
- **Public lookup — your own record, nobody else's:** exact ID match only, 5 requests/minute/IP
  (configurable via env), returning the member's masked phone, member-since date, what he holds
  today with the four figures it is made of, the rows he has logged since the cycle opened,
  pledges by type, fines (pending + settled) and the weekly schedule. Never returns internal ids
  or admin metadata. There is deliberately **no public member directory**: a member's record is
  opened by proving his own ID, never by browsing a list of names, balances and phone
  numbers. The home page carries group-wide totals only (`GET /api/public/overview` — chama name,
  membership size, raised by fund, fund balances), which hold no per-member data at all. The same
  response carries the group's identity for that page: its **logo** (Settings, uploaded to
  Cloudinary like a member photo) and its **vision and mission**, which default to Chapter 2 of the
  published constitution — clauses 2.1 and 2.2 — unless an admin rewrites either in Settings
  (`utils/groupIdentity`). Those two clauses are resolved on the server precisely because the rest
  of the constitution stays behind the ID gate; a group's vision and mission are meant to be read
  by anyone, its rules are not.
- **Chama documents, minutes and the constitution (ID-gated):** title deeds, certificates and
  other group records are uploaded from `/admin/documents` (PDF, Word/Excel, or a photo, up to
  8 MB) and minutes are written at `/admin/minutes`. Both are stored in MongoDB itself —
  Render/Railway disks are ephemeral, so a file written to disk would not survive a deploy or a
  backup. Members open those, and the constitution, on the public page only after entering the
  ID recorded for them (`GET /api/public/documents?nationalId=…`,
  `…/documents/:id/file?nationalId=…`, `GET /api/public/minutes?nationalId=…`,
  `…/minutes/:id?nationalId=…`, `GET /api/public/constitution?nationalId=…`, 30 requests/minute/IP).
  An upload or a minute can be marked hidden from members to keep it admin-only; removals are soft
  deletes, like every other record. The ID is the only credential — anyone who knows a member's ID
  can open the members' area, so treat it as group-visible material, not private documents. It is
  also a short number, which is why the rate limits here are the tight ones they are.
- **The constitution is served, not bundled:** the published edition lives in
  `backend/src/data/constitution.js` and reaches the browser only through the ID-gated
  endpoint above, so the members-only gate is real rather than cosmetic — a reader that shipped
  the text inside the app bundle would leave it one devtools download away for anybody who never
  signed in. The page (`/constitution`) has no public link and asks for an ID itself when
  opened directly; arriving from the members' area it opens straight onto the document, since the
  ID was just proved there.
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
  tab, so nobody loses the ID he has just typed (`components/shared/CreditLine.jsx`).
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
  (Oversight → Audit trail, `/admin/audit`).
- **CSV import:** columns `name, phone, regNumber (optional), nationalId (optional), notes
  (optional)`, plus the rest of the admission form when the sheet carries it. Duplicate
  phones are skipped and reported, never overwritten — and so is an ID another member already
  holds, since the ID is how a member opens his own record. A sheet of IDs is the quickest way to
  fill the register in for members who have none yet.
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
| `JWT_EXPIRES_IN` | Token lifetime, default `8h`. A password change ends every existing session immediately, so this is a ceiling rather than a promise |
| `FRONTEND_URL` | Allowed CORS origins — one, or several separated by commas. **Required in production**: without it every request from the live site is refused, so the server refuses to start instead of failing quietly |
| `LOOKUP_RATE_LIMIT_WINDOW_MS` | Lookup rate-limit window (default 60000) |
| `LOOKUP_RATE_LIMIT_MAX` | Max lookups per window per IP (default 5) |
| `LOGIN_RATE_LIMIT_WINDOW_MS` · `LOGIN_RATE_LIMIT_MAX` | Sign-in budget per (address + email), default 5 per 15 minutes |
| `LOGIN_SPRAY_LIMIT_MAX` | Sign-in attempts per address regardless of email, default 30 per 15 minutes |
| `API_RATE_LIMIT_MAX` | Authenticated requests per minute per session, default 300 |
| `LOG_LEVEL` | `silent` switches the request log off; every other value logs one JSON line per request |
| `CLOUDINARY_URL` *or* `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | Member profile photo storage |
| `CLOUDINARY_FOLDER` | Where photos are stored in the Cloudinary account (default `chama-system/members`) |
| `CLOUDINARY_BRANDING_FOLDER` | Where the group's logo is stored (default `chama-system/branding`) |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASS` · `SMTP_SECURE` | Outgoing mail for reminders |
| `MAIL_FROM` | Address reminders are sent as — required for sending to work at all |
| `MAIL_REPLY_TO` | Optional reply-to (e.g. the treasurer's own inbox) |
| `TWO_FACTOR_RATE_LIMIT_MAX` | Code attempts per challenge, default 10 per 15 minutes |
| `JOBS_ENABLED` | `false` switches the scheduled jobs off. Safe to leave on with more than one instance — the lease in the database decides who runs |
| `JOB_BACKUP_SCHEDULE` · `JOB_AUDIT_SCHEDULE` · `JOB_REMINDER_SCHEDULE` | `daily@HH:MM` · `weekly@<day>@HH:MM` · `monthly@<day>@HH:MM`, in EAT. Defaults `daily@02:00`, `weekly@sat@04:00`, `weekly@sun@18:00` |
| `BACKUP_DIR` | Where the nightly backup is written (default `backend/data/backups`, gitignored). **Point this at a mounted volume on a host with an ephemeral disk** |
| `BACKUP_RETENTION` | How many backup files to keep, default 14 |
| `BACKUP_STALE_DAYS` | How many days may pass without a download before the weekly report says so, default 30 |
| `AUDIT_RETENTION_DAYS` | Blank or 0 keeps everything (the default). Only pre-chain entries are ever pruned automatically |
| `AUDIT_HEAD_EMAIL` | Where the weekly audit check sends the chain's head. Defaults to `MAIL_REPLY_TO`, then `MAIL_FROM` |
| `REMINDER_SWEEP_SEND` | `true` lets the weekly sweep actually email members who are behind. Off by default |
| `REMINDER_SWEEP_MAX` | Most members one sweep will email, default 200 |
| `SYSTEM_ACTOR_EMAIL` | Which account automatic writes are credited to in the audit trail. Defaults to the earliest super admin |

## Environment variables (frontend)

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | The API's address. Baked in at build time; unset falls back to `http://localhost:5000`. See `frontend/.env.example` |

## Server behaviour worth knowing

**Sessions.** A JWT is signed with `JWT_SECRET` and verified against `HS256` only.
`PATCH /api/auth/me/password` and an admin password reset both stamp
`passwordChangedAt` on the account, and every token issued before that instant is
refused from then on — so "change the password" really does end the other sessions,
including a thief's. There is no logout endpoint on purpose: a JWT has no server-side
session to end, and an endpoint that pretended otherwise would be a lie in the API.

**One settings row.** `Settings` is identified by `key: 'main'`, which is unique.
Two concurrent cold starts used to be able to create two rows, and since that document
holds the week anchor and the amounts, a second row would mean two members' arrears
differing between requests. A database that predates the key has its existing row
adopted on first read.

**Money.** Amounts are Kenyan shillings held as numbers and rounded to two decimal
places at the model layer (`utils/money.js`), so no arithmetic path — including a
future one nobody has written yet — can store a figure that has drifted. The UI
collects whole shillings; two decimal places is the conservative choice, because
rounding to whole shillings would silently alter a figure somebody did type with
cents on it.

**Uploads.** The declared `Content-Type` is only used to decide which signature to
expect; the bytes decide what the file is (`middleware/uploadDocument.js`). SVG and
HTML are refused outright — both are markup wearing an image's content type — and
anything that is not a PDF or an image is served back as a download rather than
inline.

**Minutes.** Written through `sanitize-html` against the editor's own schema
(`utils/sanitizeHtml.js`), so a script cannot reach a member's page whatever client
posted it. The editor cannot produce anything outside that allowlist, so a legitimate
minute round-trips unchanged.

**The audit trail** (`/admin/audit`, its own destination — it was a panel under the reports). The
trail is read when something needs explaining, by whoever has to explain it, so it is not buried
under four cards of figures. Every entry arrives read by `utils/auditFlags.js`: put in one of four
categories (money, people, records, settings), and flagged when it is worth a second look — an amount
cut or raised, a contribution moved to another member or another fund, one re-dated, a member's phone
number or ID or carried-in balance changed, an account's role changed, a group-wide operation like a
ledger reset. A trail of four hundred ordinary edits says nothing without those flags, and a flag that
fires on every save says nothing either, so the watched fields are listed per entity and a change is
only reported where one of them moved. The screen filters by category, action, record type, who did
it, a date range and free text, with an "Unusual only" view and an `.xlsx` export of exactly the view
on screen (an "Unusual" sheet included). The API is `GET /api/audit` (+ `/api/audit/export`), append-only
like the collection behind it, newest-first off the index, and **the screen still only receives what it
prints** — the stored snapshots contain whole member records (national ID, family, next of kin), and
they are read to work out the flags and never sent. The counts say what they counted: they cover the
newest 2,000 matching entries rather than walking a collection that only ever grows.
`npm run audit:prune` is how the trail is trimmed to whatever retention the committee decides; the
prune records itself.

**Backups.** `GET /api/backup` is super-admin only, streamed a collection at a time
(the whole database with its document scans will not fit in memory twice on a small
instance), and written to the audit trail. `?slim=1` leaves the document bytes out —
that copy is for reading or emailing, not for restoring. The file is format version 2:
dates are written as `{$date: ISO}` and document bytes as `{$binary: base64}`, which is
what makes a restore faithful. **Any backup downloaded before 2026-09-18 is version 1
and cannot be trusted**: a bug turned every date in it into `{}`, so take a fresh one.
`npm run restore:backup` reads version 2 back, reporting what it will write before it
writes it, and refusing the live database unless it is told twice. The full file is the
database as it stands, password hashes included, because that is what makes it
restorable: treat it the way the register itself is treated.

`GET /api/backup/status` is what the Backup panel prints around the button, and it exists to keep
two things apart that both look like "we have a backup": when a copy last left the machine, and
what is merely sitting on the host. The first is read from the audit trail, so it is the same fact
the audit screen shows rather than a second record that could drift from it; the second reports the
files in the backup directory, the newest of them, and **whether `BACKUP_DIR` is configured** —
which is the straight answer to "will last night's file still exist after a deploy?". A download
that has never happened reads **Never**, not a blank, because "nothing has ever been taken off this
machine" is exactly the state that needs saying out loud.

**And it nags.** The failure this guards against is an absence — a copy of the books nobody has
taken off the machine for two months — and an absence announces itself on no screen, so the age of
the last download is computed once (`utils/backupHealth.js`) and said in four places: the Backup
panel, the **weekly reconciliation** (a line above the week list, and the same line on the
workbook's cover sheet), the weekly reminder sweep's own record, and `GET /api/backup/status`. Past
`BACKUP_STALE_DAYS` (30 by default) — or the day a group that has never downloaded one opens the
page — the line appears; a copy taken recently means **nothing is said at all**, because a reminder
that keeps firing after somebody has done the thing is a reminder everybody learns to ignore. The
rule is pinned in `test/backupHealth.test.js`: the day before the mark, the mark itself (the rule is
*older than*, so 30 days is not yet stale), the day after, and a clock that disagrees with the record.

**Observability.** One JSON line per request on stdout (`rid`, method, path, status,
duration, account, address) and `X-Request-Id` on every response. A 5xx logs the
message, the route and the account; failed sign-ins log the address attempted (not the
password) with a reason; a refused lookup at the members' gate logs a hash of the ID
attempted, which is how enumeration shows up in the logs. `/api/health` returns 503
when MongoDB is not connected — a health check that says "healthy" while the database
is unreachable keeps traffic pointed at a broken instance. `SIGTERM` finishes in-flight
requests before exiting, so a deploy mid-collection does not leave a half-posted week.

**Two things left for the committee.** (1) The members' gate is a single factor: the
ID alone opens the papers. A second one — the last three digits of the phone number on
the record, or a short code sent by SMS — is a change to what members must carry, not
a bug to patch, so it waits on a decision. What is in place meanwhile is the rate limit
(5 lookups a minute per address), `Cache-Control: no-store` on everything unlocked by
an ID, the refusal to answer at all when an ID matches two members, and the denial log
above. (2) Money is stored as two-decimal numbers rather than integer cents; exact to
two places, which is what the shilling needs, but integer cents would be exact beyond
it if the group ever trades in fractions of a shilling.

**Admin accounts can have a second factor — switched off by default.** `/admin/settings`
→ **Security** has a master switch that only the super admin can flip: **two-factor
authentication is off for the group until he turns it on**. Off means off for everybody,
including accounts that had already enrolled — nobody is asked for a code and nobody can
enrol, and their setup is kept rather than deleted so turning it back on restores exactly
what was there. An account can still turn its own second factor off while the group has it
off, because the switch must not trap anybody. It is built and tested and waiting; turn it
on when the committee has decided who will use it.

Once it is on: an admin enrols from the same screen, with an authenticator app — the same
RFC 6238 standard every one of them implements, so nothing needs installing that the admin
does not already have. `utils/totp.js` is the implementation and it carries no dependency —
`crypto`, base32, and the published RFC test vectors in `test/totp.test.js`, which is the
only way to be sure a code works in Google Authenticator and not merely in this codebase.

Three decisions in it are worth knowing:

  * **Nothing is switched on until a code from the app verifies.** The secret is held as
    *pending* until then, so an admin who starts enrolling and gets distracted is not
    locked out of his own account by a half-finished setup.
  * **Signing in is two steps, and the first one is not a session.** A correct password
    returns a five-minute `scope: '2fa'` challenge, which `middleware/auth` refuses
    everywhere a session is accepted — otherwise the challenge would itself be a working
    token and the second factor would be decoration.
  * **The secret never leaves the server as a picture.** There is no QR code, because
    drawing one means handing the account's shared secret to a third-party image service.
    The key is shown as one run of characters with a copy button, and every authenticator
    app accepts manual entry. It is deliberately **not** grouped into fours for
    readability: Google Authenticator answers a space in the key box with "key value has
    illegal character", so a key displayed with spaces in it is a key that cannot be typed
    in by anybody who copies what is on the screen.

Ten single-use **recovery codes** cover the lost phone, stored only as HMACs keyed on
`JWT_SECRET` (so a dump of the accounts table cannot be worked through offline) and removed
as they are spent. Using one is logged and said out loud at sign-in, because a recovery code
is the weakest link in any 2FA setup: it is written down, and it does not expire. A code
already used for one sign-in cannot be used again — the accepted thirty-second slot is
recorded on the account. Turning the second factor off, or reissuing codes, needs the
password *and* a live code, because either one alone is something a thief holding the phone
already has. An admin whose phone is gone is unblocked by another admin from the accounts
panel, which leaves the loudest entry the trail takes.

**The audit trail is tamper-evident.** Every entry carries the hash of the entry before it
(`utils/auditChain`), so a stored document that has been edited, an entry that has been
deleted, or one that has been inserted is no longer a quiet change: it breaks every hash
after it, and `npm run verify:audit` names the first entry that does not add up — with the
exit code as the answer, so it can run on a schedule or in CI. The canonical form is
key-sorted, because a verifier that re-serialised a stored document and compared strings
would report breaks that are not there, and a verifier that cries wolf gets ignored.

Two honest limits, written into the module rather than left implied:

  * **A chain cannot catch entries removed from the end** — a shortened trail is internally
    perfect. That is what the recorded head is for: `verify:audit` prints it, and the weekly
    job emails it (see below). A head written down or received a month ago is what proves
    nothing was dropped since.
  * **It is not a signature.** Somebody who rewrites every entry from the break onward and
    recomputes the hashes defeats it; that needs the anchor kept somewhere the operator cannot
    reach, which is exactly what the emailed head is.

Entries written before the chain existed carry no hash and are skipped by the verifier:
inventing a hash for history nobody can honestly recompute would be a worse lie than an honest
gap. Writes retry against the real head if two land at once (`chainSequence` is unique, so a
fork is refused by the database rather than by hope), and the chain is a *reason to notice*,
never a reason to refuse the payment being audited.

**The things nobody has to remember.** `jobs/` runs three jobs, and their whole point is that
they happen without a person: everything in this system has always waited for somebody to press
something, which is right for the books and wrong for a backup.

| Job | Default | What it does |
| --- | --- | --- |
| `nightly-backup` | `daily@02:00` EAT | Writes the whole database to a file — the same format and the same code as the download button (`utils/backup`) — and keeps the newest `BACKUP_RETENTION` (14) |
| `audit-check` | `weekly@sat@04:00` | Verifies the chain, records the head, and emails it |
| `reminder-sweep` | `weekly@sun@18:00` | Works out who is behind; emails them **only** if `REMINDER_SWEEP_SEND=true` |

Four things about the runner are deliberate:

  * **A job runs once, even with two instances.** A lease in the database (`models/JobLock`,
    insert-then-steal against a unique index) is the arbiter, because a timer alone would happily
    take the nightly backup twice during a deploy. The lease expires, so a container killed
    mid-job does not stop the job happening ever again.
  * **A failing job never takes the process down**, and it is recorded either way: the absence of
    a backup is what this guards against, and an absence is invisible without a record of
    presence. `GET /api/jobs` (super admin) lists the schedules, the next run and the last five
    runs, and reads the backup directory from disk rather than from those records — because the
    question is whether the files are there.
  * **Schedules are East African time**, a fixed +3 like the week engine, and they are written
    the way a person says them: `daily@02:00`, `weekly@fri@03:00`, `monthly@1@04:00`.
  * **The reminder sweep reports before it sends.** It computes and reports every week and emails
    only when switched on — the same principle as `autoSettleFines`: a deploy must never begin
    writing to the membership on its own.

Run one by hand with `npm run job:backup` (or `job:audit`, `job:reminders`), or
`POST /api/jobs/<name>/run`. Both go through the same code as the timer, so "run it now" is a
real rehearsal of the schedule rather than a second implementation of it.

**Where a backup goes matters.** `BACKUP_DIR` defaults to `backend/data/backups/`, which is
gitignored — and on a host with an ephemeral disk (Render, Railway) it does **not** survive a
deploy. Point it at a mounted volume, or copy the directory off the host. A backup that lives
only on the machine it is backing up is not a backup, and the job records the directory it wrote
to so the question is answerable. The Backup panel answers it on screen as well, so nobody has to
read an environment variable to find out whether last night's file is somewhere that survives:
it names the directory, and says plainly when the files are on the app's own disk. Relying on the
download button instead is a legitimate choice — a copy in an official's hands is better than a
file on an ephemeral disk — which is why the panel reports when the last one was taken, and why the
weekly report says so once `BACKUP_STALE_DAYS` (default 30) have passed with nothing downloaded.

**The ledger works with no signal.** `frontend/src/services/offlineQueue.js` keeps a ledger entry
that failed for a network reason and sends it when the signal returns, and
`frontend/public/sw.js` caches the app shell so the page opens at all on a bad cell. The outbox is
safe *because* of `clientRequestId` on `Contribution` — a unique sparse index, so a replay
resolves to the same payment instead of a second one — and it is **opt-in per request**
(`offlineQueue: true`), because silently keeping a failed save is only acceptable where the API
already treats a repeat as the same write.

Three rules keep it honest:

  * **It never skips ahead.** If the first queued entry cannot be sent, the ones behind it wait: a
    member's later payment must not land before his earlier one, or his statement reads as though
    the second came first.
  * **A refusal is not retried.** A 4xx means the API understood and said no; it is discarded and
    *reported*, because an entry that can never succeed would otherwise hide the real one behind
    it forever. A conflict is reported as "already went through" rather than as a failure. The
    banner says "could not be saved and will not be retried" — the one message in this system that
    must never be softened.
  * **The clerk's next entry gets a new key.** After a queued save the screen rotates its request
    id; reusing it would make the API treat the next, different payment as a duplicate of the
    queued one and silently drop it. That is the single way an outbox loses money instead of
    saving it.

The service worker caches **nothing under `/api/`** — not the ledger, and above all not the
ID-gated documents, minutes or constitution. The API marks those `no-store`, and a worker that
kept a copy anyway would leave a member's papers sitting in a browser cache after the page was
closed. It is registered in production only, because a worker serving the shell from a cache
fights Vite's hot-reload; test it with `npm run build && npm run preview`.

**A statement can cover a period.** Every statement has always been "everything": the figures to
date, the last twelve months summarised, the schedule, every row. What it could not answer is the
question members and the committee actually ask — *what happened in this year, this quarter, this
month?* — and the picker next to the two statement buttons now answers it, on the office's member
page and on the members' own passbook. Both download whatever period is chosen, at
`/api/members/:id/statement[.xlsx]` and `/api/public/lookup/statement[.xlsx]`.

The API takes any of these, and a request with **none** of them is the whole-book statement,
unchanged:

```
?year=2026                    the whole of 2026 (or to today, if 2026 is still running)
?year=2026&quarter=2          Q2
?year=2026&month=3            March
?range=this-year              this-year · last-year · this-quarter · last-quarter · this-month · last-month
?from=2026-03-01&to=2026-06-30   an explicit pair; `to` alone means "to today"
```

**Why the figures are not a sum of the rows in the period.** A member's money is not what he paid;
it is `openingBalance + paid − required − tea`, where `required` and `tea` accrue automatically for
every week that has *closed* since the books opened (`utils/memberLedger`). Slice the rows to March
and add them up and the total is a number that appears nowhere in the system and that nobody can
reconcile — and a statement whose figures do not add up is worse than no statement, because it will
be argued with. So the period's figures are **differences of two calls to that same engine**, taken
as at the period's two ends (`utils/statementPeriod`):

```
opening (at the start)              = computeMemberLedger(…, now = from).money
closing (at the end)                = computeMemberLedger(…, now = to).money
paid in / weeks that closed / tea   = the differences of the same three figures
```

which turns the reconciliation into an identity rather than an assertion:

```
closing − opening  =  paidIn − required − tea
```

`balanced` checks exactly that, and both renderers print the sum — the PDF as a section headed
"How that adds up", the workbook as rows on the summary sheet above the line *The arithmetic adds
up: Yes*. Where it does not balance, the PDF says **"THESE FIGURES DO NOT RECONCILE. Do not issue
this statement"** in red rather than handing it over as though it did. A statement that is quietly
wrong is the one failure this whole feature is built to avoid.

Four things the period does that are worth knowing:

  * **A period that has not finished is clamped to today, and says so on the statement.** Asking
    for `?year=2027` in June gives you January to today with a printed note, because a closing
    balance for a period that has not happened is a figure that is simply wrong.
  * **Only weeks that have closed are scored**, exactly as in the passbook — so the opening week
    (92, the baseline) and the week still running both come to nothing, and a month's "weeks that
    closed" count is the engine's own, not a count of Thursdays. The tests pin this.
  * **The weeks and the tea always move together** (`tea = weeksClosed × chaiAmount`), which is what
    makes "less the weeks" checkable by eye across a table.
  * **A bad period is a 400 with a sentence, never a file.** `2026-02-31` is caught (the regex
    accepts it; the calendar does not), as are a backwards range, `quarter=9` and `range=forever`.
    The message names what is allowed, because an operator is the one who reads it.

The office's copy is unchanged in the one way that matters: it names the Tea Fund and the member's
own does not, because that money is the Group's and listing it among his contributions would read as
money he paid in. A period statement also lists the months the period touches and only the rows
inside it, drops the "carried forward" summary (its money is not part of the period), and still
prints **money held today** — the question that always follows the period one.

**How the period is tested.** `test/statementPeriod.test.js` covers the resolving (a year, a
quarter, a month, leap Februaries, "last quarter" asked for in January, clamping, and every refusal)
and, more importantly, the reconciliation: the identity above is asserted for a year, a quarter, a
single month, a month with no payments at all, **a single week** (Friday to the following Thursday),
a single day, a period entirely before the cycle opened, and one straddling it.
`test/integration/statements.test.js` then does it for real — through the API, against a real
MongoDB, reading the workbook back out of the response bytes — including that a statement with no
period is still exactly what it always was, that both formats really are the format they claim to
be, and that another member's money cannot appear on one.


98% of this app's usage is a phone on Kenyan mobile data: a 375px Android on 3G, a
5-inch iPhone on a good day of 4G. The following are not preferences — they are the
things that make the difference between the passbook opening and not opening.

**Weight.** The document, JavaScript, CSS and the one font that loads must stay under
about **150 KB gzip** between them. `npm run build && npm run report:bundle` prints the
current figure. Two rules keep it there: anything over ~50 KB is loaded with
`await import()` at the moment it is used (`xlsx`, `docx`, `mammoth`, the Tiptap-based
minute reader), and any new page goes into `App.jsx` as a `lazy()` route. The minute
reader in particular must stay lazy — it is the rich-text editor's schema, and the
members' page must never carry ProseMirror for somebody who came to see a balance.

**Touch.** Every control a finger is meant to hit is at least 44px (`min-h-11`, `h-11`,
`min-h-12` for primary actions). Text links that do something — "Issue fine", "Week by
week", the ledger panel's dismiss — get `inline-flex min-h-11 items-center` rather than
`text-xs`, because a 16px line of text is a 16px target.

**Layers.** One scale, deliberately narrow:
`20` the sticky mobile header · `30` the bottom navigation · `40` the desktop sidebar ·
`50` dialogs and sheets · `60` the "More" menu · `70` toasts.
Anything that covers the page goes through `components/shared/Modal.jsx`, which portals
to `<body>` — a dialog rendered inside a page inherits that page's stacking context, and
a fixed bar rendered after it wins any z-index tie.

**Type.** Nothing below 11px. `text-[10px]` and `text-[9px]` were used for eyebrow
labels and are gone; the bottom navigation's own labels sit at 11px because five
columns of a 320px screen cannot hold "Dashboard" at 12px.

**Forms.** Every field has a real `<label>` (or `aria-label` where a visible label would
duplicate a heading). The 16px font floor for coarse pointers in `src/index.css` is what
stops iOS zooming the page in on focus and never zooming back out — do not remove it.
Dialogs are bottom sheets on a phone (`items-end`, `max-h-[85dvh]`, `overflow-y-auto`)
with their action row pinned, and long forms (`MemberForm`) keep that row `sticky`.

**Failure.** `services/api.js` carries a 20s timeout; `apiMessage()` names a timeout or
a lost connection instead of saying "something went wrong". A screen whose fetch failed
shows `ErrorState` with a **Try again** button rather than an empty list. Error toasts
persist until dismissed and can carry a retry action — `toast(message, 'error', { action: { label, onClick } })`.

**Where things live.** The dashboard is the logging screen: the week's figures, the
member list, and a grouped second navigation (`components/layout/WorkspaceNav.jsx`).
The member list is capped there at eight names — the full list is `/admin/finance` —
because a dashboard is not the place to read through 32 names to reach what is under
them. The admin tooling lives at `/admin/settings`, grouped, with its own rail. When
you add an admin screen, give it a group in `WorkspaceNav` (and a section in
`AdminSettings`), not a card at the foot of the dashboard.

**Two conventions that came out of that.** A navigation row is
`components/shared/NavTile.jsx` — a bordered chip with a chevron, a 44px target and
hover/press/focus states, because a label sitting inside a card reads as a caption
and the one thing on the page that cannot be pressed should not look like the rest of
the page. A screen that is not one of the five bottom-nav destinations opens with
`components/shared/BackLink.jsx`, always pointing at a real parent route rather than
`navigate(-1)`: back that goes wherever you came from is unpredictable after a form
submit or a link somebody sent.

**Figures that cannot be changed by accident.** Finance → Opening balances holds the
member balances, the fund floats and the week cycle — the base every balance in the
system is counted from. Every one of those boxes is read-only until somebody presses
**Unlock to edit** and confirms, the save locks the page again, and **Lock again**
drops anything that was not saved. It is a deliberate two-step because a scroll wheel
over a focused number, or a thumb on the wrong row, is otherwise a silent change to a
member's money. Two things on that page are *not* locked, on purpose: adding a fund
(that is creating something, not changing a figure) and the "whole week collected for
everybody" panel, which has its own preview, confirmation and undo.



**Icons.** `npm run icons` regenerates `public/icon-*.png` from the geometry in
`public/icon.svg` (iOS will not take an SVG apple-touch-icon and Android wants a
maskable one); `prebuild` runs it automatically, and `npm run verify:icons` parses the
output back to check the PNGs are well formed.

