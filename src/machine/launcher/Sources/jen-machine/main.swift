// jen-machine <machine folder> <system folder>
//
// Runs jen's machine inside this process, from the system folder's vmlinuz,
// initramfs and system.img, with its data disk and sockets in the machine
// folder. The machine runs exactly as long as this process does.

import Foundation
import JenMachine
import Virtualization

func say(_ line: String) { FileHandle.standardError.write(Data("jen-machine: \(line)\n".utf8)) }
func fail(_ line: String) -> Never {
  say(line)
  exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else { fail("usage: jen-machine <machine folder> <system folder>") }
let folder = URL(fileURLWithPath: arguments[1], isDirectory: true)
let system = URL(fileURLWithPath: arguments[2], isDirectory: true)
let engineSocket = folder.appendingPathComponent("engine.sock").path
let pidFile = folder.appendingPathComponent("launcher.pid")
signal(SIGPIPE, SIG_IGN)

final class Launcher: NSObject, VZVirtualMachineDelegate {
  let vm: VZVirtualMachine
  // Every vsock connection in use, kept so it stays open. Only the main queue
  // touches it.
  var connections: [ObjectIdentifier: VZVirtioSocketConnection] = [:]
  var stopping = false

  init(configuration: VZVirtualMachineConfiguration) {
    vm = VZVirtualMachine(configuration: configuration)
    super.init()
    vm.delegate = self
  }

  var vsock: VZVirtioSocketDevice { vm.socketDevices[0] as! VZVirtioSocketDevice }

  func start() {
    vm.start { result in
      if case .failure(let error) = result { self.exit(1, "the machine didn't start: \(error.localizedDescription)") }
      self.setClock { self.serveEngine() }
    }
  }

  // Opens a connection to a port in the machine, on the main queue.
  func connect(_ port: UInt32, _ done: @escaping (VZVirtioSocketConnection?) -> Void) {
    vsock.connect(toPort: port) { result in
      switch result {
      case .success(let connection):
        self.connections[ObjectIdentifier(connection)] = connection
        done(connection)
      case .failure:
        done(nil)
      }
    }
  }

  func release(_ connection: VZVirtioSocketConnection) {
    connection.close()
    connections[ObjectIdentifier(connection)] = nil
  }

  // Sets the machine's clock from the Mac's, retrying until its relay
  // answers, as it does early in the machine's boot, before its engine.
  func setClock(then: @escaping () -> Void) {
    let (delay, line) = clockMessage(now: Date().timeIntervalSince1970)
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      self.connect(Vsock.clock) { connection in
        guard let connection else {
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.setClock(then: then) }
          return
        }
        writeAll(connection.fileDescriptor, line)
        self.release(connection)
        then()
      }
    }
  }

  // Carries each connection to engine.sock to the machine's engine.
  func serveEngine() {
    let listener: Int32
    do { listener = try listenUnix(path: engineSocket) } catch { self.exit(1, "\(error)") }
    acceptLoop(listener) { client in
      DispatchQueue.main.async {
        self.connect(Vsock.engine) { connection in
          guard let connection else { close(client); return }
          splice(client, connection.fileDescriptor) {
            DispatchQueue.main.async {
              close(client)
              self.release(connection)
            }
          }
        }
      }
    }
  }

  // Asks the machine's Linux to shut down, and stops the VM outright if it
  // hasn't within 30 seconds. The kernel has no driver for the VM's power
  // button, so the request goes through vsock.
  func stop() {
    guard !stopping else { return }
    stopping = true
    connect(Vsock.stop) { connection in
      if let connection { self.release(connection) }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
      self.vm.stop { _ in self.exit(0, "the machine didn't shut down within 30 seconds, so it was stopped") }
    }
  }

  func exit(_ code: Int32, _ line: String? = nil) -> Never {
    if let line { say(line) }
    unlink(engineSocket)
    if (try? String(contentsOf: pidFile, encoding: .utf8)) == "\(getpid())\n" { try? FileManager.default.removeItem(at: pidFile) }
    Foundation.exit(code)
  }

  func guestDidStop(_ virtualMachine: VZVirtualMachine) { exit(0) }

  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    exit(1, "the machine stopped: \(error.localizedDescription)")
  }
}

func configuration() throws -> VZVirtualMachineConfiguration {
  let boot = VZLinuxBootLoader(kernelURL: system.appendingPathComponent("vmlinuz"))
  boot.initialRamdiskURL = system.appendingPathComponent("initramfs")
  boot.commandLine = "console=hvc0"

  let data = folder.appendingPathComponent("data.img")
  if !FileManager.default.fileExists(atPath: data.path) {
    guard FileManager.default.createFile(atPath: data.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
      throw SocketError("creating \(data.path)")
    }
    let handle = try FileHandle(forWritingTo: data)
    try handle.truncate(atOffset: dataDiskSize)
    try handle.close()
  }
  let systemDisk = try VZDiskImageStorageDeviceAttachment(url: system.appendingPathComponent("system.img"), readOnly: true)
  let dataDisk = try VZDiskImageStorageDeviceAttachment(url: data, readOnly: false, cachingMode: .automatic, synchronizationMode: .full)

  let log = folder.appendingPathComponent("console.log")
  FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600])
  let console = VZVirtioConsoleDeviceSerialPortConfiguration()
  console.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: try FileHandle(forWritingTo: log))

  let network = VZVirtioNetworkDeviceConfiguration()
  network.attachment = VZNATNetworkDeviceAttachment()

  let configuration = VZVirtualMachineConfiguration()
  configuration.bootLoader = boot
  configuration.cpuCount = min(max(machineCPUs(macCores: ProcessInfo.processInfo.processorCount), VZVirtualMachineConfiguration.minimumAllowedCPUCount), VZVirtualMachineConfiguration.maximumAllowedCPUCount)
  configuration.memorySize = min(max(machineMemory(macMemory: ProcessInfo.processInfo.physicalMemory), VZVirtualMachineConfiguration.minimumAllowedMemorySize), VZVirtualMachineConfiguration.maximumAllowedMemorySize)
  configuration.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: systemDisk), VZVirtioBlockDeviceConfiguration(attachment: dataDisk)]
  configuration.networkDevices = [network]
  configuration.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
  configuration.socketDevices = [VZVirtioSocketDeviceConfiguration()]
  configuration.serialPorts = [console]
  try configuration.validate()
  return configuration
}

do {
  try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  try "\(getpid())\n".write(to: pidFile, atomically: true, encoding: .utf8)
  let launcher = Launcher(configuration: try configuration())
  signal(SIGTERM, SIG_IGN)
  signal(SIGINT, SIG_IGN)
  var signals: [DispatchSourceSignal] = []
  for number in [SIGTERM, SIGINT] {
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { launcher.stop() }
    source.resume()
    signals.append(source)
  }
  launcher.start()
  withExtendedLifetime((launcher, signals)) { RunLoop.main.run() }
} catch {
  fail("\(error.localizedDescription)")
}
