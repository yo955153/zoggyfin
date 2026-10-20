// A headless host for the media path of the benchmark: the real NearbyCore
// and MediaServer of the app (modules/zoggyfin-native/ios), with no UI.
// Usage: swift-host <file> <url path>
// Prints {"port": N} on stdout. Each "stats" line on stdin prints the CPU
// time, the peak memory and the bytes served. "quit" (or end of stdin) stops it.
// The advert has an empty TXT record, so the app does not show it as a session.

import Darwin
import Foundation

final class QuietSink: NearbyEventSink {
  func emit(_ name: String, _ body: [String: Any]) {}
}

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: swift-host <file> <url path>\n".data(using: .utf8)!)
  exit(2)
}
let sink = QuietSink()
let core = NearbyCore(sink: sink)

func printLine(_ object: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: object)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

core.startServer(name: "zgf-bench-\(getpid())", txt: [:]) { result in
  switch result {
  case .success(let s):
    core.share(urlPath: args[2], filePath: args[1], mimeType: "video/mp4")
    printLine(["port": s.port])
  case .failure(let e):
    FileHandle.standardError.write("server failed: \(e)\n".data(using: .utf8)!)
    exit(1)
  }
}

FileHandle.standardInput.readabilityHandler = { h in
  let data = h.availableData
  if data.isEmpty {
    core.stopAll()
    exit(0)
  }
  for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
    if line == "stats" {
      var u = rusage()
      getrusage(RUSAGE_SELF, &u)
      let cpu = Double(u.ru_utime.tv_sec + u.ru_stime.tv_sec) + Double(u.ru_utime.tv_usec + u.ru_stime.tv_usec) / 1e6
      let s = core.stats()
      // ru_maxrss is in bytes on macOS.
      printLine(["cpuSeconds": cpu, "maxRssMb": Double(u.ru_maxrss) / 1_048_576, "served": s["served"] ?? 0, "requests": s["requests"] ?? 0])
    } else if line == "quit" {
      core.stopAll()
      exit(0)
    }
  }
}

dispatchMain()
