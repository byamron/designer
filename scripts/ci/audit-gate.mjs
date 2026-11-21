#!/usr/bin/env node
// `npm audit --omit=dev` as a gate: fails on high/critical advisories unless they are on a checked-in allowlist
// where every entry has a reason and an expiry date (an expired entry fails the gate again, so nothing is waived forever).
//
//   node scripts/ci/audit-gate.mjs [--allowlist scripts/ci/audit-allowlist.json] [--input audit.json]
//   Allowlist entry: { "advisory": "GHSA-xxxx-xxxx-xxxx" | "package": "name", "reason": "...", "expires": "YYYY-MM-DD" }
//   Needs the npm registry (runs `npm audit`); the evaluation itself is pure and unit-tested.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BLOCKING = ['high', 'critical'];
export const MAX_EXPIRY_DAYS = 120;

export function validateAllowlist(list, today = new Date()) {
  if (!Array.isArray(list)) return { problems: ['allowlist must be a JSON array'], active: [] };
  const problems = [];
  const active = [];
  list.forEach((e, i) => {
    const who = `allowlist[${i}] (${e?.advisory ?? e?.package ?? '?'})`;
    let ok = true;
    if (!e?.advisory && !e?.package) { problems.push(`${who}: needs "advisory" (GHSA id) or "package"`); ok = false; }
    if (typeof e?.reason !== 'string' || e.reason.trim().length < 15) { problems.push(`${who}: "reason" is required (15+ characters: why it is safe to ship and what unblocks removal)`); ok = false; }
    const exp = typeof e?.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.expires) ? new Date(`${e.expires}T23:59:59Z`) : null;
    if (!exp || Number.isNaN(exp.getTime())) { problems.push(`${who}: "expires" must be a date like 2027-01-31`); ok = false; }
    else if (exp < today) { problems.push(`${who}: expired on ${e.expires}. Re-review it (fix the dependency, or renew with a new reason and date)`); ok = false; }
    else if ((exp - today) / 864e5 > MAX_EXPIRY_DAYS) { problems.push(`${who}: expires ${e.expires}, more than ${MAX_EXPIRY_DAYS} days away. Waivers are short so they get re-reviewed`); ok = false; }
    if (ok) active.push(e);
  });
  return { problems, active };
}

const ghsa = (url) => /GHSA-[a-z0-9-]+/i.exec(url ?? '')?.[0]?.toLowerCase();

/** `audit`: parsed `npm audit --json` (npm 7+). Returns the blocking findings that no active allowlist entry covers. */
export function evaluate(audit, allowlist, today = new Date()) {
  const { problems, active } = validateAllowlist(allowlist, today);
  const byAdvisory = new Set(active.filter((e) => e.advisory).map((e) => e.advisory.toLowerCase()));
  const byPackage = new Set(active.filter((e) => e.package).map((e) => e.package));
  const blocking = [];
  const waived = [];
  for (const [name, v] of Object.entries(audit?.vulnerabilities ?? {})) {
    if (!BLOCKING.includes(v.severity)) continue;
    const advisories = (v.via ?? []).filter((x) => typeof x === 'object').map((x) => ghsa(x.url)).filter(Boolean);
    const covered = byPackage.has(name) || (advisories.length > 0 && advisories.every((a) => byAdvisory.has(a)));
    const row = `${name} (${v.severity})${advisories.length ? ` ${advisories.join(', ')}` : ''}${v.fixAvailable ? '' : ' - no fix available'}`;
    (covered ? waived : blocking).push(row);
  }
  return { problems, blocking, waived };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const allowFile = opt('--allowlist', 'scripts/ci/audit-allowlist.json');
  const allowlist = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
  let raw;
  if (opt('--input')) raw = readFileSync(opt('--input'), 'utf8');
  else {
    try { raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
    catch (e) { raw = e.stdout; } // npm audit exits 1 when it finds anything; the JSON is still on stdout
  }
  let audit;
  try { audit = JSON.parse(raw); } catch { console.log('::error title=npm audit::could not read the output of npm audit (registry unreachable?)'); process.exit(1); }
  if (audit.error) { console.log(`::error title=npm audit::${audit.error.summary ?? 'npm audit failed'}`); process.exit(1); }
  const r = evaluate(audit, allowlist);
  const m = audit.metadata?.vulnerabilities ?? {};
  console.log(`npm audit --omit=dev: ${JSON.stringify(m)}`);
  for (const w of r.waived) console.log(`audit-gate: waived by allowlist: ${w}`);
  for (const p of r.problems) console.log(`::error title=Audit allowlist::${p}`);
  for (const b of r.blocking) console.log(`::error title=npm audit::${b}`);
  if (!r.problems.length && !r.blocking.length) console.log('audit-gate: ok (no high/critical advisories in production dependencies)');
  process.exit(r.problems.length || r.blocking.length ? 1 : 0);
}
