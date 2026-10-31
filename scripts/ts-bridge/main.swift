// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Tests for the pure TS bridge code (modules/zoggyfin-native/ios/TsSegmenter.swift).
// run.sh compiles both files into one program. Synthetic streams always run;
// with arguments `<fixtures dir> <output dir>` the ffmpeg fixtures run too and
// their segments are written for the ffprobe checks in run.sh.

import Foundation

var failures = 0
var passed = 0

func check(_ ok: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
  if ok {
    passed += 1
  } else {
    failures += 1
    print("FAIL \(name) \(detail())")
  }
}

// MARK: Synthetic stream builder

struct TsWriter {
  var bytes: [UInt8] = []
  var cc: [Int: Int] = [:]

  mutating func packet(pid: Int, pusi: Bool, payload: [UInt8], rai: Bool = false, pcr: UInt64? = nil) -> [UInt8] {
    var p: [UInt8] = [0x47, UInt8((pusi ? 0x40 : 0) | (pid >> 8)), UInt8(pid & 0xFF), 0]
    let c = cc[pid, default: 0]
    cc[pid] = (c + 1) & 0x0F
    var fields: [UInt8] = []
    if rai || pcr != nil {
      fields = [rai ? 0x40 : 0]
      if let pcr {
        fields[0] |= 0x10
        fields += [UInt8((pcr >> 25) & 0xFF), UInt8((pcr >> 17) & 0xFF), UInt8((pcr >> 9) & 0xFF), UInt8((pcr >> 1) & 0xFF), UInt8(((pcr & 1) << 7) | 0x7E), 0]
      }
    }
    if fields.isEmpty, payload.count >= 184 {
      p[3] = 0x10 | UInt8(c)
      return p + payload.prefix(184)
    }
    let chunk = Array(payload.prefix(183 - fields.count))
    let afLen = 183 - chunk.count
    if afLen > 0, fields.isEmpty { fields = [0x00] }
    p[3] = 0x30 | UInt8(c)
    p.append(UInt8(afLen))
    p += fields + [UInt8](repeating: 0xFF, count: afLen - fields.count)
    p += chunk
    precondition(p.count == 188, "packet size \(p.count)")
    return p
  }

  /// Writes a PES over as many packets as it needs.
  mutating func pes(pid: Int, streamId: UInt8, pts: UInt64, es: [UInt8], rai: Bool = false, pcr: UInt64? = nil) {
    let p = pts & TsClock.mask
    let ptsBytes: [UInt8] = [
      UInt8(0x21 | ((p >> 29) & 0x0E)), UInt8((p >> 22) & 0xFF), UInt8(((p >> 14) & 0xFE) | 1), UInt8((p >> 7) & 0xFF), UInt8(((p << 1) & 0xFE) | 1),
    ]
    var data: [UInt8] = [0, 0, 1, streamId, 0, 0, 0x80, 0x80, 5] + ptsBytes + es
    var first = true
    while !data.isEmpty {
      let pk = packet(pid: pid, pusi: first, payload: data, rai: first && rai, pcr: first ? pcr : nil)
      data.removeFirst(min(data.count, payloadCount(pk)))
      bytes += pk
      first = false
    }
  }

  func payloadCount(_ p: [UInt8]) -> Int {
    let afc = (p[3] >> 4) & 3
    return afc & 2 != 0 ? 188 - 5 - Int(p[4]) : 184
  }

  mutating func section(pid: Int, _ body: [UInt8]) {
    let crc = TsParse.crc32(body[...])
    let s = body + [UInt8(crc >> 24), UInt8((crc >> 16) & 0xFF), UInt8((crc >> 8) & 0xFF), UInt8(crc & 0xFF)]
    bytes += packet(pid: pid, pusi: true, payload: [0] + s + [UInt8](repeating: 0xFF, count: 183 - s.count))
  }

  mutating func pat(pmtPid: Int) {
    let body: [UInt8] = [0x00, 0xB0, 13, 0, 1, 0xC1, 0, 0, 0, 1, UInt8(0xE0 | (pmtPid >> 8)), UInt8(pmtPid & 0xFF)]
    section(pid: 0, body)
  }

  /// streams: (stream_type, pid, descriptors)
  mutating func pmt(pid: Int, pcrPid: Int, streams: [(UInt8, Int, [UInt8])]) {
    var es: [UInt8] = []
    for (t, p, d) in streams {
      es += [t, UInt8(0xE0 | (p >> 8)), UInt8(p & 0xFF), UInt8(0xF0 | (d.count >> 8)), UInt8(d.count & 0xFF)] + d
    }
    let len = 9 + es.count + 4
    let body: [UInt8] = [0x02, UInt8(0xB0 | (len >> 8)), UInt8(len & 0xFF), 0, 1, 0xC1, 0, 0, UInt8(0xE0 | (pcrPid >> 8)), UInt8(pcrPid & 0xFF), 0xF0, 0] + es
    section(pid: pid, body)
  }
}

let h264Idr: [UInt8] = [0, 0, 0, 1, 0x09, 0xF0, 0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x68, 0xCE, 0, 0, 0, 1, 0x65] + [UInt8](repeating: 0xAB, count: 300)
let h264P: [UInt8] = [0, 0, 0, 1, 0x09, 0xF0, 0, 0, 0, 1, 0x41] + [UInt8](repeating: 0xCD, count: 200)

/// A stream at 25 fps with a key frame every `gop` frames, and AAC audio.
func synthetic(seconds: Double, gop: Int, rai: Bool, startPts: UInt64 = 900_000, audio: Bool = true, video: Bool = true, jumpAt: Int? = nil) -> [UInt8] {
  var w = TsWriter()
  let frames = Int(seconds * 25)
  var pts = startPts
  for f in 0..<frames {
    if f % 25 == 0 {
      w.pat(pmtPid: 0x1000)
      var streams: [(UInt8, Int, [UInt8])] = []
      if video { streams.append((0x1B, 0x100, [])) }
      if audio { streams.append((0x0F, 0x101, [])) }
      streams.append((0x06, 0x102, [0x56, 0x05, 0x65, 0x6E, 0x67, 0x09, 0x00])) // teletext: ignored
      w.pmt(pid: 0x1000, pcrPid: video ? 0x100 : 0x101, streams: streams)
    }
    if f == jumpAt { pts &+= 90_000 * 100 }
    let key = f % gop == 0
    if video {
      w.pes(pid: 0x100, streamId: 0xE0, pts: pts, es: key ? h264Idr : h264P, rai: rai && key, pcr: pts &- 9000)
    }
    if audio {
      w.pes(pid: 0x101, streamId: 0xC0, pts: pts, es: [0xFF, 0xF1] + [UInt8](repeating: 0x11, count: 150))
    }
    pts &+= 3600
  }
  return w.bytes
}

final class MemorySink: TsSegmentSink {
  var segments: [TsSegment] = []
  var data: [Int: [UInt8]] = [:]
  var current: Int?
  var dir: URL?

  func segmentDidBegin(_ sequence: Int) {
    current = sequence
    data[sequence] = []
  }

  func segmentDidAppend(_ bytes: [UInt8]) {
    guard let current else { return }
    data[current, default: []] += bytes
  }

  func segmentDidEnd(_ segment: TsSegment) {
    segments.append(segment)
    if let dir, let bytes = data[segment.sequence] {
      try? Data(bytes).write(to: dir.appendingPathComponent("seg-\(segment.sequence).ts"))
    }
  }
}

/// Feeds the stream in uneven chunks.
@discardableResult
func run(_ bytes: [UInt8], config: TsSegmenter.Config = .init(), chunks: [Int] = [1000, 7, 4096, 333, 188, 65536], finish: Bool = true, sink: MemorySink = MemorySink()) -> (MemorySink, Error?) {
  let seg = TsSegmenter(config: config, sink: sink)
  var i = 0
  var k = 0
  do {
    while i < bytes.count {
      let n = min(chunks[k % chunks.count], bytes.count - i)
      try seg.feed(Data(bytes[i..<(i + n)]))
      i += n
      k += 1
    }
  } catch {
    return (sink, error)
  }
  if finish { seg.finish() }
  return (sink, nil)
}

func approx(_ a: Double, _ b: Double, _ tol: Double = 0.01) -> Bool { abs(a - b) <= tol }

// MARK: Unit tests

check(TsClock.delta(from: TsClock.mask - 100, to: 50) == 151, "clock wraps forward")
check(TsClock.delta(from: 50, to: TsClock.mask - 100) == -151, "clock wraps back")

do {
  var w = TsWriter()
  let pk = w.packet(pid: 0x100, pusi: true, payload: [1, 2, 3], rai: true, pcr: 123_456_789)
  let h = TsParse.header(pk[...])
  check(h?.pid == 0x100 && h?.payloadStart == true && h?.randomAccess == true, "header fields", "\(String(describing: h))")
  check(h?.pcr == 123_456_789, "header PCR", "\(String(describing: h?.pcr))")
  check(h.flatMap { $0.payloadOffset.map { pk[$0] } } == 1, "payload offset")
  check(TsParse.header([UInt8](repeating: 0, count: 188)[...]) == nil, "no sync byte")
}

do {
  var w = TsWriter()
  w.pat(pmtPid: 0x1000)
  let payload = Array(w.bytes[5...])
  let len = 3 + Int(payload[2])
  check(TsParse.pat(Array(payload[0..<len])) == 0x1000, "PAT program map PID")
  var bad = Array(payload[0..<len])
  bad[9] ^= 0x01
  check(TsParse.pat(bad) == nil, "PAT with a bad CRC is refused")
}

do {
  var w = TsWriter()
  w.pmt(pid: 0x1000, pcrPid: 0x100, streams: [(0x1B, 0x100, []), (0x0F, 0x101, []), (0x06, 0x103, [0x6A, 0x01, 0x00]), (0x06, 0x102, [0x56, 0x00])])
  let payload = Array(w.bytes[5...])
  let len = 3 + ((Int(payload[1] & 0x0F) << 8) | Int(payload[2]))
  let p = TsParse.pmt(Array(payload[0..<len]), pid: 0x1000)
  check(p?.videoPid == 0x100 && p?.videoKind == .h264, "PMT video", "\(String(describing: p))")
  check(p?.audioPids == [0x101, 0x103], "PMT audio: AAC and AC-3 descriptor, no teletext", "\(String(describing: p?.audioPids))")
  check(p?.pcrPid == 0x100, "PMT PCR PID")
  check(TsParse.kind(streamType: 0x24, descriptors: []) == .hevc, "HEVC stream type")
}

do {
  var w = TsWriter()
  w.pes(pid: 0x100, streamId: 0xE0, pts: 8_589_934_000, es: [1, 2, 3])
  let h = TsParse.header(w.bytes[0..<188])!
  check(TsParse.pts(w.bytes[h.payloadOffset!..<188]) == 8_589_934_000, "PES PTS (33 bits)")
  check(TsParse.pesPayloadOffset(w.bytes[h.payloadOffset!..<188]) == 14, "PES payload offset")
}

check(TsParse.scanKey(h264Idr, kind: .h264) == .key, "H.264 IDR is key")
check(TsParse.scanKey(h264P, kind: .h264) == .notKey, "H.264 P slice is not key")
check(TsParse.scanKey([0, 0, 0, 1, 0x09, 0xF0, 0, 0, 1, 0x67], kind: .h264) == .unknown, "H.264 SPS only: unknown")
check(TsParse.scanKey([0, 0, 0, 1, 0x40, 0x01, 0, 0, 1, 0x26, 0x01], kind: .hevc) == .key, "HEVC IDR_W_RADL is key")
check(TsParse.scanKey([0, 0, 1, 0x02, 0x01], kind: .hevc) == .notKey, "HEVC TRAIL_R is not key")
check(TsParse.scanKey([0, 0, 1, 0xB3, 0x10], kind: .mpegVideo) == .key, "MPEG-2 sequence header is key")

// MARK: Segmenter on synthetic streams

do {
  let (sink, err) = run(synthetic(seconds: 10, gop: 25, rai: true))
  check(err == nil, "RAI stream: no error", "\(String(describing: err))")
  let d = sink.segments.map(\.duration)
  check(sink.segments.count == 5, "RAI stream: 5 segments of 2 s", "\(d)")
  check(d.allSatisfy { approx($0, 2) }, "RAI stream: durations 2 s", "\(d)")
  check(sink.segments.map(\.sequence) == Array(0..<sink.segments.count), "sequences count up")
  check(!sink.segments.contains(where: \.discontinuity), "no discontinuity")
  for s in sink.segments {
    let b = sink.data[s.sequence] ?? []
    check(b.count % 188 == 0 && b.count == s.bytes, "segment \(s.sequence) is whole packets", "\(b.count) vs \(s.bytes)")
    let pids = stride(from: 0, to: min(b.count, 376), by: 188).compactMap { TsParse.header(b[$0..<($0 + 188)])?.pid }
    check(pids == [0, 0x1000], "segment \(s.sequence) starts with PAT and PMT", "\(pids)")
    // The first video packet after PAT/PMT starts a key frame.
    var first: TsPacketHeader?
    var off = 0
    while off + 188 <= b.count {
      if let h = TsParse.header(b[off..<(off + 188)]), h.pid == 0x100 { first = h; break }
      off += 188
    }
    check(first?.payloadStart == true && first?.randomAccess == true, "segment \(s.sequence) starts at a key frame")
  }
}

do {
  let (sink, _) = run(synthetic(seconds: 10, gop: 25, rai: false))
  let d = sink.segments.map(\.duration)
  check(sink.segments.count == 5 && d.allSatisfy { approx($0, 2) }, "no RAI: cuts by IDR NAL scan", "\(d)")
}

do {
  // A GOP of 1.2 s with a 2 s target: cuts at 2.4 s.
  let (sink, _) = run(synthetic(seconds: 12, gop: 30, rai: true))
  let d = sink.segments.map(\.duration)
  check(d.dropLast().allSatisfy { approx($0, 2.4) }, "cuts at the first key frame after the target", "\(d)")
  check(approx(d.reduce(0, +), 12), "durations add up to the stream length", "\(d.reduce(0, +))")
}

do {
  // Key frames every 20 s: forced cuts at maxDuration (10 s by default, here 3 s).
  var c = TsSegmenter.Config()
  c.maxDuration = 3
  let (sink, _) = run(synthetic(seconds: 12, gop: 500, rai: true), config: c)
  let d = sink.segments.map(\.duration)
  check(sink.segments.count == 4 && d.allSatisfy { approx($0, 3) }, "forced cut at maxDuration", "\(d)")
}

do {
  // Garbage, a broken packet and a misaligned start.
  var bytes: [UInt8] = [0x47, 1, 2, 3, 0x47, 9, 9] + [UInt8](repeating: 0x55, count: 1000)
  let body = synthetic(seconds: 6, gop: 25, rai: true)
  bytes += body[50...]  // starts mid-packet
  var cut = bytes
  cut.insert(contentsOf: [0x47, 0x47, 0x00], at: 188 * 300 + 1057)  // a few stray bytes mid-stream
  let (sink, err) = run(cut)
  check(err == nil, "resync: no error", "\(String(describing: err))")
  check(sink.segments.count >= 2, "resync: segments after junk", "\(sink.segments.count)")
  for s in sink.segments { check((sink.data[s.sequence] ?? []).count % 188 == 0, "resync: whole packets") }
}

do {
  let (sink, _) = run(synthetic(seconds: 10, gop: 25, rai: true, startPts: TsClock.mask - 90_000 * 3))
  let d = sink.segments.map(\.duration)
  check(sink.segments.count == 5 && d.allSatisfy { approx($0, 2) }, "PTS wrap inside the stream", "\(d)")
}

do {
  let (sink, _) = run(synthetic(seconds: 10, gop: 25, rai: true, jumpAt: 125))
  check(sink.segments.contains(where: \.discontinuity), "timestamp jump marks a discontinuity")
  check(sink.segments.allSatisfy { $0.duration > 0 && $0.duration < 5 }, "durations stay sane over a jump", "\(sink.segments.map(\.duration))")
}

do {
  let (sink, err) = run(synthetic(seconds: 10, gop: 25, rai: false, video: false))
  let d = sink.segments.map(\.duration)
  check(err == nil && sink.segments.count == 5 && d.allSatisfy { approx($0, 2) }, "audio only: cut by PTS", "\(d)")
}

do {
  var c = TsSegmenter.Config()
  c.probeBytes = 100_000
  let (_, err) = run([UInt8]((0..<300_000).map { UInt8($0 % 251) }), config: c)
  check((err as? TsSegmenterError) == .notTransportStream, "random bytes: not a transport stream", "\(String(describing: err))")
  let (_, err2) = run(synthetic(seconds: 2, gop: 25, rai: true, audio: false, video: false))
  check((err2 as? TsSegmenterError) == .noMedia, "PMT with only teletext: no media", "\(String(describing: err2))")
}

do {
  // A new connection: a discontinuity and segments go on counting.
  let sink = MemorySink()
  let seg = TsSegmenter(sink: sink)
  try? seg.feed(Data(synthetic(seconds: 5, gop: 25, rai: true)))
  seg.restart()
  try? seg.feed(Data(synthetic(seconds: 5, gop: 25, rai: true, startPts: 12_345)))
  seg.finish()
  let firstAfter = sink.segments.first { $0.discontinuity }
  check(firstAfter != nil && firstAfter!.sequence >= 2, "restart: discontinuity on the next segment", "\(sink.segments)")
  check(sink.segments.map(\.sequence) == Array(0..<sink.segments.count), "restart: sequences go on")
}

// MARK: Playlist window

do {
  var w = HlsWindow(size: 3, targetDuration: 2)
  for i in 0..<5 {
    let gone = w.append(TsSegment(sequence: i, duration: i == 1 ? 4.6 : 2.0, discontinuity: i == 1 || i == 4, bytes: 1))
    if i == 3 { check(gone.map(\.sequence) == [0], "window drops the oldest") }
  }
  let text = w.playlist()
  let lines = text.split(separator: "\n").map(String.init)
  check(lines.prefix(3) == ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:5"], "playlist head, target from the longest segment", text)
  check(lines.contains("#EXT-X-MEDIA-SEQUENCE:2"), "media sequence follows the window", text)
  check(lines.contains("#EXT-X-DISCONTINUITY-SEQUENCE:1"), "discontinuity sequence counts dropped discontinuities", text)
  check(lines.filter { $0.hasPrefix("#EXTINF:") } == ["#EXTINF:2.000,", "#EXTINF:2.000,", "#EXTINF:2.000,"], "EXTINF lines", text)
  check(lines.suffix(3) == ["#EXT-X-DISCONTINUITY", "#EXTINF:2.000,", "seg-4.ts"], "discontinuity tag before its segment", text)
  check(!text.contains("ENDLIST"), "no ENDLIST while live")
  w.ended = true
  check(w.playlist().hasSuffix("#EXT-X-ENDLIST\n"), "ENDLIST when the source ended")
  check(w.contains(4) && !w.contains(1), "window contains")
}

// MARK: ffmpeg fixtures

func clearRandomAccess(_ b: [UInt8]) -> [UInt8] {
  var b = b
  var i = 0
  while i + 188 <= b.count {
    if b[i] == 0x47, b[i + 3] & 0x20 != 0, b[i + 4] > 0 { b[i + 5] &= ~0x40 }
    i += 188
  }
  return b
}

let args = CommandLine.arguments
if args.count >= 3 {
  let fixtures = URL(fileURLWithPath: args[1])
  let outRoot = URL(fileURLWithPath: args[2])
  let cases: [(file: String, seconds: Double, video: Bool)] = [
    ("h264-aac.ts", 12, true), ("hevc-aac.ts", 12, true), ("h264-norai.ts", 12, true), ("aac-only.ts", 12, false), ("mpeg2-mp2.ts", 12, true),
  ]
  for c in cases {
    // h264-norai: the H.264 fixture with every random_access_indicator cleared,
    // so the cuts must come from the IDR scan.
    let noRai = c.file == "h264-norai.ts"
    let url = fixtures.appendingPathComponent(noRai ? "h264-aac.ts" : c.file)
    guard var data = try? Data(contentsOf: url) else {
      print("skip \(c.file) (missing)")
      continue
    }
    if noRai { data = Data(clearRandomAccess([UInt8](data))) }
    let dir = outRoot.appendingPathComponent((c.file as NSString).deletingPathExtension)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let sink = MemorySink()
    sink.dir = dir
    let (_, err) = run([UInt8](data), chunks: [1316, 999, 32768, 1], sink: sink)
    let d = sink.segments.map(\.duration)
    check(err == nil, "\(c.file): no error", "\(String(describing: err))")
    check(sink.segments.count >= 4, "\(c.file): segments", "\(d)")
    check(d.dropLast().allSatisfy { $0 >= 1.9 && $0 <= 4.1 }, "\(c.file): durations near the target", "\(d)")
    check(abs(d.reduce(0, +) - c.seconds) < 0.6, "\(c.file): total duration", "\(d.reduce(0, +))")
    var w = HlsWindow(size: 100, targetDuration: 2)
    sink.segments.forEach { w.append($0) }
    w.ended = true
    try? w.playlist().write(to: dir.appendingPathComponent("index.m3u8"), atomically: true, encoding: .utf8)
    print("\(c.file): \(sink.segments.count) segments, \(d.map { String(format: "%.2f", $0) }.joined(separator: " "))")
  }
}

print("\(passed) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
