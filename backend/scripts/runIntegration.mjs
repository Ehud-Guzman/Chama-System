#!/usr/bin/env node
// Runs the rehearsal suite against a scratch MongoDB.
//
// A wrapper rather than an env var in the npm script, because `VAR=value node ...` does
// not work in npm scripts on Windows and this repository is worked on from Windows.
//
//   npm run test:integration                      # 127.0.0.1:27017 (docker below)
//   TEST_MONGO_URI=mongodb://host:27017/chama-x npm run test:integration
//
//   docker run -d --name chama-rehearsal -p 27017:27017 mongo:7
//
// The suite creates and drops its own databases, refuses to run against a URI that does
// not look like a scratch one, and never touches the live database.
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uri = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/chama-rehearsal';
// Every suite in test/integration, so a new one is picked up by adding the file: the money
// paths in ledger.test.js, and the audit chain and scheduled jobs in maintenance.test.js.
const suites = readdirSync(resolve(here, '..', 'test', 'integration'))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => resolve(here, '..', 'test', 'integration', name));

console.log(`rehearsal suite against ${uri}\n`);
console.log(`  ${suites.length} suite(s): ${suites.map((file) => basename(file)).join(', ')}\n`);

let status = 0;
for (const suite of suites) {
  // Sequential, one process per suite: each creates and drops its own database, and running
  // them together would have two suites dropping the same scratch database mid-test.
  const result = spawnSync(process.execPath, ['--test', suite], {
    stdio: 'inherit',
    env: { ...process.env, TEST_MONGO_URI: uri },
  });
  if (result.status !== 0) status = result.status ?? 1;
}

if (status !== 0) {
  console.error(
    '\nIs the scratch MongoDB running?\n' +
      '  docker run -d --name chama-rehearsal -p 27017:27017 mongo:7\n'
  );
}

process.exit(status);
