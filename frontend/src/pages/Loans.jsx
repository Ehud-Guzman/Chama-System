import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, todayISO } from '../utils/format';
import Loader from '../components/shared/Loader';
import ErrorState from '../components/shared/ErrorState';
import BackLink from '../components/shared/BackLink';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import MemberPicker from '../components/control/MemberPicker';
import { useAuth } from '../context/AuthContext';

// Loans to members, out of a loan fund.
//
// Lending is an expense from a fund the books count as "owed back"; each repayment gives principal
// back and records only the interest as income (backend/src/models/Loan explains why that keeps every
// existing figure right). This screen is the treasurer's way of doing it: lend, record what comes in,
// see who is behind. The terms are the simple ones — one flat interest rate on the amount lent,
// charged once, repaid in equal monthly instalments.

const TABS = [
  { key: 'active', label: 'Out now' },
  { key: 'cleared', label: 'Paid off' },
  { key: 'cancelled', label: 'Cancelled' },
];
const METHODS = [
  ['cash', 'Cash'],
  ['mobile', 'M-Pesa'],
  ['bank', 'Bank'],
  ['other', 'Other'],
];

const inputClass = 'h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm';
const buttonClass = 'min-h-11 rounded-lg border border-rule bg-surface px-4 text-sm font-medium disabled:opacity-60';
const primaryClass = 'min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60';

function Tile({ label, value, hint, tone }) {
  return (
    <div className="min-w-0 rounded-xl border border-rule bg-surface p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={`amount mt-1 whitespace-nowrap text-xl font-bold ${tone === 'alert' ? 'text-alert' : ''}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs leading-4 text-muted">{hint}</p>}
    </div>
  );
}

function Pill({ tone = 'quiet', children }) {
  const tones = {
    quiet: 'border border-rule text-muted',
    good: 'bg-primary/10 text-primary',
    bad: 'bg-alert/10 text-alert',
    warn: 'bg-accent/10 text-accent',
  };
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 ${tones[tone]}`}>
      {children}
    </span>
  );
}

// What lending would cost, as the form is filled in: the same sum the server does, shown so the
// treasurer reads the terms back to the member before pressing the button.
function preview({ principal, interestPercent, termMonths }) {
  const p = Number(principal);
  const r = Number(interestPercent);
  const t = Number(termMonths);
  if (!(p > 0) || !(r >= 0) || !Number.isInteger(t) || t < 1) return null;
  const interest = Math.round(p * r) / 100;
  const total = Math.round((p + interest) * 100) / 100;
  return { interest, total, each: Math.round((total / t) * 100) / 100 };
}

function standingPill(loan) {
  if (loan.status === 'cleared') return <Pill tone="good">Paid off</Pill>;
  if (loan.status === 'cancelled') return <Pill>Cancelled</Pill>;
  if (loan.overdueAmount > 0) {
    return (
      <Pill tone="bad">
        Behind {money(loan.overdueAmount)} · {loan.daysOverdue} day{loan.daysOverdue === 1 ? '' : 's'}
      </Pill>
    );
  }
  return loan.nextDue ? <Pill tone="quiet">Next {money(loan.nextDue.amount)} on {shortDate(loan.nextDue.dueOn)}</Pill> : null;
}

// One loan, opened: its terms, the schedule, what has been paid, and what can be done.
function LoanDetail({ loanId, onChanged }) {
  const toast = useToast();
  const [loan, setLoan] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ amount: '', date: todayISO(), method: 'cash', note: '' });
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState('');
  // One key per attempt: sending the same form twice (a double tap, a dropped answer) is one payment.
  const [requestId, setRequestId] = useState(() => `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/loans/${loanId}`);
      setLoan(res.data.loan);
      setError('');
    } catch (err) {
      setError(apiMessage(err, 'Could not load the loan'));
    }
  }, [loanId]);

  useEffect(() => {
    load();
  }, [load]);

  async function repay(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/api/loans/${loanId}/repayments`, {
        amount: Number(form.amount),
        date: form.date,
        method: form.method,
        note: form.note,
        clientRequestId: requestId,
      });
      setLoan(res.data.loan);
      toast(
        res.data.loan.status === 'cleared'
          ? 'Paid off — the loan is cleared'
          : `Recorded: ${money(res.data.split?.principalPart || 0)} principal, ${money(res.data.split?.interestPart || 0)} interest`
      );
      setForm({ amount: '', date: todayISO(), method: 'cash', note: '' });
      setRequestId(`rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      onChanged();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res =
        dialog === 'undo'
          ? await api.delete(`/api/loans/${loanId}/repayments/last`)
          : await api.post(`/api/loans/${loanId}/cancel`, { reason });
      setLoan(res.data.loan);
      toast(dialog === 'undo' ? 'The last repayment was taken back' : 'The loan was cancelled');
      setDialog(null);
      setReason('');
      onChanged();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (error && !loan) return <p role="alert" className="px-4 py-3 text-sm text-alert">{error}</p>;
  if (!loan) return <p className="px-4 py-3 text-sm text-muted">Loading…</p>;

  const live = loan.status === 'active';
  const last = loan.repayments[loan.repayments.length - 1];

  return (
    <div className="space-y-4 border-t border-rule bg-canvas px-4 py-4">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ['Lent', money(loan.principal)],
          ['Interest', `${loan.interestPercent}% = ${money(loan.totalInterest)}`],
          ['To repay in all', money(loan.totalDue)],
          ['Over', `${loan.termMonths} month${loan.termMonths === 1 ? '' : 's'}, to ${shortDate(loan.finalDueOn)}`],
          ['Paid so far', money(loan.paid)],
          ['Left to repay', money(loan.outstanding)],
          ['…of which principal', money(loan.principalOutstanding)],
          ['Fund', loan.fund.name],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg border border-rule bg-surface px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="amount mt-0.5 break-words text-sm font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {(loan.note || loan.approvalRef) && (
        <p className="text-xs leading-5 text-muted">
          {loan.note}
          {loan.note && loan.approvalRef ? ' · ' : ''}
          {loan.approvalRef ? `Approved in: ${loan.approvalRef}` : ''}
        </p>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Repayment schedule</h3>
        <div className="overflow-x-auto mt-2 rounded-lg border border-rule bg-surface">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <thead>
              <tr className="border-b border-rule text-xs uppercase tracking-wider text-muted">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 text-right font-semibold">Instalment</th>
                <th className="px-3 py-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loan.installments.map((row) => (
                <tr key={row.n} className="border-b border-rule last:border-b-0">
                  <td className="amount px-3 py-1.5">{row.n}</td>
                  <td className="px-3 py-1.5">{shortDate(row.dueOn)}</td>
                  <td className="amount px-3 py-1.5 text-right">{money(row.amount)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {row.status === 'paid' ? (
                      <Pill tone="good">Paid</Pill>
                    ) : row.status === 'overdue' ? (
                      <Pill tone="bad">Overdue</Pill>
                    ) : (
                      <span className="text-xs text-muted">Upcoming</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-muted">
          Instalments are counted off in order from what has been paid in total, so paying ahead covers the later ones.
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Repayments</h3>
        {loan.repayments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing repaid yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule bg-surface">
            {loan.repayments.map((r) => (
              <li key={r.index} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="amount font-semibold">{money(r.amount)}</span>
                  <span className="text-xs text-muted">{shortDate(r.date)} · {r.method}{r.by ? ` · ${r.by}` : ''}</span>
                </div>
                <p className="amount text-xs text-muted">
                  {money(r.principalPart)} principal + {money(r.interestPart)} interest{r.note ? ` · ${r.note}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {live && (
        <form onSubmit={repay} className="space-y-3 rounded-lg border border-rule bg-surface p-3">
          <h3 className="text-sm font-semibold">Record a repayment</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`amt-${loanId}`} className="mb-1 block text-xs font-medium">Amount</label>
              <input id={`amt-${loanId}`} type="number" inputMode="decimal" min="0" step="0.01" required value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass}
                placeholder={loan.nextDue ? String(loan.nextDue.amount) : ''} />
            </div>
            <div>
              <label htmlFor={`dt-${loanId}`} className="mb-1 block text-xs font-medium">Date paid</label>
              <input id={`dt-${loanId}`} type="date" max={todayISO()} value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`mt-${loanId}`} className="mb-1 block text-xs font-medium">How</label>
              <select id={`mt-${loanId}`} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputClass}>
                {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Note (e.g. the M-Pesa code)" aria-label="Note" className={inputClass} />
          <button type="submit" disabled={busy || !form.amount} className={primaryClass}>
            {busy ? 'Saving…' : 'Record repayment'}
          </button>
        </form>
      )}

      {loan.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2">
          {last && (
            <button type="button" onClick={() => setDialog('undo')} className={buttonClass}>
              Take back the last repayment
            </button>
          )}
          {live && loan.repayments.length === 0 && (
            <button type="button" onClick={() => setDialog('cancel')} className={buttonClass}>
              Cancel this loan
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'undo'}
        title="Take back the last repayment?"
        body={last ? `${money(last.amount)} paid on ${shortDate(last.date)} is removed, and the interest it recorded with it. The loan owes it again.` : ''}
        confirmLabel="Take it back"
        danger
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Cancel this loan?"
        body={
          <>
            For a loan made in error. The money goes back to the fund as though it had never been lent.
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (required)" aria-label="Reason"
              className="mt-3 h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm text-ink" maxLength={300} />
          </>
        }
        confirmLabel="Cancel the loan"
        danger
        busy={busy}
        onConfirm={() => (reason.trim().length < 3 ? toast('Say why the loan is being cancelled', 'error') : confirm())}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

function NewLoan({ funds, onCreated, onFundsChanged, canAdmin }) {
  const toast = useToast();
  const [member, setMember] = useState(null);
  const [form, setForm] = useState({ fundId: '', principal: '', interestPercent: '10', termMonths: '6', date: todayISO(), note: '', approvalRef: '' });
  const [needsApproval, setNeedsApproval] = useState(false);
  const [overdraw, setOverdraw] = useState(null);
  const [confirmOverdraw, setConfirmOverdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(null);
  const [markWarn, setMarkWarn] = useState('');

  const loanFunds = funds.filter((f) => f.isRecoverable);
  const candidates = funds.filter((f) => !f.isRecoverable);
  const fundId = form.fundId || loanFunds[0]?.id || '';
  const shown = useMemo(() => preview(form), [form]);

  async function submit(event) {
    event.preventDefault();
    if (!member) return toast('Choose the member first', 'error');
    setBusy(true);
    setOverdraw(null);
    try {
      const res = await api.post('/api/loans', {
        memberId: member._id,
        fundId,
        principal: Number(form.principal),
        interestPercent: Number(form.interestPercent),
        termMonths: Number(form.termMonths),
        date: form.date,
        note: form.note,
        approvalRef: form.approvalRef,
        confirmOverdraw: confirmOverdraw && Boolean(overdraw),
      });
      toast(`${res.data.loan.loanNumber}: ${money(res.data.loan.principal)} lent to ${member.name}`);
      setMember(null);
      setForm({ ...form, principal: '', note: '', approvalRef: '' });
      setNeedsApproval(false);
      setConfirmOverdraw(false);
      onCreated(res.data.loan);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'OVERDRAW') setOverdraw(data);
      else if (data?.needsApproval) setNeedsApproval(true);
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function mark(fund, confirm) {
    try {
      await api.post(`/api/loans/funds/${fund.id}/mark-loan-fund`, { confirm });
      toast(`${fund.name} is now the loan fund`);
      setMarking(null);
      setMarkWarn('');
      onFundsChanged();
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'NEEDS_CONFIRM') {
        setMarking(fund);
        setMarkWarn(data.message);
      } else {
        toast(apiMessage(err), 'error');
      }
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <h2 className="text-base font-semibold">Lend to a member</h2>
      {loanFunds.length === 0 ? (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm leading-6 text-accent">
            Loans come out of a fund the books count as <strong>owed back</strong>, not spent. None is set up yet.
            {canAdmin ? ' Choose the one the group uses for loans:' : ' An admin has to choose it first.'}
          </p>
          {canAdmin && (
            <ul className="space-y-2">
              {candidates.map((fund) => (
                <li key={fund.id}>
                  <button type="button" onClick={() => mark(fund, false)} className={`${buttonClass} w-full text-left`}>
                    Make “{fund.name}” the loan fund
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <MemberPicker id="loan-member" label="Who is borrowing" value={member} onPick={setMember} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="loan-fund" className="mb-1 block text-xs font-medium">From</label>
              <select id="loan-fund" value={fundId} onChange={(e) => setForm({ ...form, fundId: e.target.value })} className={inputClass}>
                {loanFunds.map((f) => <option key={f.id} value={f.id}>{f.name} — holds {money(f.balance)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="loan-date" className="mb-1 block text-xs font-medium">Date lent</label>
              <input id="loan-date" type="date" max={todayISO()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor="loan-principal" className="mb-1 block text-xs font-medium">Amount lent</label>
              <input id="loan-principal" type="number" inputMode="decimal" min="0" step="0.01" required value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })} className={inputClass} placeholder="e.g. 20000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="loan-rate" className="mb-1 block text-xs font-medium">Interest %</label>
                <input id="loan-rate" type="number" inputMode="decimal" min="0" max="100" step="0.1" required value={form.interestPercent}
                  onChange={(e) => setForm({ ...form, interestPercent: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-term" className="mb-1 block text-xs font-medium">Months</label>
                <input id="loan-term" type="number" inputMode="numeric" min="1" max="60" step="1" required value={form.termMonths}
                  onChange={(e) => setForm({ ...form, termMonths: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>
          {shown && (
            <p className="amount rounded-lg bg-canvas px-3 py-2 text-sm">
              Interest {money(shown.interest)} (charged once on the amount lent) · repays {money(shown.total)} in all ·{' '}
              <strong>{money(shown.each)} a month</strong>
            </p>
          )}
          {needsApproval && (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
              <label htmlFor="loan-approval" className="mb-1 block text-xs font-medium">
                Approved in <span className="font-normal text-muted">— above the spending limit the members must have agreed it. Which minute?</span>
              </label>
              <input id="loan-approval" value={form.approvalRef} onChange={(e) => setForm({ ...form, approvalRef: e.target.value })}
                className={inputClass} placeholder="e.g. Minutes of 12 Oct, item 6" maxLength={120} />
            </div>
          )}
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500}
            placeholder="Note (what it is for, who stood for him)" aria-label="Note" className={inputClass} />
          {overdraw && (
            <label className="flex items-start gap-2 rounded-lg border border-alert/40 bg-alert/5 p-3 text-sm text-alert">
              <input type="checkbox" checked={confirmOverdraw} onChange={(e) => setConfirmOverdraw(e.target.checked)} className="mt-1 h-4 w-4" />
              <span>{overdraw.message}</span>
            </label>
          )}
          <button type="submit" disabled={busy || !member || !form.principal} className={primaryClass}>
            {busy ? 'Saving…' : 'Lend'}
          </button>
        </form>
      )}
      <ConfirmDialog
        open={Boolean(marking)}
        title={`Make ${marking?.name || ''} the loan fund?`}
        body={markWarn}
        confirmLabel="Yes, make it the loan fund"
        danger
        onConfirm={() => mark(marking, true)}
        onCancel={() => {
          setMarking(null);
          setMarkWarn('');
        }}
      />
    </section>
  );
}

export default function Loans() {
  const { user } = useAuth();
  const canAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [funds, setFunds] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, fundList] = await Promise.all([api.get('/api/loans', { params: { status: tab, q: q || undefined } }), api.get('/api/loans/funds')]);
      setData(list.data);
      setFunds(fundList.data.funds);
      setError('');
    } catch (err) {
      setError(apiMessage(err, 'Could not load the loans'));
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  if (loading && !data) return <Loader />;
  if (error && !data) return <ErrorState title="Could not load the loans" message={error} onRetry={load} />;

  const summary = data?.summary || {};
  const loans = data?.loans || [];

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <BackLink to="/admin/finance" className="mb-2">Finance</BackLink>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Money lent</p>
          <h1 className="mt-1 text-2xl font-bold">Loans</h1>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)} className={adding ? buttonClass : primaryClass}>
          {adding ? 'Close' : 'Lend to a member'}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Out on loan" value={money(summary.principalOutstanding)} hint={`${summary.active || 0} loan${summary.active === 1 ? '' : 's'}`} />
        <Tile label="Still to come in" value={money(summary.outstanding)} hint="principal and interest" />
        <Tile label="Behind" value={money(summary.overdueAmount)} tone={summary.overdueAmount > 0 ? 'alert' : undefined}
          hint={`${summary.overdueLoans || 0} loan${summary.overdueLoans === 1 ? '' : 's'}`} />
        <Tile label="Interest earned" value={money(summary.interestEarned)} hint="all loans, so far" />
      </div>

      {adding && (
        <NewLoan
          funds={funds}
          canAdmin={canAdmin}
          onFundsChanged={load}
          onCreated={(loan) => {
            setAdding(false);
            setTab('active');
            setOpenId(loan.id);
            load();
          }}
        />
      )}

      <section className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule p-3">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
              className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${tab === t.key ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'}`}>
              {t.label}
            </button>
          ))}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Member or loan number" aria-label="Search loans"
            className="h-11 min-w-0 flex-1 rounded-lg border border-rule bg-canvas px-3 text-sm sm:max-w-xs" />
        </div>

        {loans.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {tab === 'active' ? 'No loans are out. Lend to a member to start one.' : 'Nothing here.'}
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {loans.map((loan) => (
              <li key={loan.id}>
                <button type="button" onClick={() => setOpenId(openId === loan.id ? '' : loan.id)} aria-expanded={openId === loan.id}
                  className="flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-elevation">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{loan.member.name}</span>
                    <span className="amount block text-xs text-muted">
                      {loan.loanNumber} · {money(loan.principal)} at {loan.interestPercent}% · {loan.termMonths} mo · lent {shortDate(loan.issuedOn)}
                    </span>
                  </span>
                  <span className="amount shrink-0 text-sm font-semibold">{loan.status === 'active' ? `${money(loan.outstanding)} left` : money(loan.paid)}</span>
                  {standingPill(loan)}
                </button>
                {openId === loan.id && <LoanDetail loanId={loan.id} onChanged={load} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
