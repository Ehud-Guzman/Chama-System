# Adding a New Role — Checklist

When adding a new user role to the Chama System, follow this checklist to ensure the role is properly integrated throughout the application.

## Backend Files

### 1. **User Model** — `backend/src/models/User.js`
**Purpose:** Define the role as a valid option

**What to change:**
- Add the new role to the `enum` array in the `role` field
- Example: `enum: ['super_admin', 'admin', 'treasurer', 'secretary', 'disciplinary']`

**Code location:**
```javascript
role: { type: String, enum: ['super_admin', 'admin', 'treasurer', 'secretary', 'disciplinary'], default: 'admin' },
```

---

### 2. **Route Files** — `backend/src/routes/`
**Purpose:** Control which roles can access which endpoints

**Files to update (as needed based on permissions):**
- `contributionRoutes.js` — if role can add/manage contributions
- `reportRoutes.js` — if role can view reports
- `expenseRoutes.js` — if role can create/manage expenses
- `fineRoutes.js` — if role can create/manage fines
- `fineTypeRoutes.js` — if role can manage fine types
- `memberRoutes.js` — if role can manage members
- `typeRoutes.js` — if role can manage contribution types
- `settingsRoutes.js` — if role can modify system settings
- `minuteRoutes.js` — if role can manage meeting minutes
- `backupRoutes.js` — if role can access backup/restore
- `memberController.js` → public endpoints — if role affects public API access

**What to change:**
- Update the `requireRole()` middleware to include your new role
- Example: `requireRole('super_admin', 'admin', 'treasurer')`

**Code location in each route:**
```javascript
router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));
```

---

### 3. **Member Controller** — `backend/src/controllers/memberController.js` (if needed)
**Purpose:** Add role-specific logic for member lookups/visibility

**When to update:**
- If the new role should have different visibility of member data
- If the role should see public data differently

---

### 4. **Auth Middleware** — `backend/src/middleware/auth.js` (rarely needed)
**Purpose:** Global role-based logic

**When to update:**
- Only if you need special authentication or authorization logic specific to the new role
- Usually not necessary—use `requireRole()` in individual routes instead

---

## Documentation Files

### 5. **Roles & Permissions** — `ROLES_AND_PERMISSIONS.md`
**Purpose:** Document the new role for developers and users

**What to add:**
- Role name and emoji/icon
- Purpose statement
- List of allowed permissions (✅)
- List of denied permissions (❌)
- When to use this role
- Who the role can manage (if applicable)

**Template:**
```markdown
## 👤 **New Role Name**

**Purpose:** Brief description

**Key Permissions:**
- ✅ Permission 1
- ✅ Permission 2
- ❌ Denied permission 1
- ❌ Denied permission 2

**When to use:** Who should have this role

**Can Manage:** List of roles they can create/manage, or "No one"
```

---

## Frontend Files (if applicable)

### 6. **Role Selectors** — `frontend/src/components/` and `frontend/src/pages/`
**Purpose:** Allow admins to assign the new role

**Files to check:**
- User management components
- Role dropdown/selector components
- Admin panels

**What to change:**
- Add the new role to any role selection lists
- Update role labels and descriptions in UI

---

### 7. **Role-Based UI Components** — `frontend/src/components/`, `frontend/src/pages/`, `frontend/src/context/`
**Purpose:** Show/hide features based on user role

**What to check:**
- Navigation menus (hide/show nav items based on role)
- Dashboard layouts (customize for role)
- Feature access (disable buttons/pages if role doesn't have permission)
- Use context/hooks to check `user.role`

**Example:**
```javascript
{user.role === 'admin' || user.role === 'super_admin' ? (
  <ExpenseButton />
) : null}
```

---

### 8. **Context/Auth Service** — `frontend/src/context/`, `frontend/src/services/`
**Purpose:** Handle role-based business logic in frontend

**What to update:**
- Any role checks in authentication context
- Permission checking utilities
- Role-based feature flags

---

## Testing Checklist

After adding a new role:
- [ ] Create a user with the new role
- [ ] Log in as the new role
- [ ] Verify allowed routes work
- [ ] Verify denied routes return 403 (Forbidden)
- [ ] Check frontend shows/hides features correctly
- [ ] Test all role-specific UI components
- [ ] Verify the role appears in any admin panels
- [ ] Test audit logging captures actions by this role

---

## Summary: Typical Files Modified

**Minimum (for most roles):**
1. `backend/src/models/User.js` ← Always
2. Route files in `backend/src/routes/` ← Based on permissions
3. `ROLES_AND_PERMISSIONS.md` ← Always
4. Frontend role selectors (if admin-facing) ← Usually

**Extended (for complex roles):**
5. `backend/src/controllers/` ← If role-specific logic
6. Frontend components for role-based UI ← If needed
7. `frontend/src/context/` or auth service ← If needed
8. Public API controllers ← If role affects public access

---

## Example: Adding the Treasurer Role

**Files modified:**
1. ✅ `backend/src/models/User.js` — Added `'treasurer'` to enum
2. ✅ `backend/src/routes/contributionRoutes.js` — Added `'treasurer'` to requireRole
3. ✅ `backend/src/routes/reportRoutes.js` — Added `'treasurer'` to requireRole
4. ✅ `ROLES_AND_PERMISSIONS.md` — Added Treasurer section

That's it! The treasurer role works with no other changes needed.
