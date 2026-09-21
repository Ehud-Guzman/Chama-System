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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Anything that plausibly carries a roster, a ledger or a dump.
const DATA_FILE = /\.(xlsx|xls|csv|tsv|zip)$/i;
const ALLOWED = [
  // A genuinely empty template, reviewed by eye, is the only exception — and it
  // still has to be listed here deliberately.
];

// The second half of the check, and the reason it is not only about file extensions.
//
// A roster once sat in a tracked source file — `backend/src/scripts/createLedgerTemplate.js` listed
// all 32 of the group's members — and a check that only looks for `.xlsx` and `.json` walked right
// past it. Two member names were sitting in the test fixtures as well.
//
// The names themselves are NOT written here: this file is tracked, and putting them here would be
// the same mistake again. What is written down are truncated SHA-256 fingerprints of them. Every
// tracked text file is scanned for capitalised two-word runs — which is what a name looks like —
// and each one is hashed and compared.
//
// So the guard says exactly one thing: these particular names were exposed once, and if any of them
// comes back into a tracked file, the build fails.
const EXPOSED_NAME_HASHES = new Set([
  'da8e276a35acfd699e528110a955c1ec',
  '881d16a50e5d5712d657465fea13ec9a',
  '446d0f796fe0b940e38bffb8edad50dd',
  '4a6081bde06984bf79da3482a104316a',
  'ad2d4bf34f2879ba75080f201dbcdaba',
  'd5d0d8083831f8ee2b68c07eab0c7cd7',
  'e105e4ff782f6500e995f9905557ea55',
  'e90eebd614dcd7124dce777e6c432c99',
  '95afa5024c8997d6ff60c2e3ebb09542',
  '8f426bfef6ad1cf2f62f9080c0159650',
  'be81d6f1b754ce013f6060bca2e0704c',
  'c6c6617cdaedd0f2b6ffc89b48d134aa',
  '7b725c8e48f1fa1a26086be0f7d6110e',
  '22f95fd5595116ef0730f3e859d8f015',
  'ffe0967342ea7c72537cb083188fba36',
  '2aca8499d145b2a25c1b925fe95e045f',
  'a543d48f1ec675507dea92fb638bcfe3',
  'f30ed483069d0edbd124a62b8846694b',
  'd54d4cf739e7f50aadebc09efc0830b1',
  'c48e3b0dd865a37b43f7c9cbe4d28f01',
  'bddfaf3604679804d59e8b6de1132208',
  'f02bf5dfae3fde9b45a27505749dd562',
  '0688bf3bca3d72e543409d9be86400d1',
  '584cb27316fd0e02080e3432e50b374f',
  'fe97b0844c8ff9fab5997755878bff31',
  'b7c96c118a8d4fbb64ac3891f4a39e9f',
  '7d6c71dd8189d74179fbe254916548af',
  'bca32b8b7535afb32277a1ea03575e4c',
  '9510b318ded49e323e6a9f63980c27c5',
  'a2bf2083bebcadd8b743be9addca4b34',
  '19a9ddd2e50b69cd480bc0fce32ded0c',
  '993e1b1696b180b93af29fc99e767bbf',
]);

// Text worth scanning. The lockfiles are left out for time, not for forgiveness: nothing in them is
// typed by anybody, and a name in a dependency's metadata is not the group's member data.
const SCANNED = /\.(js|jsx|ts|tsx|mjs|cjs|md|txt|ya?ml|json|html|css|env|example)$/i;
const SKIPPED = [/^frontend\/package-lock\.json$/, /^backend\/package-lock\.json$/];

function hashOf(value) {
  return createHash('sha256').update(value.trim()).digest('hex').slice(0, 32);
}


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

// Names, in the files that could carry them. Scanned rather than pattern-matched by value, because
// the point is to catch these names specifically and never to guess at somebody's surname.
const nameHits = [];
for (const file of tracked) {
  if (!SCANNED.test(file)) continue;
  if (SKIPPED.some((skip) => skip.test(file))) continue;

  let text;
  try {
    text = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  } catch {
    continue; // unreadable or not really text; the extension check above covers the rest
  }

  // Capitalised two-word runs: 'Example Member' is one. Something like 'Install dependencies' is
  // also a run, and hashes to something not in the set — which is why this can be a plain scan
  // rather than a surname guess.
  for (const match of text.matchAll(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g)) {
    if (EXPOSED_NAME_HASHES.has(hashOf(match[0]))) {
      nameHits.push({ file, line: text.slice(0, match.index).split('\n').length });
    }
  }
}

if (offenders.length === 0 && nameHits.length === 0) {
  console.log('check:data  ok — no data files tracked, and no exposed member name in the tree');
  process.exit(0);
}

if (offenders.length > 0) {
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
}

if (nameHits.length > 0) {
  console.error('\n  A member name that has already been exposed is back in the tree:\n');
  for (const hit of nameHits) console.error(`    ${hit.file}:${hit.line}`);
  console.error(
    [
      '',
      '  These are fingerprints of the names that were in the leaked ledger template',
      '  (see the README). Use a plainly synthetic fixture instead — "Example Member"',
      '  — and keep the real names in a file outside the repository.',
      '',
    ].join('\n')
  );
}

process.exit(1);
