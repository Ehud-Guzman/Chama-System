// Renders the app's home-screen icons from the same geometry as public/icon.svg.
//
// Why a generator rather than four checked-in PNGs: iOS will not take an SVG
// apple-touch-icon, Android wants a maskable variant, and hand-maintained binaries
// drift from the mark they are supposed to be. Run `node scripts/generate-icons.mjs`
// after any change to icon.svg.
//
// No image dependency: the artwork is rounded rectangles, so it is rasterised here
// (3x3 supersampling for the edges) and written with a minimal PNG encoder on top of
// Node's zlib. `npm install` stays as small as it was.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const VIEWBOX = 512;

const GREEN = [0x16, 0x65, 0x34];
const CARD = [0xf2, 0xf4, 0xf1];
const INK = [0x1b, 0x2b, 0x24];
const ACCENT = [0xa1, 0x62, 0x07];

// The same shapes as icon.svg, in paint order. A line with round caps is a rounded
// rectangle: 16px stroke on y=184 becomes 16px tall, 8px radius, 208px long.
const ARTWORK = [
  { x: 120, y: 104, w: 272, h: 304, r: 24, color: CARD },
  { x: 152, y: 176, w: 208, h: 16, r: 8, color: INK },
  { x: 152, y: 240, w: 208, h: 16, r: 8, color: ACCENT },
  { x: 152, y: 304, w: 144, h: 16, r: 8, color: INK },
];

function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  const cx = Math.min(Math.max(px, x + radius), x + w - radius);
  const cy = Math.min(Math.max(py, y + radius), y + h - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// `scale` maps viewBox units to pixels; `shift` centres a scaled-down artwork.
function sample(px, py, scale, maskable) {
  const vx = px / scale;
  const vy = py / scale;

  let color = maskable ? GREEN : null;
  if (!maskable && !insideRoundedRect(vx, vy, { x: 0, y: 0, w: VIEWBOX, h: VIEWBOX, r: 96 })) {
    return [0, 0, 0, 0]; // transparent outside the rounded square
  }

  const shrink = maskable ? 0.72 : 1;
  const shift = (1 - shrink) * (VIEWBOX / 2);

  for (const shape of ARTWORK) {
    const scaled = {
      ...shape,
      x: shape.x * shrink + shift,
      y: shape.y * shrink + shift,
      w: shape.w * shrink,
      h: shape.h * shrink,
      r: shape.r * shrink,
    };
    if (insideRoundedRect(vx, vy, scaled)) color = shape.color;
  }

  return [...(color || GREEN), 255];
}

function render(size, { maskable = false, scale = 1 } = {}) {
  const rows = [];
  const px = size / VIEWBOX;
  const samples = 3;

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const c = sample(
            (x + (sx + 0.5) / samples) / px,
            (y + (sy + 0.5) / samples) / px,
            scale,
            maskable
          );
          for (let i = 0; i < 4; i += 1) acc[i] += c[i];
        }
      }
      const off = 1 + x * 4;
      for (let i = 0; i < 4; i += 1) row[off + i] = Math.round(acc[i] / (samples * samples));
    }
    rows.push(row);
  }

  return encodePng(size, size, Buffer.concat(rows));
}

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const OUTPUTS = [
  ['icon-180.png', 180, { maskable: false }],
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, options] of OUTPUTS) {
  const png = render(size, options);
  writeFileSync(resolve(OUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
