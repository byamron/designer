// Reading a pull request body: the Safety section and the machine-read `orchestrator` block (docs/pr-protocol.md).
// Pure functions, no dependencies, so the guards can run on a bare runner and be unit-tested.

// repeat until stable: removing one comment can splice the text around it into a new one (`<!<!---->-->`)
function stripComments(s) {
  let prev;
  do { prev = s; s = s.replace(/<!--[\s\S]*?-->/g, ''); } while (s !== prev);
  return s;
}

/** The text under the first heading that starts with `name` (case-insensitive), up to the next heading of the same or a higher level. null if there is none. */
export function section(body, name) {
  const lines = stripComments(body ?? '').split('\n');
  let inFence = false;
  let level = 0;
  let found = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (h) {
      if (found && h[1].length <= level) break;
      if (!found && h[2].toLowerCase().startsWith(name.toLowerCase())) {
        found = true;
        level = h[1].length;
        continue;
      }
    }
    if (found) out.push(line);
  }
  return found ? out.join('\n').trim() : null;
}

const normalize = (t) => t.toLowerCase().replace(/[`*_>"'.:]/g, '').replace(/\s+/g, ' ').trim();

/** The template's unfilled placeholder, e.g. `<which safety-critical paths you touched ...>`. */
export const isPlaceholder = (t) => /^<[^>\n]*>$/.test(t.trim());

/** The author says no safety-critical path was touched (the template's own wording). */
export const claimsNoSafetyPaths = (t) => /^(safety )?no safety[- ]critical paths touched$/.test(normalize(t));

/**
 * Problems with the Safety section, or [] if it is fine.
 * `touched`: the PR changes a safety-critical path, so "no safety-critical paths touched" is not acceptable.
 */
export function safetySectionProblems(body, { touched }) {
  const s = section(body, 'Safety');
  if (s === null) return ['the PR body has no "Safety" section (see .github/pull_request_template.md)'];
  if (!s || isPlaceholder(s)) return ['the "Safety" section is empty or still the template placeholder'];
  if (touched) {
    if (claimsNoSafetyPaths(s)) return ['the "Safety" section says no safety-critical paths were touched, but the diff touches some: name them and the tests that pin the behaviour'];
    if (s.replace(/\s+/g, ' ').length < 30) return ['the "Safety" section is too short to say which tests pin the behaviour (30+ characters)'];
  }
  return [];
}

// ---- the orchestrator block --------------------------------------------------------------------------------------

function stripLineComment(v) {
  let q = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i).trim();
  }
  return v.trim();
}

function splitTop(s) {
  const parts = [];
  let depth = 0, q = '', cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const unquote = (s) => (/^(".*"|'.*')$/.test(s) ? s.slice(1, -1) : s);

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`unclosed [ in "${v}"`);
    return splitTop(v.slice(1, -1)).map((x) => unquote(x));
  }
  if (v.startsWith('{')) {
    if (!v.endsWith('}')) throw new Error(`unclosed { in "${v}"`);
    const o = {};
    for (const p of splitTop(v.slice(1, -1))) {
      const i = p.indexOf(':');
      if (i < 1) throw new Error(`bad entry "${p}" in ${v}`);
      o[p.slice(0, i).trim()] = unquote(p.slice(i + 1).trim());
    }
    return o;
  }
  return unquote(v);
}

export const ORCHESTRATOR_ARRAYS = ['depends-on', 'owns', 'touched-outside-owned', 'conflict-risk', 'needs-mac'];
export const ORCHESTRATOR_KEYS = ['project', 'merge-order', 'base', 'base-sha', ...ORCHESTRATOR_ARRAYS, 'new-dependencies', 'docs-changed', 'checks'];

/** Find the fenced ```orchestrator block. Returns its text or null. */
export function orchestratorText(body) {
  const m = /^```orchestrator[ \t]*\n([\s\S]*?)\n```/m.exec(stripComments(body ?? ''));
  return m ? m[1] : null;
}

/** Parse and validate the block. `baseRef`, if given, must equal the block's `base:` (stacked PRs name their parent branch). */
export function orchestratorProblems(body, { baseRef } = {}) {
  const text = orchestratorText(body);
  if (text === null) return ['the PR body has no fenced ```orchestrator block (see .github/pull_request_template.md)'];
  const data = {};
  const problems = [];
  for (const line of text.split('\n')) {
    const l = stripLineComment(line);
    if (!l) continue;
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
    if (!m) { problems.push(`orchestrator block: cannot read the line "${l}"`); continue; }
    try { data[m[1]] = parseValue(m[2]); } catch (e) { problems.push(`orchestrator block, ${m[1]}: ${e.message}`); }
  }
  for (const k of ORCHESTRATOR_KEYS) if (!(k in data)) problems.push(`orchestrator block: missing key "${k}"`);
  const flat = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  for (const [k, v] of Object.entries(data)) {
    if (/<[^>\n]+>/.test(flat(v)) || /(^|[^\w])N\/N([^\w]|$)/.test(flat(v))) problems.push(`orchestrator block, ${k}: still has template placeholder text (${flat(v)})`);
  }
  const str = (k) => typeof data[k] === 'string' && data[k] !== '';
  if ('project' in data && !str('project')) problems.push('orchestrator block, project: must be a non-empty id');
  if ('merge-order' in data && !(str('merge-order') && /^\d+$/.test(data['merge-order']))) problems.push('orchestrator block, merge-order: must be a whole number');
  if ('base' in data && !str('base')) problems.push('orchestrator block, base: must be a branch name');
  else if (baseRef && 'base' in data && data.base !== baseRef) problems.push(`orchestrator block, base: says "${data.base}" but the PR targets "${baseRef}"`);
  if ('base-sha' in data && !(str('base-sha') && /^[0-9a-f]{40}$/.test(data['base-sha']))) problems.push('orchestrator block, base-sha: must be a full 40-character commit SHA (git rev-parse origin/main)');
  for (const k of ORCHESTRATOR_ARRAYS) if (k in data && !Array.isArray(data[k])) problems.push(`orchestrator block, ${k}: must be a list like [] or [a, b]`);
  for (const k of ['new-dependencies', 'docs-changed']) if (k in data && !(str(k) || (Array.isArray(data[k]) && data[k].length))) problems.push(`orchestrator block, ${k}: write "none" or list them`);
  if ('checks' in data && !(data.checks && typeof data.checks === 'object' && !Array.isArray(data.checks) && Object.keys(data.checks).length)) problems.push('orchestrator block, checks: must be { name: result, ... } with at least one entry');
  return problems;
}
