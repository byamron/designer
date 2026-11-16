import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent, StoredEvent, ThreadMeta, Workspace } from '@designer/shared';

/** Append-only JSONL log per thread plus a small meta.json. No DB. */
export class Store {
  private seqs = new Map<string, number>();
  constructor(private root: string) {
    mkdirSync(join(root, 'threads'), { recursive: true });
  }
  private dir(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('bad thread id');
    return join(this.root, 'threads', id);
  }
  listWorkspaces(): Workspace[] {
    try {
      return JSON.parse(readFileSync(join(this.root, 'workspaces.json'), 'utf8'));
    } catch {
      return [];
    }
  }
  saveWorkspaces(list: Workspace[]) {
    const f = join(this.root, 'workspaces.json');
    writeFileSync(f + '.tmp', JSON.stringify(list, null, 2));
    renameSync(f + '.tmp', f); // atomic: never leave a half-written index
  }
  listThreads(): ThreadMeta[] {
    const base = join(this.root, 'threads');
    return readdirSync(base)
      .map((id) => this.readMeta(id))
      .filter((m): m is ThreadMeta => !!m)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  readMeta(id: string): ThreadMeta | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), 'meta.json'), 'utf8'));
    } catch {
      return undefined;
    }
  }
  writeMeta(meta: ThreadMeta) {
    mkdirSync(this.dir(meta.id), { recursive: true });
    writeFileSync(join(this.dir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2));
  }
  readEvents(id: string, afterSeq = 0): StoredEvent[] {
    const f = join(this.dir(id), 'events.jsonl');
    if (!existsSync(f)) return [];
    const out: StoredEvent[] = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as StoredEvent;
        if (e.seq > afterSeq) out.push(e);
      } catch {
        // tolerate a torn final line after a crash
      }
    }
    return out;
  }
  append(id: string, ev: AgentEvent): StoredEvent {
    let seq = this.seqs.get(id);
    if (seq === undefined) seq = this.readEvents(id).at(-1)?.seq ?? 0;
    seq += 1;
    this.seqs.set(id, seq);
    const stored = { ...ev, threadId: id, seq, ts: Date.now() } as StoredEvent;
    mkdirSync(this.dir(id), { recursive: true });
    appendFileSync(join(this.dir(id), 'events.jsonl'), JSON.stringify(stored) + '\n');
    return stored;
  }
}
