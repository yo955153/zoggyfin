# Zoggyfin — design

Date: 2026-10-19. Status: approved for build.

## Intent

Zoggyfin is an open-source Jellyfin client for iPhone (Android later). The existing
clients (the official Jellyfin app, Streamyfin) have the features but feel glitchy and
unfinished. Zoggyfin starts at feature parity with both, and its job is to *work nicely*:
fast, stable, and clear. Video, music and audio playback must be first-class.

Jellyfin stays the server. Zoggyfin is only a client of the Jellyfin HTTP API.

## What the maintainer disliked in Streamyfin (the anti-goals)

- Left/right swipe carousels that do nothing useful.
- Downloads that you cannot see: no clear list of what is downloaded and what is in progress.
- Playlists that are hard to make.
- Tabs inside a screen that do not respond to a swipe.
- Search that works but is slow and unrefined.
- Items without a thumbnail show as blank black/gray tiles.
- Players that are glitchy.

A build that technically works but has any of these is a failure.

## Goals

1. **Every item has a picture.** Image fallback chain (see Images). Never an empty tile.
2. **Downloads are a top-level tab.** You always see the queue, the progress, the size and
   what is on the phone.
3. **Playlists in two taps.** "Add to playlist" on every item and in the player, with
   "New playlist" inline. Edit, reorder and delete playlists.
4. **Players that feel native and do not glitch.** Video, music and audio (spoken word,
   recitations) each get a player tuned for them.
5. **Fast.** Cached server state, instant tab switches, lists that do not stutter, images
   sized by the server.
6. **Swipes that work.** Where a screen has sub-tabs, a horizontal swipe changes the tab,
   with a pager that tracks the finger. No decorative carousels.

## Non-goals (for now)

- Replacing the Jellyfin server, transcoding on the phone, metadata scraping.
- Live TV, Seerr requests, Streamystats, KefinTweaks, custom links.
- Android phones ship after iOS is solid, but nothing iOS-only goes in shared JS.

## Constraints

- Open source under MPL-2.0. Streamyfin (MPL-2.0) code can be reused with its file headers.
- No personal data in the repo: no names, server addresses, host names, keys, or
  personal library names. Test data uses generic names. Commits use the `zog-tech` identity.
- Test credentials live in `.env.local` (git-ignored) and nowhere else.
- Must work with Jellyfin 10.11 (the test server) and 12.x. Jellyfin 12 turns off legacy
  auth: send the `Authorization: MediaBrowser ...` header; where a URL cannot carry a
  header (images, AVPlayer URLs), use `ApiKey=<token>` with that casing.
- pnpm. Expo SDK 58 (RN 0.88, React 19.2, New Architecture). Dev builds, not Expo Go.

## Stack (decided)

| Concern | Choice |
|---|---|
| App | Expo SDK 58, expo-router 58 with **native tabs**, TypeScript strict, pnpm |
| API | `@jellyfin/sdk` 1.x, with a thin wrapper; verify every call against 10.11 |
| Server state | TanStack Query 5, persisted to MMKV for an offline cache |
| Local state | Zustand (small stores: player, downloads, settings) |
| Storage | react-native-mmkv 4 (settings, download records, query cache), expo-secure-store (tokens) |
| Images | expo-image with BlurHash placeholder, `recyclingKey`, server-side resize |
| Lists | FlashList 2 |
| Video, phase 1 | expo-video (AVPlayer). The server direct-plays what AVPlayer can open and remuxes/transcodes the rest to HLS, driven by our device profile |
| Video, phase 2 | An MPV engine (ported from Streamyfin's MPL-2.0 `modules/mpv-player`) for direct play of MKV, ASS, DTS, TrueHD, PGS. AVPlayer stays for AirPlay/PiP/HLS |
| Audio/music | expo-audio 58 `AudioPlaylist` with lock-screen controls and background audio. Gapless behaviour is tested early; if it fails, a small native AVQueuePlayer module replaces it behind the same interface |
| Downloads | `@kesha-antonov/react-native-background-downloader` 4.6 (background NSURLSession, survives restarts). Records in MMKV with a schema version and migrations from day one |
| Casting | phase 2: react-native-google-cast + AirPlay route picker |

The player and the downloader each sit behind an app-level interface
(`src/player/`, `src/downloads/`), so an engine swap does not touch screens.

## Platforms

One Expo code base for all targets. Every phase keeps all of them working.

- **iPhone**: primary target.
- **iPad**: `supportsTablet: true`. Adaptive layouts: the native tab bar shows as a
  sidebar on iPad (iPadOS 18+ behaviour), grids pick their column count from the window
  width, detail pages use two columns, and the full player can show the queue beside the
  artwork. Supports all orientations, Split View and Stage Manager. Use
  `useWindowDimensions`, never device checks, so the layout follows the window size.
- **Mac**: the iPad build runs on Apple Silicon Macs ("Designed for iPad"). Keyboard
  shortcuts (space = play/pause, arrows = seek, ⌘F = search) and pointer hover states
  work there and on iPad with a keyboard. A Mac Catalyst build is a possible later step.
- **Web**: `expo export --platform web`, a static site served by a small container
  (nginx). Video uses expo-video's web player (HLS through hls.js where Safari is not
  the browser), audio uses expo-audio on web, storage uses an MMKV/localStorage adapter,
  and downloads are hidden on web. Jellyfin must allow the web app's origin (CORS).
  The web app is self-hosted like jellyfin-web: one container, any domain, often a
  plain-http LAN name. So it must work in a non-secure context: no hard dependency on
  `crypto.randomUUID`, `crypto.subtle`, service workers, the async Clipboard API or other
  secure-context-only APIs (use fallbacks). The server URL can also be preset at deploy
  time through a runtime config file (`/config.json`), so a LAN deploy opens straight on
  the login screen of its own server.
- **TV (Google TV / Android TV, Fire TV, Apple TV)**: the project uses
  `react-native-tvos` (aliased as `react-native`) with `@react-native-tvos/config-tv`.
  TV builds get a 10-foot layout: a side navigation rail instead of tabs, large tiles,
  a clear focus ring, D-pad focus order that never traps, Back/Menu that always goes
  back, no touch gestures. Players map remote keys (play/pause, seek, back). Fire TV has
  no Google services. Not on TV: watch together, downloads, extension web panels.
- Native-only modules (MPV, background downloader, Google Cast, CarPlay, Live Activity)
  live behind `*.native.ts` / `*.web.ts` files or a capability check, so the web build
  never imports them.

## Navigation

Native tab bar, five tabs:

1. **Home** — Continue Watching, Next Up, Recently Added per library. Rows scroll
   sideways (a list, not a paged carousel). No hero carousel.
2. **Library** — all libraries. Video libraries: grid with sort and filter
   (played/unplayed, favorites, genre, year). TV: series → seasons → episodes.
   Collections, people.
3. **Music** — sub-tabs Albums / Artists / Playlists / Songs / Genres, as a swipeable
   pager with a tab strip that follows the swipe. Recitation/audiobook-style libraries
   also open here.
4. **Search** — one field, debounced, results grouped by type, recent searches, works
   offline over downloaded items.
5. **Downloads** — In progress (live progress, speed, pause/resume/cancel, retry on
   failure), Downloaded (grouped by series/album, size, delete, free space bar).

Settings and server/account switching open from an avatar button in the Home header.

A **mini player** sits above the tab bar whenever audio or video plays in the
background; tapping it opens the full player.

## Images

One function, `resolveImage(item, variant)`, used by every tile. It requests only image
types that have a tag, so it never makes a 404 request:

- Episode: Primary → series Thumb → series Backdrop → series Primary.
- Movie / video: Primary → Thumb → Backdrop → first chapter image → one trickplay tile.
- Audio: Primary → album Primary → artist Primary.
- Last fallback: generated art — a gradient seeded from the title, the title text and
  a type icon. Never a blank tile.

BlurHash from `ImageBlurHashes` shows while the image loads. Images are requested at
the tile's pixel size (`fillWidth`/`fillHeight`, `quality`, `tag`).

## Video player (phase 1)

- Full-screen, custom controls on top of expo-video: play/pause, ±10 s skip, scrubber
  with trickplay preview (when the server has trickplay), time, chapters.
- Audio track, subtitle track (server text subs delivered as WebVTT/HLS subs; image subs
  burned in by the server), quality/bitrate, playback speed.
- Skip Intro / Skip Credits from Jellyfin media segments; next-episode countdown.
- PiP, AirPlay, background audio, Now Playing / remote commands, lock-screen controls.
- Resume position; progress reported to Jellyfin (start, every 10 s, pause, stop) so
  Continue Watching stays right on every device.
- Plays downloaded files offline, and reports progress when the server is back.

## Music and audio player

- Queue with play next / add to queue / reorder / remove; shuffle, repeat.
- Gapless playback (verified on device), background playback, lock-screen and headset
  controls, Now Playing artwork.
- Full-screen player: artwork, scrubber, queue, synced lyrics (`/Audio/{id}/Lyrics`).
- Instant Mix from any song, album or artist.
- Long items (recitations, audiobooks): remember position per item, playback speed,
  ±15/30 s skip, sleep timer.
- Offline: download albums/playlists; play from local files first.

## Playlists

Create, rename, delete, reorder, add/remove items, for audio and video. "Add to
playlist" sheet with recent playlists at the top and "New playlist" inline.

## Extensions

Users add features for their own setup without changes to the app. A private extension
(for example one for a self-hosted downloader) lives on the user's own server, never in
this repo.

- **Install**: the user pastes a manifest URL (`.../zoggyfin-extension.json`) in
  Settings → Extensions. The app shows the name, the requested permissions and the
  contributions, and asks to confirm. Extensions can be turned off or removed.
- **Manifest** (versioned schema, validated with zod): `id`, `name`, `version`,
  `baseUrl`, `permissions`, `contributes`.
- **Declarative contributions** (no code runs on the phone):
  - `itemActions`: a button in an item's action sheet, with a `when` filter (item type,
    library name, media type). On tap: an HTTP request to the extension with templated
    fields (item id, name, path if permitted), optional confirm text and an input
    prompt (text, or a choice list fetched from an endpoint). The response can show a
    toast, a progress task, or ask the app to refresh the item or the library.
  - `homeSections`: a Home row filled from a JSON feed. Each entry is a Jellyfin item id
    (rendered as a normal tile) or a plain card (title, subtitle, image, link).
  - `shareTargets`: links shared to the app (iOS share sheet, paste) that match a URL
    pattern go to the extension, for example "download this YouTube link".
  - `settings`: simple fields (text, toggle, choice) stored per extension and sent with
    its requests.
- **Panels**: an extension can add a full screen (a tab in a "More" list, or a section in
  Settings) rendered as a web page in a WebView (an iframe on web). The page talks to
  the app through a small `postMessage` bridge: `getContext`, `play(itemId)`,
  `openItem(itemId)`, `refreshLibrary`, `toast`, `close`. No other native access.
- **Permissions**: `network` (always, for `baseUrl` only), `itemPath` (send file paths),
  `jellyfinToken` (send the user's token; off unless the user allows it). Requests go
  only to the manifest's `baseUrl` origin.
- **Rules**: no downloaded native code and no `eval` in the app (App Store 2.5.2). An
  extension that fails or times out never blocks a screen; its UI just hides with a
  small error note.
- **Docs**: `docs/extensions.md` with the schema and a small sample extension.

## Watch together

People watch or listen to the same item in sync, even with no internet (for example on
a plane).

- **Nearby mode (no internet, no router)**: Apple Multipeer Connectivity
  (Bluetooth + peer-to-peer Wi-Fi) between iPhone, iPad and Mac, in a native Expo
  module behind `src/together/transport`. Android joins later through Wi-Fi Aware, if
  the iOS 26 API allows it.
- **Who can join**: anyone nearby with the app. No Jellyfin account is needed. The host
  sees each join request and accepts it.
- **Media source**: if the guest has the same item downloaded (match on Jellyfin item id
  and media source id), each device plays its own file. If not, the host streams its
  downloaded file to the guest over the peer link (an HTTP range server bound to the
  peer connection, or Multipeer streams), and the guest player reads it like a local
  stream. The host can only share items that it has downloaded.
- **Sync protocol** (transport-independent, unit-tested): the host is the clock. Peers
  estimate the clock offset with repeated ping/pong (NTP-style, median of samples).
  Commands carry the host time: `play(at, position)`, `pause(position)`,
  `seek(position)`, `rate(r)`, `buffering(peer)`. Everyone waits while one peer buffers.
  Drift above 150 ms is corrected with a small rate change; above 1 s with a seek.
  Optionally guests may control playback (a host setting).
- **Internet mode**: Jellyfin SyncPlay with the same session UI, for people who all
  have accounts on the server.
- **UI**: a "Watch together" button in the player and on item pages; a session sheet
  with nearby devices, join requests and the people in the session; a small presence
  bar in the player.
- **Later (separate phase)**: voice chat and messages in a session (Multipeer audio
  locally; WebRTC with a self-hosted signaling server such as LiveKit over the internet).

## Settings

Servers and accounts (multiple), Quick Connect login, streaming quality (Wi-Fi /
cellular), download quality, subtitle style, default audio/subtitle language, player
skip lengths, clear cache.

## Quality bar

- No frame drops on scroll of a 1,000-item grid on an iPhone 15-class device.
- A cold start shows cached Home content immediately, then refreshes.
- Every network failure shows a clear message with a retry button; no blank screens.
- TypeScript strict, no `any` in app code. Unit tests for the pure logic: device
  profile, image resolver, download state machine, queue logic, progress reporting.

## Phases

1. **Foundation**: project, auth (server URL, login, Quick Connect), API layer, query
   cache, tab shell, image resolver, Home, Library, item detail, Search.
2. **Video**: device profile, expo-video player with all phase-1 features, progress reporting.
2b. **Platform base and restyle**: switch to react-native-tvos, add Android phone,
   Android TV and Apple TV builds with the TV navigation, then restyle all phase 1
   screens to docs/design/.
3. **Music and audio**: expo-audio queue, mini player, full player, lyrics, Instant Mix,
   long-form audio features.
4. **Downloads and playlists**: background downloads, Downloads tab, offline playback,
   playlist management.
5. **Watch together**: a short spike first (two simulators/devices over Multipeer, file
   streaming and sync accuracy), then nearby mode and SyncPlay internet mode.
6. **Phase 2 features**: MPV engine, Chromecast, CarPlay, Live Activity for
   downloads, Android, the web deployment and a pass over iPad and Mac polish
   (keyboard shortcuts, pointer, multi-window), and the extension system.
7. **Together, part 2**: voice chat and messages in a session.
8. **Roku (separate project, later)**: Roku apps use BrightScript/SceneGraph, so React
   Native cannot target them. A separate Roku channel in this repo (`roku/`) reuses the
   Jellyfin API knowledge, the device-profile rules and the design tokens.

Every phase checks iPhone, iPad and web before it is done.

## Left to the builder

Visual design within the rules above (dark-first, clean, iOS-native feel), file layout
inside `src/`, exact component split, test tooling (Jest via `jest-expo`).
