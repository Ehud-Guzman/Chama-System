const WIDTH = 320;
const HEIGHT = 176;
const PAD_X = 20;
// Room above the tallest bar for the top of it not to touch the edge, and below
// the axis for the month labels.
const TOP = 12;
const BOTTOM = 32;

// One series of contributions as bars, as plain SVG.
//
// `points` is any labelled series — a member's last twelve months, or the whole
// group's last twelve weeks (see the summary report) — each point being
// { label, personal, groupFund, other, total }.
//
// No chart library: these are two cards on a reports page, and the phones they are
// read on are often on slow mobile data — a dependency that ships a hundred
// kilobytes to draw twelve bars would cost more than it gives. The SVG scales to
// whatever width the card has (`viewBox` + `w-full h-auto`), so it can neither
// overflow a 320px phone nor stretch oddly on a laptop.
export default function ContributionChart({
  points = [],
  height = HEIGHT,
  emptyMessage = 'Nothing logged in this period yet.',
  seriesLabel = "Member's own",
}) {
  const plotHeight = height - TOP - BOTTOM;
  const max = Math.max(1, ...points.map((m) => m.total));
  const slot = (WIDTH - PAD_X * 2) / Math.max(1, points.length);
  const barWidth = Math.max(6, Math.min(20, slot * 0.62));
  const hasAny = points.some((m) => m.total > 0);

  if (!hasAny) {
    return (
      <p className="rounded-xl border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
        {emptyMessage}
      </p>
    );
  }

  const scale = (value) => (value / max) * plotHeight;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Contributions, period by period"
      >
        <title>Contributions, period by period</title>

        <line
          x1={PAD_X - 8}
          x2={WIDTH - PAD_X + 8}
          y1={height - BOTTOM}
          y2={height - BOTTOM}
          stroke="#e2e6e1"
          strokeWidth="1"
        />

        {points.map((point, index) => {
          const x = PAD_X + slot * index + (slot - barWidth) / 2;
          const personalHeight = scale(point.personal);
          const groupHeight = scale(point.groupFund);
          const otherHeight = scale(point.other);

          let cursor = height - BOTTOM;
          const bars = [];

          // Stacked from the axis up: his own money first, then the group funds
          // (tea) that were collected alongside it, then any system row.
          if (personalHeight > 0) {
            bars.push(
              <rect
                key="personal"
                x={x}
                y={cursor - personalHeight}
                width={barWidth}
                height={personalHeight}
                fill="#166534"
                rx="2"
              />
            );
            cursor -= personalHeight;
          }
          if (groupHeight > 0) {
            bars.push(
              <rect
                key="group"
                x={x}
                y={cursor - groupHeight}
                width={barWidth}
                height={groupHeight}
                fill="#8fbfa6"
                rx="2"
              />
            );
            cursor -= groupHeight;
          }
          if (otherHeight > 0) {
            bars.push(
              <rect
                key="other"
                x={x}
                y={cursor - otherHeight}
                width={barWidth}
                height={otherHeight}
                fill="#a16207"
                rx="2"
              />
            );
            cursor -= otherHeight;
          }

          // Every second label at this width: twelve of them on a 320px-wide chart
          // would overlap into an unreadable smear on a phone.
          const showLabel = index % 2 === 0 || index === points.length - 1;

          return (
            <g key={point.month || point.label || index}>
              {bars}
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={height - BOTTOM + 13}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#5c6b62"
                >
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" />
          {seriesLabel}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: '#8fbfa6' }}
            aria-hidden="true"
          />
          Group funds
        </li>
      </ul>
    </div>
  );
}
