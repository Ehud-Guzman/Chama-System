// Upload screening.
//
// The declared Content-Type is what the client felt like typing, and these files
// are stored and then served back from the app's own origin — so the bytes decide.
// A spreadsheet renamed to look like a PDF, a script dressed as a photo and an SVG
// (an image that can carry <script>) all have to be refused before the database
// ever sees them.
const test = require('node:test');
const assert = require('node:assert/strict');

const { detectedFamily, verifyFileBytes } = require('../src/middleware/uploadDocument');

const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
const ole = () =>
  Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64),
  ]);
const text = (value) => Buffer.from(value, 'utf8');
const binary = () => Buffer.from(Array.from({ length: 128 }, (_, i) => i % 256));

test('the byte signature is what decides the type', () => {
  assert.equal(detectedFamily(pdf()), 'pdf');
  assert.equal(detectedFamily(png()), 'png');
  assert.equal(detectedFamily(jpeg()), 'jpeg');
  assert.equal(detectedFamily(zip()), 'zip');
  assert.equal(detectedFamily(ole()), 'ole');
  assert.equal(detectedFamily(text('name,phone\nA,0712345678\n')), 'text');
  assert.equal(detectedFamily(binary()), 'unknown');
});

test('a file whose contents disagree with its name is refused', () => {
  assert.throws(() => verifyFileBytes({ mimetype: 'application/pdf', buffer: zip() }), /contents are not/);
  assert.throws(() => verifyFileBytes({ mimetype: 'image/png', buffer: pdf() }), /contents are not/);
  // A member's spreadsheet uploaded as a scan: the CSV is text, the claim is a PDF.
  assert.throws(
    () => verifyFileBytes({ mimetype: 'application/pdf', buffer: text('name,amount\n') }),
    /contents are not/
  );
  // An executable's worth of NUL bytes claiming to be a spreadsheet.
  assert.throws(
    () => verifyFileBytes({ mimetype: 'text/csv', buffer: binary() }),
    /contents are not/
  );
});

test('legitimate documents pass', () => {
  assert.doesNotThrow(() => verifyFileBytes({ mimetype: 'application/pdf', buffer: pdf() }));
  assert.doesNotThrow(() => verifyFileBytes({ mimetype: 'image/jpeg', buffer: jpeg() }));
  assert.doesNotThrow(() => verifyFileBytes({ mimetype: 'image/heic', buffer: heic() }));
  assert.doesNotThrow(() =>
    verifyFileBytes({
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: zip(),
    })
  );
  // The old .doc/.xls compound format, which the office still uses.
  assert.doesNotThrow(() => verifyFileBytes({ mimetype: 'application/vnd.ms-excel', buffer: ole() }));
  assert.doesNotThrow(() => verifyFileBytes({ mimetype: 'text/csv', buffer: text('name,phone\n') }));
});

function heic() {
  const header = Buffer.alloc(12);
  header.write('ftyp', 4, 'latin1');
  return Buffer.concat([header, Buffer.alloc(64)]);
}
