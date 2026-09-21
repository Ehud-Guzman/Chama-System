// The backup-age rule, on its own.
//
// This is the check that stops the nag from being noise: a reminder that fires on a group which
// downloaded a copy yesterday is a reminder everybody learns to ignore, and one that stays quiet
// forever is the silence it was built to break. So the boundaries are pinned here — the day before
// the mark, the mark itself, and the day after — rather than left to whichever screen happens to
// compute it.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  describeBackupAge,
  DEFAULT_STALE_AFTER_DAYS,
} = require('../src/utils/backupHealth');

const DAY = 86400000;
const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW - n * DAY);

test('a recent copy is nobody\'s business', () => {
  for (const age of [0, 1, 7, 29]) {
    const result = describeBackupAge({ lastDownloadAt: daysAgo(age), now: NOW });
    assert.equal(result.daysAgo, age);
    assert.equal(result.never, false);
    assert.equal(result.stale, false, `${age} days old should not be stale`);
    // Nothing is said at all when there is nothing to say. That is what keeps the line that does
    // appear worth reading.
    assert.equal(result.note, null);
  }
});

test('the mark itself is not yet stale — the rule is "older than"', () => {
  const onTheMark = describeBackupAge({ lastDownloadAt: daysAgo(DEFAULT_STALE_AFTER_DAYS), now: NOW });
  assert.equal(onTheMark.daysAgo, 30);
  assert.equal(onTheMark.stale, false);
  assert.equal(onTheMark.note, null);

  const past = describeBackupAge({ lastDownloadAt: daysAgo(DEFAULT_STALE_AFTER_DAYS + 1), now: NOW });
  assert.equal(past.stale, true);
  assert.match(past.note, /31 days ago/);
  assert.match(past.note, /30-day mark/);
});

test('a group that has never downloaded one is stale, whatever the clock says', () => {
  const result = describeBackupAge({ lastDownloadAt: null, now: NOW });
  assert.equal(result.never, true);
  assert.equal(result.daysAgo, null);
  assert.equal(result.stale, true);
  // Not "0 days ago": there is no age to report, and saying one would read as a fresh backup.
  assert.match(result.note, /has ever been downloaded/);
  assert.doesNotMatch(result.note, /\d+ days ago/);
});

test('the mark can be moved without touching the rule', () => {
  const week = describeBackupAge({ lastDownloadAt: daysAgo(8), now: NOW, staleDays: 7 });
  assert.equal(week.stale, true);
  assert.match(week.note, /8 days ago/);

  const fortnight = describeBackupAge({ lastDownloadAt: daysAgo(8), now: NOW, staleDays: 14 });
  assert.equal(fortnight.stale, false);
});

test('a clock that disagrees with the record never reports a negative age', () => {
  // A download stamped a little in the future — a host whose clock drifted, or a hand-restored
  // record — must not read as "-1 days ago" or, worse, as stale.
  const result = describeBackupAge({ lastDownloadAt: new Date(NOW + 2 * 3600000), now: NOW });
  assert.equal(result.daysAgo, 0);
  assert.equal(result.stale, false);
});
