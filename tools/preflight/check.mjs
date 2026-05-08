#!/usr/bin/env node
// Preflight check — runs cheap, mechanical verifications that catch
// the failure patterns we keep introducing into PRs. Designed to fail
// fast on the local machine BEFORE invoking /staff-review or pushing
// to CI.
//
// Per CLAUDE.md §How-to-Work item 7 (workflow), this is the first
// gate in the implement → self-review → staff-review → merge sequence.
// Cheap to run (sub-second), catches what's catchable mechanically,
// frees reviewer-agent budget for subtler issues.
//
// Usage:
//   node tools/preflight/check.mjs              # check current branch diff vs origin/main
//   node tools/preflight/check.mjs --base v0.1.1  # check vs a tag
//
// Exits 0 on clean, 1 on any check failure.
//
// Checks performed:
//   1. CSS token references resolve to real definitions. Catches
//      `var(--undefined-token, fallback)` chains where the primary
//      token doesn't exist; the fallback hides the gap and the manifest
//      claims phantom tokens. (Failure mode: PR #124, PR #126 review.)
//   2. PR body / reviewer notes don't include "## Follow-ups" as a
//      standalone list — per CLAUDE.md item 6, follow-ups belong in
//      roadmap.md / parking-lot.md. The PR body MAY cross-reference;
//      MUST NOT be the only home. (Failure mode: PR #122, PR #124
//      pre-merge corrections.)
//   3. Verifies common PR-body claims against the diff. If the body
//      says "token-only CSS", grep the changed CSS for raw values.
//      If it says "no Rust changes", grep for .rs in the diff.
//
// Failure-pattern memory entries informed these checks. Add new
// checks here when a new pattern surfaces; the cost is one function
// + one entry in the runner below.
//
// This script is living — extend it. Per CLAUDE.md §How-to-Work
// item 7, when /staff-review catches a class of issue that could
// have been caught mechanically, the right move is a new preflight
// check (cheap, fast, repeatable) plus a memory entry (so the
// pattern is named) — not a one-off fix and a hope it won't recur.
// The cost of growing this file is one function; the cost of
// running on a stale preflight is every BLOCKER it would have
// caught.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

function getBaseRef() {
  const baseFlag = process.argv.indexOf("--base");
  if (baseFlag !== -1 && process.argv[baseFlag + 1]) {
    return process.argv[baseFlag + 1];
  }
  return "origin/main";
}

function getChangedFiles(base) {
  try {
    const out = execSync(`git diff ${base}...HEAD --name-only --diff-filter=ACM`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getDiffText(base) {
  try {
    return execSync(`git diff ${base}...HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Check 1 — CSS token references must resolve
// ---------------------------------------------------------------------------

const TOKEN_DEF_FILES = [
  "packages/ui/styles/tokens.css",
  "packages/app/src/styles/app.css",
  "packages/app/src/styles/blocks.css",
  "packages/app/src/styles/atoms.css",
];

function gatherDefinedTokens() {
  const defined = new Set();
  for (const path of TOKEN_DEF_FILES) {
    const abs = resolve(REPO_ROOT, path);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    // Match `--name:` definitions (strict: must be at start of a line
    // or after whitespace; followed by a colon).
    const re = /(?:^|\s)(--[a-z][a-z0-9-]*)\s*:/gim;
    let m;
    while ((m = re.exec(text)) !== null) {
      defined.add(m[1]);
    }
  }
  return defined;
}

function checkCssTokens(changedFiles) {
  const cssFiles = changedFiles.filter(
    (f) => f.endsWith(".css") && f.startsWith("packages/"),
  );
  if (cssFiles.length === 0) {
    return { name: "css-tokens", status: "skip", details: "no CSS changes" };
  }
  const defined = gatherDefinedTokens();
  const failures = [];
  for (const path of cssFiles) {
    const abs = resolve(REPO_ROOT, path);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    // Match `var(--name)` and `var(--name, ...)` references.
    const re = /var\(\s*(--[a-z][a-z0-9-]*)/gi;
    let m;
    const seen = new Set();
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      if (defined.has(name)) continue;
      // Allow some known external / build-time tokens.
      if (name.startsWith("--gray-") || name.startsWith("--sand-")) continue;
      // Compute line number for the report.
      const idx = m.index;
      const lineNo = text.slice(0, idx).split("\n").length;
      failures.push({ path, line: lineNo, token: name });
    }
  }
  if (failures.length === 0) {
    return {
      name: "css-tokens",
      status: "pass",
      details: `${cssFiles.length} CSS file(s) clean`,
    };
  }
  return {
    name: "css-tokens",
    status: "fail",
    details: failures
      .map((f) => `  ${f.path}:${f.line} — ${f.token} not defined`)
      .join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Check 2 — PR body must not have a standalone "## Follow-ups" section
// ---------------------------------------------------------------------------

function checkPrBodyFollowups() {
  // Only relevant when there's an open PR. Skip otherwise.
  let body = "";
  try {
    const branch = execSync("git branch --show-current", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    if (!branch || branch === "main") {
      return { name: "pr-body-followups", status: "skip", details: "no branch" };
    }
    const prJson = execSync(
      `gh pr list --head "${branch}" --json number,body --limit 1`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const prs = JSON.parse(prJson);
    if (prs.length === 0) {
      return { name: "pr-body-followups", status: "skip", details: "no PR" };
    }
    body = prs[0].body ?? "";
  } catch {
    return { name: "pr-body-followups", status: "skip", details: "gh unavailable" };
  }
  // Match a top-level "## Follow-ups" / "## Followups" / "## Follow ups"
  // header. Allow it as a sub-bullet inside Reviewer notes (the
  // _Filed:_ pattern), but a standalone section violates item 6.
  const re = /^##\s+follow[\s-]?ups\s*$/im;
  if (re.test(body)) {
    return {
      name: "pr-body-followups",
      status: "fail",
      details:
        "PR body has a standalone '## Follow-ups' section. Per CLAUDE.md\n" +
        "  item 6, follow-ups must live in core-docs/roadmap.md or\n" +
        "  core-docs/parking-lot.md. The PR body may cross-reference\n" +
        "  inside the Reviewer notes _Filed:_ line — never as the only home.",
    };
  }
  return { name: "pr-body-followups", status: "pass", details: "no orphan section" };
}

// ---------------------------------------------------------------------------
// Check 3 — verify common PR-body claims against the diff
// ---------------------------------------------------------------------------

function checkPrClaims(diff) {
  let body = "";
  try {
    const branch = execSync("git branch --show-current", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    if (!branch || branch === "main") {
      return { name: "pr-claims", status: "skip", details: "no branch" };
    }
    const prJson = execSync(
      `gh pr list --head "${branch}" --json number,body --limit 1`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const prs = JSON.parse(prJson);
    if (prs.length === 0) {
      return { name: "pr-claims", status: "skip", details: "no PR" };
    }
    body = (prs[0].body ?? "").toLowerCase();
  } catch {
    return { name: "pr-claims", status: "skip", details: "gh unavailable" };
  }
  const failures = [];
  // Claim: "token-only CSS" (or similar). Verify by grepping changed
  // CSS for raw px / hex / ms outside `var(...)` references.
  if (
    /token[- ]only css|no raw (?:px|hex|ms)/i.test(body) ||
    /pure (?:css )?tokens/i.test(body)
  ) {
    // Restrict to lines added in the CSS portion of the diff.
    const addedCss = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const rawPx = addedCss.find((l) =>
      /[^a-zA-Z_-][0-9]+px(?![0-9])/.test(l) &&
      !l.includes("var(--") &&
      !l.includes("//") && !l.includes("/*"),
    );
    if (rawPx) {
      failures.push(
        `PR body claims token-only CSS but added a line with a raw px:\n    ${rawPx.trim()}`,
      );
    }
  }
  // Claim: "no Rust changes" / "pure docs change" — verify by checking
  // the diff for .rs files. Also verify no Cargo.toml additions.
  if (/no rust changes|pure docs(?: change|-only)/i.test(body)) {
    const rsLines = diff
      .split("\n")
      .filter(
        (l) => l.startsWith("+++ b/") && (l.endsWith(".rs") || l.endsWith("Cargo.toml")),
      );
    if (rsLines.length > 0) {
      failures.push(
        `PR body claims no Rust / pure-docs change but the diff touches:\n${rsLines
          .map((l) => `    ${l.replace("+++ b/", "")}`)
          .join("\n")}`,
      );
    }
  }
  if (failures.length === 0) {
    return { name: "pr-claims", status: "pass", details: "claims match diff" };
  }
  return {
    name: "pr-claims",
    status: "fail",
    details: failures.join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const base = getBaseRef();
const changedFiles = getChangedFiles(base);
const diff = getDiffText(base);

console.log(`Preflight check — base ${base}`);
console.log(`Files changed: ${changedFiles.length}`);
console.log("");

const checks = [
  checkCssTokens(changedFiles),
  checkPrBodyFollowups(),
  checkPrClaims(diff),
];

let failed = false;
for (const c of checks) {
  const tag = c.status === "pass" ? "PASS" : c.status === "skip" ? "SKIP" : "FAIL";
  console.log(`${tag}: ${c.name}${c.details ? " — " + c.details.split("\n")[0] : ""}`);
  if (c.status === "fail") {
    failed = true;
    const rest = c.details.split("\n").slice(1);
    if (rest.length > 0) console.log(rest.map((l) => "  " + l).join("\n"));
  }
}

console.log("");
if (failed) {
  console.log("Result: preflight FAILED. Fix before requesting /staff-review.");
  process.exit(1);
} else {
  console.log("Result: preflight clean. OK to proceed to self-review + staff-review.");
}
