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
const SCHEMA_PATH = "templates/component-manifest.schema.json";

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

function loadSchemaKeys() {
  // Lightweight schema key check — full JSON-schema validation would
  // require ajv as a dependency. This catches the most common drift:
  // entries that carry a property the schema doesn't declare. If the
  // schema's `additionalProperties: false` is ever relaxed, this still
  // flags the contract gap rather than silently accepting it.
  if (!existsSync(SCHEMA_PATH)) return null;
  const src = readFileSync(SCHEMA_PATH, "utf8");
  const json = JSON.parse(src);
  const props = json?.$defs?.component?.properties;
  if (!props) return null;
  return new Set(Object.keys(props));
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

  // Schema-key drift: properties on entries that aren't declared in the
  // schema. Catches the common case where someone adds a field to the
  // manifest without updating the schema (or vice versa).
  const schemaKeys = loadSchemaKeys();
  const schemaDrift = [];
  if (schemaKeys) {
    for (const c of components) {
      for (const k of Object.keys(c)) {
        if (!schemaKeys.has(k)) {
          schemaDrift.push(`${c.name ?? "(unnamed)"}: extra field "${k}"`);
        }
      }
    }
  }

  return { allFiles: relFiles, missing, stalePaths, schemaDrift };
}

function formatHuman({ allFiles, missing, stalePaths, schemaDrift }) {
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
  if (schemaDrift.length > 0) {
    lines.push("");
    lines.push(`FAIL: ${schemaDrift.length} schema-key drift(s) — manifest entries carry fields the schema doesn't declare:`);
    for (const d of schemaDrift) lines.push(`  - ${d}`);
    lines.push(`  (add the property to templates/component-manifest.schema.json or remove from the entry)`);
  }
  return lines.join("\n");
}

function formatJson(report) {
  return JSON.stringify(
    {
      ...report,
      pass: report.missing.length === 0 && report.schemaDrift.length === 0,
    },
    null,
    2
  );
}

const args = process.argv.slice(2);
const mode = args.includes("--json") ? "json" : "human";

const report = run();
const fail = report.missing.length > 0 || report.schemaDrift.length > 0;

if (mode === "json") console.log(formatJson(report));
else console.log(formatHuman(report));

process.exit(fail ? 1 : 0);
