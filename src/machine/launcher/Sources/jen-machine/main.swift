// jen-machine <machine folder> <system folder>
//
// Runs jen's machine inside this process, from the system folder's vmlinuz,
// initramfs, system.img and version, with its files in the machine folder:
//
//   data.img      the data disk, sparse, created on the first start
//   engine.sock   the machine's engine, which only this user can open
//   launcher.pid  this process, locked while it runs
//   version       the system it booted
//   console.log   the machine's console and this process's own messages
//
// The machine runs exactly as long as this process does. It mirrors every
// port the machine's containers publish on 127.0.0.1 onto the Mac's
// 127.0.0.1, sets the machine's clock at boot and whenever the Mac wakes, and
// on SIGTERM asks the machine to shut down, stopping it outright after 30
// seconds.

import Foundation
import IOKit.pwr_mgt
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
let pidFile = folder.appendingPathComponent("launcher.pid").path
signal(SIGPIPE, SIG_IGN)

final class Launcher: NSObject, VZVirtualMachineDelegate {
  let vm: VZVirtualMachine
  // Every vsock connection in use, kept so it stays open. Only the main queue
  // touches it, as it does everything here but carrying bytes.
  var connections: [ObjectIdentifier: VZVirtioSocketConnection] = [:]
  var engine: Listener?
  var mirror: PortMirror!
  var listing = false
  var listAgain = false
  var stopping = false
  // Published ports the Mac couldn't listen on, already logged, whether a
  // retry is waiting, and how long the next one waits.
  var unmirrored: Set<UInt16> = []
  var retrying = false
  var retryDelay = 2.0

  init(configuration: VZVirtualMachineConfiguration) {
    vm = VZVirtualMachine(configuration: configuration)
    super.init()
    vm.delegate = self
    mirror = PortMirror { port in
      do {
        let listener = Listener(try listenLoopback(port: port), queue: .main) { client in
          self.carry(client, to: Vsock.port, first: portLine(port))
        }
        self.unmirrored.remove(port)
        return listener
      } catch {
        if self.unmirrored.insert(port).inserted { say("can't mirror the machine's port \(port), trying again: \(error)") }
        return nil
      }
    }
  }

  var vsock: VZVirtioSocketDevice { vm.socketDevices[0] as! VZVirtioSocketDevice }

  func start() {
    vm.start { result in
      if case .failure(let error) = result { self.exit(1, "the machine didn't start: \(error.localizedDescription)") }
      self.setClock(onFailure: { self.stop() }) {
        self.serveEngine()
        self.followEvents()
      }
    }
  }

  // Opens a connection to a port in the machine. done runs on a later turn of
  // the main queue: Virtualization.framework crashes when a connection is
  // closed, or another opened, from within its own completion handler.
  func connect(_ port: UInt32, _ done: @escaping (VZVirtioSocketConnection?) -> Void) {
    vsock.connect(toPort: port) { result in
      switch result {
      case .success(let connection):
        self.connections[ObjectIdentifier(connection)] = connection
        DispatchQueue.main.async { done(connection) }
      case .failure:
        DispatchQueue.main.async { done(nil) }
      }
    }
  }

  func release(_ connection: VZVirtioSocketConnection) {
    connection.close()
    connections[ObjectIdentifier(connection)] = nil
  }

  // Carries a connection from the Mac to a port in the machine, sending first
  // ahead of the client's bytes.
  func carry(_ client: Int32, to port: UInt32, first: [UInt8] = []) {
    connect(port) { connection in
      guard let connection, first.isEmpty || writeAll(connection.fileDescriptor, first) else {
        if let connection { self.release(connection) }
        close(client)
        return
      }
      splice(client, connection.fileDescriptor) {
        DispatchQueue.main.async {
          close(client)
          self.release(connection)
        }
      }
    }
  }

  // Sends request to the machine's engine on a thread of its own, handing
  // each piece of the response to read until it answers false or the engine
  // closes the connection, then calls done on the main queue.
  func ask(_ request: [UInt8], read: @escaping ([UInt8]) -> Bool, done: @escaping () -> Void) {
    connect(Vsock.engine) { connection in
      guard let connection else { return done() }
      Thread.detachNewThread {
        let fd = connection.fileDescriptor
        if writeAll(fd, request) {
          var buffer = [UInt8](repeating: 0, count: 64 * 1024)
          while true {
            let n = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if n < 0 && errno == EINTR { continue }
            if n <= 0 || !read(Array(buffer[0..<n])) { break }
          }
        }
        DispatchQueue.main.async {
          self.release(connection)
          done()
        }
      }
    }
  }

  // Sets the machine's clock from the Mac's, retrying for a minute until its
  // relay answers, as it does early in the machine's boot, before its engine.
  func setClock(attempts: Int = 600, onFailure: @escaping () -> Void = {}, then: @escaping () -> Void = {}) {
    connect(Vsock.clock) { connection in
      guard let connection else {
        guard attempts > 1 else {
          say("the machine's clock relay didn't answer")
          return onFailure()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.setClock(attempts: attempts - 1, onFailure: onFailure, then: then) }
        return
      }
      let (delay, line) = clockMessage(now: Date().timeIntervalSince1970)
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        writeAll(connection.fileDescriptor, line)
        self.release(connection)
        then()
      }
    }
  }

  // Carries each connection to engine.sock to the machine's engine.
  func serveEngine() {
    do {
      engine = Listener(try listenUnix(path: engineSocket), queue: .main) { client in self.carry(client, to: Vsock.engine) }
    } catch {
      say("\(error)")
      stop()
    }
  }

  // Follows the engine's container events for as long as the machine runs,
  // listing the ports again on each, and following again a second after the
  // stream ends, as when the engine restarts.
  func followEvents() {
    let follower = EventFollower { DispatchQueue.main.async { self.listPorts() } }
    ask(EngineRequest.events, read: { follower.feed($0); return true }) {
      guard !self.stopping else { return }
      self.listPorts()
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.followEvents() }
    }
  }

  // Lists the running containers and mirrors the ports they publish on
  // 127.0.0.1, one listing at a time, listing again when asked meanwhile. A
  // listing that fails leaves the mirror as it was.
  func listPorts() {
    guard !listing else { return listAgain = true }
    listing = true
    let decoder = HTTPDecoder()
    var body: [UInt8] = []
    ask(EngineRequest.containers, read: { piece in
      body += decoder.feed(piece)
      return !decoder.finished
    }) {
      if decoder.status == 200 {
        self.mirror.reconcile(loopbackPorts(body))
        self.unmirrored.formIntersection(self.mirror.missing)
        self.retryDelay = 2
      }
      self.retryMissing()
      self.listing = false
      if self.listAgain {
        self.listAgain = false
        self.listPorts()
      }
    }
  }

  // Tries again to listen on the published ports the Mac couldn't, as when a
  // Mac program held one and has since let it go: after 2 seconds, then less
  // often, down to every 30 seconds, since each try connects to that program.
  func retryMissing() {
    guard !retrying, !stopping, !mirror.missing.isEmpty else { return }
    retrying = true
    DispatchQueue.main.asyncAfter(deadline: .now() + retryDelay) {
      self.retrying = false
      self.retryDelay = min(self.retryDelay * 2, 30)
      self.mirror.retry()
      self.unmirrored.formIntersection(self.mirror.missing)
      self.retryMissing()
    }
  }

  // Asks the machine's Linux to shut down, and stops the VM outright if it
  // hasn't within 30 seconds. The kernel has no driver for the VM's power
  // button, so the request goes through vsock.
  func stop() {
    guard !stopping else { return }
    stopping = true
    guard vm.state == .running else { exit(0) }
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
    unlink(pidFile)
    Foundation.exit(code)
  }

  func guestDidStop(_ virtualMachine: VZVirtualMachine) { exit(0) }

  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    exit(1, "the machine stopped: \(error.localizedDescription)")
  }
}

func configuration(console: FileHandle) throws -> VZVirtualMachineConfiguration {
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

  let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
  serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: console)

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
  configuration.serialPorts = [serial]
  try configuration.validate()
  return configuration
}

// IOKit's messages about the Mac's sleep, which Swift doesn't import from
// their macros.
let canSystemSleep: UInt32 = 0xe000_0270
let systemWillSleep: UInt32 = 0xe000_0280
let systemHasPoweredOn: UInt32 = 0xe000_0300
var power: io_connect_t = 0

// Sets the machine's clock each time the Mac wakes, letting the Mac sleep
// whenever it wants to.
func followWake(_ launcher: Launcher) {
  var port: IONotificationPortRef?
  var notifier: io_object_t = 0
  power = IORegisterForSystemPower(Unmanaged.passUnretained(launcher).toOpaque(), &port, { refcon, _, message, argument in
    switch message {
    case canSystemSleep, systemWillSleep:
      IOAllowPowerChange(power, Int(bitPattern: argument))
    case systemHasPoweredOn:
      Unmanaged<Launcher>.fromOpaque(refcon!).takeUnretainedValue().setClock()
    default:
      break
    }
  }, &notifier)
  guard power != 0, let port else { return say("can't follow the Mac's sleep, so the machine's clock is set only at boot") }
  CFRunLoopAddSource(CFRunLoopGetMain(), IONotificationPortGetRunLoopSource(port).takeUnretainedValue(), .defaultMode)
}

do {
  try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  // launcher.pid is locked for as long as this process runs, so a second
  // launcher never runs the same machine.
  let pid = open(pidFile, O_CREAT | O_WRONLY | O_EXLOCK | O_NONBLOCK, 0o644)
  if pid < 0 { fail(errno == EWOULDBLOCK ? "another jen-machine is running \(folder.path)" : "\(SocketError("opening \(pidFile)"))") }
  ftruncate(pid, 0)
  writeAll(pid, Array("\(getpid())\n".utf8))
  // Both the console and this process append to console.log, which starts
  // empty at each boot.
  let console = open(folder.appendingPathComponent("console.log").path, O_CREAT | O_WRONLY | O_TRUNC | O_APPEND, 0o600)
  if console < 0 { fail("\(SocketError("opening console.log"))") }
  dup2(console, STDERR_FILENO)
  let launcher = Launcher(configuration: try configuration(console: FileHandle(fileDescriptor: console)))
  // The system this machine boots, which jen compares with the one it holds.
  try Data(contentsOf: system.appendingPathComponent("version")).write(to: folder.appendingPathComponent("version"))
  signal(SIGTERM, SIG_IGN)
  signal(SIGINT, SIG_IGN)
  var signals: [DispatchSourceSignal] = []
  for number in [SIGTERM, SIGINT] {
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { launcher.stop() }
    source.resume()
    signals.append(source)
  }
  followWake(launcher)
  launcher.start()
  withExtendedLifetime((launcher, signals, pid)) { RunLoop.main.run() }
} catch {
  fail("\(error.localizedDescription)")
}
