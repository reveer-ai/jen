// The Mac's side of the machine's relays: listening sockets, and carrying a
// connection's bytes both ways between two file descriptors.

import Foundation

public struct SocketError: Error, CustomStringConvertible {
  public let description: String
  public init(_ what: String) { description = "\(what): \(String(cString: strerror(errno)))" }
}

// Listens on a Unix socket at path that only this user can open: the socket
// is created under a umask that leaves no one else any access.
public func listenUnix(path: String) throws -> Int32 {
  unlink(path)
  let fd = socket(AF_UNIX, SOCK_STREAM, 0)
  guard fd >= 0 else { throw SocketError("socket") }
  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  let bytes = Array(path.utf8)
  guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
    close(fd)
    throw SocketError("\(path) is too long for a socket's path")
  }
  withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes + [0]) }
  let mask = umask(0o077)
  let bound = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
  }
  umask(mask)
  guard bound == 0, listen(fd, 64) == 0 else {
    let error = SocketError("listening on \(path)")
    close(fd)
    throw error
  }
  return fd
}

// Listens on 127.0.0.1:port, and nowhere else.
public func listenLoopback(port: UInt16) throws -> Int32 {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { throw SocketError("socket") }
  var on: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
  var address = sockaddr_in()
  address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  address.sin_family = sa_family_t(AF_INET)
  address.sin_port = port.bigEndian
  address.sin_addr.s_addr = inet_addr("127.0.0.1")
  let bound = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
  }
  guard bound == 0, listen(fd, 64) == 0 else {
    let error = SocketError("listening on 127.0.0.1:\(port)")
    close(fd)
    throw error
  }
  return fd
}

// Accepts connections on listener until it's closed, on a thread of its own,
// handing each to handle.
public func acceptLoop(_ listener: Int32, _ handle: @escaping (Int32) -> Void) {
  Thread.detachNewThread {
    while true {
      let fd = accept(listener, nil, nil)
      if fd >= 0 {
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        handle(fd)
      } else if errno != EINTR && errno != ECONNABORTED {
        return
      }
    }
  }
}

// Carries bytes both ways between a and b, each way on a thread of its own.
// When one side ends, the other's writing half is shut, so a half-closed
// connection, as Docker's attach uses, keeps working. done runs once both ways
// have ended, and owns closing both.
public func splice(_ a: Int32, _ b: Int32, done: @escaping () -> Void) {
  let group = DispatchGroup()
  for (from, to) in [(a, b), (b, a)] {
    group.enter()
    Thread.detachNewThread {
      copy(from: from, to: to)
      shutdown(to, SHUT_WR)
      group.leave()
    }
  }
  group.notify(queue: .global(), execute: done)
}

// Writes all of bytes to fd, answering whether it could.
@discardableResult
public func writeAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
  bytes.withUnsafeBytes { buffer in
    var sent = 0
    while sent < buffer.count {
      let n = write(fd, buffer.baseAddress! + sent, buffer.count - sent)
      if n < 0 && errno == EINTR { continue }
      if n <= 0 { return false }
      sent += n
    }
    return true
  }
}

func copy(from: Int32, to: Int32) {
  var buffer = [UInt8](repeating: 0, count: 64 * 1024)
  while true {
    let n = buffer.withUnsafeMutableBytes { read(from, $0.baseAddress, $0.count) }
    if n < 0 && errno == EINTR { continue }
    if n <= 0 { return }
    if !writeAll(to, Array(buffer[0..<n])) { return }
  }
}
