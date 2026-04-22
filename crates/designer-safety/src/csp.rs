//! Strict Content-Security-Policy builder for HTML previews rendered in the
//! sandboxed iframe. The generated CSP:
//!
//! * denies all resources by default (`default-src 'none'`),
//! * allows inline-only styles (so Tailwind-style design tokens work),
//! * denies *all* scripts, connects, frames, workers,
//! * requires `sandbox allow-forms allow-pointer-lock` on the iframe itself.
//!
//! Agents can produce hostile HTML. We never run it in a trust context.

use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CspDirective {
    DefaultSrc,
    ScriptSrc,
    StyleSrc,
    ImgSrc,
    ConnectSrc,
    FontSrc,
    FrameSrc,
    FrameAncestors,
    ObjectSrc,
    BaseUri,
    FormAction,
    WorkerSrc,
}

impl fmt::Display for CspDirective {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            CspDirective::DefaultSrc => "default-src",
            CspDirective::ScriptSrc => "script-src",
            CspDirective::StyleSrc => "style-src",
            CspDirective::ImgSrc => "img-src",
            CspDirective::ConnectSrc => "connect-src",
            CspDirective::FontSrc => "font-src",
            CspDirective::FrameSrc => "frame-src",
            CspDirective::FrameAncestors => "frame-ancestors",
            CspDirective::ObjectSrc => "object-src",
            CspDirective::BaseUri => "base-uri",
            CspDirective::FormAction => "form-action",
            CspDirective::WorkerSrc => "worker-src",
        };
        f.write_str(s)
    }
}

pub struct CspBuilder {
    rules: BTreeMap<CspDirective, Vec<String>>,
}

impl Default for CspBuilder {
    fn default() -> Self {
        Self::strict()
    }
}

impl CspBuilder {
    /// Maximally restrictive baseline.
    pub fn strict() -> Self {
        let mut rules: BTreeMap<CspDirective, Vec<String>> = BTreeMap::new();
        rules.insert(CspDirective::DefaultSrc, vec!["'none'".into()]);
        rules.insert(CspDirective::ScriptSrc, vec!["'none'".into()]);
        rules.insert(
            CspDirective::StyleSrc,
            vec!["'self'".into(), "'unsafe-inline'".into()],
        );
        rules.insert(CspDirective::ImgSrc, vec!["'self'".into(), "data:".into()]);
        rules.insert(CspDirective::ConnectSrc, vec!["'none'".into()]);
        rules.insert(CspDirective::FontSrc, vec!["'self'".into(), "data:".into()]);
        rules.insert(CspDirective::FrameSrc, vec!["'none'".into()]);
        rules.insert(CspDirective::FrameAncestors, vec!["'self'".into()]);
        rules.insert(CspDirective::ObjectSrc, vec!["'none'".into()]);
        rules.insert(CspDirective::BaseUri, vec!["'none'".into()]);
        rules.insert(CspDirective::FormAction, vec!["'none'".into()]);
        rules.insert(CspDirective::WorkerSrc, vec!["'none'".into()]);
        Self { rules }
    }

    pub fn allow(mut self, directive: CspDirective, source: impl Into<String>) -> Self {
        self.rules.entry(directive).or_default().push(source.into());
        self
    }

    pub fn build(&self) -> String {
        self.rules
            .iter()
            .map(|(d, sources)| format!("{} {}", d, sources.join(" ")))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

/// Iframe `sandbox=` attribute. Minimum-viable for a prototype preview:
/// allow forms so clickable prototypes work; nothing else.
pub const SANDBOX_ATTRIBUTE: &str = "allow-forms allow-pointer-lock";
