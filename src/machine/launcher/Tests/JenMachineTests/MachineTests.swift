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
