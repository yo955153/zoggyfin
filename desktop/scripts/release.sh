#!/usr/bin/env bash
# Builds the macOS release of the desktop app: LGPL libmpv in the bundle,
# Developer ID signature with the hardened runtime, notarization, and a
# signed, notarized, stapled DMG.
#
#   pnpm desktop:release
#
# Settings (environment, or the notary file):
#   ZOGGYFIN_NOTARY_ENV  a file with APPLE_SIGNING_IDENTITY, APPLE_API_KEY (key id),
#                        APPLE_API_ISSUER and APPLE_API_KEY_PATH (the .p8 file).
#                        Default: ~/.config/zoggyfin-desktop/notary.env. Never commit it.
#   BUILD_DIR            the work folder (libmpv build, cargo target, output).
#                        On a Mac with /Volumes/builds/env.sh, that file sets it.
#   SKIP_NOTARIZE=1      sign only (for a quick local test).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI_DIR="$ROOT/desktop/src-tauri"

if [ -z "${BUILD_DIR:-}" ] && [ -f /Volumes/builds/env.sh ]; then
  # shellcheck disable=SC1091
  source /Volumes/builds/env.sh
  build_dirs zoggyfin-desktop
fi
: "${BUILD_DIR:?Set BUILD_DIR to a work folder with about 10 GB free.}"
export PATH="$HOME/.cargo/bin:$PATH"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$BUILD_DIR/uv-cache}"

NOTARY_ENV="${ZOGGYFIN_NOTARY_ENV:-$HOME/.config/zoggyfin-desktop/notary.env}"
if [ -f "$NOTARY_ENV" ]; then
  # shellcheck disable=SC1090
  source "$NOTARY_ENV"
fi
: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY (a Developer ID Application identity).}"
if [ "${SKIP_NOTARIZE:-}" != 1 ]; then
  : "${APPLE_API_KEY:?Set APPLE_API_KEY (the App Store Connect key id).}"
  : "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER.}"
  : "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH (the .p8 file).}"
fi

log() { printf '\n==> %s\n' "$*"; }

# 1. LGPL libmpv (skips the parts that are already built).
log "libmpv"
LIBMPV_WORK="${LIBMPV_WORK:-$BUILD_DIR/libmpv}" "$ROOT/desktop/scripts/build-libmpv.sh"
PREFIX="${LIBMPV_WORK:-$BUILD_DIR/libmpv}/prefix"

# 2. The web build and the app bundle, linked against the LGPL libmpv.
log "Web build and Tauri bundle"
export CARGO_TARGET_DIR="$BUILD_DIR/cargo-target"
# Panic messages hold source paths: keep the home folder and the checkout path out of the binary.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$ROOT=/zoggyfin --remap-path-prefix=$HOME=/home"
export MPV_LIB_DIR="$PREFIX/lib"
cd "$ROOT"
pnpm expo export --platform web
rm -rf "$CARGO_TARGET_DIR/release/bundle/macos"
pnpm tauri build --bundles app --config desktop/src-tauri/tauri.conf.json
SRC_APP="$CARGO_TARGET_DIR/release/bundle/macos/Zoggyfin.app"
OUT="$BUILD_DIR/release"
rm -rf "$OUT"
mkdir -p "$OUT"
APP="$OUT/Zoggyfin.app"
ditto "$SRC_APP" "$APP"

# 3. libmpv and its dylibs into Contents/Frameworks; licenses into Contents/Resources.
log "Bundle libmpv"
"$ROOT/desktop/scripts/bundle-libmpv.sh" "$APP" "$PREFIX"

# The app goes to other people: no local user name or home folder in any file of the bundle.
log "Privacy check"
if grep -rlaiF -e "$HOME" -e "$(id -un)" "$APP"; then
  echo "The files above contain a local path. Stop." >&2
  exit 1
fi

# 4. Sign: the dylibs first, then the app, with the hardened runtime and a timestamp.
log "Sign with $APPLE_SIGNING_IDENTITY"
while pgrep -f "eas build" >/dev/null; do
  echo "An EAS build runs (it changes the keychain list). Waiting..."
  sleep 30
done
for lib in "$APP"/Contents/Frameworks/*.dylib; do
  codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$lib"
done
codesign --force --timestamp --options runtime \
  --entitlements "$TAURI_DIR/entitlements.plist" \
  --sign "$APPLE_SIGNING_IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

notarize() { # file
  xcrun notarytool submit "$1" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" --wait --output-format json | tee "$OUT/notary-$(basename "$1").json"
  grep -q '"status" *: *"Accepted"' "$OUT/notary-$(basename "$1").json" || {
    echo "Notarization failed for $1. See the log:" >&2
    local id
    id="$(sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' "$OUT/notary-$(basename "$1").json" | head -1)"
    xcrun notarytool log "$id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" >&2 || true
    exit 1
  }
}

VERSION="$(sed -n 's/^  "version": "\(.*\)",/\1/p' "$TAURI_DIR/tauri.conf.json")"
DMG="$OUT/Zoggyfin-$VERSION-arm64.dmg"

if [ "${SKIP_NOTARIZE:-}" != 1 ]; then
  # 5. Notarize and staple the app, so that it opens with no network check.
  log "Notarize the app"
  ditto -c -k --keepParent "$APP" "$OUT/Zoggyfin.zip"
  notarize "$OUT/Zoggyfin.zip"
  xcrun stapler staple "$APP"
  rm -f "$OUT/Zoggyfin.zip"
fi

# 6. The DMG: the app and a link to /Applications.
log "DMG"
STAGE="$OUT/dmg"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/Zoggyfin.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Zoggyfin" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG"
rm -rf "$STAGE"
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG"

if [ "${SKIP_NOTARIZE:-}" != 1 ]; then
  log "Notarize the DMG"
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  log "Check"
  xcrun stapler validate "$DMG"
  spctl -a -vvv -t install "$DMG"
  spctl -a -vvv -t exec "$APP"
fi
codesign --verify --deep --strict "$APP"
log "Done: $DMG"
