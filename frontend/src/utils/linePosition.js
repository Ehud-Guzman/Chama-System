// Where a member stands against the group's money line this week — the "expected" figure.
//
// The line is what the paper ledger expects a member to hold by now: its own figure at the week the
// books opened (123,600 in week 98), rising by the weekly contribution every week after (125,100 in
// week 99). Below it is what the group calls a debt, at or above it is extra. The server works the
// line out (utils/reminderLimit) and sends it as `ledger.moneyLimit`; this only compares it with what
// he holds, so every screen words the gap the same way.
//
// Pure and free of React, so the sentences' figures can be pinned down under `node --test`.
//
// `null` when there is no line to compare with: the rule is switched off (a limit of 0) or the
// ledger is missing. Nothing is claimed about a member in that case.
export function linePosition(ledger) {
  if (!ledger) return null;
  const line = Number(ledger.moneyLimit) || 0;
  if (line <= 0) return null;

  const held = Number(ledger.money) || 0;
  // To the cent, so a figure that has been through a division cannot read as 0.0000000001 below.
  const gap = Math.round((line - held) * 100) / 100;

  return {
    line,
    held,
    // Always positive: how far from the line he is, on whichever side.
    distance: Math.abs(gap),
    side: gap > 0 ? 'below' : gap < 0 ? 'above' : 'on',
  };
}
