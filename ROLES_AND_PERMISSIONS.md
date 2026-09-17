# User Roles & Permissions — Chama System

## Role Hierarchy

The system has 5 user roles with different access levels:

---

## 🔐 **Super Admin**

**Purpose:** System administrator with full control and account management

**Key Permissions:**
- ✅ Full access to all features
- ✅ Create, manage, and deactivate **Admin** accounts
- ✅ Create, manage, and deactivate **Secretary** accounts
- ✅ Create, manage, and deactivate **Disciplinary Officer** accounts
- ✅ Reset locked-out admin passwords
- ✅ Access all data (contributions, expenses, fines, members, reports)
- ✅ Modify system settings
- ✅ Create & manage contribution types
- ✅ Create & manage fine types
- ✅ Access backup/restore functions
- ✅ Upload, publish and remove chama documents (title deeds, certificates)
- ✅ View complete audit trail

**When to use:** Organization leadership, system owner

**Can Manage:** All other admin roles (Admin, Secretary, Disciplinary)

---

## 👔 **Admin**

**Purpose:** Day-to-day operations manager for contributions and finances

**Key Permissions:**
- ✅ Record contributions
- ✅ Create and manage expenses
- ✅ Create, settle, and void fines
- ✅ Manage member accounts
- ✅ Create & manage contribution types
- ✅ Create & manage fine types
- ✅ Upload, publish and remove chama documents (title deeds, certificates)
- ✅ View reports (summary, performance, monthly, weekly)
- ✅ Modify system settings (chama name, default contribution type)
- ✅ View complete audit trail
- ✅ Create and manage **Secretary** accounts
- ✅ Create and manage **Disciplinary Officer** accounts
- ❌ Cannot create or manage other **Admin** accounts (only Super Admin can)
- ❌ Cannot access backup/restore functions (Super Admin only)

**When to use:** Treasurer, secretary, operational lead

**Can Manage:** Secretary & Disciplinary Officer accounts only

---

## 🧾 **Treasurer**

**Purpose:** Financial operations specialist — keeps the ledger and reports on it

**Key Permissions:**
- ✅ **The finance ledger** (`/admin/finance`): the member list, each member's page, and one
  "Add a log" panel that records weekly contributions, extra payments, tea (Chai) and expenses —
  each with a free-text note for pasting an M-Pesa or bank message
- ✅ **Week cycle and opening balances** (`/admin/finance/setup`): the weekly amount, the tea
  amount, the week number and each member's carry-forward balance
- ✅ Record contributions, and create/edit/delete expenses
- ✅ View reports (summary, performance, monthly, weekly)
- ✅ Export reports to Excel
- ✅ View audit trail (who did what and when)
- ✅ View chama documents (title deeds, certificates)
- ❌ Cannot create, settle, or void fines
- ❌ Cannot manage member accounts (add/edit/resign members)
- ❌ Cannot upload or remove chama documents (view only)
- ❌ Cannot manage contribution types or fine types
- ❌ Cannot modify chama settings (name, weekly reconciliation start date)
- ❌ Cannot manage user accounts
- ❌ Cannot access backup/restore functions

**Exception worth knowing:** the week-cycle figures (weekly amount, tea amount, week number) are
changed from `/admin/finance/setup`, which the treasurer *can* use — they are the person who
needs them at go-live — even though `/api/settings` is admin-only. Changing them takes a General
Assembly resolution under §7.1/§7.2 and is audit-logged either way.

**When to use:** Treasurer, financial officer

**Can Manage:** No one

**Lands on:** `/admin/finance` — the ledger is the treasurer's workspace, not the summary
dashboard.

---

## �📋 **Secretary**

**Purpose:** Reporting and documentation (read-only access)

**Key Permissions:**
- ✅ View summary reports (totals, contributions, expenses, fines)
- ✅ View performance reports (member contributions by week)
- ✅ View monthly totals
- ✅ View weekly reconciliation
- ✅ Export reports to Excel
- ✅ View audit trail (who did what and when)
- ✅ Upload, publish and remove chama documents (title deeds, certificates)
- ❌ Cannot modify any data
- ❌ Cannot create contributions, expenses, or fines
- ❌ Cannot manage members or accounts
- ❌ Cannot manage meeting minutes

**When to use:** Minute keeper, reporting assistant, compliance officer

**Can Manage:** No one (read-only user)

---

## ⚖️ **Disciplinary Officer**

**Purpose:** Specialized role for managing fines and member discipline

**Key Permissions:**
- ✅ Create fines (record disciplinary actions)
- ✅ View fine types (offense categories)
- ✅ View member list (name and phone only)
- ✅ View member fines history
- ❌ Cannot settle or void fines (Admin only)
- ❌ Cannot record contributions
- ❌ Cannot manage expenses
- ❌ Cannot create fine types
- ❌ Cannot manage members or system settings
- ❌ Cannot view or manage chama documents
- ❌ Cannot view reports

**When to use:** Disciplinary committee member

**Can Manage:** No one

---

## 📊 Feature Access Matrix

| Feature | Super Admin | Admin | Treasurer | Secretary | Disciplinary |
|---------|:-----------:|:-----:|:---------:|:---------:|:------------:|
| **Finance ledger** (`/admin/finance`) | R/W | R/W | R/W | ❌ | ❌ |
| **Week cycle & opening balances** | R/W | R/W | R/W | ❌ | ❌ |
| **Contributions** | R/W | R/W | R/W | R | ❌ |
| **Expenses** | R/W | R/W | R/W | R | ❌ |
| **Fines** | R/W | R/W | ❌ | R | C (create only) |
| **Members** | R/W | R/W | R | R | R (name/phone only) |
| **Types** (contribution/fine) | R/W | R/W | R | R | R |
| **Reports** | R | R | R | R | ❌ |
| **Meeting Minutes** | R/W | R/W | ❌ | R/W | ❌ |
| **Admin Accounts** | R/W | C (secretary/disciplinary) | ❌ | R | ❌ |
| **Settings** | R/W | R/W | ❌ | ❌ | ❌ |
| **Backup/Restore** | R/W | ❌ | ❌ | ❌ | ❌ |
| **Audit Log** | R | R | R | R | ❌ |

**Legend:** R = Read, W = Write, C = Create Only, R/W = Read & Write, ❌ = No Access

---

## 🔑 Account Management Rules

- **Super Admin** creates all account types
- **Admin** can create Secretary and Disciplinary Officer accounts but NOT other Admins
- Passwords are set by admins at creation (no self-serve signup)
- Accounts can be deactivated/reactivated but not deleted
- Password resets can only be done by Super Admin or Admin
- All account changes are logged in the audit trail

---

## 📝 Examples

### Scenario 1: Treasurer needs a backup
- **Create:** Admin account (Super Admin does this)
- **Access:** Full contributions, expenses, fines, reports

### Scenario 2: Disciplinary committee member must record a fine
- **Create:** Disciplinary Officer account (Admin or Super Admin)
- **Access:** Create fines, view members and fine types only

### Scenario 3: Minutes secretary needs to document meetings
- **Create:** Secretary account (Admin or Super Admin)
- **Access:** View-only, can read reports for meeting context

### Scenario 4: Finance auditor needs to verify records
- **Create:** Secretary account
- **Access:** Read all reports, export to Excel for external audit

---

## 🚨 Best Practices

1. **Minimize Super Admin accounts** — Usually only 1-2 people need this
2. **Use Secretary for audit/verification** — Prevents accidental data changes
3. **Rotate Disciplinary Officers** — Don't give one person permanent fine authority
4. **Change passwords regularly** — Especially for accounts with Admin access
5. **Review audit logs weekly** — Monitor who's doing what
