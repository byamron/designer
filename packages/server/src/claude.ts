import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AnswerHow, Decision, Question, ToolKind } from '@designer/shared';
import type { ProviderAdapter, Session, SessionSink, StartOpts, PermissionMode } from './adapter.js';
import { clientHow, finalAnswers, parseQuestions } from './questions.js';

/** Async-iterable queue used as the streaming-input prompt. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter?: (r: IteratorResult<SDKUserMessage>) => void;
  private done = false;
  push(m: SDKUserMessage) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value: m, done: false });
    } else this.items.push(m);
  }
  end() {
    this.done = true;
    this.waiter?.({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const v = this.items.shift();
        if (v) return Promise.resolve({ value: v, done: false });
        if (this.done) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => (this.waiter = res));
      },
    };
  }
}

/** Subscription login must win: API-key env vars outrank it, so never pass them on. */
export function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const e = { ...env };
  delete e.ANTHROPIC_API_KEY;
  delete e.ANTHROPIC_AUTH_TOKEN;
  return e;
}

const KINDS: Record<string, ToolKind> = {
  Bash: 'command', Edit: 'file_change', Write: 'file_change', MultiEdit: 'file_change', NotebookEdit: 'file_change',
  Read: 'read', Glob: 'search', Grep: 'search',
};

export function describeTool(name: string, input: any): string {
  const i = input ?? {};
  switch (name) {
    case 'Bash': return String(i.command ?? '').split('\n')[0].slice(0, 200);
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': return String(i.file_path ?? '');
    case 'Glob': case 'Grep': return String(i.pattern ?? '');
    default: return name;
  }
}

const OUTPUT_CAP = 20_000;
function stringifyResult(c: unknown): string {
  const s = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: any) => b?.text ?? '').join('\n') : JSON.stringify(c);
  return s.length > OUTPUT_CAP ? s.slice(0, OUTPUT_CAP) + '\n… (truncated)' : s;
}

/** Options for one Claude session (pure, so it can be tested). Callbacks are added by the session. */
export function sessionOptions(opts: StartOpts, nativeId: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  return {
    cwd: opts.cwd,
    env: cleanEnv(env),
    includePartialMessages: true,
    permissionMode: opts.permissionMode,
    // the SDK requires this explicit acknowledgement for the no-prompts mode
    ...(opts.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(nativeId ? { resume: nativeId } : {}),
  };
}

class ClaudeSession implements Session {
  private input = new InputQueue();
  private q?: Query;
  private pending = new Map<string, (d: Decision) => void>();
  private questions = new Map<string, (answers: Record<string, string>, how: AnswerHow) => void>();
  private tools = new Map<string, { name: string; kind: ToolKind; label: string; input: unknown }>();
  private finalCount = new Map<string, number>(); // api message id -> text blocks seen (final)
  private nativeId?: string;
  private interrupted = false;
  private closed = false;
  private reqCounter = 0;

  constructor(private opts: StartOpts, private sink: SessionSink) {
    this.nativeId = opts.resumeId;
  }

  private ensureStarted() {
    if (this.q) return;
    this.input = new InputQueue();
    this.q = query({
      prompt: this.input,
      options: {
        ...sessionOptions(this.opts, this.nativeId),
        canUseTool: (toolName, input, o) => this.askUser(toolName, input, o.signal),
      },
    });
    void this.pump(this.q);
  }

  private askUser(toolName: string, input: Record<string, unknown>, signal: AbortSignal) {
    if (toolName === 'AskUserQuestion') return this.askQuestion(input, signal);
    const requestId = `req-${Date.now()}-${++this.reqCounter}`;
    this.sink.emit({ type: 'approval_request', requestId, toolName, label: describeTool(toolName, input), input });
    return new Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }>((resolve) => {
      const settle = (d: Decision) => {
        if (!this.pending.delete(requestId)) return;
        this.sink.emit({ type: 'approval_resolved', requestId, decision: d });
        resolve(d === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user denied this action.' });
      };
      this.pending.set(requestId, settle);
      signal.addEventListener('abort', () => settle('deny'), { once: true });
    });
  }

  /** AskUserQuestion: show a card, wait for the answer, hand it back to Claude as the tool's input. */
  private askQuestion(input: Record<string, unknown>, signal: AbortSignal) {
    const questions = parseQuestions(input);
    if (!questions) return Promise.resolve({ behavior: 'deny' as const, message: 'The question could not be shown. Ask the user in plain text instead.' });
    const requestId = `q-${Date.now()}-${++this.reqCounter}`;
    this.sink.emit({ type: 'question_request', requestId, questions });
    return new Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }>((resolve) => {
      const settle = (given: Record<string, string>, how: AnswerHow) => {
        if (!this.questions.delete(requestId)) return;
        const answers = finalAnswers(questions, given, how);
        this.sink.emit({ type: 'question_answered', requestId, answers, how });
        if (how === 'cancelled') resolve({ behavior: 'deny', message: 'The user cancelled this question.' });
        else resolve({ behavior: 'allow', updatedInput: { ...input, answers } });
      };
      this.questions.set(requestId, settle);
      signal.addEventListener('abort', () => settle({}, 'cancelled'), { once: true });
    });
  }

  private cancelQuestions() {
    for (const settle of [...this.questions.values()]) settle({}, 'cancelled');
  }

  private async pump(q: Query) {
    try {
      for await (const m of q) this.handle(m as any);
    } catch (e) {
      if (!this.closed) this.sink.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      // Process ended (crash, close, or error): next send() restarts with resume.
      if (this.q === q) this.q = undefined;
      for (const settle of [...this.pending.values()]) settle('deny');
      this.cancelQuestions();
      this.sink.running(false);
    }
  }

  private handle(m: any) {
    if (m.parent_tool_use_id) return; // subagent chatter: not shown in v0
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.nativeId = m.session_id;
          this.sink.nativeId(m.session_id);
          if (m.permissionMode && m.permissionMode !== this.opts.permissionMode) {
            this.sink.emit({ type: 'error', message: `Permission mode "${this.opts.permissionMode}" is not available here; Claude is running in "${m.permissionMode}" mode.` });
          }
          if (m.apiKeySource && m.apiKeySource !== 'none' && m.apiKeySource !== 'oauth' && m.apiKeySource !== '/login managed key') {
            this.sink.emit({ type: 'error', message: `Claude is using "${m.apiKeySource}" instead of your subscription login. Run \`claude login\` in a terminal.` });
          }
        }
        return;
      case 'stream_event': {
        const e = m.event;
        if (e?.type === 'message_start') {
          this.currentApiId = e.message.id;
          this.streamBlocks.set(e.message.id, new Map());
        } else if (e?.type === 'content_block_start' && e.content_block?.type === 'text') {
          this.keyFor(e.index); // register this text block in order
        } else if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          const id = this.keyFor(e.index);
          if (id) this.sink.delta(id, e.delta.text);
        }
        return;
      }
      case 'assistant': {
        const apiId: string = m.message.id;
        for (const b of m.message.content ?? []) {
          if (b.type === 'text' && b.text) {
            const n = this.finalCount.get(apiId) ?? 0;
            this.finalCount.set(apiId, n + 1);
            this.sink.emit({ type: 'assistant_message', messageId: `${apiId}:${n}`, text: b.text });
          } else if (b.type === 'tool_use') {
            const kind = KINDS[b.name] ?? 'other';
            const label = describeTool(b.name, b.input);
            this.tools.set(b.id, { name: b.name, kind, label, input: b.input });
            this.sink.emit({ type: 'tool_call', id: b.id, kind, name: b.name, label, status: 'running', input: b.input });
          }
        }
        return;
      }
      case 'user': {
        const content = m.message?.content;
        if (!Array.isArray(content)) return;
        for (const b of content) {
          if (b.type !== 'tool_result') continue;
          const t = this.tools.get(b.tool_use_id);
          this.sink.emit({
            type: 'tool_call', id: b.tool_use_id, kind: t?.kind ?? 'other', name: t?.name ?? 'tool', label: t?.label ?? '',
            status: b.is_error ? 'error' : 'done', input: t?.input, output: stringifyResult(b.content),
          });
        }
        return;
      }
      case 'result': {
        if (m.is_error && m.subtype !== 'success') {
          const errs = Array.isArray(m.errors) ? m.errors.join('; ') : m.subtype;
          if (!this.interrupted) this.sink.emit({ type: 'error', message: String(errs) });
        }
        this.sink.emit({ type: 'turn_done', costUsd: m.total_cost_usd, interrupted: this.interrupted || undefined });
        this.interrupted = false;
        this.sink.running(false);
        return;
      }
    }
  }

  // Stream deltas use the same `${apiId}:${n}` key as the final message, where n counts text blocks in order.
  private streamBlocks = new Map<string, Map<number, number>>();
  private currentApiId?: string;
  private keyFor(index: number): string | undefined {
    if (!this.currentApiId) return undefined;
    const map = this.streamBlocks.get(this.currentApiId)!;
    if (!map.has(index)) map.set(index, map.size);
    return `${this.currentApiId}:${map.get(index)}`;
  }

  async send(text: string) {
    this.ensureStarted();
    this.interrupted = false;
    this.sink.running(true);
    this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null } as SDKUserMessage);
  }

  async interrupt() {
    this.interrupted = true;
    for (const settle of [...this.pending.values()]) settle('deny');
    this.cancelQuestions();
    try {
      await this.q?.interrupt();
    } catch {
      // process may already be gone
    }
  }

  respond(requestId: string, decision: Decision) {
    this.pending.get(requestId)?.(decision);
  }

  answer(requestId: string, answers: Record<string, string>, how: AnswerHow) {
    this.questions.get(requestId)?.(answers && typeof answers === 'object' ? answers : {}, clientHow(how));
  }

  async setPermissionMode(mode: PermissionMode) {
    this.opts.permissionMode = mode;
    try {
      await this.q?.setPermissionMode(mode);
    } catch (e) {
      this.sink.emit({ type: 'error', message: `Could not switch to "${mode}" mode: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  close() {
    this.closed = true;
    this.cancelQuestions();
    this.input.end();
    try {
      this.q?.close();
    } catch {
      // ignore
    }
  }
}

export const claudeAdapter: ProviderAdapter = {
  start: (opts, sink) => new ClaudeSession(opts, sink),
};
