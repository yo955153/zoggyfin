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
  work there and on iPad with a keyboard.
- **Desktop (macOS first, then Windows and Linux)**: a Tauri 2 app (`desktop/`) around
  the web build, with libmpv for video (the model of Jellyfin Media Player). It replaces
  the Mac Catalyst plan. libmpv draws the video under a transparent web view, and the web
  player controls draw over it. The device profile asks for direct play of almost every
  file (MKV, HEVC, AV1, DTS, ASS and PGS subtitles); libmpv switches the tracks inside the
  file. `src/platform/desktop.ts` finds the desktop app; screens use only the player
  interface. Music uses the web audio engine (WebKit Media Session gives it Now Playing).
  The shipped app bundles an LGPL build of libmpv (built from source by
  `desktop/scripts/build-libmpv.sh`), is signed with Developer ID and notarized. Downloads
  use the same records and state rules as on iPhone; Rust moves the bytes. libmpv video
  has Now Playing and the media keys (MediaPlayer framework). Details: `desktop/README.md`.
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
  The baseline TV is a low-end stick: Android 9 (API 28), 32-bit `armeabi-v7a` only,
  about 900 MB RAM, 1080p. So TV builds keep `armeabi-v7a` in the APK, use a light mode
  (smaller expo-image memory cache, server-sized images at TV tile size, fewer rows
  mounted at once, no blur materials), and build the Android device profile from the
  decoders the device reports (MediaCodecList), never from a fixed list.
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

- **Nearby mode (no internet)**: one transport on every platform: Bonjour / DNS-SD
  (`_zgf-together._tcp`), TCP with framed messages and an HTTP range server on one port.
  iPhone, iPad and the Mac app connect directly with no router (peer-to-peer Wi-Fi).
  Android needs a shared Wi-Fi or a hotspot; Bluetooth LE lets an Android device make
  that hotspot by itself. See "Nearby transport (part 2)" below.
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

### As built (phase 5)

The spike results are in `docs/specs/watch-together-spike.md`.

- **Code**: `src/together/` holds the pure logic (`protocol.ts` with a version field,
  `clock.ts`, `drift.ts`, `machine.ts`, `room.ts` for the host, `follower.ts` and
  `anchor-follower.ts` for the followers, `match.ts`, `syncplay-logic.ts`, all unit-tested)
  and the controllers (`nearby.ts`, `syncplay.ts`). The native part is
  `ZoggyfinTogetherModule` in `modules/zoggyfin-native`. The UI is in
  `src/features/together/`.
- **Player seam**: `src/player/control-gate.ts`. In a session the user's play, pause, seek
  and speed controls go to the session; the session changes the player through
  `videoSession().direct`, so a group command does not echo. Changes from outside the app
  (lock screen, Picture in Picture) become group controls too. Autoplay of the next episode
  is off in a session.
- **Nearby transport**: the host advertises (service `zgf-together`), a guest browses and
  sends a join request with a small context (name, "has a copy"); the host accepts or
  declines. Messages are JSON over an encrypted MCSession. Clock pings go unreliable; all
  other messages reliable.
- **Media**: the guest's own download is used when it matches on server Id and item Id
  (item Id only when a server Id is unknown). Downloads of every saved server count, and
  nothing needs a sign-in or a server. Otherwise the host's file streams: the host runs an
  HTTP range server (Network.framework, peer-to-peer allowed, Bonjour `_zgf-media._tcp`) and
  shares one file at a random path; the guest's player reads it through a loopback relay
  (`http://127.0.0.1:<port>/<token>/media.<ext>`). The media source id is not compared:
  a download keeps one source.
- **Group state**: the host sends an anchor (playing, rate, host time, position). A play
  starts 300 ms in the future so all devices start together. The host re-anchors to its
  own player every 2 s. While a member loads or buffers, the group waits.
- **Drift**: above 150 ms (40 ms in the 8 s after a start or seek) a rate nudge of 3 % or
  6 % that ends 10 ms past zero; above 1 s a seek. Each AVPlayer rate change costs about
  20 ms, so the rate changes seldom.
- **SyncPlay**: the server is the clock (`GET /GetUtcTime`, NTP style). Commands
  (`Unpause`, `Pause`, `Seek`, `Stop`) become anchors on the server clock; the device
  reports `Buffering` and `Ready`. The group queue loads its current item paused, and
  Next / Previous move in the queue. Speed changes are not shared (SyncPlay has none).
- **End of a session**: when the host ends the session or the link is lost, a guest that
  streams the host's file leaves the player (the file is gone). A guest that plays its own
  download keeps the player, paused at the same position, and the session state clears.
  A toast tells why. Closing the player as a guest also leaves the session.
- **Toasts in the players**: the video and music players are native modals over the root
  view, so each mounts its own toast host (under the top controls in the video player).
  While a player's host is mounted, the root host shows nothing.
- **Deviations**: none left from this list. Audio came in part 2 (below).

### Nearby transport (part 2)

Multipeer Connectivity is Apple-only, so it could not talk to Android or the desktop app.
Part 2 replaces it with one transport for every platform. The contract and the wire format
are in `src/together/link-native-types.ts`.

- **Discovery**: DNS-SD service `_zgf-together._tcp` with a TXT record (session id, host
  name, item, kind, epoch). iOS, iPadOS and macOS: Network.framework (`NWListener`,
  `NWBrowser`, `NWConnection`, all with `includePeerToPeer`), so Apple devices connect
  with no router (AWDL). Android: `NsdManager`. Multipeer is gone: Network.framework gives
  the same peer-to-peer links, and one transport is simpler to keep in sync.
- **One port per session**: a connection that starts with `ZGF1` is a control socket
  (4-byte big-endian length + UTF-8 JSON per frame). Any other connection is HTTP/1.1 with
  byte ranges, for the shared files at `/<token>/<n>.<ext>`. The port closes with the
  session. Apple guests read the host's files through a loopback relay (a player cannot
  open a Bonjour name or a scoped AWDL address); Android and the desktop app read
  `http://<address>:<port>/…`.
- **Code**: the Swift transport (`NearbyCore.swift`, `MediaServer.swift`, `NearbyBle.swift`,
  `WifiJoin.swift`) is shared by the iOS module and the Mac app (a C bridge,
  `desktop/src-tauri/swift/`, compiled by `build.rs`; `src/together/link-desktop.ts` on the
  JavaScript side). Android: `ZoggyfinTogetherModule.kt`, `NearbyBle.kt`, `NearbyWifi.kt`.
  The handshake (`link.ts`), the protocol, the clock, the drift logic and the recovery
  rules are shared JavaScript.
- **Handshake** (`link.ts`): the guest sends `join` (name, has a copy, member id, maybe a
  key). The host accepts or declines. A guest with the session key (a reconnect, or a
  member that follows a new host) gets in with no new approval.
- **Security**: the host approves each new guest; every file path has a random token; the
  port is open only during the session. The TCP link has no encryption (the session
  messages and the files are not secret enough to need it on a local network); the
  Bluetooth rendezvous encrypts the Wi-Fi password (below). Known limit: the session key
  goes in clear text in the welcome, so a device that reads the network traffic could
  rejoin with it and skip the approval.
- **Join code**: the host shows a QR code (`zoggyfin://join?v=1&a=<addresses>&p=<port>&s=<session>&k=<code key>`)
  and a short text code (one address, the port and a key prefix, 17 Crockford base32
  characters). The Camera app opens the link in Zoggyfin (route `/join`). The code works
  when the Wi-Fi hides devices from each other (common in hotels and on planes). The host
  still approves (`join-code.ts`).
- **Help**: the host sheet shows who can find the session ("Visible to"); a guest that
  finds nothing for 8 s gets a help card (`nearby-help.ts`): permissions, same Wi-Fi,
  Apple devices connect directly, the Android device makes the hotspot, the code.
- **No Wi-Fi with Android**: an iPhone with no mobile data cannot turn on Personal
  Hotspot, and iOS apps cannot make a Wi-Fi network. So the Android device makes the
  network (`WifiManager.startLocalOnlyHotspot`), whatever its role, and shows a Wi-Fi QR
  code (`WIFI:T:WPA;S:…;P:…;;`).
- **Bluetooth LE rendezvous** (`rendezvous.ts`, `rendezvous-crypto.ts`): the host
  advertises a GATT service with an INFO characteristic (session, host, title, kind,
  platform, can make a hotspot, can join a Wi-Fi). The guest list merges sessions from the
  network and from Bluetooth ("Needs a quick Wi-Fi link"). On Join the two devices do an
  X25519 key exchange (HKDF-SHA256, XChaCha20-Poly1305; the audited `@noble` libraries),
  the host approves, the Android device makes a local-only hotspot and sends the SSID and
  the password encrypted; the other device joins it (iOS `NEHotspotConfiguration`, macOS
  CoreWLAN, Android `WifiNetworkSpecifier`) and connects to the host's address with the
  session key. Known limit: the key exchange has no authentication, so a device in
  Bluetooth range could read the Wi-Fi password with an active attack.

### Listen together (part 2)

- **Audio port** (`audio-binding.ts`): the audio session (`src/player/audio/session.ts`)
  has the same gate as video (play, pause, seek, rate, and for queues next, previous, a
  jump, shuffle and repeat) and a `direct` API for the session. The audio position is the
  last engine status moved on by the time since it came (the status comes every 500 ms).
- **Shared queue**: the host sends its queue (entry keys, items, order, current index,
  shuffle, repeat, long-form) in the welcome and after each change; each `state` names
  the entry (`track`) that its anchor applies to. Guests keep the host's entry keys, so a
  track change names the same entry everywhere. A guest's queue edits are locked; its
  Next, Previous and queue taps go to the host.
- **Track changes**: the host's gapless change re-anchors the group at position 0 of the
  new entry. A guest whose player is on the entry before it, less than 2 s from its end,
  waits for its own gapless change; else it loads the entry at the group position.
- **Media per track**: the guest's own download (server id + item id), else the host's
  file over the session port, else the server stream when the guest is signed in to that
  server.
- **Long-form audio** uses the same path; the rate is the group rate.
- **Drift per player**: a port can carry its own drift options. The web audio element (the
  Mac app) loses time on every rate change, so it corrects by seeks only, with a seek lead
  learned from its own seeks (`SEEK_ONLY_DRIFT`). Measurements: `watch-together-spike.md`.
- **SyncPlay**: the group queue plays in the audio player with SyncPlay's playlist item
  ids as entry keys. Next, Previous, a queue jump, shuffle and repeat go to the server. At
  a gapless change a device asks the server for the next item (the server takes the first
  request). Speed is not shared (SyncPlay has no speed).

### When a device drops off (part 2)

Rules in `recovery.ts` (unit-tested); the host room keeps members that drop as away.

- Nobody pauses because a peer is gone. The pill and the sheet show "Reconnecting…".
- A guest that drops tries again for 2 minutes (0.5 s, 1 s, 2 s, 4 s, 8 s, then every
  10 s) with the session key: Bonjour, the last address, or Bluetooth. Then it resyncs.
- When the host drops, the guests try it for 6 s, then elect a new host: only a member
  that has all the media (its own downloads) can be host; the earliest joined wins, ties
  go to the lower member id. Every member has the host's member list, so every member
  elects the same device with no extra messages. The new host continues from its own
  player (no jump), advertises the same session with a higher epoch, and the others join
  it with the session key. Guests that streamed switch to the new host's files.
- With no member that has the media, the guests play on until their buffer is empty and
  show "<host> has the file. Waiting for them to come back…".
- A member that comes back while the group plays does not hold the group while it loads;
  it catches up. A new member still holds the group until it has loaded.
- A host that comes back after a new host took over joins as a member (it does not take
  the session back: a second change would disturb everyone again).
- At the end of a film the host's player stays at the end and the group pauses there.
- When the device that made the Wi-Fi drops, the network is gone: devices with their own
  copy play on; the others find the session again over Bluetooth, where another Android
  device can make a new network.
- After an app restart, the session is kept for 10 minutes; the sheet offers "Rejoin".

## Offline use (no sign-in)

The app never asks for a sign-in for what works with no server
(`src/features/offline/entries.ts`, unit-tested). With no account signed in, or when the
server does not answer:

- **Downloads** shows when a download is on the device, from any saved or removed server.
  On the sign-in screen it is a "Downloads" button that opens the Downloads list
  (route `/offline`). Signed in and offline, the Home offline banner links to the
  Downloads tab. Everything there plays from the device. With no account, item pages do
  not open (they need the server), and progress goes into the outbox for the download's
  own server and user.
- **Join a nearby session** shows where the nearby module exists (not on the web or an old
  build): on the sign-in screen and in the Home offline banner.
- **Host a nearby session**: play a download (from Downloads), then the player's
  "Watch together" button.
- Signing out of the last account keeps the downloads, so these entries stay.

The download engine starts at launch, signed in or not, so the app finds the files. The
players and `/offline` open with no account only after the sign-in screen has shown, so
a route fallback while signed out goes to the sign-in screen, never to an empty player.

## Settings

Servers and accounts (multiple), Quick Connect login, streaming quality (Wi-Fi /
cellular), download quality, subtitle style, default audio/subtitle language, player
skip lengths, clear cache.

## Server addresses

A saved server has a list of addresses, for example a home network address
(`http://192.0.2.10:8096`, internal) and an internet address
(`https://jellyfin.example.com`, external). The user adds, edits, orders and removes
addresses in Settings, Servers. "Find addresses" reads `LocalAddress` from
`/System/Info/Public` and offers it as the internal address.

- **Choice.** The app sends `GET /System/Info/Public` to all addresses at the same time,
  with a 1.5 s timeout. An address counts only when its server Id is the saved server Id.
  The app never sends a token to an address that has not passed this check. The first
  address in the user's order that answers wins. The result comes as soon as it is known.
- **When.** At start, when the app comes to the front, on a network change (the `online`
  event on the web), after a request that gets no answer, and every 2 minutes (30 s while
  no address answers). The choice is kept as the server's last address for the next start.
- **Modes.** Automatic (default), Always internal, Always external. The Always modes use
  only the addresses of that kind.
- **Wi-Fi rule** (Automatic mode, iOS and Android). On the named Wi-Fi networks the app
  tries the internal addresses first; on other Wi-Fi networks and on cellular it tries
  the external addresses first. When those do not answer, the other addresses are the
  fallback, and the status line tells the user. The rule needs the Wi-Fi name, so iOS
  needs location access and the Access WiFi Information entitlement. The app asks for
  location only when the user turns the rule on. The native modules load after a check,
  so an app binary without them hides the rule and uses the probe only.
- **One place.** The session holds the address in use. The API client, image URLs,
  stream URLs and the downloader read it from there, so a switch takes effect at once.
  An API instance belongs to an account and moves to the new address.
- **Images.** The image cache key is the server Id plus the path, without the host and
  without the token. A switch of address does not download the images again.
- **Playback.** A playing stream keeps its address. When it fails after a switch, the
  player starts it again on the new address at the same position (a transcode gets a new
  session).
- **Web.** A browser blocks an http address from an https page (mixed content). The app
  does not probe such an address and shows a clear message.

## Server discovery

The server address screen (the first screen, and Settings, Servers, Add server) shows
"Servers on this network": each Jellyfin server found nearby, with its name, version and
address. A tap fills the address and opens the sign-in. A refresh button searches again.
The list shows "Searching…" during a search, and "No servers found. Make sure you are on
the same network as the server." when it finds nothing. Code: `src/servers/discovery/`,
`src/features/servers/nearby-servers.tsx`, `modules/zoggyfin-discovery`,
`desktop/src-tauri/src/discovery.rs`.

- **When.** Discovery runs only while the screen has the focus. It stops at once when the
  user leaves the screen. It never runs in the background.
- **UDP.** Jellyfin's own protocol: the datagram `who is JellyfinServer?` to port 7359 on
  255.255.255.255 and on the directed broadcast address of each interface. Each server
  answers with JSON (`Address`, `Id`, `Name`, `EndpointAddress`). The app collects answers
  for 2 s, then reads `/System/Info/Public` once per server for the version. Android
  (Kotlin, with a `WifiManager.MulticastLock`) and the Mac app (Rust) send it. iOS sends
  it only with the Multicast Networking entitlement (see below).
- **HTTP scan.** `GET http://<ip>:8096/System/Info/Public` to each host of the device's own
  subnet: at most a /22 (1022 hosts), only private ranges, near hosts first, 64 requests
  at a time, 400 ms per request, 4 s in total. Only an answer with `ProductName`
  "Jellyfin Server" and an `Id` counts. The address and netmask come from netinfo and the
  discovery module. This is the main path on iOS.
- **Merge.** One entry per server Id (with or without dashes). The address from a UDP
  answer wins, because the server chose it. A saved server shows "Saved".
- **Web.** A browser cannot send UDP or scan the network safely. The web shows no
  discovery and keeps the `/config.json` default server.

### Local network access (iOS, Mac app)

iOS and macOS ask the user before the app can reach the local network. Without care, the
prompt comes in the middle of the first sign-in, and that request fails.

- **First start.** Before the address field, a card says "Find servers on your network.
  Zoggyfin needs local network access to reach a server at home." Continue shows the
  system prompt on purpose and waits for the answer; then the search starts. "Not now"
  hides the card (for a user with an internet address); the refresh button then shows
  the prompt. The card shows only once.
- **Check.** iOS has no API for this permission. The discovery module advertises a Bonjour
  service (`_zgf-lan._tcp`, in `NSBonjourServices`) for a moment and browses for it: the
  browser sees the service when access is on, and waits with "policy denied"
  (kDNSServiceErr_PolicyDenied) when access is off. The Mac app sends a UDP datagram to
  the local network: macOS refuses it with EHOSTUNREACH until the user allows access.
  With no module (an over-the-air update to an older build), the app reads the HTTP
  scan: almost all requests failing at once means that access is off.
- **Access off.** The screen shows "Local network access is off" with "Open Settings".
  Internet addresses still work.
- **Retry.** When a connection or sign-in to a local network address fails with a network
  error, the app tries once more after 1.5 s (the prompt can still be open). Then it
  shows the same help instead of a generic error, unless the check says that access is on.
- **Address classes** (`src/servers/address-class.ts`, one shared classifier). Local
  network: the RFC 1918 ranges (10/8, 172.16/12 and the /16 block for home routers),
  link-local 169.254/16 and `.local` names. Tailscale
  (100.64/10, `*.ts.net`) is a VPN, not the local network: a failure there says "Check
  that Tailscale is connected". When a 10.x address fails while a VPN tunnel is up (an
  IPv4 address on a utun, tun, wg or ppp interface, or Android's VPN network), the help
  also names the VPN, because WireGuard often uses 10.x addresses.

### UDP discovery on iOS (off)

Sending a broadcast on iOS needs the Multicast Networking entitlement
(`com.apple.developer.networking.multicast`). Apple gives it only on request. Until then
the iOS UDP path stays off and iOS uses the HTTP scan. To turn it on:

1. Sign in to developer.apple.com with the Account Holder role. Open the request form
   "Multicast Networking Entitlement Request" (developer.apple.com/contact/request/networking-multicast).
2. Give the bundle id `com.zogtech.zoggyfin` and the reason: the app sends Jellyfin's
   discovery broadcast (UDP port 7359) to find media servers on the local network, only
   while the user is on the server address screen.
3. After approval, in Certificates, Identifiers & Profiles, open the App ID and turn on
   the Multicast Networking capability, then make new provisioning profiles (EAS does
   this on the next build when the capability is on).
4. Add `"com.apple.developer.networking.multicast": true` to `ios.entitlements` in
   `app.json`.
5. Set `udpDiscoveryEnabled = true` in
   `modules/zoggyfin-discovery/ios/ZoggyfinDiscoveryModule.swift`.
6. Make a new native build. An over-the-air update cannot turn it on.

## Invites

A server administrator adds a person and sends one link. The person taps the link, gets
the app and is signed in. The admin never opens the Jellyfin dashboard for this.

- **Admin side.** Settings, Servers, <server>, Invite someone. The row shows only when
  the signed-in user has `Policy.IsAdministrator`. The short way is a name and Send.
  "Options" holds the libraries (all by default), Allow downloads, Allow access away
  from home, the addresses and "Include my extensions". The app sends
  `POST /Users/New` with a one-time password (24 characters from a secure random
  source), then `POST /Users/{id}/Policy`. The person is never an administrator and is
  hidden from the server's sign-in screen. The share sheet opens with the message, and
  the screen shows a QR code of the link. "Pending invites" lists the users of invites
  from this device that never signed in. Resend sets a new one-time password, so the
  old link stops working. Cancel invite deletes the user.
- **The link.** `https://zoggyfin.zog-tech.com/join#<payload>`. The payload is in the
  fragment, so it never reaches a web server log. It is base64url JSON with a version
  (`v: 1`): the server Id and name, an ordered address list with a label per address,
  the username, the one-time password, the inviter's name and, optionally, up to 10
  extension manifest URLs. The app checks every field: sizes, a hex server Id, and
  http or https addresses only. The app never logs a payload.
- **Addresses.** Labels: Internet, Tailscale (100.64.0.0/10, `fd7a:115c:a1e0::/48` or a
  `*.ts.net` name), VPN (a private address saved as external, or marked "VPN" by the
  admin, for example WireGuard) and Home network. By default the invite has all
  addresses except Home network ones. The admin sees a warning only when no chosen
  address works away from home. When every address is Tailscale or VPN, the page and the
  app say "Connect to <Server>'s Tailscale (or VPN) first, then tap Join."
- **The /join page.** A static page on the site. It reads the fragment in the browser
  and sends nothing. It finds the platform and shows one big button: iPhone and iPad go
  to the App Store link (TestFlight until it exists), Android to the APK or the Play
  Store (configured; "comes soon" until then), Mac to the disk image. The button first
  copies the invite link. "Open in Zoggyfin" uses `zoggyfin://join#…` (an `intent://`
  link on Android, with the invite in the path). "Other devices" lists all options and
  a QR code. The page adds the Smart App Banner with the join link as the argument.
- **Opening the link.** iOS universal links and Android App Links open the app for
  `/join`. `app/+native-intent.tsx` takes the payload from `zoggyfin://join#…`,
  `zoggyfin://join/…` or the https link, keeps it in memory and opens
  `/accept-invite`. The Mac app gets `zoggyfin://` links through the Tauri deep-link
  plugin (`desktop/src-tauri/src/links.rs`).
- **No app yet.** After the install, the first screen has "Paste invite". The app reads
  the clipboard only after this tap, so iOS shows its paste prompt. "I have an invite
  link" opens a field for the link.
- **Join.** "Join <Server> as <username>?". The app saves the server with all addresses
  and probes them at the same time. Only an address that answers with the server Id of
  the invite gets the password. When no address answers, the invite stays in the secure
  store and the screen says "Cannot reach <Server> yet". When a different server answers,
  the app refuses. After the sign-in, the person sets an own password
  (`POST /Users/Password` with the one-time password as `CurrentPw`). Skip shows one
  reminder. The account becomes active at the end. Then the extension system's confirm
  screen offers the invite's extensions.

## Servers and accounts

The app keeps many servers, each with one or more signed-in users. Tokens are in the
secure store (the keychain; `localStorage` on the web), one per server and user. The
avatar button in the Home header opens the account switcher: one tap on a user switches
to that server and user. A switch stops playback, because progress must not go to the
wrong account.

- The persisted query cache has one key per server and user, and only that account's
  queries go into it. Data of one server never shows on another.
- Downloads keep their server Id. The Downloads tab shows the downloads of the active
  server, and under "Other servers" the downloads of the other servers, with their size,
  a Switch button and a Delete button. A download runs for the account that queued it.
- Remove a server: the app asks first, and offers to delete the downloads of that server.
- The first start after the update moves the single-account record (`session.active`)
  to the new format without a new sign-in. The app still writes `session.active` for
  the active account, so an older app version keeps working after a rollback.
- The self-hosted web build's `/config.json` `defaultServerUrl` fills the address field
  when no server is saved.
- **One server, one entry.** A saved server is its Id (with or without dashes). A sign-in,
  Quick Connect, an invite or "Add server" through a new address adds that address to the
  saved server; it never makes a second entry. Discovery adds the address where it finds a
  saved server, marked "Found on this network", after the user's own addresses, so it
  takes over when they do not answer (`src/auth/server-identity.ts`).
- **Stale addresses.** Each address keeps the time of its last answer (written at most once
  an hour). After 30 days with no answer, the address list shows "Not reached since
  <date>" with a Remove button. The app never removes an address by itself.
- **Reinstalled server.** Jellyfin makes a new server Id and new item Ids on a fresh
  install. When the user adds a server with a new Id and the name or an address of a saved
  server, the app asks "Is this the same server as <name>? Your downloads from it can move
  over." On Yes, after the sign-in, the new server takes the old addresses, connection
  mode and Wi-Fi rule, and each download is matched to an item of the new server: by
  provider ids (Tmdb, Imdb, Tvdb, MusicBrainz track), then by file path, then by name,
  year and type (a key that two items share matches nothing). Matched downloads and their
  waiting playback reports move to the new server; the files stay where they are. Other
  downloads stay playable under the old entry, which keeps no users, and their reports
  never go to the new server. A toast says "Moved 47 of 49 downloads"
  (`src/downloads/relink.ts`). The old users cannot move: the new server has new user Ids.

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
2b. **Restyle and platform base**: restyle all phase 1 screens to docs/design/, and
   switch the dependency to react-native-tvos (no TV layouts yet).

Priority: iPhone, iPad and web come first. TV work (layouts, focus, remote, Android TV
and Fire TV builds) waits for phase 6.
3. **Music and audio**: expo-audio queue, mini player, full player, lyrics, Instant Mix,
   long-form audio features.
4. **Downloads and playlists**: background downloads, Downloads tab, offline playback,
   playlist management.
5. **Watch together**: a short spike first (two simulators/devices over Multipeer, file
   streaming and sync accuracy), then nearby mode and SyncPlay internet mode.
6. **Phase 2 features**: TV (side rail, focus, remote, Android TV / Fire TV / Apple TV
   builds), MPV engine, Chromecast, CarPlay, Live Activity for
   downloads, Android, the web deployment and a pass over iPad and Mac polish
   (keyboard shortcuts, pointer, multi-window), and the extension system.
6b. **Desktop app**: Tauri shell around the web build with libmpv video on Apple Silicon
   Macs (first version: window, menus, mpv player with the web controls, progress
   reporting). Second version: a bundled LGPL libmpv, Developer ID signing and
   notarization, downloads in Rust, Now Playing and media keys. Then: Picture in Picture
   for libmpv video, auto update, Windows and Linux builds from the same code.
7. **Together, part 2**: voice chat and messages in a session.
8. **Roku (separate project, later)**: Roku apps use BrightScript/SceneGraph, so React
   Native cannot target them. A separate Roku channel in this repo (`roku/`) reuses the
   Jellyfin API knowledge, the device-profile rules and the design tokens.

Every phase checks iPhone, iPad and web before it is done.

## Left to the builder

Visual design within the rules above (dark-first, clean, iOS-native feel), file layout
inside `src/`, exact component split, test tooling (Jest via `jest-expo`).
