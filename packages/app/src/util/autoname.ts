/**
 * Auto-title heuristic for workspaces and tabs. From the first user message
 * in a thread, derive a short, sentence-cased title (≤5 words, ≤30 chars).
 * Returns null when the input has no usable word content (whitespace only,
 * emoji only, punctuation only) — callers should skip renaming in that case.
 *
 * Per frc_019dea6a-9278: workspaces and tabs that still carry their default
 * "Workspace N" / "Tab N" name get auto-renamed after the first user
 * message lands. Once a name has been customized (or auto-named), this
 * never overwrites it.
 */
const MAX_WORDS = 5;
const MAX_CHARS = 30;
const MIN_CHARS_FOR_SINGLE_WORD = 6;
const DEFAULT_WORKSPACE_NAME = /^Workspace \d+$/;
const DEFAULT_TAB_NAME = /^Tab \d+$/;

/**
 * Derive a short title from a first-message body. Returns null when the
 * input has no usable signal — whitespace only, emoji only, punctuation
 * only, or a single short word like "hi" / "ok" / "test" / "/help" that
 * would make a weak title (per PR #139 staff-review UX feedback). The
 * minimum-signal floor (≥2 words OR ≥6 chars for a single word) responds
 * to the friction report's "good signal" language without deferring to
 * later messages — message #1 is still the trigger when the signal is
 * strong.
 */
export function deriveTitle(text: string): string | null {
  const cleaned = text
    .normalize("NFKC")
    .replace(/^[\s\p{P}\p{S}]+/u, "")
    .trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/u).slice(0, MAX_WORDS);
  if (words.length === 0) return null;
  let title = words.join(" ");
  if (title.length > MAX_CHARS) {
    // Word-boundary truncation. The fallback (single word longer than
    // MAX_CHARS) slices mid-word, which is acceptable for the rare
    // pathological case — better than rejecting the message entirely.
    title = title.slice(0, MAX_CHARS).replace(/\s+\S*$/u, "").trim();
    if (!title) title = words[0]?.slice(0, MAX_CHARS) ?? "";
  }
  if (!/\p{L}|\p{N}/u.test(title)) return null;
  // Minimum-signal floor: a single short word ("Hi", "ok", "test") makes
  // a weak title. Require ≥2 words OR ≥MIN_CHARS_FOR_SINGLE_WORD chars
  // for a single word.
  if (words.length < 2 && title.length < MIN_CHARS_FOR_SINGLE_WORD) {
    return null;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function isDefaultWorkspaceName(name: string): boolean {
  return DEFAULT_WORKSPACE_NAME.test(name);
}

export function isDefaultTabName(title: string): boolean {
  return DEFAULT_TAB_NAME.test(title);
}

/**
 * Plan for auto-renaming after a first message. Pure — does no IO.
 * Returns the rename actions to perform (workspace, tab, or both).
 * Empty result means there is nothing to do (already-customized
 * names, or the message body yielded no usable title).
 */
export interface AutoNamePlan {
  title: string;
  renameWorkspace: boolean;
  renameTab: boolean;
}

export function planAutoName(args: {
  workspaceName: string;
  tabTitle: string | null;
  text: string;
}): AutoNamePlan | null {
  const title = deriveTitle(args.text);
  if (!title) return null;
  const renameWorkspace = isDefaultWorkspaceName(args.workspaceName);
  const renameTab = !!args.tabTitle && isDefaultTabName(args.tabTitle);
  if (!renameWorkspace && !renameTab) return null;
  return { title, renameWorkspace, renameTab };
}
