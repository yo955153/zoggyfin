// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation
import Network

/// The files that the session port serves over HTTP. A URL path holds a
/// random token, so only guests that got the path from the host can read a file.
final class SharedFiles {
  private var files: [String: (path: String, mime: String)] = [:]
  private(set) var bytesServed: Int = 0
  private(set) var requests: Int = 0

  // All calls on the queue of the owner (NearbyCore).
  func share(urlPath: String, filePath: String, mimeType: String) {
    files[urlPath] = (filePath, mimeType)
  }

  func removeAll() {
    files.removeAll()
  }

  func file(for path: String) -> (path: String, mime: String)? {
    files[path]
  }

  func count(bytes: Int) {
    bytesServed += bytes
  }

  func countRequest() {
    requests += 1
  }
}

/// One HTTP/1.1 connection: GET and HEAD with one byte range, enough for
/// AVPlayer, ExoPlayer and libmpv. Serves requests one after the other
/// (keep-alive). The connection is already started; `initial` holds the
/// bytes that were read to tell HTTP from a control socket.
final class HTTPConnection {
  private let connection: NWConnection
  private let files: SharedFiles
  private let onClose: (HTTPConnection) -> Void
  private var buffer: Data
  private var handle: FileHandle?
  private var closed = false
  private static let chunk = 256 * 1024

  init(connection: NWConnection, initial: Data, files: SharedFiles, onClose: @escaping (HTTPConnection) -> Void) {
    self.connection = connection
    self.buffer = initial
    self.files = files
    self.onClose = onClose
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.finish()
      default:
        break
      }
    }
    readRequest()
  }

  func cancel() {
    connection.cancel()
  }

  private func finish() {
    guard !closed else { return }
    closed = true
    try? handle?.close()
    handle = nil
    onClose(self)
  }

  private func readRequest() {
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
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      if let data, !data.isEmpty { self.buffer.append(data) }
      if error != nil || (complete && (data?.isEmpty ?? true)) {
        self.connection.cancel()
        return
      }
      self.readRequest()
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
    let data: Data
    do {
      data = try h.read(upToCount: n) ?? Data()
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
      self.files.count(bytes: data.count)
      self.pump(remaining: remaining - Int64(data.count))
    })
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
      then()
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
  private let queue = DispatchQueue(label: "zoggyfin.media-relay")
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
