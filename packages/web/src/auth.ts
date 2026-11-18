// The app token (printed by the server as a link) authorizes the WebSocket and the API. It is kept in this
// origin's localStorage, which pages we preview or proxy (other origins) cannot read.
const KEY = 'designer.token';

let memory: string | undefined; // used if storage is unavailable

/** Pick the token up from `?t=` (then clean the address bar) or from storage. */
export function initToken(): string | undefined {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('t');
  if (fromUrl) {
    memory = fromUrl;
    try { localStorage.setItem(KEY, fromUrl); } catch { /* keep it in memory */ }
    url.searchParams.delete('t');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return getToken();
}

export function getToken(): string | undefined {
  if (memory) return memory;
  try { return localStorage.getItem(KEY) ?? undefined; } catch { return undefined; }
}

/** fetch() against the app's API with the token attached. */
export function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...(init.headers ?? {}), 'x-designer-token': getToken() ?? '' } });
}
