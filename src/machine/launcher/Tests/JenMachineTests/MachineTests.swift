import Testing
@testable import JenMachine

@Suite struct Resources {
  @Test func a24GiBMacWith8Cores() {
    #expect(machineCPUs(macCores: 8) == 8)
    #expect(machineMemory(macMemory: 24 * gib) == 8 * gib)
  }

  @Test func halfASmallMacsMemory() {
    #expect(machineMemory(macMemory: 8 * gib) == 4 * gib)
    #expect(machineMemory(macMemory: 8 * gib + 3) == 4 * gib)
  }
}

@Suite struct Clock {
  @Test func sentAtTheNextWholeSecond() {
    let (delay, line) = clockMessage(now: 1_795_569_639.25)
    #expect(abs(delay - 0.75) < 1e-6)
    #expect(String(decoding: line, as: UTF8.self) == "1795569640\n")
  }

  @Test func onAWholeSecondWaitsForTheNext() {
    let (delay, line) = clockMessage(now: 1_795_569_639)
    #expect(delay == 1)
    #expect(String(decoding: line, as: UTF8.self) == "1795569640\n")
  }
}

@Suite struct Relays {
  @Test func thePortRelaysFirstLineIsThePort() {
    #expect(String(decoding: portLine(8081), as: UTF8.self) == "8081\n")
  }

  @Test func eachRelayHasItsOwnPort() {
    #expect(Set([Vsock.engine, Vsock.port, Vsock.clock, Vsock.stop]) == [2375, 2376, 2377, 2378])
  }
}
