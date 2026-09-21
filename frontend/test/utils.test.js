// The frontend's pure logic, under node's own test runner.
//
// The frontend had no tests at all, and installing a whole test framework to cover four small
// modules would have been the wrong first move: these files are plain ES modules with no DOM and no
// JSX, so `node --test` covers them with nothing added to package.json but a script. The components
// are still untested — that needs a DOM, and it is a separate decision — but everything here is the
// logic that decides what an admin is told, which is where false statements live.
//
//   npm test        (in frontend/)
import test from 'node:test';
import assert from 'node:assert/strict';

import { money, shortDate, formatBytes, isoDateOf, isSameCalendarDay } from '../src/utils/format.js';
import { normalizeNationalId, maskNationalId, nationalIdMissing } from '../src/utils/nationalId.js';
import { weakPasswordMessage } from '../src/utils/password.js';
import { whatsappLink, mailtoLink } from '../src/utils/messaging.js';

test('money prints the way a Kenyan reader expects', () => {
  assert.equal(money(1400), 'Ksh 1,400');
  assert.equal(money(0), 'Ksh 0');
  assert.equal(money(1234567), 'Ksh 1,234,567');
  // A credit balance — an overpaid week minus tea — is a real state here, not an error.
  assert.match(money(-250), /250/);
  // Garbage in must not become "Ksh NaN" on somebody's passbook.
  assert.equal(money(undefined), 'Ksh 0');
  assert.equal(money('not a number'), 'Ksh 0');
  // A string of digits from an input field is a number.
  assert.equal(money('1400'), 'Ksh 1,400');
});

test('dates and sizes read as short human values', () => {
  // `en-KE`, the way the treasurer's own phone shows a date: 02 Jan 2026.
  assert.match(shortDate('2026-01-02T09:00:00.000Z'), /^\d{2} \w{3,} \d{4}$/);
  // A missing date prints a dash rather than "Invalid Date".
  assert.equal(shortDate(null), '—');
  assert.equal(shortDate(''), '—');

  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');

  // A local calendar date, because a date input needs `yyyy-mm-dd` and a UTC read of an evening
  // instant lands on the previous day. Built from local components on purpose: the point of both
  // functions is that they follow the *phone's* calendar, so a test written in UTC would pass here
  // and fail for the treasurer.
  assert.equal(isoDateOf(new Date(2026, 0, 2, 12, 0, 0)), '2026-01-02');
  assert.equal(isoDateOf(new Date(2026, 0, 9, 23, 59, 0)), '2026-01-09');
  assert.equal(
    isSameCalendarDay(new Date(2026, 0, 2, 1, 0, 0), new Date(2026, 0, 2, 22, 0, 0)),
    true
  );
  assert.equal(
    isSameCalendarDay(new Date(2026, 0, 2, 12, 0, 0), new Date(2026, 0, 3, 12, 0, 0)),
    false
  );
  assert.equal(isSameCalendarDay(null, new Date(2026, 0, 2, 12, 0, 0)), false);
});

test('a national ID is judged the same way in the browser as at the gate', () => {
  // One ID, however it was typed: spaces, dashes, slashes and dots come out, letters go up.
  for (const written of ['12345678', ' 12 345 678 ', '12-345-678', '12/345/678', '12.345.678']) {
    assert.equal(normalizeNationalId(written), '12345678', written);
  }
  // A passport number's letters are kept.
  assert.equal(normalizeNationalId('ak 1234567'), 'AK1234567');

  // Refused: too short, too long, no digits at all, or nothing.
  assert.equal(normalizeNationalId('1234'), null);
  assert.equal(normalizeNationalId('ABCDEFG'), null);
  assert.equal(normalizeNationalId(''), null);
  assert.equal(normalizeNationalId(null), null);
  assert.equal(normalizeNationalId('9'.repeat(21)), null);

  // The gate's own note-to-self opens nothing — which is what the office's "members who cannot open
  // their record" count is counting.
  assert.equal(nationalIdMissing('not yet issued'), true);
  assert.equal(nationalIdMissing('12345678'), false);

  // Masked on screen, so a shared screenshot does not spell out the credential the gate rides on.
  assert.equal(maskNationalId('12345678'), '•••••678');
  assert.equal(maskNationalId('1234'), '1234'); // too short to hide anything meaningfully
});

test('the password rule matches the one the API enforces', () => {
  assert.equal(weakPasswordMessage('goodpass1'), null);
  assert.match(weakPasswordMessage('short1'), /at least 8/);
  assert.match(weakPasswordMessage('alllettersonly'), /letters and numbers/);
  assert.match(weakPasswordMessage('12345678'), /letters and numbers/);
  assert.match(weakPasswordMessage(''), /at least 8/);
});

test('the statement period picker builds the query the API expects', async () => {
  const { periodQuery, periodLabel } = await import('../src/utils/statementPeriod.js');

  // The whole book is the default and produces an *empty* query, so every existing link and
  // bookmark downloads exactly what it always did.
  assert.equal(periodQuery('whole', '', ''), '');
  assert.equal(periodQuery('', '', ''), '');
  assert.equal(periodQuery(undefined, '', ''), '');

  // The named ranges: resolved on the server, in East African time, against the same calendar the
  // week engine uses — this only passes the name through.
  assert.equal(periodQuery('this-year', '', ''), '&range=this-year');
  assert.equal(periodQuery('last-quarter', '', ''), '&range=last-quarter');
  assert.equal(periodQuery('last-month', '', ''), '&range=last-month');

  // A custom range: from is required, to is optional because an open-ended period runs to today.
  assert.equal(periodQuery('custom', '2026-03-01', ''), '&from=2026-03-01');
  assert.equal(periodQuery('custom', '2026-03-01', '2026-04-30'), '&from=2026-03-01&to=2026-04-30');
  // Nothing chosen yet is still the whole book rather than a request the API would refuse.
  assert.equal(periodQuery('custom', '', ''), '');

  // The fragment is always appended to a URL that already has a `?`, so it starts with `&`.
  for (const query of [periodQuery('this-year', '', ''), periodQuery('custom', '2026-03-01', '')]) {
    assert.match(query, /^&/);
    assert.equal(query.includes('?'), false);
  }

  // Every period has a name, and the whole book's is the one the buttons show by default.
  assert.equal(periodLabel('whole'), 'Everything (to date)');
  assert.equal(periodLabel('last-year'), 'Last year');
  assert.equal(periodLabel('nonsense'), '');
});

test('a phone number becomes one WhatsApp link however it was stored', () => {
  // Stored as 07XXXXXXXX, sent as 2547XXXXXXXX.
  assert.match(whatsappLink('0712345678', 'Habari'), /^https:\/\/wa\.me\/254712345678\?text=/);
  // Already international: unchanged.
  assert.match(whatsappLink('+254712345678', 'Habari'), /wa\.me\/254712345678\?/);
  assert.match(whatsappLink('254712345678', 'Habari'), /wa\.me\/254712345678\?/);

  // The message is encoded, because a reminder is a sentence with spaces and commas in it.
  assert.match(whatsappLink('0712345678', 'Week 92, 1,400'), /text=Week%2092%2C%201%2C400/);

  assert.match(mailtoLink('a@b.co', 'Subject', 'Body'), /^mailto:a@b\.co\?subject=Subject&body=Body$/);
});
