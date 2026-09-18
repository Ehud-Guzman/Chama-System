#!/usr/bin/env node
// Refuses to let member data into the repository.
//
// This exists because the .gitignore rules were once too narrow: a spreadsheet
// named `ledger_weeks_62_84_template.xlsx` and another named `test.xlsx` both
// carried real names, amounts and phone numbers, and neither matched a pattern.
// A pattern list is a promise; this is a check.
//
// Run by CI on every push (`npm run check:data`), and worth running before a
// commit that touches backend/data:
//
//   node backend/scripts/checkNoDataFiles.mjs
//
// Exit 1 with the offending paths listed.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Anything that plausibly carries a roster, a ledger or a dump.
const DATA_FILE = /\.(xlsx|xls|csv|tsv|zip)$/i;
const ALLOWED = [
  // A genuinely empty template, reviewed by eye, is the only exception — and it
  // still has to be listed here deliberately.
];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

const tracked = trackedFiles();

const offenders = tracked.filter((file) => {
  if (ALLOWED.includes(file)) return false;
  const inDataDir = file.startsWith('backend/data/');
  const isSpreedsheetAnywhere = DATA_FILE.test(file) && file.startsWith('backend/');
  const isArchive = /\.json$/i.test(file) && inDataDir;
  return isSpreedsheetAnywhere || isArchive;
});

if (offenders.length === 0) {
  console.log('check:data  ok — no data files tracked');
  process.exit(0);
}

console.error('\n  Member data is tracked in this repository:\n');
for (const file of offenders) console.error(`    ${file}`);
console.error(
  [
    '',
    '  Every one of these holds names, phone numbers, amounts or a dump of them,',
    '  and this repository has been public. Remove them from the index and from',
    '  history before pushing:',
    '',
    '    git rm --cached <file>',
    '    # then see "Member data in this repository" in the README for the purge.',
    '',
  ].join('\n')
);
process.exit(1);
