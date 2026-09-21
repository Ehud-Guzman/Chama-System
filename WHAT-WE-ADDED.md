CHAMA SYSTEM - WHAT WAS ADDED
=============================

A plain-English record of everything added to the system, in the order it was
built. It is written for two readers: whoever maintains the code, and the
committee that has to be told what changed. Nothing here needs a developer to
explain it.

Read the section headings first, then dip into what you need. Every section says
what the thing does, why it matters, how to use it, and how it was proved to work.


SUMMARY OF WHAT CHANGED
-----------------------

Five things were built, plus the supporting work that makes them safe in
production.

  1. Two-factor authentication for admin accounts. A code from an authenticator
     app is now needed at sign-in, so a stolen or guessed password is no longer
     enough on its own to reach the books.

     IT IS SWITCHED OFF BY DEFAULT. Nothing changes until the super admin turns it
     on, from Settings -> Security. It can be turned off again just as easily, at
     any time, by the same person. See section 1.

  2. A tamper-evident audit trail. Every audit entry now carries the fingerprint
     of the entry before it, so an edited, deleted or inserted entry is visible
     rather than silent. There is a command to check it.

  3. Scheduled jobs: a nightly backup, a weekly audit check, and a weekly reminder
     sweep. These are the things nobody remembers to do by hand. The backup is the
     important one - until now, a backup happened only if somebody opened the
     Backup screen and pressed download.

  4. The finance ledger works with no phone signal. An entry that fails because
     there is no network is kept and sent when the signal returns, instead of
     being lost.

  5. Statements can cover a period: this year, last year, a quarter, a month, or
     any pair of dates. "His 2026 statement" is now something the office can print
     and hand over.

Supporting work: frontend tests (there were none), a Docker setup so the project
runs the same everywhere, CI checks that fail a build rather than whisper, and
documentation.


THE NUMBERS
-----------

  Backend test suite             159 checks, all passing, 0 failures. Without a
                                 database, 28 of them skip themselves on purpose
                                 and the rest still pass.
  Backend rehearsal suite        34 checks against a real MongoDB, all passing:
                                 money paths 6, audit chain and jobs 14,
                                 statements 6, two-factor switch 8.
  Frontend test suite            6 checks, all passing. There were zero before.
  Frontend build                 builds clean.
  Members' page download size    129.8 KB gzip, against a 150 KB limit that is now
                                 enforced by CI.
  Member data check              clean - no spreadsheet or dump in the repository.

Two real bugs were found by the new tests. They are described in section 11.

SECTIONS
--------
  1  Two-factor authentication for admin accounts
  2  A tamper-evident audit trail
  3  Scheduled jobs (backup, audit check, reminder sweep)
  4  The ledger works with no phone signal
  5  Statements for a period
  6  Testing
  7  Running it anywhere: Docker
  8  Checks that fail a build
  9  New settings (environment variables)
  10 New commands (shortcuts)
  11 Two real bugs the new tests found
  12 Documentation added
  13 Not done, and why
  14 Where the new files live
  15 The short version, for a committee


1. TWO-FACTOR AUTHENTICATION FOR ADMIN ACCOUNTS
===============================================

IS IT ON? THE MASTER SWITCH
---------------------------
Off. Two-factor authentication is built and ready, but it is **switched off for the
group by default**, and nothing about signing in changes until somebody turns it on.

Who can turn it on and off: the SUPER ADMIN only, in Settings -> Security. There is
one button: "Turn two-factor authentication ON for the group", which becomes "Turn
... OFF for the group" once it is on. It can be flipped as often as needed.

What "off" means, exactly:

  - Nobody is asked for a code at sign-in. Not even an account that had already
    set it up - "off" has to mean off, or the switch is decoration.
  - Nobody can enrol: the Security panel will not offer it, and the API refuses
    with a sentence saying who can turn it on.
  - An account that had enrolled keeps its setup. Nothing is deleted, so turning
    the switch back on restores exactly the state it was in. The panel tells the
    super admin how many accounts are affected, before the button is pressed.
  - An account that wants out can still turn its own second factor off, even while
    the group has it off. "Off" must not trap anybody.
  - If the switch is flipped while somebody is half-way through signing in, their
    code is refused with "Two-factor authentication has been switched off. Please
    sign in with your password." - rather than a confusing "wrong code".

The recommendation: leave it off until the committee has decided who will use it and
has checked that those people have the app installed, then turn it on.

What it is
----------
When it is switched on, an admin who turns it on for his own account signs in with
his password AND a six-digit code from an authenticator app on his phone - Google
Authenticator, Authy, 1Password, Microsoft Authenticator, Aegis, any of them. The
code changes every 30 seconds.

Why it matters
--------------
An admin account can move a member's money, and without it the only thing between a
password and the books is the password. A password can be read over a shoulder,
guessed, or reused from an older leak. A code that changes every 30 seconds cannot
be reused by whoever learns it.

How to use it
-------------
1. The super admin turns the switch on: Settings -> Security -> "Turn two-factor
   authentication ON for the group".

2. An admin signs in, goes to Settings -> Security, and presses "Turn on two-factor
   authentication". The screen shows a setup key to type into the authenticator app,
   and then asks for the six-digit code the app shows. Nothing is switched on until
   that code verifies, so an admin who starts the setup and gets distracted is not
   locked out of his own account.

3. The screen then shows ten recovery codes, once. These are the way in if the phone is
   lost or broken. They are single use, and they must be written down and kept
   somewhere other than the phone, because the system keeps only a fingerprint of
   them and cannot read them back later. There is a button to issue a fresh set once
   they are used up.

   The setup key is shown as one run of characters with a Copy button, and it is
   deliberately NOT grouped into fours: Google Authenticator rejects a space in its key
   box with "key value has illegal character", so a key displayed with spaces cannot be
   typed in by anyone reading it off the screen. Copy it rather than selecting it by
   hand, and note that the otpauth:// link is only for apps that offer "add from a link"
   (1Password, Bitwarden) — Google Authenticator and Authy take the key and nothing else.

Turning the second factor off for your own account, or issuing new recovery codes,
needs your password AND a live code. Either one alone is something a thief holding
the phone already has.

If an admin loses his phone entirely, the super admin can clear his second factor
from the accounts panel. That leaves the loudest entry the audit trail takes, and
whoever does it should change that password at the same time.

Why there is no QR code
-----------------------
Every "scan this" screen on the web sends the account's secret key to some
third-party service, so that the service can draw a picture of it. That secret IS
the security of the account. So the key is shown as text, grouped in fours, with a
copy button, and the app is set up by typing or pasting it. Every authenticator app
supports that.

How it was built (for a developer)
----------------------------------
The algorithm is RFC 4226 and RFC 6238, written using only Node's built-in crypto.
No third-party package was added. It is tested against the published test numbers
from those two documents, which is the only way to know a code works in Google
Authenticator and not merely in our own code.

The sign-in is two steps. A correct password returns a five-minute "challenge"
which is NOT a session - the rest of the API refuses it. This matters: a challenge
that also worked as a session would make the second step decorative.

A code already used once cannot be used again. The accepted 30-second slot is
recorded on the account, so a code somebody read over a shoulder is not still good
for the remaining twenty seconds.

Files     backend/src/utils/totp.js                    new
          backend/src/models/User.js                   two-factor fields
          backend/src/controllers/authController.js    the flows
          backend/src/routes/authRoutes.js             the endpoints
          backend/src/middleware/auth.js               refuses a challenge as a session
          backend/src/middleware/rateLimiter.js        two new limits
          frontend/src/pages/AdminLogin.jsx            two-step sign-in
          frontend/src/components/shared/TwoFactorPanel.jsx   new
          frontend/src/context/AuthContext.jsx
          frontend/src/pages/AdminSettings.jsx         new Security section

Tests     backend/test/totp.test.js - 14 checks, including the published RFC test
          numbers, replay prevention, and recovery codes.


2. A TAMPER-EVIDENT AUDIT TRAIL
===============================

What it is
----------
The audit trail already recorded who changed what and when. Now each entry also
carries the fingerprint (a SHA-256 hash) of the entry before it. Entries written
before this existed have no fingerprint and are left alone, because inventing one
for history nobody can honestly recompute would be a lie.

Why it matters
--------------
The trail is a set of records in a database, and anyone who can edit a record can
edit an entry, or delete one, and leave a trail that reads perfectly while being
false. The collection was append-only by convention, but a convention is not a
control, and the person most motivated to break it is exactly the person the trail
exists to watch.

With the chain, editing any field of any entry, deleting one, or inserting one
breaks every fingerprint after it. The trail cannot be quietly rewritten, only
visibly broken.

How to use it
-------------
Run this whenever you want to know:

    npm run verify:audit --prefix backend

It reads the whole trail and prints either "Intact", with the number of entries
checked and the chain's fingerprint (the "head"), or the first entry that does not
add up and what is wrong with it. It never writes anything, and its exit code is
the answer, so it can be run on a schedule or by CI.

The head is the important part. The chain cannot detect entries removed from the
END - a shortened trail is perfect in itself. So the weekly audit job (section 3)
emails the head out. A head received or written down a month ago is what proves
nothing has been dropped since.

Two honest limits, written into the code rather than left implied:

  - A chain cannot catch entries removed from the end. The recorded head covers
    that, if it is kept somewhere outside the database.
  - It is not a signature. Somebody who rewrites every entry from the break onward,
    and recomputes all the fingerprints, defeats it. Keeping the head somewhere the
    operator cannot reach is what closes that gap.

What it does NOT do
-------------------
It never refuses the payment or edit being recorded. If the trail cannot be
written, that is logged and the operation carries on, because refusing a member's
payment because the audit write failed would be the tail wagging the dog.

Two entries written at the same instant are handled: the second re-reads the end of
the chain and tries again, so the chain can never fork.

Files     backend/src/utils/auditChain.js             new
          backend/src/models/AuditLog.js              three chain fields, one unique index
          backend/src/utils/auditLogger.js            chains every write
          backend/src/scripts/verifyAuditChain.js     new

Tests     backend/test/auditChain.test.js - 12 checks, most of them tampering: an
          edited entry, a deleted entry, a reordered pair, a forged insertion, and
          entries removed from the end.
          Plus 14 checks in test/integration/maintenance.test.js, which edit a
          stored document behind the API's back in a real database and confirm it
          is caught.


3. SCHEDULED JOBS (BACKUP, AUDIT CHECK, REMINDER SWEEP)
=======================================================

What it is
----------
Three jobs that run on a timetable, without anybody pressing anything:

  nightly-backup    every night at 02:00 East African time. Writes the whole
                    database to a backup file, and keeps the newest 14.

  audit-check       every Saturday at 04:00. Checks the audit chain (section 2),
                    records the result, and emails the chain's fingerprint.

  reminder-sweep    every Sunday at 18:00. Works out which members are behind and
                    reports it. It only EMAILS them if that is switched on
                    deliberately.

Why it matters
--------------
Everything in this system has always waited for somebody to press something, which
is right for the books and wrong for a backup. The real answer to "how old is our
most recent backup?" used to be "whenever somebody last remembered to download
one". This is the one safety net that protects against the database itself being
gone, rather than against a mistake.

How to use it
-------------
Nothing to do day to day: it runs by itself. To see what it has been doing, a super
admin can open:

    GET /api/jobs

which lists each job, when it runs next, its last five runs with what each one did,
and the backup files actually on disk - read from the disk, not from the notes,
because the question is whether the files are really there.

To run one by hand, either

    POST /api/jobs/nightly-backup/run

or from the command line:

    npm run job:backup --prefix backend
    npm run job:audit --prefix backend
    npm run job:reminders --prefix backend

Both go through exactly the same code as the timer, so "run it now" is a real
rehearsal of the schedule rather than a second implementation of it.

IMPORTANT - where backups go
----------------------------
The default folder is backend/data/backups, which is ignored by git for the same
reason the other dumps are: it carries real names, phone numbers and balances.

On a host with a temporary disk (Render, Railway) that folder does NOT survive a
deploy. BACKUP_DIR must be pointed at permanent storage, or the folder copied off
the host. A backup that lives only on the machine it is backing up is not a backup.
See section 15 - this is the one item that needs a decision.

Four design decisions worth knowing
-----------------------------------
  - A job runs once, even if two copies of the app are running. A "lease" is kept
    in the database, so a deploy that briefly has two instances cannot take the
    nightly backup twice. The lease expires, so a process killed mid-job does not
    stop the job happening ever again.

  - A failing job is recorded, and never takes the app down. The absence of a
    backup is the thing being guarded against, and an absence is invisible unless
    something records that the job ran.

  - Times are East African time, a fixed +3, the same calendar the week engine
    uses. "02:00" has to mean 2am in the office.

  - The reminder sweep reports before it sends. It works out who is behind every
    week and shows it; emailing the membership is switched on separately with
    REMINDER_SWEEP_SEND=true, by the people whose names go on the message. A deploy
    must never start writing to members on its own.

Schedules are written the way a person says them, and can be changed without a code
change: daily@02:00, weekly@fri@03:00, monthly@1@04:00.

Files     backend/src/jobs/backupJob.js                new
          backend/src/jobs/auditJob.js                 new
          backend/src/jobs/reminderJob.js              new
          backend/src/jobs/index.js                    new - the timer and the lease
          backend/src/models/JobRun.js                 new
          backend/src/models/JobLock.js                new
          backend/src/utils/jobSchedule.js             new - the timetable arithmetic
          backend/src/utils/systemActor.js             new - who a job is credited to
          backend/src/utils/backup.js                  new - one backup format
          backend/src/controllers/jobController.js     new
          backend/src/routes/jobRoutes.js              new
          backend/src/scripts/runJob.js                new
          backend/src/app.js                           starts the jobs, stops them cleanly
          backend/src/controllers/backupController.js  now shares the one format
          backend/src/controllers/notificationController.js  shares the reminder send

Tests     backend/test/jobSchedule.test.js - 10 checks on the timetable, including
          a monthly schedule in a month that has no 31st.
          Plus 14 checks in test/integration/maintenance.test.js: the lease, a job
          that fails, the real backup file written and read back, retention, and
          the audit job reporting a broken trail.


4. THE LEDGER WORKS WITH NO PHONE SIGNAL
========================================

What it is
----------
Two pieces. First, a "service worker": a small file the browser keeps, which caches
the app itself so the page OPENS at all on a bad cell instead of showing the
browser's "no connection" page. Second, an "outbox": a ledger entry that fails
because there is no network is kept on the phone and sent automatically when the
signal comes back.

Why it matters
--------------
The treasurer collects on a Thursday evening, in a hall, on a phone, on a cell that
has given up. Until now every one of those attempts ended in "No connection. Check
your data or Wi-Fi and try again." - and the figure he had just read out of a
member's hand went nowhere. This keeps it instead.

How to use it
-------------
Nothing to learn. If a save cannot reach the server, the screen says "No signal -
kept, and it will be sent when you are back online", and the banner at the top of
the page says how many entries are waiting. They are sent by themselves as soon as
the phone has signal again, or on the next visit.

The banner's message changed for this reason. It used to say "Anything you send now
will not be saved", which was true and is not any more. Keeping that message would
have pushed the treasurer into typing a payment in twice - exactly the double
entry this feature exists to prevent.

Why it is safe to keep an entry and send it later
-------------------------------------------------
Because the API was already built for it. Every contribution carries a hidden
"client request id" which the database refuses to store twice, so a payment that is
sent twice - or sent again after the phone was reloaded - resolves to the SAME
payment rather than creating a second one.

That is also why this is switched on per request, deliberately. Silently keeping a
failed save is only acceptable where the API already treats a repeat as the same
write. It is switched on for the ledger, which is where the money is typed in, and
nowhere else.

Three rules that keep it honest
-------------------------------
  - It never skips ahead. If the first waiting entry cannot be sent, the ones
    behind it wait. A member's later payment must not land before his earlier one,
    or his statement reads as though the second came first.

  - A refusal is not retried. If the server understood the entry and said no, it is
    thrown away and REPORTED - the banner says "could not be saved and will not be
    retried", with the reason. Retrying something that can never succeed would hide
    the real problem behind it forever. A "this already went through" answer is
    reported as "already went through", not as a failure.

  - After a queued save, the screen uses a NEW id for the next entry. If it reused
    the old one, the API would treat the treasurer's next, different payment as a
    duplicate of the queued one and silently drop it. That is the single way an
    outbox could lose money instead of saving it.

What is NOT cached
------------------
Nothing under /api is ever cached by the service worker - not the ledger, and above
all not the ID-gated documents, minutes or constitution. Those are marked "do not
store" by the API, and a cache that kept a copy anyway would leave a member's papers
sitting on a shared phone after the page was closed.

The service worker is switched on in production only, because one that serves the
app from a cache fights the development hot-reload. To test it: build, then preview.

Files     frontend/src/services/offlineQueue.js              new - the outbox
          frontend/public/sw.js                              new - the service worker
          frontend/src/main.jsx                              registers it, sends the outbox
          frontend/src/services/api.js                       queues a marked request
          frontend/src/components/shared/OfflineBanner.jsx    now says what is waiting
          frontend/src/pages/FinanceMemberLedger.jsx          marks the ledger save queueable


5. STATEMENTS FOR A PERIOD
==========================

What it is
----------
Both statements - the office's copy and the member's own - can now cover a chosen
period instead of always covering everything:

    Everything (to date)   the default, unchanged
    This year / Last year
    This quarter / Last quarter
    This month / Last month
    Choose dates...        any pair of dates

Members often ask "what have I paid this year?", and the committee asks the same
question at an AGM. The old statement answered "everything, with the last twelve
months summarised", which is a different question.

For the period chosen, the statement now shows:

  - Money at the start of the period
  - Plus what he paid in during it
  - Less the weeks that closed in it
  - Less tea
  - Money at the end of the period
  - Money held today (the question that always follows the period one)

Plus only the rows, months, funds and fines that fall inside the period.

How to use it
-------------
Admin: Members, open a member, and use the "Statement period" box next to the
Statement PDF and Statement Excel buttons. Whatever is chosen there is what both
buttons download.

Member: the same box appears on his own passbook, above his two statement buttons,
so he can download his own year without asking the office.

The API accepts any of these, and a request with NONE of them is the whole-book
statement, exactly as it always was:

    ?year=2026                        the whole of 2026, or to today if 2026 is
                                      still running
    ?year=2026&quarter=2              Q2
    ?year=2026&month=3                March
    ?range=this-year                  also last-year, this-quarter, last-quarter,
                                      this-month, last-month
    ?from=2026-03-01&to=2026-06-30    any pair; "to" alone means "to today"

The single most important design decision
-----------------------------------------
A member's money is not the sum of what he paid. It is:

    carried in + paid in - the weeks that have closed - tea

where "the weeks that have closed" and the tea accrue automatically, week by week,
from the day the books opened. So if we had simply added up the rows that fell
inside the period, the total would be a number that appears nowhere in the system
and that nobody could reconcile on paper.

Instead, the period's figures are the DIFFERENCE between two calls to the very same
engine that produces the passbook - one taken at the start of the period, one at the
end. That turns the arithmetic into something that must be true:

    money at the end - money at the start  =  paid in - weeks closed - tea

The system checks that sum and prints it. If it does not add up, the PDF says so in
red:

    "THESE FIGURES DO NOT RECONCILE. Do not issue this statement - report it to
     whoever maintains the system."

and the workbook says "The arithmetic adds up: No". A statement that is quietly
wrong is the one failure this whole feature is built to avoid, because it would be
taken to a meeting and argued over.

Four details worth knowing
--------------------------
  - A period that has not finished is shortened to today, and the statement says so
    on its face. Asking for 2027 in June gives you January to today with a printed
    note, because a closing balance for a period that has not happened would simply
    be wrong.

  - Only weeks that have CLOSED are counted, exactly as in the passbook. The opening
    week (week 92) and the week still running both count for nothing.

  - The weeks and the tea always move together - one week's tea for each week
    counted - which is what makes "less the weeks" checkable by eye.

  - A period that cannot be understood is refused with a plain sentence rather than
    producing a file. 2026-02-31 is refused (the shape is right, the calendar is
    not), as are a backwards range, quarter 9, and nonsense words. The message names
    what is allowed, because an operator is the one who reads it.

What stayed the same
--------------------
The office's copy still names the Tea Fund and the member's own copy does not,
because that money belongs to the Group - listing it among his contributions would
read as money he paid in. A period statement also drops the "carried forward" line,
because that money is not part of the period, and still prints "money held today".

Files     backend/src/utils/statementPeriod.js                     new
          backend/src/utils/memberStatement.js                     period figures and sheets
          backend/src/utils/memberStatementPdf.js                  the period on the page
          backend/src/controllers/memberController.js              all four endpoints
          frontend/src/utils/statementPeriod.js                    new
          frontend/src/components/shared/StatementPeriodPicker.jsx new
          frontend/src/pages/MemberDetail.jsx                      the office's picker
          frontend/src/components/public/PassbookCard.jsx          the member's picker

Tests     backend/test/statementPeriod.test.js - 13 checks. The important ones prove
          the sum above holds for: a year, a quarter, a single month, a month with no
          payments at all, ONE WEEK (Friday to the following Thursday), a single day,
          a period entirely before the books opened, and a period straddling that
          opening.
          backend/test/integration/statements.test.js - 6 checks through the real API
          and a real database: both files really are a PDF and a spreadsheet, the
          workbook's figures reconcile, a month/quarter/year each cover the right
          months, a bad period is refused, a member can download his own and only his
          own, and a statement with no period is still exactly what it always was.


6. TESTING
==========

The frontend had NO tests at all. It now has a test command, using Node's own test
runner - no new package was added:

    npm test --prefix frontend

It covers the logic that is pure and therefore cheap to test: money and date
formatting, the national ID rules (so an ID is judged the same way in the browser as
at the gate), the password rule, the WhatsApp and email links, and the statement
period query. The screens themselves are still untested - that needs a browser
environment and is a separate decision - but everything that decides what an admin
is TOLD now has a test, and that is where a false statement would live.

The backend suite grew from 82 checks to 159. New files:

    backend/test/totp.test.js                       14 checks
    backend/test/auditChain.test.js                 12 checks
    backend/test/jobSchedule.test.js                10 checks
    backend/test/statementPeriod.test.js            13 checks
    backend/test/integration/maintenance.test.js    14 checks (real database)
    backend/test/integration/statements.test.js      6 checks (real database)
    backend/test/integration/twoFactor.test.js       8 checks (real database)

The rehearsal suite now runs EVERY file in test/integration rather than one
hard-coded file, so a new one is picked up just by adding it. Run it with:

    npm run test:integration --prefix backend

It needs a scratch MongoDB:

    docker run -d --name chama-rehearsal -p 27017:27017 mongo:7

or, with the new Docker setup described in section 7, "docker compose up -d mongo".


7. RUNNING IT ANYWHERE: DOCKER
==============================

Before this, the setup instructions asked whoever was installing to run a particular
docker command by hand for the database, which is fine until somebody runs it twice
or attaches the wrong folder.

Now, from the project folder:

    docker compose up -d mongo      just the database
    docker compose up --build       the database and the API
    docker compose run --rm api npm run test:integration

There is also a backend/Dockerfile, so the API can be built and run as a container
with the same Node version CI uses (22), running as a non-privileged user, with a
health check and a clean shutdown.

One important detail: backend/.dockerignore keeps backend/data OUT of the image. That
folder is where the dumps, spreadsheets and backups live, and an image is a file that
gets pushed, pulled and kept - exactly the wrong place for the register.


8. CHECKS THAT FAIL A BUILD
===========================

Continuous integration now runs, on every push:

  backend    the member-data check (no spreadsheet or dump may be tracked)
             the test suite
             the test suite again with coverage reported
             the rehearsal suite against a real MongoDB
             a dependency audit

  frontend   the frontend test suite
             a check that the icons are well formed
             the build
             a check on the download size of the members' page

The size check is new, and it is a real gate: the members' page must stay under
150 KB gzip, because most people open it on a phone on Kenyan mobile data. Before
this, the 150 KB was a note in the README that nothing enforced. Run it yourself:

    npm run report:bundle -- --max=150 --prefix frontend

It prints the size of everything a first-time visitor downloads, and fails if it is
over the line.

The audit-trail check from section 2 is also available to CI:

    npm run verify:audit --prefix backend


9. NEW SETTINGS (ENVIRONMENT VARIABLES)
=======================================

All of these are optional, all have sensible defaults, and all are documented in
backend/.env.example. None is needed to keep the system working as it did.

One switch is NOT an environment variable, because it is the committee's decision rather
than a deployment's: **two-factor authentication** is turned on and off by the super admin
in Settings -> Security. It is OFF by default. It is stored with the group's other settings
and every change to it is written to the audit trail, like any other change to Settings.

Two-factor
    TWO_FACTOR_RATE_LIMIT_MAX        code attempts per challenge (default 10)

Scheduled jobs
    JOBS_ENABLED                     "false" switches the jobs off (default on)
    JOB_BACKUP_SCHEDULE              default daily@02:00
    JOB_AUDIT_SCHEDULE               default weekly@sat@04:00
    JOB_REMINDER_SCHEDULE            default weekly@sun@18:00

Backups
    BACKUP_DIR                       where backups are written. On most hosts the
                                     default folder is temporary, so set this
    BACKUP_RETENTION                 how many files to keep (default 14)

Audit trail
    AUDIT_RETENTION_DAYS             blank or 0 keeps everything (the default)
    AUDIT_HEAD_EMAIL                 where the weekly fingerprint is emailed

Reminders
    REMINDER_SWEEP_SEND              "true" lets the sweep email members (off by default)
    REMINDER_SWEEP_MAX               most members one sweep will email (default 200)

Audit attribution
    SYSTEM_ACTOR_EMAIL               which account automatic writes are credited to


10. NEW COMMANDS (SHORTCUTS)
============================

In backend/
    npm run verify:audit             check the audit trail has not been altered
    npm run job:backup               run the nightly backup now
    npm run job:audit                run the audit check now
    npm run job:reminders            work out who is behind (and email, if enabled)

In frontend/
    npm test                         the frontend tests
    npm run report:bundle -- --max=150   the download size, and fail if over


11. TWO REAL BUGS THE NEW TESTS FOUND
=====================================

Both were in the new backup job, both were silent, and both are now fixed and covered
by tests. They are worth recording because of what they say about testing.

BUG 1: two backups taken in the same second overwrote each other.
The backup file is named after the date and time, to the second. Pressing "run now"
while the scheduled run was finishing landed in the same second, and the second file
replaced the first. That is the worst kind of loss: a backup you believed you had.
Fixed by never reusing an existing name - a counter is added instead.

BUG 2: the rule that deletes old backups never deleted anything.
The rule matches file names to decide what counts as "a backup of ours". The first
version of that pattern expected a letter "T" in the name that the name generator
never produces, so it matched nothing, so old backups accumulated forever - and the
failure was invisible, because "delete nothing" looks exactly like "there was nothing
to delete". Fixed, and the pattern is now written out explicitly with a comment
explaining why it is written that way.

Neither bug was in the money paths. Both were found by writing down what should be
true and then checking it, which is the only reason they are in this document instead
of in the group's backups folder.


12. DOCUMENTATION ADDED
=======================

  README.md                  new sections: the two-factor step, the audit chain, the
                             scheduled jobs, the offline ledger, the statement period,
                             and the new settings.

  CONTRIBUTING.md            new. The rules that are not style: no member data in the
                             tree, money rounded at the model boundary, nothing about
                             a member cached, every write audited, new screens loaded
                             on demand, every job runnable by hand.

  ROLES_AND_PERMISSIONS.md   the second-factor rules per role, and the new rows in the
                             feature table.

  backend/.env.example       every new setting, with why it exists.

  WHAT-WE-ADDED.md           this document.


13. NOT DONE, AND WHY
=====================

Written down so nobody wonders whether something was forgotten.

  M-Pesa integration         NOT NEEDED. The group does not take payments through the
                             system, so nothing was built for it.

  Loans and credit           The biggest remaining gap. The group's own ledger
                             already has a "refunds-and-loans" fund, but there is no
                             loan record, no interest, no repayment schedule and no
                             guarantors. This is a real piece of work, not a small
                             one.

  A print view of a statement  The statement downloads as a PDF and is printed from
                             there. A paper-sized page in the browser would be nicer,
                             but it matters less now that a period can be chosen.

  All members' statements at once  One workbook holding every member's statement, for
                             an audit or the committee. Would reuse the same work.

  Emailing a statement       Sending a member his own statement as an attachment. The
                             mail system is already in place for reminders.

  Error monitoring           Nothing reports an error to anybody outside the host's own
                             log today.

  SMS / WhatsApp sending     Reminders go by email, and WhatsApp is a link the admin
                             presses himself. In this context email is the least
                             likely channel to be read, so this matters more than it
                             looks.

  Kiswahili translation      Everything is in English.

  Year-end share-out         Working out each member's share of the funds at the end
                             of a year. Done on paper today.

  Meeting attendance, quorum Minutes have no attendance list, so a decision cannot be
                             tied to whether enough members were present.

  Money as whole cents       Amounts are held to two decimal places, which is what the
                             shilling needs. Worth revisiting only if loans with
                             interest are ever added.

  Splitting the largest files Several screens and two of the backend modules are 800
                             to 1,000 lines long. They work; they are just long.


14. WHERE THE NEW FILES LIVE
============================

New backend files
    src/utils/totp.js                     the authenticator codes
    src/utils/auditChain.js               the audit fingerprint chain
    src/utils/jobSchedule.js              when a job runs next
    src/utils/backup.js                   one implementation of the backup format
    src/utils/statementPeriod.js          choosing a period, computing its figures
    src/utils/systemActor.js              who an automatic action is credited to
    src/jobs/backupJob.js                 the nightly backup
    src/jobs/auditJob.js                  the weekly audit check
    src/jobs/reminderJob.js               the weekly reminder sweep
    src/jobs/index.js                     the timer, and the lease
    src/models/JobRun.js                  what each run did
    src/models/JobLock.js                 the lease that stops double runs
    src/controllers/jobController.js      seeing and running the jobs
    src/routes/jobRoutes.js               /api/jobs
    src/scripts/verifyAuditChain.js       npm run verify:audit
    src/scripts/runJob.js                 run one job by hand

New backend tests
    test/totp.test.js
    test/auditChain.test.js
    test/jobSchedule.test.js
    test/statementPeriod.test.js
    test/integration/maintenance.test.js
    test/integration/statements.test.js
    test/integration/twoFactor.test.js

New frontend files
    src/components/shared/TwoFactorPanel.jsx          Settings, Security
    src/components/shared/StatementPeriodPicker.jsx   the period box
    src/services/offlineQueue.js                      the outbox
    src/utils/statementPeriod.js                      the period query
    public/sw.js                                      the service worker
    test/utils.test.js                                the first frontend tests

New project files
    backend/Dockerfile               the API as a container
    backend/.dockerignore            keeps member data out of the image
    docker-compose.yml               database and API, one command
    CONTRIBUTING.md                  how to work on this
    WHAT-WE-ADDED.md                 this document


15. THE SHORT VERSION, FOR A COMMITTEE
======================================

If you only read one paragraph:

Admin accounts CAN require a code from a phone as well as a password, but it is
switched OFF: the super admin turns it on when the committee decides to use it, and
can turn it off again at any time. The audit trail can no longer be altered without it
being detectable, and it is checked every week automatically. The database backs itself
up every night without anybody remembering to do it, and keeps two weeks of copies.
The ledger can be used where there is no phone signal, and sends what was typed in as
soon as the signal returns. And a member's statement can now be printed for any period
- this year, a quarter, a month, or any two dates - with the arithmetic shown on the
statement so it can be checked by hand.

Two things were found and fixed along the way: backups taken in the same second could
overwrite each other, and the rule that was meant to delete old backups was matching
no files at all, so nothing was ever deleted. Both are fixed and now have tests.
Neither affected any member's money.

ONE ITEM NEEDS A DECISION - TWO, IN FACT:

1. Two-factor authentication is switched off. It is built and tested; say the word and
   the super admin can turn it on from Settings -> Security. See section 1.

2. The nightly backup is written to a folder that is TEMPORARY on the hosting service,
   so it does not survive a redeploy. It must be pointed at permanent storage, or
   copied off the host - see section 3. Until that is done, the backups exist but are
   not durable.


END OF DOCUMENT
===============








