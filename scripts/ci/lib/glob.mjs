// Minimal glob matching for the path lists in .claude/rules/safety.md: `**` crosses directories, `*` does not.

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

/** The `paths:` list from a rule file's YAML frontmatter. */
export function frontmatterPaths(md) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!fm) return [];
  const out = [];
  let on = false;
  for (const line of fm[1].split('\n')) {
    if (/^paths:\s*$/.test(line)) { on = true; continue; }
    if (on) {
      const m = /^\s+-\s+["']?(.*?)["']?\s*$/.exec(line);
      if (m) out.push(m[1]);
      else if (/^\S/.test(line)) on = false;
    }
  }
  return out;
}
