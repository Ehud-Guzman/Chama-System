import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { money, shortDate } from '../../utils/format';

// The loans one member has had, on his own page: what he owes, whether he is behind, and a way into
// the Loans screen to record a repayment. Draws nothing for a member who has never borrowed, so the
// page of everybody else is not made longer by a feature they do not use.
export default function MemberLoans({ memberId }) {
  const [loans, setLoans] = useState(null);

  useEffect(() => {
    let current = true;
    api
      .get('/api/loans', { params: { memberId, status: 'all' } })
      .then((res) => current && setLoans(res.data.loans.filter((l) => l.status !== 'cancelled')))
      // Quiet: a card that errors is worse than no card, and the Loans screen has its own errors.
      .catch(() => current && setLoans([]));
    return () => {
      current = false;
    };
  }, [memberId]);

  if (!loans || loans.length === 0) return null;
  const owed = loans.reduce((sum, l) => sum + (l.status === 'active' ? l.outstanding : 0), 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Loans ({loans.length})</h2>
        {owed > 0 && <p className="amount text-xs font-semibold">Owes {money(owed)}</p>}
      </div>
      <ul className="divide-y divide-rule rounded-xl border border-rule bg-surface">
        {loans.map((loan) => (
          <li key={loan.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="amount text-sm font-semibold">{loan.loanNumber}</span>
              <span className="amount text-sm">{money(loan.principal)}</span>
              <span className="text-xs text-muted">lent {shortDate(loan.issuedOn)}</span>
              {loan.status === 'cleared' && <span className="text-xs font-semibold text-primary">Paid off</span>}
              {loan.overdueAmount > 0 && (
                <span className="text-xs font-semibold text-alert">
                  Behind {money(loan.overdueAmount)} · {loan.daysOverdue} days
                </span>
              )}
            </div>
            {loan.status === 'active' && (
              <p className="amount mt-0.5 text-xs text-muted">
                {money(loan.outstanding)} left to repay{loan.nextDue ? ` · next ${money(loan.nextDue.amount)} on ${shortDate(loan.nextDue.dueOn)}` : ''}
              </p>
            )}
          </li>
        ))}
      </ul>
      <Link to="/admin/loans" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
        Open Loans
      </Link>
    </div>
  );
}
