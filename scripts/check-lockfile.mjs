#!/usr/bin/env node
// Fails (exit 1) if package-lock.json points anywhere but the npm registry or lacks integrity hashes. Run by CI.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockfileProblems } from './lib/lockfile.mjs';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package-lock.json');
const problems = lockfileProblems(JSON.parse(readFileSync(file, 'utf8')));
if (problems.length) {
  console.error(`package-lock.json: ${problems.length} problem(s)\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('package-lock.json: every package is from the npm registry with an integrity hash');
