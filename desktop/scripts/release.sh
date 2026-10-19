#!/usr/bin/env bash
# Builds the macOS release of the desktop app: LGPL libmpv in the bundle,
# Developer ID signature with the hardened runtime, notarization, stapling,
# a signed, notarized, stapled DMG, and the signed update archive for the
# Tauri updater. It does not upload: desktop/scripts/publish.sh does that.
#
#   pnpm desktop:release
#
# Output in $BUILD_DIR/release/<version>/:
#   Zoggyfin.app                            the stapled app (for a local test)
#   Zoggyfin-<version>-arm64.dmg            signed, notarized, stapled
#   Zoggyfin-<version>-arm64.app.tar.gz     the update archive (the stapled app)
#   Zoggyfin-<version>-arm64.app.tar.gz.sig its updater signature
#
# Settings (environment, or the files in ~/.config/zoggyfin-desktop/):
#   ZOGGYFIN_NOTARY_ENV  a file with APPLE_SIGNING_IDENTITY, APPLE_API_KEY (key id),
#                        APPLE_API_ISSUER and APPLE_API_KEY_PATH (the .p8 file).
#                        Default: ~/.config/zoggyfin-desktop/notary.env. Never commit it.
#   ZOGGYFIN_UPDATER_ENV a file with TAURI_SIGNING_PRIVATE_KEY_PATH and
#                        TAURI_SIGNING_PRIVATE_KEY_PASSWORD (the updater key).
#                        Default: ~/.config/zoggyfin-desktop/updater.env. Never commit it.
#   BUILD_DIR            the work folder (libmpv build, cargo target, output), about
#                        10 GB. Default: /Users/Shared/zoggyfin-release. It must not be in
#                        the home folder: FFmpeg keeps its build path in the library, and
#                        the privacy check below stops on the home folder path.
#   SKIP_NOTARIZE=1      sign only (for a quick local test). publish.sh refuses such a build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI_DIR="$ROOT/desktop/src-tauri"
DMG_DIR="$ROOT/desktop/dmg"

BUILD_DIR="${BUILD_DIR:-/Users/Shared/zoggyfin-release}"
case "$BUILD_DIR/" in
  "$HOME"/*) echo "BUILD_DIR must not be in the home folder (see the comment at the top)." >&2; exit 1 ;;
esac
mkdir -p "$BUILD_DIR"
export PATH="$HOME/.cargo/bin:$PATH"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$BUILD_DIR/uv-cache}"

NOTARY_ENV="${ZOGGYFIN_NOTARY_ENV:-$HOME/.config/zoggyfin-desktop/notary.env}"
if [ -f "$NOTARY_ENV" ]; then
  # shellcheck disable=SC1090
  source "$NOTARY_ENV"
fi
UPDATER_ENV="${ZOGGYFIN_UPDATER_ENV:-$HOME/.config/zoggyfin-desktop/updater.env}"
if [ -f "$UPDATER_ENV" ]; then
  # shellcheck disable=SC1090
  source "$UPDATER_ENV"
fi
: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY (a Developer ID Application identity).}"
case "$APPLE_SIGNING_IDENTITY" in
  "Developer ID Application:"*) ;;
  *) echo "APPLE_SIGNING_IDENTITY must be a Developer ID Application identity." >&2; exit 1 ;;
esac
if [ "${SKIP_NOTARIZE:-}" != 1 ]; then
  : "${APPLE_API_KEY:?Set APPLE_API_KEY (the App Store Connect key id).}"
  : "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER.}"
  : "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH (the .p8 file).}"
  [ -f "$APPLE_API_KEY_PATH" ] || { echo "No file at APPLE_API_KEY_PATH." >&2; exit 1; }
fi
: "${TAURI_SIGNING_PRIVATE_KEY_PATH:?Set TAURI_SIGNING_PRIVATE_KEY_PATH (the updater key), or make $UPDATER_ENV.}"
[ -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ] || { echo "No updater key at TAURI_SIGNING_PRIVATE_KEY_PATH." >&2; exit 1; }
for tool in pnpm cargo xcrun codesign ditto hdiutil uv uvx python3; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done

log() { printf '\n==> %s\n' "$*"; }

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$TAURI_DIR/tauri.conf.json")"
CARGO_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$TAURI_DIR/Cargo.toml" | head -1)"
[ "$VERSION" = "$CARGO_VERSION" ] || {
  echo "tauri.conf.json has $VERSION but Cargo.toml has $CARGO_VERSION. Run: pnpm desktop:version $VERSION" >&2
  exit 1
}
log "Zoggyfin $VERSION"

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
# Tauri must not sign or make its own update archive: the bundle changes below (libmpv), and
# the update archive must hold the notarized, stapled app.
env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  -u APPLE_SIGNING_IDENTITY -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH \
  pnpm tauri build --bundles app --config desktop/src-tauri/tauri.conf.json
SRC_APP="$CARGO_TARGET_DIR/release/bundle/macos/Zoggyfin.app"
OUT="$BUILD_DIR/release/$VERSION"
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
codesign -dv --verbose=2 "$APP" 2>&1 | grep -q "flags=.*runtime" || { echo "No hardened runtime on the app." >&2; exit 1; }

notarize() { # file
  xcrun notarytool submit "$1" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" --wait --timeout 45m --output-format json > "$OUT/notary-$(basename "$1").json" || true
  grep -q '"status" *: *"Accepted"' "$OUT/notary-$(basename "$1").json" || {
    echo "Notarization failed for $1. See the log:" >&2
    cat "$OUT/notary-$(basename "$1").json" >&2
    local id
    id="$(sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' "$OUT/notary-$(basename "$1").json" | head -1)"
    [ -n "$id" ] && xcrun notarytool log "$id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" >&2 || true
    exit 1
  }
  echo "Accepted: $(basename "$1")"
}

DMG="$OUT/Zoggyfin-$VERSION-arm64.dmg"
TARBALL="$OUT/Zoggyfin-$VERSION-arm64.app.tar.gz"

if [ "${SKIP_NOTARIZE:-}" != 1 ]; then
  # 5. Notarize and staple the app, so that it opens with no network check.
  log "Notarize the app"
  ditto -c -k --keepParent "$APP" "$OUT/Zoggyfin.zip"
  notarize "$OUT/Zoggyfin.zip"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  rm -f "$OUT/Zoggyfin.zip"
fi

# 6. The update archive: the stapled app, signed with the updater key. The updater checks this
# signature with the public key in tauri.conf.json before it installs anything.
# COPYFILE_DISABLE: no AppleDouble (._*) files in the archive.
log "Update archive"
COPYFILE_DISABLE=1 tar -czf "$TARBALL" -C "$OUT" Zoggyfin.app
pnpm -s tauri signer sign -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" -p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$TARBALL" >/dev/null
[ -s "$TARBALL.sig" ] || { echo "tauri signer did not write $TARBALL.sig" >&2; exit 1; }

# 7. The DMG. dmgbuild writes the Finder window (.DS_Store: 600x380, 128 pt icons, the app left,
# the Applications link right, the background) with no Finder or AppleScript. A plain
# `hdiutil create` has no .DS_Store, and Finder then opens a large default window.
# desktop/dmg/verify.py checks the layout.
log "DMG"
rm -f "$DMG"
uvx --python 3.12 --from dmgbuild==1.6.7 --with ds_store==1.3.3 --with mac_alias==2.2.3 \
  dmgbuild -s "$DMG_DIR/settings.py" -D app="$APP" -D icon="$TAURI_DIR/icons/icon.icns" \
  -D background="$DMG_DIR/background.png" Zoggyfin "$DMG"
uv run --no-project --python 3.12 --with ds_store==1.3.3 --with mac_alias==2.2.3 \
  python "$DMG_DIR/verify.py" "$DMG"
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG"

if [ "${SKIP_NOTARIZE:-}" != 1 ]; then
  log "Notarize the DMG"
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  log "Check"
  xcrun stapler validate "$DMG"
  spctl -a -vvv -t install "$DMG"
  spctl -a -vvv -t exec "$APP"
  : > "$OUT/.notarized"
fi
codesign --verify --deep --strict "$APP"
log "Done: $OUT"
ls -la "$OUT"
