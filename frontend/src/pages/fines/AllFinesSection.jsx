import IssueFineForm from '../../components/members/IssueFineForm';
import { Link } from 'react-router-dom';

export default function AllFinesSection({ goTo, memberSearch, memberTotal, members, refresh, setMemberSearch, setTarget, target }) {
  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Issue a fine</h2>
        <p className="text-xs text-muted">The member is emailed as soon as it is recorded.</p>
      </div>

      {target ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2">
            <p className="min-w-0 text-sm">
              <span className="font-medium">{target.name}</span>
              <span className="text-muted">
                {target.regNumber ? ` · ${target.regNumber}` : ''}
                {target.phone ? ` · ${target.phone}` : ''}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="-my-1 min-h-11 rounded-lg px-2 text-sm font-medium text-primary"
            >
              Change member
            </button>
          </div>
          <IssueFineForm
            memberId={target._id}
            onIssued={() => {
              setTarget(null);
              setMemberSearch('');
              refresh();
              goTo('owes');
            }}
            onCancel={() => setTarget(null)}
          />
        </>
      ) : (
        <>
          <input
            type="search"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Search a member by name, phone or reg no."
            aria-label="Search members"
            className="h-12 w-full rounded-xl border border-rule bg-canvas px-4 text-sm"
          />
          {members.length === 0 && !memberSearch.trim() ? (
            <p className="mt-3 text-sm text-muted">
              No active members to fine. Add them on{' '}
              <Link to="/admin/members" className="text-primary underline">
                Members
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-3 max-h-96 overflow-y-auto overscroll-contain rounded-lg border border-rule">
              {members.map((m) => (
                <li key={m._id} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setTarget(m)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-3 text-left hover:bg-elevation"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{m.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {m.regNumber ? `${m.regNumber} · ` : ''}
                        {m.phone}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-primary">Fine</span>
                  </button>
                </li>
              ))}
              {members.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted">No member matches that search.</li>
              )}
            </ul>
          )}
          {memberTotal > members.length && (
            <p className="mt-2 text-xs text-muted">
              Showing {members.length} of {memberTotal} members. Type a name, phone or reg number to narrow it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
