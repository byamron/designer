// swift-tools-version:5.9
// Swift Package describing the Designer Foundation-Models helper.
//
// The helper is a tiny stdio program that reads length-prefixed JSON requests
// from Rust and writes length-prefixed JSON responses. It wraps Apple
// Foundation Models (available on Apple Intelligence-capable Macs, macOS 15+).
// On hardware or macOS versions that do not expose Foundation Models, the
// Rust side's `NullHelper` takes over — the helper is optional.

import PackageDescription

let package = Package(
  name: "DesignerFoundationHelper",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "designer-foundation-helper", targets: ["DesignerFoundationHelper"])
  ],
  targets: [
    .executableTarget(
      name: "DesignerFoundationHelper",
      path: "Sources"
    )
  ]
)
