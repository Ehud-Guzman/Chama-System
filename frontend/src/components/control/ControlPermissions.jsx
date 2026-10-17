import { Fragment, useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import ErrorState from '../shared/ErrorState';
import Loader from '../shared/Loader';
import { Panel } from './controlUi';

// Who can do what, read from the server's own routes.
//
// ROLES_AND_PERMISSIONS.md is written by hand and has been wrong before. This table is not: it is
// built (utils/permissionMatrix) from the very `requireRole` lists that decide each request, so
// what it shows is what the server enforces. What it cannot see is a rule written inside a
// controller — "an admin may only manage secretary and disciplinary accounts", "a treasurer may
// fill in a blank ID but never replace one" — those are finer than a role and stay in the docs;
// a cell marked "part" is where to look for them.

const ROLE_LABEL = {
  super_admin: 'Super',
  admin: 'Admin',
  treasurer: 'Treasurer',
  secretary: 'Secretary',
  disciplinary: 'Discipline',
};

const METHOD_TONE = {
  GET: 'text-muted',
  POST: 'text-primary',
  PUT: 'text-primary',
  PATCH: 'text-accent',
  DELETE: 'text-alert',
};

function Cell({ cell, isPublic }) {
  if (isPublic) return <span className="text-muted">—</span>;
  if (!cell.read && !cell.write) return <span className="text-rule" aria-label="No access">·</span>;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold ${
        cell.write ? 'bg-primary/10 text-primary' : 'bg-canvas text-muted'
      }`}
      title={cell.partial ? 'Part of this area only' : undefined}
    >
      {cell.write ? 'Edit' : 'View'}
      {cell.partial && <span className="font-normal">·part</span>}
    </span>
  );
}

export default function ControlPermissions() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/superadmin/permissions');
      setData(res.data);
      setError('');
    } catch (err) {
      setError(apiMessage(err, 'Could not read the permissions'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <ErrorState title="Could not read the permissions" message={error} onRetry={load} />;
  if (!data) return <Loader />;

  return (
    <Panel
      id="permissions"
      title="Who can do what"
      intro="Generated from the server's own rules, so it cannot drift from what is actually enforced. Tap an area to see every endpoint behind it."
    >
      <div className="overflow-x-auto -mx-1 rounded-lg border border-rule">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b border-rule bg-canvas text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="px-3 py-2 font-semibold">
                Area
              </th>
              {data.roles.map((role) => (
                <th key={role} scope="col" className="px-2 py-2 text-center font-semibold">
                  {ROLE_LABEL[role] || role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.areas.map((area) => (
              <Fragment key={area.mount}>
                <tr className="border-b border-rule last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <button
                      type="button"
                      onClick={() => setOpen(open === area.mount ? null : area.mount)}
                      aria-expanded={open === area.mount}
                      className="min-h-11 text-left"
                    >
                      <span className="block">{area.label}</span>
                      {area.note && <span className="block text-xs font-normal leading-4 text-muted">{area.note}</span>}
                    </button>
                  </th>
                  {data.roles.map((role) => (
                    <td key={role} className="px-2 py-2 text-center">
                      <Cell cell={area.cells[role]} isPublic={area.public} />
                    </td>
                  ))}
                </tr>
                {open === area.mount && (
                  <tr className="border-b border-rule bg-canvas">
                    <td colSpan={data.roles.length + 1} className="px-3 py-3">
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {area.routes.map((route) => (
                          <li key={`${route.method}${route.path}`} className="min-w-0 text-xs leading-5">
                            <span className={`mr-1.5 font-bold ${METHOD_TONE[route.method] || ''}`}>{route.method}</span>
                            <span className="amount break-all">{route.path}</span>
                            <span className="block text-muted">
                              {route.roles
                                ? route.roles.length === data.roles.length
                                  ? 'any signed-in role'
                                  : route.roles.map((r) => ROLE_LABEL[r] || r).join(', ')
                                : 'no account needed'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        <strong className="font-semibold">Edit</strong> means the role can add, change or remove in that area;{' '}
        <strong className="font-semibold">View</strong> means read only; <strong className="font-semibold">part</strong>{' '}
        means only some of the area&apos;s screens. The members&apos; area has no accounts at all: a member opens
        his own record with his ID (and his phone number, when the group asks for it).
      </p>
    </Panel>
  );
}
