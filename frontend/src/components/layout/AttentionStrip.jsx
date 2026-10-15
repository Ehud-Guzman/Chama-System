import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// The things that need somebody's attention and would otherwise stay silent.
//
// Each of these is already known to the system and printed somewhere: the backup age on the Backup
// panel, the fine payments waiting to be sorted on the fines desk. Not one of them is an error, so
// none of them ever interrupts anybody, and the failure they guard against is a silence that lasts
// for months — no copy of the books outside the server, a fine payment that never reached
// anybody's balance.
//
// So they are said here, on the page everybody lands on, to the people who can act on them, and the
// strip draws nothing at all when there is nothing to say. Every check is quiet about its own
// failure: a strip that errors is worse than no strip.
export default function AttentionStrip() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    const isSuper = user?.role === 'super_admin';
    const isOffice = isSuper || user?.role === 'admin';
    if (!isOffice) return undefined;

    let cancelled = false;
    const found = [];
    const add = (item) => {
      found.push(item);
      if (!cancelled) setItems([...found]);
    };

    const checks = [];

    if (isSuper) {
      checks.push(
        api
          .get('/api/backup/status')
          .then((res) => {
            const health = res.data;
            if (!health?.stale) return;
            add({
              id: 'backup',
              text: health.never
                ? 'Nobody has ever downloaded a copy of the books. The only copies are on the server, and a deploy can wipe them.'
                : `The last copy of the books taken off the server was ${health.daysAgo} days ago.`,
              to: '/admin/settings#backup',
              action: 'Download a copy',
            });
          })
          .catch(() => {})
      );
    }

    checks.push(
      api
        .get('/api/fines/payments/to-check')
        .then((res) => {
          const count = res.data?.payments?.length || 0;
          if (count > 0) {
            add({
              id: 'fine-payments',
              text: `${count} earlier fine ${count === 1 ? 'payment has' : 'payments have'} not been marked as cash or taken from the member’s balance.`,
              to: '/admin/fines?tab=check',
              action: 'Check them',
            });
          }
        })
        .catch(() => {})
    );

    Promise.all(checks);
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  if (items.length === 0) return null;

  return (
    <section aria-label="Needs attention" className="rounded-xl border border-accent/30 bg-accent/5">
      <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-widest text-accent">Needs attention</h2>
      <ul className="divide-y divide-accent/20">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
            <p className="min-w-0 flex-1 basis-64 text-sm">{item.text}</p>
            <Link
              to={item.to}
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline"
            >
              {item.action}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
