// Finds local dev-server URLs in text so Designer can offer to open them in the preview pane.
// Pure and conservative: only http(s) URLs on localhost / 127.0.0.1 / [::1]. Never file:, javascript:, or look-alike hosts.

const HOST = String.raw`(?:localhost|127\.0\.0\.1|\[::1\])`;
// Not preceded by a word char, dot, @, slash or hyphen (so `evil.localhost:1`, `foo/localhost:1`, `a@localhost:1` are skipped);
// not followed by more hostname (`localhost.evil.com`, `localhostfoo`).
const RE = new RegExp(
  String.raw`(?<![\w.@/:-])(https?:\/\/)?(${HOST})(?![\w-]|\.\w)(?::(\d{1,5}))?(?![\w])((?:\/[^\s"'<>\`)\]]*)?)`,
  'gi',
);

/**
 * Local URLs in `text`, in order, de-duplicated, trailing punctuation removed.
 * Bare forms (`localhost:3000`, no scheme) count only with a port and only when `code` is true
 * (command output, code spans), so prose such as "3000ms" or "localhost" alone never matches.
 */
export function localUrls(text: string, opts: { code?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(RE)) {
    const [, scheme, host, port, rest] = m;
    if (!scheme && !(opts.code && port)) continue;
    if (port && Number(port) > 65535) continue;
    const path = (rest ?? '').replace(/[.,;:!?]+$/, '');
    const url = `${scheme ? scheme.toLowerCase() : 'http://'}${host.toLowerCase()}${port ? `:${port}` : ''}${path}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** True for a URL the preview pane may open from a chat link: http(s) on a local host. */
export function isLocalUrl(href: string): boolean {
  return localUrls(href).length === 1 && localUrls(href)[0].toLowerCase() === href.toLowerCase().replace(/[.,;:!?]+$/, '');
}
