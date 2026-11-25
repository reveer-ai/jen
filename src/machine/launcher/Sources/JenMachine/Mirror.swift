// Mirroring the ports the machine's containers publish on 127.0.0.1 onto the
// Mac's 127.0.0.1. The launcher follows the engine's container events, and on
// each start or stop lists the running containers and reconciles its
// listeners with the ports they publish on 127.0.0.1.

import Foundation

// The engine's API calls the launcher makes, over the engine relay.
public enum EngineRequest {
  public static let events = request("/events?filters=" + percentEncoded(#"{"type":["container"],"event":["start","die"]}"#))
  public static let containers = request("/containers/json")

  static func request(_ path: String) -> [UInt8] {
    Array("GET \(path) HTTP/1.1\r\nHost: engine\r\nConnection: close\r\n\r\n".utf8)
  }

  static func percentEncoded(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
  }
}

// Decodes an HTTP/1.1 response fed to it in pieces: its status, then its body,
// whether chunked, sized by Content-Length, or running until the connection
// closes.
public final class HTTPDecoder {
  enum State {
    case head
    case chunkSize
    case chunk(Int)
    case chunkEnd
    case sized(Int)
    case untilClose
    case done
  }

  var state = State.head
  var pending: [UInt8] = []
  public private(set) var status: Int?
  public var finished: Bool { if case .done = state { true } else { false } }

  public init() {}

  // Answers the body's bytes that bytes complete.
  public func feed(_ bytes: [UInt8]) -> [UInt8] {
    pending += bytes
    var body: [UInt8] = []
    while true {
      switch state {
      case .head:
        guard let end = find([13, 10, 13, 10]) else { return body }
        let head = String(decoding: pending[0..<end], as: UTF8.self).components(separatedBy: "\r\n")
        pending.removeFirst(end + 4)
        status = head.first.flatMap { Int($0.split(separator: " ").dropFirst().first ?? "") }
        let headers = Dictionary(head.dropFirst().compactMap { line -> (String, String)? in
          guard let colon = line.firstIndex(of: ":") else { return nil }
          return (line[..<colon].lowercased(), line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces))
        }, uniquingKeysWith: { _, last in last })
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
          state = .chunkSize
        } else if let length = headers["content-length"].flatMap({ Int($0) }) {
          state = length == 0 ? .done : .sized(length)
        } else {
          state = .untilClose
        }
      case .chunkSize:
        guard let end = find([13, 10]) else { return body }
        let size = Int(String(decoding: pending[0..<end], as: UTF8.self).split(separator: ";").first ?? "", radix: 16) ?? 0
        pending.removeFirst(end + 2)
        state = size == 0 ? .done : .chunk(size)
      case .chunk(let left):
        guard !pending.isEmpty else { return body }
        let n = min(left, pending.count)
        body += pending[0..<n]
        pending.removeFirst(n)
        state = n == left ? .chunkEnd : .chunk(left - n)
      case .chunkEnd:
        guard pending.count >= 2 else { return body }
        pending.removeFirst(2)
        state = .chunkSize
      case .sized(let left):
        guard !pending.isEmpty else { return body }
        let n = min(left, pending.count)
        body += pending[0..<n]
        pending.removeFirst(n)
        state = n == left ? .done : .sized(left - n)
      case .untilClose:
        body += pending
        pending = []
        return body
      case .done:
        return body
      }
    }
  }

  func find(_ needle: [UInt8]) -> Int? {
    guard pending.count >= needle.count else { return nil }
    return (0...(pending.count - needle.count)).first { pending[$0..<($0 + needle.count)].elementsEqual(needle) }
  }
}

// Follows the engine's event stream, calling changed once the stream opens and
// after each container's start or stop.
public final class EventFollower {
  let decoder = HTTPDecoder()
  var line: [UInt8] = []
  var opened = false
  let changed: () -> Void

  public init(changed: @escaping () -> Void) { self.changed = changed }

  public func feed(_ bytes: [UInt8]) {
    let body = decoder.feed(bytes)
    if !opened, decoder.status == 200 {
      opened = true
      changed()
    }
    for byte in body {
      guard byte == 10 else {
        line.append(byte)
        continue
      }
      let event = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any]
      line = []
      if event?["Type"] as? String == "container", ["start", "die"].contains(event?["Action"] as? String) { changed() }
    }
  }
}

// The TCP ports a list of running containers, as the engine's
// GET /containers/json answers it, publishes on 127.0.0.1.
public func loopbackPorts(_ list: [UInt8]) -> Set<UInt16> {
  guard let containers = try? JSONSerialization.jsonObject(with: Data(list)) as? [[String: Any]] else { return [] }
  var ports = Set<UInt16>()
  for container in containers {
    for port in container["Ports"] as? [[String: Any]] ?? [] {
      guard port["IP"] as? String == "127.0.0.1", port["Type"] as? String == "tcp", let number = port["PublicPort"] as? Int,
        let published = UInt16(exactly: number), published > 0
      else { continue }
      ports.insert(published)
    }
  }
  return ports
}

public protocol Closable: AnyObject {
  func close()
}

// The Mac's listeners for the machine's published ports. open answers a
// listener on 127.0.0.1 for a port, or nil when the Mac can't listen there.
public final class PortMirror {
  let open: (UInt16) -> Closable?
  public private(set) var listeners: [UInt16: Closable] = [:]
  // The ports the machine last published.
  public private(set) var published: Set<UInt16> = []

  public init(open: @escaping (UInt16) -> Closable?) { self.open = open }

  public var ports: Set<UInt16> { Set(listeners.keys) }

  // The published ports the Mac couldn't listen on.
  public var missing: Set<UInt16> { published.subtracting(listeners.keys) }

  // Tries again to listen on each published port the Mac couldn't.
  public func retry() { reconcile(published) }

  // Listens on each port in published that it doesn't yet, and closes each
  // listener whose port no longer is.
  public func reconcile(_ published: Set<UInt16>) {
    self.published = published
    for (port, listener) in listeners where !published.contains(port) {
      listener.close()
      listeners[port] = nil
    }
    for port in published where listeners[port] == nil {
      listeners[port] = open(port)
    }
  }
}
