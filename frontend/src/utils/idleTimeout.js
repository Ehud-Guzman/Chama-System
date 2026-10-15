// When an unattended session should end.
//
// A session lasts eight hours whether or not anybody is there, so a phone left on a table, or an
// office computer left signed in, keeps the books open all day. Signing out after a stretch with no
// activity closes that, and a warning a minute before keeps it from costing somebody the half-typed
// payment in front of them.
//
// Pure: the clock is passed in, so the rule is covered by test/idleTimeout.test.js without a
// browser, and the component that uses it only has to ask "what stage are we in?".

export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;

// 'active' while there has been activity inside the limit, 'warning' for the last minute before it,
// 'expired' once it has passed. A missing or nonsense timestamp counts as active: the one thing this
// must never do is sign somebody out because a value could not be read.
export function idleStage({ lastActive, now = Date.now(), limitMs = IDLE_LIMIT_MS, warningMs = IDLE_WARNING_MS }) {
  const last = Number(lastActive);
  if (!Number.isFinite(last) || last <= 0) return { stage: 'active', secondsLeft: null };

  const idle = now - last;
  if (idle >= limitMs) return { stage: 'expired', secondsLeft: 0 };
  if (idle >= limitMs - warningMs) {
    return { stage: 'warning', secondsLeft: Math.max(1, Math.ceil((limitMs - idle) / 1000)) };
  }
  return { stage: 'active', secondsLeft: null };
}
