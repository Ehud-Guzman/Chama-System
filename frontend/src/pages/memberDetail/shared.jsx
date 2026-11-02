// One label/value pair in the profile's admission blocks. Renders nothing when
// there is no value, so a half-filled record shows only what is actually known
// rather than a column of blanks.
export function Detail({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
