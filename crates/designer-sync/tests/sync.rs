use designer_sync::{
    NodeId, OfflineQueue, PairingMaterial, SyncMessage, SyncSession, VectorClock,
    HANDSHAKE_VERSION,
};

#[test]
fn vector_clock_detects_concurrency() {
    let a = NodeId::new();
    let b = NodeId::new();
    let mut ca = VectorClock::new();
    let mut cb = VectorClock::new();
    ca.observe(a, 5);
    cb.observe(b, 3);
    assert!(!ca.dominates(&cb));
    assert!(!cb.dominates(&ca));
    assert!(ca.concurrent_with(&cb));
    ca.merge(&cb);
    assert!(ca.dominates(&cb));
}

#[test]
fn session_handshake_version_mismatch_errors() {
    let me = NodeId::new();
    let mut session = SyncSession::new(me, VectorClock::new());
    let err = session
        .handle(SyncMessage::Hello {
            version: HANDSHAKE_VERSION + 1,
            node: NodeId::new(),
        })
        .unwrap_err();
    assert!(matches!(err, designer_sync::SyncError::VersionMismatch(_, _)));
}

#[test]
fn session_handshake_roundtrip_welcomes_remote() {
    let me = NodeId::new();
    let them = NodeId::new();
    let mut session = SyncSession::new(me, VectorClock::new());
    let reply = session
        .handle(SyncMessage::Hello {
            version: HANDSHAKE_VERSION,
            node: them,
        })
        .unwrap();
    match reply {
        Some(SyncMessage::Welcome { node, .. }) => assert_eq!(node, me),
        other => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn offline_queue_drains_in_order() {
    let mut q = OfflineQueue::new();
    q.push(SyncMessage::Bye);
    q.push(SyncMessage::Ack { accepted: 5 });
    let drained = q.drain();
    assert_eq!(drained.len(), 2);
    assert!(matches!(drained[0].message, SyncMessage::Bye));
    assert!(matches!(drained[1].message, SyncMessage::Ack { .. }));
}

#[test]
fn pairing_code_deterministic_from_material() {
    let material = PairingMaterial { secret: [0x42; 32] };
    let code = material.code();
    assert_eq!(code.0.len(), 6);
    // Stable for same input.
    assert_eq!(code.0, material.code().0);
}
