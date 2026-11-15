import { memo, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';

// Model output is untrusted: we render tokens to React elements ourselves and never
// inject HTML. Raw HTML in the markdown is shown as plain text.

const SAFE_URL = /^(https?:|mailto:|#|\/)/i;

function inline(tokens: Token[] | undefined, key = ''): ReactNode[] {
  return (tokens ?? []).map((t, i) => {
    const k = `${key}${i}`;
    switch (t.type) {
      case 'strong': return <strong key={k}>{inline((t as Tokens.Strong).tokens, k)}</strong>;
      case 'em': return <em key={k}>{inline((t as Tokens.Em).tokens, k)}</em>;
      case 'del': return <del key={k}>{inline((t as Tokens.Del).tokens, k)}</del>;
      case 'codespan': return <code key={k}>{(t as Tokens.Codespan).text}</code>;
      case 'br': return <br key={k} />;
      case 'link': {
        const l = t as Tokens.Link;
        return SAFE_URL.test(l.href) ? (
          <a key={k} href={l.href} target="_blank" rel="noreferrer noopener">{inline(l.tokens, k)}</a>
        ) : (
          <span key={k}>{inline(l.tokens, k)}</span>
        );
      }
      case 'text': {
        const x = t as Tokens.Text;
        return x.tokens ? <span key={k}>{inline(x.tokens, k)}</span> : <span key={k}>{unescape(x.text)}</span>;
      }
      case 'escape': return <span key={k}>{(t as Tokens.Escape).text}</span>;
      default: return <span key={k}>{unescape((t as { raw?: string }).raw ?? '')}</span>;
    }
  });
}

// marked HTML-escapes text tokens; React escapes for us, so undo marked's escaping.
function unescape(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function block(t: Token, k: string): ReactNode {
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      const Tag = `h${Math.min(h.depth, 6)}` as 'h1';
      return <Tag key={k}>{inline(h.tokens, k)}</Tag>;
    }
    case 'paragraph': return <p key={k}>{inline((t as Tokens.Paragraph).tokens, k)}</p>;
    case 'code': return <pre key={k}><code>{(t as Tokens.Code).text}</code></pre>;
    case 'blockquote': return <blockquote key={k}>{blocks((t as Tokens.Blockquote).tokens, k)}</blockquote>;
    case 'hr': return <hr key={k} />;
    case 'space': return null;
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map((it, i) => <li key={i}>{blocks(it.tokens, `${k}.${i}`)}</li>);
      return l.ordered ? <ol key={k} start={Number(l.start) || 1}>{items}</ol> : <ul key={k}>{items}</ul>;
    }
    case 'table': {
      const tb = t as Tokens.Table;
      return (
        <div key={k} className="table-wrap">
          <table>
            <thead><tr>{tb.header.map((c, i) => <th key={i}>{inline(c.tokens, `${k}h${i}`)}</th>)}</tr></thead>
            <tbody>{tb.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c.tokens, `${k}${ri}-${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case 'text': {
      const x = t as Tokens.Text;
      return <span key={k}>{x.tokens ? inline(x.tokens, k) : unescape(x.text)}</span>;
    }
    default: return <p key={k}>{unescape((t as { raw?: string }).raw ?? '')}</p>;
  }
}

function blocks(tokens: Token[], key = ''): ReactNode[] {
  return tokens.map((t, i) => block(t, `${key}b${i}`));
}

/** One top-level markdown block. Finished blocks never re-render: the prop is just their text. */
const Block = memo(function Block({ raw }: { raw: string }) {
  return <>{blocks(marked.lexer(raw))}</>;
});

/** Split at top-level block boundaries so only the tail re-parses while streaming. */
export function splitBlocks(text: string): string[] {
  return marked.lexer(text).map((t) => t.raw).filter((r) => r.trim() !== '');
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {splitBlocks(text).map((raw, i) => <Block key={i} raw={raw} />)}
    </div>
  );
});
