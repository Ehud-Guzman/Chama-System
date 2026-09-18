import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

import ChangePasswordForm from '../components/shared/ChangePasswordForm';
import MemberLedgerList from '../components/ledger/MemberLedgerList';
import WorkspaceNav from '../components/layout/WorkspaceNav';

// How many names the dashboard opens with. The full list is /admin/finance — the
// same component without a cap — so a dashboard that shows everybody is not adding
// information, only distance between the person and everything else on the page.
const PREVIEW = 8;

// The dashboard is the logging screen, and it is also the page you land on after
// signing in, so it carries the map of everything else in one grouped panel rather
// than four screens of forms below the member list.
//
// The header is MemberLedgerList's own header, worded as a greeting: the week's
// figures, this week's dates, and then the list — no second title card stacked above
// it saying the same thing. The admin tooling lives at /admin/settings.
export default function AdminDashboard() {
  const { user } = useAuth();
  const isTreasurer = user?.role === 'treasurer';
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);

  const firstName = user?.name?.split(' ')[0] || 'Admin';

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start xl:gap-6">
        <div className="min-w-0">
          <MemberLedgerList
            showHeader
            eyebrow="Dashboard"
            heading={`Hello, ${firstName}`}
            hint={
              isTreasurer
                ? 'Tap a member to log contributions, tea or an expense.'
                : 'Tap a member to log money. Everything else is grouped under Go to.'
            }
            limit={PREVIEW}
            moreHref="/admin/finance"
            defaultSort="arrears"
            action={
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/admin/finance/setup"
                  className="min-h-11 rounded-lg border border-rule bg-surface px-4 text-sm font-medium leading-[2.75rem]"
                >
                  Opening balances
                </Link>
                {/* The tools are one tap from the top of the page: an admin should
                    never have to scroll past the members to reach them. */}
                {isAdmin && (
                  <Link
                    to="/admin/settings"
                    className="min-h-11 rounded-lg border border-rule bg-surface px-4 text-sm font-medium leading-[2.75rem]"
                  >
                    Settings
                  </Link>
                )}
              </div>
            }
          />
        </div>

        {/* The second navigation. Below the list on a phone, a sticky rail beside it
            once there is room for one. */}
        <WorkspaceNav className="xl:sticky xl:top-6" />
      </div>

      {/* Everybody can change their own password; it needs no grouping, so it stays
          here for the roles that have no settings page. */}
      {!isAdmin && <ChangePasswordForm />}
    </div>
  );
}
