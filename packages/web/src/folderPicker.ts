// Native folder picker (Designer.app only) and the iCloud path warning. Pure functions so they can be unit tested.
//
// The desktop shell exposes exactly one function to the page: window.designerDesktop.chooseFolder(). It takes no arguments and
// returns an absolute path or null. In a plain browser there is no bridge, and the typed path field is all there is.

export interface DesktopBridge {
  chooseFolder(): Promise<string | null>;
}

/** The bridge, but only if it is the one function we expect (anything else is treated as "no desktop shell"). */
export function getBridge(win: { designerDesktop?: unknown } | undefined = typeof window === 'undefined' ? undefined : (window as any)): DesktopBridge | undefined {
  const b = win?.designerDesktop as { chooseFolder?: unknown } | undefined;
  return b && typeof b.chooseFolder === 'function' ? (b as DesktopBridge) : undefined;
}

export type PickResult = { kind: 'picked'; path: string } | { kind: 'cancelled' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

/**
 * Ask the shell for a folder. The answer is only ever a path to put in the form: the server validates it exactly as it validates a
 * typed one (it must exist, git root detection, the same add-folder flow), so nothing here is trusted more than typed text.
 */
export async function pickFolder(bridge: DesktopBridge | undefined): Promise<PickResult> {
  if (!bridge) return { kind: 'unavailable' };
  let v: unknown;
  try {
    v = await bridge.chooseFolder();
  } catch (e) {
    return { kind: 'error', message: `Could not open the folder picker: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (v === null) return { kind: 'cancelled' };
  if (typeof v !== 'string' || !v.trim() || !v.startsWith('/')) return { kind: 'error', message: 'Could not open the folder picker: it returned something that is not a folder path.' };
  return { kind: 'picked', path: v };
}

export const ICLOUD_WARNING = 'iCloud may evict files in this folder and git will hang; use a folder under ~/dev';

/**
 * macOS folders that iCloud can sync: Desktop, Documents and the iCloud Drive container. Files in them can be evicted (turned into
 * placeholders) and then reading them, as git does, hangs. Matches /Users/<name>/… and ~/… only at the top of the home folder.
 */
const ICLOUD = /^(?:\/Users\/[^/]+|~)\/(?:desktop|documents|library\/mobile documents)(?:\/|$)/i;

export function icloudWarning(path: string): string | undefined {
  return ICLOUD.test(path.trim()) ? ICLOUD_WARNING : undefined;
}
