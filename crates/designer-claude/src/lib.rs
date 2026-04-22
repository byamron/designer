//! Claude Code orchestration layer. Provides:
//!
//! * `Orchestrator` trait — the abstract interface the core uses.
//! * `MockOrchestrator` — deterministic implementation for tests / offline
//!   demo; fully wire-compatible so the Tauri layer can run against mocks.
//! * `ClaudeCodeOrchestrator` — spawns `claude` as a subprocess with
//!   `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, watches `~/.claude/teams/` and
//!   `~/.claude/tasks/`, translates file-system events to Designer events.
//!
//! Both implementations write exclusively through the `EventStore` — the core
//! never reads Claude's raw file formats. This satisfies spec decision #9
//! (orchestrator abstraction) without baking Claude's data shapes into the
//! domain.

mod claude_code;
mod mock;
mod orchestrator;
mod watcher;

pub use claude_code::{ClaudeCodeOrchestrator, ClaudeCodeOptions};
pub use mock::MockOrchestrator;
pub use orchestrator::{
    Orchestrator, OrchestratorError, OrchestratorEvent, OrchestratorResult, TaskAssignment,
    TeamSpec,
};
pub use watcher::{ClaudeFileWatcher, WatcherEvent};
