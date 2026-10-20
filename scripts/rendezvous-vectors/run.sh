#!/usr/bin/env bash
# Compiles the CryptoKit rendezvous code with a small test main and checks the
# JS test vectors. macOS only (CryptoKit). Usage: bash scripts/rendezvous-vectors/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
swiftc -O -module-cache-path "$out/cache" \
  modules/zoggyfin-native/ios/RendezvousCrypto.swift scripts/rendezvous-vectors/main.swift \
  -o "$out/rendezvous-vectors"
"$out/rendezvous-vectors" src/together/__tests__/rendezvous-vectors.json
