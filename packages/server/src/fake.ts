import type { Decision } from '@designer/shared';
import type { ProviderAdapter, Session, SessionSink } from './adapter.js';

const LONG = `Here is a **scripted** reply from the fake provider.\n\n## A heading\n\nSome paragraph text that streams in lumps. ${'Lorem ipsum dolor sit amet. '.repeat(20)}\n\n- one\n- two\n- three\n\n\`\`\`ts\nconst x = 1;\nconsole.log(x);\n\`\`\`\n\nDone.`;

/** Scripted provider for UI work and tests: no network, no Claude. Prompt text picks the scenario. */
export const fakeAdapter: ProviderAdapter = {
  start(_opts, sink: SessionSink): Session {
    let n = 0;
    let stop = false;
    const pending = new Map<string, (d: Decision) => void>();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return {
      async send(text) {
        stop = false;
        void (async () => {
          const id = `fake-${++n}`;
          if (/tool/i.test(text)) {
            sink.emit({ type: 'tool_call', id: `${id}-t1`, kind: 'read', name: 'Read', label: 'src/app.ts', status: 'running' });
            await sleep(150);
            sink.emit({ type: 'tool_call', id: `${id}-t1`, kind: 'read', name: 'Read', label: 'src/app.ts', status: 'done', output: 'line 1\nline 2' });
          }
          if (/approve/i.test(text)) {
            const requestId = `${id}-req`;
            sink.emit({ type: 'approval_request', requestId, toolName: 'Bash', label: 'rm -rf build', input: { command: 'rm -rf build' } });
            const d = await new Promise<Decision>((res) => pending.set(requestId, res));
            sink.emit({ type: 'approval_resolved', requestId, decision: d });
          }
          const reply = /long/i.test(text) ? LONG.repeat(4) : LONG;
          let i = 0;
          while (i < reply.length && !stop) {
            const step = 3 + Math.floor(Math.random() * 25);
            sink.delta(`${id}:0`, reply.slice(i, i + step));
            i += step;
            await sleep(8);
          }
          if (!stop) sink.emit({ type: 'assistant_message', messageId: `${id}:0`, text: reply });
          sink.emit({ type: 'turn_done', costUsd: 0, interrupted: stop || undefined });
          sink.running(false);
        })();
      },
      async interrupt() {
        stop = true;
        for (const r of pending.values()) r('deny');
      },
      respond(requestId, d) {
        pending.get(requestId)?.(d);
        pending.delete(requestId);
      },
      async setPermissionMode() {},
      close() {
        stop = true;
      },
    };
  },
};
