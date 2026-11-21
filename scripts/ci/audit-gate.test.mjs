import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, validateAllowlist } from './audit-gate.mjs';

const today = new Date('2026-11-20T12:00:00Z');
const audit = (vulns) => ({ vulnerabilities: vulns });
const vuln = (severity, ghsaIds = [], fixAvailable = true) => ({ severity, fixAvailable, via: ghsaIds.map((g) => ({ source: 1, url: `https://github.com/advisories/${g}`, severity })) });
const entry = (over = {}) => ({ advisory: 'GHSA-aaaa-bbbb-cccc', reason: 'dev-only path, no patched release yet', expires: '2026-12-31', ...over });

test('no advisories: passes', () => assert.deepEqual(evaluate(audit({}), [], today), { problems: [], blocking: [], waived: [] }));

test('high and critical block; moderate and low do not', () => {
  const r = evaluate(audit({ a: vuln('high', ['GHSA-1111-2222-3333']), b: vuln('critical'), c: vuln('moderate'), d: vuln('low') }), [], today);
  assert.equal(r.blocking.length, 2);
  assert.match(r.blocking[0], /^a \(high\) ghsa-1111-2222-3333/);
});

test('an allowlisted advisory (by GHSA id) or package is waived while it has a reason and has not expired', () => {
  const a = audit({ a: vuln('high', ['GHSA-aaaa-bbbb-cccc']), b: vuln('high', ['GHSA-zzzz-zzzz-zzzz']) });
  const r = evaluate(a, [entry(), entry({ advisory: undefined, package: 'b' })], today);
  assert.deepEqual(r.blocking, []);
  assert.equal(r.waived.length, 2);
});

test('a package with two advisories is only waived if every advisory is', () => {
  const a = audit({ a: vuln('high', ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff']) });
  assert.equal(evaluate(a, [entry()], today).blocking.length, 1);
});

test('an expired entry stops waiving and is reported', () => {
  const r = evaluate(audit({ a: vuln('high', ['GHSA-aaaa-bbbb-cccc']) }), [entry({ expires: '2026-11-01' })], today);
  assert.equal(r.blocking.length, 1);
  assert.match(r.problems[0], /expired on 2026-11-01/);
});

test('entries without a reason, with a bad date, or a far-future expiry are rejected', () => {
  assert.match(validateAllowlist([entry({ reason: '' })], today).problems[0], /reason/);
  assert.match(validateAllowlist([entry({ expires: 'soon' })], today).problems[0], /expires/);
  assert.match(validateAllowlist([entry({ expires: '2030-01-01' })], today).problems[0], /more than 120 days/);
  assert.match(validateAllowlist([{ reason: 'a long enough reason', expires: '2026-12-01' }], today).problems[0], /advisory/);
  assert.equal(validateAllowlist([entry({ reason: '' })], today).active.length, 0);
});
