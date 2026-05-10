#!/usr/bin/env node
// feedback-status — report the health of the taste-loop feedback ledger.
//
// Two modes:
//
//   1. Multi-project mode (default; this repo's home).
//      No args. Reads every projects/*/feedback/*.md (excluding README.md),
//      reports per project. The taste-loop monorepo's own use.
//
//   2. Single-feedback-dir mode (consuming projects).
//      `node tools/feedback-status.mjs <path/to/feedback/dir>`. Reads one
//      feedback directory directly. Used when this script is vendored into
//      a consuming project (e.g., Designer's core-docs/taste/feedback/).
//
// Reads each ledger entry (matching the cycle filename pattern). Classifies
// each as distilled (carries a "**Distilled:** YYYY-MM-DD" footer) or
// undistilled. Prints a status line and an overall verdict.
//
// Used as a gate by .claude/skills/drain-feedback and .claude/skills/distill-feedback,
// and as the first-action check on session start (see CLAUDE.md).
//
// Exit codes:
//   0 — HEALTHY (undistilled count < threshold)
//   1 — DUE (undistilled count >= threshold)
//   2 — error (couldn't read state)
//
// Threshold is "every 2-3 cycles" — flag at >= 3 undistilled, soft-warn at 2.
// The threshold is a default, not a hard rule. Skills surface the result and
// allow user override; the script itself just reports.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEFAULT_PROJECTS_DIR = join(REPO_ROOT, "projects");

const THRESHOLD_DUE = 3;     // >= this → DUE
const THRESHOLD_WARN = 2;    // == this → WARN (still HEALTHY but close)
const DISTILLED_RE = /^\*\*Distilled:\*\*\s*(\d{4}-\d{2}-\d{2})/m;
const CYCLE_RE = /^\d{4}-\d{2}-\d{2}-cycle-/;

async function safeReaddir(p) {
  try { return await readdir(p); } catch { return []; }
}

async function isDir(p) {
  try { const s = await stat(p); return s.isDirectory(); } catch { return false; }
}

async function readFeedbackDir(feedbackDir, label) {
  if (!(await isDir(feedbackDir))) return null;
  const files = (await safeReaddir(feedbackDir))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .filter((f) => CYCLE_RE.test(f))
    .sort();

  const cycles = [];
  for (const f of files) {
    const body = await readFile(join(feedbackDir, f), "utf8");
    const m = body.match(DISTILLED_RE);
    cycles.push({
      file: f,
      distilled: !!m,
      distilledOn: m ? m[1] : null,
    });
  }

  const total = cycles.length;
  const distilled = cycles.filter((c) => c.distilled).length;
  const undistilled = total - distilled;

  const lastDistilledOn = cycles
    .filter((c) => c.distilled)
    .map((c) => c.distilledOn)
    .sort()
    .at(-1) ?? null;

  let verdict;
  if (undistilled >= THRESHOLD_DUE) verdict = "DUE";
  else if (undistilled === THRESHOLD_WARN) verdict = "WARN";
  else verdict = "HEALTHY";

  return {
    label,
    total,
    distilled,
    undistilled,
    lastDistilledOn,
    verdict,
    undistilledFiles: cycles.filter((c) => !c.distilled).map((c) => c.file),
  };
}

async function readMultiProject(projectsDir) {
  const projectNames = await safeReaddir(projectsDir);
  const reports = [];
  for (const name of projectNames) {
    if (!(await isDir(join(projectsDir, name)))) continue;
    const feedbackDir = join(projectsDir, name, "feedback");
    const r = await readFeedbackDir(feedbackDir, name);
    if (r) reports.push(r);
  }
  return reports;
}

async function main() {
  const arg = process.argv[2];
  let reports;

  if (arg) {
    // Single-feedback-dir mode.
    const feedbackDir = resolve(process.cwd(), arg);
    const label = relative(process.cwd(), feedbackDir) || feedbackDir;
    const r = await readFeedbackDir(feedbackDir, label);
    if (!r) {
      console.error(`feedback-status — no feedback dir at ${feedbackDir}`);
      process.exit(2);
    }
    reports = [r];
  } else {
    // Multi-project default.
    reports = await readMultiProject(DEFAULT_PROJECTS_DIR);
    if (reports.length === 0) {
      console.log("feedback-status — no projects with feedback ledgers found.");
      process.exit(0);
    }
  }

  let worst = "HEALTHY";
  for (const r of reports) {
    if (r.verdict === "DUE") worst = "DUE";
    else if (r.verdict === "WARN" && worst !== "DUE") worst = "WARN";
  }

  console.log("feedback-status — taste-loop ledger health\n");
  for (const r of reports) {
    const lastD = r.lastDistilledOn ?? "never";
    const tag = r.verdict.padEnd(7);
    console.log(
      `  [${tag}] ${r.label.padEnd(20)} ` +
      `${r.total} cycles · ${r.distilled} distilled · ${r.undistilled} undistilled · last distill: ${lastD}`
    );
    if (r.undistilled > 0) {
      for (const f of r.undistilledFiles) console.log(`              · ${f}`);
    }
  }

  console.log("");
  if (worst === "DUE") {
    console.log("VERDICT: DISTILLATION DUE.");
    console.log("Run .claude/skills/distill-feedback before draining another cycle or starting other work.");
    console.log("(Override only if the undistilled cycles are clearly noise — see CLAUDE.md.)");
    process.exit(1);
  } else if (worst === "WARN") {
    console.log("VERDICT: HEALTHY (warn). One cycle away from DUE.");
    process.exit(0);
  } else {
    console.log("VERDICT: HEALTHY.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("feedback-status — error:", err.message);
  process.exit(2);
});
