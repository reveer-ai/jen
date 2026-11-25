import Foundation
import Testing
@testable import JenMachine

func bytes(_ text: String) -> [UInt8] { Array(text.utf8) }

// A chunk of a chunked body.
func chunk(_ text: String) -> String { String(text.utf8.count, radix: 16) + "\r\n" + text + "\r\n" }

func event(_ action: String, type: String = "container") -> String { #"{"Type":"\#(type)","Action":"\#(action)","id":"abc"}"# + "\n" }

@Suite struct Decoding {
  @Test func aChunkedBodyFedInPieces() {
    let decoder = HTTPDecoder()
    let response = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" + chunk("hello ") + chunk("engine") + "0\r\n\r\n"
    var body: [UInt8] = []
    for byte in bytes(response) { body += decoder.feed([byte]) }
    #expect(decoder.status == 200)
    #expect(String(decoding: body, as: UTF8.self) == "hello engine")
    #expect(decoder.finished)
  }

  @Test func aBodySizedByContentLength() {
    let decoder = HTTPDecoder()
    let body = decoder.feed(bytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]"))
    #expect(String(decoding: body, as: UTF8.self) == "[]")
    #expect(decoder.finished)
  }

  @Test func aBodyUntilTheConnectionCloses() {
    let decoder = HTTPDecoder()
    let body = decoder.feed(bytes("HTTP/1.0 200 OK\r\n\r\n[1]"))
    #expect(String(decoding: body, as: UTF8.self) == "[1]")
    #expect(!decoder.finished)
  }

  @Test func anErrorsStatus() {
    let decoder = HTTPDecoder()
    _ = decoder.feed(bytes("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n"))
    #expect(decoder.status == 500)
  }
}

@Suite struct Ports {
  @Test func onlyTCPPortsOn127001() {
    let list = #"""
      [{"Id":"a","Ports":[{"IP":"127.0.0.1","PrivatePort":8080,"PublicPort":52817,"Type":"tcp"},
                          {"IP":"0.0.0.0","PrivatePort":80,"PublicPort":8082,"Type":"tcp"},
                          {"IP":"::","PrivatePort":80,"PublicPort":8082,"Type":"tcp"},
                          {"IP":"127.0.0.1","PrivatePort":53,"PublicPort":5353,"Type":"udp"},
                          {"PrivatePort":9000,"Type":"tcp"}]},
       {"Id":"b","Ports":[]}]
      """#
    #expect(loopbackPorts(bytes(list)) == [52817])
  }

  @Test func aListThatIsntJSON() {
    #expect(loopbackPorts(bytes("not json")) == [])
  }
}

final class FakeListener: Closable {
  var closed = false
  func close() { closed = true }
}

// A stand-in engine: its event stream, and the containers it lists.
final class StandIn {
  var running: [String: [(ip: String, port: Int)]] = [:]
  var opened: [UInt16] = []
  var refused: Set<UInt16> = []
  var listeners: [UInt16: FakeListener] = [:]
  lazy var mirror = PortMirror { port in
    self.opened.append(port)
    guard !self.refused.contains(port) else { return nil }
    let listener = FakeListener()
    self.listeners[port] = listener
    return listener
  }
  lazy var follower = EventFollower { self.mirror.reconcile(loopbackPorts(self.list())) }

  func list() -> [UInt8] {
    let containers = running.map { id, ports in
      ["Id": id, "Ports": ports.map { ["IP": $0.ip, "PrivatePort": 80, "PublicPort": $0.port, "Type": "tcp"] }] as [String: Any]
    }
    return [UInt8](try! JSONSerialization.data(withJSONObject: containers))
  }

  func stream(_ text: String) { follower.feed(bytes(chunk(text))) }
}

@Suite struct Mirroring {
  @Test func aPortAlreadyPublishedWhenTheStreamOpens() {
    let engine = StandIn()
    engine.running["runtime"] = [("127.0.0.1", 52817)]
    engine.follower.feed(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"))
    #expect(engine.mirror.ports == [52817])
  }

  @Test func startStopAndAPortOnAnotherAddress() {
    let engine = StandIn()
    engine.follower.feed(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"))
    #expect(engine.mirror.ports == [])

    engine.running["web"] = [("127.0.0.1", 8081), ("0.0.0.0", 8082)]
    engine.stream(event("start"))
    #expect(engine.mirror.ports == [8081])

    engine.running["web"] = nil
    engine.stream(event("die"))
    #expect(engine.mirror.ports == [])
    #expect(engine.listeners[8081]?.closed == true)
    #expect(engine.opened == [8081])
  }

  @Test func otherEventsChangeNothing() {
    let engine = StandIn()
    engine.follower.feed(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"))
    engine.running["web"] = [("127.0.0.1", 8081)]
    engine.stream(event("create") + event("start", type: "network"))
    #expect(engine.mirror.ports == [])
  }

  @Test func anEventSplitAcrossChunks() {
    let engine = StandIn()
    engine.follower.feed(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"))
    engine.running["web"] = [("127.0.0.1", 8081)]
    let whole = event("start")
    let middle = whole.index(whole.startIndex, offsetBy: 10)
    engine.stream(String(whole[..<middle]))
    #expect(engine.mirror.ports == [])
    engine.stream(String(whole[middle...]))
    #expect(engine.mirror.ports == [8081])
  }

  @Test func aPortTheMacCantListenOnIsTriedAgainAtTheNextChange() {
    let engine = StandIn()
    engine.refused = [8081]
    engine.running["web"] = [("127.0.0.1", 8081)]
    engine.follower.feed(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"))
    #expect(engine.mirror.ports == [])
    engine.refused = []
    engine.stream(event("start"))
    #expect(engine.mirror.ports == [8081])
  }

  @Test func aStreamThatDoesntOpenChangesNothing() {
    let engine = StandIn()
    engine.running["web"] = [("127.0.0.1", 8081)]
    engine.follower.feed(bytes("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n"))
    #expect(engine.mirror.ports == [])
  }
}
