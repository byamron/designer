import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditsReport, colorToHex, countChanges, type EditEntry } from '@designer/shared';

const entry = (over: Partial<EditEntry> = {}): EditEntry => ({
  id: 'e1', label: 'button.cta', selector: 'main > .card > button.cta', text: 'Start free trial', html: '<button class="cta">Start free trial</button>',
  changes: [], ...over,
});

test('colorToHex converts rgb/rgba and leaves other values alone', () => {
  assert.equal(colorToHex('rgb(196, 85, 45)'), '#c4552d');
  assert.equal(colorToHex('rgba(0, 0, 0, 0.5)'), '#00000080');
  assert.equal(colorToHex('rgba(0, 0, 0, 0)'), 'transparent');
  assert.equal(colorToHex('rgb(10 20 30 / 50%)'), '#0a141e80');
  assert.equal(colorToHex('red'), 'red');
  assert.equal(colorToHex('#fff'), '#fff');
});

test('empty or change-less edits produce no report', () => {
  assert.equal(buildEditsReport([]), '');
  assert.equal(buildEditsReport([entry()]), '');
});

test('report lists selector, html and each change with hex colors', () => {
  const r = buildEditsReport(
    [entry({ changes: [
      { prop: 'background-color', from: 'rgb(196, 85, 45)', to: '#1f6feb' },
      { prop: 'border-radius', from: '10px', to: '16px' },
      { prop: 'box-shadow', from: 'none', to: 'rgba(0, 0, 0, 0.25) 0px 4px 12px 0px' },
    ] })],
    { file: 'demo.html', workspace: 'Main folder' },
  );
  assert.match(r, /3 changes on 1 element/);
  assert.match(r, /Previewed file: demo\.html \(workspace: Main folder\)/);
  assert.match(r, /1\. button\.cta {2}"Start free trial"/);
  assert.match(r, /Selector: main > \.card > button\.cta/);
  assert.match(r, /HTML: <button class="cta">/);
  assert.match(r, /- background-color: #c4552d → #1f6feb/);
  assert.match(r, /- border-radius: 10px → 16px/);
  assert.match(r, /- box-shadow: none → #00000040 0px 4px 12px 0px/);
  assert.match(r, /do not paste inline styles/);
});

test('moves and rotation read as plain language', () => {
  const r = buildEditsReport([entry({ changes: [
    { prop: 'translate', from: 'none', to: '12px -4px' },
    { prop: 'rotate', from: 'none', to: '15deg' },
  ] })]);
  assert.match(r, /moved 12px right, 4px up from its laid-out position \(translate: 12px -4px\)/);
  assert.match(r, /rotation: 0deg → 15deg/);
  assert.match(buildEditsReport([entry({ changes: [{ prop: 'translate', from: '3px 0px', to: '0px 0px' }] })]), /back at its laid-out position/);
});

test('counts and plurals across several elements; long text is shortened', () => {
  const a = entry({ text: 'x'.repeat(100), changes: [{ prop: 'opacity', from: '1', to: '0.5' }] });
  const b = entry({ id: 'e2', label: 'h1', changes: [{ prop: 'font-size', from: '32px', to: '40px' }, { prop: 'font-weight', from: '400', to: '700' }] });
  assert.equal(countChanges([a, b]), 3);
  const r = buildEditsReport([a, b]);
  assert.match(r, /3 changes on 2 elements/);
  assert.match(r, /1\. button\.cta {2}"x{57}…"/);
  assert.match(r, /2\. h1/);
  assert.match(buildEditsReport([a]), /1 change on 1 element\./);
});
