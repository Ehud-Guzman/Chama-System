// Time-based one-time passwords, in the same spirit as the rest of utils/: no
// dependency where thirty lines of stdlib will do.
//
// This is RFC 4226 (HOTP) and RFC 6238 (TOTP) — the algorithm Google
// Authenticator, Authy, 1Password, Microsoft Authenticator and Aegis all
// implement. Because it is a published standard, an admin can enrol with whichever
// authenticator app is already on his phone; nothing about the chama has to be
// installed for him to sign in.
//
// Why it exists: an admin account can move a member's money, and the JWT in
// localStorage is the only thing between a password and the books. A password can
// be read over a shoulder, guessed, or reused from an older leak — the leak this
// repository had is exactly that kind of material. A six-digit code that changes
// every thirty seconds cannot be reused by whoever learns it later.
//
// The three parameters are fixed to the defaults the apps assume (SHA-1, 6 digits,
// 30 seconds) and are not configurable. That is deliberate: a group that never had
// 2FA does not need a knob for the HMAC algorithm, and a second setting is a second
// way for four phones to disagree about the same code.
const crypto = require('crypto');

const DIGITS = 6;
const STEP_SECONDS = 30;
const ALGORITHM = 'sha1';
// 160 bits, which is what RFC 4226 specifies and what the authenticator apps size
// their own UI around. The string a person pastes is 32 characters.
const SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// -----------------------------------------------------------------------------
// Base32 (RFC 4648, no padding)
// -----------------------------------------------------------------------------
// Authenticator apps speak base32 for the shared secret and nothing else. Padding
// is not written, and anything a person might paste — spaces, lower case, the `=`
// padding some tools add, the `-` separators others insert — is accepted on the way
// in, because the alternative is an admin failing enrolment over a character his
// password manager added.

function base32Encode(buffer) {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    // Drop the bits that have been emitted. Without this the accumulator keeps
    // growing past 32 bits and `<< 8` starts discarding live bits.
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  const clean = String(input == null ? '' : input)
    .toUpperCase()
    .replace(/[\s=-]/g, '');
  if (!clean) throw new Error('The 2FA secret is empty');

  const out = [];
  let value = 0;
  let bits = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    // 0, 1, 8 and 9 are not in the alphabet — the set most often misread, and the
    // set most often pasted by hand.
    if (index === -1) throw new Error(`"${char}" is not a base32 character`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (out.length === 0) throw new Error('The 2FA secret is too short');
  return Buffer.from(out);
}

// -----------------------------------------------------------------------------
// The codes
// -----------------------------------------------------------------------------

function stepFor(atMs, stepSeconds = STEP_SECONDS) {
  return Math.floor(Number(atMs) / 1000 / stepSeconds);
}

// HOTP: HMAC the counter, then fold the digest down to a decimal code.
//
// The `& 0x7f` on the first byte, and which four bytes are read, both come from the
// RFC — this is not arithmetic anyone should "clean up".
function hotp(secret, counter, { digits = DIGITS, algorithm = ALGORITHM } = {}) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = crypto.createHmac(algorithm, key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

function totp(secret, { at = Date.now(), digits = DIGITS, algorithm = ALGORITHM, step = STEP_SECONDS } = {}) {
  return hotp(secret, stepFor(at, step), { digits, algorithm });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}


// Checks a code the admin typed. Returns `{ ok, step }` or `{ ok: false, reason }`
// so the controller can tell "you fat-fingered it" from "that code is from
// yesterday" without leaking either to the caller.
//
// `window` = 1 accepts the previous, current and next thirty-second slot. One slot
// either side is what every authenticator app documents, and it exists for clock
// drift and a slow phone, not for tolerance of guessing — three codes out of a
// million is not a meaningful widening.
//
// `lastUsedStep` is the replay guard, and it is why this returns the step it
// matched: a code stays valid for its whole thirty seconds, so without recording
// the accepted slot a code read over a shoulder is still good for the next twenty
// seconds to whoever saw it. The same slot is never accepted twice.
function verifyTotp(
  secret,
  code,
  { at = Date.now(), window = 1, digits = DIGITS, algorithm = ALGORITHM, step = STEP_SECONDS, lastUsedStep = null } = {}
) {
  const clean = String(code == null ? '' : code).replace(/\D/g, '');
  if (clean.length !== digits) return { ok: false, reason: 'format' };

  const current = stepFor(at, step);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = current + offset;
    if (candidate < 0) continue;
    if (lastUsedStep != null && candidate <= lastUsedStep) continue;
    if (timingSafeEqual(hotp(secret, candidate, { digits, algorithm }), clean)) {
      return { ok: true, step: candidate };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

// -----------------------------------------------------------------------------
// Enrolment
// -----------------------------------------------------------------------------

function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

// The `otpauth://` URI an authenticator app understands, carried in the QR code the
// enrolment screen draws. `label` is what the app lists the account as, and the
// issuer is what it shows as the heading, so the two together read as
// "Wazo Moja — Victor".
function otpauthUrl({ secret, label, issuer }) {
  const params = new URLSearchParams({
    secret: String(secret),
    issuer: String(issuer || ''),
    algorithm: ALGORITHM.toUpperCase(),
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(String(label))}?${params.toString()}`;
}

// -----------------------------------------------------------------------------
// Recovery codes
// -----------------------------------------------------------------------------
// An admin with 2FA enabled whose phone is lost, broken or replaced is locked out of
// the group's books. These are the way back in that does not require somebody else to
// be awake: ten single-use codes, kept by the person, each good once.
//
// They are stored as HMAC-SHA256 over the code, keyed on JWT_SECRET. Bcrypt would be
// the reflex, but it is the wrong tool here: verification happens on the path an admin
// is locked out on and would cost most of a second per code, and a recovery code is
// not a password — it is 50 bits of server-generated randomness, so a slow salted hash
// buys nothing that a pepped fast one does not already have. The pepper means a dump
// of the accounts table alone cannot be worked through offline.
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I/L
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_CODE_COUNT = 10;

function recoveryHash(code) {
  const pepper = process.env.JWT_SECRET || 'chama-recovery';
  const clean = String(code == null ? '' : code)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  return crypto.createHmac('sha256', pepper).update(clean).digest('hex');
}

// Written grouped in two halves because these get copied onto paper and read back by
// hand, which is exactly where 0/O and 1/I/L get confused.
function formatRecoveryCode(raw) {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  const hashes = [];
  for (let index = 0; index < count; index += 1) {
    let raw = '';
    for (let char = 0; char < RECOVERY_CODE_LENGTH; char += 1) {
      raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.push(formatRecoveryCode(raw));
    hashes.push(recoveryHash(raw));
  }
  return { codes, hashes };
}

// Spends one code: returns the remaining hashes, or null when the code is not one of
// them. The hash is removed rather than flagged, so a code cannot be used twice.
function matchRecoveryCode(code, hashes = []) {
  const wanted = recoveryHash(code);
  const index = hashes.findIndex((hash) => timingSafeEqual(hash, wanted));
  if (index === -1) return null;
  return hashes.filter((_, position) => position !== index);
}

module.exports = {
  DIGITS,
  STEP_SECONDS,
  base32Encode,
  base32Decode,
  stepFor,
  hotp,
  totp,
  verifyTotp,
  generateSecret,
  otpauthUrl,
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  recoveryHash,
  generateRecoveryCodes,
  matchRecoveryCode,
};
