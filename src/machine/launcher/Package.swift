// swift-tools-version:6.0
// jen-machine, the launcher that is jen's machine on a Mac. JenMachine holds
// what needs no VM, which `swift test` covers. jen-machine runs the VM.

import PackageDescription

let package = Package(
  name: "jen-machine",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "JenMachine"),
    .executableTarget(name: "jen-machine", dependencies: ["JenMachine"]),
    .testTarget(name: "JenMachineTests", dependencies: ["JenMachine"]),
  ],
  swiftLanguageModes: [.v5]
)
