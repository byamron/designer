// The "Choose folder…" button and its helpers. No DOM: the component is hook-free so it can be called directly,
// and the desktop bridge is a fake object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICLOUD_WARNING, getBridge, icloudWarning, pickFolder } from './folderPicker';
import { ChooseFolderButton } from './ChooseFolderButton';

test('iCloud-synced locations get the plain warning; ~/dev and lookalikes do not', () => {
  assert.equal(ICLOUD_WARNING, 'iCloud may evict files in this folder and git will hang; use a folder under ~/dev');
  for (const p of [
    '/Users/me/Desktop', '/Users/me/Desktop/coding/designer', '/Users/me/Documents/x', '/Users/me/Documents',
    '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/proj', '~/Desktop/coding', '~/Documents', '/Users/me/desktop/x', '/Users/me/Desktop/',
    '  /Users/me/Desktop/x  ',
  ]) assert.equal(icloudWarning(p), ICLOUD_WARNING, p);
  for (const p of [
    '', '   ', '/Users/me/dev/designer', '~/dev', '/Users/me/Desktop2/x', '/Users/me/Documents-old', '/Users/me/dev/Desktop/x', '/Users/me/dev/Documents',
    '/Users/me/Library/Caches', '/Volumes/Work/Desktop/x', '/tmp/Desktop', 'Desktop/x',
  ]) assert.equal(icloudWarning(p), undefined, p);
});

test('the desktop bridge is used only if it is exactly the one function we expect', () => {
  assert.equal(getBridge(undefined), undefined);
  assert.equal(getBridge({}), undefined);
  assert.equal(getBridge({ designerDesktop: {} }), undefined);
  assert.equal(getBridge({ designerDesktop: { chooseFolder: 'nope' } }), undefined);
  const b = { chooseFolder: async () => null };
  assert.equal(getBridge({ designerDesktop: b }), b);
});

test('picking: a path, a cancel, a refusal and a broken bridge are told apart; nothing relative or empty is accepted', async () => {
  assert.deepEqual(await pickFolder({ chooseFolder: async () => '/Users/me/dev/designer' }), { kind: 'picked', path: '/Users/me/dev/designer' });
  assert.deepEqual(await pickFolder({ chooseFolder: async () => null }), { kind: 'cancelled' });
  assert.deepEqual(await pickFolder(undefined), { kind: 'unavailable' });
  for (const bad of ['', '  ', 'relative/path', 42, {}, ['/a'], undefined] as unknown[]) {
    const r = await pickFolder({ chooseFolder: async () => bad as any });
    assert.equal(r.kind, 'error', String(bad)); // anything but a string path or null is a bridge fault, never a folder
  }
  const thrown = await pickFolder({ chooseFolder: async () => { throw new Error('boom'); } });
  assert.equal(thrown.kind, 'error');
  assert.match((thrown as any).message, /Could not open the folder picker/);
  // the page never passes anything to the bridge
  let args: unknown[] = ['untouched'];
  await pickFolder({ chooseFolder: async (...a: unknown[]) => ((args = a), null) } as any);
  assert.deepEqual(args, []);
});

test('the button: absent without the desktop bridge (the typed field stays exactly as before), a labelled real button with it', () => {
  assert.equal(ChooseFolderButton({ bridge: undefined, onPick: () => {}, onError: () => {} }), null);
  const bridge = { chooseFolder: async () => null };
  const html = renderToStaticMarkup(ChooseFolderButton({ bridge, onPick: () => {}, onError: () => {} }) as any);
  assert.match(html, /^<button[^>]*type="button"/);
  assert.match(html, />Choose folder…<\/button>$/);
  assert.match(html, /class="choose-folder"/);
});

test('clicking the button hands a picked path to the form, ignores a cancel, and reports errors', async () => {
  const got: string[] = [];
  const errs: string[] = [];
  const click = (path: unknown) => (ChooseFolderButton({ bridge: { chooseFolder: async () => path as any }, onPick: (p) => got.push(p), onError: (m) => errs.push(m) }) as any).props.onClick();
  await click('/Users/me/dev/designer');
  await click(null);
  await click('relative');
  assert.deepEqual(got, ['/Users/me/dev/designer']);
  assert.equal(errs.length, 1);
});
