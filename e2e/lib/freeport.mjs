// Prints a TCP port P such that P and P+1 are both free (the server also uses P+1 for the preview origin).
// Used by e2e/run.sh so several worktrees can run the suites at the same time without port clashes.
import { createServer } from 'node:net';

const listen = (port) => new Promise((resolve) => {
  const s = createServer();
  s.once('error', () => resolve(null));
  s.listen(port, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

for (let i = 0; i < 20; i++) {
  const p = await listen(0);
  if (p && (await listen(p + 1))) { console.log(p); process.exit(0); }
}
console.error('no free port pair found');
process.exit(1);
