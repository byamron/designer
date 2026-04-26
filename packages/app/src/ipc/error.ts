// Translate the Rust `IpcError` wire shape into user-facing copy. The Rust
// enum is defined as a tagged-union with a `kind` discriminator (see
// `crates/designer-ipc/src/lib.rs::IpcError`); each variant carries one
// payload field whose name varies by kind. The matching test on the Rust
// side (`ipc_error_serialization_shape_has_kind_tag`) locks the wire
// contract so this translator can match by `kind` without a typed re-derive.

export type IpcErrorPayload =
  | { kind: "unknown"; message: string }
  | { kind: "not_found"; id: string }
  | { kind: "invalid_request"; message: string }
  | { kind: "approval_required"; message: string }
  | { kind: "cost_cap_exceeded"; message: string }
  | { kind: "scope_denied"; path: string };

function isIpcErrorPayload(v: unknown): v is IpcErrorPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    typeof (v as { kind: unknown }).kind === "string"
  );
}

/// Convert an unknown thrown value (Tauri rejects with a serialized
/// `IpcError` JSON object; mock can throw `Error`s; bug surfaces can
/// throw strings) into a single user-facing string.
export function describeIpcError(err: unknown): string {
  if (typeof err === "string") return err.trim() || "Send failed. Try again.";
  if (isIpcErrorPayload(err)) {
    switch (err.kind) {
      case "cost_cap_exceeded":
        return `Cost cap reached. ${err.message}`.trim();
      case "scope_denied":
        return `Access denied: ${err.path}`;
      case "approval_required":
        return `Approval required: ${err.message}`;
      case "invalid_request":
        return err.message || "Invalid request.";
      case "not_found":
        return `Not found: ${err.id}`;
      case "unknown":
        return err.message || "Send failed. Try again.";
    }
  }
  if (err instanceof Error) return err.message || "Send failed. Try again.";
  return "Send failed. Try again.";
}
