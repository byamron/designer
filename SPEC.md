# Product Spec: Local-First Product/Design/Engineering App Powered by Installed Claude Code

## Overview

This product is a local-first macOS application for end-to-end product work: ideation, specification writing, diagramming, wireframing, prototyping, and engineering execution inside a GitHub-connected codebase.[1][2] The app is intended to function as a high-level orchestration and workspace layer over a user's existing local installation of Claude Code, rather than as a third-party hosted AI product or an SDK-based agent platform.[3][2]

The central product decision is to follow the model implied by Conductor's documentation: the user installs the app locally, separately installs and authenticates Claude Code, and the app uses that already-authenticated local Claude Code environment to power agentic workflows in isolated workspaces and worktrees.[1][4][2] This direction is chosen specifically to minimize dependence on Anthropic API billing and to stay aligned with Anthropic's published third-party restrictions around login, branding, and subscription-backed access in external products.[3]

## Product Goal

The goal is to give a solo builder or small team one place to do the full loop of product development without splitting work across chat tools, design tools, and engineering tools. The app should allow a user to think through ideas with AI, turn them into structured specs, generate and revise diagrams and low-fidelity wireframes, and then launch implementation work in a local repo using Claude Code sessions tied to GitHub and isolated git worktrees.

The product is not trying to replace GitHub or Claude Code.[5][2] GitHub remains the system of record for source control and collaboration, while Claude Code remains the AI execution runtime; the new app owns orchestration, artifact management, visual workflow, and user experience above those layers.[5][6][2]

## Policy and Compliance Context

Anthropic's Agent SDK documentation states that, unless previously approved, third-party developers may not offer `claude.ai` login or Anthropic subscription rate limits inside their own products, and SDK-based products should use API-key authentication instead.[3] The same documentation also states that third-party products must maintain their own branding and should not present themselves as Claude Code or use Claude Code branding for partner products.[3]

This creates a clear constraint for the product direction: the app should not be built as a customer-facing Agent SDK product that consumes a user's Claude subscription directly inside the app.[3] Instead, the app should behave as a local orchestrator over tools the user already installed and authenticated independently, which is the same basic setup Conductor documents for Claude Code usage.[1][4][2]

## Strategic Direction

The product should be built as a **local desktop harness around installed Claude Code**, not as a hosted AI service and not as a direct Agent SDK client.[3][2] The user should authenticate Claude Code outside the app using Claude Code's normal login flow, and the app should only verify local availability and local auth state before starting Claude-powered sessions.[1][7]

This direction is the most credible path toward two objectives at once: using an existing Claude Code subscription-backed login rather than API credits, and staying as clearly as possible within Anthropic's current third-party rules as written.[3][2] It also matches Conductor's documented UX, where the product relies on the user's local Claude Code login and existing tokens on the machine.[4][2]

## Product Principles

### Local-first

All core execution should happen on the user's machine.[1][2] The app can store project metadata locally, create worktrees locally, invoke local Claude Code sessions, and read or render locally generated artifacts such as Markdown specs, Mermaid diagrams, SVG wireframes, and HTML prototypes.[6][2]

### Claude Code as runtime, not dependency abstraction

Claude Code should be treated as the execution runtime for reasoning and code generation tasks, not as a hidden backend the app proxies through its own service layer.[5][6] The app should not impersonate Claude Code or bundle a substitute runtime; it should coordinate the actual installed tool the user already uses.[3][2]

### GitHub as source of truth

GitHub should remain the canonical system for repositories, branches, pull requests, and collaboration state.[5][1] The app can assist with branch/worktree creation, diffs, status, and PR flows, but code artifacts should still live in the repo and review should remain GitHub-compatible.[5][2]

### One workspace for all product work

The app should unify upstream product artifacts with downstream implementation artifacts: ideas, specs, diagrams, wireframes, prototypes, tasks, agent sessions, diffs, and PRs should all sit inside one project workspace. The value proposition is that the app owns the workflow, while Claude Code and GitHub remain interoperable external pillars.[5]

## Authentication and Runtime Model

### Supported model

The supported and preferred model is:

1. The user installs Claude Code independently.[1]
2. The user authenticates Claude Code independently through its own login flow, such as `claude /login`.[1][7]
3. The app checks local Claude Code availability and auth status before enabling AI-powered workflows.[1][2]
4. The app launches Claude Code locally in the relevant repository or git worktree and streams or captures its output for presentation in the app UI.[2]

This model most closely follows Conductor's documented installation and provider guidance, including the statement that Conductor runs using the user's local Claude Code login and can use local Pro or Max-backed auth tokens when present.[4][2]

### Unsupported or avoided model

The app should explicitly avoid the following:

- In-app Claude.ai sign-in UI.[3]
- Agent SDK as the primary user-facing runtime for subscription-backed access.[3]
- Routing user prompts through an app-controlled backend that uses Anthropic subscription limits on the user's behalf.[3]
- Framing the app as an Anthropic product or as Claude Code itself.[3]

These patterns are higher risk because they move the app from "local harness over user-installed Claude Code" into "third-party product offering Anthropic access," which is the exact zone Anthropic's documentation restricts unless approved.[3]

## User Experience Model

The app should feel like a polished workspace similar in spirit to Conductor, but broadened beyond engineering execution into product and design work.[8][2] The terminal remains a core primitive, because native Claude Code interaction is terminal-based, but the app layers richer product surfaces on top of that runtime.[2][9]

Primary surfaces should include:

- **Idea view** for conversational ideation and decision capture.
- **Spec view** for structured PRDs, feature specs, requirements, edge cases, and acceptance criteria.
- **Diagram view** for Mermaid flows, state diagrams, architecture maps, and task graphs generated locally by Claude Code.[10][11]
- **Wireframe/prototype view** for low-fidelity SVG wireframes and HTML/CSS prototypes generated locally and rendered directly in the app.[12][13][14]
- **Build view** for task decomposition, worktree creation, Claude Code sessions, diffs, checkpoints, and GitHub handoff.[2][15][16]

## Functional Requirements

### Ideas and specs

The app must allow the user to capture unstructured thinking and progressively formalize it into reusable artifacts. It should support conversion from exploratory notes into structured feature specifications with sections for goals, users, flows, states, constraints, edge cases, and acceptance criteria.

### Diagrams and visual artifacts

The app should not depend on a third-party design SaaS for the visual layer.[12][17] Instead, it should use Claude Code to generate renderable local artifacts such as Mermaid for flows and SVG or HTML for low-fidelity wireframes and prototypes, then display those artifacts in native views inside the app.[10][11][13][14]

### Engineering orchestration

The app should create and manage git worktrees for parallel implementation work, launch local Claude Code sessions within those worktrees, and expose progress, checkpoints, logs, diffs, and merge/discard actions in a more structured UI than the terminal alone.[2][15][16] This is the core behavior already demonstrated by Conductor's documented model and is the closest precedent for the intended runtime architecture.[1][2]

### GitHub integration

The app should connect to GitHub for repository selection, PR creation, review links, and status tracking, but should not attempt to replace GitHub as the primary code collaboration layer.[5][1] GitHub should remain the canonical store for code and collaboration history.[5]

## Non-Goals

The product is not intended to:

- Replace Claude Code with a custom model runtime.[3][2]
- Offer Anthropic login or subscription-backed usage directly inside the app.[3]
- Depend primarily on Anthropic API credits as the default business or technical model.[3]
- Recreate Figma-level vector design tooling.[17]
- Act as a hosted multi-tenant cloud agent service.[3]

## Risk Assessment

### Low-risk patterns

- Local detection of installed Claude Code.[1]
- User-managed Claude Code authentication via the standard Claude Code login flow.[1][7]
- Local orchestration of Claude Code sessions in user-owned repos and worktrees.[4][2]
- GitHub integration for repo and PR workflows.[5][1]

### Medium-risk patterns

- Deep mirroring of Claude Code UX if branding or presentation becomes too similar to an Anthropic-native surface.[3]
- Automations that feel like the app itself is the AI service rather than a local shell over Claude Code.[3][2]

### High-risk patterns

- In-app Claude.ai login or subscription authentication.[3]
- Agent SDK-based product that depends on user subscription access instead of API keys.[3]
- Marketing the app as Claude Code or implying official Anthropic affiliation.[3]
- Proxying Claude usage through an app-controlled cloud service on behalf of users.[3]

## Compliance Recommendations

To keep the product as clearly aligned with Anthropic's published rules as possible, the app should:

- Require users to install Claude Code separately and log in through its official flow.[1][7]
- Use wording such as "Works with your installed Claude Code" rather than language implying bundled Claude access.[3]
- Maintain distinct branding, onboarding, and product identity.[3]
- Keep execution local whenever possible.[2]
- Avoid building the product around the Agent SDK unless the billing model is explicitly API-based or prior approval is obtained.[3]

If the product is commercialized, written confirmation from Anthropic should still be sought to validate that a Conductor-style local harness over installed Claude Code is acceptable for the exact implementation and go-to-market model.[3]

## MVP Definition

A credible MVP should include:

- Local project creation and GitHub repo connection.[1]
- Detection of installed Claude Code and local auth state.[1][7]
- Idea capture and structured spec editing.
- Claude Code-driven generation of Mermaid diagrams and SVG/HTML low-fidelity design artifacts.[10][13][14]
- Git worktree management for parallel tasks.[2][15]
- Embedded terminal/session views for Claude Code runs.[2]
- Diff review, checkpoint browsing, and GitHub PR handoff.[5][16]

That MVP would already prove the product thesis: one local app for product, design, and engineering work, powered by installed Claude Code and grounded in GitHub.[5]

## Open Questions

Several questions should be resolved before launch:

- Whether Anthropic will explicitly confirm that a Conductor-like local wrapper model is permitted for a third-party commercial app.[3]
- How closely the app can mirror Claude Code interaction patterns before branding or presentation becomes problematic.[3]
- How to persist session context and artifacts while preserving the mental model that Claude Code remains the underlying runtime.[6][2]
- Whether additional Claude-native surfaces beyond Claude Code should be excluded entirely to keep the product clearly inside policy boundaries.[7][18]

## Summary Direction

The recommended path is to build a local-first macOS app that follows the Conductor model: GitHub-connected, worktree-based, and powered by the user's installed and independently authenticated Claude Code environment.[1][4][2] The app should avoid the Agent SDK for its core user-facing runtime, avoid in-app Claude login, and position itself as a workspace and orchestration layer over Claude Code rather than as a third-party Claude client.[3]
