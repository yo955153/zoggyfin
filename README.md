# Zoggyfin

Zoggyfin is an open-source client for [Jellyfin](https://jellyfin.org) media servers.
It runs on iPhone, iPad, Apple Silicon Macs ("Designed for iPad") and the web.
Android comes later. The goal is a client that is fast, stable and clear.

Zoggyfin is not affiliated with the Jellyfin project.

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

Downloads are not in yet.
The design is in [docs/specs](docs/specs/) and [docs/design](docs/design/).

The native app includes a small local module, `modules/zoggyfin-native`, that reports
hardware decoders and hardware keyboard presses and draws the system volume slider.
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
`{ "defaultServerUrl": "http://jellyfin.example.lan:8096" }`.
See `public/config.example.json`. The Jellyfin server must allow the web app's origin (CORS).

## License

[Mozilla Public License 2.0](LICENSE).
