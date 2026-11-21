// Where is the Designer checkout this app runs? Self-contained (no Electron, no imports from the checkout): it has to work
// exactly when the checkout is missing. Used by main.cjs and unit tested.
'use strict';
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function isCheckout(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'designer' && existsSync(join(dir, 'packages', 'desktop', 'main.mjs'));
  } catch {
    return false;
  }
}

/** `resources` is the bundle's Contents/Resources. DESIGNER_CHECKOUT overrides the path the bundle was built for (tests). */
function locate({ resources, env }) {
  let baked;
  try {
    baked = JSON.parse(readFileSync(join(resources, 'designer.json'), 'utf8')).checkout;
  } catch {
    /* handled below */
  }
  const checkout = env.DESIGNER_CHECKOUT || baked;
  if (!checkout) return { ok: false, message: "This copy of Designer doesn't know where its code is. In your Designer folder, run: npm run make-app" };
  if (!isCheckout(checkout)) {
    return {
      ok: false,
      checkout,
      message: `Designer can't find its code at:\n${checkout}\n\nIf you moved or deleted that folder, choose the new one. Or, in the new folder, run: npm run make-app`,
    };
  }
  return { ok: true, checkout };
}

module.exports = { isCheckout, locate };
