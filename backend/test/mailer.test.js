// The mailer, without a mail server.
//
// Everything here runs with the SMTP variables removed on purpose: the suite must never
// open a connection, because CI has no credentials and a test that emails a real person
// is worse than no test at all. What is checked is the part that decides what a person
// sees — configured from not, the sentence and status that come back when there is
// nowhere to send, and the two messages, including the escaping that keeps a member's
// name and a fine's reason out of the HTML.
//
// The environment is put back exactly as it was found: a developer with a live SMTP
// configuration exported in his shell must not have this file send anything, or pass
// because of it.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanEmail,
  isValidEmail,
  isMailConfigured,
  assertMailConfigured,
  describeMailConfig,
  describeMailError,
  isConnectionFailure,
  describeMailEndpoint,
  mailFailure,
  resolveIpv4,
  transportOptions,
  sendMail,
  verifyMail,
  buildReminderEmail,
  buildTestEmail,
} = require('../src/utils/mailer');

const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'MAIL_FROM', 'MAIL_REPLY_TO'];
const SAVED = {};

// The rejection this module writes when there is nothing to send with, which several
// tests need: raised, caught, returned.
function notConfiguredError() {
  try {
    assertMailConfigured();
    return null;
  } catch (err) {
    return err;
  }
}

const clearMailEnv = () => {
  for (const key of KEYS) delete process.env[key];
};

test.before(() => {
  for (const key of KEYS) SAVED[key] = process.env[key];
  clearMailEnv();
});

test.after(() => {
  for (const key of KEYS) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
});

test('configured means both halves are present', () => {
  assert.equal(isMailConfigured(), false);

  process.env.SMTP_HOST = 'smtp.example.test';
  assert.equal(isMailConfigured(), false, 'a host with no MAIL_FROM cannot send as anybody');

  process.env.MAIL_FROM = 'chama@example.test';
  assert.equal(isMailConfigured(), true);

  clearMailEnv();
});

test('with nothing configured, every sender refuses with an explanation', async () => {
  const thrown = notConfiguredError();

  assert.ok(thrown, 'assertMailConfigured must throw when nothing is configured');
  assert.equal(thrown.status, 503);
  // `expose` is what carries this sentence to the office in production; without it
  // middleware/errorHandler replaces it with "Something went wrong" and the README's
  // promise of an explanation is a lie.
  assert.equal(thrown.expose, true);
  assert.match(thrown.message, /SMTP_HOST/);

  // The senders refuse the same way, before any connection is attempted — there is no
  // mail server here to talk to, so these passing is also proof that none was tried.
  await assert.rejects(
    () => sendMail({ to: 'member@example.test', subject: 'x', text: 'x' }),
    (err) => err.status === 503 && /not set up yet/.test(err.message)
  );
  await assert.rejects(() => verifyMail(), (err) => err.status === 503);
});

test('the provider is resolved to IPv4, and a lookup that fails is left to nodemailer', async () => {
  const calls = [];
  const lookup = async (hostname, options) => {
    calls.push({ hostname, options });
    return { address: '203.0.113.7', family: 4 };
  };

  assert.equal(await resolveIpv4('smtp.example.test', lookup), '203.0.113.7');
  // Only IPv4 is ever asked for. An IPv6 address chosen from a full answer is what put
  // the deployed API on an address its host could not reach.
  assert.deepEqual(calls, [{ hostname: 'smtp.example.test', options: { family: 4 } }]);

  // An address needs no resolving, and one already written as IPv6 is somebody's
  // deliberate choice rather than something to quietly override.
  const never = async () => {
    throw new Error('the lookup must not be reached');
  };
  assert.equal(await resolveIpv4('203.0.113.7', never), null);
  assert.equal(await resolveIpv4('2606:4700::1111', never), null);

  // A lookup that fails says "nodemailer, you resolve it" — never "no mail today".
  const broken = async () => {
    throw new Error('ENOTFOUND');
  };
  assert.equal(await resolveIpv4('smtp.example.test', broken), null);
});

test('the transport connects to the address it resolved, and still names the host in TLS', () => {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'chama@example.test';
  process.env.SMTP_PASS = 'a-google-app-password';

  const options = transportOptions({
    hostname: 'smtp.example.test',
    address: '203.0.113.7',
    port: 587,
  });

  assert.equal(options.host, '203.0.113.7');
  assert.equal(options.port, 587);
  assert.equal(options.secure, false);
  assert.equal(options.pool, true);
  // The certificate is issued to the hostname, so the connection has to name it: without
  // this, connecting to the literal would fail verification rather than fall back to it.
  assert.deepEqual(options.tls, { servername: 'smtp.example.test' });
  // A ceiling per send, or one silent provider holds a request open past the client's own.
  assert.ok(options.connectionTimeout > 0 && options.socketTimeout > 0);

  // With nothing resolved, the connection is exactly what it was before this existed.
  const plain = transportOptions({ hostname: 'smtp.example.test', address: null, port: 587 });
  assert.equal(plain.host, 'smtp.example.test');
  assert.equal(plain.tls, undefined);

  // 465 is implicit TLS, as everywhere else in this module.
  assert.equal(
    transportOptions({ hostname: 'smtp.example.test', address: null, port: 465 }).secure,
    true
  );

  clearMailEnv();
});

test('a failure before the provider spoke says where it tried, and what that means', () => {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_PORT = '587';

  assert.equal(describeMailEndpoint(), 'smtp.example.test:587');

  // The codes that mean "the socket never got there": nothing about the credentials, the
  // sender or the message was ever tested.
  assert.equal(isConnectionFailure(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' })), true);
  assert.equal(isConnectionFailure(Object.assign(new Error('x'), { code: 'ESOCKET' })), true);
  assert.equal(isConnectionFailure(Object.assign(new Error('x'), { code: 'ENETUNREACH' })), true);
  // And the ones that mean the provider answered: the credentials, the sender or the
  // message are exactly what is being judged.
  assert.equal(isConnectionFailure(Object.assign(new Error('x'), { responseCode: 535 })), false);
  assert.equal(isConnectionFailure(new Error('x')), false);
  assert.equal(isConnectionFailure(null), false);

  // "Connection timeout" alone tells nobody where to look, and the port a host will not
  // open is the one thing the office can do something about.
  const timeout = mailFailure(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }));
  assert.equal(timeout.status, 503);
  assert.equal(timeout.expose, true);
  assert.match(timeout.message, /Nothing answered at smtp\.example\.test:587/);
  assert.match(timeout.message, /ETIMEDOUT/);
  assert.match(timeout.message, /2525/);

  // A rejection is a different sentence, because it has a different fix — and it must not
  // send anybody off to look at firewalls.
  const rejected = mailFailure(
    Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
      responseCode: 535,
    })
  );
  assert.match(rejected.message, /refused the message: Invalid login: 535/);
  assert.equal(/2525/.test(rejected.message), false);

  // The "nothing is set up" rejection already reads as it should, and is passed through
  // rather than wrapped in a sentence about a connection it never attempted.
  const notConfigured = notConfiguredError();
  assert.equal(mailFailure(notConfigured), notConfigured);

  clearMailEnv();
  assert.equal(describeMailEndpoint(), null);
});

test('the status says where mail would go, and never the credentials', () => {
  assert.deepEqual(describeMailConfig(), {
    configured: false,
    from: null,
    host: null,
    port: 587,
    secure: false,
  });

  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.MAIL_FROM = 'Chama <chama@example.test>';
  process.env.SMTP_USER = 'chama@example.test';
  process.env.SMTP_PASS = 'a-google-app-password';

  const configured = describeMailConfig();
  assert.equal(configured.configured, true);
  assert.equal(configured.host, 'smtp.example.test');
  assert.equal(configured.port, 587);
  assert.equal(configured.secure, false);
  assert.equal(configured.from, 'Chama <chama@example.test>');

  // The settings travel to the screen; the login and the password never do.
  const serialised = JSON.stringify(configured);
  assert.equal(serialised.includes('a-google-app-password'), false);
  assert.equal(serialised.includes('SMTP_PASS'), false);

  // 465 is implicit TLS, and SMTP_SECURE overrides that either way. The status has to
  // agree with the transport it describes, or the screen reports a port the transport
  // is not using.
  process.env.SMTP_PORT = '465';
  assert.equal(describeMailConfig().secure, true);
  assert.equal(describeMailConfig().port, 465);

  process.env.SMTP_SECURE = 'false';
  assert.equal(describeMailConfig().secure, false);

  clearMailEnv();
});

test('a failed send is described by its code and its own sentence', () => {
  assert.equal(describeMailError(new Error('Connection timeout')), 'Connection timeout');
  assert.equal(describeMailError(undefined), 'unknown error');

  const coded = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
  assert.equal(describeMailError(coded), 'ETIMEDOUT: Connection timeout');

  // The provider's answer, which is the whole reason a 535 is worth showing verbatim:
  // it names a revoked app password, and nothing else does.
  const rejected = Object.assign(
    new Error('Invalid login: 535-5.7.8 Username and Password not accepted'),
    { responseCode: 535 }
  );
  assert.match(describeMailError(rejected), /Username and Password not accepted/);

  // Truncated: this text goes into a 503 body, and an SMTP server can answer with a page.
  assert.ok(describeMailError(new Error('x'.repeat(500))).length <= 300);
});

test('a reminder says what the member owes, and only what he owes', () => {
  const lateWeeks = [
    { weekNumber: 96, typeName: 'Weekly contribution', shortfall: 300 },
    { weekNumber: 97, typeName: 'Weekly contribution', shortfall: 200 },
  ];
  const fines = [{ reason: 'Late to meeting', remaining: 100 }];

  const { subject, text, html } = buildReminderEmail({
    chamaName: 'WAZO MOJA SELF-HELP GROUP',
    member: { name: 'Mary Wanjiku' },
    lateWeeks,
    fines,
    note: 'Please clear your balance before Thursday.',
  });

  assert.equal(subject, 'WAZO MOJA SELF-HELP GROUP: contributions and fines still outstanding');
  assert.match(text, /Hi Mary,/);
  assert.match(text, /Week 96 — Weekly contribution: Ksh 300 short/);
  assert.match(text, /Late to meeting: Ksh 100/);
  assert.match(text, /Total outstanding: Ksh 600/);
  assert.match(text, /Please clear your balance before Thursday\./);
  assert.match(html, /Total outstanding: <strong>Ksh 600<\/strong>/);

  // A member who owes one of the two is told about one of the two, and the subject says
  // which — the inbox line alone then tells him whether to read it now.
  const contributionsOnly = buildReminderEmail({
    chamaName: 'Chama',
    member: { name: 'Abel' },
    lateWeeks,
  });
  assert.equal(contributionsOnly.subject, 'Chama: contributions still outstanding');
  assert.equal(/fines/.test(contributionsOnly.text), false);

  const finesOnly = buildReminderEmail({ chamaName: 'Chama', member: { name: 'Abel' }, fines });
  assert.equal(finesOnly.subject, 'Chama: fine payment outstanding');
});

test('a name or a reason cannot put markup into the message', () => {
  const { html } = buildReminderEmail({
    chamaName: '<b>Chama</b>',
    member: { name: '<script>alert(1)</script> Wanjiku' },
    fines: [{ reason: '<img src=x onerror=alert(1)>', remaining: 50 }],
  });

  // No tag survives — not from the member's name, not from the fine's reason, not from
  // the chama's own name. The text of the attempt is still readable as text, which is
  // the point of escaping rather than stripping it.
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<b>Chama</b>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the test message says what it proves, and does not read as a bill', () => {
  const { subject, text, html } = buildTestEmail({ chamaName: 'WAZO MOJA SELF-HELP GROUP' });

  assert.equal(subject, 'WAZO MOJA SELF-HELP GROUP: test email from the chama system');
  assert.match(text, /test message/);
  assert.match(text, /check his address on his member record/);
  assert.equal(/Ksh/.test(text), false, "a test must not look like a member's balance");
  assert.match(html, /test message/);

  // A chama with no name set still produces something a person can read, and a name is
  // escaped on the way into the HTML like every other value.
  assert.equal(buildTestEmail({}).subject, 'the chama: test email from the chama system');
  assert.equal(buildTestEmail({ chamaName: '<b>x</b>' }).html.includes('<b>x</b>'), false);
});

test('an address is trimmed, and an empty one is allowed', () => {
  assert.equal(cleanEmail('  a@b.test '), 'a@b.test');
  assert.equal(cleanEmail(null), '');
  // Empty is valid: email is optional on a member's record and for his next of kin.
  assert.equal(isValidEmail(''), true);
  assert.equal(isValidEmail('a@b.test'), true);
  assert.equal(isValidEmail('not-an-address'), false);
});
