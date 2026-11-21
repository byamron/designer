import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { EXT, ID_RE, MIME_BY_EXT } from './attachments.js';
import { join } from 'node:path';
import type { AgentEvent, StoredEvent, ThreadMeta, Workspace } from '@designer/shared';

/** Append-only JSONL log per thread plus a small meta.json. No DB. */
export class Store {
  private seqs = new Map<string, number>();
  constructor(private root: string) {
    mkdirSync(join(root, 'threads'), { recursive: true, mode: 0o700 }); // chats can contain secrets from tool output: owner only
    for (const d of [root, join(root, 'threads')]) chmodSync(d, 0o700); // also when the folders already existed with looser permissions
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
    writeFileSync(f + '.tmp', JSON.stringify(list, null, 2), { mode: 0o600 });
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
    mkdirSync(this.dir(meta.id), { recursive: true, mode: 0o700 });
    writeFileSync(join(this.dir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o600 });
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
    mkdirSync(this.dir(id), { recursive: true, mode: 0o700 });
    appendFileSync(join(this.dir(id), 'events.jsonl'), JSON.stringify(stored) + '\n', { mode: 0o600 });
    return stored;
  }
  /** Store an image once, under its content hash. Owner-only. */
  saveAttachment(threadId: string, id: string, mime: string, bytes: Buffer) {
    const ext = EXT[mime];
    if (!ext || !ID_RE.test(id)) throw new Error('bad attachment');
    const dir = join(this.dir(threadId), 'attachments');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const f = join(dir, `${id}.${ext}`);
    if (!existsSync(f)) writeFileSync(f, bytes, { mode: 0o600 });
  }
  /** The stored image and its fixed type, or undefined. Ids are hashes: nothing user-supplied becomes a path. */
  readAttachment(threadId: string, id: string): { mime: string; bytes: Buffer } | undefined {
    if (!ID_RE.test(id) || !/^[\w-]+$/.test(threadId)) return undefined;
    for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
      try {
        return { mime, bytes: readFileSync(join(this.dir(threadId), 'attachments', `${id}.${ext}`)) };
      } catch {
        // not stored under this type
      }
    }
    return undefined;
  }
}
