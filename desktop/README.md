# Zoggyfin desktop

The desktop app is a [Tauri 2](https://tauri.app) window around the Zoggyfin web build.
Video plays through [libmpv](https://mpv.io), the model of Jellyfin Media Player.
The first target is macOS on Apple Silicon. Windows and Linux come later from the same code.

## How it works

- The window loads the web build (`dist/`, from `pnpm expo export --platform web`).
  In development it loads Metro web at `http://localhost:8082`.
- `src/platform/desktop.ts` finds the desktop app (`window.__TAURI_INTERNALS__`).
  In a browser and on iPhone and iPad it does nothing.
- Video: the player uses `src/player/engine-mpv.ts` in place of the HTML `<video>` element.
  The device profile (`mpvCapabilities` in `src/player/device-profile.ts`) asks the server
  for direct play of almost every file: MKV, HEVC, AV1, VP9, DTS, TrueHD, and ASS, SRT, PGS
  and DVD subtitles. libmpv opens the static stream URL of the original file.
  libmpv switches audio and subtitle tracks inside the file, so no new stream is necessary.
  Progress goes to the server through the same `ProgressReporter` as on the other platforms
  (start, every 10 seconds, pause, seek and stop).
- Music and audiobooks use the web audio engine for now.

### Video surface (macOS)

libmpv draws with its render API into a `CAOpenGLLayer` (the approach of IINA).
The layer is in a view under the `WKWebView`, in the window's content view.
The web view is transparent (`transparent: true` and `macOSPrivateApi: true`).
While the player is open, the page hides what is under the player and makes the player
background transparent. Thus the video shows through, and the normal Zoggyfin controls
draw over it. libmpv decodes with VideoToolbox (`hwdec=auto-safe`).

Why this approach: libmpv on macOS does not support `--wid` embedding, and a separate mpv
window that follows the main window has focus, Spaces and full-screen problems.
The render API in a layer under the web view gives one window, real overlays and
correct full screen.

Note: Apple marks OpenGL as deprecated, but it still works on macOS 26.
libmpv has no Metal render API yet. If OpenGL goes away, a libmpv Vulkan (MoltenVK) or
Metal render path takes its place behind the same view.

### Rust side (`src-tauri/`)

| File | What it does |
|---|---|
| `src/lib.rs` | Starts libmpv, makes the window, adds the commands |
| `src/menu.rs` | App, Edit, View, Window and Help menus |
| `src/mpv/ffi.rs` | The libmpv C API that the app uses (hand-written from the headers) |
| `src/mpv/player.rs` | One libmpv instance; events go to the page as JSON |
| `src/mpv/view_macos.rs` | The OpenGL layer under the web view |
| `src/debug.rs` | Test automation, in debug builds only (see below) |

Commands: `mpv_command`, `mpv_set_property`, `mpv_get_property`, `mpv_set_video_visible`,
`desktop_toggle_fullscreen`. Events go to `window.__zoggyfinDesktop.mpv(event)`.

### Window and menus

- Transparent title bar with the window buttons over the page; a 28 pt strip at the top
  drags the window. Minimum size 900 × 600. The window keeps its size and position
  (`tauri-plugin-window-state`).
- ⌘, opens Settings. ⌘F opens Search. ⌘1, ⌘2 and ⌘3 open Home, Library and Music.
  ⌘[ goes back. ⌘R reloads. ⌃⌘F toggles full screen.
- Space (play and pause), the arrow keys, F (full screen), M and C stay in the page.

## Develop

You need Rust (stable), pnpm and libmpv:

```sh
brew install mpv
pnpm install
pnpm expo start --web --port 8082   # Metro web, in one terminal
pnpm desktop:dev                    # the desktop app, in another terminal
```

`MPV_LIB_DIR` changes where the build looks for `libmpv.dylib` (default `/opt/homebrew/lib`).

Build an app for testing (not signed for distribution):

```sh
pnpm desktop:build
# -> <cargo target dir>/release/bundle/macos/Zoggyfin.app
```

Checks for the Rust code:

```sh
cd desktop/src-tauri
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

### Test automation (debug builds)

Start a debug build with `ZOGGYFIN_AUTOMATION=<folder>`. The app runs `<folder>/cmd.js` in the
page and deletes it. A file `<folder>/snap` that holds a PNG path makes the app save a picture
of its window (video and page together); an app can capture its own window without the
screen recording permission. Scripts write lines to `<folder>/out.log` with
`__TAURI_INTERNALS__.invoke('debug_log', { line })`. Release builds do not contain this code.

## libmpv: licenses, bundling and signing

**Licenses.** Zoggyfin is MPL-2.0. libmpv is LGPL-2.1+ only when mpv is built with
`-Dgpl=false`; otherwise it is GPL-2.0+. The Homebrew build is a GPL build (`gpl` is in its
feature list, and Homebrew FFmpeg uses `--enable-gpl --enable-version3`, x264 and x265).
Use the Homebrew build for development only. Do not ship it.

A shipped app must use an LGPL build:

- mpv built with `-Dlibmpv=true -Dgpl=false`.
- FFmpeg without `--enable-gpl` and `--enable-nonfree` (no x264, x265 or other GPL parts;
  decoders and VideoToolbox are enough for a player).
- libass, libplacebo, HarfBuzz, FreeType, FriBidi and the other dependencies with
  LGPL-compatible or permissive licenses.
- Ship the license texts and a notice that tells where the source of libmpv and FFmpeg is.
  Link libmpv dynamically, so that users can replace it (LGPL requirement).

Do not copy GPL code into this repository.

**Bundling (follow-up).** The Homebrew `libmpv.2.dylib` links about 60 other dylibs from
`/opt/homebrew`. Thus the test app runs only on a Mac with Homebrew mpv. For distribution:

1. Build libmpv (LGPL) and its dependencies as dylibs, or take a prebuilt LGPL libmpv
   (for example from the MPVKit or IINA build scripts, LGPL configuration).
2. Copy `libmpv.2.dylib` and every dependency into `Zoggyfin.app/Contents/Frameworks/`
   (Tauri: `bundle.macOS.frameworks` in `tauri.conf.json`).
3. Change the install names to `@rpath/...` with `install_name_tool -id` and `-change`
   (or `dylibbundler`), and add `@executable_path/../Frameworks` to the binary's rpath.
4. Check with `otool -L` that no path points to `/opt/homebrew` or `/usr/local`.

**Signing and notarization (follow-up).** Sign every dylib in `Contents/Frameworks` first,
then the app, with the hardened runtime:

```sh
codesign --force --timestamp --options runtime --sign "Developer ID Application: …" Contents/Frameworks/*.dylib
codesign --force --timestamp --options runtime --entitlements entitlements.plist --sign "Developer ID Application: …" Zoggyfin.app
xcrun notarytool submit Zoggyfin.zip --keychain-profile … --wait
xcrun stapler staple Zoggyfin.app
```

With the hardened runtime, the app loads only libraries signed with the same Team ID.
The test build loads Homebrew's libmpv, which has another signature. Thus the test build is
ad-hoc signed without the hardened runtime (`signingIdentity: "-"`, `hardenedRuntime: false`
in `tauri.conf.json`). The Developer ID build sets `hardenedRuntime: true` and bundles a
libmpv signed with the app's identity. `macOSPrivateApi` (transparent web view) is acceptable for Developer ID
distribution but not for the Mac App Store.

The test build is ad-hoc signed (`codesign --sign -`). It runs on this Mac; another Mac
needs Homebrew mpv and a right-click, Open.

## Left to do

- Bundle an LGPL libmpv and its dylibs; Developer ID signing and notarization.
- Downloads in Rust (the Downloads tab is hidden on the desktop, as on the web).
- Now Playing and media keys for libmpv video (the web audio engine has Media Session).
- Picture in Picture for libmpv video.
- Windows and Linux: the same Rust code with a native child window (`wid`) or the OpenGL
  render API in place of `view_macos.rs`.
