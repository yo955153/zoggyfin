#!/usr/bin/env bash
# Copies libmpv and every dylib it needs from the LGPL build into an app bundle,
# and the license texts and notices into Contents/Resources/ThirdParty.
#
# Usage: desktop/scripts/bundle-libmpv.sh <Zoggyfin.app> <prefix of build-libmpv.sh>
# Fails when a binary in the bundle links a library outside the bundle and the system.
set -euo pipefail

APP="$1"
PREFIX="$2"
LIB="$PREFIX/lib"
FW="$APP/Contents/Frameworks"
BIN="$APP/Contents/MacOS/zoggyfin-desktop"
mkdir -p "$FW"

deps() { otool -L "$1" | tail -n +2 | awk '{print $1}' | sed -n 's|^@rpath/||p'; }
# The file name of a library, after symbolic links (libavcodec.63.dylib -> libavcodec.63.1.102.dylib).
real() { basename "$(readlink -f "$LIB/$1")"; }

# The closure of @rpath libraries, from the app binary down. Each library is copied once,
# with its real file name; the load commands are changed to that name.
queue=$(deps "$BIN")
seen=" "
while [ -n "$queue" ]; do
  next=""
  for name in $queue; do
    [ -e "$LIB/$name" ] || { echo "Not in the libmpv build: $name" >&2; exit 1; }
    file="$(real "$name")"
    case "$seen" in *" $file "*) continue ;; esac
    seen="$seen$file "
    cp "$LIB/$file" "$FW/$file"
    chmod 644 "$FW/$file"
    next="$next $(deps "$LIB/$file")"
  done
  queue="$next"
done
echo "Frameworks:$seen"

for f in "$BIN" "$FW"/*.dylib; do
  for name in $(deps "$f"); do
    file="$(real "$name")"
    [ "$name" = "$file" ] || install_name_tool -change "@rpath/$name" "@rpath/$file" "$f" 2>/dev/null
  done
  if [ "$f" != "$BIN" ]; then
    install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null
    # Build-time rpaths (the Swift toolchain in Xcode) do not exist on other Macs.
    for rp in $(otool -l "$f" | awk '/LC_RPATH/{getline; getline; print $2}' | grep -vE '^(@loader_path|@executable_path|/usr/lib/)' || true); do
      install_name_tool -delete_rpath "$rp" "$f" 2>/dev/null
    done
    # No local symbols and no debug map (they hold the build folder paths).
    strip -x "$f" 2>/dev/null
  fi
done

# Every load command must be @rpath (in the bundle) or a system path.
bad=""
for f in "$BIN" "$FW"/*.dylib; do
  out="$(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep -vE '^(@rpath/|/usr/lib/|/System/Library/)' || true)"
  [ -n "$out" ] && bad="$bad$f: $out"$'\n'
done
if [ -n "$bad" ]; then
  echo "Links outside the bundle:" >&2
  echo "$bad" >&2
  exit 1
fi
otool -l "$BIN" | grep -q "path @executable_path/../Frameworks " || {
  echo "The app binary has no @executable_path/../Frameworks rpath" >&2
  exit 1
}
if otool -l "$BIN" "$FW"/*.dylib | grep -E "^ *path " | grep -vE "path (@loader_path|@executable_path|/usr/lib/)"; then
  echo "An rpath points outside the bundle" >&2
  exit 1
fi

# License texts and the source offer.
rm -rf "$APP/Contents/Resources/ThirdParty"
cp -R "$PREFIX/share/licenses" "$APP/Contents/Resources/ThirdParty"
echo "OK: $(ls "$FW" | wc -l | tr -d ' ') dylibs in Contents/Frameworks, no outside links."
