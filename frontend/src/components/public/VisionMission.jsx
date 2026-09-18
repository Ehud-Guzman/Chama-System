// The group's vision and mission, in the words of its own constitution
// (Chapter 2, clauses 2.1 and 2.2) unless the office has rewritten them in
// Settings — the server resolves which of the two applies, so this only prints
// what it is handed.
//
// It sits at the foot of the members' page, below the group's totals, rather
// than between the lookup and a member's own record: someone opening the link to
// check his balance came for that record, and an identity statement he has
// already read must not stand in front of it. Nothing renders when the group has
// neither statement — an empty card would be worse than no card.
export default function VisionMission({ vision, mission }) {
  const statements = [
    { key: 'vision', label: 'Our vision', text: String(vision || '').trim() },
    { key: 'mission', label: 'Our mission', text: String(mission || '').trim() },
  ].filter((s) => s.text);

  if (statements.length === 0) return null;

  return (
    <section
      aria-label="Our vision and mission"
      className="rounded-2xl border border-rule bg-surface p-5 shadow-sm sm:p-6 lg:p-7"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">
        Who we are
      </p>
      <h2 className="mt-1 text-base font-bold sm:text-lg">Vision and mission</h2>

      {/* Side by side once there is room, with the rule between them turned
          upright — on a phone the second statement runs under the first. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:gap-10">
        {statements.map((s, index) => (
          <div
            key={s.key}
            className={index > 0 ? 'border-t border-rule pt-4 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0' : ''}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {s.label}
            </p>
            <p className="mt-2 text-sm leading-6 sm:text-base">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
