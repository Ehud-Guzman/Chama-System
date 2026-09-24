// Who gets told, and who is spared.
//
// The two fine emails (utils/fineEmails) are automatic, and the decision "does this
// member get one?" is the part with consequences: a member with no address must not
// produce a failed send in the log at every fine, and a member who asked us to stop
// must be left alone. That decision is a pure function here, so the test needs no
// database, no SMTP account and no member record.
//
// The environment is put back exactly as it was found: a developer with a live SMTP
// configuration exported in his shell must not have this file send anything, or pass
// because of it.
const test = require('node:test');
const assert = require('node:assert/strict');

const { fineEmailsEnabled, fineEmailSkipReason } = require('../src/utils/fineEmails');
const {
  buildFineIssuedEmail,
  buildFineSettledEmail,
  isMailConfigured,
} = require('../src/utils/mailer');

const KEYS = ['SMTP_HOST', 'MAIL_FROM', 'MAIL_API_PROVIDER', 'MAIL_API_KEY', 'FINE_EMAILS'];
const SAVED = {};

test.before(() => {
  for (const key of KEYS) SAVED[key] = process.env[key];
  for (const key of ['SMTP_HOST', 'MAIL_FROM', 'MAIL_API_PROVIDER', 'MAIL_API_KEY']) {
    delete process.env[key];
  }
  delete process.env.FINE_EMAILS;
});

test.after(() => {
  for (const key of KEYS) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
});

const MEMBER = { _id: 'm1', name: 'Ann Wanjiru', email: 'ann@example.test' };

// A deployed mail configuration, so the skip reason being tested is the one under test
// rather than "nothing is configured". Nothing is ever sent: nothing below calls a
// sender.
function withMailConfigured() {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.MAIL_FROM = 'chama@example.test';
}

function withoutMail() {
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
}

test('fine emails are on by default, and a deployment can switch them off', () => {
  assert.equal(fineEmailsEnabled(), true, 'recording a fine is a deliberate act, so this is on');

  for (const value of ['off', 'OFF', 'false', 'no', '0', 'disabled']) {
    process.env.FINE_EMAILS = value;
    assert.equal(fineEmailsEnabled(), false, `${value} must switch them off`);
  }

  process.env.FINE_EMAILS = 'on';
  assert.equal(fineEmailsEnabled(), true);
  delete process.env.FINE_EMAILS;
  assert.equal(fineEmailsEnabled(), true);
});

test('the switch is the first reason, before anything about the member', () => {
  withMailConfigured();
  process.env.FINE_EMAILS = 'off';

  assert.match(fineEmailSkipReason(MEMBER), /FINE_EMAILS/);
  // Even a member with no address at all is refused for the switch first: the reason
  // recorded should be about the deployment, not about him.
  assert.match(fineEmailSkipReason({ _id: 'm2', name: 'No Email' }), /FINE_EMAILS/);

  delete process.env.FINE_EMAILS;
});

test('a member is skipped, and told why, in the order that helps the office', () => {
  withMailConfigured();

  assert.equal(fineEmailSkipReason(MEMBER), null, 'a reachable member is not skipped');

  assert.match(fineEmailSkipReason(null), /Member not found/);
  assert.match(fineEmailSkipReason({ _id: 'm2', name: 'No Email' }), /No email address on file/);
  assert.match(fineEmailSkipReason({ _id: 'm3', name: 'Blank', email: '   ' }), /No email address/);
  // He asked us to stop, and that outranks everything except the deployment switch.
  assert.match(
    fineEmailSkipReason({ ...MEMBER, emailNotifications: false }),
    /switched email notifications off/
  );
});

test('with no mail configured, nothing is sent and the reason says so', () => {
  withoutMail();
  assert.equal(isMailConfigured(), false);

  const reason = fineEmailSkipReason(MEMBER);
  assert.match(reason, /not set up/);
  // The message names what to set, because "email did not go" with no next step is the
  // answer that wastes an afternoon.
  assert.match(reason, /deployment/);
});

test('the fine-issued message states the amount, the reason and what is left', () => {
  const { subject, text, html } = buildFineIssuedEmail({
    chamaName: 'Wazo Moja Self-Help Group',
    member: MEMBER,
    fine: {
      typeName: 'Late coming',
      reason: 'Arrived after the roll call',
      amount: 500,
      remaining: 500,
      date: new Date('2026-09-10'),
    },
  });

  assert.match(subject, /Wazo Moja Self-Help Group/);
  assert.match(subject, /Ksh 500/);
  assert.match(text, /Hi Ann,/);
  assert.match(text, /Late coming — Arrived after the roll call: Ksh 500/);
  assert.match(text, /What is still owed: Ksh 500/);
  assert.match(text, /10 Sept 2026/);
  assert.match(html, /Ksh 500/);
});

test('a partly-paid fine says what is owed, not the original figure', () => {
  const { text } = buildFineIssuedEmail({
    chamaName: 'Wazo Moja',
    member: MEMBER,
    fine: { typeName: 'Absence', amount: 1000, remaining: 400, date: new Date('2026-09-01') },
  });

  assert.match(text, /: Ksh 1,000/);
  assert.match(text, /What is still owed: Ksh 400/);
});

test('the payment message lists every fine the money cleared, and what is left', () => {
  const { subject, text, html } = buildFineSettledEmail({
    chamaName: 'Wazo Moja',
    member: MEMBER,
    payments: [
      { label: 'Late coming', amount: 200, remaining: 0 },
      { label: 'Absence', amount: 100, remaining: 300 },
    ],
    totalPaid: 300,
    paidAt: new Date('2026-09-12'),
  });

  assert.match(subject, /Ksh 300/);
  assert.match(text, /Amount paid: Ksh 300 \(12 Sept 2026\)/);
  assert.match(text, /Late coming: Ksh 200 — cleared/);
  assert.match(text, /Absence: Ksh 100 — Ksh 300 still owed/);
  assert.match(text, /You still owe Ksh 300/);
  assert.match(html, /Ksh 200/);
});

test('a member\u2019s own words cannot become markup in either message', () => {
  const issued = buildFineIssuedEmail({
    chamaName: 'Wazo Moja',
    member: { name: '<script>alert(1)</script> Wanjiru', email: 'ann@example.test' },
    fine: { typeName: 'Misconduct', reason: '<img src=x onerror=1>', amount: 100, remaining: 100 },
  });

  assert.ok(!/<script>/.test(issued.html), 'a name is escaped');
  assert.ok(!/<img/.test(issued.html), 'a reason is escaped');

  const paid = buildFineSettledEmail({
    chamaName: 'Wazo Moja',
    member: MEMBER,
    payments: [{ label: '<b>Fine</b>', amount: 100, remaining: 0 }],
    totalPaid: 100,
  });

  assert.ok(!/<b>Fine<\/b>/.test(paid.html), 'a label is escaped');
  // Still readable as text, rather than dropped.
  assert.match(paid.html, /&lt;b&gt;/);
});

