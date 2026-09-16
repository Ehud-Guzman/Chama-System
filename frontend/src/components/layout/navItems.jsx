// Admin destinations, shared by BottomNav (mobile) and Sidebar (desktop).
// `roles` restricts visibility; omit it to show to every authenticated role.
// Icons are inline SVG — no icon library.
export const NAV_ITEMS = [
  {
    to: '/admin/dashboard',
    label: 'Dashboard',
    roles: ['super_admin', 'admin', 'treasurer'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    to: '/admin/members',
    label: 'Members',
    roles: ['super_admin', 'admin', 'treasurer'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21v-1a7 7 0 0 1 14 0v1" />
        <path d="M16 4a4 4 0 0 1 0 8" />
        <path d="M19 14a7 7 0 0 1 3 6v1" />
      </svg>
    ),
  },
  {
    to: '/admin/log',
    label: 'Log',
    roles: ['super_admin', 'admin', 'treasurer'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    ),
  },
  {
    to: '/admin/reports',
    label: 'Reports',
    roles: ['super_admin', 'admin', 'treasurer', 'secretary'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
  {
    to: '/admin/minutes',
    label: 'Minutes',
    roles: ['super_admin', 'admin', 'secretary'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M9 7h7" />
        <path d="M9 11h7" />
      </svg>
    ),
  },
  {
    to: '/admin/disciplinary',
    label: 'Discipline',
    roles: ['super_admin', 'admin', 'disciplinary'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2 3 6v6c0 5 3.8 8.7 9 10 5.2-1.3 9-5 9-10V6z" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
    ),
  },
];
