// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation
import Network
import Security

// The on-device bridge from a progressive MPEG-TS stream (IPTV `.ts` URLs)
// to a live HLS playlist that AVPlayer plays like any HLS stream, with
// Picture in Picture, AirPlay and the lock screen.
//
// - A URLSession data task reads the source. `TsSegmenter` (pure) cuts it
//   into segment files under Caches/zoggyfin-ts-bridge/<id>/.
// - `TsBridgeServer` serves `index.m3u8` and `seg-N.ts` on 127.0.0.1, on a
//   random port, under a random path token per session. Other paths get 404.
// - All state lives on one serial queue: the URLSession delegate, the
//   listener and the connections all run on it.
// - The source URL holds IPTV credentials: it is never logged or sent back.
//
// No UIKit here, so the code also builds on macOS for a command-line test.

struct TsBridgeOptions {
  var targetDuration = 2.0
  var windowSize = 6
  /// Segments in the playlist before the session counts as ready.
  var minSegments = 2
  /// `start` fails when the session is not ready after this long, s.
  var startTimeout = 20.0
  /// New connections after the source drops, in a row, before the session ends.
  var reconnects = 3
}

/// Why a session could not start. `code` is part of the JS contract
/// (`src/native/ts-bridge-types.ts`).
struct TsBridgeError: Error, LocalizedError {
  var code: String
  var message: String
  var httpStatus: Int?

  var errorDescription: String? { message }
}

/// Starts and stops bridge sessions. `emit` gets status events (any queue).
final class TsBridge {
  let queue = DispatchQueue(label: "zoggyfin.tsbridge", qos: .userInitiated, autoreleaseFrequency: .workItem)
  private let emit: ([String: Any]) -> Void
  private var sessions: [String: TsBridgeSession] = [:]
  private var server: TsBridgeServer?

  init(emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
  }

  static var rootDir: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("zoggyfin-ts-bridge", isDirectory: true)
  }

  /// Deletes the files that an earlier run of the app left behind. Call it once at start.
  static func purgeStale() {
    try? FileManager.default.removeItem(at: rootDir)
  }

  /// Starts a session. Without `keepOthers`, the other sessions stop first (zapping).
  func start(url: URL, headers: [String: String], options: TsBridgeOptions, keepOthers: Bool, completion: @escaping (Result<(id: String, playlistUrl: String), Error>) -> Void) {
    queue.async {
      if !keepOthers { self.stopAllOnQueue() }
      let server = self.server ?? TsBridgeServer(queue: self.queue) { [weak self] token in
        self?.sessions.values.first { $0.token == token }
      }
      self.server = server
      server.start { result in
        switch result {
        case .failure(let error):
          completion(.failure(error))
        case .success(let port):
          let id = Self.randomHex(8)
          let token = Self.randomHex(16)
          let dir = Self.rootDir.appendingPathComponent(id, isDirectory: true)
          let session = TsBridgeSession(id: id, token: token, dir: dir, url: url, headers: headers, options: options, queue: self.queue, emit: self.emit)
          self.sessions[id] = session
          // Resolve once the playlist has segments: AVPlayer gives up on a
          // live playlist that it has to wait for (checked on macOS 26).
          session.start { error in
            if let error {
              self.sessions.removeValue(forKey: id)?.stop()
              if self.sessions.isEmpty { self.stopServer() }
              completion(.failure(error))
            } else {
              completion(.success((id, "http://127.0.0.1:\(port)/\(token)/index.m3u8")))
            }
          }
        }
      }
    }
  }

  func stop(id: String, completion: @escaping () -> Void = {}) {
    queue.async {
      self.sessions.removeValue(forKey: id)?.stop()
      if self.sessions.isEmpty { self.stopServer() }
      completion()
    }
  }

  func stopAll(completion: @escaping () -> Void = {}) {
    queue.async {
      self.stopAllOnQueue()
      self.stopServer()
      completion()
    }
  }

  /// The app came back to the foreground: a listener that iOS closed while
  /// the app was suspended opens again on the same port.
  func resume() {
    queue.async { self.server?.reopenIfNeeded(foreground: true) }
  }

  private func stopAllOnQueue() {
    for s in sessions.values { s.stop() }
    sessions.removeAll()
  }

  private func stopServer() {
    server?.cancel()
    server = nil
  }

  static func randomHex(_ bytes: Int) -> String {
    var b = [UInt8](repeating: 0, count: bytes)
    if SecRandomCopyBytes(kSecRandomDefault, bytes, &b) != errSecSuccess {
      b = (0..<bytes).map { _ in UInt8.random(in: 0...255) }
    }
    return b.map { String(format: "%02x", $0) }.joined()
  }
}

// MARK: Session

/// One source stream and its segments. Runs on the bridge queue.
final class TsBridgeSession: NSObject, URLSessionDataDelegate, TsSegmentSink {
  let id: String
  let token: String
  private let dir: URL
  private let url: URL
  private let headers: [String: String]
  private let options: TsBridgeOptions
  private let queue: DispatchQueue
  private let emit: ([String: Any]) -> Void

  private enum State { case running, ended, failed, stopped }
  private var state = State.running
  private var urlSession: URLSession?
  private var task: URLSessionDataTask?
  private var segmenter: TsSegmenter!
  private var window: HlsWindow
  private var file: FileHandle?
  /// Segment files on disk, oldest first. A few more than the window, so a
  /// player that fetches a segment just after it left the window still gets it.
  private var onDisk: [Int] = []
  private var waiters: [(id: Int, reply: (String?) -> Void)] = []
  private var nextWaiter = 0
  private var announced = false
  private var segmentsEver = 0
  private var dropsInARow = 0
  private var reconnectWork: DispatchWorkItem?
  private var onStart: ((TsBridgeError?) -> Void)?

  init(id: String, token: String, dir: URL, url: URL, headers: [String: String], options: TsBridgeOptions, queue: DispatchQueue, emit: @escaping ([String: Any]) -> Void) {
    self.id = id
    self.token = token
    self.dir = dir
    self.url = url
    self.headers = headers
    self.options = options
    self.queue = queue
    self.emit = emit
    self.window = HlsWindow(size: options.windowSize, targetDuration: options.targetDuration)
    super.init()
    var config = TsSegmenter.Config()
    config.targetDuration = options.targetDuration
    config.maxDuration = max(10, options.targetDuration * 5)
    segmenter = TsSegmenter(config: config, sink: self)
  }

  /// Starts reading the source. `onStart` runs once: nil when the playlist
  /// is ready, or the error.
  func start(onStart: @escaping (TsBridgeError?) -> Void) {
    self.onStart = onStart
    queue.asyncAfter(deadline: .now() + options.startTimeout) { [weak self] in
      guard let self, self.onStart != nil else { return }
      self.fail(code: "timeout", message: "The stream did not start in time.")
    }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var d = dir
    try? d.setResourceValues(values)

    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    // No data for this long fails the request; the stream itself has no end.
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 7 * 24 * 3600
    config.httpMaximumConnectionsPerHost = 2
    let delegateQueue = OperationQueue()
    delegateQueue.underlyingQueue = queue
    delegateQueue.maxConcurrentOperationCount = 1
    urlSession = URLSession(configuration: config, delegate: self, delegateQueue: delegateQueue)
    connect()
  }

  private func connect() {
    guard state == .running, let urlSession else { return }
    var request = URLRequest(url: url)
    for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    let t = urlSession.dataTask(with: request)
    task = t
    t.resume()
  }

  func stop() {
    guard state != .stopped else { return }
    state = .stopped
    reconnectWork?.cancel()
    task?.cancel()
    urlSession?.invalidateAndCancel()
    urlSession = nil
    try? file?.close()
    file = nil
    answerWaiters(nil)
    try? FileManager.default.removeItem(at: dir)
    started(TsBridgeError(code: "stopped", message: "The stream was stopped."))
  }

  private func started(_ error: TsBridgeError?) {
    guard let done = onStart else { return }
    onStart = nil
    done(error)
  }

  // MARK: Serving

  /// The playlist text, or nil when the session failed or has no segment.
  /// `start` resolves only when the playlist is ready; a request before that
  /// still waits for it (up to `startTimeout`) rather than get an empty playlist.
  func playlist(reply: @escaping (String?) -> Void) {
    if state == .failed || state == .stopped { return reply(nil) }
    if window.segments.count >= options.minSegments || window.ended { return reply(window.playlist()) }
    let wid = nextWaiter
    nextWaiter += 1
    waiters.append((wid, reply))
    queue.asyncAfter(deadline: .now() + options.startTimeout) { [weak self] in
      guard let self, let i = self.waiters.firstIndex(where: { $0.id == wid }) else { return }
      let w = self.waiters.remove(at: i)
      w.reply(self.window.segments.isEmpty ? nil : self.window.playlist())
    }
  }

  /// The file of a segment that is still on disk.
  func segmentFile(_ sequence: Int) -> URL? {
    guard state != .stopped, onDisk.contains(sequence), window.contains(sequence) || sequence < (window.segments.first?.sequence ?? 0) else { return nil }
    return dir.appendingPathComponent("seg-\(sequence).ts")
  }

  private func answerWaiters(_ text: String?) {
    let all = waiters
    waiters.removeAll()
    for w in all { w.reply(text) }
  }

  // MARK: TsSegmentSink

  func segmentDidBegin(_ sequence: Int) {
    let path = dir.appendingPathComponent("seg-\(sequence).ts").path
    FileManager.default.createFile(atPath: path, contents: nil)
    file = FileHandle(forWritingAtPath: path)
    onDisk.append(sequence)
  }

  func segmentDidAppend(_ bytes: [UInt8]) {
    guard let file else { return }
    do {
      try file.write(contentsOf: bytes)
    } catch {
      // Not from inside the segmenter's callback: fail on the next turn.
      try? file.close()
      self.file = nil
      queue.async { [weak self] in self?.fail(code: "disk", message: "Could not write a segment.") }
    }
  }

  func segmentDidEnd(_ segment: TsSegment) {
    try? file?.close()
    file = nil
    dropsInARow = 0
    segmentsEver += 1
    window.append(segment)
    let keep = window.size + 3
    while onDisk.count > keep {
      let old = onDisk.removeFirst()
      try? FileManager.default.removeItem(at: dir.appendingPathComponent("seg-\(old).ts"))
    }
    if window.segments.count >= options.minSegments {
      if !waiters.isEmpty { answerWaiters(window.playlist()) }
      if !announced {
        announced = true
        started(nil)
        emit(["id": id, "type": "ready"])
      }
    }
  }

  // MARK: URLSessionDataDelegate

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard state == .running, dataTask === task else { return completionHandler(.cancel) }
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      completionHandler(.cancel)
      fail(code: "http", message: "The stream answered with HTTP \(http.statusCode).", httpStatus: http.statusCode)
      return
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard state == .running, dataTask === task else { return }
    do {
      try segmenter.feed(data)
    } catch TsSegmenterError.noMedia {
      fail(code: "noMedia", message: "The stream has no video or audio.")
    } catch {
      fail(code: "notTs", message: "The stream is not MPEG-TS.")
    }
  }

  func urlSession(_ session: URLSession, task t: URLSessionTask, didCompleteWithError error: Error?) {
    guard state == .running, t === task else { return }
    task = nil
    let timedOut = (error as? URLError)?.code == .timedOut
    let code = error == nil ? "upstreamClosed" : (timedOut ? "timeout" : "network")
    // The first connection gave nothing: fail at once, so the caller can fall back.
    guard segmentsEver > 0 else {
      return fail(code: code, message: error == nil ? "The stream closed before it played." : "Could not read the stream.")
    }
    guard dropsInARow < options.reconnects else {
      return end(code: code)
    }
    // restart() closes the open segment first, so count the drop after it.
    segmenter.restart()
    dropsInARow += 1
    emit(["id": id, "type": "reconnecting", "code": code, "attempt": dropsInARow])
    let w = DispatchWorkItem { [weak self] in self?.connect() }
    reconnectWork = w
    queue.asyncAfter(deadline: .now() + Double(dropsInARow), execute: w)
  }

  // MARK: End

  /// The source is gone for good: the playlist gets ENDLIST, so the player
  /// plays what is left and ends.
  private func end(code: String) {
    guard state == .running else { return }
    segmenter.finish()
    state = .ended
    window.ended = true
    answerWaiters(window.segments.isEmpty ? nil : window.playlist())
    // A short stream that ended before `minSegments`: still playable.
    started(window.segments.isEmpty ? TsBridgeError(code: code, message: "The stream ended.") : nil)
    emit(["id": id, "type": "ended", "code": code])
  }

  private func fail(code: String, message: String, httpStatus: Int? = nil) {
    guard state == .running else { return }
    task?.cancel()
    task = nil
    if segmentsEver > 0 {
      // Segments were served: end the playlist so the player stops cleanly.
      segmenter.finish()
      window.ended = true
      state = .ended
      answerWaiters(window.playlist())
    } else {
      state = .failed
      answerWaiters(nil)
    }
    started(TsBridgeError(code: code, message: message, httpStatus: httpStatus))
    var body: [String: Any] = ["id": id, "type": "error", "code": code, "message": message]
    if let httpStatus { body["httpStatus"] = httpStatus }
    emit(body)
  }
}

// MARK: Local HTTP server

/// A small HTTP/1.1 server on 127.0.0.1 for the bridge sessions. Paths are
/// `/<token>/index.m3u8` and `/<token>/seg-<n>.ts`; anything else is 404.
final class TsBridgeServer {
  private let queue: DispatchQueue
  private let route: (String) -> TsBridgeSession?
  private var listener: NWListener?
  private var port: NWEndpoint.Port?
  private var waiting: [(Result<UInt16, Error>) -> Void] = []
  private var connections: [ObjectIdentifier: TsBridgeConnection] = [:]
  private var cancelled = false
  private var retries = 0

  init(queue: DispatchQueue, route: @escaping (String) -> TsBridgeSession?) {
    self.queue = queue
    self.route = route
  }

  /// Calls back with the port once the listener is ready. On the bridge queue.
  func start(_ done: @escaping (Result<UInt16, Error>) -> Void) {
    if let port, listener?.state == .ready { return done(.success(port.rawValue)) }
    waiting.append(done)
    if listener == nil { open(port: port ?? .any) }
  }

  func reopenIfNeeded(foreground: Bool = false) {
    guard !cancelled else { return }
    if foreground { retries = 0 }
    switch listener?.state {
    case .failed?, .cancelled?, nil:
      open(port: port ?? .any)
    default:
      break
    }
  }

  func cancel() {
    cancelled = true
    listener?.cancel()
    listener = nil
    for c in connections.values { c.cancel() }
    connections.removeAll()
    let w = waiting
    waiting.removeAll()
    for done in w { done(.failure(TsBridgeError(code: "stopped", message: "The bridge stopped."))) }
  }

  private func open(port: NWEndpoint.Port) {
    listener?.cancel()
    let params = NWParameters.tcp
    // Bound to loopback, so no other device can connect. Do not add
    // `acceptLocalOnly`: on iOS it drops the loopback connections of AVPlayer.
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
    params.allowLocalEndpointReuse = true
    let l: NWListener
    do {
      l = try NWListener(using: params)
    } catch {
      return finishWaiting(.failure(error))
    }
    listener = l
    l.stateUpdateHandler = { [weak self, weak l] state in
      guard let self, let l, l === self.listener else { return }
      switch state {
      case .ready:
        if let p = l.port {
          self.port = p
          self.retries = 0
          self.finishWaiting(.success(p.rawValue))
        }
      case .failed(let error):
        l.cancel()
        self.listener = nil
        if !self.waiting.isEmpty {
          // Asked for a port that is taken now: any port.
          if port != .any { return self.open(port: .any) }
          self.finishWaiting(.failure(error))
        } else {
          // iOS closed the socket (for example while the app was suspended):
          // a few tries on the same port, then `reopenIfNeeded` on foreground.
          guard self.retries < 5 else { return }
          self.retries += 1
          self.queue.asyncAfter(deadline: .now() + 1) { [weak self] in self?.reopenIfNeeded() }
        }
      default:
        break
      }
    }
    l.newConnectionHandler = { [weak self] nw in
      guard let self else { return nw.cancel() }
      let c = TsBridgeConnection(connection: nw, queue: self.queue, route: self.route) { [weak self] c in
        self?.connections.removeValue(forKey: ObjectIdentifier(c))
      }
      self.connections[ObjectIdentifier(c)] = c
      c.start()
    }
    l.start(queue: queue)
  }

  private func finishWaiting(_ result: Result<UInt16, Error>) {
    let w = waiting
    waiting.removeAll()
    for done in w { done(result) }
  }
}

/// One keep-alive connection from the player. GET and HEAD only.
final class TsBridgeConnection {
  private let connection: NWConnection
  private let queue: DispatchQueue
  private let route: (String) -> TsBridgeSession?
  private let onClose: (TsBridgeConnection) -> Void
  private var buffer = Data()
  private var closed = false
  private var idle: DispatchWorkItem?
  private static let chunk = 256 * 1024

  init(connection: NWConnection, queue: DispatchQueue, route: @escaping (String) -> TsBridgeSession?, onClose: @escaping (TsBridgeConnection) -> Void) {
    self.connection = connection
    self.queue = queue
    self.route = route
    self.onClose = onClose
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled: self?.finish()
      default: break
      }
    }
    connection.start(queue: queue)
    readRequest()
  }

  func cancel() {
    connection.cancel()
  }

  private func finish() {
    guard !closed else { return }
    closed = true
    idle?.cancel()
    onClose(self)
  }

  private func readRequest() {
    guard !closed else { return }
    if let r = buffer.range(of: Data("\r\n\r\n".utf8)) {
      let head = String(decoding: buffer[buffer.startIndex..<r.lowerBound], as: UTF8.self)
      buffer.removeSubrange(buffer.startIndex..<r.upperBound)
      return handle(head: head)
    }
    if buffer.count > 16 * 1024 { return connection.cancel() }
    idle?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.connection.cancel() }
    idle = w
    queue.asyncAfter(deadline: .now() + 60, execute: w)
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      self.idle?.cancel()
      if let data, !data.isEmpty { self.buffer.append(data) }
      if error != nil || (complete && (data?.isEmpty ?? true)) { return self.connection.cancel() }
      self.readRequest()
    }
  }

  private func handle(head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let parts = (lines.first ?? "").split(separator: " ")
    guard parts.count >= 2 else { return send(400, "Bad Request") }
    let method = String(parts[0])
    let isHead = method == "HEAD"
    guard method == "GET" || isHead else { return send(405, "Method Not Allowed") }
    let keepAlive = !lines.contains { $0.lowercased().hasPrefix("connection:") && $0.lowercased().contains("close") }
    let path = String(parts[1]).split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    let segs = path.split(separator: "/", omittingEmptySubsequences: false)
    guard segs.count == 3, segs[0].isEmpty, let session = route(String(segs[1])) else { return send(404, "Not Found") }
    let name = String(segs[2])

    if name == "index.m3u8" {
      session.playlist { [weak self] text in
        guard let self else { return }
        guard let text else { return self.send(503, "Service Unavailable") }
        self.send(200, "OK", type: "application/vnd.apple.mpegurl", body: Data(text.utf8), head: isHead, keepAlive: keepAlive)
      }
      return
    }
    guard name.hasPrefix("seg-"), name.hasSuffix(".ts"), let n = Int(name.dropFirst(4).dropLast(3)), let url = session.segmentFile(n),
          let handle = try? FileHandle(forReadingFrom: url),
          let size = try? handle.seekToEnd()
    else { return send(404, "Not Found") }
    try? handle.seek(toOffset: 0)
    sendHeader(200, "OK", type: "video/mp2t", length: Int(size), keepAlive: keepAlive)
    if isHead {
      try? handle.close()
      return next(keepAlive)
    }
    stream(handle, keepAlive: keepAlive)
  }

  /// Sends the file in small chunks, each after the last one left.
  private func stream(_ handle: FileHandle, keepAlive: Bool) {
    if closed {
      try? handle.close()
      return
    }
    let data = (try? handle.read(upToCount: Self.chunk)) ?? Data()
    if data.isEmpty {
      try? handle.close()
      return next(keepAlive)
    }
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      guard let self, error == nil else {
        try? handle.close()
        self?.connection.cancel()
        return
      }
      self.stream(handle, keepAlive: keepAlive)
    })
  }

  private func next(_ keepAlive: Bool) {
    if keepAlive {
      readRequest()
    } else {
      connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
        self?.connection.cancel()
      })
    }
  }

  private func sendHeader(_ status: Int, _ reason: String, type: String, length: Int, keepAlive: Bool) {
    let head = "HTTP/1.1 \(status) \(reason)\r\n"
      + "Content-Type: \(type)\r\n"
      + "Content-Length: \(length)\r\n"
      + "Cache-Control: no-cache, no-store\r\n"
      + "Connection: \(keepAlive ? "keep-alive" : "close")\r\n\r\n"
    connection.send(content: Data(head.utf8), completion: .contentProcessed { _ in })
  }

  private func send(_ status: Int, _ reason: String, type: String = "text/plain", body: Data? = nil, head: Bool = false, keepAlive: Bool = false) {
    let content = body ?? Data(reason.utf8)
    sendHeader(status, reason, type: type, length: content.count, keepAlive: keepAlive)
    if !head { connection.send(content: content, completion: .contentProcessed { _ in }) }
    next(keepAlive)
  }
}
