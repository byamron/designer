# Security & Trust

Designer's promise to sensitive-data teams is that the user's code, prompts, and project context never leave the device — and that the builders of Designer have no technical capability to see them even if asked. This document is the source of truth for how that promise is architected, enforced, and scoped into the roadmap.

**Scope note on "enterprise-grade."** We use "enterprise-grade" to mean *a tool that companies are comfortable letting their employees use on sensitive work* — given the existing scope of Designer as a local-first, per-user, desktop cockpit for the user's own Claude Code install. It does not mean identity-federation (SSO, SAML, SCIM) — Designer does not host user accounts, so those are not in scope and are not promised. It means the security *properties* a company's IT or security team would evaluate before approving the tool: the vendor cannot see the code or prompts, data stays on the device, the event log is tamper-evident, the build is signed and provenance-attested, sensitive data at rest is encrypted, fleet policy can be enforced via MDM, credentials are revocable, and a responsible-disclosure process exists. Identity stays with the user's OS account and their Claude Code install.

It supplements `spec.md` §"Anthropic Compliance Model" (which covers the runtime arrangement with Claude) and `roadmap.md` (which sequences the work). Invariants stated here are as binding as those in §5 of the spec.

---

## Principles

1. **We cannot see customer data.** Designer emits zero network traffic of its own. The user's code, prompts, and agent transcripts live on their device and nowhere else. Any egress the user observes is attributable to Claude Code, the user's own git / gh operations, or a tool an agent explicitly invoked — each of which is surfaced in the activity spine.
2. **The worktree is the enforcement boundary.** Designer does not sandbox Claude Code's network egress, rewrite its prompts, or proxy its traffic. We constrain what agents can *write* and surface what they *do*; we do not try to gate what the underlying Claude runtime can reach.
3. **Risk-tiered gates, not prompt-on-everything.** The many-agents value prop dies under approval fatigue. Irreversible or cross-org actions get OS-native confirmation (Touch ID); routine writes get in-app approval; first-use-per-tool gets a per-track capability grant. Approval density scales with blast radius.
4. **Context visibility is a feature, not a mitigation.** We do not attempt to sanitize prompt injection out of repo content — repo docs are how the product works. We make the context an agent is about to act on *visible and diffable* to the user, and we bound the blast radius through capabilities.
5. **Enforcement in the Rust core, not the webview.** A compromised frontend (XSS via a future dep update, or a malicious webview escape) cannot bypass approvals. Approval resolution happens in Rust; high-risk actions require a platform-native dialog or biometric assertion the webview cannot synthesize.
6. **Tamper-evidence as a launch claim.** If we tell sensitive-data teams the event log is trustworthy, it must actually be trustworthy. Chain + anchor ships at GA, not at team-tier.

---

## Threat model (informal)

Adversaries considered:

- **Prompt injection via repo content.** A malicious file committed to a repo (or slipped into a PR) instructs an agent to exfiltrate code, push to an attacker fork, or write to a sensitive path. *Mitigation:* capability-bounded agent actions + pre-action context manifest + untrusted-lane tagging. We cannot fully solve this; we bound the blast radius.
- **Compromised local `claude` binary.** A malware-planted or PATH-hijacked `claude` on the user's machine is silently spawned by Designer. *Mitigation:* `SecStaticCodeCheckValidity` against Anthropic's Developer ID before spawn.
- **Compromised Designer dependency.** A malicious Cargo / npm dep lands via a pinned update and runs in-process. *Mitigation:* `cargo-deny` / `cargo-vet` / `cargo-audit` / `npm audit` as blocking CI; SBOM + SLSA provenance; ephemeral CI runners.
- **Laptop theft or shared-Mac access.** Another user opens Designer on an unlocked Mac, or the device is stolen while unlocked. *Mitigation:* sensitive event fields are encrypted at rest with a Keychain-sealed device-only key (non-syncable); FileVault is the assumed baseline.
- **Local malware tampering with event log.** Another process on the user's device silently rewrites `~/.designer/events.db` so retroactive approvals appear consistent. *Mitigation:* HMAC chain with session-sealed key + periodic external anchor; chain breaks are surfaced as an alert.
- **Compromised CI runner leaking OAuth.** The self-hosted runner used for Tier-2 live-integration tests holds the user's real Claude OAuth. *Mitigation:* ephemeral runner VMs, egress allowlist, scoped short-lived tokens, isolation from Tier-1.
- **Coerced update / supply chain of the updater.** An attacker with control over the update host pushes a malicious Designer release. *Mitigation:* dual-key Ed25519 (primary + revocation), HSM-backed signing, documented rotation, signed release manifest.
- **Inter-workspace leakage.** A compromised workspace's events tamper with or read another workspace's state. *Mitigation:* per-workspace keyed HMAC domain separation; per-workspace capability scopes.
- **Webview escape / XSS via future dep.** A compromised frontend synthesizes approvals. *Mitigation:* approval resolution in Rust core; high-risk actions require OS-native biometric assertion the webview cannot synthesize; CSP `frame-ancestors 'self'`.
- **Mobile sync interception.** A relay operator, network observer, or compromised relay reads cross-device traffic. *Mitigation:* E2EE (Noise or Signal-style), ciphertext-only relay, forward secrecy, explicit device pairing with short-authentication-string.

Out of scope for v1:

- Kernel-level compromise of the user's Mac. If the OS is compromised, Designer cannot defend itself; FileVault + secure boot are the user's baseline.
- Claude Code's own integrity. Designer verifies the binary signature but does not audit its behavior in depth. Claude Code is a trusted runtime per the compliance model.
- Targeted attacks on specific users by a well-resourced adversary with physical access over time.

---

## Non-goals (explicit)

Called out so no future feature request or customer demand silently relaxes them:

- **We do not sandbox Claude Code's network egress.** Attempting to proxy or block Claude's traffic breaks MCP servers, web fetch, and the tooling ecosystem the user pays for; it also drifts us toward "reconfiguring Claude," which violates the "we orchestrate, we do not impersonate" principle. Observability, not interception, is our boundary.
- **We do not strip prompt-injection patterns from repo content.** `CLAUDE.md` is instruction-shaped on purpose. We show the user what context is being loaded; we do not mutate it.
- **We do not pursue SOC 2 / ISO 27001 preemptively.** With zero data collection the scope is awkward and the artifact may be theater. We pursue it reactively when a specific enterprise deal requires it; the default credibility artifact is an independent third-party pentest + a one-page trust statement.
- **We do not ship "airgap mode" as a product claim.** Claude Code requires network access; calling Designer airgap-capable is misleading. We claim, and can prove, that *Designer itself* emits zero network traffic.
- **We never auto-update silently.** Updates require user consent. No exceptions.

---

## Phases (summary — full detail in `roadmap.md`)

Security work is folded into existing phases rather than living as a parallel universe that can slip. Three explicit sub-phases gate the three launch milestones.

### Phase 13.G — Safety surfaces + Keychain (landed 2026-04-25)

Foundation that 13.H builds on — surfaces and credential paths, not enforcement primitives. Three constraints from this section are now real instead of aspirational:

- **Approval gates run in the Rust core (Decision 22).** `InboxPermissionHandler` (in `crates/designer-claude`) replaces `AutoAcceptSafeTools` as the production permission handler via `ClaudeCodeOrchestrator::with_permission_handler()`. Every Claude permission prompt parks the agent on a `tokio::sync::oneshot` channel inside Rust; the only release path is an event-store-backed `cmd_resolve_approval`. A compromised webview cannot synthesize a grant — it can only call the IPC, which writes to the audit log first and the agent-wakeup second. Default timeout: 5 minutes (emits `ApprovalDenied{reason:"timeout"}` and tells the agent to deny). Boot-time orphan-approval sweep emits `ApprovalDenied{reason:"process_restart"}` so phantom rows don't surface after a restart.
- **Keychain integration is read-only (Decision 26).** `apps/desktop/src-tauri` depends on `security-framework` (`[target.'cfg(target_os = "macos")']` only) for one operation — `get_generic_password(service, "")` against `Claude Code-credentials` (overridable via `DESIGNER_CLAUDE_KEYCHAIN_SERVICE` env var). The result is a presence check; the secret bytes are never read into Designer memory and never written back. Settings → Account renders a stable copy ("Connected via macOS Keychain — Designer never reads your token.") + a state dot. The "last verified" timestamp is process-local (`OnceLock<Mutex<Option<String>>>`), never persisted, never sent anywhere.
- **Sandboxed previews remain intact (Decision 23).** This phase did not touch HTML preview rendering or the CSP builder; the changes are confined to event flow, IPC handlers, and a topbar chip. No new iframe sources, no new scripts, no relaxed `frame-ancestors`.

Scope additions that 13.H must build on:

- `record_scope_denial` emits both `ScopeDenied` (domain event) and an inline `comment` artifact anchored to the offending change. 13.H's pre-write enforcement should call this helper on every refused write so the user sees a clear, non-blocking surface explaining what the agent tried.
- `PermissionRequest` gained an additive `workspace_id: Option<WorkspaceId>` field. The trait shape stayed frozen (per ADR 0002 §"PermissionHandler"). 13.D's stdio reader must populate this when it wires the handler — the inbox handler fails closed when it's `None` (denying is safer than silently dropping the prompt).
- Cost chip is opt-in (Decision 34). The `cost_chip_enabled: bool` setting persists in `~/.designer/settings.json` and defaults to `false`. The chip subscribes to `cost_recorded` stream events so the topbar updates without explicit refresh.

### Phase 13.H — Safety enforcement (blocks GA)

Everything required before any shipped build exists.

- `ApprovalGate` wired to `Orchestrator`; pre-write enforcement in the Rust core, not post-append.
- Risk-tiered gates:
  - *In-app approval* for routine agent writes inside the worktree.
  - *Touch ID* (`LocalAuthentication.framework`) for irreversible-or-cross-org actions: `git push` to a new remote, merge to `main`, raising a spend cap, writing outside the track's worktree.
  - *Per-track capability grants* for first-use-per-tool inside a track; grant lives for the life of the track and revokes on track completion.
- Symlink-safe scope enforcement: `canonicalize()` + worktree-root prefix check + symlink rejection before every agent write.
- `claude` binary verification: `SecStaticCodeCheckValidity` against Anthropic's Developer ID before spawn; refuse to start if the signature does not match.
- Context manifest: whenever net-new context enters an agent turn (new file, changed `CLAUDE.md`, freshly merged doc), surface a diffable manifest to the user before the agent acts. Untrusted-lane content (unmerged PR, fork, non-user-authored commit) is tagged and requires an additional capability grant.
- Event schema records `(track_id, role, claude_session_id, tool_name)`; tool-call events are first-class, queryable, and immutable within a session.
- HMAC chain over events with session-sealed key; periodic anchor to a user-owned external artifact (git notes ref by default). Chain breaks surface as an attention-level alert.
- Secrets scanner on pre-write: curated strong-pattern matches (AWS keys, PEM blocks, GitHub tokens, Anthropic keys) block; high-entropy matches warn. Rulebook mirrors `gitleaks`, not our own heuristics.
- Secret-input mode in chat: dedicated composer affordance for pasted secrets; contents are session-only, redacted from the event store, and evicted from Claude's context after the agent's immediate reply.
- CSP `frame-ancestors 'self'`; helper IPC frame caps + fuzz harness; webview lockdown audit.

### Phase 16.S — Ship-posture supply chain (blocks signed DMG)

Everything required before the first signed `.dmg` leaves the build server.

- Blocking CI jobs: `cargo audit`, `cargo deny`, `cargo vet`, `npm audit --production`, `lockfile-lint`. A PR cannot merge with an open advisory.
- SBOM (CycloneDX) generated per release; attached to GitHub Release.
- SLSA v1.0 Level 3 provenance via ephemeral runners + `sigstore/cosign` attestation.
- Updater dual-key Ed25519: primary signing key + separate revocation key. Release key lives in an HSM (YubiKey Bio acceptable pre-scale). Documented rotation procedure, revocation path.
- Separate signing identity for the Foundation helper binary (defense in depth).
- Hardened runtime entitlements published in-repo; minimal surface — no camera, mic, location, AppleEvents, or accessibility unless justified in writing.
- `SECURITY.md`, `.well-known/security.txt`, PGP key, responsible-disclosure SLA (30-day triage, 90-day remediation target).
- Third-party pentest scheduled to land before the first signed DMG (~$30–60k, 4–8 weeks; scope = IPC surface, webview and frontend, approval gates, supply chain, updater, helper IPC). Subsequent cadence is annual + on every major-version release, not every release.
- Self-hosted CI runner hardening: ephemeral VM per job, egress allowlist, scoped short-lived GitHub tokens, quarterly rotation.

#### Supply-chain CI policy (audits-only scope; landed via `.github/workflows/supply-chain.yml`)

The blocking CI jobs above are sequenced. The first wave — `cargo audit`, `cargo deny`, CycloneDX SBOM, `npm audit --production`, `lockfile-lint` — landed as the audits-only gate; signing, SLSA L3 provenance, updater dual-key, and `cargo vet` calibration are deferred to follow-up 16.S/16.R work and do not gate this phase.

- **Severity gate.** HIGH/CRITICAL advisories block the PR; MEDIUM/LOW warn but do not block. `cargo audit` runs in JSON mode and a post-processing step partitions findings by `advisory.severity` (defaulting unscored CVEs to HIGH so an unscored gap does not silently pass). `npm audit --omit=dev --audit-level=high` enforces the same threshold for production npm deps; a follow-up `npm audit` step surfaces moderate/low findings as GitHub warnings without failing the gate. Dev-only vulnerabilities never ship to users and stay informational.
- **`cargo deny` scope.** The workspace `deny.toml` enforces licenses, banned sources, yanked crates, and external wildcard deps. License allowlist is exactly the set the dep tree resolves to today (recorded against the `aarch64-apple-darwin` / `x86_64-apple-darwin` macOS targets); broadening it requires a deliberate review. `unmaintained = "workspace"` means transitive unmaintained advisories (e.g. tauri's `unic-*` and `fxhash`) surface as warnings — fixing them requires upstream tauri to update — while a workspace-direct unmaintained dep would block.
- **SBOM cadence.** CycloneDX SBOMs are generated per PR and attached to the workflow run as an artifact, so reviewers can verify the dep set independent of `Cargo.lock`. Release-time SBOM signing and GitHub Release attachment land with the signing work in 16.R, not here.
- **Daily drift run.** A `cron: '17 7 * * *'` schedule re-runs every job against `main` to catch RUSTSEC advisories that land asynchronously of repo changes. If a previously-passing dep develops a new advisory (or any audit/lockfile job regresses), the workflow opens — or comments on — a tracking Issue titled `Supply-chain drift detected by daily CI` with run links and a per-job result table. Triage path: upgrade the offending dep, ignore-list with a citation comment in `deny.toml`, or accept the warning if it is below the HIGH/CRITICAL bar.
- **Exemption discipline.** Any advisory we choose not to fix lands in `deny.toml`'s `[advisories].ignore` (or `[bans]`) with a comment citing the RUSTSEC ID, the upstream crate path, and the rationale. Silent passes are never acceptable.

### Phase 17.T — Team-tier trust (blocks team pricing)

Everything required before Designer is pitched to teams with policy requirements.

- App-level AES-GCM on sensitive event fields (agent messages, tool outputs, captured file contents). Key is Keychain-sealed, device-only, `kSecAttrSynchronizable = false`. Workspace metadata stays unencrypted for queryability.
- Two-tier logging: default tier writes event envelopes (IDs, timestamps, costs, tool names, file paths) — no bodies. Bodies live in the encrypted event store and are purged on a rolling window the user controls. Support bundles are explicit, user-reviewed exports with diff preview.
- MDM / admin-signed managed-preferences policy at `/Library/Managed Preferences/com.designer.app.plist`. Admin-signed policies can pin scope rules, force-enable approval tiers, restrict tool allowlists, disable specific agents fleet-wide. Policy signature is verified against a compiled-in admin root.
- SIEM-ready audit-log export (JSON lines, CEF-compatible fields). Export is user-initiated with diff preview; never network.
- Narrowly-scoped GitHub App with per-workspace grants replacing ambient `gh` token reliance; revocable per-workspace.
- Inter-workspace HMAC domain separation (per-workspace keyed chains) so a compromised workspace cannot tamper with or read another's event state.
- Bug bounty program live (HackerOne or equivalent); VDP discoverable via `.well-known/security.txt`.
- Foundation helper data-deletion completeness: when a workspace is deleted, helper caches + model-session state go with it. Audit of where helper state lives, committed to this doc.
- SOC 2 Type I: reactive to named enterprise deals, scoped narrowly to the zero-data-collection posture. Not pursued preemptively.

### Phase 18 — Mobile sync (blocks mobile)

Security constraints for the mobile transport are spec-level, not implementation-discretionary.

- Noise_XX or Signal-style double ratchet over WebRTC data channel. Forward secrecy; post-compromise recovery.
- Device pairing by QR + short-authentication-string verification. TOFU with explicit out-of-band re-verify affordance.
- Relay is untrusted — ciphertext-only, no metadata persistence, selectable per session.

---

## Trust statement (plain-language, for users)

> Designer runs entirely on your Mac. Your code, your prompts, and your conversations with agents never leave your device unless you send them somewhere yourself. Designer does not have a backend server, does not collect telemetry, and does not hold your Claude credentials — Claude Code manages its own authentication, and Designer never touches it.
>
> We cryptographically verify the `claude` binary before spawning it, enforce what agents can write through a risk-tiered approval system, tamper-evidence every action in a signed event log, and encrypt sensitive data at rest with a key that never leaves your device. Updates are signed, opt-in, and never automatic.
>
> Every release is signed, carries cryptographic build-provenance you can verify, and is covered by a published third-party pentest (annual + on every major-version release). Our responsible-disclosure policy, PGP key, and remediation SLAs are at `/.well-known/security.txt`.

This statement is the public face of the invariants above. If any invariant is ever relaxed, this statement must be updated in the same PR.

---

## Incident response

1. **Reports** land via `security@<domain>` (PGP-encrypted, key in `.well-known/security.txt`). Triage within 30 days, remediation target 90 days for high-severity.
2. **Confirmed vulnerabilities** trigger a signed advisory on the repo, a patched release with updater priority flag, and — if the revocation key was used — a forced-update notification on next launch.
3. **Post-mortems** for any confirmed vulnerability land in `core-docs/history.md` with the root cause, the fix, and any spec or invariant change. No blameless-for-builder posture here — we publish what happened.
