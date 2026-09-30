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
    (how often ONE member may be emailed is not an environment variable - it is
     Settings -> Reminders, "reminders per member per week", 1 by default, 0 for no limit)

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


ADDENDUM - 22 SEPTEMBER 2026: PERMISSIONS TIGHTENED, ONE SCREEN ADDED
====================================================================

The documentation for the roles was read back against the code, and six places disagreed
with what the system actually does. Five were fixed in the code; the sixth was a note that
had gone stale.

WHAT CHANGED, IN PLAIN ENGLISH

  1. MY ACCOUNT - A NEW SCREEN EVERY ROLE CAN OPEN
     Until now the "change my password" form lived on the dashboard (which only the
     chairman/admin, the treasurer and the super admin can open) and the two-factor
     setup lived on the Settings page (admin only). That meant a treasurer could not
     set up a second factor at all, and a secretary or disciplinary officer could do
     neither that nor change his own password.

     There is now one screen, "My account", reachable by every signed-in role from the
     Account link at the top of a phone screen or the sidebar. Same two things on it:
     your password, and your second factor.

     Why it matters: two-factor authentication is a decision for the whole group. With
     the old arrangement, switching it on would have protected the admins' accounts
     and nobody else's.

  2. A MEMBER'S ID, PHONE NUMBER AND NEXT OF KIN ARE AN ADMIN'S TO CHANGE
     The treasurer keeps the whole register - adding members, editing them, resigning
     them, importing a spreadsheet of them, printing their statements. But those three
     fields are more than a description of a member: the ID is the key to his own
     record and to the members' area, the phone number is how the office reaches him,
     and his next of kin is somebody else's contact details.

     So: a treasurer (or anyone without admin rights) can still FILL IN a field that is
     empty - which is most of what the office is doing, since many members have no ID on
     their record yet - but cannot REPLACE one that is already there. The form locks
     the box and says so, and the server refuses it if the screen is bypassed.

     Where the committee stands: the register's day-to-day work is unchanged for the
     treasurer. The one act that has moved is re-keying a member's door.

  3. THE DISCIPLINARY OFFICER NO LONGER RECEIVES WHOLE MEMBER FILES
     His screen only ever showed a name and a phone number, but the list it reads was
     sending every member's family, next of kin, notes, photograph and balance along
     with it. The server now sends him the four fields his screen uses, and nothing
     else - and stops computing the money figures for him altogether.

  4. "ADD ACCOUNT" NOW OFFERS ONLY WHAT THE SERVER ACCEPTS
     The dialog offered a Treasurer to a plain admin, and the server refused it. Worse,
     a request it did not recognise was quietly treated as "admin", so a Treasurer
     created by the super admin's own dialog was in fact an Admin account with full
     admin rights, while the message on screen said "Treasurer added". That is fixed:
     the super admin can create a treasurer properly, an admin is offered only the
     secretary and disciplinary accounts it may create and manage, and a role the
     endpoint does not serve is named in the refusal instead of being turned into an
     admin.

  5. THE ROLE DOCUMENT WAS CORRECTED
     ROLES_AND_PERMISSIONS.md said the treasurer could not manage member accounts, that
     the secretary could not manage the minutes, and that the disciplinary officer saw
     names and phone numbers only. All three were wrong about the code. It has been
     rewritten against what the system actually does, and it now carries a short list of
     the corrections so nobody re-finds them.

  6. "WHO OWES WHAT" BECAME A LIST YOU CAN WORK
     On Reports -> Fines it was a plain list of names and amounts, with no search and no
     way to change the order, and on the discipline screen it stopped at the ten biggest
     debtors without saying so.

     It now leads with the three figures a meeting asks for - how many members owe, how
     much between them, and how far back the oldest unpaid debt goes - and then gives the
     office what it needs to act on them:

       * search a member by name, registration number or phone number, however the
         number is written (0712 345 678, +254 712 345 678 and 254712345678 all find the
         same person);
       * order the list by most owed, most fines, longest owing, or name;
       * each member's row shows both his registration number and his phone number - the
         line somebody reads out before a telephone call - and the date of his oldest
         unpaid fine;
       * tap a member and his row opens into WHAT FOR: his debt split by fine type,
         biggest line first, each with its own date. Deciding who to chase no longer
         needs a second screen;
       * both screens show the same list, so the office and the disciplinary officer
         cannot describe the same debt differently;
       * the workbook export carries the same columns - phone, owing since, what for -
         and the sheet stays readable.

     The list is capped at 500 names, and when that bites the screen says so instead of
     letting a cut list read as the whole answer.

HOW THIS WAS PROVED

  Backend        242 checks, 180 passing and 0 failing; 62 skip themselves without a
                 database, as they always do. Nine new checks cover the credential rule
                 on its own (utils/memberCredentials), and six more cover the fines
                 report's "who owes what" (fineReport.test.js).
  Rehearsal      62 checks against a real MongoDB across 9 suites, all passing, including
                 the 9 in memberAccess.test.js (the treasurer's access to the register,
                 the refusals, the disciplinary officer's narrowed list, who may create
                 which account) and the 5 in finesReport.test.js (the report's dates and
                 breakdown, the totals, the cap, the discipline screen's own report, and
                 that the workbook's By member sheet stays readable). (Running it first
                 found three mistakes in the new tests themselves - one tried to change an
                 ID it had just recorded, one expected the oldest debtor to also be the
                 biggest, and one used a password the group's own policy rejects - which
                 is the reason it is worth running.)
  Frontend       25 checks, all passing, including 9 new ones for the "who owes what"
                 list's searching and ordering (finesOwed.test.js).
  Build          builds clean, with a new lazily-loaded page for My account. The
                 members' page download is 145.3 KB gzip against the 150 KB limit.
  Data check     check:data passes - no spreadsheet or dump is tracked.

WHAT IS STILL OPEN FOR THE COMMITTEE

  * The treasurer can still ADD and EDIT members and their statements - that was the
    committee's choice in this round (the alternative was to make the register read-only
    for that role). If that is revisited, it is a short change.
  * Two-factor authentication remains switched off. With this change, every role can
    now enrol - so when the committee decides to turn it on, it protects everybody who
    does.
  * The fines list is capped at 500 members on screen. A group this size will never reach
    it; if it ever did, the export carries every member.


ADDENDUM - 24 SEPTEMBER 2026: SPENDING AND FINES GET THEIR OWN DESKS
===================================================================

Three things asked for by the committee, all about money nobody had to press a button
to account for, or had to hunt through three screens to find.

WHAT CHANGED, IN PLAIN ENGLISH

  1. MONEY OUT NOW HAS ITS OWN SCREEN

     Spending used to be recorded from a member's own page - which read as though it were
     something done to him rather than something done with the group's money - and there
     was nowhere to see all of it together, and nothing to hand over when a meeting asked
     "what has the Tea Fund spent this year?".

     Finance -> Expenses (/admin/finance/expenses, for the admin, the treasurer and the
     super admin) is that screen:

       * one form to record an expense: the fund it came from, the amount, the date,
         what it was for, THE VOUCHER OR RECEIPT NUMBER it is backed by, and a note for
         the M-Pesa message or the supplier's name. The fund picker shows each fund's
         balance, leads with the fund holding the most (which is where the group's money
         usually is), and groups the funds nothing has been collected into yet under a
         heading of their own instead of standing beside it as equal choices;
       * every expense on the books, newest first, with its note and the person who
         logged it;
       * corrections (cash spent differs from the estimate) and deletions. A deletion
         returns the money to the fund and stays in the audit trail - this system never
         erases a money record, it only marks it dead;
       * a purchase the group makes AS A WHOLE - land, a building, an asset - is recorded
         against THE GROUP'S TOTAL MONEY instead of a fund: it needs no fund to charge,
         takes nothing off any member's own balance, and comes straight off what the
         group holds. Before this, the only way to record the land was to charge a fund
         that never held the money, which left that fund reading as overdrawn;
       * a date in the future is refused, because that is almost always a mistyped year
         and it would put the spending in a month that has not happened.

  2. SPENDING IS DEDUCTED FROM THE CONTRIBUTIONS, ON EVERY SCREEN

     The reports screen has always subtracted what was spent from the totals. The new
     screen does the same arithmetic - and both now come from one function
     (utils/moneyPosition), so the figure on the spending screen and the figure under the
     reports headline can never drift apart. The screen shows its working: money in (all
     time, including what was carried in from the paper ledger), money spent out of the
     funds, and what the group holds now.

     THE GROUP'S TOTAL FUND IS ONE OF THE FIGURES NOW. The funds are added up into a
     single "Group funds hold" figure, with the spending already off it, so the question a
     meeting actually asks - what does the fund hold? - has one answer instead of a list to
     add up by hand:

       in  -  spent (bought and paid out, gone)  -  out on loan (owed back)  =  holds

     That figure is on the spending screen, beside the reports totals under "What each fund
     holds", and in both documents (the PDF's summary block and the workbook's Summary
     sheet). It deliberately does NOT include the members' brought-forward balances: that
     money is held for them, not owned by the group, and folding it in is how a chama
     convinces itself it is richer than it is. The funds' rows and the total come from the
     same per-fund balances, so they cannot disagree.

     One deliberate exception, carried over from the ledger: a fund marked as a LOAN or
     advance fund is listed but NOT deducted from the group's spending. That money left the
     fund - the fund is genuinely lighter by it, and the group total says so - but it is
     owed back, so counting it as spent would make a healthy group look like a deficit.

     A purchase out of the group's total money is deducted the same way - what the group
     holds comes down by it, on every screen and in both documents - but it is named as
     having come out of the group's money rather than out of a fund, and the funds' own
     figure is left alone. That is the difference between "we bought land" and "we spent
     the tea money": one is the group's own decision with its own money, the other is a
     fund's spending.

  3. THE SPENDING REPORT, AS A DOCUMENT

     Two buttons on the screen, and two endpoints behind them:

       * a PDF page for a meeting: what the group holds, how each fund stands, spending
         by month, and every expense with its voucher number and note;
       * an Excel workbook with the same content in four sheets - Summary, Expenses,
         By fund, By month - each with a total row, for the office to sort and total.

     Both are built from the same rows the screen shows, so the paper and the screen are
     the same record.

  4. A FINE NOW EMAILS THE MEMBER - TWICE

     Members found out about a fine at the next meeting, or did not find out at all, and a
     payment that was never acknowledged is a payment somebody makes again. Two emails now
     send themselves:

       * WHEN A FINE IS ISSUED: the group, the fine, the reason it was given, the amount,
         what is still owed, and what to do if he believes it is wrong;
       * WHEN MONEY CLEARS A FINE: what was paid, which fines it cleared, and what is
         still owed. One email per payment, listing every fine the money touched, rather
         than one per fine - that is how the money arrived and how the member will
         remember it. This covers a settlement recorded by the office AND a weekly payment
         that pays down a fine automatically (when the super admin has switched that
         setting on).

     Two rules make this safe to have automatic:

       * IT CANNOT FAIL THE ENTRY. The fine or the payment is written and audited first;
         the email goes out afterwards and is deliberately not waited on. A mail server
         that is down, or not set up at all, cannot leave the office unable to record a
         fine. Every attempt - sent, skipped or failed - leaves a line in the request log,
         so "were those emails sent?" has an answer on the server.
       * IT IS ON BY DEFAULT, WITH ONE SETTING TO SWITCH IT OFF. That is the opposite of
         the weekly reminder sweep, which stays off until somebody turns it on - and for a
         good reason: the sweep emails the whole membership on its own, while these two are
         triggered by a person deliberately recording or settling a fine on one member's
         record. A committee that does not want them sets FINE_EMAILS=off. Nothing is sent
         at all without a mail configuration, and a member with no address, or who has
         email reminders switched off, is skipped - with the reason recorded.

WHAT THIS LOOKS LIKE ON THE GROUND

  Committee meeting, the treasurer is asked what the tea money has bought:

    1. Finance -> Expenses. Four figures at the top: money in all time, what the group's
       funds hold with the spending already off them, what has been spent (and how much of
       it came out of the funds and how much out of the group's total money), and what the
       group holds now. Below them, each fund with what came in and what left.

       The picker under "Spent from" leads with THE GROUP'S TOTAL MONEY - which is what
       land, a building or any purchase the group makes as a whole comes out of - then the
       funds by what they hold. Recording Ksh 200,000 for land against the group's total
       leaves every fund exactly where it was and takes 200,000 off what the group holds.
    2. "Every expense (23)" - press PDF and hand the page round. Every line carries its
       voucher number, and the M-Pesa message where there was one.
    3. Somebody queries one line. Press Excel instead if they want to sort it, or open
       Audit -> Money and read the entry that recorded it, with who and when.

  A member is fined for arriving late:

    1. The admin records the fine on the member's page, exactly as before.
    2. The member's email that evening: the fine, the amount, the reason, what he owes.
    3. He sends the money. The treasurer logs it; the fine is paid down.
    4. A second email: Ksh X received, this fine cleared, nothing outstanding.

HOW THIS WAS PROVED

  Backend        267 checks, 198 passing and 0 failing; 69 skip themselves without a
                 database, as they always do. Eighteen are new: ten on the spending
                 report (the deduction, the group's funds added up with the spending off
                 them, a purchase out of the group's total money that charges no fund,
                 the loan exception that is listed but not deducted, a fund the
                 ledger no longer lists, the month cut, the workbook sheets, an empty
                 group, and the PDF itself), and eight on the two fine
                 emails (the switch and its default, each reason a member is skipped, in
                 the order that helps the office, the figures and wording of both
                 messages, and that a member's own name or a fine's reason cannot become
                 markup in the email).
  Frontend       29 checks, all passing. Two new screens build clean as their own lazily
                 loaded chunks (Fund spending 13.8 KB / 4.3 KB gzipped, Fines 11.0 KB /
                 3.7 KB gzipped) - a member's page pays nothing for either. The fines desk
                 is UI over endpoints that were already there and already covered: issuing,
                 settling and voiding call the same three API calls the member's own page
                 does, so the two cannot behave differently. Four of the checks are new and
                 cover the menu's grouping (navGroups.test.js): a role sees only what it may
                 open, an empty section is left out rather than shown as a bare heading, and
                 a destination whose section is misspelled or missing still appears instead
                 of silently vanishing from the menu.
  Rehearsal      69 checks against a real MongoDB across 10 suites, all passing -
                 including the 7 new ones in expenses.test.js, which record an expense
                 through the API and check that the fund's balance, the group's total
                 fund and the group's total all move by it, that a correction moves them
                 and a deletion puts them back, that a loan fund is listed, leaves the
                 fund lighter, and is named as owed back rather than spent, that a purchase
                 out of the group's total money (land) leaves every fund untouched and a
                 member's own money untouched while the group's total comes down, that a
                 secretary is refused a read and a write, that tomorrow's date, a nameless
                 group purchase and a personal weekly type are refused, and that the PDF
                 and the workbook come back as real files. The runner sets FINE_EMAILS=off,
                 so a rehearsal on a machine with a working mail configuration emails
                 nobody.
  Data check     check:data passes - no spreadsheet or dump is tracked.

WHAT IS STILL OPEN FOR THE COMMITTEE

  * FINE_EMAILS is on. If the group would rather fines were only discussed face to face,
    set FINE_EMAILS=off on the server, and nothing else changes.
  * Spending has no period filter yet. The report covers everything recorded and splits it
    by month; "the quarter the committee is arguing about" is a later request, if wanted.
  * A receipt can be typed in as a voucher number and pasted in as a note, but a scan of it
    is not attached yet. The Documents screen is where a scan would live.
  * The fines desk collects one fine at a time. Cash handed over at a meeting for several
    members' fines is still recorded member by member (or as one contribution each on the
    ledger). A batch collect, like the one-time week collection on Finance -> Setup, is a
    later change if the committee wants it.

  5. A FINES DESK, INSTEAD OF THREE PLACES TO GO

     Everything a fine needs already existed, and every piece was somewhere else. The debt
     list lived on Reports -> Fines. Issuing a fine, recording a payment and voiding a
     wrong one were reachable only from inside a single member's record - so working a
     meeting's list meant opening a member, going back, opening the next one.

     Fines (/admin/fines, for the admin and the super admin) is one screen that works in
     the order a meeting does:

       * the figures first: still owed, paid off, how many members owe and how far back
         the oldest unpaid fine goes;
       * ISSUE A FINE: search the member, then the same form a member's own page opens -
         type, amount, reason, date. He is emailed as it is recorded;
       * the list, filtered to WHAT IS OWED (where it opens), CLEARED, ALL or VOIDED, with
         every fine's member, type, reason, date and both its issued and outstanding
         figures. PAY and VOID sit on the row the fine is on, and the member's own record
         is one tap away for anything deeper;
       * WHO OWES WHAT beside it - the same working list Reports shows, with the search,
         the ordering and each member's own breakdown of what he owes;
       * the group's fines record as a PDF or a workbook, off the same records as the
         screen.

     Paying a fine from here says the money came in; voiding says the fine should never
     have been issued. The two are deliberately different words, and the screen asks which
     one is meant rather than guessing.

     The dashboard also carries the figure now: "Fines owed" sits beside the week's figures
     with one tap into that screen, so the question "how much are we owed?" is answered
     where the rest of the week is.

  6. THE MENU IS GROUPED, AND SIGN OUT CANNOT BE PUSHED OFF THE SCREEN

     Two small things that came out of using the system rather than reading it.

     The desktop menu had grown to eleven destinations in one flat column, where Members sat
     between Finance and Reports and Discipline sat under Audit. It is now three sections -
     MONEY (Dashboard, Finance, Expenses, Fines, Reminders), RECORDS (Members, Reports,
     Minutes, Docs) and ADMINISTRATION (Audit, Discipline) - the same three words the
     dashboard's own "Go to" panel uses, so the two menus describe the work the same way. A
     role only ever sees the sections it may open: a secretary gets Records and
     Administration, a disciplinary officer gets Administration alone, and no heading is ever
     left standing over an empty list.

     The menu also could not scroll. It is a panel fixed to the height of the window, so once
     the list grew taller than a laptop screen it pushed MY ACCOUNT and SIGN OUT past the
     bottom edge - and scrolling the page could not reach them, because the page scrolls and
     the panel does not. On a 768-pixel-tall laptop the panel wanted about 815 pixels of
     content. The list now scrolls and only the list; the brand at the top and the account
     row with Sign out at the foot stay where they are, at any window height. The phone's
     More sheet had the shape of the same problem and got the same treatment.

     The phone is unchanged: still four tabs and a More sheet, still taking the four busiest
     destinations - Dashboard, Members, Finance, Reports - from the same list.

  7. THE MINUTES SCREEN: THE ANSWER ON THE RIGHT, THE RECORD BY MONTH

     Two complaints from using it, and both were about the same screen.

     FIRST, SEARCHING. The minutes are searched on the server - every word of every meeting,
     because the body of a minute is not in the list the screen holds - and the answer used to
     come back into the narrow column that the search box sits in. Titles, dates and the
     sentence the word was found in were being read in a strip about as wide as a phone.

     The office's minutes screen is two panels now: the record on the left, the minute being
     written or read on the right. A search answer takes the right-hand panel, where a result
     can show the sentence the word was found in with the word marked. Opening a result opens
     that minute for editing exactly as clicking it in the list did, and BACK TO THE SEARCH
     RESULTS returns to the answer with the word still in the box - so a word searched once can
     be followed through every meeting that mentions it without being typed again. A result
     whose only match is the date says so, rather than showing a blank line the reader cannot
     account for.

     SECOND, THE LIST. It had reached the stage where every meeting ever minuted was in one
     column, newest first, and the meeting somebody wanted was found by scrolling and hunting.
     The record is grouped by month now: newest month first, the year printed in the heading so
     "May" is never ambiguous, each month shut until it is opened, and one control to open or
     close the lot. A minute whose date cannot be read is put into a "No date" month at the
     foot of the list rather than disappearing from it.

     Two smaller things came out of the same work. The list now asks for the newest hundred
     minutes instead of the twenty the API sends by default - an office with two years of
     minutes could not reach the older ones at all - and when the office holds more than the
     screen is showing, the list says so rather than letting a truncated list read as the whole
     record. And on a phone a search stands the browse list down, so the answer sits directly
     under the search box instead of below a year of months.

     THE NUMBERS ARE ON THE SCREEN. How many minutes the group has on file now sits above both
     panels - the one figure that does not change while a list is searched or a month is opened,
     and held back until the count is known so that "0 minutes on file" never flashes on the
     way in. The documents panel carries a pill saying how many minutes it is holding, and says
     "100 of 140" rather than "100 minutes" whenever the office holds more than was loaded. A
     search answers with a pill saying how many meetings the word was found in - the whole
     answer to the question, rather than a number to be added up from the rows below.

     HOW THIS WAS PROVED. The grouping is a plain module (frontend/src/utils/minuteGroups.js)
     with seven checks of its own in frontend/test/minuteGroups.test.js: months newest first
     across a year boundary, the zero-padded key that keeps September below December, the month
     names, that nothing is dropped on the way into a group, and that a date nothing can be read
     from lands in "No date" rather than vanishing. The frontend suite is 36 checks, all
     passing. The screen builds clean as its own lazily loaded chunk (19.1 KB / 6.2 KB
     gzipped), so a member's page pays nothing for it, and the members' page is still inside
     its 150 KB budget at 145.5 KB gzipped.

  8. A REMINDER IS SENT ONCE A WEEK, AND THE OFFICE CAN SEE WHO GOT IT

     Two halves of the same complaint, both from the same place: nobody could tell what the
     system had actually said to the members.

     THE FIRST HALF: NOBODY WAS COUNTING. A member who is behind stays behind until he pays.
     The weekly sweep runs every Sunday, and the reminders screen sends whenever somebody has
     it open - so a member who owes week 93 was told so on Sunday, again on Tuesday, and again
     the Sunday after. The third copy of the same message is not a reminder any more; it is the
     reason he stops reading them, and the reason the one that mattered - the week before the
     meeting - is the one nobody read.

     Each member now has a WEEKLY BUDGET, and it belongs to the committee rather than to the
     code: Settings -> Reminders, REMINDERS PER MEMBER PER WEEK, one by default and 0 for no
     limit. It is the same kind of switch as the two-factor one next to it - the group's own
     decision, changeable without a developer, and it stays off the moment somebody sets it
     back.

     The count is not kept in a new table. Every reminder already wrote an entry to the audit
     trail, and that entry is now the only record of the send: the week counted is the group's
     own week (Friday to Thursday, the week the contributions on the same screen belong to),
     and the entries written before a kind was recorded on them are counted too - the
     alternative is a cap that forgets this week's sends on the day it is deployed. A member at
     his limit is skipped, with a reason that names the count, the limit and where to change it,
     never a silent skip.

     ON THE SCREEN, the count is visible before it is enforced. Each row says "Already emailed
     once this week - last 18 Sept", a member at the limit is listed but cannot be ticked, and
     the figure at the top says how much of the week's budget has been spent (14 members, 15
     emails, most get 1). SEND ANYWAY is there for the correction - a wrong figure, a member
     who asked to be told again - and it is a deliberate tick rather than a remembered one,
     because a checkbox that stays on quietly undoes the limit it was added to enforce. When it
     is used, the audit entry says so.

     The weekly sweep obeys the same budget through the same code - one implementation, so an
     email sent by hand and one sent on a Sunday say exactly the same thing and count the same
     way - and its report now says what the limit left alone: how many of the people who are
     behind have already had theirs, how many are still waiting, and why nothing went out on a
     Sunday that looks quiet. The two fine emails are NOT counted: they record something that
     happened to the member rather than nudging him about it, and each carries its own kind in
     the trail.

     THE SECOND HALF: WHO WAS EMAILED? "Was Joseph actually told?" used to be answerable only
     from a line in the request log and an audit entry nobody could read back. The bottom of
     the Reminders screen now lists everything this system has emailed members, newest first -
     the reminders, the fine that was issued, the payment that cleared it - with the address it
     went to, the subject it went out under, the time, and the account that pressed send (or
     "the system" for the sweep and the fine emails). GET /api/notifications/history is the
     same list for anything that wants it, and the full record stays where it always was, in
     Audit trail filtered to "Notification".

     HOW THIS WAS PROVED. The arithmetic is a plain module (backend/src/utils/reminderLog.js)
     with ten checks of its own in backend/test/reminderLog.test.js: one a week for a blank or
     unreadable setting, a fraction or a negative limit refused rather than obeyed, the week
     opening at Friday 00:00 EAT and a Thursday-night send counted against the week that has
     closed rather than the one starting, the audit filter that recognises a reminder including
     the entries written before the kind existed, and the reason that names the count, the
     limit and where to change it. The one-a-week default is pinned in test/models.test.js, and
     /api/notifications/history was added to the list of routes that must refuse a stranger in
     test/http.test.js. The backend suite is 278 checks, none failing; the frontend suite is
     36; the frontend builds clean.


  9. THE MEMBERS' PAGE: HIS RECORD FIRST, AND THE FIGURE HE CAME FOR AT THE TOP

     The page a member opens with his ID number had grown into one column of identical white
     cards. Every block carried the same weight - the hero, his passbook, the members' area, the
     group's totals, the vision statement - and they were stacked in a 1280px column that nothing
     used. Three things were wrong with it, and all three were the same fault seen from different
     angles: the page had no hierarchy, so nothing on it said "this is your record".

       * THE HERO KEPT ITS FULL HEIGHT AFTER THE ANSWER ARRIVED. A member typed his ID and was
         still looking at a 3rem headline and the form he had just used, with his own record
         beginning below the fold. The page's whole reason for existing was the second thing on
         the screen.
       * THE PASSBOOK PUT ITS FACTS ABOVE ITS LEDGER, so on a laptop the actual record - the rows
         - started about 400px down, under a grid of seven statistics the ledger then explained.
       * THE GROUP'S OWN FIGURES LOOKED LIKE PART OF HIS RECORD. Public information (anybody may
         read it) and private information (only he can) were the same card, the same border and
         the same shadow, three blocks apart with a locked documents card between them.

     WHAT THE PAGE IS NOW. Three bands, in the order the questions get asked.

       * WHO THIS IS: the identity band, full width - name, member number, the date he joined.
       * WHERE HE STANDS: the position card (what he holds, the sum that figure is made of, and
         what he owes), then his details, then his statement downloads.
       * WHAT HAPPENED: the ledger, with his fines and his week-by-week schedule under it.

     THE LOOKUP STANDS DOWN ONCE IT HAS DONE ITS JOB. A successful lookup replaces the hero with
     one line - "Record open . Member No. 12345 . ID ....678" - and a CHECK ANOTHER ID button
     that brings the form back with the cursor already in the field. The ID is shown masked to its
     last three digits: the line's job is to say which number is open, and a shared phone or a
     screenshot should not spell out the credential the gate rides on. Pressing it also clears the
     ID that was verified, which locks the members' area again - that gate follows the number it
     checked, and leaving it open behind a member who has moved on to a different record is the one
     thing it must not do.

     HIS PASSBOOK IS A DASHBOARD FROM A LAPTOP SCREEN UP. The position, his details and his
     downloads become a 336px rail down the right-hand side, so the ledger takes the remaining
     width and reaches the top of the screen; the figure he came for sits beside the rows that
     prove it rather than above them. On a phone there is no rail and the order is simply the
     reading order: his name, then what he holds and what he owes, then his details and downloads,
     then the rows. The group's totals and the vision and mission are the last band, behind their
     own rule and their own heading ("The group's figures", with an eyebrow saying who may read
     it), which is what stops them reading as one more panel of his passbook.

     TWO SMALLER THINGS CAME OUT OF THE SAME WORK. The duplicate heading is gone - the hero says
     "Check your contributions" and the form's own "Find your record" heading said it again, so the
     form is now named for screen readers instead of by a heading nobody needed. And the
     "No record found" panel moved out of the hero's two-column grid, where on a wide screen it
     landed under the left-hand column, a screen away from the field that produced it.

     THE POSITION CARD IS THE ONE PIECE OF WORDING WORTH PINNING DOWN, so it is now a plain module
     (frontend/src/utils/passbookPosition.js) with six checks of its own in
     frontend/test/passbookPosition.test.js. The figure at the top is "money held" - carried in,
     plus what he has paid, less what was due - and the card says so; the fallback used when the
     cycle engine has no answer for a member is a DIFFERENT figure ("paid in his own name"), so the
     label changes with it. The checks cover the sum spelled out behind the number, the plural that
     turns "1 week behind" into "3 weeks behind", money owed with no week count to go with it, and
     a missing or unreadable total printing Ksh 0 rather than "Ksh NaN" on somebody's passbook.

     HOW THIS WAS PROVED. The build is clean, the frontend suite is 42 checks and none fails, and
     the members' page still fits the weight budget that governs it: the critical path - document,
     JavaScript, CSS, the one font and the images the page draws - measures 146.2 KB gzip against
     the 150 KB ceiling CI gates on, up 0.6 KB for the new module and markup. No new dependency,
     no new request, and the page's own chunk is still lazy.


ONE WEEK'S MONEY IS NEVER TAKEN OFF A MEMBER'S FIGURE, AND THE GROUP
STOPS CHASING ANYBODY HOLDING ENOUGH
-------------------------------------------------------------------

TWO CHANGES, BOTH ABOUT A MEMBER WHO MISSES A THURSDAY.

1. BEING BEHIND IS SHOWN AS MONEY OWED, NOT AS MONEY TAKEN. The books used to work out a member's
   held figure as "carried in + paid in - what he was expected to have paid - tea". That meant the
   week's 1,400 came off him the moment the week closed, whether or not he had paid it: a member
   holding 1,400 who missed a week read MINUS 100 (1,300 after the tea, less the 1,400 that was
   never collected). The paper ledger never did that - its total column was "Previous + Weekly +
   Extra - Chai" - and the Ksh 1,400 he owes is not a movement of money, it is a debt against the
   next collection. So the figure he holds is now exactly that: carried in + paid in - tea. A
   closed week nobody paid shows beside it as "Ksh 1,400 owed (1 week behind)", and nothing else
   about his page changes: the week is still flagged, the tea is still deducted, and his fines are
   still his own.

   IT HAS ALREADY HAPPENED, SO THE TWO READINGS RECONCILE. The deduction was never stored anywhere
   - it was worked out on the way to the screen - so the whole book moves the moment the rule does,
   and no member's opening balance or payment has to be touched. Every screen and statement that
   needs to tie back to what was printed before now carries the old figure as well: it is the new
   one less every week that has closed, and the server publishes it as `moneyNetOfDues`
   (`money - required`). The treasurer's member page prints the sentence in full; the period
   statement prints the old sum under the new one ("Money at the start + what he paid in - the tea =
   money at the end", with the weeks that closed and what is owed named beneath the total, and the
   PDF prints it as an equation). "The arithmetic adds up" is still checked on every statement, and
   it now proves the new identity instead of the old one.

2. NOBODY HOLDING AT LEAST THE GROUP'S LINE IS TOLD HE IS BEHIND. A member who brought a hundred
   thousand shillings into the cycle and then missed one Thursday is behind on the week-by-week
   count and by that count alone. Settings -> Reminders gains "Leave members alone above this much":
   114,600 measured in week 92, which is the treasurer's own figure, and 0 to switch the rule off.
   At or above the line, a member's closed weeks stop being something he is emailed about. It is
   not a limit the reminders screen can overrule, and it never touches his fines: a fine is
   something he was charged for breaking a rule, and having money in hand is not a defence.

   THE LINE MOVES WITH THE CYCLE, which is the part that makes it work. The weekly contribution is
   added every week after the week the figure was measured in - 114,600 in week 92, 116,000 in week
   93, 117,400 in week 94 - because what it is compared against is what the group expected a member
   to have put in by then. A frozen figure would stop excluding anybody within a fortnight, and
   nobody would notice until the emails started again.

   IT IS COMPARED AGAINST THE MONEY THE GROUP ACTUALLY HOLDS for him (carried in + paid in - tea),
   which is the first change read the other way round: a member's arrears no longer lower the
   figure he is measured by. The reminders screen says, in words, how many names the line took off
   the list, who they are and where to change it, and the weekly sweep names them in its report
   instead of reporting "nobody behind" about a week the ledger says was missed. A batch that has
   one of them in it is skipped with the reason on the row, and the counts are returned separately
   so "held by the money line" can never be misread as a failed send.

FILES

  backend/src/utils/memberLedger.js        the rule: money is carried in + paid in - tea;
                                           `moneyNetOfDues` carries the old figure
  backend/src/utils/statementPeriod.js     the period identity is now paid in - tea
  backend/src/utils/memberStatement.js     the statements relabel the weeks as what was expected and
                                           print what is still owed under the total
  backend/src/utils/reminderLimit.js       NEW - the money line, its growth, and the covered decision
  backend/src/models/Settings.js           reminderMoneyLimit (default 114600), reminderMoneyLimitWeek
  backend/src/controllers/settingsController.js   both fields validated, 0 allowed and meaning off
  backend/src/controllers/notificationController.js  the line applied to the dues, the list and every
                                           batch, and named in the skips
  backend/src/jobs/reminderJob.js          the sweep's report counts and names the members it left out
  frontend/src/utils/passbookPosition.js   the card's sum spelled out without the dues
  frontend/src/components/shared/ReminderSettingsPanel.jsx   the money line, with the week it was
                                           measured in
  frontend/src/pages/Reminders.jsx, MemberDetail.jsx, FinanceMemberLedger.jsx,
  components/ledger/MemberLedgerList.jsx   the labels and the reconciliation sentences

HOW THIS WAS PROVED. The backend suite is 287 checks with 0 failures (69 rehearsal checks skip
themselves with no database, on purpose), including new checks that a closed week nobody paid
leaves the held figure alone, that the old figure is exactly `held - weeks that closed`, and that
the line reads 114,600 in week 92 and 1,400 higher every week after, with 0 switching it off and a
shilling below it still being told. The frontend suite is 43 checks with 0 failures and the
production build is clean.


TWO NUMBERS THAT WERE WRONG, FOUND BY CHECKING THE LIVE BOOKS
------------------------------------------------------------

Both were found the same way: by running the app's own maths against the real database and reading
the answer, rather than by reasoning about the code. Both are fixed, and neither moves a shilling.

1. THE MONEY LINE WAS MEASURED AGAINST THE WRONG FIGURE. The line that decides who is not told he
   is behind is measured against what the group is holding for a member — and what it holds begins
   with what he carried into the cycle. The three queries that load members for the reminders
   screen, the send and the weekly sweep all projected a list of fields that did NOT include
   `openingBalance`, so the engine saw every member as having carried in nothing and measured them
   against what they had paid since week 92 alone. On the live books — where members hold up to
   Ksh 198,840 — the rule was therefore a no-op: the members who were furthest ahead were the ones
   being emailed about a missed week. All three projections now select the field, and
   `computeMemberDues` reads it itself if a caller's projection has forgotten it, so a future
   screen cannot silently disarm the rule the same way. Checked against the real database: the line
   reads 117,400 in week 94 and leaves Harrison Kamau (198,840), Joel Ndungu (173,300), Isaiah
   Maina (154,400), Benard Ngugi (127,200) and Joshua Maina (117,800) alone.

2. A MEMBER WHO HAD PAID EVERYTHING WAS STILL QUOTED AS SHORT. One member paid Ksh 3,000 on 26
   September — the day after the week that had just closed. The money therefore covered the missed
   week and left credit beside it, so his ledger said he owed nothing and his passbook said
   "up to date"; the weekly table, which records what arrived during each week, still marked that
   week as never paid, and the reminders list quoted the weekly table. The result would have been
   an email telling a member who owes nothing that he is "1,400 short". Two questions now live
   side by side and are named differently: `settled` stays the paper ledger's column (was the money
   in by the Thursday — what the KES 50 NILL fine is built on), and `weeksBehind`, with a per-week
   `owed`, is the money: any of it still owing now. The arrears are handed to the weeks
   oldest-first, so the weeks add up to `arrears` to the shilling, and
   `backend/test/memberLedger.test.js` pins both halves — the deadline record and the debt — on the
   ordinary case, the paid-late case, and the part-paid case.

   SUPERSEDED, ONE PART OF IT: the weekly rules were changed again the same day — each closed week
   now carries its own 1,400 and a surplus is never the next week's payment, so the late payment
   above does NOT clear the week he missed (see the last section, "Each week carries its own 1,400").
   What survives from this entry is the naming: `settled` is the paper ledger's column, and what a
   member is *told* he owes is the money.

WHAT CAME OUT OF IT BESIDES THE FIXES: two read-only tools, for a committee that doubts a number
(see the maintenance-scripts table in the README). `node scripts/reportMoneyLine.js` prints every
member's held money, what he owes, his fines, whether he is told about any of it and why.
`node scripts/verifyLedgerFigures.js` recomputes each member the long way and compares it with the
engine, member by member, and prints the totals both ways — on the live books all 31 members
agreed and the figures reconciled exactly (carried in 3,370,830 + paid in 30,350 − tea 3,100 =
3,398,080 held, 23,800 owed). `--rows` lists every shilling logged since the books opened with the
week it belongs to. Neither writes anything, builds an index or creates a Settings row.

FILES

  backend/src/controllers/notificationController.js  the three member projections, the guard in
                                           computeMemberDues, and the late weeks taken from what is
                                           still owed rather than from the deadline
  backend/src/jobs/reminderJob.js          the sweep's own projection, same reason
  backend/src/utils/memberLedger.js        `owed` per week and `weeksBehind` from the money;
                                           `settled`/`shortfall`/the NILL flag untouched
  backend/test/memberLedger.test.js        the paid-late and part-paid cases, and the invariant that
                                           the weeks' owed amounts add up to the arrears
  backend/scripts/reportMoneyLine.js       NEW - read-only: who is told, who the line leaves alone
  backend/scripts/verifyLedgerFigures.js   NEW - read-only: the engine against a plain sum of the
                                           documents, member by member (--rows, --member=)


THE WORD "BEHIND" NOW FOLLOWS THE LINE EVERYWHERE, NOT JUST IN EMAILS
---------------------------------------------------------------------

The money line was built for the reminder emails, and it worked — the members above it stopped being
emailed. But the office screens kept saying "1 week behind" beside a member holding 198,840, because
the line only governed who was emailed and not what the app *said*. A committee reading that has one
question — "which is it?" — so the answer is now the same everywhere.

WHAT CHANGED. The engine reports two readings of the same money:

  arrears / weeksBehind        the record: he missed a closed week and 1,400 of it is unpaid.
  chasedArrears / chasedWeeksBehind   the policy: what the group actually asks him for. Both are 0
                               for a member holding at least the line, and 0 is the whole of it —
                               nothing is written off, and `arrears` is still on every payload.

Every screen that shows the word "behind" reads the chased pair: the finance ledger's row pill, the
members register's card, the member's detail page, the weekly sweep and the reminders list, and the
member's own passbook (whose position card now says "Ahead of the cycle — Ksh 1,400 of a closed week
is not collected yet, and nothing is being asked of you", in the calm tone rather than the red one).
The treasurer's own page still shows the uncollected week and can still log it the moment the member
brings it — what it no longer does is call him behind, and it says why in words: "He is above the
Ksh 117,400 line, so that uncollected week is not chased and he is not told he is behind."

NOTHING LEFT THE TOTALS. The header now prints both halves of what is owed — "owed Ksh 23,800 (of
which Ksh 7,000 is not chased: those members hold more than the group's line)" — so the money the
line takes off the individual rows is still on the page, named, rather than disappearing from the
group's receivable. `totalLedger` is where that split is worked out, from the same per-member figures
the rows are drawn from.

AND THE SAFE DIRECTION FOR A HALF-DEPLOYED APP. A payload from before this change carries no chased
figure, and every screen then falls back to the plain record — a member under the line can never be
shown as fine because a field was missing. That is tested on both sides: the engine
(`backend/test/memberLedger.test.js`, including the line switched off with 0 and holding two hundred
thousand) and the card (`frontend/test/passbookPosition.test.js`, including an older payload with no
chased figure at all).


FILES

  backend/src/utils/weekCycle.js           resolveConfig carries the line's values
  backend/src/utils/memberLedger.js        moneyLimit, coveredByBalance, chasedArrears,
                                           chasedWeeksBehind on the ledger, the list projection and
                                           the header totals (chased / notChased)
  backend/src/controllers/memberController.js  the three hand-mapped payloads
  frontend/src/components/ledger/MemberLedgerList.jsx  the row pill and the header's owed split
  frontend/src/components/members/MemberCards.jsx      the register's "behind" label
  frontend/src/components/public/PassbookCard.jsx      the position card and the "weeks behind" fact
  frontend/src/pages/MemberDetail.jsx · FinanceMemberLedger.jsx  the member's page and the ledger
                                           page: the uncollected week named, not called behind
  frontend/src/utils/passbookPosition.js   aheadText, and upToDate from what is chased


A SURPLUS IS HIS MONEY, NOT "EXTRA SAVED"
------------------------------------------

The 1,400 a week is the *minimum* the cycle asks of a member, not a pot with anything set aside from
it: when a member pays 2,000, the whole 2,000 is his money in the group's hands (that is what the
ledger has always done — the row is kept at its full value and the balance moves by all of it). The
screens, though, kept describing the part above the closed weeks' expectation as "extra saved",
"extra credit" and "the rest is extra saved", which reads as though the money had been split into two
piles: the week's payment and something else. It has not.

So the wording changed wherever it appeared, and nothing else did:

  the row under a member's money   "Ksh 2,000 paid in (his money — the weeks that have closed asked
                                   only Ksh 1,400)"
  the member's page stat           "Extra saved" → "Paid ahead" (more than the weeks that have closed
                                   asked for — all of it is his money)
  the statement                    "Extra saved (paid more than was due)" → "Paid ahead (more than
                                   the weeks that have closed asked for)"
  the week table                   "(covered by earlier extra)" → "(covered by what he paid earlier)"
  the log panel                    "counts as extra saved / extra credit on top" → "is simply more of
                                   his money"

There is no "Extra savings" contribution type in the group's books to go with the old wording (their
types are Weekly Contribution, Chai, and the non-weekly ones: registration, fines, welfare, funds), so
nothing was being diverted anywhere — it was the labels that suggested a split that does not exist.

FILES

  frontend/src/components/ledger/MemberLedgerList.jsx  the row's line under his money
  frontend/src/pages/FinanceMemberLedger.jsx           the stat, the log panel and the week table
  backend/src/utils/memberStatement.js                 the statement's line
  README.md                                            the label list gains "paid ahead"


EACH WEEK CARRIES ITS OWN 1,400 — A SURPLUS IS NEVER NEXT WEEK'S PAYMENT
-----------------------------------------------------------------------

This replaces the credit-carrying rule that shipped a week earlier, and the committee asked for it in
as many words: *"even though he paid 'extra' in one week, the next week it should not depend on that,
so long he has not passed the weekly line he'll be told less by 1,400."*

WHAT WAS WRONG WITH THE OLD RULE. The engine walked the weeks with a running credit: money paid above
one week's requirement was carried forward and settled the next week nobody paid. So a member who paid
2,000 in week 93 and nothing in week 94 owed 800 — his 600 surplus was quietly paying for part of a
week he never paid. That reads as one pot of money against a total, and it is not how the group works
or how the paper ledger was written: the weekly column was what that week collected, and the extra
line was his money.

WHAT IT DOES NOW. Every closed week stands on its own. It asks for the weekly amount (1,400), and what
answers it is what he paid **in that week**:

  paid 2,000 in week 93, nothing in week 94   →  week 93 settled, week 94 short 1,400. He is told
                                                 1,400, and the 600 is his money.
  paid 1,000 in week 93, nothing in week 94   →  week 93 short 400, week 94 short 1,400. Owed 1,800.
  paid 1,400 dated in week 94 (a late week 93) → week 94 settled, week 93 still short 1,400, and the
                                                 §7.5 NILL flag is raised for it.

The arrears are the sum of the per-week shortfalls, so the weeks add up to what he owes to the
shilling. Nothing about the money moved: what he holds is still what he handed over less the tea, and
the totals on the live books are identical to the day before this change (held 3,398,080; the group's
arrears went from 23,800 to 25,200 because a member whose 3,000 arrived the day after a missed week is
now properly short for that week — and he is above the money line, so nothing is asked of him).

WHAT ELSE HAD TO FOLLOW, because the arithmetic promised it:

  - **Catching up is one line per week.** The treasurer's one-tap catch-up used to log the whole
    arrears total against the earliest week and let credit flow forward; it now fills that week's own
    shortfall and moves to the next week when it is logged.
  - **The week table's "(covered by what he paid earlier)"** is gone: with no credit carrying, a week
    is either paid in its own week or it is short.
  - **"Extra saved" / "Paid ahead" / "extra credit" are gone from the words**, and with them the
    surplus's own figure: the member page's fourth stat is now simply *Paid in* (what he has given)
    when he owes nothing, and the row under his money says "Ksh 2,000 paid in (his money — the weeks
    that have closed asked only Ksh 1,400)".
  - **The independent checker changed with it.** `scripts/verifyLedgerFigures.js` re-derives each
    member the long way, week by week, and it now proves the per-week rule: on the live books all 31
    members agree and the totals reconcile (3,370,830 carried in + 30,350 paid − 3,100 tea =
    3,398,080 held, 25,200 owed).

FILES

  backend/src/utils/memberLedger.js       the walk is per week; `arrears` is the sum of the weeks'
                                          shortfalls; `credit` is gone
  backend/src/controllers/notificationController.js  the late weeks are the weeks short, each with
                                          its own shortfall
  backend/src/controllers/memberController.js  the payloads no longer carry `credit`
  backend/src/utils/memberStatement.js    the statement's "paid ahead" line is gone
  frontend/src/pages/FinanceMemberLedger.jsx  catch-up per week; "Paid in" instead of "Paid ahead";
                                          the week table's credit note removed
  frontend/src/components/ledger/MemberLedgerList.jsx  the row states what he gave
  backend/test/memberLedger.test.js       the surplus case, the late case, the part-paid case, and
                                          the invariant that the weeks add up to the arrears
  backend/scripts/verifyLedgerFigures.js  the independent check re-derives the per-week rule


"SHOW THE WORKING" — THE MATHS, ON REQUEST AND NOWHERE ELSE
==========================================================

The ask: a member or the office should be able to see *how* a balance was arrived at — "this day he
had 23,000, then 1,400 came in, then the week's tea came off, then a fine was charged; which of those
got him to what he holds now?" — without that working cluttering the screens that already answer a
dozen other questions.

WHAT IT IS

  - **One closed line on each member screen** ("How this figure was worked out"), which opens into a
    step-by-step walk: the carried-in figure at the opening week, every payment with the week it
    belongs to, the tea each closed week took on its own Thursday, and the fines on a column of their
    own — each step carrying the running figure after it, so a row can be read on its own.
  - **The same arithmetic as the card above it, not a second opinion.** The walk calls
    `computeMemberLedger` itself and carries its `money`, `arrears` and the fines' own total through
    as `closing.*`; `balanced` is the walk's own check that it arrived at the same numbers, and the
    panel prints the closing sum in the card's own words when it did — and says so out loud when it
    did not, rather than quietly showing a second total.
  - **The two rules that make it reconcilable, kept exactly as the engine keeps them.** A closed week
    nobody paid is *never* taken off the money held: it is money that never came in, so it is reported
    at the foot as what is owed ("the week table says which weeks") and is not a step at all. And a
    fine never moves the money held — paying one is not money that went missing — so fines ride the
    walk's own column, "fines owed", ending on the figure the passbook prints as outstanding.
  - **Nothing a member paid is missing from it.** Money the weekly figure does not follow — a group
    fund, tea paid at the desk inside the cycle (already inside the automatic deduction), a personal
    fund outside the weekly cycle — is listed, with no effect on either column and a line saying why.
  - **Hidden until asked, and absent when there is nothing to explain.** Collapsed to a single line at
    the foot of the position card / under the money figure; a record whose walk is one step (nothing
    but "carried in 0") draws nothing at all.

THREE SCREENS, ONE BUILD

  The member's own passbook (`PassbookCard`), the member's record (`MemberDetail`) and the treasurer's
  member page (`FinanceMemberLedger`) each mount the same component; the walk arrives on the payload
  each of them already fetches (`walk`), built from the same annotated rows the ledger above it was
  built from — no second query, no second endpoint, and nothing that can disagree about a figure.

FILES

  backend/src/utils/ledgerWalk.js             NEW - the walk itself: pure, no database, `now` passed in
  backend/src/controllers/ledgerController.js  the treasurer's payload carries `walk` (plus the fines
                                             query behind its column)
  backend/src/controllers/memberController.js  the member's record and the public passbook both carry
                                             `walk`, from the annotated rows each already loads
  frontend/src/components/shared/LedgerWalk.jsx   NEW - the panel: one line closed, the walk open
  frontend/src/components/public/PassbookCard.jsx  mounted under the position card (his own page)
  frontend/src/pages/MemberDetail.jsx         mounted under the money figure (the office's copy)
  frontend/src/pages/FinanceMemberLedger.jsx  mounted under the sentence that states the sum
  backend/test/ledgerWalk.test.js             NEW - 11 cases: the walk closes on the engine's `money`,
                                             `arrears` and fines; a NILL week is not deducted; a fine
                                             steps only the fines column; a fine cleared from a payment
                                             credits the whole cash and names the 400; tea before the
                                             cycle; the roll-up after twelve weeks; rows that move
                                             nothing; the grouped and flat fine shapes
  backend/test/integration/ledger.test.js     the rehearsal now checks both endpoints close on the
                                             figure above them, with a real fine issued and settled in
                                             two payments
  README.md                                   the money-labels list carries the new panel

WHAT IT DOES NOT DO

  - It changes no figure anywhere: `memberLedger`, the statements, the reports and the reminders are
    untouched, and the walk exists only to explain what they already say.
  - It does not print the members' M-Pesa notes twice. The ledger rows on all three screens already
    carry each note verbatim, so the walk keeps only what a row alone cannot say — "Ksh 400 of this
    cleared his fines".

TWO THINGS THE WALK EXPOSED WHILE BEING BUILT (not changed — both need the treasurer's decision)

  1. **A payment that clears a fine credits the money held with the whole cash.** The engine "follows
     cash in" (`utils/memberLedger`), so 1,400 handed over with 400 going to a fine adds 1,400 to the
     member's held money *and* collects 400 of fine income — 1,800 of value from 1,400 of cash. It
     only bites with `Settings.autoSettleFines` switched on (off by default), and it is the one case
     the walk cannot make read as a single equation; the walk mirrors the engine and names the 400 on
     the row. `utils/finesCollected` exists for exactly this money, which is how the two halves are
     reconciled today.
  2. **A personal contribution outside the weekly cycle is not in the money held.** `bucketForType`
     puts any personal type that is not the weekly one (or the retired "Extra") into `other`, and
     `memberLedger` adds `otherPaid` to the payload without counting it in `paid` — so a Welfare
     Contribution of 5,000 (a type seeded as "held as his") moves no member's figure today. The walk
     mirrors that too, and lists the row as "outside the weekly cycle" rather than hiding it.

  Fixing either means moving members' figures, which is a decision about the books rather than
  something to slip into a screen. Both are named here so nobody finds them for the first time on a
  member's phone.


MINUTES ON A PHONE: ONE PANEL AT A TIME
======================================

The complaint: the office's minutes screen is badly broken on a phone. It was — and the reason was
one line of the layout.

WHAT WAS WRONG

  The screen has been two panels since the search work: the record on the left, the minute being
  written or read on the right. On a wide screen that is exactly right. On a phone the two panels
  become one column, in that order — so the minute sat *below* the whole record, which is months of
  meetings, each month holding rows. Tapping a title in the list did select the minute (the row
  turned green) and then left the office where they were, looking at a list, with "now scroll past
  every month you already scrolled past" as the only instruction. The search case had already been
  fixed this way — the list stands down so the answer is under the box — and selection, the far more
  common tap, never was.

WHAT IT IS NOW

  - **The record stands down while a minute is open.** One panel at a time on a phone, both on a wide
    screen. Opening a minute replaces the list, so the tap visibly does something.
  - **The panel comes to the top of the screen itself.** The page gets shorter when the list goes, and
    a browser left to its own devices clamps the scroll somewhere inside a newly-shortened page — the
    office could land halfway down the editor. The panel scrolls itself to the top instead, with
    `scroll-mt-20` so the sticky phone header does not cover it. Never on a wide screen: there nothing
    moved, and a page that jumps for no reason is its own kind of broken.
  - **`← All minutes` is on the panel** (phone only), because the list is no longer beside it to be
    tapped. It goes through the same unsaved-changes question as every other way out of a minute, and
    the search case keeps its own `← Back to the search results`.
  - **Save rides with the writer.** On a phone the Save/Delete row is sticky above the tab bar (64px
    plus the home-indicator inset), instead of sitting below a 384px editor and a wrapping toolbar —
    it was below the fold for the entire time somebody was typing a minute.
  - **Imported Word content cannot stretch the page.** Both panels carry `min-w-0` (a grid item's
    automatic minimum width is its content), and `.minute-editor` now wraps long words and gives a
    pasted table its own horizontal scroll rather than being clipped at the panel's edge. A minute
    imported from Word carries whatever Word put in it — a wide table, a 900px image, a reference
    number nobody broke up — and the editor is one of two columns, so that content used to drag the
    whole screen sideways. It applies to the member's reader as much as the office's editor: both
    render `.minute-editor`, and both are opened on the same phones.

WHAT DID NOT CHANGE

  The two panels on a wide screen, the month grouping, the hundred-minute ask, the counts, the search
  behaviour (term stays in the box, answer takes the right panel), and the members' own minutes view —
  which already swaps its list for the minute it opens, and only gained the wrapping fix.

FILES

  frontend/src/pages/Minutes.jsx                 one panel at a time on a phone; the panel scrolls
                                                itself to the top; `← All minutes`; the Save row
                                                sticky above the tab bar; `min-w-0` on both columns
  frontend/src/components/minutes/minutes.css     `.minute-editor` wraps long words, caps images, and
                                                gives tables their own horizontal scroll
  README.md                                       the minutes-screen paragraph carries the phone
                                                behaviour

HOW IT WAS CHECKED

  The frontend suite (45 checks) passes, the screen still builds as its own lazy chunk (19.8 KB /
  6.5 KB gzipped — a member's page still pays nothing for it), and the critical path is 147.3 KB
  gzipped against the 150 KB budget. The behaviour itself is layout, so it is checked the way layout
  is: at 360px, the three paths are — record → tap a title → the minute on screen with `← All minutes`
  and Save in reach; `New minute` → the editor, list gone; search → the answer under the box, list
  gone, box kept.


THE PAGE COUNT OF A MINUTE: A4, 12PT, COUNTED NOT GUESSED
=========================================================

The ask: how many pages is a minute? The office bills by the page, and a figure it bills by has to be
one somebody can check — a number that says four when the paper says three is an argument, and it is
the treasurer who has to have it.

WHAT THE NUMBER IS

  Each minute carries the number of A4 pages it is at 12pt with one-inch margins — the group's own
  rule, chosen by the treasurer. It is not a word count divided by a constant: the minute is laid out
  at that page size with **pdfkit**, already a backend dependency (the member statements, the fines
  reports and the expense reports are rendered with it), and the count is the page range that layout
  reports. Line breaks are the real line breaks, from the real font metrics, so a minute of bullet
  lists and a minute of prose are both right rather than both approximated.

  On this library: 66 minutes, two at one page, 47 at two, 17 at three — **147 pages in total**, laid
  out in 1.9 seconds.

WHY IT IS COUNTED AT SAVE TIME

  One layout is 10-30ms. A hundred of them — the office's list loads a hundred minutes — would be two
  seconds on every visit, so the count is worked out when a minute is written (`Minute.pages`, saved on
  create and recomputed on every update, because the title, the date and the body are all the
  document) and read off the payload thereafter. `npm run minutes:count-pages` fills in the minutes
  saved before the field existed: a dry run by default that prints every minute and the page
  distribution, `--confirm-write` to save, `--all` to recount the lot (which is what to run if the rule
  ever changes). A minute never counted shows **no figure** rather than "0 pages".

WHY IT AGREES WITH THE PAPER

  A page count only means something if the document it counts is the document somebody prints. The
  Word download was quietly Letter at 11pt in the library's default font — so the screen and the
  printer were two different documents. `frontend/utils/exportDocx` now writes **A4, 12pt, one-inch
  margins, Arial**, and Arial is metrically compatible with the Helvetica the counter measures, so Word
  breaks the lines in the same places and paginates the same way. The heading sizes are pinned in both
  (16pt, 14pt, 13pt) for the same reason. A figure whose rule cannot be stated is a figure somebody
  can argue with, so the rule travels with it: the count carries *"A4 at 12pt, one-inch margins,
  counted from the minute as a document"* as its hover text on every screen.

WHERE IT SHOWS

  - **The office's list** — a pill beside each minute's date, so a month's work can be added up without
    opening anything, and the open minute's header carries it too (it hides while the minute has
    unsaved edits, because the count is of what is stored).
  - **The members' page** — beside each minute in the list and in the minute once opened: a member on a
    data bundle can see that this is a three-page note before he opens it.
  - **Not in the totals above the panels.** That line counts minutes on file, and the panel behind it is
    truncated at a hundred; a page total built from a truncated list would read as the whole library.
    The script's dry run prints the true total instead.

FILES

  backend/src/utils/minutePages.js          NEW - the document and its page count: the layout
                                            (A4/12pt/1in), the HTML block walker (headings, lists,
                                            quotes, pre, rules), and `countMinutePages`
  backend/src/utils/minuteSearch.js         `entityText` exported, so `&amp;` is one character to the
                                            counter as it is to a search
  backend/src/models/Minute.js              `pages` (Number, null = never counted)
  backend/src/controllers/minuteController.js  counted on create and update; `pages` on the office's
                                            and the members' payloads
  backend/src/scripts/countMinutePages.js   NEW - the backfill, dry run by default
  backend/package.json                      `npm run minutes:count-pages`
  backend/test/minutePages.test.js          NEW - 11 checks: an empty minute is one page; ~500 words of
                                            prose is a page; more words never means fewer pages;
                                            headings, lists, quotes and rules take their own room; a
                                            forced line break is a line; entities are one character;
                                            the 200k-character ceiling is a document, not a hang
  frontend/src/utils/exportDocx.js          the Word file is now the page the count counts
  frontend/src/utils/minutePages.js         NEW - "3 pages", and the rule, in one place
  frontend/test/minutePages.test.js         NEW - 5 checks: "1 page" not "1 pages"; no figure for a
                                            minute nobody has counted; a count arriving as text;
                                            nonsense treated as no answer
  frontend/src/components/minutes/MinuteListRow.jsx  the pill on every row, browse and search results
  frontend/src/pages/Minutes.jsx            the count in the open minute's header
  frontend/src/components/public/PublicRecords.jsx   the count in the members' list and reader
  README.md, WHAT-WE-ADDED.md               this

WHAT IT DOES NOT DO

  - It does not put a **total** on a screen. That is the natural next ask — a month heading carrying
    "14 minutes · 38 pages" is the shape of an invoice — and it is a small piece of work once the
    counts are stored, but the office asked for the number of pages, and the script prints the
    library's total today.
  - It does not give the minute a PDF. Everything for one is now in place — `drawMinute` is the whole
    document, and a route streaming it would carry a "Page 2 of 3" footer for free — so a member,
    whose phone cannot open a .docx at all, is one small step from a readable copy that matches the
    bill exactly.
  - It does not charge anything. The figure is there to be billed on; nothing in the app reads it for
    anything else.


AND WHAT REPLACED IT: "THIS WEEK, AND WHO IS STILL TO PAY"
=========================================================

  The slot the chart occupied is now the one question the office opens the reports screen to ask on a
  collection day:

    THIS WEEK — WEEK 95                      Fri 25 Sep → Thu 1 Oct
    Ksh 26,600 of Ksh 43,400
    ██████████████░░░░░░░░░░░░░░░░░░
    17 of 31 members have brought the whole Ksh 1,400 · 4 part-paid · 10 still to pay
    Ksh 16,800 still to come this week
    The week asks Ksh 1,400 from each of the 31 active members (1,400 × 31 = 43,400). What has come
    in is counted from the weekly contributions dated inside the week — tea and the other funds are
    collected alongside it, not instead of it.

  Why this and not another chart: it changes. It reads 0% on a Friday morning and fills through the
  week to the Thursday collection, so a glance at it says what has happened *since last time* — which
  is the thing the twelve bars could never say, because they were all the same height. The count is
  the actionable half: a gap of 16,800 is a figure, "ten members still to pay" is a list of phone
  calls, and it is the same roster the weekly reconciliation names week by week.

  The rule is a pure function with its own checks (`utils/weekProgress`,
  `test/weekProgress.test.js`, 7 of them): a week nobody has paid reads as the whole roster still to
  pay; a part-week reads as a part-week; somebody paying above the week does not make the bar lie; a
  payment from a member who has since left is money but not a member, so it comes off the gap and is
  not counted among the people the week is asking; and the three counts always add up to the roster.

  One more request left the screen with it: the summary used to read `/api/reports/summary` and
  `/api/reports/trend` together (the chart needed the second). It makes one request now — on the app's
  slowest, most-used screen, that is a round trip back.

FILES

  backend/src/utils/weekProgress.js            NEW - the week's arithmetic, and the reasons it is
                                               this and not a chart
  backend/test/weekProgress.test.js            NEW - the 7 checks above
  backend/src/controllers/reportController.js  `/api/reports/summary` carries a `thisWeek` block:
                                               the week's number and dates, what it asked for, what
                                               has come in, how many members are in full / part /
                                               still to pay, and the gap
  frontend/src/components/reports/WeekProgressCard.jsx  NEW - the card: the figure, the bar, the
                                               counts, the gap, and the arithmetic in words
  frontend/src/pages/Reports.jsx               the card at the top of the summary

=====================================

  The summary used to open with "Member contributions — last 12 weeks": a stacked bar per week,
  the dark part what the members paid in and the pale part the funds collected alongside them,
  folded to an 88px strip with an Expand button.

  It showed a row of bars of the same height. Every active member pays the same weekly amount, so
  every week's bar is the same 1,400 × the roster — a chart that says "thirty-one members paid
  1,400" twelve times, in a shape that cannot show the one thing it looked like it was showing
  (which is the weeks somebody *didn't* pay, and those are named week by week in the weekly
  reconciliation, where a name can be read). The user's verdict: "looks kinda useless, what does it
  even show?" — which is the right test for a figure on a screen, and it failed it.

  Removed: the section, the Expand/Hide toggle, the twelve-week trend request. The summary now makes
  one request instead of two and opens straight on the four figures it exists for.

  Kept: `ContributionChart` itself (the member's own twelve-month chart in his sheet, and the
  monthly totals chart on the Reports screen, both of which compare months that genuinely differ),
  and the `GET /api/reports/trend` endpoint, which now has no screen reading it. That endpoint is
  the only thing left of this chart; say the word and it and its route go too.

FILES

  frontend/src/pages/Reports.jsx   the summary's chart section, its toggle, its state and the
                                   /api/reports/trend request are gone
  WHAT-WE-ADDED.md                 this


END OF DOCUMENT
===============










