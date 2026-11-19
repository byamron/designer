import { memo } from 'react';
import { store } from './store';
import type { Item } from './store';
import { Markdown } from './markdown';
import { useSmoothText } from './useSmoothText';
import { fmtElapsed } from './format';
import { MessageImages } from './Attachments';

export const Row = memo(function Row({ item, threadId, fresh }: { item: Item; threadId: string; fresh?: boolean }) {
  const f = fresh ? ' fresh' : '';
  switch (item.kind) {
    case 'user':
      return (
        <div className={`msg user${f}`}>
          {item.images?.length ? <MessageImages threadId={threadId} images={item.images} /> : null}
          {item.text.trim() && <div className="bubble">{item.text}</div>}
        </div>
      );
    case 'assistant':
      return <Assistant item={item} fresh={f} />;
    case 'approval':
      return <Approval item={item} threadId={threadId} fresh={f} />;
    case 'error':
      return <div className={`msg err${f}`} role="alert">{item.message}</div>;
    case 'done':
      return item.ms && item.ms >= 2000 ? <div className={`turn-note${f}`}>{item.interrupted ? 'Stopped after' : 'Worked for'} {fmtElapsed(item.ms)}</div> : null;
    default:
      return null;
  }
});

export function Assistant({ item, fresh }: { item: Extract<Item, { kind: 'assistant' }>; fresh: string }) {
  const text = useSmoothText(item.text, item.streaming);
  const live = item.streaming || text.length < item.text.length;
  return (
    <div className={`msg assistant${live ? ' live' : ' settled'}${fresh}`}>
      <Markdown text={text} />
    </div>
  );
}

export function Approval({ item, threadId, fresh }: { item: Extract<Item, { kind: 'approval' }>; threadId: string; fresh: string }) {
  return (
    <div className={`approval${item.resolved ? ' resolved' : ''}${fresh}`} role="group" aria-label="Permission request">
      <div className="approval-q">
        <strong>{item.toolName}</strong> <code>{item.label}</code>
      </div>
      {item.resolved ? (
        <span className="approval-res">{item.resolved === 'allow' ? 'Allowed' : 'Denied'}</span>
      ) : (
        <div className="approval-btns">
          <button className="primary" onClick={() => store.respond(threadId, item.id, 'allow')}>Allow</button>
          <button onClick={() => store.respond(threadId, item.id, 'deny')}>Deny</button>
        </div>
      )}
    </div>
  );
}
