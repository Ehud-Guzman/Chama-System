// Shared by the admin dashboard and the public group overview — one small
// numbers-first tile, no icons or charts, matching the passbook aesthetic.
export default function StatTile({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4 md:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={`amount mt-1 text-2xl font-bold md:text-3xl ${accent ? 'text-primary' : ''}`}>
        {value}
      </p>
    </div>
  );
}
