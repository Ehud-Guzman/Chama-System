// TOTP, checked against the RFCs rather than against itself.
//
// This is the one piece of the system where "it looked right when I tried it" is not
// good enough: a code that verifies against my own implementation but not against
// Google Authenticator locks every admin out of the books. So the tests below use the
// published vectors from RFC 4226 (HOTP, Appendix D) and RFC 6238 (TOTP, Appendix B),
// which are the numbers every authenticator app in the world was checked against.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  generateSecret,
  otpauthUrl,
  generateRecoveryCodes,
  matchRecoveryCode,
  recoveryHash,
} = require('../src/utils/totp');

// The RFCs' own secret: the ASCII digits 1…0 twice, 20 bytes.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('base32 matches the encoding the RFCs print', () => {
  assert.equal(base32Encode(RFC_SECRET), RFC_SECRET_BASE32);
  assert.deepEqual(base32Decode(RFC_SECRET_BASE32), RFC_SECRET);
});

test('base32 survives a round trip over random bytes', () => {
  for (const size of [1, 5, 10, 20, 32, 64]) {
    const bytes = crypto.randomBytes(size);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
});

test('base32 accepts what a person actually pastes', () => {
  // Lower case, spaces, the `=` padding some tools add, and the `-` separators others
  // insert. An admin copying a secret off a screen should not fail enrolment over any
  // of them.
  assert.deepEqual(base32Decode('gezd gnbvgy3t qojq-gezdgnbvgy3tqojq=='), RFC_SECRET);
});

test('base32 refuses a character that is not in the alphabet', () => {
  // 0, 1, 8 and 9 are the misreads; a secret containing one is a typo, not a secret.
  assert.throws(() => base32Decode('GEZDGNBV0Y3TQOJQ'), /not a base32 character/);
  assert.throws(() => base32Decode(''), /empty/);
});

test('HOTP reproduces RFC 4226 Appendix D exactly', () => {
  const expected = {
    0: '755224',
    1: '287082',
    2: '359152',
    3: '969429',
    4: '338314',
    5: '254676',
    6: '287922',
    7: '162583',
    8: '399871',
    9: '520489',
  };
  for (const [counter, code] of Object.entries(expected)) {
    assert.equal(hotp(RFC_SECRET, Number(counter)), code, `counter ${counter}`);
  }
});

test('TOTP reproduces RFC 6238 Appendix B exactly', () => {
  const expected = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, code] of expected) {
    assert.equal(totp(RFC_SECRET_BASE32, { at: seconds * 1000, digits: 8 }), code, `t=${seconds}`);
  }
});

test('a code is six digits and changes every thirty seconds', () => {
  // Aligned to a slot boundary: the point of the test is the boundary, so the clock
  // must not start halfway through one.
  const at = Math.floor(1_700_000_000_000 / 30_000) * 30_000;
  assert.match(totp(generateSecret(), { at }), /^\d{6}$/);
  // The same slot returns the same code — that is what makes it usable at all.
  assert.equal(totp(RFC_SECRET_BASE32, { at }), totp(RFC_SECRET_BASE32, { at: at + 29_000 }));
  // One second later, in the next slot, it does not.
  assert.notEqual(totp(RFC_SECRET_BASE32, { at }), totp(RFC_SECRET_BASE32, { at: at + 30_000 }));
});

test('verification accepts a code from the slot either side, and nothing further', () => {
  const at = 1_700_000_000_000;
  const previous = totp(RFC_SECRET_BASE32, { at: at - 30_000 });
  const current = totp(RFC_SECRET_BASE32, { at });
  const next = totp(RFC_SECRET_BASE32, { at: at + 30_000 });
  const tooOld = totp(RFC_SECRET_BASE32, { at: at - 60_000 });

  assert.equal(verifyTotp(RFC_SECRET_BASE32, current, { at }).ok, true);
  // One slot of slack is for clock drift and a slow phone, not for guessing.
  assert.equal(verifyTotp(RFC_SECRET_BASE32, previous, { at }).ok, true);
  assert.equal(verifyTotp(RFC_SECRET_BASE32, next, { at }).ok, true);
  assert.equal(verifyTotp(RFC_SECRET_BASE32, tooOld, { at }).ok, false);
});

test('verification reports back the slot it matched, and refuses a slot twice', () => {
  const at = 1_700_000_000_000;
  const code = totp(RFC_SECRET_BASE32, { at });

  const first = verifyTotp(RFC_SECRET_BASE32, code, { at });
  assert.equal(first.ok, true);

  // A code stays valid for its whole thirty seconds. Without the replay guard, somebody
  // who read it over a shoulder still has twenty seconds of use out of it.
  const second = verifyTotp(RFC_SECRET_BASE32, code, { at, lastUsedStep: first.step });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'mismatch');
});

test('verification rejects a code of the wrong shape without pretending it is a mismatch', () => {
  assert.deepEqual(verifyTotp(RFC_SECRET_BASE32, '12345', { at: 0 }), { ok: false, reason: 'format' });
  assert.equal(verifyTotp(RFC_SECRET_BASE32, '', { at: 0 }).ok, false);
  assert.equal(verifyTotp(RFC_SECRET_BASE32, null, { at: 0 }).ok, false);
});

test('a generated secret is 32 base32 characters and decodes to 20 bytes', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(secret).length, 20);
  // Two enrolments never share a secret.
  assert.notEqual(secret, generateSecret());
});

test('the otpauth URI is the one an authenticator app expects', () => {
  const url = otpauthUrl({
    secret: RFC_SECRET_BASE32,
    label: 'Wazo Moja:victor@example.com',
    issuer: 'Wazo Moja',
  });
  assert.ok(url.startsWith('otpauth://totp/'));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('secret'), RFC_SECRET_BASE32);
  assert.equal(parsed.searchParams.get('issuer'), 'Wazo Moja');
  assert.equal(parsed.searchParams.get('digits'), '6');
  assert.equal(parsed.searchParams.get('period'), '30');
  assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
});

test('recovery codes are single use and stored only as peppered hashes', () => {
  const { codes, hashes } = generateRecoveryCodes(3);
  assert.equal(codes.length, 3);
  assert.equal(hashes.length, 3);

  for (const code of codes) {
    // Grouped for reading off paper, and drawn only from characters that cannot be
    // confused with each other.
    assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    // The code itself is never stored.
    assert.ok(!hashes.includes(code));
  }

  // Spending one removes it and nothing else.
  const remaining = matchRecoveryCode(codes[0], hashes);
  assert.equal(remaining.length, 2);
  assert.ok(!remaining.includes(recoveryHash(codes[0])));
  assert.ok(remaining.includes(recoveryHash(codes[1])));

  // The same code cannot be spent twice.
  assert.equal(matchRecoveryCode(codes[0], remaining), null);
  // Nor can one that was never issued.
  assert.equal(matchRecoveryCode('AAAAA-BBBBB', hashes), null);
});

test('a recovery code is accepted however it was typed', () => {
  const { codes, hashes } = generateRecoveryCodes(1);
  const typed = codes[0].toLowerCase().replace('-', '');
  assert.equal(matchRecoveryCode(typed, hashes).length, 0);
});
