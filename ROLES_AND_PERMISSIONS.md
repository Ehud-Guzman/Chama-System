# User Roles & Permissions — Chama System

The system has **five staff roles with accounts**, and one kind of user with no account at all:
**the member**, who opens his own record and the members' area with the ID number the office
recorded for him. A member never signs in, never holds a password, and can write exactly one
thing — his verdict on a chapter of the constitution.

**The code is the source of truth for everything below.** It was read out of `backend/src/routes/`
(the `requireRole` lists), `frontend/src/App.jsx` (the route guards), the menus in
`frontend/src/components/layout/`, and the controllers. `USER_INTERACTION_GUIDE.docx` (and its
`.pdf`) describes the same rules for the people who use them, screen by screen.

---

## 🔐 **Super Admin**

**Purpose:** System administrator with full control and account management

**Key Permissions:**
- ✅ Full access to all features
- ✅ Create, deactivate and reactivate **any** account, admins included
- ✅ Reset any account's password and any account's second factor
- ✅ Switch the group's two-factor authentication on or off (Settings → Security)
- ✅ Decide whether a logged payment pays down fines before it counts as contribution
  (`autoSettleFines`, off by default, super admin only)
- ✅ Switch on the second check for members' passbooks (`passbookPhoneCheck`, off by default, super
  admin only): Settings → Passbook access
- ✅ Access all data (contributions, expenses, fines, members, reports)
- ✅ Modify system settings (chama name, logo, vision and mission, weekly tracking start)
- ✅ Create & manage contribution types and fine types
- ✅ Access backup/restore functions, and see and run the scheduled jobs
- ✅ Upload, publish and remove chama documents (title deeds, certificates)
- ✅ View the complete audit trail and export it — including what no other role can read: entries
  about admin, treasurer and super-admin accounts, and about backups, restores and scheduled jobs
- ✅ **Oversight** (top of the audit screen, `GET /api/audit/oversight`): each officer's entries, serious
  entries, amounts cut, money removed and money moved over the last 30 days, and which accounts that
  hold authority lack a second factor or still have their first password
- ✅ **Failed sign-ins** (Oversight, kept 90 days): which accounts and addresses are being tried
- ✅ **Alerts**: an email when someone else cuts an amount, removes money, moves a payment to another
  member, changes a phone number or a role, or when one account or address hits 5 failed sign-ins in
  15 minutes (max 6 an hour; `SECURITY_ALERTS=off` silences them), and a "needs attention" line on the
  dashboard
- ✅ **Verify the trail** (`POST /api/audit/verify`): re-checks the whole hash chain and names the first
  entry that does not add up
- ✅ **Server errors and off-server backups**: every server fault is emailed to the super admin once and listed in the Control Room, and each nightly backup is also kept off the server (see the README)
- ✅ **The Control Room** (`/admin/control`, super admin only on every route behind it —
  `/api/superadmin/*`):
  - **Overview:** system health (database, email, backups, jobs, the audit chain), a worst-first list of
    what needs attention (an overdrawn fund, a failed job, accounts with wrong-password runs, failed
    sign-ins and passbook tries, members with no usable ID), and the group's figures read with no
    role filters
  - **Accounts and sessions:** last sign-in and address, who is here now, sign an account (or everyone
    else) out, **freeze** an account with a reason it is shown, **change a role** (password required;
    ends the account's sessions), and **preview the app as any other role** — read-only, 30 minutes
  - **Maintenance mode:** everyone but you can read and not save, with a message on every screen
  - **Switches:** members' area, fine emails, reminder emails, constitution voting
  - **Close the books through a date:** the office cannot add, change or remove money dated in it
    (contributions, ledger logs, a week collected, expenses, voiding a fine); you can, with a written
    reason that goes in the audit trail beside the change
  - **Repair:** merge two records of one member (money moves, the duplicate is retired), reinstate a
    member who left
  - **Audit powers:** read any entry exactly as stored (whole before/after, chain hash, the address it
    came from), flag it for review, search by address, download the whole trail with hashes
  - **Backups, restore and jobs:** look inside a backup file, restore it (maintenance mode, password and
    the word RESTORE; a safety copy is written first; adds and replaces, never empties), pause or run a
    job, read the run history
  - **Who can do what:** the permission table, generated from the server's own route rules
  - **Danger zone:** clear the rehearsal's money (marks contributions, expenses and fines deleted; keeps
    members, accounts, settings and opening balances; maintenance mode, password and a typed phrase)
- ❌ Cannot deactivate the super admin account itself, and cannot reset its own password from the
  accounts list (that is Settings → My password)
- ❌ Cannot change the week cycle or opening balances from Settings — those live on
  Finance → Setup, deliberately (see the treasurer, below)

**When to use:** Organization leadership, system owner

**Can Manage:** All other roles

---

## 👔 **Admin**

**Purpose:** Day-to-day operations manager for the register, the money and the paperwork

**Key Permissions:**
- ✅ Everything the treasurer can do, and everything the secretary can do
- ✅ Record contributions; create, edit and delete expenses
- ✅ **Loans** (`/admin/loans`): lend to a member from the loan fund, record repayments, take the last one back, cancel a loan made in error; **choose which fund is the loan fund** (the treasurer cannot: it changes how money already paid out of it is counted); set the **spending limit** in Settings
- ✅ **Email a member his statement** as a PDF (his own copy, for the period chosen)
- ✅ Create, settle and void fines (both categories) — all of it in one place, **Fines**
  (a payment is recorded as taken from the member's balance or paid in cash, and only these two
  roles can record one: it can lower what the group holds for a member)
  (`/admin/fines`): the totals, the list filtered owed/cleared/all/voided, issuing a fine to a member
  found by search, recording a payment or voiding a wrong one on the row itself, "who owes what", and
  the group's fines record as a **PDF** or an **Excel** workbook. The dashboard shows what is owed in
  fines beside the week's figures, with one tap into that screen
- ✅ Add, edit and resign members, import a sheet of them, print a statement, keep photographs
- ✅ **Change a member's ID number, phone number or next of kin once the record holds one** — the
  fields the treasurer may only fill in while they are blank (see A member's three guarded fields)
- ✅ Create & manage contribution types and fine types
- ✅ Upload, publish and remove chama documents; write, publish and delete minutes
- ✅ View reports (summary, performance, monthly, weekly, fines) and export them
- ✅ Modify system settings (chama name, logo, vision and mission)
- ✅ View the audit trail and export it — except entries about admin, treasurer and super-admin
  accounts, and about backups, restores and scheduled jobs, which are the super admin's alone
- ✅ Create and manage **Secretary** and **Disciplinary Officer** accounts, including deactivating
  them, resetting their passwords and resetting a lost second factor
- ❌ Cannot create or manage another **Admin** account, or a **Treasurer** account — only the super
  admin can (the API answers 403: *"Only the super admin can create an admin or treasurer
  account"* / *"You can only manage secretary and disciplinary accounts"*)
- ❌ Cannot deactivate the super admin
- ❌ Cannot switch the group's two-factor authentication, or change how payments meet fines
- ❌ Cannot access backup/restore or the scheduled jobs (super admin only)

**When to use:** Chairman, operational lead, whoever runs the office day to day

**Can Manage:** Secretary & Disciplinary Officer accounts only

---

## 🧾 **Treasurer**

**Purpose:** Financial operations specialist — keeps the ledger, the week cycle and the register,
and reports on all of it

**Key Permissions:**
- ✅ **Loans** (`/admin/loans`): lend, record repayments, take the last one back, cancel a loan made in error, and see who is behind. Cannot choose which fund is the loan fund
- ✅ **Email a member his statement** as a PDF, for the period chosen
- ✅ **The finance ledger** (`/admin/finance`): the member list, each member's page, and one
  "Add a log" panel that records weekly contributions, extra payments, tea (Chai) and expenses —
  each with a free-text note for pasting an M-Pesa or bank message
- ✅ **Week cycle and opening balances** (`/admin/finance/setup`): the weekly amount, the tea
  amount, the week number and each member's carry-forward balance
- ✅ **Fund spending** (`/admin/finance/expenses`): every expense on the books, the form that records
  one — where it came from (a fund, or the group's total money for what the group buys as a whole,
  like land), amount, date, what it was for, the voucher or receipt number — plus corrections,
  deletions and the spending report as a **PDF** or an **Excel** workbook. Each expense is deducted
  from the fund it came from, from the **group's total fund** (all the funds added up, spending
  already off them) and from the group's all-time total the moment it is saved, and the screen shows
  the arithmetic (`utils/moneyPosition`, the same function the reports summary uses). A purchase
  recorded against the group's total money charges no fund and moves no member's own balance. A fund
  flagged as a loan fund (`isRecoverable`) is listed but not deducted — that money is still owed back.
- ✅ **The member register**: add, edit and resign members, import a sheet of them, export the
  register, keep member photographs, and print any member's statement
- ✅ Record contributions, and create/edit/delete expenses; create/edit contribution types
- ✅ View reports (summary, performance, monthly, weekly, fines) and export them to Excel
- ✅ View the audit trail and export it
- ✅ View chama documents (title deeds, certificates) — read only, not upload or remove
- ✅ Reminder emails to members who are behind — each member has a weekly budget
  (`Settings.reminderMaxPerWeek`, 1 by default, set by an admin), so the same member is not emailed
  the same thing every few days. The screen shows who has already had this week's reminder and when,
  a member at the limit cannot be ticked, and **Send anyway** exists for a correction — off by
  default, and every use is recorded in the audit trail. The treasurer can read the limit but not
  change it.
- ✅ **Fine emails send themselves** — a payment he logs that clears a member's fine emails the
  member the acknowledgement without anybody pressing anything (that path needs `autoSettleFines`
  switched on, which is the super admin's setting). Issuing a fine emails the member as well, but
  issuing one is the admin's and the super admin's act, not his.
- ✅ **Fill in a member's ID number, phone number or next of kin while the record holds none**
- ❌ **Cannot change a member's ID number, phone number or next of kin once one is on the record**
  (403: *"Only an admin can change a member's …"*). Recording a value that is missing is the
  office's work — most of the register was entered from a name and a phone number, and the office
  chases the members who have no ID — but replacing one is an admin's decision.
- ❌ Cannot create, settle or void fines, or even list the fine types
- ❌ Cannot upload or remove chama documents (view only)
- ❌ Cannot create or change fine types
- ❌ Cannot modify chama settings (name, logo, vision and mission, weekly tracking start)
- ❌ Cannot manage user accounts
- ❌ Cannot access backup/restore or the scheduled jobs
- ❌ Cannot open the minutes screen, though the API does let this role read the minutes (see Note 2)

**Exception worth knowing:** the week-cycle figures (weekly amount, tea amount, week number,
anchor) are changed from `/admin/finance/setup`, which the treasurer *can* use — they are the
person who needs them at go-live — even though `/api/settings` is admin-only. Changing them takes a
General Assembly resolution under §7.1/§7.2 and is audit-logged either way.

**When to use:** Treasurer, financial officer

**Can Manage:** No one

**Lands on:** `/admin/finance` — the ledger is the treasurer's workspace, not the summary
dashboard.

---

## 📋 **Secretary**

**Purpose:** The group's paperwork — the minutes and the document vault — and reading the books

**Key Permissions:**
- ✅ **Write, import, publish and delete meeting minutes** (`/admin/minutes`): a rich-text editor, a
  Word file imported into it, a per-minute switch for what members may read, and a search across
  every word of every minute
- ✅ **Upload, publish and remove chama documents** and manage the headings they are filed under
- ✅ View summary reports (totals, contributions, expenses, fines) and export them
- ✅ View performance reports (member contributions by week), monthly totals, and the weekly
  reconciliation
- ✅ Open one member's own chart **from the performance list** — that figure is served by the reports
  endpoint, so this role never needs the member register
- ✅ View the audit trail and export it
- ✅ Change his own password and enrol his own second factor (My account, below)
- ❌ Cannot modify any money: no contributions, no expenses, no week cycle, no opening balances
- ❌ Cannot open the member register, the ledger or the dashboard
- ❌ Cannot create, settle or void a fine, or manage contribution and fine types
- ❌ Cannot change the group's settings or manage any account
- ❌ Cannot send reminder emails
- ❌ Cannot access backup/restore or the scheduled jobs

**When to use:** Minute keeper, records officer, compliance officer

**Can Manage:** No one

**Lands on:** `/admin/minutes`

---

## ⚖️ **Disciplinary Officer**

**Purpose:** Specialized role for managing fines and member discipline — and nothing else

**Key Permissions:**
- ✅ Create fines for the **disciplinary** category of fine types (record disciplinary actions)
- ✅ See the amount each type carries as a default penalty, and change it for a particular case
- ✅ **Pick a member from the register** — name, registration number and a *masked* phone number
  (`07XX XXX 678`), which is what it takes to tell two people apart. He is not sent the ID number or
  the whole phone number: together they are the key to a member's passbook. Searching by a fragment of
  either finds nobody; typed in full, they still find the member. (See Note 3: nothing else about a
  member reaches him.)
- ✅ Read a member's own fine record in that category, and export it as a PDF or a workbook
- ✅ The group's disciplinary register: totals, by type, by month and by member, with an export
- ✅ Change his own password and enrol his own second factor (My account, below)
- ❌ Cannot settle or void a fine (the office's decision, not his)
- ❌ Cannot see the financial fines, contributions, expenses or any member's balance
- ❌ Cannot view reports, minutes, documents or the audit trail
- ❌ Cannot create or change a fine type
- ❌ Cannot manage members or system settings
- ❌ Cannot access backup/restore or the scheduled jobs

**When to use:** Disciplinary committee member

**Can Manage:** No one

**Lands on:** `/admin/disciplinary`

---

## 🔑 **The member: no account, one key**

There is no member role and no member login. A member opens his own record — his passbook, his
statements, and the members' area holding the documents, the minutes and the constitution — by
typing the `nationalId` the office recorded for him. That ID is his key and nothing else is:
phone numbers are no longer accepted anywhere on the public side.

- The gate takes an **exact match on one active member**. A number nobody holds opens nothing; a
  number two members share is refused with a message asking the treasurer to check the register.
- Lookups are rate-limited (5 a minute for the passbook, 30 for the documents, minutes, the
  constitution and the group totals), and every refusal is logged as a short hash of the number,
  never the number itself.
- **A member with no usable ID on his record cannot get in at all.** The Members screen counts how
  many are in that state, which is the office's worklist.
- His only write is his verdict — approve or reject — on a chapter of the constitution, once per
  chapter, recorded for ever.

---

## 📊 Feature Access Matrix

| Feature | Super Admin | Admin | Treasurer | Secretary | Disciplinary |
|---------|:-----------:|:-----:|:---------:|:---------:|:------------:|
| **Finance ledger** (`/admin/finance`) | R/W | R/W | R/W | ❌ | ❌ |
| **Week cycle & opening balances** | R/W | R/W | R/W | ❌ | ❌ |
| **Contributions** | R/W | R/W | R/W | ❌ | ❌ |
| **Expenses** (`/admin/finance/expenses`) | R/W | R/W | R/W | ❌ | ❌ |
| **Fines** (`/admin/fines`) | R/W | R/W | ❌ | ❌ | C (disciplinary category) |
| **Members** | R/W | R/W | R/W | ❌ | R (four identity fields) |
| **A member's ID / phone / next of kin** | R/W | R/W | C (blank → value only) | ❌ | ❌ |
| **Types** (contribution/fine) | R/W | R/W | C contribution types | ❌ | ❌ |
| **Reports** | R + export | R + export | R + export | R + export | ❌ |
| **Print a report** (Reports → Print a report) | all parts | all parts | all parts | all but the spending | ❌ |
| **Meeting Minutes** | R/W | R/W | R (API only) | R/W | ❌ |
| **Documents** | R/W | R/W | R | R/W | ❌ |
| **Reminders (email)** | R/W | R/W | R/W | ❌ | ❌ |
| **How often a member may be emailed** (Settings → Reminders) | R/W | R/W | ❌ | ❌ | ❌ |
| **Admin Accounts** | R/W | C (secretary/disciplinary) | ❌ | ❌ | ❌ |
| **Settings** | R/W | R/W | ❌ | ❌ | ❌ |
| **Backup/Restore & jobs** | R/W | ❌ | ❌ | ❌ | ❌ |
| **Audit Log** | R + export | R + export | R + export | R + export | ❌ |
| **Own password** (My account) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Own two-factor** (My account) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Two-factor reset** (another account) | ✅ | C (secretary/disciplinary) | ❌ | ❌ | ❌ |
| **Group 2FA switch** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Loans** (`/admin/loans`: lend, record repayments, take back, cancel) | R/W | R/W | R/W | ❌ | ❌ |
| **Choose which fund is the loan fund** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Spending limit** (Settings) | R/W | R/W | ❌ | ❌ | ❌ |
| **Email a member his statement** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Control Room** (health, accounts, locks, restore, preview) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Money in a closed period** | R/W with a reason | R | R | R | ❌ |
| **Read an audit entry raw / its source address** | ✅ | ❌ | ❌ | ❌ | ❌ |

**Legend:** R = Read, W = Write, C = Create Only, R/W = Read & Write, ✅ = Yes, ❌ = No Access

**Two things happen without anybody pressing anything.** A fine emails the member when it is issued
and again when money clears it — a settlement, or a payment logged against his page that pays it down
when `autoSettleFines` is on. That is the fine's own record speaking, so the roles differ only in who
triggers it (a fine: admin and super admin; a payment: admin and treasurer). Neither email can fail
the entry that caused it, a member with no address or with email reminders switched off is skipped,
and a deployment that does not want them sets `FINE_EMAILS=off`. The weekly reminder budget
(Settings → Reminders, one per member per week by default) counts reminders only — a fine email is a
record of something that happened to the member, not a nudge — and who has actually been emailed, in
what words and by whom, is listed on the Reminders screen and available as
`GET /api/notifications/history`, read from the same audit entries the sends write. Spending from a
fund is deducted
from the group's all-time contribution total the moment it is recorded, on every screen, because the
reports summary and the spending screen share one calculation (`utils/moneyPosition`).

---

## 🔑 Account Management Rules

- **The super admin creates any account**, admins included.
- **An admin creates Secretary and Disciplinary Officer accounts** — and those only. Treasurer and
  Admin are the super admin's to hand out, because they are the two roles that carry authority over
  money. The API refuses the rest and says which roles are whose; the Add-account dialog offers an
  admin only the two it may create.
- **The super admin account cannot be deactivated from any screen** — it is the account that can put
  things right — and nobody deactivates his own account or resets his own password from the accounts
  list.
- Passwords are set by an admin at creation (no self-serve signup), and there is **no "forgot
  password" email** by design: an admin resets it.
- Passwords are at least 8 characters with letters and numbers. A reset ends that account's other
  sessions, and so does a password change.
- Accounts can be **deactivated and reactivated, never deleted**.
- Every account change is written to the audit trail under People.

## 🔐 Passwords and two-factor, for every role

**My account** (`/admin/account`) is reachable by every signed-in role, from the "Account" link in
the top bar on a phone or "My account" in the sidebar. It carries the password form and the security
panel — which is the point: before it existed, the password form lived on the dashboard (open to the
three money roles) and the security panel on the Settings page (admin-only), so a treasurer could
not enrol a second factor and a secretary or disciplinary officer could do neither.

**Two-factor authentication is a group decision, not a role.** Once the super admin switches it on
(Settings → Security), every account can and should enrol from My account: the screen shows a key to
type or paste into an authenticator app, and nothing is switched on until a code from that app has
been accepted. Ten recovery codes are issued with it.

- The switch is **off by default**, and off means off: while it is off, nobody can enrol at all.
- **Super admin** may reset any account's second factor (a lost phone) — and is the only role that
  can switch the feature on or off for the group.
- **Admin** may reset a `secretary` or `disciplinary` account's second factor — the same limit that
  applies to creating, deactivating and resetting a password for those roles.
- **Treasurer, secretary and disciplinary officer** manage their own and nobody else's.
- Resetting somebody else's second factor clears it entirely, so the account signs in with a
  password alone until it enrols again — which is why it leaves an audit entry naming who did it and
  for whom. Whoever resets it should change that password in the same sitting.

---

## 📌 Three notes that used to be wrong in this file

1. **The treasurer keeps the member register.** This file used to deny it; the API has always
   allowed it (list, one member, statements, create, edit, resign, import, export, photographs). The
   one part that is not the treasurer's is *replacing* a member's ID number, phone number or next of
   kin once one is on the record — that is an admin's, while recording a missing one is the office's
   work either way (`backend/src/utils/memberCredentials.js`).
2. **The treasurer may read the minutes** through the API, though the menu has no Minutes tab for
   it. The routes say every office role may read them, because the money agreed in a meeting is what
   a treasurer has to account for; writing them is the secretary's, the admin's and the super
   admin's.
3. **The disciplinary officer's member list is narrowed on the server**, not merely on his screen:
   the endpoint returns a name, a phone number, a registration number, the ID and whether the member
   is active — and nothing about his family, his contacts, his notes, his photograph or his money.

---

## 📝 Examples

### Scenario 1: The group appoints a treasurer
- **Create a Treasurer account:** only the super admin can, from Settings → Accounts.
- **Access:** the ledger, the register, reports, reminders, documents (read), the audit trail.

### Scenario 2: Disciplinary committee member must record a fine
- **Create a Disciplinary Officer account** (Admin or Super Admin).
- **Access:** issue a disciplinary-category fine, pick a member from the register, export the
  member's fine record and the group's disciplinary register. Settling stays with the office.

### Scenario 3: Minutes secretary
- **Create a Secretary account** (Admin or Super Admin).
- **Access:** write, import and publish the minutes; upload the group's documents; read and export
  every report and the audit trail. No money, no register, no dashboard.

### Scenario 4: Finance auditor needs to verify records
- **Create a Secretary account** — read-only on the money, with every report and the audit trail
  exportable to a workbook for external audit.

### Scenario 5: A member says his balance is wrong
- **Any role with the register** can open his page and print the same statement his own passbook
  produced; the two are built from the same figures, so there is one document to argue with rather
  than two screens.

---

## 🚨 Best Practices

1. **Minimize Super Admin accounts** — usually only 1–2 people need this, and the account cannot be
   deactivated, so keep its password where the committee can find it.
2. **Use Secretary for audit and verification** — it reads everything and changes nothing but the
   minutes and the documents.
3. **Rotate Disciplinary Officers** — don't give one person permanent fine authority.
4. **Change passwords regularly**, and pair a second-factor reset with a password change.
5. **Turn two-factor on when the committee is ready** — and know that it protects every role now,
   not just the admins, because every role can enrol from My account.
6. **Review the audit trail weekly** — it has its own screen (`/admin/audit`): filter by Money,
   People, Records or Settings, read the flagged entries first, and export the view for a meeting.
7. **Keep the register's IDs complete.** A member without one cannot open his own record, and the
   Members screen counts them so the office can chase them.
