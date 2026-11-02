import { money } from '../../utils/format';
import IssueFineForm from '../../components/members/IssueFineForm';
import FinesPanel from '../../components/shared/FinesPanel';
import MemberLoans from '../../components/members/MemberLoans';
import MessageMemberPanel from '../../components/members/MessageMemberPanel';
import LedgerRows from '../../components/contributions/LedgerRows';
import WeeklyScheduleTable from '../../components/shared/WeeklyScheduleTable';

export default function MemberMoneyColumns({ byType, contributions, fines, issuingFine, load, member, setDeletingContribution, setEditingContribution, setIssuingFine, setSettlingFine, setVoidingFine, weeklySchedules }) {
  return (
    <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <section className="space-y-4">
        {/* What he has paid into, by type. This was the pledge editor — an amount
            the office set per fund. Pledges are gone: the member's page shows
            what actually moved, which is what the books can back. */}
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            Paid by contribution type
          </h2>
          {byType.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
              No contribution types set up yet.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
              {byType.map((entry) => (
                <li
                  key={entry.typeId}
                  className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                >
                  <span className="min-w-0 truncate text-sm">
                    {entry.name}
                    {entry.isGroupFund && (
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                        group fund
                      </span>
                    )}
                  </span>
                  <span className="amount shrink-0 text-sm font-semibold">
                    {money(entry.contributed)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Fines</h2>
            {!issuingFine && (
              <button
                type="button"
                onClick={() => setIssuingFine(true)}
                className="-mr-2 -my-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
              >
                Issue fine
              </button>
            )}
          </div>
          {issuingFine ? (
            <IssueFineForm
              memberId={member._id}
              onIssued={() => {
                setIssuingFine(false);
                load();
              }}
              onCancel={() => setIssuingFine(false)}
            />
          ) : (
            <FinesPanel fines={fines} onVoid={setVoidingFine} onSettle={setSettlingFine} />
          )}
        </div>

        <MemberLoans memberId={member._id} />

        <MessageMemberPanel member={member} pendingFinesTotal={fines?.totalOwed || 0} />
      </section>

      <section className="mt-5 space-y-4 lg:mt-0">
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            Contributions ({contributions.length})
          </h2>
          <LedgerRows
            contributions={contributions}
            onEdit={setEditingContribution}
            onDelete={setDeletingContribution}
          />
        </div>

        {weeklySchedules?.length > 0 && (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Weekly schedule
            </h2>
            <WeeklyScheduleTable schedules={weeklySchedules} />
          </div>
        )}
      </section>
    </div>
  );
}
