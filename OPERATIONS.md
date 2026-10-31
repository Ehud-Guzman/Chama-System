# Running the Chama System day to day

A short guide for the person who looks after the system. It adds to the README (which is the full reference) and
says nothing the README contradicts. Every command here was run against this system's code on 2026-10-31, with a real
backup restored into a scratch database.

**The golden rules**

1. Anything that only *reads* is safe to run at any time. Anything that *writes* shows a dry run first.
2. The live database address (the "string") is typed into one command and never saved in a file, a message or a
   commit. Anybody who has seen it can change the books: change the password after you share it.
3. A figure that looks wrong is the member's problem the moment he sees it. Check first, then fix.

---

## 1. The Monday check (2 minutes, read-only)

In the `backend` folder:

```
MONGO_URI="<the live string>" npm run books:check
```

It prints plain lines marked `ok`, `WARN` or `FAIL` and writes nothing. It checks that every member's figures hang
together and the totals add up, that no payment is counted twice or belongs to nobody, that the audit trail is whole,
that a backup has been taken, and that the security settings are what the group meant.

`WARN` means a person has to decide something. `FAIL` means something is wrong: read the line and stop.

Also read-only: `npm run verify:audit` (the full audit check; it prints the "chain head": write it down, with the
date, somewhere outside the computer. It is the only thing that later proves nothing was removed from the end of the
trail).

---

## 2. Backups (the part most easily forgotten)

On Render's free plan the app sleeps, and a sleeping app has no timer, so the 02:00 backup mostly does **not** run by
itself. The system is built for that: you take the backup **by hand**, and it goes to private storage off the server
(Cloudinary, the newest 14 kept).

**To take one:** sign in as the super admin, Control Room, Backups, **Run now** on `nightly-backup`. Do it after any
day money was recorded, and before anything risky (a restore, a clear, a merge). The Control Room warns when the newest
copy is more than three days old.

**Also download one now and then** (Control Room, Backups, download). A free Atlas database has no backups of its own, so
these copies are the group's only protection against losing it. The file holds members' details: keep it private.

**If you would rather it happened by itself,** the README (item 3 under "Running on Render's free tier") describes
`JOBS_CRON_TOKEN`: set a long secret on Render and have an outside timer call `GET /api/cron/tick` once a day with the
header `X-Cron-Token`. A single daily call wakes the app for about 15 minutes, which is roughly 10 of Render's 750 free
hours a month. The README recommends against it only because *frequent* pinging spends the free hours. It is the
group's decision; until it is made, the manual routine above is the backup.

The Monday check reports a backup that has never been recorded as a `FAIL`.

### Proving a backup works (a rehearsal, safe)

Never restore over the live database to find out. Instead, with Docker running, in the project folder:

1. Start a scratch database: `docker run -d --rm --name chama-scratch -p 27018:27017 mongo:7`.
2. Dry run, which writes nothing:
   `node src/scripts/restoreBackup.js "C:\path\backup.json" --target="mongodb://127.0.0.1:27018/chama-scratch?directConnection=true"`
3. Add `--confirm-write` to restore into that scratch database, then
   `MONGO_URI="mongodb://127.0.0.1:27018/chama-scratch?directConnection=true" npm run verify:audit` must say **Intact**.
   Look at a member or two against the paper book.

A **real recovery onto the live database** is the same command with the live string as `--target` and **both**
`--replace` and `--replace-live`. It empties each collection first. Take a fresh backup of the broken state first, and
have a second person read the steps with you.

---

## 3. The weekly audit check

It verifies that nobody has edited the audit trail. On a sleeping host it only runs when the app happens to be awake on
the schedule, and on this group's live system it is **paused** (Control Room, Backups, restore and jobs). Run it by hand
instead: `MONGO_URI="<live>" npm run verify:audit`, monthly, and write the chain head down.

---

## 4. Changing the database password

Do this in this order, at a quiet hour, because the app cannot reach the database for a minute or so.

1. Atlas, Database Access, edit the database user, Edit Password, Autogenerate Secure Password, **copy it**, but do not
   save yet. Prefer a password of letters and digits (anything with `@ : /` must be URL-encoded in the address).
2. Render, the service, Environment: edit `MONGO_URI`, replace only the password part, save (it redeploys).
3. Atlas: Update User.
4. Check `https://<the-api>/api/health` shows `"db":"connected"`.

Do it after anyone else has seen the string. Better still, use a database user that can reach **only this group's
database**, not the whole cluster.

---

## 5. Shipping the paid `redesign`

The new look and the printed-paper polish live on the `redesign` branch, kept off `main` and off GitHub until the group
pays. `REDESIGN.md` says what is on it and `REDESIGN_SHIPPING_GUIDE.pdf` has the step-by-step. Around it:

1. Take a backup first (section 2) and run `npm run books:check`; note the totals.
2. Merge `main` into `redesign`, run `npm test`, `npm run test:integration` and the frontend `npm test` and
   `npm run build`.
3. Ship as the guide says, wait for the deploy, open the site, and run `npm run books:check` again: the totals must be
   the same (the redesign changes no figure).

If anything is wrong, the guide's rollback restores the previous version. The data is not touched by either.
