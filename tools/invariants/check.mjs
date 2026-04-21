#!/usr/bin/env node
// Invariant check for Mini-generated UI. See plan §7.8 (Track A).
//
// Usage:
//   node tools/invariants/check.mjs <path>            human-readable report
//   node tools/invariants/check.mjs <path> --json     machine-readable
//   node tools/invariants/check.mjs <path> --md       markdown snippet for generation-log.md
//
// Exit codes: 0 = all invariants pass, 1 = at least one failure.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, basename } from "node:path";

const EXEMPT_FILES = new Set(["tokens.css", "axioms.css", "primitives.css", "archetypes.css"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "build", ".git"]);

const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g;
const PX_RE = /(?<![\d.\w-])(\d+(?:\.\d+)?)px\b/g;
const MS_RE = /(?<![\d.\w-])(\d+(?:\.\d+)?)(ms|s)\b/g;
const ZINDEX_RE = /z-index\s*:\s*(-?\d+)/g;
const IMPORT_RE = /import\s+[^;]*?from\s+["']([^"']+)["']/g;

const INVARIANTS = [
  { id: "no-hex-literals-in-css", label: "No arbitrary hex color literals in CSS", ext: ".css" },
  { id: "no-px-literals-in-css", label: "No arbitrary px values in CSS", ext: ".css" },
  { id: "no-duration-literals-in-css", label: "No arbitrary ms/s duration literals in CSS", ext: ".css" },
  { id: "no-zindex-literals-in-css", label: "No arbitrary z-index literals in CSS", ext: ".css" },
  { id: "no-hex-literals-in-tsx", label: "No hex color strings in TSX source", ext: ".tsx" },
  { id: "primitives-from-package", label: "Primitives imported from Mini package, not deep relative paths", ext: ".tsx" },
];

function walk(target) {
  const out = [];
  const st = statSync(target);
  if (st.isFile()) return [target];
  for (const entry of readdirSync(target)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(target, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (s.isFile()) out.push(full);
  }
  return out;
}

function stripCssComments(src) {
  // Replace /* ... */ with equal-length whitespace so line numbers are preserved.
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function scanCss(file, src) {
  const findings = { "no-hex-literals-in-css": [], "no-px-literals-in-css": [], "no-duration-literals-in-css": [], "no-zindex-literals-in-css": [] };
  const stripped = stripCssComments(src);
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("@import") || line.trim().startsWith("//")) continue;
    // Hex literals
    for (const m of line.matchAll(HEX_RE)) {
      findings["no-hex-literals-in-css"].push({ file, line: i + 1, match: m[0] });
    }
    // px literals (allow 0px and values inside var())
    for (const m of line.matchAll(PX_RE)) {
      if (m[1] === "0") continue;
      // if match sits inside a var(...) fallback, allow it — e.g. var(--space-3, 12px) is a sensible fallback
      const idx = m.index ?? 0;
      const pre = line.slice(Math.max(0, idx - 40), idx);
      if (/var\s*\([^)]*$/.test(pre)) continue;
      findings["no-px-literals-in-css"].push({ file, line: i + 1, match: m[0] });
    }
    // duration literals (allow 0s / 0ms)
    for (const m of line.matchAll(MS_RE)) {
      if (m[1] === "0") continue;
      const idx = m.index ?? 0;
      const pre = line.slice(Math.max(0, idx - 40), idx);
      if (/var\s*\([^)]*$/.test(pre)) continue;
      findings["no-duration-literals-in-css"].push({ file, line: i + 1, match: m[0] });
    }
    // z-index literal
    for (const m of line.matchAll(ZINDEX_RE)) {
      findings["no-zindex-literals-in-css"].push({ file, line: i + 1, match: `z-index: ${m[1]}` });
    }
  }
  return findings;
}

function scanTsx(file, src) {
  const findings = { "no-hex-literals-in-tsx": [], "primitives-from-package": [] };
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    for (const m of line.matchAll(HEX_RE)) {
      findings["no-hex-literals-in-tsx"].push({ file, line: i + 1, match: m[0] });
    }
  }
  // Import check: primitives must come from the Mini package, not deep relative paths.
  // Exempt: files inside a `primitives/` directory (they ARE the primitives and can reference siblings).
  if (!/\/primitives\//.test(file) && !file.startsWith("primitives/")) {
    const primitiveNames = ["Box", "Stack", "Cluster", "Sidebar", "Center", "Container", "Frame", "Overlay"];
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      const tail = spec.split("/").pop() ?? "";
      if (!primitiveNames.includes(tail)) continue;
      if (spec.startsWith(".")) {
        findings["primitives-from-package"].push({ file, line: lineNumberOf(src, m.index ?? 0), match: spec });
      }
    }
  }
  return findings;
}

function lineNumberOf(src, idx) {
  return src.slice(0, idx).split("\n").length;
}

function run(target) {
  const all = walk(target);
  const results = Object.fromEntries(INVARIANTS.map((inv) => [inv.id, []]));
  let filesScanned = 0;
  for (const file of all) {
    const name = basename(file);
    if (EXEMPT_FILES.has(name)) continue;
    const ext = extname(file);
    if (ext !== ".css" && ext !== ".tsx") continue;
    filesScanned++;
    const src = readFileSync(file, "utf8");
    const rel = relative(process.cwd(), file);
    if (ext === ".css") {
      const found = scanCss(rel, src);
      for (const k of Object.keys(found)) results[k].push(...found[k]);
    } else {
      const found = scanTsx(rel, src);
      for (const k of Object.keys(found)) results[k].push(...found[k]);
    }
  }
  return { filesScanned, results };
}

function formatHuman(target, { filesScanned, results }) {
  const lines = [];
  lines.push(`Target: ${target}`);
  lines.push(`Files scanned: ${filesScanned}`);
  lines.push(`Invariants: ${INVARIANTS.length}`);
  lines.push("");
  let passCount = 0;
  for (const inv of INVARIANTS) {
    const violations = results[inv.id];
    const status = violations.length === 0 ? "PASS" : "FAIL";
    if (violations.length === 0) passCount++;
    lines.push(`${status}: ${inv.label} (${violations.length})`);
    for (const v of violations.slice(0, 10)) {
      lines.push(`  - ${v.file}:${v.line} — ${v.match}`);
    }
    if (violations.length > 10) lines.push(`  …${violations.length - 10} more`);
  }
  lines.push("");
  lines.push(`Result: ${passCount}/${INVARIANTS.length} invariants clean.`);
  return lines.join("\n");
}

function formatJson(target, { filesScanned, results }) {
  const report = {
    target,
    filesScanned,
    invariants: INVARIANTS.map((inv) => ({
      id: inv.id,
      label: inv.label,
      violations: results[inv.id],
      pass: results[inv.id].length === 0,
    })),
  };
  return JSON.stringify(report, null, 2);
}

function formatMarkdown({ results }) {
  const total = INVARIANTS.length;
  const passed = INVARIANTS.filter((inv) => results[inv.id].length === 0).length;
  const lines = [`- invariants: ${passed}/${total} pass`];
  for (const inv of INVARIANTS) {
    const v = results[inv.id];
    if (v.length === 0) continue;
    lines.push(`  - ${inv.id}: ${v.length} violation${v.length === 1 ? "" : "s"} (e.g. ${v[0].file}:${v[0].line} \`${v[0].match}\`)`);
  }
  return lines.join("\n");
}

// --- main ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: check.mjs <path> [--json|--md]");
  process.exit(2);
}
const target = args[0];
const mode = args.includes("--json") ? "json" : args.includes("--md") ? "md" : "human";

const report = run(target);
const anyFail = INVARIANTS.some((inv) => report.results[inv.id].length > 0);

if (mode === "json") console.log(formatJson(target, report));
else if (mode === "md") console.log(formatMarkdown(report));
else console.log(formatHuman(target, report));

process.exit(anyFail ? 1 : 0);
