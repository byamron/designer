import { memo, useState } from 'react';
import type { Item } from './store';

export type ToolItem = Extract<Item, { kind: 'tool' }>;
export const VERB: Record<string, [string, string, string]> = {
  read: ['Read', 'file', 'files'], command: ['Ran', 'command', 'commands'], file_change: ['Edited', 'file', 'files'],
  search: ['Searched', 'time', 'times'], other: ['Used', 'tool', 'tools'],
};
export function summarize(tools: ToolItem[]) {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.toolKind, (counts.get(t.toolKind) ?? 0) + 1);
  return [...counts].map(([k, n]) => {
    const [verb, one, many] = VERB[k] ?? VERB.other;
    return `${verb} ${n} ${n === 1 ? one : many}`;
  }).join(', ');
}

export const ToolGroup = memo(function ToolGroup({ tools, fresh }: { tools: ToolItem[]; fresh?: boolean }) {
  const live = tools.some((t) => t.status === 'running');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const expanded = open ?? live; // open while live, collapsed once done unless the user chose
  const failed = tools.some((t) => t.status === 'error');
  return (
    <div className={`tools${live ? ' live' : ''}${fresh ? ' fresh' : ''}`}>
      <button className="tools-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span className={`chev${expanded ? ' open' : ''}`} aria-hidden="true">▸</span>
        <span>{summarize(tools)}</span>
        {live && <span className="dot" aria-label="running" />}
        {failed && !live && <span className="fail">failed</span>}
      </button>
      <div className={`tools-body${expanded ? ' open' : ''}`}>
        <div className="tools-inner">
          <ul>
            {tools.map((t) => <ToolLine key={t.id} t={t} />)}
          </ul>
        </div>
      </div>
    </div>
  );
});

export function ToolLine({ t }: { t: ToolItem }) {
  const [show, setShow] = useState(false);
  return (
    <li className={`tool ${t.status}`}>
      <button className="tool-line" onClick={() => t.output && setShow(!show)} disabled={!t.output}>
        <span className="tool-name">{t.name}</span>
        <span className="tool-label">{t.label}</span>
        <span className="tool-status">{t.status === 'running' ? '…' : t.status === 'error' ? '✕' : '✓'}</span>
      </button>
      {show && t.output && <pre className="tool-out">{t.output}</pre>}
    </li>
  );
}
