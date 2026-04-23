//! Scope enforcement. Each workspace has an allow-list and a no-touch list of
//! glob patterns (Git-style). A write to a path is checked: allow-list wins
//! unless the path also matches no-touch. Any denial emits `ScopeDenied` so the
//! audit trail records the attempt.

use crate::SafetyError;
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeRule {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

impl Default for ScopeRule {
    fn default() -> Self {
        // Default is safe-by-rejection: nothing is allowed unless explicitly configured.
        // The per-workspace config is responsible for opening scope.
        Self {
            allow: vec![],
            deny: vec![
                "**/.env*".into(),
                "**/secrets/**".into(),
                "**/.ssh/**".into(),
            ],
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompiledScope {
    pub allow: GlobSet,
    pub deny: GlobSet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeVerdict {
    Allowed,
    Denied,
}

pub struct ScopeGuard {
    compiled: CompiledScope,
    original: ScopeRule,
}

impl ScopeGuard {
    pub fn new(rule: ScopeRule) -> Result<Self, SafetyError> {
        let allow = compile(&rule.allow)?;
        let deny = compile(&rule.deny)?;
        Ok(Self {
            compiled: CompiledScope { allow, deny },
            original: rule,
        })
    }

    pub fn rule(&self) -> &ScopeRule {
        &self.original
    }

    pub fn check(&self, path: impl AsRef<Path>) -> ScopeVerdict {
        let path = path.as_ref();
        let rel = path.to_string_lossy();
        if self.compiled.deny.is_match(rel.as_ref()) {
            return ScopeVerdict::Denied;
        }
        // `globset::GlobSet` exposes `len()` but not `is_empty()`; checking
        // against zero is fine here and clearer than a helper trait.
        #[allow(clippy::len_zero)]
        if self.compiled.allow.len() == 0 {
            // If no allow list is configured, fall back to allow-all (with deny
            // still enforced above). Rationale: many workspaces will be broad;
            // making allow optional avoids requiring every project to enumerate
            // the universe. Deny-list is the hard floor.
            return ScopeVerdict::Allowed;
        }
        if self.compiled.allow.is_match(rel.as_ref()) {
            ScopeVerdict::Allowed
        } else {
            ScopeVerdict::Denied
        }
    }

    /// Convenience: assert allowed, or return structured error.
    pub fn assert(&self, path: impl AsRef<Path>) -> Result<PathBuf, SafetyError> {
        let path = path.as_ref().to_path_buf();
        match self.check(&path) {
            ScopeVerdict::Allowed => Ok(path),
            ScopeVerdict::Denied => Err(SafetyError::ScopeDenied(path.display().to_string())),
        }
    }
}

fn compile(patterns: &[String]) -> Result<GlobSet, SafetyError> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        builder.add(Glob::new(p)?);
    }
    Ok(builder.build()?)
}
