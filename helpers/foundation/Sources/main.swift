// Designer foundation helper.
//
// Protocol (mirrors `crates/designer-local-models/src/protocol.rs`):
//
//   Frame   := u32be length ++ JSON body
//   Request := {"kind":"ping"} | {"kind":"generate","job":"...", "prompt":"..."}
//   Response:= {"kind":"pong","version":"...","model":"..."}
//            | {"kind":"text","text":"..."}
//            | {"kind":"error","message":"..."}
//
// Foundation Models wiring is intentionally isolated in `generate(...)` so the
// rest of the file compiles against any macOS. When Foundation Models is not
// linkable at build time, the helper returns an "unavailable" error response,
// and the Rust side falls back to NullHelper — no crashes, no silent data
// masking.
//
// CLI surface:
//   designer-foundation-helper --version   → prints the semver line, exits 0.
//   designer-foundation-helper             → enters the framed-stdio loop.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

let HELPER_VERSION = "0.1.0"
let HELPER_MODEL = "foundation-models"

enum JobKind: String, Codable {
  case context_optimize, recap, audit_claim, summarize_row
}

struct GenerateRequest: Decodable {
  let job: JobKind
  let prompt: String
}

enum Request {
  case ping
  case generate(GenerateRequest)
}

enum Response: Encodable {
  case pong(version: String, model: String)
  case text(String)
  case error(String)

  enum CodingKeys: String, CodingKey { case kind, version, model, text, message }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .pong(let v, let m):
      try c.encode("pong", forKey: .kind)
      try c.encode(v, forKey: .version)
      try c.encode(m, forKey: .model)
    case .text(let t):
      try c.encode("text", forKey: .kind)
      try c.encode(t, forKey: .text)
    case .error(let msg):
      try c.encode("error", forKey: .kind)
      try c.encode(msg, forKey: .message)
    }
  }
}

// MARK: - framing

func readFrame(from handle: FileHandle) -> Data? {
  guard let lenBytes = try? handle.read(upToCount: 4), lenBytes.count == 4 else { return nil }
  let len = lenBytes.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
  guard let body = try? handle.read(upToCount: Int(len)), body.count == Int(len) else { return nil }
  return body
}

/// Writes a framed response. Returns `false` when stdout is closed (the Rust
/// side dropped us); the main loop uses that as its termination signal instead
/// of silently spinning.
func writeFrame(_ data: Data, to handle: FileHandle) -> Bool {
  var len = UInt32(data.count).bigEndian
  var framed = Data(bytes: &len, count: 4)
  framed.append(data)
  do {
    try handle.write(contentsOf: framed)
    return true
  } catch {
    return false
  }
}

// MARK: - decode / dispatch

/// Returns `nil` for unparseable frames, `.some(nil)` for a valid frame with an
/// unknown `kind`, and `.some(.some(request))` for recognized requests. The
/// double-Optional lets the caller distinguish "garbage" from "known shape,
/// unknown kind" and emit a structured error instead of hanging.
func decode(_ data: Data) -> Request?? {
  struct Peek: Decodable { let kind: String }
  guard let peek = try? JSONDecoder().decode(Peek.self, from: data) else { return nil }
  switch peek.kind {
  case "ping": return .some(.ping)
  case "generate":
    guard let g = try? JSONDecoder().decode(GenerateRequest.self, from: data) else { return nil }
    return .some(.generate(g))
  default: return .some(nil)
  }
}

/// Encode a response or produce a last-resort fallback error frame. Never
/// crashes — a failed encode produces `{"kind":"error","message":"encode-failed"}`
/// which the Rust side can surface as a `Reported` error rather than seeing a
/// silently closed stdout.
func encodeOrFallback(_ resp: Response) -> Data {
  if let bytes = try? JSONEncoder().encode(resp) {
    return bytes
  }
  // The only realistic way this path fires is if the text payload contains
  // invalid Unicode scalars. Send a fixed ASCII frame and let Rust decide.
  return Data(#"{"kind":"error","message":"encode-failed"}"#.utf8)
}

// MARK: - generation

#if canImport(FoundationModels)
@available(macOS 15.0, *)
func generate(job: JobKind, prompt: String) async -> Response {
  let session = LanguageModelSession()
  do {
    let result = try await session.respond(to: prompt)
    return .text(result.content)
  } catch {
    // `String(describing:)` is more informative than `localizedDescription`
    // (which is often empty for Foundation-Models errors) and doesn't leak
    // filesystem paths for the surfaces we've seen. Keep the `foundation-models-error:`
    // prefix so the Rust side can discriminate.
    return .error("foundation-models-error: \(String(describing: error))")
  }
}
#else
func generate(job: JobKind, prompt: String) async -> Response {
  return .error("foundation-models-unavailable")
}
#endif

// MARK: - main

@main
struct Helper {
  static func main() async {
    let args = CommandLine.arguments
    if args.count >= 2 && args[1] == "--version" {
      print("designer-foundation-helper \(HELPER_VERSION)")
      return
    }

    let stdin = FileHandle.standardInput
    let stdout = FileHandle.standardOutput

    while let body = readFrame(from: stdin) {
      let decoded = decode(body)
      let resp: Response
      switch decoded {
      case .none:
        resp = .error("invalid-request")
      case .some(.none):
        resp = .error("unknown-request")
      case .some(.some(.ping)):
        resp = .pong(version: HELPER_VERSION, model: HELPER_MODEL)
      case .some(.some(.generate(let g))):
        if #available(macOS 15.0, *) {
          resp = await generate(job: g.job, prompt: g.prompt)
        } else {
          resp = .error("macos-too-old")
        }
      }
      let out = encodeOrFallback(resp)
      if !writeFrame(out, to: stdout) {
        // Rust side closed stdout; stop reading further frames instead of
        // draining stdin into the void.
        break
      }
    }
  }
}
