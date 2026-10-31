#!/usr/bin/env bash
# Compiles the pure TS bridge code (TsSegmenter.swift) with a small test main
# and runs it. With ffmpeg and ffprobe installed it also makes short test
# streams (H.264, HEVC, MPEG-2, audio only), segments them and checks every
# segment with ffprobe. Nothing is written to the repository.
# Usage: bash scripts/ts-bridge/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
swiftc -O -module-cache-path "$out/cache" \
  modules/zoggyfin-native/ios/TsSegmenter.swift scripts/ts-bridge/main.swift \
  -o "$out/ts-bridge-tests"

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  echo "ffmpeg not found: synthetic tests only"
  "$out/ts-bridge-tests"
  exit 0
fi

fx="$out/fixtures"
mkdir -p "$fx"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
src=(-f lavfi -i "testsrc=size=320x180:rate=25:duration=12" -f lavfi -i "sine=frequency=440:duration=12")
ff "${src[@]}" -c:v libx264 -g 50 -keyint_min 50 -sc_threshold 0 -bf 2 -c:a aac -b:a 64k -f mpegts "$fx/h264-aac.ts"
ff "${src[@]}" -c:v libx265 -x265-params "keyint=50:min-keyint=50:scenecut=0:log-level=error" -c:a aac -b:a 64k -f mpegts "$fx/hevc-aac.ts"
ff "${src[@]}" -c:v mpeg2video -g 50 -c:a mp2 -f mpegts "$fx/mpeg2-mp2.ts"
ff -f lavfi -i "sine=frequency=440:duration=12" -c:a aac -b:a 64k -f mpegts "$fx/aac-only.ts"

"$out/ts-bridge-tests" "$fx" "$out/segments"

fail=0
checked=0
for dir in "$out"/segments/*/; do
  name="$(basename "$dir")"
  for seg in "$dir"seg-*.ts; do
    checked=$((checked + 1))
    errors="$(ffmpeg -v error -i "$seg" -f null - 2>&1 || true)"
    if [ -n "$errors" ]; then echo "FAIL $name/$(basename "$seg"): $errors"; fail=1; fi
    if [ "$name" != "aac-only" ]; then
      key="$(ffprobe -v error -select_streams v:0 -read_intervals "%+#1" -show_entries frame=key_frame -of csv=p=0 "$seg" | head -1 | cut -d, -f1)"
      if [ "$key" != "1" ]; then echo "FAIL $name/$(basename "$seg"): first video frame is not a key frame ($key)"; fail=1; fi
    fi
  done
  total="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$dir/index.m3u8")"
  echo "$name: playlist duration $total s"
  if ! awk -v t="$total" 'BEGIN { exit !(t > 11.0 && t < 13.0) }'; then echo "FAIL $name: playlist duration"; fail=1; fi
done
echo "ffprobe: $checked segments checked"
exit $fail
