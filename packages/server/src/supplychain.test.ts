// Pins the install-script setting from the 2026-11 audit (docs/security-audit-2026-11.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('dependency install scripts are switched off for everyone (npm ci, npm install, Update & Restart)', () => {
  assert.match(readFileSync(fileURLToPath(new URL('../../../.npmrc', import.meta.url)), 'utf8'), /^ignore-scripts=true$/m);
});
