//! Smoke test: parse this project's actual `core-docs/roadmap.md`.
//!
//! Asserts the parser doesn't choke on the live spec, every node has a
//! non-empty headline, and the parse stays under the 100 ms budget for the
//! current file size (~120 KB at last writing — comfortably above the
//! brief's 64 KB target).

use designer_core::roadmap::parse_roadmap;
use std::time::Instant;

#[test]
fn parses_real_roadmap_md_under_budget() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../core-docs/roadmap.md");
    let source = std::fs::read_to_string(&path).expect("read roadmap.md");

    let start = Instant::now();
    let (tree, assignments) = parse_roadmap(&source).expect("parse real roadmap");
    let elapsed = start.elapsed();

    println!(
        "roadmap.md: {} bytes, {} nodes, {} anchors-to-inject, parse {:?}",
        source.len(),
        tree.nodes().len(),
        assignments.len(),
        elapsed
    );

    assert!(
        !tree.nodes().is_empty(),
        "real roadmap should have at least one heading"
    );
    for node in tree.nodes() {
        assert!(
            !node.headline.is_empty(),
            "node {} has empty headline",
            node.id
        );
    }

    // 100ms budget at 64K source. Real file is bigger; allow proportional
    // budget plus margin for CI variance.
    let budget_ms = (source.len() as f64 / 64_000.0 * 100.0 + 50.0) as u128;
    assert!(
        elapsed.as_millis() < budget_ms,
        "parse {:?} exceeded budget {} ms",
        elapsed,
        budget_ms
    );
}
