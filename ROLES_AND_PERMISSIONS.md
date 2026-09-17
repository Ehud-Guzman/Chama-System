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

## � **Treasurer**

**Purpose:** Financial operations specialist focused on contributions and financial reporting

**Key Permissions:**
- ✅ Record contributions
- ✅ View reports (summary, performance, monthly, weekly)
- ✅ Export reports to Excel
- ✅ View audit trail (who did what and when)
- ✅ View chama documents (title deeds, certificates)
- ❌ Cannot create or manage expenses
- ❌ Cannot create, settle, or void fines
- ❌ Cannot upload or remove chama documents
- ❌ Cannot manage member accounts
- ❌ Cannot create or manage contribution types
- ❌ Cannot create or manage fine types
- ❌ Cannot modify system settings
- ❌ Cannot manage user accounts
- ❌ Cannot access backup/restore functions

**When to use:** Treasurer, financial officer

**Can Manage:** No one

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

| Feature | Super Admin | Admin | Secretary | Disciplinary |
|---------|:-----------:|:-----:|:---------:|:----------:|
| **Contributions** | R/W | R/W | R | ❌ |
| **Expenses** | R/W | R/W | R | ❌ |
| **Fines** | R/W | R/W | R | C (create only) |
| **Members** | R/W | R/W | R | R (name/phone only) |
| **Types** (contribution/fine) | R/W | R/W | R | R |
| **Reports** | R | R | R | ❌ |
| **Meeting Minutes** | R/W | R/W | R | ❌ |
| **Admin Accounts** | R/W | C (secretary/disciplinary) | R | ❌ |
| **Settings** | R/W | R/W | ❌ | ❌ |
| **Backup/Restore** | R/W | ❌ | ❌ | ❌ |
| **Audit Log** | R | R | R | ❌ |

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
