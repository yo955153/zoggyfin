// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation

// The pure part of the TS bridge (TsBridge.swift): it reads a progressive
// MPEG-TS byte stream, cuts it into short TS segments at video random access
// points and builds the live HLS playlist text. No Network, no URLSession and
// no UIKit, so `pnpm test:ts-bridge-swift` compiles it on macOS with a small
// test main (scripts/ts-bridge/). Pure, so it is unit-tested.

/// A 33-bit MPEG timestamp in 90 kHz units.
enum TsClock {
  static let hz = 90_000.0
  static let mask: UInt64 = (1 << 33) - 1

  /// The signed distance from `a` to `b`, with the 33-bit wrap.
  static func delta(from a: UInt64, to b: UInt64) -> Int64 {
    let d = (b &- a) & mask
    return d >= (1 << 32) ? Int64(d) - Int64(1 << 33) : Int64(d)
  }

  static func seconds(_ ticks: Int64) -> Double { Double(ticks) / hz }
}

/// The header fields of one 188-byte transport packet.
struct TsPacketHeader: Equatable {
  var pid: Int
  var payloadStart: Bool
  var transportError: Bool
  var continuity: Int
  /// The random_access_indicator of the adaptation field.
  var randomAccess: Bool
  /// The PCR base (90 kHz) when the adaptation field has one.
  var pcr: UInt64?
  /// The offset of the payload in the packet, or nil when there is no payload.
  var payloadOffset: Int?
}

enum TsStreamKind: Equatable {
  case h264, hevc, mpegVideo, otherVideo, audio
  var isVideo: Bool { self != .audio }
}

/// The streams of one program, from the PMT.
struct TsProgram: Equatable {
  var pmtPid: Int
  var pcrPid: Int?
  var videoPid: Int?
  var videoKind: TsStreamKind?
  var audioPids: [Int]
}

enum TsParse {
  static let packetSize = 188
  static let sync: UInt8 = 0x47

  /// Parses the 4-byte header and the adaptation field. Nil when the packet is not valid.
  static func header(_ p: ArraySlice<UInt8>) -> TsPacketHeader? {
    let b = p.startIndex
    guard p.count >= packetSize, p[b] == sync else { return nil }
    let pid = (Int(p[b + 1] & 0x1F) << 8) | Int(p[b + 2])
    let afc = (p[b + 3] >> 4) & 0x03
    var h = TsPacketHeader(
      pid: pid,
      payloadStart: p[b + 1] & 0x40 != 0,
      transportError: p[b + 1] & 0x80 != 0,
      continuity: Int(p[b + 3] & 0x0F),
      randomAccess: false,
      pcr: nil,
      payloadOffset: nil
    )
    var offset = 4
    if afc & 0x02 != 0 {
      let len = Int(p[b + 4])
      guard len <= 183 else { return nil }
      if len > 0 {
        let flags = p[b + 5]
        h.randomAccess = flags & 0x40 != 0
        if flags & 0x10 != 0, len >= 7 {
          let x = (b + 6)..<(b + 11)
          let v = x.reduce(UInt64(0)) { ($0 << 8) | UInt64(p[$1]) }
          h.pcr = v >> 7
        }
      }
      offset = 5 + len
    }
    if afc & 0x01 != 0, offset < packetSize {
      h.payloadOffset = offset
    }
    return h
  }

  /// The program map PID of the first program in a PAT section (from table_id on).
  static func pat(_ s: [UInt8]) -> Int? {
    guard s.count >= 12, s[0] == 0x00, crcValid(s) else { return nil }
    let len = (Int(s[1] & 0x0F) << 8) | Int(s[2])
    let end = 3 + len - 4
    var i = 8
    while i + 4 <= end {
      let program = (Int(s[i]) << 8) | Int(s[i + 1])
      let pid = (Int(s[i + 2] & 0x1F) << 8) | Int(s[i + 3])
      if program != 0 { return pid }
      i += 4
    }
    return nil
  }

  /// The streams in a PMT section (from table_id on).
  static func pmt(_ s: [UInt8], pid: Int) -> TsProgram? {
    guard s.count >= 16, s[0] == 0x02, crcValid(s) else { return nil }
    let len = (Int(s[1] & 0x0F) << 8) | Int(s[2])
    let end = 3 + len - 4
    let pcrPid = (Int(s[8] & 0x1F) << 8) | Int(s[9])
    let infoLen = (Int(s[10] & 0x0F) << 8) | Int(s[11])
    var program = TsProgram(pmtPid: pid, pcrPid: pcrPid == 0x1FFF ? nil : pcrPid, videoPid: nil, videoKind: nil, audioPids: [])
    var i = 12 + infoLen
    while i + 5 <= end {
      let type = s[i]
      let esPid = (Int(s[i + 1] & 0x1F) << 8) | Int(s[i + 2])
      let esLen = (Int(s[i + 3] & 0x0F) << 8) | Int(s[i + 4])
      let descriptors = Array(s[min(i + 5, end)..<min(i + 5 + esLen, end)])
      if let kind = kind(streamType: type, descriptors: descriptors) {
        if kind.isVideo {
          if program.videoPid == nil {
            program.videoPid = esPid
            program.videoKind = kind
          }
        } else {
          program.audioPids.append(esPid)
        }
      }
      i += 5 + esLen
    }
    return program
  }

  /// The stream kind for a PMT stream_type. Private data (0x06) counts as
  /// audio only with an AC-3, E-AC-3 or DTS descriptor; teletext and
  /// subtitles are not media for the cut.
  static func kind(streamType t: UInt8, descriptors: [UInt8]) -> TsStreamKind? {
    switch t {
    case 0x1B: return .h264
    case 0x24: return .hevc
    case 0x01, 0x02: return .mpegVideo
    case 0x10, 0x20, 0x33: return .otherVideo
    case 0x03, 0x04, 0x0F, 0x11, 0x81, 0x87, 0x82, 0x84, 0x85, 0x86, 0x8A: return .audio
    case 0x06:
      var i = 0
      while i + 2 <= descriptors.count {
        if [0x6A, 0x7A, 0x7B, 0x7C].contains(descriptors[i]) { return .audio }
        i += 2 + Int(descriptors[i + 1])
      }
      return nil
    default: return nil
    }
  }

  /// The PTS of a PES header (the payload of a payload-start packet), or nil.
  static func pts(_ pes: ArraySlice<UInt8>) -> UInt64? {
    let b = pes.startIndex
    guard pes.count >= 14, pes[b] == 0, pes[b + 1] == 0, pes[b + 2] == 1 else { return nil }
    guard pes[b + 7] & 0x80 != 0, pes[b + 9] & 0x20 != 0 else { return nil }
    let p = (b + 9)..<(b + 14)
    let x = p.map { UInt64(pes[$0]) }
    return ((x[0] >> 1) & 0x07) << 30 | x[1] << 22 | (x[2] >> 1) << 15 | x[3] << 7 | x[4] >> 1
  }

  /// The offset of the elementary stream data in a PES packet, or nil.
  static func pesPayloadOffset(_ pes: ArraySlice<UInt8>) -> Int? {
    let b = pes.startIndex
    guard pes.count >= 9, pes[b] == 0, pes[b + 1] == 0, pes[b + 2] == 1 else { return nil }
    let off = 9 + Int(pes[b + 8])
    return off <= pes.count ? off : nil
  }

  enum KeyScan: Equatable {
    /// The access unit starts with a random access picture.
    case key
    /// The first picture is not a random access picture.
    case notKey
    /// No picture yet: more data is needed.
    case unknown
  }

  /// Looks for a random access picture in the start of a video access unit
  /// (elementary stream bytes). H.264: an IDR slice (5), or a slice (1) for
  /// "not key". HEVC: an IRAP picture (16 to 21), or another slice (0 to 9).
  /// MPEG-2: a sequence header (B3) or a GOP header (B8) before the picture.
  static func scanKey(_ es: [UInt8], kind: TsStreamKind) -> KeyScan {
    var i = 0
    while i + 3 < es.count {
      guard es[i] == 0, es[i + 1] == 0, es[i + 2] == 1 else {
        i += 1
        continue
      }
      let h = es[i + 3]
      switch kind {
      case .h264:
        let type = h & 0x1F
        if type == 5 { return .key }
        if type == 1 { return .notKey }
      case .hevc:
        let type = (h >> 1) & 0x3F
        if (16...21).contains(type) { return .key }
        if type <= 9 { return .notKey }
      case .mpegVideo:
        if h == 0xB3 || h == 0xB8 { return .key }
        if h == 0x00 { return .notKey }
      case .otherVideo, .audio:
        return .notKey
      }
      i += 3
    }
    return .unknown
  }

  /// A section is valid when the CRC-32/MPEG-2 over all of it (CRC included) is 0.
  static func crcValid(_ s: [UInt8]) -> Bool {
    let len = 3 + ((Int(s[1] & 0x0F) << 8) | Int(s[2]))
    guard len <= s.count, len >= 4 else { return false }
    return crc32(s[0..<len]) == 0
  }

  static func crc32(_ bytes: ArraySlice<UInt8>) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in bytes {
      crc ^= UInt32(byte) << 24
      for _ in 0..<8 {
        crc = crc & 0x8000_0000 != 0 ? (crc << 1) ^ 0x04C1_1DB7 : crc << 1
      }
    }
    return crc
  }
}

/// A finished segment.
struct TsSegment: Equatable {
  var sequence: Int
  var duration: Double
  /// The segment follows a timestamp jump or a new upstream connection.
  var discontinuity: Bool
  var bytes: Int
}

/// Receives the segment files. Bytes always go to the segment that began last.
protocol TsSegmentSink: AnyObject {
  func segmentDidBegin(_ sequence: Int)
  func segmentDidAppend(_ bytes: [UInt8])
  func segmentDidEnd(_ segment: TsSegment)
}

enum TsSegmenterError: Error, Equatable {
  /// No PAT and PMT in the first bytes: the source is not MPEG-TS.
  case notTransportStream
  /// The PMT has no video and no audio stream.
  case noMedia
}

/// Cuts a progressive MPEG-TS stream into segments.
///
/// Rules:
/// - Packets resync on 0x47: a sync byte counts only when the byte 188 later
///   is a sync byte too (until the stream is in sync).
/// - The first segment starts at the first video random access point. Packets
///   before it are dropped, so every segment can start playback.
/// - A new segment starts at a video random access point once
///   `targetDuration` has passed. A random access point is a payload-start
///   packet with the random_access_indicator, or (when the muxer does not set
///   it) an access unit whose first picture is IDR / IRAP / has a sequence header.
/// - With no random access point for `maxDuration`, the segment is cut at the
///   next video payload start anyway, so segments stay short.
/// - Audio-only streams cut at an audio payload start by PTS.
/// - Durations come from PTS (PCR when a PES has none). A timestamp jump ends
///   the segment and marks the next one as a discontinuity.
/// - Every segment starts with the latest PAT and PMT packets.
final class TsSegmenter {
  struct Config {
    var targetDuration = 2.0
    var maxDuration = 10.0
    /// Bytes to read before the source must have shown a PAT and a PMT.
    var probeBytes = 4 * 1024 * 1024
  }

  let config: Config
  private weak var sink: TsSegmentSink?

  private(set) var program: TsProgram?
  private(set) var nextSequence = 0
  private var carry: [UInt8] = []
  private var inSync = false
  private var bytesSeen = 0

  private var patPid: Int?
  private var sections: [Int: (bytes: [UInt8], packets: [UInt8])] = [:]
  private var patPackets: [UInt8] = []
  private var pmtPackets: [UInt8] = []

  /// The open segment: its sequence, start time and the latest time seen.
  private var open: (sequence: Int, start: UInt64, last: UInt64, bytes: Int, discontinuity: Bool)?
  private var markDiscontinuity = false
  private var lastPcr: UInt64?
  private var frameTicks: Int64 = 3600

  /// A cut that waits for the video picture type: packets held back, the
  /// start of the access unit and its time.
  private var pending: (packets: [UInt8], es: [UInt8], time: UInt64, count: Int)?
  private static let pendingLimit = 96

  private var out: [UInt8] = []

  init(config: Config = Config(), sink: TsSegmentSink) {
    self.config = config
    self.sink = sink
    out.reserveCapacity(64 * 1024)
  }

  /// Feeds bytes from the source in any chunk size.
  func feed(_ data: Data) throws {
    carry.append(contentsOf: data)
    bytesSeen += data.count
    var i = 0
    let size = TsParse.packetSize
    while carry.count - i >= size {
      if carry[i] == TsParse.sync {
        if !inSync {
          if carry.count - i < 2 * size { break }
          if carry[i + size] != TsParse.sync {
            i += 1
            continue
          }
        }
        inSync = true
        try packet(carry[i..<(i + size)])
        i += size
      } else {
        inSync = false
        i += 1
      }
    }
    carry.removeFirst(i)
    if !hasProgram, bytesSeen > config.probeBytes {
      throw TsSegmenterError.notTransportStream
    }
    flush()
  }

  /// The source ended: closes the open segment.
  func finish() {
    resolvePending(key: false)
    closeSegment(at: nil)
    flush()
  }

  /// A new connection to the source: the parser starts again and the next
  /// segment is a discontinuity. The open segment ends first.
  func restart() {
    finish()
    carry.removeAll()
    inSync = false
    sections.removeAll()
    program = nil
    patPid = nil
    patPackets = []
    pmtPackets = []
    lastPcr = nil
    markDiscontinuity = true
    bytesSeen = 0
  }

  // MARK: Packets

  private func packet(_ p: ArraySlice<UInt8>) throws {
    guard let h = TsParse.header(p) else { return }
    if h.transportError {
      write(p)
      return
    }
    if let pcr = h.pcr, h.pid == program?.pcrPid { lastPcr = pcr }

    if h.pid == 0 || h.pid == program?.pmtPid {
      try section(p, header: h)
      write(p)
      return
    }
    guard let program else { return }

    let isVideo = h.pid == program.videoPid
    let cutsOnAudio = program.videoPid == nil && h.pid == program.audioPids.first
    if h.payloadStart, isVideo || cutsOnAudio, let off = h.payloadOffset {
      let pes = p[(p.startIndex + off)...]
      if pending != nil { resolvePending(key: false) }
      if let time = TsParse.pts(pes) ?? lastPcr {
        try accessUnit(p, header: h, pes: pes, time: time, video: isVideo)
        return
      }
    }
    if pending != nil {
      hold(p, header: h, video: isVideo)
      return
    }
    write(p)
  }

  /// A payload-start packet of the stream that drives the cuts.
  private func accessUnit(_ p: ArraySlice<UInt8>, header h: TsPacketHeader, pes: ArraySlice<UInt8>, time: UInt64, video: Bool) throws {
    guard let seg = open else {
      // Waiting for the first random access point.
      if !video || h.randomAccess {
        startSegment(at: time)
        write(p)
      } else {
        beginPending(p, pes: pes, time: time)
      }
      return
    }

    let elapsed = TsClock.delta(from: seg.start, to: time)
    let jump = elapsed < -Int64(TsClock.hz) || elapsed > Int64(config.maxDuration * 3 * TsClock.hz)
    if jump {
      markDiscontinuity = true
      closeSegment(at: nil)
      if !video || h.randomAccess {
        startSegment(at: time)
        write(p)
      } else {
        beginPending(p, pes: pes, time: time)
      }
      return
    }

    let step = TsClock.delta(from: seg.last, to: time)
    if step > 0, step < Int64(TsClock.hz) { frameTicks = step }
    if TsClock.delta(from: seg.last, to: time) > 0 { open?.last = time }

    let due = TsClock.seconds(elapsed) >= config.targetDuration
    let forced = TsClock.seconds(elapsed) >= config.maxDuration
    if !due {
      write(p)
    } else if !video || h.randomAccess || forced {
      closeSegment(at: time)
      startSegment(at: time)
      write(p)
    } else {
      beginPending(p, pes: pes, time: time)
    }
  }

  private func beginPending(_ p: ArraySlice<UInt8>, pes: ArraySlice<UInt8>, time: UInt64) {
    let es = TsParse.pesPayloadOffset(pes).map { Array(pes[(pes.startIndex + $0)...]) } ?? []
    pending = (Array(p), es, time, 1)
    decidePending()
  }

  private func hold(_ p: ArraySlice<UInt8>, header h: TsPacketHeader, video: Bool) {
    pending?.packets.append(contentsOf: p)
    pending?.count += 1
    if video, let off = h.payloadOffset {
      pending?.es.append(contentsOf: p[(p.startIndex + off)...])
    }
    decidePending()
  }

  private func decidePending() {
    guard let pend = pending, let kind = program?.videoKind else { return }
    switch TsParse.scanKey(pend.es, kind: kind) {
    case .key: resolvePending(key: true)
    case .notKey: resolvePending(key: false)
    case .unknown:
      if pend.count >= Self.pendingLimit { resolvePending(key: false) }
    }
  }

  private func resolvePending(key: Bool) {
    guard let pend = pending else { return }
    pending = nil
    if open == nil {
      // Before the first segment: drop until a random access point.
      guard key else { return }
      startSegment(at: pend.time)
    } else if key {
      closeSegment(at: pend.time)
      startSegment(at: pend.time)
    }
    out.append(contentsOf: pend.packets)
    open?.bytes += pend.packets.count
    if open != nil, TsClock.delta(from: open!.last, to: pend.time) > 0 { open?.last = pend.time }
  }

  // MARK: Sections

  private func section(_ p: ArraySlice<UInt8>, header h: TsPacketHeader) throws {
    guard let off = h.payloadOffset else { return }
    let payload = p[(p.startIndex + off)...]
    if h.payloadStart {
      let pointer = Int(payload[payload.startIndex])
      let start = payload.startIndex + 1 + pointer
      guard start < payload.endIndex else { return }
      sections[h.pid] = (Array(payload[start...]), Array(p))
    } else if var s = sections[h.pid] {
      s.bytes.append(contentsOf: payload)
      s.packets.append(contentsOf: p)
      sections[h.pid] = s
    } else {
      return
    }
    guard let s = sections[h.pid], s.bytes.count >= 3 else { return }
    let len = 3 + ((Int(s.bytes[1] & 0x0F) << 8) | Int(s.bytes[2]))
    guard s.bytes.count >= len else { return }
    sections[h.pid] = nil
    let bytes = Array(s.bytes[0..<len])

    if h.pid == 0 {
      guard let pmtPid = TsParse.pat(bytes) else { return }
      patPackets = s.packets
      if pmtPid != patPid {
        patPid = pmtPid
        if program?.pmtPid != pmtPid { program = TsProgram(pmtPid: pmtPid, pcrPid: nil, videoPid: nil, videoKind: nil, audioPids: []) }
      }
    } else if let parsed = TsParse.pmt(bytes, pid: h.pid) {
      guard parsed.videoPid != nil || !parsed.audioPids.isEmpty else { throw TsSegmenterError.noMedia }
      if program?.videoPid != nil, program?.videoPid != parsed.videoPid { markDiscontinuity = true }
      program = parsed
      pmtPackets = s.packets
    }
  }

  /// True once a PMT with media was read.
  var hasProgram: Bool { program?.videoPid != nil || !(program?.audioPids.isEmpty ?? true) }

  // MARK: Segments

  private func startSegment(at time: UInt64) {
    let seq = nextSequence
    nextSequence += 1
    flush()
    sink?.segmentDidBegin(seq)
    open = (seq, time, time, 0, markDiscontinuity)
    markDiscontinuity = false
    out.append(contentsOf: patPackets)
    out.append(contentsOf: pmtPackets)
    open?.bytes += patPackets.count + pmtPackets.count
  }

  /// Ends the open segment. `time` is the start of the next one; nil means the
  /// latest time seen plus one frame.
  private func closeSegment(at time: UInt64?) {
    guard let seg = open else { return }
    flush()
    open = nil
    var ticks: Int64
    if let time {
      ticks = TsClock.delta(from: seg.start, to: time)
    } else {
      ticks = TsClock.delta(from: seg.start, to: seg.last) + frameTicks
    }
    if ticks <= 0 { ticks = frameTicks }
    sink?.segmentDidEnd(TsSegment(sequence: seg.sequence, duration: TsClock.seconds(ticks), discontinuity: seg.discontinuity, bytes: seg.bytes))
  }

  private func write(_ p: ArraySlice<UInt8>) {
    guard open != nil else { return }
    out.append(contentsOf: p)
    open?.bytes += p.count
    if out.count >= 64 * 1024 { flush() }
  }

  private func flush() {
    guard !out.isEmpty else { return }
    if open != nil { sink?.segmentDidAppend(out) }
    out.removeAll(keepingCapacity: true)
  }
}

/// The sliding window of a live playlist and its text.
struct HlsWindow {
  var size: Int
  private(set) var segments: [TsSegment] = []
  /// The number of discontinuities that left the window.
  private(set) var discontinuitySequence = 0
  /// Never goes down: a live playlist must not lower EXT-X-TARGETDURATION.
  private(set) var targetDuration: Int
  var ended = false

  init(size: Int, targetDuration: Double) {
    self.size = max(2, size)
    self.targetDuration = max(1, Int(targetDuration.rounded(.up)))
  }

  /// Adds a segment and returns the segments that left the window.
  @discardableResult
  mutating func append(_ segment: TsSegment) -> [TsSegment] {
    segments.append(segment)
    targetDuration = max(targetDuration, Int(segment.duration.rounded()))
    guard segments.count > size else { return [] }
    let gone = Array(segments.prefix(segments.count - size))
    segments.removeFirst(gone.count)
    discontinuitySequence += gone.filter(\.discontinuity).count
    return gone
  }

  func contains(_ sequence: Int) -> Bool {
    segments.contains { $0.sequence == sequence }
  }

  func playlist(uri: (Int) -> String = { "seg-\($0).ts" }) -> String {
    var lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:\(targetDuration)",
      "#EXT-X-MEDIA-SEQUENCE:\(segments.first?.sequence ?? 0)",
    ]
    if discontinuitySequence > 0 { lines.append("#EXT-X-DISCONTINUITY-SEQUENCE:\(discontinuitySequence)") }
    for s in segments {
      if s.discontinuity { lines.append("#EXT-X-DISCONTINUITY") }
      lines.append("#EXTINF:\(String(format: "%.3f", s.duration)),")
      lines.append(uri(s.sequence))
    }
    if ended { lines.append("#EXT-X-ENDLIST") }
    return lines.joined(separator: "\n") + "\n"
  }
}
