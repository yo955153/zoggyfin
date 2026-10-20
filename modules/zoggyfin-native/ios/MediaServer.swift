// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation
import Network

/// The files that the session port serves over HTTP. A URL path holds a
/// random token, so only guests that got the path from the host can read a file.
final class SharedFiles {
  /// The owner's queue changes the files; each HTTP connection reads them on its own queue.
  private let lock = NSLock()
  private var files: [String: (path: String, mime: String)] = [:]
  /// The bitrate of a shared file (bytes per second), for the pace of its responses.
  private var rates: [String: Double] = [:]
  private var served = 0
  private var count = 0

  var bytesServed: Int { locked { served } }
  var requests: Int { locked { count } }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  func share(urlPath: String, filePath: String, mimeType: String) {
    locked { files[urlPath] = (filePath, mimeType) }
  }

  func setPace(urlPath: String, bytesPerSecond: Double) {
    locked {
      if bytesPerSecond > 0 { rates[urlPath] = bytesPerSecond } else { rates.removeValue(forKey: urlPath) }
    }
  }

  func removeAll() {
    locked {
      files.removeAll()
      rates.removeAll()
    }
  }

  func file(for path: String) -> (path: String, mime: String, rate: Double?)? {
    locked {
      guard let f = files[path] else { return nil }
      return (f.path, f.mime, rates[path])
    }
  }

  func count(bytes: Int) {
    locked { served += bytes }
  }

  func countRequest() {
    locked { count += 1 }
  }
}

/// One HTTP/1.1 connection: GET and HEAD with one byte range, enough for
/// AVPlayer, ExoPlayer and libmpv. Serves requests one after the other
/// (keep-alive). The connection is already started; `initial` holds the
/// bytes that were read to tell HTTP from a control socket.
///
/// Each connection works on its own serial queue (`io`): the file reads and
/// the pace waits never hold the queue of the control sockets. The
/// connection's callbacks come on the owner's queue and go on to `io` at once.
final class HTTPConnection {
  private let connection: NWConnection
  private let files: SharedFiles
  /// This connection's queue. Its work items drain their autorelease pools.
  private let io = DispatchQueue(label: "zoggyfin.nearby.http", qos: .userInitiated, autoreleaseFrequency: .workItem)
  private let onClose: (HTTPConnection) -> Void
  private var buffer: Data
  private var handle: FileHandle?
  private let closedLock = NSLock()
  private var closedFlag = false
  private var closed: Bool {
    get {
      closedLock.lock()
      defer { closedLock.unlock() }
      return closedFlag
    }
    set {
      closedLock.lock()
      closedFlag = newValue
      closedLock.unlock()
    }
  }
  private static let chunk = 256 * 1024
  /// A paced response sends this many seconds of media at once (the player's start buffer).
  static let paceBurstSeconds = 10.0
  /// Then at most this many times the bitrate.
  static let paceFactor = 1.5
  /// The pace of the response in progress: bytes per second of the media, start (ms), bytes sent.
  private var pace: (rate: Double, start: Double, sent: Int64)?

  /// The guest's address (for the connection limit) and the order of arrival.
  let remote: String
  let serial: Int
  /// An idle connection (no request) closes after this long, s.
  static let idleTimeout = 30.0
  private var idle: DispatchWorkItem?

  /// `onClose` runs on this connection's queue.
  init(connection: NWConnection, initial: Data, files: SharedFiles, remote: String = "", serial: Int = 0, onClose: @escaping (HTTPConnection) -> Void) {
    self.connection = connection
    self.buffer = initial
    self.files = files
    self.remote = remote
    self.serial = serial
    self.onClose = onClose
  }

  var isClosed: Bool { closed }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.io.async { self?.finish() }
      default:
        break
      }
    }
    io.async { self.readRequest() }
  }

  func cancel() {
    connection.cancel()
  }

  private func finish() {
    guard !closed else { return }
    closed = true
    idle?.cancel()
    idle = nil
    try? handle?.close()
    handle = nil
    onClose(self)
  }

  private func readRequest() {
    idle?.cancel()
    idle = nil
    if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
      let head = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
      buffer.removeSubrange(buffer.startIndex..<range.upperBound)
      handle(head: String(decoding: head, as: UTF8.self))
      return
    }
    if buffer.count > 64 * 1024 {
      connection.cancel()
      return
    }
    // No request for a while: close, so an idle player does not keep a slot.
    let w = DispatchWorkItem { [weak self] in self?.connection.cancel() }
    idle = w
    io.asyncAfter(deadline: .now() + Self.idleTimeout, execute: w)
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      self.io.async {
        if let data, !data.isEmpty { self.buffer.append(data) }
        if error != nil || (complete && (data?.isEmpty ?? true)) {
          self.connection.cancel()
          return
        }
        self.readRequest()
      }
    }
  }

  private func handle(head: String) {
    files.countRequest()
    let lines = head.components(separatedBy: "\r\n")
    let parts = (lines.first ?? "").split(separator: " ")
    guard parts.count >= 2 else { return respond(400, "Bad Request") }
    let method = String(parts[0])
    let path = String(parts[1]).components(separatedBy: "?").first ?? ""
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let colon = line.firstIndex(of: ":") else { continue }
      headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    guard method == "GET" || method == "HEAD" else { return respond(405, "Method Not Allowed") }
    guard let file = files.file(for: path),
          let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
          let size = (attrs[.size] as? NSNumber)?.int64Value
    else { return respond(404, "Not Found") }

    var start: Int64 = 0
    var end: Int64 = size - 1
    var partial = false
    if let r = headers["range"] {
      guard let parsed = Self.parseRange(r, size: size) else {
        return respond(416, "Range Not Satisfiable", extra: ["Content-Range": "bytes */\(size)"])
      }
      (start, end) = parsed
      partial = true
    }
    let length = size == 0 ? 0 : end - start + 1
    var out = [
      "Content-Type": file.mime,
      "Content-Length": "\(length)",
      "Accept-Ranges": "bytes",
      "Connection": "keep-alive",
    ]
    if partial { out["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
    let status = partial ? "206 Partial Content" : "200 OK"
    send(header: status, headers: out) { [weak self] in
      guard let self else { return }
      if method == "HEAD" || length == 0 {
        self.readRequest()
        return
      }
      guard let h = FileHandle(forReadingAtPath: file.path) else {
        self.connection.cancel()
        return
      }
      try? self.handle?.close()
      self.handle = h
      do {
        try h.seek(toOffset: UInt64(start))
      } catch {
        self.connection.cancel()
        return
      }
      self.pace = file.rate.map { ($0, nearbyMonotonicMs(), 0) }
      self.pump(remaining: length)
    }
  }

  /// Sends the body in chunks; the next chunk goes when the last one left.
  private func pump(remaining: Int64) {
    guard remaining > 0 else {
      try? handle?.close()
      handle = nil
      readRequest()
      return
    }
    guard let h = handle else { return }
    let n = Int(min(Int64(Self.chunk), remaining))
    if let wait = paceWait(next: n), wait > 0 {
      io.asyncAfter(deadline: .now() + wait) { [weak self] in
        guard let self, !self.closed else { return }
        self.pump(remaining: remaining)
      }
      return
    }
    let data: Data
    do {
      // FileHandle gives an autoreleased buffer: without a pool here, every chunk of every
      // stream stayed in memory until the queue's thread ended (about 33 MB per stream).
      data = try autoreleasepool { try h.read(upToCount: n) ?? Data() }
    } catch {
      connection.cancel()
      return
    }
    if data.isEmpty {
      connection.cancel()
      return
    }
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      guard let self else { return }
      if error != nil {
        self.connection.cancel()
        return
      }
      self.io.async {
        self.files.count(bytes: data.count)
        self.pace?.sent += Int64(data.count)
        self.pump(remaining: remaining - Int64(data.count))
      }
    })
  }

  /// Seconds to wait before the next `next` bytes, or nil for no pace. A token bucket: the
  /// first `paceBurstSeconds` of media go at once, then `paceFactor` x the bitrate.
  private func paceWait(next: Int) -> Double? {
    guard let p = pace, p.rate > 0 else { return nil }
    let elapsed = max(0, nearbyMonotonicMs() - p.start) / 1000
    let allowed = p.rate * Self.paceBurstSeconds + p.rate * Self.paceFactor * elapsed
    let over = Double(p.sent + Int64(next)) - allowed
    return over > 0 ? over / (p.rate * Self.paceFactor) : nil
  }

  private func send(header status: String, headers: [String: String], then: @escaping () -> Void) {
    var text = "HTTP/1.1 \(status)\r\n"
    for (k, v) in headers { text += "\(k): \(v)\r\n" }
    text += "\r\n"
    connection.send(content: Data(text.utf8), completion: .contentProcessed { [weak self] error in
      if error != nil {
        self?.connection.cancel()
        return
      }
      self?.io.async(execute: then)
    })
  }

  private func respond(_ code: Int, _ reason: String, extra: [String: String] = [:]) {
    var headers = extra
    headers["Content-Length"] = "0"
    headers["Connection"] = "keep-alive"
    send(header: "\(code) \(reason)", headers: headers) { [weak self] in self?.readRequest() }
  }

  /// "bytes=a-b", "bytes=a-" or "bytes=-n". Only one range.
  static func parseRange(_ value: String, size: Int64) -> (Int64, Int64)? {
    guard value.hasPrefix("bytes="), size > 0 else { return nil }
    let spec = value.dropFirst(6).split(separator: ",").first.map(String.init) ?? ""
    let ends = spec.split(separator: "-", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    guard ends.count == 2 else { return nil }
    if ends[0].isEmpty {
      guard let n = Int64(ends[1]), n > 0 else { return nil }
      return (max(0, size - n), size - 1)
    }
    guard let a = Int64(ends[0]), a < size else { return nil }
    let b = ends[1].isEmpty ? size - 1 : min(Int64(ends[1]) ?? (size - 1), size - 1)
    guard b >= a else { return nil }
    return (a, b)
  }
}

/// Guest side: a loopback TCP port. Each connection opens a connection to
/// the host's session port (over peer-to-peer Wi-Fi when there is no
/// router) and copies bytes both ways, so a player reads
/// http://127.0.0.1:<port>/<path> like any web file. A player cannot open a
/// Bonjour name, and an AWDL address has a scope that a URL cannot hold.
final class MediaRelay {
  private let queue = DispatchQueue(label: "zoggyfin.media-relay", qos: .userInitiated, autoreleaseFrequency: .workItem)
  private var listener: NWListener?
  private var target: NWEndpoint?
  private var pipes: [ObjectIdentifier: Pipe] = [:]
  private(set) var bytesRelayed: Int = 0

  final class Pipe {
    let a: NWConnection
    let b: NWConnection
    init(a: NWConnection, b: NWConnection) {
      self.a = a
      self.b = b
    }
  }

  func start(target: NWEndpoint, completion: @escaping (Result<UInt16, Error>) -> Void) {
    queue.async {
      if let l = self.listener, let port = l.port, self.target == target {
        completion(.success(port.rawValue))
        return
      }
      self.stopNow()
      self.target = target
      do {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        let l = try NWListener(using: params)
        var done = false
        l.stateUpdateHandler = { state in
          switch state {
          case .ready:
            if !done, let port = l.port {
              done = true
              completion(.success(port.rawValue))
            }
          case .failed(let error):
            if !done {
              done = true
              completion(.failure(error))
            }
          default:
            break
          }
        }
        l.newConnectionHandler = { [weak self] inbound in self?.accept(inbound) }
        l.start(queue: self.queue)
        self.listener = l
      } catch {
        completion(.failure(error))
      }
    }
  }

  func stop() {
    queue.async { self.stopNow() }
  }

  private func stopNow() {
    listener?.cancel()
    listener = nil
    target = nil
    for p in pipes.values {
      p.a.cancel()
      p.b.cancel()
    }
    pipes.removeAll()
  }

  private func accept(_ inbound: NWConnection) {
    guard let target else {
      inbound.cancel()
      return
    }
    let upstream = NWConnection(to: target, using: nearbyParameters())
    let pipe = Pipe(a: inbound, b: upstream)
    let key = ObjectIdentifier(pipe)
    pipes[key] = pipe
    let close: (NWConnection.State) -> Void = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        inbound.cancel()
        upstream.cancel()
        self?.pipes.removeValue(forKey: key)
      default:
        break
      }
    }
    inbound.stateUpdateHandler = close
    upstream.stateUpdateHandler = close
    inbound.start(queue: queue)
    upstream.start(queue: queue)
    copy(from: inbound, to: upstream, count: false)
    copy(from: upstream, to: inbound, count: true)
  }

  private func copy(from src: NWConnection, to dst: NWConnection, count: Bool) {
    src.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      if let data, !data.isEmpty {
        if count { self.bytesRelayed += data.count }
        dst.send(content: data, completion: .contentProcessed { sendError in
          if sendError != nil {
            src.cancel()
            dst.cancel()
            return
          }
          if complete {
            dst.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
            return
          }
          self.copy(from: src, to: dst, count: count)
        })
        return
      }
      if complete || error != nil {
        if error != nil { src.cancel() }
        dst.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
        return
      }
      self.copy(from: src, to: dst, count: count)
    }
  }
}
