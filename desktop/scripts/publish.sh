#!/usr/bin/env bash
# Publishes a desktop release: builds it (release.sh), writes latest.json with the notes from
# desktop/CHANGELOG.md, uploads to Cloudflare R2, and makes the GitHub release.
#
#   pnpm desktop:version 0.1.2     # first: set the version, then write its CHANGELOG section
#   pnpm desktop:publish           # build, sign, notarize, upload, GitHub release
#
# R2 layout (public at $R2_PUBLIC_URL, the prefix is $R2_PREFIX):
#   <prefix>/<version>/Zoggyfin-<version>-arm64.dmg               immutable
#   <prefix>/<version>/Zoggyfin-<version>-arm64.app.tar.gz(.sig)  immutable (the update)
#   <prefix>/<version>/latest.json                                the manifest of that version
#   <prefix>/latest/Zoggyfin-arm64.dmg                            the newest DMG (no-cache)
#   <prefix>/latest.json                                          the updater feed (no-cache, last)
#
# Settings:
#   ZOGGYFIN_R2_ENV   default ~/.config/zoggyfin-desktop/r2.env: R2_ENDPOINT, R2_ACCESS_KEY_ID,
#                     R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX, R2_PUBLIC_URL. Never commit it.
#   SKIP_BUILD=1      publish the build that is already in $BUILD_DIR/release/<version>/
# The build runs in a clean git worktree of HEAD ($BUILD_DIR/src), so uncommitted files in the
# checkout never ship.
#   SKIP_GITHUB=1     no GitHub release
#   ALLOW_UNPUSHED=1  publish although HEAD is not on origin/main (test releases only)
#   REPUBLISH=1       replace a version that is already on R2 (test releases only)
#   GH_REPO           default zog-tech/zoggyfin
# The other settings are those of release.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI_DIR="$ROOT/desktop/src-tauri"
BUILD_DIR="${BUILD_DIR:-/Users/Shared/zoggyfin-release}"
GH_REPO="${GH_REPO:-zog-tech/zoggyfin}"
log() { printf '\n==> %s\n' "$*"; }
die() { printf '\npublish: %s\n' "$*" >&2; exit 1; }

R2_ENV="${ZOGGYFIN_R2_ENV:-$HOME/.config/zoggyfin-desktop/r2.env}"
[ -f "$R2_ENV" ] && { set -a; . "$R2_ENV"; set +a; }
: "${R2_ENDPOINT:?R2_ENDPOINT missing (see $R2_ENV)}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID missing}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY missing}"
: "${R2_BUCKET:?R2_BUCKET missing}"
: "${R2_PUBLIC_URL:?R2_PUBLIC_URL missing}"
R2_PREFIX="${R2_PREFIX:-zoggyfin}"
PUBLIC="${R2_PUBLIC_URL%/}/$R2_PREFIX"

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$TAURI_DIR/tauri.conf.json")"
TAG="v$VERSION"
ENDPOINT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["plugins"]["updater"]["endpoints"][0])' "$TAURI_DIR/tauri.conf.json")"
[ "$ENDPOINT" = "$PUBLIC/latest.json" ] || die "the updater endpoint in tauri.conf.json ($ENDPOINT) is not $PUBLIC/latest.json"

# The notes of this version: the "## <version>" section of desktop/CHANGELOG.md.
NOTES="$(python3 - "$ROOT/desktop/CHANGELOG.md" "$VERSION" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^## \[?v?" + re.escape(sys.argv[2]) + r"\]?[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
print(m.group(1).strip() if m else "")
PY
)"
[ -n "$NOTES" ] || die "desktop/CHANGELOG.md has no section '## $VERSION' with notes"

# Checks before the long build.
git -C "$ROOT" fetch -q origin
if [ "${ALLOW_UNPUSHED:-}" != 1 ]; then
  git -C "$ROOT" merge-base --is-ancestor HEAD origin/main || die "HEAD is not on origin/main: push the release commit first"
fi
r2() { # curl args...
  curl -sS --fail-with-body --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" "$@"
}
r2_put() { # file key content-type cache-control
  r2 -o /dev/null -H "Content-Type: $3" -H "Cache-Control: $4" -T "$1" "${R2_ENDPOINT%/}/$R2_BUCKET/$2" \
    || die "R2 upload failed: $2"
  echo "  $2"
}
exists=$(r2 -o /dev/null -w '%{http_code}' -I "${R2_ENDPOINT%/}/$R2_BUCKET/$R2_PREFIX/$VERSION/latest.json" 2>/dev/null || true)
if [ "$exists" = 200 ] && [ "${REPUBLISH:-}" != 1 ]; then
  die "$VERSION is on R2 already. Set a new version: pnpm desktop:version <x.y.z>"
fi

if [ "${SKIP_BUILD:-}" != 1 ]; then
  # Build from a clean checkout of HEAD: uncommitted files in this checkout never ship.
  SRC="$BUILD_DIR/src"
  log "Clean checkout of $(git -C "$ROOT" rev-parse --short HEAD) in $SRC"
  git -C "$ROOT" worktree remove --force "$SRC" 2>/dev/null || rm -rf "$SRC"
  git -C "$ROOT" worktree prune
  git -C "$ROOT" worktree add --detach "$SRC" HEAD >/dev/null
  (cd "$SRC" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
  BUILD_DIR="$BUILD_DIR" bash "$SRC/desktop/scripts/release.sh"
  git -C "$ROOT" worktree remove --force "$SRC"
fi
OUT="$BUILD_DIR/release/$VERSION"
DMG="Zoggyfin-$VERSION-arm64.dmg"
TARBALL="Zoggyfin-$VERSION-arm64.app.tar.gz"
for f in "$DMG" "$TARBALL" "$TARBALL.sig" .notarized; do
  [ -f "$OUT/$f" ] || die "missing $OUT/$f (a notarized build of release.sh)"
done
xcrun stapler validate "$OUT/$DMG" >/dev/null || die "the DMG is not stapled"

log "latest.json"
NOTES="$NOTES" python3 - "$OUT/latest.json" "$VERSION" "$PUBLIC/$VERSION/$TARBALL" "$OUT/$TARBALL.sig" <<'PY'
import datetime, json, os, sys
path, version, url, sig_path = sys.argv[1:]
manifest = {
    "version": version,
    "notes": os.environ["NOTES"],
    "pub_date": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "platforms": {"darwin-aarch64": {"signature": open(sig_path).read().strip(), "url": url}},
}
json.dump(manifest, open(path, "w"), indent=2)
PY
cat "$OUT/latest.json"

log "Upload to R2 ($R2_BUCKET/$R2_PREFIX)"
immutable="public, max-age=31536000, immutable"
r2_put "$OUT/$DMG" "$R2_PREFIX/$VERSION/$DMG" application/x-apple-diskimage "$immutable"
r2_put "$OUT/$TARBALL" "$R2_PREFIX/$VERSION/$TARBALL" application/gzip "$immutable"
r2_put "$OUT/$TARBALL.sig" "$R2_PREFIX/$VERSION/$TARBALL.sig" text/plain "$immutable"
r2_put "$OUT/latest.json" "$R2_PREFIX/$VERSION/latest.json" application/json "no-cache"
# The stable link of the website: always the newest DMG.
r2_put "$OUT/$DMG" "$R2_PREFIX/latest/Zoggyfin-arm64.dmg" application/x-apple-diskimage "no-cache"
# The feed goes last: the apps see the new version only when all its files are there.
r2_put "$OUT/latest.json" "$R2_PREFIX/latest.json" application/json "no-cache"

log "Check the public files"
for path in "$VERSION/$TARBALL" "latest/Zoggyfin-arm64.dmg"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -I "$PUBLIC/$path")
  [ "$code" = 200 ] || die "$PUBLIC/$path answers $code"
done
served="$(curl -s -H 'Cache-Control: no-cache' "$PUBLIC/latest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
[ "$served" = "$VERSION" ] || die "$PUBLIC/latest.json serves $served, not $VERSION"
echo "  $PUBLIC/latest.json: $served"

if [ "${SKIP_GITHUB:-}" != 1 ]; then
  log "GitHub release $TAG ($GH_REPO)"
  if gh release view "$TAG" -R "$GH_REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" -R "$GH_REPO" --clobber "$OUT/$DMG" "$OUT/$TARBALL" "$OUT/$TARBALL.sig" "$OUT/latest.json"
  else
    printf '%s\n\nDownload: %s/latest/Zoggyfin-arm64.dmg (macOS 13 or later on Apple silicon).\n' "$NOTES" "$PUBLIC" > "$OUT/release-notes.md"
    gh release create "$TAG" -R "$GH_REPO" --target "$(git -C "$ROOT" rev-parse HEAD)" \
      --title "Zoggyfin $VERSION for Mac" --notes-file "$OUT/release-notes.md" \
      "$OUT/$DMG" "$OUT/$TARBALL" "$OUT/$TARBALL.sig" "$OUT/latest.json"
  fi
fi

log "Published Zoggyfin $VERSION"
echo "  DMG:    $PUBLIC/latest/Zoggyfin-arm64.dmg"
echo "  Feed:   $PUBLIC/latest.json"
