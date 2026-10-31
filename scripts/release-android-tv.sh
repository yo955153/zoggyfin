#!/usr/bin/env bash
# Publishes a sideload release of the Android TV app: builds the APK (EAS profile `tv`), writes
# latest.json, and uploads both to the same Cloudflare R2 bucket as the Mac app. The app reads
# the feed and updates itself (src/platform/updates/tv.ts).
#
#   bash scripts/release-android-tv.sh
#
# R2 layout (public at $R2_PUBLIC_URL; <prefix> is $R2_PREFIX, <tv> is $TV_PREFIX):
#   <prefix>/<tv>/zoggyfin-tv-<versionName>-<versionCode>.apk   immutable
#   <prefix>/<tv>/zoggyfin-tv-latest.apk                        the newest APK (no-cache; the website link)
#   <prefix>/<tv>/latest.json                                   the update feed (no-cache, last)
#
# Settings:
#   ZOGGYFIN_R2_ENV   the R2 settings file of the Mac releases (desktop/scripts/publish.sh):
#                     R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX,
#                     R2_PUBLIC_URL. Default ~/.config/zoggyfin-desktop/r2.env. Never commit it.
#   TV_PREFIX         default android-tv. A test feed: TV_PREFIX=android-tv-test (the app reads it
#                     when the build sets EXPO_PUBLIC_TV_UPDATE_URL to its latest.json).
#   EAS_LOCAL_WRAPPER a build script called as `<wrapper> <dir> android tv --arch <abis> --output <apk>`.
#                     Default: `eas build --local --platform android --profile tv`.
#   ABIS              default armeabi-v7a,arm64-v8a (32-bit Fire TV sticks and 64-bit-only boxes).
#   APK=<file>        publish this APK and do not build (it must be a `tv` profile build).
#   NOTES_FILE        the release notes (one "- item" per line). Default: the "## [<versionName>]"
#                     section of CHANGELOG.md, if there is one.
#   MIN_VERSION_CODE  older builds must update ("Later" does not hide the card).
#   ALLOW_UNPUSHED=1  build although HEAD is not on origin/main (test releases only)
#   REPUBLISH=1       replace a build that is already on R2 (test releases only)
# The build runs in a clean git worktree of HEAD ($BUILD_DIR/src-tv), so uncommitted files in
# the checkout never ship.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${TMPDIR:-/tmp}/zoggyfin-tv-release}"
TV_PREFIX="${TV_PREFIX:-android-tv}"
ABIS="${ABIS:-armeabi-v7a,arm64-v8a}"
log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nrelease-android-tv: %s\n' "$*" >&2; exit 1; }

R2_ENV="${ZOGGYFIN_R2_ENV:-$HOME/.config/zoggyfin-desktop/r2.env}"
[ -f "$R2_ENV" ] && { set -a; . "$R2_ENV"; set +a; }
: "${R2_ENDPOINT:?R2_ENDPOINT missing (see $R2_ENV)}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID missing}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY missing}"
: "${R2_BUCKET:?R2_BUCKET missing}"
: "${R2_PUBLIC_URL:?R2_PUBLIC_URL missing}"
R2_PREFIX="${R2_PREFIX:-zoggyfin}"
case "$TV_PREFIX" in android-tv|android-tv-*) ;; *) die "TV_PREFIX must be android-tv or android-tv-<name>" ;; esac
KEY_BASE="$R2_PREFIX/$TV_PREFIX"
PUBLIC="${R2_PUBLIC_URL%/}/$KEY_BASE"

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)"
AAPT2="$BUILD_TOOLS/aapt2"
[ -x "$AAPT2" ] || die "no aapt2 in $ANDROID_HOME/build-tools (set ANDROID_HOME)"
for tool in python3 curl shasum git; do command -v "$tool" >/dev/null || die "missing tool: $tool"; done

r2() { # curl args...
  curl -sS --fail-with-body --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" "$@"
}
r2_put() { # file key content-type cache-control
  r2 -o /dev/null -H "Content-Type: $3" -H "Cache-Control: $4" -T "$1" "${R2_ENDPOINT%/}/$R2_BUCKET/$2" \
    || die "R2 upload failed: $2"
  echo "  $2"
}

# 1. The APK.
if [ -z "${APK:-}" ]; then
  git -C "$ROOT" fetch -q origin
  if [ "${ALLOW_UNPUSHED:-}" != 1 ]; then
    git -C "$ROOT" merge-base --is-ancestor HEAD origin/main || die "HEAD is not on origin/main: push the release commit first"
  fi
  mkdir -p "$BUILD_DIR"
  SRC="$BUILD_DIR/src-tv"
  log "Clean checkout of $(git -C "$ROOT" rev-parse --short HEAD) in $SRC"
  git -C "$ROOT" worktree remove --force "$SRC" 2>/dev/null || rm -rf "$SRC"
  git -C "$ROOT" worktree prune
  git -C "$ROOT" worktree add --detach "$SRC" HEAD >/dev/null
  (cd "$SRC" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
  APK="$BUILD_DIR/zoggyfin-tv-build.apk"
  rm -f "$APK"
  log "Build ($ABIS)"
  if [ -n "${EAS_LOCAL_WRAPPER:-}" ]; then
    "$EAS_LOCAL_WRAPPER" "$SRC" android tv --arch "$ABIS" --output "$APK"
  else
    (cd "$SRC" && ORG_GRADLE_PROJECT_reactNativeArchitectures="$ABIS" \
      npx -y "eas-cli@${EAS_CLI_VERSION:-25.3.0}" build --local --platform android --profile tv --non-interactive --output "$APK")
  fi
  git -C "$ROOT" worktree remove --force "$SRC"
fi
[ -f "$APK" ] || die "no APK at $APK"

# 2. What the APK is: a `tv` build with the self-update permission, for the TV, with both ABIs.
log "Check $(basename "$APK")"
BADGING="$("$AAPT2" dump badging "$APK")"
read -r PACKAGE VERSION_CODE VERSION_NAME < <(python3 -c '
import re, sys
m = re.search(r"package: name=\x27([^\x27]+)\x27 versionCode=\x27(\d+)\x27 versionName=\x27([^\x27]+)\x27", sys.stdin.read())
print(*m.groups()) if m else sys.exit(1)' <<<"$BADGING") || die "aapt2 cannot read the package line"
grep -q "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'" <<<"$BADGING" \
  || die "the APK has no REQUEST_INSTALL_PACKAGES: it is not a build of the profile tv"
grep -q "leanback-launchable-activity" <<<"$BADGING" || die "the APK has no TV launcher activity (EXPO_TV was not set)"
NATIVE="$(sed -n "s/^native-code: //p" <<<"$BADGING")"
IFS=',' read -r -a WANT <<<"$ABIS"
for abi in "${WANT[@]}"; do
  grep -q "'$abi'" <<<"$NATIVE" || die "the APK has no $abi code (native-code: $NATIVE)"
done
# apksigner needs Java (JAVA_HOME or java on PATH).
if [ -x "$BUILD_TOOLS/apksigner" ] && "$BUILD_TOOLS/apksigner" version >/dev/null 2>&1; then
  "$BUILD_TOOLS/apksigner" verify "$APK" >/dev/null || die "the APK signature does not verify"
else
  echo "  apksigner cannot run (no Java): the signature is not checked"
fi
SHA256="$(shasum -a 256 "$APK" | cut -d' ' -f1)"
SIZE="$(wc -c <"$APK" | tr -d ' ')"
NAME="zoggyfin-tv-$VERSION_NAME-$VERSION_CODE.apk"
echo "  $PACKAGE $VERSION_NAME ($VERSION_CODE), $SIZE bytes, ABIs: $NATIVE"
echo "  sha256 $SHA256"

exists=$(r2 -o /dev/null -w '%{http_code}' -I "${R2_ENDPOINT%/}/$R2_BUCKET/$KEY_BASE/$NAME" 2>/dev/null || true)
if [ "$exists" = 200 ] && [ "${REPUBLISH:-}" != 1 ]; then
  die "$NAME is on R2 already. Make a new build (EAS sets a new versionCode)."
fi

# 3. The notes and latest.json.
if [ -n "${NOTES_FILE:-}" ]; then
  NOTES="$(cat "$NOTES_FILE")"
else
  NOTES="$(python3 - "$ROOT/CHANGELOG.md" "$VERSION_NAME" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^## \[?v?" + re.escape(sys.argv[2]) + r"\]?[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
print(m.group(1).strip() if m else "")
PY
)"
fi
OUT="$BUILD_DIR/out"
mkdir -p "$OUT"
NOTES="$NOTES" python3 - "$OUT/latest.json" "$VERSION_NAME" "$VERSION_CODE" "$PUBLIC/$NAME" "$SHA256" "$SIZE" "${MIN_VERSION_CODE:-}" <<'PY'
import datetime, json, os, sys
path, name, code, url, sha, size, min_code = sys.argv[1:]
manifest = {
    "versionName": name,
    "versionCode": int(code),
    "url": url,
    "sha256": sha,
    "size": int(size),
    "notes": os.environ["NOTES"],
    "pub_date": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
}
if min_code:
    manifest["minVersionCode"] = int(min_code)
json.dump(manifest, open(path, "w"), indent=2)
PY
cat "$OUT/latest.json"

# 4. Upload. The feed goes last: the apps see the new build only when its APK is there.
log "Upload to R2 ($R2_BUCKET/$KEY_BASE)"
APK_TYPE="application/vnd.android.package-archive"
r2_put "$APK" "$KEY_BASE/$NAME" "$APK_TYPE" "public, max-age=31536000, immutable"
r2_put "$APK" "$KEY_BASE/zoggyfin-tv-latest.apk" "$APK_TYPE" "no-cache"
r2_put "$OUT/latest.json" "$KEY_BASE/latest.json" application/json "no-cache"

log "Check the public files"
for path in "$NAME" "zoggyfin-tv-latest.apk"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -I "$PUBLIC/$path")
  [ "$code" = 200 ] || die "$PUBLIC/$path answers $code"
done
served="$(curl -s -H 'Cache-Control: no-cache' "$PUBLIC/latest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versionCode"])')"
[ "$served" = "$VERSION_CODE" ] || die "$PUBLIC/latest.json serves $served, not $VERSION_CODE"

log "Published Zoggyfin for Android TV $VERSION_NAME ($VERSION_CODE)"
echo "  APK:    $PUBLIC/$NAME"
echo "  Latest: $PUBLIC/zoggyfin-tv-latest.apk"
echo "  Feed:   $PUBLIC/latest.json"
