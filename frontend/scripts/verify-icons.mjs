// Validates the generated PNGs by parsing them back: chunk CRCs, IHDR dimensions and
// a full inflate of the image data, which must come out at exactly
// height * (1 + width * 4) bytes for an RGBA, filter-0 image.
//
// Kept next to the generator so `node scripts/verify-icons.mjs` is a one-command
// check after regenerating. Exit code 1 on any failure.
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

let failed = false;

for (const name of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  const buf = readFileSync(resolve(dir, name));
  const problems = [];

  const signature = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== signature) problems.push('bad signature');

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);
    const stored = buf.readUInt32BE(offset + 8 + length);
    if (crc32(buf.subarray(offset + 4, offset + 8 + length)) !== stored) {
      problems.push(`bad CRC in ${type}`);
    }
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) problems.push('expected 8-bit RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const expected = height * (1 + width * 4);
  if (raw.length !== expected) problems.push(`raw ${raw.length} bytes, expected ${expected}`);

  if (problems.length) {
    failed = true;
    console.log(`FAIL ${name}: ${problems.join('; ')}`);
  } else {
    console.log(`ok   ${name}  ${width}x${height}  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}

process.exit(failed ? 1 : 0);
