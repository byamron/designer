//! Designer CLI. Phase 2 completeness target: create a workspace, spawn a
//! team, assign a task, observe the full event timeline — all without the
//! frontend. This is the verification surface for the backend before Phase 8.
//!
//! `friction` subcommands let an agent (or you) read and triage friction
//! reports without the desktop app: `friction list` projects the same
//! `FrictionEntry`s the Settings → Activity → Friction page renders, and
//! `friction address|resolve|reopen` go through the same event vocabulary
//! as the in-app actions so the running app's projection updates on its
//! next refresh.

use designer_claude::{MockOrchestrator, Orchestrator, TaskAssignment, TeamSpec};
use designer_core::{
    Actor, EventPayload, EventStore, FrictionId, ProjectId, Projection, Projector,
    SqliteEventStore, StreamId, StreamOptions, TaskId, WorkspaceId,
};
use designer_ipc::{project_friction, FrictionEntry, FrictionState};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

/// Default to `warn` so machine-readable output (`friction list --json`)
/// isn't drowned in info-level boot logs on stderr. `RUST_LOG=info designer …`
/// still works for debugging.
fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();
}

/// Process-wide override for the data directory. Set once at startup from
/// the parsed `--data-dir` flag (or `$DESIGNER_DATA_DIR`); read by
/// `store_path()`. A `OnceLock` keeps the dependency one-way — subcommands
/// don't have to thread the path through every helper.
static DATA_DIR_OVERRIDE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (global, rest) = parse_global_flags(args)?;
    if let Some(dir) = global.data_dir {
        DATA_DIR_OVERRIDE
            .set(dir)
            .map_err(|_| anyhow::anyhow!("data dir override set twice"))?;
    }
    let cmd = rest.first().map(String::as_str).unwrap_or("demo");
    match cmd {
        "demo" => run_demo().await,
        "events" => dump_events().await,
        "friction" => run_friction(&rest[1..]).await,
        "version" => {
            println!("designer {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => {
            eprintln!("unknown command: {other}");
            print_help();
            std::process::exit(2);
        }
    }
}

#[derive(Debug, Default)]
struct GlobalFlags {
    data_dir: Option<PathBuf>,
}

/// Pull leading global flags out of argv. Stops at the first non-flag (the
/// subcommand). Subcommand flags are parsed separately by each subcommand
/// so the global parser doesn't need to know their shape.
fn parse_global_flags(args: Vec<String>) -> anyhow::Result<(GlobalFlags, Vec<String>)> {
    let mut flags = GlobalFlags::default();
    let mut iter = args.into_iter().peekable();
    while let Some(a) = iter.peek() {
        match a.as_str() {
            "--data-dir" => {
                iter.next();
                let v = iter
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("--data-dir requires a path"))?;
                flags.data_dir = Some(PathBuf::from(v));
            }
            s if s.starts_with("--data-dir=") => {
                let v = iter.next().unwrap();
                let path = v.split_once('=').map(|(_, p)| p).unwrap_or("");
                if path.is_empty() {
                    anyhow::bail!("--data-dir= requires a non-empty path");
                }
                flags.data_dir = Some(PathBuf::from(path));
            }
            _ => break,
        }
    }
    // `$DESIGNER_DATA_DIR` is the fallback when no flag is given. Mirrors
    // how `XDG_*` overrides are usually layered: explicit flag beats env
    // beats default.
    if flags.data_dir.is_none() {
        if let Ok(v) = std::env::var("DESIGNER_DATA_DIR") {
            if !v.is_empty() {
                flags.data_dir = Some(PathBuf::from(v));
            }
        }
    }
    Ok((flags, iter.collect()))
}

fn print_help() {
    eprintln!(
        "designer — local CLI for the Designer event store

USAGE:
    designer [--data-dir <path>] <command> [args]

GLOBAL FLAGS:
    --data-dir <path>
        Directory containing `events.db`. Overrides `$DESIGNER_DATA_DIR`
        and the default of `~/.designer/`.

COMMANDS:
    friction list [--state <open|addressed|resolved|all>] [--json]
        Project the friction event stream into a triage list. TSV by
        default (state, created_at, friction_id, anchor, title, path);
        --json emits the full FrictionEntry array for agent consumption.

    friction address <friction_id> [--pr <url>]
        Mark a friction record `Addressed`. Optional PR URL records the
        fix. The friction_id can be the full `frc_<uuid>` or the bare
        UUID — copy from `friction list`.

    friction resolve <friction_id>
        Mark a friction record `Resolved`. Use after merge has shipped
        and you've confirmed the fix.

    friction reopen <friction_id>
        Reopen a previously resolved (or addressed) record.

    events
        Dump the entire event store as JSON Lines.

    demo
        Run the Phase 2 onboarding demo (writes to the event store).

    version
        Print the CLI version."
    );
}

async fn store_path() -> PathBuf {
    if let Some(dir) = DATA_DIR_OVERRIDE.get() {
        return dir.join("events.db");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".designer").join("events.db")
}

async fn run_demo() -> anyhow::Result<()> {
    let store = Arc::new(SqliteEventStore::open(store_path().await)?);
    let orchestrator = Arc::new(MockOrchestrator::new(store.clone()));
    let projector = Projector::new();

    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();

    store
        .append(
            StreamId::Project(project_id),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Designer".into(),
                root_path: std::env::current_dir()?,
            },
        )
        .await?;

    store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "onboarding".into(),
                base_branch: "main".into(),
            },
        )
        .await?;

    orchestrator
        .spawn_team(TeamSpec {
            workspace_id,
            team_name: "onboarding".into(),
            lead_role: "team-lead".into(),
            teammates: vec!["design-reviewer".into(), "test-runner".into()],
            env: Default::default(),
            cwd: None,
            model: None,
        })
        .await?;

    orchestrator
        .assign_task(
            workspace_id,
            TaskAssignment {
                task_id: TaskId::new(),
                title: "Draft initial onboarding flow".into(),
                description: "Produce a plan and wireframes.".into(),
                assignee_role: Some("design-reviewer".into()),
            },
        )
        .await?;

    // Replay the store into the projector.
    let events = store.read_all(StreamOptions::default()).await?;
    projector.replay(&events);

    println!("\nProjects:");
    for p in projector.projects() {
        println!("  - {} @ {}", p.name, p.root_path.display());
    }
    println!("Workspaces:");
    for w in projector.workspaces_in(project_id) {
        println!("  - {} (base: {})", w.name, w.base_branch);
    }

    println!("\nTimeline:");
    for e in events
        .iter()
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .iter()
        .rev()
    {
        println!(
            "  [{}] {:?} — seq={} by {:?}",
            e.timestamp.unix_timestamp(),
            e.kind(),
            e.sequence,
            e.actor
        );
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(())
}

async fn dump_events() -> anyhow::Result<()> {
    let store = SqliteEventStore::open(store_path().await)?;
    let events = store.read_all(StreamOptions::default()).await?;
    for e in &events {
        let json = serde_json::to_string(e)?;
        println!("{json}");
    }
    Ok(())
}

// ---- friction subcommand ---------------------------------------------------

async fn run_friction(args: &[String]) -> anyhow::Result<()> {
    let sub = args.first().map(String::as_str).unwrap_or("");
    match sub {
        "list" => friction_list(&args[1..]).await,
        "address" => friction_transition(&args[1..], Transition::Address).await,
        "resolve" => friction_transition(&args[1..], Transition::Resolve).await,
        "reopen" => friction_transition(&args[1..], Transition::Reopen).await,
        "" => {
            eprintln!("friction: missing subcommand (list | address | resolve | reopen)");
            std::process::exit(2);
        }
        other => {
            eprintln!("friction: unknown subcommand `{other}`");
            std::process::exit(2);
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Transition {
    Address,
    Resolve,
    Reopen,
}

async fn friction_list(args: &[String]) -> anyhow::Result<()> {
    // Filter chips on the FE map to "open" / "addressed" / "resolved" /
    // "all"; mirror that vocabulary so users can paste either side.
    let mut filter: Option<FrictionState> = None;
    let mut as_json = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--state" => {
                let v = args.get(i + 1).ok_or_else(|| {
                    anyhow::anyhow!("--state requires a value (open|addressed|resolved|all)")
                })?;
                filter = parse_state_filter(v)?;
                i += 2;
            }
            "--json" => {
                as_json = true;
                i += 1;
            }
            other => anyhow::bail!("unknown flag: {other}"),
        }
    }

    let store = SqliteEventStore::open(store_path().await)?;
    let events = store.read_all(StreamOptions::default()).await?;
    let entries: Vec<FrictionEntry> = project_friction(events.iter())
        .into_iter()
        .filter(|e| filter.map_or(true, |s| e.state == s))
        .collect();

    if as_json {
        println!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(());
    }

    if entries.is_empty() {
        eprintln!("(no friction entries)");
        return Ok(());
    }
    for e in &entries {
        // TSV. Path last so a copy-paste of the line ends with the file
        // location — agents can `cat <line | awk '{print $NF}'`.
        println!(
            "{state}\t{created}\t{id}\t{anchor}\t{title}\t{path}",
            state = state_word(e.state),
            created = e.created_at,
            id = e.friction_id,
            anchor = e.anchor_descriptor,
            title = e.title,
            path = e.local_path.display(),
        );
    }
    Ok(())
}

fn state_word(s: FrictionState) -> &'static str {
    match s {
        FrictionState::Open => "open",
        FrictionState::Addressed => "addressed",
        FrictionState::Resolved => "resolved",
    }
}

fn parse_state_filter(s: &str) -> anyhow::Result<Option<FrictionState>> {
    match s {
        "all" => Ok(None),
        "open" => Ok(Some(FrictionState::Open)),
        "addressed" => Ok(Some(FrictionState::Addressed)),
        "resolved" => Ok(Some(FrictionState::Resolved)),
        other => anyhow::bail!(
            "invalid --state value `{other}` (expected: open, addressed, resolved, all)"
        ),
    }
}

async fn friction_transition(args: &[String], kind: Transition) -> anyhow::Result<()> {
    let id_arg = args
        .first()
        .ok_or_else(|| anyhow::anyhow!("missing <friction_id>"))?;
    let id = FrictionId::from_str(id_arg)
        .map_err(|e| anyhow::anyhow!("invalid friction_id `{id_arg}`: {e}"))?;
    let mut pr_url: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--pr" if matches!(kind, Transition::Address) => {
                pr_url = Some(
                    args.get(i + 1)
                        .ok_or_else(|| anyhow::anyhow!("--pr requires a URL"))?
                        .clone(),
                );
                i += 2;
            }
            other => anyhow::bail!("unknown flag: {other}"),
        }
    }

    let store = Arc::new(SqliteEventStore::open(store_path().await)?);

    // Locate the workspace_id the originating `FrictionReported` lived
    // in so the transition lands on the same stream. The desktop's IPC
    // path passes this in from the projected `FrictionEntry`; the CLI
    // has no in-memory projection so we rescan once. O(n) per call is
    // fine for a CLI invocation — see the contrast with the click
    // latency budget called out in `core_friction.rs`.
    let events = store.read_all(StreamOptions::default()).await?;
    let workspace_id = events.iter().find_map(|env| match &env.payload {
        EventPayload::FrictionReported {
            friction_id,
            workspace_id,
            ..
        } if *friction_id == id => Some(*workspace_id),
        _ => None,
    });
    let workspace_id = workspace_id
        .ok_or_else(|| anyhow::anyhow!("no FrictionReported found for id `{id_arg}`"))?;
    let stream = workspace_id
        .map(StreamId::Workspace)
        .unwrap_or(StreamId::System);

    let payload = match kind {
        Transition::Address => EventPayload::FrictionAddressed {
            friction_id: id,
            pr_url,
        },
        Transition::Resolve => EventPayload::FrictionResolved { friction_id: id },
        Transition::Reopen => EventPayload::FrictionReopened { friction_id: id },
    };

    store.append(stream, None, Actor::user(), payload).await?;
    let verb = match kind {
        Transition::Address => "addressed",
        Transition::Resolve => "resolved",
        Transition::Reopen => "reopened",
    };
    println!("{verb}: {id}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn parse_global_flags_returns_subcommand_when_no_flags() {
        let (g, rest) = parse_global_flags(argv(&["friction", "list"])).unwrap();
        assert!(g.data_dir.is_none());
        assert_eq!(rest, vec!["friction".to_string(), "list".into()]);
    }

    #[test]
    fn parse_global_flags_consumes_data_dir_space_form() {
        let (g, rest) =
            parse_global_flags(argv(&["--data-dir", "/tmp/x", "friction", "list"])).unwrap();
        assert_eq!(g.data_dir, Some(PathBuf::from("/tmp/x")));
        assert_eq!(rest, vec!["friction".to_string(), "list".into()]);
    }

    #[test]
    fn parse_global_flags_consumes_data_dir_equals_form() {
        let (g, rest) = parse_global_flags(argv(&["--data-dir=/tmp/y", "friction"])).unwrap();
        assert_eq!(g.data_dir, Some(PathBuf::from("/tmp/y")));
        assert_eq!(rest, vec!["friction".to_string()]);
    }

    #[test]
    fn parse_global_flags_rejects_data_dir_without_value() {
        let err = parse_global_flags(argv(&["--data-dir"])).unwrap_err();
        assert!(err.to_string().contains("--data-dir requires a path"));
    }

    #[test]
    fn parse_global_flags_rejects_empty_equals_value() {
        let err = parse_global_flags(argv(&["--data-dir="])).unwrap_err();
        assert!(err.to_string().contains("non-empty path"));
    }
}
