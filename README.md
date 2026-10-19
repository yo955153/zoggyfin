# Zoggyfin

Zoggyfin is an open-source client for [Jellyfin](https://jellyfin.org) media servers.
It runs on iPhone, iPad and the web, and on Apple silicon Macs as a desktop app with libmpv (`desktop/`).
Android comes later. The goal is a client that is fast, stable and clear.

Zoggyfin is not affiliated with the Jellyfin project.

## Download

- **Mac** (Apple silicon, macOS 13 or later): [Zoggyfin-arm64.dmg](https://releases.zog-tech.com/zoggyfin/latest/Zoggyfin-arm64.dmg),
  signed and notarized. The app updates itself. All versions and notes:
  [zoggyfin.zog-tech.com/download](https://zoggyfin.zog-tech.com/download) and the GitHub releases.
- **iPhone and iPad:** the beta on [TestFlight](https://testflight.apple.com/join/qRFABNBJ).

## Status

Early development. Phase 1 ("Foundation") is in place:

- Sign in with a server address and a username and password, or with Quick Connect.
- Home: Continue Watching, Next Up, Continue Listening, Recently Added per library.
- Library: library grids with sort and filters, shows to seasons to episodes, collections.
- Music: Albums, Artists, Playlists, Songs and Genres in a swipeable pager.
- Item pages for movies, shows, seasons, episodes, albums, artists, people and playlists.
- Search, with results grouped by type and recent searches.
- Every tile has a picture: server art when it exists, generated art when it does not.
- A persisted query cache, so a cold start shows the last content at once.

Phase 2 ("Video") adds the video player:

- The server direct-plays what the device can open (mp4, m4v, mov with H.264, HEVC and,
  with a hardware decoder, AV1) and sends HLS for the rest. The device profile is in
  `src/player/device-profile.ts`.
- Full-screen player with play/pause, skip back and forward, a scrubber with trickplay
  preview and chapter marks, audio and subtitle tracks, quality, playback speed,
  Skip Intro / Skip Credits, a next-episode countdown, double-tap to seek and swipe down
  to minimize.
- Picture in Picture, AirPlay, background audio, lock-screen controls, a mini player.
- Resume and Start Over on item pages. Progress goes to the server every 10 seconds and
  on pause, seek and stop.
- Keyboard: Space play/pause, ←/→ seek, Shift+←/→ 30 s, F full screen (web), M mute,
  C subtitles, Esc close. On iPad and Mac this works with a hardware keyboard.

Phase 2b ("Platform base and restyle"):

- Every screen follows the design system in [docs/design](docs/design/): the Ember accent on
  graphite, a light theme that follows the system (Settings, Appearance: System, Dark or
  Light), one icon set (SF Symbols on Apple platforms, Lucide on the web), generated art for
  items without a picture, skeletons while loading and Arabic text rules.
- Item pages pick their hero from the artwork: a tall backdrop, a wide 16:9 image (videos with
  only a wide thumbnail), square album art or a circle for people.
- The project builds on `react-native-tvos` (aliased as `react-native`) with
  `@react-native-tvos/config-tv`. Phone, tablet and web builds are unchanged. `EXPO_TV=1`
  makes prebuild generate TV targets; the TV layout comes in a later phase.

Phase 3 ("Music and audio"):

- Audio plays with expo-audio through the server's universal endpoint, in the background and
  on the lock screen (artwork, play/pause, next/previous, seek). Interruptions and unplugged
  headphones pause. The queue lives in JavaScript; the native playlist holds the current and
  the next track, so the next track starts without a reload.
- Queue: play now, play next, add to queue, drag to reorder, swipe to remove, clear, shuffle
  and repeat (off, all, one). The queue and the position come back after a restart.
- Full player (always dark): art-tinted background, scrubber, volume, AirPlay, a queue panel,
  synced or plain lyrics when the server has them, favourite, go to album or artist. On wide
  windows the queue or lyrics sit beside the player.
- Long-form mode for audiobooks, long tracks and spoken-word albums: resume per item
  ("Resumes where you left off"), speed 0.75–2×, 15/30 s skips, a sleep timer (minutes or end
  of track) and chapters. Positions are kept on the device and reported to the server.
- Instant Mix from a song, album, artist or genre. Music tab: sort and favourites filter per
  tab, Recently played and Most played rows, album, artist and genre pages with Play, Shuffle
  and Mix. Audiobook libraries open in the same browser.
- Web: Media Session controls and Space/←/→ keys. Noto Sans Arabic is bundled for the web.

Phase 4 ("Downloads and playlists"):

- Downloads (iOS and iPadOS) use a background URL session through
  @kesha-antonov/react-native-background-downloader. Two files download at a time. Downloads
  continue when the app is in the background, and the app finds them again after a restart.
  Each download goes through a tested state machine: queued, downloading, paused, then
  completed, failed (with retry and backoff) or cancelled.
- Movies, episodes, seasons, series, songs, albums and playlists can be downloaded. A video
  downloads as the original file when the device can play it directly. Otherwise the server
  makes a copy at the "Download quality" setting (Original, 1080p, 720p or 480p). Images,
  subtitles, lyrics and item metadata download with the media.
- Files are in `Documents/downloads/<item id>/` and are not in iCloud backups. Records are
  in MMKV with a schema version and migrations.
- Downloads tab: in-progress rows with progress, speed, time left, pause, resume, cancel and
  retry. Downloaded items are grouped by show or album, with sizes, swipe to delete and a
  storage bar. The tab shows a badge while downloads run.
- Offline mode: the app plays downloads from the device first. A banner shows when the server
  is unreachable. Home shows downloads first, and search looks in downloads. Playback progress
  goes into an outbox and goes to the server when the server is reachable again.
- Playlists: "Add to playlist" from every action menu, the full player and the queue (Save),
  with "New playlist" in the same sheet. Playlist pages: rename, delete, drag to reorder,
  swipe or tap the bin to remove, play, shuffle and download. Changes show at once and roll
  back if the server refuses them.
- Web: playlists work fully. Downloads are not on the web.
- Development builds have "Simulate no server" in Settings to test offline mode.

Servers and accounts:

- Save many servers, each with one or more users. The avatar button on Home opens the
  account switcher: one tap on a user switches to that server and user.
- A server has internal and external addresses. The app checks all of them at the same
  time and uses the first one in your order that answers as the same server (it compares
  the server Id). It checks again at start, on foreground, on a network change and after
  a failed request. Modes: Automatic, Always internal, Always external. An optional Wi-Fi
  rule picks the internal address on named Wi-Fi networks (iOS and Android).
- Settings, Servers: add, edit, order and remove addresses, "Find addresses", the
  connection status ("Connected through Home network (internal)") with "Check again",
  users, Add user, and Remove server (with its downloads, if you want).
- Each account has its own cache. The Downloads tab shows the downloads of other servers
  under "Other servers".
- An install with one saved account moves to the new format at the first start, with no
  new sign-in. See "Server addresses" in the design.

Desktop app (macOS on Apple Silicon):

- A Tauri 2 window around the web build, in [desktop/](desktop/). Video plays through libmpv:
  the original file plays directly (MKV, HEVC, AV1, DTS, ASS and PGS subtitles), with the
  Zoggyfin player controls over the video. Music uses the web audio engine.
- Downloads (the Downloads tab, resume after pause or restart, offline play through libmpv),
  Now Playing and the media keys for video.
- Standard Mac menus (⌘, Settings, ⌘F Search), a transparent title bar, and the window keeps
  its size and position.
- `pnpm desktop:dev` and `pnpm desktop:build`. Development needs `brew install mpv`.
- `pnpm desktop:release` builds an LGPL libmpv from source, puts it in the app, signs with
  Developer ID (hardened runtime) and makes a notarized DMG.
  See [desktop/README.md](desktop/README.md) for the libmpv licenses, signing and the notices.

Phase 5 ("Watch together"):

- A "Watch together" button in the video player and a "Together" action on video item pages
  open the session sheet. A "Together" indicator in the player shows the session; tap it to
  open the sheet.
- Nearby mode (iPhone, iPad, Mac; no internet and no Jellyfin server needed): the host shares
  a downloaded video from any saved server. People nearby see the session, ask to join, and
  the host accepts or declines. A guest plays its own download of the same item (same server
  and item Id) or streams the host's file over the local or peer-to-peer link. Everyone can
  play, pause, seek and change the speed, or the host turns on "Only the host controls".
  The group waits while a member loads. Multipeer Connectivity carries the messages.
- Internet mode: Jellyfin SyncPlay groups on the signed-in server, on native and the web.
  Start a group with the current item, join a group, play, pause and seek for everyone,
  next and previous item of the group queue, leave.
- Sync: the host (nearby) or the server (SyncPlay) is the clock; each device measures its
  clock offset with ping/pong and corrects drift with small speed changes or a seek. On two
  simulators the median sync error was 4 ms (streamed) and 15 ms (own download). See
  [docs/specs/watch-together-spike.md](docs/specs/watch-together-spike.md).
- Not on TV. The web has SyncPlay only.

Offline use (no sign-in needed):

- With no account signed in, or when the server does not answer, the app offers
  "Downloads" (when a download is on the device, from any server) and
  "Join a nearby session" (iPhone, iPad, Mac). They are on the sign-in screen and in the
  Home offline banner. Downloads play from the device; play one and use "Watch together"
  to host a nearby session. Signing out keeps the downloads.
- When the host ends a session, a guest that streams the host's file leaves the player; a
  guest with its own download keeps its place. Toasts show above the full-screen players.

The design is in [docs/specs](docs/specs/) and [docs/design](docs/design/).

The native app includes a small local module, `modules/zoggyfin-native`, that reports
hardware decoders and hardware keyboard presses, draws the system volume slider and runs
nearby watch together (Multipeer Connectivity, a range server for the host's file and a
loopback relay for the guest).
It builds with the app.

## Run a development build

You need Node 22 or later, pnpm 10, and Xcode for iOS.

```sh
pnpm install
pnpm expo run:ios        # builds the native app and starts it in the simulator
pnpm start               # starts Metro for an already installed development build
pnpm expo start --web    # runs the web app in a browser
```

The `ios/` and `android/` folders are generated (Expo CNG) and are not in git.

Checks:

```sh
pnpm typecheck
pnpm test
pnpm lint
```

### Web build

```sh
pnpm expo export --platform web
```

The `dist/` folder is a static site. A self-hosted build can carry an optional
`config.json` next to `index.html` to prefill the server address, for example
`{ "defaultServerUrl": "http://jellyfin.example.lan:8096" }`. It fills the address field
when no server is saved. See `public/config.example.json`. The Jellyfin server must allow
the web app's origin (CORS). A web app served over https cannot use http server addresses
(the browser blocks mixed content); the app shows a message for them.

## License

[Mozilla Public License 2.0](LICENSE).
