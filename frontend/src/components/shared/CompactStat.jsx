// One figure with its explanation, the compact tile the spending, fines and member-ledger screens
// share: these are the group's own numbers, and a treasurer should be able to defend any one of them
// without a call, so `hint` is the working in brackets under the figure. (StatTile is the larger
// tile for the dashboard and the public overview.)
export default function CompactStat({ label, value, hint, accent, alert }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`amount mt-1 text-lg font-bold ${
          alert ? 'text-alert' : accent ? 'text-primary' : ''
        }`}
      >
        {value}
      </p>
      {hint && <p className="amount mt-1 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}
