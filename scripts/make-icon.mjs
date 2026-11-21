#!/usr/bin/env node
// Regenerate packages/desktop/assets/Designer.icns from icon.svg (macOS only: uses Chromium from Playwright and iconutil).
// The .icns is committed, so building Designer.app never needs this. Run it only when you change icon.svg.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'packages', 'desktop', 'assets');
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = readFileSync(join(assets, 'icon.svg'), 'utf8');
const set = join(tmpdir(), `designer-icon-${process.pid}.iconset`);
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
const browser = await chromium.launch();
try {
  for (const [name, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) {
    const page = await browser.newPage({ viewport: { width: px, height: px } });
    await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${px}px;height:${px}px">${svg.replace('width="1024" height="1024"', `width="${px}" height="${px}"`)}</div>`);
    await page.screenshot({ path: join(set, `icon_${name}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(assets, 'Designer.icns')]);
rmSync(set, { recursive: true, force: true });
console.log('wrote packages/desktop/assets/Designer.icns');
