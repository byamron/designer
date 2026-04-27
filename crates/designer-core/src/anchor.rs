//! Shared `Anchor` enum — locked by Track 13.K spec (`core-docs/roadmap.md`
//! § "Locked contracts"). Reused across Friction (13.K), inline comments
//! (15.H), and finding evidence (Phase 21). Mirror of the TypeScript shape in
//! `packages/app/src/lib/anchor.ts`.
//!
//! Resolution priority for `selector_path` on the `dom-element` variant:
//! `data-component` → `data-block-kind` → stable `data-id` /
//! `data-workspace-id` / `data-track-id` → structural CSS path. **Never
//! introduce a `data-friction-id` attribute** — reuse the existing
//! component-annotation surface.

use serde::{Deserialize, Serialize};

/// Where in the product a piece of evidence is anchored. Each variant carries
/// the minimum stable bytes a future replay needs to re-locate the surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Anchor {
    /// A span inside an existing `MessagePosted`/`ArtifactCreated` message.
    /// The `quote` is verbatim text so a stale `char_range` can be re-found
    /// by string search after the message edits.
    MessageSpan {
        message_id: String,
        quote: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        char_range: Option<(u32, u32)>,
    },
    /// A normalized point on a prototype canvas tab. `nx`/`ny` are 0..=1.
    PrototypePoint { tab_id: String, nx: f32, ny: f32 },
    /// A specific element within a prototype tab.
    PrototypeElement {
        tab_id: String,
        selector_path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text_snippet: Option<String>,
    },
    /// A DOM element inside Designer's UI itself. The variant Friction (13.K)
    /// uses. `route` is the active app route so a replay still knows what
    /// surface was visible.
    DomElement {
        selector_path: String,
        route: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        component: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stable_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text_snippet: Option<String>,
    },
    /// A specific tool-call event in the workspace stream.
    ToolCall { event_id: String, tool_name: String },
    /// A path inside the user's repo, optionally with a line range.
    FilePath {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        line_range: Option<(u32, u32)>,
    },
}

impl Anchor {
    /// User-facing descriptor used by Friction's title synthesis. Falls back
    /// to the route when no specific component or path is recorded.
    pub fn descriptor(&self) -> String {
        match self {
            Anchor::DomElement {
                component,
                route,
                stable_id,
                ..
            } => component
                .clone()
                .or_else(|| stable_id.clone())
                .unwrap_or_else(|| route.clone()),
            Anchor::MessageSpan { message_id, .. } => format!("message {}", message_id),
            Anchor::PrototypePoint { tab_id, nx, ny } => {
                format!("prototype {tab_id} @ {nx:.2},{ny:.2}")
            }
            Anchor::PrototypeElement { tab_id, .. } => format!("prototype {tab_id}"),
            Anchor::ToolCall { tool_name, .. } => format!("tool:{}", tool_name),
            Anchor::FilePath { path, line_range } => match line_range {
                Some((a, b)) => format!("{path}:{a}-{b}"),
                None => path.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each variant must round-trip through serde unchanged. If this breaks,
    /// every consumer that persisted Anchors in events must re-migrate.
    #[test]
    fn anchor_variants_round_trip_through_serde() {
        let cases = vec![
            Anchor::MessageSpan {
                message_id: "msg_1".into(),
                quote: "the cat sat".into(),
                char_range: Some((4, 7)),
            },
            Anchor::PrototypePoint {
                tab_id: "tab_1".into(),
                nx: 0.25,
                ny: 0.5,
            },
            Anchor::PrototypeElement {
                tab_id: "tab_1".into(),
                selector_path: "frame > button".into(),
                text_snippet: Some("Sign up".into()),
            },
            Anchor::DomElement {
                selector_path: "[data-component='WorkspaceSidebar']".into(),
                route: "/workspace/ws_1".into(),
                component: Some("WorkspaceSidebar".into()),
                stable_id: None,
                text_snippet: Some("Track A".into()),
            },
            Anchor::ToolCall {
                event_id: "evt_1".into(),
                tool_name: "Read".into(),
            },
            Anchor::FilePath {
                path: "src/lib.rs".into(),
                line_range: Some((10, 12)),
            },
        ];

        for a in cases {
            let json = serde_json::to_string(&a).expect("serialize");
            let back: Anchor = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(a, back, "mismatch for {json}");
        }
    }

    #[test]
    fn descriptor_prefers_component_then_stable_id_then_route() {
        let with_component = Anchor::DomElement {
            selector_path: "x".into(),
            route: "/r".into(),
            component: Some("WorkspaceSidebar".into()),
            stable_id: Some("ws_1".into()),
            text_snippet: None,
        };
        assert_eq!(with_component.descriptor(), "WorkspaceSidebar");

        let only_stable = Anchor::DomElement {
            selector_path: "x".into(),
            route: "/r".into(),
            component: None,
            stable_id: Some("ws_1".into()),
            text_snippet: None,
        };
        assert_eq!(only_stable.descriptor(), "ws_1");

        let only_route = Anchor::DomElement {
            selector_path: "x".into(),
            route: "/r".into(),
            component: None,
            stable_id: None,
            text_snippet: None,
        };
        assert_eq!(only_route.descriptor(), "/r");
    }

    /// Serialization tag uses kebab-case (matches the TypeScript shape's
    /// `kind: "dom-element"`). If we ever flip to snake_case the JS side
    /// breaks silently — pin the wire format with a fixture string.
    #[test]
    fn dom_element_serializes_with_kebab_case_tag() {
        let a = Anchor::DomElement {
            selector_path: "main".into(),
            route: "/r".into(),
            component: None,
            stable_id: None,
            text_snippet: None,
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v.get("kind").and_then(|k| k.as_str()), Some("dom-element"));
    }
}
