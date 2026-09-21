import { useAuth } from '../context/AuthContext';
import ChamaSettingsForm from '../components/shared/ChamaSettingsForm';
import ChangePasswordForm from '../components/shared/ChangePasswordForm';
import TwoFactorPanel from '../components/shared/TwoFactorPanel';
import AddAdminForm from '../components/shared/AddAdminForm';
import BackupPanel from '../components/shared/BackupPanel';
import BackLink from '../components/shared/BackLink';
import NavTile from '../components/shared/NavTile';
import FineTypeManager from '../components/contributions/FineTypeManager';

// The admin tooling, off the logging screen and grouped.
//
// These five cards used to sit at the foot of the dashboard, below every member's
// name: four screens down on a phone, under nothing that named them, in an order
// nobody had chosen. Each one gets a name, an anchor and a place here, roughly in
// the order a new committee needs them — what the group is called, what an
// infraction costs, who can sign in, your own password, and a copy of everything.
//
// The labels in the rail are deliberately the words on the cards themselves, so a
// jump lands on the heading it promised.
const SECTIONS = [
  {
    id: 'identity',
    label: 'Chama identity',
    hint: 'Name, logo, vision and mission, week start',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'fines',
    label: 'Fine types',
    hint: 'What each infraction costs',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    hint: 'Who can sign in, and as what',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'password',
    label: 'My password',
    hint: 'Change your own sign-in password',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'security',
    label: 'Security',
    hint: 'The group’s two-factor switch, and your own second factor',
    // The page itself is super-admin/admin only (see App.jsx), and the master switch on it is
    // super admin only. Listed to match the guard rather than to promise something the route
    // would refuse.
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'backup',
    label: 'Backup',
    hint: 'Download a copy of everything',
    roles: ['super_admin'],
  },
];

function SectionNav({ sections, className = '' }) {
  return (
    <nav aria-label="On this page" className={`min-w-0 space-y-2 ${className}`.trim()}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">On this page</h2>
      <ul className="grid min-w-0 gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
        {sections.map((section) => (
          <li key={section.id}>
            {/* The same row as the dashboard's "Go to" groups: a section in this rail
                is a destination too, it just happens to be further down this page. */}
            <NavTile href={`#${section.id}`} label={section.label} hint={section.hint} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function AdminSettings() {
  const { user } = useAuth();

  const sections = SECTIONS.filter((section) => section.roles.includes(user?.role));
  const has = (id) => sections.some((section) => section.id === id);

  return (
    <div className="min-w-0 space-y-4">
      <header className="min-w-0">
        <BackLink to="/admin/dashboard" className="mb-2">Back</BackLink>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Administration</p>
        <h1 className="mt-1 text-2xl font-bold">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          The group as members see it, the fines the disciplinary officer picks from, the accounts
          that can sign in, and your own password.
        </p>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start xl:gap-6">
        {/* The rail on a wide screen, a jump list at the top on a phone — the same
            markup, moved by order rather than duplicated. */}
        <SectionNav sections={sections} className="xl:order-2 xl:sticky xl:top-6" />

        <div className="min-w-0 space-y-4 xl:order-1">
          {/* scroll-mt clears the sticky mobile header when a jump lands, so the
              heading it promised is the one you actually see. */}
          {has('identity') && (
            <div id="identity" className="scroll-mt-24">
              <ChamaSettingsForm />
            </div>
          )}
          {has('fines') && (
            <div id="fines" className="scroll-mt-24">
              <FineTypeManager />
            </div>
          )}
          {has('accounts') && (
            <div id="accounts" className="scroll-mt-24">
              <AddAdminForm />
            </div>
          )}
          {has('password') && (
            <div id="password" className="scroll-mt-24">
              <ChangePasswordForm />
            </div>
          )}
          {has('security') && (
            <div id="security" className="scroll-mt-24">
              <TwoFactorPanel />
            </div>
          )}
          {has('backup') && (
            <div id="backup" className="scroll-mt-24">
              <BackupPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
