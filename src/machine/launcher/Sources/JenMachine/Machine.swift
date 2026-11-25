// What jen fixes about its machine, and the small messages its relays take.

import Foundation

public let mib: UInt64 = 1 << 20
public let gib: UInt64 = 1 << 30

// The machine's virtual CPUs: every core the Mac has, since idle ones cost
// nothing.
public func machineCPUs(macCores: Int) -> Int { max(macCores, 1) }

// The machine's memory: half the Mac's, at most 8 GiB, in whole MiB as
// Virtualization.framework requires.
public func machineMemory(macMemory: UInt64) -> UInt64 { min(macMemory / 2, 8 * gib) / mib * mib }

// The data disk's size. It's sparse, so it takes only what's written to it.
public let dataDiskSize: UInt64 = 64 * gib

// The vsock ports the machine's relays listen on.
public enum Vsock {
  public static let engine: UInt32 = 2375
  public static let port: UInt32 = 2376
  public static let clock: UInt32 = 2377
  public static let stop: UInt32 = 2378
}

// The first line of a connection to vsock 2376, naming the port in the
// machine to carry it to.
public func portLine(_ port: UInt16) -> [UInt8] { Array("\(port)\n".utf8) }

// When to set the machine's clock and what to send: the next whole second, in
// how long until it, so a clock that takes whole seconds is set to within the
// relay's delay rather than up to a second behind.
public func clockMessage(now: TimeInterval) -> (delay: TimeInterval, line: [UInt8]) {
  let next = now.rounded(.down) + 1
  return (next - now, Array("\(Int64(next))\n".utf8))
}
