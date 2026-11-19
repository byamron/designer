import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignTarget, flowOf, flowProps, panelState, shadowProps, strokeProps, typeProps, withAlpha, type Selected } from './model';
import { DEFAULT_SHADOW } from './numbers';

const base: Selected = {
  id: 'e1', tag: 'button', label: 'button.cta', selector: 'button.cta', text: 'Buy', html: '<button class="cta">Buy</button>',
  path: [{ id: 'e0', label: 'body' }],
  rect: { x: 100, y: 50, w: 120, h: 40 },
  parent: { x: 0, y: 0, w: 400, h: 300 },
  style: {
    display: 'block', 'flex-direction': 'row', 'flex-wrap': 'nowrap', gap: 'normal', overflow: 'visible', width: '120px', height: '40px',
    'padding-top': '8px', 'padding-right': '16px', 'padding-bottom': '8px', 'padding-left': '16px', opacity: '0.5', visibility: 'visible',
    'border-radius': '6px 6px 6px 6px', 'background-color': 'rgb(255, 0, 0)', 'border-top-width': '2px', 'border-top-style': 'solid', 'border-top-color': 'rgb(0, 0, 255)',
    'box-shadow': 'none', color: 'rgb(255, 255, 255)', 'font-family': '"Helvetica Neue", Arial', 'font-size': '14px', 'font-weight': '600', 'line-height': 'normal', 'letter-spacing': 'normal', 'text-align': 'start',
  },
  size: { w: 120, h: 40 }, move: { x: 10, y: 0 }, rot: 0, hasText: true, childCount: 0,
};

test('panelState turns a selected payload into panel values', () => {
  const s = panelState(base);
  assert.equal(s.x, 100);
  assert.equal(s.w, 120);
  assert.equal(s.padding, 'mixed');
  assert.equal(s.opacity, 50);
  assert.equal(s.radius, 6);
  assert.equal(s.gap, 0);
  assert.deepEqual(s.fill, { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(s.strokeWidth, 2);
  assert.equal(s.font, 'Helvetica Neue');
  assert.equal(s.lineHeight, null);
  assert.equal(s.letterSpacing, 0);
  assert.equal(s.align, 'left');
  assert.equal(s.weight, 600);
  assert.equal(s.shadow, null);
  assert.equal(s.visible, true);
  assert.equal(s.clip, false);
});

test('flowOf maps display and flex properties to the five flows', () => {
  assert.equal(flowOf({ display: 'block' }), 'block');
  assert.equal(flowOf({ display: 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap' }), 'vertical');
  assert.equal(flowOf({ display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'nowrap' }), 'horizontal');
  assert.equal(flowOf({ display: 'inline-flex', 'flex-direction': 'row', 'flex-wrap': 'wrap' }), 'wrap');
  assert.equal(flowOf({ display: 'grid' }), 'grid');
  for (const f of ['block', 'vertical', 'horizontal', 'wrap', 'grid'] as const) {
    const p = flowProps(f);
    assert.equal(flowOf({ 'flex-direction': 'row', 'flex-wrap': 'nowrap', ...(p as Record<string, string>) }), f);
  }
});

test('align targets the parent edges and centre, by the element\'s visible bounding box', () => {
  assert.deepEqual(alignTarget(base, 'left'), { x: 0 });
  assert.deepEqual(alignTarget(base, 'center'), { x: 140 });
  assert.deepEqual(alignTarget(base, 'right'), { x: 280 });
  assert.deepEqual(alignTarget(base, 'middle'), { y: 130 });
  assert.deepEqual(alignTarget(base, 'bottom'), { y: 260 });
  assert.deepEqual(alignTarget({ ...base, rot: 45, rect: { x: 90, y: 40, w: 150, h: 150 }, size: { w: 120, h: 40 } }, 'right'), { x: 250 });
  assert.equal(alignTarget({ ...base, parent: null }, 'top'), null);
});

test('stroke adds a solid style when a width is set on a border without one', () => {
  const none = { ...panelState(base), strokeStyle: 'none' };
  assert.deepEqual(strokeProps({ width: 2 }, none), { 'border-width': '2px', 'border-style': 'solid' });
  assert.deepEqual(strokeProps({ width: 2 }, panelState(base)), { 'border-width': '2px' });
  assert.deepEqual(strokeProps({ style: 'dashed', color: { r: 0, g: 0, b: 0, a: 1 } }, none), { 'border-style': 'dashed', 'border-color': '#000000' });
});

test('shadow, type and alpha helpers', () => {
  assert.deepEqual(shadowProps(null), { 'box-shadow': 'none' });
  assert.equal(shadowProps(DEFAULT_SHADOW)['box-shadow'], 'rgba(0, 0, 0, 0.25) 0px 4px 8px 0px');
  assert.deepEqual(typeProps({ font: 'Helvetica Neue', size: 18, weight: 700, lineHeight: 0, letterSpacing: 0.5, align: 'center' }), {
    'font-family': '"Helvetica Neue"', 'font-size': '18px', 'font-weight': '700', 'line-height': 'normal', 'letter-spacing': '0.5px', 'text-align': 'center',
  });
  assert.equal(withAlpha({ r: 1, g: 1, b: 1, a: 1 }, 150).a, 1);
  assert.equal(withAlpha({ r: 1, g: 1, b: 1, a: 1 }, 25).a, 0.25);
});
