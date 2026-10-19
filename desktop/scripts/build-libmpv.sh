#!/usr/bin/env bash
# Builds an LGPL libmpv and its dependencies from source for macOS arm64.
#
# The result is a set of dylibs with @rpath install names in $WORK/prefix/lib.
# desktop/scripts/bundle-libmpv.sh copies them into the app bundle.
#
# License: every part is LGPL-2.1+ or permissive. FFmpeg has no --enable-gpl,
# no --enable-nonfree and no --enable-version3. mpv has -Dgpl=false.
#
# Usage: desktop/scripts/build-libmpv.sh
#   LIBMPV_WORK  the work folder (default: $BUILD_DIR/libmpv). Use a disk with
#                about 3 GB free.
#   JOBS         the number of parallel jobs (default: the CPU count).
# Run it again to continue after an error. Each part has a stamp file; delete
# $WORK/stamps/<part> to build that part again.
set -euo pipefail

if [ -z "${LIBMPV_WORK:-}" ] && [ -z "${BUILD_DIR:-}" ]; then
  echo "Set LIBMPV_WORK or BUILD_DIR (the work folder)." >&2
  exit 1
fi
WORK="${LIBMPV_WORK:-$BUILD_DIR/libmpv}"
JOBS="${JOBS:-$(sysctl -n hw.ncpu)}"
DL="$WORK/downloads"
SRC="$WORK/src"
PREFIX="$WORK/prefix"
STAMPS="$WORK/stamps"
TOOLS="$WORK/tools"
mkdir -p "$DL" "$SRC" "$PREFIX" "$STAMPS"

# The deployment target of the app (tauri.conf.json: bundle.macOS.minimumSystemVersion).
export MACOSX_DEPLOYMENT_TARGET=13.0
ARCH=arm64

# Pinned sources: name, version, URL, SHA-256.
FFMPEG_VER=9.0.2
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VER.tar.xz"
FFMPEG_SHA=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
DAV1D_VER=1.5.4
DAV1D_URL="https://downloads.videolan.org/pub/videolan/dav1d/$DAV1D_VER/dav1d-$DAV1D_VER.tar.xz"
DAV1D_SHA=686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5
FREETYPE_VER=2.15.0
FREETYPE_URL="https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE_VER.tar.xz"
FREETYPE_SHA=93cd47eb719c325107f2d3cf087d06299e944c3b48a40b55537302304dea1dd5
FRIBIDI_VER=1.0.17
FRIBIDI_URL="https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VER/fribidi-$FRIBIDI_VER.tar.xz"
FRIBIDI_SHA=6949dcde27d41cebad1fd741fcafc36d55a1020d2d872d4a6eb3914caabbada2
HARFBUZZ_VER=14.6.0
HARFBUZZ_URL="https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VER/harfbuzz-$HARFBUZZ_VER.tar.xz"
HARFBUZZ_SHA=d07a007327277708a2a73ae437887cdbaf282937f6d03ca5467723e9099af586
LIBASS_VER=0.17.5
LIBASS_URL="https://github.com/libass/libass/releases/download/$LIBASS_VER/libass-$LIBASS_VER.tar.xz"
LIBASS_SHA=2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc
# libplacebo needs its git submodules (glad, jinja, Vulkan headers): a git checkout of a pinned commit.
LIBPLACEBO_VER=7.360.1
LIBPLACEBO_GIT=https://code.videolan.org/videolan/libplacebo.git
LIBPLACEBO_COMMIT=cee9b076f2c63104ccfd497fa79c39a867293ec4
MPV_VER=0.41.0
MPV_URL="https://github.com/mpv-player/mpv/archive/refs/tags/v$MPV_VER.tar.gz"
MPV_SHA=ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209
# Upstream fix (in mpv master): use after free when the audio device changes on macOS 26.
MPV_PATCH_URL="https://github.com/mpv-player/mpv/commit/c5d391adba7bd024954d0df1e0405f5749f4d4ca.patch?full_index=1"
MPV_PATCH_SHA=769b218df220738cc1cf9f81cf696c16518c5dfe56a5ef028e33b22536e0e924

# Build tools in a Python environment of their own (no Homebrew libraries).
MESON_VER=1.12.1
NINJA_VER=1.13.2
PKGCONF_VER=3.0.7.post0

log() { printf '\n==> %s\n' "$*"; }

fetch() { # url sha256 file
  local url=$1 sha=$2 out="$DL/$3"
  if [ ! -f "$out" ]; then
    log "Download $3"
    curl -fL --retry 3 -o "$out.part" "$url"
    mv "$out.part" "$out"
  fi
  echo "$sha  $out" | shasum -a 256 -c - >/dev/null || {
    echo "Checksum error: $out" >&2
    exit 1
  }
}

unpack() { # file dir
  rm -rf "${SRC:?}/$2"
  tar -xf "$DL/$1" -C "$SRC"
}

done_stamp() { touch "$STAMPS/$1"; }
is_done() { [ -f "$STAMPS/$1" ]; }

setup_tools() {
  is_done tools && return
  log "Build tools: meson $MESON_VER, ninja $NINJA_VER, pkgconf $PKGCONF_VER"
  command -v uv >/dev/null || { echo "uv is necessary (https://docs.astral.sh/uv/)." >&2; exit 1; }
  export UV_CACHE_DIR="${UV_CACHE_DIR:-$WORK/uv-cache}"
  uv venv -q --allow-existing "$TOOLS"
  uv pip install -q -p "$TOOLS/bin/python" "meson==$MESON_VER" "ninja==$NINJA_VER" "pkgconf==$PKGCONF_VER"
  done_stamp tools
}

setup_env() {
  export PATH="$TOOLS/bin:$PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  # Only our prefix: never find Homebrew libraries through pkg-config.
  export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
  unset PKG_CONFIG_PATH CPATH LIBRARY_PATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH
  SDK="$(xcrun --sdk macosx --show-sdk-path)"
  export SDKROOT="$SDK"
  local base="-arch $ARCH -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET -isysroot $SDK"
  export CC="$(xcrun -f clang)" CXX="$(xcrun -f clang++)" OBJC="$(xcrun -f clang)"
  export CFLAGS="$base -O2 -I$PREFIX/include" CXXFLAGS="$base -O2 -I$PREFIX/include" OBJCFLAGS="$base -O2"
  # headerpad: room to change install names to @rpath later.
  export LDFLAGS="$base -L$PREFIX/lib -Wl,-headerpad_max_install_names"
}

meson_build() { # srcdir [meson options...]
  local dir="$SRC/$1"
  shift
  rm -rf "$dir/build"
  (cd "$dir" && meson setup build --prefix="$PREFIX" --libdir=lib --buildtype=release \
    -Ddefault_library=shared -Db_ndebug=true --wrap-mode=nodownload "$@" &&
    meson compile -C build -j "$JOBS" && meson install -C build)
}

build_dav1d() {
  is_done dav1d && return
  fetch "$DAV1D_URL" "$DAV1D_SHA" "dav1d-$DAV1D_VER.tar.xz"
  unpack "dav1d-$DAV1D_VER.tar.xz" "dav1d-$DAV1D_VER"
  log "dav1d $DAV1D_VER (BSD-2-Clause)"
  meson_build "dav1d-$DAV1D_VER" -Denable_tools=false -Denable_tests=false -Denable_examples=false -Denable_docs=false
  done_stamp dav1d
}

build_freetype() {
  is_done freetype && return
  fetch "$FREETYPE_URL" "$FREETYPE_SHA" "freetype-$FREETYPE_VER.tar.xz"
  unpack "freetype-$FREETYPE_VER.tar.xz" "freetype-$FREETYPE_VER"
  log "FreeType $FREETYPE_VER (FreeType License)"
  meson_build "freetype-$FREETYPE_VER" -Dharfbuzz=disabled -Dpng=disabled -Dbzip2=disabled \
    -Dbrotli=disabled -Dzlib=internal -Dtests=disabled
  done_stamp freetype
}

build_fribidi() {
  is_done fribidi && return
  fetch "$FRIBIDI_URL" "$FRIBIDI_SHA" "fribidi-$FRIBIDI_VER.tar.xz"
  unpack "fribidi-$FRIBIDI_VER.tar.xz" "fribidi-$FRIBIDI_VER"
  log "FriBidi $FRIBIDI_VER (LGPL-2.1+)"
  meson_build "fribidi-$FRIBIDI_VER" -Ddocs=false -Dbin=false -Dtests=false
  done_stamp fribidi
}

build_harfbuzz() {
  is_done harfbuzz && return
  fetch "$HARFBUZZ_URL" "$HARFBUZZ_SHA" "harfbuzz-$HARFBUZZ_VER.tar.xz"
  unpack "harfbuzz-$HARFBUZZ_VER.tar.xz" "harfbuzz-$HARFBUZZ_VER"
  log "HarfBuzz $HARFBUZZ_VER (MIT)"
  meson_build "harfbuzz-$HARFBUZZ_VER" -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled \
    -Dcairo=disabled -Dchafa=disabled -Dicu=disabled -Dgraphite2=disabled -Dpng=disabled \
    -Dzlib=disabled -Dcoretext=disabled -Dtests=disabled -Dintrospection=disabled -Ddocs=disabled \
    -Dutilities=disabled -Dbenchmark=disabled -Dsubset=disabled -Draster=disabled -Dvector=disabled \
    -Dgpu=disabled
  done_stamp harfbuzz
}

build_libass() {
  is_done libass && return
  fetch "$LIBASS_URL" "$LIBASS_SHA" "libass-$LIBASS_VER.tar.xz"
  unpack "libass-$LIBASS_VER.tar.xz" "libass-$LIBASS_VER"
  log "libass $LIBASS_VER (ISC)"
  # Fonts come from Core Text (no fontconfig).
  meson_build "libass-$LIBASS_VER" -Dfontconfig=disabled -Dcoretext=enabled -Ddirectwrite=disabled \
    -Dlibunibreak=disabled -Drequire-system-font-provider=true -Dtest=disabled -Dcompare=disabled \
    -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled
  done_stamp libass
}

build_ffmpeg() {
  is_done ffmpeg && return
  fetch "$FFMPEG_URL" "$FFMPEG_SHA" "ffmpeg-$FFMPEG_VER.tar.xz"
  unpack "ffmpeg-$FFMPEG_VER.tar.xz" "ffmpeg-$FFMPEG_VER"
  log "FFmpeg $FFMPEG_VER (LGPL-2.1+)"
  # --disable-autodetect: only what is named here. No --enable-gpl, --enable-nonfree or
  # --enable-version3, so the libraries stay LGPL-2.1+.
  (cd "$SRC/ffmpeg-$FFMPEG_VER" && ./configure \
    --prefix="$PREFIX" --pkg-config=pkgconf --cc="$CC" --arch=aarch64 --target-os=darwin \
    --extra-cflags="$CFLAGS" --extra-ldflags="$LDFLAGS" --extra-libs=-liconv \
    --enable-shared --disable-static --enable-pic \
    --disable-autodetect --disable-programs --disable-doc --disable-debug \
    --disable-avdevice \
    --enable-videotoolbox --enable-audiotoolbox --enable-securetransport \
    --enable-zlib --enable-bzlib --enable-iconv --enable-libdav1d \
    --install-name-dir="$PREFIX/lib" &&
    make -j "$JOBS" && make install)
  grep -E "^(LICENSE|FFMPEG_CONFIGURATION)" "$SRC/ffmpeg-$FFMPEG_VER/ffbuild/config.mak" || true
  done_stamp ffmpeg
}

build_libplacebo() {
  is_done libplacebo && return
  local dir="$SRC/libplacebo-$LIBPLACEBO_VER"
  log "libplacebo $LIBPLACEBO_VER (LGPL-2.1+)"
  rm -rf "$dir"
  git -c advice.detachedHead=false clone -q --depth 1 --branch "v$LIBPLACEBO_VER" "$LIBPLACEBO_GIT" "$dir"
  [ "$(git -C "$dir" rev-parse HEAD)" = "$LIBPLACEBO_COMMIT" ] || {
    echo "libplacebo: the tag does not point to $LIBPLACEBO_COMMIT" >&2
    exit 1
  }
  git -C "$dir" submodule -q update --init --depth 1
  # OpenGL only: no Vulkan, no shader compilers.
  meson_build "libplacebo-$LIBPLACEBO_VER" -Dvulkan=disabled -Dopengl=enabled -Dgl-proc-addr=enabled \
    -Dd3d11=disabled -Dglslang=disabled -Dshaderc=disabled -Dlcms=disabled -Ddovi=enabled \
    -Dlibdovi=disabled -Ddemos=false -Dtests=false -Dbench=false -Dfuzz=false -Dunwind=disabled \
    -Dxxhash=disabled
  done_stamp libplacebo
}

build_mpv() {
  is_done mpv && return
  fetch "$MPV_URL" "$MPV_SHA" "mpv-$MPV_VER.tar.gz"
  fetch "$MPV_PATCH_URL" "$MPV_PATCH_SHA" "mpv-c5d391ad.patch"
  unpack "mpv-$MPV_VER.tar.gz" "mpv-$MPV_VER"
  (cd "$SRC/mpv-$MPV_VER" && patch -p1 -s <"$DL/mpv-c5d391ad.patch")
  log "mpv $MPV_VER (LGPL-2.1+ with -Dgpl=false)"
  # Only libmpv (the app does not use the mpv program). Cocoa and Swift are on because
  # VideoToolbox zero-copy decoding with OpenGL (videotoolbox-gl) needs gl-cocoa.
  meson_build "mpv-$MPV_VER" -Dgpl=false -Dlibmpv=true -Dcplayer=false -Dbuild-date=false \
    -Dtests=false -Dfuzzers=false -Dlua=disabled -Djavascript=disabled -Dlibarchive=disabled \
    -Dlibbluray=disabled -Ddvdnav=disabled -Dcdda=disabled -Duchardet=disabled -Drubberband=disabled \
    -Dvapoursynth=disabled -Dzimg=disabled -Dlcms2=disabled -Djpeg=disabled -Dlibavdevice=disabled \
    -Dsdl2-audio=disabled -Dsdl2-video=disabled -Dsdl2-gamepad=disabled -Dopenal=disabled \
    -Djack=disabled -Dvulkan=disabled -Dshaderc=disabled -Dspirv-cross=disabled -Dsixel=disabled \
    -Dcaca=disabled -Dswift-build=enabled -Dswift-flags="-target $ARCH-apple-macos$MACOSX_DEPLOYMENT_TARGET" -Dcocoa=enabled -Dgl-cocoa=enabled -Dmacos-cocoa-cb=disabled -Dmacos-media-player=disabled \
    -Dmacos-touchbar=disabled -Dgl=enabled -Dplain-gl=enabled \
    -Dvideotoolbox-gl=enabled -Dvideotoolbox-pl=disabled -Dcoreaudio=enabled -Daudiounit=disabled \
    -Davfoundation=disabled -Diconv=enabled -Dzlib=enabled \
    -Dhtml-build=disabled -Dmanpage-build=disabled -Dpdf-build=disabled
  done_stamp mpv
}

# Changes every install name to @rpath/<name> so the dylibs work from Contents/Frameworks.
relocate() {
  log "Change install names to @rpath"
  local lib name dep
  for lib in "$PREFIX"/lib/*.dylib; do
    [ -L "$lib" ] && continue
    name="$(basename "$lib")"
    chmod u+w "$lib"
    install_name_tool -id "@rpath/$name" "$lib" 2>/dev/null
    for dep in $(otool -L "$lib" | tail -n +2 | awk '{print $1}' | grep "^$PREFIX/lib/" || true); do
      install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$lib" 2>/dev/null
    done
    if ! otool -l "$lib" | grep -q "path @loader_path "; then
      install_name_tool -add_rpath @loader_path "$lib" 2>/dev/null
    fi
    # install_name_tool breaks the ad-hoc signature that the linker made; sign again.
    codesign --force --sign - "$lib" 2>/dev/null
  done
}

# Copies the license texts into $PREFIX/share/licenses for the app bundle.
licenses() {
  local out="$PREFIX/share/licenses"
  rm -rf "$out"
  mkdir -p "$out"/{ffmpeg,mpv,libplacebo,libass,harfbuzz,freetype,fribidi,dav1d}
  cp "$SRC/ffmpeg-$FFMPEG_VER/COPYING.LGPLv2.1" "$SRC/ffmpeg-$FFMPEG_VER/LICENSE.md" "$out/ffmpeg/"
  cp "$SRC/mpv-$MPV_VER/LICENSE.LGPL" "$SRC/mpv-$MPV_VER/Copyright" "$out/mpv/"
  cp "$SRC/libplacebo-$LIBPLACEBO_VER/LICENSE" "$out/libplacebo/"
  cp "$SRC/libass-$LIBASS_VER/COPYING" "$out/libass/"
  cp "$SRC/harfbuzz-$HARFBUZZ_VER/COPYING" "$out/harfbuzz/"
  cp "$SRC/freetype-$FREETYPE_VER/LICENSE.TXT" "$SRC/freetype-$FREETYPE_VER/docs/FTL.TXT" "$out/freetype/"
  cp "$SRC/fribidi-$FRIBIDI_VER/COPYING" "$out/fribidi/"
  cp "$SRC/dav1d-$DAV1D_VER/COPYING" "$out/dav1d/"
  cp "$DL/mpv-c5d391ad.patch" "$out/mpv/"
  local conf
  conf="$(grep "^mpv-configuration:" "$WORK/mpv-version.txt" 2>/dev/null | sed "s|$PREFIX|<prefix>|g" || true)"
  cat >"$out/THIRD-PARTY-NOTICES.txt" <<EOF
Zoggyfin desktop: third-party software
======================================

Zoggyfin is free software under the Mozilla Public License 2.0.
Source: https://github.com/zog-tech/zoggyfin

The app plays video with libmpv. libmpv and the libraries below are in
Contents/Frameworks as separate dynamic libraries. You can replace them
with your own builds of the same libraries (GNU LGPL, section 6).

libmpv $MPV_VER - LGPL-2.1-or-later
  $MPV_URL
  Built with -Dgpl=false. One upstream patch: mpv/mpv-c5d391ad.patch, from
  $MPV_PATCH_URL
FFmpeg $FFMPEG_VER - LGPL-2.1-or-later
  $FFMPEG_URL
  libavcodec, libavformat, libavfilter, libavutil, libswscale, libswresample.
  No --enable-gpl, no --enable-nonfree, no --enable-version3.
libplacebo $LIBPLACEBO_VER - LGPL-2.1-or-later
  $LIBPLACEBO_GIT (commit $LIBPLACEBO_COMMIT)
libass $LIBASS_VER - ISC
  $LIBASS_URL
HarfBuzz $HARFBUZZ_VER - MIT
  $HARFBUZZ_URL
FreeType $FREETYPE_VER - FreeType License (FTL)
  $FREETYPE_URL
FriBidi $FRIBIDI_VER - LGPL-2.1-or-later
  $FRIBIDI_URL
dav1d $DAV1D_VER - BSD-2-Clause
  $DAV1D_URL

The complete license texts are in the folders next to this file.

How the libraries were built: desktop/scripts/build-libmpv.sh in the Zoggyfin
source repository. The script has the exact versions, the SHA-256 sums of the
source archives and every configure option.

Source code offer: for the LGPL libraries (libmpv, FFmpeg, libplacebo,
FriBidi), the source code of the exact versions used is available at the
links above. For at least three years after we distribute this version of
Zoggyfin, we also give a copy of that source code on request, for no charge
other than the cost of the medium. Write to admin@zog-tech.com.

libmpv configuration:
$conf

Portions of this software are copyright (c) The FreeType Project
(www.freetype.org). All rights reserved.
EOF
}

# Fails when a part is not LGPL or a dylib points outside the prefix.
check() {
  log "License and link check"
  local cfg="$SRC/ffmpeg-$FFMPEG_VER/ffbuild/config.mak"
  grep -q "^CONFIG_GPL=yes" "$cfg" && { echo "FFmpeg is a GPL build" >&2; exit 1; }
  grep -q "^CONFIG_NONFREE=yes" "$cfg" && { echo "FFmpeg is a nonfree build" >&2; exit 1; }
  # avutil_license() is what `ffmpeg -L` prints.
  cat >"$WORK/license.c" <<'EOF'
#include <stdio.h>
const char *avutil_license(void); const char *avcodec_license(void); const char *avformat_license(void);
const char *avfilter_license(void); const char *swscale_license(void); const char *swresample_license(void);
const char *avcodec_configuration(void);
int main(void) {
  printf("avutil: %s\navcodec: %s\navformat: %s\navfilter: %s\nswscale: %s\nswresample: %s\nconfiguration: %s\n",
    avutil_license(), avcodec_license(), avformat_license(), avfilter_license(), swscale_license(),
    swresample_license(), avcodec_configuration());
  return 0;
}
EOF
  "$CC" $CFLAGS "$WORK/license.c" -o "$WORK/license" $LDFLAGS -lavutil -lavcodec -lavformat -lavfilter \
    -lswscale -lswresample -Wl,-rpath,"$PREFIX/lib"
  "$WORK/license" | tee "$WORK/ffmpeg-license.txt"
  grep -qi "GPL version 2 or later" "$WORK/ffmpeg-license.txt" && grep -v "LGPL" "$WORK/ffmpeg-license.txt" | grep -qi "GPL" &&
    { echo "An FFmpeg library is GPL" >&2; exit 1; }
  # What `mpv --version` prints, read from libmpv itself.
  cat >"$WORK/mpvinfo.c" <<'EOF2'
#include <stdio.h>
#include <mpv/client.h>
int main(void) {
  mpv_handle *h = mpv_create();
  if (!h || mpv_initialize(h) < 0) return 1;
  const char *names[] = {"mpv-version", "mpv-configuration", "ffmpeg-version", "libass-version"};
  for (int i = 0; i < 4; i++) {
    char *v = mpv_get_property_string(h, names[i]);
    printf("%s: %s\n", names[i], v ? v : "(none)");
    mpv_free(v);
  }
  mpv_terminate_destroy(h);
  return 0;
}
EOF2
  "$CC" $CFLAGS "$WORK/mpvinfo.c" -o "$WORK/mpvinfo" $LDFLAGS -lmpv -Wl,-rpath,"$PREFIX/lib"
  "$WORK/mpvinfo" | tee "$WORK/mpv-version.txt"
  grep -q -- "-Dgpl=false" "$WORK/mpv-version.txt" || { echo "libmpv is not an LGPL build" >&2; exit 1; }
  local bad
  bad="$(for f in "$PREFIX"/lib/*.dylib; do otool -L "$f" | tail -n +2; done | awk '{print $1}' |
    grep -vE "^(@rpath/|/usr/lib/|/System/Library/)" | sort -u || true)"
  if [ -n "$bad" ]; then
    echo "Links outside the bundle and the system:" >&2
    echo "$bad" >&2
    exit 1
  fi
  echo "OK: LGPL build, all links are @rpath or system."
}

setup_tools
setup_env
build_dav1d
build_freetype
build_fribidi
build_harfbuzz
build_libass
build_ffmpeg
build_libplacebo
build_mpv
relocate
check
licenses
log "Done: $PREFIX/lib/libmpv.2.dylib"
