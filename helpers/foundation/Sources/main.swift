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

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct PingRequest: Decodable {}

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

func writeFrame(_ data: Data, to handle: FileHandle) {
  var len = UInt32(data.count).bigEndian
  var framed = Data(bytes: &len, count: 4)
  framed.append(data)
  try? handle.write(contentsOf: framed)
}

// MARK: - decode / dispatch

func decode(_ data: Data) -> Request? {
  struct Peek: Decodable { let kind: String }
  guard let peek = try? JSONDecoder().decode(Peek.self, from: data) else { return nil }
  switch peek.kind {
  case "ping": return .ping
  case "generate":
    guard let g = try? JSONDecoder().decode(GenerateRequest.self, from: data) else { return nil }
    return .generate(g)
  default: return nil
  }
}

// MARK: - generation

#if canImport(FoundationModels)
@available(macOS 15.0, *)
func generate(job: JobKind, prompt: String) async -> Response {
  // In a real build, call Foundation Models here. This block compiles against
  // Apple's public Foundation Models SDK (macOS 15+).
  let session = LanguageModelSession()
  do {
    let result = try await session.respond(to: prompt)
    return .text(result.content)
  } catch {
    return .error("\(error)")
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
    let stdin = FileHandle.standardInput
    let stdout = FileHandle.standardOutput

    while let body = readFrame(from: stdin) {
      guard let req = decode(body) else {
        let err = try! JSONEncoder().encode(Response.error("invalid-request"))
        writeFrame(err, to: stdout)
        continue
      }
      let resp: Response
      switch req {
      case .ping:
        resp = .pong(version: "0.1.0", model: "foundation-models")
      case .generate(let g):
        if #available(macOS 15.0, *) {
          resp = await generate(job: g.job, prompt: g.prompt)
        } else {
          resp = .error("macos-too-old")
        }
      }
      let out = try! JSONEncoder().encode(resp)
      writeFrame(out, to: stdout)
    }
  }
}
