# Working on this repository

This is a small codebase for a group that keeps its real money in it. The conventions below are
what the existing code already does; they exist so that a change made in a hurry still looks like
the rest of the file when somebody reads it a year later.

## Before you push

```bash
cd backend  && npm test && npm run check:data      # no database needed
cd frontend && npm test && npm run build
```

With a scratch MongoDB running, also `npm run test:integration` in `backend/` — that is the one
that exercises a real backup, a real audit chain and the real job runner. CI runs all of it; run it
locally first if you have touched money, dates or the chain.

## The rules that are not style

1. **`npm run check:data` must stay meaningful.** No spreadsheet, dump or member record goes in the
   tree, ever. If you need test data, generate it in the test. This repository has already had to
   rewrite its history over leaked member data once.
2. **Money is rounded at the model boundary.** Any new amount field uses `moneySetter` and the
   shared `MONEY_MIN`/`MONEY_MAX`. A figure that has been through a division must not reach the
   database unrounded, or a member's arrears becomes `-1.4e-14`.
3. **Anything a member can reach by ID is `no-store`, never cached.** Not by the service worker,
   not by a proxy, not "just briefly".
4. **Audit every write that a person made.** `logAudit` on create/update/delete, with before/after
   snapshots. If a change is worth explaining later, it is worth an entry now; the chain makes the
   entry unalterable afterwards.
5. **A new screen gets a `lazy()` route in `App.jsx`.** The members' page is a phone on Kenyan
   mobile data and the critical path is budgeted at 150 KB gzip — `npm run report:bundle -- --max=150`
   fails the build if it goes over. Anything over ~50 KB loads behind `await import()`.
6. **A job must be runnable by hand.** If it cannot be triggered from `/api/jobs` or an npm script,
   nobody can rehearse it, and a thing nobody can rehearse cannot be known to work.
7. **No new dependency where thirty lines of stdlib will do.** TOTP, the audit chain, the job
   schedule and the CSV/backup encoders are all in this repository for that reason. If you do add
   one, say in the commit message what it replaces.

## Where things go

| Backend | |
| --- | --- |
| `src/models/` | Schemas. Indexes are declared with the reasoning next to them |
| `src/controllers/` | Request handling. Validation, then the work, then the audit entry |
| `src/routes/` | Wiring and role guards, and nothing else |
| `src/utils/` | The pure logic — week maths, money, money reports, the chain, TOTP. Most of the test suite is against these |
| `src/jobs/` | Scheduled work, registered in `jobs/index.js` |
| `src/scripts/` | One-off and maintenance commands. Destructive ones are dry-run by default and back up first |

| Frontend | |
| --- | --- |
| `src/pages/` | One per route |
| `src/components/` | Grouped by area; `shared/` is anything used from more than one page |
| `src/services/` | API access, the ledger cache, the offline outbox |
| `src/utils/` | Pure helpers, tested by `npm test` |

## Commenting

The comments in this codebase explain *why*, and the tests explain *what must stay true*. A comment
that restates the line below it is noise; a comment that records the bug it prevents, or the
decision it closes off, is the most valuable thing in the file. When you fix something subtle, the
comment explaining it is part of the fix.

## Adding a role

See `ADDING_NEW_ROLES_GUIDE.md`. The short version: add it to the `User` enum, add it to the
`requireRole` lists on the routes it needs, add it to `RoleGuard` in `App.jsx`, and add it to
`roleHome()` so it lands somewhere it can actually use.
