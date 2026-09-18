import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { warmRoute } from '../../services/prefetch';

// The dashboard's second navigation, grouped by what the group actually does.
//
// It exists for two reasons. The main navigation has to stay short — four tabs and
// a "More" sheet on a phone — so it lists destinations without saying what belongs
// with what; and the admin-only screens (identity, fine types, accounts, backup) had
// no navigation entry at all, which is why four screens of forms used to sit at the
// foot of the dashboard, below every member's name.
//
// `roles` mirrors the route guards exactly: anything RoleGuard would refuse does not
// appear here, so the list is never a set of dead ends.
const MONEY_ROLES = ['super_admin', 'admin', 'treasurer'];
const CLERK_ROLES = [...MONEY_ROLES, 'secretary'];

export const WORKSPACE_GROUPS = [
  {
    title: 'Money',
    items: [
      {
        // Not a route: the list is on this page, so the entry scrolls to it rather
        // than navigating somewhere that renders the same thing.
        anchor: '#log-money',
        label: 'Log a payment',
        hint: 'Find the member, then enter it',
        roles: MONEY_ROLES,
      },
      {
        to: '/admin/finance/setup',
        label: 'Opening balances',
        hint: 'The week cycle and what each member holds',
        roles: MONEY_ROLES,
      },
      {
        to: '/admin/reminders',
        label: 'Reminders',
        hint: 'Email whoever is behind',
        roles: MONEY_ROLES,
      },
    ],
  },
  {
    title: 'Records',
    items: [
      {
        to: '/admin/members',
        label: 'Members',
        hint: 'Add, edit, print a statement, resign',
        roles: MONEY_ROLES,
      },
      {
        to: '/admin/reports',
        label: 'Reports',
        hint: 'Summaries, performance, audit trail',
        roles: CLERK_ROLES,
      },
      {
        to: '/admin/documents',
        label: 'Documents',
        hint: 'The group’s papers and their headings',
        roles: CLERK_ROLES,
      },
      {
        to: '/admin/minutes',
        label: 'Minutes',
        hint: 'Write, import and publish meeting records',
        roles: ['super_admin', 'admin', 'secretary'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        to: '/admin/settings',
        label: 'Settings',
        hint: 'Identity, fine types, accounts, backup',
        roles: ['super_admin', 'admin'],
      },
      {
        to: '/admin/disciplinary',
        label: 'Discipline',
        hint: 'Issue a fine, review a member’s record',
        roles: ['super_admin', 'admin', 'disciplinary'],
      },
    ],
  },
];

const ROW =
  'flex min-h-11 flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-2 transition hover:bg-elevation active:bg-elevation';

function WorkspaceItem({ item }) {
  const inner = (
    <>
      <span className="text-sm font-medium text-ink">{item.label}</span>
      {/* The one-line explanation is for the first visit and for the screens nobody
          opens twice a month; on a phone the labels alone carry the meaning. */}
      {item.hint && (
        <span className="hidden text-xs leading-5 text-muted sm:inline">{item.hint}</span>
      )}
    </>
  );

  if (item.anchor) {
    return (
      <a href={item.anchor} className={ROW}>
        {inner}
      </a>
    );
  }

  return (
    <Link
      to={item.to}
      // Warm the destination on intent, exactly like the main navigation: hover on a
      // laptop, pointer-down on a phone.
      onMouseEnter={() => warmRoute(item.to)}
      onPointerDown={() => warmRoute(item.to)}
      className={ROW}
    >
      {inner}
    </Link>
  );
}

export default function WorkspaceNav({ className = '' }) {
  const { user } = useAuth();

  const groups = WORKSPACE_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(user?.role)),
  })).filter((group) => group.items.length > 0);

  // A role with nothing to group (a disciplinary officer, say) gets no panel at
  // all rather than three empty headings.
  if (groups.length === 0) return null;

  return (
    <nav aria-label="Workspace" className={`min-w-0 space-y-2 ${className}`.trim()}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Go to</h2>

      {/* One markup, three shapes: stacked on a phone, three columns once there is
          room, and a single sticky rail beside the ledger on a wide screen. */}
      <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:grid-cols-1">
        {groups.map((group) => (
          <div
            key={group.title}
            className="min-w-0 rounded-xl border border-rule bg-surface p-2 sm:p-3"
          >
            <h3 className="px-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
              {group.title}
            </h3>
            <ul className="mt-1 space-y-0.5">
              {group.items.map((item) => (
                <li key={item.label}>
                  <WorkspaceItem item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
