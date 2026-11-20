import type { AnswerHow, Question } from '@designer/shared';

const MAX_TEXT = 4000;

/** Read AskUserQuestion input defensively; undefined when it is not a usable question list. */
export function parseQuestions(input: unknown): Question[] | undefined {
  const raw = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: Question[] = [];
  for (const q of raw.slice(0, 4)) {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options)) return undefined;
    const options = q.options
      .filter((o: any) => o && typeof o.label === 'string')
      .map((o: any) => ({
        label: o.label,
        description: typeof o.description === 'string' ? o.description : '',
        ...(typeof o.preview === 'string' && o.preview ? { preview: o.preview } : {}),
      }));
    if (!options.length) return undefined;
    out.push({ question: q.question, header: typeof q.header === 'string' ? q.header : '', options, multiSelect: q.multiSelect === true });
  }
  return out;
}

/** The "how" values a client may send; "cancelled" is only ever set by the server. */
export function clientHow(how: unknown): Exclude<AnswerHow, 'cancelled'> {
  return how === 'answered' || how === 'chat' ? how : 'skipped';
}

const TEXT: Record<Exclude<AnswerHow, 'answered'>, string> = {
  skipped: 'The user skipped this question.',
  chat: 'The user chose to reply in chat instead. Wait for their next message.',
  cancelled: 'The user cancelled this question.',
};

/**
 * Question text -> answer string, the shape AskUserQuestion expects (multi-select answers comma-separated).
 * For anything but a real answer, every question gets the text Claude should read.
 */
export function finalAnswers(questions: Question[], given: Record<string, string>, how: AnswerHow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = how === 'answered' ? given[q.question] : undefined;
    out[q.question] = typeof v === 'string' && v.trim() ? v.slice(0, MAX_TEXT) : how === 'answered' ? TEXT.skipped : TEXT[how];
  }
  return out;
}
