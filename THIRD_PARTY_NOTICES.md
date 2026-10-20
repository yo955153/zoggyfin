# Third-party notices

Zoggyfin is under the [Mozilla Public License 2.0](LICENSE).
It uses the open-source software below. Each project keeps its own license and copyright.

This file is a summary. The full license texts are in each package, and the Mac app carries them
in `Contents/Resources/ThirdParty`.

## libmpv and the Mac app libraries (LGPL)

Only the **Mac app** contains these libraries. The iPhone, iPad, Android and web apps do not.

The Mac app plays video with [libmpv](https://mpv.io). The release build uses an LGPL build:

| Library | Version | License |
|---|---|---|
| mpv (libmpv) | 0.41.0 | LGPL-2.1-or-later (built with `-Dgpl=false`) |
| FFmpeg | 9.0.2 | LGPL-2.1-or-later (no `--enable-gpl`, no `--enable-nonfree`, no `--enable-version3`) |
| libplacebo | 7.360.1 | LGPL-2.1-or-later |
| FriBidi | 1.0.17 | LGPL-2.1-or-later |
| libass | 0.17.5 | ISC |
| HarfBuzz | 14.6.0 | MIT |
| FreeType | 2.15.0 | FreeType License (FTL) |
| dav1d | 1.5.4 | BSD-2-Clause |

`desktop/scripts/build-libmpv.sh` builds all of them from source. It has the exact versions, the
SHA-256 sum of each source archive and every configure option. At the end, it checks that every
FFmpeg library reports "LGPL version 2.1 or later" and that mpv was built with `-Dgpl=false`.
The details are in the [desktop README](desktop/README.md#the-lgpl-libmpv-build).

The Homebrew `mpv` package is a GPL build. Use it for development only. Never ship it.

### How to replace the library

The libraries are separate dynamic libraries (`.dylib` files) in `Zoggyfin.app/Contents/Frameworks`.
They are not linked into the app program. You can replace them with your own build of the same
libraries, as the LGPL (section 6) requires us to allow.

To replace them in an installed app:

1. Build your own libmpv and its libraries. You can use `desktop/scripts/build-libmpv.sh` as a guide.
2. Copy your `.dylib` files over the files in `Zoggyfin.app/Contents/Frameworks`. Keep the same file names.
3. Sign the app again. For your own use, an ad-hoc signature works:
   `codesign --force --deep --sign - Zoggyfin.app`.
   The changed app no longer has the notarization of the original, and it does not update itself in place.

To build the app from source with your own library:

1. Set `MPV_LIB_DIR` to the folder that holds your `libmpv.dylib`.
2. Run `pnpm desktop:build` (see [desktop/README.md](desktop/README.md)).

### Source code

The source code of the exact versions is available at the links in
`Contents/Resources/ThirdParty/THIRD-PARTY-NOTICES.txt` inside the app. For at least three years after
we distribute a version, we also give a copy of the source code of the LGPL libraries on request, for no
charge other than the cost of the medium. Write to admin@zog-tech.com.

## JavaScript and TypeScript dependencies

The app depends on the packages in [package.json](package.json). The main ones are:

| Package | License |
|---|---|
| [Expo](https://github.com/expo/expo) and the `expo-*` modules | MIT |
| [React](https://github.com/facebook/react), React DOM | MIT |
| [React Native TV](https://github.com/react-native-tvos/react-native-tvos) (used as `react-native`) | MIT |
| [React Native Web](https://github.com/necolas/react-native-web) | MIT |
| [Reanimated](https://github.com/software-mansion/react-native-reanimated), [Gesture Handler](https://github.com/software-mansion/react-native-gesture-handler), [Screens](https://github.com/software-mansion/react-native-screens), [Worklets](https://github.com/software-mansion/react-native-reanimated) | MIT |
| [@jellyfin/sdk](https://github.com/jellyfin/jellyfin-sdk-typescript) | MPL-2.0 |
| [TanStack Query](https://github.com/TanStack/query) | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [Zod](https://github.com/colinhacks/zod) | MIT |
| [axios](https://github.com/axios/axios) | MIT |
| [hls.js](https://github.com/video-dev/hls.js) | Apache-2.0 |
| [@kesha-antonov/react-native-background-downloader](https://github.com/kesha-antonov/react-native-background-downloader) | Apache-2.0 |
| [react-native-mmkv](https://github.com/mrousavy/react-native-mmkv) | MIT |
| [@shopify/flash-list](https://github.com/Shopify/flash-list) | MIT |
| [@noble/ciphers, curves and hashes](https://github.com/paulmillr/noble-ciphers) | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) (`lucide-react`) | ISC |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | MIT |
| [Noto Sans Arabic](https://fonts.google.com/noto/specimen/Noto+Sans+Arabic) (`@expo-google-fonts/noto-sans-arabic`) | MIT (package), SIL OFL 1.1 (font) |

Development tools (TypeScript, Jest, ESLint, the Tauri CLI) are not part of the shipped app.

To list the license of every production dependency, including the indirect ones, run:

```sh
pnpm licenses list --prod
```

At the time of writing, the production dependency tree has these license families:
MIT (most packages), ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense,
BlueOak-1.0.0, MPL-2.0 (`@jellyfin/sdk`, `lightningcss`), OFL-1.1, CC-BY-4.0 (`caniuse-lite`, data only),
Python-2.0 (`argparse`) and the dual license (BSD-3-Clause OR GPL-2.0) of `node-forge`, which we use under BSD-3-Clause.
Run the command for the current list.

## Rust dependencies (Mac app)

The Mac app is a [Tauri 2](https://tauri.app) app (MIT or Apache-2.0). Its other main crates are
`reqwest`, `tokio`, `serde`, `libc` and the `objc2` family, all under MIT or Apache-2.0.
The complete list is in [desktop/src-tauri/Cargo.lock](desktop/src-tauri/Cargo.lock).
To print the license of each crate, run `cargo install cargo-license` and then
`cargo license` in `desktop/src-tauri`.

## Fonts and icons

- The website uses the Inter font under the SIL Open Font License 1.1.
  The license text is in `site/public/fonts/OFL.txt`.
- The apps use the system font. The Arabic text on the web uses Noto Sans Arabic (SIL OFL 1.1).
- Lucide icons (ISC) draw the icons on the web. Apple platforms use SF Symbols, which Apple licenses for use in apps for Apple platforms.

## Trademarks

Jellyfin is a trademark of its owners. Zoggyfin is not affiliated with the Jellyfin project.
Apple, iPhone, iPad, Mac, TestFlight and App Store are trademarks of Apple Inc.
Android and Google Play are trademarks of Google LLC.
