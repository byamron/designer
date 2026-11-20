import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AnswerHow, Question } from '@designer/shared';
import { store, useStore } from './store';

export type QuestionItem = { kind: 'question'; id: string; questions: Question[]; answered?: { answers: Record<string, string>; how: AnswerHow } };

const OTHER = -1; // index of the always-present "Other…" choice

/** The answer string for one question, in the shape Claude expects (multi-select: comma-separated). */
export function answerText(q: Question, picked: number[], other: string): string {
  const parts = q.options.filter((_, i) => picked.includes(i)).map((o) => o.label);
  if (picked.includes(OTHER) && other.trim()) parts.push(other.trim());
  return parts.join(', ');
}

const STATUS: Record<Exclude<AnswerHow, 'answered'>, string> = { skipped: 'Skipped', chat: 'Replied in chat', cancelled: 'Cancelled' };

export function QuestionCard({ item, threadId, fresh }: { item: QuestionItem; threadId: string; fresh: string }) {
  const live = useStore((s) => s.threads.find((t) => t.id === threadId)?.status === 'running');
  // A later message from you means the turn that asked has ended (server restarted, crash): nothing will answer it.
  const superseded = useStore((s) => {
    const items = s.views[threadId]?.items ?? [];
    for (let i = items.length - 1; i >= 0 && items[i].id !== item.id; i--) if (items[i].kind === 'user') return true;
    return false;
  });
  // No answer and no running turn (Stop, or the server restarted): nothing will ever answer it.
  const how: AnswerHow | undefined = item.answered?.how ?? (live && !superseded ? undefined : 'cancelled');
  if (how) return <Summary item={item} how={how} fresh={fresh} />;
  return <Pending item={item} threadId={threadId} fresh={fresh} />;
}

function Summary({ item, how, fresh }: { item: QuestionItem; how: AnswerHow; fresh: string }) {
  return (
    <div className={`question done${how === 'cancelled' ? ' cancelled' : ''}${fresh}`} role="group" aria-label={how === 'answered' ? 'Question, answered' : `Question, ${STATUS[how].toLowerCase()}`}>
      {item.questions.map((q) => {
        const a = how === 'answered' ? item.answered?.answers[q.question] ?? '' : STATUS[how];
        return (
          <div className="q-line" key={q.question} title={`${q.question} → ${a}`}>
            <span className="q-key">Q:</span> {q.question} <span aria-hidden="true">→</span> <span className="q-key">A:</span> {a}
          </div>
        );
      })}
    </div>
  );
}

function Pending({ item, threadId, fresh }: { item: QuestionItem; threadId: string; fresh: string }) {
  const { questions } = item;
  const [picked, setPicked] = useState<number[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  const [look, setLook] = useState<number[]>(() => questions.map(() => 0)); // option whose preview is shown
  const [sent, setSent] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A new card takes keyboard focus unless you are in the middle of typing a message.
  useEffect(() => {
    const a = document.activeElement;
    if (fresh && (a === document.body || (a instanceof HTMLTextAreaElement && !a.value))) root.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = questions.every((q, i) => picked[i].length > 0 && (!picked[i].includes(OTHER) || other[i].trim()));

  const choose = (qi: number, oi: number, on?: boolean) => {
    setLook((l) => l.map((v, i) => (i === qi && oi >= 0 ? oi : v)));
    setPicked((p) =>
      p.map((sel, i) => {
        if (i !== qi) return sel;
        if (!questions[qi].multiSelect) return [oi];
        const has = sel.includes(oi);
        const want = on ?? !has;
        return want ? (has ? sel : [...sel, oi]) : sel.filter((x) => x !== oi);
      }),
    );
  };

  const finish = (how: AnswerHow, answers: Record<string, string> = {}) => {
    if (sent) return;
    setSent(true);
    store.answer(threadId, item.id, answers, how);
    if (how === 'chat') requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus());
  };
  const submit = () => {
    if (!valid) return;
    finish('answered', Object.fromEntries(questions.map((q, i) => [q.question, answerText(q, picked[i], other[i])])));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') return void e.stopPropagation(); // never dismisses the card silently
    if (e.key === 'Enter' && !(t instanceof HTMLButtonElement)) {
      e.preventDefault();
      return submit();
    }
    if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !(t instanceof HTMLInputElement && t.type === 'text')) {
      const qi = Math.max(0, Number(t.closest<HTMLElement>('[data-q]')?.dataset.q ?? 0));
      const n = Number(e.key) - 1;
      const q = questions[qi];
      if (n > q.options.length) return;
      e.preventDefault();
      const oi = n === q.options.length ? OTHER : n;
      choose(qi, oi);
      const box = root.current?.querySelector<HTMLInputElement>(`[data-q="${qi}"] input[data-o="${oi}"]`);
      if (oi === OTHER) root.current?.querySelector<HTMLInputElement>(`[data-q="${qi}"] input[type="text"]`)?.focus();
      else box?.focus();
    }
  };

  return (
    <div ref={root} className={`question${fresh}`} role="group" aria-label="Claude has a question" onKeyDown={onKeyDown}>
      {questions.map((q, qi) => {
        const shown = q.options[look[qi]]?.preview;
        const hasPreview = q.options.some((o) => o.preview);
        const type = q.multiSelect ? 'checkbox' : 'radio';
        const name = `${item.id}-${qi}`;
        return (
          <fieldset className="q-group" key={q.question} data-q={qi}>
            <legend>
              {q.header && <span className="q-chip">{q.header}</span>} <span className="q-text">{q.question}</span>
              {q.multiSelect && <span className="q-hint"> (choose any)</span>}
            </legend>
            <div className={`q-body${hasPreview ? ' with-preview' : ''}`}>
              <div className="q-options">
                {q.options.map((o, oi) => (
                  <label className="q-opt" key={o.label} onMouseEnter={() => setLook((l) => l.map((v, i) => (i === qi ? oi : v)))}>
                    <input type={type} name={name} data-o={oi} checked={picked[qi].includes(oi)} onChange={(e) => choose(qi, oi, e.target.checked)} onFocus={() => setLook((l) => l.map((v, i) => (i === qi ? oi : v)))} />
                    <span className="q-num" aria-hidden="true">{oi + 1}</span>
                    <span className="q-label"><strong>{o.label}</strong>{o.description && <span className="q-desc">{o.description}</span>}</span>
                  </label>
                ))}
                <div className="q-opt other">
                  <input type={type} name={name} data-o={OTHER} id={`${name}-other`} checked={picked[qi].includes(OTHER)} onChange={(e) => choose(qi, OTHER, e.target.checked)} />
                  <span className="q-num" aria-hidden="true">{q.options.length + 1}</span>
                  <label htmlFor={`${name}-other`} className="q-label">Other…</label>
                  <input
                    type="text"
                    className="q-other"
                    aria-label={`Other answer for ${q.header || q.question}`}
                    placeholder="Type your own answer"
                    value={other[qi]}
                    onClick={() => !picked[qi].includes(OTHER) && choose(qi, OTHER, true)}
                    onChange={(e) => {
                      setOther((o) => o.map((v, i) => (i === qi ? e.target.value : v)));
                      if (!picked[qi].includes(OTHER)) choose(qi, OTHER, true); // typing is choosing; merely tabbing past is not
                    }}
                    spellCheck
                  />
                </div>
              </div>
              {hasPreview && (
                <pre className="q-preview" aria-label={`Preview of ${q.options[look[qi]]?.label ?? 'option'}`}>
                  {shown || 'No preview for this option.'}
                </pre>
              )}
            </div>
          </fieldset>
        );
      })}
      <div className="q-btns">
        <button className="primary" onClick={submit} disabled={!valid || sent}>Submit</button>
        <button onClick={() => finish('skipped')} disabled={sent}>Skip</button>
        <button className="quiet" onClick={() => finish('chat')} disabled={sent}>Reply in chat instead</button>
      </div>
    </div>
  );
}
