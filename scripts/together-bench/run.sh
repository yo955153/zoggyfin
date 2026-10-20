#!/usr/bin/env bash
# Runs the nearby "Watch together" benchmark on loopback (see bench.ts).
# Makes a 200 MB test file in the temp folder and deletes it at the end.
# Usage: bash scripts/together-bench/run.sh [--quick] [--n 1,4,8,16,32] [--steady 20] [--bitrate 8]
set -euo pipefail
cd "$(dirname "$0")/../.."
work="$(mktemp -d "${TMPDIR:-/tmp}/zgf-bench.XXXXXX")"
trap 'rm -rf "$work"' EXIT
# Random bytes: the players are simulated, so only the size and the byte offsets matter.
head -c $((200 * 1024 * 1024)) /dev/urandom > "$work/media.mp4"
export BENCH_FILE="$work/media.mp4"
# macOS: the app's own Swift media server, headless (skipped when swiftc is missing).
if command -v swiftc >/dev/null 2>&1; then
  swiftc -O -module-cache-path "$work/cache" \
    modules/zoggyfin-native/ios/NearbyEvents.swift modules/zoggyfin-native/ios/NearbyCore.swift \
    modules/zoggyfin-native/ios/MediaServer.swift scripts/together-bench/swift-host/main.swift \
    -o "$work/swift-host"
  export BENCH_SWIFT_HOST="$work/swift-host"
fi
out="${BENCH_OUT:-scripts/together-bench/results.json}"
export BENCH_OUT="$out"
pnpm dlx tsx@4.20.5 --tsconfig scripts/together-bench/tsconfig.json scripts/together-bench/bench.ts "$@"
