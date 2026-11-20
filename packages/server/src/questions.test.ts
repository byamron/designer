import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, ServerMsg } from '@designer/shared';
import { Store } from './store.js';
import { Manager, type Client } from './manager.js';
import { fakeAdapter, FAKE_QUESTIONS } from './fake.js';
import { claudeAdapter } from './claude.js';
import { clientHow, finalAnswers, parseQuestions } from './questions.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'dq-'));
const [Q1, Q2] = FAKE_QUESTIONS.map((q) => q.question);

function harness() {
  const store = new Store(tmp());
  const mgr = new Manager(store, fakeAdapter, join(tmp(), 'worktrees'));
  const msgs: ServerMsg[] = [];
  const c: Client = { subs: new Set(), send: (m) => void msgs.push(m) };
  mgr.addClient(c);
  return { store, mgr, msgs, c };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(f(), 'timed out');
};
async function ask(h: ReturnType<typeof harness>) {
  h.mgr.handle(h.c, { type: 'add_folder', path: tmpdir() });
  await until(() => h.msgs.some((m) => m.type === 'thread_updated'));
  const t = (h.msgs.find((m) => m.type === 'thread_updated') as any).thread;
  h.mgr.handle(h.c, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  h.mgr.handle(h.c, { type: 'send', threadId: t.id, text: 'ask me a question' });
  const events = () => h.store.readEvents(t.id) as (AgentEvent & { seq: number })[];
  await until(() => events().some((e) => e.type === 'question_request'));
  const req = events().find((e) => e.type === 'question_request') as Extract<AgentEvent, { type: 'question_request' }>;
  return { t, req, events };
}

test('parseQuestions keeps the card fields and rejects unusable input', () => {
  const q = parseQuestions({ questions: [{ question: 'Q?', header: 'H', multiSelect: true, options: [{ label: 'A', description: 'a', preview: 'p' }, { label: 'B', description: 'b' }] }] })!;
  assert.deepEqual(q, [{ question: 'Q?', header: 'H', multiSelect: true, options: [{ label: 'A', description: 'a', preview: 'p' }, { label: 'B', description: 'b' }] }]);
  assert.equal(parseQuestions({}), undefined);
  assert.equal(parseQuestions({ questions: [] }), undefined);
  assert.equal(parseQuestions({ questions: [{ question: 'Q?', options: [] }] }), undefined);
  assert.equal(parseQuestions({ questions: ['x'] }), undefined);
  assert.equal(parseQuestions(null), undefined);
});

test('finalAnswers: single, multi (comma-separated), other, skip, chat, cancelled', () => {
  const qs = FAKE_QUESTIONS;
  assert.deepEqual(finalAnswers(qs, { [Q1]: 'Green', [Q2]: 'Dark mode, Icons' }, 'answered'), { [Q1]: 'Green', [Q2]: 'Dark mode, Icons' });
  assert.deepEqual(finalAnswers(qs, { [Q1]: 'Teal', [Q2]: 'Icons, Something else' }, 'answered'), { [Q1]: 'Teal', [Q2]: 'Icons, Something else' }); // Other text passes through
  assert.match(finalAnswers(qs, {}, 'skipped')[Q1], /skipped/);
  assert.match(finalAnswers(qs, {}, 'chat')[Q2], /reply in chat/i);
  assert.match(finalAnswers(qs, {}, 'cancelled')[Q1], /cancelled/);
  assert.match(finalAnswers(qs, { [Q1]: 'Red' }, 'answered')[Q2], /skipped/); // unanswered question still gets text
  assert.deepEqual(Object.keys(finalAnswers(qs, { bogus: 'x', [Q1]: 'Red' }, 'answered')), [Q1, Q2]); // unknown keys dropped
  assert.equal(finalAnswers(qs, { [Q1]: 'x'.repeat(9000) }, 'answered')[Q1].length, 4000);
  assert.equal(clientHow('cancelled'), 'skipped'); // a client cannot forge a server-only state
  assert.equal(clientHow('nonsense'), 'skipped');
  assert.equal(clientHow('chat'), 'chat');
});

test('question round trip: request persisted, answer persisted and returned to the model', async () => {
  const h = harness();
  const { t, req, events } = await ask(h);
  assert.equal(req.questions.length, 2);
  assert.equal(req.questions[1].multiSelect, true);
  h.mgr.handle(h.c, { type: 'answer', threadId: t.id, requestId: req.requestId, how: 'answered', answers: { [Q1]: 'Green', [Q2]: 'Dark mode, Icons' } });
  await until(() => events().some((e) => e.type === 'turn_done'));
  const ans = events().find((e) => e.type === 'question_answered') as Extract<AgentEvent, { type: 'question_answered' }>;
  assert.equal(ans.how, 'answered');
  assert.deepEqual(ans.answers, { [Q1]: 'Green', [Q2]: 'Dark mode, Icons' });
  const reply = events().find((e) => e.type === 'assistant_message') as Extract<AgentEvent, { type: 'assistant_message' }>;
  assert.ok(reply.text.includes('Green') && reply.text.includes('Dark mode, Icons'), 'the next message uses the answer');
  // replay: a fresh client sees the request and its answer
  const msgs: ServerMsg[] = [];
  const c2: Client = { subs: new Set(), send: (m) => void msgs.push(m) };
  h.mgr.handle(c2, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  const types = msgs.filter((m) => m.type === 'event').map((m: any) => m.event.type);
  assert.ok(types.indexOf('question_request') >= 0 && types.indexOf('question_answered') > types.indexOf('question_request'));
});

test('skip and reply-in-chat answers carry the text Claude should read; a second answer is ignored', async () => {
  for (const [how, re] of [['skipped', /skipped/], ['chat', /reply in chat/i]] as const) {
    const h = harness();
    const { t, req, events } = await ask(h);
    h.mgr.handle(h.c, { type: 'answer', threadId: t.id, requestId: req.requestId, how, answers: {} });
    h.mgr.handle(h.c, { type: 'answer', threadId: t.id, requestId: req.requestId, how: 'answered', answers: { [Q1]: 'Red' } });
    await until(() => events().some((e) => e.type === 'turn_done'));
    const all = events().filter((e) => e.type === 'question_answered') as Extract<AgentEvent, { type: 'question_answered' }>[];
    assert.equal(all.length, 1);
    assert.equal(all[0].how, how);
    assert.match(all[0].answers[Q1], re);
  }
});

test('answer for an unknown request or thread does nothing', async () => {
  const h = harness();
  const { t, req, events } = await ask(h);
  h.mgr.handle(h.c, { type: 'answer', threadId: t.id, requestId: 'nope', how: 'answered', answers: {} });
  h.mgr.handle(h.c, { type: 'answer', threadId: 'no-thread', requestId: req.requestId, how: 'answered', answers: {} });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(events().some((e) => e.type === 'question_answered'), false);
  h.mgr.handle(h.c, { type: 'interrupt', threadId: t.id });
  await until(() => events().some((e) => e.type === 'turn_done'));
});

test('Stop cancels a pending question and it replays as cancelled', async () => {
  const h = harness();
  const { t, events } = await ask(h);
  h.mgr.handle(h.c, { type: 'interrupt', threadId: t.id });
  await until(() => events().some((e) => e.type === 'turn_done'));
  const ans = events().find((e) => e.type === 'question_answered') as Extract<AgentEvent, { type: 'question_answered' }>;
  assert.equal(ans.how, 'cancelled');
  assert.match(ans.answers[Q1], /cancelled/);
  assert.equal((events().find((e) => e.type === 'turn_done') as any).interrupted, true);
});

// ---- the real Claude adapter's AskUserQuestion branch (no network: the tool callback is exercised directly)
function claudeSession() {
  const emitted: AgentEvent[] = [];
  const s: any = claudeAdapter.start({ cwd: tmpdir(), permissionMode: 'default' }, { emit: (e) => void emitted.push(e), delta() {}, nativeId() {}, running() {} });
  return { s, emitted };
}
const INPUT = { questions: [{ question: 'Colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'r' }, { label: 'Blue', description: 'b' }] }] };

test('claude adapter: AskUserQuestion becomes a card; the answer goes back as updatedInput.answers', async () => {
  const { s, emitted } = claudeSession();
  const p = s.askUser('AskUserQuestion', INPUT, new AbortController().signal);
  const req = emitted[0] as Extract<AgentEvent, { type: 'question_request' }>;
  assert.equal(req.type, 'question_request');
  assert.equal(req.questions[0].question, 'Colour?');
  s.answer(req.requestId, { 'Colour?': 'Blue' }, 'answered');
  const r = await p;
  assert.equal(r.behavior, 'allow');
  assert.deepEqual(r.updatedInput.answers, { 'Colour?': 'Blue' });
  assert.deepEqual(r.updatedInput.questions, INPUT.questions); // original input is preserved
  assert.deepEqual(emitted[1], { type: 'question_answered', requestId: req.requestId, answers: { 'Colour?': 'Blue' }, how: 'answered' });
});

test('claude adapter: skip / chat allow with explanatory answers; interrupt, abort and close cancel', async () => {
  for (const how of ['skipped', 'chat'] as const) {
    const { s, emitted } = claudeSession();
    const p = s.askUser('AskUserQuestion', INPUT, new AbortController().signal);
    s.answer((emitted[0] as any).requestId, {}, how);
    const r = await p;
    assert.equal(r.behavior, 'allow');
    assert.match(r.updatedInput.answers['Colour?'], how === 'skipped' ? /skipped/ : /reply in chat/i);
  }
  for (const stop of [(s: any, _ac: AbortController) => s.interrupt(), (_s: any, ac: AbortController) => ac.abort(), (s: any) => s.close()]) {
    const { s, emitted } = claudeSession();
    const ac = new AbortController();
    const p = s.askUser('AskUserQuestion', INPUT, ac.signal);
    await stop(s, ac);
    assert.equal((await p).behavior, 'deny');
    assert.equal((emitted[1] as any).how, 'cancelled');
    s.answer((emitted[0] as any).requestId, { 'Colour?': 'Red' }, 'answered'); // late answer is ignored
    assert.equal(emitted.length, 2);
  }
});

test('claude adapter: a malformed question is denied with a plain-text fallback, not shown', async () => {
  const { s, emitted } = claudeSession();
  const r = await s.askUser('AskUserQuestion', { questions: 'nope' }, new AbortController().signal);
  assert.equal(r.behavior, 'deny');
  assert.match(r.message, /plain text/);
  assert.equal(emitted.length, 0);
});
