// Prints the size of everything a first-time visitor to "/" must download, in the
// same shape the browser sees it: gzip, because that is what crosses the network.
//
// Run after `npm run build`. The budget this was written against: the members' page
// should stay under about 150 KB gzip on the critical path, because 70% of the
// people who open it are on a phone on Kenyan mobile data.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
const assets = [
  ...html.matchAll(/(?:href|src)="\/assets\/([^"]+)"/g),
].map((match) => match[1]);

let total = 0;

for (const file of [...new Set(assets)]) {
  const bytes = readFileSync(resolve(DIST, 'assets', file));
  const gzip = gzipSync(bytes).length;
  total += gzip;
  console.log(
    file.padEnd(52),
    `${(bytes.length / 1024).toFixed(1).padStart(7)} KB raw`,
    `${(gzip / 1024).toFixed(1).padStart(7)} KB gzip`
  );
}

const htmlGzip = gzipSync(Buffer.from(html)).length;
const critical = (total + htmlGzip) / 1024;
console.log('index.html'.padEnd(52), ''.padStart(7), `${(htmlGzip / 1024).toFixed(2).padStart(9)} KB gzip`);
console.log('-'.repeat(76));
console.log(
  'CRITICAL PATH (document + js + css + font):'.padEnd(52),
  `${critical.toFixed(1).padStart(20)} KB gzip`
);

// A budget that is only a comment in a README is a budget that gets spent. `--max=150` makes the
// script the gate: CI runs it and a pull request that puts the members' page over the line fails,
// which is the point of writing the number down in the first place.
const maxArg = process.argv.slice(2).find((arg) => arg.startsWith('--max='));
if (maxArg) {
  const max = Number(maxArg.slice('--max='.length));
  if (!Number.isFinite(max) || max <= 0) {
    console.error(`\n  --max=${maxArg.split('=')[1]} is not a size in KB.\n`);
    process.exit(2);
  }
  if (critical > max) {
    console.error(`\n  ✗ ${critical.toFixed(1)} KB gzip is over the ${max} KB budget.`);
    console.error('    Anything over ~50 KB belongs behind a lazy `await import()` (see App.jsx),');
    console.error('    and the members\' page must never carry the editor or a spreadsheet library.\n');
    process.exit(1);
  }
  console.log(`\n  ✓ within the ${max} KB budget (${(max - critical).toFixed(1)} KB spare).\n`);
}
