#!/usr/bin/env node
// Component-manifest coverage check. Every .tsx file under the
// component-bearing directories must have at least one entry in
// core-docs/component-manifest.json with a matching `path`.
//
// Usage:
//   node tools/manifest/check.mjs                  human-readable
//   node tools/manifest/check.mjs --json           machine-readable
//
// Exit codes: 0 = all files covered, 1 = at least one file missing
// from the manifest.
//
// Why this exists: see ADR 0006 + FB-0034. The manifest is the
// substrate for the AI enforcement loop — a missing entry means an
// AI that consults the manifest before generating won't see the
// existing component and might re-invent it. Manual updates drift.
// CI catches it.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = "core-docs/component-manifest.json";

// Directories whose .tsx files are component sources.
// Update if a new component-bearing directory is introduced.
const COMPONENT_DIRS = [
  "packages/app/src/components",
  "packages/app/src/layout",
  "packages/app/src/tabs",
  "packages/app/src/home",
  "packages/app/src/blocks",
  "packages/app/src/lab",
];

// Files that are not components by convention.
const EXCLUDE_BASENAMES = new Set([
  "index.ts",
  "index.tsx",
  "registry.ts",
  "_typecheck.tsx",
]);

function isComponentFile(file) {
  // Only .tsx — .ts files are hooks / utilities / type defs, not components.
  if (extname(file) !== ".tsx") return false;
  const base = file.split("/").pop() ?? "";
  if (EXCLUDE_BASENAMES.has(base)) return false;
  if (base.endsWith(".test.tsx")) return false;
  if (base.startsWith("_")) return false; // local helpers
  return true;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (s.isFile() && isComponentFile(full)) out.push(full);
  }
  return out;
}

function loadManifest() {
  const src = readFileSync(MANIFEST_PATH, "utf8");
  const json = JSON.parse(src);
  return json.components ?? [];
}

function run() {
  const components = loadManifest();
  const coveredPaths = new Set(
    components
      .filter((c) => c.path)
      .map((c) => c.path)
  );

  const allFiles = COMPONENT_DIRS.flatMap((d) => walk(d));
  const relFiles = allFiles.map((f) => relative(ROOT, f));

  const missing = relFiles.filter((p) => !coveredPaths.has(p));
  const stalePaths = [...coveredPaths].filter((p) => {
    // Tombstones for retired components are allowed (no file on disk).
    const entry = components.find((c) => c.path === p);
    if (entry?.status === "retired") return false;
    return !existsSync(join(ROOT, p));
  });

  return { allFiles: relFiles, missing, stalePaths };
}

function formatHuman({ allFiles, missing, stalePaths }) {
  const lines = [];
  lines.push(`Manifest: ${MANIFEST_PATH}`);
  lines.push(`Component files scanned: ${allFiles.length}`);
  lines.push(`Manifest entries with live path: ${allFiles.length - missing.length}`);
  lines.push("");
  if (missing.length === 0) {
    lines.push("PASS: every component file has a manifest entry.");
  } else {
    lines.push(`FAIL: ${missing.length} component file(s) missing from manifest:`);
    for (const p of missing) lines.push(`  - ${p}`);
  }
  if (stalePaths.length > 0) {
    lines.push("");
    lines.push(`WARN: ${stalePaths.length} manifest path(s) point at non-existent files:`);
    for (const p of stalePaths) lines.push(`  - ${p}`);
    lines.push(`  (mark as "status": "retired" in the manifest if the file was deleted)`);
  }
  return lines.join("\n");
}

function formatJson(report) {
  return JSON.stringify(
    {
      ...report,
      pass: report.missing.length === 0,
    },
    null,
    2
  );
}

const args = process.argv.slice(2);
const mode = args.includes("--json") ? "json" : "human";

const report = run();
const fail = report.missing.length > 0;

if (mode === "json") console.log(formatJson(report));
else console.log(formatHuman(report));

process.exit(fail ? 1 : 0);
