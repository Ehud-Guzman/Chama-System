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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uri = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/chama-rehearsal';
const suite = resolve(here, '..', 'test', 'integration', 'ledger.test.js');

console.log(`rehearsal suite against ${uri}\n`);

const result = spawnSync(process.execPath, ['--test', suite], {
  stdio: 'inherit',
  env: { ...process.env, TEST_MONGO_URI: uri },
});

if (result.status !== 0) {
  console.error(
    '\nIs the scratch MongoDB running?\n' +
      '  docker run -d --name chama-rehearsal -p 27017:27017 mongo:7\n'
  );
}

process.exit(result.status ?? 1);
