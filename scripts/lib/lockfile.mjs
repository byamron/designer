// Lockfile integrity checks with no dependencies (so there is nothing new to trust): every package must come from the
// npm registry over https and carry an integrity hash. A lockfile that points at a git URL, a tarball elsewhere or plain
// http is how a dependency gets swapped for something else without a version change.
const REGISTRY = 'https://registry.npmjs.org/';

/** Problems in a parsed package-lock.json (lockfileVersion 2/3), as readable strings. Empty means clean. */
export function lockfileProblems(lock) {
  const problems = [];
  if (!lock || typeof lock !== 'object' || !lock.packages) return ['package-lock.json has no "packages" (lockfileVersion 2 or 3 is required)'];
  for (const [path, p] of Object.entries(lock.packages)) {
    if (path === '' || p.link) continue; // the root, and workspace links
    const name = path.replace(/^.*node_modules\//, '');
    if (!p.resolved) {
      if (!path.startsWith('node_modules/') && !path.includes('/node_modules/')) continue; // a workspace folder
      problems.push(`${name}: no "resolved" address`);
      continue;
    }
    if (!p.resolved.startsWith(REGISTRY)) problems.push(`${name}: resolved from ${p.resolved.replace(/\/\/[^@/]*@/, '//<credentials>@')}, not ${REGISTRY}`);
    if (!p.integrity) problems.push(`${name}: no integrity hash`);
    else if (!/^sha(512|384|256)-/.test(p.integrity)) problems.push(`${name}: unusual integrity hash`);
  }
  return problems;
}
