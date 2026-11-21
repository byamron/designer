import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

test('inline code shows quotes, <, > and & literally (escaped exactly once)', () => {
  assert.equal(html("`'<'`"), "<div class=\"md\"><p><code>&#x27;&lt;&#x27;</code></p></div>");
  assert.equal(html('`a && b > c "d"`'), '<div class="md"><p><code>a &amp;&amp; b &gt; c &quot;d&quot;</code></p></div>');
  assert.ok(!html("`'<'`").includes('&amp;'), 'no double escaping');
});

test('fenced code shows quotes, <, > and & literally', () => {
  const out = html("```html\n<a href=\"x\">it's & more</a>\n```");
  assert.ok(out.includes('&lt;a href=&quot;x&quot;&gt;it&#x27;s &amp; more&lt;/a&gt;'), out);
  assert.ok(!out.includes('&amp;lt;') && !out.includes('&amp;#'), out);
});

test('plain text shows quotes, <, > and & literally', () => {
  const out = html(`It's "fine" & 1 < 2 > 0`);
  assert.ok(out.includes('It&#x27;s &quot;fine&quot; &amp; 1 &lt; 2 &gt; 0'), out);
  assert.ok(!out.includes('&amp;amp;') && !out.includes('&amp;#') && !out.includes('&amp;quot;') && !out.includes('&amp;lt;'), out);
});

test('HTML in model text is never injected as markup', () => {
  for (const s of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '`<b>x</b>`', '```\n<iframe src=x></iframe>\n```', '**<u>y</u>**', '[a](javascript:alert(1))']) {
    const out = html(s);
    assert.ok(!/<(script|img|iframe|b|u)[\s>]/.test(out), `${s} -> ${out}`);
    assert.ok(!/href="javascript:/i.test(out), out);
  }
  assert.ok(html('<script>alert(1)</script>').includes('&lt;script&gt;'));
});
